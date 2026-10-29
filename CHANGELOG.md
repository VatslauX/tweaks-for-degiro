# Release notes

## Unreleased
- **Fix**: the Transactions filters and totals were missing while DEGIRO's upper panel was open.

## 1.20.1 — 2026-10-28
- **Feedback link** in Settings: opens a new issue on the project's GitHub page, with the extension version, Chrome version and language filled in.

## 1.20.0 — 2026-10-28
- **Transactions: filters and totals.** Filter by Buy/Sell, currency and product; total buy, total sell and net (buy − sell) per currency, and the fees, for the transactions shown.
- **Choose the columns** on *Orders → Outstanding* and *Transactions* (every column but Product). Hidden by default: *Exchange* on Orders; *Exchange*, *Venue*, *Exchange Rate* and *AutoFX Fee* on Transactions. The choice is remembered and synced.
- **Full product names** on both pages: the other columns fit their content and Product gets the spare width.
- **Orders and Transactions in the sidebar**, below Products, with their own switch in Settings.
- **Orders filter** now recognises Buy/Sell in any DEGIRO language, and drops a picked currency that is no longer in the table.
- **Fix**: on the Portfolio chart, the range selection could be drawn over the top of the page after coming back from another page.

## 1.19.3 — 2026-10-27
- **Order badges**: one badge per order. Orders at the same price no longer add up into one badge that opened only the first; they sit side by side, and each opens its own order.

## 1.19.2 — 2026-10-26
First public release on the Chrome Web Store.
- **Bid/ask spread** row in *Pricing data*, and the spread in the product header.
- **Ex-dividend date** in the product header.
- **Compact Pricing data.**
- **Change for the selected chart period** in the product header.
- **Chart range selection:** drag on the price chart to see the change between two points.
- **Portfolio chart:** change for the selected period, and range selection; respects DEGIRO's "hide values" mode.
- **Open orders on the chart**, with click-to-edit (opens DEGIRO's *Adjust order*).
- **Filters and totals on Orders → Outstanding.**
- **Click outside or Esc closes *Adjust order*** without saving.
- **Hides *Cash compensation*** and any section titles you add.
- **Settings** with a switch for every feature, applied live; the popup shows whether each feature works on the current page.
- Works in every DEGIRO language and number format, in the dark theme and the narrow layout. Translated into English, Dutch, German, French, Spanish, Italian and Portuguese.
