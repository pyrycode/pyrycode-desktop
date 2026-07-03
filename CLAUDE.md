# Pyrycode Desktop — Project Instructions

Electron desktop remote head for [Pyrycode](https://github.com/pyrycode/pyrycode). TypeScript + React. A sibling to `pyrycode-mobile`, sharing the same server contract.

## Status

Skeleton only. The goal of the first milestone is a full round-trip: pair with the pyry daemon on pyrybox through the content-blind relay, send a message, and watch the structured reply stream back. For now the UI is the mobile design stretched to the window size, built against the same mobile Figma file. A desktop-specific layout is deferred until the app is fully functioning.

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

## Don't

- Don't put crypto, sockets, or tokens in the renderer.
- Don't drift the wire types from the mobile contract.
- Don't refactor adjacent code while you are there. Touch only what the task needs.
- Don't add dependencies without justification.
