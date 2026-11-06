// e2e: the Portfolio page's holdings fixture (tests/fixtures/portfolio.html) carries the real DOM
// hooks for the merged holdings table feature's selectors (checked live, see the plan's Global
// Constraints). This file grows task-by-task as that feature is built.
const { test, expect, setFlag } = require('./fixtures');
const URL_P = 'https://trader.degiro.nl/trader/?mock=portfolio#/portfolio';
const URL_O = 'https://trader.degiro.nl/trader/?mock=orders#/orders/open';

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

test('fixture renders three holdings sections with real hooks', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_P });
  await expect(page.locator('h3[data-name=stock]')).toHaveText('Shares');
  await expect(page.locator('h3[data-name=etf]')).toHaveText('Trackers (ETFs)');
  await expect(page.locator('h3[data-name=lox]')).toHaveText('Structured products');
  await expect(page.locator('[data-name=productName]')).toHaveCount(6); // 3 + 2 + 1 rows
});

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
  // the default-hidden ones (Symbol | ISIN, Exchange, Last, Delay) are hidden with CSS, like Orders'
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
  })).toEqual({ order: ['buy', 'sell', 'Mock Software SE'], elsewhere: 0, cells: 15 });
  // the native name's class (DEGIRO's own bold) is copied onto the merged name
  const name = row.locator('[data-name=productName]');
  await expect(name).toHaveClass('holdingsName');
  await expect(name).toHaveCSS('font-weight', '600');
  // Buy still forwards to the real hidden button
  await row.locator('button[data-action=buy]').click();
  await expect(page.locator('h3[data-name=stock] ~ * table tbody tr').first()).toHaveAttribute('data-dg-last-clicked', 'buy');
});

test('merged rows copy the native row class, so they get DEGIRO\'s own row height', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const row = page.locator('[data-dg-portfolio-table] tbody tr').first();
  await expect(row).toHaveClass('holdingsRow');
  // the fixture's row class sets a 44px height, as DEGIRO's own row class sizes its rows
  expect(await row.evaluate(tr => Math.round(tr.getBoundingClientRect().height))).toBe(44);
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

test('the sorted header shows a visible arrow, which is not part of its label', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const arrow = col => page.$eval(`[data-dg-portfolio-table] th[data-dg-col=${col}] > button`, b => getComputedStyle(b, '::after').content);
  await expect.poll(() => arrow('type')).toBe('"↑"');
  expect(await arrow('product')).toBe('none');
  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Type' }).click();
  await expect.poll(() => arrow('type')).toBe('"↓"');
  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Product' }).click();
  await expect.poll(() => arrow('product')).toBe('"↑"');
  expect(await arrow('type')).toBe('none');
  await expect(page.locator('[data-dg-portfolio-table] th[data-dg-col=product]')).toHaveText('Product');
});

test('the toolbar labels its picker "Columns", like Orders\' own', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const bar = page.locator('#dg-portfolio-toolbar');
  await expect(bar).toHaveText('Columns4 hidden ▾');
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

test('merged headers follow DEGIRO\'s own (localised) header text', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  // as on a Dutch account: the native header texts are translated, the body-cell hooks are not
  await page.evaluate(() => document.querySelectorAll('.holdings thead').forEach(thead => {
    thead.querySelectorAll('th')[3].textContent = 'Aantal';
  }));
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await expect(page.locator('[data-dg-portfolio-table] th[data-dg-col=qty]')).toHaveText('Aantal');
  // the Columns picker offers the same label
  await page.locator('[data-dg-columns]').click();
  await expect(page.locator('[role=listbox] label', { hasText: 'Aantal' })).toHaveCount(1);
  // DEGIRO renames a header later (e.g. after a language switch): the merged one follows
  await page.evaluate(() => { document.querySelector('h3[data-name=stock] ~ * thead th:nth-child(4)').textContent = 'Stück'; });
  await expect(page.locator('[data-dg-portfolio-table] th[data-dg-col=qty]')).toHaveText('Stück');
});

test('merged table copies the native table, header, cell and Buy/Sell button styling', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const merged = page.locator('[data-dg-portfolio-table]');
  await expect(merged).toHaveClass('holdingsTable');
  await expect(merged.locator('th[data-dg-col=value]')).toHaveClass('holdingsHead');
  await expect(merged.locator('th[data-dg-col=type]')).toHaveClass('holdingsHead'); // no native Type: a representative header
  await expect(merged.locator('tbody tr').first().locator('[data-field=value]')).toHaveClass('holdingsCell');
  // Buy/Sell are copies of DEGIRO's own buttons: class and inner markup survive the merge
  const buy = merged.locator('tbody tr').first().locator('button[data-action=buy]');
  await expect(buy).toHaveClass('holdingsAction');
  await expect(buy.locator('span.holdingsActionLabel')).toHaveText('Buy');
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
  for (const sel of ['#dg-portfolio-toolbar', '[data-dg-portfolio-table]', '[data-dg-portfolio-table] + [data-name=pagination]']) {
    expect(await page.$eval(sel, t => t.parentElement.getAttribute('data-holdings'))).toBe('stock');
  }

  // the merged pager drives etf's real (nested) pagination, same as the flat-shape test above
  const next = page.locator('[data-dg-portfolio-table] + [data-name=pagination] button[data-dg-page=next]');
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
  expect(await page.$eval('[data-dg-portfolio-table]', t => t.parentElement.getAttribute('data-holdings'))).toBe('etf');
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

test('off the Portfolio page, the feature reports idle, not missing', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_O }); // no h3[data-name=stock] here, and never will be
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await expect.poll(async () => (await rawStatus(page, opt)).portfolioTable).toBe('idle');
});

test('merged table shows all rows from all three sections and tracks a live update', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(6);
  await page.evaluate(() => { document.querySelector('h3[data-name=stock] ~ * [data-field=value]').textContent = '9.999,99'; });
  await expect(page.locator('[data-dg-portfolio-table] tbody tr').first().locator('[data-field=value]')).toHaveText('9.999,99');
});

test('clicking a merged row\'s Buy button clicks the real hidden Buy button', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await page.locator('[data-dg-portfolio-table] tbody tr').first().locator('button[data-action=buy]').click();
  await expect(page.locator('h3[data-name=stock] ~ * table tbody tr').first()).toHaveAttribute('data-dg-last-clicked', 'buy');
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

test('default sort is Type in DEGIRO\'s section order; clicking Product header sorts and toggles direction', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  // Shares, then Trackers (ETFs), then Structured products — not alphabetical by the (localised) label,
  // which in English would put Structured products before Trackers (ETFs)
  const types = () => page.locator('[data-dg-portfolio-table] tbody tr [data-dg-type]').evaluateAll(tds => tds.map(td => td.getAttribute('data-dg-type')));
  await expect.poll(types).toEqual(['stock', 'stock', 'stock', 'etf', 'etf', 'lox']);
  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Type' }).click(); // descending
  await expect.poll(types).toEqual(['lox', 'etf', 'etf', 'stock', 'stock', 'stock']);
  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Type' }).click(); // back to ascending

  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Product' }).click();
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Product' })).toHaveAttribute('aria-sort', 'ascending');
  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Product' }).click();
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Product' })).toHaveAttribute('aria-sort', 'descending');
});

test('columns: Symbol, Exchange, Last, Delay hidden by default; Product and Type never offered', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await expect(page.locator('[data-dg-columns]')).toHaveText('4 hidden ▾');
  await page.locator('[data-dg-columns]').click();
  const items = await page.locator('[role=listbox] label').allTextContents();
  expect(items).not.toContain('Product');
  expect(items).not.toContain('Type');
  expect(items).toContain('Symbol | ISIN');
});

test('a blank numeric cell sorts last in both ascending and descending order', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  // Mock Software SE's Value hasn't ticked in yet (empty, as a real holding briefly shows before its
  // first price): this must not jump to the top just because we sorted descending.
  await page.evaluate(() => {
    document.querySelector('[data-name=productName][data-id="332108"]').closest('tr').querySelector('[data-field=value]').textContent = '';
  });
  const lastProduct = () => page.locator('[data-dg-portfolio-table] tbody tr:last-child [data-name=productName]');

  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Value' }).click(); // ascending
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Value' })).toHaveAttribute('aria-sort', 'ascending');
  await expect(lastProduct()).toHaveText('Mock Software SE');

  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Value' }).click(); // descending
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Value' })).toHaveAttribute('aria-sort', 'descending');
  await expect(lastProduct()).toHaveText('Mock Software SE');
});

test('persist on: a sort change survives reload; persist off: it resets to default', async ({ degiro, settings }) => {
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true, portfolioMergedPersist: true }));
  const { page } = await degiro({ url: URL_P });
  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Product' }).click();
  await page.reload();
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Product' })).toHaveAttribute('aria-sort', 'ascending');

  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedPersist: false }));
  await page.reload();
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Type' })).toHaveAttribute('aria-sort', 'ascending');

  // Binding: switching persist off never deletes the stored sort — switching it on again later
  // restores it, without the user having to re-sort.
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedPersist: true }));
  await page.reload();
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Product' })).toHaveAttribute('aria-sort', 'ascending');
});

test('toggling persist off mid-session immediately reverts an already-applied sort to the default, without a reload', async ({ degiro, settings }) => {
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true, portfolioMergedPersist: true }));
  const { page } = await degiro({ url: URL_P });
  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Product' }).click();
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Product' })).toHaveAttribute('aria-sort', 'ascending');

  // No reload here: flipping the toggle off alone (the Columns picker already reacts this way too)
  // must drop the already-applied Product sort back to the default right away.
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedPersist: false }));
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Type' })).toHaveAttribute('aria-sort', 'ascending');
});

test('persist on: a hidden column survives reload; persist off: it resets to default, and restores when persist is on again', async ({ degiro, settings }) => {
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true, portfolioMergedPersist: true }));
  const { page } = await degiro({ url: URL_P });
  await page.locator('[data-dg-columns]').click();
  await page.locator('[role=listbox] label', { hasText: 'Qty' }).click(); // hide one more column (4 hidden by default)
  await expect(page.locator('[data-dg-columns]')).toHaveText('5 hidden ▾');
  await page.reload();
  await expect(page.locator('[data-dg-columns]')).toHaveText('5 hidden ▾');

  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedPersist: false }));
  await page.reload();
  await expect(page.locator('[data-dg-columns]')).toHaveText('4 hidden ▾'); // back to DG_DEFAULTS, Qty shown again

  // Binding: switching persist off never deletes the stored choice — switching it on again later
  // restores it.
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedPersist: true }));
  await page.reload();
  await expect(page.locator('[data-dg-columns]')).toHaveText('5 hidden ▾');
});

// The merged pager sits as a sibling right after the merged table (like columnsToolbar()'s own bar
// sits as a sibling right before it) — a <div> is not valid direct <table> content, and the existing
// architecture already keeps toolbar elements as siblings rather than nesting them inside the table.
test('merged Next page advances the etf section\'s native pager and re-collects rows', async ({ degiro, settings }) => {
  const opt = await settings(); await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const { page } = await degiro({ url: URL_P });
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(6); // 3 stock + 2 etf(page1) + 1 lox
  const next = page.locator('[data-dg-portfolio-table] + [data-name=pagination] button[data-dg-page=next]');
  await expect(next).toHaveAttribute('aria-label', 'Next page'); // the extension's own (English) text
  await next.click();
  // stock's own Next is disabled (1 page) and lox's own Next is disabled (1 page) — neither receives
  // a click; only etf (2 pages) advances.
  await expect(page.locator('h3[data-name=etf] ~ * [data-name=pagination] button', { hasText: '2' })).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(5); // 3 stock + 1 etf(page2) + 1 lox
});

test('merged pagination finds DEGIRO\'s own Previous/Next by position, not by their (localised) aria-labels', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  // as on a Dutch account
  await page.evaluate(() => document.querySelectorAll('.holdings [data-name=pagination]').forEach(p => {
    const b = p.querySelectorAll('button');
    b[0].setAttribute('aria-label', 'Vorige pagina');
    b[b.length - 1].setAttribute('aria-label', 'Volgende pagina');
  }));
  const opt = await settings(); await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const pager = page.locator('[data-dg-portfolio-table] + [data-name=pagination]');
  await expect(pager.locator('[data-dg-page=prev]')).toBeDisabled();
  await expect(pager.locator('[data-dg-page=next]')).toBeEnabled();
  await pager.locator('[data-dg-page=next]').click();
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(5);
  await expect(pager.locator('[data-dg-page=next]')).toBeDisabled();
  await expect(pager.locator('[data-dg-page=prev]')).toBeEnabled();
  await pager.locator('[data-dg-page=prev]').click();
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(6);
});

test('the merged pager stays visible, with both buttons disabled, while every section is on its only page', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings(); await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const pager = page.locator('[data-dg-portfolio-table] + [data-name=pagination]');
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

test('the merged pager shows the furthest page any section is on', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings(); await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const pager = page.locator('[data-dg-portfolio-table] + [data-name=pagination]');
  await expect(pager.locator('[data-dg-page=current]')).toHaveText('1');
  await pager.locator('[data-dg-page=next]').click();
  await expect(pager.locator('[data-dg-page=current]')).toHaveText('2'); // etf on page 2, stock/lox on 1
});

test('numeric sort: a live tick on a sorted row updates its merged cell and re-sorts', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_P });
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Value' }).click(); // ascending
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Value' })).toHaveAttribute('aria-sort', 'ascending');
  const lastRow = page.locator('[data-dg-portfolio-table] tbody tr:last-child');
  await expect(lastRow.locator('[data-name=productName]')).toHaveText('Mock S&P 500 ETF USD'); // 13.120,00, the largest
  // Mock Pharma NV (886,00) ticks up past every other value
  await page.evaluate(() => {
    document.querySelector('[data-name=productName][data-id="332109"]').closest('tr').querySelector('[data-field=value]').textContent = '99.999,99';
  });
  await expect(lastRow.locator('[data-name=productName]')).toHaveText('Mock Pharma NV');
  await expect(lastRow.locator('[data-field=value]')).toHaveText('99.999,99');
});

test('persist on: toggling persist off then on again mid-session restores the stored sort, without a reload', async ({ degiro, settings }) => {
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true, portfolioMergedPersist: true }));
  const { page } = await degiro({ url: URL_P });
  const product = page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Product' });
  await page.locator('[data-dg-portfolio-table] thead button', { hasText: 'Product' }).click();
  await expect(product).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(() => opt.evaluate(() => chrome.storage.sync.get('dgPortfolioSort'))).toEqual({ dgPortfolioSort: { col: 'product', dir: 'ascending' } });
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedPersist: false }));
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Type' })).toHaveAttribute('aria-sort', 'ascending');
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedPersist: true }));
  await expect(product).toHaveAttribute('aria-sort', 'ascending');
});

test('persist off: the Columns picker works for the session, and nothing is remembered after a reload', async ({ degiro, settings }) => {
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({ portfolioMergedTable: true }));
  const { page } = await degiro({ url: URL_P });
  await page.locator('[data-dg-columns]').click();
  await page.locator('[role=listbox] label', { hasText: 'Qty' }).click();
  await expect(page.locator('[data-dg-columns]')).toHaveText('5 hidden ▾');
  await expect(page.locator('[data-dg-portfolio-table] th[data-dg-col=qty]')).toBeHidden();
  await page.locator('[data-dg-columns-reset]').click();
  await expect(page.locator('[data-dg-columns]')).toHaveText('4 hidden ▾');
  await page.locator('[role=listbox] label', { hasText: 'Qty' }).click();
  await expect(page.locator('[data-dg-columns]')).toHaveText('5 hidden ▾');
  expect(await opt.evaluate(() => chrome.storage.sync.get('portfolioHiddenColumns'))).toEqual({});
  await page.reload();
  await expect(page.locator('[data-dg-columns]')).toHaveText('4 hidden ▾');
});

// Review Focus (binding): a malformed or stale persisted value must fall back to the default rather
// than throwing or rendering an empty table. sanitizePortfolioSort() isn't exported (orders-table.js's
// own sanitizeSort isn't either, and has no dedicated unit test) — covered here the same way
// sanitizeSort's correctness is covered today, through e2e behaviour.
test('a stale saved sort column falls back to the default sort, and the table still renders', async ({ degiro, settings }) => {
  const opt = await settings();
  await opt.evaluate(() => chrome.storage.sync.set({
    portfolioMergedTable: true, portfolioMergedPersist: true,
    dgPortfolioSort: { col: 'noLongerAColumn', dir: 'ascending' }
  }));
  const { page } = await degiro({ url: URL_P });
  await expect(page.locator('[data-dg-portfolio-table] thead th', { hasText: 'Type' })).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.locator('[data-dg-portfolio-table] tbody tr')).toHaveCount(6);
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
  };
  const mergedAbsent = async () => {
    await expect(page.locator('#dg-portfolio-toolbar')).toHaveCount(0);
    await expect(page.locator('[data-dg-portfolio-table]')).toHaveCount(0);
    await expect(page.locator('[data-dg-portfolio-table] + [data-name=pagination]')).toHaveCount(0);
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
