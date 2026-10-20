# Last-row thumbnail ownership

## Files read

- `e2e/thread-scroll-pin.spec.ts` → `sendWithThumbnail`, `withheldThumbnails`, `thumbnailBubble`, `rowPosition`, `isLastRow`, `resolveThumbnail`: optimistic presence differs from authoritative publication; preserve all image and geometry assertions.
- `playwright.config.ts` → native-writer dependency and normal worker/project selection.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, `development-verification.md`, `development-verification-layout-and-input.md` → mounted proof boundaries and prior thumbnail controls.
- `docs/knowledge/features/conversation-shell-scroll-pin.md` → resize-driven bottom following.
- `docs/specs/architecture/2183-thumbnail-reader-setup.md` → merged numeric-row barrier and separate parked-reader repair.

## Context

One test-only behaviour: measure the committed last thumbnail row in its active thread before releasing image bytes. Historical #2186 failed in `rowPosition`; its unrecorded schedule remains unknown. Evaluate the merged #2183 barrier rather than duplicate it. No production changes, documentation requirement or ADR.

## Design

Add a spec-local optional held-message-echo seam to the existing withheld-thumbnail fake. In the exact last-row case, observe the optimistic bubble while its echo is held, release the correlated normal echo, and let the existing `sendWithThumbnail` numeric-row barrier complete. Retain the old element handle only for diagnostic identity observations; geometry uses the fresh locator after publication. Assert connected ownership, a numeric direct-child identity and final-child membership before image release. Attach content-free before/after identity and geometry observations. The two other thumbnail cases use unchanged default fixture behaviour.

Use a controlled stale-handle geometry inspection to demonstrate whether publication removes ownership. If confirmed, retain the same intervention with fresh authoritative geometry. This establishes a boundary, not historical attribution. Prefer the current single helper over another readiness abstraction.

Sizing before/after plan: one deliverable, approximately 230 total written lines including evidence; no production files, exported abstractions, consumer migrations or new error-state branches; three acceptance criteria. Remote feature-branch overlap scan found no unmerged changes to this spec.

## State + concurrency model

Only per-test held echo/request state and an element handle. Release the echo once through the fake daemon, await the send helper, dispose the diagnostic handle, and use fixture teardown for app/daemon cleanup. Image bytes remain withheld independently. No application lifecycle changes.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Optimistic send becomes authoritative row | Exact last-row case: held echo, old/new ownership observations and numeric identity |
| Thumbnail request is repeated after remount | Existing request map retains latest correlated request; exact case decodes released image |
| Intrinsic last-row growth | Existing 200px intrinsic width, 160px drawn height, 172px growth floor and bottom tolerance |
| Attachment IDs recur across isolated applications | Complete scroll spec; per-test fake state |

## Error handling

Keep bounded Playwright failures and ownership exceptions visible. No sleeps, retries, skips, swallowed errors or deadline changes. A production defect outside the test boundary requires refinement.

## Testing strategy

- First run controlled stale ownership inspection, retain its report and exact source outside the worktree; then run the same schedule with authoritative locator geometry.
- Run ten consecutive retry-disabled Linux invocations of the exact named case, retaining native-writer prerequisite; run the full scroll spec with unchanged configuration.
- Merge final main, run pre-verify against `threadScrollPosition.test.ts`, build, and run the changed browser case on that final tree. Preserve commands, stdout/stderr, reports, build/source hashes and counted results under `/tmp/builder-2188/`.
- Complete configured application suite including recorded clients belongs to verifier/dispatcher, who must identify this case's outcome. No fresh provider acceptance; other operating systems are outside scope.

## Open Questions

- Does the controlled optimistic-to-authoritative publication detach the observed bubble, and does the existing barrier suffice? Record observations before PR.

## Revisions

2026-10-20: The controlled held-echo schedule confirms replacement: the optimistic bubble was connected inside the thread without a numeric read-row; after the existing publication barrier completed, that exact element was disconnected with no thread ancestor. Inspecting its ancestor with the original ownership guard threw `the bubble is not inside a thread scroll region`. The native-writer prerequisite passed; the named control failed at that guard (2 executed, 1 passed, 1 failed, no skips/retries/report errors). App teardown exited 0 without failures. This demonstrates a controlled stale-node boundary, not the unrecorded historical schedule.

Reuse the merged barrier unchanged. The named case now also asserts the retired-node observation and the fresh bubble's connected membership in the active thread, numeric direct-child identity and final-child membership, with no image yet present. Its original overlapping-row, bottom, decode, drawn-height and growth assertions remain. A local callback after optimistic presence releases the held echo; defaults preserve the other two cases. No duplicate readiness implementation or product repair is needed. Question resolved; final passing evidence follows below.
