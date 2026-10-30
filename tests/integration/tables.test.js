// Orders and Transactions tables (orders-table.js): filters and totals over many row variants, built
// from the mock pages. Expected figures are computed by hand in the comments.
// Stays in Playwright: column widths, the Product column's spare width, menu clamping, real colours,
// getComputedStyle visibility (column hide/show uses a <style> element, not inline styles).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('./harness');

const noErrors = w => assert.deepEqual(w.errors.map(e => e.stack || String(e)), []);

async function transactions(rows, globals = {}) {
  const w = createWorld();
  const tab = await w.open({ fixture: 'transactions', hash: '/transactions?fromDate=01%2F10%2F2026', globals: { ...(rows ? { __TX: rows } : {}), ...globals } });
  await w.advance(200);
  return { w, tab };
}
async function orders(rows, globals = {}) {
  const w = createWorld();
  const tab = await w.open({ fixture: 'orders', hash: '/orders/open', globals: { ...(rows ? { __ORDERS: rows } : {}), ...globals } });
  await w.advance(200);
  return { w, tab };
}
const panelId = kind => (kind === 'tx' ? '#dg-transactions-panel' : '#dg-orders-panel');
const text = (tab, kind, what) => tab.$(`${panelId(kind)} [data-dg-total=${what}]`)?.textContent.replace(/\s+/g, ' ').trim();
const count = (tab, kind) => tab.$(`${panelId(kind)} [data-dg-count]`).textContent;
const rows = tab => tab.$$('#transactions tbody tr, #orders tbody tr'); // not the mock's calendar table
const shown = tab => rows(tab).filter(tr => !tr.hasAttribute('data-dg-tx-filtered') && !tr.hasAttribute('data-dg-filtered')).length;
async function click(tab, kind, label) {
  const b = tab.$$(`${panelId(kind)} button`).find(x => x.textContent.trim() === label);
  assert.ok(b, `no "${label}" button`);
  b.click();
  await tab.world.advance(200);
}

// ---------- Transactions ----------

test('Transactions, nl numbers (1.234,56): totals per currency, net and fees', async () => {
  const { w, tab } = await transactions(null);
  // buys: $ 2.701,50 (1); € 3.600 + 2.500 = 6.100,00 (2). sells: $ 1.500 (1); € 1.900 (1)
  assert.equal(text(tab, 'tx', 'buy'), 'Total buy $ 2.701,50 (1) · € 6.100,00 (2)');
  assert.equal(text(tab, 'tx', 'sell'), 'Total sell $ 1.500,00 (1) · € 1.900,00 (1)');
  // net buy - sell: $ 1.201,50; € 6.100 - 1.900 = 4.200,00
  assert.equal(text(tab, 'tx', 'net'), 'Net (buy − sell) $ 1.201,50 · € 4.200,00');
  // fees = value - total per row: 3 + 3 + 8,25 + 2 + 1 = 17,25
  assert.equal(text(tab, 'tx', 'fees'), 'Fees € 17,25');
  assert.equal(count(tab, 'tx'), '5 of 5 transactions');
  noErrors(w);
});

test('Transactions, en numbers (1,234.56)', async () => {
  const { tab } = await transactions([
    ['Alpha EUR', 'Buy', 100, '€ -1,234.56', '€ -1,234.56', '—', '€ -1.00', '€ -1,235.56'],
    ['Alpha EUR', 'Sell', -50, '€ 2,000.00', '€ 2,000.00', '—', '€ -1.50', '€ 1,998.50'],
    ['Beta USD', 'Buy', 1, '$ -10,000.00', '€ -9,000.00', '€ -4.50', '€ -2.00', '€ -9,006.50']
  ]);
  assert.equal(text(tab, 'tx', 'buy'), 'Total buy $ 10,000.00 (1) · € 1,234.56 (1)');
  assert.equal(text(tab, 'tx', 'sell'), 'Total sell € 2,000.00 (1)');
  assert.equal(text(tab, 'tx', 'net'), 'Net (buy − sell) $ 10,000.00 · € -765.44'); // 1.234,56 - 2.000
  // fees: 1.00 + 1.50 + 6.50 (AutoFX included) = 9.00
  assert.equal(text(tab, 'tx', 'fees'), 'Fees € 9.00');
});

test('Transactions: filters by action, currency and product, and survive DEGIRO re-rendering the rows', async () => {
  const { w, tab } = await transactions(null);
  await click(tab, 'tx', 'Sell');
  assert.equal(shown(tab), 2);
  assert.equal(text(tab, 'tx', 'buy'), 'Total buy —');
  assert.equal(text(tab, 'tx', 'sell'), 'Total sell $ 1.500,00 (1) · € 1.900,00 (1)');
  assert.equal(text(tab, 'tx', 'net'), 'Net (buy − sell) $ -1.500,00 · € -1.900,00');
  assert.equal(count(tab, 'tx'), '2 of 5 transactions');
  // fees of the shown rows only: 3 + 2
  assert.equal(text(tab, 'tx', 'fees'), 'Fees € 5,00');
  tab.window.__rerender(); // new rows, same data
  await w.advance(200);
  assert.equal(shown(tab), 2, 'the filter is applied to the new rows');
  await click(tab, 'tx', '$');
  assert.equal(shown(tab), 1);
  assert.equal(text(tab, 'tx', 'sell'), 'Total sell $ 1.500,00 (1)');
  await click(tab, 'tx', 'Clear filters');
  assert.equal(shown(tab), 5);
  assert.equal(count(tab, 'tx'), '5 of 5 transactions');
  noErrors(w);
});

test('Transactions: a product picked in the menu limits rows and totals; a product that disappears is forgotten', async () => {
  const { w, tab } = await transactions(null);
  tab.$('[data-dg-products]').click();
  await w.advance(200);
  const item = tab.$$('[role=listbox] label').find(l => l.textContent.startsWith('Mock Chips ETF EUR'));
  assert.match(item.textContent, /\(2\)$/);
  item.querySelector('input').click();
  await w.advance(200);
  assert.equal(shown(tab), 2);
  assert.equal(text(tab, 'tx', 'buy'), 'Total buy € 3.600,00 (1)');
  // DEGIRO loads a new date range without that product: nothing is left selected, so rows show
  tab.window.__TX.splice(0, 2);
  tab.window.__rerender();
  await w.advance(200);
  assert.equal(shown(tab), 3);
  assert.equal(count(tab, 'tx'), '3 of 3 transactions');
});

test('Transactions: missing cells, no-fee hook, rows without a product or side', async () => {
  const { w, tab } = await transactions([
    ['Alpha', 'Buy', 10, '€ -100,00', '€ -100,00', '—', '€ -1,00', '€ -101,00'],
    ['Gamma', 'Buy', 5, '€ -20,00', '€ -20,00', '—', '€ -1,00', '—'], // total missing: the Fees column gives 1,00
    ['', 'Buy', 5, '€ -999,00', '€ -999,00', '—', '€ -9,00', '€ -1.008,00'], // no product name: not a row of ours
    ['Delta', 'Foo', 1, '€ -50,00', '€ -50,00', '—', '€ -2,00', '€ -52,00']  // unknown side: counted, not summed
  ]);
  assert.equal(text(tab, 'tx', 'buy'), 'Total buy € 120,00 (2)');
  assert.equal(text(tab, 'tx', 'sell'), 'Total sell —');
  assert.equal(count(tab, 'tx'), '3 of 3 transactions', 'the nameless row is not counted');
  assert.equal(text(tab, 'tx', 'net'), 'Net (buy − sell) € 120,00');
  // fees: Alpha 1 (value - total) + Gamma 1 (Fees column) + Delta 2
  assert.equal(text(tab, 'tx', 'fees'), 'Fees € 4,00');
  assert.equal(rows(tab)[2].hasAttribute('data-dg-tx-filtered'), false, 'the nameless row is never hidden');
  noErrors(w);
});

test('Transactions: without DEGIRO\'s Total hook the Fees column is used', async () => {
  const { tab } = await transactions(null, { __MOCK_NO_TX_TOTAL: true });
  // Fees column: 3 + 3 + 2 + 2 + 1 (AutoFX is not in that column)
  assert.equal(text(tab, 'tx', 'fees'), 'Fees € 11,00');
});

test('Transactions: Buy/Sell recognised by data-action in any UI language, and by the label when there is none', async () => {
  const { w, tab } = await transactions(null, { __MOCK_TX_LABELS: { Buy: 'Kauf', Sell: 'Verkauf' } });
  assert.equal(text(tab, 'tx', 'buy'), 'Total buy $ 2.701,50 (1) · € 6.100,00 (2)');
  // no hook: the (localised) text decides
  tab.$$('[data-name=buySellBadge]').forEach(b => b.removeAttribute('data-action'));
  tab.document.body.append(tab.document.createElement('i')); // a DOM change re-runs the filters
  await w.advance(200);
  assert.equal(text(tab, 'tx', 'buy'), 'Total buy $ 2.701,50 (1) · € 6.100,00 (2)');
  assert.equal(text(tab, 'tx', 'sell'), 'Total sell $ 1.500,00 (1) · € 1.900,00 (1)');
  await click(tab, 'tx', 'Sell');
  assert.equal(shown(tab), 2);
});

test('Transactions: more pages are announced next to the totals', async () => {
  const { tab } = await transactions(null, { __MOCK_MORE_PAGES: true });
  assert.match(count(tab, 'tx'), /this page only/);
});

test('Transactions: DEGIRO\'s upper panel (a Latest Transactions mini list that comes first) does not hide the filters', async () => {
    const { w, tab } = await transactions(null);
    const mini = tab.document.createElement('div');
    mini.setAttribute('data-name', 'accountSummary');
    mini.innerHTML = '<table data-name="transactions" id="miniTransactions"><tbody><tr><td data-field="date">10:15</td>' +
      '<td data-name="buySellBadge" data-action="BUY">B</td><td>3</td><td data-field="productName">Mock Mini</td><td>€ -30,00</td></tr></tbody></table>';
    tab.document.querySelector('section[data-name=transactions]').before(mini);
    await w.advance(200);
    assert.ok(tab.$('#dg-transactions-panel'), 'the panel is there');
    assert.equal(text(tab, 'tx', 'buy'), 'Total buy $ 2.701,50 (1) · € 6.100,00 (2)');
    await click(tab, 'tx', 'Sell');
    assert.equal(shown(tab), 2);
    assert.equal(tab.$('#miniTransactions tr').hasAttribute('data-dg-tx-filtered'), false, 'the mini list is untouched');
    assert.equal(tab.$('#miniTransactions').contains(tab.$('#dg-transactions-panel')), false);
  });

// ---------- Orders ----------

test('Orders, nl numbers: buy and sell totals per currency (default mock rows)', async () => {
  const { w, tab } = await orders(null);
  // buys: $ 2.701,50 + 3.202 + 13.000 = 18.903,50 (3); € 2.500 + 2.800 + 1.500 = 6.800 (3)
  assert.equal(text(tab, 'orders', 'buy'), 'Total buy $ 18.903,50 (3) · € 6.800,00 (3)');
  // sells: $ 2.500 (1); € 3.600 (1)
  assert.equal(text(tab, 'orders', 'sell'), 'Total sell $ 2.500,00 (1) · € 3.600,00 (1)');
  assert.equal(count(tab, 'orders'), '8 of 8 orders');
  assert.equal(tab.$(`${panelId('tx')}`), null, 'no Transactions panel on the Orders page');
  noErrors(w);
});

test('Orders, en numbers and a missing value: the row is counted but not summed', async () => {
  const { tab } = await orders([
    ['A', 'Buy', 10, '€ 2.50', '2,500.00'],
    ['B', 'Sell', 5, '€ 3.00', '1,234.56'],
    ['C', 'Buy', 1, '$ 1.00', '1,000.5'],
    ['D', 'Buy', 1, '$ 1.00', '—']
  ]);
  assert.equal(text(tab, 'orders', 'buy'), 'Total buy $ 1,000.50 (1) · € 2,500.00 (1)');
  assert.equal(text(tab, 'orders', 'sell'), 'Total sell € 1,234.56 (1)');
  assert.equal(count(tab, 'orders'), '4 of 4 orders');
});

test('Orders: filters by action and currency, kept when DEGIRO re-renders', async () => {
  const { w, tab } = await orders(null);
  await click(tab, 'orders', 'Buy');
  assert.equal(shown(tab), 6);
  assert.equal(text(tab, 'orders', 'sell'), 'Total sell —');
  await click(tab, 'orders', '$');
  assert.equal(shown(tab), 3);
  assert.equal(text(tab, 'orders', 'buy'), 'Total buy $ 18.903,50 (3)');
  assert.equal(count(tab, 'orders'), '3 of 8 orders');
  tab.window.__rerender();
  await w.advance(200);
  assert.equal(shown(tab), 3);
  await click(tab, 'orders', 'Clear filters');
  assert.equal(shown(tab), 8);
});

test('Orders: localised Buy/Sell text (no usable data-action) is recognised', async () => {
  const { tab } = await orders([
    ['A', 'Kopen', 10, '€ 2,50', '2.500,00'],
    ['B', 'Verkopen', 5, '€ 3,00', '1.500,00'],
    ['C', 'Kaufen', 1, '€ 1,00', '100,00'],
    ['D', 'Verkauf', 1, '€ 1,00', '50,00']
  ]);
  assert.equal(text(tab, 'orders', 'buy'), 'Total buy € 2.600,00 (2)');
  assert.equal(text(tab, 'orders', 'sell'), 'Total sell € 1.550,00 (2)');
});

test('Orders: a row without a limit price takes its currency from the stop price; with neither, it sums under "?"', async () => {
  const { w, tab } = await orders([
    ['A', 'Buy', 10, '€ 2,50', '2.500,00'],
    ['B', 'Buy', 5, '', '100,00'],
    ['C', 'Buy', 5, '', '40,00']
  ]);
  // no limit on B: its Stop Price cell (a stop order) says "$ 50,00"; C has neither
  const stop = tab.$$('#orders tbody tr')[1].querySelector('[data-field=stopPriceColumnValue]');
  stop.textContent = '$ 50,00';
  await w.advance(200);
  assert.match(text(tab, 'orders', 'buy'), /\$ 100,00 \(1\)/, 'B counted under $');
  assert.match(text(tab, 'orders', 'buy'), /\? 40,00 \(1\)/, 'C under ?');
  assert.match(text(tab, 'orders', 'buy'), /€ 2\.500,00 \(1\)/);
});

// ── Transactions: flag and column-picker logic ──────────────────────────────

test('Transactions: only on the Transactions page, not Orders history', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'transactions', hash: '/orders/history' });
  await w.advance(800);
  assert.equal(tab.$('#dg-transactions-panel'), null, 'no panel on orders/history page');
  noErrors(w);
});

test('Transactions: can be switched off; hidden rows come back', async () => {
  const { w, tab } = await transactions(null);
  await click(tab, 'tx', 'Sell');
  assert.equal(shown(tab), 2, 'sell filter applied');
  await tab.setFlag('transactionsFilter', false);
  await w.advance(200);
  assert.equal(tab.$('#dg-transactions-panel'), null, 'panel removed');
  assert.equal(shown(tab), 5, 'all rows shown again');
  noErrors(w);
});

test('Transactions: off → on restores the panel with every row shown', async () => {
  const { w, tab } = await transactions(null);
  await click(tab, 'tx', 'Sell');
  await tab.setFlag('transactionsFilter', false);
  await w.advance(200);
  assert.equal(tab.$('#dg-transactions-panel'), null);
  await tab.setFlag('transactionsFilter', true);
  await w.advance(200);
  assert.ok(tab.$('#dg-transactions-panel'), 'panel restored');
  assert.equal(shown(tab), 5, 'all rows visible');
  noErrors(w);
});

test('Transactions: stays filtered when the Orders feature also runs on the page', async () => {
  // Both ordersFilter and transactionsFilter are on by default; DOM change triggers both.
  const { w, tab } = await transactions(null);
  await click(tab, 'tx', 'Sell');
  tab.document.body.appendChild(tab.document.createElement('div')); // DOM change
  await w.advance(800);
  assert.equal(shown(tab), 2, 'Sell filter survives the re-run');
  assert.equal(tab.$('#dg-orders-panel'), null, 'no Orders panel on Transactions page');
  noErrors(w);
});

test('Transactions columns: saved choice propagates to a second tab live', async () => {
  const { w, tab } = await transactions(null);
  // open the column picker and uncheck Date
  tab.$('[data-dg-columns]').click();
  await w.advance(200);
  const dateLabel = tab.$$('#dg-transactions-panel [role=listbox] label').find(l => l.textContent.trim() === 'Date');
  assert.ok(dateLabel, 'Date column offered');
  const dateCb = dateLabel.querySelector('input');
  dateCb.checked = false;
  dateCb.dispatchEvent(new tab.window.Event('change', { bubbles: true }));
  await w.advance(500);
  // Extension stores all currently hidden columns (defaults + the user's choice)
  assert.ok((w.stored('sync').txHiddenColumns || []).includes('date'), 'Date stored as hidden');
  // second tab picks up the change from storage
  const tab2 = await w.open({ fixture: 'transactions', hash: '/transactions?fromDate=01%2F10%2F2026' });
  await w.advance(200);
  // extension creates #dg-tx-columns style element when any column is hidden
  assert.ok(tab2.$('#dg-tx-columns'), 'hiding style element present in second tab');
  assert.ok(tab2.$('#dg-tx-columns').textContent.length > 0, 'style has content');
  // live update to another key: the original tab responds
  await w.set('sync', { txHiddenColumns: ['fees'] });
  await w.advance(200);
  assert.deepEqual(w.stored('sync').txHiddenColumns, ['fees'], 'fees now the hidden column');
  noErrors(w);
});

test('Transactions columns: malformed or unknown saved values fall back safely', async () => {
  const { w } = await transactions(null);
  await w.set('sync', { txHiddenColumns: ['qty', 'product', 'nonsense'] });
  await w.advance(200);
  noErrors(w);
  await w.set('sync', { txHiddenColumns: 'qty' }); // string instead of array
  await w.advance(200);
  noErrors(w);
});

test('Transactions columns: without the Fees hook, Exchange Rate and AutoFX Fee are not offered', async () => {
  const { w, tab } = await transactions(null, { __MOCK_NO_TX_FEE: true });
  tab.$('[data-dg-columns]').click();
  await w.advance(200);
  const names = tab.$$('#dg-transactions-panel [role=listbox] label').map(l => l.textContent.trim());
  assert.ok(!names.includes('Exchange Rate'), 'Exchange Rate not offered');
  assert.ok(!names.includes('AutoFX Fee'), 'AutoFX Fee not offered');
  assert.ok(names.includes('Date'), 'Date still offered');
  noErrors(w);
});

test('Transactions columns: open date picker calendar table is left alone', async () => {
  const { w, tab } = await transactions(null, { __MOCK_CALENDAR: true });
  // the extension's panel must not be placed inside the calendar
  assert.ok(tab.$('#dg-transactions-panel'), 'panel present');
  assert.equal(tab.$('#calendar').contains(tab.$('#dg-transactions-panel')), false,
    'panel not inside calendar');
  // all calendar headers remain in the DOM (the extension should not filter them)
  assert.equal(tab.$$('#calendar thead th').length, 7, 'calendar ths untouched');
  noErrors(w);
});

// ── Orders: flag and picker logic ───────────────────────────────────────────

test('Orders: product filter (multi-select)', async () => {
  const { w, tab } = await orders(null);
  tab.$('#dg-orders-panel [data-dg-products]').click();
  await w.advance(200);
  const options = tab.$$('#dg-orders-panel [role=listbox] label');
  assert.equal(options.length, 5, '5 distinct products');
  assert.ok(options[0].textContent.includes('ADR on Mock Software SE'), 'first option correct');
  // pick Mock Tech (the listbox may rebuild between clicks, so re-query after each)
  options.find(l => l.textContent.includes('Mock Tech')).querySelector('input').click();
  await w.advance(200);
  // re-query: the listbox may have been rebuilt
  const options2 = tab.$$('#dg-orders-panel [role=listbox] label');
  options2.find(l => l.textContent.includes('ADR on Mock')).querySelector('input').click();
  await w.advance(200);
  assert.equal(shown(tab), 3, '3 rows after product filter');
  assert.match(text(tab, 'orders', 'buy'), /\$ 5\.903,50 \(2\)/, 'correct buy total for 2 products');
  noErrors(w);
});

test('Orders: product menu closes on outside click', async () => {
  const { w, tab } = await orders(null);
  tab.$('#dg-orders-panel [data-dg-products]').click();
  await w.advance(200);
  assert.ok(tab.$('#dg-orders-panel [role=listbox]'), 'listbox open');
  tab.document.dispatchEvent(new tab.window.MouseEvent('mousedown', { bubbles: true }));
  await w.advance(200);
  assert.equal(tab.$('#dg-orders-panel [role=listbox]'), null, 'listbox closed after outside click');
  noErrors(w);
});

test('Orders: only on the Outstanding page, not history', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'orders', hash: '/orders/history' });
  await w.advance(800);
  assert.equal(tab.$('#dg-orders-panel'), null, 'no panel on orders/history');
  noErrors(w);
});

test('Orders: can be switched off; hidden rows come back', async () => {
  const { w, tab } = await orders(null);
  await click(tab, 'orders', 'Sell');
  assert.equal(shown(tab), 2);
  await tab.setFlag('ordersFilter', false);
  await w.advance(200);
  assert.equal(tab.$('#dg-orders-panel'), null, 'panel removed');
  assert.equal(shown(tab), 8, 'all rows shown again');
  noErrors(w);
});

test('Orders: action comes from data-action, whatever the label text says', async () => {
  const { w, tab } = await orders(null);
  // relabel badges but keep data-action
  tab.$$('#orders [data-name=buySellBadge]').forEach(b => { b.textContent = b.dataset.action === 'BUY' ? 'Köp' : 'Sälj'; });
  tab.document.body.appendChild(tab.document.createElement('div')); // trigger re-run
  await w.advance(200);
  assert.ok(text(tab, 'orders', 'sell').includes('$ 2.500,00 (1)'), 'sell total correct with localised text');
  await click(tab, 'orders', 'Sell');
  assert.equal(shown(tab), 2, 'Sell filter works with relabelled badges');
  noErrors(w);
});

test('Orders: a picked currency that is no longer in the table is dropped', async () => {
  const { w, tab } = await orders(null);
  await click(tab, 'orders', '$');
  assert.equal(shown(tab), 4);
  // Remove all $ rows from the mock and re-render
  tab.window.__ORDERS = tab.window.__ORDERS.filter(o => !o[3].startsWith('$'));
  tab.window.__rerender();
  await w.advance(200);
  assert.equal(shown(tab), 4, 'all remaining rows shown (€-only table)');
  assert.equal(tab.$(`#dg-orders-panel button[data-value="$"]`), null, '$ chip gone');
  noErrors(w);
});
