# Direct-child demand and session cache

## Files read
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/thread-runtime.md` → on-demand bodies: retain all-lease retirement and failed-admission protections.
- `docs/knowledge/features/development-verification.md`, `docs/recorded-tests.md`, `docs/client-replay-migration.md` → counted synthetic integration and configured replay boundaries.
- Core `docs/protocol-mobile.md`, “Bounded expansion reads” → installed summary, cursor, marker and aggregate-byte contract.
- `src/shared/wire/thread.ts`, `src/shared/ipc/commands.ts` → `ThreadQuery`, `ThreadReply`, `isRendererCommand`: additive expansion contract and untrusted command validation.
- `src/main/daemonConnection.ts`, `src/main/transport/inboundMessage.ts`, `src/main/transport/threadUpdates.ts` → `queryThread`, `parseInboundPayload`, `createThreadUpdateReceiver`: capability gate, correlation, validation and delivery.
- `src/renderer/src/store/threadBodies.ts`, `src/renderer/src/store/threadRuntime.ts`, `src/renderer/src/store/threadQueryCoordinator.ts` → shared cache ownership and exclusion from complete admission.
- `e2e/threadBodies.test.ts`, `src/renderer/src/store/threadBodies.test.ts` → frame/preload/runtime and cache-boundary proof patterns.

## Context
Provide one usable bounded child-page operation for later expansion controls; normal presentation remains complete-view. No UI, persistence, compact selection or live ancestor invalidation (#2103). No ADR required. In-flight #1544, #2079 and #2089 overlap connection/runtime/coordinator files in separate logic; inspected their diffs and no dependency is needed. Keep edits local and additive.

## Design
Add summary and complete seven-field cursor DTOs and child query/reply members. Main validates summary presence, safe integers, count/existence consistency, single-line bounded text and forbidden body/inventory fields. Preserve optional facts exactly, open vocabularies and zero order/version. Child limits default to 50 and clamp to 256.

`createThreadRuntime().children.demand(request, listener?)` shares `createThreadBodies`' owner, record map, queue and leases. Request names host, conversation, epoch, parent item ID and expected revision, with optional page limit. A lease exposes `getState`, `release`, `retry` and `continue(cursor)`. State retains a typed page containing summaries, captured version, completion and optional authoritative more/cursor. Body demand and its existing content API remain compatible.

Equal demand shares one attempt. Only explicit continuation echoing the current complete cursor advances; duplicate continuation shares work. Each successful page appends its strictly ascending tuple prefix. Data remains incomplete until its matching marker; marker-only empty success is valid. Only more=false marks this enumeration complete. A retry after any failure starts page one and replaces the old enumeration; old summaries can remain stale while waiting but cannot certify the new pass.

Main correlates scope/revision/capture and supplied envelope routing, accepts at most one data envelope and one marker, caps aggregate stamped JSON at 65519 bytes and rejects fragments. More=true requires the last delivered child's exact cursor. Continuation capture must equal consumed-history cursor version, and tuples advance strictly. Expansion replies are consumed before complete-query admission.

## State + concurrency model
Reuse four active, 28 queued, 64 records, 16 MiB UTF-8 JSON, 128 leases and 30-second deadlines across body/child work. Include partial summaries and cursor metadata in retained bytes. Failed records survive byte eviction and are ineligible for record eviction. New admission fails when no eligible record exists. Complete queries keep their independent progress.

Attempts capture unique request ID, owning connection token and store generation. Retirement revokes all affected leases before callbacks and blocks dispatch while retiring. Last release cancels locally through cancelThreadQuery. Navigation/disconnect preserve stale success and failure admission; reset, epoch replacement, deletion, successful unpair and disposal clear scope. Offline demand never sends; reconnect itself never fetches. Child summaries have no canonical store mutation capability, persistence, coverage or read-receipt authority.

## State transitions and identity reuse
| Event | Regression scenario in the child tests |
| --- | --- |
| Duplicate demand/release/continuation | shared page request and independent leases |
| Data then marker / marker-only success | page completion and empty capture |
| Continuation refusal with unchanged parent revision | retained partial content and fresh-first-page explicit retry |
| Byte/record eviction then reopen | failed admission survives pressure; successful content can refetch |
| Mixed body/child saturation | shared finite bounds and complete-query progress |
| Navigation/reopen, last release, disconnect/reconnect | retired attempts cannot deliver to reused identity; no automatic fetch |
| Reset/epoch/generation replacement, deletion/unpair/disposal | revoke subscriptions before reentrant callbacks and late delivery |
| Same IDs on two hosts or changed demanded revision | host and revision fences |

## Error handling
Reuse static malformed/metadata/sequence/limit/expired/interrupted/unavailable/daemon-error classifications and content-free lifecycle logging. Partial summaries survive failures as stale/incomplete; another demand or reconnect cannot retry. Invalid continuation fails conservatively and requires fresh retry. No peer error text is interpreted or logged.

## Testing strategy
Test first in the existing received-frame/preload/runtime harness and adjacent cache tests. Cover multiple pages and zero ties, optional unknown versus known values, hostile summaries/cursors/captures/markers/bytes/fragments, cancellation and reused identities, mixed resource bounds and complete progress. Positively observe received states/failures before excluding requests, admission and receipts. Run affected units, pre-verify and build after final main merge, then Electron-native preparation and the guarded recorded thread scenario on Linux. Synthetic evidence claims client handling only; macOS and fresh-provider acceptance are outside this run.

## Open Questions
None. Prefer one shared cache owner over duplicating scheduling and lifecycle code; child page state is additive to the existing body state surface.

## Sizing
One independently useful paged-demand operation; transport/cache-only splits violate the verification floor. Forecast ~850 written lines (300 production, 480 tests, 70 plan), four new exported DTO/state types at most, eight production consumer files, four observable acceptance criteria and existing static rejection taxonomy. Preserve the documented 50-line ceiling overage rather than split sole-consumer plumbing or remove proof.

## Security review
**Verdict:** PASS
- Trust boundaries: `isRendererCommand` validates expansion coordinates/cursor before main; `createThreadUpdateReceiver` validates peer summaries and correlation before typed preload delivery. MUST FIX addressed in design: reject body/inventory fields and inconsistent cursors/captures.
- Tokens: no new credential generation, reads or storage; request UUIDs are correlation only. Secrets remain in main.
- Files/storage: session memory only; no new filesystem paths, persistence or browser storage.
- Electron: existing isolated preload and fixed command/event channels; no new primitive, navigation or remote content. Transport remains in main.
- Cryptography: existing Noise implementation and keys unchanged; no key/nonce/comparison work introduced.
- Network/I/O: retain transport frame limits; add aggregate page budget and no-fragment rule, 30-second deadline and local cancellation. Existing TLS and reconnect policy unchanged.
- Errors/logs: only static event/reason codes; never log summaries, cursors, bodies, credentials or peer error text.
- Concurrency: unique attempts, connection and generation fences; revoke every lease before callbacks, dispatch barred during retirement, no automatic continuation/reconnect retry.
- Threat model: relay delay/reorder and hostile daemon frames fail closed with bounded work; compromised renderer has only validated commands. Existing safeStorage and process isolation remain unchanged. Live ancestor invalidation belongs to #2103.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-19
