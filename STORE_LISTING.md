# Chrome Web Store submission notes

Draft answers for the Chrome Web Store Developer Dashboard. Check them against the dashboard's current wording before submitting.

## Store listing

**Name:** Tweaks for DEGIRO (unofficial)

**Summary (≤132 chars):**
Adds bid/ask spread, chart range %, your orders on the chart and order filters to the DEGIRO web trader. Not affiliated with DEGIRO.

The summary comes from `extDescription` in `extension/_locales/<lang>/messages.json` (en, nl, de, fr, es, it, pt); the store shows it in each language automatically. The description below is entered per language in the dashboard.

**Category:** Productivity (alternative: Tools)

**Description:**

> Small quality-of-life additions for the DEGIRO web trader (trader.degiro.nl).
>
> Pricing
> • Bid/ask spread — absolute and %, colour-coded, in Pricing data and in the header
> • Ex-dividend date in the header, linking to the Dividends section
> • Compact Pricing data — tighter rows
>
> Charts
> • Change for the selected period next to the daily change, e.g. 1M +2,06%
> • Range selection — drag on a product or portfolio chart to see the change between two points
> • Portfolio chart — change for the selected period in € and %; respects DEGIRO's "hide values" mode
>
> Orders
> • Your open orders on the price chart — a dashed line and badge at each order price
> • Click a badge to open DEGIRO's own Adjust order form; you make and confirm any change yourself
> • Orders page — filter outstanding orders by action, currency and product; buy/sell totals per currency
> • Click outside the Adjust order panel or press Esc to close it (same as Cancel, nothing is saved)
>
> Cleanup
> • Hide sections you don't use, such as Cash compensation
>
> Every feature can be switched on or off from the toolbar icon or the extension options. The popup also shows which features work on the open page.
>
> The figures are informational only; always check prices and orders in DEGIRO itself.
>
> Privacy: everything runs locally in your browser. No analytics, no tracking, no data sent to the developer or third parties. The extension never places, changes or cancels orders.
>
> This is an unofficial extension. It is not affiliated with, endorsed or supported by DEGIRO or flatexDEGIRO Bank. DEGIRO is a trademark of its owner.

**Screenshots (1280×800):**
1. Product page with spread row and orders on the chart
2. Range selection showing % change
3. Portfolio chart with the period change
4. Orders page with filters and totals
5. Settings popup with *On this page*

Take them from the test mock, never from a real account.

**Privacy policy URL:** a public URL for `PRIVACY.md`, for example the file on GitHub or GitHub Pages.

## Privacy practices tab

**Single purpose:**
Read-only display and navigation aids for the DEGIRO web trader. It never places, changes or cancels orders.

**Permission justifications:**
- `storage` — saves the user's feature on/off settings and the list of page sections to hide.
- Host access `https://trader.degiro.nl/trader/*` (content scripts) — the extension only adds features to DEGIRO web trader pages, so it must run on them.

**Remote code:** No, I am not using remote code. All JavaScript is included in the package.

**Data usage — select:**
- **Financial and payment information** — the user's open orders and portfolio value history are read from DEGIRO to draw them on the charts. Used locally only.
- **Authentication information** — the DEGIRO session identifier and internal account number are used, locally, to request the user's own orders from DEGIRO. If DEGIRO's request URLs don't contain them, they are read from DEGIRO's own session and client endpoints (only the account number is read from the client answer).
- **Personally identifiable information** — only in that fallback case: DEGIRO's client answer also contains the user's profile (name, contact details). It is received and parsed in page memory; only the account number is kept, the rest is discarded and never stored or sent anywhere. (Alternative, if you'd rather not tick this: remove the `/pa/secure/client` request from `orders.js` and wait for the account number to appear in DEGIRO's own request URLs.)

The Web Store also asks about **Website content**, because the extension reads prices from the page. Select it if the dashboard wording covers reading page content.

**Certify:**
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

## Before submitting

- [ ] Read DEGIRO's terms of use about browser extensions and automated access
- [ ] Publish `PRIVACY.md` at a public URL
- [ ] Make 5 screenshots from the test mock (`tests/fixtures/`), never a real account: product page with spread and order badges, range selection, portfolio chart, Orders filters, popup with *On this page*
- [x] Check that the icon has nothing that could pass for DEGIRO's logo (now indigo; it was DEGIRO's blue)
- [ ] `npm test` passes
- [ ] `npm run build` → upload `dist/tweaks-for-degiro-<version>.zip`
- [x] `homepage_url` points to the project repo, which is public
