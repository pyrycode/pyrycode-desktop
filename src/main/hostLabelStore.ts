// The host label: the human name the operator types at pairing time ("Pyrybox"), persisted so the
// sidebar host row still says it after a restart (#822). Pairing yields
// {server, relay, token, server_static_pubkey} — the wire carries NO host name, and the server id is
// opaque, so the label has no home on the wire and must not get one: PairedServerRecord is a type
// ALIAS of QrPayload, and adding a field the daemon never sees would drift a wire type
// (CLAUDE.md "don't drift the wire types"). Hence its own module and its own stored name.
//
// Since #1155 it can hold a label PER SERVER, so pairing a second machine stops overwriting the
// first one's name. It is still ONE blob under ONE name, for the reason spelled out on
// HOST_LABEL_NAME. The keyed triple (saveFor/loadFor/clearFor on MultiHostLabelStore) ships ALONGSIDE
// the un-keyed one rather than replacing it — the Strangler Fig shape #1069 used on pairedServerStore
// — so every existing caller behaves exactly as before. The two write different at-rest shapes into
// the same blob and each treats the other's as "not mine": the keyed reader sees a bare label as
// legacy (no labels stored), and the un-keyed reader would see an envelope as label text. That is
// safe only while nothing calls both, which holds because this slice wires NO caller to the keyed
// members. THE SLICE THAT RE-KEYS THE CALLERS MUST MOVE ALL FOUR AT ONCE — pairingHandler's confirm
// arm, both unpairHandler arms, and hostLabelHandler — and delete the un-keyed three after; a partial
// migration is the one state that would put an envelope in front of the un-keyed reader.
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
 * The SINGLE-SLOT host-label accessor. `save` persists the label (a second save overwrites); `load`
 * retrieves it with the absent-vs-stored-empty-vs-unreadable semantics below; `clear` erases it. All
 * three are main-process only. No in-memory cache: `load` reads through each call, so a write from
 * another code path is observed immediately.
 *
 * Deliberately NO read-modify-write helper HERE: a `load`-then-`save` pair across an `await` would be
 * a check-then-act race these three cannot have, because each is a single unconditional operation.
 * That invariant does NOT extend to the keyed members on `MultiHostLabelStore` — keying is precisely
 * what gives them one, which is why they run through a serializing queue instead (#1155).
 *
 * These three gain no member, ever, while `hostLabelHandler.test.ts` annotates an object literal as
 * this whole interface: a new required member would stop that file compiling. Keyed capability is
 * layered below rather than added here, for the same reason `MultiPairedServerStore` was layered
 * above `ClearablePairedServerStore`.
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
 * The per-server accessors (#1155), layered above `HostLabelStore` for exactly the reason
 * `MultiPairedServerStore` was layered above `ClearablePairedServerStore`: no interface an existing
 * consumer or fake is typed against gains a required member, so the three `Pick`-narrowed callers
 * (`pairingHandler`'s `save`, `hostLabelHandler`'s `load`, both `unpairHandler` arms' `clear`) and
 * `hostLabelHandler.test.ts`'s whole-interface literal keep compiling untouched.
 * `createHostLabelStore` widens its return type to this — a subtype relation, so the composition root
 * needs no edit either.
 *
 * The triple mirrors the un-keyed `save` / `load` / `clear` one-for-one, which is the pairing the
 * Strangler Fig migration reads against: the keyed members ship here with no caller, the callers move
 * over in a sibling slice, and the un-keyed three are deleted after.
 *
 * `clearFor` returns void rather than the sibling's `{ matched, remaining }`. Those two questions are
 * already answered for this family by `pairedServerStore.clearServer`, which is what the per-server
 * unpair arm reads; a second outcome type here would have no reader, and an unread return type is
 * surface rather than information.
 */
export interface MultiHostLabelStore extends HostLabelStore {
  /** Persist `label` under `serverId`, replacing that server's label. Other servers are untouched. */
  saveFor(serverId: string, label: string): Promise<void>
  /** That server's label, or null when it has none. `''` is a stored value, not absence. */
  loadFor(serverId: string): Promise<string | null>
  /** Erase exactly that server's label, leaving every other one stored. Idempotent; fail-closed. */
  clearFor(serverId: string): Promise<void>
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
 * The ONE store name every host label is held under — and it stays one name on purpose (#1155).
 * Distinct from `pyrycode.paired_server` and `pyrycode.device_static`, so an erase structurally
 * cannot reach a credential. `SecretPersistence` maps a name onto a storage key (a filesystem path in
 * the real adapter) and the `server` id is untrusted QR/paste input, so deriving the name from it
 * would put attacker-chosen text on the persistence path. The per-server collection lives inside one
 * blob under this constant instead, which keeps "no untrusted input reaches the persistence path"
 * structurally true: an id is only ever a JSON value and a `===` comparand, never a name. It must
 * also never change — an installed app's blob is keyed by this string, and a rename would strand it
 * and read as never-stored. `name` stays injectable as a test seam only.
 *
 * (An earlier version of this comment called `pyrycode.host_label.<server-id>` "the deferred one-line
 * multi-host change". That is the path rejected above, and `pairedServerStore.ts`'s
 * `PAIRED_SERVER_NAME` had already retracted the identical claim about itself when #1069 solved this
 * same problem for the records.)
 */
export const HOST_LABEL_NAME = 'pyrycode.host_label'

/**
 * The at-rest format marker for the keyed collection, and the DISCRIMINATOR that lets a blob written
 * by the single-slot version be told from a corrupt one (#1155). See `decodeLabels` for why a
 * positive marker is needed and a shape test is not enough.
 */
export const HOST_LABEL_FORMAT_VERSION = 1

/** One server's label. The id is carried as a FIELD, never as an object key — see `decodeLabels`. */
interface HostLabelEntry {
  server: string
  label: string
}

/**
 * Encode the SINGLE-SLOT label as bare UTF-8 bytes — no JSON envelope. A single string carries no
 * fields, so an envelope would only widen the malformation surface (non-JSON, non-object, null,
 * missing key, non-string value) for nothing. That argument is scoped to this shape and does not
 * reach `encodeLabels`, whose collection does carry fields — and which pays exactly the widened
 * surface warned about here, in `decodeLabels`.
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
 * Serialize the keyed collection: UTF-8 JSON, a version-marked envelope around an ARRAY of entries in
 * saved order. Every entry is rebuilt from its two narrowed fields, so a stray key can never survive
 * a rewrite.
 *
 * The bare-UTF-8 argument above lapses for this shape — a collection does carry fields — but the
 * malformation surface it warned about becomes real, which is what `decodeLabels` is for.
 */
function encodeLabels(entries: readonly HostLabelEntry[]): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      v: HOST_LABEL_FORMAT_VERSION,
      labels: entries.map((entry) => ({ server: entry.server, label: entry.label }))
    })
  )
}

/**
 * Validate one parsed value as an entry. Throws on a non-object, an array, or either field missing /
 * non-string. STRUCTURAL validation only ("is this the shape we wrote") — the label itself stays
 * unvalidated and unbounded, exactly as `load`'s does. Built field-by-field from the narrowed values,
 * so it needs no cast and drops any extra key.
 */
function parseEntry(value: unknown): HostLabelEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MalformedHostLabelError()
  }
  const { server, label } = value as Record<string, unknown>
  if (typeof server !== 'string' || typeof label !== 'string') {
    throw new MalformedHostLabelError()
  }
  return { server, label }
}

/**
 * Parse a stored blob into the keyed collection. This is where AC3 ("unreadable raises") and AC5
 * ("a single-slot blob does not raise") meet on the same bytes, and the version marker is what
 * separates them.
 *
 * A blob the single-slot version wrote is a BARE operator-typed string, so it is structurally
 * indistinguishable from garbage — and `JSON.parse` rejects most old labels but NOT all of them
 * (`[]`, `{}`, `null`, `123` all parse), so "it failed to parse" is not the test. What makes a
 * negative test sound here is that nothing else can reach this decoder: invalid UTF-8 is unreachable
 * through either version's `save` (TextEncoder always emits valid UTF-8) and safeStorage is AEAD, so
 * a tampered blob fails DECRYPTION upstream. Anything that decodes as UTF-8 and is not our envelope
 * is therefore the old format.
 *
 * So the test is POSITIVE, in this order:
 *   1. invalid UTF-8            → MalformedHostLabelError, via the shared `decodeLabel` (unchanged).
 *   2. not JSON                 → legacy → no labels.
 *   3. not a non-null, non-array object → legacy → no labels (covers `[]`, `null`, `123`, a string).
 *   4. `v` is not ours          → legacy → no labels (covers `{}`, and a future version, which an
 *                                 older build likewise overwrites rather than rejecting).
 *   5. past the marker          → unambiguously OUR format, so a broken one is drift, not legacy, and
 *                                 raises rather than silently dropping a server's label.
 * Accepted false positive: an old label whose text is exactly a valid v1 envelope reads as a
 * collection. It is a bounded, human-typed host name, and the outcome is no worse than AC5's loss.
 *
 * Migration is read-time ONLY — nothing here writes. A lazy rewrite-on-read would put a
 * `secureStore.set` on `loadFor`'s path, where an unavailable keychain would throw inside a read.
 *
 * The id is a FIELD on each entry, never an object key, and the duplicate check uses a `Set`: both
 * are what make an id like `__proto__` or `constructor` inert here (an object accumulator would
 * inherit truthy values for either and reject a legitimate single entry as a duplicate). A repeated
 * id is malformed — two entries claiming one id have no defined meaning, and keeping one quietly
 * would let a smuggled duplicate decide which label a server shows. The message stays static: no
 * offending id, no index, no count (which would leak how many servers are paired).
 */
function decodeLabels(blob: Uint8Array): HostLabelEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeLabel(blob))
  } catch (error) {
    // decodeLabel's own throw is the invalid-UTF-8 branch and must NOT be swallowed as legacy.
    if (error instanceof MalformedHostLabelError) throw error
    return []
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return []
  const { v, labels } = parsed as Record<string, unknown>
  if (v !== HOST_LABEL_FORMAT_VERSION) return []
  if (!Array.isArray(labels)) throw new MalformedHostLabelError()
  const entries = labels.map((entry) => parseEntry(entry))
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.server)) throw new MalformedHostLabelError()
    seen.add(entry.server)
  }
  return entries
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
}): MultiHostLabelStore {
  const { secureStore } = deps
  const name = deps.name ?? HOST_LABEL_NAME

  /** The persisted collection. Absent name = no labels — the only empty-without-throwing path. */
  const readEntries = async (): Promise<HostLabelEntry[]> => {
    const blob = await secureStore.get(name)
    return blob === null ? [] : decodeLabels(blob)
  }

  // The collection as `saveFor` alone sees it: a blob that decrypts and still cannot be read counts
  // as empty, so the save overwrites it. Keying turned the save into a read-modify-write and thereby
  // handed it the ability to reject on a stored blob — and saving is the ONLY exit from a corrupt
  // one, since nothing else rewrites this blob and a label cannot be re-entered short of re-pairing.
  // Without this, one corrupt blob would make the label unsettable forever. Mirrors
  // pairedServerStore's `readForSave` and its reasoning.
  //
  // A DECRYPT failure is not swallowed: it propagates, so transient keychain state (rotation, a
  // locked keychain) fails loudly instead of discarding every real label the blob still holds.
  const readForSave = async (): Promise<HostLabelEntry[]> => {
    try {
      return await readEntries()
    } catch (error) {
      if (error instanceof MalformedHostLabelError) return []
      throw error
    }
  }

  // The keyed mutators are read-modify-write, so two of them interleaving across an await would drop
  // a server's label — this module's own single-slot defect from the other direction, and exactly the
  // race the un-keyed triple's "no read-modify-write helper" note refused to open. They run one at a
  // time through this chain, which continues across a rejected operation (`then(op, op)`) so one
  // failed save cannot wedge the store, and swallows its own copy of the outcome so a rejection is
  // never unhandled — the caller still receives `run`. Reads stay OFF the chain: each is a single get
  // with nothing to interleave. The un-keyed three stay off it too — they are unconditional single
  // operations and keeping them off preserves their behaviour byte for byte. In-process only; there
  // is one Electron main process, and mid-write atomicity is inherited from fileSecretPersistence's
  // temp-then-rename.
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
    async saveFor(serverId, label) {
      await mutate(async () => {
        // Add or replace BY KEY: an entry already holding this id is dropped and the new one
        // appended, so a server's id appears exactly once and no stale label can be read back.
        // `serverId` becomes a JSON string VALUE here and nothing else — never this store's `name`,
        // never a persistence path, never an object key.
        const entries = await readForSave()
        const next = entries.filter((entry) => entry.server !== serverId)
        next.push({ server: serverId, label })
        await secureStore.set(name, encodeLabels(next))
      })
    },
    async loadFor(serverId) {
      // Matched with === against the decoded entry's own field, so an id like `__proto__` is inert.
      // `?? null` and not `||`: a stored '' is a value, and must not collapse into absence.
      const entries = await readEntries()
      return entries.find((entry) => entry.server === serverId)?.label ?? null
    },
    async clearFor(serverId) {
      await mutate(async () => {
        // A strict read, unlike saveFor's: an erase surfaces corruption rather than hiding it, and
        // has no recovery role to play. A LEGACY blob still resolves here, because it decodes to no
        // labels rather than throwing — erasing a server's label out of a blob that holds none is a
        // no-op, which is what idempotence means at this seam.
        const entries = await readEntries()
        const next = entries.filter((entry) => entry.server !== serverId)
        // Nothing matched: resolve without writing. Idempotent, no needless keychain round-trip, and
        // no EncryptionUnavailableError raised by an erase that had nothing to erase.
        if (next.length === entries.length) return
        // The last label went: delete the blob rather than writing an empty envelope, so "no blob"
        // stays the one at-rest form of nothing stored and this ends exactly where clear() does.
        if (next.length === 0) {
          await secureStore.delete(name)
          return
        }
        // One write, never delete-then-write: a failure here leaves the prior blob whole and throws,
        // so no other server's label is lost by an erase that did not complete.
        await secureStore.set(name, encodeLabels(next))
      })
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
