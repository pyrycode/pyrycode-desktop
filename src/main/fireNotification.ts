// Raise a native OS notification for a `notify` command (#391), but ONLY when the main window is
// unfocused. Both halves are main-process concepts — BrowserWindow.isFocused() and Electron's
// Notification API are main-only — so the fire-decision and the OS call live here, not the renderer.
//
// Shaped like emitDaemonEvent.ts: a plain function whose Electron dependencies are INJECTED as
// parameters, so it never imports `electron` and unit-tests with fakes. Focus is read at fire-time
// via a synchronous query — there is no stateful focus tracker (isFocused() is already false when the
// window is blurred, minimized, or hidden, exactly the notify condition).
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import type { NotifyKind } from '../shared/ipc/commands'

/**
 * The minimal surface an OS notification exposes — just `show()`. Electron's real Notification
 * instance satisfies this structurally (as a BrowserWindow satisfies DaemonEventSink), so the
 * wiring site injects the real class and the unit test injects a fake, with no Electron harness.
 */
export interface OsNotification {
  show(): void
}

/**
 * The constructor shape injected in place of Electron's `Notification`. Its options are exactly the
 * two fields this slice sets; the real Electron constructor accepts a superset with all-optional
 * fields, so it is structurally assignable here without a cast.
 */
export interface OsNotificationConstructor {
  new (options: { title: string; body: string }): OsNotification
}

/**
 * The main-owned copy table (AC5): the notification title/body live HERE, keyed by `kind`, never in
 * the command. `Record<NotifyKind, …>` makes it exhaustive by construction — a future kind won't
 * type-check until it has copy. Copy wording is provisional (no Figma, no daemon source); the
 * load-bearing invariant is that the strings are static and main-owned, never sourced from the wire.
 */
const NOTIFICATION_COPY: Record<NotifyKind, { title: string; body: string }> = {
  'turn-complete': { title: 'Pyrycode', body: 'Your turn is complete.' },
  prompt: { title: 'Pyrycode', body: 'Waiting for your response.' }
}

/**
 * Raise the OS notification for `kind` — but only when the window is unfocused. Synchronous, no
 * return value: if `deps.isWindowFocused()` is true, return without firing; otherwise construct a
 * Notification with the kind's copy and `show()` it. The text comes solely from the closed enum via
 * NOTIFICATION_COPY, so no command field can supply notification content.
 */
export function fireNotification(
  kind: NotifyKind,
  deps: { isWindowFocused: () => boolean; Notification: OsNotificationConstructor }
): void {
  if (deps.isWindowFocused()) return
  new deps.Notification(NOTIFICATION_COPY[kind]).show()
}
