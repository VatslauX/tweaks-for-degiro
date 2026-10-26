// Failed DEGIRO requests must not turn into a request loop: an expired session is never reused,
// and failed requests are retried only after a pause.
const { test, expect } = require('./fixtures');

const badge = page => page.locator('#chart div', { hasText: /^BUY 100 · 15,50$/ });

test('expired session: no request loop, and orders come back with the new session', async ({ degiro }) => {
  test.setTimeout(60000);
  const { page, calls } = await degiro({
    respond: u => u.pathname.includes(';jsessionid=TESTSID') ? { status: 401, body: '' } : undefined
  });
  await page.waitForTimeout(12000);
  // one rejected request, not one per second
  expect(calls.update).toBeLessThanOrEqual(2);
  expect(calls.lastUpdateUrl).toContain('jsessionid=TESTSID');
  // after the pause it asks DEGIRO for the current session and loads the orders with it
  await expect(badge(page)).toBeVisible({ timeout: 20000 });
  expect(calls.lastUpdateUrl).toContain('/42;jsessionid=APISID');
  expect(calls.config).toBe(1);
  expect(calls.client).toBe(0); // the account number is already known
});

test('a session the fallback returns that was rejected is not used again', async ({ degiro }) => {
  test.setTimeout(60000);
  const { page, calls } = await degiro({
    initScript: () => { window.__MOCK_NO_URL_SESSION = true; },
    respond: u => u.pathname.startsWith('/trading/secure/v5/update/') ? { status: 401, body: '' } : undefined
  });
  await page.waitForTimeout(30000);
  expect(calls.update).toBe(1);
  expect(calls.config).toBe(1); // at most once a minute
});

test('a request that never answers times out, and orders load on the next poll', async ({ degiro }) => {
  test.setTimeout(60000);
  let n = 0;
  const { page, calls } = await degiro({
    respond: u => u.pathname.startsWith('/trading/secure/v5/update/') && n++ === 0 ? 'hang' : undefined
  });
  await expect(badge(page)).toBeVisible({ timeout: 30000 });
  expect(calls.update).toBe(2);
});

for (const [what, answer] of [['an error', { status: 500, body: '' }], ['bad JSON', { status: 200, contentType: 'application/json', body: 'not json' }]]) {
  test(`portfolio value request answering ${what} is not retried in a loop`, async ({ degiro }) => {
    const { page, calls } = await degiro({
      url: 'https://trader.degiro.nl/trader/?mock=portfolio#/portfolio',
      respond: u => u.pathname === '/portfolio-metrics/secure/api/v1/portfolio/value' ? answer : undefined
    });
    await page.waitForTimeout(5000);
    // the mock page's own request plus at most one of ours
    expect(calls.portfolio).toBeLessThanOrEqual(2);
  });
}
