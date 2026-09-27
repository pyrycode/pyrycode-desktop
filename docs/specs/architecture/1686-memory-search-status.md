# Daemon memory-search status carriage (#1686)

## Files read

- `src/shared/wire/types.ts` → `SessionSettingsPayload`, `SessionCapabilitiesPayload`: optional report contract beside existing settings.
- `src/main/transport/inboundMessage.ts` → `parseSessionSettingsPayload`: untrusted payload boundary and named-field reconstruction.
- `src/shared/ipc/events.ts` → `runConfigReceived`: typed renderer event contract.
- `src/main/daemonConnection.ts` → `createDaemonConnection`: pending-request correlation and named event projection.
- `src/main/transport/inboundMessage.test.ts` → `encodeSessionSettings`: decoder fixture pattern.
- `src/main/daemonConnection.test.ts` → `requested`, `stampedEvents`: correlated transport-to-renderer proof.
- `docs/knowledge/features/inbound-message-decode.md` § Optional session capability flags: optional report precedent.
- `docs/knowledge/features/daemon-event-channel.md` § Run-configuration report: attribution and host stamp.
- `docs/knowledge/features/development-verification.md` § Source and contract checks: text search is required when codegraph is unavailable.
- `pyrycode/internal/protocol/testdata/session_settings_memory_*.json` and `session_settings.json`: daemon-owned example envelopes for four report states and older omission.

## Design source

N/A — this ticket carries data through the existing event; #1687 owns renderer state and presentation.

## Context

The daemon reports memory-search availability per resolved session. Desktop must carry that reading without inferring local installations or treating an empty provider array as absence. The report is descriptive and does not grant a memory-management capability.

## Design

Add `MemorySearchPayload` with a closed four-value availability union and provider records (`id`, `display_name`, `installed`, `enabled`, `availability`) to `SessionSettingsPayload`. Add optional `memorySearch` to `runConfigReceived`, retaining wire spelling inside the decoded payload and IPC spelling on the event. `parseSessionSettingsPayload` passes omitted `memory_search` as undefined. For a present report, a single `parseMemorySearchReport` validates the complete aggregate and every provider field, returning a fresh named-field object. Any incomplete, mistyped, or future availability value returns `{ availability: 'unknown', providers: [] }` for the entire report; it never discards valid required settings or promotes partial provider data to a confirmed reading. An explicit daemon `unknown` remains a valid report. The mapper copies the parsed report by name and keeps the existing pending-request gate unchanged.

## State + concurrency model

No new store or async task. `createDaemonConnection` continues to consume a pending `in_reply_to` before emitting one `runConfigReceived`; unmatched, duplicate, or invalidated replies emit nothing. Conversation identity comes from that pending request and the host stamp from the connection. Out-of-order replies retain their own request identities.

## Error handling

Malformed required session settings retain existing `WireDecodeError` behavior. Malformed optional `memory_search` affects only that reading, as unknown. Unknown report data is neither logged nor used as a path, URL, command, permission, or cache key. Existing content-free inbound diagnostic logging stays unchanged.

## Testing strategy

- Decoder tests copy the five daemon golden fixture envelopes verbatim from `internal/protocol/testdata/` and assert all four report states plus omitted field. They cover missing/mistyped fields, malformed providers, and future aggregate/provider availability values, while checking other settings remain intact.
- Connection tests feed the same fixture payloads with test-supplied `in_reply_to` through the real codec and fake driver; assert exact report projection, false and empty preservation, request conversation and host stamp, out-of-order replies, and no event for unmatched or abandoned replies.
- Run the two touched Vitest files and `npm run build`. No UI interaction is added.

## Documentation handoff

Pending documentation stage: update `docs/knowledge/features/inbound-message-decode.md` under session-settings decoding and `docs/knowledge/features/daemon-event-channel.md` under “Run-configuration report” with the optional report shape, unknown/omitted behavior, and correlated event carriage.

## Open questions

None. A malformed present report deliberately becomes a whole-report unknown rather than a partial provider list.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] `parseSessionSettingsPayload` remains the single untrusted daemon-payload boundary; `parseMemorySearchReport` accepts `unknown` and reconstructs named fields. Incomplete data cannot claim available or absent.
- [Tokens, storage, crypto] No token generation, credential read, storage, key, or cryptographic operation changes. The report is descriptive data only.
- [File and Electron surface] No file operation, new IPC channel, renderer command, navigation, or remote content is added. `runConfigReceived` carries only the narrowed report through the existing event bridge.
- [Network and I/O] Existing bounded decrypted-frame decode and relay lifecycle are unchanged; this parser adds only a bounded-by-frame traversal of providers.
- [Logs and telemetry] The report and provider names never enter logs or errors. Existing decode diagnostics contain static event code, frame length, and hash only.
- [Concurrency] `createDaemonConnection` retains its pending-request map and connection invalidation. No new timer, listener, or asynchronous job is introduced.
- [Threat alignment] A hostile daemon can send a malformed or future report; it yields unknown, while other valid settings remain readable. A relay can delay or reorder replies but cannot cause conversation or host misattribution past the existing correlation gate.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-28
