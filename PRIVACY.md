# Privacy Policy — Tweaks for DEGIRO (unofficial)

_Last updated: 28 October 2026_

Tweaks for DEGIRO is an unofficial browser extension that adds display features to the DEGIRO web trader at `trader.degiro.nl`. It is not affiliated with DEGIRO or flatexDEGIRO Bank.

## Summary

The extension does not collect, store, sell or share your personal data. Everything it does happens inside your own browser. Nothing is sent to the developer or to any third party.

## What the extension accesses, and why

| Data | What it is used for | Where it goes |
|---|---|---|
| **Prices on the DEGIRO page** (bid, ask, chart data) | To calculate the bid/ask spread and the % change of a selected chart range | Stays in the page; never stored or sent anywhere |
| **Your open orders** (product, buy/sell, quantity, limit price) | To draw your orders on the price chart | Read from DEGIRO's own server over your existing DEGIRO connection. Kept in page memory only; never stored or sent anywhere else |
| **Your portfolio value history** (date, total value) | To show the change over the selected period and for a selected range on the portfolio chart | Read from DEGIRO's own server, the same data DEGIRO loads for its portfolio chart. Kept in page memory only; never stored or sent anywhere else |
| **Your DEGIRO session identifier and internal account number** | Needed by DEGIRO's server to return your open orders and portfolio value history, the same way the DEGIRO website itself requests them. Normally read from the addresses of DEGIRO's own requests. Only if those don't contain them, the extension asks DEGIRO's own session and client endpoints, as the DEGIRO website does; DEGIRO's client answer also contains your profile (such as name and contact details); the extension receives it in that case but reads only the account number and discards the rest | Used only in requests to `trader.degiro.nl`. Kept in page memory only; never stored, logged or sent anywhere else. A session DEGIRO rejects is not used again |
| **Your orders and transactions shown on DEGIRO's Orders and Transactions pages** (product, buy/sell, values, fees) | To filter those tables and show totals | Read from the page you are viewing; no extra requests. Kept in page memory only; never stored or sent anywhere else |
| **Your extension settings** (feature on/off switches, list of section titles to hide, columns hidden on Orders and Transactions) | To remember your preferences | Saved with Chrome's `storage.sync`, which Chrome may sync to your own Google account. Contains no personal or financial data |

## What the extension does not do

- The **Feedback** link in Settings only opens GitHub in a new tab, with the extension version, Chrome version and language pre-filled in a new issue. Nothing is sent unless you submit that issue yourself on GitHub.
- It does not place, change or cancel orders. It can open DEGIRO's own *Adjust order* form and press **Cancel** to close it. Any order change is made and confirmed by you in DEGIRO's interface.
- It does not send data to the developer or any third-party server.
- It has no analytics, tracking, ads or remote code.
- It does not run on any website other than `https://trader.degiro.nl/trader/`.

## Permissions

- **storage** — to save your settings.
- **Access to `trader.degiro.nl/trader/`** (via content scripts) — to add the features to the DEGIRO web trader pages.

## Data retention and deletion

The extension keeps no data apart from your settings. Removing the extension deletes them. You can also reset them by turning the switches back to their defaults.

## Changes

If this policy changes, the new version will be published at this address with a new "Last updated" date.

## Contact

Questions: open an issue in the project repository, or email the developer at the address listed on the Chrome Web Store page.
