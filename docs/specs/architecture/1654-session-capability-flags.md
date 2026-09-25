# Session capability flags on run-configuration replies

## Files read

- `src/shared/wire/types.ts` → `SessionSettingsPayload`: the reply's wire contract; `effective_effort` is the optional-field precedent (#1548).
- `src/main/transport/inboundMessage.ts` → `parseSessionSettingsPayload`, `isRecord`, `requireBoolean`, `WireDecodeError`: the single validation boundary and its category-only error messages.
- `src/main/transport/inboundMessage.test.ts` → `encodeSessionSettings`, `RUN_CONFIG`, `captureLog`, the `session_settings recognition` / `fail-closed` describes: decode harness to extend.
- `src/main/daemonConnection.ts` → `createDaemonConnection`, the `session-settings` arm of `onDriverEvent`: named-field copy onto `runConfigReceived` after the correlation gate.
- `src/main/daemonConnection.test.ts` → the `requestSessionSettings (run-config request/reply, #491)` describe, `requested`, `stampedEvents`, `sessionSettingsPlaintext`: fake-driver mapping harness to extend.
- `src/shared/ipc/events.ts` → `DaemonEvent`'s `runConfigReceived` arm: the IPC contract that gains the three flags.
- `src/renderer/src/screens/conversation/runConfigSnapshot.ts` → `toRunConfigSnapshot`: the only renderer mapper; it copies named fields, so new optional event fields do not reach the renderer until #1655.
- `docs/specs/architecture/1548-confirmed-effective-effort.md` and commit for #1548: the analogue shape (optional field, present-malformed rejects the frame, named copy).
- Upstream pyrycode `internal/protocol/settings.go` → `SessionSettingsPayload.Capabilities` (`*SessionCapabilities`, `omitempty`) and `SessionCapabilities` (`slash_commands`, `mcp_servers`, `context_usage_detail` booleans, no `omitempty`, #2670).

## Context

pyrycode#2646 added an optional `capabilities` object to `session_settings`; pyrycode#2670 added three booleans to it saying whether the session answers slash-command, MCP-status and context-breakdown requests. The desktop drops the object twice: the decoder returns named fields only and the IPC emit copies named fields only. This ticket carries the three flags to the `runConfigReceived` event; #1655 reads them. No visual change, so no Figma. No ADR warranted.

Overlap: `origin/feature/1544` edits other blocks of `src/main/daemonConnection.ts` and its test file (config-request invalidation). Not a dependency; edits here stay additive in the `session-settings` arm.

## Design

**Wire (`types.ts`).** New exported `SessionCapabilitiesPayload { slash_commands?: boolean; mcp_servers?: boolean; context_usage_detail?: boolean }` and `capabilities?: SessionCapabilitiesPayload` on `SessionSettingsPayload`. Upstream always writes the flags on a present object, but a #2646-only daemon predates them, so each is optional here. The other six upstream keys are deliberately not modelled.

**Decoder (`inboundMessage.ts`).** In `parseSessionSettingsPayload`: `capabilities` absent → `undefined`; present → a new private `parseSessionCapabilities(value: unknown)`:
- not a record (null, array, string, number, boolean) → `WireDecodeError('malformed session_settings capabilities')`;
- each flag absent → `undefined`; present → `requireBoolean` (non-boolean rejects with `missing required field: <flag>`);
- returns a fresh literal of the three flags only; other keys are ignored.

**IPC (`events.ts`, `daemonConnection.ts`).** The `runConfigReceived` arm gains flat optional `slashCommands?: boolean`, `mcpServers?: boolean`, `contextUsageDetail?: boolean`, documented as the daemon's statement of support: `undefined` = not reported (distinct from `false`), never a permission. The emit copies each by name from `inbound.sessionSettings.capabilities?.<flag>`, following the `effectiveEffort` precedent. Flat rather than nested, so there is no "object present but empty" state for a consumer to interpret and no nested object that could later be spread.

## State + concurrency

None new. Same correlation gate (`pendingConfigRequests`), same `serverId` stamp, no async work.

## Error handling

A present malformed `capabilities` or flag throws `WireDecodeError` with a static message naming only the client-owned key; the frame is dropped whole before the `inbound-decoded` log, as for `effective_effort`. The correlation entry is not consumed, so a later valid reply to the same request still lands.

## Testing strategy

Vitest only; no interaction, no e2e.
- Decoder (`inboundMessage.test.ts`): Claude reply (all true), Codex reply (all false), no `capabilities`, empty object / one flag missing (that flag `undefined`, others kept), extra keys (`interrupt`, `models`, `evil`) not copied; rejections for `capabilities` of `null`, `true`, `0`, `'x'`, `[]`, and each flag as `'true'`, `1`, `null`, `{}` — no log lines on rejection.
- Emit (`daemonConnection.test.ts`): same all-true / all-false / absent / partial cases map to the camelCase flags with no snake `capabilities` key and the rest of the event unchanged; malformed cases emit nothing, log nothing and leave the correlation for a following valid reply.

## Open questions

None.

## Documentation handoff

No documentation acceptance criterion in the ticket. Pending for the documentation stage: describe the three optional capability flags in `docs/knowledge/features/inbound-message-decode.md` (session_settings decode) and `docs/knowledge/features/daemon-event-channel.md` (`runConfigReceived` run-configuration report), including absent ≠ false and that the other capability keys are not decoded.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — `parseSessionSettingsPayload` / `parseSessionCapabilities` is the single boundary; downstream holds `boolean | undefined` only. Present-but-wrong-type values reject the whole frame rather than being coerced, so a hostile daemon cannot produce a flag value other than a real boolean. Unknown keys inside `capabilities` are never copied (fresh literal), and the emit is a named copy, so no daemon-supplied key reaches IPC.
- [Tokens] No findings — no credential is created, stored or logged.
- [Files and storage] No findings — the flags are never used as a path, key or filename, and nothing is persisted.
- [Electron attack surface] No findings — three optional booleans on an existing main→renderer event; no new channel, bridge capability, window or navigation change. Booleans carry no text, so no markup/URL sink risk.
- [Cryptography] No findings — decode is downstream of the unchanged Noise transport.
- [Network & I/O] No findings — `parseInboundMessage` still enforces `MAX_PLAINTEXT_BYTES` before JSON decode; a large `capabilities` object (e.g. a huge `models` list) is bounded by that cap and its unmodelled keys are not walked.
- [Errors and logs] No findings — error messages interpolate only client-owned key names; rejection precedes the content-free `inbound-decoded` log. Tests assert no log lines on rejection.
- [Concurrency] No findings — synchronous decode; correlation deletion happens only after a successful decode, so a malformed reply cannot consume a pending request.
- [Threat alignment] Hostile daemon: malformed capability data rejects the frame. Flags are advisory display inputs only (upstream: "support is not permission"; the daemon re-checks every request), so a lying `true` can at worst show a control the daemon then refuses. How the renderer treats absent vs false is OUT OF SCOPE here, owned by #1655.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-25
