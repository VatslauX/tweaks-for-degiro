// Reading DEGIRO's canvas repeatedly makes Chrome warn ("Multiple readback operations using
// getImageData…"). The extension must read a copy it owns instead.
const { test, expect } = require('./fixtures');

test('no canvas readback warning on the portfolio page', async ({ degiro }) => {
  const warnings = [];
  const { page } = await degiro({ url: 'https://trader.degiro.nl/trader/?mock=portfolio#/portfolio' });
  page.on('console', m => { if (/willReadFrequently|readback/i.test(m.text())) warnings.push(m.text()); });
  await expect(page.locator('#dg-portfolio-change')).toBeVisible();
  await page.mouse.move(5, 5);
  // real time on purpose: the feature reads the chart every 500 ms, and Chrome warns from the
  // second read of a canvas, so three cycles are enough
  await page.waitForTimeout(1500);
  // drag a few times as well
  const box = await page.locator('#c1').boundingBox();
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(5, 5); await page.waitForTimeout(600);
    await page.mouse.move(box.x + 200, box.y + 100); await page.mouse.down();
    await page.mouse.move(box.x + 600, box.y + 100, { steps: 3 }); await page.mouse.up();
  }
  expect(warnings).toEqual([]);
});
