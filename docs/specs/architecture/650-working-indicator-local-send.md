# Spec #650 — start the working indicator locally on send, and clear it robustly

**Ticket:** [#650](https://github.com/pyrycode/pyrycode-desktop/issues/650) — split from #597 (third child; #648 and #649 shipped).
**Size:** S. Three production files (`threadTimeline.ts`, `timelineStore.ts`, `ConversationScreen.tsx`), one new `TimelineState` scalar threaded through 13 in-arm return literals, one new selector, one new composed derivation, one mount-site read.
**Security-sensitive:** No. Renderer-only; no `src/main/` change, no wire field, no transport surface, no pairing-scoped state. The new scalar is a client-owned boolean that carries no daemon content and gates only which client-owned label renders. (Same posture as the unlabelled #317/#493/#496/#648/#649 render-half family; the labelled exception is the pairing-scoped *clear* family, #530/#531/#593, which this is not.)

---

## Files to read first

- `src/renderer/src/store/threadTimeline.ts:162-179` — `TimelineState`: the four existing chrome scalars beside `items`/`phase`, each with its clear-semantics doc. **The new field lands here, and its comment must classify it against these four.**
- `src/renderer/src/store/threadTimeline.ts:231-236` — `reduceTimeline`'s doc comment: the `items`/`phase` orthogonality this ticket qualifies. **Update per Technical Notes; see § "What the orthogonality comment should now say".**
- `src/renderer/src/store/threadTimeline.ts:237-491` — the whole reducer. **13 in-arm state literals, each writing all five fields out; every one is a compile error until the new field is classified.** The arm-by-arm table below is the classification.
- `src/renderer/src/store/threadTimeline.ts:291-306` — the `turnState` arm and its `event.state === state.phase && !state.stalled` early-out. **The trap the ticket names: widen it or AC2 fails only in the already-idle case.**
- `src/renderer/src/store/threadTimeline.ts:442-451` — the `reset` arm: returns the shared `initialTimelineState`, so a sixth field clears for free (AC5, zero production lines).
- `src/renderer/src/store/threadTimeline.ts:452-487` — the `reconnected` arm: hand-written literal **and** an early-out predicate at `:479` that the compiler cannot keep in sync. **Both must be extended by hand (AC3).**
- `src/renderer/src/store/threadTimeline.ts:493-506` — `initialTimelineState` + the five selectors. One field, one selector.
- `src/renderer/src/store/timelineStore.ts:49-56` — the selector re-export block. One line; the container imports selectors from here, never from the reducer module.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:97-123` — the container's six narrow store reads. **The new read goes beside `compacting`, in the same commented idiom.**
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:182-192` — the `ThinkingIndicator` mount site: the only production call of `workingIndicatorState`. **One argument changes here.**
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:931-977` — `ThreadStatus`, `shouldShowThinking`, `workingIndicatorState`. **All three are FROZEN by this spec — read them to see why the new derivation composes on them instead of extending them.**
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:1002-1008` — `openToolName`, and its `:997-1001` "known, deliberately undefended" note. Relevant to Open questions; **no change here.**
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:1080-1088,1144-1160` — `isTurnRunning` and `InterruptControl`. **Read to confirm AC4 holds by construction: the container reads `selectPhase` alone.**
- `src/renderer/src/screens/conversation/composerSend.ts:41-70` — `submitMessage`: both `false` returns (`:47`, `:48`) sit **above** the echo dispatch at `:67`. **This is why AC1 needs no new event and no change to this file.**
- `src/renderer/src/store/threadTimeline.test.ts:15-70` — the event fixture builders and the `run([...])` fold. **No full-state literal in the file (measured: 35 `initialTimelineState` uses, zero five-field literals) ⇒ zero fixture cascade.**
- `src/renderer/src/store/threadTimeline.test.ts:620-640,675-765` — the `reset` and `reconnected` suites and their two `dirty()` helpers. **A live trap: see § "The `dirty()` fixture trap".**
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:846-955` — the existing gate pins: **19 `ThreadStatus` object literals** across 20 call sites on 19 lines (12 inline under `shouldShowThinking`, 6 inline under `workingIndicatorState`, and 1 shared `status` literal at `:951` that `:952` passes to both). **Every one must still compile and pass untouched — that is this spec's central constraint.**

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8

Node `16-8` is the Conversation Thread screen — right-aligned blue operator bubbles against left-aligned muted daemon bubbles, a compact tool row, the session-boundary delimiter, the model/effort/context status row, and the composer. **N/A for the working-indicator state specifically:** the node has no working-indicator frame, the design gap already recorded for #215, #317, #493, #496 and reconfirmed for #649. This ticket changes only *when* the existing indicator is mounted, and reuses #648's and #649's interim treatment verbatim (`.bubble--thinking` on the daemon-bubble surface). **No CSS change, no new class, no new markup.**

---

## Context

From Enter until the daemon's first event the app sits in the `idle` phase left over from the previous turn. The optimistic echo enters the timeline as a `userText` item (`composerSend.ts:67`) and the reducer's `userText` arm deliberately leaves `phase` untouched, so nothing on screen changes until the daemon speaks. #648 closed the blank window in the *middle* of a running turn; this closes the one in *front* of it.

The daemon side is live: pyrycode **#1062 shipped 2026-07-17**, so `turn_state` now fans on per-conversation interactive sessions and the `turn_state{idle}` clear path (AC2) genuinely fires. #1062's own accepted residual — a conversation abandoned by a follow-active switch gets no `turn_state{idle}` at all — maps on the desktop onto a conversation switch, which dispatches `reset` (`activateConversation.ts:75`) and clears everything. AC5 covers it.

---

## Design

### The decision: a new scalar beside `phase`, and `phase` stays daemon-only

The ticket frames the choice as "a new scalar beside `phase` is as legitimate as widening `phase` itself". **Take the scalar.** Three reasons, in descending weight:

1. **`TurnPhase` is a wire mirror and must stay one.** `threadTimeline.ts:11` is cited by name at `:15` and `:22` as *the precedent* for the repo's deliberate-re-declaration discipline, and `src/shared/wire/types.ts:275` names it from the other side. `ThreadEvent`'s `turnState` arm is typed `state: TurnPhase` (`:96`), so a fourth renderer-local member would let any caller dispatch a fabricated daemon phase through a daemon-provenance arm — a type-level hole, and it would falsify `timelineBridge.ts:44-45`'s "the same literal union, so this assigns with no cast".
2. **The scalar keeps the documented invariant TRUE rather than qualifying it.** `reduceTimeline`'s doc comment says content events never touch `phase`. Under this design `userText` still never touches `phase` — it touches a chrome scalar, exactly as `assistantDelta` already writes `stalled: false`. The invariant the ticket expected to weaken is instead preserved; only the "chrome scalars are all daemon-sourced" reading needs qualifying.
3. **It makes AC4 free.** `InterruptControl` (`:1152-1160`) reads `selectPhase` and nothing else, and `isTurnRunning` (`:1086`) admits only `TurnPhase`. A signal that lives outside `phase` structurally cannot arm the interrupt control.

### The composition point: compose on the gate, do not extend `ThreadStatus`

**`ThreadStatus`, `shouldShowThinking` and `workingIndicatorState` are frozen — not one character changes in any of the three.**

Measured: adding a fourth field to `ThreadStatus` breaks **19 object literals** in `ConversationScreen.test.tsx` as compile errors, none of which change their expectation — a pure retyping cascade, and the exact thing #648's recorded lesson says to avoid. Composing a new function on top of the proven pair leaves all 19 standing verbatim as the regression evidence that #493's and #496's supersede rules survived.

Add one exported derivation beside `workingIndicatorState`:

```ts
export function workingIndicatorStateWithLocalSend(
  status: ThreadStatus,
  localSendPending: boolean
): WorkingIndicatorState | null
```

**Behaviour:** the daemon's answer wins; when the daemon has opened no window and a local send is pending, ask *the same gate* what it would say for a turn that has just begun. Three statements, no new branch logic:

- `workingIndicatorState(status)` non-null → return it unchanged (every daemon-opened case is byte-identical to today).
- `!localSendPending` → `null` (today's behaviour; AC1's refused-submit case).
- otherwise → `workingIndicatorState({ ...status, phase: 'thinking' })`.

Three properties fall out of that third line, and they are why it is written as a re-call rather than a fresh expression:

- **Supersede is inherited, not restated.** A live `apiRetry` or `compacting` still returns `null` because the same gate evaluates the same two clauses. There is no second place the supersede rule lives, so it cannot drift. The ticket asks for this to be decided deliberately and pinned — it is inherited, and § Testing pins it.
- **The label is `'thinking'`, and that is the right one.** The operator has pressed Enter and nothing has been produced, which is precisely what the daemon's own `thinking` phase means. It also makes the handover **flicker-free**: when `turn_state{thinking}` arrives the label is already `'thinking'`, so the moment the daemon takes over is invisible. Choosing `'working'` would flip Working → Thinking → Working at the exact seam this ticket exists to smooth.
- **`workingIndicatorState`'s doc comment stays literally true.** Its `:972` claim that `'idle'` is unreachable in the second branch holds, because the synthetic record it receives carries `'thinking'`, never `'idle'`.

The synthetic `phase` never escapes this function and never reaches the store, a view, or `isTurnRunning`. Its one job is gate reuse; say so in the comment.

### Store surface

`TimelineState` gains a sixth field:

```ts
localSendPending: boolean
```

Its doc comment must carry the one classification that matters: **this is the first renderer-sourced chrome scalar.** `stalled`, `apiRetry` and `compacting` are all daemon facts with a daemon edge; this one is opened by the operator's own act with no daemon involvement, which is exactly why its clear rules differ from all three (below). The `local` prefix is the provenance marker — keep it or an equivalent.

`initialTimelineState` gains `localSendPending: false`. `selectLocalSendPending` joins the five selectors and is re-exported from `timelineStore.ts` beside the others.

### Reducer arm classification

Every one of the 13 in-arm literals is a compile error until classified. This table **is** the classification — the developer should not re-derive it:

| Arm | `localSendPending` | Why |
|---|---|---|
| `userText` | **`true`** | The open (AC1). See § AC1 below. |
| `turnState` | **`false`** | The daemon has spoken; its phase is now authoritative (AC2). |
| `reconnected` | **`false`** | Mode B chrome — reconciled against the fresh handshake (AC3). |
| `reset` | *free* | Returns the shared `initialTimelineState` (AC5) — zero lines. |
| `assistantDelta`, `toolUse`, `toolResult` | carry through | **Deliberately NOT cleared — the inverse of `stalled`.** Content can arrive before any `turn_state`; clearing here would blank the indicator mid-turn while `phase` is still `idle`. |
| `turnEnd` | carry through | Not a clear edge. `turnEnd` is always paired with a separate `turn_state{idle}` (`:307-310`), which does the clearing. Clearing here would *regress*: a send issued while the previous turn is finishing would have its fresh window closed by the previous turn's boundary. |
| `sessionBoundary`, `unrecognizedMessage`, `stallDetected`, `apiRetry` (both literals), `compacting` | carry through | Independent facts; none is a statement about whether the operator's send was answered. |

### The two early-outs the compiler cannot catch

Both are silent failures — they compile clean and fail only in a specific case. Neither is optional.

- **`turnState:298`** — `event.state === state.phase && !state.stalled` must gain `&& !state.localSendPending`. Without it, `turn_state{idle}` arriving when `phase` is *already* `idle` returns the same state and the window never closes. This is the precise trap the ticket names, and it is the common case: the local window opens at `idle` and the daemon's terminal `turn_state` is `idle`.
- **`reconnected:479`** — the four-clause predicate must gain `&& !state.localSendPending`. Without it, a reconnect against a state whose only live chrome is a locally-opened window returns early and leaves it showing (AC3 fails exactly in the case AC3 was written for).

### What the orthogonality comment should now say

`:231-236` currently reads "`items` and `phase` are orthogonal: content events never touch `phase`". That claim **survives this change** and should be kept, with one qualification added: a renderer-sourced content event (`userText`) now opens a chrome scalar, joining `assistantDelta`/`toolUse`/`toolResult`, which already write `stalled`. The honest form is "content events never touch `phase`; they may touch chrome" plus a pointer to `localSendPending` as the first chrome scalar a *renderer-sourced* event writes. Do not delete the invariant — preserving it is an argument for this design, not an accident.

### Container and mount site

One narrow read beside `compacting` (`:123`), commented in the same idiom, and one argument at the mount site (`:189-192`):

```tsx
state={workingIndicatorStateWithLocalSend({ phase, apiRetry, compacting }, localSendPending)}
```

`toolName={openToolName(items)}` is unchanged — see Open questions.

### Rejected alternatives

- **A fourth `TurnPhase` member (`'sending'`).** Tempting: AC2/AC3/AC5 would all clear for free through the existing `phase` writes, and `isTurnRunning('sending')` is false so AC4 would hold. Rejected on reason 1 above — it contaminates a wire mirror and opens a type-level hole in `ThreadEvent.turnState`.
- **A fourth `ThreadStatus` field.** The honest-looking option; rejected on the measured 19-site retyping cascade with zero expectation changes.
- **A new `{ type: 'localSendStarted' }` ThreadEvent dispatched from `composerSend.ts`.** More explicit, but adds a `ThreadEvent` arm, a `reduceTimeline` case, a second dispatch call site, and a third production file — to signal something the existing `userText` dispatch already signals exactly (below).
- **Composing at the mount site.** Rejected by the ticket's own Technical Notes: supersede would not be inherited.
- **A new `timelineBridge` arm on `disconnected`.** The ticket says take that route only if reconnect genuinely does not cover the hazard. It does — `reconnected` is bridge-produced from the `connected` edge and AC3 is satisfiable through it alone. Leave `timelineBridge.ts:134` ignoring `disconnected`.

---

## Why AC1 needs no new event, and why that is exact rather than convenient

`userText` has exactly **one** production writer in the repo — `composerSend.ts:67` — verified by grep across `src/` and by `timelineBridge`'s switch, which produces twelve `ThreadEvent` types and never `userText`. The daemon streams no user-message event in interactive mode (`composerSend.ts:33-36`), and the timeline has no history backfill (`clearPairingScopedState.ts:52-53` records the same fact).

That single dispatch sits **below both `false` returns** (`:47` whitespace-only, `:48` null conversation id) and **above** `return true`. So "the `userText` arm fired" and "the composer accepted the submit" are the same event, and AC1's *exactly when* is structural rather than asserted. A refused submit dispatches nothing and opens nothing — no code runs at all.

Record this binding in the `userText` arm's comment: the arm opens the window because this dispatch **is** the accept signal, and if a second `userText` producer is ever added (a history backfill), that producer must be re-examined against this arm.

---

## State + concurrency model

No new store, no new subscription channel, no async work, no timers, no `AbortController`. `localSendPending` is a plain boolean in the existing `timelineStore`, written only through `dispatch` → `reduceTimeline` (the single write path, per CLAUDE.md's unidirectional rule) and read only through `selectLocalSendPending`.

Re-render cost is bounded by the reducer's same-reference discipline, which every new literal must preserve: an arm that changes nothing returns the same `state` object. The flag flips at most twice per turn, so the container's new subscription adds no churn beyond the items delta already there. A redundant `userText`-when-already-pending is *not* a no-op case worth special-casing — `userText` always appends a fresh `items` array, so that arm never returned the same reference and must not start.

---

## Error handling

No new failure modes; nothing here can throw. The one behaviour worth stating is the **accepted residual**, and it is the ticket's own:

A send whose bridge call throws is swallowed (`composerSend.ts:60-63`), still posts the echo, still returns `true` — so the window opens for a message that never left the machine. With the connection still up there is no daemon edge to close it, and it holds until a `turn_state`, a reconnect, a conversation switch, or an unpair. That is the send-failure surface the ticket puts Out of Scope, and it must not be engineered around here: a timeout would be new client state and a timer defending an unobserved failure mode. AC3 covers the offline variant; AC5 covers the abandoned-conversation variant.

---

## Testing strategy

All tests are plain `npm test` (vitest) unit tests over pure functions — no DOM, no store mount, no rendering required for any of the five ACs. Renderer tests in this repo are server-render-only (`renderToStaticMarkup`, and zustand v5 reads `getInitialState()` under it), so **no container render can drive store state**; every assertion below is at the pure-function level, which is where this repo's contracts live anyway.

### `threadTimeline.test.ts` — zero fixture cascade

Measured: 35 `initialTimelineState` uses, **zero** five-field literals. Every state is folded from events through `run([...])`, so a sixth field cascades nothing. Add scenarios:

- `userText` sets `localSendPending` from the initial state; `items` still gains the echo and `phase` is still untouched (the orthogonality pin).
- Any `turnState` clears it — assert `idle`, `thinking` and `responding` each clear.
- **The already-idle case**, called out separately because it is the early-out trap: fold `userText` then `turnState{idle}` from an `idle` state and assert the window closed. Without the widened guard this is the single failing test.
- `reconnected` clears it — and the early-out pin: `reconnected` against a state whose *only* live chrome is `localSendPending` must return a **different** reference with the field false (this is the `:479` predicate's detector).
- `reset` clears it — and remains reference-identical to `initialTimelineState`.
- Content events do **not** clear it: `assistantDelta`, `toolUse`, `toolResult` each leave it true. This pins the deliberate inverse-of-`stalled` decision.
- `turnEnd` does not clear it.
- Same-reference discipline holds on every carry-through arm.

**The `dirty()` fixture trap.** Both `dirty()` helpers (`:622-631` and `:678-687`) build their state as `userText('typed'), delta(...), turnState{thinking}, apiRetry, compacting, stall`. The `turnState` **clears the new field**, so `dirty()` is *not* dirty on `localSendPending` and the reset/reconnected suites would silently prove nothing about it. Reorder so a `userText` lands after the `turnState`, and update the two test names/preconditions that count fields — `'clears all five fields'` (`:633`) and `'clears all four chrome scalars'` (`:689`) become six and five.

### `ConversationScreen.test.tsx` — 19 pins untouched, one new block

The existing `shouldShowThinking` (13) and `workingIndicatorState` (6 + 1 loop) pins **must compile and pass with no edit**. If any needs touching, the composition was implemented as an extension and should be reworked. New `describe` block for `workingIndicatorStateWithLocalSend`:

- Every daemon-opened case delegates unchanged: for each of `thinking`/`responding`/`idle` and both `localSendPending` values, agreement with `workingIndicatorState(status)` whenever that is non-null. (A loop, in the `:950-955` idiom.)
- Idle + pending → `'thinking'`. Idle + not pending → `null`.
- **Supersede is inherited (the ticket's explicit pin):** idle + pending + live `apiRetry` → `null`; idle + pending + `compacting` → `null`; idle + pending + both → `null`. Assert for an unknown-count retry (`{ current: 0, total: 0 }`) too — presence supersedes, not the counter.
- Responding + pending → `'working'`: a daemon-reported running turn keeps its own label, so a send issued mid-turn never relabels it.
- **AC4, the no-arm guarantee:** at `phase: 'idle'` with pending true, assert `workingIndicatorStateWithLocalSend(...) !== null` **and** `isTurnRunning('idle') === false` in the same test — the indicator opens while the interrupt gate stays shut. Note in the test comment that the structural half of the guarantee is type-level (`InterruptControl` reads `selectPhase` alone; `isTurnRunning` admits only `TurnPhase`; `InterruptButton` takes `isRunning: boolean`) and that no container render can assert it here, for the server-render reason above.

### Gates

`npm test`, `npm run typecheck` (**run `-p tsconfig.web.json` explicitly too — the script's `&&` short-circuits and can hide the renderer half**), `npm run build`. No e2e change: the indicator's e2e contract is the `.conversation__thinking` selector, and no markup, class or copy changes.

---

## Open questions

- **The stale open tool name is now reachable a round-trip earlier — recommend deferring.** `openToolName` (`:1002`) scans the whole `items` array, so an interrupted turn's permanently-unresolved `toolCall` can name a tool for a turn that is not running (#649's recorded, deliberately undefended residual; pyrycode #1243 confirms an interrupt arrives as `turn_end{cancelled}` with no `tool_result`). This ticket does **not** create that bug — #649 already shows the stale name from the daemon's first `turn_state` onward — it only widens the window by one network round-trip, so the indicator can now read `Running <stale tool>…` from Enter rather than from the daemon's first event. It is outside this ticket's ACs and the remedy is already pre-described at `:1000-1001` (stop the scan at the first `turnBoundary`, one condition in the existing loop plus one test). **Recommendation: leave `toolName={openToolName(items)}` untouched here and let PO scope the one-line fix as its own ticket.** Flagged rather than silently absorbed because this change is what makes it operator-visible sooner.
- **A send issued while the previous turn is still running.** `turn_state{idle}` for the *previous* turn clears a window opened for the *new* send, so the indicator can briefly go dark until the daemon reports the new turn. AC2 asks for exactly this ("closes a locally-opened window exactly as it closes a daemon-opened one") and the queued-message path (#293/#294) is where that case properly lives, so it is taken as the ticket-sanctioned reading rather than defended. Worth one line in the `turnState` arm's comment so a future reader sees it was decided, not missed.
- **Naming.** `localSendPending` / `selectLocalSendPending` / `workingIndicatorStateWithLocalSend` are recommendations. Any equivalent naming is fine provided (a) the state field keeps a provenance marker distinguishing it from the four daemon scalars, and (b) `shouldShowThinking` and `workingIndicatorState` are **not** renamed — their names are load-bearing for the 19 pins, and #648 already froze `ThinkingIndicator` / `.conversation__thinking` / `.bubble--thinking`.
