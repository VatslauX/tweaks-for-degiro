---
name: release
description: Use before pushing a release tag (`v<version>`) of Tweaks for DEGIRO, and when the user says "release", "prepare release" or "release check". Runs the pre-release gate in the main session - preflight (branch, version, CHANGELOG, CI, build), the full test suite, a read-only drift check of selectors, page structure and styles against the real DEGIRO site, mock parity - and ends with a go/no-go report. Never pushes the tag.
argument-hint: "[--skip-site]  (skip the real-site check only when the user says so; the report then says NO-GO for site drift unverified)"
---

# Release gate

Run this in the main session, not in a fork. It needs the Chrome tools, has to wait for the user to log in to DEGIRO, and uses `run-tests`, which reports only to the main session.

Only the user decides when to release. This skill checks and reports. It never creates or pushes a tag, never bumps the version on its own, and never commits without the usual `update-docs` → `review` flow (commits carry no Co-Authored-By/AI trailer, see memory).

## Hard rules for the real DEGIRO page

- **Read-only.** Never log in: if the tab shows the login page, stop and ask the user to log in, and keep going with the steps that don't need the site.
- Open your own new tab and **leave it open** at the end. Never close the user's tabs.
- Navigating, clicking sidebar items and reading the DOM is fine. Never open an order form (Buy/Sell, Adjust order), never press Confirm/Delete/submit, never change DEGIRO settings (theme, language), never trigger dialogs.
- No `fetch`/XHR to DEGIRO from the JS tool: read only what the page already shows.
- **Probe output is shape-only**: counts, booleans, tag names, computed styles. Never text content, prices, amounts, product names, ISINs, account numbers or ids. Don't save anything from the real page in the repo except such shape data.

## 1. Preflight (fail fast)

Run these and collect pass/fail for each one. Keep going after a failure so the report lists every problem at once.

```
git branch --show-current            # main
git status --short                   # empty
git fetch origin && git rev-list --left-right --count origin/main...HEAD   # 0 0
node -p "require('./extension/manifest.json').version"
git tag --list 'v*' --sort=-v:refname | head -1
gh run list --branch main -L1        # latest run on HEAD's sha, conclusion success
```

- The manifest version is newer than the latest tag, and `v<version>` doesn't exist yet (local or `git ls-remote --tags origin`). `release.yml` and `scripts/cws-publish.js` refuse a mismatched tag anyway, so catch it here.
- `CHANGELOG.md`: the top heading is `## <version> — <YYYY-MM-DD>` (today's date or the planned release date), and no `## Unreleased` section is left. If there is one, the version bump and the CHANGELOG heading are the user's call: ask, then make the change through `update-docs` → `review` → commit.
- CI: the latest `Test` run on `main` is for `git rev-parse HEAD` and has succeeded (`gh run list --branch main -L1 --json headSha,conclusion,status`).
- `npm run build`, then `unzip -l dist/tweaks-for-degiro-<version>.zip`: the zip contains only files from `extension/`, the manifest at its root, and no `.DS_Store`, tests or `node_modules`.
- The manifest still has `"permissions": ["storage"]`, the name `Tweaks for DEGIRO (unofficial)`, and `minimum_chrome_version` ≥ 111 (the unit tests check this too, but it's a store blocker).
- `STORE_LISTING.md`'s summary matches the English `extDescription`. If features were added since the last tag (`git log v<last>..HEAD --oneline`), check that README, STORE_LISTING and PRIVACY mention them.

## 2. Full test suite (start now, it takes about 8 minutes)

Start the `run-tests` skill with no scope (it runs in the background) right after preflight, so it overlaps step 3. Don't poll; the notification arrives when it ends. The release needs `ok: true` with 0 failed in every stage (typecheck, lint, unit, integration, e2e). A flaky e2e test (`flaky` > 0) gets reported, not ignored.

## 3. Real-site drift check (Claude in Chrome)

Load the `anthropic-skills:chrome-browser` skill, then the Chrome tools in one ToolSearch call (`tabs_context_mcp`, `tabs_create_mcp`, `navigate`, `javascript_tool`, `read_page`, `computer`). Call `tabs_context_mcp`, then open a new tab at `https://trader.degiro.nl/trader/`. If it shows the login page, ask the user to log in and wait.

**Smoke check first**: run `typeof window.Highcharts` in the JS tool. If it's `"undefined"` on a page with a chart, the tool isn't running in the page's main world: mark the Highcharts checks as unverified.

**Build the probe from the current source.** Copy the `SEL` object from `extension/common.js` as it is now (not from `window.__dgt`, which is whatever build the user has installed, maybe the older store version, or nothing). Paste it into the probe below as `SEL` and run it on each page. It counts matches, skips the extension's own elements, and returns shape only:

```js
(() => {
  const SEL = { /* paste from extension/common.js */ };
  const notOwn = el => !el.closest('[data-dg-own]');
  const count = s => { try { return [...document.querySelectorAll(s)].filter(notOwn).length; } catch (e) { return 'bad selector'; } };
  const hex = c => { const m = (c || '').match(/[\d.]+/g); if (!m) return c; if (m.length > 3 && +m[3] === 0) return 'transparent';
    return '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('').toUpperCase(); };
  const st = (s, ...props) => { const el = [...document.querySelectorAll(s)].filter(notOwn)[0]; if (!el) return null;
    const cs = getComputedStyle(el); return Object.fromEntries(props.map(p => [p, /color/.test(p) ? hex(cs[p]) : cs[p]])); };
  const bid = document.querySelector('dd ' + SEL.bidPrice);
  return JSON.stringify({
    hash: location.hash.replace(/\d+/g, 'N'),
    counts: Object.fromEntries(Object.entries(SEL).map(([k, s]) => [k, count(s)])),
    structure: {
      bidInDdAfterDt: !!bid && bid.closest('dd')?.previousElementSibling?.tagName === 'DT',
      measurerCopy: count(SEL.measurer),
      relativeDifference: count(SEL.relativeDifference),
      mainPageSections: count(SEL.mainPageSection),
      chartsWithNull: Array.isArray(window.Highcharts?.charts) ? window.Highcharts.charts.some(c => !c) : 'n/a',
      dgStatus: document.documentElement.getAttribute('data-dg-status') ? 'present' : 'absent'
    },
    styles: {
      body: st('body', 'fontFamily', 'fontSize', 'color', 'backgroundColor'),
      pricingDt: st('dt', 'color', 'fontSize', 'fontWeight'),
      relDiff: st(SEL.relativeDifference, 'color'),
      buyBadge: st(SEL.buySellBadge + '[data-action=BUY]', 'color', 'backgroundColor'),
      sellBadge: st(SEL.buySellBadge + '[data-action=SELL]', 'color', 'backgroundColor'),
      actionButton: st(SEL.productActionButton, 'color', 'backgroundColor', 'fontFamily'),
      link: st('main a[href]', 'color'),
      menuItem: st(SEL.menuItem, 'color', 'fontSize', 'fontWeight'),
      tableCellBorder: st('table td', 'borderBottomColor', 'borderBottomWidth')
    }
  });
})()
```

Extend the probe when a feature relies on more DEGIRO DOM than this covers (read the feature files changed since the last tag: `git diff --stat v<last>..HEAD -- extension/`).

**Pages to visit** (sidebar clicks or `navigate` to the hash). For a product page, take an id from Favourites (`[data-field=LastPrice][data-id]`, the attribute only):

| Page | Hash | Selectors that must match (≥ 1) |
|---|---|---|
| Product | `#/products/<id>` | `bidPrice`, `askPrice`, `relativeDifference` (> 1), `mainPageSection` (exactly 1), `measurer`, `productName`, `productBriefInfo`, `productActionButton`, `currentPrice`, `sideBar`, `sideNav`, `productsMenuItem`, `favouritesMenuItem`, `menuItem`; `favouriteStarOn` if it's a favourite; `exDividendDate`/`dividendsTitle` for a stock that pays dividends |
| Favourites | `#/favourites` | `mainContent`, `favourites`, `lastPrice` |
| Orders | `#/orders/open` | `openOrders`, `rowDate`, `symbolIsin`, `exchangeAbbr`, the order column fields, `buySellBadge` |
| Transactions | `#/transactions` | `transactions`, `transactionsFilters`, `rowDate`, `txValue`, `txTotal`, `txFee`, `txPrice`, `txLocalValue` |
| Portfolio | `#/portfolio` | `perfChart`, `perfValue`, `perfAmount`, `perfArea`, `cashCompensation`, `appLayout` |
| Any page with the bottom panel | | `panelToggle`, `openOrderRow`, `orderEditButton` |

**Conditional selectors**: report these as *not verifiable*, not as drift, when the account state doesn't allow them: `openOrderRow`, `orderEditButton` and the order fields (no open orders), `pageButtons` (only one page of transactions), `drawerToggle` (mobile width only), `orderDetails` (needs the Adjust order form: never open it), `exDividendDate` (no upcoming dividend), `cashCompensation` (no cash fund). Ask the user whether they want to open such a state themselves.

**Drift** is: a required selector with 0 matches, `bad selector`, `mainPageSections` ≠ 1, `bidInDdAfterDt` false, or a structural fact that changed. A count that differs from the mock (step 5) but is still ≥ 1 is a note, not drift.

**Label fallbacks**: `LABELS` in `common.js` are used only when a hook is missing. If the probe shows a hook missing but DEGIRO's visible text is there, check whether the matching `LABELS` regex matches the label (compare in the JS tool and return only `true`/`false`).

## 4. Style drift

Compare the real computed values (normalised to upper-case hex) with every hard-coded colour and font in `extension/`:

```
grep -nE "#[0-9A-Fa-f]{6}\b|font-family|Inter" extension/*.js extension/*.css | grep -v options
```

Make one table: constant, `file:line`, what it imitates, the real value, match yes/no. At least: muted label grey (`#798A90`, `#65757B`), up/down green and red (`#1E8302`, `#078307`, `#E3282B`, `#E40101`), DEGIRO blue (`#009FDF`, `#0095D2`), text (`#0F171A`), line (`#D6DFE3`), the font stack (`Inter, Helvetica, HelveticaNeue, sans-serif`) and font sizes. Two constants for the same role with different values (for example two blues) are a finding: say which one the real page uses.

Also look at the extension's own elements next to DEGIRO's, if the user has the release candidate loaded (step 6): take one screenshot of the product header and one of the Orders table and check that font, size, colour and alignment match the surrounding DEGIRO text.

Only the user's current DEGIRO theme can be checked. Note it (light/dark from the body background) and list the other theme's constants as unverified. Never switch the theme.

## 5. Mock parity

The tests are only as good as the mock. Compare the real counts and structure with the mock fixtures (`tests/fixtures/*.html`).

**Pages without a chart** (favourites, orders, transactions): use the integration harness, which loads a fixture in JSDOM, runs its inline scripts, then the extension's isolated-world scripts. Write a one-off script in the scratchpad (never in `tests/`) and run it with `node`:

```js
const { createWorld } = require('<repo>/tests/integration/harness.js');
(async () => {
  const world = createWorld();
  for (const [fixture, hash] of [['favourites', '/favourites'], ['orders', '/orders/open'], ['transactions', '/transactions']]) {
    const tab = await world.open({ fixture, hash });
    await world.advance(500);
    console.log(fixture, JSON.stringify(tab.json(`Object.fromEntries(Object.entries(__dgt.SEL).map(([k, s]) =>
      [k, [...document.querySelectorAll(s)].filter(e => !e.closest('[data-dg-own]')).length]))`)));
  }
  process.exit(0);
})();
```

**Product and portfolio** (`degiro.html`, `portfolio.html`) need Highcharts and `fetch`, which only the e2e routes provide, so they don't load in JSDOM. Compare their hooks from the source instead:

```
grep -oE 'data-(name|field)=\\?"?[A-Za-z-]+' tests/fixtures/degiro.html | sed -E 's/\\?"//' | sort | uniq -c
```

JSDOM has no computed styles either. For colours and fonts, grep the fixture CSS (`grep -nE "#[0-9A-Fa-f]{6}|font" tests/fixtures/*.html`).

Findings: a hook the real page has and the mock lacks (or the other way round) on a page a feature uses, a real structure the mock doesn't reproduce, or mock colours that differ from the real page. If the real page drifted, the fix includes extending the mock to match (CLAUDE.md).

## 6. Extension output on the real page (optional)

This counts only if the user has loaded the release candidate unpacked (`chrome://extensions` → Load unpacked → `extension/`, or the built zip). Ask them; don't assume, and don't change their extensions yourself. If they have:
- On each page from step 3, read the `data-dg-status` attribute (it's JSON of feature → `ok`/`idle`/`missing`; return only that object). A `missing` for a feature whose page is open is a drift signal: name the feature.
- Check that the visible additions are there: the Spread row and header items on a product page, the Orders/Transactions/Alarms sidebar items, the filters and totals on Orders and Transactions, the period change on Portfolio. Screenshots are fine for the user; don't save them in the repo.

## 7. Go/no-go report

Wait for the `run-tests` result, then report:

1. **Verdict**: GO or NO-GO, with the version and the commit (`git rev-parse --short HEAD`).
2. **Preflight**: one line per check, pass/fail.
3. **Tests**: `ok` and passed/failed/skipped/flaky per stage, and every failure (`file:line`, title).
4. **Selectors and structure**: drift found (selector, page, real count, mock count), then *not verifiable* with the reason.
5. **Styles**: the mismatch table (constant, `file:line`, real value).
6. **Mock parity**: the differences.
7. **Unverified**: the other theme, conditional selectors, the extension output if no release candidate was loaded, and anything skipped with `--skip-site`.

NO-GO if any preflight check fails, any test fails, a required selector or structural fact drifted, or a style constant visibly mismatches the real page. Each clear defect is fixed in a fresh bug-fix sub-agent (CLAUDE.md: symptom, where it shows, what not to touch, a test that fails without the fix, the mock extended to match the real page), then go through `run-tests` → `review` → `update-docs` → `review` → commit, and run this skill again.

On GO, give the user the commands to run themselves, and don't run them:

```
git tag v<version> && git push origin v<version>
```

The `release.yml` workflow then tests, uploads to the Chrome Web Store, submits for review and creates the GitHub Release. Remind the user to check its run (`gh run watch`), and that the store review takes time.
