# Release notes

## Unreleased
- **Price alarms.** An *Alarm* button (bell) after *Sell* on the page of a product in your Favourites opens a *Set price alarm* panel: price, direction, and repeat (*Once*, *Once a day*, *Every time*), with this product's alarms. When the price is reached, a banner appears in every open DEGIRO tab.
- **Alarms page and sidebar item**: all alarms sorted by product, then price (high to low), with status filters, a product picker, on/off toggle switches, **Edit** (change the price and repeat of an alarm), delete and live prices; the sidebar item shows how many banners are open. Own switch in Settings.
- **Alarms on the chart**: a gold badge at the price of each switched-on alarm on the product chart (▲/▼ at the edge when out of range). Own switch in Settings, under Price alarms.
- Alarm status shown as coloured pills (*Waiting*, *Fired*, off), a bin icon for delete, and the number of alarms as a badge on the *Alarm* button.
- The **Status** column of the Alarms page has a "?" (hover, keyboard focus or click) that explains each status.
- Alarms are checked only while DEGIRO's Favourites or a product page is open; up to 25 alarms. The list syncs with your Chrome profile.
- **Fix**: on the Alarms page, a product in your Favourites without a price (market closed) shows *No trading now* instead of *Not in current list*.
- **Fix**: price alarms set while the market was closed showed a dash in the currency ("$— 240,00").
- **Fix**: clicking *Favourites* (or a Favourites list) in the sidebar from the Alarms page now leaves the Alarms page.
- **Fix**: when Chrome couldn't read the settings, features you had switched off came back on until the next good read; the last good settings now stay.
- **Fix**: on Transactions, a fee shown as "–" now counts as 0 in the Fees total, and a "–" value is no longer read as a currency.
- **Fix**: hovering *Products* in the sidebar no longer highlights the Orders and Transactions links.
- **Fix**: the Transactions filters and totals were missing while DEGIRO's upper panel was open.
- **Fix**: in the product header, the extension's values (period change, spread, ex-dividend date) no longer touch DEGIRO's daily change.

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
