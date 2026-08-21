# #648 — hold the working indicator for the whole running turn

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/648 (split from #597)
**Size:** S — 1 production file, 1 test file. ~35 lines of production change (plus this file's usual comment density), ~50 lines of test change.
**Anchors** verified at `e1a2041`.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8

Node `16-8` is the Conversation Thread screen the indicator sits in: a single scrolling column of left-aligned muted daemon bubbles and right-aligned filled user bubbles, with a tool row, a session delimiter, a fenced code block, and the composer bar pinned at the bottom. It draws only the populated steady state — there is **no working/thinking indicator node anywhere in the frame**, the same genuine design gap already recorded for #215, #317, #493 and #496.

N/A for this ticket's specific state, therefore: no new visual is being introduced. Both labels reuse the interim treatment those tickets established — the existing `.conversation__thinking` wrapper and the existing muted `.bubble--thinking` daemon-bubble surface, unchanged. A polished working-state visual remains a Figma-side follow-up for Juhana.

## Files to read first

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:769-791` | `ThinkingIndicator` and its prop-contract comment. The "Takes `isThinking: boolean`, NOT `phase: TurnPhase`" rationale is the posture this ticket must preserve in a wider shape — read it before choosing anything. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:830-856` | `ThreadStatus` and `shouldShowThinking`. The two supersede clauses (`apiRetry === null && !compacting`) are AC4 and do not move; the phase clause is the single thing that changes. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:893-926` | `COMPACTING_COPY` + `CompactingIndicator` — the exported-copy-constant plus pure-null-on-absent view idiom to copy verbatim for the new constant. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:928-936` | `isTurnRunning` — the predicate to **reuse**, not to re-derive. Its comment already names the "gate is BROADER than ThinkingIndicator's" divergence this ticket closes. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:179-198` | The indicator mount block. Line `:183` is the only production call site of `ThinkingIndicator`. |
| `src/renderer/src/store/threadTimeline.ts:11` | `TurnPhase = 'thinking' \| 'responding' \| 'idle'` — exactly three members, so `!== 'thinking'` inside a running turn means `responding`. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1-30` | The import block. Four symbols get added to it; `shouldShowThinking` and `isTurnRunning` are already there. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:592-612` | The `ThinkingIndicator` describe — two `it`s to retype, one to add. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:724-765` | The `shouldShowThinking` describe. **Eight of the nine assertions stand verbatim**; only `:763` inverts. Read all of them before editing — the eight that stand are AC4's regression evidence. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:427-445` | #609's cross-cutting bubble-class assertion; `:434` and `:442` pass `isThinking={true}`. Mechanical prop retype, no assertion change. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1546-1560` | The container smoke against the idle store. Its two assertions stand; only the comment at `:1552-1555` names `isThinking`. |
| `src/renderer/src/screens/conversation/conversation.css:743-758` | `.conversation__thinking` and `.bubble--thinking`. Read to confirm the claim below: **no CSS change is needed**, because the wrapper is layout-only and the modifier only mutes the text colour. |
| `e2e/queued-backlog-interrupt.spec.ts:154,185-197` and `e2e/thread-scroll-pin.spec.ts:269-270` | Read to confirm no e2e change: both assert only `thinking` → visible and `idle` → absent. Neither asserts absence during `responding`. |

## Context

The daemon emits `turn_state{thinking}` only while claude is producing actual thinking text; the first reply token or the first tool step flips it to `responding`, and no further `turn_state` arrives until the turn ends. For a tool-heavy turn the wire sequence is `(optional thinking) → responding → [the tool loop runs for L seconds, silent] → assistant_delta → idle` (pyrycode spec #1172). `responding` is therefore the phase that *lasts*, and it is exactly the phase in which the screen currently says nothing.

`shouldShowThinking` gates on `phase === 'thinking'`, so the indicator appears for the brief thinking slice and then vanishes for the rest of the turn. The operator hit this during the first real use of the desktop app as a client (2026-08-20): most of a turn looks like a frozen screen, and the only live cue is `InterruptControl` appearing over the composer.

The interrupt control in the same file already models "a turn is running" correctly, via the exported and unit-tested `isTurnRunning` (`thinking || responding`). The indicator is the odd one out. ADR 025 — the remote-head charter both mobile and desktop implement — specifies "a thinking indicator that reflects when claude **is working**", not one that reflects when claude is emitting thinking text. This ticket restores that original reading.

No daemon change: `turn_state` is already decoded, fanned, and reduced into `phase`.

## Design

Three production edits in `ConversationScreen.tsx`, plus one line at the mount. Nothing else in `src/` changes.

### 1. Two exported copy constants

`'Thinking…'` is currently an inline JSX literal at `:788`, unlike its three siblings. Hoist it, unchanged in value, and add its twin beside it. Both **exported**, following `API_RETRY_COPY` / `COMPACTING_COPY` — AC5 requires a test to reach them without rendering, and `STALL_COPY`'s module-private posture forced its test to duplicate the literal (`ConversationScreen.test.tsx:717`), which is what AC5 is written to prevent.

```ts
export const THINKING_COPY = 'Thinking…'
export const WORKING_COPY = 'Working…'
```

Both are apostrophe-free and use the U+2026 ellipsis character, matching the three siblings — `renderToStaticMarkup` escapes `'` to `&#x27;`, the standing desktop lesson.

**Why `'Working…'` and not something more specific.** During `responding` the client genuinely cannot tell tool work from text streaming: the daemon sends no further `turn_state` inside the tool loop, so there is no finer signal to key off. A copy like "Running tools…" would be a lie roughly half the time. One generic word answers the operator's actual complaint ("this looks frozen"), is lexically distinct from `'Thinking…'` (AC2), and matches the one-word register of its direct peer rather than the sentence register of the three problem/housekeeping states.

### 2. The gate broadens by one clause; a new derivation picks the label

`shouldShowThinking` keeps its name, its `ThreadStatus` parameter, its `boolean` return, and both supersede clauses **verbatim**. Only its phase clause changes, from a literal comparison to the existing predicate:

```ts
export function shouldShowThinking(status: ThreadStatus): boolean {
  return isTurnRunning(status.phase) && status.apiRetry === null && !status.compacting
}
```

That is the whole of AC1 and AC4. AC4 is provable by inspection — the two clauses that supersede are textually untouched — and by the eight existing assertions that stand verbatim.

The name stays because the component it gates is `ThinkingIndicator`, whose identifier the ticket freezes; renaming the gate without the component would leave the pair inconsistent. Update its comment block to say the gate now tracks the running turn and reuses `isTurnRunning`, closing the divergence `isTurnRunning`'s own comment at `:928-933` flags.

A second, new exported function composes that gate with the label choice. It is not a parallel gate — it delegates, and adds only the discriminant:

```ts
export type WorkingIndicatorState = 'thinking' | 'working'

/** null when nothing should show; otherwise which of the two client-owned labels. */
export function workingIndicatorState(status: ThreadStatus): WorkingIndicatorState | null
```

Behaviour: `null` when `!shouldShowThinking(status)`; otherwise `'thinking'` when `status.phase === 'thinking'`, else `'working'`. Three lines. `'idle'` is unreachable in the second branch because the gate already excluded it, so no `assertNever` and no fourth case.

The type and the function deliberately share a name (distinct TS namespaces). This is legal, reads naturally at the call site, and needs one import specifier rather than two.

### 3. The view's prop widens to that union

```tsx
export function ThinkingIndicator({ state }: { state: WorkingIndicatorState | null }): JSX.Element | null
```

`null` → `null` (AC3: no wrapper, no empty chrome — the existing zero-footprint posture). Otherwise the existing wrapper and bubble, with the label selected by a ternary on `state`. No new elements, no new classes, no CSS change: `.conversation__thinking` is layout-only and `.bubble--thinking` only mutes the text colour, so both labels wear the same surface.

`WorkingIndicatorState | null` preserves the type-level guarantee the current `isThinking: boolean` gives and that the file's comments at `:775-777`, `:805-807` and `:863-866` insist on: the view **structurally cannot** receive a daemon-supplied string, because its prop's only inhabitants are two client-owned literals and `null`. Do **not** widen this to `phase: TurnPhase` (that hands the view the store type and makes `'idle'` representable-but-illegal), and do **not** pass the label itself as a `string` prop (that reintroduces exactly the hole the posture exists to close).

The `| null` lives on the prop and on the return type, not inside the type alias — the `ApiRetryStatus | null` shape at `:872`.

### 4. The mount

`ConversationScreen.tsx:183` becomes a single call, replacing the `shouldShowThinking(...)` call currently inlined there:

```tsx
<ThinkingIndicator state={workingIndicatorState({ phase, apiRetry, compacting })} />
```

The container still reads `phase`, `apiRetry` and `compacting` from the store exactly as today — no new store read, no new selector, no change to `ThreadStatus`. Update the mount's comment (`:180-182`) to say the gate now tracks the whole running turn while the two supersede clauses still narrow it.

## State and concurrency model

Nothing changes. `phase` is the existing coarse scalar reduced from `turn_state` and read via the existing `selectPhase`; `apiRetry` and `compacting` are the existing scalars beside it. `workingIndicatorState` is a pure function of a plain record — no store access, no effects, no subscriptions, no async. Re-render behaviour is unchanged: the container already re-renders on a `phase` delta because `InterruptControl` and this mount both depend on it.

## Error handling

No failure modes. There is no I/O, no parsing, and no daemon input on this path — the transport already validated `turn_state` before it reached the reducer. The only total-function obligation is that every `TurnPhase` value maps somewhere, which holds: `'idle'` exits through the gate, `'thinking'` and `'responding'` through the two branches.

## Testing strategy

`npm test` (vitest), plus `npm run typecheck` for the prop-contract change. Renderer tests here are **server-render only** (`renderToStaticMarkup`, `node` env, no DOM) — every assertion below is a markup property, never an interaction.

**`shouldShowThinking` describe (`:724-765`)** — rename the describe to name the running-turn gate alongside the two supersede rules.
- The eight assertions at `:730`, `:735`, `:741`, `:746`, `:751`, `:756`, `:757`, `:762` stand **verbatim**. Do not touch them; they are AC4's regression evidence and the proof that broadening the phase clause did not weaken the supersede clauses.
- `:763` (`responding` / no retry / not compacting) inverts from `false` to `true`. Update the assertion and the `it` prose at `:760-761`, whose "The pre-#493 gate was exactly `phase === 'thinking'`" comment is now the behaviour being reversed. Do not bend the implementation to keep it green.
- Add one `it` pinning `thinking` and `responding` as the two showing phases and `idle` as the hiding one, so the tie to `isTurnRunning` is asserted, not just inherited.

**New `workingIndicatorState` describe** — pure calls, no rendering:
- `thinking` / no retry / not compacting → `'thinking'`.
- `responding` / no retry / not compacting → `'working'` (AC1 and AC2's core case).
- `idle` → `null` (AC3).
- `responding` with a live retry → `null`, and `responding` while compacting → `null` (AC4: the supersede rules reach the newly covered phase too, not only `thinking`). Cover the unknown-count retry `{ current: 0, total: 0 }` in the `responding` phase as well — presence supersedes, matching `:739-743`.

**`ThinkingIndicator` describe (`:599-612`)**:
- `state={null}` → `renderToStaticMarkup(...)` is exactly `''` (AC3: no wrapper at all). Retype the existing `it` at `:601`.
- `state="thinking"` → markup contains `conversation__thinking`, `bubble--thinking`, and `THINKING_COPY`. Retype `:605`; assert against the constant now that it exists, and additionally pin `THINKING_COPY` to the literal `'Thinking…'` so AC's "its rendered text must not change" is a test, not a review promise.
- Add: `state="working"` → same wrapper and same modifier (the shared surface), containing `WORKING_COPY` and **not** containing `THINKING_COPY`.
- Add a render-free copy assertion, following the `:712-721` idiom: `WORKING_COPY` is not `THINKING_COPY` (AC2, lexical distinctness), contains no `'`, and is distinct from `API_RETRY_COPY` and `COMPACTING_COPY`.

**#609 cross-cutting assertion (`:434`, `:442`)** — mechanical retype to `state="thinking"`. Both assertions (`not.toContain(MODIFIER)`, `not.toContain(CONTAINER)`) stand.

**Container smoke (`:1546-1560`)** — both assertions stand (the store's initial `phase` is `'idle'`, so the mount still renders nothing). Update the comment at `:1552-1555`, which names `isThinking`. Also add `expect(markup).not.toContain(WORKING_COPY)` there, so the idle container is pinned against the *new* label too.

**Leave `:715` alone.** `expect(COMPACTING_COPY).not.toBe('Thinking…')` keeps its literal. Its value is unchanged, it still passes, and swapping it to `THINKING_COPY` is adjacent-code churn this ticket does not need.

**No e2e change.** `e2e/queued-backlog-interrupt.spec.ts:186-197` pushes `turn_state{thinking}` and asserts `.conversation__thinking` visible, then `turn_state{idle}` and asserts count 0; `e2e/thread-scroll-pin.spec.ts:269-270` asserts visible on `thinking`. Both hold under the broadened gate, and neither asserts absence during `responding`. Note that `e2e/` sits outside both tsconfigs, so `npm run typecheck` would not have caught a break there either way — the confirmation above is by reading, not by the gate.

## Scope

- **Renaming is out of scope.** `ThinkingIndicator`, `.conversation__thinking` and `.bubble--thinking` keep their identifiers — roughly 40 references across the screen, its test file, and `e2e/queued-backlog-interrupt.spec.ts`. A rename is its own Strangler-Fig chore ticket.
- **No CSS change.** Neither file under `src/renderer/src/screens/conversation/*.css` is touched.
- **No store, transport, wire, or daemon change.** `ThreadStatus` gains no field.
- The stale narrow-gate prose in the comment at `e2e/queued-backlog-interrupt.spec.ts:37-38` is optional to correct and is **not** an acceptance criterion. If the developer corrects it, it is a comment-only edit to that one line pair.
- The knowledge-base note for this ticket belongs to the documentation phase, not to this implementation.

## Open questions

1. **Redundancy against the streaming cursor.** While assistant text is streaming, #203's cursor already signals liveness, so `'Working…'` sits below a bubble that is visibly moving. AC1 is unambiguous that the indicator holds for the whole running turn, so the design implements that; the redundancy is an accepted consequence, not a defect. If it reads as noisy in practice, the follow-up is a Figma-side treatment decision (the deferred desktop design pass), not a re-narrowing of the gate — re-narrowing would restore exactly the bug this ticket fixes.
2. **Copy wording** is the one genuinely reversible choice here. `'Working…'` is a one-word constant with a render-free test; if Juhana prefers different wording, it is a one-line change with no structural consequence.
