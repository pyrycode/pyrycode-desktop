# E2E harness — references

Related feature topics, architecture plans and historical fixture evidence. See the [harness overview](e2e-harness.md).

## Related

- [E2E test harness — scenario history](e2e-harness-scenarios.md) — the full chronological log this document was split from; every entry above from #93 onward has its detail there.
- Spec: `docs/specs/architecture/1091-launch-against-two-fake-daemons.md` — the original two-daemon design and its historical seed-push workaround. [Host-addressed conversation list lifecycle](../../specs/architecture/1363-host-conversation-list.md) replaces that workaround with request-driven rows.
- Spec: `docs/specs/architecture/1127-launch-fate-diagnostic.md` — the launch-fate diagnostic design and its `ChildProcess`-capture-at-`watch()`-time revision.
- [Window-presentation dev affordance](window-presentation-affordance.md) / [#1067](https://github.com/pyrycode/pyrycode-desktop/issues/1067) — the third `isPackaged`-false-first dev-only gate, letting a non-packaged build keep its window unshown; consumed by `desktopIsolation.ts` above.
- [App shell (router)](app-shell.md) / [#80](../codebase/80.md) — `routeForStatus`, whose unpaired outcome the smoke test now asserts (`.pairing`).
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md) — the shell the UI scenarios ([#93](../codebase/93.md), [#94](../codebase/94.md)) drive to after pairing; no longer what smoke asserts at boot.
- [#40 codebase notes](../codebase/40.md) · Spec: `docs/specs/architecture/40-e2e-electron-harness.md`
- [#105 codebase notes](../codebase/105.md) — made `smoke.spec.ts` hermetic on an unpaired boot (isolated `--user-data-dir` + `.pairing` assertion).
- [#433 codebase notes](../codebase/433.md) — extracted `launchPairedApp`, the shared fake-daemon pairing fixture both #93 and #94 now import; the intended home for future fake-daemon UI scenarios.
- [#435 codebase notes](../codebase/435.md) — repaired the list→thread drive #433 later extracted.
- [#420 codebase notes](../codebase/420.md) — extracted `e2e/fixtures/realDaemon.ts`, the real-stack sibling of `launchPairedApp.ts`, from `real-claude.spec.ts`; the intended home for future real-* scenarios.
- [#439 codebase notes](../codebase/439.md) / [Real-daemon credential-light e2e](real-daemon-credential-light-e2e.md) — added the claude-less spawn mode to `realDaemon.ts` and the first credential-light real-* scenario.
- [#434 codebase notes](../codebase/434.md) — `conversationStateFake`, the stateful fake-daemon sibling of `realDaemon.ts`'s credential-light mode; holds and mutates a conversation list across a real UI drive for the #422–#429 per-flow family.
- [#451 codebase notes](../codebase/451.md) — first `conversationStateFake`-riding per-flow scenario: FAB create-nav, the Channel-info sheet rename entry point, and the grown two-row Channel List.
- [#452 codebase notes](../codebase/452.md) — #451's independent sibling: the destructive archive → restore → delete lifecycle, fake-stack twin of [#440](../codebase/440.md).
- [#423 codebase notes](../codebase/423.md) — the third #422-family sibling: the save-as-channel promote dialog's scratch/dedicated branches; the two-block shape and captured-envelope compose-over idiom [#456](../codebase/456.md) reuses.
- [#456 codebase notes](../codebase/456.md) — the Workspace Picker sheet's recent-pick + create-folder round-trips; adds the shared `recent_workspaces` fake answer split sibling #457 reuses.
- [Conversation workspace change](conversation-workspace-change.md) / [#379 codebase notes](../codebase/379.md) — the `change_workspace` transport slice [#456](../codebase/456.md) drives and asserts on the wire, since its reply has no DOM reflection.
- [Recent-workspaces store](recent-workspaces-store.md) / [#382 codebase notes](../codebase/382.md) — the renderer store + bridge [#456](../codebase/456.md) exercises end-to-end via the picker's `recent_workspaces` request.
- [#425 codebase notes](../codebase/425.md) — the run-config sheet's model/effort/YOLO round-trip; the spec-local capturing-fake precedent applied to `set_session_settings`, plus the session-id + snapshot preconditions any future run-config scenario needs.
- [#457 codebase notes](../codebase/457.md) — the default-workspace preference reaching `create_conversation`'s `cwd`; the split twin of [#456](../codebase/456.md), reusing its shared `recent_workspaces` fake answer with a zero-verb-handling capturing wrapper and the race-free negative-guard-after-positive-poll pattern.
- [Default workspace store](default-workspace-store.md) / [#403 codebase notes](../codebase/403.md) — the `localStorage`-backed store [#457](../codebase/457.md) is the first e2e to drive.
- [#426 codebase notes](../codebase/426.md) — the permission/trust modal's five answer paths (default tap, confirm/Back, cancel, reject banner, remote dismiss); the FIFO-not-`in_reply_to` reject model that forces the two-block split.
- [#427 codebase notes](../codebase/427.md) — the queued-backlog render, dequeue, and interrupt flows, all server-push-driven; establishes why a flow does NOT need #423/#426's two-block split (no one-way residue) and the two-part act/capture/push-reflect assertion shape for non-optimistic push-reflected mutations.
- [#428 codebase notes](../codebase/428.md) — the stall indicator, screen snapshot, and debug-bundle download; the last of the reliability-affordance surfaces, covering a server push, a request→reply, and a chunked reply stream in a single launch.
- [#465 codebase notes](../codebase/465.md) — the paired region's inner navigation: the pair-another-server round-trip and the thread/settings/archive back-chain, plus the Cancel→Settings round-trip as the only realizable teardown proof when two routes render the same component.
- [#466 codebase notes](../codebase/466.md) — the push-notification toggle's relaunch persistence; the first two-launch scenario in the family, and the `reuseUserDataDir` fixture affordance (dir-reuse + drive-skip as one flag) it added to `launchPairedApp`.
- [#515 codebase notes](../codebase/515.md) — closed Gap A (`shouldRefreshList` now covers `conversationCreated`); zero e2e assertion changes, comment-only reconciliation across #440/#451/#452.
- [#546 codebase notes](../codebase/546.md) — deleted the retired `electronApp.ts` fixture (zero importers).
- [#517 codebase notes](../codebase/517.md) — closed the teardown-on-setup-failure leak in `realDaemon.ts`'s `page`/`relay` and `smoke.spec.ts`'s local `page`; added `withIsolatedElectronApp`.
- [#661 codebase notes](../codebase/661.md) — extracted `e2e/fixtures/pairingArrival.ts`, the shared
  unpaired-launch pairing-arrival step all ten drive sites (the fixture + nine `real-*` specs) now call;
  the one-line edit point #662 needs to change the unpaired entry point.
- [Push-notification preference store](push-notification-preference-store.md) / [#408 codebase notes](../codebase/408.md) — the `pyry.pushNotificationsEnabled` `localStorage` contract [#466](../codebase/466.md) is the first e2e to prove survives a full app relaunch.
- [ADR 0001 — Stack](../decisions/0001-stack-electron-react-typescript.md) — Electron + electron-vite emitting `out/main` · `out/renderer`, the layout the launch target depends on.
- Cross-project prior art: pyrycode `#68` shipped the same spawn+cleanup harness-primitive + one-smoke shape (Go, `internal/e2e/`), with UI scenarios as separate tickets. This mirrors that shape in TypeScript/Playwright.
