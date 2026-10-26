// Period change next to the daily change in the product header.
// DEGIRO only shows the 1-day change; for 1W, 1M, YTD… we add e.g. "1M +0,054 (+2,06%)",
// computed from the first and last point of the chart for the selected period.
// Runs in page context (world: MAIN) to read window.Highcharts.
(() => {
  const ID = 'dg-period-change';
  const MUTED = '#798A90';

  const { flags, pageTheme, mainChart, priceSeries, xs, ys, fmt, SEL, LABELS, page, own, feature } = __dgt; // common.js
  const PERIOD = LABELS.period;
  const visible = el => el && el.getBoundingClientRect().height > 0;
  // Our header items (period change 0, spread 1, ex-div 2) share one wrapping container placed right
  // after DEGIRO's nowrap price line, so a narrow header wraps instead of overflowing. period.js,
  // content.js and exdiv.js each carry this helper (they run alone or together, in two worlds).
  const HEADER_BOX = 'data-dg-header';
  function placeInHeader(el, line, rank) {
    const parent = line.parentElement;
    if (!parent) return false;
    let box = line.nextElementSibling?.hasAttribute(HEADER_BOX) ? line.nextElementSibling : parent.querySelector(`:scope > [${HEADER_BOX}]`);
    if (!box) {
      box = own(document.createElement('div'));
      box.setAttribute(HEADER_BOX, '');
      box.style.cssText = 'display:flex;flex-wrap:wrap;align-items:baseline;column-gap:12px;row-gap:2px;min-width:0;max-width:100%;';
    }
    if (box.previousElementSibling !== line) line.after(box);
    el.setAttribute('data-dg-rank', String(rank));
    const next = [...box.children].find(c => c !== el && +(c.getAttribute('data-dg-rank') || 0) > rank) || null;
    if (el.parentElement !== box || el.nextElementSibling !== next) box.insertBefore(el, next);
    return true;
  }
  function leaveHeader(el) {
    const box = el?.parentElement?.hasAttribute(HEADER_BOX) ? el.parentElement : null;
    el?.remove();
    if (box && !box.firstElementChild) box.remove();
  }


  const periodButtons = () => [...document.querySelectorAll('button')].filter(b => PERIOD.test(b.textContent.trim()) && visible(b));
  const labelOf = b => b.textContent.trim().replace(' ', '');

  // The selected period: remembered from clicks; otherwise the one button styled differently
  // from the rest. While another button is hovered two buttons differ — then keep the last known.
  let clicked = null, lastKnown = null;
  document.addEventListener('click', e => {
    const b = /** @type {Element} */ (e.target).closest?.('button');
    if (b && PERIOD.test(b.textContent.trim())) clicked = labelOf(b);
  }, true);

  function selectedPeriod() {
    const btns = periodButtons();
    if (btns.length < 3) return null;
    if (clicked && btns.some(b => labelOf(b) === clicked)) return (lastKnown = clicked);
    const bg = btns.map(b => getComputedStyle(b).backgroundColor);
    const odd = btns.filter((b, i) => bg.filter(x => x === bg[i]).length === 1);
    if (odd.length === 1) lastKnown = labelOf(odd[0]);
    return lastKnown;
  }

  // Does the chart data cover the selected period? (After a click the button changes at once,
  // but the new data arrives later — until then the chart still shows the old period.)
  const DAY = 864e5;
  // DEGIRO's 1W chart holds only the trading days in the window (intraday points, often ~3 days),
  // so 1W only needs to be longer than a 1D chart (one session, < 1 day).
  const MIN_SPAN = { '1W': 1 };
  const EXPECTED = { '1W': 7, '1M': 30, '3M': 91, '6M': 182, '1Y': 365, '3Y': 3 * 365, '5Y': 5 * 365 };
  function dataMatches(period, s) {
    const x = xs(s);
    if (!x.length) return false;
    const span = (x[x.length - 1] - x[0]) / DAY;
    let want = EXPECTED[period];
    if (period === 'YTD') want = (Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / DAY;
    if (!want) return true; // ALL or unknown: can't check
    return span >= (MIN_SPAN[period] ?? want * 0.5) && span <= want * 1.6;
  }



  const close = y => Array.isArray(y) ? y[y.length - 1] : y;

  // anchor: the wrapper around DEGIRO's daily +abs (+rel%) in the header
  function anchor() {
    const rel = [...document.querySelectorAll(SEL.relativeDifference)].find(e => visible(e) && e.closest('h4'));
    return rel?.closest('h4')?.parentElement || null;
  }

  let lastKey = '';
  function render() {
    const existing = document.getElementById(ID);
    const hide = st => { leaveHeader(existing); lastKey = ''; return st; };
    if (!page.isProduct()) return hide('idle');
    const wrap = anchor();
    const period = wrap && selectedPeriod();
    const s = period && priceSeries(mainChart());
    if (!wrap || !period || !s) return hide('missing');
    if (period === '1D') return hide('idle');           // DEGIRO already shows the daily change
    if (!dataMatches(period, s)) return hide('ok');     // chart still loading the new period
    const y = ys(s), p1 = close(y[0]), p2 = close(y[y.length - 1]);
    if (!(p1 > 0) || !(p2 > 0)) return hide('ok');

    const diff = p2 - p1, pct = diff / p1 * 100, up = diff >= 0;
    const text = `${up ? '+' : ''}${fmt(diff, p2 < 10 ? 3 : 2)} (${up ? '+' : ''}${fmt(pct, 2)}%)`;
    const th = pageTheme(wrap);
    const key = period + '|' + text + '|' + th.dark;
    if (key === lastKey && existing && placeInHeader(existing, wrap.parentElement, 0)) return 'ok';
    lastKey = key;

    leaveHeader(existing);
    const box = own(document.createElement('span'));
    box.id = ID;
    box.style.cssText = 'display:inline-flex;align-items:baseline;gap:4px;';
    box.title = __dgt.t('periodTitle', period);
    const label = document.createElement('span');
    label.textContent = period;
    label.style.cssText = `color:${MUTED};font-size:12px;font-weight:500;`;
    // same text style as DEGIRO's daily change
    const value = /** @type {HTMLElement} */ ((wrap.firstElementChild || document.createElement('span')).cloneNode(false));
    value.textContent = text;
    value.style.color = up ? th.upText : th.downText;
    box.append(label, value);
    if (!placeInHeader(box, wrap.parentElement, 0)) return hide('missing');
    return 'ok';
  }

  feature({
    name: 'periodChange',
    enabled: () => flags()?.periodChange,
    run: render,
    stop: () => { leaveHeader(document.getElementById(ID)); lastKey = ''; },
    throttle: 250, // chart hover changes the DOM constantly; the button scan reads styles
    every: 1000
  });
})();
