# Knowledge Base Index

One-line summaries of the evergreen docs. The documentation phase appends here.

## Decisions

- [0001](decisions/0001-stack-electron-react-typescript.md) — Stack choice: Electron, React, TypeScript, Zustand, transport in the background process.
- [0002](decisions/0002-remote-head-over-relay-shared-wire.md) — Remote head over the relay, reusing the mobile wire contract.
- [0003](decisions/0003-m3-theme-tokens-css-custom-properties.md) — M3 theme values as CSS custom properties in a single `tokens.css` (dark-only, `system-ui` fallback).
- [0004](decisions/0004-renderer-session-store-reducer-wire-types.md) — Renderer session state: one Zustand store, a pure exported reducer, sealed action union, wire types reused verbatim.

## Features

- [Conversation shell](features/conversation-shell.md) — the renderer's first screen: a scrollable message thread above a bottom-pinned composer, mirrored from the mobile Conversation Thread design (static, inert; #1).
- [Session store](features/session-store.md) — the renderer's single source of truth for the active session's connection status + conversation messages, mutated through a sealed action union; the state seam #3 dispatches into and #12 reads (#2).
- [Daemon-event channel](features/daemon-event-channel.md) — the typed background→window event pipe: a sealed `DaemonEvent` union in `src/shared/ipc/`, the single `emitDaemonEvent` send path, and a receive-only `onDaemonEvent` subscription on `window.pyry` (#18).
- [Command channel](features/command-channel.md) — the mirror-image window→background command pipe: a sealed `RendererCommand` union + pure `sendMessageCommand` + `isRendererCommand` boundary guard in `src/shared/ipc/`, a typed `sendCommand` on `window.pyry`, and an `onCommand` receiver seam that validates each command at the untrusted renderer→main boundary (#17).
- [Daemon-event bridge (renderer)](features/daemon-event-bridge.md) — the renderer translation half: pure `translateDaemonEvent` maps each `DaemonEvent` to a `SessionAction`, and the `useDaemonEventBridge` hook pipes `onDaemonEvent → translate → dispatch` into the app-singleton store, unsubscribing cleanly on teardown (#19).
- [Relay connection](features/relay-connection.md) — the background-process connection primitive: `createRelayConnection` opens one `wss://` socket with caller-supplied headers, a 30s/30s heartbeat, a 1 MiB frame cap, carrying raw frames both ways as opaque bytes and funnelling every failure into one terminal `closed` event; semantics-blind, log-free, no reconnect (that's #22). Adds `ws`, the project's first network dependency (#21).

## Architecture

_None yet._
