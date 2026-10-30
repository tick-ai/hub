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
  let agentTriesReported = 0;
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
        if (one.cost !== 'unknown') agentTriesReported += 1;
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
    agentTriesReported,
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
  const known = { claude: 'CC', 'claude-code': 'CC', codex: 'Cx', grok: 'GB', 'attached-session': 'Cn' };
  return known[agent] ?? agent.slice(0, 2).toUpperCase();
}

/** An agent as a person reads it. A conversation's own try named no agent in earlier records. */
export function agentNameOf(agent) {
  const known = { claude: 'Claude Code', 'claude-code': 'Claude Code', codex: 'Codex', grok: 'Grok', 'attached-session': 'an agent in a conversation' };
  return known[agent] ?? agent;
}

/** What the agents' tries cost, or that no agent's try reported a cost: a figure the record lacks is never a zero. */
export function costOfAgents(summary) {
  return summary.agentTriesReported === 0 ? 'not reported' : dollars(summary.usdMicrosReported);
}

/** A field the record holds. */
const held = (value) => ({ state: 'held', ...value });
/** A field the record does not hold, said so and why: never shown as if it were there. */
const missing = (why) => ({ state: 'missing', why });

const NOT_HELD = 'the statement does not hold it, and the receipt was not read';

/** One try as the record shows it: the cost as reported, or that no cost was reported. */
function tryRecord(one) {
  const cost =
    one.cost === 'unknown' || one.usd_micros === null || one.usd_micros === undefined
      ? 'not reported'
      : `${dollars(one.usd_micros)}, ${one.cost === 'metered' ? 'metered' : 'as the agent reported it'}`;
  return {
    agent: one.agent,
    model: one.model ?? null,
    minutes: one.minutes ?? null,
    outcome: one.outcome,
    cost,
  };
}

/**
 * An order's whole record. The statement holds the tries and whether the order was
 * accepted; what was asked, the commit, the checks and who accepted it and when are in the
 * order's receipt. `receipt` is that receipt (tick.receipt.v2) where the caller read it and
 * this browser verified it, and null otherwise. A field neither holds is `missing`, with
 * the reason, never a blank or a zero.
 */
export function recordOf(order, receipt = null) {
  const body = receipt !== null && typeof receipt === 'object' ? receipt.receipt : undefined;
  const what = body?.order?.order?.what;
  const commit = body?.delivery?.delivery?.commit;
  const results = body?.check?.record?.results;
  const verdict = body?.check?.record?.verdict;
  const acceptance = body?.acceptance;
  let accepted;
  if (!order.accepted) accepted = { state: 'not-accepted' };
  else if (acceptance && typeof acceptance === 'object') accepted = held({ by: acceptance.by, who: acceptance.who, at: acceptance.at });
  else accepted = missing(NOT_HELD);
  return {
    taskId: order.taskId,
    asked: typeof what === 'string' && what !== '' ? held({ first: what.split(/\r?\n/u)[0], whole: what }) : missing(NOT_HELD),
    tries: order.tries.map(tryRecord),
    commit: typeof commit === 'string' ? held({ commit }) : missing(NOT_HELD),
    checks: Array.isArray(results) ? held({ verdict: verdict ?? null, results: results.map((one) => ({ name: one.name, outcome: one.outcome })) }) : missing(NOT_HELD),
    accepted,
  };
}

// ---------------------------------------------------------------- change one character

/** Every string of a JSON text with where it is: [start, end) of its quotes, whether it is a key, its path. */
function stringsOf(text) {
  const out = [];
  const stack = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const top = stack[stack.length - 1];
      const isKey = top !== undefined && top.type === 'obj' && top.expectKey;
      if (isKey) top.key = JSON.parse(text.slice(i, j + 1));
      out.push({ start: i, end: j + 1, isKey, path: stack.map((f) => (f.type === 'obj' ? f.key : f.index)) });
      i = j + 1;
      continue;
    }
    const top = stack[stack.length - 1];
    if (c === '{') stack.push({ type: 'obj', key: null, expectKey: true });
    else if (c === '[') stack.push({ type: 'arr', index: 0 });
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ':' && top?.type === 'obj') top.expectKey = false;
    else if (c === ',' && top !== undefined) {
      if (top.type === 'obj') top.expectKey = true;
      else top.index += 1;
    }
    i += 1;
  }
  return out;
}

function otherCharacter(char) {
  if (char >= 'a' && char <= 'z') return char === 'z' ? 'a' : String.fromCharCode(char.charCodeAt(0) + 1);
  if (char >= 'A' && char <= 'Z') return char === 'Z' ? 'A' : String.fromCharCode(char.charCodeAt(0) + 1);
  return String((Number(char) + 1) % 10);
}

/**
 * Changes one character inside the signed body of a receipt of version two: the value of
 * its `receipt`, and nowhere else (`signature`, `key`, `key_id` and `limits` prove
 * nothing about the body, and `limits` is not signed). The character is a letter or a
 * digit inside a string value that holds no escape, changed to another letter or digit,
 * so the text stays valid JSON. Returns `{ text, at, from, to }`, `at` the character's
 * index in the text. Throws where the text is no receipt of version two.
 */
export function changeOneCharacter(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error('it is not JSON');
  }
  if (doc === null || typeof doc !== 'object' || doc.schema !== 'tick.receipt.v2' || doc.receipt === null || typeof doc.receipt !== 'object') {
    throw new Error('it is not a receipt of version two');
  }
  const inBody = stringsOf(text).filter((one) => !one.isKey && one.path[0] === 'receipt' && one.path.length >= 2 && !text.slice(one.start, one.end).includes('\\'));
  for (const wanted of [/[A-Za-z]/u, /[0-9]/u]) {
    for (const one of inBody) {
      const offset = text.slice(one.start + 1, one.end - 1).search(wanted);
      if (offset === -1) continue;
      const at = one.start + 1 + offset;
      const from = text[at];
      const to = otherCharacter(from);
      return { text: text.slice(0, at) + to + text.slice(at + 1), at, from, to };
    }
  }
  throw new Error('the receipt holds no character that can be changed');
}

/** Where a character is, in words a visitor can follow: its line and column, and the field it is in. */
export function placeOf(text, at) {
  const before = text.slice(0, at);
  const line = before.split('\n').length;
  const column = at - (before.lastIndexOf('\n') + 1) + 1;
  const inside = stringsOf(text).find((one) => one.start < at && at < one.end);
  return { line, column, field: inside === undefined ? null : inside.path.join('.') };
}
