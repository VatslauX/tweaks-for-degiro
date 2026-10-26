# Release notes

## 1.19.2 — 2026-10-26
- Esc closes the *Adjust order* form without saving (an open DEGIRO dialog or menu gets the Esc first).
- Indigo icon and settings accent, so they can't be mistaken for DEGIRO's own.

## 1.19.1 — 2026-10-26
- Disabling, removing or updating the extension stops it in open DEGIRO tabs within 2 s: no more requests, and everything it added is removed.

## 1.19.0 — 2026-10-24
- Much less work on chart hover.
- Range selection survives live price updates.
- Order badges: new and cancelled orders show within seconds; crowded badges merge into *N orders*; badges work with the keyboard and screen readers.
- Product header items wrap on narrow screens and follow the dark theme.

## 1.18.1 — 2026-10-24
- A stuck DEGIRO request no longer stops updates (15 s timeout).
- Hiding *Cash compensation* and click outside to close *Adjust order* work in every DEGIRO language.
- Compact Pricing data no longer affects other widgets.

## 1.18.0 — 2026-10-24
- No request loop after the DEGIRO session expires.
- Hide sections never hides the whole product page.
- Clicking a badge always opens the right order, in every DEGIRO language.
- Translated into Dutch, German, French, Spanish, Italian and Portuguese.

## 1.17.0 – 1.17.1 — 2026-10-24
- The popup shows whether each feature works on the current page.
- One shared page observer instead of one per feature; sturdier on unexpected pages.

## 1.16.0 – 1.16.1 — 2026-10-23
- Numbers follow the page's format (`1.234,56` or `1,234.56`).
- The portfolio chart respects DEGIRO's "hide values" mode.
- Badges for orders close in price sit side by side on their own lines.
- Removed the *Updated* label next to the update time.

## 1.15.0 – 1.15.3 — 2026-10-22
- **Filters and totals on Orders → Outstanding:** filter by side, currency and product, with buy and sell totals per currency.
- Fixed the period change missing for 1W.
- Chart features use only the main price chart.

## 1.14.0 — 2026-10-22
- Dark theme support for badges and range labels.
- The period change never shows numbers from the previous period.
- Range selection works with pen and touch.
- Bid/Ask are found by DEGIRO's own hooks, so they work in any UI language.

## 1.13.0 – 1.13.2 — 2026-10-22
- **Ex-dividend date** in the product header.
- Order badges work in DEGIRO's narrow (mobile) layout.

## 1.12.0 — 2026-10-22
- **Portfolio chart:** change for the selected period, and range selection.

## 1.10.0 – 1.11.0 — 2026-10-22
- **Change for the selected chart period** in the product header.
- **Spread** in the product header.

## 1.8.0 – 1.9.0 — 2026-10-22
- **Compact Pricing data** (about 130 px shorter).

## 1.7.0 — 2026-10-21
- Renamed to **Tweaks for DEGIRO (unofficial)**; runs only on `trader.degiro.nl/trader/`, top frame only.
- Security hardening (XSS fix, validated settings), privacy policy and automated tests.

## 1.6.0 – 1.6.1 — 2026-10-21
- **Settings:** switch every feature on or off and edit the hidden sections; changes apply live.
- Click outside presses only Cancel or ×.

## 1.1.0 – 1.5.0 — 2026-10-21
- **Open orders on the chart**, with click-to-edit (opens DEGIRO's *Adjust order*).
- **Chart range selection.**
- Click outside closes *Adjust order*.
- Hides *Cash compensation*.

## 1.0.0 — 2026-10-21
- **Bid/ask spread** row in *Pricing data*.
