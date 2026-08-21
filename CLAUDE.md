# Pyrycode Desktop — Project Instructions

Electron desktop remote head for [Pyrycode](https://github.com/pyrycode/pyrycode). TypeScript + React. A sibling to `pyrycode-mobile`, sharing the same server contract.

## Status

The first milestone is done. The app pairs with the pyry daemon through the content-blind relay, sends messages, and streams structured replies back, and its author now uses it as his day-to-day client rather than driving it as a test.

**The desktop-specific layout is no longer deferred. It is designed and being built**, and it replaces the mobile design stretched to the window size that the app has worn until now. The shape is a fixed 400 pixel sidebar holding two trees, channels above and chats below, grouped under a host and then by workspace, beside a chat pane that fills the rest of the window. The minimum window width is 800. The input footer carries the actions menu, the permission mode, the model, the effort level, the context reading and the attachment button.

Build against that layout, not against the mobile one. The Figma is [node 102-4](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=102-4) and every slice of it is a ticket on board #7.

## What this is

The mobile app is the only client that reaches the daemon from another machine, over the relay. This app is the desktop equivalent. It drives the pyry daemon running on pyrybox, over the internet, with a window instead of a terminal. The local desktop path is `pyry acp` plus a forked Claudian and is out of scope here.

There is no UI code shared with mobile. Mobile is Android-native Kotlin. This is a full re-implement of the client half in TypeScript. The reuse is the wire format, not code.

## Stack

- Electron, scaffolded with electron-vite.
- React + TypeScript in the window.
- Zustand for the event-stream state. Mobile hoists one state object per screen with a sealed event set. Zustand maps onto that directly.
- The transport lives in the Electron background process, never the React window. The Noise handshake, the relay socket, the frame encode and decode, and event parsing all live there. The window receives already-typed events over the internal channel and renders them. Keys and raw bytes never reach the web layer.
- A Noise_IK library in JavaScript for the handshake.

## Wire protocol

The daemon speaks `Noise_IK_25519_ChaChaPoly_BLAKE2s`. This exact variant is load-bearing. A mismatch fails the handshake silently. The ported wire types live in `src/shared/wire/`. They mirror the mobile Kotlin models field-for-field. Do not drift them without a matching daemon change. See `docs/knowledge/decisions/0002`.

## Build and test

```bash
npm install
npm run dev          # run the app with fast reload
npm run build        # typecheck, then build main + preload + renderer
npm run typecheck    # type-check both the background and window sides
npm test             # unit tests (vitest)
```

`npm run build` is the salvage gate and part of the QA gate.

## Layout

```
src/
├── main/           # Electron background process: window, and later the transport
│   └── index.ts
├── preload/        # the bridge between the background process and the window
│   └── index.ts
├── renderer/       # the React window
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       └── index.css
└── shared/         # code used by both sides
    └── wire/       # ported wire types + the Noise variant constant
```

The transport, the Noise session, the relay connection supervisor, and the wire codec belong under `src/main/`. The screens, the state stores, and the event rendering belong under `src/renderer/`. Shared types belong under `src/shared/`.

## Conventions

- **Test-first.** A failing test first, implementation after.
- **Unidirectional state.** A store holds state, the window reads it and dispatches events. No two-way binding from a component into the store.
- **Sealed event shapes.** Model incoming daemon events and outgoing user actions as discriminated unions on a `type` field.
- **Keep the transport out of the window.** Anything touching keys, sockets, or the Noise handshake lives in the background process.
- **No direct push to `main`.** PR plus review.
- **The wire types match mobile.** Change them only alongside a daemon or mobile change.
- **Daemon text may be rendered, escaped and length-bounded.** It is not forbidden content, and the tool rows already show it on purpose. What it may never reach is a raw-markup sink or a log. So no `innerHTML` and no `dangerouslySetInnerHTML`, never into an attribute or a URL, and never as a filename, a cache key or a lookup path. The rule that a string must be a client-owned constant is scoped to chrome that speaks in the app's own voice, such as notification copy, not to text the daemon is reporting. Operator ruling, 2026-08-20.

## Driving a running session

Some things are changed by sending an ordinary message rather than by a command on the wire, because claude intercepts a message whose text begins with a slash and runs it instead of passing it to the model. Measured against claude 2.1.220 on 2026-08-21: an unknown one comes back as a synthetic assistant reply reading "Unknown command", at zero turns and zero cost.

- **Model and effort** reach a running session as `/model <family>` or `/effort <level>`. A family alias resolves to the newest model in that family, and claude announces the resolved dated identifier on its next turn. That announcement is the only way to confirm what is actually running, so show it rather than the requested value.
- **Reset and compact** are `/clear` and `/compact`.
- **The available commands are workspace-dependent**, so a command that exists in one working directory may not exist in another. Do not assume a slash command is present.

None of this needs a new command type or a wire change.

## Don't

- Don't put crypto, sockets, or tokens in the renderer.
- Don't drift the wire types from the mobile contract.
- Don't refactor adjacent code while you are there. Touch only what the task needs.
- Don't add dependencies without justification.
