// The paired-server record: serialize, persist, retrieve. Pairing yields a
// {server, relay, token, server_static_pubkey} tuple (the QR/paste payload); persisting it lets the
// client reconnect and drive the Noise_IK handshake on every launch without re-pairing (#44). On
// connect the transport reads `server_static_pubkey` as the responder static key and `token` for
// the relay/hello auth — but this module neither validates nor uses either cryptographically; it
// only stores what it is given and returns it verbatim.
//
// This is the PURE CORE: it imports no effectful dependency (no `electron`, no `fs`) — only the
// TYPE of SecureStore and the TYPE of QrPayload. The one effectful edge is injected:
//   - persistence: SecureStore (#42, src/main/secureStore.ts) — encrypt-at-rest via safeStorage,
//     fail-closed. The record is serialized to bytes and stored by name THROUGH this surface; this
//     module never touches safeStorage or the filesystem directly (ADR 0005).
// Serialization (JSON + TextEncoder/TextDecoder) is pure, so — unlike #43's keygen seam — there is
// no second effectful edge and no second production file. The isolation makes "the AC tests run
// with no keychain and no filesystem" structural.
//
// It lives entirely in src/main — the `token` (a bearer credential) and `server_static_pubkey`
// never reach the renderer, preload, or IPC (CLAUDE.md "Keep the transport out of the window";
// ADR 0002). It is LOG-FREE by construction: no console.* anywhere; the record is an opaque local,
// never a named field of a logged struct.
import type { QrPayload } from '../shared/wire/types'
import type { SecureStore } from './secureStore'

/**
 * The persisted paired-server record: the four QR-payload fields, verbatim. Aliasing QrPayload
 * (rather than re-declaring the shape) makes drift from the wire contract structurally impossible —
 * any QrPayload change flows straight through (CLAUDE.md "don't drift the wire types"). This record
 * is MAIN-PROCESS ONLY: `token` is a bearer credential and `server_static_pubkey` a static key;
 * neither ever crosses to the renderer, the preload bridge, or IPC.
 */
export type PairedServerRecord = QrPayload

/**
 * The paired-server accessor. `save` persists the record (a second save overwrites — re-pair);
 * `load` retrieves it with the absent-vs-undecryptable-vs-malformed semantics below. Both are
 * main-process only. No in-memory cache: `load` reads through each call, so a re-pair is observed
 * immediately.
 */
export interface PairedServerStore {
  save(record: PairedServerRecord): Promise<void>
  load(): Promise<PairedServerRecord | null>
}

/**
 * The paired-server accessor plus the symmetric erase. `clear` removes the persisted record so a
 * later `load` reports not-paired, returning the app to a clean state (#172). It is the concrete
 * return type of `createPairedServerStore`, deliberately NOT folded into the base
 * `PairedServerStore`: existing consumers (pairing-status, pairing-confirmation, daemon-connection)
 * type against the base and their fakes need no `clear` stub — only code holding the concrete store
 * (the composition root, and its follow-up IPC surface #173) can reach the erase.
 */
export interface ClearablePairedServerStore extends PairedServerStore {
  /** Erase the persisted paired-server record. Idempotent; fail-closed. */
  clear(): Promise<void>
}

/**
 * Thrown by `load` when a blob is PRESENT and decrypts, but is not a valid record — not JSON, not
 * an object, or a missing / non-string field. The message is static and carries NO field value (no
 * token, no URL, no bytes). It lets the consumer branch to a "re-pair" recovery rather than treat a
 * corrupt record as never-paired (ADR 0005: a tampered record is never silently mistaken for
 * never-paired).
 */
export class MalformedPairedServerRecordError extends Error {
  constructor(message = 'stored paired-server record is malformed') {
    super(message)
    this.name = 'MalformedPairedServerRecordError'
  }
}

/**
 * Milestone-1 single-pyrybox store name. Mobile keys per server-id; appending `.${serverId}` is the
 * deferred one-line multi-server change (out of scope here), enabled by keeping this constant
 * explicit and the `name` injectable. Today the name is a fixed constant — no untrusted QR/paste
 * input reaches the persistence path.
 */
export const PAIRED_SERVER_NAME = 'pyrycode.paired_server'

/** The four record fields, in a fixed order. */
const FIELDS = ['server', 'relay', 'token', 'server_static_pubkey'] as const

/**
 * Serialize the record to UTF-8 JSON of exactly the four fields. Picking the fields explicitly means
 * a caller's stray fields are never written.
 */
function encodeRecord(record: PairedServerRecord): Uint8Array {
  const picked: PairedServerRecord = {
    server: record.server,
    relay: record.relay,
    token: record.token,
    server_static_pubkey: record.server_static_pubkey
  }
  return new TextEncoder().encode(JSON.stringify(picked))
}

/**
 * Parse a stored blob back into a record. Throws MalformedPairedServerRecordError on bad JSON, a
 * non-object, or any of the four fields missing / non-string. This is STRUCTURAL validation only
 * ("is this the record shape we wrote"), not semantic (relay-URL / token validity is #9's job). The
 * re-picked result drops any extra keys the blob may carry.
 */
function decodeRecord(blob: Uint8Array): PairedServerRecord {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(blob))
  } catch {
    throw new MalformedPairedServerRecordError()
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new MalformedPairedServerRecordError()
  }
  const candidate = parsed as Record<string, unknown>
  for (const field of FIELDS) {
    if (typeof candidate[field] !== 'string') {
      throw new MalformedPairedServerRecordError()
    }
  }
  return {
    server: candidate.server as string,
    relay: candidate.relay as string,
    token: candidate.token as string,
    server_static_pubkey: candidate.server_static_pubkey as string
  }
}

/**
 * Build a PairedServerStore over the injected persistence seam. `save` writes through
 * SecureStore.set (fail-closed: keychain-unavailable throws EncryptionUnavailableError before any
 * write). `load` reads through SecureStore.get: absent → null (the ONLY null path), a decrypt
 * failure propagates, and a decrypted-but-malformed blob throws — never coerced to null. No cache,
 * no timers, no listeners: nothing to cancel on teardown.
 */
export function createPairedServerStore(deps: {
  secureStore: SecureStore
  name?: string
}): ClearablePairedServerStore {
  const { secureStore } = deps
  const name = deps.name ?? PAIRED_SERVER_NAME

  return {
    async save(record) {
      await secureStore.set(name, encodeRecord(record))
    },
    async load() {
      const blob = await secureStore.get(name)
      // Absent = not paired — the only null path. A present blob is decoded (a decrypt failure
      // inside get() has already propagated); a malformed decode throws, never returns null.
      return blob === null ? null : decodeRecord(blob)
    },
    async clear() {
      // Erase exactly what save wrote and load reads: keyed by this store's own `name`, never a
      // delete-by-literal. SecureStore.delete is idempotent (absent name → no-op), so a
      // never-paired store clears cleanly. No try/catch: a delete failure propagates (fail-closed —
      // reporting success while a live bearer token still sits on disk is the one behaviour to
      // avoid). Because `name` is a fixed constant, this can never touch the device static keypair.
      await secureStore.delete(name)
    }
  }
}
