---
name: pre-commit-review
description: Use before every git commit in this repo (after update-docs), and when the user says "review" or "code review". Reviews the pending changes of Tweaks for DEGIRO against the project's safety, store and robustness rules, runs the tests, and reports findings by priority.
---

# Pre-commit code review

Review the changes about to be committed for "Tweaks for DEGIRO (unofficial)". Find real defects, not style. The tests already cover the invariants they encode. Look for what they miss.

## Steps

1. **Collect the change.** Run `git status --short`, `git diff`, `git diff --cached`, and list untracked files. If only `.md` files changed, check only the doc rules below and skip the tests.
2. **Read every changed source file in full**, not just the hunks. For changes to `common.js`, also read the scripts that use the changed names (`grep -n "<name>" extension/*.js`).
3. **Check the change against the checklist below.** For each suspected problem, trace it in the code or reproduce it with a test before reporting it. Drop anything you can't back up.
4. **Run `npm test`** (typecheck, lint, unit, e2e). If the change touches one feature only, run its spec first for a quick signal, then the full suite. If the run takes long, use `run_in_background`.
5. **Report** in the format below. Fix P1 findings before the commit, or ask the user if the fix is a judgement call. Don't commit with a failing test.

## Checklist

**Safety and store rules.** These must never regress; also look for workarounds the tests miss.
- The permissions are only `storage`, there are no new manifest keys that widen access, and content scripts match only `https://trader.degiro.nl/trader/*` in the top frame.
- `fetch` goes only to same-origin paths starting with a single `/`, never to `//host`. No variable or computed URL may lead off-origin.
- No `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `postMessage`, `eval`, `Function(…)`, string timers or injected `<script>`.
- `innerHTML` is only ever set to `''`. No `insertAdjacentHTML`, `setHTMLUnsafe` or `document.write`. Texts the page can set (`data-dg-i18n`, `data-dg-tweaks`, DEGIRO's DOM) are used only as `textContent`/`title`.
- The extension never clicks Confirm, Delete or submit, never calls `requestSubmit()`/`.submit()`, and never fills order fields. It only opens forms or presses Cancel/×.
- The session id is never stored or logged. No `console.log/info/debug`.
- Only the keys in `DG_PAGE_FLAGS` reach `data-dg-tweaks`. A new MAIN-world flag also updates `tests/e2e/bridge.spec.js`.

**Load on DEGIRO.** This is a terms-of-use risk.
- Every network request is rate-limited, including after failures: a failure must never reset the timer to "now". Check 401/403, 5xx, bad JSON, a hung request (`loading` stuck) and a failed fallback.
- Polling runs only while the tab is visible and the feature is on, and never faster than DEGIRO's own polling (orders every 20 s).
- A value read from the extension's own requests (for example the session from its own URL) must not feed back into the next request.

**Execution worlds.**
- MAIN-world files (`common.js`, `chart-select.js`, `orders.js`, `period.js`, `portfolio.js`) use no `chrome.*`, `dgSettings` or `dgOnSettings`.
- `common.js` was edited, `npm run sync-common` was run, and `common-isolated.js` matches.
- A new file is listed in both `manifest.json` and the matching `tsconfig.*.json` `files`.

**Scheduler and DOM.**
- Every feature goes through `feature({…})`. `run()` is idempotent, returns `ok`/`idle`/`missing`, and `stop()` removes everything the feature added.
- Every inserted element is marked with `own(el)`. Look for render loops, where our own change re-triggers a run that changes the page again.
- Work per run stays cheap. No full-page `querySelectorAll`, `getComputedStyle` or layout read on every frame without a throttle or cache, especially on chart hover.
- Settings apply live, with no reload, in both directions (on → off → on).

**Robustness against DEGIRO's page.**
- New selectors and label patterns go in `SEL`/`LABELS` in `common.js`, not in feature files.
- Prefer DEGIRO's language-independent hooks (`data-name`, `data-field`, `data-id`, `data-action`, `data-value`) over visible text. Text matching is only a fallback, and must cover nl, de, fr, es, it and pt, not just English.
- Real-page facts to respect: every product widget sits in one `section[data-name=mainPageSection]`, the chart included; there is a hidden `[data-name=measurer]` copy of Pricing data; `RelativeDifference` appears several times; `Highcharts.charts` has `null` entries.
- Numbers parse both `1.234,56` and `1,234.56`. Missing elements or values degrade quietly (`missing`/`idle`, no exception, no wrong number).
- Anything hidden, closed or clicked must be the intended element only. Ask what happens when the match is ambiguous: refusing is better than acting on the wrong order or section.

**Translations.**
- Every visible text goes through `__dgt.t(key)` or `data-i18n`. New keys exist in all 7 `_locales` with the same placeholders. MAIN-world keys are listed in `PAGE_TEXTS`.
- Terms match DEGIRO's own wording in each language, for example "Adjust order", nl "Order aanpassen", "Prijsdata".
- `extDescription` stays at 132 characters or fewer and keeps the "not affiliated" phrase in every language.

**Tests.** Always check that every changed or new piece of functionality is covered by tests.
- Unit tests (`tests/unit/`) for logic that runs without a page: parsing, sanitising, the manifest, translations, the static source rules.
- E2E tests (`tests/e2e/`) for behaviour on the page: what appears, what is clicked, what requests go to DEGIRO and how often, settings on → off → on.
- Where both apply, both. Missing coverage for a behaviour change is a finding (P2, or P1 when it guards safety or load on DEGIRO).
- A test must fail without the change. If unsure, check it against the old code (`git stash` the source file and run the spec).
- When a feature depends on new DEGIRO DOM, the mock (`tests/fixtures/*.html`) is extended to match. The mock must not drift further from the real page.
- No `zz-*` or other scratch files are left in `tests/`.

**Docs.** `update-docs` normally handles these; just check them.
- The CHANGELOG has the user-visible change. The README Settings table matches `DG_DEFAULTS`. PRIVACY.md and STORE_LISTING.md are updated if the data accessed or the requests made changed.
- The manifest version is bumped only when the user asked for it.

## Report format

Start with one line: what you reviewed (files, about how many lines) and the `npm test` result (passed/failed/skipped counts).

Then the findings, most severe first. Each finding gets:
- its priority:
  - **P1**: unsafe, breaks a store rule, loads DEGIRO, or breaks a main feature. Blocks the commit.
  - **P2**: breaks quietly in some languages or layouts, or wastes work.
  - **P3**: minor.
- `file:line`;
- the concrete failure: which input or page state leads to what wrong result;
- the proposed fix;
- whether it is **confirmed** (traced or reproduced) or **likely**.

If nothing survives checking, say "No findings". Then list any open questions for the user. Keep it short, and don't restate the checklist.
