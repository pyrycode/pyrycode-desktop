# #493 — Api-retry indicator: render the retry status, superseding generic thinking

Render half of the #488 split; consumes the `apiRetry` `DaemonEvent` that #492 landed dormant
(`e08f33d`, PR #494). The structural mirror of the stall indicator (#317) with the **clear semantics
inverted**, plus the mutual-exclusion rule #317 explicitly deferred.

Size **S**: five production files touched (four `.ts`/`.tsx` + one `.css`), three test files, **zero new
files**. The documented irreducible shape of a store-scalar render slice — #317 shipped the same shape
(one boolean where this carries a record) at 8 files / 272 insertions (`aea4141`).

Not `security-sensitive` (labels: `enhancement`, `size:s`). Pure renderer: no keys, sockets, raw frames,
or IPC surface changes. The one security-adjacent item #492's review routed here — defensive counter
formatting — is discharged in § Counter formatting below.

## Design source

N/A — no Figma node. The mobile file (`g2HIq2UyPhslEoHRokQmHG`) draws only the populated steady-state
Conversation Thread (node `16-8`); every transient thread-chrome overlay on this project ships
N/A-justified (#215 thinking, #277 empty-thread, #279 session banner, #305 composer stop-state, #317
stall). The retry status is the same class of overlay and lives in the same message-list region. A
dedicated degraded-state visual is a Figma-side follow-up for Juhana, pairing naturally with #496.

## Files to read first

Codegraph is not initialized for this project (`codegraph_context` → *"CodeGraph not initialized"*), so
this list was assembled by targeted `Grep`/`Read`. Read these before writing anything:

- `src/renderer/src/store/threadTimeline.ts:86-98` — `TimelineState` + the `assertNever` guard. The third
  scalar lands beside `items`/`phase`/`stalled`.
- `src/renderer/src/store/threadTimeline.ts:151-247` — **the whole reducer.** Every arm spells `stalled:`
  explicitly; note `:188` and `:196`, the two no-op guards widened with `&& !state.stalled`. § Reducer
  explains why the new scalar must *not* join them.
- `src/renderer/src/store/threadTimeline.ts:80-84` — the `stallDetected` `ThreadEvent` arm; the doc-comment
  shape to mirror for the new arm.
- `src/renderer/src/store/timelineBridge.ts:86-91` — the `stallDetected` owned arm (filter + fresh literal).
  The exact template for the new arm.
- `src/renderer/src/store/timelineBridge.ts:114-138` — the null fall-through cluster; `apiRetry` sits at
  `:118` and the trailing comment names it at `:136`. Both change.
- `src/renderer/src/store/timelineStore.ts:49-51` — the one-line selector re-export to widen.
- `src/shared/ipc/events.ts:122-134` — the `apiRetry` `DaemonEvent` arm and its normative wire notes
  (falling edge, no dedup, `0/0` legitimacy, no range check). The contract this slice honours.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:84-95` — the container's three timeline
  slice reads; the fourth goes here.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:142-147` — the `Timeline` /
  `ThinkingIndicator` / `StallIndicator` mount region. The new indicator mounts here and the
  `ThinkingIndicator` gate changes.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:456-518` — `ThinkingIndicator`,
  `STALL_COPY` + `StallIndicator`, and `isTurnRunning`. The three idioms this slice composes: the pure
  null-on-inactive view, the client-owned copy constant, and the extracted named predicate.
- `src/renderer/src/screens/conversation/conversation.css:338-375` — `.conversation__thinking`,
  `.bubble--thinking`, `.conversation__stall`, `.bubble--stall`. The wrapper shape to clone and the two
  treatments the new bubble must read as distinct from.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:403-468` — the pure-view and
  pure-predicate test idioms (`renderToStaticMarkup` with injected props, no store) to follow.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1306-1323` — the container
  inert-smoke idiom.
- `src/renderer/src/store/threadTimeline.test.ts:247-330` — the #317 reducer block. **Read the clearing
  tests specifically**: this slice's equivalents assert the exact opposite outcome.
- `src/renderer/src/store/timelineBridge.test.ts:116-120, 416-424` — the bridge translate-arm test and the
  bridge→store round-trip test to clone.
- `docs/knowledge/codebase/317.md` — the precedent write-up; § *Patterns established* names the
  audit-every-short-circuit rule, § *Open questions carried forward* is the mutual-exclusion question AC5
  closes.
- `docs/knowledge/codebase/492.md:86-98` — *"Counter formatting is #493's job"*, the carried-forward item
  this spec discharges.

`daemonEventBridge.ts` / `modalBridge.ts` and their tests need **no change** — #492 already placed
`apiRetry` in their null groups with passing assertions. Do not touch them.

## Context

When claude hits an API error it retries, and the desktop head currently shows the same generic
"thinking" state it shows for healthy work. #492 decoded the daemon's `api_retry` frame into
`{ type: 'apiRetry'; active; current; total }` but shipped it dormant — all three exhaustive renderer
bridges no-op it. This slice gives it a consumer.

Three wire facts drive the whole design (normative source: `src/shared/ipc/events.ts:122-134`):

1. **Explicit falling edge.** Unlike `stall` (onset-only, client self-clears on turn activity),
   `api_retry` clears on `active: false` and on *nothing else*.
2. **No dedup, re-fires as the count climbs.** The transport holds no state, so N frames produce N
   events — including verbatim repeats. The render tracks the latest value; it never freezes on the first.
3. **`current: 0` / `total: 0` is a legitimate "retrying, count unknown"**, not an error — it is what the
   daemon ships when claude's on-screen `attempt N/M` counter did not parse.

## Design

### Store — a third scalar, a record not a flag

`src/renderer/src/store/threadTimeline.ts`. Two new exported symbols plus a fourth `TimelineState` field:

```ts
/** The live api-retry attempt counter. Present ⇒ a retry is in flight; `null` ⇒ none. */
export interface ApiRetryStatus { current: number; total: number }

// on TimelineState, beside items/phase/stalled:
apiRetry: ApiRetryStatus | null
```

**`ApiRetryStatus | null`, not `{ active; current; total }`.** The `null` collapses "not retrying" into
one representation, so the render gate is a presence check rather than a field read — and, decisively, it
makes the wire's *"the falling edge repeats the last-known counter verbatim; the counter is ignored once
`active` is false"* true **by construction**: the falling edge stores `null`, discarding the counter with
nowhere to leak it from. A store shape that retained a stale counter behind `active: false` would be a
latent bug the type system could not catch.

`initialTimelineState` gains `apiRetry: null`. `selectApiRetry` joins `selectItems`/`selectPhase`/
`selectStalled` on the pure module and is re-exported from `timelineStore.ts` (one-line widening,
`:51` — the #317 edit exactly).

### The `ThreadEvent` arm

A new arm, field-for-field identical to the `DaemonEvent` arm — so the bridge stays a filter + fresh
copy with no field remapping (the `toolUse` / `sessionBoundary` discipline, *not* the nullary
`stallDetected` shape):

```ts
| { type: 'apiRetry'; active: boolean; current: number; total: number }
```

The event carries `active`; only the *state* uses `null`. That asymmetry is deliberate: the event is a
faithful renderer-local re-declaration of the wire edge, and the reducer is the single place that
translates edge → presence.

### Reducer — the one trap in this slice

**Every existing arm carries `apiRetry: state.apiRetry` through unchanged.** Nine arms; each already
spells `stalled:` explicitly, so each gains one line. This is compile-forced (the field is required on
`TimelineState`), so an omission is a type error, not a silent bug.

**The trap, stated as a hard constraint:** `apiRetry` must **not** join the `stalled: false` clear-set,
and the two widened no-op guards at `threadTimeline.ts:188` (`toolResult` orphan/duplicate) and `:196`
(`turnState` same-phase) must **not** gain an `apiRetry` clause. Turn activity clears a *stall* because
the daemon sends no "stall cleared" frame; `api_retry` has an explicit falling edge, so turn activity
arriving mid-retry is expected and must leave the status showing. Copying #317's guard widening here is a
silent behavioural bug — AC4 exists to catch it, and § Testing pins each of the four activity arms
individually.

The new arm's contract, in three rules:

- **`active: true`** → hold `{ current, total }` from the event. If the held status already equals the
  incoming pair, return the **same state reference** (AC2's "never stacks, duplicates, or flickers" — an
  identical repeat must not churn the selector into a re-render). Otherwise a fresh state with a fresh
  status object, so a climbing count updates in place.
- **`active: false`** → `apiRetry: null`. The event's `current`/`total` are **never read** on this path.
  Redundant falling edge against `null` → same-reference no-op.
- `items` and `phase` are untouched on every path — the retry status is chrome, never a `ThreadItem` row
  (ADR 0008's `phase`-beside-`items` precedent, the same call #317 made).

`0/0` on a rising edge yields a **present** `ApiRetryStatus` with both fields zero — a live retry with an
unknown count, never `null`. The `null`-vs-zeros distinction is exactly the "unknown count" vs "no
retry" distinction; conflating them would lose AC3.

### View — the supersede rule (AC5)

`ConversationScreen.tsx`. The ticket asks whether the container derives a single mutually-exclusive
status or the thinking gate narrows. **The thinking gate narrows, via one named exported predicate over a
named exported input record.** Both components stay pure, independently unit-testable, and unchanged in
their own props:

```ts
/** The coarse thread-chrome scalars the indicator-precedence rule reads. #496 adds `compacting` HERE. */
export interface ThreadStatus { phase: TurnPhase; apiRetry: ApiRetryStatus | null }

/** Whether the generic thinking indicator shows: thinking, and nothing supersedes it (AC5). */
export function shouldShowThinking(status: ThreadStatus): boolean
```

Rejected alternative: a container-derived discriminated `Status` union feeding one component. It would
restructure `ThinkingIndicator` (breaking #215's tested `isThinking: boolean` contract) and force #496 to
re-open the same components. The predicate keeps both views pure — the `isTurnRunning` precedent
(`:516`) the ticket points at — and gives #496 a **single-field extension**: one field on `ThreadStatus`,
one clause in the predicate, one field in the container's object literal. No parallel rule, no second
gate.

Why a record parameter rather than `isTurnRunning`'s bare positional scalar: with #496 already specced to
extend it, a positional signature would break its call site on every future status. The record grows;
the signature does not.

### View — the indicator

```ts
export function ApiRetryIndicator({ retry }: { retry: ApiRetryStatus | null }): JSX.Element | null
```

- `retry === null` → `null` (zero layout footprint — the `ThinkingIndicator`/`StallIndicator` posture).
- Present → the `.conversation__api-retry` wrapper + a `bubble bubble--daemon bubble--api-retry` bubble
  carrying a client-owned copy constant and, when the counter is known, a nested
  `<span className="api-retry__counter">` holding the client-formatted digits.

**The prop is `ApiRetryStatus | null` — two numbers, no string field.** This preserves #215/#317's
type-level guarantee for AC1 ("no daemon-supplied string is ever rendered") in the only way available to
a view that must show daemon-derived digits: the view *structurally cannot receive* a daemon string. Do
not widen the prop to the `ThreadEvent` or a preformatted string.

**Copy constraints** (exact wording is the developer's call within these, the #317 precedent):
client-owned module constant(s), never a daemon string; conveys **both** that claude hit an API error
**and** that it is retrying (AC1); **apostrophe-free** and using the U+2026 ellipsis character —
`renderToStaticMarkup` escapes `'` → `&#x27;`, the standing desktop lesson, and it would surface in the
markup assertions. Shape along the lines of `API error — retrying…` plus `attempt 3/10`.

### Counter formatting

Render the two integers as digits via string interpolation. **Never** compute `current / total` or a
percentage: `0/0` → `NaN`, which is exactly what #492's security review routed down to this slice
(*"an out-of-range value is reachable, not exploitable at this layer"*). Rendering digits discharges it.

Show the counter iff **`total > 0`**. This satisfies AC3 (`current === 0 && total === 0` → counter
omitted, no `0/0` in the markup) and additionally keeps an undocumented partial (`3/0`) from rendering a
meaningless denominator. It is one comparison in the formatter, not a validator: **do not add a range
check, an upper bound, or a negative-value guard.** Inventing a client-side bound on an inbound wire
integer is unprecedented on this project and risks silently dropping valid future frames (ADR 0002
drift) — the deliberate house posture #492 recorded.

`current: 0, total: 10` is not the unknown sentinel; render it verbatim as `0/10`.

### Container wiring

One new narrow slice read beside the existing three, and the mount region gains one sibling:

```tsx
const apiRetry = useTimelineStore(selectApiRetry)
…
<ThinkingIndicator isThinking={shouldShowThinking({ phase, apiRetry })} />
<ApiRetryIndicator retry={apiRetry} />
<StallIndicator isStalled={stalled} />
```

Mount order: directly after `ThinkingIndicator` (its supersede peer), before `StallIndicator`. The
retry and stall indicators may still co-render — AC5 scopes mutual exclusion to *thinking* only, and
#317's accepted "distinct facts, adjacent flex rows" posture is unchanged for stall.

### Stylesheet

`conversation.css`, appended beside the #317 block:

- `.conversation__api-retry` — clones `.conversation__stall`'s wrapper verbatim (`flex: 0 0 auto`, flex
  row, `justify-content: flex-start`, `var(--space-2) var(--space-4)`), since it sits in the same
  message-list region.
- `.bubble--api-retry` — reuses `.bubble--daemon`'s fill/radius/measure and diverges to the error role
  (`color: var(--color-error)`), reading as a degrading session rather than normal progress. **No left
  accent bar** — that is `.bubble--stall`'s distinguishing mark, so omitting it keeps the two problem
  states visually separable while both stay distinct from the muted `.bubble--thinking` (AC1).
- Optional `.api-retry__counter` emphasis is within-token only if added.

Token names only. **No color literal and no new theme token** — `--color-error` is the only error-role
token on desktop.

## State + concurrency model

One store slice (`timelineStore`), one new scalar, unidirectional: the bridge dispatches in, the view
reads via a selector and never writes. No new async work, no timers, no subscriptions, no teardown
surface — the existing `useTimelineBridge` effect already carries the channel.

Re-render churn: `useTimelineStore` compares with `Object.is`. Because every carry-through arm passes the
*same* `apiRetry` object reference and an identical rising edge returns the same state reference, a
verbatim repeated frame produces **zero** re-renders. That same-reference discipline is what makes AC2's
"never flickers" structural rather than incidental — assert it with `toBe`, not `toEqual`.

## Error handling

No new failure modes. The transport already type-validated the payload (#492); a malformed frame never
reaches this layer. There is no parse, no I/O, and no throwing path — an unexpected counter value renders
as digits or is omitted per § Counter formatting. `assertNever` in `threadTimeline.ts` and
`timelineBridge.ts` keeps both switches exhaustive; `daemonEventBridge`/`modalBridge` already compile
against the arm.

## Testing strategy

Test-first, one failing test per criterion. Scenarios (the developer writes them in the file's idiom):

**`threadTimeline.test.ts`** — pure reducer, plain event arrays:

- Rising edge from initial → `apiRetry` holds `{ current: 3, total: 10 }`; `items`/`phase` untouched. (AC1)
- A climbing rising edge (`3/10` → `4/10`) replaces the held counter in place. (AC2)
- A verbatim repeated rising edge returns the **same state reference** (`toBe`). (AC2)
- Rising edge with `current: 0, total: 0` yields a **present** status with both zeros, not `null`. (AC3)
- Falling edge clears to `null`. (AC4)
- Falling edge carrying a non-zero counter (`active: false, current: 4, total: 10`) still clears to
  `null` — the counter is ignored. (AC4)
- Redundant falling edge against `null` is a same-reference no-op.
- **Each of `assistantDelta`, `toolUse`, `toolResult`, `turnState` leaves a live retry showing** — four
  cases, the deliberate inverse of the #317 clearing tests; include the orphan-`toolResult` and the
  idle-`turnState` variants, since those are the two arms whose no-op guards must *not* widen. (AC4)
- `turnEnd` / `userText` / `sessionBoundary` carry a live retry through.
- Cross-scalar independence: `stallDetected` leaves a live retry showing, and an `apiRetry` event leaves
  `stalled` unchanged in both directions.
- `initialTimelineState.apiRetry` is `null`; `selectApiRetry` returns the slice.
- Regression: the pre-existing orphan-`toolResult` `.toBe(initialTimelineState)` assertion stays green
  **unmodified** — the tripwire proving no guard was widened.

**`timelineBridge.test.ts`**:

- `apiRetry` `DaemonEvent` → a `ThreadEvent` with the same four fields and a **fresh object**
  (`not.toBe(event)`) — the never-a-pass-through discipline.
- A falling-edge event translates verbatim (all four fields copied, nothing normalized at the bridge).
- Round-trip: emit through the bridge into a real store → `selectApiRetry` reflects the rising edge, and a
  following falling edge clears it.

**`ConversationScreen.test.tsx`** — pure views/predicates via `renderToStaticMarkup`, injected props, no store:

- `retry={null}` → `''`. (zero layout footprint)
- `retry={{ current: 3, total: 10 }}` → wrapper + bubble classes present, the copy present, the digits
  `3` and `10` present, and **neither** `bubble--thinking` **nor** `bubble--stall` present. (AC1, AC2)
- `retry={{ current: 0, total: 0 }}` → the copy present, the counter span **absent**, and the markup does
  **not** contain `0/0`. (AC3)
- `shouldShowThinking({ phase: 'thinking', apiRetry: null })` → `true`.
- `shouldShowThinking({ phase: 'thinking', apiRetry: { current: 3, total: 10 } })` → `false`. (AC5)
- `shouldShowThinking` with `phase: 'idle'` and with `phase: 'responding'` (retry `null`) → `false`
  both — thinking behaviour unchanged when no retry is in flight. (AC5)
- Container smoke: `<ConversationScreen />` against the initial store renders no `conversation__api-retry`.

Type-level coverage rides `npm run typecheck`; `npm run build` is the gate.

## Open questions

- **Exact copy wording** is the developer's call inside § View's constraints (client-owned,
  apostrophe-free, U+2026 ellipsis, conveys error + retrying). Not verified against mobile's wording —
  the same latitude #317 took for `STALL_COPY`.
- **`total > 0` vs the AC's literal `current === 0 && total === 0`.** This spec picks the former: it
  subsumes the AC and additionally suppresses an undocumented `N/0`. If code review prefers the literal
  reading, it is a one-comparison change with no structural consequence.
- **Retry + stall co-render.** Deliberately still allowed — AC5 scopes mutual exclusion to the *thinking*
  indicator. If the design later wants a full precedence chain, `shouldShowThinking`/`ThreadStatus` is
  the seam it extends (as #496 will).
- **`ThreadStatus` naming.** Chosen for the extension seam #496 consumes; if #496's author finds a better
  name once `compacting` lands, renaming is local to `ConversationScreen.tsx` and its test.
