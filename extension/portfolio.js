// Portfolio value chart (Portfolio page):
//  • change over the selected period next to the total, e.g. "1Y € +49.641,12 (+54,07%)"
//  • drag-to-select a range, like on product charts
// The chart is drawn on a <canvas>, so values come from the same endpoint DEGIRO uses for it
// (/portfolio-metrics/.../portfolio/value), and pixel positions from the drawn line.
// Runs in page context (world: MAIN).
(() => {
  const ENDPOINT = '/portfolio-metrics/secure/api/v1/portfolio/value';
  const LINE = [0, 159, 223]; // DEGIRO blue used for the line
  const DG = {
    font: 'Inter, Helvetica, HelveticaNeue, sans-serif', text: '#0F171A', muted: '#798A90',
    upDot: '#078307', downDot: '#E3282B', upText: '#1E8302', downText: '#E3282B',
    upFill: 'rgba(7,131,7,.08)', downFill: 'rgba(227,40,43,.08)', edge: 'rgba(121,138,144,.7)'
  };
  const PERIODS = { ONE_MONTH: '1M', THREE_MONTHS: '3M', SIX_MONTHS: '6M', YEAR_TO_DATE: 'YTD', ONE_YEAR: '1Y', THREE_YEARS: '3Y', FIVE_YEARS: '5Y', ALL: 'ALL', MAX: 'ALL' };
  const CHANGE_ID = 'dg-portfolio-change';


  const { flags, pageTheme, fmt, SEL, page, own, feature } = __dgt; // common.js
  /** @type {(sel: string) => HTMLElement | null} */
  const $ = sel => document.querySelector(sel);

  // ---------- data: follow DEGIRO's own requests for the chart ----------
  let url = null, data = [], period = null, version = 0, versionAt = 0, loading = false;

  function seen(name) {
    try {
      const u = new URL(name, location.href);
      if (u.origin === location.origin && u.pathname === ENDPOINT) url = u;
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
    anchor.append(el); // inside the value block, right after the total
  }

  // ---------- canvas geometry: where the line is drawn ----------
  const lineCanvas = () => {
    const area = $(SEL.perfArea);
    return area && [...area.querySelectorAll('canvas')].find(c => c.getBoundingClientRect().width > 100);
  };
  const isLine = (d, i) => d[i + 3] > 200 && Math.abs(d[i] - LINE[0]) < 40 && Math.abs(d[i + 1] - LINE[1]) < 40 && Math.abs(d[i + 2] - LINE[2]) < 40;

  // horizontal extent of the line (css px, relative to the canvas) + pixel access
  let scratch = null, scratchCtx = null;
  function geometry() {
    const c = lineCanvas();
    if (!c) return null;
    let img;
    // copy into our own canvas (willReadFrequently) and read that, instead of reading DEGIRO's
    // canvas directly — repeated getImageData on it makes Chrome log a performance warning
    try {
      if (!scratch) { scratch = document.createElement('canvas'); scratchCtx = scratch.getContext('2d', { willReadFrequently: true }); }
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

  // DEGIRO greys the line right of the cursor while hovering, so read the canvas while not hovered.
  // The cache belongs to one canvas: DEGIRO builds a new chart when Portfolio is reached from another
  // page (same size, same data), and the old canvas is detached (its rect is all zeros). If the pointer
  // is already over the new chart, the line's extent is kept from the replaced canvas (`stale`), and
  // only the canvas and where the line is are read from the new one, until it is measured unhovered.
  let geoCache = null, geoAt = 0, geoKey = '', stale = null;
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
  let activeClear = null;
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

    let geo = null, start = null, dragging = false, moved = false;
    const offset = () => { const a = area.getBoundingClientRect(), c = geo.canvas.getBoundingClientRect(); return { x: c.left - a.left, y: c.top - a.top }; };
    const toX = e => {
      const c = geo.canvas.getBoundingClientRect();
      return Math.max(geo.left, Math.min(e.clientX - c.left, geo.right));
    };
    const idxAt = x => Math.round((x - geo.left) / (geo.right - geo.left) * (data.length - 1));

    function draw(xa, xb) {
      const n = data.length;
      if (n < 2) return;
      const i1 = idxAt(Math.min(xa, xb)), i2 = idxAt(Math.max(xa, xb));
      if (i1 === i2) return;
      const p1 = data[i1].value, p2 = data[i2].value;
      const L = geo.left + (geo.right - geo.left) * i1 / (n - 1);
      const R = geo.left + (geo.right - geo.left) * i2 / (n - 1);
      const o = offset();
      const diff = p2 - p1, pct = p1 ? diff / p1 * 100 : 0, up = diff >= 0, cur = currency();
      const th = pageTheme(area);
      Object.assign(band.style, {
        display: 'block', left: (o.x + L) + 'px', width: Math.max(R - L, 1) + 'px', top: o.y + 'px', height: geo.height + 'px',
        background: up ? DG.upFill : DG.downFill
      });
      [[dot1, L], [dot2, R]].forEach(([d, x]) => {
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
      if (e.button !== 0 || !flags()?.chartSelect || data.length < 2) return;
      geo = cachedGeometry();
      if (!geo) return;
      e.preventDefault();
      clear();
      try { area.setPointerCapture(e.pointerId); } catch (err) {}
      start = toX(e); dragging = true; moved = false;
      activeClear = clear;
    }, true); // capture: the chart may stop propagation
    area.addEventListener('pointermove', e => {
      if (!dragging) return;
      const x = toX(e);
      if (Math.abs(x - start) > 3) { moved = true; draw(start, x); }
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
    return url && area ? 'ok' : 'missing'; // DEGIRO's chart request or chart area not found
  }

  feature({
    name: 'portfolio',
    enabled: () => flags()?.periodChange || flags()?.chartSelect,
    run,
    stop: () => { document.getElementById(CHANGE_ID)?.remove(); lastKey = ''; sel.clear?.(); },
    throttle: 250,
    every: 500 // the chart is a canvas and its data comes over the network: no DOM changes to wait for
  });
})();
