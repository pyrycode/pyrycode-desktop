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
