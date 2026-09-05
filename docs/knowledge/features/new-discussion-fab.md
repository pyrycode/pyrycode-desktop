# New-discussion FAB

The `+` floating action button on the [Channel List home screen](channel-list.md): a renderer-only
affordance that fires the [`createConversation` command](conversation-create.md) (fire-and-forget)
and, when the daemon confirms with a `conversationCreated` event, navigates the [paired
shell](paired-shell.md) from `list` to `thread` by reusing the existing `open` transition. Mirrors
mobile #347.

Introduced in [#242](../codebase/242.md), split from [#142](../codebase/142.md); the sibling
transport ticket [#241](../codebase/241.md) (the `createConversation` command / `conversationCreated`
event) shipped first and is consumed here unchanged. Renderer-only — no transport, IPC, store, or
wire code added, so not security-sensitive.

## What it does

- Renders a floating add (`+`) button pinned bottom-right of the Channel List, present in **all
  three** list states (not-loaded/empty/populated — it is a sibling of the list body, not
  conditional on it).
- On click, dispatches `createConversation` with `{ is_promoted: false, name: null, cwd }` — an
  ad-hoc discussion with a daemon-default name. `cwd` is the [default-workspace
  store](default-workspace-store.md)'s saved value if one is set, or `null` (daemon-default working
  directory) otherwise (#403). The send is fire-and-forget; there is no optimistic UI change.
- Navigation to the new thread happens **later and only if the daemon confirms**: when a
  `conversationCreated` `DaemonEvent` arrives, the paired shell fires its existing `open` nav
  transition. A create the daemon never confirms simply leaves the user on the list — there is no
  optimistic navigation to roll back.
- Navigation is conversation-agnostic today: `open` always shows the single active conversation
  (the same interim the Channel List's row `onClick={onOpen}` uses). The created conversation's
  `id` is not used to address a specific thread yet.

## How it works

One new module, twin of [`conversationListBridge.ts`](conversation-list-store.md#the-data-path-srcrenderersrcstoreconversationlistbridgets):

### The bridge (`src/renderer/src/store/conversationCreatedBridge.ts`)

```ts
requestNewConversation(sendCommand: (c: RendererCommand) => void, defaultCwd: string | null): void
// sendCommand({ type: 'createConversation', payload: { is_promoted: false, name: null, cwd: defaultCwd } })
// inline literal, no builder — the requestConversationList precedent
// defaultCwd widened in #403 (required, not defaulted) — see default-workspace-store.md

translateConversationCreated(event: DaemonEvent): ConversationCreatedPayload | null
// switch (event.type) { case 'conversationCreated': return event.conversation; default: return null }

subscribeConversationCreated(onDaemonEvent, onCreated): () => void
// onDaemonEvent(event => { const c = translateConversationCreated(event); if (c !== null) onCreated(c) })
// returns the off-handle

useConversationCreatedNav(onCreated: (created: ConversationCreatedPayload) => void): void
// React glue: subscribes once (empty-dep effect), holds the latest onCreated in a useRef so a
// fresh inline arrow each render never re-subscribes; window.pyry dereferenced only in the effect
```

`translateConversationCreated` uses a **soft** `default: null`, not `assertNever` — this path
permanently consumes only `conversationCreated` (the `translateConversationsEvent` posture, not the
hard-`assertNever` `daemonEventBridge`/`timelineBridge`/`modalBridge` shape). It returns
`event.conversation` directly (a filter, not a field remap), so a rename of the arm is still caught
by the `case` label failing to overlap the union.

The bridge passes the **decoded payload** through to `onCreated`, even though the current nav
consumer ignores it (navigation is conversation-agnostic) — the created `id` is available at this
seam for a future select-and-load ticket to change only the consumer, not the bridge.

### The FAB (`src/renderer/src/screens/channels/ChannelList.tsx`)

`ChannelListView` gained an `onNewConversation: () => void` prop and renders `NewConversationFab`
as a **sibling of `renderBody(...)`** — so it shows regardless of list state (not-loaded / empty /
populated). `NewConversationFab` is a small in-file presentational element, mirroring
`ConversationScreen.tsx`'s `BackControl` idiom: an icon-only `<button type="button"
aria-label="New discussion">` holding an inline `viewBox="0 0 24 24"` Material `add` glyph
(`aria-hidden`). A native `<button>` is keyboard-focusable; `aria-label` supplies the accessible
name since the glyph carries no text.

The container `ChannelList` supplies
`onNewConversation={() => requestNewConversation(window.pyry.sendCommand, defaultWorkspace)}`, where
`defaultWorkspace` is a reactive `useDefaultWorkspaceStore(selectDefaultWorkspace)` read (#403) —
the `window.pyry` deref sits inside the click arrow, never during render, so the
`renderToStaticMarkup` server-render smoke stays untouched (the `Composer.handleSubmit` /
`UnpairControl` discipline).

### The nav wiring (`src/renderer/src/PairedShell.tsx`)

One added line in the `PairedShell` container: `useConversationCreatedNav(() => dispatch({ type:
'open' }))`. `dispatch` is the stable `useReducer` dispatcher from [paired shell](paired-shell.md);
the arrow ignores the created payload and fires the existing `open` transition. The hook's own
effect is what dereferences `window.pyry`, so `PairedShell` itself stays free of effects/window
access at its own level (preserving its server-renderability).

The subscription is **shell-scoped, not app-lifetime** — unlike `ConversationListData`, which must
stay live across routes, `useConversationCreatedNav` is mounted only where `PairedShell` mounts
(the paired `conversation` route). On unpair the shell unmounts, the effect cleanup fires the
off-handle, and the subscription tears down; on re-pair a fresh shell mounts a fresh subscription.

### Data flow

```
FAB click → requestNewConversation(window.pyry.sendCommand, defaultWorkspace)
  → sendCommand({type:'createConversation', payload:{is_promoted:false,name:null,cwd:defaultWorkspace}})
  → [#241, already shipped] COMMAND_CHANNEL → createConversation(payload) → daemon

daemon → conversation_created frame → [#241] → conversationCreated DaemonEvent
  → DAEMON_EVENT_CHANNEL → useConversationCreatedNav's subscription
    → translateConversationCreated → payload (or null → skip)
    → dispatch({ type: 'open' })          [PairedShell's useReducer(nextPairedRoute, 'list')]
  → PairedShellView route flips 'list' → 'thread' → ConversationScreen renders
```

### CSS (`src/renderer/src/screens/channels/channels.css`)

`.channel-list` is itself the `overflow-y: auto` scroll column, so an ordinary `position: absolute`
child would scroll away with the rows. The FAB stays an in-flow flex item (no portal, no DOM
restructure) pinned bottom-right by two composed rules:

- `margin-top: auto` + `align-self: flex-end` push it to the bottom-right when content is short
  (not-loaded / empty / a few rows) — `position: sticky` alone only offsets during scroll overflow
  and leaves the FAB at its top-of-flow position in those states.
- `position: sticky; bottom: var(--space-6)` floats it over the rows and keeps it visible once the
  list overflows and scrolls.

Fill/glyph use the M3 primary-container FAB role tokens (`--color-primary-container` /
`--color-on-primary-container`). Two documented token-mapping deviations, both code-review-accepted:

- **Radius:** Figma specifies 16px; the token scale jumps 12→20 with no 16px slot, so it maps to
  `--radius-md` (20px), a +4px delta (the `pairing.css:55` ±token-mapping precedent). No new shared
  radius token added.
- **Elevation:** the FAB was the first elevation consumer in this codebase. The M3 level-3
  (base)/level-4 (hover) two-layer `box-shadow`s are inlined as structural literals rather than a
  new `--elevation-*` token — deferred until a second consumer appears (evidence-based). The second
  shadow consumer arrived on 2026-09-05 with a *different* value — the message area's single-layer
  `--shadow-thread` ([message bubble § The shadow](conversation-shell-message-bubble.md#the-shadow-the-2026-09-05-shadow-fix)),
  shared by four rules — so that one became a token, and the FAB's M3 pair, still single-consumer,
  stays a literal.

## Edge cases and limitations

- **A create the daemon never confirms simply does not navigate.** No correlation between the
  outbound command and the inbound event exists (or is needed) — see [Conversation create §
  Correlation is deliberately absent](conversation-create.md#correlation-is-deliberately-absent).
  There is no timeout, retry, or error surface in this ticket.
- **Navigation is conversation-agnostic.** `open` always shows the single active conversation; the
  created conversation's `id` is decoded and passed to the nav consumer but unused today. A future
  select-and-load ticket changes only `useConversationCreatedNav`'s call site, not the bridge.
- **Untrusted daemon strings are not rendered here.** `ConversationCreatedPayload.name`/`.cwd` pass
  through the bridge but this ticket consumes the event only as a nav trigger — neither field is
  rendered, so no escaping concern arises. Flagged forward for the future select-and-load ticket
  that will render them (must be plain auto-escaped React children, per the wire event's inherited
  warning).
- **The click→command wiring and the event→nav wiring are each unit-proven, not DOM-tested** — the
  codebase has no jsdom harness (`renderToStaticMarkup` only). `conversationCreatedBridge.test.ts`
  spy-drives the pure helpers; `ChannelList.test.tsx` asserts the FAB's accessible name renders in
  all three states; the full click→command→event→nav chain is proven by composing these tested
  units with the already-tested `nextPairedRoute` reducer, the `interactiveRoundtrip.test.tsx` /
  `PairedShell.test.tsx` precedent.

## Related

- [Conversation create (transport)](conversation-create.md) / [#241 codebase notes](../codebase/241.md)
  — the `createConversation` command and `conversationCreated` event this FAB consumes unchanged.
- [Paired shell](paired-shell.md) / [#140 codebase notes](../codebase/140.md) — the `list ⇄ thread`
  router; `useConversationCreatedNav` drives its `dispatch({ type: 'open' })`.
- [Channel List home screen](channel-list.md) / [#141 codebase notes](../codebase/141.md) — the
  screen the FAB renders on, as a sibling of `renderBody`.
- [Conversation list store](conversation-list-store.md) — the sibling bridge
  (`conversationListBridge.ts`) this ticket's `conversationCreatedBridge.ts` mirrors member-for-member.
- [Default-workspace store](default-workspace-store.md) / [#403 codebase notes](../codebase/403.md) —
  widened `requestNewConversation` with the `defaultCwd` parameter this FAB now supplies.
- [#242 codebase notes](../codebase/242.md) — implementation summary, patterns, lessons.
- Spec: `docs/specs/architecture/242-new-discussion-fab.md`.
