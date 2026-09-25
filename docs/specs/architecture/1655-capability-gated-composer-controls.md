# #1655 — hide the controls a session's capability list says it lacks

## Files read

- `src/shared/ipc/events.ts` → the `runConfigReceived` arm — carries optional `slashCommands`, `mcpServers`, `contextUsageDetail` (#1654); `undefined` means not reported.
- `src/main/daemonConnection.ts` → the `session_settings` arm of the inbound switch — copies the three flags by name, so an absent `capabilities` crosses as an explicitly-`undefined` property.
- `src/renderer/src/store/runConfigStore.ts` → `RunConfigSnapshot`, `selectSnapshot` — the snapshot gains the three flags; the capability read lives beside `selectSnapshot`.
- `src/renderer/src/screens/conversation/runConfigSnapshot.ts` → `toRunConfigSnapshot` — the event-to-snapshot copy; `effectiveEffort` is already copied with a conditional spread, the pattern the flags follow.
- `src/renderer/src/screens/conversation/ComposerActionsMenu.tsx` → `composerActionRows`, `ComposerActionsMenuView`, `ComposerActionsMenu` — the row decision, the pure view and the store-bound container.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ChannelInfoSheet` (the `mcpServersSection` slot), `ContextUsageControl` (wraps the reading in `ContextBreakdownPopover`).
- `src/renderer/src/screens/conversation/ContextBreakdownPopover.tsx` → `ContextBreakdownPopover` — the `.composer__context-trigger` button the reading becomes.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → `seedRunConfigTokens` — the `getInitialState` spy idiom for seeding the snapshot under a static render.
- `e2e/composer-context-breakdown.spec.ts`, `e2e/channel-mcp-servers.spec.ts`, `e2e/composer-actions.spec.ts` — the `session_settings` reply frame, the Channel info open path and the Actions locators the new spec reuses.

No in-flight feature branch touches these files.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3677 (Actions menu), https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-48 (Channel info MCP section), https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3879 (options panel the breakdown reuses)

Removal only. The Actions trigger (`Actions` plus an up chevron in primary) is unchanged, and its panel loses the two slash-command rows; Channel info loses its MCP servers section; the context reading keeps its exact span styling but is no longer wrapped in a button. Nothing new is drawn, so the visual check is that each surface matches today's rendering minus the removed part.

## Context

A Codex session has no slash commands, no MCP status and no context-usage breakdown. The daemon says so per session on the `session_settings` reply, and #1654 decodes that onto `runConfigReceived`. Today all three surfaces render regardless, so the Actions menu sends `/compact` to Codex as a prompt and two surfaces wait forever for data that never comes. No ADR needed.

## Design

**Snapshot.** `RunConfigSnapshot` gains `slashCommands?: boolean`, `mcpServers?: boolean`, `contextUsageDetail?: boolean`, optional so every existing literal stays valid. `toRunConfigSnapshot` copies each with the `effectiveEffort` conditional spread: an `undefined` flag is omitted, `true`/`false` are copied verbatim.

**One reading rule.** In `runConfigStore.ts`:

- `type SessionCapability = 'slashCommands' | 'mcpServers' | 'contextUsageDetail'`
- `sessionSupports(snapshot: RunConfigSnapshot | null, capability: SessionCapability): boolean` — `false` only when the flag is exactly `false`. A null snapshot, an absent flag and `true` all read as supported, so an older daemon, a not-yet-arrived reply and every Claude session look as today.
- `selectSlashCommandsSupported`, `selectMcpServersSupported` — module-level selectors over `RunConfigState` returning that boolean. A primitive, so a snapshot change that leaves the flag alone does not re-render the consumer.

Keyed on the flags only, never on the agent name.

**Actions menu.** `composerActionRows(menu, slashCommands: boolean)` returns `[NEW_SESSION_ACTION]` alone when `slashCommands` is false, otherwise today's rows. `ComposerActionsMenuView` takes a required `slashCommands: boolean` prop and passes it through. The container reads `selectSlashCommandsSupported`.

**Channel info.** `ChannelInfoSheet` reads `selectMcpServersSupported` and passes `undefined` to `mcpServersSection` when it is false, as it already does for a null conversation.

**Context reading.** `ContextUsageControl` already reads the whole snapshot; when `sessionSupports(snapshot, 'contextUsageDetail')` is false it returns the bare `ContextUsageReading` without `ContextBreakdownPopover`. The reading itself, and when it renders at all, are unchanged.

## State + concurrency model

No new state, no new async work. The snapshot store already holds only the open conversation's reply (`subscribeRunConfig` drops others) and is cleared on switch, so the flags follow the open conversation for free.

## Error handling

No new failure modes. A missing or malformed flag is decided upstream (#1654) and arrives as `undefined`, which reads as supported.

## Testing strategy

- `runConfigSnapshot.test.ts`: the three flags copied verbatim when `true`/`false`; omitted (key absent) when `undefined`.
- `runConfigStore.test.ts`: `sessionSupports` false only for an explicit `false`; true for `true`, absent and a null snapshot; the two selectors follow it.
- `ComposerActionsMenu.test.tsx`: `composerActionRows(menu, false)` is exactly `[NEW_SESSION_ACTION]` for both a null and a published menu; `true` unchanged. The view with `slashCommands={false}` renders the Reset row only. Existing call sites gain the `true` argument.
- `ConversationScreen.test.tsx`: with a seeded snapshot, `contextUsageDetail: false` renders the reading with no `composer__context-trigger`; `true` and absent keep the trigger.
- New `e2e/session-capabilities.spec.ts`: `session_settings` reply carries all three flags false; checks the Actions menu offers only Reset session, the context reading shows with no trigger button, and Channel info has no MCP servers header. The Channel info container is untested glue at the unit tier (as for its other slots), so the e2e is its proof.

## Open questions

- None.

## Documentation handoff

Pending for the documentation stage: the ticket names none; the owning overviews (composer, channel info) may want a line that the three surfaces key on the session's capability flags.
