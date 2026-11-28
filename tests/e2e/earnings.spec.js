// Next earnings date in the product header, linking to the Earnings section.
const { test, expect } = require('./fixtures');

const link = page => page.locator('#dg-earnings');

test('shows "Earnings <date>" after Ex-div', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(link(page)).toHaveText('Earnings02/02/2099');
  await expect(page.locator('#dg-exdiv')).toHaveCount(1);
});

test('click scrolls to Earnings without changing the route', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(link(page)).toBeVisible();
  const hash = await page.evaluate(() => location.hash);
  await link(page).click();
  await expect.poll(() => page.evaluate(() => {
    const r = document.getElementById('earnWidget').getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight;
  })).toBe(true);
  expect(await page.evaluate(() => location.hash)).toBe(hash);
});

test('past dates are shown muted, future in blue', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(link(page)).toBeVisible();
  expect(await page.$eval('#dg-earnings', el => getComputedStyle(el.lastElementChild).color)).toBe('rgb(0, 149, 210)');
  await page.evaluate(() => { document.querySelector('#earnWidget time[data-field=dateTime]').textContent = '01/02/2020'; });
  await expect.poll(() => page.$eval('#dg-earnings', el => getComputedStyle(el.lastElementChild).color)).toBe('rgb(101, 117, 123)');
});
