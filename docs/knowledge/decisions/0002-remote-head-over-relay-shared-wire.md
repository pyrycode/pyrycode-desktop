# 0002 — Remote head over the relay, reusing the mobile wire contract

## Status

Accepted, 2026-07-02.

## Context

Two desktop paths to the daemon exist. One is local, on the same machine, served by `pyry acp` feeding a forked Claudian. The other is remote, from a different machine over the internet, served today only by the mobile app through the relay. This project is the remote path with a desktop window.

## Decision

Pyrycode Desktop connects to the pyry daemon on pyrybox through the live content-blind relay, using the same encrypted wire protocol as the mobile app. It does not use the local stdio path that Claudian uses.

## Rationale

- The hard half is already built and proven for the phone. The relay is live, the Noise handshake works, and the structured stream, the permission model, the message queue, and the reconnect-and-replay path all shipped and ran on real claude.
- The daemon does not care whether the far-end client is Kotlin on Android or TypeScript on a desktop. So this is a fresh client against a stable, tested server contract.

## The contract

- Noise handshake variant: `Noise_IK_25519_ChaChaPoly_BLAKE2s`. This exact variant is load-bearing. A mismatch fails the handshake silently.
- The ported wire types live in `src/shared/wire/`. They mirror the mobile Kotlin models field-for-field: the inner frame, the envelope, the client and server hello, the message and message-chunk payloads, the send-message and backfill payloads, the error payload, and the QR pairing payload.
- The source of truth is the mobile network layer under `pyrycode-mobile` `app/src/main/java/de/pyryco/mobile/data/network/`.

## Consequences

- The wire types must not drift from the mobile contract without a matching daemon or mobile change.
- The security model mirrors mobile: answering a permission prompt from the desktop is off by default and opt-in per device.
- The first thing to prove is a bare connect-and-echo round-trip through the relay, before any UI, so the handshake variant and the frame codec are grounded, not guessed.
