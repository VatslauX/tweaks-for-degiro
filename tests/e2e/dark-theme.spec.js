// DEGIRO has a dark theme. Our overlays must take their colours from the page,
// not show up as white boxes.
const { test, expect } = require('./fixtures');

const DARK_BG = 'rgb(15, 23, 26)', DARK_TEXT = 'rgb(243, 247, 249)';
const dark = () => {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.style.background = '#0f171a';
    document.body.style.color = '#f3f7f9';
  });
};

async function drag(page, sel, a, b) {
  const box = await page.locator(sel).boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * a, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * (a + b) / 2, y, { steps: 3 });
  await page.mouse.move(box.x + box.width * b, y, { steps: 3 });
  await page.mouse.up();
}

test('order badges use the page background in dark theme', async ({ degiro }) => {
  const { page } = await degiro({ initScript: dark });
  const badge = page.locator('#chart div', { hasText: /^SELL 200 · 17,65$/ });
  await expect(badge).toBeVisible({ timeout: 8000 });
  expect(await badge.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(DARK_BG);
});

test('product range label and dots follow the dark theme', async ({ degiro }) => {
  const { page } = await degiro({ initScript: dark });
  await page.waitForFunction(() => Highcharts.charts.some(c => c?.container?.hasAttribute('data-dg-sel')));
  await drag(page, '#chart .highcharts-container', 0.2, 0.6);
  const label = page.locator('#chart .highcharts-container > div', { hasText: '→' });
  await expect(label).toBeVisible();
  const st = await label.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
  expect(st).toEqual({ bg: DARK_BG, color: DARK_TEXT });
  const borders = await page.evaluate(() => [...document.querySelectorAll('#chart .highcharts-container > div')]
    .filter(d => d.style.borderRadius === '50%' && d.style.display === 'block').map(d => getComputedStyle(d).borderTopColor));
  expect(borders).toEqual([DARK_BG, DARK_BG]);
});

test('portfolio range label follows the dark theme', async ({ degiro }) => {
  const { page } = await degiro({ url: 'https://trader.degiro.nl/trader/?mock=portfolio#/portfolio', initScript: dark });
  await expect(page.locator('#dg-portfolio-change')).toBeVisible();
  await page.mouse.move(5, 5);
  await drag(page, '#c1', 0.25, 0.75);
  const label = page.locator('[data-name="performance-chart-interaction-area"] > div', { hasText: '→' });
  await expect(label).toBeVisible();
  expect(await label.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(DARK_BG);
});

test('light theme keeps white boxes', async ({ degiro }) => {
  const { page } = await degiro();
  const badge = page.locator('#chart div', { hasText: /^SELL 200 · 17,65$/ });
  await expect(badge).toBeVisible({ timeout: 8000 });
  expect(await badge.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
});
