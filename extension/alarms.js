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
  /**
   * 'once' alarms this tab's checks switched off whose switch-off isn't stored yet (`record()` writes it last): the
   * switch-off is laid over every list that replaces `alarms` from storage (`onChanged`, `reload`, `writeAlarms`), or
   * the next check would fire the alarm a second time. Each entry is the record() call's own object, so only that call
   * removes it once written; kept when storage refused it (`done`), until a later list write of this tab's stores it or
   * the user switches the alarm on or edits it.
   * @type {Map<string, { done: boolean }>}
   */
  const offing = new Map();
  /** @param {any[]} list sanitized */
  const withOffing = list => R.withOff(list, offing);
  /**
   * This tab's list edits (`saveAlarms`: add, switch, remove) shown at once but not written yet, in the order queued:
   * laid over every list that replaces `alarms` from storage, like `offing`, until their own queue item is done
   * (written, refused, or `edit` refused the stored list). Otherwise another writer's list write landing meanwhile
   * would bring back what the user just changed: an alarm just switched off or removed could fire and chime.
   * @type {{ edit: (list: any[]) => any[] | null }[]}
   */
  const queued = [];
  /** its turn is done @param {object} [q] */
  const unqueue = q => { const i = queued.findIndex(x => x === q); if (i >= 0) queued.splice(i, 1); };
  /** a list from storage as this tab shows it: its queued edits (one that refuses the list leaves it), then `offing` @param {any[]} list sanitized */
  const shownOf = list => R.shownList(list, queued.map(q => q.edit), offing);
  const reload = () => {
    try { chrome.storage.sync.get({ dgAlarms: [] }, r => { alarms = shownOf(R.sanitize(r?.dgAlarms)); syncLoaded = true; changed(); }); } catch (e) {}
  };
  /**
   * Each alarm's stored firedAt as this tab last saw it, and when (this tab's clock) a new one first appeared: 0 for
   * this tab's own and for one already stored when the tab loaded. One entry per alarm with a firedAt.
   * @type {Map<string, { at: number, seenAt: number }>}
   */
  let seen = new Map();
  /** @param {Record<string, any>} st stored state, sanitized @param {boolean} fresh false: what was stored at load */
  const observe = (st, fresh) => { seen = R.observed(seen, st, fresh, mine, Date.now()); };
  // another writer (tab, background worker) fired this alarm within the window (a minute, or today for 'daily'): this
  // tab must not fire it too. The worker's firedAt is the trade's time (Yahoo's ~15-minute delay, or a closed market's
  // close), not its clock's: a firedAt this tab first saw less than a minute ago is that same firing too
  /** @param {any} a @param {number | undefined} at @param {number} now */
  const foreignWithin = (a, at, now) => R.foreignFiring(a, at, now, mine, seen);
  /**
   * What this tab's checks handed `record()` and isn't stored yet, per alarm: `last`/`lastAt`, and `firedAt` when it
   * fired (after the merge: the firing that won). A storage change landing meanwhile (another tab's or the worker's
   * write, this tab's own earlier one) carries the stored state without it: it is laid over `state` again, or the next
   * check would fire the alarm a second time. `by`: the record() call it belongs to, which removes it once written.
   * @type {Map<string, { by: object, p: Record<string, number> }>}
   */
  const pending = new Map();
  const patchOf = R.patchOf;
  /**
   * This tab's firings that its merge kept (they chimed) but storage refused to store, per alarm: `at` (the firedAt),
   * `base` (the stored firedAt that merge read) and `sig` (the alarm's price, direction and repeat then). Laid over
   * `state` like `pending`, so the alarm keeps counting as fired (no second chime), and stored by this tab's next
   * `record()` write that goes through. Dropped once the stored firedAt is no longer `base` (another writer's firing,
   * or an edit that cleared it, wins), the alarm is edited (`update()` here; elsewhere: `sig` changes) or goes.
   * @type {Map<string, { at: number, base: number | undefined, sig: string }>}
   */
  const unsaved = new Map();
  const sigOf = R.sigOf;
  /** an unsaved firing of this alarm still counts (`at`: the firing on its way to storage) @param {string} id @param {any[]} list @param {Record<string, any>} st */
  const holds = (id, list, st) => R.holds(unsaved.get(id), id, list, st);
  /** stored state with this tab's unsaved changes on top (only of alarms it still has) @param {Record<string, any>} st */
  const withPending = st => {
    const r = R.overlayState(st, alarms, unsaved, pending);
    for (const id of r.drop) unsaved.delete(id);
    return r.state;
  };
  // the list changed (an edit or removal elsewhere): an unsaved firing of an alarm edited or gone no longer counts.
  // Judged on the stored list, not the shown one: this tab's own queued removal may still be refused (`withPending`
  // still judges on the shown list, so a `dgAlarmState` change during that wait drops it: a known, rare gap)
  /** @param {any[]} list the stored list, sanitized */
  const dropEdited = list => {
    const r = R.dropEdited(state, unsaved, list);
    for (const id of r.drop) unsaved.delete(id);
    state = r.state;
  };

  try {
    reload();
    chrome.storage.local.get({ dgAlarmState: {}, dgAlarmEvents: [] }, r => {
      state = R.sanitizeState(r?.dgAlarmState); events = R.sanitizeEvents(r?.dgAlarmEvents); localLoaded = true;
      observe(state, false);
      changed();
    });
    chrome.storage.sync.get({ dgTickers: {} }, r => { tickers = R.sanitizeTickers(r?.dgTickers); tickersLoaded = true; changed(); });
    chrome.storage.local.get({ dgTickerCheck: {}, dgBgStatus: null, dgNoTicker: {} }, r => {
      checks = R.sanitizeChecks(r?.dgTickerCheck); bgAt = bgTime(r?.dgBgStatus); noTicker = R.sanitizeNoTicker(r?.dgNoTicker); checksLoaded = true; changed();
    });
    chrome.storage.onChanged.addListener((c, area) => {
      let hit = false;
      if (area === 'sync' && c.dgAlarms) { const list = R.sanitize(c.dgAlarms.newValue); alarms = shownOf(list); dropEdited(list); hit = true; }
      if (area === 'sync' && c.dgTickers) {
        tickers = R.sanitizeTickers(c.dgTickers.newValue);
        // another writer (tab, computer) dropped a product's link, or it went with its alarms: link it again when seen.
        // A link that merely differs is left alone, or two sources would rewrite each other's for ever.
        for (const k of [...linkedKeys]) if (!tickers[k.split('|')[0]]) linkedKeys.delete(k);
        hit = true;
      }
      if (area === 'local' && c.dgAlarmState) {
        const st = R.sanitizeState(c.dgAlarmState.newValue);
        observe(st, true);
        state = withPending(st); // a write of this tab's still in flight: what it holds isn't stored yet
        hit = true;
      }
      if (area === 'local' && c.dgAlarmEvents) { events = R.sanitizeEvents(c.dgAlarmEvents.newValue); hit = true; }
      if (area === 'local' && c.dgTickerCheck) { checks = R.sanitizeChecks(c.dgTickerCheck.newValue); hit = true; }
      if (area === 'local' && c.dgBgStatus) { bgAt = bgTime(c.dgBgStatus.newValue); hit = true; }
      if (area === 'local' && c.dgNoTicker) { noTicker = R.sanitizeNoTicker(c.dgNoTicker.newValue); hit = true; }
      if (hit) changed();
    });
  } catch (e) {}

  // every writer of local storage runs one after the other: each reads the stored values, merges its own
  // change and writes back, so overlapping calls would lose each other's updates. Other DEGIRO tabs, the settings page
  // and the background worker do the same: each queue item that reads and writes alarm data does it holding the
  // alarm-data lock (alarm-lock.js), taken inside the item so this tab's own order stays as queued
  let queue = Promise.resolve();
  /** @param {() => Promise<any>} fn */
  const serial = fn => (queue = queue.then(fn, fn));
  /** a queue item holding the alarm-data lock @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  const locked = fn => serial(() => dgAlarmLock.run(fn));

  /** the alarms in storage (this tab's list if storage refuses) */
  async function storedList() {
    try { return R.sanitize((await chrome.storage.sync.get({ dgAlarms: [] }))?.dgAlarms); } catch (e) { return alarms; }
  }
  /** ids of the alarms in storage (this tab's list if storage refuses) */
  const storedIds = async () => (await storedList()).map(a => a.id);
  // events of alarms that no longer exist go (nothing would ever close them)
  const dropOrphans = () => locked(async () => {
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

  // Write the list: shown at once (with this tab's later queued edits on top, written in their own turn); if storage
  // refuses, it comes back from storage. Only inside a queue item that holds the lock, on a list made from the stored
  // one (a fresh read in that item). Never await `saveAlarms` or any other `locked()` call inside such an item: it
  // would queue behind it and never start, stopping this tab's writes. `own`: the `queued` entry of the item writing
  /** @param {any[]} list @param {object} [own] */
  async function writeAlarms(list, own) {
    const out = withOffing(R.sanitize(list));
    alarms = shownOf(out);
    changed();
    try { await chrome.storage.sync.set({ dgAlarms: out }); } catch (e) { unqueue(own); reload(); return false; }
    // a switch-off storage refused before is stored now: the list just written holds it
    for (const [id, o] of offing) if (o.done && !out.some(a => a.id === id && a.on)) offing.delete(id);
    dropOrphans(); // not awaited: called from inside the queue
    return true;
  }
  /**
   * The user's change to the list (`edit` of a list; null: not possible on that list): shown on this tab's list at
   * once, then made to the stored list, read again holding the lock, so a change another writer stored meanwhile (a
   * tab's, another computer's, the worker's 'once' switch-off) stays. `edit` may run more than once, on any
   * list. Until then it stays over every list storage brings (`queued`). Resolves true once written, false if storage refused
   * it, null if `edit` refused the stored list (nothing written).
   * @param {(list: any[]) => any[] | null} edit @returns {Promise<boolean | null>}
   */
  const saveAlarms = edit => {
    const own = { edit };
    queued.push(own);
    const shown = edit(alarms);
    if (shown) { alarms = withOffing(R.sanitize(shown)); changed(); }
    return locked(async () => {
      try {
        const next = edit(await storedList());
        if (!next) { unqueue(own); reload(); return null; }
        return await writeAlarms(next, own);
      } finally { unqueue(own); }
    });
  };
  /** @param {any} a @returns {Promise<'ok' | 'full' | 'error'>} */
  async function add(a) {
    if (alarms.length >= R.MAX) return 'full';
    // added once, whichever list it lands on; a list that filled up meanwhile (another computer's) takes no more
    const ok = await saveAlarms(list => (list.some(x => x.id === a.id) ? list : list.length >= R.MAX ? null : [...list, a]));
    return ok ? 'ok' : ok === null ? 'full' : 'error';
  }
  /** @param {string} id @param {boolean} on @returns {Promise<boolean>} */
  const setOn = (id, on) => {
    offing.delete(id); // the user's choice: no switch-off of this tab's is laid over it
    return saveAlarms(list => list.map(a => (a.id === id ? { ...a, on } : a))).then(ok => !!ok);
  };
  /** @param {string} id @returns {Promise<boolean>} */
  const remove = id => saveAlarms(list => list.filter(a => a.id !== id)).then(ok => !!ok);

  /**
   * Change an alarm's price, direction and repeat in place (same id and position), switch it on and let it
   * fire again: its fired time and open banner go, `last`/`lastAt` stay. Runs in the queue holding the lock, like
   * `record`.
   * @param {string} id @param {{ price: number, dir: string, repeat: string }} patch @returns {Promise<'ok' | 'gone' | 'error'>}
   */
  const update = (id, patch) => locked(async () => {
    try {
      const base = await storedList();
      const old = base.find(a => a.id === id);
      if (!old) return 'gone';
      const [next] = R.sanitize([{ ...old, price: patch.price, dir: patch.dir, repeat: patch.repeat, on: true }]);
      if (!next) return 'error';
      offing.delete(id); // edited: switched on, whatever this tab switched off before
      if (!(await writeAlarms(base.map(a => (a.id === id ? next : a))))) return 'error';
      // saved: the rest is best effort (like closeEvent), a failing local write must not report an error
      try {
        pending.delete(id); // the edit starts the alarm afresh: nothing of before is laid over it again
        unsaved.delete(id);
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
    locked(async () => {
      try {
        const r = await chrome.storage.local.get({ dgAlarmEvents: [] });
        await chrome.storage.local.set({ dgAlarmEvents: R.sanitizeEvents(r?.dgAlarmEvents).filter(e => e.alarmId !== alarmId) });
      } catch (e) {}
    });
  }

  /**
   * Store what a check found: new per-alarm state (`last`, `firedAt`), the alarms that fired, 'once'
   * alarms to switch off. Applied here at once (the next check, a frame later, must see it), then
   * written. Another DEGIRO tab or the background worker may have fired the same alarm a moment earlier
   * (`foreignWithin`): its firing wins and this one is dropped, neither chimed nor switched off here.
   * `armed` is never stored.
   * `kept` runs once one of `fired` is kept (this tab's firing: it chimes), before the writes.
   * @param {Record<string, any>} upd @param {{ alarmId: string, price: number, at: number }[]} fired @param {string[]} off
   * @param {() => void} [onKept]
   */
  function record(upd, fired, off, onKept) {
    fired.forEach(f => mine.add(f.at));
    state = { ...state, ...upd };
    const by = {}, firedIds = new Set(fired.map(f => f.alarmId));
    for (const [id, st] of Object.entries(upd)) pending.set(id, { by, p: patchOf(st, firedIds.has(id)) });
    /** this call's entries in `pending` @param {(id: string) => void} fn */
    const ours = fn => Object.keys(upd).forEach(id => { if (pending.get(id)?.by === by) fn(id); });
    // this call's switch-offs, laid over the list until stored (`offing`)
    const mark = { done: false };
    /** this call's entries in `offing` @param {(id: string) => boolean} keep */
    const offsLeft = keep => off.forEach(id => { if (offing.get(id) === mark && !keep(id)) offing.delete(id); });
    off.forEach(id => offing.set(id, mark));
    if (off.length) alarms = withOffing(alarms);
    changed();
    // the merge, its write and the switch-offs hold the lock: another writer's merge can't land between this read
    // and this write. `onKept` (the chime) only starts the sound or asks the worker for it, without waiting
    return locked(async () => {
      let offKept = off; // storage failing before the merge: all of them, as before
      let refused = false;
      /** this call's kept firings, until storage took them (`unsaved` if it refuses) @type {[string, { at: number, base: number | undefined, sig: string }][]} */
      let unstored = [];
      try {
        try {
          const [r, list] = await Promise.all([chrome.storage.local.get({ dgAlarmState: {}, dgAlarmEvents: [] }), storedList()]);
          const ids = list.map(a => a.id);
          // its alarms are gone meanwhile (deleted, or "Clear saved data"): nothing to store, nor to switch off
          if (!Object.keys(upd).some(id => ids.includes(id))) return;
          const known = [...new Set([...alarms.map(a => a.id), ...ids])]; // this tab's list and the stored one
          const stored = R.sanitizeState(r?.dgAlarmState);
          observe(stored, true); // the worker's firing may be stored before its storage event reaches this tab
          const merged = R.merge({ state: stored, events: R.sanitizeEvents(r?.dgAlarmEvents) }, upd, fired, alarms, known, foreignWithin);
          // earlier firings of this tab's that storage refused go with this write, unless the stored list or state says
          // otherwise (edited, gone, another writer's firedAt) or this merge kept a newer one
          const carried = [...unsaved].filter(([id, u]) => holds(id, list, stored) && merged.state[id]?.firedAt === u.base);
          for (const [id, u] of carried) merged.state[id] = { ...merged.state[id], firedAt: u.at };
          // until written, this call's entries hold what the merge made of them (a dropped firing: the winner's firedAt)
          ours(id => { if (merged.state[id]) pending.set(id, { by, p: patchOf(merged.state[id], firedIds.has(id)) }); else pending.delete(id); });
          state = withPending(merged.state); // and a later check's, still queued, stay
          events = merged.events;
          // a firing the merge dropped (another writer's won) doesn't chime, nor is switched off here (the winner does
          // that); two tabs whose merges interleave within a few ms (only without the lock: a worker that didn't answer)
          // may each keep theirs for a moment (one event stays) and both chime
          const kept = fired.filter(f => events.some(e => e.alarmId === f.alarmId && e.at === f.at));
          offKept = off.filter(id => kept.some(f => f.alarmId === id));
          if (onKept && kept.length) onKept();
          changed();
          unstored = kept.flatMap(f => {
            const a = alarms.find(x => x.id === f.alarmId);
            return a ? [[f.alarmId, { at: f.at, base: stored[f.alarmId]?.firedAt, sig: sigOf(a) }]] : [];
          });
          await chrome.storage.local.set({ dgAlarmState: merged.state, dgAlarmEvents: merged.events });
          unstored = [];
          for (const [id, u] of carried) if (unsaved.get(id) === u) unsaved.delete(id);
        } catch (e) {} finally {
          ours(id => pending.delete(id)); // stored, or storage refused it: storage says what holds, but for
          for (const [id, u] of unstored) unsaved.set(id, u); // a firing that chimed (or it would fire again)
        }
        offsLeft(id => offKept.includes(id)); // a dropped firing's switch-off isn't this tab's: the stored list says
        if (offKept.length) {
          // switch off on the stored list, so alarms another tab added or changed meanwhile are kept
          const base = await storedList();
          refused = !(await writeAlarms(base.map(a => (offKept.includes(a.id) ? { ...a, on: false } : a))));
        } else if (off.length) reload(); // switched off above in this tab only: the stored list says what holds
      } finally {
        // stored: the stored list holds the switch-off. Refused: it stays over this tab's list, or the alarm would fire
        // again on every check (a chime each time) for as long as storage refuses
        mark.done = true;
        offsLeft(() => refused);
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
  const { SEL, page, own, feature, t, parseNum, fmt, schedule, backoff } = __dgt; // common.js
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
  // keyed by the alarm's price, direction and repeat too: an edited alarm starts fresh, in every tab. `fa` is the stored
  // firedAt the memory was based on: another writer's firing since (the background worker's while this tab wasn't
  // pricing the product, another tab's) makes it start fresh too, so a price still past the alarm doesn't fire it again
  /** @type {Map<string, { sig: string, fa: number | undefined, armed: boolean }>} */
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
      const armed = mem && mem.sig === sig && mem.fa === st.firedAt ? mem.armed : !(R.reached(a, price) && st.firedAt);
      if (!st.lastAt || now - st.lastAt >= SEEN_EVERY) { next.last = price; next.lastAt = now; }
      if (a.on) {
        const d = R.decide(a, { ...st, armed }, price, now);
        armedMap.set(a.id, { sig, fa: st.firedAt, armed: d.armed });
        if (d.fire && S.foreign(a, st.firedAt, now)) d.fire = false; // another tab fired it just now
        if (d.fire) {
          armedMap.set(a.id, { sig, fa: now, armed: d.armed }); // this tab's own firing keeps its memory
          Object.assign(next, { firedAt: now, last: price, lastAt: now });
          fired.push({ alarmId: a.id, price, at: now });
          if (!d.on) off.push(a.id);
        }
      }
      if (JSON.stringify(next) !== JSON.stringify(st)) upd[a.id] = next;
    }
    if (Object.keys(upd).length) S.record(upd, fired, off, fired.length ? chime : undefined);
  }

  /**
   * The chime for alarms this tab fired and kept (once, however many; never for a banner another tab or the background
   * check fired, which chimes there). Chrome lets a page play sound only once it has been clicked or typed in; before
   * that (a DEGIRO tab reopened after a restart, say) the background worker plays it, if it has the sound permission
   * (Check in the background on); otherwise this one stays quiet.
   */
  function chime() {
    if (!dgSettings.alarmSound) return;
    if (navigator.userActivation?.hasBeenActive && dgPlayChime()) return;
    try { chrome.runtime.sendMessage({ type: 'dg-chime' }).catch(() => {}); } catch (e) {}
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
    let sid = '', acc = '', busy = false;
    const retry = backoff(20000, 300000);
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
      if (!dgSettings.alarmsBackground || busy || retry.waiting() || !sid || !acc || !S.linksReady()) return;
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
        retry.ok();
        for (const h of found) S.link({ ...h, fill: true });
      } catch (e) {
        const wait = retry.fail();
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
