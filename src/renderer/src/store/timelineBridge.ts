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
import type { DaemonEvent, HistoryTimelineEvent } from '@shared/ipc/events'
import { timelineStore } from './timelineStore'
import { conversationTimelineStore } from './conversationTimelineStore'
import type { ThreadEvent } from './threadTimeline'

/** Compile-time exhaustiveness guard: a new DaemonEvent arm without a case is a type error. */
function assertNever(event: never): never {
  throw new Error(`Unhandled daemon event: ${JSON.stringify(event)}`)
}

/**
 * The longest daemon-supplied `ts` this client will build a join key from (#1225). An RFC3339 timestamp
 * with nanoseconds and a numeric offset is under 40 characters, so this is lossless for any timestamp a
 * daemon legitimately mints, with room for a form we have not seen.
 *
 * IT IS A MEMORY BOUND, NOT A FORMAT CHECK — nothing here parses, validates or dates the value. The
 * frame cap `MAX_PLAINTEXT_BYTES` is 65519, so a hostile daemon may legitimately decode a ~64KB `ts`;
 * unbounded, a stream of those would pin `MAX_LIVE_JOIN_KEYS` of them per retained conversation. An
 * over-length value yields NO key rather than a truncated one, which matters: truncation would MERGE
 * distinct timestamps onto one key, and a key that matches more than it should is a suppressor. No key
 * means the entry draws — the fail-open direction.
 */
const MAX_JOIN_TS_CHARS = 64

/**
 * The (`type`, `ts`) key both lanes join on (#1225), or `undefined` when this client declines to key the
 * pair. The one composer for the whole join: the live lane reaches it through `liveJoinKeyFor` below and
 * the page lane through `withoutLiveEntries`, so neither can drift into its own spelling.
 *
 * WHY THIS KEY. The daemon mints one timestamp per logical event, hoisted above its per-connection
 * fan-out, and hands that same value to the conversation-log entry and to every outbound envelope for
 * that event. Nothing else joins: the entry's `id` is the durable on-disk log id and the live lane has no
 * such field; `event_id` belongs to the in-memory replay ring, is per-process and reset by a restart, and
 * `session_transition` skips that ring entirely; `turn_id` + `seq` exists only on turn-scoped payloads,
 * and the five status types — `turn_state`, `stall`, `api_retry`, `compacting`, `session_transition` —
 * carry no `turn_id` at all. Never text.
 *
 * THE SPACE IS AN UNAMBIGUOUS SEPARATOR here, though it would not be in general. The TYPE half is always
 * a client-owned literal from `DaemonEvent`'s closed discriminant set and provably contains no space, so
 * no `(type, ts)` pair can be spelled by a different pair however hostile the `ts` is — the ambiguity a
 * concatenated key normally invites needs BOTH halves to be attacker-shaped.
 *
 * The composed key is a COMPARAND and nothing else: it reaches a `Set` membership test and is discarded.
 * It never becomes a lookup path on a bare object (a `__proto__`-shaped `ts` would write through
 * `Object.prototype`), a filename, a URL, an attribute, a React key or a log field.
 */
export function joinKeyFor(type: string, ts: string): string | undefined {
  if (ts.length === 0 || ts.length > MAX_JOIN_TS_CHARS) return undefined
  return `${type} ${ts}`
}

/**
 * The join key one live daemon event contributes, or `undefined` when it contributes none (#1225).
 *
 * Most stamped events join by type and timestamp. User receipts are excluded because
 * `withoutHeldEchoes` owns their message-id join and preserves the held row. Lifecycle events
 * without an envelope contribute no key. Only the timestamp half is daemon-supplied.
 */
export function liveJoinKeyFor(event: DaemonEvent): string | undefined {
  // History user rows join against held message ids, never timestamp identity.
  if (event.type === 'messageReceived') return undefined
  return event.daemonTs === undefined ? undefined : joinKeyFor(event.type, event.daemonTs)
}

/**
 * Map one typed daemon event to the `ThreadEvent` it produces, or `null` when the event drives no
 * timeline state. Owns exactly the thirteen timeline arms (`assistantDelta` / `turnEnd` / `turnState` /
 * `toolUse` #217 / `toolResult` #229 / `sessionTransition`→`sessionBoundary` #286 / `stallDetected` #317 /
 * `apiRetry` #493 / `compacting` #496 / `unrecognizedMessage` / `connected`→`reconnected` #538 /
 * `messageReceived`→`userText` #1223 / `thinkingProgress` #1314); each is reconstructed
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
 *
 * #1223 WIDENS THE PARAMETER to `DaemonEvent | HistoryTimelineEvent` so one served history entry folds
 * through this same function. A widening, not a signature change: every existing call site still
 * compiles, and no case body moved, because each arm already reconstructs from named RENDER fields and
 * a `HistoryTimelineEvent` arm is its live twin minus the `conversationId` no arm reads. Every history
 * arm's `type` tag already had a case, so `assertNever` stays total. Reusing this function rather than
 * writing a second mapping is what makes "a page produces the rows the live stream would have produced"
 * structural rather than aspirational — and the reason a new drawable arm must be added HERE, never in
 * a history-only translator that would drift from this one.
 *
 * #1013 adds the OPTIONAL `now` clock, read on the `assistantDelta` arm and nowhere else. Optional and
 * trailing for `subscribeTimeline`'s own #756 reason — a required parameter would cascade over every
 * existing call site, an optional one over none — and with NO `Date.now` fallback, which is the load-bearing
 * half: a defaulting clock would stamp every event produced by a spec that injects none, and those events
 * are asserted with `toEqual`, which ignores an undefined-valued property and fails on a defined one. So
 * **an absent clock means no stamp**, here and at every other seam this field crosses.
 */
export function translateTimelineEvent(
  event: DaemonEvent | HistoryTimelineEvent,
  now?: () => number
): ThreadEvent | null {
  switch (event.type) {
    case 'banner':
      return event.conversationId === '' ? null : {
        type: 'banner', level: event.level, text: event.text,
        stopsTurn: event.stopsTurn, truncated: event.truncated
      }
    case 'modelRefusalFallback':
    case 'modelRefusalNoFallback': {
      const live = 'conversationId' in event && typeof event.conversationId === 'string'
      if (live && event.conversationId === '') return null
      const common = { originalModel: event.originalModel, refusalCategory: event.refusalCategory,
        banner: event.banner, truncatedFields: event.truncatedFields, droppedFields: event.droppedFields }
      const refusal = event.type === 'modelRefusalFallback'
        ? { ...common, type: event.type, fallbackModel: event.fallbackModel, scope: event.scope }
        : { ...common, type: event.type }
      return { type: 'modelRefusal', refusal, live }
    }
    case 'toolProgress':
      return {
        type: 'toolProgress', turnId: event.turnId,
        toolUseId: event.toolUseId, elapsedSeconds: event.elapsedSeconds
      }
    case 'assistantDelta':
      // #1013: the assistant bubble's creation time. `now?.()` expresses "absent clock ⇒ no stamp" without
      // a branch, and the field is assigned unconditionally (the `input` / `resultDetail` discipline). The
      // reducer, not this bridge, decides that only the FIRST delta of a bubble keeps its stamp — every
      // delta is translated identically here, which is what keeps this function a total, opinion-free map.
      return {
        type: 'assistantDelta',
        turnId: event.turnId,
        seq: event.seq,
        text: event.text,
        createdAt: now?.()
      }
    case 'turnEnd':
      return { type: 'turnEnd', turnId: event.turnId, stopReason: event.stopReason,
        outcome: event.outcome, isError: event.isError, terminalReason: event.terminalReason, errorCategory: event.errorCategory,
        durationMs: event.durationMs, inputTokens: event.inputTokens, cacheReadTokens: event.cacheReadTokens,
        cacheCreationTokens: event.cacheCreationTokens, outputTokens: event.outputTokens, costUsdTotal: event.costUsdTotal }
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
        parentToolUseId: event.parentToolUseId,
        name: event.name,
        inputSummary: event.inputSummary,
        input: event.input
      }
    case 'toolDenied':
      if ('conversationId' in event && event.conversationId === '') return null
      return {
        type: 'toolDenied',
        turnId: event.turnId,
        toolUseId: event.toolUseId,
        denial: {
          toolName: event.toolName,
          decisionReasonType: event.decisionReasonType,
          decisionReason: event.decisionReason,
          message: event.message,
          truncatedFields: event.truncatedFields,
          droppedFields: event.droppedFields
        }
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
        parentToolUseId: event.parentToolUseId,
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
      //
      // `conversationId` (#1192) STOPS here too, the id-carrying arms' discipline. It reaches the keyed
      // store through `timelineTargetFor` below, which routes the boundary by it since #1559.
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
      return { type: 'compacting', active: event.active,
        compactResult: event.compactResult, compactError: event.compactError }
    case 'compactionBoundary':
      return { type: 'compactionBoundary', trigger: event.trigger,
        preTokens: event.preTokens, postTokens: event.postTokens }
    case 'thinkingProgress':
      // #1314: the thinking-token reading (#1312 decodes it, #1313 carried it here, this slice gives it
      // a consumer). The DaemonEvent carries `conversationId` beside the one render field; the
      // ThreadEvent this returns does not, so the id STOPS here — a filter + fresh literal (arm
      // selection), never a pass-through of the DaemonEvent object. That drop is what keeps the routing
      // key out of the reducer, the label and the DOM entirely; it reaches the keyed store through
      // `timelineTargetFor` below, whose index is a `Map`.
      //
      // `estimatedTokens` is copied VERBATIM and unconditionally — no clamp, no floor, no truthiness
      // test that would fold the daemon's legal zero into an absence, and no `estimatedTokensDelta`,
      // which does not cross the IPC boundary at all. The translator normalizes nothing: deciding what
      // a reading means is reduceTimeline's job and formatting it defensively is the label's.
      return { type: 'thinkingProgress', estimatedTokens: event.estimatedTokens }
    case 'resetting':
      // #1517: the reset-edge arm — the flip the no-op group below was holding open. The DaemonEvent
      // carries `conversationId` beside the three render fields; the ThreadEvent this returns does not,
      // so the id STOPS here (the `thinkingProgress` / `apiRetry` / `compacting` discipline). That drop
      // is what keeps the routing key out of the reducer, the label and the DOM entirely; it reaches
      // the keyed store through `timelineTargetFor` below, whose index is a `Map`.
      //
      // BOTH TOKENS ARE COPIED VERBATIM and both edges translate. The falling edge's two empty strings
      // are carried rather than normalised away: `active` is the edge, and the reducer is the single
      // place that turns it into presence-or-absence. The translator normalizes NOTHING — deciding
      // what an unnamed phase means is the label's job, not this function's, and gating the token set
      // on `active` here would be the cross-field validation the decoder already refuses by name.
      return {
        type: 'resetting',
        active: event.active,
        phase: event.phase,
        handoff: event.handoff
      }
    case 'attachmentOffered':
      // #1621: the offered-file arm — the flip #1620 left dormant in the no-op group below. The
      // DaemonEvent carries `conversationId` beside the two render fields; the ThreadEvent this returns
      // does not, so the id STOPS here and reaches the keyed store only through `timelineTargetFor`.
      // A fresh named-field literal, never a spread, so no extra key on the event object crosses.
      // `filename` is claude-authored display text: rendered as escaped text only (events.ts contract).
      return {
        type: 'attachmentOffered',
        attachment: { attachmentId: event.attachmentId, filename: event.filename }
      }
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
    case 'messageReceived': {
      // Receipts share the user row, but never the composer's pending-send meaning. History has no
      // live envelope time; neither lane may stamp a receipt with the desktop arrival clock.
      if (event.message.role !== 'user') return null
      const ts = 'daemonTs' in event ? event.daemonTs : undefined
      const parsed = ts !== undefined && ts.length <= MAX_JOIN_TS_CHARS ? Date.parse(ts) : NaN
      return {
        type: 'userText', received: true, text: event.message.text,
        messageId: event.message.message_id,
        createdAt: Number.isFinite(parsed) ? parsed : undefined
      }
    }
    case 'connecting':
    case 'disconnected':
    case 'failed':
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
    case 'conversationCreateRejected':
    case 'workspaceRenameResult':
    case 'conversationMuteResult':
    case 'workspaceUpdated':
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
    case 'backgroundTaskProgress':
    case 'sessionFacts': // Informational only; the session-facts bridge owns retention.
    case 'mcpStatus': // Informational only; the MCP status bridge owns retention.
    case 'mcpStatusRequestRejected': // The channel info sheet's notice owns this (#1579).
    case 'mcpReconnectRejected': // The channel info sheet's Reconnect control owns this (#1582).
    case 'mcpToggleRejected': // The channel info sheet's on/off switch owns this (#1586).
    case 'backgroundTaskStopRejected': // The Stop task button owns this (#1770).
    case 'modelAnnounced':
    case 'questionShown':
    case 'questionDismissed':
    case 'rateLimited':
    case 'contextUsage':
      // No timeline event: the session store (#19), download UI (#72), conversation-list store
      // (#208), modal store + bridge (#223, and the #249 rejection render), the create render slice
      // (#242), the #261 / #256 session-settings consumers (confirmed + rejected #269), the #293
      // queue store (queueState), the #376 list-reflect slice (conversationDeleted), the #382
      // recent-workspaces store (recentWorkspacesReceived), the #157 Create-folder dialog
      // (workspaceFolderCreated), the #397 round-trip store (workspaceFolderRejected), the #1308 Add
      // workspace dialog (conversationCreateRejected — dormant, no consumer built yet), and the #1288
      // conversation-list refresh trigger (workspaceUpdated) consume
      // these — not the timeline store. A refused chat-create is not a turn-stream item either: it
      // reports that a conversation never came into being, so there is no thread for it to draw in. sessionSettingsUpdated, sessionSettingsRejected, and
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
      // backgroundTaskProgress (#1638) joins the family here on the same wire facts — no turn_id, opens
      // and closes no turn — dormant until the #1640 background-task store claims it.
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
      // (thinkingProgress is now an owned arm — #1314 wired its `thinkingTokens` scalar above, taking
      // the route #1313 left open. Like the stall onset and the two edges beside it, it is thread
      // chrome and not a timeline row, so it left this group without becoming one.)
      // rateLimited (#1319) joins this group by the same queueState rule (#720) — no turn_id, opens
      // and closes no turn, so a report about the account's usage window is daemon STATE and not an
      // item IN a turn, however plainly the turn that observed it is the one the operator is watching.
      // Its no-op here is PERMANENT as of #1320, which made the call this comment used to hold open:
      // the reading goes to a SUBSCRIBER OF ITS OWN (`usageLimitBridge` → `usageLimitStore`), the
      // questionShown (#885) route, and NOT to thread chrome through this bridge, the route apiRetry
      // (#493), compacting (#496) and thinkingProgress (#1314) each eventually took. The deciding fact
      // is LIFETIME rather than layout: a usage-limit window is conversation-scoped and outlives a turn
      // end, a `/clear` and a session transition, so state a turn rebuilds would drop it at the wrong
      // moment and every reducer arm would carry an extra field to prevent that. This case now exists
      // only so the assertNever guard makes a new arm a compile error.
      // contextUsage (#1419) joins the group by the same queueState rule (#720) — no turn_id, opens
      // and closes no turn, so a reading of how full the context window is is daemon STATE and not an
      // item IN a turn, however plainly the turn that observed it is the one the operator is watching.
      // Its no-op here is PERMANENT as of #1420, which made the call this comment used to hold open:
      // the reading goes to a SUBSCRIBER OF ITS OWN (`reportedContextBridge` → `reportedContextStore`),
      // the questionShown (#885) / rateLimited (#1320) route, and NOT to thread chrome through this
      // bridge, the route apiRetry (#493), compacting (#496) and thinkingProgress (#1314) each
      // eventually took. The deciding fact is LIFETIME rather than layout, exactly as it was for
      // `rateLimited` one arm over: a context window is conversation-scoped and outlives a turn end, a
      // `/clear` and a session transition, so state a turn rebuilds would drop the reading at the wrong
      // moment and every reducer arm would carry TEN extra fields to prevent that. This case now exists
      // only so the assertNever guard makes a new arm a compile error — and it matters more here than
      // on any neighbouring arm, because that guard stringifies the WHOLE event into an Error message
      // and this is the largest arm on the union and the one carrying the most disclosive fields.
      // DELETING THE CASE would put every memory-file path and every MCP server name into a stack trace
      // and a crash reporter.
      // resetting (#1515) SAT IN THIS GROUP, dormant rather than permanently no-op, and #1517 made the
      // call it was waiting for: the composer status row is transient thread chrome, not a timeline
      // row — the answer #495 reached for `compacting` — so the reset is an owned arm above now. The
      // queueState rule (#720) still holds for what this arm is NOT: no turn_id, it opens and closes
      // no turn, and it produces no ThreadItem, however plainly the turn it interrupts is the one the
      // operator is watching.
      // (attachmentOffered #1620 SAT IN THIS GROUP, dormant; #1621 made it an owned arm above — a
      // thread ROW, unlike the chrome arms that left this group before it.)
      return null
    case 'runConfigReceived':
      // Not a timeline event (#491). Present only because the assertNever guard makes a new arm a
      // compile error.
      return null
    case 'historyPageReceived':
    case 'historyRequestFailed':
      // Not timeline events YET, and the reason is scope rather than kind (#1222). A page's entries ARE
      // timeline items — that is the whole point of a history entry carrying a stored frame's `type` and
      // `payload`, so a client can re-reduce a loaded page oldest-first through THIS reducer — but the
      // mapping is #1223's and the join to the live stream is #1225's. This slice lands the transport
      // only. So these arms are DORMANT rather than permanently no-op, and the page arm in particular is
      // expected to flip; nothing else in this file is waiting to claim them.
      //
      // Present for the assertNever guard, which stringifies the WHOLE event into an Error message — and
      // that guard matters more here than on any neighbouring arm: an entry's `payload` is replayed
      // content, so a missing case would put a whole page of operator- and claude-authored text on the
      // frame there. This case is what keeps it out.
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
    case 'systemPromptWriteConfirmed':
    case 'systemPromptWriteRejected':
      // Not a timeline event (#1249) — the write half's two outcomes, the read arm's counterpart directly
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
      // Not a timeline event (#1230). The transport owns the ask, the correlation and the decode; the store that
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
 *   - only for the one `ThreadEvent` arm ENUMERATED there — `reconnected`, the arm this bridge does not
 *     attribute from the event itself (see the `connected` group below). `sessionBoundary` was the
 *     second until #1559 routed it by the frame's own `conversationId`;
 *   - and only AFTER the event's own attribution has been found absent, so an attributed arm never
 *     consults it at all.
 *
 * Two functions, two sentences: attribution (here) reads the event and nothing else; write-key
 * resolution (below) reads attribution first and the screen only for that one arm.
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
    case 'messageReceived':
      return event.message.role === 'user' && event.message.conversation_id !== ''
        ? event.message.conversation_id : null
    case 'toolProgress':
      return event.conversationId
    case 'banner':
    case 'modelRefusalFallback':
    case 'modelRefusalNoFallback':
    case 'toolDenied':
      return event.conversationId === '' ? null : event.conversationId
    case 'assistantDelta':
    case 'turnEnd':
    case 'turnState':
    case 'toolUse':
    case 'toolResult':
    case 'stallDetected':
    case 'apiRetry':
    case 'compacting':
    case 'compactionBoundary':
    case 'unrecognizedMessage':
    case 'thinkingProgress':
    case 'resetting':
    case 'sessionTransition':
    case 'attachmentOffered':
      // #1621: `attachmentOffered` joined this group. The frame is broadcast to every attached client,
      // so the offer is filed only into the conversation it names, never the chat on screen.
      //
      // Twelve of the thirteen owned arms carry the frame's `conversation_id` (#751 / #752 / #724 / #763 /
      // #766 / #732 / #737 / #742 / #784 / #1313 / #1514 / #1192, the #675 family). It is REQUIRED on every one of them — a
      // missing or non-string `conversation_id` fails the whole line at the decode without emitting — so
      // the routing key is non-nullable here by construction. TypeScript narrows across grouped cases,
      // so the field resolves with no cast and no probe.
      //
      // `sessionTransition` joined this group in #1559. #1192 ported its `conversationId` and left
      // routing the delimiter by it as a second deliverable, so until then this returned `null` and the
      // fan-out filed the marker into the chat ON SCREEN — reset A, switch to B during the wrap-up turn,
      // and the separator drew in B and never in A. Nothing repaired that later: a history page only
      // backfills rows OLDER than the oldest held one. Mobile routes the boundary strictly by this key
      // (mobile #336), and so does this now, whether or not the chat it names is open.
      return event.conversationId
    case 'connected':
      // The one owned arm not attributed from the event: a connection edge has no conversation by
      // nature and never will. Returning `null` is what keeps the resolution OUT of this pure function.
      //
      // It is NOT dormant. It still reaches the flat store, which is what AC4 keeps true, and since
      // #785 the fan-out (`timelineWriteTarget`) files its reconcile into the conversation ON SCREEN —
      // the conversation the flat store has always meant — or drops it from the keyed path when none is
      // open. Inventing a key is still what AC3 bans; reading the screen for this one arm is not
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
 * the id-carrying arms never consult the open conversation at all (the strongest available statement
 * of "no misattribution", and directly assertable on a spy), and a wire widening is safe by
 * construction. That second consequence is no longer hypothetical: `session_transition` gained its
 * `conversation_id` (#1192), `timelineTargetFor` returns it since #1559, and this function honoured it
 * with no edit to this check. Ordering the switch first would have silently overridden it.
 *
 * THE FALLBACK IS ENUMERATED, NEVER BLANKET. `conversationId ?? getOpenConversationId()` is the obvious
 * one-liner and it is banned here: it would file ANY unattributed owned event onto the thread on screen,
 * including a future arm whose author added a case to `translateTimelineEvent` and forgot one in
 * `timelineTargetFor` — that arm would land silently on the wrong thread. With the enumeration it falls
 * to `default` instead and is dropped from the keyed path, reaching the flat store only, which is the
 * same safe failure direction `timelineTargetFor`'s own `default` has. The one named arm is the one
 * this bridge does not attribute from the event itself (see that function's `connected` group).
 * `sessionBoundary` was named here too until #1559, and that fallback was the live defect: a reset in
 * one chat drew its separator in whichever chat the operator had switched to.
 *
 * `getOpenConversationId` is a GETTER, not a value, for two reasons. It must be read at DISPATCH time:
 * one app-lifetime listener outlives any number of chat switches, so a value captured at subscribe time
 * would file a reconnect into the conversation the operator has already left — the staleness argument
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
    case 'reconnected':
      // The conversation on screen IS what the flat store has always meant for a reconnect, so filing
      // it here preserves what the operator sees bit for bit (#785 AC2). `null` — nothing open — drops
      // it from the keyed path without inventing a key (AC3).
      //
      // `sessionBoundary` sat beside it until #1559 and must never return: every boundary now arrives
      // attributed, and an unattributed one falling back to the screen is exactly the defect #1559
      // removed — the separator drawn in the chat being read instead of the chat that was reset.
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
 *
 * #1013 threads an OPTIONAL `now` clock through to `translateTimelineEvent`, and the same arithmetic
 * decides its shape: a required third parameter would cascade over every existing call site, an optional
 * one over none — which is #756's lesson applied a second time to the same function. It is read once per
 * translated event, inside the listener, so each assistant bubble is stamped at ITS OWN arrival rather
 * than at subscribe time.
 */
export function subscribeTimeline(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  dispatch: (event: ThreadEvent, conversationId: string | null, joinKey?: string) => void,
  now?: () => number
): () => void {
  return onDaemonEvent((event) => {
    const threadEvent = translateTimelineEvent(event, now)
    if (!threadEvent) return
    // #1225 — the ARITY widens a third time, for #756's own arithmetic: a function of arity 2 is
    // assignable to a parameter typed at arity 3, so the twenty existing call sites keep compiling.
    const conversationId = timelineTargetFor(event)
    dispatch(threadEvent, conversationId, joinKeyToRecord(event, conversationId))
  })
}

/**
 * The join key this event may contribute TO THE SLICE IT WILL BE FILED INTO, or `undefined` (#1225).
 *
 * ⭐ ONLY AN EVENT'S OWN ATTRIBUTION MAY MINT A KEY, and this guard is the reason the key is computed
 * here rather than at the fan-out. `timelineTargetFor` returns `null` for `connected`, and
 * `timelineWriteTarget` then files its reconcile into the conversation ON SCREEN (#785) — which the
 * event never named. A key recorded against that slice could suppress THAT conversation's own page
 * entry whenever the daemon minted the two the same instant with the same type, and a dropped row is the
 * one direction this join refuses. So a key whose conversation was inferred rather than asserted is
 * never minted at all. The emit stamps no `daemonTs` on `connected` today, so the guard is a second
 * line behind that; it stays because the type admits a stamp on every arm.
 *
 * `sessionTransition` was this guard's working case until #1559. Its slice was inferred from the
 * screen, so it contributed no live key and its page twin always drew a duplicate `Session reset`
 * divider. #1559 routes the marker by the `conversation_id` #1192 ported, so `timelineTargetFor`
 * returns a real id and this function keys it with no edit here: the key is recorded against the chat
 * the frame named, and a served page of that chat holding the same entry draws no second divider.
 */
function joinKeyToRecord(event: DaemonEvent, conversationId: string | null): string | undefined {
  return conversationId === null ? undefined : liveJoinKeyFor(event)
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
 * #785 makes the keyed write's guard the RESOLVED target rather than the event's own id, so an arm
 * that carries none can reach the conversation on screen. Since #1559 that is `reconnected` alone: a
 * session boundary is filed into the chat its frame names, never the one on screen. `getOpenConversationId` MUST be a stable
 * module-level constant: it is the effect's only dependency, so an inline arrow would resubscribe on
 * every `App` render instead of holding one listener for the app's lifetime. The dependency array names
 * it rather than staying `[]`, which is honest about that requirement rather than hiding it.
 *
 * #1013 makes this the CLOCK's composition root for the assistant side: `Date.now` is passed as
 * `subscribeTimeline`'s third argument, referenced rather than called, exactly as `window.pyry.onDaemonEvent`
 * is passed beside it. It is a plain third argument and not an effect dependency because `Date.now` is a
 * module-level intrinsic whose identity never changes — the array stays `[getOpenConversationId]` and no
 * resubscribe is introduced. This wiring is not compile-enforced (the parameter is optional, for the
 * cascade reason stated on `subscribeTimeline`); `timelineBridge.test.ts` pins it at the `subscribeTimeline`
 * seam instead, since this hook's effect never runs under `renderToStaticMarkup`.
 */
export function useTimelineBridge(getOpenConversationId: () => string | null): void {
  useEffect(
    () =>
      subscribeTimeline(
        window.pyry.onDaemonEvent,
        (event, conversationId, joinKey) => {
          timelineStore.getState().dispatch(event)
          const target = timelineWriteTarget(event, conversationId, getOpenConversationId)
          if (target !== null) {
            // #1225 — the join key rides the SAME write as the fold it describes, so the store can
            // decline to record it when the fold turns out to change nothing. `subscribeTimeline` has
            // already withheld it for an event whose slice was resolved from the screen rather than
            // from the event; nothing here re-derives that.
            conversationTimelineStore.getState().dispatchFor(target, event, joinKey)
          }
        },
        Date.now
      ),
    [getOpenConversationId]
  )
}
