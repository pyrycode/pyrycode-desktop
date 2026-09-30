// The renderer push-notify trigger (#392) — a filter bridge in the mould of notificationActivatedBridge /
// conversationCreatedBridge. It watches the already-decoded daemon-event channel for the notify-worthy
// moments (turn-end, permission/trust prompt, question batch) and, gated by the Settings push toggle
// (#408), sends the MAIN-LOCAL `notify` command asking the background process to raise an OS
// notification (#391 owns the unfocused-window gate + the static copy table). `notifyKindForEvent` is the
// pure filter;
// `subscribePushNotify` is the React-free injected data path (unit-testable with plain spies);
// `usePushNotify` is the thin React glue. Nothing here touches keys, sockets, ipcRenderer, or raw frames —
// it only subscribes through the preload bridge, reads a renderer-local boolean, and dispatches an
// already-typed, closed-enum command that never reaches the transport.
//
// This is a `default:null`-style FILTER bridge (the notificationActivatedBridge shape), NOT an exhaustive
// `assertNever` one: it introduces no new DaemonEvent arm, so it must not force a matching no-op case into
// modalBridge, timelineBridge, AND daemonEventBridge. `default: null` is the intended, permanent behaviour —
// this path deliberately consumes only its three arms (turnEnd, modalShown, questionShown) and no-ops
// everything else.
import { useEffect } from 'react'
import type { NotifyKind, RendererCommand } from '@shared/ipc/commands'
import type { DaemonEvent, StampedDaemonEvent } from '@shared/ipc/events'
import {
  conversationListStore,
  type ConversationListState,
  type ServerConversationSummary
} from './conversationListStore'
import { pushNotificationPrefStore } from './pushNotificationPrefStore'

/**
 * The filter: map the three owned arms to their `NotifyKind`, every other DaemonEvent to `null`. A
 * `turnEnd` is a turn-complete; every `modalShown` is a permission/trust prompt (WireModalClass admits
 * exactly `'permission' | 'trust'`, ADR 0009 — no destructive class — so no class-narrowing filter is
 * needed), and a `questionShown` batch is a prompt too (#1691), as mobile alerts on it. `default: null`
 * — not an `assertNever` — because ignoring the rest is the intended, permanent behaviour here (the translateConversationCreated precedent). Reads ONLY the discriminant `event.type`;
 * the returned value is always a closed `NotifyKind` literal, never a daemon-supplied field — the
 * `NotifyKind | null` return type makes it a compile-time guarantee that no widened daemon string can
 * escape (AC4).
 */
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

/**
 * Subscribe via the injected `onDaemonEvent`; for each event, filter to a `NotifyKind` first, then — only
 * for the owned arms — consult the push toggle and, if enabled, send the `notify` command. An inline
 * `RendererCommand` literal (no `notifyCommand()` helper, the requestNewConversation precedent — keeps the
 * change renderer-contained). Returns the `onDaemonEvent` off handle so the React binding can use it as its
 * effect cleanup.
 *
 * Filter-first, then toggle: short-circuits the common case (most events are neither arm) before touching
 * the store, and keeps "every other daemon event no-ops" literally true regardless of toggle state (AC4).
 * `isPushEnabled` is read PER-EVENT (a thunk), not captured at subscribe time — load-bearing for AC3: a
 * user who flips the toggle off in Settings mid-session must see the NEXT turn-end/prompt not fire. The
 * payload is a fresh literal built from the closed kind plus, since #1593, the looked-up conversation name
 * — no field of the event itself is copied in.
 * The listener only ever calls `sendCommand` inside the owned arms and never throws into React.
 *
 * #514: one OS notification per prompt, however many times the link re-handshakes. The daemon re-sends
 * every still-outstanding modal_shown after each handshake (#415 reconcile), so a prompt left unanswered
 * while the window is in the background used to earn a fresh notification per network flap. A
 * closure-local set of already-announced `modalId`s absorbs the re-delivery; since #1691 it also holds
 * question batch ids, each namespaced so a batch and a modal sharing an id never suppress each other.
 * Three properties it depends on:
 *
 * - It must SURVIVE the reconnect edge. `connected` lands BEFORE the daemon's re-sent frames — that
 *   ordering is what modalBridge/modalPrompts' clear-then-repopulate reset is built on — so memory
 *   cleared there would be empty when the re-sends arrive and every reconnect would re-notify as before.
 *   Nothing remounts this subscription on a reconnect: App's route flips only on the mount-time
 *   pairing-status read, onPaired, or onUnpaired, so the closure spans every handshake. Unpair is the
 *   reset edge — it unmounts PairedShell, the cleanup runs, and the set dies with the closure. Hence
 *   closure-local rather than module-level: the reset is structural, and nothing leaks across tests.
 * - The record happens AFTER the send, not at the dedup check. A prompt dropped by the toggle gate was
 *   never announced, so a user who turns push on mid-prompt must still be notified when the daemon
 *   re-sends it.
 * - The set is never pruned — no dismissal-driven eviction, no cap. Evicting on dismissal would
 *   reintroduce #510 in notification form: an Allow clicked while the link is down is swallowed by the
 *   transport, the renderer optimistically dispatches `dismissed` anyway, and the daemon re-sends the
 *   still-outstanding prompt after the handshake — which would then re-notify.
 *
 * Dedup is per COMMAND, not per raised OS notification: if the window is focused on the first delivery,
 * main's focus gate (fireNotification.ts) drops it silently and the id is still recorded. Accepted —
 * `isWindowFocused()` is main-side, the payload carries no id, and there is no reply channel; a
 * focused window means the prompt was rendered in front of the user, and it stays on screen.
 * `turnEnd` is untouched: `announceKey` is null for every other arm, so both the check and the record are
 * skipped for the whole rest of the union by construction.
 *
 * #1593: the notification's title names the conversation. Only for an event that will actually send,
 * `nameFor` resolves the event's own client-stamped `serverId` and its `conversationId` to a name,
 * read per event like the toggle. A name rides as `payload.name`; an unnamed or unknown conversation
 * omits the key (never a present `undefined`, which structured clone would carry across). The
 * conversation id is a lookup key only and never leaves the listener. The name is untrusted host text:
 * main cleans it before use, and nothing here logs it.
 *
 * #1597: the click opens the conversation that raised the notification. On the same send path, and from
 * the same two lookup keys, `mintToken` files the event's server and conversation under a fresh opaque
 * token; only the token rides the payload, and main echoes it back on the click. Optional so a caller
 * that does not need click routing sends no token (the click then shows the active conversation);
 * production always passes it.
 *
 * #1607: a conversation muted on its host notifies nothing, for either kind — the host stores one flag.
 * `isMuted` is read per event like the toggle, keyed by the event's own `serverId` like the name, and
 * sits after the toggle gate so a muted event mints no token. Like a toggle-dropped prompt, a muted one
 * is never recorded as announced, so a prompt unmuted while outstanding notifies on the daemon's
 * re-send. Optional and "not muted" when omitted, so a caller that does not care passes nothing.
 */
export function subscribePushNotify(
  onDaemonEvent: (listener: (event: StampedDaemonEvent) => void) => () => void,
  sendCommand: (command: RendererCommand) => void,
  isPushEnabled: () => boolean,
  nameFor: (serverId: string | null, conversationId: string) => string | null,
  mintToken?: (target: NotificationTarget) => string,
  isMuted?: (serverId: string | null, conversationId: string) => boolean
): () => void {
  const announced = new Set<string>()
  return onDaemonEvent((event) => {
    const kind = notifyKindForEvent(event)
    if (kind === null) return
    // Narrowing on the discriminant is what makes `event.modalId` legal — no cast. This local is the
    // only new read of a daemon-supplied field and never leaves the listener. `!== null`, never
    // truthiness: requireString admits '', and `if (announceKey)` would treat an empty id as "not a
    // prompt" and skip both the check and the record. #1691: the prefix keeps a question batch apart
    // from a modal that happens to carry the same id (mobile keys the batch `batch:<questionBatchId>`).
    const announceKey =
      event.type === 'modalShown'
        ? `modal:${event.modalId}`
        : event.type === 'questionShown'
          ? `batch:${event.questionBatchId}`
          : null
    if (announceKey !== null && announced.has(announceKey)) return
    if (!isPushEnabled()) return
    // Re-narrowed for the compiler: `kind !== null` already means one of these three arms, and each
    // carries the conversation id the name is looked up by.
    if (event.type !== 'turnEnd' && event.type !== 'modalShown' && event.type !== 'questionShown') return
    if (isMuted?.(event.serverId, event.conversationId) === true) return
    const name = nameFor(event.serverId, event.conversationId)
    const token = mintToken?.({ serverId: event.serverId, conversationId: event.conversationId })
    sendCommand({
      type: 'notify',
      payload: {
        kind,
        ...(name === null ? {} : { name }),
        ...(token === undefined ? {} : { token })
      }
    })
    if (announceKey !== null) announced.add(announceKey)
  })
}

/**
 * The production name lookup (#1593): the `name` of the row with `conversationId` in `serverId`'s own
 * slot of the conversation list, or `null` when the slot or the row is missing or the row is unnamed.
 * Scoped to the event's server on purpose — conversation ids are only unique per host, so a same-id
 * row filed under another server must never name the notification. The key is the client-bound
 * origin stamp, never a wire field (selectConversationsFor's rule).
 */
export function conversationNameIn(
  state: ConversationListState,
  serverId: string | null,
  conversationId: string
): string | null {
  return conversationRowIn(state, serverId, conversationId)?.name ?? null
}

/**
 * The production mute lookup (#1607): whether `serverId`'s own row for `conversationId` is muted on its
 * host. A missing flag, row or slot reads as not muted, and a same-id row muted under another server
 * never silences this one (the `conversationNameIn` scoping).
 */
export function conversationMutedIn(
  state: ConversationListState,
  serverId: string | null,
  conversationId: string
): boolean {
  return conversationRowIn(state, serverId, conversationId)?.is_muted === true
}

/** The one server-scoped row lookup behind the name (#1593), the click (#1597) and mute (#1607). */
function conversationRowIn(
  state: ConversationListState,
  serverId: string | null,
  conversationId: string
): ServerConversationSummary | undefined {
  return state.byServer.get(serverId)?.find((summary) => summary.id === conversationId)
}

/** Where a notification came from (#1597): the event's client-stamped origin and its conversation. */
export interface NotificationTarget {
  serverId: string | null
  conversationId: string
}

/** The renderer-side half of the click token (#1597): `mint` files a target under a fresh token,
 *  `resolve` answers it, or `null` for a token it does not hold. */
export interface NotificationTargets {
  mint(target: NotificationTarget): string
  resolve(token: string): NotificationTarget | null
}

/** How many outstanding notifications a click can still be routed for (#1597). */
export const NOTIFICATION_TARGETS_CAP = 16

/**
 * A bounded token → target map (#1597). Insertion-ordered, so once it holds more than the cap the
 * oldest notification is forgotten first, and a click on it falls back to the active conversation.
 * PairedShell holds one per mount, so unpair (which unmounts the shell) drops it whole, the way the
 * announced-prompt set dies with its subscription. Tokens come from `crypto.randomUUID()` rather than a
 * counter: a notification raised before an unpair and clicked after a re-pair must not resolve against
 * the next shell's map.
 */
export function createNotificationTargets(
  newToken: () => string = () => crypto.randomUUID()
): NotificationTargets {
  const targets = new Map<string, NotificationTarget>()
  return {
    mint: (target) => {
      const token = newToken()
      targets.set(token, target)
      for (const oldest of targets.keys()) {
        if (targets.size <= NOTIFICATION_TARGETS_CAP) break
        targets.delete(oldest)
      }
      return token
    },
    resolve: (token) => targets.get(token) ?? null
  }
}

/**
 * The row a notification click opens (#1597): the target's conversation in its own server's slot, or
 * `null` — no target, the host unpaired, the conversation deleted, or archived since the notification
 * was raised. A `null` answer means the click falls back to showing the active conversation.
 */
export function notificationRowFor(
  state: ConversationListState,
  target: NotificationTarget | null
): ServerConversationSummary | null {
  if (target === null) return null
  const row = conversationRowIn(state, target.serverId, target.conversationId)
  return row === undefined || row.is_archived ? null : row
}

/**
 * Wire the push-notify trigger for the mounting component's lifetime — mounted in PairedShell beside
 * useNotificationActivatedNav, so the subscription lives only while the paired shell is on screen (unpair
 * unmounts it → the off handle tears it down; re-pair mounts a fresh one). Subscribes exactly once
 * (empty-dep effect, off-handle as cleanup — a StrictMode double-mount nets exactly one live listener).
 *
 * No `useRef` ceremony (unlike useNotificationActivatedNav / useConversationCreatedNav): there is no
 * per-render caller callback to hold — every dep is a module-level singleton, so the effect closure
 * is stable and self-contained. Production reads the toggle via a thunk that snapshots the current store
 * state on each call (the per-event read AC3 needs). `window.pyry` is dereferenced ONLY inside the effect,
 * so PairedShell stays server-renderable. `targets` is the shell's own token map (#1597), created once
 * per mount, so it is stable for the effect's life.
 */
export function usePushNotify(targets: NotificationTargets): void {
  useEffect(
    () =>
      subscribePushNotify(
        window.pyry.onDaemonEvent,
        window.pyry.sendCommand,
        () => pushNotificationPrefStore.getState().pushNotificationsEnabled,
        (serverId, conversationId) =>
          conversationNameIn(conversationListStore.getState(), serverId, conversationId),
        targets.mint,
        (serverId, conversationId) =>
          conversationMutedIn(conversationListStore.getState(), serverId, conversationId)
      ),
    [targets]
  )
}
