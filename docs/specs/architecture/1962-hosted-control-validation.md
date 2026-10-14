# Hosted discovery and control validation

## Files read
- `src/shared/wire/types.ts` → `Envelope`, `EnvelopeType`, hello and error payloads: reuse the existing vocabulary and carriers.
- `src/main/transport/codec.ts` → `encodeEnvelope`, `decodeEnvelope`, `WireDecodeError`, `WireEncodeError`: preserve generic callers; hosted validation must precede key projection.
- `src/main/transport/helloExchange.ts` → `parseHelloAck`: negotiation examples use existing facilities, without activating support.
- `src/main/transport/codec.test.ts` → codec tests: mirror byte-level test style.
- `docs/knowledge/features/wire-codec.md` → explicit null/omission and direct EnvelopeType assignments are separate obligations.
- `docs/knowledge/features/development-verification.md` → source/contract checks: assert values and serialized presence independently.
- `docs/knowledge/decisions/0002-remote-head-over-relay-shared-wire.md` → shared wire contract.
- Pinned daemon `docs/specs/architecture/3120-hosted-app-contract.md` at `964c5c4bab8e9267ee5e4c374d34a5bb1ebeb6f0`, sections 1, 4–7, 9–10: normative tables/examples.

## Context
Readiness consumers need callable main-process discovery/control validation rather than opaque JSON. This slice neither advertises capability nor wires dispatch. No ADR needed. No overlapping in-flight branches found for planned files.
Sizing: one contract-validation deliverable, four observable criteria, approximately 700 written lines including tests/plan; three production files, three exported data types, zero consumer migrations, no state machine. Recounted before commit: below all limits.

## Design
- Add eleven literal names to `EnvelopeType`; add `HostedAppRecord`, `HostedPayloads` (direction-documented payload map) and `HostedControlEnvelope` (discriminated union reusing Envelope and ErrorPayload). Resource declarations are data only, with required zero/false/empty fields.
- `hostedBoundary.ts`: `decodeHostedEnvelope(bytes, direction): Envelope` checks the 65519-byte cap, fatal UTF-8, one JSON object and duplicate keys at all depths, then exact known envelope fields, safe identities, UTC RFC3339 calendar timestamps, forbidden metadata, directions and reply presence. Payload remains opaque beyond requiring an object. Unknown additive keys confer no authority.
- Simpler shape considered: use JSON.parse for grammar, then a bounded iterative token scan for duplicate decoded names rather than maintaining another recursive JSON grammar. Scan nested arrays/objects too, including unknown additions.
- `hostedCodec.ts`: `decodeHostedControl(bytes, direction): HostedControlEnvelope` projects only validated discovery/control fields, rejecting resource messages. `encodeHostedControl(envelope, direction): Uint8Array` validates the final serialized bytes through the same boundary, preserving unknown additions in outbound size accounting. Serialization failures become static WireEncodeError categories.
- Export reusable `isHostedAppId` and `isHostedReleaseVersion` predicates for discovery consumers; no identity-to-path conversion.
- Validate required nullable records, title byte/control/whitespace bounds, enums, running active release, safe revisions, strictly sorted unique pages (max 16), snapshot revision consistency, nullable next cursor, bounded nonempty ASCII cursors, cancellation scope and original ID, and bridge error code/retryability/message/retry delay. Other known ErrorPayload fields are forbidden.

## State + concurrency model
Pure synchronous functions; no stores, subscriptions, async tasks, caches or new connection state. Pending ownership, cursor authenticity/expiry, host reconciliation and lifetime uniqueness belong to consumers (#1959 and later viewer/resource work).

## State transitions and identity reuse
None: validation retains no lifecycle state. Tests repeat the same frame/IDs to prove no accidental uniqueness cache. Cancellation tests distinguish target request ID from cancel ID/reply correlation; matching owned work remains consumer-owned.

## Error handling
Use existing WireDecodeError/WireEncodeError with static categories only. No logs or content interpolation; the eventual transport caller owns logging classified lifecycle/errors. No I/O or IPC boundary is added.

## Testing strategy
- Write focused `hostedCodec.test.ts` first and observe failure before implementation.
- Keep unchanged relevant shared example objects local with the source revision; negotiate using existing codec/hello facilities. Preserve resource requests as context, explicitly reject them as control frames.
- Assert decoded values and serialized required/null/omitted fields, all eleven names assigned directly to EnvelopeType, plus resource empty/false/zero data shapes.
- Table-driven malformed/forbidden fields, nested/escaped duplicate keys, invalid UTF-8/trailing values, calendar timestamps, IDs, revisions, title/cursor/page bounds, direction/correlation, unknown additive keys and final escaped serialization cap.
- Run focused tests, existing codec/hello tests, final merged-main pre-verify check and build. No UI, Playwright or live-Claude requirement.

## Open Questions
None. Message text can be bounded/validated as data, but provenance as producer-owned static copy cannot be established by this stateless parser.

## Security review
**Verdict:** PASS
- Trust boundaries: MUST FIX addressed by raw-byte duplicate/forbidden-key checks before any generic decoder drops fields; resource semantics never claimed by the control result.
- Tokens/secrets: no credential handling; unknown fields dropped on validated decode and never logged.
- File/storage operations: no filesystem or storage operations; identities remain data, never paths.
- Electron surface: executable code stays in main; no IPC/window/navigation changes or renderer capability activation.
- Cryptography: no primitive, key, nonce, authentication or secret comparison changes; Noise remains the authenticated connection boundary.
- Network/I/O: MUST FIX addressed by pre-parse and final serialization byte ceilings; iterative scanning avoids recursive parser stack exhaustion. No new socket or deadline owner.
- Errors/logs: static category errors only; no logging of daemon content, titles, cursors or error text.
- Concurrency: no retained state or async work; connection-generation ownership belongs to later consumers, not inferred by frame validation.
- Threat alignment: hostile daemon frames fail closed; relay flooding/connection loss, disk credential theft and renderer compromise retain existing transport/isolation owners. Resource routing/assembly remains successor #1963 and viewer #1927; discovery reconciliation remains #1959.
**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-14
