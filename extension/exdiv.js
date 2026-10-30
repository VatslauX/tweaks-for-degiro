// Product header: "Ex-div 12/11/2026" after the spread, when DEGIRO's Dividends widget knows the
// ex-dividend date. Clicking it scrolls to the Dividends section (without touching the app's hash route).
(() => {
  const ID = 'dg-exdiv';
  const BLUE = '#009FDF', MUTED = '#798A90';
  const { SEL, LABELS, page, own, feature } = __dgt; // common.js
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
      box.style.cssText = 'display:flex;flex-wrap:wrap;align-items:baseline;column-gap:12px;row-gap:2px;margin-left:12px;min-width:0;max-width:100%;';
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


  // dd/mm/yyyy (DEGIRO) or ISO in the datetime attribute
  function parseDate(timeEl) {
    const iso = Date.parse(timeEl.getAttribute('datetime') || '');
    if (!isNaN(iso)) return new Date(iso);
    const m = timeEl.textContent.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  }

  function dividendsWidget() {
    const title = document.querySelector(SEL.dividendsTitle) ||
      [...document.querySelectorAll('h2,h3')].find(h => LABELS.dividends.test(h.textContent.trim()));
    if (!title) return null;
    let w = title;
    while (w.parentElement && w.parentElement.querySelectorAll('h2,h3').length === 1) w = w.parentElement;
    return w;
  }

  function headerLine() {
    const rel = [...document.querySelectorAll(SEL.relativeDifference)].find(e => visible(e) && e.closest('h4'));
    return rel?.closest('h4')?.parentElement?.parentElement || null;
  }

  function render() {
    let el = document.getElementById(ID);
    const time = [...document.querySelectorAll(SEL.exDividendDate)].find(t => /\d/.test(t.textContent));
    const line = headerLine();
    if (!time || !line) {
      leaveHeader(el);
      // no date is normal (not every product pays dividends); a missing header line is not
      return !page.isProduct() ? 'idle' : line ? 'idle' : 'missing';
    }

    const text = time.textContent.trim();
    if (!el) {
      el = own(document.createElement('a'));
      el.id = ID;
      el.setAttribute('role', 'link');
      el.tabIndex = 0;
      el.style.cssText = 'display:inline-flex;align-items:baseline;gap:4px;cursor:pointer;text-decoration:none;';
      const label = document.createElement('span');
      label.textContent = __dgt.t('exDivLabel');
      label.style.cssText = `color:${MUTED};font-size:12px;font-weight:500;`;
      const value = document.createElement('span');
      value.style.cssText = 'font-size:14px;font-weight:500;';
      el.append(label, value);
      const go = e => {
        e.preventDefault();
        const w = dividendsWidget();
        if (!w) return;
        w.scrollIntoView({ behavior: 'smooth', block: 'center' });
        w.animate?.([{ backgroundColor: 'rgba(0,159,223,.15)' }, { backgroundColor: 'transparent' }], { duration: 1200 });
      };
      el.addEventListener('click', go);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') go(e); });
      const v = /** @type {HTMLElement} */ (el.lastElementChild);
      el.onmouseenter = () => { v.style.textDecoration = 'underline'; };
      el.onmouseleave = () => { v.style.textDecoration = 'none'; };
    }
    const value = /** @type {HTMLElement} */ (el.lastElementChild);
    const d = parseDate(time);
    const past = d && d < new Date(new Date().toDateString());
    if (value.textContent !== text) value.textContent = text;
    value.style.color = past ? MUTED : BLUE;
    el.title = __dgt.t(past ? 'exDivTitlePast' : 'exDivTitle');
    if (!placeInHeader(el, line, 2)) return 'missing'; // last: after the period change and spread
    return 'ok';
  }

  feature({
    name: 'exDividend',
    enabled: () => dgSettings.exDividend,
    run: render,
    stop: () => leaveHeader(document.getElementById(ID)),
    every: 2000
  });
})();
