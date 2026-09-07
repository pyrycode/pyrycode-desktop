# 1214 — a message sent mid-turn is drawn once: fold the queued backlog into the thread

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ConversationScreen` (the container's
  `selectOpenBacklog` / `queuedBacklog` read and the `<QueuedBacklog>` mount beside it), `Timeline`,
  `TimelineRow` (the `userText` arm), `BubbleMeta`, `QueuedBacklog`, `DROP_QUEUED_LABEL`,
  `useThreadScrollPin` — every symbol this ticket moves, deletes or re-points.
- `src/renderer/src/store/threadTimeline.ts` → `ThreadItem` (the `userText` member and its `messageId`
  field), `reduceTimeline`, `TimelineState` — the item shape the fold reads. **Not modified**: no queued
  item is written through the reducer (the architectural line `queue-store.md` § What it does draws).
- `src/renderer/src/store/queueStore.ts` → `selectBacklogFor`, `useQueueStore`, `EMPTY_BACKLOG` — the
  replacement-truth backlog holder; the container's read stays exactly as #1009 left it.
- `src/shared/wire/types.ts` → `QueuedItem` (`queued_msg_id`, `text`, `ts`, `message_id?`),
  `DequeueMessagePayload`'s docblock — the ungated-control-frame ruling that makes an unmatched row's
  drop control legitimate.
- `src/renderer/src/screens/conversation/composerSend.ts` → `submitMessage` — mints `message_id` once and
  uses it twice (wire frame + echo `messageId`), the correlation this ticket consumes. **Not modified.**
- `src/renderer/src/screens/conversation/dropQueuedMessage.ts` → `dropQueuedMessage`,
  `DropQueuedMessageDeps` — the drop helper the merged row's control calls, unchanged.
- `docs/specs/architecture/1213-drop-queued-message-removes-echo.md` § Open questions 1 and
  § Security review 2/3 — the two things #1213 hands forward by name and this plan settles.
- `docs/knowledge/features/queue-store.md` § What it does / § How it works — `queue_state` is daemon
  state, never folded into `reduceTimeline`; the store holds `QueuedItem` verbatim by reference and
  replaces a key's backlog wholesale, which is what makes AC5 fall out of the render rather than out of
  reconciliation state.
- `src/renderer/src/screens/conversation/conversation.css` → `.conversation__thread`,
  `.conversation__queued`, `.queued-row__drop*` — the thread's `gap: --space-3` / `padding: --space-2
  --space-4` are **byte-identical** to the region's, so merged rows keep the region's exact rhythm with
  no new spacing rule.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the `QueuedBacklog` describe, the
  three cross-cutting `<QueuedBacklog>` renders (meta-row absence, time-slot absence, attachment-row
  absence) and the region-absence container smoke — the eight render sites the deletion re-points.
- `e2e/queued-backlog-interrupt.spec.ts` → `queuedRow`, `queuedBubbles`, `deliveredEcho` — the fake-tier
  twin whose container-scoped locators lose their container.
- `e2e/real-claude-queue-drop.spec.ts` → `queuedRow`, `queuedBubbles`, `deliveredEcho` — the four #1213
  echo assertions the ticket names, two of which become false and cannot redden (`testIgnore`d tier).
- `e2e/thread-scroll-pin.spec.ts` → `queuedRows` and the "chrome shrinks the viewport" criterion — the
  reader whose *subject* this ticket removes, not just its selector.
- **`e2e/user-whitespace.spec.ts` → `queuedBubble`, the AC4 queued-row block — a reader the ticket's
  "known readers" list does not name.** It selects `.bubble[data-thread-role="queued"]` and asserts
  "a queued bubble carries no meta row, so its box is a different constant height from a delivered
  bubble's". That sentence is a live constraint on this ticket's meta-row ruling (§ Design 4).

## Design source

**Figma:** N/A — echoed from the ticket. The design file draws no queued or pending message state (node
102-4's Message area has only delivered containers, tool rows and the session-reset delimiter, and no drop
control anywhere), a gap long documented against #148/#294/#296. This ticket invents no visual: the
"waiting" treatment is the shipped within-token 50% opacity and the control is the shipped
`.queued-row__drop`; both simply move onto the timeline row. The verifier's visual-fidelity check is
intentionally skipped.

## Context

A message sent while claude is working is drawn **twice** — once by `submitMessage`'s unconditional
optimistic `userText` echo in the timeline, and once by `QueuedBacklog` from the daemon's `queue_state`
snapshot. Two independent writers, near-identical rows, one message. #1213 established the correlation
(`QueuedItem.message_id` ↔ the echo's `messageId`) and used it to fix the drop's worst symptom; this
ticket uses the same key to make the two rows one.

The fold is **render-time**. `queueStore` keeps holding the wire `QueuedItem[]` verbatim as replacement
truth and nothing is written through `reduceTimeline` — the architectural line `queue-store.md` states.
What changes is that the view reads both and derives one row list. That is also why AC5 is nearly free:
replacement truth means the next snapshot re-derives everything, so there is no reconciliation state to
get wrong and no orphan to clean up.

No ADR is warranted: this adds one pure helper and two optional props to an existing view, following the
`scrollPin` optional-prop precedent already recorded in `Timeline`'s own header. If the documentation
phase disagrees, the decision worth recording is § Design 2's "the fold synthesizes a `ThreadItem` rather
than widening `ThreadItem` with a queued kind" — stated here so that phase can write it.

### Size — the line ceiling is knowingly exceeded, and the floor is why

Two production source files (`ConversationScreen.tsx`, plus the new `foldQueuedRows.ts`) against a ceiling
of five; `conversation.css` and every `*.test.tsx` / `e2e/` file are outside the count. Three new exported
names (`foldQueuedRows`, `FoldedRow`, `QueuedRowHandle`) against five, and `QueuedBacklog` is deleted, so
the module's exported surface grows by two. Five acceptance criteria. No state machine and no reject
branches. Consumer call sites needing simultaneous update: **10** — `QueuedBacklog`'s one production
mount, its one test import and its eight test render sites — at the boundary, not past it; `Timeline`'s
two new props are OPTIONAL per its own `scrollPin` ruling, so all 72 renders in `ConversationScreen.test.tsx`
and the one in `interactiveRoundtrip.test.tsx` stay green untouched.

Total written work runs to roughly 1100 lines against 800, most of it the e2e/renderer selector sweep
rather than new logic. The only seam available is the pure fold helper, whose single consumer is the
render in the same file — it ships nothing observable and could not be verified on its own, so the floor
merges it back. The other candidate seam (matched rows first, unmatched later) is worse than either end:
it would leave the app drawing the same concept in two places at once and pay the selector sweep twice.
Split depth is not the reason — #1214's parent is #1075 with no grandparent, so a split was on the table
and is declined on the floor. Precedent: `docs/specs/architecture/995-attachment-reassembly-and-store.md`
§ Sizing, ~1200 lines against the same ceiling, not split, floor over ceiling.

## Design

### 1. The fold is a pure function beside the screen — `foldQueuedRows.ts`

```ts
export interface QueuedRowHandle { queuedMsgId: number; messageId: string | undefined }
export interface FoldedRow { item: ThreadItem; queued: QueuedRowHandle | null }
export function foldQueuedRows(
  items: readonly ThreadItem[],
  queued: readonly QueuedItem[]
): readonly FoldedRow[]
```

A pure function of its two inputs with no store, no clock and no React, so both the queued and the
delivered form are unit-testable from markup under `renderToStaticMarkup` (the repo's node-environment
constraint). Contract:

- **Every timeline item appears exactly once, at its own index, in order.** The fold never reorders,
  never drops and never duplicates a timeline row. That is AC1's ordering and AC3's "stays where it is"
  by construction rather than by convention.
- **A backlog item correlates to at most one echo, and an echo to at most one backlog item** — a greedy
  one-to-one assignment walking the backlog in snapshot order against a `messageId → indices` index built
  once from `items`, consuming each index as it is claimed. Two identical texts with distinct ids claim
  two distinct rows (AC4); the pathological same-id-twice case claims first-come and leaves the second
  unmatched rather than double-marking one row.
- **Only a non-empty `message_id` on both sides participates.** `undefined` and `''` correlate with
  nothing, matching #1213's field contract. This is the *first* guard in this path, not a redundant
  second one — #1213 put its empty-id rule at `dropQueuedMessage`, which this consumer does not go
  through.
- **Only `kind === 'userText'` items are candidates.** No other row kind can be marked queued by any
  input. This is enforced by the type system rather than by a filter — `messageId` lives on the `userText`
  arm of `ThreadItem` alone — but it is stated as a contract because it is the guard that keeps a hostile
  `queue_state` from putting the operator's own queued treatment onto daemon-authored content
  (§ Security review 4).
- **A backlog item that claims no echo becomes its own row at the tail**, in snapshot order, after every
  timeline row (AC4's "draws its own queued row rather than attaching itself to somebody else's").
- The comparison is `===` on strings only. `message_id` is never a `Map` key, a lookup path, a React key
  or a rendered value — see § Security review 1.

Complexity is O(items + queued): one pass to index, one to assign. Both lists are small, but the shape is
chosen so a long thread does not pay per queued item.

### 2. An unmatched queued item is synthesized into a `userText` item, not a new `ThreadItem` kind

The tail rows carry `{ item: { kind: 'userText', text: q.text }, queued: {...} }`. Synthesizing rather
than widening `ThreadItem` with a seventh kind is deliberate, and the reasons are ranked:

1. **It keeps `queue_state` out of the timeline's type system.** `ThreadItem` is the reducer's vocabulary;
   a `queued` kind there would invite the next ticket to reduce one, which `queue-store.md` forbids. The
   synthesized value is a *view* value that never touches a store.
2. **It gives both merged forms one render path.** A matched row and an unmatched row differ only in
   which fields the item happens to carry, so "the two rows look like the same thing" is structural.
3. **`TimelineRow`'s exhaustive switch stays a six-arm compile-time guard** for real timeline kinds.

The synthesized item carries `text` and nothing else — no `createdAt` (the wire `ts` has never reached the
renderer and this ticket does not start), no `attachments`, no `messageId` (this window minted none, and
an id it did not mint must never look like one it did).

### 3. `Timeline` gains two OPTIONAL props; every existing render site is untouched

```ts
Timeline({ items, scrollPin, queued, onDropQueued }: {
  items: readonly ThreadItem[]
  scrollPin?: ThreadScrollPin
  queued?: readonly QueuedItem[]
  onDropQueued?: (queuedMsgId: number, messageId: string | undefined) => void
})
```

OPTIONAL for exactly the reason `Timeline`'s own header already records for `scrollPin`: a required prop
is a 72-site edit cascade in `ConversationScreen.test.tsx` alone, seven times the size table's call-site
ceiling. Absent `queued` folds against an empty backlog and yields today's rows byte-for-byte.

`Timeline` calls `foldQueuedRows` and maps `FoldedRow[]`. Two consequences inside it:

- **The empty-thread branch moves from `items` to the folded rows.** `if (rows.length === 0) return
  <EmptyThread />`. Today a window with no echoes but a non-empty backlog draws the empty-state
  invitation with queued rows underneath it — reachable from a reconnect into another device's backlog,
  and from a conversation opened fresh here. After the fold that combination draws the queued rows.
- **Keys fork.** Item rows keep the array index and its recorded rationale (append-only, tail mutation,
  never inserts or reorders — still true, because the fold never moves an item row). Tail rows key on
  `` `q${queued_msg_id}` `` — a real per-conversation unique integer, the key `QueuedBacklog` already
  used, and a string key that cannot collide with a numeric index. `message_id` is never a key.

`onDropQueued` keeps **two positional values**, resolving #1213 § Open questions 1 as it stood: the view
is handed exactly what the drop needs and never `text` or `ts`, and the conversation-id wall is unchanged
— the container still owns the conversation id, the view still never sees one.

### 4. `TimelineRow`'s `userText` arm forks on `queued`, and that fork is the whole visual change

| | queued (`queued !== null`) | delivered |
|---|---|---|
| row class | `message-row message-row--user message-row--queued` | `message-row message-row--user` |
| `data-thread-role` | `queued` | `user` |
| drop control | leading sibling of the bubble, `.queued-row__drop` | none |
| `<BubbleMeta>` | **suppressed** | rendered |
| attachments | rendered | rendered |

The modifier is **APPENDED, NEVER PREPENDED** — `ConversationScreen.test.tsx`'s user-row assertion is a
`toContain('message-row message-row--user')` on the whole run, which survives a suffix and would break on
a prefix.

**The meta-row ruling: suppressed while queued.** The ticket asks for a decision and either answer is
defensible; this one is chosen on three counts. It keeps #969's shipped reasoning true word for word
("nothing sent yet to copy, and no time") rather than reversing it — a queued message has not been
delivered, so a delivered-at timestamp would be a claim the row cannot make. It makes the matched and
unmatched forms identical in chrome, which is the ticket's stated goal, without inventing a meta row on a
row that has no time to show. And it keeps `e2e/user-whitespace.spec.ts`'s "a queued bubble carries no
meta row, so its box is a different constant height" true with no edit — a reader the ticket's list
misses, whose height-delta control depends on it. The two shipped assertions the ticket names
(`ConversationScreen.test.tsx`'s meta-row and time-slot absences on `QueuedBacklog`) are **re-pointed**
at the merged queued form, not retired: they keep asserting the same fact about the same row.

Attachments stay drawn on a matched queued row. They are message *content*, not chrome: the files are
uploaded and the message is queued with them, so drawing what this window knows is honest. An unmatched
row has no attachments to draw because the wire item carries none — that is a difference in what is
known, not an inconsistency in treatment.

**No turn-phase gate.** The treatment is a pure function of "is this message in the backlog the daemon
last reported", never of `isTurnRunning(phase)`. The idle flash and the reconnect clear are the daemon's
honest report of its own state; gating on the phase would be a defence for an unobserved failure mode
(the ticket's ruling, inherited).

### 5. The container: one mount deleted, two props added

`<QueuedBacklog items onDrop>` is deleted and its `onDrop` closure — unchanged, including the
`openConversationId === null` guard and the interaction-time `window.pyry.sendCommand` deref — moves onto
`<Timeline queued={queuedBacklog} onDropQueued={…}>`. The `selectOpenBacklog` / `queuedBacklog` read stays
exactly where #1009 put it; the ticket's "no new subscription" holds literally.

`QueuedBacklog` and its `.conversation__queued` region are removed, together with the two empty-region
comments (`ConversationScreen.tsx`'s notes on the deliberately-empty strip around the backlog and the
mount #1009 left there). `DROP_QUEUED_LABEL` survives and moves to the row.

### 6. CSS: the compositing group moves to the row, not to the bubble

`.conversation__queued` is deleted. Its `opacity: 0.5` becomes `.message-row--queued { opacity: 0.5 }`.

#294 sketched "moving `opacity` onto a future `bubble--queued` modifier is a one-line relocation"; that
sketch predates #296 making the drop control a **sibling** of the bubble inside the row. A bubble-level
opacity would leave the button at full brightness, which is exactly the compositing group the region's own
comment says a child opacity cannot escape. The row is the smallest element that contains both, so the row
is where the dimming goes and the rendered result is pixel-identical to today's.

Everything the region contributed besides the dimming is already the thread's: `.conversation__thread`
declares the same `gap: var(--space-3)` and `padding: var(--space-2) var(--space-4)`, so merged rows keep
the rhythm with no new rule. `.queued-row__drop*` survives unchanged; only its "it inherits the region's
50% dimming" sentence is rewritten to name the row modifier. The three prose mentions elsewhere in the
file cite `.queued-row__drop` as a focus-ring idiom and stay true.

### 7. The scroll pin: an inventory correction, and one criterion loses its subject

`useThreadScrollPin`'s inventory lists `.conversation__queued` as the strip's first occupant, mounted and
grown by a screen render. That entry is deleted: the backlog's growth is now the timeline's own content
growth, below the reader, which is precisely the case #1049's ResizeObserver was built for (it observes
the container **and each direct child**, and merged rows are direct children of `.conversation__thread`).
The container's backlog read is retained and its comment re-pointed — it still makes a `queue_state` a
render of this screen, which still re-asserts the pin; the *reason* changes from "the region's height" to
"the thread's rows".

`e2e/thread-scroll-pin.spec.ts`'s "chrome shrinks the thread's viewport" criterion has now lost its
subject for the third time (working indicator → stall block → queued backlog), and this time there is no
replacement occupant to move it to: of the strip's remaining members the status row is fixed-height and
moot, and #963's 8px error slot needs a terminal connection error this spec has no reason to stage.
Rather than leave it pointing at something that shrinks nothing — the exact vacuity its own comment warns
about — the two assertions are re-pointed at what the same `queue_state` pushes now do: **append rows
inside `.conversation__thread` and grow it below the reader**, with the mount and the growth still
asserted separately so a fix keyed on emptiness fails the second. The comment records plainly that the
shrink category is now uncovered and what driving it would cost, so the next ticket inherits the fact
rather than rediscovering it.

### 8. The drop's two clocks now land on one row — and the transient is accepted, not defended against

The ticket rules that the merged row inherits #1213's pair as it stands: the **echo** leaves at the click
(optimistic, this window's own write) and the **queued row** leaves on the daemon's next snapshot
(non-optimistic, #296 AC3). Before this ticket those were two different rows, so the pair was invisible.
Folded onto one row it is not: between the click and the confirming snapshot the echo is gone while the
backlog still holds the item, so the fold finds it **unmatched** and draws it as a tail row. The message's
row appears to hop to the bottom of the thread for one relay round trip, then vanishes.

Every alternative is closed by a shipped ruling, and they are worth listing so the next reader does not
re-derive them. Removing the queued row optimistically reverses #296 AC3, which the ticket puts out of
scope by name. Removing the echo when the item leaves the backlog is a diff-driven removal, which AC4
forbids for a good reason — a backlog also shrinks when the daemon *drains* it, so a diff would delete the
echo of every message that ran normally. Holding a pending-drop set keyed by `message_id` across the async
boundary is the ledger #1213 § 4 reason 3 rejected, with no timeout value anyone has.

So it is accepted, on the ticket's own rule for exactly this shape: the idle flash and the reconnect clear
are tolerated because they are the daemon's honest report of its own state, and building a defence for an
unobserved failure mode is the thing not to do. This transient is the same class, is bounded to one relay
round trip, and is strictly display. If it turns out to be visible and objectionable, that is its own
ticket with the observation attached — and the fix that ticket would reach for is making the queued row's
departure optimistic, which is a reversal of #296 AC3 and therefore a decision, not a patch.

An **unmatched** row's drop has no such transient: it dispatches `dropUserText` for an id no echo carries,
`reduceTimeline` returns the same state reference, and the row leaves on the snapshot as it always did.

## State + concurrency model

No new store, no new slice, no new subscription, no async work, no timer and no listener. The fold is a
synchronous pure function evaluated during render from two values the screen already holds. There is no
`await` anywhere in the path, so there is no check-then-act gap, nothing to cancel and no teardown to
define; the existing `AbortSignal` discipline governs the transport, which this ticket does not touch.

The two inputs are written from the same synchronous daemon-event dispatch (`queueStore` from
`subscribeQueue`, the timeline from `timelineBridge` / `submitMessage`), so a render never sees a torn
pair — it sees whichever pair the last commit produced, and both are replacement or append truth.

AC5's replacement case is structural: a fresh snapshot replaces the backlog wholesale, the screen
re-renders, and the fold re-derives every row from scratch. The empty snapshot a reconnect clears to is
the same path with `queued = []` — every matched row silently becomes a delivered row and every unmatched
row disappears, with no orphan possible because nothing is remembered between renders.

## Error handling

There is no I/O, no IPC and no parse in this change, so there is no new failure mode and no result type to
define. The three degenerate inputs are all *legal values*, handled in the fold and named in its tests:

- **A queued item with an absent or empty `message_id`** — correlates with nothing, draws its own tail row
  with a working drop control (`dequeue_message` is an ungated control frame; the daemon owns whether the
  drop lands).
- **A queued item whose id matches no echo in this window** — the same, and it is the *expected* shape for
  a message sent from mobile or seen after a reconnect, not an error.
- **An echo with no `messageId`** — never matched, so a future history-backfilled message can never be
  marked queued by somebody else's snapshot.

The drop's own error handling is `dropQueuedMessage`'s and is unchanged: a bridge failure is caught,
logged content-free and never propagated, and it suppresses the echo removal. Nothing new is logged; no
`message_id`, `queued_msg_id` or `text` reaches a log line, per the repo's content-free-logging rule.

## Testing strategy

**vitest, node environment, static server renders.** The fold is a pure function and the row is a pure
function of it, so both forms are provable from markup; every transition and every click belongs in `e2e/`.

- `foldQueuedRows.test.ts` (new) — the correlation contract as scenarios: an empty backlog returns rows
  1:1 with `queued: null` (the untouched-today case); a matched id marks that item and only it; **two
  identical texts with distinct ids mark two distinct rows, and marking the first leaves the second
  correctly attributed** (AC4); an `undefined` id and an `''` id on either side correlate with nothing;
  an unmatched item lands at the tail in snapshot order, after every timeline row; several unmatched
  items keep snapshot order among themselves; a same-id-twice backlog claims first-come and leaves the
  second unmatched; a matched item keeps its index when timeline rows follow it (AC3's "stays where it
  is"); non-`userText` kinds are never candidates.
- `ConversationScreen.test.tsx` — `Timeline` renders with `queued`: one row per message and never two
  (AC1); the queued row carries `data-thread-role="queued"` and `message-row--queued` while the delivered
  row carries `"user"` and does not (AC1's "by an attribute or class, never by position or container");
  the drop control rides the queued row and **only** queued rows, with its client-owned accessible name;
  the same item folded against an empty backlog draws the delivered form at the same index (AC3); a
  non-empty backlog with **zero** items draws the queued rows and **not** `<EmptyThread />`; untrusted
  `text` renders escaped; `.conversation__queued` appears in no render at all (AC5's region-gone half).
  The three cross-cutting `<QueuedBacklog>` renders (meta row, time slot, attachment row) and the
  `QueuedBacklog` describe are re-pointed onto `Timeline` with `queued`, keeping every assertion's
  subject; the container smoke test's region-absence claim is retained as a permanent guard.
- `e2e/queued-backlog-interrupt.spec.ts` (fake tier) — the container-scoped locators lose their
  container and re-point at `.conversation__thread`. The spec's own #1213 machinery (reading the client-
  minted `message_id` off the captured envelope and planting it in the pushed `queue_state`) is what
  makes the merged row reachable at all, so the correlation is asserted end to end: after the push, the
  mid-turn message draws **exactly one** row and it is the queued one; after the drop, no row for it and
  the control echo untouched. The existing positive `dequeueFramesMatching(...) === 1` poll stays in
  front of every absence.
- `e2e/thread-scroll-pin.spec.ts` — § Design 7's re-point, mount and growth still separate.
- `e2e/user-whitespace.spec.ts` — its `.bubble[data-thread-role="queued"]` selectors keep working
  unchanged (the role survives the fold); re-read to confirm, not re-pointed.
- `e2e/real-claude-queue-drop.spec.ts` (real tier, `testIgnore`d — **updated by reading, never by
  running**) — the two role-scoped assertions the ticket names are now contradictory, and the tier cannot
  redden to tell us. Rewritten to the merged truth: msg2 draws exactly one row before the drop and it
  wears the queued role (so the pre-drop `deliveredEcho(msg2) === 1` becomes a **one-row** assertion over
  both roles, which is AC1 stated against a real daemon); after the drop, no row for msg2 in either role,
  with the existing `queuedBubbles` 1 → 0 mutation as the positive wait in front of it; msg1's delivered
  echo still 1. No new `real-*` spec file — the count is already 14 against a floor of 13.

Fakes over mocks at the transport boundary; the fold takes plain values and needs neither.

## Open questions

1. **Does the drop callback take two positional values or the whole `QueuedItem`?** (#1213 § Open
   questions 1, handed forward by name.) Resolved in § Design 3: **two**, unchanged. The fold now stands
   between the store and the row, so the row never holds a `QueuedItem` at all — it holds a
   `QueuedRowHandle` the fold minted, which carries exactly the two values and cannot leak `text` or `ts`
   back down and up. That is a stronger version of #1213's answer, not a reversal of it.
2. **Does the meta row stay on a matched queued row?** Resolved in § Design 4: suppressed. Recorded here
   because the alternative is defensible and a future design pass for a real queued state may revisit it.
3. **Does re-pointing the scroll-pin shrink criterion leave it non-vacuous?** § Design 7 argues yes for
   what it now tests (growth below the reader) and states plainly that the shrink category is uncovered.
   Confirm during implementation that the re-pointed assertions actually fail with the pin disabled; if
   they cannot be shown failing, record that here rather than shipping a green assertion that proves
   nothing.
4. **Is the drop's tail-hop transient (§ Design 8) visible in practice?** Not measured — the fake tier's
   loopback answers in the click's own frame, so it cannot be observed there, and the real tier has no
   frame-level timing. Accepted unobserved per the ticket's own rule. If a later observation contradicts
   that, § Design 8 names the ticket it becomes.

## Security review

**Verdict:** PASS

**Findings:**

**1. [Trust boundaries] No new boundary; two untrusted fields reach a new sink and each keeps its
contract.** Nothing in this change parses wire bytes — `parseQueuedItem` (main process) remains the single
narrowing point and `queueStore` holds the result verbatim. What moves is the *sink*: `QueuedItem.text`
and `message_id` now reach a row inside `.conversation__thread` instead of a row inside
`.conversation__queued`. `text` keeps its posture exactly — auto-escaped React children, never
`dangerouslySetInnerHTML`, never an attribute, a URL, a filename or a log. `message_id` is read for strict
string equality only, inside `foldQueuedRows`, and is never a `Map` key, a lookup path, a rendered value
or a React key; #1213 § Security review 1 states that as the field's contract and this consumer inherits it
unchanged rather than re-deriving it. The one *new* consumer of an untrusted value is `queued_msg_id` in a
React key (below).

**2. [Trust boundaries] `queued_msg_id` is template-interpolated into a React key — bounded, and unchanged
in kind.** Tail rows key on `` `q${queued_msg_id}` ``. The value is narrowed to `number` by #292's
fail-closed decode, React keys are never rendered and never become attributes, and the string namespace
cannot collide with the numeric index keys the item rows use. A hostile daemon sending two items with the
same `queued_msg_id` produces a duplicate-key warning and an unstable reconcile **among the tail rows
only** — `QueuedBacklog` has that exact exposure today (it keys on the same field), it cannot reach an item
row, and the failure is a mis-drawn queued row rather than a lost or altered delivered one. Named rather
than defended: a uniqueness check here would be a client-side second-guess of the only authority on what
is queued.

**3. [Electron / IPC attack surface] No new surface, and the container's bridge-free render is preserved.**
No `contextBridge` API, `ipcMain` channel, `webPreferences`, protocol handler, navigation guard or
window-open path is added or altered. The `dequeue_message` command and its payload are byte-identical to
today's, sent through the same `dropQueuedMessage` helper with the same guard. `window.pyry.sendCommand`
stays dereferenced **inside the click closure**, never during render, which is what keeps the container
smoke render bridge-free — the fold introduces no render-time deref of its own. The process wall is
untouched: no key, socket or raw byte moves, and `foldQueuedRows` is renderer-pure with no import from
`src/main/`.

**4. [Threat model — hostile daemon] The drop control's "delivered rows are unreachable" guarantee changes
from structural to conditional, and the compensating guard is typed.** Before this ticket, no code path
could put a drop control on a delivered row because only `QueuedBacklog` rendered the button. After the
fold that becomes a condition — `queued !== null` on a row `foldQueuedRows` marked. Two consequences,
both examined:

- *A fold bug* could mark a delivered row, giving it a control that sends `dequeue_message` with some
  `queued_msg_id`. That is a correctness risk, not an escalation: the id comes from the daemon's own
  snapshot, so the daemon can only cause itself to drop a message it already named. It is covered by
  `foldQueuedRows.test.ts`'s "a matched item folded against an empty backlog draws the delivered form"
  and "an id that correlates with nothing marks nothing" scenarios.
- *A hostile daemon* can claim a delivered message's `message_id` in a `queue_state` item — the capability
  #1213 § Security review 2 identified and explicitly handed here. Under the fold its effect changes
  shape: instead of adding a fake queued row **beside** the delivered bubble, it makes the delivered row
  itself wear the queued treatment. That is a small increase in display-deception capability and it is
  bounded to display — the row keeps its text, nothing is removed from the transcript, and the only wire
  effect is the `dequeue_message` the operator chose to click. A daemon in that position already streams
  arbitrary assistant text into the thread, so this stays strictly below its existing capability, and
  #1213's conclusion holds verbatim: no client-side check can distinguish the case, because the daemon is
  the only authority on what is queued. **Not a MUST FIX.**

The free half of the mitigation *is* taken: § Design 1 restricts candidacy to `kind === 'userText'`, so no
daemon-authored row (assistant text, a tool row, an unrecognized-output row) can ever be made to wear the
operator's own queued treatment or acquire a drop control, no matter what a snapshot claims.

**5. [Threat model — hostile / degraded relay] #1213's deferral is narrowed, not discharged, and the
remainder stays out of scope.** #1213 § Security review 3 deferred stale-snapshot replay to "#1214's
merged-row design where the two rows can no longer disagree". The *disagreement* class is closed by
construction — there is one row, so there is nothing to disagree with. What remains is that a stale or
replayed `queue_state` can make an already-run message draw as queued (finding 4's second bullet by
another route). That needs an on-path adversary plus an operator click, cannot be distinguished
client-side, and belongs to the wire's replay protection rather than to a renderer fold. **OUT OF SCOPE**,
restated here so the deferral does not read as resolved; it is picked up by whatever ticket addresses
`queue_state` freshness at the protocol layer, and no such ticket exists today.

**6. [Concurrency] No async, therefore no cancellation, race or shutdown surface — and the fold's purity
is what guarantees it.** `foldQueuedRows` is a pure function of two immutable inputs, evaluated during
render. It launches no task, sets no timer, registers no listener, holds no module state and reads no
shared state across an `await` because there is no `await`. It is idempotent and referentially transparent
by construction, so a double render, a StrictMode double-invoke and a re-entrant snapshot all produce the
same rows. The two inputs are written from the same synchronous daemon-event dispatch, so no render can
observe a torn pair. Nothing outlives the window.

**7. [Error messages, logs, telemetry] Nothing new is logged, and the one existing line stays
content-free.** This change adds no log call. `dropQueuedMessage`'s `console.error('drop queued message
send failed', error)` is untouched and still names the category only — no `message_id`, no
`queued_msg_id`, no `text`, no conversation id. `text` and `message_id` are barred from logs on the same
terms as every other relayed value, per the repo's content-free-logging rule.

**8. [Network & I/O] No network code, and the existing bound still covers the new render cost.** No socket,
no frame, no timeout, no TLS decision and no reconnect path is added or changed. The only resource
question the fold raises is render cost for a large backlog: it is O(items + queued) with one `Map`, and
the inbound snapshot is already bounded by the relay socket's `maxPayload` / `maxFrameBytes`, which is the
same deterministic bound that governs `QueuedBacklog` today. Adding a per-render row cap would defend an
unobserved failure mode behind an existing bound.

**9. [Tokens, secrets, credentials] Not applicable, by design decision.** No secret, token or key is read,
minted, stored or compared. `message_id` is a `crypto.randomUUID()` value already travelling on the wire
inside `send_message` by design, and no security property rests on its unguessability — an attacker who
can guess one is already the daemon, which is finding 4, bounded there.

**10. [File / storage operations] Not applicable.** Nothing is written to or read from disk, no path is
built from any value, `safeStorage` is not touched, and no renderer web storage (`localStorage`,
`sessionStorage`, IndexedDB) is used — this change is entirely in-memory renderer render state, cleared
on exit and at a pairing boundary like the stores it reads.

**11. [Cryptographic primitives] Not applicable.** No primitive is added, selected, re-implemented or
configured; no RNG is called; no comparison is made against a secret, so `crypto.timingSafeEqual` has no
subject here. The `message_id` equality is a display-correlation compare over a non-secret value, and a
constant-time compare would misrepresent it as one.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-07

## Revisions

### 2026-09-07 — Open question 3 resolved with a measured gate rather than a disabled pin

The plan said to confirm the re-pointed scroll-pin criterion is non-vacuous by showing it fail with the pin
disabled. That experiment turns out not to isolate anything: neutering `reassertPinnedToBottom` reddens the
three earlier legs of the same test (assistantText, toolCall, sessionBoundary) before the queued leg is
reached, so a red proves nothing about *this* criterion.

What the criterion actually risks is the opposite mistake, and it is checkable directly. #967/#1009 tested a
viewport **shrink**, which moves `clientHeight` and leaves `scrollHeight` alone; what #1214 leaves is content
**growth**, which does the reverse. A re-point that kept measuring the old quantity would pass against a
thread nothing happened to. So `e2e/thread-scroll-pin.spec.ts` now reads the thread's metrics either side of
the `queue_state` push and asserts the growth clears a floor (`QUEUED_GROWTH_FLOOR_PX`, 50 — well under two
rows, well over the zero a fold that silently drew nothing would produce) while `clientHeight` is unchanged.
That is a permanent self-evidencing guard rather than a one-off experiment, and it makes the fact the
criterion depends on measured rather than asserted. Confirmed green. The shrink category remains uncovered
by that suite, as § Design 7 states.

### 2026-09-07 — `QueuedRowDrop`, a module-private component the plan did not name

The drop control moved onto the timeline row as a small module-private component beside `TimelineRow`
rather than as JSX inlined into the `userText` arm, which was already the longest arm in the switch. Not an
exported name, so § Size's count is unchanged; the markup it emits is byte-identical to the deleted
`QueuedBacklog`'s.

### 2026-09-07 — the comment sweep reached four sites the ticket's "known readers" list did not

Deleting `QueuedBacklog` and `.conversation__queued` falsified four comments that describe the region's
behaviour without naming either symbol, so no identifier grep finds them: `dropQueuedMessage.ts`'s module
header (its caller), `BubbleMeta`'s "no injected effect, unlike QueuedBacklog's required `onDrop`", the
container's "the event changes the height of a region this screen lays out around a pin it owns", and two
`conversation.css` rules that explain the user bubble's shadow and whitespace treatment in terms of "the
region's 50% opacity". Found with a multiline concept grep rather than a symbol grep; all four corrected in
place. `e2e/user-whitespace.spec.ts` — a reader absent from the ticket's list, recorded in § Files read —
needed only the same prose correction: its `data-thread-role="queued"` selectors and its "a queued bubble
carries no meta row" height control both survive § Design 4's ruling untouched, which is confirmed green.
