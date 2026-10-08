## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `useThreadScrollPin`, `reassertPinnedToBottom`, `Timeline`: one caller, direct-child rows, hidden tool groups and existing intent/echo/prepend safeguards.
- `docs/knowledge/features/conversation-shell-scroll-pin.md` → Thread scroll pin, Inline question growth, User demand and prepend position: native anchoring, measured chrome and detached questionnaire retention.
- `docs/knowledge/features/development-verification.md` → browser effects and evidence barriers: count only hook work after setup; positive growth must precede assertions.
- `e2e/thread-scroll-pin.spec.ts`, `e2e/translucent-thread-controls.spec.ts`, `e2e/fixtures/launchPairedApp.ts` → fake daemon, streaming and chrome regressions.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, agents `docs/working-practice.md`: repository boundaries and checks.

## Context

Every scroll/render currently copies and searches children, and every render re-observes all rows. This slice bounds that work without changing appearance, layout, wire contracts or scrolling intent. No ADR needed. The unrelated `feature/suggestion-quieter-tab-sends` overlaps only composer code; no dependency.

## Design

Keep a DOM-local row index in the hook: direct children in document order, a position map, and an ordered array containing only non-gap positive-height children. Initial setup and direct-child membership changes rebuild the index and reconcile observer targets, unobserving removed/replaced rows. Unchanged membership does not enumerate children.

`rememberTop` binary-searches eligible rows by bottom against the greater of thread top and measured header bottom, then records that row's relative top. The eligible array excludes collapsed rows, whose rectangles are not monotonic. Eligibility updates measure only changed rows, and insert/remove by cached position; array movement on collapse/expansion is acceptable, but ordinary positive-height growth neither rebuilds nor traverses the index.

A mutation observer detects actual direct-child changes and visibility-relevant mutations. Pending records are consumed before lookup/layout synchronization, ensuring a committed collapse is reflected before resize delivery. Descendant mutations refresh only their containing direct child; text growth never rebuilds membership. Resize entries also update eligibility for intrinsic/stylesheet growth without DOM mutations. Chrome/root observations reconcile a constant-size target set.

## State + concurrency model

All state remains refs/DOM-local. One mutation observer and one resize observer belong to the pane/thread root. Root replacement disconnects both, clears cached children and reconciles fresh targets; teardown releases every DOM reference. Mutation callbacks and layout effects share synchronization. Resize callbacks read current refs, update only delivered row entries, measure chrome and retain the guarded bottom pin. Native anchoring, following, direction and pin-echo safeguards remain intact. Structural prepend compensation retains its permitted full measurement.

## Error handling

No new I/O, result types or failure modes. Empty eligible sets record no anchor. Detached nodes are removed from observations and indexes.

## Testing strategy

- New fake-transport browser spec compares settled short and 400-row threads: hook-only geometry reads during deep scrolling and repeated same-row visible growth must scale logarithmically; row observe calls remain zero after setup.
- Test-local instrumentation distinguishes the pin's observer from read observation by its pane target, and uses captured native geometry methods for oracle reads.
- Exercise gaps and long hidden runs, expansion, replacement/removal and root/teardown cleanup. Existing scroll-pin and translucent-controls specs cover prepend, small upward intent, send, late images and resize/zoom.
- Run new performance assertions on recorded pre-fix main `214d15625f51495c2e07772d320003dc1eec7588` before implementation; record failures and repaired counts in Revisions/PR. Static renderer tests cannot execute these effects.
- Final main merge, pre-verify check and build; no live specs change.

## Open Questions

None. Size check: one deliverable, approximately 550 written lines, zero exported types/components, one production caller, four acceptance behaviors and no new reject branches.
