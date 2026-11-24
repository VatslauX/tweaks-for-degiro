// Background check of price alarms (opt-in: 'alarmsBackground', which also needs the optional Yahoo host and
// notifications permissions). While Chrome runs, every minute, the switched-on alarms whose product is linked to a
// Yahoo Finance ticker (dgTickers, written by alarms.js from the Favourites list and by alarm-panel.js from the product
// header) are checked against Yahoo's public price data, usually 15 minutes delayed. Only ticker symbols are sent, to
// query1.finance.yahoo.com, without cookies; a product's ISIN only when its ticker doesn't fit, to Yahoo's search,
// once (a failed lookup is retried at most daily; one that errors waits 2, 4 … 30 minutes). A product a DEGIRO
// tab priced in the last 3 minutes is left to that tab (DEGIRO's own price). Société Générale's own products (DEGIRO's
// SCG venue) aren't on Yahoo: they're priced live from SG's site, sgbeurs.nl (their ISIN and SG's own product fields
// are sent, without cookies; one request per product per minute, at most 10, each product with its own back-off). A
// link or product that keeps failing waits alone; the others go on (see "holds and waits"). A firing is stored like a
// tab's (banner in DEGIRO) and shown as a system notification, with a chime (offscreen.html, 'alarmSound'). Rules:
// alarm-rules.js.
importScripts('alarm-rules.js');

(() => {
  const R = dgAlarmRules;
  const YAHOO = 'https://query1.finance.yahoo.com';
  const SG = 'https://sgbeurs.nl';
  const DEGIRO_PRODUCT = 'https://trader.degiro.nl/trader/#/products/';
  const PERMS = { permissions: /** @type {chrome.runtime.ManifestPermission[]} */ (['notifications']), origins: [YAHOO + '/*', SG + '/*'] };
  // the chime with DEGIRO closed (offscreen.html): asked for with PERMS, but the check never waits for it (a computer
  // that switched the check on before the sound came has PERMS alone)
  const SOUND = { permissions: /** @type {chrome.runtime.ManifestPermission[]} */ (['offscreen']) };
  const SG_PER_TICK = 10;        // SG products priced per tick (one request each)
  const POLL = 'dgPoll';
  const TAB_FRESH = 3 * 60000;   // a DEGIRO tab saw the product this recently: its price wins
  const CHUNK = 20;              // tickers per Yahoo request
  const VERIFY_BUDGET = 8;       // Yahoo requests per tick for checking new links (one link takes 1 to 5)
  const RECHECK = 24 * 3600000;  // a link that didn't match is checked again after a day
  const MAX_GAP = 30;            // after errors, ticks skipped: 1, 2, 4 … up to 30

  /** @param {string} key @param {...(string | number)} subs */
  const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;
  const granted = () => chrome.permissions.contains(PERMS).catch(() => false);
  const settings = async () => {
    const s = await chrome.storage.sync.get({ priceAlarms: true, alarmsBackground: false });
    return { priceAlarms: s?.priceAlarms !== false, alarmsBackground: s?.alarmsBackground === true };
  };

  // ---------- on / off ----------
  // The poll alarm exists only while the setting is on, both permissions are granted and a switched-on alarm has a
  // linked product. The setting syncs across the user's computers, the permissions don't: the check runs only where
  // both are on, and a computer without the permissions never switches the setting off (that would switch it off
  // on every other computer too). Permissions granted while Chrome's prompt had closed the options popup switch it on.
  let reconciling = Promise.resolve();
  /** @param {boolean | null} [want] the permissions were just added (true) or removed (false) */
  const reconcile = (want = null) => (reconciling = reconciling.then(async () => {
    try {
      const has = await granted();
      const s = await settings();
      if (want === true && has && !s.alarmsBackground) await chrome.storage.sync.set({ alarmsBackground: true });
      const on = s.priceAlarms && (s.alarmsBackground || want === true) && has;
      const sync = on ? await chrome.storage.sync.get({ dgAlarms: [], dgTickers: {} }) : {};
      const tickers = R.sanitizeTickers(sync.dgTickers);
      const needed = on && R.sanitize(sync.dgAlarms).some(a => a.on && tickers[a.productId]);
      const existing = await chrome.alarms.get(POLL);
      if (needed && !existing) await chrome.alarms.create(POLL, { periodInMinutes: 1, delayInMinutes: 0.1 });
      if (!needed && existing) await chrome.alarms.clear(POLL);
    } catch (e) {}
  }));

  // ---------- Yahoo ----------
  /** @param {string} path @returns {Promise<any>} */
  async function yahoo(path) {
    const res = await fetch(YAHOO + path, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  /** @param {string} ticker @param {string} cur @param {number | undefined} last @param {number} alarmPrice @param {{ n: number }} budget */
  async function checkTicker(ticker, cur, last, alarmPrice, budget) {
    budget.n--;
    const body = await yahoo(`/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d`);
    return R.checkLink(body?.chart?.result?.[0]?.meta, cur, last, alarmPrice);
  }
  // ---------- Société Générale (sgbeurs.nl) ----------
  /** @param {string} message @param {boolean} refused @param {unknown} [cause] */
  const sgError = (message, refused, cause) => Object.assign(new Error(message, { cause }), { refused });
  /**
   * SG's answer, or null when SG has no such product: a 404, 410 or 204, which is what a knocked-out or delisted
   * product may get. An error has `refused` when SG turned the request down (a 4xx, or its firewall's HTML page): the
   * product's fields may be stale. A 408, 429, 5xx, timeout, no network or an empty answer with another status (a
   * hiccup: it never unlinks a confirmed product) is not that.
   * @param {string} path @returns {Promise<any>}
   */
  async function sg(path) {
    const res = await fetch(SG + path, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (res.status === 404 || res.status === 410 || res.status === 204) return null;
    if (!res.ok) throw sgError(`SG HTTP ${res.status}`, res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429);
    const text = await res.text();
    if (!text || !text.trim()) throw sgError(`SG HTTP ${res.status}: empty answer`, false);
    try { return JSON.parse(text); } catch (e) { throw sgError('SG: not JSON', true, e); } // its firewall answers in HTML
  }
  /**
   * Confirm an SG link: the issuer's own site knows the ISIN (which names the product exactly, so no price
   * comparison: a leveraged product's price may have moved far from the one DEGIRO last showed), in DEGIRO's
   * currency. Its product fields are kept for the price request. Never sent to Yahoo.
   * @param {{ cur: string, isin?: string }} l @param {{ n: number }} budget
   * @returns {Promise<{ ok: boolean, f: number, y?: string, sg?: any, why?: 'missing' | 'currency' }>}
   */
  async function verifySg(l, budget) {
    budget.n--;
    const isin = l.isin || '';
    const meta = R.parseSgMeta(await sg(`/EmcWebApi/api/Products/ValuesForWatchlist/${encodeURIComponent(isin)}`));
    if (!meta) return { ok: false, f: 0, why: 'missing' };
    const f = R.priceFactor(l.cur, meta.cur);
    return f ? { ok: true, f, y: meta.code || isin, sg: meta } : { ok: false, f: 0, why: 'currency' };
  }

  /**
   * Confirm a link with Yahoo: its own ticker (symbol + exchange) first. Only when that one doesn't fit, or the
   * exchange has none, Yahoo's search is asked for the ISIN (once, not every minute), and each listing it returns must
   * pass the same currency and price check. Without a fit, the first failure's reason is kept.
   * @param {{ t: string, cur: string, isin?: string }} l @param {number | undefined} last @param {number} alarmPrice
   * @param {{ n: number }} budget Yahoo requests left this tick, counted down
   * @returns {Promise<{ ok: boolean, f: number, y?: string, via?: 'isin', why?: 'missing' | 'currency' | 'price' }>}
   */
  async function verify(l, last, alarmPrice, budget) {
    if (/** @type {any} */ (l).v === 'sg') return verifySg(l, budget);
    /** @type {{ ok: boolean, f: number, why?: 'missing' | 'currency' | 'price' }} */
    let first = { ok: false, f: 0, why: 'missing' };
    if (l.t) {
      first = await checkTicker(l.t, l.cur, last, alarmPrice, budget);
      if (first.ok) return { ...first, y: l.t };
    }
    if (!l.isin) return first;
    budget.n--;
    const found = R.parseSearch(await yahoo(`/v1/finance/search?q=${encodeURIComponent(l.isin)}&quotesCount=5&newsCount=0`)).filter(y => y !== l.t);
    for (const y of found) {
      const r = await checkTicker(y, l.cur, last, alarmPrice, budget);
      if (r.ok) return { ...r, y, via: 'isin' };
      if (!l.t && first.why === 'missing') first = r; // no own ticker: say why Yahoo's listing didn't fit
    }
    return first;
  }
  /** @param {string[]} tickers */
  async function prices(tickers) {
    /** @type {Map<string, { price: number, at: number }>} */
    const out = new Map();
    for (let i = 0; i < tickers.length; i += CHUNK) {
      const body = await yahoo(`/v8/finance/spark?symbols=${encodeURIComponent(tickers.slice(i, i + CHUNK).join(','))}&range=1d&interval=5m`);
      R.parseSpark(body).forEach((v, k) => out.set(k, v));
    }
    return out;
  }

  // ---------- notification ----------
  /**
   * A chrome.notifications call in its callback form: it returns a Promise only from Chrome 116, and the minimum is 111.
   * @param {'create' | 'clear'} method @param {...any} args @returns {Promise<any>}
   */
  const note = (method, ...args) => new Promise((resolve, reject) => {
    /** @type {any} */ (chrome.notifications)[method](...args, (/** @type {any} */ r) => {
      const e = chrome.runtime.lastError;
      if (e) reject(new Error(e.message)); else resolve(r);
    });
  });
  /** @param {any} a @param {number} n */
  const money = (a, n) => `${a.currency} ${new Intl.NumberFormat(chrome.i18n.getUILanguage(), { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n)}`.trim();
  /**
   * An alarm's notification: the system's banner (macOS about 5 s on screen, then kept in Notification Center) with
   * the system's sound (never `silent`), which plays when the system allows sound for Chrome's notifications.
   * @param {any} a @param {{ price: number, at: number, src?: 'sg' }} f
   */
  function notify(a, f) {
    try {
      const time = new Date(f.at).toLocaleTimeString(chrome.i18n.getUILanguage(), { hour: '2-digit', minute: '2-digit' });
      if (!chrome.notifications) return;
      note('create', `dg|${a.productId}|${a.id}|${f.at}`, {
        type: 'basic', iconUrl: 'icons/icon128.png', priority: 2, silent: false,
        title: t(a.dir === 'above' ? 'bannerRose' : 'bannerFell', R.label(a), money(a, f.price)),
        message: `${t('bannerAlarm', (a.dir === 'above' ? '↑ ' : '↓ ') + money(a, a.price))} · ${t(f.src === 'sg' ? 'bgNotifyNoteSg' : 'bgNotifyNote', time)}`
      }).catch(() => {});
    } catch (e) {}
  }
  /**
   * The chime (Chrome on macOS shows notifications without a sound): in offscreen.html, while 'alarmSound' is on and
   * the offscreen permission is granted. Only one offscreen document can be open; one still open from a chime a moment
   * ago (Chrome closes it after 30 s of silence) plays it again. False when it can't play.
   * @returns {Promise<boolean>}
   */
  async function chime() {
    try {
      const { alarmSound } = await chrome.storage.sync.get({ alarmSound: true });
      if (alarmSound === false || !(await chrome.permissions.contains(SOUND).catch(() => false)) || !chrome.offscreen) return false;
      try {
        await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [/** @type {chrome.offscreen.Reason} */ ('AUDIO_PLAYBACK')],
          justification: 'Plays the price alarm chime.' });
      } catch (e) {
        return (await chrome.runtime.sendMessage({ type: 'dg-chime-play' })) === true;
      }
      return true;
    } catch (e) { return false; }
  }
  let clickBound = false;
  const bindClick = () => {
    if (clickBound || !chrome.notifications?.onClicked) return;
    clickBound = true;
    chrome.notifications.onClicked.addListener(id => {
      const [tag, pid] = id.split('|');
      // the settings' test notification without an alarm to show: closed, nothing to open
      if (tag === 'dgtest') { note('clear', id).catch(() => {}); return; }
      if (tag !== 'dg' || !/^\d{1,10}$/.test(pid)) return;
      chrome.tabs.create({ url: `${DEGIRO_PRODUCT}${pid}/overview` }).catch(() => {});
      note('clear', id).catch(() => {});
    });
  };

  // ---------- one check ----------
  /** @param {Record<string, any>} status */
  const setStatus = status => chrome.storage.local.set({ dgBgStatus: status }).catch(() => {});

  async function check() {
    const now = Date.now();
    /** @typedef {Record<string, { at: number, gap: number }>} Holds */
    const sess = /** @type {{ dgBgSkip: number, dgBgGap: number, dgBgArmed: Record<string, { sig: string, armed: boolean }>, dgBgVerifyAt: number, dgBgVerifyGap: number, dgBgSgVerifyAt: number, dgBgSgVerifyGap: number, dgBgSgAt: number, dgBgSgGap: number, dgBgSgNext: number, dgBgHold: Holds, dgBgSgHold: Holds }} */ (
      await chrome.storage.session.get({ dgBgSkip: 0, dgBgGap: 0, dgBgArmed: {}, dgBgVerifyAt: 0, dgBgVerifyGap: 0, dgBgSgVerifyAt: 0, dgBgSgVerifyGap: 0, dgBgSgAt: 0, dgBgSgGap: 0, dgBgSgNext: 0, dgBgHold: {}, dgBgSgHold: {} }));
    // after Yahoo price errors, Yahoo waits a few ticks; SG has its own waits (below), so one source never holds up the other
    const yahooWait = sess.dgBgSkip > 0;
    if (yahooWait) await chrome.storage.session.set({ dgBgSkip: sess.dgBgSkip - 1 });
    const s = await settings();
    if (!s.priceAlarms || !s.alarmsBackground || !(await granted())) return reconcile();

    const sync = await chrome.storage.sync.get({ dgAlarms: [], dgTickers: {} });
    const alarms = R.sanitize(sync.dgAlarms);
    const pids = [...new Set(alarms.map(a => a.productId))];
    const tickers = R.sanitizeTickers(sync.dgTickers, pids);
    const local = await chrome.storage.local.get({ dgAlarmState: {}, dgTickerCheck: {} });
    const state = R.sanitizeState(local.dgAlarmState);
    const keyOf = (/** @type {number} */ pid) => tickers[pid] ? R.linkKey(tickers[pid]) : '';
    const checks = R.sanitizeChecks(local.dgTickerCheck, pids.map(keyOf).filter(Boolean));
    const on = alarms.filter(a => a.on && tickers[a.productId]);
    let err = '';
    // "Clear saved data" in the settings, the check switched off or its alarms deleted while a request was out: from
    // then on this tick writes, shows and asks nothing more (it would write erased data back). Asked again after each
    // round of requests, before what that round stores.
    let stopped = false;
    const stop = async () => {
      if (stopped) return true;
      try {
        const [s2, has, stored] = await Promise.all([settings(), granted(), chrome.storage.sync.get({ dgAlarms: [] })]);
        const ids = R.sanitize(stored.dgAlarms).map(a => a.id);
        stopped = !s2.priceAlarms || !s2.alarmsBackground || !has || !on.some(a => ids.includes(a.id));
      } catch (e) {} // can't tell: carry on, as before
      return stopped;
    };
    const linkedSg =Object.values(tickers).filter(l => l.v === 'sg').map(l => l.isin || '');

    // ---------- holds and waits ----------
    // A request that fails holds only its own link (its check: dgBgHold, by check key) or SG product (its price:
    // dgBgSgHold, by ISIN) for 2, 4 … 30 minutes; a success clears that. Links and products that failed before go
    // after the others, so one that keeps failing never goes first. A whole source waits 2, 4 … 30 minutes only when
    // the first two of its requests in a tick both fail: then the source itself is refusing or out of reach (its
    // firewall, a 429 or 5xx, no network), not one product, and it is asked at most twice per wait. Yahoo's link
    // checks (dgBgVerifyAt), SG's link checks (dgBgSgVerifyAt) and SG's prices (dgBgSgAt) each wait on their own.
    /** @type {Record<string, any>} */ const patch = {};
    /** @param {Holds} stored @param {string[]} keep @param {'dgBgHold' | 'dgBgSgHold'} name */
    const holds = (stored, keep, name) => {
      /** @type {Holds} */ const map = {};
      const all = Object.entries(stored && typeof stored === 'object' ? stored : {});
      for (const [k, v] of all) if (keep.includes(k) && Number.isFinite(v?.at) && Number.isFinite(v?.gap)) map[k] = { at: v.at, gap: v.gap };
      if (Object.keys(map).length !== all.length) patch[name] = map; // links gone since
      return {
        held: (/** @type {string} */ k) => now < (map[k]?.at || 0),
        failedBefore: (/** @type {string} */ k) => !!map[k],
        fail: (/** @type {string} */ k) => { const gap = Math.min(MAX_GAP, Math.max(2, (map[k]?.gap || 0) * 2)); map[k] = { at: now + gap * 60000, gap }; patch[name] = map; },
        ok: (/** @type {string} */ k) => { if (map[k]) { delete map[k]; patch[name] = map; } }
      };
    };
    /** @param {'dgBgVerify' | 'dgBgSgVerify' | 'dgBgSg'} name @param {boolean} [blocked] already waiting for another reason */
    const wait = (name, blocked = false) => {
      const atKey = `${name}At`, gapKey = `${name}Gap`, saved = /** @type {Record<string, number>} */ (/** @type {unknown} */ (sess));
      const w = {
        blocked: blocked || now < (saved[atKey] || 0), gap: saved[gapKey] || 0, ok: 0, failed: 0,
        resetGap: () => { if (w.gap) { w.gap = 0; patch[gapKey] = 0; } },
        succeed: () => { w.ok++; w.resetGap(); },
        fail: () => {
          if (++w.failed < 2 || w.ok) return;
          w.blocked = true;
          w.gap = Math.min(MAX_GAP, Math.max(2, w.gap * 2));
          patch[gapKey] = w.gap;
          patch[atKey] = now + w.gap * 60000;
        }
      };
      return w;
    };
    /** @template T @param {T[]} list @param {(x: T) => boolean} failed */
    const failedLast = (list, failed) => [...list.filter(x => !failed(x)), ...list.filter(failed)];
    const checkHold = holds(sess.dgBgHold, pids.map(keyOf).filter(Boolean), 'dgBgHold');
    const priceHold = holds(sess.dgBgSgHold, linkedSg, 'dgBgSgHold');
    const yCheck = wait('dgBgVerify', yahooWait), sgCheck = wait('dgBgSgVerify'), sgPrice = wait('dgBgSg');

    // products a DEGIRO tab priced just now are left to it
    const tabSeen = (/** @type {number} */ pid) => alarms.some(x => x.productId === pid && now - (state[x.id]?.lastAt || 0) < TAB_FRESH);
    const cOf = (/** @type {number} */ pid) => checks[keyOf(pid)];
    // where a product's quote is found: its Yahoo ticker (the link's own, or the one its ISIN search found), or SG's ISIN
    const qKey = (/** @type {number} */ pid) => (cOf(pid)?.sg ? `sg:${tickers[pid].isin}` : cOf(pid)?.y || '');
    /** @type {Map<string, { price: number, at: number, src?: 'sg' }>} */
    const quotes = new Map();
    /** @type {typeof on} the confirmed alarms priced below */
    let live;

    // the holds and waits are saved even when a storage write fails mid-tick (the error still ends the tick)
    try {
      // New links (and old mismatches, once a day; SG's product fields, once a day: a future-based product rolls to
      // the next future) are checked first, within a request budget. A failed check stores nothing: a confirmed link
      // keeps its check and is still priced below.
      {
        const budget = { n: VERIFY_BUDGET };
        let verified = 0;
        for (const a of failedLast(on, x => checkHold.failedBefore(keyOf(x.productId)))) {
          const key = keyOf(a.productId), c = checks[key], isSg = tickers[a.productId].v === 'sg', src = isSg ? sgCheck : yCheck;
          if (c && (c.ok ? !(c.sg && now - c.at >= RECHECK) : now - c.at < RECHECK)) continue;
          if (src.blocked || checkHold.held(key)) continue;
          if (budget.n <= 0) break;
          const last = alarms.filter(x => x.productId === a.productId).map(x => state[x.id]?.last).find(v => v);
          try {
            checks[key] = { ...(await verify(tickers[a.productId], last, a.price, budget)), at: now };
            verified++;
            checkHold.ok(key);
            src.succeed();
            if (isSg) sgPrice.resetGap(); // SG answers: its prices' next wait starts from 2 minutes again
          } catch (e) {
            err = String(e?.message || e).slice(0, 80);
            checkHold.fail(key);
            src.fail();
          }
        }
        if (budget.n < VERIFY_BUDGET && await stop()) return;
        if (verified) await chrome.storage.local.set({ dgTickerCheck: checks });
      }

      live = on.filter(a => checks[keyOf(a.productId)]?.ok && !tabSeen(a.productId));

      // Yahoo: all tickers in one request (chunks of 20); errors wait 1, 2, 4 … 30 ticks
      const yTickers = [...new Set(live.filter(a => !cOf(a.productId).sg).map(a => cOf(a.productId).y || ''))].filter(Boolean);
      if (yTickers.length && !yahooWait) {
        try {
          (await prices(yTickers)).forEach((v, k) => quotes.set(k, v));
          if (await stop()) return;
          if (sess.dgBgGap) await chrome.storage.session.set({ dgBgGap: 0 });
        } catch (e) {
          if (await stop()) return;
          err = String(e?.message || e).slice(0, 80);
          const gap = Math.min(MAX_GAP, Math.max(1, sess.dgBgGap * 2));
          await chrome.storage.session.set({ dgBgGap: gap, dgBgSkip: gap });
        }
      }

      // SG: one request per product, up to SG_PER_TICK a tick, taking turns when there are more (dgBgSgNext). Each
      // product's error is its own (holds and waits above), so the others are still priced in the same tick. A product
      // SG refuses (its fields went stale, e.g. a rolled future) is checked again after its hold, which fetches its
      // fields anew; no bid (closed, halted) just means no price this tick.
      const allSg = [...new Set(live.filter(a => cOf(a.productId).sg).map(a => tickers[a.productId].isin || ''))].filter(Boolean);
      const turn = allSg.length > SG_PER_TICK ? (sess.dgBgSgNext || 0) % allSg.length : 0;
      const sgTurn = [...allSg.slice(turn), ...allSg.slice(0, turn)].slice(0, SG_PER_TICK);
      if (sgTurn.length && !sgPrice.blocked) {
        if (allSg.length > SG_PER_TICK) await chrome.storage.session.set({ dgBgSgNext: (turn + SG_PER_TICK) % allSg.length });
        const seen = R.sanitizeSgSeen((await chrome.storage.local.get({ dgSgSeen: {} })).dgSgSeen);
        const pidOf = (/** @type {string} */ isin) => on.find(a => tickers[a.productId].isin === isin && cOf(a.productId)?.sg)?.productId || 0;
        let seenChanged = false, checksChanged = false;
        for (const isin of failedLast(sgTurn.filter(i => !priceHold.held(i)), i => priceHold.failedBefore(i))) {
          if (sgPrice.blocked) break;
          const key = keyOf(pidOf(isin)), meta = checks[key]?.sg;
          if (!meta) continue;
          try {
            const bid = R.parseSgBid(await sg(R.sgSnapshotPath(isin, meta)));
            priceHold.ok(isin);
            sgPrice.succeed();
            if (!bid) continue;
            // SG's answer has no time: the time its bid last changed stands in for a trade's time
            const prev = seen[isin], at = prev && prev.b === bid ? prev.at : now;
            if (!prev || prev.b !== bid) { seen[isin] = { b: bid, at }; seenChanged = true; }
            quotes.set(`sg:${isin}`, { price: bid, at, src: 'sg' });
          } catch (e) {
            err = String(e?.message || e).slice(0, 80);
            priceHold.fail(isin);
            // refused (a 4xx, or its firewall's HTML page): its fields may be stale, so its link is checked again,
            // after its own hold. A timeout, no network (a laptop waking up) or a server error keeps the link
            if (/** @type {any} */ (e)?.refused === true && checks[key]) { delete checks[key]; checksChanged = true; checkHold.fail(key); }
            sgPrice.fail();
          }
        }
        if (await stop()) return;
        // kept for the SG products that are linked; a product whose alarms went drops out
        if (seenChanged) await chrome.storage.local.set({ dgSgSeen: R.sanitizeSgSeen(seen, linkedSg) });
        if (checksChanged) await chrome.storage.local.set({ dgTickerCheck: checks });
      }
    } finally {
      if (!stopped && Object.keys(patch).length) await chrome.storage.session.set(patch);
    }
    if (stopped) return;

    try {
      /** @type {Record<string, any>} */ const upd = {};
      /** @type {{ alarmId: string, price: number, at: number, src?: 'sg' }[]} */ const fired = [];
      /** @type {string[]} */ const off = [];
      /** @type {Record<string, { sig: string, armed: boolean }>} */ const armedMap = { ...sess.dgBgArmed };
      for (const a of live) {
        const q = quotes.get(qKey(a.productId));
        if (!q || !cOf(a.productId)) continue;
        const price = Math.round(q.price * checks[keyOf(a.productId)].f * 1e6) / 1e6;
        const at = Math.min(now, q.at); // the trade's time: a firing is about that price
        const st = state[a.id] || {};
        // a price no newer than the last firing (a closed market's close, seen again after a restart) never fires
        if (st.firedAt && at <= st.firedAt) continue;
        // first sight of an 'every time' alarm already past its price after it fired: quiet until it crosses back
        const sig = `${a.price}|${a.dir}|${a.repeat}`, mem = armedMap[a.id];
        const armed = mem && mem.sig === sig ? mem.armed : !(R.reached(a, price) && st.firedAt);
        const d = R.decide(a, { ...st, armed }, price, at);
        armedMap[a.id] = { sig, armed: d.armed };
        if (!d.fire || (st.firedAt && R.within(a, st.firedAt, at))) continue;
        // only firedAt: `last`/`lastAt` stay DEGIRO's (what a tab saw), which the link check and tabSeen rely on
        upd[a.id] = { ...st, firedAt: at };
        fired.push({ alarmId: a.id, price, at, ...(q.src ? { src: q.src } : {}) });
        if (!d.on) off.push(a.id);
      }
      await chrome.storage.session.set({ dgBgArmed: armedMap });

      if (fired.length) {
        // merged into freshly read storage: a tab may have fired the same alarm meanwhile, its firing wins
        // the stored alarm ids are read again too: an alarm a tab added meanwhile keeps its state and banner
        const [fresh, now2] = await Promise.all([chrome.storage.local.get({ dgAlarmState: {}, dgAlarmEvents: [] }), chrome.storage.sync.get({ dgAlarms: [] })]);
        const known = [...new Set([...alarms.map(a => a.id), ...R.sanitize(now2.dgAlarms).map(a => a.id)])];
        const mine = new Set(fired.map(f => f.at));
        const merged = R.merge({ state: R.sanitizeState(fresh.dgAlarmState), events: R.sanitizeEvents(fresh.dgAlarmEvents) },
          upd, fired, alarms, known, (a, at, when) => !!at && !mine.has(at) && R.within(a, at, when));
        await chrome.storage.local.set({ dgAlarmState: merged.state, dgAlarmEvents: merged.events });
        let shown = 0;
        for (const f of fired) {
          if (!merged.events.some(e => e.alarmId === f.alarmId && e.at === f.at)) continue;
          const a = alarms.find(x => x.id === f.alarmId);
          if (a) { notify(a, f); shown++; }
        }
        if (shown) await chime(); // once per tick, however many fired; a tab's own firing chimes in that tab

        if (off.length) {
          const base = R.sanitize((await chrome.storage.sync.get({ dgAlarms: [] })).dgAlarms);
          await chrome.storage.sync.set({ dgAlarms: base.map(a => (off.includes(a.id) && merged.events.some(e => e.alarmId === a.id) ? { ...a, on: false } : a)) });
        }
      }
    } catch (e) {
      err = String(e?.message || e).slice(0, 80); // storage failed: the next tick tries again
    }
    const linked = alarms.filter(a => a.on && checks[keyOf(a.productId)]?.ok).length;
    await setStatus({ at: now, linked, total: alarms.filter(a => a.on).length, err });
  }

  // one check at a time: a tick that comes while one is still running is skipped, not queued
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await check(); } catch (e) {} finally { busy = false; }
  };

  // ---------- listeners (registered at the top level, so they wake the worker) ----------
  bindClick();
  chrome.alarms.onAlarm.addListener(a => { if (a.name === POLL) tick(); });
  chrome.runtime.onInstalled.addListener(() => reconcile());
  chrome.runtime.onStartup.addListener(() => reconcile());
  chrome.permissions.onAdded.addListener(p => { if (p.origins?.length) { bindClick(); reconcile(true); } });
  chrome.permissions.onRemoved.addListener(p => { if (p.origins?.length || p.permissions?.includes('notifications')) reconcile(false); });
  // a chime asked for by a DEGIRO tab Chrome doesn't let play sound yet (never clicked in), or by the settings' test
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (sender.id !== chrome.runtime.id || msg?.type !== 'dg-chime') return;
    chime().then(reply);
    return true; // replies later
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'sync' && (c.dgAlarms || c.dgTickers || c.alarmsBackground || c.priceAlarms)) reconcile();
  });
})();
