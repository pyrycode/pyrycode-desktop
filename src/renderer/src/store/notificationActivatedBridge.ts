// The renderer notification-click nav bridge (#393) — a near-clone of conversationCreatedBridge,
// minus the command-send half. It subscribes to the daemon-event channel and, on each
// `notificationActivated`, invokes a caller-supplied `onActivated` with the notification's re-validated
// token or null (in PairedShell, that opens the notification's own conversation, #1597).
// `subscribeNotificationActivated` is the React-free, injected data path (unit-testable with plain spies);
// `useNotificationActivatedNav` is the thin React glue over it. Nothing here touches keys, sockets,
// ipcRenderer, or raw frames — it only subscribes through the preload bridge and consumes an
// already-typed event. This is a `default:null`-style FILTER bridge (it deliberately consumes only its
// one arm), not an exhaustive one — the conversationCreatedBridge shape.
import { useEffect, useRef } from 'react'
import { isNotificationToken } from '@shared/ipc/commands'
import type { DaemonEvent } from '@shared/ipc/events'

/**
 * Subscribe via the injected `onDaemonEvent`; each `notificationActivated` invokes `onActivated` once,
 * every unrelated event no-ops. The filter is inlined on the discriminant — a rename of the arm is
 * still caught (the comparison narrows the union, so a label that no longer overlaps is a type error).
 * Returns the unsubscribe handle (the
 * subscribeConversationCreated off-handle idiom) so the React binding can use it as its effect cleanup.
 * The listener only invokes the callback — it never throws into React.
 *
 * #1597: the arm may echo the opaque token the renderer minted for that notification. It is
 * re-validated here (isNotificationToken, the same check main's notify guard applies) before it can
 * reach a lookup; an absent or inadmissible token arrives as `null`, which means "show the active
 * conversation", the pre-#1597 behaviour.
 */
export function subscribeNotificationActivated(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  onActivated: (token: string | null) => void
): () => void {
  return onDaemonEvent((event) => {
    if (event.type !== 'notificationActivated') return
    onActivated(isNotificationToken(event.token) ? event.token : null)
  })
}

/**
 * Wire the notification-click channel to a caller callback for the mounting component's lifetime —
 * mounted in PairedShell beside useConversationCreatedNav, so the subscription lives only while the
 * paired shell is on screen (unpair unmounts it → the off handle tears it down; re-pair mounts a fresh
 * one). Subscribes exactly once (empty-dep effect, off-handle as cleanup — a StrictMode double-mount
 * nets exactly one live listener, the useConversationCreatedNav guarantee). The caller passes a fresh
 * inline arrow each render, so the latest `onActivated` is held in a ref and invoked from the listener;
 * the subscription is established once and never re-subscribes on route-flip re-renders. `window.pyry`
 * is dereferenced only inside the effect, so the mounting component stays server-renderable.
 */
export function useNotificationActivatedNav(onActivated: (token: string | null) => void): void {
  const onActivatedRef = useRef(onActivated)
  useEffect(() => {
    onActivatedRef.current = onActivated
  })
  useEffect(
    () => subscribeNotificationActivated(window.pyry.onDaemonEvent, (token) => onActivatedRef.current(token)),
    []
  )
}
