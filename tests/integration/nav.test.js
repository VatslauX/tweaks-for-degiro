// Left-sidebar links (nav.js): the Alarms item's badge counts open alarm banners, in every tab.
// Stays in Playwright: whether the links fit the sidebar's height, current-item looks (computed styles).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorld, alarm } = require('./harness');

const badge = tab => tab.$('[data-dg-nav=alarms] [data-dg-nav-badge]')?.textContent ?? null;
const noErrors = w => assert.deepEqual(w.errors.map(e => e.stack || String(e)), []);

async function setup() {
  const x = alarm({ price: 17, productId: 123 }), y = alarm({ price: 16, productId: 789, name: 'Mock Chips' });
  const w = createWorld();
  await w.set('sync', { dgAlarms: [x, y] });
  const A = await w.open({ fixture: 'favourites', hash: '/favourites' });
  const B = await w.open({ fixture: 'favourites', hash: '/favourites' });
  const C = await w.open({ fixture: 'transactions', hash: '/transactions' }); // no banners here, but the sidebar is
  await w.advance(200);
  return { w, A, B, C, x, y };
}

test('the Orders, Transactions and Alarms links sit below Products, without a badge while nothing fired', async () => {
  const { A, C } = await setup();
  for (const tab of [A, C]) {
    const keys = tab.$$('[data-dg-nav]').map(e => e.getAttribute('data-dg-nav'));
    assert.deepEqual(keys, ['orders', 'transactions', 'alarms']);
    assert.equal(tab.$('[data-name=productsMenuItem]').closest('[data-dg-nav]'), null, 'DEGIRO\'s own item is not ours');
    assert.equal(badge(tab), null);
  }
  assert.equal(A.$('[data-dg-nav=alarms] a').getAttribute('href'), '#/favourites?dg=alarms');
});

test('the badge follows open banners across tabs: fire, close in another tab, delete an alarm', async () => {
  const { w, A, B, C, x, y } = await setup();
  A.setPrice(123, 17.5);
  await w.advance(200);
  assert.deepEqual([badge(A), badge(B), badge(C)], ['1', '1', '1']);
  A.setPrice(789, 16.5);
  await w.advance(200);
  assert.deepEqual([badge(A), badge(B), badge(C)], ['2', '2', '2']);

  B.$(`[data-dg-alarm-banner="${x.id}"] [data-dg-alarm-close]`).click(); // closed in B
  await w.advance(200);
  assert.deepEqual([badge(A), badge(B), badge(C)], ['1', '1', '1']);

  await A.run(`dgAlarmStore.remove(${JSON.stringify(y.id)})`); // the alarm of the other banner is deleted
  await w.advance(200);
  assert.deepEqual([badge(A), badge(B), badge(C)], [null, null, null]);
  noErrors(w);
});

test('a tab opened while banners are open starts with the right badge', async () => {
  const { w, A } = await setup();
  A.setPrice(123, 17.5);
  await w.advance(200);
  const late = await w.open({ fixture: 'orders', hash: '/orders/open' });
  await w.advance(200);
  assert.equal(badge(late), '1');
});

test('the Alarms item goes with the Price alarms switch (and comes back with its badge); the other links stay', async () => {
  const { w, A, B } = await setup();
  A.setPrice(123, 17.5);
  await w.advance(200);
  await A.setFlag('priceAlarms', false);
  await w.advance(200);
  for (const tab of [A, B]) {
    assert.deepEqual(tab.$$('[data-dg-nav]').map(e => e.getAttribute('data-dg-nav')), ['orders', 'transactions']);
    assert.equal(tab.$('[data-dg-alarm-banner]'), null);
  }
  await A.setFlag('priceAlarms', true);
  await w.advance(200);
  assert.deepEqual([badge(A), badge(B)], ['1', '1']);
});
