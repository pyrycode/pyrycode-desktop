# #1656 — Text that names Claude names the conversation's agent

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx`
  - `bannerDisplayText`, `ComposerBannerReport`: the "Claude: " banner prefix, on the timeline row and on the composer status.
  - `stoppedTurnText`: "(Claude reported: …)". `Timeline` renders it through `TimelineRow`. `Timeline`'s filter and `ComposerErrorSlotControl` use it only as a null check.
  - `Timeline`, `TimelineRow`: need an optional `agent` to pass down.
  - `ConversationScreen`: `openAgent`, which #1653 added through `selectConversationAgentFor`. It is the value passed to `<Timeline>` and `<BackgroundTaskPanel>`.
  - `ComposerErrorSlotControl`: mounts `ComposerBannerReport`. It reads `open` from the active-conversation store.
  - `ChannelInfoSheetView` / `ChannelInfoSheet`: the Session section's "Claude version" row.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx`
  - `useConversationAgent`: #1651's per-id agent hook, exported, which resolves the owning host and then calls `selectConversationAgentFor`. It is reused by the two containers above that have no `openAgent`.
  - `RunConfigView` (already has `agent`), plus `YoloSection` and `ContextWindowSection`, the caption and the explainer.
- `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx`: `BACKGROUND_TASK_PANEL_EMPTY_SUPPORT`, `BackgroundTaskPanelView`, `BackgroundTaskPanel`.
- `src/renderer/src/screens/settings/PushNotificationRow.tsx`: `PUSH_TOGGLE_LABEL`.
- `src/renderer/src/screens/conversation/ComposerEffortMenu.tsx`: `agentName`. This is the #1651 precedent for `agent === 'codex' ? 'Codex' : 'Claude'`, which the change mirrors.
- `e2e/push-toggle-persist-relaunch.spec.ts`: `pushToggleName`.

No in-flight feature branch touches these files.

## Design source

- **Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=119-3843 (banner / stopped-turn rows)
- **Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-48 (channel info)
- **Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-100 (run configuration sheet)
- **Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=17-64 (settings push toggle)

These frames draw the Claude wording: the YOLO caption "Claude runs commands without asking for confirmation. Use carefully.", the explainer "…dropped from claude's view…" and the toggle "Push notifications when claude responds". Only the words change. No layout, token or class moves. The background-task panel has no drawing (#580).

## Change

Each string is chosen from a client-owned name keyed on a `WireAgent`. The name is never the raw value. Each file uses its own local ternary, `agent === 'codex' ? 'Codex' : 'Claude'`, following the `ComposerEffortMenu` precedent. The lowercase explainer uses `'codex' : 'claude'`. Every new parameter or prop is optional and defaults to `'claude'`, so the existing call sites and the e2e specs stay byte-identical.

- `bannerDisplayText(report, agent = 'claude')` and `ComposerBannerReport({ report, agent? })`. `ComposerErrorSlotControl` reads `useConversationAgent(open?.id ?? null)` and passes it.
- `stoppedTurnText(item, agent = 'claude')`. Only `TimelineRow`'s `turnBoundary` arm passes an agent. The null-check callers do not change.
- `Timeline` gets `agent?: WireAgent` and passes it to each `TimelineRow`. `TimelineRow` gets `agent?` for its banner and turnBoundary arms. `ConversationScreen` passes `agent={openAgent}` to `<Timeline>`.
- `ChannelInfoSheetView` gets `agent?`, and the version row label becomes `${name} version`. The field key `claude_code_version` stays, because it is the wire's truncation key. `ChannelInfoSheet` reads `useConversationAgent(conversation?.id ?? null)`.
- `BackgroundTaskPanelView` and `BackgroundTaskPanel` get `agent?`. The empty support line is now two constants selected by agent. `ConversationScreen` passes `agent={openAgent}`.
- `RunConfigView` passes its existing `agent` to `YoloSection` and `ContextWindowSection`.
- `PUSH_TOGGLE_LABEL` becomes `'Push notifications when an agent responds'`. There is no conversation there, so the wording is neutral.

## Testing strategy

These are static-render vitest additions beside the existing assertions. The Claude cases already exist and stay unchanged, which proves the byte-identical requirement.

- `banner.test.tsx`: a Codex `<Timeline agent="codex">` banner row and `<ComposerBannerReport agent="codex">` both read "Codex: …" and never "Claude:".
- `stoppedTurn.test.tsx`: `stoppedTurnText(…, 'codex')` gives "(Codex reported: overloaded)", and `<Timeline agent="codex">` draws it. The explicit `'claude'` case equals the default.
- `SessionFacts.test.tsx`: Codex gives "Codex version" and no "Claude version".
- `BackgroundTaskPanel.test.tsx`: a Codex empty reading names Codex.
- `RunConfigSections.test.tsx`: a Codex render gives "Codex runs commands…" and "codex&#x27;s view". The Claude render is unchanged.
- `PushNotificationRow.test.tsx` and `e2e/push-toggle-persist-relaunch.spec.ts`: both use the new label.

## Documentation handoff

The ticket has no documentation handoff section, so nothing is pending for the documentation stage.
