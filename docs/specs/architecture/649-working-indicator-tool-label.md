# #649 — label the working indicator with the open tool call

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/649 (split from #597, blocked by #648 — merged at `22c59fd`)
**Size:** S — 1 production `.tsx` file + 1 CSS file + 1 test file. ~55 lines of production change (at this file's comment density), ~100 lines of test change.
**Anchors** verified at `b5d1e7b`.
**Not `security-sensitive`** (no label): renderer-only, no `src/main/` or wire change, and the string this ticket surfaces is already decoded, already stored, and already rendered through the same React auto-escaping two rows above (`:551`). No security-review pass runs.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8

Node `16-8` is the Conversation Thread screen the indicator sits in — a single scrolling column of left-aligned muted daemon bubbles and right-aligned filled user bubbles, with one tool row, a session delimiter, a fenced code block and the composer pinned at the bottom. Confirmed by screenshot: **there is no working/thinking indicator node anywhere in the frame**, the same genuine design gap already recorded for #215, #317, #493 and #496, so this ticket introduces no new visual — the label keeps the interim treatment (`.conversation__thinking` wrapper, muted `.bubble--thinking` daemon-bubble surface).

N/A for this ticket's specific state, therefore. The one thing the design does settle is the *treatment of an untrusted single-line run*: node `16-31` — the tool row's input summary, drawn as `kitchenclaw/db/schema.ts · 184 lines` — is M3 body-small, `on-surface-variant`, **`whitespace-nowrap`**. That is `.tool-row__summary` (`conversation.css:951`), and it is the bound this ticket reuses. Node `16-30` (the mono tertiary `read_file` run) is the trap the ticket body flags: see § The one-line bound.

## Files to read first

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:789-822` | `ThinkingIndicator` + its prop-contract comment. **`:803` is the sentence this ticket reverses** — read it verbatim before touching anything; the reconciliation is an AC, not a courtesy. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:98-103` | The container's `items` and `phase` reads. `:100` carries the **second** copy of the same reversed claim; `:97` is why `items` needs no new subscription. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:765-792` | `THINKING_COPY` / `WORKING_COPY` — the exported client-owned copy-constant idiom the new label joins (apostrophe-free, U+2026). |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:867-910` | `ThreadStatus`, `shouldShowThinking`, `workingIndicatorState`. **None of the three changes.** Read them to confirm the supersede clauses (AC3) are reached before any tool label can render. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:179-183` | The indicator mount — `:183` is the only production call site of `ThinkingIndicator`. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:530-556` | The `toolCall` row. Its comment states the posture this ticket inherits for `name`: an inert auto-escaped React child, never `dangerouslySetInnerHTML`. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:925-950` | `ApiRetryIndicator` — the one existing precedent for a *client constant plus an interpolated variable run* inside an indicator bubble. |
| `src/renderer/src/store/threadTimeline.ts:40-56` | `ThreadItem`, and the `toolCall` member's `result: ToolResult \| null` with its "filled in place" comment — the whole basis of the derivation. |
| `src/renderer/src/store/threadTimeline.ts:206-229` | `fillResult` — returns a **new** array on a match (so the container re-renders) and the **same** reference on an orphan/duplicate. This is AC2's mechanism. |
| `src/renderer/src/screens/conversation/conversation.css:295-303` | `.bubble` — `max-width: min(680px, 75%)` (AC5's width half, already free) and `word-break: break-word` (AC5's wrap half, the actual job). |
| `src/renderer/src/screens/conversation/conversation.css:743-758` | `.conversation__thinking` (a flex row — this is why `min-width: 0` is load-bearing below) and `.bubble--thinking`. |
| `src/renderer/src/screens/conversation/conversation.css:937-963` | `.tool-row__name` (the **wrong** precedent) immediately above `.tool-row__summary` (the right one). Read both, and the `.conversation__workspace-chip-cwd` copy at `:186`. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:593-643` | The `ThinkingIndicator` describe — three `it`s whose **assertions all stand verbatim**; only the JSX prop lists grow. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:430-450` | #609's cross-cutting bubble-class assertion; `:437` and `:445` render `<ThinkingIndicator state="thinking" />`. Mechanical prop addition, no assertion change. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1737-1742` | **The zustand v5 server-snapshot gotcha, stated in the repo's own words.** `useStore` reads `getInitialState()` under `renderToStaticMarkup` and never sees `setState`, so no container test can prove the running/populated branch. This is why § Testing strategy makes the prop required rather than optional. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1651-1662` | The idle container smoke. **It needs no change** — its `not.toContain('conversation__thinking')` already covers the new label, which renders inside that same wrapper. |

## Context

The daemon flips `turn_state` to `responding` on the first reply token or tool step and stays silent there for the rest of the turn. #648 used that to hold the indicator up for the whole running turn with a generic `Working…`. The operator's complaint from the same 2026-08-20 session is the next layer: a turn that is mostly tool work now says *something*, but it says the same thing for a 40 ms file read and a four-minute build.

The timeline already carries the answer. A `toolCall` item (`threadTimeline.ts:43-50`) holds `name` and starts `result: null`, filled in place when the correlated `toolResult` arrives — so "a tool is open right now" is a pure read over the `items` slice the container already selects (`:97`). No new wire field, no daemon change, no new store state, no new subscription.

### The invariant this ticket reverses, deliberately

#648 wrote a type-level guarantee into two comments — `ConversationScreen.tsx:803` (the `ThinkingIndicator` contract) and `:100` (the container's `phase` read): the prop's only inhabitants are two client-owned literals and null, *"so the view structurally cannot render a daemon string ... a type-level guarantee rather than a convention."*

AC1 requires the opposite. Per the operator's 2026-08-20 decision this is intended — the tool row two lines above already renders the same `name` as escaped inert text, so the indicator adds no exposure that is not already on screen. **The design constraint is that the reversal must be narrow and legible**, and that both comments must be reconciled in the same change: leaving `:803` and `:100` asserting the reverse of the code is the specific failure this ticket's body calls out.

What survives is the narrower half: **the label choice stays a closed client-owned union; exactly one, separately-named prop carries the daemon string.** The design below is chosen to make that sentence true at the type level rather than by convention.

## Design

Two production files: `ConversationScreen.tsx` and `conversation.css`. Nothing in `src/main/`, nothing in the store, no new file.

### Prop shape — a second prop, not a widened union

```ts
export function ThinkingIndicator({ state, toolName }: {
  state: WorkingIndicatorState | null   // unchanged: 'thinking' | 'working'
  toolName: string | null               // NEW — the one daemon string, required
}): JSX.Element | null
```

`WorkingIndicatorState` (`:787`), `ThreadStatus` (`:867`), `shouldShowThinking` (`:896`) and `workingIndicatorState` (`:906`) are **all untouched**. Three shapes were on the table:

- Fold the name into `WorkingIndicatorState` as a third union member — rewrites the type #648 built and dissolves the client-owned half into the same type as the daemon half, which is exactly the distinction AC4 asks to preserve.
- Grow `ThreadStatus` by an `openTool` field (the #493 record-growth precedent) — the precedent is real, but it breaks eight `workingIndicatorState({ phase, apiRetry, compacting })` call sites in the test file whose assertions are #648's and #493's regression evidence, and it makes the tool name a *thread status* when it is a *timeline* fact.
- **This one.** The reversal is one prop wide and reads at a glance: closed client union for the label choice, one `string | null` named for what it is. All five existing `<ThinkingIndicator …>` renders and all eight `workingIndicatorState(…)` calls keep their assertions verbatim; only the five JSX prop lists grow by `toolName={null}`.

**`toolName` is required, not optional.** Optional would let the container silently omit it, and § Testing strategy explains why nothing in this repo could catch that — `tsc` is the only available detector, so the type must be the one that fails.

### Precedence inside the view

1. `state === null` → `return null`. This is first, so #493's and #496's supersede rules are reached before any tool label can render: a live api-retry or compaction still hides the indicator entirely, in either phase (AC3), and `openToolName` cannot resurrect it.
2. `toolName !== null` → the tool label.
3. otherwise → the existing `state === 'thinking' ? THINKING_COPY : WORKING_COPY` (AC3, unchanged).

Ordering 2 above 3 makes `{ state: 'thinking', toolName: 'Bash' }` well-defined rather than illegal: an open tool wins over the phase-derived copy, the same way `apiRetry` presence wins over both. It should not arise in practice (the daemon flips to `responding` on the first tool step), so it is a defined edge, not a defended one.

### The derivation

```ts
/** The `name` of the most recently started still-open tool call, or null if none is open. */
export function openToolName(items: readonly ThreadItem[]): string | null
```

Lives in `ConversationScreen.tsx` beside `workingIndicatorState`, **not** in `threadTimeline.ts`: the file's own precedent is that pure derivations over store types live with the view that consumes them (`isTurnRunning(phase: TurnPhase)` at `:987` is exactly that shape), and this keeps the store untouched.

Behaviour, per AC1's pinned derivation: the last element in array order with `kind === 'toolCall' && result === null`, returning its `name`; `null` when there is none. `items` is append-only and `fillResult` fills in place without reordering, so array order *is* start order. Name returned verbatim — no trim, no emptiness check, no length cap (see § Open questions).

⚠ **`Array.prototype.findLast` is not available.** `tsconfig.web.json` sets `lib: ["ES2020", …]` and `findLast` is ES2023 — it will fail `npm run typecheck`. Use a descending `for` loop with an early return. Nothing else in `src/` uses `findLast`.

Call site (`:183`) becomes:

```tsx
<ThinkingIndicator
  state={workingIndicatorState({ phase, apiRetry, compacting })}
  toolName={openToolName(items)}
/>
```

`items` is already in scope at `:97` for `Timeline`; no new `useTimelineStore` subscription.

### The copy

```ts
/** The client-owned label naming the tool the daemon is currently running: `Running <name>…`. */
export function toolWorkingCopy(name: string): string
```

A function rather than a constant because this copy has a hole — but **both** fixed runs (the leading verb and the trailing U+2026) live inside it, so "the fixed copy is client-owned and only the name is daemon-supplied" is true of one readable unit. Apostrophe-free (`renderToStaticMarkup` escapes `'` → `&#x27;` — the standing desktop lesson), U+2026 not three dots, matching `THINKING_COPY` / `WORKING_COPY` / `API_RETRY_COPY` / `COMPACTING_COPY`.

Rendered as a **single text child** of the bubble — `{toolWorkingCopy(toolName)}` — not as constant-plus-span like `ApiRetryIndicator`. That is deliberate and load-bearing for the layout below: one text run ellipsizes as one unit, so on overflow the client `…` is truncated away *and replaced by the ellipsis the truncation itself draws*. Splitting the name into its own span would produce `Running some-long-na…  …` — two ellipses — and buys nothing, since the name needs no distinct type or colour (there is no Figma node for this state, and the indicator is one muted run).

React auto-escaping applies to that text child exactly as it does to `{item.name}` at `:551`. No `dangerouslySetInnerHTML`, no HTML sink, no new one introduced (AC4).

### The one-line bound

One new CSS rule, applied only on the tool branch:

```css
/* AC5: the daemon tool name is unbounded, so the label gets .tool-row__summary's bound. */
.bubble--tool-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Four points a reviewer should be able to check against the rule as written:

- **`white-space: nowrap` is the whole job.** `.bubble`'s `max-width: min(680px, 75%)` (`:295`) already satisfies "does not widen past the thread measure" by construction — do not rebuild it. `.bubble`'s `word-break: break-word` is what wraps a long name to a second line today; `nowrap` overrides it for this element only. It also collapses a `\n` inside a daemon name to a space, so an embedded newline cannot break the line either.
- **`min-width: 0` is not decoration.** `.conversation__thinking` (`:746`) is `display: flex`, so the bubble is a flex item with `min-width: auto` → an automatic minimum of its `min-content` width, which under `nowrap` equals the full line. A `min-width` floor beats a `max-width` cap in CSS, so without this declaration a long name pushes the bubble *past* 680px and out of the container. This is why `.tool-row__summary` (`:951`) and `.conversation__workspace-chip-cwd` (`:186`) both carry it.
- **`.tool-row__name` (`:937`) is the wrong reach** even though it is the semantic match. It is `flex: 0 0 auto` + `nowrap` and its comment says the name "never shrinks or truncates" — it gets away with that only because `.tool-row__summary` sits beside it absorbing the truncation. The indicator has no such neighbour, so that treatment overflows. Figma `16-31` (the summary run) is `whitespace-nowrap` too; `16-30` (the name run) is the one that relies on its neighbour.
- **Applied as an extra modifier on the tool branch only**, alongside `bubble bubble--daemon bubble--thinking`. The two existing labels then render byte-identical markup, so the #648/#609 assertions stand as AC3's regression evidence rather than being retyped. The name is `--tool-label`, *not* `--thinking-tool`, so it does not contain `bubble--thinking` as a substring — a modifier that did would make every existing `toContain('bubble--thinking')` pass even if the base class were dropped.

No new tokens, no colour or type literals, no change to the wrapper or to `.bubble--thinking`.

### Comment reconciliation (AC-level, not housekeeping)

Two comments assert the reverse of the new code and **must** be rewritten in this change:

- `:803` (inside the `ThinkingIndicator` contract block) — restate as the narrowed guarantee: the *label choice* remains a closed union of client-owned literals; one separately-typed `toolName` prop is the single daemon string, rendered as an escaped text child, never through an HTML sink. Name #649 and the operator's 2026-08-20 decision as the reason, so the reversal reads as deliberate.
- `:100` (the container's `phase` read) — same correction, in one line.

⚠ **Scope trap:** seven other "type-level guarantee" comments in this file (`:106`, `:111`, `:118`, `:839`, `:917`, `:961`, `:1001`) belong to `StallIndicator`, `ApiRetryIndicator`, `CompactingIndicator` and `InterruptButton`. Every one of them is **still true** and must not be touched. Only the two thinking-indicator sites reverse. The test-file describe header at `:597-599` repeats the claim and should get the same one-line correction.

**Renaming stays out of scope** (ticket body): `ThinkingIndicator`, `.conversation__thinking`, `.bubble--thinking` and `shouldShowThinking` carry ~40 references including `e2e/queued-backlog-interrupt.spec.ts`. #648 froze them; this ticket inherits the freeze.

## State + concurrency model

No new state, no new store slice, no new subscription, no async work, nothing to cancel. The label is a pure function of the `items` array the container already holds.

AC2 falls out of `fillResult` (`threadTimeline.ts:213-229`): on a matching `toolResult` it returns a **new** array with a copied item, so `selectItems` yields a new reference, the container re-renders, `openToolName` recomputes to `null`, and the label reverts to `WORKING_COPY` — with no `turn_state` or any other subsequent daemon event required. On an orphan or duplicate result it returns the **same** reference, so nothing churns.

`openToolName` runs once per container render over an array that is already being mapped by `Timeline` on the same render; no memoisation, in line with `workingIndicatorState` beside it.

## Error handling

No new failure modes: no I/O, no parsing, no promise, no throw path. `openToolName` is total over `readonly ThreadItem[]` — an empty array, an array with no `toolCall`, and an array whose `toolCall`s are all resolved each return `null`, which renders the #648 behaviour.

The one adversarial input is the daemon-supplied `name`. It is handled by not being special-cased: it reaches the DOM only as a React text child (auto-escaped), so a name containing `<img src=x onerror=...>` appears literally. There is no sanitiser to write and none should be written — introducing one here would be the new mechanism AC4 is pinning *against*.

## Testing strategy

`npm test` (vitest, `renderToStaticMarkup`, node env — no DOM, no layout engine) plus `npm run typecheck`. Scenarios, as behaviour not code:

**`openToolName` — a new describe beside `workingIndicatorState`'s:**
- empty array → `null`.
- items with no `toolCall` → `null`.
- one open `toolCall` → its `name`.
- one `toolCall` whose `result` is filled → `null`.
- two open calls, appended in order → the **later** one's name (AC1's tie-break).
- an open call followed by a *later* resolved call → the open one's name (proves it selects on `result === null`, not on position alone).
- the same array after `fillResult`-style resolution of the last open call → falls back to an earlier open call, or `null` when none remain (AC2 at the derivation level).

**`ThinkingIndicator` — added to the existing describe:**
- `state="working"` + `toolName="Bash"` → markup contains the tool label and `bubble--tool-label`, and does **not** contain `WORKING_COPY` or `THINKING_COPY`.
- `state="working"` + `toolName={null}` → unchanged #648 behaviour (this is the existing `it`, with the prop added).
- `state={null}` + `toolName="Bash"` → `''`. The supersede rule wins over an open tool (AC3).
- Escaping (AC4): render with a name like `<img src=x onerror="alert(1)">`; assert the markup contains the escaped form (`&lt;img`), does **not** contain `<img`, and does not match `/\son[a-z]+="/`. Attribute-shaped guards, not a bare `not.toContain` — a `not.toContain('src=')` would pass vacuously.

**`toolWorkingCopy`:**
- pins the rendered value for a benign name (`toolWorkingCopy('Bash')` → `'Running Bash…'`), so the copy cannot drift silently — the `expect(THINKING_COPY).toBe('Thinking…')` precedent.
- apostrophe-free, and lexically distinct from `WORKING_COPY` / `THINKING_COPY` / `API_RETRY_COPY` / `COMPACTING_COPY`.
- returns the name verbatim for a hostile name (escaping is the renderer's job, not this function's).

**Five mechanical prop additions** — `toolName={null}` at `ConversationScreen.test.tsx:437`, `:445`, `:605`, `:609`, `:621`. Assertions unchanged; they are AC3's regression evidence.

**No container test, and none is possible.** zustand v5's `useStore` reads `getInitialState()` under server rendering and never sees `setState` — the repo states this at `ConversationScreen.test.tsx:1737-1742` and again at `:1729-1731`. Every container smoke here therefore renders the idle store. The consequence for this design: **the only detector that the container actually passes `toolName` is `tsc`**, which is why the prop is required. The existing idle smoke at `:1655-1661` needs no change — `not.toContain('conversation__thinking')` covers the new label, which lives inside the same wrapper.

**AC5 has no vitest detector, by construction.** Server-render-only tests plus no CSS-text assertion pattern in this repo means the one-line bound is discharged by review of the four declarations on `.bubble--tool-label` and by the `min-width: 0` argument above — not by an assertion. Do not invent a CSS-text assertion for it, and do not add an e2e in this ticket. (If one is ever added it must read computed style or box geometry: Playwright's `toHaveText` normalises whitespace, so a text-shaped assertion would pass vacuously.)

No e2e change. `e2e/queued-backlog-interrupt.spec.ts` and `e2e/thread-scroll-pin.spec.ts` assert only that the indicator is visible while running and absent at idle; both remain true.

## Open questions

- **A stale open tool call outlives its turn.** If a turn is interrupted mid-tool the daemon may never send the `toolResult`, leaving a `toolCall` with `result: null` in `items` forever — and the *next* turn's indicator would then name that stale tool. AC1's derivation is pinned to array order with no turn scoping, so this spec implements exactly that and does not defend it: the timeline already shows that call as a permanently pending (50 %-dimmed) row from #230, so the label mirrors what is on screen rather than contradicting it. If the operator does observe a wrong name after an interrupt, the cheap fix is to stop the descending scan at the first `turnBoundary` item — one extra condition in the same loop, scoping the search to the current turn. Deferred until observed.
- **An empty or whitespace-only `name`** renders `Running …`. Degraded, not broken, and unobserved — the wire requires a `name` and every real tool has one. `openToolName` deliberately does not trim or reject; if this shows up, the fix belongs in the derivation (return `null`), not in the copy function.
- **Length cap.** None is specified: the CSS bound holds the slot on its own for any length, and the ticket says a character-count bound is worth adding only if it cannot. If a reviewer finds the ellipsis lands so early at narrow widths that the label is useless, that is a copy/measure question for the deferred desktop-design pass, not a code change here.
