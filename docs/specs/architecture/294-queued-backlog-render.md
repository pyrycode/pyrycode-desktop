# #294 — Render the queued backlog distinctly in the thread

## Files to read first

- `src/renderer/src/store/queueStore.ts:78-98` — `selectBacklogFor(conversationId)` (the read surface this slice consumes), `EMPTY_BACKLOG` (stable empty ref → churn-free empty read), `useQueueStore`. The selector returns the SAME array reference for the same id across unrelated snapshots → narrow-slice-correct.
- `src/renderer/src/store/queueStore.ts:27-45` — `QueueSnapshot` / `QueueState` shapes; the store holds `readonly QueuedItem[]` **verbatim, snake_case** (no camelCase remap), so the view reads `item.text` / `item.queued_msg_id` directly.
- `src/shared/wire/types.ts:325-340` — `QueuedItem = { queued_msg_id: number; text: string; ts: string }`. Read the doc comment: `text` is UNTRUSTED client-originated transit content — "the render slice (#294) must render it as plain text, never HTML". `queued_msg_id` is a per-conversation integer counter ≥ 1 (unique within a backlog → usable as the React key).
- `src/renderer/src/screens/conversation/composerSend.ts:10-17` — `MILESTONE_CONVERSATION_ID = 'default'`. The single active conversation for this milestone; the same id the composer sends under. This slice reads the backlog under this constant. **Do not add nav plumbing to thread a conversation id.**
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:295-318` — `ThinkingIndicator`: the exact "empty → `null`" posture and the pure-view + in-file-container idiom this slice mirrors.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:246-259` — the Timeline `userText` case: the right-aligned `message-row--user` / `bubble--user` treatment + auto-escaped-children (never `dangerouslySetInnerHTML`) posture the queued rows reuse.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:66-96` — the render tree and the sibling seam (`Timeline` → `ThinkingIndicator` → `StatusRow` → `Composer`) where the new region mounts.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:532-561` — `ConnectionBanner` / `ConnectionBannerControl`: the pure-view-exported + in-file-store-container pair this slice copies structurally.
- `src/renderer/src/screens/conversation/conversation.css:198-232` — `.message-row` / `.message-row--user` / `.bubble` / `.bubble--user` (the reused user treatment).
- `src/renderer/src/screens/conversation/conversation.css:254-283` — `.conversation__thinking` (the `flex: 0 0 auto` non-growing region layout) and `.tool-row` (the **50%-opacity pending dimming** — the within-token "not yet run" precedent for the waiting treatment).
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:396-409, 553-660` — the `ThinkingIndicator` pure-view describe and the `ConversationScreen — store binding` smoke block; the new tests slot into these two shapes. Note the existing #179 AC4 guard at lines 572-577 (`not.toContain('data-thread-role')`, `not.toContain('conversation__thread')`) — it must stay green (see § Regression note).

## Context

Today the thread renders only delivered messages and structured events (the `Timeline` over `timelineStore`). When the daemon is busy and the user keeps typing, their messages queue in the daemon's backlog — but the desktop shows nothing waiting. #293 landed the app state: a `conversationId`-keyed, replacement-truth queue store (`queueStore.ts`, merged PR #298) that the data path (`queueBridge.ts`) writes from the decoded `queue_state` snapshot (#292). This slice is the **render surface** over that store: it displays the held backlog in the thread, in enqueue order, visually distinct from delivered messages, updating live as snapshots arrive.

Display only. The drop / cancel affordance is #296. This slice reads app state read-only; it never touches the transport, `window.pyry`, or IPC.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8 (Conversation Thread Screen; the Message list `16:21` is where queued messages appear.)

N/A for the queued-message visual itself — the mobile Figma file draws only the populated / delivered thread and has no dedicated queued / pending component (the same documented gap as #148's thread-chrome states; a desktop-specific design is deferred until the app is fully functioning, project decision 2026-07-03). The anchor confirms the layout the queued rows must fit into: right-aligned blue user bubbles (`bubble--user` / `--color-primary-container`), left-aligned grey daemon bubbles, dimmed tool chips, and the status row above the composer. Queued messages are the user's own pending sends, so this slice reuses the right-aligned user-bubble treatment with an added muted "waiting" dimming (the `.tool-row` 50%-opacity precedent) so a dimmed right-aligned bubble stack below the delivered thread reads as "typed, not yet run".

## Design

A pure props-in / markup-out view plus a thin store-bound container, **both added inside `ConversationScreen.tsx`** — the exact idiom every sibling render slice uses (`ThinkingIndicator`, `ConnectionBanner`/`ConnectionBannerControl`, the tool row). No new file: keeps the change to one production `.tsx` and one CSS file, and matches the container/view split precedent.

### Contracts (signatures only — no bodies)

```ts
// Pure view — exported so tests server-render an injected backlog with no store.
export function QueuedBacklog({ items }: { items: readonly QueuedItem[] }): JSX.Element | null
// items empty → null (the ThinkingIndicator posture): no region, no chrome (AC4).
// non-empty → one row per item, in array order (= enqueue order), each showing item.text
//   as auto-escaped React children. React key = item.queued_msg_id (a real, unique,
//   per-conversation integer — better than an array index; no synthetic key needed).

// Thin store-bound container — in-file, NOT exported (the ConnectionBannerControl posture).
function QueuedBacklogControl(): JSX.Element | null
// Reads the milestone backlog slice and passes it to QueuedBacklog. No window.pyry, no IPC,
// no effects — a pure store read (AC5).
```

- **Reading the backlog.** Hoist the bound selector to module scope so it is created once, not per render:
  `const selectMilestoneBacklog = selectBacklogFor(MILESTONE_CONVERSATION_ID)`. The container is
  `const items = useQueueStore(selectMilestoneBacklog)`. Because `selectBacklogFor` returns the same
  array reference (or the stable `EMPTY_BACKLOG`) for a given id, the selected value is `Object.is`-stable
  across snapshots for *other* conversations → no re-render churn (AC3 free-of-noise).
- **Imports the view needs:** `import type { QueuedItem } from '@shared/wire/types'` (the `@shared` alias
  is available in the renderer — `composerSend.ts` already uses it); `useQueueStore`, `selectBacklogFor`
  from `../../store/queueStore`; `MILESTONE_CONVERSATION_ID` from `./composerSend`.
- **Row markup.** Each row reuses the delivered user treatment verbatim — `className="message-row
  message-row--user"` wrapping `className="bubble bubble--user"` — but carries its own thread role
  `data-thread-role="queued"` (distinct from delivered `data-thread-role="user"`), which is the structural
  seam the tests count on and the AC2 "distinct from delivered" hook. `item.text` is passed as React
  children (auto-escaped) — **never `dangerouslySetInnerHTML`** — matching the Timeline `userText` /
  toolCall / sessionBoundary rows (the wire type's own comment mandates plain-text render; this is
  load-bearing even though the ticket is not `security-sensitive`).

### Placement (render tree)

Mount `<QueuedBacklogControl />` in the existing sibling seam, **after** `<ThinkingIndicator />` and
**before** `<StatusRow />` in `ConversationScreen`'s return:

```
<Timeline items={items} now={now} />
<ThinkingIndicator isThinking={phase === 'thinking'} />
<QueuedBacklogControl />           {/* #294 — the not-yet-run tail */}
<StatusRow onExpand={…} />
<Composer />
```

So the dimmed queued rows read as the tail below the delivered thread and the working indicator, above the
run-config row and composer — "what is still waiting to run".

### CSS (one new region rule; reuse everything else)

Add a single region class to `conversation.css`, modelled on `.conversation__thinking` (non-growing) +
`.conversation__thread` (column + gap) + `.tool-row` (opacity as the pending de-emphasis device):

```css
.conversation__queued {
  flex: 0 0 auto;                 /* never competes with the timeline's flex region */
  display: flex;
  flex-direction: column;
  gap: var(--space-3);            /* the thread's inter-row gap */
  padding: var(--space-2) var(--space-4);
  opacity: 0.5;                   /* the .tool-row pending-dimming precedent, token-free device */
}
```

The region carries the layout + the single load-bearing "waiting" signal (50% dimming). Rows reuse
`message-row--user` / `bubble--user` unchanged — no new bubble/row modifier class is needed; the dimming
is the modifier (the tool-row pattern exactly). Place the rule near `.conversation__thinking` with a
short comment noting the Figma gap and the reuse rationale.

## State + concurrency model

- **Store slice:** the `queueStore` singleton (#293), read via `useQueueStore(selectMilestoneBacklog)`.
  No new store, no new state. Single source of truth; read-only selectors; the view never writes.
- **Reactivity (AC3):** free from the store subscription. A fresh `queue_state` snapshot for
  `MILESTONE_CONVERSATION_ID` calls `setBacklog`, which replaces the map; `selectMilestoneBacklog` returns
  the new array reference → `Object.is` false → the container re-renders → add / remove / reorder all
  reflected with no manual refresh. A snapshot for a *different* conversation replaces the map but returns
  the same array for the milestone id → `Object.is` true → no re-render.
- **No async, no cancellation, no effects.** Pure synchronous render off a Zustand slice. Teardown is
  React unmount; nothing to clean up.

## Error handling

None to add. The store holds decoded `QueuedItem`s verbatim; #292 owns the fail-closed decode, so the view
receives only well-typed items. The single defensive posture is the **plain-text render** of untrusted
`text` (React auto-escaping), asserted by a `<b>…</b>`-fixture test. No network / socket / parse surface
reaches this slice (AC5).

## Regression note (existing tests that must stay green)

The `ConversationScreen — store binding` block asserts, against the **empty** initial store, both
`not.toContain('data-thread-role')` and `not.toContain('conversation__thread')` (#179 AC4, lines 572-577).
Both hold unchanged:
- The initial queue store has an empty backlog (`backlogs` is an empty `Map` → `selectMilestoneBacklog`
  returns `EMPTY_BACKLOG`), so `QueuedBacklog` returns `null` → emits no `data-thread-role`.
- The region class is `conversation__queued`, which does **not** contain the substring
  `conversation__thread`.

Call this out to the developer: the new `data-thread-role="queued"` seam appears only in the populated
(pure-view) tests, never in the empty container smoke.

## Testing strategy

`npm test` (vitest, `renderToStaticMarkup`, no DOM harness) — the MessageThread / Timeline / ThinkingIndicator
idiom. Fixtures are injected `QueuedItem[]`; no store, no IPC. The populated path lives on the pure view
(the container's populated branch is unreachable under server render — zustand v5 reads
`getInitialState()` = empty backlog), exactly like `ThinkingIndicator` / `ConnectionBanner`.

Add a `describe('QueuedBacklog — the held queued backlog (#294)')` block over the pure view. Scenarios
(inputs → expected; developer writes the assertions in the project idiom):

- **Empty backlog → nothing rendered.** `items: []` → `renderToStaticMarkup(...)` is `''` (AC4: no region,
  no empty-state chrome — contrast the Timeline's empty-thread invitation).
- **One row per queued item, in enqueue order, each showing its text (AC1).** Two-plus items with distinct
  `text` → the region `conversation__queued` present; each `text` present; `indexOf(first) < indexOf(second)`
  proves array/enqueue order is preserved.
- **Visually distinct from delivered (AC2).** A populated backlog → markup contains `conversation__queued`
  (the dimmed region) and `data-thread-role="queued"`; it reuses `bubble--user` (assert present) but the
  queued role is distinct from the delivered `data-thread-role="user"` seam. (One assertion pins that the
  queued rows do not carry `data-thread-role="user"`.)
- **Untrusted text rendered as plain text, never live markup (load-bearing).** Fixture `text: '<b>x</b>'`
  (no apostrophes — `renderToStaticMarkup` escapes `'` → `&#x27;`, a prior desktop lesson) → markup contains
  `&lt;b&gt;x&lt;/b&gt;` and **not** `<b>x</b>`.
- **Row identity keyed by `queued_msg_id`.** Optional: distinct `queued_msg_id`s across items render without a
  duplicate-key warning; the real seam is that both items' text appears in order (covered above).

Add one container smoke assertion in the existing `ConversationScreen — store binding` block:

- **Mounts against the empty queue store → renders no queued region.**
  `not.toContain('conversation__queued')` and (implicitly) keeps the #179 AC4 guard green.

Type-level coverage: `npm run typecheck` (both sides). The view consumes `readonly QueuedItem[]` directly
from `@shared/wire/types` — no new type introduced, no drift from the wire contract.

## Open questions

- **Dimming target — region vs. per-bubble.** The spec dims the whole region (`.conversation__queued`
  `opacity: 0.5`), which is the simplest within-token expression of "waiting" and matches the `.tool-row`
  precedent one-to-one. If review prefers the dimming on the bubble (so a future per-row state — e.g. a
  cancel-pending row in #296 — can override it), moving `opacity` from the region to a `bubble--queued`
  modifier is a one-line relocation and does not change the view's markup contract. Default: region-level,
  as specified. Flagged only so #296's author knows where to reach.
