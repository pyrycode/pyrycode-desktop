# Conversation shell

The renderer's first screen: a scrollable message thread above a bottom-pinned composer, styled from the mobile **Conversation Thread** screen (Figma node `16-8`) stretched to the desktop window. It is the surface later tickets bind real state into.

Introduced in [#1](../codebase/1.md); the thread was bound to the live [session store](session-store.md) in [#69](../codebase/69.md). Everything lives under `src/renderer/` — nothing here touches keys, sockets, the Noise handshake, or the preload bridge.

## What it does

Renders the conversation thread and composer for a session: a thread region that fills the window height and scrolls independently, and a composer (text input + send button) pinned to the bottom edge. The thread now renders the **live** message list from the [session store](session-store.md) — streamed daemon replies appear as they arrive ([#69](../codebase/69.md)). The composer is now **wired**: typing a message and submitting it (send button or Enter) sends it and shows it in the thread immediately as an optimistic echo ([#66](../codebase/66.md) — see [Composer send](composer-send.md)).

The app bar, status row, tool-call chips, code blocks, session delimiters, and the mic icon shown in the Figma node are **deliberately out of scope** — they render conversation/connection/model state that lands in later slices. This screen builds the message thread and composer only.

## How it works

### Structure

`App.tsx` renders `<ConversationScreen />`. The screen is a flex column:

```
ConversationScreen            .conversation        (flex column, full height)
├── MessageThread             .conversation__thread (scroll region)
│   └── MessageBubble × N     .message-row / .bubble
└── Composer                  .composer            (pinned)
```

`MessageBubble` and `Composer` are **in-file functions** inside `ConversationScreen.tsx` — they are tiny. `MessageThread` is also in-file but **exported** ([#69](../codebase/69.md)), so tests server-render it as a pure view. `ConversationScreen` is the store-bound container; `MessageThread` is the props-in/markup-out view — the same container/view split `PairingScreen`/`PairingView` uses ([#55](../codebase/55.md)). The load-bearing contracts are the props/types, not the file boundaries (see Seams).

### Data shape

The thread's view model is a discriminated union on `type`, following the project's sealed-event convention and forward-compatible with the richer kinds later slices add. It lives in `messageViewModel.ts` (relocated from the deleted `placeholderMessages.ts` in [#69](../codebase/69.md)):

```ts
export type Message =
  | { id: string; type: 'user'; text: string }
  | { id: string; type: 'daemon'; text: string }
```

The **data source is the [session store](session-store.md)**, which holds wire `MessagePayload` verbatim (ADR 0004). `ConversationScreen` reads the messages slice and adapts each payload at the store-read boundary:

```ts
const messages = useSessionStore(selectMessages).map(toMessageViewModel)
```

`toMessageViewModel` (in `messageViewModel.ts`) is a pure, exhaustive `switch (m.role)`: `role: 'user' → type: 'user'`, `role: 'assistant' → type: 'daemon'`, `message_id → id`, `text` carried through, `conversation_id` dropped; an `assertNever` default makes a future third `WireRole` a compile error. Selecting only the `messages` slice keeps connection-status changes from re-rendering the thread. Each bubble carries `data-message-role={message.type}` — the test hook the structural render test asserts against.

### Layout contract

Independent scroll rests on three rules; get these right and AC1/AC5 follow:

- `index.css` — `html, body, #root { height: 100% }` establishes the full-height chain; `body { margin: 0 }`.
- `.conversation__thread` — `flex: 1 1 auto; min-height: 0; overflow-y: auto`. The **`min-height: 0`** is load-bearing: without it a flex item refuses to shrink below its content, so the whole window scrolls instead of the thread region.
- `.composer` — `flex: 0 0 auto`: pinned, never grows or shrinks.

Bubbles use `max-width: min(680px, 75%)` (not a fixed width) so they reflow as the window resizes — the desktop divergence from the mock's fixed `330px`. Bubble corners are asymmetric via `border-radius` (order **TL TR BR BL**): the user bubble clips its bottom-right, the daemon bubble its bottom-left.

### Theme

Every style references a token from `theme/tokens.css` — no color/type/spacing literal in `conversation.css`. Bare structural geometry (`100%`, flex ratios, the `48px` send button, the bubble measure) stays literal; those are layout, not theme. See [ADR 0003](../decisions/0003-m3-theme-tokens-css-custom-properties.md).

## Seams (bound + still open)

- **`MessageThread({ messages })`** — **bound in [#69](../codebase/69.md).** `ConversationScreen` now feeds this prop from `useSessionStore(selectMessages).map(toMessageViewModel)` instead of the deleted `placeholderMessages` array, adapting wire `MessagePayload` (`role`, `message_id`) to the `Message` view model (`type`, `id`) at the store-read boundary. `MessageThread` stays the pure `Message[]`-in view — the seam's shape held exactly as the swap target.
- **`Composer`** — **bound in [#66](../codebase/66.md).** Now a thin controlled container: `useState` input, an `onChange`/`onKeyDown` on the `<textarea>`, and an `onClick` on the send button, all delegating to the pure `submitMessage` in `composerSend.ts` (submit mints a `message_id`, emits a `sendMessage` command, and appends an optimistic echo to the store). The submit logic lives in its own `.ts` file (the pairing container/pure-logic split); `Composer` itself stayed in-file. Auto-grow was not built (cosmetic, no AC). See [Composer send](composer-send.md).

## Edge cases and limitations

- An **empty `messages` array** renders a valid empty scroll region — no crash, no placeholder fallback. The store returns `[]` on initial state, so a just-connected session with no replies yet renders a clean empty thread.
- The send button is **wired** ([#66](../codebase/66.md)): a click (or Enter) sends the composed message and appends an optimistic echo. A whitespace-only input does nothing; a send-bridge failure is swallowed (no crash). See [Composer send](composer-send.md).
- **Dark scheme only**; no responsive layout beyond flex reflow; no desktop-native layout (the plan defers that until the app is fully functioning).
- No DOM interactivity is tested yet — the render test uses `renderToStaticMarkup`, not a DOM harness. Because zustand v5's `useStore` reads `getInitialState()` (not `getState()`) for its server snapshot, a *server*-rendered store-bound container always shows the store's **initial** state; #69 therefore proves ordering + role→type on the pure `MessageThread` view and smoke-tests the container against the empty store. Observing a *populated* container render needs a jsdom harness — still deferred. See [#69 codebase notes](../codebase/69.md).

## Related

- [Session store](session-store.md) — the live state the thread now renders; the `MessageThread`/status seams bind to it (#2, bound in #69)
- [Composer send](composer-send.md) — the composer's now-wired submit + optimistic echo (#66); the send half of this screen
- [ADR 0004 — renderer session store / wire types](../decisions/0004-renderer-session-store-reducer-wire-types.md) — the `role→'daemon'` / `message_id→id` adapter seam deferred to this screen
- [ADR 0003 — M3 theme tokens](../decisions/0003-m3-theme-tokens-css-custom-properties.md)
- [ADR 0001 — Stack](../decisions/0001-stack-electron-react-typescript.md), [ADR 0002 — Remote head over relay](../decisions/0002-remote-head-over-relay-shared-wire.md)
- [#1 codebase notes](../codebase/1.md) · [#69 codebase notes](../codebase/69.md) · Spec: `docs/specs/architecture/1-app-shell-and-theme-tokens.md`
