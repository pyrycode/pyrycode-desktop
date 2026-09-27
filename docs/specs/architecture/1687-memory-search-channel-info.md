# Daemon memory search in Channel info (#1687)

## Files read

- `src/shared/wire/types.ts` → `MemorySearchPayload` — daemon report states and explicit provider flags.
- `src/shared/ipc/events.ts` → `runConfigReceived` — conversation-attributed optional report already crosses IPC.
- `src/renderer/src/store/runConfigStore.ts` → `RunConfigSnapshot`, `clearSnapshot` — whole-value, conversation-scoped reading.
- `src/renderer/src/screens/conversation/runConfigSnapshot.ts` → `toRunConfigSnapshot`, `requestRunConfigSnapshot` — mapping and existing settings request.
- `src/renderer/src/screens/conversation/confirmedRunConfig.ts` → `subscribeConfirmedRunConfig` — context, reconnect, reset and replacement invalidation and reply gate.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `openChannelInfo`, `ChannelInfoSheetView`, `ChannelInfoSheet` — open trigger, pure view and store binding.
- `src/renderer/src/screens/conversation/conversation.css` → `.channel-info__row` — existing row treatment.
- `docs/knowledge/features/run-config-store.md` → snapshot lifetime — clearing and correlation history.
- `docs/knowledge/features/conversation-shell-session-and-channel-info.md` → Channel Info sheet — current sheet structure.
- `docs/knowledge/features/development-verification.md` → visual and test boundaries — static rendering cannot run the opening click.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-48

The dark rounded sheet places a Memory heading and a left-label/right-value row between About and Actions, using the existing Channel info heading, row, body text and theme tokens. Its example “None” and Install action predate the daemon report contract: copy must name memory *search*, reflect the reported state, and offer no install workflow. Existing sheet chrome and MCP controls remain in place.

## Context

The daemon already reports optional memory search status, including providers outside MCP. Channel info currently has no consumer, and its opening trigger refreshes only MCP status. Remote branch `feature/1544` lists `confirmedRunConfig.ts` as overlapping; its base version of the invalidation helper is already present here, so this change is additive within that helper.

## Design

- Add optional `memorySearch` to `RunConfigSnapshot` and copy it only when `runConfigReceived` reports it, preserving `false` provider flags and whole-snapshot replacement.
- `ChannelInfoSheet` selects the held report through `selectSnapshot` and hands it to `ChannelInfoSheetView`. The pure view renders a Memory search heading and aggregate row. `available` says “Memory search available”; `unavailable` says “Memory search unavailable”; `absent` says no provider was detected; `unknown`, omission and null snapshot say status unknown. Available and unavailable reports list bounded, escaped provider display names and explicit installed/disabled state as reported, independently of MCP status. No install action is added.
- `openChannelInfo` calls `requestRunConfigSnapshot` for the active conversation alongside the existing MCP request. The app-lifetime subscription and activation/connected refresh paths remain the same.
- `subscribeConfirmedRunConfig` removes `memorySearch` from a retained snapshot on conversation/host change, reconnect, reset or session transition. Its existing conversation, host and expected-session gates decide which reply can restore it. The `clearSnapshot` path already clears it on conversation activation and exit.

## State and concurrency model

The report is optional on a nullable whole snapshot: null and omitted both display unknown; an explicit `unknown` remains distinct in stored data. The report is session-scoped. Invalidation keeps unrelated snapshot fields where the current helper does, but drops memory search until an accepted correlated reply arrives. No new subscription, timer, async task or IPC command is introduced.

## Error handling

Unavailable and unknown are report outcomes, not inferred failures or installation prompts. A rejected, stale or unmatched settings reply cannot become the sheet’s report through the existing main correlation and renderer subscription gates. Provider names are bounded by Unicode code points and rendered only as React text children, never as markup, attributes, keys or logs.

## Testing strategy

- Vitest: mapping preserves optionality and explicit `false`; static markup covers available, unavailable, disabled, absent, unknown, omitted and escaped/bounded names; subscription tests cover switch, reconnect and replacement invalidation and stale replies.
- A focused fake-transport Playwright spec drives Channel info opening and checks the addressed settings request and displayed status. The build checks both process type configurations. Visual comparison uses the existing sheet and Figma reference at the test viewport.

## Open questions

- Whether a provider with `installed: false` in an unavailable aggregate should be listed. Resolve from the daemon contract and record any design change under Revisions.

## Revisions

- During implementation, resolved the provider question: display every provider the daemon reports, including one marked not installed, so the sheet preserves the daemon's full report. This does not derive provider detection from the MCP list or offer installation.

## Documentation handoff

Pending for the documentation stage: update `docs/knowledge/features/run-config-store.md` under snapshot lifetime and `docs/knowledge/features/conversation-shell-session-and-channel-info.md` under “Channel Info sheet” to describe search-report states, refresh/invalidation and the distinction from knowledge capture.
