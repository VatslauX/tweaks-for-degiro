// Portfolio chart: today's cash per currency next to the total, and (with its switch) the cash as
// stacked columns on the chart plus a row per currency in DEGIRO's hover tooltip.
// Mock data: CASH_TODAY and CASH_MOVEMENTS in fixtures.js.
const { test, expect, setFlag, advanceUntilVisible, portfolioSeries } = require('./fixtures');

const URL_P = 'https://trader.degiro.nl/trader/?mock=portfolio#/portfolio';
const cash = page => page.locator('#dg-portfolio-cash');
const layer = page => page.locator('canvas[data-dg-cash]'); // data-dg-cash: the currencies, bottom up
const lineSwitch = page => page.locator('#dg-portfolio-cash [role="switch"]');
const tipRows = page => page.locator('[data-name="performance-plot-tooltip"] [data-dg-cash-tip]');

test('today\'s cash per currency follows the period change, zero balances left out', async ({ degiro }) => {
  const { page, calls } = await degiro({ url: URL_P });
  await expect(cash(page)).toHaveText(/^Cash.*€ 26\.876,16.*\$ 1\.204,00.*£ 12,50$/);
  await expect(cash(page)).not.toContainText('CHF');
  // inside DEGIRO's value block, after the period change
  const order = await page.$eval('#dg-portfolio-cash', el => [el.parentElement.getAttribute('data-name'), el.previousElementSibling?.id]);
  expect(order).toEqual(['performance-chart-value', 'dg-portfolio-change']);
  expect(await cash(page).getAttribute('title')).toMatch(/Not converted/);
  // the columns start off: none drawn, and the account statement is not even asked for
  await expect(lineSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect(lineSwitch(page)).toHaveAttribute('aria-label', 'Cash columns on the chart');
  await expect(layer(page)).toHaveCount(0);
  expect(calls.statement).toBe(0);
});

test('the switch next to "Cash" shows and hides the columns, and is remembered', async ({ degiro }) => {
  const { page, calls } = await degiro({ url: URL_P });
  await page.mouse.move(5, 5);
  await expect(lineSwitch(page)).toHaveAttribute('aria-checked', 'false');
  const off = await lineSwitch(page).evaluate(b => getComputedStyle(b).backgroundColor);
  await lineSwitch(page).click();
  await page.mouse.move(5, 5);
  await expect(lineSwitch(page)).toHaveAttribute('aria-checked', 'true');
  expect(await lineSwitch(page).evaluate(b => getComputedStyle(b).backgroundColor)).toBe('rgb(224, 161, 0)'); // gold track
  expect(off).not.toBe('rgb(224, 161, 0)');
  await expect(layer(page)).toHaveAttribute('data-dg-cash', 'EUR,USD,GBP');
  expect(calls.statement).toBe(1);
  // a swatch in its columns' colour before each amount: EUR green, the others gold shades
  expect(await page.$$eval('#dg-portfolio-cash [data-currency] > span:first-child', s => s.map(x => getComputedStyle(x).backgroundColor)))
    .toEqual(['rgb(7, 131, 7)', 'rgb(224, 161, 0)', 'rgb(168, 120, 0)']);
  // no currency badges on the chart itself
  expect(await page.$$eval('[data-name="performance-chart-interaction-area"] [data-dg-own]', els => els.filter(e => /^[A-Z]{3}$/.test(e.textContent || '')).length)).toBe(0);
  // remembered after a reload
  await page.reload();
  await page.mouse.move(5, 5);
  await expect(lineSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect(layer(page)).toHaveCount(1);
  await lineSwitch(page).click();
  await expect(lineSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect(layer(page)).toHaveCount(0);
  await expect(cash(page)).toContainText('€ 26.876,16'); // today's cash stays
});

test('hovering other dates doesn\'t move the items along the row', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_P });
  await expect(cash(page)).toBeVisible();
  const xs = () => page.evaluate(() => ['dg-portfolio-change', 'dg-portfolio-cash'].map(id => Math.round(document.getElementById(id).getBoundingClientRect().left)));
  // DEGIRO shows the hovered value and date in place of the total and "Today"
  const show = (amount, caption) => page.evaluate(([a, c]) => {
    document.getElementById('total').textContent = a;
    document.querySelector('[data-name="performance-chart-caption"]').textContent = c;
  }, [amount, caption]);
  await show('€ 111.111,11', 'Today');
  await expect.poll(async () => (await xs())[0]).toBeGreaterThan(0);
  const before = await xs();
  for (const [a, c] of [['€ 99.888,00', 'Sep 28, 2026'], ['€ 140.000,00', 'May 1, 2026'], ['€ 101.000,00', 'Today']]) {
    await show(a, c);
    expect(await xs()).toEqual(before);
  }
});

test('stacked cash columns in the lower part of the chart: EUR green at the bottom, amounts added as they are', async ({ degiro }) => {
  const { page, calls } = await degiro({ url: URL_P, cashLines: true });
  await page.mouse.move(5, 5); // not hovering: the chart's line can be measured
  await expect(layer(page)).toHaveAttribute('data-dg-cash', 'EUR,USD,GBP'); // EUR first (bottom), then the largest

  // the statement is asked for the chart's own dates (DD/MM/YYYY), with DEGIRO's account
  const s = portfolioSeries('ONE_YEAR');
  const dmy = d => d.split('-').reverse().join('/');
  const q = new URL('https://x' + calls.lastStatementUrl).searchParams;
  expect([q.get('fromDate'), q.get('toDate'), q.get('intAccount'), q.get('sessionId')]).toEqual([dmy(s[s.length - 1].date), dmy(s[0].date), '42', 'TESTSID']);

  // the highest stack: EUR 30.000 + GBP 12,50 (USD 0 before August) is the top of the shared scale,
  // which spans the lower 40 % of the chart. On the last day: EUR 26.876,16 green, then USD 1.204 gold.
  const px = await page.evaluate(() => {
    const cv = /** @type {HTMLCanvasElement} */ (document.querySelector('canvas[data-dg-cash]'));
    const ctx = cv.getContext('2d'), dpr = cv.width / cv.getBoundingClientRect().width;
    const H = cv.getBoundingClientRect().height, base = H - 4, h = base * 0.4, hi = 30012.5;
    const X = 7 + (900 - 14);
    // the last column is narrow: take its most opaque pixel across a few, not an anti-aliased edge
    const at = y => {
      const d = ctx.getImageData(Math.round(X * dpr) - 3, Math.round(y * dpr), 7, 1).data;
      let best = [0, 0, 0, 0];
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > best[3]) best = [d[i], d[i + 1], d[i + 2], d[i + 3]];
      return best;
    };
    const eur = 26876.16 / hi * h;
    return { eur: at(base - eur / 2), usd: at(base - eur - (1204 / hi * h) / 2), above: at(base - h - 6) };
  });
  const near = (rgba, rgb) => rgba[3] > 100 && rgb.every((c, i) => Math.abs(rgba[i] - c) < 30);
  expect(near(px.eur, [7, 131, 7]), JSON.stringify(px)).toBe(true);
  expect(near(px.usd, [224, 161, 0]), JSON.stringify(px)).toBe(true);
  expect(px.above[3]).toBe(0); // nothing above the stack

  // our canvas doesn't confuse the drag-select, which reads DEGIRO's canvas
  const box = await page.locator('#c1').boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + 40); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + 40, { steps: 4 }); await page.mouse.up();
  await expect(page.locator('[data-name="performance-chart-interaction-area"] > div', { hasText: '→' })).toBeVisible();
});

test('the hover tooltip gets a row per currency with that day\'s cash, in DEGIRO\'s style', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_P, cashLines: true });
  await page.mouse.move(5, 5); // measured unhovered first
  await expect(layer(page)).toHaveCount(1);
  const box = await page.locator('#c1').boundingBox();
  const tip = page.locator('[data-name="performance-plot-tooltip"]');
  // the last day (after the October movements): today's balances
  await page.mouse.move(box.x + box.width - 7, box.y + 100);
  await expect(tip).toHaveAttribute('data-date', '2026-10-21');
  await expect(tipRows(page)).toHaveText(['Cash EUR€ 26.876,16', 'Cash USD$ 1.204,00', 'Cash GBP£ 12,50']);
  // the first day: EUR 30.000 (before May), no USD yet
  await page.mouse.move(box.x + 7, box.y + 100);
  const first = await tip.getAttribute('data-date');
  expect(first).toBe(portfolioSeries('ONE_YEAR').slice(-1)[0].date);
  await expect(tipRows(page)).toHaveText(['Cash EUR€ 30.000,00', 'Cash USD$ 0,00', 'Cash GBP£ 12,50']);
  // the rows sit under DEGIRO's "Portfolio value" row and copy its look
  const look = await page.evaluate(() => {
    const t = document.querySelector('[data-name="performance-plot-tooltip"]');
    const rows = [...t.children];
    return { order: rows.map(r => r.getAttribute('data-dg-cash-tip') || r.className), cls: rows.slice(2).map(r => r.className) };
  });
  expect(look.order).toEqual(['tipDate', 'tipRow', 'EUR', 'USD', 'GBP']);
  expect(look.cls).toEqual(['tipRow', 'tipRow', 'tipRow']);
  // columns switched off: no rows
  await page.mouse.move(5, 5);
  await lineSwitch(page).click();
  await expect(layer(page)).toHaveCount(0);
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await expect(tip).toBeVisible();
  await expect(tipRows(page)).toHaveCount(0);
});

test('a new period loads the statement for its dates', async ({ degiro }) => {
  const { page, calls } = await degiro({ url: URL_P, cashLines: true });
  await expect(layer(page)).toHaveCount(1);
  await page.click('[data-name="performance-period-switcher"] button:text-is("1 M")');
  const s = portfolioSeries('ONE_MONTH');
  const want = s[s.length - 1].date.split('-').reverse().join('/');
  await expect.poll(() => new URL('https://x' + calls.lastStatementUrl).searchParams.get('fromDate')).toBe(want);
  await expect(layer(page)).toHaveAttribute('data-dg-cash', 'EUR,USD,GBP'); // USD/GBP without movements in 1M still shown
});

test('follows its setting; hide-values mode blurs the amounts', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P, cashLines: true });
  await expect(cash(page)).toBeVisible();
  await page.evaluate(() => { document.getElementById('total').style.filter = 'blur(12px)'; });
  await expect.poll(() => page.$eval('#dg-portfolio-cash [data-currency="EUR"] span:last-child', el => getComputedStyle(el).filter)).toContain('blur');
  const opt = await settings();
  await setFlag(opt, 'portfolioCash', false);
  await expect(cash(page)).toHaveCount(0);
  await expect(layer(page)).toHaveCount(0);
  await expect(page.locator('#dg-portfolio-change')).toBeVisible(); // the other portfolio features stay
  // and back on: the amounts and the columns return
  await setFlag(opt, 'portfolioCash', true);
  await page.bringToFront();
  await page.mouse.move(5, 5);
  await expect(cash(page)).toHaveText(/^Cash.*€ 26\.876,16/);
  await expect(layer(page)).toHaveAttribute('data-dg-cash', 'EUR,USD,GBP');
});

test('orders don\'t take the session from the extension\'s own portfolio requests', async ({ degiro }) => {
  // portfolio.js keeps asking with the session of DEGIRO's chart request; once DEGIRO has moved on to
  // a new session, orders.js must keep DEGIRO's new one, not pick the old one up from our requests
  const { page, calls } = await degiro({
    url: URL_P, clock: true, cashLines: true,
    // the fake clock replaces performance.getEntriesByType, not PerformanceObserver: count with one
    initScript: () => {
      window.__seenCash = 0;
      new PerformanceObserver(l => l.getEntries().forEach(e => { if (e.name.includes('cashFunds')) window.__seenCash++; })).observe({ type: 'resource' });
    }
  });
  const step = what => async () => { await page.clock.fastForward(250); return calls[what]; };
  await expect.poll(step('cashFunds'), { timeout: 10000 }).toBe(1);
  await expect.poll(step('statement'), { timeout: 10000 }).toBe(1);
  // DEGIRO's next request carries a new session
  await page.evaluate(() => fetch('/mock/next/secure/x?intAccount=42&sessionId=NEWSID').then(r => r.text()));
  // a minute later portfolio.js asks for today's cash again, still with the chart request's session
  await page.clock.fastForward(61000);
  await expect.poll(step('cashFunds'), { timeout: 10000 }).toBe(2);
  expect(calls.lastCashFundsUrl).toContain(';jsessionid=TESTSID');
  // the extension's observers have seen it too: they run in the same task as this one
  await expect.poll(() => page.evaluate(() => window.__seenCash)).toBe(2);
  await page.evaluate(() => { location.hash = '#/products/123/overview'; });
  await expect.poll(step('update'), { timeout: 10000 }).toBeGreaterThan(0);
  expect(calls.lastUpdateUrl).toContain('/42;jsessionid=NEWSID?orders=0');
});

test('a chart hovered from the start gets its columns once the pointer leaves, up to its right edge', async ({ degiro, settings }) => {
  // DEGIRO greys the line right of the cursor while hovered: measured then, the line would seem to
  // end at the cursor and the columns would be squeezed into the left part of the chart
  const opt = await settings();
  for (const key of ['periodChange', 'chartSelect', 'portfolioCash']) await setFlag(opt, key, false); // nothing measures the chart yet
  const { page, calls } = await degiro({ url: URL_P, clock: true, cashLines: true });
  await page.waitForFunction(() => window.__points?.length > 0); // the chart is drawn
  const box = await page.locator('#c1').boundingBox();
  await page.mouse.move(box.x + box.width * 0.4, box.y + 40); // hovered before the extension measures
  await setFlag(opt, 'portfolioCash', true);
  await page.bringToFront();
  await expect.poll(async () => { await page.clock.fastForward(250); return calls.statement; }, { timeout: 10000 }).toBeGreaterThan(0);
  await advanceUntilVisible(page, cash(page)); // the cash data is in
  for (let i = 0; i < 6; i++) await page.clock.fastForward(500); // a few more of the feature's runs
  await expect(layer(page)).toHaveCount(0); // not drawn against the greyed line
  await page.mouse.move(5, 5);
  await advanceUntilVisible(page, layer(page));
  // the last column stands at the line's end (7 px in from the canvas edge), not at the old cursor
  const ends = await page.evaluate(() => {
    const cv = /** @type {HTMLCanvasElement} */ (document.querySelector('canvas[data-dg-cash]'));
    const ctx = cv.getContext('2d'), dpr = cv.width / cv.getBoundingClientRect().width, y = Math.round((cv.getBoundingClientRect().height - 6) * dpr);
    const alphaAt = x => Math.max(...[-2, -1, 0, 1, 2].map(dx => ctx.getImageData(Math.round(x * dpr) + dx, y, 1, 1).data[3]));
    return { end: alphaAt(900 - 7), past: alphaAt(900 - 2) };
  });
  expect(ends.end).toBeGreaterThan(0);
  expect(ends.past).toBe(0);
});
