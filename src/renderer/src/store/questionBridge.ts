// The renderer translation half feeding the question store: it turns the two question daemon events
// (#885 / #895) into the matching `QuestionBatchEvent`s (#898) and dispatches them into the
// app-singleton `questionBatchStore` (#899) the panel slice (#906) reads.
// `translateQuestionEvent` is the pure choke point; `useQuestionBridge` is its only production caller,
// wiring the channel into React's lifecycle. Nothing here touches keys, sockets, ipcRenderer, or raw
// frames — it only subscribes through the preload bridge and dispatches typed events.
//
// A FOURTH INDEPENDENT SUBSCRIBER on the same channel, the `announcedModelBridge` shape:
// `daemonEventBridge` owns the session arms, `timelineBridge` the stream arms and `modalBridge` the
// modal arms, each returning `null` for the two question arms PERMANENTLY — not dormant, since none
// will ever claim them. This one owns exactly those two plus `connected`, and returns `null` for
// everything else. This slice adds a bridge; it edits none of the three.
//
// UNTRUSTED TEXT, CARRIED OPAQUELY. `Question.question`, `Question.header`, and every option's `label`
// and `description` are CLAUDE-AUTHORED: they crossed the subprocess trust boundary and the daemon
// NEITHER BOUNDS NOR SANITIZES them. This module is a SHAPE boundary, not a trust boundary — the
// fail-closed decode upstream (`parseQuestionShownPayload`) made their shape trusted and nothing more,
// and `string` carries no signal for the difference. They leave here exactly as untrusted as they
// arrived. This module never inspects, parses, truncates, logs or keys on them, and the RENDER slice
// owes the escaping: plain text only, never HTML (no innerHTML / dangerouslySetInnerHTML), never into
// an attribute, a URL, a filename, a cache key, a lookup path, or a log.
//
// NOTHING HERE LOGS, and that absence is load-bearing: `questionBatchId` is a one-time UNGUESSABLE
// nonce that must never reach a sink, and neither must the four claude-authored strings. There is no
// logger import, no `console.*` call, and no `observe?` diagnostics seam — the refusal `questionBatchStore`
// records, for the same reason: one observer hands an arbitrary consumer the nonce and the untrusted
// text together in a single line.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { questionBatchStore } from './questionBatchStore'
import type { Question, QuestionBatchEvent } from './questionBatches'

/** Compile-time exhaustiveness guard: a new DaemonEvent arm without a case is a type error. */
function assertNever(event: never): never {
  throw new Error(`Unhandled daemon event: ${JSON.stringify(event)}`)
}

/**
 * Map one typed daemon event to the `QuestionBatchEvent` it produces, or `null` when the event drives
 * no question state. Owns exactly `questionShown`, `questionDismissed` and `connected`; each result is
 * a fresh literal with named fields — not `return event`, not a spread — so the translator stays
 * immune to a `DaemonEvent` arm gaining an unrelated field later. The discriminant is renamed across
 * the boundary in all three cases (`questionShown` → `'shown'`, `questionDismissed` → `'dismissed'`,
 * `connected` → `'reconnected'`), as in `translateModalEvent`.
 *
 * THIS BRIDGE REBUILDS, WHERE `translateModalEvent` ONLY FILTERS. That translator could copy field for
 * field because the modal wire fields were already camelCase; this family has one renamed field and it
 * sits on the nested question row — `multi_select` → `multiSelect`, the nested rows otherwise crossing
 * IPC snake_case by settled house rule. The compiler enforces the split rather than leaving it to
 * care: `readonly WireQuestion[]` is not assignable to `readonly Question[]`, so the per-question
 * rebuild is forced, while `WireQuestionOption[]` IS assignable to `readonly QuestionOption[]`.
 *
 * THERE IS NO RENAME AT THE OPTION LEVEL, and inventing one is this family's easiest mistake.
 * `WireQuestionOption` and `QuestionOption` are both exactly `{ label, description }` — structurally
 * identical, no snake_case key, nothing to map — so each question's `options` passes through BY
 * REFERENCE with no cast and no copy, matching `translateModalEvent`'s `options: event.options` and
 * `reduceQuestionBatches`' own by-reference hold of `questions` one level up. A per-option copy would
 * defend a boundary that is already open above it. The two-nesting-level warning running through this
 * family is about WHERE `options` hangs (off each question, unlike `ModalShownPayload.options`), never
 * a claim that a field is renamed at both levels.
 *
 * `null` here means "not our arm", NEVER "bad data": a malformed frame is rejected upstream, where
 * `parseQuestionShownPayload` throws inside `daemonConnection`'s decode guard and no event is emitted
 * at all. That same narrower is why the `.map` below is total — it fail-closes element-wise through
 * `parseQuestion`, so `questions` is always an array of rows carrying `options` and `multi_select`.
 *
 * Every other arm returns `null` via explicit fall-through cases, then `assertNever` — deliberately
 * NOT a catch-all `default: return null`, which would silently swallow a future arm. That is
 * `modalBridge`'s form and deliberately not `announcedModelBridge`'s, even though this bridge shares
 * the latter's independent-subscriber posture: the guard is load-bearing here, so a new `DaemonEvent`
 * arm is a compile error in this file until it is given a mapping.
 */
export function translateQuestionEvent(event: DaemonEvent): QuestionBatchEvent | null {
  switch (event.type) {
    case 'questionShown': {
      // Rebuilt per row by name. `multiSelect` is the family's ONE renamed field; `options` is the
      // held wire array itself, never a copy (see the docblock).
      const questions: readonly Question[] = event.questions.map((question) => ({
        question: question.question,
        header: question.header,
        options: question.options,
        multiSelect: question.multi_select
      }))
      return {
        type: 'shown',
        conversationId: event.conversationId,
        questionBatchId: event.questionBatchId,
        questions
      }
    }
    case 'questionDismissed':
      // `outcome` and `source` are carried through though `reduceQuestionBatches` consults neither —
      // only `questionBatchId` drives the clear — matching the model's `dismissed` arm. `source` is an
      // OPAQUE open string, deliberately not `WireModalSource`: that closed `{remote, local, timeout}`
      // set has no member the producer emits, so closing it would reject the only traffic there is.
      // Carrying the field without reading it is what satisfies the fail-closed reading rule here — an
      // unrecognised value means RESOLVED, CAUSE UNKNOWN, and never an answer.
      return {
        type: 'dismissed',
        questionBatchId: event.questionBatchId,
        outcome: event.outcome,
        source: event.source
      }
    case 'connected':
      // Every supervisor (re)handshake re-emits `connected`. Flip it to the payload-free reset that
      // clears the outstanding batches, so the daemon's connect-time re-send is the sole repopulation
      // truth for the new connection (the #415 call, made the same way in `translateModalEvent`).
      // Ignores `event.ack` — the reset needs no field off it.
      return { type: 'reconnected' }
    case 'connecting':
    case 'disconnected':
    case 'failed':
    case 'messageReceived':
    case 'messagesReceived':
    case 'debugBundleProgress':
    case 'debugBundleSaved':
    case 'debugBundleFailed':
    case 'assistantDelta':
    case 'turnEnd':
    case 'turnState':
    case 'toolUse':
    case 'toolResult':
    case 'conversationsReceived':
    case 'conversationCreated':
    case 'conversationUpdated':
    case 'conversationDeleted':
    case 'recentWorkspacesReceived':
    case 'workspaceFolderCreated':
    case 'workspaceFolderRejected':
    case 'sessionTransition':
    case 'sessionSettingsUpdated':
    case 'sessionSettingsRejected':
    case 'queueState':
    case 'stallDetected':
    case 'relayLinkChanged':
    case 'notificationActivated':
    case 'apiRetry':
    case 'compacting':
    case 'unrecognizedMessage':
    case 'backgroundTaskStarted':
    case 'backgroundTaskUpdated':
    case 'backgroundTaskRoster':
    case 'modelAnnounced':
    case 'runConfigReceived':
    case 'modalShown':
    case 'modalDismissed':
    case 'modalAnswerRejected':
      // No question event. The session store, timeline store, conversation-list store, queue store,
      // relay-link store, background-task store, announced-model store and the modal store consume
      // these — not the question store.
      //
      // The three MODAL arms are the ones to be deliberate about, because a reader arriving from that
      // family is most tempted to route them here: a modal is a PERMISSION PROMPT gating an action
      // claude wants to take, resolved by `modal_answer` against `modal_id` under first-answer-wins,
      // whereas a question batch is claude asking the operator to CHOOSE — its own nonce, its own
      // outstanding-batch state daemon-side, its own stepped panel, and as yet no answer frame in the
      // daemon contract at all. `modalDismissed` in particular is not this family's `questionDismissed`
      // twin: the two retire different things against different keys. Their no-op here is PERMANENT
      // and mirrors `modalBridge`'s permanent no-op for the two question arms.
      return null
    default:
      return assertNever(event)
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each owned arm translates to a `QuestionBatchEvent` and
 * is dispatched, every other arm no-ops. Returns the exact unsubscribe handle from `onDaemonEvent`
 * (the `subscribeModal` idiom) so the React binding can use it as its effect cleanup — the handle
 * itself, never a wrapper, which is what makes the double-mount guarantee below hold. Injecting
 * `onDaemonEvent` + `dispatch` keeps it React-free and unit-testable with plain spies, and it grants
 * no authority: a caller must already hold a write path to pass one in. The listener only translates +
 * dispatches — it never throws into React.
 */
export function subscribeQuestionBatches(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  dispatch: (event: QuestionBatchEvent) => void
): () => void {
  return onDaemonEvent((event) => {
    const questionEvent = translateQuestionEvent(event)
    if (questionEvent) dispatch(questionEvent)
  })
}

/**
 * Wire the daemon-event channel into the app-singleton question store for the lifetime of the mounting
 * component. Subscribes on mount and returns `subscribeQuestionBatches`' off handle as the effect
 * cleanup, so a StrictMode double-mount runs mount → cleanup → mount and nets exactly one live
 * listener — mirroring `useModalBridge`. `window.pyry` is dereferenced only inside the effect, never
 * during render.
 *
 * MOUNTED APP-LEVEL BY #906, beside `useModalBridge` — unconditional and for the app's lifetime, so a
 * batch raised against a conversation the operator is not looking at still lands in the store. It shipped
 * dormant here, the way #223 left `useModalBridge` unmounted for #224; #906 is the slice that mounts it.
 */
export function useQuestionBridge(): void {
  useEffect(
    () =>
      subscribeQuestionBatches(window.pyry.onDaemonEvent, (event) =>
        questionBatchStore.getState().dispatch(event)
      ),
    []
  )
}
