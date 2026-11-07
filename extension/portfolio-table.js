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
    symbolIsin: '[data-name=symbolIsin]',
    exchange: '[data-name=exchangeAbbr]',
    qty: '[data-field=size]',
    price: '[data-field=price]',
    currency: '[data-field=currency]',
    value: '[data-field=value]',
    bep: '[data-field=breakEvenPrice]',
    plEuro: '[data-field=todayPl]',
    plPercent: '[data-field=change]',
    unrealisedPl: '[data-field=unrealizedRelativePl]',
    totalPl: '[data-field=totalPl]',
    last: '[data-field=lastUpdate]',
    delay: '[data-name=feedQuality]'
  };
  // unrealisedPl's native <td> holds the percentage above (its PORTFOLIO_HOOKS entry, used — like
  // every other hook — for the header, Columns lookup and sign-coloring span) PLUS a separate
  // sibling span for the euro amount, in its own short class (confirmed live: two independently
  // sign-colored spans, space-separated, e.g. "-7.706,38 (-58,93%)"). collectRows() reads this one
  // selector in addition to PORTFOLIO_HOOKS.unrealisedPl to build that combined value; it is the one
  // column needing a second source element, so it is kept out of PORTFOLIO_HOOKS/LOOK_HOOKS rather
  // than changing that map's single-selector-per-field shape.
  const UNREALISED_PL_AMOUNT_SEL = '[data-field=unrealizedPl]';
  // Every native column the merged table mirrors a header label or a class from: the hideable ones
  // above, plus Product (whose cell also holds the row's Buy/Sell buttons, as DEGIRO's own does).
  const LOOK_HOOKS = { ...PORTFOLIO_HOOKS, product: SEL.portfolioProduct };

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
  // DEGIRO colors each of these per ROW, by that row's own value's sign (red for a loss, green for a
  // gain, confirmed live) via its own short class on its native element — never a property of the
  // column as a whole. nativeLook()'s column-sampled look.cell[k] (one representative native <tr>'s
  // class, copied onto every row in that column) can never reproduce that, so renderRows()/buildRow()
  // give each of these four its own inner <span>, looked up per row (row.nativeRow), instead of
  // relying on the column-wide sample the way every other hideable column still does.
  const SIGN_COLUMNS = new Set(['plEuro', 'plPercent', 'unrealisedPl', 'totalPl']);
  // DEGIRO also draws a small coloured dot before each row's own Delay value, via a ::before
  // pseudo-element on the native feedQuality button whose colour is set entirely by a per-VALUE
  // modifier class (confirmed live: 15-min-delayed orange rgb(242,136,44), real-time green
  // rgb(30,131,2), end-of-day blue rgb(0,121,168)) — never a property of the column as a whole
  // (a real-time and a delayed holding can sit in the same column), so it needs the very same
  // per-row native-class copy as SIGN_COLUMNS, not nativeLook()'s single column-sampled class. It
  // has no numeric sign, so it shares SIGN_COLUMNS' per-row <span>/class-copy treatment below
  // without sharing its sign-based fallback colour (see renderRows()).
  const PER_ROW_LOOK_COLUMNS = new Set([...SIGN_COLUMNS, 'delay']);
  // unrealisedPl's cell combines two numbers ("-7.706,38 (-58,93%)"); parseNum on the whole string
  // would mangle it (two '-'s, two separators). Both numbers always agree in sign (confirmed live),
  // so sorting and the sign-based fallback color in SIGN_COLUMNS both use the amount alone — the
  // leading, space-separated token — rather than the combined text. Every other numeric column's
  // cell is already a single number, so this is a no-op for them.
  /** @param {string} col @param {string} v @returns {string} */
  const numericValue = (col, v) => col === 'unrealisedPl' ? v.split(' ')[0] : v;
  /** @type {Row['type'][]} */
  const TYPE_ORDER = ['stock', 'etf', 'lox']; // Shares, Trackers (ETFs), Structured products
  const HIDDEN = 'data-dg-portfolio-hidden'; // marks DEGIRO's own section headings, tables and pagers we hide

  // The Type column's coloured chip per section: a short label (DEGIRO's own section headings, e.g.
  // "Trackers (ETFs)", are too long for a column) and the approved mockup's pastel colours in the
  // light theme; in the dark one, a translucent tint of the same hue with a lighter text, the way
  // dgUi.pill() keeps its colours readable on both. Display only: sorting stays on TYPE_ORDER.
  /** @type {Record<Row['type'], { label: string, light: [string, string], dark: [string, string] }>} */
  const TYPE_CHIP = {
    stock: { label: 'portfolioTypeShare', light: ['#eef2ff', '#4338ca'], dark: ['rgba(99,102,241,.22)', '#a5b4fc'] },
    etf: { label: 'portfolioTypeTracker', light: ['#ecfdf5', '#047857'], dark: ['rgba(16,185,129,.2)', '#6ee7b7'] },
    lox: { label: 'portfolioTypeStruct', light: ['#fff7ed', '#c2410c'], dark: ['rgba(249,115,22,.2)', '#fdba74'] }
  };

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

  // Climbs from a section's own <h3> to the outer block whose parent also contains its real table
  // and pager (when either exists yet): on the live page that <h3> sits inside its own small
  // title-row wrapper div, a sibling of the real table/pager rather than their container (confirmed
  // live; see the portfolio-merge bugfix) — inserting relative to the bare <h3> itself then lands
  // the merged toolbar/table/pager inside that cramped wrapper instead of before the whole section.
  // Stays at the <h3> itself when its own parent already contains the table/pager (the simpler
  // flat-sibling shape, nothing to climb) or when neither exists yet (the section is still loading).
  /** @param {Section} s @returns {Element} */
  function sectionAnchor(s) {
    const refs = [s.table, s.pager].flatMap(el => el ? [el] : []);
    let block = s.h3;
    while (refs.length && block.parentElement && !refs.every(r => /** @type {Element} */ (block.parentElement).contains(r))) {
      block = block.parentElement;
    }
    return block;
  }

  // The outermost block that holds nothing visible but this one section: climbs from sectionAnchor()
  // while the parent still contains no other <h3> (another section, or the Cash accounts), none of
  // our own elements (the merged toolbar/table/pager sit inside the first section's block), and no
  // child with any text that isn't this section's own heading, table or pager — only empty shells
  // such as a divider <hr>, a spacer or a loading skeleton. Hiding just the h3/table/pager inside it
  // would leave those shells as empty bands below the merged table. In the flat-sibling shape the
  // parent holds every section, so this stays at the anchor itself.
  /** @param {Section} s @returns {Element} */
  function sectionShell(s) {
    let block = sectionAnchor(s);
    for (let p = block.parentElement; p && p !== document.body; block = p, p = p.parentElement) {
      if (p.querySelector('[data-dg-own]') || [...p.querySelectorAll('h3')].some(h => h !== s.h3)) break;
      const b = block;
      const ownPart = (/** @type {Element} */ c) => c === b || [s.table, s.pager].some(x => x && c.contains(x));
      if (![...p.children].every(c => ownPart(c) || !c.textContent.trim())) break;
    }
    return block;
  }

  // Hides each section's own heading, table and pager (never removes them: their own pagination etc.
  // must keep working underneath) by marking exactly those elements, plus the section's own empty
  // shell (sectionShell) — never a blanket "everything after this heading" rule, which with flat
  // siblings would also hide whatever follows the last section. The marks are re-applied every run,
  // as DEGIRO may re-render an element; a mark on a block that now holds our own merged elements
  // (the first section changed, e.g. a sold-out Shares section) is lifted again.
  /** @param {Section[]} secs */
  function hideNative(secs) {
    ensureStyle();
    document.querySelectorAll(`[${HIDDEN}]`).forEach(el => { if (el.querySelector('[data-dg-own]')) el.removeAttribute(HIDDEN); });
    secs.forEach(s => [s.h3, s.table, s.pager, sectionShell(s)].forEach(el => { if (el && !el.hasAttribute(HIDDEN)) el.setAttribute(HIDDEN, ''); }));
  }

  // One owned style: hides the marked native elements, and draws the sort arrow after the sorted
  // header's label (blue ↑/↓, like DEGIRO's own "Product ↑") as CSS content — so it never becomes
  // part of the header's text, which the Columns picker offers as the column's label.
  function ensureStyle() {
    if (document.getElementById('dg-portfolio-style')) return;
    const style = /** @type {HTMLStyleElement} */ (own(document.createElement('style')));
    style.id = 'dg-portfolio-style';
    const arrow = 'color:' + dgUi.BLUE + ';margin-left:4px;font-weight:inherit;';
    style.textContent = `[${HIDDEN}] { display: none !important; }\n` +
      `[data-dg-portfolio-table] th[aria-sort=ascending] > button::after { content: "\\2191"; ${arrow} }\n` +
      `[data-dg-portfolio-table] th[aria-sort=descending] > button::after { content: "\\2193"; ${arrow} }`;
    document.head.append(style);
  }

  // Every current <tr> of each section's own table, tagged with which section it came from and a
  // reference to that <tr>. Never mutates what it reads.
  /** @param {Section[]} secs @returns {Row[]} */
  function collectRows(secs) {
    /** @type {Row[]} */
    const rows = [];
    for (const { type, table: nativeTable } of secs) {
      if (!nativeTable) continue;
      nativeTable.querySelectorAll('tbody tr').forEach(tr => {
        const product = tr.querySelector(SEL.portfolioProduct);
        if (!product) return;
        /** @type {Record<string, string>} */
        const cells = { product: product.textContent.trim() }; // Type is a chip by row.type (TYPE_CHIP)
        Object.keys(PORTFOLIO_HOOKS).forEach(key => {
          cells[key] = tr.querySelector(PORTFOLIO_HOOKS[key])?.textContent.trim() || '';
        });
        // combine unrealisedPl's two native spans (amount, then the percentage already read above)
        // into the one value this column displays, space-separated as on the live page.
        const unrealisedAmount = tr.querySelector(UNREALISED_PL_AMOUNT_SEL)?.textContent.trim() || '';
        if (unrealisedAmount) cells.unrealisedPl = cells.unrealisedPl ? `${unrealisedAmount} ${cells.unrealisedPl}` : unrealisedAmount;
        rows.push({ id: product.getAttribute('data-id') || '', type, cells, nativeRow: tr });
      });
    }
    return rows;
  }

  // ---------- looking like DEGIRO ----------
  // The content script runs on DEGIRO's own page, so a class copied from a native element picks up
  // DEGIRO's own styling. Header labels come from the native <th>s too, so they follow DEGIRO's language.

  // `row` is a native body <tr>'s own class (DEGIRO sizes its rows there, not only on the cells);
  // `name`/`nameWeight` are the native product-name element's class and its resolved font weight
  // (DEGIRO shows the name bold — whether from that element's own class or a wrapper's, the computed
  // weight covers both; computed styles still resolve on the hidden native table).
  /** @typedef {{ table: string, row: string, name: string, nameWeight: string, head: Record<string, Element | undefined>,
   *   cell: Record<string, Element | undefined>, repHead: string, repCell: string }} NativeLook */
  /** @param {Section[]} secs @returns {NativeLook} */
  function nativeLook(secs) {
    const found = secs.flatMap(s => {
      const f = s.table && dgUi.columnHooks(s.table, 'table', LOOK_HOOKS);
      const tr = s.table?.querySelector('tbody tr');
      return f && s.table ? [{ f, tr, cells: [...(tr?.children || [])], cls: s.table.className }] : [];
    });
    const name = found.map(x => x.tr?.querySelector(SEL.portfolioProduct)).find(Boolean);
    /** @type {NativeLook} */
    const look = {
      table: found.find(x => x.cls)?.cls || '', row: found.find(x => x.tr?.className)?.tr?.className || '',
      name: name?.className || '', nameWeight: name ? getComputedStyle(name).fontWeight : '',
      head: {}, cell: {}, repHead: '', repCell: ''
    };
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
    pageButton: `font:inherit;min-width:28px;height:28px;border-radius:300px;cursor:pointer;background:transparent;color:${th.text};border:1px solid ${th.line};`,
    pageCurrent: `display:inline-flex;align-items:center;justify-content:center;font:inherit;min-width:28px;height:28px;border-radius:300px;background:${th.text};color:${th.bg};`,
    name: 'font-weight:600;' // the mockup's (and DEGIRO's own) bold product name
  });

  // Buy/Sell sit first in the Product cell, before the name — DEGIRO's own layout (and the mockup's).
  const ACTIONS_CSS = 'display:inline-flex;gap:4px;align-items:center;vertical-align:middle;';
  // DEGIRO wraps its own product name in an <a href="#/products/<id>/overview"> (confirmed live): a
  // same-page hash route its own SPA router already handles on click, so this needs no listener,
  // history.pushState call, or network request of our own — just a real anchor with the right href
  // (never a form submit or anything order-related, so extension-security.md's "never place/change/
  // cancel orders" does not apply). nativeLook() only samples the inner name span (SEL.portfolioProduct
  // is that span, not its wrapping anchor), so there is no native class to copy here; these styles
  // keep the anchor from imposing the browser's own default link colour/underline over the name
  // span's own (copied) look.
  const PRODUCT_LINK_CSS = 'color:inherit;text-decoration:none;display:inline-flex;align-items:center;';
  // DEGIRO's own Product cell has exactly one direct child: a flex row holding Buy/Sell and the name
  // together (confirmed live). A <td> with two separate inline-level children instead (as this cell
  // had before) shares one inline-formatting-context line between them, whose minimum height is set
  // by the <td>'s own (inherited) line-height regardless of either child's actual content — so a
  // taller ambient line-height on the cell could inflate the row even once Buy/Sell's own sizing is
  // fixed (see syncActions()). A `display:flex` wrapper sizes each child independently instead, like
  // DEGIRO's own cell.
  const PRODUCT_ROW_CSS = 'display:flex;align-items:center;';

  /** @param {Row['type']} type @param {ReturnType<typeof dgUi.theme>} th */
  function chipCss(type, th) {
    const [bg, fg] = TYPE_CHIP[type][th.dark ? 'dark' : 'light'];
    return `display:inline-block;font-size:10.5px;line-height:16px;font-weight:600;padding:1px 8px;border-radius:999px;white-space:nowrap;background:${bg};color:${fg};`;
  }

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

  // The header row is built once: every column (hideable or not) gets a <th>; Buy/Sell have no column
  // of their own, they lead the Product cell (buildRow) — dgUi.columnsSetting()'s columnHooks() needs
  // the <thead>/<tbody> column counts to match, so hiding a column is done with CSS
  // (dgUi.columnsSetting's own `apply`, called from renderToolbar below), never by leaving it out of
  // the DOM. Each <th> carries data-dg-col so the click listener and syncSortAttrs below can find it
  // again without depending on column order. Labels and classes follow the native headers on every
  // render (cheap: written only on a change).
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
      thead.replaceChildren(tr);
    }
    const ths = /** @type {HTMLElement[]} */ ([.../** @type {Element} */ (thead.querySelector('tr')).children]);
    COLUMN_ORDER.forEach((k, i) => {
      const label = look.head[k]?.textContent.trim() || OWN_LABEL[k]?.() || COLUMN_LABEL[k];
      const btn = /** @type {HTMLElement} */ (ths[i].firstElementChild);
      if (btn.textContent !== label) btn.textContent = label;
      setLook(ths[i], look.head[k]?.className || look.repHead, css.head);
    });
    syncSortAttrs(tbl);
  }

  // aria-sort reflects the in-memory sortState on every render (cheap attribute writes the scheduler
  // never observes: attributeFilter only watches data-dg-tweaks/data-dg-alarm-lines). It also draws
  // the visible ↑/↓ on the sorted header (ensureStyle's ::after rule).
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
      const x = parseNum(numericValue(state.col, av)), y = parseNum(numericValue(state.col, bv));
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
  /** @param {HTMLElement} el @param {Element} nb @param {RowEl} e */
  function rewireAction(el, nb, e) {
    el.removeAttribute('id');
    const action = nb.getAttribute('data-action') || '';
    el.addEventListener('click', () => { nativeButton(e, action)?.click(); });
  }

  /** @param {RowEl} e @param {Row} row */
  function syncActions(e, row) {
    const natives = ['buy', 'sell'].flatMap(a => row.nativeRow.querySelector(`button[data-action=${a}]`) || []);
    const key = natives.map(b => b.outerHTML).join('');
    if (key === e.actions) return;
    e.actions = key;
    const box = /** @type {HTMLElement} */ (e.tr.querySelector('[data-dg-actions]'));
    box.style.marginRight = natives.length ? '8px' : '';
    // DEGIRO wraps Buy/Sell together in their own element, apart from the cell's own ambient sizing
    // (confirmed live: a <div>, its own line-height shorter than the cell's, e.g. 18px vs the cell's
    // 21px) — cloning the bare <button>s alone (as before) loses that wrapper, so the buttons fall
    // back to inheriting the row's own (taller) line-height instead, inflating the merged row past
    // DEGIRO's own height. Clone the wrapper whole, carrying its sizing along, when it holds only
    // these buttons (confirmed live shape); otherwise (a lone button, or an unfamiliar DOM shape)
    // fall back to cloning the buttons on their own, as before.
    const wrap = natives[0]?.parentElement;
    const wholeWrap = natives.length > 1 && wrap && wrap.children.length === natives.length &&
      natives.every(b => b.parentElement === wrap) ? /** @type {HTMLElement} */ (wrap.cloneNode(true)) : null;
    if (wholeWrap) {
      wholeWrap.removeAttribute('id');
      natives.forEach(nb => {
        const clone = wholeWrap.querySelector(`button[data-action=${nb.getAttribute('data-action')}]`);
        if (clone) rewireAction(/** @type {HTMLElement} */ (clone), nb, e);
      });
      box.replaceChildren(wholeWrap);
    } else {
      box.replaceChildren(...natives.map(nb => {
        const btn = /** @type {HTMLElement} */ (nb.cloneNode(true));
        rewireAction(btn, nb, e);
        return btn;
      }));
    }
  }

  // One merged <tr>. The Product cell's sole child is a flex row (PRODUCT_ROW_CSS) holding the
  // Buy/Sell buttons (span[data-dg-actions], filled by syncActions) and then the name
  // (span[data-name=productName], DEGIRO's own hook, as on its native rows), itself wrapped in an
  // <a href="#/products/<id>/overview"> as DEGIRO's own cell is, so clicking it opens that product's
  // page the same way DEGIRO's own (now-hidden) table does; the Type cell holds one chip
  // (span[data-dg-type-chip]). `id` is the row's own data-id (collectRows()), always numeric on the
  // real page; a row with none, or a non-numeric one (never seen live, only a defensive case —
  // SEL.portfolioProduct always carries a plain numeric id), keeps the bare name span, with no
  // anchor, rather than emit a garbled or unchecked `#/products/.../overview` link.
  /** @param {string} id @returns {HTMLTableRowElement} */
  function buildRow(id) {
    const tr = document.createElement('tr');
    COLUMN_ORDER.forEach(k => {
      const td = document.createElement('td');
      if (k === 'product') {
        const row = document.createElement('span');
        row.style.cssText = PRODUCT_ROW_CSS;
        const actions = document.createElement('span');
        actions.setAttribute('data-dg-actions', '');
        actions.style.cssText = ACTIONS_CSS;
        const name = document.createElement('span');
        name.setAttribute('data-name', 'productName');
        if (/^\d+$/.test(id)) {
          const link = document.createElement('a');
          link.setAttribute('href', `#/products/${id}/overview`);
          link.setAttribute('tabindex', '1'); // DEGIRO's own anchor carries this too (confirmed live)
          link.style.cssText = PRODUCT_LINK_CSS;
          link.append(name);
          row.append(actions, link);
        } else {
          row.append(actions, name);
        }
        td.append(row);
      } else if (k === 'type') {
        const chip = document.createElement('span');
        chip.setAttribute('data-dg-type-chip', '');
        td.append(chip);
      } else if (PER_ROW_LOOK_COLUMNS.has(k)) {
        // its own inner span (never the <td> itself), so renderRows() can give it this row's own
        // native class/color without touching the <td>'s column-wide cell look (border, padding)
        const span = document.createElement('span');
        const attr = hookAttr(PORTFOLIO_HOOKS[k]);
        if (attr) span.setAttribute(attr[0], attr[1]);
        td.append(span);
      } else {
        const attr = hookAttr(PORTFOLIO_HOOKS[k]);
        if (attr) td.setAttribute(attr[0], attr[1]);
      }
      tr.append(td);
    });
    return tr;
  }

  // Updates the merged <tbody> in place from collectRows()'s output, every run() tick (DEGIRO's own
  // live price updates included): rows are reused, a cell is written only when its text changed, and
  // a row is moved only when the sorted order changed — so a click, keyboard focus or a text
  // selection in the table survives DEGIRO's ticks. Each row's Type cell carries data-dg-type; every
  // other cell carries the same data-field/data-name hook its value came from.
  /** @param {Row[]} rows @param {NativeLook} look @param {ReturnType<typeof fallbackCss>} css
   *  @param {ReturnType<typeof dgUi.theme>} th */
  function renderRows(rows, look, css, th) {
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
      if (!e) { e = { tr: buildRow(row.id), id: row.id, native: row.nativeRow, actions: null }; rowEls.set(key, e); }
      e.native = row.nativeRow;
      setLook(e.tr, look.row, '');
      const tds = /** @type {HTMLElement[]} */ ([...e.tr.children]);
      COLUMN_ORDER.forEach((k, i) => {
        setLook(tds[i], look.cell[k]?.className || look.repCell, css.cell);
        if (k === 'type') return;
        const v = row.cells[k] || '';
        const target = k === 'product' ? /** @type {HTMLElement} */ (tds[i].querySelector('[data-name=productName]'))
          : PER_ROW_LOOK_COLUMNS.has(k) ? /** @type {HTMLElement} */ (tds[i].firstElementChild) : tds[i];
        if (target.textContent !== v) target.textContent = v;
        if (!PER_ROW_LOOK_COLUMNS.has(k)) return;
        // this ROW's own native element for this field, never the column-sampled look.cell[k] above
        // (per-row look, not per column) — SIGN_COLUMNS falls back to a sign-based inline color when
        // there is no native element/class to copy (e.g. a still-loading row with no native class
        // yet); delay has no such fallback — its dot comes only from a ::before on the copied native
        // class, nothing deducible from the text alone ("15"/"R"/"ED" don't imply a colour).
        const native = row.nativeRow.querySelector(PORTFOLIO_HOOKS[k]);
        let fallback = '';
        if (SIGN_COLUMNS.has(k)) {
          const sign = Math.sign(parseNum(numericValue(k, v)));
          fallback = sign < 0 ? `color:${th.sell};` : sign > 0 ? `color:${th.buy};` : '';
        }
        setLook(target, native?.className || '', fallback);
      });
      const name = /** @type {HTMLElement} */ (tds[0].querySelector('[data-name=productName]'));
      setLook(name, look.name, css.name, look.nameWeight ? `font-weight:${look.nameWeight};` : '');
      if (tds[1].getAttribute('data-dg-type') !== row.type) tds[1].setAttribute('data-dg-type', row.type);
      const chip = /** @type {HTMLElement} */ (tds[1].firstElementChild);
      const label = t(TYPE_CHIP[row.type].label);
      if (chip.textContent !== label) chip.textContent = label;
      setLook(chip, '', chipCss(row.type, th));
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
    const th = dgUi.theme();
    const css = fallbackCss(th);
    setLook(tbl, look.table, css.table);
    renderHead(tbl, look, css);
    renderRows(rows, look, css, th);
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
    // labelled "Columns", exactly as Orders/Transactions' own filter bar shows its picker
    bar.replaceChildren(...(cols.length ? [dgUi.group(t('columns'), th, columnPicker(cols, th))] : []));
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

  // Builds the merged pager once (own()-marked, like columnsToolbar()) as DEGIRO's own: Previous, the
  // current page number, Next (data-dg-page = prev/current/next, localised aria-labels).
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
      const current = document.createElement('span');
      current.setAttribute('data-dg-page', 'current');
      current.setAttribute('aria-current', 'page');
      pager.insertBefore(current, pager.lastElementChild);
    }
    return pager;
  }

  // The page number the merged pager shows: the furthest page any section is on (the sections page in
  // lockstep, so one still on page 1 just has fewer pages). Read from each section's own middle
  // (current-page) button; 1 when none shows a number.
  /** @param {Section[]} secs @returns {{ page: string, cls: string }} */
  function currentPage(secs) {
    let page = 1, cls = '';
    secs.forEach(s => {
      const btns = s.pager?.querySelectorAll('button');
      if (!btns || btns.length < 3) return;
      const mid = btns[Math.floor(btns.length / 2)];
      const n = parseInt(mid.textContent || '', 10);
      if (n > page) page = n;
      cls = cls || mid.className;
    });
    return { page: String(page), cls };
  }

  // Always shown, as DEGIRO's own pager is (and the mockup's "‹ 1 ›"), even when every section is on
  // its only page: the merged Previous/Next button is disabled, not hidden, once every section's own
  // button in that direction is disabled (lockstep) — while any section still has a page to go that
  // way, it stays enabled.
  /** @param {Section[]} secs @param {ReturnType<typeof fallbackCss>} css */
  function renderPagination(secs, css) {
    const bar = paginationBar();
    const native = secs.find(s => s.pager)?.pager;
    const nativeBtn = secs.map(s => nativePageButton(s, 'next')).find(b => b?.className);
    const prev = !anySectionCanAdvance(secs, 'prev'), next = !anySectionCanAdvance(secs, 'next');
    setLook(bar, native?.className || '', css.pager);
    /** @type {[string, boolean][]} */
    const states = [['prev', prev], ['next', next]];
    states.forEach(([dir, disabled]) => {
      const btn = /** @type {HTMLButtonElement} */ (bar.querySelector(`[data-dg-page=${dir}]`));
      if (btn.disabled !== disabled) btn.disabled = disabled;
      setLook(btn, nativeBtn?.className || '', css.pageButton);
    });
    const cur = currentPage(secs);
    const el = /** @type {HTMLElement} */ (bar.querySelector('[data-dg-page=current]'));
    if (el.textContent !== cur.page) el.textContent = cur.page;
    setLook(el, cur.cls, css.pageCurrent);
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
    // 'missing' only on the Portfolio page itself (DEGIRO may still be loading, or has changed its
    // page); everywhere else there is simply nothing to do.
    const secs = sections();
    if (!secs.length) return page.isPortfolio() ? 'missing' : 'idle';
    // The first section heading on the page, whichever it is (an ETF-only portfolio may have no
    // Shares section at all): the merged elements go right before its real outer block, found by
    // sectionAnchor() — not necessarily its bare <h3> (see that function's own comment).
    let first = secs[0];
    for (const s of secs) if (precedes(s.h3, first.h3)) first = s;
    const anchor = sectionAnchor(first);
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
    const merged = portfolioTable();
    const bar = columnsToolbar();
    const pag = paginationBar();
    if (bar.nextElementSibling !== merged || merged.nextElementSibling !== pag || anchor.previousElementSibling !== pag) {
      anchor.before(bar, merged, pag);
    }
    // only after the merged elements are in place: sectionShell() must see them, so it never hides
    // the first section's block that now holds them
    hideNative(secs.filter(s => !broken.includes(s)));
    const { css } = render(secs, rows);
    renderToolbar();
    renderPagination(secs, css);
    return broken.length ? 'missing' : 'ok';
  }

  function stop() {
    document.getElementById('dg-portfolio-style')?.remove();
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
