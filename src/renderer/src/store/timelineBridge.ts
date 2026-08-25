// The renderer translation half feeding the conversation-timeline store: it turns the two v2
// interactive-stream daemon events (#199) into the matching `ThreadEvent`s (#121) and dispatches
// them into the app-singleton `timelineStore` the render slice (#203) reads. `translateTimelineEvent`
// is the pure choke point; `useTimelineBridge` is its only production caller, wiring the channel into
// React's lifecycle. Nothing here touches keys, sockets, ipcRenderer, or raw frames — it only
// subscribes through the preload bridge and dispatches typed events.
//
// The mirror-image of `daemonEventBridge`: that bridge returns `null` for these two stream arms and
// owns the rest; this one owns exactly the two stream arms and returns `null` for everything else —
// two independent subscribers on the same channel.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { timelineStore } from './timelineStore'
import { conversationTimelineStore } from './conversationTimelineStore'
import type { ThreadEvent } from './threadTimeline'

/** Compile-time exhaustiveness guard: a new DaemonEvent arm without a case is a type error. */
function assertNever(event: never): never {
  throw new Error(`Unhandled daemon event: ${JSON.stringify(event)}`)
}

/**
 * Map one typed daemon event to the `ThreadEvent` it produces, or `null` when the event drives no
 * timeline state. Owns exactly the eleven timeline arms (`assistantDelta` / `turnEnd` / `turnState` /
 * `toolUse` #217 / `toolResult` #229 / `sessionTransition`→`sessionBoundary` #286 / `stallDetected` #317 /
 * `apiRetry` #493 / `compacting` #496 / `unrecognizedMessage` / `connected`→`reconnected` #538); each is reconstructed
 * as a fresh literal with named fields — not `return event`, not a spread
 * — so the translator stays immune to a `DaemonEvent` arm gaining an unrelated field later, matching
 * the transport emit's fresh-literal discipline (`daemonConnection.ts`). This is a filter, not a
 * rename: an arm may carry fields its `ThreadEvent` deliberately drops, and rebuilding from named
 * fields is what makes each drop explicit and stable as arms widen.
 *
 * Every other arm returns `null` via explicit fall-through cases, then `assertNever` — deliberately
 * NOT a catch-all `default: return null`, which would silently swallow a future arm. The guard is
 * load-bearing: a new `DaemonEvent` arm is then a compile error in both this bridge and
 * `daemonEventBridge` until each decides its mapping.
 */
export function translateTimelineEvent(event: DaemonEvent): ThreadEvent | null {
  switch (event.type) {
    case 'assistantDelta':
      return { type: 'assistantDelta', turnId: event.turnId, seq: event.seq, text: event.text }
    case 'turnEnd':
      return { type: 'turnEnd', turnId: event.turnId, stopReason: event.stopReason }
    case 'turnState':
      // `event.state` is WireTurnState; the ThreadEvent arm expects TurnPhase — the same literal union,
      // so this assigns with no cast and no import of TurnPhase (a rename, not a re-validation).
      return { type: 'turnState', state: event.state }
    case 'toolUse':
      // The tool-call arm (#217, widened by #643). The DaemonEvent carries `conversationId` (#763)
      // beside the five render fields; the ThreadEvent this returns does not, so the id STOPS here — a
      // filter + fresh copy (arm selection), never a pass-through of the DaemonEvent object.
      // reduceTimeline folds it into a pending `toolCall` item (result: null) in arrival order (#121).
      //
      // `input` (#643) is assigned unconditionally and BY REFERENCE. Never `{ ...event.input }`, which
      // on an absent map yields `{}` and silently converts absence into emptiness: ABSENT means the
      // WIRE omitted it (a pre-pyrycode#1678 daemon), while an empty map is the different fact that
      // this daemon sent no fields for this call. Structured clone has already handed the renderer its
      // own copy, so there is nothing left to defend against. Nothing here filters, sorts or probes the
      // map by key — both its keys and its values are untrusted daemon display text under the same
      // plain-text-NEVER-HTML constraint as `name` / `inputSummary`, and the render slice (#645) owns
      // that DOM sink.
      return {
        type: 'toolUse',
        turnId: event.turnId,
        toolUseId: event.toolUseId,
        name: event.name,
        inputSummary: event.inputSummary,
        input: event.input
      }
    case 'toolResult':
      // The tool-result arm (#229). The DaemonEvent carries `conversationId` (#766) beside the four render
      // fields; the ThreadEvent this returns does not, so the id STOPS here — a filter + fresh copy (arm
      // selection), never a pass-through of the DaemonEvent object. reduceTimeline folds it through
      // `fillResult`, RESOLVING the correlated `toolCall`'s result in place (by toolUseId); an orphan or
      // duplicate is a deterministic same-reference no-op (#121).
      return {
        type: 'toolResult',
        turnId: event.turnId,
        toolUseId: event.toolUseId,
        isError: event.isError,
        resultSummary: event.resultSummary
      }
    case 'sessionTransition':
      // The session-boundary arm (#285 widened it, #286 renders it). The DaemonEvent carries
      // `newSessionId` (the #259 holder's addressing key) beside the three render fields; this drops
      // `newSessionId` and copies the rest into a fresh `sessionBoundary` ThreadEvent — a filter + fresh
      // copy (arm selection), not a field remap, since the render fields are field-for-field identical.
      // `event.reason` is WireSessionTransitionReason; the ThreadEvent arm expects SessionBoundaryReason —
      // the same literal union, so this assigns with no cast (the `turnState` precedent). `workspaceCwd`
      // nullability is preserved verbatim. reduceTimeline folds it into a fresh `sessionBoundary` item in
      // arrival order (#121). The #259 holder is a SEPARATE subscriber on the same channel and still sees
      // this event unchanged — moving it out of the no-op group here does not affect it.
      return {
        type: 'sessionBoundary',
        reason: event.reason,
        workspaceCwd: event.workspaceCwd,
        occurredAt: event.occurredAt
      }
    case 'stallDetected':
      // #317: the stall-onset arm. The DaemonEvent carries `conversationId` (#732); the ThreadEvent
      // this returns is `{ type: 'stallDetected' }` and nothing else, so the id STOPS here — a
      // filter + fresh literal (arm selection), never a pass-through of the DaemonEvent object.
      // reduceTimeline sets the `stalled` scalar; the self-clear is derived there on next turn activity.
      return { type: 'stallDetected' }
    case 'apiRetry':
      // #493: the api-retry arm (#492 decodes it, this slice gives it a consumer). The DaemonEvent
      // carries `conversationId` (#737) beside the four render fields; the ThreadEvent this returns
      // does not, so the id STOPS here — a filter + fresh literal (arm selection), never a pass-through
      // of the DaemonEvent object. The falling edge's counter is copied verbatim — discarding it is
      // reduceTimeline's job (it stores `null`), not the bridge's — the translator normalizes nothing.
      return {
        type: 'apiRetry',
        active: event.active,
        current: event.current,
        total: event.total
      }
    case 'compacting':
      // #496: the compaction arm (#495 decodes it, this slice gives it a consumer). The DaemonEvent
      // carries `conversationId` (#742) beside the one render field; the ThreadEvent this returns does
      // not, so the id STOPS here — a filter + fresh literal (arm selection), never a pass-through of
      // the DaemonEvent object. Both edges translate verbatim — deciding what `active: false` means is
      // reduceTimeline's job, not the bridge's — the translator normalizes nothing.
      return { type: 'compacting', active: event.active }
    case 'unrecognizedMessage':
      // The parser-gap diagnostic. The DaemonEvent carries `conversationId` (#784) beside the four
      // render fields; the ThreadEvent this returns does not, so the id STOPS here — a filter + fresh
      // literal (arm selection), never a pass-through of the DaemonEvent object. The four render fields
      // ARE field-for-field identical, and that is precisely why the drop has to stay explicit: this is
      // the arm a "simplify it to a pass-through" edit looks safest on, and that edit would carry the id
      // into the reducer silently. No normalization either: deciding what an unrecognized message means
      // is reduceTimeline's job, and deciding how it looks is the row's. `site` assigns with no cast
      // because UnrecognizedSite and WireUnrecognizedSite are the same literal union by construction.
      return {
        type: 'unrecognizedMessage',
        site: event.site,
        messageType: event.messageType,
        raw: event.raw,
        truncated: event.truncated
      }
    case 'connected':
      // #538: every supervisor (re)handshake re-emits `connected`. Flip it to the payload-free reconcile
      // that clears the transient thread chrome, so a retry or compaction banner whose falling edge was
      // lost to the disconnect does not stick — the Mode B reset-on-reconnect half of the wire contract
      // (`items` is Mode A and survives; reduceTimeline owns that split, not the bridge). Ignores
      // `event.ack` (HelloAckPayload) — the reconcile needs no field off it. `daemonEventBridge` and
      // `sessionStore` stay independent consumers of the same edge; this is a third, not a centralisation.
      return { type: 'reconnected' }
    case 'connecting':
    case 'disconnected':
    case 'failed':
    case 'messageReceived':
    case 'messagesReceived':
    case 'debugBundleProgress':
    case 'debugBundleSaved':
    case 'debugBundleFailed':
    case 'conversationsReceived':
    case 'conversationCreated':
    case 'conversationUpdated':
    case 'conversationDeleted':
    case 'recentWorkspacesReceived':
    case 'workspaceFolderCreated':
    case 'workspaceFolderRejected':
    case 'modalShown':
    case 'modalDismissed':
    case 'sessionSettingsUpdated':
    case 'sessionSettingsRejected':
    case 'modalAnswerRejected':
    case 'queueState':
    case 'relayLinkChanged':
    case 'notificationActivated':
    case 'backgroundTaskStarted':
    case 'backgroundTaskUpdated':
    case 'backgroundTaskRoster':
    case 'modelAnnounced':
      // No timeline event: the session store (#19), download UI (#72), conversation-list store
      // (#208), modal store + bridge (#223, and the #249 rejection render), the create render slice
      // (#242), the #261 / #256 session-settings consumers (confirmed + rejected #269), the #293
      // queue store (queueState), the #376 list-reflect slice (conversationDeleted), the #382
      // recent-workspaces store (recentWorkspacesReceived), the #157 Create-folder dialog
      // (workspaceFolderCreated), and the #397 round-trip store (workspaceFolderRejected) consume
      // these — not the timeline store. sessionSettingsUpdated, sessionSettingsRejected, and
      // modalAnswerRejected are NOT timeline items — unlike turnState and, since #286,
      // sessionTransition, none drives a timeline row. queueState is deliberately in this null group:
      // `queue_state` is daemon STATE, not a turn-stream item (#720), so it is NOT folded into
      // reduceTimeline — the load-bearing #720 decision.
      // (stallDetected #315 is now an owned arm — #317 wired its `stalled` scalar above.)
      // relayLinkChanged (#328) ships dormant — its consumer is the relay-link store #329 (the
      // two-dot indicator), not the timeline store; the relay socket leg is not a turn-stream item.
      // notificationActivated (#393) is consumed by the notificationActivatedBridge → the paired `open`
      // nav, not the timeline store; a notification click is not a turn-stream item.
      // (apiRetry #492 is now an owned arm — #493 wired its `apiRetry` status scalar above; like the
      // stall onset it is thread chrome, not a timeline row.)
      // (compacting #495 is now an owned arm — #496 wired its `compacting` scalar above, answering the
      // question #495 deferred: transient thread chrome, NOT a timeline row.)
      // (connected is now an owned arm — #538 flips it to the `reconnected` chrome reconcile above;
      // `connecting` / `disconnected` stay here, since only the completed handshake reconciles.)
      // backgroundTaskStarted (#564) ships dormant — its consumer is the #567 background-task store. It
      // belongs in this null group for the queueState reason, and here the wire says so outright: no
      // turn_id, opens and closes no turn, "its own thread of activity, not part of the turn it appeared
      // in". Whether the background-task panel ever becomes a timeline surface is #568's call.
      // backgroundTaskUpdated (#565) joins it verbatim: same dormant #567 consumer, and the same wire
      // facts — no turn_id, opens and closes no turn — so a change to a task claude left running is no
      // more a turn-stream item than its opening was.
      // backgroundTaskRoster (#566) closes the family here too — the aggregate peer, same dormant #567
      // consumer, same wire facts: no turn_id, opens and closes no turn. A snapshot of what claude left
      // running is daemon STATE, not a turn-stream item, even when it is empty. Whether the
      // background-task panel ever becomes a timeline surface remains #568's call.
      // modelAnnounced (#587) ships dormant here on the same wire facts — no turn_id, opens and closes
      // no turn — so it is daemon STATE by the queueState rule (#720): an identity report ABOUT the
      // turn claude is running is not an item IN it. Its consumer is the #588 announced-model store,
      // and whether the announced model ever becomes a visible surface is #588's call, not this decode
      // slice's.
      return null
    case 'runConfigReceived':
      // Not a timeline event (#491). Present only because the assertNever guard makes a new arm a
      // compile error.
      return null
    default:
      return assertNever(event)
  }
}

/**
 * The conversation an owned event belongs to, or `null` when its arm carries no routing key (#756).
 *
 * THE ROUTING CONTRACT, and it is stated here rather than in the module header on purpose: four other
 * modules cite line numbers inside `translateTimelineEvent` above (`conversationActivityBridge.ts:7`
 * and `:114`, `announcedModelBridge.ts:11`, `announcedModelStore.ts:12`), so a header paragraph would
 * have shifted every one of them. Everything #756 adds sits BELOW the translator; only the one new
 * import above it moves a line. Together with `subscribeTimeline`, which hands the key to its injected
 * dispatch beside the translated event, and `useTimelineBridge`, which fans the pair out to the flat
 * `timelineStore` AND the keyed `conversationTimelineStore` (#755): translation and attribution are two
 * separate pure functions over the same event, never one.
 *
 * AC3 IS STRUCTURAL, checkable by grep and mirroring the holder's own constraint
 * (conversationTimelineStore.ts:38-42): this module imports nothing from `activeConversationStore` and
 * nothing from `src/renderer/src/screens/`. With no reference to the open conversation in scope, the
 * `?? activeConversation` fallback that #751-#754's REQUIRED `conversationId` was designed to prevent
 * is not something to remember to avoid — it is unavailable. There is no `??`, no `||`, no default
 * parameter and no non-null assertion anywhere on the routing path.
 *
 * `translateTimelineEvent`'s companion, deliberately a SECOND pure function rather than a widening of
 * that translator's return type to `{ event, conversationId } | null`: the translator is called at 19
 * sites in `timelineBridge.test.ts`, and rewrapping every one of those expectations would destroy this
 * ticket's own no-op evidence in the act of proving it — all 19 are untouched. One extra switch instead.
 *
 * The id is read BY NAME off a narrowed union, never probed for. `'conversationId' in event` is banned:
 * structured clone PRESERVES an `undefined` property across the IPC bridge, so `in` would be true for a
 * future `conversationId?: string` arm holding `undefined`, while
 * `Extract<DaemonEvent, { conversationId: string }>` would exclude that arm — a guard whose return type
 * lies, with `Map.get(undefined)` silently missing downstream.
 *
 * The `default` is NOT the catch-all `translateTimelineEvent`'s own docblock bans, and this is the
 * reason. That prohibition
 * protects `translateTimelineEvent`'s guarantee that a NEW `DaemonEvent` arm cannot be silently dropped
 * from the timeline; that guarantee is untouched and still lives in its explicit fall-through group plus
 * `assertNever`. This function answers a strictly narrower, downstream question — given an event the
 * translator already owned, where does it go? — and the two groups below enumerate every owned arm, so
 * `default`'s domain is exactly the arms this is never called with in production. Its failure direction
 * is the safe one: an unattributed event still reaches the flat store unchanged (AC4) and is never
 * routed onto a wrong slice (AC3). A second `assertNever` here would force the 28 no-op arms to be
 * re-listed — the duplication this shape exists to avoid.
 */
export function timelineTargetFor(event: DaemonEvent): string | null {
  switch (event.type) {
    case 'assistantDelta':
    case 'turnEnd':
    case 'turnState':
    case 'toolUse':
    case 'toolResult':
    case 'stallDetected':
    case 'apiRetry':
    case 'compacting':
    case 'unrecognizedMessage':
      // Nine of the eleven owned arms carry the frame's `conversation_id` (#751 / #752 / #724 / #763 /
      // #766 / #732 / #737 / #742 / #784, the #675 family). It is REQUIRED on every one of them — a
      // missing or non-string `conversation_id` fails the whole line at the decode without emitting — so
      // the routing key is non-nullable here by construction. TypeScript narrows across grouped cases,
      // so the field resolves with no cast and no probe.
      return event.conversationId
    case 'sessionTransition':
    case 'connected':
      // The other two owned arms carry no routing key, each for its own reason: `sessionTransition`
      // carries `newSessionId` (the #259 holder's addressing key) and its wire payload has no
      // conversation id to widen; and a connection edge has no conversation by nature. They are NOT
      // dormant — each still reaches the flat store, which is what AC4 keeps true — but there is nothing
      // to attribute them to, and inventing one is exactly what AC3 bans.
      return null
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each owned arm translates to a `ThreadEvent` and is
 * dispatched, every other arm no-ops. Returns the exact unsubscribe handle from `onDaemonEvent` (the
 * `subscribeRunConfig` idiom) so the React binding can use it as its effect cleanup. Injecting
 * `onDaemonEvent` + `dispatch` keeps it React-free and unit-testable with plain spies. The listener
 * only translates + dispatches — it never throws into React, imports no store, and performs no fan-out
 * of its own.
 *
 * #756 widened the injected callback's ARITY rather than adding a third parameter. The parameter count
 * is unchanged, and a function of arity 1 is assignable to a parameter typed at arity 2, so all 20
 * existing call sites — 19 in `timelineBridge.test.ts`, one in `interactiveRoundtrip.test.tsx` — keep
 * compiling and running unedited, which is what let the routing land in one slice and what leaves them
 * standing as this ticket's no-op proof. Exactly ONE of their assertions had to move with the seam:
 * `toHaveBeenCalledWith` pins the whole argument list, so the one spy-level test that asserted the
 * dispatch's arguments now names the id too. A third parameter would have cascaded over all 20 instead.
 * `timelineTargetFor` is called only on the non-null path, so its `default` group is unreachable in
 * production.
 */
export function subscribeTimeline(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  dispatch: (event: ThreadEvent, conversationId: string | null) => void
): () => void {
  return onDaemonEvent((event) => {
    const threadEvent = translateTimelineEvent(event)
    if (threadEvent) dispatch(threadEvent, timelineTargetFor(event))
  })
}

/**
 * Wire the daemon-event channel into the app-singleton timeline store for the lifetime of the
 * mounting component (#203 mounts it). Subscribes on mount and returns `subscribeTimeline`'s off
 * handle as the effect cleanup, so a StrictMode double-mount runs mount → cleanup → mount and nets
 * exactly one live listener — mirroring `useDaemonEventBridge`. `window.pyry` is dereferenced only
 * inside the effect, never during render.
 *
 * #756 makes this the FAN-OUT composition root: the flat store is written unconditionally and FIRST,
 * then the keyed holder, guarded on a non-null id. Flat-first is not cosmetic — it is what keeps AC4
 * true even if the keyed write were to throw. Both writes are synchronous zustand `set`s with no
 * `await` between them, so nothing can interleave. The dual write is deliberate and temporary
 * (Strangler Fig, ADR 0008): nothing reads the holder yet, so this ships as a verified no-op, and
 * retiring the flat store belongs to the ticket that removes its last reader.
 *
 * Importing `conversationTimelineStore` here is correct and breaches no constraint: the holder's HARD
 * IMPORT CONSTRAINT binds what that STORE MODULE imports, not who may import it. This module's own
 * constraint is the one stated on `timelineTargetFor` above.
 *
 * The argument order flips — this callback reads `(event, conversationId)` while `dispatchFor` takes
 * `(conversationId, event)`. Not a hazard worth restructuring for: `ThreadEvent` and `string` are not
 * interchangeable, so a swap is a compile error.
 */
export function useTimelineBridge(): void {
  useEffect(
    () =>
      subscribeTimeline(window.pyry.onDaemonEvent, (event, conversationId) => {
        timelineStore.getState().dispatch(event)
        if (conversationId !== null) {
          conversationTimelineStore.getState().dispatchFor(conversationId, event)
        }
      }),
    []
  )
}
