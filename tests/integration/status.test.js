// status.js: the answer to the toolbar popup's "dg-status" message. The isolated world's own feature
// statuses come from the scheduler; the page world's come through the data-dg-status attribute, which
// the page itself can write — so only known feature names with known values are accepted, and they can
// never overwrite an isolated-world status. Nothing is stored or sent anywhere.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('./harness');

const noErrors = w => assert.deepEqual(w.errors.map(e => e.stack || String(e)), []);
const VALUES = ['ok', 'idle', 'missing', 'loading', 'off', 'error'];
const ask = tab => tab.message({ type: 'dg-status' });

const PRODUCT_GLOBALS = {
  __MOCK_NO_URL_SESSION: true,
  Highcharts: { Chart: function() { return { series: [{ setData() {}, data: [{ update() {} }] }] }; } }
};

test('reports every isolated-world feature with a known value', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'degiro', hash: '/products/123/overview', globals: PRODUCT_GLOBALS });
  await w.advance(500);
  const status = ask(tab);
  for (const [name, value] of Object.entries(status)) assert.ok(VALUES.includes(value), `${name}=${value} is a known value`);
  for (const name of ['spread', 'exDividend', 'earningsDate', 'compactPricing', 'hideSections', 'navLinks', 'priceAlarms'])
    assert.ok(name in status, `${name} is reported`);
  assert.equal(status.hideSections, 'ok', 'it hid DEGIRO\'s Cash compensation section');
  assert.deepEqual(status, tab.json('__dgt.status()'), 'the scheduler\'s own view, unchanged');
  noErrors(w);
});

test('a feature that is switched off says so', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'degiro', hash: '/products/123/overview', settings: { hideSections: false }, globals: PRODUCT_GLOBALS });
  await w.advance(500);
  assert.equal(ask(tab).hideSections, 'off');
  await tab.setFlag('hideSections', true);
  await w.advance(500);
  assert.equal(ask(tab).hideSections, 'ok');
  noErrors(w);
});

test('the page world\'s own statuses are added', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'degiro', hash: '/products/123/overview', globals: PRODUCT_GLOBALS });
  await w.advance(500);
  tab.document.documentElement.setAttribute('data-dg-status',
    JSON.stringify({ chartSelect: 'ok', orders: 'missing', periodChange: 'error', portfolio: 'idle' }));
  await w.flush();
  const status = ask(tab);
  assert.equal(status.chartSelect, 'ok');
  assert.equal(status.orders, 'missing');
  assert.equal(status.periodChange, 'error');
  assert.equal(status.portfolio, 'idle');
  noErrors(w);
});

test('a page that writes the attribute itself cannot add, rename or change a status', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'degiro', hash: '/products/123/overview', globals: PRODUCT_GLOBALS });
  await w.advance(500);
  const own = ask(tab);
  assert.equal(own.hideSections, 'ok');

  tab.document.documentElement.setAttribute('data-dg-status', JSON.stringify({
    spread: 'error',          // a real feature name, but not one the page world reports
    hideSections: 'error',
    evil: 'ok',               // not a feature at all
    orders: 'nonsense',       // not one of the known values
    chartSelect: '<script>alert(1)</script>',
    periodChange: { toString: 'ok' },
    portfolio: ['ok']
  }));
  await w.flush();
  const status = ask(tab);
  assert.equal(status.hideSections, own.hideSections, 'an isolated-world status is never overwritten by the page');
  assert.equal(status.spread, own.spread);
  assert.ok(!('evil' in status), 'an unknown name is dropped');
  assert.ok(!('orders' in status), 'an unknown value is dropped');
  assert.ok(!('chartSelect' in status));
  assert.ok(!('periodChange' in status));
  assert.ok(!('portfolio' in status));
  for (const value of Object.values(status)) assert.ok(VALUES.includes(value));
  noErrors(w);
});

test('a malformed or missing attribute is ignored, the isolated world still answers', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'degiro', hash: '/products/123/overview', globals: PRODUCT_GLOBALS });
  await w.advance(500);
  for (const raw of ['', 'not json', 'null', '"ok"', '42', '[{"orders":"ok"}]']) {
    tab.document.documentElement.setAttribute('data-dg-status', raw);
    await w.flush();
    const status = ask(tab);
    assert.equal(status.hideSections, 'ok', `answered with ${JSON.stringify(raw)} in the attribute`);
    assert.ok(!('orders' in status));
  }
  tab.document.documentElement.removeAttribute('data-dg-status');
  await w.flush();
  assert.equal(ask(tab).hideSections, 'ok');
  noErrors(w);
});

test('only our own extension gets an answer, and only for its status message', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'degiro', hash: '/products/123/overview', globals: PRODUCT_GLOBALS });
  await w.advance(500);
  assert.equal(tab.message({ type: 'dg-status' }, { id: 'another-extension-id' }), undefined, 'another extension gets nothing');
  assert.equal(tab.message({ type: 'something-else' }), undefined);
  assert.equal(tab.message(null), undefined);
  assert.equal(tab.message('dg-status'), undefined, 'not even the bare string');
  assert.equal(ask(tab).hideSections, 'ok', 'our own message is still answered');
  noErrors(w);
});

test('asking for the status stores nothing', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites' });
  await w.advance(500);
  const before = w.log.length;
  ask(tab); ask(tab);
  await w.flush();
  assert.equal(w.log.length, before, 'no storage write');
  assert.deepEqual(w.stored('local'), {}, 'nothing kept in this browser either');
  noErrors(w);
});
