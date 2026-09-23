// The renderer translation half feeding the modal store: it turns the two modal daemon events (#201)
// into the matching `ModalEvent`s (#122) and dispatches them into the app-singleton `modalStore` the
// interactive render slice (#224) reads. `translateModalEvent` is the pure choke point;
// `useModalBridge` is its only production caller, wiring the channel into React's lifecycle. Nothing
// here touches keys, sockets, ipcRenderer, or raw frames — it only subscribes through the preload
// bridge and dispatches typed events.
//
// A third independent subscriber on the same channel: `daemonEventBridge` owns the session arms and
// `timelineBridge` the stream arms, each returning `null` for the two modal arms; this one owns
// exactly those two modal arms and returns `null` for everything else.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { modalStore } from './modalStore'
import type { ModalEvent } from './modalPrompts'
import {
  conversationListStore,
  selectConversationIdsFor,
  type ConversationListOrigin
} from './conversationListStore'

/** Compile-time exhaustiveness guard: a new DaemonEvent arm without a case is a type error. */
function assertNever(event: never): never {
  throw new Error(`Unhandled daemon event: ${JSON.stringify(event)}`)
}

/**
 * Read the server this event came from (#1140), off #1068's stamp.
 *
 * An `in`-guarded, `typeof`-checked access rather than a cast, and rather than re-declaring the
 * listener's parameter as `StampedDaemonEvent`: the stamp rides BESIDE the union, so at a
 * bare-`DaemonEvent`-typed hole it arrives structurally while the static type stays silent about it.
 * A COPY rather than an import of the five identical siblings (`relayLinkBridge`,
 * `conversationListBridge`, `daemonEventBridge`, `queueBridge`, `backgroundTaskRosterBridge`), for the
 * reason each of those states: taking another's would couple two deliberately independent subscribers
 * and drag this path's key domain onto that store's.
 *
 * The origin is read ONLY from the stamp, NEVER from the payload. The `connected` arm carries the
 * daemon's own `ack.server_id`, which is a DISTINCT value the daemon chose; the stamp is bound
 * main-side at construction from a paired record this client holds, so a hostile or confused daemon
 * cannot make its reconnect clear another server's outstanding permission prompts — nor drop another
 * server's suppression entries, which would re-surface a prompt that server's operator already
 * answered. Deriving it HERE rather than at the caller is what makes that unforgeable: the composition
 * root is handed an already-derived origin and never gets to choose one.
 */
function originOf(event: DaemonEvent): ConversationListOrigin {
  if (!('serverId' in event)) return undefined
  const { serverId } = event
  if (serverId === null) return null
  // The `in` guard narrows the property to `unknown`, so the type is re-established here rather than
  // asserted. A value that is neither a string nor null selects the unstamped slot: no producer can
  // emit one (`bindServerOrigin` takes a `string | null` scalar), and answering with a slot rather
  // than throwing is what keeps this total inside a daemon-event listener.
  return typeof serverId === 'string' ? serverId : undefined
}

/**
 * Map one typed daemon event to the `ModalEvent` it produces, or `null` when the event drives no
 * modal state. Owns exactly the two modal arms (`modalShown` / `modalDismissed`, #201); each is
 * reconstructed as a fresh literal with named fields — not `return event`, not a spread — so the
 * translator stays immune to a `DaemonEvent` arm gaining an unrelated field later.
 *
 * This is a filter, NOT a rename of fields: the field names are already camelCase and field-for-field
 * identical on both sides (the snake→camel decode is #201's, at the transport). The one thing that
 * changes across the boundary is the discriminant TAG — `modalShown` → `type: 'shown'`,
 * `modalDismissed` → `type: 'dismissed'` — unlike `translateTimelineEvent`, where the tag is identical
 * on both sides. Field types are structurally equal (`class: WireModalClass` → `ModalClass`,
 * `source: WireModalSource` → the inline union, `options: readonly WireModalOption[]` →
 * `readonly ModalOption[]`), so the copy compiles clean with no cast (the codebase bans unchecked
 * `as` in prod, #121). `options` passes through by reference, matching `reduceModal`'s `shown` arm.
 *
 * `conversationIdsFor` is INJECTED rather than read from a store here (#1140), and that is what keeps
 * this translator drivable with a plain stub: renderer tests in this repo are static server renders
 * (`vitest.config.ts` sets `environment: 'node'`), so a store read inside this function would be
 * untestable. It answers which conversations belong to one server; only the `connected` arm calls it.
 *
 * Every other arm returns `null` via explicit fall-through cases, then `assertNever` — deliberately
 * NOT a catch-all `default: return null`, which would silently swallow a future arm. The guard is
 * load-bearing: a new `DaemonEvent` arm is then a compile error in this bridge, `daemonEventBridge`,
 * `timelineBridge` and `questionBridge` until each decides its mapping. THERE ARE FOUR, not three —
 * `questionBridge` landed at #900, after this sentence was written, and a stale count here fails no
 * typecheck. Derive the set by grep rather than from prose: the exhaustive bridges are the ones whose
 * `DaemonEvent` switch ends in `assertNever`, not the ~20 siblings ending in `default: return null`.
 */
export function translateModalEvent(
  event: DaemonEvent,
  conversationIdsFor: (origin: ConversationListOrigin) => ReadonlySet<string>
): ModalEvent | null {
  switch (event.type) {
    case 'modalShown':
      return {
        type: 'shown',
        conversationId: event.conversationId,
        modalId: event.modalId,
        class: event.class,
        title: event.title,
        prompt: event.prompt,
        options: event.options,
        defaultOptionId: event.defaultOptionId,
        ...('reason' in event ? { reason: event.reason } : {}),
        ...('reasonType' in event ? { reasonType: event.reasonType } : {}),
        ...('blockedPath' in event ? { blockedPath: event.blockedPath } : {}),
        ...('description' in event ? { description: event.description } : {}),
        ...('defaultToNo' in event ? { defaultToNo: event.defaultToNo } : {}),
        ...('alwaysAllow' in event ? { alwaysAllow: event.alwaysAllow } : {})
      }
    case 'modalDismissed':
      return { type: 'dismissed', modalId: event.modalId, outcome: event.outcome, source: event.source }
    case 'modalAnswerRejected':
      // #249 flips the dormant #248 case: a fresh named-field literal (never `return event`, matching
      // modalShown/modalDismissed above) so the translator stays immune to the DaemonEvent arm gaining
      // an unrelated field later. The discriminant is renamed across the boundary: modalAnswerRejected
      // → 'rejected'. Content-free by construction — only the correlation nonce crosses (AC3).
      return { type: 'rejected', modalId: event.modalId }
    case 'connected':
      // #415: every supervisor (re)handshake re-emits `connected`. Flip it to the reset that clears the
      // outstanding modal slice so the daemon's connect-time re-sends are the sole repopulation truth.
      //
      // #1140 SCOPES THAT RESET to the reconnecting server, and the mapping stays a translator arm
      // rather than becoming a branch ahead of the translator: this function returns members of an
      // ACTION union, where a member gaining a field costs no widening — unlike `queueBridge` and
      // `backgroundTaskRosterBridge`, whose translators return a VALUE (a snapshot) and would have had
      // to widen to `Snapshot | 'reset' | null`. `backgroundTaskRosterBridge`'s own docblock rules this
      // bridge that way by name.
      //
      // Still ignores `event.ack` (HelloAckPayload) — and now that is load-bearing rather than
      // incidental: the ack carries the DAEMON's `server_id`, so reading it would let a confused or
      // hostile daemon name which server's prompts a reconnect clears. The origin comes from the
      // client-bound stamp via `originOf`, and turning it into conversation ids is the caller's job.
      return { type: 'reconnected', conversationIds: conversationIdsFor(originOf(event)) }
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
    case 'workspaceRenameResult':
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
    case 'sessionFacts': // Informational only; the session-facts bridge owns retention.
    case 'mcpStatus': // Informational only; the MCP status bridge owns retention.
    case 'mcpStatusRequestRejected': // The channel info sheet's notice owns this (#1579).
    case 'mcpReconnectRejected': // The channel info sheet's Reconnect control owns this (#1582).
    case 'mcpToggleRejected': // The channel info sheet's on/off switch owns this (#1586).
    case 'modelAnnounced':
    case 'questionShown':
    case 'questionDismissed':
    case 'thinkingProgress':
    case 'toolProgress':
    case 'rateLimited':
    case 'contextUsage':
    case 'resetting':
      // No modal event: the session store (#19), download UI (#72), conversation-list store (#208),
      // timeline store (#202), create render slice (#242), the #259 session-id holder, the #261 /
      // #256 session-settings consumers (confirmed + rejected #269), the #293 queue store
      // (queueState), the #317 stall-render slice (stallDetected), the #329 relay-link store
      // (relayLinkChanged), the #376 list-reflect slice (conversationDeleted), the #382
      // recent-workspaces store (recentWorkspacesReceived), the #157 Create-folder dialog
      // (workspaceFolderCreated), the #397 round-trip store (workspaceFolderRejected), the #1308 Add
      // workspace dialog (conversationCreateRejected — dormant, no consumer built yet), and the #393
      // notificationActivatedBridge (notificationActivated → the paired `open` nav) consume these —
      // not the modal store. A refused chat-create is not a permission prompt: nothing daemon-side is
      // waiting on an answer, so its no-op here is not a routing accident. apiRetry (#492) ships dormant; its render consumer is #493 — a retry
      // status line is not a modal.
      // compacting (#495) ships dormant likewise; its render consumer is #496 — a compaction banner is
      // not a modal either. unrecognizedMessage ships dormant too; its render consumer is the timeline
      // row — a diagnostic the operator reads at leisure is emphatically not a modal, since nothing is
      // waiting on an answer. backgroundTaskStarted (#564) ships dormant likewise; its consumer is the
      // #567 background-task store — a task claude left running is not a modal either, for the same
      // reason: nothing is waiting on an answer. backgroundTaskUpdated (#565) joins it on both counts:
      // same dormant #567 consumer, and a change to a task claude left running is no more a modal than
      // its opening was. backgroundTaskRoster (#566) closes the family on the same terms: same dormant
      // #567 consumer, and a snapshot of what claude left running is not a modal either — nothing is
      // waiting on an answer, not even when the roster is empty. modelAnnounced (#587) ships dormant on
      // the same terms; its consumer is the #588 announced-model store — an identity report about the
      // turn claude is running is not a modal, since nothing is waiting on an answer.
      // questionShown (#885) is the one arm in this group where something IS waiting on an answer, so
      // it needs the distinction the others do not: a modal is a PERMISSION PROMPT gating an action
      // claude wants to take, resolved by `modal_answer` against `modal_id`, whereas a question batch
      // is claude asking the operator to CHOOSE — its own `question_batch_id` nonce, its own
      // outstanding-batch state daemon-side, its own stepped panel with header tabs, and as yet no
      // answer frame in the contract at all. Routing it through this store would give it a modal's
      // one-shot resolution semantics, which is exactly wrong. Its consumer is the #850 question store
      // plus a dedicated bridge — a FOURTH INDEPENDENT SUBSCRIBER — so this no-op is PERMANENT, not
      // dormant: unlike `connected`, which #538 flipped to a `reconnected` reset above, this case can
      // never become an owned arm here.
      // questionDismissed (#895) is the frame that ENDS that waiting, and it routes nowhere near this
      // store either — which is the whole point, since a dismissal is the one arm a reader is most
      // tempted to hand to the modal store on the strength of its `modalDismissed` twin. The two are
      // not the same resolution: `modalDismissed` retires a permission prompt against `modal_id` under
      // first-answer-wins, while this retires a question batch against its own nonce, and the daemon
      // contract has no question-answer frame at all yet. Its no-op is PERMANENT on the same #850
      // grounds as its sibling.
      // thinkingProgress (#1313) is the least modal-like member of the group and needs the least
      // argument: it is a mid-turn READING, nothing daemon-side is waiting on an answer, and there is
      // no `modal_id` to resolve it against. Its consumer is the #1314 render slice, so this no-op is
      // PERMANENT — nothing in this store will ever claim a reading.
      // rateLimited (#1319) lands here on identical grounds and is the second reading in the group:
      // nothing daemon-side is waiting on an answer, there is no `modal_id`, and a report about the
      // account's usage window gates no action claude wants to take. Its consumer is the #1320 store
      // slice, so this no-op is PERMANENT too. Worth one extra line only because a quota report is the
      // kind of thing a reader is tempted to raise AS a dialog: that is a render decision for #1321
      // to make on a surface of its own, and routing it through this store would hand it a permission
      // prompt's one-shot `modal_answer` resolution semantics, which nothing on the wire can settle.
      // contextUsage (#1419) is the third reading in the group and lands on identical grounds: nothing
      // daemon-side is waiting on an answer, there is no `modal_id` to resolve it against, and a
      // report of how full the context window is gates no action claude wants to take. Its consumer is
      // the #1420 store slice, so this no-op is PERMANENT. It earns the same extra line `rateLimited`
      // did, because a near-full window is if anything a stronger invitation to raise AS a dialog:
      // that is a render decision for #1421 to make on a surface of its own, and routing it through
      // this store would hand a reading a permission prompt's one-shot resolution semantics.
      // resetting (#1515) closes the group and is the one member here that is NOT a reading — it has
      // a rising and a falling edge, which is precisely why it needs its own line rather than
      // joining the three above by reference. The grounds still hold and are if anything plainer:
      // nothing daemon-side is waiting on an answer, there is no `modal_id` to resolve it against,
      // and the frame reports what the DAEMON is doing to a session rather than gating an action
      // claude wants to take — the opposite direction from a permission prompt. Its consumers are
      // the #1516 channel-list dot and the #1517 composer status row, so this no-op is PERMANENT.
      // The falling edge earns the one extra thought: a frame that ENDS something is the member a
      // reader is most tempted to hand to a store whose vocabulary includes `modalDismissed`, and
      // the two retire nothing alike — that retires a permission prompt against `modal_id` under
      // first-answer-wins, while this reports that a reset the operator started has finished.
      return null
    case 'runConfigReceived':
      // Not a modal event (#491). Present only because the assertNever guard makes a new arm a
      // compile error.
      return null
    case 'historyPageReceived':
    case 'historyRequestFailed':
      // Not modal events (#1222), and PERMANENTLY so: nothing is waiting on an answer. A page is a
      // replay of what already happened, answering this app's own ask, where a modal is a permission
      // prompt gating an action claude wants to take, resolved by `modal_answer` against `modal_id`. A
      // page may CARRY a stored `modal_shown` among its entries without being one — re-raising a
      // long-since-resolved prompt from a replay is exactly what this arm's absence would risk, and
      // #1223 owns whatever a stored modal frame renders as.
      //
      // Present for the assertNever guard, which stringifies the WHOLE event into an Error message; an
      // entry's payload is replayed content, so this case is what keeps it off that frame.
      return null
    case 'slashCommandList':
      // Not a modal event (#937): nothing is waiting on an answer. The frame publishes the vocabulary
      // of verbs claude will accept — text the operator MAY choose to type, unsolicited and
      // outstanding against nothing — where a modal is a permission prompt gating an action claude
      // wants to take, resolved by `modal_answer` against `modal_id`. Its consumer is the #938 store,
      // and the no-op here is DORMANT rather than permanent as the two question arms' are: whether
      // #938 subscribes through an existing bridge is its call. Present for the assertNever guard,
      // which stringifies the WHOLE event into an Error message and would otherwise put every
      // workspace-authored string on the frame there.
      return null
    case 'systemPromptWriteConfirmed':
    case 'systemPromptWriteRejected':
      // No modal-store action (#1249) — the write half's two outcomes, the read arm's counterpart directly
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
    case 'systemPromptReceived':
      // No modal-store action (#1230). The transport owns the ask, the correlation and the decode; the store that
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
    case 'modelList':
      // Not a modal event (#973): nothing is waiting on an answer, exactly as for the sibling above. The
      // frame publishes the IDENTITIES claude will run as — a menu the operator MAY choose from,
      // unsolicited and outstanding against nothing — where a modal is a permission prompt gating an
      // action claude wants to take, resolved by `modal_answer` against `modal_id`. Its consumer is the
      // #974 store, and unlike its sibling's this no-op is PERMANENT rather than dormant: #974 commits to
      // a dedicated subscriber, so no case here will ever claim it. Present for the assertNever guard,
      // which stringifies the WHOLE event into an Error message and would otherwise put every
      // claude-authored string on the frame there.
      return null
    default:
      return assertNever(event)
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each owned arm translates to a `ModalEvent` and is
 * dispatched, every other arm no-ops. Returns the exact unsubscribe handle from `onDaemonEvent` (the
 * `subscribeTimeline` idiom) so the React binding can use it as its effect cleanup. Injecting
 * `onDaemonEvent` + `dispatch` + `conversationIdsFor` keeps it React-free, STORE-FREE and unit-testable
 * with plain spies — the roster bridge's rule, which this one now shares: the bridge reads the
 * discriminant and the stamp, and the composition root turns the origin into the set to drop. The
 * listener only translates + dispatches — it never throws into React.
 */
export function subscribeModal(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  dispatch: (event: ModalEvent) => void,
  conversationIdsFor: (origin: ConversationListOrigin) => ReadonlySet<string>
): () => void {
  return onDaemonEvent((event) => {
    const modalEvent = translateModalEvent(event, conversationIdsFor)
    if (modalEvent) dispatch(modalEvent)
  })
}

/**
 * Wire the daemon-event channel into the app-singleton modal store for the lifetime of the mounting
 * component (#224 mounts it). Subscribes on mount and returns `subscribeModal`'s off handle as the
 * effect cleanup, so a StrictMode double-mount runs mount → cleanup → mount and nets exactly one live
 * listener — mirroring `useTimelineBridge`. `window.pyry` is dereferenced only inside the effect,
 * never during render.
 *
 * THE COMPOSITION ROOT for #1140's scoping, and the only place the two singletons meet: the origin the
 * translator read off the stamp resolves to that server's conversation ids through #1138's shared
 * resolution, and only those prompts and suppression entries are dropped. The list is read at EVENT
 * time, inside the resolver, never at subscribe time — on a first connect the server's slot holds no
 * list yet (the list request rides the same edge) so nothing is dropped, and on a reconnect the slot
 * still holds the previous episode's rows, since only `clearAllConversations` at a pairing boundary
 * empties it. Nothing can interleave between the read and the write: both stores are touched from this
 * one synchronous dispatch, with no await between them.
 */
export function useModalBridge(): void {
  useEffect(
    () =>
      subscribeModal(
        window.pyry.onDaemonEvent,
        (event) => modalStore.getState().dispatch(event),
        (origin) => selectConversationIdsFor(origin)(conversationListStore.getState())
      ),
    []
  )
}
