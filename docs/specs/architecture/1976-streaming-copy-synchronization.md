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
