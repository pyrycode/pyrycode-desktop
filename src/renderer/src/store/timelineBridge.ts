import type { DaemonEvent, HistoryTimelineEvent } from '@shared/ipc/events'
import type { ThreadEvent } from './threadTimeline'

const MAX_EVENT_TS_CHARS = 64

// Pure translation shared by event-contract tests. No content subscription or reconstruction.

function assertNever(event: never): never {
  throw new Error(`Unhandled daemon event: ${JSON.stringify(event)}`)
}

export function translateTimelineEvent(
  event: DaemonEvent | HistoryTimelineEvent,
  now?: () => number
): ThreadEvent | null {
  switch (event.type) {
    case 'sessionStateCleared':
    case 'threadReply':
    case 'threadQueryFailed':
    case 'threadUpdate':
    case 'threadRepairNeeded':
      return null // The daemon-built thread consumer owns these additive events.
    case 'messageDelivery':
      return { type: event.type, messageId: event.messageId, status: event.status,
        serverId: 'serverId' in event && typeof event.serverId === 'string' ? event.serverId : null }
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
        parentToolUseId: event.parentToolUseId,
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
    case 'sessionError':
      return { type: 'sessionError', code: event.code }
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
      const parsed = ts !== undefined && ts.length <= MAX_EVENT_TS_CHARS ? Date.parse(ts) : NaN
      return {
        type: 'userText', received: true, text: event.message.text,
        messageId: event.message.message_id,
        queuedMsgId: event.message.queued_msg_id,
        sentNow: event.message.sent_now,
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
    case 'switchAgentRejected':
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
    case 'replySuggestion': // Transient composer state; exclude text from exhaustive errors.
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
    case 'hostSystemPromptReceived':
    case 'hostSystemPromptFailed':
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
