# Hosted resource and HTTP frame validation

## Files read
- `src/shared/wire/types.ts` → `HostedPayloads`, `HostedControlEnvelope`: reuse resource vocabulary and directional union pattern.
- `src/main/transport/hostedBoundary.ts` → `decodeHostedEnvelope`, `hostedObject`, `hostedInteger`: raw-byte admission before projection.
- `src/main/transport/hostedCodec.ts` → identity predicates and control codec: canonical identities and unchanged cancel/error validation.
- `src/main/transport/codec.ts` → `encodeEnvelope`, `base64StdDecode`, wire errors: final serialization cap and canonical base64 helper.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage`: existing consumers remain unwired; generic parser is not a hosted admission boundary.
- `src/main/transport/hostedCodec.test.ts` → pinned examples and byte-level assertions: local fixtures, separate required/omitted keys.
- `docs/knowledge/features/wire-codec.md` and `development-verification.md`: main-only validation, exact absence semantics and test proof boundaries.
- `docs/knowledge/decisions/0002-remote-head-over-relay-shared-wire.md`: shared wire contract, no protocol drift.
- Daemon `3120-hosted-app-contract.md` at `964c5c4bab8e9267ee5e4c374d34a5bb1ebeb6f0` §§5–7, 10: normative resource/HTTP semantics and unchanged examples.
- Root `CLAUDE.md` and shared working practice: test-first, allowed files and publishing/check helpers.

## Context
Transport #1958 and viewer #1960 need callable resource validation before consuming bounded bytes. #1962 is merged and supplies the strict boundary. No ADR needed. No overlapping remote feature branches touch planned files.
Sizing: one per-frame validation deliverable, four observable criteria, approximately 650 total written lines; two production files, one exported type, zero consumer migrations, no state machine. Recounted against the plan: below all five limits.

## Design
- Add data-only `HostedResourceEnvelope`, a discriminated directional union over the five existing resource payloads.
- Add main-only `hostedResourceCodec.ts`: `decodeHostedResource(bytes, direction, originalRequest?): HostedResourceEnvelope` and `encodeHostedResource(envelope, direction, originalRequest?): Uint8Array`. Context is an asset/API request from the union, validated again before correspondence checks; it confers no pending ownership.
- Simpler shape considered: extend the control switch. Keep a separate resource module because HTTP/path/body semantics are independent; reuse the strict boundary and identity predicates rather than a second parser.
- Decode checks original bytes, exact required types/presence and envelope direction/correlation, then projects known resource fields. Additive fields are ignored and never gain authority. Encode retains additions in final byte accounting, validates the serialized bytes, and omits an explicitly empty optional query after validating its type.
- Paths: bounded ASCII escaped origin-relative paths, one decode for containment, invalid escapes/control/separators/percent/dot segments rejected; distinguish `/api/` from asset and reserved service/data/build-registry roots. Queries remain opaque and ordered, bounded ASCII with valid escapes and no fragment/control bytes.
- Headers: fixed lowercase request/response allowlists, exact string values, eight-entry/1024-value-byte/4096-serialized-byte ceilings, no controls. API methods follow the contract; GET/HEAD require empty bodies.
- Bodies/chunks: encoded length and canonical padded alphabet/pad bits checked before calling `base64StdDecode`; decoded size ≤32768, chunks nonempty. Return the canonical wire string, without response-sized allocation.
- Metadata: safe integers, lowercase digest, broad asset byte/count ceilings without context; supplied API context narrows to 1 MiB/32 and assets to 8 MiB/256 and permitted statuses. Zero body requires zero chunks/empty digest; nonzero body requires positive count. HEAD and 204/205/304 are bodyless. Chunk/credit indices use zero-based bounds, tightened by request kind when supplied.

## State + concurrency model
Pure synchronous functions; no retained state, async work, subscriptions, caches or allocations from declared response size. #1958 owns generation identity, pending operations, ordering, cumulative bytes, digest completion, credit progression and retirement. #1960 owns selected-view binding and resource assembly delivery.

## State transitions and identity reuse
None: no lifecycle or identity state is retained. `revalidates repeated frames and supplied request context` proves reused IDs are not cached. Pinned cancellation tests preserve separate resource/cancel correlations; they establish frame semantics only.

## Error handling
Existing `WireDecodeError`/`WireEncodeError`, static failure categories only. No content logging; classified lifecycle/error logging belongs to the eventual transport caller. No new I/O or IPC boundary.

## Testing strategy
- Write `hostedResourceCodec.test.ts` first, observe its failure, then implement.
- Local unchanged pinned asset/credit, API POST/204, cancellation-read and bridge-error examples; assert decoded values, binary bytes, required zero/false/empty and omitted optional fields on re-encode.
- Table-driven identity/path/query/header/method/byte/index/status failures and exact boundaries; raw invalid bytes, duplicate keys, forbidden metadata and wrong direction/correlation reuse the strict boundary.
- Spy on the base64 helper to prove invalid/noncanonical/oversized strings fail before decode. Measure maximum final request/chunk serialization including escaped additive fields on encode/decode.
- Repeat frames and reject supplied-context app/release/correlation/kind limits. No assembly, activation, SQL, UI or real-Claude claims.
- Focused resource/control/generic codec tests, final merge of main, pre-verify check and build.

## Open Questions
None. Asset filesystem handle containment remains daemon-owned; URL containment here creates no filesystem authority.

## Revisions
2026-10-15: Clarified query validation against §6's opaque query rule: reject raw controls/fragments and invalid escapes, retain encoded bytes without decoding (including non-UTF-8 encoded octets). Header types/allowlist/value bounds are checked before serializing the narrowed string map, so hostile nested header values cannot trigger a generic serialization exception. Invalid supplied context serialization is wrapped in a static decode category.

## Security review
**Verdict:** PASS
- Trust boundaries: raw bytes enter `decodeHostedEnvelope` before projection; resource output is narrowed, context revalidated, additions cannot route or authorize work.
- Tokens/secrets: no credentials created/stored/exposed; opaque bodies and headers are never logged or echoed in errors.
- File/storage: no file operations; URL containment rejects traversal/double encoding; actual asset handle containment stays daemon-owned.
- Electron surface: main-only executable code, data-only shared union; no IPC, window, navigation, renderer or capability changes. Viewer isolation belongs to #1960.
- Cryptography: canonical encoding only; no key/nonce/authentication changes or secret comparisons; complete-body digest verification belongs to #1958.
- Network/I/O: pre-parse 65519-byte cap, final serialized cap including additions, pre-decode base64 bounds and metadata/index limits prevent oversized allocations. No new socket/timeouts.
- Errors/logs: category-only errors; no logging of daemon paths, queries, headers, bodies or digest content. Existing caller remains responsible for structured failure logs.
- Concurrency: no mutable state or async tasks; ownership, ordering, cancellation and generation reuse explicitly remain #1958.
- Threat alignment: hostile frames fail closed; relay drop/reorder/flood and retirement belong to #1958; disk token theft retains safeStorage owner; compromised renderer confinement belongs to existing isolation and #1960.
**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-15
