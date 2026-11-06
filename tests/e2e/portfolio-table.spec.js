// e2e: the Portfolio page's holdings fixture (tests/fixtures/portfolio.html) carries the real DOM
// hooks for the merged holdings table feature's selectors (checked live, see the plan's Global
// Constraints). This file grows task-by-task as that feature is built.
const { test, expect, setFlag } = require('./fixtures');
const URL_P = 'https://trader.degiro.nl/trader/?mock=portfolio#/portfolio';
const URL_O = 'https://trader.degiro.nl/trader/?mock=orders#/orders/open';

// Raw per-feature status (status.js's message reply), not the popup's rendered list: options.js's
// own FEATURES map (extension/options.js) doesn't offer portfolioTable as a popup row yet, but the
// scheduler still tracks and reports its status like any other feature.
async function rawStatus(page, opt) {
  await page.bringToFront();
  return opt.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return chrome.tabs.sendMessage(tab.id, { type: 'dg-status' });
  });
}

test('fixture renders three holdings sections with real hooks', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_P });
  await expect(page.locator('h3[data-name=stock]')).toHaveText('Shares');
  await expect(page.locator('h3[data-name=etf]')).toHaveText('Trackers (ETFs)');
  await expect(page.locator('h3[data-name=lox]')).toHaveText('Structured products');
  await expect(page.locator('[data-name=productName]')).toHaveCount(6); // 3 + 2 + 1 rows
});

test('enabling the feature hides the native tables and renders a merged header', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  // each section's own heading, table and pager are hidden, not just the table; the merged
  // toolbar, table and pager themselves stay visible
  for (const s of ['stock', 'etf', 'lox']) {
    await expect(page.locator(`h3[data-name=${s}]`)).toBeHidden();
    await expect(page.locator(`h3[data-name=${s}] ~ * table`)).toBeHidden();
    await expect(page.locator(`h3[data-name=${s}] ~ * [data-name=pagination]`)).toBeHidden();
  }
  await expect(page.locator('#dg-portfolio-toolbar')).toBeVisible();
  await expect(page.locator('[data-dg-portfolio-table]')).toBeVisible();
  // every column is in the DOM (Columns dropdown needs them all, see the "columns:" test below);
  // the default-hidden ones (Symbol | ISIN, Exchange, Last, Delay) are hidden with CSS, like Orders'
  // own columns feature, so only the visible headers are asserted here. Each header is DEGIRO's own
  // (localised) native header text; Type is this feature's own column, so its label is ours.
  const heads = () => page.$$eval('[data-dg-portfolio-table] thead th',
    ths => ths.filter(th => getComputedStyle(th).display !== 'none').map(th => th.textContent));
  await expect.poll(heads).toEqual(['Product', 'Type', 'Qty', 'Price', 'Curr.', 'Value', 'Break Even Price', 'Today\'s P&L',
    'Today\'s P&L %', 'P&L Unrealized', 'P&L Total', '']);
});

test('merged headers follow DEGIRO\'s own (localised) header text', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  // as on a Dutch account: the native header texts are translated, the body-cell hooks are not
  await page.evaluate(() => document.querySelectorAll('.holdings thead').forEach(thead => {
    thead.querySelectorAll('th')[3].textContent = 'Aantal';
  }));
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await expect(page.locator('[data-dg-portfolio-table] th[data-dg-col=qty]')).toHaveText('Aantal');
  // the Columns picker offers the same label
  await page.locator('[data-dg-columns]').click();
  await expect(page.locator('[role=listbox] label', { hasText: 'Aantal' })).toHaveCount(1);
  // DEGIRO renames a header later (e.g. after a language switch): the merged one follows
  await page.evaluate(() => { document.querySelector('h3[data-name=stock] ~ * thead th:nth-child(4)').textContent = 'Stück'; });
  await expect(page.locator('[data-dg-portfolio-table] th[data-dg-col=qty]')).toHaveText('Stück');
});

test('merged table copies the native table, header, cell and Buy/Sell button styling', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const merged = page.locator('[data-dg-portfolio-table]');
  await expect(merged).toHaveClass('holdingsTable');
  await expect(merged.locator('th[data-dg-col=value]')).toHaveClass('holdingsHead');
  await expect(merged.locator('th[data-dg-col=type]')).toHaveClass('holdingsHead'); // no native Type: a representative header
  await expect(merged.locator('tbody tr').first().locator('[data-field=value]')).toHaveClass('holdingsCell');
  // Buy/Sell are copies of DEGIRO's own buttons: class and inner markup survive the merge
  const buy = merged.locator('tbody tr').first().locator('button[data-action=buy]');
  await expect(buy).toHaveClass('holdingsAction');
  await expect(buy.locator('span.holdingsActionLabel')).toHaveText('Buy');
});

test('without native classes, the merged table falls back to theme-based inline styles', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  await page.evaluate(() => document.querySelectorAll('.holdings [class]').forEach(el => el.removeAttribute('class')));
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const th = page.locator('[data-dg-portfolio-table] th[data-dg-col=value]');
  await expect(th).toHaveAttribute('class', '');
  await expect(th).toHaveCSS('border-bottom-style', 'solid');
  await expect(th).toHaveCSS('color', 'rgb(101, 117, 123)'); // dgUi.theme().muted, light theme
  await expect(page.locator('[data-dg-portfolio-table]')).toHaveCSS('border-collapse', 'collapse');
});

test('flat sections: only each section\'s own heading, table and pager are hidden, not what follows', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  // The three sections as flat siblings (unconfirmed live), followed by an unrelated block with its
  // own heading, table and pager, like the Foreign currency Cash Accounts.
  await page.evaluate(() => {
    const holdings = document.querySelector('.holdings');
    holdings.querySelectorAll('section').forEach(s => { s.replaceWith(...s.children); });
    const h3 = document.createElement('h3');
    h3.id = 'cash';
    h3.textContent = 'Cash accounts';
    const wrap = document.createElement('div');
    wrap.id = 'cashWrap';
    const table = document.createElement('table');
    table.innerHTML = '<tbody><tr><td>EUR</td></tr></tbody>';
    const pagination = document.createElement('div');
    pagination.setAttribute('data-name', 'pagination');
    pagination.innerHTML = '<button type="button">‹</button><button type="button">1</button><button type="button">›</button>';
    wrap.append(table, pagination);
    holdings.append(h3, wrap);
  });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(6);
  for (const s of ['stock', 'etf', 'lox']) await expect(page.locator(`h3[data-name=${s}]`)).toBeHidden();
  await expect(page.locator('.holdings > .tableWrap table')).toHaveCount(3);
  for (const el of await page.locator('.holdings > .tableWrap').all()) {
    await expect(el.locator('table')).toBeHidden();
    await expect(el.locator('[data-name=pagination]')).toBeHidden();
  }
  await expect(page.locator('#cash')).toBeVisible();
  await expect(page.locator('#cashWrap table')).toBeVisible();
  await expect(page.locator('#cashWrap [data-name=pagination]')).toBeVisible();
});

test('ETF-only portfolio (no Shares section): the merge still engages, anchored on the first section', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  await page.evaluate(() => document.querySelector('[data-holdings=stock]').remove());
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(3); // 2 etf (page 1) + 1 lox
  expect(await page.$eval('[data-dg-portfolio-table]', t => t.parentElement.getAttribute('data-holdings'))).toBe('etf');
  await expect(page.locator('h3[data-name=etf]')).toBeHidden();
  await expect.poll(async () => (await rawStatus(page, opt)).portfolioTable).toBe('ok');
});

test('off the Portfolio page, the feature reports idle, not missing', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_O }); // no h3[data-name=stock] here, and never will be
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await expect.poll(async () => (await rawStatus(page, opt)).portfolioTable).toBe('idle');
});

test('merged table shows all rows from all three sections and tracks a live update', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(6);
  await page.evaluate(() => { document.querySelector('h3[data-name=stock] ~ * [data-field=value]').textContent = '9.999,99'; });
  await expect(page.locator('[data-dg-portfolio-table] tbody tr').first().locator('[data-field=value]')).toHaveText('9.999,99');
});

test('clicking a merged row\'s Buy button clicks the real hidden Buy button', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await page.locator('[data-dg-portfolio-table] tbody tr').first().locator('button[data-action=buy]').click();
  await expect(page.locator('h3[data-name=stock] ~ * table tbody tr').first()).toHaveAttribute('data-dg-last-clicked', 'buy');
});

test('the merged rows are updated in place: a live tick keeps its buttons, focus, and a forwarded click reaches DEGIRO\'s re-rendered row', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const firstRow = page.locator('[data-dg-portfolio-table] tbody tr').first();
  await expect(firstRow.locator('button[data-action=sell]')).toHaveCount(1);
  await firstRow.locator('button[data-action=sell]').focus();
  await page.evaluate(() => { window.__mergedSell = document.activeElement; });
  // a live tick in the native row
  await page.evaluate(() => { document.querySelector('h3[data-name=stock] ~ * [data-field=price]').textContent = '130,00'; });
  await expect(firstRow.locator('[data-field=price]')).toHaveText('130,00');
  expect(await page.evaluate(() => window.__mergedSell.isConnected && document.activeElement === window.__mergedSell)).toBe(true);
  // DEGIRO re-renders its own rows (new <tr>s and buttons): the kept merged button still reaches the new one
  await page.evaluate(() => window.__rerenderHoldings('stock'));
  await page.evaluate(() => window.__mergedSell.click());
  await expect(page.locator('h3[data-name=stock] ~ * table tbody tr').first()).toHaveAttribute('data-dg-last-clicked', 'sell');
});

test('default sort is Type in DEGIRO\'s section order; clicking Product header sorts and toggles direction', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  // Shares, then Trackers (ETFs), then Structured products — not alphabetical by the (localised) label,
  // which in English would put Structured products before Trackers (ETFs)
  const types = () => page.locator('[data-dg-portfolio-table] tbody tr [data-dg-type]').evaluateAll(tds => tds.map(td => td.getAttribute('data-dg-type')));
  await expect.poll(types).toEqual(['stock', 'stock', 'stock', 'etf', 'etf', 'lox']);
  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Type' }).click(); // descending
  await expect.poll(types).toEqual(['lox', 'etf', 'etf', 'stock', 'stock', 'stock']);
  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Type' }).click(); // back to ascending

  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Product' }).click();
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Product' })).toHaveAttribute('aria-sort', 'ascending');
  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Product' }).click();
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Product' })).toHaveAttribute('aria-sort', 'descending');
});

test('columns: Symbol, Exchange, Last, Delay hidden by default; Product and Type never offered', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await expect(page.locator('[data-dg-columns]')).toHaveText('4 hidden ▾');
  await page.locator('[data-dg-columns]').click();
  const items = await page.locator('[role=listbox] label').allTextContents();
  expect(items).not.toContain('Product');
  expect(items).not.toContain('Type');
  expect(items).toContain('Symbol | ISIN');
});

test('a blank numeric cell sorts last in both ascending and descending order', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  // Mock Software SE's Value hasn't ticked in yet (empty, as a real holding briefly shows before its
  // first price): this must not jump to the top just because we sorted descending.
  await page.evaluate(() => {
    document.querySelector('[data-name=productName][data-id="332108"]').closest('tr').querySelector('[data-field=value]').textContent = '';
  });
  const lastProduct = () => page.locator('[data-dg-portfolio-table] tbody tr:last-child [data-name=productName]');

  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Value' }).click(); // ascending
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Value' })).toHaveAttribute('aria-sort', 'ascending');
  await expect(lastProduct()).toHaveText('Mock Software SE');

  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Value' }).click(); // descending
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Value' })).toHaveAttribute('aria-sort', 'descending');
  await expect(lastProduct()).toHaveText('Mock Software SE');
});

test('persist on: a sort change survives reload; persist off: it resets to default', async ({ degiro, settings }) => {
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true, portfolioMergedPersist: true }));
  const { page } = await degiro({ url: URL_P });
  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Product' }).click();
  await page.reload();
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Product' })).toHaveAttribute('aria-sort', 'ascending');

  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedPersist: false }));
  await page.reload();
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Type' })).toHaveAttribute('aria-sort', 'ascending');

  // Binding: switching persist off never deletes the stored sort — switching it on again later
  // restores it, without the user having to re-sort.
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedPersist: true }));
  await page.reload();
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Product' })).toHaveAttribute('aria-sort', 'ascending');
});

test('toggling persist off mid-session immediately reverts an already-applied sort to the default, without a reload', async ({ degiro, settings }) => {
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true, portfolioMergedPersist: true }));
  const { page } = await degiro({ url: URL_P });
  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Product' }).click();
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Product' })).toHaveAttribute('aria-sort', 'ascending');

  // No reload here: flipping the toggle off alone (the Columns picker already reacts this way too)
  // must drop the already-applied Product sort back to the default right away.
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedPersist: false }));
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Type' })).toHaveAttribute('aria-sort', 'ascending');
});

test('persist on: a hidden column survives reload; persist off: it resets to default, and restores when persist is on again', async ({ degiro, settings }) => {
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true, portfolioMergedPersist: true }));
  const { page } = await degiro({ url: URL_P });
  await page.locator('[data-dg-columns]').click();
  await page.locator('[role=listbox] label', { hasText: 'Qty' }).click(); // hide one more column (4 hidden by default)
  await expect(page.locator('[data-dg-columns]')).toHaveText('5 hidden ▾');
  await page.reload();
  await expect(page.locator('[data-dg-columns]')).toHaveText('5 hidden ▾');

  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedPersist: false }));
  await page.reload();
  await expect(page.locator('[data-dg-columns]')).toHaveText('4 hidden ▾'); // back to DG_DEFAULTS, Qty shown again

  // Binding: switching persist off never deletes the stored choice — switching it on again later
  // restores it.
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedPersist: true }));
  await page.reload();
  await expect(page.locator('[data-dg-columns]')).toHaveText('5 hidden ▾');
});

// The merged pager sits as a sibling right after the merged table (like columnsToolbar()'s own bar
// sits as a sibling right before it) — a <div> is not valid direct <table> content, and the existing
// architecture already keeps toolbar elements as siblings rather than nesting them inside the table.
test('merged Next page advances the etf section\'s native pager and re-collects rows', async ({ degiro, settings }) => {
  const opt = await settings(); await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const { page } = await degiro({ url: URL_P });
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(6); // 3 stock + 2 etf(page1) + 1 lox
  const next = page.locator('[data-dg-portfolio-table] + [data-name=pagination] button[data-dg-page=next]');
  await expect(next).toHaveAttribute('aria-label', 'Next page'); // the extension's own (English) text
  await next.click();
  // stock's own Next is disabled (1 page) and lox's own Next is disabled (1 page) — neither receives
  // a click; only etf (2 pages) advances.
  await expect(page.locator('h3[data-name=etf] ~ * [data-name=pagination] button', { hasText: '2' })).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(5); // 3 stock + 1 etf(page2) + 1 lox
});

test('merged pagination finds DEGIRO\'s own Previous/Next by position, not by their (localised) aria-labels', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  // as on a Dutch account
  await page.evaluate(() => document.querySelectorAll('.holdings [data-name=pagination]').forEach(p => {
    const b = p.querySelectorAll('button');
    b[0].setAttribute('aria-label', 'Vorige pagina');
    b[b.length - 1].setAttribute('aria-label', 'Volgende pagina');
  }));
  const opt = await settings(); await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const pager = page.locator('[data-dg-portfolio-table] + [data-name=pagination]');
  await expect(pager.locator('[data-dg-page=prev]')).toBeDisabled();
  await expect(pager.locator('[data-dg-page=next]')).toBeEnabled();
  await pager.locator('[data-dg-page=next]').click();
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(5);
  await expect(pager.locator('[data-dg-page=next]')).toBeDisabled();
  await expect(pager.locator('[data-dg-page=prev]')).toBeEnabled();
  await pager.locator('[data-dg-page=prev]').click();
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(6);
});

test('the merged pager is hidden while every section is on its only page', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings(); await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const pager = page.locator('[data-dg-portfolio-table] + [data-name=pagination]');
  await expect(pager).toBeVisible(); // etf has a second page
  // etf's third holding is sold: every section now fits on one page
  await page.evaluate(() => { window.__PORTFOLIO.etf.rows.pop(); window.__rerenderHoldings('etf'); });
  await expect(pager).toBeHidden();
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(6);
});

test('numeric sort: a live tick on a sorted row updates its merged cell and re-sorts', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Value' }).click(); // ascending
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Value' })).toHaveAttribute('aria-sort', 'ascending');
  const lastRow = page.locator('[data-dg-portfolio-table] tbody tr:last-child');
  await expect(lastRow.locator('[data-name=productName]')).toHaveText('Mock S&P 500 ETF USD'); // 13.120,00, the largest
  // Mock Pharma NV (886,00) ticks up past every other value
  await page.evaluate(() => {
    document.querySelector('[data-name=productName][data-id="332109"]').closest('tr').querySelector('[data-field=value]').textContent = '99.999,99';
  });
  await expect(lastRow.locator('[data-name=productName]')).toHaveText('Mock Pharma NV');
  await expect(lastRow.locator('[data-field=value]')).toHaveText('99.999,99');
});

test('persist on: toggling persist off then on again mid-session restores the stored sort, without a reload', async ({ degiro, settings }) => {
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true, portfolioMergedPersist: true }));
  const { page } = await degiro({ url: URL_P });
  const product = page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Product' });
  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Product' }).click();
  await expect(product).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(() => opt.evaluate(() => chrome.storage.sync.get('dgPortfolioSort'))).toEqual({ dgPortfolioSort: { col: 'product', dir: 'ascending' } });
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedPersist: false }));
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Type' })).toHaveAttribute('aria-sort', 'ascending');
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedPersist: true }));
  await expect(product).toHaveAttribute('aria-sort', 'ascending');
});

test('persist off: the Columns picker works for the session, and nothing is remembered after a reload', async ({ degiro, settings }) => {
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const { page } = await degiro({ url: URL_P });
  await page.locator('[data-dg-columns]').click();
  await page.locator('[role=listbox] label', { hasText: 'Qty' }).click();
  await expect(page.locator('[data-dg-columns]')).toHaveText('5 hidden ▾');
  await expect(page.locator('[data-dg-portfolio-table] th[data-dg-col=qty]')).toBeHidden();
  await page.locator('[data-dg-columns-reset]').click();
  await expect(page.locator('[data-dg-columns]')).toHaveText('4 hidden ▾');
  await page.locator('[role=listbox] label', { hasText: 'Qty' }).click();
  await expect(page.locator('[data-dg-columns]')).toHaveText('5 hidden ▾');
  expect(await opt.evaluate(() => chrome.storage.sync.get('portfolioHiddenColumns'))).toEqual({});
  await page.reload();
  await expect(page.locator('[data-dg-columns]')).toHaveText('4 hidden ▾');
});

// Review Focus (binding): a malformed or stale persisted value must fall back to the default rather
// than throwing or rendering an empty table. sanitizePortfolioSort() isn't exported (orders-table.js's
// own sanitizeSort isn't either, and has no dedicated unit test) — covered here the same way
// sanitizeSort's correctness is covered today, through e2e behaviour.
test('a stale saved sort column falls back to the default sort, and the table still renders', async ({ degiro, settings }) => {
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({
    portfolioMergedTable: true, portfolioMergedPersist: true,
    dgPortfolioSort: { col: 'noLongerAColumn', dir: 'ascending' }
  }));
  const { page } = await degiro({ url: URL_P });
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Type' })).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(6);
});

test('portfolio merge toggles are present and save', async ({ settings }) => {
  const opt = await settings();
  // the persist toggle is a sub-option of the merge itself, greyed out while the merge is off
  const persistRow = opt.locator('label.sub[data-depends=portfolioMergedTable]', { has: opt.locator('[data-key=portfolioMergedPersist]') });
  await expect(persistRow).toHaveClass(/\bdisabled\b/);
  await setFlag(opt, 'portfolioMergedTable', true);
  await expect(persistRow).not.toHaveClass(/\bdisabled\b/);
  await expect.poll(() => opt.evaluate(() => chrome.storage.sync.get('portfolioMergedTable'))).toEqual({ portfolioMergedTable: true });
  await setFlag(opt, 'portfolioMergedPersist', true);
  await expect.poll(() => opt.evaluate(() => chrome.storage.sync.get('portfolioMergedPersist'))).toEqual({ portfolioMergedPersist: true });
});
