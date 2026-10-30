// TickHub's markup, as strings built from the record. Whatever a document holds
// reaches the page as text, never as markup: every value goes through esc().
// Green appears only where the caller says this browser verified a document.

import { STOPPED } from './chain.js';
import { agentNameOf, costOfAgents, monogramOf, recordOf, stationsOf } from './model.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value).replace(/[&<>"']/gu, (char) => ESCAPES[char]);
}

function agentsLine(agents) {
  if (agents.length === 0) return 'no try recorded yet';
  return agents
    .map((one) => `<span class="mono-chip" title="${esc(one.agent)}">${esc(monogramOf(one.agent))}</span> ${esc(agentNameOf(one.agent))}${one.model === null ? '' : `, <span class="mono">${esc(one.model)}</span>`} · ${one.tries} ${one.tries === 1 ? 'try' : 'tries'}`)
    .join(' · ');
}

const dayOf = (index) => String(index.issuedAt).slice(0, 10);

/**
 * "Taken out of this index": one line per project or run an older index listed and the
 * newest does not, with the date of the last index that listed it, and where the chain
 * stopped if it did. A line is green only where every index back to that one verified here.
 */
export function takenOutSection(taken, stopped) {
  const lines = taken
    .map((one) => {
      const what =
        one.kind === 'project'
          ? `Project ${esc(one.name)} <span class="mono">${esc(one.slug)}</span>`
          : `Run <span class="mono">${esc(one.run_id)}</span> of ${esc(one.name)}`;
      return `<li class="${one.verified ? 'ticked' : 'plain'}">${what}: last listed in the index of ${esc(dayOf(one.last))}</li>`;
    })
    .join('');
  const none = taken.length === 0 && stopped === null ? '<p class="src">Nothing an older index listed is missing from this one.</p>' : '';
  const where =
    stopped === null
      ? ''
      : `<p class="tag halt">The chain stopped at ${esc(stopped.hash)}${stopped.from === null ? '' : `, named by ${esc(stopped.from)}`}: ${esc(STOPPED[stopped.reason] ?? stopped.reason)} (${esc(stopped.detail)}). Older indexes were not read.</p>`;
  return `<section class="taken-out"><h2>Taken out of this index</h2>${lines === '' ? '' : `<ul>${lines}</ul>`}${none}${where}</section>`;
}

/**
 * The front page: one card per project, its figures from the head statements of its
 * runs. `history`, where given, is `{ taken, stopped }` from chain.js. An index that
 * does not verify is said so at the top, and nothing is green.
 */
export function frontPage(summaries, indexVerified, history) {
  const cards = summaries
    .map(
      (one) => `<article class="card">
  <h2><a href="#/p/${esc(one.slug)}">${esc(one.name)}</a></h2>
  <p class="src mono">${esc(one.repository)}</p>
  <dl class="figures">
    <div><dt>orders accepted</dt><dd class="figure">${one.accepted} of ${one.orders}</dd></div>
    <div><dt>tries by agents</dt><dd class="figure">${one.agentTries}</dd></div>
    <div><dt>Tick's own steps</dt><dd class="figure">${one.tickTries}</dd></div>
    <div><dt>cost, as the agents reported it</dt><dd class="figure${one.agentTriesReported === 0 ? ' none' : ''}">${esc(costOfAgents(one))}</dd></div>
    <div><dt>tries with no cost reported</dt><dd class="figure">${one.triesUnknown}</dd></div>
  </dl>
  <p class="agents">${agentsLine(one.agents)}</p>
</article>`,
    )
    .join('\n');
  const verdict = indexVerified
    ? '<p class="tag ticked">The index is signed and this browser checked it.</p>'
    : '<p class="tag halt">This index does not verify in this browser. Nothing below is shown as checked.</p>';
  const taken = history === undefined || !indexVerified ? '' : takenOutSection(history.taken, history.stopped);
  const ask = '<p class="ask"><a href="https://www.instagram.com/_tick_group">DM TICKED</a> for the first 20 work orders.</p>';
  return `<section class="front"><h1>Who built this, and what did it cost?</h1>\n${verdict}\n${cards}\n${taken}\n${ask}</section>`;
}

/** The stations of one order, Ticked earned only by this browser's check of its receipt. */
export function stationsLine(order, verified) {
  return `<ol class="line">${stationsOf(order, verified)
    .map((one) => `<li class="${one.reached ? 'on' : 'off'}${one.name === 'Ticked' && one.reached ? ' ticked' : ''}">${esc(one.name)}</li>`)
    .join('')}</ol>`;
}

const minutesText = (minutes) => (minutes === null ? 'minutes missing' : `${(Math.round(minutes * 10) / 10).toString()} min`);

/** A field the record lacks, said so. */
const missingLine = (why) => `<span class="missing">missing: ${esc(why)}</span>`;

function askedLine(asked) {
  if (asked.state !== 'held') return missingLine(asked.why);
  if (asked.whole === asked.first) return esc(asked.first);
  return `<details><summary>${esc(asked.first)}</summary><pre class="whole">${esc(asked.whole)}</pre></details>`;
}

function checksLine(checks) {
  if (checks.state !== 'held') return missingLine(checks.why);
  const ran = checks.results.map((one) => `${esc(one.name)}: ${esc(one.outcome)}`).join(' · ');
  // The verdict is said only where the results do not already say it.
  const said = checks.verdict === null || checks.results.every((one) => one.outcome === checks.verdict);
  return `${ran === '' ? 'no check ran' : ran}${said ? '' : ` · ${esc(checks.verdict)}`}`;
}

/** A time as a person reads it, in UTC; what the record holds, where it is no time. */
function whenOf(at) {
  const time = new Date(at);
  return Number.isNaN(time.getTime()) ? String(at) : `${time.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function acceptedLine(accepted) {
  if (accepted.state === 'not-accepted') return 'not accepted: no receipt';
  if (accepted.state !== 'held') return missingLine(accepted.why);
  const how = accepted.by === 'auto-tick' ? 'Accepted by auto tick, for' : accepted.by === 'checks' ? 'Accepted by its checks:' : 'Accepted by';
  return `${how} ${esc(accepted.who)} · ${esc(whenOf(accepted.at))}`;
}

/**
 * An order's whole record as rows: what was asked, each try, the commit, the checks, who accepted it.
 * `doneOnly` draws just the tries: the other rows live in a receipt, and an order with none has no use for them.
 */
export function recordSection(record, doneOnly = false) {
  const tries = record.tries
    .map(
      (one) => `<li><span class="mono-chip" title="${esc(one.agent)}">${esc(monogramOf(one.agent))}</span> ${esc(agentNameOf(one.agent))} · ${one.model === null ? 'model not recorded' : `<span class="mono">${esc(one.model)}</span>`} · ${esc(minutesText(one.minutes))} · ${esc(one.cost)} · ${one.outcome === 'success' ? 'done' : esc(one.outcome)}</li>`,
    )
    .join('');
  const commit = record.commit.state === 'held' ? `<span class="mono">${esc(record.commit.commit)}</span>` : missingLine(record.commit.why);
  const done = `<div><dt>Done by</dt><dd>${tries === '' ? missingLine('no try is in the statement') : `<ul class="tries">${tries}</ul>`}</dd></div>`;
  if (doneOnly) return `<dl class="record">\n  ${done}\n</dl>`;
  return `<dl class="record">
  <div><dt>Asked</dt><dd>${askedLine(record.asked)}</dd></div>
  ${done}
  <div><dt>Checked</dt><dd>${checksLine(record.checks)}</dd></div>
  <div><dt>Approved by</dt><dd>${acceptedLine(record.accepted)}</dd></div>
  <div><dt>Landed</dt><dd>${commit}</dd></div>
</dl>`;
}

const ROLES = ['buyer', 'doer', 'checker', 'acceptor'];

/**
 * A verdict in words: valid, or every reason it is not; then what the document does not
 * establish and the key_id behind each role.
 */
export function verdictHtml(verdict) {
  const head = verdict.valid
    ? '<p class="tag ticked">Valid: every signature verified in this browser, and the documents chain.</p>'
    : `<p class="tag halt">Not valid, for ${verdict.reasons.length === 1 ? 'this reason' : 'these reasons'}:</p><ul class="reasons">${verdict.reasons.map((one) => `<li>${esc(one)}</li>`).join('')}</ul>`;
  const limits = verdict.limits.length === 0 ? '' : `<h3>What this does not establish</h3><ul class="limits">${verdict.limits.map((one) => `<li>${esc(one)}</li>`).join('')}</ul>`;
  const signers = verdict.signers ?? {};
  const keys = ROLES.filter((role) => role in signers).map((role) => `<li>${esc(role)}: <span class="mono">${signers[role] === null ? 'no key' : esc(signers[role])}</span></li>`);
  const keysHtml = keys.length === 0 ? '' : `<h3>Who signed (key_id)</h3><ul class="keys">${keys.join('')}</ul>`;
  const one = ROLES.every((role) => typeof signers[role] === 'string' && signers[role] === signers.buyer);
  const oneKey = verdict.valid && one ? `<p class="one-key">Signed by <span class="mono">${esc(signers.buyer)}</span>: one company ordered, did, checked and accepted this work.</p>` : '';
  return `${head}${oneKey}${limits}${keysHtml}`;
}

/** What "Change one character" did, named so the visitor can see it. */
export function changeNote(change, place) {
  const shown = (char) => `<span class="mono">“${esc(char)}”</span>`;
  const where = place.field === null ? '' : `, in ${esc(place.field)}`;
  return `<p class="change">Changed character ${change.at + 1} of the receipt (line ${place.line}, column ${place.column}${where}): ${shown(change.from)} became ${shown(change.to)}. The receipt on disk is unchanged.</p>`;
}

export const NO_RECEIPT = 'This order has no receipt: no work order was signed when its work started.';

/**
 * One order: its stations, its whole record, and the button that checks its receipt in this browser.
 * `noReceipt` is true where the folder holds no receipt file for an accepted order: it says so, with no button.
 */
export function orderCard(order, verified, record = recordOf(order), noReceipt = false) {
  const check =
    !order.accepted
      ? '<p class="src">No receipt: this work was not accepted.</p>'
      : noReceipt
        ? `<p class="src no-receipt">${NO_RECEIPT}</p>`
        : `<div class="buttons"><button type="button" class="check" data-task="${esc(order.taskId)}">Check it yourself</button></div>`;
  return `<article class="card order" id="o-${esc(order.taskId)}">
  ${stationsLine(order, verified)}
  <p class="mono src">${esc(order.taskId)}${order.disposition === null ? '' : ` · ${esc(order.disposition)}`}</p>
  ${recordSection(record, noReceipt)}
  ${check}
  <div class="verdict" aria-live="polite"></div>
</article>`;
}
