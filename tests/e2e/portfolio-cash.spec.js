// Portfolio chart: today's cash per currency next to the total, and (with its switch) the cash as
// stacked columns on the chart plus a row per currency in DEGIRO's hover tooltip.
// Mock data: CASH_TODAY and CASH_MOVEMENTS in fixtures.js.
const { test, expect, setFlag, advanceUntilVisible, portfolioSeries, cashFundsApi } = require('./fixtures');

const URL_P = 'https://trader.degiro.nl/trader/?mock=portfolio#/portfolio';
const cash = page => page.locator('#dg-portfolio-cash');
const layer = page => page.locator('canvas[data-dg-cash]'); // data-dg-cash: the currencies, bottom up
const lineSwitch = page => page.locator('#dg-portfolio-cash [role="switch"]');
const tipRows = page => page.locator('[data-name="performance-plot-tooltip"] [data-dg-cash-tip]');
// the browser's local date: DEGIRO's line (and the mock's) ends with a point for it
const today = page => page.evaluate(() => { const t = new Date(), p = k => String(k).padStart(2, '0'); return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`; });

test('today\'s cash per currency follows the period change, zero balances left out', async ({ degiro }) => {
  const { page, calls } = await degiro({ url: URL_P });
  await expect(cash(page)).toHaveText(/^Cash.*€ 26\.876(?!,).*\$ 1\.204(?!,).*£ 13$/); // whole units, half away from zero
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
  await expect(cash(page)).toContainText(/€ 26\.876(?!,)/); // today's cash stays
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
  // (back to the total and "Today" when the pointer leaves the chart)
  for (const [a, c] of [['€ 99.888,00', 'Sep 28, 2026'], ['€ 140.000,00', 'May 1, 2026'], ['€ 111.111,11', 'Today']]) {
    await show(a, c);
    expect(await xs()).toEqual(before);
  }
});

test('stacked cash columns in the lower part of the chart: EUR green at the bottom, amounts added as they are', async ({ degiro }) => {
  const { page, calls } = await degiro({ url: URL_P, cashLines: true });
  await page.mouse.move(5, 5); // not hovering: the chart's line can be measured
  await expect(layer(page)).toHaveAttribute('data-dg-cash', 'EUR,USD,GBP'); // EUR first (bottom), then the largest

  // the statement is asked for the chart's own dates (DD/MM/YYYY), up to its point for today, with
  // DEGIRO's account
  const s = portfolioSeries('ONE_YEAR');
  const dmy = d => d.split('-').reverse().join('/');
  const q = new URL('https://x' + calls.lastStatementUrl).searchParams;
  expect([q.get('fromDate'), q.get('toDate'), q.get('intAccount'), q.get('sessionId')]).toEqual([dmy(s[s.length - 1].date), dmy(await today(page)), '42', 'TESTSID']);

  // the highest stack: EUR 30.000 + GBP 12,50 (USD 0 before August) is the top of the shared scale,
  // which spans the lower 40 % of the chart. On the last day: EUR 26.876 green, then USD 1.204 gold.
  const px = await page.evaluate(() => {
    const cv = /** @type {HTMLCanvasElement} */ (document.querySelector('canvas[data-dg-cash]'));
    const ctx = cv.getContext('2d'), dpr = cv.width / cv.getBoundingClientRect().width;
    const H = cv.getBoundingClientRect().height, base = H - 4, h = base * 0.4, hi = 30012.5;
    const X = window.__X(window.__points.length - 1); // the last drawn point: today
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

test('a total that comes in late: the statement waits for it and is asked for once, up to today', async ({ degiro }) => {
  const { page, calls } = await degiro({ url: URL_P, cashLines: true, initScript: () => { window.__MOCK_TOTAL = null; } });
  await page.mouse.move(5, 5);
  await expect(page.locator('#dg-portfolio-change')).toBeVisible(); // the chart data is in, the total not yet
  // elapsed time is what is tested here: the total comes 1,5 s after the data, within the wait
  await page.waitForTimeout(1500);
  expect(calls.statement).toBe(0);
  await page.evaluate(() => window.__setTotal(141234.56));
  await expect(layer(page)).toHaveAttribute('data-dg-cash', 'EUR,USD,GBP');
  const dmy = d => d.split('-').reverse().join('/');
  expect(new URL('https://x' + calls.lastStatementUrl).searchParams.get('toDate')).toBe(dmy(await today(page)));
  expect(calls.statement).toBe(1);
});

test('a total that never comes: the columns still come, over the endpoint\'s days', async ({ degiro }) => {
  const { page, calls } = await degiro({ url: URL_P, cashLines: true, initScript: () => { window.__MOCK_TOTAL = null; } });
  await page.mouse.move(5, 5);
  await expect(layer(page)).toHaveAttribute('data-dg-cash', 'EUR,USD,GBP', { timeout: 15000 }); // after the 5 s wait
  const s = portfolioSeries('ONE_YEAR'), dmy = d => d.split('-').reverse().join('/');
  expect(new URL('https://x' + calls.lastStatementUrl).searchParams.get('toDate')).toBe(dmy(s[0].date));
  expect(calls.statement).toBe(1);
});

test('the hover tooltip gets a row per currency with that day\'s cash, in DEGIRO\'s style', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_P, cashLines: true });
  await page.mouse.move(5, 5); // measured unhovered first
  await expect(layer(page)).toHaveCount(1);
  const box = await page.locator('#c1').boundingBox();
  const tip = page.locator('[data-name="performance-plot-tooltip"]');
  // the line's last point is today (after the October movements): today's balances
  await page.mouse.move(box.x + box.width - 7, box.y + 100);
  await expect(tip).toHaveAttribute('data-date', await today(page));
  await expect(tipRows(page)).toHaveText(['Cash EUR€ 26.876', 'Cash USD$ 1.204', 'Cash GBP£ 13']);
  // the point before it: the endpoint's last day
  const n = await page.evaluate(() => window.__points.length);
  await page.mouse.move(box.x + await page.evaluate(i => window.__X(i), n - 2), box.y + 100);
  await expect(tip).toHaveAttribute('data-date', '2026-10-21');
  await expect(tipRows(page)).toHaveText(['Cash EUR€ 26.876', 'Cash USD$ 1.204', 'Cash GBP£ 13']);
  // the left end: the first drawn day (DEGIRO doesn't draw the line's oldest day), EUR 30.000 (before
  // May), no USD yet
  await page.mouse.move(box.x + 7, box.y + 100);
  const first = await tip.getAttribute('data-date');
  expect(first).toBe(portfolioSeries('ONE_YEAR').slice(-2)[0].date);
  await expect(tipRows(page)).toHaveText(['Cash EUR€ 30.000', 'Cash USD$ 0', 'Cash GBP£ 13']);
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

test('the tooltip rows and the columns sit on the points DEGIRO draws, not half a step off', async ({ degiro }) => {
  // DEGIRO draws every day of its line but the oldest, at band centres half a step in from the
  // line's ends. Mapped edge to edge, the cash rows showed the previous day's cash for half of each
  // step, and every column stood half a step left of its point (one more for the undrawn oldest day).
  const { page, calls } = await degiro({ url: URL_P, cashLines: true });
  await expect(layer(page)).toHaveCount(1);
  await page.click('[data-name="performance-period-switcher"] button:text-is("1 M")'); // about 40 px between points
  const s = portfolioSeries('ONE_MONTH'), from = s[s.length - 1].date.split('-').reverse().join('/');
  await expect.poll(() => new URL('https://x' + calls.lastStatementUrl).searchParams.get('fromDate')).toBe(from);
  await page.mouse.move(5, 5); // not hovering: the chart's line can be measured
  const n = await page.evaluate(() => window.__points.length);
  expect(n).toBe(s.length + 1);
  const at = i => page.evaluate(i => window.__X(i), i);
  const xs = await Promise.all(Array.from({ length: n - 1 }, (_, k) => at(k + 1))); // the drawn points 1..n−1
  const step = xs[1] - xs[0];

  // a column per drawn point, centred on it; none for the line's oldest day
  const columns = () => page.evaluate(() => {
    const cv = /** @type {HTMLCanvasElement | null} */ (document.querySelector('canvas[data-dg-cash]'));
    if (!cv) return [];
    const ctx = cv.getContext('2d'), dpr = cv.width / cv.getBoundingClientRect().width;
    const d = ctx.getImageData(0, Math.round((cv.getBoundingClientRect().height - 6) * dpr), cv.width, 1).data;
    const out = [];
    let start = -1;
    for (let x = 0; x <= cv.width; x++) {
      const on = x < cv.width && d[x * 4 + 3] > 0;
      if (on && start < 0) start = x;
      if (!on && start >= 0) { out.push((start + x) / 2 / dpr); start = -1; }
    }
    return out; // centres, css px from the canvas's left (as the mock's line canvas)
  });
  await expect.poll(async () => (await columns()).length).toBe(n - 1);
  const centres = await columns();
  // (1,5 px: the line's measured extent ends at its last pixel, a pixel short of the line's end, which
  // adds up to about 1 px at the far end; half a step off would be about 20 px)
  centres.forEach((c, k) => expect(Math.abs(c - xs[k]), `column ${k + 1}`).toBeLessThanOrEqual(1.5));

  // hovered on either side of a point, the rows show that point's day: DEGIRO's tooltip's date.
  // The EUR balance moves on 15 Oct (€ 20.000 before it, € 26.876 from it).
  const box = await page.locator('#c1').boundingBox();
  const tip = page.locator('[data-name="performance-plot-tooltip"]');
  const i = await page.evaluate(() => window.__points.findIndex(p => p.date === '2026-10-15'));
  expect(i).toBeGreaterThan(1);
  for (const [k, date, eur] of [[i - 1, '2026-10-14', '€ 20.000'], [i, '2026-10-15', '€ 26.876']]) {
    for (const dx of [-0.35 * step, 0, 0.35 * step]) {
      await page.mouse.move(box.x + xs[k - 1] + dx, box.y + 100, { steps: 2 });
      await expect(tip).toHaveAttribute('data-date', date);
      await expect(tipRows(page), `${date} ${dx > 0 ? 'right of' : dx < 0 ? 'left of' : 'at'} its point`)
        .toHaveText([`Cash EUR${eur}`, 'Cash USD$ 1.204', 'Cash GBP£ 13']);
    }
  }
  // the left end: the first drawn day, as DEGIRO's tooltip shows
  await page.mouse.move(box.x + 2, box.y + 100, { steps: 2 });
  await expect(tip).toHaveAttribute('data-date', s[s.length - 2].date);
  await expect(tipRows(page)).toHaveText(['Cash EUR€ 20.000', 'Cash USD$ 1.204', 'Cash GBP£ 13']);
});

test('the undrawn oldest day neither adds a currency nor sets the columns\' scale', async ({ degiro }) => {
  // DEGIRO doesn't draw the line's oldest day. A statement where only that day has CHF, and the
  // highest stack (EUR 90.000): CHF gets no column, tooltip row or swatch, and the columns are scaled
  // to the highest drawn day (EUR 30.000 + GBP 12,50 on the first drawn day), not to the undrawn one.
  const s = portfolioSeries('ONE_YEAR'), day0 = s[s.length - 1].date, day1 = s[s.length - 2].date;
  const mv = (date, currency, total, change) => ({ id: 1, date: `${date}T12:00:00+02:00`, valueDate: date, description: 'x', currency,
    type: 'TRANSACTION', balance: { total, flatexCash: total, unsettledCash: 0 }, change });
  const movements = [ // newest first, like DEGIRO
    mv('2026-10-15', 'EUR', 26876.16, 6876.16),
    mv('2026-08-01', 'USD', 1204, 1204),
    mv('2026-05-01', 'EUR', 20000, -10000),
    mv(day1, 'CHF', 0, -500), mv(day1, 'EUR', 30000, -60000),
    mv(day0, 'CHF', 500, 500), mv(day0, 'EUR', 90000, 60000)
  ];
  const { page } = await degiro({ url: URL_P, cashLines: true, respond: u => u.pathname === '/portfolio-reports/secure/v6/accountoverview'
    ? { contentType: 'application/json', body: JSON.stringify({ data: { cashMovements: movements } }) } : undefined });
  await page.mouse.move(5, 5); // not hovering: the chart's line can be measured
  await expect(layer(page)).toHaveAttribute('data-dg-cash', 'EUR,USD,GBP'); // no CHF
  await expect(cash(page).locator('[data-currency]')).toHaveCount(3);
  await expect(cash(page).locator('[data-currency="CHF"]')).toHaveCount(0);

  // the first drawn day's stack is the highest drawn one: it reaches the top of the columns' lower 40 %
  const col = await page.evaluate(() => {
    const cv = /** @type {HTMLCanvasElement} */ (document.querySelector('canvas[data-dg-cash]'));
    const ctx = cv.getContext('2d'), dpr = cv.width / cv.getBoundingClientRect().width;
    const base = cv.getBoundingClientRect().height - 4;
    const d = ctx.getImageData(Math.floor(window.__X(1) * dpr), 0, 1, cv.height).data;
    let y = 0;
    while (y < cv.height && d[y * 4 + 3] === 0) y++;
    return { top: y / dpr, want: base - base * 0.4 };
  });
  expect(Math.abs(col.top - col.want), JSON.stringify(col)).toBeLessThanOrEqual(2);

  // the tooltip at the first drawn day: no CHF row
  const box = await page.locator('#c1').boundingBox();
  await page.mouse.move(box.x + 7, box.y + 100);
  await expect(page.locator('[data-name="performance-plot-tooltip"]')).toHaveAttribute('data-date', day1);
  await expect(tipRows(page)).toHaveText(['Cash EUR€ 30.000', 'Cash USD$ 0', 'Cash GBP£ 13']);
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
  await expect(cash(page)).toHaveText(/^Cash.*€ 26\.876(?!,)/);
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
  // the last column stands at the line's last point (half a step in from its end, 7 px in from the
  // canvas edge), not at the old cursor
  const ends = await page.evaluate(() => {
    const cv = /** @type {HTMLCanvasElement} */ (document.querySelector('canvas[data-dg-cash]'));
    const ctx = cv.getContext('2d'), dpr = cv.width / cv.getBoundingClientRect().width, y = Math.round((cv.getBoundingClientRect().height - 6) * dpr);
    const alphaAt = x => Math.max(...[-2, -1, 0, 1, 2].map(dx => ctx.getImageData(Math.round(x * dpr) + dx, y, 1, 1).data[3]));
    return { end: alphaAt(window.__X(window.__points.length - 1)), past: alphaAt(900 - 2) };
  });
  expect(ends.end).toBeGreaterThan(0);
  expect(ends.past).toBe(0);
});

// the page's localStorage outlives a test in a reused browser: start with the columns off
const linesOff = () => { try { localStorage.removeItem('dgTweaksCashLines'); } catch (e) {} };

test('the switch stays reachable when today\'s cash can\'t be loaded', async ({ degiro }) => {
  const { page, calls } = await degiro({ url: URL_P, initScript: linesOff, respond: u => u.searchParams.has('cashFunds') ? { status: 500, body: '' } : undefined });
  await expect(lineSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect(cash(page)).toHaveText('Cash');
  expect(calls.cashFunds).toBeGreaterThan(0);
  // switched on: the columns and the amounts come from the account statement
  await page.mouse.move(5, 5);
  await lineSwitch(page).click();
  await page.mouse.move(5, 5);
  await expect(lineSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => calls.statement).toBe(1);
  // (GBP has no movements in the period: only today's cash would show it)
  await expect(layer(page)).toHaveAttribute('data-dg-cash', 'EUR,USD');
  await expect(cash(page)).toContainText(/€ 26\.876(?!,)/);
});

test('the switch stays reachable when every balance is 0', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_P, initScript: linesOff, respond: u => u.searchParams.has('cashFunds')
    ? { status: 201, contentType: 'application/json', body: JSON.stringify(cashFundsApi({ EUR: 0, USD: 0 })) } : undefined });
  await expect(lineSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect(cash(page)).toHaveText('Cash');
  await expect(cash(page).locator('[data-currency]')).toHaveCount(0);
});

test('hovering with the columns off doesn\'t look for tooltip rows', async ({ degiro }) => {
  const { page } = await degiro({
    url: URL_P, cashLines: true,
    initScript: () => {
      window.__tipQueries = 0;
      const qsa = Document.prototype.querySelectorAll;
      Document.prototype.querySelectorAll = function (s) { if (String(s).includes('data-dg-cash-tip')) window.__tipQueries++; return qsa.call(this, s); };
    }
  });
  await page.mouse.move(5, 5);
  await expect(layer(page)).toHaveCount(1);
  const box = await page.locator('#c1').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 100); // the tooltip listener is attached
  await expect(tipRows(page)).toHaveCount(3);
  await page.mouse.move(5, 5);
  await lineSwitch(page).click();
  await expect(layer(page)).toHaveCount(0);
  await expect(tipRows(page)).toHaveCount(0);
  await page.evaluate(() => { window.__tipQueries = 0; });
  // a fixed number of hovered frames: each move waits for the next frame
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(box.x + box.width * i / 12, box.y + 100);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  await expect(page.locator('[data-name="performance-plot-tooltip"]')).toBeVisible();
  expect(await page.evaluate(() => window.__tipQueries)).toBe(0);
});

test('the longest date of the year is measured once, not on every run', async ({ degiro }) => {
  const { page } = await degiro({
    url: URL_P, clock: true,
    initScript: () => {
      window.__dates = 0;
      const f = Date.prototype.toLocaleDateString;
      Date.prototype.toLocaleDateString = function (...a) { if (/portfolio\.js/.test(new Error().stack || '')) window.__dates++; return f.apply(this, a); };
    }
  });
  await advanceUntilVisible(page, cash(page));
  await expect.poll(() => page.evaluate(() => window.__dates)).toBe(12);
  for (let i = 0; i < 6; i++) await page.clock.fastForward(500); // more of the feature's runs
  expect(await page.evaluate(() => window.__dates)).toBe(12);
});

test('the cash and the period change next to the total are in whole units, negative balances too; the percentage keeps its cents', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_P, initScript: linesOff, respond: u => u.searchParams.has('cashFunds')
    ? { status: 201, contentType: 'application/json', body: JSON.stringify(cashFundsApi({ EUR: -15253.66, USD: 31049.19, GBP: 1000.5 })) } : undefined });
  await expect(cash(page).locator('[data-currency]')).toHaveText(['€ -15.254', '$ 31.049', '£ 1.001']);
  await expect(page.locator('#dg-portfolio-change')).toHaveText(/€ [+-][\d.]+ \([+-]\d+,\d\d%\)$/);
});

// DEGIRO's own "Portfolio value" in its hover tooltip, in whole units like the cash rows under it
const tipValue = page => page.locator('[data-name="performance-plot-tooltip"] .tipRow:not([data-dg-cash-tip]) .tipValue');
const wholeAt = date => '€ ' + Math.round(portfolioSeries('ONE_YEAR').find(p => p.date === date).value).toLocaleString('nl-NL');
const CENTS = /,\d\d$/;

test('the tooltip\'s portfolio value is in whole units, never painted with cents; the total, max/min and announcement keep theirs', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_P, cashLines: true });
  await page.mouse.move(5, 5); // measured unhovered first
  await expect(layer(page)).toHaveCount(1);
  const box = await page.locator('#c1').boundingBox();
  const tip = page.locator('[data-name="performance-plot-tooltip"]');
  // what each frame paints: sampled just before painting, after DEGIRO's update and ours
  await page.evaluate(() => {
    window.__painted = [];
    const sample = () => {
      const v = document.querySelector('[data-name="performance-plot-tooltip"] .tipRow:not([data-dg-cash-tip]) .tipValue');
      if (v) window.__painted.push(v.textContent);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  // a fixed number of moves along the line, each to another day
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(box.x + box.width * i / 13, box.y + 100, { steps: 3 });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const date = await tip.getAttribute('data-date');
    await expect(tipValue(page)).toHaveText(wholeAt(date));
  }
  const painted = await page.evaluate(() => window.__painted);
  expect(painted.length).toBeGreaterThan(12);
  expect(painted.filter(t => CENTS.test(t))).toEqual([]);
  expect(new Set(painted).size).toBeGreaterThan(6); // it really followed the pointer
  // the cash rows are still added under it, and the label is DEGIRO's
  await expect(tipRows(page)).toHaveCount(3);
  await expect(tip.locator('.tipRow:not([data-dg-cash-tip]) .tipLabel')).toHaveText('Portfolio value');
  // everything else keeps its cents
  await expect(page.locator('[data-name="performance-chart-amount"]')).toHaveText(CENTS);
  await expect(page.locator('[data-name="performance-plot-max"]')).toHaveText(CENTS);
  await expect(page.locator('[data-name="performance-plot-min"]')).toHaveText(CENTS);
  await expect(page.locator('[data-name="performance-plot-announcement"]')).toHaveText(CENTS);
});

test('the tooltip\'s whole units follow the cash setting, and come back on a rebuilt chart', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  await expect(cash(page)).toBeVisible();
  const box = await page.locator('#c1').boundingBox();
  const tip = page.locator('[data-name="performance-plot-tooltip"]');
  const hover = async f => {
    await page.mouse.move(5, 5);
    await page.mouse.move(box.x + box.width * f, box.y + 100);
    return tip.getAttribute('data-date');
  };
  await expect(tipValue(page)).toHaveCount(0);
  let date = await hover(0.4);
  await expect(tipValue(page)).toHaveText(wholeAt(date));
  // off: DEGIRO's text with cents
  const opt = await settings();
  await setFlag(opt, 'portfolioCash', false);
  await page.bringToFront();
  await expect(cash(page)).toHaveCount(0);
  date = await hover(0.6);
  const s = portfolioSeries('ONE_YEAR');
  const cents = '€ ' + s.find(p => p.date === date).value.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  await expect(tipValue(page)).toHaveText(cents);
  // back on
  await setFlag(opt, 'portfolioCash', true);
  await page.bringToFront();
  await expect(cash(page)).toBeVisible();
  date = await hover(0.5);
  await expect(tipValue(page)).toHaveText(wholeAt(date));
  // DEGIRO builds a new chart when Portfolio is reached from another page
  await page.mouse.move(5, 5);
  await page.evaluate(() => { location.hash = '#/favourites'; });
  await expect(page.locator('[data-name="performance-chart"]')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/portfolio'; });
  await expect(page.locator('[data-name="performance-chart-interaction-area"][data-dg-sel]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => !!window.__points)).toBe(true);
  date = await hover(0.3);
  await expect(tipValue(page)).toHaveText(wholeAt(date));
});
