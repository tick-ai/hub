// The history of a company's index: each index names the one it replaced by
// `previous` (spec/SPEC.md, tick.hub-index.v1), kept at indexes/<content_hash>.json.
// This reads that chain back to the first index, checking every index it reads,
// and says what an older index listed that the newest does not. It reads nothing
// itself: the caller gives it a `read` and a `verify`, so the page and its tests
// walk the same way.

/** Why a walk stopped, as the page words it. */
export const STOPPED = {
  missing: 'its file could not be read',
  unverified: 'it does not verify',
  loop: 'it names an index already read',
};

const reasonOf = (error) => (error instanceof Error ? error.message : String(error));

/**
 * Follows `previous` from the index whose content hash is `head` back to the first.
 * `read(hash)` answers the text of that index, or throws or answers nothing when
 * it cannot; `verify(text)` answers `{ kind, valid, reasons }` as verifyDocument does.
 * Answers `{ indexes, stopped }`: the indexes read and verified, oldest first, and
 * `stopped`, null when the first index was reached, else `{ reason, hash, from, detail }`
 * with `reason` one of missing, unverified and loop, `hash` the index it stopped at
 * and `from` the newer index that named it (null for the head).
 */
export async function walkIndexes(read, verify, head) {
  const newestFirst = [];
  const named = new Set();
  const documents = new Set();
  let from = null;
  let hash = head;
  const stop = (reason, detail) => ({ indexes: newestFirst.reverse(), stopped: { reason, hash, from, detail } });
  while (hash !== null) {
    if (named.has(hash)) return stop('loop', `${hash} was read already`);
    named.add(hash);
    let text;
    try {
      text = await read(hash);
    } catch (error) {
      return stop('missing', reasonOf(error));
    }
    if (typeof text !== 'string') return stop('missing', 'nothing was read');
    const verdict = await verify(text);
    if (verdict.kind !== 'hub-index') return stop('unverified', `it is not an index (${verdict.kind})`);
    if (!verdict.valid) return stop('unverified', verdict.reasons.join('; '));
    const document = JSON.parse(text);
    if (documents.has(document.content_hash)) return stop('loop', `${document.content_hash} was read already`);
    if (document.content_hash !== hash) return stop('unverified', `the file holds the index ${document.content_hash}`);
    documents.add(hash);
    newestFirst.push({ hash, issuedAt: document.issued_at, projects: document.index.projects, verified: true, document });
    from = hash;
    hash = document.index.previous;
  }
  return { indexes: newestFirst.reverse(), stopped: null };
}

/**
 * What an older index listed and the newest does not, from `indexes` oldest first:
 * a project by slug, or, where its project stays, a run by run_id. Each is
 * `{ kind, slug, run_id?, name, last, verified }`: `last` the newest index that still
 * listed it, and `verified` whether every index from the newest back to that one did.
 * Projects first, then runs, each by slug and run_id.
 */
export function takenOut(indexes) {
  if (indexes.length < 2) return [];
  const newest = indexes[indexes.length - 1];
  const now = new Map(newest.projects.map((project) => [project.slug, new Set(project.runs.map((run) => run.run_id))]));
  const gone = new Map();
  indexes.forEach((one, at) => {
    for (const project of one.projects) {
      const kept = now.get(project.slug);
      if (kept === undefined) gone.set(`project\u0000${project.slug}`, { kind: 'project', slug: project.slug, name: project.name, at });
      else {
        for (const run of project.runs) {
          if (!kept.has(run.run_id)) {
            gone.set(`run\u0000${project.slug}\u0000${run.run_id}`, { kind: 'run', slug: project.slug, run_id: run.run_id, name: project.name, at });
          }
        }
      }
    }
  });
  const rank = (one) => (one.kind === 'project' ? 0 : 1);
  return [...gone.values()]
    .map(({ at, ...rest }) => ({
      ...rest,
      last: indexes[at],
      verified: indexes.slice(at).every((one) => one.verified === true),
    }))
    .sort((a, b) => rank(a) - rank(b) || a.slug.localeCompare(b.slug) || (a.run_id ?? '').localeCompare(b.run_id ?? ''));
}
