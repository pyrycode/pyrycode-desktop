# Request a conversation's context reading

## Context

Ticket #1503 adds one dormant outbound transport contract. The daemon supports
`request_context_usage` under the existing negotiated `interactive` capability;
opening a conversation will invoke it in #1504. No UI or capability negotiation
changes belong here. No ADR is needed.

## Files read

- `src/shared/wire/types.ts` — `EnvelopeType`, `RequestModelListPayload` and
  `ContextUsagePayload` establish the outbound vocabulary and existing reply.
- `src/shared/ipc/commands.ts` — `RendererCommand`, `isRendererCommand` and
  `isRequestModelListPayload` establish required-payload and structural-string checks.
- `src/main/transport/requestModelListEnvelope.ts` — `buildRequestModelList`
  establishes a pure builder with a fresh one-field payload.
- `src/main/daemonConnection.ts` — `DaemonConnection`, `createDaemonConnection`,
  `requestModelList` and `onDriverEvent` establish sending, shared ids and inbound delivery.
- `src/main/connectionRegistry.ts` — `viewOf` delegates every non-lifecycle method.
- `src/main/index.ts` — the `onCommand` callback routes requests by conversation.
- `src/main/conversationRouter.ts` — `createConversationRouter` refuses unknown ids
  and absent hosts without fallback; its existing diagnostics contain static codes only.
- `src/main/receiveCommand.ts` — `onCommand` validates untrusted renderer messages.
- `src/main/daemonConnection.test.ts` — `build`, `makeDriverFactory` and
  `reachConnected` provide fake-driver tests using the real codec.
- `src/main/connectionRegistry.test.ts` — `createFactoryFake` constructs the full
  `DaemonConnection` interface and must grow with it.
- `src/shared/ipc/commands.test.ts` — required-payload compile-time assertions.
- `src/main/transport/requestModelListEnvelope.test.ts` — actual byte round trips.
- `src/renderer/src/store/reportedContextBridge.ts` — `subscribeReportedContext`
  and `translateContextUsage` deliver readings under their payload conversation id.
- `src/renderer/src/store/reportedContextBridge.test.ts` — `fakeBridge` provides
  receive-path coverage without a DOM or React effects.
- `docs/knowledge/features/daemon-connection-methods.md`, “Public surface” —
  model-list precedent, no retries and the typed registry fake's build-only failure risk.
- `docs/knowledge/features/reported-context-store.md`, “How it works” — passive
  bridge, no reading clears on reconnect or errors, no content logging.
- `docs/knowledge/features/command-channel.md` — renderer boundary and fresh-literal
  minimisation are separate checks.
- `docs/knowledge/features/development-verification.md`, “Source and contract checks”
  and “What each test tier proves” — unavailable codegraph permits text search;
  unit tests do not replace the TypeScript build.
- Upstream `pyrycode/docs/protocol-mobile.md`, “Asking for a context usage reading
  on demand” — required `conversation_id`, correlated reply, optional `as_of`,
  `conversation.not_found` and retryable `context_usage.unavailable`.

## Design

Add `request_context_usage` to `EnvelopeType` and export
`RequestContextUsagePayload { conversation_id: string }`. Add the
`requestContextUsage` command with a required payload and a dedicated structural
guard matching `isRequestModelListPayload`: absent, undefined, null, missing-id
and non-string inputs fail; empty strings and extra fields pass this boundary.

Add main-only `buildRequestContextUsage(input: RequestContextUsageInput): Uint8Array`.
Its required inputs are `id`, `ts` and `conversationId`; it serializes a fresh
payload containing only `conversation_id` through `encodeEnvelope`.

Add `DaemonConnection.requestContextUsage(conversationId: string): void`, sharing
`nextEnvelopeId` and `now`. Advance the counter after successful encoding, before
the single send. Refuse a null driver or unauthenticated connection. Catch build
and send exceptions, logging only static lifecycle/error codes through
`diagnosticLog`. Never record identifiers, readings or caught error objects.

Add the `viewOf` delegate and a conversation-routed `onCommand` arm in `index.ts`.
Read the id once for both routing and sending. An unknown conversation, empty id
or missing host is refused by the existing router; no active-host fallback exists.

The inbound parser, event, bridge and store remain unchanged. A correlated reply
uses its payload's conversation id exactly as an unsolicited reading does.
Unknown `as_of` is tolerated by the existing named-field parser. Both daemon
errors retain generic handling and never create, clear or replace a reading.

## State + concurrency model

No new store, pending-request map, timer, promise or subscription. This method
performs one synchronous build/send using the connection's existing lifecycle.
No retry follows a missing reply, send failure or daemon error. No new teardown
is needed. The passive app-level receive subscription keeps its existing cleanup.

## Error handling

Malformed IPC is refused by `isRendererCommand`. Unroutable ids reuse the router's
static diagnostics. Unavailable connections log a static refusal. Encoding/send
failures log a static failure and return without throwing. The existing generic
daemon-error path continues to classify both rejection codes as unclassified;
the context bridge ignores those events.

## Testing strategy

- First run new unit assertions RED before editing production code.
- Guard tables cover every required invalid shape, empty strings and extra fields;
  `@ts-expect-error` assertions prove the payload and its string id are required.
- Builder tests decode real bytes and assert exact envelope fields and payload.
- Fake-driver tests prove one send, shared ids, unavailable lifecycle states,
  swallowed failures, static logs and no timers/retries after silence or errors.
- Compose the existing command boundary and conversation router with fake drivers
  to prove host selection, extra-field stripping and refusal without fallback.
  Review the matching composition-root arm because `index.ts` has no unit harness.
- Registry tests prove forwarding to the selected connection and update its full fake.
- Existing receive-path tests gain correlated/as-of cases at the driver/event seam;
  bridge/store tests prove per-conversation delivery and error preservation.
- Run Vitest only on touched test files, then `npm run build`. No Playwright or
  live-Claude proof is required for this dormant, non-UI transport contract.

## Sizing and overlap

One deliverable; approximately 500 total written lines, 6 production files,
2 new exported interfaces, 3 consumer locations to update (registry delegate,
full typed factory fake and composition-root dispatch), 4 acceptance criteria,
2 new local refusal/failure branches, and no new state machine. The six-file
overage uses the sizing floor: declarations have only this send path as their
consumer and cannot ship as an independently verifiable sibling. The measured
#1165 analogue added 666 lines including its plan. All other ceilings hold.

Codegraph reported an uninitialized index; text search covered `src/` and `e2e/`.
After fetching remote branches, no other numeric `origin/feature/*` branch
overlapped the planned production or test files.

## Open questions

None. `as_of` presentation and the on-open trigger are explicitly outside this slice.

## Documentation handoff

Pending for the documentation stage, as required by the ticket:

> The documentation stage records the request direction, correlated reply, both error codes and no-retry policy in `docs/knowledge/features/daemon-connection-methods.md`. Update `docs/knowledge/features/reported-context-store.md` to distinguish the passive receive bridge from this outbound capability and #1504's later trigger.

Target sections: “Public surface” in `daemon-connection-methods.md`; “How it works”
and “The bridge” in `reported-context-store.md`.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — `isRendererCommand` validates the required
  string before routing. Empty strings are structurally valid but cannot be learned
  by `createConversationRouter`. A fresh payload discards every extra renderer field.
- [Tokens] No findings — this adds no credential, token generation or storage;
  pairing and authentication remain in the existing main-process connection.
- [File/storage] No findings — ids are only routing keys and JSON values. No file,
  URL, persistence or renderer storage operation is introduced.
- [Electron attack surface] No findings — one narrow command on the existing
  validated bridge; no raw bytes, sockets or keys reach the renderer. Window,
  navigation and protocol-handler security settings are unchanged.
- [Cryptography] No findings — bytes use the existing Noise driver, with no new
  key, nonce, primitive or handshake path.
- [Network/I/O] No findings — `encodeEnvelope` retains its size bound and the
  existing driver owns socket limits and liveness. No new URL or TLS configuration.
  A withheld reply retains no request state and schedules no work.
- [Errors/logs] No findings — static sent/refused/failed diagnostics only; never
  log the conversation id, returned context data or caught exception. Generic
  daemon-error handling remains unchanged and produces no context reading.
- [Concurrency] No findings — one synchronous send, no await gap, timer, pending
  map or new listener. Existing stop/disconnect handling makes the method inert.
- [Threat model] No findings — a compromised renderer cannot select a host through
  an extra field; the router resolves the owner. A relay dropping replies induces
  no retry. Hostile reply content remains behind the existing bounded parser and
  named-field projection. Existing credential storage remains outside this change.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-19
