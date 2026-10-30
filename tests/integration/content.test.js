// Isolated-world content features: bid/ask spread row, header spread, ex-dividend date.
// Stays in Playwright: getComputedStyle colors, layout (header wrapping, sidebar fit, container spacing),
// page-world items (period change requires MAIN scripts), initScript/DOMContentLoaded timing.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('./harness');

const noErrors = w => assert.deepEqual(w.errors.map(e => e.stack || String(e)), []);

// degiro.html calls fetch() and creates a Highcharts chart in its inline script.
// Both must be suppressed for jsdom.
const PRODUCT_GLOBALS = {
  __MOCK_NO_URL_SESSION: true,
  Highcharts: {
    Chart: function() {
      const s = { setData() {}, data: [{ update() {} }] };
      return { series: [s] };
    }
  }
};

// ── Bid/ask spread row (content.js) ─────────────────────────────────────────

test('adds a Spread row at the bottom of the Ask column', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'degiro', hash: '/products/123/overview', globals: PRODUCT_GLOBALS });
  await w.advance(200);
  const row = tab.$('#askCol > [data-spread-row]');
  assert.ok(row, 'spread row exists in ask column');
  assert.match(row.textContent, /Spread.*0,24%/, 'shows spread percentage');
  assert.equal(tab.$('#askCol').lastElementChild.hasAttribute('data-spread-row'), true, 'row is last child');
  noErrors(w);
});

test('spread row updates when the quote changes', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'degiro', hash: '/products/123/overview', globals: PRODUCT_GLOBALS });
  await w.advance(200);
  assert.ok(tab.$('[data-spread-row]'), 'spread row present');
  // Change the Ask price from 16,94 to 17,00 → new spread = (17-16.9)/16.9 ≈ 0,59%
  tab.$$('#askCol dd span')[1].textContent = '€ 17,00';
  await w.advance(300);
  assert.match(tab.$('[data-spread-row]').textContent, /0,59%/, 'spread updated after quote change');
  noErrors(w);
});

test('falls back to labels when the data-field hooks are missing', async () => {
  const w = createWorld();
  const tab = await w.open({ fixture: 'degiro', hash: '/products/123/overview', globals: PRODUCT_GLOBALS });
  await w.advance(200);
  assert.ok(tab.$('[data-spread-row]'), 'initially present via hooks');
  // Remove data-field attributes; extension must fall back to label text "Bid"/"Ask"
  tab.document.querySelectorAll('[data-field=BidPrice],[data-field=AskPrice]').forEach(e => e.removeAttribute('data-field'));
  tab.document.body.appendChild(tab.document.createElement('i')); // DOM change: trigger re-run
  await w.advance(300);
  assert.ok(tab.$('[data-spread-row]'), 'spread row still present via label fallback');
  assert.match(tab.$('[data-spread-row]').textContent, /0,24%/, 'value correct via labels');
  noErrors(w);
});

// header-spread and exdiv: both use visible() via getBoundingClientRect to find the price-line
// header in degiro.html — jsdom always returns 0, so these elements never render in integration.
// Those features stay in tests/e2e/header-spread.spec.js and tests/e2e/exdiv.spec.js.
