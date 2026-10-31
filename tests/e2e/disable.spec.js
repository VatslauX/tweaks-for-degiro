// Switching the extension off in chrome://extensions leaves its scripts running in open tabs.
// They must notice and stop: no more order requests to DEGIRO, our additions removed.
const { test, expect, advanceUntilVisible } = require('./fixtures');

test.use({ freshBrowser: true }); // the extension stays switched off in this browser

const badge = page => page.locator('#chart div:not(:has(div))', { hasText: /^BUY 100 · 15,50$/ });

test('disabling the extension stops the order polling and removes our additions', async ({ degiro, context, extId }) => {
  test.setTimeout(90000);
  const { page, calls } = await degiro({ clock: true });
  await advanceUntilVisible(page, badge(page)); // first scheduler run and poll
  await expect(page.locator('[data-dg-own]').first()).toBeAttached();

  const ext = await context.newPage();
  const toggle = ext.locator('#enableToggle:visible');
  // chrome://extensions renders late on a busy machine and can swallow the click or show a stale state:
  // load the page again to read the real state, and click only while the toggle shows "on"
  await expect(async () => {
    await ext.goto(`chrome://extensions/?id=${extId}`);
    await expect(toggle).toHaveAttribute('aria-pressed', /true|false/);
    if ((await toggle.getAttribute('aria-pressed')) === 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false', { timeout: 4000 });
  }).toPass({ timeout: 40000 });
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
