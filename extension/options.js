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

  const syncDepends = s => {
    /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-depends]')).forEach(el =>
      el.classList.toggle('disabled', !s[el.dataset.depends || '']));
  };

  dgOnSettings(s => {
    switches.forEach(cb => { cb.checked = !!s[cb.dataset.key || '']; });
    if (document.activeElement !== titles) titles.value = (s.hiddenTitles || []).join('\n');
    syncDepends(s);
  });

  // Check in the background: needs the optional Yahoo host and notifications permissions. Chrome asks only inside
  // the click, so request() is called first, before anything is awaited. Chrome's prompt can close this popup; the
  // background worker then switches the setting on when the permissions arrive (permissions.onAdded).
  const BG_PERMS = { permissions: /** @type {chrome.runtime.ManifestPermission[]} */ (['notifications']), origins: ['https://query1.finance.yahoo.com/*', 'https://sgbeurs.nl/*'] };
  const bgSwitch = switches.find(cb => cb.hasAttribute('data-permission'));
  bgSwitch?.addEventListener('change', async () => {
    const want = bgSwitch.checked;
    syncDepends({ ...dgSettings, alarmsBackground: want });
    let ok = false;
    try {
      if (want) {
        const got = /** @type {boolean} */ (/** @type {unknown} */ (await chrome.permissions.request(BG_PERMS)));
        ok = got && await save({ alarmsBackground: true });
      } else {
        ok = await save({ alarmsBackground: false });
        if (ok) await chrome.permissions.remove(BG_PERMS).catch(() => {});
      }
    } catch (e) { show(t('optSaveFailed', e?.message || e), true); }
    if (!ok) { bgSwitch.checked = !want; syncDepends(dgSettings); }
    else bgStatus();
  });

  // The setting syncs across the user's computers, the permissions are granted per computer: the switch shows
  // whether the check runs here (both on). Under it, while on: the last background check (written by background.js).
  async function bgStatus() {
    const el = $('#bgStatus');
    let granted = false;
    try { granted = !!(await chrome.permissions.contains(BG_PERMS)); } catch (e) {}
    const on = dgSettings.alarmsBackground && granted;
    if (bgSwitch) bgSwitch.checked = on;
    if (!el) return;
    /** @type {any} */ let st = null;
    try { st = (await chrome.storage.local.get({ dgBgStatus: null })).dgBgStatus; } catch (e) {}
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
    chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.dgBgStatus) bgStatus(); });
    chrome.permissions.onAdded.addListener(() => bgStatus());
    chrome.permissions.onRemoved.addListener(() => bgStatus());
  } catch (e) {}

  switches.filter(cb => cb !== bgSwitch).forEach(cb => cb.addEventListener('change', async () => {
    const want = cb.checked, key = cb.dataset.key || ''; // set: the selector requires data-key
    syncDepends({ ...dgSettings, [key]: want });
    if (!(await save({ [key]: want }))) {
      cb.checked = !want; // revert the switch, the change was not stored
      syncDepends(dgSettings);
    }
  }));

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
    const box = $('#pageStatus'), list = $('#pageStatusList');
    let res = /** @type {Record<string, string> | null} */ (null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id != null) res = await chrome.tabs.sendMessage(tab.id, { type: 'dg-status' });
    } catch (e) {} // not a DEGIRO tab: no content script to answer
    const status = res; // a const snapshot narrows for the closures below; `res` itself does not
    if (!status) { box.hidden = true; list.replaceChildren(); return; }
    const rows = Object.keys(FEATURES).filter(k => STATES[status[k]]);
    box.hidden = !rows.length;
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
