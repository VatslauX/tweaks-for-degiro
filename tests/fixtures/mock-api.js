// DEGIRO's JSON endpoints as the mock pages answer them: shared by the Playwright route
// (tests/e2e/fixtures.js) and the integration harness's fetch (tests/integration/harness.js),
// so both worlds get the same answers and count the same calls. Plain Node, no Playwright.

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
// Cash: today's balance per currency (DEGIRO's /update?cashFunds=0) and the account statement's
// cashMovements (newest first, with a sweep pair sharing a timestamp). GBP has no movements: its
// line is flat at today's balance. CHF is 0 and is left out.
const CASH_TODAY = { EUR: 26876.16, USD: 1204, GBP: 12.5, CHF: 0 };
const cashFundsApi = (today = CASH_TODAY) => ({
  cashFunds: { value: Object.entries(today).map(([cur, v], i) => ({ id: i, value: [
    { name: 'id', value: i }, { name: 'currencyCode', value: cur }, { name: 'value', value: v }, { name: 'handling', value: 'FLATEX' }] })) }
});
const mv = (date, currency, total, change) => ({ id: 1, date: `${date}T12:00:00+02:00`, valueDate: date, description: 'x', currency, type: 'TRANSACTION',
  balance: { total, flatexCash: total, unsettledCash: 0 }, ...(change === undefined ? {} : { change }) });
const CASH_MOVEMENTS = [
  mv('2026-10-15', 'EUR', 26876.16), mv('2026-10-15', 'EUR', 20000, -5000), mv('2026-10-15', 'EUR', 26876.16, 6876.16),
  mv('2026-08-01', 'USD', 1204, 1204),
  mv('2026-05-01', 'EUR', 20000, -10000), // before it: 30000
  mv('2025-01-01', 'EUR', 30000, 30000)   // outside every chart period
];
const accountOverview = u => {
  const iso = s => (s || '').split('/').reverse().join('-');
  const from = iso(u.searchParams.get('fromDate')), to = iso(u.searchParams.get('toDate'));
  return { data: { cashMovements: CASH_MOVEMENTS.filter(m => m.valueDate >= from && m.valueDate <= to) } };
};

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

// update: the orders requests (/update/…?orders=0); cashFunds: portfolio.js's cash request on the same endpoint
const newCalls = () => ({ update: 0, cashFunds: 0, config: 0, client: 0, portfolio: 0, statement: 0, lastStatementUrl: '', lastCashFundsUrl: '' });

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * Count a request to the mock DEGIRO and give its answer.
 * `respond(url)` may answer first: fulfill options ({ status, contentType?, body }) or 'hang' (never answered).
 * @param {URL} u @param {{ calls: ReturnType<typeof newCalls>, orders?: any[], respond?: (u: URL) => any }} o
 * @returns {'hang' | { status?: number, contentType?: string, body: string } | null} null: not a JSON endpoint (a page)
 */
function answer(u, { calls, orders = DEFAULT_ORDERS, respond }) {
  if (u.pathname.startsWith('/trading/secure/v5/update/')) {
    if (u.searchParams.has('cashFunds')) { calls.cashFunds++; calls.lastCashFundsUrl = u.pathname + u.search; }
    else { calls.update++; calls.lastUpdateUrl = u.pathname + u.search; }
  }
  if (u.pathname === '/portfolio-metrics/secure/api/v1/portfolio/value') calls.portfolio++;
  if (u.pathname === '/portfolio-reports/secure/v6/accountoverview') { calls.statement++; calls.lastStatementUrl = u.pathname + u.search; }
  const custom = respond?.(u);
  if (custom) return custom;
  // session fallback (orders.js): DEGIRO's config and client endpoints
  if (u.pathname === '/login/secure/config') {
    calls.config++;
    return json({ data: { sessionId: 'APISID', clientId: 7 } });
  }
  if (u.pathname === '/pa/secure/client') {
    calls.client++;
    calls.lastClientUrl = u.pathname + u.search;
    return json({ data: { intAccount: 4242, firstContact: { firstName: 'x' } } });
  }
  if (u.pathname === '/portfolio-reports/secure/v6/accountoverview') return json(accountOverview(u));
  if (u.pathname.startsWith('/trading/secure/v5/update/') && u.searchParams.has('cashFunds')) return json(cashFundsApi(), 201);
  if (u.pathname.startsWith('/trading/secure/v5/update/')) return json(toApi(orders));
  if (u.pathname === '/portfolio-metrics/secure/api/v1/portfolio/value') return json(portfolioSeries(u.searchParams.get('period')));
  if (u.pathname.includes('/secure/')) return json({});
  return null;
}

module.exports = { portfolioSeries, CASH_TODAY, cashFundsApi, accountOverview, toApi, DEFAULT_ORDERS, newCalls, answer };
