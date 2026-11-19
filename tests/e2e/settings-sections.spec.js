// Settings popup: collapsible sections (remembered per computer in the popup's localStorage), a set-all switch per
// settings section and an "All settings" switch at the top.
const { test, expect, setFlag, stubPermissions, unstubPermissions } = require('./fixtures');

const toggle = (opt, id) => opt.locator(`section[data-section=${id}] .sec-toggle`);
const secSwitch = (opt, id) => opt.locator(`section[data-section=${id}] .sec-switch`);
const count = (opt, id) => opt.locator(`section[data-section=${id}] .sec-count`);
const PRICING = ['spread', 'headerSpread', 'exDividend', 'earningsDate', 'compactPricing'];
const BG_ROW = 'label.row:has(input[data-key=alarmsBackground])';

/** record every chrome.storage.sync.set patch the page makes */
const recordSets = opt => opt.evaluate(() => {
  window.__sets = [];
  const set = chrome.storage.sync.set.bind(chrome.storage.sync);
  chrome.storage.sync.set = p => { window.__sets.push(p); return set(p); };
});
const stored = (opt, keys) => opt.evaluate(k => chrome.storage.sync.get(k), keys);
/** hold every chrome.storage.sync.set until the test answers it with releaseSet (oldest first) */
const holdSets = opt => opt.evaluate(() => {
  const set = chrome.storage.sync.set.bind(chrome.storage.sync);
  window.__realSet = set; // a write from another tab or computer, not held
  window.__held = [];
  chrome.storage.sync.set = p => new Promise((resolve, reject) => {
    window.__held.push(ok => (ok ? set(p).then(resolve, reject) : reject(new Error('QUOTA_BYTES quota exceeded'))));
  });
});
const releaseSet = (opt, ok = true) => opt.evaluate(o => window.__held.shift()(o), ok);
const heldCount = opt => opt.evaluate(() => window.__held.length);
/** Chrome's answer whether the background permissions are granted here, held until the test gives it */
const holdContains = opt => opt.evaluate(() => {
  window.__waits = [];
  chrome.permissions.contains = () => new Promise(r => window.__waits.push(r));
});
const answerContains = (opt, granted) => opt.evaluate(g => {
  chrome.permissions.contains = async () => g;
  window.__waits.splice(0).forEach(r => r(g));
}, granted);
/** record every value the page writes to these switches' `checked` (a user's click doesn't go through the setter) */
const recordChecked = (opt, keys) => opt.evaluate(ks => {
  const d = /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked'));
  window.__shown = {};
  for (const k of ks) {
    window.__shown[k] = [];
    Object.defineProperty(document.querySelector(`input[data-key=${k}]`), 'checked', {
      configurable: true,
      get() { return d.get.call(this); },
      set(v) { window.__shown[k].push(!!v); d.set.call(this, v); }
    });
  }
}, keys);
const shown = (opt, key) => opt.evaluate(k => window.__shown[k], key);
const BULK = ['#allSwitch', ...['pricing', 'chart', 'portfolio', 'orders', 'cleanup'].map(id => `section[data-section=${id}] .sec-switch`)];
const ROW = key => `label.row:has(input[data-key=${key}])`;
const isMixed = loc => loc.evaluate(el => /** @type {HTMLInputElement} */ (el).indeterminate);
/** every setting key with a switch on the page */
const allKeys = opt => opt.locator('input.switch[data-key]').evaluateAll(els => els.map(el => el.dataset.key));

test.afterEach(({ context }) => unstubPermissions(context));

test('every section starts collapsed', async ({ settings }) => {
  const opt = await settings({ collapsed: true });
  const toggles = opt.locator('.sec-toggle');
  await expect(toggles).toHaveCount(6);
  for (const el of await toggles.all()) await expect(el).toHaveAttribute('aria-expanded', 'false');
  for (const el of await opt.locator('section:not(#pageStatus) .sec-body').all()) await expect(el).toBeHidden();
  await expect(opt.locator('input[data-key=spread]')).toBeHidden();
});

test('a header opens its section and the popup remembers it', async ({ settings }) => {
  const opt = await settings({ collapsed: true });
  await toggle(opt, 'pricing').click();
  await expect(toggle(opt, 'pricing')).toHaveAttribute('aria-expanded', 'true');
  await expect(opt.locator('input[data-key=spread]')).toBeVisible();
  await opt.reload();
  await expect(toggle(opt, 'pricing')).toHaveAttribute('aria-expanded', 'true');
  await expect(opt.locator('input[data-key=spread]')).toBeVisible();
  await expect(toggle(opt, 'chart')).toHaveAttribute('aria-expanded', 'false');
  await expect(opt.locator('input[data-key=periodChange]')).toBeHidden();
});

test('Enter and Space toggle a section', async ({ settings }) => {
  const opt = await settings({ collapsed: true });
  await toggle(opt, 'chart').focus();
  await opt.keyboard.press('Enter');
  await expect(toggle(opt, 'chart')).toHaveAttribute('aria-expanded', 'true');
  await expect(opt.locator('input[data-key=periodChange]')).toBeVisible();
  await opt.keyboard.press('Space');
  await expect(toggle(opt, 'chart')).toHaveAttribute('aria-expanded', 'false');
  await expect(opt.locator('input[data-key=periodChange]')).toBeHidden();
});

test('garbage in dgOptOpen leaves everything collapsed', async ({ settings }) => {
  const opt = await settings({ collapsed: true });
  const errors = [];
  opt.on('pageerror', e => errors.push(e.message));
  for (const junk of ['{', '["nope", 5]', '5']) {
    await opt.evaluate(v => localStorage.setItem('dgOptOpen', v), junk);
    await opt.reload();
    await expect(toggle(opt, 'pricing')).toHaveAttribute('aria-expanded', 'false');
    for (const el of await opt.locator('.sec-toggle').all()) await expect(el).toHaveAttribute('aria-expanded', 'false');
    await expect(opt.locator('input[data-key=spread]')).toBeHidden();
  }
  expect(errors).toEqual([]);
});

test('the section switch has an accessible name', async ({ settings }) => {
  const opt = await settings({ collapsed: true });
  await expect(opt.locator('section[data-section=pricing] .sec-switch')).toHaveAttribute('aria-label', 'All in Pricing');
  await expect(opt.locator('#pageStatus .sec-switch')).toHaveCount(0);
  await expect(opt.getByRole('checkbox', { name: 'All settings', exact: true })).toHaveCount(1);
});

test('a section switch turns its whole section on and off in one write', async ({ settings }) => {
  const opt = await settings();
  await expect(secSwitch(opt, 'pricing')).toBeChecked();
  await expect(count(opt, 'pricing')).toHaveText('5 of 5 on');
  await recordSets(opt);
  await secSwitch(opt, 'pricing').click();
  for (const k of PRICING) await expect(opt.locator(`input[data-key=${k}]`)).not.toBeChecked();
  await expect(count(opt, 'pricing')).toHaveText('0 of 5 on');
  await expect.poll(() => stored(opt, PRICING)).toEqual(Object.fromEntries(PRICING.map(k => [k, false])));
  expect(await opt.evaluate(() => window.__sets.length)).toBe(1);
  // the Chart section is untouched
  await expect(opt.locator('input[data-key=periodChange]')).toBeChecked();
  await expect(secSwitch(opt, 'chart')).toBeChecked();
  await secSwitch(opt, 'pricing').click();
  await expect(count(opt, 'pricing')).toHaveText('5 of 5 on');
  await expect.poll(() => stored(opt, PRICING)).toEqual(Object.fromEntries(PRICING.map(k => [k, true])));
});

test('mixed shows as indeterminate and a click turns all on', async ({ settings }) => {
  const opt = await settings();
  await setFlag(opt, 'headerSpread', false);
  await expect.poll(() => isMixed(secSwitch(opt, 'pricing'))).toBe(true);
  await expect(count(opt, 'pricing')).toHaveText('4 of 5 on');
  // the keyboard: Space on a mixed switch turns everything on, as a click does
  await secSwitch(opt, 'pricing').focus();
  await opt.keyboard.press('Space');
  for (const k of PRICING) await expect(opt.locator(`input[data-key=${k}]`)).toBeChecked();
  expect(await isMixed(secSwitch(opt, 'pricing'))).toBe(false);
  await expect(secSwitch(opt, 'pricing')).toBeChecked();
});

test('All settings off turns every switch off and removes the background permissions', async ({ context, settings }) => {
  const opt = await settings();
  await stubPermissions(context, opt, true);
  await opt.locator(BG_ROW).click();
  await expect(opt.locator('input[data-key=alarmsBackground]')).toBeChecked();
  // the defaults leave the Portfolio switches off: mixed, so the first click turns everything on
  await opt.locator('#allSwitch').click();
  await expect(opt.locator('#allSwitch')).toBeChecked();
  expect(await isMixed(opt.locator('#allSwitch'))).toBe(false);
  // the permissions given back are held: the background switch and the bulk switches stay locked until then
  await opt.evaluate(() => {
    window.__removes = [];
    chrome.permissions.remove = p => new Promise(r => window.__removes.push(() => { window.__perm.removed.push(p); window.__granted = false; r(true); }));
  });
  await opt.locator('#allSwitch').click();
  for (const el of await opt.locator('input.switch[data-key]').all()) await expect(el).not.toBeChecked();
  await expect.poll(() => stored(opt, 'alarmsBackground')).toEqual({ alarmsBackground: false });
  await expect.poll(() => opt.evaluate(() => window.__removes.length)).toBe(1);
  await expect(opt.locator('input[data-key=alarmsBackground]')).toHaveAttribute('aria-disabled', 'true');
  await expect(opt.locator('#allSwitch')).toHaveAttribute('aria-disabled', 'true');
  await opt.evaluate(() => window.__removes.shift()());
  await expect.poll(() => opt.evaluate(() => window.__perm.removed.length)).toBe(1);
  await expect(opt.locator('input[data-key=alarmsBackground]')).not.toHaveAttribute('aria-disabled');
  await expect(opt.locator('#allSwitch')).not.toHaveAttribute('aria-disabled');
  await expect(opt.locator('#allSwitch')).not.toBeChecked();
});

test('All settings on leaves the background check off', async ({ settings }) => {
  const opt = await settings();
  const keys = await allKeys(opt);
  await opt.evaluate(k => chrome.storage.sync.set(Object.fromEntries(k.map(x => [x, false]))), keys);
  await expect(opt.locator('#allSwitch')).not.toBeChecked();
  await expect.poll(() => isMixed(opt.locator('#allSwitch'))).toBe(false);
  await opt.locator('#allSwitch').click();
  const want = Object.fromEntries(keys.map(k => [k, k !== 'alarmsBackground']));
  await expect.poll(() => stored(opt, keys)).toEqual(want);
  await expect(opt.locator('input[data-key=alarmsBackground]')).not.toBeChecked();
  await expect.poll(() => isMixed(secSwitch(opt, 'orders'))).toBe(true);
  await expect.poll(() => isMixed(opt.locator('#allSwitch'))).toBe(true);
});

test('a mixed switch with all it can turn on already on turns everything off', async ({ settings }) => {
  // the background check is never turned on in bulk: after "all on" Orders and All settings stay mixed, and the
  // next click must still be able to switch everything off
  const opt = await settings();
  const keys = await allKeys(opt);
  await opt.locator('#allSwitch').click(); // defaults are mixed with Portfolio off: on
  await expect.poll(() => isMixed(opt.locator('#allSwitch'))).toBe(true);
  await opt.locator('#allSwitch').click();
  // the background check was off: nothing to write for it
  const rest = keys.filter(k => k !== 'alarmsBackground');
  await expect.poll(() => stored(opt, rest)).toEqual(Object.fromEntries(rest.map(k => [k, false])));
  await expect(opt.locator('#allSwitch')).not.toBeChecked();
  expect(await isMixed(opt.locator('#allSwitch'))).toBe(false);
  // the same for the Orders section alone
  await secSwitch(opt, 'orders').click();
  await expect.poll(() => isMixed(secSwitch(opt, 'orders'))).toBe(true);
  await secSwitch(opt, 'orders').click();
  await expect(count(opt, 'orders')).toHaveText('0 of 9 on');
});

test('all off without permissions here does not write alarmsBackground', async ({ settings }) => {
  const opt = await settings();
  const keys = await allKeys(opt);
  // on in sync (another computer), no permissions here: the switch shows off
  await opt.evaluate(k => chrome.storage.sync.set(Object.fromEntries(k.map(x => [x, true]))), keys);
  await expect(opt.locator('input[data-key=spread]')).toBeChecked();
  await expect(opt.locator('input[data-key=alarmsBackground]')).not.toBeChecked();
  await expect.poll(() => isMixed(opt.locator('#allSwitch'))).toBe(true);
  await recordSets(opt);
  await opt.locator('#allSwitch').click();
  await expect(opt.locator('input[data-key=spread]')).not.toBeChecked();
  const sets = await opt.evaluate(() => window.__sets);
  expect(sets).toHaveLength(1);
  expect(Object.keys(sets[0])).not.toContain('alarmsBackground');
  expect(await stored(opt, 'alarmsBackground')).toEqual({ alarmsBackground: true });
});

test('a change from elsewhere updates the counts', async ({ settings }) => {
  const opt = await settings({ collapsed: true });
  await expect(count(opt, 'pricing')).toHaveText('5 of 5 on');
  await opt.evaluate(() => chrome.storage.sync.set({ spread: false }));
  await expect(count(opt, 'pricing')).toHaveText('4 of 5 on');
  await expect.poll(() => isMixed(secSwitch(opt, 'pricing'))).toBe(true);
});

// The background switch shows the check on only once Chrome has said the permissions are granted here; until then
// a bulk "off" must not reach it, or it would switch the check off on the computer where it runs.
test('a bulk click while Chrome is asked about the permissions never writes alarmsBackground', async ({ settings }) => {
  const opt = await settings();
  const keys = await allKeys(opt);
  await holdContains(opt);
  // on in sync (another computer); no permissions here, but Chrome hasn't answered yet
  await opt.evaluate(k => chrome.storage.sync.set(Object.fromEntries(k.map(x => [x, true]))), keys);
  await expect(opt.locator('input[data-key=portfolioMergedTable]')).toBeChecked();
  await expect.poll(() => opt.evaluate(() => window.__waits.length)).toBeGreaterThan(0);
  await recordSets(opt);
  // a click on "All settings" and on a section switch in that window (force: past Playwright's enabled check)
  await opt.locator('#allSwitch').click({ force: true });
  await secSwitch(opt, 'orders').click({ force: true });
  expect((await opt.evaluate(() => window.__sets)).flatMap(Object.keys)).not.toContain('alarmsBackground');
  await expect(opt.locator('input[data-key=alarmsBackground]')).not.toBeChecked();
  // Chrome answers: no permissions here. "All off" now leaves the synced setting alone
  await answerContains(opt, false);
  await expect(opt.locator('#allSwitch')).not.toHaveAttribute('aria-disabled');
  await expect(opt.locator('input[data-key=alarmsBackground]')).not.toBeChecked();
  await opt.locator('#allSwitch').click();
  await expect.poll(() => stored(opt, ['spread'])).toEqual({ spread: false });
  expect((await opt.evaluate(() => window.__sets)).flatMap(Object.keys)).not.toContain('alarmsBackground');
  expect(await stored(opt, 'alarmsBackground')).toEqual({ alarmsBackground: true });
});

test('a switch is locked until its save is answered, saved or failed', async ({ settings }) => {
  const opt = await settings();
  await holdSets(opt);
  const sw = opt.locator('input[data-key=spread]');
  await opt.locator(ROW('spread')).click();
  await expect(sw).not.toBeChecked();
  await expect(sw).toHaveAttribute('aria-disabled', 'true');
  // the bulk switches are read from it: locked too
  for (const s of BULK) await expect(opt.locator(s)).toHaveAttribute('aria-disabled', 'true');
  // neither a click on the switch nor on its row toggles it, and nothing more is written
  await sw.click({ force: true });
  await opt.locator(ROW('spread')).click({ force: true });
  await expect(sw).not.toBeChecked();
  expect(await heldCount(opt)).toBe(1);
  await releaseSet(opt);
  await expect(sw).not.toHaveAttribute('aria-disabled');
  for (const s of BULK) await expect(opt.locator(s)).not.toHaveAttribute('aria-disabled');
  expect(await stored(opt, 'spread')).toEqual({ spread: false });
  // a failed save unlocks it too: the switch back as stored, and the red error
  await opt.locator(ROW('spread')).click();
  await expect(sw).toBeChecked();
  await expect(sw).toHaveAttribute('aria-disabled', 'true');
  await releaseSet(opt, false);
  await expect(opt.locator('#status')).toHaveClass(/error/);
  await expect(sw).not.toBeChecked();
  await expect(sw).not.toHaveAttribute('aria-disabled');
  for (const s of BULK) await expect(opt.locator(s)).not.toHaveAttribute('aria-disabled');
});

test('Space on a switch keeps the focus there, and is ignored until the save is answered', async ({ settings }) => {
  const opt = await settings();
  await holdSets(opt);
  const sw = opt.locator('input[data-key=exDividend]');
  await sw.focus();
  await opt.keyboard.press('Space');
  await expect(sw).not.toBeChecked();
  await expect(sw).toHaveAttribute('aria-disabled', 'true');
  await expect(sw).toBeFocused();
  await opt.keyboard.press('Space');
  await expect(sw).not.toBeChecked();
  expect(await heldCount(opt)).toBe(1);
  await releaseSet(opt);
  await expect(sw).not.toHaveAttribute('aria-disabled');
  await expect(sw).toBeFocused();
  await opt.keyboard.press('Space');
  await expect(sw).toBeChecked();
  await releaseSet(opt);
  await expect(sw).not.toHaveAttribute('aria-disabled');
});

test('a section switch locks its section and every bulk switch until the save is answered', async ({ settings }) => {
  const opt = await settings();
  await holdSets(opt);
  await secSwitch(opt, 'pricing').click();
  for (const k of PRICING) {
    await expect(opt.locator(`input[data-key=${k}]`)).not.toBeChecked();
    await expect(opt.locator(`input[data-key=${k}]`)).toHaveAttribute('aria-disabled', 'true');
  }
  for (const s of BULK) await expect(opt.locator(s)).toHaveAttribute('aria-disabled', 'true');
  // another section's own switches stay free
  await expect(opt.locator('input[data-key=periodChange]')).not.toHaveAttribute('aria-disabled');
  // a second click on the section switch, or on a row in it, is ignored
  await secSwitch(opt, 'pricing').click({ force: true });
  await opt.locator(ROW('exDividend')).click({ force: true });
  await expect(secSwitch(opt, 'pricing')).not.toBeChecked();
  await expect(opt.locator('input[data-key=exDividend]')).not.toBeChecked();
  expect(await heldCount(opt)).toBe(1);
  await releaseSet(opt);
  for (const k of PRICING) await expect(opt.locator(`input[data-key=${k}]`)).not.toHaveAttribute('aria-disabled');
  for (const s of BULK) await expect(opt.locator(s)).not.toHaveAttribute('aria-disabled');
  expect(await stored(opt, PRICING)).toEqual(Object.fromEntries(PRICING.map(k => [k, false])));
});

test('a switch waiting for its save keeps the new value while other settings arrive', async ({ settings }) => {
  const opt = await settings();
  await holdSets(opt);
  // periodChange: written by every re-read of the settings, so its writes say one has been applied
  await recordChecked(opt, ['exDividend', 'periodChange']);
  const ex = opt.locator('input[data-key=exDividend]');
  await opt.locator(ROW('spread')).click();
  await opt.locator(ROW('exDividend')).click();
  await expect(ex).not.toBeChecked();
  expect(await heldCount(opt)).toBe(2);
  // another tab or computer writes a setting: shown, but exDividend keeps what the user set
  await opt.evaluate(() => window.__realSet({ periodChange: false }));
  await expect(opt.locator('input[data-key=periodChange]')).not.toBeChecked();
  expect(await shown(opt, 'exDividend')).not.toContain(true);
  await expect(ex).not.toBeChecked();
  // spread's save lands while exDividend's still waits: the same
  const seen = (await shown(opt, 'periodChange')).length;
  await releaseSet(opt);
  await expect.poll(async () => (await shown(opt, 'periodChange')).length).toBeGreaterThan(seen);
  expect(await shown(opt, 'exDividend')).not.toContain(true);
  await expect(ex).not.toBeChecked();
  await expect(ex).toHaveAttribute('aria-disabled', 'true');
  await releaseSet(opt);
  await expect(ex).not.toHaveAttribute('aria-disabled');
  await expect(ex).not.toBeChecked();
  expect(await stored(opt, ['spread', 'exDividend'])).toEqual({ spread: false, exDividend: false });
});

test('a failed save shows the stored value, also one another computer wrote meanwhile', async ({ settings }) => {
  const opt = await settings();
  await holdSets(opt);
  const sw = opt.locator('input[data-key=spread]');
  await opt.locator(ROW('spread')).click();
  await expect(sw).not.toBeChecked();
  await expect(sw).toHaveAttribute('aria-disabled', 'true');
  // another computer switches it off too while this save waits; the page has read it, the locked switch kept as is
  await opt.evaluate(() => window.__realSet({ spread: false }));
  await expect.poll(() => opt.evaluate(() => dgSettings.spread)).toBe(false);
  await releaseSet(opt, false); // this save fails
  await expect(opt.locator('#status')).toHaveClass(/error/);
  await expect(sw).not.toHaveAttribute('aria-disabled');
  // the switch shows what is stored, not the value from before the click
  await expect(sw).not.toBeChecked();
  expect(await stored(opt, 'spread')).toEqual({ spread: false });
  await expect(count(opt, 'pricing')).toHaveText('4 of 5 on');
  expect(await isMixed(secSwitch(opt, 'pricing'))).toBe(true);
});

test('a failed bulk save puts back only its own switches', async ({ settings }) => {
  const opt = await settings();
  await holdSets(opt);
  const pc = opt.locator('input[data-key=periodChange]');
  await secSwitch(opt, 'pricing').click();
  // a switch of another section, clicked while the bulk save waits: its own save waits too
  await opt.locator(ROW('periodChange')).click();
  await expect(pc).not.toBeChecked();
  expect(await heldCount(opt)).toBe(2);
  await recordChecked(opt, ['periodChange']);
  await releaseSet(opt, false); // the bulk save fails
  await expect(opt.locator('#status')).toHaveClass(/error/);
  for (const k of PRICING) await expect(opt.locator(`input[data-key=${k}]`)).toBeChecked();
  expect(await shown(opt, 'periodChange')).not.toContain(true);
  await expect(pc).not.toBeChecked();
  await expect(pc).toHaveAttribute('aria-disabled', 'true');
  await releaseSet(opt);
  await expect(pc).not.toHaveAttribute('aria-disabled');
  await expect(pc).not.toBeChecked();
  expect(await stored(opt, 'periodChange')).toEqual({ periodChange: false });
});

test('a locked switch looks pending only after a short delay, in light and dark', async ({ settings }) => {
  const opt = await settings();
  await holdSets(opt);
  const sw = opt.locator('input[data-key=spread]');
  for (const scheme of ['light', 'dark']) {
    await opt.emulateMedia({ colorScheme: scheme });
    await expect(sw).toHaveCSS('opacity', '1');
    await opt.locator(ROW('spread')).click();
    await expect(sw).toHaveAttribute('aria-disabled', 'true');
    // a fast save never flickers: the look waits ~150 ms
    expect(await sw.evaluate(el => getComputedStyle(el).animationDelay)).toBe('0.15s');
    await expect(sw).toHaveCSS('opacity', '0.45');
    await expect(sw).toHaveCSS('cursor', 'progress');
    await releaseSet(opt);
    await expect(sw).not.toHaveAttribute('aria-disabled');
    await expect(sw).toHaveCSS('opacity', '1');
    await expect(sw).toHaveCSS('cursor', 'pointer');
  }
});

test('a failed bulk save reverts the switches', async ({ settings }) => {
  const opt = await settings();
  await opt.evaluate(() => {
    const set = chrome.storage.sync.set;
    chrome.storage.sync.set = () => { chrome.storage.sync.set = set; return Promise.reject(new Error('QUOTA_BYTES_PER_ITEM quota exceeded')); };
  });
  await secSwitch(opt, 'pricing').click();
  await expect(opt.locator('#status')).toHaveClass(/error/);
  for (const k of PRICING) await expect(opt.locator(`input[data-key=${k}]`)).toBeChecked();
  await expect(secSwitch(opt, 'pricing')).toBeChecked();
  await expect(count(opt, 'pricing')).toHaveText('5 of 5 on');
});
