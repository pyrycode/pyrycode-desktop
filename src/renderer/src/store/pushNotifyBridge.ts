// The renderer push-notify trigger (#392) — a filter bridge in the mould of notificationActivatedBridge /
// conversationCreatedBridge. It watches the already-decoded daemon-event channel for the two notify-worthy
// moments (turn-end, permission/trust prompt) and, gated by the Settings push toggle (#408), sends the
// MAIN-LOCAL `notify` command asking the background process to raise an OS notification (#391 owns the
// unfocused-window gate + the static copy table). `notifyKindForEvent` is the pure filter;
// `subscribePushNotify` is the React-free injected data path (unit-testable with plain spies);
// `usePushNotify` is the thin React glue. Nothing here touches keys, sockets, ipcRenderer, or raw frames —
// it only subscribes through the preload bridge, reads a renderer-local boolean, and dispatches an
// already-typed, closed-enum command that never reaches the transport.
//
// This is a `default:null`-style FILTER bridge (the notificationActivatedBridge shape), NOT an exhaustive
// `assertNever` one: it introduces no new DaemonEvent arm, so it must not force a matching no-op case into
// modalBridge, timelineBridge, AND daemonEventBridge. `default: null` is the intended, permanent behaviour —
// this path deliberately consumes only its two arms (turnEnd, modalShown) and no-ops everything else.
import { useEffect } from 'react'
import type { NotifyKind, RendererCommand } from '@shared/ipc/commands'
import type { DaemonEvent } from '@shared/ipc/events'
import { pushNotificationPrefStore } from './pushNotificationPrefStore'

/**
 * The filter: map the two owned arms to their `NotifyKind`, every other DaemonEvent to `null`. A
 * `turnEnd` is a turn-complete; every `modalShown` is a permission/trust prompt (WireModalClass admits
 * exactly `'permission' | 'trust'`, ADR 0009 — no destructive class — so no class-narrowing filter is
 * needed). `default: null` — not an `assertNever` — because ignoring the rest is the intended, permanent
 * behaviour here (the translateConversationCreated precedent). Reads ONLY the discriminant `event.type`;
 * the returned value is always a closed `NotifyKind` literal, never a daemon-supplied field — the
 * `NotifyKind | null` return type makes it a compile-time guarantee that no widened daemon string can
 * escape (AC4).
 */
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

/**
 * Subscribe via the injected `onDaemonEvent`; for each event, filter to a `NotifyKind` first, then — only
 * for the two owned arms — consult the push toggle and, if enabled, send the `notify` command. An inline
 * `RendererCommand` literal (no `notifyCommand()` helper, the requestNewConversation precedent — keeps the
 * change renderer-contained). Returns the `onDaemonEvent` off handle so the React binding can use it as its
 * effect cleanup.
 *
 * Filter-first, then toggle: short-circuits the common case (most events are neither arm) before touching
 * the store, and keeps "every other daemon event no-ops" literally true regardless of toggle state (AC4).
 * `isPushEnabled` is read PER-EVENT (a thunk), not captured at subscribe time — load-bearing for AC3: a
 * user who flips the toggle off in Settings mid-session must see the NEXT turn-end/prompt not fire. The
 * `{ kind }` payload is a fresh literal built from the closed kind alone — no daemon field is copied in.
 * The listener only ever calls `sendCommand` inside the two owned arms and never throws into React.
 */
export function subscribePushNotify(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  sendCommand: (command: RendererCommand) => void,
  isPushEnabled: () => boolean
): () => void {
  return onDaemonEvent((event) => {
    const kind = notifyKindForEvent(event)
    if (kind === null) return
    if (!isPushEnabled()) return
    sendCommand({ type: 'notify', payload: { kind } })
  })
}

/**
 * Wire the push-notify trigger for the mounting component's lifetime — mounted in PairedShell beside
 * useNotificationActivatedNav, so the subscription lives only while the paired shell is on screen (unpair
 * unmounts it → the off handle tears it down; re-pair mounts a fresh one). Subscribes exactly once
 * (empty-dep effect, off-handle as cleanup — a StrictMode double-mount nets exactly one live listener).
 *
 * No `useRef` ceremony (unlike useNotificationActivatedNav / useConversationCreatedNav): there is no
 * per-render caller callback to hold — all three deps are module-level singletons, so the effect closure
 * is stable and self-contained. Production reads the toggle via a thunk that snapshots the current store
 * state on each call (the per-event read AC3 needs). `window.pyry` is dereferenced ONLY inside the effect,
 * so PairedShell stays server-renderable.
 */
export function usePushNotify(): void {
  useEffect(
    () =>
      subscribePushNotify(
        window.pyry.onDaemonEvent,
        window.pyry.sendCommand,
        () => pushNotificationPrefStore.getState().pushNotificationsEnabled
      ),
    []
  )
}
