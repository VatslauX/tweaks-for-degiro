// Bid/ask spread: a Spread row in Pricing data and "Spread 0,08%" in the product header.
(() => {
  const ROW_ATTR = 'data-spread-row';
  const { SEL, page, own, isPriceDt, priceDts, feature, t, pageTheme } = __dgt; // common.js

  const parse = t => __dgt.parseNum(t);

  function decimals(text) {
    const m = (text || '').match(/[.,](\d+)\s*$/);
    return m ? m[1].length : 0;
  }

  function fmt(n, dec, comma) {
    const s = n.toFixed(dec);
    return comma ? s.replace('.', ',') : s;
  }

  // DEGIRO colours: green like a price rise, red like a fall
  function color(pct, th) {
    if (pct < 0.1) return th.upText;
    if (pct < 0.5) return th.dark ? '#F2A33A' : '#C26A00';
    return th.downText;
  }

  // copy the text styling of the deepest text element in `src` onto `target`
  function matchFont(target, src) {
    if (!target || !src) return;
    let leaf = src;
    while (leaf.firstElementChild && leaf.firstElementChild.textContent.trim()) leaf = leaf.firstElementChild;
    const s = getComputedStyle(leaf);
    for (const p of ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing']) {
      const v = s.getPropertyValue(p);
      if (target.style.getPropertyValue(p) !== v) target.style.setProperty(p, v);
    }
  }

  const HEAD_ID = 'dg-header-spread';
  const HEAD_ATTR = 'data-dg-head';
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


  // spread for one Bid/Ask pair: { pct, text, comma } or null
  function compute(bidTxt, askTxt) {
    const bid = parse(bidTxt), ask = parse(askTxt);
    if (!(bid > 0 && ask > 0 && ask >= bid)) return null;
    const spread = ask - bid;
    const pct = spread / ((ask + bid) / 2) * 100;
    const comma = /,\d+\s*$/.test(askTxt) || /,\d+\s*$/.test(bidTxt);
    const dec = Math.max(decimals(bidTxt), decimals(askTxt));
    const cur = (askTxt.match(/^[^\d-]+/) || [''])[0];
    return { pct, comma, text: `${cur}${fmt(spread, dec, comma)} (${fmt(pct, 2, comma)}%)` };
  }

  // Spread row at the bottom of the Ask column in Pricing data
  function renderRow(askDt, askDd, res, bidTxt, askTxt) {
    const flat = askDt.parentElement.tagName === 'DL';
    const column = flat ? null : askDt.parentElement.parentElement;
    let row = flat
      ? (askDd.nextElementSibling?.hasAttribute(ROW_ATTR) ? askDd.nextElementSibling : null)
      : column.querySelector(`:scope > [${ROW_ATTR}]`);
    const anchor = flat ? askDd : askDt.parentElement;

    if (!row) {
      if (flat) {
        row = askDt.cloneNode(false);
        row.textContent = t('spread');
        own(row).setAttribute(ROW_ATTR, '');
        const dd = askDd.cloneNode(false);
        own(dd).setAttribute(ROW_ATTR, 'v');
        askDd.after(row); row.after(dd);
      } else {
        row = anchor.cloneNode(false);
        own(row).setAttribute(ROW_ATTR, '');
        const dt = askDt.cloneNode(false); dt.textContent = t('spread');
        const dd = askDd.cloneNode(false);
        row.append(dt, dd);
        column.append(row); // last row of the Ask column keeps both columns aligned
      }
    }
    const dd = flat ? row.nextElementSibling : row.querySelector('dd');
    if (!dd) return;
    // DEGIRO sets the text size on an inner span, which a shallow clone loses — copy it over
    matchFont(flat ? row : row.querySelector('dt'), askDt);
    matchFont(dd, askDd);

    const text = res ? res.text : '—';
    if (dd.textContent !== text) {
      dd.textContent = text;
      dd.style.color = res ? color(res.pct, pageTheme(dd)) : '';
      dd.title = t('spreadValueTitle', bidTxt, askTxt);
    }
  }

  // "Spread 0,08%" at the end of the price line in the product header; false if the line wasn't found
  function renderHeader(res) {
    let el = document.getElementById(HEAD_ID);
    const rel = [...document.querySelectorAll(SEL.relativeDifference)].find(e => visible(e) && e.closest('h4'));
    const line = rel?.closest('h4')?.parentElement?.parentElement;
    if (!dgSettings.headerSpread || !res || !line) { leaveHeader(el); return !!line || !dgSettings.headerSpread || !res; }
    if (!el) {
      el = own(document.createElement('span'));
      el.id = HEAD_ID;
      el.setAttribute(HEAD_ATTR, '');
      el.style.cssText = 'display:inline-flex;align-items:baseline;gap:4px;';
      const label = document.createElement('span');
      label.textContent = t('spread');
      label.style.cssText = 'color:#798A90;font-size:12px;font-weight:500;';
      const value = /** @type {HTMLElement} */ (rel.cloneNode(false)); // DEGIRO's text style for the daily change
      for (const a of [...value.attributes]) if (a.name.startsWith('data-')) value.removeAttribute(a.name);
      value.removeAttribute('title');
      el.append(label, value);
    }
    if (!placeInHeader(el, line, 1)) return false; // after the period change, before the ex-dividend link
    const value = /** @type {HTMLElement} */ (el.lastElementChild);
    const text = `${fmt(res.pct, 2, res.comma)}%`;
    if (value.textContent !== text) value.textContent = text;
    const col = color(res.pct, pageTheme(line));
    if (value.style.color !== col) value.style.color = col;
    el.title = t('spreadHeaderTitle');
    return true;
  }

  function update() {
    if (!dgSettings.spread) document.querySelectorAll(`[${ROW_ATTR}]`).forEach(el => el.remove());
    let headerRes = null, pairs = 0;

    priceDts('Bid').forEach(bidDt => {
      // Smallest ancestor that also contains an Ask row = this table copy
      let scope = bidDt.parentElement, askDt = null;
      while (scope && scope !== document.body) {
        askDt = [...scope.querySelectorAll('dt')].find(dt => isPriceDt(dt, 'Ask'));
        if (askDt) break;
        scope = scope.parentElement;
      }
      const bidDd = bidDt.nextElementSibling;
      const askDd = askDt?.nextElementSibling;
      if (!askDt || !bidDd || !askDd) return;
      pairs++;

      const bidTxt = bidDd.textContent.trim();
      const askTxt = askDd.textContent.trim();
      const res = compute(bidTxt, askTxt);
      if (res && (!headerRes || visible(bidDt))) headerRes = res; // prefer the visible copy
      if (dgSettings.spread) renderRow(askDt, askDd, res, bidTxt, askTxt);
    });

    const header = renderHeader(headerRes);
    if (!page.isProduct()) return 'idle';
    return pairs && header ? 'ok' : 'missing';
  }

  feature({
    name: 'spread',
    enabled: () => dgSettings.spread || dgSettings.headerSpread,
    run: update,
    stop: () => { document.querySelectorAll(`[${ROW_ATTR}]`).forEach(el => el.remove()); renderHeader(null); },
    every: 5000 // safety net only — DOM changes (quote updates) trigger runs
  });
})();
