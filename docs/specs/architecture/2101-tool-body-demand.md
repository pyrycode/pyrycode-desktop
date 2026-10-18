# Owned on-demand thread bodies

## Files read
- `src/shared/wire/thread.ts` → `ThreadQuery`, `ThreadReply`: complete-query contracts to extend additively.
- `src/shared/ipc/commands.ts` → `isRendererCommand`: validate body identity and local cancellation.
- `src/main/threadQueryCommand.ts`, `src/main/index.ts`, `src/main/connectionRegistry.ts` → `dispatchThreadQuery`, registry delegates: explicit host routing.
- `src/main/daemonConnection.ts` → `queryThread`, `loadDialConfig`, `onDriverEvent`: accepted handshake, correlation and retirement.
- `src/main/transport/inboundMessage.ts`, `src/main/transport/threadUpdates.ts` → `parseInboundPayload`, `createThreadUpdateReceiver`: bounded logical assembly.
- `src/shared/ipc/events.ts`, `src/preload/index.ts` → `StampedDaemonEvent`, bridge: existing typed reply route.
- `src/renderer/src/store/threadRuntime.ts`, `threadQueryCoordinator.ts` → runtime selection and complete-query ownership.
- `src/main/threadQueries.test.ts`, `src/renderer/src/store/threadRuntime.test.ts`: frame/preload and runtime harnesses.
- `docs/knowledge/features/thread-runtime.md`, `thread-item-store.md`: generation ownership, saved complete route and certificate isolation.
- `docs/knowledge/features/development-verification.md`, `docs/recorded-tests.md`: client contract versus provider proof, native addon ABI and replay.
- Core `docs/protocol-mobile.md`, “Bounded expansion reads”: installed body schema and separate marker contract.

## Context
Expose one usable operation through `createThreadRuntime`: demand one tool/agent body, share it, release it and explicitly retry it. Complete opening, controls and persistence remain unchanged. No new ADR is needed.
Sizing: one independently verifiable behaviour; transport/cache-only children violate the verification floor. Retain the refiner's ~1030-line forecast (230 above 800), ≤5 new exports, ≤10 simultaneous consumers, four observable acceptance criteria and existing receiver reject classifications. The finished plan retains this exception.
Overlap audit: feature/1544 edits configuration correlation; feature/2079 edits runtime scheduling and feature/2089 edits host removal. Body hooks remain additive beside those operations; no dependency on their new interfaces.

## Design
Extend the existing query/reply union with `thread_read_tool_body` and `thread_tool_body`. Body request fields are conversation, nonempty epoch, positive safe item ID and expected revision. Main reconstructs outbound fields by name. IPC cancellation carries explicit host and opaque request ID and only removes local receiver ownership; it sends no daemon message. Its connection method is optional to preserve existing scalar doubles.
Advertise `thread_expansion`; main and runtime require the current accepted handshake's `interactive`, `thread` and `thread_expansion`. A previous connection's capabilities grant no authority.
Reuse the receiver for body fragments (no `base_rev`, digest under `thread_tool_body`). Validate routing, item/revision, kind, captured version and envelope conversation/session metadata across data and marker. Data requires object content and `final: false`; marker requires `final: true` without content, following exactly one data payload. Unknown content stays inert JSON. Body replies never reach canonical batch application or receipts.
Add a runtime-owned body cache with `demand(request, listener?)` returning `getState`, `release`, `retry`. State is missing (including evicted/offline), loading, failed, or ready with object content and stale flag. Duplicate identities share a read and each returned lease owns one consumer. Failed state requires explicit retry. No child enumeration or automatic retries.

## State + concurrency model
The synchronous cache writer owns request IDs, deadlines, queue and bounded lease sets. Scope keys include host/conversation/epoch/item/revision/kind; active work also captures connection and runtime selection/store-generation ownership. Fresh UUID request IDs prevent reused owner or epoch strings from admitting late replies.
Limits: four active reads, 28 queued (32 outstanding total), 64 retained entry records, 16 MiB retained body JSON, 128 demand leases/subscriptions total, 30-second read deadline. Reject overflow with static limit state; evict least-recently-used ready content and expose evicted missing state. Last release cancels queued/active work through IPC. Completed unchanged content is reusable in the same connection. Offline retained content is stale and readable; offline missing sends nothing. New connection marks retained entries stale and fetches nothing until explicit demand.
Main retains existing 8 MiB logical, 16 MiB aggregate, eight assembly, 30-second expiry limits. Bound registered body queries at 32 and add a 30-second body deadline, including marker-only waits. Cancellation clears both correlation timers and partial assemblies.
Navigation retires leases and active work, retaining completed content. Disconnect does likewise and withdraws capability. Store generation/epoch replacement, deletion and successful unpair clear affected entries. Disposal clears every timer, entry and subscription. No detail persistence.

## State transitions and identity reuse
| Event | Regression proof |
| --- | --- |
| duplicate demand / one release / last release | body integration: shared ownership and cancellation |
| fragmented data then separate marker / empty vs absent | body integration: completion and inert content |
| failure / repeated demand / explicit retry | body integration: retry gate |
| active/queue/subscription/cache bounds and eviction | body cache boundary tests |
| same-connection reopen | body integration: retained cache reuse |
| disconnect / reconnect explicit demand | body integration: freshness and no reconnect fetch |
| navigation / reused selection and epoch strings | runtime body lifecycle tests |
| reset / epoch replacement / deletion / successful unpair | runtime body lifecycle tests |
| disposal / late data, fragments, marker and failure | body integration: retirement and timer cleanup |
| two hosts with colliding identities | body integration: host isolation |

## Error handling
Reuse static thread query failures; never forward peer error text. Invalid IPC is rejected at validation; runtime invalid/offline/unsupported/limit demands return explicit inert states without sending. Main revalidates body admission even for direct callers. Failures retain stale completed data when present but never mark it fresh. No automatic retry.

## Testing strategy
Test first in the existing main frame/preload harness and focused cache/runtime specs. Use fake timers for deadlines and injectable finite limits for exact cache boundaries without huge fixtures. Exercise receiver byte/assembly ceilings with bounded synthetic frames. Run affected unit files, pre-verify and build after final main merge, then guarded recorded client replay on Linux. Record executed/pass/fail/skip counts. Synthetic frames establish the installed client contract only; no provider or encryption claim. No UI change or Figma source is needed.

## Open Questions
None. Keep complete queries separate in the coordinator by narrowing its pending query type and ignoring body replies.

## Revisions
2026-10-18: the cross-process frame/preload/runtime proof lives in `e2e/threadBodies.test.ts`, using the existing thread-query harness pattern locally. Importing renderer runtime from a main-process test violates the repository's separate composite TypeScript project boundaries. Production code remains typechecked in its owning project; Vitest runs the integration harness without adding a DOM environment. The implementation is smaller than forecast (under 800 written lines at final review), with two new exports and no fixture signature migration.
Implemented lifecycle proofs (parameterized titles include each named mode):
- `e2e/threadBodies.test.ts`: `runtime body tool_call traverses frames and preload, completes only at marker and reopens from cache` covers shared demand, one-consumer release, empty content, fragments and reopening.
- `e2e/threadBodies.test.ts`: `late body fragments/data/marker cannot revive runtime after %s` covers release, navigation, disconnect, reset, epoch replacement, deletion, successful unpair and disposal.
- `e2e/threadBodies.test.ts`: `navigation back to the same strings creates new demand ownership and never adopts a late old failure` and `two hosts with colliding identities keep frame results isolated through the real bridge and runtime` cover identity reuse.
- `e2e/threadBodies.test.ts`: `reconnect leaves retained bodies stale until explicit fresh demand, and offline missing sends nothing` covers connection freshness; malformed-body cases cover explicit retry.
- `src/renderer/src/store/threadBodies.test.ts`: exact active/queue, 128-lease, 64-entry and retained-byte boundary cases cover finite admission and eviction; `cancelled reconnect validation stays stale across %s and requires a new read` covers interrupted freshness.
- `src/renderer/src/store/threadBodies.test.ts`: `retirement notifications cannot reenter demand and revive a leaving scope` and `navigation cannot silently retry a retained failure` cover subscription retirement and retained failure ownership.

2026-10-18 (verifier rework): a retirement listener could retry through a second, still-active lease after cancellation. Retirement now snapshots affected entries, disables all their leases and removes listeners before cancelling any work, then settles/deletes entries before notifying listeners. `retry`, `start` and `pump` reject work during retirement. Notifications remain synchronous, but cannot retain or dispatch departing ownership. Tests `retirement disables every existing lease before callbacks retry item %s` cover same-entry and cross-entry leases, late completion and explicit retry; `navigation cannot restart failed body work through a second existing lease in a retirement callback` proves the production frame/preload/runtime path. This repairs the existing ownership invariant, with no independently useful additional behaviour. Forecast remains within the refiner's 1030-line verification-floor exception (the earlier under-800 count predates this repair); no new exports or consumer migrations. The fresh remote-branch audit found no overlaps in the three implementation/test files.

## Documentation handoff
- Pending documentation stage: `docs/knowledge/features/daemon-connection-correlation-requests.md`, new section “Bounded thread body reads”: negotiated `thread_expansion`, request/data/separate-marker validation, validated local cancellation and bounded main correlation/assembly cleanup.
- Pending documentation stage: `docs/knowledge/features/thread-runtime.md`, new section “On-demand bodies”: demand/getState/release/retry, shared ownership, explicit failure retry, finite cache limits/eviction, offline/stale reads, explicit reconnect revalidation and lifecycle retirement including callback reentrancy. Preserve complete saved reading; no detail persistence, canonical-item/coverage/receipt writes, row wiring, child enumeration or compact selection.
- Pending documentation stage: `docs/knowledge/features/thread-runtime.md`, “Validation boundaries”: record Linux executed/pass/fail/skip counts and distinguish synthetic frame/preload/runtime and captured replay evidence from fresh provider/encryption proof.

## Security review
**Verdict:** PASS
- Trust boundaries: `isRendererCommand` validates coordinates/cancel IDs; main reconstructs allowlisted body payloads; `logical` and receiver correlation validate peer JSON before IPC. Unknown content is data only.
- Tokens: no new credentials; UUIDs identify requests, never grant daemon authority. Existing keys remain main-only.
- File/storage: session memory only, no new disk, browser storage, path or durable format.
- Electron: existing isolated bridge only; cancellation is host/request-scoped, with no raw transport primitive. No navigation, window or remote-content changes.
- Cryptography: reuse existing Noise and Node SHA-256 assembly digest, no key/nonce changes or new secret comparison.
- Network/I/O: retain all existing frame/assembly caps; finite query registration, queues, leases, cache and deadlines bound hostile floods and missing markers. TLS/relay configuration unchanged.
- Errors/logs: static lifecycle/classification codes only; never body, peer error text, token, key or transcript.
- Concurrency: fresh per-attempt identity plus connection/selection/generation ownership; every timer and subscription has explicit retirement. Last release reaches main cleanup.
- Threat alignment: delayed/reordered relay input and hostile daemon payloads fail correlation/validation; compromised renderer cannot bypass main capability/shape/size admission or access keys. Existing safeStorage and Noise continue to cover disk credential theft and relay confidentiality; this ticket changes neither.
**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-18

2026-10-18 rework adversarial review: **PASS** with the retirement change above. The verifier's concurrency MUST FIX is addressed by disabling every affected lease before any external callback and gating all retry/dispatch entry points during retirement. Same-entry/cross-entry and bridge/runtime regressions must prove no replacement read, leaked timer or late adoption. Rechecked the other eight categories: validated IPC/peer boundaries, credentials, storage, Electron isolation, crypto, network limits, static diagnostics and threat model retain the original design and require no additional surface.
