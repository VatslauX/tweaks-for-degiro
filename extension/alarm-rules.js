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

  /** `at` and `now` fall in the same duplicate window: the same local day for 'daily', else within a minute. @param {{ repeat: string }} a @param {number} at @param {number} now */
  const within = (a, at, now) => (a.repeat === 'daily' ? day(at) === day(now) : Math.abs(now - at) < 60000);

  /**
   * Merge what one check found into freshly read local storage. A firing whose alarm another writer
   * (another tab, the background worker) fired within the window (`foreign`) is dropped: the stored
   * firedAt stays and no event is added. An alarm of `upd` without a kept firing (a price seen, or the dropped
   * firing) changes only `last`/`lastAt` on the stored entry: `upd` holds the writer's copy from before its turn, whose
   * `firedAt` would undo a firing another writer stored meanwhile. Only the state and events of `known` ids are kept.
   * @param {{ state: Record<string, any>, events: any[] }} fresh sanitized stored values
   * @param {Record<string, any>} upd new per-alarm state @param {{ alarmId: string, price: number, at: number }[]} fired
   * @param {any[]} alarms @param {string[]} known
   * @param {(a: any, at: number | undefined, now: number) => boolean} foreign
   */
  function merge(fresh, upd, fired, alarms, known, foreign) {
    /** @type {Record<string, any>} */
    const next = { ...fresh.state };
    let ev = fresh.events;
    for (const [id, st] of Object.entries(upd)) {
      const f = fired.find(x => x.alarmId === id), a = alarms.find(x => x.id === id);
      if (f && !(a && foreign(a, fresh.state[id]?.firedAt, f.at))) {
        next[id] = st;
        ev = [...ev.filter(e => e.alarmId !== id), f];
        continue;
      }
      /** @type {Record<string, number>} */ const seen = {};
      for (const k of ['last', 'lastAt']) if (st?.[k] !== undefined) seen[k] = st[k];
      next[id] = { ...fresh.state[id], ...seen };
    }
    return { state: sanitizeState(next, known), events: sanitizeEvents(ev.filter(e => known.includes(e.alarmId))) };
  }

  // ---------- background check: DEGIRO product → Yahoo Finance ticker ----------
  // DEGIRO's product header names the exchange ("Euronext Amsterdam", "London Stock Exchange (LSE)", "Nasdaq",
  // "Tradegate AG", seen 2026-11-18); its lists show a code (EAM, LSE, NDQ, TDG). Yahoo's ticker is the symbol plus
  // the exchange's suffix. Matched on the lower-cased name without accents, "(…)" and a trailing "AG"; an exchange
  // not listed here is not checked in the background. Yahoo has no Tradegate prices: its products use Xetra's
  // (same symbol, EUR; the link check still compares currency and price with DEGIRO's).
  /** @type {[RegExp, string][]} */
  const EXCHANGES = [
    [/^(euronext )?amsterdam$|^eam$/, '.AS'], [/^(euronext )?paris$|^epa$/, '.PA'], [/^(euronext )?brussel(s|es)?$|^ebr$/, '.BR'],
    [/^(euronext )?lisbo[an]$|^els$/, '.LS'], [/^(euronext )?dublin$|^eid$/, '.IR'],
    [/^(deutsche borse )?xetra$|^xet$|^tradegate( exchange)?$|^tdg$/, '.DE'],
    [/^london stock exchange$|^lse$/, '.L'], [/^borsa italiana$|^(euronext )?milan$|^mil$/, '.MI'],
    [/^bolsa de madrid$|^madrid$|^mad$/, '.MC'], [/^six swiss exchange$|^swx$/, '.SW'],
    [/^((omx|nasdaq) )?stockholm$|^omx$/, '.ST'], [/^(euronext )?oslo( bors)?$|^osl$/, '.OL'],
    [/^((omx|nasdaq) )?copenhagen$|^cse$/, '.CO'], [/^((omx|nasdaq) )?helsinki$|^hel$/, '.HE'],
    [/^wiener borse$|^vienna$|^wbo$/, '.VI'], [/^toronto( stock exchange)?$|^tor$/, '.TO'],
    [/^hong kong( stock exchange)?$|^hks$/, '.HK'],
    [/^nasdaq$|^ndq$|^nyse( arca| american)?$|^new york stock exchange$|^nsy$/, '']
  ];
  /** @param {string} s */
  const plain = s => s.normalize('NFD').replace(/\p{Mn}/gu, '').replace(/[øØ]/g, 'o').toLowerCase()
    .replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().replace(/ ag$/, '');
  /**
   * Yahoo ticker for DEGIRO's symbol and exchange name, or '' when it can't be built.
   * @param {unknown} symbol @param {unknown} exchange
   */
  function yahooTicker(symbol, exchange) {
    if (typeof symbol !== 'string' || typeof exchange !== 'string') return '';
    const sym = symbol.trim().toUpperCase().replace(/\./g, '-');
    if (!/^[A-Z0-9][A-Z0-9-]{0,11}$/.test(sym)) return '';
    const ex = plain(exchange), hit = EXCHANGES.find(([re]) => re.test(ex));
    if (!hit) return '';
    // Hong Kong: Yahoo writes the stock number with four digits (700 → 0700.HK)
    return (hit[1] === '.HK' && /^\d{1,4}$/.test(sym) ? sym.padStart(4, '0') : sym) + hit[1];
  }

  // DEGIRO's currency sign (as alarms store it) → ISO code; 'GBX' is pence
  /** @type {Record<string, string>} */
  const SIGNS = { '€': 'EUR', 'EUR': 'EUR', '$': 'USD', 'USD': 'USD', '£': 'GBP', 'GBP': 'GBP', 'GBX': 'GBX', 'GBp': 'GBX',
    'CHF': 'CHF', 'Fr': 'CHF', 'SEK': 'SEK', 'NOK': 'NOK', 'DKK': 'DKK', 'CAD': 'CAD', 'C$': 'CAD', 'CA$': 'CAD',
    'HKD': 'HKD', 'HK$': 'HKD', 'PLN': 'PLN', 'zł': 'PLN' };
  /**
   * What Yahoo's price is multiplied by to be in DEGIRO's currency, or 0 when the currencies differ.
   * @param {unknown} sign DEGIRO's currency sign @param {unknown} yahoo Yahoo's `meta.currency` (e.g. 'EUR', 'GBp')
   */
  function priceFactor(sign, yahoo) {
    const d = typeof sign === 'string' ? SIGNS[sign] : undefined;
    const y = yahoo === 'GBp' ? 'GBX' : typeof yahoo === 'string' ? yahoo.toUpperCase() : '';
    if (!d || !y) return 0;
    if (d === y) return 1;
    if (d === 'GBP' && y === 'GBX') return 0.01;
    if (d === 'GBX' && y === 'GBP') return 100;
    return 0;
  }

  const TICKER = /^[A-Z0-9][A-Z0-9-]{0,11}(\.[A-Z]{1,3})?$/;
  const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
  /**
   * "AVGO | US11135F1012" (DEGIRO's Symbol | ISIN), or the ISIN alone (products without a symbol, such as Société
   * Générale's) → its ISIN, or '' @param {unknown} s
   */
  const isinOf = s => { const m = typeof s === 'string' ? (s.includes('|') ? s.split('|')[1] : s).trim().toUpperCase() : ''; return m && ISIN.test(m) ? m : ''; };

  // DEGIRO's product info service (/product_search/secure/v5/products/info, seen 2026-11-18) gives `exchangeId` as a
  // number; these are the codes its Favourites lists show for them (seen live). An id not listed links by ISIN alone.
  /** @type {Record<string, string>} */
  const EXCHANGE_IDS = { 663: 'NDQ', 676: 'NSY', 196: 'TDG', 200: 'EAM', 710: 'EPA', 570: 'LSE', 454: 'HKS', 192: 'SCG' };
  // its currency is an ISO code; links store the sign the Favourites list and product header show, so a link from
  // the product details and one from the page are the same (else each source would rewrite the other's)
  /** @type {Record<string, string>} */
  const SIGN_OF = { EUR: '€', USD: '$', GBP: '£' };
  /**
   * DEGIRO's product info answer (`{ data: { "<id>": { symbol, isin, currency, exchangeId, … } } }`) →
   * what S.link takes, for the asked products only. A product without a currency is left out.
   * @param {unknown} body @param {number[]} ids
   * @returns {{ id: number, symbol: string, exchange: string, currency: string, isin: string }[]}
   */
  function parseInfo(body, ids) {
    const data = /** @type {any} */ (body)?.data;
    /** @type {{ id: number, symbol: string, exchange: string, currency: string, isin: string }[]} */
    const out = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
    for (const id of ids) {
      const p = Object.prototype.hasOwnProperty.call(data, String(id)) ? data[String(id)] : null;
      if (!p || typeof p !== 'object') continue;
      const iso = typeof p.currency === 'string' && /^[A-Z]{3}$/.test(p.currency) ? p.currency : '';
      if (!iso) continue;
      out.push({
        id,
        symbol: typeof p.symbol === 'string' ? p.symbol.trim().slice(0, 20) : '',
        exchange: Object.prototype.hasOwnProperty.call(EXCHANGE_IDS, String(p.exchangeId)) ? EXCHANGE_IDS[String(p.exchangeId)] : '',
        currency: SIGN_OF[iso] || iso,
        isin: typeof p.isin === 'string' && ISIN.test(p.isin) ? p.isin : ''
      });
    }
    return out;
  }
  /**
   * Products seen in DEGIRO that can't be linked (chrome.storage.local 'dgNoTicker'): productId → DEGIRO's exchange
   * name or code, or '*' when it names none (no Yahoo ticker for it, and no ISIN known), shown on the Alarms page.
   * With `ids`, only those products.
   * @param {unknown} s @param {number[]} [ids] @returns {Record<string, string>}
   */
  function sanitizeNoTicker(s, ids) {
    /** @type {Record<string, string>} */
    const out = {};
    if (!s || typeof s !== 'object' || Array.isArray(s)) return out;
    for (const [k, v] of Object.entries(s)) {
      const id = Number(k);
      if (Object.keys(out).length === MAX || !Number.isSafeInteger(id) || id <= 0 || id >= 1e10 || String(id) !== k) continue;
      if (ids && !ids.includes(id)) continue;
      const ex = typeof v === 'string' ? [...v.replace(/\s+/g, ' ')].filter(c => c >= ' ').join('').trim().slice(0, 40) : '';
      if (ex && ex !== 'SCG') out[k] = ex; // Société Générale's products are linked (1.24.0): an old note goes
    }
    return out;
  }
  /**
   * Stored links (chrome.storage.sync 'dgTickers'): productId → { t: Yahoo ticker from symbol + exchange ('' when the
   * exchange has none), cur: DEGIRO's currency sign, isin?: the product's ISIN, for the fallback search, v?: 'sg' for
   * Société Générale's own products, priced by SG }.
   * A link needs a ticker or an ISIN. With `ids`, only those products' links are kept.
   * @param {unknown} s @param {number[]} [ids] @returns {Record<string, { t: string, cur: string, isin?: string, v?: 'sg' }>}
   */
  function sanitizeTickers(s, ids) {
    /** @type {Record<string, { t: string, cur: string, isin?: string, v?: 'sg' }>} */
    const out = {};
    if (!s || typeof s !== 'object' || Array.isArray(s)) return out;
    for (const [k, v] of Object.entries(s)) {
      const id = Number(k);
      if (Object.keys(out).length === MAX || !Number.isSafeInteger(id) || id <= 0 || id >= 1e10 || String(id) !== k) continue;
      if (ids && !ids.includes(id)) continue;
      if (!v || typeof v !== 'object') continue;
      const t = typeof v.t === 'string' && TICKER.test(v.t) ? v.t : '', isin = typeof v.isin === 'string' && ISIN.test(v.isin) ? v.isin : '';
      if (!t && !isin) continue;
      // Société Générale's own products (DEGIRO's SCG venue): priced by SG, found by ISIN, no Yahoo ticker
      const sg = v.v === 'sg' && !!isin;
      out[k] = { t: sg ? '' : t, cur: text(v.cur, LIMITS.currency, BYTES.currency), ...(isin ? { isin } : {}), ...(sg ? { v: 'sg' } : {}) };
    }
    return out;
  }
  /**
   * The key of a link's check in 'dgTickerCheck': a changed ticker, currency, ISIN or venue is checked anew.
   * @param {{ t: string, cur: string, isin?: string, v?: string }} l
   */
  const linkKey = l => `${l.t}|${l.cur}|${l.isin || ''}${l.v === 'sg' ? '|sg' : ''}`;

  // ---------- Société Générale (sgbeurs.nl): the live quotes of SG's own products, seen 2026-11-18 ----------
  // DEGIRO trades them on its SCG venue (exchange id 192). SG's site answers ValuesForWatchlist/<ISIN> with the
  // product's SG id and underlying, and RealtimeValuesSnapshot/<id>?<all six fields> with its bid and ask. Its
  // firewall refuses a request with any field missing, so the fields go exactly as SG's own page sends them.
  /** DEGIRO's exchange code or name for SG's venue @param {unknown} exchange */
  const isSgVenue = exchange => typeof exchange === 'string' && /^scg$|^societe generale|^sg direct$/.test(plain(exchange));
  // the site writes a missing field as "null" (its `${value}`), and so must we
  /** @param {unknown} v @param {RegExp} re */
  const sgField = (v, re) => { const s = v === null || v === undefined ? 'null' : String(v); return s === 'null' || re.test(s) ? s : ''; };
  const SG_FIELDS = { id: /^\d{1,10}$/, pc: /^[A-Z]{2,8}$/, aid: /^\d{1,10}$/, an: /^[A-Za-z0-9_+.&-]{1,40}$/, ar: /^[A-Za-z0-9_.=-]{1,24}$/, ac: /^[A-Z]{2,8}$/ };
  /**
   * SG's ValuesForWatchlist answer → what the price request needs, or null when anything is off.
   * @param {unknown} body
   * @returns {{ id: string, pc: string, aid: string, an: string, ar: string, ac: string, cur: string, code: string } | null}
   */
  function parseSgMeta(body) {
    const b = /** @type {any} */ (body);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
    const m = { id: sgField(b.Id, SG_FIELDS.id), pc: sgField(b.ExchangeCode, SG_FIELDS.pc), aid: sgField(b.AssetId, SG_FIELDS.aid),
      an: sgField(b.AssetNMP, SG_FIELDS.an), ar: sgField(b.AssetRic, SG_FIELDS.ar), ac: sgField(b.AssetNMPExchangeCode, SG_FIELDS.ac) };
    if (Object.values(m).some(v => !v) || m.id === 'null' || m.pc === 'null') return null;
    const cur = typeof b.Currency === 'string' && /^[A-Z]{3}$/.test(b.Currency) ? b.Currency : '';
    if (!cur) return null;
    const code = typeof b.Code === 'string' && TICKER.test(b.Code) ? b.Code : '';
    return { ...m, cur, code };
  }
  /** a stored SG meta (dgTickerCheck), checked again: it goes into a URL @param {any} m */
  const validSgMeta = m => !!m && typeof m === 'object' && Object.entries(SG_FIELDS).every(([k, re]) => typeof m[k] === 'string' && sgField(m[k], re) === m[k])
    && m.id !== 'null' && m.pc !== 'null' && typeof m.cur === 'string' && /^[A-Z]{3}$/.test(m.cur) && typeof m.code === 'string' && (!m.code || TICKER.test(m.code));
  /**
   * The price request for an SG product: SG's own path, with every field in the order its page sends them.
   * @param {string} isin @param {{ id: string, pc: string, aid: string, an: string, ar: string, ac: string }} m
   */
  const sgSnapshotPath = (isin, m) => `/EmcWebApi/api/Products/RealtimeValuesSnapshot/${m.id}?${new URLSearchParams({
    productIsin: isin, productExchangeCode: m.pc, assetId: m.aid, assetNmp: m.an, assetRic: m.ar, assetExchangeCode: m.ac })}`;
  /** SG's bid (what DEGIRO shows as the last price of SG's products), or 0 @param {unknown} body */
  const parseSgBid = body => { const b = /** @type {any} */ (body)?.ProductBid; return pos(b) && b < 1e9 ? b : 0; };
  /**
   * When each SG product's bid last changed (chrome.storage.local 'dgSgSeen'): ISIN → { b, at }. SG's answer has no
   * time; a bid that didn't change keeps its time, so a closed market's bid never fires again (after a restart too).
   * @param {unknown} s @param {string[]} [isins] @returns {Record<string, { b: number, at: number }>}
   */
  function sanitizeSgSeen(s, isins) {
    /** @type {Record<string, { b: number, at: number }>} */
    const out = {};
    if (!s || typeof s !== 'object' || Array.isArray(s)) return out;
    for (const [k, v] of Object.entries(s)) {
      if (Object.keys(out).length === MAX || !ISIN.test(k) || (isins && !isins.includes(k)) || !v || typeof v !== 'object') continue;
      if (pos(v.b) && v.b < 1e9 && pos(v.at)) out[k] = { b: v.b, at: v.at };
    }
    return out;
  }

  /** Yahoo tickers from its v1 search answer for an ISIN, best first (at most 3). @param {unknown} body */
  function parseSearch(body) {
    const quotes = body && typeof body === 'object' && Array.isArray(/** @type {any} */ (body).quotes) ? /** @type {any} */ (body).quotes : [];
    return [...new Set(quotes.map(q => q?.symbol).filter(s => typeof s === 'string' && TICKER.test(s)))].slice(0, 3);
  }

  /**
   * Does Yahoo's listing match the DEGIRO product? The currency must match (pence and pounds convert) and Yahoo's price,
   * in DEGIRO's currency, must lie within 0.5–2× DEGIRO's last price (`last`), or 0.2–5× the alarm price when no
   * DEGIRO price was ever seen. A mismatch says why: 'missing' (Yahoo has no such ticker, or no price for it),
   * 'currency' (another currency) or 'price' (another price: another listing or product).
   * @param {any} meta Yahoo's chart `meta` @param {string} cur DEGIRO's currency sign @param {number | undefined} last @param {number} alarmPrice
   * @returns {{ ok: boolean, f: number, why?: 'missing' | 'currency' | 'price' }}
   */
  function checkLink(meta, cur, last, alarmPrice) {
    const p = meta?.regularMarketPrice;
    if (!meta || !pos(p)) return { ok: false, f: 0, why: 'missing' };
    const f = priceFactor(cur, meta.currency);
    if (!f) return { ok: false, f: 0, why: 'currency' };
    const v = p * f, [ref, lo, hi] = pos(last) ? [last, 0.5, 2] : [alarmPrice, 0.2, 5];
    return pos(ref) && v >= ref * lo && v <= ref * hi ? { ok: true, f } : { ok: false, f: 0, why: 'price' };
  }

  const WHY = ['missing', 'currency', 'price'];
  /**
   * Checked links (chrome.storage.local 'dgTickerCheck'): linkKey → { ok, f, at, y, via?, why? }. `y` is the Yahoo
   * ticker that is priced: the link's own, or (`via: 'isin'`) one Yahoo's ISIN search found. With `keys`, only those
   * are kept.
   * @param {unknown} s @param {string[]} [keys]
   * @returns {Record<string, { ok: boolean, f: number, at: number, y?: string, via?: 'isin', why?: string, sg?: any }>}
   */
  function sanitizeChecks(s, keys) {
    /** @type {Record<string, { ok: boolean, f: number, at: number, y?: string, via?: 'isin', why?: string, sg?: any }>} */
    const out = {};
    if (!s || typeof s !== 'object' || Array.isArray(s)) return out;
    for (const [k, v] of Object.entries(s)) {
      if (Object.keys(out).length === MAX || (keys && !keys.includes(k)) || !v || typeof v !== 'object') continue;
      const [t, cur, isin, venue, extra] = k.split('|');
      if (extra !== undefined || isin === undefined || (t && !TICKER.test(t)) || (isin && !ISIN.test(isin)) || (!t && !isin)) continue;
      const sg = venue === 'sg';
      if (venue !== undefined && (!sg || t || !isin)) continue;
      if (text(cur, LIMITS.currency, BYTES.currency) !== cur) continue;
      if (typeof v.ok !== 'boolean' || !pos(v.at)) continue;
      if (v.ok) {
        if (![1, 0.01, 100].includes(v.f) || typeof v.y !== 'string' || !(TICKER.test(v.y) || (sg && v.y === isin))) continue;
        // an SG link is priced by SG: its request's fields are kept, and checked again here
        if (sg) { if (validSgMeta(v.sg)) out[k] = { ok: true, f: v.f, at: v.at, y: v.y, sg: { ...v.sg } }; continue; }
        out[k] = { ok: true, f: v.f, at: v.at, y: v.y, ...(v.via === 'isin' ? { via: 'isin' } : {}) };
      } else out[k] = { ok: false, f: 0, at: v.at, ...(WHY.includes(v.why) ? { why: v.why } : {}) };
    }
    return out;
  }

  /**
   * Last price and its time (ms) per ticker from Yahoo's v8 spark answer at 5-minute bars, where the last bar's time
   * is the last trade's (a daily bar's time is the session's open). The last bar with a price counts: a bar with
   * no trade yet has `null`. Tickers without a usable price are left out.
   * @param {unknown} body @returns {Map<string, { price: number, at: number }>}
   */
  function parseSpark(body) {
    /** @type {Map<string, { price: number, at: number }>} */
    const out = new Map();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return out;
    for (const [t, v] of Object.entries(body)) {
      if (!TICKER.test(t) || !v || typeof v !== 'object') continue;
      const close = Array.isArray(v.close) ? v.close : [], times = Array.isArray(v.timestamp) ? v.timestamp : [];
      for (let i = Math.min(close.length, times.length) - 1; i >= 0; i--) {
        const price = close[i], at = times[i];
        if (!pos(price) || price >= 1e9) continue;
        if (pos(at)) out.set(t, { price, at: at * 1000 });
        break;
      }
    }
    return out;
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

  const api = Object.freeze({ MAX, MAX_EVENTS, LIMITS, BYTES, sanitize, sanitizeState, sanitizeEvents, direction, reached, day, within, merge, decide, label, sorted,
    yahooTicker, isinOf, parseInfo, priceFactor, sanitizeTickers, sanitizeNoTicker, linkKey, parseSearch, checkLink, sanitizeChecks, parseSpark,
    isSgVenue, parseSgMeta, sgSnapshotPath, parseSgBid, sanitizeSgSeen });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
