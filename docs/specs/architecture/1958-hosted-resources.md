# Bounded paired hosted resources

## Files read
- `src/main/daemonConnection.ts` → `createDaemonConnection`, `onDriverEvent`: allocator, authenticated lifecycle and driver generation fence.
- `src/main/connectionRegistry.ts` → `viewOf`, `connectionFor`: explicitly selected paired host access.
- `src/main/transport/hostedResourceCodec.ts` → `decodeHostedResource`, `encodeHostedResource`: request-context validation and HTTP bounds.
- `src/main/transport/hostedCodec.ts` → `decodeHostedControl`, `encodeHostedControl`: scoped cancel and bridge errors.
- `src/main/transport/threadUpdates.ts` → `createThreadUpdateReceiver`: synchronous ownership and teardown precedent.
- `src/main/transport/sendObservation.ts` → `SendOutcome`: write/drop observation.
- `docs/knowledge/features/wire-codec.md` → consumer obligations: validate original plaintext before projection.
- `docs/knowledge/features/development-verification.md` → protocol evidence boundaries.
- Approved daemon contract `3120-hosted-app-contract.md` at `964c5c4bab8e9267ee5e4c374d34a5bb1ebeb6f0` → resource/HTTP, retirement and lifecycle obligations.

## Context
Trusted main-process callers need complete verified bytes through a named paired host. No UI, discovery, HTTP shortcut, new dependency or renderer bytes are introduced. Readiness advertisement remains #1959, viewer isolation #1960, real acceptance #1929. Overlap #1544 changes separate configuration blocks; integration remains local and additive.

## Design
`createHostedResources` owns a per-connection synchronous queue and assembler. `DaemonConnection.hostedResources` and registry views expose it. `openView(appId, release)` returns a main-only handle with `request(input, signal?)` and `retire()`. Its closure pins host, app, release, view identity and generation; no caller-supplied request ID or response routing authority. `retire()` on the resource owner retires all views for host replacement. A simpler closure handle avoids a second discovery store and mutable view-ID registry.
Inputs discriminate asset/API requests and reuse wire payload fields excluding pinned identity. Results discriminate complete metadata/Buffer bytes from static failure plus `uncertain` for dispatched mutations. The existing connection allocator supplies all resource, credit and cancel IDs, remaining monotonic across dials.
At most eight active requests; each view admits sixteen including active requests. Metadata reserves declared bytes against sixteen MiB before allocation. Existing contextual validators enforce asset/API frame limits; assembly additionally verifies feasible counts, metadata uniqueness, consecutive granted chunks, exact bytes/count and SHA-256. Zero-byte metadata completes immediately. Only consuming a nonfinal chunk sends one next credit; a queued credit grants nothing until observed written.
Original plaintext is routed by generic envelope identity, then validated by the existing hosted codecs with the captured request before acceptance. Hosted replies are consumed in main; unrelated messages continue down the existing parser. No second field parser is added.

## State + concurrency model
One synchronous writer owns pending operations, assembly reservations and cancellation bookkeeping. Queued → active → metadata/assembly → terminal; no await inside transitions. Each operation owns its fixed thirty-second enqueue timer, active five-second progress timer and abort listener. Every terminal removes timers/listeners/bytes before resolving once and pumping the queue. Mutation sends are conservatively uncertain once attempted; never replayed.
Cancellation is scoped to the original request/app, uses an independently allocated envelope ID, and has a five-second expiry. At most sixteen cancellation records survive; oldest records expire on overflow. Matching acknowledgements validate both cancel ID and original scope. Lifecycle reset clears controls and advances the view generation, without sending old-session cancels into a successor handshake. Explicit caller retirement/abort/timeouts send cancellation while connected.

## State transitions and identity reuse
| Event | Focused test obligation |
| --- | --- |
| Repeated metadata, corrupt/duplicate/skipped chunks | `rejects corrupt active streams` |
| Abort, repeat retire, release/host view replacement | `retires scopes once and correlates cancels independently` |
| Deadline, inactivity, queue promotion | `keeps enqueue deadline fixed and ignores unrelated progress` |
| Automatic handshake, disconnect, explicit reconnect, auth failure, stop | `fences hosted work across connection lifecycle` |
| Reused app/release/view names and stale IDs, two hosts | `isolates hosts and successor views` |
| Held transfer alongside ordinary message/control | `keeps unrelated traffic runnable` |

## Error handling
Static categories: unavailable, retired, aborted, limit, invalid, timeout, corrupt, bridge, send-failed. Failure diagnostics contain event/code only, never paths, query, headers, bytes or daemon error text. HTTP failures remain successful resource results carrying their status. Invalid active replies retire only their correlated operation. Unknown/late replies allocate nothing.

## Testing strategy
Test first with local Vitest fixtures and fake timers: binary multiframe asset, request bytes/query/headers and POST/204; allowed verbs and empty status semantics; exact credit pacing and quotas; corruption, bridge/send/drop failures; deadlines, bounded cancel expiry, reservation reuse and all lifecycle fences. Fake-driver connection/registry coverage proves named-host wiring and a positive ordinary-message/control barrier. No browser interaction or live test is changed. Run focused specs, final main merge, pre-verify and build.

## Open Questions
None. Size recount: approximately 340 production, 370 tests/helpers and 65 plan lines; three exported declarations, three consumer/test-double updates, four observable acceptance criteria, nine failure categories. One deliverable: bounded main-process resource completion.

## Security review
**Verdict:** PASS
- Trust boundaries: MUST FIX addressed by validating original plaintext using contextual hosted codecs before accepting bytes; generic projection supplies routing only.
- Rework trust-boundary audit: generic envelope validation can reject identifiable hosted replies before hosted admission. Reuse `parseJsonObject` for unvalidated type/correlation hints, then require the existing contextual hosted codecs to validate the original plaintext. Hints authorize only correlation/retirement, never byte acceptance. Malformed correlated resources/errors must settle once and release assembly, timers and admission capacity; valid fatal authentication/update errors retain precedence. This fixes the MUST FIX finding without changing secrets, storage, Electron isolation, cryptography or network authority.
- Tokens: no new credentials or persistence; existing paired Noise connection owns authentication.
- File/storage: no filesystem/cache output; partial buffers released at every terminal.
- Electron: main-only handles and bytes; no IPC, navigation or window changes. Viewer isolation belongs #1960.
- Cryptography: Node SHA-256 for public integrity digest; unchanged Noise keys/nonces, no secret comparison introduced.
- Network/I/O: existing relay limits/TLS and transport; bounded assembly, credit, queue, controls and two independent deadlines prevent held work blocking dispatch.
- Errors/logs: static categories only; HTTP/body/header/daemon message content never logged.
- Concurrency: per-operation ownership, exact-once settle and generation-bound view handles; automatic re-handshake invalidates handles even when the driver survives.
- Threat alignment: hostile responses fail contextual validation/assembly; relay delay/drop retires work without mutation replay; safeStorage remains unchanged; compromised renderer receives no new authority. Live mutation reconciliation belongs #1929.
**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-15

## Revisions
- 2026-10-15: Regression tests clarified two integration details: connection-fatal authentication/update errors must precede hosted error correlation, and queue promotion must compare the absolute enqueue deadline before sending, including when timer callbacks share a deadline. Incoming progress also checks wall-clock deadlines before resetting inactivity. Contracts and scope remain unchanged. Final written-work recount remains below 800 lines (approximately 650); three production files, three exported declarations and three consumer/test-double updates.
- 2026-10-15: Verifier finding 1 requires terminal validation even before generic envelope admission. Export the existing `parseJsonObject` front-half from `src/main/transport/codec.ts` for routing hints in `onDriverEvent`; `hostedResources.receive` accepts unknown routing fields and validates original bytes through the existing codecs. Nine fake-driver cases (`retires hosted %s with malformed %s before generic admission`) cover metadata/chunks/correlated bridge errors with numeric session tags or null history/clear fields, immediate failure, active/view/16 MiB reservation reuse, discarded valid late replies, timer cleanup and unrelated-message/control processing. Extend the existing fatal-error lifecycle matrix to cover update-required alongside authentication failures. Overlap #1544 still edits separate configuration blocks. Recount: below 800 written lines, four production files, four exported declarations and four simultaneous consumer updates; no new state or failure category.

## Documentation handoff
- Pending documentation stage: update `docs/knowledge/features/wire-codec.md` and `docs/knowledge/features/daemon-connection-lifecycle.md` with the main-only named-host `hostedResources.openView(...).request(...)` and retirement API, pinned ownership, negotiated-capability requirement, queue/assembly bounds, credit pacing, fixed deadlines, cancellation lifecycle and uncertain-mutation behavior.
- Pending documentation stage: replace `docs/knowledge/features/wire-codec.md` § Consumer obligations and testing's statement that resource dispatch integration is unwired; preserve the remaining #1959 readiness/advertisement, #1960 isolated-viewer and #1929 real-acceptance boundaries. Record the generic-decoder rejection lesson after repair.
