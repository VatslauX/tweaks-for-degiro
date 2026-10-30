// Price alarms on the DEGIRO product chart: a gold badge at each switched-on alarm's price, on the
// right edge of the plot area, with a bell and the price. Display only. Runs in the page context
// (world: MAIN). The alarms come from alarms.js through the data-dg-alarm-lines attribute on <html>.
// The page can write it too, so it is checked strictly and used only as numbers; text is set with textContent.
(() => {
  const GOLD = '#e0a100', MAX = 25, ATTR = 'data-dg-alarm-lines';
  const BELL = 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0'; // ui.js BELL (not reachable from here)
  const H_LABEL = 16; // badge height: 14px line + border
  const { flags: readFlags, mainChart, fmt, page, own, feature } = __dgt; // common.js
  let F = null;
  // the chart identified as main by the last run(): a cheap cache so the redraw hook (which fires
  // on every chart, on every tick) never has to call mainChart() (a getBoundingClientRect per chart)
  let lastMain = null;
  // per chart: label layer, render signature (charts are DEGIRO's objects)
  /** @type {WeakMap<object, { layer: HTMLElement | null, sig: string, hooked: boolean }>} */
  const state = new WeakMap();
  const stateOf = chart => { let st = state.get(chart); if (!st) state.set(chart, st = { layer: null, sig: '', hooked: false }); return st; };

  // {"id": <product id>, "l": [{"p": <price>, "d": "above" | "below"}, ...]}; anything else, or one
  // malformed entry, and the whole value is ignored. Parsed only when the attribute changes.
  let raw = /** @type {string | null} */ (null), parsed = /** @type {{ id: number, prices: number[] } | null} */ (null);
  /** @param {string | null} r */
  function parse(r) {
    let v = null;
    try { v = r ? JSON.parse(r) : null; } catch (e) { return null; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    if (!Number.isSafeInteger(v.id) || v.id <= 0 || !Array.isArray(v.l) || v.l.length > MAX) return null;
    const prices = [];
    for (const e of v.l) {
      if (!e || typeof e !== 'object' || (e.d !== 'above' && e.d !== 'below')) return null;
      if (typeof e.p !== 'number' || !Number.isFinite(e.p) || !(e.p > 0) || e.p >= 1e9) return null;
      if (!prices.includes(e.p)) prices.push(e.p); // one badge per price
    }
    return { id: v.id, prices };
  }
  /** this product's alarm prices */
  function current() {
    const r = document.documentElement.getAttribute(ATTR);
    if (r !== raw) { raw = r; parsed = parse(r); }
    const pid = page.productId();
    return parsed && pid && parsed.id === pid ? parsed.prices : [];
  }

  /** @param {any} chart @param {number} price @param {string} arrow @param {number} right */
  function badge(chart, price, arrow, right) {
    const d = document.createElement('div');
    d.setAttribute('data-dg-alarm-badge', '');
    d.style.cssText =
      `position:absolute;right:${right}px;transform:translateY(-50%);` +
      'display:flex;align-items:center;gap:3px;background:' + GOLD + ';color:#fff;font-size:11px;font-weight:600;' +
      'padding:1px 6px;border-radius:3px;white-space:nowrap;font-family:Inter,Helvetica,HelveticaNeue,sans-serif;line-height:14px;';
    // the bell, in the namespace of the chart's own <svg>
    const ns = chart.container.querySelector('svg')?.namespaceURI;
    if (ns) {
      const svg = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '12');
      svg.setAttribute('height', '12');
      svg.setAttribute('aria-hidden', 'true');
      path.setAttribute('d', BELL);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#fff');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
      d.appendChild(svg);
    }
    const s = document.createElement('span');
    s.textContent = arrow + fmt(price, 2, 4);
    d.appendChild(s);
    if (F?.alarmLinesClick) {
      d.style.cssText += 'pointer-events:auto;cursor:pointer;';
      d.addEventListener('pointerdown', e => e.stopPropagation());
      d.addEventListener('mousedown', e => e.stopPropagation());
      d.addEventListener('click', e => {
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent('dg-alarm-edit', { detail: { price } }));
      });
    }
    return d;
  }

  function render(chart, isMain) {
    const ax = chart.yAxis?.[0];
    if (!ax || !chart.container?.isConnected) return; // DEGIRO's detached charts: nothing to draw
    const st = stateOf(chart);
    if (st.layer) st.layer.replaceChildren();
    const prices = F?.alarmLines && isMain ? current() : [];
    if (!prices.length) return;

    let layer = st.layer;
    if (!layer || !layer.isConnected) {
      if (getComputedStyle(chart.container).position === 'static') chart.container.style.position = 'relative';
      layer = own(document.createElement('div'));
      layer.setAttribute('data-dg-alarm-lines-layer', '');
      layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:4;';
      chart.container.appendChild(layer);
      st.layer = layer;
    }

    const { min, max } = ax.getExtremes();
    const top = chart.plotTop + 8, bottom = chart.plotTop + chart.plotHeight - 8;
    const right = chart.chartWidth - chart.plotLeft - chart.plotWidth + 2; // plot offset
    // like orders.js: a badge at the price inside the range; outside it, a badge pinned to the top or bottom edge
    const above = prices.filter(p => p > max).sort((a, b) => a - b);
    const below = prices.filter(p => p < min).sort((a, b) => b - a);
    const inside = prices.filter(p => p >= min && p <= max);
    const put = (p, y, arrow) => { const d = badge(chart, p, arrow, right); d.style.top = y + 'px'; layer.appendChild(d); };
    // badges top to bottom; one that would overlap the one above moves down
    let prev = -Infinity;
    inside.map(p => ({ p, y: Math.min(bottom, Math.max(top, ax.toPixels(p))) })).sort((a, b) => a.y - b.y).forEach(o => {
      const y = Math.max(o.y, prev + H_LABEL);
      put(o.p, y, '');
      prev = y;
    });
    above.forEach((p, i) => put(p, top + i * H_LABEL, '▲ '));
    below.forEach((p, i) => put(p, bottom - i * H_LABEL, '▼ '));
  }

  // render when anything the badges depend on changed (alarms, axis, size, flag)
  function refresh(chart, isMain = chart === mainChart()) {
    const st = stateOf(chart), ax = chart.yAxis?.[0], e = ax?.getExtremes?.() || {};
    const sig = [raw, page.productId(), isMain, F?.alarmLines, e.min, e.max, chart.plotTop, chart.plotHeight, chart.plotLeft, chart.plotWidth, chart.chartWidth].join('|');
    // also when DEGIRO's redraw dropped our label layer
    if (st.sig === sig && (!st.layer || st.layer.isConnected)) return;
    st.sig = sig; render(chart, isMain);
  }

  function run() {
    F = readFlags();
    const prices = current(); // also brings `raw` up to date for the signatures
    const H = window.Highcharts, main = mainChart();
    lastMain = main; // cheap cache for the redraw hook below
    (H?.charts || []).forEach(chart => {
      if (!chart) return;
      const st = stateOf(chart);
      if (!st.hooked && H.addEvent) {
        st.hooked = true;
        // right after a redraw and once more after the axis rescale animation, if anything moved.
        // Skip entirely when the flag is off, or for a non-main chart with nothing of ours to clear,
        // so a live price tick on a chart we don't draw on doesn't start timers or measure anything.
        H.addEvent(chart, 'redraw', () => {
          if (!F?.alarmLines) return;
          if (chart !== lastMain && !st.layer?.firstChild) return;
          setTimeout(() => refresh(chart, chart === lastMain), 0);
          setTimeout(() => refresh(chart, chart === lastMain), 700);
        });
      }
      refresh(chart, chart === main);
    });
    if (!prices.length) return 'idle';
    return main ? 'ok' : 'missing';
  }

  feature({
    name: 'alarmLines',
    enabled: () => readFlags()?.alarmLines,
    run,
    stop: () => { F = readFlags(); (window.Highcharts?.charts || []).forEach(c => { if (c) { stateOf(c).sig = ''; render(c, false); } }); }
  });
})();
