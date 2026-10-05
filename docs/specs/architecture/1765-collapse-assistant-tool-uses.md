# #1765 — Collapse assistant tool uses preference

## Files read

- `CLAUDE.md` and `docs/knowledge/INDEX.md`: renderer boundaries and reading map.
- `docs/knowledge/features/development-verification.md`: static renders cannot prove subscriptions or interaction.
- `docs/knowledge/features/push-notification-preference-store.md`: exact boolean encoding, null-versus-false hydration and injected storage precedent.
- `docs/knowledge/features/settings-screen.md`: Zustand server rendering reads initial state; test both switch states through the pure row view.
- `docs/knowledge/features/conversation-shell-tool-row-header-groups.md`, Adjacent tool runs: optional-off joins and the existing preference boundary.
- `src/renderer/src/store/pushNotificationPrefStore.ts` → `createPushNotificationPrefStore`: factory, singleton, hook and storage port.
- `src/renderer/src/screens/settings/PushNotificationRow.tsx` → `PushNotificationRowView`, `PushNotificationRowControl`: native switch and pure-view/container precedent.
- `src/renderer/src/screens/settings/SettingsScreen.tsx` → `SettingsScreen`: insert Thread between Notifications and Storage.
- `src/renderer/src/screens/settings/settings.css` → `.settings__notifications-row`, `.settings__switch`: reuse existing row, typography, spacing and switch tokens unchanged.
- `src/renderer/src/screens/settings/SettingsScreen.test.tsx`: section composition assertion seam.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ConversationScreen`, `Timeline`: replace the container's unconditional fold prop; keep Timeline's absent/false default.
- `src/renderer/src/screens/conversation/toolRuns.test.tsx`: both modes and optional-off equivalence already covered; add ordinary-row markup/join assertions.
- `e2e/push-toggle-persist-relaunch.spec.ts`, `e2e/multi-server-launch.spec.ts`, `e2e/tool-runs.spec.ts`, `e2e/fixtures/launchPairedApp.ts`: relaunch, two-host and tool-frame precedents.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=726-8150

Read design context and screenshot. Adapt only the Thread heading and “Collapse assistant tool uses” row to Desktop Settings. Reuse its section-header treatment and notification row CSS: body-large on-surface label, trailing 52×32 native switch, primary on track and existing dark knob, with existing spacing/radius tokens. Keep Desktop's Settings surface; the Mobile modal, close/Done controls and notification-sound row remain outside this change.

## Context

#1764 shipped tool-run folding enabled unconditionally. This preference lets the operator retain ordinary joined tool stacks across every host and conversation on this client. No ADR is needed.

Sizing: one preference behavior, two observable acceptance criteria; approximately 430–470 total written lines, four production files, five new exported types/components/stores (storage port, store type, singleton, two row components), two new consumer sites and no new error state machine. #409 added 328 lines including plan; this change reuses its CSS but also adds storage and relaunch/host tests. Both sketch and written-plan counts fit the ceilings.

In-flight overlaps: #1726, #1729, #1731 and #1789 touch `ConversationScreen.tsx`. Their queued-message, question and timeline identity/group changes need no interface added by this preference. Our changes stay local to an import, boolean subscription and existing fold prop; no shared block rewrite or dependency.

## Design

Add `collapseToolUsesPrefStore.ts` with a `CollapseToolUsesPrefStorage` port (`read(): boolean | null`, `write(value: boolean): void`) and `createCollapseToolUsesPrefStore(storage)`. Store shape holds `collapseToolUses: boolean` and `setCollapseToolUses(value: boolean): void`. Singleton, narrow React hook and selector mirror the push preference.

Use the separate client-owned key `pyry.collapseAssistantToolUses`. Recognize exactly strings `true` and `false`; missing/corrupt values hydrate to true. The setter persists before updating state. A window guard keeps singleton imports safe under Node. No new dependency, IPC, transport or wire surface.

Add `CollapseToolUsesRowView({ enabled, onToggle })` and `CollapseToolUsesRowControl`. The view uses the existing notification row/switch classes, native button `role="switch"`, matching visible/accessibility label and `aria-checked`; native Enter/Space activation fires the same callback as click. The control selects the boolean and writes through the setter.

Mount that control in Thread between Notifications and Storage. `ConversationScreen` selects the same singleton boolean and passes it to `Timeline.foldTools`, including retained/offline conversations. Timeline remains a pure props-driven view with its existing optional-off default and join/expansion logic unchanged.

## State + concurrency model

One synchronous renderer-local app-wide boolean, outside pairing/conversation resets. Zustand owns subscriptions and their teardown. No effects, async jobs, timers or streams are added. A mounted conversation re-renders on preference change; navigation and another host read the same singleton.

## Error handling

Absent or invalid stored encodings become null and resolve to enabled. Follow the precedent without adding speculative localStorage exception recovery, I/O error states or logging infrastructure; this preference never handles daemon data.

## Testing strategy

- Store unit tests: missing/corrupt default, exact true/false decoding, false/true round trips through fake storage, subscriber update and Node-safe port.
- Static renderer tests: Thread order/default mount, both accessible native switch states, existing folded header versus ordinary row markup and join classes. Static renders do not execute clicks or subscriptions.
- One ticket-owned fake-transport Playwright spec: click/Enter/Space, Settings-to-thread off/on round trip, retained conversation and second host, ordinary joined-stack geometry, and explicit off after full app relaunch via `reuseUserDataDir`.
- Capture Settings on/off at 800×800 and 1280×800 windows into `/tmp/builder-1765/`, inspect against Figma row treatment and record viewports in PR.
- After final main merge: pre-verify (typecheck/full units), build and the focused Playwright spec. No live-Claude tests required.

## Open Questions

None; the existing storage, Settings styling and Timeline boundary settle the implementation shape.
