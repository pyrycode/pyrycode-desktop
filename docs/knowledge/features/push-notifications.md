# Push notifications (delivery primitive + click-to-focus)

Fires a native OS notification when the main window is unfocused, so background alerts (a
turn-complete, an incoming prompt) can reach the user without their having to watch the window.
Desktop push rides the relay socket the app already holds open — no Firebase, no push-wake path,
unlike mobile: a backgrounded desktop app is not suspended, so the events that matter already
arrive over the socket to a client that never disconnected.

Introduced in [#391](../codebase/391.md) as the **delivery primitive only** — a `notify` command
(renderer→main) that main turns into an Electron `Notification`, gated on focus. Split from
[#158](https://github.com/pyrycode/pyrycode-desktop/issues/158) into three slices: #391 (this
primitive), [#392](https://github.com/pyrycode/pyrycode-desktop/issues/392) (the trigger — decides
*when* the renderer sends `notify`, blocked on the interactive stream #353, still open), and
[#393](../codebase/393.md) (click-to-focus, merged — see [below](#clicking-the-notification-393)).
Ships **dormant** — no renderer sends `notify` yet, so the click path is exercised only with a fake
notification in tests until #392 lands.

## What it does

Given a `notify` command carrying a closed `kind` (`'turn-complete' | 'prompt'`), the main process:

1. Reads `mainWindow.isFocused()` **at fire-time** — no separate stateful focus tracker. Focused →
   no-op.
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
harness). The composition root in `index.ts` closes `mainWindow.isFocused()` and Electron's real
`Notification` into it, exactly as it closes `downloadsDir` into `saveDebugBundle`.

## Clicking the notification (#393)

[#393](../codebase/393.md) makes the notification actionable. `fireNotification` registers
`deps.onClick` as the constructed notification's `'click'` listener **before** calling `.show()` (a
click could otherwise arrive the instant the notification appears). `onClick` is opaque to this
module — `fireNotification` has no window or IPC knowledge; `index.ts`, the sole composition site,
supplies it:

```ts
fireNotification(command.payload.kind, {
  isWindowFocused: () => mainWindow.isFocused(),
  Notification,
  onClick: () => {
    activateWindow(mainWindow)
    emitDaemonEvent(mainWindow, { type: 'notificationActivated' })
  }
})
```

Two effects, composed in one place:

1. **Window activation** — a new injected helper, co-located in `fireNotification.ts`:

   ```ts
   export interface ActivatableWindow {
     isMinimized(): boolean
     restore(): void
     show(): void
     focus(): void
   }
   export function activateWindow(win: ActivatableWindow): void {
     if (win.isMinimized()) win.restore()
     win.show()
     win.focus()
   }
   ```

   `restore()` un-minimizes, `show()` covers the hidden case, and an explicit `focus()` covers
   already-visible-but-behind. `isVisible` is deliberately absent from the interface — `show()` is
   safe to call unconditionally. `mainWindow` (a real `BrowserWindow`) satisfies `ActivatableWindow`
   structurally, so no `electron` import reaches this unit.

2. **Renderer navigation** — a new bare `DaemonEvent` arm, `{ type: 'notificationActivated' }`
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

Not wired to anything yet. When #392 lands, its renderer trigger will build
`{ type: 'notify', payload: { kind } }` and call `window.pyry.sendCommand(...)` — no constructor
exists for this member (several bare/simple members build inline; #392 may add one). The click
behaviour (#393, above) is already in place on the `Notification` instance this module constructs —
it activates the window and navigates to the thread — but is only reachable in practice once #392
causes a real fire.

## Edge cases and limitations

- **No `Notification.isSupported()` gate** and **no try/catch around construct/`show()`** —
  deliberate, evidence-based omissions. No unsupported-platform failure has been observed; add the
  gate only if one surfaces.
- **Focus is read synchronously at fire-time**, not tracked. `isFocused()` is already `false` when
  the window is blurred, minimized, or hidden — exactly the notify condition — so there is nothing a
  separate tracker would add.
- **Click-to-focus is dormant, not untested.** The click path (#393) is fully unit-tested with a fake
  notification + fake window, but has never fired for real — that waits on #392.
- **`notificationActivated` is the first main-local `DaemonEvent` arm.** Every other arm is decoded
  from a validated wire envelope; this one originates entirely in the main process (a click on a
  locally-constructed `Notification`). Documented as an exception at the arm's own doc comment in
  `events.ts` rather than editing `emitDaemonEvent.ts`'s "nothing else sends" header.

## Related

- [Command channel](command-channel.md) — the `notify` `RendererCommand` member + `isNotifyPayload`
  guard this feature's command rides on.
- [Paired shell](paired-shell.md) — the container `notificationActivatedBridge`'s
  `useNotificationActivatedNav` hook is mounted in.
- [#391 codebase notes](../codebase/391.md) — implementation summary, patterns, lessons for the
  delivery primitive.
- [#393 codebase notes](../codebase/393.md) — implementation summary, patterns, lessons for
  click-to-focus.
- [#158](https://github.com/pyrycode/pyrycode-desktop/issues/158) — the parent split into #391/#392/#393.
- Next: [#392](https://github.com/pyrycode/pyrycode-desktop/issues/392) (the trigger, still open,
  blocked on #353) is the only piece left to make this feature live end-to-end.
