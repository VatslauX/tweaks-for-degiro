// Current spread % in the product header, after the daily and period change.
const { test, expect, setFlag } = require('./fixtures');

const head = page => page.locator('#dg-header-spread');

test('shows "Spread 0,24%" at the end of the price line', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(head(page)).toHaveText('Spread0,24%');
  await expect(page.locator('#dg-period-change')).toBeVisible();
  // one shared [data-dg-header] container after the price line: period change, spread, ex-div
  expect(await page.$eval('#dg-header-spread', el => [el.previousElementSibling?.id, el.nextElementSibling?.id ?? null, el.parentElement.hasAttribute('data-dg-header')])).toEqual(['dg-period-change', 'dg-exdiv', true]);
});

test('percentage only, two decimals, updates live', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(head(page)).toHaveText('Spread0,24%');
  await page.evaluate(() => { document.querySelectorAll('#askCol dd span')[1].textContent = '€ 17,00'; });
  await expect(head(page)).toHaveText('Spread0,59%');
});

test('colour follows the spread size', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(head(page)).toBeVisible();
  // 0,24% -> amber band (0.1–0.5%)
  expect(await page.$eval('#dg-header-spread', el => getComputedStyle(el.lastElementChild).color)).toBe('rgb(194, 106, 0)');
});

test('independent of the Spread row switch', async ({ degiro, settings }) => {
  const { page } = await degiro();
  const opt = await settings();
  await setFlag(opt, 'spread', false);
  await expect(page.locator('[data-spread-row]')).toHaveCount(0);
  await expect(head(page)).toBeVisible();
  await setFlag(opt, 'headerSpread', false);
  await expect(head(page)).toHaveCount(0);
  await setFlag(opt, 'headerSpread', true);
  await expect(head(page)).toHaveCount(1);
});
