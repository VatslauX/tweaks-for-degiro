// Price alarms (alarm-rules.js, alarms.js) in real tab scripts: firing rules, two tabs sharing one
// storage, and write races. Prices come from the Favourites mock (Mock ETF 123 = 16.92).
// Stays in Playwright: the Alarm button and panel, the Alarms page layout, banner placement/looks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorld, alarm } = require('./harness');

const events = w => w.stored('local').dgAlarmEvents || [];
const stateOf = (w, id) => (w.stored('local').dgAlarmState || {})[id] || {};
const listOf = w => w.stored('sync').dgAlarms || [];
const banners = tab => tab.$$('[data-dg-alarm-banner]').map(b => b.getAttribute('data-dg-alarm-banner'));
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
const noErrors = w => assert.deepEqual(w.errors.map(e => e.stack || String(e)), []);

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

test('the 25-alarm limit: add() says full', async () => {
  const { tab } = await setup(Array.from({ length: 25 }, () => alarm({ price: 500 })));
  assert.equal(await tab.run(`dgAlarmStore.add(${JSON.stringify(alarm())})`), 'full');
});
