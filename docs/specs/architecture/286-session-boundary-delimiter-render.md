# #286 — Render the session-boundary delimiter in the conversation thread

Consume the widened `sessionTransition` renderer event (#285, merged) and draw a session-boundary
delimiter in the timeline: a titled horizontal rule that marks where a `/clear`, an idle eviction, or a
workspace change started a fresh session. This is the render half of #144 and the fifth application of
the established "new timeline-item kind → bridge arm → render row" pattern (#218 tool call, #230 tool
result, #245 user text). One indivisible vertical slice — the type is dead until the row renders it — so
it stays a single ticket, exactly as those three did.

## Files to read first

- `src/renderer/src/store/threadTimeline.ts` — the pure timeline reducer. `ThreadItem` (24–39),
  `ThreadEvent` (46–56), and `reduceTimeline` (120–169). Model the new arms on the `userText` member
  (a whole-message, fresh tail-append, never coalesced). Note `TurnPhase` (11) is a **renderer-local
  re-declaration** of `WireTurnState`, not an import — you mirror that for the reason enum (see Design).
- `src/renderer/src/store/timelineBridge.ts` — `translateTimelineEvent` (35–97). `sessionTransition`
  currently sits in the no-op fall-through group (line 83); you move it into a translating arm. Copy the
  fresh-literal, named-field discipline of the `toolUse` / `toolResult` arms (45–67).
- `src/renderer/src/store/timelineBridge.test.ts` — the translate-arm test idiom (asserts
  `translateTimelineEvent` directly). Add the sessionTransition→sessionBoundary case here.
- `src/renderer/src/store/threadTimeline.test.ts:1–40` — the reducer fixture-builder idiom (`delta`,
  `toolUse`, `userText`, `run`). Add a `sessionBoundary` builder + reducer cases in the same shape.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` — `Timeline` (125–145), `TimelineRow`
  (151–224), and the container (42–92). The `TimelineRow` switch is exhaustive over four kinds with **no
  `default`**; its comment (147–150) explicitly anticipates "a future fifth ThreadItem kind" — this is
  that kind. Copy the untrusted-text posture of the `toolCall`/`userText` cases (auto-escaped children).
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:60–332` — the `Timeline` server-render
  test block (the `renderToStaticMarkup` + substring-assertion idiom). Your render-row cases go here.
- `src/renderer/src/screens/channels/channelListViewModel.ts:58–76` — `formatLastActivity`: the
  **structural reference** for the relative-time helper (pure, injected `now`, `Date.parse`, graceful
  degrade). You write a *long-form sibling*, you do not reuse it (see Design → Relative time).
- `src/renderer/src/screens/channels/ChannelList.tsx:29–52` — the `now = Date.now()`-in-the-container /
  pure-view-takes-`now` injection pattern you mirror in `ConversationScreen` → `Timeline`.
- `src/shared/wire/types.ts:255–283` — `WireSessionTransitionReason` (the closed 3-value enum) and
  `SessionTransitionPayload`. Read the `workspace_cwd` nullability contract (non-null iff
  `workspace_change`) and the `occurred_at` RFC3339Nano note.
- `src/shared/ipc/events.ts:90–110` — the `sessionTransition` DaemonEvent arm and its load-bearing
  comment pinning the four render fields, the wire-nullability-preserved rule, and the **untrusted
  `workspaceCwd` → plain text, never HTML** constraint you inherit here.
- `src/renderer/src/screens/conversation/conversation.css:271–341` — the `.tool-row*` block: the
  token-only, `--font-mono` name run, `--color-outline-variant` border precedent your delimiter CSS
  follows.
- `src/renderer/src/theme/tokens.css:15–96` — confirm the tokens named in the CSS section below exist.
- `src/renderer/src/store/daemonEventBridge.ts:83` and `modalBridge.ts:79` — **read-only, no change.**
  Both already carry `sessionTransition` in their no-op groups (it has been in the union since #254/#285),
  so only `timelineBridge` changes. Confirm this so you do not touch them.

## Context

When a conversation's session rotates the daemon emits a `session_transition` marker; #285 widened the
renderer's `sessionTransition` event to carry `reason`, `workspaceCwd`, and `occurredAt` beside
`newSessionId`. Today the timeline bridge no-ops that event, so old and new sessions render as one
continuous thread and the "Claude no longer remembers what is above this line" boundary is invisible.
This ticket adds the delimiter item and its render row so the break shows in arrival order between
message groups.

Two independent subscribers read `sessionTransition` off the daemon-event channel: the #259 session-id
holder (retains `newSessionId` for per-session settings addressing) and — after this ticket — the
timeline bridge (renders the delimiter). They are separate subscribers; moving `sessionTransition` out of
`timelineBridge`'s no-op group does not affect the holder. This slice consumes only the three **render**
fields and drops `newSessionId`.

## Design

### Module structure (4 production files + 1 CSS)

1. `threadTimeline.ts` — new `sessionBoundary` `ThreadItem` kind, new `sessionBoundary` `ThreadEvent`, new
   reducer arm. (~15 LOC)
2. `timelineBridge.ts` — move `sessionTransition` from the no-op fall-through into a translating arm;
   update the docstring (the bridge now owns six arms, not five). (~10 LOC)
3. `ConversationScreen.tsx` — new `sessionBoundary` case in `TimelineRow`; thread `now` from the container
   through `Timeline` → `TimelineRow`. (~20 LOC)
4. **NEW** `screens/conversation/sessionBoundaryViewModel.ts` — pure, framework-free title + long-form
   relative-time derivation (the `channelListViewModel.ts` idiom), unit-tested without React. (~45 LOC)
5. `conversation.css` — the `.session-delimiter` block. (~25 LOC)

### Key types

Renderer-local reason enum — **re-declared, not imported** from wire, mirroring how `TurnPhase` mirrors
`WireTurnState` (keeps `threadTimeline.ts` wire-free; the bridge assigns `event.reason` with no cast
because the literal unions are identical, and a future 4th wire reason becomes a compile error here — the
intended no-drift guard):

```ts
// threadTimeline.ts
export type SessionBoundaryReason = 'clear' | 'idle_evict' | 'workspace_change'
```

New `ThreadItem` member (carry the raw `occurredAt`; format at render, per the channel-list precedent —
never bake a formatted string into the item):

```ts
| { kind: 'sessionBoundary'; reason: SessionBoundaryReason; workspaceCwd: string | null; occurredAt: string }
```

New `ThreadEvent` member (field-for-field identical → the bridge is a filter + fresh copy, not a remap):

```ts
| { type: 'sessionBoundary'; reason: SessionBoundaryReason; workspaceCwd: string | null; occurredAt: string }
```

`newSessionId` is deliberately absent from both — it has no render consumer (the #259 holder owns it).

### Data flow

`daemon → sessionTransition DaemonEvent → translateTimelineEvent → sessionBoundary ThreadEvent →
reduceTimeline (fresh tail-append) → sessionBoundary ThreadItem → TimelineRow → titled <hr> row`.

- **Bridge arm** (`timelineBridge.ts`): `case 'sessionTransition'` returns a fresh literal
  `{ type: 'sessionBoundary', reason: event.reason, workspaceCwd: event.workspaceCwd, occurredAt:
  event.occurredAt }` (drops `newSessionId`). Remove `sessionTransition` from the no-op case list and its
  mention in the fall-through comment; the exhaustiveness guard (`assertNever`) stays load-bearing.
- **Reducer arm** (`reduceTimeline`): appends the item to `items`, `phase` untouched — the `userText` /
  `turnEnd` discipline (fresh tail-append, always a new `items` array, never coalesced). Satisfies AC1
  (arrival-order, fresh row, never merged into an adjacent bubble).

### Render row (`TimelineRow` `sessionBoundary` case)

Title above a horizontal rule (Figma order), matching node 16-35. Structure (contract, not final markup):

- A wrapper `<div className="session-delimiter">` carrying **no `data-thread-role`** (AC4 — distinct from
  assistant/user/tool; identified by class, the `.conversation__empty` / thinking-indicator idiom).
- A `<p className="session-delimiter__title">{title}</p>` where `title =
  sessionBoundaryTitle(item, now)`. `workspaceCwd` reaches the DOM only inside this string as **auto-escaped
  React children** — never `dangerouslySetInnerHTML`, no path/markup interpretation (inherits the
  `events.ts` constraint; the `toolCall`/`userText` posture).
- A `<div className="session-delimiter__rule" aria-hidden="true" />` — the horizontal rule (a styled div,
  the `.tool-row` decorative-element precedent; not a semantic `<hr>` — it is purely visual).

The switch stays exhaustive over five kinds with no `default`; update the 147–150 comment (fifth kind now
present). `turnBoundary` still returns `null`.

### Title derivation (`sessionBoundaryViewModel.ts`)

Two pure exports:

- `formatSessionBoundaryTime(iso: string, now: number): string` — **long-form** relative time. Same
  structure as `formatLastActivity` (pure, injected `now`, `Date.parse`, graceful degrade) but long labels:
  `just now` / `N minutes ago` / `N hours ago` / `Yesterday` / `N days ago`, and the same UTC `Mon D`
  fallback beyond a week. Singular at 1 (`1 hour ago`, not `1 hours ago`). Unparseable → `''`; future
  `now`/clock-skew → `just now`. Figma copy `2 hours ago` is the hours bucket.
- `sessionBoundaryTitle(item, now)` — takes the narrowed `sessionBoundary` item + `now`, returns
  `${label}${time ? ` — ${time}` : ''}` (em dash U+2014, spaced; drop the separator when the time degrades
  to `''`). `label` comes from an **exhaustive switch on `reason`** (with an `assertNever` default):
  - `workspace_change` → `Workspace changed to ${workspaceCwd}` (Figma-confirmed). If `workspaceCwd` is
    `null` (a wire-contract violation — the field is `string | null` unconditionally), degrade to the
    pathless `Workspace changed`; never render the literal `null`.
  - `clear` → **provisional** `New session` (see Open questions).
  - `idle_evict` → **provisional** `New session after idle` (see Open questions).

  Keep provisional copy **apostrophe-free** (recurring desktop lesson: `renderToStaticMarkup` escapes
  `'` → `&#x27;`, which complicates substring assertions).

### `now` injection / re-render seam

`ConversationScreen` (container) captures `const now = Date.now()` at render (safe under
`renderToStaticMarkup` in Node — the `ChannelList` precedent) and passes it to `<Timeline items={items}
now={now} />`; `Timeline` forwards it to each `<TimelineRow ... now={now} />`. Give `Timeline`'s (and
`TimelineRow`'s) `now` param a **default of `Date.now()`** so the ~15 existing `<Timeline items=.../>`
test call sites stay green untouched (they render no `sessionBoundary` row, so `now` is never consulted) —
this avoids an edit cascade across the test file. The deterministic time assertions live in the
`sessionBoundaryViewModel` unit tests (fixed `now`), not the render tests. Selecting only the `items` slice
is unchanged; `now` is a plain render-time value, not store state, so it adds no new subscription.

### CSS (`.session-delimiter`, token-only — every value below exists in `tokens.css`)

- `.session-delimiter` — `display: flex; flex-direction: column; align-items: center; gap: var(--space-3);
  padding: var(--space-5) 0 var(--space-1);` (Figma 12px gap, 20px top / 4px bottom). A child of
  `.conversation__thread`'s flex column (inherits its horizontal padding), the `.tool-row` posture.
- `.session-delimiter__title` — `--font-mono` (Figma Roboto Mono), `--text-body-small-*` (12/16/0.4px/400),
  `color: var(--color-on-surface-variant)`, `text-align: center`, `word-break: break-word` (an untrusted
  long path must wrap, not overflow).
- `.session-delimiter__rule` — `width: 100%; height: 1px; background: var(--color-outline); opacity: 0.6;`
  (Figma `outline` #8c9199 at 60%).

### Out of scope (deferred with the memory-plugin subsystem)

The explanatory sentence (`Claude doesn't remember messages above this line…`) and its inert `Install`
affordance (Figma 16-38) are **not built here** — the delimiter is title + rule only. Rationale: the
sentence's payload is the Install CTA, which depends on a memory-plugin subsystem desktop does not have;
rendering the sentence without a working Install advertises a capability that does not exist. Both ship
together in the follow-up. The AC list requires only rule + title, so this keeps scope tight
(Simplicity-First). If design later wants the first sentence as static context, it is a trivial additive
follow-up.

## State + concurrency model

No new store, no async, no subscription, no teardown surface. Purely additive to the existing synchronous
`daemon-event → translate → reduce → render` path. `timelineStore` is the single source of timeline state;
the delimiter is one more item kind in its `items` array. No two-way binding, no new IPC, no transport
change. `now` is a render-local value (`Date.now()` in the container), not state.

## Error handling

- **Untrusted `workspaceCwd`** (daemon-supplied filesystem path) — rendered as auto-escaped React children
  inside the title string; React's default escaping is the deterministic guard (never
  `dangerouslySetInnerHTML`). Test: a `workspaceCwd` of `<b>x</b>` renders `&lt;b&gt;x&lt;/b&gt;`, never
  live markup — the `toolCall`/`userText` escaping test posture.
- **`null` `workspaceCwd` on `workspace_change`** — wire-contract violation; degrade to the pathless
  `Workspace changed`, never the literal `null`.
- **Unparseable / future `occurredAt`** — `formatSessionBoundaryTime` returns `''` (title renders label
  only, separator dropped) / `just now` respectively; no throw, mirroring `formatLastActivity`.
- **A future 4th wire reason** — a compile error at the renderer-local `SessionBoundaryReason` assignment
  and at the `sessionBoundaryTitle` `assertNever` (the intended no-drift posture; the wire decoder already
  fails such a frame closed upstream, `types.ts:255–258`).

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. All new tests are pure (server-render or plain function) — no
jsdom, no network, mirroring the existing conversation/timeline suites.

**`sessionBoundaryViewModel.test.ts` (NEW — the deterministic logic, the `formatLastActivity.test.ts` shape):**
- `formatSessionBoundaryTime` with a fixed injected `now`: `just now` (<1m and future/skew); `5 minutes
  ago`, `1 minute ago` (singular); `2 hours ago`, `1 hour ago`; `Yesterday` (24–48h); `2 days ago`; a
  stable timezone-independent `Jan …` beyond a week; `''` for a malformed/empty timestamp.
- `sessionBoundaryTitle` per reason: `workspace_change` → `Workspace changed to <path> — <time>` (path
  verbatim); `workspace_change` with `null` cwd → pathless, no `null`; `clear` / `idle_evict` → the
  provisional pathless labels; separator dropped when the time is `''`.

**`threadTimeline.test.ts` (reducer arm):**
- A `sessionBoundary` event appends a fresh `sessionBoundary` item in arrival order (assert it lands
  between two surrounding items, never coalesced, `items` reference changes, `phase` untouched).

**`timelineBridge.test.ts` (translate arm):**
- `translateTimelineEvent` of a `sessionTransition` DaemonEvent returns a `sessionBoundary` ThreadEvent
  carrying `reason`/`workspaceCwd`/`occurredAt` and **not** `newSessionId`.

**`ConversationScreen.test.tsx` (render row, server-rendered with a fixed `now` via the Timeline prop):**
- A `sessionBoundary` item renders `session-delimiter` + `session-delimiter__rule`, carries the title text,
  and has **no `data-thread-role`** and no `bubble__cursor`; it is not counted as an assistant/user/tool row.
- The untrusted `workspaceCwd` (`<b>x</b>`) renders escaped, never live markup.
- Regression (AC5): the existing empty-store container tests (no `data-thread-role`, no
  `conversation__thread`) stay green — the delimiter appears only when a `sessionBoundary` item exists.

## Open questions

- **Provisional `clear` / `idle_evict` copy.** Figma node 16-35 draws only the `workspace_change` variant.
  `New session` / `New session after idle` are placeholders — confirm with Juhana or add Figma variants if
  exact wording matters. (Ticket-sanctioned as provisional.)
- **Explanatory sentence.** Deferred with the Install affordance (above). Flag if design wants the first
  sentence (`Claude doesn't remember messages above this line`) shown as static context sooner — a small
  additive follow-up.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-35

Session delimiter (under Conversation Thread Screen 16-8): a centered vertical column — a monospace title
(`Roboto Mono` 12px, on-surface-variant) reading `Workspace changed to ~/Workspace/Projects/KitchenClaw —
2 hours ago` sitting **above** a full-width 1px horizontal rule (`outline` #8c9199 at 60% opacity), with a
body-small explanatory sentence and an `Install` action below the rule. This ticket builds the title + rule
only; the explanatory sentence and the `Install` affordance (node 16-38) are deferred (see Out of scope).
