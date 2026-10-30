// Price alarms: panel (degiro fixture), Alarms page, Edit alarm — logic-only tests without a browser.
// Stays in Playwright: network interception, layout (button/menu position, page bounds, textAlign),
// sticky header visibility (CSS layout), computed colours, CDP scan count, mouse.down/up mid-click,
// currency-missing timing (initScript/DOMContentLoaded cannot be replicated via globals).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorld, alarm } = require('./harness');

// ---------- helpers ----------
const events  = w   => w.stored('local').dgAlarmEvents  || [];
const stateOf = (w, id) => (w.stored('local').dgAlarmState || {})[id] || {};
const listOf  = w   => w.stored('sync').dgAlarms || [];
const banners = tab => tab.$$('[data-dg-alarm-banner]').map(b => b.getAttribute('data-dg-alarm-banner'));
const noErrors = w  => assert.deepEqual(w.errors.map(e => e.stack || String(e)), []);
const buttons  = tab => tab.$$('[data-dg-alarm-button]');
const panel    = tab => tab.$('[data-dg-alarm-panel]');
const alarmRows   = tab => tab.$$('[data-dg-alarm-row]');
const alarmPageRows = tab => tab.$$('tr[data-dg-alarm-id]');

/** Fill a text input and fire the 'input' event the panel uses. */
function fill(tab, sel, val) {
  const el = tab.$(sel);
  el.value = val;
  el.dispatchEvent(new tab.window.InputEvent('input', { bubbles: true }));
}

async function priceAt(tab, id, v, ms = 200) {
  tab.setPrice(id, v);
  await tab.world.advance(ms);
}

/** Open the Favourites page with pre-seeded alarms. */
async function setupFav(alarms_ = [], localStore = {}, globals = {}) {
  const w = createWorld({ storage: { sync: { dgAlarms: alarms_ }, local: localStore } });
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites', globals });
  await w.advance(200);
  w.log.length = 0;
  return { w, tab };
}

/** Open the Alarms page with pre-seeded alarms. */
async function setupAlarmsPage(alarms_ = [], localStore = {}) {
  const w = createWorld({ storage: { sync: { dgAlarms: alarms_ }, local: localStore } });
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites?dg=alarms' });
  await w.advance(200);
  w.log.length = 0;
  return { w, tab };
}

/** Open the product page with pre-seeded alarms. */
async function setupProduct(alarms_ = [], globals = {}) {
  const w = createWorld({ storage: { sync: { dgAlarms: alarms_ } } });
  // __MOCK_NO_URL_SESSION: suppresses the fetch() the fixture calls (jsdom has no fetch).
  // Highcharts: degiro.html creates a chart in its inline script; jsdom won't load the external
  //   <script src>, so Highcharts must be stubbed to avoid a ReferenceError.
  const Highcharts = { Chart: function() { const s = { setData() {}, data: [{ update() {} }] }; return { series: [s] }; } };
  const tab = await w.open({ fixture: 'degiro', hash: '/products/123/overview',
    globals: { __MOCK_NO_URL_SESSION: true, Highcharts, ...globals } });
  await w.advance(200);
  return { w, tab };
}

// ============================================================
// BANNER / DETECTION (not already in alarms.test.js)
// ============================================================

test('thousands separators and prices without a title', async () => {
  const a = alarm({ productId: 456, name: 'Mock Tech Inc. Class A', currency: '$', price: 1250 });
  const { w, tab } = await setupFav([a], {}, { __MOCK_NO_TITLE: true });
  // 1.248,26 is below 1.250
  assert.equal(banners(tab).length, 0, 'no banner before the price passes');
  await priceAt(tab, 456, 1250.5);
  assert.equal(banners(tab).length, 1);
  assert.ok(tab.$('[data-dg-alarm-banner]').textContent.includes('Mock Tech Inc. Class A'));
  assert.ok(tab.$('[data-dg-alarm-banner]').textContent.includes('1.250,50'));
  noErrors(w);
});

test('names from storage stay text in the banner (XSS guard)', async () => {
  const a = alarm({ name: '<img src=x onerror="window.__xss=1">' });
  const { w, tab } = await setupFav([a]);
  await priceAt(tab, 123, 17.4);
  assert.equal(banners(tab).length, 1);
  assert.ok(tab.$('[data-dg-alarm-banner]').textContent.includes('<img src=x'));
  assert.equal(tab.window.__xss, undefined, 'script did not run');
  noErrors(w);
});

for (const repeat of ['each', 'daily']) {
  test(`two tabs that disagree about the price do not loop (${repeat})`, async () => {
    const a = alarm({ repeat });
    const w = createWorld();
    await w.set('sync', { dgAlarms: [a] });
    const A = await w.open({ fixture: 'favourites', hash: '/favourites' });
    await w.open({ fixture: 'favourites', hash: '/favourites' }); // B: stays below, does not fire
    await w.advance(200);
    // A fires; B stays below
    A.setPrice(123, 17.4); // B keeps 16.92
    await w.advance(2000);
    assert.equal(banners(A).length, 1);
    // Advance further — no second write should happen
    const countBefore = w.log.filter(l => l.keys.includes('dgAlarmEvents')).length;
    await w.advance(1500);
    assert.equal(
      w.log.filter(l => l.keys.includes('dgAlarmEvents')).length,
      countBefore,
      'no additional event writes after the initial firing'
    );
    noErrors(w);
  });
}

test('every time: a reload while the price is still past the alarm does not fire again', async () => {
  const a = alarm({ repeat: 'each' });
  const { w, tab } = await setupFav([a]);
  await priceAt(tab, 123, 17.4, 500);
  assert.equal(banners(tab).length, 1);
  tab.$('[data-dg-alarm-close]').click();
  await w.advance(200);
  assert.equal(banners(tab).length, 0);
  const stBefore = stateOf(w, a.id);
  assert.ok(stBefore.firedAt);

  // Simulate reload: new world inheriting stored state + price already above alarm
  const w2 = createWorld({ storage: { sync: w.stored('sync'), local: w.stored('local') } });
  await w2.open({ fixture: 'favourites', hash: '/favourites', globals: { __MOCK_PRICES: { 123: 17.4 } } });
  await w2.advance(1200);
  assert.equal((w2.stored('local').dgAlarmEvents || []).length, 0, 'no new event after reload');
  assert.equal(stateOf(w2, a.id).firedAt, stBefore.firedAt, 'firedAt unchanged');
  noErrors(w2);
});

test('once: switching off keeps an alarm another tab added meanwhile', async () => {
  const first = alarm();
  const { w, tab } = await setupFav([first]);
  await w.advance(200);
  // Another tab adds a second alarm
  const extra = alarm({ id: 'al-extra', productId: 789, name: 'Mock Chips ETF' });
  await w.set('sync', { dgAlarms: [...listOf(w), extra] });
  await w.advance(100);
  // The original alarm fires and switches itself off
  await priceAt(tab, 123, 17.4);
  await w.advance(300);
  assert.equal(banners(tab).length, 1);
  await w.advance(200);
  const stored = listOf(w);
  assert.ok(stored.find(a => a.id === extra.id), 'extra alarm kept');
  assert.equal(stored.find(a => a.id === first.id).on, false, 'first alarm off');
  noErrors(w);
});

// ============================================================
// ALARM BUTTON (DOM, no layout)
// ============================================================

test('Alarm button: only for a favourite, right after Sell; follows the star', async () => {
  const { w, tab } = await setupProduct();
  assert.equal(buttons(tab).length, 2, 'two copies of the product header → two buttons');
  // right after #sellBtn
  assert.ok(tab.$('#sellBtn').nextElementSibling?.hasAttribute('data-dg-alarm-button'), 'button follows #sellBtn');
  // unstar → buttons gone
  tab.$('#favStar').click();
  await w.advance(1300);
  assert.equal(buttons(tab).length, 0, 'no button after unstarring');
  // re-star → buttons back
  tab.$('#favStar').click();
  await w.advance(1300);
  assert.equal(buttons(tab).length, 2, 'buttons restored after re-starring');
  noErrors(w);
});

test('two header copies: one Alarm button each, right after its own Sell', async () => {
  const { w, tab } = await setupProduct();
  assert.equal(buttons(tab).length, 2);
  assert.ok(tab.$('#sellBtn').nextElementSibling?.hasAttribute('data-dg-alarm-button'), '#sellBtn → button');
  assert.ok(tab.$('#stickySell').nextElementSibling?.hasAttribute('data-dg-alarm-button'), '#stickySell → button');
  noErrors(w);
});

test('unstarring removes the buttons of both header copies', async () => {
  const { w, tab } = await setupProduct();
  assert.equal(buttons(tab).length, 2);
  tab.$('#stickyStar').click();
  await w.advance(1300);
  assert.equal(buttons(tab).length, 0, 'unstarring sticky star removes all buttons');
  noErrors(w);
});

test('no Alarm button for a product that is not a favourite', async () => {
  const { w, tab } = await setupProduct([], { __MOCK_NOT_FAVOURITE: true });
  await w.advance(500);
  assert.equal(buttons(tab).length, 0, 'no button when not a favourite');
  noErrors(w);
});

test("with DEGIRO's Place order panel open it gets no button; the header copies keep theirs", async () => {
  const { w, tab } = await setupProduct([], { __MOCK_ORDER_PANEL: true });
  assert.equal(buttons(tab).length, 2, 'header copies have buttons');
  assert.equal(tab.$$('#mockOrderPanel [data-dg-alarm-button]').length, 0, 'order panel has no button');
  noErrors(w);
});

// ============================================================
// ALARM PANEL (set alarm)
// ============================================================

test('sets an alarm above the current price; the order form is never touched', async () => {
  const { w, tab } = await setupProduct();
  // open panel
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  assert.ok(panel(tab), 'panel opened');
  // price is pre-filled
  assert.match(tab.$('[data-dg-alarm-price]').value, /16[,.]92/);
  // fill 18, pick daily, save
  fill(tab, '[data-dg-alarm-price]', '18');
  await w.advance(100);
  tab.$('[data-dg-alarm-repeat=daily]').click();
  await w.advance(100);
  tab.$('[data-dg-alarm-set]').click();
  await w.advance(500);
  const stored = listOf(w);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].productId, 123);
  assert.equal(stored[0].price, 18);
  assert.equal(stored[0].dir, 'above');
  assert.equal(stored[0].repeat, 'daily');
  assert.equal(stored[0].on, true);
  assert.equal(stored[0].name, 'Mock ETF');
  assert.equal(stored[0].currency, '€');
  // button shows count badge
  const btnText = buttons(tab)[0].textContent;
  assert.ok(btnText.includes('Alarm'), 'button includes label');
  assert.ok(buttons(tab)[0].querySelector('[data-dg-alarm-count]')?.textContent.includes('1'), 'badge shows count 1');
  // order form was never touched
  assert.equal(tab.window.__log.filter(x => /BUY|SELL|CONFIRM/.test(x)).length, 0);
  noErrors(w);
});

test('Alarm button has accessible name with count; badge is aria-hidden', async () => {
  const { w, tab } = await setupProduct();
  const btn = buttons(tab)[0];
  // before any alarm: no aria-label
  assert.equal(btn.getAttribute('aria-label'), null, 'no aria-label before alarm set');
  // set an alarm
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  fill(tab, '[data-dg-alarm-price]', '18');
  await w.advance(100);
  tab.$('[data-dg-alarm-set]').click();
  await w.advance(500);
  // button now has aria-label with count
  assert.equal(btn.getAttribute('aria-label'), 'Alarm, 1 switched on');
  // badge is aria-hidden
  const badge = btn.querySelector('[data-dg-alarm-count]');
  assert.equal(badge?.getAttribute('aria-hidden'), 'true', 'badge is aria-hidden');
  // set a second alarm
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  fill(tab, '[data-dg-alarm-price]', '15');
  await w.advance(100);
  tab.$('[data-dg-alarm-set]').click();
  await w.advance(500);
  // aria-label updated to count 2
  assert.equal(btn.getAttribute('aria-label'), 'Alarm, 2 switched on');
  // switch off first alarm
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  const toggles = tab.$$('[data-dg-alarm-row] input[type=checkbox]');
  toggles[0].checked = false;
  toggles[0].dispatchEvent(new tab.window.Event('change', { bubbles: true }));
  await w.advance(300);
  // aria-label updated to count 1
  assert.equal(btn.getAttribute('aria-label'), 'Alarm, 1 switched on');
  // switch off the other one too: no count, no aria-label
  const rest = tab.$$('[data-dg-alarm-row] input[type=checkbox]').find(i => i.checked);
  assert.ok(rest, 'one alarm still on');
  rest.checked = false;
  rest.dispatchEvent(new tab.window.Event('change', { bubbles: true }));
  await w.advance(300);
  assert.equal(btn.getAttribute('aria-label'), null);
  assert.equal(btn.querySelector('[data-dg-alarm-count]'), null);
  tab.$('[data-dg-alarm-x]').click();
  await w.advance(100);
  noErrors(w);
});

test('an alarm set while the price cell shows a dash keeps a clean currency', async () => {
  // market closed: every copy of the price cell reads "$ —" from the start, the title keeps the last price
  const { w, tab } = await setupProduct([], { __MOCK_PRICE_DASH: true });
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  assert.ok(panel(tab), 'panel opened');
  fill(tab, '[data-dg-alarm-price]', '18');
  await w.advance(100);
  tab.$('[data-dg-alarm-set]').click();
  await w.advance(500);
  assert.equal(listOf(w).length, 1);
  assert.equal(listOf(w)[0].currency, '$');
  noErrors(w);
});

test('refuses an equal or invalid price', async () => {
  const { w, tab } = await setupProduct();
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  // equal price
  fill(tab, '[data-dg-alarm-price]', '16,92');
  await w.advance(100);
  assert.ok(tab.$('[data-dg-alarm-msg]').textContent.includes('current price'), 'equal price error shown');
  assert.ok(tab.$('[data-dg-alarm-set]').disabled, 'Set disabled for equal price');
  // invalid
  fill(tab, '[data-dg-alarm-price]', 'abc');
  await w.advance(100);
  assert.ok(tab.$('[data-dg-alarm-set]').disabled, 'Set disabled for invalid input');
  // valid below
  fill(tab, '[data-dg-alarm-price]', '15,5');
  await w.advance(100);
  assert.ok(tab.$('[data-dg-alarm-hint]').textContent.includes('falls to'), 'hint says falls to');
  assert.ok(!tab.$('[data-dg-alarm-set]').disabled, 'Set enabled for valid below price');
  noErrors(w);
});

test('the panel closes with ×, Esc and a click outside', async () => {
  const { w, tab } = await setupProduct();
  // close with ×
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  assert.ok(panel(tab), 'panel open');
  tab.$('[data-dg-alarm-x]').click();
  await w.advance(100);
  assert.equal(panel(tab), null, 'panel closed by ×');
  // close with Escape
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  tab.document.dispatchEvent(new tab.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await w.advance(100);
  assert.equal(panel(tab), null, 'panel closed by Escape');
  // close with click outside
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  tab.$('#outside').dispatchEvent(new tab.window.MouseEvent('mousedown', { bubbles: true }));
  await w.advance(100);
  assert.equal(panel(tab), null, 'panel closed by click outside');
  noErrors(w);
});

test('switch and delete in the panel; at most 25 alarms', async () => {
  const alarms25 = Array.from({ length: 25 }, (_, i) => alarm({ id: 'm' + i, price: 20 + i }));
  const { w, tab } = await setupProduct(alarms25);
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  fill(tab, '[data-dg-alarm-price]', '18');
  await w.advance(100);
  tab.$('[data-dg-alarm-set]').click();
  await w.advance(300);
  assert.ok(tab.$('[data-dg-alarm-msg]').textContent.includes('25'), 'full-list message shown');
  // switch off m0
  const cb = tab.$('[data-dg-alarm-row=m0] input[type=checkbox]');
  cb.checked = false;
  cb.dispatchEvent(new tab.window.Event('change', { bubbles: true }));
  await w.advance(300);
  assert.equal(listOf(w).find(a => a.id === 'm0').on, false, 'm0 switched off in storage');
  // delete m1
  tab.$('[data-dg-alarm-row=m1] [data-dg-alarm-delete]').click();
  await w.advance(300);
  assert.equal(listOf(w).length, 24, 'alarm deleted from storage');
  noErrors(w);
});

test('switching Price alarms off closes the panel and removes the button', async () => {
  const { w, tab } = await setupProduct();
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  assert.ok(panel(tab), 'panel open');
  await tab.setFlag('priceAlarms', false);
  await w.advance(300);
  assert.equal(panel(tab), null, 'panel closed when flag off');
  assert.equal(buttons(tab).length, 0, 'buttons removed when flag off');
  await tab.setFlag('priceAlarms', true);
  await w.advance(1300);
  assert.ok(buttons(tab).length > 0, 'buttons return when flag on');
  noErrors(w);
});

test('after an in-place product change the button opens the panel for the new product', async () => {
  const { w, tab } = await setupProduct();
  // open and close the panel for 123
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  tab.$('[data-dg-alarm-x]').click();
  await w.advance(100);
  // simulate DEGIRO navigating to product 456 in the same tab
  await tab.go('#/products/456/overview');
  tab.$$('#productHeader [data-id], #stickyHeader [data-id]').forEach(e => e.setAttribute('data-id', '456'));
  tab.$$('[data-name=productName]').forEach(n => { n.setAttribute('title', 'Mock Tech'); n.textContent = 'Mock Tech'; });
  tab.$$('[data-field=CurrentPrice]').forEach(e => e.setAttribute('data-id', '456'));
  await w.advance(1300);
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  assert.ok(tab.$('[data-dg-alarm-panel="456"]'), 'panel for new product 456');
  noErrors(w);
});

test('a stale equal-price message goes when the price moves; an untouched prefill shows none', async () => {
  const { w, tab } = await setupProduct();
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  // no message before typing
  assert.equal(tab.$('[data-dg-alarm-msg]').textContent, '', 'no message on open');
  // equal price → error
  fill(tab, '[data-dg-alarm-price]', '16,92');
  await w.advance(100);
  assert.ok(tab.$('[data-dg-alarm-msg]').textContent.includes('current price'), 'equal-price error shown');
  // price moves → error clears
  await priceAt(tab, 123, 17.5, 1300);
  assert.equal(tab.$('[data-dg-alarm-msg]').textContent, '', 'message clears after price move');
  assert.ok(!tab.$('[data-dg-alarm-set]').disabled, 'Set enabled again');
  noErrors(w);
});

test('a double click on Set saves one alarm', async () => {
  const { w, tab } = await setupProduct();
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  fill(tab, '[data-dg-alarm-price]', '18');
  await w.advance(100);
  // two rapid clicks before advancing (simulates dblclick)
  const btn = tab.$('[data-dg-alarm-set]');
  btn.click(); btn.click();
  await w.advance(500);
  assert.equal(listOf(w).length, 1, 'only one alarm saved despite double click');
  noErrors(w);
});

test('unstarring the product closes the panel', async () => {
  const { w, tab } = await setupProduct();
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  assert.ok(panel(tab), 'panel open');
  tab.$('#favStar').click();
  await w.advance(1300);
  assert.equal(panel(tab), null, 'panel closed after unstarring');
  assert.equal(buttons(tab).length, 0, 'buttons removed after unstarring');
  noErrors(w);
});

// ============================================================
// ALARMS PAGE
// ============================================================

test('the sidebar link opens the Alarms page over Favourites; the address stays', async () => {
  const al = [alarm({ price: 18 }), alarm({ productId: 901, name: 'Mock Oil', price: 40 })];
  const { w, tab } = await setupFav(al);
  await tab.go('/favourites?dg=alarms');
  assert.ok(tab.$('[data-dg-alarms-page]'), 'Alarms page visible');
  // The extension hides Favourites via an owned <style> element (jsdom has no CSS engine).
  const hideStyle = tab.$$('style[data-dg-own]').find(s => s.textContent.includes('favourites'));
  assert.ok(hideStyle, 'Favourites hiding stylesheet inserted');
  assert.equal(tab.window.location.hash, '#/favourites?dg=alarms', 'hash stays');
  assert.equal(alarmPageRows(tab).length, 2);
  assert.ok(alarmPageRows(tab)[0].textContent.includes('Mock ETF'));
  // go back to favourites
  await tab.go('/favourites');
  assert.equal(tab.$('[data-dg-alarms-page]'), null, 'Alarms page gone');
  noErrors(w);
});

test('alarms keep firing while the Alarms page is open', async () => {
  const a = alarm();
  const { w, tab } = await setupAlarmsPage([a]);
  await priceAt(tab, 123, 17.3);
  assert.equal(banners(tab).length, 1, 'banner shown on Alarms page');
  assert.ok(tab.$('[data-dg-alarm-status]')?.textContent.includes('Fired'), 'row shows Fired status');
  noErrors(w);
});

test('switches and delete on the Alarms page persist (survive a reload)', async () => {
  const a = alarm(), b = alarm({ price: 19 });
  const { w, tab } = await setupAlarmsPage([a, b]);
  // switch a off
  const cb = tab.$(`tr[data-dg-alarm-id="${a.id}"] input[type=checkbox]`);
  cb.checked = false;
  cb.dispatchEvent(new tab.window.Event('change', { bubbles: true }));
  await w.advance(300);
  assert.equal(listOf(w).find(x => x.id === a.id).on, false, 'a switched off');
  // delete b
  tab.$(`tr[data-dg-alarm-id="${b.id}"] [data-dg-alarm-delete]`).click();
  await w.advance(300);
  assert.equal(listOf(w).length, 1, 'b deleted');
  // simulate reload
  const w2 = createWorld({ storage: { sync: w.stored('sync'), local: w.stored('local') } });
  const tab2 = await w2.open({ fixture: 'favourites', hash: '/favourites?dg=alarms' });
  await w2.advance(200);
  const rows2 = tab2.$$('tr[data-dg-alarm-id]');
  assert.equal(rows2.length, 1, 'one row after reload');
  assert.equal(tab2.$(`tr[data-dg-alarm-id="${a.id}"] input[type=checkbox]`).checked, false, 'a still off');
  noErrors(w2);
});

test('Alarms page: sorted by product A-Z then price high to low; storage order untouched', async () => {
  const list = [
    alarm({ id: 'o1', productId: 11, name: 'Samsung', price: 200 }),
    alarm({ id: 'o2', productId: 12, name: 'meta',    price: 190 }),
    alarm({ id: 'o3', productId: 11, name: 'Samsung', price: 300 }),
    alarm({ id: 'o4', productId: 12, name: 'meta',    price: 200 }),
  ];
  const { w, tab } = await setupAlarmsPage(list);
  assert.equal(alarmPageRows(tab).length, 4);
  assert.deepEqual(
    alarmPageRows(tab).map(r => r.getAttribute('data-dg-alarm-id')),
    ['o4', 'o2', 'o3', 'o1'],
    'sorted: meta desc then Samsung desc'
  );
  // storage order stays as inserted
  assert.deepEqual(listOf(w).map(a => a.id), ['o1', 'o2', 'o3', 'o4'], 'storage untouched');
  noErrors(w);
});

test("product panel: this product's alarms read price high to low", async () => {
  const alarms_ = [alarm({ id: 'k1', price: 18 }), alarm({ id: 'k2', price: 30 }), alarm({ id: 'k3', price: 22 })];
  const { w, tab } = await setupProduct(alarms_);
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  assert.ok(panel(tab), 'panel open');
  assert.equal(alarmRows(tab).length, 3);
  assert.deepEqual(
    alarmRows(tab).map(r => r.getAttribute('data-dg-alarm-row')),
    ['k2', 'k3', 'k1'],
    'product panel list: price high to low'
  );
  noErrors(w);
});

test('Alarms page filters: status chip and product picker', async () => {
  const al = [alarm(), alarm({ on: false, price: 19 }), alarm({ productId: 789, name: 'Mock Chips ETF', price: 16 })];
  const { w, tab } = await setupAlarmsPage(al);
  assert.equal(alarmPageRows(tab).length, 3);
  // click "Off" chip
  tab.$('[data-dg-alarm-filter=off]').click();
  await w.advance(200);
  const visAfterOff = alarmPageRows(tab).filter(r => r.style.display !== 'none');
  assert.equal(visAfterOff.length, 1, 'only off alarm visible');
  // reset
  tab.$('[data-dg-alarm-filter=all]').click();
  await w.advance(200);
  // open product picker and pick Mock Chips ETF
  tab.$('[data-dg-alarm-products]').click();
  await w.advance(100);
  const chip = tab.$$('[data-dg-alarms-page] [role=listbox] label').find(l => l.textContent.includes('Mock Chips ETF'));
  assert.ok(chip, 'Mock Chips ETF in picker');
  chip.querySelector('input').click();
  await w.advance(200);
  const visAfterPick = alarmPageRows(tab).filter(r => r.style.display !== 'none');
  assert.equal(visAfterPick.length, 1);
  assert.ok(visAfterPick[0].textContent.includes('Mock Chips ETF'));
  noErrors(w);
});

test('Alarms page empty state', async () => {
  const { w, tab } = await setupAlarmsPage([]);
  assert.ok(tab.$('[data-dg-alarm-empty]')?.textContent.includes('No alarms yet'), 'empty state shown');
  noErrors(w);
});

test("switching Price alarms off shows DEGIRO's Favourites list again", async () => {
  const { w, tab } = await setupAlarmsPage([alarm()]);
  assert.ok(tab.$('[data-dg-alarms-page]'), 'Alarms page visible');
  await tab.setFlag('priceAlarms', false);
  await w.advance(300);
  assert.equal(tab.$('[data-dg-alarms-page]'), null, 'Alarms page gone');
  // The extension hides Favourites via an owned <style> element; when off, that element must be gone.
  // (jsdom has no CSS engine, so element.style.display would be empty regardless — always check the
  // <style> element, not the computed visibility.)
  const hideStyle = tab.$$('style[data-dg-own]').find(s => s.textContent.includes('favourites'));
  assert.equal(hideStyle, undefined, 'Favourites hiding stylesheet removed when priceAlarms off');
  await tab.setFlag('priceAlarms', true);
  await w.advance(300);
  assert.ok(tab.$('[data-dg-alarms-page]'), 'Alarms page back');
  noErrors(w);
});

test('keyboard focus on a switch survives a price tick', async () => {
  const a = alarm();
  const { w, tab } = await setupAlarmsPage([a]);
  const sw = tab.$(`tr[data-dg-alarm-id="${a.id}"] input[type=checkbox]`);
  sw.focus();
  await priceAt(tab, 123, 16.5, 300);
  // the row should still be there and the switch still focused
  assert.ok(tab.$(`tr[data-dg-alarm-id="${a.id}"] [data-dg-alarm-status]`), 'row re-rendered');
  const active = tab.document.activeElement;
  assert.equal(active?.type, 'checkbox', 'focused element is a checkbox');
  assert.equal(active?.closest('tr')?.getAttribute('data-dg-alarm-id'), a.id, 'same row retains focus');
  noErrors(w);
});

test('the filters reset when the Alarms page is left', async () => {
  const al = [alarm(), alarm({ on: false, price: 19 })];
  const { w, tab } = await setupAlarmsPage(al);
  tab.$('[data-dg-alarm-filter=off]').click();
  await w.advance(200);
  await tab.go('/favourites');
  await tab.go('/favourites?dg=alarms');
  assert.equal(alarmPageRows(tab).length, 2, 'all rows visible after returning');
  assert.equal(tab.$('[data-dg-alarm-filter=all]')?.getAttribute('aria-pressed'), 'true', '"All" active after return');
  noErrors(w);
});

test('sidebar: Alarms item href and current state; hidden when Price alarms is off', async () => {
  const { w, tab } = await setupFav([]);
  assert.equal(tab.$('[data-dg-nav=alarms] a')?.getAttribute('href'), '#/favourites?dg=alarms');
  // navigate to Alarms page
  await tab.go('/favourites?dg=alarms');
  assert.ok(tab.$('[data-dg-nav=alarms] a')?.classList.contains('current'), 'alarms item is current on Alarms page');
  // switch off
  await tab.setFlag('priceAlarms', false);
  await w.advance(300);
  assert.equal(tab.$('[data-dg-nav=alarms]'), null, 'Alarms nav item hidden when off');
  assert.ok(tab.$('[data-dg-nav=orders]'), 'Orders nav item still present');
  noErrors(w);
});

test('an alarm without name and symbol is still a link on the Alarms page', async () => {
  const a = alarm({ name: '', symbol: '' });
  const { w, tab } = await setupAlarmsPage([a]);
  const link = tab.$(`tr[data-dg-alarm-id="${a.id}"] a`);
  assert.ok(link, 'link element present');
  assert.ok(link.textContent.includes('123'), 'link text contains product id');
  noErrors(w);
});

// ============================================================
// EDIT ALARM (Alarms page)
// ============================================================

const editBtn = (tab, id) => tab.$(`tr[data-dg-alarm-id="${id}"] [data-dg-alarm-edit]`);

test('Alarms page: every row has an Edit button, opens the Edit panel pre-filled', async () => {
  const a = alarm({ price: 18, repeat: 'daily' }), b = alarm({ productId: 901, name: 'Mock Oil', price: 40 });
  const { w, tab } = await setupAlarmsPage([a, b]);
  assert.equal(tab.$$('[data-dg-alarm-edit]').length, 2, 'two Edit buttons');
  assert.ok(editBtn(tab, a.id)?.textContent.includes('Edit'), 'Edit button text');
  assert.ok(editBtn(tab, a.id)?.getAttribute('aria-label')?.includes('18'), 'aria-label has price');
  // open edit panel for a
  editBtn(tab, a.id).click();
  await w.advance(200);
  assert.ok(panel(tab), 'panel open');
  assert.ok(panel(tab).textContent.includes('Edit price alarm'), 'panel title says Edit');
  assert.ok(panel(tab).textContent.includes('Mock ETF'), 'product name shown');
  assert.match(tab.$('[data-dg-alarm-price]').value, /18/);
  assert.equal(tab.$('[data-dg-alarm-repeat=daily]')?.getAttribute('aria-pressed'), 'true', 'daily selected');
  assert.equal(tab.$('[data-dg-alarm-repeat=once]')?.getAttribute('aria-pressed'), 'false', 'once not selected');
  assert.equal(tab.$('[data-dg-alarm-set]')?.textContent.trim(), 'Save', 'button says Save');
  assert.equal(tab.$('[data-dg-alarm-cancel]')?.textContent.trim(), 'Cancel', 'Cancel button present');
  assert.equal(alarmRows(tab).length, 0, 'no alarm list in edit mode');
  noErrors(w);
});

test('Alarms page: Edit panel subtitle is the symbol alone (no currency, no bullet)', async () => {
  const a = alarm({ price: 18 });
  const { w, tab } = await setupAlarmsPage([a]);
  editBtn(tab, a.id).click();
  await w.advance(200);
  // subtitle text should be 'MOCK' only
  const subtitle = [...panel(tab).querySelectorAll('div')].find(d => d.textContent.trim() === 'MOCK');
  assert.ok(subtitle, 'subtitle shows symbol only (MOCK)');
  noErrors(w);
});

test('Alarms page: Save updates the alarm in place, switches it on, clears firedAt', async () => {
  const a = alarm({ price: 17, on: false });
  const b = alarm({ price: 19 });
  const firedAt = Date.now() - 5000;
  const { w, tab } = await setupAlarmsPage([a, b], {
    dgAlarmState: { [a.id]: { firedAt, last: 16.9, lastAt: Date.now() } }
  });
  editBtn(tab, a.id).click();
  await w.advance(200);
  fill(tab, '[data-dg-alarm-price]', '15,5');
  await w.advance(100);
  tab.$('[data-dg-alarm-repeat=each]').click();
  await w.advance(100);
  tab.$('[data-dg-alarm-set]').click();
  await w.advance(500);
  assert.equal(panel(tab), null, 'panel closed after save');
  const stored = listOf(w);
  assert.equal(stored[0].id, a.id);
  assert.equal(stored[0].price, 15.5);
  assert.equal(stored[0].dir, 'below');
  assert.equal(stored[0].repeat, 'each');
  assert.equal(stored[0].on, true, 'alarm switched on by Save');
  assert.equal(stored[1].price, 19, 'b unchanged');
  // firedAt cleared, last price kept
  assert.equal(stateOf(w, a.id).firedAt, undefined, 'firedAt cleared');
  assert.equal(stateOf(w, a.id).last, 16.9, 'last price kept');
  noErrors(w);
});

test('Alarms page: an edited once alarm that had fired fires again at the new level', async () => {
  const a = alarm({ price: 17 });
  const { w, tab } = await setupAlarmsPage([a]);
  // fire the alarm
  const fav = await w.open({ fixture: 'favourites', hash: '/favourites' });
  await w.advance(200);
  fav.setPrice(123, 17.2);
  await w.advance(300);
  assert.equal(listOf(w).find(x => x.id === a.id).on, false, 'alarm off after once');
  // edit to 18
  editBtn(tab, a.id).click();
  await w.advance(200);
  fill(tab, '[data-dg-alarm-price]', '18');
  await w.advance(100);
  tab.$('[data-dg-alarm-set]').click();
  await w.advance(300);
  assert.equal(panel(tab), null, 'panel closed');
  assert.equal(listOf(w).find(x => x.id === a.id).price, 18, 'price updated');
  assert.equal(listOf(w).find(x => x.id === a.id).on, true, 'alarm re-enabled');
  // fire again at new level
  fav.setPrice(123, 18.1);
  await w.advance(300);
  assert.equal(events(w).length, 1);
  assert.ok(events(w)[0].price >= 18, 'fired at new level');
  noErrors(w);
});

test('Alarms page: an edited every-time alarm starts fresh', async () => {
  const a = alarm({ price: 17, repeat: 'each' });
  const { w, tab } = await setupAlarmsPage([a]);
  // fire in the alarms-page tab (it has the hidden Favourites list with LastPrice elements)
  tab.setPrice(123, 17.2);
  await w.advance(300);
  assert.equal(events(w).length, 1);
  tab.$('[data-dg-alarm-close]').click();
  await w.advance(200);
  // current price is now 17.2 in this tab's DOM; edit to 17.1 (below 17.2)
  editBtn(tab, a.id).click();
  await w.advance(200);
  fill(tab, '[data-dg-alarm-price]', '17,1');
  await w.advance(100);
  tab.$('[data-dg-alarm-set]').click();
  await w.advance(300);
  const stored = listOf(w).find(x => x.id === a.id);
  assert.equal(stored.price, 17.1);
  assert.equal(stored.dir, 'below');
  assert.equal(stored.on, true);
  // price falls below 17.1 → new event
  tab.setPrice(123, 17.0);
  await w.advance(300);
  assert.equal(events(w).length, 1, 'new event for the new level');
  noErrors(w);
});

test('Alarms page: Cancel, Esc, × and click outside leave the alarm unchanged', async () => {
  const a = alarm({ price: 18 });
  const { w, tab } = await setupAlarmsPage([a]);
  for (const how of ['cancel', 'esc', 'x', 'outside']) {
    editBtn(tab, a.id).click();
    await w.advance(200);
    assert.ok(panel(tab), `panel open for '${how}'`);
    fill(tab, '[data-dg-alarm-price]', '25');
    tab.$('[data-dg-alarm-repeat=each]').click();
    await w.advance(100);
    if (how === 'cancel') tab.$('[data-dg-alarm-cancel]').click();
    else if (how === 'esc') tab.document.dispatchEvent(new tab.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else if (how === 'x') tab.$('[data-dg-alarm-x]').click();
    else tab.$('[data-dg-alarms-page]').closest('main')?.dispatchEvent(new tab.window.MouseEvent('mousedown', { bubbles: true }));
    await w.advance(200);
    assert.equal(panel(tab), null, `panel closed by '${how}'`);
  }
  const stored = listOf(w).find(x => x.id === a.id);
  assert.equal(stored.price, 18, 'price unchanged');
  assert.equal(stored.repeat, 'once', 'repeat unchanged');
  noErrors(w);
});

test('Alarms page: Save needs a price from somewhere; last-seen used when none is live', async () => {
  const g = alarm({ id: 'ghost', productId: 999, name: 'Ghost Fund', price: 30 });
  const { w, tab } = await setupAlarmsPage([g]);
  editBtn(tab, g.id).click();
  await w.advance(200);
  assert.ok(panel(tab).textContent.includes('Ghost Fund'), 'product name in panel');
  // no live price: save still possible
  assert.ok(!tab.$('[data-dg-alarm-set]').disabled, 'Save enabled with no live price');
  fill(tab, '[data-dg-alarm-price]', '35');
  await w.advance(100);
  assert.ok(tab.$('[data-dg-alarm-hint]').textContent.includes('No current price'), 'hint shows no-price message');
  // invalid prices
  fill(tab, '[data-dg-alarm-price]', '');
  await w.advance(100);
  assert.ok(tab.$('[data-dg-alarm-set]').disabled, 'disabled for empty');
  fill(tab, '[data-dg-alarm-price]', 'abc');
  await w.advance(100);
  assert.ok(tab.$('[data-dg-alarm-msg]').textContent.includes('Enter a price'), 'error for invalid');
  // valid: save
  fill(tab, '[data-dg-alarm-price]', '40');
  await w.advance(100);
  tab.$('[data-dg-alarm-set]').click();
  await w.advance(300);
  assert.equal(listOf(w).find(x => x.id === g.id).price, 40, 'price updated to 40');
  // with a last-seen price in state: save without direction change
  await w.set('local', { dgAlarmState: { [g.id]: { last: 25, lastAt: Date.now() } } });
  editBtn(tab, g.id).click();
  await w.advance(200);
  assert.ok(panel(tab).textContent.includes('Latest'), 'latest line shown with last-seen price');
  assert.ok(tab.$('[data-dg-alarm-hint]').textContent.includes('rises to'), 'hint uses last-seen direction');
  fill(tab, '[data-dg-alarm-price]', '20');
  await w.advance(100);
  tab.$('[data-dg-alarm-set]').click();
  await w.advance(300);
  assert.equal(listOf(w).find(x => x.id === g.id).price, 20, 'price updated to 20');
  assert.equal(listOf(w).find(x => x.id === g.id).dir, 'below', 'below since 20 < 25');
  noErrors(w);
});

test('Alarms page: a save that finishes after another panel opened leaves that panel alone', async () => {
  const a = alarm({ price: 18 }), b = alarm({ price: 19 });
  const { w, tab } = await setupAlarmsPage([a, b]);
  editBtn(tab, a.id).click();
  await w.advance(200);
  fill(tab, '[data-dg-alarm-price]', '20');
  await w.advance(100);
  // slow storage so a's save is still in-flight when b's panel opens
  w.latency.set = 50;
  // click Save on a then immediately Edit on b (before the write answers)
  tab.$('[data-dg-alarm-set]').click();
  editBtn(tab, b.id).click();
  await w.advance(3000);
  w.latency.set = 0;
  const stored = listOf(w);
  assert.equal(stored.find(x => x.id === a.id).price, 20, "a's edit saved");
  assert.equal(stored.find(x => x.id === b.id).price, 19, "b unchanged");
  assert.ok(panel(tab), "b's panel still open");
  assert.match(tab.$('[data-dg-alarm-price]').value, /19/, "b's panel shows b's price");
  noErrors(w);
});

test('Alarms page: deleting the alarm while its panel is open closes the panel', async () => {
  const a = alarm({ price: 18 });
  const { w, tab } = await setupAlarmsPage([a]);
  editBtn(tab, a.id).click();
  await w.advance(200);
  assert.ok(panel(tab), 'panel open');
  // delete via storage (simulating another tab or the delete button elsewhere)
  await w.set('sync', { dgAlarms: [] });
  await w.advance(300);
  assert.equal(panel(tab), null, 'panel closed when alarm deleted');
  noErrors(w);
});

test('Alarms page: Edit panel closes when page left and when Price alarms switched off', async () => {
  const a = alarm({ price: 18 });
  const { w, tab } = await setupAlarmsPage([a]);
  editBtn(tab, a.id).click();
  await w.advance(200);
  assert.ok(panel(tab), 'panel open');
  // panel survives the page's own runs
  await w.advance(1300);
  assert.ok(panel(tab), 'panel survives normal scheduler runs');
  // leave the page
  await tab.go('/favourites');
  assert.equal(panel(tab), null, 'panel closed on navigate away');
  // return and reopen
  await tab.go('/favourites?dg=alarms');
  editBtn(tab, a.id).click();
  await w.advance(200);
  assert.ok(panel(tab), 'panel reopened');
  // switch off
  await tab.setFlag('priceAlarms', false);
  await w.advance(300);
  assert.equal(panel(tab), null, 'panel closed when feature off');
  noErrors(w);
});

test('Alarms page: keyboard focus on Edit survives a price tick', async () => {
  const a = alarm({ price: 18 });
  const { w, tab } = await setupAlarmsPage([a]);
  editBtn(tab, a.id).focus();
  // add a second tab (Favourites) to trigger price ticks on the Alarms page
  const fav = await w.open({ fixture: 'favourites', hash: '/favourites' });
  await w.advance(100);
  fav.setPrice(123, 16.5);
  await w.advance(400);
  // activeElement should still be the Edit button for alarm a
  const active = tab.document.activeElement;
  assert.ok(active?.hasAttribute('data-dg-alarm-edit'), 'active element is still an Edit button');
  assert.equal(active?.closest('tr')?.getAttribute('data-dg-alarm-id'), a.id, 'same row retains focus');
  noErrors(w);
});

// ---------- Status "?" hint (Alarms page) ----------
// The hover look, its colours and the bubble's place on the screen stay in Playwright.
const tipBtn = tab => tab.$('[data-dg-alarms-page] thead [data-dg-alarm-tip]');
const tipBubbles = tab => tab.$$('[data-dg-alarm-tip-bubble]');
const firstLatest = tab => alarmPageRows(tab)[0].querySelectorAll('td')[1].textContent;
const esc = tab => tab.document.dispatchEvent(new tab.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
const enter = (tab, el) => el.dispatchEvent(new tab.window.MouseEvent('mouseenter'));
// the pointer goes to the page corner: mouseleave on the button, pointermove elsewhere
function leave(tab) {
  tipBtn(tab).dispatchEvent(new tab.window.MouseEvent('mouseleave'));
  tab.document.body.dispatchEvent(new tab.window.MouseEvent('pointermove', { bubbles: true }));
}

test('Alarms page: the Status "?" opens on keyboard focus, Esc closes, a click toggles', async () => {
  const { w, tab } = await setupAlarmsPage([alarm({ price: 18 })]);
  tipBtn(tab).focus();
  await w.flush();
  assert.equal(tipBubbles(tab).length, 1, 'focus opens');
  esc(tab);
  await w.flush();
  assert.equal(tipBubbles(tab).length, 0, 'Esc closes');
  tipBtn(tab).click();
  await w.flush();
  assert.equal(tipBubbles(tab).length, 1, 'click opens');
  leave(tab);
  await w.flush();
  assert.equal(tipBubbles(tab).length, 1, 'pinned by the click');
  tipBtn(tab).click();
  await w.flush();
  assert.equal(tipBubbles(tab).length, 0, 'second click closes');
  noErrors(w);
});

test('Alarms page: an open Status bubble survives a price tick, stays single and keeps the focus', async () => {
  const { w, tab } = await setupAlarmsPage([alarm({ price: 18 })]);
  enter(tab, tipBtn(tab));
  tipBtn(tab).click();
  await w.flush();
  assert.equal(tipBubbles(tab).length, 1);
  leave(tab);
  const before = firstLatest(tab);
  await priceAt(tab, 123, 16.5, 300);
  assert.notEqual(firstLatest(tab), before, 'the page was rebuilt');
  assert.equal(tipBubbles(tab).length, 1);
  assert.equal(tipBtn(tab).getAttribute('aria-expanded'), 'true');
  tipBtn(tab).focus();
  await priceAt(tab, 123, 16.4, 400);
  assert.equal(tipBubbles(tab).length, 1);
  assert.ok(tab.document.activeElement?.hasAttribute('data-dg-alarm-tip'), 'the ? keeps the focus');
  noErrors(w);
});

test('Alarms page: a bubble closed with Esc stays closed across a price tick while the button keeps the focus', async () => {
  const { w, tab } = await setupAlarmsPage([alarm({ price: 18 })]);
  tipBtn(tab).focus();
  await w.flush();
  assert.equal(tipBubbles(tab).length, 1);
  esc(tab);
  await w.flush();
  assert.equal(tipBubbles(tab).length, 0);
  const before = firstLatest(tab);
  await priceAt(tab, 123, 16.5, 400);
  assert.notEqual(firstLatest(tab), before, 'rebuilt');
  assert.equal(tipBubbles(tab).length, 0);
  assert.ok(tab.document.activeElement?.hasAttribute('data-dg-alarm-tip'), 'the ? keeps the focus');
  noErrors(w);
});

test('Alarms page: a bubble closed by a second click stays closed across a price tick', async () => {
  const { w, tab } = await setupAlarmsPage([alarm({ price: 18 })]);
  tipBtn(tab).click();
  await w.flush();
  assert.equal(tipBubbles(tab).length, 1);
  tipBtn(tab).click();
  await w.flush();
  assert.equal(tipBubbles(tab).length, 0);
  leave(tab);
  const before = firstLatest(tab);
  await priceAt(tab, 123, 16.5, 400);
  assert.notEqual(firstLatest(tab), before);
  assert.equal(tipBubbles(tab).length, 0);
  noErrors(w);
});
