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
