# Streaming row clipboard reliability

## Files read
- `CLAUDE.md`, `docs/knowledge/INDEX.md`: repository rules and ownership.
- `docs/knowledge/features/development-verification.md`, `development-verification-layout-and-input.md`, `development-verification-evidence-that-cannot-pass-too-early.md`: positive delivery, commit and input barriers.
- `docs/knowledge/features/conversation-shell-message-bubble-testing.md`: retained geometry, metadata and clipboard coverage.
- `docs/knowledge/features/e2e-harness-desktop-isolation.md`: native-pointer protection and clipboard serialization.
- `e2e/message-side-actions.spec.ts` → `frames`, named side-copy case: immediate echo/settlement followed by unsolicited streaming delta.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: isolated Electron launch and fake daemon ownership.
- `playwright.config.ts` → `CLIPBOARD_SPECS`: existing single-worker clipboard project.
- `ConversationScreen.tsx` → `TimelineRow`, `MessageActions`: source text passed to ordinary button activation.
- `copyMessageText.ts` → `copyMessageText`: real navigator clipboard write, guarded rejection.
- `e2e/message-copy.spec.ts`: OS clipboard readback and ordinary pointer/keyboard coverage.

## Context
The named case intermittently retains the earlier “Hi” clipboard value. Historical
failure receipts are linked from issue #1976; their raw artifacts are unavailable.
Cursor presence on a dynamic last row alone does not prove the intended source or
completed input. Investigate these boundaries before changing production.
This is one test-reliability deliverable, approximately 180 written lines, zero new
exports or consumer migrations, three observable acceptance criteria and no new
production error branches. The remote feature-branch audit found no overlapping
changes to the proposed spec/fixture files. #1969's launch fix is already on main.

## Design
Keep the repair local to the existing side-actions spec, preserving every current
geometry, attachment, queue/drop and standalone-offer assertion. Establish an
unchanged-code failure or controlled reproduction, observing committed row source,
native input delivery and OS clipboard values to separate competing hypotheses.
Add positive settled-reply barriers before starting the unsolicited stream; locate
the streaming source explicitly and observe its committed text/cursor before copy.
Use ordinary Playwright activation after native hover/focus/layout readiness as
the diagnosis warrants. Read back the real OS clipboard, never a stub. Preserve
desktop isolation, project serialization, retries, timeouts and skip policy.
Only a demonstrated renderer defect would justify one production-file change.

## State + concurrency model
No new product state, async job or subscription. The existing fixture owns Electron
and daemon teardown. Any local observational listener must be removed after use.
The attached send's reply must settle before the independent stream is injected.

## State transitions and identity reuse
| Event | Coverage |
| --- | --- |
| Repeated sends with distinct message IDs | Existing geometry setup and positive reply settlement in named case |
| Attachment send followed by independent stream | Named case asserts completed attached echo then exact partial reply |
| Metadata reveal/collapse during input | Existing hover/focus assertions plus input readiness before streaming copy |
| Copy after earlier “Hi” activation | Exact OS clipboard replacement by “Streaming partial reply” in named case |

## Error handling
Failed delivery, unsettled geometry, missing native activation or incorrect clipboard
contents fail the existing test; no timeout increase or retry hides them. Retain
diagnosis and complete-tier receipts, linking unrelated tracked failures explicitly.

## Testing strategy
- Build, then reproduce the symptom on unchanged code or through a controlled schedule.
- Preserve input and clipboard diagnostics sufficient to support the diagnosis.
- Run the named case twenty times with zero retries, then the entire configured fake tier.
- Record exact revisions, executed/passed/failed/skipped counts, retries and skip reasons.
- Merge final main, run pre-verify and build; no real-Claude proof is required.

## Open Questions
- Which boundary causes the stale clipboard? Resolve with reproduction evidence and record the answer in Revisions before handoff.

## Revisions
2026-10-14: resolved the open diagnosis question with a controlled native-input
schedule on unchanged production at `0057a0afe824ae00594ddfd893dac2f26ca87f70`.
Ten unchanged-case repetitions and twenty instrumented ordinary-click repetitions
passed, but those green runs alone establish no cause. The controlled case used
ordinary hover, mouse down, two animation frames, then mouse up, allowing the
attachment-focus/metadata reflow to finish during a press. It changed no CSS,
clipboard API, permissions, transport, source text or product handler.

All three control executions failed with the exact stale “Hi” symptom. In each,
the committed source was “Streaming partial reply”; trusted pointer-down targeted
its Copy glyph at button box `(851.015625, 933, 27, 20)`. Before release the box
moved to `(851.015625, 905, 27, 20)`. Trusted pointer-up hit Reply's glyph, and the
click targeted the common actions container, so Copy's handler never activated.
This isolates an input/layout synchronization gap rather than stale source or
clipboard interference. It reproduces a schedule consistent with the historical
symptom, without claiming to recover the unrecorded original event schedule.

The same frame-spanning press passed all three executions with the repair:
settle the attached reply, identify the exact streaming source, transfer focus
before pressing and require identical focused/hovered button and scroll geometry
across consecutive animation frames. Shipping activation remains ordinary
`Locator.click()`, with a trusted click receipt and exact OS clipboard readback.
All original assertions remain; no production change is justified.
An explicit OS readback also requires the earlier presses to have copied “Hi”,
making the later replacement assertion nonvacuous even across repeated executions.

Evidence under `/tmp/builder-1976/`: `baseline.json` (10 executed/passed),
`probe.json` (20 executed/passed), `press.json` (3 executed/failed),
`repaired-press.json` (3 executed/passed), `input-probe.patch`,
`press-control.patch` and `repair.patch`. All runs used the existing serialized
clipboard project, isolated Xvfb and zero retries, with zero skips. Control-only
instrumentation and the frame-spanning press are absent from the shipping spec.

## Acceptance receipts
Final tested source: `0406469c8a7402a58b03fea6b314e43e26223d00`, after merging
main `0057a0afe824ae00594ddfd893dac2f26ca87f70`. The following commit adds only
this receipt. All Electron runs used Linux/Xvfb and the existing clipboard project
with one concurrent worker; the complete tier retained four configured workers.

| Run | Executed | Passed | Failed | Skipped | Retries |
| --- | ---: | ---: | ---: | ---: | ---: |
| Named case, twenty repetitions | 20 | 20 | 0 | 0 | 0 |
| Complete configured fake tier | 395 | 395 | 0 | 3 | 0 |
| Named case within complete tier | 1 | 1 | 0 | 0 | 0 |

Every Playwright result has retry index 0; neither run is flaky. The existing
skips are the two `app-badge-count.spec.ts` cases (app icon badges exist only on
macOS) and `window-reopen-converges.spec.ts` (only macOS retains the app after its
last window closes). No new skip or unrelated failure occurred.

Commands, each under `xvfb-run -a`: focused `npx playwright test
e2e/message-side-actions.spec.ts --grep 'side copy and row cap retain sizing while
metadata expands on hover and focus' --repeat-each=20 --retries=0 --reporter=json`;
complete `npx playwright test --retries=0 --reporter=json`. Both used separate
`--output` directories under `/tmp/builder-1976/`.

Final pre-verify passed all five checks, including typecheck and 10,178 unit tests
passed with 3 existing skips. `npm run build` and `npm run check:docs` passed.
Retained receipts: `/tmp/builder-1976/final-focused.json`, `final-full.json`,
`final-pre-verify.log`, `final-build.log`, `diagnosis.tar.gz` and `acceptance.tar.gz`
in that same directory. The full JSON has a Vite deprecation warning before its
JSON object. No real-Claude acceptance was required or claimed.
