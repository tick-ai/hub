// The page a company with no developer opens to approve one order with its own key:
// `node tools/approve-page.mjs <order-body.json> <out.html>` writes ONE self-contained
// HTML file that makes no network request. The decisions are the functions below and
// approve-core.js; the page's own script only wires them to buttons.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { canonicalSerialize, verifyDocument } from '../verify.js';
import { makeKeys, signOrder } from './approve-core.js';
import { escapeHtml, inlineSource, jsonForPage, pageShell, Refusal } from './page-shell.mjs';

/** Every word a person reads on this page. Another language changes this table and nothing else. */
export const WORDS = {
  title: 'Approve an order',
  heading: 'Approve this order',
  intro: 'Read the order. When it says what you want, approve it with your own key. Nothing leaves this page.',
  asking: 'What you are asking for',
  where: 'Where',
  whereLine: '{repository}, starting from {base}',
  territory: 'The files it may change',
  decides: 'What decides done',
  budget: 'The most the agents may spend',
  budgetNone: 'no limit set',
  deadline: 'Deadline',
  deadlineNone: 'none set',
  accepts: 'Who accepts',
  acceptsChecks: 'Accepted when every check passes',
  money: 'Money',
  moneyLine: 'No money is held for this order. You pay as your job agreement says.',
  approve: 'Approve this order',
  haveKey: 'I have a key file',
  keyLoaded: 'Key loaded. Its key id is {keyId}.',
  keyMade: 'A new key was made in this browser. Its key id is {keyId}. Save it, to approve orders as the same buyer next time.',
  keyNone: 'No key yet. Approving makes one in this browser, or load a key file you saved.',
  keyRefused: 'That file was not used: {reason}',
  saveKey: 'Save my key',
  keyWarning: 'Keep this file private. Anyone who has it can approve orders as you.',
  approved: 'Approved in this browser',
  approvedDetail: 'This browser checked the signed order and it is valid. Key id {keyId}.',
  notApproved: 'Not approved. The signed order did not check, for this reason:',
  save: 'Save the approved order',
  copy: 'Copy it',
  copied: 'Copied.',
  copyRefused: 'This browser did not allow copying. The text is selected: copy it by hand.',
  saveHint: 'Send the saved file to whoever started the work.',
  noEd25519: 'This browser cannot make Ed25519 signatures, so it cannot approve this order. Open this file in a current version of Firefox, Chrome, Edge or Safari. Nothing was signed.',
  noScript: 'This page needs JavaScript to approve the order. Nothing was sent anywhere.',
  checking: 'Checking…',
};

const fill = (template, values) => template.replace(/\{(\w+)\}/gu, (_, name) => String(values[name]));

/** A budget as dollars: whole cents where they are enough. */
function usd(amount) {
  const cents = amount.toFixed(2);
  return Number(cents) === amount ? `$${cents}` : `$${String(amount)}`;
}

/** What the order says, as the lines a person reads, in the order they are shown: [label, [lines] | text]. */
export function summaryOf(body, words = WORDS) {
  const accepts = body.acceptor.kind === 'checks' ? words.acceptsChecks : body.acceptor.name;
  return [
    { label: words.asking, text: body.what, block: true },
    { label: words.where, text: fill(words.whereLine, { repository: body.repository, base: body.base.slice(0, 12) }) },
    { label: words.territory, list: body.territory },
    { label: words.decides, list: body.checks.commands.map((one) => one.name) },
    { label: words.budget, text: body.budget.cap_usd === null ? words.budgetNone : usd(body.budget.cap_usd) },
    { label: words.deadline, text: body.deadline === null ? words.deadlineNone : body.deadline },
    { label: words.accepts, text: accepts },
    { label: words.money, text: words.moneyLine },
  ];
}

function summaryHtml(rows) {
  return rows
    .map((row) => {
      const value =
        row.list === undefined
          ? row.block
            ? `<div class="whole">${escapeHtml(row.text)}</div>`
            : escapeHtml(row.text)
          : `<ul class="list">${row.list.map((one) => `<li class="mono">${escapeHtml(one)}</li>`).join('')}</ul>`;
      return `<div><dt>${escapeHtml(row.label)}</dt><dd>${value}</dd></div>`;
    })
    .join('\n');
}

/**
 * The decision after signing: approved only when the document this browser just checked is
 * a valid work order, for this order id, whose body is the one the page shows. Returns
 * { ok, reasons }. The page is green only on ok.
 */
export function approvalOutcome(text, verdict, body, orderId) {
  const reasons = [];
  let doc = null;
  try {
    doc = JSON.parse(text);
  } catch {
    reasons.push('the signed order is not JSON');
  }
  if (verdict.kind !== 'work-order') reasons.push('the signed order is not a work order');
  for (const reason of verdict.reasons) reasons.push(reason);
  if (doc !== null) {
    if (doc.order_id !== orderId) reasons.push('the signed order is for another order id');
    try {
      if (canonicalSerialize(doc.order) !== canonicalSerialize(body)) reasons.push('the signed body is not the order shown');
    } catch {
      reasons.push('the signed body is not the order shown');
    }
  }
  return { ok: reasons.length === 0 && verdict.valid === true, reasons };
}

/** The wiring: reads the page, calls the functions above and below, writes the answers. */
const WIRING = `
(async function () {
  const $ = (id) => document.getElementById(id);
  const body = JSON.parse($('data').textContent);
  const orderId = $('order').getAttribute('data-order-id');
  if (!(await canSign())) {
    $('noed').hidden = false;
    return;
  }
  $('controls').hidden = false;
  let keys = null;
  let made = false;
  let signed = '';
  const say = (template, values) => template.replace(/\\{(\\w+)\\}/g, (_, name) => String(values[name]));
  const status = (kind, text) => {
    const tag = $('status');
    tag.className = 'tag' + (kind === '' ? '' : ' ' + kind);
    tag.textContent = text;
    tag.hidden = false;
  };
  const showKey = async () => {
    const keyId = await keyIdOfKeys(keys);
    $('keystate').textContent = say(made ? WORDS.keyMade : WORDS.keyLoaded, { keyId });
    $('keys').hidden = false;
    return keyId;
  };
  const download = (name, text) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', name);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('keyfile').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      keys = await keysFromFile(await file.text());
      made = false;
      signed = '';
      $('done').hidden = true;
      $('status').hidden = true;
      await showKey();
    } catch (error) {
      status('halt', say(WORDS.keyRefused, { reason: error instanceof Error ? error.message : String(error) }));
    }
  });
  $('approve').addEventListener('click', async () => {
    $('approve').disabled = true;
    $('done').hidden = true;
    status('', WORDS.checking);
    try {
      if (keys === null) {
        keys = await makeKeys();
        made = true;
      }
      const keyId = await showKey();
      const doc = await signOrder(body, { orderId, issuedAt: new Date().toISOString() }, keys);
      const text = JSON.stringify(doc, null, 2);
      const outcome = approvalOutcome(text, await verifyDocument(text), body, orderId);
      if (outcome.ok) {
        signed = text;
        $('text').value = text;
        $('done').hidden = false;
        status('ticked', WORDS.approved);
        $('detail').textContent = say(WORDS.approvedDetail, { keyId });
      } else {
        signed = '';
        status('halt', WORDS.notApproved + ' ' + outcome.reasons.join('; '));
      }
    } catch (error) {
      status('halt', WORDS.notApproved + ' ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      $('approve').disabled = false;
    }
  });
  $('save').addEventListener('click', () => {
    if (signed !== '') download(approvedFileName(orderId), signed);
  });
  $('copy').addEventListener('click', async () => {
    if (signed === '') return;
    try {
      await navigator.clipboard.writeText(signed);
      $('copynote').textContent = WORDS.copied;
    } catch {
      $('text').focus();
      $('text').select();
      $('copynote').textContent = WORDS.copyRefused;
    }
  });
  $('savekey').addEventListener('click', async () => {
    if (keys !== null) download('my-tick-key.json', await keyFileOf(keys));
  });
})();
`;

/** The functions the page's script calls, as the source of the very functions the tests call. */
function pageFunctions() {
  return [approvalOutcome].map((one) => one.toString()).join('\n');
}

/**
 * The approve page for one order body, as one HTML text. It proves the body first, by
 * signing it with a throwaway key and asking verifyDocument; it refuses with its reasons.
 * The order id is made once here, so one file approves one order.
 */
export async function approvePage(bodyText, { orderId = randomUUID() } = {}) {
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch (error) {
    throw new Refusal([`the order body is not JSON: ${error.message}`]);
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Refusal(['the order body is not a JSON object']);
  let proof;
  try {
    proof = await signOrder(body, { orderId, issuedAt: new Date().toISOString() }, await makeKeys());
  } catch (error) {
    throw new Refusal([`the order body cannot be signed: ${error.message}`]);
  }
  const verdict = await verifyDocument(JSON.stringify(proof));
  if (!verdict.valid) throw new Refusal(verdict.reasons);

  const [verifySource, coreSource] = await Promise.all(
    ['../verify.js', './approve-core.js'].map((path) => readFile(new URL(path, import.meta.url), 'utf8')),
  );
  const script = [
    inlineSource(verifySource, 'verify.js'),
    inlineSource(coreSource.replace(/^import .*$/gmu, ''), 'approve-core.js'),
    `const WORDS = ${jsonForPage(WORDS)};`,
    inlineSource(pageFunctions(), 'the page functions'),
    WIRING,
  ].join('\n');

  const html = `<h1>${escapeHtml(WORDS.heading)}</h1>
<p class="soft">${escapeHtml(WORDS.intro)}</p>
<div id="order" data-order-id="${escapeHtml(orderId)}" class="card"><dl class="rows">
${summaryHtml(summaryOf(body))}
</dl></div>
<noscript><p class="tag halt">${escapeHtml(WORDS.noScript)}</p></noscript>
<p id="noed" class="tag halt" hidden>${escapeHtml(WORDS.noEd25519)}</p>
<section id="controls" class="card" hidden>
<p id="keystate" class="soft">${escapeHtml(WORDS.keyNone)}</p>
<label class="soft">${escapeHtml(WORDS.haveKey)} <input type="file" id="keyfile" accept=".json,application/json"></label>
<div class="buttons"><button type="button" id="approve" class="primary">${escapeHtml(WORDS.approve)}</button></div>
<p id="status" class="tag" role="status" hidden></p>
<div id="done" class="out" hidden>
<p id="detail"></p>
<div class="buttons"><button type="button" id="save">${escapeHtml(WORDS.save)}</button><button type="button" id="copy">${escapeHtml(WORDS.copy)}</button></div>
<p id="copynote" role="status"></p>
<p class="soft">${escapeHtml(WORDS.saveHint)}</p>
<textarea id="text" readonly></textarea>
</div>
<div id="keys" class="out" hidden>
<div class="buttons"><button type="button" id="savekey">${escapeHtml(WORDS.saveKey)}</button></div>
<p>${escapeHtml(WORDS.keyWarning)}</p>
</div>
</section>`;
  return pageShell({ title: WORDS.title, body: html, script, data: body });
}

async function main(argv) {
  const [bodyPath, outPath] = argv;
  if (!bodyPath || !outPath) {
    console.error('usage: node tools/approve-page.mjs <order-body.json> <out.html>');
    return 2;
  }
  try {
    await writeFile(outPath, await approvePage(await readFile(bodyPath, 'utf8')));
  } catch (error) {
    console.error(error instanceof Refusal ? `Not made: ${error.reasons.join('; ')}` : `Not made: ${error.message}`);
    return 1;
  }
  console.log(`Wrote ${outPath}`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main(process.argv.slice(2));
