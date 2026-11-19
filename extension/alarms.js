// Price alarms: the stored alarms, detection and the banner. Prices come only from what DEGIRO
// already shows (Favourites rows, the product page); nothing is requested. Rules: alarm-rules.js.
// Alarms live in chrome.storage.sync ('dgAlarms'). Per-alarm state and the fired alarms waiting
// to be closed change too often for sync: chrome.storage.local ('dgAlarmState', 'dgAlarmEvents').
const dgAlarmStore = (() => {
  const R = dgAlarmRules;
  /** @type {any[]} */ let alarms = [];
  /** @type {Record<string, any>} */ let state = {};
  /** @type {any[]} */ let events = [];
  /** @type {Map<number, number>} */ let live = new Map();
  /** products with a row in the list, priced or not (market closed: the price shows a dash) @type {Set<number>} */ let listed = new Set();
  // background check (background.js): product → Yahoo ticker links (sync), and which links Yahoo confirmed (local)
  /** @type {Record<string, { t: string, cur: string, isin?: string, v?: 'sg' }>} */ let tickers = {};
  /** @type {Record<string, { ok: boolean, f: number, at: number, y?: string, via?: 'isin', why?: string, sg?: any }>} */ let checks = {};
  /** when the background check last ran fine in this browser (its status), 0 if never or its last try failed @type {number} */ let bgAt = 0;
  /** products seen with no Yahoo ticker and no ISIN: their exchange (local) @type {Record<string, string>} */ let noTicker = {};
  /** @param {any} s */ const bgTime = s => (s && typeof s === 'object' && Number.isFinite(s.at) && s.at > 0 && !s.err ? s.at : 0);
  /** @type {(() => void)[]} */ const listeners = [];
  const changed = () => listeners.forEach(fn => { try { fn(); } catch (e) {} });
  let syncLoaded = false, localLoaded = false, tickersLoaded = false, checksLoaded = false;
  /** firedAt values this tab wrote: any other stored firedAt belongs to another tab @type {Set<number>} */
  const mine = new Set();
  const reload = () => {
    try { chrome.storage.sync.get({ dgAlarms: [] }, r => { alarms = R.sanitize(r?.dgAlarms); syncLoaded = true; changed(); }); } catch (e) {}
  };
  // another tab fired this alarm within the window (a minute, or today for 'daily'): this tab must not fire it too
  /** @param {any} a @param {number | undefined} at @param {number} now */
  const foreignWithin = (a, at, now) => !!at && !mine.has(at) && R.within(a, at, now);

  try {
    reload();
    chrome.storage.local.get({ dgAlarmState: {}, dgAlarmEvents: [] }, r => {
      state = R.sanitizeState(r?.dgAlarmState); events = R.sanitizeEvents(r?.dgAlarmEvents); localLoaded = true; changed();
    });
    chrome.storage.sync.get({ dgTickers: {} }, r => { tickers = R.sanitizeTickers(r?.dgTickers); tickersLoaded = true; changed(); });
    chrome.storage.local.get({ dgTickerCheck: {}, dgBgStatus: null, dgNoTicker: {} }, r => {
      checks = R.sanitizeChecks(r?.dgTickerCheck); bgAt = bgTime(r?.dgBgStatus); noTicker = R.sanitizeNoTicker(r?.dgNoTicker); checksLoaded = true; changed();
    });
    chrome.storage.onChanged.addListener((c, area) => {
      let hit = false;
      if (area === 'sync' && c.dgAlarms) { alarms = R.sanitize(c.dgAlarms.newValue); hit = true; }
      if (area === 'sync' && c.dgTickers) {
        tickers = R.sanitizeTickers(c.dgTickers.newValue);
        // another writer (tab, computer) dropped a product's link, or it went with its alarms: link it again when seen.
        // A link that merely differs is left alone, or two sources would rewrite each other's for ever.
        for (const k of [...linkedKeys]) if (!tickers[k.split('|')[0]]) linkedKeys.delete(k);
        hit = true;
      }
      if (area === 'local' && c.dgAlarmState) { state = R.sanitizeState(c.dgAlarmState.newValue); hit = true; }
      if (area === 'local' && c.dgAlarmEvents) { events = R.sanitizeEvents(c.dgAlarmEvents.newValue); hit = true; }
      if (area === 'local' && c.dgTickerCheck) { checks = R.sanitizeChecks(c.dgTickerCheck.newValue); hit = true; }
      if (area === 'local' && c.dgBgStatus) { bgAt = bgTime(c.dgBgStatus.newValue); hit = true; }
      if (area === 'local' && c.dgNoTicker) { noTicker = R.sanitizeNoTicker(c.dgNoTicker.newValue); hit = true; }
      if (hit) changed();
    });
  } catch (e) {}

  // every writer of local storage runs one after the other: each reads the stored values, merges its own
  // change and writes back, so overlapping calls would lose each other's updates
  let queue = Promise.resolve();
  /** @param {() => Promise<any>} fn */
  const serial = fn => (queue = queue.then(fn, fn));

  /** ids of the alarms in storage (this tab's list if storage refuses) */
  async function storedIds() {
    try { return R.sanitize((await chrome.storage.sync.get({ dgAlarms: [] }))?.dgAlarms).map(a => a.id); } catch (e) { return alarms.map(a => a.id); }
  }
  // events of alarms that no longer exist go (nothing would ever close them)
  const dropOrphans = () => serial(async () => {
    try {
      const ids = await storedIds();
      const r = await chrome.storage.local.get({ dgAlarmEvents: [] });
      const all = R.sanitizeEvents(r?.dgAlarmEvents), ev = all.filter(e => ids.includes(e.alarmId));
      if (ev.length === all.length) return;
      events = ev;
      changed();
      await chrome.storage.local.set({ dgAlarmEvents: ev });
    } catch (e) {}
  });

  // the list is shown changed at once; if storage refuses, it comes back from storage
  /** @param {any[]} list */
  async function saveAlarms(list) {
    alarms = R.sanitize(list);
    changed();
    try { await chrome.storage.sync.set({ dgAlarms: alarms }); } catch (e) { reload(); return false; }
    dropOrphans(); // not awaited: record() calls this from inside the queue
    return true;
  }
  /** @param {any} a @returns {Promise<'ok' | 'full' | 'error'>} */
  async function add(a) {
    if (alarms.length >= R.MAX) return 'full';
    return (await saveAlarms([...alarms, a])) ? 'ok' : 'error';
  }
  /** @param {string} id @param {boolean} on */
  const setOn = (id, on) => saveAlarms(alarms.map(a => (a.id === id ? { ...a, on } : a)));
  /** @param {string} id */
  const remove = id => saveAlarms(alarms.filter(a => a.id !== id));

  /**
   * Change an alarm's price, direction and repeat in place (same id and position), switch it on and let it
   * fire again: its fired time and open banner go, `last`/`lastAt` stay. Runs in the queue, like `record`.
   * @param {string} id @param {{ price: number, dir: string, repeat: string }} patch @returns {Promise<'ok' | 'gone' | 'error'>}
   */
  const update = (id, patch) => serial(async () => {
    try {
      let base = alarms;
      try { base = R.sanitize((await chrome.storage.sync.get({ dgAlarms: [] }))?.dgAlarms); } catch (e) {}
      const old = base.find(a => a.id === id);
      if (!old) return 'gone';
      const [next] = R.sanitize([{ ...old, price: patch.price, dir: patch.dir, repeat: patch.repeat, on: true }]);
      if (!next) return 'error';
      if (!(await saveAlarms(base.map(a => (a.id === id ? next : a))))) return 'error';
      // saved: the rest is best effort (like closeEvent), a failing local write must not report an error
      try {
        if (state[id]) { const rest = { ...state[id] }; delete rest.firedAt; state = { ...state, [id]: rest }; }
        events = events.filter(e => e.alarmId !== id);
        changed();
        const r = await chrome.storage.local.get({ dgAlarmState: {}, dgAlarmEvents: [] });
        const st = R.sanitizeState(r?.dgAlarmState);
        if (st[id]) delete st[id].firedAt;
        await chrome.storage.local.set({ dgAlarmState: st, dgAlarmEvents: R.sanitizeEvents(r?.dgAlarmEvents).filter(e => e.alarmId !== id) });
      } catch (e) {}
      return 'ok';
    } catch (e) { return 'error'; }
  });

  /** @param {string} alarmId */
  function closeEvent(alarmId) {
    events = events.filter(e => e.alarmId !== alarmId);
    changed();
    // remove only this event from the stored ones: another tab may have added others meanwhile
    serial(async () => {
      try {
        const r = await chrome.storage.local.get({ dgAlarmEvents: [] });
        await chrome.storage.local.set({ dgAlarmEvents: R.sanitizeEvents(r?.dgAlarmEvents).filter(e => e.alarmId !== alarmId) });
      } catch (e) {}
    });
  }

  /**
   * Store what a check found: new per-alarm state (`last`, `firedAt`), the alarms that fired, 'once'
   * alarms to switch off. Applied here at once (the next check, a frame later, must see it), then
   * written. Another DEGIRO tab may have fired the same alarm a moment earlier (a minute, or the same
   * day for 'daily'): its firing wins and this one is dropped. `armed` is never stored.
   * @param {Record<string, any>} upd @param {{ alarmId: string, price: number, at: number }[]} fired @param {string[]} off
   */
  function record(upd, fired, off) {
    fired.forEach(f => mine.add(f.at));
    state = { ...state, ...upd };
    if (off.length) alarms = alarms.map(a => (off.includes(a.id) ? { ...a, on: false } : a));
    changed();
    return serial(async () => {
      try {
        const [r, ids] = await Promise.all([chrome.storage.local.get({ dgAlarmState: {}, dgAlarmEvents: [] }), storedIds()]);
        // its alarms are gone meanwhile (deleted, or "Clear saved data"): nothing to store, nor to switch off
        if (!Object.keys(upd).some(id => ids.includes(id))) return;
        const known = [...new Set([...alarms.map(a => a.id), ...ids])]; // this tab's list and the stored one
        ({ state, events } = R.merge({ state: R.sanitizeState(r?.dgAlarmState), events: R.sanitizeEvents(r?.dgAlarmEvents) },
          upd, fired, alarms, known, foreignWithin));
        changed();
        await chrome.storage.local.set({ dgAlarmState: state, dgAlarmEvents: events });
      } catch (e) {}
      if (off.length) {
        // switch off on the stored list, so alarms another tab added or changed meanwhile are kept
        let base = alarms;
        try { base = R.sanitize((await chrome.storage.sync.get({ dgAlarms: [] }))?.dgAlarms); } catch (e) {}
        await saveAlarms(base.map(a => (off.includes(a.id) ? { ...a, on: false } : a)));
      }
    });
  }

  /** links this tab stored or found stored, so the Favourites list (read every run) costs no storage reads @type {Set<string>} */
  const linkedKeys = new Set();
  /**
   * Remember (local) that a product was seen but can't be linked, with its exchange ('*' when DEGIRO names none), or
   * forget it once linked; so the Alarms page can say why. Runs inside `serial`.
   * @param {number} id @param {string} ex '' to forget @param {number[]} pids
   */
  const noteNoTicker = async (id, ex, pids) => {
    const stored = R.sanitizeNoTicker((await chrome.storage.local.get({ dgNoTicker: {} }))?.dgNoTicker, pids);
    if ((stored[id] || '') === ex) return;
    if (ex) stored[id] = ex; else delete stored[id];
    await chrome.storage.local.set({ dgNoTicker: R.sanitizeNoTicker(stored, pids) });
  };
  /**
   * Link a product with alarms to its Yahoo ticker, from DEGIRO's symbol, exchange name and currency sign (for the
   * background check, which confirms it against Yahoo). Written only when it changes; links of products without
   * alarms go. A product whose exchange has no Yahoo ticker and no ISIN is not linked, but noted (`dgNoTicker`).
   * The ISIN (Favourites list, DEGIRO's product details) is kept for the worker's fallback search when the ticker
   * doesn't fit. Société Générale's own products (DEGIRO's SCG venue) are linked by ISIN to SG's prices (`v: 'sg'`).
   * `fill`: write only when the product has no link yet (DEGIRO's product details), or replaces an ISIN-only link of
   * an SG product (written before SG was supported).
   * @param {{ id: number, symbol: string, exchange?: string, currency: string, isin?: string, fill?: boolean }} h
   */
  const link = h => {
    const sg = R.isSgVenue(h.exchange || '');
    // SG's product header shows the ISIN where a symbol would be ("DE000SU054L9 • Societe Generale OTC", 2026-11-18)
    const t = sg ? '' : R.yahooTicker(h.symbol, h.exchange || ''), cur = h.currency, isin = h.isin || (sg ? R.isinOf(h.symbol) : '');
    const key = `${h.id}|${t}|${cur}|${isin}${sg ? '|sg' : ''}`;
    if (!cur || linkedKeys.has(key)) return Promise.resolve();
    linkedKeys.add(key);
    return serial(async () => {
      try {
        const pids = R.sanitize((await chrome.storage.sync.get({ dgAlarms: [] }))?.dgAlarms).map(a => a.productId);
        if (!pids.includes(h.id)) { linkedKeys.delete(key); return; } // no alarm (yet): try again later
        const stored = R.sanitizeTickers((await chrome.storage.sync.get({ dgTickers: {} }))?.dgTickers);
        const old = stored[h.id];
        // DEGIRO's product details only fill a gap: a link from the list or the page (what the user sees) stays
        if (h.fill && old && !(sg && old.v !== 'sg')) return;
        // the product header has no ISIN: a link from the Favourites list keeps its ISIN
        const keepIsin = isin || old?.isin || ''; // the ISIN belongs to the product, whatever the ticker
        if (!t && !keepIsin) {
          // seen, but nothing to look up (its exchange has no Yahoo ticker, no ISIN): say so, unless it's linked
          // already. Only a source that shows ISINs can tell; the product header has none
          if (!old && h.isin !== undefined) await noteNoTicker(h.id, (h.exchange || '').trim() || '*', pids);
          return;
        }
        // a source that can't tell SG's venue (no Yahoo ticker either) leaves an SG link alone
        if (old?.v === 'sg' && !sg && !t) return;
        if (noTicker[h.id]) await noteNoTicker(h.id, '', pids);
        const v = sg ? 'sg' : undefined;
        if (old && old.t === t && old.cur === cur && (old.isin || '') === keepIsin && old.v === v) return;
        const next = R.sanitizeTickers({ ...stored, [h.id]: { t, cur, ...(keepIsin ? { isin: keepIsin } : {}), ...(v ? { v } : {}) } }, pids);
        if (next[h.id]) await chrome.storage.sync.set({ dgTickers: next });
        else linkedKeys.delete(key);
      } catch (e) { linkedKeys.delete(key); }
    });
  };

  return Object.freeze({
    ready: () => syncLoaded && localLoaded, foreign: foreignWithin,
    /**
     * Where this product stands with the background check, and what to name it by (`t`: the Yahoo ticker that is
     * priced, else the link's ticker, else its ISIN; '' when unlinked):
     * 'ok' (Yahoo confirmed it: checked in the background; `via: 'isin'` when its ISIN search found the ticker, `via: 'sg'`
     * for Société Générale's products, priced by SG),
     * 'failed' (Yahoo didn't: `why` is 'missing', 'currency' or 'price'), 'pending' (linked, Yahoo not asked yet, and
     * the check ran fine in this browser in the last 5 minutes), 'idle' (linked, but the check isn't running here:
     * e.g. no permissions on this computer), 'noticker' (seen, but its exchange has no Yahoo ticker and no ISIN is
     * known: `t` is DEGIRO's exchange), or 'unlinked' (not seen yet: not in a Favourites list on screen, its page not
     * opened, since its alarm was set).
     * @param {number} pid @returns {{ state: 'ok' | 'failed' | 'pending' | 'idle' | 'noticker' | 'unlinked', t: string, why?: string, via?: 'isin' | 'sg', sg?: boolean }}
     */
    background: pid => {
      const l = tickers[pid];
      if (!l) return noTicker[pid] ? { state: 'noticker', t: noTicker[pid] } : { state: 'unlinked', t: '' };
      const name = l.t || l.isin || '', c = checks[R.linkKey(l)], sg = l.v === 'sg' ? { sg: true } : {};
      if (c) return c.ok ? { state: 'ok', t: c.y || name, ...(c.sg ? { via: 'sg' } : c.via ? { via: c.via } : {}) } : { state: 'failed', t: name, why: c.why || 'missing', ...sg };
      return { state: Date.now() - bgAt < 5 * 60000 ? 'pending' : 'idle', t: name, ...sg };
    },
    link,
    /** the links and the products without a ticker are loaded: `known` can be trusted */
    linksReady: () => tickersLoaded && checksLoaded,
    /**
     * Nothing to ask DEGIRO about: linked to a Yahoo ticker or to SG's venue, or known to have no Yahoo ticker. An
     * ISIN-only link (no ticker, no venue; an earlier build linked SG's products so) is not: DEGIRO may name SG's venue
     * @param {number} pid
     */
    known: pid => { const l = tickers[pid]; return l ? !!l.t || l.v === 'sg' : !!noTicker[pid]; },
    list: () => alarms, state: () => state, events: () => events, live: () => live, listed: () => listed,
    /** @param {Map<number, number>} m @param {Set<number>} [ids] */ setLive: (m, ids) => { live = m; listed = ids || new Set(m.keys()); },
    /** @param {() => void} fn */ onChange: fn => { listeners.push(fn); },
    add, setOn, remove, update, closeEvent, record
  });
})();

(() => {
  const { SEL, page, own, feature, t, parseNum, fmt, schedule } = __dgt; // common.js
  const R = dgAlarmRules, S = dgAlarmStore;
  const ALARMS_HREF = '#/favourites?dg=alarms';
  const BOX = 'data-dg-alarm-banners';
  const SEEN_EVERY = 60000; // `last` price written at most once a minute per alarm

  // prices DEGIRO shows on this page: productId → price (Favourites rows, or this product's own)
  /** @param {Set<number>} [present] filled with every product that has an element, priced or not */
  function readPrices(present) {
    /** @type {Map<number, number>} */
    const out = new Map();
    /** @type {Element[]} */
    let els = [];
    const only = page.isProduct() ? page.productId() : 0;
    if (page.isFavourites()) els = [...document.querySelectorAll(SEL.lastPrice)];
    else if (only) els = [...document.querySelectorAll(SEL.currentPrice)].filter(e => !e.closest(SEL.measurer));
    for (const el of els) {
      const id = Number(el.getAttribute('data-id'));
      if (!Number.isSafeInteger(id) || id <= 0 || (only && id !== only) || out.has(id)) continue;
      present?.add(id);
      const v = parseNum(el.getAttribute('title') || el.textContent || '');
      if (Number.isFinite(v) && v > 0) out.set(id, v);
    }
    return out;
  }

  // `armed` ('every time' alarms) is this tab's own memory and never stored: tabs would re-arm each other
  // keyed by the alarm's price, direction and repeat too: an edited alarm starts fresh, in every tab
  /** @type {Map<string, { sig: string, armed: boolean }>} */
  const armedMap = new Map();

  /** @param {Map<number, number>} prices */
  function check(prices) {
    const now = Date.now(), all = S.state();
    /** @type {Record<string, any>} */ const upd = {};
    const fired = [], off = [];
    for (const a of S.list()) {
      const price = prices.get(a.productId);
      if (price == null) continue;
      const st = all[a.id] || {};
      const next = { ...st };
      // first sight of an 'every time' alarm already past its price after it fired: stay quiet until it crosses back
      const sig = `${a.price}|${a.dir}|${a.repeat}`, mem = armedMap.get(a.id);
      const armed = mem && mem.sig === sig ? mem.armed : !(R.reached(a, price) && st.firedAt);
      if (!st.lastAt || now - st.lastAt >= SEEN_EVERY) { next.last = price; next.lastAt = now; }
      if (a.on) {
        const d = R.decide(a, { ...st, armed }, price, now);
        armedMap.set(a.id, { sig, armed: d.armed });
        if (d.fire && S.foreign(a, st.firedAt, now)) d.fire = false; // another tab fired it just now
        if (d.fire) {
          Object.assign(next, { firedAt: now, last: price, lastAt: now });
          fired.push({ alarmId: a.id, price, at: now });
          if (!d.on) off.push(a.id);
        }
      }
      if (JSON.stringify(next) !== JSON.stringify(st)) upd[a.id] = next;
    }
    if (Object.keys(upd).length) S.record(upd, fired, off);
  }

  // ---------- banner ----------
  /** @param {any} a @param {number} n */
  const money = (a, n) => `${a.currency} ${fmt(n, 2, 4)}`.trim();
  /** @param {number} ms */
  const time = ms => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  /** @param {any} a */
  const after = a => a.repeat === 'once' ? t('bannerOnceOff') : a.repeat === 'daily' ? t('bannerDaily')
    : t(a.dir === 'above' ? 'bannerEachAbove' : 'bannerEachBelow', money(a, a.price));

  /** @param {string} text @param {string} href */
  function link(text, href) {
    const l = document.createElement('a');
    l.href = href;
    l.textContent = text;
    l.style.cssText = `color:${dgUi.BLUE};font-weight:600;font-size:13px;text-decoration:none;white-space:nowrap;`;
    return l;
  }

  /** @param {{ alarmId: string, price: number, at: number }} e @param {any} a @param {ReturnType<typeof dgUi.theme>} th */
  function banner(e, a, th) {
    const el = document.createElement('div');
    el.setAttribute('data-dg-alarm-banner', e.alarmId);
    el.style.cssText = `display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 14px;border-radius:8px;background:${th.bg};` +
      `color:${th.text};border:1px solid ${dgUi.BLUE};border-left:5px solid ${dgUi.BLUE};box-shadow:0 4px 14px rgba(0,149,210,.15);font-size:13px;`;
    const txt = document.createElement('div');
    txt.style.cssText = 'flex:1;min-width:220px;';
    const head = document.createElement('b');
    head.textContent = t(a.dir === 'above' ? 'bannerRose' : 'bannerFell', a.name || a.symbol || `#${a.productId}`, money(a, e.price));
    const sub = document.createElement('small');
    sub.style.cssText = `display:block;color:${th.muted};font-size:12px;`;
    sub.textContent = `${t('bannerAlarm', (a.dir === 'above' ? '↑ ' : '↓ ') + money(a, a.price))} · ${time(e.at)} · ${after(a)}`;
    txt.append(head, sub);
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('data-dg-alarm-close', '');
    close.setAttribute('aria-label', t('bannerClose'));
    close.textContent = '×';
    close.style.cssText = `width:28px;height:28px;border-radius:50%;border:1px solid ${th.line};background:transparent;color:${dgUi.BLUE};cursor:pointer;font-size:16px;line-height:1;`;
    close.addEventListener('click', () => S.closeEvent(e.alarmId));
    el.append(dgUi.icon(dgUi.BELL, 22, dgUi.BLUE), txt, link(t('bannerOpen'), `#/products/${a.productId}/overview`), link(t('bannerAlarms'), ALARMS_HREF), close);
    return el;
  }

  let bannerSig = '';
  function banners() {
    const byId = new Map(S.list().map(a => [a.id, a]));
    const evs = S.events().filter(e => byId.has(e.alarmId));
    const main = document.querySelector(SEL.mainContent);
    /** @type {HTMLElement | null} */
    let box = document.querySelector(`[${BOX}]`);
    if (!evs.length || !main) { box?.remove(); bannerSig = ''; return; }
    const th = dgUi.theme();
    const sig = JSON.stringify([evs, evs.map(e => byId.get(e.alarmId)), th.bg, th.text, th.muted, th.line]);
    if (box && main.firstElementChild === box && sig === bannerSig) return;
    bannerSig = sig;
    if (!box) { box = own(document.createElement('div')); box.setAttribute(BOX, ''); box.setAttribute('role', 'status'); }
    box.style.cssText = 'display:grid;gap:8px;margin:12px 16px 0;';
    box.replaceChildren(...evs.map(e => banner(e, byId.get(e.alarmId), th)));
    if (main.firstElementChild !== box) main.prepend(box);
  }

  // The Favourites list shows each product's symbol ("ADBE | US00…"), exchange code (NDQ) and price with its currency
  // sign: every product there with an alarm is linked to its Yahoo ticker for the background check (S.link writes
  // only what changed). The product page links too (alarm-panel.js).
  function linkList() {
    if (!page.isFavourites()) return;
    const pids = new Set(S.list().map(a => a.productId));
    for (const ex of document.querySelectorAll(SEL.exchangeAbbr)) {
      const row = ex.closest('tr');
      // the exchange cell's own data-id is the exchange's (663 = NDQ); the product's is on its symbol and price cells
      const id = Number(row?.querySelector(`${SEL.symbolIsin}[data-id], ${SEL.lastPrice}`)?.getAttribute('data-id'));
      if (!row || !pids.has(id)) continue;
      const symIsin = row.querySelector(`${SEL.symbolIsin}[data-id="${id}"]`)?.textContent || '';
      const symbol = symIsin.split('|')[0].trim(), isin = R.isinOf(symIsin);
      const currency = (row.querySelector(`${SEL.lastPrice}[data-id="${id}"]`)?.textContent || '').replace(/[^\p{L}\p{Sc}]/gu, '').slice(0, R.LIMITS.currency);
      if (symbol && currency) S.link({ id, symbol, exchange: (ex.textContent || '').trim(), currency, isin });
    }
  }

  // With the background check on, alarm products not linked yet (in a Favourites list not on screen, say) are linked
  // from DEGIRO's own product details, and ISIN-only links without a venue are asked about so DEGIRO can name SG's
  // venue (S.known): one request for up to 25 of them, with the session DEGIRO's page uses (read
  // from its requests' addresses, kept in this tab's memory only). Each product is asked once per tab; an error
  // waits 20 s, doubling to 5 min; a session DEGIRO refuses (401/403) is not used again.
  const askInfo = (() => {
    const MAX_IDS = 25;
    let sid = '', acc = '', busy = false, waitUntil = 0, wait = 0;
    /** this tab's own request addresses (not read for the session), sessions DEGIRO refused, products asked */
    const mine = new Set(), refused = new Set(), asked = new Set();
    /** @param {string} name */
    const grab = name => {
      try {
        const u = new URL(name, location.href);
        if (u.origin !== location.origin || mine.has(u.href)) return;
        const had = !!(sid && acc);
        const s = u.searchParams.get('sessionId') || (u.pathname.match(/;jsessionid=([^/?;]+)/i) || [])[1] || '';
        if (s && !refused.has(s)) sid = s;
        const a = u.searchParams.get('intAccount') || (u.pathname.match(/account\/info\/(\d+)/) || [])[1] || '';
        if (/^\d{1,12}$/.test(a)) acc = a;
        if (!had && sid && acc) schedule(true); // ask now, not on the next change of the page
      } catch (e) {}
    };
    try {
      performance.getEntriesByType('resource').forEach(e => grab(e.name));
      new PerformanceObserver(l => l.getEntries().forEach(e => grab(e.name))).observe({ type: 'resource', buffered: true });
    } catch (e) {}
    return async () => {
      if (!dgSettings.alarmsBackground || busy || Date.now() < waitUntil || !sid || !acc || !S.linksReady()) return;
      const ids = [...new Set(S.list().map(a => a.productId))].filter(id => !S.known(id) && !asked.has(id)).slice(0, MAX_IDS);
      if (!ids.length) return;
      busy = true;
      const s = sid;
      const path = `/product_search/secure/v5/products/info?intAccount=${acc}&sessionId=${encodeURIComponent(s)}`;
      try { mine.add(new URL(path, location.href).href); } catch (e) {}
      try {
        const r = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ids.map(String)), signal: AbortSignal.timeout(15000) });
        if (r.status === 401 || r.status === 403) { refused.add(s); if (sid === s) sid = ''; }
        if (!r.ok) throw new Error(String(r.status));
        const found = R.parseInfo(await r.json(), ids);
        ids.forEach(id => asked.add(id));
        wait = 0;
        for (const h of found) S.link({ ...h, fill: true });
      } catch (e) {
        wait = Math.min(300000, Math.max(20000, wait * 2));
        waitUntil = Date.now() + wait;
        setTimeout(() => schedule(true), wait + 50); // try again then, even on a page that doesn't change
      } finally { busy = false; }
    };
  })();

  feature({
    name: 'priceAlarms',
    enabled: () => dgSettings.priceAlarms,
    run() {
      const present = new Set(), prices = readPrices(present);
      S.setLive(prices, present);
      if (S.ready()) { linkList(); askInfo(); }
      if (prices.size && S.ready()) check(prices);
      banners();
      return prices.size || S.events().length ? 'ok' : 'idle';
    },
    stop: () => { document.querySelectorAll(`[${BOX}]`).forEach(el => el.remove()); bannerSig = ''; S.setLive(new Map()); }
  });
  // ---------- lines on the product chart (drawn by alarm-lines.js in the page world) ----------
  // The page can read this attribute: it carries only the open product's id and its switched-on
  // alarms' prices and directions, no names, alarm ids, repeat or state. Compared with what this
  // tab last wrote, not with the attribute, so a page that rewrites it doesn't start a write war.
  const LINES = 'data-dg-alarm-lines';
  let linesSent = '';
  const clearLines = () => { document.documentElement.removeAttribute(LINES); linesSent = ''; };
  feature({
    name: 'alarmLinesData',
    enabled: () => dgSettings.priceAlarms && dgSettings.alarmLines,
    run() {
      const pid = page.isProduct() ? page.productId() : 0;
      const l = pid ? S.list().filter(a => a.on && a.productId === pid).map(a => ({ p: a.price, d: a.dir }))
        .sort((a, b) => a.p - b.p || (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)) : [];
      if (!l.length) { if (linesSent) clearLines(); return 'idle'; }
      const s = JSON.stringify({ id: pid, l });
      if (s !== linesSent) { document.documentElement.setAttribute(LINES, s); linesSent = s; }
      return 'ok';
    },
    stop: clearLines
  });

  // storage changes (this tab or another) and settings changes don't touch the DOM: nudge the scheduler
  S.onChange(() => schedule(true));
  dgOnSettings(() => schedule(true));
})();
