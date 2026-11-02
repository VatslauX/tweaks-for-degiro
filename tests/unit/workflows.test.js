// Workflow supply-chain checks: GitHub Actions must stay pinned to commit SHAs.
// The release publish job holds `contents: write` and an OIDC token scoped to Chrome Web
// Store publishing, so a retargeted mutable tag (`@v3`) is a path to publishing a malicious
// extension. Code scanning caught this once (ai-scan/cwe-829), but AI Scan is not per-push
// and CodeQL analysed `main` with mutable tags without raising anything: this test is what
// makes the invariant enforced on every push.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOWS = path.join(ROOT, '.github/workflows');

const files = fs.readdirSync(WORKFLOWS).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

// `uses:` lines, with the ref and any trailing comment. A local (`./path`) reference is this
// repository's own code and has no commit to pin, so it is skipped. A `docker://` reference
// carries the same mutable-tag risk and is checked for a digest instead.
const USES = /^\s*-?\s*uses:\s*(\S+)\s*(?:#\s*(.*))?$/;

function usesLines() {
  const out = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(WORKFLOWS, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = USES.exec(line);
      if (m) out.push({ file, line: i + 1, ref: m[1], comment: m[2] || '' });
    });
  }
  return out;
}

test('there are workflows with actions to check (guards against a vacuous pass)', () => {
  assert.ok(files.length > 0, 'no workflow files found in .github/workflows');
  assert.ok(usesLines().length > 0, 'no `uses:` lines found; has the regex drifted?');
});

test('every action is pinned to a full 40-character commit SHA', () => {
  for (const { file, line, ref } of usesLines()) {
    if (ref.startsWith('./')) continue;
    if (ref.startsWith('docker://')) {
      assert.match(
        ref,
        /@sha256:[0-9a-f]{64}$/,
        `${file}:${line}: \`uses: ${ref}\` must pin a digest (@sha256:…), not a mutable image tag`
      );
      continue;
    }
    const at = ref.lastIndexOf('@');
    assert.ok(at > 0, `${file}:${line}: \`uses: ${ref}\` has no ref to pin`);
    const pin = ref.slice(at + 1);
    assert.match(
      pin,
      /^[0-9a-f]{40}$/,
      `${file}:${line}: \`uses: ${ref}\` is not pinned to a commit SHA. ` +
      'Resolve the tag (gh api repos/<owner>/<repo>/git/ref/tags/<tag> -q .object.sha) ' +
      'and keep the version in a trailing comment.'
    );
  }
});

test('every pin records the version it stands for in a trailing comment', () => {
  for (const { file, line, ref, comment } of usesLines()) {
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    assert.match(
      comment,
      /^v?\d+(\.\d+)*\b/,
      `${file}:${line}: \`uses: ${ref}\` needs a trailing comment naming the version, ` +
      'e.g. `# v5.1.0`, so the pin stays readable and Dependabot can rewrite both together.'
    );
  }
});

test('Dependabot tracks github-actions, so the pins do not go stale', () => {
  const cfg = fs.readFileSync(path.join(ROOT, '.github/dependabot.yml'), 'utf8');
  assert.match(
    cfg,
    /^\s*-?\s*package-ecosystem:\s*["']?github-actions["']?/m,
    'SHA pins need Dependabot to update them; add a github-actions ecosystem entry'
  );
});
