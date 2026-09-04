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
 * literal unions are identical), and turns a future fifth wire site into a compile error here.
 */
export type UnrecognizedSite = 'line_type' | 'assistant_block' | 'user_block' | 'undecodable'

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
  // #1013: `createdAt` is the epoch-millisecond moment this bubble first appeared — the arrival of its
  // FIRST delta, stamped in the renderer from an injected clock, not carried from the envelope `ts` (the
  // `assistantDelta` IPC arm names four fields fail-closed and does not forward it; the two agree to within
  // network latency, and the timeline is in-memory and cleared on exit and pairing end (#757), so nothing
  // replays old messages a fresh clock would mis-stamp). ABSENT means no clock was injected at the producer
  // — test `item.createdAt === undefined`, never `'createdAt' in item`, since the reducer assigns the field
  // unconditionally. Absence is a LEGAL item, not a defect: it is what every spec that injects no clock
  // produces, and #1014 renders it as the empty meta slot. Stored raw and formatted at render (the
  // `sessionBoundary.occurredAt` precedent); this store parses, compares and formats nothing.
  // Deliberately named apart from `occurredAt` below — that one is a wire-supplied ISO STRING about a
  // session rotation, this one a renderer-minted number about a message.
  | { kind: 'assistantText'; turnId: string; text: string; createdAt?: number }
  | {
      kind: 'toolCall'
      turnId: string
      toolUseId: string
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
    }
  | { kind: 'turnBoundary'; turnId: string; stopReason: string }
  // The user's own message — a renderer-sourced echo, not daemon content, so it carries no `turnId`
  // (the daemon assigns those) and no `seq` (wire fidelity for daemon deltas): just the text. Ships
  // dormant; #179 wires the producer (the composer echo) and the render row.
  //
  // #1013: `createdAt` carries the `assistantText` contract above verbatim, with one difference in WHICH
  // moment it names — the optimistic echo, i.e. when the operator pressed send, which for a
  // renderer-sourced item is the only moment there is.
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
  | { kind: 'userText'; text: string; createdAt?: number; attachments?: readonly MessageAttachment[] }
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

/**
 * The renderer-local, sealed input union the reducer consumes. camelCase and
 * `conversation_id`-free (single active conversation, ADR 0004); #199's bridge translates the
 * snake_case wire events into these. Field names mirror the wire so that bridge is a thin rename.
 */
export type ThreadEvent =
  // `seq` is carried for wire fidelity (and a future monotonicity guard) but not consulted —
  // arrival order is authoritative, per ADR 0004's caller-owns-ordering stance.
  //
  // #1013: `createdAt` is the producer's stamp, field-for-field with the `assistantText` item, so the
  // reducer stays a CARRIER of this fact rather than its source (the `input` #643 / `resultDetail` #773
  // discipline). It rides the EVENT rather than arriving as a reducer parameter for a reason worth
  // recording: `reduceTimeline` is called by the two timeline stores, which ARE production paths, so a
  // clock parameter there would stamp every item the store-level specs assert on. Absent means the
  // producer injected no clock — see the item.
  | { type: 'assistantDelta'; turnId: string; seq: number; text: string; createdAt?: number }
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
      name: string
      inputSummary: string
      input?: Readonly<Record<string, string>>
    }
  // #773: `resultDetail` is the daemon's précis of the call's structured outcome. Absent means the wire
  // omitted it (a pre-pyrycode#2024 daemon), `''` means no count — the same thing upstream, carried
  // distinctly anyway. The reducer puts it on the item's `result` verbatim; every display decision,
  // including whether an empty and an absent detail differ at all, is #856's.
  | {
      type: 'toolResult'
      turnId: string
      toolUseId: string
      isError: boolean
      resultSummary: string
      resultDetail?: string
    }
  | { type: 'turnState'; state: TurnPhase }
  | { type: 'turnEnd'; turnId: string; stopReason: string }
  // The user's own message. A whole message, never a stream of deltas — folded by a plain fresh
  // tail-append (like `toolUse`/`turnEnd`), not coalesced via `appendDelta`.
  //
  // #1013: `createdAt` is the composer's stamp, field-for-field with the `userText` item. Its sole
  // producer (`composerSend.ts`) reads it from an OPTIONAL injected `now`, so an omitted clock leaves it
  // undefined rather than falling back to the wall clock.
  //
  // #1039: `attachments` is field-for-field with the item's, and its sole producer reads it from an
  // OPTIONAL injected `takeAttachments` on the same terms — an unwired take leaves it undefined rather
  // than reaching for some other source. It rides the EVENT rather than arriving as a reducer parameter
  // for `createdAt`'s recorded reason: `reduceTimeline` is called by the two timeline stores, which are
  // production paths, so a parameter there would have to be threaded through every store-level spec.
  | { type: 'userText'; text: string; createdAt?: number; attachments?: readonly MessageAttachment[] }
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
  // #496: the daemon's compaction edge (#495 decodes it; #742 widened that daemon event with a
  // `conversationId` the bridge drops) — a filter + fresh copy (the `apiRetry` discipline), not a
  // remap. The EVENT carries `active` (true rising, false the explicit falling one); the reducer is the
  // single place that translates that edge into state. BANNER-ONLY: the wire streams no compaction
  // progress, so there is no counter here and none may be invented (the one delta from `apiRetry`). One
  // bool, no string field: AC1 ("no daemon-supplied string is ever rendered") stays true by construction.
  | { type: 'compacting'; active: boolean }
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
  | { type: 'reset' }
  // #538: the connection came back — reconcile the transient chrome against the fresh handshake. The
  // SECOND non-content arm, and distinct from `reset` (:133) in where it comes from: `reset` is
  // renderer lifecycle and `timelineBridge` never produces it, while this one is CONNECTION lifecycle
  // — bridge-produced from the `connected` wire edge — but carries no daemon content of its own.
  // Nullary following `reset`: the `connected` DaemonEvent's `HelloAckPayload` holds no field this
  // arm needs, so there is none to get wrong.
  | { type: 'reconnected' }

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

/** The whole timeline state: ordered content + the coarse lifecycle phase + the four chrome scalars. */
export interface TimelineState {
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
  localSendPending: boolean
}

/** Compile-time exhaustiveness guard: a new ThreadEvent arm without a case is a type error. */
function assertNever(event: never): never {
  throw new Error(`Unhandled thread event: ${JSON.stringify(event)}`)
}

/**
 * Coalesce a streamed text delta: if the tail item is an `assistantText` for the same turn,
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
  createdAt: number | undefined
): readonly ThreadItem[] {
  const tail = items[items.length - 1]
  if (tail && tail.kind === 'assistantText' && tail.turnId === turnId) {
    const grown: ThreadItem = {
      kind: 'assistantText',
      turnId,
      text: tail.text + text,
      createdAt: tail.createdAt
    }
    return [...items.slice(0, -1), grown]
  }
  return [...items, { kind: 'assistantText', turnId, text, createdAt }]
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
  result: ToolResult
): readonly ThreadItem[] {
  let filled = false
  const next = items.map((item) => {
    // The `kind === 'toolCall'` guard narrows `item` to the toolCall member, so the spread
    // type-checks as a valid ThreadItem with no cast. `filled` fills only the first match.
    if (!filled && item.kind === 'toolCall' && item.toolUseId === toolUseId && item.result === null) {
      filled = true
      return { ...item, result }
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
  switch (event.type) {
    case 'assistantDelta':
      // Turn activity — clears a live stall (AC2). Already returns a fresh `items`, so just carry
      // `stalled: false`.
      return {
        // #1013: the stamp is handed through unconditionally; `appendDelta` decides which of the two
        // branches it lands on. `undefined` (no clock at the producer) is a legal value here.
        items: appendDelta(state.items, event.turnId, event.text, event.createdAt),
        phase: state.phase,
        stalled: false,
        apiRetry: state.apiRetry,
        compacting: state.compacting,
        localSendPending: state.localSendPending
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
        localSendPending: state.localSendPending
      }
    case 'toolResult': {
      // #773: `resultDetail` is carried onto the result verbatim and unconditionally — never a
      // conditional spread, which would fold an empty detail into absence. The store owns no display
      // opinion (#856 does): nothing is parsed, trimmed, or turned back into a number here.
      const items = fillResult(state.items, event.toolUseId, {
        isError: event.isError,
        resultSummary: event.resultSummary,
        resultDetail: event.resultDetail
      })
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
            localSendPending: state.localSendPending
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
      return event.state === state.phase && !state.stalled && !state.localSendPending
        ? state
        : {
            items: state.items,
            phase: event.state,
            stalled: false,
            apiRetry: state.apiRetry,
            compacting: state.compacting,
            localSendPending: false
          }
    case 'turnEnd':
      // Appends a boundary; does NOT reset phase — the daemon emits `turn_state: 'idle'` separately.
      // NOT in AC2's clear set: a turn boundary is not turn activity; the paired `turn_state: idle` is
      // what clears. `stalled` carried through unchanged.
      return {
        items: [
          ...state.items,
          { kind: 'turnBoundary', turnId: event.turnId, stopReason: event.stopReason }
        ],
        phase: state.phase,
        stalled: state.stalled,
        apiRetry: state.apiRetry,
        compacting: state.compacting,
        localSendPending: state.localSendPending
      }
    case 'userText':
      // A whole user message: fresh tail-append (never coalesced), `phase` untouched — the `turnEnd`
      // arm's discipline. Always a new `items` array (a fresh append is always a change). NOT in AC2's
      // clear set: a renderer-sourced echo is not daemon turn activity, so `stalled` is carried unchanged.
      //
      // #650: and this arm OPENS the working indicator's local window. It can carry that meaning because
      // this dispatch IS the composer's accept signal: `userText` has exactly one production writer
      // (`composerSend.ts`, the optimistic echo), sitting below both of `submitMessage`'s `false` returns
      // and above its `return true`, and the daemon streams no user-message event in interactive mode. So
      // "the arm fired" and "the composer accepted the submit" are the same fact, and a refused submit
      // (whitespace-only, no active conversation) opens nothing because no code runs at all. IF A SECOND
      // `userText` PRODUCER IS EVER ADDED — a history backfill is the obvious candidate — it must be
      // re-examined against this arm, because backfilled messages are not pending sends.
      //
      // A redundant open (already pending) is deliberately NOT special-cased into a same-reference no-op:
      // this arm always builds a fresh `items` array, so it has never returned the same reference.
      //
      // #1013: `createdAt` is carried onto the item verbatim and UNCONDITIONALLY — the `input` / `resultDetail`
      // discipline, never a conditional spread. Never coalesced, so unlike `appendDelta` there is no earlier
      // stamp to preserve: a user message is whole on arrival and its time is the one the composer stamped.
      //
      // #1039: `attachments` is carried the same way and BY REFERENCE — never `[...event.attachments]`,
      // which on an absent list yields `[]` and silently converts "this message carried none" into "this
      // message carried an empty set". Sharing the array is safe for the reason the whole echo object is
      // shared across the two stores: the producer builds it fresh and never mutates it, and this reducer
      // only ever reads it. Nothing is deduplicated, reordered, bounded or inspected — the recorded order
      // is the order the uploads completed, and every display decision belongs to #815 / #868.
      return {
        items: [
          ...state.items,
          {
            kind: 'userText',
            text: event.text,
            createdAt: event.createdAt,
            attachments: event.attachments
          }
        ],
        phase: state.phase,
        stalled: state.stalled,
        apiRetry: state.apiRetry,
        compacting: state.compacting,
        localSendPending: true
      }
    case 'sessionBoundary':
      // A whole boundary marker: fresh tail-append (never coalesced), `phase` untouched — the `userText` /
      // `turnEnd` discipline. Always a new `items` array (a fresh append is always a change). AC1. NOT in
      // AC2's clear set: a session rotation is not turn activity, so `stalled` is carried unchanged.
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
        localSendPending: state.localSendPending
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
        localSendPending: state.localSendPending
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
            localSendPending: state.localSendPending
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
              localSendPending: state.localSendPending
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
        localSendPending: state.localSendPending
      }
    }
    case 'compacting':
      // #496: the two-edged compaction status — set from the rising edge, cleared ONLY by the falling one
      // (turn activity must NOT clear it; see the two deliberately un-widened guards above). The state IS
      // the event's payload, so both edges collapse into one expression: an edge that changes nothing —
      // a verbatim repeat of EITHER edge, the wire has no dedup — returns the SAME state reference, so
      // the status never stacks, duplicates, or flickers (AC3). `items`/`phase` are untouched on every
      // path: compaction is transient chrome, and it neither opens, closes, nor alters a turn (AC5).
      // `stalled` and `apiRetry` are independent daemon facts, carried through unchanged, and #650's
      // `localSendPending` joins them for the same reason it does on the stall arm.
      return state.compacting === event.active
        ? state
        : {
            items: state.items,
            phase: state.phase,
            stalled: state.stalled,
            apiRetry: state.apiRetry,
            compacting: event.active,
            localSendPending: state.localSendPending
          }
    case 'reset':
      // All six fields clear in one step. Returning the shared const rather than a hand-written
      // literal is what makes the equality with `initialTimelineState` an identity instead of a
      // coincidence — a seventh `TimelineState` field is cleared for free, where a literal would
      // silently keep the stale value and still compile. (#650's `localSendPending` is the sixth, and
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
      // The five chrome scalars are Mode B; `items` is Mode A, which is exactly why it survives BY
      // REFERENCE here — a fresh array would blank nothing but would re-render every `selectItems`
      // subscriber, and the shared `initialTimelineState.items` would blank the transcript outright.
      //
      // Hand-written literal, NOT `{ ...initialTimelineState, items: state.items }`: the spread would
      // clear a future seventh field for free, and "for free" is the wrong default here — a new field
      // could be durable Mode A content (wrongly wiped) as easily as Mode B chrome (rightly cleared).
      // The explicit six fields make a seventh a COMPILE ERROR in this arm, forcing that classification.
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
      // Accepted residual: the daemon re-asserts only the outstanding modal (#877) and the queued
      // backlog (#878) on connect — never `api_retry` / `compacting` / `turn_state` — so a status still
      // genuinely live across the reconnect shows nothing until the daemon's next edge. A briefly-missing
      // banner over a permanently-stuck one; do not engineer around it here.
      const nothingLive =
        state.phase === 'idle' &&
        !state.stalled &&
        state.apiRetry === null &&
        !state.compacting &&
        !state.localSendPending
      return nothingLive
        ? state
        : {
            items: state.items,
            phase: 'idle',
            stalled: false,
            apiRetry: null,
            compacting: false,
            localSendPending: false
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
  localSendPending: false
}

/** Selectors — the read surface, mirroring `sessionStore`'s. */
export const selectItems = (s: TimelineState): readonly ThreadItem[] => s.items
export const selectPhase = (s: TimelineState): TurnPhase => s.phase
export const selectStalled = (s: TimelineState): boolean => s.stalled
export const selectApiRetry = (s: TimelineState): ApiRetryStatus | null => s.apiRetry
export const selectCompacting = (s: TimelineState): boolean => s.compacting
export const selectLocalSendPending = (s: TimelineState): boolean => s.localSendPending
