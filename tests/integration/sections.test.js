// Hidden sections (hide.js) and compact Pricing data (compact.js): which box is hidden for a title,
// which lists get a smaller row gap, and what comes back when the setting goes off.
// Layout stays in Playwright (tests/e2e/features.spec.js): JSDOM has no layout, and it expands no
// `gap` shorthand, so only rows that declare `row-gap` themselves are seen as row stacks here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('./harness');

const noErrors = w => assert.deepEqual(w.errors.map(e => e.stack || String(e)), []);

// degiro.html calls fetch() and makes a Highcharts chart in its inline script: both are off here
const PRODUCT_GLOBALS = {
  __MOCK_NO_URL_SESSION: true,
  Highcharts: { Chart: function() { return { series: [{ setData() {}, data: [{ update() {} }] }] }; } }
};
const product = (w, globals = {}) => w.open({ fixture: 'degiro', hash: '/products/123/overview', globals: { ...PRODUCT_GLOBALS, ...globals } });
/** the ids of the boxes hide.js has hidden */
const hidden = tab => tab.$$('[data-dg-hidden-box]').map(el => el.id || el.getAttribute('data-name') || el.tagName);
/** a DEGIRO rerender: any foreign DOM change makes the scheduler run the features again */
const touch = async (w, tab) => { tab.document.body.appendChild(tab.document.createElement('i')); await w.advance(300); };

// ── hide.js ─────────────────────────────────────────────────────────────────────────────────

test('by default only DEGIRO\'s Cash compensation section is hidden', async () => {
  const w = createWorld();
  const tab = await product(w);
  await w.advance(200);
  assert.deepEqual(hidden(tab), ['cashWrap'], 'the wrapper around the section, not the heading');
  assert.equal(tab.$('#cashWrap').style.display, 'none');
  assert.equal(tab.json('__dgt.status().hideSections'), 'ok');
  assert.ok(tab.$('#otherWrap').style.display !== 'none', 'other sections are left alone');
  noErrors(w);
});

test('a title is matched after trimming and in any case; the list replaces the last one', async () => {
  const w = createWorld();
  const tab = await product(w);
  await w.advance(200);
  await w.set('sync', { hiddenTitles: ['   other SECTION  '] });
  await w.advance(200);
  assert.deepEqual(hidden(tab), ['otherWrap']);
  assert.ok(tab.$('#cashWrap').style.display !== 'none', 'the section that is no longer listed comes back');
  noErrors(w);
});

test('Cash compensation is found by DEGIRO\'s own hook, whatever language the page is in', async () => {
  const w = createWorld();
  // the page says "Cash compensation"; the list only has the German title
  const tab = await product(w, {});
  await w.set('sync', { hiddenTitles: ['Barausgleich'] });
  await w.advance(200);
  assert.deepEqual(hidden(tab), ['cashWrap'], 'hidden through data-name=cashFundCompensations');
  // with no default title left in the list, the hook no longer counts
  await w.set('sync', { hiddenTitles: ['Something else'] });
  await w.advance(200);
  assert.deepEqual(hidden(tab), [], 'a user list of their own does not hide it by the hook');
  noErrors(w);
});

test('a section holding prices or another section\'s title is never hidden', async () => {
  const w = createWorld();
  const tab = await product(w);
  await w.set('sync', { hiddenTitles: ['Pricing data'] });
  await w.advance(200);
  assert.deepEqual(hidden(tab), [], 'Pricing data holds the Bid and Ask prices');
  assert.ok(tab.$('[data-field=BidPrice]'), 'the prices are still there');
  assert.equal(tab.json('__dgt.status().hideSections'), 'ok', 'the title was found, only no safe box');

  // Dividends and Earnings share one <section>: only the Dividends widget inside it goes
  await w.set('sync', { hiddenTitles: ['Dividends'] });
  await w.advance(200);
  assert.deepEqual(hidden(tab), ['divWidget']);
  assert.equal(tab.$('#earnWidget').style.display, '', 'the Earnings widget stays');
  assert.ok(tab.$('#divSection').style.display !== 'none', 'and so does the section around both');
  noErrors(w);
});

test('a box DEGIRO reuses for something else is given back', async () => {
  const w = createWorld();
  const tab = await product(w);
  await w.set('sync', { hiddenTitles: ['Other section'] });
  await w.advance(200);
  assert.deepEqual(hidden(tab), ['otherWrap']);

  tab.$('#other h3').textContent = 'Something else';   // DEGIRO rendered another section into it
  await w.advance(300);
  assert.deepEqual(hidden(tab), [], 'the title no longer matches: shown again');
  assert.equal(tab.$('#otherWrap').style.display, '');

  tab.$('#other h3').textContent = 'Other section';
  await w.advance(300);
  assert.deepEqual(hidden(tab), ['otherWrap'], 'and hidden again when the title comes back');

  // DEGIRO loads prices into the same box later: it must not stay hidden
  const price = tab.document.createElement('span');
  price.setAttribute('data-field', 'BidPrice');
  tab.$('#other').appendChild(price);
  await w.advance(300);
  assert.deepEqual(hidden(tab), [], 'a box that now holds prices is shown');
  noErrors(w);
});

test('switching hidden sections off, and an empty list, leave the page as DEGIRO built it', async () => {
  const w = createWorld();
  const tab = await product(w);
  await w.advance(200);
  assert.deepEqual(hidden(tab), ['cashWrap']);

  await tab.setFlag('hideSections', false);
  await w.advance(200);
  assert.deepEqual(hidden(tab), [], 'stop() gives every box back');
  assert.equal(tab.json('__dgt.status().hideSections'), 'off');

  await tab.setFlag('hideSections', true);
  await w.advance(200);
  assert.deepEqual(hidden(tab), ['cashWrap'], 'and on again it is hidden once more');

  await w.set('sync', { hiddenTitles: [] });
  await w.advance(200);
  assert.deepEqual(hidden(tab), []);
  assert.equal(tab.json('__dgt.status().hideSections'), 'idle', 'nothing to hide');
  noErrors(w);
});

test('DEGIRO\'s real layout (one mainPageSection with data-name widgets): the widget goes, the section stays', async () => {
  const w = createWorld();
  const tab = await product(w, { __MOCK_MAIN_SECTION: true });
  await w.set('sync', { hiddenTitles: ['Other section', 'Cash compensation'] });
  await w.advance(200);
  assert.deepEqual(hidden(tab).sort(), ['cashWrap', 'otherWrap'], 'the wrapper around each of DEGIRO\'s widget divs');
  assert.ok(tab.$('#cashWrap [data-name=cashFundCompensations]'), 'the widget div itself is inside the hidden wrapper');
  assert.ok(tab.$('[data-name=mainPageSection]').style.display !== 'none', 'the section with every widget is never hidden');
  assert.ok(tab.$('#chart'), 'the chart is still in the page');
  noErrors(w);
});

test('nothing to hide on a page without sections', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'favourites', hash: '/favourites' });
  await w.advance(200);
  assert.deepEqual(hidden(tab), []);
  assert.equal(tab.json('__dgt.status().hideSections'), 'idle');
  noErrors(w);
});

// ── compact.js ──────────────────────────────────────────────────────────────────────────────

const compacted = tab => tab.$$('[data-dg-compact]').map(el => el.id || el.tagName);
const rowGap = (tab, sel) => tab.$(sel).style.getPropertyValue('row-gap');

test('every list in the Pricing data widget gets the smaller row gap, nothing outside it', async () => {
  const w = createWorld();
  const tab = await product(w);
  await w.advance(200);
  assert.deepEqual(compacted(tab).sort(), ['pricingDl', 'symbolDl'], 'the Bid list and its widget\'s other list');
  assert.equal(rowGap(tab, '#pricingDl'), '4px');
  assert.equal(tab.$('#pricingDl').style.getPropertyPriority('row-gap'), 'important', 'beats DEGIRO\'s own rule');
  assert.equal(rowGap(tab, '#unrelatedDl'), '', 'a list in another widget is left alone');
  assert.equal(tab.json('__dgt.status().compactPricing'), 'ok');
  noErrors(w);
});

test('a row stack DEGIRO re-renders is made compact again, without re-reading every element', async () => {
  const w = createWorld();
  const tab = await product(w);
  await w.advance(200);
  tab.$('#pricingDl').style.removeProperty('row-gap'); // DEGIRO reset its own style
  await touch(w, tab);
  assert.equal(rowGap(tab, '#pricingDl'), '4px', 'a known row stack is restored');
  noErrors(w);
});

test('switched off: DEGIRO\'s own spacing is back; on again it is compact at once', async () => {
  const w = createWorld();
  const tab = await product(w);
  await w.advance(200);
  await tab.setFlag('compactPricing', false);
  await w.advance(200);
  assert.deepEqual(compacted(tab), [], 'no marks left');
  assert.equal(rowGap(tab, '#pricingDl'), '', 'and no inline row gap');
  assert.equal(tab.json('__dgt.status().compactPricing'), 'off');

  await tab.setFlag('compactPricing', true);
  await w.advance(200);
  assert.equal(rowGap(tab, '#pricingDl'), '4px');
  noErrors(w);
});

test('a product page without a Bid row reports missing; another page is idle', async () => {
  const w = createWorld();
  const tab = await product(w);
  await w.advance(200);
  // DEGIRO changed its page: no hook and no Bid label anywhere
  tab.$$('[data-field=BidPrice]').forEach(el => el.removeAttribute('data-field'));
  tab.$$('dt').forEach(dt => { dt.textContent = 'Something'; });
  await touch(w, tab);
  assert.equal(tab.json('__dgt.status().compactPricing'), 'loading', 'a page that only just opened may still be loading');
  await w.advance(9000); // LOADING_MS
  assert.equal(tab.json('__dgt.status().compactPricing'), 'missing');

  const other = await w.open({ fixture: 'favourites', hash: '/favourites' });
  await w.advance(200);
  assert.equal(other.json('__dgt.status().compactPricing'), 'idle');
  noErrors(w);
});
