// The single, typed seam the "forget this paired server" request passes through on the main side. A
// sibling of pairingStatusHandler.ts (#79): same injected-target shape and single-registration /
// exact-teardown discipline, and equally stateless — it holds nothing between calls, and each invoke
// reads through to the store. The composition root (#173's index.ts) calls it once with Electron's
// ipcMain and the already-constructed stores; nothing Electron-specific is imported here — the target
// is injected structurally, so it unit-tests with a fake.
//
// It exposes ONLY the ability to TRIGGER an erase to the renderer: the response is the value-free
// UnpairResult enum, and no token / server_static_pubkey / relay URL / keychain path ever leaves
// this module — and as of #827 no host label either, since the label handle is erase-only
// (`clearFor` since #1156) and the string is therefore never materialised here. It is LOG-FREE by
// construction — no console.* anywhere, and that includes the server id the request names. #172's
// erase is fail-closed (a secureStore.delete failure propagates rather than being swallowed), and a
// propagated error can carry a filesystem path or OS-keychain detail, so the caught object is DROPPED
// (never logged, interpolated, or returned). The `error` arm is the fail-closed boundary that turns
// that throw into a value-free result: only a SUCCESSFUL erase maps to `ok`, so a live bearer token is
// never reported as erased while it may still sit on disk.
//
// ONE ARM SINCE #1163, AND IT WAS TWO. #1149 added `registerUnpairServerHandler` beside an original
// `registerUnpairHandler` that erased the WHOLE collection from a bodiless request, as a Strangler
// Fig: two exported functions on two channels rather than two branches of one listener, so that "no
// malformed request can reach the whole-collection erase" was held by the compiler rather than by a
// branch a later edit could get wrong. #1163 migrated that arm's one remaining caller — the composer's
// Re-pair control — onto this one and deleted it wholesale, taking with it the `hostLabel.clear()` call
// that erased EVERY server's label (#1156 left that arm standing for exactly this deletion; the
// per-server `clearFor` below already erases precisely the named server's, so nothing replaces it).
// The structural property survives its motivation: this module now has no whole-collection erase to
// reach, and its store handle still refuses to name one.
import {
  UNPAIR_SERVER_CHANNEL,
  isUnpairServerRequest,
  type UnpairResult
} from '../shared/ipc/unpair'
import type { MultiPairedServerStore } from './pairedServerStore'
import type { MultiHostLabelStore } from './hostLabelStore'

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
 * machine", and since #1163 the only unpair this app registers. Returns an unregister handle that
 * removes exactly the channel it added (ipcMain.handle allows one handler per channel, so this is the
 * sole registration site). Stateless: it holds nothing between calls and each invoke reads through to
 * the store.
 *
 * The `store` dep is `Pick<MultiPairedServerStore, 'clearServer'>` and the narrowing is the security
 * substance of this handler, not a tidiness preference. It withholds `clear`, so the whole-collection
 * erase has NO NAME reachable from this listener and AC2's "no malformed per-server request can
 * reach it on any input" is a fact about the type rather than about a branch — a property that
 * outlived the deleted arm it was written against, since a future `clear` caller would have to widen
 * this dep first. It withholds `load`, `loadById`, `list` and `save`, so no PairedServerRecord — and
 * therefore no bearer token or server static key — can be materialised in this module at all, which
 * was strictly stronger than the deleted arm's `ClearablePairedServerStore` dep (that one inherited
 * `load` and leaned on a test to pin its non-use). It is the same instrument as
 * `Pick<MultiHostLabelStore, 'clearFor'>`, pointed at the record.
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
    /**
     * Called once after the record erase succeeds — the teardown-on-unpair trigger (#504). A trusted
     * in-process callback, value-free (no record/token/key crosses), mirroring
     * `registerPairingHandler`'s onPaired contract. Never called when the erase throws or matches
     * nothing. MUST NOT throw; a throw is DROPPED rather than downgrading the already-completed erase
     * to `error` — see the listener.
     */
    onUnpaired?: () => void
    /**
     * The PER-SERVER erase half of the host-label store (#1156). `Pick<…, 'clearFor'>` mirrors
     * pairingHandler's `save`-only handle (#823) and hostLabelHandler's `load`-only one (#824) in the
     * third direction: `clearFor` erases exactly one named server's label, and
     * `save`/`load`/`saveFor`/`loadFor` are absent from the TYPE, so this module cannot read a label
     * back or overwrite it and no label text is materialised here at all — "no label text reaches the
     * result or any log" is held by the compiler rather than by convention. Optional, mirroring
     * onUnpaired; the composition root always wires it.
     */
    hostLabel?: Pick<MultiHostLabelStore, 'clearFor'>
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
      // Classify-don't-forward, the fail-closed boundary: every throw maps to
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

    // Erase THIS server's label and no other (#1156), naming the same already-guarded id the record
    // erase just used. Unconditional on a matched unpair: whatever stays paired keeps its own name,
    // because the label is now keyed by server.
    //
    // Until #1156 this erase was gated on `outcome.remaining === 0`. That rule was correct while the
    // label was one un-keyed slot — erasing it on every per-server unpair would have wiped the name
    // a STILL-PAIRED server is displayed under, so clearing it only once nothing remained was the
    // one point where a single-slot label was well defined. Keyed, the gate is the bug it was
    // guarding against: it leaves the unpaired machine's name on disk for as long as any other
    // machine stays paired. Nothing replaces it — `remaining` no longer decides anything here.
    //
    // Ordered AFTER the record erase and OUTSIDE the fail-closed catch above, both deliberately. The
    // result reports on the RECORD — the credential — and the record is already gone by this line, so
    // mapping a throw here to `error` would leave a paired-looking UI over an erased record: the same
    // inverse half-state the onUnpaired block below is kept outside the catch to avoid. The two
    // failures are not the same severity. A surviving record is a live bearer token; a surviving label
    // is stale display text, overwritten by the next pairing that carries one and erased by the next
    // unpair. Record-first also settles the crash interleaving: a kill between the two erases leaves
    // no-record + orphan label, which is benign and self-healing, rather than label-first's
    // live-credential-with-no-name. `clearFor` is idempotent on an absent label, so "unpair a server
    // whose label was never stored" is this same path and needs no guard. The caught object is
    // DROPPED, never logged, interpolated, or returned — and the id is not logged either, which is
    // what keeps this module log-free now that it names one here.
    try {
      await hostLabel?.clearFor(request.serverId)
    } catch {
      // Intentionally empty — see above.
    }
    // Both at-rest erases are done: fire the teardown trigger so the live daemon session cannot
    // outlive the record that authorised it. The wired callback is the registry's reconcile(), which
    // re-reads the store and drops exactly the connection whose record went, leaving every other one
    // live and un-handshaken. Deliberately outside the fail-closed catch and guarded by its own —
    // unlike onPaired, which sits inside its try. `runUnpair` coerces BOTH `error` and a rejected
    // invoke to "stay on the conversation screen", so reporting a throw here would leave a
    // paired-looking UI over an already-erased record: the precise inverse half-state that coercion
    // exists to prevent. By this point the erase has resolved, so `ok` is the truthful answer and a
    // throw here must not downgrade it. The caught object is DROPPED.
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
