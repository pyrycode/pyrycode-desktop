// The modal-resolution effects — framework-free and React-free, co-located with the screen and
// mirroring composerSend.ts's submitMessage: the two effects (the guarded outbound command + the
// local `dismissed` dispatch) are injected, so each helper is a pure, deterministic function tested
// with plain spies (no React, no store, no Electron). The PermissionModal container is thin glue over
// these. This is where the AC4 guarded-send + unconditional-clear logic lives so it is unit-testable
// under the `node` test environment (the view cannot be — no DOM to fire clicks).
import { answerModalCommand, cancelModalCommand, type RendererCommand } from '@shared/ipc/commands'
import type { ModalEvent, ModalOption, ModalPrompt } from '../../store/modalPrompts'

/**
 * The `outcome` a cancel records on the local `dismissed` event. The reduce ignores `outcome` (it
 * clears on `modalId` alone), so the value is a forward carry for #227's resolution toast; it matches
 * the daemon's own `OutcomeCancelled` wire vocabulary (pyrycode #727 / #701) so #227 can reconcile the
 * local-optimistic and daemon-sent dismissals under one vocabulary. An answer records the chosen
 * `option_id` as its outcome instead.
 */
export const MODAL_CANCEL_OUTCOME = 'cancelled'

/**
 * The two effects answerPrompt / cancelPrompt perform, injected so the helpers stay pure and
 * deterministic in tests. `sendCommand` is `window.pyry.sendCommand` in the container; `dispatch` is
 * the modalStore's `dispatch`.
 */
export interface ModalResolveDeps {
  sendCommand: (command: RendererCommand) => void
  dispatch: (event: ModalEvent) => void
}

/**
 * Answer an outstanding prompt with the chosen option, then clear it locally (optimistic). The
 * camelCase → snake_case rename to the wire vocabulary (`modalId`/`optionId` → `modal_id`/`option_id`)
 * happens HERE, at the dispatch site — the store's untrusted camelCase and the wire vocabulary stay
 * apart. The send is guarded (AC4): a bridge failure is swallowed, never propagated. The `dispatch` is
 * OUTSIDE the try, so a send-bridge throw never prevents the local clear — the prompt always clears on
 * a click, exactly like submitMessage's optimistic echo. The `answer_token` is minted MAIN-side
 * (#236, daemonConnection.answerModal); only explicit confirmed consent adds `always_allow: true`.
 */
export function answerPrompt(modalId: string, optionId: string, deps: ModalResolveDeps, alwaysAllow = false): void {
  try {
    logResolution(alwaysAllow ? 'session-grant-requested' : 'answer-requested')
    deps.sendCommand(answerModalCommand({ modal_id: modalId, option_id: optionId,
      ...(alwaysAllow ? { always_allow: true } : {}) }))
  } catch {
    // AC4: a send-bridge failure must not crash the window. The local clear still posts.
    logResolution('answer-send-failed')
  }

  deps.dispatch({ type: 'dismissed', modalId, outcome: optionId, source: 'local' })
}

function logResolution(code: 'session-grant-requested' | 'answer-requested' | 'answer-send-failed'
  | 'cancel-requested' | 'cancel-send-failed'): void {
  if (typeof window !== 'undefined') window.pyry?.sendDiagnostic?.({ event: 'permission-response', code })
}

/** Consent belongs to a continuous offer, not just matching text or a reused request id. */
export function hasSessionPermission(prompt: ModalPrompt | undefined, opted: ModalPrompt | null): boolean {
  return !!prompt && !!opted && prompt.class === 'permission' && opted.class === 'permission'
    && prompt.modalId === opted.modalId && prompt.conversationId === opted.conversationId
    && prompt.alwaysAllow?.offered === true && prompt.alwaysAllow === opted.alwaysAllow
}

/** Only the explicit Confirm path may request a session grant; the daemon retains authority. */
export function confirmPrompt(
  prompt: ModalPrompt, pending: PendingConfirm | null, opted: ModalPrompt | null, deps: ModalResolveDeps
): void {
  const option = resolvePendingOption(prompt, pending)
  if (!option) return
  const grant = (option.id === 'allow_once' || option.id === 'allow_always') && hasSessionPermission(prompt, opted)
  answerPrompt(prompt.modalId, option.id, deps, grant)
}

/**
 * The two branches selectOption routes a just-clicked option to, injected so the gate stays pure and
 * React-free (plain-spy tested, #226 AC3). The container binds `answer` to answerPrompt (the ungated
 * straight-through send) and `requestConfirm` to the transient confirm state (hold pending a second
 * confirm). selectOption itself sends and dispatches nothing.
 */
export interface SelectOptionDeps {
  /** The default (fail-safe deny) path — resolve immediately, exactly as #237 did. */
  answer: (optionId: string) => void
  /** The deliberate-move-away path — hold the option pending a second confirm. */
  requestConfirm: (optionId: string) => void
}

/**
 * The client-side second-confirm gate (#226). There is NO machine-readable `destructive` signal on the
 * wire (`class` is `permission | trust` only, ADR 0009), so "an allow answer needs a second confirm" is
 * a pure UX policy on the answer path. The only signal available to classify "allow" is
 * `prompt.defaultOptionId` (the fail-safe deny default): any deliberate move away from it — selecting a
 * non-default option — is held pending confirm; the default resolves straight through, ungated. The
 * degenerate single-option-is-default prompt (e.g. a single-option trust prompt) routes to `answer`,
 * which is correct — the only choice IS the safe default, so nothing is gated. Sends/dispatches nothing
 * itself; it only routes to one of the two injected effects.
 */
export function selectOption(
  prompt: ModalPrompt,
  optionId: string,
  deps: SelectOptionDeps
): void {
  if (optionId === prompt.defaultOptionId) {
    deps.answer(optionId)
  } else {
    deps.requestConfirm(optionId)
  }
}

/**
 * The held second-confirm marker (#511): which option, and — the part the bare option id never carried
 * — WHICH PROMPT it was selected on. `modalId` is the daemon's per-modal nonce (a `crypto/rand` UUIDv4
 * minted once per surfaced modal at its single mint site), so it is distinct per prompt; the property
 * relied on is distinctness, not secrecy. Nothing is authorized by matching it client-side — every
 * answer is re-validated against the daemon's own registry — so this is a UI-routing key, not a
 * credential.
 */
export interface PendingConfirm {
  readonly modalId: string
  readonly optionId: string
}

/**
 * Derive the rendered prompt's held option — the confirm sub-step's input — or null for list mode
 * (#511). Total and React-free: every failure mode (no prompt, no marker, a marker from a different
 * prompt, a missing option) collapses to null, which renders the option list again and requires a
 * fresh selection — the fail-safe direction. Nothing is logged: `title` / `prompt` / option `label`
 * are daemon-supplied application content.
 *
 * Two guards, both load-bearing:
 *
 * 1. `pending.modalId === prompt.modalId` — the marker is scoped to the prompt it was selected on.
 *    This is the #511 fix. Daemon option ids are a CLOSED per-class vocabulary (`permission` →
 *    allow_once / allow_always / reject_once / reject_always, `trust` → proceed / exit), NOT
 *    per-prompt nonces, so two prompts of the same class share their entire id set — which is why the
 *    pre-#511 option-id-only lookup could never catch a swap of `outstanding[0]` and one click on
 *    Confirm could answer a prompt whose option list the user was never shown.
 * 2. The option-id lookup — RETAINED, and redemoted rather than removed: it is no longer a
 *    (never-firing) cross-prompt net but the WITHIN-prompt one, for a `shown` re-delivery that
 *    replaces the prompt in place with a changed option set, and it is how the ModalOption the
 *    confirm sentence names is obtained at all.
 *
 * Deriving on every render — rather than clearing the marker on a prompt change — means a stale marker
 * is inert instead of needing a lifecycle: it can only ever match the prompt it was minted against, so
 * the empty-`outstanding` window (`prompt === undefined`) is structurally safe, not defended. The
 * deliberate consequence: if the SAME prompt returns (a reconnect re-send of a still-outstanding
 * modal) the confirm sub-step is restored — correct, since the user did see that prompt's options and
 * did select that option on it.
 */
export function resolvePendingOption(
  prompt: ModalPrompt | undefined,
  pending: PendingConfirm | null
): ModalOption | null {
  if (!prompt || !pending || prompt.modalId !== pending.modalId) return null
  return prompt.options.find((o) => o.id === pending.optionId) ?? null
}

/**
 * Cancel an outstanding prompt, then clear it locally (optimistic). Same guarded-send + unconditional
 * local-clear shape as answerPrompt; records the MODAL_CANCEL_OUTCOME sentinel as its outcome.
 */
export function cancelPrompt(modalId: string, deps: ModalResolveDeps): void {
  try {
    logResolution('cancel-requested')
    deps.sendCommand(cancelModalCommand({ modal_id: modalId }))
  } catch {
    // AC4: a send-bridge failure must not crash the window. The local clear still posts.
    logResolution('cancel-send-failed')
  }

  deps.dispatch({ type: 'dismissed', modalId, outcome: MODAL_CANCEL_OUTCOME, source: 'local' })
}
