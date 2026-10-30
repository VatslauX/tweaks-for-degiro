// Next earnings date in the product header, linking to the Earnings section.
const { test, expect, setFlag } = require('./fixtures');

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

test('not shown when the date is unknown', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(link(page)).toBeVisible();
  await page.evaluate(() => { document.querySelector('#earnWidget time[data-field=dateTime]').textContent = '—'; });
  await expect(link(page)).toHaveCount(0);
});

test('past dates are shown muted, future in blue', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(link(page)).toBeVisible();
  expect(await page.$eval('#dg-earnings', el => getComputedStyle(el.lastElementChild).color)).toBe('rgb(0, 159, 223)');
  await page.evaluate(() => { document.querySelector('#earnWidget time[data-field=dateTime]').textContent = '01/02/2020'; });
  await expect.poll(() => page.$eval('#dg-earnings', el => getComputedStyle(el.lastElementChild).color)).toBe('rgb(121, 138, 144)');
});

test('ignores a date outside the Earnings widget', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(link(page)).toBeVisible();
  await page.evaluate(() => { document.querySelector('#earnWidget time[data-field=dateTime]').remove(); });
  await expect(link(page)).toHaveCount(0);
});

test('can be switched off', async ({ degiro, settings }) => {
  const { page } = await degiro();
  const opt = await settings();
  await expect(link(page)).toBeVisible();
  await setFlag(opt, 'earningsDate', false);
  await expect(link(page)).toHaveCount(0);
  await setFlag(opt, 'earningsDate', true);
  await expect(link(page)).toHaveCount(1);
});
