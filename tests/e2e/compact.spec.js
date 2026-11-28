// Compact Pricing data: tighter row spacing in the Pricing data block only.
const { test, expect } = require('./fixtures');

const gap = (page, sel) => page.$eval(sel, el => getComputedStyle(el).rowGap);

test('Pricing data rows are tighter by default', async ({ degiro }) => {
  const { page } = await degiro();
  await expect.poll(() => gap(page, '#bidCol')).toBe('4px');
  await expect.poll(() => gap(page, '#askCol')).toBe('4px');
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
