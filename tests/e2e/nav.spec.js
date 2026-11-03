// Orders and Transactions links in DEGIRO's left sidebar, below Products.
const { test, expect } = require('./fixtures');

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

// → integration (nav.test.js): 'can be switched off and on'

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
  await expect(link(page, 'orders')).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(link(page, 'orders')).toBeVisible();
  await expect(link(page, 'transactions')).toBeVisible();
  await expect(link(page, 'alarms')).toBeVisible();
  expect(await onScreen()).toBe(true);
  expect(await labels(page)).toEqual(['Market', 'Favourites', 'Portfolio', 'Inbox', 'Products', 'Orders', 'Transactions', 'Alarms']);
});

// → integration: Alarms page current; Favourites re-added class; switching flags gives Favourites back

test('a copy made while the flyout is open has no flyout links', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O, initScript: () => {
    // the pointer is already on Products when the sidebar first renders
    document.addEventListener('DOMContentLoaded', () => document.querySelector('[data-name=productsMenuItem]').parentElement.dispatchEvent(new MouseEvent('mouseenter')));
  } });
  await expect.poll(() => labels(page)).toContain('Transactions');
  await expect(page.locator('[data-name=productsMenuItem]')).toHaveClass(/flyoutOpen/);
  expect(await page.$$eval('[data-dg-nav] a', els => els.length)).toBe(3);
  expect(await page.$$eval('[data-dg-nav] .flyout, [data-dg-nav] .flyoutLink', els => els.length)).toBe(0);
  expect(await page.$$eval('[data-dg-nav] a', els => els.map(a => a.className))).not.toContain('navItem flyoutOpen');
});

test('hovering Products does not highlight our links or put DEGIRO\'s flyout in them', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  await expect.poll(() => labels(page)).toContain('Transactions');
  const state = () => page.$$eval('[data-dg-nav]', els => els.map(el => ({
    cls: el.querySelector('a').className, links: el.querySelectorAll('a').length, flyout: el.querySelectorAll('.flyout, .flyoutLink').length
  })));
  await page.hover('[data-name=productsMenuItem]');
  await expect(page.locator('[data-name=productsMenuItem]')).toHaveClass(/flyoutOpen/);
  await poke(page);
  await expect.poll(async () => (await state()).every(s => !s.cls.includes('flyoutOpen') && s.links === 1 && s.flyout === 0)).toBe(true);
  for (const s of await state()) { expect(s.cls).not.toContain('flyoutOpen'); expect(s.links).toBe(1); expect(s.flyout).toBe(0); }
  expect(await page.$$eval('[data-dg-nav] .flyout', els => els.length)).toBe(0);
  expect(await link(page, 'transactions').evaluate(a => getComputedStyle(a).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await page.mouse.move(600, 400);
  await poke(page);
  await expect.poll(async () => {
    const items = await state();
    const count = await page.$$eval('[data-dg-nav]', els => els.length);
    return count === 3 && items.every(s => s.links === 1);
  }).toBe(true);
  expect(await page.$$eval('[data-dg-nav]', els => els.length)).toBe(3);
  for (const s of await state()) expect(s.links).toBe(1);
});

// → integration: a copy made while flyout is open has no flyout links

// DEGIRO keeps the query while you stay in Favourites (the mock's __MOCK_STICKY_QUERY); its own
// Favourites link from the Alarms page used to get ?dg=alarms back, so the Alarms page stayed.
test('our Alarms item opens the Alarms page; DEGIRO\'s Favourites item leaves it', async ({ degiro }) => {
  const { page } = await degiro({ url: 'https://trader.degiro.nl/trader/?mock=favourites#/favourites',
    initScript: () => { window.__MOCK_STICKY_QUERY = true; } });
  const hash = () => page.evaluate(() => location.hash);
  await link(page, 'alarms').click();
  await expect(page.locator('[data-dg-alarms-page]')).toBeVisible();
  expect(await hash()).toBe('#/favourites?dg=alarms');
  await page.locator('a[data-name=favouriteProductsMenuItem]').click();
  await expect.poll(hash).toBe('#/favourites');
  await page.waitForTimeout(300); // DEGIRO's router restores a dropped query about 40 ms later
  expect(await hash()).toBe('#/favourites');
  await expect(page.locator('[data-dg-alarms-page]')).toHaveCount(0);
  await expect(page.locator('[data-name=favourites]')).toBeVisible();
  await expect(page.locator('a[data-name=favouriteProductsMenuItem]')).toHaveClass(/\bcurrent\b/);
});
