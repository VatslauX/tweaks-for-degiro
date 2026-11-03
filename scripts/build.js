// Packs extension/ into dist/<name>-<version>.zip for the Chrome Web Store.
// Only the extension folder is included — tests, docs and node_modules are not.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ext = path.join(root, 'extension');
const { version } = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', `tweaks-for-degiro-${version}.zip`);
fs.rmSync(out, { force: true });
execFileSync('zip', ['-qr', '-X', out, '.', '-x', '.*'], { cwd: ext });
console.log('Built', path.relative(root, out));
