# Privacy Policy — Tweaks for DEGIRO (unofficial)

_Last updated: 24 November 2026_

Tweaks for DEGIRO is an unofficial browser extension that adds display features to the DEGIRO web trader at `trader.degiro.nl`. It is not affiliated with DEGIRO or flatexDEGIRO Bank.

## Summary

The extension does not collect, sell or share your personal data. It stores only your settings, price alarms and, if you use the background check, the price links of your alarm products (Yahoo Finance tickers, or Société Générale's product fields), in your own browser. Everything it does happens inside your own browser. Nothing is sent to the developer. The one exception to "nothing is sent to any third party" is the optional background price check: when you switch it on, the extension sends only ticker symbols (for example `ASML.AS`) to Yahoo Finance, and, once per product, the product's ISIN (a public identifier of the security, e.g. `US11135F1012`) when its ticker doesn't match. For Société Générale's own products (turbos, leverage products, certificates), which Yahoo doesn't have, it sends their ISIN and Société Générale's own product fields to Société Générale's site, `sgbeurs.nl`, for their live price.

## What the extension accesses, and why

| Data | What it is used for | Where it goes |
|---|---|---|
| **Prices on the DEGIRO page** (bid, ask, chart data) | To calculate the bid/ask spread and the % change of a selected chart range | Stays in the page; never stored or sent anywhere |
| **Your open orders** (product, buy/sell, quantity, limit price) | To draw your orders on the price chart | Read from DEGIRO's own server over your existing DEGIRO connection. Kept in page memory only; never stored or sent anywhere else |
| **Your portfolio value history** (date, total value) | To show the change over the selected period and for a selected range on the portfolio chart | Read from DEGIRO's own server, the same data DEGIRO loads for its portfolio chart. Kept in page memory only; never stored or sent anywhere else |
| **Your cash balances per currency, and, while the *Cash columns on the chart* switch is on, your account statement for the chart period** (cash movements with dates and amounts) | To show today's cash next to the portfolio total and the cash columns on the portfolio chart | Read from DEGIRO's own server, the same way as the portfolio value history. Kept in page memory only; never stored or sent anywhere else |
| **Your DEGIRO session identifier and internal account number** | Needed by DEGIRO's server to return your open orders, portfolio value history and cash (and, with *Check in the background* on, the public details of your alarm products), the same way the DEGIRO website itself requests them. Normally read from the addresses of DEGIRO's own requests. Only if those don't contain them, the extension asks DEGIRO's own session and client endpoints, as the DEGIRO website does; DEGIRO's client answer also contains your profile (such as name and contact details); the extension receives it in that case but reads only the account number and discards the rest | Used only in requests to `trader.degiro.nl`. Kept in page memory only; never stored, logged or sent anywhere else. A session DEGIRO rejects is not used again |
| **Your orders and transactions shown on DEGIRO's Orders and Transactions pages** (product, buy/sell, values, fees) | To filter those tables and show totals | Read from the page you are viewing; no extra requests. Kept in page memory only; never stored or sent anywhere else |
| **Your holdings shown on DEGIRO's Portfolio page** (product, quantity, values, gains and losses), only with *Merge holdings into one table* on | To merge DEGIRO's holdings tables into one sortable table | Read from the page you are viewing; no extra requests. Kept in page memory only; never stored or sent anywhere else |
| **Prices of your favourite products on the DEGIRO page** (Favourites list and product page) | To check your price alarms | Read from the page you are viewing; no extra requests. Used to compare with your alarms and stored as described in the next row |
| **Your price alarms** (product id, name, symbol, currency, price, repeat, on/off), **last seen prices and times**, and **open alarm banners** | To check alarms and show a banner when a price is reached | Saved in Chrome's storage on your computer. The alarm list uses `storage.sync`, which Chrome may sync to your own Google account; the last seen prices and open banners use `storage.local` and stay in this browser. While a product's page is open with *Alarms on the chart* switched on, that product's id and the price and direction (above/below) of its switched-on alarms are written into the page, so the chart part of the extension can draw them; the DEGIRO page can read them there while it is open. Never sent anywhere else, except as described in the next row |
| **Details of your alarm products from DEGIRO** (symbol, ISIN, exchange, currency), only while *Check in the background* is on in your settings (the setting syncs with your Chrome profile, so this also runs in DEGIRO tabs on your other computers) | To find the Yahoo ticker of alarm products not shown on the page you're viewing | Requested from DEGIRO's own product service (`trader.degiro.nl`) for the product ids of your alarms that have no ticker yet, over your existing DEGIRO login: once per product per tab, and after a failed request again after a pause (20 seconds, doubling up to 5 minutes). DEGIRO's answer also contains the product name and prices; only the four fields above are read, and only what makes the link is kept, as below |
| **ISINs of your alarm products issued by Société Générale** (e.g. `DE000SU054L9`) and Société Générale's own fields for them (its product id, venue code and underlying codes), plus when each one's price last changed | To check those alarms in the background with Société Générale's live prices, while *Check in the background* is on | Sent to `https://sgbeurs.nl` (Société Générale's own site), with no cookies and no DEGIRO data: once a day to look up the product's fields, and for its price up to once a minute (at most 10 products a minute, taking turns). The fields and the price times are kept with `storage.local`. Société Générale also receives your IP address. Its site states that its information is meant for residents of the Netherlands |
| **Ticker symbols and ISINs of your alarm products** (e.g. `ASML.AS`, `US11135F1012`, with the currency), the result of checking each link, the exchange of products that have no Yahoo ticker (or a mark that DEGIRO names none), and the status of the background check (last check time, number of linked alarms, last error) | To check your price alarms in the background with Yahoo Finance prices, while *Check in the background* is on | The links are saved with `storage.sync` (which Chrome may sync to your own Google account); the check result and status use `storage.local` and stay in this browser. Only ticker symbols are sent, in requests to `https://query1.finance.yahoo.com`, with no cookies and no other DEGIRO data. Only when a product's ticker doesn't match Yahoo is its ISIN sent too, once, to Yahoo's search, to find the right ticker; failed lookups are retried at most once a day. As with any web request, Yahoo also receives your IP address. Nothing is sent while the switch is off |
| **Your extension settings** (feature on/off switches, list of section titles to hide, columns hidden on Orders, Transactions and Alarms (`alarmHiddenColumns` for the Alarms page), the Orders sort column and direction, and, only with *Remember Portfolio table sort & columns* on, the merged Portfolio table's sort, hidden columns and full-name choice) | To remember your preferences | Saved with Chrome's `storage.sync`, which Chrome may sync to your own Google account. Contains no personal or financial data. The *Cash columns on the chart* switch and which settings sections are open are saved in this browser's `localStorage` only, and are not synced |

## What the extension does not do

- The **Feedback** link in Settings only opens GitHub in a new tab, with the extension version, Chrome version and language pre-filled in a new issue. Nothing is sent unless you submit that issue yourself on GitHub.
- It does not place, change or cancel orders. It can open DEGIRO's own *Adjust order* form and press **Cancel** to close it. Any order change is made and confirmed by you in DEGIRO's interface.
- It does not send data to the developer or to any third-party server, except the ticker symbols (and, when a ticker doesn't match, ISINs) to Yahoo Finance and the ISINs of Société Générale's products to `sgbeurs.nl` described above, and only while *Check in the background* is on.
- It has no analytics, tracking, ads or remote code.
- It does not run on any website other than `https://trader.degiro.nl/trader/`.

## Permissions

- **storage** — to save your settings and price alarms.
- **alarms** — to run the background price check once a minute. Chrome shows no install warning for it.
- **Access to `trader.degiro.nl/trader/`** (via content scripts) — to add the features to the DEGIRO web trader pages.
- **Optional: notifications** — to show a system notification when an alarm fires in the background. Requested only when you switch on *Check in the background*.
- **Optional: offscreen** — to play the price alarm chime with DEGIRO closed, through a hidden page that holds no data and plays only that sound. Requested and removed together with the background check's permissions (computers that switched the check on before 1.25.0 are asked for it alone, from the *Sound* setting).
- **Optional: access to `query1.finance.yahoo.com`** — to fetch Yahoo Finance prices for the ticker symbols of your alarms, and to look up a ticker by ISIN when one doesn't match. Requested only when you switch on *Check in the background*, and removed when you switch it off.
- **Optional: access to `sgbeurs.nl`** — to fetch Société Générale's live prices for its own products among your alarms (DEGIRO's *Societe Generale OTC* venue). Requested and removed together with the Yahoo Finance access.

## Data retention and deletion

The extension keeps no data apart from your settings, price alarms, the price links of your alarm products (Yahoo tickers, ISINs, Société Générale's product fields, and when each SG price last changed) and the background check's status. Removing the extension deletes them. *Clear saved data*, at the bottom of the settings, erases all of them at once. What Chrome syncs (your settings, alarms, ticker links, and table sort and columns) is erased on every computer your Chrome profile syncs to; the rest (alarm history, the ticker checks and SG prices, the background check's status, the background permissions and the *Cash columns on the chart* switch) on this computer only. You can also reset the settings by turning the switches back to their defaults, delete alarms on the Alarms page, and switch off *Check in the background* to remove the background permissions.

## Changes

If this policy changes, the new version will be published at this address with a new "Last updated" date.

## Contact

Questions: open an issue in the project repository, or email the developer at the address listed on the Chrome Web Store page.
