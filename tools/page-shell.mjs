// The shell of a page that is one self-contained HTML file: a person receives it by
// any channel, opens it from disk, and it makes no network request of any kind.
// The look follows docs/design.md. The one departure is the type: a single file
// carries no font files, so it uses a system font stack. Every other rule holds.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** A file a page is refused for, with every reason (a verifier's own words where it gave them). */
export class Refusal extends Error {
  constructor(reasons) {
    super(reasons.join('\n'));
    this.reasons = reasons;
  }
}

/** Text as markup: whatever a document holds reaches a page as text, never as markup. */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (char) => ESCAPES[char]);
}

/** The policy of every page: nothing loads, nothing is sent, only the page's own style and script run. */
export const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

/**
 * A value as JSON that can sit in a page: every `</` is written `<\/` (still the same JSON,
 * and in a script's string the same text), so nothing a value holds can close a block.
 * `<!--` and `<script` are written with a unicode escape for the same reason.
 */
export function jsonForPage(value) {
  return JSON.stringify(value)
    .replace(/<\//gu, '<\\/')
    .replace(/<(?=!--|script)/giu, '\\u003c');
}

/**
 * A source file as text for a page's script: the `export ` at the start of lines is
 * stripped, so its functions are the page's own. It refuses a source that holds `</`
 * (which could close the script) and one that imports (the page has no other file).
 */
export function inlineSource(source, name = 'a source') {
  if (source.includes('</')) throw new Error(`${name} holds "</" and cannot be put in a page`);
  if (/^import\s/mu.test(source)) throw new Error(`${name} imports another file and cannot be put in a page`);
  return source.replace(/^export /gmu, '');
}

const STYLE = `
:root {
  --paper: #ffffff; --mist: #f3f6f4; --ink: #0c1811; --ink-soft: #4b5a51; --rule: #dde5e0;
  --tick: #12a157; --tick-text: #06713f; --tick-wash: #e3f4ea; --halt: #b42d22; --halt-wash: #fbe9e7;
  --sans: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --serif: Georgia, 'Times New Roman', serif;
  --mono: ui-monospace, 'SF Mono', Consolas, Menlo, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #0d1411; --mist: #16201b; --ink: #e9f4ee; --ink-soft: #a8b8af; --rule: #26332c;
    --tick: #35d07f; --tick-text: #6fe0a4; --tick-wash: #12291d; --halt: #f08a7e; --halt-wash: #2d1714;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.55 var(--sans); }
main { max-width: 560px; margin: 0 auto; padding: 16px max(16px, env(safe-area-inset-left)) 48px; display: grid; gap: 16px; }
h1 { margin: 8px 0 0; font-size: 28px; line-height: 1.15; letter-spacing: -0.02em; }
h2, h3 { margin: 0; font-size: 16px; }
p { margin: 0; }
.brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; letter-spacing: -0.02em; font-size: 18px; }
.beat { fill: none; stroke: var(--ink); stroke-width: 3.2; stroke-linecap: round; stroke-linejoin: round; }
.card { border: 1px solid var(--rule); border-radius: 12px; padding: 18px; display: grid; gap: 12px; min-width: 0; }
.rows { display: grid; gap: 10px; margin: 0; }
.rows dt { font-size: 12px; color: var(--ink-soft); }
.rows dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.mono, .src { font-family: var(--mono); font-size: 12.5px; color: var(--ink-soft); overflow-wrap: anywhere; }
.figure { font-family: var(--serif); font-size: 22px; font-variant-numeric: tabular-nums; }
.missing { color: var(--ink-soft); font-style: italic; }
.soft { color: var(--ink-soft); font-size: 13.5px; }
.list { margin: 0; padding-left: 18px; }
.tag { display: inline-block; margin: 0; padding: 3px 9px; border-radius: 6px; background: var(--mist); color: var(--ink-soft); font-size: 12.5px; font-weight: 600; justify-self: start; }
.tag.halt { background: var(--halt-wash); color: var(--halt); }
.tag.ticked { background: var(--tick-wash); color: var(--tick-text); animation: ticked 240ms ease-out 1; }
@keyframes ticked { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
.buttons { display: flex; flex-wrap: wrap; gap: 8px; }
button { font: 600 13.5px var(--sans); padding: 9px 14px; border-radius: 8px; border: 1px solid var(--ink); background: var(--paper); color: var(--ink); cursor: pointer; }
button.primary { background: var(--ink); color: var(--paper); }
button:disabled { opacity: 0.55; cursor: default; }
button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.well { background: var(--mist); border-radius: 8px; padding: 10px; }
textarea { width: 100%; min-height: 140px; font: 12.5px var(--mono); background: var(--mist); color: var(--ink); border: 1px solid var(--rule); border-radius: 8px; padding: 10px; }
.out { display: grid; gap: 8px; font-size: 13.5px; color: var(--ink-soft); }
.out h3 { color: var(--ink); font-size: 13.5px; margin-top: 8px; }
.out ul { margin: 4px 0; padding-left: 18px; }
.whole { white-space: pre-wrap; margin: 6px 0 0; padding: 10px; background: var(--mist); border-radius: 8px; font: 12.5px var(--mono); }
[hidden] { display: none !important; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

/**
 * A whole HTML document. `body` is markup the caller has already escaped. `script` is
 * one classic script's text. `data`, where given, is a JSON value put in a block of
 * type application/json with id "data". The page makes no request and loads nothing.
 */
export function pageShell({ title, body, script, data }) {
  if (typeof title !== 'string' || typeof body !== 'string') throw new Error('a page needs a title and a body');
  if (script !== undefined && script.includes('</')) throw new Error('the script holds "</" and cannot be put in a page');
  const dataBlock = data === undefined ? '' : `<script type="application/json" id="data">${jsonForPage(data)}</script>\n`;
  const scriptBlock = script === undefined ? '' : `<script>\n${script}\n</script>\n`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<span class="brand"><svg viewBox="0 0 40 24" width="34" height="20" aria-hidden="true"><polyline points="2,14 12,14 16,8 21,19 25,14 38,14" class="beat"></polyline></svg>tick</span>
${body}
</main>
${dataBlock}${scriptBlock}</body>
</html>
`;
}
