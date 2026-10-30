// Ex-dividend date in the product header, linking to the Dividends section.
const { test, expect, setFlag } = require('./fixtures');

const link = page => page.locator('#dg-exdiv');

test('shows "Ex-div <date>" right after the spread', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(link(page)).toHaveText('Ex-div12/11/2099');
  await expect(page.locator('#dg-header-spread')).toBeVisible();
  await expect(page.locator('#dg-period-change')).toHaveCount(1); // the page-world item can come after the others
  const order = await page.$eval('[data-dg-header]', el => [...el.children].map(c => c.id));
  expect(order).toEqual(['dg-period-change', 'dg-header-spread', 'dg-exdiv', 'dg-earnings']);
});

test('click scrolls to Dividends without changing the route', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(link(page)).toBeVisible();
  const hash = await page.evaluate(() => location.hash);
  await link(page).click();
  await expect.poll(() => page.evaluate(() => {
    const r = document.getElementById('divWidget').getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight;
  })).toBe(true);
  expect(await page.evaluate(() => location.hash)).toBe(hash);
});

test('not shown when the date is unknown', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(link(page)).toBeVisible();
  await page.evaluate(() => { document.querySelector('time[data-field=exDividendDate]').textContent = '—'; });
  await expect(link(page)).toHaveCount(0);
});

test('past dates are shown muted, future in blue', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(link(page)).toBeVisible();
  expect(await page.$eval('#dg-exdiv', el => getComputedStyle(el.lastElementChild).color)).toBe('rgb(0, 159, 223)');
  await page.evaluate(() => { document.querySelector('time[data-field=exDividendDate]').textContent = '01/02/2020'; });
  await expect.poll(() => page.$eval('#dg-exdiv', el => getComputedStyle(el.lastElementChild).color)).toBe('rgb(121, 138, 144)');
});

test('can be switched off', async ({ degiro, settings }) => {
  const { page } = await degiro();
  const opt = await settings();
  await expect(link(page)).toBeVisible();
  await setFlag(opt, 'exDividend', false);
  await expect(link(page)).toHaveCount(0);
  await setFlag(opt, 'exDividend', true);
  await expect(link(page)).toHaveCount(1);
});
