const test = require('node:test');
const assert = require('node:assert');
const { checkTag, readEnv, release } = require('../../scripts/cws-publish.js');

const ITEM = 'publishers/pub/items/item';
const UPLOAD = `https://chromewebstore.googleapis.com/upload/v2/${ITEM}:upload`;
const STATUS = `https://chromewebstore.googleapis.com/v2/${ITEM}:fetchStatus`;
const PUBLISH = `https://chromewebstore.googleapis.com/v2/${ITEM}:publish`;

// fake fetch: answers each call from the queue and records it
function fakeFetch(answers) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization });
    const [status, body] = answers.shift();
    return { ok: status < 400, status, text: async () => JSON.stringify(body) };
  };
  return { fn, calls };
}
const base = { token: 't0k', publisherId: 'pub', itemId: 'item', zip: Buffer.from('zip'), version: '1.2.3', sleep: async () => {} };

test('checkTag accepts v + manifest version', () => {
  checkTag('v1.2.3', '1.2.3');
});

test('checkTag rejects a mismatch and a missing v', () => {
  assert.throws(() => checkTag('v1.2.4', '1.2.3'), /expected v1\.2\.3/);
  assert.throws(() => checkTag('1.2.3', '1.2.3'), /expected v1\.2\.3/);
});

test('readEnv names the missing variable and never includes the token', () => {
  assert.throws(() => readEnv({ GITHUB_REF_NAME: 'v1', CWS_TOKEN: 'secret', CWS_ITEM_ID: 'i' }), err => {
    assert.match(err.message, /CWS_PUBLISHER_ID/);
    assert.doesNotMatch(err.message, /secret/);
    return true;
  });
  assert.deepStrictEqual(
    readEnv({ GITHUB_REF_NAME: 'v1', CWS_TOKEN: 't', CWS_PUBLISHER_ID: 'p', CWS_ITEM_ID: 'i' }),
    { tag: 'v1', token: 't', publisherId: 'p', itemId: 'i' });
});

test('uploads, then publishes when the upload succeeds at once', async () => {
  const f = fakeFetch([[200, { uploadState: 'SUCCEEDED', crxVersion: '1.2.3' }], [200, { state: 'PENDING_REVIEW' }]]);
  const out = await release({ ...base, fetchFn: f.fn });
  assert.deepStrictEqual(out, { state: 'PENDING_REVIEW' });
  assert.deepStrictEqual(f.calls.map(c => [c.method, c.url]), [['POST', UPLOAD], ['POST', PUBLISH]]);
  assert.ok(f.calls.every(c => c.auth === 'Bearer t0k'));
});

test('polls fetchStatus while IN_PROGRESS', async () => {
  const f = fakeFetch([
    [200, { uploadState: 'IN_PROGRESS' }],
    [200, { lastAsyncUploadState: 'IN_PROGRESS' }],
    [200, { lastAsyncUploadState: 'SUCCEEDED' }],
    [200, {}]
  ]);
  await release({ ...base, fetchFn: f.fn });
  assert.deepStrictEqual(f.calls.map(c => c.url), [UPLOAD, STATUS, STATUS, PUBLISH]);
});

test('gives up after N polls', async () => {
  const f = fakeFetch([[200, { uploadState: 'IN_PROGRESS' }], [200, { lastAsyncUploadState: 'IN_PROGRESS' }], [200, { lastAsyncUploadState: 'IN_PROGRESS' }]]);
  await assert.rejects(release({ ...base, fetchFn: f.fn, polls: 2 }), /still processing after 2 checks/);
  assert.ok(!f.calls.some(c => c.url === PUBLISH));
});

test('does not publish after FAILED', async () => {
  const f = fakeFetch([[200, { uploadState: 'FAILED' }]]);
  await assert.rejects(release({ ...base, fetchFn: f.fn }), /upload failed.*FAILED/);
  assert.strictEqual(f.calls.length, 1);
});

test('throws on HTTP error with status and body', async () => {
  const f = fakeFetch([[403, { error: { message: 'The caller does not have permission' } }]]);
  await assert.rejects(release({ ...base, fetchFn: f.fn }), /403.*does not have permission/);
  assert.strictEqual(f.calls.length, 1);
});

test('rejects crxVersion mismatch', async () => {
  const f = fakeFetch([[200, { uploadState: 'SUCCEEDED', crxVersion: '1.2.2' }]]);
  await assert.rejects(release({ ...base, fetchFn: f.fn }), /uploaded version 1\.2\.2.*1\.2\.3/);
  assert.strictEqual(f.calls.length, 1);
});
