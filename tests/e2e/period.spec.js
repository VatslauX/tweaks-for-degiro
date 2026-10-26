// Change over the selected chart period, shown next to DEGIRO's daily change.
const { test, expect, setFlag } = require('./fixtures');

const box = page => page.locator('#dg-period-change');
const pick = (page, label) => page.click(`#periods button:text-is("${label}")`);
const expected = (page, n) => page.evaluate(n => {
  const d = n === 'week' ? window.__weekData : window.__chartData.slice(-n), p1 = d[0][1], p2 = d[d.length - 1][1];
  return (p2 - p1) / p1 * 100;
}, n);
const shownPct = async page => parseFloat((await box(page).textContent()).match(/\(([+-]?\d+,\d+)%\)/)[1].replace(',', '.'));

test('shows the 6M change on load, right after the daily change', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(box(page)).toContainText('6M');
  // in the shared header container, which follows the line holding the daily change
  expect(await page.$eval('#dg-period-change', el => el.parentElement.previousElementSibling.contains(document.getElementById('dayChange')))).toBe(true);
  expect(await shownPct(page)).toBeCloseTo(await expected(page, 182), 2);
});

test('follows the selected period', async ({ degiro }) => {
  const { page } = await degiro();
  for (const [label, n] of [['1 M', 30], ['1 W', 'week'], ['YTD', await page.evaluate(() => window.__chartData.length)]]) {
    await pick(page, label);
    await expect(box(page)).toContainText(label.replace(' ', ''));
    expect(await shownPct(page)).toBeCloseTo(await expected(page, n), 2);
  }
});

test('1W with only ~3 days of intraday data (like DEGIRO) still shows the change', async ({ degiro }) => {
  const { page } = await degiro();
  await pick(page, '1 W');
  await expect(box(page)).toContainText('1W');
  expect(await shownPct(page)).toBeCloseTo(await expected(page, 'week'), 2);
  await pick(page, '1 D');
  await expect(box(page)).toHaveCount(0);
  await pick(page, '1 W');
  await expect(box(page)).toContainText('1W');
});

test('hidden for 1D (DEGIRO already shows the daily change)', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(box(page)).toBeVisible();
  await pick(page, '1 D');
  await expect(box(page)).toHaveCount(0);
});

test('green when up, red when down', async ({ degiro }) => {
  const { page } = await degiro();
  await pick(page, '1 M');
  await expect(box(page)).toBeVisible();
  const { pct, color } = await page.evaluate(() => {
    const v = document.querySelector('#dg-period-change').lastElementChild;
    return { pct: v.textContent, color: getComputedStyle(v).color };
  });
  expect(color).toBe(pct.startsWith('+') ? 'rgb(30, 131, 2)' : 'rgb(227, 40, 43)');
});

test('can be switched off', async ({ degiro, settings }) => {
  const { page } = await degiro();
  const opt = await settings();
  await expect(box(page)).toBeVisible();
  await setFlag(opt, 'periodChange', false);
  await expect(box(page)).toHaveCount(0);
  await setFlag(opt, 'periodChange', true);
  await expect(box(page)).toHaveCount(1);
});

test('never shows the new period with the old data while the chart reloads', async ({ degiro }) => {
  const { page } = await degiro({ initScript: () => { window.__DATA_DELAY = 1500; } });
  await expect(box(page)).toContainText('6M');
  // record every state of the element while 1W loads
  await page.evaluate(() => {
    window.__seen = [];
    const rec = () => { const el = document.getElementById('dg-period-change'); window.__seen.push(el ? el.textContent : null); };
    window.__rec = setInterval(rec, 20);
  });
  await pick(page, '1 W');
  await page.waitForTimeout(2500);
  const seen = await page.evaluate(() => { clearInterval(window.__rec); return window.__seen; });
  const want = (await expected(page, 'week')).toFixed(2).replace('.', ',');
  for (const t of seen.filter(Boolean)) {
    if (t.startsWith('1W')) expect(t).toContain(want); // 1W is only ever shown with 1W numbers
  }
  expect(seen.at(-1)).toContain('1W');
});

test('hovering another period button does not hide or change it', async ({ degiro }) => {
  const { page } = await degiro();
  await pick(page, '1 M');
  await expect(box(page)).toContainText('1M');
  const before = await box(page).textContent();
  await page.hover('#periods button:text-is("1 W")');
  await page.evaluate(() => {
    window.__seen = [];
    window.__rec = setInterval(() => { const el = document.getElementById('dg-period-change'); window.__seen.push(el ? el.textContent : null); }, 20);
  });
  await page.waitForTimeout(1500);
  const seen = await page.evaluate(() => { clearInterval(window.__rec); return window.__seen; });
  expect(new Set(seen)).toEqual(new Set([before]));
});
