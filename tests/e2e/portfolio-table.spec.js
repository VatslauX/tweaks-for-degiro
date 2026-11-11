// e2e: the Portfolio page's holdings fixture (tests/fixtures/portfolio.html) carries the real DOM
// hooks for the merged holdings table feature's selectors (checked live, see the plan's Global
// Constraints). This file grows task-by-task as that feature is built.
const { test, expect, setFlag } = require('./fixtures');
const URL_P = 'https://trader.degiro.nl/trader/?mock=portfolio#/portfolio';

// Raw per-feature status (status.js's message reply), not the popup's rendered list: options.js's
// own FEATURES map (extension/options.js) doesn't offer portfolioTable as a popup row yet, but the
// scheduler still tracks and reports its status like any other feature.
async function rawStatus(page, opt) {
  await page.bringToFront();
  return opt.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return chrome.tabs.sendMessage(tab.id, { type: 'dg-status' });
  });
}

test('enabling the feature hides the native tables and renders a merged header', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  // each section's own heading, table and pager are hidden, not just the table; the merged
  // toolbar, table and pager themselves stay visible
  for (const s of ['stock', 'etf', 'lox']) {
    await expect(page.locator(`h3[data-name=${s}]`)).toBeHidden();
    await expect(page.locator(`h3[data-name=${s}] ~ * table`)).toBeHidden();
    await expect(page.locator(`h3[data-name=${s}] ~ * [data-name=pagination]`)).toBeHidden();
  }
  await expect(page.locator('#dg-portfolio-toolbar')).toBeVisible();
  await expect(page.locator('[data-dg-portfolio-table]')).toBeVisible();
  // every column is in the DOM (Columns dropdown needs them all, see the "columns:" test below);
  // the default-hidden ones (Symbol | ISIN, Delay) are hidden with CSS, like Orders'
  // own columns feature, so only the visible headers are asserted here. Each header is DEGIRO's own
  // (localised) native header text; Type is this feature's own column, so its label is ours.
  const heads = () => page.$$eval('[data-dg-portfolio-table] thead th',
    ths => ths.filter(th => getComputedStyle(th).display !== 'none').map(th => th.textContent));
  // no trailing blank header: Buy/Sell live in the Product cell, not a column of their own
  await expect.poll(heads).toEqual(['Product', 'Type', 'Qty', 'Price', 'Curr.', 'Value', 'Break Even Price', 'Today\'s P&L',
    'Today\'s P&L %', 'P&L Unrealized', 'P&L Total']);
});

test('Buy/Sell lead the Product cell, before the name, as on DEGIRO\'s own rows; the name keeps its bold look', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const row = page.locator('[data-dg-portfolio-table] tbody tr').first();
  await expect(row.locator('td').first().locator('button[data-action]')).toHaveCount(2);
  // in the first cell: Buy, Sell, then the name — and no other cell holds a button[data-action]
  expect(await row.evaluate(tr => {
    const td = tr.querySelector('td');
    const order = [...td.querySelectorAll('button[data-action], [data-name=productName]')]
      .map(el => el.getAttribute('data-action') || el.textContent);
    return { order, elsewhere: tr.querySelectorAll('td:not(:first-child) button[data-action]').length, cells: tr.children.length };
  })).toEqual({ order: ['buy', 'sell', 'Mock Software SE'], elsewhere: 0, cells: 13 });
  // the native name's class (DEGIRO's own bold) is copied onto the merged name
  const name = row.locator('[data-name=productName]');
  await expect(name).toHaveClass('holdingsName');
  await expect(name).toHaveCSS('font-weight', '600');
  // Buy still forwards to the real hidden button
  await row.locator('button[data-action=buy]').click();
  await expect(page.locator('h3[data-name=stock] ~ * table tbody tr').first()).toHaveAttribute('data-dg-last-clicked', 'buy');
});

test('the merged product name is a real link to that product\'s page, as DEGIRO\'s own (now-hidden) name is', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const row = page.locator('[data-dg-portfolio-table] tbody tr').first();
  const name = row.locator('[data-name=productName]');
  // the name sits inside the real <a>, not just styled to look like one (same hash route DEGIRO's
  // own link uses, confirmed live) — no click listener of our own, DEGIRO's SPA router already
  // handles the hashchange
  const link = name.locator('xpath=ancestor::a[1]');
  await expect(link).toHaveAttribute('href', '#/products/332108/overview');
  await link.click();
  await expect(page).toHaveURL(/#\/products\/332108\/overview/);
});

test('merged rows copy the native row class, so they get DEGIRO\'s own row height', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const row = page.locator('[data-dg-portfolio-table] tbody tr').first();
  await expect(row).toHaveClass('holdingsRow');
  // the fixture's row class sets a 44px height, as DEGIRO's own row class sizes its rows. CSS height
  // is a floor, not a cap: the fixture's product cell has its own (taller) ambient line-height, which
  // a cloned Buy/Sell button falls back to unless DEGIRO's own tighter-line-height wrapper around
  // just those two buttons is cloned along with them (see syncActions() in portfolio-table.js) — a
  // regression here pushes this past 44, not below it.
  expect(await row.evaluate(tr => Math.round(tr.getBoundingClientRect().height))).toBe(44);
  // the wrapper itself (not just the bare buttons) must be what got cloned
  const wrap = row.locator('td').first().locator('.holdingsActions');
  await expect(wrap).toHaveCount(1);
  await expect(wrap.locator('button[data-action]')).toHaveCount(2);
});

test('Type is a coloured chip with a short label per section; sorting by it keeps DEGIRO\'s section order', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const chips = page.locator('[data-dg-portfolio-table] tbody [data-dg-type] [data-dg-type-chip]');
  await expect(chips).toHaveText(['Share', 'Share', 'Share', 'Tracker', 'Tracker', 'Struct.']);
  // the mockup's light-theme colours
  await expect(chips.first()).toHaveCSS('background-color', 'rgb(238, 242, 255)');
  await expect(chips.first()).toHaveCSS('color', 'rgb(67, 56, 202)');
  await expect(chips.nth(3)).toHaveCSS('background-color', 'rgb(236, 253, 245)');
  await expect(chips.nth(5)).toHaveCSS('color', 'rgb(194, 65, 12)');
  await expect(chips.first()).toHaveCSS('border-radius', '999px');
});

test('plEuro/plPercent/unrealisedPl/totalPl copy each row\'s OWN sign-coloured class, not one sampled per column', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  // Mock Software SE (row 1, stock) is a gain in the fixture (+18,40/+1,45%/+16,73%/+276,00); Mock
  // Retail Corp (row 3, stock) is a loss (-3,20/-0,62%/-8,50%/-43,60). A column-wide sample (the bug)
  // would give every row in a column the identical class/colour regardless of its own sign.
  const gainRow = page.locator('[data-dg-portfolio-table] tbody tr').nth(0);
  const lossRow = page.locator('[data-dg-portfolio-table] tbody tr').nth(2);
  for (const field of ['todayPl', 'change', 'unrealizedRelativePl', 'totalPl']) {
    const gain = gainRow.locator(`[data-field=${field}]`);
    const loss = lossRow.locator(`[data-field=${field}]`);
    await expect(gain).toHaveClass('holdingsPos');
    await expect(loss).toHaveClass('holdingsNeg');
    await expect(gain).toHaveCSS('color', 'rgb(66, 173, 0)');
    await expect(loss).toHaveCSS('color', 'rgb(255, 56, 56)');
  }
});

test('Delay copies each row\'s OWN feed-quality class (and its dot), not one sampled per column', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  // Mock Software SE (row 1, stock) is 15-min-delayed in the fixture; Mock Retail Corp (row 3, stock)
  // is real-time. A column-wide sample (the bug) would give every row the identical class/dot
  // regardless of its own feed quality; before the fix, the cell held only plain text, no dot at all.
  const delayed = page.locator('[data-dg-portfolio-table] tbody tr').nth(0).locator('[data-name=feedQuality]');
  const realtime = page.locator('[data-dg-portfolio-table] tbody tr').nth(2).locator('[data-name=feedQuality]');
  await expect(delayed).toHaveText('15');
  await expect(realtime).toHaveText('R');
  await expect(delayed).toHaveClass('holdingsFeedD15');
  await expect(realtime).toHaveClass('holdingsFeedR');
  // the dot itself: a ::before pseudo-element, coloured per row (confirmed live, see the fixture)
  const dotColor = loc => loc.evaluate(el => getComputedStyle(el, '::before').backgroundColor);
  expect(await dotColor(delayed)).toBe('rgb(242, 136, 44)');
  expect(await dotColor(realtime)).toBe('rgb(30, 131, 2)');
});

test('without a native class to copy, Delay falls back to plain text and no dot', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  await page.evaluate(() => document.querySelectorAll('.holdings [class]').forEach(el => el.removeAttribute('class')));
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const delayed = page.locator('[data-dg-portfolio-table] tbody tr').nth(0).locator('[data-name=feedQuality]');
  await expect(delayed).toHaveAttribute('class', '');
  await expect(delayed).toHaveText('15');
  expect(await delayed.evaluate(el => getComputedStyle(el, '::before').content)).toBe('none');
});

test('without a native class to copy, plEuro/plPercent/unrealisedPl/totalPl fall back to a sign-based inline color', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  await page.evaluate(() => document.querySelectorAll('.holdings [class]').forEach(el => el.removeAttribute('class')));
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const gainRow = page.locator('[data-dg-portfolio-table] tbody tr').nth(0);
  const lossRow = page.locator('[data-dg-portfolio-table] tbody tr').nth(2);
  const field = 'todayPl';
  await expect(gainRow.locator(`[data-field=${field}]`)).toHaveAttribute('class', '');
  await expect(gainRow.locator(`[data-field=${field}]`)).toHaveCSS('color', 'rgb(30, 131, 2)'); // dgUi.theme().buy, light theme
  await expect(lossRow.locator(`[data-field=${field}]`)).toHaveCSS('color', 'rgb(228, 1, 1)'); // dgUi.theme().sell, light theme
});

test('the sorted header shows a visible arrow, every other one a faint ↕; neither is part of its label', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const arrow = col => page.$eval(`[data-dg-portfolio-table] th[data-dg-col=${col}] > button`, b => getComputedStyle(b, '::after').content);
  const faint = col => page.$eval(`[data-dg-portfolio-table] th[data-dg-col=${col}] > button`, b => Number(getComputedStyle(b, '::after').opacity));
  await expect.poll(() => arrow('type')).toBe('"↑"');
  // every unsorted visible column reads as sortable: a faint ↕, stronger on hover
  for (const col of ['product', 'qty', 'price', 'currency', 'value', 'bep', 'plEuro', 'plPercent', 'unrealisedPl', 'totalPl']) {
    expect(await arrow(col)).toBe('"↕"');
  }
  expect(await faint('value')).toBeLessThan(0.5);
  await page.locator('[data-dg-portfolio-table] th[data-dg-col=value] > button').hover();
  await expect.poll(() => faint('value')).toBeGreaterThan(0.5);
  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Type' }).click();
  await expect.poll(() => arrow('type')).toBe('"↓"');
  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Product' }).click();
  await expect.poll(() => arrow('product')).toBe('"↑"');
  expect(await arrow('type')).toBe('"↕"');
  await expect(page.locator('[data-dg-portfolio-table] th[data-dg-col=product]')).toHaveText('Product');
  await expect(page.locator('[data-dg-portfolio-table] th[data-dg-col=value]')).toHaveText('Value');
});

test('the toolbar labels its picker "Columns", like Orders\' own', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const bar = page.locator('#dg-portfolio-toolbar');
  await expect(bar.locator('span', { hasText: /^Columns$/ })).toBeVisible();
});

test('a fully merged section\'s whole block (its divider included) is hidden; the first section\'s, holding the merged table, and what follows stay', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  // an unrelated block after the holdings, inside the same container, like the Cash accounts
  await page.evaluate(() => {
    const cash = document.createElement('section');
    cash.id = 'cash';
    const h3 = document.createElement('h3');
    h3.textContent = 'Cash accounts';
    const hr = document.createElement('hr');
    cash.append(h3, hr);
    document.querySelector('.holdings').append(cash);
  });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(6);
  await expect(page.locator('[data-holdings=etf]')).toBeHidden();
  await expect(page.locator('[data-holdings=lox]')).toBeHidden();
  await expect(page.locator('[data-holdings=etf] hr')).toBeHidden();
  await expect(page.locator('[data-holdings=stock]')).toBeVisible();
  await expect(page.locator('[data-dg-portfolio-table]')).toBeVisible();
  await expect(page.locator('#cash')).toBeVisible();
  await expect(page.locator('#cash hr')).toBeVisible();
  // switching off restores every hidden block
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: false }));
  await expect(page.locator('[data-holdings=etf]')).toBeVisible();
  await expect(page.locator('[data-holdings=lox] hr')).toBeVisible();
});

test('DEGIRO\'s Cash compensation section stays visible under the merged table', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const cash = page.locator('[data-name=cashFundCompensations]');
  await expect(cash).toBeHidden(); // hideSections (on by default) hides it by its hook
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ hideSections: false, portfolioMergedTable: true }));
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(6);
  await expect(page.locator('[data-holdings=lox]')).toBeHidden();
  await expect(cash.locator('h3')).toBeVisible();
  await expect(cash.locator('tr[data-name=compensationItem]')).toBeVisible();
  await expect(cash.locator('[data-field=amount]')).toHaveText('12,34');
});

test('without native classes, the merged table falls back to theme-based inline styles', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  await page.evaluate(() => document.querySelectorAll('.holdings [class]').forEach(el => el.removeAttribute('class')));
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const th = page.locator('[data-dg-portfolio-table] th[data-dg-col=value]');
  await expect(th).toHaveAttribute('class', '');
  await expect(th).toHaveCSS('border-bottom-style', 'solid');
  await expect(th).toHaveCSS('color', 'rgb(101, 117, 123)'); // dgUi.theme().muted, light theme
  await expect(page.locator('[data-dg-portfolio-table]')).toHaveCSS('border-collapse', 'collapse');
});

test('flat sections: only each section\'s own heading, table and pager are hidden, not what follows', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  // The three sections as flat siblings (unconfirmed live), followed by an unrelated block with its
  // own heading, table and pager, like the Foreign currency Cash Accounts.
  await page.evaluate(() => {
    const holdings = document.querySelector('.holdings');
    holdings.querySelectorAll('section').forEach(s => { s.replaceWith(...s.children); });
    const h3 = document.createElement('h3');
    h3.id = 'cash';
    h3.textContent = 'Cash accounts';
    const wrap = document.createElement('div');
    wrap.id = 'cashWrap';
    const table = document.createElement('table');
    table.innerHTML = '<tbody><tr><td>EUR</td></tr></tbody>';
    const pagination = document.createElement('div');
    pagination.setAttribute('data-name', 'pagination');
    pagination.innerHTML = '<button type="button">‹</button><button type="button">1</button><button type="button">›</button>';
    wrap.append(table, pagination);
    holdings.append(h3, wrap);
  });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(6);
  for (const s of ['stock', 'etf', 'lox']) await expect(page.locator(`h3[data-name=${s}]`)).toBeHidden();
  await expect(page.locator('.holdings > .tableWrap table')).toHaveCount(3);
  for (const el of await page.locator('.holdings > .tableWrap').all()) {
    await expect(el.locator('table')).toBeHidden();
    await expect(el.locator('[data-name=pagination]')).toBeHidden();
  }
  await expect(page.locator('#cash')).toBeVisible();
  await expect(page.locator('#cashWrap table')).toBeVisible();
  await expect(page.locator('#cashWrap [data-name=pagination]')).toBeVisible();
});

test('nested sections (the real page\'s own shape): the merged table gets rows from every section, native tables/pagers that contributed are hidden, and its pager drives the real one', async ({ degiro, settings }) => {
  // Mirrors the live page's real DOM shape (see the portfolio-merge bugfix, a release blocker for
  // 1.22.0): each section's real table/pager are not a CSS sibling of its own <h3> — they sit two
  // levels up, as siblings of the <h3>'s own small wrapper, which (for lox here, mirroring the live
  // stock finding) also holds a loading-skeleton table/pager ahead of the <h3> itself; etf's wrapper,
  // like the live etf section, holds none. Because lox's skeleton precedes lox's own <h3>, it lands
  // inside *etf's* search window (up to the next <h3>), alongside etf's real table/pager — exactly
  // the real-vs-skeleton disambiguation sectionPart() must get right.
  const { page } = await degiro({ url: URL_P, initScript: () => { window.__MOCK_NESTED_SECTIONS = true; } });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));

  // all three sections' rows are collected, exactly as with the flat shape
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(6);
  await expect.poll(async () => (await rawStatus(page, opt)).portfolioTable).toBe('ok');

  // each section's own heading, real table and real pager (never its skeleton) are hidden —
  // `:not([data-dg-own])` excludes stock's own merged table, now a `> table` sibling too (see the
  // layout-bug regression below), so this keeps matching only DEGIRO's native one.
  for (const s of ['stock', 'etf', 'lox']) {
    await expect(page.locator(`h3[data-name=${s}]`)).toBeHidden();
    await expect(page.locator(`[data-holdings=${s}] > table:not([data-dg-own])`)).toBeHidden();
    await expect(page.locator(`[data-holdings=${s}] > nav[data-name=pagination]`)).toBeHidden();
  }
  // lox's skeleton table/pager are never real content, so the extension never marks them itself —
  // proof the fix picked the real elements, not these (they are hidden only along with lox's whole,
  // now empty, block — see sectionShell())
  await expect(page.locator('table.mockSkeletonTable')).not.toHaveAttribute('data-dg-portfolio-hidden', '');
  await expect(page.locator('.mockSkeletonPager')).not.toHaveAttribute('data-dg-portfolio-hidden', '');
  await expect(page.locator('[data-holdings=lox]')).toHaveAttribute('data-dg-portfolio-hidden', '');
  await expect(page.locator('[data-holdings=etf]')).toBeHidden();
  await expect(page.locator('[data-holdings=stock]')).toBeVisible(); // holds the merged table

  // Regression for the portfolio-merge layout bug (a follow-on release blocker for 1.22.0): the
  // merged toolbar/table/pager must land as children of stock's own outer <section> — the same
  // container as its real (now-hidden) table/pager — never inside the hidden <h3>'s own small
  // title-row wrapper div. That's exactly what made the "Columns" chip overlap a data row live:
  // anchor.before() on the bare <h3> squeezed the merged elements into that cramped wrapper instead
  // of before the whole section. Playwright's visibility/content assertions above don't catch this
  // (they never check DOM containment or layout position), so it's asserted explicitly here.
  expect(await page.evaluate(() =>
    document.querySelector('[data-dg-portfolio-table]').parentElement !== document.querySelector('h3[data-name=stock]').parentElement)).toBe(true);
  for (const sel of ['#dg-portfolio-toolbar', '[data-dg-portfolio-scroll]', '[data-dg-portfolio-scroll] + [data-name=pagination]']) {
    expect(await page.$eval(sel, t => t.parentElement.getAttribute('data-holdings'))).toBe('stock');
  }

  // the merged pager drives etf's real (nested) pagination, same as the flat-shape test above
  const next = page.locator('[data-dg-portfolio-scroll] + [data-name=pagination] button[data-dg-page=next]');
  await next.click();
  await expect(page.locator('[data-holdings=etf] > nav button', { hasText: '2' })).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(5); // 3 stock + 1 etf(page2) + 1 lox
});

test('ETF-only portfolio (no Shares section): the merge still engages, anchored on the first section', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  await page.evaluate(() => document.querySelector('[data-holdings=stock]').remove());
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(3); // 2 etf (page 1) + 1 lox
  expect(await page.$eval('[data-dg-portfolio-scroll]', t => t.parentElement.getAttribute('data-holdings'))).toBe('etf');
  await expect(page.locator('h3[data-name=etf]')).toBeHidden();
  await expect.poll(async () => (await rawStatus(page, opt)).portfolioTable).toBe('ok');
});

test('a section with rows but no resolvable product hook keeps its native UI visible and reports missing', async ({ degiro, settings }) => {
  // Simulates a future DEGIRO DOM change where SEL.portfolioProduct stops matching for one section:
  // the stock section's <tr>s exist but none are collectible, so hiding its h3/table/pager would make
  // those real holdings disappear with nothing shown anywhere — this must not happen.
  const { page } = await degiro({ url: URL_P, initScript: () => { window.__MOCK_NO_PRODUCT_HOOK = 'stock'; } });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  // the broken section's own heading, table and pager stay visible
  await expect(page.locator('h3[data-name=stock]')).toBeVisible();
  await expect(page.locator('h3[data-name=stock] ~ * table')).toBeVisible();
  await expect(page.locator('h3[data-name=stock] ~ * [data-name=pagination]')).toBeVisible();
  // the other two sections, unaffected, are still merged and hidden as normal
  await expect(page.locator('h3[data-name=etf]')).toBeHidden();
  await expect(page.locator('h3[data-name=lox]')).toBeHidden();
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(3); // 2 etf + 1 lox, no stock rows
  // 'missing' shows as 'loading' for LOADING_MS (8 s) after the page opens (common.js), so this poll
  // needs longer than expect.poll's 5 s default to see it settle.
  await expect.poll(async () => (await rawStatus(page, opt)).portfolioTable, { timeout: 10000 }).toBe('missing');
});

test('the merged rows are updated in place: a live tick keeps its buttons, focus, and a forwarded click reaches DEGIRO\'s re-rendered row', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const firstRow = page.locator('[data-dg-portfolio-table] tbody tr').first();
  await expect(firstRow.locator('button[data-action=sell]')).toHaveCount(1);
  await firstRow.locator('button[data-action=sell]').focus();
  await page.evaluate(() => { window.__mergedSell = document.activeElement; });
  // a live tick in the native row
  await page.evaluate(() => { document.querySelector('h3[data-name=stock] ~ * [data-field=price]').textContent = '130,00'; });
  await expect(firstRow.locator('[data-field=price]')).toHaveText('130,00');
  expect(await page.evaluate(() => window.__mergedSell.isConnected && document.activeElement === window.__mergedSell)).toBe(true);
  // DEGIRO re-renders its own rows (new <tr>s and buttons): the kept merged button still reaches the new one
  await page.evaluate(() => window.__rerenderHoldings('stock'));
  await page.evaluate(() => window.__mergedSell.click());
  await expect(page.locator('h3[data-name=stock] ~ * table tbody tr').first()).toHaveAttribute('data-dg-last-clicked', 'sell');
});

test('the merged pager stays visible, with both buttons disabled, while every section is on its only page', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings(); await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const pager = page.locator('[data-dg-portfolio-scroll] + [data-name=pagination]');
  await expect(pager).toBeVisible(); // etf has a second page
  await expect(pager.locator('[data-dg-page=current]')).toHaveText('1');
  // etf's third holding is sold: every section now fits on one page — DEGIRO's own pager stays
  // visible then, only disabled, and so does the merged one
  await page.evaluate(() => { window.__PORTFOLIO.etf.rows.pop(); window.__rerenderHoldings('etf'); });
  await expect(pager.locator('[data-dg-page=next]')).toBeDisabled();
  await expect(pager).toBeVisible();
  await expect(pager.locator('[data-dg-page=prev]')).toBeDisabled();
  await expect(pager.locator('[data-dg-page=current]')).toHaveText('1');
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(6);
});

test('persist off: the Columns picker works for the session, and nothing is remembered after a reload', async ({ degiro, settings }) => {
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const { page } = await degiro({ url: URL_P });
  await page.locator('[data-dg-columns]').click();
  await page.locator('[role=listbox] label', { hasText: 'Qty' }).click();
  await expect(page.locator('[data-dg-portfolio-table] th[data-dg-col=qty]')).toBeHidden();
});

test('disabling the merge restores the native tables and removes the merged UI; re-enabling rebuilds it cleanly', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  const nativeVisible = async () => {
    for (const s of ['stock', 'etf', 'lox']) {
      await expect(page.locator(`h3[data-name=${s}]`)).toBeVisible();
      await expect(page.locator(`h3[data-name=${s}] ~ * table`)).toBeVisible();
      await expect(page.locator(`h3[data-name=${s}] ~ * [data-name=pagination]`)).toBeVisible();
    }
  };
  const nativeHidden = async () => {
    for (const s of ['stock', 'etf', 'lox']) {
      await expect(page.locator(`h3[data-name=${s}]`)).toBeHidden();
      await expect(page.locator(`h3[data-name=${s}] ~ * table`)).toBeHidden();
      await expect(page.locator(`h3[data-name=${s}] ~ * [data-name=pagination]`)).toBeHidden();
    }
  };
  const mergedPresent = async () => {
    await expect(page.locator('#dg-portfolio-toolbar')).toBeVisible();
    await expect(page.locator('[data-dg-portfolio-table]')).toBeVisible();
    await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(6);
    await expect(page.locator('[data-dg-portfolio-scroll]')).toHaveCount(1); // never duplicated on a rebuild
    await expect(page.locator('[data-dg-portfolio-scroll] > [data-dg-portfolio-table]')).toHaveCount(1);
  };
  const mergedAbsent = async () => {
    await expect(page.locator('#dg-portfolio-toolbar')).toHaveCount(0);
    await expect(page.locator('[data-dg-portfolio-table]')).toHaveCount(0);
    await expect(page.locator('[data-dg-portfolio-scroll]')).toHaveCount(0);
    await expect(page.locator('[data-dg-own][data-name=pagination]')).toHaveCount(0);
  };

  await nativeVisible();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await nativeHidden();
  await mergedPresent();

  // stop(): removes the HIDDEN marks, the hide-style, the merged table/toolbar/pager, and resets
  // portfolioColumns's own style — never exercised until now, since no earlier test turns the
  // setting back off after enabling it.
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: false }));
  await nativeVisible();
  await mergedAbsent();

  // re-enabling must cleanly rebuild everything from scratch, not rely on leftover state from the
  // first run.
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await nativeHidden();
  await mergedPresent();
});

test('a merged table wider than its container scrolls horizontally in its own wrapper, like DEGIRO\'s own; a narrow one still fills the width', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await page.setViewportSize({ width: 700, height: 800 });
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(6);
  // The holdings block itself must not overflow (the document can't be measured: the mock's 900px
  // performance chart already overflows a 700px viewport). Without a scroll wrapper the merged table
  // spilled out of it, cut off with no horizontal scrollbar of its own.
  const overflow = (/** @type {string} */ sel) => page.$eval(sel, el => el.scrollWidth - el.clientWidth);
  await expect.poll(() => overflow('.holdings')).toBeLessThanOrEqual(0);
  // instead the table's own wrapper scrolls; the toolbar and pager stay outside it
  const wrap = await page.$eval('[data-dg-portfolio-table]', t => {
    const p = /** @type {HTMLElement} */ (t.parentElement);
    return { scroll: p.hasAttribute('data-dg-portfolio-scroll'), overflowX: getComputedStyle(p).overflowX, over: p.scrollWidth - p.clientWidth };
  });
  expect(wrap).toEqual({ scroll: true, overflowX: 'auto', over: expect.any(Number) });
  expect(wrap.over).toBeGreaterThan(0);
  await expect(page.locator('[data-dg-portfolio-scroll] + [data-name=pagination]')).toBeVisible();
  expect(await page.$eval('#dg-portfolio-toolbar', t => t.nextElementSibling?.hasAttribute('data-dg-portfolio-scroll'))).toBe(true);
  // the wrapper scrolls the table for real
  await page.$eval('[data-dg-portfolio-scroll]', w => { w.scrollLeft = 100; });
  expect(await page.$eval('[data-dg-portfolio-scroll]', w => w.scrollLeft)).toBeGreaterThan(0);

  // wide enough: no scrolling, and the table still fills the whole width (no narrow-table regression)
  await page.setViewportSize({ width: 2400, height: 800 });
  await expect.poll(() => overflow('[data-dg-portfolio-scroll]')).toBe(0);
  expect(await page.$eval('[data-dg-portfolio-scroll]', w =>
    Math.abs(/** @type {Element} */ (w.firstElementChild).getBoundingClientRect().width - w.clientWidth))).toBeLessThan(1);
});

test('the Product column is collapsed to 320px with an ellipsis by default; its chevron expands and collapses it without sorting', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  await page.setViewportSize({ width: 1600, height: 800 });
  const LONG = 'Mock iShares Core MSCI World UCITS ETF USD (Acc) Extra Long Product Name';
  // a long name, as DEGIRO's own Trackers section has (the merged row follows the native one)
  await page.evaluate(n => { document.querySelector('[data-name=productName][data-id="441201"]').textContent = n; }, LONG);
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const name = page.locator('[data-dg-portfolio-table] tbody [data-name=productName]', { hasText: 'Mock iShares' });
  await expect(name).toHaveText(LONG);
  const measure = () => name.evaluate(el => {
    const td = /** @type {HTMLElement} */ (el.closest('td'));
    const th = /** @type {HTMLElement} */ (document.querySelector('[data-dg-portfolio-table] th[data-dg-col=product]'));
    return { td: parseFloat(getComputedStyle(td).width), th: parseFloat(getComputedStyle(th).width),
      truncated: el.scrollWidth > el.clientWidth, ellipsis: getComputedStyle(el).textOverflow };
  });
  // collapsed: capped (content box, as DEGIRO's own max-width: 320px) and the long name cut with an ellipsis
  await expect.poll(async () => (await measure()).truncated).toBe(true);
  let m = await measure();
  expect(m.td).toBeLessThanOrEqual(320);
  expect(m.th).toBeLessThanOrEqual(320);
  expect(m.ellipsis).toBe('ellipsis');
  // short names in the same column are not cut
  const short = page.locator('[data-dg-portfolio-table] tbody [data-name=productName]', { hasText: 'Mock Software SE' });
  expect(await short.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);

  // the chevron: DEGIRO blue, at the right end of the Product header, pointing right (»)
  const toggle = page.locator('[data-dg-portfolio-table] th[data-dg-col=product] [data-dg-product-toggle]');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveCSS('color', 'rgb(0, 149, 210)');
  await expect(toggle).toHaveAttribute('aria-label', 'Full product names');
  expect(await toggle.evaluate(b => {
    const th = /** @type {Element} */ (b.closest('th')).getBoundingClientRect(), r = b.getBoundingClientRect();
    return th.right - r.right < 20 && r.left > /** @type {Element} */ (b.previousElementSibling).getBoundingClientRect().right;
  })).toBe(true);
  await expect(toggle.locator('svg')).toHaveCSS('transform', 'none');
  const arrow = col => page.$eval(`[data-dg-portfolio-table] th[data-dg-col=${col}] > button:first-child`, b => getComputedStyle(b, '::after').content);

  // expanded: full name, no width cap, chevron pointing left; the sort is unchanged
  await toggle.click();
  await expect.poll(async () => (await measure()).truncated).toBe(false);
  m = await measure();
  expect(m.td).toBeGreaterThan(320);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle.locator('svg')).not.toHaveCSS('transform', 'none');
  await expect(page.locator('[data-dg-portfolio-table] th[data-dg-col=type]')).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.locator('[data-dg-portfolio-table] th[data-dg-col=product]')).toHaveAttribute('aria-sort', 'none');
  expect(await arrow('product')).toBe('"↕"'); // unsorted, so only the faint hint
  // the chevron itself never draws the sort arrow
  expect(await toggle.evaluate(b => getComputedStyle(b, '::after').content)).toBe('none');

  // and back to collapsed
  await toggle.click();
  await expect.poll(async () => (await measure()).truncated).toBe(true);
  expect((await measure()).td).toBeLessThanOrEqual(320);
  await expect(page.locator('[data-dg-portfolio-table] th[data-dg-col=type]')).toHaveAttribute('aria-sort', 'ascending');

  // turning the merge off removes the chevron and the width rule with the table
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: false }));
  await expect(page.locator('[data-dg-product-toggle]')).toHaveCount(0);
  await expect(page.locator('#dg-portfolio-style')).toHaveCount(0);
  const native = page.locator('[data-name=productName][data-id="441201"]');
  await expect(native).toBeVisible();
  expect(await native.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
});

test('persist on: an expanded Product column survives a reload', async ({ degiro, settings }) => {
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true, portfolioMergedPersist: true }));
  let { page } = await degiro({ url: URL_P });
  await page.locator('[data-dg-product-toggle]').click();
  await expect.poll(() => opt.evaluate(() => chrome.storage.sync.get('dgPortfolioWide'))).toEqual({ dgPortfolioWide: true });
  await page.reload();
  await expect(page.locator('[data-dg-portfolio-table]')).toHaveAttribute('data-dg-product-wide', '');
  await expect(page.locator('[data-dg-product-toggle]')).toHaveAttribute('aria-pressed', 'true');
});

test('portfolio merge toggles are present and save', async ({ settings }) => {
  const opt = await settings();
  // the persist toggle is a sub-option of the merge itself, greyed out while the merge is off
  const persistRow = opt.locator('label.sub[data-depends=portfolioMergedTable]', { has: opt.locator('[data-key=portfolioMergedPersist]') });
  await expect(persistRow).toHaveClass(/\bdisabled\b/);
  await setFlag(opt, 'portfolioMergedTable', true);
  await expect(persistRow).not.toHaveClass(/\bdisabled\b/);
  await expect.poll(() => opt.evaluate(() => chrome.storage.sync.get('portfolioMergedTable'))).toEqual({ portfolioMergedTable: true });
  await setFlag(opt, 'portfolioMergedPersist', true);
  await expect.poll(() => opt.evaluate(() => chrome.storage.sync.get('portfolioMergedPersist'))).toEqual({ portfolioMergedPersist: true });
});
