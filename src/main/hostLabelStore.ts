// The host label: the human name the operator types at pairing time ("Pyrybox"), persisted so the
// sidebar host row still says it after a restart (#822). Pairing yields
// {server, relay, token, server_static_pubkey} — the wire carries NO host name, and the server id is
// opaque, so the label has no home on the wire and must not get one: PairedServerRecord is a type
// ALIAS of QrPayload, and adding a field the daemon never sees would drift a wire type
// (CLAUDE.md "don't drift the wire types"). Hence its own module and its own stored name.
//
// This is the PURE CORE: it imports no effectful dependency (no `electron`, no `fs`, no
// `safeStorage`) — only the TYPE of SecureStore. The one effectful edge is injected:
//   - persistence: SecureStore (src/main/secureStore.ts) — encrypt-at-rest via safeStorage,
//     fail-closed. The label is encoded to bytes and stored by name THROUGH this surface; this
//     module never touches safeStorage or the filesystem directly (ADR 0005).
// Encoding (TextEncoder/TextDecoder) is pure, so — like pairedServerStore — there is no second
// effectful edge and no second production file. The isolation makes "the tests run with no keychain
// and no filesystem" structural.
//
// WHY safeStorage for display text. The label is NOT a credential and needs no confidentiality; it
// rides the same seam for three reasons that are not about secrecy. (1) Integrity: safeStorage is
// AEAD, so a tampered blob fails DECRYPTION and surfaces as a throw, rather than as a
// plausible-looking string. (2) One audited at-rest surface, rather than a second persistence path.
// (3) Fail-closed on write and log-free on every path come for free by staying on the seam. The one
// cost — with no keychain `save` rejects even though the label is not secret — is correct and
// non-blocking: on such a machine pairing itself already fails, so there is no state where the
// record persists but the label cannot.
//
// UNTRUSTED VALUE — hand-off, do not lose it. What `load` returns comes off disk, is unbounded, and
// is deliberately unvalidated here (this store takes what it is given, exactly as pairedServerStore
// does). Consumers own the bounds: the IPC read path (#824) bounds the length at the trust boundary,
// the input field (#825) bounds it on the way in, and the sidebar row (#826) renders it as escaped
// text only — never into dangerouslySetInnerHTML, an attribute, a URL, a filename or a lookup key
// (CLAUDE.md, operator ruling 2026-08-20).
//
// It is LOG-FREE by construction: no console.* anywhere, on any path including every error path.
// The label is an opaque local, never a named field of a logged struct.
import type { SecureStore } from './secureStore'

/**
 * The host-label accessor. `save` persists the label (a second save overwrites); `load` retrieves it
 * with the absent-vs-stored-empty-vs-unreadable semantics below; `clear` erases it. All three are
 * main-process only. No in-memory cache: `load` reads through each call, so a write from another
 * code path is observed immediately.
 *
 * Deliberately NO read-modify-write helper: a `load`-then-`save` pair across an `await` would be a
 * check-then-act race this module currently cannot have.
 */
export interface HostLabelStore {
  /** Persist the label verbatim. A second save overwrites. No length bound, no validation. */
  save(label: string): Promise<void>
  /** The stored label, or null when none was ever stored. `''` is a stored value, not absence. */
  load(): Promise<string | null>
  /** Erase the stored label. Idempotent; fail-closed. */
  clear(): Promise<void>
}

/**
 * Thrown by `load` when a blob is PRESENT and decrypts, but its bytes are not valid UTF-8 (tamper /
 * format drift). The message is static and carries NO bytes and no partially-decoded prefix. It lets
 * a consumer branch to a "re-enter the label" recovery rather than treat corruption as never-stored.
 *
 * Unreachable through `save`: TextEncoder always emits valid UTF-8. Like MalformedDeviceKeypairError
 * it exists for tamper and format drift only.
 */
export class MalformedHostLabelError extends Error {
  constructor(message = 'stored host label is malformed') {
    super(message)
    this.name = 'MalformedHostLabelError'
  }
}

/**
 * Milestone-1 single-pyrybox store name. Distinct from `pyrycode.paired_server` and
 * `pyrycode.device_static`, so `clear` structurally cannot erase a credential. Per-server-id keying
 * (`pyrycode.host_label.<server-id>`) is the deferred one-line multi-host change (out of scope
 * here), enabled by keeping this constant explicit and the `name` injectable. Today the label is
 * only ever a VALUE, never a name — no caller-supplied string reaches the persistence key.
 */
export const HOST_LABEL_NAME = 'pyrycode.host_label'

/**
 * Encode the label as bare UTF-8 bytes — no JSON envelope. A single string carries no fields, so an
 * envelope would only widen the malformation surface (non-JSON, non-object, null, missing key,
 * non-string value) for nothing.
 *
 * Accepted round-trip caveat: a label containing an unpaired surrogate (e.g. '\uD800') encodes as
 * U+FFFD and so does not round-trip byte-identically. That is inherent to UTF-8, cannot be produced
 * by a text input, and this store takes what it is given — there is deliberately no surrogate check
 * and no rejection.
 */
function encodeLabel(label: string): Uint8Array {
  return new TextEncoder().encode(label)
}

/**
 * Decode a stored blob back into the label. This is the module's ONLY trust boundary: disk bytes →
 * in-memory string.
 *
 * Both decoder options are load-bearing and neither is the default:
 *   - `fatal: true` — the default decoder is LOSSY: it rewrites invalid byte sequences to U+FFFD and
 *     returns a plausible string, which would make "unreadable ⇒ failure" unreachable. With `fatal`
 *     an invalid sequence throws.
 *   - `ignoreBOM: true` — the default decoder STRIPS a leading U+FEFF, so a BOM-leading label would
 *     not round-trip.
 *
 * The decoder's own TypeError is caught and replaced rather than propagated: a caller gets one typed
 * branch to switch on, and the decoder's message stays an implementation detail.
 */
function decodeLabel(blob: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(blob)
  } catch {
    throw new MalformedHostLabelError()
  }
}

/**
 * Build a HostLabelStore over the injected persistence seam. `save` writes through SecureStore.set
 * (fail-closed: keychain-unavailable throws EncryptionUnavailableError before any write). `load`
 * reads through SecureStore.get: absent → null (the ONLY null path), a decrypt failure propagates,
 * and a present-but-invalid-UTF-8 blob throws — never coerced to null. No cache, no memo, no timers,
 * no listeners: nothing to cancel on teardown.
 */
export function createHostLabelStore(deps: {
  secureStore: SecureStore
  name?: string
}): HostLabelStore {
  const { secureStore } = deps
  const name = deps.name ?? HOST_LABEL_NAME

  return {
    async save(label) {
      await secureStore.set(name, encodeLabel(label))
    },
    async load() {
      const blob = await secureStore.get(name)
      // Absent = never stored — the only null path. A stored EMPTY label is a zero-length blob, not
      // absence, and stays distinguishable end-to-end because secureStore.get tests the CIPHERTEXT
      // for null before decrypting (secureStore.ts:94) and safeStorage's version header keeps an
      // empty plaintext's ciphertext non-empty. If that null test ever moves to the plaintext, the
      // never-stored / stored-empty distinction breaks silently here.
      return blob === null ? null : decodeLabel(blob)
    },
    async clear() {
      // Erase exactly what save wrote and load reads: keyed by this store's own `name`, never a
      // delete-by-literal. SecureStore.delete is idempotent (absent name → no-op), so a
      // never-stored store clears cleanly. No try/catch: a delete failure propagates (fail-closed —
      // reporting success while the value still sits on disk is the behaviour to avoid).
      await secureStore.delete(name)
    }
  }
}
