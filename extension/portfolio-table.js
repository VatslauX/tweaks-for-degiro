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
  // Every native column the merged table mirrors a header label or a class from: the hideable ones
  // above, plus Product and the trailing Buy/Sell cell.
  const LOOK_HOOKS = { ...PORTFOLIO_HOOKS, product: SEL.portfolioProduct, actions: 'button[data-action]' };

  // Merged table column order (Product and Type are never hideable).
  const COLUMN_ORDER = ['product', 'type', 'symbolIsin', 'exchange', 'qty', 'price', 'currency', 'value',
    'bep', 'plEuro', 'plPercent', 'unrealisedPl', 'totalPl', 'last', 'delay'];
  // Each header normally mirrors DEGIRO's own (localised) <th> text for that column (nativeLook()
  // below). These English labels are only the fallback while no native header text is found for a
  // column (e.g. the native tables are briefly absent).
  /** @type {Record<string, string>} */
  const COLUMN_LABEL = {
    product: 'Product', symbolIsin: 'Symbol | ISIN', exchange: 'Exchange', qty: 'Qty', price: 'Price',
    currency: 'Curr.', value: 'Value', bep: 'BEP', plEuro: 'P/L €', plPercent: 'P/L %',
    unrealisedPl: 'Unrealised P/L €', totalPl: 'Total P/L€', last: 'Last'
  };
  // Columns DEGIRO has no header text for: Type is this feature's own, and the native Delay <th> is blank.
  /** @type {Record<string, () => string>} */
  const OWN_LABEL = { type: () => t('portfolioType'), delay: () => t('portfolioDelay') };
  // Columns compared as numbers (parseNum handles both "1.234,56" and "1,234.56"); Type sorts by
  // DEGIRO's own section order (TYPE_ORDER), everything else (Product, Symbol | ISIN, Exchange,
  // Curr., Last, Delay) lexically as text.
  const NUMERIC_COLUMNS = new Set(['qty', 'price', 'value', 'bep', 'plEuro', 'plPercent', 'unrealisedPl', 'totalPl']);
  /** @type {Row['type'][]} */
  const TYPE_ORDER = ['stock', 'etf', 'lox']; // Shares, Trackers (ETFs), Structured products
  const HIDDEN = 'data-dg-portfolio-hidden'; // marks DEGIRO's own section headings, tables and pagers we hide

  /**
   * @typedef {{ id: string, type: 'stock'|'etf'|'lox', cells: Record<string,string>, nativeRow: Element }} Row
   * @typedef {{ type: Row['type'], h3: Element, table: Element | null, pager: Element | null }} Section
   */
  // Column/Columns are dgUi.columnsSetting()'s own types (declared in ui.js); JSDoc typedefs inside an
  // IIFE don't cross files, so they're redeclared here too — same as DgPageFlags across common.js/
  // common-isolated.js/alarm-lines.js.
  /** @typedef {{ key: string, index: number, label: string }} Column
   * @typedef {{ find: (table: Element) => Column[], hidden: () => string[], save: (keys: string[]) => void,
   *   defaults: string[], apply: (table: Element | null, indexes: number[]) => void }} Columns */

  // Parses a `[data-field=foo]` / `[data-name="a.b"]` hook selector into its [attribute, value] pair,
  // so a built cell can carry the very same attribute its source hook reads — the Columns dropdown
  // and sort logic then locate merged cells with PORTFOLIO_HOOKS the same way they locate native ones.
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
  // The hidden columns while portfolioMergedPersist is off: like sortState, the picker works for the
  // session either way — the toggle only decides whether the choice is read from / written to
  // chrome.storage.sync (see hiddenColumns()/saveColumns() below).
  /** @type {string[]} */
  let sessionHidden = DG_DEFAULTS.portfolioHiddenColumns;

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
  // this table is entirely built and sorted by us (applySort/renderRows below), so "restoring" a saved
  // sort is just setting sortState and letting the next render pick it up — there is nothing to click
  // to make DEGIRO re-sort anything, unlike Orders' own native table.
  //
  // Gated by portfolioMergedPersist: off, a stored value is never read into sortState (and saveSort()
  // below never writes one) — the saved value itself is left alone in chrome.storage.sync, so turning
  // the toggle on again later restores it.
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

  // Flipping portfolioMergedPersist off must drop an already-applied sort and column choice back to
  // the defaults right away, not only on the next reload. Neither can simply be recomputed from the
  // toggle at render time: a header click (saveSort()) or a column checkbox (saveColumns()) changes
  // the working value regardless of the toggle — sorting and hiding columns never depended on it,
  // only remembering them does. So this reacts only to the toggle itself changing: off, reset both
  // working values to the defaults; on again, pick the last-sanitized stored sort back up immediately
  // (hiddenColumns() then reads the stored columns again by itself) — no reload needed either way.
  let sortPersistWas = dgSettings.portfolioMergedPersist;
  dgOnSettings(() => {
    const on = dgSettings.portfolioMergedPersist;
    if (on === sortPersistWas) return;
    sortPersistWas = on;
    if (on) { if (dgPortfolioSort) sortState = dgPortfolioSort; }
    else { sortState = DEFAULT_SORT; sessionHidden = DG_DEFAULTS.portfolioHiddenColumns; }
    schedule(true);
  });

  // ---------- DEGIRO's own sections ----------

  /** @param {Node} a @param {Node} b */
  const precedes = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  // The nearest other <h3> that follows this one in document order, or null for the last section on
  // the page — the right edge of sectionPart()'s own search below (and, with none, that search runs
  // to the end of the document).
  /** @param {Element} h3 @param {Element[]} h3s @returns {Element | null} */
  function nextH3(h3, h3s) {
    let next = /** @type {Element | null} */ (null);
    for (const h of h3s) if (h !== h3 && precedes(h3, h) && (!next || precedes(h, next))) next = h;
    return next;
  }

  // DEGIRO's real table/pager are not necessarily a CSS sibling of the section's own <h3> — on the
  // live page they sit two levels up, as siblings of the <h3>'s own (small) wrapper, not reachable by
  // any `${sel} ~ *` selector (confirmed live; see the portfolio-merge bugfix). So this locates them
  // by document order alone: every non-own element matching `inner` that falls strictly between this
  // <h3> and the next one (or the end of the document, for the last section) — covering both that
  // nested shape and the simpler flat-sibling one (h3, body, h3, body, ...) the code also still needs
  // to handle, where a section without its own pager would otherwise pick up the next section's, or a
  // later block's (like the Cash accounts).
  //
  // DEGIRO also renders a loading skeleton (an empty table, a bare pager with generic, unnamed
  // buttons) that can sit ahead of a *later* section's own heading, inside that later section's own
  // wrapper — which lands inside the *current* section's window, alongside its real table/pager, once
  // that later heading becomes this window's right edge. `isReal` prefers genuine content over such a
  // skeleton; where nothing qualifies (still loading, or a genuinely empty section) the first
  // candidate in the window is used, same as before.
  /** @param {Element} h3 @param {Element[]} h3s @param {string} inner @param {(el: Element) => boolean} isReal
   *  @returns {Element | null} */
  function sectionPart(h3, h3s, inner, isReal) {
    const next = nextH3(h3, h3s);
    const candidates = [...document.querySelectorAll(inner)].filter(el =>
      !el.closest('[data-dg-own]') && precedes(h3, el) && (!next || precedes(el, next)));
    return candidates.find(isReal) || candidates[0] || null;
  }

  // A table with actual holdings rows, as opposed to DEGIRO's own loading skeleton (a <table> with a
  // header row but an empty <tbody>).
  /** @param {Element} el @returns {boolean} */
  const isRealTable = el => !!el.querySelector('tbody tr');

  // A pagination control with DEGIRO's own named Previous/current-page/Next buttons, as opposed to
  // its loading skeleton (a bare [data-name=pagination] with generic, unnamed buttons).
  /** @param {Element} el @returns {boolean} */
  const isRealPager = el => !!el.querySelector('button[data-name=prevPageButton], button[data-name=pageButton], button[data-name=nextPageButton]');

  // Every section present right now, in DEGIRO's own order. Reads fresh every call: DEGIRO may have
  // re-rendered a table or pager since the last one.
  /** @returns {Section[]} */
  function sections() {
    const h3s = [...document.querySelectorAll('h3')];
    /** @type {Section[]} */
    const out = [];
    for (const type of TYPE_ORDER) {
      const h3 = document.querySelector(SEL.portfolioSection[type]);
      if (h3) out.push({
        type, h3,
        table: sectionPart(h3, h3s, 'table', isRealTable),
        pager: sectionPart(h3, h3s, '[data-name=pagination]', isRealPager)
      });
    }
    return out;
  }

  // Hides each section's own heading, table and pager (never removes them: their own pagination etc.
  // must keep working underneath) by marking exactly those elements — never a blanket "everything
  // after this heading" rule, which with flat siblings would also hide whatever follows the last
  // section. One owned style; the marks are re-applied every run, as DEGIRO may re-render an element.
  /** @param {Section[]} secs */
  function hideNative(secs) {
    if (!document.getElementById('dg-portfolio-hide-native')) {
      const style = /** @type {HTMLStyleElement} */ (own(document.createElement('style')));
      style.id = 'dg-portfolio-hide-native';
      style.textContent = `[${HIDDEN}] { display: none !important; }`;
      document.head.append(style);
    }
    secs.forEach(s => [s.h3, s.table, s.pager].forEach(el => { if (el && !el.hasAttribute(HIDDEN)) el.setAttribute(HIDDEN, ''); }));
  }

  // Every current <tr> of each section's own table, tagged with which section it came from and a
  // reference to that <tr>. Never mutates what it reads.
  /** @param {Section[]} secs @returns {Row[]} */
  function collectRows(secs) {
    /** @type {Row[]} */
    const rows = [];
    for (const { type, h3, table: nativeTable } of secs) {
      if (!nativeTable) continue;
      const typeLabel = h3.textContent.trim(); // DEGIRO's own section heading: already localised
      nativeTable.querySelectorAll('tbody tr').forEach(tr => {
        const product = tr.querySelector(SEL.portfolioProduct);
        if (!product) return;
        /** @type {Record<string, string>} */
        const cells = { product: product.textContent.trim(), type: typeLabel };
        Object.keys(PORTFOLIO_HOOKS).forEach(key => {
          cells[key] = tr.querySelector(PORTFOLIO_HOOKS[key])?.textContent.trim() || '';
        });
        rows.push({ id: product.getAttribute('data-id') || '', type, cells, nativeRow: tr });
      });
    }
    return rows;
  }

  // ---------- looking like DEGIRO ----------
  // The content script runs on DEGIRO's own page, so a class copied from a native element picks up
  // DEGIRO's own styling. Header labels come from the native <th>s too, so they follow DEGIRO's language.

  /** @typedef {{ table: string, head: Record<string, Element | undefined>, cell: Record<string, Element | undefined>,
   *   repHead: string, repCell: string }} NativeLook */
  /** @param {Section[]} secs @returns {NativeLook} */
  function nativeLook(secs) {
    const found = secs.flatMap(s => {
      const f = s.table && dgUi.columnHooks(s.table, 'table', LOOK_HOOKS);
      return f && s.table ? [{ f, cells: [...(s.table.querySelector('tbody tr')?.children || [])], cls: s.table.className }] : [];
    });
    /** @type {NativeLook} */
    const look = { table: found.find(x => x.cls)?.cls || '', head: {}, cell: {}, repHead: '', repCell: '' };
    for (const k of Object.keys(LOOK_HOOKS)) {
      const x = found.find(x => x.f.index[k] >= 0);
      if (!x) continue;
      look.head[k] = x.f.heads[x.f.index[k]];
      look.cell[k] = x.cells[x.f.index[k]];
    }
    const first = (/** @type {(Element | undefined)[]} */ els) => els.find(el => el?.className)?.className || '';
    look.repHead = first(Object.values(look.head));
    look.repCell = first(Object.values(look.cell));
    return look;
  }

  // Theme-based inline styles, used only for an element no native class was found for (e.g. a native
  // table briefly absent) — the same dgUi.theme() colours Orders/Transactions' own panels use.
  /** @param {ReturnType<typeof dgUi.theme>} th */
  const fallbackCss = th => ({
    table: 'width:100%;border-collapse:collapse;font-family:inherit;',
    head: `text-align:left;padding:8px;font-weight:500;font-size:12px;color:${th.muted};border-bottom:1px solid ${th.line};white-space:nowrap;`,
    cell: `padding:8px;color:${th.text};border-bottom:1px solid ${th.line};white-space:nowrap;`,
    pager: 'display:flex;gap:8px;align-items:center;margin:4px 0 8px;padding:0 16px;font-family:inherit;',
    pageButton: `font:inherit;min-width:28px;height:28px;border-radius:300px;cursor:pointer;background:transparent;color:${th.text};border:1px solid ${th.line};`
  });

  /** @type {WeakMap<HTMLElement, string>} */
  const lookKey = new WeakMap();
  // Gives one of our elements a native class, or the fallback inline style when there is none, plus
  // any `extra` inline style. Writes only on a change.
  /** @param {HTMLElement} el @param {string} cls @param {string} fallback @param {string} [extra] */
  function setLook(el, cls, fallback, extra = '') {
    const css = (cls ? '' : fallback) + extra;
    if (lookKey.get(el) === cls + '\n' + css) return;
    lookKey.set(el, cls + '\n' + css);
    el.className = cls;
    el.style.cssText = css;
  }

  // ---------- the merged table ----------

  // The header row is built once: every column (hideable or not) gets a <th>, plus one trailing blank
  // <th> for the Buy/Sell actions column (matching DEGIRO's own trailing blank header on its native
  // tables) — dgUi.columnsSetting()'s columnHooks() needs the <thead>/<tbody> column counts to match,
  // so hiding a column is done with CSS (dgUi.columnsSetting's own `apply`, called from renderToolbar
  // below), never by leaving it out of the DOM. Each <th> carries data-dg-col so the click listener
  // and syncSortAttrs below can find it again without depending on column order. Labels and classes
  // follow the native headers on every render (cheap: written only on a change).
  /** @param {HTMLTableElement} tbl @param {NativeLook} look @param {ReturnType<typeof fallbackCss>} css */
  function renderHead(tbl, look, css) {
    const thead = /** @type {Element} */ (tbl.querySelector('thead'));
    if (!thead.querySelector('tr')) {
      const tr = document.createElement('tr');
      COLUMN_ORDER.forEach(k => {
        const th = document.createElement('th');
        th.setAttribute('data-dg-col', k);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.cssText = 'font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;text-align:inherit;';
        th.append(btn);
        tr.append(th);
      });
      tr.append(document.createElement('th')); // Buy/Sell column: no header label
      thead.replaceChildren(tr);
    }
    const ths = /** @type {HTMLElement[]} */ ([.../** @type {Element} */ (thead.querySelector('tr')).children]);
    COLUMN_ORDER.forEach((k, i) => {
      const label = look.head[k]?.textContent.trim() || OWN_LABEL[k]?.() || COLUMN_LABEL[k];
      const btn = /** @type {HTMLElement} */ (ths[i].firstElementChild);
      if (btn.textContent !== label) btn.textContent = label;
      setLook(ths[i], look.head[k]?.className || look.repHead, css.head);
    });
    setLook(ths[COLUMN_ORDER.length], look.head.actions?.className || look.repHead, css.head);
    syncSortAttrs(tbl);
  }

  // aria-sort reflects the in-memory sortState on every render (cheap attribute writes the scheduler
  // never observes: attributeFilter only watches data-dg-tweaks/data-dg-alarm-lines).
  /** @param {HTMLTableElement} tbl */
  function syncSortAttrs(tbl) {
    tbl.querySelectorAll('thead th[data-dg-col]').forEach(th => {
      const want = th.getAttribute('data-dg-col') === sortState.col ? sortState.dir : 'none';
      if (th.getAttribute('aria-sort') !== want) th.setAttribute('aria-sort', want);
    });
  }

  // Sorts a copy of rows by sortState.col: numeric columns parse both "1.234,56" and "1,234.56"
  // (parseNum from common.js already handles either), Type by DEGIRO's own section order (not its
  // localised label), everything else compares as text. A blank or non-numeric cell (e.g. a value
  // not yet ticked in) always sorts last, in both directions — not just "last when ascending" (which
  // would make it jump to the top on a direction toggle). Array.prototype.sort is stable, so rows of
  // one section keep DEGIRO's own order under the default Type sort.
  /** @param {Row[]} rows @param {SortState} state @returns {Row[]} */
  function applySort(rows, state) {
    const numeric = NUMERIC_COLUMNS.has(state.col);
    const sign = state.dir === 'ascending' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (state.col === 'type') return sign * (TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
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
  // changes to it never trigger another scheduler run).
  function portfolioTable() {
    if (!table) {
      table = /** @type {HTMLTableElement} */ (own(document.createElement('table')));
      table.setAttribute('data-dg-portfolio-table', '');
      table.append(document.createElement('thead'), document.createElement('tbody'));
    }
    return table;
  }

  // The merged rows, kept across renders: keyed by the product's data-id (plus a counter, so a row
  // without one, or a repeated one, still gets its own key).
  /** @typedef {{ tr: HTMLTableRowElement, id: string, native: Element, actions: string | null }} RowEl */
  /** @type {Map<string, RowEl>} */
  const rowEls = new Map();

  // A merged row's DEGIRO Buy/Sell button, looked up at click time — the merged <tr> outlives many
  // renders, and DEGIRO may have re-rendered its own row (and button) since. Only searched in the
  // sections' own tables: a productName with the same data-id may appear elsewhere on the page.
  /** @param {RowEl} e @param {string} action @returns {HTMLElement | null} */
  function nativeButton(e, action) {
    let tr = /** @type {Element | null} */ (null);
    if (e.id) {
      for (const s of sections()) {
        tr = s.table?.querySelector(`${SEL.portfolioProduct}[data-id="${CSS.escape(e.id)}"]`)?.closest('tr') || null;
        if (tr) break;
      }
    } else if (e.native.isConnected) tr = e.native;
    return tr?.querySelector(`button[data-action=${action}]`) || null;
  }

  // Buy/Sell: a copy of DEGIRO's own button (class, icon markup, data-action — cloneNode copies no
  // listeners) that forwards a click to the real, already-rendered DEGIRO button for this row — never
  // creates or dispatches a new order action itself (extension-security.md: never place, change, or
  // cancel orders). Re-copied only when DEGIRO's own buttons change, so a click in progress (mousedown
  // then mouseup) is never lost to a re-render.
  /** @param {RowEl} e @param {Row} row */
  function syncActions(e, row) {
    const natives = ['buy', 'sell'].flatMap(a => row.nativeRow.querySelector(`button[data-action=${a}]`) || []);
    const key = natives.map(b => b.outerHTML).join('');
    if (key === e.actions) return;
    e.actions = key;
    /** @type {Element} */ (e.tr.lastElementChild).replaceChildren(...natives.map(nb => {
      const btn = /** @type {HTMLElement} */ (nb.cloneNode(true));
      btn.removeAttribute('id');
      const action = nb.getAttribute('data-action') || '';
      btn.addEventListener('click', () => { nativeButton(e, action)?.click(); });
      return btn;
    }));
  }

  /** @returns {HTMLTableRowElement} */
  function buildRow() {
    const tr = document.createElement('tr');
    COLUMN_ORDER.forEach(k => {
      const td = document.createElement('td');
      if (k === 'product') td.setAttribute('data-name', 'productName');
      else if (k !== 'type') {
        const attr = hookAttr(PORTFOLIO_HOOKS[k]);
        if (attr) td.setAttribute(attr[0], attr[1]);
      }
      tr.append(td);
    });
    tr.append(document.createElement('td')); // Buy/Sell
    return tr;
  }

  // Updates the merged <tbody> in place from collectRows()'s output, every run() tick (DEGIRO's own
  // live price updates included): rows are reused, a cell is written only when its text changed, and
  // a row is moved only when the sorted order changed — so a click, keyboard focus or a text
  // selection in the table survives DEGIRO's ticks. Each row's Type cell carries data-dg-type; every
  // other cell carries the same data-field/data-name hook its value came from.
  /** @param {Row[]} rows @param {NativeLook} look @param {ReturnType<typeof fallbackCss>} css */
  function renderRows(rows, look, css) {
    const tbody = /** @type {Element} */ (portfolioTable().querySelector('tbody'));
    /** @type {Map<string, number>} */
    const seen = new Map();
    /** @type {Set<string>} */
    const keep = new Set();
    const order = applySort(rows, sortState).map(row => {
      const base = row.id || row.type;
      const n = seen.get(base) || 0;
      seen.set(base, n + 1);
      const key = `${base}#${n}`;
      keep.add(key);
      let e = rowEls.get(key);
      if (!e) { e = { tr: buildRow(), id: row.id, native: row.nativeRow, actions: null }; rowEls.set(key, e); }
      e.native = row.nativeRow;
      const tds = /** @type {HTMLElement[]} */ ([...e.tr.children]);
      COLUMN_ORDER.forEach((k, i) => {
        const v = row.cells[k] || '';
        if (tds[i].textContent !== v) tds[i].textContent = v;
        setLook(tds[i], look.cell[k]?.className || look.repCell, css.cell);
      });
      if (tds[1].getAttribute('data-dg-type') !== row.type) tds[1].setAttribute('data-dg-type', row.type);
      setLook(tds[COLUMN_ORDER.length], look.cell.actions?.className || look.repCell, css.cell);
      syncActions(e, row);
      return e.tr;
    });
    for (const [key, e] of rowEls) if (!keep.has(key)) { e.tr.remove(); rowEls.delete(key); }
    order.forEach((tr, i) => { const at = tbody.children[i]; if (at !== tr) tbody.insertBefore(tr, at || null); });
  }

  // One full merged-table render: header (labels, classes, aria-sort) and rows, from fresh sections.
  // `rows` defaults to a fresh collectRows(secs), but run() below passes its own already-collected
  // rows through so a single tick never walks every native <tr> twice.
  /** @param {Section[]} [secs] @param {Row[]} [rows] */
  function render(secs = sections(), rows = collectRows(secs)) {
    const tbl = portfolioTable();
    const look = nativeLook(secs);
    const css = fallbackCss(dgUi.theme());
    setLook(tbl, look.table, css.table);
    renderHead(tbl, look, css);
    renderRows(rows, look, css);
    return { look, css };
  }

  // ---------- Columns ----------

  // "Columns ▾" dropdown: dgUi.columnsSetting() + dgUi.picker, the exact pair Orders/Transactions use.
  // Product and Type are never offered: DG_PORTFOLIO_COLUMNS already excludes both. The offered labels
  // are the merged table's own headers, which mirror DEGIRO's localised ones (renderHead).
  const portfolioColumns = dgUi.columnsSetting({
    key: 'portfolioHiddenColumns', keys: DG_PORTFOLIO_COLUMNS, hooks: PORTFOLIO_HOOKS,
    styleId: 'dg-portfolio-columns', scope: '[data-dg-portfolio-table]'
  });

  // Gated by portfolioMergedPersist the same way sortState is above: on, the stored choice
  // (dgSettings.portfolioHiddenColumns, which flags.js keeps populated from chrome.storage.sync
  // regardless of this toggle) is read and written; off, the session-only sessionHidden is used
  // instead, starting at DG_DEFAULTS.portfolioHiddenColumns — the picker still works, but nothing is
  // read from or written to storage (the stored value is ignored, never deleted).
  const hiddenColumns = () => dgSettings.portfolioMergedPersist ? portfolioColumns.hidden() : sessionHidden;
  /** @param {string[]} keys */
  const saveColumns = keys => {
    sessionHidden = DG_PORTFOLIO_COLUMNS.filter(k => keys.includes(k));
    if (dgSettings.portfolioMergedPersist) portfolioColumns.save(keys); // also updates dgSettings in memory
  };

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

  // ---------- pagination ----------
  // Merged pagination forwards a click to every section's own already-rendered native Previous/Next
  // button — never recreates DEGIRO's own pagination logic or fetches another page itself. A section
  // whose own button is already disabled receives no click, so a section on its last page never
  // loses or duplicates rows.

  // A section's own Previous/Next button, by position in its pager (Previous, the current page
  // number, Next): the aria-labels are localised, so matching their text would fail on a
  // non-English account and leave the merged pager disabled for good.
  /** @param {Section} s @param {'next' | 'prev'} dir @returns {HTMLButtonElement | null} */
  function nativePageButton(s, dir) {
    const btns = s.pager?.querySelectorAll('button');
    if (!btns || btns.length < 2) return null;
    return dir === 'prev' ? btns[0] : btns[btns.length - 1];
  }

  // Whether a section's own native Previous/Next button can still be clicked — checked the same way
  // orders-table.js's morePages() does (plain `disabled` is the fixture's own mechanism; aria-disabled
  // is a defensive extra for the real page).
  /** @param {HTMLButtonElement | null} btn @returns {boolean} */
  const canClick = btn => !!btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';

  /** @param {Section[]} secs @param {'next' | 'prev'} dir @returns {boolean} */
  const anySectionCanAdvance = (secs, dir) => secs.some(s => canClick(nativePageButton(s, dir)));

  // Clicks every section's own enabled native button in that direction, then re-renders once. Never
  // blocks waiting for DEGIRO's re-render to settle: the fixture's own re-render is synchronous, and
  // the scheduler's mutation-driven reruns pick up any further (real, asynchronous) DOM changes on
  // their own, the same way live price ticks do.
  /** @param {'next' | 'prev'} dir */
  function advancePage(dir) {
    sections().forEach(s => {
      const btn = nativePageButton(s, dir);
      if (canClick(btn)) /** @type {HTMLButtonElement} */ (btn).click();
    });
    const secs = sections();
    const { css } = render(secs);
    renderPagination(secs, css);
  }

  /** @type {HTMLElement | null} */
  let pager = null; // merged Previous/Next control; a sibling after the merged table, like
  // columnsToolbar()'s own bar is a sibling before it — a <div> is not valid direct <table> content.

  // Builds the merged pager once (own()-marked, like columnsToolbar()) with its own Previous/Next
  // buttons (data-dg-page = prev/next, localised aria-labels).
  function paginationBar() {
    if (!pager) {
      pager = /** @type {HTMLElement} */ (own(document.createElement('div')));
      pager.setAttribute('data-name', 'pagination');
      /** @type {['prev' | 'next', string, string][]} */
      const buttons = [['prev', t('portfolioPrevPage'), '‹'], ['next', t('portfolioNextPage'), '›']];
      buttons.forEach(([dir, label, glyph]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-dg-page', dir);
        btn.setAttribute('aria-label', label);
        btn.textContent = glyph;
        btn.addEventListener('click', () => advancePage(dir));
        /** @type {HTMLElement} */ (pager).append(btn);
      });
    }
    return pager;
  }

  // Disables the merged Previous/Next button only once every section's own button in that direction
  // is disabled (lockstep): while any section still has a page to go that way, the merged button
  // stays enabled. With both disabled (every section on its only page) the pager is hidden.
  /** @param {Section[]} secs @param {ReturnType<typeof fallbackCss>} css */
  function renderPagination(secs, css) {
    const bar = paginationBar();
    const native = secs.find(s => s.pager)?.pager;
    const nativeBtn = secs.map(s => nativePageButton(s, 'next')).find(b => b?.className);
    const prev = !anySectionCanAdvance(secs, 'prev'), next = !anySectionCanAdvance(secs, 'next');
    setLook(bar, native?.className || '', css.pager, prev && next ? 'display:none !important;' : '');
    /** @type {[string, boolean][]} */
    const states = [['prev', prev], ['next', next]];
    states.forEach(([dir, disabled]) => {
      const btn = /** @type {HTMLButtonElement} */ (bar.querySelector(`[data-dg-page=${dir}]`));
      if (btn.disabled !== disabled) btn.disabled = disabled;
      setLook(btn, nativeBtn?.className || '', css.pageButton);
    });
  }

  // ---------- events ----------

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
    if (!dgSettings.portfolioMergedTable || !table) return;
    const btn = /** @type {Element} */ (e.target).closest?.('[data-dg-portfolio-table] thead button');
    if (!btn) return;
    const col = btn.closest('th')?.getAttribute('data-dg-col');
    if (!col) return;
    saveSort(col, sortState.col === col && sortState.dir === 'ascending' ? 'descending' : 'ascending');
    render();
  }, true);

  function run() {
    // The first section heading on the page, whichever it is (an ETF-only portfolio may have no
    // Shares section at all): the merged elements go right before it. 'missing' only on the
    // Portfolio page itself (DEGIRO may still be loading, or has changed its page); everywhere else
    // there is simply nothing to do.
    const anchor = document.querySelector(Object.values(SEL.portfolioSection).join(', '));
    if (!anchor) return page.isPortfolio() ? 'missing' : 'idle';
    const secs = sections();
    const rows = collectRows(secs);
    // A section's own heading/table/pager may only be hidden once it has actually contributed a row
    // to the merge, or when its native <tbody> genuinely has none (nothing lost by hiding it). A
    // section whose table has <tr>s but none were collectible (e.g. SEL.portfolioProduct stops
    // matching after a future DEGIRO DOM change) must keep its native UI visible instead — hiding it
    // here, with the merged table showing zero rows for it, would make those real holdings disappear
    // silently. Reported as 'missing' below so the scheduler/status surface the degraded run too.
    const broken = secs.filter(s => {
      const nativeCount = s.table ? s.table.querySelectorAll('tbody tr').length : 0;
      return nativeCount > 0 && !rows.some(r => r.type === s.type);
    });
    hideNative(secs.filter(s => !broken.includes(s)));
    const merged = portfolioTable();
    const bar = columnsToolbar();
    const pag = paginationBar();
    if (bar.nextElementSibling !== merged || merged.nextElementSibling !== pag || anchor.previousElementSibling !== pag) {
      anchor.before(bar, merged, pag);
    }
    const { css } = render(secs, rows);
    renderToolbar();
    renderPagination(secs, css);
    return broken.length ? 'missing' : 'ok';
  }

  function stop() {
    document.getElementById('dg-portfolio-hide-native')?.remove();
    document.querySelectorAll(`[${HIDDEN}]`).forEach(el => el.removeAttribute(HIDDEN));
    table?.remove();
    table = null;
    rowEls.clear();
    toolbar?.remove();
    toolbar = null;
    openColumns = false;
    portfolioColumns.apply(null, []);
    pager?.remove();
    pager = null;
  }

  feature({ name: 'portfolioTable', enabled: () => !!dgSettings.portfolioMergedTable, run, stop });
})();
