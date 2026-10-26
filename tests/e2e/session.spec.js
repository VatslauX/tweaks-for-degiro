// Orders need DEGIRO's session. Normally it is read from DEGIRO's own request URLs; if those stop
// carrying it, orders.js asks DEGIRO's config and client endpoints instead (only then).
const { test, expect } = require('./fixtures');

const badge = page => page.locator('#chart div', { hasText: /^BUY 100 · 15,50$/ });

test('session from request URLs: the fallback endpoints are never called', async ({ degiro }) => {
  const { page, calls } = await degiro();
  await expect(badge(page)).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(6000); // past the fallback delay
  expect(calls.config).toBe(0);
  expect(calls.client).toBe(0);
  expect(calls.lastUpdateUrl).toContain('/42;jsessionid=TESTSID');
});

test('no session in request URLs: orders still load through the fallback', async ({ degiro }) => {
  const { page, calls } = await degiro({ initScript: () => { window.__MOCK_NO_URL_SESSION = true; } });
  await expect(badge(page)).toBeVisible({ timeout: 12000 });
  expect(calls.lastUpdateUrl).toContain('/4242;jsessionid=APISID');
  expect(calls.lastClientUrl).toBe('/pa/secure/client?sessionId=APISID');
  // asked once, not on every run
  await page.waitForTimeout(3000);
  expect(calls.config).toBe(1);
  expect(calls.client).toBe(1);
});

test('without window.Highcharts the chart features report "Not found"', async ({ degiro, settings }) => {
  // DEGIRO "bundles Highcharts without the global": the mock's chart never appears either
  const { page } = await degiro({ initScript: () => {
    Object.defineProperty(window, 'Highcharts', { get: () => undefined, set: () => {}, configurable: false });
  } });
  const opt = await settings();
  await expect.poll(async () => {
    await page.bringToFront();
    await opt.evaluate(() => globalThis.dgLoadStatus());
    return opt.locator('#pageStatusList li', { hasText: 'Range selection' }).textContent();
  }, { timeout: 10000 }).toMatch(/Not found/);
  await expect(opt.locator('#pageStatusList li', { hasText: 'Open orders on chart' })).toContainText('Not found');
});
