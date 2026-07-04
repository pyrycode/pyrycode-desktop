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
  }
): () => void {
  const { parse, confirmation } = deps

  // At most one prepared pairing (AC4): the opaque confirm closure of the most-recently-fingerprinted
  // record, or null. Only the closure is held — the fingerprint was already returned, and the
  // record/token/key live inside #53's frozen snapshot, never in a field this module reads or returns.
  let pendingConfirm: (() => Promise<void>) | null = null

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
      // so even a failing submit leaves nothing confirmable.
      pendingConfirm = null
      const parsed = parse(request.paste)
      if (!parsed.ok) return { ok: false, reason: 'invalid-paste' }
      const prepared = confirmation.prepare(parsed.payload)
      // A rejected key produces no confirm handle at all (#53) — nothing to persist, nothing held.
      if (!prepared.ok) return { ok: false, reason: 'invalid-key' }
      pendingConfirm = prepared.confirm
      return { ok: true, fingerprint: prepared.fingerprint }
    }

    // request.type === 'confirm' — a bare signal that carries no record.
    const confirm = pendingConfirm
    if (confirm === null) return { ok: false, reason: 'no-pending-pairing' }
    // Consume BEFORE awaiting so "persists exactly once" (AC3) is structural: a second/concurrent
    // confirm reads null → no-pending-pairing, so there is no double-save race across the await.
    pendingConfirm = null
    try {
      await confirm()
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
