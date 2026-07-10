# #203 — Render the streamed assistant text on the conversation timeline

The render slice (L3) of the Phase-2 structured-streaming vertical: transport (#199) → store (#202) →
**render (#203)**. Both upstream slices have merged. This slice reads `timelineStore` (#202) and
renders its `assistantText` items — each as an assistant bubble growing in place, the in-progress one
carrying a streaming cursor — plus handles the `turnBoundary` marker, in array order. Strangler-Fig
alongside the coarse `message` path (`MessageThread`), which is untouched and stays inert-visible until
#179 flips `interactive`.

Size **S**, **not** security-sensitive (pure renderer of already-decoded text; no keys, sockets, or
raw bytes — those live in `src/main/`). No split: two production files edited (`ConversationScreen.tsx`,
`App.tsx`), one CSS edit, one test file. Well under every red line.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8

The Conversation Thread screen (`16:8`). The in-progress assistant bubble (`16:54` / `16:55`, text
`16:56`) is a left-aligned column bubble: `surface-container-high` fill, `on-surface` body-medium text,
corners rounded 20px except a sharp 6px bottom-left — **byte-for-byte the existing `.bubble--daemon` /
`.message-row--daemon` treatment** (`conversation.css:110`, `:132`). Its text ends in a `▎` streaming-
cursor glyph (U+258E): the cursor is a **trailing visual on the in-progress bubble's text run, not a
separate row**. The thread draws **no** per-turn divider (Figma's only delimiter, `16:35`, is a
session/workspace-change marker — a different concept), so `turnBoundary` is a structural marker, not a
drawn element.

## Files to read first

- `src/renderer/src/screens/conversation/ConversationScreen.tsx:32-85` — the container + the
  `MessageThread` pure view + `MessageBubble`. Mirror this split exactly: `Timeline` is `MessageThread`'s
  twin (in-file, exported, props-in/markup-out); the container reads a store slice and passes it straight
  in. Note `data-message-role` (`:80`) as the bubble's test hook and `.bubble--daemon` reuse.
- `src/renderer/src/store/timelineStore.ts:44-51` — the read surface: `useTimelineStore(selector)` hook +
  re-exported `selectItems` / `selectPhase`. Import `selectItems` from here (single import site by design).
- `src/renderer/src/store/threadTimeline.ts:24-35` — the `ThreadItem` union (three kinds). This IS the
  render model (camelCase, `conversation_id`-free) — **no adapter**. Read the reducer's `appendDelta`
  (`:69-80`) and `turnEnd` (`:143-151`) to confirm the append-only + tail-mutation invariant the React
  key and cursor derivation both rely on.
- `src/renderer/src/store/timelineBridge.ts:84-92` — `useTimelineBridge()`, the App-level twin of
  `useDaemonEventBridge`. Already merged; you only *mount* it. Note `window.pyry` is deref'd inside the
  effect (`:87`), never at render — this is what keeps the `<App/>` server-render test green.
- `src/renderer/src/App.tsx:43-44` — where `useDaemonEventBridge()` is called. Mount `useTimelineBridge()`
  on the next line, same shape.
- `src/renderer/src/App.test.tsx:63-74` — the dev trap: `renderToStaticMarkup(<App/>)` must stay `''`.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1-48` — the `renderToStaticMarkup`
  test idiom (no jsdom/Testing Library) and the `bubbleCount` helper. Your `Timeline` tests mirror the
  `MessageThread` describe block.
- `src/renderer/src/screens/conversation/conversation.css:90-136` — `.conversation__thread` (the scroll
  region), `.message-row--daemon`, `.bubble`, `.bubble--daemon`. Reuse all four; add only the cursor rule.
- `docs/knowledge/codebase/202.md` — the merged store/bridge surface. `docs/knowledge/codebase/188.md` —
  the container/pure-view render precedent (reads a store, mounts a pure view).

## Context

#202 landed `timelineStore` (folding `assistantDelta` / `turnEnd` into an ordered `ThreadItem[]`) and
`timelineBridge`, but nothing reads them yet. This slice renders them. It **gates #179**: once
`interactive` flips and the coarse `message` fan-out stops (pyrycode #699), the thread blanks unless the
streamed text renders here. Until #179 the store stays empty in production (a non-interactive v2
connection receives no structured stream), so this wiring is inert — **no `interactive` flip here**.

## Design

Three edits, no new files:

1. **`Timeline` pure view** — new in-file exported component in `ConversationScreen.tsx`, the twin of
   `MessageThread`. Signature: `Timeline({ items }: { items: readonly ThreadItem[] }): JSX.Element | null`.
   Maps `items` → rows 1:1 in array order (coalescing is already done upstream by the reducer, #121 — the
   view never merges). Renders inside a `<div className="conversation__thread">` (reuse the existing
   scroll/flex class). Per-item rendering by `kind`:
   - `assistantText` → one assistant bubble: `<div className="message-row message-row--daemon"><div
     className="bubble bubble--daemon" data-thread-role="assistant">{item.text}{cursor?}</div></div>`.
     Text is passed as **React children** (auto-escaped) — never `dangerouslySetInnerHTML`, so HTML inside
     a delta renders as visible characters (discharges #199's untrusted-text handoff). Add a stable data
     attribute (`data-thread-role="assistant"` above) so tests can count timeline bubbles the way
     `bubbleCount` counts `data-message-role`.
   - `turnBoundary` → `null` (structural marker; no drawn element per Figma). Its only functional role —
     closing the cursor — is handled by the tail-check below, not by any DOM it emits.
   - `toolCall` → `null` (a deferred placeholder; tools are #205 / #206). It is a legitimate union member
     that has no source *yet*, so it cannot appear in the rendered set today — but the view must **not**
     `assertNever` on it (that would crash the thread the moment #205 feeds one).
   - **No `assertNever`, no `default`.** Handle all three kinds with explicit cases each returning their
     render (two of them `null`). The switch is then exhaustive over today's union; adding a fourth
     `ThreadItem` kind later makes it non-exhaustive → a compile-time "not all paths return" error that
     forces a decision. This is the render-path analog of the reducer's guard: rendering degrades
     gracefully (unknown kind → nothing) rather than throwing, but a new kind still can't slip through
     silently.
   - **Empty `items` → return `null`** (not an empty `<div>`). Rationale: the timeline is the *inert*
     path today; returning `null` gives it **zero layout footprint**, so the current thread layout is
     pixel-identical (AC4). `MessageThread` keeps its empty-region behavior because it is the *live* path.
     See the dual-thread open question below.

2. **`ConversationScreen` container edit** — additive. Read the items slice and pass it straight to the
   view (no adapter — `ThreadItem` is already the render model, ADR 0008):
   `const items = useTimelineStore(selectItems)`, then render `<Timeline items={items} />` immediately
   after `<MessageThread messages={messages} />` (`ConversationScreen.tsx:45`). Selecting only the items
   slice keeps a stream delta from re-rendering unrelated facets. Mirrors the `selectMessages` →
   `MessageThread` line above it.

3. **`App.tsx` edit** — two lines: `import { useTimelineBridge }` and call it right after
   `useDaemonEventBridge()` (`App.tsx:44`). Both hooks deref `window.pyry` only inside their effect, so
   the `<App/>` server-render test stays `''`. The mount is app-lifetime and unconditional (one stable
   listener), matching the coarse bridge; it is inert until #179 because no stream arrives.

### Streaming cursor — derived structurally, never from `phase`

`selectPhase` has no source in this slice (`phase` is driven only by `turn_state`, which ships in #204),
so it is **always `idle` here** — do not gate the cursor on it. The store carries no per-item
"in-progress" flag either. Derive it from position:

> **The in-progress bubble is the tail `assistantText` — equivalently, the cursor renders on the item at
> the last array index if and only if that item's `kind === 'assistantText'`.**

This is exact given the reducer's shape: deltas coalesce into the tail `assistantText` (same `turnId`,
`threadTimeline.ts:69-80`); `turnEnd` **appends** a `turnBoundary` after it (`:143-151`), so once a turn
closes, the boundary — not the text — is the tail. So "last item is an `assistantText`" ⟺ "its turn has
not ended" ⟺ in-progress. Robust across a tool splitting a turn (post-#205): `[text, tool, text]` → tail
is the second `text` → cursor there; `[…, turnBoundary]` → no cursor.

**Cursor element:** a dedicated, `aria-hidden="true"` inline element trailing the text inside the bubble,
class `bubble__cursor` (the test seam). Render it **only** on the in-progress bubble. Reproduce Figma's
`▎` (U+258E) — either the glyph as the span's child (`<span className="bubble__cursor"
aria-hidden="true">▎</span>`, inheriting `.bubble`'s `on-surface` color and size) or a CSS-drawn thin bar
of equivalent weight; the glyph is the faithful match. It must sit *inside* the same bubble as a sibling
of the text (inline flow), not as its own row. A subtle blink is optional polish — if added, it is the
renderer's first `@keyframes`, so guard it with `@media (prefers-reduced-motion: reduce)`; the static
caret is the load-bearing requirement.

### React key strategy (ADR 0008 deferred this here)

Use the **array index** as the `key`, with a one-line justifying comment. Reasoning, since index keys are
usually a smell:

- The key must be **stable across delta growth** — a key containing `text` would change on every delta
  and remount the bubble (losing the cursor, re-triggering any animation, flickering). That rules out
  `text`-in-key.
- `turnId` alone is **not collision-safe by construction**: post-#205 one tool can split a turn into two
  `assistantText` items sharing a `turnId`, so `key={turnId}` would collide.
- The list is **append-only with tail-mutation and never reorders or inserts mid-list** (verify against
  `appendDelta` / `fillResult` / the append arms in `threadTimeline.ts`): the tail `assistantText` grows
  *at the same index*; every other event appends a *new* index at the end; `fillResult` replaces a
  `toolCall` in place at its own index. Index identity is therefore stable per logical item, and index
  reconciliation is correct — the tail grows in place (React updates text, no remount) exactly as wanted.

Index satisfies all three constraints where `turnId` and any `text`-bearing composite fail. The
usual index-key hazard (mid-list insert/reorder) does not exist in this structure; state that in the
comment so review reads it as deliberate, not careless.

## State + concurrency model

- **Single source of state:** `timelineStore` (the #202 app singleton). The view is stateless — it reads
  `(items)` via `useTimelineStore(selectItems)` and renders. No local state, no two-way binding.
- **Subscription/lifecycle:** owned entirely by the merged `useTimelineBridge()` — one app-lifetime
  `useEffect` subscription on the `onDaemonEvent` channel, cleaned up on unmount (StrictMode double-mount
  nets one live listener). This slice only *mounts* the hook; it adds no new subscription, timer, or async
  task. No `AbortController` needed — there is no async work here.
- **Re-render seam:** the container selects only the `items` slice, so connection-status / message / run-
  config changes never re-render the timeline, and a stream delta re-renders only the timeline subtree.

## Error handling

Pure render path — no network, socket, parse, or permission failure modes reach here (those were
defended at #199's transport decode). The only defensive posture:

- **Untrusted delta text** → rendered as React children (auto-escaped). HTML/script inside a delta shows
  as literal characters, never executed markup. This is the AC1 requirement and #199's explicit handoff.
- **Unknown/unsourced `ThreadItem` kind** (`toolCall` today) → renders `null`, no throw. A future kind is
  caught at compile time by the exhaustive-switch-without-default, not at runtime.

## Testing strategy

`npm test` (vitest, `renderToStaticMarkup`, no jsdom) + `npm run build` (typecheck + build) green. All
timeline-view assertions server-render the **pure `Timeline`** with an injected `ThreadItem[]` — no
store, no IPC — exactly as `MessageThread` tests inject `Message[]`. Add a `describe('Timeline …')` block
to `ConversationScreen.test.tsx`. Scenarios (write as the project's markup-string assertions, not full
bodies):

- **Empty list is inert** — `items: []` → markup is `''` (zero footprint), no bubbles, no crash.
- **One `assistantText` → one assistant bubble** carrying its text and the `.bubble--daemon` /
  `data-thread-role="assistant"` treatment.
- **Untrusted text renders as characters, not markup** — inject `text: '<b>hi</b>'`; assert the markup
  contains the escaped form (`&lt;b&gt;hi&lt;/b&gt;`) and does **not** contain a live `<b>` tag inside the
  bubble. (Discharges #199's handoff. Avoid apostrophes in fixtures — `renderToStaticMarkup` escapes `'`
  → `&#x27;`, per prior desktop lesson.)
- **Cursor present on the in-progress tail** — a list ending in an `assistantText` shows `bubble__cursor`
  on that bubble.
- **Cursor absent once closed** — the same list with a trailing `turnBoundary` for that turn shows no
  `bubble__cursor` anywhere.
- **Order preserved, cursor only on the tail** — `[assistantText(t1), turnBoundary(t1), assistantText(t2)]`
  → two bubbles in source order, `bubble__cursor` on the second only.
- **`toolCall` is a safe no-op** — a list containing a `toolCall` renders without throwing and produces
  no assistant bubble for it (proves no `assertNever` crash; #205 owns its real render).
- **`turnBoundary` draws nothing** — a lone `turnBoundary` renders no visible divider and no crash.
- **Container smoke** — `<ConversationScreen />` still renders without throwing against the empty timeline
  store (getInitialState `items: []` under server render), contributing no `bubble__cursor`; the existing
  `bubbleCount === 0` assertion is unaffected. The populated timeline path is unreachable under server
  render (zustand v5 reads `getInitialState()`), which is exactly why the populated assertions live on the
  pure `Timeline` view — the `MessageThread` / `RepairPrompt` discipline.

No test for `useTimelineBridge` itself — a bare hook is untestable without a React renderer (none in this
repo), exactly as `useDaemonEventBridge` has none; its behavior is carried by #202's merged
`subscribeTimeline` spy tests.

## Open questions

- **Dual-thread layout at the #179 cutover (out of scope here, flag for #179).** Today only the coarse
  `MessageThread` has content and the empty `Timeline` returns `null`, so the layout is pixel-identical
  (AC4 clean). After #179 flips `interactive` and stops the coarse fan-out, the coarse `MessageThread`
  will render an *empty* `.conversation__thread` (still `flex: 1 1 auto`, still claiming space) beside the
  now-populated timeline — a half-height dead region. **#179 owns reconciling this** (e.g. render one
  thread or the other off the interactive flag, or have `MessageThread` return `null` when empty). #203
  must not touch it: flipping/gating here would violate "no `interactive` flip in this slice." Noted so
  #179 inherits the seam explicitly rather than rediscovering it.
- **Cursor blink.** Recommended as subtle polish but optional; if added it is the renderer's first
  animation and must carry a `prefers-reduced-motion` guard. The static caret meets the AC on its own.
