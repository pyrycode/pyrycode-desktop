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
  WireTurnState,
  WireSessionTransitionReason,
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
 * The debug-bundle members (debugBundleProgress | debugBundleSaved | debugBundleFailed, #168)
 * and `snapshotReceived` (#180) map to NO SessionAction — they are consumed by the download UI
 * (#72) and the Run configuration render bridge (#181) respectively, not the session store, so the
 * renderer bridge translates them to `null` (see daemonEventBridge).
 *
 * Spans transport-lifecycle events (`connecting`/`disconnected`, from the transport
 * supervisor) and daemon-originated events (`connected`/`failed`/messages, derived from
 * validated wire envelopes upstream). Never carries a token, key, raw frame, or bundle bytes
 * (AC4): the session members reuse only wire payload types, the debug-bundle members carry
 * only a count, a local path, and the closed DebugBundleFailure enum, and `snapshotReceived`
 * (#180) carries the three session-settings fields plus two usage ints (#191) — five fields, a
 * DEDICATED minimal shape, deliberately NOT reusing ScreenSnapshotPayload, so the sensitive
 * rendered-screen `text` never rides `snapshotReceived` (the run-config arm); `text` crosses only
 * on the dedicated `screenSnapshotReceived` arm (#316), where it is the render payload for the
 * live-screen view (#318). Session member and field names mirror
 * SessionAction's so #19's mapping is near-identity, while the two unions stay separately declared
 * per layer.
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
  | {
      type: 'snapshotReceived'
      model: string
      effort: string
      yolo: boolean
      used_tokens: number
      window_tokens: number
    }
  // The dedicated rendered-screen arm (#316, split from #147). Carries ONLY the rendered daemon screen
  // `text` (the wire ScreenSnapshotPayload.text) and its `ts` (the RFC3339 timestamp string) — no token,
  // key, raw frame, conversation_id, or run-config field (those ride snapshotReceived, above). A
  // DELIBERATE, security-reviewed WIDENING: it reverses #180's text-drop now that a consumer exists.
  // Like assistantDelta, `text` IS the render payload and crosses IPC deliberately — the boundary
  // defended upstream is the fail-closed decode (parseScreenSnapshotPayload, #180), not this internal
  // channel. `text` is UNTRUSTED daemon-relayed content: the display slice #318 (the first consumer)
  // must render it as PLAIN TEXT, NEVER HTML (no innerHTML / dangerouslySetInnerHTML), mirroring the
  // identical warning on conversationCreated / sessionTransition / queueState. This slice has no DOM
  // sink; the constraint is inherited for #318. Ships dormant — all three exhaustive bridges no-op it.
  | { type: 'screenSnapshotReceived'; text: string; ts: string }
  // The two v2 interactive-stream arms (#199). Unlike snapshotReceived, `text` IS the render payload
  // (#203) and crosses IPC deliberately — the boundary defended upstream is the fail-closed decode, not
  // this internal channel. Consumed by the renderer timeline bridge (#202), not the session store.
  // camelCase per AC3; carry only turnId / seq / text / stopReason — no token, key, or raw frame.
  | { type: 'assistantDelta'; turnId: string; seq: number; text: string }
  | { type: 'turnEnd'; turnId: string; stopReason: string }
  // The coarse turn-lifecycle arm (#214). Carries only `state` (a closed 3-value wire enum);
  // `conversation_id` is dropped at the emit (single active conversation). Consumed by the renderer
  // timeline bridge (#202) → `phase`, not the session store. No token, key, or raw frame.
  | { type: 'turnState'; state: WireTurnState }
  // The stall-liveness arm (#315). A NULLARY arm — the wire StallPayload's only field
  // (`conversation_id`) is dropped at the emit (single active conversation, matching turnState), so the
  // event carries no payload at all: no token, key, raw frame, or conversation content can ride it
  // (AC3-by-construction — the wire frame carries none). Onset-only; the client self-clear on next turn
  // activity is the render slice's concern (#317). Consumed by the render slice #317 (not yet built), so
  // all three exhaustive bridges no-op it for now — the sessionSettingsRejected-was-a-no-op precedent.
  | { type: 'stallDetected' }
  // The api-retry arm (#492) — claude is retrying against an API error. Unlike stallDetected this arm is
  // NOT nullary: it carries the edge (`active` — true is the rising edge, false the explicit falling one)
  // and the attempt counter (`current` / `total`), because the render slice #493 shows "attempt N/M" and
  // the wire gives it nowhere else. `conversation_id` is dropped at the emit (single active conversation,
  // matching turnState / stallDetected), so what crosses IPC is one bool and two integers and nothing
  // else — no token, key, raw frame, or conversation content can ride an arm with no string field on it.
  // NOT onset-only and NOT deduped: the daemon re-fires the rising edge as the count climbs, and the
  // transport holds no state, so a consumer sees exactly one event per daemon frame (including a verbatim
  // repeat). `current: 0` with `total: 0` is the legitimate "retrying, count unknown" value — #493 must
  // format it defensively (never a literal "0/0", never `current / total` without handling the NaN) since
  // the decoder type-checks but does not range-check. Ships dormant: all three exhaustive bridges no-op
  // it until #493 — the stallDetected-was-a-no-op-until-#317 precedent.
  | { type: 'apiRetry'; active: boolean; current: number; total: number }
  // The compaction-status arm (#495) — claude is auto-compacting the conversation. Like apiRetry it
  // carries the edge (`active` — true is compaction starting, false the explicit falling edge), but
  // BANNER-ONLY: the wire streams no compaction progress, so there is no counter to carry and #496 must
  // not invent one. `conversation_id` is dropped at the emit (single active conversation, matching
  // turnState / stallDetected / apiRetry), so what crosses IPC is one bool and nothing else — no token,
  // key, raw frame, or conversation content can ride an arm with no string field on it. NOT onset-only
  // and NOT deduped: the transport holds no state, so a consumer sees exactly one event per daemon
  // frame (including a verbatim repeat), and #496 is idempotent on the repeat. Ships dormant: all three
  // exhaustive bridges no-op it until #496 — the apiRetry-was-a-no-op-until-#493 precedent.
  | { type: 'compacting'; active: boolean }
  // The session-boundary arm (#254, widened #285). Carries the four render fields the delimiter slice
  // (#286) needs: `newSessionId` (the addressing key the #259 holder retains), `reason` (the closed
  // WireSessionTransitionReason enum, carried so #286's title switch stays exhaustive — NOT a bare
  // string), `occurredAt` (RFC3339Nano, an opaque unparsed string), and `workspaceCwd` (`string | null`
  // — the new workspace dir for a `workspace_change`, `null` for `clear` / `idle_evict`, wire nullability
  // PRESERVED, never coerced to ''). Only `previous_session_id` is dropped at the emit (#285) — it has no
  // consumer. A session_id is a routing id, not a secret (the conversation_id / snapshotReceived
  // convention), so no token, key, or raw frame can ride this arm. `workspaceCwd` is an UNTRUSTED
  // daemon-supplied filesystem path: the render slice #286 must render it as plain text, NEVER HTML (no
  // innerHTML / dangerouslySetInnerHTML) — mirroring the identical warning on conversationCreated /
  // conversationUpdated. This ticket has no DOM sink; the constraint is inherited here for #286.
  // Consumed by the renderer holder (#259) and the delimiter slice (#286, not yet built), so all three
  // exhaustive bridges no-op it for now — matching how snapshotReceived was a no-op in daemonEventBridge
  // until #187.
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
  // The tool-call arm (#217). Carries the four render fields (`conversation_id` dropped at the emit,
  // single active conversation). Consumed by the renderer timeline bridge (#202) → a `toolCall` item,
  // not the session store. `name` / `inputSummary` are opaque daemon display text the render slice
  // (#218) must render as plain text. No token, key, or raw frame.
  | { type: 'toolUse'; turnId: string; toolUseId: string; name: string; inputSummary: string }
  // The tool-result arm (#229). Carries the four render fields (`conversation_id` dropped at the emit).
  // Consumed by the renderer timeline bridge (#202), which folds it through `fillResult` to RESOLVE the
  // correlated `toolCall`'s result in place — not the session store. `isError` is a boolean (`false` =
  // success, a value); `resultSummary` is opaque daemon display text the render slice (#230) must render
  // as plain text. No token, key, or raw frame.
  | { type: 'toolResult'; turnId: string; toolUseId: string; isError: boolean; resultSummary: string }
  // The queued-backlog arm (#292). Reuses the wire QueuedItem row type verbatim (the
  // conversationsReceived precedent) — snake_case, order preserved from the wire (enqueue order). Carries
  // `conversationId` (unlike turnState / toolUse, which drop it) because the snapshot is REPLACEMENT-truth
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
  // single-field emit idiom (turnState carrying `state`, sessionSettingsUpdated naming `sessionId`) is a
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
  // to `path: string` — the single-field emit idiom (conversationDeleted naming `id`, turnState naming
  // `state`, sessionSettingsUpdated naming `sessionId`): a fresh literal naming the one field, keeping
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
  // so no daemon-relayed content, conversation id, or wire field can ride it (mirroring stallDetected /
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
