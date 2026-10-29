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
