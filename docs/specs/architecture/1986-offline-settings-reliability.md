# Offline composer settings regression reliability

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
