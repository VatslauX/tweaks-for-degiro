// Our header items share one wrapping container, so a narrow header wraps instead of overflowing.
const { test, expect, setFlag } = require('./fixtures');

// [] while the container is briefly gone (between one item leaving and the next run), so polls can retry
const items = page => page.evaluate(() => [...document.querySelector('[data-dg-header]')?.children || []].map(c => c.id));

test('items sit in one container in a fixed order and the line wraps at 420 px', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(page.locator('#dg-exdiv')).toBeVisible();
  expect(await page.locator('[data-dg-header]').count()).toBe(1);
  // the period change waits for the chart data, which the mock delivers late
  await expect.poll(() => items(page)).toEqual(['dg-period-change', 'dg-header-spread', 'dg-exdiv', 'dg-earnings']);
  await page.setViewportSize({ width: 420, height: 900 });
  await expect.poll(() => page.evaluate(() => {
    const h = document.querySelector('[data-dg-header]');
    const r = h.getBoundingClientRect();
    return h.scrollWidth <= h.clientWidth && r.right <= innerWidth + 1;
  })).toBe(true);
  // at an even narrower width the items stack on several rows
  await page.setViewportSize({ width: 200, height: 900 });
  await expect.poll(() => page.evaluate(() => {
    const h = document.querySelector('[data-dg-header]');
    const tops = new Set([...h.children].map(c => Math.round(c.getBoundingClientRect().top)));
    return tops.size > 1 && h.scrollWidth <= h.clientWidth;
  })).toBe(true);
});

test('each script works alone and removes only its own item', async ({ degiro, settings }) => {
  const { page } = await degiro();
  const opt = await settings();
  await expect(page.locator('#dg-exdiv')).toBeVisible();
  await setFlag(opt, 'periodChange', false);
  await setFlag(opt, 'exDividend', false);
  await setFlag(opt, 'earningsDate', false);
  await expect(page.locator('#dg-period-change')).toHaveCount(0);
  await expect(page.locator('#dg-exdiv')).toHaveCount(0);
  await expect.poll(() => items(page)).toEqual(['dg-header-spread']);
  await setFlag(opt, 'exDividend', true);
  await expect.poll(() => items(page)).toEqual(['dg-header-spread', 'dg-exdiv']);
  await setFlag(opt, 'headerSpread', false);
  await expect.poll(() => items(page)).toEqual(['dg-exdiv']);
  await setFlag(opt, 'exDividend', false);
  await expect(page.locator('[data-dg-header]')).toHaveCount(0);
  await setFlag(opt, 'periodChange', true);
  await expect.poll(() => items(page)).toEqual(['dg-period-change']);
});

test('header values follow the dark theme', async ({ degiro }) => {
  const { page } = await degiro({ initScript: () => {
    document.addEventListener('DOMContentLoaded', () => { document.body.style.background = '#0f171a'; document.body.style.color = '#f3f7f9'; });
  } });
  await expect(page.locator('#dg-header-spread')).toBeVisible();
  const col = sel => page.$eval(sel, el => getComputedStyle(el.lastElementChild).color);
  // 0,24% spread: amber on dark; period change up: dark-theme green
  await expect.poll(() => col('#dg-header-spread')).toBe('rgb(242, 163, 58)');
  await expect(page.locator('#dg-period-change')).toBeVisible();
  await expect.poll(() => col('#dg-period-change')).toBe('rgb(76, 184, 46)');
});

test('our container is spaced from DEGIRO\'s price line (the real parent has no gap)', async ({ degiro }) => {
  const { page } = await degiro();
  await expect.poll(() => items(page)).toEqual(['dg-period-change', 'dg-header-spread', 'dg-exdiv', 'dg-earnings']);
  const gap = await page.evaluate(() => {
    const box = document.querySelector('[data-dg-header]');
    const line = box.previousElementSibling;
    // the end of the line's last text, not its box, so a stretched line cannot hide the problem
    const range = document.createRange();
    range.selectNodeContents(line);
    const lineEnd = range.getBoundingClientRect().right;
    return { gap: box.firstElementChild.getBoundingClientRect().left - lineEnd, parentGap: getComputedStyle(box.parentElement).columnGap };
  });
  expect(gap.parentGap).toBe('normal');
  expect(gap.gap).toBeGreaterThanOrEqual(8);
});
