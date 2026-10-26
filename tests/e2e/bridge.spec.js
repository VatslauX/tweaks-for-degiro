// The page can read the bridge attribute, so it must carry only what page-context scripts need.
const { test, expect, setFlag } = require('./fixtures');

const bridged = page => page.evaluate(() => JSON.parse(document.documentElement.getAttribute('data-dg-tweaks') || 'null'));

test('bridge exposes only the chart flags, as booleans', async ({ degiro }) => {
  const { page } = await degiro();
  await expect.poll(() => bridged(page)).not.toBeNull();
  const b = await bridged(page);
  expect(Object.keys(b).sort()).toEqual(['chartSelect', 'orders', 'ordersClick', 'periodChange']);
  for (const v of Object.values(b)) expect(typeof v).toBe('boolean');
});

test('bridge follows settings changes', async ({ degiro, settings }) => {
  const { page } = await degiro();
  const opt = await settings();
  await setFlag(opt, 'ordersClick', false);
  await expect.poll(async () => (await bridged(page))?.ordersClick).toBe(false);
  await setFlag(opt, 'ordersClick', true);
  await expect.poll(async () => (await bridged(page))?.ordersClick).toBe(true);
});

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
