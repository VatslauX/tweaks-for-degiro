// The range selection survives plain redraws (live price ticks) and is cleared by a new period.
const { test, expect } = require('./fixtures');

async function select(page, a = 0.3, b = 0.7, yFrac = 0.5) {
  const box = await page.locator('#chart .highcharts-container').boundingBox();
  const y = box.y + box.height * yFrac;
  await page.mouse.move(box.x + box.width * a, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * (a + b) / 2, y, { steps: 3 });
  await page.mouse.move(box.x + box.width * b, y, { steps: 3 });
  await page.mouse.up();
}
const label = page => page.locator('[data-dg-sel] > div[data-dg-own]', { hasText: '→' }).first();

test('a live tick keeps the selection and updates its values', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(page.locator('[data-dg-sel]')).toHaveCount(1);
  await select(page, 0.3, 0.98);
  await expect(label(page)).toBeVisible();
  const before = await label(page).textContent();
  await page.evaluate(() => { const s = Highcharts.charts.at(-1).series[0]; s.data.at(-1).update(s.data.at(-1).y + 5); });
  await expect.poll(async () => {
    const current = label(page);
    return await current.isVisible() ? await current.textContent() : before;
  }).not.toBe(before);
  await expect(label(page)).toBeVisible();
  await page.evaluate(() => Highcharts.charts.at(-1).redraw());
  await expect(label(page)).toBeVisible();
});

test('a live tick that adds a point (and drops the oldest) keeps the selection', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(page.locator('[data-dg-sel]')).toHaveCount(1);
  await select(page, 0.3, 0.7);
  await expect(label(page)).toBeVisible();
  await page.evaluate(() => { const s = Highcharts.charts.at(-1).series[0], last = s.data.at(-1); s.addPoint([last.x + 864e5, last.y + 0.1], true, true); });
  await expect(label(page)).toBeVisible();
});

test('a new period clears it', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(page.locator('[data-dg-sel]')).toHaveCount(1);
  await select(page);
  await expect(label(page)).toBeVisible();
  await page.click('#periods button:text-is("1 M")');
  await expect(label(page)).toBeHidden();
});

test('the result is announced through a polite live region', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(page.locator('[data-dg-sel]')).toHaveCount(1);
  const live = page.locator('#chart [data-dg-live][aria-live=polite]');
  await expect(live).toHaveText('');
  await select(page);
  await expect(live).toContainText('→');
  await page.keyboard.press('Escape');
  await expect(live).toHaveText('');
});

test('the label wraps inside a narrow chart', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(page.locator('[data-dg-sel]')).toHaveCount(1);
  await page.evaluate(() => { document.querySelector('#chart').style.width = '260px'; Highcharts.charts.at(-1).reflow(); });
  await page.waitForFunction(() => Highcharts.charts.at(-1).chartWidth === 260);
  await select(page, 0.3, 0.7, 0.05); // near the top, clear of the order badges
  await expect(label(page)).toBeVisible();
  expect(await page.evaluate(() => {
    const c = document.querySelector('[data-dg-sel]').getBoundingClientRect();
    const l = [...document.querySelectorAll('[data-dg-sel] > div')].find(e => e.textContent.includes('→') && e.style.maxWidth).getBoundingClientRect();
    return l.left >= c.left - 1 && l.right <= c.right + 1;
  })).toBe(true);
});
