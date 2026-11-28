// Price alarms: panel (degiro fixture), Alarms page, Edit alarm — logic-only tests without a browser.
// Stays in Playwright: network interception, layout (button/menu position, page bounds, textAlign),
// sticky header visibility (CSS layout), computed colours, CDP scan count, mouse.down/up mid-click,
// currency-missing timing (initScript/DOMContentLoaded cannot be replicated via globals).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorld, alarm, noErrors, events, stateOf, listOf, banners } = require('./harness');

// ---------- helpers ----------
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

// DEGIRO's product page keeps a hidden [data-name=measurer] copy of the header price (same data-id);
// the mock puts it before the visible price. Here it carries another price than the one shown.
/** @param {string} s a price as DEGIRO writes it ("17,50"), or '' for none */
function measurerAt(tab, s) {
  const e = tab.$('[data-name=measurer] [data-field=CurrentPrice]');
  assert.ok(e, "the mock has DEGIRO's measurer copy of the price");
  if (s) { e.title = s; e.textContent = '€' + s; } else { e.removeAttribute('title'); e.textContent = '€ —'; }
}

test("product page: alarms check the visible header price, not DEGIRO's hidden measurer copy", async () => {
  const a = alarm({ price: 17 }); // above 17
  const { w, tab } = await setupProduct([a]);
  measurerAt(tab, '17,50'); // shown: 16,92
  await w.advance(300);
  assert.equal(banners(tab).length, 0, 'the hidden copy above the alarm does not fire it');
  assert.equal(stateOf(w, a.id).last, 16.92, 'the last price seen is the visible one');
  // the panel's current price is the visible one too
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  assert.ok(panel(tab), 'panel opened');
  assert.match(tab.$('[data-dg-alarm-price]').value, /^16[,.]92$/);
  tab.$('[data-dg-alarm-x]').click();
  await w.advance(100);
  // the visible price passes the alarm while the hidden copy stays below it: it fires, at the visible price
  tab.setPrice(123, 17.3);
  measurerAt(tab, '16,50');
  await w.advance(300);
  assert.equal(banners(tab).length, 1, 'the visible price fires it');
  assert.ok(tab.$('[data-dg-alarm-banner]').textContent.includes('17,30'));
  noErrors(w);
});

test("product page: with no visible price the panel doesn't take one from DEGIRO's hidden measurer copy", async () => {
  const { w, tab } = await setupProduct();
  // the shown price goes blank (no title to fall back on) while the hidden copy still has one
  const shown = tab.$$('[data-field=CurrentPrice]').find(e => !e.closest('[data-name=measurer]'));
  shown.textContent = '$ —'; shown.removeAttribute('title');
  measurerAt(tab, '20,00');
  await w.advance(1300); // let the scheduler forget the earlier (valid) reading
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  assert.ok(panel(tab), 'panel opened');
  assert.equal(tab.$('[data-dg-alarm-price]').value, '', 'no prefill from the hidden copy');
  assert.ok(!panel(tab).textContent.includes('Latest'), 'no Latest line: current price unknown');
  fill(tab, '[data-dg-alarm-price]', '18');
  await w.advance(100);
  assert.notEqual(tab.$('[data-dg-alarm-dir-wrap]')?.style.display, 'none', 'a direction to choose: no current price known');
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
  // the current price is known: no direction chooser needed
  assert.equal(tab.$('[data-dg-alarm-dir-wrap]')?.style.display, 'none', 'direction chooser hidden when the current price is known');
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

test('new alarm: an unknown current price lets you choose a direction instead of a misleading error', async () => {
  const { w, tab } = await setupProduct();
  // Simulate "no live price seen yet" (e.g. transiently right after page load): unlike
  // __MOCK_PRICE_DASH (which keeps a valid title DEGIRO can fall back to), both the display and
  // its title fallback go blank, so priceNow() truly has nothing to read for this product.
  tab.$$('[data-field=CurrentPrice]').forEach(e => { e.textContent = '$ —'; e.removeAttribute('title'); });
  await w.advance(1300); // let the scheduler forget the earlier (valid) reading
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  assert.ok(panel(tab), 'panel opened');
  assert.ok(!panel(tab).textContent.includes('Latest'), 'no Latest line: current price unknown');
  fill(tab, '[data-dg-alarm-price]', '140');
  await w.advance(100);
  // a clearly valid typed price must not show the generic "enter a price" error
  assert.ok(!tab.$('[data-dg-alarm-msg]').textContent.includes('Enter a price above 0'), 'no misleading price error for a valid price');
  // Set stays disabled until a direction is chosen...
  assert.ok(tab.$('[data-dg-alarm-set]').disabled, 'Set disabled until a direction is chosen');
  // ...but a direction choice is offered instead of a permanent dead end
  assert.notEqual(tab.$('[data-dg-alarm-dir-wrap]')?.style.display, 'none', 'direction chooser shown when the current price is unknown');
  const above = tab.$('[data-dg-alarm-dir="above"]');
  assert.ok(above, 'a direction choice is offered when the current price is unknown');
  above.click();
  await w.advance(100);
  assert.ok(!tab.$('[data-dg-alarm-set]').disabled, 'Set enabled once a direction is chosen');
  tab.$('[data-dg-alarm-set]').click();
  await w.advance(500);
  const stored = listOf(w);
  assert.equal(stored.length, 1, 'alarm created');
  assert.equal(stored[0].price, 140);
  assert.equal(stored[0].dir, 'above');
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

// ============================================================
// EDIT ALARM (chart badge, product page)
// ============================================================
// alarm-lines.js (page world) dispatches this same event on a chart badge click; simulate it here
// directly since this file only loads the isolated-world scripts (see alarm-lines.test.js for the
// page-world side: that it dispatches dg-alarm-edit with the right price).
const clickBadge = (tab, price) => tab.document.dispatchEvent(new tab.window.CustomEvent('dg-alarm-edit', { detail: { price } }));

test('product page: clicking the chart badge opens the Edit panel and it survives the scheduler tick', async () => {
  const a = alarm({ price: 18 });
  const { w, tab } = await setupProduct([a]);
  clickBadge(tab, 18);
  await w.advance(200);
  assert.ok(panel(tab), 'panel open');
  assert.ok(panel(tab).textContent.includes('Edit price alarm'), 'panel title says Edit');
  assert.match(tab.$('[data-dg-alarm-price]').value, /18/, 'prefilled with the alarm price');
  // the alarmButton feature runs every 1000ms; this is the bug: it used to force-close here because
  // page.isAlarms() is false on a product page
  await w.advance(1300);
  assert.ok(panel(tab), 'panel still open after a scheduler tick on its own product page');
  await w.advance(1300);
  assert.ok(panel(tab), 'panel still open after a second scheduler tick');
  noErrors(w);
});

test('product page: Edit panel (chart badge) closes when navigating to a different product', async () => {
  const a = alarm({ price: 18 });
  const { w, tab } = await setupProduct([a]);
  clickBadge(tab, 18);
  await w.advance(200);
  assert.ok(panel(tab), 'panel open');
  await tab.go('/products/999/overview');
  await w.advance(200);
  assert.equal(panel(tab), null, 'panel closed after navigating to another product');
  noErrors(w);
});

test('product page: Edit panel (chart badge) closes when navigating off the product entirely', async () => {
  const a = alarm({ price: 18 });
  const { w, tab } = await setupProduct([a]);
  clickBadge(tab, 18);
  await w.advance(200);
  assert.ok(panel(tab), 'panel open');
  await tab.go('/favourites');
  await w.advance(200);
  assert.equal(panel(tab), null, 'panel closed after leaving the product page');
  noErrors(w);
});

test('product page: Edit panel (chart badge) closes when the alarm is deleted', async () => {
  const a = alarm({ price: 18 });
  const { w, tab } = await setupProduct([a]);
  clickBadge(tab, 18);
  await w.advance(200);
  assert.ok(panel(tab), 'panel open');
  await w.set('sync', { dgAlarms: [] });
  await w.advance(300);
  assert.equal(panel(tab), null, 'panel closed when alarm deleted');
  noErrors(w);
});

test('product page: Edit panel (chart badge) stays open when the product is un-favourited', async () => {
  const a = alarm({ price: 18 });
  const { w, tab } = await setupProduct([a]);
  clickBadge(tab, 18);
  await w.advance(200);
  assert.ok(panel(tab), 'panel open');
  // un-favourite while the Edit panel is open and still on its origin product page (the star
  // toggles here by firing only 'click', standing in for any non-mousedown trigger — keyboard
  // activation, or the star's attribute changing on its own, e.g. DEGIRO re-rendering the header
  // or another tab syncing the favourite; a real outside mousedown already closes the panel via
  // onDown, regardless of this fix). The older close-on-unfavourite branch used to force-close
  // any open ui unconditionally, including this Edit panel.
  tab.$('#favStar').click();
  await w.advance(1300);
  assert.ok(panel(tab), 'Edit panel still open after un-favouriting its own product');
  // the origin/alarm-deleted checks at the top of run() must still close the panel while
  // un-favourited (seen.fav is now false, so the scan-skip path at the top of run() -- not the
  // header search below it -- is what has to catch this)
  await w.set('sync', { dgAlarms: [] });
  await w.advance(1300);
  assert.equal(panel(tab), null, 'panel closed once its alarm is deleted, even while un-favourited');
  noErrors(w);
});

test('product page: Edit panel (chart badge) still closes navigating away after un-favouriting', async () => {
  const a = alarm({ price: 18 });
  const { w, tab } = await setupProduct([a]);
  clickBadge(tab, 18);
  await w.advance(200);
  assert.ok(panel(tab), 'panel open');
  tab.$('#favStar').click();
  await w.advance(1300);
  assert.ok(panel(tab), 'panel still open after un-favouriting');
  await tab.go('/products/999/overview');
  await w.advance(1300);
  assert.equal(panel(tab), null, 'panel closed after navigating to another product while un-favourited');
  noErrors(w);
});

test('Alarms page Edit flow still closes on navigating to a product page (origin check holds both ways)', async () => {
  const a = alarm({ price: 18 });
  const { w, tab } = await setupAlarmsPage([a]);
  editBtn(tab, a.id).click();
  await w.advance(200);
  assert.ok(panel(tab), 'panel open on the Alarms page');
  await tab.go('/products/123/overview');
  await w.advance(1300);
  assert.equal(panel(tab), null, 'panel closed after leaving the Alarms page for a product page');
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

// ============================================================
// TOGGLE STYLE CLEANUP (F9 regression: dg-toggle-style leak)
// ============================================================

test('switching Price alarms off removes the toggle style (Alarms page path)', async () => {
  // The Alarms page renders a toggle switch for each alarm; dgUi.toggle() injects
  // <style id="dg-toggle-style"> on first use and must remove it on feature stop.
  const { w, tab } = await setupAlarmsPage([alarm()]);
  assert.ok(tab.$('#dg-toggle-style'), 'toggle style injected while Alarms page is visible');
  await tab.setFlag('priceAlarms', false);
  await w.advance(300);
  assert.equal(tab.$('#dg-toggle-style'), null, 'toggle style removed after priceAlarms switched off');
  noErrors(w);
});

test('switching Price alarms off removes the toggle style (alarm-panel path)', async () => {
  // The alarm panel's list renders a toggle switch for each alarm; the same style must be
  // cleaned up when the feature stops while the panel was open with alarms listed.
  const a = alarm({ price: 18 });
  const { w, tab } = await setupProduct([a]);
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  assert.ok(tab.$('#dg-toggle-style'), 'toggle style injected while panel shows alarm list with toggles');
  await tab.setFlag('priceAlarms', false);
  await w.advance(300);
  assert.equal(tab.$('#dg-toggle-style'), null, 'toggle style removed after priceAlarms switched off');
  noErrors(w);
});

// ============================================================
// BACKGROUND CHECK: Yahoo ticker links (background.js prices linked products)
// ============================================================

const tickerWrites = w => w.log.filter(l => l.area === 'sync' && l.keys.includes('dgTickers')).length;

test('a product page with alarms links the product to its Yahoo ticker (symbol + exchange), once', async () => {
  const { w } = await setupProduct([alarm({ price: 18 })]);
  await w.advance(300);
  assert.deepEqual(w.stored('sync').dgTickers, { 123: { t: 'MOCK.AS', cur: '€' } }, 'MOCK · Euronext Amsterdam');
  const writes = tickerWrites(w);
  await w.advance(3000);
  assert.equal(tickerWrites(w), writes, 'not written again');
  noErrors(w);
});

test('no link without alarms for the product; saving the first alarm links it', async () => {
  const { w, tab } = await setupProduct([]);
  await w.advance(300);
  assert.equal(w.stored('sync').dgTickers, undefined);
  tab.$('[data-dg-alarm-button]').click();
  await w.advance(200);
  fill(tab, '[data-dg-alarm-price]', '18');
  await w.advance(100);
  tab.$('[data-dg-alarm-set]').click();
  await w.advance(500);
  assert.equal(listOf(w).length, 1);
  assert.deepEqual(w.stored('sync').dgTickers, { 123: { t: 'MOCK.AS', cur: '€' } });
  noErrors(w);
});

/** what each Alarms page row says about the background check: alarm id → [state, text, tooltip] */
const bgNotes = tab => Object.fromEntries(alarmPageRows(tab).map(r => {
  const n = r.querySelector('[data-dg-alarm-bg]');
  return [r.getAttribute('data-dg-alarm-id'), n ? [n.getAttribute('data-dg-alarm-bg'), n.textContent, n.title] : null];
}));

test('Alarms page: with the background check on, every alarm says where it stands (checked, not found, no match, no ticker)', async () => {
  // above the mock prices: nothing fires (and switches itself off) while the page is open
  const a = alarm({ price: 5000 }), b = alarm({ productId: 456, name: 'Other', price: 5000 }),
    c = alarm({ productId: 789, name: 'Chips', price: 5000 }), d = alarm({ productId: 999, name: 'Not listed', price: 5000 }),
    e = alarm({ productId: 555, name: 'CL DEC26', price: 5000 });
  const w = createWorld({ storage: {
    // the links the list itself gives (MOCK · EAM · €, MTEC · NDQ · $, CHIP · EAM · €); 999 isn't in the list: no link
    sync: { dgAlarms: [a, b, c, d, e], dgTickers: { 123: { t: 'MOCK.AS', cur: '€', isin: 'XX0000000000' }, 456: { t: 'MTEC', cur: '$', isin: 'XX0000000000' }, 789: { t: 'CHIP.AS', cur: '€', isin: 'XX0000000000' } }, alarmsBackground: true },
    // 555 was seen in another list: its exchange (IFUS) has no Yahoo ticker and it has no ISIN
    local: { dgNoTicker: { 555: 'IFUS' }, dgTickerCheck: { 'MOCK.AS|€|XX0000000000': { ok: true, f: 1, at: 1, y: 'MOCK.AS' }, 'MTEC|$|XX0000000000': { ok: false, f: 0, at: 1, why: 'missing' }, 'CHIP.AS|€|XX0000000000': { ok: false, f: 0, at: 1, why: 'price' } } }
  } });
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites?dg=alarms' });
  await w.advance(300);
  const notes = bgNotes(tab);
  assert.deepEqual(notes[a.id], ['ok', '✓ MOCK.AS', 'Checked in the background with Yahoo Finance prices (MOCK.AS)']);
  assert.deepEqual(notes[b.id], ['failed', 'MTEC not found on Yahoo', '']);
  assert.deepEqual(notes[c.id], ['failed', 'CHIP.AS on Yahoo: price doesn\'t match', '']);
  assert.equal(notes[d.id][0], 'unlinked');
  assert.equal(notes[d.id][1], 'Not linked yet');
  assert.match(notes[d.id][2], /next time DEGIRO is open/);
  assert.deepEqual(notes[e.id].slice(0, 2), ['noticker', 'No Yahoo ticker for IFUS']);
  // each note is in its own Background column, right after Status; the Product cell holds the name only
  const heads = () => tab.$$('[data-dg-alarms-page] thead th').map(h => h.textContent);
  assert.deepEqual(heads(), ['Product', 'Price', 'Last', 'Alarm', 'Distance', 'Seen', 'Repeat', 'Status', 'Background', 'On', '']);
  for (const r of alarmPageRows(tab)) {
    const cells = [...r.children];
    assert.equal(cells[0].querySelector('[data-dg-alarm-bg]'), null, 'no note in the Product cell');
    assert.ok(cells[8].querySelector('[data-dg-alarm-bg]'), 'the note is under Background');
  }
  // a problem stands out from a confirmed ticker
  const colourOf = id => tab.$(`tr[data-dg-alarm-id="${id}"] [data-dg-alarm-bg]`).style.color;
  assert.notEqual(colourOf(b.id), colourOf(a.id), 'not found: warning colour');
  assert.equal(colourOf(c.id), colourOf(b.id), 'price mismatch: the same warning colour');
  assert.equal(colourOf(e.id), colourOf(b.id), 'no ticker: the same warning colour');
  assert.notEqual(colourOf(d.id), colourOf(b.id), 'not linked yet is not a warning');
  // the Columns menu hides it like any other column
  await tab.setFlag('alarmHiddenColumns', ['background']);
  await w.advance(300);
  assert.deepEqual(heads(), ['Product', 'Price', 'Last', 'Alarm', 'Distance', 'Seen', 'Repeat', 'Status', 'On', '']);
  await tab.setFlag('alarmHiddenColumns', []);
  await tab.setFlag('alarmsBackground', false);
  await w.advance(300);
  assert.equal(tab.$$('[data-dg-alarm-bg]').length, 0, 'no notes while the background check is off');
  assert.deepEqual(heads(), ['Product', 'Price', 'Last', 'Alarm', 'Distance', 'Seen', 'Repeat', 'Status', 'On', ''], 'and no Background column');
  // switched on again: the column is back, right after Status, with its notes
  await tab.setFlag('alarmsBackground', true);
  await w.advance(300);
  assert.deepEqual(heads(), ['Product', 'Price', 'Last', 'Alarm', 'Distance', 'Seen', 'Repeat', 'Status', 'Background', 'On', '']);
  assert.deepEqual(bgNotes(tab)[a.id], ['ok', '✓ MOCK.AS', 'Checked in the background with Yahoo Finance prices (MOCK.AS)']);
  noErrors(w);
});

test('Alarms page: a switched-off alarm shows a dash under Background', async () => {
  const on = alarm({ price: 5000 }), off = alarm({ productId: 456, name: 'Other', price: 5000, on: false });
  const w = createWorld({ storage: { sync: { dgAlarms: [on, off], dgTickers: { 123: { t: 'MOCK.AS', cur: '€' }, 456: { t: 'MTEC', cur: '$' } }, alarmsBackground: true } } });
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites?dg=alarms' });
  await w.advance(300);
  const row = tab.$(`tr[data-dg-alarm-id="${off.id}"]`);
  assert.equal(row.querySelector('[data-dg-alarm-bg]'), null);
  assert.equal(row.children[8].textContent, '–');
  noErrors(w);
});

test('Alarms page: a hidden Background column the menu doesn\'t offer (background check off) is not counted as hidden', async () => {
  const w = createWorld({ storage: { sync: { dgAlarms: [alarm({ price: 5000 })], alarmHiddenColumns: ['background'], alarmsBackground: false } } });
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites?dg=alarms' });
  await w.advance(300);
  const btn = () => tab.$('[data-dg-alarms-page] [data-dg-columns]');
  assert.equal(btn().textContent, 'All columns ▾', 'every column the menu offers is shown');
  assert.equal(btn().getAttribute('aria-pressed'), 'false', 'not shown as active');
  // with the check on, Background is in the menu, and hidden
  await tab.setFlag('alarmsBackground', true);
  await w.advance(300);
  assert.equal(btn().textContent, '1 hidden ▾');
  assert.equal(btn().getAttribute('aria-pressed'), 'true');
  noErrors(w);
});

test('Favourites: every product in the list with an alarm is linked to its Yahoo ticker, once', async () => {
  // above the mock prices: nothing fires
  const a = alarm({ price: 5000 }), b = alarm({ productId: 456, name: 'Mock Tech', price: 5000 });
  const { w, tab } = await setupFav([a, b]);
  await w.advance(300);
  assert.deepEqual(w.stored('sync').dgTickers, { 123: { t: 'MOCK.AS', cur: '€', isin: 'XX0000000000' }, 456: { t: 'MTEC', cur: '$', isin: 'XX0000000000' } },
    'MOCK · EAM · € and MTEC · NDQ · $; 789 (no alarm) is not linked');
  const writes = tickerWrites(w);
  await priceAt(tab, 123, 17);
  await w.advance(3000);
  assert.equal(tickerWrites(w), writes, 'price ticks write nothing more');
  noErrors(w);
});

test('Favourites: a link another writer dropped is written again, once; a link that only differs is left alone', async () => {
  const a = alarm({ price: 5000 });
  const { w, tab } = await setupFav([a]);
  await w.advance(300);
  assert.deepEqual(w.stored('sync').dgTickers, { 123: { t: 'MOCK.AS', cur: '€', isin: 'XX0000000000' } });
  // another tab or computer wrote its own list without this product
  await w.set('sync', { dgTickers: {} });
  await priceAt(tab, 123, 17);
  await w.advance(500);
  assert.deepEqual(w.stored('sync').dgTickers, { 123: { t: 'MOCK.AS', cur: '€', isin: 'XX0000000000' } }, 'linked again');
  // another source linked it differently (e.g. another currency sign): no tug of war
  await w.set('sync', { dgTickers: { 123: { t: 'MOCK.AS', cur: 'EUR' } } });
  const writes = tickerWrites(w);
  await priceAt(tab, 123, 17.5);
  await w.advance(3000);
  assert.equal(tickerWrites(w), writes);
  noErrors(w);
});

test('Alarms page: no "Checking with Yahoo…" while the background check reports an error', async () => {
  const a = alarm({ price: 5000 });
  const w = createWorld({ storage: { sync: { dgAlarms: [a], dgTickers: { 123: { t: 'MOCK.AS', cur: '€', isin: 'XX0000000000' } }, alarmsBackground: true } } });
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites?dg=alarms' });
  await w.set('local', { dgBgStatus: { at: w.now, linked: 0, total: 1, err: 'HTTP 429' } });
  await w.advance(300);
  assert.deepEqual(Object.values(bgNotes(tab)).map(n => n && n.slice(0, 2)), [['idle', 'MOCK.AS · not checked yet']]);
  noErrors(w);
});

test('Alarms page: "Checking with Yahoo…" goes after 5 minutes without a background check, with nothing else changing', async () => {
  const a = alarm({ price: 5000 });
  const w = createWorld({ storage: { sync: { dgAlarms: [a], dgTickers: { 123: { t: 'MOCK.AS', cur: '€', isin: 'XX0000000000' } }, alarmsBackground: true } } });
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites?dg=alarms' });
  await w.set('local', { dgBgStatus: { at: w.now, linked: 0, total: 1, err: '' } });
  await w.advance(300);
  assert.equal(tab.$$('[data-dg-alarm-bg=pending]').length, 1);
  await w.advance(6 * 60000);
  assert.equal(tab.$$('[data-dg-alarm-bg=pending]').length, 0);
  assert.equal(tab.$$('[data-dg-alarm-bg=idle]').length, 1, 'says it is not checked yet instead');
  noErrors(w);
});

test('Alarms page: a linked alarm Yahoo has not confirmed yet says "Checking with Yahoo…" while the check runs here', async () => {
  const a = alarm({ price: 5000 });
  const w = createWorld({ storage: { sync: { dgAlarms: [a], dgTickers: { 123: { t: 'MOCK.AS', cur: '€', isin: 'XX0000000000' } }, alarmsBackground: true } } });
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites?dg=alarms' });
  await w.advance(300);
  assert.equal(tab.$$('[data-dg-alarm-bg=pending]').length, 0, 'the check never ran in this browser (no permissions here)');
  assert.equal(tab.$('[data-dg-alarm-bg]').textContent, 'MOCK.AS · not checked yet');
  await w.set('local', { dgBgStatus: { at: w.now, linked: 0, total: 1, err: '' } });
  await w.advance(300);
  assert.equal(tab.$$('[data-dg-alarm-bg=pending]').length, 1);
  assert.equal(tab.$('[data-dg-alarm-bg]').textContent, 'Checking with Yahoo…');
  await w.set('local', { dgTickerCheck: { 'MOCK.AS|€|XX0000000000': { ok: true, f: 1, at: w.now, y: 'MOCK.AS' } } });
  await w.advance(300);
  assert.equal(tab.$('[data-dg-alarm-bg]').textContent, '✓ MOCK.AS', 'confirmed');
  noErrors(w);
});

test('Alarms page: a product seen in another list with no Yahoo ticker (unknown exchange, no ISIN) says so; linked later, the note goes', async () => {
  const fut = alarm({ productId: 555, name: 'CL DEC26', price: 5000 }), etf = alarm({ productId: 901, name: 'Mock Oil', price: 5000 });
  const w = createWorld({ storage: { sync: { dgAlarms: [fut, etf], alarmsBackground: true } } });
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites?dg=alarms', globals: { __MOCK_LISTS: { commod: [[555, 'CL DEC26', 'CL', 'IFUS', '$', 60, '']] } } });
  await w.advance(300);
  assert.equal(bgNotes(tab)[fut.id][0], 'unlinked', 'not seen yet: its list isn\'t on screen');
  tab.run(`__showList('commod')`);
  await w.advance(500);
  assert.deepEqual(w.stored('local').dgNoTicker, { 555: 'IFUS' });
  assert.equal(w.stored('sync').dgTickers, undefined, 'nothing to link');
  let n = bgNotes(tab)[fut.id];
  assert.deepEqual(n.slice(0, 2), ['noticker', 'No Yahoo ticker for IFUS']);
  assert.match(n[2], /futures and options/);
  // the energy list: Mock Oil is linked, and the futures' note stays
  tab.run(`__showList('energy')`);
  await w.advance(500);
  assert.deepEqual(w.stored('sync').dgTickers, { 901: { t: 'OIL.AS', cur: '€', isin: 'XX0000000000' } });
  assert.deepEqual(w.stored('local').dgNoTicker, { 555: 'IFUS' });
  // a link that appears for it later (another computer): the link wins
  await w.set('sync', { dgTickers: { ...w.stored('sync').dgTickers, 555: { t: 'CLX', cur: '$' } } });
  await w.advance(300);
  n = bgNotes(tab)[fut.id];
  assert.notEqual(n[0], 'noticker');
  noErrors(w);
});

// ---------- DEGIRO's product details: alarm products in no list on screen are linked by themselves ----------
/** DEGIRO's session in its own request addresses, and its product info service answering `answer(ids)` */
const infoMocks = (answer, status = 200) => {
  const calls = [];
  return { calls, globals: {
    __MOCK_RESOURCES: ['https://trader.degiro.nl/favorites/secure/v1?intAccount=42&sessionId=SID1'],
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      const ids = JSON.parse(init?.body || '[]');
      return { ok: status === 200, status, json: async () => answer(ids) };
    }
  } };
};
const ADOBE_TDG = { symbol: 'ADB', isin: 'US00724F1012', currency: 'EUR', exchangeId: '196', productType: 'STOCK', name: 'Adobe Inc' };

test('DEGIRO\'s product details link an alarm product that is in no list on screen (one request, ids only)', async () => {
  const far = alarm({ productId: 555, name: 'Adobe Inc', price: 5000 }), listed = alarm({ price: 5000 });
  const w = createWorld({ storage: { sync: { dgAlarms: [far, listed], alarmsBackground: true } } });
  const m = infoMocks(ids => ({ data: Object.fromEntries(ids.map(id => [id, id === '555' ? ADOBE_TDG : { symbol: 'WRONG', currency: 'USD', exchangeId: '663' }])) }));
  await w.open({ fixture: 'favourites', hash: '/favourites', globals: m.globals });
  await w.advance(1000);
  const info = m.calls.filter(c => c.url.includes('/product_search/secure/v5/products/info'));
  assert.equal(info.length, 1);
  assert.equal(info[0].url, '/product_search/secure/v5/products/info?intAccount=42&sessionId=SID1');
  assert.equal(info[0].init.method, 'POST');
  assert.ok(JSON.parse(info[0].init.body).includes('555'));
  assert.deepEqual(w.stored('sync').dgTickers, {
    555: { t: 'ADB.DE', cur: '€', isin: 'US00724F1012' },
    123: { t: 'MOCK.AS', cur: '€', isin: 'XX0000000000' } // the list's link stays: the details only fill gaps
  });
  await w.advance(60000);
  assert.equal(m.calls.filter(c => c.url.includes('products/info')).length, 1, 'not asked again');
  noErrors(w);
});

test('DEGIRO\'s product details: errors wait 20 s, doubling to 5 min; a good answer resets the wait', async () => {
  let status = 500, body = () => ({});
  const calls = [];
  const globals = {
    __MOCK_RESOURCES: ['https://trader.degiro.nl/favorites/secure/v1?intAccount=42&sessionId=SID1'],
    fetch: async url => { calls.push(String(url)); return { ok: status === 200, status, json: async () => body() }; }
  };
  const w = createWorld({ storage: { sync: { dgAlarms: [alarm({ productId: 555, price: 5000 })], alarmsBackground: true } } });
  await w.open({ fixture: 'favourites', hash: '/favourites', globals });
  const asked = () => calls.filter(u => u.includes('products/info')).length;
  await w.advance(1000);
  assert.equal(asked(), 1);
  await w.advance(18000);
  assert.equal(asked(), 1, 'waits 20 s');
  await w.advance(3000);
  assert.equal(asked(), 2);
  await w.advance(38000);
  assert.equal(asked(), 2, 'then 40 s');
  await w.advance(4000);
  assert.equal(asked(), 3);
  // a 200 that isn't DEGIRO's JSON (a login page, say) counts as an error too: 80 s
  status = 200; body = () => { throw new SyntaxError('Unexpected token <'); };
  await w.advance(74000); // the 3rd try was at about 61 s: the 4th is due at about 141 s
  assert.equal(asked(), 3);
  await w.advance(6000);
  assert.equal(asked(), 4);
  // capped at 5 min
  status = 500;
  for (let i = 0; i < 4; i++) await w.advance(300000);
  const capped = asked();
  await w.advance(299000);
  assert.ok(asked() - capped <= 1, 'at most one try per 5 min');
  // a good answer: linked, and nothing more to ask
  status = 200; body = () => ({ data: { 555: ADOBE_TDG } });
  await w.advance(301000);
  assert.deepEqual(w.stored('sync').dgTickers, { 555: { t: 'ADB.DE', cur: '€', isin: 'US00724F1012' } });
  const done = asked();
  await w.advance(600000);
  assert.equal(asked(), done);
  noErrors(w);
});

test('DEGIRO\'s product details: a future with no ISIN and an unknown exchange says so on the Alarms page', async () => {
  const fut = alarm({ productId: 777, name: 'CL DEC26', price: 5000 });
  const w = createWorld({ storage: { sync: { dgAlarms: [fut], alarmsBackground: true } } });
  const m = infoMocks(() => ({ data: { 777: { symbol: 'CL', currency: 'USD', exchangeId: '999', productType: 'FUTURE' } } }));
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites?dg=alarms', globals: m.globals });
  await w.advance(1000);
  assert.deepEqual(w.stored('local').dgNoTicker, { 777: '*' });
  assert.deepEqual(bgNotes(tab)[fut.id].slice(0, 2), ['noticker', 'No Yahoo ticker for this product']);
  noErrors(w);
});

test('DEGIRO\'s product details: not asked with the background check off; a refused session is not used again', async () => {
  const off = createWorld({ storage: { sync: { dgAlarms: [alarm({ productId: 555, price: 5000 })] } } });
  const m1 = infoMocks(() => ({ data: { 555: ADOBE_TDG } }));
  await off.open({ fixture: 'favourites', hash: '/favourites', globals: m1.globals });
  await off.advance(1000);
  assert.equal(m1.calls.filter(c => c.url.includes('products/info')).length, 0);

  const w = createWorld({ storage: { sync: { dgAlarms: [alarm({ productId: 555, price: 5000 })], alarmsBackground: true } } });
  const m2 = infoMocks(() => ({}), 401);
  await w.open({ fixture: 'favourites', hash: '/favourites', globals: m2.globals });
  await w.advance(1000);
  await w.advance(400000);
  assert.equal(m2.calls.filter(c => c.url.includes('products/info')).length, 1, 'session SID1 refused: never again');
  assert.equal(w.stored('sync').dgTickers, undefined);
  noErrors(w);
});

// ---------- Société Générale's own products (DEGIRO's SCG venue) ----------
// like DEGIRO's SG list (2026-11-18): the ISIN alone in "Symbol | ISIN" for most, "TH71S | NLSGE001BVD5" for one
const SG_LIST = { SG: [[27831987, 'SG S&P 500 Factor (Multi) Long LEV 10', 'DE000SU054L9', 'SCG', '€', 26.49, ''],
  [27720940, 'SG S&P 500 Tracker 100%', 'TH71S', 'SCG', '€', 16.88, 'NLSGE001BVD5']] };

test('SG products are linked to SG\'s prices from the list, replacing what the earlier version stored for them', async () => {
  const lev = alarm({ productId: 27831987, name: 'SG S&P 500 Factor (Multi) Long LEV 10', price: 5000 });
  const trk = alarm({ productId: 27720940, name: 'SG S&P 500 Tracker 100%', price: 5000 });
  const w = createWorld({ storage: {
    // the state the earlier version left: a "no ticker" note for the bare-ISIN row, an ISIN-only Yahoo link for the other
    sync: { dgAlarms: [lev, trk], alarmsBackground: true, dgTickers: { 27720940: { t: '', cur: '€', isin: 'NLSGE001BVD5' } } },
    local: { dgNoTicker: { 27831987: 'SCG' } }
  } });
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites?dg=alarms', globals: { __MOCK_LISTS: SG_LIST } });
  await w.advance(300);
  assert.equal(bgNotes(tab)[lev.id][0], 'unlinked', 'the old SCG note is gone');
  tab.run(`__showList('SG')`);
  await w.advance(500);
  assert.deepEqual(w.stored('sync').dgTickers, {
    27831987: { t: '', cur: '€', isin: 'DE000SU054L9', v: 'sg' },
    27720940: { t: '', cur: '€', isin: 'NLSGE001BVD5', v: 'sg' }
  });
  assert.equal(bgNotes(tab)[lev.id][0], 'idle', 'linked, waiting for the check; no "no ticker" note (the old SCG one is ignored)');
  // confirmed by the worker: "✓ code (Société Générale)"
  await w.set('local', { dgTickerCheck: { '|€|DE000SU054L9|sg': { ok: true, f: 1, at: w.now, y: 'SU054L',
    sg: { id: '3781712', pc: 'CBDE', aid: '693', an: 'S+P500_INDEX', ar: '.SPX', ac: 'CBUL', cur: 'EUR', code: 'SU054L' } } } });
  await w.advance(300);
  assert.deepEqual(bgNotes(tab)[lev.id], ['ok', '✓ SU054L (Société Générale)', 'Checked in the background with Société Générale\'s live prices (SU054L)']);
  noErrors(w);
});

test('Alarms page: an SG link that is checking or failed names Société Générale, not Yahoo', async () => {
  const lev = alarm({ productId: 27831987, name: 'SG S&P 500 Factor (Multi) Long LEV 10', price: 5000 });
  const w = createWorld({ storage: {
    sync: { dgAlarms: [lev], alarmsBackground: true, dgTickers: { 27831987: { t: '', cur: '€', isin: 'DE000SU054L9', v: 'sg' } } },
    local: { dgBgStatus: { at: Date.now(), linked: 0, total: 1, err: '' } }
  } });
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites?dg=alarms' });
  await w.set('local', { dgBgStatus: { at: w.now, linked: 0, total: 1, err: '' } });
  await w.advance(300);
  assert.deepEqual(bgNotes(tab)[lev.id].slice(0, 2), ['pending', 'Checking with Société Générale…']);
  await w.set('local', { dgTickerCheck: { '|€|DE000SU054L9|sg': { ok: false, f: 0, at: w.now, why: 'missing' } } });
  await w.advance(300);
  assert.deepEqual(bgNotes(tab)[lev.id].slice(0, 2), ['failed', 'DE000SU054L9 not found at Société Générale']);
  noErrors(w);
});

const SG_LEV_INFO = { name: 'SG S&P 500 Factor (Multi) Long LEV 10', isin: 'DE000SU054L9', productType: 'LEVERAGED', currency: 'EUR', exchangeId: '192' };

test('SG products: DEGIRO\'s product details (exchange 192) link them too, with no link yet', async () => {
  const lev = alarm({ productId: 27831987, name: 'SG S&P 500 Factor (Multi) Long LEV 10', price: 5000 });
  const w = createWorld({ storage: { sync: { dgAlarms: [lev], alarmsBackground: true } } });
  const m = infoMocks(() => ({ data: { 27831987: SG_LEV_INFO } }));
  await w.open({ fixture: 'favourites', hash: '/favourites', globals: m.globals });
  await w.advance(1000);
  assert.deepEqual(w.stored('sync').dgTickers, { 27831987: { t: '', cur: '€', isin: 'DE000SU054L9', v: 'sg' } });
  noErrors(w);
});

// an earlier build linked SG products by ISIN alone (no venue): Yahoo didn't find them ("… not found on Yahoo")
const ISIN_ONLY_SG = () => ({
  sync: { dgAlarms: [alarm({ productId: 27831987, name: 'SG S&P 500 Factor (Multi) Long LEV 10', price: 5000 })], alarmsBackground: true,
    dgTickers: { 27831987: { t: '', cur: '€', isin: 'DE000SU054L9' } } },
  local: { dgTickerCheck: { '|€|DE000SU054L9': { ok: false, f: 0, at: Date.now(), why: 'missing' } } }
});

test('SG products: an ISIN-only link (no venue) is upgraded from DEGIRO\'s product details, with the SG list not on screen', async () => {
  const w = createWorld({ storage: ISIN_ONLY_SG() });
  const m = infoMocks(() => ({ data: { 27831987: SG_LEV_INFO } }));
  await w.open({ fixture: 'favourites', hash: '/favourites?dg=alarms', globals: m.globals });
  await w.advance(1000);
  const info = m.calls.filter(c => c.url.includes('products/info'));
  assert.equal(info.length, 1);
  assert.deepEqual(JSON.parse(info[0].init.body), ['27831987']);
  assert.deepEqual(w.stored('sync').dgTickers, { 27831987: { t: '', cur: '€', isin: 'DE000SU054L9', v: 'sg' } });
  await w.advance(600000);
  assert.equal(m.calls.filter(c => c.url.includes('products/info')).length, 1, 'linked to SG: not asked again');
  noErrors(w);
});

test('SG products: an ISIN-only link DEGIRO doesn\'t place on SG\'s venue stays as it is, asked once per tab', async () => {
  const w = createWorld({ storage: ISIN_ONLY_SG() });
  const m = infoMocks(() => ({ data: { 27831987: { ...SG_LEV_INFO, exchangeId: '999' } } }));
  await w.open({ fixture: 'favourites', hash: '/favourites?dg=alarms', globals: m.globals });
  await w.advance(1000);
  assert.equal(m.calls.filter(c => c.url.includes('products/info')).length, 1);
  await w.advance(600000); // well past the longest back-off (5 min)
  assert.equal(m.calls.filter(c => c.url.includes('products/info')).length, 1, 'not asked again in this tab');
  assert.deepEqual(w.stored('sync').dgTickers, { 27831987: { t: '', cur: '€', isin: 'DE000SU054L9' } });
  assert.equal(tickerWrites(w), 0, 'nothing changed: nothing written');
  noErrors(w);
});

test('the product header (no ISIN): no "no ticker" note, and a venue it can\'t tell leaves an SG link alone', async () => {
  const Highcharts = { Chart: function() { const s = { setData() {}, data: [{ update() {} }] }; return { series: [s] }; } };
  const product = async (exchange, tickers) => {
    const w = createWorld({ storage: { sync: { dgAlarms: [alarm({ price: 18 })], dgTickers: tickers } } });
    // the header's exchange name, as DEGIRO would show another venue
    await w.open({ fixture: 'degiro', hash: '/products/123/overview', globals: { __MOCK_NO_URL_SESSION: true, Highcharts, __MOCK_BRIEF: ['MOCK', exchange] } });
    await w.advance(500);
    return w;
  };
  const SG_LINK = { 123: { t: '', cur: '€', isin: 'DE000SU054L9', v: 'sg' } };
  let w = await product('Some Venue', SG_LINK);
  assert.deepEqual(w.stored('sync').dgTickers, SG_LINK, 'an unknown venue: the SG link stays');
  assert.equal(w.stored('local').dgNoTicker, undefined, 'the header shows no ISIN: it can\'t say there is no ticker');
  noErrors(w);
  w = await product('Some Venue', {});
  assert.deepEqual(w.stored('sync').dgTickers, {}, 'nothing to link');
  assert.equal(w.stored('local').dgNoTicker, undefined);
  noErrors(w);
});

test('an SG product\'s page links it: DEGIRO shows its ISIN in the symbol\'s place and "Societe Generale OTC"', async () => {
  const Highcharts = { Chart: function() { const s = { setData() {}, data: [{ update() {} }] }; return { series: [s] }; } };
  const w = createWorld({ storage: { sync: { dgAlarms: [alarm({ price: 18 })] } } });
  // like DEGIRO's header of SG S&P 500 Factor (Multi) Long LEV 10 (2026-11-18)
  await w.open({ fixture: 'degiro', hash: '/products/123/overview',
    globals: { __MOCK_NO_URL_SESSION: true, Highcharts, __MOCK_BRIEF: ['DE000SU054L9', 'Societe Generale OTC'] } });
  await w.advance(500);
  assert.deepEqual(w.stored('sync').dgTickers, { 123: { t: '', cur: '€', isin: 'DE000SU054L9', v: 'sg' } });
  noErrors(w);
});

test('Alarms page: a ticker the ISIN search found says so', async () => {
  const a = alarm({ price: 5000 });
  const w = createWorld({ storage: {
    sync: { dgAlarms: [a], dgTickers: { 123: { t: 'MOCK.AS', cur: '€', isin: 'XX0000000000' } }, alarmsBackground: true },
    local: { dgTickerCheck: { 'MOCK.AS|€|XX0000000000': { ok: true, f: 1, at: 1, y: 'MCK.DE', via: 'isin' } } }
  } });
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites?dg=alarms' });
  await w.advance(300);
  assert.equal(tab.$('[data-dg-alarm-bg]').textContent, '✓ MCK.DE (via ISIN)');
  noErrors(w);
});

test('the product page (no ISIN in its header) keeps the ISIN the Favourites list linked', async () => {
  const w = createWorld({ storage: { sync: { dgAlarms: [alarm({ price: 18 })], dgTickers: { 123: { t: 'MOCK.AS', cur: '€', isin: 'XX0000000000' } } } } });
  const Highcharts = { Chart: function() { const s = { setData() {}, data: [{ update() {} }] }; return { series: [s] }; } };
  await w.open({ fixture: 'degiro', hash: '/products/123/overview', globals: { __MOCK_NO_URL_SESSION: true, Highcharts } });
  await w.advance(500);
  assert.deepEqual(w.stored('sync').dgTickers, { 123: { t: 'MOCK.AS', cur: '€', isin: 'XX0000000000' } });
  assert.equal(tickerWrites(w), 0);
  noErrors(w);
});
