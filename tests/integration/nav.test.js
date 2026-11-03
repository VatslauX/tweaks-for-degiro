// Left-sidebar links (nav.js): the Alarms item's badge counts open alarm banners, in every tab.
// Stays in Playwright: sidebar height fitting (layout), current-item colour (getComputedStyle),
// hover/flyout interaction (computed styles + pointer events).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorld, alarm } = require('./harness');

const badge = tab => tab.$('[data-dg-nav=alarms] [data-dg-nav-badge]')?.textContent ?? null;
const noErrors = w => assert.deepEqual(w.errors.map(e => e.stack || String(e)), []);

async function setup() {
  const x = alarm({ price: 17, productId: 123 }), y = alarm({ price: 16, productId: 789, name: 'Mock Chips' });
  const w = createWorld();
  await w.set('sync', { dgAlarms: [x, y] });
  const A = await w.open({ fixture: 'favourites', hash: '/favourites' });
  const B = await w.open({ fixture: 'favourites', hash: '/favourites' });
  const C = await w.open({ fixture: 'transactions', hash: '/transactions' }); // no banners here, but the sidebar is
  await w.advance(200);
  return { w, A, B, C, x, y };
}

test('the Orders, Transactions and Alarms links sit below Products, without a badge while nothing fired', async () => {
  const { A, C } = await setup();
  for (const tab of [A, C]) {
    const keys = tab.$$('[data-dg-nav]').map(e => e.getAttribute('data-dg-nav'));
    assert.deepEqual(keys, ['orders', 'transactions', 'alarms']);
    assert.equal(tab.$('[data-name=productsMenuItem]').closest('[data-dg-nav]'), null, 'DEGIRO\'s own item is not ours');
    assert.equal(badge(tab), null);
  }
  assert.equal(A.$('[data-dg-nav=alarms] a').getAttribute('href'), '#/favourites?dg=alarms');
});

test('the badge follows open banners across tabs: fire, close in another tab, delete an alarm', async () => {
  const { w, A, B, C, x, y } = await setup();
  A.setPrice(123, 17.5);
  await w.advance(200);
  assert.deepEqual([badge(A), badge(B), badge(C)], ['1', '1', '1']);
  A.setPrice(789, 16.5);
  await w.advance(200);
  assert.deepEqual([badge(A), badge(B), badge(C)], ['2', '2', '2']);

  B.$(`[data-dg-alarm-banner="${x.id}"] [data-dg-alarm-close]`).click(); // closed in B
  await w.advance(200);
  assert.deepEqual([badge(A), badge(B), badge(C)], ['1', '1', '1']);

  await A.run(`dgAlarmStore.remove(${JSON.stringify(y.id)})`); // the alarm of the other banner is deleted
  await w.advance(200);
  assert.deepEqual([badge(A), badge(B), badge(C)], [null, null, null]);
  noErrors(w);
});

test('a tab opened while banners are open starts with the right badge', async () => {
  const { w, A } = await setup();
  A.setPrice(123, 17.5);
  await w.advance(200);
  const late = await w.open({ fixture: 'orders', hash: '/orders/open' });
  await w.advance(200);
  assert.equal(badge(late), '1');
});

test('the Alarms item goes with the Price alarms switch (and comes back with its badge); the other links stay', async () => {
  const { w, A, B } = await setup();
  A.setPrice(123, 17.5);
  await w.advance(200);
  await A.setFlag('priceAlarms', false);
  await w.advance(200);
  for (const tab of [A, B]) {
    assert.deepEqual(tab.$$('[data-dg-nav]').map(e => e.getAttribute('data-dg-nav')), ['orders', 'transactions']);
    assert.equal(tab.$('[data-dg-alarm-banner]'), null);
  }
  await A.setFlag('priceAlarms', true);
  await w.advance(200);
  assert.deepEqual([badge(A), badge(B)], ['1', '1']);
});

// ── Additional nav structure tests ──────────────────────────────────────────

async function openOrders() {
  const w = createWorld();
  const tab = await w.open({ fixture: 'orders', hash: '/orders/open' });
  await w.advance(200);
  return { w, tab };
}

test("nav links: no data-name/data-type attributes copied from DEGIRO's Products item", async () => {
  const { w, tab } = await openOrders();
  assert.equal(tab.$$('[data-dg-nav] [data-name], [data-dg-nav] [data-type]').length, 0, 'no DEGIRO hooks in our items');
  assert.equal(tab.$$('[data-name=productsMenuItem]').length, 1, "DEGIRO's own item not duplicated");
  const link = tab.$('[data-dg-nav=orders] a');
  assert.ok(link.classList.contains('navItem'), 'our link has navItem class');
  noErrors(w);
});

test('on a page without a current item, no nav link looks current', async () => {
  // product page: Products is the current DEGIRO item but none of our links are
  const w = createWorld();
  const tab = await w.open({ fixture: 'degiro', hash: '/products/123/overview',
    globals: { __MOCK_NO_URL_SESSION: true, Highcharts: { Chart: function() { const s = { setData() {}, data: [{ update() {} }] }; return { series: [s] }; } } } });
  await w.advance(200);
  const hasCurrent = tab.$$('[data-dg-nav] a').some(a => a.classList.contains('current'));
  assert.equal(hasCurrent, false, 'no nav link is current on the product page');
  noErrors(w);
});

test('only once, and back in place after DEGIRO re-renders the sidebar', async () => {
  const { w, tab } = await openOrders();
  assert.equal(tab.$$('[data-dg-nav]').length, 3);
  // DEGIRO re-renders: replace the nav and remove our items (like a full re-render)
  const nav = tab.$('[data-name=sideNavigation] nav[aria-label=primary]');
  nav.replaceWith(nav.cloneNode(true));
  tab.$$('[data-dg-nav]').forEach(el => el.remove());
  await w.advance(300);
  assert.equal(tab.$$('[data-dg-nav]').length, 3, 'items restored after re-render');
  // settled: further DOM changes do not add duplicates
  tab.document.body.appendChild(tab.document.createElement('div'));
  await w.advance(300);
  assert.equal(tab.$$('[data-dg-nav]').length, 3, 'count stays at 3');
  noErrors(w);
});

test("without DEGIRO's Products item, nothing is added", async () => {
  const { w, tab } = await openOrders();
  assert.equal(tab.$$('[data-dg-nav]').length, 3);
  // Live removal of the Products item's data-name: the extension should remove our links
  tab.$('[data-name=productsMenuItem]').removeAttribute('data-name');
  tab.document.body.appendChild(tab.document.createElement('div')); // DOM change
  await w.advance(400);
  assert.equal(tab.$$('[data-dg-nav]').length, 0, 'items removed when Products item gone');
  noErrors(w);
});

test('current class remembered on a page where no item looks current', async () => {
  const { w, tab } = await openOrders();
  const link = tab.$('[data-dg-nav=orders] a');
  assert.ok(link.classList.contains('current'), 'orders link current on orders page');
  // remove DEGIRO's current class from its item (simulating a re-render where it loses it)
  tab.$('[data-name=accountActivityMenuItem]').classList.remove('current');
  tab.document.body.appendChild(tab.document.createElement('div'));
  await w.advance(400);
  assert.ok(tab.$('[data-dg-nav=orders] a').classList.contains('current'), 'our current class remembered');
  noErrors(w);
});

test("a one-off class on another DEGIRO link is not taken for the current class", async () => {
  const { w, tab } = await openOrders();
  // An unread badge class on Inbox (not the current item)
  tab.$('[data-name=accountActivityMenuItem]').classList.add('unread');
  tab.document.body.appendChild(tab.document.createElement('div'));
  await w.advance(300);
  tab.$('[data-name=accountActivityMenuItem]').classList.remove('unread');
  // A "More" link with navItem class that isn't one of DEGIRO's menu items
  const more = tab.document.createElement('a');
  more.className = 'navItem more'; more.href = '#/products/123/overview'; more.textContent = 'More';
  tab.$('[data-name=sideNavigation] nav').append(more);
  tab.document.body.appendChild(tab.document.createElement('div'));
  await w.advance(300);
  more.remove();
  // navigate to orders: our orders link should be current
  await tab.go('#/orders/open');
  tab.document.body.appendChild(tab.document.createElement('div'));
  await w.advance(300);
  assert.ok(tab.$('[data-dg-nav=orders] a')?.getAttribute('aria-current') === 'page', 'orders aria-current correct');
  noErrors(w);
});

test("DEGIRO's tooltip and accessible name for Products are not copied", async () => {
  const { w, tab } = await openOrders();
  // Add title/aria attributes to DEGIRO's Products item, then force a rebuild
  const productsLink = tab.$('[data-name=productsMenuItem]');
  productsLink.setAttribute('title', 'Products');
  productsLink.setAttribute('aria-label', 'Products');
  productsLink.setAttribute('aria-describedby', 'productsTip');
  productsLink.setAttribute('aria-labelledby', 'productsTip');
  tab.$$('[data-dg-nav]').forEach(el => el.remove()); // remove so extension rebuilds
  tab.document.body.appendChild(tab.document.createElement('div'));
  await w.advance(300);
  assert.equal(tab.$('[data-dg-nav=orders] a').getAttribute('title'), 'Orders', 'our link has its own title');
  assert.equal(tab.$('[data-dg-nav=orders] a').getAttribute('aria-label'), 'Orders', 'our link has its own aria-label');
  assert.equal(tab.$('[data-dg-nav=transactions] a').getAttribute('aria-label'), 'Transactions');
  const badAttrs = tab.$$('[data-dg-nav], [data-dg-nav] *').filter(el =>
    [...el.attributes].some(at => /Products|productsTip/.test(at.value))
  );
  assert.equal(badAttrs.length, 0, "none of our elements have DEGIRO's Products values");
  noErrors(w);
});

test("made again when DEGIRO's Products item changes its classes", async () => {
  const { w, tab } = await openOrders();
  assert.equal(tab.$$('[data-dg-nav]').length, 3);
  const cellClass = () => tab.$('[data-dg-nav=orders] .navCell')?.className;
  // DEGIRO marks the current item's parent with 'active'
  tab.$('[data-name=productsMenuItem]').parentElement.classList.add('active');
  tab.document.body.appendChild(tab.document.createElement('div'));
  await w.advance(300);
  assert.ok(cellClass().includes('active'), 'our cell reflects active class');
  tab.$('[data-name=productsMenuItem]').parentElement.classList.remove('active');
  tab.document.body.appendChild(tab.document.createElement('div'));
  await w.advance(300);
  assert.equal(cellClass(), 'navCell', 'active class removed');
  assert.equal(tab.$$('[data-dg-nav]').length, 3, 'still exactly 3 items');
  noErrors(w);
});

const FAV = '/favourites';
const ALARMS_HASH = '/favourites?dg=alarms';

test('on the Alarms page only our Alarms item looks current; Favourites gets it back after', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'favourites', hash: ALARMS_HASH });
  await w.advance(200);
  const alarmLink = tab.$('[data-dg-nav=alarms] a');
  const favLink = tab.$('a[data-name=favouriteProductsMenuItem]');
  assert.ok(alarmLink.classList.contains('current'), 'alarms link is current on Alarms page');
  assert.ok(!favLink.classList.contains('current'), 'Favourites is not current on Alarms page');
  assert.equal(alarmLink.getAttribute('aria-current'), 'page');
  // navigate back to Favourites
  await tab.go(FAV);
  assert.ok(favLink.classList.contains('current'), 'Favourites gets current back');
  assert.ok(!alarmLink.classList.contains('current'), 'Alarms no longer current');
  // leaving to a non-Favourites page: extension cleans up its own tracking attribute
  await tab.go('#/portfolio');
  assert.ok(!alarmLink.classList.contains('current'), 'alarms not current on portfolio page');
  assert.equal(favLink.hasAttribute('data-dg-nav-uncurrent'), false, 'no uncurrent marker left on Favourites');
  noErrors(w);
});

test('Favourites is made not-current again when DEGIRO re-adds the class on the Alarms page', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'favourites', hash: ALARMS_HASH });
  await w.advance(200);
  const favLink = tab.$('a[data-name=favouriteProductsMenuItem]');
  const alarmLink = tab.$('[data-dg-nav=alarms] a');
  assert.ok(!favLink.classList.contains('current'), 'Favourites not current');
  // DEGIRO re-renders and re-adds current to Favourites
  favLink.classList.add('current'); favLink.setAttribute('aria-current', 'page');
  tab.document.body.appendChild(tab.document.createElement('div'));
  await w.advance(300);
  assert.ok(!favLink.classList.contains('current'), 'extension removed Favourites current');
  assert.ok(!favLink.hasAttribute('aria-current'), 'extension removed aria-current');
  assert.ok(alarmLink.classList.contains('current'), 'Alarms still current');
  // give back on navigate to real Favourites
  await tab.go(FAV);
  assert.ok(favLink.classList.contains('current'), 'Favourites gets current back');
  noErrors(w);
});

test('switching Price alarms or navLinks off gives Favourites its class back', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'favourites', hash: ALARMS_HASH });
  await w.advance(200);
  const favLink = tab.$('a[data-name=favouriteProductsMenuItem]');
  assert.ok(!favLink.classList.contains('current'), 'Favourites not current on Alarms page');
  await tab.setFlag('priceAlarms', false);
  await w.advance(300);
  assert.ok(favLink.classList.contains('current'), 'Favourites gets current back when priceAlarms off');
  await tab.setFlag('priceAlarms', true);
  await w.advance(300);
  assert.ok(!favLink.classList.contains('current'), 'Favourites not current when priceAlarms back on');
  await tab.setFlag('navLinks', false);
  await w.advance(300);
  assert.ok(favLink.classList.contains('current'), 'Favourites gets current back when navLinks off');
  noErrors(w);
});

// DEGIRO's router keeps the query while you stay in Favourites (__MOCK_STICKY_QUERY in the mock): its
// Favourites link from #/favourites?dg=alarms gets ?dg=alarms merged back about 40 ms later, so the
// Alarms page stayed. Every check is made twice, well after that, so a late revert can't slip through.
async function sticky(hash = ALARMS_HASH) {
  const w = createWorld();
  const tab = await w.open({ fixture: 'favourites', hash, globals: { __MOCK_STICKY_QUERY: true } });
  await w.advance(200);
  return { w, tab };
}
const click = (tab, el) => el.dispatchEvent(new tab.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
async function onFavourites(w, tab, hash = '#/favourites') {
  for (let i = 0; i < 2; i++) {
    await w.advance(300);
    assert.equal(tab.window.location.hash, hash);
    assert.equal(tab.$('[data-dg-alarms-page]'), null, 'Alarms page gone');
    assert.equal(tab.$('#dg-alarms-page-style'), null, 'Favourites list shown again');
  }
}

test('a click on Favourites leaves the Alarms page, though DEGIRO keeps the query', async () => {
  const { w, tab } = await sticky();
  assert.ok(tab.$('[data-dg-alarms-page]'), 'Alarms page open');
  const favLink = tab.$('a[data-name=favouriteProductsMenuItem]');
  click(tab, favLink);
  await onFavourites(w, tab);
  assert.ok(favLink.classList.contains('current'), 'Favourites looks current again');
  assert.ok(!tab.$('[data-dg-nav=alarms] a').classList.contains('current'), 'Alarms no longer current');
  noErrors(w);
});

test('from the Alarms page, a list and then Favourites end on plain Favourites, not Alarms', async () => {
  const { w, tab } = await sticky();
  click(tab, tab.$('#favouriteLists a[href="#/favourites/2087527"]'));
  await onFavourites(w, tab, '#/favourites/2087527');
  click(tab, tab.$('a[data-name=favouriteProductsMenuItem]'));
  await onFavourites(w, tab);
  noErrors(w);
});

test('on a list that still carries dg=alarms, Favourites goes to plain Favourites', async () => {
  // reached without our click handler: DEGIRO merged the query into the list's URL
  const { w, tab } = await sticky();
  tab.window.location.hash = '#/favourites/2087527';
  await w.advance(300);
  assert.equal(tab.window.location.hash, '#/favourites/2087527?dg=alarms', 'the mock merged the query');
  assert.equal(tab.$('[data-dg-alarms-page]'), null, 'a list is not the Alarms page');
  click(tab, tab.$('a[data-name=favouriteProductsMenuItem]'));
  await onFavourites(w, tab);
  noErrors(w);
});

test('our Alarms item still opens the Alarms page, and a modified click on Favourites is left alone', async () => {
  const { w, tab } = await sticky('/favourites');
  assert.equal(tab.$('[data-dg-alarms-page]'), null);
  const ours = tab.$('[data-dg-nav=alarms] a');
  // jsdom doesn't follow links: do what the browser does for a plain link
  ours.addEventListener('click', e => { if (!e.defaultPrevented) { e.preventDefault(); tab.window.location.hash = ours.getAttribute('href'); } });
  click(tab, ours);
  for (let i = 0; i < 2; i++) {
    await w.advance(300);
    assert.equal(tab.window.location.hash, '#/favourites?dg=alarms');
    assert.ok(tab.$('[data-dg-alarms-page]'), 'Alarms page open');
  }
  // a ctrl-click is the browser's (new tab): not intercepted
  const e = new tab.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
  let seen = false;
  tab.document.addEventListener('click', ev => { seen = ev === e; });
  tab.$('a[data-name=favouriteProductsMenuItem]').dispatchEvent(e);
  assert.ok(seen, 'the click reached DEGIRO');
  noErrors(w);
});

// 'a copy made while the flyout is open has no flyout links' — stayed in Playwright (e2e/nav.spec.js).
// The harness globals are static values; there is no hook to dispatch a MouseEvent before the
// extension scripts run, so the flyout state cannot be set up in jsdom. That test requires initScript.

test('can be switched off and on', async () => {
  const w = createWorld();
  const A = await w.open({ fixture: 'favourites', hash: '/favourites' });
  const B = await w.open({ fixture: 'favourites', hash: '/favourites' });
  await w.advance(200);
  const keys = tab => tab.$$('[data-dg-nav]').map(e => e.getAttribute('data-dg-nav'));
  assert.deepEqual(keys(A), ['orders', 'transactions', 'alarms'], 'all 3 links present');
  await A.setFlag('navLinks', false);
  await w.advance(200);
  assert.deepEqual(keys(A), [], 'links removed in A when navLinks off');
  assert.deepEqual(keys(B), [], 'links removed in B when navLinks off');
  await A.setFlag('navLinks', true);
  await w.advance(200);
  assert.deepEqual(keys(A), ['orders', 'transactions', 'alarms'], 'links restored');
  assert.deepEqual(w.errors.map(e => e.stack || String(e)), []);
});
