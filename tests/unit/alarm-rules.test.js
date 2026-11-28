// Price alarm rules (extension/alarm-rules.js): sanitising stored data and when an alarm fires.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
// DGT_EXTENSION_DIR points at a scratch copy of extension/ (used to prove a test fails against broken code)
const R = require(path.resolve(process.env.DGT_EXTENSION_DIR || path.join(__dirname, '../../extension'), 'alarm-rules.js'));

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

test('text fields that are not text at all become empty, and the switch and created time are coerced', () => {
  const [out] = R.sanitize([{ ...A, name: 123, symbol: null, currency: { toString: () => '€' } }]);
  assert.strictEqual(out.name, '');
  assert.strictEqual(out.symbol, '');
  assert.strictEqual(out.currency, '', 'an object is not a currency, even one that prints like it');

  assert.strictEqual(R.sanitize([{ ...A, on: false }])[0].on, false);
  assert.strictEqual(R.sanitize([{ ...A, on: 'yes' }])[0].on, true, 'anything but false is on');
  assert.strictEqual(R.sanitize([{ ...A, on: undefined }])[0].on, true);
  for (const created of [0, -1, NaN, '1', null, undefined])
    assert.strictEqual(R.sanitize([{ ...A, created }])[0].created, 0, `created ${String(created)} → 0`);
  assert.strictEqual(R.sanitize([{ ...A, created: 1700000000000 }])[0].created, 1700000000000);
});

test('sanitizeEvents drops everything that is not a fired alarm', () => {
  for (const bad of [null, undefined, 'x', 5, {}, { 0: { alarmId: 'a1', price: 1, at: 1 } }])
    assert.deepStrictEqual(R.sanitizeEvents(bad), [], `${JSON.stringify(bad)} → no events`);
  const entries = [
    null, 5, 'a1', [], { price: 1, at: 1 }, { alarmId: 123, price: 1, at: 1 }, { alarmId: 'bad id', price: 1, at: 1 },
    { alarmId: 'x'.repeat(40), price: 1, at: 1 }, { alarmId: 'a1', at: 1 }, { alarmId: 'a1', price: 1 },
    { alarmId: 'a1', price: 0, at: 1 }, { alarmId: 'a1', price: NaN, at: 1 }, { alarmId: 'a1', price: 1, at: 0 },
    { alarmId: 'a1', price: '1', at: 1 }
  ];
  assert.deepStrictEqual(R.sanitizeEvents(entries), []);
  assert.deepStrictEqual(R.sanitizeEvents([...entries, { alarmId: 'a1', price: 2, at: 3, extra: '<b>' }]),
    [{ alarmId: 'a1', price: 2, at: 3 }], 'the one good event, without unknown fields');
});

// ---------- merge (shared by the tabs and the background worker) ----------
test('merge: a new firing adds its event and state; a foreign firing in the window keeps the stored one', () => {
  const st = { firedAt: NOON, last: 21, lastAt: NOON };
  const f = { alarmId: 'a1', price: 21, at: NOON };
  const out = R.merge({ state: {}, events: [] }, { a1: st }, [f], [A], ['a1'], () => false);
  assert.deepStrictEqual(out, { state: { a1: st }, events: [f] });
  const other = NOON - 30000;
  const lost = R.merge({ state: { a1: { firedAt: other } }, events: [{ alarmId: 'a1', price: 20, at: other }] },
    { a1: st }, [f], [A], ['a1'], (a, at, now) => !!at && R.within(a, at, now));
  assert.deepStrictEqual(lost.state.a1.firedAt, other);
  assert.deepStrictEqual(lost.events, [{ alarmId: 'a1', price: 20, at: other }]);
});

test('merge: a price seen without a firing lays only last/lastAt over the stored entry', () => {
  const W = NOON - 15 * 60000; // another writer's firing, stored after this writer read its state
  const fresh = { state: { a1: { firedAt: W, last: 20, lastAt: NOON - 1000, armed: false } }, events: [{ alarmId: 'a1', price: 20, at: W }] };
  const none = () => false;
  // the writer's copy of the entry from before (no firedAt, or an older one): the stored firing stays
  for (const old of [{}, { firedAt: NOON - DAY }, { firedAt: NOON - DAY, armed: true }]) {
    const out = R.merge(fresh, { a1: { ...old, last: 19, lastAt: NOON } }, [], [A], ['a1'], none);
    assert.deepStrictEqual(out.state.a1, { firedAt: W, last: 19, lastAt: NOON, armed: false }, JSON.stringify(old));
    assert.deepStrictEqual(out.events, fresh.events);
  }
  // only lastAt in the update: the stored last stays
  assert.deepStrictEqual(R.merge(fresh, { a1: { firedAt: NOON - DAY, lastAt: NOON } }, [], [A], ['a1'], none).state.a1,
    { firedAt: W, last: 20, lastAt: NOON, armed: false });
  // no stored entry (cleared meanwhile): the price seen is stored, not the old firedAt
  assert.deepStrictEqual(R.merge({ state: {}, events: [] }, { a1: { firedAt: NOON - DAY, last: 19, lastAt: NOON } }, [], [A], ['a1'], none).state,
    { a1: { last: 19, lastAt: NOON } });
  // a firing another writer's wins: the stored entry stays, with this writer's price on top
  const f = { alarmId: 'a1', price: 21, at: NOON };
  const lost = R.merge(fresh, { a1: { firedAt: NOON, last: 21, lastAt: NOON } }, [f], [A], ['a1'], () => true);
  assert.deepStrictEqual(lost, { state: { a1: { firedAt: W, last: 21, lastAt: NOON, armed: false } }, events: fresh.events });
});

test('merge drops the state and events of alarms that are not known', () => {
  const out = R.merge({ state: { gone: { last: 1 } }, events: [{ alarmId: 'gone', price: 1, at: 1 }] }, {}, [], [A], ['a1'], () => false);
  assert.deepStrictEqual(out, { state: {}, events: [] });
});

test('within: a minute, or the same local day for daily', () => {
  assert.ok(R.within(A, NOON, NOON + 59000));
  assert.ok(!R.within(A, NOON, NOON + 61000));
  assert.ok(R.within({ repeat: 'daily' }, NOON, NOON + 3 * 3600000));
  assert.ok(!R.within({ repeat: 'daily' }, NOON, NOON + DAY));
});

// ---------- background check: Yahoo tickers ----------
test('yahooTicker: DEGIRO symbol + exchange name → Yahoo ticker', () => {
  const cases = [
    ['ASML', 'Euronext Amsterdam', 'ASML.AS'], ['VUSA', 'euronext amsterdam', 'VUSA.AS'], ['AI', 'Euronext Paris', 'AI.PA'],
    ['SAP', 'Xetra', 'SAP.DE'], ['VUSA', 'London Stock Exchange', 'VUSA.L'], ['BT.A', 'London Stock Exchange', 'BT-A.L'],
    ['AAPL', 'NASDAQ', 'AAPL'], ['BRK.B', 'NYSE', 'BRK-B'], ['NESN', 'SIX Swiss Exchange', 'NESN.SW'],
    ['ENEL', 'Borsa Italiana', 'ENEL.MI'], ['ITX', 'Bolsa de Madrid', 'ITX.MC'], ['VOLV B', 'OMX Stockholm', ''],
    ['EQNR', 'Oslo Børs', 'EQNR.OL'], ['ABI', 'Euronext Brussels', 'ABI.BR'],
    // as DEGIRO's live header names them (2026-11-18)
    ['IUSA', 'Euronext Amsterdam', 'IUSA.AS'], ['AIR', 'Euronext Paris', 'AIR.PA'], ['VUSD', 'London Stock Exchange (LSE)', 'VUSD.L'],
    ['ADBE', 'Nasdaq', 'ADBE'], ['BABA', 'New York Stock Exchange', 'BABA'], ['700', 'Hong Kong Stock Exchange', '0700.HK'],
    ['ADB', 'Tradegate AG', 'ADB.DE'], ['ADB', 'TDG', 'ADB.DE']
  ];
  for (const [s, e, want] of cases) assert.strictEqual(R.yahooTicker(s, e), want, `${s} · ${e}`);
  assert.strictEqual(R.yahooTicker('ASML', 'Moscow Exchange'), '', 'an exchange not in the table');
  assert.strictEqual(R.yahooTicker('ASML', ''), '');
  assert.strictEqual(R.yahooTicker('', 'NASDAQ'), '');
  assert.strictEqual(R.yahooTicker('A,B', 'NASDAQ'), '', 'no list separators');
  assert.strictEqual(R.yahooTicker(5, 'NASDAQ'), '');
});

test('priceFactor: same currency 1, pence and pounds convert, anything else 0', () => {
  assert.strictEqual(R.priceFactor('€', 'EUR'), 1);
  assert.strictEqual(R.priceFactor('$', 'USD'), 1);
  assert.strictEqual(R.priceFactor('£', 'GBp'), 0.01);
  assert.strictEqual(R.priceFactor('GBX', 'GBp'), 1);
  assert.strictEqual(R.priceFactor('GBX', 'GBP'), 100);
  assert.strictEqual(R.priceFactor('€', 'USD'), 0);
  assert.strictEqual(R.priceFactor('kr', 'SEK'), 0, 'an ambiguous sign is never guessed');
  assert.strictEqual(R.priceFactor(undefined, 'EUR'), 0);
});

test('checkLink: currency and price must match DEGIRO', () => {
  const meta = { currency: 'EUR', regularMarketPrice: 100 };
  assert.deepStrictEqual(R.checkLink(meta, '€', 101, 90), { ok: true, f: 1 });
  assert.deepStrictEqual(R.checkLink(meta, '€', 300, 90), { ok: false, f: 0, why: 'price' }, 'another listing or product');
  assert.deepStrictEqual(R.checkLink(meta, '$', 100, 90), { ok: false, f: 0, why: 'currency' });
  assert.deepStrictEqual(R.checkLink(meta, '€', undefined, 400), { ok: true, f: 1 }, 'no DEGIRO price: wider range around the alarm');
  assert.deepStrictEqual(R.checkLink(meta, '€', undefined, 600), { ok: false, f: 0, why: 'price' });
  assert.deepStrictEqual(R.checkLink({ currency: 'GBp', regularMarketPrice: 1310 }, '£', 13.2, 13), { ok: true, f: 0.01 });
  assert.deepStrictEqual(R.checkLink(undefined, '€', 100, 100), { ok: false, f: 0, why: 'missing' }, 'Yahoo has no such ticker');
  assert.deepStrictEqual(R.checkLink({ currency: 'EUR' }, '€', 100, 100), { ok: false, f: 0, why: 'missing' }, 'no price for it');
});

test('sanitizeTickers keeps valid links, only for the given products', () => {
  const s = { 123: { t: 'ASML.AS', cur: '€' }, 7: { t: 'BRK-B', cur: '$' }, x: { t: 'A', cur: '€' }, 9: { t: 'a b', cur: '€' }, 8: { t: 'A,B', cur: '$' }, '010': { t: 'A', cur: '$' } };
  assert.deepStrictEqual(R.sanitizeTickers(s), { 7: { t: 'BRK-B', cur: '$' }, 123: { t: 'ASML.AS', cur: '€' } });
  assert.deepStrictEqual(R.sanitizeTickers(s, [123]), { 123: { t: 'ASML.AS', cur: '€' } });
  assert.deepStrictEqual(R.sanitizeTickers([]), {});
  assert.deepStrictEqual(R.sanitizeTickers(null), {});
});

test('sanitizeTickers: a link may carry the ISIN, and may be an ISIN alone (no ticker for its exchange)', () => {
  const s = { 1: { t: 'AVGO', cur: '$', isin: 'US11135F1012' }, 2: { t: '', cur: '€', isin: 'NL0010273215' }, 3: { t: '', cur: '€' },
    4: { t: 'X', cur: '€', isin: 'not an isin' }, 5: { t: '', cur: '€', isin: 'US1113' } };
  assert.deepStrictEqual(R.sanitizeTickers(s), { 1: { t: 'AVGO', cur: '$', isin: 'US11135F1012' }, 2: { t: '', cur: '€', isin: 'NL0010273215' }, 4: { t: 'X', cur: '€' } });
});

test('sanitizeNoTicker: product → exchange, one line, short; only for the given products', () => {
  const s = { 555: 'IFUS', 7: '  New\nYork  ', x: 'A', 8: 42, 9: '', 10: 'E'.repeat(60) };
  assert.deepStrictEqual(R.sanitizeNoTicker(s), { 7: 'New York', 10: 'E'.repeat(40), 555: 'IFUS' });
  assert.deepStrictEqual(R.sanitizeNoTicker(s, [555]), { 555: 'IFUS' });
  assert.deepStrictEqual(R.sanitizeNoTicker(null), {});
  assert.deepStrictEqual(R.sanitizeNoTicker(['IFUS']), {});
});

test('parseInfo: DEGIRO\'s product details → symbol, exchange code, currency sign, ISIN (shape seen 2026-11-18)', () => {
  const body = { data: {
    332108: { id: '332108', name: 'Adobe Inc', isin: 'US00724F1012', symbol: 'ADBE', productType: 'STOCK', productTypeId: 1, currency: 'USD', exchangeId: '663', closePrice: 235.55 },
    19749975: { id: '19749975', name: 'Adobe Inc', isin: 'US00724F1012', symbol: 'ADB', productType: 'STOCK', currency: 'EUR', exchangeId: '196' },
    5: { symbol: 'VUSA', isin: 'IE00B3XXRP09', currency: 'GBX', exchangeId: '570', productType: 'ETF' },
    6: { symbol: 'CL', currency: 'USD', exchangeId: '999', productType: 'FUTURE' },
    7: { symbol: 'X', exchangeId: '663' },
    8: { symbol: 'Y', currency: 'USD', exchangeId: 663, isin: '<b>', productType: 'a b' },
    9: { symbol: 'NOTASKED', currency: 'EUR', exchangeId: '200' }
  } };
  assert.deepStrictEqual(R.parseInfo(body, [332108, 19749975, 5, 6, 7, 8, 404]), [
    { id: 332108, symbol: 'ADBE', exchange: 'NDQ', currency: '$', isin: 'US00724F1012' },
    { id: 19749975, symbol: 'ADB', exchange: 'TDG', currency: '€', isin: 'US00724F1012' },
    { id: 5, symbol: 'VUSA', exchange: 'LSE', currency: 'GBX', isin: 'IE00B3XXRP09' },
    { id: 6, symbol: 'CL', exchange: '', currency: '$', isin: '' },
    { id: 8, symbol: 'Y', exchange: 'NDQ', currency: '$', isin: '' }
  ], 'no currency: left out; not asked: left out; unknown exchange id: no code');
  // the ticker each gives
  assert.strictEqual(R.yahooTicker('ADBE', 'NDQ'), 'ADBE');
  assert.strictEqual(R.yahooTicker('ADB', 'TDG'), 'ADB.DE');
  assert.strictEqual(R.yahooTicker('VUSA', 'LSE'), 'VUSA.L');
  assert.deepStrictEqual(R.parseInfo({ data: [] }, [1]), []);
  assert.deepStrictEqual(R.parseInfo(null, [1]), []);
  assert.deepStrictEqual(R.parseInfo({ data: { ['__proto__']: { currency: 'EUR' } } }, [1]), []);
  assert.deepStrictEqual(R.parseInfo({ data: { 1: { symbol: 'Z', currency: 'EUR', exchangeId: 'constructor' } } }, [1]), [{ id: 1, symbol: 'Z', exchange: '', currency: '€', isin: '' }]);
});

// ---------- Société Générale (sgbeurs.nl), shapes seen 2026-11-18 ----------
const SG_META_BODY = { Id: 3781712, ProductClassificationId: 44101, Isin: 'DE000SU054L9', Code: 'SU054L', ExchangeCode: 'CBDE', AssetId: 693,
  AssetName: 'S&P 500', Currency: 'EUR', AssetNMP: 'S+P500_INDEX', AssetIsin: 'US78378X1072', AssetNMPExchangeCode: 'CBUL', AssetRic: '.SPX', Venue: 'SG Direct' };
const SG_META = { id: '3781712', pc: 'CBDE', aid: '693', an: 'S+P500_INDEX', ar: '.SPX', ac: 'CBUL', cur: 'EUR', code: 'SU054L' };

test('SG: DEGIRO\'s SCG venue, by code or name', () => {
  assert.ok(R.isSgVenue('SCG'));
  assert.ok(R.isSgVenue('Société Générale'));
  assert.ok(R.isSgVenue('SG Direct'));
  assert.ok(!R.isSgVenue('EAM'));
  assert.ok(!R.isSgVenue(undefined));
  assert.strictEqual(R.parseInfo({ data: { 9: { currency: 'EUR', exchangeId: '192', isin: 'DE000SU054L9' } } }, [9])[0].exchange, 'SCG');
});

test('SG: the product fields from ValuesForWatchlist, strictly (they go into a URL)', () => {
  assert.deepStrictEqual(R.parseSgMeta(SG_META_BODY), SG_META);
  // a missing field is "null", as SG's own page sends it
  assert.deepStrictEqual(R.parseSgMeta({ ...SG_META_BODY, AssetRic: null }), { ...SG_META, ar: 'null' });
  assert.strictEqual(R.parseSgMeta({ ...SG_META_BODY, Id: null }), null);
  assert.strictEqual(R.parseSgMeta({ ...SG_META_BODY, AssetNMP: 'x&y=1?z' }), null);
  assert.strictEqual(R.parseSgMeta({ ...SG_META_BODY, ExchangeCode: 'cb de' }), null);
  assert.strictEqual(R.parseSgMeta({ ...SG_META_BODY, Currency: 'euro' }), null);
  assert.strictEqual(R.parseSgMeta('<html>Request Rejected</html>'), null);
  assert.strictEqual(R.parseSgMeta(null), null);
});

test('SG: the price request is exactly what SG\'s page sends (verified with curl and from the worker, 2026-11-18)', () => {
  assert.strictEqual(R.sgSnapshotPath('DE000SU054L9', SG_META),
    '/EmcWebApi/api/Products/RealtimeValuesSnapshot/3781712?productIsin=DE000SU054L9&productExchangeCode=CBDE&assetId=693&assetNmp=S%2BP500_INDEX&assetRic=.SPX&assetExchangeCode=CBUL');
  assert.strictEqual(R.parseSgBid({ ProductBid: 26.47, ProductAsk: 26.58, UnderlyingBid: 7354.966 }), 26.47);
  assert.strictEqual(R.parseSgBid({ ProductBid: 0 }), 0);
  assert.strictEqual(R.parseSgBid({ ProductBid: '26' }), 0);
  assert.strictEqual(R.parseSgBid(null), 0);
});

test('SG: links, checks and the bid times are kept only well-formed', () => {
  assert.deepStrictEqual(R.sanitizeTickers({ 1: { t: 'X', cur: '€', isin: 'DE000SU054L9', v: 'sg' }, 2: { t: '', cur: '€', v: 'sg' }, 3: { t: 'Y', cur: '€', v: 'yahoo' } }),
    { 1: { t: '', cur: '€', isin: 'DE000SU054L9', v: 'sg' }, 3: { t: 'Y', cur: '€' } }, 'an SG link needs its ISIN and has no ticker');
  assert.strictEqual(R.linkKey({ t: '', cur: '€', isin: 'DE000SU054L9', v: 'sg' }), '|€|DE000SU054L9|sg');
  assert.strictEqual(R.linkKey({ t: '', cur: '€', isin: 'DE000SU054L9' }), '|€|DE000SU054L9', 'not the same check as an ISIN-only Yahoo link');
  const ok = { ok: true, f: 1, at: 5, y: 'SU054L', sg: SG_META };
  assert.deepStrictEqual(R.sanitizeChecks({ '|€|DE000SU054L9|sg': ok }), { '|€|DE000SU054L9|sg': ok });
  assert.deepStrictEqual(R.sanitizeChecks({ '|€|DE000SU054L9|sg': { ...ok, sg: { ...SG_META, an: 'a b' } } }), {}, 'a field that would break the URL');
  assert.deepStrictEqual(R.sanitizeChecks({ '|€|DE000SU054L9|sg': { ...ok, sg: undefined } }), {});
  assert.deepStrictEqual(R.sanitizeChecks({ 'X|€|DE000SU054L9|sg': ok, '|€||sg': ok, '|€|DE000SU054L9|yh': ok }), {});
  assert.deepStrictEqual(R.sanitizeSgSeen({ DE000SU054L9: { b: 26.47, at: 5 }, bad: { b: 1, at: 1 }, NLSGE001BVD5: { b: 0, at: 1 } }), { DE000SU054L9: { b: 26.47, at: 5 } });
  assert.deepStrictEqual(R.sanitizeSgSeen({ DE000SU054L9: { b: 26.47, at: 5 } }, []), {});
  assert.deepStrictEqual(R.sanitizeNoTicker({ 1: 'SCG', 2: 'IFUS' }), { 2: 'IFUS' }, 'an old SCG note goes: SG products are linked now');
  assert.strictEqual(R.isinOf('DE000SU054L9'), 'DE000SU054L9', 'SG rows show the ISIN alone');
});

test('isinOf: the ISIN from DEGIRO\'s "Symbol | ISIN"', () => {
  assert.strictEqual(R.isinOf('AVGO | US11135F1012'), 'US11135F1012');
  assert.strictEqual(R.isinOf('IUSA | IE0031442068'), 'IE0031442068');
  assert.strictEqual(R.isinOf('EUR/USD | EURUSD......'), '', 'not an ISIN');
  assert.strictEqual(R.isinOf('AVGO'), '');
  assert.strictEqual(R.isinOf(undefined), '');
});

test('linkKey: ticker, currency and ISIN', () => {
  assert.strictEqual(R.linkKey({ t: 'AVGO', cur: '$', isin: 'US11135F1012' }), 'AVGO|$|US11135F1012');
  assert.strictEqual(R.linkKey({ t: 'ASML.AS', cur: '€' }), 'ASML.AS|€|');
  assert.strictEqual(R.linkKey({ t: '', cur: '€', isin: 'NL0010273215' }), '|€|NL0010273215');
});

test('parseSearch: Yahoo tickers from an ISIN search, at most 3, no duplicates', () => {
  assert.deepStrictEqual(R.parseSearch({ quotes: [{ symbol: 'ASML.AS' }, { symbol: 'ASML' }, { symbol: 'ASML' }, { symbol: 'bad sym' }, {}, { symbol: 'ASME.DE' }, { symbol: 'X' }] }),
    ['ASML.AS', 'ASML', 'ASME.DE']);
  assert.deepStrictEqual(R.parseSearch({ quotes: [] }), []);
  assert.deepStrictEqual(R.parseSearch(null), []);
});

test('sanitizeChecks keeps well-formed verdicts', () => {
  const s = { 'ASML.AS|€|': { ok: true, f: 1, at: 5, y: 'ASML.AS' }, 'X|$|': { ok: false, f: 1, at: 5 }, 'Y|€|': { ok: true, f: 3, at: 5, y: 'Y' },
    'Z|€': { ok: true, f: 1, at: 5, y: 'Z' }, 'a b|€|': { ok: true, f: 1, at: 5, y: 'A' }, 'N|€|': { ok: true, f: 1, at: 5 },
    '|€|US11135F1012': { ok: true, f: 1, at: 5, y: 'AVGO', via: 'isin' }, '||': { ok: false, f: 0, at: 5 } };
  assert.deepStrictEqual(R.sanitizeChecks(s), { 'ASML.AS|€|': { ok: true, f: 1, at: 5, y: 'ASML.AS' }, 'X|$|': { ok: false, f: 0, at: 5 },
    '|€|US11135F1012': { ok: true, f: 1, at: 5, y: 'AVGO', via: 'isin' } }, 'a confirmed check names the ticker it prices');
  assert.deepStrictEqual(R.sanitizeChecks(s, ['X|$|']), { 'X|$|': { ok: false, f: 0, at: 5 } });
  // why a check failed is kept only when it's one of the known reasons
  assert.deepStrictEqual(R.sanitizeChecks({ 'W|$|': { ok: false, f: 0, at: 5, why: 'currency' }, 'V|$|': { ok: false, f: 0, at: 5, why: '<b>' } }),
    { 'W|$|': { ok: false, f: 0, at: 5, why: 'currency' }, 'V|$|': { ok: false, f: 0, at: 5 } });
});

test('parseSpark: last price and trade time per ticker', () => {
  const body = {
    'ASML.AS': { timestamp: [1795003434], close: [1283.6] },
    AAPL: { timestamp: [1, 2], close: [10, 11] },
    EMPTY: { timestamp: [], close: [] },
    NULLED: { timestamp: [5], close: [null] },
    'BAD SYM': { timestamp: [5], close: [1] },
    // a 5-minute bar with no trade yet: the last bar with a price counts, with its own time
    'SAP.DE': { timestamp: [100, 400, 700], close: [200, 201, null] }
  };
  assert.deepStrictEqual([...R.parseSpark(body)], [['ASML.AS', { price: 1283.6, at: 1795003434000 }], ['AAPL', { price: 11, at: 2000 }], ['SAP.DE', { price: 201, at: 400000 }]]);
  assert.strictEqual(R.parseSpark(null).size, 0);
  assert.strictEqual(R.parseSpark([1]).size, 0);
});

// ── a tab's overlays (alarms.js): what it lays over the alarm data storage hands it ─────────────
// The tab's own maps go in; nothing is changed in place, what to drop comes back.

const ON = (id, o = {}) => ({ ...A, id, repeat: 'each', ...o });

test('withOff: switches off only listed alarms that are on; the same list back when nothing is switched off', () => {
  const list = [ON('a1'), ON('a2'), ON('a3', { on: false })];
  assert.strictEqual(R.withOff(list, new Set()), list);
  assert.deepStrictEqual(R.withOff(list, new Set(['a1', 'a3'])).map(a => [a.id, a.on]), [['a1', false], ['a2', true], ['a3', false]]);
  assert.strictEqual(list[0].on, true, 'the input is not changed');
});

test('shownList: queued edits in order, each sanitized; an edit refusing the list leaves it; switch-offs last', () => {
  const list = [ON('a1'), ON('a2')];
  const add = l => [...l, ON('a3')];
  const drop2 = l => l.filter(a => a.id !== 'a2');
  const refuse = () => null;
  const bad = l => [...l, { id: 'x', price: 'no' }]; // sanitized away
  assert.deepStrictEqual(R.shownList(list, [add, refuse, drop2, bad], new Map()).map(a => a.id), ['a1', 'a3']);
  assert.deepStrictEqual(R.shownList(list, [], new Map()), list);
  // an edit switching an alarm on that a 'once' switch-off is pending for: the switch-off still wins
  const switchOn = l => l.map(a => (a.id === 'a1' ? { ...a, on: true } : a));
  const off = new Map([['a1', { done: false }]]);
  assert.deepStrictEqual(R.shownList([ON('a1', { on: false })], [switchOn], off).map(a => a.on), [false]);
});

test('patchOf: last and lastAt, and firedAt only for a firing; undefined values are left out', () => {
  const st = { last: 17.5, lastAt: 1000, firedAt: 900, armed: true };
  assert.deepStrictEqual(R.patchOf(st, false), { last: 17.5, lastAt: 1000 });
  assert.deepStrictEqual(R.patchOf(st, true), { last: 17.5, lastAt: 1000, firedAt: 900 });
  assert.deepStrictEqual(R.patchOf({ last: 1 }, true), { last: 1 });
  assert.deepStrictEqual(R.patchOf(undefined, true), {});
});

test('holds: an unsaved firing counts while its alarm is unedited and no other firedAt is stored', () => {
  const a = ON('a1');
  const u = { at: 2000, base: 1000, sig: R.sigOf(a) };
  const st = f => ({ a1: f === undefined ? {} : { firedAt: f } });
  assert.strictEqual(R.holds(u, 'a1', [a], st(1000)), true, 'storage still has the firedAt it was based on');
  assert.strictEqual(R.holds(u, 'a1', [a], st(2000)), true, 'or the firing itself');
  assert.strictEqual(R.holds(u, 'a1', [a], st(3000)), false, 'another writer\'s firing');
  assert.strictEqual(R.holds(u, 'a1', [a], st(undefined)), false, 'an edit that cleared it');
  assert.strictEqual(R.holds({ ...u, base: undefined }, 'a1', [a], st(undefined)), true, 'nothing stored before, nothing now');
  assert.strictEqual(R.holds(u, 'a1', [{ ...a, price: 21 }], st(1000)), false, 'edited: price');
  assert.strictEqual(R.holds(u, 'a1', [{ ...a, dir: 'below' }], st(1000)), false, 'edited: direction');
  assert.strictEqual(R.holds(u, 'a1', [{ ...a, repeat: 'daily' }], st(1000)), false, 'edited: repeat');
  assert.strictEqual(R.holds(u, 'a1', [{ ...a, name: 'renamed' }], st(1000)), true, 'other fields are not an edit that counts');
  assert.strictEqual(R.holds(u, 'a1', [], st(1000)), false, 'gone');
  assert.strictEqual(R.holds(undefined, 'a1', [a], st(1000)), false, 'no unsaved firing');
});

test('overlayState: unsaved firings that hold, then pending patches, only for alarms on the list; the rest dropped', () => {
  const a1 = ON('a1'), a2 = ON('a2'), a3 = ON('a3');
  const st = { a1: { last: 1, firedAt: 1000 }, a2: { last: 2, firedAt: 5000 }, a3: { last: 3 } };
  assert.deepStrictEqual(R.overlayState(st, [a1], new Map(), new Map()), { state: st, drop: [] });
  assert.strictEqual(R.overlayState(st, [a1], new Map(), new Map()).state, st, 'the same object when the tab holds nothing');
  const unsaved = new Map([
    ['a1', { at: 2000, base: 1000, sig: R.sigOf(a1) }], // holds
    ['a2', { at: 3000, base: 1000, sig: R.sigOf(a2) }] // another writer stored 5000: no longer counts
  ]);
  const pending = new Map([
    ['a1', { by: {}, p: { last: 1.5, firedAt: 2500 } }], // laid over after the unsaved firing: its firedAt wins
    ['a3', { by: {}, p: { last: 3.5 } }],
    ['gone', { by: {}, p: { last: 9 } }] // not on the list: not laid over
  ]);
  const r = R.overlayState(st, [a1, a2, a3], unsaved, pending);
  assert.deepStrictEqual(r.drop, ['a2']);
  assert.deepStrictEqual(r.state, { a1: { last: 1.5, firedAt: 2500 }, a2: { last: 2, firedAt: 5000 }, a3: { last: 3.5 } });
  assert.strictEqual(unsaved.size, 2, 'the maps are not changed');
  assert.deepStrictEqual(st.a1, { last: 1, firedAt: 1000 }, 'nor the stored state');
  assert.deepStrictEqual(R.overlayState(st, [a1], new Map([['a1', unsaved.get('a1')]]), new Map()).state.a1, { last: 1, firedAt: 2000 },
    'an unsaved firing that holds is laid over on its own');
  // judged on the list given (alarms.js passes the shown one): an alarm not on it neither holds nor gets its patch
  const r2 = R.overlayState(st, [a3], new Map([['a1', unsaved.get('a1')]]), new Map([['a1', pending.get('a1')]]));
  assert.deepStrictEqual([r2.drop, r2.state.a1], [['a1'], { last: 1, firedAt: 1000 }]);
});

test('dropEdited: unsaved firings of edited or removed alarms go; the tab\'s firedAt goes back to the stored one', () => {
  const a1 = ON('a1'), a2 = ON('a2'), a3 = ON('a3'), a4 = ON('a4');
  const unsaved = new Map([
    ['a1', { at: 2000, base: 1000, sig: R.sigOf(a1) }], // unedited: stays
    ['a2', { at: 2000, base: 1000, sig: R.sigOf(a2) }], // edited: back to base
    ['a3', { at: 2000, base: undefined, sig: R.sigOf(a3) }], // removed, nothing stored before: firedAt goes
    ['a4', { at: 2000, base: 1000, sig: R.sigOf(a4) }] // edited, but the tab's state holds another firing: left
  ]);
  const state = { a1: { last: 1, firedAt: 2000 }, a2: { last: 2, firedAt: 2000 }, a3: { last: 3, firedAt: 2000 }, a4: { last: 4, firedAt: 7000 } };
  const r = R.dropEdited(state, unsaved, [a1, { ...a2, price: 99 }, { ...a4, dir: 'below' }]);
  assert.deepStrictEqual(r.drop, ['a2', 'a3', 'a4']);
  assert.deepStrictEqual(r.state, { a1: { last: 1, firedAt: 2000 }, a2: { last: 2, firedAt: 1000 }, a3: { last: 3 }, a4: { last: 4, firedAt: 7000 } });
  assert.strictEqual(unsaved.size, 4, 'the map is not changed');
  assert.strictEqual(state.a2.firedAt, 2000, 'nor the state');
  const same = R.dropEdited(state, new Map([['a1', unsaved.get('a1')]]), [a1]);
  assert.strictEqual(same.state, state, 'the same object when nothing changes');
  assert.deepStrictEqual(same.drop, []);
});

test('observed: a new firedAt is noted when first seen, 0 for the tab\'s own and at load; one without a firedAt goes', () => {
  const mine = new Set([3000]);
  const seen = new Map([['a1', { at: 1000, seenAt: 50 }], ['gone', { at: 900, seenAt: 40 }], ['a4', { at: 4000, seenAt: 60 }]]);
  const st = { a1: { firedAt: 1000 }, a2: { firedAt: 2000 }, a3: { firedAt: 3000 }, a4: { firedAt: 4500 }, a5: { last: 1 } };
  const out = R.observed(seen, st, true, mine, 777);
  assert.deepStrictEqual([...out], [
    ['a1', { at: 1000, seenAt: 50 }], // unchanged: kept as first seen
    ['a4', { at: 4500, seenAt: 777 }], // changed: seen now
    ['a2', { at: 2000, seenAt: 777 }], // new: seen now
    ['a3', { at: 3000, seenAt: 0 }] // the tab's own
  ]);
  assert.strictEqual(seen.size, 3, 'the input map is not changed');
  assert.deepStrictEqual([...R.observed(new Map(), { a2: { firedAt: 2000 } }, false, mine, 777)], [['a2', { at: 2000, seenAt: 0 }]], 'stored at load: not new');
});

test('foreignFiring: another writer\'s firedAt within the window, or first seen by the tab less than a minute ago', () => {
  const each = ON('a1'), daily = ON('a1', { repeat: 'daily' });
  const now = NOON, mine = new Set([now - 1000]);
  const seenAt = t => new Map([['a1', { at: now - 30 * 60e3, seenAt: t }]]);
  assert.strictEqual(R.foreignFiring(each, undefined, now, mine, new Map()), false, 'no firing');
  assert.strictEqual(R.foreignFiring(each, now - 1000, now, mine, new Map()), false, 'the tab\'s own');
  assert.strictEqual(R.foreignFiring(each, now - 1000 + 1, now, mine, new Map()), true, 'another writer\'s, within a minute');
  assert.strictEqual(R.foreignFiring(each, now - 61e3, now, mine, new Map()), false, 'older than a minute, not seen');
  assert.strictEqual(R.foreignFiring(daily, now - 3 * 3600e3, now, mine, new Map()), true, 'daily: the same day');
  const old = now - 30 * 60e3; // the worker's: Yahoo's trade time, half an hour back
  assert.strictEqual(R.foreignFiring(each, old, now, mine, seenAt(now - 59e3)), true, 'first seen 59 s ago');
  assert.strictEqual(R.foreignFiring(each, old, now, mine, seenAt(now - 61e3)), false, 'first seen 61 s ago');
  assert.strictEqual(R.foreignFiring(each, old, now, mine, seenAt(0)), false, 'stored at load (seenAt 0)');
  assert.strictEqual(R.foreignFiring(each, old + 1, now, mine, seenAt(now - 1000)), false, 'another firedAt than the one seen');
});
