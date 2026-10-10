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
// IT NOW FEEDS TWO STORES OVER THE SAME ONE SUBSCRIPTION (#911). `questionPicksStore` holds what the
// OPERATOR has picked so far and must be cleared exactly when a batch is, so `translateQuestionPickEvent`
// re-shapes the two clearing arms of the already-translated `QuestionBatchEvent` and
// `subscribeQuestionBatches` dispatches both. Deliberately NOT a fifth listener on the channel: the
// subscriber count is a considered number, and a second listener would also leave the two stores' clear
// ordering to registration order rather than to one explicit line.
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
import { questionPicksStore, type QuestionPickEvent } from './questionPicksStore'

/** Compile-time exhaustiveness guard: a new DaemonEvent arm without a case is a type error. */
function assertNever(event: never): never {
  throw new Error(`Unhandled daemon event: ${JSON.stringify(event)}`)
}

/**
 * The same guard for `translateQuestionPickEvent`'s three-arm switch — a SEPARATE function, and
 * deliberately not the one above.
 *
 * The message is CONTENT-FREE where `assertNever`'s interpolates, and that is a security-review
 * finding rather than a style split. `JSON.stringify` of a `QuestionBatchEvent` is `questionBatchId`
 * (a one-time unguessable nonce) plus the four claude-authored strings, and an `Error` message is a
 * sink: it reaches a stack trace, a crash reporter, and anything that catches and logs. The arm is
 * compile-time unreachable, so the interpolation buys nothing the crash site's own stack does not
 * already give. `assertNever` above is left exactly as it is — sweeping it would be refactoring
 * adjacent code.
 */
function assertNoPickArm(_event: never): never {
  throw new Error('Unhandled question batch event')
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
    case 'sessionStateCleared':
    case 'threadUpdate':
    case 'threadRepairNeeded':
      return null // The daemon-built thread consumer owns these additive events.
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
    case 'modelRefusalFallback':
    case 'modelRefusalNoFallback':
    case 'toolDenied':
    case 'toolResult':
    case 'conversationsReceived':
    case 'conversationCreated':
    case 'conversationUpdated':
    case 'conversationDeleted':
    case 'recentWorkspacesReceived':
    case 'workspaceFolderCreated':
    case 'workspaceFolderRejected':
    case 'conversationCreateRejected':
    case 'switchAgentRejected':
    case 'workspaceRenameResult':
    case 'conversationMuteResult':
    case 'workspaceUpdated':
    case 'sessionTransition':
    case 'sessionSettingsUpdated':
    case 'sessionSettingsRejected':
    case 'queueState':
    case 'stallDetected':
    case 'relayLinkChanged':
    case 'notificationActivated':
    case 'apiRetry':
    case 'banner':
    case 'compactionBoundary':
    case 'compacting':
    case 'unrecognizedMessage':
    case 'backgroundTaskStarted':
    case 'backgroundTaskUpdated':
    case 'backgroundTaskRoster':
    case 'backgroundTaskProgress':
    case 'replySuggestion': // Transient composer state; exclude text from exhaustive errors.
    case 'sessionFacts': // Informational only; the session-facts bridge owns retention.
    case 'mcpStatus': // Informational only; the MCP status bridge owns retention.
    case 'mcpStatusRequestRejected': // The channel info sheet's notice owns this (#1579).
    case 'mcpReconnectRejected': // The channel info sheet's Reconnect control owns this (#1582).
    case 'mcpToggleRejected': // The channel info sheet's on/off switch owns this (#1586).
    case 'backgroundTaskStopRejected': // The Stop task button owns this (#1770).
    case 'modelAnnounced':
    case 'runConfigReceived':
    case 'modalShown':
    case 'modalDismissed':
    case 'modalAnswerRejected':
    case 'slashCommandList':
    case 'modelList':
    case 'historyPageReceived':
    case 'historyRequestFailed':
    case 'thinkingProgress':
    case 'toolProgress':
    case 'rateLimited':
    case 'contextUsage':
    case 'resetting':
    case 'attachmentOffered':
      // No question event. The session store, timeline store, conversation-list store, queue store,
      // relay-link store, background-task store, announced-model store and the modal store consume
      // these — not the question store. `conversationCreateRejected` (#1307) is the newest member and
      // has no store at all yet: its consumer is #1308's Add workspace dialog, so its no-op here is
      // DORMANT rather than permanent, and a refused chat-create is not an ask under any reading.
      //
      // The three MODAL arms are the ones to be deliberate about, because a reader arriving from that
      // family is most tempted to route them here: a modal is a PERMISSION PROMPT gating an action
      // claude wants to take, resolved by `modal_answer` against `modal_id` under first-answer-wins,
      // whereas a question batch is claude asking the operator to CHOOSE — its own nonce, its own
      // outstanding-batch state daemon-side, its own stepped panel, and as yet no answer frame in the
      // daemon contract at all. `modalDismissed` in particular is not this family's `questionDismissed`
      // twin: the two retire different things against different keys. Their no-op here is PERMANENT
      // and mirrors `modalBridge`'s permanent no-op for the two question arms.
      //
      // `slashCommandList` (#937) is not an ask either, and reads least like one in this group: it
      // publishes the vocabulary of verbs claude will ACCEPT, unsolicited, with nothing outstanding and
      // no answer to give — the opposite direction from claude asking the operator to choose. Its
      // consumer is the #938 store, and its no-op is DORMANT rather than permanent.
      //
      // `modelList` (#973) joins it on identical grounds — the same `initialize` control reply, the same
      // unsolicited direction, nothing outstanding and no answer to give; it publishes the IDENTITIES
      // claude will accept where its sibling publishes the VERBS. The one difference is the disposition:
      // its no-op here is PERMANENT, because #974 commits to a dedicated subscriber rather than leaving
      // the choice open.
      //
      // The two HISTORY arms (#1222) are the least ask-like members of the group, and no store consumes
      // either yet. A page is a REPLAY of what already happened — entries this app asked for, answering
      // its own request — where a question batch is claude asking the operator to choose next; a page
      // can even CARRY a stored question frame among its entries without being one, which is exactly
      // the confusion to avoid. Their consumers are #1223's timeline reduction and #1224's walk, so the
      // no-op is PERMANENT here: nothing in the question family will ever claim them.
      //
      // `thinkingProgress` (#1313) joins the `slashCommandList` / `modelList` reading of this group
      // rather than the history one: it is UNSOLICITED, arrives with nothing outstanding and offers no
      // answer to give — the opposite direction from claude asking the operator to choose. It reports
      // that claude is thinking, which is as close as this union gets to "an ask is coming" without
      // being one. Its consumer is the #1314 render slice, so the no-op is PERMANENT.
      //
      // `rateLimited` (#1319) reads this group the same way and is if anything further from an ask:
      // it is UNSOLICITED, arrives with nothing outstanding, offers no answer to give, and reports a
      // condition of the ACCOUNT rather than anything claude wants from the operator. It is the one
      // arm here that can look like a question in the wrong light — a "you are near your limit" report
      // invites a prompt — but the daemon settles it: the frame is a REPORT, never a control input,
      // and no behaviour may branch on it. Its consumer is the #1320 store slice, so the no-op is
      // PERMANENT.
      //
      // `contextUsage` (#1419) reads the group the same way: UNSOLICITED, arriving with nothing
      // outstanding and offering no answer to give. The daemon fans it out after every turn end, so it
      // is the arm here that is furthest from an ask — it reports a condition of the WINDOW rather
      // than anything claude wants from the operator, and the frame is a REPORT, never a control
      // input. Its consumer is the #1420 store slice, so the no-op is PERMANENT.
      //
      // `resetting` (#1515) closes the group and is the only member of it that is not a reading — it
      // carries a rising and a falling edge — but it lands on the same terms and needs the least
      // argument of any arm here: UNSOLICITED, arriving with nothing outstanding, offering no answer
      // to give, and reporting what the DAEMON is doing to a session rather than anything claude
      // wants from the operator. It is the opposite direction from claude asking the operator to
      // choose. The frame is a REPORT, never a control input, and nothing may branch on either of its
      // tokens. Its consumers are the #1516 channel-list dot and the #1517 composer status row, so
      // the no-op is PERMANENT.
      //
      // `attachmentOffered` (#1620) is unsolicited and offers no answer to give. Its consumer is the
      // #1621 thread row, so the no-op is PERMANENT. The case keeps the claude-authored filename out of
      // assertNever's Error message.
      return null
    case 'systemPromptWriteConfirmed':
    case 'systemPromptWriteRejected':
      // No question event (#1249) — the write half's two outcomes, the read arm's counterpart directly
      // below. The transport owns the send, the byte bound, the correlation and the two settle paths;
      // the store that holds a write's outcome is #1250's, in the read arm's posture, and the editor
      // surface is #1078. So these arms are DORMANT rather than permanently no-op — but nothing in
      // THIS file is waiting to claim them. Two arms, not one: the confirmation and the refusal are
      // separate members, and a `default` covering either would defeat the guard below.
      //
      // Present for the assertNever guard, and that guard is not a formality here even though neither
      // member carries a prompt byte — the ack record does not carry the prompt back and the refusal
      // echoes no supplied byte. What they carry is `conversationId`, a routing key that reaches no
      // other sink on any path, and `reason`, a client-owned literal. A missing case would put the
      // former into an Error message, a stack trace and a crash reporter. These cases keep it out.
      return null
    case 'hostSystemPromptReceived':
    case 'hostSystemPromptFailed':
    case 'systemPromptReceived':
      // No question event (#1230). The transport owns the ask, the correlation and the decode; the store that
      // holds a conversation's system prompt is #1231's, in the announcedModelBridge /
      // historyPageBridge posture, and the editor surface is #1078. So this arm is DORMANT rather
      // than permanently no-op — but nothing in THIS file is waiting to claim it.
      //
      // Present for the assertNever guard, and that guard is NOT a formality here: it stringifies the
      // WHOLE event into an Error message, and `systemPrompt` is untrusted operator-authored text that
      // reaches no other sink on any path — not the decode's content-free log line, not the
      // decode-failure catch (which drops its caught error), not emitDaemonEvent. A missing case would
      // be the ONE route by which it lands in an Error message, a stack trace and a crash reporter.
      // This case is what keeps it out.
      return null
    case 'messageDelivery': return null
    case 'sessionError':
      return null // Owned by the conversation timeline, never an error diagnostic here.
    default:
      return assertNever(event)
  }
}

/**
 * Map one ALREADY-TRANSLATED `QuestionBatchEvent` to the `QuestionPickEvent` it produces, or `null`
 * when it drives no pick state (#911). Owns the two CLEARING arms and nothing else.
 *
 * IT TAKES A `QuestionBatchEvent`, NOT A `DaemonEvent`, and that is the point: `translateQuestionEvent`
 * stays this family's single reader of the daemon union, so this switch covers three arms rather than
 * forty-one and a new `DaemonEvent` arm is a compile error in exactly one place.
 *
 * THE LITERAL IS REBUILT BY NAME, AND `return event` WOULD COMPILE. `QuestionBatchEvent`'s dismissed
 * arm is structurally ASSIGNABLE to `QuestionPickEvent`'s — excess-property checking does not apply to
 * a narrowed variable — so returning the event itself typechecks clean while silently carrying
 * `outcome` and `source` into a store that must never hold them. The spec asserts the key set, which
 * is the only guard.
 *
 * `shown` maps to `null`: THERE IS NO `shown` ARM in the picks store. A batch's picks come into being
 * on the operator's first pick, so an untouched batch holds nothing and this store never mirrors the
 * held batch's arrival. `reconnected` covers the daemon's connect-time re-send, so a re-shown batch
 * cannot inherit picks across a reconnect.
 */
export function translateQuestionPickEvent(event: QuestionBatchEvent): QuestionPickEvent | null {
  switch (event.type) {
    case 'dismissed':
      // Only the id crosses. `outcome` and `source` are dropped deliberately: the picks store clears
      // on ANY dismissal regardless of cause, which is what satisfies the fail-closed reading rule at
      // that layer — an unrecognised `source` means RESOLVED, CAUSE UNKNOWN, and never an answer.
      return { type: 'dismissed', questionBatchId: event.questionBatchId }
    case 'reconnected':
      return { type: 'reconnected' }
    case 'shown':
      return null
    default:
      return assertNoPickArm(event)
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each owned arm translates to a `QuestionBatchEvent` and
 * is dispatched, every other arm no-ops. Returns the exact unsubscribe handle from `onDaemonEvent`
 * (the `subscribeModal` idiom) so the React binding can use it as its effect cleanup — the handle
 * itself, never a wrapper, which is what makes the double-mount guarantee below hold. Injecting
 * `onDaemonEvent` + the two dispatches keeps it React-free and unit-testable with plain spies, and it
 * grants no authority: a caller must already hold a write path to pass one in. The listener only
 * translates + dispatches — it never throws into React.
 *
 * ONE CHANNEL SUBSCRIPTION FANNING OUT TO TWO STORES (#911), never a fifth listener: the bridge's own
 * docblock above records why the subscriber count is a considered number. `dispatchPicks` is REQUIRED
 * rather than optional so `tsc` enforces that every caller wires both stores; there is exactly one
 * production caller, immediately below.
 *
 * THE PICKS DISPATCH RUNS FIRST, and the order is load-bearing. Both run in the same synchronous
 * listener turn, but zustand notifies subscribers synchronously inside `setState`, so whichever store
 * is written first has already woken every subscriber before the second write happens. Picks-first
 * makes the intermediate state "batch still held, picks already cleared" — indistinguishable from an
 * untouched batch, and therefore always coherent. Batch-first would expose "batch gone, picks still
 * held": a stale pick outliving its batch at an observable instant, which is precisely what the picks
 * store exists to prevent. The spec pins the order rather than leaving it to care.
 */
export function subscribeQuestionBatches(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  dispatch: (event: QuestionBatchEvent) => void,
  dispatchPicks: (event: QuestionPickEvent) => void
): () => void {
  return onDaemonEvent((event) => {
    const questionEvent = translateQuestionEvent(event)
    if (!questionEvent) return
    const pickEvent = translateQuestionPickEvent(questionEvent)
    if (pickEvent) dispatchPicks(pickEvent)
    dispatch(questionEvent)
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
 *
 * The signature is unchanged by #911's second store, so `App.tsx` is untouched: both dispatches are
 * threaded through the ONE existing subscription above.
 */
export function useQuestionBridge(): void {
  useEffect(
    () =>
      subscribeQuestionBatches(
        window.pyry.onDaemonEvent,
        (event) => questionBatchStore.getState().dispatch(event),
        (event) => questionPicksStore.getState().dispatch(event)
      ),
    []
  )
}
