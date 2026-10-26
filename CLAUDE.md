# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Unofficial Manifest V3 Chrome extension adding quality-of-life features to the DEGIRO web trader (`https://trader.degiro.nl/trader/`). Plain JS, no bundler, no runtime dependencies; type-checked with `tsc --noEmit` (JSDoc, `strictNullChecks`) and linted with ESLint. Only `extension/` is shipped; `node_modules` holds dev tools only (Playwright, TypeScript, ESLint, Highcharts 4 for the mock chart).

This is a deliberate choice: what ships is exactly the source. Don't add a build step, TypeScript files or a framework. Revisit (TS + esbuild, or WXT) only for a Firefox build, runtime npm packages / a UI framework, or a much larger codebase.

## Commands

```
npm install                 # test tools only
npx playwright install chromium  # once; e2e tests fail without it
npm test                    # typecheck + lint + unit + e2e
npm run typecheck           # tsc per world: tsconfig.isolated.json, tsconfig.page.json, tsconfig.options.json
npm run lint                # eslint . (mistakes only: undefined names, unused code; no style rules)
npm run test:unit           # node --test tests/unit/*.test.js
npm run test:e2e            # playwright test
npm run build               # dist/tweaks-for-degiro-<manifest version>.zip (zips extension/ only)
npm run store-images        # dist/store/: store screenshots and promo tiles (needs the real shots, see scripts/store-images.spec.js)

node --test tests/unit/static.test.js        # one unit file
npx playwright test tests/e2e/bridge.spec.js # one e2e file
npx playwright test -g "adds a Spread row"   # one e2e test by name
```

ESLint globals for the shared scripts (`__dgt`, the `flags.js` names) are listed in `eslint.config.js`. The version lives only in `extension/manifest.json` (`package.json` has none); bump it for releases. CI (`.github/workflows/test.yml`) runs `npm test` under `xvfb-run` on pushes to main and on pull requests.

**Before every commit, run the `update-docs` skill, then the `pre-commit-review` skill.** `update-docs` updates README, CHANGELOG, CLAUDE.md, PRIVACY and STORE_LISTING to match the change; `pre-commit-review` checks the change against the safety, store, load and robustness rules, runs `npm test`, and must have no P1 findings left before committing.

## Architecture

**Two execution worlds** (see `manifest.json` `content_scripts`):
- **Isolated world**: `common-isolated.js`, `flags.js`, `content.js` (spread row and header spread), `exdiv.js`, `compact.js`, `hide.js`, `adjust-close.js`, `orders-table.js`, `status.js`. These can use `chrome.storage`.
- **Page world (`world: "MAIN"`)**: `common.js`, `chart-select.js`, `orders.js`, `period.js`, `portfolio.js`. Highcharts features act only on `__dgt.mainChart()` (the largest visible chart with a price series). They need `window.Highcharts` and the page's DEGIRO session, but cannot access `chrome.*`.
- Each world has its own tsc project whose `files` must match the manifest list (a unit test checks this), so using `chrome.*` or `dgSettings` in the page world fails `npm run typecheck`.

**Shared code** (`common.js`, exposed as the frozen global `__dgt`; `common-isolated.js` is an identical copy because Chrome injects a file once per page; edit `common.js`, then `npm run sync-common`):
- `SEL` / `LABELS` / `page`: every DEGIRO selector, label pattern and route the extension relies on. Add new ones here, not in feature files.
- `feature({ name, enabled, run, stop?, every?, throttle? })`: the scheduler. One MutationObserver and one timer per world run each enabled feature at most once per frame, and DOM-driven runs at most every 150 ms unless the feature sets its own `throttle` (settings changes bypass it); the isolated world ignores mutations inside `.highcharts-container` (chart hover); timer-only flushes run only features whose `every` is due; `stop()` runs once when it is switched off. `run()` must be idempotent and returns a status (`ok`/`idle`/`missing`); exceptions are contained per feature. Mark every inserted element with `own(el)` (`data-dg-own`) so the extension's own DOM changes don't trigger runs. Settings changes reach both worlds through the `data-dg-tweaks` attribute mutation.
- **Status**: page-world statuses go to the isolated world through the `data-dg-status` attribute (the page can write it, so `status.js` accepts only known names and values); `status.js` answers the popup via `chrome.runtime.onMessage`. Nothing is stored.

**Translations** (`_locales/<lang>/messages.json`, `default_locale: en`; the manifest description is `__MSG_extDescription__`, the name stays English): every visible text goes through `__dgt.t(key, ...subs)` (`$1`…`$9` placeholders) or, in `options.html`, a `data-i18n="key"` attribute. The page world has no `chrome.i18n`, so the isolated world copies the keys in `PAGE_TEXTS` (common.js) to the `data-dg-i18n` attribute; add a key there when a MAIN-world script needs it. Those texts can be set by the page, so they are only ever used as `textContent`/`title`. `tests/unit/i18n.test.js` checks every language has the same keys and placeholders and that no key is unused; adding a language also needs its "not affiliated" phrase in `tests/unit/manifest.test.js`. E2E tests run in English (`lang` fixture option, `--lang`); the German test is skipped on macOS, where Chromium ignores `--lang`.

**Feature flags** (`flags.js`): `DG_DEFAULTS` defines every flag; values are stored in `chrome.storage.sync`, run through `dgSanitize` (malformed → defaults), and delivered to isolated-world scripts via `dgOnSettings(fn)` (called immediately and on every change). `flags.js` is also loaded by `options.html`. Page-world scripts get flags only through the `data-dg-tweaks` JSON attribute on `<html>`, which contains **only** the keys in `DG_PAGE_FLAGS`, because the page can read it. Adding a flag for a MAIN-world script means adding it to `DG_PAGE_FLAGS` *and* updating `tests/e2e/bridge.spec.js`, which asserts the exact key set. Settings changes must apply live, without a reload. When the extension is disabled, removed or updated, the scripts already in a tab keep running; `flags.js` notices (`chrome.runtime.id` gone, checked every 2 s) and switches every flag off, which stops both worlds (`tests/e2e/disable.spec.js` toggles it on `chrome://extensions`).

**Orders** (`orders.js`): gets `sessionId`/`intAccount` by watching DEGIRO's own resource requests (PerformanceObserver). Fallback, only if none is seen after 5 s and at most once a minute: `/login/secure/config` (`data.sessionId`) and `/pa/secure/client?sessionId=` (only `data.intAccount` is read; the rest is personal data, see PRIVACY.md). A 401/403 marks that session as rejected (never accepted again, from DEGIRO's URLs or the fallback) and delays the next request (20 s, doubling to 5 min); the extension's own request URLs are ignored by the session watcher. `portfolio.js` retries a failed value request after 30 s, doubling. It then polls the same-origin `/trading/secure/v5/update/{acc};jsessionid={sid}?orders=0` every 20 s. The response holds lists of `{name, value}` pairs. Clicking a badge finds the matching row in DEGIRO's Outstanding orders panel (`tr[data-name=openOrder]`): by the order id in the cells' `data-id`, else side (`buySellBadge[data-action]`), size, price and full product name (a shortened name only if exactly one row fits), and opens DEGIRO's own Adjust order form. The panel is minimised when `panelToggleButton` has a `data-value` other than `opened`.

**Product header**: the period change, header spread and ex-div date go into one shared, wrapping `[data-dg-header]` container right after DEGIRO's price line, ordered by `data-dg-rank`; each script removes only its own item and the container when empty.

**DOM robustness**: scripts find DEGIRO elements by text and structure, and prefer DEGIRO's `data-field`/`data-name` hooks (e.g. `BidPrice`/`AskPrice`), with label text in several languages as a fallback (all in `SEL`/`LABELS` in `common.js`). They parse both `1.234,56` and `1,234.56` number formats and re-apply after DEGIRO re-renders (the scheduler). Styling copies DEGIRO's palette and fonts.

## Security invariants (enforced by `tests/unit/`)

These are store-review and safety requirements. Do not loosen them:
- Permissions are only `["storage"]`: no `host_permissions`, `web_accessible_resources` or `externally_connectable`. Content scripts match only `https://trader.degiro.nl/trader/*`, top frame only.
- No `eval`/`new Function`/string timers, no remote URLs or injected `<script>`, and `fetch` only to same-origin paths starting with `/`.
- No `console.log/info/debug`, no `postMessage`, and the session id is never stored.
- `innerHTML` may only be assigned `''`. Build DOM with `createElement`/text nodes (see `tests/e2e/xss.spec.js`). No `insertAdjacentHTML`/`document.write`.
- The extension never presses Confirm/Delete/submit. It only opens forms or presses Cancel/×. It never places, changes or cancels orders.
- Source in `extension/` is English only (no Cyrillic) and the manifest keeps `minimum_chrome_version` ≥ 111.
- Name must stay `Tweaks for DEGIRO (unofficial)`, and the description must say "Not affiliated with DEGIRO" in every language (≤132 chars).

## E2E tests

`tests/e2e/fixtures.js` launches persistent Chromium (`--headless=new`) with the unpacked extension and routes **all** `trader.degiro.nl` requests to the local mock `tests/fixtures/degiro.html` (Highcharts served from `node_modules`, orders endpoint answered from the `orders` option). Tests never touch the real DEGIRO. Fixtures: `degiro({ orders, url, initScript, respond })` → `{ page, calls }` (`respond(url)` can return `route.fulfill` options, e.g. a 401, or `'hang'` to never answer), mock switches set in `initScript`: `__MOCK_NO_URL_SESSION`, `__MOCK_MAIN_SECTION` (real product layout: one `mainPageSection`), `__MOCK_NO_HOOKS` (order rows without hooks), `__MOCK_SIDES` / `__MOCK_PANEL_LABELS` (localised panel), `__MOCK_TICK_MS` (live price ticker), `settings()` opens `options.html`, `setFlag(page, key, on)` toggles a flag through the UI. Tests run serially (`workers: 1`). When a feature depends on new DEGIRO DOM, extend the mock to match.
