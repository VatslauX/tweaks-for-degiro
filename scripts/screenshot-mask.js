// DevTools snippet for the store screenshots: paste it into the console of a logged-in
// trader.degiro.nl tab. It replaces every personal number on screen with a mock value, only in
// that tab and only on screen (DEGIRO's DOM is hidden under a CSS overlay, never sent anywhere).
// Reload the tab to undo. Then take the screenshots listed in scripts/store-images.spec.js.
//
// Covered: the account summary bar (collapse it first: its expanded view lists real orders),
// the position line and position block, order badge sizes, the portfolio chart (total, axis,
// period change, range label; DEGIRO's own hover value is hidden), and the Orders page (limits
// and stop prices shifted a few %, sizes, values, and the extension's totals). Check every shot before using it.
(() => {
  if (!document.getElementById('dg-mock-css')) {
    const st = document.createElement('style');
    st.id = 'dg-mock-css';
    st.textContent = '[data-dg-mock]{font-size:0!important;filter:none!important;letter-spacing:normal}' +
      '[data-dg-mock] *{display:none!important}' +
      '[data-dg-mock]::after{content:attr(data-dg-mock);font-size:var(--dg-fs,13px);filter:none}';
    document.head.appendChild(st);
  }
  // DEGIRO's elements: overlay the mock text, keep the real DOM untouched for its renderer
  const mock = (el, t) => {
    if (!el) return;
    if (!el.hasAttribute('data-dg-mock')) el.style.setProperty('--dg-fs', getComputedStyle(el).fontSize);
    if (el.getAttribute('data-dg-mock') !== t) el.setAttribute('data-dg-mock', t);
  };
  // the extension's own elements: set the text directly
  const text = (el, t) => { if (el && el.textContent !== t) el.textContent = t; if (el) el.style.filter = 'none'; };
  const fmt = v => v.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = s => parseFloat(s.replace(/[^\d,]/g, '').replace(',', '.'));
  const curOf = s => (s.trim().match(/^[^\d\s ]+/) || ['€'])[0]; // DEGIRO uses a no-break space

  const run = () => {
    // account summary bar: label → value
    const TOP = { 'Balance': '€ 25.000,00', 'Portfolio': '€ 20.750,40', 'EUR': '€ 4.249,60',
      'Available to trade': '€ 4.249,60', 'Total P/L': '€ +1.250,40', 'Day P/L': '€ +86,10' };
    for (const lab of [...document.querySelectorAll('body *')].filter(e => !e.children.length && TOP[e.textContent.trim()] && e.getBoundingClientRect().top < 160)) {
      let box = lab;
      while (box.parentElement && box.parentElement.children.length < 2) box = box.parentElement;
      for (const k of box.parentElement.children) if (k !== box) mock(k, TOP[lab.textContent.trim()]);
    }
    const rows = [...document.querySelectorAll('tr[data-id]')].filter(r => r.querySelector('[data-field=limitColumnValue]'));
    const outstanding = [...document.querySelectorAll('body span')].find(e => e.textContent.trim() === 'Outstanding');
    if (outstanding?.nextElementSibling) mock(outstanding.nextElementSibling, rows.length ? String(rows.length) : '4');

    // product page
    for (const p of document.querySelectorAll('[data-name=positionDetails]')) if (p.children[1]) mock(p.children[1], '€ 1.644,40 (Qty. 100)');
    for (const lab of [...document.querySelectorAll('body div, body span')].filter(e => !e.children.length &&
      /^(Break-Even Price|P\/L|Unrealised P\/L|Total P\/L|Position)$/.test(e.textContent.trim()) &&
      !e.closest('[data-name=positionDetails]') && e.getBoundingClientRect().top > 160)) {
      const val = lab.parentElement?.lastElementChild;
      if (val && val !== lab) mock(val, '—');
    }
    const sizes = [100, 50, 150, 200, 75];
    let b = 0;
    for (const d of document.querySelectorAll('.highcharts-container div')) {
      if (d.children.length) continue;
      const m = d.textContent.match(/^((?:▲ |▼ )?)(BUY|SELL) ([\d.,]+) · (.*)$/);
      if (m) text(d, `${m[1]}${m[2]} ${sizes[b++ % sizes.length]} · ${m[4]}`); // the price stays: it matches the line
    }

    // portfolio chart
    const amount = document.querySelector('[data-name=performance-chart-amount]');
    mock(amount, '€ 20.750,40');
    for (let s = amount?.nextElementSibling; s && s.id !== 'dg-portfolio-change'; s = s.nextElementSibling) {
      if (/\d/.test(s.textContent)) s.style.display = 'none'; // DEGIRO's hover value
    }
    const change = document.getElementById('dg-portfolio-change');
    if (change?.lastElementChild) text(change.lastElementChild, '€ +1.250,40 (+6,41%)');
    const block = document.querySelector('[data-name=performance-chart]');
    if (block) {
      const axis = [...block.querySelectorAll('*')].filter(e => !e.children.length && e !== amount && /€/.test(e.textContent) &&
        !e.closest('#dg-portfolio-change') && !e.closest('[data-dg-own]') && !amount?.contains(e))
        .sort((x, y) => x.getBoundingClientRect().top - y.getBoundingClientRect().top);
      axis.forEach((e, i) => mock(e, i < axis.length / 2 ? '€ 21.200,00' : '€ 18.900,00'));
    }
    for (const lab of document.querySelectorAll('[data-dg-sel] [data-dg-own]')) {
      if (lab.children.length !== 2 || !/%/.test(lab.children[0].textContent)) continue;
      text(lab.children[0].firstElementChild || lab.children[0], '€ +830,20 (+4,12%)');
      if (lab.children[1].firstElementChild) text(lab.children[1].firstElementChild, '€ 20.150,00 → € 20.980,20');
    }

    // Orders page: limit a few % off, a round size worth ~2.500, value = size × limit; totals from those
    const K = [0.93, 1.06, 0.97, 1.04, 0.95, 1.08];
    const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
    const tot = { buy: {}, sell: {} };
    rows.forEach((r, i) => {
      const l = r.querySelector('[data-field=limitColumnValue]');
      const cur = curOf(l.textContent), real = num(l.textContent);
      if (!real) return;
      const limit = Math.max(0.5, Math.round(real * K[i % K.length] * 2) / 2);
      const qty = NICE.reduce((a, c) => Math.abs(c * limit - 2500) < Math.abs(a * limit - 2500) ? c : a);
      mock(l, `${cur} ${fmt(limit)}`);
      const stop = r.querySelector('[data-field=stopPriceColumnValue]'); // a stop price, if any, moves with the limit
      const realStop = stop && num(stop.textContent);
      if (realStop) mock(stop, `${curOf(stop.textContent)} ${fmt(Math.max(0.5, Math.round(realStop * K[i % K.length] * 2) / 2))}`);
      mock(r.querySelector('[data-field=quantityColumnValue]'), String(qty));
      mock(r.querySelector('[data-field=outstandingColumnValue]'), String(qty));
      mock(r.querySelector('[data-field=executedColumnValue]'), '0');
      mock(r.querySelector('[data-field=valuableColumnValue]'), fmt(qty * limit));
      if (getComputedStyle(r).display === 'none') return; // filtered out
      const side = [...r.children].some(c => c.textContent.trim() === 'Sell') ? 'sell' : 'buy';
      const t = tot[side][cur] ||= { v: 0, n: 0 };
      t.v += qty * limit;
      t.n++;
    });
    for (const side of ['buy', 'sell']) {
      const el = document.querySelector(`[data-dg-total=${side}]`)?.children[1];
      if (!el) continue;
      const parts = Object.entries(tot[side]).sort().map(([c, t]) => `${c} ${fmt(t.v)} (${t.n})`);
      text(el, parts.length ? parts.join(' · ') : '—');
    }
  };

  // DEGIRO re-renders on every price tick: keep re-applying until the tab is reloaded
  clearInterval(window.__dgMaskTimer);
  window.__dgMaskTimer = setInterval(() => { try { run(); } catch (e) {} }, 50);
  return 'mock numbers on (reload the tab to undo)';
})();
