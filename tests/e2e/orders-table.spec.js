// Orders → Outstanding: filters (action, currency, product multi-select) and buy/sell totals per currency.
const { test, expect } = require('./fixtures');

const URL_O = 'https://trader.degiro.nl/trader/?mock=orders#/orders/open';
const panel = page => page.locator('#dg-orders-panel');
const chip = (page, text) => panel(page).locator('button', { hasText: new RegExp(`^${text.replace(/[$]/g, '\\$')}$`) });
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


test('a very long product name wraps inside the product menu', async ({ degiro }) => {
  const long = 'AMUNDI MSCI EMERGING MARKETS SRI CLIMATE PARIS ALIGNED UCITS ETF DR ACC';
  const { page } = await degiro({ url: URL_O, initScript: `window.__ORDERS = [['${long}', 'Buy', 10, '€ 5,00', '50,00'], ['Mock Tech Inc. Class A', 'Sell', 1, '$ 1,00', '1,00']];` });
  await panel(page).locator('[data-dg-products]').click();
  const menu = panel(page).locator('[role=listbox]');
  await expect(menu.locator('label', { hasText: 'AMUNDI' })).toBeVisible();
  const r = await menu.evaluate(m => ({ sw: m.scrollWidth, cw: m.clientWidth }));
  expect(r.sw).toBeLessThanOrEqual(r.cw);
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

// ---------- columns ----------
const heads = page => page.$$eval('#orders thead th', ths => ths.filter(th => getComputedStyle(th).display !== 'none').map(th => th.textContent));
const columnsBtn = page => panel(page).locator('[data-dg-columns]');
const columnItems = page => panel(page).locator('[role=listbox] label');
const ALL = ['Product', 'Date', 'Symbol | ISIN', 'Exchange', 'Action', 'Qty', 'Limit', 'Stop Price', 'Value', 'Outstanding', 'Executed', ''];
const without = (...h) => ALL.filter(x => !h.includes(x));

test('columns: only Exchange is hidden by default; every column but Product is offered', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  await expect.poll(() => heads(page)).toEqual(without('Exchange'));
  expect(await page.$eval('#rows tr', tr => [...tr.children].filter(td => getComputedStyle(td).display !== 'none').length)).toBe(11);
  await expect(columnsBtn(page)).toHaveText('1 hidden ▾');
  await columnsBtn(page).click();
  expect(await columnItems(page).allTextContents()).toEqual(ALL.slice(1, -1));
});


test('columns: the other columns fit their content and Product gets the spare width', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  const product = () => page.$eval('#orders thead th', th => th.offsetWidth);
  await expect.poll(product).toBeGreaterThan(400); // DEGIRO pins it at 320px
  expect(await page.$eval('#orders', t => t.offsetWidth <= t.parentElement.clientWidth)).toBe(true);
});

test('columns: outside DEGIRO\'s openOrders section nothing is hidden or resized', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  await expect.poll(() => heads(page)).toEqual(without('Exchange'));
  await page.evaluate(() => document.querySelector('[data-name=openOrders]').removeAttribute('data-name'));
  await page.evaluate(() => document.body.appendChild(document.createElement('div'))); // DOM change: re-run
  await expect.poll(() => heads(page)).toEqual(ALL);
  expect(await page.$eval('#orders thead th', th => th.offsetWidth)).toBe(320);
  await expect(columnsBtn(page)).toHaveCount(0);
  await expect(totals(page)).toContainText('8 of 8 orders'); // filters and totals still work
});

