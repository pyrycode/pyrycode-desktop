# #496 — Compaction indicator: render the compaction status, superseding generic thinking

Render half of the compaction-status vertical (split from #489). Consumes the `compacting` `DaemonEvent`
that #495 landed dormant (`93f464e`, PR #498) and gives it its first consumer: an on-thread
"compacting" status that replaces the generic thinking indicator while it is live.

Structurally this is #493 (`3dd3919`, PR #497) minus the counter — same five production files, same
scalar-beside-`items` shape, same supersede seam. Read #493's spec and its codebase note first; this
spec is written as a delta against it and calls out the three places the two diverge.

## Design source

N/A — per the ticket body. The mobile Figma file (`g2HIq2UyPhslEoHRokQmHG`) draws only the populated
steady-state Conversation Thread (node `16-8`); every transient thread-chrome state on this project has
shipped N/A-justified (#215 thinking, #277 empty-thread, #279 session banner, #305 composer stop-state,
#317 stall, #493 retry). The compaction status is the same class of transient overlay. Code-review's
visual-fidelity check is intentionally skipped; the § View treatment below is the design decision in
its place, and it is expressed entirely in existing theme tokens (no new token, no color literal).

A dedicated transient-status visual remains a Figma-side follow-up for Juhana, pairing with the same
request #493 carried forward.

## Files to read first

| Path | What to extract |
|---|---|
| `src/renderer/src/store/threadTimeline.ts:85-119` | The `apiRetry` `ThreadEvent` arm + `ApiRetryStatus` + `TimelineState`. The exact template — this slice adds a fifth field of the same class. |
| `src/renderer/src/store/threadTimeline.ts:177-308` | `reduceTimeline`. Every arm spells out **all** state fields explicitly (never a `...state` spread) — match that. Note `:219` and `:229`: the two `&& !state.stalled` widened guards. **These must not gain a compaction term** — see § The trap. |
| `src/renderer/src/store/threadTimeline.ts:280-304` | The `apiRetry` reducer arm — the two-edged clear-semantics template this arm collapses. |
| `src/renderer/src/store/threadTimeline.ts:310-321` | `initialTimelineState` + the four selectors. |
| `src/renderer/src/store/timelineBridge.ts:92-103` | The `apiRetry` owned arm — the shape to copy (carries `active`), **not** the nullary `stallDetected` arm at `:86`. |
| `src/renderer/src/store/timelineBridge.ts:104-153` | The null fall-through cluster. `case 'compacting':` sits at `:130`; this slice moves that label out. The `:141`/`:148`/`:150` prose comments explain the cluster — the compaction sentence at `:150-152` is now discharged. |
| `src/renderer/src/store/timelineStore.ts:49-51` | The one-line selector re-export to widen. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:88-108` | The store-slice reads. `selectCompacting` joins them on the `selectApiRetry` line's pattern. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:155-168` | The message-list region composition — the three indicator siblings and their mount order. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:502-529` | `STALL_COPY` + `StallIndicator` — the closest structural twin (boolean prop, `null` at rest, client-owned copy). |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:539-559` | `ThreadStatus` + `shouldShowThinking`. The `:542` comment names this ticket as the intended extender: one field, one clause. |
| `src/renderer/src/screens/conversation/conversation.css:338-404` | `.conversation__thinking` / `.bubble--thinking` / `.conversation__stall` / `.bubble--stall` / `.conversation__api-retry` / `.bubble--api-retry`. The wrapper is identical across all three; the four-way visual matrix in § View is built from these. |
| `src/shared/ipc/events.ts:135-144` | The `compacting` `DaemonEvent` arm this slice consumes — one bool, no string field, no counter, not deduped. |
| `src/shared/wire/types.ts:305-330` | `CompactingPayload` + the restated wire semantics (explicit falling edge, banner-only). |
| `docs/knowledge/codebase/493.md` | The direct precedent, including its § Lessons learned — the per-arm "does it clear on turn activity?" question this ticket answers **no** to. |
| `docs/specs/architecture/493-*.md` | The spec this one is a delta against. |
| `src/renderer/src/store/threadTimeline.test.ts:320-400, 470-480` | The `apiRetry` reducer test block + the `initialTimelineState` assertions to extend. |
| `src/renderer/src/store/timelineBridge.test.ts:150-238` | The null-cluster test; the `{ type: 'compacting', active: true }` entry at `:234` moves out of the `others` array. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:435-530, 1395-1410` | The `StallIndicator` / `ApiRetryIndicator` / `shouldShowThinking` describes to mirror, plus the store-binding smoke test. |

## Context

Claude's auto-compaction takes tens of seconds of total silence on the content channel. Today the
desktop head shows the generic thinking indicator or nothing, so a compacting session is
indistinguishable from a wedged one. #495 decoded the daemon's `compacting` frame into
`{ type: 'compacting'; active: boolean }` and shipped it dormant behind all three exhaustive bridges.
This slice wires it to a visible status and closes the loop.

Three wire facts drive the whole design, and two of them are places where copying the nearest
precedent would be wrong:

1. **Explicit falling edge.** `compacting` sends a real `active: false`. The indicator clears on that
   and on nothing else — the deliberate inverse of `stalled`, which is onset-only and self-clears.
2. **Banner-only.** No percentage, no counter, no elapsed time on the wire. Nothing numeric may be
   invented. This is the whole delta from `apiRetry`, which carries `current`/`total`.
3. **Not deduped.** The transport holds no state, so a verbatim repeated frame reaches the reducer.
   Idempotency is the reducer's job.

## Design

### 1. `threadTimeline.ts` — the fifth scalar

**`ThreadEvent` gains one arm**, field-for-field identical to the `DaemonEvent` arm so the bridge stays
a filter + fresh copy (the `apiRetry` / `toolUse` discipline, not `stallDetected`'s nullary
arm-selection-only shape — this event carries a field):

```ts
| { type: 'compacting'; active: boolean }
```

The event keeps `active` (the raw wire edge). The reducer stays the **single** place that translates an
edge into state — the same division of labour #493 established.

**`TimelineState` gains one field:**

```ts
compacting: boolean
```

**Deliberate divergence from `apiRetry`'s `ApiRetryStatus | null`.** #493 used `| null` because it held
a counter, and `| null` made "the falling edge discards the counter" true by construction — there was
nowhere for stale data to hide. Here there is no data to hide: `compacting` is a pure liveness fact, so
a plain boolean is the honest representation and `boolean | null` would invent a third state the wire
cannot produce. This is the `stalled` shape, with `stalled`'s *clear semantics* inverted. Do **not**
introduce a `CompactingStatus` record — that would be cargo-culting #493's structure past the reason
for it.

**One new reducer arm.** Both edges collapse into a single same-reference-or-fresh-state expression,
because the state is exactly the event's payload:

- Signature/behaviour: `case 'compacting'` returns `state` unchanged when `state.compacting === event.active`
  (idempotent on a verbatim repeat of **either** edge, AC3); otherwise returns fresh state with
  `compacting: event.active` and `items` / `phase` / `stalled` / `apiRetry` all carried through unchanged.
- Spell out all five fields in the returned literal — the file's house style, never `...state`.
- `items` and `phase` are untouched on every path: compaction is chrome, and it neither opens, closes,
  nor alters a turn (AC5, and the ticket's "`phase` is untouched by it").
- It neither clears nor is cleared by `stalled` or `apiRetry` — three independent daemon facts, the
  #317/#493 posture.

Symmetric idempotency is a genuine simplification over the `apiRetry` arm's two-branch body, and it
falls out of there being no counter to compare. Prefer it over a hand-split `if (!event.active)`.

**The other nine arms** each carry `compacting: state.compacting` through unchanged. This is
compile-forced (the field is required), so an omission is a type error, not a silent bug.

**`initialTimelineState`** gains `compacting: false`.

**One new selector**, `selectCompacting: (s: TimelineState) => boolean`, beside the existing four.

### 2. The trap — the two widened guards must NOT widen again

`threadTimeline.ts:219` (`toolResult`'s orphan/duplicate check) and `:229` (`turnState`'s same-phase
check) each carry `&& !state.stalled`, because turn activity clears a *stall*. #493 recorded that
resisting the instinct to copy that widening was the ticket's central risk, and left the standing
question for the next scalar: *does it clear on turn activity, or only on its own explicit signal?*

**Compaction clears only on its own falling edge.** So:

- Neither guard gains a compaction term. `compacting` is carried through unchanged on **both** the
  same-reference and the fresh-state path of each guard.
- Adding a required field is still the moment to re-audit every same-reference short-circuit. The three
  existing `.toBe(initialTimelineState)` churn-discipline assertions (`threadTimeline.test.ts:175`,
  `:330`, `:388`) must stay green — they are the tripwire, and from `initialTimelineState`
  (`compacting: false`) every no-op path still returns the identical reference.
- AC3's positive coverage is the four turn-activity cases below.

### 3. `timelineBridge.ts` — the ninth owned arm

Move `case 'compacting':` out of the null fall-through cluster at `:130` and into an owned arm placed
directly after the `apiRetry` arm (`:92-103`), returning a **fresh literal**, never `return event`:

```ts
case 'compacting':
  return { type: 'compacting', active: event.active }
```

- Copy the `apiRetry` arm's shape (it carries `active`), not `stallDetected`'s nullary one.
- Add a label; never repurpose an existing one. `:86` (`stallDetected`) and `:92` (`apiRetry`) are both
  owned consumers as of #317/#493 — editing on either anchor destroys a live consumer.
- The `assertNever` default keeps the switch exhaustive; leave it alone.
- Update the `translateTimelineEvent` docstring's arm count/list (`:23-25`, currently "the eight
  timeline arms") and retire the now-discharged `compacting`-ships-dormant sentence at `:150-152`.
- `daemonEventBridge.ts:144` and `modalBridge.ts:96` keep their no-op `compacting` arms **untouched** —
  and so do their tests. Only `timelineBridge` gains a consumer.

### 4. `timelineStore.ts` — one line

Widen the `:51` re-export to include `selectCompacting`. No other change: `createTimelineStore`'s
`init: TimelineState = initialTimelineState` default absorbs the new field with no edit.

### 5. `ConversationScreen.tsx` — read, gate, render

**Read** `const compacting = useTimelineStore(selectCompacting)` beside `apiRetry` (`:108`). Churn is
bounded by the reducer's same-reference discipline: a repeated frame produces zero re-renders under
zustand's `Object.is`.

**Extend the supersede seam — do not add a second gate.** `ThreadStatus` (`:543`) gains
`compacting: boolean`; `shouldShowThinking` (`:557`) gains one clause:

```ts
return status.phase === 'thinking' && status.apiRetry === null && !status.compacting
```

The call site at `:159` becomes `shouldShowThinking({ phase, apiRetry, compacting })`. Update the
`:539-542` comment, which currently forward-declares this ticket. This is exactly the one-field,
one-clause change #493 designed the record for — no parallel rule, no container-derived
mutually-exclusive status union, so both indicator views stay pure and independently unit-testable.

**Keep the name `ThreadStatus`.** #493 flagged a rename as fair game once `compacting` landed; the name
is still accurate for a record of thread-chrome scalars, and renaming costs edits across two files for
zero behaviour change. Don't spend turns on it.

**New copy constant + view**, the `STALL_COPY` / `StallIndicator` pair verbatim in structure:

- `export const COMPACTING_COPY` — module-level, client-owned (AC1: no daemon-supplied string is ever
  rendered). Constraints, all mandatory: apostrophe-free (`renderToStaticMarkup` escapes `'` →
  `&#x27;`, the standing desktop lesson), U+2026 ellipsis if it ends in one (matching `'Thinking…'` /
  `STALL_COPY` / `API_RETRY_COPY`), and it must read as *work in progress on the conversation itself*,
  not as an error and not as ordinary thinking. `'Compacting the conversation…'` satisfies all three;
  exact wording is the developer's call within them, the latitude #317 and #493 both took. Export it so
  tests assert against the constant, not a duplicated literal.
- `export function CompactingIndicator({ isCompacting }: { isCompacting: boolean }): JSX.Element | null`
  — takes a **boolean, not the store type**. That is what makes AC1 a type-level guarantee rather than a
  convention: the view structurally cannot receive a daemon string. (The `apiRetry` arm needed a record
  only because it renders digits; there are no digits here, so the `StallIndicator` signature is the
  right one.) `false` → `null` (zero layout footprint); `true` → the copy inside
  `<div className="conversation__compacting"><div className="bubble bubble--daemon bubble--compacting">`.
  Pure props-in/markup-out, exported so tests server-render an injected boolean with no store.
- No `switch`, no `assertNever` — there is no union to discriminate.

**Mount** `<CompactingIndicator isCompacting={compacting} />` directly after `<ApiRetryIndicator />`
(`:164`) and before `<StallIndicator />` (`:168`). That groups the two thinking-superseders (#493, #496)
contiguously below the indicator they occlude, leaves `StallIndicator` — the non-superseding,
co-rendering fact — last, and keeps both claims in #493's `:160-163` comment literally true, so that
comment needs no edit.

**AC4's exclusion is scoped to the thinking indicator only.** Compaction may co-render with the stall
and retry statuses; those are independent daemon facts and #493 set that posture deliberately. Do not
add cross-exclusion between compaction and stall/retry.

### 6. `conversation.css` — a fourth, separable treatment

Two rules appended after `.api-retry__counter` (`:404`). Both **must** sit after `.bubble--daemon` in
source order — equal specificity, so source order decides. Appending at the end of that cluster
preserves the invariant for free.

- `.conversation__compacting` — clone `.conversation__api-retry` (`:382-387`) verbatim:
  `flex: 0 0 auto; display: flex; justify-content: flex-start; padding: var(--space-2) var(--space-4);`.
  The wrapper is identical across all three existing indicators; keep it identical.
- `.bubble--compacting` — **do not reach for `--color-error`.** Both `.bubble--stall` and
  `.bubble--api-retry` use it because both signal a degrading session. Compaction is claude working
  normally, so painting it as a failure would be a design bug, not a shortcut. Instead: muted text
  (`color: var(--color-on-surface-variant)` — the `.bubble--thinking` treatment, because compaction
  *is* a working state) plus a leading accent bar in the primary role
  (`border-left: 4px solid var(--color-primary)` — the `.bubble--stall` bar *structure* with the error
  role swapped out).

That yields a fully separable four-way matrix, which is what AC1 actually demands:

| modifier | text role | left accent bar |
|---|---|---|
| `.bubble--thinking` | on-surface-variant | none |
| `.bubble--stall` | error | error |
| `.bubble--api-retry` | error | none |
| `.bubble--compacting` | on-surface-variant | **primary** |

Every cell is distinct from every other. Token names only — no color literal, no new theme token
(`--color-primary` already exists at `tokens.css:24`). Match `.bubble--stall`'s bar treatment exactly,
including its lack of padding compensation, so the two bars align.

## State + concurrency model

Pure renderer state. One store slice (`timelineStore`), one new scalar, one new selector. No async, no
cancellation, no teardown: the event arrives on the existing `onDaemonEvent` subscription that
`useTimelineBridge` already owns (mount → cleanup → mount nets one listener under StrictMode; unchanged
here). Nothing new crosses IPC — #495 already ships the event, and it carries one boolean.

Re-render behaviour: `compacting` flips at most twice per compaction. Every carry-through arm passes
the same value, and both edges return the same state reference on a verbatim repeat, so a repeated
daemon frame produces zero re-renders.

## Error handling

No new failure modes. The transport already type-validated the payload (#495 fails closed on a
malformed frame, dropping it without emitting). The reducer is total over the widened `ThreadEvent`
union and non-throwing; the bridge's `assertNever` is a compile-time guard, not a runtime path. The
view has no error state — `false` renders nothing.

The one thing that *could* go wrong is silent, not loud: a missed carry-through in one reducer arm. It
is compile-forced (required field), so the type-checker is the guard.

## Testing strategy

Test-first per the house convention: each criterion lands with a failing test first. Three test files
change; `daemonEventBridge.test.ts` and `modalBridge.test.ts` stay untouched (their `compacting` → null
assertions remain correct).

**`threadTimeline.test.ts`** — mirror the `apiRetry` block at `:320-400`, with a local `compacting(active)`
event helper:

- Rising edge sets `compacting` true; falling edge sets it false. (AC1, AC2)
- Verbatim repeated rising edge → the **same state reference** (`toBe`), asserting no stacking or
  flicker. Same for a repeated falling edge. (AC3)
- A falling edge against no live compaction → same reference (`toBe(initialTimelineState)`).
- **The four turn-activity carry-through cases** — dispatch a rising edge, then each of
  `assistantDelta` / `toolUse` / `toolResult` / `turnState`, and assert `compacting` is **still true**
  after each. This is the trap's tripwire, the direct analog of #493's four cases. (AC3)
- Conversely: `stallDetected` and `apiRetry` edges leave `compacting` unchanged, and a compaction edge
  leaves `stalled` / `apiRetry` / `phase` unchanged. (independence)
- `items` is untouched across a full rising→falling cycle — same array reference, still empty from
  `initialTimelineState`. (AC5)
- The three existing `.toBe(initialTimelineState)` assertions (`:175`, `:330`, `:388`) still pass —
  extend the `initialTimelineState` describe at `:475` with `compacting` false and
  `selectCompacting(initialTimelineState) === false`.

**`timelineBridge.test.ts`** — remove the `{ type: 'compacting', active: true }` entry (and its
`:232-233` comment) from the `others` null-cluster array at `:234`, and add an owned-arm test:

- `translateTimelineEvent({ type: 'compacting', active: true })` → `{ type: 'compacting', active: true }`,
  and the same for `false`.
- The returned object is **not** the input object (`not.toBe`) — the fresh-literal discipline.

**`ConversationScreen.test.tsx`** — mirror the `StallIndicator` (`:435`) and `shouldShowThinking`
(`:505`) describes:

- `CompactingIndicator` with `isCompacting={false}` server-renders to `''`. (zero footprint at rest)
- `isCompacting={true}` renders markup containing `COMPACTING_COPY` and the
  `conversation__compacting` / `bubble--compacting` classes. (AC1)
- `COMPACTING_COPY` contains no `'` (the escaping lesson) and is not equal to `'Thinking…'`,
  `STALL_COPY`, or `API_RETRY_COPY` — textual distinctness. (AC1)
- `shouldShowThinking`: thinking + no retry + **not** compacting → `true`; thinking + compacting →
  `false`; thinking + compacting + retry → `false`; `idle`/`responding` + compacting → `false`. (AC4)
- Regression: thinking + no retry + not compacting is still `true` — the pre-#496 behaviour is
  unchanged when no compaction is in flight. (AC4)
- Extend the store-binding smoke test (`:1395-1410`): the inert render contains neither
  `COMPACTING_COPY` nor the compacting classes, alongside the existing `API_RETRY_COPY` assertion.

Type-level coverage rides `npm run typecheck` (the required `TimelineState` field, the widened
`ThreadEvent` union, the two `assertNever` guards). Gates: `npm test`, `npm run typecheck`,
`npm run build`.

## Scope note (for code-review)

The § 4 self-check counts production `*.ts` / `*.tsx` files, excluding tests, markdown, and the spec.
This spec prescribes **four**: `threadTimeline.ts`, `timelineStore.ts`, `timelineBridge.ts`,
`ConversationScreen.tsx`. Under the ≥5 gate that is a clean pass, not an override. The fifth touched
production file, `conversation.css`, is not a `.ts`/`.tsx` file and does not count; the total is
8 files (4 TS + 1 CSS + 3 test), 0 new files — the measured shape of #493 (`3dd3919`, 8 files /
459 insertions) and #317 (`aea4141`, 8 files / 272 insertions).

Other red lines, checked concretely rather than argued:

- **New files:** 0.
- **Total written LOC:** projected ~350–400. #493 is the direct measured benchmark at 459 insertions;
  this slice is strictly smaller — no counter record, no `total > 0` formatting gate and its test cases,
  no `.api-retry__counter` rule, and a single-expression reducer arm instead of a two-branch one.
- **New exported symbols:** 3 (`selectCompacting`, `CompactingIndicator`, `COMPACTING_COPY`).
  `ThreadStatus` and `shouldShowThinking` are extended, not added.
- **Consumer call sites needing simultaneous update:** the compile-forced set is the 9 reducer arms plus
  `initialTimelineState`, all inside `threadTimeline.ts`. Cross-file forced edits: **0** —
  `timelineStore.ts:33`'s `init: TimelineState = initialTimelineState` default absorbs the new field,
  and the store's one-line selector re-export is a deliberate addition, not a cascade. Verified by
  grepping every `TimelineState` occurrence in `src/` and `e2e/`.
- **Acceptance criteria:** 5, at the boundary, each small and mapped 1:1 to test scenarios above.
- **Reject/error branches:** 0.

No subset of the four files is independently shippable — a store-only child would be unreachable dead
code, and a view-only child would have no state to read. This is the same irreducible compile-atomic
set that carried #493, #495, and #317.

**Overlap check (§ 1.5):** ran against all `origin/feature/*` branches after `git fetch --prune` for
all eight files above. Zero overlaps. No blocker set.

**Security review (§ 3):** not run — the ticket does not carry `security-sensitive`, correctly. Pure
renderer: no keys, sockets, or raw frames, and #495's transport slice (which *was* security-reviewed)
already type-validated the payload. The event carries one boolean and no string field, so nothing
daemon-supplied can reach the DOM. This matches #317 (not security-sensitive) and #493 (not
security-sensitive); #315 and #495, the transport halves, were.

## Open questions

- **Exact `COMPACTING_COPY` wording** — the developer's call within the § 5 constraints, not verified
  against mobile's string (the latitude `STALL_COPY` and `API_RETRY_COPY` both took).
- **Accent-bar-in-primary vs. another non-error distinguisher.** The four-way matrix above is the
  design decision this spec makes in the absence of a Figma node. `--color-tertiary` and
  `--color-outline-variant` are the alternatives if a later visual pass prefers a softer mark; it is a
  one-token change in one CSS rule.
- **A full precedence chain.** AC4 scopes exclusion to the thinking indicator only, so compaction,
  stall, and retry may all co-render as three stacked rows. That is the deliberate #493 posture. If the
  design later wants strict precedence among them, `shouldShowThinking` / `ThreadStatus` is the seam it
  extends — this ticket is the second proof that the seam grows by one field and one clause.
- **No `aria-live` on any of the four indicators.** Compaction inherits the same gap `ThinkingIndicator`,
  `StallIndicator`, and `ApiRetryIndicator` have; a screen reader is not announced when any of them
  appears. House-wide accessibility follow-up, explicitly **not** a gate on this ticket — fixing it here
  would touch three components this slice otherwise leaves alone.
