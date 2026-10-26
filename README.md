# Tweaks for DEGIRO (unofficial)

A small Chrome extension that adds the features missing from the DEGIRO web trader (trader.degiro.nl). The extra elements are styled to match DEGIRO's own fonts and colours.

> **Unofficial.** Not affiliated with, endorsed or supported by DEGIRO or flatexDEGIRO Bank. DEGIRO is a trademark of its owner.

## Features

**Bid/ask spread**
- Adds a **Spread** row to the *Pricing data* block on every product page, with the absolute and percentage spread (relative to the bid/ask midpoint).
- The row is colour-coded: green < 0.1 %, amber < 0.5 %, red ≥ 0.5 %. It updates live as quotes change. The percentage is rounded to 0.01 %.
- The current spread % is also shown in the product header, after the daily and period change (`Spread 0,07%`).

**Ex-dividend date**
- On share pages, the ex-dividend date from DEGIRO's *Dividends* section is shown after the spread (`Ex-div 12/11/2026`). Click it to jump to Dividends. Hidden when DEGIRO has no date.

**Compact Pricing data**
- Reduces the spacing between all rows in *Pricing data*: Latest/Bid/Ask…, Volume…, Symbol/Exchange… (12 px → 4 px gap).

**Change for the selected period**
- Next to DEGIRO's daily change in the header, shows the change for the selected chart period, e.g. `1M +0,054 (+2,06%)`. Hidden for 1D.

**Chart range selection (Google Finance style)**
- Click and drag on the price chart to select a period.
- Shows the change in % and in price, the start/end prices and dates.
- Green dots mark the start and end points if the price went up, red dots if it went down.
- A simple click or `Esc` clears the selection. It stays while the price updates live and is cleared when you pick another period.
- The result is also announced to screen readers.

**Portfolio chart**
- Next to the portfolio total: the change over the selected period (1M / 3M / YTD / 1Y), in € and %. It includes deposits and withdrawals.
- Drag on the portfolio chart to see the € and % change between two dates.
- When DEGIRO's eye button hides your amounts, the extension's € amounts and percentages are hidden too; only dates stay readable.

**Open orders on the chart**
- Each open order for the product is drawn as a dashed line at its price, with a badge on the left (e.g. `BUY 200 · 14,10`). Buy orders are green, sell orders red.
- Orders at the same side and price are combined. Badges of orders close in price go side by side, each on its own line. If they don't fit in the chart, they merge into one *N orders* badge.
- Orders outside the visible price range are listed in one horizontal row at the top (▲) or bottom (▼) of the chart, with *+N* when not all of them fit.
- **Click a badge** (or Tab to it and press Enter) to open DEGIRO's *Adjust order* form for that order.
- The order list refreshes every 20 seconds, and a few seconds after an order appears in or disappears from DEGIRO's *Outstanding* list.

**Orders page: filters and totals**
- On *Orders → Outstanding*: filter by action (Buy/Sell), currency and product (multi-select). Total buy and total sell value per currency for the shown orders.

**Adjust order: click outside to close**
- Clicking anywhere outside the *Adjust order* panel closes it, the same as the × button, without saving changes.
- Clicks in DEGIRO's confirmation dialogs and menus are ignored, so the form never closes by accident.

**Cleaner portfolio**
- Hides the *Cash compensation* section by default, in any DEGIRO language. You can add your own section titles in Settings. A section is hidden only on its own: never the price chart, Pricing data or a box holding other sections.

## Settings

Every feature has an on/off switch. You can open the settings in two ways:
- click the **Tweaks for DEGIRO icon** in the Chrome toolbar (pin it via the puzzle-piece menu), or
- open `chrome://extensions` → Tweaks for DEGIRO → **Details** → **Extension options**.

| Setting | Default |
|---|---|
| Bid/ask spread | On |
| Spread in header | On |
| Ex-dividend date in header | On |
| Compact Pricing data | On |
| Change for selected period (products and portfolio) | On |
| Range selection (products and portfolio) | On |
| Open orders on chart | On |
| ↳ Click badge to adjust | On |
| Click outside closes Adjust order | On |
| Filters and totals on Orders | On |
| Hide sections (+ editable list of titles) | On (*Cash compensation*, in any DEGIRO language) |

Changes apply instantly to open DEGIRO tabs. Settings sync across your Chrome profiles.

Opened from the toolbar over a DEGIRO tab, the popup also shows **On this page**: for each feature, whether it is working, not used on this page, or *Not found* — the last one means DEGIRO probably changed its page, which is useful to mention in a bug report. Nothing is stored or sent anywhere.

## Installation

1. Unzip the archive.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.
4. Reload the DEGIRO page.

**Updating:** replace the files in the folder, press ↻ on the extension card in `chrome://extensions`, then reload DEGIRO.

Requires Chrome 111 or newer.

## Privacy & safety

- Runs only on `https://trader.degiro.nl/trader/`, in the main page (not in frames). The only permission is `storage`, used to save your settings. Nothing is sent anywhere else, and there is no analytics or remote code.
- Open orders are **read** from DEGIRO's own endpoint using your current logged-in session, the same request the DEGIRO web app makes. The session is normally taken from DEGIRO's own requests; only if they don't contain it, the extension asks DEGIRO for it the way the DEGIRO website does, and reads nothing else from that answer but your account number. A session DEGIRO rejects is not used again, and failed requests are retried only after a pause, so the extension never floods DEGIRO with requests.
- The extension never places, changes or cancels orders. Clicking a badge only opens DEGIRO's own edit form; you confirm any change yourself.

## Notes & limitations

- Orders are shown only on the chart of the exact listing (exchange/currency) they were placed on.
- If several orders share a price, clicking the badge opens the first one. If DEGIRO shows a shortened product name that fits more than one order, nothing opens and the badge says so.
- The extension relies on DEGIRO's current page structure, so a DEGIRO redesign may break individual features.
- The extension's own texts are in English, Dutch, German, French, Spanish, Italian and Portuguese. They follow Chrome's language, not the language chosen in DEGIRO; other languages fall back to English.

## Files

All extension files live in `extension/`.


| File | Purpose |
|---|---|
| `common.js` | Shared code loaded first in both worlds: the DEGIRO page hooks (selectors and label patterns), number parsing/formatting in the page's format, page theme, flags, the main price chart, and the scheduler every feature registers with. `common-isolated.js` is an identical copy for the isolated world (`npm run sync-common`) |
| `flags.js` | Feature flags: defaults, storage and the bridge to page-context scripts |
| `options.html/.css/.js` | Settings page (toolbar popup and Extension options) |
| `_locales/*/messages.json` | Translations of every text, the store summary included (English is the default) |
| `content.js` | Bid/ask spread row |
| `exdiv.js` | Ex-dividend date in the header |
| `compact.js` | Compact Pricing data |
| `hide.js` | Hides sections listed in Settings |
| `orders-table.js` | Orders page: filters and totals |
| `adjust-close.js` | Click outside to close *Adjust order* |
| `status.js` | Answers the popup's "On this page" feature status |
| `chart-select.js` | Chart range selection (runs in page context) |
| `period.js` | Change for the selected period (runs in page context) |
| `portfolio.js` | Portfolio chart: period change and range selection (runs in page context) |
| `orders.js` | Open orders on the chart and click-to-edit (runs in page context) |

See [CHANGELOG.md](CHANGELOG.md) for release notes and [PRIVACY.md](PRIVACY.md) for the privacy policy.

## Development

```
npm install          # test tools only; the extension itself has no dependencies
npm run sync-common  # after editing extension/common.js
npm test             # type check + lint + unit + end-to-end tests
npm run typecheck    # tsc --noEmit on the plain JS (JSDoc types), one project per world
npm run lint         # ESLint: undefined names, unused code
npm run build        # dist/tweaks-for-degiro-<version>.zip, ready for the Chrome Web Store
```

Project layout:

```
extension/           the extension; only this folder is packaged
tests/unit/          static checks (manifest, permissions, no eval/remote code/innerHTML, …)
tests/e2e/           Playwright tests: real Chromium with the extension loaded
tests/fixtures/      mock of trader.degiro.nl (Highcharts 4 chart, orders panel, Adjust order form)
scripts/build.js     packs extension/ into a zip
.github/workflows/   CI: runs npm test on every push to main and on pull requests
PRIVACY.md           privacy policy (publish at a public URL for the store)
STORE_LISTING.md     draft answers for the Chrome Web Store dashboard
```

The end-to-end tests never contact DEGIRO. Every `trader.degiro.nl` request is answered by the local mock, including the orders endpoint.

Tests and dev tools are **not** part of the published extension; `npm run build` zips only `extension/`.

## License

[Apache License 2.0](LICENSE) — see also [NOTICE](NOTICE). DEGIRO is a trademark of its owner; this project is not affiliated with DEGIRO or flatexDEGIRO Bank.
