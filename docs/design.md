# TickHub's page: the design it follows

This is the order's design input, taken from Tick's design system (the brand book of
16 October 2026, which Tick's company memory holds as `doc:culture/design-system`).
Where this file and a later word from Ruqia disagree, Ruqia's word decides: every
visual is her call.

## What the page is

TickHub is where a company's projects are shown with their record: for every
piece of work, what was asked, which agent did each try, what each try cost, the
commit, the checks, and who said yes. Every line is a signed document, and the
visitor's browser checks it. The page shows records only: no messages, no
comments, no reviews.

## Five rules

1. Green is earned. Only what this browser has just verified turns green: a receipt
   whose signatures it checked, a statement whose totals it recomputed. Nothing else
   is green: not buttons, not links, not "probably fine". Before a document is
   checked it shows no verdict.
2. Every number from the record. Each figure says what it counts and where it came
   from ("from the record"). A number the record does not have is a dash with the
   reason, never a zero or a guess: a try whose cost was never reported says
   "not reported", and it is counted apart.
3. Plain words. The page never says runner, lease, gate, DAG, attempt or MCP. It
   says machine, agent, project, try, receipt, and the words below.
4. One way to check. Every receipt has "Check it yourself", and the page shows
   "Change one character and check again" on the first one a visitor opens.
5. It runs everywhere. 400 px wide is one column; both themes; nothing loads but the
   page's own files (Content-Security-Policy default-src 'self').

## The flow of one piece of work

Five stations, in this order and these words: Asked, Working, Checked, Your OK,
Ticked. "Ticked" is green only once this browser has verified the receipt.

## Words

| The record says | The page says |
| --- | --- |
| run, project | Project |
| attempt | a try |
| task succeeded, integrated and landed | Ticked |
| acceptance by auto tick | Accepted by auto tick, for <person> |
| cost reported | $0.66, as the agent reported it |
| cost unknown | not reported |
| receipt | Receipt |

Voice: short, plain, past tense once a thing is done. Say what happened, who did it,
how long it took and what it cost. No exclamation marks, no emoji, no hype, no
"AI-powered". Examples: "Ticked: rate limits for the API." "Claude Code, 11 min,
$0.84, as reported." Never call Tick a control plane or an operating system.

## Colour

Ground and cards are paper (white); cards are set apart by a hairline rule and a
radius, never by a grey fill or a shadow. Wells inside a card are mist. Text is ink,
secondary text ink-soft, both 4.5:1 on paper and mist in both themes. Done is tick
(shapes) and tick-text (words) on tick-wash. Failed is halt on halt-wash, always with
its word. The primary button is an ink fill. Logo colours: ink #0c1811 with the check
in #12a157 on light grounds; #e9f4ee with the check in #35d07f on dark grounds.

## Type

Everything a person reads is Instrument Sans. Numbers that come from the record are
Instrument Serif (the one figure a screen leads with, and a receipt's total). What a
machine wrote (paths, shas, ids, key ids) is DM Mono. Numbers in rows are tabular.
Fonts come from the page's own files, since nothing else may load.

The two pages made by `tools/receipt-page.mjs` and `tools/approve-page.mjs` are each one HTML file with no other file beside it, so they use a system font stack, since a single file carries no font files. Every other rule holds for them.

## The receipt card

Rows, in this order: Asked by · Done by (agent and model) · Changed (files) ·
Checked (what ran, and whether it passed) · Approved by · Landed (commit) · Cost.
Under them: "signed by <key id>" and the verdict once checked. When one key signed
every role, say so: "one company ordered, did, checked and accepted this work".

Agents are shown by a two-letter monogram in mist (CC for Claude Code, Cx for Codex),
never by a vendor's logo.

## Motion

None but the check: when a receipt verifies, its Ticked mark draws once. Under
prefers-reduced-motion nothing moves.
