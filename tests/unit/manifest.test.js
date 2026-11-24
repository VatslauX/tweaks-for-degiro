// Manifest checks: least privilege and Chrome Web Store requirements.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const EXT = path.resolve(__dirname, '../../extension');
const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));

test('Manifest V3', () => assert.strictEqual(m.manifest_version, 3));

test('requires Chrome 111+ (content scripts in world: MAIN)', () => {
  assert.ok(+m.minimum_chrome_version >= 111, `minimum_chrome_version is ${m.minimum_chrome_version}`);
});

test('only storage and alarms (no install warning), no host_permissions', () => {
  assert.deepStrictEqual(m.permissions, ['storage', 'alarms']);
  assert.strictEqual(m.host_permissions, undefined);
});

// Check in the background (opt-in): asked for only when switched on, so an update adds no install-time warning
test('optional permissions: only notifications, the alarm chime (offscreen) and the price hosts, for the background check', () => {
  assert.deepStrictEqual(m.optional_permissions, ['notifications', 'offscreen']);
  assert.deepStrictEqual(m.optional_host_permissions, ['https://query1.finance.yahoo.com/*', 'https://sgbeurs.nl/*']);
});

test('the background is one classic service worker', () => {
  assert.deepStrictEqual(m.background, { service_worker: 'background.js' });
});

test('no web-accessible resources and no externally_connectable', () => {
  assert.strictEqual(m.web_accessible_resources, undefined);
  assert.strictEqual(m.externally_connectable, undefined);
});

test('every referenced file exists', () => {
  const files = [
    ...Object.values(m.icons || {}),
    ...Object.values(m.action?.default_icon || {}),
    m.action?.default_popup, m.options_ui?.page, m.background?.service_worker,
    ...m.content_scripts.flatMap(c => c.js)
  ].filter(Boolean);
  for (const f of files) assert.ok(fs.existsSync(path.join(EXT, f)), `missing ${f}`);
});

test('content scripts run only on the DEGIRO web trader, top frame only', () => {
  for (const cs of m.content_scripts) {
    assert.deepStrictEqual(cs.matches, ['https://trader.degiro.nl/trader/*']);
    assert.ok(!cs.all_frames, 'all_frames must be off');
    assert.ok(!cs.match_about_blank && !cs.match_origin_as_fallback);
  }
});

const NOT_AFFILIATED = {
  en: 'Not affiliated with DEGIRO.', nl: 'Niet gelieerd aan DEGIRO.', de: 'Nicht mit DEGIRO verbunden.',
  fr: 'Non affilié à DEGIRO.', es: 'No afiliado a DEGIRO.', it: 'Non affiliato a DEGIRO.', pt: 'Não afiliado à DEGIRO.'
};

test('named as unofficial and not implying DEGIRO affiliation', () => {
  assert.match(m.name, /^Tweaks for DEGIRO \(unofficial\)$/);
  assert.ok(m.name.length <= 45, 'store name should be short');
  // the description is translated (_locales); every language must carry the disclaimer
  assert.strictEqual(m.description, '__MSG_extDescription__');
  for (const lang of fs.readdirSync(path.join(EXT, '_locales'))) {
    const d = JSON.parse(fs.readFileSync(path.join(EXT, '_locales', lang, 'messages.json'), 'utf8')).extDescription.message;
    assert.ok(NOT_AFFILIATED[lang], `${lang}: add its "not affiliated" phrase to this test`);
    assert.ok(d.endsWith(NOT_AFFILIATED[lang]), `${lang}: description must end with "${NOT_AFFILIATED[lang]}"`);
    assert.ok(d.length <= 132, `${lang}: description is ${d.length} chars (store limit 132)`);
  }
  assert.ok(!m.homepage_url || !/degiro\./i.test(m.homepage_url), 'homepage_url must not point to DEGIRO');
  assert.ok(!/degiro/i.test(m.action?.default_title || '') || /unofficial/i.test(m.action.default_title));
});

test('type-check projects list the same scripts as each manifest world', () => {
  const tsFiles = name => JSON.parse(fs.readFileSync(path.join(EXT, '..', name), 'utf8').replace(/^\s*\/\/.*$/gm, ''))
    .files.filter(f => f.startsWith('extension/')).map(f => f.slice('extension/'.length));
  for (const cs of m.content_scripts) {
    const project = cs.world === 'MAIN' ? 'tsconfig.page.json' : 'tsconfig.isolated.json';
    assert.deepStrictEqual(tsFiles(project), cs.js, `${project} must list the ${cs.world || 'isolated'} world's scripts in manifest order`);
  }
  // the worker: the scripts it imports, then itself
  const worker = fs.readFileSync(path.join(EXT, m.background.service_worker), 'utf8');
  const imported = [...worker.matchAll(/importScripts\(([^)]*)\)/g)].flatMap(x => x[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')));
  assert.deepStrictEqual(tsFiles('tsconfig.background.json'), [...imported, m.background.service_worker]);
});
