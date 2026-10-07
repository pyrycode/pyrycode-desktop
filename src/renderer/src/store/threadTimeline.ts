import type { ModelRefusalEvent, TurnEndMetrics } from '@shared/ipc/events'
import type { QueuedItem, WireResetPhase, WireResetHandoff } from '@shared/wire/types'

// The conversation timeline: a heterogeneous, ordered list of turn content (streamed
// assistant text, tool calls with their results, turn boundaries) plus the coarse
// conversation-level phase. Pure renderer state — no IPC, no preload bridge, no transport,
// no React. Introduced alongside `sessionStore`'s flat `MessagePayload[]` (Strangler Fig,
// ADR 0008): nothing cuts over here and no consumer imports this yet. #199 adds the
// structured wire types, the transport decode, and the bridge that maps wire (snake_case)
// envelopes into the `ThreadEvent`s this reducer consumes — the desktop analog of
// `daemonEventBridge` mapping `DaemonEvent` → `SessionAction`. See ADR 0008.

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
  // #1013: `createdAt` is the epoch-millisecond moment this bubble first appeared — the arrival of its
  // FIRST delta, stamped in the renderer from an injected clock, not carried from the envelope `ts` (the
  // `assistantDelta` IPC arm names its fields fail-closed and does not forward it; the two agree to within
  // network latency, and the timeline is in-memory and cleared on exit and pairing end (#757), so nothing
  // replays old messages a fresh clock would mis-stamp). ABSENT means no clock was injected at the producer
  // — test `item.createdAt === undefined`, never `'createdAt' in item`, since the reducer assigns the field
  // unconditionally. Absence is a LEGAL item, not a defect: it is what every spec that injects no clock
  // produces, and #1014 renders it as the empty meta slot. Stored raw and formatted at render (the
  // `sessionBoundary.occurredAt` precedent); this store parses, compares and formats nothing.
  // Deliberately named apart from `occurredAt` below — that one is a wire-supplied ISO STRING about a
  // session rotation, this one a renderer-minted number about a message.
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
  // A whole user message from a local echo, live receipt or history. No turn id or delta sequence.
  // `createdAt` is local submission time for an echo, or parsed daemon envelope time for a live
  // receipt. History-only rows have no stamp. Stored as epoch milliseconds and formatted at render.
  //
  // #1039: `attachments` are the files that were attached to THIS message, in the order their uploads
  // completed — the first thing in this app that associates an attachment with a message, and what #815's
  // file row and #868's thumbnail draw from. ABSENT means the message carried none — test
  // `item.attachments === undefined`, never `'attachments' in item`, since the reducer assigns the field
  // unconditionally. Unlike `input` one arm up, an EMPTY LIST is NOT a distinct fact here: the sole
  // producer (`composerSend.ts`) normalises "nothing pending" to absence at the echo, so nothing
  // downstream ever sees `[]` and "absent means none" is the only reading a consumer needs. The store
  // still owns no opinion — it carries whatever arrived — so a second producer that minted `[]` would
  // reach the item with it, and what an empty list DRAWS would be that row's decision, not this store's.
  // Renderer-sourced like the text beside it: these are files this window's own operator attached, never
  // daemon-supplied content. A file the ASSISTANT produced reaches the window as nothing at all
  // (`MessagePayload` has no attachment field and there is no list verb), so this field can only ever
  // describe attachments this client minted itself until that wire change exists.
  //
  // `messageId` identifies the send across clients, receipts, queued snapshots and history. A
  // non-empty match preserves the held row; absent/empty ids correlate with nothing. The value is
  // never rendered, logged or used as a path, URL, filename or React key.
  //
  // UNTRUSTED ON THE READ SIDE, on the same terms as `text`: the value it is COMPARED against arrives from
  // another client through a content-blind relay. It is read for strict string equality only — never a
  // lookup path, a cache key, a filename, a URL, a Map key or a React key — and it is never rendered and
  // never logged. A consumer that needs any of those must mint its own key rather than widen this one.
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
  | { type: 'refusalWriteStarted'; offer: NonNullable<TimelineState['refusalOffer']>; changeId: string }
  | { type: 'refusalWriteSettled'; changeId: string; confirmed: boolean }
  | { type: 'refusalModelSelected'; changeId: string }
  | { type: 'refusalModelAnnounced'; model: string }
  | { type: 'refusalSessionReplaced' }
  | { type: 'refusalWriteAbandoned' }
  // `seq` is carried for wire fidelity (and a future monotonicity guard) but not consulted —
  // arrival order is authoritative, per ADR 0004's caller-owns-ordering stance.
  //
  // #1013: `createdAt` is the producer's stamp, field-for-field with the `assistantText` item, so the
  // reducer stays a CARRIER of this fact rather than its source (the `input` #643 / `resultDetail` #773
  // discipline). It rides the EVENT rather than arriving as a reducer parameter for a reason worth
  // recording: `reduceTimeline` is called by the two timeline stores, which ARE production paths, so a
  // clock parameter there would stamp every item the store-level specs assert on. Absent means the
  // producer injected no clock — see the item.
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
  // #317: the daemon's one-shot stall onset (#315 decodes it; #732 widened that daemon event to carry
  // `conversationId`, which the bridge drops). A NULLARY arm — the id stops there, so this event has
  // no payload — what makes AC4 ("no daemon-supplied string is ever rendered") true by construction:
  // there is no field to render. Onset-only; the reducer derives the self-clear on the next turn activity.
  | { type: 'stallDetected' }
  // #493: the daemon's api-retry edge (#492 decodes it; #737 widened that daemon event with a `conversationId`
  // the bridge drops) — a filter + fresh copy (the `toolUse` / `sessionBoundary` discipline),
  // not a remap. The EVENT carries `active` — a faithful renderer-local re-declaration of the wire edge
  // (true rising, false the explicit falling one); the reducer is the single place that translates that
  // edge into the state's presence-or-absence. Two integers and a bool, no string field: AC1 ("no
  // daemon-supplied string is ever rendered") stays true by construction, as with `stallDetected`.
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
  | { type: 'sessionErrorCleared' }
  | { type: 'reset' }
  // #538: the connection came back — reconcile the transient chrome against the fresh handshake. The
  // SECOND non-content arm, and distinct from `reset` (:133) in where it comes from: `reset` is
  // renderer lifecycle and `timelineBridge` never produces it, while this one is CONNECTION lifecycle
  // — bridge-produced from the `connected` wire edge — but carries no daemon content of its own.
  // Nullary following `reset`: the `connected` DaemonEvent's `HelloAckPayload` holds no field this
  // arm needs, so there is none to get wrong.
  | { type: 'reconnected' }
  // #1213: take one optimistic `userText` echo back out — the operator dropped the queued message it
  // stood for, so the daemon will never run it and a delivered-looking bubble for it is a lie. The THIRD
  // non-content arm, beside `reset` and `reconnected`: a renderer lifecycle control event, never
  // translated from a wire frame, so `timelineBridge` never produces it.
  //
  // NOT a second `userText` producer and not its inverse in the chrome sense — see the reducer arm, which
  // states what it leaves `localSendPending` and `stalled` as, and why.
  //
  // `messageId` is a plain required field rather than `string | undefined`, and the empty-string rule
  // lives at the SINGLE producer (`dropQueuedMessage`), which dispatches nothing for an absent or empty
  // wire id. That is deliberate placement, not an omission: `undefined === ''` is false, so an id-less
  // echo is already unreachable from here, and a second guard in the reducer would defend a failure mode
  // the producer makes impossible.
  | { type: 'dropUserText'; messageId: string; queuedMsgId?: number }
  // #1314: one thinking-token reading (#1312 decodes it, #1313 carried it to the window, this slice gives
  // it a consumer). The DaemonEvent carries `conversationId` beside the one render field; the ThreadEvent
  // this arm describes does not, so the id STOPS at the bridge — a filter + fresh literal (the `apiRetry` /
  // `compacting` discipline), never a pass-through. One integer and no string field, so the
  // "no daemon-supplied string is ever rendered" guarantee stays true by construction, as it does for
  // `stallDetected` and `apiRetry`.
  //
  // A READING, NOT AN EDGE, and that is the whole contrast with the two arms it otherwise resembles.
  // `apiRetry` and `compacting` each carry `active` and the reducer translates that edge into presence;
  // this frame has no rising and no falling edge at all, so there is no `active` here and no consumer may
  // look for one. The clears are the REDUCER's, derived from the turn's own lifecycle — see the arm.
  //
  // NOT MONOTONIC: the value restarts near zero at every inference-request boundary, four times inside the
  // daemon's own committed single-turn capture, so a DROP is ordinary traffic and the arm assigns rather
  // than comparing magnitudes. `estimatedTokens: 0` is a READING, never an absence — nothing may consult
  // truthiness on it. `estimated_tokens_delta` deliberately does not cross the IPC boundary and is not
  // accumulated here: the payload's own contract says the deltas do not sum to the turn's total.
  | { type: 'thinkingProgress'; estimatedTokens: number }
  // #1517: one edge of a session reset (#1514 decodes it, #1515 carried it to the window, this slice
  // gives it a consumer). The DaemonEvent carries `conversationId` beside the two render fields; this
  // arm does not, so the id STOPS at the bridge — a filter + fresh literal (the `apiRetry` /
  // `compacting` discipline), never a pass-through.
  //
  // TWO EDGES, like `apiRetry` and `compacting` and unlike `thinkingProgress` beside it: `active` is a
  // faithful renderer-local re-declaration of the wire edge, and the reducer is the single place that
  // translates it into presence-or-absence. The rising edge RE-FIRES as the phase advances
  // (`wrapping_up` → `restarting`), which is a real transition and not a duplicate to suppress.
  //
  // BOTH TOKENS ARE CLOSED SETS, so the "no daemon-supplied string is ever rendered" guarantee holds
  // differently here than on its neighbours: there is a string field, but its value set is the daemon's
  // own four-and-three constants, and the consumer SELECTS client-owned copy with it rather than
  // rendering it. A narrowed token is still a CLAIM BY A PEER — all sixteen (`active`, `phase`,
  // `handoff`) combinations decode, so every consumer handles all of them, and nothing
  // security-relevant may branch on either. The frame is a REPORT, never a control input.
  | { type: 'resetting'; active: boolean; phase: WireResetPhase; handoff: WireResetHandoff }
  // #1621: one offered file (#1619 decodes it, #1620 carried it to the window). The DaemonEvent carries
  // `conversationId`; this arm does not, so the routing key STOPS at the bridge (the `resetting`
  // discipline). Folded by a tail-append deduplicated on `attachmentId` — see the reducer arm.
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

/**
 * #1725: an open local send window. `messageId` is the composer-minted id of the newest local send, `''`
 * when none was minted, which no queue item can match. `queued` turns true once a `queue_state` lists it
 * and never turns back (`markLocalSendQueued`).
 */
export interface LocalSendPending {
  readonly messageId: string
  readonly queued: boolean
}

/** The whole timeline state: ordered content + the coarse lifecycle phase + the five chrome scalars. */
export interface TimelineState {
  /** Client-owned identities; keys survive receipt settlement and history prepends. */
  rowKeys?: readonly number[]
  /** Receipt placement overrides keyed by stable identity, never saved. */
  rowArrivalOrder?: ReadonlyMap<number, number>
  /** Shared monotonic allocator for row identities and receipt placement. */
  nextRowKey?: number
  receivedQueueIds?: readonly number[]
  localEchoes?: readonly {
    rowKey: number
    messageId: string
    waiting: boolean
    waitTurnId?: string
    queuedMsgId?: number
    afterKey?: number
    released?: true
    settled?: true
    held?: true
    delivery?: 'waiting' | 'not-sent'
  }[]
  /** Transient daemon failure; code is only compared to renderer-owned copy constants. */
  sessionError?: { code: string }
  /** Latest stopping report, retired only by a local optimistic send or timeline reset. */
  stoppingBanner?: Omit<Extract<ThreadItem, { kind: 'banner' }>, 'kind'>
  /** Reference identity survives intervening content, echo removal and history prepend. */
  pendingCompaction?: Extract<ThreadItem, { kind: 'compactionBoundary' }>
  refusalOffer?: {
    report: Extract<ModelRefusalEvent, { type: 'modelRefusalFallback' }>
    changeId?: string
    rejected?: boolean
  }
  /** Latest live turn end; history replay returns rows only and cannot restore this reading. */
  latestTurnEnd?: Extract<ThreadEvent, { type: 'turnEnd' }>
  items: readonly ThreadItem[]
  phase: TurnPhase
  // #317: a coarse, onset-only stall scalar (the `phase`-beside-`items` precedent — NOT a ThreadItem row).
  // Set by `stallDetected`, self-cleared by the reducer on the next turn-activity event.
  stalled: boolean
  // #493: the live api-retry status — the `stalled` twin with the clear semantics INVERTED. `api_retry`
  // has an explicit falling edge on the wire, so this is NEVER self-cleared by turn activity: only an
  // `active: false` event clears it. Chrome beside `items`, never a ThreadItem row.
  apiRetry: ApiRetryStatus | null
  // #496: whether claude is auto-compacting the conversation. `apiRetry`'s clear semantics (an explicit
  // wire falling edge, never self-cleared by turn activity) over `stalled`'s plain-boolean SHAPE: a plain
  // `boolean`, not a record and not `| null`, because `compacting` is a pure liveness fact with no counter
  // to hold — `| null` would invent a third state the wire cannot produce, and a record would cargo-cult
  // #493's structure past the reason for it. Chrome beside `items`, never a ThreadItem row.
  compacting: boolean
  // #650: whether the operator's own send is still waiting for the daemon's first word — the working
  // indicator's locally-opened window, so the gap between pressing Enter and the daemon's first event is
  // not a dead screen. THE FIRST RENDERER-SOURCED CHROME SCALAR, and that provenance (marked by the
  // `local` prefix) is the whole of what distinguishes it from the three above: `stalled`, `apiRetry` and
  // `compacting` are daemon facts with a daemon edge, whereas this one is opened by the operator's act
  // with no daemon involvement at all. That is why its clear rules match none of the three:
  //  - NOT self-cleared by turn activity (`stalled`'s rule): content can arrive before any `turn_state`,
  //    and clearing on it would blank the indicator mid-turn while `phase` is still idle.
  //  - NOT cleared only by a daemon falling edge (`apiRetry`/`compacting`'s rule): a send that never
  //    reaches the daemon has no falling edge to wait for, and a status clearable only by one sticks
  //    forever when the edge is lost (the 2026-07-30 review finding #538 answered). So: a LIFECYCLE
  //    clear — any `turn_state` (the daemon has spoken; its phase is now authoritative), plus
  //    `reconnected` and `reset`. Two of the early-outs below widened for it; see those two arms.
  // Deliberately NOT a fourth `TurnPhase` member: `TurnPhase` is a wire mirror (:11, and `wire/types.ts`
  // names it from the other side), so a renderer-local member would let a caller dispatch a fabricated
  // daemon phase through `turnState`'s daemon-provenance arm. Living outside `phase` also keeps
  // `isTurnRunning` — the interrupt control's only gate — structurally unable to see this signal, so a
  // locally-opened window can never arm a stop button for a turn the daemon has not started.
  // #1725: `null` is the closed window; an open one names the newest local send and whether a
  // `queue_state` has listed it, so the label can say "Sending…" or "Waiting for Claude" honestly.
  localSendPending: LocalSendPending | null
  // #1314: the latest thinking-token reading for this conversation, or `null` when none is held. The fifth
  // chrome scalar, and the second to carry a value rather than a liveness fact — `| null` follows
  // `apiRetry` for that reason, while the payload itself is a bare `number` rather than a record, because
  // there is one reading and nothing to pair it with (the same "do not cargo-cult #493's structure past
  // the reason for it" `compacting` applied in the other direction).
  //
  // `0` IS A HELD READING, never an absence: the wire has no `omitempty`, so the daemon's zero is legal
  // traffic. That is exactly why this is `| null` and not a sentinel zero — the two facts are distinct and
  // a consumer must be able to tell "no reading yet" from "a reading of nothing".
  //
  // ITS CLEAR RULES MATCH NONE OF THE FOUR ABOVE, and they are the turn's own lifecycle rather than an
  // edge of its own (the frame has none):
  //  - NOT self-cleared by turn activity (`stalled`'s rule): claude interleaves tool calls with its
  //    thinking, so clearing on a delta or a tool step would blank a live reading mid-think, which is the
  //    long silence this scalar exists to explain.
  //  - NOT cleared by a daemon falling edge (`apiRetry`/`compacting`'s rule): there is no falling edge on
  //    the wire to wait for, and a scalar clearable only by one that never comes sticks forever.
  //  So: cleared by a `turnState` that is NOT `thinking`, by `turnEnd`, and by `reconnected` — plus `reset`
  //  for free. Two guards widened for it; see the `turnState` and `reconnected` arms, and the `toolResult`
  //  arm for the one that deliberately did not.
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

/** Compile-time exhaustiveness guard: a new ThreadEvent arm without a case is a type error. */
function assertNever(event: never): never {
  throw new Error(`Unhandled thread event: ${JSON.stringify(event)}`)
}

/**
 * Coalesce a streamed text delta: if the tail item is an `assistantText` for the same turn and parent,
 * return a new array whose tail is a copy with the concatenated text; otherwise append a fresh
 * `assistantText`. The tail-check naturally renders text → tool → text as three items while
 * collapsing consecutive deltas into one growing bubble. Always returns a new array (a delta is
 * always a change), matching `appendUnique`'s new-reference-on-change discipline.
 *
 * #1013: `createdAt` names WHEN THE BUBBLE FIRST APPEARED, so the two branches read it from different
 * places and that asymmetry is the whole of the feature. The grow branch takes the TAIL's stamp — this
 * function rebuilds the item as a fresh literal on every coalesced delta, so carrying the incoming one
 * instead (or omitting it) would silently re-date a bubble to its most recent fragment. Only the
 * fresh-append branch uses the delta's own. Required parameter, not optional: this is module-private with
 * one call site, so there is no cascade to buy off, and a required parameter makes forgetting it a
 * compile error at that site.
 */
function appendDelta(
  items: readonly ThreadItem[],
  turnId: string,
  text: string,
  createdAt: number | undefined,
  parentToolUseId: string | undefined
): readonly ThreadItem[] {
  const tail = items[items.length - 1]
  if (tail && tail.kind === 'assistantText' && tail.turnId === turnId && tail.parentToolUseId === parentToolUseId) {
    const grown: ThreadItem = {
      kind: 'assistantText',
      turnId,
      text: tail.text + text,
      parentToolUseId,
      createdAt: tail.createdAt
    }
    return [...items.slice(0, -1), grown]
  }
  return [...items, { kind: 'assistantText', turnId, text, createdAt, parentToolUseId }]
}

/**
 * Correlate a tool result to its originating call by `toolUseId` alone (the wire's stable,
 * conversation-unique key): find the `toolCall` with a matching id AND a still-null result, and
 * return a new array with a copy whose `result` is filled. If none matches — orphan (no such
 * pending call) or duplicate (already resolved) — return the SAME array reference, so the caller
 * can return the same state unchanged (deterministic no-op, non-throwing, per ADR 0008 / AC4).
 */
function fillResult(
  items: readonly ThreadItem[],
  toolUseId: string,
  result: ToolResult,
  parentToolUseId?: string
): readonly ThreadItem[] {
  let filled = false
  const next = items.map((item) => {
    // The `kind === 'toolCall'` guard narrows `item` to the toolCall member, so the spread
    // type-checks as a valid ThreadItem with no cast. `filled` fills only the first match.
    if (!filled && item.kind === 'toolCall' && item.toolUseId === toolUseId && item.result === null) {
      filled = true
      return { ...item, result, elapsedSeconds: undefined, parentToolUseId: item.parentToolUseId ?? parentToolUseId }
    }
    return item
  })
  return filled ? next : items
}

/**
 * Pure reducer — no mutation, returns fresh state. `items` and `phase` are orthogonal: content
 * events never touch `phase`, `turnState` never touches `items`. Mirrors `reduceSession`: a
 * `switch` on the sealed union with an `assertNever` default, and same-reference returns when
 * nothing changes so unchanged slices do not churn selectors.
 *
 * #650 qualifies that invariant without weakening it: content events may touch CHROME. They already
 * did — `assistantDelta` / `toolUse` / `toolResult` all write `stalled: false` — and `userText` now
 * writes `localSendPending: true`, making it the first chrome write from a RENDERER-sourced content
 * event. `phase` itself stays daemon-only, so "content events never touch `phase`" remains literally
 * true; it is the narrower reading — "the chrome scalars are all daemon-sourced" — that no longer is.
 */
export function reduceTimeline(state: TimelineState, event: ThreadEvent): TimelineState {
  const keys = state.rowKeys ?? state.items.map((_, index) => index)
  const echoes = state.localEchoes ?? []
  if (event.type === 'messageDelivery') {
    const own = echoes.find(e => e.messageId === event.messageId && !e.settled)
    if (own === undefined) return state
    const index = keys.indexOf(own.rowKey)
    const item = state.items[index]
    if (item?.kind !== 'userText' || own.queuedMsgId !== undefined) return state
    const delivery = event.status === 'written' ? undefined : event.status
    return { ...state, localSendPending: event.status === 'written' ? state.localSendPending : null,
      localEchoes: echoes.map(e => e === own ? { ...e, delivery, held: event.status === 'waiting' ? true : e.held } : e) }
  }
  if (event.type === 'userText' && event.received === true) {
    if (event.queuedMsgId !== undefined && state.receivedQueueIds?.includes(event.queuedMsgId)) return state
    const own = event.queuedMsgId === undefined
      ? echoes.find(e => !!event.messageId && e.messageId === event.messageId)
      : echoes.find(e => e.queuedMsgId === event.queuedMsgId) ??
        echoes.find(e => e.queuedMsgId === undefined && !e.settled &&
          !!event.messageId && e.messageId === event.messageId)
    if (own !== undefined) {
      if (own.settled) return state
      if (own.queuedMsgId === undefined && event.queuedMsgId === undefined && !own.held) {
        return { ...state, localEchoes: echoes.map(e => e === own ? { ...e, settled: true, delivery: undefined } : e) }
      }
      const index = keys.indexOf(own.rowKey)
      const item = state.items[index]
      if (item === undefined) return state
      const items = state.items.filter((_, i) => i !== index)
      const rowKeys = keys.filter((_, i) => i !== index)
      let insertion = items.length
      if (own.waiting && event.sentNow !== true && own.afterKey !== undefined) {
        const boundary = rowKeys.indexOf(own.afterKey)
        if (boundary !== -1) {
          insertion = boundary + 1
          while (echoes.some(e => e.settled && e.afterKey === own.afterKey && e.rowKey === rowKeys[insertion])) insertion++
        }
      } else if (!own.waiting && event.sentNow !== true) insertion = index
      items.splice(insertion, 0, item)
      rowKeys.splice(insertion, 0, own.rowKey)
      const arrival = state.nextRowKey ?? state.items.length
      const rowArrivalOrder = new Map(state.rowArrivalOrder)
      rowArrivalOrder.set(own.rowKey, arrival)
      return { ...state, items, rowKeys, rowArrivalOrder, nextRowKey: arrival + 1, localEchoes: echoes.map(e => e === own ? {
        ...e, queuedMsgId: e.queuedMsgId ?? event.queuedMsgId, settled: true, delivery: undefined
      } : own.waiting && own.afterKey !== undefined && e.waiting && !e.settled && !e.released &&
          e.afterKey === own.afterKey ? { ...e, afterKey: undefined, waitTurnId: undefined } : e) }
    }
  }
  if (event.type === 'dropUserText') {
    const own = echoes.find(e => e.messageId === event.messageId &&
      (event.queuedMsgId === undefined || e.queuedMsgId === event.queuedMsgId))
    if (own === undefined) return state
    const index = keys.indexOf(own.rowKey)
    const rowArrivalOrder = state.rowArrivalOrder === undefined ? undefined : new Map(state.rowArrivalOrder)
    rowArrivalOrder?.delete(own.rowKey)
    return { ...state, items: state.items.filter((_, i) => i !== index),
      rowKeys: keys.filter((_, i) => i !== index), rowArrivalOrder, localEchoes: echoes.filter(e => e !== own) }
  }
  // Reject a held receipt before content or chrome sidecars can change anything.
  if (event.type === 'userText' && event.received === true &&
      event.messageId !== undefined && event.messageId !== '' &&
      !(event.queuedMsgId !== undefined && echoes.some(e => e.messageId === event.messageId &&
        e.queuedMsgId !== undefined && e.queuedMsgId !== event.queuedMsgId)) &&
      state.items.some(item => item.kind === 'userText' && item.messageId === event.messageId)) {
    return state
  }
  let next = reduceTimelineContent(state, event)
  if (event.type !== 'reset' && next !== state) {
    let nextRowKey = state.nextRowKey ?? state.items.length
    const rowKeys = next.items.map((_, index) => keys[index] ?? nextRowKey++)
    let localEchoes = echoes
    if (event.type === 'userText' && event.received !== true && event.messageId) {
      const lastTurnRow = [...state.items].reverse().find(item =>
        item.kind === 'assistantText' || item.kind === 'toolCall' || item.kind === 'turnBoundary')
      const running = lastTurnRow !== undefined && lastTurnRow.kind !== 'turnBoundary'
      localEchoes = [...echoes, { rowKey: rowKeys[rowKeys.length - 1] ?? nextRowKey++, messageId: event.messageId,
        waitTurnId: running ? lastTurnRow.turnId : undefined,
        waiting: state.phase !== 'idle' || running }]
    }
    if (event.type === 'turnEnd') {
      const afterKey = rowKeys[rowKeys.length - 1]
      localEchoes = echoes.map(e => e.waiting && !e.settled && e.afterKey === undefined &&
          (e.waitTurnId === undefined || e.waitTurnId === event.turnId)
        ? { ...e, afterKey } : e)
    }
    next = { ...next, rowKeys, nextRowKey, localEchoes }
    if (state.rowArrivalOrder !== undefined) next = { ...next, rowArrivalOrder: state.rowArrivalOrder }
    const receivedQueueIds = event.type === 'userText' && event.received === true && event.queuedMsgId !== undefined
      ? [...(state.receivedQueueIds ?? []), event.queuedMsgId] : state.receivedQueueIds
    if (receivedQueueIds !== undefined) next = { ...next, receivedQueueIds }
  }
  const sessionError = event.type === 'sessionError' ? { code: event.code }
    : event.type === 'sessionErrorCleared' || event.type === 'reset' ||
      (event.type === 'sessionBoundary' && event.reason === 'clear') ||
      (event.type === 'userText' && event.received !== true) ||
      (event.type === 'turnState' && event.state !== 'idle') ? undefined : state.sessionError
  if (next.sessionError !== sessionError) next = { ...next, sessionError }
  const stoppingBanner = event.type === 'userText' || event.type === 'reset' ? undefined
    : event.type === 'banner' && event.stopsTurn
      ? { level: event.level, text: event.text, stopsTurn: event.stopsTurn, truncated: event.truncated }
      : state.stoppingBanner
  if (next.stoppingBanner !== stoppingBanner) next = { ...next, stoppingBanner }
  // Content reducers reconstruct their fields. Preserve the association except at its own edges/reset.
  if (event.type !== 'compacting' && event.type !== 'compactionBoundary' && event.type !== 'reset' &&
      next.pendingCompaction !== state.pendingCompaction) {
    next = { ...next, pendingCompaction: state.pendingCompaction }
  }
  const refusalOffer = reduceRefusalOffer(state.refusalOffer, event)
  if (next.refusalOffer !== refusalOffer) next = { ...next, refusalOffer }
  let latestTurnEnd = state.latestTurnEnd
  switch (event.type) {
    case 'turnEnd':
      latestTurnEnd = event.stopReason !== 'cancelled' &&
        (event.isError === true || (event.outcome !== undefined && event.outcome !== '' && event.outcome !== 'success'))
        ? event : undefined
      break
    case 'turnState':
      if (event.state !== 'idle') latestTurnEnd = undefined
      break
    case 'userText': case 'assistantDelta': case 'toolUse': case 'toolResult':
    case 'toolProgress': case 'toolDenied': case 'thinkingProgress':
    case 'sessionBoundary': case 'reset': case 'reconnected':
      latestTurnEnd = undefined
      break
  }
  return next.latestTurnEnd === latestTurnEnd ? next : { ...next, latestTurnEnd }
}

function reduceRefusalOffer(
  offer: TimelineState['refusalOffer'], event: ThreadEvent
): TimelineState['refusalOffer'] {
  switch (event.type) {
    case 'modelRefusal':
      if (!event.live || event.refusal.type !== 'modelRefusalFallback') return offer
      return event.refusal.scope === 'session' && event.refusal.originalModel !== '' && event.refusal.fallbackModel !== ''
        ? { report: event.refusal } : undefined
    case 'refusalWriteStarted':
      return offer === event.offer ? { report: offer.report, changeId: event.changeId } : offer
    case 'refusalWriteSettled':
      if (offer?.changeId !== event.changeId) return offer
      return event.confirmed ? undefined : { report: offer.report, rejected: true }
    case 'refusalModelSelected':
      return offer?.changeId === event.changeId ? offer : undefined
    case 'refusalModelAnnounced':
      return event.model !== '' && event.model !== offer?.report.fallbackModel ? undefined : offer
    case 'refusalSessionReplaced': case 'reset':
      return undefined
    case 'refusalWriteAbandoned':
      return offer?.changeId === undefined ? offer : { report: offer.report }
    default:
      return offer
  }
}

function reduceTimelineContent(state: TimelineState, event: ThreadEvent): TimelineState {
  switch (event.type) {
    case 'messageDelivery': return state
    case 'sessionError':
      // A daemon failure ends stale turn feedback without changing content or queue state.
      return { ...state, phase: 'idle', localSendPending: null, stalled: false,
        apiRetry: null, compacting: false, thinkingTokens: null }
    case 'sessionErrorCleared':
      return state
    case 'banner':
      return { ...state, items: [...state.items, {
        kind: 'banner', level: event.level, text: event.text,
        stopsTurn: event.stopsTurn, truncated: event.truncated
      }] }
    case 'modelRefusal':
      return { ...state, items: [...state.items, { kind: 'modelRefusal', refusal: event.refusal }] }
    case 'refusalWriteStarted': case 'refusalWriteSettled': case 'refusalModelSelected':
    case 'refusalModelAnnounced': case 'refusalSessionReplaced': case 'refusalWriteAbandoned':
      return state
    case 'assistantDelta':
      // Turn activity — clears a live stall (AC2). Already returns a fresh `items`, so just carry
      // `stalled: false`.
      return {
        // #1013: the stamp is handed through unconditionally; `appendDelta` decides which of the two
        // branches it lands on. `undefined` (no clock at the producer) is a legal value here.
        items: appendDelta(state.items, event.turnId, event.text, event.createdAt, event.parentToolUseId),
        phase: state.phase,
        stalled: false,
        apiRetry: state.apiRetry,
        compacting: state.compacting,
        resetting: state.resetting,
        localSendPending: state.localSendPending,
        // #1314: carried. Turn content is NOT one of the three clearing edges — see the field's contract.
        thinkingTokens: state.thinkingTokens
      }
    case 'toolUse':
      // Turn activity — clears a live stall (AC2). Already appends a fresh `items`, so just carry
      // `stalled: false`.
      return {
        items: [
          ...state.items,
          {
            kind: 'toolCall',
            turnId: event.turnId,
            toolUseId: event.toolUseId,
            parentToolUseId: event.parentToolUseId,
            name: event.name,
            inputSummary: event.inputSummary,
            // #643: carried onto the item verbatim — unconditional and BY REFERENCE. Never
            // `{ ...event.input }`, which on an absent map yields `{}` and silently converts absence
            // (a pre-pyrycode#1678 daemon) into emptiness. No key is singled out, nothing is
            // shortened, dropped or reordered: the store owns no display opinion (#645 does).
            input: event.input,
            result: null
          }
        ],
        phase: state.phase,
        stalled: false,
        apiRetry: state.apiRetry,
        compacting: state.compacting,
        resetting: state.resetting,
        localSendPending: state.localSendPending,
        thinkingTokens: state.thinkingTokens
      }
    case 'toolProgress': {
      const index = state.items.findIndex((item) =>
        item.kind === 'toolCall' && item.turnId === event.turnId &&
        item.toolUseId === event.toolUseId && item.result === null && item.denial === undefined
      )
      const item = state.items[index]
      if (!item || item.kind !== 'toolCall' || item.elapsedSeconds === event.elapsedSeconds) return state
      const items = state.items.slice()
      items[index] = { ...item, elapsedSeconds: event.elapsedSeconds }
      return { ...state, items }
    }
    case 'toolDenied': {
      if (event.turnId === '' || event.toolUseId === '') return state
      const index = state.items.findIndex(
        (item) => item.kind === 'toolCall' && item.turnId === event.turnId && item.toolUseId === event.toolUseId
      )
      const item = state.items[index]
      if (!item || item.kind !== 'toolCall' || item.denial !== undefined) return state
      const items = state.items.slice()
      items[index] = { ...item, denial: event.denial, elapsedSeconds: undefined }
      return { ...state, items }
    }
    case 'toolResult': {
      // #773: `resultDetail` is carried onto the result verbatim and unconditionally — never a
      // conditional spread, which would fold an empty detail into absence. The store owns no display
      // opinion (#856 does): nothing is parsed, trimmed, or turned back into a number here.
      const items = fillResult(state.items, event.toolUseId, {
        isError: event.isError,
        resultSummary: event.resultSummary,
        resultDetail: event.resultDetail
      }, event.parentToolUseId)
      // Turn activity — clears a live stall (AC2). Same-reference no-op ONLY when the result changed
      // nothing AND no stall is live; an orphan/duplicate result against a live stall must still clear
      // it, so the guard widens with `&& !state.stalled`. From `initialTimelineState` (stalled already
      // false) the orphan path still returns the same reference — the regression guard the test asserts.
      // #493/#496: the guard deliberately does NOT widen for `apiRetry` or `compacting` — both have an
      // explicit wire falling edge, so turn activity must LEAVE them showing (the inverse of `stalled`);
      // both are carried through unchanged on both paths.
      // #650: `localSendPending` follows apiRetry/compacting here, not `stalled` — turn content is not
      // the daemon's word on the turn's lifecycle (it can arrive before any `turn_state`), so clearing
      // on it would blank the indicator mid-turn while `phase` is still idle. Carried on both paths,
      // and for the same reason the guard does NOT widen for it: an orphan result against a live local
      // window must stay the same-reference no-op it is today.
      return items === state.items && !state.stalled
        ? state
        : {
            items,
            phase: state.phase,
            stalled: false,
            apiRetry: state.apiRetry,
            compacting: state.compacting,
            resetting: state.resetting,
            localSendPending: state.localSendPending,
            // #1314: carried on BOTH paths, and the guard above deliberately does NOT widen for it — the
            // `apiRetry` / `compacting` / `localSendPending` reading, not `stalled`'s. A tool result is not
            // one of the three clearing edges, so an orphan or duplicate result against a held reading
            // must stay the same-reference no-op it is today.
            thinkingTokens: state.thinkingTokens
          }
    }
    case 'turnState':
      // Turn activity — clears a live stall (AC2, "any state, including idle"). No-churn ONLY when the
      // phase is unchanged AND no stall is live; an idle-when-already-idle turnState against a live stall
      // must still clear it, so the guard widens with `&& !state.stalled`.
      // #493/#496: the guard deliberately does NOT widen for `apiRetry` or `compacting` — a turn-state
      // change arriving mid-retry or mid-compaction is expected and must leave the status showing (the
      // inverse of `stalled`); both are carried unchanged.
      // #650: this arm CLOSES a locally-opened working-indicator window — the daemon has spoken, so its
      // phase is authoritative from here and the local stand-in has done its job. Any state closes it,
      // including `idle`, which is why the no-churn guard widens a SECOND time with
      // `&& !state.localSendPending`: the local window opens at `idle` and the daemon's terminal
      // `turn_state` is `idle` too, so without this clause the common case early-outs and the indicator
      // never comes down. Decided, not missed: a send issued while the PREVIOUS turn is still finishing
      // has its window closed by that turn's `turn_state{idle}`, so the indicator can go briefly dark
      // until the daemon reports the new turn — the ticket's own reading, and the queued-message path
      // (#293/#294) is where that case properly lives.
      // #1314: this arm is the FIRST of the reading's three clearing edges, and the only conditional one —
      // the daemon re-asserting `thinking` is not a clear (a reading and the phase that produced it are the
      // same fact), while any other state means the think this reading described is over. So the guard
      // widens a THIRD time, and for `localSendPending`'s exact reason rather than by symmetry: without the
      // new clause a `turn_state{idle}` against an already-idle phase early-outs, and a reading from the
      // finished turn is still on screen. Expressed as a condition on the EVENT's state, never on
      // `state.phase`, so a reading that arrives before the daemon's first `turn_state` is not clung to by
      // a stale phase.
      return event.state === state.phase &&
        !state.stalled &&
        state.localSendPending === null &&
        (event.state === 'thinking' || state.thinkingTokens === null)
        ? state
        : {
            items: state.items,
            phase: event.state,
            stalled: false,
            apiRetry: state.apiRetry,
            compacting: state.compacting,
            resetting: state.resetting,
            localSendPending: null,
            thinkingTokens: event.state === 'thinking' ? state.thinkingTokens : null
          }
    case 'turnEnd':
      // Appends a boundary; does NOT reset phase — the daemon emits `turn_state: 'idle'` separately.
      // NOT in AC2's clear set: a turn boundary is not turn activity; the paired `turn_state: idle` is
      // what clears. `stalled` carried through unchanged.
      return {
        items: [
          ...state.items,
          { kind: 'turnBoundary', turnId: event.turnId, stopReason: event.stopReason,
            outcome: event.outcome, isError: event.isError, terminalReason: event.terminalReason, errorCategory: event.errorCategory,
            durationMs: event.durationMs, inputTokens: event.inputTokens, cacheReadTokens: event.cacheReadTokens,
            cacheCreationTokens: event.cacheCreationTokens, outputTokens: event.outputTokens, costUsdTotal: event.costUsdTotal }
        ],
        phase: state.phase,
        stalled: state.stalled,
        apiRetry: state.apiRetry,
        compacting: state.compacting,
        resetting: state.resetting,
        localSendPending: state.localSendPending,
        // #1314: the SECOND clearing edge. A turn boundary is not turn activity — which is why `stalled`
        // is carried one line up — but it is the end of the thinking this reading measured, and the daemon
        // sends no falling edge of its own for the reading to wait on. It clears here even though `phase`
        // does not reset (the paired `turn_state: idle` owns that), so the row keeps showing the thinking
        // label and it reverts to the bare copy — the shape AC4's e2e reads positively.
        thinkingTokens: null
      }
    case 'userText':
      // Fresh messages append whole, preserving row treatment and held attachment references.
      // A receipt does not represent a new local submission, so it leaves the pending window alone.
      return {
        items: [
          ...state.items,
          {
            kind: 'userText',
            text: event.text,
            createdAt: event.createdAt,
            messageId: event.messageId,
            attachments: event.attachments
          }
        ],
        phase: state.phase,
        stalled: state.stalled,
        apiRetry: state.apiRetry,
        compacting: state.compacting,
        resetting: state.resetting,
        // #1725: a second send replaces the window, so the label follows the newest sent id.
        localSendPending: event.received === true
          ? state.localSendPending
          : { messageId: event.messageId ?? '', queued: false },
        // #1314: carried. A renderer-sourced echo is no more the daemon's word on the reading than it is
        // on the stall one line up; the operator sending a second message mid-turn does not un-say how
        // deep the running think is.
        thinkingTokens: state.thinkingTokens
      }
    case 'dropUserText':
      // Local identity removal is handled before content reduction.
      return state
    case 'sessionBoundary':
      // A whole boundary marker: fresh tail-append (never coalesced), `phase` untouched — the `userText` /
      // `turnEnd` discipline. Always a new `items` array (a fresh append is always a change). AC1. NOT in
      // AC2's clear set: a session rotation is not turn activity, so `stalled` is carried unchanged.
      //
      // #1517: THE ONE EXCEPTION, and it is a deliberate departure from the sentence above rather than
      // a widening of the turn-activity rule. `resetting` clears here because a reset ENDS in a session
      // rotation, so this marker is the independent trigger the wire contract demands for a daemon
      // killed mid-reset with no falling edge to send. It is a BELT: the falling edge is the primary
      // clear, the two ride separate producers, and neither order between them is pinned. Unconditional
      // rather than guarded — a boundary arriving with no reset live writes `null` over `null`, which
      // this arm already pays for by always rebuilding the state (a fresh append is always a change).
      return {
        items: [
          ...state.items,
          {
            kind: 'sessionBoundary',
            reason: event.reason,
            workspaceCwd: event.workspaceCwd,
            occurredAt: event.occurredAt
          }
        ],
        phase: state.phase,
        stalled: state.stalled,
        apiRetry: state.apiRetry,
        compacting: state.compacting,
        // #1517's belt — the ONE scalar this arm does not carry. See the comment above the return.
        resetting: null,
        localSendPending: state.localSendPending,
        thinkingTokens: state.thinkingTokens
      }
    case 'unrecognizedMessage':
      // A whole diagnostic marker: fresh tail-append, `phase` untouched — the `sessionBoundary` /
      // `userText` discipline. Always a new `items` array (a fresh append is always a change).
      //
      // DELIBERATELY NOT COALESCED, and this is the one design decision worth defending here. Every
      // other repeat-prone thing in this reducer collapses; this one must not. A repeat is a real
      // repeat, and how often it fires is precisely the number that tells an operator to go fix
      // something — collapsing repeats would hide the signal the row exists to carry.
      //
      // NOT in the turn-activity clear set either: an unrecognized message is not turn activity, so
      // `stalled`, `apiRetry` and `compacting` are all carried through unchanged. It neither opens nor
      // closes a turn, matching the daemon, which cannot honestly attribute one.
      return {
        items: [
          ...state.items,
          {
            kind: 'unrecognizedMessage',
            site: event.site,
            messageType: event.messageType,
            raw: event.raw,
            truncated: event.truncated
          }
        ],
        phase: state.phase,
        stalled: state.stalled,
        apiRetry: state.apiRetry,
        compacting: state.compacting,
        resetting: state.resetting,
        localSendPending: state.localSendPending,
        thinkingTokens: state.thinkingTokens
      }
    case 'attachmentOffered':
      // #1621: a whole offered-file row, tail-appended in arrival order (the frame has no `turn_id`, the
      // `userText` / `sessionBoundary` discipline). NOT turn activity: every chrome scalar and `phase` are
      // carried unchanged. A repeat of an attachment id this timeline already holds AS AN OFFER is a
      // same-reference no-op; the id is compared for strict equality only, never used as a key or path.
      // The record is rebuilt by name, never shared with or spread from the event.
      return state.items.some((item) =>
        item.kind === 'attachmentOffer' && item.attachment.attachmentId === event.attachment.attachmentId)
        ? state
        : {
            ...state,
            items: [...state.items, {
              kind: 'attachmentOffer',
              attachment: { attachmentId: event.attachment.attachmentId, filename: event.attachment.filename }
            }]
          }
    case 'stallDetected':
      // #317: onset-only stall — set the scalar, leave `items`/`phase` untouched. A redundant onset (the
      // stall is already live) is a same-reference no-op, mirroring the pure-duplicate discipline of the
      // other arms. `apiRetry` and `compacting` are independent facts, carried through unchanged, and
      // #650's `localSendPending` joins them: a stall is not the daemon's word on whether the operator's
      // send was answered, so it neither opens nor closes the local window.
      return state.stalled
        ? state
        : {
            items: state.items,
            phase: state.phase,
            stalled: true,
            apiRetry: state.apiRetry,
            compacting: state.compacting,
            resetting: state.resetting,
            localSendPending: state.localSendPending,
            thinkingTokens: state.thinkingTokens
          }
    case 'apiRetry': {
      // #493: the two-edged api-retry status — set from the rising edge, cleared ONLY by the falling one.
      // `items`/`phase`/`stalled`/`compacting` are untouched on every path: the retry status is chrome,
      // and it neither clears nor is cleared by the other two scalars (three independent daemon facts,
      // the #317 posture).
      if (!event.active) {
        // The falling edge. `event.current` / `event.total` are deliberately NOT read — the wire repeats
        // the last-known counter here and it is ignored. A falling edge against no live retry is a
        // same-reference no-op.
        return state.apiRetry === null
          ? state
          : {
              items: state.items,
              phase: state.phase,
              stalled: state.stalled,
              apiRetry: null,
              compacting: state.compacting,
              resetting: state.resetting,
              localSendPending: state.localSendPending,
              thinkingTokens: state.thinkingTokens
            }
      }
      // The rising edge re-fires as the count climbs and the daemon may repeat an identical frame (no
      // wire-side dedup), so an unchanged counter returns the SAME state reference — the status never
      // stacks, duplicates, or flickers (AC2) — while a climbing count swaps in a fresh status record.
      // `{ current: 0, total: 0 }` is held as a PRESENT status ("retrying, count unknown"), never null.
      const held = state.apiRetry
      if (held !== null && held.current === event.current && held.total === event.total) return state
      return {
        items: state.items,
        phase: state.phase,
        stalled: state.stalled,
        apiRetry: { current: event.current, total: event.total },
        compacting: state.compacting,
        resetting: state.resetting,
        localSendPending: state.localSendPending,
        thinkingTokens: state.thinkingTokens
      }
    }
    case 'resetting': {
      // #1517: the two-edged reset status — set from the rising edge, cleared by the falling one and by
      // the `sessionBoundary` belt above. `items`, `phase` and the other four chrome scalars are
      // untouched on EVERY path, and that is this arm's load-bearing property rather than tidiness: the
      // wrap-up turn streams into `items` while the label shows, so a reset must neither clear turn
      // state nor be cleared by it.
      if (!event.active) {
        // The falling edge. Both tokens are deliberately NOT read — the wire repeats the last-known
        // pair here (or two empty strings) and it is ignored, `apiRetry`'s rule. A falling edge against
        // no live reset is a same-reference no-op.
        return state.resetting === null
          ? state
          : {
              items: state.items,
              phase: state.phase,
              stalled: state.stalled,
              apiRetry: state.apiRetry,
              compacting: state.compacting,
              localSendPending: state.localSendPending,
              thinkingTokens: state.thinkingTokens,
              resetting: null
            }
      }
      // The rising edge RE-FIRES as the phase advances, and the daemon may also repeat an identical
      // frame (no wire-side dedup), so an unchanged pair returns the SAME state reference — the label
      // never flickers — while a changed `phase` or `handoff` swaps in a fresh record. That swap is
      // what makes `wrapping_up` → `restarting` RELABEL the row rather than read as a second reset.
      // Both tokens are compared: `restarting`/`pending` → `restarting`/`written` is a real change the
      // suffix depends on, and comparing `phase` alone would drop it.
      const held = state.resetting
      if (held !== null && held.phase === event.phase && held.handoff === event.handoff) return state
      return {
        items: state.items,
        phase: state.phase,
        stalled: state.stalled,
        apiRetry: state.apiRetry,
        compacting: state.compacting,
        localSendPending: state.localSendPending,
        thinkingTokens: state.thinkingTokens,
        // A fresh named-field literal, never a spread of the event — the same discipline the bridge
        // applies one layer up, and what keeps a future `ThreadEvent` field from silently entering the
        // store. An empty `phase` with `active: true` is held as it arrives: it decodes (the decoder
        // refuses to cross-validate the pair), so the LABEL decides what an unnamed phase reads as.
        resetting: { phase: event.phase, handoff: event.handoff }
      }
    }
    case 'compacting': {
      if (state.compacting === event.active) return state
      if (event.active) return { ...state, compacting: true, pendingCompaction: undefined }
      const item: Extract<ThreadItem, { kind: 'compactionBoundary' }> = {
        kind: 'compactionBoundary',
        failed: event.compactResult === 'failed' || (event.compactError !== undefined && event.compactError !== ''),
        manual: false
      }
      return { ...state, compacting: false, items: [...state.items, item],
        pendingCompaction: item.failed ? undefined : item }
    }
    case 'compactionBoundary': {
      const item: Extract<ThreadItem, { kind: 'compactionBoundary' }> = {
        kind: 'compactionBoundary', failed: false, manual: event.trigger === 'manual',
        preTokens: event.preTokens, postTokens: event.postTokens
      }
      const pending = state.pendingCompaction
      const index = pending === undefined ? -1 : state.items.indexOf(pending)
      const items = index < 0 ? [...state.items, item] : state.items.map((held, i) => i === index ? item : held)
      return { ...state, items, pendingCompaction: undefined }
    }
    case 'thinkingProgress':
      // #1314: the latest thinking-token reading. The state IS the event's payload, so there is one
      // expression and no edge to translate — the closest arm in shape to `compacting` directly above, and
      // the furthest from it in meaning (that one carries a two-edged liveness fact; this one carries a
      // number and has no edges at all, so its clears live on OTHER arms).
      //
      // ASSIGNED, NEVER COMPARED FOR MAGNITUDE. The reading is not monotonic — it restarts near zero at
      // every inference-request boundary — so a `Math.max` or any only-if-larger guard would eat ordinary
      // traffic and freeze the label at the first request's peak.
      //
      // A verbatim repeat returns the SAME state reference: the wire has no dedup and re-fires as the
      // count climbs, so without this the label churns its subscribers on every identical frame. `0` takes
      // this path like any other value — the check is on equality, never on truthiness.
      //
      // `items` / `phase` are untouched on every path: a reading is chrome, and it neither opens, closes
      // nor alters a turn (the frame carries no turn_id and the daemon attributes none). The other four
      // chrome scalars are independent facts, carried through unchanged.
      return state.thinkingTokens === event.estimatedTokens
        ? state
        : {
            items: state.items,
            phase: state.phase,
            stalled: state.stalled,
            apiRetry: state.apiRetry,
            compacting: state.compacting,
            resetting: state.resetting,
            localSendPending: state.localSendPending,
            thinkingTokens: event.estimatedTokens
          }
    case 'reset':
      // All seven fields clear in one step. Returning the shared const rather than a hand-written
      // literal is what makes the equality with `initialTimelineState` an identity instead of a
      // coincidence — an eighth `TimelineState` field is cleared for free, where a literal would
      // silently keep the stale value and still compile. (#650's `localSendPending` is the sixth and
      // #1314's `thinkingTokens` the seventh, and
      // it cost this arm nothing: a conversation switch or an unpair leaves no locally-opened window
      // behind, for free.) It also buys two properties: a second reset
      // is a no-op reference (idempotent), and `items` stays the SAME reference, so a no-op reset
      // churns no `selectItems` subscriber where a fresh `[]` would re-render every one of them.
      // Aliasing the shared `items` is safe because the reducer only ever spreads it into a new
      // array, never mutates it (pinned by the purity block). The `sessionStore.ts` #166 rationale.
      return initialTimelineState
    case 'reconnected': {
      // #538: the reconnect reconcile — the narrower sibling of `reset` above, deliberately adjacent so
      // the contrast (full wipe vs chrome-only) reads in one screen. `apiRetry` and `compacting` are
      // cleared ONLY by a wire falling edge (the two un-widened guards at :271/:288 are why), so an edge
      // lost to a disconnect leaves the banner stuck until the app restarts. `protocol-mobile.md`
      // § Reconnect / Backfill splits reconnect by data type: Mode B (control state) resets and rebuilds
      // from whatever the daemon re-asserts, while Mode A (the transcript) reconciles by cursor backfill.
      // The six chrome scalars are Mode B; `items` is Mode A, which is exactly why it survives BY
      // REFERENCE here — a fresh array would blank nothing but would re-render every `selectItems`
      // subscriber, and the shared `initialTimelineState.items` would blank the transcript outright.
      //
      // Hand-written literal, NOT `{ ...initialTimelineState, items: state.items }`: the spread would
      // clear a future seventh field for free, and "for free" is the wrong default here — a new field
      // could be durable Mode A content (wrongly wiped) as easily as Mode B chrome (rightly cleared).
      // The explicit seven fields make an eighth a COMPILE ERROR in this arm, forcing that classification.
      // (`reset` returning the shared constant is the deliberate opposite: it clears everything, so
      // "for free" is unambiguously right there.) It is also this file's idiom — every arm writes all
      // six out. The early-out predicate below is the one thing the compiler cannot keep in sync: a
      // new chrome field must be added to it by hand.
      //
      // #650 is that classification for the sixth field, and it is Mode B: a locally-opened working
      // indicator is client-owned transient chrome, and it carries the reconnect hazard in its sharpest
      // form — opened with no daemon involvement, so if the send never reached the daemon there may be no
      // falling edge at all to wait for (pyrycode #1062 records the daemon side: an abandoned conversation
      // gets no `turn_state{idle}`, its client expected to self-clear). Hence the fourth predicate clause:
      // a state whose ONLY live chrome is a locally-opened window must NOT early-out, or an indicator
      // opened for a turn that ended while the app was offline is still showing after a fresh handshake.
      //
      // Nothing live to clear ⇒ the SAME state reference, so a first connect, or a reconnect with clean
      // chrome, churns no subscriber (the #415 `modalPrompts` shape).
      //
      // After replay, the daemon re-asserts a running turn's current `turn_state` without an event ID
      // (pyrycode #2712). That later event restores the open conversation's phase; silence keeps idle
      // when the turn ended offline. `api_retry` / `compacting` still have no connect-time reassertion,
      // so those cleared statuses wait for their next wire edge.
      // #1314 is that classification for the seventh field, and it is Mode B: a thinking-token reading is
      // transient chrome about a turn that was running on the OTHER side of the disconnect, and the daemon
      // re-asserts no `thinking_progress` on connect. Held across the reconcile it would report the depth
      // of a think that has since finished — the stuck-banner hazard in its plainest form, since this
      // frame has no falling edge at all to lose. Hence the fifth predicate clause: a state whose ONLY
      // live chrome is a held reading must NOT early-out.
      // #1517 is that classification for the eighth field, and it is Mode B alongside its three
      // neighbours: the daemon re-asserts no `resetting` on connect, and this frame's falling edge is
      // exactly the one a disconnect eats — so a record held across the reconcile would report a reset
      // that has since finished, or one whose daemon is gone. Hence the sixth predicate clause: a state
      // whose ONLY live chrome is a held reset must NOT early-out.
      const nothingLive =
        state.phase === 'idle' &&
        !state.stalled &&
        state.apiRetry === null &&
        !state.compacting &&
        state.localSendPending === null &&
        state.thinkingTokens === null &&
        state.resetting === null
      return nothingLive
        ? state
        : {
            items: state.items,
            phase: 'idle',
            stalled: false,
            apiRetry: null,
            compacting: false,
            localSendPending: null,
            thinkingTokens: null,
            resetting: null
          }
    }
    default:
      return assertNever(event)
  }
}

export const initialTimelineState: TimelineState = {
  items: [],
  phase: 'idle',
  stalled: false,
  apiRetry: null,
  compacting: false,
  localSendPending: null,
  thinkingTokens: null,
  resetting: null
}

/** Selectors — the read surface, mirroring `sessionStore`'s. */
export const selectItems = (s: TimelineState): readonly ThreadItem[] => s.items
export const selectPhase = (s: TimelineState): TurnPhase => s.phase
export const selectStalled = (s: TimelineState): boolean => s.stalled
export const selectApiRetry = (s: TimelineState): ApiRetryStatus | null => s.apiRetry
export const selectCompacting = (s: TimelineState): boolean => s.compacting
export const selectLocalSendPending = (s: TimelineState): LocalSendPending | null => s.localSendPending

/**
 * #1725: the daemon has said it holds the newest local send. Every `send_message` is enqueued and each
 * enqueue pushes a `queue_state` carrying the client's own `message_id`, so a snapshot listing the
 * window's id moves the label from "Sending…" to "Waiting for Claude". STICKY: claude can commit the
 * item, and a snapshot without it can arrive, before `turn_state{thinking}` does — so nothing here ever
 * sets `queued` back. Only the window's own non-empty id matches; another device's item or an item with
 * no id leaves the window as it is. Same reference whenever nothing changes.
 */
export function markLocalSendQueued(state: TimelineState, queued: readonly QueuedItem[]): TimelineState {
  const claimed = new Set<number>()
  const echoes = state.localEchoes ?? []
  let changed = false
  const localEchoes = echoes.map(e => {
    if (e.settled && e.queuedMsgId === undefined) return e
    const entry = e.queuedMsgId === undefined
      ? queued.find(q => q.message_id === e.messageId && !claimed.has(q.queued_msg_id) &&
          !echoes.some(other => other.queuedMsgId === q.queued_msg_id))
      : queued.find(q => q.queued_msg_id === e.queuedMsgId)
    if (entry) claimed.add(entry.queued_msg_id)
    if (e.queuedMsgId === undefined && entry && !e.settled) {
      changed = true
      return { ...e, queuedMsgId: entry.queued_msg_id, delivery: undefined }
    }
    if (e.queuedMsgId !== undefined && !entry && !e.released) {
      changed = true
      return { ...e, released: true as const }
    }
    return e
  })
  if (changed) state = { ...state, localEchoes }
  const pending = state.localSendPending
  if (pending === null || pending.queued || pending.messageId === '') return state
  if (!queued.some(item => item.message_id === pending.messageId)) return state
  return { ...state, localSendPending: { messageId: pending.messageId, queued: true } }
}
export const selectThinkingTokens = (s: TimelineState): number | null => s.thinkingTokens
