// Failed DEGIRO requests must not turn into a request loop: an expired session is never reused, and failed
// requests are retried only after a pause (orders.js, portfolio.js; page world, harness `page: true`).
// Formerly Playwright tests: on the virtual clock every pause is exact, with no real-time waits for answers.
// DEGIRO's endpoints are answered by tests/fixtures/mock-api.js, as in the e2e tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('./harness');
const { CASH_TODAY, cashFundsApi } = require('../fixtures/mock-api');

const noErrors = (w, tab) => { assert.deepEqual(w.errors.map(e => e.stack || String(e)), []); assert.deepEqual(tab.failed(), [], 'no feature run() threw'); };
const PRODUCT = { fixture: 'degiro', hash: '/products/123/overview', page: true, highcharts: true, layout: true };
const PORTFOLIO = { fixture: 'portfolio', hash: '/portfolio', page: true, layout: true };
const CASH_LINES = { dgTweaksCashLines: '1' }; // the Portfolio chart's cash-lines switch on (portfolio.js keeps it in localStorage)
/** the order badge with this text on the product chart */
const badge = (tab, text) => tab.$$('#chart [data-dg-order-badge]').find(d => d.textContent === text);
/** advance in small steps until `ok()`, at most `ms` */
async function until(w, ok, ms = 10000, step = 100) {
  for (let t = 0; t < ms && !ok(); t += step) await w.advance(step);
  assert.ok(ok(), `not within ${ms} ms`);
}

// ---------- orders.js: the session and the orders poll ----------

test('expired session: no request loop, and orders come back with the new session', async () => {
  const w = createWorld();
  const tab = await w.open({ ...PRODUCT, respond: u => (u.pathname.includes(';jsessionid=TESTSID') ? { status: 401, body: '' } : undefined) });
  await w.advance(1000);
  assert.equal(tab.calls.update, 1, 'the first poll, with the session from DEGIRO\'s own request: rejected');
  await w.advance(18000);
  assert.equal(tab.calls.update, 1, 'one rejected request, not one per second: it waits 20 s');
  assert.equal(tab.calls.config, 0);
  await w.advance(2000);
  assert.equal(tab.calls.config, 1, 'then asks DEGIRO for the session, once');
  assert.equal(tab.calls.update, 2);
  assert.match(tab.calls.lastUpdateUrl, /\/42;jsessionid=APISID\?/, 'the new session');
  assert.equal(tab.calls.client, 0, 'the account number is already known from the URL');
  await w.advance(200);
  assert.ok(badge(tab, 'BUY 100 · 15,50'), 'and the orders are drawn');
  noErrors(w, tab);
});

test('a session the fallback returns that was rejected is not used again', async () => {
  const w = createWorld();
  const tab = await w.open({ ...PRODUCT, globals: { __MOCK_NO_URL_SESSION: true },
    respond: u => (u.pathname.startsWith('/trading/secure/v5/update/') ? { status: 401, body: '' } : undefined) });
  await w.advance(4500);
  assert.deepEqual([tab.calls.config, tab.calls.update], [0, 0], 'the fallback waits 5 s for DEGIRO\'s own requests');
  await w.advance(1500);
  assert.deepEqual([tab.calls.config, tab.calls.update], [1, 1], 'asked once, and its session rejected');
  await w.advance(61000);
  assert.equal(tab.calls.config, 2, 'asked again a minute later');
  assert.equal(tab.calls.update, 1, 'the same rejected session is not used again');
  noErrors(w, tab);
});

test('a request that never answers times out, and orders load on the next poll', async () => {
  let n = 0;
  const w = createWorld();
  const tab = await w.open({ ...PRODUCT, respond: u => (u.pathname.startsWith('/trading/secure/v5/update/') && n++ === 0 ? 'hang' : undefined) });
  await w.advance(1000);
  assert.equal(tab.calls.update, 1);
  await w.advance(18000);
  assert.equal(tab.calls.update, 1, 'timed out after 15 s; the next poll is 20 s after the first');
  await w.advance(1500);
  assert.equal(tab.calls.update, 2);
  await w.advance(200);
  assert.ok(badge(tab, 'BUY 100 · 15,50'), 'the orders are drawn');
  noErrors(w, tab);
});

// ---------- portfolio.js: the chart's value data ----------

for (const [what, answer] of [['an error', { status: 500, body: '' }], ['bad JSON', { status: 200, contentType: 'application/json', body: 'not json' }]]) {
  test(`portfolio value request answering ${what} is not retried in a loop: after 30 s, then 60 s`, async () => {
    const w = createWorld();
    // the mock page's own chart gets its data: only the extension's requests (its own, made with ownRequests) fail
    let page = true;
    const tab = await w.open({ ...PORTFOLIO, respond: u => {
      if (u.pathname !== '/portfolio-metrics/secure/api/v1/portfolio/value') return undefined;
      if (page) { page = false; return undefined; }
      return answer;
    } });
    await w.advance(1000);
    assert.equal(tab.calls.portfolio, 2, 'the mock page\'s own request, and one of ours');
    await w.advance(28000);
    assert.equal(tab.calls.portfolio, 2, 'nothing before the 30 s pause is over');
    await w.advance(2000);
    assert.equal(tab.calls.portfolio, 3);
    await w.advance(58000);
    assert.equal(tab.calls.portfolio, 3, 'the pause doubled to 60 s');
    await w.advance(2000);
    assert.equal(tab.calls.portfolio, 4);
    noErrors(w, tab);
  });
}

test('another period than the one failing is asked at once, and its own failure waits 30 s again, not the doubled wait', async () => {
  const w = createWorld();
  // the mock page's own request for each period gets its data; ours fail
  const pageAsked = new Set();
  const tab = await w.open({ ...PORTFOLIO, respond: u => {
    if (u.pathname !== '/portfolio-metrics/secure/api/v1/portfolio/value') return undefined;
    const p = u.searchParams.get('period');
    if (!pageAsked.has(p)) { pageAsked.add(p); return undefined; }
    return { status: 500, body: '' };
  } });
  const ours = p => tab.requests.filter(r => r.includes('/portfolio/value?period=' + p)).length - 1; // less the page's own
  await w.advance(1000);
  await w.advance(31000);
  assert.equal(ours('ONE_YEAR'), 2, '1Y failed twice: its next try would be 60 s later');
  tab.$('[data-p=ONE_MONTH]').click();
  await w.advance(1000);
  assert.equal(ours('ONE_MONTH'), 1, 'the new period is asked at once, not after 1Y\'s wait');
  await w.advance(28000);
  assert.equal(ours('ONE_MONTH'), 1);
  await w.advance(2500);
  assert.equal(ours('ONE_MONTH'), 2, 'its failure waited 30 s, not 1Y\'s doubled 120 s');
  noErrors(w, tab);
});

// ---------- portfolio.js: today's cash (/update?cashFunds=0) and the account statement ----------

const CASH = u => u.pathname.startsWith('/trading/secure/v5/update/') && u.searchParams.has('cashFunds');
const STATEMENT = u => u.pathname === '/portfolio-reports/secure/v6/accountoverview';

test('today\'s cash is asked for at most once a minute', async () => {
  const w = createWorld();
  const tab = await w.open(PORTFOLIO);
  await until(w, () => tab.calls.cashFunds === 1 && !!tab.$('#dg-portfolio-cash'));
  await w.advance(58000);
  assert.equal(tab.calls.cashFunds, 1);
  await w.advance(3000);
  assert.equal(tab.calls.cashFunds, 2, 'a minute after the first');
  await w.advance(55000);
  assert.equal(tab.calls.cashFunds, 2);
  noErrors(w, tab);
});

for (const [name, is, key] of /** @type {const} */ ([['today\'s cash', CASH, 'cashFunds'], ['account statement', STATEMENT, 'statement']])) {
  for (const [what, answer] of /** @type {const} */ ([
    ['401', { status: 401, body: '' }], ['503', { status: 503, body: '' }],
    ['bad JSON', { status: 200, contentType: 'application/json', body: 'not json' }], ['no answer', 'hang']
  ])) {
    test(`${name} request answering ${what}: retried after 30 s, then 60 s, not in a loop`, async () => {
      const w = createWorld();
      const tab = await w.open({ ...PORTFOLIO, localStorage: CASH_LINES, respond: u => (is(u) ? answer : undefined) });
      const failed = () => (answer === 'hang' ? w.advance(15000) : w.advance(0)); // a hung request times out after 15 s
      await until(w, () => tab.calls[key] === 1);
      await failed();
      await w.advance(29000);
      assert.equal(tab.calls[key], 1, 'nothing before the 30 s pause is over');
      await w.advance(2000);
      assert.equal(tab.calls[key], 2);
      await failed(); // the retry went out within the last 2 s: so did its failure
      await w.advance(57000);
      assert.equal(tab.calls[key], 2, 'the pause doubled to 60 s');
      await w.advance(4000);
      assert.equal(tab.calls[key], 3);
      noErrors(w, tab);
    });
  }
}

test('a change in today\'s cash reloads the statement once', async () => {
  let today = CASH_TODAY;
  const w = createWorld();
  const tab = await w.open({ ...PORTFOLIO, localStorage: CASH_LINES,
    respond: u => (CASH(u) ? { status: 201, contentType: 'application/json', body: JSON.stringify(cashFundsApi(today)) } : undefined) });
  const cash = () => tab.$('#dg-portfolio-cash')?.textContent || '';
  await until(w, () => cash().includes('€ 26.876') && tab.calls.statement === 1); // whole units next to the total
  today = { ...CASH_TODAY, EUR: 25000 }; // cash moved
  await w.advance(61000);
  assert.equal(tab.calls.cashFunds, 2);
  assert.equal(tab.calls.statement, 2, 'the statement is loaded again');
  assert.match(cash(), /€ 25\.000/);
  await w.advance(61000);
  assert.equal(tab.calls.cashFunds, 3, 'the next minute\'s answer is the same');
  assert.equal(tab.calls.statement, 2, 'no further reload');
  noErrors(w, tab);
});
