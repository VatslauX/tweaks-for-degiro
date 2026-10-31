// The product header items from exdiv.js: "Ex-div <date>" and "Earnings <date>", their order in the
// shared header container, which date is read, past dates, and what clicking one opens.
// JSDOM has no layout, so the two things exdiv.js asks the layout for are faked per test: the header
// line is only taken when DEGIRO's daily-change element is visible (a height), and revealing a widget
// scrolls it into view. Everything about the real layout (wrapping, the sticky header copy, colours)
// stays in tests/e2e/exdiv.spec.js and tests/e2e/earnings.spec.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('./harness');

const noErrors = w => assert.deepEqual(w.errors.map(e => e.stack || String(e)), []);

const PRODUCT_GLOBALS = {
  __MOCK_NO_URL_SESSION: true,
  Highcharts: { Chart: function() { return { series: [{ setData() {}, data: [{ update() {} }] }] }; } }
};

// every element gets a height (so the header line counts as visible), and scrollIntoView records
// what was revealed instead of scrolling
const FAKE_LAYOUT = `
  Element.prototype.getBoundingClientRect = function () {
    return { width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0, toJSON() { return {}; } };
  };
  window.__revealed = [];
  Element.prototype.scrollIntoView = function () { window.__revealed.push(this.id || this.tagName); };
`;

async function openProduct(w, { globals = {}, settings } = {}) {
  const tab = await w.open({ fixture: 'degiro', hash: '/products/123/overview', settings, globals: { ...PRODUCT_GLOBALS, ...globals } });
  tab.run(FAKE_LAYOUT);
  // the features ran once already, when nothing had a height yet: one DOM change runs them again
  tab.document.body.appendChild(tab.document.createElement('i'));
  await w.advance(2500);
  return tab;
}
/** a DEGIRO rerender: any foreign DOM change runs the features again */
const touch = async (w, tab) => { tab.document.body.appendChild(tab.document.createElement('i')); await w.advance(300); };
const item = (tab, id) => tab.$(`#${id}`);
const value = (tab, id) => item(tab, id)?.lastElementChild.textContent;
const label = (tab, id) => item(tab, id)?.firstElementChild.textContent;

test('both items sit in the shared header container, after the price line and in rank order', async () => {
  const w = createWorld();
  const tab = await openProduct(w);
  const box = tab.$('[data-dg-header]');
  assert.ok(box, 'one container for every header item of ours');
  assert.equal(box.previousElementSibling.id, 'priceHeader', 'right after DEGIRO\'s own price line');
  assert.equal(box.hasAttribute('data-dg-own'), true, 'marked as ours, so it starts no new runs');
  // header spread (content.js) is rank 1, ex-div 2, earnings 3
  assert.deepEqual([...box.children].map(c => c.id), ['dg-header-spread', 'dg-exdiv', 'dg-earnings']);
  assert.deepEqual([...box.children].map(c => c.getAttribute('data-dg-rank')), ['1', '2', '3']);
  assert.equal(label(tab, 'dg-exdiv'), 'Ex-div');
  assert.equal(value(tab, 'dg-exdiv'), '12/11/2099');
  assert.equal(label(tab, 'dg-earnings'), 'Earnings');
  assert.equal(value(tab, 'dg-earnings'), '02/02/2099');
  assert.equal(tab.json('__dgt.status().exDividend'), 'ok');
  assert.equal(tab.json('__dgt.status().earningsDate'), 'ok');
  noErrors(w);
});

test('a date still to come gets the plain title; a date that has passed says so and is muted', async () => {
  const w = createWorld();
  const tab = await openProduct(w);
  assert.equal(item(tab, 'dg-exdiv').title, 'Ex-dividend date — go to Dividends');
  assert.equal(item(tab, 'dg-exdiv').lastElementChild.style.color, 'rgb(0, 159, 223)', 'DEGIRO blue');
  assert.equal(item(tab, 'dg-earnings').title, 'Next earnings date — go to Earnings');

  const exdiv = tab.$('time[data-field=exDividendDate]');
  exdiv.removeAttribute('datetime');
  exdiv.textContent = '12/11/2020';
  tab.$('#earnWidget time[data-field=dateTime]').textContent = '02/02/2020';
  await touch(w, tab);
  assert.equal(value(tab, 'dg-exdiv'), '12/11/2020');
  assert.equal(item(tab, 'dg-exdiv').title, 'Ex-dividend date (past) — go to Dividends');
  assert.equal(item(tab, 'dg-exdiv').lastElementChild.style.color, 'rgb(121, 138, 144)', 'muted');
  assert.equal(item(tab, 'dg-earnings').title, 'Earnings date (past) — go to Earnings');
  noErrors(w);
});

test('today is not past, and the ex-dividend date is read from the ISO attribute when there is one', async () => {
  const w = createWorld();
  const tab = await openProduct(w);
  const exdiv = tab.$('time[data-field=exDividendDate]');
  const today = new Date(w.now);
  const dd = String(today.getDate()).padStart(2, '0'), mm = String(today.getMonth() + 1).padStart(2, '0');
  exdiv.removeAttribute('datetime');
  exdiv.textContent = `${dd}/${mm}/${today.getFullYear()}`;
  await touch(w, tab);
  assert.equal(item(tab, 'dg-exdiv').title, 'Ex-dividend date — go to Dividends', 'today still counts as to come');

  // an ISO attribute in the past wins over the shown text for the ex-dividend date
  exdiv.setAttribute('datetime', '2020-11-12T00:00:00Z');
  await touch(w, tab);
  assert.equal(item(tab, 'dg-exdiv').title, 'Ex-dividend date (past) — go to Dividends');
  assert.equal(value(tab, 'dg-exdiv'), `${dd}/${mm}/${today.getFullYear()}`, 'the shown date is DEGIRO\'s own text');
  noErrors(w);
});

test('the earnings date follows the day DEGIRO shows, not its ISO time zone', async () => {
  const w = createWorld();
  const tab = await openProduct(w);
  const earn = tab.$('#earnWidget time[data-field=dateTime]');
  // the shown day has passed although the ISO instant is still to come (another time zone)
  earn.setAttribute('datetime', '2099-02-02T21:00:00.000Z');
  earn.textContent = '02/02/2020';
  await touch(w, tab);
  assert.equal(item(tab, 'dg-earnings').title, 'Earnings date (past) — go to Earnings');
  assert.equal(value(tab, 'dg-earnings'), '02/02/2020');
  noErrors(w);
});

test('only the date inside the Earnings widget is used, and only when it holds digits', async () => {
  const w = createWorld();
  const tab = await openProduct(w);
  // DEGIRO uses data-field=dateTime elsewhere too: a stray one must not become the earnings date
  const stray = tab.document.createElement('time');
  stray.setAttribute('data-field', 'dateTime');
  stray.textContent = '01/01/2001';
  tab.$('#divWidget').appendChild(stray);
  await touch(w, tab);
  assert.equal(value(tab, 'dg-earnings'), '02/02/2099', 'still the one in the Earnings widget');

  tab.$('#earnWidget time[data-field=dateTime]').textContent = '—';
  await touch(w, tab);
  assert.equal(item(tab, 'dg-earnings'), null, 'a date placeholder is no date');
  assert.equal(tab.json('__dgt.status().earningsDate'), 'idle', 'not every product reports earnings');
  assert.ok(item(tab, 'dg-exdiv'), 'the ex-dividend item is not affected');
  noErrors(w);
});

test('no date at all: the item goes and the container stays only for the other one', async () => {
  const w = createWorld();
  const tab = await openProduct(w);
  tab.$('time[data-field=exDividendDate]').remove();
  await touch(w, tab);
  assert.equal(item(tab, 'dg-exdiv'), null);
  assert.equal(tab.json('__dgt.status().exDividend'), 'idle');
  assert.ok(tab.$('[data-dg-header]'), 'the container is still needed by the other items');
  assert.ok(item(tab, 'dg-earnings'));
  noErrors(w);
});

test('clicking or pressing Enter on an item reveals DEGIRO\'s own widget', async () => {
  const w = createWorld();
  const tab = await openProduct(w);
  const hash = tab.window.location.hash;
  item(tab, 'dg-exdiv').dispatchEvent(new tab.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await w.flush();
  assert.deepEqual(tab.json('window.__revealed'), ['divWidget'], 'the Dividends widget, not the section around both');

  item(tab, 'dg-earnings').dispatchEvent(new tab.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await w.flush();
  assert.deepEqual(tab.json('window.__revealed'), ['divWidget', 'earnWidget']);
  assert.equal(tab.window.location.hash, hash, 'the app\'s route is never touched');
  assert.equal(item(tab, 'dg-exdiv').getAttribute('role'), 'link');
  assert.equal(item(tab, 'dg-exdiv').tabIndex, 0, 'reachable with the keyboard');
  noErrors(w);
});

test('a widget DEGIRO only labels with a heading is still found', async () => {
  const w = createWorld();
  const tab = await openProduct(w);
  tab.$('#dividends-widget-title').removeAttribute('id'); // no hook left, only the title text
  await touch(w, tab);
  item(tab, 'dg-exdiv').dispatchEvent(new tab.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await w.flush();
  assert.deepEqual(tab.json('window.__revealed'), ['divWidget'], 'found by its "Dividends" heading');
  noErrors(w);
});

test('each item can be switched off on its own; with both off the container goes', async () => {
  const w = createWorld();
  const tab = await openProduct(w);
  await tab.setFlag('exDividend', false);
  await w.advance(200);
  assert.equal(item(tab, 'dg-exdiv'), null);
  assert.ok(item(tab, 'dg-earnings'), 'the earnings item stays');
  assert.equal(tab.json('__dgt.status().exDividend'), 'off');

  await tab.setFlag('earningsDate', false);
  await tab.setFlag('headerSpread', false);
  await w.advance(200);
  assert.equal(item(tab, 'dg-earnings'), null);
  assert.equal(tab.$('[data-dg-header]'), null, 'an empty container is removed');
  assert.deepEqual(tab.$$('#dg-exdiv, #dg-earnings, #dg-header-spread'), [], 'no header item of ours is left');

  await tab.setFlag('exDividend', true);
  await w.advance(2500);
  assert.equal(value(tab, 'dg-exdiv'), '12/11/2099', 'and it comes back');
  noErrors(w);
});

test('a header DEGIRO changed: a date with nowhere to put it reports missing', async () => {
  const w = createWorld();
  const tab = await openProduct(w);
  tab.$$('[data-field=RelativeDifference]').forEach(el => el.remove());
  await touch(w, tab);
  assert.equal(item(tab, 'dg-exdiv'), null);
  assert.equal(tab.json('__dgt.status().exDividend'), 'loading', 'the page only just opened');
  await w.advance(9000); // LOADING_MS
  assert.equal(tab.json('__dgt.status().exDividend'), 'missing');
  noErrors(w);
});

test('nothing is added outside a product page', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites' });
  tab.run(FAKE_LAYOUT);
  await w.advance(2500);
  assert.equal(tab.$('[data-dg-header]'), null);
  assert.equal(tab.json('__dgt.status().exDividend'), 'idle');
  assert.equal(tab.json('__dgt.status().earningsDate'), 'idle');
  noErrors(w);
});
