# Markdown reader scroll preservation

## Files read

- `e2e/markdown-reader-menu.spec.ts` → `settledThreadPosition`, layout cases: baseline, native resize/zoom and exact Back assertion.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `useThreadScrollPin`, `rememberTop`, `reassertPinnedToBottom`, `measureThreadChrome`: mounted covered thread, native geometry and following state.
- `playwright.config.ts` → clipboard project isolation, configured workers and retries.
- `docs/knowledge/features/conversation-shell.md` and `conversation-shell-markdown-reader.md`: covered thread/composer remain mounted; every open reads afresh.
- `docs/knowledge/features/development-verification-layout-and-input.md` → Layout and input: stable measurements alone do not acknowledge processing or intent.
- `docs/knowledge/features/development-verification-layout-evidence.md` → Reader reopen input verification: preserve the prior focus/hover repair and distinguish controlled interventions from historical traces.
- Root `CLAUDE.md`, `docs/knowledge/INDEX.md`, shared working practice and visual review: test and publication boundaries.

## Design source

https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=756-10358 — existing full-pane reader beside the sidebar, Back/title/menu across its top. Screenshot inspected. Preserve presentation and tokens; this investigation introduces no visual redesign.

## Context

The historical 800px comparison was 1300 versus 1020 after native resize/zoom. An unchanged rerun passed; no captured original sequence establishes causation. Diagnose the boundary before repairing it. No ADR is needed. No overlapping in-flight feature branches were found for the two candidate files.

## Design

Keep diagnostics local to the reader layout scenarios. Record baseline, each native resize/zoom transition and Back: thread offset/content/viewport, link bounds, native window/content size, zoom and active focus. Attach evidence in a test-wide finally so failures before reopen retain it.

Use a controlled ordering at the observed boundary to distinguish an unprocessed resize/input baseline from lost settled state. Repair only the demonstrated boundary: a positive readiness acknowledgement in this spec if setup is racing, or the existing scroll pin if settled following is lost. Record the demonstrated mechanism and final contract in Revisions before implementation handoff. Keep the immutable positive baseline, exact equality before reopen preparation, draft, all geometry/input/menu checks and fresh-read correlation.

## State + concurrency model

No new application state, subscriptions or jobs. Diagnostic listeners, if needed, belong to the launched test page and are removed at scenario completion. Native resize/zoom requests and renderer layout/scroll processing are separate phases; geometry sampling must acknowledge the requested state.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Initial open and focus normalization | Both existing `reader scrolls under sharp chrome with dynamic clearance and input at ...` cases; positive settled baseline |
| Other size then original size; 125% then 100% at each | Same cases; phase diagnostics and controlled regression at the demonstrated boundary |
| Pointer Back then same-path reopen | Same cases; exact original offset/draft, fresh read and unique request IDs |
| Keyboard Back | Same cases; reader closes |

## Error handling

Retain existing injected refresh/open/save failures and static notices. Diagnostics must survive assertion failure without hiding the original error. No new production failure mode.

## Testing strategy

- Observe the controlled case fail for the diagnosed reason before the repair; retain its measurements and outcome.
- Run both native layout cases ten times each, without retries. Run the complete configured Linux fake suite with unchanged projects, worker/retry configuration and no selection overrides; record revision, counts, workers, skipped/flaky and setup/top-level errors.
- After the final main merge run pre-verify and build. No live tests required; macOS is outside verification scope.

## Open Questions

- Does geometry processing change following state across resize/zoom, or does the initial baseline lack input/processing readiness? Resolve from phase evidence and a controlled intervention, not unchanged passes.
- Is a local positive barrier sufficient? Prefer that smaller shape if the evidence supports it; otherwise make a bounded correction in `useThreadScrollPin`.

Sizing: one deliverable, four acceptance behaviours, approximately 250–400 written lines including plan/evidence, no new exported symbols or consumer migrations, no new error branches; below all builder limits.

## Revisions

2026-10-16 — Controlled native upward wheel input before ordinary opening reproduced settled-position loss: 800px baseline 1460, content 1993, viewport 340×533; after the unchanged resize/zoom round trip and Back, 1020 with identical dimensions/content. Full phase evidence is in `/tmp/builder-2047/held-control.json` and `held-800.json`. The 1280px sibling passed. Initial unmodified-input diagnostic and same-task resize/zoom controls each passed 6/6; neither establishes the historical schedule. The controlled failure is a genuine loss of settled covered state, rather than a claim to have recovered that unavailable trace. Initial pointer delivery can produce differing following states; equal settled geometry does not identify following intent.

The hidden thread remains mounted but native resize clamps its offset. A released reader does not re-pin when its original dimensions return, so the clamped offset persists. Keep a local covered-position record in the existing scroll pin, captured from its last processed offset and viewport before the first covered viewport change. Capture before either native scroll handling, resize observation or a React layout effect can replace those readings. When the original viewport returns, restore its recorded offset; retain existing following semantics. Clear the record on uncover/scope exit, and capture anew on subsequent opens. If Back occurs at different dimensions, retain the current native position. This adds no listeners, asynchronous jobs, exported contract or visual change.

The existing two layout cases retain the controlled upward input, prove it moved, settle before opening, and keep the exact original baseline through all assertions. Each native viewport/zoom phase also settles measured thread geometry. Add a second resize round trip during reopen to prove the record belongs to that open. Existing keyboard Back proves the second restoration before teardown. Both open questions are resolved by this bounded production repair; a readiness-only change cannot repair the captured settled-state loss.

## Controlled evidence

Linux control before the active repair: 2 executed, 1 passed (1280), 1 failed (800), zero skipped/flaky/retries and no setup/top-level errors. The 800px exact Back assertion was expected 1460, received 1020. Adding measured settlement at every later phase also retained that failure (`repaired-once.json`, before the covered-element guard was corrected). This distinguishes persistent loss from a late-but-correct resize commit. These controls do not identify the unavailable historical 1300px baseline's event ordering.

Selected 800px phases below preserve the failing sequence and a repaired sequence. Each column keeps its own immutable baseline; their initial offsets differ because the native input schedules differ. Complete link bounds, timestamps, scroll events, native content sizes and focus tuples remain in `held-800.json`, `repaired-800.json` and the report's `thread-scroll-phases` attachments under `/tmp/builder-2047/`.

| Phase | Native size / zoom | Thread viewport / content height | Failed top | Repaired top | Focus |
| --- | --- | --- | --- | --- | --- |
| Draft filled | 800×600 / 1 | 340×533 / 1993 | 1460 | 1460 | Composer |
| Upward input settled | 800×600 / 1 | 340×533 / 1993 | 1260 | 1448 | Composer |
| Reader opened | 800×600 / 1 | 340×533 / 1993 | 1460 | 1448 | Body |
| Settled baseline | 800×600 / 1 | 340×533 / 1993 | 1460 | 1448 | Back |
| Before resize | 800×600 / 1 | 340×533 / 1993 | 1460 | 1448 | Note actions |
| Resized | 1280×800 / 1 | 820×733 / 1513 | 780 | 780 | Note actions |
| Zoomed | 1280×800 / 1.25 | 564×578 / 1753 | 780 | 780 | Note actions |
| Zoom restored | 1280×800 / 1 | 820×733 / 1513 | 780 | 780 | Body |
| Original size restored | 800×600 / 1 | 340×533 / 1993 | 1020 | 1448 | Body |
| Zoomed | 800×600 / 1.25 | 180×418 / 6513 | 1020 | 1448 | Body |
| Zoom restored | 800×600 / 1 | 340×533 / 1993 | 1020 | 1448 | Body |
| Before Back | 800×600 / 1 | 340×533 / 1993 | 1020 | 1448 | Body |
| After Back | 800×600 / 1 | 340×533 / 1993 | 1020 | 1448 | Body |

Native content sizes are 800×573 and 1280×773 respectively (window chrome occupies 27 native pixels); zoom changes renderer CSS dimensions, not native size. The repaired reopen begins at 1280×800 and preserves its new 780px baseline through a second round trip and keyboard Back. The 1280px sibling reopens at 800×600 and preserves 1460px, proving the first open's 780px record is not replayed.

## Validation evidence

Linux, Electron 33.4.11, source revision `ac53be8802030534a2cfbbd598e8ccf6904ce038` after merging main `2aa12e5debd4`. The following commit adds plan evidence only. The controlled failing production baseline was `1700f67f` (spec-only HEAD `a57008c1`) with local diagnostic/native-input test changes.

- Pre-verify: all five checks passed; 391 unit files passed, 9050 tests passed, 3 skipped. `npm run build` passed afterward. Logs: `/tmp/builder-2047/pre-verify-native.log` and `verified-build.log`.
- Focused: `npx playwright test e2e/markdown-reader-menu.spec.ts -g 'reader scrolls' --repeat-each=10 --reporter=list,json`; 20 executed/passed, 10 per native size, 0 failed/skipped/flaky/retries, 0 setup/top-level errors, one concurrent clipboard worker. Logs/reports: `focused-10.log` and `focused-10.json` under `/tmp/builder-2047/`.
- Complete configured suite: `npx playwright test --reporter=list,json`, no selection overrides; original clipboard/parallel projects, inherited `PW_WORKERS=2`, two actual workers, zero configured/executed retries. 438 selected, 435 executed/passed, 0 failed/flaky, 3 skipped, 0 setup/top-level errors; duration 772.899 seconds. The skips are the two macOS app-badge cases and macOS window-reopen case. Logs/reports: `/tmp/builder-2047/full-suite.log` and `full-suite.json`. No unrelated tracked failure was encountered. macOS is outside this ticket's verification scope.
- Initial diagnostic launches failed before assertions because Electron's install was incomplete; `npm rebuild electron` repaired it. The first pre-verify had 116 failures from the missing SQLite binding; documented `npm run rebuild:node` repaired host tests, then `npm run rebuild:electron` prepared the complete Electron suite. These setup failures are separate from the controlled scroll assertion failure and the final green runs.
- Visual inspection: `/tmp/builder-2047/resting-800.png` and `resting-1280.png`, native 800×600 / 1280×800. Existing reader/sidebar/header presentation is retained against the referenced Figma screenshot; no presentation change or unresolved deviation was introduced.
