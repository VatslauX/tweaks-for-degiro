// Orders → Outstanding: filters (action, currency, product — multi-select) and totals
// (buy / sell value per currency) for the rows that are shown.
// Works on DEGIRO's own table: rows are only hidden, never changed.
(() => {
  const PANEL_ID = 'dg-orders-panel';
  const HIDDEN = 'data-dg-filtered';
  const { SEL, LABELS, page, own, feature, parseNum: num, fmt, t } = __dgt; // common.js
  const BUY = LABELS.buy, SELL = LABELS.sell;

  const state = { action: 'all', currencies: new Set(), products: new Set() };

  // ---------- reading the table ----------

  // the Outstanding table: has the limit / value columns DEGIRO marks with data-field
  function ordersTable() {
    if (!page.isOrders()) return null;
    return [...document.querySelectorAll('table')].find(t => t.querySelector(SEL.orderLimit) && t.querySelector(SEL.orderValue)) || null;
  }

  function columnIndex(table, re) {
    return [...(table.querySelector('thead tr')?.children || [])].findIndex(th => re.test(th.textContent.trim()));
  }

  // DEGIRO's own Buy/Sell colours, read from the Action column (fallback: DEGIRO palette)
  let pageBuy = null, pageSell = null;
  function readActionColours(rows) {
    const leaf = td => { let e = td; while (e && e.firstElementChild) e = e.firstElementChild; return e; };
    const b = rows.find(r => r.action === 'buy'), s = rows.find(r => r.action === 'sell');
    if (b?.actionCell) pageBuy = getComputedStyle(leaf(b.actionCell)).color;
    if (s?.actionCell) pageSell = getComputedStyle(leaf(s.actionCell)).color;
  }

  function readRows(table) {
    const actionIdx = columnIndex(table, LABELS.actionColumn);
    return [...table.querySelectorAll('tbody tr')].map(tr => {
      const cells = [...tr.children];
      const limit = tr.querySelector(SEL.orderLimit)?.textContent.trim() || '';
      const stop = tr.querySelector(SEL.orderStop)?.textContent.trim() || '';
      const currency = (limit.match(/^[^\d\s—-]+/) || stop.match(/^[^\d\s—-]+/) || [''])[0].trim();
      // action: from the Action column, or any cell that says Buy/Sell
      const actionCell = actionIdx >= 0 ? cells[actionIdx] : cells.find(c => BUY.test(c.textContent.trim()) || SELL.test(c.textContent.trim()));
      const actionText = actionCell?.textContent.trim() || '';
      const action = BUY.test(actionText) ? 'buy' : SELL.test(actionText) ? 'sell' : '';
      return {
        tr, action, currency, actionCell,
        // DEGIRO marks the name; the cell also holds a category badge (A/H…) we must not include
        product: (tr.querySelector(SEL.orderProduct)?.textContent || cells[0]?.textContent || '').trim(),
        value: num(tr.querySelector(SEL.orderValue)?.textContent)
      };
    }).filter(r => r.product);
  }

  // ---------- filtering ----------
  const matches = r =>
    (state.action === 'all' || r.action === state.action) &&
    (!state.currencies.size || state.currencies.has(r.currency)) &&
    (!state.products.size || state.products.has(r.product));

  function applyFilter(rows) {
    rows.forEach(r => {
      const show = matches(r);
      if (show && r.tr.hasAttribute(HIDDEN)) { r.tr.style.removeProperty('display'); r.tr.removeAttribute(HIDDEN); }
      if (!show && !r.tr.hasAttribute(HIDDEN)) { r.tr.style.setProperty('display', 'none', 'important'); r.tr.setAttribute(HIDDEN, ''); }
    });
  }

  function unhideAll() {
    /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(`[${HIDDEN}]`)).forEach(tr => { tr.style.removeProperty('display'); tr.removeAttribute(HIDDEN); });
  }

  // ---------- UI ----------
  const money = (n, cur) => `${cur} ${fmt(n)}`;

  function theme() {
    const c = getComputedStyle(document.body).backgroundColor;
    const bg = /rgba\(0, 0, 0, 0\)|transparent/.test(c) ? 'rgb(255, 255, 255)' : c;
    const [r, g, b] = (bg.match(/\d+/g) || ['255', '255', '255']).map(Number);
    const dark = 0.299 * r + 0.587 * g + 0.114 * b < 128;
    const text = getComputedStyle(document.body).color;
    return {
      dark, bg, text,
      muted: dark ? '#8FA0A6' : '#65757B',            // DEGIRO's unselected tab text
      buy: pageBuy || (dark ? '#4CB82E' : '#1E8302'),  // DEGIRO green
      sell: pageSell || (dark ? '#FF5A5F' : '#E40101'), // DEGIRO red
      line: dark ? 'rgba(255,255,255,.18)' : '#D6DFE3'
    };
  }

  // DEGIRO-style pill: selected = filled (dark, or green/red for Buy/Sell), unselected = plain text
  function chip(label, on, onClick, th, accent) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    const fill = accent || th.text;
    b.style.cssText = `font:inherit;font-size:12px;line-height:16px;height:28px;padding:0 12px;border-radius:300px;cursor:pointer;border:0;` +
      `background:${on ? fill : 'transparent'};color:${on ? (accent ? '#fff' : th.bg) : (accent || th.muted)};font-weight:${accent ? 500 : 400};`;
    b.addEventListener('click', onClick);
    return b;
  }

  function group(title, th, ...children) {
    const g = document.createElement('div');
    g.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
    const name = document.createElement('span');
    name.textContent = title;
    name.style.cssText = `font-size:12px;color:${th.muted};margin-right:2px;`;
    g.append(name, ...children);
    return g;
  }

  let openMenu = false;
  function productPicker(rows, th) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;';
    const products = [...new Set(rows.map(r => r.product))].sort((a, b) => a.localeCompare(b));
    const n = state.products.size;
    const btn = chip((n ? t('ordersSelected', n) : t('ordersAllProducts')) + ' ▾', n > 0, () => { openMenu = !openMenu; render(); }, th);
    if (!n) { btn.style.border = `1px solid ${th.line}`; btn.style.color = th.text; }
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', openMenu ? 'true' : 'false');
    btn.dataset.dgProducts = '';
    wrap.append(btn);
    if (openMenu) {
      const menu = document.createElement('div');
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-multiselectable', 'true');
      menu.style.cssText = `position:absolute;z-index:50;top:calc(100% + 4px);left:0;min-width:280px;max-height:300px;overflow:auto;` +
        `background:${th.bg};color:${th.text};border:1px solid ${th.line};border-radius:6px;padding:6px;box-shadow:0 4px 14px rgba(0,0,0,.18);`;
      products.forEach(p => {
        const lab = document.createElement('label');
        lab.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 6px;font-size:12px;cursor:pointer;white-space:nowrap;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = state.products.has(p);
        cb.addEventListener('change', () => { cb.checked ? state.products.add(p) : state.products.delete(p); render(); });
        const count = rows.filter(r => r.product === p).length;
        const span = document.createElement('span');
        span.textContent = `${p} (${count})`;
        lab.append(cb, span);
        menu.append(lab);
      });
      wrap.append(menu);
    }
    return wrap;
  }

  function totals(rows, th) {
    const box = document.createElement('div');
    box.dataset.dgTotals = '';
    box.style.cssText = 'display:flex;gap:18px;flex-wrap:wrap;font-size:12px;';
    const shown = rows.filter(matches);
    const sum = {};
    shown.forEach(r => {
      if (!r.action || !isFinite(r.value)) return;
      const k = r.currency || '?';
      sum[k] = sum[k] || { buy: 0, sell: 0, nb: 0, ns: 0 };
      if (r.action === 'buy') { sum[k].buy += r.value; sum[k].nb++; } else { sum[k].sell += r.value; sum[k].ns++; }
    });
    const line = (kind, color) => {
      const el = document.createElement('div');
      el.dataset.dgTotal = kind;
      const name = document.createElement('span');
      name.textContent = t(kind === 'buy' ? 'ordersTotalBuy' : 'ordersTotalSell') + ' ';
      name.style.cssText = `color:${color};font-weight:500;`;
      el.append(name);
      const parts = Object.keys(sum).sort().filter(c => (kind === 'buy' ? sum[c].nb : sum[c].ns) > 0)
        .map(c => `${money(kind === 'buy' ? sum[c].buy : sum[c].sell, c)} (${kind === 'buy' ? sum[c].nb : sum[c].ns})`);
      const v = document.createElement('span');
      v.textContent = parts.length ? parts.join(' · ') : '—';
      el.append(v);
      return el;
    };
    const count = document.createElement('div');
    count.style.color = th.muted;
    count.textContent = t('ordersCount', shown.length, rows.length);
    box.append(line('buy', th.buy), line('sell', th.sell), count);
    return box;
  }

  function render() {
    const table = ordersTable();
    let panel = document.getElementById(PANEL_ID);
    if (!table) { panel?.remove(); unhideAll(); return page.isOrders() ? 'missing' : 'idle'; }
    const rows = readRows(table);
    readActionColours(rows);
    applyFilter(rows);

    // insert above the table's block (below DEGIRO's own search box)
    /** @type {HTMLElement} */
    let anchor = table;
    while (anchor.parentElement && !anchor.parentElement.querySelector('input')) anchor = anchor.parentElement;
    if (!panel) {
      panel = own(document.createElement('div'));
      panel.id = PANEL_ID;
    }
    if (panel.nextElementSibling !== anchor) anchor.before(panel);

    const th = theme();
    // rebuild only when something we show changed (the page updates constantly)
    const key = JSON.stringify([rows.map(r => [r.product, r.action, r.currency, r.value]), state.action,
      [...state.currencies], [...state.products], openMenu, th.bg, th.text]);
    if (panel.isConnected && panel.dataset.key === key) return 'ok';
    panel.dataset.key = key;
    panel.style.cssText = `display:flex;flex-direction:column;gap:8px;margin:8px 0 12px;padding:0 16px;font-family:inherit;color:${th.text};`; // aligned with the table headers
    const currencies = [...new Set(rows.map(r => r.currency).filter(Boolean))].sort();
    const filters = document.createElement('div');
    filters.style.cssText = 'display:flex;gap:18px;flex-wrap:wrap;align-items:center;';
    filters.append(
      group(t('ordersAction'), th, ...[['all', t('ordersAll'), null], ['buy', t('ordersBuy'), th.buy], ['sell', t('ordersSell'), th.sell]].map(([k, l, accent]) =>
        chip(l, state.action === k, () => { state.action = k; render(); }, th, accent))),
      group(t('ordersCurrency'), th, ...currencies.map(c =>
        chip(c, state.currencies.has(c), () => { state.currencies.has(c) ? state.currencies.delete(c) : state.currencies.add(c); render(); }, th))),
      group(t('ordersProduct'), th, productPicker(rows, th))
    );
    const active = state.action !== 'all' || state.currencies.size || state.products.size;
    if (active) {
      const reset = chip(t('ordersClear'), false, () => { state.action = 'all'; state.currencies.clear(); state.products.clear(); openMenu = false; render(); }, th);
      reset.dataset.dgReset = '';
      filters.append(reset);
    }
    panel.replaceChildren(filters, totals(rows, th));
    return 'ok';
  }

  // close the product menu on outside click
  document.addEventListener('mousedown', e => {
    if (openMenu && !/** @type {Element} */ (e.target).closest?.(`#${PANEL_ID} [role=listbox], #${PANEL_ID} [data-dg-products]`)) { openMenu = false; render(); }
  }, true);

  // DEGIRO re-renders rows (live updates, paging, sorting): the scheduler re-applies
  feature({
    name: 'ordersFilter',
    enabled: () => dgSettings.ordersFilter,
    run: render,
    stop: () => { document.getElementById(PANEL_ID)?.remove(); unhideAll(); }
  });
})();
