// What the page says of the record, in the words docs/design.md sets: a figure the record
// lacks is said to be missing, never a zero; agents by name; nothing said twice.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { agentNameOf, costOfAgents, headsOf, monogramOf, ordersOf, recordOf, summaryOf } from '../model.js';
import { frontPage, recordSection, verdictHtml } from '../render.js';

const vectors = join(fileURLToPath(new URL('..', import.meta.url)), 'vectors');
const read = (name) => JSON.parse(readFileSync(join(vectors, name), 'utf8'));

const project = read('site/index.json').index.projects[0];
const statement = read(`site/projects/${project.slug}/statements/${headsOf(project)[0]}.json`);
const summary = summaryOf(project, new Map([[headsOf(project)[0], statement]]));

test('a project whose agents reported no cost says so, and shows no zero', () => {
  assert.equal(summary.agentTries, 1);
  assert.equal(summary.agentTriesReported, 0);
  assert.equal(costOfAgents(summary), 'not reported');
  const html = frontPage([summary], true);
  assert.match(html, /not reported/u);
  assert.doesNotMatch(html, /\$0\.00/u);
});

test('the front page says what it is and asks for the first work orders, verified or not', () => {
  for (const verified of [true, false]) {
    const html = frontPage([summary], verified);
    const h1 = '<h1>Who built this, and what did it cost?</h1>';
    const ask = '<p class="ask"><a href="https://www.instagram.com/_tick_group">DM TICKED</a> for the first 20 work orders.</p>';
    assert.ok(html.includes(h1), `h1, verified ${verified}`);
    assert.ok(html.includes(ask), `ask, verified ${verified}`);
    assert.ok(html.indexOf(h1) < html.indexOf('<p class="tag '), 'the h1 comes before the verdict line');
    assert.ok(html.indexOf(ask) > html.indexOf('</article>'), 'the ask comes after the cards');
  }
});

test('a project whose agents reported a cost shows it', () => {
  assert.equal(costOfAgents({ agentTriesReported: 2, usdMicrosReported: 2_138_942 }), '$2.14');
});

test('agents go by their names, and an unnamed conversation is said in words', () => {
  assert.equal(agentNameOf('claude'), 'Claude Code');
  assert.equal(agentNameOf('claude-code'), 'Claude Code');
  assert.equal(agentNameOf('some-new-agent'), 'some-new-agent');
  assert.equal(monogramOf('claude-code'), 'CC');
  const html = frontPage([summary], true);
  assert.doesNotMatch(html.replace(/title="[^"]*"/gu, ''), /attached-session/u);
  assert.match(html, /an agent in a conversation/u);
});

test('an order reads in the words of the design, its verdict said once', () => {
  const [order] = ordersOf(statement);
  const receipt = read(`site/projects/${project.slug}/receipts/${order.taskId}.json`);
  const html = recordSection(recordOf(order, receipt));
  for (const label of ['Asked', 'Done by', 'Checked', 'Approved by', 'Landed']) {
    assert.match(html, new RegExp(`<dt>${label}</dt>`, 'u'));
  }
  assert.doesNotMatch(html, /passed · passed/u);
  assert.match(html, /Accepted by auto tick, for /u);
  assert.match(html, /\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/u);
});

test('one key behind every role is said in words, and only of a valid receipt', () => {
  const signers = { buyer: 'aaaa', doer: 'aaaa', checker: 'aaaa', acceptor: 'aaaa' };
  const said = /one company ordered, did, checked and accepted this work/u;
  assert.match(verdictHtml({ valid: true, reasons: [], limits: [], signers }), said);
  assert.doesNotMatch(verdictHtml({ valid: true, reasons: [], limits: [], signers: { ...signers, doer: 'bbbb' } }), said);
  assert.doesNotMatch(verdictHtml({ valid: false, reasons: ['no'], limits: [], signers }), said);
});
