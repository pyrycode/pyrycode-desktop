# Conversation shell

The renderer's first screen: a scrollable message thread above a bottom-pinned composer, styled from the mobile **Conversation Thread** screen (Figma node `16-8`) stretched to the desktop window. It is the surface later tickets bind real state into.

Introduced in [#1](../codebase/1.md). Everything lives under `src/renderer/` — nothing here touches keys, sockets, the Noise handshake, or the preload bridge.

## What it does

Renders a usable visual shell for a conversation before any network or state is wired in: a thread region that fills the window height and scrolls independently, and a composer (text input + send button) pinned to the bottom edge. Data is static placeholder content; the send control is inert.

The app bar, status row, tool-call chips, code blocks, session delimiters, and the mic icon shown in the Figma node are **deliberately out of scope** — they render conversation/connection/model state that lands in #2 and #12. This ticket builds the message thread and composer only.

## How it works

### Structure

`App.tsx` renders `<ConversationScreen />`. The screen is a flex column:

```
ConversationScreen            .conversation        (flex column, full height)
├── MessageThread             .conversation__thread (scroll region)
│   └── MessageBubble × N     .message-row / .bubble
└── Composer                  .composer            (pinned)
```

`MessageThread`, `MessageBubble`, and `Composer` are **in-file functions** inside `ConversationScreen.tsx` — they are tiny and static for now. The load-bearing contracts are the props/types, not the file boundaries (see Seams).

### Data shape

`placeholderMessages.ts` exports the sole data source — a discriminated union on `type`, following the project's sealed-event convention and forward-compatible with the richer kinds #12 will add:

```ts
export type Message =
  | { id: string; type: 'user'; text: string }
  | { id: string; type: 'daemon'; text: string }

export const placeholderMessages: Message[]   // 8 items, alternating roles
```

Each bubble carries `data-message-role={message.type}` — the test hook the structural render test asserts against.

### Layout contract

Independent scroll rests on three rules; get these right and AC1/AC5 follow:

- `index.css` — `html, body, #root { height: 100% }` establishes the full-height chain; `body { margin: 0 }`.
- `.conversation__thread` — `flex: 1 1 auto; min-height: 0; overflow-y: auto`. The **`min-height: 0`** is load-bearing: without it a flex item refuses to shrink below its content, so the whole window scrolls instead of the thread region.
- `.composer` — `flex: 0 0 auto`: pinned, never grows or shrinks.

Bubbles use `max-width: min(680px, 75%)` (not a fixed width) so they reflow as the window resizes — the desktop divergence from the mock's fixed `330px`. Bubble corners are asymmetric via `border-radius` (order **TL TR BR BL**): the user bubble clips its bottom-right, the daemon bubble its bottom-left.

### Theme

Every style references a token from `theme/tokens.css` — no color/type/spacing literal in `conversation.css`. Bare structural geometry (`100%`, flex ratios, the `48px` send button, the bubble measure) stays literal; those are layout, not theme. See [ADR 0003](../decisions/0003-m3-theme-tokens-css-custom-properties.md).

## Seams (what later tickets bind to)

- **`MessageThread({ messages })`** — #12 swaps the `placeholderMessages` prop for a narrow store selector fed by streamed replies. Keep the array the sole data source so the swap stays one line.
- **`Composer`** — inert this ticket (uncontrolled `<textarea>`, no `onChange`; button with no `onClick`). #2 wires controlled input state, auto-grow, and a send dispatch, and extracts it to its own file.

## Edge cases and limitations

- An **empty `messages` array** renders a valid empty scroll region — no crash, no placeholder-of-placeholder.
- The send button is **inert**: no store, no network, no handler. Clicking it does nothing by design.
- **Dark scheme only**; no responsive layout beyond flex reflow; no desktop-native layout (the plan defers that until the app is fully functioning).
- No DOM interactivity is tested yet — the render test uses `renderToStaticMarkup`, not a DOM harness. See [#1 codebase notes](../codebase/1.md).

## Related

- [ADR 0003 — M3 theme tokens](../decisions/0003-m3-theme-tokens-css-custom-properties.md)
- [ADR 0001 — Stack](../decisions/0001-stack-electron-react-typescript.md), [ADR 0002 — Remote head over relay](../decisions/0002-remote-head-over-relay-shared-wire.md)
- [#1 codebase notes](../codebase/1.md) · Spec: `docs/specs/architecture/1-app-shell-and-theme-tokens.md`
