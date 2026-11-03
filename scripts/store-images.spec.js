// Chrome Web Store images: 5 screenshots (1280×800), small promo tile (440×280), marquee (1400×560).
// Run: npm run store-images  →  dist/store/
//
// Screenshots come from the real trader.degiro.nl, taken by hand in a logged-in tab after pasting
// scripts/screenshot-mask.js into the DevTools console (it replaces every personal number with a
// mock value), and saved as dist/screenshots-real/raw/{1-product,2-range,3-portfolio,4-orders}.{png,jpg}.
// The settings popup is captured here from the extension itself, over the product screenshot.
const { test, expect } = require('../tests/e2e/fixtures');
const path = require('path');
const fs = require('fs');

const RAW = path.resolve(__dirname, '../dist/screenshots-real/raw');
const OUT = path.resolve(__dirname, '../dist/store');
const ICON = path.resolve(__dirname, '../extension/icons/icon128.png');
const W = 1280, H = 800, BAR = 96;
const INDIGO = '#4f46e5', INDIGO_DARK = '#3730a3';
const FONT = "Inter,-apple-system,'Segoe UI',Roboto,Helvetica,sans-serif";

const SHOTS = [
  ['1-product', 'Spread, period change and your open orders on the chart'],
  ['2-range', 'Drag on the chart to see the change between two points'],
  ['3-portfolio', 'The same on your portfolio chart'],
  ['4-orders', 'Filter orders and transactions, with totals and your columns']
];

const raw = name => {
  const f = ['.png', '.jpg'].map(e => path.join(RAW, name + e)).find(fs.existsSync);
  if (!f) throw new Error(`missing ${name}.png/.jpg in ${RAW} (see the comment at the top)`);
  return f;
};
const dataUrl = f => `data:image/${f.endsWith('.png') ? 'png' : 'jpeg'};base64,` + fs.readFileSync(f).toString('base64');

// render HTML at an exact size and save it as a JPEG (no alpha channel, as the store asks)
async function render(context, file, width, height, html) {
  const p = await context.newPage();
  await p.setViewportSize({ width, height });
  await p.setContent(`<!doctype html><body style="margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#fff;font-family:${FONT}">${html}</body>`);
  await p.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth));
  await p.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 95 });
  await p.close();
}

const caption = text => `<div style="height:${BAR}px;background:${INDIGO};color:#fff;display:flex;align-items:center;padding:0 48px;font-size:34px;font-weight:600;letter-spacing:-.01em">${text}</div>`;

test.beforeAll(() => fs.mkdirSync(OUT, { recursive: true }));

test('screenshots 1–4 from the real page', async ({ context }) => {
  for (const [name, text] of SHOTS) {
    const short = name === '3-portfolio'; // a short crop: centre it
    await render(context, name + '.jpg', W, H, caption(text) +
      `<div style="height:${H - BAR}px;display:flex;align-items:${short ? 'center' : 'flex-start'};overflow:hidden;${short ? 'background:#fff' : ''}">
        <img src="${dataUrl(raw(name))}" style="display:block;width:${W}px"></div>`);
  }
});

test('screenshot 5: the settings popup over the product page', async ({ degiro, settings, context }) => {
  // the popup's "On this page" needs an open DEGIRO tab: the test mock is enough for that
  const { page } = await degiro();
  await expect(page.locator('#dg-period-change')).toBeVisible();
  const opt = await settings();
  await opt.setViewportSize({ width: 360, height: 540 });
  await opt.addStyleTag({ content: 'html { scrollbar-width: none; }' });
  // wait until every feature has reported (the orders need their first request), none "Loading…"
  await expect.poll(async () => {
    await page.bringToFront();
    await opt.evaluate(() => globalThis.dgLoadStatus());
    const rows = await opt.locator('#pageStatusList li').allTextContents();
    return rows.length > 3 && rows.every(r => !/Loading/.test(r)) && rows.some(r => /Open orders on chart\s*Working/.test(r));
  }, { timeout: 15000 }).toBe(true);
  await opt.waitForTimeout(400); // switch transitions
  const popup = 'data:image/png;base64,' + (await opt.screenshot()).toString('base64');
  await render(context, '5-popup.jpg', W, H, caption('Switch each feature on or off, and see what works on the page') +
    `<div style="position:relative;height:${H - BAR}px;overflow:hidden">
      <img src="${dataUrl(raw('1-product'))}" style="display:block;width:${W}px;filter:brightness(.5)">
      <img src="${popup}" style="position:absolute;top:20px;right:56px;width:360px;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.5)">
    </div>`);
});

test('promo tiles', async ({ context }) => {
  const icon = dataUrl(ICON);
  const bg = `background:linear-gradient(135deg, ${INDIGO} 0%, ${INDIGO_DARK} 100%);color:#fff`;
  await render(context, 'promo-small-440x280.jpg', 440, 280, `
    <div style="${bg};width:440px;height:280px;box-sizing:border-box;padding:34px 32px;display:flex;flex-direction:column;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:16px">
        <img src="${icon}" style="width:72px;height:72px;border-radius:16px;box-shadow:0 0 0 2px rgba(255,255,255,.35)">
        <div style="font-size:30px;font-weight:700;line-height:1.1">Tweaks for<br>DEGIRO</div>
      </div>
      <div style="font-size:17px;line-height:1.35;opacity:.95">Spread, open orders on the chart,<br>and the change for any range</div>
      <div style="font-size:12px;opacity:.7">Unofficial · not affiliated with DEGIRO</div>
    </div>`);
  await render(context, 'promo-marquee-1400x560.jpg', 1400, 560, `
    <div style="${bg};width:1400px;height:560px;position:relative;overflow:hidden">
      <div style="position:absolute;left:80px;top:96px;width:520px">
        <div style="display:flex;align-items:center;gap:20px;margin-bottom:36px">
          <img src="${icon}" style="width:88px;height:88px;border-radius:20px;box-shadow:0 0 0 2px rgba(255,255,255,.35)">
          <div style="font-size:44px;font-weight:700;line-height:1.05">Tweaks for<br>DEGIRO</div>
        </div>
        <div style="font-size:26px;line-height:1.4">Bid/ask spread, your open orders on the chart, and the change between any two points.</div>
        <div style="font-size:15px;opacity:.7;margin-top:28px">Free · open source · unofficial, not affiliated with DEGIRO</div>
      </div>
      <img src="${dataUrl(raw('2-range'))}" style="position:absolute;left:680px;top:70px;width:900px;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.45)">
    </div>`);
});
