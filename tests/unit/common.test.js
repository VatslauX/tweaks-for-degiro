// Shared helpers in extension/common.js: one number parser/formatter for every script.
const { test } = require('node:test');
const assert = require('node:assert');
const { parseNum, fmt, xs, ys, isPriceSeries, priceSeries, page } = require('../../extension/common.js');

test('parses DEGIRO prices in both formats', () => {
  assert.strictEqual(parseNum('€ 1.234,56', ','), 1234.56);
  assert.strictEqual(parseNum('$1,234.56', '.'), 1234.56);
  assert.strictEqual(parseNum('$ 648,85', ','), 648.85);
  assert.strictEqual(parseNum('639,6901', ','), 639.6901);
  assert.strictEqual(parseNum('€ \u22123.603,00', ','), -3603);
  assert.strictEqual(parseNum('-48,67', ','), -48.67);
  assert.strictEqual(parseNum('1.234.567,8', ','), 1234567.8);
});

test('one separator only: decided by the page format', () => {
  // comma-decimal page (DEGIRO NL/EN with "648,85")
  assert.strictEqual(parseNum('130,995', ','), 130.995);
  assert.strictEqual(parseNum('1.000', ','), 1000);      // thousands
  assert.strictEqual(parseNum('1.234', ','), 1234);      // used to be 1.234 in content.js, 1234 in orders.js
  assert.strictEqual(parseNum('12.5', ','), 12.5);       // not a thousands pattern
  // dot-decimal page
  assert.strictEqual(parseNum('1,000', '.'), 1000);
  assert.strictEqual(parseNum('130.995', '.'), 130.995);
  assert.strictEqual(parseNum('1,234,567', '.'), 1234567);
});

test('no number -> NaN', () => {
  assert.ok(Number.isNaN(parseNum('', ',')));
  assert.ok(Number.isNaN(parseNum('—', ',')));
  assert.ok(Number.isNaN(parseNum(null, ',')));
});

test('formats like the page', () => {
  assert.strictEqual(fmt(1234.5, 2, 2, ','), '1.234,50');
  assert.strictEqual(fmt(1234.5, 2, 2, '.'), '1,234.50');
  assert.strictEqual(fmt(17.65, 2, 4, ','), '17,65');
  assert.strictEqual(fmt(0.12345, 2, 4, ','), '0,1235');
  assert.strictEqual(fmt(1000, 0, 4, ','), '1.000');
});

test('series data: getColumn() when available (newer Highcharts), xData/yData otherwise', () => {
  const old = { visible: true, type: 'area', xData: [1, 2, 3], yData: [5, 6, 7] };
  const cols = { x: [10, 20], y: [1, 2] };
  const modern = { visible: true, type: 'line', getColumn: k => cols[k] };
  assert.deepStrictEqual(xs(old), [1, 2, 3]);
  assert.deepStrictEqual(ys(old), [5, 6, 7]);
  assert.deepStrictEqual(xs(modern), [10, 20]);
  assert.deepStrictEqual(ys(modern), [1, 2]);
  assert.deepStrictEqual(xs(undefined), []);
});

test('price series: visible price types only, the longest wins', () => {
  const area = { visible: true, type: 'area', xData: [1, 2, 3] };
  const shortLine = { visible: true, type: 'line', xData: [1, 2] };
  const volume = { visible: true, type: 'column', xData: [1, 2, 3, 4] };
  const hidden = { visible: false, type: 'line', xData: [1, 2, 3, 4, 5] };
  assert.ok(isPriceSeries(area) && !isPriceSeries(volume) && !isPriceSeries(hidden));
  assert.strictEqual(priceSeries({ series: [shortLine, volume, hidden, area] }), area);
  assert.strictEqual(priceSeries({ series: [volume] }), undefined);
});

test('price alarm routes: Favourites and the Alarms page', () => {
  const saved = globalThis.location;
  const at = hash => { globalThis.location = /** @type {any} */ ({ hash }); };
  try {
    at('#/favourites'); assert.ok(page.isFavourites()); assert.ok(!page.isAlarms());
    at('#/favourites?dg=alarms'); assert.ok(page.isFavourites()); assert.ok(page.isAlarms());
    at('#/favourites?x=1&dg=alarms'); assert.ok(page.isAlarms());
    at('#/favourites?dg=alarmsX'); assert.ok(!page.isAlarms());
    at('#/products/1/overview?dg=alarms'); assert.ok(!page.isAlarms()); assert.ok(!page.isFavourites());
    at('#/favouritesX'); assert.ok(!page.isFavourites());
  } finally {
    if (saved === undefined) delete globalThis.location; else globalThis.location = saved;
  }
});
