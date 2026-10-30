// Price alarms: the Alarms page at #/favourites?dg=alarms (DEGIRO sends unknown routes to Portfolio
// but keeps a query on Favourites). Drawn inside DEGIRO's main area; DEGIRO's Favourites list stays
// on the page, hidden, so its prices keep updating and the alarms keep being checked.
(() => {
  const { SEL, page, OWN, own, feature, t, fmt, schedule } = __dgt; // common.js
  const R = dgAlarmRules, S = dgAlarmStore;
  const ROOT = 'data-dg-alarms-page', STYLE = 'dg-alarms-page-style';
  /** @type {{ status: string, products: Set<number>, menu: boolean }} */
  const view = { status: 'all', products: new Set(), menu: false };
  let sig = '';
  let pressing = false; // a pointer press that started inside our page is in progress

  function remove() {
    document.getElementById(STYLE)?.remove();
    document.querySelector(`[${ROOT}]`)?.remove();
    sig = '';
    view.menu = false;
    view.status = 'all'; // the filters live only while the page is open
    view.products.clear();
  }

  /** @param {any} a @param {number} n */
  const money = (a, n) => `${a.currency} ${fmt(n, 2, 4)}`.trim();
  /** @param {number} ms */
  const today = ms => R.day(ms) === R.day(Date.now());
  /** @param {number} ms */
  const when = ms => new Date(ms).toLocaleString(undefined, today(ms)
    ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  /** @param {any} a @param {any} st @param {number | undefined} price */
  function status(a, st, price) {
    if (st.firedAt && !a.on) return t('alarmStatusFiredOff', when(st.firedAt));
    if (st.firedAt && today(st.firedAt)) return t('alarmStatusFired', when(st.firedAt));
    if (price == null) return t('alarmStatusNotInList');
    return t('alarmStatusWaiting');
  }
  /** @param {any} a @param {any} st @param {number | undefined} price @returns {'waiting' | 'fired' | 'off' | 'unseen'} */
  function statusKind(a, st, price) {
    if (st.firedAt && !a.on) return 'off';
    if (st.firedAt && today(st.firedAt)) return 'fired';
    if (price == null) return 'unseen';
    return 'waiting';
  }
  /** @param {any} a */
  function shown(a) {
    const st = S.state()[a.id] || {};
    const ok = view.status === 'all' || (view.status === 'on' && a.on) || (view.status === 'off' && !a.on)
      || (view.status === 'fired' && !!st.firedAt && today(st.firedAt));
    return ok && (!view.products.size || view.products.has(a.productId));
  }

  /** @param {string} tag @param {string} css @param {string} [txt] */
  function el(tag, css, txt) {
    const e = document.createElement(tag);
    e.style.cssText = css;
    if (txt != null) e.textContent = txt;
    return e;
  }

  /** @param {ReturnType<typeof dgUi.theme>} th */
  function build(th) {
    const alarms = S.list(), state = S.state(), live = S.live();
    const out = [];
    const head = el('div', 'display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;');
    const title = el('div', '');
    title.append(el('h2', 'margin:0;font-size:18px;', t('alarmPageTitle')),
      el('div', `color:${th.muted};font-size:12.5px;`, t('alarmCount', alarms.length, alarms.filter(a => a.on).length)));
    const filters = el('div', 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:flex-end;margin-left:auto;');
    const STATUS = [['all', 'alarmFilterAll'], ['on', 'alarmFilterOn'], ['off', 'alarmFilterOff'], ['fired', 'alarmFilterFired']];
    filters.append(...STATUS.map(([k, key]) => {
      const c = dgUi.chip(t(key), view.status === k, () => { view.status = k; schedule(true); }, th);
      c.setAttribute('data-dg-alarm-filter', k);
      return c;
    }));
    /** @type {Map<number, string>} */
    const names = new Map(alarms.map(a => [a.productId, R.label(a)]));
    const items = [...names].sort((x, y) => x[1].localeCompare(y[1], undefined, { sensitivity: 'base' })).map(([id, name]) => ({
      text: `${name} (${alarms.filter(a => a.productId === id).length})`,
      checked: view.products.has(id),
      change: (/** @type {boolean} */ on) => { on ? view.products.add(id) : view.products.delete(id); }
    }));
    const n = view.products.size;
    filters.append(dgUi.picker({ kind: 'alarm-products', label: n ? t('ordersSelected', n) : t('ordersAllProducts'), active: n > 0, items, th, align: 'right',
      open: view.menu, onToggle: () => { view.menu = !view.menu; schedule(true); }, onChange: () => schedule(true) }));
    head.append(title, filters);
    out.push(head);

    if (!alarms.length) {
      const empty = el('p', `color:${th.muted};margin:16px 0 0;`, t('alarmEmpty'));
      empty.setAttribute('data-dg-alarm-empty', '');
      out.push(empty);
      return out;
    }

    const wrap = el('div', `overflow-x:auto;margin-top:12px;border:1px solid ${th.line};border-radius:8px;`);
    wrap.setAttribute('data-dg-alarm-scroll', '');
    const table = el('table', 'border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums;');
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    ['alarmColProduct', 'alarmColLatest', 'alarmColAlarm', 'alarmColDistance', 'alarmColRepeat', 'alarmColStatus', 'alarmColOn', ''].forEach(k => {
      hr.append(el('th', `text-align:${k === 'alarmColLatest' || k === 'alarmColAlarm' || k === 'alarmColDistance' ? 'right' : 'left'};font-weight:500;color:${th.muted};font-size:12px;padding:9px 12px;border-bottom:1px solid ${th.line};white-space:nowrap;`, k ? t(k) : ''));
    });
    thead.append(hr);
    const tbody = document.createElement('tbody');
    const td = (/** @type {string} */ css = '') => el('td', `padding:9px 12px;border-bottom:1px solid ${th.line};white-space:nowrap;${css}`);
    for (const a of R.sorted(alarms).filter(shown)) {
      const st = state[a.id] || {}, price = live.get(a.productId), ref = price ?? st.last;
      const tr = document.createElement('tr');
      tr.setAttribute('data-dg-alarm-id', a.id);
      if (!a.on) tr.style.color = th.muted;
      const prod = td();
      const link = document.createElement('a');
      link.href = `#/products/${a.productId}/overview`;
      link.textContent = R.label(a);
      link.style.cssText = `color:${th.text};font-weight:600;text-decoration:none;`;
      prod.append(link, el('span', `display:block;color:${th.muted};font-size:11.5px;`, a.symbol));
      const al = td(`text-align:right;color:${a.dir === 'above' ? th.buy : th.sell};`);
      al.textContent = `${a.dir === 'above' ? '↑' : '↓'} ${money(a, a.price)}`;
      const rep = td();
      rep.textContent = t(a.repeat === 'once' ? 'alarmOnce' : a.repeat === 'daily' ? 'alarmDaily' : 'alarmEach');
      const last = td('text-align:right;');
      last.textContent = ref != null ? money(a, ref) : '–';
      if (price == null && st.lastAt) last.append(el('span', `display:block;color:${th.muted};font-size:11.5px;`, t('alarmSeen', when(st.lastAt))));
      const dist = td('text-align:right;');
      if (ref) { const p = (a.price / ref - 1) * 100; dist.textContent = `${p > 0 ? '+' : ''}${fmt(p)}%`; } else dist.textContent = '–';
      const stc = td();
      stc.setAttribute('data-dg-alarm-status', '');
      stc.append(dgUi.pill(status(a, st, price), statusKind(a, st, price), th));
      const onc = td();
      const sw = dgUi.toggle({ checked: a.on, label: t('alarmOnAria', money(a, a.price)),
        onChange: on => S.setOn(a.id, on), th });
      onc.append(sw);
      const delc = td();
      const acts = el('div', 'display:flex;align-items:center;gap:8px;justify-content:flex-end;');
      const edit = /** @type {HTMLButtonElement} */ (el('button', `display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 12px;border-radius:300px;` +
        `border:1px solid ${dgUi.BLUE};background:transparent;color:${dgUi.BLUE};font:inherit;font-size:12px;font-weight:600;cursor:pointer;`));
      edit.type = 'button';
      edit.setAttribute('data-dg-alarm-edit', '');
      edit.setAttribute('aria-label', t('alarmEditAria', money(a, a.price)));
      edit.append(dgUi.icon(dgUi.PENCIL, 14), document.createTextNode(t('alarmEdit')));
      edit.addEventListener('click', () => dgAlarmPanel.edit(a));
      const del = /** @type {HTMLButtonElement} */ (el('button', `border:0;background:transparent;color:${th.muted};cursor:pointer;display:inline-flex;align-items:center;padding:4px;`));
      del.type = 'button';
      del.setAttribute('data-dg-alarm-delete', '');
      del.setAttribute('aria-label', t('alarmDelete'));
      del.append(dgUi.icon(dgUi.TRASH, 16));
      del.addEventListener('click', () => S.remove(a.id));
      acts.append(edit, del);
      delc.append(acts);
      tr.append(prod, last, al, dist, rep, stc, onc, delc);
      tbody.append(tr);
    }
    table.append(thead, tbody);
    wrap.append(table);
    out.push(wrap);
    return out;
  }

  /** A selector for the control in the page that has focus, to restore it after a rebuild.
   * @param {Element | null} root */
  function focused(root) {
    const a = document.activeElement;
    if (!root || !a || !root.contains(a)) return '';
    const row = a.closest('tr[data-dg-alarm-id]')?.getAttribute('data-dg-alarm-id');
    if (row) {
      if (a.matches('input[type=checkbox]')) return `tr[data-dg-alarm-id="${CSS.escape(row)}"] input[type=checkbox]`;
      if (a.matches('[data-dg-alarm-delete]')) return `tr[data-dg-alarm-id="${CSS.escape(row)}"] [data-dg-alarm-delete]`;
      if (a.matches('[data-dg-alarm-edit]')) return `tr[data-dg-alarm-id="${CSS.escape(row)}"] [data-dg-alarm-edit]`;
      return '';
    }
    const f = a.getAttribute('data-dg-alarm-filter');
    if (f) return `[data-dg-alarm-filter="${CSS.escape(f)}"]`;
    return a.hasAttribute('data-dg-alarm-products') ? '[data-dg-alarm-products]' : '';
  }

  function run() {
    if (!page.isAlarms()) { remove(); return 'idle'; }
    const main = document.querySelector(SEL.mainContent);
    if (!main) return 'missing';
    if (!document.getElementById(STYLE)) {
      const st = own(document.createElement('style'));
      st.id = STYLE;
      st.textContent = `${SEL.mainContent} > ${SEL.favourites} { display: none !important; }`;
      document.head.append(st);
    }
    // a product without alarms any more can't stay picked
    const ids = new Set(S.list().map(a => a.productId));
    view.products.forEach(p => { if (!ids.has(p)) view.products.delete(p); });
    const th = dgUi.theme();
    // an open menu must not be rebuilt under the cursor by a price tick
    const key = JSON.stringify([S.list(), view.menu ? [] : S.state(), view.menu ? [] : [...S.live()], view.status, [...view.products], view.menu, th.bg, th.text]);
    let root = document.querySelector(`[${ROOT}]`);
    const list = main.querySelector(`:scope > ${SEL.favourites}`);
    // where DEGIRO's Favourites list was, so its footer stays at the bottom
    const placed = !!root && root.parentElement === main && (list ? root.previousElementSibling === list : true);
    if (placed && key === sig) return 'ok';
    if (placed && pressing) return 'ok'; // don't replace a button under the pointer
    sig = key;
    const focus = focused(root);
    const scroll = root?.querySelector('[data-dg-alarm-scroll]')?.scrollLeft || 0;
    if (!root) { root = own(document.createElement('div')); root.setAttribute(ROOT, ''); }
    /** @type {HTMLElement} */ (root).style.cssText = `padding:16px 20px;color:${th.text};flex:1 0 auto;`;
    root.replaceChildren(...build(th));
    if (!placed) { if (list) list.after(root); else main.append(root); }
    const wrap = root.querySelector('[data-dg-alarm-scroll]');
    if (wrap) wrap.scrollLeft = scroll;
    if (focus) /** @type {HTMLElement | null} */ (root.querySelector(focus))?.focus();
    return 'ok';
  }

  // no rebuild between pointer down and up: a replaced button would lose the click
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let pressTimer;
  document.addEventListener('pointerdown', e => {
    pressing = !!(/** @type {Element} */ (e.target)).closest?.(`[${ROOT}]`);
    clearTimeout(pressTimer);
    // safety: a pointerup lost elsewhere must not freeze the page
    if (pressing) pressTimer = setTimeout(() => { pressing = false; schedule(true); }, 5000);
  }, true);
  const release = () => {
    if (!pressing) return;
    pressing = false;
    clearTimeout(pressTimer);
    setTimeout(() => schedule(true), 0); // after the click has been dispatched
  };
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);

  // DEGIRO's router keeps the query while you stay in Favourites: from #/favourites?dg=alarms, its own
  // Favourites link (or a list, #/favourites/<id>) gets ?dg=alarms merged back in, so the Alarms page
  // would never go (or would come back on the next Favourites click). Only an empty value overrides
  // the remembered one, and DEGIRO then drops it from the URL. So a plain click on one of DEGIRO's
  // Favourites links goes to that link with dg= added. Navigation only: nothing else is clicked.
  addEventListener('click', e => {
    if (!dgSettings.priceAlarms || !page.hasAlarmsQuery() || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (/** @type {Element} */ (e.target)).closest?.(SEL.favouritesLinks);
    if (!a || a.closest(`[${OWN}]`)) return; // our Alarms item keeps its dg=alarms
    const href = a.getAttribute('href') || '';
    if (!/^#\/favourites(?=$|[/?])/.test(href)) return;
    const [path, query = ''] = href.split(/\?(.*)/s);
    const params = new URLSearchParams(query);
    params.set('dg', '');
    e.preventDefault();
    e.stopPropagation();
    location.hash = `${path}?${params}`;
  }, true);

  // a click outside the open product menu closes it
  document.addEventListener('click', e => {
    if (!view.menu) return;
    const target = /** @type {Element} */ (e.target);
    if (target.closest?.(`[${ROOT}] [role=listbox], [data-dg-alarm-products]`)) return;
    view.menu = false;
    schedule(true);
  });

  feature({ name: 'alarmsPage', enabled: () => dgSettings.priceAlarms, run, stop: remove });
})();
