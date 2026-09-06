// The single, typed seam an incoming pairing request/response round-trip passes through on the main
// side. Mirror image of receiveCommand (#17): same injected-target shape and single-registration /
// exact-teardown discipline, adapted for invoke/handle (a reply is required) and holding at most one
// prepared pairing between a submit and its confirm. The composition root (#54's index.ts) calls
// this once with Electron's ipcMain and the two upstream operations (#52 parse, #53 confirmation);
// nothing Electron-specific is imported here — the target is injected structurally, so it unit-tests
// with a fake, exactly as CommandSource did.
//
// Because a reply channel now exists, the "only the fingerprint or a value-free reason crosses back"
// invariant (AC4) is load-bearing at exactly this seam: this module reads only the validated
// `request`, holds only the opaque `confirm` closure (#53's frozen snapshot holds the record/token/
// key, never a field this module returns), and maps every outcome to the value-free shared vocabulary.
import {
  PAIRING_CHANNEL,
  isPairingRequest,
  type PairingSubmitResponse,
  type PairingConfirmResponse
} from '../shared/ipc/pairing'
import type { ParsePairingResult } from './pairingPayload'
import type { PairingConfirmation } from './pairingConfirmation'
import type { MultiHostLabelStore } from './hostLabelStore'

/**
 * The minimal main-process invoke surface the handler needs. Electron's `ipcMain` satisfies this
 * structurally (its handle/removeHandler accept this shape); the unit test passes a fake
 * `{ handle: vi.fn(), removeHandler: vi.fn() }`, so no Electron harness is required. The
 * IpcMainInvokeEvent first arg is typed `unknown` — it is stripped, never forwarded into a composed
 * call; only the validated `request` is used.
 */
export interface PairingHandleTarget {
  handle(
    channel: string,
    listener: (
      event: unknown,
      request: unknown
    ) => Promise<PairingSubmitResponse | PairingConfirmResponse>
  ): void
  removeHandler(channel: string): void
}

/**
 * Register the single invoke handler for pairing. Returns an unregister handle that removes exactly
 * the channel it added (mirrors receiveCommand's exact teardown; ipcMain.handle allows one handler
 * per channel, so this is the sole registration site). Composes the two injected upstream
 * operations — faked in tests — and holds at most one prepared pairing between submit and confirm.
 */
export function registerPairingHandler(
  target: PairingHandleTarget,
  deps: {
    parse: (pasted: string) => ParsePairingResult
    confirmation: PairingConfirmation
    /**
     * Called once after a confirm persists the record — the connect-on-pair trigger (#82). A
     * trusted in-process callback that MUST NOT throw (mirrors the onEvent/sink discipline elsewhere
     * in main). Never called on a failed persist (AC4) or on submit. Carries no arguments — a bare
     * signal, so no record/token/key field crosses to its caller (AC5).
     */
    onPaired?: () => void
    /**
     * The write half of the host-label store (#822), used only when a confirm carries a label (#823),
     * and keyed by server since #1156 so a second pairing stops overwriting the first machine's name.
     * `Pick<…, 'saveFor'>` follows PairingHandleTarget's minimal-structural-surface idiom: this
     * handler therefore CANNOT load any label back or clear one — only write the operator's display
     * text for the pairing it just persisted, under that pairing's own id. Optional, mirroring
     * onPaired above, so every existing call site compiles unchanged; the composition root always
     * wires it. Widening to MultiHostLabelStore does NOT widen what is reachable here: a `Pick` of one
     * member inherits nothing from the interface it extends.
     */
    hostLabel?: Pick<MultiHostLabelStore, 'saveFor'>
  }
): () => void {
  const { parse, confirmation, onPaired, hostLabel } = deps

  // At most one prepared pairing (AC4): the opaque confirm closure of the most-recently-fingerprinted
  // record, plus the `server` id that record carries, or null. Only the closure and the id are held —
  // the fingerprint was already returned, and the token/key live inside #53's frozen snapshot, never
  // in a field this module reads or returns.
  //
  // ONE slot holding both, never two parallel `let`s (#1156). The id is what decides which machine a
  // label describes, so a path that replaced or cleared one and not the other would write this
  // pairing's name onto another server — this ticket's own defect, arriving from the other direction.
  // Held together, they are set together and consumed together and cannot come apart.
  let pending: { confirm: () => Promise<void>; serverId: string } | null = null

  const listener = async (
    _event: unknown,
    request: unknown
  ): Promise<PairingSubmitResponse | PairingConfirmResponse> => {
    // Guard first, at the untrusted→trusted boundary. Unlike send/on, handle must resolve to a
    // value, so a malformed request returns a typed error rather than being silently dropped. Log
    // one fixed value-free string (never echo request/paste), mirroring receiveCommand's drop log.
    if (!isPairingRequest(request)) {
      console.warn('pyry:pairing — rejected malformed request')
      return { ok: false, reason: 'malformed-request' }
    }

    if (request.type === 'submit') {
      // A new submit supersedes any prior prepared pairing (AC4): drop it up front, before parse,
      // so even a failing submit leaves nothing confirmable — the id goes with it, in one statement.
      pending = null
      const parsed = parse(request.paste)
      if (!parsed.ok) return { ok: false, reason: 'invalid-paste' }
      const prepared = confirmation.prepare(parsed.payload)
      // A rejected key produces no confirm handle at all (#53) — nothing to persist, nothing held.
      if (!prepared.ok) return { ok: false, reason: 'invalid-key' }
      // The id comes off the SAME payload object `prepare` just froze `record.server` from, in the
      // statement above, so the label's id and the persisted record's id cannot differ. `prepare`
      // deliberately hands back only a fingerprint and an opaque callable — widening PreparedPairing
      // to carry the id would put a record field on the return path of the one module whose whole
      // purpose is that no record field leaves it, next to the bearer token. Reading it here instead
      // materialises the `server` id and nothing else, and that id is already renderer-visible
      // through the paired-server-info query.
      pending = { confirm: prepared.confirm, serverId: parsed.payload.server }
      return { ok: true, fingerprint: prepared.fingerprint }
    }

    // request.type === 'confirm' — carries no record; at most the operator's display label (#823).
    const prepared = pending
    if (prepared === null) return { ok: false, reason: 'no-pending-pairing' }
    // Consume BEFORE awaiting so "persists exactly once" (AC3) is structural: a second/concurrent
    // confirm reads null → no-pending-pairing, so there is no double-save race across the await. The
    // pair is consumed as a unit, so neither half can survive into a later confirm on its own.
    pending = null
    try {
      await prepared.confirm()
      // The record persisted, so the label now describes something real: hand it to the host-label
      // store (#823), its ONE sink. Ordered here on purpose — AFTER the record (a label for a pairing
      // that did not persist is meaningless, and a failed persist takes the catch below without
      // writing anything), and BEFORE onPaired, whose reconnect() flips the window to the paired UI:
      // persisting first leaves no window in which the sidebar renders a host with no name. This adds
      // no new class of stall — the record save one line above already went through the same
      // secureStore seam, so any keychain prompt has happened by now. A present-but-undefined label is
      // the no-label pairing (see the guard), so the check is against undefined, not truthiness: '' is
      // a value the operator supplied and is saved as one.
      if (request.label !== undefined) {
        try {
          // Under the id of the pairing just persisted (#1156), so this machine's name replaces only
          // its own previous name and leaves every other paired machine's untouched. The id is a JSON
          // string value and a `===` comparand inside the store — never a persistence name, a path,
          // or an object key — and it is not logged here, because no label branch logs at all.
          await hostLabel?.saveFor(prepared.serverId, request.label)
        } catch {
          // The response reports on the RECORD (AC5): the pairing succeeded, so a lost nickname must
          // not be reported as a failed pairing — it is recoverable by re-entering the label. The
          // caught object is DROPPED: secureStore.set's failures can carry an OS-keychain or
          // filesystem path in their message, so it is never logged, interpolated, or returned
          // (unpairHandler.ts:59-68 precedent). No console.* on any label branch, including this one —
          // AC4 forbids a log line that names or echoes the label, and adding none is the cleanest way
          // to hold that.
        }
      }
      // Fire the connect-on-pair trigger (#82) before replying. Guarded — a
      // handler registered without it (every existing caller) is unaffected. A failed persist takes
      // the catch below instead, so this never fires on failure (AC4).
      onPaired?.()
      return { ok: true }
    } catch {
      // confirm()'s only throw source is store.save (e.g. EncryptionUnavailableError), whose message
      // may carry a filesystem path — caught and mapped to a value-free reason, never echoed/logged.
      return { ok: false, reason: 'persist-failed' }
    }
  }

  target.handle(PAIRING_CHANNEL, listener)
  return () => target.removeHandler(PAIRING_CHANNEL)
}
