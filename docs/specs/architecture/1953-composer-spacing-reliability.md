# #1953 — composer status spacing reliability

## Files read

- `e2e/composer-status-spacing.spec.ts` → `expectSpacing`, `distanceFromBottom`: existing exact geometry contract and separate endpoint observation.
- `e2e/fixtures/composerWindowSetup.ts` → `configureComposerWindow`: native outer/content size and zoom confirmation.
- `e2e/fixtures/launchPairedApp.ts` → `test`: isolated fake transport and teardown diagnostics.
- `playwright.config.ts` → default parallel project: preserve concurrency, retries and timeout settings.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `measureThreadChrome`, `reassertPinnedToBottom`, `useThreadScrollPin`: resize/row observations and following semantics.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, `docs/knowledge/features/development-verification.md`, `docs/knowledge/features/development-verification-layout-and-input.md` → measured reflow, focus, wheel and stability boundaries.

## Design source

Existing status row: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=111-3525. Inspected reference `/tmp/builder-1953-figma.png`: horizontal status text and trailing controls. This is test reliability work; no visual redesign.

## Change

Retain the entire native 1280/800, warning absent/present, empty/five-line draft and bottom/scrolled matrix and every numeric assertion. First retain diagnostic measurements around the existing observations and reproduce a failing boundary; then correct only that demonstrated boundary locally in this spec. The two original gate logs are absent on this runner, and the unchanged baseline passed 20/20; neither establishes the original cause. Prefer a joint renderer observation of layout and settled scroll state over separately successful polls followed by a one-shot endpoint read, if evidence confirms timing interference. Do not add sleeps, retries, increased timeouts, suite serialization, shared harness changes or speculative production changes.

No overlapping remote feature branch changes this spec (checked after fetching). One deliverable; forecast at most 180 written lines, no new exported types/components/stores, no consumer migrations, three observable acceptance criteria, no product state machine. Recount after diagnosis before committing the repair.

## Testing strategy

- Run the unchanged named test under Linux/Xvfb with normal parallel workers, zero retries; retain baseline JSON and any failure artifacts under `/tmp/builder-1953/`.
- Capture synchronous dimensions, scroll metrics, newest-row clearance, hover/focus and successive animation-frame observations to distinguish unsettled test input/reflow from persistent product geometry.
- Retain a controlled failure and comparison that identifies the repaired boundary; add sensitivity evidence that an actual spacing/clearance regression still fails.
- After repair, run the named test 20 times with zero retries and failures; report executed/failed/skipped counts and exact command on the issue/PR. Dispatcher/verifier own its normal parallel fake-transport gate result.
- After the final merge of main: pre-verify check and `npm run build`. No live tests change.

## State transitions and identity reuse

The existing named scenario covers repeated native resize, warning replacement, draft replacement, bottom arrival and upward wheel movement. Any local measurement state is scoped to one observation; no product lifecycle/identity state changes.
