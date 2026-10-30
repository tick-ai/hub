// The checker this page uses: verifyDocument(text) answers { kind, valid, reasons,
// limits } for one Tick document, by the rules of spec/SPEC.md, in this browser, with
// Web Crypto and no network. Its implementation is a task of its own (written from
// the specification alone, held to every vector in vectors/); until it lands, it
// says so and verifies nothing, so nothing on the page turns green.

export async function verifyDocument() {
  return {
    kind: 'unknown',
    valid: false,
    reasons: ['this page cannot check documents yet'],
    limits: [],
  };
}
