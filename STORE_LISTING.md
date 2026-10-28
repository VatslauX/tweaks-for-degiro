# Chrome Web Store submission notes

Draft answers for the Chrome Web Store Developer Dashboard. Check them against the dashboard's current wording before submitting.

## Store listing

**Name:** Tweaks for DEGIRO (unofficial)

**Summary (≤132 chars):**
Adds bid/ask spread, chart range %, your orders on the chart and order filters to the DEGIRO web trader. Not affiliated with DEGIRO.

The summary comes from `extDescription` in `extension/_locales/<lang>/messages.json` (en, nl, de, fr, es, it, pt); the store shows it in each language automatically. The description below is entered per language in the dashboard.

**Category:** Productivity (alternative: Tools)

**Description:**

> Free UI/UX tweaks for the DEGIRO web trader (trader.degiro.nl).
>
> Want to see at a glance how much a stock moved in the period you picked? How your portfolio changed between any two dates? All your open orders right on the price chart? Then this extension is for you. Free, no account, no ads, no tracking.
>
> WHY INSTALL IT
> DEGIRO's web trader is clean, but some everyday questions take extra clicks, mental maths or a calculator. Tweaks for DEGIRO answers them right where you're already looking, styled to match DEGIRO's own fonts and colours.
>
> SEE THE REAL COST OF A TRADE
> • Bid/ask spread in Pricing data, absolute and %, colour-coded green / amber / red, updating live
> • Spread % in the product header too, so you notice an expensive spread before you place an order
> • Ex-dividend date in the header. Click it to jump to Dividends
> • Compact Pricing data: tighter rows, more on screen
>
> UNDERSTAND THE CHART IN ONE GLANCE
> • Change for the selected period next to the daily change, e.g. 1M +2,06%
> • Drag across any product chart to see the % and price change between two points, Google Finance style, with start/end prices and dates
> • Portfolio chart: change for the selected period in € and %, and drag to measure any custom date range
> • Respects DEGIRO's "hide values" mode. Your amounts stay hidden when you hide them
>
> YOUR ORDERS WHERE THEY BELONG: ON THE CHART
> • Every open order for the product is shown as a dashed line with a badge at its price (green buy, red sell)
> • See at once how far the price is from your limit
> • Orders outside the visible range are listed at the top or bottom of the chart
> • Click a badge to open DEGIRO's own Adjust order form. You make and confirm any change yourself
>
> AN ORDERS PAGE THAT SCALES
> • Filter outstanding orders by Buy/Sell, currency and product
> • Total buy and sell value per currency for the orders shown. Know how much cash your open orders need
> • Transactions: the same filters, with buy, sell and net totals per currency and the fees
> • Choose which columns to show on Orders and Transactions; long product names shown in full
> • Orders and Transactions links right in DEGIRO's left menu
> • Click outside the Adjust order panel or press Esc to close it (same as Cancel, nothing is saved)
>
> LESS CLUTTER
> • Hide sections you never use, such as Cash compensation, or add your own
>
> YOU'RE IN CONTROL
> • Switch every feature on or off from the toolbar icon. Changes apply instantly, no reload
> • The popup shows which features are working on the open page
> • Available in English, Dutch, German, French, Spanish, Italian and Portuguese
>
> SAFE BY DESIGN
> • Everything runs locally in your browser. No analytics, no tracking, nothing sent to the developer or third parties
> • Only one permission (storage, for your settings). Runs only on trader.degiro.nl
> • Read-only: it never places, changes or cancels orders
> • Open source: you can read every line of code
>
> The figures are informational only; always check prices and orders in DEGIRO itself.
>
> This is an unofficial extension. It is not affiliated with, endorsed or supported by DEGIRO or flatexDEGIRO Bank. DEGIRO is a trademark of its owner.

**Screenshots (1280×800):**
1. Product page with spread row and orders on the chart
2. Range selection showing % change
3. Portfolio chart with the period change
4. Orders page with filters, totals and the new sidebar links
5. Settings popup with *On this page*

Take them from the real page with every personal number replaced: paste `scripts/screenshot-mask.js` into the DevTools console of a logged-in DEGIRO tab, save the four shots to `dist/screenshots-real/raw/` (see `scripts/store-images.spec.js`), and check each one. `npm run store-images` then writes the five screenshots (caption bar, 1280×800 JPEG, the settings popup added from the extension) and both promo tiles to `dist/store/`.

**Privacy policy URL:** a public URL for `PRIVACY.md`, for example the file on GitHub or GitHub Pages.

## Privacy practices tab

**Single purpose:**
Read-only display and navigation aids for the DEGIRO web trader. It never places, changes or cancels orders.

**Permission justifications:**
- `storage` — saves the user's feature on/off settings, the list of page sections to hide and the columns hidden on the Orders and Transactions pages.
- Host access `https://trader.degiro.nl/trader/*` (content scripts) — the extension only adds features to DEGIRO web trader pages, so it must run on them.

**Remote code:** No, I am not using remote code. All JavaScript is included in the package.

**Data usage — select:**
- **Financial and payment information** — the user's open orders and portfolio value history are read from DEGIRO to draw them on the charts, and the orders and transactions shown on DEGIRO's Orders and Transactions pages are read from the page for filters and totals. Used locally only.
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
- [x] Make 5 screenshots and the promo tiles (`npm run store-images`, real page with mock numbers): product page with spread and order badges, range selection, portfolio chart, Orders filters, popup with *On this page*
- [x] Check that the icon has nothing that could pass for DEGIRO's logo (now indigo; it was DEGIRO's blue)
- [ ] `npm test` passes
- [ ] `npm run build` → upload `dist/tweaks-for-degiro-<version>.zip`
- [x] `homepage_url` points to the project repo, which is public
