# Conversation shell — turn status surfaces

What the screen shows while a turn is running: the timeline render, the thinking indicator, the background-task panel, and the retry, compacting and stall indicators.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

## Background-task panel (#581, cap and cut display since #582, latest patch since #583)

An openable surface listing the tasks claude has running in the background for the open conversation
— the first reader of [`backgroundTaskRosterStore`](background-task-roster-store.md), shipped and
unread since #573. The store joins three daemon frames (roster, started, updated); this slice reads
only two of the held per-task fields, `description` and `taskType`. Split from #568 (whose panel work
was itself split three ways: #581 → #582 → #583). No Figma node exists for this surface — it is
desktop-only (pyrycode#1241) and the canonical mobile file has no counterpart; visual design is #580's,
so the chrome deliberately reuses the shared `.status-sheet__*` overlay vocabulary as an interim
placeholder rather than anything #580 would have to unwind.

```
.conversation
├── BackgroundTaskTrigger              .background-task-trigger (StatusRow sibling, always rendered)
└── BackgroundTaskPanel (if panelOpen)
    └── BackgroundTaskPanelView
        ├── .status-sheet-overlay__scrim        (onClick → onClose)
        └── .status-sheet  role="dialog" aria-labelledby="background-task-panel-title"
            ├── .status-sheet__handle
            ├── .status-sheet__header             "Background tasks" + close
            └── .status-sheet__body
                ├── entry.droppedTasks > 0    → .background-task-panel__partial     "Partial list (N not shown)"
                │                                 (sibling of the branch below, not nested in any arm — #582)
                └── entry === null            → .background-task-panel__unobserved  "No background-task report yet"
                  · entry.tasks.size === 0    → .background-task-panel__empty       "No background tasks"
                  · otherwise                 → .background-task-panel__list > .background-task-panel__row × N
                                                  (description + taskType, roster order, each field followed
                                                  by .background-task-panel__cut-description / -cut-type
                                                  "Truncated by the daemon" when truncatedFields names it — #582;
                                                  then task.latestUpdate !== null            → one of:
                                                    patch === ''  → .background-task-panel__no-change  "No change reported"
                                                    patch !== ''  → .background-task-panel__patch       <patch text, escaped>
                                                  followed by .background-task-panel__cut-patch "Truncated by the daemon"
                                                  when update.truncatedFields (not task.truncatedFields) names "patch" — #583)
```

**No bridge mount.** Unlike `WorkspacePickerSheet` (which mounts `RecentWorkspacesData` inside itself),
`<BackgroundTaskRosterData />` is already the seventh headless leaf in `App.tsx` — this panel is a pure
reader, and mounting a second data path here would be a second, wrong write path.

**The three-way branch is the ticket's hardest AC**, and is deliberately written on two different
things in this order: `entry === null` (no background-task frame has ever arrived) before
`entry.tasks.size === 0` (observed — nothing alive), before the populated row list. Reaching for
`entry?.tasks` (via `.values()`, `.size ?? 0`, or `?? new Map()`) before branching collapses the first
two readings into one — compiles clean, breaks no other test — which is exactly the collapse
`selectRosterFor`'s `?? null` return refuses to make. Each reading is its **own element with its own
class and copy**, not a shared "empty" element and not `null`: unlike `WorkspacePickerSheetView`'s
not-loaded branch (which renders `null`, since that sheet has other content), this branch *is* the
whole panel body, so a `null` render would read as broken.

**The container** (`BackgroundTaskPanel`) clones `QueuedBacklogControl`'s conversation-id idiom:
`activeConversation?.id ?? null` derived inline at the `ConversationScreen` mount site (no second
subscription), a `useMemo`-stable `selectRosterFor(conversationId ?? '')` selector, and
`useBackgroundTaskRosterStore(selectRoster)`. The `''` sentinel matches no store key, so "no active
conversation" reads as `null` — the correct "never observed" reading — for free. An Escape `keydown`
effect closes the panel; open/closed state is a fourth screen-local `useState` boolean in
`ConversationScreen` (the `pickerOpen`/`channelInfoOpen`/`sheetOpen` twin, [ADR
0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md)).

**Trigger.** An icon-only `.background-task-trigger` button (`aria-label="Background tasks"`,
`aria-haspopup="dialog"`), mounted unconditionally as a `StatusRow` sibling — not gated on tasks
existing, since gating would make both non-populated readings unreachable through the UI. Chosen over
the overflow menu (hardcoded to one item; routing through it means generalising the menu) and
`WorkspaceChip`'s "Change" button (self-gates to `null` once the thread has a message — exactly when
background tasks exist). Carries no task-count badge; a badge would need its own roster subscription,
left to #580.

**SECURITY.** For `taskType: local_bash`, `description` is the literal shell command claude ran —
untrusted, model-influenced text the daemon bounds but does not sanitize. Rendered as auto-escaped
React children only: never `dangerouslySetInnerHTML`, never an attribute (not even `title=`), never a
key, never executed or re-shelled. Rows are deliberately non-interactive (no `<button>`, no `onClick`)
so there is no handler for a future "run this" affordance to grow from. The list itself is not treated
as a work list: `entry.tasks.values()` is spread once, inline, into `<li>` children — no join, no
clipboard, no export, no `data-*` attribute carrying a task field. Architect self-review PASS (security-
sensitive label); code review PASS with zero findings.

**Cap and cut display (#582).** Two independent bounds the daemon reports and now displays: a
**partial-list notice** (`.background-task-panel__partial`, `` `Partial list (${entry.droppedTasks} not
shown)` ``) whenever the entry reports a nonzero `droppedTasks`, and a **per-field cut marker**
(`.background-task-panel__cut-description` / `-cut-type`, both reading `Truncated by the daemon`)
immediately after any field a task's `truncatedFields` names. The notice is a sibling of the three-way
branch above, not nested in any of its arms, so it shows whichever branch the task list itself takes —
the placement is the acceptance criterion, since the count belongs to the entry, not to the list. The
marker match is the ticket's central trap: `truncatedFields`' contents cross IPC unconverted, so the
panel holds `task.taskType` but must match the wire string `task_type`, not the held name. Neither
reading is styled as an error — a bounded report is the daemon working as designed, reported honestly.
Architect self-review PASS (security-sensitive label); code review PASS with zero findings. See [#582
codebase notes](../codebase/582.md).

**Latest patch (#583).** The held `latestUpdate: HeldBackgroundTaskUpdate | null` pair — the last field
of `entry` the panel had left unread — now renders as the third element of each row, appended after the
description and task-type fields and their own markers. Three readings, each rendered distinctly:
`latestUpdate === null` (no update has ever matched this task) renders **no element at all**;
`latestUpdate.patch === ''` (claude reported no change — the field always arrives on the wire, so an
empty string is a value, not an absence) renders `.background-task-panel__no-change`, "No change
reported"; a non-empty patch renders `.background-task-panel__patch` holding the patch as **inert,
auto-escaped text** — never parsed, since the daemon truncates it at construction and its own golden
fixture is cut mid-token, so a truncated patch no longer parses. The branch is on `latestUpdate !== null`
then `patch === ''`, never on the patch's truthiness — `{latestUpdate?.patch && …}` would render a
recorded empty patch exactly as the never-updated reading, #582's `droppedTasks` truthiness trap one
field over, quieter still because an empty string leaves no visible trace.

The update's own cut marker (`.background-task-panel__cut-patch`, "Truncated by the daemon") is a
sibling of the two-arm ternary, gated on the same `latestUpdate !== null` guard, and reads **only**
`latestUpdate.truncatedFields` — a second list, over a different vocabulary (`task_id` / `patch`) from
the task's own `truncatedFields` (`task_id` / `task_type` / `description`), matched against a third
`CUT_FIELD_PATCH` constant. Reading the task's list for the patch marker, or the update's list for the
description/task-type markers, compiles and type-checks (both are `readonly string[] | null`) and never
matches — the crossover both directions guard against. Neither list ever reaches the markup; names are
matched, never displayed. No history: `latestUpdate` is latest-wins, one record per task — the panel
does not accumulate patches into a list, a ref, or component state. Nothing here is read as a terminal
signal: this frame family reports no finish event by design, so a task simply stops appearing in the
roster rather than being shown as done, and no copy or class in this slice names completion, failure, or
success. No prop, type, store, bridge or wire change; same `entry` prop #581 shipped. Architect
self-review PASS (security-sensitive label); code review PASS with two non-blocking SHOULD FIX
(both test-coverage gaps, not production defects — see [#583 codebase notes](../codebase/583.md)).

See [#581 codebase notes](../codebase/581.md) for the shell's full design, test posture, and
code-review record.

## Structured-stream timeline render (#203)

The render slice (L3) of the Phase-2 structured-streaming vertical (transport [#199](../codebase/199.md)
→ store [#202](../codebase/202.md) → render #203), mounted immediately after `<MessageThread/>`:

```
.conversation
├── MessageThread              messages={useSessionStore(selectMessages).map(toMessageViewModel)}
└── Timeline                   items={useTimelineStore(selectItems)}
```

`Timeline({ items }: { items: readonly ThreadItem[] })` is `MessageThread`'s twin — a pure, exported,
in-file component (props-in/markup-out, server-rendered in tests from an injected `ThreadItem[]`, no
store, no IPC). It reuses `MessageThread`'s scroll region class (`.conversation__thread`) and the
coarse path's daemon-bubble treatment (`.message-row--daemon` / `.bubble--daemon`) verbatim — no new
bubble styling. `ThreadItem` (from [thread-timeline](thread-timeline.md)) is already the render model
(camelCase, `conversation_id`-free, ADR 0008), so the container passes `selectItems`'s result straight
through — no adapter, unlike the coarse path's `toMessageViewModel`.

Per-item render, by `kind`, with **no `default`/`assertNever`** (an exhaustive switch that degrades an
unsourced-today kind to `null` rather than throwing — the render-path counterpart to the store
bridges' hard `assertNever`, see [#203 codebase notes § Patterns established](../codebase/203.md)):

- `assistantText` → one bubble, carrying `data-thread-role="assistant"` as the test hook
  (`MessageThread`'s `data-message-role` counterpart). Since [#609](../codebase/609.md), the bubble
  forks on the same `inProgress` prop the streaming cursor below reads — no new state:
  - **In progress** (the tail, still growing): unchanged from #199/#607 — text as React children
    (never `dangerouslySetInnerHTML`, so HTML inside a delta renders as visible characters), plus the
    dedicated `.bubble--assistant-text` modifier (`white-space: pre-wrap`) so a multi-paragraph reply
    keeps its blank lines and space runs instead of collapsing to one run-on line. Hung on its own
    class rather than `.bubble--daemon` so the four chrome affordances below
    (thinking/stall/api-retry/compacting) and the coarse path's `.bubble--user` stay structurally
    unreachable by the rule.
  - **Settled** (every other item, and the tail once its turn's `turn_end` arrives): renders through
    [`AssistantMarkdown`](assistant-markdown-renderer.md) (#608, wired in by #609) inside a
    `<div className="bubble__markdown">` — a flex column with `gap: var(--space-2)` for Figma `16:43`'s
    8px block rhythm, `margin-block: 0` on direct children (`index.css` resets only `body`, so UA block
    margins would otherwise stack on top of the flex gap), and `pre { white-space: pre-wrap }` so
    fenced code wraps within the bubble's measure instead of spilling out of it. `bubble--assistant-text`
    is **not** carried here — the settled branch never gets the class at all, making "markdown owns the
    whitespace" true by construction rather than by an override one level down. `React.memo` was
    considered and declined (unmeasured cost, no test tier in this repo can observe a skipped
    re-render); the seam is named in a code comment at the render site.

  The fork exists because the daemon emits one event per *complete* content block and the store
  coalesces a turn's deltas in place, so a settled item's text is always a whole document — a fenced
  block never arrives half-open — while the in-progress tail must never be shown half-parsed, which is
  why it stays plain text permanently rather than gaining markdown once "enough" of it has streamed in.
- `toolCall` → the tool-row chip ([#218](conversation-shell-tool-rows.md#pending-tool-call-row-218), below) — no longer a no-op as
  of that ticket; the resolved success/error treatment ([#230](conversation-shell-tool-rows.md#resolved-tool-call-row-230), below)
  lifted the pending dimming and added the error accent.
- `turnBoundary` → `null` (structural only; Figma has no per-turn divider).

**Streaming cursor** (Figma `16:56`, glyph `▎` U+258E): a trailing `<span class="bubble__cursor"
aria-hidden="true">` inside the in-progress bubble, rendered only on the tail item when
`item.kind === 'assistantText'` — derived from array position, never from `selectPhase` (which had no
source at the time; [#214](../codebase/214.md) later wired one up, but this render still doesn't read
it — the thinking indicator is a separate, still-open slice). CSS blink guarded by
`@media (prefers-reduced-motion: reduce)`. Since #607's `pre-wrap` rule, a reply whose text ends in a
newline now carries the cursor onto the following line — the whitespace rule working as intended, not
a regression; the cursor `<span>` sits flush against `{item.text}` in the JSX with no intervening
whitespace so no extra blank line is introduced by the markup itself.

**React key = array index**, deliberately: the reducer's `appendDelta`/`fillResult` invariants
guarantee the list is append-only with tail-mutation, never reordering or inserting mid-list, so index
identity is stable per logical item (`turnId` alone would collide once #205 lets a tool split one turn
into two `assistantText` items; a text-bearing key would remount the growing bubble every delta).

**Strangler-Fig coexistence at ship time, not a cutover** — as originally shipped, `Timeline` sat
directly beside `MessageThread`; the coarse path was completely untouched and stayed the *live* one,
`Timeline` returning `null` on an empty `items` array (not an empty `<div>`) for zero layout footprint
so the thread was pixel-identical to before this ticket. The store stayed empty in production until
`interactive` flipped (a non-interactive v2 connection receives no structured stream), so this entire
render path was inert at ship time.

**Reconciled in [#179](../codebase/179.md):** the client hello now advertises `interactive`, the coarse
`message` fan-out stopped daemon-side, and `MessageThread` was retired rather than left as an empty
dead region — `Timeline` is now the conversation's single thread surface. See
[The interactive flip + thread cutover](conversation-shell-conversation-and-modals.md#the-interactive-flip--thread-cutover-179) below and
[#203 codebase notes](../codebase/203.md) for the original design and code review record.

## Thinking / working indicator (#215, held for the whole running turn since #648, tool-named since #649, opens on send since #650)

`Timeline`'s structural twin over the coarse `phase` scalar (`TurnPhase`, [ADR 0008](../decisions/0008-thread-timeline-model.md))
rather than the `items` list. Through #796 it mounted immediately after `Timeline`; **since
[#796](https://github.com/pyrycode/pyrycode-desktop/issues/796) it mounts as the sole child of
`ComposerStatusArea`**, the fixed-height row directly above the composer — see [Composer status
row](conversation-shell-composer.md#composer-status-row-796) below for the row itself:

```
.conversation
├── Timeline                   items={useTimelineStore(selectItems)}
└── ComposerStatusArea         isRunning={isTurnRunning(phase)}
    └── ThinkingIndicator      state={workingIndicatorStateWithLocalSend(
                                         { phase, apiRetry, compacting }, localSendPending)}
                                toolName={openToolName(items)}
```

The daemon opens a turn with `turn_state{thinking}` before any `assistant_delta` (pyrycode #632), so
during that window `Timeline` is `null` (no items yet) and, before #215, the thread showed nothing — a
slow turn was indistinguishable from a stalled one. `ThinkingIndicator({ state })` is `Timeline`'s twin:
pure, exported, in-file, server-rendered from an injected value, never a store read of its own. `state
=== null` → `null` (zero footprint, the `Timeline`-on-empty-`items` precedent) — **as of #796, "zero
footprint" describes the label only, not the row**, since `ComposerStatusArea` always renders and holds
its height regardless (AC2, see below); otherwise a single `<span
className="conversation__thinking composer-status__label">` (a `<div className="bubble bubble--daemon
bubble--thinking">` through #796; the bubble treatment retired when the label moved into the row — see
[Composer status row](conversation-shell-composer.md#composer-status-row-796)) with `THINKING_COPY` (`'Thinking…'`) when `state ===
'thinking'` or `WORKING_COPY` (`'Working…'`) when `state === 'working'`. The label now inherits
`--color-primary` from the row's `.composer-status__activity` group rather than carrying its own muted
tint — both labels are still static, client-owned constants, never `phase` itself.

**Union input, not `phase` and not a `string` — the label CHOICE stays a type-level guarantee; naming
the tool is a deliberate, narrow exception to it, since [#649](../codebase/649.md).** The view's `state`
prop is `state: WorkingIndicatorState | null` (`WorkingIndicatorState = 'thinking' | 'working'`), never
`phase: TurnPhase` (which would make the illegal `'idle'` branch representable) and never a plain
`string` (which would reopen the hole the type exists to close). Through #648 this was "no
daemon-supplied string is rendered by this slice, full stop" — the prop's only inhabitants were two
client-owned literals and `null`. #649 named the daemon's currently-open tool in the label (per the
operator's 2026-08-20 decision: the tool row two lines above the indicator already renders the same
`name` as an escaped inert React child, so the indicator adds no new exposure) and had to reverse that
guarantee to do it. What survives, narrowed rather than dropped: the **label choice** (`state`) is still
a closed client-owned union, unwidened; the daemon string rides a second, separately-typed, *required*
`toolName: string | null` prop; the fixed copy around the name (`toolWorkingCopy`) stays a client-owned
constant; and the name reaches the DOM only as an auto-escaped text child, never through an HTML sink.
`state === null` is checked first, so #493's and #496's supersede rules still hide the indicator entirely
in either phase — an open tool cannot resurrect it. The container does both derivations
(`workingIndicatorState` and `openToolName`) over values it already holds, not the view. No animation
shipped (an optional pulse was explicitly non-load-bearing per spec); through #796 the interim treatment
stayed deliberately minimal, since the locked mobile design (`g2HIq2UyPhslEoHRokQmHG`, node `16-8`) has no
dedicated working-indicator node. **#796 is the deferred desktop-design pass this paragraph used to await**
— the desktop layout's own Figma node (`111:3525`) exists, and consuming it moved the label off the
daemon-bubble surface into the fixed-height row above the composer and added the one genuinely new piece,
a turning icon; see [Composer status row](conversation-shell-composer.md#composer-status-row-796) below.

**Opens locally on send since [#650](../codebase/650.md), closes robustly.** Through #649 the
indicator stayed dark from Enter until the daemon's first event — the composer's optimistic echo
landed as a `userText` timeline item, but `phase` stayed `idle` until `turn_state{thinking}`
arrived, so a slow network round-trip looked identical to a dead app. #650 closes that window with
a new [timeline-store](conversation-timeline-store.md) scalar, `localSendPending: boolean`, set by
the same `userText` dispatch that posts the echo (no new event: that dispatch already *is* the
composer's accept signal). `phase` itself stays daemon-only — a wire mirror, and the one field the
composer's stop variant reads (`InterruptControl` read it here until [#678](https://github.com/pyrycode/pyrycode-desktop/issues/678)
folded the affordance into `Composer`'s own send button; see [Interrupt envelope § The render
affordance](interrupt-envelope.md#the-render-affordance-307-merged-into-the-send-button-by-678)) — so the
local open cannot arm the interrupt affordance. The mount site
now calls a second exported derivation, `workingIndicatorStateWithLocalSend(status,
localSendPending)`, composed *on top of* `workingIndicatorState` rather than folded into
`ThreadStatus`: the daemon's answer wins when non-null, otherwise a pending local send re-calls the
same gate with `phase: 'thinking'` substituted, inheriting #493's/#496's supersede clauses for
free and picking the flicker-free `'thinking'` label (the daemon's first real `turn_state{thinking}`
then changes nothing at the seam). Closes on any daemon `turn_state`, on a reconnect reconcile (the
sharpest form of the #538 hazard — a locally-opened window has no daemon-side edge to wait for at
all if the send never arrives, corroborated by pyrycode #1062), and for free on a timeline `reset`
(conversation switch, unpair). `ThreadStatus`, `shouldShowThinking` and `workingIndicatorState`
stay textually untouched. See [#650 codebase notes](../codebase/650.md) for the full reducer
arm-by-arm classification and the e2e mount-timing repair it also required.

Was dormant until [#179](../codebase/179.md) flipped `interactive` (`phase` stayed `idle` in
production until then, the same posture as `Timeline`); now live. Code review flagged one non-gating
NIT: the label has no live region (`role="status"`), so a screen reader won't announce it appearing,
disappearing, **or its label changing mid-turn since #648, or naming a tool since #649** — still
unaddressed. #796's own spec logged this as an open question rather than a NIT and left it standing on
the same reasoning: a live region beside a rotating icon is its own a11y decision, and no AC has ever
covered it. See [#215 codebase notes](../codebase/215.md) for
the full original design, [#648 codebase notes](../codebase/648.md) for the whole-turn broadening,
[#649 codebase notes](../codebase/649.md) for the tool-naming reversal, patterns established, and the
deferred stale-open-`toolCall` risk (cross-referenced against pyrycode #1243), and
[#650 codebase notes](../codebase/650.md) for the local-send open/close and the e2e mount-timing
repair it forced.

**Gate narrowed in [#493](../codebase/493.md), narrowed again in [#496](../codebase/496.md), broadened
in [#648](../codebase/648.md), composed on — not touched — by [#650](../codebase/650.md):**
`shouldShowThinking(status)` is `isTurnRunning(status.phase) &&
status.apiRetry === null && !status.compacting` — reusing the same `isTurnRunning` predicate the
composer's stop variant gates on (`thinking || responding`), rather than the bare `phase ===
'thinking'` comparison #215 shipped. A separate, new `workingIndicatorState(status)` composes **on top
of** that gate rather than folding into it: `null` when `!shouldShowThinking(status)`, else `'thinking'`
when `status.phase === 'thinking'`, else `'working'` (`'idle'` is unreachable in that second branch
because the gate already excluded it). `shouldShowThinking` itself keeps its name, its `ThreadStatus`
parameter, its `boolean` return, and both supersede clauses (`apiRetry === null && !compacting`)
textually untouched — while either is live, the corresponding status below still supersedes this
indicator, in **either** running phase now, not only `thinking`. #496 extended the same `ThreadStatus`
record and predicate by exactly one field and one clause — the seam #493 built by name for this ticket,
not a second parallel gate. See [Api-retry indicator](#api-retry-indicator-493) and [Compacting
indicator](#compacting-indicator-496) below.

**Why broaden rather than add a second indicator.** The daemon emits `turn_state{thinking}` only while
claude is producing thinking text; the first reply token or the first tool step flips `phase` to
`responding`, and no further `turn_state` arrives until the turn ends (pyrycode
`cmd/pyry/interactive_turn_v2.go`). For a tool-heavy turn `responding` is the phase that *lasts*, and it
was exactly the phase in which #215's gate showed nothing — the operator's first real use of the desktop
app (2026-08-20) surfaced this as a screen that looked frozen for most of a turn. Because the client
receives no signal finer than `responding` inside the tool loop, `WORKING_COPY` ("Working…") is
deliberately generic rather than naming tool activity — a copy like "Running tools…" would be a lie
whenever the turn is actually still streaming text.

**Named since [#649](../codebase/649.md): `WORKING_COPY` is superseded by the specific tool name whenever
one is actually open**, closing the operator's remaining complaint that `WORKING_COPY` read identically
for a 40 ms file read and a four-minute build. This doesn't reopen the lie #215 avoided, because it isn't
derived from `phase` at all — it's a direct, independent read of `items` (`openToolName`): a `toolCall`
item (`threadTimeline.ts:42-50`) carries `name` and starts `result: null`, filled in place when the
correlated `toolResult` arrives, so "a tool is open right now" and "which one, if more than one" (the
last such item in array order — `items` is append-only, `fillResult` fills in place without reordering)
are both facts already sitting in the store, not an inference over `phase`. `openToolName(items)` is
computed alongside `workingIndicatorState` at the same call site and passed as the indicator's second,
required `toolName: string | null` prop; when it is non-null it replaces the phase-derived copy with
`` `Running ${name}…` `` (`toolWorkingCopy`) rather than sitting beside it, and reverts to the generic copy
the moment the tool's `toolResult` fills the item — no further `turn_state` needed. Renders through a
`.tool-row__summary`-style one-line-ellipsis bound (not `.tool-row__name`'s never-truncates one — see
[#649 codebase notes](../codebase/649.md)) so a long tool name never wraps to a second line or moves the
composer — through #796 via `.bubble--tool-label`, backstopped by `.bubble`'s own `max-width: min(680px,
75%)`; **since #796 via `.composer-status__label--tool`**, and the backstop changed with it: `.bubble` is
gone from this label's ancestry, so the bound is now a three-link flex chain instead — see [Composer
status row § the truncation bound](conversation-shell-composer.md#composer-status-row-796) below for the replacement and why it had to
be re-derived rather than copied. One deliberately undefended edge: an interrupted turn can leave a
`toolCall` permanently `result: null`, so the *next* turn's indicator could name that stale tool — the
timeline already shows that call as a permanently pending, dimmed row (#230), so the label would mirror
what's already on screen rather than contradict it; the fix if ever observed is scoping the scan to stop
at the current turn's `turnBoundary`.

## Api-retry indicator (#493)

`ThinkingIndicator`'s twin over a third timeline-store scalar (`apiRetry: ApiRetryStatus | null`),
`ThinkingIndicator`'s **supersede peer** — a relationship carried entirely by `workingIndicatorState`
reading `apiRetry`/`compacting`, not by DOM adjacency, so it survived [#796](https://github.com/pyrycode/pyrycode-desktop/issues/796)
moving `ThinkingIndicator`'s own markup down into the composer status row unchanged. Mounted immediately
after `Timeline` and before `StallIndicator`:

```
.conversation
├── Timeline                   items={useTimelineStore(selectItems)}
├── ApiRetryIndicator           retry={useTimelineStore(selectApiRetry)}
├── CompactingIndicator         isCompacting={useTimelineStore(selectCompacting)} — #496, see below
└── StallIndicator              isStalled={useTimelineStore(selectStalled)}
                                 (ThinkingIndicator itself moved to the composer status row by #796 — see above)
```

The daemon emits `api_retry` when claude hits an API error and retries, carrying an explicit
`active`/`current`/`total` counter ([#492](../codebase/492.md) decodes it into a non-nullary `apiRetry`
`DaemonEvent`). Unlike `stall`, the frame has an **explicit falling edge** (`active: false`) and no
wire-side dedup — the rising edge re-fires as the count climbs, and a verbatim repeat is a same-state
no-op rather than a re-render. `reduceTimeline` holds the live counter as `ApiRetryStatus | null`,
cleared only by the falling edge — turn activity (`assistantDelta`/`toolUse`/`toolResult`/`turnState`)
leaves it showing, the deliberate inverse of `stalled`'s self-clear.

`ApiRetryIndicator({ retry })` is `StallIndicator`'s structural twin: pure, exported, in-file,
server-rendered from an injected `ApiRetryStatus | null`. `retry === null` → `null` (zero footprint);
present → a `flex: 0 0 auto` `.conversation__api-retry` wrapper (`.conversation__stall`'s shape) holding
`<div className="bubble bubble--daemon bubble--api-retry">API error — retrying…</div>`, plus, when
`retry.total > 0`, a nested `<span className="api-retry__counter"> attempt {current}/{total}</span>`.
When the counter is unknown (`current`/`total` both `0`) the span is omitted entirely — no `"0/0"` is
ever rendered, and the count is never computed as a fraction (`current / total` would be `NaN` at
`0/0`).

**Record input, not a boolean — the same AC1 posture as #215/#317, adapted for a counter.** The prop is
`ApiRetryStatus | null` (two numbers, no string field), never the store's `TimelineState` or the raw
`ThreadEvent`, so "no daemon-supplied string is ever rendered" stays a type-level guarantee even though
this view — unlike `StallIndicator` — does render daemon-derived digits.

**Visually distinct from both siblings.** `.bubble--api-retry` reuses `.bubble--daemon`'s fill/radius
and diverges to `--color-error` text (the same error role as `.bubble--stall`) but **omits** the left
accent bar that is `.bubble--stall`'s distinguishing mark — keeping the two problem states separable
from each other. Through #796 both were also distinct from the muted `.bubble--thinking`; since #796
retired that class, the comparison point is the composer status row's label instead, which now reads in
`--color-primary` rather than muted — still a distinct role from either problem state's `--color-error`.
No new design token.

May still co-render with `StallIndicator` (and, since #496, `CompactingIndicator`) — AC5 scopes mutual
exclusion to `ThinkingIndicator` only, #317's "distinct facts, adjacent flex rows" posture for stall is
unchanged. No Figma node (same documented gap as #215/#277/#279/#305/#317); a dedicated degraded-state
visual remains a Figma-side follow-up for Juhana. See
[#493 codebase notes](../codebase/493.md) for the full design, patterns established, and open questions.

## Compacting indicator (#496)

`ThinkingIndicator`'s **second** supersede peer, over a fourth timeline-store scalar (`compacting:
boolean`), mounted immediately after `ApiRetryIndicator` and before `StallIndicator` — through #796 this
grouped the two thinking-superseders (#493, #496) contiguously below the indicator they occlude; since
[#796](https://github.com/pyrycode/pyrycode-desktop/issues/796) moved `ThinkingIndicator`'s markup into
the composer status row, this trio is contiguous below `Timeline` instead, unaffected in every way that
matters — the supersede relationship lives in `workingIndicatorState`, not DOM position:

```
.conversation
├── Timeline                   items={useTimelineStore(selectItems)}
├── ApiRetryIndicator           retry={useTimelineStore(selectApiRetry)}
├── CompactingIndicator         isCompacting={useTimelineStore(selectCompacting)}
└── StallIndicator              isStalled={useTimelineStore(selectStalled)}
```

The daemon emits `compacting` while claude auto-compacts its context — tens of seconds of total
silence on the content channel ([#495](../codebase/495.md) decodes it into a non-nullary `compacting`
`DaemonEvent`, `{ active: boolean }`, no counter). Like `apiRetry`, the frame has an **explicit falling
edge** and no wire-side dedup, but carries no progress data at all — banner-only. `reduceTimeline` holds
the live state as a plain `boolean` (not `| null`: there's no counter to discard on clear, so a boolean
is the honest representation), cleared only by the falling edge — turn activity leaves it showing, the
same deliberate inverse of `stalled` that `apiRetry` established.

`CompactingIndicator({ isCompacting })` is `StallIndicator`'s structural twin: pure, exported, in-file,
server-rendered from an injected boolean, not a record — there are no digits to render, so (unlike
`ApiRetryIndicator`) a boolean prop is sufficient to make "no daemon-supplied string is ever rendered" a
type-level guarantee. `isCompacting === false` → `null` (zero footprint); `true` → a `flex: 0 0 auto`
`.conversation__compacting` wrapper (`.conversation__api-retry`'s shape) holding `<div className="bubble
bubble--daemon bubble--compacting">Compacting the conversation…</div>`. `COMPACTING_COPY` is exported,
apostrophe-free, ends in U+2026, and is asserted distinct from `'Thinking…'`/`STALL_COPY`/
`API_RETRY_COPY`.

**Compaction is progress, not a problem — deliberately does not reuse the error role.**
`.bubble--stall` and `.bubble--api-retry` both use `--color-error` because both signal a degrading
session; compaction is claude working normally, so `.bubble--compacting` instead uses the muted
`--color-on-surface-variant` text treatment — through #796 this matched the daemon-bubble surface's own
`.bubble--thinking` — with a left accent bar in the **primary** role (`--color-primary`,
`.bubble--stall`'s bar structure with the error role swapped out). Through #796 this completed a four-way
text-role × left-bar matrix with every cell distinct: thinking (muted/no-bar), stall (error/error-bar),
api-retry (error/no-bar), compacting (muted/primary-bar). **Since [#796](https://github.com/pyrycode/pyrycode-desktop/issues/796)
retired `.bubble--thinking`** and moved the working label off the daemon-bubble surface entirely (see
[Composer status row](conversation-shell-composer.md#composer-status-row-796) above, where the label's own colour also changed, to
`--color-primary`), this is now a three-way matrix among the indicators that stayed behind: stall
(error/error-bar), api-retry (error/no-bar), compacting (muted/primary-bar) — `.bubble--compacting`'s own
rule is untouched, and the muted register it picked still reads correctly on its own terms even though the
class it was originally matched against is gone. No new design token — the matrix was already saturated
on both axes with four cells; three leaves headroom for one more before a third visual axis is needed.

May co-render with `ApiRetryIndicator` and `StallIndicator` — AC4 scopes exclusion to `ThinkingIndicator`
only, the same #493 posture. No Figma node (same documented gap as #215/#277/#279/#305/#317/#493). See
[#496 codebase notes](../codebase/496.md) for the full design, patterns established, and open questions.

## Stall indicator (#317)

`ThinkingIndicator`'s own twin, over a second timeline-store scalar (`stalled: boolean`); through #796
mounted immediately after `ThinkingIndicator` in the DOM, now mounted last of the three problem-state
indicators that stayed behind when [#796](https://github.com/pyrycode/pyrycode-desktop/issues/796) moved
`ThinkingIndicator`'s markup into the composer status row — kept its own bubble treatment and
null-at-rest posture, which is exactly why `thread-scroll-pin.spec.ts`'s viewport-shrink criterion was
repointed onto this indicator rather than the one it used to sit beside (see [Composer status
row](conversation-shell-composer.md#composer-status-row-796) above and the **Thread scroll pin** edge case below):

```
.conversation
├── Timeline                   items={useTimelineStore(selectItems)}
├── ApiRetryIndicator           retry={useTimelineStore(selectApiRetry)} — #493, see above
├── CompactingIndicator         isCompacting={useTimelineStore(selectCompacting)} — #496, see above
└── StallIndicator              isStalled={useTimelineStore(selectStalled)}
```

The daemon emits a one-shot `stall` signal when claude goes quiet mid-turn or the screen parser
degrades ([#315](../codebase/315.md) decodes it into a `stallDetected` `DaemonEvent`, nullary at ship
time and later widened with `conversationId` by [#732](../codebase/732.md); the id stops at the
renderer timeline bridge, so this view is unaffected). Because
the daemon sends onset-only with no "cleared" frame, `reduceTimeline` self-clears the `stalled` scalar
client-side on the next turn-activity event (`assistantDelta`/`toolUse`/`toolResult`/`turnState`) —
this view only renders whatever the store currently holds. `StallIndicator({ isStalled })` is
`ThinkingIndicator`'s structural twin: pure, exported, in-file, server-rendered from an injected
boolean. `isStalled === false` → `null` (zero footprint); `isStalled === true` → a `flex: 0 0 auto`
`.conversation__stall` wrapper (`.conversation__thinking`'s shape) holding `<div className="bubble
bubble--daemon bubble--stall">The turn seems to have stalled…</div>` — the daemon-bubble surface,
diverging to the error role rather than the muted thinking treatment.

**Boolean input, not the store type — the same AC4 posture as #215.** The prop is `isStalled:
boolean`, never the store's `TimelineState`, so "no daemon-supplied string is ever rendered" is a
type-level guarantee, reinforced here by the daemon frame carrying no content to begin with (#315's
nullary emit) — there is no field to leak even if the type were looser.

**Visually distinct by design (AC4).** `.bubble--stall` reuses `.bubble--daemon`'s fill/radius but
diverges to `--color-error` — `color: var(--color-error)` plus a leading `border-left: 4px solid
var(--color-error)` accent (the connection-banner/rejection-line precedents) — so a stall reads as a
problem state. Through #796 that distinguished it from the muted `.bubble--thinking`; since #796 retired
that class, the comparison point is the composer status row's own label, which now reads in
`--color-primary` — still never confusable with `--color-error`. No new design token; `--color-error`
is the only error-role token on desktop.

Both indicators can show at once (a stall onset arriving mid-`thinking`) — accepted as correct, since
they occupy adjacent flex rows and convey different facts; no mutual-exclusion coordination was built.
**[#493](../codebase/493.md) narrowed `ThinkingIndicator`'s own gate to also exclude a live api-retry
status (see [Api-retry indicator](#api-retry-indicator-493) above), and [#496](../codebase/496.md)
narrowed it again to exclude a live compaction status (see [Compacting
indicator](#compacting-indicator-496) above), but both left this stall/thinking co-render posture
untouched** — AC5/AC4 each scoped mutual exclusion to thinking only, so `StallIndicator`,
`ApiRetryIndicator`, and `CompactingIndicator` may all show at once. No Figma node (same documented gap
as #215/#277/#279/#305 — the mobile file draws only the populated steady-state thread, node `16-8`). See
[#317 codebase notes](../codebase/317.md) for the full design, patterns established, and open
questions.

`Timeline`'s `toolCall` arm gained its pending render in [#218](../codebase/218.md): a compact chip —
tool name and one-line input summary — replaces the earlier `case 'toolCall': return null` no-op, at
50% opacity for the unresolved (`result: null`) state. [#230](../codebase/230.md) later taught the
same arm to resolve that chip in place once `result` fills. Both were dormant until
[#179](../codebase/179.md); now live. See
[Pending tool-call row](conversation-shell-tool-rows.md#pending-tool-call-row-218) and
[Resolved tool-call row](conversation-shell-tool-rows.md#resolved-tool-call-row-230) below.
