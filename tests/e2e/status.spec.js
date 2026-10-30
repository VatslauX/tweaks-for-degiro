// Feature status in the toolbar popup ("On this page"), and the shared scheduler behind it.
const { test, expect } = require('./fixtures');

// the popup asks the active tab; bring DEGIRO to the front, then refresh the popup's list
async function popupStatus(page, opt) {
  await page.bringToFront();
  await opt.evaluate(() => globalThis.dgLoadStatus());
  const rows = await opt.locator('#pageStatusList li').evaluateAll(lis => lis.map(li => [li.firstChild.textContent, li.lastChild.textContent]));
  return Object.fromEntries(rows);
}

test('popup lists which features work on the open DEGIRO page', async ({ degiro, settings }) => {
  const { page } = await degiro();
  await expect(page.locator('#dg-period-change')).toBeVisible();
  const opt = await settings();
  await expect.poll(async () => (await popupStatus(page, opt))['Open orders on chart'], { timeout: 8000 }).toBe('Working');
  const s = await popupStatus(page, opt);
  expect(s['Bid/ask spread']).toBe('Working');
  expect(s['Range selection']).toBe('Working');
  expect(s['Change for selected period']).toBe('Working');
  expect(s['Filters and totals on Orders']).toBe('Not on this page');
  await expect(opt.locator('#pageStatus')).toBeVisible();
});

// A missing page element ("Not found"): the isolated-world 8 s loading window runs on real time
// here, so it is checked in tests/integration/content.test.js, and the popup's "Not found" text
// with page-world features on the fake clock in session.spec.js.

test('popup hides the list when the active tab is not DEGIRO', async ({ settings }) => {
  const opt = await settings();
  await opt.evaluate(() => globalThis.dgLoadStatus());
  await expect(opt.locator('#pageStatus')).toBeHidden();
});

test('status from the page is accepted only for known features and values', async ({ degiro, settings }) => {
  const { page } = await degiro();
  const opt = await settings();
  await expect.poll(async () => (await popupStatus(page, opt))['Open orders on chart'], { timeout: 8000 }).toBe('Working');
  // the page can write the status attribute: unknown keys and values must be ignored
  await page.evaluate(() => document.documentElement.setAttribute('data-dg-status',
    JSON.stringify({ orders: '<img src=x onerror=alert(1)>', evil: 'ok', spread: 'missing', chartSelect: 'missing' })));
  const s = await popupStatus(page, opt);
  expect(Object.values(s).join(' ')).not.toContain('<img');
  expect(s['Open orders on chart']).toBeUndefined(); // invalid value: dropped
  expect(s['Bid/ask spread']).toBe('Working');       // isolated-world feature: the page can't override it
  expect(await opt.locator('#pageStatusList img').count()).toBe(0);
});

test('the page settles: no render loop between the features and the scheduler', async ({ degiro }) => {
  // count animation frames requested by the page world (the scheduler batches into them)
  // clock: true so the fake rAF is already in place when the initScript wraps it
  const { page } = await degiro({ clock: true, initScript: () => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__rafs = 0;
    window.requestAnimationFrame = cb => { window.__rafs++; return raf(cb); };
  } });
  await page.clock.fastForward(2000); // fire initial scheduler runs; period-change + spread row appear
  await expect(page.locator('#dg-period-change')).toBeVisible();
  await expect(page.locator('[data-spread-row]')).toHaveCount(1);
  await page.clock.fastForward(1500); // let everything settle
  const before = await page.evaluate(() => window.__rafs);
  await page.clock.fastForward(2000); // measure 2 s of virtual time
  const frames = await page.evaluate(() => window.__rafs) - before;
  // a render loop would request ~120 frames in 2 s; the `every` timers need only a few
  expect(frames).toBeLessThan(20);
});
