# #1592 — The app icon shows how many conversations need attention

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `ConversationStatusDotControl` — the four per-id store reads and the `resolveConversationStatus(…, isConversationUnread(…))` call the badge must reproduce exactly.
- `src/renderer/src/screens/channels/channelListViewModel.ts` → the active-list source drops `is_archived` rows first; the badge applies the same filter.
- `src/renderer/src/store/conversationStatus.ts` → `resolveConversationStatus`, `ConversationStatus` — reused, not restated.
- `src/renderer/src/store/conversationUnread.ts` → `isConversationUnread` — reused, not restated.
- `src/renderer/src/store/modalPrompts.ts` → `selectHasOutstandingFor`; `conversationActivityStore.ts` → `selectActivityFor`; `conversationTimelineStore.ts` → `selectTimelineFor`; `conversationLastReadStore.ts` → `selectLastReadFor` — the curried selectors, callable on `getState()` outside React.
- `src/renderer/src/store/conversationListStore.ts` → `selectConversations` — every paired server's rows in one array.
- `src/renderer/src/store/pushNotifyBridge.ts` → `subscribePushNotify` / `usePushNotify` — the injected-subscribe + thin-hook shape the new bridge copies.
- `src/renderer/src/PairedShell.tsx` → `PairedShell` — mounts `usePushNotify`; unpair unmounts it.
- `src/shared/ipc/commands.ts` → `RendererCommand`, `isRendererCommand`, `isNotifyPayload` — the main-local command and its closed guard.
- `src/main/index.ts` → the `notify` case of the command switch — where the new case composes.
- `src/main/liveWindow.ts` → `LiveWindow.window` exposes only the focus and activate faces, not `setOverlayIcon` (see Design, Windows target).
- `src/main/dockIcon.ts` → `selectDockIcon` — the pure, electron-free main module shape the new badge module follows.
- `src/main/diagnosticLog.ts` → `DiagnosticEvent` (`event`, `code`, `count`) — the content-free log line.
- `e2e/fixtures/launchPairedApp.ts`, `e2e/permission-modal-answer-paths.spec.ts`, `e2e/settings-per-server-unpair.spec.ts` — the fake-daemon frame helpers, a second-row seed, and the unpair drive.

## Design source

N/A — the badge is OS chrome with no design node (ticket's `## Figma`). macOS draws its own Dock badge; on Windows the overlay is a red disc with a white count, the platform convention.

## Context

The sidebar resolves one status per conversation; nothing reaches the app icon. The badge is the number of attention dots (`input-required` or `new-messages`) across every paired host, archived rows excluded, computed the same way the dots are. `working` does not count.

No in-flight feature branch touches the five files.

## Design

### Renderer — `src/renderer/src/store/appBadgeBridge.ts` (new)

- `countAttentionConversations(conversations: readonly { id: string }[], statusOf: (id: string) => ConversationStatus): number` — pure. Counts rows whose status is `input-required` or `new-messages`. The input is a caller-filtered list (the archive filter lives in the caller, so a later muted-channel filter is one more `.filter`).
- `conversationStatusNow(id): ConversationStatus` — the production `statusOf`: the four `select*For(id)(store.getState())` reads fed to `resolveConversationStatus(…, isConversationUnread(…))`, the dot control's composition verbatim.
- `subscribeAppBadge(deps: AppBadgeDeps): () => void` where `AppBadgeDeps = { subscribe: (listener: () => void) => () => void; count: () => number; sendCommand: (command: RendererCommand) => void }`. Computes once on subscribe and on every store notification; sends `{ type: 'setBadgeCount', payload: { count } }` only when the count differs from the last sent (the last starts `null`, so the first value always sends — a reload re-asserts main's badge). The returned teardown unsubscribes, then sends `0` unless the last sent was already `0`. That teardown is the last-host clear: unpair unmounts `PairedShell`.
- `useAppBadge(): void` — thin hook, empty-dep effect: `subscribe` fans one listener out to the five source stores (`conversationListStore`, `modalStore`, `conversationActivityStore`, `conversationTimelineStore`, `conversationLastReadStore`) and returns a combined off; `count` is `countAttentionConversations(rows.filter(r => !r.is_archived), conversationStatusNow)`. `window.pyry` is dereferenced only inside the effect.

### Shared — `src/shared/ipc/commands.ts`

- New member `{ type: 'setBadgeCount'; payload: BadgeCountPayload }`, `BadgeCountPayload = { count: number }`. Main-local like `notify`: no `serverId`, no id, no name.
- `isBadgeCountPayload`: object, `count` present, `Number.isSafeInteger` (rejects non-numbers, NaN, ±Infinity, fractions and magnitudes past 2^53), `>= 0`. Wired as a case of `isRendererCommand`.

### Main — `src/main/appBadge.ts` (new, electron-free)

- `badgeLabel(count): string | null` — `null` at 0, `'1'`…`'9'`, `'9+'` above nine.
- `drawBadgeBitmap(label): { buffer: Buffer; width: number; height: number }` — a 32×32 BGRA bitmap: a hard-edged red disc with the label drawn from a small built-in pixel font (digits 1–9 and `+`), white. Hard edges keep every pixel's alpha 0 or 255, so premultiplication is moot.
- `applyBadgeCount<I>(count, deps: { platform; setBadgeCount(n): unknown; overlayWindow(): BadgeOverlayWindow<I> | null; toImage(bitmap): I }): void` — `win32`: overlay on the window (skipped when absent or destroyed), `setOverlayIcon(null, '')` at zero, otherwise the drawn image with a client-owned description built from the label. Every other platform: `setBadgeCount(count)`.

### Composition — `src/main/index.ts`

A `setBadgeCount` case beside `notify`: `applyBadgeCount(command.payload.count, { platform: process.platform, setBadgeCount: (n) => app.setBadgeCount(n), overlayWindow: () => BrowserWindow.getAllWindows()[0] ?? null, toImage: (b) => nativeImage.createFromBitmap(b.buffer, { width, height }) })`, then one `diagnosticLog.event({ event: 'app-badge', count })`.

**Windows target — a deviation from the ticket's note.** The note says `live.window`, but `LiveWindow.window` exposes only the focus and activate faces. Widening `liveWindow.ts` would be a sixth production file; the app holds one window at a time (a reopen happens only at zero windows), so `getAllWindows()[0]` is the current one. A reopened window's renderer re-sends its count because the bridge's last-sent starts `null`.

## State + concurrency model

No new store. One synchronous listener across five store subscriptions; each notification recomputes over every row (tens of rows, cheap) and sends only on change. Teardown removes all five listeners. No async work.

## Error handling

Total derivation, no failure modes. The boundary guard drops a malformed command silently like every sibling. `applyBadgeCount` no-ops on a missing or destroyed window.

## Testing strategy

- `appBadgeBridge.test.ts` (vitest): the count over mixed statuses (only `input-required` and `new-messages` count, `working`/`idle` do not); the caller-filtered list; subscribe sends the first value, sends on change, stays silent on an unchanged recompute; teardown sends 0 unless already 0 and stops listening; `conversationStatusNow` against seeded singletons (a prompt → input-required, an unread timeline → new-messages).
- `commands.test.ts`: accepts `0` and a positive integer; rejects negative, fractional, NaN, Infinity, an unsafe integer, string, missing/null payload.
- `appBadge.test.ts`: `badgeLabel` bounds (0, 1, 9, 10); bitmap size and that centre/corner pixels are white/transparent and the disc red; `applyBadgeCount` against a fake window on `win32` (overlay set, `null` at zero, destroyed/absent window no-op, `setBadgeCount` never called) and on `darwin` (`setBadgeCount` called, no overlay).
- `e2e/app-badge-count.spec.ts` (fake transport, `app.getBadgeCount()` via `readMainProcess`): a prompt on a second, never-opened row → 1; a prompt on the open row → 2; dismissing both → 0; a `turn_end` on the unopened row → 1 (unread); opening it → 0; with a prompt raised, unpairing the last host → 0.

## Open questions

- Whether Windows renders the 32×32 overlay crisply cannot be checked here (no Windows runner); the unit test pins the bitmap and the call.

## Documentation handoff

None named by the ticket. Pending for the documentation stage: fold the badge bridge into the owning renderer topic.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] SHOULD FIX, folded into the plan above — `Number.isInteger` admits `1e300`, which is an integer but not a meaningful count; the guard uses `Number.isSafeInteger` plus `>= 0`, so the one renderer→main value crossing is a bounded non-negative integer. The boundary is single and explicit: `isBadgeCountPayload` inside `isRendererCommand`; `applyBadgeCount` receives only the typed number.
- [Trust boundaries] No findings on identity leakage — the payload type is `{ count: number }`; no conversation id, name, host or daemon string is in the command, the overlay description, the diagnostic line or the drawn bitmap. `countAttentionConversations` returns a number, so the ids it reads never leave the renderer.
- [Tokens, secrets] No findings — nothing is minted, stored or read; no secret is in reach of either new module.
- [File / storage] No findings — no path, no file, no persistence. The overlay bitmap is drawn in memory from a closed label set (`badgeLabel` yields only `'1'`…`'9'`, `'9+'`); `drawBadgeBitmap` writes into a fixed-size buffer and skips any character without a glyph, so no input can grow or overrun it.
- [Electron attack surface] No findings — no new IPC channel (the command rides `COMMAND_CHANNEL`), no preload change, no `webPreferences` change, no navigation. A compromised renderer can at worst set a misleading badge number, which is cosmetic and grants nothing.
- [Crypto] Not applicable — no randomness, no primitives.
- [Network & I/O] Not applicable — the badge is main-local; no frame is sent and none is parsed.
- [Logs] No findings — one `diagnosticLog.event({ event: 'app-badge', count })` per applied change: a static event name and a number, no content.
- [Concurrency] No findings — no async work; the hook's teardown removes all five store listeners and sends the zero clear. A StrictMode double mount sends 0 then N, a transient no-op. A window destroyed between lookup and call is guarded by `isDestroyed()`.
- [Threat model] Hostile daemon: it can already light dots by raising prompts or rows, and the badge counts the same rows, so it gains no new influence; the Windows label is clamped at `9+`. Renderer compromise: bounded as above. Out of scope: muted channels (a later ticket adds the filter at the caller).

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-24
