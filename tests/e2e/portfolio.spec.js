// Portfolio value chart: period change next to the total + drag-to-select.
const { test, expect, setFlag, portfolioSeries } = require('./fixtures');

const URL_P = 'https://trader.degiro.nl/trader/?mock=portfolio#/portfolio';
const change = page => page.locator('#dg-portfolio-change');

const fmtPct = p => (p >= 0 ? '+' : '') + p.toFixed(2).replace('.', ',') + '%';

test('shows the change for the selected period next to the total', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_P });
  const s = portfolioSeries('ONE_YEAR');
  await expect(change(page)).toContainText('1Y');
  await expect(change(page)).toContainText(fmtPct((s[0].value - s[s.length - 1].value) / s[s.length - 1].value * 100));
  expect(await page.$eval('#dg-portfolio-change', el => el.parentElement.getAttribute('data-name'))).toBe('performance-chart-value');
});

test('follows the period switcher', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_P });
  await expect(change(page)).toContainText('1Y');
  for (const [btn, period, label] of [['1 M', 'ONE_MONTH', '1M'], ['YTD', 'YEAR_TO_DATE', 'YTD']]) {
    await page.click(`[data-name="performance-period-switcher"] button:text-is("${btn}")`);
    const s = portfolioSeries(period);
    await expect(change(page)).toContainText(label);
    await expect(change(page)).toContainText(fmtPct((s[0].value - s[s.length - 1].value) / s[s.length - 1].value * 100));
  }
});

async function drag(page, a, b) {
  const box = await page.locator('#c1').boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * a, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * (a + b) / 2, y, { steps: 3 });
  await page.mouse.move(box.x + box.width * b, y, { steps: 3 });
  await page.mouse.up();
}

test('drag selects a range: € and % change, dates, dots on the line', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_P });
  await expect(change(page)).toBeVisible();
  await page.mouse.move(5, 5); // not hovering, so the line geometry can be read
  await drag(page, 0.25, 0.75);
  const label = page.locator('[data-name="performance-chart-interaction-area"] > div', { hasText: '→' });
  await expect(label).toBeVisible();
  await expect(label).toHaveText(/€ [+-][\d.]+,\d{2} \([+-]\d+,\d{2}%\)€ [\d.]+,\d{2} → € [\d.]+,\d{2} · .+ → .+/);

  // numbers match the data at the selected points
  const ok = await page.evaluate(() => {
    const label = [...document.querySelectorAll('[data-name="performance-chart-interaction-area"] > div')].find(d => /→/.test(d.textContent));
    const m = label.textContent.match(/€ ([\d.]+,\d{2}) → € ([\d.]+,\d{2})/);
    const v = s => parseFloat(s.replace(/\./g, '').replace(',', '.'));
    const values = window.__points.map(p => p.value);
    return values.includes(v(m[1])) && values.includes(v(m[2]));
  });
  expect(ok).toBe(true);

  // dots sit on the drawn line
  const off = await page.evaluate(() => {
    const area = document.querySelector('[data-name="performance-chart-interaction-area"]');
    const c = document.getElementById('c1').getBoundingClientRect(), a = area.getBoundingClientRect();
    const dots = [...area.children].filter(d => d.style.borderRadius === '50%' && d.style.display === 'block');
    return dots.map(d => {
      const x = parseFloat(d.style.left) - (c.left - a.left), y = parseFloat(d.style.top) - (c.top - a.top);
      const i = Math.round((x - 7) / (900 - 14) * (window.__points.length - 1));
      return Math.abs(window.__Y(window.__points[i].value) - y);
    });
  });
  expect(off.length).toBe(2);
  for (const d of off) expect(d).toBeLessThanOrEqual(3);
});

test('both features follow the existing switches', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await expect(change(page)).toBeVisible();
  await setFlag(opt, 'periodChange', false);
  await expect(change(page)).toHaveCount(0);
  await setFlag(opt, 'chartSelect', false);
  await page.bringToFront();
  await page.mouse.move(5, 5);
  await drag(page, 0.25, 0.75);
  const shown = await page.evaluate(() => [...document.querySelectorAll('[data-name="performance-chart-interaction-area"] > div')].some(d => /→/.test(d.textContent) && d.style.display === 'block'));
  expect(shown).toBe(false);
});

test('DEGIRO "hide values" mode also hides our amounts and percentages, not the dates', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_P });
  await expect(change(page)).toBeVisible();
  const blur = on => page.evaluate(on => { document.getElementById('total').style.filter = on ? 'grayscale(1) blur(12px)' : ''; }, on);
  // [filter of the whole value (amount and %), its text]
  const filters = () => page.$eval('#dg-portfolio-change', el => {
    const value = el.children[1];
    return [getComputedStyle(value).filter, value.textContent];
  });
  expect((await filters())[0]).toBe('none');

  await blur(true);
  await expect.poll(async () => (await filters())[0], { timeout: 3000 }).toContain('blur');
  expect((await filters())[1]).toMatch(/€.*\([+-]\d+,\d{2}%\)$/); // the % is inside the blurred value

  // range selection: amounts and percentage blurred, dates readable
  await page.mouse.move(5, 5);
  await drag(page, 0.25, 0.75);
  const label = page.locator('[data-name="performance-chart-interaction-area"] > div', { hasText: '→' });
  await expect(label).toBeVisible();
  const spans = await label.evaluate(l => [...l.querySelectorAll('span')].map(s => [s.textContent, getComputedStyle(s).filter]));
  expect(spans.length).toBe(2);
  for (const [t, f] of spans) { expect(t).toMatch(/€/); expect(f).toContain('blur'); }
  expect(spans[0][0]).toMatch(/%\)$/); // the % is blurred with the amount
  const dates = await label.evaluate(l => [...l.lastElementChild.childNodes].filter(n => n.nodeType === 3).map(n => n.data).join(''));
  expect(dates).toMatch(/·.*→/); // dates are plain text, not blurred

  // switching hide values off shows them again (selection is cleared, the change is re-rendered)
  await blur(false);
  await expect(label).toBeHidden({ timeout: 3000 });
  await expect.poll(async () => (await filters())[0], { timeout: 3000 }).toBe('none');
});

test('selection stays on the chart after in-app navigation rebuilds it', async ({ degiro }) => {
  // DEGIRO builds a new chart (new canvas, same size) when Portfolio is reached from another page;
  // a geometry cached from the old, detached canvas put the band at the top of the page
  const { page } = await degiro({ url: URL_P });
  await expect(change(page)).toBeVisible();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(3500); // geometry of the first chart is cached, and DEGIRO's redraws have settled
  await page.evaluate(() => { location.hash = '#/favourites'; });
  await expect(page.locator('[data-name="performance-chart"]')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/portfolio'; });
  await expect(page.locator('[data-name="performance-chart-interaction-area"][data-dg-sel]')).toHaveCount(1);
  await page.waitForTimeout(600); // the new chart is drawn with the same data (well within the 10 s cache)
  await drag(page, 0.25, 0.75);
  const label = page.locator('[data-name="performance-chart-interaction-area"] > div', { hasText: '→' });
  await expect(label).toBeVisible();
  const r = await page.evaluate(() => {
    const area = document.querySelector('[data-name="performance-chart-interaction-area"]');
    const band = [...area.children].find(d => d.style.borderLeftWidth === '1px');
    const b = band.getBoundingClientRect(), c = document.getElementById('c1').getBoundingClientRect();
    const dots = [...area.children].filter(d => d.style.borderRadius === '50%' && d.style.display === 'block')
      .map(d => d.getBoundingClientRect()).map(d => d.top + d.height / 2);
    return { band: [b.top, b.bottom, b.left, b.right], chart: [c.top, c.bottom, c.left, c.right], dots };
  });
  expect(Math.abs(r.band[0] - r.chart[0])).toBeLessThanOrEqual(2);
  expect(Math.abs(r.band[1] - r.chart[1])).toBeLessThanOrEqual(2);
  expect(r.band[2]).toBeGreaterThanOrEqual(r.chart[2] + 0.2 * (r.chart[3] - r.chart[2]));
  expect(r.band[3]).toBeLessThanOrEqual(r.chart[2] + 0.8 * (r.chart[3] - r.chart[2]));
  expect(r.dots.length).toBe(2);
  for (const y of r.dots) { expect(y).toBeGreaterThan(r.chart[0]); expect(y).toBeLessThan(r.chart[1]); }
});

test('a chart rebuilt under the pointer still selects up to its right edge', async ({ degiro }) => {
  // DEGIRO greys the line right of the cursor while hovered; measuring the rebuilt chart then
  // would end the line (and the selection) at the cursor
  const { page } = await degiro({ url: URL_P, clock: true });
  await expect(change(page)).toBeVisible();
  await page.mouse.move(5, 5);
  await page.clock.fastForward(3500); // geometry of the first chart is cached
  const box = await page.locator('#c1').boundingBox();
  const y = box.y + box.height / 2, at = f => box.x + box.width * f;
  await page.evaluate(() => { location.hash = '#/favourites'; });
  await expect(page.locator('[data-name="performance-chart"]')).toHaveCount(0);
  await page.mouse.move(at(0.4), y); // where the chart will be
  await page.evaluate(() => { location.hash = '#/portfolio'; });
  await page.mouse.move(at(0.4) + 1, y); // the new chart is hovered (and greyed) from the start
  await expect(page.locator('[data-name="performance-chart-interaction-area"][data-dg-sel]')).toHaveCount(1);
  // Wait for the rebuilt canvas to be drawn under the pointer (the mock greys the line to its right).
  let grey;
  await expect.poll(async () => {
    grey = await page.evaluate(x => {
      const c = document.getElementById('c1'), ctx = c.getContext('2d');
      const col = cx => { const d = ctx.getImageData(cx, 0, 1, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] < 40 && Math.abs(d[i + 1] - 159) < 40) return true; return false; };
      return { left: col(Math.round(x * 0.5)), right: col(Math.round(x * 1.5)) };
    }, box.width * 0.4);
    return grey;
  }).toEqual({ left: true, right: false });
  expect(grey).toEqual({ left: true, right: false });
  await page.mouse.down();
  await page.mouse.move(at(0.7), y, { steps: 3 });
  await page.mouse.move(at(0.999), y, { steps: 3 });
  await page.mouse.up();
  const label = page.locator('[data-name="performance-chart-interaction-area"] > div', { hasText: '→' });
  await expect(label).toBeVisible();
  const r = await page.evaluate(() => {
    const area = document.querySelector('[data-name="performance-chart-interaction-area"]');
    const band = [...area.children].find(d => d.style.borderLeftWidth === '1px');
    const b = band.getBoundingClientRect(), c = document.getElementById('c1').getBoundingClientRect();
    return { band: [b.left, b.right], chart: [c.left, c.right] };
  });
  expect(r.band[1]).toBeGreaterThanOrEqual(r.chart[1] - 10); // the last point (7 px padding), not the cursor
  expect(r.band[0]).toBeLessThanOrEqual(r.chart[0] + 0.45 * (r.chart[1] - r.chart[0]));
});
