# #1314 — show the running thinking-token estimate next to Thinking…

## Files read

- `src/renderer/src/store/threadTimeline.ts` → `TimelineState`, `ThreadEvent`, `reduceTimeline`,
  `initialTimelineState` — the reducer that gains the fifth chrome scalar; every one of its fourteen arms
  writes each scalar out by hand, and the `reconnected` arm's `nothingLive` predicate is the one place the
  compiler cannot keep in sync.
- `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent`, `timelineTargetFor` — the
  `thinkingProgress` no-op group member this slice claims, and the routing switch it joins.
- `src/renderer/src/store/timelineStore.ts` → the selector re-export block (`selectApiRetry`,
  `selectCompacting` are the precedent for a fifth line).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ThinkingIndicator`, `statusRowCopy`,
  `apiRetryLabel`, `workingIndicatorState`, `ThreadStatus`, and the container's `thread` destructure — the
  label site and the one place the row's five-way precedence lives.
- `src/shared/ipc/events.ts` → the `thinkingProgress` arm and its SECURITY block — this slice's audit target.
- `src/main/transport/inboundMessage.ts` → `parseThinkingProgressPayload`, `requireNumber` — what the decode
  guarantees (a `number`) and, decisively, what it does not (finiteness, sign, integrality).
- `src/shared/wire/types.ts` → `ThinkingProgressPayload` — the non-monotonic, rate-bounded, zero-is-a-value
  contract, plus `TurnEndPayload` / `TurnStatePayload` for the e2e frames.
- `docs/knowledge/features/conversation-shell-turn-status.md` § "Thinking / working indicator" — the standing
  lesson that the label is a **single text child in every state, never constant-plus-span**, and that the
  daemon's contributions ride their own **required** props rather than widening `ThreadStatus`.
- `docs/knowledge/features/thread-timeline.md` § the arm table — the per-arm clear semantics each existing
  scalar follows, and why `reconnected` uses a hand-written literal rather than a spread.
- `e2e/composer-status-reduced-motion.spec.ts` — the spec-local frame-builder idiom the new spec mirrors.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=111-3525

The status area is a row with the 14×16 PyryMark at its left, an 8px gap, then a single body-small text run
(`--schemes/primary`, 12px/16px, 0.4px tracking, `whitespace-nowrap`) reading `Thinking...`, with the
re-pair button in the right-hand slot. This slice extends the text that one run carries and touches no box,
no type token, no colour and no CSS — the node's geometry is unchanged, and the estimate rides inside the
existing `.composer-status__label` span.

## Context

`thinking_progress` is claude's only mid-turn proof of life on the stream-json surface. #1312 decoded the
frame, #1313 carried it to the window as a typed daemon event whose four bridge cases are all no-ops. This
slice claims the timeline one: the estimate becomes a chrome scalar on `TimelineState`, keyed to the
conversation the frame names, and the thinking label reads it.

No ADR is warranted — this extends the chrome-scalar pattern `apiRetry` (#493) and `compacting` (#496)
already established rather than introducing a new one.

## Design

### 1. The scalar — `thinkingTokens: number | null` on `TimelineState`

The fifth chrome scalar, beside `stalled` / `apiRetry` / `compacting` / `localSendPending`. `null` means no
estimate is held; **`0` is a held reading, never an absence** (the wire has no `omitempty`, so the daemon's
zero is legal traffic). Shape follows `apiRetry`'s `| null` rather than `compacting`'s plain boolean,
because there is a value to carry — but unlike `apiRetry` it is a bare `number`, not a record: one reading,
nothing to pair it with.

**Not a `ThreadItem` row.** It is Mode B transient chrome exactly as `stalled` and `compacting` are: a
reading about the running turn, with no clearing edge of its own and no place in the transcript.

**`estimated_tokens_delta` does not cross and is not accumulated.** The IPC arm never carried it; the
payload's own contract says the deltas do not sum to the turn's total.

### 2. The event arm — `{ type: 'thinkingProgress'; estimatedTokens: number }`

A filter + fresh literal in `translateTimelineEvent`, dropping `conversationId` the way every sibling owned
arm does; the id reaches the keyed store through `timelineTargetFor`, which gains `'thinkingProgress'` in
its grouped id-carrying case (the field is required on the arm, so it narrows with no cast and no probe).

The arm moves out of the shared no-op group in `timelineBridge`. `daemonEventBridge`, `modalBridge` and
`questionBridge` keep their no-ops unchanged — this is the timeline bridge's claim alone.

### 3. Reducer clear rules (AC1)

| Arm | `thinkingTokens` |
|---|---|
| `thinkingProgress` | ← `event.estimatedTokens`; **same-reference no-op when the held value already equals it** (the wire has no dedup and re-fires verbatim, the `compacting` discipline) |
| `turnState` | **cleared to `null` when `event.state !== 'thinking'`**, carried when it is |
| `turnEnd` | cleared to `null` |
| `reconnected` | cleared to `null` (Mode B, with `items` still preserved by reference) |
| `reset` | cleared for free — the arm returns `initialTimelineState` |
| every other arm | carried unchanged |

**Latest, never a maximum.** The reading restarts near zero at each inference-request boundary — four times
inside the daemon's own single-turn capture — so a drop is ordinary traffic and the arm assigns rather than
compares magnitudes. No monotonic filter, no accumulation, no `Math.max`.

**Content arms carry it.** `assistantDelta` / `toolUse` / `toolResult` clear `stalled` because they are turn
activity; they deliberately do **not** clear this one. AC1 enumerates exactly three clearing edges and
inventing a fourth would blank a live reading the instant claude interleaves a tool call with its thinking.

### 4. The two early-out predicates

Both are stated because the ticket asks which way each went:

- **`turnState` widens.** Its guard is `event.state === state.phase && !state.stalled &&
  !state.localSendPending`. A repeat `turn_state{idle}` arriving while an estimate is held changes state
  under the new rule, so the guard gains `&& (event.state === 'thinking' || state.thinkingTokens === null)`
  — without it the common case early-outs and a stale estimate outlives its turn.
- **`toolResult` does not widen.** Its guard already covers the orphan/duplicate no-op; a tool result is not
  a clearing edge for this scalar (§ 3), so the field is carried identically on both paths and an orphan
  result against a live estimate stays the same-reference no-op it is today.
- **`reconnected`'s `nothingLive` widens** with `&& state.thinkingTokens === null` — the compiler cannot
  catch this one, and a state whose only live chrome is a held estimate must not early-out.

### 5. The label — one text run

`statusRowCopy`'s `'thinking'` arm calls a new module-private `thinkingLabel(estimate: number | null)`,
`apiRetryLabel`'s sibling. Contract:

```
thinkingLabel(null)  → THINKING_COPY
thinkingLabel(840)   → `${THINKING_COPY} ~840 tokens`
thinkingLabel(0)     → `${THINKING_COPY} ~0 tokens`
thinkingLabel(1250)  → `${THINKING_COPY} ~1300 tokens`
thinkingLabel(1249)  → `${THINKING_COPY} ~1200 tokens`
```

Verbatim below 1000, rounded to the nearest hundred at 1000 and above. **One interpolated run, never
constant-plus-span** — the row ellipsizes as a unit and two runs draw two ellipses; `apiRetryLabel` is the
precedent for folding a validated number into the run.

The estimate rides its **own required prop** on `ThinkingIndicator` (`thinkingTokens: number | null`),
beside `toolName` and `retry`. It is deliberately **not** a fifth `ThreadStatus` field: `ThreadStatus` drives
which of the five labels the slot shows, and the estimate changes none of that — adding it there would pay
#967's literal-cascade for nothing.

**The other four states are untouched** (AC2). `retrying` / `compacting` / `stalled` / `working` each return
their own constant, and the tool label still supersedes the thinking copy unconditionally when a tool is
open — unchanged behaviour, so a tool-named row carries no estimate either.

### 6. Selector

`selectThinkingTokens` joins the five in `threadTimeline`, re-exported from `timelineStore` as `apiRetry`
and `compacting` were. The container reads it off the existing whole-slice `thread` destructure — no new
subscription.

## State + concurrency model

No new async work, no new subscription, no new IPC channel, no timer. The scalar folds through the existing
`reduceTimeline` on the existing daemon-event listener; the keyed `conversationTimelineStore` routes it
generically by the target `timelineTargetFor` returns, so a frame naming a background conversation lands in
that conversation's slice and never on the open one. Teardown is the existing bridge effect's.

## Error handling

The only new failure surface is the number itself. `requireNumber` proves `typeof value === 'number'` and
nothing more: **NaN, ±Infinity, negatives and non-integers all decode successfully.** `thinkingLabel`
therefore degrades to the bare `THINKING_COPY` for `null`, any non-finite value, and any negative — the
`apiRetryLabel(null)` degrade posture, not a validator — and rounds so no fractional digits reach the DOM.
No range check is added at the decode boundary: that is the house rule (ADR 0002 drift), and a client
invented bound would fail-close ordinary traffic.

## Testing strategy

Vitest (node, static markup):

- `threadTimeline.test.ts` — the arm holds the latest reading across three pushes including a **drop**; `0`
  is held and distinct from `null`; a verbatim repeat is a same-reference no-op; cleared by
  `turnState{responding}`, `turnState{idle}`, `turnEnd`, `reconnected` and `reset`; **carried** by
  `turnState{thinking}` and by every content arm; the widened `turnState` guard (a repeat `idle` against a
  held estimate must not early-out) and the widened `nothingLive` (a reconnect whose only live chrome is the
  estimate must not early-out).
- `timelineBridge.test.ts` — the owned arm translates to the `ThreadEvent` with the id dropped;
  `timelineTargetFor` returns the frame's `conversationId`; the standing #1313 dormancy test is retargeted
  to assert the event still creates **no timeline item** (true: it is chrome, not a row).
- `ConversationScreen.test.tsx` — `thinkingLabel`'s table above plus the non-finite and negative degrades;
  the rendered row is a single text child; the other four states and the tool label are unchanged.

Playwright (`e2e/thinking-progress-estimate.spec.ts`, AC4): push `turn_state{thinking}`, then three
`thinking_progress` frames on the seeded conversation, assert the label tracks the **third**, then push
`turn_end` and assert a **positive read of the bare `Thinking…`** on the still-mounted row. No
`turn_state{idle}` is pushed — that would unmount the label and turn the closing read into a vacuous
absence check, which is the trap AC4 names.

## Open questions

- Whether a negative reading should render verbatim rather than degrade. Resolved in § Error handling:
  degrade, since `~-5 tokens` is not a reading an operator can act on and the daemon has never sent one.
- Whether the tool-named label should carry the estimate. Resolved in § 5: it does not — AC2 freezes the
  other states, and the tool label already supersedes the thinking copy.

## Security review

Audited against the `thinkingProgress` arm's own SECURITY block in `src/shared/ipc/events.ts`, which states
this slice's obligations, rather than a generic checklist.

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, but the boundary is narrower than it looks and the plan must not lean
  on it. `parseThinkingProgressPayload` proves `typeof value === 'number'` via `requireNumber` **and nothing
  else** — NaN, ±Infinity, negatives and non-integers all decode successfully, and structured clone
  preserves every one of them across the contextBridge. So the renderer holds an unvalidated-range number,
  and what makes that safe is `thinkingLabel`'s degrade (§ Error handling), not the decode. Adding a range
  check at the decode boundary is explicitly rejected there as ADR 0002 drift.
- **[Unbounded integer — allocation]** SHOULD FIX. The obligation is "never size an allocation, index a
  buffer or bound a loop" proportionally to the reading. The formatter as designed uses only a comparison,
  `Math.round` and one interpolation, so it satisfies this — but the ban must survive into Phase B and the
  verifier should check the diff for it: **no `String.prototype.repeat`, no `Array(n)` / `new Array(n).fill`,
  no `padStart`/`padEnd` bounded by the reading, no loop over it.** `padStart` is the sneaky one — a
  right-aligned formatter written as `label.padStart(estimate)` allocates gigabytes from a daemon claim.
  Length needs no cap of its own: a JS number stringifies to at most ~24 characters, which is
  `apiRetryLabel`'s own recorded reasoning for interpolating two integers with no bound.
- **[Side-channel — logs and persistence]** No findings, verified rather than assumed. The reading is a
  side-channel on how much claude thought about private work and must reach no log on any path. Checked:
  no `console.*` exists on any path in the four touched modules (`conversationTimelineStore` states
  log-freedom as a construction rule); the debug bundle is requested from and produced by the **daemon**
  (`requestDebugBundleEnvelope` / `debugBundleDownload`), never a serialisation of renderer store state, so
  a held estimate has no route to disk; the timeline is in-memory and cleared on exit. One structural point
  worth stating because it is easy to undo: the new `case 'thinkingProgress'` in `reduceTimeline` is what
  keeps `assertNever`'s `JSON.stringify(event)` from putting the reading into an Error message, a stack
  trace and a crash reporter. It must never be folded into a `default`.
- **[`conversationId` — routing key]** No findings. This design **does** index by the id, and that is the
  one sink the arm's contract sanctions ("if a consumer indexes by it, THE INDEX IS A `Map`") — verified:
  `initialConversationTimelineState` holds `timelines: new Map()`, so a hostile `__proto__`-shaped id writes
  through no prototype chain. The id is dropped at the bridge and never reaches the reducer, the label, the
  DOM, a React key, an attribute, a URL or a filename. No `?? activeConversation` fallback is introduced:
  the arm joins `timelineTargetFor`'s id-carrying group, so it resolves from the event's own required field
  and never reaches `timelineWriteTarget`'s enumerated screen fallback.
- **[DOM sinks]** No findings. The estimate reaches the DOM only inside the auto-escaped text child of
  `.composer-status__label`; a number cannot carry markup. Carried into Phase B as a ban: no `title`, no
  `aria-label`, no `data-*` gains the label — the standing constraint on `ThinkingIndicator` that the label
  reaches the DOM as a text child and nothing else, and that `text-overflow: ellipsis` is not a reason to
  add a tooltip.
- **[Hostile daemon — flood]** OUT OF SCOPE, no ticket filed. The wire has no dedup, so a daemon inside the
  Noise session can push `thinking_progress` at frame rate, each a store write and a re-render. This is not
  new exposure — `assistantDelta` has the same shape at higher volume — and the reducer's same-reference
  no-op on a verbatim repeat blunts the pure-repeat case. A per-frame rate limit belongs to the transport,
  not to this label, and no such flood has been observed.
- **[Electron / process isolation]** No findings. The slice adds no IPC channel, no preload surface and no
  main-process code; it consumes an existing typed event. No key, socket or raw byte reaches the renderer
  that does not already.
- **[Concurrency]** No findings. No new async task, timer, subscription or listener; the scalar folds
  through the existing bridge effect and its teardown is unchanged.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
