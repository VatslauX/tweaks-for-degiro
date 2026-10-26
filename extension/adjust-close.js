// Close the "Adjust order" panel when clicking outside it, as if × was pressed.
(() => {
  const { SEL, LABELS } = __dgt; // common.js

  document.addEventListener('mousedown', e => {
    if (e.button !== 0 || !dgSettings.adjustClose) return;
    const details = /** @type {HTMLElement | null} */ (document.querySelector(SEL.orderDetails));
    if (!details || !details.offsetParent) { document.documentElement.removeAttribute('data-dg-drawer'); return; }
    if (!LABELS.adjustOrder.test(details.querySelector('header')?.textContent || '')) return;

    const panel = details.closest('aside') || details;
    const t = e.target;
    if (!(t instanceof Element) || panel.contains(t)) return;

    // Ignore clicks in DEGIRO popups/menus (confirmations, dropdowns):
    // they render outside the main layout or carry these roles.
    const app = document.querySelector(SEL.appLayout);
    if (app && !app.contains(t)) return;
    if (t.closest('[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=tooltip]')) return;

    // Only ever press Cancel (default) or the × close button — never any other button.
    // If neither is found, do nothing.
    const cancel = [...details.querySelectorAll('button')].find(b =>
      b.type !== 'submit' && LABELS.cancel.test(b.textContent.trim()));
    const cross = details.querySelector('header button[aria-label="Close"]');
    const btn = cancel || /** @type {HTMLElement | null} */ (cross);
    if (!btn) return;
    btn.click();
    // we opened the mobile "Account overview" drawer to reach the order — close it again
    if (document.documentElement.getAttribute('data-dg-drawer') === '1') {
      document.documentElement.removeAttribute('data-dg-drawer');
      setTimeout(() => /** @type {HTMLElement | null} */ (document.querySelector(SEL.drawerToggle))?.click(), 300);
    }
  }, true);
})();
