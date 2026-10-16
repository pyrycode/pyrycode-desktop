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

## Revisions

2026-10-14 — Controlled diagnosis confirmed late metadata reflow after successful bottom/spacing polls can invalidate the one-shot newest-row read. At native 1280, empty draft, focusing the newest row's action synchronously changed content height from 1613 to 1641 at scrollTop 880 / viewport 733, yielding clearance −28 where the old assertion expected 0. After frame processing, clearance was 0 with focus retained. Frame diagnostics also captured ordinary hover growth from content 1585 to 1613 at scrollTop 852, transient clearance −28, then scrollTop 880 / clearance 0. This demonstrates the observation race, not the unrecovered original occurrence's cause; the two original logs remain unavailable.

The repair makes `expectSpacing(page, testInfo, warning, bottom)` observe geometry, input height, overflow and endpoint together on consecutive animation frames and require both stability and every original numeric invariant. Each poll attempt retains both snapshots in a test attachment. The scenario now additionally focuses the newest action after the original bottom checks at each width/draft state and proves settled clearance with that focus retained, making the demonstrated boundary part of the named regression. There is no production change or native-resize correction: resize was already complete in the controlled failure. No new type/state/failure mode; total final plan/test work remains below the 180-line forecast and all sizing ceilings.

Retained evidence: `/tmp/builder-1953/controlled.json` (1 executed, 1 intentional failure, 0 skipped), `/tmp/builder-1953/repaired-control.json` (same input: 1 executed/passed, 0 failed/skipped), and diagnostic patches alongside them. Separate persistent CSS negative controls still fail: `/tmp/builder-1953/status-mutation.json` observes stable above=17 versus 16, and `/tmp/builder-1953/padding-mutation.json` observes stable padding/newest clearance=1 versus 0 (each 1 executed, 1 intentional failure, 0 skipped). Those temporary controls are removed from the shipping spec. The issue evidence comment will retain commands and measured comparisons; normal parallel gate proof remains with dispatcher/verifier.

Final focused proof after merging main `9fddff32`: `xvfb-run -a npx playwright test e2e/composer-status-spacing.spec.ts --grep 'status spacing and measured input clearance hold with a warning and five-line draft' --repeat-each=20 --retries=0 --reporter=json --output=/tmp/builder-1953/final-results > /tmp/builder-1953/final.json` — 4 workers; 20 executed/passed, 0 failed, 0 skipped, 0 flaky; every result retry 0. Pre-verify passes all five checks on this tree. The full parallel fake-transport gate is pending with dispatcher/verifier.
