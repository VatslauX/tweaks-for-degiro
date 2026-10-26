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

  switches.forEach(cb => cb.addEventListener('change', async () => {
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
    portfolio: 'featPortfolio', ordersFilter: 'optOrdersFilter', hideSections: 'optHideSections'
  };
  const STATES = { ok: 'statusOk', loading: 'statusLoading', idle: 'statusIdle', error: 'statusError', missing: 'statusMissing' };
  async function loadStatus() {
    const box = $('#pageStatus'), list = $('#pageStatusList');
    let res = null;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id != null) res = await chrome.tabs.sendMessage(tab.id, { type: 'dg-status' });
    } catch (e) {} // not a DEGIRO tab: no content script to answer
    const rows = Object.keys(FEATURES).filter(k => res && STATES[res[k]]);
    box.hidden = !rows.length;
    list.replaceChildren(...rows.map(k => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = t(FEATURES[k]);
      const state = document.createElement('span');
      state.textContent = t(STATES[res[k]]);
      state.className = res[k];
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
