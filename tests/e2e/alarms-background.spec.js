// Settings: the opt-in "Check in the background" switch (background.js). Chrome's own permission prompt can't be
// clicked by a test, so chrome.permissions is stubbed on the settings page; the worker side is in
// tests/unit/background.test.js.
const { test, expect, stubPermissions, unstubPermissions } = require('./fixtures');

const SWITCH = 'input[data-key=alarmsBackground]';
const ROW = `label.row:has(${SWITCH})`;

// the browser is reused by the next tests: give the worker its real permission check back
test.afterEach(({ context }) => unstubPermissions(context));

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
  expect(await opt.evaluate(() => window.__perm.requested)).toEqual([{ permissions: ['notifications', 'offscreen'], origins: ['https://query1.finance.yahoo.com/*', 'https://sgbeurs.nl/*'] }]);
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
  expect(n.silent).toBe(false);
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

test('the switch is locked while Chrome is asked whether the permissions are granted here', async ({ context, settings }) => {
  const opt = await settings();
  await stubPermissions(context, opt, true);
  await opt.evaluate(() => {
    window.__waits = [];
    chrome.permissions.contains = () => new Promise(r => window.__waits.push(r));
  });
  // any settings change asks again
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await expect.poll(() => opt.evaluate(() => window.__waits.length)).toBeGreaterThan(0);
  await expect(opt.locator(SWITCH)).toHaveAttribute('aria-disabled', 'true');
  await expect(opt.locator('#allSwitch')).toHaveAttribute('aria-disabled', 'true');
  // neither its row (force: past Playwright's enabled check) nor Space toggles it, and Chrome isn't asked
  await opt.locator(ROW).click({ force: true });
  await opt.locator(SWITCH).focus();
  await opt.keyboard.press('Space');
  await expect(opt.locator(SWITCH)).not.toBeChecked();
  expect(await opt.evaluate(() => window.__perm.requested.length)).toBe(0);
  await opt.evaluate(() => {
    chrome.permissions.contains = async () => window.__granted;
    window.__waits.splice(0).forEach(r => r(false));
  });
  await expect(opt.locator(SWITCH)).not.toHaveAttribute('aria-disabled');
  await expect(opt.locator('#allSwitch')).not.toHaveAttribute('aria-disabled');
  await expect(opt.locator(SWITCH)).toBeFocused();
  await opt.locator(ROW).click();
  await expect(opt.locator(SWITCH)).toBeChecked();
  await expect.poll(() => opt.evaluate(() => chrome.storage.sync.get('alarmsBackground').then(r => r.alarmsBackground))).toBe(true);
});

test('after a click the switch stays locked until Chrome, the save and the check have answered', async ({ context, settings }) => {
  const opt = await settings();
  await stubPermissions(context, opt, true);
  await opt.evaluate(() => {
    // Chrome's prompt, held open until the test answers it
    const request = chrome.permissions.request;
    window.__asks = [];
    chrome.permissions.request = p => new Promise(r => window.__asks.push(() => r(request(p))));
  });
  await opt.locator(ROW).click();
  await expect(opt.locator(SWITCH)).toBeChecked();
  await expect(opt.locator(SWITCH)).toHaveAttribute('aria-disabled', 'true');
  await expect(opt.locator('#allSwitch')).toHaveAttribute('aria-disabled', 'true');
  await opt.locator(ROW).click({ force: true });
  await expect(opt.locator(SWITCH)).toBeChecked();
  expect(await opt.evaluate(() => window.__asks.length)).toBe(1);
  await opt.evaluate(() => window.__asks.shift()());
  await expect(opt.locator(SWITCH)).not.toHaveAttribute('aria-disabled');
  await expect(opt.locator('#allSwitch')).not.toHaveAttribute('aria-disabled');
  await expect(opt.locator(SWITCH)).toBeChecked();
  await expect(opt.locator('#bgStatus')).toBeVisible();
  // switching off with a failed save unlocks it too: the switch back on, and the red error
  await opt.evaluate(() => { chrome.storage.sync.set = () => Promise.reject(new Error('QUOTA_BYTES quota exceeded')); });
  await opt.locator(ROW).click();
  await expect(opt.locator('#status')).toHaveClass(/error/);
  await expect(opt.locator(SWITCH)).toBeChecked();
  await expect(opt.locator(SWITCH)).not.toHaveAttribute('aria-disabled');
});

test('switched on, the switch never shows off again while the setting is re-read', async ({ context, settings }) => {
  const opt = await settings();
  await stubPermissions(context, opt, true);
  // every value the page writes to the switch (the user's own click doesn't go through the setter)
  await opt.evaluate(() => {
    const d = /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked'));
    window.__shown = [];
    Object.defineProperty(document.querySelector('input[data-key=alarmsBackground]'), 'checked', {
      configurable: true,
      get() { return d.get.call(this); },
      set(v) { window.__shown.push(!!v); d.set.call(this, v); }
    });
  });
  await opt.locator(ROW).click();
  await expect.poll(() => opt.evaluate(() => chrome.storage.sync.get('alarmsBackground').then(r => r.alarmsBackground))).toBe(true);
  // the check after the save, and the one after flags.js has re-read the setting
  await expect.poll(() => opt.evaluate(() => window.__shown.length)).toBeGreaterThanOrEqual(2);
  await expect(opt.locator(SWITCH)).not.toHaveAttribute('aria-disabled');
  expect(await opt.evaluate(() => window.__shown)).not.toContain(false);
  await expect(opt.locator(SWITCH)).toBeChecked();
});

test('a new background status updates the line without locking any switch', async ({ context, settings }) => {
  const opt = await settings();
  await stubPermissions(context, opt, true);
  await opt.evaluate(() => { window.__granted = true; return chrome.storage.sync.set({ alarmsBackground: true }); });
  await expect(opt.locator('#bgStatus')).toHaveText('Waiting for the first check.');
  await expect(opt.locator('#allSwitch')).not.toHaveAttribute('aria-disabled');
  // Chrome's permission answer held: a check of the switch would stay pending (and locked) from here on
  await opt.evaluate(() => {
    window.__waits = [];
    chrome.permissions.contains = () => new Promise(r => window.__waits.push(r));
  });
  // the worker writes its status once a minute: only the line under the switch changes
  await opt.evaluate(() => chrome.storage.local.set({ dgBgStatus: { at: Date.now(), linked: 2, total: 3, err: '' } }));
  await expect(opt.locator('#bgStatus')).toHaveText(/^Last check .+ · 2 of 3 alarms linked$/);
  expect(await opt.evaluate(() => window.__waits.length)).toBe(0);
  await expect(opt.locator('#allSwitch')).not.toHaveAttribute('aria-disabled');
  await expect(opt.locator(SWITCH)).not.toHaveAttribute('aria-disabled');
  await expect(opt.locator(SWITCH)).toBeChecked();
});

test('switched on before the sound came (no offscreen permission): "Allow sound with DEGIRO closed" asks for it alone', async ({ context, settings }) => {
  const opt = await settings();
  await stubPermissions(context, opt, true);
  await opt.evaluate(() => {
    window.__granted = true;
    window.__sound = false;
    // the check's own permissions granted, the chime's not
    chrome.permissions.contains = async p => (p.origins ? window.__granted : window.__sound);
    chrome.permissions.request = async p => { window.__perm.requested.push(p); window.__sound = true; return true; };
    return chrome.storage.sync.set({ alarmsBackground: true });
  });
  const allow = opt.locator('#soundAllow');
  await expect(allow).toBeVisible();
  await expect(allow).toHaveText('Allow sound with DEGIRO closed');
  await expect(opt.locator(SWITCH)).toBeChecked();
  // the sound switched off: nothing to allow
  await opt.locator('[data-key="alarmSound"]').click();
  await expect(opt.locator('[data-key="alarmSound"]')).not.toBeChecked();
  await expect(allow).toBeHidden();
  await opt.locator('[data-key="alarmSound"]').click();
  await expect(opt.locator('[data-key="alarmSound"]')).toBeChecked();
  await expect(allow).toBeVisible();
  await allow.click();
  await expect(allow).toBeHidden();
  expect(await opt.evaluate(() => window.__perm.requested)).toEqual([{ permissions: ['offscreen'] }]);
  await expect(opt.locator('[data-key="alarmSound"]')).toBeChecked(); // the link inside the row's label doesn't toggle it
});

// Web Audio stand-in: counts the chimes (one AudioContext each); headless Chromium plays nothing anyway
const COUNT_CHIMES = () => {
  window.__chimes = 0;
  const node = () => ({ connect: n => n, start() {}, stop() {}, frequency: {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } });
  window.AudioContext = class { constructor() { window.__chimes++; this.currentTime = 0; this.destination = {}; } createOscillator() { return node(); } createGain() { return node(); } close() { return Promise.resolve(); } };
};

test('offscreen.html chimes when it opens, and again when the worker asks it (dg-chime-play), nothing else', async ({ context, extId, settings }) => {
  const page = await context.newPage();
  await page.addInitScript(COUNT_CHIMES);
  await page.goto(`chrome-extension://${extId}/offscreen.html`);
  await expect.poll(() => page.evaluate(() => window.__chimes)).toBe(1);
  const opt = await settings();
  // a runtime message reaches every page of the extension, this one included
  expect(await opt.evaluate(() => chrome.runtime.sendMessage({ type: 'dg-chime-play' }))).toBe(true);
  expect(await page.evaluate(() => window.__chimes)).toBe(2);
  // the worker's own message (it has no sound permission here: it answers false); this page ignores it
  expect(await opt.evaluate(() => chrome.runtime.sendMessage({ type: 'dg-chime' }))).toBe(false);
  expect(await page.evaluate(() => window.__chimes)).toBe(2);
  await page.close();
});

test('the test notification chimes too: the worker plays it, or the settings do when it can\'t', async ({ context, settings }) => {
  const opt = await settings();
  await stubPermissions(context, opt, true);
  await opt.evaluate(COUNT_CHIMES);
  await opt.evaluate(() => {
    window.__asked = [];
    window.__workerPlays = true;
    /** @type {any} */ (chrome).notifications = { getPermissionLevel: cb => { cb?.('granted'); }, create: (id, o, cb) => { cb?.(id); } };
    chrome.runtime.sendMessage = async m => { window.__asked.push(m); return window.__workerPlays; };
  });
  await opt.locator(ROW).click();
  await expect(opt.locator('#bgTest')).toBeVisible();
  await opt.locator('#bgTest').click();
  await expect.poll(() => opt.evaluate(() => window.__asked)).toEqual([{ type: 'dg-chime' }]);
  expect(await opt.evaluate(() => window.__chimes)).toBe(0); // the worker played it
  await opt.evaluate(() => { window.__workerPlays = false; });
  await opt.locator('#bgTest').click();
  await expect.poll(() => opt.evaluate(() => window.__chimes)).toBe(1);
  // the sound switched off: no chime at all
  await opt.locator('[data-key="alarmSound"]').click();
  await expect(opt.locator('[data-key="alarmSound"]')).not.toBeChecked();
  await opt.locator('#bgTest').click();
  await expect(opt.locator('#bgTestNote')).toBeVisible();
  expect(await opt.evaluate(() => [window.__asked.length, window.__chimes])).toEqual([2, 1]);
});

test('a permission request that throws leaves the switch off, unlocked, with the error shown', async ({ context, settings }) => {
  const opt = await settings();
  await stubPermissions(context, opt, false);
  await opt.evaluate(() => { chrome.permissions.request = () => { throw new Error('Permission request failed'); }; });
  await opt.locator(ROW).click();
  await expect(opt.locator('#status')).toHaveClass(/error/);
  await expect(opt.locator(SWITCH)).not.toBeChecked();
  await expect(opt.locator(SWITCH)).not.toHaveAttribute('aria-disabled');
  await expect(opt.locator('#allSwitch')).not.toHaveAttribute('aria-disabled');
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
