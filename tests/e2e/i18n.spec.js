// Translations: the extension follows the browser language (_locales), in both script worlds.
const { test, expect } = require('./fixtures');

test.describe('German browser', () => {
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
});

test('English by default; placeholders are filled in', async ({ degiro }) => {
  const { page } = await degiro();
  const badge = page.locator('#chart div', { hasText: /^BUY 100 · 15,50$/ });
  await expect(badge).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#dg-period-change')).toHaveAttribute('title', /^Change over the selected period \(\w+\), from/);
});

test('page-world texts from the page are shown as text, not HTML', async ({ degiro }) => {
  // the page can rewrite data-dg-i18n before our scripts read it
  const { page } = await degiro({ initScript: () => {
    const set = () => document.documentElement.setAttribute('data-dg-i18n', JSON.stringify({ badgeBuy: '<img src=x onerror=window.__pwned=1>' }));
    const arm = () => {
      new MutationObserver(() => { if (!document.documentElement.getAttribute('data-dg-i18n')?.includes('<img')) set(); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-dg-i18n'] });
      set();
    };
    // <html> doesn't exist yet when init scripts run
    if (document.documentElement) arm();
    else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); arm(); } }).observe(document, { childList: true });
  } });
  await expect(page.locator('#chart div', { hasText: /^<img src=x/ }).first()).toBeVisible({ timeout: 8000 });
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(await page.locator('#chart img').count()).toBe(0);
});
