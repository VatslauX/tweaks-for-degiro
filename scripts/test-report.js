// Runs the test stages (typecheck, lint, unit, integration, e2e) and prints ONE JSON summary on stdout,
// for agents (the run-tests skill). `npm test` stays the command for CI and humans.
//
//   node scripts/test-report.js                       all stages (like npm test, but every stage runs)
//   node scripts/test-report.js unit lint             only these stages
//   node scripts/test-report.js tests/e2e/x.spec.js   e2e, one spec (file:line works too)
//   node scripts/test-report.js -g "adds a Spread row"   e2e tests by name
//   node scripts/test-report.js path/to/x.test.js     unit, one file (under tests/integration/: integration)
//
// Exit code: 0 when everything run passed, 1 on any failure (or no tests run), 2 on a bad argument.
// Progress goes to stderr; stdout holds only the JSON.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STAGES = ['typecheck', 'lint', 'unit', 'integration', 'e2e'];
const TS_PROJECTS = ['tsconfig.isolated.json', 'tsconfig.page.json', 'tsconfig.options.json'];
const MAX_FAILURES = 25, MAX_LINES = 8, MAX_LINE = 200;

// ---------- helpers ----------

// eslint-disable-next-line no-control-regex
const stripAnsi = s => String(s ?? '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
const rel = f => {
  if (!f) return f;
  const p = String(f).replace(/^file:\/\//, '');
  if (!path.isAbsolute(p)) return p;
  const r = path.relative(ROOT, p);
  return r.startsWith('..') ? p : r;
};
const loc = (file, line) => file ? (line ? `${rel(file)}:${line}` : rel(file)) : null;
const seconds = ms => Math.round((ms || 0) / 100) / 10;
const quote = a => /^[\w@%+=:,./-]+$/.test(a) ? a : `"${a.replace(/(["\\$`])/g, '\\$1')}"`;

// the first meaningful lines of an error: no ANSI, blanks, stack frames, code frames or call log
function trimError(text) {
  const out = [];
  for (const raw of stripAnsi(text).split('\n')) {
    const line = raw.trimEnd();
    if (/^\s*Call log:/.test(line) || /^\s+at /.test(line)) break;
    if (!line.trim() || /^\s*>?\s*\d+\s*\|/.test(line) || /^\s*\|\s*\^/.test(line)) continue;
    out.push(line.length > MAX_LINE ? line.slice(0, MAX_LINE - 1) + '…' : line);
    if (out.length >= MAX_LINES) break;
  }
  return out;
}

// CLIs are run with this node, from node_modules, without a shell (args are passed as given)
const bin = p => path.join(ROOT, 'node_modules', p);
const stage = (status, extra = {}) => ({ status, passed: 0, failed: 0, skipped: 0, durationS: 0, command: null, ...extra });

function exec(args, env) {
  const t = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...env } });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error, ms: Date.now() - t };
}

// ---------- scope ----------

function parseArgs(argv) {
  const scope = { stages: new Set(), unitFiles: [], integrationFiles: [], e2eArgs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'all') STAGES.forEach(s => scope.stages.add(s));
    else if (STAGES.includes(a)) scope.stages.add(a);
    else if (a === '-g' || a === '--grep') {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a test name`);
      scope.e2eArgs.push('-g', argv[++i]);
    } else if (/^(-g|--grep)=/.test(a)) scope.e2eArgs.push('-g', a.replace(/^(-g|--grep)=/, ''));
    else if (/\.spec\.js(:\d+)*$/.test(a)) scope.e2eArgs.push(a);
    else if (/\.test\.js$/.test(a)) (/(^|[\\/])tests[\\/]integration[\\/]/.test(a) ? scope.integrationFiles : scope.unitFiles).push(a);
    else throw new Error(`unknown argument: ${a} (use typecheck, lint, unit, integration, e2e, all, a *.spec.js / *.test.js path, or -g "<name>")`);
  }
  if (scope.e2eArgs.length) scope.stages.add('e2e');
  if (scope.unitFiles.length) scope.stages.add('unit');
  if (scope.integrationFiles.length) scope.stages.add('integration');
  if (!scope.stages.size) STAGES.forEach(s => scope.stages.add(s));
  return scope;
}

// ---------- typecheck ----------

// tsc --pretty false: "file(line,col): error TS1234: message"
function parseTsc(text) {
  const errors = [];
  for (const line of stripAnsi(text).split('\n')) {
    const m = line.match(/^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/);
    if (m) errors.push({ stage: 'typecheck', location: loc(m[1], m[2]), title: m[3], error: [m[4]] });
    else if (errors.length && /^\s{2,}\S/.test(line) && errors[errors.length - 1].error.length < MAX_LINES)
      errors[errors.length - 1].error.push(line.trim());
  }
  return errors;
}

function runTypecheck() {
  const tsc = bin('typescript/bin/tsc');
  const res = stage('passed', { command: TS_PROJECTS.map(p => `tsc -p ${p} --pretty false`).join(' && ') });
  const failures = [];
  let ms = 0;
  for (const p of TS_PROJECTS) {
    const r = exec([tsc, '-p', p, '--pretty', 'false']);
    ms += r.ms;
    if (r.code === 0) { res.passed++; continue; }
    res.failed++;
    const errs = parseTsc(r.stdout + '\n' + r.stderr);
    failures.push(...(errs.length ? errs : [{ stage: 'typecheck', location: p, title: `tsc -p ${p} failed`, error: trimError(r.stdout + r.stderr || String(r.error)) }]));
  }
  res.durationS = seconds(ms);
  if (res.failed) res.status = 'failed';
  return { res, failures };
}

// ---------- lint ----------

// eslint --format json: [{ filePath, messages: [{ line, ruleId, severity, message }], errorCount }]
function parseEslint(json) {
  const files = JSON.parse(json);
  const failures = [];
  let passed = 0, failed = 0;
  for (const f of files) {
    const errs = f.messages.filter(m => m.severity === 2);
    if (!errs.length) { passed++; continue; }
    failed++;
    for (const m of errs) failures.push({ stage: 'lint', location: loc(f.filePath, m.line), title: m.ruleId || 'parse error', error: [m.message] });
  }
  return { passed, failed, failures };
}

function runLint() {
  const res = stage('passed', { command: 'eslint . --format json' });
  const r = exec([bin('eslint/bin/eslint.js'), '.', '--format', 'json']);
  res.durationS = seconds(r.ms);
  let parsed;
  try { parsed = parseEslint(r.stdout); } catch {
    res.status = 'failed'; res.failed = 1;
    return { res, failures: [{ stage: 'lint', location: null, title: 'eslint did not produce a report', error: trimError(r.stderr || r.stdout) }] };
  }
  Object.assign(res, { passed: parsed.passed, failed: parsed.failed });
  if (parsed.failed || r.code !== 0) res.status = 'failed';
  return { res, failures: parsed.failures };
}

// ---------- unit and integration (node:test) ----------

// summarise node:test events ({ type, data }) as emitted by run() from node:test
function summarizeNodeTest(events, stageName = 'unit') {
  let passed = 0, failed = 0, skipped = 0;
  const failures = [];
  for (const { type, data } of events) {
    if (type !== 'test:pass' && type !== 'test:fail') continue;
    if (data.details?.type === 'suite') continue;
    if (data.skip !== undefined || data.todo !== undefined) { skipped++; continue; }
    if (type === 'test:pass') { passed++; continue; }
    failed++;
    const err = data.details?.error;
    const cause = err?.cause && typeof err.cause === 'object' ? err.cause : err;
    let line = data.line;
    // the failing assertion's line: the first stack frame in the test file
    const file = data.file && String(data.file).replace(/^file:\/\//, '');
    if (file && cause?.stack) {
      const frame = String(cause.stack).split('\n').find(l => l.includes(file + ':'));
      const m = frame && frame.slice(frame.indexOf(file + ':') + file.length + 1).match(/^(\d+)/);
      if (m) line = Number(m[1]);
    }
    const named = cause?.name && !/^(AssertionError|Error)$/.test(cause.name) ? `${cause.name}: ` : '';
    let error = trimError(named + (cause?.message ?? String(cause ?? err ?? 'test failed')));
    if (cause && 'expected' in cause && 'actual' in cause && !error.some(l => /expected|actual|!==|===/i.test(l)))
      error = [...error, `expected: ${JSON.stringify(cause.expected)}`.slice(0, MAX_LINE), `actual: ${JSON.stringify(cause.actual)}`.slice(0, MAX_LINE)];
    failures.push({ stage: stageName, location: loc(file, line), title: data.name, error });
  }
  return { passed, failed, skipped, failures };
}

// the same runner for both: tests/<kind>/*.test.js, or the given files
async function runNodeTests(kind, files) {
  const list = files.length ? files : fs.readdirSync(path.join(ROOT, 'tests', kind)).filter(f => f.endsWith('.test.js')).sort().map(f => `tests/${kind}/${f}`);
  const res = stage('passed', { command: `node --test ${files.length ? files.map(quote).join(' ') : `tests/${kind}/*.test.js`}` });
  const missing = list.filter(f => !fs.existsSync(path.resolve(ROOT, f)));
  if (missing.length) {
    Object.assign(res, { status: 'failed', failed: 1 });
    return { res, failures: [{ stage: kind, location: missing[0], title: 'test file not found', error: [`no such file: ${missing.join(', ')}`] }] };
  }
  const { run } = require('node:test');
  const t = Date.now(), events = [];
  for await (const ev of run({ files: list.map(f => path.resolve(ROOT, f)), cwd: ROOT })) events.push(ev);
  const s = summarizeNodeTest(events, kind);
  Object.assign(res, { passed: s.passed, failed: s.failed, skipped: s.skipped, durationS: seconds(Date.now() - t) });
  if (s.failed) res.status = 'failed';
  else if (!s.passed) {
    res.status = 'failed';
    s.failures.push({ stage: kind, location: null, title: 'no tests ran', error: [`no ${kind} tests passed in: ${list.join(', ')}`] });
  }
  return { res, failures: s.failures };
}

// ---------- e2e (Playwright) ----------

// summarise Playwright's JSON report (--reporter=json)
function summarizePlaywright(report) {
  let passed = 0, failed = 0, skipped = 0, flaky = 0;
  const failures = [];
  // spec files are relative to the config's rootDir (testDir)
  const root = report.config?.rootDir;
  const inRoot = f => f && root && !path.isAbsolute(f) ? path.join(root, f) : f;
  const walk = (suite, titles) => {
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        if (t.status === 'skipped') { skipped++; continue; }
        if (t.status === 'expected') { passed++; continue; }
        if (t.status === 'flaky') { passed++; flaky++; continue; }
        failed++;
        const last = (t.results || [])[t.results.length - 1] || {};
        const e = (last.errors || [])[0] || last.error || {};
        const l = e.location;
        const error = trimError(e.message || e.stack || e.value || `test ${last.status || t.status}`);
        if (last.status === 'timedOut' && !error.some(x => /timeout/i.test(x))) error.unshift(`Test timeout (${last.status})`);
        failures.push({
          stage: 'e2e',
          location: l ? loc(l.file, l.line) : loc(inRoot(spec.file || suite.file), spec.line),
          title: [...titles, spec.title].join(' > '),
          error
        });
      }
    }
    for (const s of suite.suites || []) walk(s, [...titles, s.title]);
  };
  for (const s of report.suites || []) walk(s, []);
  for (const e of report.errors || []) {
    failed++;
    failures.push({ stage: 'e2e', location: e.location ? loc(e.location.file, e.location.line) : null, title: 'Playwright error', error: trimError(e.message || e.stack) });
  }
  const ran = passed + failed - (report.errors || []).length;
  if (ran === 0 && !failed) {
    failed++;
    failures.push({ stage: 'e2e', location: null, title: 'no tests ran', error: ['No tests found for this scope'] });
  }
  return { passed, failed, skipped, flaky, durationS: seconds(report.stats?.duration), failures };
}

function runE2e(args) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dgt-report-'));
  const out = path.join(tmp, 'report.json'), artifacts = path.join(tmp, 'results');
  const res = stage('passed', { command: ['playwright', 'test', ...args].map(quote).join(' ') });
  // own output dir: a parallel `npm test` cleans test-results/ and must not lose this run's traces
  const r = exec([bin('@playwright/test/cli.js'), 'test', ...args, '--reporter=json', `--output=${artifacts}`],
    { PLAYWRIGHT_JSON_OUTPUT_FILE: out, FORCE_COLOR: '0' });
  let report;
  try { report = JSON.parse(fs.readFileSync(out, 'utf8')); } catch {
    Object.assign(res, { status: 'failed', failed: 1, durationS: seconds(r.ms) });
    return { res, failures: [{ stage: 'e2e', location: null, title: 'Playwright did not produce a report', error: trimError(r.stderr || r.stdout || String(r.error)) }] };
  }
  const s = summarizePlaywright(report);
  Object.assign(res, { passed: s.passed, failed: s.failed, skipped: s.skipped, durationS: s.durationS || seconds(r.ms) });
  if (s.flaky) res.flaky = s.flaky;
  if (s.failed || r.code !== 0) {
    res.status = 'failed';
    if (!s.failed) { res.failed = 1; s.failures.push({ stage: 'e2e', location: null, title: `playwright exited with ${r.code}`, error: trimError(r.stderr) }); }
    const traces = fs.existsSync(artifacts) && fs.readdirSync(artifacts).some(f => f !== '.last-run.json');
    if (traces) res.artifacts = artifacts; // traces of the failed tests
    else fs.rmSync(tmp, { recursive: true, force: true });
  } else fs.rmSync(tmp, { recursive: true, force: true });
  return { res, failures: s.failures };
}

// ---------- main ----------

function finish(result) {
  const all = result.failures;
  result.failures = all.slice(0, MAX_FAILURES);
  result.failuresOmitted = Math.max(0, all.length - MAX_FAILURES);
  return result;
}

async function main(argv) {
  const command = ['node', 'scripts/test-report.js', ...argv].map(quote).join(' ');
  const t = Date.now();
  const stages = Object.fromEntries(STAGES.map(s => [s, stage('not run')]));
  let scope;
  try { scope = parseArgs(argv); } catch (e) {
    return { code: 2, result: finish({ ok: false, command, durationS: 0, stages, failures: [{ stage: 'args', location: null, title: 'bad argument', error: [e.message] }] }) };
  }
  const failures = [];
  const runners = { typecheck: runTypecheck, lint: runLint, unit: () => runNodeTests('unit', scope.unitFiles), integration: () => runNodeTests('integration', scope.integrationFiles), e2e: () => runE2e(scope.e2eArgs) };
  for (const name of STAGES) {
    if (!scope.stages.has(name)) continue;
    process.stderr.write(`[test-report] ${name}…\n`);
    let r;
    try { r = await runners[name](); } catch (e) {
      r = { res: stage('failed', { failed: 1 }), failures: [{ stage: name, location: null, title: 'stage crashed', error: trimError(e.stack || e.message) }] };
    }
    stages[name] = r.res;
    failures.push(...r.failures);
    process.stderr.write(`[test-report] ${name}: ${r.res.status} (${r.res.passed} passed, ${r.res.failed} failed, ${r.res.skipped} skipped, ${r.res.durationS}s)\n`);
  }
  const ok = Object.values(stages).every(s => s.status !== 'failed');
  return { code: ok ? 0 : 1, result: finish({ ok, command, durationS: seconds(Date.now() - t), stages, failures }) };
}

// pretty JSON, but each stage on one line so the summary stays short
function format(result) {
  const stages = Object.entries(result.stages).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
  return JSON.stringify({ ...result, stages: '@STAGES@' }, null, 2).replace('"@STAGES@"', `{\n${stages}\n  }`);
}

module.exports = { parseArgs, parseTsc, parseEslint, summarizeNodeTest, summarizePlaywright, trimError, format };

if (require.main === module) {
  main(process.argv.slice(2)).then(({ code, result }) => {
    process.stdout.write(format(result) + '\n');
    process.exitCode = code;
  }, err => { console.error(err.stack || err); process.exitCode = 1; });
}
