import type { StoreApi } from 'zustand/vanilla'
import { selectStatusFor, type SessionStore } from '../../store/sessionStore'
import { selectRelayLinkStatusFor, type RelayLinkStore } from '../../store/relayLinkStore'
// The pairing screen's state machine, IPC effect-runners, and fingerprint formatter — all
// testable without a DOM, so they run in the `node` vitest environment with no DOM ceremony and
// are the single tested seam for AC5 (paste→submit invokes the IPC; confirm triggers persist;
// cancel discards; a validation error is surfaced). The React screen (PairingScreen.tsx) is
// thin glue over these, mirroring the sessionStore (pure) / ConversationScreen (React) split.
//
// Renderer-only: it consumes the existing typed pairing IPC channel (#54) through an injected
// bridge and never touches a token, server key, socket, or raw byte — those live in the
// background process (ADR 0002; CLAUDE.md "keep the transport out of the window"). The only
// values returned by the bridge are the fingerprint, saved host identity and value-free errors.
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
 * lives on `editing`; post-save states hold only the saved identity and classified failure.
 * `paired` is terminal and carries no record.
 *
 * `label` (#825) rides the same four phases as `paste`, and for the same structural reason: it is
 * typed on the paste phase but sent two phases later, on confirm. It is NOT a secret — it is the
 * operator's display name for the host, bound for the host-label store (#822) — but it does have to
 * survive `submit-failed` / `confirm-failed` so a retry does not make the operator retype it, and
 * it has to die with the paste on `cancel` (AC4), which `initialPairingState` gives for free.
 *
 * OPTIONAL, not `label: string` defaulting to '': it mirrors PairingRequest's own `label?: string`
 * exactly, so state and contract agree that "no label" is an ABSENT KEY. The two representations
 * ('' vs undefined) never diverge because exactly one place decides whether a label exists —
 * hostLabelToSend below, which has to collapse whitespace-only to nothing regardless.
 */
export type PairingState =
  | { phase: 'editing'; paste: string; label?: string; error: PairingErrorReason | null }
  | { phase: 'submitting'; paste: string; label?: string }
  | { phase: 'reviewing'; paste: string; label?: string; fingerprint: string }
  | { phase: 'confirming'; paste: string; label?: string; fingerprint: string }
  | { phase: 'verifying'; serverId: string }
  | { phase: 'verification-failed'; serverId: string; reason: VerificationFailure }
  | { phase: 'paired' }

/**
 * State transitions. Sealed discriminated union on `type`: the two user intents (submit,
 * confirm, cancel, paste-changed) and the four IPC outcomes the effect-runners produce.
 */
export type PairingEvent =
  | { type: 'paste-changed'; paste: string }
  | { type: 'label-changed'; label: string }
  | { type: 'submit' }
  | { type: 'submit-succeeded'; fingerprint: string }
  | { type: 'submit-failed'; reason: PairingErrorReason }
  | { type: 'confirm' }
  | { type: 'confirm-succeeded'; serverId: string }
  | { type: 'authenticated' }
  | { type: 'verification-failed'; reason: VerificationFailure }
  | { type: 'retry' }
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
        ? { phase: 'editing', paste: event.paste, label: state.label, error: null }
        : state
    // Deliberately does NOT clear `error`, unlike paste-changed above: editing the pairing code
    // invalidates the complaint about that code, while typing a host name says nothing about it —
    // wiping the operator's only feedback on an unrelated keystroke would be a regression. The raw
    // typed text is stored verbatim; trimming here would fight the controlled input, since the
    // trimmed value round-trips straight back into `value` and a space could never be typed.
    case 'label-changed':
      return state.phase === 'editing' ? { ...state, label: event.label } : state
    case 'submit':
      return state.phase === 'editing'
        ? { phase: 'submitting', paste: state.paste, label: state.label }
        : state
    case 'submit-succeeded':
      return state.phase === 'submitting'
        ? {
            phase: 'reviewing',
            paste: state.paste,
            label: state.label,
            fingerprint: event.fingerprint
          }
        : state
    case 'submit-failed':
      return state.phase === 'submitting'
        ? { phase: 'editing', paste: state.paste, label: state.label, error: event.reason }
        : state
    case 'confirm':
      return state.phase === 'reviewing'
        ? {
            phase: 'confirming',
            paste: state.paste,
            label: state.label,
            fingerprint: state.fingerprint
          }
        : state
    case 'confirm-succeeded':
      return state.phase === 'confirming' ? { phase: 'verifying', serverId: event.serverId } : state
    case 'authenticated':
      return state.phase === 'verifying' ? { phase: 'paired' } : state
    case 'verification-failed':
      return state.phase === 'verifying' ? { ...state, phase: 'verification-failed', reason: event.reason } : state
    case 'retry':
      return state.phase === 'verification-failed' &&
        (state.reason === 'timeout' || state.reason === 'daemon-absent')
        ? { phase: 'verifying', serverId: state.serverId } : state
    case 'confirm-failed':
      return state.phase === 'confirming'
        ? { phase: 'editing', paste: state.paste, label: state.label, error: event.reason }
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
  confirmPairing(label?: string): Promise<PairingConfirmResponse>
}

/**
 * Submit the paste over the bridge and map the typed response to the reducer event it produces.
 * This is the tested proof that "submit invokes the IPC". Total by contract — it never rejects
 * (#513): the preload method resolves to a typed response for every DOMAIN outcome, but the invoke
 * itself can still reject at the infrastructure level (handler absent or already unregistered on
 * will-quit, an invoke racing registration, a non-serializable reply), which the catch coerces to
 * `submit-failed` / `malformed-request` — the same event the handler's own guard produces, so the
 * screen returns to `editing` with the paste intact instead of wedging in `submitting` with every
 * control (Cancel included) disabled. The caught value is deliberately discarded unbound: nothing
 * from a main-process error reaches renderer state, the UI, or the console (mirrors runUnpair).
 */
export async function runSubmit(bridge: PairingBridge, paste: string): Promise<PairingEvent> {
  let response: PairingSubmitResponse
  try {
    // Only the bridge call is guarded — a malformed response is a contract violation, not an
    // infrastructure hiccup, so the mapping below must still throw rather than read "try again".
    response = await bridge.submitPairingPaste(paste)
  } catch {
    return { type: 'submit-failed', reason: 'malformed-request' }
  }

  return response.ok
    ? { type: 'submit-succeeded', fingerprint: response.fingerprint }
    : { type: 'submit-failed', reason: response.reason }
}

/**
 * The one place that decides whether a host label EXISTS (#825): the raw typed text trimmed of
 * surrounding whitespace, or `undefined` when it is absent or trims away to nothing.
 *
 * The empty-string collapse is load-bearing, not cosmetic. The preload omits the `label` key
 * entirely for `undefined` and includes it for everything else (preload/index.ts:67-71), and main
 * saves whatever is present verbatim, `''` included (pairingHandler.ts:101-128) — so without this,
 * clearing the field would store an empty name rather than no name. Trimming can only shorten, so a
 * value that passed the input's MAX_HOST_LABEL_LENGTH bound cannot exceed the IPC guard's.
 *
 * Module-private: runConfirm is the tested seam, and a second exported entry point would invite a
 * caller that normalises without sending.
 */
function hostLabelToSend(label: string | undefined): string | undefined {
  const trimmed = label?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/**
 * Send the confirm signal over the bridge — carrying no record, at most the operator's display
 * label for the host (#823/#825) — and map the typed response. This is the tested proof that
 * "confirm triggers persist" (the persist itself runs entirely in main, #53/#54). Total by
 * contract, exactly as runSubmit: a rejected invoke resolves to `confirm-failed` /
 * `malformed-request` with the caught value discarded unbound (#513).
 *
 * `label` is optional, so the pre-#825 zero-argument call sites and fakes stay assignable and
 * unchanged. Passing an explicit `undefined` is indistinguishable from passing nothing at the
 * preload, which branches on `label === undefined`.
 */
export async function runConfirm(bridge: PairingBridge, label?: string): Promise<PairingEvent> {
  let response: PairingConfirmResponse
  try {
    response = await bridge.confirmPairing(hostLabelToSend(label))
  } catch {
    return { type: 'confirm-failed', reason: 'malformed-request' }
  }

  return response.ok
    ? { type: 'confirm-succeeded', serverId: response.serverId }
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


type VerificationFailure = 'timeout' | 'daemon-absent' | 'pairing-rejected' | 'authentication-failed'

/** Observe before confirm: a fresh host status can precede the save response. */
export function createPairingVerification(
  sessions: Pick<StoreApi<SessionStore>, 'getState' | 'subscribe'>,
  relay: Pick<StoreApi<RelayLinkStore>, 'getState' | 'subscribe'>,
  report: (event: PairingEvent) => void
) {
  const baseline = sessions.getState().statuses
  let serverId: string | undefined
  let active = false
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let ignoredAbsence = false
  let deadline = 0
  const clearTimer = (): void => { clearTimeout(timer); timer = undefined }
  const settle = (event: PairingEvent): void => {
    if (!active || disposed) return
    active = false
    clearTimer()
    if (event.type === 'authenticated') cancel()
    report(event)
  }
  const inspect = (): void => {
    if (!active || disposed || serverId === undefined) return
    if (Date.now() >= deadline) {
      settle({ type: 'verification-failed', reason: 'timeout' })
      return
    }
    const status = selectStatusFor(serverId)(sessions.getState())
    if (status !== baseline.get(serverId)) {
      if (status?.type === 'connected') { settle({ type: 'authenticated' }); return }
      if (status?.type === 'error') {
        const code = status.error.code
        if (code === 'pairing-rejected' || code === 'handshake-read-failed' ||
          code === 'malformed-hello-ack' || code === 'transport-decrypt-failed' || code.startsWith('auth.')) {
          settle({ type: 'verification-failed', reason:
            code === 'pairing-rejected' ? 'pairing-rejected' : 'authentication-failed' })
          return
        }
      }
    }
    const absent = selectRelayLinkStatusFor(serverId)(relay.getState()) === 'daemon-absent'
    if (!absent) ignoredAbsence = false
    if (absent && !ignoredAbsence) settle({ type: 'verification-failed', reason: 'daemon-absent' })
  }
  const stopSession = sessions.subscribe(inspect)
  const stopRelay = relay.subscribe(inspect)
  function cancel(): void {
    disposed = true
    active = false
    clearTimer()
    stopSession()
    stopRelay()
  }
  const start = (): void => {
    if (disposed || active || serverId === undefined) return
    active = true
    deadline = Date.now() + 30_000
    timer = setTimeout(() => settle({ type: 'verification-failed', reason: 'timeout' }), 30_000)
    inspect()
  }
  return {
    saved(id: string): void { if (serverId !== undefined || disposed) return; serverId = id; start() },
    retry(): void {
      // A held absence is feedback from the last wait, not a new failed attempt.
      ignoredAbsence = true
      start()
    },
    cancel
  }
}
