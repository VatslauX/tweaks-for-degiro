---
paths:
  - "extension/**/*"
---

# Extension architecture

## Execution worlds

The manifest declares two content-script worlds:

- **Isolated world:** `common-isolated.js`, `flags.js`, `content.js`, `exdiv.js`, `compact.js`, `hide.js`, `adjust-close.js`, `ui.js`, `orders-table.js`, `alarm-rules.js`, `alarms.js`, `alarm-panel.js`, `alarms-page.js`, `nav.js`, and `status.js`. These can use `chrome.storage`.
- **Page world (`world: "MAIN"`):** `common.js`, `chart-select.js`, `orders.js`, `alarm-lines.js`, `period.js`, and `portfolio.js`. These cannot use `chrome.*` or isolated-world settings globals. Highcharts features act only on `__dgt.mainChart()` (the largest visible chart with a price series).
- Each world has its own TypeScript project. Keep the `files` entries in the matching `tsconfig.*.json` aligned with the manifest; the unit tests check this.

## Shared code and scheduling

`common.js` exposes frozen global `__dgt`; Chrome injects a file only once per page, so `common-isolated.js` is its copy. Edit `common.js`, then run `npm run sync-common`.

- Add DEGIRO selectors, label patterns, and routes to `SEL`, `LABELS`, or `page` in `common.js`, not feature files.
- Features use `feature({ name, enabled, run, stop?, every?, throttle? })`. The scheduler has one MutationObserver and timer per world, runs enabled features at most once per frame, and throttles DOM-driven runs to 150 ms unless configured otherwise. Settings changes bypass throttling. Each world's observer watches the `data-dg-tweaks` and `data-dg-alarm-lines` attributes on `<html>`. Timer-only flushes run features whose `every` interval is due. `stop()` runs once when disabled.
- `run()` must be idempotent, return `ok`, `idle`, or `missing`, and degrade quietly when expected page content is absent. Exceptions are contained per feature.
- Mark inserted elements with `own(el)` (`data-dg-own`) so our DOM changes do not trigger reruns. Avoid render loops and expensive work on every frame.
- Page-world statuses cross to the isolated world in `data-dg-status`; because the page can write it, `status.js` accepts only known feature names and values. Nothing is stored.

## Settings and translations

- `DG_DEFAULTS` in `flags.js` defines the settings stored in `chrome.storage.sync`; `dgSanitize` maps malformed values to defaults, and `dgOnSettings(fn)` runs immediately and on changes. `flags.js` is also loaded by `options.html`.
- Page-world scripts receive settings only in the `data-dg-tweaks` JSON attribute on `<html>`. It must contain only keys listed in `DG_PAGE_FLAGS`, because page scripts can read it. Adding a page-world flag also requires updating `tests/e2e/bridge.spec.js`. Settings apply live without reload.
- A failed `chrome.storage.sync` read keeps the last good settings and retries (1 s, doubling to 30 s); before the first good read, `data-dg-tweaks` is not written, so page-world features stay off.
- If the extension is disabled, removed, or updated, `flags.js` detects that `chrome.runtime.id` is gone (checked every 2 s) and switches all flags off, stopping both worlds.
- Locales live in `_locales/<lang>/messages.json`; `default_locale` is English and the extension name stays English. Visible text uses `__dgt.t(key, ...subs)` or `data-i18n` in `options.html`. Page-world text keys must also be in `PAGE_TEXTS` in `common.js`; page-controlled text is used only as `textContent` or `title`.

## DEGIRO-specific feature notes

- **Orders (`orders.js`):** `sessionId` and `intAccount` are discovered from DEGIRO's own resource requests. Only when none is observed after 5 s, a fallback runs at most once a minute: `/login/secure/config` reads `data.sessionId`; `/pa/secure/client?sessionId=` reads only `data.intAccount`. A 401/403 rejects that session permanently. Retry delay starts at 20 s and doubles to 5 min. Ignore the extension's own request URLs in the session watcher. `portfolio.js` retries failed value requests after 30 s, doubling. Orders poll the same-origin `/trading/secure/v5/update/{acc};jsessionid={sid}?orders=0` every 20 s. Clicking a badge may open DEGIRO's Adjust order form only after uniquely matching its Outstanding order row. A panel toggle with `data-value` other than `opened` means the panel is minimized.
- **Price alarms:** isolated-world DOM reads only, no requests. Prices come from Favourites (`LastPrice`) and product page (`CurrentPrice`), and checks run only while one of those is open. `dgAlarms` is synced across the Chrome profile (max 25); `dgAlarmState` and `dgAlarmEvents` are local to the browser. “Every time” arming is tab memory only. Cross-tab duplicate suppression uses 60 s, or the same local day for “Once a day”; near-simultaneous tabs can race, with one event retained. Banners appear in every DEGIRO tab. `nav.js` counts them only while `navLinks` and `priceAlarms` are enabled.
- **Alarms page route:** `#/favourites?dg=alarms`. Inside `#/favourites…` DEGIRO keeps the query sticky (it merges the old query back into every move), so a click on one of DEGIRO's favourites links from the Alarms page is intercepted and sent to `href` + `dg=` (an empty value), which DEGIRO then drops.
- **Alarm badges on the chart (`alarm-lines.js`, flag `alarmLines`, needs `priceAlarms`):** `alarms.js` writes only the open product's id and its switched-on alarms' price and direction to `data-dg-alarm-lines` on `<html>` (e.g. `{"id":123,"l":[{"p":20,"d":"above"}]}`); the page can read and write it, so `alarm-lines.js` validates it strictly and ignores the whole value on any bad entry. Gold HTML badges at the price on the main chart's right edge, ▲/▼ pinned when out of range; no plot lines.
- **Product header:** period change, header spread, and ex-dividend date share a wrapping `[data-dg-header]` container after DEGIRO's price line, ordered by `data-dg-rank`. Each feature removes only its own item and removes the container when empty.
- **DOM robustness:** prefer language-independent hooks such as `data-field` and `data-name`, with localized label text as fallback. Parse both `1.234,56` and `1,234.56`; reapply after DEGIRO rerenders through the scheduler. Copy DEGIRO's palette and fonts.
