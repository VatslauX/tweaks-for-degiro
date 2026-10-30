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
  /** @type {(() => void)[]} */ const listeners = [];
  const changed = () => listeners.forEach(fn => { try { fn(); } catch (e) {} });
  let syncLoaded = false, localLoaded = false;
  /** firedAt values this tab wrote: any other stored firedAt belongs to another tab @type {Set<number>} */
  const mine = new Set();
  const reload = () => {
    try { chrome.storage.sync.get({ dgAlarms: [] }, r => { alarms = R.sanitize(r?.dgAlarms); syncLoaded = true; changed(); }); } catch (e) {}
  };
  // another tab fired this alarm within the window (a minute, or today for 'daily'): this tab must not fire it too
  /** @param {any} a @param {number | undefined} at @param {number} now */
  const foreignWithin = (a, at, now) => !!at && !mine.has(at) && (a.repeat === 'daily' ? R.day(at) === R.day(now) : Math.abs(now - at) < 60000);

  try {
    reload();
    chrome.storage.local.get({ dgAlarmState: {}, dgAlarmEvents: [] }, r => {
      state = R.sanitizeState(r?.dgAlarmState); events = R.sanitizeEvents(r?.dgAlarmEvents); localLoaded = true; changed();
    });
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === 'sync' && c.dgAlarms) alarms = R.sanitize(c.dgAlarms.newValue);
      else if (area === 'local' && (c.dgAlarmState || c.dgAlarmEvents)) {
        if (c.dgAlarmState) state = R.sanitizeState(c.dgAlarmState.newValue);
        if (c.dgAlarmEvents) events = R.sanitizeEvents(c.dgAlarmEvents.newValue);
      } else return;
      changed();
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
        const fresh = R.sanitizeState(r?.dgAlarmState);
        /** @type {Record<string, any>} */
        const next = { ...fresh };
        let ev = R.sanitizeEvents(r?.dgAlarmEvents);
        for (const [id, st] of Object.entries(upd)) {
          const f = fired.find(x => x.alarmId === id), a = alarms.find(x => x.id === id);
          const other = fresh[id]?.firedAt;
          if (f && a && foreignWithin(a, other, f.at)) { next[id] = { ...st, firedAt: other }; continue; }
          next[id] = st;
          if (f) ev = [...ev.filter(e => e.alarmId !== id), f];
        }
        const known = [...new Set([...alarms.map(a => a.id), ...ids])]; // this tab's list and the stored one
        state = R.sanitizeState(next, known);
        events = R.sanitizeEvents(ev.filter(e => known.includes(e.alarmId)));
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

  return Object.freeze({
    ready: () => syncLoaded && localLoaded, foreign: foreignWithin,
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

  feature({
    name: 'priceAlarms',
    enabled: () => dgSettings.priceAlarms,
    run() {
      const present = new Set(), prices = readPrices(present);
      S.setLive(prices, present);
      if (prices.size && S.ready()) check(prices);
      banners();
      return prices.size || S.events().length ? 'ok' : 'idle';
    },
    stop: () => { document.querySelectorAll(`[${BOX}]`).forEach(el => el.remove()); bannerSig = ''; S.setLive(new Map()); }
  });
  // storage changes (this tab or another) and settings changes don't touch the DOM: nudge the scheduler
  S.onChange(() => schedule(true));
  dgOnSettings(() => schedule(true));
})();
