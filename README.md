# TickHub

The page served at tick.company/hub: a company's projects with their record,
checked in the visitor's own browser.

For every project it shows what was asked, which agent did each try, what each
try cost as the agent reported it, the tries no cost was reported for, the
orders accepted with a receipt, and the receipt itself, which the visitor can
check with one button. Nothing on the page is typed by hand: every figure is
added up from signed statements (`tick.project-receipt.v2`), and green appears
only where this browser has just verified a signature.

**Not usable yet.** This commit holds the page's architecture: its routes, the
record model and how the page draws it. The check that verifies a document in the
browser comes with the next task; until then `verify.js` says it cannot check, and
nothing on the page turns green. This paragraph goes with that commit.

## How it reads a folder

`tick export --hub <folder>` writes what this page reads:

- `index.json`: the company's index of its published projects (`tick.hub-index.v1`)
- `indexes/<hash>.json`: every index it replaced, by content hash, so the chain of `previous` can be
  walked back to the first and a project taken out of a later index shows
- `projects/<slug>/statements/<hash>.json`: each run's statements, by content hash
- `projects/<slug>/receipts/<task>.json`: each accepted order's receipt (`tick.receipt.v2`)
- `.well-known/tick-keys.json`: the keys the company names (`tick-keys/1`)

Put this page's files beside them on any static host. The page makes no request
but for those files: its content security policy allows nothing else.

## Checks

`node --test` runs every test; Tick runs the same as this repository's check.

## How it was built

Every commit after this repository's first was made by an AI agent working in
Tick, and each carries a receipt that verifies. The first commit holds only the
order: the specification, the vectors, the design it follows and the check that
decides done. TickHub shows the record of its own making.

Licensed under the Apache License, Version 2.0.
