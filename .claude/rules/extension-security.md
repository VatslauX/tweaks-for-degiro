---
paths:
  - "extension/**/*"
  - "tests/unit/**/*.test.js"
---

# Extension security and store invariants

These are store-review and user-safety requirements. Do not loosen them:

- Permissions are only `["storage"]`; do not add `host_permissions`, `web_accessible_resources`, or `externally_connectable`. Content scripts match only `https://trader.degiro.nl/trader/*` in the top frame.
- No `eval`, `new Function`, string timers, remote URLs, injected `<script>`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, or `postMessage`. `fetch` uses only same-origin paths starting with a single `/`.
- No `console.log`, `console.info`, or `console.debug`; never store or log the DEGIRO session id.
- `innerHTML` may only be assigned `''`. Build DOM with `createElement` and text nodes. Do not use `insertAdjacentHTML`, `setHTMLUnsafe`, or `document.write`.
- Never press Confirm, Delete, or submit; never call `requestSubmit()`/`.submit()`, fill order fields, or place, change, or cancel orders. The extension may open forms and press Cancel/×.
- Source in `extension/` is English only (no Cyrillic). Keep `minimum_chrome_version` at 111 or higher.
- Keep the name `Tweaks for DEGIRO (unofficial)`. Every localized description must say “Not affiliated with DEGIRO” and stay within 132 characters.
