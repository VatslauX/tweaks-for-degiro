// Shared helpers, loaded first in both worlds — see manifest.json. Exposed as a read-only
// global `__dgt`; in Node (unit tests) it is exported instead. No chrome.* here.
// Chrome injects a file only once per page, so the isolated world loads an identical copy,
// common-isolated.js. Edit this file, then run `npm run sync-common` (a test checks they match).
(() => {
  // ---------- numbers ----------
  // Decimal separator DEGIRO uses on this page: ',' ("€ 1.234,56") or '.' ("$1,234.56").
  // Read from DEGIRO's own price fields; cached briefly because it rarely changes.
  let sepCache = null, sepAt = 0;
  function decimalSep() {
    if (typeof document === 'undefined') return ',';
    if (sepCache && Date.now() - sepAt < 10000) return sepCache;
    const els = document.querySelectorAll('[data-field$="Price"], [data-field="RelativeDifference"], [data-field="valuableColumnValue"]');
    let sep = null;
    for (const el of els) {
      const m = (el.textContent || '').match(/\d([.,])(\d+)\D*$/);
      // two decimals after the last separator: that separator is the decimal one
      if (m && m[2].length !== 3) { sep = m[1]; break; }
    }
    if (sep) { sepCache = sep; sepAt = Date.now(); }
    return sep || sepCache || ',';
  }

  // "€ 1.234,56" / "$1,234.56" / "130,995" / "1.000" -> number. `sep` defaults to the page's.
  function parseNum(text, sep = decimalSep()) {
    let s = String(text ?? '').replace(/[^\d.,-]/g, '');
    if (!/\d/.test(s)) return NaN;
    const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
    if (c > -1 && d > -1) {
      s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (c > -1) {
      // only commas: thousands if there are several, or one before 3 digits on a '.'-decimal page
      const thousands = s.indexOf(',') !== c || (sep === '.' && /^-?\d{1,3}(,\d{3})+$/.test(s));
      s = thousands ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (d > -1) {
      const thousands = s.indexOf('.') !== d || (sep === ',' && /^-?\d{1,3}(\.\d{3})+$/.test(s));
      if (thousands) s = s.replace(/\./g, '');
    }
    return parseFloat(s);
  }

  // Format like DEGIRO on this page: min..max decimals, grouped thousands.
  function fmt(n, min = 2, max = min, sep = decimalSep()) {
    return n.toLocaleString(sep === '.' ? 'en-US' : 'nl-NL', { minimumFractionDigits: min, maximumFractionDigits: Math.max(min, max) });
  }

  // ---------- DEGIRO page hooks ----------
  // Everything the extension relies on in DEGIRO's page, in one place: DEGIRO's own data-field /
  // data-name hooks first, label text (several UI languages) only as a fallback.
  // When DEGIRO changes its page, start here.
  const SEL = Object.freeze({
    // product page
    bidPrice: '[data-field="BidPrice"]',
    askPrice: '[data-field="AskPrice"]',
    relativeDifference: '[data-field="RelativeDifference"]',
    exDividendDate: 'time[data-field="exDividendDate"]',
    dividendsTitle: '#dividends-widget-title',
    // the one section holding every product widget, chart included (never hide it)
    mainPageSection: '[data-name=mainPageSection]',
    // orders: bottom panel / mobile drawer, Adjust order form, Orders page table
    openOrderRow: 'tr[data-name=openOrder]',
    orderEditButton: 'button[data-name=orderEditButton]',
    panelToggle: 'button[data-name=panelToggleButton]',
    drawerToggle: 'button[data-name=totalPortfolioToggle]',
    orderDetails: '[data-name=orderDetails]',
    // portfolio: the Cash compensation section (its title is localised)
    cashCompensation: '[data-name=cashFundCompensations]',
    appLayout: '[data-name=app-layout]',
    orderLimit: '[data-field="limitColumnValue"]',
    orderStop: '[data-field="stopPriceColumnValue"]',
    orderValue: '[data-field="valuableColumnValue"]',
    orderProduct: '[data-name="productName"]',
    orderQuantity: '[data-field="quantity"]',
    orderPrice: '[data-field="price"]',
    buySellBadge: '[data-name=buySellBadge]', // data-action="BUY" | "SELL"; its text is localised
    // portfolio chart
    perfChart: '[data-name="performance-chart"]',
    perfValue: '[data-name="performance-chart-value"]',
    perfAmount: '[data-name="performance-chart-amount"]',
    perfArea: '[data-name="performance-chart-interaction-area"]'
  });
  const LABELS = Object.freeze({
    bid: /^(bid|bied|geld|achat|compra|denaro)$/i,
    ask: /^(ask|laat|brief|vente|venta|lettera)$/i,
    buy: /^(buy|koop|kopen|kauf|kaufen|achat|acheter|compra|comprar|acquisto)$/i,
    sell: /^(sell|verkoop|verkopen|verkauf|verkaufen|vente|vendre|venta|vender|vendita)$/i,
    // one-letter side in the Outstanding panel: B/S, nl/de K/V, fr/it A/V, es/pt C/V
    buyShort: /^[BKAC]$/,
    sellShort: /^[SV]$/,
    actionColumn: /^(action|actie|aktion|acción|azione)$/i,
    // close-the-form Cancel only. Never add es/pt "Anular": there it means cancelling an order
    cancel: /^(cancel|annuleren|abbrechen|annuler|cancelar|annulla|anuluj)$/i,
    // Adjust order form title (DEGIRO's own wording per language)
    adjustOrder: /adjust order|order aanpassen|order wijzigen|order anpassen|order ändern|modifier un ordre|modifier l'ordre|ajustar orden|modifica ordine|adaptar a ordem/i,
    panelCollapsed: /expand|uitklap|vergroten|mehr anzeigen|etendre|étendre|espandi|maxim/i,
    dividends: /^(dividends|dividenden)$/i,
    period: /^(YTD|1 ?D|1 ?W|1 ?M|3 ?M|6 ?M|1 ?Y|3 ?Y|5 ?Y|ALL)$/
  });
  // Which DEGIRO page is open (hash routes).
  const page = Object.freeze({
    productId: () => +((location.hash.match(/products\/(\d+)/) || [])[1] || 0),
    isProduct: () => /#\/products\/\d+/.test(location.hash),
    isOrders: () => /#\/orders\/open/.test(location.hash),
    isPortfolio: () => !!document.querySelector(SEL.perfChart)
  });

  // Bid / Ask rows in Pricing data. Is this <dt> the Bid / Ask label? (kind: 'Bid' | 'Ask')
  function isPriceDt(dt, kind) {
    if (!dt || dt.tagName !== 'DT') return false;
    if (dt.nextElementSibling?.querySelector?.(kind === 'Bid' ? SEL.bidPrice : SEL.askPrice)) return true;
    return (kind === 'Bid' ? LABELS.bid : LABELS.ask).test(dt.textContent.trim());
  }
  // All Bid / Ask <dt>s on the page (DEGIRO also keeps a hidden copy for measuring).
  function priceDts(kind) {
    const byField = [...document.querySelectorAll(`dd ${kind === 'Bid' ? SEL.bidPrice : SEL.askPrice}`)]
      .map(f => f.closest('dd')?.previousElementSibling)
      .filter(/** @returns {dt is Element} */ dt => dt?.tagName === 'DT');
    if (byField.length) return [...new Set(byField)];
    const re = kind === 'Bid' ? LABELS.bid : LABELS.ask;
    return [...document.querySelectorAll('dt')].filter(dt => re.test(dt.textContent.trim()));
  }

  // ---------- page ----------
  // Feature flags bridged from the extension by flags.js (null = not loaded yet).
  // Parsed only when the attribute changes: the scheduler reads it for every feature.
  let flagsRaw = null, flagsVal = null;
  function flags() {
    const raw = document.documentElement.getAttribute('data-dg-tweaks');
    if (raw !== flagsRaw) {
      flagsRaw = raw;
      try { flagsVal = raw ? JSON.parse(raw) : null; } catch (e) { flagsVal = null; }
    }
    return flagsVal;
  }

  // Colours from the page: DEGIRO has a light and a dark theme.
  function pageTheme(el) {
    let n = el, bg = null;
    while (n && n.nodeType === 1) {
      const c = getComputedStyle(n).backgroundColor, m = c.match(/[\d.]+/g);
      if (m && (m.length < 4 || +m[3] > 0.5)) { bg = c; break; }
      n = n.parentElement;
    }
    bg = bg || 'rgb(255, 255, 255)';
    const [r, g, b] = (bg.match(/\d+/g) || ['255', '255', '255']).map(Number);
    const dark = 0.299 * r + 0.587 * g + 0.114 * b < 128;
    return {
      dark, bg,
      text: getComputedStyle(document.body).color || (dark ? '#F3F7F9' : '#0F171A'),
      upText: dark ? '#4CB82E' : '#1E8302', downText: dark ? '#FF5A5F' : '#E3282B',
      shadow: dark ? '0 1px 3px rgba(0,0,0,.6),0 2px 8px rgba(0,0,0,.5)' : '0 1px 2px rgba(0,0,0,.08),0 2px 6px rgba(0,0,0,.12)',
      border: dark ? '1px solid rgba(255,255,255,.14)' : '0'
    };
  }

  // ---------- Highcharts (page world only) ----------
  // Series data: getColumn() in newer Highcharts (xData/yData are deprecated there), xData/yData in 4.x.
  const xs = s => (s?.getColumn ? s.getColumn('x', true) : null) || s?.xData || [];
  const ys = s => (s?.getColumn ? s.getColumn('y', true) : null) || s?.yData || [];
  const isPriceSeries = s => !!s?.visible && /area|line|spline|candlestick|ohlc/.test(s.type) && xs(s).length > 1;

  // DEGIRO's price chart: the largest visible chart with a price series (not mini or volume charts).
  function mainChart() {
    let best = null, bestArea = 0;
    ((typeof window !== 'undefined' && /** @type {any} */ (window).Highcharts?.charts) || []).forEach(c => {
      if (!c?.container?.isConnected || !c.series?.some(isPriceSeries)) return;
      const r = c.container.getBoundingClientRect(), area = r.width * r.height;
      if (area > bestArea) { best = c; bestArea = area; }
    });
    return best;
  }

  // The chart's main price series: the visible price series with the most points.
  const priceSeries = chart => (chart?.series || []).filter(isPriceSeries).sort((a, b) => xs(b).length - xs(a).length)[0];

  // ---------- scheduler: one observer and one timer per world ----------
  // Features register with feature({...}) instead of running their own observers and timers.
  // Every element the extension inserts carries OWN, so its own changes don't trigger new runs.
  const OWN = 'data-dg-own';
  /** @template {Element} T @param {T} el @returns {T} */
  const own = el => { el.setAttribute(OWN, ''); return el; };

  /**
   * @typedef {'ok' | 'idle' | 'missing' | 'loading' | 'off' | 'error'} Status
   *   ok: working · idle: nothing to do on this page · missing: DEGIRO elements it needs were not found
   *   (DEGIRO may have changed its page) · loading: missing, but the page only just opened · off: switched off
   * @typedef {object} Feature
   * @property {string} name        status key, e.g. 'spread'
   * @property {() => any} enabled  is it switched on?
   * @property {() => (Status | void)} run  apply to the page; must be idempotent (runs after DOM changes)
   * @property {() => void} [stop]  remove everything it added; called once when it is switched off
   * @property {number} [every]     also run at least this often (ms), for changes that aren't DOM mutations
   * @property {number} [throttle]  run at most this often (ms) on DOM changes (default DEFAULT_THROTTLE; 0 = every frame)
   */
  /** @type {(Feature & { on: boolean | null, last: number, status: Status, trailing: boolean })[]} */
  const features = [];
  const LOADING_MS = 8000; // 'missing' shows as 'loading' this long after the page (or route) opened
  const DEFAULT_THROTTLE = 150;
  let routeAt = Date.now(), queued = false, force = false, dirty = false;

  /** @param {Feature} f */
  function feature(f) {
    features.push({ ...f, on: null, last: 0, status: 'off', trailing: false });
    schedule(true);
  }

  // DOM changed (or settings did, with all = true): run the features that are not throttled
  function schedule(all = false) {
    if (all) force = true;
    dirty = true;
    requestFlush();
  }
  function requestFlush() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(flush);
  }

  function flush() {
    queued = false;
    const all = force, changed = dirty || force, now = Date.now();
    force = false; dirty = false;
    for (const f of features) {
      let on = false;
      try { on = !!f.enabled(); } catch (e) {}
      if (!on) {
        if (f.on !== false) { f.on = false; f.status = 'off'; try { f.stop?.(); } catch (e) {} }
        continue;
      }
      // a timer-only flush runs just the features whose `every` is due
      if (!changed && !(f.on && f.every && now - f.last >= f.every)) continue;
      const throttle = f.throttle ?? DEFAULT_THROTTLE;
      const wait = throttle && f.on && !all && changed ? throttle - (now - f.last) : 0;
      if (wait > 0) {
        if (!f.trailing) { f.trailing = true; setTimeout(() => { f.trailing = false; schedule(); }, wait); }
        continue;
      }
      f.on = true; f.last = now;
      // one failing feature must not stop the others
      try { f.status = f.run() || 'ok'; } catch (e) { f.status = 'error'; }
    }
    publish();
  }

  // 'missing' counts as 'loading' only while the page is new, and turns into 'missing' once that window has passed
  /** @returns {Record<string, Status>} */
  const status = () => {
    const young = Date.now() - routeAt < LOADING_MS;
    return Object.fromEntries(features.map(f => [f.name, f.status === 'missing' && young ? 'loading' : f.status]));
  };
  // The page world can't reach chrome.*: it hands its status to the isolated world (status.js)
  // through an attribute. The page can read it; it only holds feature names and the values above.
  const ext = /** @type {any} */ (globalThis).chrome;
  const pageWorld = !ext?.runtime?.id;
  let published = '';
  function publish() {
    if (!pageWorld || !features.length) return;
    const s = JSON.stringify(status());
    if (s !== published) { published = s; document.documentElement.setAttribute('data-dg-status', s); }
  }

  if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
    const ours = n => !!(n && (n.nodeType === 1 ? n : n.parentElement)?.closest?.(`[${OWN}]`));
    const onlyOurs = m => m.type === 'childList' && [...m.addedNodes, ...m.removedNodes].every(n => n.nodeType === 1 && n.hasAttribute(OWN));
    // Highcharts redraws its tooltip and crosshair on every mouse move; the isolated-world features
    // don't read the chart's SVG, so those changes must not run them
    const inChart = n => !pageWorld && !!(n && (n.nodeType === 1 ? n : n.parentElement)?.closest?.('.highcharts-container'));
    new MutationObserver(muts => {
      if (muts.some(m => m.type === 'attributes')) return schedule(true); // settings changed (data-dg-tweaks)
      if (muts.every(m => ours(m.target) || inChart(m.target) || onlyOurs(m))) return;
      schedule();
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-dg-tweaks'] });
    addEventListener('hashchange', () => { routeAt = Date.now(); schedule(true); });
    // features with `every`: one timer for all of them
    setInterval(() => {
      const now = Date.now();
      if (features.some(f => f.on && f.every && now - f.last >= f.every)) requestFlush();
      publish(); // 'loading' turns into 'missing' without a DOM change
    }, 250);
  }

  // ---------- translations (_locales/*/messages.json, in the browser's language) ----------
  // The page world has no chrome.i18n: the isolated world copies the texts it needs to data-dg-i18n.
  // The page can rewrite that attribute, so these texts are only ever set as textContent or title.
  const I18N = 'data-dg-i18n';
  const PAGE_TEXTS = ['badgeBuy', 'badgeSell', 'badgeEdit', 'badgeAria', 'badgeMerged', 'badgeNotFound', 'periodTitle', 'portfolioTitle'];
  let pageTexts = null;
  /** @param {string} key @param {...(string | number)} subs */
  function t(key, ...subs) {
    if (!pageWorld) return ext.i18n.getMessage(key, subs.map(String)) || key;
    if (!pageTexts) try { pageTexts = JSON.parse(document.documentElement.getAttribute(I18N) || 'null'); } catch (e) {}
    const m = typeof pageTexts?.[key] === 'string' ? pageTexts[key] : key;
    return m.replace(/\$(\d)/g, (_, d) => String(subs[+d - 1] ?? ''));
  }
  // '$1'…'$9' as substitutions keep the placeholders for the page world to fill in
  const KEEP = ['$1', '$2', '$3', '$4', '$5', '$6', '$7', '$8', '$9'];
  if (!pageWorld && typeof document !== 'undefined')
    document.documentElement.setAttribute(I18N, JSON.stringify(Object.fromEntries(PAGE_TEXTS.map(k => [k, ext.i18n.getMessage(k, KEEP)]))));

  const api = Object.freeze({ decimalSep, parseNum, fmt, flags, pageTheme, xs, ys, isPriceSeries, mainChart, priceSeries,
    SEL, LABELS, page, isPriceDt, priceDts, OWN, own, feature, schedule, status, t, PAGE_TEXTS });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (!(/** @type {any} */ (globalThis).__dgt)) Object.defineProperty(globalThis, '__dgt', { value: api });
})();
