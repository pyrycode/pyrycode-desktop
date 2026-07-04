// The pairing screen's state machine, IPC effect-runners, and fingerprint formatter — all
// pure and React-free, so they run in the `node` vitest environment with no DOM ceremony and
// are the single tested seam for AC5 (paste→submit invokes the IPC; confirm triggers persist;
// cancel discards; a validation error is surfaced). The React screen (PairingScreen.tsx) is
// thin glue over these, mirroring the sessionStore (pure) / ConversationScreen (React) split.
//
// Renderer-only: it consumes the existing typed pairing IPC channel (#54) through an injected
// bridge and never touches a token, server key, socket, or raw byte — those live in the
// background process (ADR 0002; CLAUDE.md "keep the transport out of the window"). The only
// values that cross the bridge are the display `fingerprint` (a hash) and value-free
// `PairingErrorReason` categories.
import type {
  PairingErrorReason,
  PairingSubmitResponse,
  PairingConfirmResponse
} from '@shared/ipc/pairing'

/**
 * The screen's phase machine over one pairing round-trip. Discriminated on `phase`, per
 * CLAUDE.md's sealed-shape convention. `paste` is threaded through editing → submitting →
 * reviewing → confirming so a confirm failure can return to `editing` with the paste intact
 * for a one-click retry; it embeds the token, so it is the only field that transitively holds
 * a secret and never leaves this module except via the single submitPairingPaste call. `error`
 * lives only on `editing` (the sole phase that renders an inline message); `fingerprint` only on
 * reviewing/confirming. `paired` is terminal and carries nothing — no secret, no record.
 */
export type PairingState =
  | { phase: 'editing'; paste: string; error: PairingErrorReason | null }
  | { phase: 'submitting'; paste: string }
  | { phase: 'reviewing'; paste: string; fingerprint: string }
  | { phase: 'confirming'; paste: string; fingerprint: string }
  | { phase: 'paired' }

/**
 * State transitions. Sealed discriminated union on `type`: the two user intents (submit,
 * confirm, cancel, paste-changed) and the four IPC outcomes the effect-runners produce.
 */
export type PairingEvent =
  | { type: 'paste-changed'; paste: string }
  | { type: 'submit' }
  | { type: 'submit-succeeded'; fingerprint: string }
  | { type: 'submit-failed'; reason: PairingErrorReason }
  | { type: 'confirm' }
  | { type: 'confirm-succeeded' }
  | { type: 'confirm-failed'; reason: PairingErrorReason }
  | { type: 'cancel' }

export const initialPairingState: PairingState = { phase: 'editing', paste: '', error: null }

/** Compile-time exhaustiveness guard: a new PairingEvent arm without a case is a type error. */
function assertNever(event: never): never {
  throw new Error(`Unhandled pairing event: ${JSON.stringify(event)}`)
}

/**
 * Pure reducer — no mutation, returns fresh state (mirrors reduceSession). Each arm guards on
 * the current `phase` and returns `state` unchanged for an out-of-phase event, so a stray event
 * is a safe no-op. `cancel` from any phase resets to `initialPairingState`, discarding the paste.
 *
 * `confirm-failed` returns to `editing` (paste preserved), NOT `reviewing`: the main handler
 * consumes its pending record before awaiting the persist (#54, consume-before-await), so after
 * any confirm failure a retry must be a fresh submit — routing back to `reviewing` would offer a
 * Confirm that is structurally guaranteed to fail with `no-pending-pairing`.
 */
export function pairingReducer(state: PairingState, event: PairingEvent): PairingState {
  switch (event.type) {
    case 'paste-changed':
      return state.phase === 'editing'
        ? { phase: 'editing', paste: event.paste, error: null }
        : state
    case 'submit':
      return state.phase === 'editing' ? { phase: 'submitting', paste: state.paste } : state
    case 'submit-succeeded':
      return state.phase === 'submitting'
        ? { phase: 'reviewing', paste: state.paste, fingerprint: event.fingerprint }
        : state
    case 'submit-failed':
      return state.phase === 'submitting'
        ? { phase: 'editing', paste: state.paste, error: event.reason }
        : state
    case 'confirm':
      return state.phase === 'reviewing'
        ? { phase: 'confirming', paste: state.paste, fingerprint: state.fingerprint }
        : state
    case 'confirm-succeeded':
      return state.phase === 'confirming' ? { phase: 'paired' } : state
    case 'confirm-failed':
      return state.phase === 'confirming'
        ? { phase: 'editing', paste: state.paste, error: event.reason }
        : state
    case 'cancel':
      return initialPairingState
    default:
      return assertNever(event)
  }
}

/**
 * The injected transport seam — the two typed methods this screen calls (#54). `window.pyry` is
 * structurally assignable (it has these two plus extras), so the container defaults to it and
 * tests pass a `{ submitPairingPaste: vi.fn(), confirmPairing: vi.fn() }` fake. No React, no
 * electron import here.
 */
export interface PairingBridge {
  submitPairingPaste(paste: string): Promise<PairingSubmitResponse>
  confirmPairing(): Promise<PairingConfirmResponse>
}

/**
 * Submit the paste over the bridge and map the typed response to the reducer event it produces.
 * This is the tested proof that "submit invokes the IPC". The preload method resolves to a typed
 * response for every domain outcome (it does not reject on a domain error), so there is no catch.
 */
export async function runSubmit(bridge: PairingBridge, paste: string): Promise<PairingEvent> {
  const response = await bridge.submitPairingPaste(paste)
  return response.ok
    ? { type: 'submit-succeeded', fingerprint: response.fingerprint }
    : { type: 'submit-failed', reason: response.reason }
}

/**
 * Send the bare confirm signal over the bridge and map the typed response. This is the tested
 * proof that "confirm triggers persist" (the persist itself runs entirely in main, #53/#54).
 */
export async function runConfirm(bridge: PairingBridge): Promise<PairingEvent> {
  const response = await bridge.confirmPairing()
  return response.ok
    ? { type: 'confirm-succeeded' }
    : { type: 'confirm-failed', reason: response.reason }
}

/**
 * Split the daemon's fixed 23-char fingerprint (`aa:bb:cc:dd:ee:ff:11:22`, 8 colon-separated
 * lowercase-hex byte-pairs) into its 8 verbatim groups so the view can render them as spaced
 * monospace segments. Decoration is SPATIAL ONLY: the characters, case, and order are never
 * altered — the operator compares this string byte-for-byte against what `pyry pair` printed and
 * what the phone shows, so `groups.join(':')` must equal the input.
 */
export function groupFingerprint(fingerprint: string): string[] {
  return fingerprint.split(':')
}
