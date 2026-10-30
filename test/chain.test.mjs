import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';

import { takenOut, walkIndexes } from '../chain.js';
import { frontPage } from '../render.js';
import { documentHash, verifyDocument } from '../verify.js';

// A key made for these tests alone; nothing here is a company's.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const keyBytes = publicKey.export({ type: 'spki', format: 'der' });
const KEY = keyBytes.toString('base64');
const KEY_ID = createHash('sha256').update(keyBytes).digest('hex').slice(0, 16);

const run = (id, n) => ({ run_id: id, statements: [String(n).repeat(64)], head: String(n).repeat(64) });
const project = (slug, ...runs) => ({ slug, name: `Project ${slug}`, repository: `https://example.com/${slug}`, runs });

/** An index as spec/SPEC.md defines tick.hub-index.v1, signed by the test's key. */
async function indexOf(issuedAt, previous, projects) {
  const body = { publisher: 'Test Company', previous, projects };
  const contentHash = await documentHash(body);
  return {
    schema: 'tick.hub-index.v1',
    alg: 'ed25519',
    issued_at: issuedAt,
    coordinator: 'test-coordinator',
    index: body,
    content_hash: contentHash,
    key: KEY,
    key_id: KEY_ID,
    signature: sign(null, Buffer.from(`tick-hub-index:v1:${contentHash}`), privateKey).toString('base64'),
    limits: ['made by a test'],
  };
}

/** A folder of indexes by content hash, as `tick export --hub` keeps them. */
function folder(...documents) {
  const files = new Map(documents.map((one) => [one.content_hash, JSON.stringify(one)]));
  const read = async (hash) => {
    if (!files.has(hash)) throw new Error(`indexes/${hash}.json: 404`);
    return files.get(hash);
  };
  return { files, read };
}

/** Three indexes: the first lists a, b and c; the second a and b; the third a. */
async function three() {
  const first = await indexOf('2026-09-01T10:00:00Z', null, [project('a', run('r1', 1)), project('b', run('r2', 2)), project('c', run('r3', 3))]);
  const second = await indexOf('2026-09-15T10:00:00Z', first.content_hash, [project('a', run('r1', 1)), project('b', run('r2', 2))]);
  const third = await indexOf('2026-10-01T10:00:00Z', second.content_hash, [project('a', run('r1', 1))]);
  return { first, second, third };
}

test('the indexes the test makes are valid indexes', async () => {
  const { first } = await three();
  const verdict = await verifyDocument(JSON.stringify(first));
  assert.deepEqual([verdict.kind, verdict.valid, verdict.reasons], ['hub-index', true, []]);
});

test('a chain of three walks back to the first and is answered oldest first', async () => {
  const { first, second, third } = await three();
  const { read } = folder(first, second, third);
  const walked = await walkIndexes(read, verifyDocument, third.content_hash);
  assert.equal(walked.stopped, null);
  assert.deepEqual(walked.indexes.map((one) => one.hash), [first.content_hash, second.content_hash, third.content_hash]);
  assert.deepEqual(walked.indexes.map((one) => one.issuedAt), [first.issued_at, second.issued_at, third.issued_at]);
  assert.ok(walked.indexes.every((one) => one.verified));
});

test('a project in the first index and not the third is taken out, with the second index’s date if the second listed it', async () => {
  const { first, second, third } = await three();
  const { indexes } = await walkIndexes(folder(first, second, third).read, verifyDocument, third.content_hash);
  const taken = takenOut(indexes);
  assert.deepEqual(taken.map((one) => [one.kind, one.slug]), [['project', 'b'], ['project', 'c']]);
  assert.equal(taken[0].last.issuedAt, second.issued_at);
  assert.equal(taken[0].last.hash, second.content_hash);
  assert.equal(taken[1].last.issuedAt, first.issued_at);
  assert.ok(taken.every((one) => one.verified));
});

test('a file that is missing stops the walk, with the indexes read so far', async () => {
  const { first, second, third } = await three();
  const walked = await walkIndexes(folder(second, third).read, verifyDocument, third.content_hash);
  assert.equal(walked.stopped.reason, 'missing');
  assert.equal(walked.stopped.hash, first.content_hash);
  assert.equal(walked.stopped.from, second.content_hash);
  assert.match(walked.stopped.detail, /404/);
  assert.deepEqual(walked.indexes.map((one) => one.hash), [second.content_hash, third.content_hash]);
});

test('an index that does not verify, one byte changed, stops the walk and is not listed', async () => {
  const { first, second, third } = await three();
  const { files, read } = folder(first, second, third);
  files.set(second.content_hash, files.get(second.content_hash).replace('Test Company', 'Test Companz'));
  const walked = await walkIndexes(read, verifyDocument, third.content_hash);
  assert.equal(walked.stopped.reason, 'unverified');
  assert.equal(walked.stopped.hash, second.content_hash);
  assert.match(walked.stopped.detail, /content_hash is not the hash of the index/);
  assert.deepEqual(walked.indexes.map((one) => one.hash), [third.content_hash]);
});

test('a previous that names an index already read stops the walk as a loop', async () => {
  const { first, second, third } = await three();
  // The folder serves the third index again under the second's name.
  const files = new Map([[third.content_hash, JSON.stringify(third)], [second.content_hash, JSON.stringify(third)], [first.content_hash, JSON.stringify(first)]]);
  const walked = await walkIndexes(async (hash) => files.get(hash), verifyDocument, third.content_hash);
  assert.equal(walked.stopped.reason, 'loop');
  assert.equal(walked.stopped.hash, second.content_hash);
  assert.deepEqual(walked.indexes.map((one) => one.hash), [third.content_hash]);
});

test('a document that is not an index stops the walk', async () => {
  const { first } = await three();
  const walked = await walkIndexes(async () => '{"schema":"tick-keys/1"}', verifyDocument, first.content_hash);
  assert.equal(walked.stopped.reason, 'unverified');
  assert.deepEqual(walked.indexes, []);
});

test('a run taken out while its project stays is reported as the run', async () => {
  const first = await indexOf('2026-09-01T10:00:00Z', null, [project('a', run('r1', 1), run('r2', 2)), project('b', run('r3', 3))]);
  const second = await indexOf('2026-09-15T10:00:00Z', first.content_hash, [project('a', run('r1', 1)), project('b', run('r3', 3))]);
  const { indexes } = await walkIndexes(folder(first, second).read, verifyDocument, second.content_hash);
  const taken = takenOut(indexes);
  assert.deepEqual(taken.map((one) => [one.kind, one.slug, one.run_id]), [['run', 'a', 'r2']]);
  assert.equal(taken[0].last.issuedAt, first.issued_at);
});

test('nothing is taken out of a single index, or where nothing left', async () => {
  const { first } = await three();
  assert.deepEqual(takenOut([]), []);
  const { indexes } = await walkIndexes(folder(first).read, verifyDocument, first.content_hash);
  assert.deepEqual(takenOut(indexes), []);
  const same = await indexOf('2026-09-02T10:00:00Z', first.content_hash, first.index.projects);
  const walked = await walkIndexes(folder(first, same).read, verifyDocument, same.content_hash);
  assert.deepEqual(takenOut(walked.indexes), []);
});

test('a line is green only if every index back to the one that listed it verified', async () => {
  const { first, second, third } = await three();
  const { indexes } = await walkIndexes(folder(first, second, third).read, verifyDocument, third.content_hash);
  const doubted = indexes.map((one) => (one.hash === second.content_hash ? { ...one, verified: false } : one));
  const taken = takenOut(doubted);
  assert.deepEqual(taken.map((one) => [one.slug, one.verified]), [['b', false], ['c', false]]);
  const html = frontPage([], true, { taken, stopped: null });
  assert.ok(html.includes('Taken out of this index'));
  assert.ok(html.includes('last listed in the index of 2026-09-15'));
  assert.ok(!html.includes('class="ticked"'));
  const green = frontPage([], true, { taken: takenOut(indexes), stopped: null });
  assert.ok(green.includes('<li class="ticked">'));
});

test('the page says where the chain stopped, and an index that does not verify shows nothing green', async () => {
  const { first, second, third } = await three();
  const walked = await walkIndexes(folder(second, third).read, verifyDocument, third.content_hash);
  const html = frontPage([], true, { taken: takenOut(walked.indexes), stopped: walked.stopped });
  assert.ok(html.includes('The chain stopped at'));
  assert.ok(html.includes(first.content_hash));
  assert.ok(html.includes('its file could not be read'));
  const bad = frontPage([], false, { taken: takenOut(walked.indexes), stopped: walked.stopped });
  assert.ok(bad.includes('does not verify'));
  assert.ok(!bad.includes('ticked'));
  assert.ok(!bad.includes('Taken out'));
});
