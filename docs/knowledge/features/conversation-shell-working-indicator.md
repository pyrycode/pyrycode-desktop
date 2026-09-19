# Conversation shell — thinking and working indicator

Part of [Turn status surfaces](conversation-shell-turn-status.md).

## Thinking / working indicator (#215, held for the whole running turn since #648, tool-named since #649, opens on send since #650, folds in retry, compacting and stall since #967)

`Timeline`'s structural twin over the coarse `phase` scalar (`TurnPhase`, [ADR 0008](../decisions/0008-thread-timeline-model.md))
rather than the `items` list. Through #796 it mounted immediately after `Timeline`; **since
[#796](https://github.com/pyrycode/pyrycode-desktop/issues/796) it mounts as the sole child of
`ComposerStatusArea`**, the fixed-height row directly above the composer — see [Composer status
row](conversation-shell-composer-status-row.md#composer-status-row-796) below for the row itself. **Since
[#967](https://github.com/pyrycode/pyrycode-desktop/issues/967) this is the row's only occupant, full
stop** — the region between `Timeline` and the queued backlog, which through #796 still held three loose
null-at-rest bubble blocks (`ApiRetryIndicator`, `CompactingIndicator`, `StallIndicator`, see below), is
now empty, and their copy is a wider `state` union on this one view instead:

```
.conversation
├── Timeline                   items={useTimelineStore(selectItems)}
└── ComposerStatusArea         isRunning={isTurnRunning(phase)}
    └── ThinkingIndicator      state={workingIndicatorStateWithLocalSend(
                                         { phase, apiRetry, compacting, stalled, resetting }, localSendPending)}
                                toolName={openTool?.name ?? null}
                                toolElapsedSeconds={openTool?.elapsedSeconds}
                                retry={apiRetry}
                                resetting={resetting}
                                thinkingTokens={thinkingTokens}
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
[Composer status row](conversation-shell-composer-status-row.md#composer-status-row-796)) with `THINKING_COPY` (`'Thinking…'`) when `state ===
'thinking'` or `WORKING_COPY` (`'Working…'`) when `state === 'working'`. The label now inherits
`--color-primary` from the row's `.composer-status__activity` group rather than carrying its own muted
tint — both labels are still static, client-owned constants, never `phase` itself.

**Union input, not `phase` and not a `string` — the label CHOICE stays a type-level guarantee; naming
the tool is a deliberate, narrow exception to it, since [#649](../codebase/649.md).** The view's `state`
prop is `state: WorkingIndicatorState | null`, never `phase: TurnPhase` (which would make the illegal
`'idle'` branch representable) and never a plain `string` (which would reopen the hole the type exists to
close). Through #648 this was "no daemon-supplied string is rendered by this slice, full stop" — the
prop's only inhabitants were two client-owned literals and `null`. #649 named the daemon's currently-open
tool in the label (per the operator's 2026-08-20 decision: the tool row two lines above the indicator
already renders the same `name` as an escaped inert React child, so the indicator adds no new exposure)
and had to reverse that guarantee to do it. What survives, narrowed rather than dropped: the **label
choice** (`state`) is still a closed client-owned union — **widened to five by #967 and six by #1517**
(`'thinking' | 'working' | 'retrying' | 'compacting' | 'stalled' | 'resetting'`).
The original fold's comment is explicit
that this is a *different* act from the one #649 refused: every added member is another client-owned
literal, so the label choice stays a closed set of this file's own constants rather than dissolving into
the daemon's vocabulary. The daemon's contributions ride their own separately-typed, *required*
props: the tool name on `toolName: string | null` (`toolWorkingCopy` keeps its client-owned copy around
it, and the name reaches the DOM only as an auto-escaped text child, never through an HTML sink), and —
new in #967 — the retry counter's two integers on `retry: ApiRetryStatus | null` (no string field, so the
"this prop structurally cannot carry a daemon string" guarantee `ApiRetryIndicator` used to hold on its
own is preserved verbatim on the merged view) — and, new in [#1314](https://github.com/pyrycode/pyrycode-desktop/issues/1314), the running thinking-token estimate on
`thinkingTokens: number | null` (also a bare number, same guarantee). The reset record also rides a
required `resetting: ResettingStatus | null` prop; its closed phase/outcome tokens select client-owned
copy (see the [status row](conversation-shell-composer-status-row.md#composer-status-row-796)).
All four are required for
`toolName`'s own recorded reason: an optional prop lets the container silently omit it, and nothing in
this repo could catch that since every container test renders the initial store, so `tsc` is the only
available detector and the type must be the one that fails. **#1314 paid that reason's cost in full**: the
prop's own consumer count is one (the label), but `tsc` making it required is what turned all seventeen
pre-existing `<ThinkingIndicator …>` sites in `ConversationScreen.test.tsx` into compile errors rather than
a silent gap — recorded as the plan's own `## Revisions` entry on why the ticket stayed whole rather than
splitting at that cascade.

**The tool name is scoped to the working/thinking state alone — reversed by #967.** Until #967 the
`state === null` guard was what enforced #493's and #496's supersede rules, and the tool name then won
over the phase-derived copy: `toolName !== null ? toolWorkingCopy(toolName) : …`, safe only because a
live retry or compaction made `state` null and the component returned before reaching the label. Now
that all six states share the one slot, `state === 'retrying'` with a tool still open is *reachable*,
and the old order would have rendered the tool name where the row must say `API_RETRY_COPY`. So one
`const toolLabel = (state === 'thinking' || state === 'working') && toolName !== null ?
toolWorkingCopy(toolName) : null` now drives both the label and the `--tool` modifier — one expression
rather than two conditions that have to independently agree — and the four superseding states outrank
it unconditionally. `{ state: 'thinking', toolName: 'Bash' }` stays well-defined rather than illegal (the
daemon flips to `responding` on the first tool step, so it is a defined edge, not a defended one); an
open tool during a live retry or compaction is now equally well-defined and renders the state's own copy.
No animation shipped (an optional pulse was explicitly non-load-bearing per spec); through #796 the
interim treatment stayed deliberately minimal, since the locked mobile design (`g2HIq2UyPhslEoHRokQmHG`,
node `16-8`) has no dedicated working-indicator node. **#796 is the deferred desktop-design pass this
paragraph used to await** — the desktop layout's own Figma node (`111:3525`) exists, and consuming it
moved the label off the daemon-bubble surface into the fixed-height row above the composer and added the
one genuinely new piece, a turning icon; see [Composer status
row](conversation-shell-composer-status-row.md#composer-status-row-796) below.

**The label is a single text child in every one of the six states, never constant-plus-span.** That is
load-bearing for the truncation bound: one text run ellipsizes as one unit, so on overflow the client `…`
is truncated away and replaced by the ellipsis the truncation itself draws — two runs would render two
ellipses. `ApiRetryIndicator`'s retired bubble *did* render constant-plus-span (`.api-retry__counter`,
CSS deleted with it), which is exactly why the counter is interpolated into the label's own string
instead (`apiRetryLabel`, below) rather than carried in a nested span — [#1314](https://github.com/pyrycode/pyrycode-desktop/issues/1314)'s running thinking-token estimate takes the identical shape in the thinking
state (`thinkingLabel`, below), for the same reason. The class attribute keeps its
shipped order and appends at most one modifier: `conversation__thinking composer-status__label`, plus
` composer-status__label--tool` in the working/thinking state with a name, or
` composer-status__label--stalled` in the stalled state, or
` composer-status__label--resetting` during reset — mutually exclusive by construction, since
`toolLabel` is `null` in every superseding state.

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
in [#648](../codebase/648.md), composed on — not touched — by [#650](../codebase/650.md), widened into a
four-way precedence by [#967](https://github.com/pyrycode/pyrycode-desktop/issues/967).**
`shouldShowThinking(status)` is unchanged since #496 — `isTurnRunning(status.phase) &&
status.apiRetry === null && !status.compacting` — and after #967 it answers a **narrower** question than
its name once implied: not "does anything show", but whether the *working* label specifically shows,
now that a stall can also occupy the slot. It keeps its name, its `ThreadStatus` parameter, its `boolean`
return, and both supersede clauses textually untouched, deliberately: they are #493's and #496's standing
regression evidence, the predicate is exported and independently tested, and — per #650's own comment,
trued up by #967 — one order living in one function is what keeps the supersede facts from drifting into
two places. It gains neither a `stalled` nor a `resetting` clause: the higher-priority returns
in `workingIndicatorState` decide whether either occupies the slot.

**`workingIndicatorState(status)` selects the six labels in one order, with reset first since #1517:**

| Order | State | Why |
| --- | --- | --- |
| 1 | `'resetting'` | the handoff is a real turn; reset must stay visible while it streams |
| 2 | `'retrying'` | a live rising/falling-edge signal for a failed API call |
| 3 | `'compacting'` | a live compaction signal; reset and retry win if they overlap |
| 4 | `'stalled'` | a held onset cleared by turn activity; live reset, retry and compaction outrank it |
| 5 | `'thinking'` / `'working'` | selected by the running turn phase, tool-named where a tool is open |

```ts
export function workingIndicatorState(status: ThreadStatus): WorkingIndicatorState | null {
  if (status.resetting !== null) return 'resetting'
  if (status.apiRetry !== null) return 'retrying'
  if (status.compacting) return 'compacting'
  if (status.stalled) return 'stalled'
  if (!shouldShowThinking(status)) return null
  return status.phase === 'thinking' ? 'thinking' : 'working'
}
```

**The first four returns precede the running-turn gate.** Reset, retry, compaction
and stall remain visible while the turn is idle; only thinking/working is turn-gated.
The restarting phase has no turn of its own, so gating reset on a running turn would
hide it. `thread-scroll-pin.spec.ts` also pins the idle-stall case.

**`ThreadStatus` requires every fact used to choose the label.** #967 added stall to
the phase/retry/compaction record; #1517 adds the reset phase/outcome record:

```ts
export interface ThreadStatus {
  phase: TurnPhase
  apiRetry: ApiRetryStatus | null
  compacting: boolean
  stalled: boolean
  resetting: ResettingStatus | null
}
```

`stalled` and `resetting` are **required, not optional** — an optional field is precisely the silent-omission hole
`toolName`'s own comment refuses, and the type is the only detector this repo has here, since every
container test renders the initial store. The cost of having a detector at all is that every
`ThreadStatus` literal in `ConversationScreen.test.tsx` gains one token; `tsc` names each one (measured
at 30 call sites once the fold shipped, not the 32 a `grep -c 'compacting:'` estimate had counted before
build — the grep matched two prose lines inside `describe` comments that merely mention the field name;
the compiler's count is the trustworthy one). See § Why the field, not a wrapper, below.

**Why the field, not a wrapper — #650's own comment argued against taking a fourth field, and #967
departs from that reasoning rather than contradicting it silently.** #650 composed
`workingIndicatorStateWithLocalSend` *on top of* `workingIndicatorState` instead of adding a field,
because a field would have broken 19 status literals as pure retyping with not one expectation changed —
literals that are the standing regression evidence for #493's and #496's supersede rules. Both halves
were true, and neither carries to a status in the **middle** of the order. The difference is precedence
position: #650's local-send window is a *lower*-priority fallback, composing on top of a proven gate
without restating anything. A stall sits *below* retry and compaction and *above* the working label, so a
wrapper would have had to re-read `apiRetry` and `compacting` itself to choose between `'retrying'`,
`'compacting'` and `'stalled'` — putting the supersede facts in two places, which is the exact drift
\#650's comment exists to prevent. So #967 took the field, paid the retype, and kept one record, one
function, one order; #650's own comment was rewritten in place so it stops arguing against the code
sitting below it.

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
item carries `name` and starts `result: null`, filled in place when the
correlated `toolResult` arrives. The scan requires both `result === null` and no explicit `denial`,
so "a tool is open right now" and "which one, if more than one" (the
last such item in array order — `items` is append-only, `fillResult` fills in place without reordering)
are both facts already sitting in the store, not an inference over `phase`. `openToolName(items)` is
computed alongside `workingIndicatorState` at the same call site and passed as the indicator's second,
required `toolName: string | null` prop; when it is non-null it replaces the phase-derived copy with
`` `Running ${name}…` `` (`toolWorkingCopy`) rather than sitting beside it, and reverts to the generic copy
the moment no eligible tool remains — a result or an explicit
[denial](conversation-shell-tool-rows.md#permission-denied-tool-call-row) retires a call from
the scan immediately, without another `turn_state`. Denial leaves the turn's working state
and priority rules intact. Renders through a
`.tool-row__summary`-style one-line-ellipsis bound (not `.tool-row__name`'s never-truncates one — see
[#649 codebase notes](../codebase/649.md)) so a long tool name never wraps to a second line or moves the
composer — through #796 via `.bubble--tool-label`, backstopped by `.bubble`'s own `max-width: min(680px,
75%)`; **since #796 via `.composer-status__label--tool`**, and the backstop changed with it: `.bubble` is
gone from this label's ancestry, so the bound is now a three-link flex chain instead — see [Composer
status row § the truncation bound](conversation-shell-composer-status-row.md#composer-status-row-796) below for the replacement and why it had to
be re-derived rather than copied. One deliberately undefended edge: an interrupted turn can leave a
`toolCall` permanently `result: null`, so the *next* turn's indicator could name that stale tool — the
timeline already shows that call as a permanently pending, dimmed row (#230), so the label would mirror
what's already on screen rather than contradict it; the fix if ever observed is scoping the scan to stop
at the current turn's `turnBoundary`.

### Tool elapsed reading

The container selects one `openToolCall(items)` for both name and elapsed reading;
`openToolName` remains a wrapper over that same lookup. The scan chooses the latest
pending, non-denied call. When its tool label is active (thinking or working), the
optional `toolElapsedSeconds` appends the [shared elapsed format](conversation-shell-tool-rows.md#live-elapsed-reading)
after a space: `Running Bash… 1m 05s`. The whole label remains one ellipsizing text
run. An absent reading keeps the previous copy; retrying, compacting, stalled and
hidden states retain their existing behavior regardless of the elapsed prop.
Name and seconds must come from the same call, especially with overlapping tools.

### Retired by #967: `ApiRetryIndicator` (#493), `CompactingIndicator` (#496), `StallIndicator` (#317)

Through #796 these three still floated as loose, independently-mounted, null-at-rest bubble blocks
between `Timeline` and the queued backlog — `ThinkingIndicator`'s supersede peers, a relationship always
carried by `workingIndicatorState` reading `apiRetry`/`compacting`/`stalled`, never by DOM adjacency,
which is why #796 could move `ThinkingIndicator`'s own markup down into the composer status row without
touching them. The design draws one row with one label and nothing else in this region — #967 is the
follow-up #796's refiner deferred to keep that ticket small, filed and built here. All three views, their
three mount comments, and seven CSS rules (`.conversation__stall`, `.bubble--stall`,
`.conversation__api-retry`, `.bubble--api-retry`, `.api-retry__counter`, `.conversation__compacting`,
`.bubble--compacting`) are gone; their copy constants (`API_RETRY_COPY`, `COMPACTING_COPY`, `STALL_COPY`)
moved beside `toolWorkingCopy` in the merged view's module, grouped with the fourth and fifth labels
(`THINKING_COPY`/`WORKING_COPY`) they now compete with for the slot — reviewable as one cluster, the
reason `composerSend.ts`'s own chip-copy comment gives for living where it does. `STALL_COPY` is newly
**exported** here — it was the one label of the five still module-private, forcing three separate test
files to assert its literal instead of the constant.

**What the reducer still does is unchanged — only which view reads it moved.** The wire mechanics that
used to be these three components' own explanation now live entirely in [Conversation timeline
store](conversation-timeline-store.md) and its [internals](conversation-timeline-store-internals.md):
`api_retry` carries an explicit `active`/`current`/`total` counter with an explicit falling edge and no
wire-side dedup, held as `ApiRetryStatus | null` and cleared only by that falling edge; `compacting`
carries `{ active: boolean }` with no counter, held as a plain `boolean`, same falling-edge-only clear;
`stall` is onset-only with no clearing frame at all, so `reduceTimeline` self-clears `stalled`
client-side on the next turn-activity event. Turn activity leaves `apiRetry` and `compacting` showing —
the deliberate inverse of the stall's self-clear — and that asymmetry is exactly what
`thread-scroll-pin.spec.ts` still exercises end to end (see the **Thread scroll pin** edge case in
[Conversation shell](conversation-shell.md#edge-cases-and-limitations)).

**The retry counter now folds into the label's one text run instead of its own span.**
`ApiRetryIndicator`'s bubble rendered `API_RETRY_COPY` as a constant with a nested
`<span className="api-retry__counter">` for the counter; the merged label is a **single text child in
every state** (see above), so a module-private `apiRetryLabel(retry: ApiRetryStatus | null): string`
interpolates it into one string instead — `retry === null || retry.total <= 0` returns the bare
`API_RETRY_COPY` (a degrade, not a defence: the container only ever derives `'retrying'` from
`apiRetry !== null`, so this arm is unreachable from there, but the type admits it), otherwise
`` `${API_RETRY_COPY} attempt ${retry.current}/${retry.total}` `` — the same `total > 0` gate the retired
view used, never `current / total` (`NaN` at `0/0`). Both integers are guaranteed JS numbers, not daemon
strings: `parseApiRetryPayload` (`src/main/transport/inboundMessage.ts`) narrows them with
`requireNumber` and throws `WireDecodeError` otherwise, which is also what bounds the interpolation's
length — a JS number stringifies to at most 24 characters. A module-private `statusRowCopy(state, retry,
thinkingTokens, resetting)` is the total switch that picks among all six labels, with **no `default`**, so a new
`WorkingIndicatorState` member is a `tsc` error here rather than a silently unlabelled row. **The estimate
reaches the `'thinking'` arm alone** — AC2 froze the other four states verbatim, so a retry, a compaction,
a stall and the generic working label never carry it, and neither does the tool-named label (the tool name
already supersedes the thinking copy unconditionally).

**`thinkingLabel(thinkingTokens: number | null): string`** ([#1314](https://github.com/pyrycode/pyrycode-desktop/issues/1314)) is `apiRetryLabel`'s sibling, written to the identical shape — the constant, one
hole, one client-owned unit — and reads `` `${THINKING_COPY} ~${shown} tokens}` `` when a reading is held,
the bare `THINKING_COPY` otherwise. The `~` is not decoration: the daemon's own docs call the reading
"approximate progress for spinners/pills, not the authoritative billed output_tokens", so the label must
never read as a number to bill against. `shown` is the reading verbatim below 1000 and rounded to the
nearest hundred at 1000 and above (`1250` → `~1300 tokens`, `1249` → `~1200 tokens`); `0` takes the
ordinary path and renders `~0 tokens` — a reading, not an absence. **Formatted defensively, which is this
arm's stated security obligation, not a style choice**: `requireNumber` at the decode boundary
(`src/main/transport/inboundMessage.ts`) proves only `typeof value === 'number'` — NaN, `Infinity` and
negatives all decode successfully and survive the contextBridge — so `thinkingLabel` degrades to the bare
copy for `null` and for anything that is not a non-negative finite number, the `apiRetryLabel(null)`
degrade posture rather than a throw, since a hostile or buggy daemon must not be able to blank the status
row. Two comparisons, one `Math.round`, one interpolation — no `repeat`, `Array(n)`, `padStart` or loop
bounded by the reading, which is the concrete failure mode a right-aligned formatter written as
`padStart(estimate)` would open (gigabytes allocated from a daemon claim); the plan's security review
carried this forward as a Phase B ban rather than a one-time check. See [Thread timeline § Edge
cases](thread-timeline-limits.md#edge-cases-and-limitations) for the `thinkingTokens` scalar this label reads and
its own non-monotonic contract.

**The stall keeps reading as a problem, but as a colour modifier instead of a bubble role.**
`.bubble--stall` used to carry `color: var(--color-error)` plus a 4px `border-left` accent bar (the
connection-banner/rejection-line precedent); the merged label takes only
`.composer-status__label--stalled { color: var(--color-error) }` — no bar, since a bar was a *bubble*
idiom and there is no fill behind a bare text run for one to bound. Retry and compaction keep the row's
own `--color-primary`, the only colour Figma `111:3523` draws; `--color-error` is the only error-role
token on desktop, so this is within-token — no new token, no literal. Keeping row geometry stable
requires more than matching type, box and line height: reset copy also needs explicit single-line
truncation, as the [minimum-width measurements](conversation-shell-composer-status-row.md#composer-status-row-796)
establish. **The stall's error colour, and whether retry should share it, was drawn
nowhere in Figma — flagged for Juhana in the PR rather than decided silently; still an open question, not
resolved by this ticket.**

**Co-render is gone by construction, not by a new coordination mechanism.** Through #796 all three could
show at once with `ThinkingIndicator` (mutual exclusion scoped to the working label only, by AC4/AC5 of
\#493/#496) — separate surfaces conveying independent facts. One label slot cannot hold more than one
string, so `workingIndicatorState`'s order (above) replaces "may all co-render" with "exactly
one wins" — a loss of simultaneity, not of any individual fact: a live retry still shows, a stall still
shows, just never two at once. `shouldShowThinking`'s own docblock used to state the old co-render
posture twice; both sentences were removed rather than qualified, since #967 made them false at the
function whose result now actually picks between the four.

**e2e re-points, not new coverage.** `stall-bundle.spec.ts` swapped its `.conversation__stall` /
`.bubble--stall` visibility check for one **exact-text** assertion on the row's label
(`.conversation__thinking`, still the identity hook) plus a class check for
`composer-status__label--stalled` — exact rather than `toBeVisible`, because the label element is now
shared by all six states, so mere visibility proves nothing. `thread-scroll-pin.spec.ts` needed two
separate repairs, covered in the **Thread scroll pin** edge case of [Conversation
shell](conversation-shell.md#edge-cases-and-limitations): its fourth criterion (chrome mounting shrinks
the thread's viewport without un-pinning it) moved off the now-empty stall block onto the queued backlog,
and its stall self-clear assertions switched from `toBeVisible` to exact label text, for the same
shared-element reason as the stall-bundle repoint.

`Timeline`'s `toolCall` arm gained its pending render in [#218](../codebase/218.md): a compact chip —
tool name and one-line input summary — replaces the earlier `case 'toolCall': return null` no-op, at
50% opacity for the unresolved (`result: null`) state. [#230](../codebase/230.md) later taught the
same arm to resolve that chip in place once `result` fills. Both were dormant until
[#179](../codebase/179.md); now live. See
[Pending tool-call row](conversation-shell-tool-rows.md#pending-tool-call-row-218) and
[Resolved tool-call row](conversation-shell-tool-rows.md#resolved-tool-call-row-230) below.
