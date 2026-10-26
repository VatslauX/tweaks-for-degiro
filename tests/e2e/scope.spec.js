// The extension must not run anywhere except the DEGIRO web trader's top frame.
const { test, expect } = require('./fixtures');

const injected = page => page.evaluate(() => ({
  flags: document.documentElement.hasAttribute('data-dg-tweaks'),
  spread: !!document.querySelector('[data-spread-row]')
}));

test('runs on trader.degiro.nl/trader/', async ({ degiro }) => {
  const { page } = await degiro();
  await expect.poll(() => injected(page)).toEqual({ flags: true, spread: true });
});

test('does not run on other trader.degiro.nl paths', async ({ degiro }) => {
  const { page } = await degiro({ url: 'https://trader.degiro.nl/login/nl' });
  await page.waitForTimeout(1500);
  expect(await injected(page)).toEqual({ flags: false, spread: false });
});

test('does not run on other DEGIRO subdomains', async ({ context }) => {
  await context.route('https://www.degiro.nl/**', r => r.fulfill({ contentType: 'text/html', body: '<dl><div><div><dt>Bid</dt><dd>1,00</dd></div><div><dt>Ask</dt><dd>1,10</dd></div></div></dl>' }));
  const page = await context.newPage();
  await page.goto('https://www.degiro.nl/');
  await page.waitForTimeout(1500);
  expect(await injected(page)).toEqual({ flags: false, spread: false });
});

test('does not run inside iframes', async ({ degiro }) => {
  const { page } = await degiro();
  await page.evaluate(() => {
    const f = document.createElement('iframe');
    f.src = '/trader/frame.html'; f.id = 'frm';
    document.body.appendChild(f);
  });
  const frame = await (await page.waitForSelector('#frm')).contentFrame();
  await frame.waitForLoadState();
  await page.waitForTimeout(1500);
  expect(await injected(frame)).toEqual({ flags: false, spread: false });
});
