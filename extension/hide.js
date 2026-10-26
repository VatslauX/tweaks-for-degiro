// Hide DEGIRO sections by title (list and on/off switch come from settings).
(() => {
  const BOX = 'data-dg-hidden-box';
  let titles = [];
  const { feature, SEL } = __dgt; // common.js

  function unhideAll() {
    /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(`[${BOX}]`)).forEach(b => { b.style.removeProperty('display'); b.removeAttribute(BOX); });
  }

  const HEADINGS = 'h1,h2,h3,h4';
  // DEGIRO's Cash compensation section, found by its hook: its first heading counts as one of the
  // default titles in any language, as long as one of them is still in the list
  const CASH = DG_DEFAULTS.hiddenTitles.map(t => t.toLowerCase());
  const isCashTitle = h => CASH.some(t => titles.includes(t)) && h.closest(SEL.cashCompensation)?.querySelector(HEADINGS) === h;
  const matches = h => titles.includes(h.textContent.trim().toLowerCase()) || isCashTitle(h);
  // headings of this rank or higher (an h3 widget may have h4 subheadings)
  const rank = h => +h.tagName[1];
  const headingsIn = (el, r) => [...el.querySelectorAll(HEADINGS)].filter(x => rank(x) <= r).length;
  // never hide a box holding another section's title, prices, a chart or the page layout itself
  // (on product pages every widget sits in one mainPageSection, the chart included)
  const NEVER = `main, ${SEL.mainPageSection}, ${SEL.appLayout}`;
  const KEEP = `${SEL.bidPrice}, ${SEL.askPrice}, .highcharts-container, ${SEL.mainPageSection}`;
  const safe = (el, r) => !!el && el !== document.body && el !== document.documentElement &&
    !el.matches(NEVER) && !el.querySelector(KEEP) && headingsIn(el, r) <= 1;

  // the box to hide for a heading, or null if there is no safe one
  function boxFor(h) {
    const r = rank(h);
    /** @type {HTMLElement} */
    let box = h;
    // up to the section (or DEGIRO widget) around this heading; a data-name wrapper that holds
    // only the heading itself doesn't count
    const isWidget = el => el.matches('section') || (el.matches('[data-name]') && el.textContent.trim() !== h.textContent.trim());
    while (!isWidget(box) && safe(box.parentElement, r)) box = /** @type {HTMLElement} */ (box.parentElement);
    if (box === h) return null;
    // then up the wrappers that contain nothing but it, but not into a much taller one
    // (a whole column or page area)
    const height = box.getBoundingClientRect().height;
    while (box.parentElement && box.parentElement.children.length === 1 && safe(box.parentElement, r) &&
           box.parentElement.getBoundingClientRect().height <= height * 1.5 + 40) box = box.parentElement;
    return box;
  }

  function hide() {
    if (!titles.length) return 'idle';
    let found = false;
    // DEGIRO may reuse a hidden element for another section, or load more widgets into it later:
    // un-hide boxes whose title no longer matches or that now hold more than that section
    /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(`[${BOX}]`)).forEach(b => {
      const hs = [...b.querySelectorAll(HEADINGS)], h = hs.find(matches);
      if (!h || b.querySelector(KEEP) || headingsIn(b, rank(h)) > 1) { b.style.removeProperty('display'); b.removeAttribute(BOX); }
    });
    document.querySelectorAll(HEADINGS).forEach(h => {
      if (!matches(h)) return;
      found = true;
      if (h.closest(`[${BOX}]`)) return;
      const box = boxFor(h);
      if (!box) return;
      box.style.setProperty('display', 'none', 'important');
      box.setAttribute(BOX, '');
    });
    return found ? 'ok' : 'idle'; // sections only exist on some pages
  }

  dgOnSettings(s => {
    titles = (s.hiddenTitles || []).map(t => t.trim().toLowerCase()).filter(Boolean);
    // the list may have changed: start over (right away, so nothing flashes for a frame)
    unhideAll();
    if (s.hideSections) hide();
  });
  // characterData changes count too: a reused section may only get its heading text replaced
  feature({ name: 'hideSections', enabled: () => dgSettings.hideSections, run: hide, stop: unhideAll });
})();
