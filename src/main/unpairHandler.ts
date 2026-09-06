// The single, typed seam the "erase the stored pairing" request passes through on the main side. A
// sibling of pairingStatusHandler.ts (#79): same injected-target shape and single-registration /
// exact-teardown discipline, and equally stateless — it holds nothing between calls, and each invoke
// reads through to the store. (Until #1149 it also took NO request argument at all; that is now true
// of the whole-collection arm alone — see the two-arm note below.) The
// composition root (#173's index.ts) calls this once with Electron's ipcMain and the already-
// constructed ClearablePairedServerStore; nothing Electron-specific is imported here — the target is
// injected structurally, so it unit-tests with a fake.
//
// It exposes ONLY the ability to TRIGGER an erase to the renderer: the response is the value-free
// UnpairResult enum, and no token / server_static_pubkey / relay URL / keychain path ever leaves
// this module — and as of #827 no host label either, since the label handle is `clear`-only and the
// string is therefore never materialised here. It is LOG-FREE by construction — no console.*
// anywhere. #172's clear() is fail-closed
// (a secureStore.delete failure propagates rather than being swallowed), and a propagated error can
// carry a filesystem path or OS-keychain detail, so the caught object is DROPPED (never logged,
// interpolated, or returned). The `error` arm is the fail-closed boundary that turns that throw into
// a value-free result: only the SUCCESSFUL completion of clear() maps to `ok`, so a live bearer
// token is never reported as erased while it may still sit on disk.
//
// Since #1149 it registers TWO arms, in two exported functions on two channels. `registerUnpairHandler`
// below is the original WHOLE-COLLECTION erase, unchanged and still bodiless, kept for its one
// remaining caller (the composer's Re-pair control) until #1152 migrates it and deletes this half.
// `registerUnpairServerHandler` at the bottom erases exactly ONE named record and is the first thing
// in this module ever to take an untrusted request. They are two functions rather than two branches
// of one listener because that is what makes AC2's property structural: the per-server arm's store
// handle is `Pick<MultiPairedServerStore, 'clearServer'>`, which carries neither the
// whole-collection `clear` nor ANY read, so no malformed request can reach the whole-collection
// erase and no bearer token can be materialised here — the compiler holds both, rather than a
// branch that a later edit could get wrong.
import {
  UNPAIR_CHANNEL,
  UNPAIR_SERVER_CHANNEL,
  isUnpairServerRequest,
  type UnpairResult
} from '../shared/ipc/unpair'
import type { ClearablePairedServerStore, MultiPairedServerStore } from './pairedServerStore'
import type { HostLabelStore } from './hostLabelStore'

/**
 * The minimal main-process invoke surface the handler needs. Electron's `ipcMain` satisfies this
 * structurally (its handle/removeHandler accept this shape); the unit test passes a fake
 * `{ handle: vi.fn(), removeHandler: vi.fn() }`, so no Electron harness is required. The listener
 * takes only the IpcMainInvokeEvent (typed `unknown`, stripped) — there is NO request argument,
 * because the request carries no body.
 */
export interface UnpairHandleTarget {
  handle(channel: string, listener: (event: unknown) => Promise<UnpairResult>): void
  removeHandler(channel: string): void
}

/**
 * Register the single invoke handler for the unpair request. Returns an unregister handle that
 * removes exactly the channel it added (mirrors pairingStatusHandler's exact teardown;
 * ipcMain.handle allows one handler per channel, so this is the sole registration site). Reuses the
 * already-constructed ClearablePairedServerStore — do not build a second store. Holds no state
 * between calls; the store dep is typed against the concrete ClearablePairedServerStore (which
 * carries clear()), not base PairedServerStore.
 */
export function registerUnpairHandler(
  target: UnpairHandleTarget,
  deps: {
    store: ClearablePairedServerStore
    /**
     * Called once after clear() erases the record — the teardown-on-unpair trigger (#504). A
     * trusted in-process callback, value-free (no record/token/key crosses), mirroring onPaired's
     * contract (pairingHandler.ts:51-57). Never called when clear() throws. MUST NOT throw; a throw
     * is DROPPED rather than downgrading the already-completed erase to `error` — see the listener.
     */
    onUnpaired?: () => void
    /**
     * The erase half of the host-label store (#822), used once the record erase has succeeded
     * (#827). `Pick<…, 'clear'>` mirrors pairingHandler's `save`-only handle (#823) and
     * hostLabelHandler's `load`-only one (#824) in the third direction: this handler therefore
     * cannot read the label back or overwrite it — and because `load` is absent from the TYPE, the
     * label string is never materialised in this module at all, so "no label text reaches the
     * result or any log" is held by the compiler rather than by convention. Optional, mirroring
     * onUnpaired above, so every existing call site compiles unchanged; the composition root always
     * wires it.
     */
    hostLabel?: Pick<HostLabelStore, 'clear'>
  }
): () => void {
  const { store, onUnpaired, hostLabel } = deps

  const listener = async (): Promise<UnpairResult> => {
    try {
      // The listener's ONLY store interaction is clear() — never load/save. It erases; it does not
      // read. clear() is idempotent (a not-paired store clears cleanly), so success covers both
      // "record erased" and "already absent".
      await store.clear()
    } catch {
      // Classify-don't-forward: every throw maps to `error` WITHOUT inspecting the error type. The
      // caught object is DROPPED — its message could echo a keychain/filesystem path, so it is never
      // logged, interpolated, or returned. This is the fail-closed boundary: it never resolves `ok`
      // while a live bearer token may still be on disk. handle must resolve to a value, so this never
      // rethrows. The teardown below is skipped: nothing was erased, so nothing must be torn down.
      return { result: 'error' }
    }
    // The record is gone, so the label that described it now describes nothing: erase it too (#827),
    // or it outlives its record and the next pairing that carries no label shows the previous
    // machine's name (pairingHandler.ts:118 writes only when one is supplied).
    //
    // Ordered AFTER the record and OUTSIDE the fail-closed catch above, both deliberately. The
    // result reports on the RECORD — the credential — and by this line the record is already gone,
    // so mapping a throw here to `error` would leave a paired-looking UI over an erased record: the
    // same inverse half-state the onUnpaired block below is kept outside the catch to avoid. The two
    // failures are not the same severity. A surviving record is a live bearer token; a surviving
    // label is stale display text, overwritten by the next pairing that carries one and erased by
    // the next unpair. Record-first also settles the crash interleaving: a kill between the two
    // erases leaves no-record + orphan label, which is benign and self-healing, rather than
    // label-first's live-credential-with-no-name. This is the same rule pairingHandler.ts:121-127
    // applied to the write half (a lost nickname must not be reported as a failed pairing).
    //
    // The caught object is DROPPED, exactly as the two catches around it: secureStore.delete's
    // failure can carry an OS-keychain or filesystem path, so it is never logged, interpolated, or
    // returned. No console.* is added on any path — the module stays log-free by construction.
    // hostLabelStore.clear() is idempotent on an absent label, so "unpair when none was stored"
    // is this same path and needs no guard.
    try {
      await hostLabel?.clear()
    } catch {
      // Intentionally empty — see above.
    }
    // Both at-rest erases are done: fire the teardown trigger (#504) so the live daemon session cannot outlive
    // the record that authorised it. Deliberately OUTSIDE the fail-closed catch above and guarded by
    // its own — unlike onPaired, which sits inside its try (pairingHandler.ts:103). runUnpair coerces
    // BOTH `error` and a rejected invoke to "stay on the conversation screen", so reporting a throw
    // here would leave a paired-looking UI over an already-erased record: the precise inverse
    // half-state runUnpair exists to prevent. By this point the erase has resolved — and the wired
    // callback, connection.reconnect(), arms the event fence in dial()'s first statement — so `ok` is
    // the truthful answer. The caught object is DROPPED, keeping this module log-free by construction.
    try {
      onUnpaired?.()
    } catch {
      // Intentionally empty — see above.
    }
    return { result: 'ok' }
  }

  target.handle(UNPAIR_CHANNEL, listener)
  return () => target.removeHandler(UNPAIR_CHANNEL)
}

/**
 * The minimal main-process invoke surface the PER-SERVER handler needs (#1149). Electron's `ipcMain`
 * satisfies this structurally, exactly as it does PairingHandleTarget's two-argument shape. The
 * IpcMainInvokeEvent first arg is typed `unknown` and is STRIPPED — never read, never forwarded;
 * only the guarded `request` is used.
 */
export interface UnpairServerHandleTarget {
  handle(
    channel: string,
    listener: (event: unknown, request: unknown) => Promise<UnpairResult>
  ): void
  removeHandler(channel: string): void
}

/**
 * Register the single invoke handler for the per-server unpair request (#1149) — "forget THIS
 * machine", where the sibling above forgets every machine. Returns an unregister handle that removes
 * exactly the channel it added, mirroring that sibling. Stateless: it holds nothing between calls and
 * each invoke reads through to the store.
 *
 * The `store` dep is `Pick<MultiPairedServerStore, 'clearServer'>` and the narrowing is the security
 * substance of this arm, not a tidiness preference. It withholds `clear`, so the whole-collection
 * erase has NO NAME reachable from this listener and AC2's "no malformed per-server request can
 * reach it on any input" is a fact about the type rather than about a branch. It withholds `load`,
 * `loadById`, `list` and `save`, so no PairedServerRecord — and therefore no bearer token or server
 * static key — can be materialised in this module at all, which is strictly stronger than the
 * sibling's `ClearablePairedServerStore` dep (that one inherits `load` and leans on a test to pin
 * its non-use). It is the same instrument as `Pick<HostLabelStore, 'clear'>`, pointed at the record.
 *
 * That narrowing is affordable only because `clearServer` REPORTS what it did: `matched` answers
 * "was anything actually held under this id" — which the erase alone cannot, since an unheld id
 * resolves silently — and `remaining` answers "is anything still paired", which decides the label.
 * Both come back from the call that already succeeded, computed inside the store's mutate queue, so
 * there is no follow-up read to race the erase, and no read that could throw AFTER a successful
 * erase and downgrade it to `error`.
 */
export function registerUnpairServerHandler(
  target: UnpairServerHandleTarget,
  deps: {
    store: Pick<MultiPairedServerStore, 'clearServer'>
    /** The teardown-on-unpair trigger, same contract as the sibling's — see its doc comment. */
    onUnpaired?: () => void
    /** The erase half of the host-label store, same `clear`-only handle as the sibling's. */
    hostLabel?: Pick<HostLabelStore, 'clear'>
  }
): () => void {
  const { store, onUnpaired, hostLabel } = deps

  const listener = async (_event: unknown, request: unknown): Promise<UnpairResult> => {
    // The trust boundary, and the listener's first statement: an untrusted renderer value is
    // narrowed before anything else in this function looks at it. A refusal returns the SAME
    // value-free `error` as every other failure — a distinct outcome would tell a compromised
    // renderer which of its guesses was well-formed — and returns it before any store call, so a
    // malformed request never reaches the store at all, let alone an erase.
    if (!isUnpairServerRequest(request)) return { result: 'error' }

    let outcome: Awaited<ReturnType<MultiPairedServerStore['clearServer']>>
    try {
      // The listener's ONLY store interaction, on the only method its dep type carries. The id goes
      // through verbatim; the store matches it with === against each decoded entry's own `server`
      // field, so it never becomes a persistence name, a path or an object key — and it is never
      // logged here either, which is what keeps this module log-free by construction now that it
      // takes a request at all.
      outcome = await store.clearServer(request.serverId)
    } catch {
      // Classify-don't-forward, identical to the sibling's fail-closed catch: every throw maps to
      // `error` WITHOUT inspecting the error, and the caught object is DROPPED — it could echo a
      // keychain or filesystem path. The store's erase is single-shot (it never deletes then
      // writes), so a throw here means the prior blob is whole and nothing left disk; the follow-ups
      // below are skipped for exactly that reason.
      return { result: 'error' }
    }

    // Nothing was held under that id, so nothing was erased and nothing was written. Refused for
    // the same reason a malformed request is: this arm reports on an erase it performed, and it
    // performed none. The label and the teardown trigger must not fire — no record left, so no live
    // session lost its authorisation and no name stopped describing anything.
    if (!outcome.matched) return { result: 'error' }

    // The label is the SINGLE-SLOT one: hostLabelStore is not keyed by server (per-server keying is
    // recorded there as deferred), so erasing it on every per-server unpair would wipe the name a
    // STILL-PAIRED server is displayed under. Clearing it only once nothing remains preserves
    // today's semantics at the one point where a single-slot label is well defined, and matches what
    // the sibling does when the whole collection goes.
    //
    // Ordered AFTER the record erase and OUTSIDE the fail-closed catch above, both for the reasons
    // the sibling's listener sets out at length: the result reports on the RECORD, the record is
    // already gone by this line, and mapping a throw here to `error` would leave a paired-looking UI
    // over an erased record. A surviving record is a live bearer token; a surviving label is stale
    // display text. The caught object is DROPPED, never logged, interpolated, or returned.
    if (outcome.remaining === 0) {
      try {
        await hostLabel?.clear()
      } catch {
        // Intentionally empty — see above.
      }
    }
    // Both at-rest erases are done: fire the teardown trigger so the live daemon session cannot
    // outlive the record that authorised it. The wired callback is the registry's reconcile(), which
    // re-reads the store and drops exactly the connection whose record went, leaving every other one
    // live and un-handshaken. Deliberately outside the fail-closed catch and guarded by its own, on
    // the sibling's reasoning: by this point the erase has resolved, so `ok` is the truthful answer
    // and a throw here must not downgrade it. The caught object is DROPPED.
    try {
      onUnpaired?.()
    } catch {
      // Intentionally empty — see above.
    }
    return { result: 'ok' }
  }

  target.handle(UNPAIR_SERVER_CHANNEL, listener)
  return () => target.removeHandler(UNPAIR_SERVER_CHANNEL)
}
