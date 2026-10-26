// Narrow window: DEGIRO uses a mobile layout where the orders list is in the "Account overview"
// drawer instead of the bottom panel.
const { test, expect } = require('./fixtures');

const mobile = { initScript: () => { window.__MOBILE = true; } };

test('clicking a badge opens the drawer and the Adjust order form for that order', async ({ degiro }) => {
  const { page } = await degiro(mobile);
  const badge = page.locator('#chart div', { hasText: /^BUY 100 · 15,50$/ });
  await expect(badge).toBeVisible({ timeout: 8000 });
  await badge.click();
  await expect(page.locator('[data-name=orderDetails]')).toBeVisible();
  await expect(page.locator('#limit')).toHaveValue('15.5');
  // the drawer stays open, otherwise DEGIRO would close the form
  expect(await page.evaluate(() => window.__log)).toEqual(['drawer:open', 'edit:1']);
});

test('click outside cancels the form and closes the drawer we opened', async ({ degiro }) => {
  const { page } = await degiro(mobile);
  const badge = page.locator('#chart div', { hasText: /^BUY 100 · 15,50$/ });
  await expect(badge).toBeVisible({ timeout: 8000 });
  await badge.click();
  await expect(page.locator('[data-name=orderDetails]')).toBeVisible();
  await page.click('#outside');
  await expect(page.locator('[data-name=orderDetails]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__log)).toEqual(['drawer:open', 'edit:1', 'cancel', 'drawer:close']);
});
