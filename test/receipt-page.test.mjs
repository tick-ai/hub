import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, readFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';

import { changeOneCharacter } from '../model.js';
import { CSP } from '../tools/page-shell.mjs';
import { costOf, oneKeyOf, receiptPage, signersOf, WORDS } from '../tools/receipt-page.mjs';
import { documentHash, verifyDocument } from '../verify.js';

const here = (path) => new URL(`../${path}`, import.meta.url);
const SENTENCE = 'one company ordered, did, checked and accepted this work';

const receipts = [];
for (const name of (await readdir(here('vectors/receipts'))).sort()) {
  const text = await readFile(here(`vectors/receipts/${name}`), 'utf8');
  if (JSON.parse(text).schema === 'tick.receipt.v2') receipts.push({ name, text });
}
const { text: SAMPLE } = receipts[0];

function partsOf(page) {
  assert.equal(page.split('</script>').length - 1, 2, 'a data block and one script, and nothing else closes');
  const data = page.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/u);
  const code = page.slice(data.index + data[0].length).match(/<script>([\s\S]*?)<\/script>/u);
  return { data: JSON.parse(data[1]), code: code[1] };
}

test('receiptPage embeds the document unchanged, parses, and holds the policy', async () => {
  const page = await receiptPage(SAMPLE);
  const { data, code } = partsOf(page);
  assert.deepEqual(data, JSON.parse(SAMPLE));
  new vm.Script(code);
  assert.ok(page.includes(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`));
  assert.equal(/\bsrc\s*=/u.test(page), false);
  assert.equal(/\bhref\s*=/u.test(page), false);
  assert.equal(page.includes('fetch('), false);
  assert.equal(/XMLHttpRequest|WebSocket|sendBeacon|importScripts/u.test(page), false);
  assert.equal(/<(link|img|iframe|form|object|embed)\b/u.test(page), false);
});

test('every vector receipt makes a page, and the page shows the rows from the record', async () => {
  for (const { name, text } of receipts) {
    const page = await receiptPage(text);
    let from = 0;
    for (const label of ['Asked by', 'Done by', 'Changed', 'Checked', 'Accepted', 'Landed', 'Cost']) {
      const at = page.indexOf(`<dt>${label}</dt>`, from);
      assert.ok(at >= from, `${name}: ${label}`);
      from = at;
    }
    assert.ok(page.includes('Check it yourself'), name);
    assert.ok(page.includes('Change one character and check again'), name);
    const doc = JSON.parse(text);
    assert.ok(page.includes(doc.receipt.delivery.delivery.commit), name);
  }
  assert.equal(receipts.length > 1, true);
});

test('before the button there is no verdict and nothing is green', async () => {
  const page = await receiptPage(SAMPLE);
  const body = page.slice(page.indexOf('<main>'), page.indexOf('<script'));
  assert.equal(body.includes('ticked'), false);
  assert.equal(body.includes('Valid'), false);
  assert.match(body, /<div id="verdict" class="out" aria-live="polite"><\/div>/u);
});

test('a figure the record lacks is a dash with its reason, never a zero', () => {
  assert.deepEqual(costOf([{ cost: 'unknown', cents: null }]), { figure: null, reason: 'not reported', unknown: 1 });
  assert.deepEqual(costOf([]), { figure: null, reason: 'not reported', unknown: 0 });
  const some = costOf([{ cost: 'reported', cents: 82 }, { cost: 'unknown', cents: null }, { cost: 'reported', cents: 4 }]);
  assert.equal(some.figure, '$0.86');
  assert.equal(some.unknown, 1);
  assert.equal(some.reason, '1 of 3 tries have no cost reported');
  assert.ok(some.how.includes('as the agent reported it'));
  assert.ok(some.how.includes('from the record'));
  assert.equal(costOf([{ cost: 'metered', cents: 5 }]).figure, '$0.05');
});

test('a receipt with a try whose cost was never reported says so on the page', async () => {
  const partial = receipts.find(({ text }) => JSON.parse(text).receipt.delivery.delivery.tries.some((one) => one.cost === 'unknown'));
  assert.ok(partial, 'the vectors hold one');
  const page = await receiptPage(partial.text);
  assert.ok(page.includes('have no cost reported') || page.includes('not reported'));
});

test('a document with one changed character is refused by the command', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'receipt-'));
  try {
    const input = join(dir, 'receipt.json');
    const output = join(dir, 'receipt.html');
    const command = () => spawnSync(process.execPath, [fileURLToPath(here('tools/receipt-page.mjs')), input, output], { encoding: 'utf8' });
    await writeFile(input, changeOneCharacter(SAMPLE).text);
    const refused = command();
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /content_hash is not the hash of the receipt/u);
    await assert.rejects(stat(output));
    await writeFile(input, 'not json');
    assert.notEqual(command().status, 0);
    await writeFile(input, SAMPLE);
    const made = command();
    assert.equal(made.status, 0, made.stderr);
    assert.ok((await readFile(output, 'utf8')).includes('Check it yourself'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  await assert.rejects(receiptPage(changeOneCharacter(SAMPLE).text), (error) => error.reasons.includes('content_hash is not the hash of the receipt'));
});

// ---- a valid receipt whose four parts are signed by four different keys

const subtle = globalThis.crypto.subtle;
const toBase64 = (buffer) => Buffer.from(buffer).toString('base64');

async function resign(doc, label, idField) {
  const keys = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const spki = await subtle.exportKey('spki', keys.publicKey);
  doc.key = toBase64(spki);
  doc.key_id = Buffer.from(await subtle.digest('SHA-256', spki)).toString('hex').slice(0, 16);
  const message = new TextEncoder().encode(`${label}:${doc[idField]}:${doc.content_hash}`);
  doc.signature = toBase64(await subtle.sign('Ed25519', keys.privateKey, message));
}

async function withFourKeys(text) {
  const doc = JSON.parse(text);
  await resign(doc.receipt.order, 'tick-work-order:v1', 'order_id');
  await resign(doc.receipt.delivery, 'tick-delivery:v1', 'delivery_id');
  await resign(doc.receipt.check, 'tick-check-record:v1', 'record_id');
  doc.content_hash = await documentHash(doc.receipt);
  await resign(doc, 'tick-receipt:v2', 'receipt_id');
  return JSON.stringify(doc);
}

test('one key for every role gives the sentence, and different keys do not', async () => {
  const one = await receiptPage(SAMPLE);
  assert.ok(one.includes(SENTENCE));
  assert.ok(one.includes(`Signed by ${JSON.parse(SAMPLE).key_id}: ${SENTENCE}`));

  const different = await withFourKeys(SAMPLE);
  assert.equal((await verifyDocument(different)).valid, true, 'the four-key receipt is a valid one');
  const signers = await signersOf(JSON.parse(different));
  assert.equal(new Set(Object.values(signers)).size, 4);
  assert.equal(oneKeyOf(signers), null);
  const page = await receiptPage(different);
  assert.equal(page.includes(SENTENCE), false);
  for (const id of Object.values(signers)) assert.ok(page.includes(id));
  assert.equal(oneKeyOf(await signersOf(JSON.parse(SAMPLE))), JSON.parse(SAMPLE).key_id);
});

// ---- the page's script, run against a stand-in for the few parts of a browser it touches

async function runPage(page, { ed25519 = true } = {}) {
  const { code } = partsOf(page);
  const raw = page.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/u)[1];
  const elements = {};
  const element = (id) =>
    (elements[id] ??= {
      hidden: undefined,
      textContent: id === 'data' ? raw : '',
      innerHTML: '',
      disabled: false,
      listeners: {},
      addEventListener(name, listener) {
        this.listeners[name] = listener;
      },
    });
  const fakes = {
    document: { getElementById: element },
    ...(ed25519 ? {} : { crypto: { subtle: { generateKey: async () => { throw new Error('no Ed25519'); } } } }),
  };
  const before = Object.fromEntries(Object.keys(fakes).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(fakes)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const restore = () => {
    for (const [name, descriptor] of Object.entries(before)) {
      if (descriptor === undefined) delete globalThis[name];
      else Object.defineProperty(globalThis, name, descriptor);
    }
  };
  new vm.Script(`(function () {\n${code}\n})();`).runInThisContext();
  await new Promise((resolve) => setTimeout(resolve, 100));
  return { elements, restore };
}

test('the page’s script: green only after this browser verified, the failure with its word after a changed character', async () => {
  const page = await receiptPage(SAMPLE);
  const run = await runPage(page);
  try {
    const { elements } = run;
    assert.equal(elements.buttons.hidden, false);
    assert.equal(elements.verdict.innerHTML, '');
    await elements.check.listeners.click();
    assert.ok(elements.verdict.innerHTML.includes('class="tag ticked"'));
    assert.ok(elements.verdict.innerHTML.includes('Valid:'));
    assert.ok(elements.verdict.innerHTML.includes(SENTENCE));
    await elements.again.listeners.click();
    assert.ok(elements.verdict.innerHTML.includes('Not valid'));
    assert.ok(elements.verdict.innerHTML.includes('class="tag halt"'));
    assert.equal(elements.verdict.innerHTML.includes('ticked'), false);
    assert.ok(elements.verdict.innerHTML.includes('content_hash is not the hash of the receipt'));
    assert.ok(elements.verdict.innerHTML.includes('The receipt on disk is unchanged.'));
  } finally {
    run.restore();
  }
  const without = await runPage(page, { ed25519: false });
  try {
    assert.equal(without.elements.noed.hidden, false);
    assert.equal(without.elements.buttons, undefined, 'the buttons stay hidden');
  } finally {
    without.restore();
  }
  assert.ok(page.includes('verify-py'));
  assert.ok(WORDS.noEd25519.includes('verify-py'));
});
