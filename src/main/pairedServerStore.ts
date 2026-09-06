// The paired-server records: serialize, persist, retrieve. Pairing yields a
// {server, relay, token, server_static_pubkey} tuple (the QR/paste payload); persisting it lets the
// client reconnect and drive the Noise_IK handshake on every launch without re-pairing (#44). On
// connect the transport reads `server_static_pubkey` as the responder static key and `token` for
// the relay/hello auth — but this module neither validates nor uses either cryptographically; it
// only stores what it is given and returns it verbatim.
//
// Since #1069 it holds a COLLECTION of those tuples, keyed by `server` id, so pairing a second
// machine stops silently discarding the first. It is still ONE blob under ONE name: SecureStore is
// name→bytes with no list operation, and — more importantly — the name must stay a constant, because
// the `server` id is untrusted QR/paste input and SecretPersistence maps a name onto a storage key.
// "Active" is simply the most recently saved entry, which is what the no-argument `load` returns;
// there is no active pointer, because reproducing the previous single-record behaviour exactly is
// what lets every existing consumer stay untouched.
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
 * The paired-server accessor. `save` persists the record, adding it to the collection or replacing
 * the entry that already holds its `server` id (#1069 — before that it overwrote the one slot); a
 * stored collection that is present but unreadable is overwritten rather than rejected, so
 * re-pairing stays the recovery from a corrupt blob (a decrypt failure still rejects). `load`
 * retrieves the most recently saved entry with the absent-vs-undecryptable-vs-malformed semantics
 * below. Both are main-process only. No in-memory cache: `load` reads through each call, so a
 * re-pair is observed immediately.
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
  /** Erase EVERY persisted paired-server record. Idempotent; fail-closed. */
  clear(): Promise<void>
}

/**
 * The collection accessors (#1069), layered above `ClearablePairedServerStore` for exactly the reason
 * `clear` was layered above the base in #172: no interface an existing fake is typed against gains a
 * required member, so the ~nine structural fakes across daemon-connection, pairing-confirmation,
 * pairing-status, server-info and unpair keep compiling untouched. `createPairedServerStore` widens
 * its return type to this — a subtype relation, so the composition root and all five call sites need
 * no edit. The by-id erase is a distinct method rather than an optional parameter on `clear`: an
 * optional parameter would still type-check against every zero-argument fake and then be silently
 * ignored by each of them, which is the worse failure.
 */
export interface MultiPairedServerStore extends ClearablePairedServerStore {
  /** The entry held under `serverId`, or null when no entry has that id. */
  loadById(serverId: string): Promise<PairedServerRecord | null>
  /** Every paired entry, oldest-saved first; empty when nothing is paired. */
  list(): Promise<PairedServerRecord[]>
  /** Erase exactly the entry under `serverId`, leaving every other entry paired. Idempotent. */
  clearServer(serverId: string): Promise<ClearServerOutcome>
}

/**
 * What one `clearServer` call did (#1149). Two derived facts and nothing else: NO record, no id, no
 * field value — so a caller holding this outcome holds no credential, and it is safe for a handler
 * that must not be able to materialise one.
 *
 * It exists so the by-id erase can answer, in the SAME call, the two questions its only consumer
 * (unpairHandler's per-server arm) would otherwise have to ask with reads:
 *   - `matched` — "did an entry actually hold this id?", which the erase alone cannot report: an
 *     unheld id resolves silently, indistinguishably from a successful one.
 *   - `remaining` — "is anything still paired?", which decides whether the single-slot host label
 *     still describes something.
 * Answering both from inside the mutate queue, off the same read the filter used, is what removes
 * the check-then-act gap a separate `loadById`/`list` pair would have opened — and what lets that
 * handler be typed against `clearServer` alone, with no read member and no whole-collection erase
 * anywhere in its dep type.
 */
export interface ClearServerOutcome {
  /** True when an entry held the id and was erased. False ⇒ nothing matched and nothing was written. */
  matched: boolean
  /** How many entries are still paired after this call. Counts only — never the entries themselves. */
  remaining: number
}

/**
 * Thrown by every READ when a blob is PRESENT and decrypts, but is not a valid collection — not
 * JSON, neither accepted shape, a missing / non-string field, or a repeated `server` id. The message
 * is static and carries NO field value (no token, no URL, no bytes). It lets the consumer branch to
 * a "re-pair" recovery rather than treat a corrupt record as never-paired (ADR 0005: a tampered
 * record is never silently mistaken for never-paired).
 *
 * That recovery is real because `save` OVERWRITES an unreadable collection instead of rejecting on
 * it (see `readForSave`): re-pairing is the exit from a corrupt blob, and the only one the app
 * offers, since the not-paired routes reach nothing but the pairing screen. A decrypt failure is
 * deliberately not folded in — it is a different error, it may be transient keychain state, and
 * discarding every real pairing on it would be worse than failing.
 */
export class MalformedPairedServerRecordError extends Error {
  constructor(message = 'stored paired-server record is malformed') {
    super(message)
    this.name = 'MalformedPairedServerRecordError'
  }
}

/**
 * The ONE store name every paired server is held under — and it stays one name on purpose (#1069).
 * `SecretPersistence` maps a name onto a storage key (a filesystem path in the real adapter), and the
 * `server` id is untrusted QR/paste input, so deriving the name from it (`${PAIRED_SERVER_NAME}.${id}`)
 * would put attacker-chosen text on the persistence path. The collection lives inside one blob under
 * this constant instead, which keeps "no untrusted input reaches the persistence path" structurally
 * true. It must also never change: an installed app's blob is keyed by this string, and a rename
 * would strand it and read as never-paired. `name` stays injectable as a test seam only.
 *
 * (An earlier version of this comment claimed mobile keys per server-id and that appending the id was
 * a deferred one-line change. Both are wrong: mobile's `PairedServerStore.kt` holds a single record,
 * and appending the id is the path rejected above.)
 */
export const PAIRED_SERVER_NAME = 'pyrycode.paired_server'

/** The four record fields, in a fixed order. */
const FIELDS = ['server', 'relay', 'token', 'server_static_pubkey'] as const

/** Exactly the four fields, so a caller's — or a stored blob's — stray fields are never re-persisted. */
function pickFields(record: PairedServerRecord): PairedServerRecord {
  return {
    server: record.server,
    relay: record.relay,
    token: record.token,
    server_static_pubkey: record.server_static_pubkey
  }
}

/**
 * Serialize the collection to UTF-8 JSON: an array of the four-field records, oldest-saved first.
 * Every entry goes through `pickFields`, so a stray key can never survive a rewrite — including one
 * that arrived in a legacy blob and is only being carried forward.
 */
function encodeCollection(records: readonly PairedServerRecord[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(records.map(pickFields)))
}

/**
 * Validate one parsed value as a record. Throws MalformedPairedServerRecordError on a non-object, an
 * array, or any of the four fields missing / non-string. STRUCTURAL validation only ("is this the
 * record shape we wrote"), not semantic (relay-URL / token validity is #9's job). Builds the result
 * field-by-field from the narrowed values, so it needs no cast and drops any extra keys.
 */
function parseRecord(value: unknown): PairedServerRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MalformedPairedServerRecordError()
  }
  const candidate = value as Record<string, unknown>
  const picked: Record<string, string> = {}
  for (const field of FIELDS) {
    const found = candidate[field]
    if (typeof found !== 'string') {
      throw new MalformedPairedServerRecordError()
    }
    picked[field] = found
  }
  return {
    server: picked.server,
    relay: picked.relay,
    token: picked.token,
    server_static_pubkey: picked.server_static_pubkey
  }
}

/**
 * Parse a stored blob into the collection, accepting BOTH at-rest shapes (#1069):
 *   - an array  → the collection form every write produces, in saved order;
 *   - an object → a blob the single-record version wrote, read back as a one-entry collection.
 * Anything else — bad JSON, a string, a number, JSON `null` — throws, never returning null and never
 * a silently empty collection. `Array.isArray` is tested FIRST because an array is also an object and
 * would otherwise be rejected by the four-field check.
 *
 * Migration is read-time ONLY: nothing here writes. A lazy rewrite-on-read would put a
 * `secureStore.set` on `load`'s path, where an unavailable keychain would throw inside call sites
 * that have never had to handle one; the next `save` persists the array form instead.
 *
 * A repeated `server` id is malformed. The collection is keyed by that id, so two entries claiming
 * one id have no defined meaning — and quietly keeping one would let a smuggled duplicate make
 * `loadById` return one token while `list` shows another. The message stays static: no offending id,
 * no array index (which would leak how many servers are paired), no bytes.
 */
function decodeCollection(blob: Uint8Array): PairedServerRecord[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(blob))
  } catch {
    throw new MalformedPairedServerRecordError()
  }
  const entries = Array.isArray(parsed)
    ? parsed.map((entry) => parseRecord(entry))
    : [parseRecord(parsed)]
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.server)) {
      throw new MalformedPairedServerRecordError()
    }
    seen.add(entry.server)
  }
  return entries
}

/**
 * Build a MultiPairedServerStore over the injected persistence seam. Writes go through
 * SecureStore.set (fail-closed: keychain-unavailable throws EncryptionUnavailableError before any
 * write). Reads go through SecureStore.get: absent → empty (the ONLY not-paired path), a decrypt
 * failure propagates, and a decrypted-but-malformed blob throws — never coerced to null — from every
 * read. `save` is the one exception (see `readForSave`): it overwrites a malformed collection, since
 * re-pairing is the app's only recovery from one. No cache, no timers, no listeners: nothing to
 * cancel on teardown.
 */
export function createPairedServerStore(deps: {
  secureStore: SecureStore
  name?: string
}): MultiPairedServerStore {
  const { secureStore } = deps
  const name = deps.name ?? PAIRED_SERVER_NAME

  /** The persisted collection. Absent name = nothing paired — the only empty-without-throwing path. */
  const read = async (): Promise<PairedServerRecord[]> => {
    const blob = await secureStore.get(name)
    return blob === null ? [] : decodeCollection(blob)
  }

  // The collection as `save` alone sees it: a blob that decrypts and still cannot be read counts as
  // empty, so the save overwrites it. Before the collection layout (#1069) `save` was a blind write
  // and could not fail on a stored blob; giving it a read handed it the ability to reject on the one
  // state whose only sanctioned exit IS saving. A malformed blob routes the app to welcome, welcome
  // offers nothing but the Pair CTA, and the one consumer that erases the blob (unpairHandler →
  // clear) sits behind Settings on the paired route — so a strict save loops the user
  // welcome → pair → persist-failed with no in-app way out, recoverable only by deleting the file by
  // hand. Overwriting restores exactly the pre-#1069 recovery, and nothing is lost that was readable.
  //
  // A DECRYPT failure is not swallowed here: it propagates, so transient keychain state (rotation, a
  // locked keychain) fails loudly instead of silently discarding every real pairing the blob holds.
  const readForSave = async (): Promise<PairedServerRecord[]> => {
    try {
      return await read()
    } catch (error) {
      if (error instanceof MalformedPairedServerRecordError) return []
      throw error
    }
  }

  // The mutators are read-modify-write, where `save` used to be a blind write — so two of them
  // interleaving across an await would drop a server's entry, which is this module's own defect
  // (#1069) reintroduced from the other direction. They run one at a time through this chain. The
  // chain continues across a rejected operation (`then(op, op)`) so one failed save cannot wedge the
  // store, and its own copy of the outcome is swallowed so a rejection is never unhandled — the
  // caller still receives `run`. Reads stay OFF the chain: each is a single get with nothing to
  // interleave, and queueing them would change the five existing call sites' latency for no gain.
  // In-process only; there is one Electron main process, and mid-write atomicity is inherited from
  // fileSecretPersistence's temp-then-rename.
  let queue: Promise<unknown> = Promise.resolve()
  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = queue.then(operation, operation)
    queue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  return {
    async save(record) {
      await mutate(async () => {
        // Add or replace BY KEY: an entry already holding this `server` id is dropped and the new
        // one appended, so the saved record is always the most recent — which is what load() reports.
        const entries = await readForSave()
        const next = entries.filter((entry) => entry.server !== record.server)
        next.push(record)
        await secureStore.set(name, encodeCollection(next))
      })
    },
    async load() {
      // The most recently saved entry: entry order IS the persisted order, so this survives a
      // relaunch without an explicit active pointer. Empty = not paired, the only null path.
      const entries = await read()
      const newest = entries[entries.length - 1]
      return newest ?? null
    },
    async loadById(serverId) {
      // Matched with === against the decoded entry's own field. `serverId` never becomes a store
      // name, a path, or an object key, so an id like `__proto__` is inert here.
      const entries = await read()
      return entries.find((entry) => entry.server === serverId) ?? null
    },
    async list() {
      return read()
    },
    async clear() {
      // Erase exactly what save wrote and load reads: keyed by this store's own `name`, never a
      // delete-by-literal, and the WHOLE collection — so unpairHandler cannot report ok while
      // another server's bearer token is still on disk. SecureStore.delete is idempotent (absent
      // name → no-op), so a never-paired store clears cleanly. No try/catch: a delete failure
      // propagates (fail-closed — reporting success while a live bearer token still sits on disk is
      // the one behaviour to avoid). Because `name` is a fixed constant, this can never touch the
      // device static keypair.
      await mutate(() => secureStore.delete(name))
    },
    async clearServer(serverId) {
      // The outcome is computed INSIDE the queue, from the same `entries` the filter used, so
      // "did anything match" and "what remains" cannot disagree with the erase that just happened
      // and no concurrent save can land between them (#1149). `serverId` is matched with === against
      // each decoded entry's own `server` field — it never becomes this store's `name`, a
      // persistence path, or an object key, so an untrusted id like `__proto__` is inert.
      return mutate(async () => {
        const entries = await read()
        const next = entries.filter((entry) => entry.server !== serverId)
        // No entry matched: resolve without writing. Idempotent, no needless keychain round-trip,
        // and no EncryptionUnavailableError raised by an erase that had nothing to erase. The
        // caller learns this from `matched`, not from a follow-up read.
        if (next.length === entries.length) return { matched: false, remaining: entries.length }
        // The last entry left: delete the blob rather than writing `[]`, so "no blob" stays the one
        // at-rest form of not-paired and this ends exactly where clear() does.
        if (next.length === 0) {
          await secureStore.delete(name)
          return { matched: true, remaining: 0 }
        }
        // One write, never delete-then-write: a failure here leaves the prior blob whole and throws,
        // so the caller is never told a token left disk when it did not — and never receives an
        // outcome claiming a match that a failed write did not make.
        await secureStore.set(name, encodeCollection(next))
        return { matched: true, remaining: next.length }
      })
    }
  }
}
