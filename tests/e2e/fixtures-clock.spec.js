// The fixture itself: Playwright's fake clock belongs to the whole browser context (page.clock is the context's
// clock) and cannot be uninstalled, so a browser that had it must not reach the next test. Otherwise every later
// page there gets a fake Date and timers, and a fake performance whose getEntriesByType('resource') is empty.
// Serial: each check runs right after a test that installed the clock, in the same worker (same browser pool).
const { test, expect } = require('./fixtures');

test.describe.configure({ mode: 'serial' });

// a page of the next test, without the clock: the browser's own Date and resource timing
async function expectRealClock(degiro) {
  const { page } = await degiro();
  // the product mock loads Highcharts from /mock/highcharts.js, so resource timing has at least that entry
  await expect.poll(() => page.evaluate(() => ({
    clock: typeof globalThis.__pwClock,
    resources: performance.getEntriesByType('resource').some(e => e.name.endsWith('/mock/highcharts.js'))
  }))).toEqual({ clock: 'undefined', resources: true });
}

test('degiro({ clock: true }) installs the fake clock', async ({ degiro }) => {
  const { page } = await degiro({ clock: true });
  expect(await page.evaluate(() => typeof globalThis.__pwClock)).toBe('object');
});

test('the next test gets the real clock', async ({ degiro }) => {
  await expectRealClock(degiro);
});

test('a test may install the clock itself', async ({ settings }) => {
  const opt = await settings();
  await opt.clock.install();
  expect(await opt.evaluate(() => typeof globalThis.__pwClock)).toBe('object');
});

test('the next test gets the real clock after that too', async ({ degiro }) => {
  await expectRealClock(degiro);
});
