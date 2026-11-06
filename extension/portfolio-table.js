// Portfolio: merge the Shares / Trackers (ETFs) / Structured products holdings tables (one <h3> +
// table per section, see SEL.portfolioSection in common.js) into a single table, hiding DEGIRO's own
// three.
(() => {
  const { SEL, page, own, feature, schedule, parseNum, t } = __dgt; // common.js

  // Column hooks sit on each row's body cells (data-field / data-name), never the <th> (the header
  // text is localised) — same pattern, and same file-local placement, as ORDERS_HOOKS in
  // orders-table.js. `product`'s hook is the separate SEL.portfolioProduct (never hideable, also
  // carries the row's data-id), so it has no entry here.
  const PORTFOLIO_HOOKS = {
    symbolIsin: '[data-field="productInfo.symbol"]',
    exchange: '[data-field="productInfo.exchange.hiqAbbr"]',
    qty: '[data-field=size]',
    price: '[data-field=price]',
    currency: '[data-field="productInfo.currency"]',
    value: '[data-field=value]',
    bep: '[data-field=breakEvenPrice]',
    plEuro: '[data-field=todayPl]',
    plPercent: '[data-field=change]',
    unrealisedPl: '[data-field=unrealizedRelativePl]',
    totalPl: '[data-field=totalPl]',
    last: '[data-field=lastUpdate]',
    delay: '[data-name=feedQuality]'
  };

  // Merged table column order (Product and Type are never hideable) and their display labels.
  const COLUMN_ORDER = ['product', 'type', 'symbolIsin', 'exchange', 'qty', 'price', 'currency', 'value',
    'bep', 'plEuro', 'plPercent', 'unrealisedPl', 'totalPl', 'last', 'delay'];
  const COLUMN_LABEL = {
    product: 'Product', type: 'Type', symbolIsin: 'Symbol | ISIN', exchange: 'Exchange', qty: 'Qty',
    price: 'Price', currency: 'Curr.', value: 'Value', bep: 'BEP', plEuro: 'P/L €', plPercent: 'P/L %',
    unrealisedPl: 'Unrealised P/L €', totalPl: 'Total P/L€', last: 'Last', delay: 'Delay'
  };
  // Columns compared as numbers (parseNum handles both "1.234,56" and "1,234.56"); everything else
  // (Product, Type, Symbol | ISIN, Exchange, Curr., Last, Delay) sorts lexically as text.
  const NUMERIC_COLUMNS = new Set(['qty', 'price', 'value', 'bep', 'plEuro', 'plPercent', 'unrealisedPl', 'totalPl']);

  /**
   * @typedef {{ id: string, type: 'stock'|'etf'|'lox', cells: Record<string,string>, nativeRow: Element }} Row
   */
  // Column/Columns are dgUi.columnsSetting()'s own types (declared in ui.js); JSDoc typedefs inside an
  // IIFE don't cross files, so they're redeclared here too — same as DgPageFlags across common.js/
  // common-isolated.js/alarm-lines.js.
  /** @typedef {{ key: string, index: number, label: string }} Column
   * @typedef {{ find: (table: Element) => Column[], hidden: () => string[], save: (keys: string[]) => void,
   *   defaults: string[], apply: (table: Element | null, indexes: number[]) => void }} Columns */

  // Parses a `[data-field=foo]` / `[data-name="a.b"]` hook selector into its [attribute, value] pair,
  // so a built cell can carry the very same attribute its source hook reads — later tasks' Columns
  // dropdown and sort logic then locate merged cells with PORTFOLIO_HOOKS the same way they locate
  // native ones.
  /** @param {string} sel @returns {[string, string] | null} */
  function hookAttr(sel) {
    const m = /^\[([\w-]+)=(?:"([^"]*)"|([^\]]+))\]$/.exec(sel);
    return m ? [m[1], /** @type {string} */ (m[2] ?? m[3])] : null;
  }

  /** @type {HTMLTableElement | null} */
  let table = null; // the merged table: built once, kept (not recreated) while the feature stays on

  /** @typedef {{ col: string, dir: 'ascending' | 'descending' }} SortState */
  const DEFAULT_SORT = /** @type {SortState} */ ({ col: 'type', dir: 'ascending' });
  // Starts at the default every page load; the chrome.storage.sync.get below may replace it once,
  // if portfolioMergedPersist is on and a stored value is there and valid.
  let sortState = DEFAULT_SORT;

  // Mirrors sanitizeSort() in orders-table.js: rejects a col outside this table's own columns, or a
  // dir that isn't a real aria-sort value, so a stale (older version, now-renamed/removed column) or
  // corrupted stored value falls back to the default sort rather than throwing or sorting by nothing.
  /** @param {unknown} v @returns {SortState | null} */
  function sanitizePortfolioSort(v) {
    const col = /** @type {any} */ (v)?.col, dir = /** @type {any} */ (v)?.dir;
    if (!v || typeof v !== 'object' || !COLUMN_ORDER.includes(col)) return null;
    return dir === 'ascending' || dir === 'descending' ? { col, dir } : null;
  }

  // Remembers the sort across reloads — the storage plumbing mirrors dgOrdersSort in orders-table.js
  // exactly (read once + chrome.storage.onChanged, both resilient to a missing/erroring chrome.*), but
  // this table is entirely built and sorted by us (applySort/renderRows above), so "restoring" a saved
  // sort is just setting sortState and letting the next render pick it up — there is nothing to click
  // to make DEGIRO re-sort anything, unlike Orders' own native table.
  //
  // Gated by portfolioMergedPersist (Task 3): off, a stored value is never read into sortState (and
  // saveSort() below never writes one) — the saved value itself is left alone in chrome.storage.sync,
  // so turning the toggle on again later (and reloading) restores it.
  let dgPortfolioSort = /** @type {SortState | null} */ (null);
  try {
    chrome.storage.sync.get({ dgPortfolioSort: null }, r => {
      dgPortfolioSort = sanitizePortfolioSort(r?.dgPortfolioSort);
      if (dgSettings.portfolioMergedPersist && dgPortfolioSort) sortState = dgPortfolioSort;
      schedule();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes.dgPortfolioSort) return;
      dgPortfolioSort = sanitizePortfolioSort(changes.dgPortfolioSort.newValue);
      if (dgSettings.portfolioMergedPersist && dgPortfolioSort) sortState = dgPortfolioSort;
      schedule();
    });
  } catch (e) {}

  /** @param {string} col @param {'ascending' | 'descending'} dir */
  function saveSort(col, dir) {
    sortState = { col, dir };
    if (!dgSettings.portfolioMergedPersist) return; // never write while the toggle is off
    dgPortfolioSort = sortState;
    try { chrome.storage.sync.set({ dgPortfolioSort: sortState }).catch(() => {}); } catch (e) {}
  }

  // The header row is built once: every column (hideable or not) gets a <th>, plus one trailing blank
  // <th> for the Buy/Sell actions column (matching DEGIRO's own trailing blank header on its native
  // tables) — dgUi.columnsSetting()'s columnHooks() needs the <thead>/<tbody> column counts to match
  // (see Task 7), so hiding a column is done with CSS (dgUi.columnsSetting's own `apply`, called from
  // renderToolbar below), never by leaving it out of the DOM. Each <th> carries data-dg-col so the
  // click listener and syncSortAttrs below can find it again without depending on column order.
  /** @param {HTMLTableElement} tbl */
  function renderHead(tbl) {
    const thead = /** @type {Element} */ (tbl.querySelector('thead'));
    if (!thead.querySelector('tr')) {
      const tr = document.createElement('tr');
      COLUMN_ORDER.forEach(k => {
        const th = document.createElement('th');
        th.setAttribute('data-dg-col', k);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = COLUMN_LABEL[k];
        th.append(btn);
        tr.append(th);
      });
      tr.append(document.createElement('th')); // Buy/Sell column: no header label
      thead.replaceChildren(tr);
    }
    syncSortAttrs(tbl);
  }

  // aria-sort reflects the in-memory sortState on every render (cheap attribute writes the scheduler
  // never observes: attributeFilter only watches data-dg-tweaks/data-dg-alarm-lines), independently of
  // whether the header itself was just rebuilt.
  /** @param {HTMLTableElement} tbl */
  function syncSortAttrs(tbl) {
    tbl.querySelectorAll('thead th[data-dg-col]').forEach(th => {
      th.setAttribute('aria-sort', th.getAttribute('data-dg-col') === sortState.col ? sortState.dir : 'none');
    });
  }

  // Sorts a copy of rows by sortState.col: numeric columns parse both "1.234,56" and "1,234.56"
  // (parseNum from common.js already handles either), everything else compares as text. A blank or
  // non-numeric cell (e.g. a value not yet ticked in) always sorts last, in both directions — not
  // just "last when ascending" (which would make it jump to the top on a direction toggle).
  /** @param {Row[]} rows @param {SortState} state @returns {Row[]} */
  function applySort(rows, state) {
    const numeric = NUMERIC_COLUMNS.has(state.col);
    const sign = state.dir === 'ascending' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a.cells[state.col] || '', bv = b.cells[state.col] || '';
      if (!numeric) return sign * av.localeCompare(bv);
      const x = parseNum(av), y = parseNum(bv);
      if (isNaN(x) && isNaN(y)) return 0;
      if (isNaN(x)) return 1; // blanks always last, regardless of sort direction
      if (isNaN(y)) return -1;
      return sign * (x - y);
    });
  }

  // Returns the merged <table data-dg-portfolio-table>, creating it once (own()-marked, so our own
  // changes to it never trigger another scheduler run) and keeping its header in sync.
  function portfolioTable() {
    if (!table) {
      table = /** @type {HTMLTableElement} */ (own(document.createElement('table')));
      table.setAttribute('data-dg-portfolio-table', '');
      table.append(document.createElement('thead'), document.createElement('tbody'));
    }
    renderHead(table);
    return table;
  }

  // Hides DEGIRO's own three holdings tables (never removes them: their own pagination etc. must
  // keep working underneath). One owned style, built once — the selectors are static.
  function hideNativeTables() {
    if (document.getElementById('dg-portfolio-hide-native')) return;
    const style = /** @type {HTMLStyleElement} */ (own(document.createElement('style')));
    style.id = 'dg-portfolio-hide-native';
    style.textContent = Object.values(SEL.portfolioSection).map(sel => `${sel} ~ * table { display: none !important; }`).join('\n');
    document.head.append(style);
  }

  // Every current <tr> under each of the three native sections (the same `${sel} ~ * table` each
  // section's table is found by in hideNativeTables's style), tagged with which section it came from
  // and a reference to that <tr> — Buy/Sell forwarding below, and later tasks (sort, pagination), use
  // it. Reads fresh every call: DEGIRO may have re-rendered a row (a live price/value update, a page
  // change) since the last one, and this never mutates what it reads.
  /** @returns {Row[]} */
  function collectRows() {
    /** @type {Row[]} */
    const rows = [];
    for (const [type, sel] of Object.entries(SEL.portfolioSection)) {
      const h3 = document.querySelector(sel);
      const nativeTable = document.querySelector(`${sel} ~ * table`);
      if (!h3 || !nativeTable) continue;
      const typeLabel = h3.textContent.trim(); // DEGIRO's own section heading: language-independent
      nativeTable.querySelectorAll('tbody tr').forEach(tr => {
        const product = tr.querySelector(SEL.portfolioProduct);
        if (!product) return;
        /** @type {Record<string, string>} */
        const cells = { product: product.textContent.trim(), type: typeLabel };
        Object.keys(PORTFOLIO_HOOKS).forEach(key => {
          cells[key] = tr.querySelector(PORTFOLIO_HOOKS[key])?.textContent.trim() || '';
        });
        rows.push({ id: product.getAttribute('data-id') || '', type: /** @type {Row['type']} */ (type), cells, nativeRow: tr });
      });
    }
    return rows;
  }

  // Clears and rebuilds the merged table's <tbody> from collectRows()'s output. Called every run()
  // tick, so it is idempotent and always reflects the current DOM, including DEGIRO's own live price
  // updates to the hidden native rows. Each row's Type cell carries data-dg-type; every other cell
  // carries the same data-field/data-name hook its value came from.
  /** @param {Row[]} rows */
  function renderRows(rows) {
    const tbl = portfolioTable();
    const sorted = applySort(rows, sortState);
    const frag = document.createDocumentFragment();
    sorted.forEach(row => {
      const tr = document.createElement('tr');
      COLUMN_ORDER.forEach(k => {
        const td = document.createElement('td');
        if (k === 'product') td.setAttribute('data-name', 'productName');
        else if (k === 'type') td.setAttribute('data-dg-type', row.type);
        else {
          const attr = hookAttr(PORTFOLIO_HOOKS[k]);
          if (attr) td.setAttribute(attr[0], attr[1]);
        }
        td.textContent = row.cells[k] || '';
        tr.append(td);
      });
      // Buy/Sell: forwards a click to the real, already-rendered DEGIRO button for this row — never
      // creates or dispatches a new order action itself (extension-security.md: never place, change,
      // or cancel orders).
      const actions = document.createElement('td');
      ['buy', 'sell'].forEach(action => {
        const native = row.nativeRow.querySelector(`button[data-action=${action}]`);
        if (!native) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-action', action);
        btn.textContent = native.textContent;
        btn.addEventListener('click', () => { /** @type {HTMLElement | null} */ (row.nativeRow.querySelector(`button[data-action=${action}]`))?.click(); });
        actions.append(btn);
      });
      tr.append(actions);
      frag.append(tr);
    });
    /** @type {Element} */ (tbl.querySelector('tbody')).replaceChildren(frag);
  }

  // "Columns ▾" dropdown: dgUi.columnsSetting() + dgUi.picker, the exact pair Orders/Transactions use
  // (moved into ui.js so this file can reuse them — see ui.js and the ledger ruling for Task 7).
  // Product and Type are never offered: DG_PORTFOLIO_COLUMNS already excludes both.
  const portfolioColumns = dgUi.columnsSetting({
    key: 'portfolioHiddenColumns', keys: DG_PORTFOLIO_COLUMNS, hooks: PORTFOLIO_HOOKS,
    styleId: 'dg-portfolio-columns', scope: '[data-dg-portfolio-table]'
  });

  // Gated by portfolioMergedPersist the same way sortState is above: portfolioColumns.hidden() reads
  // dgSettings.portfolioHiddenColumns directly, which flags.js keeps populated from chrome.storage.sync
  // regardless of this toggle, so reading it here (rather than through dgUi.columnsSetting itself,
  // which Orders/Transactions also use with no opt-out) is what makes the toggle apply. Off, every
  // column starts shown/hidden exactly as DG_DEFAULTS.portfolioHiddenColumns says, ignoring (but never
  // deleting) whatever is actually stored; on, the stored choice is read normally.
  const hiddenColumns = () => dgSettings.portfolioMergedPersist ? portfolioColumns.hidden() : DG_DEFAULTS.portfolioHiddenColumns;
  // portfolioColumns.save() both updates dgSettings in memory and writes chrome.storage.sync; off, a
  // column checkbox has no effect (hiddenColumns() above ignores it either way) and nothing is written,
  // so re-enabling persist later picks the last-saved value straight back up.
  /** @param {string[]} keys */
  const saveColumns = keys => { if (dgSettings.portfolioMergedPersist) portfolioColumns.save(keys); };

  let openColumns = false; // whether the Columns picker dropdown is open
  /** @type {HTMLElement | null} */
  let toolbar = null; // small bar above the merged table, holding only the Columns picker for now

  function columnsToolbar() {
    if (!toolbar) {
      toolbar = /** @type {HTMLElement} */ (own(document.createElement('div')));
      toolbar.id = 'dg-portfolio-toolbar';
    }
    return toolbar;
  }

  // checked = shown; Reset brings back the default hidden columns — same semantics as orders-table.js's
  // own columnPicker (it has no other filters around it here, so no Reset-sibling chips to match).
  /** @param {Column[]} cols @param {ReturnType<typeof dgUi.theme>} th */
  function columnPicker(cols, th) {
    const hidden = hiddenColumns();
    const n = cols.filter(col => hidden.includes(col.key)).length;
    const items = cols.map(col => ({
      text: col.label,
      checked: !hidden.includes(col.key),
      change: on => saveColumns(on ? hiddenColumns().filter(k => k !== col.key) : [...hiddenColumns(), col.key])
    }));
    const reset = dgUi.chip(t('columnsReset'), false, () => { saveColumns(portfolioColumns.defaults); renderToolbar(); }, th);
    reset.dataset.dgColumnsReset = '';
    reset.style.marginTop = '4px';
    return dgUi.picker({ kind: 'columns', label: n ? t('columnsHidden', n) : t('allColumns'), active: n > 0, items, th, footer: reset,
      open: openColumns, onToggle: () => { openColumns = !openColumns; renderToolbar(); }, onChange: () => renderToolbar() });
  }

  // Rebuilds the toolbar (just the Columns picker for now) and re-applies the hiding style. Called
  // every run() tick, and immediately again from the picker's own toggle/checkbox handlers — like
  // filterPanel's render() in orders-table.js, this does not wait for the next scheduler tick.
  function renderToolbar() {
    if (!table) return;
    const bar = columnsToolbar();
    const th = dgUi.theme();
    const cols = portfolioColumns.find(table);
    portfolioColumns.apply(table, cols.filter(c => hiddenColumns().includes(c.key)).map(c => c.index));
    const key = JSON.stringify([cols, hiddenColumns(), openColumns, th.bg, th.text]);
    if (bar.isConnected && bar.dataset.key === key) return;
    bar.dataset.key = key;
    bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin:8px 0 4px;padding:0 16px;font-family:inherit;';
    bar.replaceChildren(...(cols.length ? [columnPicker(cols, th)] : []));
  }

  // Close the Columns picker on an outside click — mirrors filterPanel's own mousedown listener in
  // orders-table.js (capture-phase, so it runs before the click that opened/changed it). The toolbar
  // holds nothing else, so there's no "swallowed click on a sibling chip" case to guard against there.
  document.addEventListener('mousedown', e => {
    const target = /** @type {Element} */ (e.target);
    if (!openColumns || !dgSettings.portfolioMergedTable || target.closest?.('#dg-portfolio-toolbar [role=listbox], #dg-portfolio-toolbar [data-dg-columns]')) return;
    openColumns = false;
    renderToolbar();
  }, true);

  // A header-button click toggles sortState (same column: flip direction; a new column: ascending)
  // and re-renders immediately, like filterPanel's own chip clicks in orders-table.js — it does not
  // wait for the next scheduler tick. Capture-phase, so it runs before anything else observes the
  // click; guarded by the feature's own enabled() flag, matching ordersSort's click listener.
  document.addEventListener('click', e => {
    if (!dgSettings.portfolioMergedTable) return;
    const btn = /** @type {Element} */ (e.target).closest?.('[data-dg-portfolio-table] thead button');
    if (!btn) return;
    const col = btn.closest('th')?.getAttribute('data-dg-col');
    if (!col) return;
    saveSort(col, sortState.col === col && sortState.dir === 'ascending' ? 'descending' : 'ascending');
    renderRows(collectRows());
  }, true);

  function run() {
    const stock = document.querySelector(SEL.portfolioSection.stock);
    // 'missing' only on the Portfolio page itself (DEGIRO may still be loading, or has changed its
    // page); everywhere else there is simply nothing to do.
    if (!stock) return page.isPortfolio() ? 'missing' : 'idle';
    hideNativeTables();
    const merged = portfolioTable();
    const bar = columnsToolbar();
    if (bar.nextElementSibling !== merged || stock.previousElementSibling !== bar) stock.before(bar, merged);
    renderRows(collectRows());
    renderToolbar();
    return 'ok';
  }

  function stop() {
    document.getElementById('dg-portfolio-hide-native')?.remove();
    table?.remove();
    table = null;
    toolbar?.remove();
    toolbar = null;
    openColumns = false;
    portfolioColumns.apply(null, []);
  }

  feature({ name: 'portfolioTable', enabled: () => !!dgSettings.portfolioMergedTable, run, stop });
})();
