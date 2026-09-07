# Thread timeline (conversation model)

A heterogeneous, ordered conversation-timeline data model — the foundation the structured
event-stream render vertical builds on. Introduced **alongside**
[session store](session-store.md)'s flat `MessagePayload[]` as a Strangler Fig. The cutover shipped in
[#179](../codebase/179.md): the coarse `message`/`message_chunk` render path (`MessageThread`) is
retired to dead-but-tested residue, and this model — via [timelineStore](conversation-timeline-store.md) —
is now the conversation's single thread surface.

The vertical this feeds decomposed along the transport → store → render seams the [screen snapshot
fetch](screen-snapshot-fetch.md) vertical (#180 → #187/#188) proved: [#199](../codebase/199.md)
(shipped) built the wire types, transport decode, and `DaemonEvent` arms (`assistantDelta`/`turnEnd`)
this module's `ThreadEvent` union is the eventual target of; [#202](../codebase/202.md) (shipped)
added the [Zustand store + the `DaemonEvent → ThreadEvent` bridge](conversation-timeline-store.md)
over `reduceTimeline`; [#203](../codebase/203.md) (shipped) renders the streamed text — the
blank-thread-critical slice that gates #179 (advertising the `interactive` capability). [#214](../codebase/214.md)
(shipped) wired the `turn_state` transport → bridge chain, giving `selectPhase` its first real source
(no render yet — the thinking indicator is a still-open sibling slice). [#217](../codebase/217.md)
(shipped) wired the `tool_use` transport → bridge chain, giving `reduceTimeline`'s pre-existing
`toolUse` arm its first real feed — a `toolCall` `ThreadItem` now lands on `selectItems` in arrival
order (no render yet — that is the sibling slice #218). [#229](../codebase/229.md) (shipped) wired the
`tool_result` transport → bridge chain, the vertical's last transport slice — giving `reduceTimeline`'s
pre-existing `toolResult` arm its first real feed, resolving the correlated `toolCall`'s `result` in
place via `fillResult` (no render yet — that was the sibling slice [#230](../codebase/230.md)).
[#230](../codebase/230.md) (shipped) rendered that filled `result` — the `toolCall` chip resolves in
place (pending dimming lifts, `result.isError` selects a success/error border treatment via a new
`--color-error` token) — the vertical's last render slice. [#245](../codebase/245.md) (shipped) added a
fourth `ThreadItem` kind, `userText`, dormant with a placeholder render arm. [#179](../codebase/179.md)
(shipped) flipped the `interactive` capability — every arm above now carries live daemon traffic in
production — and wired `userText`'s producer (the composer's optimistic echo, retargeted from
`sessionStore`) and real render row, retiring the coarse `MessageThread` in the same commit. The
vertical is complete.

Introduced in [#121](../codebase/121.md). Lives at
`src/renderer/src/store/threadTimeline.ts`. Pure renderer state — no IPC, no preload bridge, no
transport, no React, no wire types. See [ADR 0008](../decisions/0008-thread-timeline-model.md) for
the full rationale and normative reducer contract.

## What it does

`sessionStore`'s `MessagePayload[]` is a homogeneous list of complete text messages: no room for a
tool call between two assistant text turns, no way to grow one bubble as streamed text deltas
arrive, no way to link a tool result back to the tool call it completes. This module models that
richer shape as a pure, unit-tested value type + reducer — nothing more. There is no Zustand store,
no singleton, no React hook here; that render-integration layer is #202/#203's.

## How it works

### Types

```ts
type TurnPhase = 'thinking' | 'responding' | 'idle'
type SessionBoundaryReason = 'clear' | 'idle_evict' | 'workspace_change'
interface ToolResult { isError: boolean; resultSummary: string; resultDetail?: string }
interface MessageAttachment { attachmentId: string; filename: string }

type ThreadItem =
  | { kind: 'assistantText'; turnId: string; text: string; createdAt?: number }
  | { kind: 'toolCall'; turnId: string; toolUseId: string; name: string; inputSummary: string; input?: Readonly<Record<string, string>>; result: ToolResult | null }
  | { kind: 'turnBoundary'; turnId: string; stopReason: string }
  | { kind: 'userText'; text: string; createdAt?: number; messageId?: string; attachments?: readonly MessageAttachment[] }
  | { kind: 'sessionBoundary'; reason: SessionBoundaryReason; workspaceCwd: string | null; occurredAt: string }

type ThreadEvent =
  | { type: 'assistantDelta'; turnId: string; seq: number; text: string; createdAt?: number }
  | { type: 'toolUse'; turnId: string; toolUseId: string; name: string; inputSummary: string; input?: Readonly<Record<string, string>> }
  | { type: 'toolResult'; turnId: string; toolUseId: string; isError: boolean; resultSummary: string; resultDetail?: string }
  | { type: 'turnState'; state: TurnPhase }
  | { type: 'turnEnd'; turnId: string; stopReason: string }
  | { type: 'userText'; text: string; createdAt?: number; messageId?: string; attachments?: readonly MessageAttachment[] }
  | { type: 'sessionBoundary'; reason: SessionBoundaryReason; workspaceCwd: string | null; occurredAt: string }
  | { type: 'stallDetected' }
  | { type: 'apiRetry'; active: boolean; current: number; total: number }
  | { type: 'compacting'; active: boolean }
  | { type: 'reset' }
  | { type: 'reconnected' }
  | { type: 'dropUserText'; messageId: string }

interface TimelineState { items: readonly ThreadItem[]; phase: TurnPhase; stalled: boolean; apiRetry: ApiRetryStatus | null; compacting: boolean; localSendPending: boolean }
interface ApiRetryStatus { current: number; total: number }
```

`ThreadItem` is the durable, ordered content; `ThreadEvent` is the renderer-local (camelCase,
`conversation_id`-free) input the reducer consumes. **`turn_state` is deliberately not a
`ThreadItem` member** — it's a coarse conversation-level lifecycle scalar (the "thinking…"
indicator), so it's carried as `phase` beside `items` rather than interleaved as a timeline row.
**`stalled` ([#317](../codebase/317.md)) is a second such scalar** — a coarse, onset-only stall flag
set by the nullary `stallDetected` arm and self-cleared by the reducer on the next turn-activity
arm, likewise never a `ThreadItem` row. **`apiRetry` ([#493](../codebase/493.md)) is a third such
scalar**, but a record rather than a flag (`ApiRetryStatus | null`, not `boolean`) — present holds the
live `{ current, total }` attempt counter, `null` means no retry in flight. Unlike `stalled`, it does
**not** self-clear on turn activity: the wire's `api_retry` frame has an explicit falling edge
(`active: false`), so the reducer clears it only on that edge, carrying it through unchanged on every
other arm — the deliberate inverse of `stalled`'s clearing rule. **`compacting` ([#496](../codebase/496.md))
is a fourth such scalar**, back to a plain flag like `stalled` — but with `apiRetry`'s inverted clearing
rule, not `stalled`'s: the wire's `compacting` frame also carries an explicit falling edge, so it clears
only on that edge and survives turn activity. It stays `boolean` rather than `apiRetry`'s `| null`
record because the wire carries no counter to discard on clear — there is nothing for a `| null` shape
to make "true by construction." **`localSendPending` ([#650](../codebase/650.md)) is a fifth such
scalar** — set by the `userText` arm (the composer's own accept signal, no separate event) and cleared
only by the daemon's own turn-activity edge; its full rationale, the working-indicator consumer, and
what a `dropUserText` removal (below) deliberately leaves it as live in [Conversation shell §
Thinking / working indicator](conversation-shell-turn-status.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967),
not restated here.

**`toolCall.input` / `toolUse.input` ([#643](../codebase/643.md)) is not a sixth scalar** — it's an
optional field on an existing arm/item pair, the tool's own input fields as name → value
(pyrycode#1678, decoded at the transport by [#642](../codebase/642.md)). Absent means the wire omitted
it (a pre-#1678 daemon); an empty map is the distinct fact "this daemon sent no fields for this call."
Both the bridge and the reducer carry it unchanged and by reference — no store-level interpretation,
no key singled out, no value shortened. Ships dormant: `reduceTimeline`'s `toolUse` arm appends it
onto the `toolCall` item, but no render reads it yet — that's
[#645](https://github.com/pyrycode/pyrycode-desktop/issues/645).

**`result.resultDetail` ([#773](../codebase/773.md)) is the same kind of widen, on the outcome side.**
It is an optional field on `toolResult`/`ToolResult`, not a new scalar or item kind — the daemon's short
précis of a tool call's structured outcome (`"265 lines"`, `"110 of 1676 lines"`, pyrycode#2024). Unlike
`toolCall.input`, absence and `''` are not given different meanings here: the upstream contract states
both mean "no count," so absence means only "a daemon predating pyrycode#2024." Both states are still
carried faithfully rather than collapsed into each other, because collapsing is a lossy transform, not
because the two states mean different things. `fillResult`'s existing spread needed no change to
preserve the field, the same as `input`'s widen. Ships dormant — the sole consumer is
[#856](https://github.com/pyrycode/pyrycode-desktop/issues/856), which also owns the decision that
neither absence nor emptiness draws anything.

**`createdAt` ([#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013)) is a third field-pair widen, on `assistantText`/`userText`
and their matching event arms** — epoch milliseconds, the moment a bubble first appeared, stamped in the
renderer from an injected clock rather than carried from the envelope `ts` (the `assistantDelta` IPC arm
names four fields fail-closed and does not forward it; the timeline is in-memory and cleared on exit and
pairing end (#757), so nothing replays old messages a fresh clock would mis-stamp). Unlike `input` and
`resultDetail`, the clock is **not** threaded through `reduceTimeline` as a parameter — the field rides
the event instead, and the reason is worth stating because it is not the one the ticket's own two
cascade-count ceilings (55 reducer call sites, 68 event literals) would suggest: **the two timeline
stores (`timelineStore.ts`, `conversationTimelineStore.ts`) call `reduceTimeline` from production code**,
so a clock parameter there — optional or not — would stamp every item the stores' own specs assert on
with `toEqual`, reddening 13 of the 19 fixed expectation sites the ticket fenced. A cascade-count ceiling
answers "how many call sites move"; it does not answer "are any of them production," which is what
actually decided the seam here. `translateTimelineEvent`/`subscribeTimeline`
([conversation timeline store](conversation-timeline-store.md)) and `ComposerSendDeps.now`
([composer send](composer-send.md)) take the clock instead, both as an **optional trailing parameter with
no wall-clock default** — an absent
clock means no stamp, at every seam, which is what keeps all 135 pre-existing `assistantText`/`userText`
fixture sites compiling and passing unedited. `appendDelta` (below) is the one place the two branches
diverge: only the fresh-append case takes the incoming stamp, so a coalesced bubble keeps its *first*
delta's time. [#1014](https://github.com/pyrycode/pyrycode-desktop/issues/1014) (shipped) is the sibling
slice that renders it into the meta row [#969](../codebase/969.md) left empty — see [Conversation shell —
message bubble § The meta row](conversation-shell-message-bubble.md#the-meta-row).

**`attachments` ([#1039](https://github.com/pyrycode/pyrycode-desktop/issues/1039)) is a fourth field-pair
widen, on `userText` and its matching event arm only** — `readonly MessageAttachment[]`, the files the
operator attached to *that* message, in the order their uploads completed. The first thing in this app
that associates an attachment with a message: `attachmentId` is the daemon's own id (`driveUpload` sends
`attachment_id: uploadId`, so it names the file the host stored, not a local correlation key) and
`filename` is [#1038](../codebase/1038.md)'s display name, its first consumer. Field names match
`AttachmentSaveRequest` (`src/shared/ipc/attachmentSave.ts`) so a future save leg can take the record with
no remap — a **declaration**, not an import: this module pulls in no IPC contract to save four words, the
same call `SessionBoundaryReason`'s re-declaration already makes at the wire boundary.

**Absent means none, and unlike every field above it there is no empty-vs-absent distinction to carry** —
test `item.attachments === undefined`, never `'attachments' in item`, the same idiom as `createdAt`. The
sole producer, [composer send](composer-send.md)'s `submitMessage`, normalises an empty pending set to
`undefined` *before* building the event, so `reduceTimeline` never has to decide what `[]` means; it
carries whatever arrives, unconditionally and **by reference** — never a spread, which on an absent list
would silently mint `[]` and convert "this message carried none" into "this message carried an empty set."
Like `createdAt`, the field rides the event rather than a `reduceTimeline` parameter, for the same
call-sites-are-production reason. Ships live, not dormant: #1039 also wired the sole producer in the same
commit, so `selectItems` can carry a filled `attachments` list from the day the field exists — #815 (the
non-image file row) has since shipped its renderer, in [Conversation shell — message bubble § The
attachment file row](conversation-shell-message-bubble-attachments.md#the-attachment-file-row-815-816); #868 (the image
thumbnail, and #869's click that opens it) has since shipped too. See [Composer attach § Pending
attachments](composer-attach.md#pending-attachments-1039) for how the composer accumulates the set between
sends, and [Thread timeline — history](thread-timeline-history.md#configuration-and-usage) for the ticket
note.

**`messageId` ([#1213](https://github.com/pyrycode/pyrycode-desktop/issues/1213)) is a fifth field-pair
widen, on `userText` and its matching event arm only, but for a different reason than the four above** —
not display, but correlation. It is the id [composer send](composer-send.md)'s `submitMessage` already
mints for the message's own `send_message` wire frame, retained on the echo unconditionally rather than
discarded once the frame is sent — one mint, two uses, so the wire and this row can never name different
messages. It exists so a later `dropUserText` (below) can find the echo again when the operator cancels
the queued message it stood for: the daemon parks a mid-turn send instead of running it and echoes the
same id back on the [queue store](queue-store.md)'s `QueuedItem.message_id`
(pyrycode#2092), and nothing else the two rows share is a key (`text` is not unique, position mis-aligns
on the first drop). Absent means the producer minted none — test `item.messageId === undefined`, never
`'messageId' in item`, since the reducer assigns it unconditionally; this is the shape a future history
backfill producer would take, and an id-less echo correlates with nothing and can never be removed by a
drop. Untrusted on the read side, on the same terms as `text`: the value it is compared against arrives
from another client through a content-blind relay, so it is read for strict string equality only — never
a lookup path, a cache key, a filename, a URL, a `Map` key or a React key (`selectItems`' render key stays
array index, per § Edge cases below). Field-for-field identical between the item and the event; production
always carries one (`submitMessage`'s `newMessageId` is required), but it stays optional on both types
because the union is constructed unstamped in dozens of specs and requiring it would buy nothing an
id-less, un-droppable row doesn't already give for free.

**[#1214](https://github.com/pyrycode/pyrycode-desktop/issues/1214) gave this field a second consumer,
for the opposite direction of the same correlation.** `dropUserText` above *removes* an item by matching
`messageId`; `foldQueuedRows` (`src/renderer/src/screens/conversation/foldQueuedRows.ts`) *marks* one by
the same match, joining a `ThreadItem` against the [queue store](queue-store.md)'s held `QueuedItem` rows
so a message the daemon has queued but not yet run draws as one row rather than two. Both readers inherit
the identical field contract stated above — strict string equality only, never a rendered value, a `Map`
key or a React key — rather than restating it. See [Conversation shell — conversation surfaces and
modals § Queued rows folded into the
thread](conversation-shell-conversation-and-modals.md#queued-rows-folded-into-the-thread-1214-was-294-drop-since-296-echo-removal-since-1213).

### The reducer

`reduceTimeline(state, event): TimelineState` is pure and exported — no mutation, fresh state,
`switch` on `event.type` with an `assertNever` default — the same discipline as `sessionStore`'s
`reduceSession`:

| event | effect |
|---|---|
| `assistantDelta` | tail-check coalesce: same-`turnId` tail `assistantText` → replace with concatenated text, keeping the **tail's own** `createdAt` ([#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013), so a coalesced bubble stays dated by its first delta); otherwise append fresh, carrying the event's `createdAt`. `seq` carried, not consulted — arrival order is authoritative. |
| `toolUse` | append a fresh `toolCall` with `result: null` |
| `toolResult` | find the `toolCall` with matching `toolUseId` **and** `result === null`, fill it in place. No match (orphan or already-resolved duplicate) → **same `state` reference**, a deterministic non-throwing no-op. |
| `turnState` | set `phase`; same reference if unchanged (no-churn) |
| `turnEnd` | append a `turnBoundary`; does **not** touch `phase` |
| `userText` | append a fresh `userText` item, carrying the event's `createdAt`, `messageId` and `attachments` unconditionally and by reference (never coalesced, so unlike `assistantDelta` there is no earlier stamp or set to preserve — [#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013), [#1039](https://github.com/pyrycode/pyrycode-desktop/issues/1039), [#1213](https://github.com/pyrycode/pyrycode-desktop/issues/1213)); does **not** touch `phase` — the user's own message, sourced from the composer echo since [#179](../codebase/179.md) |
| `sessionBoundary` | append a fresh `sessionBoundary` item (never coalesced); does **not** touch `phase` — the `/clear`/idle-eviction/workspace-change marker, sourced from the daemon's `sessionTransition` event via the bridge since [#286](../codebase/286.md) |
| `stallDetected` | set `stalled: true`; `items`/`phase` untouched. Same reference if `stalled` is already `true` (no-churn) — [#317](../codebase/317.md) |
| `apiRetry` | `active: true` → hold `{ current, total }` (same reference if unchanged, no-churn); `active: false` → `null`, discarding the event's counter unconditionally. `items`/`phase`/`stalled` untouched — [#493](../codebase/493.md) |
| `compacting` | `state.compacting === event.active` → same reference (no-churn on a verbatim repeat of either edge); otherwise fresh state with `compacting: event.active`. `items`/`phase`/`stalled`/`apiRetry` untouched — [#496](../codebase/496.md) |
| `reset` | returns `initialTimelineState` — all five fields at once, by returning the shared constant rather than a fresh literal. Idempotent by reference (a second reset is a no-op); `items` stays the same reference post-reset, so no `selectItems` subscriber churns — [#528](../codebase/528.md) |
| `reconnected` | clears `phase`→`idle`, `stalled`→`false`, `apiRetry`→`null`, `compacting`→`false` via a hand-written five-field literal (not a spread of `initialTimelineState`); `items` preserved **by reference**. Same reference if all four are already clean (no-churn on a first connect, or a reconnect with nothing live) — [#538](../codebase/538.md) |
| `dropUserText` | remove the **first** `userText` item whose `messageId` strictly equals `event.messageId` (`removeUserEcho`, below); same `items` reference on no match. The **only** arm that removes an item — everything else appends or coalesces. Every chrome scalar, `localSendPending` included, is carried through unchanged; not a second `userText` producer and not its inverse — see § Edge cases — [#1213](https://github.com/pyrycode/pyrycode-desktop/issues/1213) |

`items` and `phase` are orthogonal: content events never touch `phase`, `turnState` never touches
`items`. **`stalled` ([#317](../codebase/317.md)) is a third, independent axis**: the four
turn-activity arms (`assistantDelta`/`toolUse`/`toolResult`/`turnState`) clear it to `false`; the three
non-activity arms (`turnEnd`/`userText`/`sessionBoundary`) carry it through unchanged — a boundary
marker, a renderer-sourced echo, and a session rotation are none of them daemon turn activity. The two
pre-existing same-reference no-op guards (`toolResult`'s orphan/duplicate check, `turnState`'s
same-phase check) widen to `&& !state.stalled`, since an orphan result or an idle-when-already-idle
`turnState` is still turn activity and must still clear a live stall.
**`apiRetry` ([#493](../codebase/493.md)) is a fourth, independent axis with inverted clearing
rules**: every one of the nine other arms carries it through unchanged — including the four
turn-activity arms that clear `stalled` — since `api_retry` clears only on its own explicit falling
edge, never on turn activity. The two `&& !state.stalled` guards above deliberately do **not** gain a
matching `&& apiRetry === null`-style clause; doing so would silently clear a live retry on ordinary
turn activity.
**`compacting` ([#496](../codebase/496.md)) is a fifth, independent axis, the same inverted-clearing
shape as `apiRetry`**: every other arm carries it through unchanged, and the two `&& !state.stalled`
guards do not gain a compaction term either — `compacting` clears only on its own explicit falling
edge. Unlike `apiRetry`, there's no counter to carry, so the arm collapses to a single
same-reference-or-fresh-state ternary rather than a two-branch rising/falling split.
`initialTimelineState = { items: [], phase: 'idle', stalled: false, apiRetry: null, compacting: false }`;
pure selectors `selectItems`, `selectPhase`, `selectStalled`, `selectApiRetry`, `selectCompacting` are
the only read surface.

### Internal helpers (unexported)

- `appendDelta(items, turnId, text, createdAt)` — the tail-check coalesce for `assistantDelta`; always
  returns a new array (a delta is always a change). `createdAt` ([#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013))
  is a **required** fourth parameter — module-private with one call site, so there is no cascade to buy
  off, and requiring it makes forgetting it a compile error at that one site. The grow branch reads
  `tail.createdAt` (this function rebuilds the item as a fresh literal on every coalesced delta, so
  carrying the incoming stamp instead would silently re-date a bubble to its most recent fragment); only
  the fresh-append branch reads the parameter.
- `removeUserEcho(items, messageId)` ([#1213](https://github.com/pyrycode/pyrycode-desktop/issues/1213))
  — `dropUserText`'s helper: removes the **first** `userText` item whose `messageId` strictly equals
  `messageId`, `fillResult`'s discipline one shape over (a `removed` flag rather than a bare `filter`, so
  an unmatched drop returns `items` by reference and the reducer's same-reference contract holds).
  First-match-only rather than filter-everything: ids are unique in production (the composer mints one
  per send), so the two agree on every real input, and the narrower rule is the one that cannot surprise
  — a single operator click may never take two rows out of the transcript. The `kind === 'userText'`
  guard makes "only a user echo can ever be removed" structural: no other item kind carries a
  `messageId`, so no daemon-authored row has a path to this branch whatever the wire says.
- `fillResult(items, toolUseId, result)` — the `toolResult` correlate-and-fill. Narrows via a
  `.map` callback whose `item.kind === 'toolCall'` guard narrows `item` so the spread
  (`{ ...item, result }`) type-checks with **no cast** — the codebase bans unchecked `as` in
  production even when a cast would be provably safe (code review caught an index-cast version of
  this in the first submission; see [#121 codebase notes](../codebase/121.md) § Patterns
  established). Returns the same array reference on no match, so the reducer can return the same
  `state`.

## Configuration and usage

The full ticket-by-ticket build-out — every arm, scalar and field this model has grown, transport slice
through render slice — moved to [Thread timeline — history](thread-timeline-history.md) on 2026-09-04 to
stay under the size cap. What follows here is enough to place the module; that page has the rest.

Nothing imports this module yet (as of #121). The vertical decomposed transport → store → render:
[#199](../codebase/199.md) built the wire types and `DaemonEvent` arms this module's `ThreadEvent` union
targets; [#202](../codebase/202.md) added the [store + bridge](conversation-timeline-store.md);
[#203](../codebase/203.md) rendered the streamed text, gating #179; [#179](../codebase/179.md) flipped the
`interactive` capability, wired `userText`'s producer (the composer echo) and retired the coarse
`MessageThread` mount — the vertical is complete. See
[Thread timeline — history § Configuration and usage](thread-timeline-history.md#configuration-and-usage)
for every ticket in between and since, including [#1039](../codebase/1039.md), which widened `userText`
with the `attachments` field documented above (§ Types).


## Edge cases and limitations

- **Uncorrelated or duplicate `tool_result` is a silent no-op, not a surfaced error.** Evidence-based:
  the structured stream wasn't receivable before [#179](../codebase/179.md) flipped `interactive`, so
  no orphan had been observed in practice at design time. This absorbs a mid-turn-reconnect orphan (the
  `tool_use` fell before a replay cursor) without killing the timeline, but revisit if #202's
  reconnect replay is shown to actually produce them now that the stream carries live traffic. The
  transport → bridge chain that can now feed a real `tool_result` is wired as of #229; the no-op
  behavior itself is unchanged.
  - No corresponding test currently is left uncovered — both the orphan and duplicate cases are
    unit-tested with `toBe` reference assertions (`timelineBridge.test.ts`, #229, driving a real store
    end to end).
- **`seq` is not consulted.** It's carried on `assistantDelta` for wire fidelity and a possible
  future monotonicity guard, but the reducer trusts arrival order — no reordering has been
  observed from the ordered Noise/WS transport.
- **Single active conversation.** `conversation_id` is dropped from `ThreadEvent`, mirroring
  `sessionStore`'s single-conversation assumption (ADR 0004). [#199](../codebase/199.md) already
  drops it at the `DaemonEvent` construction step (`daemonConnection.ts`), one layer below this
  module — #202's bridge inherits an event that has no `conversation_id` to further scope.
- **No stable per-item `id`.** `turnId` alone isn't unique (a tool call can split one turn into
  two `assistantText` items) — [#203](../codebase/203.md) resolved the React-key question at
  render time by keying on array index instead: the list is append-only with tail-mutation and never
  reorders or inserts mid-list (`appendDelta` grows the tail in place, every other arm appends a new
  tail, `fillResult` replaces a `toolCall` at its own index), so index identity is stable per logical
  item without needing a dedicated `id` field on `ThreadItem`.
- **`stalled` is onset-only with no daemon "cleared" signal** ([#317](../codebase/317.md)) — the daemon
  sends a one-shot `stall` frame and never repeats it or clears it, so the reducer derives the clear
  entirely client-side on the next turn-activity arm. A stall with no following activity stays shown
  indefinitely; this is by design, mirroring mobile's ADR-025 Phase 2 self-clear contract.
- **`apiRetry` clears only on its own explicit falling edge — turn activity never clears it**
  ([#493](../codebase/493.md)), the deliberate inverse of `stalled`. The daemon's `api_retry` frame
  re-fires the rising edge as the attempt count climbs with no wire-side dedup (a repeated identical
  frame is a same-reference no-op, never a re-render), and `current: 0, total: 0` is a legitimate
  "retrying, count unknown" state — a **present** `ApiRetryStatus` with both fields zero, not `null`.
  The falling edge discards any counter it carries; the state's `| null` shape makes that true by
  construction rather than a convention to maintain.
- **`compacting` clears only on its own explicit falling edge — turn activity never clears it**
  ([#496](../codebase/496.md)), `apiRetry`'s clearing inversion again. Unlike `apiRetry`, the wire
  carries no progress data at all — banner-only, no counter, no percentage — so the state is a plain
  `boolean` rather than a `| null` record; there is nothing for a falling edge to discard.
- **`reset` had no dispatch site as of [#528](../codebase/528.md); [#530](../codebase/530.md) shipped
  the first, [#531](../codebase/531.md) the second, [#652](../codebase/652.md) the third.** A
  conversation switch clears the timeline via `activateConversation`, gated on the active conversation's
  id actually changing — a re-open of the already-active conversation clears nothing, since the timeline
  has no history backfill and a redundant reset would destroy rows that never come back. A pairing ending
  (unpair — pair-another-server stopped clearing anything at
  [#1141](https://github.com/pyrycode/pyrycode-desktop/issues/1141)) clears it via
  `clearPairingScopedState`, unconditionally — there the pairing itself is over, so no id gate applies. The open discussion being deleted clears it via
  `exitActiveConversation`, gated on the id like #530's — a `conversationDeleted` naming any other
  conversation clears nothing.
- **A retry or compaction genuinely still live across a reconnect shows no banner until the daemon's
  next edge** ([#538](../codebase/538.md)), an accepted residual, not a bug to engineer around. The
  daemon's connect-time re-assertion set is the outstanding modal (#877) and the queued backlog (#878)
  only — never `api_retry`/`compacting`/`turn_state` — so `reconnected`'s clear has nothing to
  re-populate from. A briefly-missing banner (until the next rising edge, or for a compaction possibly
  only the closing falling edge, landing as a no-op) trades against a permanently-stuck one, which is
  the worse failure this arm exists to fix.
- **A late `sessionTransition`/timeline delta for the previous conversation is not suppressed by
  [#530](../codebase/530.md)'s clear.** `ThreadEvent` carries no `conversation_id` (single-active model,
  ADR 0004), so if the previous conversation is still streaming when the switch happens, its in-flight
  deltas keep landing in the timeline the user now reads as the new conversation — the clear empties the
  *accumulated* rows at the moment of the switch, it cannot stop an ongoing stream from the conversation
  just left. Named as an open PO follow-up by the architect's security review on #530 (same root cause
  and remedy as the equivalent gap on [`sessionIdStore`](session-id-store.md#edge-cases-and-limitations)),
  not yet its own ticket. Unaffected by [#531](../codebase/531.md)'s pairing-ended clear: unpair tears
  the transport down before any late delta could arrive, and the pair-another path's exposure window is
  a microtask gap the daemon connection replaces almost immediately — see #531's spec § Open questions.
- **Strangler Fig, cut over in [#179](../codebase/179.md).** `sessionStore`, `messageViewModel.ts`,
  and the coarse `message`/`message_chunk` path were completely untouched by this module through
  #199–#230. #179 retired the coarse render path (`MessageThread` unmounted, kept as dead-but-tested
  residue) and made this module's store the conversation's single thread surface — `sessionStore`
  itself (and its `messages` slice) is untouched code-wise but its render consumer is gone.
- **`createdAt` is `undefined` on any `assistantText`/`userText` item whose producer was given no
  clock** ([#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013)) — this is a legal item, not
  a defect: every one of the 135 pre-existing fixture sites across 17 test files produces exactly this,
  since none injects a clock, and [#1014](https://github.com/pyrycode/pyrycode-desktop/issues/1014) draws
  it as the meta row's empty slot. Test presence with `=== undefined`, never `'createdAt' in item` — the
  reducer assigns the field unconditionally on every arm that carries it, so the key is always present;
  only its value distinguishes a stamped item from an unstamped one. No seam this field crosses
  (`translateTimelineEvent`, `subscribeTimeline`, `ComposerSendDeps.now`) defaults to `Date.now` — a
  defaulting seam would silently stamp events built by a spec that injects no clock, and those are exactly
  the fixtures `toEqual` asserts hold no defined `createdAt`.
- **The two production wirings of the clock (`useTimelineBridge`'s `Date.now` argument,
  `ConversationScreen.tsx`'s `now: Date.now` deps field) are not compile-enforced** — both parameters are
  optional, which is what keeps every pre-#1013 call site compiling unedited, but it also means a
  forgotten wiring at either site is silent rather than a type error. Each has its own regression spec
  pinning the wiring instead (`timelineBridge.test.ts` for the assistant side, `composerSend.test.ts` for
  the echo). If a wiring is ever found missing in practice, that observed failure — not the theoretical
  gap — is what would justify a compile-time guard.
- **`attachments` only ever describes files this window's own operator attached**
  ([#1039](https://github.com/pyrycode/pyrycode-desktop/issues/1039)) — a file the *assistant* produced
  reaches the window as nothing at all (`MessagePayload` has no attachment field and there is no list
  verb), so an inbound direction is unbuildable until a `pyrycode/pyrycode` wire change exists. Recorded
  verbatim, with no non-emptiness guard: an empty `filename` is representable and unreachable (`basename`
  answers `''` only for a path the read guard already refuses), so no guard for it is added where nothing
  in this module draws it — that obligation, like the layout bound for a long name, passed through to
  #815, which took it on: an unbounded name wraps rather than truncates, bounded only by the operator's
  own filesystem's 255-byte path-component cap. #868 still owes it for the image case. `SendMessagePayload`
  gains no matching field in this slice, so the association is local to this client's timeline only and is
  not sent to the daemon with the message.

- **A `dropUserText` removal is not the `userText` arm's inverse, and must not be read as one**
  ([#1213](https://github.com/pyrycode/pyrycode-desktop/issues/1213)). `userText` opens
  `localSendPending`'s local window on the grounds that the arm firing and the composer accepting a
  submit are the same fact; the tempting symmetry — a removal closes what an append opened — is wrong,
  because the window belongs to whatever message is currently pending, not to the one just dropped.
  `dropUserText` carries `localSendPending` through unchanged, same as every other chrome scalar, and
  leaves the daemon's next `turn_state` to close it. **Only `items` changes on this arm** — the sole
  removal arm in the reducer; every other arm appends or coalesces.
- **A drop issued by another paired client is out of scope, by construction rather than by a guard.**
  `queue_state` fans out to every interactive connection, so this window can observe an item leave the
  backlog because a *different* client dropped it — but this window's timeline holds no `userText` echo
  for a message it never sent, so `removeUserEcho` simply finds nothing to remove. There is no local
  concept of "another device's drop" to build a heuristic for; pyrycode#2092's own doc criterion states
  the daemon-side half of the same rule ("an item whose `message_id` matches no local echo renders as a
  plain queued row and is never dropped").
- **An echo with no `messageId` can never be removed by a drop** — the shape a future history-backfill
  producer would take, on the same "absent correlates with nothing" rule the field's own paragraph
  states above (§ Types). Nothing in this module manufactures a fallback key for it.

## Related

- [Thread timeline — history](thread-timeline-history.md) — the ticket-by-ticket build-out of every arm,
  scalar and field, split out from this page on 2026-09-04.
- [#1039](https://github.com/pyrycode/pyrycode-desktop/issues/1039) — added `attachments` to `userText`,
  covered in full above (§ Types, § Edge cases). Sole producer: [composer send](composer-send.md)'s
  `ComposerSendDeps.takeAttachments`, fed by [Composer attach § Pending
  attachments](composer-attach.md#pending-attachments-1039)'s `reducePendingAttachments`. Consumer:
  [Conversation shell — message bubble § The attachment file
  row](conversation-shell-message-bubble-attachments.md#the-attachment-file-row-815-816) (#815, shipped). #868 (the image
  thumbnail, and #869's open-in-viewer click) has since shipped too.
- [#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013) — added `createdAt` to
  `assistantText`/`userText`, covered in full above (§ Types, § Configuration and usage). Producers:
  [conversation timeline store](conversation-timeline-store.md)'s `translateTimelineEvent`/
  `subscribeTimeline` (assistant side) and [composer send](composer-send.md)'s `ComposerSendDeps.now`
  (user side). [#1014](https://github.com/pyrycode/pyrycode-desktop/issues/1014) — shipped; the sibling
  slice that renders the stamp into [#969](../codebase/969.md)'s empty meta-row time slot. [Conversation
  shell — message bubble § The meta row](conversation-shell-message-bubble.md#the-meta-row) has the
  formatter and render-slot design.
- [#286 codebase notes](../codebase/286.md) — added the fifth `ThreadItem` kind, `sessionBoundary`,
  and its `TimelineRow` render row + pure long-form relative-time view-model.
- [ADR 0008 — Conversation-timeline model](../decisions/0008-thread-timeline-model.md) — full
  rationale, every reducer arm's normative contract, and the Strangler-Fig coexistence decision.
- [#121 codebase notes](../codebase/121.md) — implementation summary and the `as`-cast rework.
- [Session store](session-store.md) — the `MessagePayload[]` store this coexists with and the
  `reduceSession`/`appendUnique` template this module's shape mirrors.
- [Daemon-event bridge (renderer)](daemon-event-bridge.md) — the `DaemonEvent → SessionAction`
  translator #202's `wire → ThreadEvent` bridge is modeled on.
- [Conversation timeline store](conversation-timeline-store.md) — the store + bridge #202 built over
  this module.
- [Conversation timeline holder](conversation-timeline-holder.md) — a second, per-conversation-keyed
  store (#755) that imports `TimelineState`/`ThreadEvent`/`reduceTimeline` from this module unchanged,
  reusing the reducer rather than writing a second one.
- [#199 codebase notes](../codebase/199.md) — the transport slice: wire types, decode, and the
  `assistantDelta`/`turnEnd` `DaemonEvent` arms this module's `ThreadEvent` union targets.
- [#202 codebase notes](../codebase/202.md) — the store + bridge slice built on this module.
- [#203 codebase notes](../codebase/203.md) — the render slice; resolved the React-key question (array
  index) and derived the streaming cursor structurally from the reducer's append-only/tail-mutation
  invariant.
- [#214 codebase notes](../codebase/214.md) — the `turn_state` transport slice: wire types, decode
  (closed-enum idiom), and the `turnState` `DaemonEvent`/`ThreadEvent` arms; gave `selectPhase` its
  first real source.
- [#217 codebase notes](../codebase/217.md) — the `tool_use` transport slice: wire types, decode
  (required-string presence, no enum), and the `toolUse` `DaemonEvent`/`ThreadEvent` arms; gave
  `reduceTimeline`'s `toolUse` arm its first real feed, appending a `toolCall` item onto `selectItems`.
- [#229 codebase notes](../codebase/229.md) — the `tool_result` transport slice, the vertical's last
  transport slice: wire types, decode (four required strings + one `requireBoolean`), and the
  `toolResult` `DaemonEvent`/`ThreadEvent` arms; gave `reduceTimeline`'s pre-existing `fillResult`
  correlation its first real feed, resolving a `toolCall`'s `result` in place on `selectItems`.
- [#230 codebase notes](../codebase/230.md) — extends #218's pending `toolCall` chip to resolve in
  place from `item.result`, and introduces desktop's first error-family design token, `--color-error`.
- [#696 codebase notes](../codebase/696.md) — extracts the `toolCall` arm into an exported `ToolRow`
  and reverses #230's decision not to surface `result.resultSummary`, drawing it in a bounded body
  behind a still-unwired `expanded` flag.
- [#245 codebase notes](../codebase/245.md) — added the fourth `ThreadItem` kind, `userText`, dormant
  with a placeholder render arm.
- [#179 codebase notes](../codebase/179.md) — the vertical's final piece: flips `interactive`, wires
  `userText`'s producer and real render row, and retires the coarse `MessageThread` in the same commit.
- [#315 codebase notes](../codebase/315.md) — the transport slice: decodes `stall` into the (at ship
  time) nullary `stallDetected` `DaemonEvent`, shipped dormant.
- [#732 codebase notes](../codebase/732.md) — widened `stallDetected` with `conversationId`; the id
  stops at the timeline bridge, so `ThreadEvent.stallDetected` above is unaffected.
- [#317 codebase notes](../codebase/317.md) — the render slice: the `stalled` scalar, the
  `stallDetected` arm, and `StallIndicator` (retired, folded into `ThinkingIndicator` by #967 — see
  [Conversation shell § Thinking / working indicator § Retired by
  #967](conversation-shell-turn-status.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967)).
- [#492 codebase notes](../codebase/492.md) — the transport slice: decodes `api_retry` into the
  non-nullary `apiRetry` `DaemonEvent` (`active`/`current`/`total`), shipped dormant.
- [#493 codebase notes](../codebase/493.md) — the render slice: the `apiRetry` scalar, the `apiRetry`
  arm (clearing semantics inverted from `stalled`), `ApiRetryIndicator`, and the `shouldShowThinking`
  supersede predicate (`ApiRetryIndicator` retired, folded into `ThinkingIndicator` by #967 — see
  [Conversation shell § Thinking / working indicator § Retired by
  #967](conversation-shell-turn-status.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967)).
- [#495 codebase notes](../codebase/495.md) — the transport slice: decodes `compacting` into the
  non-nullary `compacting` `DaemonEvent` (`active`), shipped dormant.
- [#496 codebase notes](../codebase/496.md) — the render slice: the `compacting` scalar, the
  `compacting` arm (`apiRetry`'s clearing inversion, minus the counter), `CompactingIndicator`, and the
  second `shouldShowThinking` clause (`CompactingIndicator` retired, folded into `ThinkingIndicator` by
  #967 — see [Conversation shell § Thinking / working indicator § Retired by
  #967](conversation-shell-turn-status.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967)).
- [#528 codebase notes](../codebase/528.md) — the nullary `reset` arm, ported from [`sessionStore`'s
  `reset` (#166)](../codebase/166.md); capability-only, no dispatch site until #530/#531.
- [#530 codebase notes](../codebase/530.md) — `reset`'s first production dispatch site: a conversation
  switch, via [`activateConversation`](paired-shell-routing.md#the-pure-view--container-pairedshelltsx).
- [#531 codebase notes](../codebase/531.md) — `reset`'s second production dispatch site: a pairing
  ending, unconditional, via
  [`clearPairingScopedState`](paired-shell-routing.md#the-pure-view--container-pairedshelltsx).
- [#642 codebase notes](../codebase/642.md) — the transport slice: decodes `tool_use.input` into the
  optional `DaemonEvent.toolUse.input` field, shipped dormant.
- [#643 codebase notes](../codebase/643.md) — widens the `toolUse`/`toolCall` pair with `input`, carried
  unchanged and by reference through the bridge and the reducer; ships dormant.
- [#773 codebase notes](../codebase/773.md) — widens the `toolResult`/`ToolResult` pair with
  `resultDetail`, wire through item in one ticket rather than #642/#643's split; ships dormant.
- [#538 codebase notes](../codebase/538.md) — the nullary `reconnected` arm: `timelineBridge.ts` maps
  the `connected` daemon edge onto it, clearing `phase`/`stalled`/`apiRetry`/`compacting` while
  preserving `items` by reference — the Mode B reconnect reconcile [`modalStore` #415](../codebase/415.md)
  and `queueStore` #197 already got.
- [Paired shell](paired-shell.md) — the container `activateConversation` lives beside, and the nav sites
  that now dispatch `reset` on an actual conversation switch.
- [Inbound message decode](inbound-message-decode.md) / [Daemon-event channel](daemon-event-channel.md)
  — the boundary and channel #199 extended to produce those two arms.
- [ADR 0004 — Renderer session store](../decisions/0004-renderer-session-store-reducer-wire-types.md)
  — the pure-reducer / sealed-union / wire-types-are-a-bridge-concern discipline this ADR extends.
- [#1213](https://github.com/pyrycode/pyrycode-desktop/issues/1213) (PR
  [#1215](https://github.com/pyrycode/pyrycode-desktop/pull/1215)) — added `messageId` to `userText` and
  the `dropUserText` removal arm + `removeUserEcho`, covered in full above (§ Types, § The reducer, §
  Internal helpers, § Edge cases). Producer: [composer send](composer-send.md)'s `submitMessage`, which
  mints the id once for the wire frame and retains it on the echo. Consumer:
  [dequeue message envelope § Configuration and usage](dequeue-message-envelope.md#configuration-and-usage)'s
  `dropQueuedMessage`, which dispatches the removal to both this module's two host stores
  ([timeline store](conversation-timeline-store.md), [conversation timeline
  holder](conversation-timeline-holder.md)) on the same `message_id` the [queue
  store](queue-store.md)'s `QueuedItem` now carries (pyrycode#2092). Full design, including why the
  removal fires at the click rather than on a confirming snapshot: `docs/specs/architecture/1213-drop-queued-message-removes-echo.md`.
