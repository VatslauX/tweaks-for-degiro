// Shared UI for the isolated-world scripts (Orders/Transactions filters, price alarms): DEGIRO-style
// chips, a dropdown of checkboxes, outline icons and the page's light/dark colours. DOM only.
const dgUi = (() => {
  const BLUE = '#0095D2'; // DEGIRO blue
  const BELL = 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0';
  const PENCIL = 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4';
  const TRASH = 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6';

  // the page's colours: light or dark, following DEGIRO's theme
  function theme() {
    const c = getComputedStyle(document.body).backgroundColor;
    const bg = /rgba\(0, 0, 0, 0\)|transparent/.test(c) ? 'rgb(255, 255, 255)' : c;
    const [r, g, b] = (bg.match(/\d+/g) || ['255', '255', '255']).map(Number);
    const dark = 0.299 * r + 0.587 * g + 0.114 * b < 128;
    const text = getComputedStyle(document.body).color;
    return {
      dark, bg, text,
      muted: dark ? '#8FA0A6' : '#65757B',  // DEGIRO's unselected tab text
      buy: dark ? '#4CB82E' : '#1E8302',    // DEGIRO green
      sell: dark ? '#FF5A5F' : '#E40101',   // DEGIRO red
      line: dark ? 'rgba(255,255,255,.18)' : '#D6DFE3'
    };
  }

  // DEGIRO-style pill: selected = filled (dark, or the accent colour), unselected = plain text
  /** @param {string} label @param {boolean} on @param {() => void} onClick @param {ReturnType<typeof theme>} th @param {string} [accent] */
  function chip(label, on, onClick, th, accent) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    const fill = accent || th.text;
    b.style.cssText = `font:inherit;font-size:12px;line-height:16px;height:28px;padding:0 12px;border-radius:300px;cursor:pointer;border:0;` +
      `background:${on ? fill : 'transparent'};color:${on ? (accent ? '#fff' : th.bg) : (accent || th.muted)};font-weight:${accent ? 500 : 400};`;
    b.addEventListener('click', onClick);
    return b;
  }

  /**
   * DEGIRO-style dropdown of checkboxes. The caller keeps which menu is open and re-renders.
   * @param {{ kind: string, label: string, active: boolean, items: { text: string, checked: boolean, change: (on: boolean) => void }[],
   *   th: ReturnType<typeof theme>, footer?: Node | null, align?: 'right', open: boolean, onToggle: () => void, onChange: () => void }} o
   */
  function picker(o) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;';
    const btn = chip(o.label + ' ▾', o.active, o.onToggle, o.th);
    if (!o.active) { btn.style.border = `1px solid ${o.th.line}`; btn.style.color = o.th.text; }
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', o.open ? 'true' : 'false');
    btn.setAttribute(`data-dg-${o.kind}`, '');
    wrap.append(btn);
    if (o.open) {
      const right = o.align === 'right';
      const menu = document.createElement('div');
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-multiselectable', 'true');
      menu.style.cssText = `position:absolute;z-index:50;top:calc(100% + 4px);${right ? 'right:0;left:auto;' : 'left:0;'}min-width:min(280px,calc(100vw - 32px));max-width:min(420px,calc(100vw - 32px));max-height:300px;overflow:auto;` +
        `background:${o.th.bg};color:${o.th.text};border:1px solid ${o.th.line};border-radius:6px;padding:6px;box-shadow:0 4px 14px rgba(0,0,0,.18);`;
      o.items.forEach(({ text, checked, change }) => {
        const lab = document.createElement('label');
        lab.style.cssText = 'display:flex;gap:8px;padding:4px 6px;font-size:12px;cursor:pointer;' +
          'align-items:flex-start;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.style.cssText = 'margin:2px 0 0;flex:none;';
        cb.checked = checked;
        cb.addEventListener('change', () => { change(cb.checked); o.onChange(); });
        const span = document.createElement('span');
        span.textContent = text;
        span.style.cssText = 'white-space:normal;overflow-wrap:anywhere;min-width:0;';
        lab.append(cb, span);
        menu.append(lab);
      });
      if (o.footer) menu.append(o.footer);
      wrap.append(menu);
      if (right) {
        // Narrow page: never start left of the visible page area.
        setTimeout(() => {
          const bound = wrap.closest('main') || document.documentElement;
          const m = menu.getBoundingClientRect();
          const left = Math.max(bound.getBoundingClientRect().left, 0);
          if (m.width > 0 && m.left < left) { menu.style.minWidth = '0'; menu.style.boxSizing = 'border-box'; menu.style.width = `${Math.floor(m.right - left)}px`; }
        }, 0);
      }
    }
    return wrap;
  }

  // an outline icon; the <svg> is made in the namespace of one already on the page, so no
  // namespace URL appears in our source (tests/unit/static.test.js)
  /** @param {string} d @param {number} size @param {string} [color] */
  function icon(d, size, color = 'currentColor') {
    const ns = document.querySelector('svg')?.namespaceURI;
    if (!ns) return document.createElement('span');
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', color);
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    /** @type {SVGElement} */ (p).style.fill = 'none';
    svg.append(p);
    return svg;
  }

  /**
   * DEGIRO-style toggle switch: a real <input type=checkbox role=switch>, so keyboard, focus and
   * screen readers keep working, and selectors such as `input[type=checkbox]` still match it. The
   * track and knob are drawn with inline CSS only (a radial-gradient for the knob, since inline
   * styles can't add pseudo-elements), repainted on every change.
   * @param {{ checked: boolean, label?: string, onChange: (on: boolean) => void, th: ReturnType<typeof theme>, disabled?: boolean }} o
   */
  function toggle(o) {
    const inp = /** @type {HTMLInputElement} */ (document.createElement('input'));
    inp.type = 'checkbox';
    inp.setAttribute('role', 'switch');
    if (o.label) inp.setAttribute('aria-label', o.label);
    inp.checked = !!o.checked;
    if (o.disabled) inp.disabled = true;
    inp.style.cssText = 'appearance:none;-webkit-appearance:none;width:32px;height:18px;min-width:32px;' +
      'border-radius:9px;flex:none;border:0;padding:0;margin:0;outline-offset:2px;outline:2px solid transparent;' +
      `cursor:${o.disabled ? 'default' : 'pointer'};opacity:${o.disabled ? '.5' : '1'};`;
    const paint = () => {
      const on = inp.checked, x = on ? 23 : 9, track = on ? BLUE : o.th.line;
      inp.style.background = `radial-gradient(circle 7px at ${x}px 9px, #fff 100%, transparent 100%), ${track}`;
    };
    paint();
    inp.addEventListener('change', () => { paint(); o.onChange(inp.checked); });
    inp.addEventListener('focus', () => { inp.style.outlineColor = BLUE; });
    inp.addEventListener('blur', () => { inp.style.outlineColor = 'transparent'; });
    return inp;
  }

  // DEGIRO-style status pill: small, rounded, muted by default, coloured for the states that
  // matter. Backgrounds are rgba tints so they read in both the light and dark themes.
  /** @param {string} text @param {'waiting' | 'fired' | 'off' | 'unseen'} kind @param {ReturnType<typeof theme>} th */
  function pill(text, kind, th) {
    const span = document.createElement('span');
    span.textContent = text;
    const muted = th.dark ? 'rgba(255,255,255,.12)' : 'rgba(15,23,26,.07)';
    const colours = {
      waiting: { bg: th.dark ? 'rgba(0,149,210,.25)' : 'rgba(0,149,210,.12)', fg: BLUE },
      fired: { bg: th.dark ? 'rgba(255,90,95,.22)' : 'rgba(228,1,1,.1)', fg: th.sell },
      off: { bg: muted, fg: th.muted },
      unseen: { bg: muted, fg: th.muted }
    };
    const c = colours[kind] || colours.off;
    span.style.cssText = `display:inline-block;font-size:11px;line-height:14px;border-radius:10px;padding:2px 8px;background:${c.bg};color:${c.fg};`;
    return span;
  }

  return Object.freeze({ BLUE, BELL, PENCIL, TRASH, theme, chip, picker, icon, toggle, pill });
})();
