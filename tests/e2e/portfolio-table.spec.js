// e2e: the Portfolio page's holdings fixture (tests/fixtures/portfolio.html) carries the real DOM
// hooks for the merged holdings table feature's selectors (checked live, see the plan's Global
// Constraints). This file grows task-by-task as that feature is built.
const { test, expect } = require('./fixtures');
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
  await expect(page.locator('h3[data-name=stock] ~ * table')).toBeHidden();
  await expect(page.locator('h3[data-name=etf] ~ * table')).toBeHidden();
  await expect(page.locator('h3[data-name=lox] ~ * table')).toBeHidden();
  // every column is in the DOM (Columns dropdown needs them all, see the "columns:" test below);
  // the default-hidden ones (Symbol | ISIN, Exchange, Last, Delay) are hidden with CSS, like Orders'
  // own columns feature, so only the visible headers are asserted here.
  const heads = () => page.$$eval('[data-dg-portfolio-table] thead th',
    ths => ths.filter(th => getComputedStyle(th).display !== 'none').map(th => th.textContent));
  await expect.poll(heads).toEqual(['Product', 'Type', 'Qty', 'Price', 'Curr.', 'Value', 'BEP', 'P/L €', 'P/L %', 'Unrealised P/L €', 'Total P/L€', '']);
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

test('default sort is Type ascending; clicking Product header sorts and toggles direction', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const types = () => page.locator('[data-dg-portfolio-table] tbody tr [data-dg-type]').allTextContents();
  expect(await types()).toEqual([...(await types())].sort());

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
