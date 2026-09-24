# #1597 — Clicking a notification opens the conversation that raised it

## Files read

- `src/renderer/src/store/pushNotifyBridge.ts` → `subscribePushNotify`, `conversationNameIn`, `usePushNotify` — where the notify command is built; the event's `serverId` + `conversationId` are already in hand for the #1593 name lookup, so the token is minted at the same point.
- `src/renderer/src/store/notificationActivatedBridge.ts` → `subscribeNotificationActivated`, `useNotificationActivatedNav` — the click consumer; today it is nullary.
- `src/renderer/src/PairedShell.tsx` → `PairedShell`'s `onOpen` arrow and the `useNotificationActivatedNav` mount — the row-open steps the click must share.
- `src/renderer/src/store/conversationListStore.ts` → `ConversationListState.byServer`, `ServerConversationSummary` — the server-scoped rows the fallback check reads; archived rows are held in the same list with `is_archived: true`.
- `src/shared/ipc/commands.ts` → `NotifyPayload`, `isNotifyPayload` — the renderer→main boundary the token crosses.
- `src/shared/ipc/events.ts` → the `notificationActivated` arm of `DaemonEvent` — the main→renderer echo.
- `src/main/index.ts` → the `notify` arm of the command handler — composes `fireNotification`'s `onClick`; the token closes over it, so `fireNotification.ts` is unchanged.
- `src/main/fireNotification.ts` → `fireNotification`, `windowHasFocus` — the focus gate an e2e must defeat to raise a notification.
- `e2e/app-badge-count.spec.ts`, `e2e/conversation-mute-command.spec.ts`, `e2e/fixtures/launchPairedApp.ts` → `pushFrame`, `secondServer`, `SECOND_SEEDED_ROW` — the two-host fake-stack idiom the new spec follows.
- `src/renderer/src/screens/channels/ChannelList.tsx` → the row's `aria-current` — how "selected in the sidebar" is observed.
- `docs/knowledge/features/push-notifications.md` — the "no daemon-supplied field shapes the notification" posture and the closed-set guard lesson.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

No new visuals. The click lands on the existing states of the desktop layout: the clicked conversation's sidebar row carries the selected (`aria-current`) treatment and its thread fills the chat pane. No component, token or style changes, so there is nothing to capture against the frame.

## Context

The `notificationActivated` event is nullary, so `useNotificationActivatedNav` dispatches `open`, which shows whatever conversation is already active. With two channels running, a notification from B opens A. The fix carries an opaque renderer-minted token through main and back, so the renderer can resolve the click to the conversation that raised it while no conversation or server id ever reaches main.

Size: six production files, one over the five-file line. `commands.ts`, `events.ts` and `main/index.ts` change by a few lines each, and the token plumbing has no consumer but this click, so splitting it off would produce a slice with one sibling consumer; the floor rule keeps it one ticket (as the refiner's estimate states). No in-flight branch touches these files.

## Design

### Token contract (`src/shared/ipc/commands.ts`)

- `isNotificationToken(value: unknown): value is string` — exported, pure: a string matching `^[A-Za-z0-9-]{1,64}$`. Used by both the main-side guard and the renderer's re-validation, so the two sides cannot disagree.
- `NotifyPayload` gains `token?: string` — opaque, renderer-minted, meaningless to main.
- `isNotifyPayload` gains a third clause: `token` absent, `undefined`, or `isNotificationToken`. Anything else fails the whole command closed.

### Event (`src/shared/ipc/events.ts`)

The arm becomes `{ type: 'notificationActivated'; token?: string }`. Optional, so the eleven existing `{ type: 'notificationActivated' }` literals keep compiling and still mean "no token → today's behaviour".

### Main (`src/main/index.ts`, `notify` arm)

Read `command.payload.token` into a local before composing `onClick`; the click emits `{ type: 'notificationActivated', token }` when a token is present and the bare arm otherwise (never a present `undefined` key). The token is never logged. `fireNotification.ts` is unchanged.

### Renderer minting (`src/renderer/src/store/pushNotifyBridge.ts`)

- `interface NotificationTarget { serverId: string | null; conversationId: string }`
- `interface NotificationTargets { mint(target: NotificationTarget): string; resolve(token: string): NotificationTarget | null }`
- `NOTIFICATION_TARGETS_CAP = 16`; `createNotificationTargets(newToken = () => crypto.randomUUID()): NotificationTargets` — a `Map` in insertion order; `mint` stores the target under a fresh token and drops the oldest entry once the size exceeds the cap; `resolve` returns the stored target or `null`.
- `subscribePushNotify` gains an optional fifth parameter `mintToken?: (target: NotificationTarget) => string`. Only on the send path (after the toggle and modal-dedup gates), it mints from the event's own `serverId` + `conversationId` and puts `token` in the payload. Optional so the eighteen existing test calls stay valid; production always passes it.
- `usePushNotify(targets: NotificationTargets)` passes `targets.mint`.
- `notificationRowFor(state: ConversationListState, target: NotificationTarget | null): ServerConversationSummary | null` — the row with `target.conversationId` in `target.serverId`'s own `byServer` slot, or `null` when the target is null, the slot or row is missing, or the row is archived. `conversationNameIn` and it share one server-scoped row lookup.

### Click consumer (`src/renderer/src/store/notificationActivatedBridge.ts`)

`onActivated` becomes `(token: string | null) => void`. The listener passes `event.token` only when `isNotificationToken` admits it (re-validation of what came back from main), else `null`. Never throws.

### Shell (`src/renderer/src/PairedShell.tsx`)

- `const [notificationTargets] = useState(() => createNotificationTargets())` — lives and dies with the shell, so unpair (which unmounts it) clears it, as `announcedModalIds` does.
- The sidebar's `onOpen` body becomes one local function `openConversation(conversation)`; `onOpen={openConversation}`.
- The click: resolve the token through `notificationTargets`, then `notificationRowFor(conversationListStore.getState(), …)`. A row → `openConversation(row)`. No row → today's `leaveRecovery(); dispatch({ type: 'open' })`.
- One content-free diagnostic per click: `sendDiagnostic({ event: 'notification-click', code: 'opened' | 'fallback' })` — no token, id or name.
- `usePushNotify(notificationTargets)`.

## State + concurrency model

No new async work. The token map is a plain closure-owned `Map` held by the shell's `useState`; it is read synchronously in the click listener. The conversation list is read with `getState()` at click time, so a row archived or removed after the notification was raised falls back. Subscriptions keep their existing teardown (the hooks' effect cleanups).

## Error handling

Every failure path is the fallback, never a throw: absent token, token that fails `isNotificationToken`, token evicted or from a previous shell (unknown), server slot gone (host unpaired), row gone (deleted) or archived. Main rejects a malformed token at the guard, which drops the whole `notify` command as today's guard does for a bad `name`.

## Testing strategy

Vitest (node):
- `commands.test.ts` — `notify` with a valid token admitted; token too long (65), empty, with a disallowed character, and non-string each rejected; absent/undefined still admitted.
- `pushNotifyBridge.test.ts` — `createNotificationTargets`: mint→resolve round trip, distinct tokens map to their own targets, the seventeenth mint evicts the first (oldest), unknown token → `null`. `subscribePushNotify` with `mintToken`: payload carries the minted token, minted with the event's `serverId` + `conversationId`; no mint when the toggle is off. `notificationRowFor`: found row; same id under another server → `null`; archived → `null`; `null` target / missing slot → `null`.
- `notificationActivatedBridge.test.ts` — valid token forwarded; absent token → `null`; invalid token (too long, non-string) → `null`.

Playwright (`e2e/notification-click-opens-conversation.spec.ts`, fake stack, two hosts): patch main's `Notification.prototype.show` to record instances and the window's `isFocused` to report false; with the first host's row open, push `turn_end` for the second host's row and then for the first host's row; clicking (emitting `click` on) the second notification opens the second host's thread with its row `aria-current`, and clicking the first opens the first — AC1 and AC2 through the real main composition. A synthetic `notificationActivated` with an unknown token leaves the open thread as it is (AC3).

## Open questions

- Does electron's `Notification.prototype.show` accept a JS override in the packaged main process? If not, the e2e falls back to capturing the `notify` command and sending the echo through `webContents.send`, and the plan gets a Revisions entry.

## Documentation handoff

Pending for the documentation stage: `docs/knowledge/features/push-notifications.md` — the `notificationActivated` arm is no longer nullary (it carries an optional opaque token), and the `notify` payload gained `token`; `docs/knowledge/features/paired-shell.md` — the notification click opens its own conversation through the shared row-open function.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — two crossings, each with one named guard. Renderer→main: `isNotifyPayload` admits `token` only when `isNotificationToken` holds (a bounded `[A-Za-z0-9-]{1,64}` string); any other shape drops the whole `notify` command. Main→renderer: `subscribeNotificationActivated` re-applies `isNotificationToken` before the token is used as a map key, and an unadmitted value becomes `null` (the fallback). Main never interprets the token — it only echoes it on the window-local event — so no daemon-supplied or renderer-supplied value shapes the OS notification beyond the already-cleaned #1593 title.
- [Tokens] No findings — the token is a correlation handle, not a credential: it grants nothing, and the conversation and server ids it maps to never leave the renderer. It is minted with `crypto.randomUUID()` (WebCrypto CSPRNG), which matters for uniqueness rather than secrecy: a notification raised before an unpair and clicked after a re-pair must not resolve against the new shell's map, and a per-shell counter would have collided there. Lifecycle: created on send, dropped oldest-first past 16 entries, and dropped wholesale when the shell unmounts. Never persisted, never logged on either side.
- [File / storage] No findings — nothing touches disk or web storage; the map is in-memory React state.
- [Electron attack surface] No findings — no new channel, bridge method or window option. The existing `sendCommand` / `onDaemonEvent` channels carry one extra bounded field.
- [Crypto] No findings — no cryptographic use beyond UUID generation.
- [Network & I/O] No findings — the `notify` command is main-local and never reaches the transport; no frame changes.
- [Logs] No findings — the one new diagnostic (`notification-click` with a static `opened` / `fallback` code) carries no token, id or name; main's `notify` arm adds no log line.
- [Concurrency] No findings — no async work. The list row is read at click time, so a row archived, deleted or unpaired between raise and click falls back instead of opening stale state. A malformed or colliding token cannot open another host's row, because the lookup is scoped to the stored target's own `byServer` slot.
- [Threat model] OUT OF SCOPE — a compromised renderer can already call `sendCommand` directly; the token adds no capability to it. Notification click spoofing by another local process is outside Electron's model and unchanged by this ticket.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-24
