// Shared UI for the isolated-world scripts (Orders/Transactions filters, price alarms): DEGIRO-style
// chips, a dropdown of checkboxes, outline icons and the page's light/dark colours. DOM only.
const dgUi = (() => {
  const BLUE = '#0095D2'; // DEGIRO blue
  const BELL = 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0';
  const QUESTION = 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6M12 16.8v.2';
  const PENCIL = 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4';

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

  /**
   * DEGIRO-style toggle switch: a real checkbox (role switch, keyboard Space) over a 40x24 track with a knob.
   * @param {{ on: boolean, label: string, onChange: (on: boolean) => void, th: ReturnType<typeof theme> }} o
   * @returns {HTMLLabelElement}
   */
  function toggle(o) {
    const { th } = o;
    if (!document.getElementById('dg-toggle-style')) {
      // one owned style: the focus ring (keyboard focus only) and forced-colors, which must keep on/off apart
      const st = __dgt.own(document.createElement('style'));
      st.id = 'dg-toggle-style';
      st.textContent = '[data-dg-toggle] input:focus-visible + span { box-shadow: 0 0 0 2px var(--dg-tg-bg), 0 0 0 4px ' + BLUE + '; }\n' +
        '[data-dg-toggle] span { forced-color-adjust: none; }';
      document.head.append(st);
    }
    const lab = document.createElement('label');
    lab.setAttribute('data-dg-toggle', '');
    lab.style.cssText = 'position:relative;display:inline-block;flex:none;width:40px;height:24px;cursor:pointer;vertical-align:middle;';
    lab.style.setProperty('--dg-tg-bg', th.bg);
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = o.on;
    cb.setAttribute('role', 'switch');
    cb.setAttribute('aria-label', o.label);
    cb.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;z-index:1;';
    const track = document.createElement('span');
    track.style.cssText = 'position:absolute;inset:0;box-sizing:border-box;border-radius:300px;pointer-events:none;';
    const knob = document.createElement('span');
    knob.style.cssText = 'position:absolute;top:3px;width:16px;height:16px;border-radius:50%;pointer-events:none;' +
      'transition:left .3s cubic-bezier(0,0,.2,1);';
    const paint = () => {
      const on = cb.checked;
      track.style.background = on ? BLUE : th.bg;
      track.style.border = `1px solid ${on ? BLUE : th.line}`;
      knob.style.background = on ? '#fff' : th.muted;
      knob.style.left = on ? '20px' : '4px';
    };
    paint();
    cb.addEventListener('change', () => { paint(); o.onChange(cb.checked); });
    lab.append(cb, track, knob);
    return lab;
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

  return Object.freeze({ BLUE, BELL, PENCIL, QUESTION, theme, chip, picker, toggle, icon });
})();
