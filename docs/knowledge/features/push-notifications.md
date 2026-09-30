# Push notifications

Fires a native OS notification when the main window is unfocused, so background alerts (a
turn-complete, an incoming prompt) can reach the user without their having to watch the window.
Desktop push rides the relay socket the app already holds open — no Firebase, no push-wake path,
unlike mobile: a backgrounded desktop app is not suspended, so the events that matter already
arrive over the socket to a client that never disconnected.

Split from [#158](https://github.com/pyrycode/pyrycode-desktop/issues/158) into three slices, all
now merged: [#391](../codebase/391.md) (the delivery primitive — a `notify` command, renderer→main,
that main turns into an Electron `Notification`, gated on focus), [#392](../codebase/392.md) (the
**trigger** — decides *when* the renderer sends `notify`, see [below](#the-trigger-392)), and
[#393](../codebase/393.md) (click-to-focus, see [below](#clicking-the-notification-393)). The
feature is now **live end-to-end**. [#1597](../codebase/1597.md) later corrected what the click
opens — see [Resolving the click to its own
conversation](#resolving-the-click-to-its-own-conversation-1597) below.

## What it does

Given a `notify` command carrying a closed `kind` (`'turn-complete' | 'prompt'`) and an optional
conversation `name` ([#1593](https://github.com/pyrycode/pyrycode-desktop/issues/1593)), the main
process:

1. Reads the window's focus state via `windowHasFocus(live.window)` **at fire-time** — no separate
   stateful focus tracker. Focused → no-op. (Destroyed-safe since [#518](../codebase/518.md): a
   destroyed window reports unfocused without touching `isFocused()`. Since [#519](../codebase/519.md),
   `live.window` is the [live-window](live-window.md) holder's current-window face, not a captured
   `BrowserWindow`, so a dock-reopened window is queried correctly instead of a destroyed original.)
2. Unfocused → looks up `kind` in a main-owned copy table for the **body**, cleans `name` into the
   **title** (`notificationTitle`, falling back to "Pyrycode"), constructs an Electron `Notification`
   with that title/body, registers the [click handler](#clicking-the-notification-393) on it, then
   calls `.show()`.

## Why the command is main-local, not wire

Every other `RendererCommand` member carries a payload reused verbatim from `src/shared/wire/types.ts`
because it eventually serializes to the daemon (see [Command channel](command-channel.md)). `notify`
is the exception: it is a pure client-side side-effect that never reaches the transport, so
`NotifyKind`/`NotifyPayload` are defined in `src/shared/ipc/commands.ts` itself — the same posture as
the derived `AnswerModalCommandPayload`. This matters for anyone tempted to route notification copy
through the daemon: don't. The whole point of the closed enum is that a daemon-relayed string (a
permission-prompt title, an assistant message, a workspace path) can never ride into an OS
notification and appear on a lock screen — it is impossible by construction, not by convention.

## Key types and files

| Piece | File |
|---|---|
| `NotifyKind` / `NotifyPayload` / `notify` union member | `src/shared/ipc/commands.ts` |
| `isNotifyPayload` guard (closed-set, not `typeof === 'string'`) | `src/shared/ipc/commands.ts` |
| `fireNotification(kind, deps, name?)` + `NOTIFICATION_COPY` table (body) + `notificationTitle` (title, #1593) + `activateWindow` (#393) | `src/main/fireNotification.ts` |
| `case 'notify':` dispatch, incl. the `onClick` composition (#393) | `src/main/index.ts` (the single `onCommand` switch) |
| `notificationActivated` `DaemonEvent` arm, nullary at #393, optional `token` since #1597 | `src/shared/ipc/events.ts` |
| `notificationActivatedBridge.ts` (#393, re-validates the echoed token since #1597) | `src/renderer/src/store/notificationActivatedBridge.ts` |
| `pushNotifyBridge.ts` — `notifyKindForEvent`, `subscribePushNotify`, `usePushNotify` (#392, `questionShown` added #1691); `createNotificationTargets`, `notificationRowFor` (#1597); `conversationMutedIn` (#1607) | `src/renderer/src/store/pushNotifyBridge.ts` |
| `isNotificationToken` guard + `NotifyPayload.token` (#1597) | `src/shared/ipc/commands.ts` |
| `openConversation` — the shared sidebar-row/notification-click open steps (#1597) | `src/renderer/src/PairedShell.tsx` |

```ts
export type NotifyKind = 'turn-complete' | 'prompt'
export interface NotifyPayload {
  kind: NotifyKind
  name?: string   // #1593 — the conversation name, resolved renderer-side; title only, never body
}

export interface OsNotification {
  show(): void
  on(event: 'click', listener: () => void): void   // #393
}
export interface OsNotificationConstructor {
  new (options: { title: string; body: string }): OsNotification
}

export function fireNotification(
  kind: NotifyKind,
  deps: { isWindowFocused: () => boolean; Notification: OsNotificationConstructor; onClick: () => void },
  name?: string   // #1593 — cleaned by notificationTitle before it becomes the title
): void
```

`fireNotification` is shaped like `emitDaemonEvent.ts`: a plain function with Electron dependencies
**injected** as parameters, never `import 'electron'`, unit-tested entirely with fakes (no Electron
harness). The composition root in `index.ts` closes the [live-window](live-window.md) holder's focus
query and Electron's real `Notification` into it, exactly as it closes `downloadsDir` into
`saveDebugBundle`.

## Clicking the notification (#393)

[#393](../codebase/393.md) makes the notification actionable. `fireNotification` registers
`deps.onClick` as the constructed notification's `'click'` listener **before** calling `.show()` (a
click could otherwise arrive the instant the notification appears). `onClick` is opaque to this
module — `fireNotification` has no window or IPC knowledge; `index.ts`, the sole composition site,
supplies it:

```ts
fireNotification(command.payload.kind, {
  isWindowFocused: () => windowHasFocus(live.window), // #518 guard, #519 live-window target
  Notification,
  onClick: () => {
    activateWindow(live.window)
    emitDaemonEvent(live.sink, { type: 'notificationActivated' })
  }
})
```

Two effects, composed in one place:

1. **Window activation** — a new injected helper, co-located in `fireNotification.ts`:

   ```ts
   export interface ActivatableWindow {
     isDestroyed(): boolean // #518 — checked first; every member below throws once destroyed
     isMinimized(): boolean
     restore(): void
     show(): void
     focus(): void
   }
   export function activateWindow(win: ActivatableWindow): void {
     if (win.isDestroyed()) return // #518
     if (win.isMinimized()) win.restore()
     win.show()
     win.focus()
   }
   ```

   `restore()` un-minimizes, `show()` covers the hidden case, and an explicit `focus()` covers
   already-visible-but-behind. `isVisible` is deliberately absent from the interface — `show()` is
   safe to call unconditionally. A real `BrowserWindow` satisfies `ActivatableWindow` structurally, and
   since [#519](../codebase/519.md) the caller passes the [live-window](live-window.md) holder's
   `window` face (itself structurally satisfying it by delegation) rather than a captured window
   reference, so no `electron` import reaches this unit either way.

   [#518](../codebase/518.md) added the `isDestroyed()` guard: on macOS, closing the window destroys
   it without quitting the app, so a notification click arriving afterward would otherwise throw out
   of `isMinimized()`. `activateWindow` on a destroyed window is now a total no-op.

2. **Focus query, made destroyed-safe ([#518](../codebase/518.md))** — the inline
   `mainWindow.isFocused()` closure above was replaced with a new `windowHasFocus` helper, extracted
   into `fireNotification.ts` (co-located with `activateWindow`) because `index.ts` has no peer
   `.test.ts`:

   ```ts
   export interface FocusableWindow {
     isDestroyed(): boolean
     isFocused(): boolean
   }
   export function windowHasFocus(win: FocusableWindow): boolean {
     if (win.isDestroyed()) return false
     return win.isFocused()
   }
   ```

   A destroyed window reports **unfocused** without ever calling `isFocused()` (which throws
   post-destruction) — the semantically correct answer, not a fudge: a closed window cannot hold
   focus, and that is exactly the condition under which a notification should fire. [#519](../codebase/519.md)
   made the resulting click actually surface the **current** window rather than safe-no-op on a
   destroyed original — see [live window](live-window.md).

3. **Renderer navigation** — a `DaemonEvent` arm, `{ type: 'notificationActivated'; token?: string }`
   (`src/shared/ipc/events.ts`). This is the **first main-local signal** on the `DaemonEvent`
   channel: unlike every other arm, it is not derived from a validated wire envelope — it is emitted
   directly by this click handler. It shipped nullary at #393; [#1597](../codebase/1597.md) added the
   optional `token`, still carrying no daemon-relayed content, conversation id, or wire field of its
   own — see [Resolving the click to its own
   conversation](#resolving-the-click-to-its-own-conversation-1597) below. A consume-only filter
   bridge, `src/renderer/src/store/notificationActivatedBridge.ts` (a near-clone of
   [`conversationCreatedBridge`](new-discussion-fab.md), minus the command-send half and the
   payload), consumes it and is mounted in [`PairedShell`](paired-shell.md) beside
   `useConversationCreatedNav`. Since `nextPairedRoute`'s `open` transition is already absolute (any
   route → `thread`), the click lands on the thread view regardless of which paired view (list /
   settings / archive) was showing, with no new route or nav arm. At #393 this carried **no**
   `setActiveConversation` call by construction — the arm had no payload to resolve one from.
   [#1597](../codebase/1597.md) changed that: when the token resolves to a conversation still in the
   list, the click opens that conversation specifically; only an unresolved token (absent, unknown,
   evicted, or its row archived/gone) still falls back to "show the existing active conversation."

   The three exhaustive renderer bridges (`daemonEventBridge` / `timelineBridge` / `modalBridge`) each
   gained a one-line `case 'notificationActivated': return null` (or equivalent), compile-forced by
   their `assertNever` guards — the same cascade every prior arm-adding slice paid.

### Resolving the click to its own conversation (#1597)

At #393, `notificationActivated` was nullary, so every click opened whichever conversation
happened to be active — with two channels running, a notification raised by channel B opened
channel A. [#1597](../codebase/1597.md) closes that gap with an opaque, renderer-minted token, so
main still never learns a conversation or server id — only the posture changes, not the boundary:

- `pushNotifyBridge.ts` gains `createNotificationTargets(newToken = () => crypto.randomUUID())`, a
  bounded (`NOTIFICATION_TARGETS_CAP = 16`, oldest dropped first) `Map`-backed `mint`/`resolve` pair.
  `subscribePushNotify` takes an optional fifth parameter, `mintToken`; only on the send path (after
  the toggle and [#514](#dedup-across-reconnects-514) modal-dedup gates), it mints from the event's
  own `serverId` + `conversationId` — the same pair the [#1593](#the-copy-table-holds-the-body-only)
  name lookup already had in hand — and puts the token in the `notify` payload. `PairedShell` owns one
  `NotificationTargets` instance per mount (`useState`), so it lives and dies with the shell exactly as
  the #514 `announcedModalIds` set does — a token minted under one pairing can never resolve against a
  later one.
- `NotifyPayload` gains `token?: string`; `isNotifyPayload` admits it only when a new exported guard,
  `isNotificationToken` (`^[A-Za-z0-9-]{1,64}$`), holds — closed-set-flavored like the `kind` check
  [above](#the-guard-is-the-security-relevant-line), applied to a field that is opaque rather than
  enumerable. `src/main/index.ts` reads the token into a local and echoes it back on
  `notificationActivated` unchanged; it never logs it, never inspects it, and `fireNotification.ts`
  needed no change — the token just closes over `onClick`. `notificationActivatedBridge.ts` re-runs
  `isNotificationToken` on the echo before ever using it as a map key, so main is never trusted to have
  forwarded exactly what the renderer minted.
- The click resolves through `notificationRowFor(state, target)` — the row with
  `target.conversationId` in `target.serverId`'s own `byServer` slot, or `null` if the target is
  `null`, the slot or row is missing, or the row is archived — the same server-scoped lookup
  `conversationNameIn` ([#1593](#the-copy-table-holds-the-body-only)) already used for the title. A
  resolved row runs through `openConversation`, the same function a sidebar row's `onOpen` now calls
  (`PairedShell.tsx`, pulled out to one function so the two callers can't drift apart); an unresolved
  token falls back to today's `open` dispatch, never throwing.

## The trigger (#392)

[#392](../codebase/392.md) is the renderer half that decides *when* to send `notify`. A filter
bridge, `src/renderer/src/store/pushNotifyBridge.ts`, watches the already-decoded `DaemonEvent`
channel for three arms:

```ts
export function notifyKindForEvent(event: DaemonEvent): NotifyKind | null {
  switch (event.type) {
    case 'turnEnd':
      return 'turn-complete'
    case 'modalShown':
    case 'questionShown':
      return 'prompt'
    default:
      return null
  }
}
```

Every `modalShown` is a permission/trust prompt by construction (`WireModalClass` admits exactly
`'permission' | 'trust'`, ADR 0009 — no destructive class), so no class-narrowing is needed, and a
`questionShown` batch is a prompt too ([#1691](https://github.com/pyrycode/pyrycode-desktop/issues/1691),
below) — mobile's `HostConversationSource` alerts on the same moment. This is a `default: null`
**filter**, not an `assertNever` exhaustive switch — it introduces no new `DaemonEvent` arm (both
`modalShown` and `questionShown` already existed on the union before this module read them), so it
doesn't force a matching no-op case into `modalBridge` / `timelineBridge` / `daemonEventBridge`,
unlike the `notificationActivated` arm #393 added.

`subscribePushNotify(onDaemonEvent, sendCommand, isPushEnabled, nameFor)` is the React-free data
path: filter first (short-circuits on the common case), then — only for the two owned arms — reads
`isPushEnabled()` and, if true, sends `{ type: 'notify', payload }` as an inline `RendererCommand`
literal (no constructor helper added). `isPushEnabled` is a **per-event thunk**, not a boolean
captured at subscribe time — production passes
`() => pushNotificationPrefStore.getState().pushNotificationsEnabled`, so a user who flips the
[Settings toggle](push-notification-preference-store.md) mid-session sees the very next
turn-end/prompt respect the new value. `usePushNotify()` mounts this in
[`PairedShell`](paired-shell.md) beside `useNotificationActivatedNav`, with no `useRef` — unlike its
sibling hooks, it takes no per-render caller callback, so its dependencies (`window.pyry.*`, the
pref-store thunk, the conversation-list lookup) can be closed over directly in an empty-dep effect.

**Naming the notification ([#1593](https://github.com/pyrycode/pyrycode-desktop/issues/1593)).** The
`onDaemonEvent` listener type widens from `DaemonEvent` to `StampedDaemonEvent` so it can read the
event's client-stamped `serverId` alongside its `conversationId`. A fourth required parameter,
`nameFor: (serverId: string | null, conversationId: string) => string | null`, is read only after the
dedup and toggle gates pass (so it's never called for an event that won't send). The payload omits the
`name` key entirely on a `null` result — never a present `name: undefined`, which structured clone
would still carry across the IPC boundary. The conversation id is read purely as a lookup key inside
the listener and never leaves it; the lookup itself, `conversationNameIn`, is a pure function of a
`ConversationListState` snapshot, `serverId`, and `conversationId` — it finds the row by id in that
server's own slot and returns its `name`, or `null` when the slot, the row, or the name is missing.
Keyed by the event's own server on purpose: a same-id row filed under a different host must never name
the notification. Production wires `nameFor` to
`(serverId, id) => conversationNameIn(conversationListStore.getState(), serverId, id)`, `nameFor` being
required (not defaulted) so an unwired call site is a type error, the same posture as `isPushEnabled`.

### Muting suppresses the send (#1607)

Mute is stored on the host and rides each conversation list row as `is_muted` (#1594), read as
`row.is_muted === true` so a missing value means not muted. `subscribePushNotify` takes an optional
sixth parameter, `isMuted?: (serverId, conversationId) => boolean`, read per event — not cached —
right after the dedup/toggle gates and before the name lookup and the token mint, so a muted send
mints nothing and looks up no name. Production wires it to a new exported
`conversationMutedIn(state, serverId, conversationId)`, built over the same server-scoped
`conversationRowIn` lookup `conversationNameIn` and `notificationRowFor` already use — keyed by the
event's own `serverId` so a same-id row muted only under another host never silences this one.
Omitted, `isMuted` means "not muted," so the roughly twenty existing `subscribePushNotify` call sites
in tests needed no change.

One flag silences both `notify` kinds, turn-complete and prompt, because the host stores a single
mute bit rather than one per kind. The sidebar status dot does not read mute and is unchanged — a
muted conversation still shows its state in the list, it just raises nothing outside it. The
[app icon badge](app-badge.md) drops the same rows from its count (#1607, below).

`conversationMutedIn` gained a second reader in
[#1608](https://github.com/pyrycode/pyrycode-desktop/issues/1608): the
[Edit channel dialog's Mute notifications checkbox](edit-channel-dialog.md#the-mute-checkbox-1608)
calls it, unmodified, for its opening value.

**A muted prompt is deliberately not recorded as announced.** Like a delivery the push toggle drops,
a muted `modalShown` never enters the [`announcedModalIds` dedup set](#dedup-across-reconnects-514).
Recording it anyway would mean a prompt unmuted while still outstanding would never notify when the
daemon re-sends it after the next reconnect — the same reasoning the toggle-drop case already
established, applied to a second gate ahead of the same set.

### Dedup across reconnects (#514, extended by #1691)

The daemon deliberately re-sends every still-outstanding `modal_shown` after each re-handshake
([#415](../codebase/415.md) reconcile), so without further guarding a prompt left unanswered while the
window was backgrounded earned a fresh OS notification per network flap or sleep/wake cycle.
[#514](../codebase/514.md) closed this: `subscribePushNotify` opens a closure-local
`announced = new Set<string>()` once per subscription (named `announcedModalIds` before
[#1691](https://github.com/pyrycode/pyrycode-desktop/issues/1691), when it only ever held modal ids).
On the two owned arms that carry an id, it binds a namespaced `announceKey` — `` `modal:${event.modalId}` ``
for `modalShown`, `` `batch:${event.questionBatchId}` `` for `questionShown` (mobile's own
`batch:<questionBatchId>` key in `HostConversationSource`), `null` for `turnEnd` — narrowed on the
discriminant, the only new read of a daemon-supplied field, never leaving the listener. It
short-circuits before the toggle read if `announceKey !== null && announced.has(announceKey)`, and —
**only after** the `sendCommand` call — records `announceKey` into the set. `turnEnd` is untouched by
construction: `announceKey` is `null` for every arm besides `modalShown`/`questionShown`, so both the
check and the record are skipped for the rest of the union without a second rule. The `modal:`/`batch:`
prefix is load-bearing, not decoration: a modal and a question batch that happen to share a raw id
(unrelated id spaces on the wire) must announce independently rather than suppress each other; an
unprefixed key would conflate them. Neither id is ever spread or interpolated into the payload (`{ kind }`
or `{ kind, name }` since [#1593](https://github.com/pyrycode/pyrycode-desktop/issues/1593)) — the
payload carries no batch field at all, not the id and not the question text.

Two properties make this correct rather than a no-op:

- **The set must survive the reconnect edge, so it cannot live in the [modal store](modal-prompt-model.md).**
  `connected` lands *before* the daemon's re-sent frames — `modalBridge.ts` → `modalPrompts.ts`'s
  `reconnected` arm is built on exactly that ordering (clear, then let the re-sends repopulate). Since
  [#510](../codebase/510.md), that arm clears both `outstanding` and `resolved`, so the store has no
  memory across the edge this bug needs suppressed across. Nothing remounts `usePushNotify`'s
  subscription on a reconnect either — `App.tsx`'s `route` moves only on the mount-time pairing-status
  read, `onPaired`, or `onUnpaired`, never a daemon event — so the closure-local `Set` outlives every
  handshake and dies only when [`PairedShell`](paired-shell.md) unmounts on unpair.
- **The record happens after the send, not at the dedup check.** A delivery dropped by the push toggle
  was never announced, so a user who turns push on mid-prompt must still be notified when the daemon
  re-sends it.

Deliberately no pruning: there is no `modalDismissed`-driven eviction and no size cap. Evicting on
dismissal would reintroduce [#510](../codebase/510.md)'s bug in notification form — an Allow clicked
while disconnected is swallowed by the transport, the renderer optimistically dispatches `dismissed`
anyway, and the daemon's genuine re-send after the handshake would then re-notify. Growth is one short
string per distinct prompt per pairing session, not an observed failure mode, so a cap was rejected
too. A first delivery the main-side focus gate silently drops still counts as announced — accepted, not
a gap: the payload is `{ kind }`-only and there is no reply channel, and a focused window means the
prompt was already rendered in front of the user.

Two independent, deterministic gates guard the same notification, in different fabric: main gates on
*window focus* (§ above, #391 owns it); the trigger gates on the *Settings push toggle* (#392 owns
it, the renderer owns settings state). Neither is a stochastic agent rule.

## The guard is the security-relevant line

`isNotifyPayload` deliberately does **not** follow the sibling `is*Payload` shape (`typeof
value.field === 'string'`, which accepts any string). It tests closed-set membership:
`value.kind === 'turn-complete' || value.kind === 'prompt'`. A `typeof === 'string'` check here
would defeat the whole guarantee — an arbitrary string would pass the boundary and later map to no
copy at all. This is the one guard in the command-channel family that checks value equality against
a literal set rather than just type.

The closed-set invariant covers the **body** only. [#1593](https://github.com/pyrycode/pyrycode-desktop/issues/1593)
gave `NotifyPayload` an optional `name: string` — the conversation's name, resolved renderer-side and
title-bound only. `isNotifyPayload` admits it as a second, independent clause: absent, `undefined`, or
a `string`; any other type (number, `null`, object, array) fails the whole command closed. The
conversation id itself never crosses this boundary — the renderer resolves id → name before sending,
so main only ever sees the already-looked-up string. Main does not trust that string's *content* just
because its *type* passed the guard: `fireNotification`'s `notificationTitle` (below) is the actual
cleaner, belt-and-suspenders in different fabric from the guard's type check.

## The copy table holds the body only

```ts
const NOTIFICATION_COPY: Record<NotifyKind, string> = {
  'turn-complete': 'Your turn is complete.',
  prompt:          'Waiting for your response.'
}
const DEFAULT_TITLE = 'Pyrycode'
```

`Record<NotifyKind, …>` means a future `kind` won't type-check until it has body copy — the table
can't silently fall out of sync with the enum. Copy wording is **provisional** (client-invented, no
Figma, no daemon source); only the shape (static, main-owned, keyed by `kind`) is load-bearing.

The title used to live in this same table, always `'Pyrycode'` for both kinds. Since
[#1593](https://github.com/pyrycode/pyrycode-desktop/issues/1593) the title is computed, not looked
up: `notificationTitle(name?: string): string` in `fireNotification.ts` drops every control character
(`\p{Cc}`: C0, DEL, C1), keeps at most 80 code points (a surrogate pair is never split — the walk
counts code points, not UTF-16 units, and stops as soon as it has kept 80, so an oversized name costs
no more than the characters it keeps), trims surrounding whitespace, and falls back to `DEFAULT_TITLE`
when nothing usable is left — no name, an empty string, or a string that was whitespace/control-only
before cleaning. `\p{Cc}` does not reach U+2028/U+2029 (line/paragraph separator, category Zl/Zp) or
`\p{Cf}` format characters such as the U+202E bidi override; both can pass through into the title
uncleaned. This matches the ticket's "control characters" wording and was accepted as out of scope at
review — the name only ever reorders or line-breaks the operator's own host's own conversation name, a
cosmetic ceiling, not a body-injection path. Revisit only if a spoofing or rendering report surfaces.

## Configuration and usage

`usePushNotify()` ([#392](../codebase/392.md)) is mounted in [`PairedShell`](paired-shell.md), so the
trigger is live for the lifetime of the paired shell — subscribed on mount, torn down on unpair
(off-handle cleanup), fresh again on re-pair. Whether a fired notification is actually shown to the
user is gated twice, in different fabric: main gates on window focus (#391); the trigger gates on the
Settings push toggle — see the [push-notification preference store](push-notification-preference-store.md)
(#408, renderer-local, persisted `boolean`, default enabled) and the
[Settings row](../codebase/409.md) (#409) that writes it. Click-to-focus (#393, above) is now
reachable for real: any `notify` the trigger causes to fire is clickable, activating the window and
navigating to the thread.

## Edge cases and limitations

- **No `Notification.isSupported()` gate** and **no try/catch around construct/`show()`** —
  deliberate, evidence-based omissions. No unsupported-platform failure has been observed; add the
  gate only if one surfaces.
- **Destroyed-window safe ([#518](../codebase/518.md)), and reopen-correct ([#519](../codebase/519.md)).**
  On macOS, closing the window destroys it without quitting the app. Before #518, a `notify` or a
  notification click arriving afterward threw out of `isFocused()`/`isMinimized()` — an uncaught
  main-process exception. #518 made that safe (`windowHasFocus` reports unfocused, `activateWindow`
  no-ops). #519 then made a dock-reopened window actually reachable: both calls now route through the
  [live-window](live-window.md) holder's `window` face, which is re-attached to whichever
  `BrowserWindow` is current, rather than a captured reference that goes stale on close.
- **Focus is read synchronously at fire-time**, not tracked. `isFocused()` is already `false` when
  the window is blurred, minimized, or hidden — exactly the notify condition — so there is nothing a
  separate tracker would add.
- **The push toggle is read per-event, not cached.** A user flipping [Settings](push-notification-preference-store.md)
  mid-session sees the change apply to the very next `turnEnd`/`modalShown`, not just future app
  launches.
- **`usePushNotify` is renderer-owned, like every hook mounted in `PairedShell`.** On macOS the app
  keeps running after its last window closes, so a hook that needs a live renderer to do its work
  stops doing that work until a Dock reopen mounts a fresh shell. The [app icon attention
  badge](app-badge.md) (#1592), mounted the same way, hits this identically and names it as a shared,
  accepted limit rather than a defect either feature should fix alone.
- **`notificationActivated` is the first main-local `DaemonEvent` arm.** Every other arm is decoded
  from a validated wire envelope; this one originates entirely in the main process (a click on a
  locally-constructed `Notification`). Documented as an exception at the arm's own doc comment in
  `events.ts` rather than editing `emitDaemonEvent.ts`'s "nothing else sends" header.
- **No conversation id in the `notify` payload's `name` path, even though the title names the
  conversation ([#1593](https://github.com/pyrycode/pyrycode-desktop/issues/1593)).** The renderer
  resolves `serverId` + `conversationId` to a `name` and sends only that string for the title. A
  second, independent field carries the click target instead: since
  [#1597](../codebase/1597.md), `subscribePushNotify` also mints an opaque `token` from the same
  `serverId`/`conversationId` pair and the click resolves through it — see [Resolving the click to its
  own conversation](#resolving-the-click-to-its-own-conversation-1597) above. Neither field is derived
  from the other, and main still never sees a conversation or server id, only the opaque string.
- **One notification per prompt across reconnects, not per raised OS notification ([#514](../codebase/514.md), [#1691](https://github.com/pyrycode/pyrycode-desktop/issues/1691)).**
  The daemon re-sends every still-outstanding `modal_shown` after each re-handshake; the trigger
  dedupes on a namespaced `modal:<modalId>` / `batch:<questionBatchId>` key in a closure-local `Set`
  that survives reconnects and dies on unpair. Dedup is per *command sent*, not per *notification
  actually shown* — a first delivery the main-side focus gate silently drops is still recorded as
  announced, so a later re-send while unfocused stays suppressed. See [Dedup across reconnects (#514,
  extended by #1691)](#dedup-across-reconnects-514-extended-by-1691) above.
- **A muted or question-batch `questionShown` carries no batch content into the payload
  ([#1691](https://github.com/pyrycode/pyrycode-desktop/issues/1691)).** Like `modalShown`, the event's
  `questionBatchId` and its `questions` are read only to build the dedup key and are never spread into
  `notify`'s payload; the notification body is the static `'prompt'` copy, and the title is the
  conversation name via the same [#1593](https://github.com/pyrycode/pyrycode-desktop/issues/1593)
  `nameFor` lookup — no per-question text ever reaches the OS notification.

## Related

- [App icon attention badge](app-badge.md) / [#1592](https://github.com/pyrycode/pyrycode-desktop/issues/1592) — the sibling main-local command mounted the same way in `PairedShell`; tells the operator *how many* things need them where this tells them *that* one just happened.
- [Native edit context menu](edit-context-menu.md) — `editContextMenu.ts`, a later module in this one's
  injected-Electron family, copying this module's `fireNotification.test.ts` fake-constructor test idiom
  (#1445).
- [Live window](live-window.md) — the holder both `windowHasFocus`/`activateWindow` calls route
  through since [#519](../codebase/519.md), and why its two faces answer `isDestroyed()` differently.
- [Command channel](command-channel.md) — the `notify` `RendererCommand` member + `isNotifyPayload`
  guard this feature's command rides on.
- [Paired shell](paired-shell.md) — the container both `notificationActivatedBridge`'s
  `useNotificationActivatedNav` and `pushNotifyBridge`'s `usePushNotify` are mounted in.
- [Push-notification preference store](push-notification-preference-store.md) / [#408 codebase
  notes](../codebase/408.md) — the persisted on/off preference the trigger (#392) gates firing on.
- [#391 codebase notes](../codebase/391.md) — implementation summary, patterns, lessons for the
  delivery primitive.
- [#392 codebase notes](../codebase/392.md) — implementation summary, patterns, lessons for the
  renderer trigger.
- [#393 codebase notes](../codebase/393.md) — implementation summary, patterns, lessons for
  click-to-focus.
- [#514 codebase notes](../codebase/514.md) — implementation summary, patterns, lessons for the
  reconnect-dedup hardening.
- [#415 codebase notes](../codebase/415.md) — the daemon reconcile behavior (re-send of still-outstanding
  `modal_shown` on every re-handshake) that #514 exists to absorb.
- [#510 codebase notes](../codebase/510.md) — why the modal store's `reconnected` arm clears `resolved`
  too, and therefore cannot be #514's dedup oracle.
- [#158](https://github.com/pyrycode/pyrycode-desktop/issues/158) — the parent split into
  #391/#392/#393, all merged.
- [#1593](https://github.com/pyrycode/pyrycode-desktop/issues/1593) — the title now names the
  conversation the notification is about; the body stays client-owned. Renderer-resolved name,
  main-side cleaning (`notificationTitle`), no conversation id crosses the boundary.
- [#1607](https://github.com/pyrycode/pyrycode-desktop/issues/1607) — a conversation muted on its
  host sends neither `notify` kind; see [Muting suppresses the send](#muting-suppresses-the-send-1607)
  above. The [app icon badge](app-badge.md) drops the same rows from its count.
- [#1691](https://github.com/pyrycode/pyrycode-desktop/issues/1691) — a `questionShown` batch now
  maps to `'prompt'` too, the same way mobile's `HostConversationSource` alerts on one; the reconnect
  dedup key gained a `modal:`/`batch:` namespace so a batch and a modal sharing a raw id announce
  independently. See [The trigger (#392)](#the-trigger-392) and [Dedup across reconnects (#514,
  extended by #1691)](#dedup-across-reconnects-514-extended-by-1691) above.
