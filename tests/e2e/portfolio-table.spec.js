// e2e: the Portfolio page's holdings fixture (tests/fixtures/portfolio.html) carries the real DOM
// hooks for the merged holdings table feature's selectors (checked live, see the plan's Global
// Constraints). This file grows task-by-task as that feature is built.
const { test, expect } = require('./fixtures');
const URL_P = 'https://trader.degiro.nl/trader/?mock=portfolio#/portfolio';

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
  await expect(page.locator('[data-dg-portfolio-table] thead th')).toHaveText(
    ['Product', 'Type', 'Qty', 'Price', 'Curr.', 'Value', 'BEP', 'P/L €', 'P/L %', 'Unrealised P/L €', 'Total P/L€']
  ); // default-hidden columns (Symbol | ISIN, Exchange, Last, Delay) absent
});
