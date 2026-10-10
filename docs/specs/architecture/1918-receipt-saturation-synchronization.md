# Receipt saturation test synchronization

## Files read

- `e2e/chat-history-recording.spec.ts` → receipt saturation scenario and `observeCommands`: protected-profile relaunch proof and existing command observation.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: profile reuse reconnects to the first launch's still-running fake; the second launch's fake is unused.
- `src/renderer/src/store/newestHistoryDemand.ts` → `createNewestHistoryDemand`: navigation/connection demand defers behind local restoration and outstanding requests.
- `src/renderer/src/store/historyPageBridge.ts` → `requestHistoryPage`, `useHistoryPageBridge`: focus creates no demand; receipt admission precedes writer capture.
- `src/renderer/src/store/chatHistoryWriter.ts` → `createChatHistoryWriter`: metadata-only changes capture and coalesce on a 200 ms timer.
- `src/renderer/src/PairedShell.tsx` → `PairedShell`: releases deferred demand after restoration/receipt admission using a microtask.
- `docs/knowledge/features/chat-history.md` → Served provenance and page suppression / Buffered replacements: preserve oldest coverage independently of newest receipt and observe real saves.
- `docs/knowledge/features/chat-history-testing.md` → Browser persistence and lifecycle: restored rows alone do not prove new receipt settlement.
- `docs/knowledge/features/development-verification-history.md` → Served-page persistence verification: preserve saturation, display and allocation proofs.
- `docs/knowledge/features/development-verification.md`, root `CLAUDE.md`, `docs/knowledge/INDEX.md`: verification boundaries and repository conventions.

## Change

Synchronize the named test with its second-launch newest history operation before starting its protected-save equality assertion. Install test-local observation before opening the saved conversation, observe the actual newest request and matching repeat receipt, then assert the existing complete saved snapshot. Remove the focus step, which requests no history. Use the fake reply callback for controlled boundary diagnosis: withhold the second-launch reply, prove restored assistant and enabled Send coexist with the unchanged saturated saved record, then release the correlated reply. Keep all existing saturation, eviction, coverage, assistant count/identity, later live row allocation and third-process equality checks. No production, layout, wire or shared fixture change is planned. No overlapping in-flight feature branch touches the test.

The original verifier failure at `f1ada1b9df` left the seeded receipts on disk at the five-second predicate deadline (16,870 ms test duration); its focused rerun passed in 9,360 ms. These logs do not alone identify whether request, restoration or save was delayed. Controlled request/receipt evidence will establish the synchronization gap and be reported on the issue; do not claim an unobserved product defect.

Sizing: one independently verifiable behavior, three acceptance criteria, approximately 120 written lines including this plan and diagnostics, no new exported symbols or consumer migrations, no production failure branches.

## Testing strategy

- Before the fix, run the existing equality assertion with the repeat response withheld after a confirmed newest request: it must fail with the original seeded snapshot despite both UI readiness checks succeeding.
- After the fix, wait for the correlated receipt, then poll real protected storage for the full unchanged expected snapshot; no direct store writes, fixed sleeps or test retries.
- Run the named test ten consecutive times with `--repeat-each=10 --workers=1 --retries=0`; record executed/pass/failure/skip counts and logs.
- Run the complete `e2e/chat-history-recording.spec.ts` with retries disabled; only existing platform skips are allowed.
- After merging final `origin/main`, run the pre-verify check and `npm run build`. The dispatcher owns the full verifier gate.

## Revisions

2026-10-10: The controlled held-reply diagnostic observed exactly one newest request (`cursor: ''`, limit 200), completed restored-row/Send checks, and read the unchanged saturated seed before the original five-second equality predicate failed. Adding the receipt barrier and releasing that same correlated reply passed (1 executed, 1 passed). Evidence: `/tmp/builder-1918/held-reply-before-fix.log` and `/tmp/builder-1918/held-reply-after-fix.log`. This establishes the missing receipt boundary in the test, without identifying an unlogged transport delay in the original occurrence or demonstrating a product defect. The final test keeps the original immediate fake reply timing; holding/releasing was diagnostic only, so it cannot hide a restoration overlap. It installs a host/conversation/cursor-specific receipt listener before navigation, awaits delivery with the existing 20-second connection-operation budget, verifies exactly one newest command via `observeCommands`, and retains the original five-second full protected-save equality assertion.
