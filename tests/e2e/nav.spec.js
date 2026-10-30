// Orders and Transactions links in DEGIRO's left sidebar, below Products.
const { test, expect, setFlag } = require('./fixtures');

const URL_O = 'https://trader.degiro.nl/trader/?mock=orders#/orders/open';
const nav = page => page.locator('[data-name=sideNavigation] nav[aria-label=primary]');
const labels = page => nav(page).locator('a').allTextContents();
const link = (page, key) => page.locator(`[data-dg-nav="${key}"] a`);

test('adds Orders and Transactions below Products, as copies of DEGIRO\'s item', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  await expect.poll(() => labels(page)).toEqual(['Market', 'Favourites', 'Portfolio', 'Inbox', 'Products', 'Orders', 'Transactions', 'Alarms']);
  expect(await link(page, 'orders').getAttribute('href')).toBe('#/orders/open');
  expect(await link(page, 'transactions').getAttribute('href')).toBe('#/transactions');
  // DEGIRO's look, our own icon, none of DEGIRO's hooks copied
  expect(await page.$eval('[data-dg-nav=orders] a', a => a.classList.contains('navItem'))).toBe(true);
  expect(await page.$eval('[data-dg-nav=orders] svg', s => s.querySelectorAll('path').length)).toBe(5);
  expect(await page.$eval('[data-dg-nav=orders] path', p => getComputedStyle(p).fill)).toBe('none'); // outline, whatever DEGIRO's CSS fills
  expect(await page.$$eval('[data-dg-nav] [data-name], [data-dg-nav] [data-type]', els => els.length)).toBe(0);
  expect(await page.$$eval('[data-name=productsMenuItem]', els => els.length)).toBe(1);
});

test('the open page\'s link looks current; clicking a link goes to DEGIRO\'s page', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  await expect(link(page, 'orders')).toHaveAttribute('aria-current', 'page');
  await expect(link(page, 'orders')).toHaveClass(/\bcurrent\b/);
  await expect(link(page, 'transactions')).not.toHaveClass(/\bcurrent\b/);
  expect(await link(page, 'orders').evaluate(a => getComputedStyle(a).color)).toBe('rgb(0, 149, 210)');
  await link(page, 'transactions').click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/transactions');
  await page.evaluate(() => document.body.appendChild(document.createElement('div'))); // DEGIRO re-renders on navigation
  await expect(link(page, 'transactions')).toHaveClass(/\bcurrent\b/);
  await expect(link(page, 'orders')).not.toHaveClass(/\bcurrent\b/);
  await expect(link(page, 'orders')).not.toHaveAttribute('aria-current', 'page');
});

// → integration: on a page without current item; only once + re-render; without Products item

test('can be switched off and on', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_O });
  const opt = await settings();
  await page.bringToFront();
  await expect.poll(() => labels(page)).toContain('Orders');
  await setFlag(opt, 'navLinks', false);
  await expect.poll(() => labels(page)).toEqual(['Market', 'Favourites', 'Portfolio', 'Inbox', 'Products']);
  await setFlag(opt, 'navLinks', true);
  await expect.poll(() => labels(page)).toContain('Transactions');
});

// DEGIRO re-renders on navigation; any DOM change makes the extension look again
const poke = page => page.evaluate(() => document.body.appendChild(document.createElement('div')));

// → integration: current class remembered; one-off class not taken; tooltip not copied; made again on class change

test('in a short window the links step aside so DEGIRO\'s bottom items stay on screen', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  await expect(link(page, 'orders')).toBeVisible();
  const logOff = page.locator('[data-name=sideNavigation] a', { hasText: 'Log off' });
  const onScreen = () => logOff.evaluate(a => a.getBoundingClientRect().bottom <= innerHeight);
  expect(await onScreen()).toBe(true);
  // the mock's sidebar: about 565px with our three links, 425px without
  await page.setViewportSize({ width: 1280, height: 500 });
  await expect(link(page, 'orders')).toBeHidden();
  await expect(link(page, 'transactions')).toBeHidden();
  await expect(link(page, 'alarms')).toBeHidden();
  expect(await onScreen()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 540 }); // still no room: stays hidden
  await page.waitForTimeout(400);
  await expect(link(page, 'orders')).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(link(page, 'orders')).toBeVisible();
  await expect(link(page, 'transactions')).toBeVisible();
  await expect(link(page, 'alarms')).toBeVisible();
  expect(await onScreen()).toBe(true);
  expect(await labels(page)).toEqual(['Market', 'Favourites', 'Portfolio', 'Inbox', 'Products', 'Orders', 'Transactions', 'Alarms']);
});

// → integration: Alarms page current; Favourites re-added class; switching flags gives Favourites back

test('hovering Products does not highlight our links or put DEGIRO\'s flyout in them', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  await expect.poll(() => labels(page)).toContain('Transactions');
  const state = () => page.$$eval('[data-dg-nav]', els => els.map(el => ({
    cls: el.querySelector('a').className, links: el.querySelectorAll('a').length, flyout: el.querySelectorAll('.flyout, .flyoutLink').length
  })));
  await page.hover('[data-name=productsMenuItem]');
  await expect(page.locator('[data-name=productsMenuItem]')).toHaveClass(/flyoutOpen/);
  await poke(page);
  await page.waitForTimeout(400);
  for (const s of await state()) { expect(s.cls).not.toContain('flyoutOpen'); expect(s.links).toBe(1); expect(s.flyout).toBe(0); }
  expect(await page.$$eval('[data-dg-nav] .flyout', els => els.length)).toBe(0);
  expect(await link(page, 'transactions').evaluate(a => getComputedStyle(a).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await page.mouse.move(600, 400);
  await poke(page);
  await page.waitForTimeout(400);
  expect(await page.$$eval('[data-dg-nav]', els => els.length)).toBe(3);
  for (const s of await state()) expect(s.links).toBe(1);
});

// → integration: a copy made while flyout is open has no flyout links
