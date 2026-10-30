// TickHub's page: reads a company's folder (index.json, then each project's
// statements and receipts), checks every document in this browser with
// verify.js, and draws what it found. It asks nothing of anyone but the files
// beside it; the page's policy allows no other request.

import { takenOut, walkIndexes } from './chain.js';
import { changeOneCharacter, headsOf, ordersOf, placeOf, recordOf, summaryOf } from './model.js';
import { changeNote, esc, frontPage, orderCard, verdictHtml } from './render.js';
import { verifyDocument } from './verify.js';

const main = document.getElementById('main');

async function textOf(path) {
  const answer = await fetch(path, { cache: 'no-cache' });
  if (!answer.ok) throw new Error(`${path}: ${answer.status}`);
  return answer.text();
}

/** A document read and checked; `verified` only when this browser's check passed. */
async function checked(path, kind) {
  const text = await textOf(path);
  const verdict = await verifyDocument(text);
  return { document: JSON.parse(text), verified: verdict.valid && verdict.kind === kind, verdict };
}

let loaded;

/** The index and its chain, read once per page load. */
function theIndex() {
  loaded ??= (async () => {
    const text = await textOf('index.json');
    const verdict = await verifyDocument(text);
    const signed = JSON.parse(text);
    const index = { document: signed, verified: verdict.valid && verdict.kind === 'hub-index', verdict };
    if (!index.verified) return { index, history: { taken: [], stopped: null } };
    const read = (hash) => (hash === signed.content_hash ? text : textOf(`indexes/${encodeURIComponent(hash)}.json`));
    const { indexes, stopped } = await walkIndexes(read, verifyDocument, signed.content_hash);
    return { index, history: { taken: takenOut(indexes), stopped } };
  })();
  return loaded;
}

async function statementsOf(project) {
  const statements = new Map();
  for (const hash of headsOf(project)) {
    const read = await checked(`projects/${encodeURIComponent(project.slug)}/statements/${hash}.json`, 'project-statement');
    if (read.verified) statements.set(hash, read.document);
  }
  return statements;
}

async function front() {
  const { index, history } = await theIndex();
  const projects = index.document.index.projects;
  const summaries = [];
  for (const project of projects) summaries.push(summaryOf(project, await statementsOf(project)));
  main.innerHTML = frontPage(summaries, index.verified, history);
}

async function projectPage(slug) {
  const { index } = await theIndex();
  const project = index.document.index.projects.find((one) => one.slug === slug);
  if (project === undefined) {
    main.innerHTML = `<p>No project named ${esc(slug)} is in this index.</p>`;
    return;
  }
  const statements = await statementsOf(project);
  const cards = [];
  const orders = [];
  for (const hash of headsOf(project)) {
    const statement = statements.get(hash);
    if (statement === undefined) continue;
    for (const order of ordersOf(statement)) orders.push(order);
  }
  // An order's receipt holds what the statement does not; it fills the record only where it verified here.
  const records = await Promise.all(
    orders.map(async (order) => {
      if (!order.accepted) return recordOf(order);
      try {
        const read = await checked(receiptPath(project.slug, order.taskId), 'receipt');
        return recordOf(order, read.verified ? read.document : null);
      } catch {
        return recordOf(order);
      }
    }),
  );
  orders.forEach((order, i) => cards.push(orderCard(order, false, records[i])));
  const notice = index.verified ? '' : '<p class="tag halt">This index does not verify in this browser. Nothing below is shown as checked.</p>';
  main.innerHTML = `${notice}<h1>${esc(project.name)}</h1><p class="mono src">${esc(project.repository)}</p>${cards.join('\n')}`;
  for (const button of main.querySelectorAll('button.check')) {
    button.addEventListener('click', () => checkReceipt(project.slug, button, index.verified));
  }
}

const receiptPath = (slug, task) => `projects/${encodeURIComponent(slug)}/receipts/${encodeURIComponent(task)}.json`;

async function checkReceipt(slug, button, indexVerified) {
  const card = button.closest('.order');
  const out = card.querySelector('.verdict');
  const path = receiptPath(slug, button.dataset.task);
  button.disabled = true;
  try {
    const read = await checked(path, 'receipt');
    out.innerHTML = verdictHtml(read.verdict);
    card.querySelector('.line li:last-child')?.classList.toggle('ticked', read.verified && indexVerified);
    card.querySelector('.line li:last-child')?.classList.toggle('on', read.verified && indexVerified);
    addChangeButton(card, button, path);
  } catch (error) {
    out.textContent = `The receipt could not be read: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    button.disabled = false;
  }
}

/** Beside "Check it yourself": change one character of the receipt as read now, and check that. */
function addChangeButton(card, button, path) {
  if (card.querySelector('button.again') !== null) return;
  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'check again';
  again.textContent = 'Change one character and check again';
  again.addEventListener('click', async () => {
    const out = card.querySelector('.verdict');
    again.disabled = true;
    try {
      // The receipt is read from disk each time and never written: only this copy in memory changes.
      const change = changeOneCharacter(await textOf(path));
      const verdict = await verifyDocument(change.text);
      out.innerHTML = `${changeNote(change, placeOf(change.text, change.at))}${verdictHtml(verdict)}`;
    } catch (error) {
      out.textContent = `The receipt could not be changed and checked: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      again.disabled = false;
    }
  });
  button.insertAdjacentElement('afterend', again);
}

async function route() {
  const match = /^#\/p\/([a-z0-9-]+)$/u.exec(location.hash);
  try {
    if (match === null) await front();
    else await projectPage(match[1]);
  } catch (error) {
    main.textContent = `This page could not read its record: ${error instanceof Error ? error.message : String(error)}`;
  }
}

addEventListener('hashchange', route);
route();
