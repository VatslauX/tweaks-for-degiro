// Price alarms (alarm-rules.js, alarms.js) in real tab scripts: firing rules, two tabs sharing one
// storage, and write races. Prices come from the Favourites mock (Mock ETF 123 = 16.92).
// Stays in Playwright: the Alarm button and panel, the Alarms page layout, banner placement/looks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorld, alarm, noErrors, events, stateOf, listOf, banners } = require('./harness');

const writesTo = (w, key) => w.log.filter(l => l.keys.includes(key)).length;

// a world with these alarms stored and n tabs on Favourites; the first run's throttle window has passed
async function setup(alarms, n = 1) {
  const w = createWorld();
  await w.set('sync', { dgAlarms: alarms });
  const tabs = [];
  for (let i = 0; i < n; i++) tabs.push(await w.open({ fixture: 'favourites', hash: '/favourites' }));
  await w.advance(200);
  w.log.length = 0; // count only what the test causes (opening writes each alarm's first price)
  return { w, tabs, tab: tabs[0] };
}
// DEGIRO shows a new price; the extension checks within a frame
async function price(tab, id, v, ms = 200) { tab.setPrice(id, v); await tab.world.advance(ms); }

test('once: fires when the price reaches it, then switches itself off and stays quiet', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'once' });
  const { w, tab } = await setup([a]);
  await price(tab, 123, 16.99);
  assert.equal(events(w).length, 0, 'below the price: nothing fires');
  await price(tab, 123, 17.5);
  assert.equal(events(w).length, 1);
  assert.equal(events(w)[0].price, 17.5);
  assert.equal(listOf(w)[0].on, false, 'a once alarm switches itself off in the stored list');
  assert.deepEqual(banners(tab), [a.id]);
  const firedAt = stateOf(w, a.id).firedAt;
  assert.ok(firedAt);
  await price(tab, 123, 16);
  await price(tab, 123, 18);
  assert.equal(events(w).length, 1);
  assert.equal(events(w)[0].price, 17.5, 'the old event is not replaced');
  assert.equal(stateOf(w, a.id).firedAt, firedAt);
  noErrors(w);
});

test('below: fires at or under the price', async () => {
  const a = alarm({ price: 16, dir: 'below' });
  const { w, tab } = await setup([a]);
  await price(tab, 123, 16.01);
  assert.equal(events(w).length, 0);
  await price(tab, 123, 16);
  assert.equal(events(w).length, 1, 'equal to the price counts as reached');
});

test('daily: once per local day; fires again after midnight', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'daily' });
  const { w, tab } = await setup([a]);
  await price(tab, 123, 17.5);
  const first = stateOf(w, a.id).firedAt;
  assert.ok(first);
  assert.equal(listOf(w)[0].on, true, 'daily stays on');
  // same day, the price goes back and up again: no second firing
  await price(tab, 123, 16);
  await price(tab, 123, 17.6);
  assert.equal(stateOf(w, a.id).firedAt, first);
  assert.equal(events(w)[0].price, 17.5);
  // 10:00 -> 01:00 the next day
  await w.skip(15 * 3600e3);
  assert.equal(new Date(w.now).getDate(), new Date(first).getDate() + 1);
  await price(tab, 123, 16);
  await price(tab, 123, 17.7);
  assert.ok(stateOf(w, a.id).firedAt > first, 'fires again on the new day');
  assert.equal(events(w).length, 1, 'one event per alarm (the latest)');
  assert.equal(events(w)[0].price, 17.7);
  noErrors(w);
});

test('each: fires once per crossing and re-arms only after the price went back', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'each' });
  const { w, tab } = await setup([a]);
  await price(tab, 123, 17.5);
  const first = stateOf(w, a.id).firedAt;
  assert.ok(first);
  assert.equal(listOf(w)[0].on, true);
  await price(tab, 123, 17.8);
  await price(tab, 123, 17.2);
  assert.equal(stateOf(w, a.id).firedAt, first, 'still above: not armed again');
  assert.equal(events(w)[0].price, 17.5);
  await price(tab, 123, 16.5); // back on the other side: armed
  assert.equal(stateOf(w, a.id).firedAt, first);
  await price(tab, 123, 17.3);
  assert.ok(stateOf(w, a.id).firedAt > first, 'second crossing fires');
  assert.equal(events(w)[0].price, 17.3);
});

test('an alarm for a product that is not in the list stays quiet; a switched-off one too', async () => {
  const { w, tab } = await setup([alarm({ productId: 999, price: 1 }), alarm({ price: 10, on: false })]);
  await price(tab, 123, 20);
  assert.equal(events(w).length, 0);
});

test('malformed stored alarms are dropped, valid ones still work', async () => {
  const good = alarm({ price: 17 });
  const { w, tab } = await setup([null, 'x', { id: '../bad', productId: 123, price: 1, dir: 'above', repeat: 'once' },
    { ...alarm(), price: -5 }, { ...alarm(), dir: 'sideways' }, { ...alarm(), id: good.id }, good]);
  assert.equal(tab.run('dgAlarmStore.list().length'), 1);
  await price(tab, 123, 17.5);
  assert.equal(events(w).length, 1);
  noErrors(w);
});

// ---------- two tabs, one storage ----------

// A crossing seen by two tabs within a few ms is a read-then-write race that chrome.storage cannot prevent:
// both tabs may write, and the later event replaces the earlier. What must hold: one stored event, the alarm
// switched off, one banner per tab.
test('two tabs, once: a near-simultaneous crossing (slow storage) leaves one event, the alarm off, one banner per tab', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'once' });
  const { w, tabs: [A, B] } = await setup([a], 2);
  w.latency.get = w.latency.set = 20;
  A.setPrice(123, 17.5);
  await w.advance(5);
  B.setPrice(123, 17.6); // B checks before A's write has landed
  await w.advance(1000);
  assert.deepEqual(events(w).map(e => e.alarmId), [a.id], 'exactly one stored event');
  assert.equal(listOf(w).length, 1);
  assert.equal(listOf(w)[0].on, false, 'switched off');
  assert.deepEqual([banners(A), banners(B)], [[a.id], [a.id]], 'one banner per tab');
  noErrors(w);
});

test('two tabs, once: the second tab to see the crossing does not fire again', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'once' });
  const { w, tabs: [A, B] } = await setup([a], 2);
  await price(A, 123, 17.5, 30);
  const firedAt = stateOf(w, a.id).firedAt;
  assert.ok(firedAt);
  await price(B, 123, 17.9, 30);
  assert.equal(stateOf(w, a.id).firedAt, firedAt);
  assert.equal(events(w).length, 1);
  assert.equal(events(w)[0].price, 17.5, 'the event is the first tab\'s');
  assert.equal(writesTo(w, 'dgAlarmEvents'), 1, 'events written once');
});

test('two tabs, daily: the second tab does not fire on the same day', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'daily' });
  const { w, tabs: [A, B] } = await setup([a], 2);
  await price(A, 123, 17.5, 30);
  const firedAt = stateOf(w, a.id).firedAt;
  await price(B, 123, 17.9, 30);
  await w.skip(3 * 3600e3); // later the same day
  await price(B, 123, 16);
  await price(B, 123, 18);
  await price(A, 123, 16);
  await price(A, 123, 18.2);
  assert.equal(stateOf(w, a.id).firedAt, firedAt);
  assert.equal(events(w)[0].price, 17.5);
  assert.equal(writesTo(w, 'dgAlarmEvents'), 1);
});

// chime.js plays through Web Audio, which JSDOM lacks: a stand-in counts the chimes (one AudioContext each), and
// `active` stands for Chrome's autoplay rule (the tab was clicked in). Asking the worker is recorded too.
function sound(tab, active) {
  const s = { played: 0, asked: [] };
  const node = () => ({ connect: n => n, start() {}, stop() {}, type: '', frequency: {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } });
  tab.window.AudioContext = class { constructor() { s.played++; this.currentTime = 0; this.destination = {}; } createOscillator() { return node(); } createGain() { return node(); } close() { return Promise.resolve(); } };
  Object.defineProperty(tab.window.navigator, 'userActivation', { configurable: true, value: { hasBeenActive: active } });
  tab.window.chrome.runtime.sendMessage = async m => { s.asked.push(m); };
  return s;
}

test('chime: only the tab that fired plays it, once; another tab\'s banner and a banner shown again on load stay quiet', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'once' }), b = alarm({ price: 17.2, dir: 'above', repeat: 'once' });
  const { w, tabs: [A, B] } = await setup([a, b], 2);
  const sa = sound(A, true), sb = sound(B, true);
  await price(A, 123, 17.5);
  assert.equal(events(w).length, 2);
  assert.equal(sa.played, 1, 'two alarms in one check: one chime');
  assert.deepEqual(banners(B).sort(), [a.id, b.id].sort());
  assert.equal(sb.played, 0, 'the other tab shows the banners without a chime');
  const C = await w.open({ fixture: 'favourites', hash: '/favourites' });
  const sc = sound(C, true);
  await w.advance(200);
  assert.equal(banners(C).length, 2);
  assert.deepEqual([sa.played, sb.played, sc.played], [1, 0, 0], 'a reopened page shows the banners again, quietly');
  assert.deepEqual([...sa.asked, ...sb.asked, ...sc.asked], []);
  noErrors(w);
});


test('chime: a tab not clicked in yet (no sound allowed) asks the background worker; the switch off silences it', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'each' });
  const { w, tab } = await setup([a]);
  const s = sound(tab, false);
  await price(tab, 123, 17.5);
  assert.equal(s.played, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(s.asked)), [{ type: 'dg-chime' }]);
  await tab.setFlag('alarmSound', false);
  await price(tab, 123, 16);
  await price(tab, 123, 17.6);
  assert.equal(events(w).at(-1).price, 17.6, 'fired again');
  assert.equal(s.played, 0);
  assert.equal(s.asked.length, 1, 'switched off: no chime asked for');
  noErrors(w);
});

test('two tabs, each: the other tab\'s firing is not repeated (no ping-pong), and a real new crossing is', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'each' });
  const { w, tabs: [A, B] } = await setup([a], 2);
  await price(A, 123, 17.5, 30);
  await price(B, 123, 17.6, 30); // B sees the crossing 30 ms later: A fired within a minute
  const firedAt = stateOf(w, a.id).firedAt;
  assert.equal(writesTo(w, 'dgAlarmEvents'), 1);
  // minutes of jitter above the price, past the 60 s window: nobody fires again
  for (let i = 0; i < 6; i++) {
    await w.skip(20e3);
    await price(A, 123, 17.5 + (i % 2) / 10);
    await price(B, 123, 17.6 + (i % 2) / 10);
  }
  assert.equal(stateOf(w, a.id).firedAt, firedAt);
  assert.equal(writesTo(w, 'dgAlarmEvents'), 1, 'no tab re-fired');
  // A goes back and up again: that is a new crossing
  await price(A, 123, 16);
  await price(A, 123, 17.4);
  assert.ok(stateOf(w, a.id).firedAt > firedAt);
  assert.equal(writesTo(w, 'dgAlarmEvents'), 2);
  noErrors(w);
});

// ---------- the background worker and a tab ----------

// The worker (background.js) stores its firing as a tab does, but its firedAt is the trade's time: Yahoo's price is
// about 15 minutes old (a closed market's close, hours). Written as the worker does: state and event, then later
// (not here) the 'once' switch-off in sync.
async function workerFired(w, a, price = 17.4) {
  const at = w.now - 15 * 60e3;
  await w.set('local', {
    dgAlarmState: { ...(w.stored('local').dgAlarmState || {}), [a.id]: { ...stateOf(w, a.id), firedAt: at } },
    dgAlarmEvents: [...events(w).filter(e => e.alarmId !== a.id), { alarmId: a.id, price, at }]
  });
  return at;
}
const alarmWrites = (w, from) => w.log.slice(from).filter(l => l.area === 'sync' && l.keys.includes('dgAlarms')).length;

/** the worker fires `repeat` while the tab, which saw the price below, is about to see it reached */
async function workerThenTab(repeat) {
  const a = alarm({ price: 17, dir: 'above', repeat });
  const { w, tab } = await setup([a]);
  const s = sound(tab, true);
  await price(tab, 123, 16.5); // below: an 'each' alarm is armed in this tab
  const at = await workerFired(w, a); // its storage event reaches the tab
  const from = w.log.length;
  await price(tab, 123, 17.5);
  assert.deepEqual(events(w), [{ alarmId: a.id, price: 17.4, at }], 'the worker\'s event stays, no second one');
  assert.equal(stateOf(w, a.id).firedAt, at);
  assert.deepEqual([s.played, s.asked.length], [0, 0], 'no chime, none asked of the worker');
  assert.equal(alarmWrites(w, from), 0, 'the tab switches nothing off (the worker does)');
  assert.deepEqual(banners(tab), [a.id]);
  noErrors(w);
}

test('background: a tab does not fire a once alarm again that the worker just fired with Yahoo\'s older trade', () => workerThenTab('once'));

test('background: nor an \'each\' alarm', () => workerThenTab('each'));

test('background: a tab whose storage event lags still drops its firing once the worker\'s is stored', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'once' });
  const { w, tab } = await setup([a]);
  const s = sound(tab, true);
  const held = tab.listeners.splice(0); // the worker's write is stored, but its onChanged hasn't reached this tab yet
  const at = await workerFired(w, a);
  const from = w.log.length;
  await price(tab, 123, 17.5); // the tab still sees the alarm on and unfired: it fires, and its merge reads storage
  tab.listeners.push(...held);
  await w.advance(200);
  assert.deepEqual(events(w), [{ alarmId: a.id, price: 17.4, at }], 'the merge dropped the tab\'s firing');
  assert.equal(stateOf(w, a.id).firedAt, at);
  assert.deepEqual([s.played, s.asked.length], [0, 0], 'no chime');
  assert.equal(alarmWrites(w, from), 0, 'a dropped firing is not switched off by the tab');
  noErrors(w);
});

test('background: an \'each\' alarm the worker fired while the tab was on another page is not fired again when it comes back', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'each' });
  const { w, tab } = await setup([a]);
  const s = sound(tab, true);
  await price(tab, 123, 16.5); // below: armed in this tab
  await tab.go('/portfolio'); // the tab stops pricing the product; after 3 minutes the worker checks it
  await w.advance(200);
  tab.setPrice(123, 17.5); // DEGIRO's price moves on meanwhile (not read on this page)
  await w.skip(3 * 60e3);
  const at = await workerFired(w, a);
  await w.advance(200); // its storage event reaches the tab
  await w.skip(90e3); // the user comes back more than a minute later, the price still above
  const from = w.log.length;
  await tab.go('/favourites');
  await w.advance(200);
  assert.deepEqual(events(w), [{ alarmId: a.id, price: 17.4, at }], 'the worker\'s event stays, no second one');
  assert.equal(stateOf(w, a.id).firedAt, at);
  assert.deepEqual([s.played, s.asked.length], [0, 0], 'no chime, none asked of the worker');
  assert.equal(w.log.slice(from).filter(l => l.keys.includes('dgAlarmEvents')).length, 0, 'no event written');
  // back below and over again: a new crossing fires in this tab
  await price(tab, 123, 16.5);
  await price(tab, 123, 17.6);
  assert.deepEqual(events(w).map(e => [e.alarmId, e.price]), [[a.id, 17.6]]);
  assert.ok(events(w)[0].at > at && stateOf(w, a.id).firedAt === events(w)[0].at);
  assert.equal(s.played, 1);
  noErrors(w);
});

test('background: a once alarm switched back on fires, though an older firing of it was stored before the tab opened', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'once', on: false });
  const w = createWorld();
  await w.set('sync', { dgAlarms: [a] });
  const old = w.now - 15 * 60e3; // e.g. the worker's firing, before the user switched it back on
  await w.set('local', { dgAlarmState: { [a.id]: { firedAt: old } }, dgAlarmEvents: [] });
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites' });
  await w.advance(200); // its first price is stored: that storage event carries the old firedAt again
  assert.equal(stateOf(w, a.id).firedAt, old);
  assert.ok(stateOf(w, a.id).lastAt, 'the first price was written after the tab loaded');
  const s = sound(tab, true);
  assert.equal(await tab.run(`dgAlarmStore.setOn(${JSON.stringify(a.id)}, true)`), true);
  await w.advance(200);
  await price(tab, 123, 17.5);
  assert.deepEqual(events(w).map(e => [e.alarmId, e.price]), [[a.id, 17.5]], 'fires at once, not held back');
  assert.equal(listOf(w)[0].on, false);
  assert.equal(s.played, 1);
  noErrors(w);
});

test('banners show in every tab, and closing in one closes it in the other', async () => {
  const a = alarm({ price: 17 });
  const { w, tabs: [A, B] } = await setup([a], 2);
  await price(A, 123, 17.5);
  assert.deepEqual([banners(A), banners(B)], [[a.id], [a.id]]);
  assert.match(A.$('[data-dg-alarm-banner]').textContent, /rose to/);
  B.$('[data-dg-alarm-close]').click();
  await w.advance(200);
  assert.deepEqual([banners(A), banners(B)], [[], []]);
  assert.deepEqual(events(w), []);
  noErrors(w);
});

test('a tab opened later shows the banners that are still open', async () => {
  const a = alarm({ price: 17 });
  const { w, tab } = await setup([a]);
  await price(tab, 123, 17.5);
  const late = await w.open({ fixture: 'favourites', hash: '/favourites' });
  await w.advance(200);
  assert.deepEqual(banners(late), [a.id]);
});

// ---------- races ----------

// An alarm fires for the first time (no firedAt stored yet); while record() still reads storage for its merge, another
// tab stores only another alarm's `last`. Its storage event carries the stored state, without this tab's new firedAt:
// the tab keeps its own until written, so the next check doesn't fire the alarm a second time.
async function otherWriteMidMerge(repeat) {
  const a = alarm({ price: 17, dir: 'above', repeat });
  const b = alarm({ productId: 999, price: 5, dir: 'above', repeat: 'each' }); // its product isn't in this tab's list
  const { w, tab } = await setup([a, b]);
  const s = sound(tab, true);
  const before = w.stored('local').dgAlarmState || {};
  assert.equal(before[a.id]?.firedAt, undefined, 'never fired before');
  w.latency.get = 50; // record()'s read for its merge takes 50 ms
  tab.setPrice(123, 17.5);
  await w.advance(20); // fired: in this tab's state, not stored yet
  w.latency.get = 0;
  await w.set('local', { dgAlarmState: { ...before, [b.id]: { last: 4, lastAt: w.now } } });
  await w.advance(1000);
  assert.equal(events(w).length, 1);
  const [e] = events(w);
  assert.deepEqual([e.alarmId, e.price], [a.id, 17.5]);
  assert.equal(stateOf(w, a.id).firedAt, e.at, 'the first firing stays');
  assert.equal(stateOf(w, b.id).last, 4, 'the other tab\'s write is kept');
  assert.equal(writesTo(w, 'dgAlarmEvents'), 1, 'fired once');
  assert.equal(s.played, 1, 'one chime');
  return { w, tab, a, s, at: e.at };
}

test('race: an \'each\' alarm\'s first firing is not repeated when another alarm\'s state is written during its merge', async () => {
  const { w } = await otherWriteMidMerge('each');
  noErrors(w);
});

test('race: nor a \'daily\' alarm\'s', async () => {
  const { w } = await otherWriteMidMerge('daily');
  noErrors(w);
});

test('race: the tab\'s unsaved state outlives no write: later stored changes count again', async () => {
  const { w, tab, a, s, at } = await otherWriteMidMerge('daily');
  // another tab's edit clears the firing (as update() does): this tab sees it, and the price, still past the alarm,
  // fires it again today
  await w.skip(5000);
  const st = { ...stateOf(w, a.id) };
  delete st.firedAt;
  await w.set('local', { dgAlarmState: { ...w.stored('local').dgAlarmState, [a.id]: st }, dgAlarmEvents: [] });
  await w.advance(200);
  assert.deepEqual(events(w).map(e => [e.alarmId, e.price]), [[a.id, 17.5]], 'fired again after the edit');
  assert.ok(events(w)[0].at > at && stateOf(w, a.id).firedAt === events(w)[0].at);
  assert.equal(tab.json(`dgAlarmStore.state()[${JSON.stringify(a.id)}].firedAt`), events(w)[0].at);
  assert.equal(s.played, 2);
  // the worker's later firing reaches this tab's state too
  const later = stateOf(w, a.id).firedAt + 1000;
  await w.set('local', { dgAlarmState: { ...w.stored('local').dgAlarmState, [a.id]: { ...stateOf(w, a.id), firedAt: later } } });
  await w.advance(200);
  assert.equal(tab.json(`dgAlarmStore.state()[${JSON.stringify(a.id)}].firedAt`), later);
  noErrors(w);
});

// A 'once' alarm that fired is switched off in the tab at once, and in storage only at the end of record(): until then
// the tab's `on: false` is all that keeps the next check from firing it again, whatever replaces the list meanwhile.
const onIn = (tab, id) => tab.json(`dgAlarmStore.list().find(x => x.id === ${JSON.stringify(id)}).on`);

test('race: a once alarm is not fired again when another writer stores the alarm list during its switch-off', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'once' });
  const b = alarm({ productId: 999, price: 5, dir: 'above', repeat: 'each', on: false }); // not in this tab's list
  const { w, tab } = await setup([a, b]);
  const s = sound(tab, true);
  w.latency.get = 50; // record()'s read for its merge takes 50 ms
  tab.setPrice(123, 17.5);
  await w.advance(20); // fired and switched off in this tab, not stored yet
  assert.equal(onIn(tab, a.id), false);
  w.latency.get = 0;
  await w.set('sync', { dgAlarms: [a, { ...b, on: true }] }); // another tab switches b on: a is still stored on
  assert.equal(onIn(tab, b.id), true, 'the other writer\'s change is taken');
  await w.advance(1000); // the price is still past the alarm
  assert.deepEqual(events(w).map(e => [e.alarmId, e.price]), [[a.id, 17.5]]);
  assert.equal(writesTo(w, 'dgAlarmEvents'), 1, 'fired once');
  assert.equal(s.played, 1, 'one chime');
  assert.deepEqual(listOf(w).map(x => [x.id, x.on]), [[a.id, false], [b.id, true]]);
  assert.deepEqual(banners(tab), [a.id]);
  noErrors(w);
});

test('race: two once alarms firing in separate checks while the first one\'s write is in flight each fire once', async () => {
  const x = alarm({ price: 17, productId: 123, repeat: 'once' }), y = alarm({ price: 1300, productId: 456, repeat: 'once' });
  const { w, tab } = await setup([x, y]);
  const s = sound(tab, true);
  w.latency.set = 50; // every write takes 50 ms: x's switch-off is stored (from the stored list) after y fired
  tab.setPrice(123, 17.5);
  await w.advance(20);
  tab.setPrice(456, 1301); // a later check: y fires while x's record() is still writing
  await w.advance(3000); // both prices stay past their alarms
  assert.deepEqual(events(w).map(e => e.alarmId).sort(), [x.id, y.id].sort(), 'one event per alarm');
  assert.equal(writesTo(w, 'dgAlarmEvents'), 2, 'each fired once');
  assert.equal(s.played, 2, 'one chime per firing');
  assert.deepEqual(listOf(w).map(a => a.on), [false, false], 'both switched off');
  assert.deepEqual([onIn(tab, x.id), onIn(tab, y.id)], [false, false]);
  noErrors(w);
});

test('race: a once alarm the user switches back on after its switch-off is on again and fires again', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'once' });
  const { w, tab } = await setup([a]);
  const s = sound(tab, true);
  await price(tab, 123, 17.5);
  assert.equal(listOf(w)[0].on, false);
  await price(tab, 123, 16.5);
  assert.equal(await tab.run(`dgAlarmStore.setOn(${JSON.stringify(a.id)}, true)`), true);
  await w.advance(200);
  assert.deepEqual([listOf(w)[0].on, onIn(tab, a.id)], [true, true], 'nothing of the switch-off is laid over it');
  await price(tab, 123, 17.6);
  assert.deepEqual(events(w).map(e => [e.alarmId, e.price]), [[a.id, 17.6]], 'fired again');
  assert.equal(listOf(w)[0].on, false);
  assert.equal(s.played, 2);
  noErrors(w);
});

test('a once alarm whose switch-off storage refuses stays off in the tab (no firing on every check) until switched on', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'once' });
  const { w, tab } = await setup([a]);
  const s = sound(tab, true);
  w.faults.set = true;
  await price(tab, 123, 17.5, 1000);
  assert.equal(s.played, 1, 'fired once, not again on every check');
  assert.equal(onIn(tab, a.id), false, 'off in this tab');
  assert.equal(listOf(w)[0].on, true, 'storage refused the switch-off');
  w.faults.set = false;
  assert.equal(await tab.run(`dgAlarmStore.setOn(${JSON.stringify(a.id)}, true)`), true);
  await w.advance(200); // the price is still past the alarm: switched on, it fires
  assert.equal(s.played, 2);
  assert.deepEqual(events(w).map(e => e.alarmId), [a.id]);
  assert.equal(listOf(w)[0].on, false);
  noErrors(w);
});

test('a once alarm whose switch-off storage refused is on again once edited', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'once' });
  const { w, tab } = await setup([a]);
  const s = sound(tab, true);
  w.faults.set = true;
  await price(tab, 123, 17.5, 1000);
  assert.deepEqual([s.played, onIn(tab, a.id)], [1, false]);
  w.faults.set = false;
  assert.equal(await tab.run(`dgAlarmStore.update(${JSON.stringify(a.id)}, { price: 17.2, dir: 'above', repeat: 'once' })`), 'ok');
  assert.equal(onIn(tab, a.id), true, 'the edit switched it on');
  await w.advance(200); // the price is still past the edited alarm: it fires
  assert.equal(s.played, 2);
  assert.equal(listOf(w)[0].on, false);
  noErrors(w);
});

// Storage refuses the write of a tab's own firing (chimed, kept by its merge): the tab keeps counting it as fired and
// stores it with its next write that goes through, unless another writer's firing or an edit came in between.
const firedIn = (tab, id) => tab.json(`dgAlarmStore.state()[${JSON.stringify(id)}]?.firedAt ?? null`);
async function refusedFiring(repeat) {
  const a = alarm({ price: 17, dir: 'above', repeat });
  const { w, tab } = await setup([a]);
  const s = sound(tab, true);
  w.faults.set = true;
  await price(tab, 123, 17.5);
  w.faults.set = false;
  assert.equal(s.played, 1, 'fired and chimed');
  assert.equal(stateOf(w, a.id).firedAt, undefined, 'storage refused the firing');
  const at = firedIn(tab, a.id);
  assert.ok(at, 'the tab counts it as fired');
  return { w, tab, a, s, at };
}

test('a firing whose save storage refused is stored by the tab\'s next price write, and does not fire again', async () => {
  for (const repeat of ['daily', 'each']) {
    const { w, tab, a, s, at } = await refusedFiring(repeat);
    await w.skip(61e3);
    await price(tab, 123, 17.6); // a price-only write (no firing): it goes through
    assert.equal(stateOf(w, a.id).firedAt, at, `${repeat}: the firing is stored now`);
    assert.equal(stateOf(w, a.id).last, 17.6, repeat);
    assert.equal(firedIn(tab, a.id), at, repeat);
    for (const v of [17.8, 17.9]) { await w.skip(61e3); await price(tab, 123, v); } // still past the alarm, later that day
    assert.equal(s.played, 1, `${repeat}: no second chime`);
    assert.equal(stateOf(w, a.id).firedAt, at, repeat);
    assert.deepEqual(events(w), [], `${repeat}: no event stored for it (the banner is not retried)`);
    noErrors(w);
  }
});

test('a firing whose save storage refused still counts when another writer\'s state lands before the tab writes again', async () => {
  const { w, tab, a, s, at } = await refusedFiring('daily');
  const b = alarm({ productId: 999, price: 5 });
  // another tab stores only another alarm's price: its storage event carries the stored state, without the firing
  await w.set('local', { dgAlarmState: { ...w.stored('local').dgAlarmState, [b.id]: { last: 4, lastAt: w.now } } });
  await w.advance(50);
  assert.equal(firedIn(tab, a.id), at, 'the refused firing is laid over the state from storage');
  w.faults.set = true; // and storage still refuses: the next checks must not fire it again
  for (const v of [17.6, 17.8]) { await w.skip(61e3); await price(tab, 123, v); }
  w.faults.set = false;
  assert.equal(s.played, 1, 'no second chime');
  noErrors(w);
});

// A price-only save (no firing) must not carry the tab's old firedAt: another writer's newer firing, stored while the
// save waits for its merge, would be undone in the tab
test('race: a price-only save in flight does not lay the tab\'s old firedAt over a newer one stored meanwhile', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'each' });
  const { w, tab } = await setup([a]);
  await price(tab, 123, 17.5); // fires: firedAt stored
  const old = stateOf(w, a.id).firedAt;
  assert.ok(old);
  await w.skip(61e3);
  await price(tab, 123, 16.5); // back below: arms it again ('each'), a price-only save
  await w.skip(61e3);
  w.latency.get = 50; // the next save's read for its merge takes 50 ms
  tab.setPrice(123, 16.6); // a price-only save, still below the alarm
  await w.advance(20);
  w.latency.get = 0;
  const theirs = w.now - 1000; // another writer's firing (the worker's: an older trade time than the tab's clock)
  await w.set('local', { dgAlarmState: { ...w.stored('local').dgAlarmState, [a.id]: { ...stateOf(w, a.id), firedAt: theirs } } });
  await w.advance(10); // the storage event is in; the tab's save is still waiting for its read
  assert.equal(firedIn(tab, a.id), theirs, 'the newer firing counts in the tab, not its old one');
  await w.advance(1000);
  assert.equal(stateOf(w, a.id).firedAt, theirs, 'and stays stored');
  noErrors(w);
});

test('a firing whose save storage refused gives way to a firing another writer stored meanwhile', async () => {
  // another tab's later firing, and the worker's (its firedAt is Yahoo's trade time, older than the tab's)
  for (const later of [true, false]) {
    const { w, tab, a, s, at } = await refusedFiring('daily');
    await w.skip(30e3);
    const theirs = later ? w.now : at - 15 * 60e3;
    const ev = { alarmId: a.id, price: 17.4, at: theirs };
    await w.set('local', { dgAlarmState: { ...w.stored('local').dgAlarmState, [a.id]: { ...stateOf(w, a.id), firedAt: theirs } }, dgAlarmEvents: [ev] });
    await w.skip(61e3);
    await price(tab, 123, 17.6); // the tab's next price write
    assert.equal(stateOf(w, a.id).firedAt, theirs, `later ${later}: the other writer's firing stays stored`);
    assert.equal(firedIn(tab, a.id), theirs, `later ${later}: and counts in the tab`);
    await w.skip(61e3);
    await price(tab, 123, 17.8);
    assert.equal(stateOf(w, a.id).firedAt, theirs, `later ${later}`);
    assert.deepEqual(events(w), [ev], `later ${later}: no other event`);
    assert.equal(s.played, 1, `later ${later}: no second chime`);
    noErrors(w);
  }
});

test('a firing whose save storage refused is dropped once the alarm is edited, here or in another tab', async () => {
  for (const where of ['here', 'elsewhere']) {
    const { w, tab, a, s, at } = await refusedFiring('daily');
    if (where === 'here') assert.equal(await tab.run(`dgAlarmStore.update(${JSON.stringify(a.id)}, { price: 17.2, dir: 'above', repeat: 'daily' })`), 'ok');
    else await w.set('sync', { dgAlarms: [{ ...a, price: 17.2 }] }); // another tab's edit (its state had no firedAt to clear)
    await w.advance(200); // the price is still past the edited alarm: it starts afresh and fires again
    assert.equal(s.played, 2, where);
    const again = stateOf(w, a.id).firedAt;
    assert.ok(again > at, `${where}: the new firing is stored, not the old one`);
    assert.equal(firedIn(tab, a.id), again, where);
    assert.deepEqual(events(w).map(e => [e.alarmId, e.price, e.at]), [[a.id, 17.5, again]], where);
    await w.skip(61e3);
    await price(tab, 123, 17.6);
    assert.equal(stateOf(w, a.id).firedAt, again, `${where}: the old firing is never written back`);
    assert.equal(s.played, 2, where);
    noErrors(w);
  }
});

test('race: closing a banner while record() is still writing loses neither update', async () => {
  const x = alarm({ price: 17, productId: 123 }), y = alarm({ price: 1300, productId: 456, name: 'Mock Tech' });
  const { w, tab } = await setup([x, y]);
  await price(tab, 123, 17.5);
  assert.deepEqual(events(w).map(e => e.alarmId), [x.id]);
  w.latency.set = 50; // every write now takes 50 ms
  tab.setPrice(456, 1301); // y fires: record() starts writing
  await w.advance(30);
  tab.$(`[data-dg-alarm-banner="${x.id}"] [data-dg-alarm-close]`).click(); // x is closed while that is in flight
  await w.advance(2000);
  assert.deepEqual(events(w).map(e => e.alarmId), [y.id], 'x closed, y kept');
  assert.deepEqual(tab.json('dgAlarmStore.events().map(e => e.alarmId)'), [y.id]);
  assert.deepEqual(banners(tab), [y.id]);
  noErrors(w);
});

test('race: record() in flight and a concurrent edit (update) both reach the stored list', async () => {
  const x = alarm({ price: 17, productId: 123, repeat: 'each' }), y = alarm({ price: 1300, productId: 456, repeat: 'once' });
  const { w, tab } = await setup([x, y]);
  w.latency.set = 50;
  const edit = tab.run(`dgAlarmStore.update(${JSON.stringify(x.id)}, { price: 18, dir: 'above', repeat: 'daily' })`);
  tab.setPrice(456, 1301); // y fires and switches itself off, while the edit is being written
  await w.advance(3000);
  assert.equal(await edit, 'ok');
  const stored = listOf(w);
  assert.equal(stored.find(a => a.id === x.id).price, 18, 'the edit survived');
  assert.equal(stored.find(a => a.id === x.id).repeat, 'daily');
  assert.equal(stored.find(a => a.id === y.id).on, false, 'y was switched off');
  assert.deepEqual(events(w).map(e => e.alarmId), [y.id]);
  noErrors(w);
});

test('race: saved data erased ("Clear saved data") while record() reads storage: nothing is written back', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'once' });
  const { w, tab } = await setup([a]);
  w.latency.get = 50; // every read now takes 50 ms
  tab.setPrice(123, 17.5); // fires: record() starts reading the stored state and alarms
  await w.advance(30);
  await w.clear('sync');
  await w.clear('local');
  const from = w.log.length;
  await w.advance(2000);
  const back = w.log.slice(from).flatMap(l => l.keys.map(k => `${l.area}: ${k}`))
    .filter(k => /dgAlarm(s|State|Events)$/.test(k));
  assert.deepEqual(back, [], 'no erased alarm, state or event written back');
  assert.deepEqual(banners(tab), []);
  noErrors(w);
});

test('update() clears the fired state and banner of the edited alarm', async () => {
  const x = alarm({ price: 17 });
  const { w, tab } = await setup([x]);
  await price(tab, 123, 17.5);
  assert.equal(banners(tab).length, 1);
  assert.equal(await tab.run(`dgAlarmStore.update(${JSON.stringify(x.id)}, { price: 20, dir: 'above', repeat: 'once' })`), 'ok');
  await w.advance(200);
  assert.deepEqual(banners(tab), []);
  assert.equal(stateOf(w, x.id).firedAt, undefined);
  assert.equal(listOf(w)[0].on, true, 'an edited alarm is switched on again');
  await price(tab, 123, 20.5);
  assert.equal(events(w).length, 1, 'and fires again');
});

test('orphan events: deleting an alarm drops its banner in every tab and its event from storage', async () => {
  const x = alarm({ price: 17 }), y = alarm({ price: 16, dir: 'above', productId: 789, name: 'Mock Chips' });
  const { w, tabs: [A, B] } = await setup([x, y], 2);
  await price(A, 123, 17.5);
  await price(A, 789, 16.5);
  assert.deepEqual(events(w).map(e => e.alarmId).sort(), [x.id, y.id].sort());
  assert.equal(await A.run(`dgAlarmStore.remove(${JSON.stringify(x.id)})`), true);
  await w.advance(200);
  assert.deepEqual(events(w).map(e => e.alarmId), [y.id]);
  assert.deepEqual([banners(A), banners(B)], [[y.id], [y.id]]);
});

test('orphan events: an event stored for an alarm that no longer exists is not shown, and goes at the next change', async () => {
  const x = alarm({ price: 17 });
  const w = createWorld({ storage: { sync: { dgAlarms: [x] }, local: { dgAlarmEvents: [{ alarmId: 'ghost', price: 5, at: 1 }, { alarmId: x.id, price: 18, at: 2 }] } } });
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites' });
  await w.advance(200);
  assert.deepEqual(banners(tab), [x.id], 'no banner for the missing alarm');
  await tab.run(`dgAlarmStore.setOn(${JSON.stringify(x.id)}, true)`).then(() => w.advance(200)); // any list change cleans up
  assert.deepEqual(events(w).map(e => e.alarmId), [x.id]);
});

test('storage refusing the write: add() reports an error and the list comes back from storage', async () => {
  const { w, tab } = await setup([alarm({ price: 17 })]);
  w.faults.set = true;
  assert.equal(await tab.run(`dgAlarmStore.add(${JSON.stringify(alarm({ price: 30 }))})`), 'error');
  w.faults.set = false;
  await w.advance(200);
  assert.equal(tab.run('dgAlarmStore.list().length'), 1);
  assert.equal(listOf(w).length, 1);
});

test('Alarms page: switching between two lists with only dashes updates No trading now / Not in current list', async () => {
  const w = createWorld();
  await w.set('sync', { dgAlarms: [alarm({ price: 17 }), alarm({ productId: 901, price: 1 })] });
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites?dg=alarms' });
  await w.advance(200);
  for (const id of [123, 456, 789, 901]) tab.setPrice(id, null); // every price is a dash: the live prices stay empty in both lists
  await w.advance(300);
  const byId = () => Object.fromEntries(tab.$$('tr[data-dg-alarm-id]').map(r => [r.querySelector('a').getAttribute('href'), r.querySelector('[data-dg-alarm-status]').textContent]));
  const status = id => byId()[`#/products/${id}/overview`];
  assert.equal(status(123), 'No trading now');
  assert.equal(status(901), 'Not in current list');
  tab.showList('energy');
  await w.advance(300);
  assert.equal(status(123), 'Not in current list');
  assert.equal(status(901), 'No trading now');
  noErrors(w);
});

test('the 25-alarm limit: add() says full', async () => {
  const { tab } = await setup(Array.from({ length: 25 }, () => alarm({ price: 500 })));
  assert.equal(await tab.run(`dgAlarmStore.add(${JSON.stringify(alarm())})`), 'full');
});

test('the 25-alarm limit: add() says full when another computer filled the stored list while it waited for the lock', async () => {
  const { w, tab } = await setup([alarm({ price: 17 })]);
  const k = keeper(w, [tab]);
  const release = await k.hold('worker');
  const fresh = alarm({ price: 30 });
  const res = tab.run(`dgAlarmStore.add(${JSON.stringify(fresh)})`); // shown at once, written once the lock is free
  const synced = Array.from({ length: 25 }, () => alarm({ price: 500 }));
  await w.set('sync', { dgAlarms: synced }); // another computer's alarms sync in meanwhile
  release();
  await w.advance(200);
  assert.equal(await res, 'full');
  assert.deepEqual(listOf(w).map(a => a.id), synced.map(a => a.id), 'nothing added to the stored list');
  assert.ok(!tab.json('dgAlarmStore.list().map(a => a.id)').includes(fresh.id), 'nor to the tab\'s');
  noErrors(w);
});

test('Alarms page: a listed product without a price says "No trading now"; one not in the list says "Not in current list"; nothing fires', async () => {
  const w = createWorld();
  await w.set('sync', { dgAlarms: [alarm({ price: 17, dir: 'above' }), alarm({ productId: 999, price: 1 })] });
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites?dg=alarms' });
  await w.advance(200);
  tab.setPrice(123, null); // market closed: the Last price cell shows a dash
  await w.advance(300);
  const statuses = tab.$$('[data-dg-alarm-status]').map(e => e.textContent);
  assert.deepEqual(statuses.sort(), ['No trading now', 'Not in current list']);
  assert.equal(events(w).length, 0);
  await price(tab, 123, 20);
  assert.equal(events(w).length, 1);
  noErrors(w);
});

// ---------- the alarm-data lock (alarm-lock.js; the keeper is the background worker, faked here) ----------

/**
 * A stand-in for background.js's lock keeper, wired into these tabs' chrome.runtime: one holder, first come first
 * served. `log` records each client's steps with the number of storage writes so far (`w.log.length`), so a test can
 * tell what was written while it held the lock. `hold()` takes it as another writer would (the worker's merge).
 * mode 'silent': never answers (a worker that hangs); 'throw': connect throws (the extension's context is gone);
 * 'reject': the port opens but the message fails (the worker restarting).
 */
function keeper(w, tabs, mode = 'ok') {
  const k = { holder: '', queue: [], log: [], ports: new Map(), seq: 0 };
  const step = (what, who) => k.log.push([what, who, w.log.length]);
  const next = () => {
    if (k.holder || !k.queue.length) return;
    const q = k.queue.shift();
    k.holder = q.token;
    step('grant', q.who);
    q.go();
  };
  const free = token => { if (k.holder !== token) return; k.holder = ''; next(); };
  const gone = token => { k.ports.delete(token); k.queue = k.queue.filter(q => q.token !== token); free(token); };
  k.hold = who => new Promise(resolve => {
    const token = `test-${++k.seq}`;
    k.queue.push({ token, who, go: () => resolve(() => { step('release', who); free(token); }) });
    next();
  });
  /** the worker went (stopped, restarted): every port disconnects, the lock is forgotten */
  k.kill = () => { const all = [...k.ports.values()]; k.ports.clear(); k.queue = []; k.holder = ''; all.forEach(p => p.gone.forEach(fn => fn())); };
  tabs.forEach((tab, i) => {
    const who = `tab${i}`, rt = tab.window.chrome.runtime;
    rt.connect = ({ name }) => {
      if (mode === 'throw') throw new Error('Extension context invalidated.');
      const token = name.replace(/^dg-lock:/, ''), p = { gone: [] };
      k.ports.set(token, p);
      step('connect', who);
      return { name, onDisconnect: { addListener: fn => p.gone.push(fn) }, disconnect: () => { step('disconnect', who); gone(token); } };
    };
    rt.sendMessage = msg => new Promise(resolve => {
      if (msg?.type !== 'dg-lock') { resolve(undefined); return; }
      step('ask', who);
      if (mode === 'silent') return;
      if (mode === 'reject') { Promise.resolve().then(() => { throw new Error('The message port closed before a response was received.'); }).catch(e => { k.rejected = (k.rejected || 0) + 1; resolve(Promise.reject(e)); }); return; }
      Promise.resolve().then(() => {
        if (!k.ports.has(msg.token)) { resolve(false); return; }
        k.queue.push({ token: msg.token, who, go: () => resolve(true) });
        next();
      });
    });
  });
  k.steps = who => k.log.filter(l => l[1] === who).map(l => l[0]);
  return k;
}
const close = tab => tab.$('[data-dg-alarm-close]').click();

test('lock: a check\'s write waits while another writer holds the lock, then takes it, writes and lets go', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'once' });
  const { w, tab } = await setup([a]);
  const k = keeper(w, [tab]);
  const release = await k.hold('worker');
  await price(tab, 123, 17.5, 1000);
  assert.deepEqual(events(w), [], 'not written while the lock is held');
  assert.equal(listOf(w)[0].on, true);
  assert.deepEqual(k.steps('tab0'), ['connect', 'ask']);
  release();
  await w.advance(200);
  assert.deepEqual(events(w).map(e => e.alarmId), [a.id]);
  assert.deepEqual(banners(tab), [a.id]);
  assert.equal(listOf(w)[0].on, false, 'the switch-off is written in the same turn');
  const tabSteps = k.log.filter(l => l[1] === 'tab0').slice(0, 4); // then the orphan clean-up's own turn
  assert.deepEqual(tabSteps.map(l => l[0]), ['connect', 'ask', 'grant', 'disconnect']);
  const [, , atGrant] = tabSteps[2], [, , atRelease] = tabSteps[3];
  const during = w.log.slice(atGrant, atRelease).map(l => l.keys.join());
  assert.ok(during.includes('dgAlarmState,dgAlarmEvents') && during.includes('dgAlarms'), JSON.stringify(during));
  assert.equal(k.holder, '', 'released');
  noErrors(w);
});

test('lock: closing a banner, deleting, switching and editing alarms each take the lock around their write', async () => {
  const a = alarm({ price: 17, repeat: 'each' }), b = alarm({ price: 30 });
  const { w, tab } = await setup([a, b]);
  await price(tab, 123, 17.5);
  const k = keeper(w, [tab]);
  const writes = async (what, fn) => {
    const release = await k.hold('worker');
    const before = w.log.length;
    await fn();
    await w.advance(500);
    assert.equal(w.log.length, before, `${what}: nothing written while the lock is held`);
    release();
    await w.advance(200);
    assert.ok(w.log.length > before, `${what}: written once it is free`);
    assert.equal(k.holder, '', `${what}: released`);
  };
  await writes('close', () => close(tab));
  assert.deepEqual(events(w), []);
  await writes('setOn', () => { tab.run(`dgAlarmStore.setOn(${JSON.stringify(b.id)}, false)`); });
  assert.equal(listOf(w)[1].on, false);
  await writes('update', () => { tab.run(`dgAlarmStore.update(${JSON.stringify(b.id)}, { price: 31, dir: 'above', repeat: 'once' })`); });
  assert.equal(listOf(w)[1].price, 31);
  await writes('remove', () => { tab.run(`dgAlarmStore.remove(${JSON.stringify(b.id)})`); });
  assert.deepEqual(listOf(w).map(x => x.id), [a.id]);
  await writes('add', () => { tab.run(`dgAlarmStore.add(${JSON.stringify(alarm({ price: 40 }))})`); });
  assert.equal(listOf(w).length, 2);
  noErrors(w);
});

test('lock: no answer within 2 s (the worker hangs): the write goes ahead without it, and the tab leaves the queue', async () => {
  const a = alarm({ price: 17, repeat: 'once' });
  const { w, tab } = await setup([a]);
  const k = keeper(w, [tab], 'silent');
  await price(tab, 123, 17.5, 1900);
  assert.deepEqual(events(w), []);
  await w.advance(200);
  assert.deepEqual(events(w).map(e => e.alarmId), [a.id]);
  assert.equal(listOf(w)[0].on, false);
  const [, , dropped] = k.log[2];
  assert.deepEqual(k.log.slice(0, 3).map(l => l[0]), ['connect', 'ask', 'disconnect']);
  assert.ok(w.log.slice(dropped).some(l => l.keys.includes('dgAlarmEvents')), 'gave up its place, then wrote');
  noErrors(w);
});

test('lock: the worker unreachable (connect throws, the message fails) or gone while waiting: the write goes ahead at once', async () => {
  for (const how of ['throw', 'reject', 'kill']) {
    const a = alarm({ price: 17, repeat: 'once' });
    const { w, tab } = await setup([a]);
    const k = keeper(w, [tab], how === 'kill' ? 'ok' : how);
    const release = how === 'kill' ? await k.hold('worker') : null;
    await price(tab, 123, 17.5, 100);
    if (how === 'kill') { assert.deepEqual(events(w), [], how); k.kill(); await w.advance(50); }
    assert.deepEqual(events(w).map(e => e.alarmId), [a.id], how);
    if (how === 'reject') {
      assert.ok(k.rejected >= 1); // the write's, then the orphan clean-up's own
      const [, , dropped] = k.log[2];
      assert.deepEqual(k.log.slice(0, 3).map(l => l[0]), ['connect', 'ask', 'disconnect'], 'gave its port back');
      assert.ok(w.log.slice(dropped).some(l => l.keys.includes('dgAlarmEvents')), 'then wrote');
    }
    release?.();
    noErrors(w);
  }
});

// The lost update the lock prevents: another writer (the worker's merge) reads the events, a tab fires and writes
// meanwhile, and that writer's write, made from what it read before, drops the tab's event.
async function raceWithWorker(withLock) {
  const a = alarm({ price: 17, repeat: 'once' }), b = alarm({ price: 900, productId: 999 });
  const { w, tab } = await setup([a, b]);
  const k = withLock ? keeper(w, [tab]) : null;
  const release = k ? await k.hold('worker') : () => {};
  const read = w.stored('local').dgAlarmEvents || []; // the worker's fresh read before its merge
  await price(tab, 123, 17.5, 50); // the tab fires in between
  const at = w.now - 600000;
  await w.set('local', { dgAlarmEvents: [...read, { alarmId: b.id, price: 901, at }], dgAlarmState: { ...w.stored('local').dgAlarmState, [b.id]: { firedAt: at } } });
  release();
  await w.advance(200);
  noErrors(w);
  return { a, b, w, tab };
}
test('lock: a tab\'s firing and the worker\'s merge a few ms apart: without the lock one is lost, with it both stay', async () => {
  {
    const { a, w } = await raceWithWorker(false);
    assert.ok(!events(w).some(e => e.alarmId === a.id), 'without the lock: the worker\'s write drops the tab\'s event');
  }
  const { a, b, w, tab } = await raceWithWorker(true);
  assert.deepEqual(events(w).map(e => e.alarmId).sort(), [a.id, b.id].sort(), 'the tab waited, then merged into the worker\'s write');
  assert.ok(stateOf(w, a.id).firedAt && stateOf(w, b.id).firedAt);
  assert.deepEqual(banners(tab).sort(), [a.id, b.id].sort());
});

test('lock: another writer\'s switch-off stored while a tab\'s switch waits for the lock stays (the tab writes on the stored list)', async () => {
  const a = alarm({ price: 17 }), b = alarm({ price: 900, productId: 999 });
  const { w, tab } = await setup([a, b]);
  const k = keeper(w, [tab]);
  const release = await k.hold('worker');
  tab.run(`dgAlarmStore.setOn(${JSON.stringify(a.id)}, false)`);
  await w.set('sync', { dgAlarms: [a, { ...b, on: false }] }); // the worker's 'once' switch-off of b
  release();
  await w.advance(200);
  assert.deepEqual(listOf(w).map(x => x.on), [false, false]);
  noErrors(w);
});

// The user switches an alarm off (or deletes it) while the tab's write waits for the lock; another writer's list
// write lands meanwhile (another computer's new alarm), with the alarm still on. The tab keeps showing its change over
// that list, so a price past the alarm seen meanwhile doesn't fire it; then the tab writes its change on that list.
for (const how of ['setOn', 'remove']) {
  test(`lock: an alarm the user ${how === 'setOn' ? 'switched off' : 'deleted'} while the write waits for the lock doesn't come back, nor fire, when another writer's list lands meanwhile`, async () => {
    const a = alarm({ price: 17, dir: 'above', repeat: 'each' }), c = alarm({ price: 900, productId: 999 });
    const { w, tab } = await setup([a]);
    const s = sound(tab, true);
    const k = keeper(w, [tab]);
    const release = await k.hold('worker');
    const res = tab.run(how === 'setOn' ? `dgAlarmStore.setOn(${JSON.stringify(a.id)}, false)` : `dgAlarmStore.remove(${JSON.stringify(a.id)})`);
    await w.advance(50);
    await w.set('sync', { dgAlarms: [a, c] }); // another computer's alarm syncs in; a is still on there
    await w.advance(50);
    const shown = () => tab.json('dgAlarmStore.list().map(x => [x.id, x.on])');
    const mine = how === 'setOn' ? [[a.id, false], [c.id, true]] : [[c.id, true]];
    assert.deepEqual(shown(), mine, 'the tab still shows the user\'s change, with the other writer\'s alarm');
    await price(tab, 123, 17.5, 300); // past the alarm while the write waits (well within the lock's 2 s)
    release();
    await w.advance(300);
    assert.equal(await res, true);
    assert.ok(!events(w).some(e => e.alarmId === a.id), 'not fired');
    assert.ok(!stateOf(w, a.id).firedAt, 'no firedAt stored');
    assert.equal(s.played, 0, 'no chime');
    assert.deepEqual(banners(tab), []);
    assert.deepEqual(listOf(w).map(x => [x.id, x.on]), mine, 'stored: the user\'s change on the other writer\'s list');
    assert.deepEqual(shown(), mine);
    noErrors(w);
  });
}

test('lock: queued list edits stay in order over a list from storage; one refused by it (add on a list filled elsewhere) leaves it as it is', async () => {
  const a = alarm({ price: 17 }), b = alarm({ price: 30 });
  const { w, tab } = await setup([a, b]);
  const k = keeper(w, [tab]);
  const release = await k.hold('worker');
  const fresh = alarm({ price: 40 }), more = alarm({ price: 41 });
  tab.run(`dgAlarmStore.remove(${JSON.stringify(b.id)})`);
  tab.run(`dgAlarmStore.setOn(${JSON.stringify(a.id)}, false)`);
  const added = tab.run(`dgAlarmStore.add(${JSON.stringify(fresh)})`);
  const addedMore = tab.run(`dgAlarmStore.add(${JSON.stringify(more)})`);
  await w.advance(50);
  const synced = Array.from({ length: 23 }, () => alarm({ price: 500 }));
  await w.set('sync', { dgAlarms: [a, b, ...synced] }); // another computer fills the list: 25
  await w.advance(50);
  const want = [[a.id, false], ...synced.map(x => [x.id, true]), [fresh.id, true]];
  assert.deepEqual(tab.json('dgAlarmStore.list().map(x => [x.id, x.on])'), want,
    'b removed (making room for the first add), a off, the second add refused by the full list: left as it is');
  release();
  await w.advance(500);
  assert.equal(await added, 'ok');
  assert.equal(await addedMore, 'full');
  assert.deepEqual(listOf(w).map(x => [x.id, x.on]), want);
  assert.deepEqual(tab.json('dgAlarmStore.list().map(x => [x.id, x.on])'), want);
  noErrors(w);
});

// A check that only refreshes an alarm's `last` price waits for the lock while the worker stores a firing of that
// alarm: the tab's write keeps the worker's firedAt (it lays only its price over the stored entry), so the tab
// doesn't fire the alarm a second time later that day.
test('lock: a price-only write waiting for the lock keeps the firing the worker stored meanwhile', async () => {
  const a = alarm({ price: 17, dir: 'above', repeat: 'daily' });
  const { w, tab } = await setup([a]);
  const s = sound(tab, true);
  const k = keeper(w, [tab]);
  await price(tab, 123, 16.5); // below: its `last` is stored
  await w.skip(61e3); // the next price is written again (once a minute)
  const release = await k.hold('worker');
  await price(tab, 123, 16.6, 50); // a price-only update: record() waits for the lock
  assert.deepEqual(k.steps('tab0').slice(-2), ['connect', 'ask'], 'the tab waits for the lock');
  const at = await workerFired(w, a); // the worker's merge stores its firing, then lets go
  await w.advance(50);
  release();
  await w.advance(200);
  assert.equal(stateOf(w, a.id).firedAt, at, 'the worker\'s firing stays stored');
  assert.equal(stateOf(w, a.id).last, 16.6, 'with the tab\'s price');
  assert.equal(tab.json(`dgAlarmStore.state()[${JSON.stringify(a.id)}].firedAt`), at, 'and in the tab');
  await w.skip(5 * 60e3); // later the same day the tab sees the price past the alarm
  await price(tab, 123, 17.5);
  assert.deepEqual(events(w), [{ alarmId: a.id, price: 17.4, at }], 'the worker\'s event, no second one');
  assert.equal(stateOf(w, a.id).firedAt, at);
  assert.equal(s.played, 0, 'no chime');
  noErrors(w);
});

test('lock: two tabs take turns, in the order they asked', async () => {
  const a = alarm({ price: 17, repeat: 'each' });
  const { w, tabs: [A, B] } = await setup([a], 2);
  await price(A, 123, 17.5);
  const k = keeper(w, [A, B]);
  const release = await k.hold('worker');
  close(A);
  await w.advance(10);
  close(B);
  await w.advance(10);
  release();
  await w.advance(500);
  const grants = k.log.filter(l => l[0] === 'grant').map(l => l[1]);
  assert.deepEqual(grants, ['worker', 'tab0', 'tab1']);
  assert.deepEqual(events(w), []);
  noErrors(w);
});
