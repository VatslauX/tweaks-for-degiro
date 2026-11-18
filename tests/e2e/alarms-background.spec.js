// Settings: the opt-in "Check in the background" switch (background.js). Chrome's own permission prompt can't be
// clicked by a test, so chrome.permissions is stubbed on the settings page; the worker side is in
// tests/unit/background.test.js.
const { test, expect } = require('./fixtures');

const SWITCH = 'input[data-key=alarmsBackground]';
const ROW = `label.row:has(${SWITCH})`;

/** the extension's background worker */
async function backgroundWorker(context) {
  const mine = w => w.url().endsWith('/background.js');
  return context.serviceWorkers().find(mine) || context.waitForEvent('serviceworker', { predicate: mine });
}

/**
 * Stub Chrome's permission prompt on the settings page, and (`grant`) the worker's view of the permissions too:
 * without them the worker switches the setting back off. No alarm is stored, so the worker never polls Yahoo.
 * @param {import('@playwright/test').BrowserContext} context @param {import('@playwright/test').Page} opt @param {boolean} grant
 */
async function stubPermissions(context, opt, grant) {
  await opt.evaluate(g => {
    window.__perm = { requested: [], removed: [] };
    window.__granted = false;
    chrome.permissions.contains = async () => window.__granted;
    chrome.permissions.request = async p => { window.__perm.requested.push(p); window.__granted = g; return g; };
    chrome.permissions.remove = async p => { window.__perm.removed.push(p); return true; };
  }, grant);
  if (grant) {
    const sw = await backgroundWorker(context);
    await sw.evaluate(() => { globalThis.__contains = chrome.permissions.contains; chrome.permissions.contains = async () => true; });
  }
}
// the browser is reused by the next tests: give the worker its real permission check back
test.afterEach(async ({ context }) => {
  const sw = context.serviceWorkers().find(w => w.url().endsWith('/background.js'));
  await sw?.evaluate(() => { if (globalThis.__contains) chrome.permissions.contains = globalThis.__contains; }).catch(() => {});
});

test('the switch sits under Price alarms, off by default, with no status line', async ({ settings }) => {
  const opt = await settings();
  await expect(opt.locator(ROW)).toHaveClass(/sub/);
  await expect(opt.locator(ROW)).toHaveAttribute('data-depends', 'priceAlarms');
  await expect(opt.locator(SWITCH)).not.toBeChecked();
  await expect(opt.locator('#bgStatus')).toBeHidden();
  await expect(opt.locator(ROW)).toContainText('Only ticker symbols');
});

test('switching on asks Chrome for the Yahoo host and notifications, then saves', async ({ context, settings }) => {
  const opt = await settings();
  await stubPermissions(context, opt, true);
  await opt.locator(ROW).click();
  await expect(opt.locator(SWITCH)).toBeChecked();
  await expect.poll(() => opt.evaluate(() => chrome.storage.sync.get('alarmsBackground').then(r => r.alarmsBackground))).toBe(true);
  expect(await opt.evaluate(() => window.__perm.requested)).toEqual([{ permissions: ['notifications'], origins: ['https://query1.finance.yahoo.com/*', 'https://sgbeurs.nl/*'] }]);
  await expect(opt.locator('#bgStatus')).toBeVisible();
  await expect(opt.locator('#bgStatus')).toHaveText('Waiting for the first check.');
});

test('"Send a test notification" shows one for the first switched-on alarm, without toggling the switch', async ({ context, settings }) => {
  const opt = await settings();
  await expect(opt.locator('#bgTest')).toBeHidden();
  await stubPermissions(context, opt, true);
  await opt.evaluate(() => {
    window.__notes = [];
    // the real API needs the granted permission, which the stub only pretends: record instead, as Chrome 111 (the
    // minimum) to 115 do: callbacks only, no Promise returned
    /** @type {any} */ (chrome).notifications = {
      getPermissionLevel: cb => { cb?.(window.__level || 'granted'); },
      create: (id, o, cb) => { window.__notes.push({ id, ...o }); cb?.(id); }
    };
    return Promise.all([
      chrome.storage.sync.set({ dgAlarms: [{ id: 'a1', productId: 331868, name: 'ASML Holding', symbol: 'ASML', currency: '€', price: 1200, dir: 'below', repeat: 'once', on: true, created: 1 }] }),
      chrome.storage.local.set({ dgAlarmState: { a1: { last: 1188.4, lastAt: 1 } } })
    ]);
  });
  await opt.locator(ROW).click();
  await expect(opt.locator('#bgTest')).toBeVisible();
  await expect(opt.locator('#bgTest')).toHaveText('Send a test notification');
  await opt.locator('#bgTest').click();
  await expect.poll(() => opt.evaluate(() => window.__notes.length)).toBe(1);
  const n = await opt.evaluate(() => window.__notes[0]);
  expect(n.id).toMatch(/^dg\|331868\|test\|\d+$/); // the worker's click handler opens product 331868
  expect(n.title).toBe('ASML Holding fell to € 1,188.40');
  expect(n.message).toMatch(/^alarm ↓ € 1,200\.00 · Test notification, .+$/);
  expect(n.requireInteraction).toBe(true);
  await expect(opt.locator('#bgTestNote')).toHaveText(/^Sent at .+\. Not on screen\? Allow Google Chrome in System Settings/);
  await expect(opt.locator(SWITCH)).toBeChecked();
  // Chrome blocking this extension's notifications says so, and shows none
  await opt.evaluate(() => { window.__level = 'denied'; });
  await opt.locator('#bgTest').click();
  await expect(opt.locator('#bgTestNote')).toHaveText('Chrome blocks notifications from this extension.');
  await expect(opt.locator('#bgTestNote')).toHaveClass(/error/);
  expect(await opt.evaluate(() => window.__notes.length)).toBe(1);
  // Chrome failing to show it reports in runtime.lastError, during the callback: said in red
  await opt.evaluate(() => {
    window.__level = 'granted';
    /** @type {any} */ (chrome).notifications.create = (id, o, cb) => {
      const own = Object.getOwnPropertyDescriptor(chrome.runtime, 'lastError');
      Object.defineProperty(chrome.runtime, 'lastError', { configurable: true, get: () => ({ message: 'Unable to download all specified images.' }) });
      try { cb?.(); } finally { if (own) Object.defineProperty(chrome.runtime, 'lastError', own); else delete chrome.runtime.lastError; }
    };
  });
  await opt.locator('#bgTest').click();
  await expect(opt.locator('#bgTestNote')).toHaveText('Couldn\'t show a notification: Unable to download all specified images.');
  await expect(opt.locator('#bgTestNote')).toHaveClass(/error/);
  await opt.evaluate(() => Promise.all([chrome.storage.sync.remove('dgAlarms'), chrome.storage.local.remove('dgAlarmState')]));
});

test('"Send a test notification" answers the Space key too, and names the product as the worker does', async ({ context, settings }) => {
  const opt = await settings();
  await stubPermissions(context, opt, true);
  await opt.evaluate(() => {
    window.__notes = [];
    /** @type {any} */ (chrome).notifications = {
      getPermissionLevel: cb => { cb?.('granted'); },
      create: (id, o, cb) => { window.__notes.push({ id, ...o }); cb?.(id); }
    };
    // a blank name: the worker's R.label (on the cleaned alarm) shows the symbol
    return chrome.storage.sync.set({ dgAlarms: [{ id: 'a1', productId: 331868, name: '  ', symbol: 'ASML', currency: '€', price: 1200, dir: 'above', repeat: 'once', on: true, created: 1 }] });
  });
  await opt.locator(ROW).click();
  await expect(opt.locator('#bgTest')).toBeVisible();
  await opt.locator('#bgTest').focus();
  await opt.keyboard.press('Space');
  await expect.poll(() => opt.evaluate(() => window.__notes.length)).toBe(1);
  expect((await opt.evaluate(() => window.__notes[0])).title).toBe('ASML rose to € 1,200.00');
  await opt.evaluate(() => chrome.storage.sync.remove('dgAlarms'));
});

test('a declined prompt leaves the switch off and saves nothing', async ({ context, settings }) => {
  const opt = await settings();
  await stubPermissions(context, opt, false);
  await opt.locator(ROW).click();
  await expect(opt.locator(SWITCH)).not.toBeChecked();
  expect((await opt.evaluate(() => chrome.storage.sync.get('alarmsBackground'))).alarmsBackground).toBeUndefined();
});

test('switching off saves first, then gives the permissions back', async ({ context, settings }) => {
  const opt = await settings();
  await stubPermissions(context, opt, true);
  await opt.evaluate(() => { window.__granted = true; return chrome.storage.sync.set({ alarmsBackground: true }); });
  await expect(opt.locator(SWITCH)).toBeChecked();
  await opt.locator(ROW).click();
  await expect(opt.locator(SWITCH)).not.toBeChecked();
  await expect.poll(() => opt.evaluate(() => window.__perm.removed.length)).toBe(1);
  expect((await opt.evaluate(() => chrome.storage.sync.get('alarmsBackground'))).alarmsBackground).toBe(false);
  await expect(opt.locator('#bgStatus')).toBeHidden();
});

test('switched on on another computer but without the permissions here: shown off, and the setting is left on', async ({ settings }) => {
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ alarmsBackground: true }));
  await expect(opt.locator(SWITCH)).not.toBeChecked();
  await expect(opt.locator('#bgStatus')).toBeHidden();
  // the worker never switches it off: that would switch it off on the other computer too
  await expect.poll(() => opt.evaluate(() => chrome.storage.sync.get('alarmsBackground').then(r => r.alarmsBackground))).toBe(true);
});

test('the status line shows the last background check, or that Yahoo was not reachable', async ({ context, settings }) => {
  const opt = await settings();
  await stubPermissions(context, opt, true);
  await opt.evaluate(() => { window.__granted = true; return chrome.storage.local.set({ dgBgStatus: { at: Date.now(), linked: 2, total: 3, err: '' } }); });
  await opt.evaluate(() => chrome.storage.sync.set({ alarmsBackground: true }));
  await expect(opt.locator('#bgStatus')).toHaveText(/^Last check .+ · 2 of 3 alarms linked$/);
  await opt.evaluate(() => chrome.storage.local.set({ dgBgStatus: { at: Date.now(), linked: 2, total: 3, err: 'HTTP 429' } }));
  await expect(opt.locator('#bgStatus')).toHaveText(/^Yahoo Finance not reachable \(last try .+\)$/);
});

// The real browser stack: the alarms content script (isolated world) sees the session in DEGIRO's own request
// addresses and asks DEGIRO's product info service for an alarm product that is in no list on screen.
test('an alarm product on no page is linked from DEGIRO\'s product details', async ({ settings, degiro }) => {
  const opt = await settings();
  const far = { id: 'al-far', productId: 555, name: 'Adobe Inc', symbol: 'ADB', currency: '€', price: 5000, dir: 'above', repeat: 'once', on: true, created: 1 };
  await opt.evaluate(a => chrome.storage.sync.set({ dgAlarms: [a], alarmsBackground: true }), far);
  const asked = [];
  // the product page mock requests /product-notes-service/…?intAccount=42&sessionId=TESTSID, like DEGIRO
  await degiro({ respond: u => {
    if (u.pathname !== '/product_search/secure/v5/products/info') return undefined;
    asked.push(u.search);
    return { contentType: 'application/json', body: JSON.stringify({ data: { 555: { id: '555', name: 'Adobe Inc', isin: 'US00724F1012', symbol: 'ADB', productType: 'STOCK', productTypeId: 1, currency: 'EUR', exchangeId: '196' } } }) };
  } });
  await expect.poll(() => asked.length, { message: 'DEGIRO\'s product details asked for' }).toBe(1);
  await expect.poll(() => opt.evaluate(() => chrome.storage.sync.get('dgTickers').then(r => r.dgTickers || null)))
    .toEqual({ 555: { t: 'ADB.DE', cur: '€', isin: 'US00724F1012' } });
  expect(asked).toEqual(['?intAccount=42&sessionId=TESTSID']);
});
