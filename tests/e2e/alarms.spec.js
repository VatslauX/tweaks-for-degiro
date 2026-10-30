// Price alarms: button and panel (product page), detection and banners, the Alarms page.
const { test, expect, setFlag } = require('./fixtures');

const FAV = 'https://trader.degiro.nl/trader/?mock=favourites#/favourites';
const ALARMS = FAV + '?dg=alarms';
const PRODUCT = 'https://trader.degiro.nl/trader/#/products/123/overview';
let n = 0;
const alarm = o => ({ id: 'al-' + (++n), productId: 123, name: 'Mock ETF', symbol: 'MOCK', currency: '€', price: 17, dir: 'above', repeat: 'once', on: true, created: 1, ...o });
// write alarms (sync) and state/events (local) through the settings page, which has chrome.storage
async function seed(settings, alarms, local = {}) {
  const opt = await settings();
  await opt.evaluate(([a, l]) => Promise.all([chrome.storage.sync.set({ dgAlarms: a }), chrome.storage.local.set(l)]), [alarms, local]);
  return opt;
}
const stored = opt => opt.evaluate(() => chrome.storage.sync.get('dgAlarms').then(r => r.dgAlarms || []));
const setPrice = (page, id, v) => page.evaluate(([i, x]) => window.__setPrice(i, x), [id, v]);

test('Price alarms can be switched off and on in Settings', async ({ settings }) => {
  const opt = await settings();
  await expect(opt.locator('input[data-key=priceAlarms]')).toBeChecked();
  await setFlag(opt, 'priceAlarms', false);
  await setFlag(opt, 'priceAlarms', true);
});

const banner = page => page.locator('[data-dg-alarm-banner]');

test('Favourites: a price past the alarm shows a banner; a once alarm switches itself off', async ({ degiro, settings }) => {
  const opt = await seed(settings, [alarm({ price: 17 })]);
  const { page } = await degiro({ url: FAV });
  await page.waitForTimeout(400);
  await expect(banner(page)).toHaveCount(0);
  await setPrice(page, 123, 17.2);
  await expect(banner(page)).toHaveCount(1);
  await expect(banner(page)).toContainText('Mock ETF rose to € 17,20');
  await expect(banner(page)).toContainText('this alarm is now off');
  await expect.poll(async () => (await stored(opt))[0].on).toBe(false);
  await page.locator('[data-dg-alarm-close]').click();
  await expect(banner(page)).toHaveCount(0);
});

test('below alarm on the product page fires from its CurrentPrice', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ price: 16.5, dir: 'below' })]);
  const { page } = await degiro({ url: PRODUCT });
  await setPrice(page, 123, 16.4);
  await expect(banner(page)).toContainText('Mock ETF fell to € 16,40');
});

test('every time: fires, stays quiet, re-arms after crossing back, fires again', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ repeat: 'each' })]);
  const { page } = await degiro({ url: FAV });
  await setPrice(page, 123, 17.2);
  await expect(banner(page)).toHaveCount(1);
  await page.locator('[data-dg-alarm-close]').click();
  await setPrice(page, 123, 17.3);
  await page.waitForTimeout(500);
  await expect(banner(page)).toHaveCount(0);
  await setPrice(page, 123, 16.8);
  await page.waitForTimeout(300);
  await setPrice(page, 123, 17.1);
  await expect(banner(page)).toHaveCount(1);
});

test('once a day: fires when it last fired yesterday, not twice today', async ({ degiro, settings }) => {
  const a = alarm({ repeat: 'daily' });
  await seed(settings, [a], { dgAlarmState: { [a.id]: { firedAt: Date.now() - 864e5 } } });
  const { page } = await degiro({ url: FAV });
  await setPrice(page, 123, 17.5);
  await expect(banner(page)).toHaveCount(1);
  await page.locator('[data-dg-alarm-close]').click();
  await setPrice(page, 123, 16);
  await page.waitForTimeout(300);
  await setPrice(page, 123, 17.6);
  await page.waitForTimeout(500);
  await expect(banner(page)).toHaveCount(0);
});

test('thousands separators and prices without a title (Review Focus 3)', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ productId: 456, name: 'Mock Tech Inc. Class A', currency: '$', price: 1250 })]);
  const { page } = await degiro({ url: FAV, initScript: () => { window.__MOCK_NO_TITLE = true; } });
  await page.waitForTimeout(400);
  await expect(banner(page)).toHaveCount(0); // 1.248,26 is below 1.250
  await setPrice(page, 456, 1250.5);
  await expect(banner(page)).toContainText('Mock Tech Inc. Class A rose to $ 1.250,50');
});

test('two tabs: the banner shows in both and closing it in one closes both', async ({ degiro, settings, context }) => {
  await seed(settings, [alarm()]);
  const { page: a } = await degiro({ url: FAV });
  const b = await context.newPage();
  await b.goto(FAV);
  await setPrice(a, 123, 17.4);
  await expect(banner(a)).toHaveCount(1);
  await expect(banner(b)).toHaveCount(1);
  await b.locator('[data-dg-alarm-close]').click();
  await expect(banner(a)).toHaveCount(0);
});

test('a deleted alarm takes its banner with it (Review Focus 4)', async ({ degiro, settings }) => {
  const opt = await seed(settings, [alarm({ repeat: 'each' })]);
  const { page } = await degiro({ url: FAV });
  await setPrice(page, 123, 17.4);
  await expect(banner(page)).toHaveCount(1);
  await opt.evaluate(() => chrome.storage.sync.set({ dgAlarms: [] }));
  await expect(banner(page)).toHaveCount(0);
});

test('names from storage stay text in the banner', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ name: '<img src=x onerror="window.__xss=1">' })]);
  const { page } = await degiro({ url: FAV });
  await setPrice(page, 123, 17.4);
  await expect(banner(page)).toContainText('<img src=x');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('the alarm feature makes no network requests', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ repeat: 'each' })]);
  const { page } = await degiro({ url: FAV });
  await page.waitForTimeout(300);
  const urls = [];
  page.on('request', r => urls.push(r.url()));
  await setPrice(page, 123, 17.4);
  await expect(banner(page)).toHaveCount(1);
  await page.locator('[data-dg-alarm-close]').click();
  await page.waitForTimeout(500);
  // DEGIRO's own polling (orders.js, the mock) may run; nothing else may
  expect(urls.filter(u => !/\/(trading|login|pa|portfolio-metrics)\/secure|\/mock\//.test(u))).toEqual([]);
});

const local = opt => opt.evaluate(() => chrome.storage.local.get(['dgAlarmState', 'dgAlarmEvents']));

for (const repeat of ['each', 'daily']) {
  test(`two tabs that disagree about the price do not loop (${repeat})`, async ({ degiro, settings, context }) => {
    const opt = await seed(settings, [alarm({ repeat })]);
    const { page: a } = await degiro({ url: FAV });
    const b = await context.newPage();
    await b.goto(FAV);
    await a.waitForTimeout(400);
    await setPrice(a, 123, 17.4); // B stays at 16.92
    await expect(banner(a)).toHaveCount(1);
    await a.waitForTimeout(2000);
    const first = await local(opt);
    await a.waitForTimeout(1500);
    expect(await local(opt)).toEqual(first);
    if (repeat === 'each') expect(first.dgAlarmEvents).toHaveLength(1);
  });
}

test('every time: a reload while the price is still past the alarm does not fire again', async ({ degiro, settings }) => {
  const a = alarm({ repeat: 'each' });
  const opt = await seed(settings, [a]);
  const { page } = await degiro({ url: FAV });
  await setPrice(page, 123, 17.4);
  await expect(banner(page)).toHaveCount(1);
  await page.locator('[data-dg-alarm-close]').click();
  await expect(banner(page)).toHaveCount(0);
  const st = (await local(opt)).dgAlarmState;
  await page.addInitScript(() => { window.__MOCK_PRICES = { 123: 17.4 }; });
  await page.reload();
  await page.waitForTimeout(1200);
  await expect(banner(page)).toHaveCount(0);
  const after = await local(opt);
  expect(after.dgAlarmEvents).toEqual([]);
  expect(after.dgAlarmState[a.id].firedAt).toBe(st[a.id].firedAt);
});

test('once: switching off keeps an alarm another tab added meanwhile', async ({ degiro, settings }) => {
  const first = alarm();
  const opt = await seed(settings, [first]);
  const { page } = await degiro({ url: FAV });
  await page.waitForTimeout(400);
  // the other tab's add lands in sync storage right before this tab's switch-off is saved
  const extra = alarm({ id: 'al-extra', productId: 789, name: 'Mock Chips ETF' });
  await opt.evaluate(a => chrome.storage.sync.get({ dgAlarms: [] }).then(r => chrome.storage.sync.set({ dgAlarms: [...r.dgAlarms, a] })), extra);
  await setPrice(page, 123, 17.4);
  await expect(banner(page)).toHaveCount(1);
  await expect.poll(async () => (await stored(opt)).map(a => a.id + ':' + a.on).sort()).toEqual(['al-extra:true', first.id + ':false'].sort());
});

const alarmAll = page => page.locator('[data-dg-alarm-button]'); // one per header copy
const alarmBtn = page => alarmAll(page).locator('visible=true'); // the copy DEGIRO shows
const panelEl = page => page.locator('[data-dg-alarm-panel]');

test('Alarm button: only for a favourite, right after Sell; follows the star', async ({ degiro }) => {
  const { page } = await degiro({ url: PRODUCT });
  await expect(alarmAll(page)).toHaveCount(2); // DEGIRO keeps two copies of the product header
  expect(await page.evaluate(() => document.getElementById('sellBtn').nextElementSibling?.hasAttribute('data-dg-alarm-button'))).toBe(true);
  await page.click('#favStar'); // unstar
  await expect(alarmAll(page)).toHaveCount(0);
  await page.click('#favStar');
  await expect(alarmAll(page)).toHaveCount(2);
});

test('two header copies: one Alarm button each, right after its own Sell', async ({ degiro }) => {
  const { page } = await degiro({ url: PRODUCT });
  await expect(alarmAll(page)).toHaveCount(2);
  for (const id of ['sellBtn', 'stickySell']) {
    expect(await page.evaluate(i => document.getElementById(i).nextElementSibling?.hasAttribute('data-dg-alarm-button'), id)).toBe(true);
  }
});

test('sticky header copy: its Alarm button is shown and opens the panel', async ({ degiro }) => {
  const { page } = await degiro({ url: PRODUCT });
  await expect(alarmAll(page)).toHaveCount(2);
  await page.evaluate(() => window.__stickyHeader(true));
  await page.waitForTimeout(1300);
  await expect(alarmBtn(page)).toHaveCount(1);
  await alarmBtn(page).click();
  await expect(page.locator('[data-dg-alarm-panel="123"]')).toBeVisible();
});

test('unstarring removes the buttons of both header copies', async ({ degiro }) => {
  const { page } = await degiro({ url: PRODUCT });
  await expect(alarmAll(page)).toHaveCount(2);
  await page.evaluate(() => window.__stickyHeader(true));
  await page.click('#stickyStar');
  await expect(alarmAll(page)).toHaveCount(0);
});

test('no Alarm button for a product that is not a favourite', async ({ degiro }) => {
  const { page } = await degiro({ url: PRODUCT, initScript: () => { window.__MOCK_NOT_FAVOURITE = true; } });
  await page.waitForTimeout(500);
  await expect(alarmAll(page)).toHaveCount(0);
});

test('with DEGIRO\'s Place order panel open it gets no button; the header copies keep theirs (Review Focus 2)', async ({ degiro }) => {
  const { page } = await degiro({ url: PRODUCT, initScript: () => { window.__MOCK_ORDER_PANEL = true; } });
  await expect(alarmAll(page)).toHaveCount(2);
  expect(await page.evaluate(() => document.getElementById('sellBtn').nextElementSibling?.hasAttribute('data-dg-alarm-button'))).toBe(true);
  expect(await page.locator('#mockOrderPanel [data-dg-alarm-button]').count()).toBe(0);
});

test('sets an alarm above the current price; the order form is never touched', async ({ degiro, settings }) => {
  const opt = await settings();
  const { page } = await degiro({ url: PRODUCT });
  await page.bringToFront();
  await alarmBtn(page).click();
  await expect(panelEl(page)).toBeVisible();
  await expect(page.locator('[data-dg-alarm-price]')).toHaveValue('16,92');
  await page.fill('[data-dg-alarm-price]', '18');
  await expect(page.locator('[data-dg-alarm-hint]')).toContainText('rises to € 18,00');
  await page.click('[data-dg-alarm-repeat=daily]');
  await page.click('[data-dg-alarm-set]');
  await expect.poll(() => stored(opt)).toMatchObject([{ productId: 123, price: 18, dir: 'above', repeat: 'daily', on: true, name: 'Mock ETF', symbol: 'MOCK', currency: '€' }]);
  await expect(page.locator('[data-dg-alarm-row]')).toHaveCount(1);
  await expect(alarmBtn(page)).toContainText('Alarm 1');
  expect(await page.evaluate(() => window.__log.filter(x => /BUY|SELL|CONFIRM/.test(x)))).toEqual([]);
});

test('refuses an equal or invalid price', async ({ degiro }) => {
  const { page } = await degiro({ url: PRODUCT });
  await alarmBtn(page).click();
  await page.fill('[data-dg-alarm-price]', '16,92');
  await expect(page.locator('[data-dg-alarm-msg]')).toContainText('current price');
  await expect(page.locator('[data-dg-alarm-set]')).toBeDisabled();
  await page.fill('[data-dg-alarm-price]', 'abc');
  await expect(page.locator('[data-dg-alarm-set]')).toBeDisabled();
  await page.fill('[data-dg-alarm-price]', '15,5');
  await expect(page.locator('[data-dg-alarm-hint]')).toContainText('falls to');
  await expect(page.locator('[data-dg-alarm-set]')).toBeEnabled();
});

test('the panel closes with ×, Esc and a click outside', async ({ degiro }) => {
  const { page } = await degiro({ url: PRODUCT });
  await alarmBtn(page).click();
  await page.click('[data-dg-alarm-x]');
  await expect(panelEl(page)).toHaveCount(0);
  await alarmBtn(page).click();
  await page.keyboard.press('Escape');
  await expect(panelEl(page)).toHaveCount(0);
  await alarmBtn(page).click();
  await page.mouse.click(300, 600);
  await expect(panelEl(page)).toHaveCount(0);
});

test('switch and delete in the panel; at most 25 alarms', async ({ degiro, settings }) => {
  const opt = await seed(settings, Array.from({ length: 25 }, (_, i) => alarm({ id: 'm' + i, price: 20 + i })));
  const { page } = await degiro({ url: PRODUCT });
  await page.bringToFront();
  await alarmBtn(page).click();
  await page.fill('[data-dg-alarm-price]', '18');
  await page.click('[data-dg-alarm-set]');
  await expect(page.locator('[data-dg-alarm-msg]')).toContainText('25 alarms');
  await page.locator('[data-dg-alarm-row=m0] input[type=checkbox]').uncheck();
  await expect.poll(async () => (await stored(opt)).find(a => a.id === 'm0').on).toBe(false);
  await page.locator('[data-dg-alarm-row=m1] [data-dg-alarm-delete]').click();
  await expect.poll(async () => (await stored(opt)).length).toBe(24);
});

test('switching Price alarms off closes the panel and removes the button (Review Focus 5)', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: PRODUCT });
  const opt = await settings();
  await page.bringToFront();
  await alarmBtn(page).click();
  await setFlag(opt, 'priceAlarms', false);
  await expect(panelEl(page)).toHaveCount(0);
  await expect(alarmAll(page)).toHaveCount(0);
  await setFlag(opt, 'priceAlarms', true);
  await expect(alarmBtn(page)).toHaveCount(1);
});

test('after an in-place product change the button opens the panel for the new product', async ({ degiro }) => {
  const { page } = await degiro({ url: PRODUCT });
  await alarmBtn(page).click();
  await page.click('[data-dg-alarm-x]');
  await page.evaluate(() => {
    location.hash = '#/products/456/overview';
    document.querySelectorAll('#productHeader [data-id], #stickyHeader [data-id]').forEach(e => e.setAttribute('data-id', '456'));
    document.querySelectorAll('[data-name=productName]').forEach(n => { n.setAttribute('title', 'Mock Tech'); n.textContent = 'Mock Tech'; });
    document.querySelectorAll('[data-field=CurrentPrice]').forEach(e => e.setAttribute('data-id', '456'));
  });
  await page.waitForTimeout(1300);
  await alarmBtn(page).click();
  await expect(page.locator('[data-dg-alarm-panel="456"]')).toBeVisible();
  await expect(page.locator('[data-dg-alarm-panel="456"]')).toContainText('Mock Tech');
});

test('a stale equal-price message goes when the price moves; an untouched prefill shows none', async ({ degiro }) => {
  const { page } = await degiro({ url: PRODUCT });
  await page.bringToFront();
  await alarmBtn(page).click();
  await expect(page.locator('[data-dg-alarm-msg]')).toHaveText('');
  await page.fill('[data-dg-alarm-price]', '16,92');
  await expect(page.locator('[data-dg-alarm-msg]')).toContainText('current price');
  await setPrice(page, 123, 17.5);
  await expect(page.locator('[data-dg-alarm-msg]')).toHaveText('');
  await expect(page.locator('[data-dg-alarm-set]')).toBeEnabled();
});

test('a double click on Set saves one alarm', async ({ degiro, settings }) => {
  const opt = await settings();
  const { page } = await degiro({ url: PRODUCT });
  await page.bringToFront();
  await alarmBtn(page).click();
  await page.fill('[data-dg-alarm-price]', '18');
  await page.dblclick('[data-dg-alarm-set]');
  await expect(page.locator('[data-dg-alarm-row]')).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(await stored(opt)).toHaveLength(1);
});

test('unstarring the product closes the panel', async ({ degiro }) => {
  const { page } = await degiro({ url: PRODUCT });
  await alarmBtn(page).click();
  await expect(panelEl(page)).toBeVisible();
  await page.evaluate(() => document.getElementById('favStar').click());
  await expect(panelEl(page)).toHaveCount(0);
  await expect(alarmAll(page)).toHaveCount(0);
});

test('currency missing at first: the header is read again once the price has its sign', async ({ degiro, settings }) => {
  const opt = await settings();
  const { page } = await degiro({ url: PRODUCT, initScript: () => addEventListener('DOMContentLoaded', () => document.querySelectorAll('[data-field=CurrentPrice]').forEach(e => { e.textContent = e.textContent.replace('€', ''); })) });
  await page.bringToFront();
  await page.waitForTimeout(300);
  await setPrice(page, 123, 16.92);
  await page.waitForTimeout(1300);
  await alarmBtn(page).click();
  await expect(page.locator('[data-dg-alarm-panel]')).toContainText('Latest € 16,92');
  await page.fill('[data-dg-alarm-price]', '18');
  await page.click('[data-dg-alarm-set]');
  await expect.poll(() => stored(opt)).toMatchObject([{ currency: '€' }]);
});

const rows = page => page.locator('[data-dg-alarms-page] tr[data-dg-alarm-id]');

test('the sidebar link address opens the Alarms page over Favourites; the address stays', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ price: 18 }), alarm({ productId: 901, name: 'Mock Oil', price: 40 })]);
  const { page } = await degiro({ url: FAV });
  await page.evaluate(() => { location.hash = '#/favourites?dg=alarms'; });
  await expect(page.locator('[data-dg-alarms-page]')).toBeVisible();
  await expect(page.locator('[data-name=favourites]')).toBeHidden();
  expect(await page.evaluate(() => location.hash)).toBe('#/favourites?dg=alarms');
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText('Mock ETF');
  await expect(rows(page).first()).toContainText('€ 16,92'); // live from the hidden list
  await expect(page.locator('tr[data-dg-alarm-id] [data-dg-alarm-status]').nth(1)).toHaveText('Not in current list');
  await page.evaluate(() => { location.hash = '#/favourites'; });
  await expect(page.locator('[data-dg-alarms-page]')).toHaveCount(0);
  await expect(page.locator('[data-name=favourites]')).toBeVisible();
});

test('alarms keep firing while the Alarms page is open', async ({ degiro, settings }) => {
  await seed(settings, [alarm()]);
  const { page } = await degiro({ url: ALARMS });
  await setPrice(page, 123, 17.3);
  await expect(page.locator('[data-dg-alarm-banner]')).toHaveCount(1);
  await expect(page.locator('[data-dg-alarm-status]').first()).toContainText('Fired');
});

test('switches and delete persist after a reload', async ({ degiro, settings }) => {
  const a = alarm(), b = alarm({ price: 19 });
  const opt = await seed(settings, [a, b]);
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  await page.locator(`tr[data-dg-alarm-id="${a.id}"] input[type=checkbox]`).uncheck();
  await page.locator(`tr[data-dg-alarm-id="${b.id}"] [data-dg-alarm-delete]`).click();
  await expect.poll(() => stored(opt)).toMatchObject([{ id: a.id, on: false }]);
  await page.reload();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator(`tr[data-dg-alarm-id="${a.id}"] input[type=checkbox]`)).not.toBeChecked();
});

test('Alarms page: sorted by product A-Z, then price high to low; storage order untouched', async ({ degiro, settings }) => {
  const list = [alarm({ id: 'o1', productId: 11, name: 'Samsung', price: 200 }), alarm({ id: 'o2', productId: 12, name: 'meta', price: 190 }),
    alarm({ id: 'o3', productId: 11, name: 'Samsung', price: 300 }), alarm({ id: 'o4', productId: 12, name: 'meta', price: 200 })];
  const opt = await seed(settings, list);
  const { page } = await degiro({ url: ALARMS });
  await expect(rows(page)).toHaveCount(4);
  expect(await rows(page).evaluateAll(r => r.map(x => x.getAttribute('data-dg-alarm-id')))).toEqual(['o4', 'o2', 'o3', 'o1']);
  expect((await stored(opt)).map(a => a.id)).toEqual(['o1', 'o2', 'o3', 'o4']);
});

test('product panel: this product\'s alarms read price high to low', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ id: 'k1', price: 18 }), alarm({ id: 'k2', price: 30 }), alarm({ id: 'k3', price: 22 })]);
  const { page } = await degiro({ url: PRODUCT });
  await page.bringToFront();
  await alarmBtn(page).click();
  await expect(page.locator('[data-dg-alarm-row]')).toHaveCount(3);
  expect(await page.locator('[data-dg-alarm-row]').evaluateAll(r => r.map(x => x.getAttribute('data-dg-alarm-row')))).toEqual(['k2', 'k3', 'k1']);
});

test('filters: status chips and the product picker', async ({ degiro, settings }) => {
  await seed(settings, [alarm(), alarm({ on: false, price: 19 }), alarm({ productId: 789, name: 'Mock Chips ETF', price: 16 })]);
  const { page } = await degiro({ url: ALARMS });
  await expect(rows(page)).toHaveCount(3);
  await page.click('[data-dg-alarm-filter=off]');
  await expect(rows(page)).toHaveCount(1);
  await page.click('[data-dg-alarm-filter=all]');
  await page.click('[data-dg-alarm-products]');
  await page.locator('[data-dg-alarms-page] [role=listbox] label', { hasText: 'Mock Chips ETF' }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText('Mock Chips ETF');
  await page.mouse.click(700, 700); // outside: the menu closes, the filter stays
  await expect(page.locator('[data-dg-alarms-page] [role=listbox]')).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
});

test('the product menu stays inside the page and shows long names whole', async ({ degiro, settings }) => {
  const long = 'iShares MSCI Global Semiconductors UCITS ETF USD A';
  await seed(settings, [alarm({ productId: 555, name: long }), alarm()]);
  const { page } = await degiro({ url: ALARMS });
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.click('[data-dg-alarm-products]');
  const menu = page.locator('[data-dg-alarms-page] [role=listbox]');
  await expect(menu).toBeVisible();
  const r = await page.evaluate(() => {
    const m = document.querySelector('[data-dg-alarms-page] [role=listbox]').getBoundingClientRect();
    const main = document.querySelector('main#mainContent').getBoundingClientRect();
    const spans = [...document.querySelectorAll('[data-dg-alarms-page] [role=listbox] label span')];
    const sp = spans.find(x => x.textContent.startsWith('iShares'));
    return { left: m.left, right: m.right, mainLeft: main.left, mainRight: main.right,
      clipped: sp.scrollWidth > sp.clientWidth, labelRight: sp.getBoundingClientRect().right };
  });
  expect(r.right).toBeLessThanOrEqual(r.mainRight);
  expect(r.left).toBeGreaterThanOrEqual(r.mainLeft);
  expect(r.clipped).toBe(false);
  expect(r.labelRight).toBeLessThanOrEqual(r.right);

  // Narrow window: the header wraps, the menu must still sit inside the visible page.
  await page.click('[data-dg-alarm-products]');
  await expect(menu).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.click('[data-dg-alarm-products]');
  await expect(menu).toBeVisible();
  await page.waitForTimeout(300);
  const n = await page.evaluate(() => {
    const m = document.querySelector('[data-dg-alarms-page] [role=listbox]').getBoundingClientRect();
    const main = document.querySelector('main#mainContent').getBoundingClientRect();
    return { left: m.left, right: m.right, mainLeft: main.left, mainRight: main.right, vw: window.innerWidth };
  });
  expect(n.left).toBeGreaterThanOrEqual(0);
  expect(n.right).toBeLessThanOrEqual(n.vw);
  expect(n.left).toBeGreaterThanOrEqual(n.mainLeft);
  expect(n.right).toBeLessThanOrEqual(n.mainRight);
});

test('empty state', async ({ degiro }) => {
  const { page } = await degiro({ url: ALARMS });
  await expect(page.locator('[data-dg-alarm-empty]')).toContainText('No alarms yet');
});

test('switching Price alarms off shows DEGIRO\'s Favourites list again (Review Focus 5)', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: ALARMS });
  const opt = await settings();
  await page.bringToFront();
  await expect(page.locator('[data-dg-alarms-page]')).toBeVisible();
  await setFlag(opt, 'priceAlarms', false);
  await expect(page.locator('[data-dg-alarms-page]')).toHaveCount(0);
  await expect(page.locator('[data-name=favourites]')).toBeVisible();
  await setFlag(opt, 'priceAlarms', true);
  await expect(page.locator('[data-dg-alarms-page]')).toBeVisible();
});

test('a price tick during a mouse press does not eat the click', async ({ degiro, settings }) => {
  const a = alarm();
  const opt = await seed(settings, [a]);
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  const sw = page.locator(`tr[data-dg-alarm-id="${a.id}"] input[type=checkbox]`);
  await expect(sw).toBeVisible();
  await sw.hover();
  await page.mouse.down();
  await setPrice(page, 123, 16.5);
  await page.waitForTimeout(300); // a rebuild would have happened by now
  await page.mouse.up();
  await expect.poll(() => stored(opt)).toMatchObject([{ id: a.id, on: false }]);
});

test('keyboard focus on a switch survives a price tick', async ({ degiro, settings }) => {
  const a = alarm();
  await seed(settings, [a]);
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  const sw = page.locator(`tr[data-dg-alarm-id="${a.id}"] input[type=checkbox]`);
  await sw.focus();
  await setPrice(page, 123, 16.5);
  await expect(page.locator(`tr[data-dg-alarm-id="${a.id}"] [data-dg-alarm-status]`)).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => {
    const e = document.activeElement;
    return e instanceof HTMLInputElement && e.type === 'checkbox' && e.closest('tr')?.getAttribute('data-dg-alarm-id');
  })).toBe(a.id);
});

test('the filters reset when the Alarms page is left', async ({ degiro, settings }) => {
  await seed(settings, [alarm(), alarm({ on: false, price: 19 })]);
  const { page } = await degiro({ url: ALARMS });
  await page.click('[data-dg-alarm-filter=off]');
  await expect(rows(page)).toHaveCount(1);
  await page.evaluate(() => { location.hash = '#/favourites'; });
  await expect(page.locator('[data-dg-alarms-page]')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/favourites?dg=alarms'; });
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator('[data-dg-alarm-filter=all]')).toHaveAttribute('aria-pressed', 'true');
});

const navAlarms = page => page.locator('[data-dg-nav=alarms] a');

test('sidebar: Alarms opens the Alarms page and looks current there; hidden when Price alarms is off', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: FAV });
  await expect(navAlarms(page)).toHaveAttribute('href', '#/favourites?dg=alarms');
  await navAlarms(page).click();
  await expect(page.locator('[data-dg-alarms-page]')).toBeVisible();
  await expect(navAlarms(page)).toHaveAttribute('aria-current', 'page');
  const opt = await settings();
  await page.bringToFront();
  await setFlag(opt, 'priceAlarms', false);
  await expect(page.locator('[data-dg-nav=alarms]')).toHaveCount(0);
  await expect(page.locator('[data-dg-nav=orders]')).toHaveCount(1);
});

test('sidebar badge counts open banners', async ({ degiro, settings }) => {
  await seed(settings, [alarm()]);
  const { page } = await degiro({ url: FAV });
  await expect(page.locator('[data-dg-nav-badge]')).toHaveCount(0);
  await setPrice(page, 123, 17.4);
  await expect(page.locator('[data-dg-nav-badge]')).toHaveText('1');
  await page.locator('[data-dg-alarm-close]').click();
  await expect(page.locator('[data-dg-nav-badge]')).toHaveCount(0);
});

test('two alarms firing one after the other both keep their firedAt and event', async ({ degiro, settings }) => {
  const a = alarm({ repeat: 'each', price: 17 }), b = alarm({ repeat: 'each', price: 17.2 });
  const opt = await seed(settings, [a, b]);
  const { page } = await degiro({ url: FAV });
  await page.waitForTimeout(400);
  await setPrice(page, 123, 17.1);
  await setPrice(page, 123, 17.3);
  await expect(banner(page)).toHaveCount(2);
  await page.waitForTimeout(500);
  const l = await local(opt);
  expect(l.dgAlarmEvents.map(e => e.alarmId).sort()).toEqual([a.id, b.id].sort());
  expect(l.dgAlarmState[a.id].firedAt).toBeGreaterThan(0);
  expect(l.dgAlarmState[b.id].firedAt).toBeGreaterThan(0);
});

test('closing one banner while another alarm fires: the new banner stays, the closed one stays closed', async ({ degiro, settings }) => {
  const a = alarm({ repeat: 'each', price: 17 }), b = alarm({ repeat: 'each', price: 17.2 });
  const opt = await seed(settings, [a, b]);
  const { page } = await degiro({ url: FAV });
  await page.waitForTimeout(400);
  await setPrice(page, 123, 17.1);
  await expect(banner(page)).toHaveCount(1);
  await page.evaluate(() => { document.querySelector('[data-dg-alarm-close]').click(); window.__setPrice(123, 17.3); });
  await expect(page.locator(`[data-dg-alarm-banner="${b.id}"]`)).toHaveCount(1);
  await page.waitForTimeout(500);
  await expect(banner(page)).toHaveCount(1);
  expect((await local(opt)).dgAlarmEvents.map(e => e.alarmId)).toEqual([b.id]);
});

test('deleting an alarm drops its stored event', async ({ degiro, settings }) => {
  const a = alarm({ repeat: 'each' }), b = alarm({ repeat: 'each', price: 19 });
  const ev = x => ({ alarmId: x.id, price: 17.4, at: Date.now() });
  const opt = await seed(settings, [a, b], { dgAlarmEvents: [ev(a), ev(b)] });
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  await expect(banner(page)).toHaveCount(2);
  await page.locator(`tr[data-dg-alarm-id="${a.id}"] [data-dg-alarm-delete]`).click();
  await expect.poll(async () => (await local(opt)).dgAlarmEvents.map(e => e.alarmId)).toEqual([b.id]);
});

test('an alarm without name and symbol is still a link on the Alarms page', async ({ degiro, settings }) => {
  const a = alarm({ name: '', symbol: '' });
  await seed(settings, [a]);
  const { page } = await degiro({ url: ALARMS });
  await expect(page.locator(`tr[data-dg-alarm-id="${a.id}"] a`)).toHaveText('#123');
});

test('the Alarms page sits where the Favourites list was: below the account summary, above the footer', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ price: 18 })]);
  const { page } = await degiro({ url: FAV });
  await page.evaluate(() => { location.hash = '#/favourites?dg=alarms'; });
  await expect(page.locator('[data-dg-alarms-page]')).toBeVisible();
  const r = await page.evaluate(() => {
    const root = document.querySelector('[data-dg-alarms-page]');
    const top = s => document.querySelector(s).getBoundingClientRect();
    return {
      next: root.previousElementSibling?.getAttribute('data-name'),
      rootTop: root.getBoundingClientRect().top, summaryBottom: top('[data-name=accountSummary]').bottom,
      rootBottom: root.getBoundingClientRect().bottom, footerTop: top('[data-name=data-vendors]').top
    };
  });
  expect(r.next).toBe('favourites');
  expect(Math.abs(r.rootTop - r.summaryBottom)).toBeLessThan(2);
  expect(r.rootBottom).toBeLessThanOrEqual(r.footerTop + 1);
});

test('the Alarm button sits on the Sell line, to its right, in both header copies', async ({ degiro }) => {
  const { page } = await degiro({ url: PRODUCT });
  await expect(alarmAll(page)).toHaveCount(2);
  for (const [id, sticky] of [['sellBtn', false], ['stickySell', true]]) {
    await page.evaluate(on => window.__stickyHeader(on), sticky);
    await page.waitForTimeout(1300);
    const r = await page.evaluate(i => {
      const s = document.getElementById(i), a = s.nextElementSibling.getBoundingClientRect(), b = s.getBoundingClientRect();
      return { sellTop: b.top, sellRight: b.right, top: a.top, left: a.left, w: a.width };
    }, id);
    expect(r.w).toBeGreaterThan(0);
    expect(Math.abs(r.top - r.sellTop)).toBeLessThanOrEqual(2);
    expect(r.left).toBeGreaterThanOrEqual(r.sellRight);
  }
});

test('a product that is not a favourite does not search the page for its header on every price tick', async ({ degiro, context }) => {
  const { page } = await degiro({ url: PRODUCT, initScript: () => { window.__MOCK_NOT_FAVOURITE = true; } });
  await page.bringToFront();
  await page.waitForTimeout(600);
  // count the header searches (each one lists every button) from inside the extension's isolated world
  const cdp = await context.newCDPSession(page);
  const contexts = [];
  cdp.on('Runtime.executionContextCreated', e => contexts.push(e.context));
  await cdp.send('Runtime.enable');
  const iso = contexts.find(c => c.origin.startsWith('chrome-extension://') && c.auxData?.type === 'isolated');
  expect(iso).toBeTruthy();
  const run = expression => cdp.send('Runtime.evaluate', { contextId: iso.id, expression, returnByValue: true });
  await run(`(() => { window.__scans = 0; const q = document.querySelectorAll;
    document.querySelectorAll = function (s) { if (s === 'button') window.__scans++; return q.call(this, s); }; })()`);
  await page.evaluate(() => {
    let k = 0;
    window.__tickTimer = setInterval(() => window.__setPrice(123, 16 + (++k % 50) / 100), 30);
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => clearInterval(window.__tickTimer));
  const scans = (await run('window.__scans')).result.value;
  expect(scans).toBeLessThanOrEqual(3);
  await expect(alarmAll(page)).toHaveCount(0);
});

test('a header that renders late is found within about a second; a star set by attribute is noticed', async ({ degiro }) => {
  const { page } = await degiro({ url: PRODUCT, initScript: () => { window.__MOCK_NOT_FAVOURITE = true; } });
  await page.waitForTimeout(500);
  await expect(alarmAll(page)).toHaveCount(0);
  await page.evaluate(() => document.querySelectorAll('.favIconCopy').forEach(i => i.setAttribute('data-name', 'icon-starFilled-20')));
  await expect(alarmAll(page)).toHaveCount(2, { timeout: 2500 });
});

test('a re-rendered header of a product that is not a favourite is searched again', async ({ degiro }) => {
  const { page } = await degiro({ url: PRODUCT, initScript: () => { window.__MOCK_NOT_FAVOURITE = true; } });
  await page.waitForTimeout(600);
  await expect(alarmAll(page)).toHaveCount(0);
  // DEGIRO re-renders the header: the old elements are detached, fresh ones inserted; then the new star is filled
  await page.evaluate(() => {
    for (const id of ['productHeader', 'stickyHeader']) {
      const el = document.getElementById(id);
      el.replaceWith(el.cloneNode(true));
    }
    document.querySelectorAll('.favIconCopy').forEach(i => i.setAttribute('data-name', 'icon-starFilled-20'));
  });
  await expect(alarmAll(page)).toHaveCount(2, { timeout: 2500 });
});

test('the price is pre-filled with all its decimals', async ({ degiro }) => {
  const { page } = await degiro({ url: PRODUCT });
  await page.bringToFront();
  await setPrice(page, 123, 0.000123);
  await page.waitForTimeout(300);
  await alarmBtn(page).click();
  await expect(page.locator('[data-dg-alarm-price]')).toHaveValue('0,000123');
});

test('Alarms page columns: Latest comes before Alarm, numbers right-aligned', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ price: 18 })]);
  const { page } = await degiro({ url: FAV });
  await page.evaluate(() => { location.hash = '#/favourites?dg=alarms'; });
  await expect(rows(page)).toHaveCount(1);
  const heads = page.locator('[data-dg-alarms-page] thead th');
  await expect(heads).toHaveText(['Product', 'Latest', 'Alarm', 'Distance', 'Repeat', 'Status', 'On', '']);
  const cells = rows(page).first().locator('td');
  await expect(cells.nth(1)).toContainText('€ 16,92');
  await expect(cells.nth(2)).toContainText('18');
  const aligns = await page.evaluate(() => [...document.querySelectorAll('[data-dg-alarms-page] thead th, [data-dg-alarms-page] tr[data-dg-alarm-id] td')].map(c => getComputedStyle(c).textAlign));
  const n = aligns.length / 2;
  for (const i of [1, 2, 3]) { expect(aligns[i]).toBe('right'); expect(aligns[n + i]).toBe('right'); }
  for (const i of [0, 4, 5]) expect(aligns[i]).not.toBe('right');
});

// ---------- Status "?" hint (Alarms page) ----------
const tipBtn = page => page.locator('[data-dg-alarms-page] thead [data-dg-alarm-tip]');
const tipBubble = page => page.locator('[data-dg-alarm-tip-bubble]');
const insideViewport = (page, loc) => loc.evaluate(e => {
  const r = e.getBoundingClientRect(), w = document.documentElement.clientWidth, h = document.documentElement.clientHeight;
  return r.left >= 0 && r.top >= 0 && r.right <= w && r.bottom <= h;
});

test('Alarms page: the Status "?" opens on hover with all five statuses and closes on leave', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ price: 18 })]);
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  await expect(tipBtn(page)).toHaveAttribute('aria-label', 'About the statuses');
  await expect(tipBubble(page)).toHaveCount(0);
  await tipBtn(page).hover();
  await expect(tipBubble(page)).toHaveCount(1);
  await expect(tipBubble(page)).toHaveAttribute('role', 'tooltip');
  await expect(tipBtn(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(tipBubble(page).locator('[data-dg-alarm-tip-line]')).toHaveCount(5);
  const text = await tipBubble(page).innerText();
  for (const s of ['Status', 'Waiting', 'Fired', 'Fired, switched off', 'Not in current list', 'No trading now']) expect(text).toContain(s);
  const css = await tipBubble(page).evaluate(e => { const c = getComputedStyle(e); return [c.backgroundColor, c.color, c.borderRadius]; });
  expect(css).toEqual(['rgb(15, 23, 26)', 'rgb(255, 255, 255)', '4px']);
  expect(await insideViewport(page, tipBubble(page))).toBe(true);
  await page.mouse.move(5, 5);
  await expect(tipBubble(page)).toHaveCount(0);
  await expect(tipBtn(page)).toHaveAttribute('aria-expanded', 'false');
});

test('Alarms page: the Status "?" opens on keyboard focus, Esc closes, a click toggles', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ price: 18 })]);
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  await tipBtn(page).focus();
  await expect(tipBubble(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(tipBubble(page)).toHaveCount(0);
  await tipBtn(page).click();
  await expect(tipBubble(page)).toHaveCount(1);
  await page.mouse.move(5, 5);
  await expect(tipBubble(page)).toHaveCount(1); // pinned by the click
  await tipBtn(page).click();
  await expect(tipBubble(page)).toHaveCount(0);
});

test('Alarms page: the Status bubble stays inside the screen on a phone and on a desktop', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ price: 18 })]);
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  for (const [w, h] of [[390, 800], [1280, 800]]) {
    await page.setViewportSize({ width: w, height: h });
    await tipBtn(page).scrollIntoViewIfNeeded();
    await page.evaluate(() => document.activeElement?.blur()); // Esc leaves the focus on the button
    await tipBtn(page).focus();
    await expect(tipBubble(page)).toHaveCount(1);
    expect(await insideViewport(page, tipBubble(page))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(tipBubble(page)).toHaveCount(0);
  }
});

test('Alarms page: an open Status bubble survives a price tick, stays single and keeps the focus', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ price: 18 })]);
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  await tipBtn(page).hover();
  await tipBtn(page).click();
  await expect(tipBubble(page)).toHaveCount(1);
  await page.mouse.move(5, 5);
  const firstRow = page.locator('tr[data-dg-alarm-id]').first().locator('td').nth(1);
  const before = await firstRow.innerText();
  await setPrice(page, 123, 16.5);
  await expect(firstRow).not.toHaveText(before); // the page was rebuilt
  await expect(tipBubble(page)).toHaveCount(1);
  await expect(tipBtn(page)).toHaveAttribute('aria-expanded', 'true');
  await tipBtn(page).focus();
  await setPrice(page, 123, 16.4);
  await page.waitForTimeout(400);
  await expect(tipBubble(page)).toHaveCount(1);
  expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-dg-alarm-tip'))).toBe(true);
});

test('Alarms page: a bubble closed with Esc stays closed across a price tick while the button keeps the focus', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ price: 18 })]);
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  await tipBtn(page).focus();
  await expect(tipBubble(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(tipBubble(page)).toHaveCount(0);
  const firstRow = page.locator('tr[data-dg-alarm-id]').first().locator('td').nth(1);
  const before = await firstRow.innerText();
  await setPrice(page, 123, 16.5);
  await expect(firstRow).not.toHaveText(before); // rebuilt
  await page.waitForTimeout(400);
  await expect(tipBubble(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-dg-alarm-tip'))).toBe(true);
});

test('Alarms page: a bubble closed by a second click stays closed across a price tick', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ price: 18 })]);
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  await tipBtn(page).click();
  await expect(tipBubble(page)).toHaveCount(1);
  await tipBtn(page).click();
  await expect(tipBubble(page)).toHaveCount(0);
  await page.mouse.move(5, 5);
  const firstRow = page.locator('tr[data-dg-alarm-id]').first().locator('td').nth(1);
  const before = await firstRow.innerText();
  await setPrice(page, 123, 16.5);
  await expect(firstRow).not.toHaveText(before);
  await page.waitForTimeout(400);
  await expect(tipBubble(page)).toHaveCount(0);
});

// ---------- Edit alarm (Alarms page) ----------
const editBtn = (page, id) => page.locator(`tr[data-dg-alarm-id="${id}"] [data-dg-alarm-edit]`);
const stateOf = (opt, id) => opt.evaluate(i => chrome.storage.local.get('dgAlarmState').then(r => (r.dgAlarmState || {})[i] || {}), id);

test('Alarms page: every row has an Edit button that opens the Edit price alarm panel, pre-filled', async ({ degiro, settings }) => {
  const a = alarm({ price: 18, repeat: 'daily' }), b = alarm({ productId: 901, name: 'Mock Oil', price: 40 });
  await seed(settings, [a, b]);
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  await expect(page.locator('[data-dg-alarm-edit]')).toHaveCount(2);
  await expect(editBtn(page, a.id)).toContainText('Edit');
  await expect(editBtn(page, a.id)).toHaveAttribute('aria-label', 'Edit alarm € 18,00');
  await editBtn(page, a.id).click();
  await expect(panelEl(page)).toBeVisible();
  await expect(panelEl(page)).toContainText('Edit price alarm');
  await expect(panelEl(page)).toContainText('Mock ETF');
  await expect(page.locator('[data-dg-alarm-price]')).toHaveValue('18,00');
  await expect(page.locator('[data-dg-alarm-repeat=daily]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-dg-alarm-repeat=once]')).toHaveAttribute('aria-pressed', 'false');
  await expect(panelEl(page)).toContainText('Latest');
  await expect(page.locator('[data-dg-alarm-hint]')).toContainText('rises to € 18,00');
  await expect(page.locator('[data-dg-alarm-row]')).toHaveCount(0); // no list of the product's alarms
  await expect(page.locator('[data-dg-alarm-set]')).toHaveText('Save');
  await expect(page.locator('[data-dg-alarm-cancel]')).toHaveText('Cancel');
});

test('Alarms page: the Edit panel subtitle is the symbol alone (no currency, no bullet)', async ({ degiro, settings }) => {
  const a = alarm({ price: 18 });
  await seed(settings, [a]);
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  await editBtn(page, a.id).click();
  await expect(panelEl(page)).toBeVisible();
  await expect(panelEl(page).getByText('Mock ETF', { exact: true }).locator('xpath=following-sibling::div[1]')).toHaveText('MOCK');
});

test('Alarms page: Save updates the alarm in place (same id and position), switches it on', async ({ degiro, settings }) => {
  const a = alarm({ price: 17, on: false }), b = alarm({ price: 19 });
  const opt = await seed(settings, [a, b], { dgAlarmState: { [a.id]: { firedAt: Date.now() - 5000, last: 16.9, lastAt: Date.now() } } });
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  await editBtn(page, a.id).click();
  await page.fill('[data-dg-alarm-price]', '15,5');
  await expect(page.locator('[data-dg-alarm-hint]')).toContainText('falls to € 15,50');
  await page.click('[data-dg-alarm-repeat=each]');
  await page.click('[data-dg-alarm-set]');
  await expect(panelEl(page)).toHaveCount(0);
  await expect.poll(() => stored(opt)).toMatchObject([{ id: a.id, productId: 123, name: 'Mock ETF', symbol: 'MOCK', currency: '€', price: 15.5, dir: 'below', repeat: 'each', on: true }, { id: b.id, price: 19 }]);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toHaveAttribute('data-dg-alarm-id', b.id); // displayed price high to low; storage keeps a first
  await expect(rows(page).last()).toHaveAttribute('data-dg-alarm-id', a.id);
  await expect(rows(page).last()).toContainText('↓ € 15,50');
  await expect(rows(page).last()).toContainText('Every time');
  await expect(page.locator(`tr[data-dg-alarm-id="${a.id}"] input[type=checkbox]`)).toBeChecked();
  await expect.poll(async () => (await stateOf(opt, a.id)).firedAt).toBeUndefined();
  expect((await stateOf(opt, a.id)).last).toBe(16.9);
});

test('Alarms page: an edited once alarm that had fired fires again at the new level', async ({ degiro, settings }) => {
  const a = alarm({ price: 17 });
  const opt = await seed(settings, [a]);
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  await setPrice(page, 123, 17.2);
  await expect(banner(page)).toHaveCount(1);
  await expect.poll(async () => (await stored(opt))[0].on).toBe(false);
  await editBtn(page, a.id).click();
  await page.fill('[data-dg-alarm-price]', '18');
  await page.click('[data-dg-alarm-set]');
  await expect(panelEl(page)).toHaveCount(0);
  await expect(banner(page)).toHaveCount(0); // its open banner goes
  await expect.poll(() => stored(opt)).toMatchObject([{ id: a.id, price: 18, dir: 'above', on: true }]);
  await page.waitForTimeout(300);
  await setPrice(page, 123, 18.1);
  await expect(banner(page)).toHaveCount(1);
  await expect(banner(page)).toContainText('Mock ETF rose to € 18,10');
});

test('Alarms page: an edited every-time alarm starts fresh, even after the old level disarmed it', async ({ degiro, settings }) => {
  const a = alarm({ price: 17, repeat: 'each' });
  const opt = await seed(settings, [a]);
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  await setPrice(page, 123, 17.2);
  await expect(banner(page)).toHaveCount(1);
  await page.locator('[data-dg-alarm-close]').click();
  await editBtn(page, a.id).click();
  await page.fill('[data-dg-alarm-price]', '17,1'); // below the price now: a new alarm
  await page.click('[data-dg-alarm-set]');
  await expect.poll(() => stored(opt)).toMatchObject([{ id: a.id, price: 17.1, dir: 'below', repeat: 'each', on: true }]);
  await page.waitForTimeout(300);
  await setPrice(page, 123, 17);
  await expect(banner(page)).toHaveCount(1);
  await expect(banner(page)).toContainText('Mock ETF fell to € 17,00');
});

test('Alarms page: Cancel, Esc, × and a click outside leave the alarm unchanged', async ({ degiro, settings }) => {
  const a = alarm({ price: 18 });
  const opt = await seed(settings, [a]);
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  for (const how of ['cancel', 'esc', 'x', 'outside']) {
    await editBtn(page, a.id).click();
    await expect(panelEl(page)).toBeVisible();
    await page.fill('[data-dg-alarm-price]', '25');
    await page.click('[data-dg-alarm-repeat=each]');
    if (how === 'cancel') await page.click('[data-dg-alarm-cancel]');
    else if (how === 'esc') await page.keyboard.press('Escape');
    else if (how === 'x') await page.click('[data-dg-alarm-x]');
    else await page.mouse.click(200, 700);
    await expect(panelEl(page)).toHaveCount(0);
  }
  expect(await stored(opt)).toMatchObject([{ id: a.id, price: 18, dir: 'above', repeat: 'once', on: true }]);
});

test('Alarms page: Save needs a price from somewhere; the last seen price is used when none is live', async ({ degiro, settings }) => {
  const g = alarm({ productId: 999, name: 'Ghost Fund', price: 30 });
  const opt = await seed(settings, [g]);
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  await editBtn(page, g.id).click();
  await expect(panelEl(page)).toContainText('Ghost Fund');
  // no live price and none seen: the alarm keeps its direction (g is 'above' by default), Save works
  await expect(page.locator('[data-dg-alarm-set]')).toBeEnabled();
  await page.fill('[data-dg-alarm-price]', '35');
  await expect(page.locator('[data-dg-alarm-msg]')).toHaveText('');
  await expect(page.locator('[data-dg-alarm-hint]')).toContainText('No current price seen yet');
  await expect(page.locator('[data-dg-alarm-set]')).toBeEnabled();
  await page.fill('[data-dg-alarm-price]', '');
  await expect(page.locator('[data-dg-alarm-set]')).toBeDisabled();
  await page.fill('[data-dg-alarm-price]', 'abc');
  await expect(page.locator('[data-dg-alarm-msg]')).toContainText('Enter a price');
  await expect(page.locator('[data-dg-alarm-set]')).toBeDisabled();
  await page.fill('[data-dg-alarm-price]', '40');
  await page.click('[data-dg-alarm-set]');
  await expect.poll(() => stored(opt)).toMatchObject([{ id: g.id, price: 40, dir: g.dir }]);
  await editBtn(page, g.id).click();
  await page.click('[data-dg-alarm-cancel]');
  await opt.evaluate(i => chrome.storage.local.set({ dgAlarmState: { [i]: { last: 25, lastAt: Date.now() } } }), g.id);
  await expect(editBtn(page, g.id)).toBeVisible();
  await editBtn(page, g.id).click();
  await expect(panelEl(page)).toContainText('Latest');
  await expect(page.locator('[data-dg-alarm-hint]')).toContainText('rises to');
  await expect(page.locator('[data-dg-alarm-set]')).toBeEnabled();
  await page.fill('[data-dg-alarm-price]', '20');
  await page.click('[data-dg-alarm-set]');
  await expect.poll(() => stored(opt)).toMatchObject([{ id: g.id, price: 20, dir: 'below' }]);
});

test('Alarms page: a save that finishes after another panel opened leaves that panel alone', async ({ degiro, settings }) => {
  const a = alarm({ price: 18 }), b = alarm({ price: 19 });
  const opt = await seed(settings, [a, b]);
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  await editBtn(page, a.id).click();
  await expect(panelEl(page)).toContainText('Mock ETF');
  await page.fill('[data-dg-alarm-price]', '20');
  // Save and, in the same tick (before the storage write answers), Edit on the other row
  await page.evaluate(id => {
    /** @type {HTMLElement} */ (document.querySelector('[data-dg-alarm-set]')).click();
    /** @type {HTMLElement} */ (document.querySelector(`tr[data-dg-alarm-id="${id}"] [data-dg-alarm-edit]`)).click();
  }, b.id);
  await expect.poll(() => stored(opt)).toMatchObject([{ id: a.id, price: 20 }, { id: b.id, price: 19 }]);
  await expect(panelEl(page)).toBeVisible();
  await expect(page.locator('[data-dg-alarm-price]')).toHaveValue('19,00');
});

test('Alarms page: deleting the alarm while its panel is open closes the panel', async ({ degiro, settings }) => {
  const a = alarm({ price: 18 });
  const opt = await seed(settings, [a]);
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  await editBtn(page, a.id).click();
  await expect(panelEl(page)).toBeVisible();
  await opt.evaluate(() => chrome.storage.sync.set({ dgAlarms: [] }));
  await expect(panelEl(page)).toHaveCount(0);
});

test('Alarms page: the Edit panel closes when the page is left and when Price alarms is switched off', async ({ degiro, settings }) => {
  const a = alarm({ price: 18 });
  await seed(settings, [a]);
  const { page } = await degiro({ url: ALARMS });
  const opt = await settings();
  await page.bringToFront();
  await editBtn(page, a.id).click();
  await expect(panelEl(page)).toBeVisible();
  await page.waitForTimeout(1300); // the panel survives the page's own runs
  await expect(panelEl(page)).toBeVisible();
  await page.evaluate(() => { location.hash = '#/favourites'; });
  await expect(panelEl(page)).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/favourites?dg=alarms'; });
  await editBtn(page, a.id).click();
  await expect(panelEl(page)).toBeVisible();
  await setFlag(opt, 'priceAlarms', false);
  await expect(panelEl(page)).toHaveCount(0);
});

test('Alarms page: keyboard focus on Edit survives a price tick; a press on Edit is not eaten by one', async ({ degiro, settings }) => {
  const a = alarm({ price: 18 });
  await seed(settings, [a]);
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  await editBtn(page, a.id).focus();
  await setPrice(page, 123, 16.5);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-dg-alarm-edit'))).toBe(true);
  await editBtn(page, a.id).hover();
  await page.mouse.down();
  await setPrice(page, 123, 16.6);
  await page.waitForTimeout(300);
  await page.mouse.up();
  await expect(panelEl(page)).toBeVisible();
});

// toggle switches (DEGIRO style) instead of plain checkboxes
const knobOf = sw => sw.locator('xpath=..').locator('span').nth(1);
const trackOf = sw => sw.locator('xpath=..').locator('span').first();

test('Alarms page: the On control is a switch; clicking the track toggles it, Space too; knob and track change', async ({ degiro, settings }) => {
  const a = alarm();
  const opt = await seed(settings, [a]);
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  const sw = page.getByRole('switch');
  await expect(sw).toHaveCount(1);
  await expect(sw).toBeChecked();
  expect(await trackOf(sw).evaluate(e => getComputedStyle(e).width)).toBe('40px');
  await expect(knobOf(sw)).toHaveCSS('left', '20px');
  await expect(trackOf(sw)).toHaveCSS('background-color', 'rgb(0, 149, 210)');
  await sw.locator('xpath=..').click(); // the label: the visible track and knob
  await expect.poll(() => stored(opt)).toMatchObject([{ id: a.id, on: false }]);
  await expect(sw).not.toBeChecked();
  await expect(knobOf(sw)).toHaveCSS('left', '4px');
  await expect(trackOf(sw)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await sw.focus();
  await page.keyboard.press('Space');
  await expect.poll(() => stored(opt)).toMatchObject([{ id: a.id, on: true }]);
  // focus survives a price tick
  await setPrice(page, 123, 16.5);
  await page.waitForTimeout(300);
  await expect(page.getByRole('switch')).toBeFocused();
});

test('panel: the alarm list uses the same switches; clicking the track toggles the alarm', async ({ degiro, settings }) => {
  const a = alarm({ id: 'p1' });
  const opt = await seed(settings, [a]);
  const { page } = await degiro({ url: PRODUCT });
  await page.bringToFront();
  await alarmBtn(page).click();
  const sw = page.locator('[data-dg-alarm-row=p1]').getByRole('switch');
  await expect(sw).toBeChecked();
  await expect(knobOf(sw)).toHaveCSS('left', '20px');
  await sw.locator('xpath=..').click(); // the label: the visible track and knob
  await expect.poll(() => stored(opt)).toMatchObject([{ id: 'p1', on: false }]);
  await expect(sw).not.toBeChecked();
  await expect(knobOf(sw)).toHaveCSS('left', '4px');
  await sw.focus();
  await page.keyboard.press('Space');
  await expect.poll(() => stored(opt)).toMatchObject([{ id: 'p1', on: true }]);
});
