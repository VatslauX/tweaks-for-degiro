// Failed DEGIRO requests must not turn into a request loop: an expired session is never reused,
// and failed requests are retried only after a pause.
const { test, expect } = require('./fixtures');

const badge = page => page.locator('#chart div', { hasText: /^BUY 100 · 15,50$/ });

test('expired session: no request loop, and orders come back with the new session', async ({ degiro }) => {
  test.setTimeout(60000);
  const { page, calls } = await degiro({
    clock: true,
    respond: u => u.pathname.includes(';jsessionid=TESTSID') ? { status: 401, body: '' } : undefined
  });
  // Wait for the real resource entry that supplies the session + account to the extension.
  // This remains in real browser time while the page's timers are faked.
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(entry =>
    entry.name.includes('/product-notes-service/secure/notes?') && entry.name.includes('intAccount=42') && entry.name.includes('sessionId=TESTSID')
  ));
  // Fire the first rAF so the extension makes its initial poll request
  await page.clock.fastForward(100);
  // Wait in real time for the 401 to be received and processed; only THEN schedule
  // the backoff timer (async: if we fastForward past T=20 s before the response
  // arrives, the backoff timer is never registered in the fake-clock queue).
  await expect.poll(() => calls.update, { timeout: 5000 }).toBeGreaterThanOrEqual(1);
  // one rejected request, not one per second
  expect(calls.update).toBeLessThanOrEqual(2);
  // Now the backoff is scheduled at T_fake + 20 s; advance past it
  await page.clock.fastForward(21000);
  // Config fetch is async; wait for it to land
  await expect.poll(() => calls.config, { timeout: 5000 }).toBe(1);
  // Extension has the new session; trigger the scheduler to make the next poll
  await page.clock.fastForward(500);
  await expect(badge(page)).toBeVisible({ timeout: 5000 });
  expect(calls.lastUpdateUrl).toContain('/42;jsessionid=APISID');
  expect(calls.config).toBe(1);
  expect(calls.client).toBe(0); // account number already known from the URL
});

test('a session the fallback returns that was rejected is not used again', async ({ degiro }) => {
  test.setTimeout(60000);
  const { page, calls } = await degiro({
    clock: true,
    initScript: () => { window.__MOCK_NO_URL_SESSION = true; },
    respond: u => u.pathname.startsWith('/trading/secure/v5/update/') ? { status: 401, body: '' } : undefined
  });
  // advance past the 5 s session fallback + one rejected poll + 20 s backoff
  await page.clock.fastForward(30000);
  // fastForward fires timers but async fetches take real time; poll for results
  await expect.poll(() => calls.update, { timeout: 3000 }).toBe(1);
  await expect.poll(() => calls.config, { timeout: 3000 }).toBe(1);
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
      clock: true,
      url: 'https://trader.degiro.nl/trader/?mock=portfolio#/portfolio',
      respond: u => u.pathname === '/portfolio-metrics/secure/api/v1/portfolio/value' ? answer : undefined
    });
    await page.clock.fastForward(5000);
    // the mock page's own request plus at most one of ours
    expect(calls.portfolio).toBeLessThanOrEqual(2);
  });
}
