import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { changeOneCharacter, ordersOf, placeOf, recordOf } from '../model.js';
import { orderCard, verdictHtml } from '../render.js';
import { verifyDocument } from '../verify.js';

const here = (path) => new URL(`../${path}`, import.meta.url);
const expected = JSON.parse(await readFile(here('vectors/expected.json'), 'utf8'));

const receipts = [];
for (const name of (await readdir(here('vectors/receipts'))).sort()) {
  const text = await readFile(here(`vectors/receipts/${name}`), 'utf8');
  if (JSON.parse(text).schema === 'tick.receipt.v2') receipts.push({ name, text });
}

test('there are receipts of version two to change', () => {
  assert.ok(receipts.length > 0);
});

test('changeOneCharacter changes exactly one character, inside receipt, and the text is still JSON', () => {
  for (const { name, text } of receipts) {
    const change = changeOneCharacter(text);
    assert.equal(change.text.length, text.length, name);
    const differing = [...text].map((char, i) => (char === change.text[i] ? -1 : i)).filter((i) => i !== -1);
    assert.deepEqual(differing, [change.at], name);
    assert.equal(text[change.at], change.from, name);
    assert.equal(change.text[change.at], change.to, name);
    assert.notEqual(change.from, change.to, name);
    const before = JSON.parse(text);
    const after = JSON.parse(change.text);
    assert.notDeepEqual(after.receipt, before.receipt, name);
    for (const key of Object.keys(before).filter((one) => one !== 'receipt')) assert.deepEqual(after[key], before[key], `${name}: ${key}`);
    assert.deepEqual(Object.keys(after), Object.keys(before), name);
    // The place the visitor is told is inside the signed body.
    assert.ok(placeOf(change.text, change.at).field?.startsWith('receipt.'), name);
  }
});

test('a changed receipt is not valid, and the original is', async () => {
  for (const { name, text } of receipts) {
    if (expected[`receipts/${name}`]?.valid !== true) continue;
    assert.equal((await verifyDocument(text)).valid, true, name);
    const verdict = await verifyDocument(changeOneCharacter(text).text);
    assert.equal(verdict.valid, false, name);
    assert.ok(verdict.reasons.length > 0, name);
    assert.ok(verdict.reasons.includes('content_hash is not the hash of the receipt'), name);
  }
});

test('changeOneCharacter refuses what is no receipt of version two', () => {
  assert.throws(() => changeOneCharacter('{"schema":'));
  assert.throws(() => changeOneCharacter('{"schema":"tick.receipt.v1","receipt":{"a":"b"}}'));
  assert.throws(() => changeOneCharacter('{"schema":"tick.receipt.v2","receipt":{"n":1}}'));
});

const tryOf = (id, agent, model, minutes, cost, micros) => ({ attempt_id: id, agent, model, minutes, outcome: 'success', usd_micros: micros, cost });
const task = (id, type, of, receipt, tries) => ({ task_id: id, type, step_of: of, final_state: 'succeeded', disposition: null, receipt, tries });
const statement = {
  statement: {
    tasks: [
      task('t1', 'implement', null, null, [tryOf('a1', 'claude', 'claude-sonnet-5-5', 9.6, 'reported', 660_000), tryOf('a2', 'codex', null, null, 'unknown', null)]),
      task('t1-land', 'land', 't1', 'a'.repeat(64), []),
      task('t2', 'implement', null, null, [tryOf('a3', 'claude', 'claude-opus-5-5', 4, 'reported', 120_000)]),
    ],
  },
};

test('an order’s record names each try with its cost as reported, or no cost reported', () => {
  const [accepted] = ordersOf(statement);
  const record = recordOf(accepted);
  assert.deepEqual(
    record.tries.map((one) => [one.agent, one.model, one.minutes, one.cost]),
    [
      ['claude', 'claude-sonnet-5-5', 9.6, '$0.66, as the agent reported it'],
      ['codex', null, null, 'not reported'],
    ],
  );
});

test('an order with no acceptance is not accepted, and a field the statement lacks is missing', () => {
  const [, open] = ordersOf(statement);
  const record = recordOf(open);
  assert.deepEqual(record.accepted, { state: 'not-accepted' });
  for (const field of ['asked', 'commit', 'checks']) assert.equal(record[field].state, 'missing', field);
  const html = orderCard(open, false);
  assert.ok(html.includes('not accepted'));
  assert.ok(html.includes('missing'));
  const [accepted] = ordersOf(statement);
  assert.equal(recordOf(accepted).accepted.state, 'missing');
});

test('a verified receipt fills the record: what was asked, the commit, the checks, who accepted and when', async () => {
  const { text } = receipts[0];
  const document = JSON.parse(text);
  const record = recordOf(ordersOf(statement)[0], document);
  const what = document.receipt.order.order.what;
  assert.equal(record.asked.whole, what);
  assert.equal(record.asked.first, what.split('\n')[0]);
  assert.equal(record.commit.commit, document.receipt.delivery.delivery.commit);
  assert.equal(record.checks.state, 'held');
  assert.deepEqual(record.accepted, { state: 'held', ...document.receipt.acceptance });
});

test('the verdict names every reason, the limits and the key behind each role', async () => {
  const { text } = receipts[0];
  const html = verdictHtml(await verifyDocument(changeOneCharacter(text).text));
  assert.ok(html.includes('Not valid'));
  assert.ok(html.includes('What this does not establish'));
  for (const role of ['buyer', 'doer', 'checker', 'acceptor']) assert.ok(html.includes(`${role}: `), role);
  assert.ok(verdictHtml(await verifyDocument(text)).includes('Valid:'));
});
