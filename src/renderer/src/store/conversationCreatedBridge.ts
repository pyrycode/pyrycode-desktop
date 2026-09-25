// The renderer create/created feature bridge (#242) — the twin of conversationListBridge. It sends the
// FAB's `createConversation` command and subscribes to the daemon's `conversationCreated` confirmation,
// invoking a caller-supplied `onCreated` (in PairedShell, that dispatches the list→thread `open` nav).
// The three data-path helpers are React-free and injected, so the whole path is unit-testable with plain
// spies (the conversationListBridge idiom); `useConversationCreatedNav` is the thin React glue over them.
// Nothing here touches keys, sockets, ipcRenderer, or raw frames — it only subscribes through the preload
// bridge and dispatches an already-typed command, and consumes an already-typed event.
import { useEffect, useRef } from 'react'
import type { RendererCommand } from '@shared/ipc/commands'
import type { DaemonEvent } from '@shared/ipc/events'
import type { ConversationCreatedPayload, WireAgent } from '@shared/wire/types'

/**
 * Fire the `createConversation` command (#241 wired the main side through to the daemon). An inline
 * literal typed as RendererCommand — no constructor added, keeping the change renderer-contained,
 * exactly as `requestConversationList` inlines `{ type: 'requestConversations' }`. The payload requests
 * a fresh ad-hoc discussion: `is_promoted: false`, `name: null`. `cwd` carries the caller's saved default
 * workspace (#403) verbatim, or `null` — the nullable-and-PRESENT "take the daemon default" signal
 * (CreateConversationPayload's contract; a `null` is on the wire, not an omission). `defaultCwd` is a
 * REQUIRED parameter (not defaulted to `null`) so the one caller states its intent explicitly. Fire-and-
 * forget, like the composer's send: `sendCommand` is `void`, no result to await.
 */
export function requestNewConversation(
  sendCommand: (command: RendererCommand) => void,
  defaultCwd: string | null,
  serverId?: string
): void {
  sendCommand({
    type: 'createConversation',
    payload: { is_promoted: false, name: null, cwd: defaultCwd },
    ...(serverId === undefined ? {} : { serverId })
  })
}

/**
 * Fire the `createConversation` command asking for a NAMED CHANNEL (#1179) — the Channels-tree
 * workspace plus's dispatch, and `requestNewConversation`'s twin. Placed DIRECTLY BESIDE it on purpose:
 * these are the two fixed payload shapes of one command, and reading both literals together is what
 * makes "two callers with two fixed payloads" legible where a single constructor behind an
 * `is_promoted` flag would hide it. Do not fold them — each one's unit test stays a single-literal
 * assertion only while they are separate.
 *
 * `is_promoted: true` and a `name` are the whole difference: until this ticket every create the app
 * sent was `is_promoted: false, name: null`, so a channel could only come into being by promoting a
 * chat. The daemon's `create_conversation` handler has honoured all three fields since #241.
 *
 * `name` is trimmed — a named channel should not carry accidental edge whitespace, the ruling
 * `requestRenameConversation` and `requestCreateWorkspaceFolder` both record. The trim is COSMETIC and
 * is not a validation: the daemon polices the name server-side, and the view's blank-disable means this
 * is never reached with an empty one, so there is no redundant guard here.
 *
 * `cwd` is REQUIRED and non-null (a channel is created in a named workspace, never in the daemon's
 * default) and is carried VERBATIM — not normalised, not trimmed, no `path` module, no local
 * resolution. It is the workspace group's own key, which IS a daemon-asserted `cwd`, so echoing exactly
 * what was received is the only safe handling; main re-validates it at the untrusted IPC boundary and
 * rebuilds a fresh three-field literal before it reaches the wire.
 *
 * Fire-and-forget, like its twin: `sendCommand` is `void`, no result to await. Navigation to the new
 * channel is decoupled and event-driven, through `useConversationCreatedNav` below.
 *
 * `choice` (#1652) names the agent, model and effort the channel starts on. Each present member lands
 * INSIDE `payload`, and an absent one adds no key, so a call without a choice sends today's literal.
 */
export function requestNewChannel(
  sendCommand: (command: RendererCommand) => void,
  name: string,
  cwd: string,
  serverId?: string,
  choice?: { agent?: WireAgent; model?: string; effort?: string }
): void {
  sendCommand({
    type: 'createConversation',
    payload: {
      is_promoted: true,
      name: name.trim(),
      cwd,
      ...(choice?.agent === undefined ? {} : { agent: choice.agent }),
      ...(choice?.model === undefined ? {} : { model: choice.model }),
      ...(choice?.effort === undefined ? {} : { effort: choice.effort })
    },
    ...(serverId === undefined ? {} : { serverId })
  })
}

/**
 * Fire the `createConversation` command asking for an ad-hoc chat IN A NAMED FOLDER ON A NAMED MACHINE
 * (#1308) — the host row plus's dispatch, and the THIRD fixed shape beside its two siblings above.
 *
 * This Add-workspace helper requires the clicked host and trims operator-entered paths.
 * The sidebar helpers above now also accept an explicit host, but preserve daemon-reported cwd
 * verbatim. Existing callers that omit the optional host retain main's single-host fallback.
 *
 * `serverId` IS A TOP-LEVEL SIBLING OF `payload` AND NEVER A FIELD INSIDE IT. The envelope builders consume
 * `payload` alone, so the routing key stays off the wire BY CONSTRUCTION rather than by discipline. It is a
 * background-process routing key resolved against the connection registry — never a capability, a token
 * selector, a path or a log field — and it comes off the client's own paired-server list, never off the
 * wire.
 *
 * `cwd` is REQUIRED and non-null (the whole point of this caller is a folder the operator named, never the
 * daemon default) and is TRIMMED and otherwise carried verbatim: no `path` module, no `..` collapse, no
 * trailing-slash rule, no local resolution. The trimmed string IS the group key the sidebar will draw, so
 * normalising it here would silently split one workspace into two; the daemon confines the folder to its
 * own home server-side and refuses one that escapes or does not exist. The trim matches what the dialog
 * measured its absolute-path refusal against, so edge whitespace can never reach the wire.
 *
 * Fire-and-forget, like both siblings: `sendCommand` is `void`. The answer arrives as an event — the
 * daemon's `conversationCreated` confirmation, or #1307's `conversationCreateRejected` on a refusal.
 */
export function requestNewWorkspaceChat(
  sendCommand: (command: RendererCommand) => void,
  cwd: string,
  serverId: string
): void {
  sendCommand({
    type: 'createConversation',
    payload: { is_promoted: false, name: null, cwd: cwd.trim() },
    serverId
  })
}

/**
 * The filter: map the one owned arm to its payload, every other DaemonEvent to `null`. `default: null`
 * — not an `assertNever` — because ignoring the rest is the intended, permanent behavior here (this path
 * deliberately consumes only `conversationCreated`), mirroring `translateConversationsEvent`. Returns
 * `event.conversation` directly: selecting a single named field is a filter, not a field-remap, so there
 * is no fresh-literal reconstruction to do — a rename of the arm is still caught (a `case` label that no
 * longer overlaps the union is a type error).
 */
export function translateConversationCreated(
  event: DaemonEvent
): ConversationCreatedPayload | null {
  switch (event.type) {
    case 'conversationCreated':
      return event.conversation
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each `conversationCreated` invokes `onCreated` with the
 * decoded payload; every unrelated event no-ops. Returns the unsubscribe handle (the subscribeConversations
 * off-handle idiom) so the React binding can use it as its effect cleanup. The current nav consumer
 * ignores the payload — navigation is conversation-agnostic (a select-and-load transport does not exist
 * yet, the same interim as the row's `onClick={onOpen}`) — but the created `id` is passed here so the
 * future select-and-load ticket changes only the consumer, not this seam. The listener only invokes the
 * callback — it never throws into React.
 */
export function subscribeConversationCreated(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  onCreated: (created: ConversationCreatedPayload, serverId?: string) => void
): () => void {
  return onDaemonEvent((event) => {
    const created = translateConversationCreated(event)
    if (created === null) return
    // Only the main-process stamp identifies the creating host, never a payload field.
    if ('serverId' in event && typeof event.serverId === 'string') {
      onCreated(created, event.serverId)
    } else {
      onCreated(created)
    }
  })
}

/**
 * `subscribeConversationCreated`'s rejection sibling (#1308) — the first consumer of the arm #1307 shipped
 * dormant. Each `conversationCreateRejected` invokes `onRejected`; every unrelated event no-ops. Returns
 * the unsubscribe handle, so a React binding can use it as its effect cleanup.
 *
 * NO `translate*` COMPANION, unlike the pair above. That one exists because `conversationCreated` carries a
 * payload to select; this arm is NULLARY by construction — no daemon byte, code, message or path crosses
 * IPC on the failure path — so there is nothing to map and the whole filter is the `case` label itself. A
 * `boolean`-returning translator would be ceremony around an `event.type ===` comparison.
 *
 * ⭐ THE CALLBACK IS NULLARY TOO, AND THAT IS THE CONTRACT RATHER THAN AN OMISSION. The event cannot say
 * WHOSE create was refused: `create_conversation` has three live callers (the FAB, the Channels-tree
 * workspace plus, and the Add-workspace dialog), main's `pendingCreateConversations` is a bare `Set`, and
 * the daemon's own refusal never echoes the path. So a consumer must do two things, not one — gate on its
 * OWN in-flight state, and accept that a concurrent caller's rejection is indistinguishable from its own.
 * The correlation doc states both obligations; do not paper over the second with a signature that implies
 * otherwise.
 *
 * The listener only invokes the callback — it never throws into React.
 */
export function subscribeConversationCreateRejected(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  onRejected: () => void
): () => void {
  return onDaemonEvent((event) => {
    if (event.type === 'conversationCreateRejected') onRejected()
  })
}

/**
 * Wire the created-event channel to a caller callback for the mounting component's lifetime — mounted in
 * PairedShell, so the subscription lives only while the paired shell is on screen (unpair unmounts it →
 * the off handle tears it down; re-pair mounts a fresh one). Subscribes exactly once (empty-dep effect,
 * off-handle as cleanup — a StrictMode double-mount nets exactly one live listener, the useDaemonEventBridge
 * guarantee). The caller passes a fresh inline arrow each render, so the latest `onCreated` is held in a
 * ref and invoked from the listener; the subscription is established once and never re-subscribes on
 * PairedShell's route-flip re-renders. `window.pyry` is dereferenced only inside the effect, so PairedShell
 * stays server-renderable.
 */
export function useConversationCreatedNav(
  onCreated: (created: ConversationCreatedPayload, serverId?: string) => void
): void {
  const onCreatedRef = useRef(onCreated)
  useEffect(() => {
    onCreatedRef.current = onCreated
  })
  useEffect(
    () =>
      subscribeConversationCreated(window.pyry.onDaemonEvent, (created, serverId) =>
        onCreatedRef.current(created, serverId)
      ),
    []
  )
}
