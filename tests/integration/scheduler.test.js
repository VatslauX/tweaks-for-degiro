// The scheduler in common.js (feature(), own(), throttle, stop, every): probes are registered in a real
// tab, next to the real features, and counted. Stays in Playwright: real frame timing, Highcharts hover.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('./harness');

async function open() {
  const w = createWorld();
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites' });
  await w.advance(500); // past every throttle window
  return { w, tab };
}
// a feature that counts its runs and stops; `extra` is more feature options, `body` runs inside run()
function probe(tab, name, { extra = '', body = '' } = {}) {
  tab.run(`window.${name} = { runs: 0, stops: 0, on: true };
    __dgt.feature({ name: ${JSON.stringify(name)}, enabled: () => window.${name}.on,
      run() { window.${name}.runs++; ${body} return 'ok'; }, stop() { window.${name}.stops++; } ${extra} });`);
}
const get = (tab, name) => tab.json(`window.${name}`);
const bump = tab => tab.document.body.append(tab.document.createElement('i')); // a DOM change that isn't ours

test('several DOM changes in one turn run a feature once; a change per frame runs it every frame', async () => {
  const { w, tab } = await open();
  probe(tab, 'frame', { extra: ', throttle: 0' });
  probe(tab, 'slow');
  await w.advance(500);
  const f0 = get(tab, 'frame').runs, s0 = get(tab, 'slow').runs;
  for (let i = 0; i < 10; i++) bump(tab);
  await w.flush();
  assert.equal(get(tab, 'frame').runs - f0, 1, 'ten changes, one run');
  assert.equal(get(tab, 'slow').runs - s0, 1);
  for (let i = 0; i < 5; i++) { bump(tab); await w.flush(); }
  assert.equal(get(tab, 'frame').runs - f0, 6, 'throttle 0: one run per frame');
});

test('default throttle (150 ms): a change soon after a run waits for the trailing run, exactly one', async () => {
  const { w, tab } = await open();
  probe(tab, 'p');
  await w.advance(500);
  const r0 = get(tab, 'p').runs;
  bump(tab);
  await w.advance(20);
  assert.equal(get(tab, 'p').runs, r0 + 1, 'runs at the next frame');
  for (let i = 0; i < 4; i++) { bump(tab); await w.advance(10); }
  assert.equal(get(tab, 'p').runs, r0 + 1, 'throttled');
  await w.advance(200);
  assert.equal(get(tab, 'p').runs, r0 + 2, 'one trailing run for all of them');
  await w.advance(2000);
  assert.equal(get(tab, 'p').runs, r0 + 2, 'and nothing after');
});

test('a feature\'s own throttle is respected, but a settings change bypasses it', async () => {
  const { w, tab } = await open();
  probe(tab, 'p', { extra: ', throttle: 1000' });
  await w.advance(1500);
  const r0 = get(tab, 'p').runs;
  bump(tab);
  await w.advance(20);
  assert.equal(get(tab, 'p').runs, r0 + 1);
  bump(tab);
  await w.advance(500);
  assert.equal(get(tab, 'p').runs, r0 + 1, 'still waiting for its 1000 ms');
  await tab.setFlag('spread', false); // any settings change
  await w.advance(20);
  assert.equal(get(tab, 'p').runs, r0 + 2, 'settings change runs it at once');
  await w.advance(1200);
  assert.equal(get(tab, 'p').runs, r0 + 3, 'and the trailing run still comes');
});

test('stop() runs once when a feature is switched off, never while it stays off, again after another off', async () => {
  const { w, tab } = await open();
  probe(tab, 'p');
  await w.advance(500);
  assert.equal(get(tab, 'p').stops, 0);
  tab.run('window.p.on = false');
  bump(tab);
  await w.advance(300);
  assert.deepEqual([get(tab, 'p').stops], [1]);
  const runs = get(tab, 'p').runs;
  for (let i = 0; i < 5; i++) { bump(tab); await w.advance(300); }
  assert.equal(get(tab, 'p').stops, 1, 'not called again');
  assert.equal(get(tab, 'p').runs, runs, 'no runs while off');
  assert.equal(tab.json('__dgt.status().p'), 'off');
  tab.run('window.p.on = true');
  bump(tab);
  await w.advance(300);
  assert.equal(get(tab, 'p').runs, runs + 1);
  tab.run('window.p.on = false');
  bump(tab);
  await w.advance(300);
  assert.equal(get(tab, 'p').stops, 2);
});

test('every: a feature with it also runs on the timer without any DOM change; one without it does not', async () => {
  const { w, tab } = await open();
  probe(tab, 'timed', { extra: ', every: 1000' });
  probe(tab, 'plain');
  await w.advance(500);
  const t0 = get(tab, 'timed').runs, p0 = get(tab, 'plain').runs;
  await w.advance(5000);
  const dt = get(tab, 'timed').runs - t0;
  assert.ok(dt >= 4 && dt <= 6, `about one run a second, got ${dt}`);
  assert.equal(get(tab, 'plain').runs, p0);
});

test('our own DOM changes (own()) do not run features again: no render loop', async () => {
  const { w, tab } = await open();
  probe(tab, 'own', { body: 'document.body.append(__dgt.own(document.createElement("div")));' });
  await w.advance(3000); // ~190 frames
  assert.ok(get(tab, 'own').runs <= 2, `own() changes retriggered the feature: ${get(tab, 'own').runs} runs`);
  assert.ok(tab.$$('body > div[data-dg-own]').length <= 2);
  // our own elements nested deeper count too: a change inside an owned element
  tab.run('window.__box = __dgt.own(document.body.appendChild(document.createElement("div")))');
  await w.advance(300);
  const r = get(tab, 'own').runs;
  for (let i = 0; i < 5; i++) { tab.run('window.__box.append("x")'); await w.advance(200); }
  assert.equal(get(tab, 'own').runs, r, 'changes inside an owned element are ignored');
});

test('control: a feature that changes foreign DOM on every run does retrigger itself (the test above can fail)', async () => {
  const { w, tab } = await open();
  probe(tab, 'loop', { body: 'document.body.append(document.createElement("div"));' });
  await w.advance(3000);
  assert.ok(get(tab, 'loop').runs >= 10, `expected a run every ~150 ms, got ${get(tab, 'loop').runs}`);
});

test('changes inside Highcharts\' container do not run isolated-world features', async () => {
  const { w, tab } = await open();
  tab.run('window.__hc = document.body.appendChild(document.createElement("div")); window.__hc.className = "highcharts-container"');
  probe(tab, 'p');
  await w.advance(500);
  const r = get(tab, 'p').runs;
  for (let i = 0; i < 10; i++) { tab.run('window.__hc.append(document.createElement("span"))'); await w.advance(200); }
  assert.equal(get(tab, 'p').runs, r);
});

test('a throwing feature does not stop the others, and reports "error"', async () => {
  const { w, tab } = await open();
  probe(tab, 'bad', { body: 'throw new Error("boom");' });
  probe(tab, 'good');
  await w.advance(500);
  bump(tab);
  await w.advance(300);
  assert.equal(tab.json('__dgt.status().bad'), 'error');
  assert.equal(tab.json('__dgt.status().good'), 'ok');
  assert.ok(get(tab, 'good').runs >= 2);
  assert.deepEqual(w.errors, [], 'the error is contained, nothing escapes');
});
