// The single, typed seam the stored-host-label query passes through on the main side. A twin of
// serverInfoHandler.ts (#339): same injected-target shape, single-registration / exact-teardown
// discipline, and stateless read (it holds nothing between calls, reads the host-label store on each
// invoke, and takes NO request argument — the query carries no body). The composition root's index.ts
// calls this once with Electron's ipcMain and the already-constructed hostLabelStore; nothing
// Electron-specific is imported here — the target is injected structurally, so it unit-tests with a
// fake.
//
// It reads AT-REST state only — no relay connection, no supervisor, no session value is in scope — so
// the query answers whether or not a connection is live.
//
// The label off disk is UNTRUSTED and unbounded (hostLabelStore deliberately validates nothing and
// hands that obligation on), so this boundary re-applies the write path's bound against the SAME
// constant, MAX_HOST_LABEL_LENGTH. It is LOG-FREE by construction — no console.* anywhere, on any path
// including every error path; the label is an opaque local, never a named field of a logged object. A
// propagated decrypt-failure error can carry a filesystem path or OS-keychain detail, so the caught
// object is DROPPED (never logged, interpolated, or returned).
//
// Since #1186 it registers THREE arms, in three exported functions on three channels.
// `registerHostLabelHandler` below is the original ZERO-ARGUMENT query, unchanged and still bodiless,
// kept for its current renderer caller (`hostLabelLoader` passes the bridge function as a bare
// reference and calls it with no arguments). `registerHostLabelServerHandler` answers for ONE NAMED
// machine and was the first thing in this module ever to take an untrusted request.
// `registerHostLabelSetHandler` at the bottom is the first thing in it ever to WRITE.
// They are three functions rather than three branches of one listener because that is what keeps each
// arm's store handle minimal and separate — `load`-only, `loadFor`-only, `saveFor`/`clearFor`-only —
// so no read can mutate, the write can neither read a label back nor reach the un-keyed slot, and a
// malformed request on any one of them cannot fall through to another.
//
// The write arm makes that separation carry more weight, not less: it is also the first arm to hold a
// PAIRED-SERVER handle, and therefore the first able to materialise a bearer token and a server static
// key. `registerUnpairServerHandler` calls withholding exactly that "the security substance of this
// handler"; the reason this arm cannot make the same promise is that nothing here reports `matched`
// from inside a mutate queue the way `clearServer` does, so the existence check has to be a read. It
// is contained the way `registerServerInfoHandler` contains `list`: reduced to a boolean in the call
// expression itself, never bound to a name, never destructured, no field reaching a returned value.
import {
  HOST_LABEL_CHANNEL,
  HOST_LABEL_SERVER_CHANNEL,
  HOST_LABEL_SET_CHANNEL,
  isHostLabelServerRequest,
  isHostLabelSetRequest,
  type HostLabelResult
} from '../shared/ipc/hostLabel'
import { MAX_HOST_LABEL_LENGTH } from '../shared/ipc/pairing'
import type { HostLabelStore, MultiHostLabelStore } from './hostLabelStore'
import type { MultiPairedServerStore } from './pairedServerStore'

/**
 * The minimal main-process invoke surface the handler needs. Electron's `ipcMain` satisfies this
 * structurally (its handle/removeHandler accept this shape); the unit test passes a fake
 * `{ handle: vi.fn(), removeHandler: vi.fn() }`, so no Electron harness is required. The listener
 * takes only the IpcMainInvokeEvent (typed `unknown`, never read — .sender / .ports stay
 * unreachable) — there is NO request argument, because the query carries no body.
 */
export interface HostLabelHandleTarget {
  handle(channel: string, listener: (event: unknown) => Promise<HostLabelResult>): void
  removeHandler(channel: string): void
}

/**
 * Register the single invoke handler for the stored-host-label query. Returns an unregister handle
 * that removes exactly the channel it added (mirrors serverInfoHandler's exact teardown;
 * ipcMain.handle allows one handler per channel, so this is the sole registration site). Reuses the
 * already-constructed hostLabelStore — do not build a second store. Holds no state between calls.
 *
 * Typed against `Pick<HostLabelStore, 'load'>`, not the full interface: this read channel is
 * structurally write-proof and erase-proof, so it cannot mutate at-rest state even by accident. The
 * mirror image of #823, which gave the pairing handler a `save`-only handle. Erasing is #827.
 */
export function registerHostLabelHandler(
  target: HostLabelHandleTarget,
  deps: { store: Pick<HostLabelStore, 'load'> }
): () => void {
  const { store } = deps

  const listener = async (): Promise<HostLabelResult> => {
    try {
      // load() reads through with no cache, so a label written at pairing confirm is visible on the
      // very next invoke, with no invalidation step.
      //
      // Since #1156 that confirm writes a KEYED envelope, and `load` is what keeps this query
      // answering as it always has: it recognises both at-rest shapes and hands back ONE label — the
      // most recently stored one — never the envelope text. Without that this handler would return
      // the raw `{"v":1,…}` as the machine's name, or `error` once a longer server id pushed it past
      // the bound below. This channel is deliberately unchanged otherwise: #1157 owns the request
      // argument and #1070 the sidebar's move onto a keyed read.
      const label = await store.load()
      // STRICT null, never a truthiness test. `''` is falsy, so `if (!label)` would type-check, read
      // naturally, pass any test that only exercises a non-empty label, and silently collapse a
      // STORED EMPTY label into absence — at the last boundary where #822's and #823's never-stored
      // vs stored-empty distinction still exists (hostLabelStore.ts:135-139).
      if (label === null) return { status: 'not-stored' }
      // The read bound, the exact negation of isPairingRequest's `label.length <=
      // MAX_HOST_LABEL_LENGTH` (pairing.ts:116) against the SAME imported constant and the same unit
      // (UTF-16 code units): whatever the write guard accepts this accepts, and whatever it rejects
      // this rejects. A byte length or a code-point count would disagree for any non-ASCII label.
      // The bound is re-applied here because MAX_HOST_LABEL_LENGTH bounds what can be WRITTEN through
      // the IPC guard, not what is already on disk — a value stored before the bound existed, or by
      // tampering that still decrypts. The over-long string is dropped WHOLE: no truncation, no
      // prefix, no length reported. Ordered after the null check, which has no `.length`.
      if (label.length > MAX_HOST_LABEL_LENGTH) return { status: 'error' }
      // Verbatim — no trim, no normalize, no escape, no case fold, no fallback substitution. The
      // sidebar row (#826) owns what an empty or absent label falls back to on screen, and owns
      // rendering this untrusted text as escaped text only.
      return { status: 'stored', label }
    } catch {
      // Classify-don't-forward: every throw (MalformedHostLabelError OR a propagated decrypt failure)
      // collapses to the same `error` outcome WITHOUT inspecting the error type. The caught object is
      // DROPPED: its message could echo a filesystem path or keychain detail, so it is never logged,
      // interpolated, or returned. handle must resolve to a value, so this never rethrows — a
      // rejection would cross as an Electron-serialized error carrying a main-process stack trace.
      return { status: 'error' }
    }
  }

  target.handle(HOST_LABEL_CHANNEL, listener)
  return () => target.removeHandler(HOST_LABEL_CHANNEL)
}

/**
 * The minimal main-process invoke surface the KEYED handler needs (#1157). Electron's `ipcMain`
 * satisfies this structurally, exactly as it does UnpairServerHandleTarget's two-argument shape. The
 * IpcMainInvokeEvent first arg is typed `unknown` and is STRIPPED — never read, never forwarded;
 * only the guarded `request` is used.
 */
export interface HostLabelServerHandleTarget {
  handle(
    channel: string,
    listener: (event: unknown, request: unknown) => Promise<HostLabelResult>
  ): void
  removeHandler(channel: string): void
}

/**
 * Register the single invoke handler for the per-server stored-host-label query (#1157) — "what is
 * THIS machine called", where the sibling above asks it of no machine in particular. Returns an
 * unregister handle that removes exactly the channel it added, mirroring that sibling. Stateless: it
 * holds nothing between calls and each invoke reads through to the store, so a label written at
 * pairing confirm is visible on the very next invoke with no invalidation step.
 *
 * The `store` dep is `Pick<MultiHostLabelStore, 'loadFor'>` and the narrowing is the security
 * substance of this arm, not a tidiness preference. It withholds `save`, `saveFor`, `clear` and
 * `clearFor`, so there is NO NAME by which this listener could mutate at-rest state — the compiler
 * holds that, rather than a branch a later edit could get wrong. It withholds `load` too, so the
 * un-keyed read is equally unreachable and a keyed request can never be answered with some other
 * server's name. It is the same instrument as the sibling's `Pick<HostLabelStore, 'load'>`, pointed
 * one level finer, and it is what makes this channel structurally write-proof and erase-proof while
 * being the one host-label seam a compromised renderer can drive with an id of its own choosing.
 *
 * `MultiHostLabelStore`, never `HostLabelStore`: `loadFor` lives on the layered interface, and that
 * layering is load-bearing — `hostLabelHandler.test.ts` annotates an object literal as the whole
 * `HostLabelStore`, so adding a member there would stop that file compiling. A `tsc`-only break that
 * leaves `npm test` green, surfacing in `npm run build` and nowhere else.
 */
export function registerHostLabelServerHandler(
  target: HostLabelServerHandleTarget,
  deps: { store: Pick<MultiHostLabelStore, 'loadFor'> }
): () => void {
  const { store } = deps

  const listener = async (_event: unknown, request: unknown): Promise<HostLabelResult> => {
    // The trust boundary, and the listener's first statement: an untrusted renderer value is
    // narrowed before anything else in this function looks at it. A refusal returns the SAME
    // value-free `error` as every other failure — a distinct outcome would tell a compromised
    // renderer which of its guesses was well-formed — and returns it BEFORE any store call, so a
    // malformed request never reaches the store at all.
    //
    // Deliberately OUTSIDE the try below, matching registerUnpairServerHandler. The guard cannot
    // throw: its `in` test is short-circuited by the typeof/null tests ahead of it, and what arrives
    // here is a structured-clone deserialization — a plain object, never a Proxy with a throwing
    // trap. Moving it inside the try would read as a correction of that sibling rather than as the
    // identical shape it is.
    if (!isHostLabelServerRequest(request)) return { status: 'error' }

    try {
      // The listener's ONLY store interaction, on the only method its dep type carries. The id goes
      // through verbatim — no normalization, no prefixing — and the store matches it with === against
      // each decoded entry's own `server` field, so it never becomes a persistence name, a path or an
      // object key, and an id like `__proto__` is inert. It is never logged here either, which is what
      // keeps this module log-free by construction now that it takes a request at all.
      //
      // A blob predating #1156's keyed envelope reads as no labels for EVERY id, so this answers
      // `not-stored` on such a machine until the next pairing writes an envelope. That is the
      // documented one-way loss, not a gap to patch here: this store has no view of the paired
      // records and so cannot name the server a bare string belonged to, and adopting it for one
      // server would recreate the exact bug #1155 exists to fix.
      const label = await store.loadFor(request.serverId)
      // STRICT null, never a truthiness test — the sibling's argument applies per server: `''` is
      // falsy, so `if (!label)` would type-check, read naturally, pass any test that only exercises a
      // non-empty label, and silently collapse a STORED EMPTY label into absence at the last boundary
      // where the never-stored vs stored-empty distinction still exists.
      if (label === null) return { status: 'not-stored' }
      // The read bound, re-applied per server against the SAME constant and the same unit (UTF-16
      // code units) the write guard uses: whatever isPairingRequest accepts this accepts, and
      // whatever it rejects this rejects. Needed here for the same reason the sibling needs it —
      // MAX_HOST_LABEL_LENGTH bounds what can be WRITTEN through the IPC guard, not what is already
      // on disk. The over-long string is dropped WHOLE: no truncation, no prefix, no length reported.
      // Ordered after the null check, which has no `.length`.
      if (label.length > MAX_HOST_LABEL_LENGTH) return { status: 'error' }
      // Verbatim — no trim, no normalize, no escape, no case fold, no fallback substitution. The
      // sidebar host row (#1070) owns what an empty or absent label falls back to on screen, and owns
      // rendering this untrusted text as escaped, bounded text only.
      return { status: 'stored', label }
    } catch {
      // Classify-don't-forward, identical to the sibling's: every throw (MalformedHostLabelError from
      // invalid UTF-8 or a drifted envelope, OR a propagated decrypt failure) collapses to the same
      // `error` outcome WITHOUT inspecting the error type. The caught object is DROPPED: its message
      // could echo a filesystem path or keychain detail, so it is never logged, interpolated, or
      // returned. handle must resolve to a value, so this never rethrows — a rejection would cross as
      // an Electron-serialized error carrying a main-process stack trace, and the request id with it.
      return { status: 'error' }
    }
  }

  target.handle(HOST_LABEL_SERVER_CHANNEL, listener)
  return () => target.removeHandler(HOST_LABEL_SERVER_CHANNEL)
}

/**
 * The minimal main-process invoke surface the SET handler needs (#1186). Electron's `ipcMain`
 * satisfies this structurally, exactly as it does the keyed read's identical two-argument shape. The
 * IpcMainInvokeEvent first arg is typed `unknown` and is STRIPPED — never read, never forwarded; only
 * the guarded `request` is used.
 *
 * A separate name rather than a reuse of HostLabelServerHandleTarget, which it duplicates today. The
 * two guard channels with two different verbs — one reads, one writes — so naming one after the other
 * would make a later divergence in either read as a bug in both, and would put a read-flavoured name
 * on this module's only mutating arm. Same argument isHostLabelServerRequest makes about
 * isUnpairServerRequest.
 */
export interface HostLabelSetHandleTarget {
  handle(
    channel: string,
    listener: (event: unknown, request: unknown) => Promise<HostLabelResult>
  ): void
  removeHandler(channel: string): void
}

/**
 * Register the single invoke handler for the per-server host-label WRITE (#1186) — "call THIS machine
 * that", where both siblings only ask what it is called. Returns an unregister handle that removes
 * exactly the channel it added, mirroring both. Stateless: it holds nothing between calls, and each
 * invoke writes through to the store, so a set is visible to either read on the very next invoke with
 * no invalidation step.
 *
 * ONE channel, TWO store methods, chosen by the trimmed value: blank after trimming means "no label",
 * so it clears; anything else saves. That is `pairingState`'s `hostLabelToSend` collapse, relocated
 * from the screen to the boundary, and it is the ONE place that decides whether a label exists — the
 * reason `label` is a required field rather than an optional one. Without the collapse, clearing the
 * dialog's field would store an empty NAME, which both reads faithfully report as `stored: ''` rather
 * than as absence.
 *
 * The `store` dep is `Pick<MultiHostLabelStore, 'saveFor' | 'clearFor'>`, and the narrowing is the
 * security substance of this arm exactly as its read-only counterparts' is. It withholds `save` and
 * `clear`, so the un-keyed slot has NO NAME reachable from this listener — the compiler holds that,
 * not a branch a later edit could get wrong — and it withholds `load` and `loadFor`, so this arm
 * cannot read a label back and no label it did not itself receive is ever materialised here.
 *
 * The `pairedServers` dep is `Pick<MultiPairedServerStore, 'loadById'>` and is the one new risk in
 * this module; see the header for the containment and the reason it cannot be withheld. `loadById`
 * rather than `list` deliberately: a null test names no field, where a collection would put every
 * paired record in scope to answer a question about one.
 *
 * The check is not optional and not merely tidy. `saveFor` drops any entry for the id and appends, so
 * without it a bogus id would park an orphan label on disk, become what the still-live un-keyed
 * `load` answers with (that read returns the most recently stored entry), and let a caller append one
 * entry per guessed id and grow the at-rest blob without bound. With it, the stored id is necessarily
 * `===` an already-persisted paired id, so the entry count is capped by the paired-server count.
 *
 * ACCEPTED RESIDUAL, named rather than fixed: `loadById` and the write are two stores' operations
 * across an await, so an unpair landing in that gap leaves an orphan label for a server that is no
 * longer paired. Cross-store atomicity is not available here — neither store's mutate queue
 * serializes against the other's, and a second queue in this handler would guard a lock the paired
 * store does not share. It is the same shape and severity as the non-atomicity already documented
 * between `unpairHandler`'s two erases: stale display text rather than a live credential,
 * self-healing (the next pairing that carries a label overwrites it, the next unpair erases it, and
 * `clearFor` is idempotent).
 */
export function registerHostLabelSetHandler(
  target: HostLabelSetHandleTarget,
  deps: {
    store: Pick<MultiHostLabelStore, 'saveFor' | 'clearFor'>
    pairedServers: Pick<MultiPairedServerStore, 'loadById'>
  }
): () => void {
  const { store, pairedServers } = deps

  const listener = async (_event: unknown, request: unknown): Promise<HostLabelResult> => {
    // The trust boundary, and the listener's first statement: an untrusted renderer value is narrowed
    // before anything else in this function looks at it. A refusal returns the SAME value-free
    // `error` as every other failure — a distinct outcome would tell a compromised renderer which of
    // its guesses was well-formed — and returns it BEFORE any store call, so a malformed request
    // reaches neither store, and above all cannot write.
    //
    // Deliberately OUTSIDE the try below, matching both siblings. The guard cannot throw: its `in`
    // tests are short-circuited by the typeof/null tests ahead of them, and what arrives here is a
    // structured-clone deserialization — a plain object, never a Proxy with a throwing trap.
    if (!isHostLabelSetRequest(request)) return { status: 'error' }

    // Also outside the try, and safe there for the same reason: past the guard `request.label` is a
    // string, `String.prototype.trim` on a primitive cannot throw, and re-reading a field of a
    // structured-clone result yields the same value it was narrowed on (the property the siblings
    // already rely on when they re-read `request.serverId`).
    //
    // Trimmed ONCE, here, and the trimmed value is what is written AND what is answered with — so the
    // response cannot describe a label different from the one on disk. Surrounding whitespace only:
    // no normalize, no case fold, no escape, no collapse of interior runs. The bound was applied to
    // the RAW value at the guard and trimming can only shorten, so what is written is still within
    // MAX_HOST_LABEL_LENGTH and neither read can later refuse it as over-long.
    const label = request.label.trim()

    try {
      // The existence check. The record is reduced to a boolean IN THIS EXPRESSION: never bound to a
      // name, never destructured, never spread, so no field of it — and PairedServerRecord is a type
      // alias of QrPayload, so that means a bearer token and a server static key — is reachable on
      // any line below. The id goes through verbatim and the store matches it with === against each
      // decoded entry's own `server` field, so it never becomes a persistence name, a path or an
      // object key. It is never logged here either, which is what keeps this module log-free by
      // construction now that it takes a request AND writes.
      if ((await pairedServers.loadById(request.serverId)) === null) return { status: 'error' }

      // Blank after trimming is "no label", so the clear is this channel's second verb rather than a
      // second request shape. `clearFor` erases exactly this server's label and is idempotent, so
      // clearing a label that was never stored is this same path and needs no guard.
      if (label === '') {
        await store.clearFor(request.serverId)
        return { status: 'not-stored' }
      }

      await store.saveFor(request.serverId, label)
      // The label as now held — the value just written, NOT a read-back. A re-read would need a
      // third method in the dep type, would race the store's own mutate queue, and could throw AFTER
      // a completed write and downgrade a real success to `error`. Reported only after the write
      // resolves, so `stored` is never claimed over a write that did not land.
      return { status: 'stored', label }
    } catch {
      // Classify-don't-forward, identical to both siblings': every throw (EncryptionUnavailableError
      // from a missing keychain, a propagated decrypt failure, MalformedHostLabelError from a drifted
      // envelope, or MalformedPairedServerRecordError from the existence check) collapses to the same
      // `error` outcome WITHOUT inspecting the error type. The caught object is DROPPED: its message
      // could echo a filesystem path or keychain detail, so it is never logged, interpolated, or
      // returned. handle must resolve to a value, so this never rethrows — a rejection would cross as
      // an Electron-serialized error carrying a main-process stack trace.
      //
      // Fail-closed, and honestly so: the store's write is single-shot (it never deletes then
      // writes), so a throw here means the prior blob is whole and `error` is the truthful answer.
      return { status: 'error' }
    }
  }

  target.handle(HOST_LABEL_SET_CHANNEL, listener)
  return () => target.removeHandler(HOST_LABEL_SET_CHANNEL)
}
