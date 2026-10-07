# Host Edit control name-pill reliability (#1823)

## Files read

- `CLAUDE.md` and `docs/knowledge/INDEX.md`: repository conventions and owning topics.
- `e2e/sidebar-host-row-control-name-pill.spec.ts` → named Edit host test: preserve its complete contract.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: paired fake-transport launch and teardown.
- `e2e/fixtures/desktopIsolation.ts` → `launchIsolatedApp`, `ignoreDisplayPointer`: #1836 protects current and later shown windows from native input.
- `e2e/desktop-isolation.spec.ts` → independent-cover regression: competing input-enabled process exercises protection.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `controlNamePlacement`, `placeControlName`: synchronous pointer placement.
- `playwright.config.ts` → default fake-transport projects: explicitly disable retries and select worker counts.
- `docs/knowledge/features/e2e-harness-desktop-isolation.md` → Native display-pointer protection: controlled evidence and deletion mutation.
- `docs/knowledge/features/development-verification.md` → Layout and input: completed hover does not establish subsequent hover state.
- `docs/knowledge/features/channel-list-control-name-pill.md`: hidden pills have no box; pointer-following geometry is part of the contract.

## Change

Validate the unchanged named host-pill test on the merged #1836 fix (`2f2cca62`).
The retained failures for #1761 (`e0b178ce89`), #1660 (`9f8601f1bb`) and #1818
(`5d1b88adaa`) report null `after`, `after` and `before` boxes respectively,
followed by same-tree passes. They establish intermittent disappearance, but
contain no pointer-event capture proving its cause. Retained logs and rerun paths
are listed in [refinement evidence](https://github.com/pyrycode/pyrycode-desktop/issues/1823#issuecomment-6036645340).

The [#1813 causal report](https://github.com/pyrycode/pyrycode-desktop/issues/1813#issuecomment-6029766023)
and [#1836 verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1836#issuecomment-6031117734)
establish a shared native-pointer mechanism: an independent input-enabled cover
clears hover without protection; the protected case passes and deleting protection
fails. Attribution of historical host failures to that mechanism remains inferred.
If the unchanged spec stays green, resolve with counted evidence only. Product
presentation, fixture behavior and assertions require no speculative correction.
If it reproduces, capture actual hover, computed pill visibility and control/pill
geometry before teardown, then revise this plan before a local observation or
existing-fixture correction. No retries, timeout increases, arbitrary sleeps,
serialization or weakened assertions. No UI change or new state/API/failure mode.

In-flight remote branch scan found no overlap in the named spec or launch fixture.
Sizing: one reliability deliverable, approximately 100 written lines including
this plan and evidence; zero new exports or consumer migrations; three criteria.

## Testing strategy

- Build after dependency installation. Run the exact existing title for 20 repetitions
  with one worker and 20 with three workers, explicitly `--retries=0`; require
  40 executed/passed and zero failed/skipped.
- Preserve one host/Edit control, absent host Add workspace control, hidden resting
  pill, visible hover text, non-null boxes at both positions and changed horizontal
  position after ordinary Playwright mouse movement.
- Run the full default fake-transport suite with three workers and retries disabled
  as the ticket explicitly requires; verify the named test executed/passed and
  identify unrelated failures separately. No live-Claude work is required.
- After the final merge of main, run pre-verify and build. Retain JSON, logs and
  failure artifacts under `/tmp/builder-1823/`; record tested revision, Linux/Xvfb
  shown-window presentation, counts and paths on the ticket and PR.
