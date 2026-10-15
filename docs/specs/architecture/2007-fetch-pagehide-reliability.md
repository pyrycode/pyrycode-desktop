# Fetch pagehide test reliability

## Files read
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: merged #2001 repair selects conversations strictly and retains the Send-enabled handshake gate.
- `e2e/hosted-app-view.spec.ts` → `scenario`, bulk cancellation cases: initial discovery advertises a running app; eight reads and queued POST are fenced through cancellation and successor completion.
- `docs/knowledge/features/daemon-connection-hosted-resource-views.md` → Fetch verification: retain atomic cancellation, late replies and positive processing barriers.
- `docs/knowledge/decisions/0012-hosted-app-native-isolation.md` → cancellation ownership: document cancellation precedes queue promotion.
- `docs/knowledge/features/development-verification-evidence-that-cannot-pass-too-early.md`: require positive receipt before absence assertions.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, `docs/knowledge/features/development-verification.md`: repository and evidence conventions.

## Change
Reuse #2001's selector repair already merged at `cba79876`. In the fetch-pagehide case, explicitly observe the initially discovered app row after launch, ensuring the cancellation proof retains concurrent app discovery. No production, queue, timeout, retry or handshake changes. In-flight #1983 only adds independent launch diagnostics; this change stays local to the hosted-view spec.

## Testing strategy
- Diagnose with retained #2001 evidence and distinguish its missing original stack from a controlled reproduction.
- Temporarily wait for the app row before the fixture click, then restore only the old unfiltered selector: the named case must fail with two strict-mode targets before cancellation runs. With the merged selector and the same forced ordering, it must pass. Remove diagnostic changes afterwards.
- Add the explicit discovery assertion first and run the controlled failure before final validation.
- Run ten independent Linux invocations of the exact fetch-pagehide case with zero retries, then the complete hosted-view spec. Preserve eight active reads, queued POST/enqueue barrier, cancellation replies, late frames, completed successor GET and zero dispatched POSTs.
- After merging final main, run pre-verify and build. Record revisions, commands and executed/failed/skipped counts here and on the issue. No live or visual change is involved.

Size: one verification deliverable, about 60 written lines, zero production files, exports, consumer migrations or new state/error branches; two observable acceptance criteria.
