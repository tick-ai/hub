// An order whose receipt file is not in the folder says so in words; the line that
// draws the ticked history and the keys Tick signs with are in the repository.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { headsOf, ordersOf, recordOf } from '../model.js';
import { orderCard } from '../render.js';
import { verifyDocument } from '../verify.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (name) => readFileSync(join(root, name), 'utf8');

const project = JSON.parse(read('vectors/site/index.json')).index.projects[0];
const statement = JSON.parse(read(`vectors/site/projects/${project.slug}/statements/${headsOf(project)[0]}.json`));
const [order] = ordersOf(statement);

const SENTENCE = 'This order has no receipt: no work order was signed when its work started.';

test('an accepted order with no receipt file says so, with no check button and no green', () => {
  assert.equal(order.accepted, true);
  const html = orderCard(order, false, recordOf(order), true);
  assert.ok(html.includes(SENTENCE));
  assert.doesNotMatch(html, /<button/u);
  assert.doesNotMatch(html, /Check it yourself/u);
  assert.doesNotMatch(html, /ticked/u);
});

test('an accepted order whose receipt file is there keeps its check button', () => {
  const html = orderCard(order, false, recordOf(order), false);
  assert.match(html, /Check it yourself/u);
  assert.ok(!html.includes(SENTENCE));
});

test('ticked-line.json holds the line after the landings with no receipt', () => {
  const line = JSON.parse(read('ticked-line.json'));
  assert.deepEqual(Object.keys(line), ['schema', 'commit', 'at', 'words', 'utterance', 'decision']);
  assert.equal(line.schema, 'tick-ticked-line/1');
  assert.match(line.commit, /^[0-9a-f]{40}$/u);
  assert.equal(line.commit, 'afb9ffb920dbe6b21b3f4acd26c6e5d485c6ac06');
  assert.equal(line.at, '2026-10-30T09:50:00Z');
  assert.equal(line.utterance, 'utt:f391b841bb2d9489158fb74a49db27be');
  assert.equal(line.decision, 'GD-93');
});

test('.tick/keys.json is a keys file that verifies', async () => {
  const verdict = await verifyDocument(read('.tick/keys.json'));
  assert.equal(verdict.kind, 'keys-file');
  assert.equal(verdict.valid, true, verdict.reasons.join('; '));
});
