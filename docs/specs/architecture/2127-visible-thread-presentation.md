# Visible thread presentation

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/conversation-shell.md`: renderer boundaries and frozen-source reuse.
- `docs/knowledge/features/conversation-shell-scroll-pin.md`: `useThreadScrollPin`, committed geometry and reading intent.
- `docs/knowledge/features/development-verification.md`, `docs/recorded-tests.md`: mounted barriers and guarded captured replay.
- `src/renderer/src/screens/conversation/threadItemPresentation.ts`: `presentation`, `nest`, attribution and complete nonvisual projection.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx`: `ThreadItemsView`, `ToolRow`, independent chrome and read observation.
- `src/renderer/src/screens/conversation/foldToolRuns.ts`: root membership and failure metadata.
- `src/renderer/src/screens/conversation/threadComposerReports.ts`: independent complete projection consumer.
- `e2e/thread-items.spec.ts`: supplied complete snapshots, read publication and settled geometry fixtures.
- `src/renderer/src/screens/conversation/threadItems.test.tsx`: placement, unsupported facts and lifecycle assertions.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=155-553 and folded-run reference node `726-5376` (corrected references in the current GitHub ticket).
Preserve the existing single-line Lead/Subject/Count/Chevron header, token-based tool border, joins and depth classes. Expanded content uses the existing body. No style or asset changes.

## Context

The complete-thread route eagerly adapts and mounts descendants which cannot be seen. This slice makes local visibility control visual work; incoming-update batching and compact transport remain separate tickets. The design needs no ADR.

## Design

Introduce a metadata-only thread index sharing `nest` with the complete adapter. It retains source objects, attribution, placement, validity, counts, outcomes and the source of usage metrics without formatting bodies. Visible source rows obtain either their tool header or their existing complete presentation. Body-only command and denial formatting runs only when a body opens. Frozen complete presentation caching remains source-object based; nonvisual `threadItemPresentations` callers retain their current contract.

Keep expansion sets keyed by source IDs above unmounted row components. Determine ancestor/run visibility before mounting source rows; run and launch-marker proxies carry no source read authority. A row component performs demanded adaptation so hidden descendants cannot construct bodies. Bounded admission of newly visible rows yields between chunks; no prefetch or detail request occurs. Existing controls, prompt slot, reports and task drawer keep their independent inputs.

Use the existing scroll pin with visibility changes included in its presentation identity. Remember surviving controlling headers as fallback anchors when collapse removes the reading row. Explicit Go to agent still scrolls to its source card without opening that card.

## State + concurrency model

Expansion and admission are view-local state, scoped by host/chat/epoch. A cancellable timer admits bounded chunks of currently visible held rows; dependency changes cancel old work and unmount clears it. Closed rows are excluded immediately, including previously admitted descendants. Source revisions are read only by mounted rows; read observation continues to use committed source-row DOM and snapshots.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Expand, nested expand, collapse and reopen | mounted held-item workload; existing supplied-agent cases |
| Folded run open/close and member state reuse | mounted held-item workload; tool-run unit cases |
| Closed source revision then reopen | deferred-projection unit case and mounted workload |
| Prepend/reparent and launch/end placement | existing supplied-agent cases, adapted to unmount semantics |
| Reading row survives or collapses into header | mounted workload and existing settled-anchor checks |
| Scope/epoch replacement and unmount | existing supplied-agent scope loop; normal fixture teardown |
| Read attempt while closed and reopening revised source | existing committed-read scenario plus workload |

## Error handling

No new I/O or rejection modes. Unsupported facts retain escaped summaries. Existing independent error/approval/question and delivery surfaces stay outside local timeline visibility.

## Testing strategy

- Test first: deterministic metadata/header/body demand assertions, including closed revisions and frozen-source reuse; verify complete nonvisual adaptation remains unchanged.
- Adapt retained-DOM tests to source identity and member expansion across absence, preserving placement/navigation/anchor checks.
- Mounted Electron: at least 8333 inert held items, committed expansion progress before and after actual composer keyboard input within 1000 ms, eventual completion, nested/group toggles and read evidence. Use positive processing/commit barriers before absence assertions.
- Linux: affected units through pre-verify, build, affected supplied-thread specs, and configured captured replay; no fresh provider claim. Compare integrated screenshots with the existing Figma header.

## Open Questions

None. One visibility behavior slice; estimated 760 written lines including plan, tests and existing assertion migrations; three production files, at most three exports, three consumers, four observable criteria, no new reject machine. No in-flight feature branch overlaps the planned production files after remote refresh.

## Revisions

2026-10-19: Keep demanded adaptation in the existing `ThreadItemsView` render loop after visibility and bounded admission, rather than introducing another row component. Existing memoized `TimelineRow` and `TimelineToolRow` already provide the body render seam. Admit up to 256 new source IDs per turn with a cancelled-on-change timer; the 64-row prototype repeated layout reconciliation too often to complete the generated workload within its test deadline. `ThreadPin.layoutChanged` reuses the existing geometry reconciliation for local expansion, including the application's parent-owned pin. Removed reading rows fall back to a surviving controlling header at a visible offset; Go to agent admits its explicit destination immediately.

2026-10-19: Mounted application tool-group checks caught compensation undoing explicit navigation on the reveal-state cleanup render. Reconcile only geometry inputs, and record the post-navigation anchor immediately. The unchanged Go to agent and background-agent scenarios prove this on the parent-owned application pin; supplied fixtures alone would have missed it. Move the existing joined-border precondition after opening the run because closed members are now absent.

2026-10-19: Deferred usage keeps all matching ending metadata until visible demand, selecting the latest nonempty formatted reading just as the complete adapter does. A regression with a later empty ending failed before this correction. Completion assertions allow 120 seconds per large expansion under shared-runner load; the real input commit limit remains 1000 ms and expansion is never paused for input.
