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

test('with the form open, another badge switches it; the drawer stays open and is closed after Cancel', async ({ degiro }) => {
  const { page } = await degiro(mobile);
  const buy = page.locator('#chart div', { hasText: /^BUY 100 · 15,50$/ });
  await expect(buy).toBeVisible({ timeout: 8000 });
  await buy.click();
  await expect(page.locator('#limit')).toHaveValue('15.5');
  await page.locator('#chart div', { hasText: /^SELL 200 · 17,65$/ }).click();
  await expect(page.locator('#limit')).toHaveValue('17.65');
  expect(await page.evaluate(() => window.__log)).toEqual(['drawer:open', 'edit:1', 'edit:0']);
  // the drawer we opened is still known as ours: Cancel closes it again
  await page.click('#outside');
  await expect(page.locator('[data-name=orderDetails]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__log)).toEqual(['drawer:open', 'edit:1', 'edit:0', 'cancel', 'drawer:close']);
});

// DEGIRO's tooltip of the edit button we press (modelled in the mock: shown on focus and hover)
test('no "Adjust order" tooltip of the pressed edit button stays in the drawer', async ({ degiro }) => {
  const { page } = await degiro(mobile);
  const tip = page.locator('[role=tooltip]', { hasText: 'Adjust order' });
  const buy = page.locator('#chart div', { hasText: /^BUY 100 · 15,50$/ });
  await expect(buy).toBeVisible({ timeout: 8000 });
  await buy.click();
  await expect(page.locator('#limit')).toHaveValue('15.5');
  await expect(tip).toBeHidden();
  await page.locator('#chart div', { hasText: /^SELL 200 · 17,65$/ }).click();
  await expect(page.locator('#limit')).toHaveValue('17.65');
  expect(await page.evaluate(() => window.__log)).toEqual(['drawer:open', 'edit:1', 'edit:0']);
  await expect(tip).toBeHidden();
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

test('Esc cancels the form and closes the drawer we opened', async ({ degiro }) => {
  const { page } = await degiro(mobile);
  const badge = page.locator('#chart div', { hasText: /^BUY 100 · 15,50$/ });
  await expect(badge).toBeVisible({ timeout: 8000 });
  await badge.click();
  await expect(page.locator('[data-name=orderDetails]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-name=orderDetails]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__log)).toEqual(['drawer:open', 'edit:1', 'cancel', 'drawer:close']);
});
