# Bounded saved traversal recovery

## Files read

- `src/main/indexedThreadHistory.ts` → `mutablePage`, `readPage`, `sequence`, `tree`: protected generation, authenticated identity/rank selection and transaction ownership.
- `src/shared/chatHistory.ts` → `ChatHistoryRequest`, `threadHistoryCodec.page`: bounded detached bridge admission.
- `src/main/chatHistoryStore.ts` → `run`: serialized saved operations and classified results.
- `src/renderer/src/store/savedTimelineRestorer.ts` → `readSavedTimeline`: cancellable local read.
- `src/renderer/src/store/threadItemStore.ts` → `beginLocalRead`: partial residency, revision/arrival merge and no-write hydration.
- `src/renderer/src/store/threadRuntime.ts` → `demandLocal`: independent coalesced demand/retry, lifecycle publication fences.
- `src/renderer/src/screens/conversation/useThreadScrollPin.ts` → existing visible-row anchoring: recovery retains resident rows.
- `src/renderer/src/store/savedThreadTraversal.test.ts`, `src/main/indexedThreadHistory.test.ts`, `e2e/daemon-item-cache.test.ts`: existing traversal, protected restart and indexed counters.
- `e2e/thread-activation.spec.ts`, `src/main/historyNativeSmoke.ts`: held/offline mounted traversal and packaged encryption proof.
- `docs/knowledge/features/chat-history-api.md` → Bounded authoritative opening and pages; `thread-runtime.md` → Independent saved traversal: shown opening and traversal are distinct.
- `docs/knowledge/features/thread-item-store.md` → Snapshots and completed batches / Certified older paging: saved ranges cannot certify holes or acknowledge reads.
- `docs/knowledge/features/chat-history-testing-restoration.md` → Restoration; `chat-history-testing-native.md` → Native runtime and packaged proof: reuse existing positive barriers, counters and native fixtures.
- `docs/knowledge/decisions/0014-authenticated-owned-thread-mutations.md`: mutations rotate generation; authenticated indexes remain the selection authority.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

Design context and screenshot read using figma-design-to-code. Preserve the fixed sidebar, filling conversation pane, message rows, footer, and existing token-based loading/retry presentation. No visual component or styling changes.

## Context

Every owned commit invalidates held-rank continuations. Resuming by a boundary's current rank alone misses unvisited identities moved across that boundary. Recovery therefore needs an identity-based pass, independently of mutable held positions. No new writer or network authority is introduced. An ADR may be useful for the separate protected recovery capability; documentation owns that decision record.

## Design

Extend page admission with an optional opaque recovery capability and `beforeThreadPage` with an optional capability echo. Ordinary continuations retain strict generation validation. A capability binds the exact previous continuation to the stable protected scope owner, epoch and boundary identity. It authorizes a newly authenticated current selection only after that exact continuation's generation invalidates. Malformed tokens, mismatched capabilities, wrong scopes and lifecycle changes reject; a generic error never starts recovery.

On invalidation, select a bounded identity window immediately below the retained boundary through the authenticated id radix tree. Continue a circular identity pass: below the boundary first, then the remaining identities above it. Each selected page is returned in authenticated held order with its original sparse arrival positions. Selection order is private traversal state, not display order or daemon `before_order`. This visits moved/hidden/unordered identities and handles a removed boundary without seeking from newest or replaying loaded depth to find it. Already resident identities merge normally and never create duplicate rows. If another generation invalidates the pass, rebase a fresh bounded circular pass around its current boundary; after writes settle a complete pass reaches every remaining saved identity.

The recovery continuation itself is generation-bound. Its separate capability can rebase it; neither token is daemon completeness evidence. Fresh unchanged normal/recovery tokens survive reopen. Same-epoch replacement retains the owner and can convert its retained representation once; epoch-changing replacement receives a new owner so returning to the same epoch string cannot revive capabilities. Owned reset/deletion already replace/remove the owner.

Keep the capability in residency beside the traversal token and pass it only with traversal demand. Opening remains shown-only and separate. `readSavedTimeline` makes one request; there is no read-error retry loop. Reuse existing revision/admitted-tie/optional-clear/progress merging, cancellation, local pending/error and explicit Retry precedence. No coverage, checkpoint, older availability, repair or read acknowledgement is inferred from local selection/exhaustion.

In-flight overlap: #2026 removes legacy entries in `chatHistory.ts`; recovery additions remain local and additive to authoritative admission.

## State + concurrency model

One selected local job and item-store generation own admission and failure. Selection/rebase/continuation minting share one synchronous storage transaction with the existing serialized owner. Writes cannot invalidate between its selection and token minting. Later writes invalidate the next token normally. No new listener, timer or async owner.

**Attempt/work bound:** one IPC call and one synchronous selection attempt per user demand, at most 200 selected identities plus the existing relevant range evidence. Authenticated id lookup and at most 200 sequence rank proofs have logarithmic structure work; selected payload decrypts do not grow with loaded depth or unrelated history. One-time retained conversion is measured separately. There are no automatic retries. Failure retains valid resident content; explicit Retry starts one new bounded attempt. Repeated input still coalesces.

## State transitions and identity reuse

| Event | Planned coverage |
| --- | --- |
| Metadata-only invalidation at increasing depth; fresh reopen | indexed protected recovery regression and counters |
| Order/revision movement, boundary removal, same-epoch replacement | protected restart exact-identity/content regression |
| Repeated invalidation, settled writes, explicit Retry | saved traversal runtime/protected regressions |
| Local page overlapping newest/network/live facts | existing sparse-arrival/revision/clear merge test extended for recovery capability |
| Navigation/reset/epoch/deletion/unpair/teardown with reused strings | existing held-page success/failure lifecycle matrix plus protected capability scope tests |
| Held/failed network and offline demand, fragmented ranges | existing runtime matrix and mounted held/offline fixture extended with invalidation |
| Boundary removal with surviving visible row | mounted traversal offset assertion |

## Error handling

Unavailable encryption, malformed/mismatched tokens, disk corruption and IPC failures retain existing content-free classifications. Recovery occurs only inside validated page selection, never after a generic failure. Missing current owner, epoch mismatch or invalid proof rejects without admission or retry. Existing static storage/restore lifecycle/result logs suffice; do not log capabilities, coordinates or content.

## Testing strategy

Write failing protected recovery and runtime capability tests first. Extend existing restart/counter fixtures for exact identities and payloads, metadata/revision/order/replacement/removal, scope fencing, constant selected work at growing depths and unrelated history, and fresh-owner reuse. Extend mounted scripted held/offline traversal and packaged production-encryption fixture using their existing setup/barriers. Preserve saved unread and completeness assertions. Run Linux units/pre-verify after final main merge, build, complete configured fake/client suite and packaged proof. Record exact revision, counts, fixture sizes, conversion/cold-opening/recovery timings and artifacts; other OS is outside scope.

## Open Questions

None. A separate capability plus bounded identity pass avoids trusting stale held ranks or an unbounded resident inventory; recovery is not implemented by reopening newest.

Sizing: one deliverable; forecast 245 production + 390 test/helper + 100 plan/log lines = 735 written lines, no more than 3 new exported abstractions, 8 simultaneous consumer updates, five criteria, 8 reject branches.

## Security review

**Verdict:** PASS

- [Trust boundaries] `parseChatHistoryRequest` detaches/allowlists the optional opaque capability; main authenticates it and current scope before selecting. `threadHistoryCodec.page` validates returned facts/capability.
- [Tokens/secrets] Capabilities use existing OS-backed `SecretEncryption`; remain memory-only in renderer, bounded to the existing token limit, never logged. Exact continuation binding prevents an ordinary malformed token from requesting recovery.
- [Storage] Existing database transaction/owner and authenticated id/sequence/range proofs; no new path, plaintext persistence or writer. Unavailable protection fails closed.
- [Electron surface] Existing saved-host-authorized fixed bridge only; no Node primitive, channel, remote content, navigation or window-security change.
- [Cryptography] Reuse existing encryption and SHA-256 binding, no cipher/Noise/randomness change. Capability scope coordinates are authenticated identifiers, not secret equality comparisons.
- [Network/I/O] No network request, socket or timeout added. The coordinator retains sole paging/catch-up authority. A held relay cannot prevent local selection.
- [Errors/logs] Static storage/restore codes only, no content, raw exceptions, tokens, keys or decrypted bytes.
- [Concurrency] MUST FIX addressed in design: same-string epoch round trips cannot revive a capability; epoch-changing replacement receives a new owner. Renderer private read token and generation fence late success/failure after cancellation/reset/removal.
- [Threat model] Malicious saved input must authenticate against current roots; compromised renderer can request only bounded authorized saved projections. Delaying relay cannot certify completeness. Existing Noise and safeStorage protect transport and disk secrets; neither changes.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-16

## Revisions

2026-10-16: Same-epoch full replacement of an indexed scope rebuilds its authenticated indexes inside the existing full replacement transaction. Recovery consequently does not pay full-snapshot conversion after replacement. Full reads preserve optional arrival metadata exactly; bounded mutable pages always expose their authenticated placement arrival positions, including positions synthesized by the existing conversion. Owned mutations publish arrival metadata once they use those positions. The initial retained-scope opening conversion remains separately measured. Correction to Files read: `useThreadScrollPin` is in `src/renderer/src/screens/conversation/ConversationScreen.tsx`, not a separate file.

Final lifecycle coverage names: `rebases protected traversal after %s without losing moved identities`; `cold opening payload work stays bounded as unrelated older, hidden and range history grows` (depths 1/4/8, metadata and replacement); `bounds each demand during repeated invalidation and completes the identity pass once writes settle`; `rejects recovery capability substitution, wrong scopes and %s recreation` (epoch round trip/reset/delete/unpair); `echoes only the traversal recovery capability and retries classified failures without spinning`; existing held-page success and delayed local-error cleanup matrices; `fresh protected traversal reaches every fragmented saved identity including opening omissions without writes (invalidation %s)`; `invalidated saved traversal scrolls independently offline` / `invalidated saved traversal scrolls independently while server reply is held`; packaged `saved-recovery` stage. The mounted invalidation removes boundary 50 while anchoring surviving row 51. No hydration write, network-page or read-ack assertion was removed.

## Validation evidence

Linux x64, 2026-10-16; implementation `823b6dd2daca7e079d0237153956fd2d09bda786`, merged main `e9efdce960f2c736791d51f3def01ae3486445a3`. Final pre-verify passes all five checks: 400 files, 9,240 tests passed, zero failed, 3 existing opt-in skips (`/tmp/builder-2064/pre-verify-final.log`). Build passes (`/tmp/builder-2064/build-final.log`). Electron adapter preparation passes (`/tmp/builder-2064/electron-rebuild.log`). Other operating systems and live Claude are outside scope.

The first pre-verify failed six existing schema migration assertions because replacement's new header inspection also ran during schema-5 conversion. Restricting inspection to a validated prior snapshot fixes the cause; the seven selected migration cases pass, then the complete final gate passes. Preserve the original failed capture at `/tmp/builder-2064/pre-verify.log`. Initial sandbox installation also failed on esbuild execution permission; approved installation succeeded before the final checks.

Protected restart compares all 650 saved identities/content and resident uniqueness after fresh offline reopen and invalidation, retaining both fragmented ranges and no hydration writes. The indexed fixture separates selected work from authenticated structure and initial conversion:

| Items | Loaded depth in 20-item pages | Replacement | Selected payloads / records / decrypts | Structure reads | Recovery ms |
| ---: | ---: | --- | --- | ---: | ---: |
| 262 | 1 | no | 20 / 23 / 45 | 322 | 38.4 |
| 262 | 4 | yes | 20 / 23 / 45 | 320 | 31.1 |
| 262 | 8 | no | 20 / 23 / 45 | 319 | 31.5 |
| 1,242 | 1 | no | 20 / 22 / 44 | 361 | 63.1 |
| 1,242 | 4 | yes | 20 / 22 / 44 | 365 | 59.3 |
| 1,242 | 8 | no | 20 / 22 / 44 | 365 | 74.7 |

Cold opening: 239.9 / 491.6 ms for 262 / 1,242 items; initial conversion: 2,591.5 / 11,768.9 ms. Both opening sizes retain 206 selected records, 202 payloads and 408 decrypts; structure grows from 1,583 to 1,992 reads. The existing 200-item traversal assertions also pass. These are bounded-work measurements, not a latency threshold.

Packaged production-encryption proof: `/tmp/pyry-history-native-JGXDxb/runtime.stdout` and `runtime.stderr` inspected. Linux x64, Electron 33.4.11 / embedded Node 20.18.3 / adapter 12.4.1, production `gnome_libsecret`; packaged/ASAR/unpacked true, stage complete, 1 executed/passed, zero failed/skipped. All 801 saved identities/content recovered after invalidation and fresh reopen in 709 ms. Initial opening conversion 7,001 ms, cold opening 197 ms; retained 100,000-membership replacement 10,314 ms. Raw stderr retains system-bus/GPU/colour diagnostics alongside successful counted completion.

Both 1100×773 recovery captures inspected: `/tmp/builder-2064/fake-results/thread-activation-invalida-f1fc4-rolls-independently-offline-parallel/saved-traversal-held.png` and `/tmp/builder-2064/fake-results/thread-activation-invalida-7340f--while-server-reply-is-held-parallel/saved-traversal-held.png`. Existing sidebar, pane, message styling, footer and notices retained, with no in-scope visual change. Boundary-removal viewport-offset and zero extra network-page/read-ack assertions precede capture. Docs guard passes (`/tmp/builder-2064/docs-guard.log`).

Complete original configured fake/client suite on implementation `823b6dd2`: 468 executed, 468 passed, zero failed/flaky/retries, 4 existing skips. Both configured projects (`clipboard`, `parallel`), original two workers, zero filters; 855.8 seconds. Report `/tmp/builder-2064/fake-suite.json`, stderr `/tmp/builder-2064/fake-suite.stderr`; global errors and fake-daemon-setup attachments empty. Both unchanged and both new invalidated held/offline traversal cases are explicitly present/passed (4/4); packaged storage is explicitly present/passed (1/1, included in the total). Skips are the two macOS badge cases, macOS window reopen, and the existing system-prompt reset fixme. No new assertion was skipped. All checks required by this builder are complete; later-stage verification remains dispatcher-owned.

Captured clients included above: 28 executed/passed, zero failed, one existing reset fixme skipped. The completed runner exited zero; no Electron or Playwright worker remains after teardown. Evidence-only plan updates after the checked implementation do not change production or test source.
