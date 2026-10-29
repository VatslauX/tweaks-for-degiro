// Orders, Transactions and Alarms links in DEGIRO's left sidebar, below Products (Alarms only while
// Price alarms is on, with a badge counting open alarm banners). Each is a copy of DEGIRO's
// own Products item (same look in either theme) that points at DEGIRO's page; a plain link, so the
// page's own router does the rest. DEGIRO's items are never changed, except that on the Alarms page
// Favourites loses its "current" look (and gets it back).
(() => {
  const { SEL, page, own, feature, t, schedule } = __dgt; // common.js
  const ITEMS = [
    { key: 'orders', href: '#/orders/open', label: 'navOrders', current: page.isOrders,
      // a clipboard with lines
      paths: ['M7 4.5h10a1.5 1.5 0 0 1 1.5 1.5v13.5a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 7 4.5z',
        'M9.5 3h5v3h-5z', 'M8.5 10.5h7', 'M8.5 14h7', 'M8.5 17.5h4'] },
    { key: 'transactions', href: '#/transactions', label: 'navTransactions', current: page.isTransactions,
      // two opposite arrows
      paths: ['M4 8h15', 'M15.5 4.5 19 8l-3.5 3.5', 'M20 16H5', 'M8.5 12.5 5 16l3.5 3.5'] },
    { key: 'alarms', href: '#/favourites?dg=alarms', label: 'navAlarms', current: page.isAlarms, show: () => !!dgSettings.priceAlarms,
      // a bell
      paths: ['M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 20a2 2 0 0 0 4 0'] }
  ];

  // drawn into the copy of DEGIRO's own icon <svg> (its size and colour follow DEGIRO's); outlines,
  // so the fill DEGIRO's CSS gives its icon paths is switched off inline
  function drawIcon(svg, paths) {
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.replaceChildren(...paths.map(d => {
      const p = document.createElementNS(svg.namespaceURI, 'path');
      p.setAttribute('d', d);
      p.style.fill = 'none';
      return p;
    }));
  }

  // DEGIRO marks the current item with one class no other item has; remembered, because on pages
  // without a current item (Settings, say) there is none to learn from. Learned only from DEGIRO's
  // menu links, and only a class that the open page's link alone has (the first path segment of
  // its href is the hash's), so a one-off class elsewhere (an unread badge, a "More" link) is never
  // taken for it. DEGIRO marks Inbox current on its sub-pages too, so
  // #/inbox also matches on the sub-pages listed here; on others (account statement…) nothing is
  // learned, which only means waiting for a page that is listed.
  const INBOX_PAGES = ['inbox', 'orders', 'transactions'];
  /** @param {string | null} hash */
  const section = hash => ((hash || '').match(/^#\/([^/?#]+)/) || [])[1] || '';
  let currentClass = '';
  /** @param {Element[]} links */
  function learnCurrentClass(links) {
    const open = section(location.hash);
    /** @type {Map<string, Element[]>} */
    const owners = new Map();
    links.forEach(a => a.classList.forEach(c => owners.set(c, [...(owners.get(c) || []), a])));
    const isOpen = (/** @type {Element} */ a) => {
      const linkPage = section(a.getAttribute('href'));
      return linkPage === open || (linkPage === 'inbox' && INBOX_PAGES.includes(open));
    };
    const unique = [...owners].filter(([, as]) => as.length === 1 && isOpen(as[0])).map(([c]) => c);
    if (unique.length === 1) currentClass = unique[0];
  }

  // what a copy is made of: the tags and classes of DEGIRO's Products item and everything in it.
  // A copy made while Products looked current (or before DEGIRO restyled it) is made again.
  /** @param {Element} wrap */
  const signature = wrap => [wrap, ...wrap.querySelectorAll('*')].map(n => n.tagName + '.' + (n.getAttribute('class') || '')).join('|');
  let cloneSig = '';

  const ours = () => document.querySelectorAll('[data-dg-nav]');

  // DEGIRO's sidebar is a full-height column that neither scrolls nor shrinks, so in a short window
  // our links would push Profile, Settings and Log off below the screen. They show only while the
  // sidebar has room for them: shown, then hidden again in the same run (before anything is drawn)
  // if the sidebar's content is taller than the sidebar. Once hidden, they are tried again only when
  // the sidebar has grown past the height it had then, so they never flip back and forth.
  // A resize changes no DOM, so it runs this fit check itself (at most once a frame), not every feature.
  let hiddenAt = 0; // the sidebar's height when our links were last hidden for lack of room
  let resizeFrame = 0;
  const onResize = () => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      const bar = document.querySelector(SEL.sideNav)?.closest(SEL.sideBar);
      const els = /** @type {HTMLElement[]} */ ([...ours()]);
      if (bar && els.length) fit(bar, els);
    });
  };
  /** @param {Element} bar @param {HTMLElement[]} els */
  function fit(bar, els) {
    const show = (/** @type {boolean} */ on) => els.forEach(el => { el.style.display = on ? '' : 'none'; });
    if (els.every(el => el.style.display === 'none') && bar.clientHeight <= hiddenAt) return;
    show(true);
    if (bar.scrollHeight > bar.clientHeight) { show(false); hiddenAt = bar.clientHeight; } else hiddenAt = 0;
  }

  // open alarm banners, counted on the Alarms item (alarms.js keeps them)
  /** @param {HTMLElement} a */
  function badge(a) {
    const ids = new Set(dgAlarmStore.list().map(x => x.id));
    const n = dgAlarmStore.events().filter(e => ids.has(e.alarmId)).length;
    let b = a.querySelector('[data-dg-nav-badge]');
    if (!n) { b?.remove(); return; }
    if (!b) {
      b = own(document.createElement('span'));
      b.setAttribute('data-dg-nav-badge', '');
      /** @type {HTMLElement} */ (b).style.cssText = 'position:absolute;top:2px;right:14px;min-width:14px;padding:0 4px;border-radius:8px;' +
        'background:#E40101;color:#fff;font-size:9px;line-height:14px;text-align:center;font-weight:600;pointer-events:none;';
      a.style.position = 'relative';
      a.append(b);
    }
    if (b.textContent !== String(n)) b.textContent = String(n);
  }

  // On the Alarms page DEGIRO's route is still Favourites, so DEGIRO marks its Favourites item current
  // too and two items would look current. While the Alarms item is shown there, the current class (and
  // aria-current) is taken off Favourites and what was taken is noted on the element, so exactly that
  // is put back: when the page is left for Favourites itself (DEGIRO won't re-add it), or when the
  // item goes away. Only a class and an attribute change; its link and listeners are untouched.
  const TAKEN = 'data-dg-nav-uncurrent'; // "<class>" or "<class> aria"
  /** @param {boolean} take */
  function favouritesLook(take) {
    const fav = document.querySelector(SEL.favouritesMenuItem);
    if (!fav) return;
    const taken = (fav.getAttribute(TAKEN) || '').split(' ').filter(Boolean);
    if (take && currentClass) {
      let cls = taken[0] || '';
      let aria = taken[1] === 'aria';
      if (fav.classList.contains(currentClass)) { cls = currentClass; fav.classList.remove(currentClass); }
      if (fav.hasAttribute('aria-current')) { aria = fav.getAttribute('aria-current') === 'page' || aria; fav.removeAttribute('aria-current'); }
      const note = cls ? cls + (aria ? ' aria' : '') : '';
      if (note && fav.getAttribute(TAKEN) !== note) fav.setAttribute(TAKEN, note);
    } else if (taken.length) {
      if (page.isFavourites() && !(take && page.isAlarms())) {
        fav.classList.add(taken[0]);
        if (taken[1] === 'aria') fav.setAttribute('aria-current', 'page');
      }
      fav.removeAttribute(TAKEN);
    }
  }

  function run() {
    const nav = document.querySelector(SEL.sideNav);
    const products = nav?.querySelector(SEL.productsMenuItem);
    if (!nav || !products) { ours().forEach(el => el.remove()); favouritesLook(false); return nav ? 'missing' : 'idle'; }
    // DEGIRO's own item: the child of the nav holding the Products link
    /** @type {Element} */
    let wrap = products;
    while (wrap.parentElement && wrap.parentElement !== nav) wrap = wrap.parentElement;
    learnCurrentClass([...nav.querySelectorAll(SEL.menuItem)].filter(a => !a.closest('[data-dg-nav]')));
    const sig = signature(wrap);
    if (sig !== cloneSig) { ours().forEach(el => el.remove()); cloneSig = sig; }

    addEventListener('resize', onResize); // the same listener is added only once
    let after = wrap;
    for (const item of ITEMS) {
      if (item.show && !item.show()) { nav.querySelector(`[data-dg-nav="${item.key}"]`)?.remove(); continue; }
      let el = nav.querySelector(`[data-dg-nav="${item.key}"]`);
      if (!el) {
        el = own(/** @type {Element} */ (wrap.cloneNode(true)));
        el.setAttribute('data-dg-nav', item.key);
        el.querySelectorAll('[data-name], [data-type], [id]').forEach(n => { n.removeAttribute('data-name'); n.removeAttribute('data-type'); n.removeAttribute('id'); });
        // no tooltip or screen-reader name saying "Products": ours instead, where DEGIRO had one
        [el, ...el.querySelectorAll('[title], [aria-label], [aria-describedby], [aria-labelledby]')].forEach(n => {
          if (n.hasAttribute('title')) n.setAttribute('title', t(item.label));
          if (n.hasAttribute('aria-label')) n.setAttribute('aria-label', t(item.label));
          n.removeAttribute('aria-describedby');
          n.removeAttribute('aria-labelledby');
        });
        const a = el.querySelector('a');
        if (!a) return 'missing';
        a.setAttribute('href', item.href);
        const label = a.querySelector('span');
        if (label) label.textContent = t(item.label);
        else a.append(t(item.label));
        const svg = a.querySelector('svg');
        if (svg) drawIcon(svg, item.paths);
      }
      // follow DEGIRO's look (theme, layout), and show which page is open
      const a = el.querySelector('a');
      if (a) {
        const cls = [...products.classList].filter(c => c !== currentClass);
        if (item.current() && currentClass) cls.push(currentClass);
        if (a.className !== cls.join(' ')) a.className = cls.join(' ');
        if (item.current()) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        if (item.key === 'alarms') badge(/** @type {HTMLElement} */ (a));
      }
      if (after.nextElementSibling !== el) after.after(el);
      after = el;
    }
    favouritesLook(!!dgSettings.priceAlarms && page.isAlarms() && !!nav.querySelector('[data-dg-nav="alarms"]'));
    const bar = nav.closest(SEL.sideBar);
    if (bar) fit(bar, /** @type {HTMLElement[]} */ ([...ours()]));
    return 'ok';
  }

  feature({
    name: 'navLinks',
    enabled: () => dgSettings.navLinks,
    run,
    stop: () => { ours().forEach(el => el.remove()); favouritesLook(false); cloneSig = ''; hiddenAt = 0; removeEventListener('resize', onResize); cancelAnimationFrame(resizeFrame); resizeFrame = 0; }
  });
  dgOnSettings(() => schedule(true)); // priceAlarms isn't bridged to the page: nudge
})();
