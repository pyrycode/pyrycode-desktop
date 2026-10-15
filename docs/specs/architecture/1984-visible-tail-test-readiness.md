# Visible-tail test readiness

## Files read
- `e2e/visible-tail-read.spec.ts` → `instrumentReadWork`, `focus`, `settle`: existing instrumentation and all eight legacy read scenarios.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: `onLaunched` precedes pairing and runs immediately after `firstWindow`.
- `e2e/fixtures/desktopIsolation.ts` → `launchIsolatedApp`: launch lifetime and cleanup ownership.
- `src/renderer/src/store/conversationReadPublisher.ts` → `useReadObservation`, `readTargetFor`: committed identity, geometry and focus gates.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`: repository boundaries and reading map.
- `docs/knowledge/features/conversation-last-read-store.md` → How it works: stable setup and committed-tail eligibility.
- `docs/knowledge/features/development-verification-what-each-test-tier-proves.md` → Visible-tail read publication: retain numeric geometry and cleanup proof.
- `docs/knowledge/features/development-verification-evidence-that-cannot-pass-too-early.md`: receipt, commit and settlement are different barriers.
- `docs/knowledge/features/development-verification.md`: scoped validation and fresh artifact requirements.

## Context
Repair two flaky legacy browser tests without attributing their original occurrences to an unproven product defect. Original artifact directory is absent here; issue #1963 records the original gate and unchanged reproduction. This is one reliability deliverable, estimated at about 260 written lines, zero exports/consumer migrations, four acceptance behaviours and no production state machine. No in-flight remote feature branch overlaps `e2e/visible-tail-read.spec.ts` at planning time. Thread-route work (#1936) and pre-launch setup (#1983) remain separate.

## Design
Keep all diagnostics and synchronization in this spec. Prefer readiness predicates over a harness redesign: observe the loaded renderer before installing instrumentation, and observe receipt/committed DOM plus actual focus and unobscured trailing-edge geometry around reader dismissal. Keep the current work-count instrumentation and all existing assertions. Capture a bounded trace of renderer URL/lifetime, read-work readiness, focus, reader state, geometry and outbound targets. A passing unchanged rerun is a baseline only; controlled scheduling or processing traces must justify each repair. No production change without causal product-defect evidence.

## State + concurrency model
Instrumentation belongs to one renderer document and must be installed before conversation activation, after initial navigation. Frame delivery can precede React commit; two animation frames alone cannot prove receipt. Reader opening disposes observation, closing recreates it; native focus and scroll geometry are separate eligibility inputs. Spec-local probes must not create read-observer churn or change the focus/geometry oracle except in the existing deliberate exclusion cases. Any added event listener is removed or dies with the test-owned page.

## State transitions and identity reuse
| Event | Existing test retaining proof |
| --- | --- |
| Initial document navigation then instrumentation, for both launches | read setup is reused across committed same-row deltas on short and long threads |
| Same row, repeated durable IDs, geometry-preserving and growing commits | read setup is reused across committed same-row deltas on short and long threads |
| Tail replacement; reader open/close; archive exit/re-entry | read setup is reused across committed same-row deltas on short and long threads |
| Blur/focus; scroll above/return to tail; reader open/close with entry 38 | committed folded tails require focus, uncovered viewport and a closed reader |
| Received delta pending animation-frame commit | stable callbacks exclude hidden, queued and received but uncommitted tails |

## Error handling
Readiness failures must fail with observed diagnostic state, not retry Electron evaluation, suppress context destruction, skip tests or extend timeouts. No new I/O or product error branch.

## Testing strategy
- Capture baseline/controlled evidence before the synchronization repair; record exact boundary rather than claiming reproduction of unavailable artifacts.
- Keep short/400-row zero-churn, geometry equality, growth, target advancement and cleanup assertions.
- Keep blurred/above-tail/reader exclusion and target 38 after eligible dismissal; use positive processing evidence before negative assertions.
- Run both named tests ten consecutive repetitions with `--retries=0`, then the complete spec; record revision, workers, totals and fresh artifacts.
- After final main merge run dependency installation, pre-verify and build. No changed live tests.
- Dispatcher owns the complete configured fake suite; its pending result must include these named tests, totals, skips, retries and fresh artifacts at the reviewed revision.

## Open Questions
- Which initial document/readiness trace explains the evaluation-lifetime boundary?
- Does entry 38 reach a committed display while the reader is open, and which eligibility input differs on dismissal?
- Resolve both with measured evidence before selecting synchronization; append results below.
