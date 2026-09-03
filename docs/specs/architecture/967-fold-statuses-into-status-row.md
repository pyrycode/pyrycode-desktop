# #967 — fold the retry, compacting and stall statuses into the status row

One line above the message box says what claude is doing. Today four facts compete for that job across
four surfaces: the working label lives in the status row (#796), while the API-retry (#493), compaction
(#496) and stall (#317) statuses still render as loose bubble blocks between `Timeline` and the queued
backlog. This folds the three into the row's single label slot, deletes their views and their CSS, and
gives the four facts one precedence order in one pure function.

Operator ruling, Juhana 2026-09-02: the three loose statuses go into the status row.

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` — the whole surface. `ThinkingIndicator`
  (the label the four states fold into), `ComposerStatusArea` (the row), `ThreadStatus`,
  `shouldShowThinking`, `workingIndicatorState`, `workingIndicatorStateWithLocalSend`, `openToolName`,
  `isTurnRunning`, `toolWorkingCopy`, and the three views being deleted — `StallIndicator`,
  `ApiRetryIndicator`, `CompactingIndicator` — plus the container's mount block and its five-scalar
  destructure of `thread`.
- `src/renderer/src/screens/conversation/conversation.css` — `.composer-status`, `.composer-status__activity`,
  `.composer-status__label`, `.composer-status__label--tool` (the truncation chain and its measured
  configurations), and the seven rules being deleted. Also the four *unrelated* comments that cite the
  deleted class names as precedent anchors (see § Deletions).
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` — the three retiring `describe`
  blocks, the `it` #609 owns that loses three assertion pairs and keeps one, the inert-smoke trio, the
  32 `ThreadStatus` literals, and the container's status-row smoke test (the one at the top of the
  `ConversationScreen — store binding` block that asserts no `conversation__thinking` and no
  `composer-status__label` against the initial store).
- `e2e/stall-bundle.spec.ts` → `stallFrame`, and its two `.conversation__stall` / `.bubble--stall`
  assertions — the stall's only other e2e home.
- `e2e/thread-scroll-pin.spec.ts` → `turnStateFrame`, `stallFrame`, `primeOverflowingThread`'s
  non-vacuity gate, and the fourth criterion — the spec that pins AC2's idle-independence by construction
  and the one place a vacuous re-point is easy to write.
- `e2e/queued-backlog-interrupt.spec.ts` → `queueStateFrame` — the builder the fourth criterion's new
  subject needs, taken verbatim.
- `docs/knowledge/features/conversation-shell-turn-status.md` §§ "Thinking / working indicator",
  "Api-retry indicator", "Compacting indicator", "Stall indicator" — the four surfaces' recorded designs.
  Two lessons that shape this ticket: the supersede relationship is carried by `workingIndicatorState`
  reading the scalars and **never by DOM adjacency** (which is why it survived #796 unchanged and why
  this fold changes precedence without touching the store), and the stall/thinking co-render posture was
  deliberate and is what one slot ends.
- `docs/knowledge/features/conversation-shell-composer.md` § "Composer status row" — the row's own
  contract, including the two shipped heights.
- `CLAUDE.md` — renderer tests are static server renders (`environment: 'node'`, no DOM, nothing can
  click), so every assertion here is markup or a pure call; daemon text may be rendered escaped and
  length-bounded, never into an attribute, a URL or a log.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=111-3525

The status area is a single row, end-aligned, `space-between`: on the left the 14x16 snowflake and one
label (`111:3523`, `Thinking...`, M3 body/small, Schemes/Primary) 8px past it; on the right the slot,
drawn here holding #963's `Pairing error - Re-pair` button, which is what makes the rendered node 741x32.
The design draws **one** label and nothing else in that region — the four states inherit its position,
its type and (except the stall) its colour. The stall's `--color-error` modifier is this ticket's own
call, drawn nowhere in Figma; flagged for Juhana in the PR rather than decided silently.

## Context

#796 built the row and scoped the other three statuses out to stay `size:s`, writing "folding them in is
a coherent follow-up". Nobody filed it, so the region between the thread and the composer still holds
three null-at-rest bubble blocks that each say what the row is for. The design draws one row with one
label; this closes that gap.

Nothing about the store, the wire, the reducer or IPC changes. The three scalars (`stalled`, `apiRetry`,
`compacting`) are already destructured at the container's top beside `phase` and `localSendPending`; all
that moves is which component consumes them and what the label says.

No ADR is warranted — this is a precedence rule inside one screen, and the seam it grows (`ThreadStatus`
as a record so a superseding status is "one field, one clause") was designed for exactly this in #493 and
already used once by #496.

## Design

### The order

The row's label slot holds one string, so the four facts need a precedence. Two of the four positions are
already shipped behaviour: `workingIndicatorState` returns `null` today when a live retry or compaction
is up, so those two replacing the working label is not new. What this ticket decides is where the stall
sits, and that the three superseding states outrank an open tool name.

| Order | State | Label |
| --- | --- | --- |
| 1 | `'retrying'` | `API_RETRY_COPY`, plus ` attempt N/M` when `total > 0` |
| 2 | `'compacting'` | `COMPACTING_COPY` |
| 3 | `'stalled'` | `STALL_COPY`, in `--color-error` |
| 4 | `'thinking'` / `'working'` | the shipped label, tool-named when a tool is open |

Retry outranks compaction because the two never overlap in practice and a re-attempted call is the more
urgent read; both outrank the stall because they are live rising/falling-edge signals while the stall is
a one-shot onset with no clearing frame. The stall outranks working because "may be stuck" is the more
useful of two compatible facts while it lasts. Reversible: it is one ordering in one pure function.

### The two things one slot forces beyond the order

**The three folded statuses stay ungated on a running turn.** All three views render off their own scalar
alone today, and `thread-scroll-pin.spec.ts` pins that by construction — it pushes its stall onto a turn
the primer already returned to `idle` and asserts the stall renders. So the three early returns go
**above** the `shouldShowThinking` gate, not inside it. Only the thinking/working label is turn-gated.

**The tool name belongs to state 4 alone.** `ThinkingIndicator`'s shipped label picks
`toolName !== null ? toolWorkingCopy(toolName) : …`, i.e. the name wins over the state. That is safe today
only because a live retry or compaction makes `state` null and the component returns before reaching the
label; after the fold `state === 'retrying'` with a tool still open is reachable and the shipped
precedence would render the tool name where the table says `API_RETRY_COPY`.

### Grow the shipped seams

- **`ThreadStatus`** gains `stalled: boolean` — the record #493 wrote so a superseding status is one
  field here and one clause below, extended a second time by #496 and a third time here.
- **`WorkingIndicatorState`** widens from `'thinking' | 'working'` to
  `'thinking' | 'working' | 'retrying' | 'compacting' | 'stalled'`. Still a closed union of client-owned
  literals, still not `TurnPhase` and still not `string` — the label CHOICE stays a type-level guarantee,
  which is the half of #648's contract #649 narrowed but did not drop.
- **`workingIndicatorState`** derives the order: three early returns on the scalars, then the shipped gate
  and the shipped two-way phase choice.
- **`shouldShowThinking`** keeps its signature, its `boolean` return and **both supersede clauses
  textually untouched.** It answers one narrower question after this ticket — whether the *working* label
  shows — and its two clauses are now dominated by the early returns above it in the only caller. They
  stay because they are #493's and #496's standing regression evidence and because the predicate is
  exported and independently tested; its docblock says so, and says that the four-way precedence lives in
  `workingIndicatorState`, not here. It gains **no** `stalled` clause: a second place holding the stall
  rule is exactly the drift #650's comment exists to prevent.
- **`workingIndicatorStateWithLocalSend`** keeps its shape and its local-send window on top. It inherits
  the new order for free through the same re-call, with one behaviour change that falls out of the order
  rather than being written: where a live retry used to make it return `null`, it now returns `'retrying'`
  from the first branch. That is AC2 — the retry label shows with no turn running.

**Why the fourth field rather than another wrapper.** #650 composed a wrapper instead of taking a fourth
`ThreadStatus` field, and its comment argues against the field. That reasoning does not carry here, and
the difference is the precedence position: #650's local-send window is a *lower*-priority fallback, which
composes on top of a proven gate without restating it. A stall sits in the *middle* of the order, so a
wrapper would have to re-read `apiRetry` and `compacting` itself to choose between `'retrying'`,
`'compacting'` and `'stalled'` — putting the supersede facts in two places. One record, one function, one
order. That paragraph of #650's comment gets rewritten so the next reader does not find the code
contradicting its own docblock.

### The label

`ThinkingIndicator` keeps its identity (`.conversation__thinking` beside `.composer-status__label`), its
single-return shape and its `state === null → null` posture. Two prop changes:

- `state: WorkingIndicatorState | null` — the widened union.
- `retry: ApiRetryStatus | null` — **new, required, `| null`**, carrying the counter's two integers the
  way `toolName` carries the one daemon string. Required rather than optional for `toolName`'s own recorded
  reason: an optional prop lets the container silently omit it and nothing in this repo could catch that,
  since every container test renders the initial store, so `tsc` is the only available detector and the
  type must be the one that fails. Two numbers and no string field, so the view still structurally cannot
  receive a daemon string in this prop.

The counter is interpolated into the label's **single text run**, not carried in its own span.
`ThinkingIndicator`'s comment is explicit that one text run ellipsizes as one unit and that two would
render two ellipses; `.api-retry__counter` goes with the rest of the deleted CSS. Shown iff `total > 0`,
two client-formatted integers, never a division — the shipped `showCounter` rule, moved.

Label derivation, as contracts rather than bodies:

- a module-private `statusRowCopy(state, retry): string` — a total `switch` over the five members
  returning the client-owned constant for each, with the retry arm appending the counter. No `default`,
  so a future member is a `tsc` error rather than a silent fallthrough.
- a module-private `apiRetryLabel(retry): string` — `API_RETRY_COPY` alone when `retry === null` or
  `total <= 0`, else `` `${API_RETRY_COPY} attempt ${current}/${total}` ``. The `null` arm is a degrade,
  not a defence: the container derives `'retrying'` from `apiRetry !== null` and passes the same record,
  so it is unreachable from the container — but the type admits it and the bare copy is the honest answer.
- inside the component, one `const toolLabel = isWorkingState && toolName !== null ? toolWorkingCopy(toolName) : null`
  drives **both** the label and the `--tool` modifier, so "the name belongs to state 4" is one expression
  rather than two agreeing conditions. `label = toolLabel ?? statusRowCopy(state, retry)`. No `!`, no cast
  — the narrowing is on the condition itself.

The class attribute keeps its shipped order and appends at most one modifier:
`conversation__thinking composer-status__label`, plus ` composer-status__label--tool` in state 4 with a
name, or ` composer-status__label--stalled` in state 3. The two modifiers are mutually exclusive by
construction: `toolLabel` is null in every superseding state.

### The copy constants

`STALL_COPY` moves beside `API_RETRY_COPY` and `COMPACTING_COPY`, all three relocating into the label-copy
cluster directly after `toolWorkingCopy`, and `STALL_COPY` becomes an **export** so tests stop asserting
its literal. Their current homes are above the three views being deleted; left there they would be
orphaned constants floating in the gap. Grouped, the five labels the one slot can carry are reviewable in
one place — which is the reason `composerSend.ts`'s `COMPOSER_ERROR_CHIP_COPY` comment gives for living
where it does, and that comment's reference to "where THINKING_COPY / STALL_COPY live" stays true.

Each constant moves **with its own docblock, as one unit**. A docblock binds to the declaration that
follows it, so a move that separates the two silently orphans both — verified after the edit, not assumed.

### The stall's colour

`.composer-status__label--stalled` sets `color: var(--color-error)` and nothing else. The label inherits
`--color-primary` from `.composer-status__activity`; retry and compaction keep it, which is the only colour
the design draws. `--color-error` is the only error-role token on desktop, so this is within-token: no new
token, no literal. Colour-only means AC4 holds by construction — no type, box or line change, so no state
can move the row.

The icon keeps turning on the raw phase (`isTurnRunning`), exactly as #796 ruled.

### Deletions

Views: `StallIndicator`, `ApiRetryIndicator`, `CompactingIndicator`, their three mounts and the three
mount comments.

CSS, seven rules: `.conversation__stall`, `.bubble--stall`, `.conversation__api-retry`,
`.bubble--api-retry`, `.api-retry__counter`, `.conversation__compacting`, `.bubble--compacting`.

**Four CSS comments in unrelated rules cite the deleted class names as precedent anchors and are NOT
touched** — the blockquote treatment, the muted-text argument, the token argument and
`.create-folder__error`. Those are history and reasoning that stay true, and this file's convention
already keeps such citations after the class is gone (one of them cites `.bubble--thinking`, retired by
#796 and absent from the stylesheet). The single exception is the blockquote block's leading-accent-bar
count: it counts the idiom "four times" and lists the four, two of which go away, so that count, its list
and the neighbouring clause about a blockquote reading "as a stall or a compaction" go stale together.
Fix those and nothing else in that block — the contrast measurements and the bar-only argument stand.

### Comments to true up — six

1. The three mount comments — deleted with their mounts.
2. `ComposerStatusArea`'s mount block — it still says the three indicators keep their own mount sites and
   that their precedence rule is not reopened, and that during a retry or compaction "the icon keeps
   turning beside no text".
3. `shouldShowThinking`'s docblock — it states twice that the statuses co-render. One slot ends that at
   the function whose result now picks between them.
4. `ComposerStatusArea`'s docblock — "a turning icon beside no text is a legal, expected render" becomes
   **unreachable**: the icon turns on `isTurnRunning(phase)`, and whenever that holds the label is
   non-null (retry, compacting, stalled, or thinking/working). Say that the fold closes the state rather
   than deleting the paragraph; that closure is the point.
5. #650's paragraph in `workingIndicatorStateWithLocalSend`, per the ruling above.
6. `.composer-status`'s comment — its opening paragraph lists what the row replaced, and the row now also
   replaces #317's, #493's and #496's blocks. Its leftover "fixed-height row" phrasing is in the sentence
   being rewritten either way. Nothing else in that block is this ticket's: the `780x24` is the Figma
   node's own size and the min-height / end-alignment reasoning is #963's.

## State + concurrency model

No store slice, no subscription, no async work, no effect and no teardown path changes. The container
already destructures `items, phase, stalled, apiRetry, compacting, localSendPending` from one `thread`
object; `stalled` simply joins the record handed to `workingIndicatorStateWithLocalSend`, and `apiRetry`
is passed a second time as the label's `retry` prop rather than to a deleted view.

Re-render behaviour is unchanged and slightly narrower: three components that each re-rendered on their
own scalar collapse into one that already re-rendered on `phase` from the same `thread` read.

The reducer's clearing semantics are untouched and stay asymmetric — retry and compaction clear only on
the daemon's explicit falling edge, the stall self-clears on the next turn activity. `thread-scroll-pin`
keeps proving the last of those end-to-end.

## Error handling

No I/O, no IPC, no parse and no failure mode: this is a pure label derivation over scalars the store
already holds. Two degrade paths, both total rather than defended:

- `state === 'retrying'` with `retry === null` (unreachable from the container, representable in the type)
  renders the bare `API_RETRY_COPY`.
- `total <= 0` omits the counter entirely — the shipped rule, which covers the documented `0/0`
  unknown-count sentinel and suppresses a meaningless denominator on an undocumented `N/0`. Never
  `current / total`, which is `NaN` at `0/0`.

`statusRowCopy`'s `switch` has no `default`, so an added union member fails `tsc` rather than rendering
nothing.

## Testing strategy

Renderer specs are static server renders, so the order, AC2's idle-independence and the error modifier
are all markup assertions on the pure label plus pure calls on the two derivations. Interaction and
layout live in the Playwright fake tier.

**vitest — grows**

- `ThinkingIndicator`: the three new states each render on the same element with the same base classes;
  `STALL_COPY` carries `--stalled` and the other four do not; the retry counter is visible in the static
  render at `total > 0` and absent at `0/0`, with no `NaN` and no second span; the tool name is outranked
  in all three superseding states (AC1's tool clause) and still wins in state 4; the five copies stay
  lexically distinct, apostrophe-free and client-owned (AC5); the hostile-tool-name escaping case stands
  verbatim.
- `workingIndicatorState`: the four-way order, including retry-over-compaction and stall-over-working; and
  AC2 — each of the three at `phase: 'idle'` returns its own state, never `null`.
- `workingIndicatorStateWithLocalSend`: the four "inherits the supersede rule" cases now assert the
  superseding **label** rather than `null` — same facts, one slot later. The delegation, flicker-free-seam
  and no-stop-variant cases stand verbatim.
- `shouldShowThinking`: unchanged except the 32-literal retype; its assertions stay the standing evidence
  that the fold did not weaken #493's and #496's rules.
- The `it` #609 owns keeps `ThinkingIndicator`'s pair and loses the other three, title included — a
  rewrite, not a retirement. The two assertions resting on the counter having its own span retire with it.

**vitest — retires**

The three view `describe` blocks, the three `MODIFIER` / `CONTAINER` pairs, and the inert-smoke trio. The
trio's coverage is subsumed, not dropped: the container's status-row smoke test already asserts no
`conversation__thinking` and no `composer-status__label` against the initial store, which is the same
"nothing renders at rest" claim for all four states at once. A note there records that.

**e2e — two specs**

- `stall-bundle.spec.ts`: the two `.conversation__stall` / `.bubble--stall` assertions become one
  exact-text assertion on the row's label. Exact, so it proves the label says the stall rather than
  merely being present.
- `thread-scroll-pin.spec.ts`, two separate repairs:
  - The **fourth criterion** — chrome mounting between the thread and the composer shrinks the viewport
    without un-pinning it — moves onto the **queued backlog** (`.conversation__queued`), a region of
    dimmed rows and so tens of pixels, the magnitude the criterion's comment asks for. #796 already
    re-pointed it once, off the working indicator and onto the stall block, precisely because a label
    inside an already-present row shrinks nothing; this ticket takes the stall block away too. #963's row
    growth is not the subject: it is 8px, and driving it needs a connection error the spec has no reason
    to stage. This needs one new fixture, a `queueStateFrame` builder taken verbatim from
    `queued-backlog-interrupt.spec.ts`; the `daemon.pushFrame` machinery is already there.
  - The **stall self-clear** assertions discriminate on the label's **text**, not its presence. After the
    fold the stall renders the same element as the working label, so a `toBeVisible` after the stall push
    would read current state rather than which frame mounted it — vacuous, the exact failure the primer's
    zero-count gate exists to prevent, one state later. Two exact-text assertions instead.
  - `turnStateFrame`'s docblock and the primer's non-vacuity comment both explain the old arrangement and
    move with it. The primer's own zero-count gate stays and stays load-bearing: it is what makes the
    stall label *mount* rather than be found already there.

No other e2e file is affected. `queued-backlog-interrupt.spec.ts` uses `.conversation__thinking` as a
liveness gate but pushes only `queue_state` and `turn_state`, so nothing there reaches the three folded
states; the `stall` / retry / compaction frame types appear in no other spec.

**Gate:** `npm test` on the touched files plus `npm run build`. The full suite, the Playwright fake tier
and the docs gate are the verifier's.

## Size — the stated overage

Six boundaries, re-counted against this written plan:

| Limit | Boundary | This ticket |
| --- | --- | --- |
| Production source files (`*.ts`/`*.tsx` under `src/`, tests excluded) | ≤ 5 | **1** — `ConversationScreen.tsx` |
| Total written work | ≤ 800 | **~900 — over** |
| New exported types / interfaces / components / stores | ≤ 5 | **0** (one union widened, one interface widened, one existing const exported) |
| Consumer call sites needing simultaneous update | ≤ 10 | **32 — over** |
| Acceptance criteria | ≤ 5 | **5** |
| Distinct error / reject branches | ≤ 10 | **0 new** |

Two lines exceed and **neither splits**, on the floor rule rather than on judgement. The 32 call sites are
the `ThreadStatus` literals in `ConversationScreen.test.tsx` (`grep -c 'compacting:'` = 32) — one token
each, all in one file, every one named by `tsc`. The only real seam is (A) fold retry + compacting, which
needs no new field, then (B) fold the stall, which adds `stalled` and carries **all 32 retypes into child
B**: the split relocates the overage instead of resolving it, at the cost of a second refine / build /
verify / document cycle and a second rewrite of the same JSX region. The slice that *would* isolate the
cascade — "add `stalled: boolean` and retype 32 fixtures" — lands nothing, reddens nothing and is
verifiable on nothing, which is below the floor, and the floor wins over the ceiling. The refiner measured
this independently of the previous builder leg and reached the same answer.

Not dodged with an optional field: an optional `stalled` is exactly the silent-omission hole `toolName`'s
comment refuses, and the type is the only detector this repo has, since every container test renders the
initial store.

The production diff is net negative. The bulk of the written work is this plan, the six rewritten comment
blocks and the 32 one-token retypes.

Per the ticket: if this run overruns the budget, that is the first real data point for re-measuring the
800-line number, and the run's turns and duration belong on the ticket rather than a retroactive split.

## Open questions

1. **Does Juhana want the stall's error colour, and should the retry state share it?** Built as the table
   is written — stall in `--color-error`, retry and compaction in the row's primary. Drawn nowhere in
   Figma, so it is this ticket's own call; flagged in the PR, not decided silently. Reversible in one CSS
   rule and one modifier.
2. **The label still has no live region.** A screen reader announces neither the label appearing nor its
   text changing between four states — carried forward from #215, logged as a NIT by #493's review and as
   an open question by #796. This fold makes the label change more often, which sharpens it without
   changing it. Still deferred: a live region beside a rotating icon is its own a11y decision and no AC
   has ever covered it.
3. **Retry versus compaction ordering is asserted, not observed.** The two never overlap in practice, so
   the tie-break has no evidence behind it beyond "a re-attempted call is the more urgent read". One line
   in one function if that turns out wrong.

## Revisions

### 2026-09-03 — three departures from the plan above, found in Phase B

1. **The `ThreadStatus` literal count is 30, not 32.** The ticket's figure came from
   `grep -c 'compacting:'` on the test file, which counts two prose lines that mention the field name
   inside `describe` comments. `tsc` named 30 literals and no more. Nothing about the sizing argument
   changes — 30 is still three times the 10-call-site boundary, and the floor rule is why it does not
   split — but the number in § Size is the grep's, and this is the compiler's.

2. **`thread-scroll-pin.spec.ts`'s fourth criterion needed a two-step shape, not a re-point.** The plan
   said the criterion moves onto the queued backlog. It does, but a one-for-one swap fails, and the
   failure is informative: `useThreadScrollPin`'s re-assert is a dep-free layout effect that runs on
   **screen** renders, and `QueuedBacklogControl` holds its own queue-store subscription — so a
   `queue_state` push re-renders that control alone and the pin never runs. Measured: the thread rests
   116px off the bottom. The criterion is now shrink (queue push), then a following screen render (the
   stall push) that must still re-pin. That is the claim the criterion's own comment always stated — the
   tracked flag survives a shrink because no scroll event fires — and separating the two steps makes it
   *sharper* than the shipped version, which conflated them: the stall block arrived through the timeline
   store, so its shrink and its re-render landed in the same tick and could never distinguish "the flag
   survived" from "this render re-asserted". A production glue that re-measured at arrival time instead
   of tracking a flag fails the two-step sequence and passed the one-step one.

3. **That shrink-without-re-pin is a pre-existing bug, filed as #1009, not fixed here.** It is out of this
   ticket's scope under the scope-discipline rule: the fix is a production change to a file this diff does
   not otherwise touch. `useThreadScrollPin`'s docblock also names the queued backlog in its list of
   "mounts that ARE a re-render here", which is the one item on that list with a subscription of its own,
   so the inventory is stale where the reasoning is sound. Both go in #1009. The spec asserts only the
   two-step claim and carries a comment pointing at the ticket; nothing is skipped and nothing is red.

One other thing worth recording, since it changed an assertion rather than a design: after the stall
self-clears, the working label comes back **tool-named** (`Running read_file…`), because the spec's
`tool_use` push is never resolved and #649's derivation still answers. The assertion says so rather than
steering around it — the stall outranking that same open tool while it lasts, then yielding to it, is
this ticket's precedence visible end to end on one element.

## Security review

**Verdict:** PASS

The applicable adversary here is a **hostile or buggy daemon inside an established Noise session** — the
one actor whose data this ticket moves. It controls three things that can reach the row: a `tool_use`
name (already rendered by the shipped label), `api_retry`'s two integers (rendered by a view being
deleted), and the *timing* of the four states. Everything else in the checklist is structurally out of
reach: this ticket adds no IPC channel, no bridge API, no file, no socket, no key material, no log call
and no async work. Findings by category:

- **[Trust boundaries] No findings — and one boundary confirmed rather than assumed.** The only
  untrusted-to-trusted crossing in play is already built and unmoved: `parseApiRetryPayload` in
  `src/main/transport/inboundMessage.ts` narrows the frame with `requireNumber` on both `current` and
  `total`, throwing `WireDecodeError` on a mistyped field, so by the time the renderer holds an
  `ApiRetryStatus` those two fields are **guaranteed JS numbers, not daemon strings**. That matters
  specifically because this ticket interpolates them into a template string. It was checked rather than
  trusted, since the whole no-daemon-string guarantee of the retry prop rests on it.
- **[Trust boundaries] No finding — the label's daemon inputs stay separately typed.** `state` remains a
  closed union of client-owned literals; the one daemon string rides `toolName`, the two daemon integers
  ride `retry: ApiRetryStatus | null` (two numbers, no string field). A single preformatted-string prop
  would have collapsed the distinction — explicitly not the design.
- **[Network & I/O] No finding, with the bound measured.** The template interpolation removes `.bubble`'s
  wrapping backstop from the counter, and the row's one-line truncation rides the `--tool` modifier,
  which the retry state does not get. So: can a daemon widen the row through the counter? No — a JS
  number stringifies to at most 24 characters (`-1.7976931348623157e+308`), bounding the whole retry label
  at roughly 80 characters against the ~99 the 640px pane fits at body-small. A hostile value is
  ugly, not overflowing. If an oversized counter is ever *observed*, the cheap fix is the one-line
  ellipsis bound the tool state already carries; adding it now would be a defence for an unobserved
  failure mode, and moving those declarations onto the base class would change three shipped states'
  wrapping for no measured reason.
- **[Error messages, logs, telemetry] No findings — nothing here logs, and that is preserved.** The four
  status surfaces emit no diagnostic events today and this ticket adds none; the frame-level logging in
  `parseApiRetryPayload`'s caller is content-free (byte length plus one-way hash) and untouched. No
  daemon value reaches a `console`, a log file or an error string.
- **[Electron attack surface] No findings.** No `contextBridge` API, no `ipcMain` channel and no
  `webPreferences` change. The renderer's read of `stalled` / `apiRetry` / `compacting` already exists in
  the container's single `thread` destructure. Deleting three components strictly *reduces* renderer
  surface; nothing crypto, socket or token-shaped comes near it.
- **[File / storage, Tokens, Cryptographic primitives] Not applicable — no state leaves memory.** This is
  a pure derivation over store scalars into markup: no path, no filesystem call, no persisted value, no
  secret, no randomness, no comparison against a secret.
- **[Concurrency] Not applicable.** No async task, no timer, no listener, no subscription and no teardown
  path is added or changed; the fold removes three render paths and adds none.
- **[Threat model — hostile daemon: markup injection] No findings.** The tool name reaches the DOM only
  as an auto-escaped React text child, exactly as #649 shipped it: no `dangerouslySetInnerHTML`, no
  `title`, no `aria-label`, no `data-*`, no URL, no filename, no cache key. AC5 pins it and the
  hostile-name escaping test carries over verbatim. The `'stalled'` and `'compacting'` arms interpolate
  nothing at all — those frames carry no daemon content past the bridge.
- **[Threat model — hostile daemon: prototype pollution] No finding.** Nothing indexes an object by a
  daemon-controlled key; `statusRowCopy` switches over the closed client-owned union, and the decoder
  already returns a fresh field-by-field literal rather than copying unknown keys through.
- **[Threat model — hostile daemon: suppression] OUT OF SCOPE, accepted by the operator's ruling.** One
  slot means a daemon that pins `api_retry{active: true}` now suppresses the *stall* label too, where
  before the two co-rendered on separate surfaces. This is a loss of information, never of function: the
  icon still turns on the raw phase, the timeline still streams, and the same daemon could already
  suppress the working label this way through #493's shipped supersede rule. It is inherent to "one
  label, one order" rather than a defect in it, and is the trade the 2026-09-02 ruling makes knowingly.
  No follow-up ticket is proposed; if the operator wants a second, non-superseded surface, that reverses
  the ruling rather than patching this design.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-03
