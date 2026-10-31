// The DOM-reading helpers in extension/common.js, against JSDOM: decimal separator, feature flags,
// page-world translations, theme colours, Bid/Ask rows, the main Highcharts chart and the hash routes.
// Pure number parsing and the series helpers are in common.test.js; the scheduler is in
// tests/integration/scheduler.test.js (it needs a page and a clock).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

// common.js reads `document`, `location`, `window` and `getComputedStyle` as globals and is loaded
// once per process, so the globals have to exist before it is required. MutationObserver is left
// undefined on purpose: with it, common.js would start its observer and a 250 ms interval here.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://trader.degiro.nl/trader/#/products/123/overview' });
globalThis.window = /** @type {any} */ (dom.window);
globalThis.document = dom.window.document;
globalThis.location = /** @type {any} */ (dom.window.location);
globalThis.getComputedStyle = el => dom.window.getComputedStyle(el);
const { decimalSep, flags, t, pageTheme, isPriceDt, priceDts, mainChart, page, own, OWN, SEL } =
  require('../../extension/common.js');

/** replace the page body with this markup */
const setBody = markup => { document.body.innerHTML = markup; };
/** @param {string} h */
const atHash = h => { const saved = globalThis.location; globalThis.location = /** @type {any} */ ({ hash: h }); return () => { globalThis.location = saved; }; };

// ── decimal separator (read from DEGIRO's own price fields, cached for 10 s) ────────────────

test('decimal separator: read from a price field, two decimals decide; cached for 10 s', () => {
  const RealDate = globalThis.Date;
  let now = RealDate.now();
  globalThis.Date = /** @type {any} */ (class extends RealDate {
    constructor(/** @type {any[]} */ ...a) { if (a.length) { /* @ts-ignore */ super(...a); } else super(now); }
    static now() { return now; }
  });
  try {
    setBody('<span data-field="LastPrice">—</span>');
    assert.equal(decimalSep(), ',', 'no number on the page: the default, and nothing cached');

    setBody('<span data-field="BidPrice">$1,234.56</span>');
    assert.equal(decimalSep(), '.', 'dot-decimal page');

    setBody('<span data-field="BidPrice">€ 1.234,56</span>');
    assert.equal(decimalSep(), '.', 'still the cached one just after');

    now += 10001;
    assert.equal(decimalSep(), ',', 'read again once the cache is stale');

    // a thousands separator alone must not be taken for the decimal one
    setBody('<span data-field="totalInBaseCurrency">1,234</span>');
    now += 10001;
    assert.equal(decimalSep(), ',', 'three digits after the separator: kept the last good one');

    setBody('<span data-field="RelativeDifference">(+0.59%)</span>');
    now += 10001;
    assert.equal(decimalSep(), '.', 'any of DEGIRO\'s price fields is read');
  } finally {
    globalThis.Date = RealDate;
  }
});

// ── feature flags bridged in data-dg-tweaks ─────────────────────────────────────────────────

test('flags(): parsed from the attribute, re-parsed only when it changes, null when malformed', () => {
  document.documentElement.removeAttribute('data-dg-tweaks');
  assert.equal(flags(), null, 'not bridged yet');

  document.documentElement.setAttribute('data-dg-tweaks', '{"orders":true,"chartSelect":false}');
  const first = flags();
  assert.deepEqual(first, { orders: true, chartSelect: false });
  assert.equal(flags(), first, 'same attribute value: not parsed again');

  document.documentElement.setAttribute('data-dg-tweaks', '{"orders":false}');
  assert.deepEqual(flags(), { orders: false }, 'a change is picked up');

  document.documentElement.setAttribute('data-dg-tweaks', 'not json');
  assert.equal(flags(), null, 'a page that rewrites the attribute cannot break us');

  document.documentElement.setAttribute('data-dg-tweaks', '');
  assert.equal(flags(), null, 'empty value counts as not bridged');
  document.documentElement.removeAttribute('data-dg-tweaks');
});

// ── page-world translations (data-dg-i18n; the page can rewrite it) ─────────────────────────

test('t() in the page world: the key itself until the texts are bridged', () => {
  document.documentElement.removeAttribute('data-dg-i18n');
  assert.equal(t('badgeBuy'), 'badgeBuy', 'no texts yet');
  document.documentElement.setAttribute('data-dg-i18n', '}{ not json');
  assert.equal(t('badgeBuy'), 'badgeBuy', 'malformed value is ignored');
});

test('t() in the page world: substitutions, unknown keys and non-text values', () => {
  document.documentElement.setAttribute('data-dg-i18n', JSON.stringify({ badgeBuy: 'Buy $1 at $2', badgeSell: 'Sell', badgeEdit: { not: 'a string' } }));
  assert.equal(t('badgeBuy', 10, '€ 5'), 'Buy 10 at € 5');
  assert.equal(t('badgeBuy', 10), 'Buy 10 at ', 'a missing substitution is left empty');
  assert.equal(t('badgeSell'), 'Sell');
  assert.equal(t('badgeEdit'), 'badgeEdit', 'a value that is not text falls back to the key');
  assert.equal(t('nothingLikeThis'), 'nothingLikeThis');
  // the texts are read once: a page that rewrites the attribute afterwards changes nothing
  document.documentElement.setAttribute('data-dg-i18n', JSON.stringify({ badgeSell: 'Sold by the page' }));
  assert.equal(t('badgeSell'), 'Sell', 'the bridged texts are kept, not re-read from the page');
});

// ── theme colours taken from the page ───────────────────────────────────────────────────────

test('pageTheme(): the first solid background decides light or dark', () => {
  setBody('<div id="box" style="background-color:rgb(15,23,26)"><span id="inner">x</span></div>');
  document.body.style.color = 'rgb(15, 23, 26)';
  const dark = pageTheme(document.getElementById('inner'));
  assert.equal(dark.dark, true);
  assert.equal(dark.bg, 'rgb(15, 23, 26)', 'transparent ancestors are skipped');
  assert.equal(dark.upText, '#4CB82E');
  assert.equal(dark.downText, '#FF5A5F');
  assert.equal(dark.border, '1px solid rgba(255,255,255,.14)');
  assert.equal(dark.text, 'rgb(15, 23, 26)', 'text colour comes from the page');

  setBody('<div id="box" style="background-color:rgb(255,255,255)"><span id="inner">x</span></div>');
  const light = pageTheme(document.getElementById('inner'));
  assert.equal(light.dark, false);
  assert.equal(light.upText, '#1E8302');
  assert.equal(light.downText, '#E3282B');
  assert.equal(light.border, '0');
});

test('pageTheme(): a see-through background does not count, and a page without one is light', () => {
  setBody('<div id="box" style="background-color:rgba(0,0,0,0.4)"><span id="inner">x</span></div>');
  assert.equal(pageTheme(document.getElementById('inner')).bg, 'rgb(255, 255, 255)', 'alpha 0.4: skipped, then nothing found');
  setBody('<div id="box" style="background-color:rgba(0,0,0,0.8)"><span id="inner">x</span></div>');
  assert.equal(pageTheme(document.getElementById('inner')).dark, true, 'alpha 0.8: counts');
  setBody('<span id="inner">x</span>');
  const none = pageTheme(document.getElementById('inner'));
  assert.equal(none.dark, false);
  assert.equal(none.bg, 'rgb(255, 255, 255)');
  // perceived brightness (0.299r + 0.587g + 0.114b), not the plain average: green weighs most
  setBody('<div style="background-color:rgb(130,130,130)"><span id="inner">x</span></div>');
  assert.equal(pageTheme(document.getElementById('inner')).dark, false, 'light grey');
  setBody('<div style="background-color:rgb(120,120,120)"><span id="inner">x</span></div>');
  assert.equal(pageTheme(document.getElementById('inner')).dark, true, 'dark grey');
  setBody('<div style="background-color:rgb(0,240,0)"><span id="inner">x</span></div>');
  assert.equal(pageTheme(document.getElementById('inner')).dark, false, 'a bright green is a light background');
  setBody('<div style="background-color:rgb(0,0,255)"><span id="inner">x</span></div>');
  assert.equal(pageTheme(document.getElementById('inner')).dark, true, 'pure blue is a dark one');
});

// ── Bid / Ask rows in Pricing data ──────────────────────────────────────────────────────────

test('isPriceDt(): DEGIRO\'s own hook first, the label text in any UI language after', () => {
  setBody(`<dl>
    <div><dt id="bidDt"><span>Bid</span></dt><dd><span data-field="BidPrice">€ 16,90</span></dd></div>
    <div><dt id="askDt"><span>Laat</span></dt><dd><span>€ 16,94</span></dd></div>
    <div><dt id="volDt"><span>Volume</span></dt><dd><span>28,2K</span></dd></div>
  </dl>`);
  const bid = document.getElementById('bidDt'), ask = document.getElementById('askDt'), vol = document.getElementById('volDt');
  assert.equal(isPriceDt(bid, 'Bid'), true, 'found by the hook in the next <dd>');
  assert.equal(isPriceDt(bid, 'Ask'), false);
  assert.equal(isPriceDt(ask, 'Ask'), true, 'nl "Laat" by label');
  assert.equal(isPriceDt(vol, 'Bid'), false);
  assert.equal(isPriceDt(null, 'Bid'), false);
  assert.equal(isPriceDt(document.querySelector('dd'), 'Bid'), false, 'only a <dt> can be a label');

  for (const [label, kind] of [['Bied', 'Bid'], ['Geld', 'Bid'], ['achat', 'Bid'], ['compra', 'Bid'], ['Ask', 'Ask'], ['Brief', 'Ask'], ['vente', 'Ask'], ['lettera', 'Ask']]) {
    setBody(`<dl><div><dt id="dt"> ${label} </dt><dd>1</dd></div></dl>`);
    assert.equal(isPriceDt(document.getElementById('dt'), kind), true, `${label} is a ${kind} row`);
  }
});

test('priceDts(): every copy of the row, the hook before the label, no duplicates', () => {
  setBody(`<dl>
    <div><dt id="a"><span>Bid</span></dt><dd><span data-field="BidPrice">€ 16,90</span><span data-field="BidPrice">€ 16,90</span></dd></div>
    <div><dt id="b"><span>Bid</span></dt><dd><span data-field="BidPrice">€ 16,90</span></dd></div>
    <div><dd><span data-field="BidPrice">no label before it</span></dd></div>
  </dl>`);
  assert.deepEqual(priceDts('Bid').map(dt => dt.id), ['a', 'b'], 'both copies once; a <dd> without a <dt> is dropped');
  assert.deepEqual(priceDts('Ask'), [], 'no Ask row at all');

  setBody(`<dl>
    <div><dt id="a">Bid</dt><dd>€ 16,90</dd></div>
    <div><dt id="b">Bied</dt><dd>€ 16,90</dd></div>
    <div><dt id="c">Ask</dt><dd>€ 16,94</dd></div>
  </dl>`);
  assert.deepEqual(priceDts('Bid').map(dt => dt.id), ['a', 'b'], 'label fallback, every language');
  assert.deepEqual(priceDts('Ask').map(dt => dt.id), ['c']);
});

// ── the main chart (page world) ─────────────────────────────────────────────────────────────

test('mainChart(): the largest connected chart with a price series', () => {
  const chart = (w, h, { connected = true, series } = /** @type {any} */ ({})) => ({
    container: { isConnected: connected, getBoundingClientRect: () => ({ width: w, height: h }) },
    series: series || [{ visible: true, type: 'line', xData: [1, 2, 3] }]
  });
  const hc = /** @type {any} */ (window);
  assert.equal(mainChart(), null, 'no Highcharts on the page');
  hc.Highcharts = { charts: [] };
  assert.equal(mainChart(), null, 'no charts');

  const mini = chart(100, 60), main = chart(900, 320);
  hc.Highcharts = { charts: [undefined, mini, main] };
  assert.equal(mainChart(), main, 'the biggest one wins, a hole in the list is skipped');

  hc.Highcharts = { charts: [mini, chart(2000, 800, { connected: false }), chart(2000, 800, { series: [{ visible: true, type: 'column', xData: [1, 2, 3] }] }), chart(2000, 800, { series: [{ visible: false, type: 'line', xData: [1, 2, 3] }] }), chart(2000, 800, { series: [{ visible: true, type: 'line', xData: [1] }] })] };
  assert.equal(mainChart(), mini, 'detached, volume-only, hidden and single-point charts do not count');
  delete hc.Highcharts;
});

// ── hash routes ─────────────────────────────────────────────────────────────────────────────

test('routes: product, Orders, Transactions and a sticky dg=alarms query on a list', () => {
  const cases = [
    ['#/products/456/overview', { productId: 456, isProduct: true, isOrders: false, isTransactions: false, hasAlarmsQuery: false }],
    ['#/products', { productId: 0, isProduct: false }],
    ['#/orders/open', { isOrders: true, isTransactions: false }],
    ['#/orders/history', { isOrders: false }],
    ['#/transactions', { isTransactions: true, isOrders: false }],
    ['#/transactions?from=1', { isTransactions: true }],
    ['#/favourites/9?dg=alarms', { hasAlarmsQuery: true, isAlarms: false, isFavourites: true }],
    ['#/favourites?dg=alarms', { hasAlarmsQuery: true, isAlarms: true }],
    ['#/favourites/9?dg=', { hasAlarmsQuery: false }],
    ['#/portfolio/assets?dg=alarms', { hasAlarmsQuery: false, isFavourites: false }]
  ];
  for (const [hash, want] of cases) {
    const restore = atHash(hash);
    try {
      for (const [key, value] of Object.entries(want)) assert.equal(page[key](), value, `${hash} → ${key}`);
    } finally { restore(); }
  }
});

test('isPortfolio(): decided by DEGIRO\'s performance chart, not the route', () => {
  setBody('<div>no chart here</div>');
  assert.equal(page.isPortfolio(), false);
  setBody('<div data-name="performance-chart"></div>');
  assert.equal(page.isPortfolio(), true);
  assert.equal(SEL.perfChart, '[data-name="performance-chart"]');
});

test('own(): marks our own element so the scheduler ignores its changes', () => {
  const el = document.createElement('div');
  assert.equal(own(el), el, 'returns the element');
  assert.equal(el.hasAttribute(OWN), true);
  assert.equal(OWN, 'data-dg-own');
});
