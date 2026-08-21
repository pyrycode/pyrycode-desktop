# Project Memory — Pyrycode Desktop

Human-maintained project conventions. Agents read this, they do not edit it. Per-ticket knowledge goes in `docs/knowledge/codebase/<N>.md`, written by the documentation phase.

## What the project is

An Electron desktop remote head for the pyry daemon running on pyrybox, reached over the content-blind relay. Functionally similar to `pyrycode-mobile`. Same server contract, different client. See the vault note `📋 Projects/2026-07-02 - Pyrycode Desktop` for the full design.

## Conventions

- Stack: Electron, React, TypeScript, Zustand, electron-vite.
- The transport lives in the Electron background process. The Noise handshake, the relay socket, the frame codec, and event parsing all live there. The renderer gets typed events over the internal channel.
- Wire types under `src/shared/wire/` mirror the mobile Kotlin models field-for-field. The Noise variant is `Noise_IK_25519_ChaChaPoly_BLAKE2s`. Do not drift these without a matching daemon change.
- Test-first. Unidirectional state. Sealed event shapes on a `type` discriminant.
- Build gate: `npm run build`. Test gate: `npm test`.

## Milestones

- First milestone, the connect-send-stream round-trip — pair through the relay, send a message, watch the structured reply stream back — proved live 2026-07-15.
- Feature parity with the mobile client reached 2026-07-14.
- First full 8/8 real-claude gate 2026-07-26.
- UI mirrors mobile first, diverges later.

## Design references

- Mobile Phase 5 remote-head design and ADR 025 in the `pyrycode` repo.
- The structured-event bridge mapping.
- Mobile wire models under `pyrycode-mobile` `app/src/main/java/de/pyryco/mobile/data/network/`.
