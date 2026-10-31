// Period change in the product header (period.js, page world): which period is selected, whether the
// chart already holds that period's data, and the change it then shows. period.js and common.js are
// loaded in a VM context with a JSDOM page and a fake Highcharts chart, the same way
// tests/integration/alarm-lines.test.js loads the other page-world script — the isolated-world
// harness cannot run them (they are the manifest's world: MAIN entry and have no chrome.*).
// Layout and real Highcharts stay in tests/e2e/period.spec.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { EXT } = require('./harness');

const ID = 'dg-period-change';
const DAY = 864e5;

// DEGIRO's product header: the price, the daily change in <h4>s, and the period buttons under the chart
const HEADER = `
  <div id="priceRow">
    <div id="priceHeader">
      <span data-id="123" data-field="CurrentPrice" title="16,92">€16,92</span>
      <span id="dayChange"><h4><span data-field="AbsoluteDifference">+0,10</span></h4><h4><span data-field="RelativeDifference">(+0,59%)</span></h4></span>
    </div>
  </div>`;
const OFF = 'background-color:rgb(255,255,255)', ON = 'background-color:rgb(15,23,26)';
/** the period buttons, with `on` styled differently from the rest (as DEGIRO styles the selected one) */
const buttons = (on, labels = ['YTD', '1 D', '1 W', '1 M', '3 M', '6 M', '1 Y', 'ALL']) =>
  `<div id="periods">${labels.map(l => `<button style="${l.replace(' ', '') === on ? ON : OFF}">${l}</button>`).join('')}</div>`;

/** a price series: `points` prices evenly spread over `days`, ending now */
const series = (days, points, from, to) => {
  const xData = [], yData = [];
  const end = Date.now(), start = end - days * DAY;
  for (let i = 0; i < points; i++) {
    xData.push(start + (end - start) * (i / (points - 1)));
    yData.push(from + (to - from) * (i / (points - 1)));
  }
  return { visible: true, type: 'line', xData, yData };
};

/**
 * Load common.js and period.js in one VM context.
 * @param {{ body?: string, flags?: any, chartSeries?: any[], hash?: string, texts?: any }} [o]
 */
function load({ body = HEADER + buttons('1M'), flags = { periodChange: true }, chartSeries, hash = '/products/123/overview', texts } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { url: `https://trader.degiro.nl/trader/#${hash}` });
  const win = dom.window, doc = win.document;
  if (flags) doc.documentElement.setAttribute('data-dg-tweaks', JSON.stringify(flags));
  if (texts) doc.documentElement.setAttribute('data-dg-i18n', JSON.stringify(texts));
  // JSDOM has no layout: everything the page shows gets a height, nothing with display:none does
  win.Element.prototype.getBoundingClientRect = function() {
    const hidden = win.getComputedStyle(this).display === 'none';
    return /** @type {any} */ ({ width: hidden ? 0 : 100, height: hidden ? 0 : 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0 });
  };
  const chart = { container: doc.getElementById('priceRow'), series: chartSeries === undefined ? [series(30, 20, 16.5, 17)] : chartSeries };
  win.Highcharts = { charts: [chart] };

  /** @type {(() => void)[]} */ const frames = [];
  /** @type {(() => void)[]} */ const timers = [];
  // a clock the test can move on: the scheduler reports 'missing' as 'loading' for the first 8 s
  let offset = 0;
  const RealDate = Date;
  class Clock extends RealDate {
    constructor(/** @type {any[]} */ ...a) { if (a.length) { super(...(/** @type {[any]} */ (a))); } else super(RealDate.now() + offset); }
    static now() { return RealDate.now() + offset; }
  }
  const ctx = vm.createContext({
    window: win, document: doc, location: win.location, Date: Clock, JSON, Math, Object, Array, String, Number, console,
    getComputedStyle: (/** @type {any} */ el) => win.getComputedStyle(el),
    addEventListener: (/** @type {any[]} */ ...a) => win.addEventListener(...a),
    requestAnimationFrame: (/** @type {() => void} */ fn) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: () => {},
    setTimeout: (/** @type {() => void} */ fn) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    MutationObserver: class { observe() {} disconnect() {} },
    CustomEvent: win.CustomEvent, MouseEvent: win.MouseEvent, Element: win.Element
  });
  for (const file of ['common.js', 'period.js']) vm.runInContext(fs.readFileSync(path.join(EXT, file), 'utf8'), ctx, { filename: `extension/${file}` });
  const dgt = vm.runInContext('__dgt', ctx);

  /** run everything the scheduler has queued (frames first, then the throttle timers they set) */
  const flush = () => {
    for (let i = 0; i < 20 && (frames.length || timers.length); i++) {
      frames.splice(0).forEach(fn => fn());
      timers.splice(0).forEach(fn => fn());
    }
  };
  flush();
  return {
    doc, win, chart, flush, dgt,
    /** a settings or DOM change: the features run again without waiting for the throttle */
    rerun: () => { dgt.schedule(true); flush(); },
    /** move the page's clock on (the 8 s window in which 'missing' still reads 'loading') */
    skip: (/** @type {number} */ ms) => { offset += ms; dgt.schedule(true); flush(); },
    status: () => dgt.status().periodChange,
    item: () => doc.getElementById(ID),
    label: () => doc.getElementById(ID)?.firstElementChild.textContent,
    value: () => doc.getElementById(ID)?.lastElementChild.textContent,
    color: () => doc.getElementById(ID)?.lastElementChild.style.color
  };
}

test('the change over the selected period, in the header container, before the other items', async () => {
  const p = load({ texts: { periodTitle: 'Change over $1' } });
  assert.equal(p.status(), 'ok');
  assert.equal(p.label(), '1M');
  assert.equal(p.value(), '+0,50 (+3,03%)', '16,50 → 17,00 over the 1M chart');
  assert.equal(p.color(), 'rgb(30, 131, 2)', 'DEGIRO\'s green for a rise');
  assert.equal(p.item().title, 'Change over 1M', 'the bridged text, with the period filled in');
  const box = p.item().parentElement;
  assert.equal(box.getAttribute('data-dg-header'), '', 'the container our header items share');
  assert.equal(box.previousElementSibling.id, 'priceHeader', 'right after DEGIRO\'s price line');
  assert.equal(p.item().getAttribute('data-dg-rank'), '0', 'first, before the spread and the dates');
  assert.equal(p.item().hasAttribute('data-dg-own'), true);
});

test('a fall is shown with the minus and DEGIRO\'s red; prices under 10 get three decimals', () => {
  const p = load({ chartSeries: [series(30, 20, 9.5, 9)] });
  assert.equal(p.value(), '-0,500 (-5,26%)');
  assert.equal(p.color(), 'rgb(227, 40, 43)');
});

test('a candlestick series: the close of the first and last point', () => {
  const s = series(30, 20, 16.5, 17);
  s.type = 'candlestick';
  s.yData = s.yData.map(v => [v - 0.2, v + 0.3, v - 0.4, v]);
  const p = load({ chartSeries: [s] });
  assert.equal(p.value(), '+0,50 (+3,03%)');
});

test('1 D is left to DEGIRO, which shows the daily change itself', () => {
  const p = load({ body: HEADER + buttons('1D') });
  assert.equal(p.item(), null);
  assert.equal(p.status(), 'idle');
});

test('ALL is always shown; a chart that does not cover the period yet is not', () => {
  const all = load({ body: HEADER + buttons('ALL'), chartSeries: [series(4000, 50, 5, 20)] });
  assert.equal(all.value(), '+15,00 (+300,00%)', 'no window to check for ALL');

  // the 1M button is already selected, but the chart still holds the 1W data
  const stale = load({ body: HEADER + buttons('1M'), chartSeries: [series(5, 20, 16.5, 17)] });
  assert.equal(stale.item(), null, 'nothing until the new data arrives');
  assert.equal(stale.status(), 'ok', 'and that is not a missing page, just a loading chart');

  // a chart far longer than the period is not that period's data either
  const tooLong = load({ body: HEADER + buttons('1M'), chartSeries: [series(200, 20, 16.5, 17)] });
  assert.equal(tooLong.item(), null);
});

test('1 W only has to be longer than one session; YTD is measured from 1 January', () => {
  const week = load({ body: HEADER + buttons('1W'), chartSeries: [series(3, 30, 16.5, 17)] });
  assert.equal(week.label(), '1W', 'three trading days of intraday points are a 1W chart');

  const intraday = load({ body: HEADER + buttons('1W'), chartSeries: [series(0.4, 30, 16.5, 17)] });
  assert.equal(intraday.item(), null, 'a single session is not');

  const sinceJan = (Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / DAY;
  const ytd = load({ body: HEADER + buttons('YTD'), chartSeries: [series(Math.max(1, sinceJan * 0.9), 40, 16.5, 17)] });
  assert.equal(ytd.label(), 'YTD');
});

test('the selected period is the button styled differently; a click is remembered through a hover', () => {
  const p = load({ body: HEADER + buttons('1M') });
  assert.equal(p.label(), '1M');

  // a click on 3 M: DEGIRO restyles its buttons and loads the new data only afterwards
  const threeM = [...p.doc.querySelectorAll('#periods button')].find(b => b.textContent === '3 M');
  threeM.dispatchEvent(new p.win.MouseEvent('click', { bubbles: true }));
  p.rerun();
  assert.equal(p.item(), null, 'the click counts at once, so the 1M data no longer matches');
  p.chart.series = [series(91, 40, 16, 17)];
  p.rerun();
  assert.equal(p.label(), '3M', 'the clicked period, although no button is styled as selected yet');

  // hovering another button makes two buttons differ from the rest: the last known period stays
  [...p.doc.querySelectorAll('#periods button')].find(b => b.textContent === '6 M').setAttribute('style', 'background-color:rgb(230,235,237)');
  p.rerun();
  assert.equal(p.label(), '3M');
});

test('no period buttons, or too few to tell them apart: the page is not the one we know', () => {
  const none = load({ body: HEADER });
  assert.equal(none.item(), null);
  assert.equal(none.status(), 'loading', 'a page that only just opened may still be building');
  none.skip(9000);
  assert.equal(none.status(), 'missing');

  const two = load({ body: HEADER + buttons('1M', ['1 M', '1 Y']) });
  two.skip(9000);
  assert.equal(two.status(), 'missing', 'fewer than three buttons could be anything');

  // every button styled the same: nothing says which period is selected
  const flat = load({ body: HEADER + buttons('none') });
  flat.skip(9000);
  assert.equal(flat.status(), 'missing');
});

test('without the daily change in the header there is nowhere to put it', () => {
  const p = load({ body: `<div id="priceRow"><div id="priceHeader"><span data-field="CurrentPrice">€16,92</span></div></div>${buttons('1M')}` });
  assert.equal(p.item(), null);
  p.skip(9000);
  assert.equal(p.status(), 'missing');
});

test('a hidden copy of the header (DEGIRO\'s sticky one) is not used', () => {
  const p = load({ body: `<div style="display:none">${HEADER}</div>${HEADER}${buttons('1M')}` });
  assert.equal(p.item().parentElement.previousElementSibling.id, 'priceHeader');
  assert.equal(p.doc.querySelectorAll(`#${ID}`).length, 1, 'one item, in the visible header');
});

test('no chart with a price series: nothing is shown', () => {
  assert.equal(load({ chartSeries: [] }).item(), null);
  assert.equal(load({ chartSeries: [{ visible: true, type: 'column', xData: [1, 2, 3], yData: [1, 2, 3] }] }).item(), null, 'a volume chart is no price chart');
  assert.equal(load({ chartSeries: [series(30, 20, 0, 0)] }).item(), null, 'prices of 0 are no prices');
  assert.equal(load({ chartSeries: [series(30, 20, 0, 0)] }).status(), 'ok');
});

test('switched off, or not bridged at all: nothing runs', () => {
  const off = load({ flags: { periodChange: false } });
  assert.equal(off.item(), null);
  assert.equal(off.status(), 'off');

  const notBridged = load({ flags: null });
  assert.equal(notBridged.item(), null);
  assert.equal(notBridged.status(), 'off', 'before the first good settings read nothing is on');

  // switched on live, through the attribute the isolated world writes
  notBridged.doc.documentElement.setAttribute('data-dg-tweaks', JSON.stringify({ periodChange: true }));
  notBridged.rerun();
  assert.equal(notBridged.label(), '1M');

  // and off again: the item goes, the empty container with it
  notBridged.doc.documentElement.setAttribute('data-dg-tweaks', JSON.stringify({ periodChange: false }));
  notBridged.rerun();
  assert.equal(notBridged.item(), null);
  assert.equal(notBridged.doc.querySelector('[data-dg-header]'), null);
});

test('nothing outside a product page', () => {
  const p = load({ hash: '/favourites' });
  assert.equal(p.item(), null);
  assert.equal(p.status(), 'idle');
});

test('running again leaves one item, in place, and tells the isolated world its status', () => {
  const p = load();
  const first = p.item();
  p.rerun(); p.rerun();
  assert.equal(p.doc.querySelectorAll(`#${ID}`).length, 1);
  assert.equal(p.item(), first, 'the same element is kept while nothing changed');
  // the page world has no chrome.*: it hands its status over in an attribute status.js reads
  assert.deepEqual(JSON.parse(p.doc.documentElement.getAttribute('data-dg-status')), { periodChange: 'ok' });
});
