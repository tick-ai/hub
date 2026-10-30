// TickHub's page: reads a company's folder (index.json, then each project's
// statements and receipts), checks every document in this browser with
// verify.js, and draws what it found. It asks nothing of anyone but the files
// beside it; the page's policy allows no other request.

import { headsOf, ordersOf, summaryOf } from './model.js';
import { esc, frontPage, orderCard } from './render.js';
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

async function statementsOf(project) {
  const statements = new Map();
  for (const hash of headsOf(project)) {
    const read = await checked(`projects/${encodeURIComponent(project.slug)}/statements/${hash}.json`, 'project-statement');
    if (read.verified) statements.set(hash, read.document);
  }
  return statements;
}

async function front() {
  const index = await checked('index.json', 'hub-index');
  const projects = index.document.index.projects;
  const summaries = [];
  for (const project of projects) summaries.push(summaryOf(project, await statementsOf(project)));
  main.innerHTML = frontPage(summaries, index.verified);
}

async function projectPage(slug) {
  const index = await checked('index.json', 'hub-index');
  const project = index.document.index.projects.find((one) => one.slug === slug);
  if (project === undefined) {
    main.innerHTML = `<p>No project named ${esc(slug)} is in this index.</p>`;
    return;
  }
  const statements = await statementsOf(project);
  const cards = [];
  for (const hash of headsOf(project)) {
    const statement = statements.get(hash);
    if (statement === undefined) continue;
    for (const order of ordersOf(statement)) cards.push(orderCard(order, false));
  }
  main.innerHTML = `<h1>${esc(project.name)}</h1><p class="mono src">${esc(project.repository)}</p>${cards.join('\n')}`;
  for (const button of main.querySelectorAll('button.check')) {
    button.addEventListener('click', () => checkReceipt(project.slug, button));
  }
}

async function checkReceipt(slug, button) {
  const card = button.closest('.order');
  const out = card.querySelector('.verdict');
  button.disabled = true;
  try {
    const read = await checked(`projects/${encodeURIComponent(slug)}/receipts/${encodeURIComponent(button.dataset.task)}.json`, 'receipt');
    out.textContent = read.verified
      ? 'Valid: every signature verified in this browser, and the documents chain.'
      : `Not valid: ${read.verdict.reasons.join('; ')}`;
    card.querySelector('.line li:last-child')?.classList.toggle('ticked', read.verified);
    card.querySelector('.line li:last-child')?.classList.toggle('on', read.verified);
  } catch (error) {
    out.textContent = `The receipt could not be read: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    button.disabled = false;
  }
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
