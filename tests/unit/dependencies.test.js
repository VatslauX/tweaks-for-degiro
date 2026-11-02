// Dependency pinning invariants. The extension ships no runtime dependencies, so these are
// all dev tooling — but two pins carry meaning beyond "keep it current" and must not drift.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const dependabot = fs.readFileSync(path.join(ROOT, '.github/dependabot.yml'), 'utf8');

test('the extension ships no runtime dependencies', () => {
  assert.strictEqual(pkg.dependencies, undefined, 'only devDependencies belong here: the zip ships extension/ alone');
});

// The live DEGIRO product chart reports "Created with Highstock 4.2.1", and the e2e product
// fixture loads this package at the same version to mirror it. Any bump, patch included, moves
// the mock away from the version the real page runs, so the version is exact and Dependabot is
// told to leave it alone. Re-check the live page's chart before changing either: its version is
// readable from the SVG <desc> ("Created with Highstock X.Y.Z") without main-world access.
test('highcharts is pinned to an exact version for mock parity', () => {
  const v = pkg.devDependencies.highcharts;
  assert.match(
    v,
    /^\d+\.\d+\.\d+$/,
    `highcharts is "${v}": it must be an exact version (no ^ or ~) so the e2e chart fixture ` +
    'keeps matching the Highstock version the live DEGIRO page renders'
  );
});

test('Dependabot is told to ignore highcharts entirely', () => {
  assert.match(
    dependabot,
    /^\s*-\s*dependency-name:\s*["']?highcharts["']?\s*$/m,
    'the exact highcharts pin only holds if Dependabot ignores every update to it; an ' +
    'update-types-scoped entry would still let a patch bump through'
  );
});
