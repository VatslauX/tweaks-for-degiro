# Privacy Policy — Tweaks for DEGIRO (unofficial)

_Last updated: 30 October 2026_

Tweaks for DEGIRO is an unofficial browser extension that adds display features to the DEGIRO web trader at `trader.degiro.nl`. It is not affiliated with DEGIRO or flatexDEGIRO Bank.

## Summary

The extension does not collect, sell or share your personal data. It stores only your settings and price alarms, in your own browser. Everything it does happens inside your own browser. Nothing is sent to the developer or to any third party.

## What the extension accesses, and why

| Data | What it is used for | Where it goes |
|---|---|---|
| **Prices on the DEGIRO page** (bid, ask, chart data) | To calculate the bid/ask spread and the % change of a selected chart range | Stays in the page; never stored or sent anywhere |
| **Your open orders** (product, buy/sell, quantity, limit price) | To draw your orders on the price chart | Read from DEGIRO's own server over your existing DEGIRO connection. Kept in page memory only; never stored or sent anywhere else |
| **Your portfolio value history** (date, total value) | To show the change over the selected period and for a selected range on the portfolio chart | Read from DEGIRO's own server, the same data DEGIRO loads for its portfolio chart. Kept in page memory only; never stored or sent anywhere else |
| **Your DEGIRO session identifier and internal account number** | Needed by DEGIRO's server to return your open orders and portfolio value history, the same way the DEGIRO website itself requests them. Normally read from the addresses of DEGIRO's own requests. Only if those don't contain them, the extension asks DEGIRO's own session and client endpoints, as the DEGIRO website does; DEGIRO's client answer also contains your profile (such as name and contact details); the extension receives it in that case but reads only the account number and discards the rest | Used only in requests to `trader.degiro.nl`. Kept in page memory only; never stored, logged or sent anywhere else. A session DEGIRO rejects is not used again |
| **Your orders and transactions shown on DEGIRO's Orders and Transactions pages** (product, buy/sell, values, fees) | To filter those tables and show totals | Read from the page you are viewing; no extra requests. Kept in page memory only; never stored or sent anywhere else |
| **Prices of your favourite products on the DEGIRO page** (Favourites list and product page) | To check your price alarms | Read from the page you are viewing; no extra requests. Used to compare with your alarms and stored as described in the next row |
| **Your price alarms** (product id, name, symbol, currency, price, repeat, on/off), **last seen prices and times**, and **open alarm banners** | To check alarms and show a banner when a price is reached | Saved in Chrome's storage on your computer. The alarm list uses `storage.sync`, which Chrome may sync to your own Google account; the last seen prices and open banners use `storage.local` and stay in this browser. While a product's page is open with *Alarms on the chart* switched on, that product's id and the price and direction (above/below) of its switched-on alarms are written into the page, so the chart part of the extension can draw them; the DEGIRO page can read them there while it is open. Never sent anywhere else |
| **Your extension settings** (feature on/off switches, list of section titles to hide, columns hidden on Orders and Transactions, the Orders sort column and direction) | To remember your preferences | Saved with Chrome's `storage.sync`, which Chrome may sync to your own Google account. Contains no personal or financial data |

## What the extension does not do

- The **Feedback** link in Settings only opens GitHub in a new tab, with the extension version, Chrome version and language pre-filled in a new issue. Nothing is sent unless you submit that issue yourself on GitHub.
- It does not place, change or cancel orders. It can open DEGIRO's own *Adjust order* form and press **Cancel** to close it. Any order change is made and confirmed by you in DEGIRO's interface.
- It does not send data to the developer or any third-party server.
- It has no analytics, tracking, ads or remote code.
- It does not run on any website other than `https://trader.degiro.nl/trader/`.

## Permissions

- **storage** — to save your settings and price alarms.
- **Access to `trader.degiro.nl/trader/`** (via content scripts) — to add the features to the DEGIRO web trader pages.

## Data retention and deletion

The extension keeps no data apart from your settings and price alarms. Removing the extension deletes them. You can also reset the settings by turning the switches back to their defaults, and delete alarms on the Alarms page.

## Changes

If this policy changes, the new version will be published at this address with a new "Last updated" date.

## Contact

Questions: open an issue in the project repository, or email the developer at the address listed on the Chrome Web Store page.
