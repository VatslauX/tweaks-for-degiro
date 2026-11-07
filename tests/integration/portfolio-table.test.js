// Portfolio merged holdings table (portfolio-table.js): logic/DOM-state checks ported from
// tests/e2e/portfolio-table.spec.js (attributes, text, counts, aria-*, chrome.storage round-trips).
// Stays in Playwright: getBoundingClientRect (the row-height bug), toHaveCSS computed colours, the
// Delay dot's ::before content, CSS-driven visibility (toBeVisible/toBeHidden), the product-link
// click+navigation, and focus semantics — none of which JSDOM can exercise.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('./harness');

const noErrors = w => assert.deepEqual(w.errors.map(e => e.stack || String(e)), []);

// portfolio.html's own inline script calls fetch() synchronously (for its canvas-based performance
// chart) while loading. JSDOM has neither fetch nor a canvas 2D context, so a stub that never
// resolves parks that script's load() at its first `await` forever — it never reaches the canvas or
// .json() calls — while the independent holdings-table DOM and the extension's own scripts still run
// normally. Only the chart itself stays untestable here; it's covered in Playwright instead.
const stubFetch = () => new Promise(() => {});

async function openPortfolio(w, opts = {}) {
  const { globals, ...rest } = opts;
  const tab = await w.open({ fixture: 'portfolio', hash: '/portfolio', ...rest, globals: { fetch: stubFetch, ...globals } });
  await w.advance(200);
  return tab;
}

const headerByLabel = (tab, label) => tab.$$('[data-dg-portfolio-table] thead th').find(th => th.textContent.trim() === label);
const mergedRows = tab => tab.$$('[data-dg-portfolio-table] tbody tr');
const productNames = tab => tab.$$('[data-dg-portfolio-table] tbody [data-name=productName]').map(el => el.textContent.trim());

test('fixture renders three holdings sections with real hooks', async () => {
  const w = createWorld();
  const tab = await openPortfolio(w); // never enabled: a merged row would also carry [data-name=productName]
  assert.equal(tab.$('h3[data-name=stock]').textContent, 'Shares');
  assert.equal(tab.$('h3[data-name=etf]').textContent, 'Trackers (ETFs)');
  assert.equal(tab.$('h3[data-name=lox]').textContent, 'Structured products');
  assert.equal(tab.$$('[data-name=productName]').length, 6); // 3 + 2 + 1 rows
  noErrors(w);
});

test('Unrealised P/L € combines the native euro amount and percentage; sorting it orders by the amount', async () => {
  const w = createWorld();
  const tab = await openPortfolio(w);
  await tab.setFlag('portfolioMergedTable', true);
  // the native <td> holds two separate spans (amount, then the parenthesised percentage) — the
  // merged cell must show both, space-separated, not just the percentage (the bug this fixes).
  const cell = i => mergedRows(tab)[i].querySelector('[data-field=unrealizedRelativePl]');
  assert.equal(cell(0).textContent, '+276,00 (+16,73%)'); // Mock Software SE
  assert.equal(cell(2).textContent, '-47,60 (-8,50%)'); // Mock Retail Corp

  // sorting this column must order by the euro amount, not garble on the combined text's two
  // numbers (parseNum on the whole string would) — only etf's first page (2 of its 3 rows) is
  // merged by default, so this covers the six rows actually shown.
  const header = () => headerByLabel(tab, 'P&L Unrealized');
  header().querySelector('button').click(); // ascending
  await w.advance(200);
  assert.equal(header().getAttribute('aria-sort'), 'ascending');
  assert.deepEqual(productNames(tab), [
    'Mock Retail Corp', 'Mock Turbo Long AEX', 'Mock Bond ETF EUR',
    'Mock Pharma NV', 'Mock S&P 500 ETF USD', 'Mock Software SE'
  ]);

  header().querySelector('button').click(); // descending
  await w.advance(200);
  assert.equal(header().getAttribute('aria-sort'), 'descending');
  assert.deepEqual(productNames(tab), [
    'Mock Software SE', 'Mock S&P 500 ETF USD', 'Mock Pharma NV',
    'Mock Bond ETF EUR', 'Mock Turbo Long AEX', 'Mock Retail Corp'
  ]);
  noErrors(w);
});

test('merged headers follow DEGIRO\'s own (localised) header text', async () => {
  const w = createWorld();
  const tab = await openPortfolio(w);
  // as on a Dutch account: the native header texts are translated, the body-cell hooks are not
  tab.$$('.holdings thead').forEach(thead => { thead.querySelectorAll('th')[3].textContent = 'Aantal'; });
  await tab.setFlag('portfolioMergedTable', true);
  const qtyHead = () => tab.$('[data-dg-portfolio-table] th[data-dg-col=qty]');
  assert.equal(qtyHead().textContent, 'Aantal');
  // the Columns picker offers the same label
  tab.$('[data-dg-columns]').click();
  await w.advance(200);
  assert.equal(tab.$$('[role=listbox] label').filter(l => l.textContent.includes('Aantal')).length, 1);
  // DEGIRO renames a header later (e.g. after a language switch): the merged one follows
  tab.$('h3[data-name=stock] ~ * thead th:nth-child(4)').textContent = 'Stück';
  await w.advance(200);
  assert.equal(qtyHead().textContent, 'Stück');
  noErrors(w);
});

test('merged table copies the native table, header, cell and Buy/Sell button styling', async () => {
  const w = createWorld();
  const tab = await openPortfolio(w);
  await tab.setFlag('portfolioMergedTable', true);
  // toHaveClass with a plain string is an exact className match, not a substring check — asserted
  // the same way here, so a stray extra class would still be caught.
  assert.equal(tab.$('[data-dg-portfolio-table]').className, 'holdingsTable');
  assert.equal(tab.$('[data-dg-portfolio-table] th[data-dg-col=value]').className, 'holdingsHead');
  assert.equal(tab.$('[data-dg-portfolio-table] th[data-dg-col=type]').className, 'holdingsHead'); // no native Type: a representative header
  assert.equal(mergedRows(tab)[0].querySelector('[data-field=value]').className, 'holdingsCell');
  // Buy/Sell are copies of DEGIRO's own buttons: class and inner markup survive the merge
  const buy = mergedRows(tab)[0].querySelector('button[data-action=buy]');
  assert.equal(buy.className, 'holdingsAction');
  assert.equal(buy.querySelector('span.holdingsActionLabel').textContent, 'Buy');
  noErrors(w);
});

// a malformed or stale persisted value must fall back to the default rather than throwing or
// rendering an empty table. sanitizePortfolioSort() isn't exported (orders-table.js's own
// sanitizeSort isn't either, and has no dedicated unit test) — covered here, through this harness's
// own run of the real isolated-world scripts, the same way sanitizeSort's correctness is covered.
test('a stale saved sort column falls back to the default sort, and the table still renders', async () => {
  const w = createWorld();
  const tab = await openPortfolio(w, { settings: {
    portfolioMergedTable: true, portfolioMergedPersist: true,
    dgPortfolioSort: { col: 'noLongerAColumn', dir: 'ascending' }
  } });
  assert.equal(headerByLabel(tab, 'Type').getAttribute('aria-sort'), 'ascending');
  assert.equal(mergedRows(tab).length, 6);
  noErrors(w);
});

test('off the Portfolio page, the feature reports idle, not missing', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'orders', hash: '/orders/open' }); // no h3[data-name=stock] here, and never will be
  await tab.setFlag('portfolioMergedTable', true);
  assert.equal(tab.message({ type: 'dg-status' }).portfolioTable, 'idle');
  noErrors(w);
});

test('merged table shows all rows from all three sections and tracks a live update', async () => {
  const w = createWorld();
  const tab = await openPortfolio(w);
  await tab.setFlag('portfolioMergedTable', true);
  assert.equal(mergedRows(tab).length, 6);
  tab.$('h3[data-name=stock] ~ * [data-field=value]').textContent = '9.999,99';
  await w.advance(200);
  assert.equal(mergedRows(tab)[0].querySelector('[data-field=value]').textContent, '9.999,99');
  noErrors(w);
});

test('clicking a merged row\'s Buy button clicks the real hidden Buy button', async () => {
  const w = createWorld();
  const tab = await openPortfolio(w);
  await tab.setFlag('portfolioMergedTable', true);
  mergedRows(tab)[0].querySelector('button[data-action=buy]').click();
  await w.advance(200);
  assert.equal(tab.$('h3[data-name=stock] ~ * table tbody tr').getAttribute('data-dg-last-clicked'), 'buy');
  noErrors(w);
});

test('default sort is Type in DEGIRO\'s section order; clicking Product header sorts and toggles direction', async () => {
  const w = createWorld();
  const tab = await openPortfolio(w);
  await tab.setFlag('portfolioMergedTable', true);
  // Shares, then Trackers (ETFs), then Structured products — not alphabetical by the (localised)
  // label, which in English would put Structured products before Trackers (ETFs)
  const types = () => tab.$$('[data-dg-portfolio-table] tbody tr [data-dg-type]').map(td => td.getAttribute('data-dg-type'));
  assert.deepEqual(types(), ['stock', 'stock', 'stock', 'etf', 'etf', 'lox']);
  headerByLabel(tab, 'Type').querySelector('button').click(); // descending
  await w.advance(200);
  assert.deepEqual(types(), ['lox', 'etf', 'etf', 'stock', 'stock', 'stock']);
  headerByLabel(tab, 'Type').querySelector('button').click(); // back to ascending
  await w.advance(200);

  headerByLabel(tab, 'Product').querySelector('button').click();
  await w.advance(200);
  assert.equal(headerByLabel(tab, 'Product').getAttribute('aria-sort'), 'ascending');
  headerByLabel(tab, 'Product').querySelector('button').click();
  await w.advance(200);
  assert.equal(headerByLabel(tab, 'Product').getAttribute('aria-sort'), 'descending');
  noErrors(w);
});

test('columns: Symbol, Exchange, Last, Delay hidden by default; Product and Type never offered', async () => {
  const w = createWorld();
  const tab = await openPortfolio(w);
  await tab.setFlag('portfolioMergedTable', true);
  assert.equal(tab.$('[data-dg-columns]').textContent.trim(), '4 hidden ▾');
  tab.$('[data-dg-columns]').click();
  await w.advance(200);
  const items = tab.$$('[role=listbox] label').map(l => l.textContent.trim());
  assert.ok(!items.includes('Product'));
  assert.ok(!items.includes('Type'));
  assert.ok(items.includes('Symbol | ISIN'));
  noErrors(w);
});

test('a blank numeric cell sorts last in both ascending and descending order', async () => {
  const w = createWorld();
  const tab = await openPortfolio(w);
  await tab.setFlag('portfolioMergedTable', true);
  // Mock Software SE's Value hasn't ticked in yet (empty, as a real holding briefly shows before its
  // first price): this must not jump to the top just because we sorted descending.
  tab.$('[data-name=productName][data-id="332108"]').closest('tr').querySelector('[data-field=value]').textContent = '';
  await w.advance(200);
  const lastProduct = () => mergedRows(tab)[mergedRows(tab).length - 1].querySelector('[data-name=productName]');

  headerByLabel(tab, 'Value').querySelector('button').click(); // ascending
  await w.advance(200);
  assert.equal(headerByLabel(tab, 'Value').getAttribute('aria-sort'), 'ascending');
  assert.equal(lastProduct().textContent, 'Mock Software SE');

  headerByLabel(tab, 'Value').querySelector('button').click(); // descending
  await w.advance(200);
  assert.equal(headerByLabel(tab, 'Value').getAttribute('aria-sort'), 'descending');
  assert.equal(lastProduct().textContent, 'Mock Software SE');
  noErrors(w);
});

test('persist on: a sort change survives reload; persist off: it resets to default', async () => {
  const w = createWorld();
  let tab = await openPortfolio(w, { settings: { portfolioMergedTable: true, portfolioMergedPersist: true } });
  headerByLabel(tab, 'Product').querySelector('button').click();
  await w.advance(200);
  assert.equal(headerByLabel(tab, 'Product').getAttribute('aria-sort'), 'ascending');
  assert.deepEqual(w.stored('sync').dgPortfolioSort, { col: 'product', dir: 'ascending' });

  // "reload": close this tab (drops its queued timers/listeners) and open a fresh one in the same
  // world, so chrome.storage.sync persists across the "reload" the way the real page would.
  tab.close();
  tab = await openPortfolio(w);
  assert.equal(headerByLabel(tab, 'Product').getAttribute('aria-sort'), 'ascending', 'restored without a user click');

  await w.set('sync', { portfolioMergedPersist: false });
  tab.close();
  tab = await openPortfolio(w);
  assert.equal(headerByLabel(tab, 'Type').getAttribute('aria-sort'), 'ascending');

  // Binding: switching persist off never deletes the stored sort — switching it on again later
  // restores it, without the user having to re-sort.
  await w.set('sync', { portfolioMergedPersist: true });
  tab.close();
  tab = await openPortfolio(w);
  assert.equal(headerByLabel(tab, 'Product').getAttribute('aria-sort'), 'ascending');
  noErrors(w);
});

test('toggling persist off mid-session immediately reverts an already-applied sort to the default, without a reload', async () => {
  const w = createWorld();
  const tab = await openPortfolio(w, { settings: { portfolioMergedTable: true, portfolioMergedPersist: true } });
  headerByLabel(tab, 'Product').querySelector('button').click();
  await w.advance(200);
  assert.equal(headerByLabel(tab, 'Product').getAttribute('aria-sort'), 'ascending');

  // No reload here: flipping the toggle off alone (the Columns picker already reacts this way too)
  // must drop the already-applied Product sort back to the default right away.
  await w.set('sync', { portfolioMergedPersist: false });
  assert.equal(headerByLabel(tab, 'Type').getAttribute('aria-sort'), 'ascending');
  noErrors(w);
});

test('persist on: a hidden column survives reload; persist off: it resets to default, and restores when persist is on again', async () => {
  const w = createWorld();
  let tab = await openPortfolio(w, { settings: { portfolioMergedTable: true, portfolioMergedPersist: true } });
  tab.$('[data-dg-columns]').click();
  await w.advance(200);
  tab.$$('[role=listbox] label').find(l => l.textContent.trim() === 'Qty').querySelector('input').click(); // hide one more column (4 hidden by default)
  await w.advance(200);
  assert.equal(tab.$('[data-dg-columns]').textContent.trim(), '5 hidden ▾');

  tab.close();
  tab = await openPortfolio(w);
  assert.equal(tab.$('[data-dg-columns]').textContent.trim(), '5 hidden ▾');

  await w.set('sync', { portfolioMergedPersist: false });
  tab.close();
  tab = await openPortfolio(w);
  assert.equal(tab.$('[data-dg-columns]').textContent.trim(), '4 hidden ▾'); // back to DG_DEFAULTS, Qty shown again

  // Binding: switching persist off never deletes the stored choice — switching it on again later
  // restores it.
  await w.set('sync', { portfolioMergedPersist: true });
  tab.close();
  tab = await openPortfolio(w);
  assert.equal(tab.$('[data-dg-columns]').textContent.trim(), '5 hidden ▾');
  noErrors(w);
});

test('merged Next page advances the etf section\'s native pager and re-collects rows', async () => {
  const w = createWorld();
  const tab = await openPortfolio(w, { settings: { portfolioMergedTable: true } });
  assert.equal(mergedRows(tab).length, 6); // 3 stock + 2 etf(page1) + 1 lox
  const next = tab.$('[data-dg-portfolio-table] + [data-name=pagination] button[data-dg-page=next]');
  assert.equal(next.getAttribute('aria-label'), 'Next page'); // the extension's own (English) text
  next.click();
  await w.advance(200);
  // stock's own Next is disabled (1 page) and lox's own Next is disabled (1 page) — neither receives
  // a click; only etf (2 pages) advances.
  assert.equal(tab.$('h3[data-name=etf] ~ * [data-name=pagination] [aria-current=true]').textContent, '2');
  assert.equal(mergedRows(tab).length, 5); // 3 stock + 1 etf(page2) + 1 lox
  noErrors(w);
});

test('merged pagination finds DEGIRO\'s own Previous/Next by position, not by their (localised) aria-labels', async () => {
  const w = createWorld();
  const tab = await openPortfolio(w);
  // as on a Dutch account
  tab.$$('.holdings [data-name=pagination]').forEach(p => {
    const b = p.querySelectorAll('button');
    b[0].setAttribute('aria-label', 'Vorige pagina');
    b[b.length - 1].setAttribute('aria-label', 'Volgende pagina');
  });
  await tab.setFlag('portfolioMergedTable', true);
  const pager = () => tab.$('[data-dg-portfolio-table] + [data-name=pagination]');
  assert.equal(pager().querySelector('[data-dg-page=prev]').disabled, true);
  assert.equal(pager().querySelector('[data-dg-page=next]').disabled, false);
  pager().querySelector('[data-dg-page=next]').click();
  await w.advance(200);
  assert.equal(mergedRows(tab).length, 5);
  assert.equal(pager().querySelector('[data-dg-page=next]').disabled, true);
  assert.equal(pager().querySelector('[data-dg-page=prev]').disabled, false);
  pager().querySelector('[data-dg-page=prev]').click();
  await w.advance(200);
  assert.equal(mergedRows(tab).length, 6);
  noErrors(w);
});

test('the merged pager shows the furthest page any section is on', async () => {
  const w = createWorld();
  const tab = await openPortfolio(w);
  await tab.setFlag('portfolioMergedTable', true);
  const current = () => tab.$('[data-dg-portfolio-table] + [data-name=pagination] [data-dg-page=current]');
  assert.equal(current().textContent, '1');
  tab.$('[data-dg-portfolio-table] + [data-name=pagination] [data-dg-page=next]').click();
  await w.advance(200);
  assert.equal(current().textContent, '2'); // etf on page 2, stock/lox on 1
  noErrors(w);
});

test('numeric sort: a live tick on a sorted row updates its merged cell and re-sorts', async () => {
  const w = createWorld();
  const tab = await openPortfolio(w);
  await tab.setFlag('portfolioMergedTable', true);
  headerByLabel(tab, 'Value').querySelector('button').click(); // ascending
  await w.advance(200);
  assert.equal(headerByLabel(tab, 'Value').getAttribute('aria-sort'), 'ascending');
  const lastRow = () => mergedRows(tab)[mergedRows(tab).length - 1];
  assert.equal(lastRow().querySelector('[data-name=productName]').textContent, 'Mock S&P 500 ETF USD'); // 13.120,00, the largest
  // Mock Pharma NV (886,00) ticks up past every other value
  tab.$('[data-name=productName][data-id="332109"]').closest('tr').querySelector('[data-field=value]').textContent = '99.999,99';
  await w.advance(200);
  assert.equal(lastRow().querySelector('[data-name=productName]').textContent, 'Mock Pharma NV');
  assert.equal(lastRow().querySelector('[data-field=value]').textContent, '99.999,99');
  noErrors(w);
});

test('persist on: toggling persist off then on again mid-session restores the stored sort, without a reload', async () => {
  const w = createWorld();
  const tab = await openPortfolio(w, { settings: { portfolioMergedTable: true, portfolioMergedPersist: true } });
  headerByLabel(tab, 'Product').querySelector('button').click();
  await w.advance(200);
  assert.equal(headerByLabel(tab, 'Product').getAttribute('aria-sort'), 'ascending');
  assert.deepEqual(w.stored('sync').dgPortfolioSort, { col: 'product', dir: 'ascending' });

  await w.set('sync', { portfolioMergedPersist: false });
  assert.equal(headerByLabel(tab, 'Type').getAttribute('aria-sort'), 'ascending');

  await w.set('sync', { portfolioMergedPersist: true });
  assert.equal(headerByLabel(tab, 'Product').getAttribute('aria-sort'), 'ascending');
  noErrors(w);
});

// logic half of "the toolbar labels its picker 'Columns', like Orders' own" (e2e keeps the visual
// toBeVisible() check on the "Columns" label itself).
test('the toolbar labels its picker "Columns", like Orders\' own: text includes the hidden-column count', async () => {
  const w = createWorld();
  const tab = await openPortfolio(w);
  await tab.setFlag('portfolioMergedTable', true);
  assert.equal(tab.$('#dg-portfolio-toolbar').textContent.trim(), 'Columns4 hidden ▾');
  noErrors(w);
});

// logic half of "persist off: the Columns picker works for the session, and nothing is remembered
// after a reload" (e2e keeps the CSS-driven toBeHidden() check on the qty header itself).
test('persist off: the Columns picker works for the session, and nothing is remembered after a reload: storage and counts', async () => {
  const w = createWorld();
  const tab = await openPortfolio(w, { settings: { portfolioMergedTable: true } });
  tab.$('[data-dg-columns]').click();
  await w.advance(200);
  tab.$$('[role=listbox] label').find(l => l.textContent.trim() === 'Qty').querySelector('input').click();
  await w.advance(200);
  assert.equal(tab.$('[data-dg-columns]').textContent.trim(), '5 hidden ▾');
  tab.$('[data-dg-columns-reset]').click();
  await w.advance(200);
  assert.equal(tab.$('[data-dg-columns]').textContent.trim(), '4 hidden ▾');
  tab.$$('[role=listbox] label').find(l => l.textContent.trim() === 'Qty').querySelector('input').click();
  await w.advance(200);
  assert.equal(tab.$('[data-dg-columns]').textContent.trim(), '5 hidden ▾');
  assert.deepEqual(w.stored('sync').portfolioHiddenColumns, undefined, 'never written while persist is off');

  tab.close();
  const tab2 = await openPortfolio(w); // "reload": nothing was persisted, so defaults come back
  assert.equal(tab2.$('[data-dg-columns]').textContent.trim(), '4 hidden ▾');
  noErrors(w);
});
