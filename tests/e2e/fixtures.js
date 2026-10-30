// Playwright fixtures: a Chromium profile with the unpacked extension loaded,
// and a mock of trader.degiro.nl served via request routing (no network needed).
const { test: base, expect, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const EXT = path.resolve(__dirname, '../../extension');
const MOCK = fs.readFileSync(path.resolve(__dirname, '../fixtures/degiro.html'), 'utf8');
const PORTFOLIO = fs.readFileSync(path.resolve(__dirname, '../fixtures/portfolio.html'), 'utf8');
const ORDERS_PAGE = fs.readFileSync(path.resolve(__dirname, '../fixtures/orders.html'), 'utf8');
const FAVOURITES_PAGE = fs.readFileSync(path.resolve(__dirname, '../fixtures/favourites.html'), 'utf8');
const TRANSACTIONS_PAGE = fs.readFileSync(path.resolve(__dirname, '../fixtures/transactions.html'), 'utf8');

// portfolio value series per period, newest first (like DEGIRO)
const PERIOD_DAYS = { ONE_MONTH: 22, THREE_MONTHS: 65, YEAR_TO_DATE: 205, ONE_YEAR: 260 };
function portfolioSeries(period) {
  const n = PERIOD_DAYS[period] || 260, out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2026, 9, 21) - (n - 1 - i) * 864e5);
    const value = Math.round((100000 + i * 150 + 4000 * Math.sin(i / 9)) * 100) / 100;
    out.push({ date: d.toISOString().slice(0, 10), value });
  }
  return out.reverse();
}
const HIGHCHARTS = fs.readFileSync(require.resolve('highcharts/highcharts.js'), 'utf8');

// Chrome derives an unpacked extension's ID from its absolute path.
function extensionId(dir) {
  const h = crypto.createHash('sha256').update(fs.realpathSync(dir)).digest('hex').slice(0, 32);
  return [...h].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

// DEGIRO's /update endpoint returns orders as lists of {name, value} pairs.
const toApi = orders => ({
  orders: { value: orders.map((o, i) => ({ id: 'o' + i, value: Object.entries({ id: 'o' + i, ...o }).map(([name, value]) => ({ name, value })) })) }
});

const DEFAULT_ORDERS = [
  { productId: 123, product: 'Mock ETF', buysell: 'S', size: 200, price: 17.65, stopPrice: 0, orderType: 'LIMIT' },
  { productId: 123, product: 'Mock ETF', buysell: 'B', size: 100, price: 15.5, stopPrice: 0, orderType: 'LIMIT' },
  { productId: 123, product: 'Mock ETF', buysell: 'B', size: 200, price: 14.1, stopPrice: 0, orderType: 'LIMIT' },
  { productId: 123, product: 'Mock ETF', buysell: 'B', size: 50, price: 9.5, stopPrice: 0, orderType: 'LIMIT' },   // below chart
  { productId: 999, product: 'Other stock', buysell: 'B', size: 10, price: 100, stopPrice: 0, orderType: 'LIMIT' } // other product
];

// A browser launch costs about 0.5 s, so a worker reuses one for this many tests. A new profile after
// that keeps chrome.storage.sync under its write quota (120 a minute), which counts per profile.
const REUSE = 10;

// what one test leaves behind: its tabs, routes and cookies, and the extension's storage
async function reset(context) {
  const keep = await context.newPage(); // the browser must keep a tab open
  for (const p of context.pages()) if (p !== keep) await p.close();
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  await context.clearCookies();
  await keep.goto(`chrome-extension://${extensionId(EXT)}/options.html`); // writes storage only on a change
  await keep.evaluate(() => Promise.all([chrome.storage.sync.clear(), chrome.storage.local.clear()]));
  await keep.goto('about:blank');
}

const test = base.extend({
  // browser UI language, which picks the extension's _locales; test.use({ lang: 'de' }) to change it
  lang: ['en-US', { option: true, scope: 'worker' }],
  // a browser for this test alone, e.g. one that switches the extension off: test.use({ freshBrowser: true })
  freshBrowser: [false, { option: true }],
  browserPool: [async ({ lang }, use) => {
    let context = null, dir = '', uses = 0;
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
        }
        uses++;
        return context;
      },
      close
    });
    await close();
  }, { scope: 'worker' }],
  context: async ({ browserPool, freshBrowser }, use, testInfo) => {
    const context = await browserPool.take(freshBrowser);
    await use(context);
    // a failed test may have left the browser in any state: never hand it to the next test
    if (freshBrowser || testInfo.status !== testInfo.expectedStatus) return browserPool.close();
    try { await reset(context); } catch { await browserPool.close(); }
  },
  extId: async ({}, use) => use(extensionId(EXT)),

  // open the mock DEGIRO product page. `respond(url)` may answer a request first (return
  // route.fulfill options, e.g. { status: 401 }, or 'hang' to never answer), or return nothing
  // for the normal mock answer.
  degiro: async ({ context }, use) => {
    await use(async ({ orders = DEFAULT_ORDERS, url = 'https://trader.degiro.nl/trader/#/products/123/overview', initScript, respond, clock } = {}) => {
      const calls = { update: 0, config: 0, client: 0, portfolio: 0 };
      await context.route('https://trader.degiro.nl/**', async route => {
        const u = new URL(route.request().url());
        if (u.pathname === '/mock/highcharts.js') return route.fulfill({ contentType: 'application/javascript', body: HIGHCHARTS });
        if (u.pathname.startsWith('/trading/secure/v5/update/')) { calls.update++; calls.lastUpdateUrl = u.pathname + u.search; }
        if (u.pathname === '/portfolio-metrics/secure/api/v1/portfolio/value') calls.portfolio++;
        const custom = respond?.(u);
        if (custom === 'hang') return; // left pending: the page's request never completes
        if (custom) return route.fulfill(custom);
        // session fallback (orders.js): DEGIRO's config and client endpoints
        if (u.pathname === '/login/secure/config') {
          calls.config++;
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { sessionId: 'APISID', clientId: 7 } }) });
        }
        if (u.pathname === '/pa/secure/client') {
          calls.client++;
          calls.lastClientUrl = u.pathname + u.search;
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { intAccount: 4242, firstContact: { firstName: 'x' } } }) });
        }
        if (u.pathname.startsWith('/trading/secure/v5/update/')) {
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(toApi(orders)) });
        }
        if (u.pathname === '/portfolio-metrics/secure/api/v1/portfolio/value') {
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(portfolioSeries(u.searchParams.get('period'))) });
        }
        if (u.pathname.includes('/secure/')) return route.fulfill({ contentType: 'application/json', body: '{}' });
        if (u.searchParams.get('mock') === 'portfolio') return route.fulfill({ contentType: 'text/html', body: PORTFOLIO });
        if (u.searchParams.get('mock') === 'favourites') return route.fulfill({ contentType: 'text/html', body: FAVOURITES_PAGE });
        if (u.searchParams.get('mock') === 'orders') return route.fulfill({ contentType: 'text/html', body: ORDERS_PAGE });
        if (u.searchParams.get('mock') === 'transactions') return route.fulfill({ contentType: 'text/html', body: TRANSACTIONS_PAGE });
        return route.fulfill({ contentType: 'text/html', body: MOCK });
      });
      const page = await context.newPage();
      if (clock) await page.clock.install(); // before goto so extension timers are fake from the start
      await page.addInitScript(o => { window.__MOCK_ORDERS = o; }, orders);
      if (initScript) await page.addInitScript(initScript);
      await page.goto(url);
      return { page, calls };
    });
  },

  // open the settings page; returns the page
  settings: async ({ context, extId }, use) => {
    await use(async () => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extId}/options.html`);
      await page.waitForSelector('input[data-key=spread]');
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

module.exports = { test, expect, setFlag, DEFAULT_ORDERS, EXT, portfolioSeries };
