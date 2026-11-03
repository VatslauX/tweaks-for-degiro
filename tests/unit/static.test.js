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

test('no remote code or third-party network calls', () => {
  for (const [f, s] of Object.entries(src)) {
    for (const m of s.matchAll(/https?:\/\/[^\s'"`)]+/g)) assert.fail(`${f} references ${m[0]}`);
    assert.doesNotMatch(s, /importScripts|document\.createElement\(\s*['"]script/, f);
    // no other ways to send data than the checked fetch below
    assert.doesNotMatch(s, /XMLHttpRequest|sendBeacon|WebSocket|EventSource|\bimport\s*\(/, f);
  }
  const html = fs.readFileSync(path.join(EXT, 'options.html'), 'utf8');
  for (const m of html.matchAll(/(src|href)="([^"]+)"/g)) assert.doesNotMatch(m[2], /^(https?:)?\/\//, `options.html loads ${m[2]}`);
});

// fetch arguments that aren't literals, each checked by hand: both are built from a same-origin path
const FETCH_VARS = {
  'orders.js': ['path'], // `/trading/secure/v5/update/...` built just above
  'portfolio.js': ['target.pathname + target.search'] // DEGIRO's own request URL, origin checked in seen()
};
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
