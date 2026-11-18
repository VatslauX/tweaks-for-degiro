// Static checks on the extension source: things a store reviewer (or attacker) would look for.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const EXT = path.resolve(__dirname, '../../extension');
const jsFiles = fs.readdirSync(EXT, { recursive: true }).map(String).filter(f => f.endsWith('.js'));
const src = Object.fromEntries(jsFiles.map(f => [f, fs.readFileSync(path.join(EXT, f), 'utf8')]));

test('no eval / new Function / string timers', () => {
  for (const [f, s] of Object.entries(src)) {
    assert.doesNotMatch(s, /\beval\s*\(|\bFunction\s*\(|set(Timeout|Interval)\s*\(\s*['"`]/, f);
  }
});

// The only addresses in the source, all for the opt-in background check: Yahoo Finance's price data and Société
// Générale's quotes of its own products (the worker fetches them; the settings page asks for their permissions) and
// DEGIRO's product page (opened from a notification).
const URLS = {
  'background.js': ['https://query1.finance.yahoo.com', 'https://sgbeurs.nl', 'https://trader.degiro.nl/trader/#/products/'],
  'options.js': ['https://query1.finance.yahoo.com/*', 'https://sgbeurs.nl/*']
};
test('no remote code or third-party network calls', () => {
  for (const [f, s] of Object.entries(src)) {
    for (const m of s.matchAll(/https?:\/\/[^\s'"`)]+/g)) assert.ok((URLS[f] || []).includes(m[0]), `${f} references ${m[0]}`);
    // the worker loads only the shared alarm rules, from the extension itself
    const rest = f === 'background.js' ? s.replace("importScripts('alarm-rules.js');", '') : s;
    assert.doesNotMatch(rest, /importScripts|document\.createElement\(\s*['"]script/, f);
    // no other ways to send data than the checked fetch below
    assert.doesNotMatch(s, /XMLHttpRequest|sendBeacon|WebSocket|EventSource|\bimport\s*\(/, f);
  }
  const html = fs.readFileSync(path.join(EXT, 'options.html'), 'utf8');
  for (const m of html.matchAll(/(src|href)="([^"]+)"/g)) assert.doesNotMatch(m[2], /^(https?:)?\/\//, `options.html loads ${m[2]}`);
});

// fetch arguments that aren't literals, each checked by hand: both are built from a same-origin path
const FETCH_VARS = {
  'orders.js': ['path'], // `/trading/secure/v5/update/...` built just above
  // DEGIRO's own request URL, origin checked in seen(); getJson(st, path) gets only the literal
  // `const path = '/...'` statements of loadFunds and loadStatement (checked below)
  'portfolio.js': ['target.pathname + target.search', 'path'],
  // the Yahoo Finance and SG origins plus a literal path (checked below), only in the worker
  'background.js': ['YAHOO + path', 'SG + path'],
  // DEGIRO's product details for alarm products not linked yet (background check only; checked below)
  'alarms.js': ['path']
};
test('the alarms ask DEGIRO only for product details: ids out, only with the background check on', () => {
  const s = src['alarms.js'];
  const paths = [...s.matchAll(/const path = `([^`]*)`/g)].map(m => m[1]);
  assert.deepStrictEqual(paths, ['/product_search/secure/v5/products/info?intAccount=${acc}&sessionId=${encodeURIComponent(s)}']);
  assert.strictEqual([...s.matchAll(/\bfetch\(/g)].length, 1);
  assert.match(s, /fetch\(path, \{ method: 'POST', credentials: 'include', headers: \{ 'Content-Type': 'application\/json' \},\s*body: JSON\.stringify\(ids\.map\(String\)\)/);
  assert.match(s, /if \(!dgSettings\.alarmsBackground \|\| busy/);
});
test('the background worker fetches only Yahoo Finance price paths, without cookies', () => {
  const s = src['background.js'];
  assert.match(s, /^\s*const YAHOO = 'https:\/\/query1\.finance\.yahoo\.com';$/m);
  assert.match(s, /fetch\(YAHOO \+ path, \{ credentials: 'omit'/);
  assert.strictEqual([...s.matchAll(/\byahoo\(/g)].length, [...s.matchAll(/\bawait yahoo\(/g)].length + 1, 'yahoo() is called only as `await yahoo(...)`');
  const calls = [...s.matchAll(/\bawait yahoo\(\s*([^,)]*)/g)].map(m => m[1].trim());
  assert.ok(calls.length >= 2);
  // price data (chart, spark), and the ISIN search used only as a fallback when a ticker doesn't fit
  for (const c of calls) assert.match(c, /^`\/(v8\/finance\/(chart|spark)[/?]|v1\/finance\/search\?q=)/, `yahoo(${c})`);
});
test('the background worker asks Société Générale only for its products\' fields and quotes, without cookies', () => {
  const s = src['background.js'];
  assert.match(s, /^\s*const SG = 'https:\/\/sgbeurs\.nl';$/m);
  assert.match(s, /fetch\(SG \+ path, \{ credentials: 'omit'/);
  assert.strictEqual([...s.matchAll(/\bsg\(/g)].length, [...s.matchAll(/\bawait sg\(/g)].length + 1, 'sg() is called only as `await sg(...)`');
  const calls = [...s.matchAll(/\bawait sg\((`[^`]*`|R\.sgSnapshotPath\([^)]*\))\)/g)].map(m => m[1]);
  assert.deepStrictEqual(calls.map(c => c.startsWith('R.sgSnapshotPath(') ? 'snapshot' : c).sort(),
    ['`/EmcWebApi/api/Products/ValuesForWatchlist/${encodeURIComponent(isin)}`', 'snapshot']);
});
test('fetch is only used for DEGIRO same-origin paths', () => {
  for (const [f, s] of Object.entries(src)) {
    for (const m of s.matchAll(/\bfetch\(\s*([^,)]*)/g)) {
      const arg = m[1].trim(), lit = arg.match(/^([`'"])(.*)/);
      if (lit) assert.match(lit[2], /^\/(?!\/)/, `${f}: fetch(${arg}) must be a same-origin path, not //host`);
      else assert.ok((FETCH_VARS[f] || []).includes(arg), `${f}: fetch(${arg}) — use a literal path or add it to FETCH_VARS after checking it`);
    }
    for (const m of s.matchAll(/const path = ([`'"])(.*)/g)) assert.match(m[2], /^\/(?!\/)/, `${f}: ${m[0]}`);
  }
});

test('session id is never stored, logged or posted', () => {
  for (const [f, s] of Object.entries(src)) {
    assert.doesNotMatch(s, /console\.(log|info|debug)/, `${f} logs to console`);
    assert.doesNotMatch(s, /postMessage/, `${f} uses postMessage`);
    if (/\bsid\b/.test(s)) assert.doesNotMatch(s, /(localStorage|sessionStorage|chrome\.storage)[^\n]*\bsid\b/, f);
  }
});

test('the extension never presses Confirm or Delete', () => {
  for (const [f, s] of Object.entries(src)) {
    assert.doesNotMatch(s, /orderDeleteButton|type=["']?submit["']?\]|\bconfirm\b.*\.click\(|requestSubmit|\.submit\(/i, f);
  }
});

test('innerHTML is only ever cleared, never assigned content', () => {
  for (const [f, s] of Object.entries(src)) {
    for (const m of s.matchAll(/(innerHTML|outerHTML)\s*\+?=\s*([^;\n]*)/g)) {
      assert.match(m[2].trim(), /^(''|"")$/, `${f}: ${m[0].slice(0, 60)}`);
    }
    assert.doesNotMatch(s, /insertAdjacentHTML|document\.write|setHTMLUnsafe|parseHTMLUnsafe|createContextualFragment/, f);
  }
});

test('extension source is English only (no Cyrillic)', () => {
  for (const f of fs.readdirSync(EXT, { recursive: true }).map(String).filter(f => /\.(js|html|json|css)$/.test(f))) {
    const lines = fs.readFileSync(path.join(EXT, f), 'utf8').split('\n');
    lines.forEach((l, i) => assert.doesNotMatch(l, /[\u0400-\u04FF]/, `${f}:${i + 1}`));
  }
});

test('number parsing and formatting live only in common.js', () => {
  for (const [f, s] of Object.entries(src)) {
    if (f.startsWith('common')) continue;
    assert.doesNotMatch(s, /toLocaleString\(\s*'nl-NL'/, `${f}: use __dgt.fmt`);
    assert.doesNotMatch(s, /function pageTheme|getAttribute\('data-dg-tweaks'\)/, `${f}: use __dgt`);
  }
});

test('shared helpers are loaded first in both worlds', () => {
  const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  for (const cs of m.content_scripts) assert.strictEqual(cs.js[0], cs.world === 'MAIN' ? 'common.js' : 'common-isolated.js');
});

test('common-isolated.js is an exact copy of common.js (run npm run sync-common)', () => {
  assert.strictEqual(src['common-isolated.js'], src['common.js']);
});
