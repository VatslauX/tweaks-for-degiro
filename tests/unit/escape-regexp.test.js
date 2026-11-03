// tests/e2e/regexp.js: e2e specs build RegExps from literal strings; every special character must be escaped.
const { test } = require('node:test');
const assert = require('node:assert');
const { escapeRegExp } = require('../e2e/regexp.js');

test('escapes every RegExp special character, so a string matches only itself', () => {
  const s = 'a\\b (1+2) $ 3.5 * ? ^ | [x] {2} / -';
  const re = new RegExp(`^${escapeRegExp(s)}$`);
  assert.ok(re.test(s));
  assert.ok(!re.test(s.replace('.', 'x')), '. is literal');
  assert.ok(!re.test('a\\b (11+2) $ 3.5 * ? ^ | [x] {2} / -'), '+ is literal');
});

test('leaves ordinary text alone', () => {
  assert.strictEqual(escapeRegExp('Extension 1.21.1 · en'), 'Extension 1\\.21\\.1 · en');
  assert.strictEqual(escapeRegExp('€'), '€');
});
