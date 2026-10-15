## Files read
- `src/main/daemonConnection.ts` → `createDaemonConnection`, `onDriverEvent`: shared allocator, fatal-error precedence and every connection reset.
- `src/main/connectionRegistry.ts` → `viewOf`, `connectionFor`: named-host native access and stop on unpair/replacement.
- `src/main/transport/hostedResources.ts` → `openView`, `reset`, `receive`: irreversible per-view retirement and send observation.
- `src/main/transport/hostedCodec.ts` → `decodeHostedControl`: original-byte validation and projected records.
- `src/main/daemonConnection.test.ts`, `src/main/connectionRegistry.test.ts`, `src/main/transport/hostedResources.test.ts`: fake driver and resource lifetime coverage.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`, `docs/knowledge/features/daemon-connection-lifecycle.md` → Hosted resource views: automatic re-handshakes reuse the driver but retire every old handle.
- Approved daemon contract `3120-hosted-app-contract.md` → sections 4, 5 and 7: bounded authoritative discovery, notification revisions, cancellation and retirement.

## Context
Native consumers need current host-scoped readiness independent of conversations. Neither cached running state nor an old resource handle can authorize a new connection. No renderer/UI or protocol changes belong here. Live acceptance belongs to #1929.
Overlap: #1544 edits different run-config blocks in daemonConnection and its tests; these changes stay local and additive.

## Design
Add `createHostedApps` in main transport. Each connection exposes `hostedApps` through the registry's existing named-host view. `read()` returns a copied discriminated discovery snapshot (unavailable, unsupported, loading, ready with revision/records, or failed with static reason). `subscribe(listener)` returns unsubscribe; `refresh()` coalesces with an active refresh. `openView(appId)` returns a typed success/resource handle only for a ready running record with active release, otherwise a local failure. Returned handles retire permanently and unregister when the native caller retires them.
The service owns one list slot and a bounded notification buffer. A walk captures one revision, strictly ascending IDs across pages and at most 256 records; no partial state publishes. At completion discard old updates and apply newer notifications contiguously. Whole-record changes retire only bindings whose release/readiness changed; removal does likewise. Gap, overflow, apps.changed or drift schedules one coalesced fresh walk and invalidates authority immediately.
Use the original-byte hosted codec before generic projection, preserving fatal authentication/update-required precedence and resource-owned reply routing. Advertise hosted_apps_v1 only with this wiring installed. A foreign acknowledged host cannot enable discovery.
Resource owner supplies a shared sixteen-slot control reservation used by discovery/list cancellations and existing resource cancellations/credit sends. Admission failure retires the operation locally; cancellation bookkeeping is independently timed and never revives its target. IDs and driver sends use the existing allocator and transport.

## State + concurrency model
All writes run synchronously in the main event loop. No new socket, stream or renderer store. One refresh deadline is fixed at enqueue +30 seconds across restarts, plus five seconds without accepted list progress. Restart triggers share one scheduled callback. Every request, cancellation and restart timer is released on reset; driver-generation fencing remains authoritative. Observers are main-only and cannot throw into dispatch.
Discovery loss retires all its bindings before notifying observers. Connection resets invalidate discovery before resetting resources; negotiated support starts rediscovery only after authentication/resource support is installed. No old handle or mutation is replayed.

## State transitions and identity reuse
| Event | Test coverage |
| --- | --- |
| Multi-page/empty walk, repeated refresh | `publishes only complete ordered snapshots and coalesces refresh` |
| Updates/removal during walk and after readiness | `applies contiguous whole records and retires only affected bindings` |
| Cursor expiry/drift/gap/overflow, repeated restart | `restarts invalid walks with exact independent cancellation` and `bounds overflow and fixed deadlines across restarts` |
| Invalid/foreign/late correlations and send failure | `rejects invalid correlations and bounds failure cleanup` |
| Disconnect, re-handshake, downgrade, same app on two hosts | fake-driver `discovers each host independently and fences reconnect readiness` plus existing lifecycle matrix |
| Explicit reconnect, stop, unpair/replacement | existing connection/registry teardown coverage plus discovery reset assertions |
| Retired handle reopened under same app/release | `applies contiguous whole records and retires only affected bindings` |

## Error handling
Static failure reasons: timeout, limit, invalid, bridge, send-failed. Unavailable/unsupported are explicit states. Only apps.changed restarts a bridge error automatically. Malformed correlated traffic cannot certify readiness; foreign replies allocate nothing. Native open fails locally while unconfirmed. Content-free lifecycle/error logs contain only static event/code. No daemon text, paths, queries, bytes or credentials enter logs.

## Testing strategy
Test first with fake timers and actual hosted codecs/resource owner; prove exact list/cancel correlation, capacity/deadline cleanup, all states, release retirement and immutable read copies. Fake-driver tests exercise actual connection routing, hello advertisement, host isolation and a positive unrelated-message barrier while a walk is held. No UI interaction or live spec changes; run focused units, final pre-verify and build.
Sizing: one independently checkable readiness service; approximately 760 written lines including plan/tests, one new exported status type, fewer than six consumers, five acceptance behaviours and five terminal failure categories. No dependency or documentation-stage file edits.

## Open Questions
None. The bounded native result is the explicit failed discovery state; refresh/new connection is the retry authority.

## Security review
**Verdict:** PASS
- [Trust boundaries] Original bytes enter only `decodeHostedControl`; routing hints may retire owned work but never admit records. Host is fixed by the authenticated connection, with ack identity checked before support.
- [Tokens] No new credential generation/storage; existing safeStorage/Noise path remains main-only.
- [File/storage] Discovery is memory-only; no daemon text becomes a path, URL, disk cache or log.
- [Electron] Only trusted native closures are added, with no IPC, browser window, protocol or web capability. Viewer isolation belongs to #1960.
- [Crypto] Existing Noise and monotonic envelope allocator are reused; no cryptographic changes.
- [Network/I/O] Existing bounded encrypted transport plus original-byte hosted envelope cap; 16 records/page, 256 records/updates, shared 16 controls and fixed 30s/5s deadlines prevent unbounded accumulation.
- [Errors/logs] Static codes only; caught decoder/send errors and payload content are discarded.
- [Concurrency] One slot, coalesced restarts, irreversible binding retirement and reset-driven timer/buffer cleanup prevent late resurrection, including same-ID reconnects.
- [Threat model] Relay delay/flood is bounded by deadlines/caps; hostile daemon responses fail validation/correlation. Disk token theft remains covered by existing safeStorage; compromised renderer receives no new authority. Live daemon activation remains #1929.
**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-15

## Revisions
2026-10-15: Reset the resource owner before discovery on connection boundaries, so retiring discovery bindings cannot send old-session resource cancels during re-handshake. No observer runs until both authorities are invalidated. Shared control reservations conservatively count both pending correlations and held sends; send reservations survive target timeout until observed or connection reset, preventing rekey-buffer accumulation. This may admit fewer than sixteen cancellation acknowledgements. Restart errors do not renew inactivity; only an accepted page does. Tests: `does not extend inactivity for restart errors or unrelated notifications` and `keeps held control sends bounded even after their target and acknowledgement expire`.
