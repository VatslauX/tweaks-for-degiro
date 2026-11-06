// Portfolio: merge the Shares / Trackers (ETFs) / Structured products holdings tables (one <h3> +
// table per section, see SEL.portfolioSection in common.js) into a single table, hiding DEGIRO's own
// three. Column hooks sit on each row's body cells (data-field / data-name), never the <th> (the
// header text is localised) — same pattern as ORDERS_HOOKS in orders-table.js. `product`'s hook is
// the separate SEL.portfolioProduct (never hideable, also carries the row's data-id), so it has no
// entry here. Declared at top level, not inside this file's own IIFE below: nothing in this task uses
// it yet (Task 5+ will, later in this same file), and eslint's no-unused-vars only exempts top-level
// declarations (the same reason flags.js's DG_* constants sit at top level, not inside an IIFE).
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

(() => {
  const { SEL, page, own, feature } = __dgt; // common.js

  // Merged table column order (Product and Type are never hideable) and their display labels.
  const COLUMN_ORDER = ['product', 'type', 'symbolIsin', 'exchange', 'qty', 'price', 'currency', 'value',
    'bep', 'plEuro', 'plPercent', 'unrealisedPl', 'totalPl', 'last', 'delay'];
  const COLUMN_LABEL = {
    product: 'Product', type: 'Type', symbolIsin: 'Symbol | ISIN', exchange: 'Exchange', qty: 'Qty',
    price: 'Price', currency: 'Curr.', value: 'Value', bep: 'BEP', plEuro: 'P/L €', plPercent: 'P/L %',
    unrealisedPl: 'Unrealised P/L €', totalPl: 'Total P/L€', last: 'Last', delay: 'Delay'
  };

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

  function run() {
    const stock = document.querySelector(SEL.portfolioSection.stock);
    // 'missing' only on the Portfolio page itself (DEGIRO may still be loading, or has changed its
    // page); everywhere else there is simply nothing to do.
    if (!stock) return page.isPortfolio() ? 'missing' : 'idle';
    hideNativeTables();
    const merged = portfolioTable();
    if (stock.previousElementSibling !== merged) stock.before(merged);
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
