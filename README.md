# TickHub

The page served at tick.company/hub: a company's projects with their record,
checked in the visitor's own browser.

For every project it shows what was asked, which agent did each try, what each
try cost as the agent reported it, the tries no cost was reported for, the
orders accepted with a receipt, and the receipt itself, which the visitor can
check with one button. Nothing on the page is typed by hand: every figure is
added up from signed statements (`tick.project-receipt.v2`), and green appears
only where this browser has just verified a signature.

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

The fonts in `fonts/` are Instrument Sans, Instrument Serif and DM Mono, each under
the SIL Open Font License 1.1 (`fonts/OFL.txt`), so the page loads nothing from
anywhere else.

## Two pages that open from a file

Two pages are made by commands, each as ONE self-contained HTML file a person can receive by any channel (Telegram, email) and open from disk. Neither depends on a host, and neither makes a network request of any kind: the page's content security policy allows none.

- A receipt page, to see one receipt and check it with nothing installed: `node tools/receipt-page.mjs <receipt.json> <out.html>`. It refuses a file that is not a valid `tick.receipt.v2`. The page shows the receipt's rows from its record, and its buttons "Check it yourself" and "Change one character and check again" run `verify.js` in the browser.
- An approve page, for a company with no developer to approve one order with its own key: `node tools/approve-page.mjs <order-body.json> <out.html>`. It refuses a body that does not make a valid `tick.work-order.v1`. One file approves one order. The page signs in the browser, checks its own result, and offers the signed order to save or copy. A key stays in the browser and never appears in the saved order.

## Checks

`node --test` runs every test; Tick runs the same as this repository's check.

## How it was built

Every commit after this repository's first was made by an AI agent working in Tick. The first commit holds only the order: the specification, the vectors, the design it follows and the check that decides done. Three landings have no receipt: 953f1860 (verify.js), 564bfd99 (the index chain) and afb9ffb9 (an order's whole record). Their tasks named top-level files in a form Tick could not sign, so no work order was signed when their work started, and one cannot be signed after it. They stay in the history, and ticked-line.json draws the line after them: every landing after afb9ffb9 carries a receipt that verifies. TickHub shows the record of its own making, gaps included.

Licensed under the Apache License, Version 2.0.
