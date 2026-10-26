// Open orders on the DEGIRO product chart: a dashed line plus a badge on the left.
// Runs in the page context (world: MAIN). Uses the same session as DEGIRO itself.
(() => {
  const BUY = '#078307', SELL = '#E3282B';
  const POLL_MS = 20000, TIMEOUT_MS = 15000; // a hung request must not stop polling
  let sid = null, acc = null, orders = [], version = 0, loading = false, last = 0;
  // A session DEGIRO rejected (401/403) is never used again, and after a rejection the next
  // request waits (20 s, doubling up to 5 min), so an expired session can't cause a request loop.
  const rejected = new Set(), mine = new Set(), RETRY_MIN_MS = 20000, RETRY_MAX_MS = 300000;
  let retryAt = 0, retryMs = 0;
  const EXTRA_MIN_MS = 5000; let rowCount = null, rowsChanged = false; // see run()
  const useSid = s => { if (s && !rejected.has(s)) sid = s; };
  // feature flags, bridged from the extension by flags.js (null = not loaded yet)
  let F = null;
  const { flags: readFlags, pageTheme, mainChart, parseNum: num, fmt, SEL, LABELS, page, own, feature, t } = __dgt; // common.js
  // per chart: our plot line ids, badge layer, render signature (charts are DEGIRO's objects)
  /** @type {WeakMap<object, { ids: string[], layer: HTMLElement | null, sig: string, hooked: boolean }>} */
  const state = new WeakMap();
  const stateOf = chart => { let st = state.get(chart); if (!st) state.set(chart, st = { ids: [], layer: null, sig: '', hooked: false }); return st; };

  const nf = (n, d = 2) => fmt(n, d, 4);
  const qf = n => fmt(n, 0, 4);

  // take sessionId / intAccount from the URLs of requests DEGIRO itself makes
  function grab(name) {
    try {
      const u = new URL(name, location.href);
      if (u.origin !== location.origin || mine.has(u.href)) return; // not our own requests
      useSid(u.searchParams.get('sessionId') || (u.pathname.match(/;jsessionid=([^/?;]+)/i) || [])[1]);
      acc = u.searchParams.get('intAccount') || (u.pathname.match(/account\/info\/(\d+)/) || [])[1] || acc;
    } catch (e) {}
  }
  performance.getEntriesByType('resource').forEach(e => grab(e.name));
  try {
    new PerformanceObserver(l => l.getEntries().forEach(e => grab(e.name))).observe({ type: 'resource', buffered: true });
  } catch (e) {}

  const productId = page.productId;

  // Fallback if DEGIRO's request URLs stop carrying the session: ask DEGIRO the way its own
  // app does. Only after a few seconds without it, at most once a minute; kept in memory only.
  const START = Date.now(), ASK_AFTER_MS = 5000, ASK_EVERY_MS = 60000;
  let asked = 0;
  async function askSession() {
    const now = Date.now();
    if (now - START < ASK_AFTER_MS || now - asked < ASK_EVERY_MS) return;
    asked = now;
    try {
      const s = (await (await fetch('/login/secure/config', { credentials: 'include', signal: AbortSignal.timeout(TIMEOUT_MS) })).json())?.data?.sessionId;
      if (typeof s !== 'string' || !s || rejected.has(s)) return;
      if (!acc) {
        const a = (await (await fetch(`/pa/secure/client?sessionId=${encodeURIComponent(s)}`, { credentials: 'include', signal: AbortSignal.timeout(TIMEOUT_MS) })).json())?.data?.intAccount;
        if (!Number.isInteger(a)) return;
        acc = String(a); // only the account number is read from the client profile
      }
      sid = s;
    } catch (e) {}
  }

  async function load() {
    if (loading || Date.now() < retryAt) return;
    if (!sid || !acc) { loading = true; await askSession(); loading = false; if (!sid || !acc) return; }
    loading = true; last = Date.now();
    try {
      const path = `/trading/secure/v5/update/${acc};jsessionid=${sid}?orders=0`;
      mine.add(new URL(path, location.href).href);
      const r = await fetch(path, { credentials: 'include', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (r.status === 401 || r.status === 403) {
        // session expired: wait for a new one from DEGIRO's requests or the fallback
        if (sid) rejected.add(sid);
        sid = null;
        retryMs = Math.min(RETRY_MAX_MS, Math.max(RETRY_MIN_MS, retryMs * 2));
        retryAt = Date.now() + retryMs;
      }
      if (r.ok) {
        retryMs = 0;
        const j = await r.json();
        orders = (j.orders?.value || []).map(o => Object.fromEntries((o.value || []).map(f => [f.name, f.value])));
        version++;
      }
    } catch (e) {}
    loading = false;
  }


  // ---------- open DEGIRO's "Adjust order" form for an order ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // a product name DEGIRO cut short ("iShares Core MSCI Wor…") matches the start of the full one
  const cutName = (shown, full) => {
    const m = shown.match(/^(.*?)\s*(…|\.\.\.)$/);
    return !!m && m[1].length > 3 && full.startsWith(m[1]);
  };
  // a row's side (B/S), quantity, product name and price: DEGIRO's hooks first, then the cell order
  // (side, quantity, product, price); the side text is localised (K/V, A/V, C/V), data-action isn't
  /** @param {Element} r */
  function rowInfo(r) {
    const c = [...r.children], text = (sel, i) => (r.querySelector(sel) || c[i])?.textContent?.trim() || '';
    const action = r.querySelector(SEL.buySellBadge)?.getAttribute('data-action');
    const s = text(SEL.buySellBadge, 0);
    const side = action === 'BUY' ? 'B' : action === 'SELL' ? 'S'
      : LABELS.buyShort.test(s) || LABELS.buy.test(s) ? 'B' : LABELS.sellShort.test(s) || LABELS.sell.test(s) ? 'S' : '';
    return { side, size: num(text(SEL.orderQuantity, 1)), name: text(SEL.orderProduct, 2), price: num(text(SEL.orderPrice, 3)) };
  }

  // the order's row in the "Outstanding" panel at the bottom of the page
  function findRow(o) {
    const rows = [...document.querySelectorAll(SEL.openOrderRow)];
    // DEGIRO's cells carry the order id
    if (typeof o.id === 'string' && o.id) {
      const byId = rows.find(r => r.querySelector(`[data-id="${CSS.escape(o.id)}"]`));
      if (byId) return byId;
    }
    const price = o.price > 0 ? o.price : o.stopPrice, name = String(o.product || '').trim();
    const fits = rows.map(r => ({ r, i: rowInfo(r) }))
      .filter(({ i }) => i.side === o.buysell && i.size === o.size && Math.abs(i.price - price) < 1e-6);
    const exact = fits.find(({ i }) => i.name === name);
    if (exact) return exact.r;
    // a shortened name: only if exactly one row fits, so a similar product's order is never opened
    const cut = fits.filter(({ i }) => cutName(i.name, name));
    return cut.length === 1 ? cut[0].r : undefined;
  }

  async function openEdit(o, el) {
    /** @type {(sel: string) => HTMLElement | null} */
    const $ = sel => document.querySelector(sel);
    const toggle = () => $(SEL.panelToggle);
    // narrow (mobile) layout: no bottom panel; the orders list is in the "Account overview" drawer
    const drawerBtn = () => $(SEL.drawerToggle);
    let row = findRow(o), expanded = false, drawer = false;
    if (!row) {
      const tg = toggle();
      // minimised: data-value isn't "opened" (the localised label is only a fallback)
      const v = tg?.getAttribute('data-value');
      if (tg && (v ? v !== 'opened' : LABELS.panelCollapsed.test(tg.getAttribute('aria-label') || ''))) { tg.click(); expanded = true; }
      else if (!tg && !$(SEL.openOrderRow)) { const d = drawerBtn(); if (d) { d.click(); drawer = true; } }
      for (let i = 0; i < 30 && !row; i++) { await sleep(100); row = findRow(o); }
    }
    const btn = /** @type {HTMLElement | null | undefined} */ (row?.querySelector(SEL.orderEditButton));
    if (btn) {
      btn.click();
      // the drawer must stay open while the form is open (closing it closes the form);
      // mark it so adjust-close.js can close it again after Cancel
      if (drawer) document.documentElement.setAttribute('data-dg-drawer', '1');
    } else {
      if (el) { el.title = t('badgeNotFound'); el.animate?.([{ opacity: 1 }, { opacity: .3 }, { opacity: 1 }], 400); }
      if (drawer) drawerBtn()?.click(); // put things back
    }
    // the bottom panel was minimised — minimise it again; the edit form stays open
    if (expanded) { await sleep(600); toggle()?.click(); }
  }

  function render(chart) {
    const ax = chart.yAxis?.[0];
    if (!ax || !chart.container?.isConnected) return; // DEGIRO's detached charts: nothing to draw
    const pid = productId();
    const st = stateOf(chart);
    st.ids.forEach(id => ax.removePlotLine(id));
    st.ids = [];

    let layer = st.layer;
    if (chart !== mainChart()) { // only the price chart gets a layer; one left over is emptied
      if (layer) layer.innerHTML = '';
      return;
    }
    if (!layer || !layer.isConnected) {
      if (getComputedStyle(chart.container).position === 'static') chart.container.style.position = 'relative';
      layer = own(document.createElement('div'));
      layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:4;';
      chart.container.appendChild(layer);
      st.layer = layer;
    }
    // a focused badge is rebuilt on every render: give the focus back to its twin
    const focused = layer.contains(document.activeElement) ? document.activeElement?.getAttribute('data-k') : null;
    layer.innerHTML = '';

    if (!pid || !F?.orders) return;
    const clickable = !!F.ordersClick;

    // one badge per order; orders at the same price sit side by side (see slot() below)
    const mine = orders.filter(o => o.productId === pid).flatMap((o, i) => {
      const price = o.price > 0 ? o.price : o.stopPrice;
      if (!(price > 0)) return [];
      const k = typeof o.id === 'string' && o.id ? o.id : o.buysell + '|' + price + '|' + i;
      return [{ side: o.buysell, price, size: o.size || o.quantity || 0, order: o, k }];
    });
    if (!mine.length) return;

    const { min, max } = ax.getExtremes();
    const top = chart.plotTop, bottom = chart.plotTop + chart.plotHeight;
    const th = pageTheme(chart.container);
    const badge = o => {
      const d = document.createElement('div');
      d.textContent = o.text;
      d.style.cssText =
        `background:${th.bg};border:1px solid ${o.col};color:${o.col};border-radius:2px;` +
        `font-family:Inter,Helvetica,HelveticaNeue,sans-serif;font-size:11px;line-height:14px;font-weight:400;padding:0 4px;white-space:nowrap;` +
        (clickable && o.order ? 'pointer-events:auto;cursor:pointer;transition:background .1s,color .1s;' : '');
      if (clickable && o.order) {
        d.title = t('badgeEdit');
        d.setAttribute('role', 'button');
        d.tabIndex = 0;
        d.setAttribute('data-k', o.k);
        d.setAttribute('aria-label', t('badgeAria', t(o.side === 'S' ? 'badgeSell' : 'badgeBuy').toLowerCase(), qf(o.size), nf(o.price)));
        d.onmouseenter = () => { d.style.background = o.col; d.style.color = '#fff'; };
        d.onmouseleave = () => { d.style.background = th.bg; d.style.color = o.col; };
        d.onfocus = () => { if (d.matches(':focus-visible')) { d.style.outline = `2px solid ${o.col}`; d.style.outlineOffset = '1px'; } };
        d.onblur = () => { d.style.outline = ''; };
        // keep the click from starting a range selection on the chart
        d.addEventListener('pointerdown', e => e.stopPropagation());
        d.addEventListener('mousedown', e => e.stopPropagation());
        d.addEventListener('click', e => { e.stopPropagation(); openEdit(o.order, d); });
        d.addEventListener('keydown', e => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault(); e.stopPropagation(); // Space must not scroll the page
          openEdit(o.order, d);
        });
      }
      return d;
    };
    // a neutral badge (not an order): "+N", "N orders"
    const plain = (text, title) => {
      const d = badge({ text, col: th.text });
      if (title) d.title = title;
      return d;
    };

    const all = mine.map(o => ({
      ...o, col: o.side === 'S' ? SELL : BUY,
      label: `${t(o.side === 'S' ? 'badgeSell' : 'badgeBuy')} ${qf(o.size)} · ${nf(o.price)}`
    }));
    // the ones closest to the chart go first (further left)
    const above = all.filter(o => o.price > max).sort((a, b) => a.price - b.price);
    const below = all.filter(o => o.price < min).sort((a, b) => b.price - a.price);
    const inside = all.filter(o => o.price >= min && o.price <= max);
    const count = list => list.length;

    // Everything is appended first and measured once afterwards (no layout read per badge).
    const GAP = 4, rowMax = chart.plotWidth - 2;
    // orders outside the chart range: one horizontal row at the top / bottom; badges that
    // don't fit are hidden and counted in a "+N" badge
    const rows = [];
    const row = (list, y, arrow) => {
      if (!list.length) return;
      const r = document.createElement('div');
      r.style.cssText =
        `position:absolute;left:${chart.plotLeft + 1}px;top:${y}px;transform:translateY(-50%);` +
        `display:flex;gap:${GAP}px;flex-wrap:nowrap;max-width:${rowMax}px;overflow:hidden;`;
      const els = list.map(o => r.appendChild(badge({ ...o, text: arrow + o.label })));
      const more = r.appendChild(plain('+' + count(list)));
      layer.appendChild(r);
      rows.push({ r, els, more, list });
    };
    row(above, top + 8, '▲ ');
    row(below, bottom - 8, '▼ ');

    // inside the chart: line + badge, the badge centred on its own line.
    // Badges whose lines are too close together go side by side (further right on the
    // same line) instead of being pushed up or down, so each badge stays on its line.
    const lo = top + 8, hi = bottom; // at the bottom they may overlap the date axis slightly
    const items = inside.map((o, i) => {
      const id = 'dg-ord-' + i;
      ax.addPlotLine({ id, value: o.price, color: o.col, width: 1, dashStyle: 'Dash', zIndex: 3 });
      st.ids.push(id);
      return { ...o, text: o.label, y: Math.min(hi, Math.max(lo, ax.toPixels(o.price))) };
    }).sort((a, b) => a.y - b.y);
    const els = items.map(o => {
      const d = badge(o);
      d.style.position = 'absolute';
      d.style.top = o.y + 'px';
      d.style.transform = 'translateY(-50%)';
      d.style.left = '0px';
      layer.appendChild(d);
      return d;
    });
    // for when they can't all be placed: one "N orders" badge, measured together with the rest
    let merged = null;
    if (items.length > 1) {
      merged = plain(t('badgeMerged', count(items)), items.map(o => o.label).join('\n'));
      merged.style.cssText += 'position:absolute;left:0;top:0;visibility:hidden;transform:translateY(-50%);';
      layer.appendChild(merged);
    }

    // ---- read phase: one layout for everything ----
    const lr = layer.getBoundingClientRect();
    const rowReads = rows.map(x => {
      const b = x.r.getBoundingClientRect();
      return { ...x, ws: x.els.map(e => e.offsetWidth), mw: x.more.offsetWidth,
        box: { y1: b.top - lr.top, y2: b.bottom - lr.top, x1: b.left - lr.left, x2: b.right - lr.left } };
    });
    const ws = els.map(e => e.offsetWidth), hs = els.map(e => e.offsetHeight || 16);
    const mw = merged ? merged.offsetWidth : 0, mh = merged ? merged.offsetHeight || 16 : 0;

    // ---- write phase ----
    const placed = []; // boxes already taken: { y1, y2, x1, x2 } in chart px
    rowReads.forEach(x => {
      let k = x.ws.length;
      if (x.ws.reduce((s, w) => s + w + GAP, -GAP) > rowMax) {
        // as many as fit next to the "+N" badge (at least one)
        let used = 0;
        for (k = 0; k < x.ws.length; k++) {
          const next = used + (k ? GAP : 0) + x.ws[k];
          if (next + GAP + x.mw > rowMax) break;
          used = next;
        }
        k = Math.max(1, k);
      }
      x.els.forEach((e, i) => { if (i >= k) e.style.display = 'none'; });
      if (k >= x.els.length) x.more.remove();
      else {
        const hidden = x.list.slice(k);
        x.more.textContent = '+' + count(hidden);
        x.more.title = hidden.map(o => o.label).join('\n');
      }
      placed.push(x.box);
    });
    // x for a box of width w at y1..y2: right past everything it would overlap
    const slot = (w, y1, y2) => {
      let x = chart.plotLeft + 1;
      for (let moved = true; moved;) {
        moved = false;
        for (const p of placed) {
          if (y1 < p.y2 + 1 && y2 > p.y1 - 1 && x < p.x2 + 4 && x + w > p.x1 - 4) { x = p.x2 + 4; moved = true; }
        }
      }
      return x;
    };

    const right = chart.plotLeft + chart.plotWidth - 1;
    const base = placed.length;
    const pos = items.map((o, i) => {
      const y1 = o.y - hs[i] / 2, y2 = o.y + hs[i] / 2, x = slot(ws[i], y1, y2);
      placed.push({ y1, y2, x1: x, x2: x + ws[i] });
      return x;
    });
    const fits = items.every((o, i) => pos[i] + ws[i] <= right);

    if (fits || !merged) {
      merged?.remove();
      els.forEach((d, i) => { d.style.left = pos[i] + 'px'; });
    } else {
      // no room inside the plot area: one "N orders" badge instead of clipped or overlapping ones
      els.forEach(d => d.remove());
      placed.length = base;
      const y = Math.min(hi, Math.max(lo, items.reduce((s, o) => s + o.y, 0) / items.length));
      merged.style.top = y + 'px';
      merged.style.left = slot(mw, y - mh / 2, y + mh / 2) + 'px';
      merged.style.visibility = '';
    }
    if (focused) /** @type {HTMLElement | null} */ (layer.querySelector(`[data-k="${CSS.escape(focused)}"]`))?.focus({ preventScroll: true });
  }

  // render when anything the badges depend on changed (axis, size, orders, flags), so they
  // don't lag behind the lines; nothing to do otherwise
  function refresh(chart, pid = productId(), isMain = chart === mainChart()) {
    const st = stateOf(chart), ax = chart.yAxis?.[0], e = ax?.getExtremes?.() || {};
    const sig = [pid, version, isMain, F?.orders, F?.ordersClick, e.min, e.max, chart.plotTop, chart.plotHeight, chart.plotLeft, chart.plotWidth].join('|');
    // also when DEGIRO's redraw dropped our plot lines or badge layer
    const linesOk = st.ids.every(id => (ax?.plotLinesAndBands || []).some(p => p.id === id));
    if (st.sig === sig && linesOk && (!st.layer || st.layer.isConnected)) return;
    st.sig = sig; render(chart);
  }

  function run() {
    F = readFlags();
    const pid = productId();
    // DEGIRO's Outstanding panel gained or lost an order: reload soon instead of waiting for the
    // next poll. One request per change, at least EXTRA_MIN_MS after any request, never while one
    // is running or during a backoff.
    // A change to or from 0 rows is the panel being expanded or minimised (also by our badge
    // click), not a new or cancelled order, so it doesn't count.
    const rows = document.querySelectorAll(SEL.openOrderRow).length;
    if (rowCount && rows && rows !== rowCount) rowsChanged = true;
    rowCount = rows;
    const now = Date.now();
    if (pid && document.visibilityState === 'visible' && !loading && now >= retryAt) {
      if (now - last > POLL_MS) { rowsChanged = false; load(); }
      else if (rowsChanged && now - last >= EXTRA_MIN_MS) { rowsChanged = false; load(); }
    }

    const H = window.Highcharts;
    const main = mainChart();
    (H?.charts || []).forEach(chart => {
      if (!chart) return;
      const st = stateOf(chart);
      if (!st.hooked && H.addEvent) {
        st.hooked = true;
        // right after a redraw and once more after the axis rescale animation, if anything moved
        H.addEvent(chart, 'redraw', () => { setTimeout(() => refresh(chart), 0); setTimeout(() => refresh(chart), 700); });
      }
      refresh(chart, pid, chart === main);
    });
    if (!pid) return 'idle';
    return main && sid && acc ? 'ok' : 'missing'; // no price chart, or DEGIRO's session not seen
  }

  feature({
    name: 'orders',
    enabled: () => readFlags()?.orders,
    run,
    stop: () => { F = readFlags(); (window.Highcharts?.charts || []).forEach(c => { if (c) { stateOf(c).sig = ''; render(c); } }); },
    every: 1000
  });

  window.addEventListener('hashchange', () => { last = 0; });
})();
