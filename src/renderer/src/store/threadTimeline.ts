import type { ModelRefusalEvent, TurnEndMetrics } from '@shared/ipc/events'
import type { WireResetPhase, WireResetHandoff } from '@shared/wire/types'

// Shared presentation and live-feedback declarations; daemon items own accepted content.

/** Coarse conversation-level lifecycle — the "thinking…" indicator. A scalar, not an item. */
export type TurnPhase = 'thinking' | 'responding' | 'idle'

/**
 * The reason a session rotated, renderer-local. A deliberate re-declaration of
 * `WireSessionTransitionReason` (the `TurnPhase` ↔ `WireTurnState` precedent), NOT an import — it keeps
 * this reducer wire-free, lets the bridge assign `event.reason` with no cast (the literal unions are
 * identical), and turns a future fourth wire reason into a compile error here (the intended no-drift guard).
 */
export type SessionBoundaryReason = 'clear' | 'idle_evict' | 'workspace_change'

/**
 * Where the daemon's stream parser met claude output it has no mapping for, renderer-local. A
 * deliberate re-declaration of `WireUnrecognizedSite` on the SessionBoundaryReason model, not an
 * import: it keeps this reducer wire-free, lets the bridge assign `event.site` with no cast (the
 * literal unions are identical), and turns a future wire site into a compile error here.
 */
export type UnrecognizedSite =
  | 'line_type'
  | 'assistant_block'
  | 'user_block'
  | 'undecodable'
  | 'codex_method'
  | 'codex_item'

/**
 * #1039: one file the operator attached to a message they sent, as the timeline records it.
 *
 * BOTH HALVES ARE WORTH RECORDING, and they answer different questions. `attachmentId` is the DAEMON's:
 * `driveUpload` sends `attachment_id: uploadId`, so it is the id the host stored the file under, and it
 * is what a later retrieval (#868) or save (#816) addresses. `filename` is the display name #1038 put on
 * the completed terminal — the operator's own `basename` for a picked or dropped file, or
 * `clipboardImageFilename`'s client-owned stem for a pasted image — which is the only thing a row can
 * show, since the id names nothing a person recognises.
 *
 * THE FIELD NAMES ARE `AttachmentSaveRequest`'s (src/shared/ipc/attachmentSave.ts) so the save leg takes
 * this record with no remap the day something wires it — but this is a DECLARATION, not an import. The
 * timeline store imports nothing at all, and pulling an IPC contract into a pure renderer reducer to save
 * four words would be the wrong trade (the `SessionBoundaryReason` re-declaration's reasoning, applied to
 * the IPC boundary rather than the wire one). The rename from `uploadId` is deliberate: that name is
 * about one transfer ATTEMPT, and what a timeline item records is a file the host has stored.
 *
 * Untrusted display text under the same plain-text-NEVER-HTML constraint as every other string in this
 * file, and it is not a path or a capability: a consumer hands `filename` back as
 * `AttachmentSaveRequest.filename`, where main re-runs `sanitizeAttachmentFilename` on the value it
 * actually builds a path from. Nothing is stripped, trimmed or defaulted here — a second sanitiser on
 * this side is the divergent-checks shape `attachmentBytes.ts` argues against, and the empty name is
 * representable and unreachable (`basename` answers `''` only for a path the read guard already refuses).
 */
export interface MessageAttachment {
  attachmentId: string
  filename: string
}

/** Denial is independent of the actual result and never authorizes another attempt. */
export interface ToolDenial {
  toolName: string
  decisionReasonType: string
  decisionReason: string
  message: string
  truncatedFields: readonly string[] | null
  droppedFields: readonly string[] | null
}

/** The filled-in half of a `toolCall`, correlated to it by `toolUseId`. */
export interface ToolResult {
  isError: boolean
  resultSummary: string
  // #773: the daemon's short précis of the call's STRUCTURED outcome — "265 lines", "110 of 1676
  // lines" — carried from the `toolResult` event unchanged, unit words and interior spaces included.
  // ABSENT means the WIRE omitted it (a pre-pyrycode#2024 daemon) — test
  // `result.resultDetail === undefined`, never `'resultDetail' in result`. Absence and `''` mean the
  // same thing upstream (no count); they are kept distinct here because collapsing is lossy, and the
  // decision that both draw nothing belongs to the row (#856), which owns the DOM sink. Untrusted
  // daemon display text under the same plain-text-NEVER-HTML constraint as `resultSummary`, and never
  // parsed back into the number it describes.
  resultDetail?: string
}

/**
 * One item of durable, ordered timeline content. Discriminated on `kind`.
 * `turn_state` is deliberately NOT a member: it is a coarse lifecycle scalar (`TurnPhase`)
 * carried beside `items`, not a row in the timeline (ADR 0008).
 */
export type ThreadItem =
  | { kind: 'compactionBoundary'; failed: boolean; manual: boolean; preTokens?: number | null; postTokens?: number | null }
  | { kind: 'modelRefusal'; refusal: ModelRefusalEvent }
  | { kind: 'banner'; level: string; text: string; stopsTurn: boolean; truncated: boolean }
  // Optional epoch-millisecond timestamp supplied by the canonical item.
  | { kind: 'assistantText'; turnId: string; text: string; createdAt?: number; parentToolUseId?: string }
  | {
      kind: 'toolCall'
      turnId: string
      toolUseId: string
      parentToolUseId?: string
      name: string
      inputSummary: string
      // #643: the tool's own input fields, name → value, carried from the `toolUse` event unchanged.
      // ABSENT means the WIRE omitted it (a pre-pyrycode#1678 daemon) — test `item.input === undefined`,
      // never `'input' in item`; an empty map is a DIFFERENT fact ("this daemon sent no fields for this
      // call") and is never collapsed into absence. Both its keys and its values are untrusted daemon
      // display text under the same plain-text-NEVER-HTML constraint as `name` / `inputSummary`; the
      // render slice (#645) owns that DOM sink. Key order is meaningless (a Go map artefact) and the map
      // may be incomplete (the daemon's total bound drops fields and names none — `inputSummary` stays
      // the whole-input fallback), so a consumer ITERATES rather than probes by key.
      input?: Readonly<Record<string, string>>
      // Starts null on the `toolUse`; filled in place when the correlated `toolResult` arrives.
      result: ToolResult | null
      denial?: ToolDenial
      elapsedSeconds?: number
    }
  | ({ kind: 'turnBoundary'; turnId: string; stopReason: string; outcome?: string; isError?: boolean; terminalReason?: string; errorCategory?: string } & TurnEndMetrics)
  | {
      kind: 'userText'
      text: string
      createdAt?: number
      messageId?: string
      attachments?: readonly MessageAttachment[]
    }
  // #286: the session-boundary delimiter — a `/clear`, an idle eviction, or a workspace change started a
  // fresh session. A whole marker, never coalesced. Carries the RAW `occurredAt` (formatted at render, the
  // channel-list precedent, so the relative time stays fresh) and the untrusted `workspaceCwd` (rendered as
  // auto-escaped text). `newSessionId` is deliberately absent — the #259 holder owns it; this render slice
  // consumes only the three display fields.
  | {
      kind: 'sessionBoundary'
      reason: SessionBoundaryReason
      workspaceCwd: string | null
      occurredAt: string
    }
  // The daemon's stream parser met claude output it has no mapping for. A durable ROW rather than a
  // chrome scalar (the contrast with `stalled` / `apiRetry` / `compacting` beside `items`), because it
  // is a discrete historical event with no clearing edge: it happened, at a point in the conversation,
  // and it stays there. A whole marker, NEVER coalesced — a repeat is a real repeat, and collapsing
  // repeats would hide how often this fires, which is the number that tells you to go fix it.
  //
  // No `turnId`, following `userText` and `sessionBoundary`: the daemon could not parse the message
  // well enough to attribute a turn to it. `messageType` may be the empty string (the `undecodable`
  // site read no type at all). `raw` and `messageType` are the most untrusted strings the timeline
  // holds — rendered as auto-escaped React children only, never through an HTML sink.
  | {
      kind: 'unrecognizedMessage'
      site: UnrecognizedSite
      messageType: string
      raw: string
      truncated: boolean
    }
  // #1621: a file the ASSISTANT sent (`attachment_offered`), drawn on the assistant side with the same
  // file row a sent message's attachment gets. `MessageAttachment` carries its contract here too: the id
  // is the daemon's and is what `downloadAttachment` addresses, the filename is claude-authored display
  // text. No `turnId` (the frame carries none) and no `createdAt` (the row draws no meta). LIVE-ONLY: the
  // wire cannot resupply an offer, and `chatHistoryWriter` leaves this kind out of the durable snapshot.
  | { kind: 'attachmentOffer'; attachment: MessageAttachment }

/**
 * The renderer-local, sealed input union the reducer consumes. camelCase and
 * `conversation_id`-free (single active conversation, ADR 0004); #199's bridge translates the
 * snake_case wire events into these. Field names mirror the wire so that bridge is a thin rename.
 */
export type ThreadEvent =
  | { type: 'messageDelivery'; messageId: string; serverId?: string | null; status: 'waiting' | 'not-sent' | 'written' }
  | { type: 'modelRefusal'; refusal: ModelRefusalEvent; live: boolean }
  | { type: 'banner'; level: string; text: string; stopsTurn: boolean; truncated: boolean }
  | { type: 'assistantDelta'; turnId: string; seq: number; text: string; parentToolUseId?: string; createdAt?: number }
  // The tool-call arm. #763 widened the `toolUse` DaemonEvent with a `conversationId` the bridge drops,
  // so the bridge stays a filter + fresh copy, not a remap.
  //
  // #643: `input` is the tool's own input fields, name → value. ABSENT means the WIRE omitted it (a
  // pre-pyrycode#1678 daemon) — test `event.input === undefined`, never `'input' in event`; an empty
  // map is a DIFFERENT fact ("this daemon sent no fields for this call") and is never collapsed into
  // absence. Both its keys and its values are untrusted daemon display text under the same
  // plain-text-NEVER-HTML constraint as `name` / `inputSummary`; the render slice (#645) owns that DOM
  // sink. Key order is meaningless (a Go map artefact) and the map may be incomplete, so a consumer
  // ITERATES rather than probes by key. The reducer carries it onto the `toolCall` item verbatim —
  // the headline pick, the shortening and the fallback are all #645's decisions, not the store's.
  | {
      type: 'toolUse'
      turnId: string
      toolUseId: string
      parentToolUseId?: string
      name: string
      inputSummary: string
      input?: Readonly<Record<string, string>>
    }
  | { type: 'toolDenied'; turnId: string; toolUseId: string; denial: ToolDenial }
  | { type: 'toolProgress'; turnId: string; toolUseId: string; elapsedSeconds: number }
  // #773: `resultDetail` is the daemon's précis of the call's structured outcome. Absent means the wire
  // omitted it (a pre-pyrycode#2024 daemon), `''` means no count — the same thing upstream, carried
  // distinctly anyway. The reducer puts it on the item's `result` verbatim; every display decision,
  // including whether an empty and an absent detail differ at all, is #856's.
  | {
      type: 'toolResult'
      turnId: string
      toolUseId: string
      parentToolUseId?: string
      isError: boolean
      resultSummary: string
      resultDetail?: string
    }
  | { type: 'turnState'; state: TurnPhase }
  | ({ type: 'turnEnd'; turnId: string; stopReason: string; outcome?: string; isError?: boolean; terminalReason?: string; errorCategory?: string } & TurnEndMetrics)
  // Local submission and received messages share row data. Only local submission opens the
  // Thinking window; `received` is set by the bridge for live and history receipts. Optional fields
  // preserve callers that supply neither timestamp nor attachments nor message identity.
  | {
      type: 'userText'
      received?: true
      queuedMsgId?: number
      sentNow?: boolean
      text: string
      createdAt?: number
      messageId?: string
      attachments?: readonly MessageAttachment[]
    }
  // #286: the session boundary. Field-for-field identical to the `sessionBoundary` ThreadItem, so the
  // bridge is a filter + fresh copy (not a remap); folded by a plain fresh tail-append (the `userText`
  // discipline), never coalesced.
  | { type: 'sessionBoundary'; reason: SessionBoundaryReason; workspaceCwd: string | null; occurredAt: string }
  | { type: 'stallDetected' }
  | { type: 'apiRetry'; active: boolean; current: number; total: number }
  // The reducer classifies optional outcomes only on a genuine falling edge. Raw strings never
  // become row copy; a later boundary supplies display counts and the exact manual-trigger flag.
  | { type: 'compacting'; active: boolean; compactResult?: string; compactError?: string }
  | { type: 'compactionBoundary'; trigger: string; preTokens?: number | null; postTokens?: number | null }
  // The parser-gap arm. #784 widened the DaemonEvent with a `conversationId` the bridge drops. Field-for-field
  // identical to the `unrecognizedMessage` ThreadItem, so the bridge is a filter + fresh copy, not a remap.
  | {
      type: 'unrecognizedMessage'
      site: UnrecognizedSite
      messageType: string
      raw: string
      truncated: boolean
    }
  // #528: return the whole timeline to its initial state on a context change (a conversation switch,
  // an unpair). The FIRST arm that is neither daemon- nor user-content-derived — a renderer lifecycle
  // control event, never translated from a wire frame, so `timelineBridge` never produces it. Nullary
  // following the ThreadEvent `stallDetected` (:136): a reset carries no payload, so there is no field
  // a caller can get wrong. `sessionStore`'s `reset` (#166) is the same arm for the session facet.
  | { type: 'sessionError'; code: string }
  | { type: 'reconnected' }
  | { type: 'thinkingProgress'; estimatedTokens: number }
  | { type: 'resetting'; active: boolean; phase: WireResetPhase; handoff: WireResetHandoff }
  | { type: 'attachmentOffered'; attachment: MessageAttachment }

/**
 * #493: the live api-retry attempt counter. Present ⇒ a retry is in flight; `null` ⇒ none.
 *
 * A record rather than a flag because the render shows "attempt N/M", and `| null` rather than carrying
 * the wire's `active` because it collapses "not retrying" into ONE representation: the render gate is a
 * presence check, and the wire's "the falling edge repeats the last-known counter verbatim; the counter
 * is ignored once `active` is false" is true BY CONSTRUCTION — the falling edge stores `null`, so there
 * is nowhere for a stale counter to leak from. `{ current: 0, total: 0 }` is a PRESENT status meaning
 * "retrying, count unknown" — distinct from `null`, which means no retry at all.
 */
export interface ApiRetryStatus {
  current: number
  total: number
}

/**
 * #1517: the live reset status. Present ⇒ a reset is in flight; `null` ⇒ none.
 *
 * `ApiRetryStatus`'s shape above, for its reasons: a record rather than a flag because the row's label
 * needs BOTH tokens to choose its copy, and `| null` rather than carrying the wire's `active` because it
 * collapses "not resetting" into ONE representation — the falling edge stores `null`, so there is nowhere
 * for a stale token to leak from and the "the falling edge repeats the last-known tokens verbatim" clause
 * is true by construction.
 *
 * NEITHER TOKEN IS A CONTROL INPUT. Both are closed sets the daemon authors, and both exist to SELECT
 * client-owned copy. `handoff: 'written'` describes a file the daemon wrote and the frame carries no
 * path, so nothing may resolve, open or synthesize one from it.
 */
export interface ResettingStatus {
  phase: WireResetPhase
  handoff: WireResetHandoff
}

/** Pending feedback for the newest local send; daemon acceptance supplies queued status. */
export interface LocalSendPending {
  readonly messageId: string
  readonly queued: boolean
}

/** The whole timeline state: ordered content + the coarse lifecycle phase + the five chrome scalars. */
export interface TimelineState {
  /** Latest stopping report, retired only by a local optimistic send or timeline reset. */
  stoppingBanner?: Omit<Extract<ThreadItem, { kind: 'banner' }>, 'kind'>
  refusalOffer?: {
    report: Extract<ModelRefusalEvent, { type: 'modelRefusalFallback' }>
    changeId?: string
    rejected?: boolean
  }
  /** Latest live turn end; history replay returns rows only and cannot restore this reading. */
  latestTurnEnd?: Extract<ThreadEvent, { type: 'turnEnd' }>
  items: readonly ThreadItem[]
  phase: TurnPhase
  stalled: boolean
  apiRetry: ApiRetryStatus | null
  compacting: boolean
  localSendPending: LocalSendPending | null
  thinkingTokens: number | null
  // #1517: the live reset status, or `null` when none is held. The SIXTH chrome scalar, and the second
  // to carry a record — `ResettingStatus | null` follows `apiRetry` exactly, because there are two
  // tokens and the label needs both.
  //
  // ITS CLEAR RULES ARE `apiRetry`'s, NOT `stalled`'s, and that is the whole reason the label survives
  // the phase it describes. The wrap-up turn is a REAL turn: claude writes the handoff note as an
  // ordinary turn whose deltas, tool rows and turn boundary stream into `items` exactly as any turn's
  // do. Self-clearing on turn activity would blank the label on the first delta of that very turn,
  // which is the unnamed pause #1517 exists to remove. So:
  //  - the wire's own falling edge clears it, as it does `apiRetry` and `compacting`;
  //  - `sessionBoundary` ALSO clears it — the BELT, and the independent trigger the wire contract
  //    demands, since a daemon killed mid-reset sends no falling edge and a status clearable only by
  //    one that never comes pins on forever. A reset ends in a session rotation, so the boundary is
  //    that trigger. The two ride SEPARATE producers, so their relative arrival order is deliberately
  //    not pinned and neither is asserted: each order leaves this null.
  //  - `reconnected` clears it, Mode B beside `apiRetry` / `compacting` / `thinkingTokens` — see that
  //    arm's classification.
  //  - `reset` clears it for free through `initialTimelineState`.
  resetting: ResettingStatus | null
}

export const initialTimelineState: TimelineState = {
  items: [], phase: 'idle', stalled: false, apiRetry: null, compacting: false,
  localSendPending: null, thinkingTokens: null, resetting: null
}
