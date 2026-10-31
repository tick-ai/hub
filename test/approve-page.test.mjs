import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';

import { approvedFileName, canSign, keyFileOf, keyIdOfKeys, keysFromFile, makeKeys, signOrder } from '../tools/approve-core.js';
import { approvalOutcome, approvePage, summaryOf, WORDS } from '../tools/approve-page.mjs';
import { CSP } from '../tools/page-shell.mjs';
import { verifyDocument } from '../verify.js';

const BODY = {
  what: 'Add rate limits to the API.\nOne hundred requests a minute for each key.',
  repository: 'github.com/acme/shop',
  base: '4209242d8d8ee6515cbf45699771389db251f032',
  territory: ['src/api/**', 'test/api.test.js'],
  checks: { commands: [{ name: 'unit tests', argv: ['npm', 'test'] }] },
  budget: { cap_usd: 5 },
  deadline: null,
  acceptor: { kind: 'checks' },
  payment: { kind: 'none' },
  from_task: null,
};
const ORDER_ID = '0a1b2c3d-1111-4222-8333-444455556666';
const ISSUED = '2026-10-31T09:00:00.000Z';

/** The page's inline script and its JSON block, read back the way a browser would. */
function partsOf(page) {
  const scripts = [...page.matchAll(/<script(?: type="application\/json" id="data")?>([\s\S]*?)<\/script>/gu)];
  assert.equal(scripts.length, 2, 'a data block and one script, and nothing else closes');
  const dataBlock = page.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/u);
  const code = page.match(/<script>([\s\S]*?)<\/script>/u);
  return { data: JSON.parse(dataBlock[1]), code: code[1] };
}

test('signOrder gives a document verifyDocument calls valid', async () => {
  const keys = await makeKeys();
  const document = await signOrder(BODY, { orderId: ORDER_ID, issuedAt: ISSUED }, keys);
  const verdict = await verifyDocument(JSON.stringify(document));
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.valid, true);
  assert.equal(verdict.kind, 'work-order');
  assert.equal(document.coordinator, `buyer:${document.key_id}`);
  assert.equal(document.key_id, await keyIdOfKeys(keys));
  assert.deepEqual(document.order, BODY);
  assert.equal(document.limits.length, 3);
  assert.equal(document.limits[2], 'payment none means no money is held for this order: the parties pay as their job agreement says.');
  assert.equal(JSON.stringify(document).includes('pkcs8'), false);
});

test('changing one character of the signed body makes the order not valid', async () => {
  const document = await signOrder(BODY, { orderId: ORDER_ID, issuedAt: ISSUED }, await makeKeys());
  const text = JSON.stringify(document);
  const at = text.indexOf('Add rate');
  const changed = `${text.slice(0, at)}Bdd${text.slice(at + 3)}`;
  assert.equal(changed.length, text.length);
  const verdict = await verifyDocument(changed);
  assert.equal(verdict.valid, false);
  assert.ok(verdict.reasons.includes('content_hash is not the hash of the order'));
});

test('a key file gives the same key back, and anything else is refused in plain words', async () => {
  const keys = await makeKeys();
  const text = await keyFileOf(keys);
  assert.equal(JSON.parse(text).schema, 'tick-buyer-key/1');
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ['pkcs8', 'schema', 'spki']);
  const back = await keysFromFile(text);
  assert.equal(await keyIdOfKeys(back), await keyIdOfKeys(keys));
  const document = await signOrder(BODY, { orderId: ORDER_ID, issuedAt: ISSUED }, back);
  assert.equal((await verifyDocument(JSON.stringify(document))).valid, true);
  const other = JSON.parse(text);
  const stranger = JSON.parse(await keyFileOf(await makeKeys()));
  for (const garbage of ['garbage', '[]', 'null', '{}', JSON.stringify({ ...other, schema: 'tick-buyer-key/2' }), JSON.stringify({ ...other, pkcs8: '!!' }), JSON.stringify({ ...other, pkcs8: 'AAAA' }), JSON.stringify({ ...other, spki: stranger.spki })]) {
    await assert.rejects(keysFromFile(garbage), /key file/u, garbage);
  }
});

test('approvePage refuses a body missing what, with verifyDocument’s reason', async () => {
  const { what, ...without } = BODY;
  assert.ok(what);
  await assert.rejects(approvePage(JSON.stringify(without), { orderId: ORDER_ID }), (error) => {
    assert.ok(error.reasons.includes('order.what is not a non-empty string'));
    assert.match(error.message, /order\.what is not a non-empty string/u);
    return true;
  });
  await assert.rejects(approvePage('{"a":1}'), /order\.what/u);
  await assert.rejects(approvePage('not json'), /not JSON/u);
  await assert.rejects(approvePage('[]'), /not a JSON object/u);
});

test('the page holds the policy exactly and asks for nothing from anywhere', async () => {
  const page = await approvePage(JSON.stringify(BODY), { orderId: ORDER_ID });
  assert.ok(page.includes(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`));
  assert.equal(CSP, "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'");
  assert.equal(/\bsrc\s*=/u.test(page), false);
  assert.equal(/\bhref\s*=/u.test(page), false);
  assert.equal(page.includes('fetch('), false);
  assert.equal(/XMLHttpRequest|WebSocket|sendBeacon|importScripts/u.test(page), false);
  assert.equal(/https?:\/\//u.test(page), false);
  assert.equal(/<(link|img|iframe|form|object|embed)\b/u.test(page), false);
  const { code } = partsOf(page);
  new vm.Script(code);
});

test('the page says what the order asks, in plain words and in order', async () => {
  const page = await approvePage(JSON.stringify(BODY), { orderId: ORDER_ID });
  const labels = [WORDS.asking, WORDS.where, WORDS.territory, WORDS.decides, WORDS.budget, WORDS.deadline, WORDS.accepts, WORDS.money, WORDS.approve];
  assert.deepEqual(labels.slice(0, 8), ['What you are asking for', 'Where', 'The files it may change', 'What decides done', 'The most the agents may spend', 'Deadline', 'Who accepts', 'Money']);
  let from = 0;
  for (const label of labels) {
    const at = page.indexOf(label, from);
    assert.ok(at >= from, label);
    from = at;
  }
  const rows = summaryOf(BODY);
  assert.equal(rows[1].text, 'github.com/acme/shop, starting from 4209242d8d8e');
  assert.deepEqual(rows[2].list, BODY.territory);
  assert.deepEqual(rows[3].list, ['unit tests']);
  assert.equal(rows[4].text, '$5.00');
  assert.equal(rows[5].text, 'none set');
  assert.equal(rows[6].text, 'Accepted when every check passes');
  assert.equal(rows[7].text, 'No money is held for this order. You pay as your job agreement says.');
  const other = summaryOf({ ...BODY, budget: { cap_usd: null }, deadline: '2026-11-05T12:00:00Z', acceptor: { kind: 'person', name: 'Parsa' } });
  assert.deepEqual([other[4].text, other[5].text, other[6].text], ['no limit set', '2026-11-05T12:00:00Z', 'Parsa']);
  for (const word of ['Save my key', 'I have a key file', 'Keep this file private. Anyone who has it can approve orders as you.', 'Save the approved order', 'Copy it']) assert.ok(page.includes(word), word);
  assert.equal(approvedFileName(ORDER_ID), 'approved-order-0a1b2c3d.json');
  assert.ok(page.includes(`data-order-id="${ORDER_ID}"`));
  assert.equal(/\b(runner|lease|gate|DAG|attempt|MCP)\b/u.test(Object.values(WORDS).join(' ')), false);
});

test('a body whose what holds a closing script tag cannot close the block', async () => {
  const body = { ...BODY, what: 'Fix it </script><script>alert(1)</script> <!-- and </SCRIPT>' };
  const page = await approvePage(JSON.stringify(body), { orderId: ORDER_ID });
  const { data, code } = partsOf(page);
  assert.deepEqual(data, body);
  new vm.Script(code);
  assert.equal(page.includes('<script>alert'), false);
  assert.equal(page.split('</script>').length - 1, 2);
});

test('the decision to say Approved needs a valid order, for this order id, with the body shown', async () => {
  const document = await signOrder(BODY, { orderId: ORDER_ID, issuedAt: ISSUED }, await makeKeys());
  const text = JSON.stringify(document);
  const verdict = await verifyDocument(text);
  assert.deepEqual(approvalOutcome(text, verdict, BODY, ORDER_ID), { ok: true, reasons: [] });
  assert.equal(approvalOutcome(text, verdict, BODY, 'another').ok, false);
  assert.equal(approvalOutcome(text, verdict, { ...BODY, what: 'something else' }, ORDER_ID).ok, false);
  const tampered = text.replace('Add rate', 'Bdd rate');
  const bad = approvalOutcome(tampered, await verifyDocument(tampered), BODY, ORDER_ID);
  assert.equal(bad.ok, false);
  assert.ok(bad.reasons.includes('content_hash is not the hash of the order'));
  assert.equal(approvalOutcome('nope', await verifyDocument('nope'), BODY, ORDER_ID).ok, false);
});

/** The page's own script, run against a stand-in for the few parts of a browser it touches. */
async function runPage(page, { ed25519 = true } = {}) {
  const { code } = partsOf(page);
  const raw = page.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/u)[1];
  const elements = {};
  const element = (id) =>
    (elements[id] ??= {
      hidden: id !== 'data' ? undefined : false,
      textContent: id === 'data' ? raw : '',
      attributes: id === 'order' ? { 'data-order-id': page.match(/data-order-id="([^"]+)"/u)[1] } : {},
      listeners: {},
      addEventListener(name, listener) {
        this.listeners[name] = listener;
      },
      getAttribute(name) {
        return this.attributes[name];
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      focus() {},
      select() {},
      remove() {},
      click() {},
    });
  const downloads = [];
  const document = {
    getElementById: element,
    createElement: () => ({ ...element(`anchor-${downloads.length}`), click() { downloads.push(this.attributes); } }),
    body: { appendChild() {} },
  };
  // The script runs in this realm, as a page's does, so the objects it makes are plain objects to verify.js.
  const fakes = {
    document,
    navigator: { clipboard: { writeText: async () => { throw new Error('refused'); } } },
    ...(ed25519 ? {} : { crypto: { subtle: { generateKey: async () => { throw new Error('no Ed25519'); } } } }),
  };
  const before = Object.fromEntries(Object.keys(fakes).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(fakes)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const createObjectURL = URL.createObjectURL;
  URL.createObjectURL = () => 'blob:page';
  const restore = () => {
    URL.createObjectURL = createObjectURL;
    for (const [name, descriptor] of Object.entries(before)) {
      if (descriptor === undefined) delete globalThis[name];
      else Object.defineProperty(globalThis, name, descriptor);
    }
  };
  new vm.Script(`(function () {\n${code}\n})();`).runInThisContext();
  await new Promise((resolve) => setTimeout(resolve, 100));
  return { elements, downloads, restore };
}

test('the page’s script: nothing is green until its own check passes, and a browser without Ed25519 gets words and no button', async () => {
  const page = await approvePage(JSON.stringify(BODY), { orderId: ORDER_ID });
  const run = await runPage(page);
  try {
    const { elements } = run;
    assert.equal(elements.controls.hidden, false);
    assert.equal(elements.status, undefined, 'no verdict before the button');
    await elements.approve.listeners.click();
    assert.equal(elements.status.className, 'tag ticked');
    assert.equal(elements.status.textContent, 'Approved in this browser');
    const saved = JSON.parse(elements.text.value);
    assert.equal((await verifyDocument(elements.text.value)).valid, true);
    assert.equal(saved.order_id, ORDER_ID);
    assert.equal(elements.text.value.includes('pkcs8'), false);
    await elements.save.listeners.click();
    assert.equal(run.downloads[0].download, 'approved-order-0a1b2c3d.json');
    await elements.copy.listeners.click();
    assert.equal(elements.copynote.textContent, WORDS.copyRefused);
    await elements.savekey.listeners.click();
    assert.equal(run.downloads[1].download, 'my-tick-key.json');
  } finally {
    run.restore();
  }
  const without = await runPage(page, { ed25519: false });
  try {
    assert.equal(without.elements.noed.hidden, false);
    assert.equal(without.elements.controls, undefined);
  } finally {
    without.restore();
  }
  assert.ok(page.includes('cannot make Ed25519 signatures'));
});

test('the command writes the page, and refuses a body with its reasons', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'approve-'));
  try {
    const bodyPath = join(dir, 'body.json');
    const outPath = join(dir, 'approve.html');
    const command = (file) => spawnSync(process.execPath, [fileURLToPath(new URL('../tools/approve-page.mjs', import.meta.url)), file, outPath], { encoding: 'utf8' });
    await writeFile(join(dir, 'bad.json'), JSON.stringify({ ...BODY, what: '' }));
    const refused = command(join(dir, 'bad.json'));
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /order\.what is not a non-empty string/u);
    await assert.rejects(stat(outPath));
    await writeFile(bodyPath, JSON.stringify(BODY));
    const made = command(bodyPath);
    assert.equal(made.status, 0, made.stderr);
    assert.ok((await readFile(outPath, 'utf8')).includes('Approve this order'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('this Node can sign', async () => {
  assert.equal(await canSign(), true);
});
