# Visible-tail native focus acknowledgement recovery

## Files read
- `e2e/visible-tail-read.spec.ts` → `focus`, `readState`, `instrumentReadWork`: preserve genuine document focus and all committed-read/exclusion/lifecycle proof.
- `e2e/fixtures/composerWindowSetup.ts` and its tests → `configureComposerWindow`: guarded controls followed by bounded, read-only confirmation.
- `e2e/fixtures/mainProcessRead.ts` → `readMainProcess`, `isTransientContextLoss`: unavailable reads cannot prove readiness or authorize control replay.
- `docs/knowledge/features/e2e-harness-context-recovery.md` → Native window setup: partial/late control and final-inconclusive rules.
- `docs/knowledge/features/conversation-shell.md` → committed-read contract and Navigation and cleanup: focus only rechecks committed evidence.
- `docs/knowledge/features/development-verification.md`, `docs/knowledge/INDEX.md`, `CLAUDE.md`: test boundaries and repository conventions.

## Context
The #2072 verifier bundle `99a483213866ece7b6eedddf2be895c8aeb3f9706ab790e4591ee4012421d7f1` records the named case failing at the initial native evaluation in `focus`, before read assertions, with Playwright's destroyed-context error (1464ms). The same unchanged scenario passed on rerun (3644ms, retry 0). Launch-fate reports a running app and clean teardown. This proves an unhandled ambiguous setup acknowledgement, not whether the controls executed, a renderer navigation/crash, or the upstream inspector trigger.
The earlier #2043 occurrence instead timed out at target 37 (actual 36). Its existing `b345232b` scroll drain remains intact; these observations do not establish a common cause. Evidence was retrieved under `/tmp/builder-2074/evidence-2072/`; original/rerun sources are named in the issue's refinement comment.

## Design
Extract only native control into `focusVisibleTailWindow(app): Promise<void>` in `e2e/fixtures/visibleTailFocus.ts`, consumed only by this spec. Mirror the existing native-window confirmation pattern rather than introducing generic mutation recovery. Each callback finds the live window, fails if absent, and guards show/focus independently with `isVisible()` / `isFocused()`. Every control attempt is followed by up to three read-only native inspections. Matching visible/focused state succeeds; only transient control loss plus a final conclusive mismatch permits a second guarded attempt. No sleeps, timeout/configuration changes, dependencies, production changes, clicks or frame resends.
Keep the spec's deletion of its deliberate `document.hasFocus` override, genuine document-focus poll and final focus notification unchanged, after native confirmation. Native state alone never completes renderer readiness.
No in-flight feature branch overlaps the three implementation/test paths at planning time. Size: approximately 350 total written lines, one exported function, one consumer, four acceptance behaviors, at most six distinct rejection branches; within all limits.

## State + concurrency model
Only bounded setup-local attempt/inspection state; no application stores, subscriptions or long-lived jobs. Each evaluated native control is synchronous and checks current fields before changing them. Read recovery contains no mutations. Fixture-owned app closure and teardown remain unchanged.

## State transitions and identity reuse
| Event | Fault-test coverage in `visibleTailFocus.test.ts` |
| --- | --- |
| Normal/repeated setup | confirms live state; already-focused setup performs no extra effects |
| Lost acknowledgement before effects | confirms absence before one guarded resend |
| Lost acknowledgement after effects | confirms success without replay |
| Partial show/focus execution | repeats only the still-unapplied field |
| Late original callback | guards completed fields; late completion during inspections avoids resend |
| Transient/unavailable inspection | recovers reads; final unavailable state rejects without resend |
| Repeated control loss/exhaustion | two attempts maximum; no false success |
| Missing window/unrelated error | visible failure, preserving original fatal errors |

## Error handling
Use the existing transient recognizer only for Electron inspection loss. `NOT_YET_AVAILABLE` never becomes false/true evidence. Missing windows, acknowledged mismatch, unavailable final confirmation and exhausted recovery throw descriptive setup errors. Unrelated errors/non-Error throws propagate unchanged from controls and reads.

## Testing strategy
- Extract the original native callback first and run callback-executing Vitest faults against it to show the recovery cases fail for the intended reason; then implement and rerun. Fakes hold real visibility/focus fields and execute the actual control/inspection callbacks, including partial and delayed execution.
- Linux: build, run the named scenario with `--repeat-each=20 --retries=0`, then the complete `visible-tail-read.spec.ts` with configured workers unchanged; retain JSON/stderr, counts and revision under `/tmp/builder-2074/` and summarize here. Preserve all read targets, processing/commit barriers, scroll drains and observer assertions.
- After final merge of main, run pre-verify and build. Verifier owns the complete configured application gate, including this named case. No provider/live-Claude requirement; other operating systems are outside this ticket's verification scope.

## Open Questions
None. Native-state confirmation supplements rather than replaces genuine renderer focus readiness.
