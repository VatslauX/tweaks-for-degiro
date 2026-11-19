// Settings UI — used both as the toolbar popup and the Extension options page.
(() => {
  const $ = s => document.querySelector(s);
  const switches = [.../** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('input.switch[data-key]'))];
  const titles = $('#hiddenTitles');
  const status = $('#status');

  const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-i18n]')).forEach(el => {
    el.textContent = t(el.dataset.i18n || '');
  });
  document.documentElement.lang = chrome.i18n.getUILanguage();
  $('#version').textContent = t('optVersion', chrome.runtime.getManifest().version);

  // Feedback: a new GitHub issue on the project's homepage (manifest homepage_url), with the
  // version, Chrome version and language filled in; nothing else about the user or the page.
  // Opened only when clicked; the extension itself sends nothing.
  const feedback = /** @type {HTMLAnchorElement} */ ($('#feedback'));
  try {
    const home = new URL(chrome.runtime.getManifest().homepage_url || '');
    if (home.protocol === 'https:' && home.hostname === 'github.com') {
      const chromeVersion = (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1] || '?';
      const body = ['**What happened**', '', '', '**What you expected**', '', '', '---',
        `Extension ${chrome.runtime.getManifest().version} · Chrome ${chromeVersion} · ${chrome.i18n.getUILanguage()}`].join('\n');
      feedback.href = `${home.origin}${home.pathname.replace(/\/$/, '')}/issues/new?body=${encodeURIComponent(body)}`;
      feedback.hidden = false;
    }
  } catch (e) {} // no homepage: no link

  // Collapsible sections. Which ones are open is kept on this computer only (the popup's localStorage, never
  // synced); anything missing, malformed or unreadable there means every section starts collapsed.
  const OPEN_KEY = 'dgOptOpen';
  const sections = [.../** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('section[data-section]'))];
  /** @returns {Set<string>} */
  function openSections() {
    try {
      const v = JSON.parse(localStorage.getItem(OPEN_KEY) || '[]');
      const ids = sections.map(s => s.dataset.section);
      return new Set(Array.isArray(v) ? v.filter(x => typeof x === 'string' && ids.includes(x)) : []);
    } catch (e) { return new Set(); }
  }
  /** @param {string} id @param {boolean} open */
  function setOpen(id, open) {
    const sec = sections.find(s => s.dataset.section === id);
    const btn = sec?.querySelector('.sec-toggle'), body = sec?.querySelector('.sec-body');
    if (!btn || !body) return;
    btn.setAttribute('aria-expanded', String(open));
    /** @type {HTMLElement} */ (body).hidden = !open;
    const set = openSections();
    if (open) set.add(id); else set.delete(id);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...set])); } catch (e) {} // not stored: still works now
  }
  const startOpen = openSections();
  sections.forEach(sec => {
    const id = sec.dataset.section || '';
    const btn = sec.querySelector('.sec-toggle');
    if (startOpen.has(id)) setOpen(id, true);
    btn?.addEventListener('click', () => setOpen(id, btn.getAttribute('aria-expanded') !== 'true'));
    const title = sec.querySelector('.sec-toggle [data-i18n]')?.textContent || '';
    sec.querySelector('.sec-switch')?.setAttribute('aria-label', t('optSectionAll', title));
  });

  let hideTimer;
  const show = (text, isError) => {
    status.textContent = text;
    status.classList.toggle('error', !!isError);
    status.classList.add('show');
    clearTimeout(hideTimer);
    if (!isError) hideTimer = setTimeout(() => status.classList.remove('show'), 1200);
  };

  // Promise-based so both API errors and quota failures surface here.
  const save = async patch => {
    try {
      await chrome.storage.sync.set(patch);
      show(t('optSaved'));
      return true;
    } catch (e) {
      show(t('optSaveFailed', e?.message || e), true);
      return false;
    }
  };
  // A saved patch, into this page's copy of the settings at once: flags.js re-reads storage only after Chrome's
  // change event, and until then a check or a revert would see the old values (its re-read then sets them again).
  /** @param {Record<string, boolean>} patch */
  const stored = patch => { Object.assign(dgSettings, patch); };

  // A row that needs another setting is greyed out while that setting's switch shows off: read from the switch, so
  // one waiting for its save counts with its new value.
  const syncDepends = () => {
    /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-depends]')).forEach(el =>
      el.classList.toggle('disabled', !switches.find(cb => cb.dataset.key === el.dataset.depends)?.checked));
  };

  // Bulk switches: one per settings section and "All settings" at the top. Their on/off/mixed state is read from
  // the individual switches as shown; the background check counts as shown here (on only with the permissions).
  const bulkSwitches = [.../** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('.sec-switch, #allSwitch'))];
  /** @param {HTMLInputElement} sw @returns {ParentNode} */
  const scopeOf = sw => (sw.id === 'allSwitch' ? document : sw.closest('section') || document);
  /** @param {ParentNode} scope @returns {HTMLInputElement[]} */
  const scopeSwitches = scope => [.../** @type {NodeListOf<HTMLInputElement>} */ (scope.querySelectorAll('input.switch[data-key]'))];
  function renderBulk() {
    bulkSwitches.forEach(sw => {
      const list = scopeSwitches(scopeOf(sw));
      const on = list.filter(cb => cb.checked).length;
      sw.indeterminate = on > 0 && on < list.length;
      // checked: all that a bulk "on" can reach is on (never the background check), so a click on a mixed switch
      // turns everything on, or, when that would change nothing, everything off
      sw.checked = on > 0 && list.every(cb => cb.checked || cb.hasAttribute('data-permission'));
      const count = sw.closest('section')?.querySelector('.sec-count');
      if (count) count.textContent = t('optSectionCount', on, list.length);
    });
  }

  // A switch whose state isn't confirmed yet (its save, or Chrome's answer about the background check's permissions,
  // still pending) is locked: aria-disabled, not `disabled`, which would drop the keyboard focus. The click guard
  // cancels any click on it (mouse, its label row, Space), which puts the checkbox back and fires no change. Every
  // lock takes the bulk switches too: their state is read from switches not confirmed yet. Locks on one switch
  // count; it unlocks when the last is released.
  /** @type {Map<HTMLInputElement, number>} */
  const locks = new Map();
  /** @param {(HTMLInputElement | undefined)[]} els @returns {() => void} release (once) */
  function lock(els) {
    const list = [...new Set([...els, ...bulkSwitches])].filter(/** @returns {el is HTMLInputElement} */ el => !!el);
    list.forEach(el => { locks.set(el, (locks.get(el) || 0) + 1); el.setAttribute('aria-disabled', 'true'); });
    let done = false;
    return () => {
      if (done) return;
      done = true;
      list.forEach(el => {
        const n = (locks.get(el) || 1) - 1;
        if (n > 0) { locks.set(el, n); return; }
        locks.delete(el);
        el.removeAttribute('aria-disabled');
      });
    };
  }
  document.addEventListener('click', e => {
    if (e.target instanceof HTMLInputElement && locks.has(e.target)) e.preventDefault();
  }, true);

  // Check in the background: needs the optional Yahoo host and notifications permissions (see bgStatus below).
  const BG_PERMS = { permissions: /** @type {chrome.runtime.ManifestPermission[]} */ (['notifications']), origins: ['https://query1.finance.yahoo.com/*', 'https://sgbeurs.nl/*'] };
  const bgSwitch = switches.find(cb => cb.hasAttribute('data-permission'));

  dgOnSettings(s => {
    // the background switch shows whether the check runs here, which only bgStatus() knows: never the synced value.
    // A locked switch keeps the value the user gave it: its own save confirms or reverts it.
    switches.forEach(cb => { if (cb !== bgSwitch && !locks.has(cb)) cb.checked = !!s[cb.dataset.key || '']; });
    if (document.activeElement !== titles) titles.value = (s.hiddenTitles || []).join('\n');
    syncDepends();
    renderBulk();
  });

  // Chrome asks for the permissions only inside the click, so request() is called first, before anything is awaited.
  // Chrome's prompt can close this popup; the background worker then switches the setting on when the permissions
  // arrive (permissions.onAdded). Locked until Chrome, the save and the check that follows have answered.
  // A change of the switch on its way (Chrome's prompt, the save, the permissions given back): until it is done, a
  // check (permission events, a settings re-read) leaves the switch as the user set it. bgOwn counts them.
  let bgOwn = 0;
  bgSwitch?.addEventListener('change', async () => {
    const want = bgSwitch.checked;
    const release = lock([bgSwitch]);
    try {
      syncDepends();
      let ok = false;
      bgOwn++;
      try {
        if (want) {
          const got = /** @type {boolean} */ (/** @type {unknown} */ (await chrome.permissions.request(BG_PERMS)));
          ok = got && await save({ alarmsBackground: true });
          if (ok) stored({ alarmsBackground: true });
        } else {
          ok = await save({ alarmsBackground: false });
          if (ok) {
            stored({ alarmsBackground: false });
            await chrome.permissions.remove(BG_PERMS).catch(() => {});
          }
        }
      } catch (e) { show(t('optSaveFailed', e?.message || e), true); } finally { bgOwn--; }
      if (!ok) { bgSwitch.checked = !want; syncDepends(); renderBulk(); }
      else await bgStatus();
    } finally { release(); }
  });

  // The setting syncs across the user's computers, the permissions are granted per computer: the switch shows
  // whether the check runs here (both on), and is locked until Chrome has said. Under it, while on: the last
  // background check (written by background.js; bgLine).
  let bgAsked = 0, bgOn = false;
  async function bgStatus() {
    const asked = ++bgAsked;
    const release = lock([bgSwitch]);
    try {
      let granted = false;
      try { granted = !!(await chrome.permissions.contains(BG_PERMS)); } catch (e) {}
      if (asked !== bgAsked) return; // a later check answers instead
      bgOn = !!dgSettings.alarmsBackground && granted;
      if (bgSwitch && !bgOwn) bgSwitch.checked = bgOn;
      renderBulk();
    } finally { release(); }
    await bgLine();
  }
  // The status line alone: a new status from the worker changes nothing else, so it locks nothing.
  async function bgLine() {
    const el = $('#bgStatus');
    if (!el) return;
    /** @type {any} */ let st = null;
    try { st = (await chrome.storage.local.get({ dgBgStatus: null })).dgBgStatus; } catch (e) {}
    const on = bgOn;
    el.hidden = !on;
    const test = $('#bgTest');
    if (test) test.hidden = !on;
    if (!on && $('#bgTestNote')) /** @type {HTMLElement} */ ($('#bgTestNote')).hidden = true;
    if (el.hidden) return;
    const ok = st && typeof st === 'object' && Number.isFinite(st.at) && st.at > 0;
    const time = ok ? new Date(st.at).toLocaleTimeString(chrome.i18n.getUILanguage(), { hour: '2-digit', minute: '2-digit' }) : '';
    el.textContent = !ok ? t('optBgWaiting')
      : st.err ? t('optBgError', time)
      : t('optBgStatus', time, Number(st.linked) || 0, Number(st.total) || 0);
  }
  // The product's name as the worker's notification shows it: R.label (alarm-rules.js, not loaded here) of an alarm
  // R.sanitize cleaned, which trims its texts and drops a name or symbol that isn't text (the alarm panel saves them
  // capped already). Keep the two alike.
  /** @param {any} a */
  const label = a => [a.name, a.symbol].map(v => (typeof v === 'string' ? v.trim() : '')).find(Boolean) || `#${a.productId}`;
  // A test notification, as a background alarm shows one: for the first switched-on alarm, at its last seen price.
  // Its id has the worker's 'dg|<product id>|…' shape, so a click opens the product as a real one does.
  // A link-styled button: Enter clicks it, Space must too
  $('#bgTest')?.addEventListener('keydown', e => {
    if (/** @type {KeyboardEvent} */ (e).key !== ' ') return;
    e.preventDefault();
    /** @type {HTMLElement} */ (e.currentTarget).click();
  });
  $('#bgTest')?.addEventListener('click', async e => {
    e.preventDefault();
    try {
      const { dgAlarms } = await chrome.storage.sync.get({ dgAlarms: [] });
      const { dgAlarmState } = await chrome.storage.local.get({ dgAlarmState: {} });
      /** @type {any} */ const a = (Array.isArray(dgAlarms) ? dgAlarms : []).find(x => x && x.on && /^\d{1,10}$/.test(String(x.productId)));
      const lang = chrome.i18n.getUILanguage();
      const money = (/** @type {number} */ n) => `${a.currency || ''} ${new Intl.NumberFormat(lang, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n)}`.trim();
      const time = new Date().toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
      const last = a && Number(dgAlarmState?.[a.id]?.last);
      const opts = a && Number.isFinite(Number(a.price))
        ? { title: t(a.dir === 'above' ? 'bannerRose' : 'bannerFell', label(a), money(last > 0 ? last : Number(a.price))),
          message: `${t('bannerAlarm', (a.dir === 'above' ? '↑ ' : '↓ ') + money(Number(a.price)))} · ${t('optBgTestNote', time)}` }
        : { title: t('optBgTest'), message: t('optBgTestNote', time) };
      // Chrome blocked for this extension → 'denied'; otherwise Chrome hands it to the system, which may still hide
      // it (macOS: Chrome's notifications off, or a Focus mode): say so next to the link
      const level = await note('getPermissionLevel').catch(() => 'granted');
      if (level === 'denied') { testNote(t('optBgTestDenied'), true); return; }
      // a test stays until dismissed, so it can't be missed
      await note('create', a ? `dg|${a.productId}|test|${Date.now()}` : `dgtest|${Date.now()}`, { type: 'basic', iconUrl: 'icons/icon128.png', priority: 2, requireInteraction: true, ...opts });
      testNote(t('optBgTestSent', time), false);
    } catch (err) { testNote(t('optBgTestFailed', err?.message || err), true); }
  });
  /**
   * A chrome.notifications call in its callback form: it returns a Promise only from Chrome 116, and the minimum is
   * 111. Chrome's error (runtime.lastError) rejects.
   * @param {'create' | 'getPermissionLevel'} method @param {...any} args @returns {Promise<any>}
   */
  function note(method, ...args) {
    return new Promise((resolve, reject) => {
      /** @type {any} */ (chrome.notifications)[method](...args, (/** @type {any} */ r) => {
        const e = chrome.runtime.lastError;
        if (e) reject(new Error(e.message)); else resolve(r);
      });
    });
  }
  /** @param {string} text @param {boolean} isError */
  function testNote(text, isError) {
    const el = $('#bgTestNote');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error', isError);
    el.hidden = false;
  }
  dgOnSettings(() => { bgStatus(); });
  try {
    chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.dgBgStatus) bgLine(); });
    chrome.permissions.onAdded.addListener(() => bgStatus());
    chrome.permissions.onRemoved.addListener(() => bgStatus());
  } catch (e) {}

  switches.filter(cb => cb !== bgSwitch).forEach(cb => cb.addEventListener('change', async () => {
    const want = cb.checked, key = cb.dataset.key || ''; // set: the selector requires data-key
    const release = lock([cb]); // until the save has answered
    try {
      syncDepends();
      renderBulk();
      if (await save({ [key]: want })) stored({ [key]: want });
      else {
        // not stored: show the stored value. Not `!want`: while locked, the switch skipped settings that arrived
        // (dgSettings has them), e.g. this key changed on another computer meanwhile
        cb.checked = !!dgSettings[key];
        syncDepends();
        renderBulk();
      }
    } finally { release(); }
  }));

  // A bulk change: every switch in scope set on or off, saved in one write, with no memory of the earlier mix.
  // "On" never turns on the background check (Chrome's permission prompt; tickers sent out). "Off" turns it off only
  // where it runs (switch shown on), by its own path: save, then give the permissions back. A computer without the
  // permissions leaves the synced setting alone, or it would switch the check off on the computer where it runs.
  // Every switch in scope is locked until the save, and a background check switched off, have answered.
  /** @param {ParentNode} scope @param {boolean} on */
  async function setAll(scope, on) {
    const release = lock(scopeSwitches(scope));
    try {
      const list = scopeSwitches(scope).filter(cb => !cb.hasAttribute('data-permission') || (!on && cb.checked));
      const bgOff = list.includes(/** @type {HTMLInputElement} */ (bgSwitch));
      /** @type {Record<string, boolean>} */ const patch = {};
      list.forEach(cb => { patch[cb.dataset.key || ''] = on; cb.checked = on; });
      syncDepends();
      renderBulk();
      let ok = false;
      if (bgOff) bgOwn++;
      try {
        ok = await save(patch);
        if (ok) {
          stored(patch);
          if (bgOff) await chrome.permissions.remove(BG_PERMS).catch(() => {});
        }
      } finally { if (bgOff) bgOwn--; }
      if (ok) {
        if (bgOff) await bgStatus();
        return;
      }
      // not stored: show the stored settings again, on the switches this change set (others may wait for a save)
      list.forEach(cb => { if (cb !== bgSwitch) cb.checked = !!dgSettings[cb.dataset.key || '']; });
      syncDepends();
      renderBulk();
      await bgStatus();
    } finally { release(); }
  }
  bulkSwitches.forEach(sw => sw.addEventListener('change', () => { setAll(scopeOf(sw), sw.checked); }));

  // Clear saved data: everything the extension keeps between sessions, back to a fresh install. Synced data goes on
  // every computer of the Chrome profile, which the armed button says; a second click within 5 s erases. Sync first:
  // if that fails nothing else is touched. DEGIRO's own page storage (the cash-columns switch) is out of reach here:
  // the dgWiped marker left in local storage has the DEGIRO tabs drop it (flags.js).
  const clearBtn = /** @type {HTMLButtonElement | null} */ ($('#clearData'));
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let armTimer;
  let wiping = false;
  const disarm = () => {
    clearTimeout(armTimer);
    clearBtn?.removeAttribute('data-armed');
    if (clearBtn) clearBtn.textContent = t('optClearData');
  };
  clearBtn?.addEventListener('click', () => {
    // the background switch's change on its way (Chrome's permission prompt may be open): a wipe now would be undone
    // when it lands (its save, the worker's permissions.onAdded), so the button waits for it, disarmed
    if (wiping) return;
    if (bgOwn > 0) { disarm(); return; }
    if (!clearBtn.hasAttribute('data-armed')) {
      clearBtn.setAttribute('data-armed', '');
      clearBtn.textContent = t('optClearConfirm');
      armTimer = setTimeout(disarm, 5000);
      return;
    }
    disarm();
    wipe();
  });
  /** @returns {Promise<boolean>} */
  async function wipe() {
    wiping = true;
    if (document.activeElement === titles) titles.blur();
    clearTimeout(deb); // a list typed just before must not be saved after
    const release = lock(switches);
    try {
      try { await chrome.storage.sync.clear(); } catch (e) { show(t('optSaveFailed', e?.message || e), true); return false; }
      Object.assign(dgSettings, dgSanitize(null)); // the defaults now; flags.js's re-read finds the same
      // started together, so a popup closed now leaves as little half done as can be; each one's failure is its own
      await Promise.allSettled([
        () => chrome.storage.local.clear(),
        () => chrome.storage.session.clear(),
        () => chrome.permissions.remove(BG_PERMS)
      ].map(async step => step()));
      try { sections.forEach(s => setOpen(s.dataset.section || '', false)); } catch (e) {}
      try { localStorage.clear(); } catch (e) {} // after setOpen, which stores the open sections
      // after the local clear has finished, or that would erase it too
      try { await chrome.storage.local.set({ dgWiped: Date.now() }); } catch (e) {}
      // the switches are locked, so the settings re-read skips them: show the defaults here
      switches.forEach(cb => { if (cb !== bgSwitch) cb.checked = !!dgSettings[cb.dataset.key || '']; });
      titles.value = (dgSettings.hiddenTitles || []).join('\n');
      titles.removeAttribute('aria-invalid');
      syncDepends();
      renderBulk();
      await bgStatus();
      show(t('optCleared'));
      return true;
    } finally { release(); wiping = false; }
  }

  const validate = list => {
    if (list.length > DG_MAX_TITLES) return t('optTooMany', DG_MAX_TITLES);
    const long = list.find(x => x.length > DG_MAX_TITLE_LEN);
    if (long) return t('optTooLong', DG_MAX_TITLE_LEN);
    return null;
  };

  // "On this page": ask the DEGIRO tab which features found what they need.
  // Shown only in the toolbar popup over a DEGIRO tab; elsewhere there is no one to answer.
  const FEATURES = {
    spread: 'optSpread', exDividend: 'optExDividend', compactPricing: 'optCompact',
    periodChange: 'optPeriodChange', chartSelect: 'optChartSelect', orders: 'optOrdersChart',
    portfolio: 'featPortfolio', ordersFilter: 'optOrdersFilter', transactionsFilter: 'optTransactionsFilter',
    navLinks: 'optNavLinks',
    priceAlarms: 'optPriceAlarms',
    hideSections: 'optHideSections'
  };
  const STATES = { ok: 'statusOk', loading: 'statusLoading', idle: 'statusIdle', error: 'statusError', missing: 'statusMissing' };
  async function loadStatus() {
    const box = $('#pageStatus'), list = $('#pageStatusList'), summary = $('#pageStatus .sec-count');
    let res = /** @type {Record<string, string> | null} */ (null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id != null) res = await chrome.tabs.sendMessage(tab.id, { type: 'dg-status' });
    } catch (e) {} // not a DEGIRO tab: no content script to answer
    const status = res; // a const snapshot narrows for the closures below; `res` itself does not
    if (!status) { box.hidden = true; list.replaceChildren(); if (summary) summary.textContent = ''; return; }
    const rows = Object.keys(FEATURES).filter(k => STATES[status[k]]);
    box.hidden = !rows.length;
    // the header's one-line summary, e.g. "5 Working · 1 Not found", in STATES order
    if (summary) {
      summary.textContent = Object.keys(STATES).map(s => [s, rows.filter(k => status[k] === s).length])
        .filter(([, n]) => n).map(([s, n]) => `${n} ${t(s === 'missing' ? 'statusMissingShort' : STATES[s])}`).join(' · ');
    }
    list.replaceChildren(...rows.map(k => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = t(FEATURES[k]);
      const state = document.createElement('span');
      state.textContent = t(STATES[status[k]]);
      state.className = status[k];
      li.append(name, state);
      return li;
    }));
  }
  loadStatus();
  globalThis.dgLoadStatus = loadStatus; // lets the e2e tests refresh it

  let deb;
  titles.addEventListener('input', () => {
    clearTimeout(deb);
    deb = setTimeout(() => {
      const list = titles.value.split('\n').map(x => x.trim()).filter(Boolean);
      const err = validate(list);
      if (err) { show(err, true); titles.setAttribute('aria-invalid', 'true'); return; }
      titles.removeAttribute('aria-invalid');
      save({ hiddenTitles: list });
    }, 400);
  });
})();
