// Orders → Outstanding: filters (action, currency, product multi-select) and buy/sell totals per currency.
const { test, expect, setFlag } = require('./fixtures');

const URL_O = 'https://trader.degiro.nl/trader/?mock=orders#/orders/open';
const panel = page => page.locator('#dg-orders-panel');
const chip = (page, text) => panel(page).locator('button', { hasText: new RegExp(`^${text.replace(/[$]/g, '\\$')}$`) });
const visibleRows = page => page.$$eval('#rows tr', rs => rs.filter(r => getComputedStyle(r).display !== 'none').map(r => r.querySelector('[data-name=productName]').textContent + '|' + r.children[4].textContent + '|' + r.querySelector('[data-field=limitColumnValue]').textContent));
const totals = page => panel(page).locator('[data-dg-totals]');

test('shows totals per currency for buy and sell', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  await expect(totals(page)).toContainText('Total buy $ 18.903,50 (3) · € 6.800,00 (3)');
  await expect(totals(page)).toContainText('Total sell $ 2.500,00 (1) · € 3.600,00 (1)');
  await expect(totals(page)).toContainText('8 of 8 orders');
});

test('panel sits above the table, below the search box', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  await expect(panel(page)).toBeVisible();
  expect(await page.$eval('#dg-orders-panel', el => el.nextElementSibling.id)).toBe('tableWrap');
});

test('action filter', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  await chip(page, 'Sell').click();
  expect((await visibleRows(page)).every(r => r.includes('|Sell|'))).toBe(true);
  expect((await visibleRows(page)).length).toBe(2);
  await expect(totals(page)).toContainText('Total buy —');
});

test('currency filter (multi-select)', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  await chip(page, '$').click();
  expect((await visibleRows(page)).every(r => r.endsWith('$ ' + r.split('$ ')[1]))).toBe(true);
  expect((await visibleRows(page)).length).toBe(4);
  await chip(page, '€').click(); // both selected = everything
  expect((await visibleRows(page)).length).toBe(8);
});

test('product filter (multi-select) without the category badge in names', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  await panel(page).locator('[data-dg-products]').click();
  const options = panel(page).locator('[role=listbox] label');
  await expect(options).toHaveCount(5);
  await expect(options.first()).toHaveText('ADR on Mock Software SE (1)');
  await options.filter({ hasText: 'Mock Tech' }).locator('input').check();
  await options.filter({ hasText: 'ADR on Mock' }).locator('input').check();
  expect((await visibleRows(page)).length).toBe(3);
  await expect(totals(page)).toContainText('Total buy $ 5.903,50 (2)');
  await expect(totals(page)).toContainText('Total sell $ 2.500,00 (1)');
});

test('filters combine, and Clear filters resets', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  await chip(page, 'Buy').click();
  await chip(page, '€').click();
  expect((await visibleRows(page)).length).toBe(3);
  await expect(totals(page)).toContainText('3 of 8 orders');
  await panel(page).locator('[data-dg-reset]').click();
  expect((await visibleRows(page)).length).toBe(8);
});

test('filters survive DEGIRO re-rendering the rows', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  await chip(page, 'Sell').click();
  await page.evaluate(() => window.__rerender());
  await expect.poll(async () => (await visibleRows(page)).length).toBe(2);
});

test('product menu closes on outside click', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  await panel(page).locator('[data-dg-products]').click();
  await expect(panel(page).locator('[role=listbox]')).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(panel(page).locator('[role=listbox]')).toHaveCount(0);
});

test('only on the Outstanding page', async ({ degiro }) => {
  const { page } = await degiro({ url: 'https://trader.degiro.nl/trader/?mock=orders#/orders/history' });
  await page.waitForTimeout(800);
  await expect(panel(page)).toHaveCount(0);
});

test('can be switched off; hidden rows come back', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_O });
  const opt = await settings();
  await page.bringToFront();
  await chip(page, 'Sell').click();
  expect((await visibleRows(page)).length).toBe(2);
  await setFlag(opt, 'ordersFilter', false);
  await expect(panel(page)).toHaveCount(0);
  await expect.poll(async () => (await visibleRows(page)).length).toBe(8);
});

test('DEGIRO styling: Buy green, Sell red, taken from the Action column', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  const colour = loc => loc.evaluate(el => getComputedStyle(el).color);
  const bg = loc => loc.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(await colour(chip(page, 'Buy'))).toBe('rgb(30, 131, 2)');
  expect(await colour(chip(page, 'Sell'))).toBe('rgb(228, 1, 1)');
  await chip(page, 'Sell').click();
  expect(await bg(chip(page, 'Sell'))).toBe('rgb(228, 1, 1)');     // selected = filled red
  expect(await colour(chip(page, 'Sell'))).toBe('rgb(255, 255, 255)');
  await chip(page, 'Buy').click();
  expect(await bg(chip(page, 'Buy'))).toBe('rgb(30, 131, 2)');     // selected = filled green
  expect(await colour(totals(page).locator('[data-dg-total=buy] span').first())).toBe('rgb(30, 131, 2)');
  expect(await colour(totals(page).locator('[data-dg-total=sell] span').first())).toBe('rgb(228, 1, 1)');
});
