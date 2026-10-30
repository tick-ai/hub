// TickHub's markup, as strings built from the record. Whatever a document holds
// reaches the page as text, never as markup: every value goes through esc().
// Green appears only where the caller says this browser verified a document.

import { STOPPED } from './chain.js';
import { dollars, monogramOf, stationsOf } from './model.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value).replace(/[&<>"']/gu, (char) => ESCAPES[char]);
}

function agentsLine(agents) {
  if (agents.length === 0) return 'no try recorded yet';
  return agents
    .map((one) => `<span class="mono-chip" title="${esc(one.agent)}">${esc(monogramOf(one.agent))}</span> ${esc(one.model ?? one.agent)} · ${one.tries} ${one.tries === 1 ? 'try' : 'tries'}`)
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
    <div><dt>cost, as the agents reported it</dt><dd class="figure">${esc(dollars(one.usdMicrosReported))}</dd></div>
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
  return `<section class="front">${verdict}\n${cards}\n${taken}</section>`;
}

/** The stations of one order, Ticked earned only by this browser's check of its receipt. */
export function stationsLine(order, verified) {
  return `<ol class="line">${stationsOf(order, verified)
    .map((one) => `<li class="${one.reached ? 'on' : 'off'}${one.name === 'Ticked' && one.reached ? ' ticked' : ''}">${esc(one.name)}</li>`)
    .join('')}</ol>`;
}

/** One order: what was asked is in its receipt; here, its stations, its tries and what they cost. */
export function orderCard(order, verified) {
  const tries = order.tries
    .map(
      (one) => `<li><span class="mono-chip">${esc(monogramOf(one.agent))}</span> ${esc(one.agent)} · ${esc(one.model ?? 'model not reported')} · ${one.minutes === null ? '—' : `${(Math.round(one.minutes * 10) / 10).toString()} min`} · ${esc(one.cost === 'unknown' ? 'not reported' : `${dollars(one.usd_micros)}, as reported`)} · ${esc(one.outcome)}</li>`,
    )
    .join('');
  const check =
    !order.accepted
      ? '<p class="src">No receipt: this work was not accepted.</p>'
      : `<button type="button" class="check" data-task="${esc(order.taskId)}">Check it yourself</button>`;
  return `<article class="card order" id="o-${esc(order.taskId)}">
  ${stationsLine(order, verified)}
  <p class="mono src">${esc(order.taskId)}${order.disposition === null ? '' : ` · ${esc(order.disposition)}`}</p>
  <ul class="tries">${tries}</ul>
  ${check}
  <div class="verdict" aria-live="polite"></div>
</article>`;
}
