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

## Revisions

2026-10-06: Typechecking the new event identified four exhaustive renderer translators:
`translateDaemonEvent`, `translateModalEvent`, `translateQuestionEvent` and
`translateTimelineEvent`. Each must return null for `switchAgentRejected`; the menu
consumer remains the follow-up ticket's responsibility. Add a regression assertion
beside each translator's tests. These four call sites and about 30 additional written
lines keep the total within the size limits. No UI state or visible behavior is added.

The full unit gate also identified exact decoder-shape assertions in
`src/main/transport/fakeDaemon.test.ts`. Preserve their content-exclusion checks
while explicitly expecting each fixture's boolean retryability. The attachment
outcome classifiers and their consumers remain unchanged.

2026-10-06 (verifier rework): Finding 1 requires current `origin/main` ancestry;
the dispatcher's main merge is retained, and final gates run after fetching and
merging again. Finding 2 exposes a send that reports a synchronous connection
failure but returns normally. `switchAgent` captures its driver and generation
before sending and registers only if authentication remains live, that driver
is still current and the generation is unchanged afterward. Otherwise it records
only `switch-agent-failed` / `connection-lost` and leaves no pending entry.
No new state, retry or exported contract is added. Five regression cases exercise
error, relay loss, terminal close, reconnect and stop during send, assert that
later refusals cannot settle the failed switch, and verify a fresh recovered send
still rejects normally. The total remains below 400 written lines, with no new
exported declarations or consumer migrations; #1544 still overlaps separate
run-config logic and requires no dependency wait.

## Documentation handoff

- Pending for the documentation stage: update `docs/knowledge/features/switch-agent-request.md`
  § Owning connection and failures and `docs/knowledge/features/daemon-connection-correlation-requests.md`
  § Switch-agent rejection correlation (new) with the pending envelope-to-conversation
  map, exactly-once rejection, conversation-update cleanup and connection/session
  lifetime, including the post-send authentication and generation guard.
- Pending for the documentation stage: document `switchAgentRejected`'s conversation
  attribution, boolean retryability/default and exclusion of daemon message text in
  `docs/knowledge/features/daemon-event-channel.md` § What it does, plus boolean-only
  retryability preservation in `docs/knowledge/features/inbound-message-decode.md`
  § Error handling.
- Pending for the documentation stage: record the four renderer translators'
  explicit no-op handling in `docs/knowledge/features/switch-agent-request.md`
  § Owning connection and failures; menu rollback/notification belongs to the
  follow-up consumer ticket.
