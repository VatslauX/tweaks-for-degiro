const { test, expect } = require('./fixtures');

test('settings page states the extension is unofficial', async ({ settings }) => {
  const opt = await settings();
  await expect(opt.locator('h1')).toHaveText('Tweaks for DEGIRO');
  await expect(opt.locator('body')).toContainText(/not affiliated with DEGIRO/i);
});

test('feedback link opens a new GitHub issue with the version, and nothing about the user', async ({ settings }) => {
  const opt = await settings();
  const link = opt.locator('#feedback');
  await expect(link).toBeVisible();
  await expect(link).toHaveText('Feedback or report a problem');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  const href = await link.getAttribute('href');
  const home = await opt.evaluate(() => chrome.runtime.getManifest().homepage_url);
  expect(href.startsWith(home + '/issues/new?body=')).toBe(true);
  const body = decodeURIComponent(href.split('body=')[1]);
  const version = await opt.evaluate(() => chrome.runtime.getManifest().version);
  expect(body).toMatch(new RegExp(`Extension ${version.replace(/\./g, '\\.')} · Chrome \\d+ · en`));
  expect(new URL(href).searchParams.size).toBe(1); // only the body: no page, account or settings data
});
