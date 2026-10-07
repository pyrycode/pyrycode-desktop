# Failed-host hover synchronization

## Files read

- `CLAUDE.md` → test tiers and renderer boundaries: interaction belongs in Playwright.
- `docs/knowledge/INDEX.md` → owning topics for this regression.
- `docs/knowledge/features/channel-list-host-row.md` → The host row: failed-host Edit/Repair remain separate, fixed targets; Edit reveals on actual hover.
- `docs/knowledge/features/e2e-harness.md` → Desktop isolation: Linux windows are shown and share native input despite renderer throttling exemptions.
- `docs/knowledge/features/development-verification.md` → Layout and input: laid-out geometry and actual input require browser evidence.
- `e2e/sidebar-offline-mutations.spec.ts` → failed-host local controls remain usable: preserve geometry, dialog, folds, capture and repair drive.
- `src/renderer/src/screens/channels/channels.css` → host hover and failed-host selectors: opacity changes without a transition; failed state only changes placement and colour.
- `e2e/fixtures/desktopIsolation.ts` → e2eShowsWindow: shown Linux default.
- `e2e/fixtures/launchPairedApp.ts` → launchPairedApp: existing fake transport, window lifecycle and teardown.
- `playwright.config.ts` → workerCount and projects: preserve three-worker concurrency and use explicit zero retries for acceptance.
- Ticket #1821 historical gate/rerun logs and #1819 controlled observation: distinguish lost real input from styling defects.

## Context

A one-shot host hover followed by a passive opacity wait can never restore hover lost to later native input from another shown window. Historical gates at `1cec087404` and `5d1b88adaa` passed geometry but observed opacity zero; same-tree reruns passed. Confirm this mechanism on the failed host before implementing. No ADR is needed. Documentation topics were read locally after the QMD query did not return.

## Design

Keep the correction local to the named Playwright test. A test-local asynchronous observation delivers normal `host.hover()` input on each default polling observation, then synchronously reads host `matches(':hover')` and Edit computed opacity. Require both true hover and exact opacity `1`. Preserve the original unchanged-box comparison and every geometry and absence assertion. Use the same observation before the existing screenshot. Continue to activate Edit, Cancel, section folds and Repair through ordinary clicks.

No renderer correction is planned: prove the existing rule produces opacity `1` whenever the host really is hovered. If the controlled observation contradicts this, revise the plan before changing production behavior. No CSS/DOM hover injection, forced click, sleep, timeout increase, retry increase or parallelism change is permitted.

In-flight remote branch check found no overlap with the test. #1658 adds channel-form styles in `channels.css`, outside the inspected host selectors; this plan does not modify that stylesheet or consume its change.

## State + concurrency model

No new application state, store, subscriptions or long-lived tasks. The existing fixture owns transport and app teardown. The polling operation is awaited and bounded by the unchanged assertion timeout. It re-delivers input because native window arrival can invalidate earlier input; hover and opacity are read in one renderer turn.

## Error handling

A failed input action or missing control fails the test normally. A real hover with incorrect opacity remains an assertion failure. No application error paths change.

## Testing strategy

- Before implementation, run the existing named assertion with three workers and zero retries, and record its outcome without treating green runs as causal proof.
- Scratch controlled observation: show/focus a second native window after host hover; record pointer coordinates, host hover, Edit opacity and unchanged boxes before/after window arrival and after frames. Re-deliver real input and confirm restoration.
- Sensitivity check: in a scratch built-renderer copy remove the host-hover opacity rule; require the synchronized assertion to fail while hover remains true.
- After the final merge of main, run pre-verify, build and docs checks.
- Execute 20 focused repetitions, three configured/actual worker slots, zero retries/skips; then the full default fake-transport suite at three workers and zero retries. Record named-test attempt/counts separately from unrelated failures and existing platform skips.
- No live Claude tests are changed or required. No additional unit assertion can establish native hover.

## Open Questions

- Does controlled window arrival clear actual failed-host hover while keeping its boxes unchanged? Record the observation and resolution in Revisions.
- Does the synchronized assertion still reject a broken hover opacity declaration? Record the mutation result in Revisions.

## Sizing

One deliverable, three observable acceptance criteria, approximately 140 written lines including plan and test, zero exported types/components/stores, zero production consumer updates and zero application rejection branches. Both sketch and written plan fit every sizing boundary and the refiner estimate.
