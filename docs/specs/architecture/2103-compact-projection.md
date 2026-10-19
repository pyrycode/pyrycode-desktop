# Compact projection coverage and detail freshness

## Files read
- `src/shared/wire/thread.ts`: `ThreadQuery`, `ThreadReply`, summary and cursor contracts.
- `src/shared/ipc/commands.ts`: `isRendererCommand`, privileged query admission.
- `src/shared/ipc/events.ts`: `StampedDaemonEvent`, host-bound delivery.
- `src/main/transport/threadUpdates.ts`: `logical`, `part`, `publish`, bounded assembly and correlation.
- `src/main/transport/inboundMessage.ts`: `parseInboundPayload`, received-frame routing.
- `src/main/daemonConnection.ts`: `createDaemonConnection`, negotiation and serialization.
- `src/renderer/src/store/threadQueryCoordinator.ts`: complete query scheduling and certificates.
- `src/renderer/src/store/threadItemStore.ts`: complete owned writes; compact must bypass them.
- `src/renderer/src/store/threadRuntime.ts`: navigation, restoration and lifecycle ownership.
- `src/renderer/src/store/threadBodies.ts`: demand leases, bounded cache and explicit failure retry.
- `e2e/threadBodies.test.ts`: received-frame/preload/runtime harness.
- `docs/knowledge/features/thread-runtime.md`, `thread-item-store.md`: separate complete checkpoints, local traversal and detail completion.
- `docs/knowledge/features/development-verification.md`, `docs/recorded-tests.md`: positive processing barriers and native ABI preparation.
- Core `docs/protocol-mobile.md`: Compact projection, Query/live ordering, Bounded expansion reads, from local Core checkout.

## Context
Explicit compact selection must keep row facts current without claiming complete contents or unseen read authority. Production opening remains complete. No persistence, visual changes or new dependencies.
One useful lifecycle includes initialization, live replacement/recovery and demanded detail invalidation. Splitting its single-consumer plumbing violates the verification floor. Forecast approximately 1300 written lines (500 production, 710 tests, 90 plan), matching refinement's measured exception; at most five exported declarations, ten simultaneous consumers, four observable criteria and ten existing rejection classifications.
Overlap: #2079 schedules complete updates; #2089 retires host live state; #1544 changes configuration correlation. Keep changes additive and preserve their contracts. No design requires their new symbols or restructures their blocks.

## Design
Extend existing wire query/reply DTOs additively with explicit `compact-v1` scope and mixed headers. A separate compact live event passes through the same connection/preload bridge. Main reuses strict summary validation, bounded whole-payload assembly and query correlation; projection participates in fragment and query metadata.
Add a session-only projection owner exposing host/conversation snapshots and explicit open/query/event/retire operations. It owns root facts sorted by `(order,id)`, compact certified ranges/checkpoint, consumed progress and generation. It never writes canonical complete items, saved history or receipt state. Complete coordinator ignores compact delivery. Runtime `open(host, chat, { projection: 'compact-v1' })` opts in; omitted options retain complete behavior.
Only final successful markers certify root windows or catch-up intervals. Live source intervals may overlap and equal-version distinct identities all apply; retain the newer revision/freshness for an identity. Hidden-only frames advance consumed evidence without rows or checkpoints. Gaps trigger bounded recovery from certified evidence. First/incompatible selection starts at zero, pages include epoch, reset clears only matching compact scope and initializes at zero.
Compact runtime query dispatch shares a finite per-host lane with expansion reads, so root recovery and active detail refresh cannot compete for Core's single unfinished slot. Cancellation and terminal outcomes release ownership, with fresh request identities fencing late results.

## State + concurrency model
Compact state is session-only and independent of `items`, complete progress and disk restoration. Selection and connection generations own queries and refresh. Navigation cancels pending compact work and detail leases. Offline reopen reads only retained compact facts and stale/missing detail. Complete restoration remains unchanged.
Detail invalidation marks retained content stale, resets child traversal to page one, fences an older in-flight attempt and coalesces replacement work for active leases only. Source revision changes update refresh requests without permitting late replies to overwrite newer facts. Missing freshness is conservative. Failed entries remain failed until explicit retry; no automatic retry on invalidation, reconnect or changed limits. Next pages remain explicit.

## State transitions and identity reuse
| Event | Test coverage in `e2e/threadBodies.test.ts` / compact owner tests |
| --- | --- |
| First compact selection / complete checkpoint present | starts at zero; complete state unchanged |
| Newest and older pages / catch-up | mixed placement; marker-only certification; page epoch |
| Equal-version replacements / hidden progress | both identities retained; no invented rows |
| Query/live overlap / gap | retained newer facts; recovery from certified checkpoint |
| Same-revision freshness while body/child read pending | old completion fenced; first-page restart |
| Refresh failure / retry | stale readable content; no automatic reads; explicit retry |
| Reconnect / reset / reused epoch | matching compact recovery; generation fences |
| Navigation / same IDs on other hosts / deletion / unpair / dispose | cancelled queries and leases; no late resurrection |
| Offline reopen | actually retained rows only; no persistence/full-history read |

## Error handling
Reuse static malformed, metadata, limit, interrupted, unavailable and daemon-error classifications. Unknown projections and scope mismatches refuse without fallback. Query failure never certifies coverage; detail failure retains readable stale content and explicit retry. Diagnostics contain static event/code only, never peer text, bodies, epoch or scope strings.

## Testing strategy
Write received-frame regression tests first using the real connection, IPC dispatch, preload and runtime harness. Supplement pure compact ownership and bounded cache tests with fake timers. Exercise hostile summaries, scope/assembly mismatches and terminal failures. Run changed unit files, pre-verify and build after merging main. Run applicable captured client replay on Linux after Electron ABI preparation; report counted results. No fresh provider, encryption or live-daemon claim.

## Open Questions
None. Keep the separate projection owner instead of adding headers to canonical complete storage: this keeps authority and persistence boundaries explicit.

## Security review
**Verdict: PASS** after all nine categories below; implementation obligations are part of this design.
- Trust boundaries: MUST FIX addressed by validating projection, summary, root eligibility and scope in `logical`/`publish`, and explicit projection/epoch admission in `isRendererCommand`.
- Tokens: no credential changes; existing main-only safeStorage and Noise identity stay intact.
- File/storage: no compact/detail persistence, file paths or renderer web storage; existing complete encrypted restoration unchanged.
- Electron surface: typed existing IPC only; validate all added fields, no raw socket/Node API exposure or navigation changes.
- Cryptography: existing Noise and bounded SHA256 assembly reused unchanged; no key/nonce changes.
- Network/I/O: existing assembly byte/count/deadline bounds apply, including projection metadata; finite lane prevents query contention loops.
- Errors/logs: static classifications only; no peer content, headers, tokens or raw exceptions logged.
- Concurrency: fresh request identities, connection/selection/epoch generation checks, attempt cancellation and first-page restart prevent stale completion or scope resurrection; all timers and subscriptions retire.
- Threat model: hostile daemon shapes fail closed; delayed/reordered relay frames cannot certify coverage or revive retired owners. Relay availability remains existing transport policy. Production presentation/activation is owned by #2081.

## Revisions
2026-10-19: The separate compact event needs additive ignore cases in `daemonEventBridge`, `modalBridge`, `questionBridge` and `timelineBridge`; their exhaustive switches intentionally refuse unowned events. These four local additions preserve the existing scalar APIs and keep the consumer count within ten.
Compact page completion certifies only its root window; it cannot advance the catch-up checkpoint/consumed interval or discharge a live gap. Root facts retain per-identity source versions so delayed query rows cannot erase newer live metadata, including unknown freshness.
Detail attempts capture a minimum admitted compact version, reject older captures, and learn newer demanded child revisions from child summaries before queued wire dispatch. Invalidation is conservative across the selected scope, coalesced into one microtask, and restarts child enumeration at page one. Failed entries still require retry. This resolves the concrete integration choice without changing complete-mode behavior.
An optional coordinator initialization hint keeps a compact-to-complete switch at version zero while preserving saved complete items/checkpoints. Ordinary complete opening keeps its existing route. Returning to compact after complete also initializes at zero.
Incompatible compact re-selection drops prior coverage and marks held detail stale while retaining readable facts. Final recount is approximately 790 added lines including plan, production and tests; two new exported declarations and at most ten simultaneous consumer updates.
The refreshed-parent continuation regression exposed a lease closure validating against its original revision. Continuations now validate against the entry's current admitted request. Recount is approximately 805 added lines; this inseparable regression stays with the lifecycle under the ticket's verification-floor exception.
