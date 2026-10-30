// Price alarms on the chart, the isolated side (alarms.js): the data-dg-alarm-lines attribute the page
// world (alarm-lines.js) draws from. It carries only the open product's id and its switched-on alarms'
// prices and directions. Drawing on the chart stays in Playwright (tests/e2e/alarm-lines.spec.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorld, alarm } = require('./harness');

const ATTR = 'data-dg-alarm-lines';
const lines = tab => tab.document.documentElement.getAttribute(ATTR);
const noErrors = w => assert.deepEqual(w.errors.map(e => e.stack || String(e)), []);
// the product mock's chart needs Highcharts, which jsdom doesn't load (see alarm-panel.test.js)
const Highcharts = { Chart: function () { const s = { setData() {}, data: [{ update() {} }] }; return { series: [s] }; } };

// Mock ETF 123 shows 16,92: these alarms never fire, so they stay as they are
async function setup(alarms, settings) {
  const w = createWorld({ storage: { sync: { dgAlarms: alarms, ...settings } } });
  const tab = await w.open({ fixture: 'degiro', hash: '/products/123/overview', globals: { __MOCK_NO_URL_SESSION: true, Highcharts } });
  await w.advance(200);
  return { w, tab };
}

test('publishes only the open product\'s switched-on alarms: id, prices and directions, sorted', async () => {
  const { w, tab } = await setup([
    alarm({ id: 'x1', price: 20, dir: 'above', repeat: 'each', name: 'Secret name' }),
    alarm({ id: 'x2', price: 15.5, dir: 'below', repeat: 'daily' }),
    alarm({ id: 'x3', price: 21, on: false }),
    alarm({ id: 'x4', productId: 456, price: 1300 })
  ]);
  assert.equal(lines(tab), '{"id":123,"l":[{"p":15.5,"d":"below"},{"p":20,"d":"above"}]}');
  assert.doesNotMatch(lines(tab), /x1|Secret|each|daily|MOCK|€/);
  noErrors(w);
});

test('follows the alarms live: added, switched off, switched on, deleted, changed in another tab', async () => {
  const a = alarm({ id: 'y1', price: 20 });
  const { w, tab } = await setup([a]);
  assert.equal(lines(tab), '{"id":123,"l":[{"p":20,"d":"above"}]}');

  await tab.run(`dgAlarmStore.add(${JSON.stringify(alarm({ id: 'y2', price: 10, dir: 'below' }))})`);
  await w.advance(200);
  assert.equal(lines(tab), '{"id":123,"l":[{"p":10,"d":"below"},{"p":20,"d":"above"}]}');

  await tab.run(`dgAlarmStore.setOn('y1', false)`);
  await w.advance(200);
  assert.equal(lines(tab), '{"id":123,"l":[{"p":10,"d":"below"}]}');

  await tab.run(`dgAlarmStore.setOn('y1', true)`);
  await w.advance(200);
  assert.equal(lines(tab), '{"id":123,"l":[{"p":10,"d":"below"},{"p":20,"d":"above"}]}');

  await tab.run(`dgAlarmStore.remove('y2')`);
  await w.advance(200);
  assert.equal(lines(tab), '{"id":123,"l":[{"p":20,"d":"above"}]}');

  // another tab (or the Alarms page) edits the price
  await w.set('sync', { dgAlarms: [{ ...a, price: 21.25 }] });
  await w.advance(200);
  assert.equal(lines(tab), '{"id":123,"l":[{"p":21.25,"d":"above"}]}');

  await tab.run(`dgAlarmStore.remove('y1')`);
  await w.advance(200);
  assert.equal(lines(tab), null, 'no alarms left: no attribute');
  noErrors(w);
});

test('removed off product pages and for a product without alarms; back on the product page again', async () => {
  const { w, tab } = await setup([alarm({ price: 20 })]);
  assert.ok(lines(tab));
  await tab.go('/favourites');
  await w.advance(200);
  assert.equal(lines(tab), null, 'Favourites is not a product page');
  await tab.go('/products/999/overview');
  await w.advance(200);
  assert.equal(lines(tab), null, 'another product: none of its alarms');
  await tab.go('/products/123/overview');
  await w.advance(200);
  assert.equal(lines(tab), '{"id":123,"l":[{"p":20,"d":"above"}]}');
  noErrors(w);
});

test('removed when Alarms on the chart or Price alarms is switched off, and back when on', async () => {
  const { w, tab } = await setup([alarm({ price: 20 })]);
  const on = '{"id":123,"l":[{"p":20,"d":"above"}]}';
  assert.equal(lines(tab), on);
  for (const key of ['alarmLines', 'priceAlarms']) {
    await tab.setFlag(key, false);
    await w.advance(200);
    assert.equal(lines(tab), null, `${key} off`);
    await tab.setFlag(key, true);
    await w.advance(200);
    assert.equal(lines(tab), on, `${key} on again`);
  }
  noErrors(w);
});

test('never published when either flag starts off', async () => {
  for (const off of [{ alarmLines: false }, { priceAlarms: false }]) {
    const { w, tab } = await setup([alarm({ price: 20 })], off);
    assert.equal(lines(tab), null, JSON.stringify(off));
    noErrors(w);
  }
});

test('a page that rewrites the attribute is not answered with a rewrite (no write war); a real change wins', async () => {
  const { w, tab } = await setup([alarm({ id: 'z1', price: 20 })]);
  tab.document.documentElement.setAttribute(ATTR, '{"id":123,"l":[{"p":"x"}]}');
  await w.advance(500);
  assert.equal(lines(tab), '{"id":123,"l":[{"p":"x"}]}', 'left as the page wrote it');
  await tab.run(`dgAlarmStore.setOn('z1', false)`);
  await w.advance(200);
  assert.equal(lines(tab), null, 'switched off: removed');
  noErrors(w);
});
