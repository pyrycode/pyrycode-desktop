# #1970 — diagnose and repair the reader reopen flake

## Files read

- `CLAUDE.md` and `docs/knowledge/INDEX.md`: process boundaries and verification map.
- `docs/knowledge/features/conversation-shell-markdown-reader.md` → Pane wiring: every open fetches current content; Back preserves the covered thread.
- `docs/knowledge/features/development-verification.md` → Source and contract checks: attribute failures using evidence, not unchanged green runs.
- `docs/knowledge/features/development-verification-layout-and-input.md` → Layout and input: native resize/zoom requires renderer reflow; preserve overlap and interaction checks.
- `e2e/markdown-reader-menu.spec.ts` → `readReply`, `buildReplyFrames`, layout scenarios: mutable synthetic host state and the failing final reopen.
- `e2e/markdown-reader.spec.ts` → `readReply`, existing open/back scenario: fresh-fetch regression and attachment preservation.
- `src/renderer/src/screens/conversation/MarkdownReader.tsx` → `useMarkdownReader`, `MarkdownReaderView`: fresh request keys, outcome subscription and closed/loading/loaded state.
- `src/main/workspaceFileRead.ts` → `createWorkspaceFileRead`: one correlated terminal per read, no cache or coalescing.
- `src/main/transport/fakeDaemon.ts` → `startFakeDaemon`: synchronous reply builder, ordered encrypted reply frames.
- `playwright.config.ts` and `e2e/fixtures/launchPairedApp.ts`: worker/clipboard partition and isolated Electron launches.

## Context

The #1964 verifier at `58caf4cd0c` recorded 394 passed, 1 failed and 3 skipped with four workers and zero retries. The 800px scenario failed after pointer Back at the final heading visibility check (5,000ms); the 1280px sibling passed. An unchanged targeted 800px rerun passed (1 executed, retry 0). The refinement comment links the original logs; its missing snapshot cannot be inspected. These observations locate the transition but do not establish its cause.

One deliverable: diagnose and repair that transition with retained causal evidence. Expected written work is under 300 lines, no new production exports or consumer migrations, three observable acceptance criteria and no new production reject branches. Remote feature branches were fetched and checked: none overlaps the anticipated spec or reader file.

## Design

First instrument the local scenario's final reopen to distinguish pointer delivery, fresh read receipt, served reply and renderer outcome. Establish a controlled failing case for the diagnosed boundary before repairing it. Keep diagnostics local to this spec rather than changing the shared harness.

Repair the local test setup if the evidence identifies a setup race. Change `useMarkdownReader` only if a product defect is demonstrated; a renderer change requires reading the ticket's Figma node before designing it. No visual change is currently planned.

The final scenario must prove a new read and new note content (Plan version 3), not merely an existing heading. Preserve native 800×600 and 1280×800, resize/zoom, dynamic clearance, positive text/control overlap, copy/menu input, pointer Back, keyboard Back, draft/thread position and injected external-open/save failures. No retries, sleeps, relaxed checks or increased timeouts.

## State + concurrency model

Production remains closed/loading/loaded with a fresh request key per open or refresh. Back closes and invalidates the pending diagnostic key; late outcomes are reducer-gated. The existing screen subscription cleans up on unmount. Local host controls and causal probes must belong to the scenario that owns them; teardown remains with `launchPairedApp`.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| First read of the note | Both named layout cases assert Plan version 1. |
| Broken refresh then successful refresh of the same path | Both layout cases keep old content on failure and assert Plan version 2 after success. |
| Pointer Back then reopen of the same note | Both layout cases preserve draft/thread position and assert a fresh read and Plan version 3. |
| Keyboard Back after reopen | Both layout cases focus Back, press Enter and assert reader removal. |
| Native resize and zoom back to original dimensions | Both layout cases retain reflow barriers, clearance, endpoint, overlap and input checks. |

## Error handling

Keep the existing deliberately mismatched digest refresh and injected external-open/save refusals. Diagnostics distinguish missing input/read from read failure. No new product failure handling is planned.

## Testing strategy

- Run a controlled failing case for the diagnosed boundary and retain the report and diagnostic evidence under `/tmp/builder-1970/`.
- Run each named native layout case ten times with four configured workers and zero retries; inspect counts (20 executed/passed, none failed/skipped/flaky).
- Run complete `markdown-reader-menu.spec.ts` and `markdown-reader.spec.ts` and retain their reports.
- After final merge of main, run pre-verify and `npm run build`; dispatcher owns the full fake-transport suite.
- Use approved outside-sandbox Electron execution. No live tests or documentation changes are requested.

## Open Questions

- Which boundary fails: input delivery, synthetic reply setup or reader outcome handling? Resolve with a focused reproduction or controlled failing case and record the result in Revisions before handoff.
- Does repair require production code? Resolve from the causal evidence; stop for missing Figma access if a renderer correction becomes necessary.

## Revisions

### 2026-10-15 — controlled input race; test-only repair

Both questions are resolved. `readReply`, `buildReplyFrames` and `useMarkdownReader` behave correctly when the link receives the click. The failing boundary is test input delivered against geometry measured before hover reveals `.bubble__meta--details`. The thread's existing growth observer then pins to the new bottom and moves the link. No production or visual change is needed, so the conditional Figma read does not apply.

Controlled 800px evidence: after pointer Back, record the link center, move the real pointer there, let two animation frames expose the queued layout motion, and click the recorded center. The link moved from y=372 to y=344; scrollTop grew from 1461 to 1489. `elementFromPoint` and pointer down/up/click all named the timestamp span. The host received only requests 9, 10 and 11, no final read; the reader count was zero and its heading assertion failed after the unchanged 5,000ms timeout. This directly reproduces the missing-heading failure mechanism. The unavailable original snapshot prevents claiming its exact event sequence was inspected; the original gate/rerun remain observations consistent with this mechanism.

A preceding controlled attempt also exposed a baseline race: the immediate first-open scroll snapshot was 1489 but pointer Back returned 1461. The snapshot retained focus-revealed reply metadata that later reader-menu focus collapsed. Settle the intended focus state before recording the preservation baseline.

New contract: focus Back after the first loaded note, then record thread position after 20 consecutive equal animation-frame samples of scroll offset/content height/viewport height and link bounds. Before the final pointer click, focus the link to hold metadata open and require the same geometry barrier. The helper rejects after 120 sampled frames; it contains no fixed sleep, click retry or timeout increase. Keep the original exact thread-position assertion before preparing the new click. Assert Plan version 3, exactly one new host read and unique request IDs, then close using keyboard Back. Attach synthetic request/reader diagnostics to the scenario's Playwright report.

The identical controlled pointer sequence after this repair held y=344 before/after, hit the link button, received fresh request 12 and rendered Plan version 3: 1 executed/passed, none failed/skipped/flaky. Temporary control code was removed; patches and reports remain under `/tmp/builder-1970/` (`controlled-failure.patch`, `stale-pointer-normalized.json`, `controlled-repair.patch`, `controlled-repair.json` and their result directories). Two diagnostic repeat runs each passed 20/20; those green runs alone were not used to establish the cause.

Final scope remains one spec and this plan: no new exports, production state, consumer migrations, dependencies or reject branches. The controlled failure and repair use the existing synthetic transport; no external repair or blocker is required.

### Final validation after main merge

Final main merge contains `0057a0afe824` (#1969's startup-hook ordering change; no dependency on this scenario). Pre-verify passed all five checks: 402 unit files, 10,178 tests passed and three existing skips. `npm run build` passed.

`final-repeat.json`: both exact layout titles repeated ten times, 20 executed/passed, zero failed/skipped/flaky, retry 0 throughout, four actual workers. A retained repeat-only scratch config removes the clipboard project's one-worker cap for these two write-only layout cases; no clipboard-reading scenario is included and the repository config is unchanged. `reader-specs.json`: complete `markdown-reader-menu.spec.ts` (3/3) and `markdown-reader.spec.ts` (1/1), four executed/passed, zero failed/skipped/flaky, retry 0 throughout. Logs and result directories are retained alongside those reports under `/tmp/builder-1970/`. Dispatcher owns the pending full-suite gate.
