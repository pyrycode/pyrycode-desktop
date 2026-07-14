# Push notifications (main-process delivery primitive)

Fires a native OS notification when the main window is unfocused, so background alerts (a
turn-complete, an incoming prompt) can reach the user without their having to watch the window.
Desktop push rides the relay socket the app already holds open — no Firebase, no push-wake path,
unlike mobile: a backgrounded desktop app is not suspended, so the events that matter already
arrive over the socket to a client that never disconnected.

Introduced in [#391](../codebase/391.md) as the **delivery primitive only** — a `notify` command
(renderer→main) that main turns into an Electron `Notification`, gated on focus. Split from
[#158](https://github.com/pyrycode/pyrycode-desktop/issues/158) into three slices: this one, [#392](https://github.com/pyrycode/pyrycode-desktop/issues/392)
(the trigger — decides *when* the renderer sends `notify`, blocked on the interactive stream #353),
and [#393](https://github.com/pyrycode/pyrycode-desktop/issues/393) (click-to-focus). Ships
**dormant** — no renderer sends `notify` yet.

## What it does

Given a `notify` command carrying a closed `kind` (`'turn-complete' | 'prompt'`), the main process:

1. Reads `mainWindow.isFocused()` **at fire-time** — no separate stateful focus tracker. Focused →
   no-op.
2. Unfocused → looks up `kind` in a main-owned copy table and raises an Electron `Notification`
   with that title/body, then calls `.show()`.

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
| `fireNotification(kind, deps)` + `NOTIFICATION_COPY` table | `src/main/fireNotification.ts` |
| `case 'notify':` dispatch | `src/main/index.ts` (the single `onCommand` switch) |

```ts
export type NotifyKind = 'turn-complete' | 'prompt'
export interface NotifyPayload { kind: NotifyKind }

export interface OsNotification { show(): void }
export interface OsNotificationConstructor {
  new (options: { title: string; body: string }): OsNotification
}

export function fireNotification(
  kind: NotifyKind,
  deps: { isWindowFocused: () => boolean; Notification: OsNotificationConstructor }
): void
```

`fireNotification` is shaped like `emitDaemonEvent.ts`: a plain function with Electron dependencies
**injected** as parameters, never `import 'electron'`, unit-tested entirely with fakes (no Electron
harness). The composition root in `index.ts` closes `mainWindow.isFocused()` and Electron's real
`Notification` into it, exactly as it closes `downloadsDir` into `saveDebugBundle`.

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
exists for this member (several bare/simple members build inline; #392 may add one). #393 will add
click behaviour to the `Notification` instance this module constructs, which currently does nothing
on click.

## Edge cases and limitations

- **No `Notification.isSupported()` gate** and **no try/catch around construct/`show()`** —
  deliberate, evidence-based omissions. No unsupported-platform failure has been observed; add the
  gate only if one surfaces.
- **Focus is read synchronously at fire-time**, not tracked. `isFocused()` is already `false` when
  the window is blurred, minimized, or hidden — exactly the notify condition — so there is nothing a
  separate tracker would add.
- **No click behaviour** — clicking the notification does nothing until #393.

## Related

- [Command channel](command-channel.md) — the `notify` `RendererCommand` member + `isNotifyPayload`
  guard this feature's command rides on.
- [#391 codebase notes](../codebase/391.md) — implementation summary, patterns, lessons.
- [#158](https://github.com/pyrycode/pyrycode-desktop/issues/158) — the parent split into #391/#392/#393.
- Next: [#392](https://github.com/pyrycode/pyrycode-desktop/issues/392) (the trigger, blocked on
  #353) → [#393](https://github.com/pyrycode/pyrycode-desktop/issues/393) (click-to-focus).
