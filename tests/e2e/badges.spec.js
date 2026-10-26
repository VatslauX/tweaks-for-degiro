// Order badges: keyboard access, reload when DEGIRO's order list changes, crowded charts.
const { test, expect, setFlag } = require('./fixtures');

const badge = page => page.locator('#chart div:not(:has(div))', { hasText: /^BUY 100 · 15,50$/ });
const log = page => page.evaluate(() => window.__log.join(','));
const mk = (buysell, size, price) => ({ productId: 123, product: 'Mock ETF', buysell, size, price, stopPrice: 0, orderType: 'LIMIT' });

test('badges are buttons: labelled, focusable, Enter and Space open the order', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(badge(page)).toBeVisible({ timeout: 8000 });
  await expect(badge(page)).toHaveAttribute('role', 'button');
  await expect(badge(page)).toHaveAttribute('tabindex', '0');
  await expect(badge(page)).toHaveAttribute('aria-label', 'Adjust buy order 100 at 15,50');
  await badge(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#limit')).toHaveValue('15.5');
  await expect.poll(() => log(page)).toContain('edit:1');
});

test('Space opens the order and does not scroll or select on the chart', async ({ degiro }) => {
  const { page } = await degiro();
  await expect(badge(page)).toBeVisible({ timeout: 8000 });
  await badge(page).focus();
  const y = await page.evaluate(() => scrollY);
  await page.keyboard.press('Space');
  await expect.poll(() => log(page)).toContain('edit:1');
  expect(await page.evaluate(() => scrollY)).toBe(y);
  await expect(page.locator('#chart .dg-select, #chart [data-dg-select]')).toHaveCount(0);
});

test('badges are not buttons when clicking is switched off', async ({ degiro, settings }) => {
  const { page } = await degiro();
  await expect(badge(page)).toBeVisible({ timeout: 8000 });
  await setFlag(await settings(), 'ordersClick', false);
  await expect(badge(page)).not.toHaveAttribute('role', 'button');
  await expect(badge(page)).not.toHaveAttribute('tabindex', /.*/);
});

test('a new or removed order row in the Outstanding panel reloads the orders once', async ({ degiro }) => {
  const { page, calls } = await degiro();
  await expect(badge(page)).toBeVisible({ timeout: 8000 });
  await expect.poll(() => calls.update).toBeGreaterThanOrEqual(1);
  await page.click('#toggle'); // expand DEGIRO's panel: its rows appear
  await expect(page.locator('tr[data-name=openOrder]').first()).toBeVisible();
  await page.waitForTimeout(5500); // past the minimum gap since the first request
  const before = calls.update;
  await page.evaluate(() => {
    const t = document.createElement('table'); t.id = 'extra';
    t.innerHTML = '';
    const tr = document.createElement('tr'); tr.setAttribute('data-name', 'openOrder');
    t.appendChild(tr); document.body.appendChild(t);
  });
  await expect.poll(() => calls.update, { timeout: 6000 }).toBe(before + 1);
  // a second change right after is held back by the 5 s minimum gap
  await page.evaluate(() => document.getElementById('extra').remove());
  await page.waitForTimeout(2500);
  expect(calls.update).toBe(before + 1);
  await expect.poll(() => calls.update, { timeout: 6000 }).toBe(before + 2);
  await page.waitForTimeout(3000);
  expect(calls.update).toBe(before + 2); // no further extra requests
});

test('expanding or minimising the orders panel is not an order change: no extra request', async ({ degiro }) => {
  const { page, calls } = await degiro();
  await expect(badge(page)).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(5500);
  const before = calls.update;
  await page.click('#toggle');
  await page.waitForTimeout(1500);
  await page.click('#toggle');
  await page.waitForTimeout(6000);
  expect(calls.update).toBe(before);
});

test('crowded chart: badges that cannot fit merge into one "N orders" badge', async ({ degiro }) => {
  const { page } = await degiro({ orders: [mk('B', 100, 15.5), mk('B', 200, 14.1), mk('S', 50, 16.2)] });
  await expect(badge(page)).toBeVisible({ timeout: 8000 });
  await page.evaluate(() => window.__chart.setSize(120, 320, false));
  const merged = page.locator('#chart div:not(:has(div))', { hasText: /^3 orders$/ });
  await expect(merged).toBeVisible({ timeout: 8000 });
  await expect(badge(page)).toHaveCount(0);
  // the lines stay
  expect(await page.evaluate(() => window.__chart.yAxis[0].plotLinesAndBands.filter(p => /^dg-ord-/.test(p.id)).length)).toBe(3);
  // back to normal width: single badges again
  await page.evaluate(() => window.__chart.setSize(900, 320, false));
  await expect(badge(page)).toBeVisible({ timeout: 8000 });
  await expect(merged).toHaveCount(0);
});

test('overflowing ▲ row shows +N instead of clipping silently', async ({ degiro }) => {
  const high = [1, 2, 3, 4, 5, 6].map(i => mk('S', 100 + i, 50 + i));
  const { page } = await degiro({ orders: high });
  await expect(page.locator('#chart div:not(:has(div))', { hasText: /^▲ SELL 101 · 51,00$/ })).toBeVisible({ timeout: 8000 });
  await page.evaluate(() => window.__chart.setSize(260, 320, false));
  const more = page.locator('#chart div:not(:has(div))', { hasText: /^\+\d+$/ });
  await expect(more).toBeVisible({ timeout: 8000 });
  const shown = await page.locator('#chart div:not(:has(div))', { hasText: /^▲ SELL/ }).evaluateAll(els => els.filter(e => e.style.display !== 'none').length);
  expect(shown + Number((await more.textContent()).slice(1))).toBe(6);
});
