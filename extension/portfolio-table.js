// Portfolio: merge the Shares / Trackers (ETFs) / Structured products holdings tables (one <h3> +
// table per section, see SEL.portfolioSection in common.js) into a single table, hiding DEGIRO's own
// three.
(() => {
  const { SEL, page, own, feature } = __dgt; // common.js

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

  /**
   * @typedef {{ id: string, type: 'stock'|'etf'|'lox', cells: Record<string,string>, nativeRow: Element }} Row
   */

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
  /** @type {string | null} */
  let headKey = null; // last hidden-columns list the header was built from

  // The header row, rebuilt only when the hidden-columns setting actually changes.
  /** @param {HTMLTableElement} t */
  function renderHead(t) {
    const hidden = dgSettings.portfolioHiddenColumns || DG_DEFAULTS.portfolioHiddenColumns;
    const key = JSON.stringify(hidden);
    if (key === headKey) return;
    headKey = key;
    const thead = /** @type {Element} */ (t.querySelector('thead'));
    const tr = document.createElement('tr');
    COLUMN_ORDER.filter(k => !hidden.includes(k)).forEach(k => {
      const th = document.createElement('th');
      th.textContent = COLUMN_LABEL[k];
      tr.append(th);
    });
    thead.replaceChildren(tr);
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
    const t = portfolioTable();
    const hidden = dgSettings.portfolioHiddenColumns || DG_DEFAULTS.portfolioHiddenColumns;
    const shown = COLUMN_ORDER.filter(k => !hidden.includes(k));
    const frag = document.createDocumentFragment();
    rows.forEach(row => {
      const tr = document.createElement('tr');
      shown.forEach(k => {
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
    /** @type {Element} */ (t.querySelector('tbody')).replaceChildren(frag);
  }

  function run() {
    const stock = document.querySelector(SEL.portfolioSection.stock);
    // 'missing' only on the Portfolio page itself (DEGIRO may still be loading, or has changed its
    // page); everywhere else there is simply nothing to do.
    if (!stock) return page.isPortfolio() ? 'missing' : 'idle';
    hideNativeTables();
    const merged = portfolioTable();
    if (stock.previousElementSibling !== merged) stock.before(merged);
    renderRows(collectRows());
    return 'ok';
  }

  function stop() {
    document.getElementById('dg-portfolio-hide-native')?.remove();
    table?.remove();
    table = null;
    headKey = null;
  }

  feature({ name: 'portfolioTable', enabled: () => !!dgSettings.portfolioMergedTable, run, stop });
})();
