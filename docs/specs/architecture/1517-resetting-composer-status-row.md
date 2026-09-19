# #1517 — show the reset phases in the composer status row

The render half of the `resetting` family. #1514 decoded the frame, #1515 carried it across IPC, #1516
took the channel-list boolean; this slice gives the composer status row its sixth label and puts the
reset at the top of the row's one-slot order.

## Files read

- `src/shared/wire/types.ts` → `WireResetPhase`, `WireResetHandoff`, `ResettingPayload` — the two closed
  token sets and the three rows the daemon actually emits, plus the standing warning that all sixteen
  `(active, phase, handoff)` combinations decode and a consumer must handle every one.
- `src/shared/ipc/events.ts` → the `resetting` `DaemonEvent` arm — the four fields as they reach the
  window, narrowed not widened, no `daemonTs`, and the contract clause that a consumer must not rely on
  the falling edge arriving.
- `src/main/daemonConnection.ts` → the `resetting` decode arm — confirms `conversationId` is required and
  content-free logging is already in force upstream of this slice.
- `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent` (the dormant `resetting` no-op arm
  whose comment names this ticket as the one expected to flip it) and `timelineTargetFor` (where
  `resetting` currently falls through `default: return null`, so a translated event would route nowhere).
- `src/renderer/src/store/threadTimeline.ts` → `ThreadEvent`, `TimelineState`, `ApiRetryStatus`,
  `reduceTimeline`, `initialTimelineState` — the five chrome scalars, the two-edge `apiRetry` arm this
  one is modelled on, the `sessionBoundary` arm that carries the belt, the `reconnected` reconcile and its
  `nothingLive` predicate, and the full-object-literal arms a sixth required scalar cascades over.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `COMPACTING_COPY` and its four sibling
  constants, `apiRetryLabel` / `thinkingLabel` (the degrade-to-bare-copy idiom), `WorkingIndicatorState`,
  `statusRowCopy`, `ThinkingIndicator`, `ThreadStatus`, `workingIndicatorState`,
  `workingIndicatorStateWithLocalSend`, and the `ComposerSlot.statusArea` mount that builds the record.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer-status`,
  `.composer-status__label`, `--tool`, `--stalled` — confirms the reset label needs no new rule: it takes
  the base label class and the row's inherited `--color-primary`.
- `src/renderer/src/store/conversationTimelineStore.ts` → the held-slice spread, which carries a new
  scalar through with no edit (its own comment says so).
- `e2e/real-claude-new-session.spec.ts` → the single existing `test`, its selector block and its
  Actions-menu reset sequence — where AC5's live assertion goes.
- `docs/knowledge/features/conversation-shell-composer-status-row.md` → the row's geometry, the
  never-returns-`null` posture, the one-text-run rule, and the three-link truncation chain. The lesson
  carried forward: a label added here must change no type, box or line-height, or all six labels stop
  occupying identical space.

**Codegraph was unavailable this run** — `codegraph_context` and `codegraph_status` both returned
`CodeGraph not initialized for this project`, and the symlinked `.codegraph/` holds only `config.json`
and a `.gitignore`, no index. The reading list above came from `Grep` and `Read` instead.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=111-3525

Node `111:3525` is the row this label joins: a `space-between` flex row whose left group is the 14×16
brand mark plus one body-small text run (`M3/body/small`, `--schemes/primary` #32628d, `nowrap`) and whose
right group is the trailing slot. The node draws no reset state of its own — it draws `Thinking...` in
that slot — so the reset label is that same run with different text, taking the existing
`.composer-status__label` class, the inherited primary, and no new CSS rule. No type, box or line-height
changes, so all six labels occupy identical space.

## Context

A reset has two visible phases upstream — claude writes a handoff note (`wrapping_up`), then the daemon
restarts it (`restarting`, carrying whether the note was `written` or `skipped`) — and today the operator
sees neither. The wrap-up turn is a real turn, so the thread's phase is `thinking` or `responding`
throughout it and the row currently reads `Thinking…` across the whole first phase. That is the unnamed
pause this ticket removes, and it is also why the reset takes the **top** of the row's order rather than
any lower position: anything below `thinking`/`working` would be invisible for the phase that matters
most.

No ADR is warranted — this extends `apiRetry`'s and `compacting`'s established two-edge chrome pattern
rather than introducing a new one.

## Design

### `timelineBridge.ts` — two functions, both named by the ticket

`translateTimelineEvent`: `resetting` leaves the no-op group and becomes an owned arm returning a fresh
named-field literal `{ type: 'resetting', active, phase, handoff }`. `conversationId` is **dropped** here
— the filter-plus-fresh-literal discipline every sibling arm follows — so the routing key never reaches
the reducer, the label or the DOM.

`timelineTargetFor`: `resetting` joins the grouped arms that `return event.conversationId`. Without this
the translated event routes to no conversation and never reaches the keyed store. `sessionTransition`
stays at `null`: routing that delimiter by conversation id is a separate deliverable with its own
detector, and this slice does not pre-empt it.

### `threadTimeline.ts` — the sixth chrome scalar

New `ThreadEvent` arm: `{ type: 'resetting'; active: boolean; phase: WireResetPhase; handoff: WireResetHandoff }`.
Two edges, like `apiRetry` and `compacting`, never onset-only like `stallDetected`.

New exported record, the `ApiRetryStatus` shape — presence means a reset is live, `null` means none:

```ts
export interface ResettingStatus {
  phase: WireResetPhase
  handoff: WireResetHandoff
}
```

A record rather than a boolean because the label needs both tokens; `| null` rather than carrying the
wire's `active` because it collapses "not resetting" into one representation and leaves no stale token to
leak from.

`TimelineState` gains `resetting: ResettingStatus | null`. **Required, not optional** — #967's own comment
records that the type is the only detector this repo has here, since every container test renders the
initial store.

Reducer arm `resetting`, `apiRetry`'s arm verbatim in shape:

- falling edge (`!active`): store `null`; a falling edge against no live reset is a same-reference no-op.
  Both tokens are deliberately unread on this path — the wire may repeat anything there.
- rising edge: a record with both tokens unchanged returns the SAME state reference (the daemon repeats
  frames and there is no wire-side dedup); a changed `phase` or `handoff` swaps in a fresh record, which
  is AC2 — the phase advance changes the label rather than reading as a second reset.

**Clear rules — `apiRetry`'s, not `stalled`'s, and that choice is AC3.** `resetting` joins no
turn-activity clear set. The wrap-up turn is a real turn whose deltas, tool rows and turn boundary stream
into the message list exactly as any turn's do; clearing on turn activity would blank the label on the
first delta of the very turn it describes. Three clears, and no fourth:

1. its own falling edge (above);
2. **`sessionBoundary`** — the belt the ticket names. A reset ends in a session rotation, so this is the
   independent trigger the wire contract demands for a daemon killed mid-reset with no falling edge to
   send. The two ride separate producers, so their relative arrival order is **not** pinned and no test
   asserts one; either order leaves the row empty. That arm keeps `sessionTransition` unrouted — the belt
   rides the `sessionBoundary` `ThreadEvent` as it already arrives, on the conversation on screen.
3. `reconnected` — the reconcile arm classifies every chrome scalar, and this is Mode B alongside
   `apiRetry` / `compacting` / `thinkingTokens`: the daemon re-asserts no `resetting` on connect, so a
   record held across a handshake would report a reset that has since finished. `nothingLive` gains a
   sixth clause so a state whose only live chrome is a held reset does not early-out.

`reset` (conversation switch) clears it for free through `initialTimelineState`.

Every remaining full-object-literal arm carries `resetting: state.resetting` unchanged — about seventeen
sites; `tsc` names each.

### `ConversationScreen.tsx` — the label

Three client-owned constants beside `COMPACTING_COPY`, apostrophe-free with the U+2026 character, matching
their five siblings: the wrapping-up copy, the restarting copy, and a bare fallback for a phase token the
daemon never emits. Two suffix constants for the handoff outcome.

`resettingLabel(status: ResettingStatus): string` — `apiRetryLabel`'s sibling, a **total switch over
`phase`** with a nested total switch over `handoff` in the restarting arm. The decoded tokens **select**
which constants are joined and are never themselves interpolated (AC4), so this slice puts no
daemon-supplied string in the DOM at all. The result is **one text run**, per the row's standing rule —
the label ellipsizes as a unit and constant-plus-span would draw two ellipses.

Degrades rather than blanking, `apiRetryLabel(null)`'s and `thinkingLabel`'s posture: `phase: ''` (legal
on the wire, never emitted) returns the bare reset copy, and `restarting` with `handoff` still `pending`
or `''` returns the restarting copy with no suffix. A hostile or buggy daemon must not be able to empty
the status row.

`WorkingIndicatorState` gains `'resetting'` — a sixth **client-owned literal**, so the label choice stays
a closed set of this file's own constants. `statusRowCopy`'s switch is total with no `default`, so the new
member is a `tsc` error until its arm exists; it takes the record as a fourth parameter, the way `retry`
already rides one. `ThinkingIndicator` gains a required `resetting: ResettingStatus | null` prop, on
`toolName`'s and `retry`'s stated reasoning. The reset label is scoped out of the tool-name branch, like
the other three superseding states.

`ThreadStatus` gains `resetting: ResettingStatus | null`, and `workingIndicatorState` reads it **first**:

```
1. resetting  ← new, top of the order (AC3)
2. retrying
3. compacting
4. stalled
5. thinking / working
```

One order in one function, as before. `shouldShowThinking` gains no clause — a second copy of the rule is
exactly the drift that function's comment exists to prevent. `workingIndicatorStateWithLocalSend` is
untouched: statement 1 returns the daemon's answer unchanged, so a reset is never relabelled by a local
send.

The container destructures `resetting` off the `thread` slice it already holds and passes it into both the
record and the prop — no new subscription, no new store read, nothing new across IPC.

### Not touched

`conversationTimelineStore.ts` (its held-slice branch spreads), `conversation.css` (no new rule),
`conversationActivityBridge.ts` (#1516's boolean is a separate consumer of the same event and stays as it
is).

## State + concurrency model

One store, one reducer, one synchronous dispatch per decoded frame — no async work, no timers, no
subscriptions added. The keyed write target comes from the event's own `conversationId`, so a reset for a
conversation that is not on screen lands on that conversation's slice and never on the open one. The
`sessionBoundary` belt is the one arm that files onto the conversation on screen, which is what
`timelineWriteTarget` has always meant for it; that is a known and deliberate asymmetry, not a
misattribution this slice introduces. Nothing here has a teardown path of its own.

## Error handling

No I/O and no new boundary. The failure modes are all "the daemon said something the producer never
emits", and every one degrades to readable copy rather than throwing or blanking: an unknown-to-the-row
phase token, an unresolved handoff during `restarting`, a rising edge with empty tokens, a repeat frame, a
falling edge with no rising one, and a missing falling edge (the belt). `resetting` is a **report, never a
control input**: nothing branches security-relevant behaviour on either token, no path is synthesized from
`handoff: 'written'`, and neither token nor the conversation id reaches a log.

## Testing strategy

Vitest, static renders and pure functions — no DOM, per the repo's node-environment renderer rule.

- `threadTimeline.test.ts`: rising edge holds the record; a repeat returns the same reference; a phase
  advance swaps the record (AC2); the falling edge clears; a falling edge against no reset is a
  same-reference no-op; `sessionBoundary` clears it (the belt); `reconnected` clears it and `nothingLive`
  no longer early-outs on a held reset; **turn activity does not clear it** — an `assistantDelta` after a
  rising edge appends its item AND leaves the record held (AC3's streaming clause).
- `timelineBridge.test.ts`: `translateTimelineEvent` produces the arm with both tokens and **no**
  `conversationId`; `timelineTargetFor` returns the id for it; `sessionTransition` still returns `null`.
- `ConversationScreen.test.tsx`: `workingIndicatorState` returns `'resetting'` ahead of a live retry, a
  live compaction, a stall and a running turn (AC3's order clause); `resettingLabel` over each phase and
  handoff combination including the degrades; the rendered row carries the wrapping-up copy on the first
  edge and the restarting copy with its suffix on the second, and neither after a clear (AC1); the label
  asserts against the exported constants, never duplicated literals. The ~39 existing `ThreadStatus`
  literals each gain `resetting: null`.
- `e2e/real-claude-new-session.spec.ts` (AC5): **inside the single existing `test`**, no new `test` block
  and no new file, so the tier's executed count is unchanged and the gate floor is owed no bump. A
  `MutationObserver` installed immediately before the Actions-menu reset records every label the row
  shows; after the delimiter assertion, one recorded label must start with the reset copy's shared prefix,
  and the row must then be empty. An observer rather than a poll because a poll can miss a phase that
  passes between samples.

**Live acceptance is the dispatcher's, not this run's.** `needs-real-claude` stays on the issue. The gate
needs a `PYRY_BIN` test daemon that actually emits `resetting` (upstream pyrycode#2478); a binary
predating it emits no frame and the new assertion fails for an environment reason rather than a product
one.

## Documentation handoff

**Pending — the documentation stage.** Fold into
`docs/knowledge/features/conversation-shell-composer-status-row.md`, as #1516 did for the channel-list
half: the row's label order is now six deep with the reset label at the top, and the two phases and their
written-or-skipped suffix are named there. Record the observable copy, not the constant names. This
builder makes no edit under `docs/knowledge/`.

## Sizing — one boundary line is exceeded, and the floor is why it ships anyway

Production source files 3, new exported types 1, acceptance criteria 5, reject branches in the label
switch 6 — all inside the table. **Consumer call sites exceed 10**: ~39 `ThreadStatus` literals in
`ConversationScreen.test.tsx` plus ~17 `TimelineState` literals in `threadTimeline.ts`, both counted
directly rather than estimated.

It is not split, and the reason is the one-consumer floor rather than a judgement that the cascade is
cheap. The only seam available is a scalar whose sole consumer is this ticket's own render: a child that
lands `TimelineState.resetting` with nothing reading it could not be verified on its own, and minting it
is what the floor forbids. #967 shipped the identical field-plus-cascade shape as one ticket. Where the
floor and the ceiling disagree the floor wins, so the overage is stated here and the ticket is built.
Split depth was checked first: parent #1497, no grandparent.

## Open questions

1. **`phase: ''` with `active: true`.** Resolved in the design above: it decodes, so the row degrades to a
   bare reset copy rather than blanking or gating the token. Recorded here because the alternative —
   treating an empty phase as "no reset to show" — is the tempting one and is wrong for the same reason
   `thinkingLabel` degrades instead of returning nothing.
2. **Does `reconnected` need the clear?** Taken, as Mode B. That arm classifies every chrome scalar by
   contract, so classifying the sixth is part of the arm rather than a new defence.
3. **Whether the live spec can observe the label deterministically.** The observer shape above is the
   answer; if the real tier shows it cannot, the fallback is a poll with the turn timeout and that
   weakening must be recorded in a `## Revisions` entry, not applied silently.

## Revisions

### 2026-09-19 — live-gate failure and delivery proof

The dispatcher log `2026-09-19T11-11-32-006Z_real-claude-gate_#1517.log` reports
18 passed, one failed and one skipped test. The failure is the reset-label observation in
`real-claude-new-session.spec.ts`, after the real session delimiter appeared.
The configured `PYRY_BIN`, `/Users/juhanailmoniemi/.local/share/pyrycode-desktop-tests/pyry`,
reports `dev-8a850505`. Its source revision is
`8a850505170c4041b852d899f60601c100894fb1` (2026-09-13); it has no `TypeResetting`,
`resettingEmitter` or `resetThenRotate`. The producer landed later in upstream
`bc72445938ff35d7f849fd228215138dbe83858c` (2026-09-16, pyrycode#2478).
The gate log does not itself record the executable revision; these are the configured
binary and its version inspected during this rework.

Keep the production implementation and live assertion unchanged. Extend the existing
fake `composer-new-session.spec.ts` reset drive to send both rising phases through the
real decode/IPC/keyed-store path and assert their visible labels, then prove the session
boundary clears the label. Existing reducer tests retain both completion orders. This distinguishes
missing upstream emission from a client delivery failure without weakening live acceptance.
No new production files, exports, signatures or error branches; approximately 60 lines of
additional test and plan work, no overlapping remote feature branch for either file.

The dispatcher/maintainer must rebuild the dedicated test daemon from a clean revision
containing upstream #2478, record that revision, and rerun the existing real test with
credentials. The builder does not replace the host binary or run the credentialed tier.
The single real test and executed-count floor remain unchanged. Documentation handoff
above remains pending for the documentation stage.

Verification: withholding the reset frames makes the new mounted-row assertion fail;
supplying the two rising frames makes the focused fake spec pass (two tests). The five
existing scoped unit files pass (729 tests), and `npm run build` passes. Listing the real
spec still finds one test; listing is not live execution. No production fix was needed.

### 2026-09-19 — preserve reset-label geometry at minimum width

The verifier measured reset labels wrapping at the supported 800px window width:
restarting grew the 24px row to 32px, or 64px beside the error chip. This disproves
the original assumption that the base label already ellipsizes. Figma `111:3525`
was fetched again: the primary body-small label remains a single nowrap text run,
bottom-aligned with the trailing slot; that slot may independently set the row height.

Add a reset-specific modifier in `ThinkingIndicator` and share the existing
`.composer-status__label--tool` shrink/hidden-overflow/ellipsis/nowrap declarations.
Keep the single text child, existing typography, colour, spacing and row sizing.
No other state, copy, routing or completion contract changes.

Update the reset markup assertion in `ConversationScreen.test.tsx`. Add a focused
fake-transport layout test in `e2e/composer-new-session.spec.ts` for wrapping-up and
both restarting outcomes at 800px and 1280px, with empty and error-chip trailing
slots. Compare row height and composer position to idle, assert single-line
ellipsis and contained label bounds, and capture each state for visual review.
Reset frames traverse the real wire/IPC path; the typed connection error uses the
existing preload-boundary injection pattern from `stopped-turn.spec.ts`.

Rework scope: one TypeScript production file plus its CSS, two test files and this
plan; approximately 120 written lines, no new exports, changed signatures, consumer
cascade or error branches. Remote feature-branch overlap check found no conflicts.
The existing size-floor rationale still applies to the original implementation.
Live acceptance and the documentation handoff remain pending in their owning stages.

Verification: before the fix the new mounted test measured a 32px restarting row
against the 24px idle baseline. After the fix, all 389 `ConversationScreen.test.tsx`
tests, the three focused fake reset tests and `npm run build` pass. All twelve
layout cases preserve the 24px row and idle composer position. Captures under
`/tmp/builder-1517-reset-layout/reset-{800,1280}-{empty,error}-{pending,written,skipped}.png`
use 800×572 and 1280×572 content viewports (600px outer window height). Visual review
against Figma `111:3525` confirms the existing mark, primary colour, body-small type
and spacing, with a single ellipsis at narrow widths and full outcome copy at 1280px.

### 2026-09-19 — isolate post-reset liveness from the handoff turn

The latest PASS review identifies a nonblocking false-positive path in
`real claude restarts on Reset session and the turn stream survives it`: the handoff
turn can increase the assistant count after the pre-reset baseline, satisfying the
closing assertion without a response to the second message. Capture the baseline
after the delimiter, empty status label and enabled Send button, immediately before
the second message. Require the assistant count to increase over that new baseline.
Keep the existing single test, reset-label observation and executed-count floor.
Also include a live reset record in `toolProgress.test.tsx`'s existing superseding-state
table, addressing the earlier review nit that elapsed tool time must not alter reset copy.

The subsequent dispatcher log `2026-09-19T11-52-08-458Z_real-claude-gate_#1517.log`
again reports 18 passed, one failed and one skipped, with the failure at the reset-label
observation after the delimiter. The configured dedicated executable still reports
`dev-8a850505` when inspected during this rework. This is the same unmet producer
prerequisite described above; the test correction does not claim to fix that failure.
The maintainer/dispatcher must supply the updated daemon, record its revision and
rerun the credentialed gate. No live execution is performed by this builder.

Scope: two existing test files and this plan, approximately 45 written lines;
zero production files, exports, signature changes, consumer updates or error branches.
No remote feature branch overlaps these files. Codegraph remains uninitialized.
Verification: scoped unit tests, build, focused fake reset spec, and collection of the
single real test; collection does not establish live acceptance. No production or
visual contract changes. Documentation handoff remains pending as specified above.

Results: all 730 tests across the five scoped unit files pass, `npm run build` passes,
and all three focused fake reset tests pass. Real-spec collection reports one test
in one file. The changed live assertion awaits dispatcher execution with the updated
daemon; no live pass is claimed.
