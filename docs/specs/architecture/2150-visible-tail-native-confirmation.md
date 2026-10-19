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
