// Strings that come from the page (e.g. Highcharts month names) must never be parsed as HTML.
const { test, expect } = require('./fixtures');

test('selection label renders page strings as text, not HTML', async ({ degiro }) => {
  const { page } = await degiro();
  await page.waitForFunction(() => Highcharts.charts.some(c => c?.container?.hasAttribute('data-dg-sel')));
  await page.evaluate(() => {
    const evil = '<img src=x onerror="window.__xss=1">';
    Highcharts.setOptions({ lang: { shortMonths: Array(12).fill(evil), months: Array(12).fill(evil) } });
  });
  const box = await page.locator('#chart .highcharts-container').boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + 150, { steps: 5 });
  await page.mouse.up();
  const label = page.locator('#chart .highcharts-container > div', { hasText: '→' });
  await expect(label).toContainText('<img src=x');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator('#chart .highcharts-container img').count()).toBe(0);
});
