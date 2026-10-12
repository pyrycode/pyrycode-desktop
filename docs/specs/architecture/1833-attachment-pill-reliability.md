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

## Revisions

2026-10-12 — Both open questions are resolved: the controlled historical comparison reproduces hover loss and box disappearance, while merged #1836 prevents it on protected main. Resolve with evidence only; no shipping test, fixture, UI or transport correction is needed. The attachment spec is byte-identical to `188fd6b7` throughout final acceptance.

All controlled runs used Linux x86_64, Electron 33.4.11, a dedicated Xvfb 1920×1080 display, shown 1100×800 app windows, one actual worker and zero retries. Two scenarios executed/passed per valid comparison, with zero failures, skips or flaky results. Complete raw observations, exact diagnostic/deletion patches and JSON reports remain in `/tmp/builder-1833/`.

| Revision / report | Over-pointer arm | Corner focus control |
| --- | --- | --- |
| Historical `188fd6b7`, `historical-final.json` | One new `pointerout`, slot hover true → false, focus-within false, display block → none, pill box present → null | Native app focus true → false; hover stays true, display block, identical pill box, zero new exits |
| Protected main `f2e0d6104c9593e83bfc0241d506b118def8bc52`, `protected-final.json` | Zero new exits; hover true, focus-within false, display block, identical pill box | Same retained hover/box despite native focus loss |
| Same protected main with only initial-window protection deleted, `deleted.json` | One new exit, hover loss and null pill box, matching historical code | Native focus loss with retained hover/box, matching historical control |

Each arm confirms actual cover bounds: over-pointer `(860,440,200,200)` contains native cursor `(960,540)`; corner `(0,0,200,200)` excludes it. The app bounds are `(410,140,1100,800)`. Historical native exit coordinates `(550,373)` differ from the injected tile hover `(482.5,619)`. The slot never has focus-within, excluding keyboard focus as the pill trigger. Every renderer snapshot includes all six nullable boxes, pointer events and timestamps; strip height and input-row y remain at their resting baselines. Native cover focus becomes true and app focus becomes false in both arms. Renderer `document.hasFocus()` stays true and is retained without interpreting it as native focus.

Observations are in `historical-observations/`, `protected-observations/` and `deleted-observations/`. Their corresponding `*-final-artifacts/` or `deleted-artifacts/` folders contain Playwright attachments. The exact local diagnostic is retained in `main-diagnostic-final.patch` and `historical-diagnostic-final.patch`; the isolated variable is in `delete-initial-protection.patch`. No launch-source guard was changed; independent launches stayed in its existing allowed `desktop-isolation.spec.ts` site.

Separate protected CSS negative controls each execute the original named test once, at attempt 0, and fail the relevant original assertion with actual hover true, focus-within false, display block and a present 24px pill box. `background.json` fails `expect(drawn).toEqual` on transparent background. `offset.json` fails the exact bottom/composer-top equality after changing bottom to `100%` (589px versus 581px). Exact before/after declarations, actual-hover observations, failure traces and error context are retained in the corresponding mutation JSON/observation files and `background-final-artifacts/` / `offset-final-artifacts/`. All source and built CSS mutations were restored byte-for-byte before final acceptance.

These experiments establish protection of the retained #1819 geometry boundary's reproduced mechanism, not contemporaneous proof of its historical trigger. The overwritten original #1818 failure remains explicitly unconfirmed.

Diagnostic setup failures are retained separately and excluded from acceptance: the first protected comparison incorrectly required renderer document focus to track native focus; that assumption was replaced with actual native focus. Initial historical runs never reached a window because a sibling `historical.json` shadowed the `historical/` app directory during Electron module resolution; relocating the preserved report fixed startup without source/launch changes. Initial fully anchored grep controls selected zero tests because Playwright includes project/file prefixes; final commands use the exact unique title suffix, and counts must be nonzero. No setup failure is called a pass.
