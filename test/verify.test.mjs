import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { canonicalSerialize, documentHash, verifyDocument } from '../verify.js';

const here = (path) => new URL(`../${path}`, import.meta.url);
const expected = JSON.parse(await readFile(here('vectors/expected.json'), 'utf8'));

test('the document hash is of the canonical form written as a string', async () => {
  assert.equal(canonicalSerialize({ b: [1, -0, 'x'], a: null }), '{"a":null,"b":[1,0,"x"]}');
  assert.equal(await documentHash({ a: 1 }), '3dc4eef510cec9eda1ca361042e8152bd62c44288af2d9cc465cc217c381facd');
  assert.throws(() => canonicalSerialize({ a: undefined }));
  assert.throws(() => canonicalSerialize([NaN]));
  const loop = {};
  loop.self = loop;
  assert.throws(() => canonicalSerialize(loop));
});

test('Web Crypto agrees with the Ed25519 vectors', async () => {
  const { vectors } = JSON.parse(await readFile(here('vectors/ed25519.json'), 'utf8'));
  const bytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
  for (const v of vectors) {
    const spki = Uint8Array.from(atob(v.public_key_spki_base64), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('spki', spki, { name: 'Ed25519' }, false, ['verify']);
    assert.equal(await crypto.subtle.verify('Ed25519', key, bytes(v.signature_hex), bytes(v.message_hex)), v.valid);
  }
});

for (const [path, want] of Object.entries(expected)) {
  test(`vectors/${path}`, async () => {
    const verdict = await verifyDocument(await readFile(here(`vectors/${path}`), 'utf8'));
    assert.equal(verdict.kind, want.kind);
    assert.equal(verdict.valid, want.valid);
    assert.deepEqual([...new Set(verdict.reasons)].sort(), [...new Set(want.reasons)].sort());
    assert.ok(Array.isArray(verdict.limits));
  });
}

test('a file that is no document is unknown, with the specification’s reason', async () => {
  const notJson = await verifyDocument('{"schema":');
  assert.equal(notJson.kind, 'unknown');
  assert.equal(notJson.valid, false);
  assert.equal(notJson.reasons.length, 1);
  assert.ok(notJson.reasons[0].startsWith('it is not JSON:'));
  assert.deepEqual(notJson.limits, []);

  for (const text of ['[]', 'null', '"x"', '7']) {
    assert.deepEqual(await verifyDocument(text), {
      kind: 'unknown',
      valid: false,
      reasons: ['it is not a Tick document: it is not a JSON object'],
      limits: [],
    });
  }

  for (const [text, schema] of [
    ['{"schema":"tick.nothing.v9"}', '"tick.nothing.v9"'],
    ['{}', 'null'],
    ['{"schema":null}', 'null'],
    ['{"schema":7}', '7'],
  ]) {
    assert.deepEqual(await verifyDocument(text), {
      kind: 'unknown',
      valid: false,
      reasons: [`the schema is ${schema}, which this verifier does not know`],
      limits: [],
    });
  }
});

test('an empty document of each known kind is invalid and never throws', async () => {
  for (const schema of [
    'tick.receipt.v1',
    'tick.audit-export.v1',
    'tick.audit-trail-export.v1',
    'tick.usage-report.v1',
    'tick.work-order.v1',
    'tick.delivery.v1',
    'tick.check-record.v1',
    'tick.receipt.v2',
    'tick.release-receipt.v1',
    'tick.project-receipt.v2',
    'tick.hub-index.v1',
    'tick-keys/1',
  ]) {
    const verdict = await verifyDocument(JSON.stringify({ schema }));
    assert.notEqual(verdict.kind, 'unknown', schema);
    assert.equal(verdict.valid, false, schema);
    assert.ok(verdict.reasons.length > 0, schema);
  }
});

test('a key Web Crypto refuses is a reason, not an error', async () => {
  const [path] = Object.keys(expected).filter((p) => p.startsWith('receipts/') && expected[p].kind === 'receipt');
  const doc = JSON.parse(await readFile(here(`vectors/${path}`), 'utf8'));
  doc.key = 'AAAA';
  const verdict = await verifyDocument(JSON.stringify(doc));
  assert.equal(verdict.valid, false);
  assert.ok(verdict.reasons.includes('the signature is not the carried key’s over this receipt'));
});
