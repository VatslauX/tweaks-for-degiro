---
paths:
  - "extension/**/*"
  - "tests/unit/**/*.test.js"
---

# Extension security and store invariants

These are store-review and user-safety requirements. Do not loosen them:

- Permissions are only `["storage", "alarms"]` (neither shows an install warning). The only optional ones are `notifications` and the hosts `https://query1.finance.yahoo.com/*` and `https://sgbeurs.nl/*` (Société Générale's quotes of its own products; added 2026-11-18 at the user's request), requested together from the settings page when the user switches on *Check in the background* and removed when it is switched off. Do not add `host_permissions`, other optional permissions, `web_accessible_resources`, or `externally_connectable`. Content scripts match only `https://trader.degiro.nl/trader/*` in the top frame.
- No `eval`, `new Function`, string timers, remote code, injected `<script>`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, or `postMessage`. Content scripts `fetch` only same-origin paths starting with a single `/`. The one exception is `background.js`: it fetches only `https://query1.finance.yahoo.com/v8/finance/{chart,spark}…` and, as a fallback when a ticker doesn't match, `…/v1/finance/search?q=<ISIN>`, with `credentials: 'omit'`. For Société Générale's products (DEGIRO's SCG venue) it fetches only `https://sgbeurs.nl/EmcWebApi/api/Products/ValuesForWatchlist/<ISIN>` and `…/RealtimeValuesSnapshot/<id>?<the six fields SG's page sends>` (`R.sgSnapshotPath`; its firewall refuses any other shape, and the extension never fakes headers to get past it), also with `credentials: 'omit'`. It sends nothing but ticker symbols, those ISINs and SG's own product fields, and runs only while the opt-in setting and both permissions are on. Its only `importScripts` is `alarm-rules.js`. `tests/unit/static.test.js` lists each allowed address.
- No `console.log`, `console.info`, or `console.debug`; never store or log the DEGIRO session id.
- `innerHTML` may only be assigned `''`. Build DOM with `createElement` and text nodes. Do not use `insertAdjacentHTML`, `setHTMLUnsafe`, or `document.write`.
- Never press Confirm, Delete, or submit; never call `requestSubmit()`/`.submit()`, fill order fields, or place, change, or cancel orders. The extension may open forms and press Cancel/×.
- Source in `extension/` is English only (no Cyrillic). Keep `minimum_chrome_version` at 111 or higher.
- Keep the name `Tweaks for DEGIRO (unofficial)`. Every localized description must say “Not affiliated with DEGIRO” and stay within 132 characters.
