# #1607 — A muted channel raises no notification and no badge count

Short plan: two filters over a flag the rows already carry, no new state, no new failure mode.

## Files read

- `src/renderer/src/store/pushNotifyBridge.ts` → `subscribePushNotify`, `usePushNotify`, `conversationNameIn`, `conversationRowIn` — the per-event gates and the server-scoped row lookup the mute read reuses.
- `src/renderer/src/store/appBadgeBridge.ts` → `attentionCountNow`, `countAttentionConversations` — the caller-side row filter that already drops archived rows.
- `src/shared/wire/types.ts` → `ConversationSummary.is_muted` — optional; read as `row.is_muted === true` (#1594).
- `src/renderer/src/store/pushNotifyBridge.test.ts`, `appBadgeBridge.test.ts` — the fake-bridge and store-seeding idioms the new cases sit beside.

No in-flight feature branch touches either file.

## Design source

N/A — OS notifications and the app icon badge are OS chrome with no Figma node (the #1592 call).

## Change

`subscribePushNotify` gains an optional sixth parameter `isMuted?: (serverId: string | null, conversationId: string) => boolean`, read per event right after the toggle gate and before the name lookup and token mint. A muted conversation sends nothing, mints nothing and, like a toggle-dropped prompt, is not recorded as announced, so a prompt unmuted mid-flight still notifies when the daemon re-sends it. Omitted, it means "not muted", so the existing calls stay unchanged. A new exported `conversationMutedIn(state, serverId, conversationId): boolean` answers `conversationRowIn(...)?.is_muted === true`, scoped to the event's own server the way `conversationNameIn` is; `usePushNotify` passes it over `conversationListStore.getState()`. `attentionCountNow` adds `row.is_muted !== true` to its caller-side filter beside `!row.is_archived`; `countAttentionConversations` is untouched. The sidebar status dot does not read mute.

## Testing strategy

Vitest, beside the existing cases:

- `subscribePushNotify`: a muted conversation sends no `notify` for either `turnEnd` or `modalShown` and mints no token; the lookup is keyed by the event's own `serverId` and `conversationId`; muting mid-session silences the next event (per-event read); a prompt dropped while muted notifies once unmuted and re-sent.
- `conversationMutedIn`: true only for `is_muted: true` on the event's server; false for `false`, a missing value, a missing row, and a same-id row muted only under another host.
- `attentionCountNow`: a muted row with an outstanding prompt does not count; the same row unmuted does.
