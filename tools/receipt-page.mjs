// The page a person opens to see one receipt and check it with nothing installed:
// `node tools/receipt-page.mjs <receipt.json> <out.html>` writes ONE self-contained
// HTML file that makes no network request. The decisions are the functions below;
// the page's own script only wires them to the two buttons.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { agentNameOf, dollars } from '../model.js';
import { verifyDocument } from '../verify.js';
import { escapeHtml, inlineSource, jsonForPage, pageShell, Refusal } from './page-shell.mjs';

/** Every word a person reads on this page. Another language changes this table and nothing else. */
export const WORDS = {
  title: 'Receipt',
  heading: 'Receipt',
  unchecked: 'Nothing on this page is checked yet. Press “Check it yourself”: this browser then checks every signature.',
  askedBy: 'Asked by',
  askedByLine: 'a buyer, key {keyId}',
  doneBy: 'Done by',
  changed: 'Changed',
  changedInside: 'Every change is inside the files the order allowed.',
  changedOutside: 'Some change is outside the files the order allowed.',
  changedFiles: 'the receipt does not name the files changed; it names the files the order allowed, below',
  allowed: 'The files the order allowed',
  checked: 'Checked',
  checkedRan: 'ran in a container',
  checkedRanNot: 'did not run in a container',
  checkedNone: 'no check is recorded',
  accepted: 'Accepted',
  acceptedPerson: 'Accepted by {who}',
  acceptedAuto: 'Accepted by auto tick, for {who}',
  acceptedChecks: 'Accepted by its checks',
  landed: 'Landed',
  landedLine: '{repository}, from {base}',
  cost: 'Cost',
  costFrom: 'from the record',
  costReported: 'as the agent reported it',
  costMetered: 'as metered',
  costBoth: 'metered, or as the agent reported it',
  costUnknownTries: '{count} of {total} tries have no cost reported',
  notReported: 'not reported',
  minutes: '{minutes} min',
  minutesMissing: 'minutes not reported',
  modelMissing: 'model not recorded',
  dash: '—',
  signedBy: 'Signed by',
  roles: { buyer: 'Ordered', doer: 'Done', checker: 'Checked', acceptor: 'Accepted' },
  keysNote: 'The key each part names. Whether they are the parties’ keys is for you to know from elsewhere.',
  oneKey: 'Signed by {keyId}: one company ordered, did, checked and accepted this work.',
  checkIt: 'Check it yourself',
  changeIt: 'Change one character and check again',
  working: 'Checking…',
  valid: 'Valid: every signature verified in this browser, and the documents chain.',
  notValidOne: 'Not valid, for this reason:',
  notValidMany: 'Not valid, for these reasons:',
  limits: 'What this does not establish',
  who: 'Who signed (key id)',
  noKey: 'no key',
  changeNote: 'Changed character {at} of the receipt (line {line}, column {column}{field}): “{from}” became “{to}”. The receipt on disk is unchanged.',
  changeIn: ', in {field}',
  couldNot: 'This could not be checked: {reason}',
  noEd25519: 'This browser cannot check Ed25519 signatures, so it cannot check this receipt. verify-py, the Python checker, checks the same document: save the receipt and run it there.',
  noScript: 'This page needs JavaScript to check the receipt. verify-py, the Python checker, checks the same document.',
};

const fill = (template, values) => template.replace(/\{(\w+)\}/gu, (_, name) => String(values[name]));

// ---------------------------------------------------------------- what the page decides

const ROLE_ORDER = ['buyer', 'doer', 'checker', 'acceptor'];

async function keyIdOf(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/u.test(key)) return null;
  const bytes = Uint8Array.from(atob(key), (char) => char.charCodeAt(0));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** The key_id each role's key has, from the key each document carries: { buyer, doer, checker, acceptor }. */
export async function signersOf(doc) {
  const parts = doc.receipt;
  return {
    buyer: await keyIdOf(parts.order?.key),
    doer: await keyIdOf(parts.delivery?.key),
    checker: await keyIdOf(parts.check?.key),
    acceptor: await keyIdOf(doc.key),
  };
}

/** The key id that signed every role, or null where the roles have not all one key. */
export function oneKeyOf(signers) {
  const first = signers.buyer;
  return typeof first === 'string' && ROLE_ORDER.every((role) => signers[role] === first) ? first : null;
}

/** What the tries cost, from the record: a figure it lacks is a dash with its reason, never a zero. */
export function costOf(tries, words = WORDS) {
  const known = tries.filter((one) => one.cost !== 'unknown' && Number.isInteger(one.cents));
  const unknown = tries.length - known.length;
  if (known.length === 0) return { figure: null, reason: words.notReported, unknown };
  const kinds = new Set(known.map((one) => one.cost));
  const how = kinds.size > 1 ? words.costBoth : kinds.has('metered') ? words.costMetered : words.costReported;
  const micros = known.reduce((total, one) => total + one.cents * 10_000, 0);
  return { figure: dollars(micros), how: `${how}, ${words.costFrom}`, unknown, reason: unknown === 0 ? null : fill(words.costUnknownTries, { count: unknown, total: tries.length }) };
}

/** When a time is one, in UTC; what the record holds otherwise. */
function whenOf(at) {
  const time = new Date(at);
  return Number.isNaN(time.getTime()) ? String(at) : `${time.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

const missing = (words, reason) => `<span class="missing">${escapeHtml(words.dash)} ${escapeHtml(reason)}</span>`;
const mono = (text) => `<span class="mono">${escapeHtml(text)}</span>`;

/** The receipt card's rows, from the record, as { label, html }; html is already escaped. */
export function rowsOf(doc, signers, words = WORDS) {
  const { order: orderDoc, delivery: deliveryDoc, check: checkDoc, acceptance } = doc.receipt;
  const order = orderDoc.order;
  const delivery = deliveryDoc.delivery;
  const record = checkDoc.record;
  const lines = order.what.split(/\r?\n/u);
  const asked = lines.length === 1 ? escapeHtml(order.what) : `<details><summary>${escapeHtml(lines[0])}</summary><div class="whole">${escapeHtml(order.what)}</div></details>`;
  const tries = delivery.tries
    .map((one) => {
      const minutes = Number.isFinite(one.minutes) ? fill(words.minutes, { minutes: Math.round(one.minutes * 10) / 10 }) : words.minutesMissing;
      return `<li>${escapeHtml(agentNameOf(one.agent))} · ${one.model === null ? escapeHtml(words.modelMissing) : mono(one.model)} · ${escapeHtml(minutes)}</li>`;
    })
    .join('');
  const results = record.results.map((one) => `${escapeHtml(one.name)}: ${escapeHtml(one.outcome)}`).join(' · ');
  const how = acceptance.by === 'auto-tick' ? words.acceptedAuto : acceptance.by === 'checks' ? words.acceptedChecks : words.acceptedPerson;
  const cost = costOf(delivery.tries, words);
  const costHtml =
    cost.figure === null
      ? missing(words, cost.reason)
      : `<span class="figure">${escapeHtml(cost.figure)}</span> <span class="soft">${escapeHtml(cost.how)}</span>${cost.reason === null ? '' : `<br><span class="missing">${escapeHtml(words.dash)} ${escapeHtml(cost.reason)}</span>`}`;
  return [
    { label: words.askedBy, html: `${asked}<br><span class="soft">${escapeHtml(fill(words.askedByLine, { keyId: signers.buyer ?? words.noKey }))}</span>` },
    { label: words.doneBy, html: tries === '' ? missing(words, words.notReported) : `<ul class="list">${tries}</ul>` },
    {
      label: words.changed,
      html: `${escapeHtml(record.territory_held ? words.changedInside : words.changedOutside)}<br>${missing(words, words.changedFiles)}<details><summary>${escapeHtml(words.allowed)}</summary><ul class="list">${order.territory.map((one) => `<li>${mono(one)}</li>`).join('')}</ul></details>`,
    },
    { label: words.checked, html: `${results === '' ? escapeHtml(words.checkedNone) : results} · ${escapeHtml(record.verdict)}<br><span class="soft">${escapeHtml(record.contained === 'container' ? words.checkedRan : words.checkedRanNot)}</span>` },
    { label: words.accepted, html: `${escapeHtml(fill(how, { who: acceptance.who }))} · ${escapeHtml(whenOf(acceptance.at))}` },
    { label: words.landed, html: `${mono(record.commit)}<br><span class="soft">${escapeHtml(fill(words.landedLine, { repository: record.repository, base: record.base.slice(0, 12) }))}</span>` },
    { label: words.cost, html: costHtml },
  ];
}

// ---------------------------------------------------------------- what the browser runs
// These functions are put in the page as their own source, so the page runs the very
// functions the tests call. They hold no outside names but the words they are given.

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

async function ed25519Works() {
  try {
    const keys = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
    const message = new TextEncoder().encode('tick');
    const signature = await globalThis.crypto.subtle.sign('Ed25519', keys.privateKey, message);
    return await globalThis.crypto.subtle.verify('Ed25519', keys.publicKey, signature, message);
  } catch {
    return false;
  }
}

/** A verdict in words. Green (`ticked`) only for a document this browser just verified. */
function verdictHtml(verdict, words) {
  const roles = ['buyer', 'doer', 'checker', 'acceptor'];
  const head = verdict.valid
    ? `<p class="tag ticked">${esc(words.valid)}</p>`
    : `<p class="tag halt">${esc(verdict.reasons.length === 1 ? words.notValidOne : words.notValidMany)}</p><ul>${verdict.reasons.map((one) => `<li>${esc(one)}</li>`).join('')}</ul>`;
  const limits = verdict.limits.length === 0 ? '' : `<h3>${esc(words.limits)}</h3><ul>${verdict.limits.map((one) => `<li>${esc(one)}</li>`).join('')}</ul>`;
  const signers = verdict.signers || {};
  const keys = roles.filter((role) => role in signers).map((role) => `<li>${esc(words.roles[role])}: <span class="mono">${signers[role] === null ? esc(words.noKey) : esc(signers[role])}</span></li>`);
  const keysHtml = keys.length === 0 ? '' : `<h3>${esc(words.who)}</h3><ul>${keys.join('')}</ul>`;
  const same = roles.every((role) => typeof signers[role] === 'string' && signers[role] === signers.buyer);
  const one = words.oneKey && verdict.valid && same ? `<p>${esc(words.oneKey.replace('{keyId}', signers.buyer))}</p>` : '';
  return head + one + limits + keysHtml;
}

/** What "change one character" did, named so the visitor can see it. */
function changeHtml(change, place, words) {
  const field = place.field === null ? '' : words.changeIn.replace('{field}', esc(place.field));
  const note = words.changeNote
    .replace('{at}', String(change.at + 1))
    .replace('{line}', String(place.line))
    .replace('{column}', String(place.column))
    .replace('{field}', field)
    .replace('{from}', esc(change.from))
    .replace('{to}', esc(change.to));
  return `<p>${note}</p>`;
}

const WIRING = `
(async function () {
  const $ = (id) => document.getElementById(id);
  if (!(await ed25519Works())) {
    $('noed').hidden = false;
    return;
  }
  $('buttons').hidden = false;
  const text = JSON.stringify(JSON.parse($('data').textContent));
  const out = $('verdict');
  const run = async (button, work) => {
    button.disabled = true;
    out.textContent = WORDS.working;
    try {
      out.innerHTML = await work();
    } catch (error) {
      out.textContent = WORDS.couldNot.replace('{reason}', error instanceof Error ? error.message : String(error));
    } finally {
      button.disabled = false;
    }
  };
  $('check').addEventListener('click', () => run($('check'), async () => verdictHtml(await verifyDocument(text), WORDS)));
  $('again').addEventListener('click', () => run($('again'), async () => {
    const change = changeOneCharacter(text);
    return changeHtml(change, placeOf(change.text, change.at), WORDS) + verdictHtml(await verifyDocument(change.text), WORDS);
  }));
})();
`;

// A closing tag in these functions is only ever inside a string, where `<\/` is the same text.
function pageFunctions() {
  return [esc, ed25519Works, verdictHtml, changeHtml].map((one) => one.toString()).join('\n').replace(/<\//gu, '<\\/');
}

/**
 * The receipt page for one receipt of version two, as one HTML text. It refuses what
 * verifyDocument does not call a valid tick.receipt.v2, with verifyDocument's reasons.
 */
export async function receiptPage(receiptText) {
  const verdict = await verifyDocument(receiptText);
  if (!verdict.valid) throw new Refusal(verdict.reasons);
  if (verdict.kind !== 'receipt') throw new Refusal([`it is a ${verdict.kind}, not a receipt of version two (tick.receipt.v2)`]);
  const doc = JSON.parse(receiptText);
  if (doc.schema !== 'tick.receipt.v2') throw new Refusal([`the schema is ${doc.schema}, not tick.receipt.v2`]);

  const signers = await signersOf(doc);
  const one = oneKeyOf(signers);
  const browserWords = { ...WORDS };
  if (one === null) delete browserWords.oneKey;

  const [verifySource, modelSource] = await Promise.all(['../verify.js', '../model.js'].map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  const script = [
    inlineSource(verifySource, 'verify.js'),
    inlineSource(modelSource, 'model.js'),
    // The sentence for one key is in the page only where one key signed every role.
    `const WORDS = ${jsonForPage(browserWords)};`,
    inlineSource(pageFunctions(), 'the page functions'),
    WIRING,
  ].join('\n');

  const rows = rowsOf(doc, signers, WORDS)
    .map((row) => `<div><dt>${escapeHtml(row.label)}</dt><dd>${row.html}</dd></div>`)
    .join('\n');
  const keys = ROLE_ORDER.map((role) => `<li>${escapeHtml(WORDS.roles[role])}: ${mono(signers[role] ?? WORDS.noKey)}</li>`).join('');
  const html = `<h1>${escapeHtml(WORDS.heading)}</h1>
<section class="card"><dl class="rows">
${rows}
</dl>
<div><h3>${escapeHtml(WORDS.signedBy)}</h3><ul class="list">${keys}</ul>
<p class="soft">${escapeHtml(WORDS.keysNote)}</p>
${one === null ? '' : `<p>${escapeHtml(fill(WORDS.oneKey, { keyId: one }))}</p>`}</div>
</section>
<noscript><p class="tag halt">${escapeHtml(WORDS.noScript)}</p></noscript>
<p id="noed" class="tag halt" hidden>${escapeHtml(WORDS.noEd25519)}</p>
<section class="card">
<p class="soft">${escapeHtml(WORDS.unchecked)}</p>
<div id="buttons" class="buttons" hidden><button type="button" id="check" class="primary">${escapeHtml(WORDS.checkIt)}</button><button type="button" id="again">${escapeHtml(WORDS.changeIt)}</button></div>
<div id="verdict" class="out" aria-live="polite"></div>
</section>`;
  return pageShell({ title: WORDS.title, body: html, script, data: doc });
}

async function main(argv) {
  const [receiptPath, outPath] = argv;
  if (!receiptPath || !outPath) {
    console.error('usage: node tools/receipt-page.mjs <receipt.json> <out.html>');
    return 2;
  }
  try {
    await writeFile(outPath, await receiptPage(await readFile(receiptPath, 'utf8')));
  } catch (error) {
    console.error(error instanceof Refusal ? `Not made: ${error.reasons.join('; ')}` : `Not made: ${error.message}`);
    return 1;
  }
  console.log(`Wrote ${outPath}`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main(process.argv.slice(2));
