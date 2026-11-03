// Translations in a German browser, in both script worlds. Its own file: the browser language is set
// per worker (test.use at the top level), since a worker reuses its browser.
const { test, expect } = require('./fixtures');

test.use({ lang: 'de' });
test.skip(process.platform === 'darwin', 'Chromium on macOS ignores --lang; runs in CI (Linux)');

test('settings page, page texts and chart badges are in German', async ({ degiro, settings }) => {
  const opt = await settings();
  await expect(opt.locator('[data-i18n=optSpread]')).toHaveText('Geld/Brief-Spanne');
  await expect(opt.locator('#version')).toHaveText(/^Version \d+\.\d+\.\d+$/);
  expect(await opt.evaluate(() => document.documentElement.lang)).toMatch(/^de/);

  const { page } = await degiro();
  // isolated world
  await expect(page.locator('[data-spread-row] dt').first()).toHaveText('Spread');
  await expect(page.locator('#dg-header-spread')).toHaveAttribute('title', 'Aktuelle Geld/Brief-Spanne');
  // page world, texts passed through data-dg-i18n
  await expect(page.locator('#chart div', { hasText: /^KAUF 100 · 15,50$/ })).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#chart div', { hasText: /^KAUF 100 · 15,50$/ })).toHaveAttribute('title', 'Order anpassen');
});
