// Redraw-hook guard in orders.js: the handler must not schedule timers when the orders flag
// is off, or when a non-main chart has nothing of ours to clear.
// Tests the fix for F11: previously the handler fired on every chart and every price tick
// with no early-exit guard, matching the bug described in the backlog.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const EXT = process.env.DGT_EXTENSION_DIR || path.join(ROOT, 'extension');

// Minimal chart object with the shape orders.js reads.
function makeChart(width, height) {
  return {
    yAxis: [{
      removePlotLine() {},
      addPlotLine() {},
      getExtremes() { return { min: 10, max: 20 }; },
      plotLinesAndBands: [],
      toPixels(v) { return v * 5; },
    }],
    container: {
      isConnected: true,
      getBoundingClientRect() { return { left: 0, top: 0, width, height }; },
      style: { position: 'relative' },
      appendChild() {},
      contains() { return false; },
    },
    series: [{ visible: true, type: 'area', xData: [1, 2, 3], yData: [1, 2, 3], getColumn: null }],
    plotTop: 0, plotHeight: height, plotLeft: 0, plotWidth: width,
  };
}

/**
 * Load and run orders.js in an isolated VM context.
 * Returns helpers to drive the feature and inspect timer calls.
 */
function loadOrders({ flagOrders = true, twoCharts = false, session = false } = {}) {
  const timers = [];
  // session: DEGIRO's own request URL carries the session, rows: rows in DEGIRO's Outstanding panel,
  // clock: virtual time for Date.now(), requests: update requests orders.js made
  const clock = { t: 1_000_000 }, rows = { n: 0 }, requests = [];
  class FakeDate extends Date { static now() { return clock.t; } }
  let featureConfig = null;

  const mainChartObj = makeChart(900, 300);
  const otherChart   = twoCharts ? makeChart(100, 50) : null;
  const allCharts    = twoCharts ? [mainChartObj, otherChart] : [mainChartObj];

  // Capture addEvent handlers per chart so we can fire them manually.
  const handlers = new WeakMap();
  const H = {
    charts: allCharts,
    addEvent(chart, event, fn) {
      if (!handlers.has(chart)) handlers.set(chart, {});
      handlers.get(chart)[event] = fn;
    },
  };

  let currentFlagOrders = flagOrders;
  const getFlags = () => (currentFlagOrders ? { orders: true, ordersClick: false } : {});

  const mockElement = () => ({
    style: { cssText: '' }, innerHTML: '',
    setAttribute() {}, getAttribute() { return null; },
    appendChild(c) { return c; }, contains() { return false; },
    isConnected: false, firstChild: null, children: [],
    getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0 }; },
  });

  const mockDocument = {
    documentElement: {
      getAttribute(a) {
        if (a === 'data-dg-tweaks') return JSON.stringify(getFlags());
        return null;
      },
      setAttribute() {},
    },
    querySelectorAll(sel) { return sel === 'tr[data-name=openOrder]' ? Array.from({ length: rows.n }) : []; },
    querySelector()    { return null; },
    createElement()    { return mockElement(); },
    activeElement: null,
    visibilityState: 'visible',
  };

  const ctx = vm.createContext({
    window: { Highcharts: H, addEventListener() {} },
    document: mockDocument,
    location: {
      hash: '#/products/123/overview',
      origin: 'https://trader.degiro.nl',
      href: 'https://trader.degiro.nl/trader/#/products/123/overview',
    },
    performance:          { getEntriesByType: () => (session ? [{ name: 'https://trader.degiro.nl/notes?intAccount=42&sessionId=SID' }] : []) },
    PerformanceObserver:  class { observe() {} },
    fetch: path => {
      if (!session) return Promise.reject(new Error('no fetch in tests'));
      requests.push(path);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ orders: { value: [] } }) });
    },
    Promise,
    Date: FakeDate,
    setTimeout:           (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout:         () => 0,
    setInterval:          () => 0,
    clearInterval:        () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    AbortSignal:          { timeout: () => ({}) },
    URL:                  global.URL,
    CSS:                  { escape: s => String(s) },
    getComputedStyle:     () => ({ position: 'relative', backgroundColor: 'rgb(255,255,255)', color: '#000' }),
    __dgt: {
      flags:      getFlags,
      pageTheme:  () => ({ bg: '#fff', text: '#000', upText: '#0f0', downText: '#f00', border: '0', shadow: '' }),
      mainChart:  () => mainChartObj,
      parseNum:   n => parseFloat(String(n).replace(',', '.')),
      fmt:        n => String(n),
      SEL: {
        openOrderRow:    'tr[data-name=openOrder]',
        buySellBadge:    '[data-name=buySellBadge]',
        orderQuantity:   '[data-field="quantity"]',
        orderProduct:    '[data-name="productName"]',
        orderPrice:      '[data-field="price"]',
        panelToggle:     'button[data-name=panelToggleButton]',
        drawerToggle:    'button[data-name=totalPortfolioToggle]',
        orderEditButton: 'button[data-name=orderEditButton]',
      },
      LABELS: {
        buyShort: /^[BKAC]$/,
        sellShort: /^[SV]$/,
        buy:  /^(buy|koop|kopen)$/i,
        sell: /^(sell|verkoop|verkopen)$/i,
      },
      page: { productId: () => 123, isProduct: () => true, isOrders: () => false },
      own:     el => el,
      schedule: () => {},
      ownRequests: { add: () => {}, has: () => false },
      feature: cfg => { featureConfig = cfg; },
      t:       key => key,
    },
  });

  const code = fs.readFileSync(path.join(EXT, 'orders.js'), 'utf8');
  vm.runInContext(code, ctx, { filename: path.join(EXT, 'orders.js') });

  return {
    timers,
    handlers,
    clock, rows, requests,
    mainChartObj,
    otherChart,
    setFlagOrders: v => { currentFlagOrders = v; },
    run:  () => featureConfig.run(),
    stop: () => featureConfig.stop(),
  };
}

// --- tests ---

test('redraw handler: does not schedule timers when the orders flag is off', () => {
  const { timers, handlers, mainChartObj, run, stop, setFlagOrders } = loadOrders({ flagOrders: true });

  // Hook the chart while the flag is on.
  run();
  const before = timers.length;

  // Turn the flag off; stop() updates the module-level F to the new value.
  setFlagOrders(false);
  stop();

  // Fire a redraw — the guard must bail out.
  const redraw = handlers.get(mainChartObj)?.redraw;
  assert.ok(redraw, 'main chart redraw handler was registered');
  redraw();

  assert.equal(timers.length, before, 'no timers scheduled when the orders flag is off');
});

test('redraw handler: skips a non-main chart that has nothing to clear', () => {
  const { timers, handlers, otherChart, run } = loadOrders({ flagOrders: true, twoCharts: true });

  // Hook both charts while the flag is on.
  run();
  const before = timers.length;

  // The non-main chart has no layer (render() skips non-main charts), so nothing to clear.
  const redraw = handlers.get(otherChart)?.redraw;
  assert.ok(redraw, 'non-main chart redraw handler was registered');
  redraw();

  assert.equal(timers.length, before, 'no timers scheduled for a non-main chart with no layer content');
});

test('redraw handler: schedules timers for the main chart when the flag is on', () => {
  const { timers, handlers, mainChartObj, run } = loadOrders({ flagOrders: true });

  run();
  const before = timers.length;

  const redraw = handlers.get(mainChartObj)?.redraw;
  assert.ok(redraw, 'main chart redraw handler was registered');
  redraw();

  assert.ok(timers.length > before, 'two timers scheduled for a main-chart redraw when the flag is on');
  assert.equal(timers.length - before, 2, 'exactly two timers (immediate + 700 ms)');
});

// moved from e2e (badges.spec.js): only timer and call-count logic, no layout
test('a new or removed order row in the Outstanding panel reloads the orders once', async () => {
  const { clock, rows, requests, run } = loadOrders({ session: true });
  const settle = () => new Promise(r => setImmediate(r)); // let the fetch continuation finish

  run(); await settle();
  assert.equal(requests.length, 1, 'first poll');

  clock.t += 100; rows.n = 5; run(); await settle(); // panel expanded: 0 -> 5 rows is not an order change
  assert.equal(requests.length, 1, 'expanding the panel does not reload');

  clock.t += 12000; // well past the 5 s minimum gap, before the 20 s poll
  rows.n = 6; run(); await settle(); // a new order row
  assert.equal(requests.length, 2, 'a new row reloads at once (gap > 5 s)');

  clock.t += 2500; rows.n = 5; run(); await settle(); // a row removed, 2.5 s after the reload
  assert.equal(requests.length, 2, 'held back by the 5 s minimum gap');

  clock.t += 3600; run(); await settle(); // 6.1 s since the reload
  assert.equal(requests.length, 3, 'deferred reload fires once past the gap');

  clock.t += 3000; run(); await settle();
  assert.equal(requests.length, 3, 'no further reloads');
});
