// The alarm-data lock in real Chrome: a DEGIRO tab and the settings page (alarm-lock.js) wait for their turn from the
// real background worker (background.js), which keeps the lock. The rules (priorities, lease, fallbacks) are tested
// in tests/unit/background.test.js and tests/integration/alarms.test.js; here, that the real pieces talk.
const { test, expect, backgroundWorker } = require('./fixtures');

const PRODUCT = 'https://trader.degiro.nl/trader/#/products/123/overview';
const ALARM = { id: 'lk-1', productId: 123, name: 'Mock ETF', symbol: 'MOCK', currency: '€', price: 17, dir: 'above', repeat: 'each', on: true, created: 1 };

/**
 * Watch the worker's lock ports (when each connects and goes, a DEGIRO tab's or an extension page's) and when the
 * stored events and alarms change, by the worker's clock. Its listeners stay for the worker's life: installed once.
 */
async function watch(context) {
  const sw = await backgroundWorker(context);
  await sw.evaluate(() => {
    const fresh = { ports: [], events: [], alarms: [] };
    if (globalThis.__lockWatch) { globalThis.__lockWatch = fresh; return; }
    globalThis.__lockWatch = fresh;
    chrome.runtime.onConnect.addListener(p => {
      if (!p.name.startsWith('dg-lock:')) return;
      const e = { tab: !!p.sender?.tab && /^https:\/\/trader\.degiro\.nl\//.test(p.sender.url || ''), at: Date.now(), gone: 0 };
      globalThis.__lockWatch.ports.push(e);
      p.onDisconnect.addListener(() => { e.gone = Date.now(); });
    });
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === 'local' && c.dgAlarmEvents) globalThis.__lockWatch.events.push(Date.now());
      if (area === 'sync' && c.dgAlarms) globalThis.__lockWatch.alarms.push(Date.now());
    });
  });
  return { seen: () => sw.evaluate(() => globalThis.__lockWatch) };
}
/** take the lock from the settings page, as alarm-lock.js does: true once it is this page's turn */
const hold = opt => opt.evaluate(() => {
  const token = crypto.randomUUID();
  window.__lockPort = chrome.runtime.connect({ name: `dg-lock:${token}` });
  return chrome.runtime.sendMessage({ type: 'dg-lock', token });
});
const release = opt => opt.evaluate(() => window.__lockPort.disconnect());
const local = opt => opt.evaluate(() => chrome.storage.local.get(['dgAlarmState', 'dgAlarmEvents']));

// The waits below are on conditions; the one thing timed is that the client's own fallback (2 s without an answer)
// isn't reached: the lock is released as soon as the waiting client's port is seen, polled every 25 ms (Playwright's
// default steps reach 1 s, which could pass the 2 s on a busy runner).
const FAST = { intervals: [25] };
test('a DEGIRO tab closing a banner waits while the settings page holds the lock, then writes in its own turn', async ({ context, degiro, settings }) => {
  const opt = await settings();
  await opt.evaluate(a => Promise.all([
    chrome.storage.sync.set({ dgAlarms: [a] }),
    chrome.storage.local.set({ dgAlarmEvents: [{ alarmId: a.id, price: 17.5, at: Date.now() - 60000 }], dgAlarmState: { [a.id]: { firedAt: Date.now() - 60000 } } })
  ]), ALARM);
  const w = await watch(context);
  const { page } = await degiro({ url: PRODUCT });
  await expect(page.locator('[data-dg-alarm-banner]')).toHaveCount(1);
  // the tab's first look at the price (its `last`) is stored, and its turn is over
  await expect.poll(async () => (await local(opt)).dgAlarmState?.[ALARM.id]?.last).toBe(16.92);
  await expect.poll(async () => (await w.seen()).ports.filter(p => p.tab && !p.gone).length).toBe(0);
  const before = (await w.seen()).ports.length;

  expect(await hold(opt)).toBe(true);
  await page.locator('[data-dg-alarm-close]').click();
  await expect(page.locator('[data-dg-alarm-banner]')).toHaveCount(0); // gone in the tab at once
  await expect.poll(async () => (await w.seen()).ports.slice(before).filter(p => p.tab && !p.gone).length, FAST).toBe(1); // it waits
  expect((await local(opt)).dgAlarmEvents).toHaveLength(1); // not written meanwhile
  await release(opt);
  await expect.poll(async () => (await local(opt)).dgAlarmEvents).toEqual([]);
  await expect.poll(async () => (await w.seen()).ports.slice(before).every(p => p.gone)).toBe(true);

  const seen = await w.seen();
  const [mine, tab] = seen.ports.slice(before);
  expect(tab.tab).toBe(true);
  expect(mine.tab).toBe(false);
  const write = seen.events.at(-1);
  expect(write).toBeGreaterThanOrEqual(mine.gone); // written after the settings page let go
  expect(tab.gone).toBeGreaterThanOrEqual(write); // and the tab let go after its write
});

test('"Clear saved data" waits for a held lock, then erases', async ({ context, settings }) => {
  const opt = await settings();
  await opt.evaluate(a => chrome.storage.sync.set({ dgAlarms: [a], spread: false }), ALARM);
  const w = await watch(context);
  const holder = await settings(); // another settings page holds the lock (a DEGIRO tab's or the worker's write)
  expect(await hold(holder)).toBe(true);
  await opt.locator('#clearData').click();
  await opt.locator('#clearData').click();
  await expect.poll(async () => (await w.seen()).ports.filter(p => !p.gone).length, FAST).toBe(2); // the Clear waits its turn
  expect(await opt.evaluate(() => chrome.storage.sync.get('dgAlarms'))).toEqual({ dgAlarms: [ALARM] });
  await release(holder);
  await expect(opt.locator('#status')).toHaveText('Saved data erased');
  expect(await opt.evaluate(() => chrome.storage.sync.get(null))).toEqual({});
  const seen = await w.seen();
  expect(seen.alarms.at(-1)).toBeGreaterThanOrEqual(seen.ports[0].gone);
  await expect.poll(async () => (await w.seen()).ports.every(p => p.gone)).toBe(true); // and lets go
});
