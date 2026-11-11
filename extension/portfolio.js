// Portfolio value chart (Portfolio page):
//  • change over the selected period next to the total, e.g. "1Y € +49.641,12 (+54,07%)"
//  • drag-to-select a range, like on product charts
//  • cash per currency: today's cash next to the total, and a switch for stacked cash columns on the chart (EUR in green)
// The chart is drawn on a <canvas>, so values come from the same endpoint DEGIRO uses for it
// (/portfolio-metrics/.../portfolio/value), and pixel positions from the drawn line.
// Runs in page context (world: MAIN).
(() => {
  const ENDPOINT = '/portfolio-metrics/secure/api/v1/portfolio/value';
  const LINE = [0, 159, 223]; // DEGIRO blue used for the line
  const DG = {
    font: 'Roboto, Helvetica, HelveticaNeue, sans-serif', text: '#0F171A', muted: '#65757B',
    upDot: '#078307', downDot: '#E40101', upText: '#1E8302', downText: '#E40101',
    upFill: 'rgba(7,131,7,.08)', downFill: 'rgba(228,1,1,.08)', edge: 'rgba(101,117,123,.7)'
  };
  const PERIODS = { ONE_MONTH: '1M', THREE_MONTHS: '3M', SIX_MONTHS: '6M', YEAR_TO_DATE: 'YTD', ONE_YEAR: '1Y', THREE_YEARS: '3Y', FIVE_YEARS: '5Y', ALL: 'ALL', MAX: 'ALL' };
  const CHANGE_ID = 'dg-portfolio-change';


  const { flags, pageTheme, fmt, decimalSep, cashByDay, SEL, page, own, feature, schedule, ownRequests } = __dgt; // common.js
  /** @type {(sel: string) => HTMLElement | null} */
  const $ = sel => document.querySelector(sel);

  // ---------- data: follow DEGIRO's own requests for the chart ----------
  let url = /** @type {URL | null} */ (null), data = [], period = /** @type {string | null} */ (null),
    version = 0, versionAt = 0, loading = false;

  function seen(name) {
    try {
      const u = new URL(name, location.href);
      if (u.origin === location.origin && u.pathname === ENDPOINT && u.href !== url?.href) { url = u; schedule(); } // load it now
    } catch (e) {}
  }
  performance.getEntriesByType('resource').forEach(e => seen(e.name));
  try { new PerformanceObserver(l => l.getEntries().forEach(e => seen(e.name))).observe({ type: 'resource', buffered: true }); } catch (e) {}

  // a failed request is retried after 30 s, doubling (up to 10 min) while it keeps failing
  let loadedHref = '', failedHref = '', retryAt = 0, retryMs = 0;
  async function load() {
    if (!url || loading || url.href === loadedHref || (url.href === failedHref && Date.now() < retryAt)) return;
    loading = true;
    const target = url;
    let ok = false;
    try {
      // time out a hung request, so the chart isn't stuck waiting (then retried after 30 s)
      ownRequests.add(target.href); // orders.js doesn't take the session from our requests
      const r = await fetch(target.pathname + target.search, { credentials: 'include', signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const j = await r.json();
        const list = Array.isArray(j) ? j : (j?.data || j?.values || []);
        // DEGIRO returns newest first — sort oldest → newest to match the chart
        data = list.map(p => ({ date: p.date, value: +p.value, t: Date.parse(p.date) }))
          .filter(p => p.date && isFinite(p.value))
          .sort((a, b) => (a.t || 0) - (b.t || 0));
        period = PERIODS[target.searchParams.get('period')] || target.searchParams.get('period');
        loadedHref = target.href;
        version++; versionAt = Date.now();
        ok = true;
      }
    } catch (e) {}
    if (ok) { failedHref = ''; retryMs = 0; }
    else {
      retryMs = target.href === failedHref ? Math.min(600000, retryMs * 2) : 30000;
      failedHref = target.href; retryAt = Date.now() + retryMs;
    }
    loading = false;
    schedule(); // draw the new data now, not on the next timer run
  }

  // ---------- formatting ----------
  const money = (n, cur) => `${cur} ${n >= 0 ? '+' : '-'}${fmt(Math.abs(n))}`;
  const plain = (n, cur) => `${cur} ${fmt(n)}`;
  const pctTxt = p => `${p >= 0 ? '+' : ''}${fmt(p)}%`;
  const dateTxt = d => { const t = new Date(d); return isNaN(t.getTime()) ? String(d) : t.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }); };
  // DEGIRO's "hide values" mode blurs the portfolio total with a CSS filter.
  // Copy that filter onto our amounts and percentages so they are hidden too; dates stay readable.
  const hideFilter = () => {
    const a = $(SEL.perfAmount);
    const f = a ? getComputedStyle(a).filter : '';
    return /blur/.test(f) ? f : '';
  };
  const currency = () => (($(SEL.perfValue)?.textContent || '').match(/^[^\d\s+-]+/) || ['€'])[0];

  // ---------- period change next to the total ----------
  let lastKey = '';
  function renderChange() {
    const f = flags();
    const anchor = $(SEL.perfValue);
    let el = document.getElementById(CHANGE_ID);
    if (!f?.periodChange || !anchor || data.length < 2) { el?.remove(); lastKey = ''; return; }
    const p1 = data[0].value, p2 = data[data.length - 1].value;
    if (!(p1 > 0)) { el?.remove(); return; }
    const diff = p2 - p1, pct = diff / p1 * 100, up = diff >= 0, cur = currency(), hide = hideFilter();
    const key = [period, diff.toFixed(2), pct.toFixed(2), hide].join('|');
    if (el && key === lastKey && el.parentElement === anchor) return;
    lastKey = key;
    el?.remove();
    el = own(document.createElement('span'));
    el.id = CHANGE_ID;
    el.style.cssText = `display:inline-flex;align-items:baseline;gap:6px;margin-left:12px;font-family:${DG.font};`;
    el.title = __dgt.t('portfolioTitle');
    const label = document.createElement('span');
    label.textContent = period || '';
    label.style.cssText = `color:${DG.muted};font-size:12px;font-weight:500;`;
    const value = document.createElement('span');
    value.style.cssText = `color:${up ? DG.upText : DG.downText};font-size:14px;font-weight:500;`;
    const amount = document.createElement('span');
    amount.textContent = money(diff, cur);
    value.style.filter = hide; // amount and percentage
    value.append(amount, ` (${pctTxt(pct)})`);
    el.append(label, value);
    // inside the value block, right after the total (and before the cash amounts)
    const cash = document.getElementById(CASH_ID);
    if (cash?.parentElement === anchor) anchor.insertBefore(el, cash); else anchor.append(el);
  }

  // ---------- cash per currency ----------
  // Today's cash per currency comes from DEGIRO's update request (cashFunds, refreshed every minute);
  // the history from the account statement over the chart's dates (reloaded with the chart data, and
  // when today's cash changes). On the chart: one stacked column per day in its lower part, a segment
  // per currency. Amounts are not converted: the stack adds them as they are (€ 100 + $ 100 = 200).
  const CASH_ID = 'dg-portfolio-cash';
  const GOLD = '#e0a100'; // the alarm badges' gold
  const GREEN = '#078307'; // DEGIRO's green: EUR
  const OTHERS = [GOLD, '#a87800', '#f0c75e', '#7a5a00']; // the other currencies, in stack order
  const STACK_SHARE = 0.4; // the columns use the lower 40 % of the chart
  /** @param {string[]} order @returns {Record<string, string>} */
  const colorsFor = order => {
    let k = 0;
    return Object.fromEntries(order.map(cur => [cur, cur === 'EUR' ? GREEN : OTHERS[k++ % OTHERS.length]]));
  };
  const SYM = { EUR: '€', USD: '$', GBP: '£', JPY: '¥' };
  // the lines are shown with the switch next to "Cash"; off until switched on. The choice is a
  // convenience kept in this browser (page world: no chrome.storage); without storage it starts off.
  const LINES_KEY = 'dgTweaksCashLines';
  let linesOn = false;
  try { linesOn = localStorage.getItem(LINES_KEY) === '1'; } catch (e) {}
  const setLines = on => {
    linesOn = on;
    try { if (on) localStorage.setItem(LINES_KEY, '1'); else localStorage.removeItem(LINES_KEY); } catch (e) {}
    schedule();
  };
  // account and session of DEGIRO's own chart request: used for the requests below, kept in memory only
  const ids = () => {
    const a = url?.searchParams.get('intAccount') || '', s = url?.searchParams.get('sessionId') || '';
    return /^\d+$/.test(a) && /^[\w.-]+$/.test(s) ? { a, s } : null;
  };
  /** @typedef {{ busy: boolean, failed: boolean, retryAt: number, retryMs: number }} ReqState */
  /** @returns {ReqState} */
  const reqState = () => ({ busy: false, failed: false, retryAt: 0, retryMs: 0 });
  // GET a same-origin path; undefined when busy, waiting to retry, or failed. A failure is retried
  // after 30 s, doubling (up to 10 min) while it keeps failing.
  /** @param {ReqState} st @param {string} path */
  async function getJson(st, path) {
    if (st.busy || (st.failed && Date.now() < st.retryAt)) return undefined;
    st.busy = true;
    let j = /** @type {any} */ (null);
    try {
      ownRequests.add(path); // orders.js doesn't take the session from our requests
      const r = await fetch(path, { credentials: 'include', signal: AbortSignal.timeout(15000) });
      if (r.ok) j = await r.json();
    } catch (e) {}
    st.busy = false;
    if (j && typeof j === 'object') { st.failed = false; st.retryMs = 0; }
    else { st.retryMs = st.failed ? Math.min(600000, st.retryMs * 2) : 30000; st.failed = true; st.retryAt = Date.now() + st.retryMs; j = null; }
    schedule(); // draw the new data now
    return j || undefined;
  }

  /** @type {[string, number][] | null} */
  let funds = null;
  let fundsSig = '', fundsAt = 0, fundsChanged = 0;
  const fundsReq = reqState();
  async function loadFunds() {
    const id = ids();
    if (!id || Date.now() - fundsAt < 60000) return;
    const path = `/trading/secure/v5/update/${id.a};jsessionid=${encodeURIComponent(id.s)}?cashFunds=0`;
    const j = await getJson(fundsReq, path);
    if (!j) return;
    fundsAt = Date.now();
    /** @type {[string, number][]} */
    const out = [];
    const list = j.cashFunds?.value;
    for (const f of Array.isArray(list) ? list : []) {
      const o = Object.fromEntries((Array.isArray(f?.value) ? f.value : []).map(x => [x?.name, x?.value]));
      if (typeof o.currencyCode === 'string' && /^[A-Z]{3}$/.test(o.currencyCode) && typeof o.value === 'number' && isFinite(o.value))
        out.push([o.currencyCode, o.value]);
    }
    const sig = out.map(x => x.join(':')).join(',');
    if (funds && sig !== fundsSig) fundsChanged++; // cash moved: reload the statement for the chart
    funds = out; fundsSig = sig;
  }

  let moves = /** @type {any[] | null} */ (null), movesKey = '', cashVersion = 0;
  const movesReq = reqState();
  async function loadStatement() {
    const id = ids(), first = data[0]?.date, last = data[data.length - 1]?.date;
    const day = /^\d{4}-\d\d-\d\d$/;
    if (!id || data.length < 2 || !day.test(first) || !day.test(last)) return;
    const key = [version, fundsChanged].join('|');
    if (key === movesKey) return;
    const dmy = d => d.split('-').reverse().join('/'); // DD/MM/YYYY, as DEGIRO's Account statement asks
    const path = `/portfolio-reports/secure/v6/accountoverview?fromDate=${dmy(first)}&toDate=${dmy(last)}&intAccount=${id.a}&sessionId=${encodeURIComponent(id.s)}`;
    const j = await getJson(movesReq, path);
    if (!j) return;
    const list = j.data?.cashMovements;
    moves = Array.isArray(list) ? list : [];
    movesKey = key;
    cashVersion++;
  }

  // a series per currency with cash in the chart period: [currency, balance per chart day]; EUR first
  // (the bottom of the stack), then the largest
  /** @returns {[string, number[]][]} */
  function cashLines() {
    if (!moves || data.length < 2) return [];
    const days = data.map(p => p.date);
    const by = cashByDay(moves, days);
    // no movements in the period: the balance stayed what it is today
    for (const [cur, v] of funds || []) if (!by[cur] && v) by[cur] = days.map(() => v);
    return Object.entries(by)
      .filter(([, v]) => v.some(x => Math.abs(x) >= 0.005))
      .sort((a, b) => +(b[0] === 'EUR') - +(a[0] === 'EUR') ||
        Math.abs(b[1][b[1].length - 1]) - Math.abs(a[1][a[1].length - 1]) || (a[0] < b[0] ? -1 : 1));
  }
  const cashText = (cur, v) => `${SYM[cur] || cur} ${fmt(v)}`;

  // today's cash next to the total: "Cash ■ € 26.876,16 ■ $ 1.204,00"
  let cashTopKey = '';
  /** @param {[string, number[]][]} lines */
  function renderCashTop(lines) {
    const anchor = $(SEL.perfValue);
    let el = document.getElementById(CASH_ID);
    const order = lines.map(l => l[0]);
    /** @type {[string, number][]} */
    const items = (funds || lines.map(([c, v]) => /** @type {[string, number]} */ ([c, v[v.length - 1]])))
      .filter(([, v]) => Math.abs(v) >= 0.005)
      .sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99));
    if (!flags()?.portfolioCash || !anchor || !items.length) { el?.remove(); cashTopKey = ''; return; }
    const hide = hideFilter();
    const key = [items.map(x => x.join(':')).join(','), order.join(','), hide, decimalSep(), linesOn].join('|');
    if (el && key === cashTopKey && el.parentElement === anchor) return;
    cashTopKey = key;
    el?.remove();
    el = own(document.createElement('span'));
    el.id = CASH_ID;
    el.style.cssText = `display:inline-flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px;margin-left:16px;font-family:${DG.font};`;
    el.title = __dgt.t('cashTitle');
    const label = document.createElement('span');
    label.textContent = __dgt.t('cashLabel');
    label.style.cssText = `color:${DG.muted};font-size:12px;font-weight:500;`;
    el.append(label, lineSwitch());
    const colors = colorsFor(order);
    items.forEach(([cur, v]) => {
      const item = document.createElement('span');
      item.style.cssText = 'display:inline-flex;align-items:center;gap:5px;font-size:14px;font-weight:500;';
      item.setAttribute('data-currency', cur);
      if (colors[cur]) { // the colour of its part of the columns
        const sw = document.createElement('span');
        sw.style.cssText = `display:inline-block;width:10px;height:10px;border-radius:2px;background:${colors[cur]};`;
        item.append(sw);
      }
      const amount = document.createElement('span');
      amount.textContent = cashText(cur, v);
      amount.style.filter = hide;
      item.append(amount);
      el.append(item);
    });
    anchor.append(el);
  }

  // toggle switch for the cash columns: grey track when off, gold when on
  function lineSwitch() {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(linesOn));
    b.setAttribute('data-dg-cash-switch', '');
    b.setAttribute('aria-label', __dgt.t('cashLinesToggle'));
    b.title = __dgt.t('cashLinesToggle');
    b.style.cssText = `position:relative;flex:none;align-self:center;width:26px;height:14px;padding:0;margin:0;border:0;border-radius:7px;cursor:pointer;` +
      `background:${linesOn ? GOLD : '#C4CBCE'};transition:background .15s;`;
    const knob = document.createElement('span');
    knob.style.cssText = `position:absolute;top:2px;left:${linesOn ? 14 : 2}px;width:10px;height:10px;border-radius:50%;background:#fff;` +
      'box-shadow:0 1px 2px rgba(0,0,0,.25);transition:left .15s;';
    b.append(knob);
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); setLines(!linesOn); });
    return b;
  }

  // the cash columns: our own canvas over DEGIRO's. Its data-dg-cash lists the currencies, bottom up
  // (the colours are explained by the swatches next to the amounts and in the tooltip).
  let layer = /** @type {{ area: HTMLElement, canvas: HTMLCanvasElement } | null} */ (null), layerKey = '';
  const removeLayer = () => { layer?.canvas.remove(); layer = null; layerKey = ''; };
  /** @param {[string, number[]][]} lines */
  function renderCashLines(lines) {
    const area = $(SEL.perfArea);
    let geo = /** @type {Geometry | null} */ (null);
    if (flags()?.portfolioCash && area && lines.length) {
      refreshGeometry(false); // drops a cache of a replaced canvas
      if (!geoCache) refreshGeometry(true);
      // nothing measured unhovered yet: DEGIRO greys the line right of the cursor, so measuring now
      // would end the line there. Wait for the pointer to leave; keep what is drawn meanwhile.
      if (!geoCache && area.matches(':hover')) return;
      geo = geoCache || geometry();
    }
    if (!area || !geo || !geo.canvas.isConnected) { removeLayer(); return; }
    const c = geo.canvas.getBoundingClientRect(), a = area.getBoundingClientRect();
    if (c.width < 100) { removeLayer(); return; }
    const ox = c.left - a.left, oy = c.top - a.top, dpr = window.devicePixelRatio || 1;
    const key = [cashVersion, version, fundsSig, geo.left, geo.right, geo.height, c.width, ox, oy, dpr].join('|');
    if (layer && layer.area === area && layer.canvas.isConnected && key === layerKey) return;
    removeLayer();
    layerKey = key;
    if (getComputedStyle(area).position === 'static') area.style.position = 'relative';
    const canvas = own(document.createElement('canvas'));
    canvas.setAttribute('data-dg-cash', lines.map(l => l[0]).join(','));
    canvas.style.cssText = `position:absolute;left:${ox}px;top:${oy}px;width:${c.width}px;height:${geo.height}px;pointer-events:none;z-index:4;`;
    canvas.width = Math.round(c.width * dpr); canvas.height = Math.round(geo.height * dpr);
    area.appendChild(canvas);
    layer = { area, canvas };
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const n = data.length, bottom = 4, base = geo.height - bottom, h = base * STACK_SHARE;
    const step = (geo.right - geo.left) / (n - 1), w = Math.max(1, step * 0.7);
    const X = i => geo.left + step * i;
    // one shared scale: the highest day's stack (amounts added as they are, not converted)
    const totals = data.map((_, i) => lines.reduce((s, [, v]) => s + Math.max(0, v[i]), 0));
    const hi = Math.max(...totals) || 1;
    const colors = colorsFor(lines.map(l => l[0]));
    ctx.globalAlpha = 0.55; // the portfolio line stays visible through the columns
    for (let i = 0; i < n; i++) {
      let y = base;
      for (const [cur, v] of lines) {
        const seg = Math.max(0, v[i]) / hi * h;
        if (seg <= 0) continue;
        ctx.fillStyle = colors[cur];
        ctx.fillRect(X(i) - w / 2, y - seg, w, seg);
        y -= seg;
      }
    }
  }

  // ---------- cash in DEGIRO's hover tooltip ----------
  // Under its "Portfolio value" row: a row per currency with the cash of the hovered day, in the same
  // style (copied from DEGIRO's row). The day comes from the pointer's place along the line, like the
  // range selection, so it doesn't depend on the tooltip's date format.
  const TIP = 'data-dg-cash-tip';
  let tipLines = /** @type {[string, number[]][]} */ ([]), tipArea = /** @type {HTMLElement | null} */ (null),
    tipX = /** @type {number | null} */ (null), tipFrame = 0, tipKey = '';
  const removeTip = () => { document.querySelectorAll(`[${TIP}]`).forEach(r => r.remove()); tipKey = ''; };
  function updateTip() {
    tipFrame = 0;
    const area = $(SEL.perfArea), tip = area?.querySelector(SEL.perfTooltip);
    const geo = geoCache; // measured while not hovered (DEGIRO greys part of the line while hovered)
    if (!area || !tip || !tipLines.length || !geo || tipX == null || data.length < 2) { removeTip(); return; }
    const n = data.length, x = tipX - geo.canvas.getBoundingClientRect().left;
    const i = Math.max(0, Math.min(n - 1, Math.round((x - geo.left) / (geo.right - geo.left) * (n - 1))));
    const row = [...tip.children].find(c => !c.hasAttribute(TIP) && c.children.length >= 2); // "Portfolio value  € …"
    if (!row) { removeTip(); return; }
    const hide = hideFilter();
    const key = [i, hide, cashVersion, tipLines.map(l => l[0]).join(',')].join('|');
    const shown = tip.querySelectorAll(`[${TIP}]`);
    if (key === tipKey && shown.length === tipLines.length && tip.lastElementChild === shown[shown.length - 1]) return;
    removeTip();
    tipKey = key;
    const colors = colorsFor(tipLines.map(l => l[0]));
    for (const [cur, v] of tipLines) {
      const r = own(/** @type {HTMLElement} */ (row.cloneNode(false)));
      r.setAttribute(TIP, cur);
      const label = /** @type {HTMLElement} */ (row.children[0].cloneNode(false));
      label.style.display = 'inline-flex'; label.style.alignItems = 'center'; label.style.gap = '5px';
      const sw = document.createElement('span');
      sw.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:2px;background:${colors[cur]};`;
      label.append(sw, `${__dgt.t('cashLabel')} ${cur}`);
      const value = /** @type {HTMLElement} */ (row.children[1].cloneNode(false));
      value.textContent = cashText(cur, v[i]);
      value.style.filter = hide;
      r.append(label, value);
      tip.append(r);
    }
  }
  function attachTip() {
    const area = $(SEL.perfArea);
    if (!area || area === tipArea) return;
    tipArea = area;
    // after DEGIRO's own handler has drawn the tooltip for this position
    area.addEventListener('pointermove', e => { tipX = e.clientX; if (!tipFrame) tipFrame = requestAnimationFrame(updateTip); }, { passive: true });
    area.addEventListener('pointerleave', () => { tipX = null; });
  }

  function renderCash() {
    const lines = flags()?.portfolioCash && linesOn ? cashLines() : [];
    renderCashTop(lines);
    renderCashLines(lines);
    tipLines = lines;
    if (lines.length) attachTip(); else removeTip();
  }
  const stopCash = () => { document.getElementById(CASH_ID)?.remove(); cashTopKey = ''; removeLayer(); tipLines = []; removeTip(); };

  // ---------- steady row ----------
  // While the chart is hovered DEGIRO shows the value and date under the cursor in place of the total
  // and "Today". Their width changes with the text, which moved our items along the row. Both get a
  // fixed width: the amount fits the period's largest value (digits of equal width), the caption the
  // longest of "Today" and any date it has shown, at least the longest date of the year.
  const FIXED_STYLE = /** @type {const} */ (['minWidth', 'fontVariantNumeric', 'display']);
  let measurer = /** @type {CanvasRenderingContext2D | null} */ (null), steadyKey = '', captionMax = 0;
  /** @type {HTMLElement[]} */
  let steadied = [];
  const textWidth = (el, text) => {
    try { measurer ||= document.createElement('canvas').getContext('2d'); } catch (e) {}
    if (!measurer) return 0;
    const s = getComputedStyle(el);
    measurer.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    return measurer.measureText(text).width;
  };
  // the longest short date in the page's language, e.g. "Sep 28, 2026"
  const longestDate = el => {
    const lang = document.documentElement.lang || navigator.language || 'en';
    let w = 0;
    for (let m = 0; m < 12; m++) {
      let t = '';
      try { t = new Date(new Date().getFullYear(), m, 28).toLocaleDateString(lang, { month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) {}
      w = Math.max(w, textWidth(el, t.replace(/\d/g, '0')));
    }
    return w;
  };
  function unsteady() { steadied.forEach(el => FIXED_STYLE.forEach(p => { el.style[p] = ''; })); steadied = []; steadyKey = ''; captionMax = 0; }
  function steadyRow() {
    const amount = $(SEL.perfAmount), caption = $(SEL.perfCaption);
    if (!amount || data.length < 2) return;
    if (steadied.length && !steadied.every(el => el.isConnected)) unsteady(); // DEGIRO built a new chart
    const max = Math.max(...data.map(p => Math.abs(p.value)));
    const font = getComputedStyle(amount).font;
    // digits of equal width: measure them all as '0'
    const amountW = Math.ceil(Math.max(textWidth(amount, `${currency()} ${fmt(max)}`.replace(/\d/g, '0')), textWidth(amount, (amount.textContent || '').replace(/\d/g, '0'))));
    if (caption) captionMax = Math.max(captionMax, Math.ceil(Math.max(longestDate(caption), textWidth(caption, (caption.textContent || '').replace(/\d/g, '0')))));
    const key = [amountW, captionMax, font].join('|');
    if (key === steadyKey && steadied.length) return;
    steadyKey = key;
    /** @type {[HTMLElement | null, number][]} */ ([[amount, amountW], [caption, captionMax]]).forEach(([el, w]) => {
      if (!el || !w) return;
      el.style.display = 'inline-block';
      el.style.minWidth = w + 'px';
      el.style.fontVariantNumeric = 'tabular-nums';
      if (!steadied.includes(el)) steadied.push(el);
    });
  }

  // ---------- canvas geometry: where the line is drawn ----------
  const lineCanvas = () => {
    const area = $(SEL.perfArea);
    return area && [...area.querySelectorAll('canvas:not([data-dg-own])')].find(/** @returns {c is HTMLCanvasElement} */ c => c.getBoundingClientRect().width > 100);
  };
  const isLine = (d, i) => d[i + 3] > 200 && Math.abs(d[i] - LINE[0]) < 40 && Math.abs(d[i + 1] - LINE[1]) < 40 && Math.abs(d[i + 2] - LINE[2]) < 40;

  // horizontal extent of the line (css px, relative to the canvas) + pixel access
  let scratch = /** @type {HTMLCanvasElement | null} */ (null), scratchCtx = /** @type {CanvasRenderingContext2D | null} */ (null);
  function geometry() {
    const c = lineCanvas();
    if (!c) return null;
    let img;
    // copy into our own canvas (willReadFrequently) and read that, instead of reading DEGIRO's
    // canvas directly — repeated getImageData on it makes Chrome log a performance warning
    try {
      if (!scratch) { scratch = document.createElement('canvas'); scratchCtx = scratch.getContext('2d', { willReadFrequently: true }); }
      if (!scratchCtx) return null; // getContext can fail (e.g. too many contexts already open)
      if (scratch.width !== c.width || scratch.height !== c.height) { scratch.width = c.width; scratch.height = c.height; }
      scratchCtx.clearRect(0, 0, c.width, c.height);
      scratchCtx.drawImage(c, 0, 0);
      img = scratchCtx.getImageData(0, 0, c.width, c.height);
    } catch (e) { return null; }
    const { data: d, width: W, height: Hh } = img;
    const colHasLine = x => { for (let y = 0; y < Hh; y++) if (isLine(d, (y * W + x) * 4)) return true; return false; };
    let first = -1, last = -1;
    for (let x = 0; x < W; x++) if (colHasLine(x)) { first = x; break; }
    for (let x = W - 1; x >= 0; x--) if (colHasLine(x)) { last = x; break; }
    if (first < 0 || last <= first) return null;
    const scale = W / c.getBoundingClientRect().width;
    const lineY = xCss => {
      const x = Math.min(W - 1, Math.max(0, Math.round(xCss * scale)));
      for (let dx = 0; dx <= 3; dx++) for (const xx of [x - dx, x + dx]) {
        if (xx < 0 || xx >= W) continue;
        for (let y = 0; y < Hh; y++) if (isLine(d, (y * W + xx) * 4)) return y / scale;
      }
      return null;
    };
    return { canvas: c, w: W, h: Hh, left: first / scale, right: last / scale, height: Hh / scale, lineY };
  }

  /** @typedef {{ canvas: HTMLCanvasElement, w: number, h: number, left: number, right: number, height: number, lineY: (xCss: number) => number | null }} Geometry */
  // DEGIRO greys the line right of the cursor while hovering, so read the canvas while not hovered.
  // The cache belongs to one canvas: DEGIRO builds a new chart when Portfolio is reached from another
  // page (same size, same data), and the old canvas is detached (its rect is all zeros). If the pointer
  // is already over the new chart, the line's extent is kept from the replaced canvas (`stale`), and
  // only the canvas and where the line is are read from the new one, until it is measured unhovered.
  let geoCache = /** @type {Geometry | null} */ (null), geoAt = 0, geoKey = '', stale = /** @type {Geometry | null} */ (null);
  function refreshGeometry(force) {
    const area = $(SEL.perfArea);
    const c = lineCanvas();
    if (!area || !c) return;
    if (geoCache && geoCache.canvas !== c) { stale = geoCache; geoCache = null; geoKey = ''; }
    const key = [version, c.width, c.height].join('|');
    const settling = Date.now() - versionAt < 3000; // DEGIRO redraws shortly after new data
    if (!force && !settling && key === geoKey && Date.now() - geoAt < 10000) return;
    if (area.matches(':hover')) {
      if (!geoCache && stale && stale.w === c.width && stale.h === c.height) {
        const g = geometry();
        if (g) geoCache = { ...g, left: stale.left, right: stale.right, height: stale.height }; // geoKey stays '': re-measured once unhovered
      }
      return;
    }
    const g = geometry();
    if (g) { geoCache = g; geoAt = Date.now(); geoKey = key; stale = null; }
  }
  const cachedGeometry = () => {
    refreshGeometry(false); // drops a cache of a replaced canvas
    if (!geoCache) refreshGeometry(true);
    return geoCache || geometry();
  };

  // ---------- drag-to-select ----------
  // the chart area we attached to, its clear(), and the hide-values filter of the shown selection
  /** @type {{ area: HTMLElement | null, clear: (() => void) | null, hide: string | null }} */
  const sel = { area: null, clear: null, hide: null };
  // one Esc listener for the page (clears the current selection)
  let activeClear = /** @type {(() => void) | null} */ (null);
  window.addEventListener('keydown', e => { if (e.key === 'Escape') activeClear?.(); });

  function attachSelect() {
    const area = $(SEL.perfArea);
    if (!area || area === sel.area) return;
    sel.area = area;
    area.setAttribute('data-dg-sel', ''); // marks the chart with selection attached (used by the tests)
    if (getComputedStyle(area).position === 'static') area.style.position = 'relative';
    area.style.touchAction = 'pan-y';

    const mk = css => { const d = own(document.createElement('div')); d.style.cssText = css; d.style.display = 'none'; area.appendChild(d); return d; };
    const band = mk(`position:absolute;pointer-events:none;z-index:5;border-left:1px solid ${DG.edge};border-right:1px solid ${DG.edge};`);
    const label = mk(`position:absolute;pointer-events:none;z-index:6;padding:6px 10px;border-radius:4px;background:#fff;font-family:${DG.font};font-size:12px;line-height:18px;color:${DG.text};white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.08),0 2px 6px rgba(0,0,0,.12);`);
    const dotCss = 'position:absolute;pointer-events:none;z-index:7;box-sizing:border-box;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid #fff;';
    const dot1 = mk(dotCss), dot2 = mk(dotCss);
    const parts = [band, label, dot1, dot2];
    const clear = () => parts.forEach(p => p.style.display = 'none');
    sel.clear = clear;

    let geo = /** @type {Geometry | null} */ (null), start = /** @type {number | null} */ (null),
      dragging = false, moved = false;
    /** @param {Geometry} geo */
    const offset = geo => { const a = area.getBoundingClientRect(), c = geo.canvas.getBoundingClientRect(); return { x: c.left - a.left, y: c.top - a.top }; };
    /** @param {Geometry} geo */
    const toX = (geo, e) => {
      const c = geo.canvas.getBoundingClientRect();
      return Math.max(geo.left, Math.min(e.clientX - c.left, geo.right));
    };
    /** @param {Geometry} geo */
    const idxAt = (geo, x) => Math.round((x - geo.left) / (geo.right - geo.left) * (data.length - 1));

    /** @param {Geometry} geo */
    function draw(geo, xa, xb) {
      const n = data.length;
      if (n < 2) return;
      const i1 = idxAt(geo, Math.min(xa, xb)), i2 = idxAt(geo, Math.max(xa, xb));
      if (i1 === i2) return;
      const p1 = data[i1].value, p2 = data[i2].value;
      const L = geo.left + (geo.right - geo.left) * i1 / (n - 1);
      const R = geo.left + (geo.right - geo.left) * i2 / (n - 1);
      const o = offset(geo);
      const diff = p2 - p1, pct = p1 ? diff / p1 * 100 : 0, up = diff >= 0, cur = currency();
      const th = pageTheme(area);
      Object.assign(band.style, {
        display: 'block', left: (o.x + L) + 'px', width: Math.max(R - L, 1) + 'px', top: o.y + 'px', height: geo.height + 'px',
        background: up ? DG.upFill : DG.downFill
      });
      /** @type {[HTMLDivElement, number][]} */ ([[dot1, L], [dot2, R]]).forEach(([d, x]) => {
        const y = geo.lineY(x);
        if (y == null) { d.style.display = 'none'; return; }
        Object.assign(d.style, { display: 'block', left: (o.x + x) + 'px', top: (o.y + y) + 'px', background: up ? DG.upDot : DG.downDot, borderColor: th.bg });
      });
      const line = (text, css) => { const d = document.createElement('div'); d.style.cssText = css; d.textContent = text; return d; };
      const hide = hideFilter();
      const amt = text => { const s = document.createElement('span'); s.textContent = text; s.style.filter = hide; return s; };
      const head = line('', `font-size:14px;font-weight:500;color:${up ? th.upText : th.downText}`);
      head.append(amt(`${money(diff, cur)} (${pctTxt(pct)})`));
      const sub = line('', `font-size:11px;color:${DG.muted}`);
      sub.append(amt(`${plain(p1, cur)} → ${plain(p2, cur)}`), ` · ${dateTxt(data[i1].date)} → ${dateTxt(data[i2].date)}`);
      label.replaceChildren(head, sub);
      sel.hide = hide;
      Object.assign(label.style, { display: 'block', background: th.bg, color: th.text, boxShadow: th.shadow, border: th.border });
      label.style.top = (o.y + 6) + 'px';
      const lw = label.offsetWidth, mid = o.x + (L + R) / 2;
      label.style.left = Math.max(o.x, Math.min(mid - lw / 2, o.x + geo.right - lw)) + 'px';
    }

    // DEGIRO's chart cancels pointerdown, which suppresses mouse* events — use pointer events
    area.addEventListener('pointerdown', e => {
      // End any drag still open here (a failed setPointerCapture means its pointerup never
      // reached us, and a second pointer lands while the first is down): no return below may
      // leave `dragging` set with `geo` cleared, which pointermove would then read.
      dragging = false;
      if (e.button !== 0 || !flags()?.chartSelect || data.length < 2) return;
      geo = cachedGeometry();
      if (!geo) return; // chart mid-render: nothing to measure against
      e.preventDefault();
      clear();
      try { area.setPointerCapture(e.pointerId); } catch (err) {}
      start = toX(geo, e); dragging = true; moved = false;
      activeClear = clear;
    }, true); // capture: the chart may stop propagation
    area.addEventListener('pointermove', e => {
      if (!dragging || geo == null || start == null) return;
      const x = toX(geo, e);
      if (Math.abs(x - start) > 3) { moved = true; draw(geo, start, x); }
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (!moved) clear();
    };
    area.addEventListener('pointerup', end);
    area.addEventListener('pointercancel', end);
  }

  let seenVersion = -1;
  function run() {
    if (!page.isPortfolio()) return 'idle';
    load();
    attachSelect();
    const area = $(SEL.perfArea);
    const clear = area && area === sel.area ? sel.clear : null;
    if (version !== seenVersion) { seenVersion = version; clear?.(); } // new period/data
    if (!flags()?.chartSelect) clear?.();
    if (clear && sel.hide != null && sel.hide !== hideFilter()) clear(); // hide values toggled
    refreshGeometry(false);
    renderChange();
    if (flags()?.portfolioCash) { loadFunds(); if (linesOn) loadStatement(); }
    steadyRow();
    renderCash();
    return url && area ? 'ok' : 'missing'; // DEGIRO's chart request or chart area not found
  }

  feature({
    name: 'portfolio',
    enabled: () => flags()?.periodChange || flags()?.chartSelect || flags()?.portfolioCash,
    run,
    stop: () => { document.getElementById(CHANGE_ID)?.remove(); lastKey = ''; sel.clear?.(); stopCash(); unsteady(); },
    throttle: 250,
    every: 500 // the chart is a canvas and its data comes over the network: no DOM changes to wait for
  });
})();
