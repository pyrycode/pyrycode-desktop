// The typed event pipe from the background process to the renderer window: one sealed
// discriminated union plus the channel it travels on, imported by both process sides. This
// is the event-pipe half of the background↔window bridge (#18); the command half is #17.
//
// The session-lifecycle members reuse a wire payload type from ../wire/types verbatim; the
// debug-bundle members (#168) carry only a count, a local filesystem path, and a closed
// category enum — never a token, key, raw frame, or bundle bytes. AC4 is enforced by
// construction: no member has a field that could hold a secret (QrPayload/HelloClientPayload
// tokens, InnerFrameV2 bytes are not referenced here), so a developer cannot serialize one
// onto this channel.
//
// Imported by src/main and src/preload, which have no @shared path alias — hence the
// relative import here and in those callers (see tsconfig.node.json).
import type {
  HelloAckPayload,
  MessagePayload,
  ErrorPayload,
  ConversationSummary,
  ConversationCreatedPayload,
  ConversationUpdatedPayload,
  RecentWorkspace,
  QueuedItem,
  BackgroundTask,
  WireTurnState,
  WireSessionTransitionReason,
  WireUnrecognizedSite,
  WireModalClass,
  WireModalSource,
  WireModalOption
} from '../wire/types'

/** The IPC channel every typed daemon event travels on, main → renderer.
 *  Single source of truth: the emit helper sends on it, the preload subscribes to it.
 *  A mismatch would silently drop every event, so both sides reference this constant. */
export const DAEMON_EVENT_CHANNEL = 'pyry:daemon-event' as const

/**
 * The coarse, closed set of user-facing debug-bundle failure categories (#168). Deliberately
 * information-minimising: the orchestrator (#169) collapses the transport's finer
 * BundleFailReason set plus any save errno onto these three, so the renderer never learns
 * transport internals. Carries no message, stack, or secret — just a category.
 */
export type DebugBundleFailure = 'unavailable' | 'stream-corrupt' | 'write-failed'

/**
 * The relay-socket leg's state category (#328), mirroring mobile's RelayLinkStatus where it maps
 * cleanly: 'connected' = socket up; 'offline' = socket dropped (an ordinary retryable close);
 * 'daemon-absent' = relay reachable but no daemon registered behind it (the relay's 4404 close). No
 * Reconnecting-countdown category — the supervisor exposes no remaining-backoff, so desktop cannot
 * honestly emit it (out of scope). A closed, information-minimising enum: it carries no token, key,
 * raw frame, close code, or payload byte — only the display category.
 */
export type RelayLinkStatus = 'connected' | 'offline' | 'daemon-absent'

/**
 * A single typed event from the background process to the renderer window. Sealed
 * discriminated union on `type`. The session-lifecycle members
 * (connecting | connected | disconnected | failed | messageReceived | messagesReceived) map
 * 1:1 onto the session-store's SessionAction arms — #19 maps them with no gaps and no spares.
 * The debug-bundle members (debugBundleProgress | debugBundleSaved | debugBundleFailed, #168) map
 * to NO SessionAction — the download UI (#72) consumes them, not the session store, so the
 * renderer bridge translates them to `null` (see daemonEventBridge).
 *
 * Spans transport-lifecycle events (`connecting`/`disconnected`, from the transport
 * supervisor) and daemon-originated events (`connected`/`failed`/messages, derived from
 * validated wire envelopes upstream). Never carries a token, key, raw frame, or bundle bytes
 * (AC4): the session members reuse only wire payload types, and the debug-bundle members carry
 * only a count, a local path, and the closed DebugBundleFailure enum. Session member and field
 * names mirror SessionAction's so #19's mapping is near-identity, while the two unions stay
 * separately declared per layer.
 */
export type DaemonEvent =
  | { type: 'connecting' }
  | { type: 'connected'; ack: HelloAckPayload }
  | { type: 'disconnected' }
  | { type: 'failed'; error: ErrorPayload }
  | { type: 'messageReceived'; message: MessagePayload }
  | { type: 'messagesReceived'; messages: readonly MessagePayload[] }
  | { type: 'debugBundleProgress'; chunksReceived: number }
  | { type: 'debugBundleSaved'; path: string }
  | { type: 'debugBundleFailed'; reason: DebugBundleFailure }
  // The run-configuration arm (#491). Six fields: the session's `model` / `effort` / `yolo` plus its
  // two context-window ints (#191), and the `sessionId` the run-config sheet needs to address a
  // set_session_settings to. All six come from the dedicated `session_settings` reply.
  //
  // The sheet was moved onto that reply at #491/#500, off the screen-photograph path it read
  // before: a screen_snapshot is refused outright whenever there is no terminal to photograph —
  // which is always, on the stream-json interactive runner — so the sheet was inert in production.
  // That is why this arm exists, and why its values must keep coming from a reply the runner
  // actually answers.
  //
  // `sessionId: ''` is a real value meaning "the daemon has no session to address" and MUST NOT be
  // coerced to null; the sheet's gate treats it as not-addressable. A session id is a routing id,
  // not a secret (the conversation_id / sessionTransition convention), and no token, key, raw
  // frame, or rendered screen `text` can ride this arm.
  | {
      type: 'runConfigReceived'
      sessionId: string
      model: string
      effort: string
      yolo: boolean
      used_tokens: number
      window_tokens: number
    }
  // The two v2 interactive-stream arms (#199). `text` IS the render payload (#203) and crosses IPC
  // deliberately — the boundary defended upstream is the fail-closed decode, not this internal
  // channel. Consumed by the renderer timeline bridge (#202), not the session store. camelCase per AC3.
  //
  // assistantDelta carries `conversationId` (#751) — the frame's `conversation_id`, copied BY NAME at the
  // emit from an already-validated payload, never by spreading the decoded payload. The decode already
  // required it and this ticket did not touch that: a missing or non-string `conversation_id` fails the
  // whole line without emitting. The "turn-stream item, or daemon state?" test that governs the status
  // arms answers differently here and the id crosses anyway — a delta IS a turn-stream item, and it
  // carries the id not to report per-conversation state but because a slice of assistant text has to be
  // filed in the right thread, and a consumer cannot route what it cannot attribute (#675). REQUIRED,
  // never optional: an optional routing key invites `?? activeConversation` fallbacks, which is the
  // misattribution this work exists to remove.
  //
  // The id is a daemon-asserted ROUTING KEY, not rendered text — none of the untrusted-text warnings that
  // attach to `text` on this same arm attach to it. It is never markup, a filename, a cache key, a lookup
  // path, an attribute or a URL, and it reaches no log sink (emitDaemonEvent is log-free by construction,
  // and the decode-side assistant_delta log is pinned content-free independently). It STOPS at the
  // renderer timeline bridge (#202), which rebuilds a fresh ThreadEvent from named fields and omits it;
  // ThreadEvent does not carry it, and the consumers that route by conversation are #756. No token, key,
  // or raw frame.
  //
  // Stateless and un-coalesced: N frames produce N events in arrival order, `seq` rides along for wire
  // fidelity but is not consulted, and merging slices into one bubble is the reducer's job. The added
  // field brings no per-id buffer, dedup, last-seq memo or ordering check with it.
  | { type: 'assistantDelta'; turnId: string; seq: number; text: string; conversationId: string }
  // turnEnd closes the turn and carries turnId / stopReason plus `conversationId` (#752) — the frame's
  // `conversation_id`, copied BY NAME at the emit from an already-validated payload, never by spreading
  // the decoded payload. It crosses for the reason the delta arm above carries it, on the same terms:
  // REQUIRED never optional (an optional routing key invites `?? activeConversation` fallbacks, which is
  // the misattribution this work exists to remove), a daemon-asserted ROUTING KEY rather than rendered
  // text, and a fail-closed decode — a missing or non-string id fails the whole line without emitting.
  // A turn boundary that cannot be attributed closes the wrong thread's turn (#675). It STOPS at the
  // renderer timeline bridge, which rebuilds a fresh ThreadEvent from named fields and omits it;
  // ThreadEvent does not carry it, and the consumers that route by conversation are #756. No token,
  // key, or raw frame.
  | { type: 'turnEnd'; turnId: string; stopReason: string; conversationId: string }
  // The coarse turn-lifecycle arm (#214, widened by #724). Carries `state` (a closed 3-value wire enum)
  // and `conversationId` — the frame's `conversation_id`, copied BY NAME at the emit from an
  // already-validated payload (the decode stays fail-closed: a missing or non-string id fails the whole
  // line). It crosses for the reason backgroundTaskStarted's does — the "turn-stream item, or daemon
  // state?" test — and per-conversation phase is daemon state: the sidebar must say a chat is thinking
  // while the operator looks at a different one (#674). REQUIRED, never optional: an optional routing key
  // invites `?? activeConversation` fallbacks, which is the misattribution this work exists to remove.
  //
  // The id is a daemon-asserted ROUTING KEY, not rendered text — none of the untrusted-text warnings on
  // `model` / `description` / `raw` attach to it. It is never markup, a filename, a cache key, a lookup
  // path, an attribute or a URL, and it reaches no log sink (emitDaemonEvent is log-free by construction).
  // It STOPS at the renderer timeline bridge (#202), which rebuilds a fresh ThreadEvent with named fields
  // and omits it → `phase`, not the session store; ThreadEvent does not carry it, and the consumers that
  // key off the id are #674. No token, key, or raw frame.
  | { type: 'turnState'; state: WireTurnState; conversationId: string }
  // The stall-liveness arm (#315, widened by #732). Carries `conversationId` — the wire StallPayload's
  // only field (`conversation_id`), copied BY NAME at the emit from an already-validated payload (the
  // decode stays fail-closed: a missing or non-string id fails the whole line). It crosses for the reason
  // turnState's and backgroundTaskStarted's do — the "turn-stream item, or daemon state?" test — and
  // per-conversation liveness is daemon state: the sidebar must show that a chat has gone quiet while the
  // operator looks at a different one (#674). REQUIRED, never optional: an optional routing key invites
  // `?? activeConversation` fallbacks, which is the misattribution this work exists to remove.
  //
  // The id is a daemon-asserted ROUTING KEY, not rendered text — none of the untrusted-text warnings on
  // `model` / `description` / `raw` attach to it. It is never markup, a filename, a cache key, a lookup
  // path, an attribute or a URL, and it reaches no log sink (emitDaemonEvent is log-free by construction,
  // and the decode-side stall log is pinned content-free independently). It STOPS at the renderer
  // timeline bridge (#202), which rebuilds a fresh ThreadEvent and omits it; ThreadEvent stays nullary,
  // and the consumers that key off the id are #674. No token, key, or raw frame.
  //
  // Onset-only; the client self-clear on next turn activity is the render slice's concern (#317), and the
  // added field brings no dedup or timer state with it. Consumed by the render slice #317 (not yet
  // built), so all three exhaustive bridges no-op it for now — the sessionSettingsRejected-was-a-no-op
  // precedent.
  | { type: 'stallDetected'; conversationId: string }
  // The api-retry arm (#492, widened by #737) — claude is retrying against an API error. It carries the
  // edge (`active` — true is the rising edge, false the explicit falling one) and the attempt counter
  // (`current` / `total`), because the render slice #493 shows "attempt N/M" and the wire gives it
  // nowhere else, plus `conversationId` — the frame's `conversation_id`, copied BY NAME at the emit from
  // an already-validated payload (the decode stays fail-closed: a missing or non-string id fails the
  // whole line). It crosses for the reason turnState's and stallDetected's do — the "turn-stream item, or
  // daemon state?" test — and per-conversation retry is daemon state: the sidebar must show that a chat
  // is stuck retrying while the operator looks at a different one (#674). REQUIRED, never optional: an
  // optional routing key invites `?? activeConversation` fallbacks, which is the misattribution this work
  // exists to remove.
  //
  // The id is a daemon-asserted ROUTING KEY, not rendered text — none of the untrusted-text warnings on
  // `model` / `description` / `raw` attach to it. It is never markup, a filename, a cache key, a lookup
  // path, an attribute or a URL, and it reaches no log sink (emitDaemonEvent is log-free by construction,
  // and the decode-side api_retry log is pinned content-free independently). It STOPS at the renderer
  // timeline bridge (#202), which rebuilds a fresh ThreadEvent from named fields and omits it;
  // ThreadEvent keeps its four, and the consumers that key off the id are #674. No token, key, or raw
  // frame.
  //
  // NOT onset-only and NOT deduped: the daemon re-fires the rising edge as the count climbs, and the
  // transport holds no state, so a consumer sees exactly one event per daemon frame (including a verbatim
  // repeat) — and the added field brings no dedup, coalescing, timer or per-id memo with it. `current: 0`
  // with `total: 0` is the legitimate "retrying, count unknown" value — #493 must format it defensively
  // (never a literal "0/0", never `current / total` without handling the NaN) since the decoder
  // type-checks but does not range-check. Ships dormant: all three exhaustive bridges no-op it until
  // #493 — the stallDetected-was-a-no-op-until-#317 precedent.
  | { type: 'apiRetry'; active: boolean; current: number; total: number; conversationId: string }
  // The compaction-status arm (#495, widened by #742) — claude is auto-compacting the conversation. Like
  // apiRetry it carries the edge (`active` — true is compaction starting, false the explicit falling
  // edge), but BANNER-ONLY: the wire streams no compaction progress, so there is no counter to carry and
  // #496 must not invent one. It carries `conversationId` alongside the edge — the frame's
  // `conversation_id`, copied BY NAME at the emit from an already-validated payload (the decode stays
  // fail-closed: a missing or non-string id fails the whole line). It crosses for the reason turnState's,
  // stallDetected's and apiRetry's do — the "turn-stream item, or daemon state?" test — and
  // per-conversation compaction is daemon state: the sidebar must show a chat is busy compacting while the
  // operator looks at a different one (#674). REQUIRED, never optional: an optional routing key invites
  // `?? activeConversation` fallbacks, which is the misattribution this work exists to remove.
  //
  // This arm's safety argument used to rest on the ABSENCE of a string. That argument is REPLACED, not
  // softened: it now rests on the NATURE of the string, the same one its three status neighbours above
  // already make. The id is a daemon-asserted ROUTING KEY, not rendered text — none of the untrusted-text
  // warnings on `model` / `description` / `raw` attach to it. It is never markup, a filename, a cache key,
  // a lookup path, an attribute or a URL, and it reaches no log sink (emitDaemonEvent is log-free by
  // construction, and the decode-side compacting log is pinned content-free independently). It STOPS at
  // the renderer timeline bridge (#202), which rebuilds a fresh ThreadEvent from named fields and omits
  // it; ThreadEvent keeps its one bool, and the consumers that key off the id are #674 — where an unknown
  // id must be an explicit no-match, never a fallback onto the open conversation. No token, key, or raw
  // frame.
  //
  // NOT onset-only and NOT deduped: the transport holds no state, so a consumer sees exactly one event per
  // daemon frame (including a verbatim repeat), and #496 is idempotent on the repeat — and the added field
  // brings no dedup, coalescing, timer or per-id memo with it. Ships dormant: all three exhaustive bridges
  // no-op it until #496 — the apiRetry-was-a-no-op-until-#493 precedent.
  | { type: 'compacting'; active: boolean; conversationId: string }
  // The announced-model arm (#587) — what claude named as the model it resolved for the turn, off its
  // `system` / `init` line. Neither a claude sub-state like its three status neighbours above nor a
  // daemon mapping gap like unrecognizedMessage: an IDENTITY report, answering what the spawn argument
  // cannot — the daemon knows what it REQUESTED, only claude knows what it GOT.
  //
  // `model` COLLIDES BY NAME WITH AN ARM ABOVE AND MEANS THE OPPOSITE THING. runConfigReceived
  // carries a `model: string` meaning the per-session OVERRIDE, where `''` means "inherited default,
  // no override". This one means what claude ANNOUNCED, and in the ordinary case the two disagree:
  // the override is `''` while claude has named a concrete model. Both values are destined for the
  // same run-configuration sheet, so the collision is live rather than theoretical. The daemon's wire
  // field name is kept (no drift, ADR 0002) and the distinction is drawn here, the way the daemon's
  // own payload doc draws it.
  //
  // The identifier is VERBATIM: not reliably dated, and it need not appear in any published model list
  // (requesting `claude-haiku-4-5` yields it back undated), so a MISS on #588's lookup is ORDINARY,
  // not an error — and #588 must not normalise, lowercase, allow-list, or regex a family out of it.
  //
  // `truncated` is LOAD-BEARING: a reader that ignores it presents claude's cut text as complete. It is
  // sharper here than on unrecognizedMessage, because a cut identifier always misses #588's exact
  // lookup and so always renders verbatim, looking exactly like a legitimate unrecognised model.
  // `false` is a VALUE (nothing was cut), never an absence, and the decoder never defaults it.
  //
  // SECURITY: `model` is UNTRUSTED, model-influenced daemon-relayed text that crossed the subprocess
  // trust boundary. The daemon BOUNDS it (256 bytes) but does NOT SANITIZE it — no control-character or
  // terminal-escape stripping happens anywhere on this path — so #588 and its render surface must treat
  // it as PLAIN TEXT ONLY, NEVER HTML (no innerHTML / dangerouslySetInnerHTML), never into an attribute
  // or a URL, mirroring the identical warning on unrecognizedMessage / backgroundTaskStarted. It is a
  // REPORT, NEVER A CONTROL INPUT: no security-relevant behaviour may branch on it, and it is not a
  // cache key, a filename, or a lookup path. This slice has no DOM sink; the constraint is inherited
  // here for #588.
  //
  // Carries `conversationId` alongside `model` and `truncated` (#714) — the frame's `conversation_id`,
  // copied BY NAME at the emit from an already-validated payload (the decode stays fail-closed: a missing
  // or non-string id fails the whole line, and parseModelAnnouncedPayload is untouched). It crosses by the
  // RULE, not by comparison with a neighbour: this frame carries no `turn_id` and opens and closes no
  // turn, so it is daemon STATE rather than a turn-stream item — the same test backgroundTaskStarted and
  // queueState keep it under (#720). Per-conversation attribution is what #588 / #674 need in order to say
  // WHICH chat announced WHICH model. REQUIRED, never optional: an optional routing key invites
  // `?? activeConversation` fallbacks, which is the misattribution this work exists to remove.
  //
  // This arm's safety argument used to be ARITHMETIC — that dropping the id left exactly one untrusted
  // string crossing here rather than two. That argument is REPLACED, not renumbered: counting the strings
  // was never what made them safe, and re-counting to two would assert that `conversationId` is untrusted
  // text of the same kind as `model`, which it is not. It now rests on the NATURE of each string, and the
  // two are NOT of one kind. `model` keeps every warning above IN FULL. The id is a daemon-asserted
  // ROUTING KEY, not rendered text and not model-influenced — it is never markup, a filename, a cache key,
  // a lookup path, an attribute or a URL, and it reaches no log sink (emitDaemonEvent is log-free by
  // construction, and the decode-side model_announced log is pinned content-free independently). It STOPS
  // at the announced-model bridge (#588), which rebuilds a fresh two-field literal from named fields;
  // AnnouncedModel keeps `model` + `truncated`, and the consumers that route by conversation are
  // #588 / #674 — where an unknown id must be an explicit no-match, never a fallback onto the open
  // conversation. No token, key, or raw frame.
  //
  // NOT deduped: the transport holds no state, so a consumer sees exactly one event per daemon frame,
  // including a verbatim repeat — which is what tells #588 the value is still current, and the added field
  // brings no dedup, coalescing, timer or per-id memo with it. Ships dormant: all three exhaustive bridges
  // no-op it until #588 — the compacting-was-a-no-op-until-#496 precedent.
  | { type: 'modelAnnounced'; model: string; truncated: boolean; conversationId: string }
  // The background-task open arm (#564) — claude started work that OUTLIVES the turn that spawned it
  // (pyrycode#1240), the frame that separates that case from a genuine finish.
  //
  // Carries `conversationId`, as every turn-stream arm now does (#675 finished with #766). The
  // test is "turn-stream item, or daemon state?", not "does the frame have the field": this one carries
  // NO turn_id, opens and closes no turn, and the daemon doc says a client renders it "as its own thread
  // of activity, not as part of the turn it appeared in" — the same characterization queue_state got in
  // #720, and queueState keeps it for the same reason (replacement-truth state a store keys by id). The
  // task store (#567) attributes by id, so dropping it here would make that slice unbuildable.
  //
  // `toolCallId` is the wire `tool_call_id` (NOT `tool_use_id`, despite toolUse / toolResult spelling it
  // that way); the VALUE is the same identifier those two carry, which is what lets #567 join all three
  // background-task frames with no lookup. `taskType` is an OPEN string — `local_bash` is the only
  // observed value and one observation does not earn an enum. `truncatedFields: null` means NOTHING WAS
  // CUT and must not be collapsed into `[]`; it is load-bearing, since a reader that ignores it presents
  // claude's cut text as complete.
  //
  // SECURITY: `description` and `taskType` are UNTRUSTED, model-influenced daemon-relayed text, and for
  // `taskType: local_bash` the `description` IS the literal command line claude ran. The panel slice
  // (#568) must render both as PLAIN TEXT, NEVER HTML (no innerHTML / dangerouslySetInnerHTML), never
  // into an attribute or a URL, and must never execute or re-shell it — mirroring the identical warning
  // on queueState / conversationCreated / unrecognizedMessage, sharpened by the command-line hazard. This
  // slice has no DOM sink; the constraint is inherited here. No token, key, or raw frame can ride the arm
  // (five bounded opaque strings and a list of wire field names is the whole payload). Ships dormant: all
  // three exhaustive bridges no-op it until #567 — the apiRetry-was-a-no-op-until-#493 precedent.
  | {
      type: 'backgroundTaskStarted'
      conversationId: string
      taskId: string
      toolCallId: string
      description: string
      taskType: string
      truncatedFields: readonly string[] | null
    }
  // The background-task update arm (#565) — the PEER of the arm above, joined on `taskId`: that frame
  // opens a task, this one reports what CHANGED about it afterwards. FOUR fields, not six: no
  // `toolCallId`, no `description`, no `taskType`, and it gains `patch`.
  //
  // Carries `conversationId` for the sibling's reason, which is settled in-family rather than argued
  // fresh: the test is "turn-stream item, or daemon state?", and this frame carries NO turn_id and opens
  // and closes no turn, so it follows the queue_state rule (#720). The task store (#567) attributes by
  // id, so dropping it here would make that slice unbuildable.
  //
  // `patch` IS AN OPAQUE DISPLAY BLOB THAT IS NOT GUARANTEED TO PARSE. The daemon truncates it at
  // construction, so a truncated object is no longer valid JSON — its own golden fixture is cut
  // mid-token. A consumer that wants its keys must parse BEHIND AN ERROR BRANCH that falls back to inert
  // text, and must never enumerate a closed key set (the daemon enumerates none, because a mapping that
  // listed the keys it knew would silently discard every key claude ships next). `patch: ''` means claude
  // sent no change — a VALUE, not an absence. `truncatedFields: null` means NOTHING WAS CUT and must not
  // be collapsed into `[]`; it reports the CAP CUT ONLY, so `patch` may differ from claude's bytes
  // without appearing there (the daemon also scrubs invalid UTF-8 by deletion) — record it, never
  // cross-check it.
  //
  // SECURITY: `patch` is UNTRUSTED, model-influenced daemon-relayed text whose keys may carry command
  // text exactly as the sibling's `description` does. The panel slice (#568) must render it as PLAIN
  // TEXT, NEVER HTML (no innerHTML / dangerouslySetInnerHTML), never into an attribute or a URL, and
  // must never execute or re-shell it — the daemon doc states this rule in THIS frame's section rather
  // than delegating it to the sibling, because a patch's structured shape makes it the more tempting
  // thing to feed somewhere that runs it. This slice has no DOM sink and runs no JSON.parse; the
  // constraint is inherited here. No token, key, or raw frame can ride the arm (three bounded opaque
  // strings and a list of wire field names is the whole payload). Ships dormant: all three exhaustive
  // bridges no-op it until #567 — the apiRetry-was-a-no-op-until-#493 precedent.
  | {
      type: 'backgroundTaskUpdated'
      conversationId: string
      taskId: string
      patch: string
      truncatedFields: readonly string[] | null
    }
  // The background-task roster arm (#566) — the AGGREGATE PEER of the two arms above: they report what
  // happened to ONE task, this reports the WHOLE LIVE SET. Three fields: one id, the rows, and a count.
  //
  // A SNAPSHOT, NOT A DELTA. Each frame replaces the reader's view of what is running rather than
  // amending it, so #567 REPLACES its held set per frame rather than merging into it. `tasks: []` is a
  // POSITIVE STATEMENT THAT NOTHING IS ALIVE — the payoff signal for pyrycode#1240 — and must be emitted
  // and consumed, NEVER dropped, filtered, or coalesced as "no news".
  //
  // Top-level fields are snake→camel; THE ROW TYPE IS REUSED VERBATIM with snake_case fields. That is not
  // an inconsistency to fix but the settled house rule for nested arrays, with two precedents (queueState
  // above and conversationsReceived): the row narrower already stripped each row to its known fields, so
  // there is nothing to drop and no mapping to write. `readonly` on the array mirrors queueState; the row
  // interface itself stays mutable, exactly like QueuedItem.
  //
  // Carries `conversationId` for the siblings' reason, settled in-family rather than argued fresh: the
  // test is "turn-stream item, or daemon state?", and this frame carries NO turn_id and opens and closes
  // no turn, so it follows the queue_state rule (#720). The task store (#567) attributes by id.
  //
  // `droppedTasks` is this frame's ONLY truncation report — there is deliberately no top-level
  // truncatedFields — so THE TRUE ROSTER SIZE IS `tasks.length + droppedTasks`, and a panel that shows
  // only the carried rows silently presents a capped roster as the whole one. `0` is a VALUE, never
  // consulted for truthiness. Each row's `truncated_fields: null` means nothing was cut FOR THAT ROW, is
  // distinct from `[]`, and is per-row: never hoist or flatten the lists across rows. `task_type` is an
  // OPEN string. NO TERMINAL EVENT EXISTS IN THIS FAMILY by design, so "finished" is a client conclusion
  // drawn from a task's absence in a LATER roster — legitimate for #567 to draw on its own terms, never
  // something to present as reported by the daemon.
  //
  // SECURITY: each row's `description` is UNTRUSTED, model-influenced daemon-relayed text and for
  // `task_type: local_bash` IS THE LITERAL COMMAND LINE claude ran. The panel slice (#568) must render it
  // as PLAIN TEXT, NEVER HTML (no innerHTML / dangerouslySetInnerHTML), never into an attribute or a URL,
  // and must never execute or re-shell it. The daemon states this rule PER ROW rather than delegating it
  // to the scalar frames, and its reason is the temptation unique to this arm: A LIST OF COMMAND LINES IS
  // A MORE TEMPTING SHAPE TO FEED SOMEWHERE STRUCTURED THAN A SINGLE ONE — treat `tasks` as a DISPLAY
  // list, never as a structured work list something iterates and acts on. This slice has no DOM sink; the
  // constraint is inherited here. No token, key, or raw frame can ride the arm (one id, a bounded list of
  // four-field rows, and a count is the whole payload). Ships dormant: all three exhaustive bridges no-op
  // it until #567 — the apiRetry-was-a-no-op-until-#493 precedent.
  | {
      type: 'backgroundTaskRoster'
      conversationId: string
      tasks: readonly BackgroundTask[]
      droppedTasks: number
    }
  // The unrecognized-message arm — the daemon's stream parser met claude output it has no mapping for.
  // Unlike its three status-peer neighbours above, this one is NOT a claude sub-state: it reports a gap
  // in the DAEMON's own mapping, and it is the reason the drop is visible at all (the daemon's own debug
  // log is not printed in production, so before this the drop left no trace anywhere).
  //
  // A DELIBERATE, security-reviewed WIDENING, and the widest on this union: `raw` is unbounded,
  // unstructured, model-adjacent JSON. It crosses IPC for the same reason `assistantDelta.text` does —
  // the raw text IS the render payload, and there is no summary that could replace it, because
  // the whole point is showing an operator the bytes we could not interpret. The boundary defended is
  // the fail-closed decode upstream (parseUnrecognizedMessagePayload: closed-enum `site`, required
  // strings, required boolean), not this internal channel. The daemon caps `raw` at 16 KiB and the
  // frame-level MAX_PLAINTEXT_BYTES guard (65519) backstops it, so the string is bounded before it gets
  // here — twice, by two independent limits.
  //
  // `raw` and `messageType` are UNTRUSTED daemon-relayed content: the consumer must render them as PLAIN
  // TEXT, NEVER HTML (no innerHTML / dangerouslySetInnerHTML) and never into an attribute or a URL —
  // mirroring the identical warning on conversationCreated / sessionTransition / queueState. React
  // escapes text children, so a `<pre>{raw}</pre>` is inert; those two sinks are the only ways to
  // break that, and neither appears in the consumer.
  //
  // `messageType` is deliberately allowed to be the empty string — the `undecodable` site means nothing
  // decoded, so no type was ever read.
  //
  // It carries `conversationId` (#784) — the frame's `conversation_id`, copied BY NAME at the emit from
  // an already-validated payload, never by spreading the decoded payload. The decode already required it
  // and this ticket did not touch that: a missing or non-string `conversation_id` fails the whole line
  // without emitting. REQUIRED, never optional: an optional routing key invites the `?? activeConversation`
  // fallback #675 exists to remove. A parser-gap row that cannot be attributed lands in the wrong thread —
  // and once the screen reads its own conversation's slice (#758), in no thread at all, which would make
  // an otherwise-silent gap in the daemon's stream mapping silent again.
  //
  // The id is a daemon-asserted ROUTING KEY, not rendered text — none of the untrusted-text warnings that
  // attach to `raw` and `messageType` above attach to it. It is never markup, a filename, a cache key, a
  // lookup path, an attribute or a URL, and it reaches no log sink (emitDaemonEvent is log-free by
  // construction, and the decoder's own messages name the failure CATEGORY only, never this id). It STOPS
  // at the renderer timeline bridge (#202), which rebuilds a fresh ThreadEvent from named fields and omits
  // it; ThreadEvent does not carry it, and the consumer that routes by it is the keyed holder (#755/#756).
  // Not dormant: that bridge owns the arm and reduceTimeline tail-appends a real row for it.
  | {
      type: 'unrecognizedMessage'
      conversationId: string
      site: WireUnrecognizedSite
      messageType: string
      raw: string
      truncated: boolean
    }
  // The session-boundary arm (#254, widened #285). Carries the four render fields the delimiter slice
  // (#286) needs: `newSessionId` (the addressing key the #259 holder retains), `reason` (the closed
  // WireSessionTransitionReason enum, carried so #286's title switch stays exhaustive — NOT a bare
  // string), `occurredAt` (RFC3339Nano, an opaque unparsed string), and `workspaceCwd` (`string | null`
  // — the new workspace dir for a `workspace_change`, `null` for `clear` / `idle_evict`, wire nullability
  // PRESERVED, never coerced to ''). Only `previous_session_id` is dropped at the emit (#285) — it has no
  // consumer. A session_id is a routing id, not a secret (the conversation_id convention), so no token,
  // key, or raw frame can ride this arm. `workspaceCwd` is an UNTRUSTED daemon-supplied filesystem
  // path: the render slice #286 must render it as plain text, NEVER HTML (no innerHTML /
  // dangerouslySetInnerHTML) — mirroring the identical warning on conversationCreated /
  // conversationUpdated. This ticket has no DOM sink; the constraint is inherited here for #286.
  // Consumed by the renderer holder (#259) and the delimiter slice (#286, not yet built), so all three
  // exhaustive bridges no-op it for now — matching how stallDetected was a no-op in daemonEventBridge
  // until #317.
  | {
      type: 'sessionTransition'
      newSessionId: string
      reason: WireSessionTransitionReason
      occurredAt: string
      workspaceCwd: string | null
    }
  // The set_session_settings confirmation arm (#264, correlated by #261). Carries `sessionId` — the
  // reply's one wire field (a routing id, not a secret, the conversation_id / sessionTransition
  // convention) — plus `changeId`, the RENDERER-MINTED correlation key (#261) that main matched the
  // reply to by `Envelope.in_reply_to` and echoed back so the renderer can tell two same-`sessionId`
  // changes apart. `changeId` is client-minted, non-secret, and IPC-internal; it is NOT the wire
  // `in_reply_to` — that numeric routing id stays main-internal and never rides this arm. No token,
  // key, or raw frame can ride it (AC3-by-construction). Consumed by #256 (pending→confirm/reject
  // store, not yet built), so all three exhaustive bridges no-op it for now — the
  // sessionTransition-was-a-no-op-until-#259 precedent.
  | { type: 'sessionSettingsUpdated'; sessionId: string; changeId: string }
  // The set_session_settings REJECTION arm (#269), the rejected twin of sessionSettingsUpdated. Emitted
  // by the MAIN-side correlation gate (daemonConnection.ts) when a content-free daemon `error` (#116)
  // arrives whose `Envelope.in_reply_to` matches a pending set_session_settings request — the client
  // learns its model / effort / YOLO change was rejected so #256 can roll back. Carries ONLY `changeId`,
  // the RENDERER-MINTED correlation key (#261) that main matched the error to; it disambiguates two
  // outstanding changes to the same session (AC4). Deliberately NO `sessionId` (the wire `error` frame
  // is content-free — carries no session_id — and `changeId` alone disambiguates), NO `in_reply_to`
  // (that numeric wire routing id stays main-internal), and NO error code / message (attacker-influenceable
  // bytes; no consumer needs them). No token, key, or raw frame can ride it (AC1/AC4-by-construction).
  // Consumed by #256 (pending→confirm/reject store, not yet built), so all three exhaustive bridges no-op
  // it for now — the sessionSettingsUpdated-was-a-no-op precedent.
  | { type: 'sessionSettingsRejected'; changeId: string }
  // The tool-call arm (#217, widened by #763). Carries the five render fields plus `conversationId` —
  // the frame's `conversation_id`, copied BY NAME at the emit from an already-validated payload, never by
  // spreading it. REQUIRED never optional (an optional routing key invites the `?? activeConversation`
  // fallback #675 exists to remove), a daemon-asserted ROUTING KEY rather than rendered text on the terms
  // the modelAnnounced arm above states in full, and fail-closed by a decode that needed no change: a
  // missing or non-string id drops the whole line without emitting. A tool call that cannot be attributed
  // renders as a row in the wrong thread (#675). It STOPS at the renderer timeline bridge (#202), which
  // rebuilds a fresh ThreadEvent from named fields and omits it; ThreadEvent does not carry it, and the
  // consumers that route by conversation are #756.
  // Consumed by that bridge → a `toolCall` item, not the session store. `name` / `inputSummary` are
  // opaque daemon display text the render slice (#218) must render as plain text. No token, key, or raw
  // frame — `input` is a string→string record built solely from the decoded payload, so that claim
  // survives it.
  // `input` (#642) is the tool's own input fields, name → value. ABSENT means the WIRE omitted it (a
  // pre-pyrycode#1678 daemon) — test `event.input === undefined`, never `'input' in event`; an empty
  // map is a DIFFERENT fact ("this daemon sent no fields for this call") and is never collapsed into
  // absence. Both its keys and its values are untrusted daemon display text under the same
  // plain-text-NEVER-HTML constraint as `name` / `inputSummary`; the render slice (#645) owns that DOM
  // sink. Key order is meaningless (alphabetical, a Go map artefact), the map may be incomplete (the
  // daemon's total bound drops fields and names none — `inputSummary` stays the whole-input fallback),
  // and the reserved keys `__proto__` / `constructor` / `prototype` can never appear (dropped by the
  // decoder), so consumers must ITERATE rather than probe by key. See ToolUsePayload for the full
  // contract.
  | {
      type: 'toolUse'
      conversationId: string
      turnId: string
      toolUseId: string
      name: string
      inputSummary: string
      input?: Readonly<Record<string, string>>
    }
  // The tool-result arm (#229, widened by #766). Carries the four render fields plus `conversationId` —
  // the frame's `conversation_id`, copied BY NAME at the emit from an already-validated payload, never by
  // spreading it. REQUIRED never optional (an optional routing key invites the `?? activeConversation`
  // fallback #675 exists to remove), a daemon-asserted ROUTING KEY rather than rendered text on the terms
  // the modelAnnounced arm above states in full, and fail-closed by a decode that needed no change: a
  // missing or non-string id drops the whole line without emitting. A tool result that cannot be
  // attributed resolves a tool call in the WRONG thread (#675). It STOPS at the renderer timeline bridge
  // (#202), which rebuilds a fresh ThreadEvent from named fields and omits it; ThreadEvent does not carry
  // it, and the consumers that route by conversation are #756.
  // Consumed by that bridge, which folds it through `fillResult` to RESOLVE the correlated `toolCall`'s
  // result in place — not the session store; that correlation stays on `toolUseId` alone. `isError` is a
  // boolean (`false` = success, a value); `resultSummary` is opaque daemon display text the render slice
  // (#230) must render as plain text. No token, key, or raw frame.
  | {
      type: 'toolResult'
      conversationId: string
      turnId: string
      toolUseId: string
      isError: boolean
      resultSummary: string
    }
  // The queued-backlog arm (#292). Reuses the wire QueuedItem row type verbatim (the
  // conversationsReceived precedent) — snake_case, order preserved from the wire (enqueue order). Carries
  // `conversationId` (as every turn-stream arm now does) because the snapshot is REPLACEMENT-truth
  // and the #293 store keys its backlog by it. Consumed by the #293 queue store, NOT the session / timeline
  // / modal store — queue_state is daemon STATE, not a turn-stream item (#720), so all three exhaustive
  // bridges no-op it. `text` is UNTRUSTED daemon-relayed transit content the eventual render slice (#294)
  // must render as plain text, NEVER HTML (no innerHTML / dangerouslySetInnerHTML); this slice has no DOM
  // sink, but the constraint is inherited here. No token, key, or raw frame can ride this arm (AC5-by-
  // construction: QueuedItem holds only a numeric counter, opaque text, and a timestamp).
  | { type: 'queueState'; conversationId: string; queued: readonly QueuedItem[] }
  // The conversation-list arm (#139). Reuses the wire ConversationSummary row type verbatim (the
  // messagesReceived precedent) — snake_case, order preserved from the wire. Consumed by the
  // conversation-list store (#208), not the session store, so the session bridge maps it to `null`.
  // No token/key/raw frame — ConversationSummary carries only ids, a nullable title, two flags, a
  // workspace path (opaque display text), and two timestamps.
  | { type: 'conversationsReceived'; conversations: readonly ConversationSummary[] }
  // The conversation-created arm (#241). Reuses the wire ConversationCreatedPayload verbatim (the
  // conversationsReceived / messageReceived precedent) — nothing to drop, no secret field: it carries
  // an id, a flag, a nullable title, a workspace path, and a timestamp. Consumed by the render slice
  // (#242, which opens the new thread), not the session store, so every exhaustive consumer no-ops it.
  // `name` and `cwd` are UNTRUSTED daemon-supplied strings: the render slice #242 must render them as
  // plain text, NEVER HTML (no innerHTML / dangerouslySetInnerHTML). This ticket has no DOM sink, but
  // the constraint is inherited here — do not drop this warning.
  | { type: 'conversationCreated'; conversation: ConversationCreatedPayload }
  // The conversation-updated arm (#273). Reuses the wire ConversationUpdatedPayload verbatim (the
  // conversationCreated precedent) — nothing to drop, no secret field: it carries an id, a flag, a
  // nullable title, a workspace path, and a timestamp. Emitted from an UNSOLICITED daemon BROADCAST
  // (not correlated by in_reply_to). Consumed by the list-reflect slice (#275, which flips the row from
  // discussion to channel), not the session store, so every exhaustive consumer no-ops it. `name` and
  // `cwd` are UNTRUSTED daemon-supplied strings: the render/store slice #275 must render them as plain
  // text, NEVER HTML (no innerHTML / dangerouslySetInnerHTML). This ticket has no DOM sink, but the
  // constraint is inherited here — do not drop this warning.
  | { type: 'conversationUpdated'; conversation: ConversationUpdatedPayload }
  // The conversation-deleted arm (#375). Carries the BARE routing `id` (a fresh literal, not the wire
  // payload object): the sibling conversationUpdated reuses ConversationUpdatedPayload by reference
  // because it has five fields with nothing to drop, but a delete reply has exactly one field, and the
  // single-field emit idiom (sessionSettingsUpdated naming `sessionId`) is a
  // fresh literal naming individual fields — so this flattens to `id: string`. The renderer removes a row
  // by id, a bare string is exactly what it needs, and events.ts stays free of a ConversationDeletedPayload
  // import (a primitive crosses IPC). Emitted from a CORRELATED reply (matched by in_reply_to, NOT a
  // broadcast — the deliberate contrast with conversationUpdated), but the `id` is self-sufficient so no
  // correlation state is threaded. Consumed by the list-reflect slice (#376, not yet built), so every
  // exhaustive consumer no-ops it for now; ships DORMANT (the stallDetected-was-a-no-op-until-#317
  // precedent). No token, key, or raw frame can ride a bare string id (AC-by-construction).
  | { type: 'conversationDeleted'; id: string }
  // The recent-workspaces arm (#380). Reuses the wire RecentWorkspace row type verbatim (the
  // conversationsReceived precedent) — snake_case, order preserved from the wire (most-recent-first).
  // Consumed by the recent-workspaces store (#382), NOT the session store, so every exhaustive consumer
  // no-ops it. No token/key/raw frame — each row carries only a `path` (untrusted display text) and an
  // opaque `last_used_at` timestamp. `path` is an UNTRUSTED daemon-supplied filesystem path: the #382
  // render slice must render it as PLAIN TEXT, NEVER HTML (no innerHTML / dangerouslySetInnerHTML) and
  // must NEVER resolve it into a local filesystem operation (it is a remote daemon-side path). This
  // ticket has no DOM sink, but the constraint is inherited here — do not drop this warning.
  | { type: 'recentWorkspacesReceived'; recentWorkspaces: readonly RecentWorkspace[] }
  // The workspace-folder-created arm (#381). Carries the BARE created `path` (a fresh literal, not the
  // wire payload object): the sibling conversationCreated reuses ConversationCreatedPayload by reference
  // because it has five fields with nothing to drop, but this reply has exactly one field, so it flattens
  // to `path: string` — the single-field emit idiom (conversationDeleted naming `id`,
  // sessionSettingsUpdated naming `sessionId`): a fresh literal naming the one field, keeping
  // events.ts free of a WorkspaceFolderCreatedPayload import (a primitive crosses IPC). Emitted from a
  // CORRELATED reply (matched by in_reply_to, NOT a broadcast), but the `path` is self-sufficient so no
  // correlation state is threaded. `path` is an UNTRUSTED daemon-supplied REMOTE filesystem path: the
  // Create-folder dialog (#157, not yet built) must render it as PLAIN TEXT, NEVER HTML (no innerHTML /
  // dangerouslySetInnerHTML) and must NEVER resolve it into a local filesystem operation (it is a remote
  // daemon-side path). This ticket has no DOM sink, but the constraint is inherited here — do not drop this
  // warning. Consumed by #157, so every exhaustive consumer no-ops it for now; ships DORMANT (the
  // conversationDeleted-was-a-no-op-until-#376 precedent). No token, key, or raw frame can ride a bare
  // string path (AC-by-construction).
  | { type: 'workspaceFolderCreated'; path: string }
  // The create_workspace_folder REJECTION arm (#396), the rejected twin of workspaceFolderCreated.
  // Emitted by the MAIN-side correlation gate (daemonConnection.ts) when a content-free daemon `error`
  // (#116) arrives whose `Envelope.in_reply_to` matches a pending create_workspace_folder request — the
  // client learns its folder-creation request was rejected (a bad name — path separator, `..`, absolute,
  // or empty) so the Create-folder dialog (#398) can stay open for correction rather than spin forever.
  // BARE — carries NOTHING (contrast sessionSettingsRejected's `changeId` and modalAnswerRejected's
  // `modalId`, each of which disambiguates concurrent requests): only ONE create-folder dialog is open at
  // a time, so there is no concurrency to disambiguate, and the success twin workspaceFolderCreated carries
  // only `path` with no correlation key — the rejection twin is symmetric and, being bare, is maximally
  // content-free (AC3-by-construction: no field can hold a daemon-supplied byte, error code, message, path,
  // or wire id). Consumed by #397 (round-trip store, not yet built), so all three exhaustive bridges no-op
  // it for now — the workspaceFolderCreated-was-a-no-op precedent.
  | { type: 'workspaceFolderRejected' }
  // The notification-click arm (#393). UNLIKE every other arm, this is the FIRST MAIN-LOCAL signal on
  // the channel: it is NOT derived from a validated wire envelope — it is emitted by the main-process
  // notification click handler (index.ts) when the user clicks a fired OS notification, so the
  // emitDaemonEvent "nothing else sends on the channel" nuance now has exactly one main-local sender,
  // noted here rather than editing that helper. NULLARY by construction (AC3): it carries NO payload,
  // so no daemon-relayed content, conversation id, or wire field can ride it (mirroring
  // workspaceFolderRejected). Consumed by the notificationActivatedBridge (#393), which drives the
  // paired `open` nav (focus the window + show the single active conversation's thread) — a consume-only
  // filter bridge, so all three exhaustive bridges (session / timeline / modal) no-op it.
  | { type: 'notificationActivated' }
  // The two modal arms (#201). Field names/types mirror `ModalEvent` (modalPrompts.ts, #122) so the
  // #223 bridge is a thin snake→camel rename. Consumed by the modal store + bridge (#223), NOT the
  // session store or timeline store. `modalId` is the sole correlation key — no `conversation_id` is
  // carried (the wire carries none on a modal). `title` / `prompt` / `options[].label` are untrusted
  // `claude`-surfaced display text the render slice (#224) must render as plain text, never HTML.
  // No token, key, or raw frame (AC4).
  | {
      type: 'modalShown'
      modalId: string
      class: WireModalClass
      title: string
      prompt: string
      options: readonly WireModalOption[]
      defaultOptionId: string
    }
  | { type: 'modalDismissed'; modalId: string; outcome: string; source: WireModalSource }
  // The correlated modal-answer rejection arm (#248). Emitted by the MAIN-side correlation window
  // (daemonConnection.ts) when a content-free daemon `error` (#116) arrives while a `modal_answer` this
  // client sent (#236) is awaiting its reply — an ungranted device's answer round-trips to an `error`
  // that carries NO `modal_id` (ADR 0009), so attribution is the transport's own outstanding-answer
  // memory, never a field read from the untrusted `error`. Carries ONLY `modalId` — the one-time nonce
  // already renderer-visible from `modalShown` (#201), NEVER the daemon ErrorPayload text (AC4/AC3 by
  // construction: no field can hold the error content, a token, key, or raw frame). Consumed by the
  // modal bridge (#249, render), NOT the session or timeline store — so this slice ships the arm
  // DORMANT (every exhaustive bridge routes or no-ops it), matching how sessionTransition (#254) added
  // the arm + three bridge no-ops while its consumer (#259) waited.
  | { type: 'modalAnswerRejected'; modalId: string }
  // The relay-link status arm (#328). Content-free by construction (ADR 0007): carries ONLY the
  // closed RelayLinkStatus category — no token, key, raw frame, close code, or payload byte. Surfaces
  // the relay SOCKET leg (dialing / dropped) as a signal distinct from the session `connecting` /
  // `connected` / `failed` arms, so a later two-dot indicator can tell a relay-hop stall from a
  // daemon-hop stall. Consumed by the renderer relay-link store + bridge (#329, not yet built) → the
  // two-dot indicator (#330); ships DORMANT — all three exhaustive bridges no-op it (the
  // stallDetected-was-a-no-op-until-#317 precedent).
  | { type: 'relayLinkChanged'; status: RelayLinkStatus }
