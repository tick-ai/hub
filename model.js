// What TickHub shows, computed from the record and from nothing else.
//
// Every figure here is added up from signed statements (tick.project-receipt.v2):
// a project's orders and its tries, what they cost as the agents reported it, the
// tries no cost was reported for (counted apart, never as zero), the orders
// accepted, and the agents that did the work. A statement lists every task of a
// project, Tick's own among them: each task names its `type`, and the steps Tick
// sends with an order (`integrate`, `land`) name the order in `step_of`. An order
// was accepted when the `land` step that names it carries a receipt (spec/SPEC.md,
// "A task and its steps"). The functions are pure, so the page and its tests
// compute the same numbers from the same files.

/** The types of Tick's own tasks of a project, which no one ordered. */
const OWN_TYPES = new Set(['finish', 'release', 'undo']);

/** Whole millionths of a dollar, written as dollars and cents; under a cent, as the micro-dollars it is. */
export function dollars(micros) {
  if (micros === null || micros === undefined) return 'not reported';
  if (micros > 0 && micros < 10_000) return `$${(micros / 1_000_000).toFixed(6).replace(/0+$/u, '')}`;
  return `$${(Math.round(micros / 10_000) / 100).toFixed(2)}`;
}

/** The statements of each run of a project, newest of each, as the index names them. */
export function headsOf(project) {
  return (project.runs ?? []).map((run) => run.head);
}

/** Whether a task is work someone ordered: not a step of another task, and not one of Tick's own. */
function isOrder(task) {
  return task.step_of === null && !OWN_TYPES.has(task.type);
}

function costOf(tries) {
  return {
    usdMicrosReported: tries.filter((one) => one.cost === 'reported').reduce((total, one) => total + one.usd_micros, 0),
    triesUnknown: tries.filter((one) => one.cost === 'unknown').length,
  };
}

/** The orders of one statement, in its order, each with its own tries, its steps' tries and whether it was accepted. */
export function ordersOf(statement) {
  const tasks = statement.statement.tasks;
  return tasks.filter(isOrder).map((task) => {
    const steps = tasks.filter((one) => one.step_of === task.task_id);
    const stepTries = steps.flatMap((one) => one.tries);
    return {
      taskId: task.task_id,
      type: task.type,
      finalState: task.final_state,
      disposition: task.disposition,
      accepted: steps.some((one) => one.type === 'land' && one.receipt !== null),
      tries: task.tries,
      stepTries,
      ...costOf([...task.tries, ...stepTries]),
    };
  });
}

/** One project's summary, from the head statement of each of its runs. */
export function summaryOf(project, statements) {
  const agents = new Map();
  let orders = 0;
  let accepted = 0;
  let agentTries = 0;
  let tries = 0;
  let unknown = 0;
  let reported = 0;
  for (const hash of headsOf(project)) {
    const statement = statements.get(hash);
    if (statement === undefined) continue;
    const body = statement.statement;
    tries += body.totals.tries;
    unknown += body.totals.tries_unknown;
    reported += body.totals.usd_micros_reported;
    for (const order of ordersOf(statement)) {
      orders += 1;
      if (order.accepted) accepted += 1;
      for (const one of order.tries) {
        agentTries += 1;
        const key = `${one.agent}\u0000${one.model ?? ''}`;
        const seen = agents.get(key) ?? { agent: one.agent, model: one.model, tries: 0 };
        seen.tries += 1;
        agents.set(key, seen);
      }
    }
  }
  return {
    slug: project.slug,
    name: project.name,
    repository: project.repository,
    orders,
    accepted,
    tries,
    agentTries,
    tickTries: tries - agentTries,
    triesUnknown: unknown,
    usdMicrosReported: reported,
    agents: [...agents.values()].sort((a, b) => b.tries - a.tries || a.agent.localeCompare(b.agent)),
  };
}

/**
 * The stations of one order, as Tick names them: Asked, Working, Checked, Your
 * OK, Ticked. A statement says what was asked, that tries ran, and whether the
 * order was accepted, which Tick does only for work its check passed; "Ticked"
 * is earned only when the visitor's browser verified the order's receipt, which
 * the caller says.
 */
export function stationsOf(order, verified) {
  return [
    { name: 'Asked', reached: true },
    { name: 'Working', reached: order.tries.length > 0 },
    { name: 'Checked', reached: order.accepted },
    { name: 'Your OK', reached: order.accepted },
    { name: 'Ticked', reached: order.accepted && verified === true },
  ];
}

/** Two letters for an agent, as Tick's screens show it: CC for Claude Code, Cx for Codex. */
export function monogramOf(agent) {
  const known = { claude: 'CC', 'claude-code': 'CC', codex: 'Cx', grok: 'GB' };
  return known[agent] ?? agent.slice(0, 2).toUpperCase();
}
