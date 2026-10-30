// Bid/Ask are found by DEGIRO's data-field hooks (BidPrice/AskPrice) first, so features keep
// working in UI languages whose labels we don't know. Label text is only a fallback.
const { test, expect } = require('./fixtures');

const relabel = () => document.addEventListener('DOMContentLoaded', () => {
  for (const dt of document.querySelectorAll('#pricing dt')) {
    const t = dt.textContent.trim();
    if (t === 'Bid') dt.firstElementChild.textContent = 'Compra (PT)';
    if (t === 'Ask') dt.firstElementChild.textContent = 'Venda (PT)';
  }
});

test('spread, header spread and compact work with unknown labels', async ({ degiro }) => {
  const { page } = await degiro({ initScript: relabel });
  await expect(page.locator('#askCol > [data-spread-row]')).toHaveText(/Spread€ 0,04 \(0,24%\)$/);
  await expect(page.locator('#dg-header-spread')).toHaveText('Spread0,24%');
  await expect.poll(() => page.$eval('#pricingDl', el => getComputedStyle(el).rowGap)).toBe('4px');
});

// → integration (content.test.js): 'falls back to labels when data-field hooks are missing'
