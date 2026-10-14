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
