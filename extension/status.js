// Feature status for the toolbar popup: which features found what they need on this page.
// Built only when the popup asks for it; nothing is stored or sent anywhere else.
(() => {
  // page-world features report through the data-dg-status attribute, which the page can read
  // and change too, so accept only these names and values
  const PAGE_FEATURES = ['chartSelect', 'orders', 'periodChange', 'portfolio'];
  const VALUES = ['ok', 'idle', 'missing', 'loading', 'off', 'error'];

  function pageStatus() {
    let s = null;
    try { s = JSON.parse(document.documentElement.getAttribute('data-dg-status') || 'null'); } catch (e) {}
    const out = {};
    if (s && typeof s === 'object') for (const k of PAGE_FEATURES) if (VALUES.includes(s[k])) out[k] = s[k];
    return out;
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (sender.id !== chrome.runtime.id || msg?.type !== 'dg-status') return;
    reply({ ...__dgt.status(), ...pageStatus() });
  });
})();
