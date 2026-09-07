# 1225 — join the newest history page to the live stream with no gap and no duplicate

The last slice of the #1088 family. #1259 landed the opening ask, #1260 the scroll-back walk; this one
makes the two lanes meet. Half the key is already in the tree (`HistoryTimelineEntry.ts`, kept there
deliberately for this ticket) and half is missing — no typed daemon event carries a wire timestamp. So
this is two joined halves: carry the envelope's `ts` down to the emit, then join on it.

## Files read

| File | Symbol | Why it matters |
|---|---|---|
| `src/shared/wire/types.ts` | `Envelope` | `ts: string` is required on every envelope, so the value is always there to carry. |
| `src/shared/ipc/events.ts` | `HistoryTimelineEntry` | Holds the page half of the key (`ts`), and its docblock names this ticket as the reason. |
| `src/shared/ipc/events.ts` | `HistoryTimelineEvent` | The page's per-entry event union. Its `type` tags are field-for-field the live `DaemonEvent` tags for the ten arms — that identity is what makes `type` half of one key rather than two vocabularies to map between. |
| `src/shared/ipc/events.ts` | `ServerOrigin`, `WithOrigin`, `StampedDaemonEvent` | #1068's shape: an intersection distributed over the union, never a member per arm. The Technical Notes tell me to read it before choosing a shape; it is the shape I take. |
| `src/main/emitDaemonEvent.ts` | `bindServerOrigin`, `emitDaemonEvent` | Where #1068's stamp is applied at BIND time — which is exactly why the per-frame `ts` cannot ride that value and must come from the decode. |
| `src/main/transport/inboundMessage.ts` | `InboundDaemonMessage`, `parseInboundMessage` | The envelope is in scope here and nowhere downstream; the ten timeline-bearing arms return decoded payloads only, so the thread has to cross this file. |
| `src/main/daemonConnection.ts` | the ten emit arms (`assistant-delta` … `unrecognized-message`) | The fresh-literal-with-named-fields idiom each emit follows, and the ten sites the stamp lands on. |
| `src/renderer/src/store/timelineBridge.ts` | `translateTimelineEvent`, `timelineTargetFor`, `subscribeTimeline`, `useTimelineBridge` | The live lane. `subscribeTimeline` is where the live key can be computed from the event before translation drops the fields; `useTimelineBridge` is the fan-out that reaches the keyed store. |
| `src/renderer/src/store/timelineBridge.ts` | `subscribeTimeline`'s `now?` parameter (#1013) | The optional-trailing-parameter idiom this plan reuses three times: a required parameter cascades over every call site, an optional one over none. |
| `src/renderer/src/store/historyPageBridge.ts` | `reduceHistoryPage`, `subscribeHistoryPage`, `useHistoryPageBridge` | The page lane. `reduceHistoryPage` is the fold the join must sit ahead of; its docblock already records that an entry's `ts` is the daemon's real timestamp and that wiring one is a separate change — this is that change. |
| `src/renderer/src/store/conversationTimelineStore.ts` | `ConversationSlice`, `dispatchFor`, `prependHistoryFor`, `withoutHeldEchoes` | Where the live key set belongs (beside `history` and `prependedRows`, dying with the slice), and the existing prepend-time filter the new one must not be confused with. |
| `src/renderer/src/store/conversationTimelineStore.ts` | `withoutHeldEchoes` | The operator's own echo, deduped on `messageId`. A DIFFERENT key for a DIFFERENT duplicate; neither widens to cover the other. |
| `e2e/real-daemon-history-on-open.spec.ts` | its closing `toHaveCount(1)` on `markerBubble` | AC5's live proof. The marker is the operator's own `message` entry, which has no live twin, so the join must be structurally unable to touch it. |
| `docs/knowledge/features/conversation-history-page.md` | § the drawing half | Prior tickets' lessons for this area. |

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4171

Read on 2026-09-08. The `Message area` is a single vertical column of alternating containers — assistant
bubbles left-aligned on the panel ground, operator bubbles right-aligned in the accent fill, each closing
with a timestamp-and-copy footer — broken by a full-width `Session reset` rule and, below the fold, a
tool-use row. There is no merge seam, no "loaded from history" divider and no per-row provenance mark
anywhere in the node. **This ticket adds no chrome.** The only thing the operator sees change is a count:
one row where there were two.

## Context

A client that has just opened a conversation asks for the newest page of history and receives the live
stream at the same time. An entry appended between the ask and the answer arrives on both lanes, and so
does one the client had already drawn live before the ask went out. Today both draw:
`prependHistoryFor` is deliberately non-idempotent and its own comment says the general answer needs the
entry-level join key this ticket owns.

The key is (`type`, `ts`) because the daemon mints one timestamp per logical event above the
per-connection fan-out and hands that same value to the log entry and to every outbound envelope. The
alternatives are ruled out upstream and restated here only to be refused: the entry's `id` is the durable
on-disk log id and the live lane has no such field; `event_id` is the in-memory ring's, per-process and
reset by a restart; `turn_id` + `seq` exists only on turn-scoped payloads, and `session_transition` — the
one type the log is the only retention for — carries none. Never text.

No ADR is warranted. This adds no new architectural boundary; it threads one already-decoded wire field
through an existing channel and adds one pure filter to an existing bridge.

## Design

### The stamp — main side

**`Envelope.ts` reaches the decode result.** `parseInboundMessage` already has the envelope in scope and
returns per-kind arms. The ten timeline-bearing arms gain the envelope's `ts` verbatim through a named
intersection:

```ts
/** The `ts` of the envelope this arm was decoded from — the daemon's per-logical-event timestamp. */
interface FrameTimestamp { ts: string }
```

applied inline as `& FrameTimestamp` to exactly the `assistant-delta`, `turn-end`, `turn-state`, `stall`,
`api-retry`, `compacting`, `tool-use`, `tool-result`, `session-transition` and `unrecognized-message`
arms of `InboundDaemonMessage`. Ten arms, not 39: the union's declaration order and its header narrative
are preserved, each arm visibly opts in at its own site, and one docblock states the contract once.

`history-page` does NOT gain it. A page's `ts` is per-ENTRY and already on `HistoryTimelineEntry`;
stamping the envelope that carried the page would put the answer's own clock where the entries' belong.

**Ten emits gain one field.** Each of the ten arms in `daemonConnection.ts` adds `daemonTs: inbound.ts`
to its existing fresh literal — copied by name, never a spread, following the `assistant-delta` idiom the
neighbouring arms cite. `connected` has no envelope behind it and gains nothing. `messageReceived` stays
out of scope: this client maps a live `message` frame onto that arm, but the daemon pushes none on the
interactive lane, so its only duplicate is the optimistic echo `withoutHeldEchoes` already handles on
`messageId`. That exclusion is what makes AC5 structural — see Testing strategy.

### The stamp — IPC shape

`DaemonEvent` gains the timestamp as **an intersection distributed over the union**, #1068's shape
exactly, not a member added per arm:

```ts
interface DaemonEventTimestamp { daemonTs?: string }
type WithDaemonTs<E> = E extends unknown ? E & DaemonEventTimestamp : never
```

with the existing union declaration renamed to a private base and `DaemonEvent` exported as
`WithDaemonTs<…>`. Three properties follow, and they are the reason for this shape over ten per-arm edits:

- **Zero cascade.** The field is OPTIONAL, so the 33 test files that build bare `DaemonEvent` literals as
  bridge INPUTS still compile — the same arithmetic that made #1068 one slice instead of three.
- **Readable off the bare union.** `event.daemonTs` resolves on any `DaemonEvent` with no per-arm switch,
  so the renderer needs no second enumeration of the ten arms to drift from the emit's.
- **`emitDaemonEvent` and `DaemonEventSink` are untouched** — their parameter is already `DaemonEvent`.

`StampedDaemonEvent` composes unchanged: `WithOrigin<DaemonEvent>` now carries both.

**Named `daemonTs`, not `ts`.** `createdAt` (#1013) is the LOCAL clock stamp taken from `Date.now` at the
bridge, and it keeps that meaning and that producer untouched. A field called `ts` beside it would invite
exactly the confusion the AC forbids; `daemonTs` names its provenance. No clock defaults it: absent means
the event came from no envelope, and every renderer consumer reads absence as "no key".

The type does not say WHICH arms carry it, and that is stated rather than hidden. The set of ten is
enforced at the ten emit sites — one file, one switch — and pinned by `daemonConnection.test.ts`
asserting that the non-timeline arms carry none. The failure direction of a wrongly-stamped arm is a
useless key that matches no entry, not a suppression.

### The join key

One pure composer, exported from `timelineBridge.ts` (where the live half lives) and imported by
`historyPageBridge.ts`, which already imports `translateTimelineEvent` from it. No new module.

```ts
export function joinKeyFor(type: string, ts: string): string | undefined
export function liveJoinKeyFor(event: DaemonEvent): string | undefined
```

- `joinKeyFor` composes `` `${type} ${ts}` `` and returns `undefined` when `ts` exceeds
  `MAX_JOIN_TS_CHARS`. The separator is unambiguous because the TYPE half is a client-owned literal from a
  closed union and provably contains no NUL, so no `(type, ts)` pair can be spelled by a different pair
  however hostile the `ts` is.
- `liveJoinKeyFor` reads `event.daemonTs` and defers to `joinKeyFor(event.type, …)`. `undefined` when the
  arm carries no stamp. No enumeration of arms: the emit decided the set.

### The live half — where the keys are held

`ConversationSlice` gains `liveKeys: ReadonlySet<string>`, beside `history` and `prependedRows` and for
the same stated reason: it must die with the timeline it describes, and membership of the slice makes
that structural rather than maintained across the two eviction helpers and the two clears. Not a
satellite map. A `Set`, never a bare object — the keys are composed from daemon-supplied strings.

`dispatchFor` gains an **optional trailing** third parameter, `joinKey?: string`. Optional and trailing
for `subscribeTimeline`'s own #756/#1013 reason: a required parameter cascades over every existing call
site, an optional one over none. The key is recorded **only when the fold actually changed the timeline**
— the branch that returns the state object on `folded === held.timeline` records nothing. That is the
load-bearing safety property of this whole design: a live key exists only where the live lane actually
changed what the operator sees, so an orphan or duplicate `toolResult` that drew nothing can never
suppress the page entry that would have drawn it.

The set is bounded at `MAX_LIVE_JOIN_KEYS`, evicting oldest-first (`Set` preserves insertion order). The
bound must exceed a served page's entry count for full suppression; below it the consequence is a
duplicate row, never a dropped one. Oldest-first is the right direction because the NEWEST page overlaps
the NEWEST live keys.

`subscribeTimeline`'s injected `dispatch` widens by ARITY, from `(event, conversationId)` to
`(event, conversationId, joinKey?)`. A function of arity 2 is assignable to a parameter typed at arity 3,
so all 20 existing call sites keep compiling — #756's own lesson, applied to the same function a third
time. `useTimelineBridge` passes the key through to `dispatchFor`; the flat `timelineStore` write is
untouched.

**⭐ ONLY AN EVENT'S OWN ATTRIBUTION MAY MINT A KEY** (security review, finding 9b). `useTimelineBridge`
passes the join key **only when `conversationId !== null`** — the id the event itself carried — and never
when `timelineWriteTarget` resolved the slice from the conversation ON SCREEN. `timelineTargetFor`
returns `null` for `sessionTransition` and `connected`, so under #785's enumerated fallback a live
`session_transition` belonging to conversation B is filed into whichever conversation A is open; its key
would then sit on A's slice and could suppress A's OWN page entry if the daemon minted the two the same
millisecond with the same type. That is a dropped row — the one direction this design refuses. A key
whose conversation was inferred rather than asserted is a key that cannot be trusted to suppress, so it
is never minted. The cost is that `sessionTransition` contributes no live key at all and its page twin
always draws: a duplicate `Session reset` divider, which is the fail-open side. Routing the delimiter by
the `conversation_id` #1192 added is that ticket's stated second deliverable, not this one's; when it
lands, `sessionTransition` gains a key here with no edit.

### The page half — the join

`reduceHistoryPage` gains an **optional trailing** `liveKeys?: ReadonlySet<string>` and runs a pure
pre-filter ahead of its existing reverse-and-fold. Absent keys means nothing is suppressed, which is both
the existing behaviour and the fail-open default, so every existing call site keeps compiling and keeps
its meaning.

```ts
export function withoutLiveEntries(
  entries: readonly HistoryTimelineEntry[],
  liveKeys: ReadonlySet<string>
): readonly HistoryTimelineEntry[]
```

**The rule** (revised on the rework leg — see Revisions; the paragraph below is what shipped). Walk
`entries` from its newest end and drop while `joinKeyFor(E.event.type, E.ts)` is defined, is present in
`liveKeys`, AND occurs **exactly once** among this page's entries; stop at the first entry that fails any
of the three and keep it and everything older. The unique-within-the-page clause is AC4: the daemon mints
one timestamp per logical event, so two page entries sharing a key mean the key cannot separate them, and
a comparison that cannot separate two entries draws both rather than dropping one. The **run** clause is
the fold's own requirement: `entries` arrives newest-first, so a run off the front is a chronological
suffix, the survivors are a chronological prefix, and every entry a survivor depends on is itself a
survivor. Returns the same array reference when nothing was dropped — `withoutHeldEchoes`' no-churn idiom.

Dropping on the PAGE side rather than the live side is AC3: the live row stays exactly where the live
stream put it, and the page copy that would have drawn it a second time at the head never becomes a row.

`subscribeHistoryPage` gains an **optional trailing** `getLiveKeys?: (conversationId: string) =>
ReadonlySet<string>` — the third use of the same idiom, and deliberately not a third callback. Its
docblock asks for the cross-wire check to be re-run before a callback is added; this is not one, and a
trailing optional parameter cannot be reached by a two-argument mis-ordering of the two required
callbacks, whose mutual unassignability under `strictFunctionTypes` is unchanged. Absent getter means no
suppression, so the production wiring is not compile-enforced — pinned at the seam by a unit test,
exactly as `subscribeTimeline`'s `now` is.

`useHistoryPageBridge` supplies the getter from a new `selectLiveJoinKeysFor` selector on the store,
read afresh per page (the bridge idiom), never a snapshot captured at subscribe time.

### Data flow, end to end

```
relay frame → parseInboundMessage (envelope.ts) → InboundDaemonMessage & FrameTimestamp
  → daemonConnection emit (daemonTs) → IPC → subscribeTimeline → liveJoinKeyFor
  → dispatchFor(id, event, joinKey) → ConversationSlice.liveKeys        [live lane]

history_page frame → HistoryTimelineEntry[] → historyPageReceived → subscribeHistoryPage
  → reduceHistoryPage(entries, getLiveKeys(id)) → withoutLiveEntries → fold → rows
  → prependHistoryFor                                                   [page lane]
```

## State + concurrency model

One store slice (`conversationTimelineStore`), one new member on it, no new async work at all: no
promise, no timer, no subscription and nothing to abort. Both lanes are synchronous listeners on the
existing `DAEMON_EVENT_CHANNEL` subscription, and every write is a synchronous zustand `set` under the
store's own lock with no `await` inside it — so there is no check-then-act gap across a suspension point
between reading `liveKeys` and prepending the filtered page.

The read-then-write ordering across the two lanes is genuinely racy in the sense that matters and the
design is correct in both directions: a live event arriving AFTER the page is filtered but BEFORE the
prepend commits leaves the page copy in, drawing a duplicate — fail-open, cosmetic — and never removes a
row. Teardown is unchanged: the key set dies with the slice under the existing eviction and both clears,
so no new lifecycle exists to leak.

`MAX_RETAINED_TIMELINES` bounds the number of slices; `MAX_LIVE_JOIN_KEYS` bounds each slice's set; both
together bound the memory this ticket adds.

## Error handling

No new failure MODE — there is no I/O, no parse and no request added — but three degradations, all of
which fail open by construction:

| Condition | Result |
|---|---|
| Event carries no `daemonTs` (no envelope behind it, or an arm outside the ten) | No live key. Nothing suppressed. |
| `ts` over `MAX_JOIN_TS_CHARS` on either lane | No key composed. Nothing suppressed. |
| Live key set at its bound, oldest evicted | Nothing suppressed for the evicted key. |
| Two page entries share one key | Neither suppressed. |
| Live fold changed nothing, in EITHER of `dispatchFor`'s branches | No key recorded, so the page copy still draws. |
| Slice resolved from the screen, not from the event | No key recorded (see the ⭐ above). |
| The overlap is a GAP in the page rather than its newest run | The run stops at the first undrawn entry; the gap and everything older draw twice. |

Every row of that table draws a duplicate rather than dropping a message. That asymmetry is the whole
posture: a duplicated row is a cosmetic fault, a silently dropped one is a lost message.

**The rows above are per-ENTRY, and per-entry reasoning is not sufficient on its own** — the correction
the last row carries. The page fold reads its entries as a SEQUENCE (`fillResult` writes into a row an
earlier entry created; a turn's deltas coalesce in order), so a suppression scattered through the middle
of a page can orphan a survivor's dependency even when every individual drop was correct. The suppressed
set is therefore a contiguous run at the page's newest end, which leaves the survivors a chronological
prefix that folds against exactly the state it would have seen inside the whole page. That makes the
table's guarantee hold at the level it is stated: whatever this join does, its output is either the
joined page or the un-joined one.

The decode side keeps its existing fail-closed behaviour untouched — `Envelope.ts` is already required by
`decodeEnvelope`, so a frame without one never reaches the ten arms.

## Testing strategy

Vitest, `environment: 'node'`, all of it — every piece of this is a pure function of state or a store
write, which is why the design was shaped to make it so. Nothing here needs a DOM or a click.

**`inboundMessage.test.ts`** — the ten arms now return `ts: FIXED_TS` (the file's existing constant).
~32 assertion literals widen. New: an assertion that the `ts` is carried VERBATIM from a distinct
envelope timestamp rather than any constant, and that a non-timeline arm (`session-settings`) still
carries none.

**`daemonConnection.test.ts`** — ~30 `toEqual` literals on the ten arms gain `daemonTs`. New: the value
equals the pushed frame's own `ts` and not the fixture default; `connected` and `messageReceived` carry
none.

**`timelineBridge.test.ts`** — `liveJoinKeyFor` returns a key for a stamped arm, `undefined` for an
unstamped one, and `undefined` for an over-length `ts`; `subscribeTimeline` hands the key to its
injected dispatch as the third argument; `useTimelineBridge`'s wiring pinned at the seam.

**`conversationTimelineStore.test.ts`** — `dispatchFor` records a key on a fold that changed the state,
records NOTHING on a fold that did not (an orphan `toolResult`), evicts oldest-first at the bound, and
the set dies with the slice under eviction and both clears. Plus, at the `useTimelineBridge`/
`subscribeTimeline` seam: an event whose slice was resolved from the SCREEN rather than from the event
mints no key (the ⭐ guard), asserted on a spy.

**`historyPageBridge.test.ts`** — `withoutLiveEntries` scenarios, one per AC: a page entry matching a
live key drops; a non-matching one stays; two page entries sharing one key both stay (AC4); an entry
appended inside the ask's flight window draws once and in the live position (AC3); a `messageReceived`
entry is never suppressed because the live lane mints no key of that type (AC5's unit half); the same
array reference comes back when nothing dropped.

**`e2e/real-daemon-history-on-open.spec.ts` is NOT extended.** Its closing `toHaveCount(1)` on the
re-opened marker already is the live proof AC5 asks for, and the marker is exactly the case the join must
not touch. Adding a live-overlap drive is refused by the ticket and would not prove the premise anyway:
that both lanes carry the same `ts` for one logical event is a property of the DAEMON, and our fake
satisfies it by construction. The gate is `npm run e2e:real:gate`; on this fork that tier is the
operator's to run (the ticket carries `needs-real-claude`), not this run's.

## Open questions

1. **`MAX_LIVE_JOIN_KEYS`'s value.** The daemon chooses the page size for a `limit: 0` ask and this
   client cannot know it. Resolve in Phase B by picking a value that comfortably exceeds a plausible
   page, and record the number and the reasoning at the constant. Fail-open either way.
2. **`MAX_JOIN_TS_CHARS`'s value.** An RFC3339 timestamp is ~30 characters; resolve by picking a cap
   with headroom for a fractional-second and offset form the daemon might legitimately send.
3. **Does `withoutLiveEntries` belong in `historyPageBridge.ts` or beside the store's
   `withoutHeldEchoes`?** Resolve by placement: it is a page-lane filter over ENTRIES, which the store
   never sees, so the bridge. Confirm in Phase B that nothing forces the other placement.

Each resolution that changes the design gets a `## Revisions` entry.

## Sizing — the overage is stated, not split away

Two lines of the one-ticket boundary are exceeded and both are stated in the ticket body rather than
discovered here: six production source files against five, and total written work above 800 lines,
driven by the ~62 fixture literals the stamp reddens across two transport spec files. Every other line
holds — 2 new exported types, 0 consumer call sites needing simultaneous update (all three widenings are
optional-trailing parameters, which is why), 5 acceptance criteria, 0 new reject branches.

The split is refused on the FLOOR rule, which wins over the ceiling. Cutting the `ts` thread out mints a
child whose only deliverable is a field nothing reads until its sibling lands — a one-consumer slice,
which is part of its sibling and not a ticket. The ceiling protects against a budget miss, which costs
one continuation leg; the floor protects against a ticket that cannot be verified on its own, which no
resume fixes. The calibration also holds against this tree's own two immediate predecessors: #1259
merged at +1604 across 14 files in 98 turns / 20 min, #1260 at +2015 across 18 files in 76 turns /
22 min, both inside a 200-turn, 40-minute budget with no resume leg.

Split depth checked: parent #1088, grandparent none — a split was available and is declined on the above.

## Security review

**Verdict:** PASS

The thing under review is a **dedup on entirely remote-supplied input**, which is a suppression
primitive. The governing question at every category below was therefore not "can this leak" but "can a
hostile daemon, or a confused implementer, make the client fail to draw a row" — the one direction that
loses a message rather than merely repeating one.

**Findings:**

- **[Trust boundaries]** No finding, and the check was concrete rather than assumed: `decodeEnvelope`
  already fails closed on a non-string `ts`, so the value carried to the emit is a validated `string` and
  a hostile `ts: {}` cannot reach `joinKeyFor` to be template-stringified into `[object Object]` — which
  would have collapsed every frame onto one key and turned the join into a mass suppressor. The boundary
  stays exactly one function (`parseInboundMessage`) and this ticket adds no second parse: the field is
  carried, never re-derived. Downstream the string is typed `daemonTs?: string` on an IPC union whose
  docblock states it is a COMPARAND and nothing else.
- **[Threat model / hostile daemon — the primitive itself]** No finding, and this is the load-bearing
  argument. A daemon that wants a row unseen can simply not serve it; both lanes originate inside the
  same Noise session, so controlling the key grants no capability the content's own author did not
  already have. The relay is on-path but content-blind — it can drop, delay, reorder and flood, and can
  neither read nor forge inside the session, so it cannot reach the key at all. The primitive would be
  dangerous only if a party OTHER than the content's author could set the key, and none can.
- **[Threat model / false suppression — MUST FIX, fixed in this plan before commit]** `timelineTargetFor`
  returns `null` for `sessionTransition` and `connected`, and #785's enumerated fallback then files those
  into the conversation ON SCREEN. A live `session_transition` belonging to conversation B would have
  minted a key on conversation A's slice, which could suppress A's own page entry on a same-millisecond
  same-type collision — a DROPPED row. Addressed in Design § "⭐ only an event's own attribution may mint
  a key" and implemented in `subscribeTimeline` (see Revisions): the key is passed only when
  `conversationId !== null`. The residual cost is a duplicate
  `Session reset` divider, the fail-open side.
- **[Threat model / false suppression, second finding — MUST FIX, fixed on the rework leg]** ⭐ **This
  pass reasoned about one entry at a time, and that was the gap.** Every category above asks whether a
  given key can be wrong for a given entry; none asked what a CORRECT drop does to the entries around it.
  The page fold is not entry-independent, so an entry-independent filter loses content in two reachable
  ways: dropping a `toolUse` while keeping its `toolResult` makes `fillResult` find no row to write into
  and discard the result (the live row then stays pending forever, since this client advertises no
  `last_event_id` and nothing reconciles across the lanes), and dropping a turn's older deltas while
  keeping its newer ones makes `prependHistoryFor` place the tail of the reply above its head. Both are
  fail-CLOSED — content lost or corrupted — in exactly the reconnect scenario the served page exists to
  repair. Addressed by making the suppressed set a contiguous run at the page's newest end, so the
  survivors are a chronological prefix and no survivor can depend on a dropped entry; the stated cost is
  that a gap-shaped overlap suppresses nothing. **The generalisable lesson: a suppression primitive over
  a SEQUENCE must be audited at the level of the sequence, not only at the level of the item.** A
  per-item audit that concludes "every degradation draws a duplicate" is sound only if the consumer of
  the surviving items treats them independently, and this one does not.
- **[Threat model / false suppression, third finding — MUST FIX, fixed on the rework leg]** `dispatchFor`
  applied the "a key is recorded only where the fold changed something" guard in its UPDATE branch only;
  the create branch stored the key beside a fold whose result it never inspected. Reachable on
  `toolResult`, the one stamped arm that no-ops against `initialTimelineState`: an orphan result as a
  conversation's first live frame minted a key for a row nobody was shown, which the page's copy of that
  result would then have been suppressed by. Both branches now compare their fold before recording.
- **[Memory exhaustion — addressed]** `MAX_PLAINTEXT_BYTES` is 65519, so `Envelope.ts` may legitimately
  decode to a ~64KB string. Unbounded, a hostile daemon streaming such frames would pin
  `MAX_LIVE_JOIN_KEYS` × 10 slices × 64KB ≈ hundreds of MB of retained keys. `MAX_JOIN_TS_CHARS` bounds
  it deterministically at the single composer both lanes share, and an over-length `ts` yields no key
  rather than a truncated one — truncation would MERGE distinct timestamps into one key, which is a
  suppressor. Both bounds are code-level constants, not conventions.
- **[Key-space hygiene]** No finding. The live set is a `Set`, never a bare object, so no
  `__proto__`-shaped `ts` writes through `Object.prototype`; it lives on `ConversationSlice`, so it dies
  with the timeline under the existing eviction and both clears rather than needing a key dropped in four
  places; and no key of it becomes a lookup path, a filename, a URL, an attribute, a React key or a log
  field — `joinKeyFor`'s output is compared for membership and discarded. The composed key is
  unambiguous because the TYPE half is a client-owned literal from a closed union, so no hostile `ts` can
  spell a different `(type, ts)` pair.
- **[Logs / telemetry]** No finding. `daemonTs` reaches no sink: `emitDaemonEvent` is log-free by
  construction, the ten decode arms' `diagnosticLog?.event` calls stay on the existing content-free field
  set (event, byte length, one-way hash) and this ticket adds no field to them, and no new `console` call
  ships. `translateTimelineEvent`'s `assertNever` stringifies a whole event into an `Error`, but only for
  an arm with no case — unchanged by this ticket, and a timestamp is not content in any event.
- **[Rendering]** No finding, by construction rather than by rule: `daemonTs` is not read by any render
  path. `translateTimelineEvent` rebuilds a fresh `ThreadEvent` from named render fields and does not
  name it, so it structurally cannot reach a DOM sink. It is not parsed into a `Date`, not sorted on to
  decide row order, and not displayed — `createdAt` stays the only thing a display reads, with its
  meaning and its `Date.now` producer untouched.
- **[Electron attack surface]** No finding. No new IPC channel, no new `contextBridge` API, no new
  `ipcMain` handler, no protocol registration and no window. One optional string joins an existing
  main→renderer union on `DAEMON_EVENT_CHANNEL`; the renderer never sends it back, so no new
  renderer→main argument needs validating. The transport, keys and Noise session stay main-side, and
  nothing about this field is reachable from a compromised renderer beyond the string itself.
- **[Concurrency]** No finding. No promise, timer, listener, subscription or `AbortController` is added,
  so there is nothing new to cancel or leak, and every write is a synchronous zustand `set` with no
  `await` inside it — no check-then-act gap between reading `liveKeys` and prepending. The genuine
  read-then-write race across the two lanes is named in State + concurrency and resolves fail-open in
  both orderings.
- **[Tokens / secrets, File & storage, Cryptography, Network & I/O]** Not applicable, and each for a
  structural reason rather than by inspection: no credential is reachable from this path (the field is a
  scalar off a decoded payload, never a record); nothing touches the filesystem, so there is no traversal,
  TOCTOU or at-rest question to answer; no randomness, comparison-against-a-secret or key material is
  involved (`joinKeyFor`'s comparison is between two non-secrets, so `timingSafeEqual` would be
  meaningless); and no socket, request, URL, timeout or reconnect is added — the frame cap and the
  relay's TLS posture are inherited unchanged.
- **[OUT OF SCOPE]** Proving that both lanes really carry the same `ts` for one logical event is a
  property of the DAEMON and cannot be established from this client; the fake tier satisfies it by
  construction. A daemon that violated it would leave the join matching nothing and the client drawing
  today's duplicates — the fail-open direction, which is why AC5 asks only that nothing is suppressed. No
  future ticket is named because there is nothing here to pick up.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
</content>
</invoke>

## Revisions

### 2026-09-08 — the ⭐ attribution guard moved from `useTimelineBridge` to `subscribeTimeline`

**What changed.** The security review's finding 9b — only an event's own attribution may mint a join key
— was planned as a conditional inside `useTimelineBridge`'s fan-out callback. It is implemented one layer
down instead, as `joinKeyToRecord` called from `subscribeTimeline`, which passes `undefined` as the
dispatch's third argument whenever `timelineTargetFor(event)` returned `null`.

**Why.** The guard is the load-bearing half of the finding, so it needs a test, and `useTimelineBridge`
is structurally untestable in this repo: `vitest.config.ts` is `environment: 'node'`, renderer specs
render through `renderToStaticMarkup`, and no effect ever runs. A guard living there could only have been
asserted by reading the source. `subscribeTimeline` already computes `timelineTargetFor(event)` for the
second argument, so the same decision is available one call earlier at a seam plain spies reach — and
`timelineBridge.test.ts` now pins it directly on a stamped `sessionTransition`. Behaviour is identical;
only its reachability changed. The fan-out callback still forwards the key it is handed and re-derives
nothing.

### 2026-09-08 — the two Open Questions, resolved

- **`MAX_LIVE_JOIN_KEYS` = 512** (`conversationTimelineStore.ts`). Comfortably above any single page this
  client's `limit: 0` ask draws, and bounded memory on remote-keyed state at
  `MAX_RETAINED_TIMELINES` × 512 keys. Both directions of a wrong value are cosmetic and the low side
  fails open, which is why a precise number was not worth chasing.
- **`MAX_JOIN_TS_CHARS` = 64** (`timelineBridge.ts`). An RFC3339 timestamp with nanoseconds and a numeric
  offset is under 40 characters. An over-length value yields NO key rather than a truncated one:
  truncation would merge distinct timestamps onto one key, and a key matching more than it should is a
  suppressor.
- **`withoutLiveEntries`' placement** resolved as planned — `historyPageBridge.ts`, beside the fold it
  runs ahead of. Nothing forced the alternative.

### 2026-09-08 — test-fixture cascades, as predicted

Three `toHaveBeenCalledWith` argument pins in `timelineBridge.test.ts` name the third argument now; that
call widens the arity a third time and the seam is the one #756's own note marks. ~62 `toEqual` literals
across `inboundMessage.test.ts` and `daemonConnection.test.ts` gained the stamp. Four key-list guards in
`daemonConnection.test.ts` (`Object.keys(event).sort()`) gained `'daemonTs'`, and three of their names'
property counts moved with them. No production behaviour rides on any of it.

### 2026-09-08 — the suppressed set became a contiguous RUN, not a scatter (verifier MUST FIX)

**What changed.** `withoutLiveEntries` filtered entry-by-entry: every entry whose key was held, unique and
resolvable was dropped, wherever it sat in the page. It now walks the page from its newest end and stops
at the first entry that fails any of those three tests, keeping it and everything older. The three
per-entry conditions are unchanged; what is new is that they may only end the run, never punch a hole
through it.

**Why.** The plan's whole safety argument — and its Error-handling table, and its `## Security review` —
reasoned one entry at a time, and the page fold does not. `reduceHistoryPage` folds left from
`initialTimelineState`, so a survivor can depend on an entry the filter dropped. Two reachable losses
followed, both found by the verifier and both reproduced as failing tests before the fix:

- **An orphaned result.** The live lane drew a `tool_use` and lost the `tool_result` to a reconnect — this
  client advertises no `last_event_id`, so a dropped live frame is gone and the served page is the only
  repair path. The old filter dropped the page's `toolUse` and kept its `toolResult`; `fillResult` found
  no row carrying that `toolUseId` and discarded the result, while the live row stayed pending forever.
- **A turn read backwards.** The live lane drew a turn's older deltas but not its newer ones. The old
  filter dropped the older, and the surviving newer folded into a bubble `prependHistoryFor` places above
  the live bubble holding the older text. `reduceHistoryPage` returned `'world'` where the turn read
  `'hello world'`.

Both are fail-CLOSED, the one direction this ticket refuses. The run rule closes them structurally rather
than by special-casing either: `entries` arrives newest-first, so a run off the front is a chronological
suffix and the survivors are a chronological prefix, which folds against exactly the state it would have
seen inside the whole page.

**What it costs, stated rather than hidden.** An overlap shaped like a GAP — the live lane drew something
in the middle of the page but not the newest entry — now suppresses nothing, and those entries draw twice.
That is precisely what they did before this ticket, which is the carve-out's strongest form: the output of
this function is either the joined page or the un-joined one, so the join can only remove duplicates and
can never introduce a loss or a reordering the un-joined page did not already have. AC2 holds at the seam
the two lanes actually meet at; it does not hold across a gap, and no key-level rule could make it,
because the loss is in the fold rather than in the key.

### 2026-09-08 — `dispatchFor`'s create branch now asks whether its fold drew anything (verifier MUST FIX)

**What changed.** The create branch stored `liveKeys: withJoinKey(NO_LIVE_KEYS, joinKey)` beside a
`reduceTimeline(initialTimelineState, event)` whose result it never inspected, so the ⭐ "a key is
recorded only where the fold changed something" guard lived in the update branch alone. The fold is now
taken into a local and the key withheld when it came back as `initialTimelineState`. The SLICE is still
created unconditionally — that invariant is untouched.

**Why.** `toolResult` is stamped, and `threadTimeline`'s `toolResult` arm returns the same reference for
an orphan against a fresh state. So an orphan result as a conversation's first live frame — the relay
resuming mid-tool-call, or the slice having been evicted — minted a key for a row the operator was never
shown, and the served page's copy of that result would then have been suppressed by it. The existing
regression test seeds a delta first and therefore exercises the update branch only; the create branch has
its own case now, and reverting the guard reddens it.

### 2026-09-08 — two test-quality fixes (verifier SHOULD FIX)

`selectLiveJoinKeysFor` had been inserted between #1260's `selectPrependedRowsFor` docblock and its
declaration, leaving one symbol with two docblocks and the other with none; it now sits below, with its
own. And the AC5 case handed `withoutLiveEntries` an EMPTY key set, so it returned at the size guard and
asserted nothing the test above it did not — the function has no type-level exclusion for
`messageReceived` and would drop it if handed a key. It now runs against a realistic set holding keys only
for the arms the emit does stamp, and names where the guarantee actually lives: at the emit, pinned in
`daemonConnection.test.ts`.
