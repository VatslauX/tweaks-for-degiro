// extension/background.js: the opt-in background check of price alarms with Yahoo Finance prices. The worker runs
// in a vm sandbox with a fake `chrome` (storage areas, alarms, permissions, notifications) and a fake `fetch`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// DGT_EXTENSION_DIR points at a scratch copy of extension/ (used to prove a test fails against broken code)
const EXT = process.env.DGT_EXTENSION_DIR || path.join(__dirname, '../../extension');
const WORKER = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
const plain = v => JSON.parse(JSON.stringify(v));
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 1)); };

const NOW = Date.UTC(2026, 10, 18, 12);
const ALARM = { id: 'a1', productId: 123, name: 'ASML', symbol: 'ASML', currency: '€', price: 1000, dir: 'above', repeat: 'once', on: true, created: 1 };
const LINK = { 123: { t: 'ASML.AS', cur: '€' } };
const CHART = { chart: { result: [{ meta: { currency: 'EUR', regularMarketPrice: 1050 } }] } };
const spark = (price, atSec = NOW / 1000 - 900) => ({ 'ASML.AS': { timestamp: [atSec], close: [price] } });

function area(init = {}) {
  const data = { ...init };
  return {
    data,
    get: async defaults => ({ ...defaults, ...plain(data) }),
    set: async patch => { Object.assign(data, plain(patch)); },
    clear: async () => { for (const k of Object.keys(data)) delete data[k]; }
  };
}
const listeners = () => { const fns = []; return { fns, addListener: fn => fns.push(fn) }; };

/**
 * A worker with the given stored values; `responses(url)` answers its fetches. Its clock starts at NOW;
 * `ticks(n)` runs n ticks a minute apart, as Chrome's alarm does (`clock.now` moves on).
 * Each test's clock is its own: a fixed NOW stays right for the tests that tick once.
 */
function worker({ sync = {}, local = {}, granted = true, sound = true, responses = () => ({ status: 404 }) } = {}) {
  const calls = { fetch: [], notes: [], cleared: [], tabs: [], alarms: new Map(), offscreen: [], sent: [] };
  const clock = { now: NOW };
  const ev = { alarm: listeners(), installed: listeners(), startup: listeners(), added: listeners(), removed: listeners(), changed: listeners(), clicked: listeners(), message: listeners() };
  const chrome = {
    storage: {
      sync: area({ priceAlarms: true, alarmsBackground: true, dgAlarms: [ALARM], dgTickers: LINK, ...sync }),
      local: area(local), session: area(), onChanged: ev.changed
    },
    alarms: {
      get: async n => calls.alarms.get(n), create: async (n, o) => { calls.alarms.set(n, o); },
      clear: async n => calls.alarms.delete(n), onAlarm: ev.alarm
    },
    // `sound`: the chime's offscreen permission, asked for apart from the check's own
    permissions: { contains: async p => (p.origins ? granted : p.permissions?.includes('offscreen') ? sound : granted), onAdded: ev.added, onRemoved: ev.removed },
    runtime: { id: 'ext', onInstalled: ev.installed, onStartup: ev.startup, onMessage: ev.message, sendMessage: async m => { calls.sent.push(m); return true; } },
    // only with its permission granted; one document at a time, as in Chrome
    offscreen: sound ? { createDocument: async o => { if (calls.offscreen.length) throw new Error('Only a single offscreen document may be created.'); calls.offscreen.push(o); } } : undefined,
    // as in Chrome 111 (the minimum) to 115: callbacks only, no Promise returned
    notifications: {
      create: (id, o, cb) => { calls.notes.push({ id, ...o }); if (cb) cb(id); },
      clear: (id, cb) => { calls.cleared.push(id); if (cb) cb(true); },
      onClicked: ev.clicked
    },
    tabs: { create: async o => { calls.tabs.push(o); } },
    i18n: { getMessage: (k, subs) => `${k}(${(subs || []).join(',')})`, getUILanguage: () => 'en' }
  };
  const fetch = async (url, opts) => {
    calls.fetch.push({ url, opts });
    const r = await responses(url); // a Promise holds the request open
    return { status: r.status ?? 200, ok: (r.status ?? 200) < 300, json: async () => r.body,
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  };
  const ctx = vm.createContext({ chrome, fetch, TextEncoder, AbortSignal, URLSearchParams, setTimeout, Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.now); } static now() { return clock.now; } } });
  ctx.importScripts = (...files) => files.forEach(f => vm.runInContext(fs.readFileSync(path.join(EXT, f), 'utf8'), ctx, { filename: f }));
  vm.runInContext(WORKER, ctx, { filename: 'background.js' });
  const tick = async () => { ev.alarm.fns.forEach(fn => fn({ name: 'dgPoll' })); await settle(); };
  /** `n` ticks, a minute apart: the first one now, and the clock ends a minute after the last */
  const ticks = async n => { for (let i = 0; i < n; i++) { await tick(); clock.now += 60000; } };
  return { chrome, calls, ev, tick, ticks, clock };
}
const yahoo = (chart = CHART, sparkBody = spark(1050)) => url =>
  url.includes('/v8/finance/chart/') ? { body: chart } : url.includes('/v8/finance/spark') ? { body: sparkBody } : { status: 404 };

test('only Yahoo price paths, without cookies', async () => {
  const w = worker({ responses: yahoo() });
  await w.tick();
  assert.ok(w.calls.fetch.length >= 2);
  for (const f of w.calls.fetch) {
    assert.match(f.url, /^https:\/\/query1\.finance\.yahoo\.com\/v8\/finance\/(chart\/ASML\.AS\?|spark\?symbols=ASML\.AS&range=1d&interval=5m$)/,
      'spark at 5-minute bars: a daily bar\'s time is the session open, not the last trade');
    assert.equal(f.opts.credentials, 'omit');
  }
});

test('a linked alarm whose price is reached fires: event, state at the trade time, notification, once switches off', async () => {
  const w = worker({ responses: yahoo() });
  await w.tick();
  const trade = NOW - 900000;
  const local = w.chrome.storage.local.data;
  assert.deepEqual(local.dgTickerCheck, { 'ASML.AS|€|': { ok: true, f: 1, y: 'ASML.AS', at: NOW } });
  assert.deepEqual(local.dgAlarmEvents, [{ alarmId: 'a1', price: 1050, at: trade }]);
  assert.equal(local.dgAlarmState.a1.firedAt, trade);
  assert.equal(w.calls.notes.length, 1);
  assert.match(w.calls.notes[0].title, /^bannerRose\(ASML,€ 1,050\.00\)$/);
  assert.equal(w.chrome.storage.sync.data.dgAlarms[0].on, false);
  assert.deepEqual(plain(local.dgBgStatus), { at: NOW, linked: 1, total: 1, err: '' });
});

test('an alarm\'s notification is the system\'s banner with its sound, kept in the notification history', async () => {
  const w = worker({ responses: yahoo() });
  await w.tick();
  const n = w.calls.notes[0];
  assert.equal(n.silent, false);
  assert.equal(n.requireInteraction, undefined, 'the system\'s banner time, not on screen until dismissed');
  await settle();
  assert.deepEqual(w.calls.cleared, [], 'never cleared: it stays in Notification Center');
});

test('a firing chimes once in an offscreen document (Chrome on macOS shows notifications silently)', async () => {
  const two = { ...ALARM, id: 'a2', price: 1010 };
  const w = worker({ sync: { dgAlarms: [ALARM, two] }, responses: yahoo() });
  await w.tick();
  assert.equal(w.calls.notes.length, 2);
  assert.equal(w.calls.offscreen.length, 1, 'one chime a tick, however many fired');
  assert.deepEqual(plain(w.calls.offscreen[0]), { url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Plays the price alarm chime.' });
  assert.deepEqual(w.calls.sent, []);
});

test('no chime with the sound switched off, or without its permission; the check runs all the same', async () => {
  for (const opts of [{ sync: { alarmSound: false } }, { sound: false }]) {
    const w = worker({ ...opts, responses: yahoo() });
    await w.tick();
    assert.equal(w.calls.notes.length, 1, JSON.stringify(opts));
    assert.deepEqual(w.calls.offscreen, [], JSON.stringify(opts));
    assert.deepEqual(w.calls.sent, [], JSON.stringify(opts));
  }
});

test('a tab or the settings ask for the chime: played offscreen, again in the open document, and only for this extension', async () => {
  const w = worker();
  const ask = (msg, sender = { id: 'ext' }) => new Promise(resolve => {
    const async = w.ev.message.fns.map(fn => fn(msg, sender, resolve)).some(r => r === true);
    if (!async) resolve('no reply');
  });
  assert.equal(await ask({ type: 'dg-chime' }), true);
  assert.equal(w.calls.offscreen.length, 1);
  // still open (Chrome closes it after 30 s of silence): asked to play again
  assert.equal(await ask({ type: 'dg-chime' }), true);
  assert.deepEqual(plain(w.calls.sent), [{ type: 'dg-chime-play' }]);
  assert.equal(await ask({ type: 'dg-chime' }, { id: 'other' }), 'no reply');
  assert.equal(await ask({ type: 'dg-status' }), 'no reply');
  const off = worker({ sound: false });
  const reply = await new Promise(resolve => off.ev.message.fns.forEach(fn => fn({ type: 'dg-chime' }, { id: 'ext' }, resolve)));
  assert.equal(reply, false, 'without the permission: the asker plays it itself');
});

test('a price not newer than the last firing never fires again (a closed market after a restart)', async () => {
  const daily = { ...ALARM, repeat: 'daily' };
  const fired = NOW - 600000; // after the trade Yahoo reports
  const w = worker({ sync: { dgAlarms: [daily] }, local: { dgAlarmState: { a1: { firedAt: fired } }, dgTickerCheck: { 'ASML.AS|€|': { ok: true, f: 1, at: 1, y: 'ASML.AS' } } }, responses: yahoo() });
  await w.tick();
  assert.equal(w.calls.notes.length, 0);
  assert.equal(w.chrome.storage.local.data.dgAlarmState.a1.firedAt, fired);
});

test('a product a DEGIRO tab priced in the last 3 minutes is left to the tab', async () => {
  const w = worker({ local: { dgAlarmState: { a1: { last: 990, lastAt: NOW - 60000 } }, dgTickerCheck: { 'ASML.AS|€|': { ok: true, f: 1, at: 1, y: 'ASML.AS' } } }, responses: yahoo() });
  await w.tick();
  assert.equal(w.calls.fetch.filter(f => f.url.includes('spark')).length, 0);
  assert.equal(w.calls.notes.length, 0);
});

test('a link Yahoo does not confirm is not checked, and says so', async () => {
  const w = worker({ responses: yahoo({ chart: { result: [{ meta: { currency: 'USD', regularMarketPrice: 1050 } }] } }) });
  await w.tick();
  assert.deepEqual(w.chrome.storage.local.data.dgTickerCheck, { 'ASML.AS|€|': { ok: false, f: 0, why: 'currency', at: NOW } });
  assert.equal(w.calls.fetch.filter(f => f.url.includes('spark')).length, 0);
  assert.equal(w.calls.notes.length, 0);
});

test('a ticker Yahoo does not know is stored as not found', async () => {
  const w = worker({ responses: () => ({ status: 404 }) });
  await w.tick();
  assert.deepEqual(w.chrome.storage.local.data.dgTickerCheck, { 'ASML.AS|€|': { ok: false, f: 0, why: 'missing', at: NOW } });
});

// ---------- ISIN fallback ----------
const ISIN = 'US00724F1012';
/** Yahoo with `known` tickers (chart meta), an ISIN search answering `found`, and spark prices for every known ticker */
const yahooWith = (known, found) => url => {
  const u = new URL(url);
  if (u.pathname.startsWith('/v8/finance/chart/')) {
    const meta = known[decodeURIComponent(u.pathname.split('/').pop())];
    return meta ? { body: { chart: { result: [{ meta }] } } } : { status: 404 };
  }
  if (u.pathname === '/v1/finance/search') return { body: { quotes: found.map(symbol => ({ symbol })) } };
  if (u.pathname === '/v8/finance/spark') {
    return { body: Object.fromEntries(u.searchParams.get('symbols').split(',').filter(s => known[s]).map(s => [s, { timestamp: [NOW / 1000 - 60], close: [known[s].regularMarketPrice] }])) };
  }
  return { status: 404 };
};

test('ISIN fallback: when its own ticker is not on Yahoo, the ISIN search finds one that fits, and it is priced', async () => {
  const w = worker({ sync: { dgTickers: { 123: { t: 'XYZ.DE', cur: '€', isin: ISIN } } },
    responses: yahooWith({ 'ADB.DE': { currency: 'EUR', regularMarketPrice: 1050 } }, ['ADB.DE']) });
  await w.tick();
  assert.deepEqual(w.chrome.storage.local.data.dgTickerCheck, { [`XYZ.DE|€|${ISIN}`]: { ok: true, f: 1, y: 'ADB.DE', via: 'isin', at: NOW } });
  assert.ok(w.calls.fetch.some(f => f.url.includes(`/v1/finance/search?q=${ISIN}&`)));
  assert.match(w.calls.fetch.find(f => f.url.includes('spark')).url, /symbols=ADB\.DE&/);
  assert.deepEqual(w.chrome.storage.local.data.dgAlarmEvents, [{ alarmId: 'a1', price: 1050, at: NOW - 60000 }]);
});

test('ISIN fallback: an exchange without a Yahoo ticker is linked by ISIN alone', async () => {
  const w = worker({ sync: { dgTickers: { 123: { t: '', cur: '€', isin: ISIN } } },
    responses: yahooWith({ 'ADB.DE': { currency: 'EUR', regularMarketPrice: 1050 } }, ['ADB.DE']) });
  await w.tick();
  assert.deepEqual(w.chrome.storage.local.data.dgTickerCheck, { [`|€|${ISIN}`]: { ok: true, f: 1, y: 'ADB.DE', via: 'isin', at: NOW } });
});

test('ISIN fallback: never asked when its own ticker fits; a listing in another currency is not taken', async () => {
  const fits = worker({ sync: { dgTickers: { 123: { t: 'ASML.AS', cur: '€', isin: ISIN } } },
    responses: yahooWith({ 'ASML.AS': { currency: 'EUR', regularMarketPrice: 1050 } }, ['OTHER']) });
  await fits.tick();
  assert.equal(fits.calls.fetch.filter(f => f.url.includes('/v1/finance/search')).length, 0);
  // Tradegate in €, but the ISIN search finds only the US listing in $: still not found, nothing priced
  const usd = worker({ sync: { dgTickers: { 123: { t: 'ADB.DE', cur: '€', isin: ISIN } } },
    responses: yahooWith({ ADBE: { currency: 'USD', regularMarketPrice: 1050 } }, ['ADBE']) });
  await usd.tick();
  assert.deepEqual(usd.chrome.storage.local.data.dgTickerCheck, { [`ADB.DE|€|${ISIN}`]: { ok: false, f: 0, why: 'missing', at: NOW } });
  assert.equal(usd.calls.fetch.filter(f => f.url.includes('spark')).length, 0);
});

test('a link whose check errors (Yahoo refusing the ISIN search) holds up no other alarm, and waits before retrying', async () => {
  const other = { ...ALARM, id: 'a2', productId: 456, price: 5000 };
  const w = worker({
    sync: { dgAlarms: [ALARM, other], dgTickers: { 123: LINK[123], 456: { t: '', cur: '€', isin: ISIN } } },
    local: { dgTickerCheck: { 'ASML.AS|€|': { ok: true, f: 1, at: 1, y: 'ASML.AS' } } },
    responses: url => url.includes('/v1/finance/search') ? { status: 403 } : yahoo()(url)
  });
  await w.tick();
  assert.deepEqual(w.chrome.storage.local.data.dgAlarmEvents.map(e => e.alarmId), ['a1'], 'the confirmed alarm still fired');
  assert.equal(w.chrome.storage.local.data.dgTickerCheck[`|€|${ISIN}`], undefined, 'no verdict stored for an error');
  const searches = () => w.calls.fetch.filter(f => f.url.includes('/v1/finance/search')).length;
  assert.equal(searches(), 1);
  await w.tick();
  assert.equal(searches(), 1, 'not asked again on the next tick');
});

test('links whose check keeps erroring step aside: a new link listed after them is confirmed within a few minutes', async () => {
  const bad = [456, 457].map((pid, i) => ({ ...ALARM, id: `x${i}`, productId: pid, price: 5000 }));
  const isins = { 456: ISIN, 457: 'US0378331005' };
  const w = worker({
    sync: { dgAlarms: [...bad, ALARM], dgTickers: { 456: { t: '', cur: '€', isin: isins[456] }, 457: { t: '', cur: '€', isin: isins[457] }, ...LINK } },
    responses: url => url.includes('/v1/finance/search') ? { status: 403 } : yahoo()(url)
  });
  await w.ticks(4);
  assert.equal(w.chrome.storage.local.data.dgTickerCheck?.['ASML.AS|€|']?.ok, true, 'the new link was confirmed');
  assert.deepEqual(w.chrome.storage.local.data.dgAlarmEvents?.map(e => e.alarmId), ['a1']);
  // each failing link is asked again after 2, 4 … 30 minutes, not every minute
  const searches = w.calls.fetch.filter(f => f.url.includes('/v1/finance/search')).length;
  assert.ok(searches <= 4, `${searches} searches in 4 minutes`);
  await w.ticks(30);
  const later = w.calls.fetch.filter(f => f.url.includes('/v1/finance/search')).length - searches;
  assert.ok(later < 10, `${later} searches in the next 30 minutes (each link: after 4, 8, 16 … minutes)`);
});

test('checking new links stays within a request budget per tick', async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ ...ALARM, id: `b${i}`, productId: 1000 + i, price: 5000 }));
  const links = Object.fromEntries(many.map((a, i) => [a.productId, { t: `T${i}`, cur: '€' }]));
  const w = worker({ sync: { dgAlarms: many, dgTickers: links }, responses: () => ({ status: 404 }) });
  await w.tick();
  assert.equal(w.calls.fetch.filter(f => f.url.includes('/v8/finance/chart/')).length, 8);
});

// ---------- Société Générale's own products: priced from sgbeurs.nl ----------
const SG_ISIN = 'DE000SU054L9';
const SG_ALARM = { ...ALARM, id: 's1', productId: 777, name: 'SG S&P 500 Factor Long LEV 10', symbol: '', price: 26 };
const SG_LINK = { 777: { t: '', cur: '€', isin: SG_ISIN, v: 'sg' } };
const SG_META = { id: '3781712', pc: 'CBDE', aid: '693', an: 'S+P500_INDEX', ar: '.SPX', ac: 'CBUL', cur: 'EUR', code: 'SU054L' };
const SG_PATH = '/EmcWebApi/api/Products/RealtimeValuesSnapshot/3781712?productIsin=DE000SU054L9&productExchangeCode=CBDE&assetId=693&assetNmp=S%2BP500_INDEX&assetRic=.SPX&assetExchangeCode=CBUL';
/** SG's site: the product's fields and its bid (`bid`, or a status / an HTML page instead) */
const sgSite = (bid = 26.47, snapshot) => url => {
  if (url === `https://sgbeurs.nl/EmcWebApi/api/Products/ValuesForWatchlist/${SG_ISIN}`) {
    return { body: { Id: 3781712, Isin: SG_ISIN, Code: 'SU054L', ExchangeCode: 'CBDE', AssetId: 693, AssetNMP: 'S+P500_INDEX', AssetRic: '.SPX', AssetNMPExchangeCode: 'CBUL', Currency: 'EUR' } };
  }
  if (url === `https://sgbeurs.nl${SG_PATH}`) return snapshot || { body: { ProductBid: bid, ProductAsk: bid + 0.11, UnderlyingBid: 7354.9 } };
  return { status: 404 };
};

test('SG: a product on DEGIRO\'s SCG venue is confirmed and priced by SG (its bid), never sent to Yahoo', async () => {
  const w = worker({ sync: { dgAlarms: [SG_ALARM], dgTickers: SG_LINK }, responses: sgSite() });
  await w.tick();
  const local = w.chrome.storage.local.data;
  assert.deepEqual(local.dgTickerCheck, { [`|€|${SG_ISIN}|sg`]: { ok: true, f: 1, y: 'SU054L', sg: SG_META, at: NOW } });
  assert.ok(w.calls.fetch.every(f => f.url.startsWith('https://sgbeurs.nl/') && f.opts.credentials === 'omit'), 'only SG, without cookies');
  assert.ok(w.calls.fetch.some(f => f.url === `https://sgbeurs.nl${SG_PATH}`), 'the exact request SG\'s page sends');
  assert.deepEqual(local.dgAlarmEvents, [{ alarmId: 's1', price: 26.47, at: NOW }]);
  assert.deepEqual(local.dgSgSeen, { [SG_ISIN]: { b: 26.47, at: NOW } });
  assert.match(w.calls.notes[0].message, /bgNotifyNoteSg\(/);
});

test('SG: a bid that hasn\'t changed since the alarm fired never fires it again (after a restart too)', async () => {
  const fired = NOW - 12 * 3600000; // last evening, on the same bid
  const daily = { ...SG_ALARM, repeat: 'daily' };
  const w = worker({ sync: { dgAlarms: [daily], dgTickers: SG_LINK }, responses: sgSite(26.47), local: {
    dgTickerCheck: { [`|€|${SG_ISIN}|sg`]: { ok: true, f: 1, y: 'SU054L', sg: SG_META, at: NOW - 3600000 } },
    dgAlarmState: { s1: { firedAt: fired } }, dgSgSeen: { [SG_ISIN]: { b: 26.47, at: fired } } } });
  await w.tick();
  assert.equal(w.chrome.storage.local.data.dgAlarmEvents, undefined);
  assert.equal(w.calls.notes.length, 0);
});

test('SG: refused (its firewall\'s HTML page) → its own wait, the product is checked again later; Yahoo alarms still fire', async () => {
  const rejected = { status: 403, body: '<html><head><title>Request Rejected</title></head></html>' };
  const w = worker({
    sync: { dgAlarms: [ALARM, SG_ALARM], dgTickers: { ...LINK, ...SG_LINK } },
    local: { dgTickerCheck: { 'ASML.AS|€|': { ok: true, f: 1, at: 1, y: 'ASML.AS' }, [`|€|${SG_ISIN}|sg`]: { ok: true, f: 1, y: 'SU054L', sg: SG_META, at: NOW - 3600000 } } },
    responses: url => (url.startsWith('https://sgbeurs.nl/') ? sgSite(26.47, rejected)(url) : yahoo()(url))
  });
  await w.tick();
  const local = w.chrome.storage.local.data;
  assert.deepEqual(local.dgAlarmEvents.map(e => e.alarmId), ['a1'], 'the Yahoo alarm fired');
  assert.equal(local.dgTickerCheck[`|€|${SG_ISIN}|sg`], undefined, 'its fields may be stale: checked again later');
  assert.match(local.dgBgStatus.err, /SG HTTP 403/);
  const sgCalls = () => w.calls.fetch.filter(f => f.url.startsWith('https://sgbeurs.nl/')).length;
  const n = sgCalls();
  assert.ok(n > 0, 'SG was asked');
  await w.tick();
  assert.equal(sgCalls(), n, 'the product waits (2 minutes, doubling) before its link is checked again');
});

test('SG: SG refusing to confirm a link doesn\'t stop a Yahoo link from being confirmed, and that link then waits', async () => {
  const rejected = { status: 403, body: '<html>Request Rejected</html>' };
  const w = worker({
    sync: { dgAlarms: [SG_ALARM, ALARM], dgTickers: { ...SG_LINK, ...LINK } }, // the SG link comes first
    responses: url => (url.startsWith('https://sgbeurs.nl/') ? rejected : yahoo()(url))
  });
  await w.tick();
  const local = w.chrome.storage.local.data;
  assert.deepEqual(local.dgTickerCheck, { 'ASML.AS|€|': { ok: true, f: 1, y: 'ASML.AS', at: NOW } });
  assert.deepEqual(local.dgAlarmEvents.map(e => e.alarmId), ['a1']);
  assert.ok(w.chrome.storage.session.data.dgBgHold[`|€|${SG_ISIN}|sg`].at > NOW, 'that link waits');
  assert.equal(w.chrome.storage.session.data.dgBgSgAt, undefined, 'SG\'s prices don\'t');
  assert.equal(w.chrome.storage.session.data.dgBgVerifyAt, undefined, 'Yahoo doesn\'t');
});

test('SG: a confirmed link is refreshed daily by its fields alone (no price comparison: a leveraged price moves far)', async () => {
  const w = worker({ sync: { dgAlarms: [{ ...SG_ALARM, price: 500 }], dgTickers: SG_LINK }, responses: sgSite(3.2), local: {
    dgTickerCheck: { [`|€|${SG_ISIN}|sg`]: { ok: true, f: 1, y: 'SU054L', sg: SG_META, at: NOW - 25 * 3600000 } },
    dgAlarmState: { s1: { last: 26.4, lastAt: NOW - 3 * 86400000 } } } });
  await w.tick();
  assert.deepEqual(w.chrome.storage.local.data.dgTickerCheck, { [`|€|${SG_ISIN}|sg`]: { ok: true, f: 1, y: 'SU054L', sg: SG_META, at: NOW } },
    'DEGIRO last showed 26.40, SG now bids 3.20: still the same product');
});

test('SG: no bid (closed, halted) or no network keeps the link; only a refusal makes it checked again', async () => {
  const CHECK = { [`|€|${SG_ISIN}|sg`]: { ok: true, f: 1, y: 'SU054L', sg: SG_META, at: NOW - 3600000 } };
  const noBid = worker({ sync: { dgAlarms: [SG_ALARM], dgTickers: SG_LINK }, local: { dgTickerCheck: CHECK }, responses: sgSite(0) });
  await noBid.tick();
  assert.deepEqual(noBid.chrome.storage.local.data.dgTickerCheck, CHECK);
  assert.equal(noBid.chrome.storage.local.data.dgBgStatus.err, '');
  const offline = worker({ sync: { dgAlarms: [SG_ALARM], dgTickers: SG_LINK }, local: { dgTickerCheck: CHECK },
    responses: url => { if (url.includes('RealtimeValuesSnapshot')) throw new TypeError('Failed to fetch'); return { status: 404 }; } });
  await offline.tick();
  assert.deepEqual(offline.chrome.storage.local.data.dgTickerCheck, CHECK, 'a network error keeps the link');
  assert.match(offline.chrome.storage.local.data.dgBgStatus.err, /Failed to fetch/);
});

test('SG: more than 10 SG products take turns, 10 a minute', async () => {
  const isins = Array.from({ length: 11 }, (_, i) => `DE000SG${String(i).padStart(4, '0')}0`);
  const alarms = isins.map((_, i) => ({ ...SG_ALARM, id: `s${i}`, productId: 9000 + i, price: 5000 }));
  const links = Object.fromEntries(isins.map((isin, i) => [9000 + i, { t: '', cur: '€', isin, v: 'sg' }]));
  const checks = Object.fromEntries(isins.map((isin, i) => [`|€|${isin}|sg`, { ok: true, f: 1, y: isin, sg: { ...SG_META, id: String(100 + i), code: '' }, at: NOW - 3600000 }]));
  const w = worker({ sync: { dgAlarms: alarms, dgTickers: links }, local: { dgTickerCheck: checks },
    responses: url => (url.includes('RealtimeValuesSnapshot') ? { body: { ProductBid: 1 } } : { status: 404 }) });
  const asked = () => w.calls.fetch.filter(f => f.url.includes('RealtimeValuesSnapshot')).map(f => new URL(f.url).searchParams.get('productIsin'));
  await w.tick();
  assert.equal(asked().length, 10);
  await w.tick();
  assert.equal(asked().length, 20);
  assert.deepEqual(new Set(asked()).size, 11, 'the 11th got its turn');
});

test('SG: an answer that isn\'t JSON (its firewall\'s page, with status 200) is a refusal: the link is checked again', async () => {
  const w = worker({ sync: { dgAlarms: [SG_ALARM], dgTickers: SG_LINK },
    local: { dgTickerCheck: { [`|€|${SG_ISIN}|sg`]: { ok: true, f: 1, y: 'SU054L', sg: SG_META, at: NOW - 3600000 } } },
    responses: sgSite(26.47, { body: '<html>Request Rejected</html>' }) });
  await w.tick();
  assert.match(w.chrome.storage.local.data.dgBgStatus.err, /SG: not JSON/);
  assert.equal(w.chrome.storage.local.data.dgAlarmEvents, undefined);
  assert.equal(w.chrome.storage.local.data.dgTickerCheck[`|€|${SG_ISIN}|sg`], undefined, 'its fields may be stale: checked again later');
});

test('SG: a 204 or 410 (a knocked-out or delisted product) means not found, not an error', async () => {
  const check = worker({ sync: { dgAlarms: [SG_ALARM], dgTickers: SG_LINK },
    responses: url => (url.includes('ValuesForWatchlist') ? { status: 204, body: '' } : { status: 404 }) });
  await check.tick();
  assert.deepEqual(check.chrome.storage.local.data.dgTickerCheck, { [`|€|${SG_ISIN}|sg`]: { ok: false, f: 0, why: 'missing', at: NOW } });
  assert.equal(check.chrome.storage.local.data.dgBgStatus.err, '');
  const gone = worker({ sync: { dgAlarms: [SG_ALARM], dgTickers: SG_LINK },
    responses: url => (url.includes('ValuesForWatchlist') ? { status: 410 } : { status: 404 }) });
  await gone.tick();
  assert.deepEqual(gone.chrome.storage.local.data.dgTickerCheck, { [`|€|${SG_ISIN}|sg`]: { ok: false, f: 0, why: 'missing', at: NOW } });
});

test('SG: an empty answer with status 200 to the daily refresh keeps the confirmed link, and it is still priced', async () => {
  const stale = { [`|€|${SG_ISIN}|sg`]: { ok: true, f: 1, y: 'SU054L', sg: SG_META, at: NOW - 25 * 3600000 } };
  const w = worker({ sync: { dgAlarms: [{ ...SG_ALARM, price: 5000 }], dgTickers: SG_LINK }, local: { dgTickerCheck: stale },
    responses: url => (url.includes('ValuesForWatchlist') ? { status: 200, body: '' } : sgSite()(url)) });
  await w.ticks(3);
  assert.deepEqual(w.chrome.storage.local.data.dgTickerCheck, stale, 'not unlinked as "not found"');
  assert.equal(w.calls.fetch.filter(f => f.url.includes('RealtimeValuesSnapshot')).length, 3, 'priced every minute');
  assert.match(w.chrome.storage.local.data.dgBgStatus.err, /empty answer/);
});

test('SG: an empty answer with status 200 to a price request holds that product, as a server error does', async () => {
  const CHECK = { [`|€|${SG_ISIN}|sg`]: { ok: true, f: 1, y: 'SU054L', sg: SG_META, at: NOW - 3600000 } };
  const w = worker({ sync: { dgAlarms: [SG_ALARM], dgTickers: SG_LINK }, local: { dgTickerCheck: CHECK },
    responses: sgSite(26.47, { body: ' ' }) });
  await w.tick();
  assert.deepEqual(w.chrome.storage.local.data.dgTickerCheck, CHECK, 'the link is kept');
  assert.match(w.chrome.storage.local.data.dgBgStatus.err, /empty answer/);
  assert.ok(w.chrome.storage.session.data.dgBgSgHold?.[SG_ISIN]?.at > NOW, 'that product waits');
  const asked = () => w.calls.fetch.filter(f => f.url.includes('RealtimeValuesSnapshot')).length;
  const n = asked();
  await w.tick();
  assert.equal(asked(), n, 'not asked again the next minute');
});

// ---------- SG: one product failing holds up no other ----------
const B_ISIN = 'DE000SB000B0';
const SG_B = { ...SG_ALARM, id: 'sB', productId: 778, price: 5000 };
const SG_A = { ...SG_ALARM, price: 5000 }; // never fires: priced every minute
const SG_AB_LINKS = { ...SG_LINK, 778: { t: '', cur: '€', isin: B_ISIN, v: 'sg' } };
const SG_CHECK_A = { [`|€|${SG_ISIN}|sg`]: { ok: true, f: 1, y: 'SU054L', sg: SG_META, at: NOW - 3600000 } };
const count = (w, part) => w.calls.fetch.filter(f => f.url.includes(part)).length;

test('SG: a link whose check keeps failing, listed first, never stops a confirmed SG product from being priced', async () => {
  const w = worker({ sync: { dgAlarms: [SG_B, SG_A], dgTickers: SG_AB_LINKS }, local: { dgTickerCheck: SG_CHECK_A },
    responses: url => (url.includes(`ValuesForWatchlist/${B_ISIN}`) ? { status: 500 } : sgSite()(url)) });
  await w.ticks(10);
  assert.equal(count(w, `RealtimeValuesSnapshot/${SG_META.id}`), 10, 'priced every minute');
  const checks = count(w, `ValuesForWatchlist/${B_ISIN}`);
  assert.ok(checks >= 2 && checks <= 3, `the failing link checked ${checks} times in 10 minutes (after 2, 4 … minutes)`);
});

test('SG: a failed daily refresh keeps a confirmed link, and it is still priced', async () => {
  const stale = { [`|€|${SG_ISIN}|sg`]: { ...SG_CHECK_A[`|€|${SG_ISIN}|sg`], at: NOW - 25 * 3600000 } };
  const w = worker({ sync: { dgAlarms: [SG_A], dgTickers: SG_LINK }, local: { dgTickerCheck: stale },
    responses: url => (url.includes('ValuesForWatchlist') ? { status: 503 } : sgSite()(url)) });
  await w.ticks(5);
  assert.equal(count(w, 'RealtimeValuesSnapshot'), 5);
  assert.deepEqual(w.chrome.storage.local.data.dgTickerCheck, stale);
});

test('SG: a price request failing for one product doesn\'t stop the others, in the same minute or later', async () => {
  const META_B = { ...SG_META, id: '999', code: '' };
  const w = worker({ sync: { dgAlarms: [SG_B, SG_A], dgTickers: SG_AB_LINKS },
    local: { dgTickerCheck: { ...SG_CHECK_A, [`|€|${B_ISIN}|sg`]: { ok: true, f: 1, y: B_ISIN, sg: META_B, at: NOW - 3600000 } } },
    responses: url => (url.includes('RealtimeValuesSnapshot/999') ? { status: 500 } : sgSite()(url)) });
  await w.ticks(1);
  assert.equal(count(w, 'RealtimeValuesSnapshot/999'), 1, 'the failing one was asked first');
  assert.equal(count(w, `RealtimeValuesSnapshot/${SG_META.id}`), 1, 'the other one was still priced');
  await w.ticks(9);
  assert.equal(count(w, `RealtimeValuesSnapshot/${SG_META.id}`), 10, 'priced every minute');
  assert.ok(count(w, 'RealtimeValuesSnapshot/999') <= 3, 'the failing one waits 2, 4 … minutes');
  assert.ok(w.chrome.storage.local.data.dgTickerCheck[`|€|${B_ISIN}|sg`], 'a server error keeps its link');
});

test('SG: when SG fails for every product (down, or refusing), it waits as a whole and stays lightly asked', async () => {
  const isins = ['DE000SG000A1', 'DE000SG000B2', 'DE000SG000C3'];
  const alarms = isins.map((_, i) => ({ ...SG_ALARM, id: `s${i}`, productId: 9000 + i, price: 5000 }));
  const links = Object.fromEntries(isins.map((isin, i) => [9000 + i, { t: '', cur: '€', isin, v: 'sg' }]));
  const checks = Object.fromEntries(isins.map((isin, i) => [`|€|${isin}|sg`, { ok: true, f: 1, y: isin, sg: { ...SG_META, id: String(100 + i), code: '' }, at: NOW - 3600000 }]));
  const w = worker({ sync: { dgAlarms: alarms, dgTickers: links }, local: { dgTickerCheck: checks }, responses: () => ({ status: 503 }) });
  await w.ticks(1);
  assert.equal(count(w, 'RealtimeValuesSnapshot'), 2, 'two failures in a row: SG stops for this minute');
  await w.ticks(1);
  assert.equal(count(w, 'RealtimeValuesSnapshot'), 2, 'and waits');
  await w.ticks(28);
  assert.ok(count(w, 'RealtimeValuesSnapshot') <= 10, `${count(w, 'RealtimeValuesSnapshot')} requests in 30 minutes`);
});

test('SG: any answer to an SG link check resets the wait counter of SG\'s prices, also when nothing is priced', async () => {
  const w = worker({ sync: { dgAlarms: [SG_ALARM], dgTickers: SG_LINK }, local: { dgAlarmState: { s1: { last: 26.4, lastAt: NOW - 60000 } } }, responses: sgSite() });
  w.chrome.storage.session.data.dgBgSgGap = 8;
  await w.tick();
  assert.equal(w.chrome.storage.local.data.dgTickerCheck[`|€|${SG_ISIN}|sg`].ok, true);
  assert.equal(w.calls.fetch.filter(f => f.url.includes('RealtimeValuesSnapshot')).length, 0, 'a tab priced it just now');
  assert.equal(w.chrome.storage.session.data.dgBgSgGap, 0);
  // SG answering that it has no such product is an answer too
  const missing = worker({ sync: { dgAlarms: [SG_ALARM], dgTickers: SG_LINK }, responses: () => ({ status: 404 }) });
  missing.chrome.storage.session.data.dgBgSgGap = 8;
  await missing.tick();
  assert.equal(missing.chrome.storage.local.data.dgTickerCheck[`|€|${SG_ISIN}|sg`].why, 'missing');
  assert.equal(missing.chrome.storage.session.data.dgBgSgGap, 0);
});

test('holds of a link or SG product that is gone (its alarm or link removed) are dropped; the others stay', async () => {
  const hold = { at: NOW + 10 * 60000, gap: 8 };
  const w = worker({ sync: { dgAlarms: [ALARM, SG_ALARM], dgTickers: { ...LINK, ...SG_LINK } },
    local: { dgTickerCheck: { [`|€|${SG_ISIN}|sg`]: { ok: true, f: 1, y: 'SU054L', sg: SG_META, at: NOW - 3600000 } } },
    responses: sgSite() });
  Object.assign(w.chrome.storage.session.data, {
    dgBgHold: { 'ASML.AS|€|': hold, 'GONE.AS|€|': hold },
    dgBgSgHold: { [SG_ISIN]: hold, [B_ISIN]: hold }
  });
  await w.tick();
  assert.deepEqual(w.chrome.storage.session.data.dgBgHold, { 'ASML.AS|€|': hold });
  assert.deepEqual(w.chrome.storage.session.data.dgBgSgHold, { [SG_ISIN]: hold });
});

test('a storage write failing mid-tick still saves the holds of that tick: a failing SG product keeps waiting', async () => {
  const META_B = { ...SG_META, id: '999', code: '' };
  const w = worker({ sync: { dgAlarms: [SG_B, SG_A], dgTickers: SG_AB_LINKS },
    local: { dgTickerCheck: { ...SG_CHECK_A, [`|€|${B_ISIN}|sg`]: { ok: true, f: 1, y: B_ISIN, sg: META_B, at: NOW - 3600000 } } },
    responses: url => (url.includes('RealtimeValuesSnapshot/999') ? { status: 500 } : sgSite()(url)) });
  const set = w.chrome.storage.local.set;
  let thrown = 0;
  // the other product's new bid is stored after B failed: that write fails, once
  w.chrome.storage.local.set = async patch => {
    if (patch.dgSgSeen && !thrown++) throw new Error('QUOTA_BYTES quota exceeded');
    return set(patch);
  };
  await w.ticks(1);
  assert.equal(thrown, 1);
  assert.ok(w.chrome.storage.session.data.dgBgSgHold?.[B_ISIN]?.at > NOW, 'B\'s hold was saved');
  await w.ticks(1);
  assert.equal(count(w, 'RealtimeValuesSnapshot/999'), 1, 'B waits');
  assert.equal(count(w, `RealtimeValuesSnapshot/${SG_META.id}`), 2, 'the other is priced');
});

test('pence on Yahoo, pounds on DEGIRO: the price is converted', async () => {
  const gbp = { ...ALARM, currency: '£', price: 13 };
  const w = worker({ sync: { dgAlarms: [gbp], dgTickers: { 123: { t: 'HSBA.L', cur: '£' } } },
    responses: url => url.includes('chart') ? { body: { chart: { result: [{ meta: { currency: 'GBp', regularMarketPrice: 1310 } }] } } }
      : { body: { 'HSBA.L': { timestamp: [NOW / 1000 - 60], close: [1310] } } } });
  await w.tick();
  assert.deepEqual(w.chrome.storage.local.data.dgAlarmEvents, [{ alarmId: 'a1', price: 13.1, at: NOW - 60000 }]);
});

test('Yahoo errors back off: the status says so and the next tick is skipped', async () => {
  const w = worker({ local: { dgTickerCheck: { 'ASML.AS|€|': { ok: true, f: 1, at: 1, y: 'ASML.AS' } } }, responses: () => ({ status: 429 }) });
  await w.tick();
  assert.match(w.chrome.storage.local.data.dgBgStatus.err, /429/);
  const n = w.calls.fetch.length;
  await w.tick();
  assert.equal(w.calls.fetch.length, n, 'skipped');
});

test('switched off, or without the permissions here: nothing is fetched, and the synced setting is left alone', async () => {
  const off = worker({ sync: { alarmsBackground: false }, responses: yahoo() });
  await off.tick();
  assert.equal(off.calls.fetch.length, 0);
  // switched on on another computer: this one, without the permissions, must not switch it off for both
  const denied = worker({ granted: false, responses: yahoo() });
  await denied.tick();
  denied.ev.startup.fns.forEach(fn => fn());
  denied.ev.removed.fns.forEach(fn => fn({ origins: ['https://query1.finance.yahoo.com/*'] }));
  await settle();
  assert.equal(denied.calls.fetch.length, 0);
  assert.equal(denied.chrome.storage.sync.data.alarmsBackground, true);
  assert.equal(denied.calls.alarms.has('dgPoll'), false);
});

test('an alarm a tab adds (and fires) while the worker waits for Yahoo keeps its banner and state', async () => {
  const added = { ...ALARM, id: 'a2', productId: 456, price: 1 };
  let w;
  w = worker({ local: { dgTickerCheck: { 'ASML.AS|€|': { ok: true, f: 1, at: 1, y: 'ASML.AS' } } }, responses: url => {
    if (url.includes('spark')) {
      w.chrome.storage.sync.data.dgAlarms = [ALARM, added];
      w.chrome.storage.local.data.dgAlarmEvents = [{ alarmId: 'a2', price: 2, at: NOW - 5000 }];
      w.chrome.storage.local.data.dgAlarmState = { a2: { firedAt: NOW - 5000 } };
    }
    return yahoo()(url);
  } });
  await w.tick();
  const local = w.chrome.storage.local.data;
  assert.deepEqual(local.dgAlarmEvents.map(e => e.alarmId).sort(), ['a1', 'a2']);
  assert.equal(local.dgAlarmState.a2.firedAt, NOW - 5000);
});

test('an alarm a tab fires while the worker waits for Yahoo is not fired again with Yahoo\'s older trade', async () => {
  // the tab fires at the clock's time; Yahoo's trade (15 minutes delayed) is older than that, so outside the minute
  for (const repeat of ['once', 'each']) {
    const tab = { alarmId: 'a1', price: 1040, at: NOW };
    let w;
    w = worker({ sync: { dgAlarms: [{ ...ALARM, repeat }] }, local: { dgTickerCheck: { 'ASML.AS|€|': { ok: true, f: 1, at: 1, y: 'ASML.AS' } } }, responses: url => {
      if (url.includes('spark')) {
        w.chrome.storage.local.data.dgAlarmState = { a1: { firedAt: NOW, last: 1040, lastAt: NOW } };
        w.chrome.storage.local.data.dgAlarmEvents = [tab];
      }
      return yahoo()(url); // its trade: NOW - 15 minutes
    } });
    await w.tick();
    const local = w.chrome.storage.local.data;
    assert.ok(w.calls.fetch.some(f => f.url.includes('spark')), repeat);
    assert.deepEqual(plain(local.dgAlarmEvents), [tab], `${repeat}: the tab's banner and price stay`);
    assert.equal(local.dgAlarmState.a1.firedAt, NOW, `${repeat}: the tab's firing time stays`);
    assert.deepEqual(w.calls.notes, [], `${repeat}: no second notification`);
    assert.deepEqual(w.calls.offscreen, [], `${repeat}: no second chime`);
    assert.equal(w.chrome.storage.sync.data.dgAlarms[0].on, true, `${repeat}: the worker doesn't switch it off (the tab does)`);
  }
});

test('an \'each\' alarm a tab fired an hour ago fires again once it crossed back and over', async () => {
  const each = { ...ALARM, repeat: 'each' };
  const earlier = NOW - 3600000;
  let sparks = 0;
  const w = worker({ sync: { dgAlarms: [each] }, local: { dgAlarmState: { a1: { firedAt: earlier } }, dgAlarmEvents: [{ alarmId: 'a1', price: 1010, at: earlier }],
    dgTickerCheck: { 'ASML.AS|€|': { ok: true, f: 1, at: 1, y: 'ASML.AS' } } }, responses: url => {
    if (!url.includes('spark')) return yahoo()(url);
    return { body: ++sparks === 1 ? spark(990) : spark(1050, NOW / 1000 - 840) }; // below (re-armed), then above
  } });
  await w.ticks(2);
  const local = w.chrome.storage.local.data;
  assert.deepEqual(plain(local.dgAlarmEvents), [{ alarmId: 'a1', price: 1050, at: NOW - 840000 }]);
  assert.equal(local.dgAlarmState.a1.firedAt, NOW - 840000);
  assert.equal(w.calls.notes.length, 1);
});

// ---------- "Clear saved data" while a request is out ----------
/**
 * A tick whose request to `part` is held open. Meanwhile the settings popup's "Clear saved data" erases every storage
 * area (the check is then off: alarmsBackground is gone, the alarms too) and gives the permissions back; then the
 * answer arrives. Returns the worker, the storage writes made after the wipe and the number of requests before it.
 */
async function wipedMidTick(part, { responses, ...opts }) {
  let release;
  const held = new Promise(r => { release = r; });
  const w = worker({ ...opts, responses: async url => { if (url.includes(part)) await held; return responses(url); } });
  await w.tick();
  assert.ok(w.calls.fetch.some(f => f.url.includes(part)), 'the request is out');
  const fetched = w.calls.fetch.length;
  for (const a of ['sync', 'local', 'session']) await w.chrome.storage[a].clear();
  w.chrome.permissions.contains = async () => false;
  const writes = [];
  for (const a of ['sync', 'local', 'session']) {
    const set = w.chrome.storage[a].set;
    w.chrome.storage[a].set = async patch => { writes.push(`${a}: ${Object.keys(patch).join(',')}`); return set(patch); };
  }
  release();
  await settle();
  return { w, writes, fetched };
}
for (const [name, part, opts] of [
  ['a link check', '/v8/finance/chart/', { responses: yahoo() }],
  ['a Yahoo price', '/v8/finance/spark', { local: { dgTickerCheck: { 'ASML.AS|€|': { ok: true, f: 1, at: 1, y: 'ASML.AS' } } }, responses: yahoo() }],
  ['an SG price', 'RealtimeValuesSnapshot', { sync: { dgAlarms: [SG_ALARM], dgTickers: SG_LINK },
    local: { dgTickerCheck: { [`|€|${SG_ISIN}|sg`]: { ok: true, f: 1, y: 'SU054L', sg: SG_META, at: NOW - 3600000 } } }, responses: sgSite() }]
]) {
  test(`saved data erased while ${name} is out: the tick writes nothing back, shows nothing and asks no more`, async () => {
    const { w, writes, fetched } = await wipedMidTick(part, opts);
    assert.deepEqual(writes, []);
    assert.deepEqual(w.calls.notes, []);
    assert.equal(w.calls.fetch.length, fetched);
    for (const a of ['sync', 'local', 'session']) assert.deepEqual(plain(w.chrome.storage[a].data), {}, a);
  });
}

test('the worker writes only firedAt: `last`/`lastAt` stay what a DEGIRO tab saw', async () => {
  const w = worker({ local: { dgAlarmState: { a1: { last: 990, lastAt: NOW - 3600000 } }, dgTickerCheck: { 'ASML.AS|€|': { ok: true, f: 1, at: 1, y: 'ASML.AS' } } }, responses: yahoo() });
  await w.tick();
  assert.deepEqual(plain(w.chrome.storage.local.data.dgAlarmState.a1), { last: 990, lastAt: NOW - 3600000, firedAt: NOW - 900000 });
});

test('Yahoo requests time out after 20 s', async () => {
  const w = worker({ responses: yahoo() });
  await w.tick();
  assert.ok(w.calls.fetch.every(f => f.opts.signal instanceof AbortSignal));
});

test('the poll alarm exists only while on, granted and some alarm is linked', async () => {
  const w = worker();
  w.ev.installed.fns.forEach(fn => fn());
  await settle();
  assert.deepEqual(plain(w.calls.alarms.get('dgPoll')), { periodInMinutes: 1, delayInMinutes: 0.1 });
  const none = worker({ sync: { dgTickers: {} } });
  none.ev.startup.fns.forEach(fn => fn());
  await settle();
  assert.equal(none.calls.alarms.has('dgPoll'), false);
});

test('permissions granted while the popup was closed switch the setting on', async () => {
  const w = worker({ sync: { alarmsBackground: false } });
  w.ev.added.fns.forEach(fn => fn({ origins: ['https://query1.finance.yahoo.com/*'] }));
  await settle();
  assert.equal(w.chrome.storage.sync.data.alarmsBackground, true);
  assert.ok(w.calls.alarms.has('dgPoll'));
});

test('clicking a notification opens the product in DEGIRO; foreign ids are ignored', async () => {
  const w = worker();
  w.ev.clicked.fns.forEach(fn => fn('dg|123|a1|5'));
  w.ev.clicked.fns.forEach(fn => fn('other|1'));
  w.ev.clicked.fns.forEach(fn => fn('dg|javascript:alert(1)|a|1'));
  await settle();
  assert.deepEqual(plain(w.calls.tabs), [{ url: 'https://trader.degiro.nl/trader/#/products/123/overview' }]);
});

test('clicking the settings\' test notification without an alarm (dgtest|…) closes it and opens nothing', async () => {
  const w = worker();
  w.ev.clicked.fns.forEach(fn => fn('dgtest|1763467200000'));
  await settle();
  assert.deepEqual(w.calls.tabs, []);
  assert.deepEqual(w.calls.cleared, ['dgtest|1763467200000']);
});
