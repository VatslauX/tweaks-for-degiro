// The page can read the bridge attribute, so it must carry only what page-context scripts need.
// → integration (settings.test.js): 'bridge exposes only chart flags', 'bridge follows settings changes'
const { test, expect } = require('./fixtures');

test('shared helpers (common.js) are available in the page and read-only', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(page.locator('#dg-period-change')).toBeVisible();
  const r = await page.evaluate(() => {
    const before = window.__dgt;
    try { window.__dgt = null; } catch (e) {}
    try { window.__dgt.fmt = null; } catch (e) {}
    return { same: window.__dgt === before, frozen: Object.isFrozen(window.__dgt), fmt: typeof window.__dgt.fmt, sep: window.__dgt.decimalSep() };
  });
  expect(r).toEqual({ same: true, frozen: true, fmt: 'function', sep: ',' });
});
