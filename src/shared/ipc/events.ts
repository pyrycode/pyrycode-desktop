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
  WireTurnState,
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
 * rendered-screen `text` can never ride this channel. Session member and field names mirror
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
  // The session-boundary arm (#254). Carries ONLY `newSessionId` (the addressing key the #259 holder
  // retains); `previous_session_id` / `reason` / `occurred_at` / `workspace_cwd` are decoded then dropped
  // at the emit (the snapshotReceived dedicated-minimal-shape precedent, #180). A session_id is a routing
  // id, not a secret (the conversation_id / snapshotReceived convention), so no token, key, or raw frame
  // can ride this arm. Consumed by the renderer holder (#259, not yet built), so all three exhaustive
  // bridges no-op it for now — matching how snapshotReceived was a no-op in daemonEventBridge until #187.
  | { type: 'sessionTransition'; newSessionId: string }
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
