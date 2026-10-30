// Orders → Outstanding and Transactions: filters (action, currency, product — multi-select) and
// totals for the rows that are shown (Orders: buy / sell value per currency; Transactions: also
// net buy − sell per currency and fees). Works on DEGIRO's own table: rows are only hidden, never
// changed. Each page has its own panel, state and hidden-row marker, so they never undo each other.
(() => {
  const { SEL, LABELS, page, own, feature, schedule, parseNum: num, fmt, t } = __dgt; // common.js
  const BUY = LABELS.buy, SELL = LABELS.sell;
  // currency symbol or code in a value cell: "€ -1.234,56", "$1,234.56", "USD 12,00"
  const currencyOf = text => (String(text || '').match(/[^\d\s.,\u2012-\u2015\u2212+-]+/) || [''])[0];
  // DEGIRO prints a dash for "none" (en/em dash, hyphen, minus; maybe with a currency): no digits, a dash
  const isDash = text => !/\d/.test(text) && /[\u2012-\u2015\u2212-]/.test(text);

  /**
   * @typedef {{ tr: HTMLElement, action: string, currency: string, product: string, value: number,
   *   actionCell?: Element | null, base?: string, fee?: number }} Row
   * @typedef {{ name: string, enabled: () => boolean, panelId: string, hidden: string,
   *   isPage: () => boolean, table: () => Element | null, rows: (table: Element) => Row[],
   *   place: (panel: HTMLElement, table: Element) => void, countKey: string, extras: boolean,
   *   columns?: Columns }} Config
   * @typedef {{ key: string, index: number, label: string }} Column
   * @typedef {{ find: (table: Element) => Column[], hidden: () => string[], save: (keys: string[]) => void,
   *   defaults: string[], apply: (table: Element | null, indexes: number[]) => void }} Columns
   */

  // ---------- Orders → Outstanding ----------

  // the Outstanding table: has the limit / value columns DEGIRO marks with data-field
  function ordersTable() {
    if (!page.isOrders()) return null;
    return [...document.querySelectorAll('table')].find(t => t.querySelector(SEL.orderLimit) && t.querySelector(SEL.orderValue)) || null;
  }

  function columnIndex(table, re) {
    return [...(table.querySelector('thead tr')?.children || [])].findIndex(th => re.test(th.textContent.trim()));
  }

  /** @returns {Row[]} */
  function ordersRows(table) {
    const actionIdx = columnIndex(table, LABELS.actionColumn);
    return [...table.querySelectorAll('tbody tr')].map(tr => {
      const cells = [...tr.children];
      const limit = tr.querySelector(SEL.orderLimit)?.textContent.trim() || '';
      const stop = tr.querySelector(SEL.orderStop)?.textContent.trim() || '';
      const currency = (limit.match(/^[^\d\s—-]+/) || stop.match(/^[^\d\s—-]+/) || [''])[0].trim();
      // action: DEGIRO's badge says BUY / SELL in data-action whatever the language; else the
      // Action column, or any cell that says Buy/Sell
      const badge = tr.querySelector(SEL.buySellBadge);
      const side = (badge?.getAttribute('data-action') || '').toUpperCase();
      const actionCell = badge || (actionIdx >= 0 ? cells[actionIdx] : cells.find(c => BUY.test(c.textContent.trim()) || SELL.test(c.textContent.trim())));
      const actionText = actionCell?.textContent.trim() || '';
      const action = side === 'BUY' ? 'buy' : side === 'SELL' ? 'sell' : BUY.test(actionText) ? 'buy' : SELL.test(actionText) ? 'sell' : '';
      return {
        tr: /** @type {HTMLElement} */ (tr), action, currency, actionCell,
        // DEGIRO marks the name; the cell also holds a category badge (A/H…) we must not include
        product: (tr.querySelector(SEL.orderProduct)?.textContent || cells[0]?.textContent || '').trim(),
        value: num(tr.querySelector(SEL.orderValue)?.textContent)
      };
    }).filter(r => r.product);
  }

  // insert above the table's block (below DEGIRO's own search box)
  function ordersPlace(panel, table) {
    /** @type {Element} */
    let anchor = table;
    while (anchor.parentElement && !anchor.parentElement.querySelector('input')) anchor = anchor.parentElement;
    if (panel.nextElementSibling !== anchor) anchor.before(panel);
  }

  // ---------- Transactions ----------

  // [data-name=transactions] is also the "Latest Transactions" mini list in the upper panel (first in
  // the document while the panel is open): take the one that holds the table with DEGIRO's value hooks
  function transactionsRoot() {
    return [...document.querySelectorAll(SEL.transactions)].find(el => el.querySelector(`table ${SEL.txValue}`)) || null;
  }

  function transactionsTable() {
    if (!page.isTransactions()) return null;
    // the one with DEGIRO's value hooks (not, say, a date picker's calendar)
    return [...(transactionsRoot()?.querySelectorAll('table') || [])].find(t => t.querySelector(SEL.txValue)) || null;
  }

  /** @returns {Row[]} */
  function transactionsRows(table) {
    return [...table.querySelectorAll('tbody tr')].map(tr => {
      const text = sel => tr.querySelector(sel)?.textContent.trim() || '';
      // DEGIRO's badge says BUY / SELL in data-action whatever the language; its text as a fallback
      const badge = tr.querySelector(SEL.buySellBadge);
      const side = (badge?.getAttribute('data-action') || '').toUpperCase(), label = badge?.textContent.trim() || '';
      const action = side === 'BUY' || (!side && BUY.test(label)) ? 'buy' : side === 'SELL' || (!side && SELL.test(label)) ? 'sell' : '';
      // values are signed (a buy is negative): totals use the amount
      const local = text(SEL.txLocalValue), value = text(SEL.txValue);
      // fees in the account currency: Value − Total covers every fee (AutoFX too); else the Fees column
      const fee = num(value) - num(text(SEL.txTotal)), feeCell = text(SEL.txFee);
      return {
        tr: /** @type {HTMLElement} */ (tr), action, actionCell: badge,
        product: text(SEL.orderProduct),
        currency: currencyOf(local),
        value: Math.abs(num(local)),
        base: currencyOf(value) || currencyOf(feeCell),
        // a dash in the Fees column means no fee: 0, not unknown
        fee: isFinite(fee) ? fee : isDash(feeCell) ? 0 : -num(feeCell)
      };
    }).filter(r => r.product);
  }

  // below DEGIRO's own filters (search, dates, period), above the table
  function transactionsPlace(panel, table) {
    const filters = transactionsRoot()?.querySelector(SEL.transactionsFilters);
    if (filters && !filters.contains(table)) { if (filters.nextElementSibling !== panel) filters.after(panel); return; }
    if (table.previousElementSibling !== panel) table.before(panel);
  }

  // DEGIRO shows 100 rows per page by default: is there another page?
  const morePages = () => [.../** @type {NodeListOf<HTMLButtonElement>} */ (transactionsRoot()?.querySelectorAll(SEL.pageButtons) || [])]
    .some(b => !b.disabled && b.getAttribute('aria-disabled') !== 'true');

  // ---------- columns (both pages) ----------

  // DEGIRO's header texts are localised: each column is found by the hook in its body cells. Product
  // is never offered. Only DEGIRO's table (`scope`) counts: the style below hides by that selector.
  /** @returns {{ index: Record<string, number>, heads: Element[], product: number } | null} */
  function columnHooks(table, scope, hooks) {
    if (!table?.matches(scope)) return null;
    const cells = [...(table.querySelector('tbody tr')?.children || [])];
    const heads = [...(table.querySelector('thead tr')?.children || [])];
    if (!cells.length || heads.length !== cells.length) return null; // colspans: nth-child would hit the wrong cells
    const at = sel => cells.findIndex(td => td.matches(sel) || td.querySelector(sel));
    /** @type {Record<string, number>} */
    const index = {};
    for (const [k, sel] of Object.entries(hooks)) index[k] = at(sel);
    return { index, heads, product: at(SEL.orderProduct) };
  }

  /**
   * One columns setting: the picker's list, the hiding style, the saved choice.
   * @param {{ key: string, keys: string[], scope: string, styleId: string, hooks: Record<string, string>,
   *   derive?: (i: Record<string, number>) => void }} c
   * @returns {Columns}
   */
  function columnsSetting(c) {
    return {
      find: table => {
        const found = columnHooks(table, c.scope, c.hooks);
        if (!found) return [];
        const { index: i, heads, product } = found;
        c.derive?.(i);
        // offered under DEGIRO's own (localised) header; a column without one isn't offered
        return c.keys.filter(k => i[k] >= 0 && i[k] !== product)
          .map(k => ({ key: k, index: i[k], label: heads[i[k]].textContent.trim() }))
          .filter(col => col.label);
      },
      hidden: () => dgSettings[c.key],
      defaults: DG_DEFAULTS[c.key],
      // one owned style element hides the chosen columns, so DEGIRO's re-rendered rows are hidden at
      // once. It also fits the other columns to their content and gives Product the rest: DEGIRO pins
      // Product at 320px and spreads the spare width over the other columns, truncating long names.
      apply: (table, indexes) => {
        let style = document.getElementById(c.styleId);
        const product = columnHooks(table, c.scope, {})?.product ?? -1;
        if (!indexes.length && product < 0) { style?.remove(); return; }
        const T = c.scope;
        let css = indexes.length ? indexes.map(n => `${T} tr > :nth-child(${n + 1})`).join(',\n') + ' { display: none !important; }' : '';
        if (product >= 0) css += `\n${T} tr > * { width: 1px !important; white-space: nowrap; }\n${T} tr > :nth-child(${product + 1}) { width: auto !important; max-width: none !important; }`;
        if (!style) { style = own(document.createElement('style')); style.id = c.styleId; document.head.append(style); }
        if (style.textContent !== css) style.textContent = css;
      },
      // shown at once, then saved (chrome.storage.sync: other tabs and devices follow)
      save: keys => {
        const list = c.keys.filter(k => keys.includes(k));
        dgSettings[c.key] = list;
        try { chrome.storage.sync.set({ [c.key]: list }).catch(() => {}); } catch (e) {}
      }
    };
  }

  // Transactions: the columns without a hook (Venue, Qty, Exchange Rate, AutoFX Fee) are found by
  // their place between two that have one, only when the gap fits exactly
  const txColumns = columnsSetting({
    key: 'txHiddenColumns', keys: DG_TX_COLUMNS, styleId: 'dg-tx-columns',
    scope: `${SEL.transactions} table:has(${SEL.txValue})`,
    hooks: { date: SEL.rowDate, symbolIsin: SEL.symbolIsin, exchange: SEL.exchangeAbbr, action: SEL.buySellBadge,
      price: SEL.txPrice, localValue: SEL.txLocalValue, value: SEL.txValue, fees: SEL.txFee, total: SEL.txTotal },
    derive: i => {
      const between = (a, b, gap) => i[a] >= 0 && i[b] - i[a] === gap + 1;
      i.venue = between('exchange', 'action', 1) ? i.exchange + 1 : -1;
      i.qty = between('action', 'price', 1) ? i.action + 1 : -1;
      i.exchangeRate = between('value', 'fees', 2) ? i.value + 1 : -1;
      i.autoFxFee = between('value', 'fees', 2) ? i.value + 2 : -1;
    }
  });
  // Orders → Outstanding: every column has a hook
  // body-cell hooks for every Orders → Outstanding column, Product included (ordersColumns below never
  // offers Product for hiding, but the sort memory further down needs it too)
  const ORDERS_HOOKS = { product: SEL.orderProduct, date: SEL.rowDate, symbolIsin: SEL.symbolIsin,
    exchange: SEL.exchangeAbbr, action: SEL.buySellBadge, qty: SEL.orderQtyColumn, limit: SEL.orderLimit,
    stopPrice: SEL.orderStop, value: SEL.orderValue, outstanding: SEL.orderOutstanding, executed: SEL.orderExecuted };
  const ordersColumns = columnsSetting({
    key: 'ordersHiddenColumns', keys: DG_ORDER_COLUMNS, styleId: 'dg-orders-columns',
    scope: `${SEL.openOrders} table:has(${SEL.orderValue})`,
    hooks: ORDERS_HOOKS
  });
  // the scheduler hears only flags bridged to the page: a column choice from another tab needs a nudge
  dgOnSettings(() => schedule(true));

  // ---------- panel ----------

  /** @param {Config} cfg */
  function filterPanel(cfg) {
    const state = { action: 'all', currencies: new Set(), products: new Set() };
    /** @type {null | 'products' | 'columns'} */
    let openMenu = null;

    // DEGIRO's own Buy/Sell colours, read from the Action column (fallback: DEGIRO palette)
    let pageBuy = null, pageSell = null;
    function readActionColours(rows) {
      const leaf = el => { let e = el; while (e && e.firstElementChild) e = e.firstElementChild; return e; };
      const b = rows.find(r => r.action === 'buy'), s = rows.find(r => r.action === 'sell');
      if (b?.actionCell) pageBuy = getComputedStyle(leaf(b.actionCell)).color;
      if (s?.actionCell) pageSell = getComputedStyle(leaf(s.actionCell)).color;
    }

    // ---------- filtering ----------
    const matches = r =>
      (state.action === 'all' || r.action === state.action) &&
      (!state.currencies.size || state.currencies.has(r.currency)) &&
      (!state.products.size || state.products.has(r.product));

    function applyFilter(rows) {
      rows.forEach(r => {
        const show = matches(r);
        if (show && r.tr.hasAttribute(cfg.hidden)) { r.tr.style.removeProperty('display'); r.tr.removeAttribute(cfg.hidden); }
        if (!show && !r.tr.hasAttribute(cfg.hidden)) { r.tr.style.setProperty('display', 'none', 'important'); r.tr.setAttribute(cfg.hidden, ''); }
      });
    }

    function unhideAll() {
      /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(`[${cfg.hidden}]`)).forEach(tr => { tr.style.removeProperty('display'); tr.removeAttribute(cfg.hidden); });
    }

    // a new date range or a filled order can take away what was picked: forget it, or nothing shows
    function dropMissing(rows) {
      if (!rows.length) return; // DEGIRO is re-rendering
      const cur = new Set(rows.map(r => r.currency)), prod = new Set(rows.map(r => r.product));
      state.currencies.forEach(c => { if (!cur.has(c)) state.currencies.delete(c); });
      state.products.forEach(p => { if (!prod.has(p)) state.products.delete(p); });
    }

    // ---------- UI ----------
    const money = (n, cur) => `${cur} ${fmt(n)}`;

    // DEGIRO's own Buy/Sell colours when the table shows them, else DEGIRO's palette
    const theme = () => ({ ...dgUi.theme(), ...(pageBuy ? { buy: pageBuy } : {}), ...(pageSell ? { sell: pageSell } : {}) });

    // DEGIRO-style pill: selected = filled (dark, or green/red for Buy/Sell), unselected = plain text
    const chip = dgUi.chip;

    function group(title, th, ...children) {
      const g = document.createElement('div');
      g.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
      const name = document.createElement('span');
      name.textContent = title;
      name.style.cssText = `font-size:12px;color:${th.muted};margin-right:2px;`;
      g.append(name, ...children);
      return g;
    }

    // DEGIRO-style dropdown of checkboxes (products, columns)
    const picker = (kind, label, active, items, th, footer) => dgUi.picker({ kind, label, active, items, th, footer,
      open: openMenu === kind, onToggle: () => { openMenu = openMenu === kind ? null : kind; render(); }, onChange: render });

    function productPicker(rows, th) {
      const n = state.products.size;
      const items = [...new Set(rows.map(r => r.product))].sort((a, b) => a.localeCompare(b)).map(p => ({
        text: `${p} (${rows.filter(r => r.product === p).length})`,
        checked: state.products.has(p),
        change: on => { on ? state.products.add(p) : state.products.delete(p); }
      }));
      return picker('products', n ? t('ordersSelected', n) : t('ordersAllProducts'), n > 0, items, th);
    }

    // checked = shown; Reset brings back the default hidden columns
    function columnPicker(cols, th) {
      const c = /** @type {Columns} */ (cfg.columns);
      const hidden = c.hidden(), n = cols.filter(col => hidden.includes(col.key)).length;
      const items = cols.map(col => ({
        text: col.label,
        checked: !hidden.includes(col.key),
        change: on => c.save(on ? c.hidden().filter(k => k !== col.key) : [...c.hidden(), col.key])
      }));
      const reset = chip(t('columnsReset'), false, () => { c.save(c.defaults); render(); }, th);
      reset.dataset.dgColumnsReset = '';
      reset.style.marginTop = '4px';
      return picker('columns', n ? t('columnsHidden', n) : t('allColumns'), n > 0, items, th, reset);
    }

    // "Label  part · part": coloured label, plain values ('—' when there are none)
    function line(kind, label, color, parts) {
      const el = document.createElement('div');
      el.dataset.dgTotal = kind;
      const name = document.createElement('span');
      name.textContent = label + ' ';
      name.style.cssText = `color:${color};font-weight:500;`;
      const v = document.createElement('span');
      v.textContent = parts.length ? parts.join(' · ') : '—';
      el.append(name, v);
      return el;
    }

    function totals(rows, th, more) {
      const box = document.createElement('div');
      box.dataset.dgTotals = '';
      box.style.cssText = 'display:flex;gap:18px;flex-wrap:wrap;font-size:12px;';
      const shown = rows.filter(matches);
      const sum = {}, fees = {};
      shown.forEach(r => {
        if (r.base && isFinite(r.fee)) fees[r.base] = (fees[r.base] || 0) + r.fee;
        if (!r.action || !isFinite(r.value)) return;
        const k = r.currency || '?';
        sum[k] = sum[k] || { buy: 0, sell: 0, nb: 0, ns: 0 };
        if (r.action === 'buy') { sum[k].buy += r.value; sum[k].nb++; } else { sum[k].sell += r.value; sum[k].ns++; }
      });
      const cur = Object.keys(sum).sort();
      const side = kind => cur.filter(c => (kind === 'buy' ? sum[c].nb : sum[c].ns) > 0)
        .map(c => `${money(kind === 'buy' ? sum[c].buy : sum[c].sell, c)} (${kind === 'buy' ? sum[c].nb : sum[c].ns})`);
      box.append(line('buy', t('ordersTotalBuy'), th.buy, side('buy')), line('sell', t('ordersTotalSell'), th.sell, side('sell')));
      if (cfg.extras) {
        box.append(
          line('net', t('txNet'), th.text, cur.map(c => money(sum[c].buy - sum[c].sell, c))),
          line('fees', t('txFees'), th.text, Object.keys(fees).sort().map(c => money(fees[c], c))));
      }
      const count = document.createElement('div');
      count.dataset.dgCount = '';
      count.style.color = th.muted;
      count.textContent = t(cfg.countKey, shown.length, rows.length) + (more ? ` · ${t('txPageOnly')}` : '');
      box.append(count);
      return box;
    }

    function render() {
      if (!cfg.enabled()) return 'idle'; // the menu's own handlers call render() outside the scheduler
      const table = cfg.table();
      let panel = document.getElementById(cfg.panelId);
      if (!table) { panel?.remove(); unhideAll(); cfg.columns?.apply(null, []); return cfg.isPage() ? 'missing' : 'idle'; }
      const rows = cfg.rows(table);
      readActionColours(rows);
      dropMissing(rows);
      applyFilter(rows);
      const cols = cfg.columns ? cfg.columns.find(table) : [];
      const hiddenCols = cfg.columns ? cfg.columns.hidden() : [];
      cfg.columns?.apply(table, cols.filter(c => hiddenCols.includes(c.key)).map(c => c.index));

      if (!panel) {
        panel = own(document.createElement('div'));
        panel.id = cfg.panelId;
      }
      cfg.place(panel, table);

      const th = theme();
      const more = cfg.extras && morePages();
      // rebuild only when something we show changed (the page updates constantly)
      const key = JSON.stringify([rows.map(r => [r.product, r.action, r.currency, r.value, r.base, r.fee]), state.action,
        [...state.currencies], [...state.products], openMenu, more, cols, hiddenCols, th.bg, th.text]);
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
      if (cols.length) filters.append(group(t('columns'), th, columnPicker(cols, th)));
      const active = state.action !== 'all' || state.currencies.size || state.products.size;
      if (active) {
        const reset = chip(t('ordersClear'), false, () => { state.action = 'all'; state.currencies.clear(); state.products.clear(); openMenu = null; render(); }, th);
        reset.dataset.dgReset = '';
        filters.append(reset);
      }
      panel.replaceChildren(filters, totals(rows, th, more));
      return 'ok';
    }

    // close the product menu on outside click; inside the panel, redraw only after the click, or a
    // rebuilt panel would swallow the click on the chip that was pressed (e.g. Clear filters)
    document.addEventListener('mousedown', e => {
      const target = /** @type {Element} */ (e.target);
      if (!openMenu || !cfg.enabled() || target.closest?.(`#${cfg.panelId} [role=listbox], #${cfg.panelId} [data-dg-${openMenu}]`)) return;
      openMenu = null;
      if (target.closest?.(`#${cfg.panelId}`)) document.addEventListener('click', () => render(), { once: true });
      else render();
    }, true);

    // DEGIRO re-renders rows (live updates, paging, sorting): the scheduler re-applies
    feature({
      name: cfg.name,
      enabled: cfg.enabled,
      run: render,
      // switched off: forget the filters too, so switching on again starts with every row shown
      stop: () => {
        openMenu = null;
        cfg.columns?.apply(null, []);
        state.action = 'all'; state.currencies.clear(); state.products.clear();
        document.getElementById(cfg.panelId)?.remove(); unhideAll();
      }
    });
  }

  filterPanel({
    name: 'ordersFilter', enabled: () => dgSettings.ordersFilter,
    panelId: 'dg-orders-panel', hidden: 'data-dg-filtered',
    isPage: page.isOrders, table: ordersTable, rows: ordersRows, place: ordersPlace,
    countKey: 'ordersCount', extras: false, columns: ordersColumns
  });
  filterPanel({
    name: 'transactionsFilter', enabled: () => dgSettings.transactionsFilter,
    panelId: 'dg-transactions-panel', hidden: 'data-dg-tx-filtered',
    isPage: page.isTransactions, table: transactionsTable, rows: transactionsRows, place: transactionsPlace,
    countKey: 'txCount', extras: true, columns: txColumns
  });

  // ---------- Orders → Outstanding: remember the sort column/direction ----------
  // DEGIRO forgets which column is sorted (and which way) every time the page remounts (navigate away
  // and back, or reload); Product starts unsorted and Date starts newest-first. We read the column
  // DEGIRO is currently sorted by from its own `aria-sort` on <thead th>, save it on a trusted click,
  // and on a later mount click the matching header (DEGIRO's own sort, not ours) until it matches again.
  const ORDERS_SORT_SCOPE = `${SEL.openOrders} table:has(${SEL.orderValue})`;

  // the clickable header: DEGIRO wraps the label (and sort icon) in one <button> per <th>
  const sortButtonAt = (heads, idx) => (idx >= 0 ? heads[idx]?.querySelector('button') || null : null);

  function sanitizeSort(v) {
    if (!v || typeof v !== 'object' || !Object.prototype.hasOwnProperty.call(ORDERS_HOOKS, v.col)) return null;
    return v.dir === 'ascending' || v.dir === 'descending' ? { col: v.col, dir: v.dir } : null;
  }

  let dgOrdersSort = null, sortLoaded = false;
  try {
    chrome.storage.sync.get({ dgOrdersSort: null }, r => { dgOrdersSort = sanitizeSort(r?.dgOrdersSort); sortLoaded = true; schedule(); });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.dgOrdersSort) { dgOrdersSort = sanitizeSort(changes.dgOrdersSort.newValue); schedule(); }
    });
  } catch (e) {}

  function saveSort(col, dir) {
    dgOrdersSort = { col, dir };
    try { chrome.storage.sync.set({ dgOrdersSort }).catch(() => {}); } catch (e) {}
  }

  // per-mount memory: reset once when we arrive at the Orders page (extension startup, or navigating
  // back to it), not on the <table> element's identity — DEGIRO re-renders rows in place on every sort
  // (confirmed against the real page: repeated clicks never replace the node), so keying resets off the
  // element could, if DEGIRO ever did replace it for an unrelated reason, revert a just-made user click
  // and retry forever. A brief "missing" table (DEGIRO still loading) is not treated as leaving the page.
  let sortMounted = false, sortPendingKey = null, sortPendingFrom = null, sortUserDone = false,
    sortAttempts = 0, sortPendingWait = 0, sortRestoring = false;

  // a click saves the column once DEGIRO applies it (read back in sortRun, against the aria-sort value
  // snapshotted here before DEGIRO's own handler runs: our listener is capture-phase, so it fires first).
  // `btn.click()` below dispatches synchronously, so this listener can tell its own restore click
  // (sortRestoring is still true while it runs) from one the user made, without relying on Event.isTrusted.
  document.addEventListener('click', e => {
    if (sortRestoring || !dgSettings.ordersSort || !page.isOrders()) return;
    const btn = /** @type {Element} */ (e.target).closest?.('thead button');
    if (!btn) return;
    const table = ordersTable();
    const found = table && columnHooks(table, ORDERS_SORT_SCOPE, ORDERS_HOOKS);
    if (!found) return;
    const key = Object.keys(ORDERS_HOOKS).find(k => sortButtonAt(found.heads, found.index[k]) === btn);
    if (!key) return;
    sortUserDone = true; // the user is choosing a sort here: stop auto-restoring on this mount
    sortPendingKey = key;
    sortPendingFrom = found.heads[found.index[key]]?.getAttribute('aria-sort') ?? null;
    sortPendingWait = 0;
  }, true);

  function sortRun() {
    if (!page.isOrders()) { sortMounted = false; return 'idle'; }
    if (!sortMounted) { sortMounted = true; sortPendingKey = null; sortUserDone = false; sortAttempts = 0; }
    const table = ordersTable();
    if (!table) return 'missing';
    const found = columnHooks(table, ORDERS_SORT_SCOPE, ORDERS_HOOKS);
    if (!found) return 'ok';

    if (sortPendingKey) {
      const dir = found.heads[found.index[sortPendingKey]]?.getAttribute('aria-sort');
      // only once DEGIRO's own click handler has actually changed it from what it was at click time:
      // a scheduler run squeezed in between the click and DEGIRO applying it would otherwise save the
      // stale (pre-click) direction as if it were the result
      if ((dir === 'ascending' || dir === 'descending') && dir !== sortPendingFrom) {
        saveSort(sortPendingKey, dir); sortPendingKey = null;
      } else if (++sortPendingWait >= 5) {
        sortPendingKey = null; // gave up: DEGIRO never applied it (or applied an unreadable value); the
      } // user's click already stopped auto-restore, so nothing fights them over it
      return 'ok';
    }
    if (sortUserDone || !sortLoaded || !dgOrdersSort || sortAttempts >= 3) return 'ok';

    const idx = found.index[dgOrdersSort.col];
    const th = idx >= 0 ? found.heads[idx] : null;
    if (!th) { sortAttempts = 3; return 'ok'; } // this table has no such column
    if (th.getAttribute('aria-sort') === dgOrdersSort.dir) { sortAttempts = 3; return 'ok'; }
    const btn = sortButtonAt(found.heads, idx);
    if (!btn) { sortAttempts = 3; return 'ok'; }
    sortAttempts++;
    sortRestoring = true;
    try { btn.click(); } finally { sortRestoring = false; } // DEGIRO's own sort; switching column
    // always lands on ascending, a second click descends
    return 'ok';
  }

  feature({
    name: 'ordersSort', enabled: () => dgSettings.ordersSort, run: sortRun,
    stop: () => { sortMounted = false; sortPendingKey = null; sortUserDone = false; sortAttempts = 0; sortPendingWait = 0; }
  });
})();
