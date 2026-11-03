// Compact Pricing data: tighter row spacing in the Pricing data block only.
const { test, expect, setFlag } = require('./fixtures');

const gap = (page, sel) => page.$eval(sel, el => getComputedStyle(el).rowGap);

test('Pricing data rows are tighter by default', async ({ degiro }) => {
  const { page } = await degiro();
  await expect.poll(() => gap(page, '#bidCol')).toBe('4px');
  await expect.poll(() => gap(page, '#askCol')).toBe('4px');
});

test('other flex columns on the page are not touched', async ({ degiro }) => {
  const { page } = await degiro();
  await expect.poll(() => gap(page, '#bidCol')).toBe('4px');
  expect(await gap(page, '#unrelated')).toBe('12px');
});

test('can be switched off and on live', async ({ degiro, settings }) => {
  const { page } = await degiro();
  const opt = await settings();
  await expect.poll(() => gap(page, '#bidCol')).toBe('4px');
  await setFlag(opt, 'compactPricing', false);
  await expect.poll(() => gap(page, '#bidCol')).toBe('12px');
  await setFlag(opt, 'compactPricing', true);
  await expect.poll(() => gap(page, '#bidCol')).toBe('4px');
});

test('still applied after DEGIRO re-renders the block', async ({ degiro }) => {
  const { page } = await degiro();
  await expect.poll(() => gap(page, '#bidCol')).toBe('4px');
  await page.evaluate(() => { const c = document.querySelector('#bidCol'); c.replaceWith(c.cloneNode(true)); document.querySelector('#bidCol').removeAttribute('style'); });
  await expect.poll(() => gap(page, '#bidCol')).toBe('4px');
});

test('real layout (all widgets in one mainPageSection): only the Pricing data widget is tightened', async ({ degiro }) => {
  const { page } = await degiro({ initScript: () => { window.__MOCK_MAIN_SECTION = true; } });
  await expect.poll(() => gap(page, '#pricingDl')).toBe('4px');
  await expect.poll(() => gap(page, '#symbolDl')).toBe('4px');
  // another widget's list in the same shared section (e.g. Ratios) keeps DEGIRO's spacing
  expect(await gap(page, '#unrelatedDl')).toBe('12px');
});

test('also tightens Volume and Symbol/Exchange rows in Pricing data', async ({ degiro }) => {
  const { page } = await degiro();
  await expect.poll(() => gap(page, '#pricingDl')).toBe('4px');
  await expect.poll(() => gap(page, '#symbolDl')).toBe('4px');
});

test('lists outside Pricing data are not touched', async ({ degiro }) => {
  const { page } = await degiro();
  await expect.poll(() => gap(page, '#symbolDl')).toBe('4px');
  expect(await gap(page, '#unrelatedDl')).toBe('12px');
});

test('switching off restores every list', async ({ degiro, settings }) => {
  const { page } = await degiro();
  const opt = await settings();
  await expect.poll(() => gap(page, '#symbolDl')).toBe('4px');
  await setFlag(opt, 'compactPricing', false);
  for (const sel of ['#pricingDl', '#symbolDl', '#bidCol']) await expect.poll(() => gap(page, sel)).toBe('12px');
});
