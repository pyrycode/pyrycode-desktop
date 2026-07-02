# 0001 — Stack: Electron, React, TypeScript, transport in the background process

## Status

Accepted, 2026-07-02.

## Context

We are building a desktop client that is functionally similar to `pyrycode-mobile`, a remote head for the pyry daemon reached over the content-blind relay. We need a desktop UI framework, a language, a state model, and a clean split between the network layer and the screens.

## Decision

- Electron, scaffolded with electron-vite.
- React and TypeScript in the window.
- Zustand for the event-stream state.
- The transport, meaning the Noise handshake, the relay socket, the frame codec, and event parsing, lives in the Electron background process. The renderer receives already-typed events over the internal channel and renders them.

## Rationale

- The mobile app is a declarative tree of components driven by state. React is the same shape, so mirroring the mobile design maps almost one-to-one, and the mobile state model maps onto a React store.
- The dispatcher's agents write most of the code, and React is the framework they generate most reliably.
- The richest ecosystem for the build tooling, the socket layer, and the Noise handshake libraries is here.
- Keeping the transport in the background process keeps keys and raw bytes out of the web layer and mirrors the mobile split between the network layer and the screens.

## Alternatives considered

- Tauri: smaller binaries, but a Rust surface for marginal benefit on a personal desktop tool, and less reliable agent code generation.
- Svelte or Solid: lighter, but less reliable agent code generation and a smaller ecosystem.

## Consequences

- There is no UI code to reuse from mobile. This is a full re-implement of the client half in TypeScript.
- The wire format is the reuse. See 0002.
- The Noise handshake in JavaScript is the one genuinely new piece and the first risk to retire.
