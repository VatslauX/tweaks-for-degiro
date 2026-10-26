// Compact Pricing data: reduce DEGIRO's 12px gap between rows to 4px.
// Scope: every <dl> in the Pricing data widget, found from the list that holds the Bid row
// (Latest/Bid/Ask…, Volume…, Symbol/Exchange…). Only grids and vertical flex columns with a
// gap ≥ 8px are changed.
(() => {
  const MARK = 'data-dg-compact';
  const GAP = '4px';
  const { isPriceDt, page, feature, SEL } = __dgt; // common.js
  // elements already looked at, so live price updates don't re-read computed styles
  let plain = new WeakSet(), stacks = new WeakSet();

  // The Pricing data widget around a list: climb while the parent holds at most one heading.
  // On the real product page every widget, Ratios and Key figures included, sits in one
  // mainPageSection, so that section (and anything with more headings) is never the scope.
  const NEVER = `main, ${SEL.mainPageSection}, ${SEL.appLayout}`;
  function widgetOf(dl) {
    let box = dl;
    for (let p = dl.parentElement; p && p !== document.body && !p.matches(NEVER) && p.querySelectorAll('h1,h2,h3,h4').length <= 1; p = p.parentElement) box = p;
    return box;
  }

  // all <dl> lists in the Pricing data widget(s), found via the list that has a Bid row
  function pricingLists() {
    const lists = new Set();
    document.querySelectorAll('dl').forEach(dl => {
      if (![...dl.querySelectorAll('dt')].some(dt => isPriceDt(dt, 'Bid'))) return;
      const scope = widgetOf(dl);
      (scope === dl ? [dl] : scope.querySelectorAll('dl')).forEach(d => lists.add(d));
    });
    return lists;
  }

  const isRowStack = s =>
    (s.display === 'grid' || (s.display === 'flex' && s.flexDirection === 'column')) && parseFloat(s.rowGap) >= 8;

  function apply() {
    const lists = pricingLists();
    lists.forEach(dl => {
      [dl, ...dl.querySelectorAll('*')].forEach(el => {
        if (plain.has(el)) return;                                // checked before: not a row stack
        if (el.style.getPropertyValue('row-gap') === GAP) return; // already compact
        if (stacks.has(el) || isRowStack(getComputedStyle(el))) { // known stack whose style was reset, or new one
          el.style.setProperty('row-gap', GAP, 'important');
          el.setAttribute(MARK, '');
          stacks.add(el);
        } else plain.add(el);
      });
    });
    return lists.size ? 'ok' : page.isProduct() ? 'missing' : 'idle';
  }

  function reset() {
    plain = new WeakSet(); stacks = new WeakSet();
    /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(`[${MARK}]`)).forEach(el => { el.style.removeProperty('row-gap'); el.removeAttribute(MARK); });
  }

  // settings changed: start from DEGIRO's own spacing again (re-applied right away, no flash)
  dgOnSettings(s => { reset(); if (s.compactPricing) apply(); });
  feature({ name: 'compactPricing', enabled: () => dgSettings.compactPricing, run: apply, stop: reset });
})();
