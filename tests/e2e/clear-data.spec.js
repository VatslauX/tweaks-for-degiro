// Settings popup: "Clear saved data" erases everything the extension keeps between sessions, after a second click
// within 5 s. Synced data goes on every computer of the Chrome profile, which the armed button says.
const { test, expect, stubPermissions, unstubPermissions } = require('./fixtures');

const IDLE = 'Clear saved data';
const ARMED = 'Click again to erase it all (settings and alarms on all your computers)';
const DEFAULT_TITLES = ['Cash compensation', 'Cash compensatie', 'Barausgleich', 'Compensation espèces'].join('\n');

test.afterEach(({ context }) => unstubPermissions(context));

const area = (opt, a) => opt.evaluate(n => chrome.storage[n].get(null), a);

test('the first click arms the button and it disarms after 5 s', async ({ settings }) => {
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ spread: false }));
  await opt.clock.install();
  await opt.reload();
  const btn = opt.locator('#clearData');
  await expect(btn).toHaveText(IDLE);
  await btn.click();
  await expect(btn).toHaveText(ARMED);
  await expect(btn).toHaveAttribute('data-armed', '');
  await opt.clock.fastForward(5000);
  await expect(btn).toHaveText(IDLE);
  await expect(btn).not.toHaveAttribute('data-armed');
  expect(await area(opt, 'sync')).toEqual({ spread: false });
});

test('the second click erases sync, local and session storage and the switches show the defaults', async ({ settings }) => {
  const opt = await settings();
  await opt.evaluate(() => Promise.all([
    chrome.storage.sync.set({ spread: false, hiddenTitles: ['X'], dgOrdersSort: { col: 'date', dir: 'asc' },
      dgAlarms: [{ id: 'a1', productId: 1, name: 'A', symbol: 'A', currency: '€', price: 1, dir: 'above', repeat: 'once', on: true, created: 1 }] }),
    chrome.storage.local.set({ dgAlarmState: { a1: {} } }),
    chrome.storage.session.set({ dgBgSkip: 3 })
  ]));
  await expect(opt.locator('input[data-key=spread]')).not.toBeChecked();
  await opt.locator('#clearData').click();
  await opt.locator('#clearData').click();
  await expect(opt.locator('#status')).toHaveText('Saved data erased');
  expect(await area(opt, 'sync')).toEqual({});
  const local = await area(opt, 'local');
  expect(Object.keys(local)).toEqual(['dgWiped']);
  expect(typeof local.dgWiped).toBe('number');
  expect(await area(opt, 'session')).toEqual({});
  expect(await opt.evaluate(() => localStorage.length)).toBe(0);
  await expect(opt.locator('input[data-key=spread]')).toBeChecked();
  await expect(opt.locator('#hiddenTitles')).toHaveValue(DEFAULT_TITLES);
  for (const el of await opt.locator('.sec-toggle').all()) await expect(el).toHaveAttribute('aria-expanded', 'false');
  await expect(opt.locator('#clearData')).toHaveText(IDLE);
});

test('erasing gives the background permissions back', async ({ context, settings }) => {
  const opt = await settings();
  await stubPermissions(context, opt, true);
  await opt.locator('label.row:has(input[data-key=alarmsBackground])').click();
  await expect(opt.locator('input[data-key=alarmsBackground]')).toBeChecked();
  await opt.locator('#clearData').click();
  await opt.locator('#clearData').click();
  await expect.poll(() => opt.evaluate(() => window.__perm.removed.length)).toBe(1);
  await expect(opt.locator('input[data-key=alarmsBackground]')).not.toBeChecked();
});

// Chrome's prompt for the background permissions still open: a wipe now would be undone when the user grants
// (the switch's save, the worker's permissions.onAdded write alarmsBackground again), so it waits.
const pendingPrompt = opt => opt.evaluate(() => {
  window.__clears = 0;
  const clear = chrome.storage.sync.clear.bind(chrome.storage.sync);
  chrome.storage.sync.clear = () => { window.__clears++; return clear(); };
  chrome.permissions.contains = async () => false;
  chrome.permissions.request = () => new Promise(() => {});
});
test('armed before Chrome\'s permission prompt opened: the click that would erase disarms instead', async ({ settings }) => {
  const opt = await settings();
  await pendingPrompt(opt);
  await opt.locator('#clearData').click();
  await expect(opt.locator('#clearData')).toHaveText(ARMED);
  await opt.locator('label.row:has(input[data-key=alarmsBackground])').click();
  await expect(opt.locator('input[data-key=alarmsBackground]')).toHaveAttribute('aria-disabled', 'true');
  await opt.locator('#clearData').click();
  // read at once: the 5 s disarm timer must not be what passes it
  expect(await opt.evaluate(() => [window.__clears, document.querySelector('#clearData').hasAttribute('data-armed'),
    document.querySelector('#clearData').textContent])).toEqual([0, false, IDLE]);
});

test('no erasing while the background switch waits for Chrome\'s permission prompt', async ({ settings }) => {
  const opt = await settings();
  await opt.evaluate(() => {
    window.__clears = 0;
    const clear = chrome.storage.sync.clear.bind(chrome.storage.sync);
    chrome.storage.sync.clear = () => { window.__clears++; return clear(); };
    window.__granted = false;
    chrome.permissions.contains = async () => window.__granted;
    chrome.permissions.request = () => new Promise(res => { window.__grant = () => { window.__granted = true; res(true); }; });
    return chrome.storage.sync.set({ spread: false });
  });
  await opt.locator('label.row:has(input[data-key=alarmsBackground])').click();
  await expect(opt.locator('input[data-key=alarmsBackground]')).toHaveAttribute('aria-disabled', 'true');
  await opt.locator('#clearData').click();
  await opt.locator('#clearData').click();
  expect(await opt.evaluate(() => window.__clears)).toBe(0);
  await expect(opt.locator('#clearData')).toHaveText(IDLE);
  await expect(opt.locator('#clearData')).not.toHaveAttribute('data-armed');
  await opt.evaluate(() => window.__grant());
  await expect(opt.locator('input[data-key=alarmsBackground]')).toBeChecked();
  await expect(opt.locator('input[data-key=alarmsBackground]')).not.toHaveAttribute('aria-disabled');
  expect(await area(opt, 'sync')).toEqual({ spread: false, alarmsBackground: true });
});

test('a failed sync clear erases nothing else', async ({ settings }) => {
  const opt = await settings();
  await opt.evaluate(() => {
    const clear = chrome.storage.sync.clear;
    chrome.storage.sync.clear = () => { chrome.storage.sync.clear = clear; return Promise.reject(new Error('boom')); };
    return chrome.storage.local.set({ dgAlarmState: { a1: {} } });
  });
  await opt.locator('#clearData').click();
  await opt.locator('#clearData').click();
  await expect(opt.locator('#status')).toHaveClass(/error/);
  expect(await area(opt, 'local')).toEqual({ dgAlarmState: { a1: {} } });
  await expect(opt.locator('#clearData')).toHaveText(IDLE);
});

test('switches are locked while it erases', async ({ settings }) => {
  const opt = await settings();
  await opt.evaluate(() => {
    const clear = chrome.storage.sync.clear.bind(chrome.storage.sync);
    chrome.storage.sync.clear = () => new Promise(res => { window.__release = () => res(clear()); });
  });
  await opt.locator('#clearData').click();
  await opt.locator('#clearData').click();
  await expect(opt.locator('input[data-key=spread]')).toHaveAttribute('aria-disabled', 'true');
  await opt.evaluate(() => window.__release());
  await expect(opt.locator('#status')).toHaveText('Saved data erased');
  await expect(opt.locator('input[data-key=spread]')).not.toHaveAttribute('aria-disabled');
});

test('focused hidden titles show the defaults after erasing', async ({ settings }) => {
  const opt = await settings();
  await opt.locator('#hiddenTitles').fill('Mine');
  await expect.poll(() => opt.evaluate(() => chrome.storage.sync.get('hiddenTitles').then(r => r.hiddenTitles))).toEqual(['Mine']);
  await opt.locator('#hiddenTitles').focus();
  // clicks that leave the focus where it is
  await opt.locator('#clearData').dispatchEvent('click');
  await opt.locator('#clearData').dispatchEvent('click');
  await expect(opt.locator('#status')).toHaveText('Saved data erased');
  await expect(opt.locator('#hiddenTitles')).toHaveValue(DEFAULT_TITLES);
});

// The portfolio chart's cash-columns switch lives in DEGIRO's own localStorage: the popup leaves a dgWiped marker
// and the DEGIRO tabs drop the switch (flags.js).
const URL_P = 'https://trader.degiro.nl/trader/?mock=portfolio#/portfolio';
const cashLines = page => page.evaluate(() => localStorage.getItem('dgTweaksCashLines'));

test('an open DEGIRO tab drops the cash-columns switch when saved data is erased', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P, cashLines: true });
  expect(await cashLines(page)).toBe('1');
  const opt = await settings();
  await opt.locator('#clearData').click();
  await opt.locator('#clearData').click();
  await expect(opt.locator('#status')).toHaveText('Saved data erased');
  await expect.poll(() => cashLines(page)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('dgTweaksWiped'))).toMatch(/^\d+$/);
});

test('a DEGIRO tab opened after erasing drops it on load, once', async ({ degiro, settings }) => {
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.local.set({ dgWiped: Date.now() }));
  const { page } = await degiro({ url: URL_P, cashLines: true });
  await expect.poll(() => cashLines(page)).toBeNull();
  // switched on again after that: the same marker leaves it alone
  await page.reload(); // the fixture's init script sets the switch again
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-dg-tweaks'));
  expect(await cashLines(page)).toBe('1');
});

test('the options page leaves its own localStorage alone', async ({ settings }) => {
  const opt = await settings();
  await opt.evaluate(() => { localStorage.setItem('dgTweaksCashLines', '1'); return chrome.storage.local.set({ dgWiped: Date.now() }); });
  await opt.reload();
  expect(await opt.evaluate(() => localStorage.getItem('dgTweaksCashLines'))).toBe('1');
});
