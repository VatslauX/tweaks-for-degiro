// Price alarms: button and panel (product page), detection and banners, the Alarms page.
// Logic-only tests have moved to tests/integration/alarm-panel.test.js.
// Stays here: Settings page, network interception, layout (getBoundingClientRect, visible=true,
// textAlign), sticky header visibility, mouse.down/up press-during-click, CDP scan count,
// real timing, and a set of smoke tests that verify the full browser stack.
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

// smoke: end-to-end firing in a real browser tab
test('Favourites: a price past the alarm shows a banner; a once alarm switches itself off', async ({ degiro, settings }) => {
  const opt = await seed(settings, [alarm({ price: 17 })]);
  const { page } = await degiro({ url: FAV });
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
  await setPrice(page, 123, 17.6);
  await expect(banner(page)).toHaveCount(0);
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

test('the alarm feature makes no network requests', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ repeat: 'each' })]);
  const { page } = await degiro({ url: FAV });
  const urls = [];
  page.on('request', r => urls.push(r.url()));
  await setPrice(page, 123, 17.4);
  await expect(banner(page)).toHaveCount(1);
  await page.locator('[data-dg-alarm-close]').click();
  // Observe an actual window after closing; the assertion is that no unrelated request is sent during it.
  await page.waitForTimeout(500);
  // DEGIRO's own polling (orders.js, the mock) may run; nothing else may
  expect(urls.filter(u => !/\/(trading|login|pa|portfolio-metrics)\/secure|\/mock\//.test(u))).toEqual([]);
});

const alarmAll = page => page.locator('[data-dg-alarm-button]'); // one per header copy
const alarmBtn = page => alarmAll(page).locator('visible=true'); // the copy DEGIRO shows

// stays in Playwright: visible=true needs CSS layout
test('sticky header copy: its Alarm button is shown and opens the panel', async ({ degiro }) => {
  const { page } = await degiro({ url: PRODUCT });
  await expect(alarmAll(page)).toHaveCount(2);
  await page.evaluate(() => window.__stickyHeader(true));
  await expect(alarmBtn(page)).toHaveCount(1);
  await alarmBtn(page).click();
  await expect(page.locator('[data-dg-alarm-panel="123"]')).toBeVisible();
});

// stays in Playwright: initScript with DOMContentLoaded cannot be replicated via harness globals
test('currency missing at first: the header is read again once the price has its sign', async ({ degiro, settings }) => {
  const opt = await settings();
  const { page } = await degiro({ url: PRODUCT, initScript: () => addEventListener('DOMContentLoaded', () => document.querySelectorAll('[data-field=CurrentPrice]').forEach(e => { e.textContent = e.textContent.replace('€', ''); })) });
  await page.bringToFront();
  await expect(page.locator('[data-field=CurrentPrice]').first()).not.toContainText('€');
  await setPrice(page, 123, 16.92);
  // The feature rechecks a header whose currency was missing on first discovery.
  await page.waitForTimeout(1300);
  await alarmBtn(page).click();
  await expect(page.locator('[data-dg-alarm-panel]')).toContainText('Latest € 16,92');
  await page.fill('[data-dg-alarm-price]', '18');
  await page.click('[data-dg-alarm-set]');
  await expect.poll(() => stored(opt)).toMatchObject([{ currency: '€' }]);
});

const rows = page => page.locator('[data-dg-alarms-page] tr[data-dg-alarm-id]');

// stays in Playwright: getBoundingClientRect
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
  await expect.poll(() => page.evaluate(() => {
    const m = document.querySelector('[data-dg-alarms-page] [role=listbox]').getBoundingClientRect();
    const main = document.querySelector('main#mainContent').getBoundingClientRect();
    return m.left >= 0 && m.right <= innerWidth && m.left >= main.left && m.right <= main.right;
  })).toBe(true);
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

// stays in Playwright: mouse.down() / mouse.up() during a price tick
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
  await expect(rows(page).first().locator('td').nth(1)).toContainText('16,50'); // the price tick rebuilt the row while pressed
  await page.mouse.up();
  await expect.poll(() => stored(opt)).toMatchObject([{ id: a.id, on: false }]);
});

const local = opt => opt.evaluate(() => chrome.storage.local.get(['dgAlarmState', 'dgAlarmEvents']));

// smoke: multi-tab banner behaviour in a real browser
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
  await setPrice(page, 123, 17.1);
  await setPrice(page, 123, 17.3);
  await expect(banner(page)).toHaveCount(2);
  await expect.poll(() => local(opt)).toMatchObject({
    dgAlarmEvents: expect.arrayContaining([expect.objectContaining({ alarmId: a.id }), expect.objectContaining({ alarmId: b.id })]),
    dgAlarmState: expect.objectContaining({ [a.id]: expect.objectContaining({ firedAt: expect.any(Number) }), [b.id]: expect.objectContaining({ firedAt: expect.any(Number) }) })
  });
  const l = await local(opt);
  expect(l.dgAlarmEvents.map(e => e.alarmId).sort()).toEqual([a.id, b.id].sort());
  expect(l.dgAlarmState[a.id].firedAt).toBeGreaterThan(0);
  expect(l.dgAlarmState[b.id].firedAt).toBeGreaterThan(0);
});

test('closing one banner while another alarm fires: the new banner stays, the closed one stays closed', async ({ degiro, settings }) => {
  const a = alarm({ repeat: 'each', price: 17 }), b = alarm({ repeat: 'each', price: 17.2 });
  const opt = await seed(settings, [a, b]);
  const { page } = await degiro({ url: FAV });
  await setPrice(page, 123, 17.1);
  await expect(banner(page)).toHaveCount(1);
  await page.evaluate(() => { document.querySelector('[data-dg-alarm-close]').click(); window.__setPrice(123, 17.3); });
  await expect(page.locator(`[data-dg-alarm-banner="${b.id}"]`)).toHaveCount(1);
  await expect.poll(async () => (await local(opt)).dgAlarmEvents.map(e => e.alarmId)).toEqual([b.id]);
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

// stays in Playwright: getBoundingClientRect
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

// stays in Playwright: getBoundingClientRect
test('the Alarm button sits on the Sell line, to its right, in both header copies', async ({ degiro }) => {
  const { page } = await degiro({ url: PRODUCT });
  await expect(alarmAll(page)).toHaveCount(2);
  for (const [id, sticky] of [['sellBtn', false], ['stickySell', true]]) {
    await page.evaluate(on => window.__stickyHeader(on), sticky);
    await expect.poll(() => page.evaluate(i => {
      const s = document.getElementById(i), a = s.nextElementSibling.getBoundingClientRect(), b = s.getBoundingClientRect();
      return a.width > 0 && Math.abs(a.top - b.top) <= 2 && a.left >= b.right;
    }, id)).toBe(true);
    const r = await page.evaluate(i => {
      const s = document.getElementById(i), a = s.nextElementSibling.getBoundingClientRect(), b = s.getBoundingClientRect();
      return { sellTop: b.top, sellRight: b.right, top: a.top, left: a.left, w: a.width };
    }, id);
    expect(r.w).toBeGreaterThan(0);
    expect(Math.abs(r.top - r.sellTop)).toBeLessThanOrEqual(2);
    expect(r.left).toBeGreaterThanOrEqual(r.sellRight);
  }
});

// stays in Playwright: CDP
test('a product that is not a favourite does not search the page for its header on every price tick', async ({ degiro, context }) => {
  const { page } = await degiro({ url: PRODUCT, initScript: () => { window.__MOCK_NOT_FAVOURITE = true; } });
  await page.bringToFront();
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

// stays in Playwright: real timing (extension must react within ~1 s)
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

// stays in Playwright: getComputedStyle textAlign
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

// stays in Playwright: getBoundingClientRect, getComputedStyle, dark theme
const dark = () => {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.style.background = '#0f171a';
    document.body.style.color = '#f3f7f9';
  });
};
const BLUE_RGB = 'rgb(0, 149, 210)';

test('the On switch is sized and coloured like a track-and-knob toggle, on and off', async ({ degiro, settings }) => {
  const a = alarm({ on: true }), b = alarm({ on: false });
  await seed(settings, [a, b]);
  const { page } = await degiro({ url: ALARMS });
  const onSw = page.locator(`tr[data-dg-alarm-id="${a.id}"] input[type=checkbox]`);
  const offSw = page.locator(`tr[data-dg-alarm-id="${b.id}"] input[type=checkbox]`);
  await expect(onSw).toBeVisible();
  const box = await onSw.boundingBox();
  expect(box.width).toBeCloseTo(32, 0);
  expect(box.height).toBeCloseTo(18, 0);
  const onColour = await onSw.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(onColour).toBe(BLUE_RGB);
  const offColour = await offSw.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(offColour).not.toBe(BLUE_RGB);
  // the knob is drawn as a radial-gradient image, not a pseudo-element
  const image = await onSw.evaluate(el => getComputedStyle(el).backgroundImage);
  expect(image).toContain('radial-gradient');
});

test('the On switch follows the dark theme and stays visible when disabled', async ({ degiro, settings }) => {
  const a = alarm({ on: true });
  await seed(settings, [a]);
  const { page } = await degiro({ url: ALARMS, initScript: dark });
  const sw = page.locator(`tr[data-dg-alarm-id="${a.id}"] input[type=checkbox]`);
  await expect(sw).toBeVisible();
  const onColour = await sw.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(onColour).toBe(BLUE_RGB);
  const opacity = await sw.evaluate(el => { el.disabled = true; return getComputedStyle(el).opacity; });
  expect(Number(opacity)).toBeGreaterThan(0);
});

test('clicking the switch still toggles the alarm', async ({ degiro, settings }) => {
  const a = alarm({ on: true });
  const opt = await seed(settings, [a]);
  const { page } = await degiro({ url: ALARMS });
  const sw = page.locator(`tr[data-dg-alarm-id="${a.id}"] input[type=checkbox]`);
  await expect(sw).toBeChecked();
  await sw.click();
  await expect(sw).not.toBeChecked();
  await expect.poll(() => stored(opt)).toMatchObject([{ id: a.id, on: false }]);
});

test('the Status cell shows a coloured pill: waiting, fired, off, not in list', async ({ degiro, settings }) => {
  const waiting = alarm({ productId: 123, on: true });
  const fired = alarm({ productId: 123, on: true, price: 16 });
  const off = alarm({ productId: 123, on: false });
  const unseen = alarm({ productId: 999, on: true });
  const opt = await seed(settings, [waiting, fired, off, unseen],
    { dgAlarmState: { [fired.id]: { firedAt: Date.now() }, [off.id]: { firedAt: Date.now() } } });
  const { page } = await degiro({ url: ALARMS });
  await page.bringToFront();
  await expect(rows(page)).toHaveCount(4);
  const pill = id => page.locator(`tr[data-dg-alarm-id="${id}"] [data-dg-alarm-status] span`);
  const colour = async id => pill(id).evaluate(el => getComputedStyle(el).color);
  const bg = async id => pill(id).evaluate(el => getComputedStyle(el).backgroundColor);
  await expect(pill(waiting.id)).toHaveText('Waiting');
  const waitColour = await colour(waiting.id);
  expect(waitColour).toBe(BLUE_RGB);
  await expect(pill(fired.id)).toContainText('Fired');
  const firedColour = await colour(fired.id);
  expect(firedColour).not.toBe(waitColour);
  await expect(pill(off.id)).toContainText('off');
  await expect(pill(unseen.id)).toHaveText('Not in current list');
  const offColour = await colour(off.id), unseenColour = await colour(unseen.id);
  expect(offColour).toBe(unseenColour);
  expect(offColour).not.toBe(waitColour);
  expect(offColour).not.toBe(firedColour);
  // backgrounds stay distinct, which is how waiting/fired read against off/unseen
  expect(await bg(waiting.id)).not.toBe(await bg(off.id));
  void opt;
});

test('the delete control is an svg icon with the delete label kept', async ({ degiro, settings }) => {
  const a = alarm();
  await seed(settings, [a]);
  const { page } = await degiro({ url: ALARMS });
  const del = page.locator(`tr[data-dg-alarm-id="${a.id}"] [data-dg-alarm-delete]`);
  await expect(del).toHaveAttribute('aria-label', 'Delete alarm');
  await expect(del.locator('svg')).toHaveCount(1);
  await expect(del).not.toHaveText('×');
});
