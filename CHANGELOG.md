# Release notes

## 1.19.1 — 2026-10-26
- **Switching the extension off stops it in open tabs.** Disabling, removing or updating the extension used to leave its scripts running in DEGIRO tabs until they were reloaded, still asking DEGIRO for your orders every 20 s. They now notice within 2 s, stop all requests and remove the badges, header items and rows they added.

## 1.19.0 — 2026-10-24
- **Smoother on chart hover.** Moving the mouse over the price chart no longer makes the extension re-check the page on every frame (118 runs in 2 s before, none now). Page-driven updates are limited to about 6 per second per feature.
- **The range selection survives live prices.** It stays and moves with the chart when the price updates or a new point is added; it is cleared when you pick another period. Its label wraps inside narrow charts, and the result is announced to screen readers.
- **Orders on the chart:**
  - New or cancelled orders show a few seconds after they appear in DEGIRO's *Outstanding* list, instead of up to 20 s later (at most one extra request per change, never more than one per 5 s; expanding or minimising the panel doesn't count).
  - When badges don't fit, they merge into one *N orders* badge, and the ▲/▼ rows show *+N* instead of cutting orders off.
  - Badges can be reached with Tab and opened with Enter or Space, with a screen-reader label such as "Adjust buy order 200 at 14,10".
  - Badges are measured and placed in one pass, and only the price chart gets a badge layer.
- **Product header wraps on narrow screens.** The period change, spread and ex-dividend date share one line that wraps instead of overflowing; spread and period colours follow DEGIRO's dark theme.
- **Popup:** no brief *Not found* while the extension is still loading its data (it waits 8 s after the page opens), and *Loading* no longer sticks.
- Settings page: darker grey text for better contrast.
- Development: mock price ticker and performance tests.

## 1.18.1 — 2026-10-24
- **A stuck DEGIRO request no longer stops updates.** Requests time out after 15 s; open orders then reload on the next poll and the portfolio chart retries after 30 s.
- **Cash compensation is hidden in every DEGIRO language.** The section is recognised by DEGIRO's own hook; the default list also has the Dutch, German and French titles (the Dutch one was misspelled).
- **Click outside closes Adjust order now works in German, French, Spanish, Italian and Portuguese** (DEGIRO's own form titles).
- **Compact Pricing data changes only Pricing data.** On DEGIRO's product page it also tightened Company info, Ratios and Key figures.
- **Less redrawing of order badges:** after a chart redraw they are redrawn only if the chart moved.
- Development: stricter safety tests (no `//host` fetches or unchecked fetch URLs, no `Function()`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `requestSubmit`, `setHTMLUnsafe`; subfolders scanned).

## 1.18.0 — 2026-10-24
- **No request loop after the DEGIRO session expires.** A session DEGIRO rejects is never used again, the next orders request waits 20 s (doubling up to 5 minutes), and the portfolio chart retries a failed value request after 30 s instead of every half second.
- **Hide sections never hides the whole product page.** On DEGIRO's product page all widgets, the chart included, share one section; hiding now stops at the widget with the matching title and never hides a box with prices, a chart or another section's title.
- **Clicking a badge opens the right order.** The order is matched by DEGIRO's order id, then by the full product name, so a similar product (e.g. *(Acc)* and *(Dist)*) with the same size and price can't be opened instead. If a shortened name fits more than one order, nothing opens.
- **Badge click works in every DEGIRO language.** The minimised orders panel is recognised by its state instead of its English label, and the buy/sell side by DEGIRO's hook instead of the letter (K/V, A/V, C/V).
- **DEGIRO's own terms in the texts**, e.g. *Adjust order* (nl *Order aanpassen*, de *Order anpassen*), nl *Prijsdata*, fr *Données de marché*; a store summary that names more of the features.
- **Translations.** The settings popup, the texts the extension adds to DEGIRO's pages and the store summary are now in English, Dutch, German, French, Spanish, Italian and Portuguese, following Chrome's language. Other languages stay English.
- **Open orders keep working if DEGIRO changes how it passes the session.** If DEGIRO's own requests no longer contain the session, the extension asks DEGIRO for it the way the DEGIRO website does. From the client answer only the account number is read. Nothing is stored. Normally this extra request is never made.

## 1.17.1 — 2026-10-24
- **Sturdier on unexpected pages.** Hide sections and the colour detection no longer stop with an error when DEGIRO's page lacks an expected element or colour; the Orders drawer button is checked before it is clicked.
- Development: null checks in the type check, and ESLint for undefined names and unused code (`npm run lint`, part of `npm test`).

## 1.17.0 — 2026-10-24
- **Feature status in the popup.** Opened over a DEGIRO tab, the toolbar popup shows *On this page*: for each feature, *Working*, *Not on this page*, or *Not found — DEGIRO may have changed its page*. Nothing is stored or sent anywhere.
- **Less background work.** All features now share one page observer and one timer per script context instead of one each; chart features react to page changes instead of polling every 0.5–1 s, and settings changes reach them right away.

## 1.16.1 — 2026-10-23
- **Removed: Label the update time.** The *Updated* label next to the timestamp in *Pricing data* and its setting are gone.
- **Portfolio chart respects DEGIRO's "hide values" mode.** When the eye button hides your amounts, the change next to the total and the values in the range selection are blurred the same way, € amounts and percentages alike. Only the dates stay readable.
- **Order badges stay on their own line.** When several orders are close in price, their badges now sit side by side, each centred on its own dashed line. Before, they were pushed up or down, so a badge could sit on another order's line.

## 1.16.0 — 2026-10-23
Internal clean-up (P2.10, P2.9, P2.2 from the review). No visible changes on a standard DEGIRO page.
- **Shared helpers in `common.js`**, loaded first: page theme, feature flags, the main price chart, chart data access, and one number parser and formatter. These used to be copied into 3–4 scripts each.
- **Numbers follow the page's format.** The decimal separator is read from DEGIRO's own price fields: `1.234,56` or `1,234.56`. Before, page-context scripts always wrote Dutch format, and the two parsers disagreed on values like `1.234`.
- **Ready for newer Highcharts:** chart data is read with `getColumn()` when available, falling back to `xData`/`yData` (DEGIRO still uses Highcharts 4.2.1).
- Chrome injects a file only once per page, so the isolated world loads `common-isolated.js`, an exact copy; a test keeps them identical.

## 1.15.3 — 2026-10-23
- **Hide sections:** a section stays hidden only while its title matches. Before, if DEGIRO reused the same page element for another section, that section stayed hidden too. Hiding also no longer reaches a much larger wrapper, such as a whole column.
- **Chart features use only the price chart:** order badges, range selection and the period change now pick the largest visible price chart, so a smaller extra chart on the page can't get badges or be used for the period change.
- **Chrome 111 or newer** is required by the manifest again; a later release had dropped it.

## 1.15.2 — 2026-10-22
- **Pricing data: update-time label fits on one line.** The label is now **Updated** (the full *Latest update time* is in the tooltip), and the label and timestamp no longer wrap. Before, in narrow layouts both wrapped to two lines and pushed the right column one row down (Ask no longer level with Bid).

## 1.15.1 — 2026-10-22
- **Fix: period change was missing for 1W.** DEGIRO's 1W chart contains only the trading days in the window, as intraday points (often about 3 days, not 7). The check that protects against showing the old period's data treated this as "still loading", so the change was never shown. 1W now only needs more than one day of data, which still rules out a 1D chart. Other periods are unchanged.

## 1.15.0 — 2026-10-22
- **Orders → Outstanding: filters and totals.** A panel above DEGIRO's table:
  - **Action:** All / Buy / Sell.
  - **Currency:** multi-select.
  - **Product:** multi-select dropdown with order counts.
  - **Clear filters.**
  - **Totals** for the shown orders: total buy and total sell value per currency, with counts, and "N of M orders".
- Styled like DEGIRO: pill toggles, Buy green and Sell red, with colours taken from DEGIRO's own Action column. Follows the dark theme.
- Rows are only hidden, never changed. Filters survive DEGIRO re-rendering the table. The filters work on the rows of the current page of the table.
- New setting *Filters and totals on Orders* (on by default).

## 1.14.0 — 2026-10-22
Reliability and performance pass (P1 from the code review).
- **Dark theme:** order badges and the range-selection labels on product and portfolio charts take their background and text colours from the page. They are no longer white boxes in DEGIRO's dark theme; up/down colours are brighter there.
- **Period change no longer shows wrong numbers:**
  - the clicked period is remembered;
  - hovering another period button no longer hides or changes it;
  - while the chart is still loading the new period, nothing is shown instead of the new label with the old data.
- **Less background work:**
  - section hiding is batched to once per frame;
  - features that are switched off no longer scan the page;
  - Compact Pricing data doesn't re-read styles on every price tick;
  - the spread safety timer runs every 5 s, only while needed.
- **Range selection uses pointer events** with pointer capture on the chart:
  - works with pen and touch, not only a mouse;
  - coordinates are correct under CSS zoom/scale;
  - no more window listeners left behind for every chart DEGIRO creates (memory leak).
- **Bid/Ask found via DEGIRO's `data-field` hooks** (`BidPrice`/`AskPrice`). The spread, Compact Pricing data and the update-time label now work in any UI language; label text is only a fallback. The Bid/Ask patterns are shared from one place instead of three.

## 1.13.2 — 2026-10-22
- Fixed the Chrome warning *"Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute…"* on the Portfolio page. The extension now copies the portfolio chart into its own canvas (`willReadFrequently`) and reads that, instead of reading DEGIRO's canvas directly. It also reads less often: right after new chart data, then every 10 s.

## 1.13.1 — 2026-10-22
- Fixed: in a narrow window, DEGIRO switches to its mobile layout, which has no bottom orders panel. Clicking an order badge did nothing there. Now the extension opens the *Account overview* drawer, which holds the orders list, and opens *Adjust order* for that order. The drawer stays open while the form is open, because closing it closes the form. A click outside cancels the form and closes the drawer again.

## 1.13.0 — 2026-10-22
- **Ex-dividend date in header:** on share pages, when DEGIRO's *Dividends* section has an ex-dividend date, the header shows `Ex-div 12/11/2026` after the spread. Click it to jump to the Dividends section; the app's route doesn't change. Future dates are blue, past dates grey. On by default; switch it off in Settings.

## 1.12.0 — 2026-10-22
- **Portfolio chart: change for the selected period** next to the total, e.g. `1Y € +29.480,51 (+26,23%)`. It follows the 1M / 3M / YTD / 1Y switcher. The value change includes deposits and withdrawals, which the tooltip explains.
- **Portfolio chart: range selection.** Drag on the portfolio chart to see the € and % change between two dates, with dots on the line, like on product charts.
- Both features use the existing *Change for selected period* and *Range selection* switches.
- The portfolio chart is drawn on a canvas. Values come from the same request DEGIRO makes for the chart (`portfolio-metrics/…/portfolio/value`), and positions from the drawn line.

## 1.11.0 — 2026-10-22
- **Spread in header:** the current bid/ask spread % is shown at the end of the price line, e.g. `€2,69 +0,01 (+0,59%)  1M +0,054 (+2,06%)  Spread 0,07%`. It is colour-coded like the Spread row and updates live. It has its own switch, independent of the Spread row; on by default.
- The Spread row in *Pricing data* now rounds the percentage to two decimals (`0,24%`; was `0,236%`).

## 1.10.0 — 2026-10-22
- **Change for selected period:** when a chart period other than 1D is selected (1W, 1M, 3M, 6M, YTD, 1Y…), the product header shows the change over that period next to DEGIRO's daily change, e.g. `1M +0,054 (+2,06%)`. It is computed from the first and last point of the chart. Green for up, red for down. On by default; switch it off in Settings.

## 1.9.0 — 2026-10-22
- **Label the update time:** the timestamp row in *Pricing data* (next to Latest) had no label. It now shows **Latest update time**, styled like the Ask label. On by default; switch it off in Settings.

## 1.8.1 — 2026-10-22
- **Compact Pricing data** now also tightens the Volume rows and the Symbol | ISIN / Exchange / Shares rows. The whole Pricing data block is about 130 px shorter.
- Fixed: the **Spread** row used a larger font than the other rows. It now copies the font of the Ask row.

## 1.8.0 — 2026-10-22
- **Compact Pricing data:** the gap between the Latest, Bid, Ask… rows shrinks from 12 px to 4 px, so the block is about 55 px shorter. On by default; switch it off in Settings.
- Only the flex columns inside the Pricing data list are changed. Nothing else on the page is affected, and the spacing is re-applied when DEGIRO re-renders the block.

## 1.7.0 — 2026-10-21
Security hardening and Chrome Web Store preparation.
- Renamed to **Tweaks for DEGIRO (unofficial)**. Added a not-affiliated disclaimer, and the DEGIRO homepage link is removed.
- Runs only on `https://trader.degiro.nl/trader/*` and only in the top frame. It used to run on all `*.degiro.com` / `*.degiro.nl` pages and frames.
- The chart selection label is built with text nodes, so page strings can't inject HTML. Fixes a potential XSS via chart month names.
- Only the three chart flags are exposed to the page. The list of hidden sections is no longer shared.
- Settings:
  - input is validated (max 30 titles, 100 characters each)
  - save failures are shown, and the switch reverts
  - malformed stored values fall back to defaults; they used to break section hiding
- Added a privacy policy (`PRIVACY.md`) and Web Store submission notes.
- Added automated tests: static checks and Playwright end-to-end tests against a DEGIRO mock.

## 1.6.1 — 2026-10-21
- **Security:** click outside *Adjust order* now presses only **Cancel**, or the **×** button if Cancel isn't found. The previous fallback that could press any button marked `actionButton` has been removed. If neither button is found, nothing happens.
- Cancel is recognised in English, Dutch, German, French, Spanish, Italian and Polish.

## 1.6.0 — 2026-10-21
- **Settings with feature flags.** Every feature can be switched on or off:
  - bid/ask spread
  - chart range selection
  - open orders on the chart
  - click-to-edit on order badges
  - click-outside closes *Adjust order*
  - hiding sections
- The list of section titles to hide is now editable, so no code changes are needed.
- Settings are available from the **toolbar icon** (popup) and from **Extension options**. Both open the same page.
- Changes apply instantly to open DEGIRO tabs, with no reload.
- Settings are stored with `chrome.storage.sync` and follow your Chrome profile across devices.
- Light and dark appearance, in DEGIRO's colours.
- New extension icon.
- New permission: `storage`. Chrome shows no install warning for it.

## 1.5.0 — 2026-10-21
- English extension description, README and release notes.
- Tooltips translated to English.

## 1.4.0 — 2026-10-21
- **Click-to-edit:** clicking an order badge on the chart opens DEGIRO's *Adjust order* form for that order. If the orders panel is minimised, it is expanded briefly and then minimised again.
- Badges highlight on hover and show a tooltip.
- **Click outside to close:** clicking outside the *Adjust order* panel closes it (same as ×). Confirmation dialogs and menus are ignored.

## 1.3.0 — 2026-10-21
- **Open orders on the chart:** a dashed line at each order price and a badge with side, quantity and price. Buy is green, sell is red.
- Badges sit on the left edge of the chart, so they don't clash with DEGIRO's max/min labels on the right.
- Orders outside the visible price range are stacked in one horizontal row at the top (▲) or bottom (▼).
- Fixed badges drifting off their lines when the lowest order was close to the chart edge. Only overlapping badges are nudged now.
- Badges re-position whenever the price axis or chart size changes (period switch, resize).

## 1.2.0 — 2026-10-21
- **Chart range selection:** drag on the chart to see the % and absolute change between two points, with prices and dates.
- Start and end dots in DEGIRO's marker style: 12 px with a white border, green for up, red for down.
- Selection label styled like DEGIRO's chart tooltip (Inter font, DEGIRO greens and reds).
- The label moves to the bottom when it would cover a dot.

## 1.1.0 — 2026-10-21
- Hides the *Cash compensation* section on the portfolio page.
- Extension renamed to **DEGIRO Tweaks** (renamed again in 1.7.0).

## 1.0.0 — 2026-10-21
- **Bid/ask spread** row in *Pricing data*: absolute and percentage spread, colour-coded and updated live.
- The row is placed at the bottom of the Ask column, so both columns stay aligned.
