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
 * load-bearing: a new `DaemonEvent` arm is then a compile error in this bridge, `daemonEventBridge`,
 * `modalBridge` and `questionBridge` until each decides its mapping. THERE ARE FOUR, not two —
 * `modalBridge` (#223) and `questionBridge` (#900) both landed after this sentence was written, and a
 * stale count here fails no typecheck. Derive the set by grep rather than from prose: the exhaustive
 * bridges are the ones whose `DaemonEvent` switch ends in `assertNever`, not the ~20 siblings ending
 * in `default: return null`.
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
      //
      // `resultDetail` (#773) is assigned unconditionally, the `input` discipline above: never a
      // conditional spread, which would fold an empty detail into absence. ABSENT means the WIRE
      // omitted it (a pre-pyrycode#2024 daemon) and `''` means the daemon found no count — the same
      // thing upstream, carried distinctly anyway because collapsing is lossy and the decision that
      // both draw nothing is the render slice's (#856). Nothing here parses, trims, or extracts a
      // number from it; it is untrusted daemon display text under the same plain-text-NEVER-HTML
      // constraint as `resultSummary`.
      return {
        type: 'toolResult',
        turnId: event.turnId,
        toolUseId: event.toolUseId,
        isError: event.isError,
        resultSummary: event.resultSummary,
        resultDetail: event.resultDetail
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
    case 'questionShown':
    case 'questionDismissed':
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
      // questionShown (#885) joins this group on the same queueState rule — the frame carries no
      // turn_id and opens and closes no turn, so a batch of clarifying questions is daemon STATE, not a
      // turn-stream item. Its no-op here is PERMANENT rather than dormant, unlike every neighbour
      // above: apiRetry and compacting each later flipped to an owned arm, but #850's consumer is a
      // FOURTH INDEPENDENT SUBSCRIBER with its own bridge, so nothing in this switch will ever claim
      // it. Whether a question panel ever becomes a timeline surface is #850's call, not this slice's.
      // questionDismissed (#895) lands here by the same rule and for the same reason — the retirement
      // frame carries no turn_id and opens and closes no turn either, so a batch dying is daemon STATE
      // exactly as the batch appearing was. It is worth saying rather than assuming, because a
      // dismissal is the kind of event that reads like something that "happened during the turn": it
      // does not, and there is no turn to file it under.
      return null
    case 'runConfigReceived':
      // Not a timeline event (#491). Present only because the assertNever guard makes a new arm a
      // compile error.
      return null
    case 'slashCommandList':
      // Not a timeline event (#937). The frame carries no turn_id and opens and closes no turn, so a
      // menu of verbs is daemon STATE by the queueState rule (#720): a published vocabulary is not
      // something that HAPPENED during a turn, and a snapshot that replaces a reader's view of the menu
      // is not an item to append. Its consumer is the #938 store; the no-op is DORMANT rather than
      // permanent, unlike the two question arms above — whether #938 subscribes here is its call.
      // Present for the assertNever guard, which stringifies the WHOLE event into an Error message and
      // would otherwise put every workspace-authored string on the frame there.
      return null
    case 'modelList':
      // Not a timeline event (#973), by the same reasoning as its sibling directly above and on the same
      // wire facts: the frame carries no turn_id and opens and closes no turn, so a published menu of
      // identities is daemon STATE by the queueState rule (#720) — what claude will ACCEPT is not
      // something that HAPPENED during a turn, and a snapshot that replaces a reader's view of the menu
      // is not an item to append. The distinction worth drawing is against `modelAnnounced` (#587), which
      // is the closest-reading arm in this file: that one reports the identity claude is running FOR A
      // TURN and still ships dormant here on these same facts, so a menu published BEFORE any turn picks
      // from it is further from the timeline, not nearer. Its consumer is the #974 store, and unlike its
      // sibling's the no-op is PERMANENT rather than dormant — #974 commits to a dedicated subscriber, so
      // nothing in this switch will ever claim it. Present for the assertNever guard, which stringifies
      // the WHOLE event into an Error message and would otherwise put every claude-authored string on the
      // frame there.
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
 * nothing from `src/renderer/src/screens/`. That import ban is unchanged and literally true — the
 * sibling bridge states the identical one (conversationActivityBridge.ts:183-184), so it is a
 * family-wide convention across the store bridges, not a one-off. There is no `??`, no `||`, no default
 * parameter and no non-null assertion anywhere on either function below.
 *
 * WHAT #785 CHANGED, stated here because the sentence it replaces claimed more than the ban gives.
 * Until #785 the rationale was that the open conversation was UNAVAILABLE — no reference in scope, so
 * the `?? activeConversation` fallback #751-#754's REQUIRED `conversationId` was designed to prevent
 * could not be written. It is now reachable, but only under four conditions at once, and it is those
 * that carry AC3 rather than unavailability:
 *
 *   - only through a getter INJECTED as a parameter (App.tsx passes it), never an import here;
 *   - only at the FAN-OUT (`timelineWriteTarget` / `useTimelineBridge`), never in this function, which
 *     stays a pure function OF THE EVENT — the open conversation is not a property of an event, and
 *     making it one is the misattribution the whole #675 family exists to remove;
 *   - only for the two `ThreadEvent` arms ENUMERATED there — `sessionBoundary` and `reconnected`, the
 *     two whose wire payload carries no conversation id and never will (one reason each below);
 *   - and only AFTER the event's own attribution has been found absent, so an attributed arm never
 *     consults it at all.
 *
 * Two functions, two sentences: attribution (here) reads the event and nothing else; write-key
 * resolution (below) reads attribution first and the screen only for those two arms.
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
      // The other two owned arms carry no routing key of their own and neither ever will:
      // `sessionTransition` carries `newSessionId` (the #259 holder's addressing key) and its wire
      // payload has no conversation id to widen (types.ts:664 — a session boundary is attributed by the
      // connection it arrives on); and a connection edge has no conversation by nature. So `null` here
      // is the honest answer, and returning it is what keeps the resolution OUT of this pure function.
      //
      // They are NOT dormant. Each still reaches the flat store, which is what AC4 keeps true, and since
      // #785 the fan-out (`timelineWriteTarget`) files each into the conversation ON SCREEN — the
      // conversation the flat store has always meant — or drops it from the keyed path when none is
      // open. Inventing a key is still what AC3 bans; reading the screen for exactly these two is not
      // inventing one.
      return null
    default:
      return null
  }
}

/**
 * The SLICE an owned event is written into, or `null` when it belongs in none (#785). The write-key
 * half of the routing contract, deliberately a second pure function beside `timelineTargetFor` above:
 * that one answers "what did the event say", this one answers "where does the fan-out put it".
 *
 * The event's OWN attribution always wins, and it is checked FIRST. Two consequences, both load-bearing:
 * the nine id-carrying arms never consult the open conversation at all (the strongest available
 * statement of "no misattribution", and directly assertable on a spy), and a future wire widening is
 * safe by construction — if `session_transition` ever gained a `conversation_id` (a daemon + mobile
 * change, out of scope for this repo), `timelineTargetFor` would return the real id and this function
 * would honour it with no edit here. Ordering the switch first would silently override it. That branch
 * is unreachable in production today and is pinned by a direct unit test anyway; being able to pin it is
 * the point of this being pure.
 *
 * THE FALLBACK IS ENUMERATED, NEVER BLANKET. `conversationId ?? getOpenConversationId()` is the obvious
 * one-liner and it is banned here: it would file ANY unattributed owned event onto the thread on screen,
 * including a future arm whose author added a case to `translateTimelineEvent` and forgot one in
 * `timelineTargetFor` — that arm would land silently on the wrong thread. With the enumeration it falls
 * to `default` instead and is dropped from the keyed path, reaching the flat store only, which is the
 * same safe failure direction `timelineTargetFor`'s own `default` has. The two named arms are the two
 * whose wire payload carries no conversation id and never will (see that function's second group).
 *
 * `getOpenConversationId` is a GETTER, not a value, for two reasons. It must be read at DISPATCH time:
 * one app-lifetime listener outlives any number of chat switches, so a value captured at subscribe time
 * would file a boundary into the conversation the operator has already left — the staleness argument
 * `activateConversation.ts:16-23` makes for its own `getActiveConversation`. And it kills the positional
 * cross-wire: `string | null` and `() => string | null` are not interchangeable, so swapping arguments
 * two and three is a compile error rather than a test-only failure (the hazard
 * conversationActivityBridge.ts:150-165 documents for its own deps object).
 *
 * No `??`, no `||`, no default parameter, no non-null assertion: `conversationId !== null` is an
 * explicit test and the switch enumerates its arms.
 */
export function timelineWriteTarget(
  event: ThreadEvent,
  conversationId: string | null,
  getOpenConversationId: () => string | null
): string | null {
  if (conversationId !== null) return conversationId
  switch (event.type) {
    case 'sessionBoundary':
    case 'reconnected':
      // The conversation on screen IS what the flat store has always meant for these two, so filing
      // them here preserves what the operator sees bit for bit (#785 AC1/AC2). `null` — nothing open —
      // drops them from the keyed path without inventing a key (AC3).
      return getOpenConversationId()
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
 *
 * #785 makes the keyed write's guard the RESOLVED target rather than the event's own id, so the two
 * arms that carry none reach the conversation on screen. `getOpenConversationId` MUST be a stable
 * module-level constant: it is the effect's only dependency, so an inline arrow would resubscribe on
 * every `App` render instead of holding one listener for the app's lifetime. The dependency array names
 * it rather than staying `[]`, which is honest about that requirement rather than hiding it.
 */
export function useTimelineBridge(getOpenConversationId: () => string | null): void {
  useEffect(
    () =>
      subscribeTimeline(window.pyry.onDaemonEvent, (event, conversationId) => {
        timelineStore.getState().dispatch(event)
        const target = timelineWriteTarget(event, conversationId, getOpenConversationId)
        if (target !== null) {
          conversationTimelineStore.getState().dispatchFor(target, event)
        }
      }),
    [getOpenConversationId]
  )
}
