# Switch-agent outbound request

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`: process boundaries and reading map.
- `docs/knowledge/features/development-verification.md`: encoded bytes and browser transport proof.
- `docs/knowledge/features/command-channel.md`: untrusted commands use a runtime guard.
- `docs/knowledge/features/daemon-connection.md`, `daemon-connection-registry.md`, `new-session-envelope.md`: authenticated lifecycle, restricted connection views and named routing.
- `src/shared/wire/types.ts` → `EnvelopeType`, `WireAgent`: daemon vocabulary and payload contracts.
- `src/shared/ipc/commands.ts` → `RendererCommand`, `isRendererCommand`: command admission.
- `src/main/transport/newSessionEnvelope.ts` → `buildNewSession`; `codec.ts` → `encodeEnvelope`: fresh payload, injected ID/time, byte bound.
- `src/main/daemonConnection.ts` → `createDaemonConnection`, `authenticated`, `newSession`: send ownership and failure containment.
- `src/main/connectionRegistry.ts` → `viewOf`; `conversationRouter.ts` → `route`: owning-host view and fail-closed lookup.
- `src/main/index.ts` → `onCommand` receiver: command dispatch and Electron isolation.
- `src/main/daemonConnection.test.ts`, `connectionRegistry.test.ts`: injected driver and full-interface fake.
- `e2e/conversation-mute-command.spec.ts`, `fixtures/launchPairedApp.ts`: preload-to-wire proof with two fake hosts.
- Daemon `docs/protocol-mobile.md` → `switch_agent`: required string fields, empty defaults, optional effort and refusal contract.

## Context

Expose one outbound request for the later model-menu sender. Daemon prerequisites and #1761 / PR #1810 are merged. Success already follows the existing reset/transition/update path; refusal correlation belongs to #1660 and the menu/confirmation to #1661. No visible change or ADR is needed.

Sizing: one deliverable, four observable acceptance criteria, six production files plus one new builder, two exported interfaces, three production wiring consumers, two local reject/failure branches. Forecast approximately 450–550 added lines including plan and tests, below every sizing limit. Remote feature/1544 overlaps inbound/settings correlation in `daemonConnection.ts`; feature/1804 overlaps `HelloClientPayload` in `types.ts`. Both diffs are independent of this additive outbound path.

## Design

Add `SwitchAgentPayload` with required `conversation_id: string`, `agent: WireAgent`, `model: string`, optional `effort: string`, and add `switch_agent` to `EnvelopeType`. The discriminated command is `{ type: 'switchAgent'; payload: SwitchAgentPayload }`.

`isRendererCommand` admits only a non-array object payload, a nonempty string conversation ID, exactly `claude` or `codex`, string model, and absent/undefined/string effort. Extra fields are tolerated at admission and discarded at serialization. Vocabulary, UUID validity and same-agent refusal remain daemon responsibilities.

`buildSwitchAgent(input: SwitchAgentInput): Uint8Array` accepts injected `id`, `ts` and the payload, and builds a fresh literal containing only the four wire fields. Empty model and explicit empty effort remain present; undefined effort is omitted. Strings are never normalized.

`DaemonConnection.switchAgent(payload): void` requires a driver and `authenticated`, builds with the existing clock and envelope counter, advances the counter after encoding, and sends once. `viewOf` forwards the payload unchanged. The main receiver routes by `payload.conversation_id` and invokes only that view, with no host fallback.

## State + concurrency model

No store, renderer state, pending map, async task, listener or timer is added. The availability check, encoding, counter increment and send are synchronous in the connection closure. Existing driver generation fencing, authenticated resets, stop and reconnect own lifecycle. No retries or replay on reconnect.

## Error handling

Unknown/unavailable owners return through the existing router refusal. Unauthenticated connections drop the request. Encoding (including over-limit plaintext) and send exceptions are caught and discarded. Static diagnostics record `switch-agent-refused/unavailable`, `switch-agent-sent`, or `switch-agent-failed/build-or-send-failed`; no payload, ID or caught error is logged. No new IPC result or UI error is introduced; correlated daemon refusals remain #1660.

## Testing strategy

- Builder: real encoded bytes, exact envelope/payload keys, both agents, verbatim model/effort, empty model, absent/undefined/empty effort, and extra-key stripping.
- Guard: valid variants and rejection of nonobjects/arrays, missing or mistyped required fields, empty ID, unsupported agent and non-string/null effort.
- Connection: no driver, pre-handshake, relay-down, terminal/error and stopped states send nothing; connected sends once, shares ID/time, catches oversize encoding and throwing send with no retries. Diagnostics contain static codes only.
- Registry: its full-interface fake records switch payloads; named-owner view forwards unchanged and leaves the other host untouched.
- Fake Playwright: use `launchPairedApp` with two hosts, send through `window.pyry.sendCommand`, inspect decoded frames on each owner for both agents and effort/default variants, inject an extra field, and prove an unknown ID is inert using a subsequent valid command as a processing barrier. No UI trigger or live spec.
- After final main merge: pre-verify, build and this focused fake spec. Dispatcher owns the full browser tier.

## Open Questions

None. The design follows the existing request-context-usage availability/logging shape and the new-session envelope convention.

## Security review

**Verdict:** PASS

- [Trust boundaries] No findings: `isRendererCommand` validates the untrusted IPC payload; `buildSwitchAgent` copies only named fields. `route` uses main-owned Map state and never trusts a renderer host hint.
- [Tokens, secrets, credentials] No findings: the command has only conversation/settings strings; existing main-only safeStorage/key ownership is unchanged and no credentials enter this payload.
- [File and storage operations] No findings: the new path has no file/storage writes or path interpretation. Conversation ID is only a routing Map lookup and wire field.
- [Electron attack surface] No findings: reuse the validated command channel; no raw socket API or channel is added. Existing context isolation, sandbox and navigation/window-open guards remain. Transport bytes stay in main. String lengths are bounded by the existing plaintext encoder, with failures contained before send.
- [Cryptographic primitives] No findings: reuse the Noise driver and existing codec; no key, nonce, cipher or handshake changes.
- [Network and I/O] No findings: authenticated owner only, one bounded plaintext frame, no retries, new endpoints, TLS policy or pinning changes. Existing relay deadlines and backoff remain responsible for liveness.
- [Errors, logs, telemetry] No findings: only static event/code diagnostics through the capped shared logger; model, effort, conversation IDs, payloads, tokens, keys and caught exceptions never enter logs or telemetry.
- [Concurrency] No findings: synchronous availability/build/send with no await gap, task or pending request; existing stop and generation fencing prevent stale-driver work. Drop requests rather than queue them.
- [Threat model alignment] No findings: compromised renderer can request only the validated daemon action, never select another host or reach keys/raw sockets. Malicious relay sees existing Noise ciphertext and cannot cause request retries. Disk token protection and hostile inbound parsing remain existing owners; refusal handling is explicitly #1660, confirmation #1661.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-06
