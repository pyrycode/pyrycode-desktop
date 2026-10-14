# Agent reparenting scroll reliability

## Files read

- `e2e/thread-items.spec.ts` → `rendererFixture`, supplied-agent width cases: injected snapshots, lifecycle/identity checks and the unprocessed programmatic park.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `useThreadScrollPin`, `rememberTop`, `syncRows`, `ThreadItemsView`: immutable-presentation restoration uses the most recently processed top anchor.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`: owning topics, renderer test and transport boundaries.
- `docs/knowledge/features/conversation-shell-scroll-pin.md` → Supplied snapshot anchor restoration: queued scroll events must finish before immutable updates.
- `docs/knowledge/features/development-verification-layout-and-input.md` → Layout and input: geometry alone does not prove input processing; baseline follows native settlement.
- `docs/knowledge/features/development-verification.md`: focused evidence and scope boundaries.
- `origin/feature/1936` changes: optional supplied read inputs remain disabled in the agent case. Shared-file overlap is additive, with no dependency or skipped agent assertions.

## Design source

Ticket reference: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4. This investigation changes test synchronization only unless independent evidence proves a product defect; no visual design change is planned.

## Context

Pin independent main at `bbcd894329a4a4410d0c10cd797e4f1bb05634d8`. The existing test can deliver reparenting before the park's queued scroll event records row 100, and can measure unchanged geometry before React renders the update. Green intermittent runs alone cannot distinguish these races from a retained-anchor defect.

## Design

Keep diagnostic and barrier helpers local to the spec. Observe scroll processing after React's target listener, and committed row state before preservation measurements. Establish native Home settlement and programmatic park processing, then require consecutive stable animation-frame measurements of offset, content/viewport dimensions and row position. Keep the original immutable baseline, position precision, bottom distance, DOM identity, expansion and lifecycle checks.

Use a controlled same-task park/update schedule on unchanged production to test the stale-anchor hypothesis, retaining event-order and geometry evidence outside the worktree. Compare the same schedule with processing/geometry barriers. Do not add timing sleeps, retries, timeout increases or new dependencies. Production repair requires an independent settled-reader reproduction; otherwise leave production untouched.

## State + concurrency model

No new production state or jobs. Local test listeners and frame sampling observe the existing scroller; remove listeners on completion. Fixture snapshot dispatch precedes React commit; DOM nesting/count assertions establish that commit before geometry comparison.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Home motion, then row 100 park | Both supplied-agent width cases: processed scroll plus stable geometry before baseline |
| Child 40 moves from stopped agent 30 to finished agent 10 | Both cases: committed order/count before unchanged row 100 position; retained child DOM and expansion |
| Older row 5 arrives | Both cases: positive rendered insertion before same baseline comparison |
| Host/chat/epoch reused | Existing scope loop remains intact and proves collapsed fresh agent state |

## Error handling

No new production failure modes. Missing processing, commit or correct stable geometry fails within existing Playwright assertion bounds with diagnostic measurements.

## Testing strategy

- Run unchanged main independently, then controlled ordering to obtain a deterministic pre-repair failure and event-order trace.
- Run the corresponding repaired controlled schedule; retain counts and cause limitations in Revisions and PR.
- Run each existing width case ten times, zero retries/skipped assertions; retain executed/passed/failed/skipped counts.
- Final main merge, pre-verify check and build. No live spec or full fake suite is required.

## Open Questions

- Does a processed, settled park still restore the wrong row? Resolve from independent reproduction before editing production.
- Which DOM change positively certifies reparent commit without relying on geometry? Resolve from the actual projected row order/count.

Sizing: one reliability deliverable, approximately 200 written lines, no exported API or consumer migration, three acceptance behaviours, no production reject branches.

## Revisions

2026-10-14: Resolved both open questions. This is a test setup race; production remains unchanged. A target scroll listener registered after React records processing. The held baseline requires a newer processed event at the current offset plus 20 identical frame samples of offset, content/viewport dimensions, row position and processing count. Agent 10/30 child counts certify reparent commit; rendered row 5 certifies insertion. The fixture adds `commitUpdate(update: ThreadUpdate): void`, using `flushSync` only for the agent regression, to commit immediately after readiness in the same renderer task. This removes incidental protocol-task delay as a source of green results. Scope reset leaves optional read observation disabled, including after a future #1936 merge.

Independent production revision for every diagnosis run: `bbcd894329a4a4410d0c10cd797e4f1bb05634d8`, Linux x86_64, Electron 33, isolated Xvfb displays, zero retries.

- Unmodified main spec: `main.json`, 20 executed/passed, 0 failed/skipped (10 per width). This alone did not diagnose the intermittency.
- Forced park/immediate synchronous commit, instrumented hook: `control.json`, 2 executed, 0 passed, 2 failed, 0 skipped. Both widths parked row 100 at y=0, offset 810; restoration used Home's marker anchor at top 97 before any parked scroll processing, then committed at y=720, offset 0. The original <0.5px assertion failed at both widths.
- Same forced commit after parked scroll processing: `processed-control.json`, 2 executed/passed, 0 failed/skipped. Scroll processing occurred at offset 810 before commit; restoration selected row 100 at top 0, committed at offset 720/y=0, and the older insertion retained y=0.
- Shipping regression with only its park-readiness waits removed: `pre-repair.json`, 2 executed, 0 passed, 2 failed, 0 skipped. Both fail the unchanged position assertion with y=720 instead of 0, after the new child counts have committed. This proves deterministic sensitivity to the repair rather than an incidental intermittent pass.
- Shipping regression after repair: `final.json`, 20 executed/passed, 0 failed/skipped/flaky; each width executed/passed 10 times, every attempt retry 0. The original position precision, bottom distance, child identity, expansion, lifecycle and scope-reuse checks all execute.

These controlled interventions reproduce the reported displacement and distinguish stale setup from a settled-reader defect; the original #1936 failure's event trace was not available, so they do not claim to recover its exact schedule. Raw reports, scratch variants and the barrier-removal patch are retained under `/tmp/builder-1964/`.

Commands: the baseline and shipping repetition runs use `xvfb-run -a npx playwright test e2e/thread-items.spec.ts --grep 'supplied agents repair nesting' --repeat-each=10 --retries=0 --reporter=json` with separate scratch output directories/reports. Controlled variants use `--config=/tmp/builder-1964/{controls,pre-repair}/playwright.config.ts`, the same grep and `--retries=0`, without repetitions. No timing sleeps, timeout changes, relaxed tolerances, skipped assertions or post-update baseline resets were introduced.

Closing checks after the final merge of main (already up to date at the pinned revision): pre-verify PASS, 5 checks, 10,138 unit tests passed and 3 existing unit skips; `npm run build` PASS. The entire focused `e2e/thread-items.spec.ts` run (`spec.json`, `--retries=0`) executed/passed all 10 cases, 0 failed/skipped/flaky, including both agent cases. No live tests changed or required. Final written work remains below the 200-line estimate and every sizing ceiling.
