// Select a range on the DEGIRO chart by dragging (like Google Finance).
// Runs in the page context (world: MAIN) so it can see window.Highcharts.
(() => {
  // DEGIRO palette and fonts
  const DG = {
    font: 'Inter, Helvetica, HelveticaNeue, sans-serif',
    text: '#0F171A', muted: '#798A90',
    upDot: '#078307', downDot: '#E3282B',   // chart markers
    upText: '#1E8302', downText: '#E3282B', // change text (+0,26 (+1,58%))
    upFill: 'rgba(7,131,7,.08)', downFill: 'rgba(227,40,43,.08)',
    edge: 'rgba(121,138,144,.7)'
  };
  const { flags, pageTheme, mainChart, priceSeries, xs, ys, fmt, own, feature } = __dgt; // common.js
  // per chart: clears its selection (charts are DEGIRO's objects, so nothing is stored on them)
  /** @type {WeakMap<object, () => void>} */
  const selClear = new WeakMap();


  // index of the nearest point by x (xData is sorted)
  function nearest(xs, x) {
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; xs[m] < x ? lo = m : hi = m; }
    return Math.abs(xs[lo] - x) <= Math.abs(xs[hi] - x) ? lo : hi;
  }

  function yVal(s, i) {
    const y = ys(s)[i];
    return Array.isArray(y) ? y[y.length - 1] : y; // OHLC: use close
  }


  // one Esc listener for all charts (clears the last selection)
  let activeClear = null;
  window.addEventListener('keydown', e => { if (e.key === 'Escape') activeClear?.(); });

  function attach(chart) {
    if (selClear.has(chart) || !chart.container) return;
    const box = chart.container;
    box.setAttribute('data-dg-sel', ''); // marks a chart with selection attached (used by the tests)
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';

    const mk = css => { const d = own(document.createElement('div')); d.style.cssText = css; d.style.display = 'none'; box.appendChild(d); return d; };
    const band = mk(`position:absolute;pointer-events:none;z-index:5;border-left:1px solid ${DG.edge};border-right:1px solid ${DG.edge};`);
    // like DEGIRO's chart tooltip: rounded, soft shadow (colours from the page theme)
    const label = mk(`position:absolute;pointer-events:none;z-index:6;padding:6px 10px;border-radius:4px;background:#fff;` +
      `font-family:${DG.font};font-size:12px;line-height:18px;color:${DG.text};box-sizing:border-box;overflow-wrap:anywhere;` +
      `box-shadow:0 1px 2px rgba(0,0,0,.08),0 2px 6px rgba(0,0,0,.12);`);

    // like DEGIRO's max/min markers: 12px circle, 2px white stroke (centred, as in SVG)
    const dotCss = 'position:absolute;pointer-events:none;z-index:6;box-sizing:border-box;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid #fff;';
    const dot1 = mk(dotCss), dot2 = mk(dotCss);

    // screen-reader announcement of the result (a label that is shown/hidden is not reliably announced)
    // (next to the chart container, not inside it, so it is not mistaken for chart content)
    const host = box.parentElement || box;
    let live = /** @type {HTMLElement | null} */ (host.querySelector(':scope > [data-dg-live]'));
    if (!live) {
      live = own(document.createElement('div'));
      live.setAttribute('data-dg-live', '');
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;';
      host.appendChild(live);
    }
    const announce = (/** @type {string} */ text) => { if (live) live.textContent = text; };

    let start = null, dragging = false, moved = false;
    // the shown selection: its edge times and a fingerprint of the chart state it was made on
    /** @type {{ t1: number, t2: number, span: number } | null} */
    let sel = null;

    const clear = () => { [band, label, dot1, dot2].forEach(el => el.style.display = 'none'); start = null; sel = null; announce(''); };
    selClear.set(chart, clear);

    // Does the selection still fit the chart? A new period changes the visible span a lot; a live
    // tick only updates or appends points (and may drop the oldest), so the span stays about the
    // same and both selected points are still in the data.
    function stillFits(s) {
      const x = xs(s), ax = chart.xAxis[0], span = ax.max - ax.min;
      return !!sel && Math.abs(span - sel.span) <= 0.2 * sel.span && sel.t1 >= x[0] && sel.t2 <= x[x.length - 1];
    }

    function draw(x1px, x2px) {
      const s = priceSeries(chart); if (!s) return;
      const ax = chart.xAxis[0];
      const a = Math.min(x1px, x2px), b = Math.max(x1px, x2px);
      render(s, xs(s)[nearest(xs(s), ax.toValue(a))], xs(s)[nearest(xs(s), ax.toValue(b))]);
    }

    // (re)position the selection between two data times; values come from the current data
    function render(s, tA, tB) {
      const ax = chart.xAxis[0];
      const i1 = nearest(xs(s), tA), i2 = nearest(xs(s), tB);
      const p1 = yVal(s, i1), p2 = yVal(s, i2);
      if (!(p1 > 0) || p2 == null) return;
      const t1 = xs(s)[i1], t2 = xs(s)[i2];
      sel = { t1, t2, span: ax.max - ax.min };

      // snap the edges to real data points
      const L = ax.toPixels(t1), R = ax.toPixels(t2);
      const diff = p2 - p1, pct = diff / p1 * 100;
      const up = diff >= 0;
      const th = pageTheme(box);
      const col = up ? DG.upDot : DG.downDot;
      const tcol = up ? th.upText : th.downText;

      Object.assign(band.style, {
        display: 'block', left: L + 'px', width: Math.max(R - L, 1) + 'px',
        top: chart.plotTop + 'px', height: chart.plotHeight + 'px',
        background: up ? DG.upFill : DG.downFill
      });

      // dots where the selection edges cross the chart line
      const yAx = s.yAxis || chart.yAxis[0];
      [[dot1, L, p1], [dot2, R, p2]].forEach(([d, x, y]) => Object.assign(d.style, {
        display: 'block', left: x + 'px', top: yAx.toPixels(y) + 'px', background: col, borderColor: th.bg
      }));

      const intraday = (xs(s).at(-1) - xs(s)[0]) < 3 * 864e5;
      const f = intraday ? '%H:%M' : '%e %b %Y';
      const dates = `${Highcharts.dateFormat(f, t1)} → ${Highcharts.dateFormat(f, t2)}`;
      // build with textContent only — dates/month names come from the page and must not be parsed as HTML
      const line = (text, css) => { const d = document.createElement('div'); d.style.cssText = css; d.textContent = text; return d; };
      label.replaceChildren(
        line(`${up ? '+' : ''}${fmt(diff, 3)} (${up ? '+' : ''}${fmt(pct)}%)`, `font-size:14px;font-weight:500;color:${tcol}`),
        line(`${fmt(p1, 3)} → ${fmt(p2, 3)} · ${dates}`, `font-size:11px;color:${DG.muted}`)
      );
      Object.assign(label.style, { display: 'block', background: th.bg, color: th.text, boxShadow: th.shadow, border: th.border });
      label.style.top = (chart.plotTop + 6) + 'px';
      // wrap inside the plot area instead of overflowing the chart; measure from the left edge
      label.style.maxWidth = Math.max(chart.plotWidth, 80) + 'px';
      label.style.left = '0px';
      const lw = label.offsetWidth, lh = label.offsetHeight, mid = (L + R) / 2;
      const lx = Math.max(chart.plotLeft, Math.min(mid - lw / 2, chart.plotLeft + chart.plotWidth - lw));
      label.style.left = lx + 'px';
      // if the label covers a dot, move it to the bottom of the chart
      const topY = chart.plotTop + 6;
      const covers = [[L, p1], [R, p2]].some(([x, y]) => {
        const py = yAx.toPixels(y);
        return x > lx - 10 && x < lx + lw + 10 && py > topY - 10 && py < topY + lh + 10;
      });
      if (covers) label.style.top = (chart.plotTop + chart.plotHeight - lh - 6) + 'px';
    }

    // chart coordinates; Highcharts' normalize also handles CSS scaling/zoom of parents
    const chartXY = e => {
      try { const n = chart.pointer.normalize(e); return { x: n.chartX, y: n.chartY }; }
      catch (err) { const r = box.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    };
    const xIn = e => Math.max(chart.plotLeft, Math.min(chartXY(e).x, chart.plotLeft + chart.plotWidth));

    // Pointer events on the chart container + pointer capture: works for mouse, pen and touch,
    // and needs no window listeners (which used to pile up for every chart DEGIRO created).
    box.style.touchAction = 'pan-y'; // horizontal drags select, vertical swipes still scroll
    box.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !flags()?.chartSelect || chart !== mainChart()) return;
      const { y } = chartXY(e);
      if (y < chart.plotTop || y > chart.plotTop + chart.plotHeight) return;
      e.preventDefault();
      clear();
      try { box.setPointerCapture(e.pointerId); } catch (err) {}
      start = xIn(e); dragging = true; moved = false;
      activeClear = clear;
    });
    box.addEventListener('pointermove', e => {
      if (!dragging) return;
      const x = xIn(e);
      if (Math.abs(x - start) > 3) { moved = true; draw(start, x); }
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (!moved) clear(); // a plain click clears the selection
      else if (sel) announce([...label.children].map(c => c.textContent).join('. '));
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);

    // chart redrawn: another period clears the selection; a live tick (a point updated or added)
    // keeps it and moves it to the new pixel positions, with values from the current data
    if (Highcharts.addEvent) Highcharts.addEvent(chart, 'redraw', () => {
      if (!sel) return;
      const s = priceSeries(chart);
      if (!s || !stillFits(s)) return clear();
      render(s, sel.t1, sel.t2);
    });
  }

  const clearAll = () => (window.Highcharts?.charts || []).forEach(c => c && selClear.get(c)?.());
  feature({
    name: 'chartSelect',
    enabled: () => flags()?.chartSelect,
    run() {
      const main = mainChart();
      if (!main) return __dgt.page.isProduct() ? 'missing' : 'idle';
      attach(main);
      // only the price chart gets a selection
      (window.Highcharts?.charts || []).forEach(c => { if (c && c !== main) selClear.get(c)?.(); });
      return 'ok';
    },
    stop: clearAll,
    every: 1000
  });
})();
