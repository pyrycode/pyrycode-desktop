# Spec #242 — New-discussion FAB on the Channel List

Add the `+` new-discussion FAB to the Channel List home screen. Activating it dispatches the
already-wired `createConversation` command (fire-and-forget); when the daemon confirms with a
`conversationCreated` event, the paired shell navigates list → thread by reusing the existing `open`
transition. Renderer-only — no transport, IPC, store, or wire code is added.

Split from #142; the sibling transport ticket **#241 is merged** (PR #244), so the `createConversation`
command member and the `conversationCreated` daemon event already exist and round-trip.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=15-106

A single rounded-square icon-button (Figma 16px corner) floating bottom-right, filled with the
primary-container color and holding a centered 24px `+`/add glyph in on-primary-container, lifted off
the surface by an M3 level-3 drop shadow. In the desktop dark-only theme this reads as a dark-blue
square with a light `+` (the screenshot confirms; the Figma design-context extract names the fill role
`schemes/primary-container` and the glyph `add`). Token mapping is in the Design section.

## Files to read first

- `src/renderer/src/screens/channels/ChannelList.tsx` — the whole file (~119 lines). The container
  (`ChannelList`) reads the store slice; the pure `ChannelListView` renders it. The FAB is added to the
  pure view as a sibling of `renderBody(...)` so it appears in all three list states; the container
  gains the `onNewConversation` handler. Note the existing `onClick={onOpen}` interim in `Row` and its
  "opening a *specific* conversation needs a select-and-load transport that doesn't exist" comment —
  the FAB navigation is the same conversation-agnostic story.
- `src/renderer/src/screens/channels/channels.css` — the FAB styles land here. Read the header comment
  ("no literal lives here; opacity/1px are the carve-outs") and the `.channel-list` rules (it is the
  `height:100%; overflow-y:auto` scroll column, a direct child of `#root`) — the FAB must pin over this
  scroller.
- `src/renderer/src/store/conversationListBridge.ts` — the **exact pattern to mirror**. `translateConversationsEvent`
  (pure filter arm→data/null), `requestConversationList` (inline-literal command send, no builder),
  `subscribeConversations` (injected `onDaemonEvent`, returns the off handle), and `ConversationListData`
  (React glue, derefs `window.pyry` only inside effects). The new `conversationCreatedBridge.ts` is this
  module's twin for the create/created pair.
- `src/renderer/src/PairedShell.tsx:42-52` — the container owns the nav `useReducer(nextPairedRoute, 'list')`.
  The `dispatch` here is what the new hook drives (`dispatch({ type: 'open' })`). Note the invariant in
  its doc comment: "No effects and no window deref, so it is server-renderable" — the new hook must
  preserve it (deref `window.pyry` only inside the effect).
- `src/renderer/src/pairedRoute.ts:11-42` — `PairedRoute`/`PairedNav`/`nextPairedRoute`. `open` → `'thread'`
  is already the transition and is already unit-tested; the FAB nav reuses it with no new route or nav arm.
- `src/shared/wire/types.ts:455-491` — `CreateConversationPayload` (three **nullable-and-present** fields;
  the FAB sends `is_promoted:false, name:null, cwd:null`) and `ConversationCreatedPayload` (the created
  event's 5-field body; its untrusted `name`/`cwd` are **not** rendered by this ticket).
- `src/shared/ipc/commands.ts:68-76` — the `createConversation` command member (already present, no
  builder). `src/shared/ipc/events.ts:122-129` — the `conversationCreated` event arm (already present).
  Read-only confirmation; **do not modify these** — the contracts are landed.
- `src/renderer/src/screens/conversation/interactiveRoundtrip.test.tsx` — the **testing harness to
  mirror** for the event-driven half: `fakeBridge()` captures the `onDaemonEvent` listener and hands
  back an off spy, drives events through the real bridge helper, then server-renders. Note its explicit
  stance: "The click→command wiring is unit-proven … not a re-test of the click" — there is **no jsdom**.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` and `src/renderer/src/PairedShell.test.tsx` —
  the two suites to extend. Both use `renderToStaticMarkup` (no DOM harness). `PairedShell.test.tsx`'s
  header documents the composition philosophy the nav test follows.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:459-475` — `BackControl`, the icon-only
  `<button aria-label>` + inline `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>` idiom the
  FAB button mirrors (with the Material `add` path instead of `arrow_back`).
- `src/renderer/src/theme/tokens.css:24-26,90-95` — `--color-primary-container` / `--color-on-primary-container`
  and the `--radius-*` scale (note the 12→20 gap; the FAB's 16px maps to the nearest token). `src/renderer/src/screens/pairing/pairing.css:55` — the "±token-mapping, document the delta" precedent.

## Context

The Channel List (#141) intentionally deferred the `+` FAB to this ticket — its empty-state copy and
`Row` comments already name it. The paired shell (#140, ADR 0006) already models `open`/`back`
navigation over a screen-local `useReducer`; "open the new thread on success" reuses the existing `open`
transition, so no new route, nav arm, or store slice is introduced (the ticket's explicit constraint).

The FAB does exactly one thing on click: **dispatch the create command** (fire-and-forget). Navigation
is decoupled and event-driven — it happens later, when the daemon's `conversationCreated` confirmation
arrives — never synchronously from the click. This mirrors mobile #347 and keeps the optimistic-vs-
confirmed boundary honest: a create that the daemon never confirms simply does not navigate.

## Design

### Module structure

One new renderer module plus edits to two existing files (three production `.ts/.tsx` files total):

| File | Change |
|------|--------|
| `src/renderer/src/store/conversationCreatedBridge.ts` | **New.** The create/created feature bridge — twin of `conversationListBridge.ts`. Four exports (below). |
| `src/renderer/src/screens/channels/ChannelList.tsx` | Add `onNewConversation` to `ChannelListView` props; render the FAB as a sibling of `renderBody(...)`; the container supplies the handler. |
| `src/renderer/src/screens/channels/channels.css` | FAB styles (`.channel-list__fab`, `.channel-list__fab-icon`). |
| `src/renderer/src/PairedShell.tsx` | Call `useConversationCreatedNav(() => dispatch({ type: 'open' }))`. |

Plus test files (`conversationCreatedBridge.test.ts` new; `ChannelList.test.tsx`, `PairedShell.test.tsx`
extended) and the CSS above — none of which count toward the production-file gate.

### `conversationCreatedBridge.ts` — contracts

Mirrors `conversationListBridge.ts` member-for-member (pure filter → pure subscribe → React glue). All
functions are React-free except the hook; nothing touches keys, sockets, `ipcRenderer`, or raw frames.

```ts
// The FAB's command send — inline typed literal, no builder (the requestConversationList precedent).
// Sends { is_promoted:false, name:null, cwd:null }: an ad-hoc discussion, daemon-default name + cwd.
function requestNewConversation(sendCommand: (command: RendererCommand) => void): void

// The pure filter (mirrors translateConversationsEvent): the one owned arm → its payload, all else → null.
function translateConversationCreated(event: DaemonEvent): ConversationCreatedPayload | null

// Subscribe via the injected onDaemonEvent; each conversationCreated invokes onCreated; every other
// event no-ops. Returns the off handle (the subscribeConversations idiom). Never throws into React.
function subscribeConversationCreated(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  onCreated: (created: ConversationCreatedPayload) => void
): () => void

// React glue mounted in PairedShell (the useDaemonEventBridge idiom). Subscribes exactly once for the
// mounting component's lifetime and invokes onCreated on each conversationCreated. Derefs window.pyry
// only inside the effect (preserves PairedShell's server-renderability).
function useConversationCreatedNav(onCreated: (created: ConversationCreatedPayload) => void): void
```

Behavior notes (the developer writes the ~10-line bodies against the sibling module):

- `requestNewConversation` builds the command inline (`{ type: 'createConversation', payload: {…} }`)
  rather than adding a builder to `shared/ipc/commands.ts` — keeps the change renderer-contained, exactly
  as `requestConversationList` inlines `{ type: 'requestConversations' }`. **Do not touch `commands.ts`.**
- `subscribeConversationCreated` passes the decoded `ConversationCreatedPayload` to `onCreated` (faithful
  to `subscribeConversations(…, setConversations(list))`). The current nav consumer **ignores** the arg
  (navigation is conversation-agnostic — see State model); passing it leaves the created `id` available
  at the seam so the future select-and-load ticket changes only the consumer, not this bridge. This is
  the same forward-compatibility framing as the `Row`'s `onClick={onOpen}` interim.
- `useConversationCreatedNav` subscribes **once** (empty-dep effect, off-handle as cleanup — a StrictMode
  double-mount nets exactly one live listener, the `useDaemonEventBridge` guarantee). Because the caller
  passes a fresh inline arrow each render, hold the latest `onCreated` in a `useRef` and call
  `ref.current(created)` from the listener, so the subscription is established once and never re-subscribes
  on PairedShell's route-flip re-renders. Inside the effect it wires
  `subscribeConversationCreated(window.pyry.onDaemonEvent, (c) => ref.current(c))`.

### FAB in `ChannelList.tsx`

- `ChannelListView` gains one prop: `onNewConversation: () => void`. It renders the FAB as a **sibling of
  `renderBody(...)`** inside the `<section className="channel-list">`, so the FAB is present in all three
  list states — `null` (not-loaded), `[]` (empty), and populated (AC1). `renderBody`'s null/empty/populated
  logic is untouched.
- The FAB is a small local presentational element (an icon-only `<button type="button">` with the inline
  `add` SVG), mirroring `BackControl`: `aria-label="New discussion"` supplies the accessible name (a native
  `<button>` is keyboard-focusable — AC4), `onClick={onNewConversation}`. The Material `add` glyph path
  is `M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z` in a `viewBox="0 0 24 24" fill="currentColor" aria-hidden`.
- The container `ChannelList` supplies `onNewConversation={() => requestNewConversation(window.pyry.sendCommand)}`.
  The `window.pyry` deref is **inside the arrow** (invoked at click, never during render), so the
  server-render smoke stays untouched — the `Composer.handleSubmit` / `UnpairControl` discipline.

### FAB styles in `channels.css`

Contract, not full CSS (the developer fetches the Figma design context and owns the exact values):

- **Placement**: pinned bottom-right, floating over the list, inside `.channel-list` (no portal — the
  #177 "overlay absolute inside the screen container" precedent). `.channel-list` is itself the
  `overflow-y:auto` scroller, so an ordinary `position:absolute` child would scroll away with content;
  use **`position: sticky` (bottom + `align-self: flex-end`)** so the FAB pins to the bottom-right of the
  scrollport and stays visible as the list scrolls under it, without restructuring the DOM or the
  `.channel-list { height:100% }` assumption. Give it a `z-index` above the rows. Offsets from the corner
  use spacing tokens (`--space-4`/`--space-6`).
- **Fill / glyph**: container background `var(--color-primary-container)`; the `+` icon color
  `var(--color-on-primary-container)` (M3 primary-container FAB role — matches the screenshot's dark
  square + light glyph). Icon box 24px.
- **Radius**: Figma specifies 16px; the token scale jumps 12→20 with no 16px slot. Map to the nearest
  token **`--radius-md` (20px)** and document the +4px delta in a comment — the `pairing.css:55`
  ±token-mapping precedent. **Do not add a new radius token to the shared `tokens.css`** (no shared-
  foundation drift for a 4px delta; also avoids a cross-file edit).
- **Elevation**: Figma is M3 level-3 (`0 4px 8px 3px rgba(0,0,0,.15), 0 1px 3px 0 rgba(0,0,0,.3)`). No
  shadow token exists — the FAB is the first elevation consumer. Inline the two-layer `box-shadow` as a
  literal with a comment noting it is structural M3 elevation (not a scheme color, so consistent with the
  header's opacity/1px carve-outs). Defer extracting an `--elevation-*` token until a **second** consumer
  appears (evidence-based; one consumer is not a token).

### PairedShell wiring

`PairedShell` adds one line inside the container (before the `return`):
`useConversationCreatedNav(() => dispatch({ type: 'open' }))`. `dispatch` is the stable `useReducer`
dispatcher; the arrow ignores the payload and fires the existing `open` nav. The hook derefs `window.pyry`
only inside its effect, so `PairedShellView` and the server-render smoke are unchanged.

## State + concurrency model

- **No new store slice** (the ticket's explicit constraint). Navigation state stays in PairedShell's
  screen-local `useReducer` (ADR 0006). The FAB dispatches a command via the preload bridge; the nav is
  driven by the daemon-event subscription reaching `dispatch`.
- **Subscription lifecycle is shell-scoped, not app-lifetime.** Unlike `ConversationListData` (app-level,
  because the list must stay live across routes), `useConversationCreatedNav` is mounted in `PairedShell`,
  which mounts only on the paired `conversation` route. The subscription lives for the shell's lifetime:
  on unpair the shell unmounts → the effect cleanup calls the off handle → subscription torn down; on
  re-pair a fresh shell mounts a fresh subscription. This is the correct scope — navigation only matters
  while the shell is mounted.
- **Navigation is conversation-agnostic today.** `open` always lands on `'thread'`, and the thread renders
  the single active `ConversationScreen` (store-backed). The created conversation's `id` is *not* used to
  address a specific thread — the same interim as `Row`'s `onClick={onOpen}` (a select-and-load transport
  does not exist yet). The `id` is available at the `subscribeConversationCreated` seam for the future
  ticket that adds it.
- **Fire-and-forget command send.** `window.pyry.sendCommand` is `void` (no result to await) — the
  `requestConversationList` / composer-send precedent. There is no `AbortController` or teardown for the
  send itself; the only subscription with a lifecycle is the created-event listener, cleaned up via its
  off handle.

## Error handling

- **A create the daemon never confirms simply does not navigate.** No `conversationCreated` → no `open`
  dispatch → the user stays on the list. There is no optimistic navigation to roll back and no new
  failure surface in this ticket; a `daemon-error` correlated to a failed create is out of scope (no such
  correlation exists for creates, and none is requested).
- **Untrusted daemon strings are not rendered here.** `ConversationCreatedPayload.name` / `.cwd` are
  daemon-supplied and untrusted, but this ticket consumes the event **only as a nav trigger** — it renders
  neither field, so no `dangerouslySetInnerHTML`/escaping concern arises. (Flagging for the future
  select-and-load ticket that *will* render the created row: it must render them as plain auto-escaped
  React children, per the `events.ts` arm's inherited warning.)
- The subscription listener only dispatches; it never throws into React (the `subscribeConversations`
  invariant). A malformed/unrelated event is filtered to `null` by `translateConversationCreated` and
  no-ops.

## Testing strategy

`npm test` (vitest, **`node` environment — no jsdom**) + `npm run typecheck`. There is no DOM click
harness: activation and event→nav are proven by spy-driven unit tests over the pure helpers **composed
with** the already-tested reducer/view, exactly as `interactiveRoundtrip.test.tsx` and `PairedShell.test.tsx`
document. Scenarios (developer writes the bodies in the project idiom):

**`conversationCreatedBridge.test.ts` (new):**
- `requestNewConversation` called with a spy `sendCommand` → the spy receives exactly one call with
  `{ type: 'createConversation', payload: { is_promoted: false, name: null, cwd: null } }` (AC2 substance
  — the "dispatch on activation").
- `subscribeConversationCreated(fakeOnDaemonEvent, spyOnCreated)` with the `fakeBridge()` idiom: emitting
  a `conversationCreated` event calls `spyOnCreated` once (and, if asserting the seam, with the event's
  payload) (AC3, AC5 bullet 2).
- Emitting unrelated events (`messageReceived`, `conversationsReceived`, at least one other arm) does
  **not** call `spyOnCreated` (AC5 bullet 3 — "unrelated daemon events do not navigate").
- The returned handle is the off handle: invoking it calls the underlying unsubscribe (the
  `subscribeConversations` teardown precedent).

**`ChannelList.test.tsx` (extend):**
- The FAB renders with its accessible name (`aria-label="New discussion"`) in **all three** states —
  server-render `ChannelListView` with `conversations` = `null`, `[]`, and a populated list, asserting the
  FAB marker is present each time (AC1). Extend the existing `render(...)` helper to pass a
  `onNewConversation={noop}` prop.

**`PairedShell.test.tsx` (extend, optional but recommended):**
- Confirm the list→thread nav is closed by composition: `nextPairedRoute('list', { type: 'open' }) === 'thread'`
  is already covered in `pairedRoute.test.ts`, and `PairedShellView route="thread"` rendering the thread is
  already covered here — so the created-event → `open` link proven in the bridge test composes to the full
  nav. A one-line assertion or a comment cross-referencing the composition is sufficient; **do not** add a
  jsdom harness to click/await.

## Open questions

- **FAB radius (minor).** 16px Figma vs the 12→20 token gap — this spec picks `--radius-md` (20px) with a
  documented delta. The developer should eyeball the rendered FAB against the Figma screenshot and, if the
  +4px reads too round, fall back to `--radius-sm` (12px). Either is a token, not a literal; do not add a
  token.
- **Sticky vs fixed positioning.** `position: sticky` is recommended (keeps the FAB in the scroll column,
  no DOM restructure). If sticky proves fiddly against `.channel-list`'s flex column, `position: fixed`
  anchored to the window corner is an acceptable fallback — but verify it does not bleed over other routes
  (PairedShell only mounts on the paired route, so the risk is low). Confirm the FAB does not obscure the
  last row's content on a full list.
