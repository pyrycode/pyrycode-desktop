# Held expansion completion

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`: process boundaries and mounted-test requirements.
- `docs/knowledge/features/development-verification.md`: counted evidence and immutable failure provenance.
- `docs/knowledge/features/conversation-shell.md`, `conversation-shell-timeline-render.md`, `conversation-shell-scroll-pin.md`: source-ID retention, deferred bodies and committed geometry.
- `docs/specs/architecture/2127-visible-thread-presentation.md`: existing admission contract and historical completion failures.
- `e2e/thread-items.spec.ts` → `rendererFixture`, held-item case: real composer instrumentation and 8,334-source workload.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ThreadItemsView`: visible-ID admission, 256-item budget, timer cleanup and scroll pin.
- `src/renderer/src/screens/conversation/deferredThread.test.tsx`: static deferral assertions; these do not establish effect liveness.
- `e2e/fixtures/electronLaunch.ts`, `launchPairedApp.ts`, `runDisplay.ts`, `playwright.config.ts`: normal launch/teardown, worker isolation and clipboard project.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=155-553
Read design context and screenshot: single-line tool header with lead, subject, count and chevron, existing token-based border and body. Preserve the existing presentation and assets.

## Context

One behavior: complete held expansion while actual composer input remains responsive. Repair and discriminating regression stay together. Original macOS failure is retained separately under `/tmp/builder-2184/original-failure/`, bundle `cbb63d3356b372eaa1b98e91808e261b1ea315e1eb41b9182ffa90540ba738d7`: 532 executed, 531 passed, one failed, two skipped. Its same-tree retry is historical evidence of intermittency, not a cause. No ADR is needed.

## Design

Instrument the existing spec-local renderer fixture to distinguish committed row progress, admission scheduling and visibility from test-driver orchestration. Establish a controlled schedule that discriminates the demonstrated failure boundary, then repair that boundary locally. Keep the production admission contract: at most 256 additional visible source IDs per turn, yielding to real input, no paging, no dropped final rows. Any diagnosis changing this design is recorded in Revisions before implementation.

Prefer the existing local effect and spec-local controls over introducing an exported scheduler or shared harness changes. Preserve all original assertions, workload and deadlines; no sleeps, retries or increased timeout. Overlap: `feature/2176` adds independent read diagnostics in `rendererFixture` and a separate test; preserve its edits when merged, keeping changes additive.

## State + concurrency model

Admission and expansion remain local to the host/conversation/epoch keyed view. Pending admission work must progress while visible work remains, stop when complete, cancel on visibility replacement and unmount, and avoid retaining stale IDs. Actual composer input stays independently committed. No transport or store ownership changes.

## State transitions and identity reuse

| Event | Mounted coverage |
| --- | --- |
| Nested expansion and input during incomplete admission | existing held-item case, controlled schedule plus real keyboard commit |
| Completion after input | held-item case: positive progress, row 8339 and all 8,334 rows |
| Collapse, closed revision and reopen with same IDs | held-item case: revised last row, retained child expansion and visible-only read |
| Group collapse and removed reading row | held-item case: both existing anchor assertions |
| Scope/epoch replacement and teardown | existing supplied-agent scope loop and normal fixture teardown |

## Error handling

No new I/O or reject branches. Diagnostic attachments contain counts, timing and static phases only. Failure retains progress and normal launch-fate evidence rather than retrying it away.

## Testing strategy

- Run a discriminating mounted regression against unchanged production first, retain the failure, then run it after the repair.
- Preserve static deferral tests; pre-verify targets `deferredThread.test.tsx`.
- Linux exact case: clipboard project, no dependencies, distinctive title, ten repeats, retries zero. Run the complete `thread-items.spec.ts` with retries zero.
- Retain commands, revision, counts, retries and composer/progress observations in this plan. Build and pre-verify after final main merge. Complete configured application acceptance belongs to verifier/dispatcher; no fresh provider or second-OS proof is claimed.

## Open Questions

- Does a controlled renderer schedule establish an admission liveness defect or fixture-orchestration defect? Resolve from mounted evidence and record the exact boundary and repair in Revisions before changing production.

Size: approximately 250 written lines, at most one production file, no new exports or migrated consumers, three observable criteria, no new reject branches; below all ceilings. One independently verifiable behavior, no split warranted.
