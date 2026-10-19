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

2026-10-19 rework: Verifier findings 1–4 repair the existing deferral invariant, with no additional behavior slice. Cache frozen header presentations separately from complete bodies; mutable sources remain uncached and revisions retain source-object identity. Resolve controlling headers through the scroll pin's direct-child membership index, refreshed on membership/identity changes and cleared on teardown, rather than querying source rows on every anchor measurement. The unchanged short/long read-work regression covers ordinary deltas; the held workload covers both local collapse anchor paths. Migrate collapsed-content tests to committed absence and inspect members only after opening their run; count remount execution explicitly in settled-row coverage. Put the workload's folded tools before the agent subtree and assert they are above the reading row before collapsing. The only overlapping branch, `feature/suggestion-quieter-tab-sends`, edits the separate Composer function; no dependency. Estimated repair: 160 written lines, no new exported declarations, no consumer signature changes; combined ticket remains below 800 lines.

## Validation evidence

Linux x64, main `fa9e20e7fe3f` merged. Final selected units: 43 executed/passed, zero failed/skipped across deferred presentation, supplied items, tool runs and composer reports. Mounted checks: 12 ordinary supplied-thread cases, four application tool-group cases and the generated held-item case each passed, zero skipped. The final workload held 8334 items: 516 source rows mounted before input and 1028 at the real composer commit, 296.5 ms from request to commit, followed by positive progress and complete expansion. It also passed closed-revision commit, visible-only publication, nested/group state retention and both anchor checks. Reports: `/tmp/builder-2127/thread-items-final.json` retains the earlier completion-deadline failure; `/tmp/builder-2127/workload-final.json` retains the final passing workload and latency attachment.

Pre-verify passed all five checks on the final production tree; final build, docs guard and client-test typecheck passed. Guarded `daemon-built thread streams, places an agent, reconnects, resets and reopens saved items` replay passed: one executed/passed, zero failed/skipped, zero forbidden launches, original assertions and strict requests retained. `/tmp/builder-2127/replay-final.log` retains the run; capture provenance remains Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf` in `e2e/recordings/claude-thread.json`. No fresh provider behavior or second-OS verification is claimed; the dispatcher owns full acceptance. Visual captures at 1280×773 and 800×773 are under `/tmp/builder-2127/`.

### Rework validation, 2026-10-19

Linux x64, main `ebdf6ddf59d4` merged. The new repeated-header identity assertion failed before the cache fix and passed afterwards. Pre-verify passed all five checks; build, docs guard and client-test typecheck passed. Focused units: 44 executed/passed, zero failed/skipped. Mounted regressions: 13 executed/passed, including every previously failing gate identity; unchanged short/long read setup recorded zero constructors, discovery, listeners and subscriptions. Supplied-thread/application group checks: 17 executed/passed, including the 8334-item workload with 516 mounted rows before input, 772 at composer commit, 37.9 ms input latency, subsequent expansion progress and eventual completion. Both anchoring assertions passed with the folded run positively located above row 100. No assertions were skipped. Reports: `/tmp/builder-2127/rework-mounted.json` and `rework-held-and-groups-retry.json`. The first held/group invocation received SIGTERM before emitting a result report; its empty JSON/stderr remain under the `rework-held-and-groups` prefix. All its application processes stopped before the completed rerun.

Guarded captured thread replay: one executed/passed, zero failed/skipped and zero forbidden launches, with original assertions, strict requests and unchanged capture provenance above. `/tmp/builder-2127/rework-replay.log` retains the run. Fresh integrated application captures at 1280×773 and 800×773 are `/tmp/builder-2127/rework-tools-1280-expanded.png` and `rework-tools-800-collapsed.png`; headers, joins and indentation remain consistent with the Figma reference. Full acceptance belongs to the dispatcher; documentation remains pending below. No live provider or second-OS claim.

## Documentation handoff

- Pending documentation stage: `docs/knowledge/features/conversation-shell.md`, What it does / How it works: replace retained-hidden-DOM descriptions with deferred presentation, unmounted descendants, source-ID expansion retention and independent composer-report/notification behavior.
- Pending documentation stage: `docs/knowledge/features/conversation-shell-scroll-pin.md`, Thread scroll pin / Supplied snapshot anchor restoration: document bounded admission, scope cancellation, membership-indexed controlling headers and fallback anchoring, and committed visible-source read authority.
- Pending documentation stage: carry the counted Linux workload/replay evidence, original failed completion run, provenance and verification limits into those sections. Distinguish this behavior from incoming-update batching (#2079) and compact activation (#2128).
