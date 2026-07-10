# #215 — Thinking indicator bound to the conversation phase

The render sibling of #214: the `turn_state` transport slice (#214, merged PR #216) now feeds the
store's coarse `phase` scalar; this slice renders a **thinking indicator** while `phase === 'thinking'`
and nothing otherwise. It is the render twin of #203's `Timeline` — a pure props-in view plus a one-line
container read of `useTimelineStore(selectPhase)` — but over the orthogonal `phase` scalar rather than
the `items` list. **Distinct from #203's streaming cursor `▎`:** the cursor covers "assistant text is
arriving" (an `assistantText` tail); this covers "the daemon is working, no text yet" (the pre-text
window the daemon opens with `turn_state{thinking}` before any `assistant_delta`, pyrycode #632).

Size **S**, **not** security-sensitive (pure renderer; no keys, sockets, or raw bytes — those live in
`src/main/`; no `security-sensitive` label, so no security-review pass). **No split:** one production TS
file modified (`ConversationScreen.tsx`), one CSS edit, one test file. Zero new files, zero new exported
types. Well under every red line.

## Design source

N/A — the locked mobile design has **no dedicated thinking-indicator node** (verified against
`g2HIq2UyPhslEoHRokQmHG`, Conversation Thread Screen `16-8`: it models user / assistant / tool / delimiter
frames and the streaming cursor `▎` on the in-progress bubble `16-56`, but nothing for the pre-text
"thinking" window). This is a genuine design gap, not a desktop omission. Per the project's current stance
— the desktop UI is the mobile design stretched to the window, with a desktop-specific layout deferred
until the app is fully functioning — the polished visual rolls into that deferred pass. This slice ships a
minimal, M3-theme-token-faithful **interim** treatment (reuse the daemon-bubble surface + theme tokens,
muted "Thinking…" affordance), non-prescriptive; it is replaced when desktop design lands.

## Files to read first

- `src/renderer/src/screens/conversation/ConversationScreen.tsx:39-78` — the container. Note the existing
  `const items = useTimelineStore(selectItems)` read (`:49`) and the child order in the return
  (`MessageThread` → `Timeline` → `StatusRow` → `Composer`). Add the `selectPhase` read beside the
  `selectItems` read and mount `<ThinkingIndicator …>` right after `<Timeline items={items} />` (`:60`).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:102-172` — the `Timeline` pure view + its
  `TimelineRow`. **This is the pattern to mirror exactly**: an in-file, **exported**, props-in/markup-out
  component that returns `null` for its "nothing to show" case. `ThinkingIndicator` is its structural twin
  over a boolean rather than a `ThreadItem[]`.
- `src/renderer/src/store/timelineStore.ts:44-51` — the read surface: `useTimelineStore(selector)` +
  re-exported `selectItems` / **`selectPhase`**. Import `selectPhase` from here (the single import site by
  design, same as `selectItems`). No new selector — `selectPhase` already exists.
- `src/renderer/src/store/threadTimeline.ts:10-11,51-55,157,159-161` — `TurnPhase`
  (`'thinking' | 'responding' | 'idle'`), `TimelineState` (`items` + `phase` orthogonal), the
  `initialTimelineState` (`phase: 'idle'`, why the container smoke sees the indicator absent), and
  `selectPhase`. **Do not touch this file** — this slice adds only a read + a view.
- `src/renderer/src/screens/conversation/conversation.css:124-190` — `.conversation__thread`,
  `.message-row--daemon`, `.bubble`, `.bubble--daemon`, and the `.bubble__cursor` blink +
  `prefers-reduced-motion` guard (`:172-190`). Reuse the daemon-bubble tokens; the optional animation, if
  added, must copy the reduced-motion guard shape.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1-11,57-72,232-238` — the
  `renderToStaticMarkup` idiom (no jsdom), the `Timeline` describe block's shape (inject the model, assert
  the markup string; empty case → `''`), and the container smoke that asserts the **inert** timeline
  (`getInitialState` → `phase: 'idle'`, no cursor). Your `ThinkingIndicator` block mirrors this exactly.
- `src/renderer/src/theme/tokens.css:19,23` — `--color-surface-container-high` /
  `--color-on-surface-variant`, the two tokens the interim treatment uses. Confirm they exist; use the
  token names, never hex.
- `docs/specs/architecture/203-timeline-render.md` — the sibling render spec; its "pure view + container
  read + inject-in-tests" reasoning applies verbatim. `docs/knowledge/codebase/203.md` (render precedent),
  `docs/knowledge/codebase/214.md` (what made `phase` live).

## Context

#214 decoded the daemon's `turn_state` stream into the store's coarse `phase` scalar. On the rising edge
of a turn the daemon emits `turn_state{thinking}` **before** any `assistant_delta` (pyrycode #632), so
during the thinking window there are no timeline items yet — `Timeline` renders `null` (empty `items`) and
today's thread shows nothing. A slow turn is then indistinguishable from a stalled one. This slice closes
that gap: a "Thinking…" affordance bound to `phase === 'thinking'`, cleared otherwise.

**Dormant until #179** (the same posture as #203). `phase` only leaves `idle` for a v2 **interactive**
connection, and `interactive` stays off in production until #179. So in production today `phase === 'idle'`
always → the indicator renders `null` → the layout is unchanged. This slice **must not** flip or gate
`interactive` (that is #179). It also adds **no transport, no store, no bridge change** — only a selector
read and a pure view.

## Design

Three edits, no new files:

### 1. `ThinkingIndicator` pure view — new in-file exported component in `ConversationScreen.tsx`

The twin of `Timeline`. Signature:

```
export function ThinkingIndicator({ isThinking }: { isThinking: boolean }): JSX.Element | null
```

- `isThinking === false` → **return `null`** (zero layout footprint, AC2 — exactly like `Timeline`
  returning `null` on an empty list).
- `isThinking === true` → render a single left-aligned, daemon-styled row carrying a **static** "Thinking…"
  label. Reuse the daemon-bubble surface + tokens; do not invent new geometry. Contract markup:
  - a `flex: 0 0 auto` wrapper `.conversation__thinking` (see CSS below) — **not** a
    `.conversation__thread` (that is `flex: 1 1 auto` and would claim a competing dead region beside the
    empty threads),
  - containing `<div className="bubble bubble--daemon bubble--thinking">Thinking…</div>` — the daemon
    bubble shape + surface, text muted to `on-surface-variant` to read as a transient affordance.

  `.conversation__thinking` is the stable test seam (the `bubble__cursor` role). The visible label is a
  **client-owned constant**, not `phase` — see AC3 below. Use the ellipsis glyph `…` (U+2026); avoid
  apostrophes in the label so it survives `renderToStaticMarkup` unescaped (prior desktop lesson).

**Boolean input, not `phase` (the AC3 decision).** The view takes `isThinking: boolean`, not
`phase: TurnPhase`. The AC allows either; the boolean makes AC3 ("no daemon-supplied string is rendered")
a **type-level guarantee** rather than a convention — the view structurally cannot render a daemon string
because it never receives one. The container does the trivial `phase === 'thinking'` derivation. This is
the belt-and-suspenders "different fabric" posture: the security invariant is enforced by the type, not by
"we remembered not to render it." No `switch`, no `assertNever` — a plain boolean guard, so no
exhaustiveness machinery is needed (unlike `TimelineRow`, which discriminates a union).

### 2. `ConversationScreen` container edit — additive, ~2 lines

Read the phase slice beside the existing items read and pass the derived boolean down:

```
const phase = useTimelineStore(selectPhase)
…
<ThinkingIndicator isThinking={phase === 'thinking'} />   // right after <Timeline items={items} />
```

Mirrors the `selectItems` → `Timeline` line directly above. Placement — right after `<Timeline>`, before
`<StatusRow>` — puts the indicator at the tail of the structured-stream render surface, i.e. where the
next assistant bubble will appear, reading as "a reply is coming here." Selecting only the `phase` slice
adds no meaningful re-render churn (the container already re-renders on every `items` delta).

### 3. CSS — `conversation.css`, ~4 lines + optional guarded animation

- New wrapper (add near the thread/bubble rules, e.g. after `.bubble__cursor` block):
  ```
  .conversation__thinking { flex: 0 0 auto; display: flex; justify-content: flex-start;
                            padding: var(--space-2) var(--space-4); }
  ```
  `flex: 0 0 auto` + the thread's horizontal padding keeps the bubble left-aligned and thread-consistent
  without claiming vertical flex space.
- New bubble modifier: `.bubble--thinking { color: var(--color-on-surface-variant); }` — mutes the
  daemon-bubble text to signal transience. Everything else (fill, radius, measure) inherits from
  `.bubble` / `.bubble--daemon`; **no color/type literal**, token names only.
- **Optional polish** (not load-bearing): a subtle pulse on `.bubble--thinking`. If added, copy the
  `.bubble__cursor` precedent — a `@keyframes` plus a `@media (prefers-reduced-motion: reduce)` guard.
  The static "Thinking…" meets the AC on its own; prefer shipping it static to keep the interim minimal.

## State + concurrency model

- **Single source of state:** `timelineStore` (#202 app singleton). The view is stateless — reads
  `phase` via `useTimelineStore(selectPhase)`, derives a boolean, renders. No local state, no two-way
  binding, no timer.
- **No stall heuristic.** "Clears otherwise" is driven **purely by `phase`** — the daemon owns the turn
  lifecycle and emits `turn_state{idle}` at turn end. Evidence-based-fix: no client-side timer or
  independent stall detection (no observed need; a timer would be a stochastic safety net over a
  deterministic signal — wrong fabric).
- **Re-render seam:** the container already re-renders per `items` delta; the added `selectPhase` read
  only re-renders on phase transitions, which are strictly fewer. The `phase === 'thinking'` derivation is
  pure. No new subscription, async task, or `AbortController` — there is no async work here.

## Error handling

Pure render path — no network / socket / parse / permission failure reaches here (defended upstream at
#199's transport decode and #214's `turn_state` literal-check). The only defensive posture:

- **AC3 — no daemon string rendered.** The container→view boundary carries only `isThinking: boolean`. The
  rendered "Thinking…" is a client-owned constant. `phase` itself (already a sealed three-way literal
  validated by #214's transport, like `role`) is consumed solely as a boolean gate in the container and is
  **never** rendered as text. AC3 is thus a structural type guarantee, not a convention.
- **No unknown-input branch.** A boolean has no unhandled case; there is nothing to `assertNever`.

## Testing strategy

`npm test` (vitest, `renderToStaticMarkup`, no jsdom) + `npm run build` (typecheck + build) green. Import
`ThinkingIndicator` into `ConversationScreen.test.tsx` and add a `describe('ThinkingIndicator …')` block
mirroring the `Timeline` block. All "showing" assertions server-render the **pure view** with an injected
boolean (no store, no IPC — the populated container path is unreachable under server render, which reads
`getInitialState()` → `phase: 'idle'`). Scenarios (write as the repo's markup-string assertions, not full
bodies):

- **Not thinking is inert** — `<ThinkingIndicator isThinking={false} />` → markup is `''` (zero footprint,
  AC2). No crash.
- **Thinking shows the affordance** — `<ThinkingIndicator isThinking={true} />` → markup contains the
  `conversation__thinking` seam, the `bubble--thinking` treatment, and the literal `Thinking…`.
- **Container is inert against the idle store (AC4 / dormant-until-#179)** — `<ConversationScreen />`
  server-renders with no `conversation__thinking` / no `Thinking…` present (the store's initial `phase` is
  `idle`). This is the analog of the existing "no `bubble__cursor`" inert-slice smoke at `:235-238`; the
  populated `thinking` path is unreachable under server render (zustand v5 reads `getInitialState()`),
  which is exactly why the "showing" assertions live on the pure view.

No test for the container's reactive phase→UI path — that path is not server-render-reachable and the
store's reduce/select behavior is already covered by `timelineStore` / `threadTimeline` tests (#202/#121).

## Open questions

- **Dual-thread / dual-surface layout at the #179 cutover (out of scope; inherits #203's open question).**
  Today (`phase` always `idle`) the indicator is `null` and the layout is pixel-identical. Post-#179, when
  `interactive` flips: during `thinking` the coarse `MessageThread` renders an empty `flex: 1 1 auto`
  region, `Timeline` is `null`, and the `flex: 0 0 auto` `ThinkingIndicator` sits just above the status
  row; when the first delta arrives `phase → responding`, the indicator vanishes and the reply appears in
  `Timeline`'s region — a small positional shift. **#179 owns reconciling the timeline surfaces** (render
  one or the other off the interactive flag, empty-thread `null`, indicator placement); this slice must
  not touch it, per "no `interactive` flip here." Noted so #179 inherits the seam explicitly.
- **Interim visual is non-prescriptive.** The muted daemon-bubble "Thinking…" is a deliberately minimal
  stand-in for the absent Figma node; the polished treatment (and any animation) lands in the deferred
  desktop-design pass. The developer may adjust the interim wording/weight within the token set without a
  spec change.
