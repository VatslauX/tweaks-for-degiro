// Price alarms: the rules, with no DOM or storage, so the unit tests can run them under Node.
// An alarm fires when DEGIRO's price reaches its price: at or above it for 'above', at or below
// it for 'below'. 'once' then switches itself off, 'daily' fires at most once per local calendar
// day, 'each' fires once per crossing and re-arms once the price is seen on the other side.
const dgAlarmRules = (() => {
  const MAX = 25, MAX_EVENTS = 20, REPEATS = ['once', 'daily', 'each'], DIRS = ['above', 'below'];
  const LIMITS = Object.freeze({ name: 50, symbol: 12, currency: 4 });
  // Byte caps, counted as stored JSON (UTF-8, escapes included): keeps the list well under the 8192-byte chrome.storage.sync item limit.
  const BYTES = Object.freeze({ name: 90, symbol: 24, currency: 8 });
  const ID = /^[A-Za-z0-9-]{1,36}$/;
  // Lone surrogates: a high without a following low, or a low without a preceding high.
  const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
  /** C0/C1 control characters. @param {string} ch */
  const control = ch => { const c = ch.charCodeAt(0); return c < 0x20 || (c >= 0x7f && c <= 0x9f); };
  /** @param {unknown} v @returns {v is number} */
  const pos = v => typeof v === 'number' && Number.isFinite(v) && v > 0;

  const ENC = new TextEncoder();
  /** Bytes one character takes in the stored JSON: UTF-8 of its JSON escape, quotes excluded (so `"` and `\\` count 2). */
  const jsonBytes = ch => ENC.encode(JSON.stringify(ch)).length - 2;

  // a price cell without a price reads "$ —": the dash is not part of the currency
  const DASHES = /[\u2010-\u2015\u2212-]/g;

  /** Text, cleaned and capped by characters and by UTF-8 bytes; never splits a surrogate pair. */
  function text(v, chars, bytes) {
    if (typeof v !== 'string') return '';
    const s = [...v.replace(LONE, '')].filter(ch => !control(ch)).join('').trim();
    let out = '', n = 0, b = 0;
    for (const ch of s) {
      const cb = jsonBytes(ch);
      if (n + 1 > chars || b + cb > bytes) break;
      out += ch;
      n++;
      b += cb;
    }
    return out;
  }

  /** Stored alarms, cleaned: malformed entries and duplicate ids dropped, texts capped, at most MAX. */
  function sanitize(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set(), out = [];
    for (const a of list) {
      if (out.length === MAX) break;
      if (!a || typeof a !== 'object') continue;
      if (typeof a.id !== 'string' || !ID.test(a.id) || seen.has(a.id)) continue;
      if (!Number.isSafeInteger(a.productId) || a.productId <= 0 || a.productId >= 1e10) continue;
      if (!pos(a.price) || a.price >= 1e9) continue;
      const price = Math.round(a.price * 1e6) / 1e6;
      if (price <= 0) continue;
      if (!DIRS.includes(a.dir) || !REPEATS.includes(a.repeat)) continue;
      seen.add(a.id);
      out.push({ id: a.id, productId: a.productId,
        name: text(a.name, LIMITS.name, BYTES.name), symbol: text(a.symbol, LIMITS.symbol, BYTES.symbol),
        currency: text(typeof a.currency === 'string' ? a.currency.replace(DASHES, '') : a.currency, LIMITS.currency, BYTES.currency), price, dir: a.dir, repeat: a.repeat,
        on: a.on !== false, created: pos(a.created) ? a.created : 0 });
    }
    return out;
  }

  /** Per-alarm state, cleaned; with `ids`, only those alarms' state is kept. */
  function sanitizeState(s, ids) {
    /** @type {Record<string, { last?: number, lastAt?: number, firedAt?: number, armed?: boolean }>} */
    const out = {};
    if (!s || typeof s !== 'object' || Array.isArray(s)) return out;
    for (const [id, v] of Object.entries(s)) {
      if (!ID.test(id) || (ids && !ids.includes(id)) || !v || typeof v !== 'object') continue;
      /** @type {{ last?: number, lastAt?: number, firedAt?: number, armed?: boolean }} */
      const st = {};
      if (pos(v.last)) st.last = v.last;
      if (pos(v.lastAt)) st.lastAt = v.lastAt;
      if (pos(v.firedAt)) st.firedAt = v.firedAt;
      if (typeof v.armed === 'boolean') st.armed = v.armed;
      out[id] = st;
    }
    return out;
  }

  /** Fired alarms waiting to be closed: one per alarm (the latest), the last MAX_EVENTS. */
  function sanitizeEvents(list) {
    if (!Array.isArray(list)) return [];
    /** @type {Map<string, { alarmId: string, price: number, at: number }>} */
    const by = new Map();
    for (const e of list) {
      if (!e || typeof e !== 'object' || typeof e.alarmId !== 'string' || !ID.test(e.alarmId)) continue;
      if (!pos(e.price) || !pos(e.at)) continue;
      by.delete(e.alarmId);
      by.set(e.alarmId, { alarmId: e.alarmId, price: e.price, at: e.at });
    }
    return [...by.values()].slice(-MAX_EVENTS);
  }

  /** @param {number} alarmPrice @param {number} now @returns {'above' | 'below' | null} */
  function direction(alarmPrice, now) {
    if (!pos(alarmPrice) || !pos(now) || alarmPrice === now) return null;
    return alarmPrice > now ? 'above' : 'below';
  }

  /** @param {{ dir: string, price: number }} a @param {number} price */
  const reached = (a, price) => (a.dir === 'above' ? price >= a.price : price <= a.price);

  /** local calendar day, e.g. 20261029 @param {number} ms */
  const day = ms => { const d = new Date(ms); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };

  /**
   * What to do now that DEGIRO shows `price`.
   * @param {{ on: boolean, dir: string, price: number, repeat: string }} a
   * @param {{ firedAt?: number, armed?: boolean } | null | undefined} st
   * @param {number} price @param {number} now
   * @returns {{ fire: boolean, on: boolean, armed: boolean }}
   */
  function decide(a, st, price, now) {
    const s = st || {};
    const armed = s.armed !== false;
    if (!a.on || !pos(price)) return { fire: false, on: a.on, armed };
    if (!reached(a, price)) return { fire: false, on: true, armed: true };
    if (a.repeat === 'once') return { fire: true, on: false, armed: false };
    if (a.repeat === 'daily') return { fire: !s.firedAt || day(s.firedAt) !== day(now), on: true, armed: false };
    return { fire: armed, on: true, armed: false };
  }

  /** Name shown for an alarm's product. @param {{ name?: string, symbol?: string, productId: number }} a */
  const label = a => a.name || a.symbol || `#${a.productId}`;

  /**
   * Display order: product name A-Z (case-insensitive), then price high to low. Copy, never in place; the sort is stable,
   * so equal alarms keep their stored order. `byProduct` false: price only (one product's list).
   * @template {{ name?: string, symbol?: string, productId: number, price: number }} T
   * @param {T[]} list @param {boolean} [byProduct]
   */
  function sorted(list, byProduct = true) {
    return [...list].sort((a, b) => (byProduct
      ? label(a).localeCompare(label(b), undefined, { sensitivity: 'base' }) || String(a.productId).localeCompare(String(b.productId), undefined, { numeric: true })
      : 0) || b.price - a.price);
  }

  const api = Object.freeze({ MAX, MAX_EVENTS, LIMITS, BYTES, sanitize, sanitizeState, sanitizeEvents, direction, reached, day, decide, label, sorted });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
