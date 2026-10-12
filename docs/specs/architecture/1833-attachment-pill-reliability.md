# Attachment pill reliability (#1833)

## Files read

- `CLAUDE.md` and `docs/knowledge/INDEX.md`: test ownership and knowledge map.
- `docs/knowledge/features/composer-attach-name-pill.md` → Testing: preserve the complete name, treatment, geometry, focus and send contract.
- `docs/knowledge/features/e2e-harness-desktop-isolation.md` → Native display-pointer protection: independent input-enabled covers distinguish native crossing from focus loss.
- `docs/knowledge/features/development-verification.md` → Layout and input: observe actual hover, treatment and geometry together; frames settle events without sleeps.
- `e2e/composer-attachment-name.spec.ts` → `FIRST`, `SECOND`, `push`, `drawn`, `pillBox`: unchanged continuous attachment drive and resting baselines.
- `e2e/desktop-isolation.spec.ts` → independent-cover regression: separate Electron process/profile and paint acknowledgement.
- `e2e/fixtures/desktopIsolation.ts` → `launchIsolatedApp`, `ignoreDisplayPointer`: initial and future window protection.
- `playwright.config.ts`: default fake-transport projects, three actual workers and explicit zero retries.

## Context

The retained historical `188fd6b7` result failed at `pillBox.height` after visibility and treatment passed. CSS removes the pill's box if both slot hover and focus are absent. The overwritten #1818 failure at `7d59fb97d0` remains unconfirmed. Green subsequent gates alone cannot establish the cause. Determine whether merged #1836 protects this exact geometry boundary before changing the test. No ADR is needed.

## Design

Prefer an evidence-only resolution if the controlled comparison passes on protected main. Preserve every assertion and the existing fixture, input, timeouts, retry policy and suite parallelism. Diagnostic patches stay under `/tmp/builder-1833/` and are restored before acceptance runs; no shared harness or production change is planned.

Use separate historical and candidate worktrees, built sequentially. Adapt the existing allowed independent-cover launch in `desktop-isolation.spec.ts` for a temporary diagnostic, retaining the attachment spec's two completions, resting measurements, ordinary first-tile hover and exact treatment assertion. Capture the attachment snapshot immediately after those assertions, then map the prepared input-enabled cover over the native cursor. Repeat with the same cover in a corner away from the cursor. Record actual bounds and window/document focus, timestamped pointer events, slot hover/focus, exact pill treatment and nullable boxes for pill/tile/composer/pane/strip/input. Two animation frames acknowledge paint and event processing; no arbitrary sleep or manufactured hover.

Run historical over-pointer and corner arms serially, then identical protected arms. A main-only serial deletion of initial-window protection isolates the protection variable. Retain patches, JSON and traces in distinct artifact paths. Require real baseline interference before attributing the protected result to isolation.

If protected main still loses the observed state, revise this plan and correct only the attachment spec: each bounded observation attempt re-delivers ordinary tile hover, captures hover/treatment/all boxes synchronously and reports missing boxes as an unsuccessful observation. Preserve the resting strip/input comparison and every current assertion.

## State + concurrency model

No application state changes. Each diagnostic owns one app and one independent cover with separate profiles. Serialize negative controls on a dedicated 1920×1080 Xvfb display to avoid sharing its native pointer. Close cover/app in fixture teardown and restore exact source/build mutations before the next experiment. Acceptance keeps normal one/three-worker execution.

## State transitions and identity reuse

| Event | Proof |
| --- | --- |
| Two upload completions mount distinct tiles | Existing named attachment test; diagnostic reuses `FIRST`/`SECOND` and `push` |
| First-tile hover then over-pointer cover | Controlled historical/protected observation, including pointer exit and nullable pill box |
| First-tile hover then corner focus control | Controlled historical/protected observation with actual bounds/focus |
| Protection deleted from initial windows | Serial candidate deletion negative control |
| Pointer leaves, second control focuses then blurs | Unchanged named attachment test |
| Subsequent send | Unchanged envelope absence and positive send assertions |

## Error handling

Diagnostic geometry explicitly records absent boxes. Historical missing box is a measured outcome, not a null dereference. Capture reports retain failures and teardown evidence. Do not claim historical causation without contemporaneous pointer evidence; #1818 remains unconfirmed.

## Testing strategy

- Controlled Linux/Xvfb comparison and serial protection deletion described above.
- Separate protected negative controls mutate only the built pill background and vertical offset. Run the unchanged named test, instrument actual hover at the failing boundary, retain exact patches and expected assertion failures, then restore the built renderer. Mutation never manufactures hover.
- Final candidate: named test 20 times with one worker, 20 with three, zero retries; then full default fake-transport gate with three workers and zero retries. Retain JSON, failure traces/context and named versus suite counts separately.
- After final main merge: dependency installation, full pre-verify check and `npm run build`. No live Claude test applies.

## Open Questions

- Does the independent native crossing reproduce the attachment box loss on historical code, and does protected main prevent it? Resolve with retained observations.
- Is a local correction needed? Resolve only after that comparison; evidence-only is preferred when protected code covers the boundary.

## Size check

One deliverable; four observable criteria; approximately 500–600 written lines including scratch diagnostic/evidence and this plan; zero new exports or production files; zero consumer migrations; fewer than ten diagnostic failure branches. No overlapping remote numeric feature branch touches the three relevant e2e paths at planning time. This is test-only work with no UI change and no Figma requirement.
