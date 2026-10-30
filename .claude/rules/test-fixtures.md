---
paths:
  - "tests/integration/**/*.js"
  - "tests/e2e/**/*.js"
  - "tests/fixtures/**/*.html"
---

# Integration and E2E test fixtures

## Integration tests

`tests/integration/*.test.js` run the real isolated-world scripts in manifest order against mock pages in JSDOM, without a browser. `tests/integration/harness.js` provides:

- `createWorld({ storage })` creates one browser profile. `chrome.storage.sync/local` is shared across tabs, values are JSON-copied, `onChanged` is asynchronous, and `world.latency`, `world.faults`, and `world.log` support timing, failure, and write assertions.
- `world.open({ fixture, hash, settings, lang, globals })` returns a tab. `globals` supplies fixture switches and data such as `__TX`, `__ORDERS`, and `__MOCK_*`. Fixture inline scripts run before extension scripts.
- Tab helpers include `tab.setPrice`, `tab.go(hash)`, `tab.setFlag(key, on)`, `tab.run(code)`, `tab.json(expr)`, `tab.owned()`, and `world.set(area, items)`.
- `Date`, timers, and `requestAnimationFrame` share a virtual clock. Use `world.advance(ms)` to run timers, frames, promises, and storage events in order; `world.skip(ms)` to jump time; `world.flush()`/`tab.flush()` to settle work due now. Check `world.errors` is empty.
- To prove a test fails without a change, point `DGT_EXTENSION_DIR` at a scratch copy of `extension/`; never deliberately break the working source tree.
- JSDOM has no layout. Use Playwright E2E tests for sizes, visibility, sticky header choice, sidebar fit, menu clamping, computed colors, and options-page layout. Use integration tests for logic across inputs, tabs, races, and time. Extend fixtures when a feature relies on new DEGIRO DOM.

## E2E tests

`tests/e2e/fixtures.js` launches persistent Chromium (`--headless=new`) with the unpacked extension and routes all `trader.degiro.nl` requests to local mocks. Tests do not touch the real DEGIRO site.

- Each worker reuses one browser for up to 10 tests (`REUSE`; a launch costs about 0.5 s, and a new profile keeps `chrome.storage.sync` under its write quota). Between tests the fixture closes every tab, removes routes and cookies, and clears the extension's sync and local storage. A failed test discards its browser. A test that changes the browser itself (for example switching the extension off) uses `test.use({ freshBrowser: true })`. `lang` is a worker option: set it with a top-level `test.use({ lang })` in its own file.
- The fake clock (`degiro({ clock: true })`) reaches page-world timers only. Isolated-world timers and `AbortSignal.timeout` run in real time; a test can route `AbortSignal.timeout` through `setTimeout` in an `initScript`. The product fixture is `tests/fixtures/degiro.html`, with Highcharts from `node_modules` and the orders endpoint answered from the `orders` option.

- **Wait for conditions, not guessed durations.** Use Playwright's auto-waiting assertions (`await expect(locator)...`) for UI state and `expect.poll(async () => ...)` for state that has no locator. Do not use `page.waitForTimeout()` just to give the page or extension time to update. For timer-driven behavior, prefer Playwright's clock or the integration harness's virtual clock. Keep real-time delays only when elapsed time itself is under test (for example, performance sampling or a deliberate input cadence); document why the delay is needed. Assertion and test timeouts are upper bounds for failure, not substitutes for a condition.

- `degiro({ orders, url, initScript, respond })` returns `{ page, calls }`. `respond(url)` can return `route.fulfill` options (for example a 401) or `'hang'`.
- Product mock switches: `__MOCK_NO_URL_SESSION`, `__MOCK_MAIN_SECTION`, `__MOCK_NO_HOOKS`, `__MOCK_SIDES`, `__MOCK_PANEL_LABELS`, `__MOCK_TICK_MS`, `__MOCK_NOT_FAVOURITE`, `__MOCK_ORDER_PANEL`, and `__MOCK_PRICE_DASH` (the price cell shows a dash before the first read). It also has a sticky header copy via `window.__stickyHeader(on)` and `window.__setPrice(id, v)`.
- Other pages use query switches: `?mock=orders`; `?mock=favourites` with `window.__setPrice`, `window.__showList`, `__MOCK_NO_TITLE`, `__MOCK_PRICES`, and `__MOCK_STICKY_QUERY` (DEGIRO's router: the query stays sticky inside `#/favourites…`, empty values are dropped; adds list links); `?mock=transactions` with `__MOCK_TX_LABELS`, `__MOCK_MORE_PAGES`, `__MOCK_NO_TX_TOTAL`, `__MOCK_NO_TX_FEE`, `__MOCK_TX_HEADERS`, `__MOCK_CALENDAR`, and `__MOCK_PANEL_CLOSED`. The transactions mock includes a second `[data-name=transactions]` mini list before the main table. The portfolio mock rebuilds its chart on in-app navigation and greys the line right of the cursor.
- Mocks include DEGIRO's left sidebar. `settings()` opens `options.html`; `setFlag(page, key, on)` toggles a setting through the UI. Playwright runs up to four workers (`workers: 4`). Extend the mock when a feature depends on new DEGIRO DOM.
