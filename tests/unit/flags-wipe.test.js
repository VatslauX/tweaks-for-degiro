// extension/flags.js dgDropWiped(): after "Clear saved data" (options.js leaves dgWiped in chrome.storage.local),
// a DEGIRO tab drops the cash-columns switch kept in DEGIRO's own localStorage. Whatever the page's storage or the
// marker holds, it must never throw, and it must act only on DEGIRO.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FLAGS_JS = path.join(__dirname, '../../extension/flags.js');
const source = fs.readFileSync(FLAGS_JS, 'utf8');

/** a sandbox whose page storage is `store` (or throws) and whose marker is `wiped` */
function load({ host = 'trader.degiro.nl', wiped, store = { dgTweaksCashLines: '1' }, throws = false } = {}) {
  const ls = {
    getItem: k => { if (throws) throw new Error('denied'); return k in store ? store[k] : null; },
    setItem: (k, v) => { if (throws) throw new Error('denied'); store[k] = String(v); },
    removeItem: k => { if (throws) throw new Error('denied'); delete store[k]; }
  };
  const chrome = { storage: { local: { get: async d => ({ ...d, ...(wiped === undefined ? {} : { dgWiped: wiped }) }) } } };
  // dgDropWiped checks the protocol and host, so the location is https; flags.js's extension-alive timer (http
  // pages only) gets a setInterval that starts nothing, so nothing is left running
  const sandbox = { location: { protocol: 'https:', hostname: host }, document: { documentElement: { setAttribute() {} } }, localStorage: ls, chrome,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {} };
  const { dgDropWiped } = vm.runInNewContext(`${source}\n;({ dgDropWiped });`, sandbox, { filename: FLAGS_JS });
  return { dgDropWiped, store };
}

test('a newer marker drops the switch and remembers the marker; the same marker again leaves it', async () => {
  const { dgDropWiped, store } = load({ wiped: 1000 });
  await dgDropWiped();
  assert.equal(store.dgTweaksCashLines, undefined);
  assert.equal(store.dgTweaksWiped, '1000');
  store.dgTweaksCashLines = '1';
  await dgDropWiped();
  assert.equal(store.dgTweaksCashLines, '1');
});

test('no marker, or one that is not a number, leaves the switch', async () => {
  for (const wiped of [undefined, 'x', NaN, -5, null]) {
    const { dgDropWiped, store } = load({ wiped });
    await dgDropWiped();
    assert.equal(store.dgTweaksCashLines, '1', String(wiped));
  }
});

test('a page localStorage that throws: no error, nothing done', async () => {
  const { dgDropWiped } = load({ wiped: 1000, throws: true });
  await assert.doesNotReject(dgDropWiped());
});

test('not on DEGIRO (the options page loads flags.js too): nothing done', async () => {
  const { dgDropWiped, store } = load({ wiped: 1000, host: 'abc' });
  await dgDropWiped();
  assert.equal(store.dgTweaksCashLines, '1');
});
