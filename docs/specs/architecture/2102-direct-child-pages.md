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
| Duplicate demand/release/continuation and data/marker | `child pages traverse production frames and preload, preserve zero ties and continue only on demand` |
| Marker-only success | `marker-only empty success is cached, and unknown optional facts remain absent` |
| Continuation refusal with unchanged parent revision | `failed continuation retains incomplete summaries and retry starts a replacement first page` |
| Byte/record eviction then reopen | `partial child bytes and cursor metadata count, and eviction cannot bypass failed admission`; `received child record eviction reopens successes and never readmits a failed continuation` |
| Mixed body/child saturation | `mixed body/child saturation leaves complete queries progressing without prefetch` |
| Navigation/reopen, last release, disconnect/reconnect | `child retirement fences reused identity after %s`; `last child release cancels once and late data cannot complete replacement leases`; `child cached success is stale offline and reconnect waits for explicit demand` |
| Reset/epoch/generation replacement, deletion/unpair/disposal | `child retirement fences reused identity after %s`; `child generation replacement revokes all leases before reentrant callbacks and late data` |
| Same IDs on two hosts or changed demanded revision | `two hosts with colliding child identities stay isolated through connection and preload`; `new explicitly demanded parent revision retires old leases and late replies` |
| Active deadline / explicit retry | `child active deadline requires explicit first-page retry and clears timers on disposal` |

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

## Revisions
2026-10-19: Typechecking the configured client scenarios exposed three test-only complete-item observers whose catch-all update branch included expansion replies. Narrow those branches to item changes/appends, preserving all scenario assertions. Child state is an additive `page` field on the existing cache state, with inert empty content for child success; body content and its required ready-state type remain compatible. Explicit changed parent revision retires the prior revision's leases. Aggregate byte accounting reserves all protocol stamps and includes an active continuation cursor alongside retained summaries.

2026-10-19: A repeated continuation arriving after its page marker must reuse success, just as duplicates during an active read share it. Retain successfully consumed cursors within the byte-accounted page, clear them on replacement enumeration and reuse only those exact cursors. The multi-page frame test now repeats continuation both before and after completion.

2026-10-19: Child cache identity includes the normalized page limit so a different requested ceiling cannot borrow an incompatible page. Omitted/zero limits still share the default-50 read; the cache test `child demand shares normalized limits and separates distinct page ceilings` proves both paths.

2026-10-19: Received JSON whitespace/escape spellings disappear during parsing. A controlled two-envelope regression exceeded the aggregate wire budget while normalized DTO sizes incorrectly completed successfully. `createThreadUpdateReceiver.receive` now optionally receives original plaintext bytes from main and counts their length plus reserved-stamp overhead measured from the original object. Raw bytes remain in main; the received-frame regression proves rejection after positively observing the first partial page.

2026-10-19: Superseding a demanded revision retires the old leases synchronously. A retirement listener can navigate, reopen equal IDs or disconnect before the original admission resumes. Recheck selection ownership, store generation, epoch and connection after retirement callbacks; runtime supplies its existing selection token. `revision retirement callbacks cannot admit a new child read after %s` proves all three departures settle retired without a replacement child request.

2026-10-19: Strictly increasing tuples alone allow one child ID to reappear at a greater order. Reject repeated IDs within a page in main and across retained pages in the cache; fresh replacement enumerations may reuse IDs. Received-frame duplicate-identity cases prove both boundaries.

Additional compatibility reading: `e2e/fixtures/lunaHandoverProof.ts` → `completedHandoverReply`, `e2e/fixtures/queueTurnEvidence.ts` → `createQueueTurnEvidence`, and `e2e/real-claude-codex-channel.spec.ts` → `observe`: complete-item proof consumers now narrow explicitly to item changes/appends, leaving all assertions intact.

2026-10-19 rework, verifier finding 1: Successful child caches remain keyed by normalized limit, but `start` also checks failed entries for the same host/conversation/epoch/parent/revision and store generation, ignoring limit. A blocked variant retains its own failed admission in the existing bounded record map; only its lease's explicit `retry()` permits a fresh first page with that variant's limit. Fresh cached successes still reopen, while stale revalidation and continuation cannot silently bypass another variant's failure. No separate failure ledger is added. `changed child limits cannot bypass failed continuation with %s content` proves received-frame/preload/runtime failure admission with retained and byte-evicted summaries, followed by explicit replacement retry; `child failure admission preserves limit-specific successes and stays within the shared record bound` covers successful reuse and bounded failed variants. No in-flight branch overlaps these repair files. This repairs one existing invariant, adds no exported type or consumer migration, and forecasts under 100 written lines including tests and this revision.

Security re-review for this repair: **PASS** under `builder/security-review.md`. Trust remains at validated commands/replies; `start` prevents limit-dependent retry bypass with a bounded scan of existing generation-qualified records. Existing record/lease/byte limits, retirement, timers and content-free classified errors remain authoritative. No token, storage, Electron privilege, cryptographic primitive or network boundary changes; the existing threat model and deferred scope still apply.

## Verification
Linux execution at implementation `cda1a1a5`, after merging main `5afde437`:

- Pre-verify: all five checks passed, including the 119 received-frame/preload/runtime cases.
- Affected Vitest: 311 executed, 311 passed, zero failed/skipped across seven files.
- Build, application/client-test typechecks, docs guard and sequential Node/Electron native preparation passed.
- Complete configured guarded replay: 29 executed/passed, zero failed, one existing system-prompt-reset fixme (historical upstream [Core #2436](https://github.com/pyrycode/pyrycode/issues/2436), now closed). Zero forbidden launches; original assertions and strict outgoing matching retained. The named daemon-built-thread scenario passed.
- Fresh logs: `/tmp/builder-2102-preverify-final.log`, `/tmp/builder-2102-build-final.log`, `/tmp/builder-2102-affected-final.log`, `/tmp/builder-2102-recorded-final.log`.
- These are synthetic bridge and historical captured-client results, with no new provider, cryptography or native-transport acceptance claim. macOS is outside this Linux ticket's verification scope.
- Final written work remains below 800 lines including plan revisions; two new exported DTOs and eight production files. The earlier verification-floor overage forecast was unnecessary in the final implementation.

### Rework verification — 2026-10-19
Linux implementation `87b98e6b`, after final merge of main `5afde437`: all three added cases reproduced the bypass before implementation; afterwards both affected Vitest files passed, 146 executed/passed, zero failed/skipped. Pre-verify passed all five checks, including 121 received-frame cases. Build, client-test typecheck, docs guard and sequential Node/Electron native preparation passed.

Guarded replay selected `daemon-built thread streams, places an agent, reconnects, resets and reopens saved items`: 1 executed/passed, zero failed/skipped, zero forbidden launches. Original assertions and strict outgoing matching remain intact. Logs: `/tmp/builder-2102/rework-preverify.log`, `/tmp/builder-2102/rework-build.log`, `/tmp/builder-2102/rework-client-typecheck.log`, `/tmp/builder-2102/rework-electron-native.log`, `/tmp/builder-2102/rework-recorded.log`. These remain synthetic client-handling results; macOS and fresh provider acceptance are outside this Linux repair's verification scope.
