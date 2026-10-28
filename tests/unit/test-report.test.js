// scripts/test-report.js: argument scope and the parsers behind the agents' structured test summary.
// Fed with fixture output; nothing here runs tsc, ESLint or Playwright.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { parseArgs, parseTsc, parseEslint, summarizeNodeTest, summarizePlaywright, trimError, format } = require('../../scripts/test-report.js');

const ROOT = path.resolve(__dirname, '../..');
const E2E = path.join(ROOT, 'tests/e2e');
const ESC = String.fromCharCode(27);

test('scope: no argument runs every stage; a spec, -g or a .test.js file picks its stage', () => {
  assert.deepStrictEqual([...parseArgs([]).stages], ['typecheck', 'lint', 'unit', 'e2e']);
  const g = parseArgs(['-g', 'adds a Spread row']);
  assert.deepStrictEqual([...g.stages], ['e2e']);
  assert.deepStrictEqual(g.e2eArgs, ['-g', 'adds a Spread row']);
  assert.deepStrictEqual(parseArgs(['--grep=x']).e2eArgs, ['-g', 'x']);
  assert.deepStrictEqual(parseArgs(['tests/e2e/bridge.spec.js:12']).e2eArgs, ['tests/e2e/bridge.spec.js:12']);
  const u = parseArgs(['tests/unit/static.test.js', 'lint']);
  assert.deepStrictEqual([...u.stages].sort(), ['lint', 'unit']);
  assert.deepStrictEqual(u.unitFiles, ['tests/unit/static.test.js']);
});

test('scope: unknown arguments and a bare -g are rejected, not run as the full suite', () => {
  assert.throws(() => parseArgs(['bogus']), /unknown argument: bogus/);
  assert.throws(() => parseArgs(['-g']), /needs a test name/);
});

test('trimError drops ANSI codes, blank lines, code frames, stack frames and the call log', () => {
  const msg = `Error: ${ESC}[2mexpect(${ESC}[22mreceived).toBe(expected)\n\nExpected: ${ESC}[32m2${ESC}[39m\nReceived: 1\n\n` +
    '  3 |   test(\'x\', () => {\n> 4 |     expect(1).toBe(2);\n    |               ^\nCall log:\n  - waiting\n    at /x.spec.js:4:5';
  assert.deepStrictEqual(trimError(msg), ['Error: expect(received).toBe(expected)', 'Expected: 2', 'Received: 1']);
  assert.ok(trimError('a\n'.repeat(50)).length <= 8);
  assert.ok(trimError('x'.repeat(1000))[0].length <= 200);
});

test('parseTsc reads file(line,col): error TS…, with continuation lines', () => {
  const out = 'extension/orders.js(12,5): error TS2339: Property \'foo\' does not exist on type \'Bar\'.\n' +
    '  Did you mean \'for\'?\nextension/period.js(3,1): error TS2304: Cannot find name \'chrome\'.\n';
  assert.deepStrictEqual(parseTsc(out), [
    { stage: 'typecheck', location: 'extension/orders.js:12', title: 'TS2339', error: ['Property \'foo\' does not exist on type \'Bar\'.', 'Did you mean \'for\'?'] },
    { stage: 'typecheck', location: 'extension/period.js:3', title: 'TS2304', error: ['Cannot find name \'chrome\'.'] }
  ]);
  assert.deepStrictEqual(parseTsc(''), []);
});

test('parseEslint counts files and lists errors (not warnings) with repo-relative paths', () => {
  const json = JSON.stringify([
    { filePath: path.join(ROOT, 'extension/a.js'), errorCount: 0, messages: [{ line: 1, ruleId: 'x', severity: 1, message: 'warn' }] },
    { filePath: path.join(ROOT, 'scripts/b.js'), errorCount: 1, messages: [{ line: 7, ruleId: 'no-unused-vars', severity: 2, message: '\'x\' is defined but never used.' }] }
  ]);
  assert.deepStrictEqual(parseEslint(json), {
    passed: 1, failed: 1,
    failures: [{ stage: 'lint', location: 'scripts/b.js:7', title: 'no-unused-vars', error: ['\'x\' is defined but never used.'] }]
  });
});

test('summarizeNodeTest counts tests (not suites) and reports the failing assertion line', () => {
  const file = path.join(ROOT, 'tests/unit/x.test.js');
  let cause;
  try { require('node:assert').strictEqual(2, 3); } catch (e) { cause = e; }
  cause.stack = `AssertionError [ERR_ASSERTION]: ${cause.message}\n    at TestContext.<anonymous> (${file}:14:12)\n    at Test.runInAsyncScope (node:async_hooks:211:14)`;
  const error = Object.assign(new Error('test failed'), { cause });
  const events = [
    { type: 'test:start', data: { name: 'ok', file } },
    { type: 'test:pass', data: { name: 'ok', file, line: 3, details: { duration_ms: 1 } } },
    { type: 'test:pass', data: { name: 'later', file, line: 5, skip: 'why', details: {} } },
    { type: 'test:fail', data: { name: 'adds up', file, line: 12, details: { error } } },
    { type: 'test:fail', data: { name: 'thrower', file, line: 20, details: { error: Object.assign(new Error('test failed'), { cause: new TypeError('boom') }) } } },
    { type: 'test:fail', data: { name: 'group', file, line: 10, details: { type: 'suite', error } } }
  ];
  const s = summarizeNodeTest(events);
  assert.deepStrictEqual([s.passed, s.failed, s.skipped], [1, 2, 1]);
  assert.deepStrictEqual(s.failures[0], { stage: 'unit', location: 'tests/unit/x.test.js:14', title: 'adds up', error: ['Expected values to be strictly equal:', '2 !== 3'] });
  assert.deepStrictEqual(s.failures[1], { stage: 'unit', location: 'tests/unit/x.test.js:20', title: 'thrower', error: ['TypeError: boom'] });
});

// trimmed from a real `playwright test --reporter=json` run (1.56)
const pwReport = {
  config: { rootDir: E2E },
  suites: [{
    title: 'orders.spec.js', file: 'orders.spec.js', line: 0, specs: [
      { title: 'shows badges', file: 'orders.spec.js', line: 5, tests: [{ status: 'expected', results: [{ status: 'passed', errors: [] }] }] },
      { title: 'retried', file: 'orders.spec.js', line: 9, tests: [{ status: 'flaky', results: [{ status: 'failed' }, { status: 'passed', errors: [] }] }] }
    ],
    suites: [{
      title: 'outer', file: 'orders.spec.js', line: 2, specs: [
        { title: 'expect fails', file: 'orders.spec.js', line: 3, tests: [{ status: 'unexpected', results: [{ status: 'failed', errors: [{
          location: { file: path.join(E2E, 'orders.spec.js'), line: 4, column: 24 },
          message: `Error: ${ESC}[2mexpect(${ESC}[22m${ESC}[31mreceived${ESC}[39m${ESC}[2m).${ESC}[22mtoBe${ESC}[2m(${ESC}[22m${ESC}[32mexpected${ESC}[39m${ESC}[2m) // Object.is equality${ESC}[22m\n\nExpected: ${ESC}[32m2${ESC}[39m\nReceived: ${ESC}[31m1${ESC}[39m\n\n  3 |   test('expect fails', async () => {\n> 4 |     expect({ a: 1 }.a).toBe(2);\n    |                        ^\n    at ${path.join(E2E, 'orders.spec.js')}:4:24`
        }] }] }] },
        { title: 'times out', file: 'orders.spec.js', line: 6, tests: [{ status: 'unexpected', results: [{ status: 'timedOut', errors: [{ message: 'Test timeout of 500ms exceeded.' }] }] }] },
        { title: 'skipped', file: 'orders.spec.js', line: 7, tests: [{ status: 'skipped', results: [{ status: 'skipped', errors: [] }] }] }
      ]
    }]
  }],
  errors: [],
  stats: { duration: 1297.52, expected: 1, skipped: 1, unexpected: 2, flaky: 1 }
};

test('summarizePlaywright: counts, nested titles, file:line and the expected/received lines', () => {
  const s = summarizePlaywright(pwReport);
  assert.deepStrictEqual([s.passed, s.failed, s.skipped, s.flaky, s.durationS], [2, 2, 1, 1, 1.3]);
  assert.deepStrictEqual(s.failures, [
    { stage: 'e2e', location: 'tests/e2e/orders.spec.js:4', title: 'outer > expect fails',
      error: ['Error: expect(received).toBe(expected) // Object.is equality', 'Expected: 2', 'Received: 1'] },
    { stage: 'e2e', location: 'tests/e2e/orders.spec.js:6', title: 'outer > times out', error: ['Test timeout of 500ms exceeded.'] }
  ]);
});

test('summarizePlaywright: "No tests found" and an empty run are failures, not a pass', () => {
  const none = summarizePlaywright({ config: { rootDir: E2E }, suites: [], errors: [{ message: 'Error: No tests found' }], stats: { duration: 5 } });
  assert.strictEqual(none.failed, 1);
  assert.deepStrictEqual(none.failures[0].error, ['Error: No tests found']);
  const empty = summarizePlaywright({ suites: [], errors: [], stats: {} });
  assert.strictEqual(empty.failed, 1);
  assert.strictEqual(empty.failures[0].title, 'no tests ran');
});

test('format prints valid JSON with one line per stage', () => {
  const stage = { status: 'passed', passed: 1, failed: 0, skipped: 0, durationS: 1, command: 'x' };
  const result = { ok: true, command: 'node scripts/test-report.js', durationS: 1, stages: { typecheck: stage, lint: stage }, failures: [], failuresOmitted: 0 };
  const text = format(result);
  assert.deepStrictEqual(JSON.parse(text), result);
  assert.match(text, /\n {4}"lint": \{"status":"passed"/);
});
