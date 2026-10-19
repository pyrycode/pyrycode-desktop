# Visible-tail native confirmation on macOS

## Files read
- `e2e/fixtures/visibleTailFocus.ts` → `focusVisibleTailWindow`: guarded controls and immediate confirmation boundary.
- `e2e/fixtures/visibleTailFocus.test.ts` → `harness`: callback-executing acknowledgement-loss/partial/late execution coverage; effects currently synchronous.
- `e2e/visible-tail-read.spec.ts` → `focus`: genuine document focus follows native confirmation; all seven scenario assertions remain intact.
- `e2e/fixtures/mainProcessRead.ts` → `readMainProcess`: transient read loss is unavailable evidence, unrelated failures propagate.
- `e2e/fixtures/desktopIsolation.ts` → `withWindowPresentation`: macOS launches hidden by default.
- `docs/knowledge/features/e2e-harness-context-recovery.md` → Native setup recovery: final-inconclusive reads cannot authorize resend.
- `docs/knowledge/features/development-verification.md`, `development-verification-layout-and-input.md`, `docs/knowledge/INDEX.md`, `CLAUDE.md`: native versus static verification boundaries.

## Context
The retained #1983 report at `fdd49d04635408dbd8a6cbe69d53089ace54377b` records seven acknowledged native-control mismatches, before document focus or read assertions. It contains no separate visibility/focus readings. Three immediate inspections do not establish that an asynchronous native transition has settled; existing unit fakes never model that boundary. The upstream trigger remains unknown until controlled/native observations distinguish delay from persistent mismatch.

One useful behavior ships: native visible-tail setup confirms actual state before read-publication tests continue. Regression coverage and native validation belong to that repair. Estimate: approximately 300 written lines, no production files, at most two new exported types/functions, one consumer, four acceptance behaviors and fewer than ten reject branches. The #2074 analogue added 224 lines. In-flight #2079 changes only a later daemon subscription in the consuming spec; it does not overlap the focus block or supply a dependency.

## Design
Keep guarded show/focus controls and at most two control attempts. Capture separate native visibility/focus samples (including unavailable reads) in a diagnostic supplied by the consuming spec and attach it on success/failure. First capture the unchanged immediate-confirmation behavior on macOS to establish the failing fields.

Replace immediate mismatch rejection with bounded read-only condition polling inside the existing five-second assertion budget; do not change test timeouts, retry configuration or application code. Success requires both native fields. Only transient control acknowledgement loss followed by a final conclusive mismatch permits a guarded second attempt. A final unavailable read cannot authorize it. Unrelated exceptions propagate unchanged. No blind resend or focus/document override.

## State + concurrency model
Attempt-local observations only; no stores or application subscriptions. Polling ends on confirmed state or its bound, with no background work. Controls remain synchronous and guard each field independently, so late/partial execution does not repeat completed effects. Genuine `document.hasFocus()` and the existing final focus notification remain in the consumer.

## State transitions and identity reuse
| Event | Coverage in `visibleTailFocus.test.ts` |
| --- | --- |
| Acknowledged but delayed show/focus, independently | delayed native effects succeed only after both fields; one control only |
| Persistent acknowledged mismatch | bounded rejection with separate field diagnostics; no resend |
| Repeated setup | existing completed-fields test |
| Lost control acknowledgement before/after effects | existing recovery matrix |
| Partial/late callback execution | existing partial and late tests |
| Unavailable/final-inconclusive confirmation | existing no-resend rejection tests |
| Repeated control loss | existing two-attempt bound |
| Missing window or unrelated error | existing immediate propagation tests |

## Error handling
Preserve missing-window errors, transient loss classification, final-unavailable rejection and fatal/non-Error propagation. Persistent mismatches must remain visible and report which native field is false. Diagnostic recording never mutates native state.

## Testing strategy
- Add controlled delayed native effects to the callback-executing fake. Demonstrate the regression fails on the original helper, then passes after repair. Use Vitest fake timers for native delay and bounded failure; retain every #2074 fault scenario.
- Capture original native behavior with visibility/focus samples. Record what this establishes separately from any unknown upstream cause.
- Run all seven unchanged scenario bodies on macOS, zero retries, normal worker configuration; retain JSON/logs/attachments under `/tmp/builder-2150/`, exact revision and counts here.
- After final main merge, run affected pre-verify, build and helper/test typecheck. The verifier owns the complete configured macOS gate, including native-writer, clipboard and parallel projects; acceptance requires counted evidence with every failure/skip explicit. Other operating systems are outside this ticket's scope.

## Open Questions
- Do native samples show delayed visibility/focus or persistent mismatch? Resolve from the diagnostic run before selecting the final repair; append a revision if observations require a different contract.

## Revisions
2026-10-19: Native evidence rejects the proposed polling repair. All seven original scenario bodies reproduce the acknowledged mismatch, with `visible: true, focused: false` on all three immediate inspections and every subsequent read throughout the ordinary five-second diagnostic assertion window. The first case records immediate reads at 31/33/34ms and continued mismatch through 4942ms. This establishes persistent native focus failure in these runs, rather than merely acknowledged effects arriving after three reads. The upstream cause of focus refusal remains unknown; this does not establish a historical inspector failure or daemon setup problem.

Additional files read: `e2e/fixtures/electronLaunch.ts` → `electron.launch`, and `e2e/fixtures/mainProcessControl.ts` → `dispatch`, `createMainProcessControl`: native controls execute through the synchronous receipt adapter introduced before the historical failing revision. Scheduling a separately guarded focus on the normal event loop did not recover native focus, so no adapter change is justified by these observations. Electron 33.4.11's [native window implementation](https://github.com/electron/electron/blob/v33.4.11/shell/browser/native_window_mac.mm) distinguishes app activation and key-window focus, but source inspection alone does not establish the failure's cause.

Controlled probes preserve the original setup failure even after their diagnostic intervention. Each repeats the `stable callbacks exclude hidden, queued and received but uncommitted tails` scenario with zero retries and normal configured workers, executing one serial test. Ordinary `app.focus()`, `page.bringToFront()`, a separately issued guarded `window.focus()`, normal-event-loop focus via `setImmediate`, and `webContents.focus()` each leave visibility true and focus false throughout the following diagnostic reads. A shown-at-launch control and a show-without-immediate-focus control fail identically. No forced activation or document-focus override was introduced. Read-only console inspection reports an unlocked, logged-in console. This excludes a locked console, but does not identify why native activation is refused.

The preserved partial change only records separate read-only native fields in a `visible-tail-native-focus` attachment and includes them in acknowledged-mismatch errors. Recovery attempts, immediate inspection count, effect guards, native/document readiness requirements and all seven scenario bodies remain unchanged. New unit cases verify separate persistent-field reporting and unavailable-read reporting; all 19 previous fault cases remain. Experimental controls and the hypothetical delayed-effect tests were removed because native evidence did not support that repair. No repair or successful native acceptance is claimed. A subsequent builder must establish why actual native focus is withheld and implement its controlled regression before this ticket can advance to review.

## Validation evidence
- macOS 26.6.2 arm64, Electron 33.4.11. Original occurrence report remains `/tmp/builder-1983/native-final-20261019-review/desktop/playwright.json`, SHA256 `df8e5423094a38eb1fa1bd7b8dd61423d5e62c3ee4b63883b2999e00c8626636`.
- Diagnostic baseline on plan commit `5bdb04d2` plus uncommitted read-only diagnostic instrumentation: `PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-2150/native-before.json node node_modules/@playwright/test/cli.js test --config=playwright.config.ts e2e/visible-tail-read.spec.ts --no-deps --retries=0 --reporter=list,json --output=/tmp/builder-2150/native-before-results`. Configured/actual workers 4/1; **7 executed, 0 passed, 7 failed, 0 skipped/flaky, 0 retries**. Every failure is the original native setup mismatch. JSON SHA256 `52fc0a843708741464f0d3beaa7e0014eddae4d1beab59982a1e443cc93a3009`; matching log and result directory retain evidence, including separate-field samples.
- Seven controlled probes: the same command with `--grep 'stable callbacks exclude'`, using report/output stems `native-activation-probe`, `native-front-probe`, `native-staged-probe`, `native-event-loop-probe`, `native-web-focus-probe`, `native-shown-probe`, and `native-show-only-probe` under `/tmp/builder-2150/`. The shown probe additionally sets `PYRY_E2E_SHOW_WINDOW=1`. Each: **1 executed, 0 passed, 1 failed, 0 skipped/flaky/retries**, configured/actual workers 4/1. The deliberate original failure is retained, and every post-intervention native sample remains unfocused. These are diagnostic interventions, not candidate acceptance runs.
- `npm test -- e2e/fixtures/visibleTailFocus.test.ts`: **22 executed/passed, 0 failed/skipped**, `/tmp/builder-2150/diagnostics-final-unit.log`. This proves diagnostics and preserved recovery guards, not native focus repair.
- Complete configured macOS application gate remains unrun in this builder session and belongs to the verifier after an actual repair. All seven passing native scenarios are still required; focused diagnostic failures do not satisfy acceptance. No other operating system was tested.
