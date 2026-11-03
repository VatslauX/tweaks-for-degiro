# Release notes

## 1.21.5 — 2026-11-03
- **Price alarm without a current price**: when DEGIRO shows no current price yet, the *Set price alarm* panel now asks for the direction (*Rises to* or *Falls to*) instead of showing an error for a valid price. *Set* is enabled once you pick one.

## 1.21.4 — 2026-11-02
- **Fix**: dragging on the portfolio chart to select two dates no longer throws an error and stops working when DEGIRO redraws the chart at the same moment. The drag now resets cleanly and works again on the next try, without a reload.
- **Fix**: on a product chart, pressing Esc while still dragging a range selection no longer leaves a stale selection that reappears — wrongly anchored at the chart's start — on the next move before you release the pointer.
- **DEGIRO colours**: the red, blue and grey of the extension's values, labels and chart markers now match DEGIRO's current palette.
- **Tests and developer notes**: unit coverage of the shared helpers and the settings sanitizer, integration coverage of hidden sections, compact pricing data, the header dates, the period change and the status report.

## 1.21.2 — 2026-10-31
- **Faster**: open orders appear on the chart about 2 seconds sooner after a product page opens, and the portfolio change appears as soon as DEGIRO's chart data arrives.
- **Earnings date in the product header**: the next earnings date from DEGIRO's Earnings section sits after the ex-dividend date. Click it to jump to Earnings. It has its own switch in Settings.
- **Click alarm badge to edit**: clicking a gold alarm badge on the product chart opens the alarm editor for that price, matching the order-badge click-to-edit behaviour. The sub-setting *Click badge to edit* (under *Alarms on the chart*) can switch it off.
- **Buy and Sell buttons on the Alarms page**: each alarm row now has DEGIRO's own "B"/"S" pill buttons before the product name, matching Transactions and Orders. Navigates to that product's overview page.
- **Alarms page rows on one line**: the product shows only its name, like Transactions; the symbol is in the name's tooltip. Two products with the same name (one ETF on two exchanges) show their symbol after it: *iShares Core MSCI World · IWDA*.
- **Remember the Orders sort order**: Orders → Outstanding keeps the column and direction you last sorted by, across reloads and navigating away and back. Its own switch in Settings, *Remember Orders sort order*.

## 1.21.0 — 2026-10-30
- **Price alarms.** An *Alarm* button (bell) after *Sell* on the page of a product in your Favourites opens a *Set price alarm* panel: price, direction (above or below, from the current price) and repeat (*Once*, *Once a day*, *Every time*), with this product's alarms. The button shows how many of the product's alarms are switched on. When the price is reached, a banner appears in every open DEGIRO tab.
- **Alarms page and sidebar item**: all alarms sorted by product, then price (high to low), with status filters, a product picker, on/off switches, **Edit** (change the price and repeat of an alarm), delete and live prices. The status (*Waiting*, *Fired*, *No trading now*, *Not in current list*, off) is shown as a coloured label, and a "?" next to *Status* explains each one. The sidebar item shows how many banners are open.
- **Alarms on the chart**: a gold badge at the price of each switched-on alarm on the product chart (▲/▼ at the edge when out of range).
- Alarms are checked only while DEGIRO's Favourites or a product page is open; up to 25 alarms. The list syncs with your Chrome profile. *Price alarms* and *Alarms on the chart* each have their own switch in Settings.
- **Fix**: when Chrome couldn't read the settings, features you had switched off came back on until the next good read; the last good settings now stay.
- **Fix**: on Transactions, a fee shown as "–" now counts as 0 in the Fees total, and a "–" value is no longer read as a currency.
- **Fix**: the Transactions filters and totals were missing while DEGIRO's upper panel was open.
- **Fix**: hovering *Products* in the sidebar no longer highlights the Orders and Transactions links.
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
