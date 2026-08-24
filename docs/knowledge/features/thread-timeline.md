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
interface ToolResult { isError: boolean; resultSummary: string }

type ThreadItem =
  | { kind: 'assistantText'; turnId: string; text: string }
  | { kind: 'toolCall'; turnId: string; toolUseId: string; name: string; inputSummary: string; input?: Readonly<Record<string, string>>; result: ToolResult | null }
  | { kind: 'turnBoundary'; turnId: string; stopReason: string }
  | { kind: 'userText'; text: string }
  | { kind: 'sessionBoundary'; reason: SessionBoundaryReason; workspaceCwd: string | null; occurredAt: string }

type ThreadEvent =
  | { type: 'assistantDelta'; turnId: string; seq: number; text: string }
  | { type: 'toolUse'; turnId: string; toolUseId: string; name: string; inputSummary: string; input?: Readonly<Record<string, string>> }
  | { type: 'toolResult'; turnId: string; toolUseId: string; isError: boolean; resultSummary: string }
  | { type: 'turnState'; state: TurnPhase }
  | { type: 'turnEnd'; turnId: string; stopReason: string }
  | { type: 'userText'; text: string }
  | { type: 'sessionBoundary'; reason: SessionBoundaryReason; workspaceCwd: string | null; occurredAt: string }
  | { type: 'stallDetected' }
  | { type: 'apiRetry'; active: boolean; current: number; total: number }
  | { type: 'compacting'; active: boolean }
  | { type: 'reset' }
  | { type: 'reconnected' }

interface TimelineState { items: readonly ThreadItem[]; phase: TurnPhase; stalled: boolean; apiRetry: ApiRetryStatus | null; compacting: boolean }
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
to make "true by construction."

**`toolCall.input` / `toolUse.input` ([#643](../codebase/643.md)) is not a sixth scalar** — it's an
optional field on an existing arm/item pair, the tool's own input fields as name → value
(pyrycode#1678, decoded at the transport by [#642](../codebase/642.md)). Absent means the wire omitted
it (a pre-#1678 daemon); an empty map is the distinct fact "this daemon sent no fields for this call."
Both the bridge and the reducer carry it unchanged and by reference — no store-level interpretation,
no key singled out, no value shortened. Ships dormant: `reduceTimeline`'s `toolUse` arm appends it
onto the `toolCall` item, but no render reads it yet — that's
[#645](https://github.com/pyrycode/pyrycode-desktop/issues/645).

### The reducer

`reduceTimeline(state, event): TimelineState` is pure and exported — no mutation, fresh state,
`switch` on `event.type` with an `assertNever` default — the same discipline as `sessionStore`'s
`reduceSession`:

| event | effect |
|---|---|
| `assistantDelta` | tail-check coalesce: same-`turnId` tail `assistantText` → replace with concatenated text; otherwise append fresh. `seq` carried, not consulted — arrival order is authoritative. |
| `toolUse` | append a fresh `toolCall` with `result: null` |
| `toolResult` | find the `toolCall` with matching `toolUseId` **and** `result === null`, fill it in place. No match (orphan or already-resolved duplicate) → **same `state` reference**, a deterministic non-throwing no-op. |
| `turnState` | set `phase`; same reference if unchanged (no-churn) |
| `turnEnd` | append a `turnBoundary`; does **not** touch `phase` |
| `userText` | append a fresh `userText` item (never coalesced); does **not** touch `phase` — the user's own message, sourced from the composer echo since [#179](../codebase/179.md) |
| `sessionBoundary` | append a fresh `sessionBoundary` item (never coalesced); does **not** touch `phase` — the `/clear`/idle-eviction/workspace-change marker, sourced from the daemon's `sessionTransition` event via the bridge since [#286](../codebase/286.md) |
| `stallDetected` | set `stalled: true`; `items`/`phase` untouched. Same reference if `stalled` is already `true` (no-churn) — [#317](../codebase/317.md) |
| `apiRetry` | `active: true` → hold `{ current, total }` (same reference if unchanged, no-churn); `active: false` → `null`, discarding the event's counter unconditionally. `items`/`phase`/`stalled` untouched — [#493](../codebase/493.md) |
| `compacting` | `state.compacting === event.active` → same reference (no-churn on a verbatim repeat of either edge); otherwise fresh state with `compacting: event.active`. `items`/`phase`/`stalled`/`apiRetry` untouched — [#496](../codebase/496.md) |
| `reset` | returns `initialTimelineState` — all five fields at once, by returning the shared constant rather than a fresh literal. Idempotent by reference (a second reset is a no-op); `items` stays the same reference post-reset, so no `selectItems` subscriber churns — [#528](../codebase/528.md) |
| `reconnected` | clears `phase`→`idle`, `stalled`→`false`, `apiRetry`→`null`, `compacting`→`false` via a hand-written five-field literal (not a spread of `initialTimelineState`); `items` preserved **by reference**. Same reference if all four are already clean (no-churn on a first connect, or a reconnect with nothing live) — [#538](../codebase/538.md) |

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

- `appendDelta(items, turnId, text)` — the tail-check coalesce for `assistantDelta`; always
  returns a new array (a delta is always a change).
- `fillResult(items, toolUseId, result)` — the `toolResult` correlate-and-fill. Narrows via a
  `.map` callback whose `item.kind === 'toolCall'` guard narrows `item` so the spread
  (`{ ...item, result }`) type-checks with **no cast** — the codebase bans unchecked `as` in
  production even when a cast would be provably safe (code review caught an index-cast version of
  this in the first submission; see [#121 codebase notes](../codebase/121.md) § Patterns
  established). Returns the same array reference on no match, so the reducer can return the same
  `state`.

## Configuration and usage

Nothing imports this module yet.

- **[#199](../codebase/199.md) (shipped)** added the structured wire types
  (`AssistantDeltaPayload`/`TurnEndPayload`, `assistant_delta`/`turn_end` on `EnvelopeType`), the
  transport decode (`inboundMessage.ts`), and the `assistantDelta`/`turnEnd` `DaemonEvent` arms
  (`src/shared/ipc/events.ts`) — see [inbound message decode](inbound-message-decode.md) and
  [daemon-event channel](daemon-event-channel.md). At the time, `turn_state`/`tool_use`/`tool_result`
  were not yet decoded (still fell to `inbound-unmodeled → null`).
- **[#202](../codebase/202.md) (shipped)** added the `daemonEventBridge`-shaped translator mapping
  `DaemonEvent`'s wire-derived snake→camel fields onto this module's `ThreadEvent` — a filter, not a
  reshape, since the two owned arms are field-for-field identical (`turnId`/`seq`/`text`,
  `turnId`/`stopReason`) — plus the Zustand store, singleton, and React hook, the same factory
  pattern `sessionStore` uses (ADR 0004), applied to `TimelineState`/`reduceTimeline`. See
  [conversation timeline store](conversation-timeline-store.md).
- **[#203](../codebase/203.md) (shipped)** added the first render slice: the streamed assistant text
  + a streaming cursor on the timeline (`Timeline`, in `ConversationScreen.tsx`) — the
  blank-thread-critical render that gates #179. Resolved the React-key question below as array index.
- **[#214](../codebase/214.md) (shipped)** added the `turn_state` wire type, transport decode, and the
  `turnState` `DaemonEvent`/`ThreadEvent` arms — the fail-closed decode uses the `role`-style
  closed-enum idiom instead of `requireString`. `reduceTimeline`'s pre-existing `turnState` arm and
  `selectPhase` are unmodified by this ticket; it only wires up a real feed. No render — the thinking
  indicator is a still-open sibling slice.
- **[#217](../codebase/217.md) (shipped)** added the `tool_use` wire type, transport decode, and the
  `toolUse` `DaemonEvent`/`ThreadEvent` arms — five required-string fields, no enum (unlike
  `turn_state`). `reduceTimeline`'s pre-existing `toolUse` arm (append a `toolCall`, `result: null`,
  splitting a turn's text) and `selectItems` are unmodified by this ticket; it only wires up a real
  feed. No render — the tool row is a still-open sibling slice (#218), and correlating a later
  `tool_result` into `result` is a separate still-open ticket (#206, later split into transport #229 +
  render #230).
- **[#229](../codebase/229.md) (shipped)** added the `tool_result` wire type, transport decode, and the
  `toolResult` `DaemonEvent`/`ThreadEvent` arms — four required-string fields plus one required boolean
  (`is_error`, via `requireBoolean` — the `yolo` #180 idiom, `false` is a value, not an absence).
  `reduceTimeline`'s pre-existing `toolResult` arm and `fillResult` (below) are unmodified by this
  ticket; it only wires up a real feed, **resolving** the correlated `toolCall`'s `result` in place
  rather than appending a new item — the last transport slice of the vertical. No render — the
  success/error visual is the still-open sibling slice (#230). Also the ticket that surfaced a cost:
  by the time it shipped, [#223](../codebase/223.md) had added a **third** independent exhaustive
  `DaemonEvent` switch (`modalBridge.ts`), so a new arm now forces a case in three renderer bridges, not
  two — see [#229 codebase notes](../codebase/229.md) § Lessons learned.
- **[#230](../codebase/230.md) (shipped)** rendered the `toolResult`-filled `result` — `TimelineRow`'s
  `case 'toolCall'` now derives the wrapper `className` from `item.result` (`tool-row--resolved` iff
  filled, `tool-row--error` on top iff `isError`), lifting the pending 50% dimming and tinting the
  chip border with a newly-introduced `--color-error` token (M3 default dark error role, tone 80 —
  desktop's first error-family token). `reduceTimeline`'s `fillResult`/`ToolResult` shape is
  unmodified; `result.resultSummary` is deliberately not surfaced (no result-text slot in the Figma
  mock).
- **[#245](../codebase/245.md) (shipped)** added the fourth `ThreadItem` kind, `userText` — a plain
  fresh-tail-append (the `toolUse`/`turnEnd` discipline, not `assistantDelta`'s coalescing), no
  `turnId`/`seq` (a renderer-sourced echo has neither). Shipped **dormant**: no producer dispatched a
  `userText` event yet, and `TimelineRow`'s `case 'userText'` was a placeholder `return null`.
- **[#179](../codebase/179.md) (shipped)** wired `userText`'s producer — the composer's optimistic
  echo, retargeted from a `messageSent` `SessionAction` into `timelineStore.dispatch` — and the real
  render row (the right-aligned user bubble, replacing #245's placeholder). Flipped the `interactive`
  capability the whole vertical had been gated on, and retired the coarse `MessageThread` mount in the
  same commit. `reduceTimeline`'s `userText` arm is unmodified by this ticket. The vertical is
  complete.
- **[#286](../codebase/286.md) (shipped)** added a fifth `ThreadItem`/`ThreadEvent` kind,
  `sessionBoundary` — the `/clear`/idle-eviction/workspace-change marker #285 widened the
  `sessionTransition` `DaemonEvent` arm to carry. `timelineBridge.ts` moved that arm out of its no-op
  fall-through into a translating case (dropping `newSessionId`, which the sibling #259 session-id
  holder still owns unaffected); `reduceTimeline` fresh-tail-appends the item (the `userText`/`turnEnd`
  discipline, never coalesced); `TimelineRow` draws it as a titled horizontal rule via a new pure
  `sessionBoundaryViewModel.ts` (a long-form-relative-time sibling of `channelListViewModel.ts`'s
  `formatLastActivity`). The fifth application of the "new timeline-item kind → bridge arm → render
  row" pattern (#218/#230/#245).
- **[#317](../codebase/317.md) (shipped)** added the `stalled` scalar and the `stallDetected` arm —
  the render consumer of [#315](../codebase/315.md)'s dormant nullary `DaemonEvent`. `timelineBridge.ts`
  moved `stallDetected` from its inverse-filter `null` group to an owned arm (a fresh, field-identical
  literal, since both sides are nullary); `ConversationScreen.tsx` gained `StallIndicator`, `Timeline`/
  `ThinkingIndicator`'s twin. Unlike every prior extension, this one touches an **existing** scalar's
  clearing logic rather than only adding a new arm — see Edge cases below for the widened no-op guards.
- **[#493](../codebase/493.md) (shipped)** added the `apiRetry: ApiRetryStatus | null` scalar and the
  `apiRetry` arm — the render consumer of [#492](../codebase/492.md)'s dormant, non-nullary
  `DaemonEvent`. `timelineBridge.ts` moved `apiRetry` from its inverse-filter `null` group to an owned
  arm (a field-for-field literal, since this event carries data unlike `stallDetected`);
  `ConversationScreen.tsx` gained `ApiRetryIndicator` (`StallIndicator`'s twin) and a named
  `shouldShowThinking(ThreadStatus)` predicate that narrows `ThinkingIndicator`'s gate whenever a retry
  is live — closing the mutual-exclusion question #317 deferred. Like #317, this touches every existing
  arm's carry-through, but with the **clearing rule inverted** — see Edge cases below.
- **[#496](../codebase/496.md) (shipped)** added the `compacting: boolean` scalar and the `compacting`
  arm — the render consumer of [#495](../codebase/495.md)'s dormant, non-nullary `DaemonEvent`.
  `timelineBridge.ts` moved `compacting` from its inverse-filter `null` group to a ninth owned arm
  (field-for-field, like `apiRetry`); `ConversationScreen.tsx` gained `CompactingIndicator` (also
  `StallIndicator`'s twin) and a second `shouldShowThinking` clause, extending the seam #493 built by
  name for this ticket — one field, one clause, no new gate. `apiRetry`'s clearing-rule inversion, minus
  the counter — see Edge cases below.
- **[#528](../codebase/528.md) (shipped)** added the nullary `reset` arm — the first `ThreadEvent`
  that is neither daemon- nor user-content-derived, a renderer-lifecycle control event ported
  verbatim from [`sessionStore`'s `reset` (#166)](../codebase/166.md). `reduceTimeline`'s new arm
  returns `initialTimelineState` directly, clearing all five fields (`items`, `phase`, `stalled`,
  `apiRetry`, `compacting`) in one step. Shipped **capability-only**: no dispatch site landed in this
  ticket, and `timelineStore.ts`/`timelineBridge.ts` needed no edit — `dispatch` already accepted any
  `ThreadEvent`, and `timelineBridge.ts` never produces a `reset` since no wire frame maps to it.
  [#530](../codebase/530.md) (conversation switch, shipped) added the first dispatch site, via
  [`activateConversation`](paired-shell.md#the-pure-view--container-pairedshelltsx), gated on the active
  conversation's id actually changing. [#531](../codebase/531.md) (unpair / pair-another-server, shipped)
  added the second, unconditional site, via
  [`clearPairingScopedState`](paired-shell.md#the-pure-view--container-pairedshelltsx).
  [#652](../codebase/652.md) (the deleted-open-discussion exit, shipped) added the third, via
  [`exitActiveConversation`](paired-shell.md#the-delete-exit-exitactiveconversationts-conversationdeletedbridgets-652) —
  gated on the id like #530's, but comparing against the just-deleted conversation's id rather than a
  newly-opened one's.
- **[#538](../codebase/538.md) (shipped)** added a twelfth arm, the nullary `reconnected` — the second
  arm that is neither daemon- nor user-content-derived, but unlike `reset` it **is** bridge-produced:
  `timelineBridge.ts` maps the `connected` daemon edge onto it (moved out of the null fall-through
  cluster into an owned case), implementing `docs/protocol-mobile.md`'s Mode B reset-on-reconnect
  contract for the two two-edged chrome scalars (`apiRetry`, `compacting`) that were otherwise stuck
  forever once their falling edge was lost to a disconnect. Clears `phase`/`stalled`/`apiRetry`/
  `compacting` in one step while preserving `items` **by reference** — the Mode A/Mode B split held on
  the same connect. The [`modalStore` #415](../codebase/415.md) / `queueStore` #197 reconcile shape,
  applied a third time.
- **[#531](../codebase/531.md) (shipped)** added `reset`'s second production dispatch site — unpair and
  pair-another-server, the two paths that end a pairing rather than merely switch conversations, both
  routed through the new `clearPairingScopedState` helper alongside three sibling clears
  (`activeConversationStore`, `sessionIdStore`, `sessionStore`). Unlike `reconnected` above and unlike
  [#530](../codebase/530.md)'s conversation-switch dispatch, this one is unconditional — no id gate, no
  `connected`-edge trigger — because the pairing itself is ending and no state in which `items`
  legitimately survives. `reduceTimeline`'s `reset` arm is unmodified; this ticket only wires a second
  call site.
- **[#643](../codebase/643.md) (shipped)** widened the `toolUse` arm/`toolCall` item pair with one
  optional field, `input` — no new arm, no new item kind. `reduceTimeline`'s pre-existing `toolUse`
  arm and `fillResult` are otherwise unmodified; the reducer's appended literal gained one line
  carrying the map by reference. No render — [#645](https://github.com/pyrycode/pyrycode-desktop/issues/645)
  is the still-open sibling slice.

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
  (unpair / pair-another-server) clears it via `clearPairingScopedState`, unconditionally — there the
  pairing itself is over, so no id gate applies. The open discussion being deleted clears it via
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

## Related

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
- [#245 codebase notes](../codebase/245.md) — added the fourth `ThreadItem` kind, `userText`, dormant
  with a placeholder render arm.
- [#179 codebase notes](../codebase/179.md) — the vertical's final piece: flips `interactive`, wires
  `userText`'s producer and real render row, and retires the coarse `MessageThread` in the same commit.
- [#315 codebase notes](../codebase/315.md) — the transport slice: decodes `stall` into the nullary
  `stallDetected` `DaemonEvent`, shipped dormant.
- [#317 codebase notes](../codebase/317.md) — the render slice: the `stalled` scalar, the
  `stallDetected` arm, and `StallIndicator` (see [Conversation shell § Stall
  indicator](conversation-shell.md#stall-indicator-317)).
- [#492 codebase notes](../codebase/492.md) — the transport slice: decodes `api_retry` into the
  non-nullary `apiRetry` `DaemonEvent` (`active`/`current`/`total`), shipped dormant.
- [#493 codebase notes](../codebase/493.md) — the render slice: the `apiRetry` scalar, the `apiRetry`
  arm (clearing semantics inverted from `stalled`), `ApiRetryIndicator`, and the `shouldShowThinking`
  supersede predicate (see [Conversation shell § Api-retry
  indicator](conversation-shell.md#api-retry-indicator-493)).
- [#495 codebase notes](../codebase/495.md) — the transport slice: decodes `compacting` into the
  non-nullary `compacting` `DaemonEvent` (`active`), shipped dormant.
- [#496 codebase notes](../codebase/496.md) — the render slice: the `compacting` scalar, the
  `compacting` arm (`apiRetry`'s clearing inversion, minus the counter), `CompactingIndicator`, and the
  second `shouldShowThinking` clause (see [Conversation shell § Compacting
  indicator](conversation-shell.md#compacting-indicator-496)).
- [#528 codebase notes](../codebase/528.md) — the nullary `reset` arm, ported from [`sessionStore`'s
  `reset` (#166)](../codebase/166.md); capability-only, no dispatch site until #530/#531.
- [#530 codebase notes](../codebase/530.md) — `reset`'s first production dispatch site: a conversation
  switch, via [`activateConversation`](paired-shell.md#the-pure-view--container-pairedshelltsx).
- [#531 codebase notes](../codebase/531.md) — `reset`'s second production dispatch site: a pairing
  ending, unconditional, via
  [`clearPairingScopedState`](paired-shell.md#the-pure-view--container-pairedshelltsx).
- [#642 codebase notes](../codebase/642.md) — the transport slice: decodes `tool_use.input` into the
  optional `DaemonEvent.toolUse.input` field, shipped dormant.
- [#643 codebase notes](../codebase/643.md) — widens the `toolUse`/`toolCall` pair with `input`, carried
  unchanged and by reference through the bridge and the reducer; ships dormant.
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
