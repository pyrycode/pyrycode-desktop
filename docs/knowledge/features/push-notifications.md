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
feature is now **live end-to-end**.

## What it does

Given a `notify` command carrying a closed `kind` (`'turn-complete' | 'prompt'`), the main process:

1. Reads the window's focus state via `windowHasFocus(live.window)` **at fire-time** — no separate
   stateful focus tracker. Focused → no-op. (Destroyed-safe since [#518](../codebase/518.md): a
   destroyed window reports unfocused without touching `isFocused()`. Since [#519](../codebase/519.md),
   `live.window` is the [live-window](live-window.md) holder's current-window face, not a captured
   `BrowserWindow`, so a dock-reopened window is queried correctly instead of a destroyed original.)
2. Unfocused → looks up `kind` in a main-owned copy table, constructs an Electron `Notification` with
   that title/body, registers the [click handler](#clicking-the-notification-393) on it, then calls
   `.show()`.

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
| `fireNotification(kind, deps)` + `NOTIFICATION_COPY` table + `activateWindow` (#393) | `src/main/fireNotification.ts` |
| `case 'notify':` dispatch, incl. the `onClick` composition (#393) | `src/main/index.ts` (the single `onCommand` switch) |
| `notificationActivated` `DaemonEvent` arm (#393) | `src/shared/ipc/events.ts` |
| `notificationActivatedBridge.ts` (#393) | `src/renderer/src/store/notificationActivatedBridge.ts` |
| `pushNotifyBridge.ts` — `notifyKindForEvent`, `subscribePushNotify`, `usePushNotify` (#392) | `src/renderer/src/store/pushNotifyBridge.ts` |

```ts
export type NotifyKind = 'turn-complete' | 'prompt'
export interface NotifyPayload { kind: NotifyKind }

export interface OsNotification {
  show(): void
  on(event: 'click', listener: () => void): void   // #393
}
export interface OsNotificationConstructor {
  new (options: { title: string; body: string }): OsNotification
}

export function fireNotification(
  kind: NotifyKind,
  deps: { isWindowFocused: () => boolean; Notification: OsNotificationConstructor; onClick: () => void }
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

3. **Renderer navigation** — a new bare `DaemonEvent` arm, `{ type: 'notificationActivated' }`
   (`src/shared/ipc/events.ts`). This is the **first main-local signal** on the `DaemonEvent`
   channel: unlike every other arm, it is not derived from a validated wire envelope — it is emitted
   directly by this click handler. Nullary by construction, so no daemon-relayed content, conversation
   id, or wire field can ride it. A new consume-only filter bridge,
   `src/renderer/src/store/notificationActivatedBridge.ts` (a near-clone of
   [`conversationCreatedBridge`](new-discussion-fab.md), minus the command-send half and the
   payload), consumes it and is mounted in [`PairedShell`](paired-shell.md) beside
   `useConversationCreatedNav`: `useNotificationActivatedNav(() => dispatch({ type: 'open' }))`. Since
   `nextPairedRoute`'s `open` transition is already absolute (any route → `thread`), the click lands
   on the thread view regardless of which paired view (list / settings / archive) was showing, with
   no new route or nav arm. Deliberately **no** `setActiveConversation` call — the arm carries no
   payload, and in the single-active-conversation model "open" already means "show the existing
   active conversation."

   The three exhaustive renderer bridges (`daemonEventBridge` / `timelineBridge` / `modalBridge`) each
   gained a one-line `case 'notificationActivated': return null` (or equivalent), compile-forced by
   their `assertNever` guards — the same cascade every prior arm-adding slice paid.

## The trigger (#392)

[#392](../codebase/392.md) is the renderer half that decides *when* to send `notify`. A filter
bridge, `src/renderer/src/store/pushNotifyBridge.ts`, watches the already-decoded `DaemonEvent`
channel for exactly two arms:

```ts
export function notifyKindForEvent(event: DaemonEvent): NotifyKind | null {
  switch (event.type) {
    case 'turnEnd':
      return 'turn-complete'
    case 'modalShown':
      return 'prompt'
    default:
      return null
  }
}
```

Every `modalShown` is a permission/trust prompt by construction (`WireModalClass` admits exactly
`'permission' | 'trust'`, ADR 0009 — no destructive class), so no class-narrowing is needed. This is
a `default: null` **filter**, not an `assertNever` exhaustive switch — it introduces no new
`DaemonEvent` arm, so it doesn't force a matching no-op case into `modalBridge` / `timelineBridge` /
`daemonEventBridge`, unlike the `notificationActivated` arm #393 added.

`subscribePushNotify(onDaemonEvent, sendCommand, isPushEnabled)` is the React-free data path: filter
first (short-circuits on the common case), then — only for the two owned arms — reads
`isPushEnabled()` and, if true, sends `{ type: 'notify', payload: { kind } }` as an inline
`RendererCommand` literal (no constructor helper added). `isPushEnabled` is a **per-event thunk**,
not a boolean captured at subscribe time — production passes
`() => pushNotificationPrefStore.getState().pushNotificationsEnabled`, so a user who flips the
[Settings toggle](push-notification-preference-store.md) mid-session sees the very next
turn-end/prompt respect the new value. `usePushNotify()` mounts this in
[`PairedShell`](paired-shell.md) beside `useNotificationActivatedNav`, with no `useRef` — unlike its
sibling hooks, it takes no per-render caller callback, so its three dependencies (`window.pyry.*`,
the pref-store thunk) can be closed over directly in an empty-dep effect.

### Dedup across reconnects (#514)

The daemon deliberately re-sends every still-outstanding `modal_shown` after each re-handshake
([#415](../codebase/415.md) reconcile), so without further guarding a prompt left unanswered while the
window was backgrounded earned a fresh OS notification per network flap or sleep/wake cycle.
[#514](../codebase/514.md) closed this: `subscribePushNotify` opens a closure-local
`announcedModalIds = new Set<string>()` once per subscription. On the `modalShown` arm only, it binds
`const modalId = event.type === 'modalShown' ? event.modalId : null` (narrowed on the discriminant, the
only new read of a daemon-supplied field, never leaving the listener), short-circuits before the
toggle read if `modalId !== null && announcedModalIds.has(modalId)`, and — **only after** the
`sendCommand` call — records `modalId` into the set. `turnEnd` is untouched by construction: `modalId`
is `null` for every non-`modalShown` arm, so both the check and the record are skipped for the rest of
the union without a second rule. The `{ kind }` payload literal is unchanged; `modalId` is never
spread or interpolated into it.

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

## The copy table is exhaustive by construction

```ts
const NOTIFICATION_COPY: Record<NotifyKind, { title: string; body: string }> = {
  'turn-complete': { title: 'Pyrycode', body: 'Your turn is complete.' },
  prompt:          { title: 'Pyrycode', body: 'Waiting for your response.' }
}
```

`Record<NotifyKind, …>` means a future `kind` won't type-check until it has copy — the table can't
silently fall out of sync with the enum. Copy wording is **provisional** (client-invented, no Figma,
no daemon source); only the shape (static, main-owned, keyed by `kind`) is load-bearing.

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
- **`notificationActivated` is the first main-local `DaemonEvent` arm.** Every other arm is decoded
  from a validated wire envelope; this one originates entirely in the main process (a click on a
  locally-constructed `Notification`). Documented as an exception at the arm's own doc comment in
  `events.ts` rather than editing `emitDaemonEvent.ts`'s "nothing else sends" header.
- **No conversation id on the notification.** Desktop's single-active-conversation model means daemon
  events drop `conversation_id` at the emit, so `NotifyPayload` carries only `kind` — clicking always
  opens the one active conversation ([#393](../codebase/393.md)), never a specific thread.
- **One notification per prompt across reconnects, not per raised OS notification ([#514](../codebase/514.md)).**
  The daemon re-sends every still-outstanding `modal_shown` after each re-handshake; the trigger now
  dedupes on `modalId` in a closure-local `Set` that survives reconnects and dies on unpair. Dedup is
  per *command sent*, not per *notification actually shown* — a first delivery the main-side focus gate
  silently drops is still recorded as announced, so a later re-send while unfocused stays suppressed.
  See [Dedup across reconnects (#514)](#dedup-across-reconnects-514) above.

## Related

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
