import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dollars, ordersOf, stationsOf, summaryOf } from '../model.js';
import { esc, frontPage, orderCard } from '../render.js';

const step = (taskId, type, of, receipt, agent) => ({
  task_id: taskId,
  type,
  step_of: of,
  final_state: 'succeeded',
  disposition: null,
  receipt,
  tries: [{ attempt_id: `${taskId}-a`, agent, model: null, minutes: 0.1, outcome: 'success', usd_micros: 0, cost: 'reported' }],
});

// The shape a coordinator gives: an order's acceptance is its land step's receipt.
const statement = {
  statement: {
    tasks: [
      {
        task_id: 'task-1',
        type: 'implement',
        step_of: null,
        final_state: 'succeeded',
        disposition: null,
        receipt: null,
        tries: [
          { attempt_id: 'a1', agent: 'claude', model: 'claude-sonnet-5-5', minutes: 9.6, outcome: 'failure', usd_micros: 120_000, cost: 'reported' },
          { attempt_id: 'a2', agent: 'claude', model: 'claude-sonnet-5-5', minutes: 4, outcome: 'success', usd_micros: 660_000, cost: 'reported' },
        ],
      },
      step('task-1-integrate', 'integrate', 'task-1', null, 'integrator'),
      step('task-1-land', 'land', 'task-1', 'a'.repeat(64), 'lander'),
      {
        task_id: 'task-2',
        type: 'implement',
        step_of: null,
        final_state: 'failed',
        disposition: 'dropped',
        receipt: null,
        tries: [{ attempt_id: 'a3', agent: 'codex', model: null, minutes: null, outcome: 'failure', usd_micros: null, cost: 'unknown' }],
      },
      step('finish', 'finish', null, null, 'finisher'),
    ],
    totals: { tries: 6, tries_unknown: 1, usd_micros_reported: 780_000, usd_micros_metered: 0 },
  },
};
const project = { slug: 'hub', name: 'TickHub', repository: 'https://github.com/tick-ai/hub', runs: [{ run_id: 'r', statements: ['s'], head: 's' }] };

test('the orders are the tasks no other task is a step of, Tick’s own tasks left out', () => {
  assert.deepEqual(ordersOf(statement).map((one) => one.taskId), ['task-1', 'task-2']);
});

test('an order is accepted when the land step that names it carries a receipt', () => {
  const [first, second] = ordersOf(statement);
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
});

test('a project is summed from the head statement of each run, the unknown counted apart', () => {
  const summary = summaryOf(project, new Map([['s', statement]]));
  assert.deepEqual(
    {
      orders: summary.orders,
      accepted: summary.accepted,
      tries: summary.tries,
      agentTries: summary.agentTries,
      tickTries: summary.tickTries,
      unknown: summary.triesUnknown,
      micros: summary.usdMicrosReported,
    },
    { orders: 2, accepted: 1, tries: 6, agentTries: 3, tickTries: 3, unknown: 1, micros: 780_000 },
  );
  assert.deepEqual(summary.agents, [
    { agent: 'claude', model: 'claude-sonnet-5-5', tries: 2 },
    { agent: 'codex', model: null, tries: 1 },
  ]);
});

test('dollars are written as cents, a figure under a cent as what it is, and an unknown as not reported', () => {
  assert.equal(dollars(780_000), '$0.78');
  assert.equal(dollars(1), '$0.000001');
  assert.equal(dollars(0), '$0.00');
  assert.equal(dollars(null), 'not reported');
});

test('Ticked is reached only when this browser verified the receipt', () => {
  const [accepted, failed] = ordersOf(statement);
  assert.deepEqual(stationsOf(accepted, false).map((one) => one.reached), [true, true, true, true, false]);
  assert.deepEqual(stationsOf(accepted, true).map((one) => one.reached), [true, true, true, true, true]);
  assert.deepEqual(stationsOf(failed, true).map((one) => one.reached), [true, true, false, false, false]);
});

test('an order carries its own cost, its steps’ and its unknown tries', () => {
  const [first, second] = ordersOf(statement);
  assert.equal(first.usdMicrosReported, 780_000);
  assert.equal(first.stepTries.length, 2);
  assert.equal(second.triesUnknown, 1);
});

test('whatever a document holds reaches the page as text, never as markup', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>"\''), '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;');
  const hostile = { ...project, name: '<script>x</script>' };
  const html = frontPage([summaryOf(hostile, new Map([['s', statement]]))], false);
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;x'));
});

test('green is shown only for what this browser verified', () => {
  const [order] = ordersOf(statement);
  assert.ok(!orderCard(order, false).includes('ticked'));
  assert.ok(orderCard(order, true).includes('class="on ticked"'));
  assert.ok(!frontPage([], false).includes('ticked'));
  assert.ok(frontPage([], true).includes('tag ticked'));
});
