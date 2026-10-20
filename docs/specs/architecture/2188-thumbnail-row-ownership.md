# Last-row thumbnail ownership

## Files read

- `e2e/thread-scroll-pin.spec.ts` → `sendWithThumbnail`, `withheldThumbnails`, `thumbnailBubble`, `rowPosition`, `isLastRow`, `resolveThumbnail`: optimistic presence differs from authoritative publication; preserve all image and geometry assertions.
- `playwright.config.ts` → native-writer dependency and normal worker/project selection.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, `docs/knowledge/features/development-verification.md`, `docs/knowledge/features/development-verification-layout-and-input.md` → mounted proof boundaries and prior thumbnail controls.
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

## Validation evidence — 2026-10-20

Linux x86_64, kernel `7.0.0-28-generic`, Node `25.8.0`, Electron `33.4.11`, isolated Xvfb. Final merge reported main `3fd12cc640d4934d46901803e7130570bb97ab50` already current. Build provenance identifies clean implementation `655d229bc89497db6342de9ba7e63872009021a9`, normal profile; subsequent changes are plan evidence only. All retained artifacts below are under `/tmp/builder-2188/`.

| Run | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Controlled stale optimistic ownership, `control.json` | 2 | 1 | 1 | 0 |
| Ten consecutive invocations, `focused-1.json` through `focused-10.json` | 20 | 20 | 0 | 0 |
| Complete scroll spec, `scroll-spec.json` | 23 | 23 | 0 | 0 |
| Pre-verify affected unit file | 15 | 15 | 0 | 0 |

Every focused invocation executed the exact named last-row case once and native writer once. Full-file acceptance executed all 22 scroll cases plus native writer; all three thumbnail scenarios passed. All browser reports retain three normally configured workers, one effective execution slot due to dependency/file ordering, zero retries/flaky results and zero report errors. No skips or skip reasons. Every launch-fate attachment reports exit 0, no signal and no teardown failures, including the failed control.

All ten focused reports observe the same replacement: the held-echo optimistic node is connected in the thread without an authoritative read-row, then disconnected outside the thread; its replacement is connected in the active thread as numeric direct-child/final-child row `122`. Every image-release measurement grew content 3081 → 3253, scrollTop 2348 → 2520, viewport 733: growth 172px and bottom distance 0. Existing assertions also passed intrinsic width 200px, drawn height 160px, overflowing-thread, bottom-resting and overlapping-row preconditions. No intervening send, unrelated frame or manual scroll follows image release.

The control uses the same held-echo schedule and inspects the stale element after publication, reproducing the ownership exception before image release. Its exact source is `control.spec.ts`; it is deliberately separate from the repaired `final.spec.ts`. This proves the controlled ownership boundary; the historical failure remains failed and its exact schedule is unknown. The merged barrier suffices for this controlled boundary, so no replacement readiness implementation was added.

Commands (run names `control`, `focused-1` through `focused-10`; separate stdout/stderr and result directories per invocation):

```sh
PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-2188/<run>.json npx playwright test e2e/thread-scroll-pin.spec.ts --grep 'a thumbnail resolving in the last row leaves a bottom-resting reader at the bottom' --retries 0 --reporter=list,json --output /tmp/builder-2188/<run>-results
```

The complete spec uses the same command without `--grep`, named `scroll-spec`. `run-evidence.py` retains exact argv/environment naming, and each `<run>.command.json`, `<run>.stdout`, `<run>.stderr`, report and results directory remains available. `summary.json` independently checks actual result statuses, exact named-case presence, zero retries/report errors and retained ownership/growth/launch attachments. Its SHA-256 is `aa4d0267e9eb2d54253f5028f926526d80bf42c086d44d662256c2695f4c2671`; it contains every report hash. Control report SHA-256: `6af09c513633d7b49e0d91f0cc16056004da06210f4a7d38bcf15a662e3aacce`; full spec: `bea0e7ffe1c0652703a8bffd7fe37639de3e5861c6344b070d8f4dcf7c229c18`. Final spec SHA-256: `62b578c5b3f1acf6f364f63e2760edbe657e85ad683535bdfe01bf7b0a513bdb`.

`final-build-provenance.json` and `final-build.sha256` retain source/profile and output identity; output hashes were rechecked after all browser runs. `pre-verify.stdout` records all five checks passing after the final main merge, including label read, typecheck and the 15-test affected unit file; `unit-final/` retains structured evidence. `build-final.stdout`/`.stderr` and `check-docs.stdout`/`.stderr` passed. Native preparation used `npm run rebuild:electron` after the Node unit gate. Initial sandbox install/build attempts hit subprocess EPERM, and an early pre-verify before Electron installation executed no unit tests; these are environment failures, not passing acceptance. Approved installation/preparation and the completed gates supersede those attempts.

Historical #2186 builder bundle `41ec6d78fec01379336165c0efca9bc51b8b96f7aed07e3137322509639a0ff5` was retrieved into `historical-2186/`; all three checksums verified. It contains logs/metadata and empty pointers, not raw browser artifacts. The refinement comment retains the original failure's source/report provenance. No unchanged-tree baseline attribution is claimed.

Handoff: verifier/dispatcher must run the complete configured application suite, including captured clients, and identify this exact case's result. Builder has not claimed that gate passed. No fresh provider/daemon acceptance is required. Other operating systems are outside this Linux ticket's scope. No documentation requirement is pending. Final scope remains one test-only behaviour, below all numeric ceilings; the transition table was rechecked against the final diff.
