// The page held to a real `tick export --hub` folder and to one-field changes to it:
// every document gets the verdict Tick's own verifier gave it when these vectors were
// made, and the figures of the front page add up from the real statements.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { headsOf, ordersOf, summaryOf } from '../model.js';
import { verifyDocument } from '../verify.js';

const vectors = join(fileURLToPath(new URL('..', import.meta.url)), 'vectors');
const text = (name) => readFileSync(join(vectors, name), 'utf8');
const expected = JSON.parse(text('site-expected.json'));

test('every document of the site gets the verdict Tick gave it', async () => {
  const names = Object.keys(expected);
  assert.ok(names.length > 0);
  for (const name of names) {
    const want = expected[name];
    const got = await verifyDocument(text(name));
    assert.deepEqual(
      { kind: got.kind, valid: got.valid, reasons: [...got.reasons].sort() },
      { kind: want.kind, valid: want.valid, reasons: [...want.reasons].sort() },
      name,
    );
  }
});

test('the vectors hold both verdicts', () => {
  const verdicts = new Set(Object.values(expected).map((one) => one.valid));
  assert.deepEqual([...verdicts].sort(), [false, true]);
});

test('the front page adds up from the real statements', () => {
  const index = JSON.parse(text('site/index.json')).index;
  assert.ok(index.projects.length > 0);
  for (const project of index.projects) {
    const statements = new Map();
    for (const hash of headsOf(project)) {
      statements.set(hash, JSON.parse(text(`site/projects/${project.slug}/statements/${hash}.json`)));
    }
    const summary = summaryOf(project, statements);
    assert.equal(summary.slug, project.slug);
    assert.equal(summary.orders, 1, `${project.slug}: one order`);
    assert.equal(summary.accepted, 1, `${project.slug}: accepted, by its land step's receipt`);
    const [statement] = [...statements.values()];
    const [order] = ordersOf(statement);
    const receipt = JSON.parse(text(`site/projects/${project.slug}/receipts/${order.taskId}.json`));
    assert.equal(receipt.receipt.order.order.from_task.task_id, order.taskId, project.slug);
  }
});
