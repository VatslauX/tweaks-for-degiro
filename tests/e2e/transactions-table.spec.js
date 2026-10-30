// Transactions: filters (action, currency, product) and buy / sell / net totals per currency, plus fees.
const { test, expect, setFlag } = require('./fixtures');

const URL_T = 'https://trader.degiro.nl/trader/?mock=transactions#/transactions?fromDate=2026-09-29&toDate=2026-10-28';
const panel = page => page.locator('#dg-transactions-panel');
const chip = (page, text) => panel(page).locator('button', { hasText: new RegExp(`^${text.replace(/[$]/g, '\\$')}$`) });
const visibleRows = page => page.$$eval('#rows tr', rs => rs.filter(r => getComputedStyle(r).display !== 'none')
  .map(r => r.querySelector('[data-name=productName]').textContent + '|' + r.querySelector('[data-name=buySellBadge]').dataset.action));
const totals = page => panel(page).locator('[data-dg-totals]');
const total = (page, kind) => totals(page).locator(`[data-dg-total=${kind}]`);

test('totals: buy and sell per currency (amounts, not signs), net buy − sell, fees', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_T });
  await expect(total(page, 'buy')).toHaveText('Total buy $ 2.701,50 (1) · € 6.100,00 (2)');
  await expect(total(page, 'sell')).toHaveText('Total sell $ 1.500,00 (1) · € 1.900,00 (1)');
  await expect(total(page, 'net')).toHaveText('Net (buy − sell) $ 1.201,50 · € 4.200,00');
  // Value − Total: every fee, AutoFX included
  await expect(total(page, 'fees')).toHaveText('Fees € 17,25');
  await expect(totals(page).locator('[data-dg-count]')).toHaveText('5 of 5 transactions');
});

test('panel sits below DEGIRO\'s filters, above the table', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_T });
  await expect(panel(page)).toBeVisible();
  expect(await page.$eval('#dg-transactions-panel', el => el.previousElementSibling.getAttribute('data-name'))).toBe('transactionsFilters');
});


test('more pages: totals say they cover this page only', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_T, initScript: () => { window.__MOCK_MORE_PAGES = true; } });
  await expect(totals(page).locator('[data-dg-count]')).toHaveText('5 of 5 transactions · this page only');
});


test('fees from the Fees column when the Total column has no hook', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_T, initScript: () => { window.__MOCK_NO_TX_TOTAL = true; } });
  await expect(total(page, 'fees')).toHaveText('Fees € 11,00'); // AutoFX is not in that column
});

test('English number format (1,234.56)', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_T, initScript: () => {
    window.__TX = [
      ['Mock Chips ETF EUR', 'Buy', 200, '€ -3,600.00', '€ -3,600.00', '—', '€ -3.00', '€ -3,603.00'],
      ['Mock Tech Inc. Class A', 'Sell', -5, '$ 1,500.00', '€ 1,390.00', '—', '€ -2.00', '€ 1,388.00']
    ];
  } });
  await expect(total(page, 'buy')).toHaveText('Total buy € 3,600.00 (1)');
  await expect(total(page, 'net')).toHaveText('Net (buy − sell) $ -1,500.00 · € 3,600.00');
  await expect(total(page, 'fees')).toHaveText('Fees € 5.00');
});

test('DEGIRO colours: Buy green, Sell red, taken from the badges', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_T });
  const colour = loc => loc.evaluate(el => getComputedStyle(el).color);
  expect(await colour(chip(page, 'Buy'))).toBe('rgb(30, 131, 2)');
  expect(await colour(chip(page, 'Sell'))).toBe('rgb(228, 1, 1)');
});

// ---------- columns ----------
const heads = page => page.$$eval('#transactions thead th', ths => ths.filter(th => getComputedStyle(th).display !== 'none').map(th => th.textContent));
const cellsShown = page => page.$eval('#rows tr', tr => [...tr.children].filter(td => getComputedStyle(td).display !== 'none').length);
const columnsBtn = page => panel(page).locator('[data-dg-columns]');
const columnItems = page => panel(page).locator('[role=listbox] label');
const ALL = ['Product', 'Date', 'Symbol | ISIN', 'Exchange', 'Venue', 'Action', 'Qty', 'Price', 'Local value', 'Value', 'Exchange Rate', 'AutoFX Fee', 'Fees', 'Total', ''];
const without = (...h) => ALL.filter(x => !h.includes(x));
const DEF = ['Exchange', 'Venue', 'Exchange Rate', 'AutoFX Fee']; // hidden by default

test('columns: Exchange, Venue, Exchange Rate and AutoFX Fee are hidden by default, header and cells alike', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_T });
  await expect.poll(() => heads(page)).toEqual(without(...DEF));
  expect(await cellsShown(page)).toBe(11);
  await expect(columnsBtn(page)).toHaveText('4 hidden ▾');
});

test('columns: every column but Product is offered, with DEGIRO\'s header as its name', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_T });
  await columnsBtn(page).click();
  expect(await columnItems(page).allTextContents()).toEqual(ALL.slice(1, -1));
});



test('columns: an open date picker\'s calendar table is left alone', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_T, initScript: () => { window.__MOCK_CALENDAR = true; } });
  await expect.poll(() => heads(page)).toEqual(without(...DEF));
  expect(await page.$$eval('#calendar th', ths => ths.filter(th => getComputedStyle(th).display !== 'none').length)).toBe(7);
  expect(await page.$eval('#dg-transactions-panel', el => !el.closest('#calendar'))).toBe(true);
});


test('columns: the other columns fit their content and Product gets the spare width', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_T });
  const opt = await settings();
  await page.bringToFront();
  const widths = () => page.$$eval('#transactions thead th', ths => ths.map(th => th.offsetWidth));
  await expect.poll(async () => (await widths())[0]).toBeGreaterThan(400); // DEGIRO pins it at 320px
  expect(await page.$eval('#transactions', t => t.offsetWidth <= t.parentElement.clientWidth)).toBe(true); // no overflow
  expect(await page.$$eval('#transactions thead th', ths => new Set(ths.filter(th => th.offsetHeight).map(th => th.offsetHeight)).size)).toBe(1); // nothing wraps
  await setFlag(opt, 'transactionsFilter', false);
  await expect.poll(async () => (await widths())[0]).toBe(320);
  // without DEGIRO's product hook nothing is resized
  await setFlag(opt, 'transactionsFilter', true);
  await page.evaluate(() => document.querySelectorAll('#transactions [data-name=productName]').forEach(s => s.removeAttribute('data-name')));
  await page.evaluate(() => document.body.appendChild(document.createElement('div'))); // DOM change: re-run
  await expect.poll(async () => (await widths())[0]).toBe(320);
});

// ---------- DEGIRO's upper panel: a second [data-name=transactions] (Latest Transactions mini list) comes first ----------
const MINI = '#miniTransactions';
for (const closed of [false, true]) {
  test(`upper panel ${closed ? 'minimised' : 'open'}: filters, totals and columns work on the real table only`, async ({ degiro }) => {
    const { page } = await degiro({ url: URL_T, initScript: closed ? 'window.__MOCK_PANEL_CLOSED = true' : undefined });
    expect(await page.locator(MINI).count()).toBe(closed ? 0 : 1);
    await expect(panel(page)).toBeVisible();
    await expect(total(page, 'buy')).toHaveText('Total buy $ 2.701,50 (1) · € 6.100,00 (2)');
    await chip(page, 'Sell').click();
    expect((await visibleRows(page)).length).toBe(2);
    await expect.poll(() => heads(page)).toEqual(without(...DEF));
    await columnsBtn(page).click();
    await columnItems(page).filter({ hasText: /^Date$/ }).locator('input').uncheck();
    await expect.poll(() => heads(page)).toEqual(without('Date', ...DEF));
    if (!closed) {
      // the mini list is untouched: its date cell and rows stay visible
      expect(await page.$$eval(`${MINI} td`, tds => tds.every(td => getComputedStyle(td).display !== 'none'))).toBe(true);
      expect(await page.locator(`${MINI} tr`).count()).toBe(2);
      expect(await page.locator(MINI).evaluate(el => !!el.querySelector('#dg-transactions-panel'))).toBe(false);
    }
  });
}
