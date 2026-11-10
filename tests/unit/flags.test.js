// extension/flags.js: the settings contract. dgSanitize() is what stands between chrome.storage.sync
// (which another device, an older version or a corrupted sync can fill with anything) and every
// feature, so every stored value is checked here. The live read/retry/bridge behaviour is in
// tests/integration/settings.test.js; this file only needs the pure parts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// flags.js is a plain content script (no exports), so it runs in a sandbox to reach its top-level
// names. Without `chrome` its first storage read throws and is swallowed, and with a non-http
// location it starts no timers — nothing is left running.
const sandbox = { location: { protocol: 'file:' }, setTimeout, clearTimeout, setInterval, clearInterval, console };
const FLAGS_JS = path.join(__dirname, '../../extension/flags.js');
const source = fs.readFileSync(FLAGS_JS, 'utf8');
// its top-level names are const/function, not globals: the script's last expression hands them over
const picked = 'DG_DEFAULTS, DG_PAGE_FLAGS, DG_TX_COLUMNS, DG_ORDER_COLUMNS, DG_PORTFOLIO_COLUMNS, DG_ALARM_COLUMNS, DG_MAX_TITLES, DG_MAX_TITLE_LEN, dgSanitize, dgOnSettings, dgSettings';
const { DG_DEFAULTS, DG_PAGE_FLAGS, DG_TX_COLUMNS, DG_ORDER_COLUMNS, DG_PORTFOLIO_COLUMNS, DG_ALARM_COLUMNS, DG_MAX_TITLES, DG_MAX_TITLE_LEN, dgSanitize, dgOnSettings, dgSettings } =
  vm.runInNewContext(`${source}\n;({ ${picked} });`, sandbox, { filename: FLAGS_JS });

// values made inside the sandbox have that realm's prototypes: compare them as plain data
const plain = v => JSON.parse(JSON.stringify(v));
const sanitize = s => plain(dgSanitize(s));
const DEFAULTS = plain(DG_DEFAULTS);
const PAGE_FLAGS = plain(DG_PAGE_FLAGS);
const TX_COLUMNS = plain(DG_TX_COLUMNS);
const ORDER_COLUMNS = plain(DG_ORDER_COLUMNS);
const PORTFOLIO_COLUMNS = plain(DG_PORTFOLIO_COLUMNS);
const ALARM_COLUMNS = plain(DG_ALARM_COLUMNS);

// The portfolio merged-table feature ships off by default (Task 3); every other switch stays on.
const OFF_BY_DEFAULT = ['portfolioMergedTable', 'portfolioMergedPersist'];

test('defaults: every feature is on except the portfolio merge toggles, and the lists are the column lists and the titles', () => {
  const lists = Object.keys(DEFAULTS).filter(k => Array.isArray(DEFAULTS[k]));
  assert.deepEqual(lists.sort(), ['alarmHiddenColumns', 'hiddenTitles', 'ordersHiddenColumns', 'portfolioHiddenColumns', 'txHiddenColumns']);
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (Array.isArray(v)) continue;
    if (OFF_BY_DEFAULT.includes(k)) { assert.equal(v, false, `${k} is off by default`); continue; }
    assert.equal(v, true, `${k} is on by default`);
  }
  assert.ok(DEFAULTS.hiddenTitles.length, 'Cash compensation titles are listed');
});

test('page flags are a subset of the settings, and only switches', () => {
  for (const k of PAGE_FLAGS) {
    assert.ok(k in DEFAULTS, `${k} is a real setting`);
    assert.equal(typeof DEFAULTS[k], 'boolean', `${k} is a switch`);
  }
  assert.equal(new Set(PAGE_FLAGS).size, PAGE_FLAGS.length, 'no duplicates');
});

test('hidable columns are known and never include Product', () => {
  for (const list of [TX_COLUMNS, ORDER_COLUMNS, PORTFOLIO_COLUMNS, ALARM_COLUMNS]) {
    assert.equal(new Set(list).size, list.length, 'no duplicates');
    assert.ok(!list.includes('product'), 'Product can never be hidden');
  }
  assert.ok(!PORTFOLIO_COLUMNS.includes('type'), 'Type can never be hidden');
  assert.ok(!ALARM_COLUMNS.includes('on'), 'On can never be hidden');
  for (const c of DEFAULTS.txHiddenColumns) assert.ok(TX_COLUMNS.includes(c), `${c} is a Transactions column`);
  for (const c of DEFAULTS.ordersHiddenColumns) assert.ok(ORDER_COLUMNS.includes(c), `${c} is an Orders column`);
  for (const c of DEFAULTS.portfolioHiddenColumns) assert.ok(PORTFOLIO_COLUMNS.includes(c), `${c} is a Portfolio column`);
  for (const c of DEFAULTS.alarmHiddenColumns) assert.ok(ALARM_COLUMNS.includes(c), `${c} is an Alarms column`);
});

test('nothing stored, or something that is not an object: the defaults', () => {
  for (const bad of [undefined, null, 0, '', 'spread', 42, true, [1, 2]]) {
    assert.deepEqual(sanitize(bad), DEFAULTS, `${JSON.stringify(bad)} → defaults`);
  }
  assert.notEqual(dgSanitize(null), DG_DEFAULTS, 'a copy, never the defaults object itself');
  const out = dgSanitize({});
  out.spread = false;
  assert.equal(DG_DEFAULTS.spread, true, 'a switch set on the result does not change the defaults');
  // the result is a shallow copy: a default list is the very same array, so nothing may mutate
  // what comes out of dgSanitize() (readers only filter, map and include it)
  assert.equal(out.hiddenTitles, DG_DEFAULTS.hiddenTitles);
  assert.deepEqual(sanitize({}).hiddenTitles, DEFAULTS.hiddenTitles);
});

test('switches: booleans are kept, other values are coerced, missing ones fall back', () => {
  const s = sanitize({ spread: false, orders: true, navLinks: 'no', chartSelect: 0, ordersClick: 1, adjustClose: '', periodChange: null, alarmLines: undefined, priceAlarms: {} });
  assert.equal(s.spread, false);
  assert.equal(s.orders, true);
  assert.equal(s.navLinks, true, 'a non-empty string is on (this is how an older version\'s value survives)');
  assert.equal(s.chartSelect, false, '0 is off');
  assert.equal(s.ordersClick, true, '1 is on');
  assert.equal(s.adjustClose, false, 'the empty string is off');
  assert.equal(s.periodChange, true, 'null is not a value: the default');
  assert.equal(s.alarmLines, true, 'undefined is not a value: the default');
  assert.equal(s.priceAlarms, true, 'an object is truthy');
  for (const v of Object.values(s)) assert.ok(typeof v === 'boolean' || Array.isArray(v), 'only switches and lists come out');
});

test('an unknown stored key is dropped, never passed through', () => {
  const s = sanitize({ spread: true, evil: '<script>', nested: { a: 1 } });
  assert.deepEqual(Object.keys(s).sort(), Object.keys(DEFAULTS).sort());
});

test('hidden titles: text only, trimmed, cut to 100 characters, at most 30', () => {
  const s = sanitize({ hiddenTitles: ['  Keep me  ', '', '   ', 5, null, { t: 'x' }, ['a'], 'x'.repeat(150), ...Array.from({ length: 40 }, (_, i) => `t${i}`)] });
  assert.equal(s.hiddenTitles[0], 'Keep me', 'trimmed');
  assert.equal(s.hiddenTitles[1], 'x'.repeat(DG_MAX_TITLE_LEN), 'cut, and the blank ones are gone');
  assert.equal(s.hiddenTitles.length, DG_MAX_TITLES, 'at most 30 (chrome.storage.sync quotas)');
  assert.equal(DG_MAX_TITLES, 30);
  assert.equal(DG_MAX_TITLE_LEN, 100);
  assert.ok(s.hiddenTitles.every(t => typeof t === 'string' && t && t.length <= DG_MAX_TITLE_LEN));

  assert.deepEqual(sanitize({ hiddenTitles: [] }).hiddenTitles, [], 'an empty list is a real choice, not a missing value');
  assert.deepEqual(sanitize({ hiddenTitles: 'Cash compensation' }).hiddenTitles, DEFAULTS.hiddenTitles, 'a string instead of a list: the defaults');
  assert.deepEqual(sanitize({ hiddenTitles: [1, 2, 3] }).hiddenTitles, [], 'nothing usable in the list');
});

test('hidden columns: only known ones, always in the table\'s own order', () => {
  assert.deepEqual(sanitize({ txHiddenColumns: ['fees', 'bogus', 'date', 'product', 'DATE'] }).txHiddenColumns,
    ['date', 'fees'], 'unknown and wrongly-cased names dropped, canonical order');
  assert.deepEqual(sanitize({ ordersHiddenColumns: ['outstanding', 'action'] }).ordersHiddenColumns, ['action', 'outstanding']);
  assert.deepEqual(sanitize({ txHiddenColumns: [] }).txHiddenColumns, [], 'hide nothing is a real choice');
  assert.deepEqual(sanitize({ txHiddenColumns: 'date' }).txHiddenColumns, DEFAULTS.txHiddenColumns, 'not a list: the defaults');
  assert.deepEqual(sanitize({ ordersHiddenColumns: { 0: 'date' } }).ordersHiddenColumns, DEFAULTS.ordersHiddenColumns);
  // every column at once is accepted: Product has no entry, so the table always keeps a column
  assert.deepEqual(sanitize({ txHiddenColumns: [...TX_COLUMNS] }).txHiddenColumns, TX_COLUMNS);
});

test('portfolio settings default and sanitize', () => {
  assert.equal(sanitize({}).portfolioMergedTable, false);
  assert.deepEqual(sanitize({}).portfolioHiddenColumns, ['symbolIsin', 'exchange', 'last', 'delay']);
  assert.deepEqual(sanitize({ portfolioHiddenColumns: ['bogus', 'qty'] }).portfolioHiddenColumns, ['qty']);
  assert.equal(sanitize({ portfolioMergedPersist: 'yes' }).portfolioMergedPersist, true);
});

test('alarm columns default and sanitize', () => {
  assert.deepEqual(sanitize({}).alarmHiddenColumns, [], 'all columns visible by default');
  assert.deepEqual(sanitize({ alarmHiddenColumns: ['bogus', 'price'] }).alarmHiddenColumns, ['price']);
  assert.deepEqual(sanitize({ alarmHiddenColumns: [] }).alarmHiddenColumns, [], 'hide nothing is a real choice');
  assert.deepEqual(sanitize({ alarmHiddenColumns: 'last' }).alarmHiddenColumns, DEFAULTS.alarmHiddenColumns, 'not a list: the defaults');
});

test('dgOnSettings(fn) runs the listener at once with the current settings', () => {
  /** @type {any[]} */ const seen = [];
  dgOnSettings(s => seen.push(s));
  assert.equal(seen.length, 1, 'called immediately');
  assert.equal(seen[0], dgSettings, 'with the live settings object every feature reads');
  assert.equal(seen[0].spread, true);
});
