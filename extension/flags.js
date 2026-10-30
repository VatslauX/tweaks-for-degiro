// Feature flags shared by the content scripts and the settings page.
// Stored in chrome.storage.sync (syncs across your Chrome profiles).
const DG_DEFAULTS = {
  spread: true,        // Spread row in Pricing data
  headerSpread: true,  // current spread % in the product header
  exDividend: true,    // ex-dividend date in the product header (links to Dividends)
  earningsDate: true,  // next earnings date in the product header (links to Earnings)
  compactPricing: true, // tighter row spacing in Pricing data
  periodChange: true,  // change over the selected chart period next to the daily change
  chartSelect: true,   // drag-to-select range on the chart
  orders: true,        // open orders on the chart
  ordersClick: true,   // click an order badge to open "Adjust order"
  adjustClose: true,   // click outside "Adjust order" closes it
  navLinks: true,      // Orders, Transactions and Alarms in the left sidebar
  priceAlarms: true,   // price alarms: Alarm button on favourites, Alarms page, banner (alarms*.js)
  alarmLines: true,    // price alarms as gold badges on the product chart (needs priceAlarms too)
  alarmLinesClick: true, // click an alarm badge to open the alarm editor for that price
  ordersFilter: true,  // Orders page: filters and buy/sell totals
  ordersHiddenColumns: ['exchange'], // Orders columns to hide (DG_ORDER_COLUMNS)
  ordersSort: true,    // Orders → Outstanding: remember the sort column/direction across visits (orders-table.js)
  transactionsFilter: true, // Transactions page: filters, buy/sell/net totals and fees
  txHiddenColumns: ['exchange', 'venue', 'exchangeRate', 'autoFxFee'], // Transactions columns to hide (DG_TX_COLUMNS)
  hideSections: true,  // hide sections listed below
  // DEGIRO's Cash compensation section is also found by its hook, in any language
  hiddenTitles: ['Cash compensation', 'Cash compensatie', 'Barausgleich', 'Compensation espèces']
};

// Transactions columns that can be hidden (Product never can).
const DG_TX_COLUMNS = ['date', 'symbolIsin', 'exchange', 'venue', 'action', 'qty', 'price', 'localValue',
  'value', 'exchangeRate', 'autoFxFee', 'fees', 'total'];

// Orders → Outstanding columns that can be hidden (Product never can).
const DG_ORDER_COLUMNS = ['date', 'symbolIsin', 'exchange', 'action', 'qty', 'limit', 'stopPrice', 'value',
  'outstanding', 'executed'];

// Flags read by the page-context scripts — the only ones exposed to the page.
const DG_PAGE_FLAGS = ['periodChange', 'chartSelect', 'orders', 'ordersClick', 'alarmLines', 'alarmLinesClick'];

const dgSettings = { ...DG_DEFAULTS };
const dgListeners = [];

// Call fn now and every time settings change.
function dgOnSettings(fn) { dgListeners.push(fn); fn(dgSettings); }

// Limits for the editable list (also keeps us well inside chrome.storage.sync quotas).
const DG_MAX_TITLES = 30;
const DG_MAX_TITLE_LEN = 100;

// Coerce stored values to the expected types; anything malformed falls back to the default.
function dgSanitize(s) {
  const out = { ...DG_DEFAULTS };
  if (!s || typeof s !== 'object') return out;
  for (const k of Object.keys(DG_DEFAULTS)) {
    if (Array.isArray(DG_DEFAULTS[k])) continue; // lists: below
    if (typeof s[k] === 'boolean') out[k] = s[k];
    else if (s[k] != null) out[k] = !!s[k];
  }
  if (Array.isArray(s.hiddenTitles)) {
    out.hiddenTitles = s.hiddenTitles
      .filter(t => typeof t === 'string')
      .map(t => t.trim().slice(0, DG_MAX_TITLE_LEN))
      .filter(Boolean)
      .slice(0, DG_MAX_TITLES);
  }
  if (Array.isArray(s.txHiddenColumns)) out.txHiddenColumns = DG_TX_COLUMNS.filter(c => s.txHiddenColumns.includes(c));
  if (Array.isArray(s.ordersHiddenColumns)) out.ordersHiddenColumns = DG_ORDER_COLUMNS.filter(c => s.ordersHiddenColumns.includes(c));
  return out;
}

(() => {
  const apply = s => {
    Object.assign(dgSettings, dgSanitize(s));
    // Bridge to page-context scripts (chart-select.js, orders.js), which can't read chrome.storage.
    // The page can read this attribute, so pass only the flags those scripts need.
    if (location.protocol.startsWith('http')) {
      const bridged = {};
      DG_PAGE_FLAGS.forEach(k => { bridged[k] = !!dgSettings[k]; });
      document.documentElement.setAttribute('data-dg-tweaks', JSON.stringify(bridged));
    }
    dgListeners.forEach(fn => { try { fn(dgSettings); } catch (e) {} });
  };
  // A failed read (lastError, no result, an exception) must not apply the defaults: that would switch
  // back on what the user switched off. Keep the last good settings (before the first good read, the
  // defaults every script starts with; the page-world flags stay unpublished) and read again later.
  let dead = false, retries = 0, retryTimer = 0;
  const failed = () => {
    let alive = false;
    try { alive = !!chrome.runtime?.id; } catch (e) {}
    if (dead || !alive || retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = 0; read(); }, Math.min(30000, 1000 * 2 ** retries++));
  };
  const read = () => {
    if (dead) return;
    try {
      chrome.storage.sync.get(DG_DEFAULTS, items => {
        let err = null;
        try { err = chrome.runtime?.lastError; } catch (e) {}
        if (dead) return;
        if (err || !items || typeof items !== 'object') return failed();
        retries = 0;
        apply(items);
      });
    } catch (e) { failed(); }
  };
  read();
  try {
    chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync') read(); });
  } catch (e) {}

  // Disabling, removing or updating the extension leaves the scripts already in open tabs running,
  // the page-world ones too. Once our context is gone, switch every feature off, so nothing keeps
  // polling DEGIRO or changing the page until the tab is reloaded.
  if (location.protocol.startsWith('http')) {
    const timer = setInterval(() => {
      let alive = false;
      try { alive = !!chrome.runtime?.id; } catch (e) {}
      if (alive) return;
      clearInterval(timer);
      dead = true;
      clearTimeout(retryTimer);
      /** @type {Record<string, boolean>} */
      const off = {};
      for (const k of Object.keys(DG_DEFAULTS)) if (!Array.isArray(DG_DEFAULTS[k])) off[k] = false;
      apply(off);
    }, 2000);
  }
})();

