// Orders → Outstanding: remembers the sort column/direction across a reload (F4). DEGIRO itself
// forgets it on every page remount; logic (clicks, storage, restore attempts) is covered in
// tests/integration/tables.test.js — this file proves it survives a real reload.
const { test, expect, setFlag } = require('./fixtures');

const URL_O = 'https://trader.degiro.nl/trader/?mock=orders#/orders/open';
const head = (page, label) => page.locator('#orders thead th', { hasText: label });
// chrome.storage.sync.set() is a real (if fast) async extension write: wait for it to land before
// reloading, or the reload can race ahead of it and find nothing saved yet. Only the extension's own
// pages (here, the options page) have `chrome`; the content page does not.
const savedSort = opt => opt.evaluate(() => chrome.storage.sync.get({ dgOrdersSort: null }).then(r => r.dgOrdersSort));

test('a click on a header is restored after a reload', async ({ degiro, settings }) => {
  const opt = await settings();
  const { page } = await degiro({ url: URL_O });
  await head(page, 'Product').locator('button').click();
  await expect(head(page, 'Product')).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(() => savedSort(opt)).toEqual({ col: 'product', dir: 'ascending' });

  await page.reload();
  await expect(head(page, 'Product')).toHaveAttribute('aria-sort', 'ascending');
});

test('switching the setting off stops it from restoring', async ({ degiro, settings }) => {
  const opt = await settings();
  const { page } = await degiro({ url: URL_O });
  await head(page, 'Product').locator('button').click();
  await expect.poll(() => savedSort(opt)).toEqual({ col: 'product', dir: 'ascending' });

  await setFlag(opt, 'ordersSort', false);

  await page.reload();
  await expect(head(page, 'Product')).toHaveAttribute('aria-sort', 'none');
});
