// Close the "Adjust order" panel when clicking outside it or pressing Esc, as if Cancel or × was pressed.
(() => {
  const { SEL, LABELS } = __dgt; // common.js
  const POPUPS = '[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=tooltip]';

  // The open Adjust order form, or null.
  const openDetails = () => {
    const details = /** @type {HTMLElement | null} */ (document.querySelector(SEL.orderDetails));
    if (!details || !details.offsetParent) { document.documentElement.removeAttribute('data-dg-drawer'); return null; }
    if (!LABELS.adjustOrder.test(details.querySelector('header')?.textContent || '')) return null;
    return details;
  };

  // Only ever press Cancel (default) or the × close button — never any other button.
  // If neither is found, do nothing.
  /** @param {HTMLElement} details */
  const close = details => {
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
  };

  document.addEventListener('mousedown', e => {
    if (e.button !== 0 || !dgSettings.adjustClose) return;
    const details = openDetails();
    if (!details) return;

    const panel = details.closest('aside') || details;
    const t = e.target;
    if (!(t instanceof Element) || panel.contains(t)) return;

    // Ignore clicks in DEGIRO popups/menus (confirmations, dropdowns):
    // they render outside the main layout or carry these roles.
    const app = document.querySelector(SEL.appLayout);
    if (app && !app.contains(t)) return;
    if (t.closest(POPUPS)) return;
    close(details);
  }, true);

  // Bubble phase, so a DEGIRO popup or field that handles Esc itself (and prevents the default) wins.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || e.repeat || !dgSettings.adjustClose) return;
    const details = openDetails();
    if (!details) return;
    // An open confirmation, dropdown or menu, in the form or elsewhere, gets the Esc; the form stays open.
    const popups = [...document.querySelectorAll('[role=dialog],[role=alertdialog],[role=menu],[role=listbox]')];
    if (popups.some(p => p.getClientRects().length > 0)) return;
    close(details);
  });
})();
