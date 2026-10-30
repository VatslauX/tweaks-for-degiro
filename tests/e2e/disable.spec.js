// Switching the extension off in chrome://extensions leaves its scripts running in open tabs.
// They must notice and stop: no more order requests to DEGIRO, our additions removed.
const { test, expect } = require('./fixtures');

const badge = page => page.locator('#chart div:not(:has(div))', { hasText: /^BUY 100 · 15,50$/ });

test('disabling the extension stops the order polling and removes our additions', async ({ degiro, context, extId }) => {
  test.setTimeout(90000);
  const { page, calls } = await degiro({ clock: true });
  await page.clock.fastForward(2000); // fire first scheduler run
  await expect(badge(page)).toBeVisible({ timeout: 3000 });
  await expect(page.locator('[data-dg-own]').first()).toBeAttached();

  const ext = await context.newPage();
  await ext.goto(`chrome://extensions/?id=${extId}`);
  await ext.locator('#enableToggle:visible').click();
  await expect(ext.locator('#enableToggle:visible')).toHaveAttribute('aria-pressed', 'false');
  await ext.close();

  // The extension's isolated-world 2 s runtime-id check fires on real time;
  // also advance virtual time a bit to trigger any MAIN-world detection.
  await page.clock.fastForward(3000);
  await expect(badge(page)).toHaveCount(0, { timeout: 8000 });
  // only empty, hidden helpers stay (as when every feature is switched off in Settings)
  expect(await page.locator('[data-dg-own]').evaluateAll(els => els.filter(e => e.textContent.trim()).length)).toBe(0);
  const before = calls.update;
  await page.clock.fastForward(45000); // two poll intervals
  expect(calls.update).toBe(before);
});
