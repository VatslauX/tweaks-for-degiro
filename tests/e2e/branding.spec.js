const { test, expect } = require('./fixtures');

test('settings page states the extension is unofficial', async ({ settings }) => {
  const opt = await settings();
  await expect(opt.locator('h1')).toHaveText('Tweaks for DEGIRO');
  await expect(opt.locator('body')).toContainText(/not affiliated with DEGIRO/i);
});
