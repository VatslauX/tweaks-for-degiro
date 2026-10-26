// Range selection uses pointer events on the chart itself:
// no window listeners piling up per chart, and it works with pen/touch, not only a mouse.
const { test, expect } = require('./fixtures');

async function windowListeners(page) {
  const cdp = await page.context().newCDPSession(page);
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' });
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
  const count = t => listeners.filter(l => l.type === t).length;
  return { move: count('mousemove') + count('pointermove'), up: count('mouseup') + count('pointerup'), key: count('keydown') };
}

test('re-creating the chart does not add window listeners', async ({ degiro }) => {
  const { page } = await degiro();
  await page.waitForFunction(() => Highcharts.charts.some(c => c?.container?.hasAttribute('data-dg-sel')));
  const before = await windowListeners(page);
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => {
      const old = window.__chart, opts = old.userOptions; old.destroy();
      window.__chart = new Highcharts.Chart(Object.assign({}, opts, { chart: Object.assign({}, opts.chart, { renderTo: 'chart' }) }));
    });
    await page.waitForFunction(() => window.__chart.container.hasAttribute('data-dg-sel'));
  }
  const after = await windowListeners(page);
  expect(after).toEqual(before);
});

test('selection works with a pen/touch pointer', async ({ degiro }) => {
  const { page } = await degiro();
  await page.waitForFunction(() => Highcharts.charts.some(c => c?.container?.hasAttribute('data-dg-sel')));
  await page.evaluate(() => {
    const box = window.__chart.container, r = box.getBoundingClientRect(), y = r.top + 150;
    const fire = (type, x, target = box) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, pointerType: 'pen', isPrimary: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1,
      clientX: x, clientY: y
    }));
    fire('pointerdown', r.left + r.width * 0.2);
    fire('pointermove', r.left + r.width * 0.4);
    fire('pointermove', r.left + r.width * 0.6);
    fire('pointerup', r.left + r.width * 0.6);
  });
  await expect(page.locator('#chart .highcharts-container > div', { hasText: '→' })).toBeVisible();
});

test('clicking an order badge still opens the order, not a selection', async ({ degiro }) => {
  const { page } = await degiro();
  const badge = page.locator('#chart div', { hasText: /^BUY 100 · 15,50$/ });
  await expect(badge).toBeVisible({ timeout: 8000 });
  await badge.click();
  await expect(page.locator('[data-name=orderDetails]')).toBeVisible();
});

test('portfolio: re-rendering does not add window listeners', async ({ degiro }) => {
  const { page } = await degiro({ url: 'https://trader.degiro.nl/trader/?mock=portfolio#/portfolio' });
  await expect(page.locator('#dg-portfolio-change')).toBeVisible();
  await page.waitForFunction(() => document.querySelector('[data-name="performance-chart-interaction-area"]')?.hasAttribute('data-dg-sel'));
  const before = await windowListeners(page);
  // DEGIRO re-creates the chart area (e.g. after navigating away and back)
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { const a = document.querySelector('[data-name="performance-chart-interaction-area"]'); a.replaceWith(a.cloneNode(true)); });
    await page.waitForFunction(() => document.querySelector('[data-name="performance-chart-interaction-area"]')?.hasAttribute('data-dg-sel'));
  }
  expect(await windowListeners(page)).toEqual(before);
});
