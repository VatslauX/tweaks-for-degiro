// Generates a line-coverage badge SVG for extension/, from a fresh unit+integration run.
// Coverage-only: chart-select.js and portfolio.js need e2e (Highcharts/fetch) and aren't counted
// (see CLAUDE.md's test:coverage entry). Badge generation happens entirely locally (badgen),
// no network call and no third-party service.
//
//   node scripts/coverage-badge.js [output-path]   default: coverage-badge.svg
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { badgen } = require('badgen');

const ROOT = path.resolve(__dirname, '..');
const out = path.resolve(ROOT, process.argv[2] || 'coverage-badge.svg');
// a repo-local scratch dir, not os.tmpdir(): keeps file I/O inside the repo (CLAUDE.md's shell command scope)
const tmp = fs.mkdtempSync(path.join(ROOT, '.coverage-tmp-'));
const lcov = path.join(tmp, 'lcov.info');

const files = [
  ...fs.readdirSync(path.join(ROOT, 'tests/unit')).filter(f => f.endsWith('.test.js')).map(f => `tests/unit/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'tests/integration')).filter(f => f.endsWith('.test.js')).map(f => `tests/integration/${f}`),
];

const r = spawnSync(process.execPath, [
  '--test', '--experimental-test-coverage', '--test-coverage-include=extension/**',
  '--test-reporter=dot', '--test-reporter-destination=stdout',
  '--test-reporter=lcov', `--test-reporter-destination=${lcov}`,
  ...files,
], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] });

if (r.status !== 0) { fs.rmSync(tmp, { recursive: true, force: true }); console.error('tests failed; not generating a badge from a failing run'); process.exit(1); }

const text = fs.readFileSync(lcov, 'utf8');
fs.rmSync(tmp, { recursive: true, force: true });
let lf = 0, lh = 0;
for (const line of text.split('\n')) {
  if (line.startsWith('LF:')) lf += Number(line.slice(3));
  else if (line.startsWith('LH:')) lh += Number(line.slice(3));
}
if (!lf) { console.error('no lcov line data: extension/ coverage include glob matched nothing'); process.exit(1); }

const pct = Math.round((lh / lf) * 1000) / 10;
const color = pct >= 90 ? 'green' : pct >= 75 ? 'yellow' : 'red';
const svg = badgen({ label: 'coverage', status: `${pct}%`, color });
fs.writeFileSync(out, svg);
console.log(`wrote ${path.relative(ROOT, out)} (${pct}% line coverage of extension/, unit+integration only)`);
