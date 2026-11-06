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
