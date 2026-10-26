// Clicking an order badge must open that exact order, also in other DEGIRO languages
// and when a similar product has an order of the same size and price.
const { test, expect } = require('./fixtures');

const badge = page => page.locator('#chart div:not(:has(div))', { hasText: /^BUY 100 · 15,50$/ });
const log = page => page.evaluate(() => window.__log.join(','));

// same side, size and price; the other product's order is listed first
const TWINS = [
  { productId: 999, product: 'Mock Core World UCITS ETF (Dist)', buysell: 'B', size: 100, price: 15.5, stopPrice: 0, orderType: 'LIMIT' },
  { productId: 123, product: 'Mock Core World UCITS ETF (Acc)', buysell: 'B', size: 100, price: 15.5, stopPrice: 0, orderType: 'LIMIT' }
];

test('Dutch DEGIRO: expands the panel and finds the row (K/V side letters)', async ({ degiro }) => {
  const { page } = await degiro({ initScript: () => {
    window.__MOCK_PANEL_LABELS = ['Vergroten', 'Verkleinen'];
    window.__MOCK_SIDES = { B: 'K', S: 'V' };
  } });
  await expect(badge(page)).toBeVisible({ timeout: 8000 });
  await badge(page).click();
  await expect(page.locator('#limit')).toHaveValue('15.5');
  await expect.poll(() => log(page)).toBe('panel:expand,edit:1,panel:minimise');
});

test('rows without DEGIRO hooks: localised side letters still match', async ({ degiro }) => {
  const { page } = await degiro({ initScript: () => {
    window.__MOCK_NO_HOOKS = true;
    window.__MOCK_SIDES = { B: 'A', S: 'V' };
  } });
  await expect(badge(page)).toBeVisible({ timeout: 8000 });
  await badge(page).click();
  await expect.poll(() => log(page)).toBe('panel:expand,edit:1,panel:minimise');
});

test('a similar product with the same order: the order id picks the right row', async ({ degiro }) => {
  const { page } = await degiro({ orders: TWINS });
  await expect(badge(page)).toBeVisible({ timeout: 8000 });
  await badge(page).click();
  await expect.poll(() => log(page)).toBe('panel:expand,edit:1,panel:minimise');
});

test('a similar product with the same order, no ids: the full name picks the right row', async ({ degiro }) => {
  const { page } = await degiro({ orders: TWINS, initScript: () => { window.__MOCK_NO_HOOKS = true; } });
  await expect(badge(page)).toBeVisible({ timeout: 8000 });
  await badge(page).click();
  await expect.poll(() => log(page)).toBe('panel:expand,edit:1,panel:minimise');
});

test('a shortened name that fits two orders opens neither', async ({ degiro }) => {
  const orders = TWINS.map(o => ({ ...o, shownName: 'Mock Core World UCITS…' }));
  const { page } = await degiro({ orders, initScript: () => { window.__MOCK_NO_HOOKS = true; } });
  await expect(badge(page)).toBeVisible({ timeout: 8000 });
  await badge(page).click();
  await expect(badge(page)).toHaveAttribute('title', /not found/i, { timeout: 6000 });
  expect(await log(page)).not.toContain('edit:');
});

test('a shortened name that fits one order opens it', async ({ degiro }) => {
  const orders = [{ ...TWINS[1], shownName: 'Mock Core World UCITS ETF (A…' }];
  const { page } = await degiro({ orders, initScript: () => { window.__MOCK_NO_HOOKS = true; } });
  await expect(badge(page)).toBeVisible({ timeout: 8000 });
  await badge(page).click();
  await expect.poll(() => log(page)).toBe('panel:expand,edit:0,panel:minimise');
});
