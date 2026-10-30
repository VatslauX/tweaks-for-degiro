# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Unofficial Manifest V3 Chrome extension adding quality-of-life features to the DEGIRO web trader (`https://trader.degiro.nl/trader/`). Plain JS, no bundler, no runtime dependencies; type-checked with `tsc --noEmit` (JSDoc, `strictNullChecks`) and linted with ESLint. Only `extension/` is shipped; `node_modules` holds dev tools only (Playwright, TypeScript, ESLint, Highcharts 4 for the mock chart).

This is a deliberate choice: what ships is exactly the source. Don't add a build step, TypeScript files or a framework. Revisit (TS + esbuild, or WXT) only for a Firefox build, runtime npm packages / a UI framework, or a much larger codebase.

## Commands

```
npm install                 # test tools only
npx playwright install chromium  # once; e2e tests fail without it
npm test                    # typecheck + lint + unit + integration + e2e
npm run typecheck           # tsc per world: tsconfig.isolated.json, tsconfig.page.json, tsconfig.options.json
npm run lint                # eslint . (mistakes only: undefined names, unused code; no style rules)
npm run test:unit           # node --test tests/unit/*.test.js
npm run test:integration    # node --test tests/integration/*.test.js (content scripts in JSDOM, no browser, ~6 s)
npm run test:e2e            # playwright test
npm run test:report         # agents: same stages, one structured JSON summary (scope: -- unit | -- integration | -- tests/e2e/x.spec.js | -- -g "name")
npm run build               # dist/tweaks-for-degiro-<manifest version>.zip (zips extension/ only)
npm run store-images        # dist/store/: store screenshots and promo tiles (needs the real shots, see scripts/store-images.spec.js)

node --test tests/unit/static.test.js        # one unit file
node --test tests/integration/alarms.test.js # one integration file
npx playwright test tests/e2e/bridge.spec.js # one e2e file
npx playwright test -g "adds a Spread row"   # one e2e test by name
```

**The main session runs tests through the `run-tests` skill** (Haiku, own context, background; scope as its argument, e.g. `unit`, `tests/e2e/bridge.spec.js`, `-g "adds a Spread row"`) and gets the structured result: overall `ok`, per stage (typecheck, lint, unit, e2e) passed/failed/skipped and duration, each failure with `file:line`, title and trimmed error lines, and the command run. **Sub-agents and forked skills (`review`, bug-fix sub-agents) don't use the skill**: a background skill or sub-agent started from a sub-agent reports to the main session once the caller's turn ends, not to the caller. They run `npm run --silent test:report -- <scope>` directly with Bash (`run_in_background: true`, `timeout: 600000`; same JSON, exit code non-zero on any failure) and wait for the shell's own completion notification. The full suite takes about 3 minutes (3 parallel Playwright workers): run it in the background and wait for the notification, never poll. `npm test` stays the command for CI and humans (it stops at the first failing stage; `test:report` runs every stage in scope).

ESLint globals for the shared scripts (`__dgt`, the `flags.js` names) are listed in `eslint.config.js`. The version lives only in `extension/manifest.json` (`package.json` has none); bump it for releases. CI (`.github/workflows/test.yml`) runs `npm test` under `xvfb-run` on pushes to main and on pull requests.

**Bug fixes run in a sub-agent.** When a bug is identified and clear (a user report, a review finding, a failing test), spawn a fresh sub-agent to find the root cause and fix it, with a test that fails without the fix. Don't fix it inline. Give the sub-agent the symptom, where it shows, what it must not touch (files other work is changing; on the real DEGIRO page: read-only, never log in, never close tabs), and the deliverable (cause, files changed, test results from `npm run --silent test:report`).

**After every development task** (any change to `extension/`, `tests/` or `scripts/`), check it with the `run-tests` skill (in a sub-agent: `npm run --silent test:report` with Bash), then run the `review` skill before reporting the work as done, then fix its P1 findings. **Before every commit, run the `update-docs` skill, then `review` again.** `update-docs` updates README, CHANGELOG, CLAUDE.md, PRIVACY and STORE_LISTING to match the change; `review` runs in its own sub-agent with a fresh context (`context: fork` in its frontmatter), so it judges the change only from the diff and the files. It checks the change against the safety, store, load and robustness rules, runs the tests with `npm run test:report`, and reports without editing; there must be no P1 findings left before committing.

## Layout

```
extension/          the shipped extension (only this folder is zipped)
tests/unit/         static checks: manifest, permissions, no eval/remote code/innerHTML, i18n, cws-publish
tests/integration/  the real isolated-world content scripts in JSDOM on the mock pages (harness.js: fake browser profile, virtual clock)
tests/e2e/          Playwright: real Chromium with the extension loaded
tests/fixtures/     mock of trader.degiro.nl (Highcharts 4 chart, orders panel, Adjust order form, product header with star and Buy/Sell, Favourites list)
scripts/            build.js (zip), cws-publish.js (store upload), store-images (store screenshots), test-report.js (structured test summary)
.github/workflows/  test.yml (CI), release.yml (v* tags), cws-auth-check.yml (manual)
PRIVACY.md          privacy policy (public URL for the store); STORE_LISTING.md: dashboard answers
```

Files in `extension/`, one feature each unless noted:

| File | Purpose |
|---|---|
| `common.js` | Shared code loaded first in both worlds (`SEL`/`LABELS`/`page`, number parsing, theme, main chart, scheduler); `common-isolated.js` is its copy |
| `flags.js` | Feature flags: defaults, storage, bridge to the page world |
| `options.html/.css/.js` | Settings page (toolbar popup and Extension options) |
| `_locales/*/messages.json` | Translations, store summary included |
| `content.js` | Bid/ask spread row and header spread |
| `exdiv.js` | Ex-dividend date in the header |
| `compact.js` | Compact Pricing data |
| `hide.js` | Hides sections listed in Settings |
| `ui.js` | Shared UI for `orders-table.js` and the alarm scripts (`alarms.js`, `alarm-panel.js`, `alarms-page.js`): chips, multi-select picker, icons, theme colours (global `dgUi`) |
| `orders-table.js` | Orders → Outstanding and Transactions: filters, totals and the column picker (an owned `<style>` hides columns and widens Product); uses `ui.js` |
| `alarm-rules.js` | Price alarms, pure rules: sanitising, limits (25 alarms, texts capped for the 8 KB sync item), direction, `decide` (global `dgAlarmRules`, unit-tested) |
| `alarms.js` | Price alarms: storage, price detection and banners (global `dgAlarmStore`) |
| `alarm-panel.js` | Price alarms: Alarm button (after Sell, in each copy of the product header, favourites only) and the *Set price alarm* panel; also *Edit price alarm* for one alarm (global `dgAlarmPanel.edit(alarm)`, used by `alarms-page.js`; `dgAlarmStore.update` saves in place and clears the fired state) |
| `alarms-page.js` | Price alarms: the Alarms page at `#/favourites?dg=alarms`, drawn in place of the hidden Favourites list (DEGIRO keeps it updating); each row has an Edit button |
| `nav.js` | Orders and Transactions links and the Alarms item (with a count of open banners) in the left sidebar; on the Alarms page DEGIRO's Favourites loses its current class |
| `adjust-close.js` | Click outside or Esc closes *Adjust order* |
| `status.js` | Answers the popup's "On this page" status |
| `chart-select.js` | Chart range selection (page world) |
| `period.js` | Change for the selected period (page world) |
| `portfolio.js` | Portfolio chart: period change and range selection (page world) |
| `orders.js` | Open orders on the chart, click-to-edit (page world) |

## Releasing

Before tagging, run the `release` skill (main session): preflight, full tests, a read-only drift check of selectors and styles on the real DEGIRO page, mock parity, then a go/no-go report; it never pushes the tag. Bump `version` in `extension/manifest.json`, add the CHANGELOG entry, commit and push, then push a tag `v<version>` (only the user decides when; ordinary pushes never release). `.github/workflows/release.yml` runs `npm test` in a job without credentials, then a separate job builds the zip, gets a short-lived Google token through Workload Identity Federation (`google-github-actions/auth`, service account `cws-release` in GCP project `tweaks-for-degiro-release`; repo variables `GCP_WIF_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `CWS_PUBLISHER_ID`, `CWS_ITEM_ID`; no stored key) and runs `scripts/cws-publish.js` (Chrome Web Store API v2: upload, poll `:fetchStatus`, `:publish` = submit for review), then creates a GitHub Release with the zip. The script fails before uploading if the tag isn't `v` + manifest version and never publishes after a failed upload (`tests/unit/cws-publish.test.js`, fake `fetch`). Google's provider accepts only this repo (by ID) on `main` or `v*` tags. `cws-auth-check.yml` (run by hand from main) signs in the same way and only reads the item's status. `scripts/` is Node tooling: the `extension/` rules (same-origin `fetch`, no `console.log`) don't apply there.

## Architecture

**Two execution worlds** (see `manifest.json` `content_scripts`):
- **Isolated world**: `common-isolated.js`, `flags.js`, `content.js` (spread row and header spread), `exdiv.js`, `compact.js`, `hide.js`, `adjust-close.js`, `ui.js`, `orders-table.js`, `alarm-rules.js`, `alarms.js`, `alarm-panel.js`, `alarms-page.js`, `nav.js`, `status.js`. These can use `chrome.storage`.
- **Page world (`world: "MAIN"`)**: `common.js`, `chart-select.js`, `orders.js`, `period.js`, `portfolio.js`. Highcharts features act only on `__dgt.mainChart()` (the largest visible chart with a price series). They need `window.Highcharts` and the page's DEGIRO session, but cannot access `chrome.*`.
- Each world has its own tsc project whose `files` must match the manifest list (a unit test checks this), so using `chrome.*` or `dgSettings` in the page world fails `npm run typecheck`.

**Shared code** (`common.js`, exposed as the frozen global `__dgt`; `common-isolated.js` is an identical copy because Chrome injects a file once per page; edit `common.js`, then `npm run sync-common`):
- `SEL` / `LABELS` / `page`: every DEGIRO selector, label pattern and route the extension relies on. Add new ones here, not in feature files.
- `feature({ name, enabled, run, stop?, every?, throttle? })`: the scheduler. One MutationObserver and one timer per world run each enabled feature at most once per frame, and DOM-driven runs at most every 150 ms unless the feature sets its own `throttle` (settings changes bypass it); the isolated world ignores mutations inside `.highcharts-container` (chart hover); timer-only flushes run only features whose `every` is due; `stop()` runs once when it is switched off. `run()` must be idempotent and returns a status (`ok`/`idle`/`missing`); exceptions are contained per feature. Mark every inserted element with `own(el)` (`data-dg-own`) so the extension's own DOM changes don't trigger runs. Settings changes reach both worlds through the `data-dg-tweaks` attribute mutation.
- **Status**: page-world statuses go to the isolated world through the `data-dg-status` attribute (the page can write it, so `status.js` accepts only known names and values); `status.js` answers the popup via `chrome.runtime.onMessage`. Nothing is stored.

**Translations** (`_locales/<lang>/messages.json`, `default_locale: en`; the manifest description is `__MSG_extDescription__`, the name stays English): every visible text goes through `__dgt.t(key, ...subs)` (`$1`…`$9` placeholders) or, in `options.html`, a `data-i18n="key"` attribute. The page world has no `chrome.i18n`, so the isolated world copies the keys in `PAGE_TEXTS` (common.js) to the `data-dg-i18n` attribute; add a key there when a MAIN-world script needs it. Those texts can be set by the page, so they are only ever used as `textContent`/`title`. `tests/unit/i18n.test.js` checks every language has the same keys and placeholders and that no key is unused; adding a language also needs its "not affiliated" phrase in `tests/unit/manifest.test.js`. E2E tests run in English (`lang` fixture option, `--lang`); the German test is skipped on macOS, where Chromium ignores `--lang`.

**Feature flags** (`flags.js`): `DG_DEFAULTS` defines every flag; values are stored in `chrome.storage.sync`, run through `dgSanitize` (malformed → defaults), and delivered to isolated-world scripts via `dgOnSettings(fn)` (called immediately and on every change). `flags.js` is also loaded by `options.html`. Page-world scripts get flags only through the `data-dg-tweaks` JSON attribute on `<html>`, which contains **only** the keys in `DG_PAGE_FLAGS`, because the page can read it. Adding a flag for a MAIN-world script means adding it to `DG_PAGE_FLAGS` *and* updating `tests/e2e/bridge.spec.js`, which asserts the exact key set. Settings changes must apply live, without a reload. When the extension is disabled, removed or updated, the scripts already in a tab keep running; `flags.js` notices (`chrome.runtime.id` gone, checked every 2 s) and switches every flag off, which stops both worlds (`tests/e2e/disable.spec.js` toggles it on `chrome://extensions`).

**Orders** (`orders.js`): gets `sessionId`/`intAccount` by watching DEGIRO's own resource requests (PerformanceObserver). Fallback, only if none is seen after 5 s and at most once a minute: `/login/secure/config` (`data.sessionId`) and `/pa/secure/client?sessionId=` (only `data.intAccount` is read; the rest is personal data, see PRIVACY.md). A 401/403 marks that session as rejected (never accepted again, from DEGIRO's URLs or the fallback) and delays the next request (20 s, doubling to 5 min); the extension's own request URLs are ignored by the session watcher. `portfolio.js` retries a failed value request after 30 s, doubling. It then polls the same-origin `/trading/secure/v5/update/{acc};jsessionid={sid}?orders=0` every 20 s. The response holds lists of `{name, value}` pairs. Clicking a badge finds the matching row in DEGIRO's Outstanding orders panel (`tr[data-name=openOrder]`): by the order id in the cells' `data-id`, else side (`buySellBadge[data-action]`), size, price and full product name (a shortened name only if exactly one row fits), and opens DEGIRO's own Adjust order form. The panel is minimised when `panelToggleButton` has a `data-value` other than `opened`.

**Price alarms** (`priceAlarms` flag, isolated world only, so not in `DG_PAGE_FLAGS`): prices are read from the DOM only, with no requests: the Favourites list (`LastPrice`) and the product page (`CurrentPrice`); alarms are checked only while one of them is open. Storage: `chrome.storage.sync` `dgAlarms` (the alarm list, max 25, follows the Chrome profile); `chrome.storage.local` `dgAlarmState` (last seen price and time, last fired) and `dgAlarmEvents` (open banners), this browser only. "Armed" (for *Every time*) is each tab's own memory and never stored. Cross-tab rule: when another tab fired the alarm within 60 s (the same local day for *Once a day*), this tab doesn't fire it again. Two tabs crossing within the same few ms may both write (a read-then-write race `chrome.storage` can't prevent); one event is kept. Banners show in every DEGIRO tab; `nav.js` counts them on the Alarms item, which shows only while `navLinks` and `priceAlarms` are both on.

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

## Integration tests

`tests/integration/*.test.js` (`node --test`, about 3 s for the lot) run the real isolated-world scripts, in manifest order, against the mock pages in JSDOM, with no browser. `harness.js` fakes the browser around them:
- `createWorld({ storage })` is one browser profile: `chrome.storage.sync/local` shared by all its tabs (JSON-copied values, `onChanged` delivered asynchronously to every tab with `{oldValue,newValue}`; `world.latency.set/get` in virtual ms and `world.faults.set/get` to test races and refusals; `world.log` lists every write that changed something), `chrome.i18n` from the real `_locales`, `chrome.runtime.id` (`tab.disableExtension()` removes it). `world.open({ fixture, hash, settings, lang, globals })` returns a tab; `globals` are the mocks' switches and data (`__TX`, `__ORDERS`, `__MOCK_*`). The mock page's own inline scripts run first, then the extension's. Helpers: `tab.setPrice`, `tab.go(hash)`, `tab.setFlag(key, on)`, `tab.run(code)` / `tab.json(expr)` (evaluate in the tab's script scope, where `dgAlarmStore`, `dgSettings`, `__dgt` live), `tab.owned()`, `world.set(area, items)` (a write from another context).
- **Virtual clock**: `Date`, `setTimeout`/`setInterval` and `requestAnimationFrame` of all tabs of a world run on one clock; nothing waits for real time. `await world.advance(ms)` runs timers, frames, promises and storage events in order; `world.skip(ms)` jumps (overdue timers run once: a night, a sleeping laptop); `world.flush()` / `tab.flush()` settles what is due now without moving time (throttled runs need `advance`). `world.errors` collects uncaught errors from scripts and timers; assert it is empty.
- Proving a test: `DGT_EXTENSION_DIR` points the harness at a scratch copy of `extension/` so a test can be run against deliberately broken code (never edit `extension/` for that).
- jsdom has no layout, so sizes, visibility, sticky header choice, sidebar fit, menu clamping, computed colours and the options page stay in the Playwright tests. Use integration tests for logic over many inputs, several tabs sharing storage, races and time (days, throttles); extend a mock page when a feature depends on new DEGIRO DOM, as for e2e.

## E2E tests

`tests/e2e/fixtures.js` launches persistent Chromium (`--headless=new`) with the unpacked extension and routes **all** `trader.degiro.nl` requests to the local mock `tests/fixtures/degiro.html` (Highcharts served from `node_modules`, orders endpoint answered from the `orders` option). Tests never touch the real DEGIRO. Fixtures: `degiro({ orders, url, initScript, respond })` → `{ page, calls }` (`respond(url)` can return `route.fulfill` options, e.g. a 401, or `'hang'` to never answer), mock switches set in `initScript`: `__MOCK_NO_URL_SESSION`, `__MOCK_MAIN_SECTION` (real product layout: one `mainPageSection`), `__MOCK_NO_HOOKS` (order rows without hooks), `__MOCK_SIDES` / `__MOCK_PANEL_LABELS` (localised panel), `__MOCK_TICK_MS` (live price ticker), `__MOCK_NOT_FAVOURITE` (star not filled), `__MOCK_ORDER_PANEL`; the product mock has a header with star, Buy/Sell and a sticky header copy (`window.__stickyHeader(on)`) and `window.__setPrice(id, v)`; more pages by query: `?mock=orders` (`tests/fixtures/orders.html`), `?mock=favourites` (`favourites.html`, `window.__setPrice(id, v)`, `window.__showList(name)`, switches `__MOCK_NO_TITLE`, `__MOCK_PRICES`), `?mock=transactions` (`transactions.html`, switches `__MOCK_TX_LABELS`, `__MOCK_MORE_PAGES`, `__MOCK_NO_TX_TOTAL`, `__MOCK_NO_TX_FEE`, `__MOCK_TX_HEADERS`, `__MOCK_CALENDAR`, `__MOCK_PANEL_CLOSED` leaves out the upper panel's "Latest Transactions" mini list, a second `[data-name=transactions]` that comes first in the document and is present by default), the portfolio mock (rebuilds its chart on in-app navigation and greys the line right of the cursor, like DEGIRO); the mocks carry DEGIRO's left sidebar (100vh flex column), `settings()` opens `options.html`, `setFlag(page, key, on)` toggles a flag through the UI. Tests run serially (`workers: 1`). When a feature depends on new DEGIRO DOM, extend the mock to match.
