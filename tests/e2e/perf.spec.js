// The shared scheduler must not run features on every frame while the chart is hovered, and the
// extension's own changes must not retrigger it while the quotes tick.
const { test, expect } = require('./fixtures');

// counts runs of the spread feature: it re-sets the title of the header spread element on every run
// (a same-value write still queues a mutation record)
const COUNT_RUNS = () => {
  window.__runs = 0;
  const el = document.getElementById('dg-header-spread');
  new MutationObserver(m => { window.__runs += m.length; }).observe(el, { attributes: true, attributeFilter: ['title'] });
};

test('hovering the chart does not run the spread feature on every frame', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(page.locator('#dg-header-spread')).toBeVisible();
  await page.waitForTimeout(500);
  await page.evaluate(COUNT_RUNS);
  const box = await page.locator('#chart').boundingBox();
  const end = Date.now() + 2000;
  let i = 0;
  while (Date.now() < end) {
    await page.mouse.move(box.x + 50 + (i++ * 7) % (box.width - 100), box.y + 100);
    await page.waitForTimeout(8);
  }
  expect(i).toBeGreaterThan(50);
  const runs = await page.evaluate(() => window.__runs);
  if (process.env.PERF_LOG) process.stdout.write(`spread runs while hovering: ${runs}\n`);
  expect(runs).toBeLessThanOrEqual(5);
});

test('live ticker: the extension does not retrigger itself', async ({ degiro }) => {
  const { page } = await degiro({ initScript: () => { window.__MOCK_TICK_MS = 200; } });
  await expect(page.locator('#dg-header-spread')).toBeVisible();
  await page.waitForTimeout(1000);
  const result = await page.evaluate(() => new Promise(resolve => {
    let foreign = 0, own = 0, runs = 0;
    const t0 = window.__ticks;
    new MutationObserver(ms => {
      for (const m of ms) {
        const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (el?.closest('[data-dg-own]') || el?.closest('[data-spread-row]')) own++; else foreign++;
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    new MutationObserver(m => { runs += m.length; }).observe(document.getElementById('dg-header-spread'), { attributes: true, attributeFilter: ['title'] });
    setTimeout(() => resolve({ ticks: window.__ticks - t0, foreign, own, runs }), 3000);
  }));
  if (process.env.PERF_LOG) process.stdout.write(`ticker: ${JSON.stringify(result)}\n`);
  expect(result.ticks).toBeGreaterThanOrEqual(12);
  // each tick changes the page's own texts (a bounded number of mutations: 3 quote texts + chart redraw);
  // the extension adds at most its spread texts. Features must not run more than about once per tick.
  expect(result.foreign / result.ticks).toBeLessThan(80);
  expect(result.own / result.ticks).toBeLessThanOrEqual(6);
  expect(result.runs).toBeLessThanOrEqual(result.ticks + 4);
});
