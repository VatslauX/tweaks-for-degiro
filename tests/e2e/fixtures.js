// Playwright fixtures: a Chromium profile with the unpacked extension loaded,
// and a mock of trader.degiro.nl served via request routing (no network needed).
const { test: base, expect, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// DGT_EXTENSION_DIR points at a scratch copy of extension/ (used to prove a test fails against broken code)
const EXT = path.resolve(process.env.DGT_EXTENSION_DIR || path.join(__dirname, '../../extension'));
const MOCK = fs.readFileSync(path.resolve(__dirname, '../fixtures/degiro.html'), 'utf8');
const PORTFOLIO = fs.readFileSync(path.resolve(__dirname, '../fixtures/portfolio.html'), 'utf8');
const ORDERS_PAGE = fs.readFileSync(path.resolve(__dirname, '../fixtures/orders.html'), 'utf8');
const FAVOURITES_PAGE = fs.readFileSync(path.resolve(__dirname, '../fixtures/favourites.html'), 'utf8');
const TRANSACTIONS_PAGE = fs.readFileSync(path.resolve(__dirname, '../fixtures/transactions.html'), 'utf8');
// DEGIRO's JSON endpoints, shared with the integration harness
const { portfolioSeries, CASH_TODAY, cashFundsApi, DEFAULT_ORDERS, newCalls, answer } = require('../fixtures/mock-api');
const HIGHCHARTS = fs.readFileSync(require.resolve('highcharts/highcharts.js'), 'utf8');

// Chrome derives an unpacked extension's ID from its absolute path.
function extensionId(dir) {
  const h = crypto.createHash('sha256').update(fs.realpathSync(dir)).digest('hex').slice(0, 32);
  return [...h].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

// A browser launch costs about 0.5 s, so a worker reuses one for this many tests. A new profile after
// that keeps chrome.storage.sync under its write quota (120 a minute), which counts per profile.
const REUSE = 10;

// Playwright's fake clock belongs to the context (page.clock is context.clock), and every clock call installs it
// as init scripts that nothing public removes: each later page would get a fake Date, timers, frames and a
// `performance` with no resource entries. So any clock call marks the browser as not reusable.
function watchClock(context, used) {
  const clock = context.clock;
  for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(clock))) {
    const f = clock[name];
    if (name === 'constructor' || typeof f !== 'function') continue;
    clock[name] = (...args) => { used(); return f.apply(clock, args); };
  }
}

// what one test leaves behind: its tabs, routes and cookies, and the extension's storage
async function reset(context) {
  const keep = await context.newPage(); // the browser must keep a tab open
  for (const p of context.pages()) if (p !== keep) await p.close();
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  await context.clearCookies();
  await keep.goto(`chrome-extension://${extensionId(EXT)}/options.html`); // writes storage only on a change
  // the popup's own localStorage too (which sections are open)
  await keep.evaluate(() => { localStorage.clear(); return Promise.all([chrome.storage.sync.clear(), chrome.storage.local.clear()]); });
  // the mock DEGIRO origin's own localStorage (e.g. portfolio.js's dgTweaksCashLines switch), served
  // from a blank local route so no request leaves the machine
  await keep.route('https://trader.degiro.nl/**', route => route.fulfill({ contentType: 'text/html', body: '' }));
  await keep.goto('https://trader.degiro.nl/trader/');
  await keep.evaluate(() => localStorage.clear());
  await keep.goto('about:blank'); // leave the DEGIRO origin while its requests are still answered locally
  await keep.unrouteAll({ behavior: 'ignoreErrors' });
}

const test = base.extend({
  // browser UI language, which picks the extension's _locales; test.use({ lang: 'de' }) to change it
  lang: ['en-US', { option: true, scope: 'worker' }],
  // a browser for this test alone, e.g. one that switches the extension off: test.use({ freshBrowser: true })
  freshBrowser: [false, { option: true }],
  browserPool: [async ({ lang }, use) => {
    let context = null, dir = '', uses = 0, clocked = false;
    const close = async () => {
      if (!context) return;
      await context.close().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
      context = null;
    };
    await use({
      async take(fresh) {
        if (fresh || !context || uses >= REUSE) {
          await close();
          dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgt-'));
          context = await chromium.launchPersistentContext(dir, {
            channel: 'chromium',
            headless: false,
            locale: lang,
            // --lang works on Linux and Windows; macOS ignores it (it reads AppleLanguages)
            args: ['--headless=new', `--lang=${lang}`, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
            viewport: { width: 1280, height: 900 }
          });
          uses = 0;
          clocked = false;
          watchClock(context, () => { clocked = true; });
        }
        uses++;
        return context;
      },
      close,
      /** a test installed the fake clock in this browser */
      clocked: () => clocked
    });
    await close();
  }, { scope: 'worker' }],
  context: async ({ browserPool, freshBrowser }, use, testInfo) => {
    const context = await browserPool.take(freshBrowser);
    await use(context);
    // a failed test may have left the browser in any state, and the fake clock stays in it (watchClock):
    // never hand either to the next test
    if (freshBrowser || browserPool.clocked() || testInfo.status !== testInfo.expectedStatus) return browserPool.close();
    try { await reset(context); } catch { await browserPool.close(); }
  },
  extId: async ({}, use) => use(extensionId(EXT)),

  // open the mock DEGIRO product page. `respond(url)` may answer a request first (return
  // route.fulfill options, e.g. { status: 401 }, or 'hang' to never answer), or return nothing
  // for the normal mock answer.
  degiro: async ({ context }, use) => {
    await use(async ({ orders = DEFAULT_ORDERS, url = 'https://trader.degiro.nl/trader/#/products/123/overview', initScript, respond, clock, cashLines } = {}) => {
      const calls = newCalls();
      await context.route('https://trader.degiro.nl/**', async route => {
        const u = new URL(route.request().url());
        if (u.pathname === '/mock/highcharts.js') return route.fulfill({ contentType: 'application/javascript', body: HIGHCHARTS });
        const api = answer(u, { calls, orders, respond });
        if (api === 'hang') return; // left pending: the page's request never completes
        if (api) return route.fulfill(api);
        if (u.searchParams.get('mock') === 'portfolio') return route.fulfill({ contentType: 'text/html', body: PORTFOLIO });
        if (u.searchParams.get('mock') === 'favourites') return route.fulfill({ contentType: 'text/html', body: FAVOURITES_PAGE });
        if (u.searchParams.get('mock') === 'orders') return route.fulfill({ contentType: 'text/html', body: ORDERS_PAGE });
        if (u.searchParams.get('mock') === 'transactions') return route.fulfill({ contentType: 'text/html', body: TRANSACTIONS_PAGE });
        return route.fulfill({ contentType: 'text/html', body: MOCK });
      });
      const page = await context.newPage();
      // before goto so the page's timers are fake from the start. The clock still flows in real time;
      // page.clock.fastForward jumps it ahead and fires the timers that fall due. The browser is not reused after.
      if (clock) await page.clock.install();
      await page.addInitScript(o => { window.__MOCK_ORDERS = o; }, orders);
      // cashLines: the Portfolio chart's cash-lines switch starts on (portfolio.js keeps it in localStorage)
      if (cashLines) await page.addInitScript(() => { try { localStorage.setItem('dgTweaksCashLines', '1'); } catch (e) {} });
      if (initScript) await page.addInitScript(initScript);
      await page.goto(url);
      return { page, calls };
    });
  },

  // open the settings page; returns the page. Its sections start open, so tests can click any row;
  // `collapsed: true` leaves them as a user first sees them (all collapsed).
  settings: async ({ context, extId }, use) => {
    await use(async ({ collapsed = false } = {}) => {
      const page = await context.newPage();
      if (!collapsed) {
        await page.addInitScript(() => {
          try { localStorage.setItem('dgOptOpen', JSON.stringify(['pageStatus', 'pricing', 'chart', 'portfolio', 'orders', 'cleanup'])); } catch (e) {}
        });
      }
      await page.goto(`chrome-extension://${extId}/options.html`);
      await page.waitForSelector('input[data-key=spread]', { state: 'attached' });
      return page;
    });
  }
});

// set a flag via the settings page UI
async function setFlag(settingsPage, key, on) {
  const cb = settingsPage.locator(`input[data-key=${key}]`);
  if ((await cb.isChecked()) !== on) await settingsPage.locator(`label.row:has(input[data-key=${key}])`).click();
  await expect(cb).toBeChecked({ checked: on });
}

// After install the fake clock still flows in real time; fastForward only jumps it ahead and fires the timers
// that fall due on the way. DEGIRO's session reaches the extension in real time (PerformanceObserver) and answers
// arrive in real time, so a single fastForward can come before the work it should hurry along has started.
// Advance in small steps until `locator` shows up.
async function advanceUntilVisible(page, locator, step = 100) {
  await expect.poll(async () => { await page.clock.fastForward(step); return locator.count(); }, { timeout: 10000 }).toBeGreaterThan(0);
  await expect(locator).toBeVisible();
}

/** the extension's background worker */
async function backgroundWorker(context) {
  const mine = w => w.url().endsWith('/background.js');
  return context.serviceWorkers().find(mine) || context.waitForEvent('serviceworker', { predicate: mine });
}

/**
 * Stub Chrome's permission prompt on the settings page, and (`grant`) the worker's view of the permissions too:
 * without them the worker switches the setting back off. No alarm is stored, so the worker never polls Yahoo.
 * `answerMs`: the prompt answers that long after the click (a slow runner, or a user taking a moment), not at once.
 * A spec that uses it calls unstubPermissions(context) in afterEach.
 * @param {import('@playwright/test').BrowserContext} context @param {import('@playwright/test').Page} opt @param {boolean} grant
 * @param {{ answerMs?: number }} [o]
 */
async function stubPermissions(context, opt, grant, { answerMs = 0 } = {}) {
  await opt.evaluate(([g, ms]) => {
    window.__perm = { requested: [], removed: [] };
    window.__granted = false;
    chrome.permissions.contains = async () => window.__granted;
    chrome.permissions.request = async p => {
      window.__perm.requested.push(p);
      if (ms) await new Promise(r => setTimeout(r, ms));
      window.__granted = g;
      return g;
    };
    chrome.permissions.remove = async p => { window.__perm.removed.push(p); return true; };
  }, [grant, answerMs]);
  if (grant) {
    const sw = await backgroundWorker(context);
    await sw.evaluate(() => { globalThis.__contains = chrome.permissions.contains; chrome.permissions.contains = async () => true; });
  }
}
/** the browser is reused by the next tests: give the worker its real permission check back */
async function unstubPermissions(context) {
  const sw = context.serviceWorkers().find(w => w.url().endsWith('/background.js'));
  await sw?.evaluate(() => { if (globalThis.__contains) chrome.permissions.contains = globalThis.__contains; }).catch(() => {});
}

/** the computed font of the product chart's own text (a price axis label), which our labels on the chart follow;
 * Arial in the mock, as on DEGIRO, not the page's Roboto */
async function chartAxisFont(page) {
  const f = await page.evaluate(() => getComputedStyle(document.querySelector('#chart .highcharts-yaxis-labels > *')).fontFamily);
  expect(f).toBe('Arial'); // the mock is like DEGIRO: otherwise a test comparing with it would prove nothing
  return f;
}

module.exports = { test, expect, setFlag, advanceUntilVisible, stubPermissions, unstubPermissions, backgroundWorker, DEFAULT_ORDERS, EXT, portfolioSeries, CASH_TODAY, cashFundsApi, chartAxisFont };
