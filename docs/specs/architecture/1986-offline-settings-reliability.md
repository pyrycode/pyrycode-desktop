# Welcome setup reliability for the offline settings regression

## Current design (2026-10-15 re-refinement)
The live issue now authorizes diagnosis and repair in the existing Welcome
pairing helper, diagnostic wrapper and default fixture wiring. This section
supersedes the menu-focused design below; the earlier evidence remains history.

### Files read
- `e2e/fixtures/pairingArrival.ts` → `pairFromUnpairedLaunch`, `drivePairingForm`: ordinary click and pairing arrival, shared three-argument contract.
- `e2e/fixtures/welcomeDiagnostics.ts` → `observeWelcomeClick`, `withWelcomeDiagnostics`, `capture`: bounded primitive-only capture with original-error preservation.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: first-window readiness, page-specific registration and teardown.
- `e2e/welcome-stall.spec.ts` → controlled diagnostic regression: actual TestInfo attachments and clean second launch.
- `e2e/fixtures/desktopIsolation.ts` → `launchIsolatedApp`: shown Linux windows, native-pointer isolation and throttling switches.
- `src/main/index.ts` → `createWindow`: asynchronous ready-to-show presentation and initial document load.
- `docs/knowledge/features/e2e-harness-desktop-isolation.md`, `e2e-harness-launch-fate.md`, `development-verification.md`, `development-verification-evidence-that-cannot-pass-too-early.md`: distinct native, renderer, frame and input evidence requirements.

### Context and design
The historical failure is a Welcome CTA click timeout at df4ce98b, with no
retained call log or natural diagnostic attachment. Passing unchanged repetitions
do not diagnose it. First recover any available attachment, then compare native
presentation/occlusion, renderer timer/frame progress, actionability and actual
input delivery in controlled launches. Scratch experiments stay outside the tree.
Only a demonstrated causal defect justifies a helper repair and a focused failing
regression; do not substitute a simulated diagnostic fault for that proof.
Preserve the shared pairing API and all offline-menu assertions, callers and real
tier behavior. No app production, wire, visual or dependency change is planned.
The remote branch overlap check found no edits to these four helper/spec files.

### State + concurrency model
No application state changes. Each launch owns its existing profile, transport,
observer registration and teardown. Any added observation uses the existing
bounded capture/cleanup ownership and primitive allowlist. No replacement click,
retry, timeout increase, arbitrary sleep or route injection is permitted.

### State transitions and identity reuse
| Event | Required regression |
| --- | --- |
| Initial Welcome readiness and click | New focused causal regression, named once mechanism is established |
| Pending/rejected click | Existing controlled Welcome diagnostic spec and diagnostic unit tests |
| Close and relaunch | Existing Welcome diagnostic spec: two correlated clean launches |
| Reconnect and settings selection | Unchanged offline settings spec, all three menu cases |

### Error handling
Preserve original click errors, bounded diagnostics and isolation cleanup. Missing
causal evidence leaves diagnosis unresolved; it does not authorize speculative
hardening. Diagnostic reports exclude payloads, field values, raw errors and DOM.

### Testing strategy
Test-first controlled failure at the demonstrated boundary, then the same test
passing with the repair. Run affected diagnostic coverage, 20 named offline
repetitions each with one and four workers, and all four offline-spec tests with
retries disabled. Record revision, platform, presentation, actual workers, outcome
counts and fresh report paths. Merge main, run pre-verify and build. The dispatcher
owns the complete configured fake gate; its result remains pending.

### Open Questions
What mechanism prevents Welcome click completion? Resolve from a controlled
comparison before implementing. Historical trigger remains unproven without its
missing attachment. Sizing: one deliverable, four criteria, approximately 360
written lines, zero new exported API/types or migrated consumers, within limits.

## Files read
- `e2e/offline-session-settings.spec.ts` → `event`, `connection`, `settings`, `observeCommands` and the pre-opened menu scenario: current synchronization and command observation.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: isolated fake transport and renderer startup.
- `e2e/fixtures/conversationStateFake.ts` → `conversationStateFake`: scripted replies do not confirm settings automatically.
- `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` → `ComposerOptionsMenu`: passive initial focus and keyboard selection use an internal index.
- `src/renderer/src/screens/conversation/ComposerModelMenu.tsx` → `ComposerModelMenuView`: unavailable controls unmount their menu.
- `src/renderer/src/screens/conversation/ComposerEffortMenu.tsx` → `ComposerEffortMenuView`: held effort and published choices.
- `src/renderer/src/screens/conversation/ComposerPermissionModeMenu.tsx` → `ComposerPermissionModeMenuView`: fresh confirmation controls visibility.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `changeConnectedSetting`, `useSessionSettingsConnected`: synchronous renderer write gate.
- `docs/knowledge/INDEX.md`, root `CLAUDE.md`, `docs/knowledge/features/development-verification.md`, `docs/knowledge/features/development-verification-evidence-that-cannot-pass-too-early.md`, `docs/knowledge/features/conversation-shell-run-configuration.md`: processing barriers, renderer-boundary observation and reconnect confirmation contract.

## Context
Repair one existing fake-transport regression without changing product behavior.
The original fail/pass logs are unavailable locally; do not attribute their exact
assertion to an inferred cause. Capture fresh failure/input evidence at the
reviewed revision before settling the repair. Direct DOM focus currently bypasses
the menu's keyboard index, and two animation frames do not acknowledge IPC receipt.
No ADR or dependency is needed. Remote overlap: #1544 already contributes the
confirmation assertions present here; #1662 edits sheet assertions in a different
scenario. Keep changes additive and local and integrate main before final checks.

## Design
Keep synchronization and diagnostics in this spec. Establish observable menu
readiness and the intended keyboard choice through the supported keyboard path,
then capture its former coordinates unconditionally. Use positive processing
barriers for injected events and rendered connection/settings transitions before
absence checks. Preserve the CDP observation of `window.pyry.sendCommand` so a
downstream transport refusal cannot hide an attempted write. Check fresh commands'
payloads as well as exact counts. Diagnostics must distinguish injection receipt,
input focus/selection and reconnect confirmation, and attach fresh evidence.
Only change production code if controlled evidence demonstrates a product defect;
record any resulting contract change in Revisions before implementation.

## State + concurrency model
No new application state. Spec-local observation belongs to one isolated app;
event listeners and CDP sessions end with that app or explicit cleanup. Synchronize
the main-to-renderer injection with renderer receipt and relevant rendered state,
not elapsed time. Menu focus effects can run after the click that opens the menu.

## State transitions and identity reuse
All rows are covered by `pre-opened composer menus discard mouse and keyboard choices offline, then reconnect`:

| Event | Required observation |
| --- | --- |
| Open each model/effort/permission menu | Visible menu, intended keyboard choice focused, non-null former bounds |
| Disconnect with menu open | Controls/menu removed; held labels unchanged after Enter, Space and former-location click; command count unchanged |
| Reconnect same host/session | Permission confirmation invalidated; no blocked command replay |
| Fresh owning-host settings report | Permission restored before a fresh selection |
| Fresh connected selection | Exactly one command with the intended field/value |
| Reject and repeat for next menu | Rejection processed and optimistic value cleared before reseeding |

## Error handling
Missing menu, focus, geometry or event receipt is a test failure, never a skipped
gesture. Retain existing timeouts, retry settings and command-count assertions.

## Testing strategy
- Capture fresh baseline failure or measured input/event trace, then add assertions that expose the diagnosed mismatch before repairing it.
- Build and execute the named scenario 20 consecutive times with one worker and retries disabled; record revision, report paths and all outcome counts.
- Run the complete four-test spec with retries disabled after the final main merge.
- Run pre-verify and `npm run build`; the dispatcher owns the complete configured fake-transport gate, whose result remains pending here.

## Open Questions
Which input/event ordering causes the observed failure? Resolve with a controlled
comparison and retain causal evidence in Revisions and the issue comment.

Sizing: one deliverable, four criteria; approximately 240 written lines, zero new
exported APIs or consumer migrations, no new application reject branches. Ceiling
and floor checks pass.

## Revisions
2026-10-15 — Recovered occurrence evidence changes the repair boundary before
implementation. The verifier review on PR #1985, comment
https://github.com/pyrycode/pyrycode-desktop/pull/1985#issuecomment-6181985199,
identifies the sole offline-settings failure at
`df4ce98b9ac7786599c003dd03544ff81c128242` as a Welcome pairing-button click
timeout, before this spec's menu/event scenario. Its gate recorded 394 passed,
one failed, three skipped and zero retries; the isolated rerun passed once.
This establishes the failed boundary, not its technical cause. The raw occurrence
logs remain unavailable, including the Welcome diagnostic attachment.

Unchanged candidate source at `af90e0d7fe326ab9f50ae61a47d8f3cd9c6b41cc`
(plus this plan) passed fresh focused runs: ten of ten with one worker and forty
of forty with four workers, all with retries disabled, no failures or skips.
Commands: `npx playwright test e2e/offline-session-settings.spec.ts --grep
'pre-opened composer menus' --repeat-each=10 --workers=1 --retries=0 --reporter=json`
and the same command with `--repeat-each=40 --workers=4`. Reports are
`/tmp/builder-1986-baseline.json` and `/tmp/builder-1986-baseline-parallel.json`.
These passing runs do not explain the Welcome timeout or prove a repair.

The root cause remains open. Menu input/index and IPC acknowledgement weaknesses
are source observations only; no causal connection to this occurrence has been
established. Do not implement them as a purported fix for the Welcome timeout.
Return for refinement to authorize diagnosis/repair at the demonstrated
`pairFromUnpairedLaunch` / `observeWelcomeClick` boundary, currently outside the
ticket's spec-local/menu scope. No existing open issue specifically owns that
Welcome timeout; do not create a duplicate of this ticket's recorded failure.
No implementation, product change, full-spec acceptance or dispatcher gate is
claimed complete.
