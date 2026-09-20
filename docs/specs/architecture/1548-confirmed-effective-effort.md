# Confirmed effective effort on run-configuration replies

## Files read

- `src/shared/wire/types.ts` → `SessionSettingsPayload`: saved settings wire contract.
- `src/main/transport/inboundMessage.ts` → `parseSessionSettingsPayload`, `requireStringOrNull`, `parseInboundMessage`: validation, frame bound and content-free diagnostics.
- `src/main/transport/inboundMessage.test.ts` → `encodeSessionSettings`, `RUN_CONFIG`, `captureLog`: existing decode and diagnostic harness.
- `src/main/daemonConnection.ts` → `createDaemonConnection`, `onDriverEvent`, `requestSessionSettings`: named IPC projection and pending-request correlation.
- `src/main/daemonConnection.test.ts` → `build`, `stampedEvents`, session-settings tests: fake-driver attribution, reconnect and rejection coverage.
- `src/shared/ipc/events.ts` → `DaemonEvent`: typed `runConfigReceived` contract.
- `docs/knowledge/features/inbound-message-decode.md` → Security properties: narrow before logging; reject the complete malformed frame.
- `docs/knowledge/features/daemon-connection.md` and `daemon-connection-correlation.md` → Run-configuration read attribution correlation: request-owned conversation IDs, deletion on match, clearing on reconnect.
- `docs/knowledge/features/daemon-event-channel.md` → What it does: connection-owned `serverId` stamp beside the event union.
- `docs/knowledge/features/wire-codec.md` → Public surface: the inbound caller owns the plaintext size guard.
- `docs/knowledge/features/development-verification.md` → Source and contract checks / What each test tier proves: fallback when codegraph is unavailable; assert values independently of implementation.
- Upstream `internal/protocol/settings.go` → `SessionSettingsPayload`, `NullableString`; `internal/relay/v2session_settings.go` → `handleRequestSessionSettings`; `cmd/pyry/relay.go` → `EffectiveEffortFor` wiring: matching daemon contract from pyrycode#2517.

## Context and scope

The daemon now reports confirmed applied effort independently of the saved `effort` choice. Desktop currently discards that report. This ticket carries it to IPC; renderer snapshots, footer selection and remembered choices remain #1549. There is no visual change or Figma requirement.

One deliverable: the decoder-to-IPC optional nullable report. Estimate: about 280 written lines including this plan and tests, four production files, zero new exported types/components/stores, zero required consumer-call-site migrations, two acceptance criteria, and no new state machine (one optional-field validation branch). The #1020 analogue added 208 transport/type/test lines across these same four production files. No remote feature branch overlaps the six code/test files after fetching origin. Codegraph was unavailable; repository searches established the single decoder constructor and single production IPC projection.

## Design

Add `effective_effort?: string | null` to `SessionSettingsPayload` and `effectiveEffort?: string | null` to `DaemonEvent`'s `runConfigReceived` arm. Omission reads as `undefined` (unavailable/unsupported), explicit `null` means no effort parameter, and every string, including empty, unfamiliar, whitespace and markup-like text, survives verbatim. `effort` remains the saved choice.

`parseSessionSettingsPayload` checks absence before calling the existing `requireStringOrNull` helper. Keep named-field reconstruction and the original required-field checks. `onDriverEvent` copies the new field by name after the existing correlation gate. No allowlist, normalization, field-specific length cap, settings write, or renderer implementation is added. Contract comments distinguish saved intent from an untrusted applied report; report text must never become markup, attributes, URLs, paths, cache keys, logs or a control input.

## State and concurrency

No new store, async task, listener or cancellation path. `pendingConfigRequests` still determines `conversationId`, deletes a match once, and clears during `dial`. `bindServerOrigin` retains the connection-owned `serverId`; payload fields cannot override either identity. Missing/unmatched correlations, duplicates and stale replies remain dropped.

## Error handling

Malformed present values use `WireDecodeError` with a client-owned field name only. The entire frame fails before successful-decode logging or IPC delivery, and the connection catches it without surfacing content. `MAX_PLAINTEXT_BYTES` continues to reject oversized frames before JSON decode. Successful reports inherit the existing structured `inbound-decoded` log containing static type, length and hash only; no new log sink or error class is needed.

## Testing strategy

- Extend decoder tests for omission, null, normal/empty/unfamiliar strings, independence from saved effort, malformed JSON types, whole-frame oversize rejection and content-free success/failure diagnostics.
- Extend fake-driver mapping tests for the same states, no additional sends, no snake-case field leakage, and rejection without an event or content log followed by a valid correlated reply.
- Exercise the new field in existing missing/unmatched, duplicate and reconnect fixtures; distinguish values in out-of-order replies and assert raw `stampedEvents` for trusted server attribution.
- Run new focused assertions RED before implementation; then `npm test -- src/main/transport/inboundMessage.test.ts src/main/daemonConnection.test.ts` and `npm run build`. No Electron interaction or live-Claude check belongs to this transport-only ticket.

## Open questions

None. The upstream nullable report contract and existing frame-size limit resolve the field semantics.

## Documentation handoff

No documentation-only acceptance criterion or explicit path/section was requested. Pending for the documentation stage: document the optional nullable applied-effort contract in `docs/knowledge/features/inbound-message-decode.md` (new effective-effort subsection) and `docs/knowledge/features/daemon-event-channel.md` (new run-configuration report subsection), preserving the distinction from saved `effort` and linking #1549 for renderer ownership.

## Security review

**Verdict:** PASS

- **Trust boundaries:** `parseSessionSettingsPayload` is the single shape-validation boundary. Null and strings are reports, never trusted control values. Non-string/non-null present values fail the complete decode.
- **Tokens and credentials:** no credential generation, storage, rotation or revocation changes; the new report is never logged or persisted by this change.
- **Files and storage:** no file I/O or cache-key construction consumes the report. Existing secret storage stays untouched.
- **Electron attack surface:** only one optional field on an existing main-to-renderer event; no new IPC command, bridge capability, navigation, remote-content load or window preference change. Renderer text handling is explicitly owned by #1549.
- **Cryptography:** no key, nonce, randomness, handshake or primitive changes; decoding remains downstream of the existing Noise transport in main.
- **Network and I/O:** `parseInboundMessage` bounds all plaintext with `MAX_PLAINTEXT_BYTES` before decoding. No new socket, URL, TLS configuration, deadline or reconnect behavior.
- **Errors and logs:** `requireStringOrNull` names only the static field; the successful `session_settings` log uses length/hash, and failures precede it. Tests inject private-looking text into success and rejection paths.
- **Concurrency:** no awaits or new jobs; preserve correlation deletion, reconnect clearing, driver generation fencing and trusted origin stamping. Out-of-order and stale-reply tests carry the new field.
- **Threat alignment:** malformed/oversized hostile-daemon reports are rejected; reordered/duplicate reports cannot gain attribution without a pending request. Relay cryptography, disk-token protection and renderer isolation are unchanged. Display and remembered-choice handling are OUT OF SCOPE here and owned by #1549.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-20
