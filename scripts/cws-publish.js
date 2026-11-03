// Uploads dist/<name>-<version>.zip to the Chrome Web Store and submits it for review (API v2).
// Run by .github/workflows/release.yml on a v* tag with CWS_TOKEN, CWS_PUBLISHER_ID, CWS_ITEM_ID set.
const fs = require('fs');
const path = require('path');

const API = 'https://chromewebstore.googleapis.com';

function checkTag(tag, version) {
  if (tag !== `v${version}`) throw new Error(`tag ${tag} does not match manifest.json version ${version}: expected v${version}`);
}

function readEnv(env) {
  const names = { tag: 'GITHUB_REF_NAME', token: 'CWS_TOKEN', publisherId: 'CWS_PUBLISHER_ID', itemId: 'CWS_ITEM_ID' };
  const missing = Object.values(names).filter(n => !env[n]);
  if (missing.length) throw new Error(`missing environment variable(s): ${missing.join(', ')}`);
  return Object.fromEntries(Object.entries(names).map(([k, n]) => [k, env[n]]));
}

// fetch that throws with status and body on HTTP errors; returns the parsed JSON body
async function call(fetchFn, url, init) {
  const res = await fetchFn(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method} ${url} -> ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return {}; }
}

async function release({ token, publisherId, itemId, zip, version, fetchFn = fetch,
  sleep = ms => new Promise(r => setTimeout(r, ms)), polls = 30, pollMs = 10000 }) {
  const item = `publishers/${publisherId}/items/${itemId}`;
  const headers = { Authorization: `Bearer ${token}` };

  const upload = await call(fetchFn, `${API}/upload/v2/${item}:upload`,
    { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip' }, body: zip });
  if (upload.crxVersion && upload.crxVersion !== version)
    throw new Error(`uploaded version ${upload.crxVersion} is not the manifest version ${version}`);

  let state = upload.uploadState;
  for (let i = 0; state === 'IN_PROGRESS'; i++) {
    if (i >= polls) throw new Error(`upload still processing after ${polls} checks`);
    await sleep(pollMs);
    state = (await call(fetchFn, `${API}/v2/${item}:fetchStatus`, { method: 'GET', headers })).lastAsyncUploadState;
  }
  if (state !== 'SUCCEEDED') throw new Error(`upload failed: ${state} ${JSON.stringify(upload)}`);

  return call(fetchFn, `${API}/v2/${item}:publish`, { method: 'POST', headers });
}

module.exports = { checkTag, readEnv, release };

if (require.main === module) {
  (async () => {
    const root = path.resolve(__dirname, '..');
    const { version } = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
    const env = readEnv(process.env);
    checkTag(env.tag, version);
    const zip = fs.readFileSync(path.join(root, 'dist', `tweaks-for-degiro-${version}.zip`));
    const out = await release({ ...env, zip, version });
    console.log(`Submitted ${version} for review:`, JSON.stringify(out));
  })().catch(err => { console.error(err.message); process.exit(1); });
}
