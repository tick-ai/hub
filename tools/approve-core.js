// What approving an order needs, in a browser and in Node: make a key, keep it in a
// file, read it back, and sign a work order (tick.work-order.v1). It uses crypto.subtle
// and two functions of verify.js, nothing else. The page inlines this file.
import { canonicalSerialize, documentHash } from '../verify.js';

const enc = new TextEncoder();

const KEY_FILE = 'tick-buyer-key/1';

/** The first two lines a work order says it does not establish, and the third this page adds. */
const WORK_ORDER_LIMITS = [
  'A work order says what was asked, not that anything was done. The signature proves the holder of the carried key issued it, and content_hash that it was not edited since.',
  'The carried key is the buyer’s only if the verifier already holds that key_id from somewhere else. A work order cannot vouch for its own key.',
  'payment none means no money is held for this order: the parties pay as their job agreement says.',
];

const toBase64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));

function decodeBase64(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/u.test(text)) return null;
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

const toHex = (buffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** Whether this browser (or Node) can make and check Ed25519 signatures. */
export async function canSign() {
  try {
    const keys = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
    const message = enc.encode('tick');
    const signature = await globalThis.crypto.subtle.sign('Ed25519', keys.privateKey, message);
    return await globalThis.crypto.subtle.verify('Ed25519', keys.publicKey, signature, message);
  } catch {
    return false;
  }
}

/** A new Ed25519 key pair whose keys can be saved to a file. */
export async function makeKeys() {
  return globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
}

/** The text of a key file: JSON { schema: 'tick-buyer-key/1', pkcs8, spki }, both in base64. */
export async function keyFileOf(keys) {
  const pkcs8 = toBase64(await globalThis.crypto.subtle.exportKey('pkcs8', keys.privateKey));
  const spki = toBase64(await globalThis.crypto.subtle.exportKey('spki', keys.publicKey));
  return JSON.stringify({ schema: KEY_FILE, pkcs8, spki });
}

/** The keys a key file holds. Refuses anything else, in plain words. */
export async function keysFromFile(text) {
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error('This is not a key file: it is not JSON.');
  }
  if (file === null || typeof file !== 'object' || Array.isArray(file) || file.schema !== KEY_FILE) {
    throw new Error(`This is not a key file: its schema is not ${KEY_FILE}.`);
  }
  const pkcs8 = decodeBase64(file.pkcs8);
  const spki = decodeBase64(file.spki);
  if (pkcs8 === null || spki === null) throw new Error('This key file is damaged: its keys are not base64.');
  let keys;
  try {
    keys = {
      privateKey: await globalThis.crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign']),
      publicKey: await globalThis.crypto.subtle.importKey('spki', spki, { name: 'Ed25519' }, true, ['verify']),
    };
  } catch {
    throw new Error('This key file is damaged: its keys are not Ed25519 keys.');
  }
  const probe = enc.encode('tick-key-file');
  const signature = await globalThis.crypto.subtle.sign('Ed25519', keys.privateKey, probe);
  if (!(await globalThis.crypto.subtle.verify('Ed25519', keys.publicKey, signature, probe))) {
    throw new Error('This key file is damaged: its two keys are not a pair.');
  }
  return keys;
}

/** The key_id of a key pair: the first 16 hexadecimal characters of the SHA-256 of the SPKI bytes. */
export async function keyIdOfKeys(keys) {
  const spki = await globalThis.crypto.subtle.exportKey('spki', keys.publicKey);
  return toHex(await globalThis.crypto.subtle.digest('SHA-256', spki)).slice(0, 16);
}

/**
 * The whole tick.work-order.v1 for `body`, signed by `keys`. `body` is the order's signed
 * body (what, repository, base, territory, checks, budget, deadline, acceptor, payment,
 * from_task). The signature is over the UTF-8 bytes of
 * `tick-work-order:v1:<order_id>:<content_hash>`, with no pre-hashing.
 */
export async function signOrder(body, { orderId, issuedAt }, keys) {
  canonicalSerialize(body);
  const spki = await globalThis.crypto.subtle.exportKey('spki', keys.publicKey);
  const keyId = toHex(await globalThis.crypto.subtle.digest('SHA-256', spki)).slice(0, 16);
  const contentHash = await documentHash(body);
  // A body without checks has no checks_hash: the document it makes is then not valid, and says why.
  const checksHash = await documentHash(body.checks).catch(() => null);
  const message = enc.encode(`tick-work-order:v1:${orderId}:${contentHash}`);
  const signature = await globalThis.crypto.subtle.sign('Ed25519', keys.privateKey, message);
  return {
    schema: 'tick.work-order.v1',
    alg: 'ed25519',
    issued_at: issuedAt,
    coordinator: `buyer:${keyId}`,
    order_id: orderId,
    order: body,
    checks_hash: checksHash,
    content_hash: contentHash,
    key: toBase64(spki),
    key_id: keyId,
    signature: toBase64(signature),
    limits: [...WORK_ORDER_LIMITS],
  };
}

/** The name an approved order is saved under: the first 8 characters of its order id. */
export function approvedFileName(orderId) {
  return `approved-order-${String(orderId).slice(0, 8)}.json`;
}
