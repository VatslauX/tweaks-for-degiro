// Price alarms: the Alarm button on a product page, for a product in your Favourites, and the
// Set price alarm panel it opens. The panel is our own, styled like DEGIRO's Place order panel, so
// none of DEGIRO's order logic comes with it; DEGIRO's Buy/Sell and order form are never touched.
// The same panel edits one alarm (Edit on the Alarms page, via dgAlarmPanel.edit): no product header needed.
const dgAlarmPanel = (() => {
  const { SEL, LABELS, page, own, feature, t, parseNum, fmt } = __dgt; // common.js
  const R = dgAlarmRules, S = dgAlarmStore;
  const BTN = 'data-dg-alarm-button', PANEL = 'data-dg-alarm-panel';
  const ALARMS_HREF = '#/favourites?dg=alarms';
  /** @param {Element | null | undefined} el */
  const text = el => (el?.textContent || '').trim();

  // DEGIRO's product header for the product in the address: its Buy/Sell row and what an alarm
  // records. null unless at least one header is found (DEGIRO's Place order panel has its own
  // Buy/Sell and product name, but no note button next to them). DEGIRO keeps two copies of the
  // header (the full one and a compact sticky one, only one laid out at a time): all matching
  // copies are returned in `copies`; the fields come from the laid-out copy, else the first.
  function header() {
    const id = page.productId();
    if (!id) return null;
    const found = [];
    for (const buy of document.querySelectorAll('button')) {
      if (!LABELS.buy.test(text(buy)) || buy.closest(`[${PANEL}]`)) continue;
      const row = buy.parentElement;
      const sell = row && [...row.children].find(c => c.tagName === 'BUTTON' && LABELS.sell.test(text(c)));
      if (!row || !sell) continue;
      // the nearest ancestor that names a product must be this product's header, with the note button
      let hdr = row.parentElement;
      while (hdr && hdr !== document.body && !hdr.querySelector(SEL.productName)) hdr = hdr.parentElement;
      if (!hdr || hdr === document.body || !hdr.querySelector(`${SEL.productName}[data-id="${id}"]`) || !hdr.querySelector(SEL.productActionButton)) continue;
      found.push({ row, sell: /** @type {HTMLElement} */ (sell), hdr });
    }
    if (!found.length) return null;
    const { row, sell, hdr } = found.find(f => f.hdr.getClientRects().length > 0) || found[0];
    const nameEl = hdr.querySelector(`${SEL.productName}[data-id="${id}"]`);
    const brief = [...hdr.querySelectorAll(`${SEL.productBriefInfo}[data-id="${id}"]`)].map(text);
    return { id, row, sell, hdr, copies: found, fav: found.some(f => f.hdr.querySelector(SEL.favouriteStarOn)), name: nameEl?.getAttribute('title') || text(nameEl),
      symbol: brief[0] || '', exchange: brief[1] || '', currency: currencyOf(id) };
  }

  // the currency sign DEGIRO shows next to one of this product's prices ("$ 248,30" → "$")
  /** @param {number} id */
  function currencyOf(id) {
    for (const el of document.querySelectorAll(`${SEL.currentPrice}[data-id="${id}"]`)) {
      const c = text(el).replace(/[\d.,\s+\-−%()]/g, '');
      if (c) return c.slice(0, R.LIMITS.currency);
    }
    return '';
  }

  // the price now: what detection read this frame, else the header's own field
  /** @param {number} id */
  function priceNow(id) {
    const live = S.live().get(id);
    if (live) return live;
    const el = [...document.querySelectorAll(`${SEL.currentPrice}[data-id="${id}"]`)].find(e => !e.closest(SEL.measurer));
    const v = el ? parseNum(el.getAttribute('title') || text(el)) : NaN;
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  // the header the last run found; the button's click always opens this one, never the one it was made for
  /** @type {ReturnType<typeof header>} */
  let current = null;
  let lastKey = '';
  /** the last header search: null when nothing was found (or none ran) @type {ReturnType<typeof header>} */
  let seen = null;
  let lastScan = 0;

  // ---------- button ----------
  /** @param {NonNullable<ReturnType<typeof header>>} h */
  function button(h) {
    // a button left in a copy that is no longer a matching header (product changed in place)
    const keep = new Set(h.copies.map(c => c.row));
    document.querySelectorAll(`[${BTN}]`).forEach(x => { if (!x.parentElement || !keep.has(x.parentElement)) x.remove(); });
    h.copies.forEach(c => buttonIn(h, c));
  }

  /** @param {NonNullable<ReturnType<typeof header>>} h @param {{ row: Element, sell: HTMLElement }} c */
  function buttonIn(h, c) {
    let b = /** @type {HTMLElement | null} */ (c.row.querySelector(`[${BTN}]`));
    if (!b) {
      // DEGIRO's Sell button's look (its classes), in DEGIRO's blue; none of its hooks
      b = /** @type {HTMLElement} */ (c.sell.cloneNode(false));
      [...b.attributes].forEach(at => { if (at.name !== 'class' && at.name !== 'type') b?.removeAttribute(at.name); });
      own(b);
      b.setAttribute(BTN, '');
      b.style.cssText = `color:${dgUi.BLUE};border-color:${dgUi.BLUE};display:inline-flex;align-items:center;gap:6px;grid-row:1;grid-column:3;`; // DEGIRO's row is a two-column grid: stay on its line
      b.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); if (current) open(current); });
    }
    const n = S.list().filter(a => a.productId === h.id && a.on).length;
    const label = t('alarmButton') + (n ? ` ${n}` : '');
    if (b.getAttribute('data-label') !== label) {
      b.setAttribute('data-label', label);
      b.replaceChildren(dgUi.icon(dgUi.BELL, 16), document.createTextNode(label));
    }
    if (c.sell.nextElementSibling !== b) c.sell.after(b);
  }

  // ---------- panel ----------
  /** @type {null | { root: HTMLElement, id: number, h: any, edit: any, repeat: string, latest: HTMLElement, input: HTMLInputElement, hint: HTMLElement,
   *   msg: HTMLElement, set: HTMLButtonElement, seg: HTMLButtonElement[], list: HTMLElement, listSig: string, touched: boolean, msgKind: string, saving: boolean }} */
  let ui = null;

  const onKey = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') close(); };
  const onDown = (/** @type {MouseEvent} */ e) => {
    const el = /** @type {Element} */ (e.target);
    if (ui && !ui.root.contains(el) && !el.closest?.(`[${BTN}]`)) close();
  };
  function close() {
    ui?.root.remove();
    ui = null;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onDown, true);
  }

  /** @param {string} tag @param {string} css @param {string} [txt] */
  function el(tag, css, txt) {
    const e = document.createElement(tag);
    e.style.cssText = css;
    if (txt != null) e.textContent = txt;
    return e;
  }

  /** What the panel needs of a product: from the product header, or from a stored alarm.
   * @param {{ id: number, name: string, symbol: string, exchange?: string, currency: string }} h @param {any} [edit] the alarm to edit */
  function open(h, edit) {
    close();
    const th = dgUi.theme();
    const root = own(el('div', `position:fixed;top:0;right:0;bottom:0;width:360px;max-width:100vw;z-index:2147483000;display:flex;flex-direction:column;` +
      `background:${th.bg};color:${th.text};border-left:1px solid ${th.line};box-shadow:-6px 0 18px rgba(0,0,0,.12);font-size:14px;`));
    root.setAttribute(PANEL, String(h.id));
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', t(edit ? 'alarmEditTitle' : 'alarmPanelTitle'));

    const head = el('div', `display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid ${th.line};font-weight:600;`, t(edit ? 'alarmEditTitle' : 'alarmPanelTitle'));
    const x = /** @type {HTMLButtonElement} */ (el('button', `width:32px;height:32px;border-radius:50%;border:1px solid ${th.line};background:transparent;color:${dgUi.BLUE};font-size:18px;cursor:pointer;`, '×'));
    x.type = 'button';
    x.setAttribute('aria-label', t('bannerClose'));
    x.setAttribute('data-dg-alarm-x', '');
    x.addEventListener('click', close);
    head.append(x);

    const body = el('div', 'padding:16px 18px;display:grid;gap:12px;overflow:auto;');
    const name = el('div', 'font-weight:600;font-size:15px;', h.name);
    const sub = el('div', `color:${th.muted};font-size:12px;`, [h.symbol, h.exchange].filter(Boolean).join(' • '));
    const latest = el('div', 'font-variant-numeric:tabular-nums;');
    const label = el('label', `display:grid;gap:5px;font-size:12px;color:${th.muted};`, t('alarmPriceLabel') + (h.currency ? ` (${h.currency})` : ''));
    const input = /** @type {HTMLInputElement} */ (document.createElement('input'));
    input.type = 'text';
    input.inputMode = 'decimal';
    input.setAttribute('data-dg-alarm-price', '');
    input.style.cssText = `height:42px;border:1.5px solid ${dgUi.BLUE};border-radius:21px;padding:0 16px;font:inherit;font-size:15px;background:transparent;color:${th.text};`;
    const now = edit ? edit.price : priceNow(h.id);
    // every decimal of the price (the saved price is rounded to 6), so Set never saves a price that was not shown
    const decimals = now ? Math.min(6, Math.max(2, (now.toFixed(6).split('.')[1] || '').replace(/0+$/, '').length)) : 2;
    input.value = now ? fmt(now, decimals) : '';
    label.append(input);
    const hint = el('div', 'font-size:12px;');
    hint.setAttribute('data-dg-alarm-hint', '');
    const msg = el('div', `font-size:12px;color:${th.sell};`);
    msg.setAttribute('data-dg-alarm-msg', '');
    msg.setAttribute('role', 'alert');

    const segWrap = el('div', `display:grid;grid-template-columns:repeat(3,1fr);gap:4px;`);
    const seg = /** @type {HTMLButtonElement[]} */ (['once', 'daily', 'each'].map(k => {
      const b = /** @type {HTMLButtonElement} */ (el('button', '', t(k === 'once' ? 'alarmOnce' : k === 'daily' ? 'alarmDaily' : 'alarmEach')));
      b.type = 'button';
      b.setAttribute('data-dg-alarm-repeat', k);
      b.addEventListener('click', () => { if (ui) { ui.repeat = k; update(); } });
      return b;
    }));
    segWrap.append(...seg);
    const repeatLabel = el('div', `font-size:12px;color:${th.muted};`, t('alarmRepeat'));

    const set = /** @type {HTMLButtonElement} */ (el('button', `height:42px;border-radius:21px;border:0;background:${dgUi.BLUE};color:#fff;font:inherit;font-weight:600;cursor:pointer;`, t(edit ? 'alarmSave' : 'alarmSet')));
    set.type = 'button';
    set.setAttribute('data-dg-alarm-set', '');
    set.addEventListener('click', () => save());
    const cancel = /** @type {HTMLButtonElement} */ (el('button', `height:42px;border-radius:21px;border:1px solid ${dgUi.BLUE};background:transparent;color:${dgUi.BLUE};font:inherit;font-weight:600;cursor:pointer;`, t('alarmCancel')));
    cancel.type = 'button';
    cancel.setAttribute('data-dg-alarm-cancel', '');
    cancel.addEventListener('click', close);

    const listTitle = el('div', `font-size:12px;color:${th.muted};text-transform:uppercase;letter-spacing:.05em;margin-top:4px;`, t('alarmForProduct', h.name));
    const list = el('div', 'display:grid;gap:6px;');
    const note = el('div', `font-size:11.5px;color:${th.muted};border-top:1px solid ${th.line};padding-top:10px;`, t('alarmCheckedNote') + ' ');
    const all = document.createElement('a');
    all.href = ALARMS_HREF;
    all.textContent = t('alarmAll');
    all.style.cssText = `color:${dgUi.BLUE};font-weight:600;text-decoration:none;`;
    all.addEventListener('click', close);
    note.append(all);

    if (edit) body.append(name, sub, latest, label, hint, repeatLabel, segWrap, set, cancel, msg, note);
    else body.append(name, sub, latest, label, hint, repeatLabel, segWrap, set, msg, listTitle, list, note);
    root.append(head, body);
    document.body.append(root);
    ui = { root, id: h.id, h, edit: edit || null, repeat: edit ? edit.repeat : 'once', latest, input, hint, msg, set, seg, list, listSig: '', touched: false, msgKind: '', saving: false };
    input.addEventListener('input', () => { if (ui) { ui.touched = true; if (ui.msgKind === 'result') { ui.msg.textContent = ''; ui.msgKind = ''; } } update(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown, true);
    update();
    input.focus();
    input.select();
  }

  // the typed price, and which way it is from the price now (null: no valid alarm price)
  function reading() {
    if (!ui) return { v: NaN, dir: null, now: 0 };
    const v = parseNum(ui.input.value);
    // editing from the Alarms page: the live price is DEGIRO's Favourites row; else the last price seen
    const now = priceNow(ui.id) || (ui.edit ? S.state()[ui.edit.id]?.last || 0 : 0);
    const valid = Number.isFinite(v) && v > 0;
    // editing with no price known at all (an alarm synced from another computer): it keeps its direction
    const noPrice = !!ui.edit && !now && valid;
    return { v, now, noPrice, dir: noPrice ? ui.edit?.dir || null : valid && now ? R.direction(v, now) : null };
  }

  function update() {
    if (!ui) return;
    const th = dgUi.theme(), { h } = ui;
    const { v, now, dir, noPrice } = reading();
    const money = (/** @type {number} */ n) => `${h.currency} ${fmt(n, 2, 4)}`.trim();
    ui.latest.textContent = now ? t('alarmLatest', money(now)) : '';
    if (dir && noPrice) {
      ui.hint.textContent = t('alarmHintNoPrice', `${dir === 'above' ? '↑' : '↓'} ${money(v)}`);
      ui.hint.style.color = th.muted;
    } else if (dir) {
      const pct = (v / now - 1) * 100;
      ui.hint.textContent = (dir === 'above' ? '↑ ' : '↓ ') + t(dir === 'above' ? 'alarmHintAbove' : 'alarmHintBelow', money(v), `${pct > 0 ? '+' : ''}${fmt(pct)}%`);
      ui.hint.style.color = dir === 'above' ? th.buy : th.sell;
    } else ui.hint.textContent = '';
    const typed = ui.input.value.trim() !== '';
    // a validation message follows the input and the price; a save result stays until the next input
    if (ui.msgKind !== 'result') {
      if (ui.touched && typed && !dir) { ui.msg.textContent = Number.isFinite(v) && v > 0 && v === now ? t('alarmErrorEqual') : t('alarmErrorPrice'); ui.msgKind = 'validation'; }
      else { ui.msg.textContent = ''; ui.msgKind = ''; }
    }
    const can = !!dir && !ui.saving;
    ui.set.disabled = !can;
    ui.set.style.opacity = can ? '1' : '.5';
    ui.seg.forEach(b => {
      const on = b.getAttribute('data-dg-alarm-repeat') === ui?.repeat;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.style.cssText = `padding:7px 4px;border-radius:17px;font:inherit;font-size:12.5px;cursor:pointer;background:transparent;` +
        `border:1px solid ${on ? dgUi.BLUE : th.line};color:${on ? th.text : th.muted};font-weight:${on ? 600 : 400};`;
    });
    if (!ui.edit) renderList(th);
  }

  /** @param {ReturnType<typeof dgUi.theme>} th */
  function renderList(th) {
    if (!ui) return;
    const mine = R.sorted(S.list().filter(a => a.productId === ui?.id), false);
    const sig = JSON.stringify([mine, th.bg]);
    if (sig === ui.listSig) return;
    ui.listSig = sig;
    // keep keyboard focus on the same control of the same row across the rebuild
    const a = document.activeElement;
    const frow = a && ui.list.contains(a) ? a.closest('[data-dg-alarm-row]')?.getAttribute('data-dg-alarm-row') : null;
    const fkind = !a ? '' : a.matches('[role=switch]') ? '[role=switch]' : a.matches('[data-dg-alarm-delete]') ? '[data-dg-alarm-delete]' : '';
    ui.list.replaceChildren(...mine.map(a => {
      const row = el('div', `display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid ${th.line};border-radius:8px;padding:7px 10px;font-size:13px;font-variant-numeric:tabular-nums;`);
      row.setAttribute('data-dg-alarm-row', a.id);
      const what = el('span', `color:${a.dir === 'above' ? th.buy : th.sell};`, `${a.dir === 'above' ? '↑' : '↓'} ${fmt(a.price, 2, 4)}`);
      const rep = el('span', `color:${th.muted};font-size:11.5px;flex:1;`, '· ' + t(a.repeat === 'once' ? 'alarmOnce' : a.repeat === 'daily' ? 'alarmDaily' : 'alarmEach'));
      const sw = dgUi.toggle({ on: a.on, label: t('alarmOnAria', fmt(a.price, 2, 4)), th, onChange: on => S.setOn(a.id, on) });
      const del = /** @type {HTMLButtonElement} */ (el('button', `border:0;background:transparent;color:${th.muted};cursor:pointer;font-size:15px;`, '×'));
      del.type = 'button';
      del.setAttribute('data-dg-alarm-delete', '');
      del.setAttribute('aria-label', t('alarmDelete'));
      del.addEventListener('click', () => S.remove(a.id));
      row.append(what, rep, sw, del);
      return row;
    }));
    if (frow && fkind) {
      const row = [...ui.list.children].find(r => r.getAttribute('data-dg-alarm-row') === frow);
      /** @type {HTMLElement | null | undefined} */ (row?.querySelector(fkind))?.focus();
    }
  }

  async function save() {
    if (!ui || ui.saving) return;
    const { v, dir } = reading();
    if (!dir) return;
    const { h } = ui;
    const edit = ui.edit;
    const mine = ui; // the panel may be closed (and another opened) while the write is pending
    ui.saving = true;
    update();
    if (edit) {
      const r = await S.update(edit.id, { price: v, dir, repeat: ui.repeat });
      if (ui !== mine) return;
      if (r === 'ok' || r === 'gone') { close(); return; }
      ui.saving = false;
      ui.msg.textContent = t('alarmSaveError');
      ui.msgKind = 'result';
      update();
      return;
    }
    const res = await S.add({ id: crypto.randomUUID(), productId: h.id, name: h.name, symbol: h.symbol, currency: h.currency,
      price: v, dir, repeat: ui.repeat, on: true, created: Date.now() });
    if (ui !== mine) return;
    ui.saving = false;
    if (res === 'ok') { ui.input.value = ''; ui.msg.textContent = ''; ui.msgKind = ''; }
    else { ui.msg.textContent = res === 'full' ? t('alarmFull', R.MAX) : t('alarmSaveError'); ui.msgKind = 'result'; }
    update();
  }

  function removeAll(keepEdit = false) {
    if (!(keepEdit && ui?.edit)) close();
    current = null;
    seen = null;
    lastScan = 0;
    lastKey = '';
    document.querySelectorAll(`[${BTN}]`).forEach(b => b.remove());
  }

  feature({
    name: 'alarmButton',
    every: 1000, // the star can change by attribute only, which the scheduler doesn't observe
    enabled: () => dgSettings.priceAlarms,
    run() {
      // an Edit panel (opened on the Alarms page) lives until it is closed, the page is left or its alarm is gone
      if (ui?.edit && (!page.isAlarms() || (S.ready() && !S.list().some(a => a.id === ui?.edit?.id)))) close();
      if (!page.isProduct()) { removeAll(true); if (ui) update(); return 'idle'; }
      const pid = page.productId();
      if (ui && ui.id !== pid) close();
      // nothing relevant changed since the last run: skip the header search (the panel still needs the live price).
      // The outcome of the last search is remembered too ("no header", "not a favourite"); the key sees the star
      // of every copy found, so a star toggled by attribute is noticed by the next timer run. While the search
      // found nothing or the header is incomplete (no name or currency yet) it repeats at most once a second.
      const btn = document.querySelector(`[${BTN}]`);
      const cs = seen?.copies || [];
      const key = [pid, cs.some(c => c.hdr.isConnected && !!c.hdr.querySelector(SEL.favouriteStarOn)),
        !!(btn && cs.length && document.querySelectorAll(`[${BTN}]`).length === cs.length &&
          cs.every(c => c.sell.isConnected && c.sell.nextElementSibling?.hasAttribute(BTN) && c.sell.nextElementSibling.isConnected)),
        S.list().filter(a => a.productId === pid && a.on).length].join('|');
      const clock = Date.now();
      // a cached header that DEGIRO has re-rendered (detached copies) is stale: search again
      const settled = !!seen && seen.copies.every(c => c.hdr.isConnected) && (!seen.fav || (!!seen.currency && !!seen.name));
      if (key === lastKey && (settled || clock - lastScan < 1000)) {
        if (!seen) return 'missing';
        if (!seen.fav) return 'idle';
        if (ui) update();
        return 'ok';
      }
      lastScan = clock;
      const h = header();
      seen = h;
      if (!h || !h.fav) {
        current = null;
        close();
        document.querySelectorAll(`[${BTN}]`).forEach(b => b.remove());
        lastKey = [pid, !!h?.copies.some(c => c.hdr.querySelector(SEL.favouriteStarOn)), false, S.list().filter(a => a.productId === pid && a.on).length].join('|');
        return h ? 'idle' : 'missing';
      }
      current = h;
      button(h);
      lastKey = [pid, true, true, S.list().filter(a => a.productId === pid && a.on).length].join('|');
      if (ui) { ui.h = h; update(); }
      return 'ok';
    },
    stop: () => removeAll()
  });

  return Object.freeze({
    /** @param {{ id: string, productId: number, name: string, symbol: string, currency: string, price: number, repeat: string }} a */
    edit: a => open({ id: a.productId, name: a.name || a.symbol || `#${a.productId}`, symbol: a.symbol, currency: a.currency }, a)
  });
})();
