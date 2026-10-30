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

test('on a page without a current item, no link looks current', async ({ degiro }) => {
  const { page } = await degiro();
  await expect.poll(() => labels(page)).toContain('Transactions');
  expect(await page.$$eval('[data-dg-nav] a', as => as.filter(a => a.classList.contains('current')).length)).toBe(0);
});

test('only once, and back in place after DEGIRO re-renders the sidebar', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  await expect.poll(() => labels(page)).toContain('Transactions');
  await page.evaluate(() => { const n = document.querySelector('[data-name=sideNavigation] nav'); n.replaceWith(n.cloneNode(true)); });
  await page.evaluate(() => { document.querySelectorAll('[data-dg-nav]').forEach(el => el.remove()); });
  await expect.poll(() => labels(page)).toEqual(['Market', 'Favourites', 'Portfolio', 'Inbox', 'Products', 'Orders', 'Transactions', 'Alarms']);
  // settled: the count stays at 3 across several frames of observer runs
  const count = () => page.$$eval('[data-dg-nav]', els => els.length);
  const frames = () => page.evaluate(() => new Promise(r => { let n = 0; const f = () => (++n > 30 ? r() : requestAnimationFrame(f)); f(); }));
  await frames();
  await expect.poll(count).toBe(3);
  await page.evaluate(() => document.body.appendChild(document.createElement('div'))); // one more look by the extension
  await frames();
  expect(await count()).toBe(3);
});

test('without DEGIRO\'s Products item nothing is added', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O, initScript: () => {
    document.addEventListener('DOMContentLoaded', () => document.querySelector('[data-name=productsMenuItem]')?.removeAttribute('data-name'));
  } });
  await page.waitForTimeout(800);
  expect(await page.$$eval('[data-dg-nav]', els => els.length)).toBe(0);
});

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

test('the current class is remembered on a page where no item looks current', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  await expect(link(page, 'orders')).toHaveClass(/\bcurrent\b/);
  await page.evaluate(() => document.querySelector('[data-name=accountActivityMenuItem]').classList.remove('current'));
  await poke(page);
  await page.waitForTimeout(400);
  await expect(link(page, 'orders')).toHaveClass(/\bcurrent\b/);
});

test('a one-off class on another DEGIRO link is not taken for the current class', async ({ degiro }) => {
  // the product page: Products is the open page's item, but here nothing looks current
  const { page } = await degiro();
  await expect.poll(() => labels(page)).toContain('Orders');
  // an unread badge style on Inbox (not the open page's item)
  await page.evaluate(() => document.querySelector('[data-name=accountActivityMenuItem]').classList.add('unread'));
  await poke(page);
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('[data-name=accountActivityMenuItem]').classList.remove('unread'));
  // a "More" link that isn't one of DEGIRO's menu items
  await page.evaluate(() => {
    const a = document.createElement('a');
    a.className = 'navItem more'; a.href = '#/products/123/overview'; a.textContent = 'More';
    document.querySelector('[data-name=sideNavigation] nav').append(a);
  });
  await poke(page);
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('[data-name=sideNavigation] nav a.more').remove());
  await page.evaluate(() => { location.hash = '#/orders/open'; });
  await poke(page);
  await expect(link(page, 'orders')).toHaveAttribute('aria-current', 'page');
  await page.waitForTimeout(400);
  expect(await page.$eval('[data-dg-nav=orders] a', a => a.className)).toBe('navItem');
});

test('DEGIRO\'s tooltip and accessible name for Products are not copied', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O, initScript: () => {
    document.addEventListener('DOMContentLoaded', () => {
      const a = document.querySelector('[data-name=productsMenuItem]');
      a.setAttribute('title', 'Products'); a.setAttribute('aria-label', 'Products'); a.setAttribute('aria-describedby', 'productsTip'); a.setAttribute('aria-labelledby', 'productsTip');
    });
  } });
  await expect.poll(() => labels(page)).toContain('Transactions');
  expect(await link(page, 'orders').getAttribute('title')).toBe('Orders');
  expect(await link(page, 'orders').getAttribute('aria-label')).toBe('Orders');
  expect(await link(page, 'transactions').getAttribute('aria-label')).toBe('Transactions');
  expect(await page.$$eval('[data-dg-nav], [data-dg-nav] *', els => els.filter(n => [...n.attributes].some(at => /Products|productsTip/.test(at.value))).length)).toBe(0);
});

test('made again when DEGIRO\'s Products item changes its classes', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_O });
  await expect.poll(() => labels(page)).toContain('Transactions');
  const cellClass = () => page.$eval('[data-dg-nav=orders] .navCell', el => el.className);
  // DEGIRO marks the current item's inner nodes too, say
  await page.evaluate(() => document.querySelector('[data-name=productsMenuItem]').parentElement.classList.add('active'));
  await poke(page);
  await expect.poll(cellClass).toBe('navCell active');
  await page.evaluate(() => document.querySelector('[data-name=productsMenuItem]').parentElement.classList.remove('active'));
  await poke(page);
  await expect.poll(cellClass).toBe('navCell');
  expect(await page.$$eval('[data-dg-nav]', els => els.length)).toBe(3);
  expect(await labels(page)).toEqual(['Market', 'Favourites', 'Portfolio', 'Inbox', 'Products', 'Orders', 'Transactions', 'Alarms']);
});

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

// On the Alarms page DEGIRO's route is still Favourites, so DEGIRO keeps Favourites current; only ours should look current
const URL_A = 'https://trader.degiro.nl/trader/?mock=favourites#/favourites?dg=alarms';
const fav = page => page.locator('a[data-name=favouriteProductsMenuItem]');

test('on the Alarms page only our Alarms item looks current; Favourites gets it back after', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_A });
  await expect(link(page, 'alarms')).toHaveClass(/\bcurrent\b/);
  await expect(link(page, 'alarms')).toHaveAttribute('aria-current', 'page');
  await expect(fav(page)).not.toHaveClass(/\bcurrent\b/);
  await page.evaluate(() => { location.hash = '#/favourites'; });
  await expect(fav(page)).toHaveClass(/\bcurrent\b/);
  await expect(link(page, 'alarms')).not.toHaveClass(/\bcurrent\b/);
  await page.evaluate(() => { location.hash = '#/favourites?dg=alarms'; });
  await expect(fav(page)).not.toHaveClass(/\bcurrent\b/);
  // leaving for a page where DEGIRO wouldn't mark Favourites: not given back
  await page.evaluate(() => { location.hash = '#/portfolio'; });
  await expect(link(page, 'alarms')).not.toHaveClass(/\bcurrent\b/);
  await expect(fav(page)).not.toHaveClass(/\bcurrent\b/);
  expect(await fav(page).evaluate(a => a.hasAttribute('data-dg-nav-uncurrent'))).toBe(false);
});

test('Favourites is made not-current again when DEGIRO re-adds the class on the Alarms page', async ({ degiro }) => {
  const { page } = await degiro({ url: URL_A });
  await expect(fav(page)).not.toHaveClass(/\bcurrent\b/);
  await page.evaluate(() => { const a = document.querySelector('a[data-name=favouriteProductsMenuItem]'); a.classList.add('current'); a.setAttribute('aria-current', 'page'); document.body.appendChild(document.createElement('div')); }); // a re-render
  await expect(fav(page)).not.toHaveClass(/\bcurrent\b/);
  await expect(fav(page)).not.toHaveAttribute('aria-current', /.*/);
  await expect(link(page, 'alarms')).toHaveClass(/\bcurrent\b/);
  // given back with the aria-current DEGIRO had set
  await page.evaluate(() => { location.hash = '#/favourites'; });
  await expect(fav(page)).toHaveClass(/\bcurrent\b/);
  await expect(fav(page)).toHaveAttribute('aria-current', 'page');
});

test('switching Price alarms or the sidebar links off gives Favourites its class back', async ({ degiro, settings }) => {
  const { page } = await degiro({ url: URL_A });
  const opt = await settings();
  await page.bringToFront();
  await expect(fav(page)).not.toHaveClass(/\bcurrent\b/);
  await setFlag(opt, 'priceAlarms', false);
  await expect(fav(page)).toHaveClass(/\bcurrent\b/);
  await setFlag(opt, 'priceAlarms', true);
  await expect(fav(page)).not.toHaveClass(/\bcurrent\b/);
  await setFlag(opt, 'navLinks', false);
  await expect(fav(page)).toHaveClass(/\bcurrent\b/);
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
