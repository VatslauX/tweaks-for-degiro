// Price alarm rules (extension/alarm-rules.js): sanitising stored data and when an alarm fires.
const { test } = require('node:test');
const assert = require('node:assert');
const R = require('../../extension/alarm-rules.js');

const A = { id: 'a1', productId: 123, name: 'Mock ETF', symbol: 'MOCK', currency: '€', price: 20, dir: 'above', repeat: 'once', on: true, created: 1 };
const DAY = 864e5, NOON = new Date(2026, 9, 29, 12).getTime();

test('sanitize keeps valid alarms and drops malformed ones', () => {
  assert.deepStrictEqual(R.sanitize([A]), [A]);
  assert.deepStrictEqual(R.sanitize('x'), []);
  assert.deepStrictEqual(R.sanitize(null), []);
  const bad = [
    null, 5, { ...A, id: '' }, { ...A, id: 'has space' }, { ...A, productId: -1 }, { ...A, productId: 1.5 },
    { ...A, productId: '123' }, { ...A, price: 0 }, { ...A, price: NaN }, { ...A, price: Infinity }, { ...A, price: '20' },
    { ...A, dir: 'up' }, { ...A, repeat: 'hourly' }
  ];
  assert.deepStrictEqual(R.sanitize(bad), []);
});

test('sanitize drops duplicate ids, unknown fields, caps texts and the list', () => {
  const out = R.sanitize([A, { ...A, name: 'second' }, { ...A, id: 'a2', extra: '<b>', name: 'x'.repeat(200), symbol: 'S'.repeat(30), currency: 'EURO€' }]);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].name, 'Mock ETF');
  assert.strictEqual(out[1].name.length, 50);
  assert.strictEqual(out[1].symbol.length, 12);
  assert.strictEqual(out[1].currency.length, 4);
  assert.ok(!('extra' in out[1]));
  assert.strictEqual(R.sanitize(Array.from({ length: 40 }, (_, i) => ({ ...A, id: 'a' + i }))).length, R.MAX);
  assert.strictEqual(R.sanitize([{ ...A, on: undefined }])[0].on, true);
  assert.strictEqual(R.sanitize([{ ...A, on: false }])[0].on, false);
});

test('the worst possible list fits in one chrome.storage.sync item (8192 bytes)', () => {
  // Multi-byte text and control characters at every cap, the longest id, the largest numbers.
  const cjk = '漢'.repeat(60) + '\u0000\u0007\u007f';
  const list = Array.from({ length: R.MAX }, (_, i) => ({ ...A, id: crypto.randomUUID(), productId: 9999999999 - i,
    name: cjk, symbol: '漢'.repeat(12), currency: '漢'.repeat(4), price: 999999999.123457,
    repeat: 'daily', dir: 'above', on: false, created: 9999999999999 }));
  const out = R.sanitize(list);
  assert.strictEqual(out.length, R.MAX);
  const bytes = Buffer.byteLength(JSON.stringify(out)) + 'dgAlarms'.length;
  assert.ok(bytes < 8192, `${bytes} bytes`);
});

test('the worst quote and backslash list fits too (JSON escapes them to 2 bytes each)', () => {
  const list = Array.from({ length: R.MAX }, (_, i) => ({ ...A, id: crypto.randomUUID(), productId: 9999999999 - i,
    name: '"\\'.repeat(40), symbol: '"'.repeat(20), currency: '\\'.repeat(9),
    price: 999999999.123457, repeat: 'daily', dir: 'above', on: false, created: 9999999999999 }));
  const out = R.sanitize(list);
  assert.strictEqual(out.length, R.MAX);
  assert.ok(Buffer.byteLength(JSON.stringify(out)) + 'dgAlarms'.length < 8192);
  assert.ok(out.every(a => a.name.length <= 50 && Buffer.byteLength(JSON.stringify(a.name)) - 2 <= 90));
});

test('control characters are removed from texts', () => {
  assert.strictEqual(R.sanitize([{ ...A, name: 'a\u0000b\u007fc\u009fd\u0001' }])[0].name, 'abcd');
});

test('names are capped at 90 UTF-8 bytes without splitting an emoji', () => {
  const name = R.sanitize([{ ...A, name: '😀'.repeat(40) }])[0].name;
  assert.strictEqual(name, '😀'.repeat(22));
  assert.ok(Buffer.byteLength(name) <= 90);
});

test('price is rounded to 6 decimals; 0 after rounding and 1e9 or more are rejected', () => {
  assert.strictEqual(R.sanitize([{ ...A, price: 20.12345678 }])[0].price, 20.123457);
  assert.deepStrictEqual(R.sanitize([{ ...A, price: 1e-7 }]), []);
  assert.deepStrictEqual(R.sanitize([{ ...A, price: 1e9 }]), []);
});

test('ids over 36 characters and productIds of 1e10 or more are rejected', () => {
  assert.deepStrictEqual(R.sanitize([{ ...A, id: 'a'.repeat(37) }]), []);
  assert.strictEqual(R.sanitize([{ ...A, id: 'a'.repeat(36) }]).length, 1);
  assert.deepStrictEqual(R.sanitize([{ ...A, productId: 1e10 }]), []);
});

test('decide and sanitizeState accept missing or odd containers', () => {
  assert.strictEqual(R.decide(A, undefined, 20, NOON).fire, true);
  assert.deepStrictEqual(R.sanitizeState([{}]), {});
});

test('sanitizeState and sanitizeEvents', () => {
  assert.deepStrictEqual(R.sanitizeState({ a1: { last: 5, lastAt: 1, firedAt: 2, armed: false, x: 1 }, 'bad id': {}, a2: 'x' }),
    { a1: { last: 5, lastAt: 1, firedAt: 2, armed: false } });
  assert.deepStrictEqual(R.sanitizeState({ a1: {}, a2: {} }, ['a2']), { a2: {} });
  assert.deepStrictEqual(R.sanitizeState(null), {});
  const ev = [{ alarmId: 'a1', price: 5, at: 1 }, { alarmId: 'a1', price: 6, at: 2 }, { alarmId: 'a2', price: 0, at: 3 }];
  assert.deepStrictEqual(R.sanitizeEvents(ev), [{ alarmId: 'a1', price: 6, at: 2 }]);
  assert.strictEqual(R.sanitizeEvents(Array.from({ length: 30 }, (_, i) => ({ alarmId: 'e' + i, price: 1, at: 1 }))).length, R.MAX_EVENTS);
});

test('direction comes from the price when the alarm is set', () => {
  assert.strictEqual(R.direction(20, 18), 'above');
  assert.strictEqual(R.direction(15, 18), 'below');
  assert.strictEqual(R.direction(18, 18), null);
  assert.strictEqual(R.direction(0, 18), null);
  assert.strictEqual(R.direction(NaN, 18), null);
});

test('once: fires when reached (equal counts), then switches off', () => {
  assert.deepStrictEqual(R.decide(A, {}, 19.99, NOON), { fire: false, on: true, armed: true });
  assert.deepStrictEqual(R.decide(A, {}, 20, NOON), { fire: true, on: false, armed: false });
  assert.deepStrictEqual(R.decide({ ...A, dir: 'below', price: 15 }, {}, 14, NOON), { fire: true, on: false, armed: false });
  assert.strictEqual(R.decide({ ...A, on: false }, {}, 25, NOON).fire, false);
});

test('daily: at most once per local calendar day', () => {
  const d = { ...A, repeat: 'daily' };
  assert.strictEqual(R.decide(d, {}, 21, NOON).fire, true);
  assert.strictEqual(R.decide(d, { firedAt: NOON - 3600e3 }, 21, NOON).fire, false);
  assert.strictEqual(R.decide(d, { firedAt: NOON - DAY }, 21, NOON).fire, true);
  assert.strictEqual(R.decide(d, {}, 21, NOON).on, true);
});

test('each: fires once per crossing, re-arms on the other side', () => {
  const e = { ...A, repeat: 'each' };
  let st = {};
  let d = R.decide(e, st, 21, NOON); assert.strictEqual(d.fire, true); st = { armed: d.armed };
  d = R.decide(e, st, 22, NOON); assert.strictEqual(d.fire, false); st = { armed: d.armed };
  d = R.decide(e, st, 19, NOON); assert.strictEqual(d.fire, false); assert.strictEqual(d.armed, true); st = { armed: d.armed };
  d = R.decide(e, st, 20.5, NOON); assert.strictEqual(d.fire, true);
});

test('day is the local calendar day', () => {
  assert.strictEqual(R.day(new Date(2026, 9, 29, 23, 59).getTime()), 20261029);
  assert.strictEqual(R.day(new Date(2026, 9, 30, 0, 1).getTime()), 20261030);
});

test('sorted: product name A-Z, then price high to low; ties keep stored order; input untouched', () => {
  const mk = (id, name, price, o = {}) => ({ ...A, id, name, price, ...o });
  const list = [mk('s2', 'Samsung', 200), mk('m1', 'Meta', 190), mk('s3', 'Samsung', 300), mk('m2', 'Meta', 200)];
  const copy = JSON.parse(JSON.stringify(list));
  assert.deepStrictEqual(R.sorted(list).map(a => a.id), ['m2', 'm1', 's3', 's2']);
  assert.deepStrictEqual(list, copy);
  // case-insensitive names
  assert.deepStrictEqual(R.sorted([mk('b', 'beta', 1), mk('a', 'Alpha', 1), mk('c', 'Charlie', 1)]).map(a => a.id), ['a', 'b', 'c']);
  assert.deepStrictEqual(R.sorted([mk('x', 'meta', 5), mk('y', 'Meta', 5), mk('z', 'META', 9)]).map(a => a.id), ['z', 'x', 'y']);
  // stable ties
  assert.deepStrictEqual(R.sorted([mk('t1', 'Meta', 5), mk('t2', 'Meta', 5), mk('t3', 'Meta', 5)]).map(a => a.id), ['t1', 't2', 't3']);
  // same name, different products: grouped per product (productId ascending), then price
  assert.deepStrictEqual(R.sorted([mk('p1', 'Meta', 1, { productId: 1 }), mk('q', 'Apple', 1), mk('p2', 'Meta', 2, { productId: 2 })]).map(a => a.id), ['q', 'p1', 'p2']);
});

test('sorted: two products with the same name keep each product\'s alarms together, price high to low', () => {
  const mk = (id, productId, price) => ({ ...A, id, name: 'Apple Inc', productId, price });
  const list = [mk('a1', 1, 1), mk('a3', 1, 3), mk('b2', 2, 2)];
  assert.deepStrictEqual(R.sorted(list).map(a => a.id), ['a3', 'a1', 'b2']);
  assert.deepStrictEqual(R.sorted([mk('b2', 10, 2), mk('a1', 9, 1)]).map(a => a.id), ['a1', 'b2']);
});

test('sorted: symbol and #id stand in for a missing name; byProduct false sorts by price only', () => {
  const mk = (id, name, symbol, productId, price) => ({ ...A, id, name, symbol, productId, price });
  const list = [mk('n', '', '', 5, 1), mk('s', '', 'ZED', 6, 1), mk('a', 'Mid', 'X', 7, 1)];
  assert.deepStrictEqual(R.sorted(list).map(a => a.id), ['n', 'a', 's']);
  assert.strictEqual(R.label(list[0]), '#5');
  const p = [mk('1', 'B', '', 1, 10), mk('2', 'A', '', 1, 30), mk('3', 'C', '', 1, 10)];
  assert.deepStrictEqual(R.sorted(p, false).map(a => a.id), ['2', '1', '3']);
});

test('sanitize drops dashes from the currency ("$ —" read while the market was closed)', () => {
  const cur = c => R.sanitize([{ ...A, currency: c }])[0].currency;
  assert.strictEqual(cur('$—'), '$');
  assert.strictEqual(cur('€–'), '€');
  assert.strictEqual(cur('—'), '');
});
