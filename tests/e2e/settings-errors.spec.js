// Settings page must report problems instead of pretending to save, and content scripts
// must survive bad values in storage.
const { test, expect } = require('./fixtures');

test('rejects too many section titles and keeps the saved list', async ({ settings }) => {
  const opt = await settings();
  await opt.fill('#hiddenTitles', Array.from({ length: 40 }, (_, i) => 'Section ' + i).join('\n'));
  await expect(opt.locator('#status')).toHaveText(/max 30/i);
  await expect(opt.locator('#status')).toHaveClass(/error/);
  // nothing was written (fresh profile -> key absent, defaults apply)
  const stored = await opt.evaluate(() => chrome.storage.sync.get('hiddenTitles'));
  expect(stored.hiddenTitles).toBeUndefined();
});

test('rejects an overly long title', async ({ settings }) => {
  const opt = await settings();
  await opt.fill('#hiddenTitles', 'x'.repeat(150));
  await expect(opt.locator('#status')).toHaveText(/100 characters/i);
});

test('shows an error when Chrome fails to save', async ({ settings }) => {
  const opt = await settings();
  await opt.evaluate(() => { chrome.storage.sync.set = () => Promise.reject(new Error('QUOTA_BYTES quota exceeded')); });
  await opt.locator('label.row:has(input[data-key=spread])').click();
  await expect(opt.locator('#status')).toHaveText(/Couldn.t save.*QUOTA/);
  await expect(opt.locator('#status')).toHaveClass(/error/);
});

test('shows Saved on success', async ({ settings }) => {
  const opt = await settings();
  await opt.locator('label.row:has(input[data-key=spread])').click();
  await expect(opt.locator('#status')).toHaveText('Saved');
});

test('content scripts survive corrupted storage values', async ({ degiro, settings }) => {
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ hiddenTitles: 'not-a-list', spread: 'yes', orders: null }));
  const { page } = await degiro();
  await expect(page.locator('[data-spread-row]')).toHaveCount(1); // 'yes' -> on
  await expect(page.locator('#cash')).toBeHidden();               // bad list -> defaults
  const bridged = await page.evaluate(() => JSON.parse(document.documentElement.getAttribute('data-dg-tweaks')));
  expect(bridged.orders).toBe(true);                               // null -> default
});
