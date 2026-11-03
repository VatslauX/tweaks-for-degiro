// Settings (flags.js): sanitising of stored values, live switching of features, and the extension
// being disabled while a tab stays open. Stays in Playwright: the options page UI, chrome://extensions.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorld, alarm } = require('./harness');

const noErrors = w => assert.deepEqual(w.errors.map(e => e.stack || String(e)), []);
const settings = tab => tab.json('dgSettings');
const defaults = tab => tab.json('DG_DEFAULTS');
// what is in the page that the extension put there: own elements by id or by their data-dg-* name
const owned = tab => tab.owned().map(e => e.id || [...e.attributes].map(a => a.name).find(n => n.startsWith('data-dg-') && n !== 'data-dg-own') || e.tagName).sort();
const navKeys = tab => tab.$$('[data-dg-nav]').map(e => e.getAttribute('data-dg-nav'));
const hiddenRows = tab => tab.$$('tbody tr').filter(tr => tr.style.display === 'none' || tr.hasAttribute('data-dg-tx-filtered') || tr.hasAttribute('data-dg-filtered')).length;

test('malformed stored settings are sanitised to defaults, valid ones kept', async () => {
  const w = createWorld();
  await w.set('sync', {
    spread: 'yes', headerSpread: 0, exDividend: null, compactPricing: 'false',     // coerced to booleans; null = default
    hiddenTitles: ['  Keep me  ', 5, '', null, 'x'.repeat(150), ...Array.from({ length: 40 }, (_, i) => `t${i}`)],
    txHiddenColumns: ['bogus', 'price', 'date'],                                    // unknown dropped, canonical order
    ordersHiddenColumns: 'nope',                                                    // not a list: default
    navLinks: { weird: true }
  });
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites' });
  const s = settings(tab), d = defaults(tab);
  assert.equal(s.spread, true);
  assert.equal(s.headerSpread, false);
  assert.equal(s.exDividend, d.exDividend, 'null falls back to the default');
  assert.equal(s.compactPricing, true, 'a non-empty string is truthy');
  assert.equal(s.navLinks, true);
  assert.equal(s.hiddenTitles.length, 30, 'at most 30 titles');
  assert.equal(s.hiddenTitles[0], 'Keep me', 'trimmed');
  assert.ok(!s.hiddenTitles.includes('') && !s.hiddenTitles.includes(5));
  assert.ok(s.hiddenTitles.every(t => t.length <= 100), 'long titles are cut');
  assert.deepEqual(s.txHiddenColumns, ['date', 'price']);
  assert.deepEqual(s.ordersHiddenColumns, d.ordersHiddenColumns);
  noErrors(w);
});

test('the page gets only the page-world flags, as booleans', async () => {
  const w = createWorld();
  await w.set('sync', { periodChange: false, orders: 'x', spread: false, priceAlarms: false });
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites' });
  assert.deepEqual(JSON.parse(tab.document.documentElement.getAttribute('data-dg-tweaks')),
    { periodChange: false, chartSelect: true, orders: true, ordersClick: true, alarmLines: true, alarmLinesClick: true });
});

test('storage refusing to be read: a failed read keeps the last good settings and is retried; the very first one too', async () => {
  const w = createWorld();
  await w.set('sync', { navLinks: false, spread: false });
  w.faults.get = true;
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites' });
  await w.advance(200);
  // the first read failed: nothing better than the defaults is known yet (each script starts on them),
  // and the page-world flags are not published until a read works
  assert.deepEqual(settings(tab), defaults(tab));
  assert.equal(tab.document.documentElement.getAttribute('data-dg-tweaks'), null);
  w.faults.get = false;
  await w.advance(1000); // retried (1 s, doubling)
  assert.deepEqual([settings(tab).navLinks, settings(tab).spread], [false, false], 'the retry brings the stored choices');
  assert.deepEqual(navKeys(tab), []);
  assert.deepEqual(JSON.parse(tab.document.documentElement.getAttribute('data-dg-tweaks') || 'null'),
    { periodChange: true, chartSelect: true, orders: true, ordersClick: true, alarmLines: true, alarmLinesClick: true });

  tab.run('globalThis.__seen = []; dgOnSettings(s => __seen.push(s.navLinks))');
  w.faults.get = true; // the read that follows the next change fails, and so do its retries
  await w.set('sync', { headerSpread: false });
  await w.advance(10000);
  assert.deepEqual([settings(tab).navLinks, settings(tab).spread, settings(tab).headerSpread], [false, false, true],
    'the last good settings stay; the defaults do not come back');
  assert.deepEqual(navKeys(tab), [], 'switched-off features stay off');
  assert.deepEqual(tab.json('__seen'), [false], 'listeners are not called with the defaults');
  w.faults.get = false;
  await w.advance(30000); // the next retry reads the change it missed
  assert.deepEqual([settings(tab).navLinks, settings(tab).spread, settings(tab).headerSpread], [false, false, false]);
  noErrors(w);
});

test('extension disabled while a failed read waits for its retry: every flag goes off and the retry does not bring them back', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites' });
  await w.advance(200);
  w.faults.get = true;
  await w.set('sync', { spread: false });
  await w.advance(100);
  tab.disableExtension();
  w.faults.get = false;
  await w.advance(60000);
  assert.ok(Object.entries(settings(tab)).every(([, v]) => typeof v !== 'boolean' || v === false), 'every flag is off');
  assert.deepEqual(owned(tab), []);
  noErrors(w);
});

test('settings written in another tab or on the options page apply live', async () => {
  const w = createWorld();
  const A = await w.open({ fixture: 'favourites', hash: '/favourites' });
  const B = await w.open({ fixture: 'favourites', hash: '/favourites' });
  await w.advance(200);
  await A.setFlag('navLinks', false);
  await w.advance(200);
  assert.deepEqual([navKeys(A), navKeys(B)], [[], []]);
  assert.equal(settings(B).navLinks, false);
});

test('navLinks off removes the links (and gives Favourites its look back); on restores them', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites?dg=alarms' });
  await w.advance(200);
  assert.deepEqual(navKeys(tab), ['orders', 'transactions', 'alarms']);
  const fav = tab.$('[data-name=favouriteProductsMenuItem]');
  assert.equal(fav.classList.contains('current'), false, 'on the Alarms page Favourites loses its current look');
  await tab.setFlag('navLinks', false);
  await w.advance(200);
  assert.deepEqual(navKeys(tab), []);
  assert.deepEqual(owned(tab).filter(n => n === 'data-dg-nav'), []);
  assert.equal(fav.classList.contains('current'), true, 'the item goes away: Favourites gets its current look back');
  assert.equal(fav.hasAttribute('data-dg-nav-uncurrent'), false);
  await tab.setFlag('navLinks', true);
  await w.advance(200);
  assert.deepEqual(navKeys(tab), ['orders', 'transactions', 'alarms']);
  assert.equal(fav.classList.contains('current'), false, 'and takes it away again on the Alarms page');
});

test('priceAlarms off removes banners and the Alarms item; on brings them back from storage', async () => {
  const a = alarm({ price: 17 });
  const w = createWorld();
  await w.set('sync', { dgAlarms: [a] });
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites' });
  await w.advance(200);
  tab.setPrice(123, 17.5);
  await w.advance(200);
  assert.equal(tab.$$('[data-dg-alarm-banner]').length, 1);
  assert.ok(owned(tab).includes('data-dg-alarm-banners'));
  await tab.setFlag('priceAlarms', false);
  await w.advance(200);
  assert.deepEqual(owned(tab).filter(n => /alarm/.test(n)), [], 'nothing of the alarms feature is left');
  assert.deepEqual(navKeys(tab), ['orders', 'transactions']);
  // a price crossing while the feature is off fires nothing
  const b = alarm({ price: 1300, productId: 456 });
  await tab.run(`chrome.storage.sync.set({ dgAlarms: [${JSON.stringify(a)}, ${JSON.stringify(b)}] })`);
  tab.setPrice(456, 1400);
  await w.advance(300);
  assert.deepEqual((w.stored('local').dgAlarmEvents || []).map(e => e.alarmId), [a.id]);
  await tab.setFlag('priceAlarms', true);
  await w.advance(300);
  assert.equal(tab.$$('[data-dg-alarm-banner]').length, 2, 'the open banner is back, and the missed crossing fires now');
  noErrors(w);
});

test('transactionsFilter off removes the panel, the column style and every hidden row; on starts clean', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'transactions', hash: '/transactions' });
  await w.advance(200);
  assert.ok(tab.$('#dg-transactions-panel') && tab.$('#dg-tx-columns'));
  tab.$$('#dg-transactions-panel button').find(b => b.textContent === 'Sell').click();
  await w.advance(200);
  assert.equal(hiddenRows(tab), 3);
  await tab.setFlag('transactionsFilter', false);
  await w.advance(200);
  assert.equal(tab.$('#dg-transactions-panel'), null);
  assert.equal(tab.$('#dg-tx-columns'), null);
  assert.equal(hiddenRows(tab), 0, 'all rows are shown again');
  assert.deepEqual(owned(tab).filter(n => /dg-tx|transactions-panel/.test(n)), []);
  await tab.setFlag('transactionsFilter', true);
  await w.advance(200);
  assert.ok(tab.$('#dg-transactions-panel'));
  assert.equal(hiddenRows(tab), 0, 'the old Sell filter is forgotten');
});

test('ordersFilter off removes its panel and shows every row; the Transactions panel is not involved', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'orders', hash: '/orders/open' });
  await w.advance(200);
  tab.$$('#dg-orders-panel button').find(b => b.textContent === 'Sell').click();
  await w.advance(200);
  assert.ok(hiddenRows(tab) > 0);
  await tab.setFlag('ordersFilter', false);
  await w.advance(200);
  assert.equal(tab.$('#dg-orders-panel'), null);
  assert.equal(hiddenRows(tab), 0);
});

test('every feature off leaves nothing of ours in the page; all on again restores it', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'transactions', hash: '/transactions' });
  await w.advance(200);
  const before = owned(tab);
  assert.ok(before.length >= 4, `expected panel, style and nav items, got ${before}`);
  const off = Object.fromEntries(Object.entries(defaults(tab)).filter(([, v]) => typeof v === 'boolean').map(([k]) => [k, false]));
  await w.set('sync', off);
  await w.advance(300);
  assert.deepEqual(owned(tab), []);
  assert.deepEqual(navKeys(tab), []);
  const on = Object.fromEntries(Object.keys(off).map(k => [k, true]));
  await w.set('sync', on);
  await w.advance(300);
  assert.deepEqual(owned(tab), before);
  noErrors(w);
});

test('extension disabled or removed (chrome.runtime.id gone): within 2 s every feature switches off and the page is left clean', async () => {
  const a = alarm({ price: 17 });
  const w = createWorld();
  await w.set('sync', { dgAlarms: [a] });
  const T = await w.open({ fixture: 'transactions', hash: '/transactions' });
  const F = await w.open({ fixture: 'favourites', hash: '/favourites' });
  await w.advance(200);
  F.setPrice(123, 17.5);
  T.$$('#dg-transactions-panel button').find(b => b.textContent === 'Buy').click();
  await w.advance(200);
  assert.ok(owned(T).length > 0 && owned(F).length > 0);
  assert.ok(hiddenRows(T) > 0);

  T.disableExtension();
  await w.advance(1000);
  assert.equal(settings(T).navLinks, true, 'not noticed yet (checked every 2 s)');
  await w.advance(1500);
  const s = settings(T);
  assert.ok(Object.entries(s).every(([, v]) => typeof v !== 'boolean' || v === false), 'every flag is off');
  assert.deepEqual(owned(T), []);
  assert.equal(hiddenRows(T), 0);
  assert.deepEqual(JSON.parse(T.document.documentElement.getAttribute('data-dg-tweaks')),
    { periodChange: false, chartSelect: false, orders: false, ordersClick: false, alarmLines: false, alarmLinesClick: false });
  // the other tab (extension still alive there) is unaffected
  assert.equal(settings(F).navLinks, true);
  assert.ok(owned(F).length > 0);
  // the dead tab stays quiet: nothing re-adds anything
  await w.advance(5000);
  assert.deepEqual(owned(T), []);
  noErrors(w);
});

// ── Bridge: data-dg-tweaks (flags.js) ───────────────────────────────────────

test('bridge exposes only the chart flags, as booleans', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites' });
  await w.advance(200);
  const bridged = JSON.parse(tab.document.documentElement.getAttribute('data-dg-tweaks'));
  assert.ok(bridged, 'data-dg-tweaks attribute is set');
  assert.deepEqual(Object.keys(bridged).sort(), ['alarmLines', 'alarmLinesClick', 'chartSelect', 'orders', 'ordersClick', 'periodChange']);
  for (const v of Object.values(bridged)) assert.equal(typeof v, 'boolean', 'all values are boolean');
  assert.deepEqual(w.errors.map(e => e.stack || String(e)), []);
});

test('bridge follows settings changes', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites' });
  await w.advance(200);
  const bridged = () => JSON.parse(tab.document.documentElement.getAttribute('data-dg-tweaks'));
  assert.equal(bridged().ordersClick, true);
  await tab.setFlag('ordersClick', false);
  await w.advance(200);
  assert.equal(bridged().ordersClick, false);
  await tab.setFlag('ordersClick', true);
  await w.advance(200);
  assert.equal(bridged().ordersClick, true);
  assert.deepEqual(w.errors.map(e => e.stack || String(e)), []);
});
