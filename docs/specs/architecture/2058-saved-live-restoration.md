# Saved restoration with same-owner live updates

## Files read

- `src/renderer/src/store/threadItemStore.ts` → `beginLocalRead`, `publish`, `acceptEpoch`, `beginBatch`: current hydration cancels on every publication; batches use lifecycle generations.
- `src/renderer/src/store/savedTimelineRestorer.ts` → `readSavedTimeline`: full `readThread`, exact result coordinates and static diagnostics.
- `src/renderer/src/store/threadRuntime.ts` → `restore`, `sync`, `removeHost`: selected read cancellation and coordinator settlement.
- `src/renderer/src/store/threadQueryCoordinator.ts` → `pump`, `input`: waits for local settlement and resumes from checkpoint; first live additions currently lack an epoch.
- `src/renderer/src/store/chatHistoryWriter.ts` → `captureChange`, `merge`: owned observations alone persist; restored publication must remain unowned.
- `src/main/indexedThreadHistory.ts` → owned progress replay: exact certificates preserve unloaded repair/unfinished obligations.
- `src/shared/chatHistory.ts` → `parseChatHistorySnapshot`: full validation, bounded inert JSON, coordinates and arrival permutation.
- `src/renderer/src/store/daemonItemCache.test.ts`, `e2e/daemon-item-cache.test.ts`, `e2e/thread-activation.spec.ts`, `e2e/fixtures/heldThreadRead.ts`: reuse cache/removal, protected restart and mounted delayed-read fixtures.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, feature topics `thread-item-store.md`, `thread-runtime.md`, `chat-history-testing.md`, `development-verification.md`, and ADR 0014: preserve checkpoint fences, protected owned writes and arrival identity. QMD searched `beginLocalRead`.

## Design source

The ticket references Figma node 102-4. This is a restoration/state fix with no component, layout, style or loading/retry presentation changes; the existing conversation screen is retained.

## Context

Publishing live facts currently invalidates an absent owner's saved read. Saved-only rows then disappear until a server reply. Restoration must merge same-lifecycle facts without claiming a received write or completion. Full requests and full validation stay unchanged. No new ADR is needed.

## Design

Keep the existing public contracts. A private pending-read record owns its one-shot identity and ordered received progress observations. Ordinary initial epoch admission and publication retain that read; explicit reset or replacement of an already held epoch cancels it. A full live addition may establish the first epoch only while a local read is pending; patches without a base still use repair handling after admission.

Completion validates and detaches the complete saved snapshot before merging. Different epochs retain admitted state. Build the item map in saved original arrival order (or supplied held order for older snapshots), then add live-only arrivals. Same-id items retain the greater revision, equal revisions prefer already admitted facts, and incompatible kinds retain received facts with repair. Stable numeric ordering uses this map; timestamps play no role. No-overlap hydration retains supplied held order exactly.

Fold recorded received progress over saved metadata using the existing owned-writer semantics: exact completion intervals alone release saved repair/unfinished work; scalar version/checkpoint cannot bypass a saved fence. Preserve unioned intact ranges and availability at the oldest certified boundary, with false winning equal boundaries. Keep the admitted slice generation so existing same-owner batch handles survive hydration. Publish the final detached immutable snapshot with its restored marker and no owned change. Later received publications still create ordinary owned changes.

Sizing: one independently observable restoration fix; approximately 150 production, 250 test/helper and 85 plan lines (under 800), no new exports, no signature migrations, five acceptance behaviors and at most ten rejection branches. Overlap: #2026 touches cache tests and writer cleanup; its edits are independent of the additive cache cases here, and no writer change is planned.

## State + concurrency model

The private read token outlives ordinary same-owner publications, records only progress while pending and is removed on settlement/cancel. The runtime continues to own read cancellation and query demand; no new task, timer, transport subscription or store slice is introduced. Hydration is synchronous after the awaited IPC result. Cleanup deletes read ownership even when no slice exists.

## State transitions and identity reuse

| Event | Regression proof |
| --- | --- |
| Initial epoch/live admission, lower/equal/higher overlap and live-only arrivals | cache test `merges delayed restoration with admitted revisions and original arrival ties` |
| Saved repair/unfinished plus higher live version, batch certification during read | cache test `preserves saved obligations while folding admitted progress` |
| Cancel, superseding read, same-string reset, epoch replacement, delete/host/global cleanup, reused strings | cache parameterized lifecycle test |
| Missing, empty, failed or rejected read with admitted facts; mismatched saved epoch | cache settlement cases |
| Successful unpair versus failed unpair, equal ids on another host | existing removal fixture extended with pending live admission |
| Fresh protected owner plus overlapping live rows, then subsequent owned save | protected restart regression |
| Mounted local read release while server reply remains held, reconnect/epoch replacement | extended `restore overlapping live content` browser scenario |
| Confirmed deletion/unpair and pending sends/prompts | retained mounted cleanup scenario, included in full fake suite |

## Error handling

Keep typed stored/missing/error results distinct. Missing/failure settles without deleting admitted facts; saved-empty still carries its validated metadata. Invalid full snapshots fail through the existing reader catch/static diagnostic. Incompatible kinds retain live authority and request repair. No content, raw error, saved data or scope text enters logs.

## Testing strategy

Write cache regressions first and observe failure. Reuse protected storage fixture with fresh storage/store ownership to assert no hydration write and subsequent persistence; retain covered-unfinished and arrival-order restart regressions. Extend the existing mounted scripted-thread overlap case with a held server reply and visible saved/live assertions before release. Existing prompt/session/send and confirmed-cleanup cases remain active.

After final main merge, run install, pre-verify (full units), build and the entire original `playwright.config.ts` fake suite on Linux, recording revision/configuration and executed/passed/failed/skipped counts. No live-Claude acceptance; macOS is outside this ticket's scope. Evidence belongs in this plan and the PR, with raw reports under `/tmp/builder-2058/`.

## Open Questions

None. A cleaner shared progress-fold extraction would change the main persistence contract unnecessarily; keep the local fold private and cover its equivalence through protected restart fixtures.

## Security review

**Verdict:** PASS

- **Trust boundaries:** `readSavedTimeline` checks result kind/coordinates; `beginLocalRead.complete` retains full `parseChatHistorySnapshot` validation before any mutation, including aggregate limits and inert own JSON keys. No partial snapshot admission.
- **Tokens/secrets:** read and batch ownership use private Symbols, never coordinate strings. No credential handling changes; main safeStorage remains the at-rest boundary.
- **Files/storage:** no paths, SQL or new storage operations. Existing protected writer alone owns writes; hydration has no owned mutation and cannot erase unloaded history.
- **Electron surface:** no IPC channels, permissions, windows, navigation or remote content changes. The existing narrow bridge returns parsed snapshots; renderer never gains filesystem/key/socket access.
- **Cryptography:** no primitive, key, nonce or Noise changes; existing main encryption remains unchanged.
- **Network/I/O:** no network operation added; runtime uses the existing coordinator deadlines/cancellation and full saved read.
- **Errors/logs:** only existing static event/reason codes; no daemon text, saved payload, secret or raw exception logging.
- **Concurrency:** MUST FIX addressed by design: publication must not cancel a valid same-owner read, while reset/replacement/cleanup must retire its Symbol before reused strings can admit a delayed result. Preserve the admitted generation for active batches; no asynchronous work is detached.
- **Threat model:** hostile saved/IPC data must pass full parser limits; delayed/reordered results cannot change another host or lifecycle. Relay loss uses existing recovery. Disk theft, malicious relay and compromised renderer retain the existing protected main/Noise/isolated bridge boundaries; this change adds no authority to those surfaces.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-16

## Revisions

2026-10-16: The private pending-read token is an object carrying metadata/range/certificate observations, compared by identity, rather than a separate Symbol plus observation table. It retains no item payload history. Batch generations remain Symbols. The implementation fits entirely in `threadItemStore`; the reader and runtime already provide the required full validation, cancellation and coordinator settlement contracts. The mounted overlap fixture now holds the server reply and seeds a saved-only row plus unfinished version 25/checkpoint 20, proving that visible rows and the resumed version cannot come from the reply or applied version.
