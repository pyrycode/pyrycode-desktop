# Switch-agent rejection delivery

## Files read

- `CLAUDE.md` and `docs/knowledge/INDEX.md`: main-only transport, typed IPC and test boundaries.
- `docs/knowledge/features/daemon-connection.md`, `daemon-connection-correlation.md`, and `daemon-connection-correlation-requests.md`: per-request correlation and disconnect lifetimes.
- `docs/knowledge/features/switch-agent-request.md`: `switchAgent` sends once; no automatic retry or renderer trigger in this slice.
- `docs/knowledge/features/development-verification.md`: decoder assertions must continue checking exact content-free shapes.
- `src/main/daemonConnection.ts`: `switchAgent`, `onDriverEvent`, `emitFailed`, `dial` and `stop` own request lifetime and event delivery.
- `src/main/daemonConnection.test.ts`: `reachConnected`, the fake driver and switch tests exercise real encoded frames and IPC output.
- `src/main/transport/inboundMessage.ts` and its test: `InboundMessage` and `parseInboundMessage` currently discard wire retryability.
- `src/shared/ipc/events.ts`: `DaemonEvent` supplies the renderer event contract.
- `src/main/emitDaemonEvent.ts`: existing origin stamping applies to the new union arm.

## Context

A daemon refusal answers the sent switch envelope but currently cannot undo a menu's pending pick. This ticket supplies one transport event for that future consumer; it changes no UI or wire types. No ADR is needed.

The sketch and written plan both fit one deliverable: about 300 total written lines, no new exported declarations, no consumer signature migrations, two acceptance behaviors and fewer than ten rejection branches. The estimate's production count needs the small decoder extension below. In-flight #1544 overlaps daemon connection files in separate config-read logic; these edits remain local and additive.

## Design

- Extend the `daemon-error` arm of `InboundMessage` with optional boolean `retryable`. Preserve boolean values only; absent/mistyped flags remain undefined. Error payload text stays discarded and the existing code classifiers keep their behavior.
- Extend `DaemonEvent` with `{ type: 'switchAgentRejected'; conversationId: string; retryable: boolean }`. Existing origin stamping and IPC delivery apply unchanged.
- Keep a `Map<number, string>` in each connection: successfully sent switch envelope ID to the client-supplied conversation. Register after a successful synchronous send, before diagnostics.
- On a correlated error, delete its entry before emitting a fresh literal with the mapped conversation and `retryable ?? false`. Log only a static server-rejected category and return, preserving unrelated modal and bundle consumers.
- On any decoded `conversation_updated`, remove all pending switches for its conversation without gating the existing update event. Other conversations remain pending.

## State + concurrency model

The connection closure owns the map; all mutations are synchronous with no awaits. Refusals consume one entry so duplicate errors cannot emit another switch rejection. Clear the map on relay loss, connection failure, explicit dial/reconnect and stop. A recovered session cannot inherit a pending switch from the old session. There are no timers, retries, streams or new renderer state.

## Error handling

Existing unavailable/build/send failures stay contained and produce no pending entry. An absent or unknown correlation ID emits no switch rejection and follows existing unrelated-error handling. Malformed retryability defaults to false for the new event; malformed payloads do not disable existing error consumers. Authentication/update-required failures retain precedence and clear pending switches through connection failure handling. IDs, settings, error codes and error messages never enter the new diagnostic record.

## Testing strategy

Use the existing fake driver with real encoded envelopes and a captured IPC sink:

- Retryable and non-retryable refusals emit the exact event once, with client-owned conversation attribution and no daemon text; diagnostics contain only static fields.
- Missing/unknown correlation IDs emit nothing; unrelated errors do not consume the pending switch.
- A conversation update clears all switches for that conversation and preserves another conversation's pending request.
- Relay loss, terminal/error failure, reconnect and stop discard old pending switches; a fresh send can still reject after recovery.
- A throwing send registers nothing.
- Decoder tests preserve both booleans, leave absent/mistyped flags undefined and retain exact text-free shapes for existing error classifiers.

Run focused unit tests red before implementation, then green. After the final merge of main, run dependency installation, the pre-verify check (including full units) and `npm run build`. No UI interaction or live specs are added, so no targeted Playwright/live run is required.

## Open Questions

None.
