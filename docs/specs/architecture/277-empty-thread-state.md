# Spec #277 — Empty-thread state: pre-first-message copy + visual

**Ticket:** pyrycode/pyrycode-desktop#277 (split child of #148) · **Size:** XS · **Security-sensitive:** no (pure renderer — no keys/sockets/Noise/wire code touched).

## Design source

N/A — the mobile Figma file (`g2HIq2UyPhslEoHRokQmHG`) has no frame for the empty conversation thread; only the populated Conversation Thread Screen (node 16-8) is drawn. This spec is sourced from the locked mobile design doc (`design-conversations-model.md`, empty-thread state = mobile #138). That doc pins the copy for the *channel-list* empty state ("Tap + to start a conversation") but leaves the *thread* empty state's exact wording open ("worth a Claude Design pass"); mobile #138 built it as a copy line + visual, "distinct from channel-list empty state." So the copy below is a client-owned proposal, not a Figma-locked string — if a frame lands on the parent #148 before merge, anchor the copy/visual to it.

## Files to read first

- `src/renderer/src/screens/conversation/ConversationScreen.tsx:106-135` — `Timeline`: the pure view whose `if (items.length === 0) return null` branch (line 116) becomes the empty state. This is the *only* production change.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:232-239` — `ThinkingIndicator`: the in-file "small pure component returning a muted-bubble affordance" pattern to mirror (client-owned label constant; inline SVG/`aria-hidden` idiom).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:55-82` — `ConversationScreen` container: `<Timeline items={items} />` at line 59 sits in the flex column between the back/unpair controls and `StatusRow`/`Composer`. The empty block must occupy that flexible middle region.
- `src/renderer/src/screens/conversation/conversation.css:124-134` — `.conversation__thread` (the scroll region: `flex: 1 1 auto; min-height: 0`). The empty block reuses the flex-fill idea but is a **distinct class** — do not render `.conversation__thread` (see the test constraint below).
- `src/renderer/src/screens/conversation/conversation.css:192-207` — `.conversation__thinking` / `.bubble--thinking`: the muted-affordance token treatment to echo (`--color-on-surface-variant`, token-only, no literals).
- `src/renderer/src/screens/channels/channels.css:158-169` — `.channel-list__empty`: the "No conversations yet" treatment (top-padded centered `<p>`, body-medium, muted, **no icon, not flex-filling**). AC4 requires the thread empty state to be visually distinct from this.
- `src/renderer/src/screens/channels/ChannelList.tsx:104-109` — the channel-list empty branch, for the "list-level absence vs in-thread pre-first-message" contrast.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:70-73` — the pure `Timeline` empty test (`toBe('')`) to flip (AC5).
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:429-446` — the two container empty-render tests: `:433` (the **guard** that must stay green) and `:443` (the second test to flip, AC5).

## Context

A fresh conversation thread with no messages currently renders nothing between the top controls and the composer: since #203/#179 retired the coarse `MessageThread`, `Timeline` is the single thread container and returns `null` on an empty item list (`Timeline` at `ConversationScreen.tsx:116`, #203 AC4). The result reads as broken/blank before the first message lands. This ticket replaces the bare `null` with a purposeful pre-first-message empty state (a short guiding copy line + a visual treatment), matching mobile's dedicated empty-thread state (mobile #138) and distinct from the Channel List's "No conversations yet" list-level empty (#141).

This is the first of #148's empty-surface children to land; **#278 (workspace chip) is blocked by it** and renders a pill at the top of this same empty surface pre-first-message. Leave that seam (below); do not build the chip.

## Design

Single production edit, in `Timeline`'s empty branch. Two small pieces:

### 1. Client-owned copy constant (AC3)

A module-level string literal near `Timeline`:

```
const EMPTY_THREAD_COPY = 'Send a message to get started'
```

Proposed wording — reads as an in-thread pre-first-message invitation, semantically distinct from the channel-list "No conversations yet" list-absence line (AC4). The load-bearing contract is *that it is a client-owned constant*: `Timeline` receives only `items`, and the empty branch renders this literal, so no daemon-supplied string can reach the empty state (AC3 is a structural guarantee, mirroring `ThinkingIndicator`'s client-owned label). The developer/design may refine the exact wording; the constant + distinctness are what matter.

### 2. Empty-state block (AC1) — the changed branch

`Timeline`'s `if (items.length === 0) return null` becomes `return <EmptyThread />` (an in-file, unexported pure component beside `TimelineRow` — the `ThinkingIndicator` idiom; inlining the JSX directly in the branch is equally acceptable). `EmptyThread` renders:

- A wrapper `<div className="conversation__empty">` — **distinct class, never `conversation__thread`, and no `data-thread-role` attribute** (see § State + test constraint). Occupies the flexible middle region (`flex: 1 1 auto`), centering its content on both axes.
- A decorative visual: a muted inline SVG glyph (`aria-hidden="true"`, `className="conversation__empty-icon"`) — the file's existing inline-SVG idiom (cf. the send/back/chevron icons). Use a recognizable message/chat outline glyph (e.g. a Material 24px `chat_bubble_outline`-style path) at the send-square structural size (~48px). This icon is what makes the state visually distinct from the icon-less channel-list empty (AC1/AC4). Keep it decorative — the copy carries the meaning.
- The copy: `<p className="conversation__empty-copy">{EMPTY_THREAD_COPY}</p>`.

Return type: with both branches now returning an element, `Timeline`'s signature can tighten from `JSX.Element | null` to `JSX.Element` (optional cleanup; leaving the union is harmless since `TimelineRow` still returns `| null`).

### 3. Styles — `conversation.css` (AC1/AC4)

Add three token-only rules (the file's convention — every color/space/type value is a `var(--…)` token; only structural geometry like the ~48px icon square is a bare literal, per the `.composer__send`/`.status-sheet__handle` precedent):

- `.conversation__empty` — `flex: 1 1 auto; min-height: 0;` (fills the region the scroll thread would), `display: flex; flex-direction: column; align-items: center; justify-content: center;` (centered both axes — the visual axis of distinction from the top-anchored `.channel-list__empty`), `gap: var(--space-3);`, `padding: var(--space-4);`, muted `color: var(--color-on-surface-variant);`.
- `.conversation__empty-icon` — `display: block;` at the ~48px structural size, inheriting the muted color.
- `.conversation__empty-copy` — `margin: 0;` reset, centered, body-medium tokens (`--text-body-medium-*`) matching the muted-copy treatment.

### #278 seam (do not build)

#278 adds the workspace chip pill at the **top** of this empty surface pre-first-message. Structure `EmptyThread` so a top-anchored chip can be added later as the surface's first child without disturbing the centered icon+copy (e.g. the chip becomes a top-pinned element and the icon+copy stay centered in the remaining space). This spec owns only the icon+copy; #278 owns the chip and any layout it needs to pin it. No chip work here.

## State + concurrency model

None. `Timeline` stays a pure props-in/markup-out view (`readonly ThreadItem[]` in, markup out); no store slice, IPC, effect, or async work is added. The container's existing `useTimelineStore(selectItems)` read is unchanged — an empty store (`getInitialState` `items: []`) drives the empty branch at first paint, exactly as it drove `null` before.

**Test constraint (load-bearing).** The container test `renders exactly one thread surface — no split-brain, no empty second thread region (AC4)` at `ConversationScreen.test.tsx:433` asserts, against `<ConversationScreen />` on the empty store, `not.toContain('conversation__thread')` **and** `not.toContain('data-thread-role')`. It is **not** in AC5's update scope, so it must stay green: the empty block therefore must use `conversation__empty` (not a substring of `conversation__thread`) and carry no `data-thread-role`. This is why the empty state is a distinct class, not a reuse of the thread scroll region.

## Error handling

No failure modes — no network/socket/parse/permission surface. The empty vs populated choice is a total function of `items.length`. No result type, no UI error surface.

## Testing strategy

`npm test` (vitest, `renderToStaticMarkup` — the file's existing no-DOM-harness pattern) and `npm run build` (typecheck + build, the QA gate).

**Update the two #203 empty-render tests (AC5):**

- `ConversationScreen.test.tsx:71-73` — the pure `Timeline` empty test. Flip from `renderToStaticMarkup(<Timeline items={[]} />)` `toBe('')` to asserting the empty block renders: the markup now contains `conversation__empty` and the copy text (`EMPTY_THREAD_COPY` / "get started"). Rename the test to reflect the new behavior (e.g. "an empty timeline renders the pre-first-message empty state"). Optionally also assert `not.toContain('data-thread-role')` and `not.toContain(CURSOR)` to preserve the no-regression intent (no bubble/cursor sneaks into the empty branch).
- `ConversationScreen.test.tsx:440-446` — the container "mounts the empty timeline with no streaming cursor" test. Keep the existing `not.toContain('bubble__cursor')` assertion and add `toContain('conversation__empty')` (and/or the copy), proving the container renders the empty state through the empty store at first paint. Update the comment (the branch no longer returns `null`).

**Do not change (guards that must stay green):**

- `ConversationScreen.test.tsx:433` — the split-brain guard (`not.toContain('conversation__thread')` / `not.toContain('data-thread-role')`). Its continued pass proves the distinct-class requirement above held. If it goes red, the empty block wrongly reused the thread class or added a role attribute.
- The populated `Timeline` assertions (`ConversationScreen.test.tsx:75-320`) — they inject non-empty `items`, so the empty branch is not taken; AC2 (populated rendering unchanged) is covered by their staying green. `interactiveRoundtrip.test.tsx` likewise passes non-empty items.

**Scenarios covered:**

- Empty `Timeline` → renders `conversation__empty` block with the client-owned copy and the decorative icon; no `data-thread-role`, no cursor (AC1, AC3).
- Populated `Timeline` (≥1 item) → no empty block; the existing bubble/tool-row assertions hold unchanged (AC2).
- Container on empty store → empty block present at first paint; split-brain guard still green (AC1, AC4-via-distinct-class).
- Visual distinctness from `.channel-list__empty` (AC4) is inherent (different class, different copy, icon + centered-fill vs icon-less top-padded) — no cross-file test needed.

## Open questions

- **Exact copy + glyph.** Wording ("Send a message to get started") and the specific icon are architect proposals absent a Figma frame. If the parent #148 gains an empty-thread frame before merge, align both to it; otherwise these ship as the client-owned defaults. Either way AC3's "client-owned constant" contract is unaffected.
