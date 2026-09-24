// The app icon's attention badge, renderer half (#1592). The badge is the number of sidebar status dots
// that ask for the operator — `input-required` or `new-messages` — across every paired host, archived
// rows left out as the sidebar leaves them out, and muted rows left out because the host has silenced them
// (#1607; the sidebar dot still shows them). `working` does not count: it would tick the badge up for
// every streamed turn. The status of each row is resolved exactly as `ConversationStatusDotControl` in
// ChannelList resolves it, through `resolveConversationStatus` and `isConversationUnread`, so the badge
// and the dots cannot disagree about what needs attention.
//
// The pushNotifyBridge shape: `countAttentionConversations` is the pure derivation, `subscribeAppBadge`
// the React-free injected data path, `useAppBadge` the thin glue mounted in PairedShell. Only a count
// crosses to main, as the MAIN-LOCAL `setBadgeCount` command — never an id, a name or a host.
import { useEffect } from 'react'
import type { RendererCommand } from '@shared/ipc/commands'
import { resolveConversationStatus, type ConversationStatus } from './conversationStatus'
import { isConversationUnread } from './conversationUnread'
import { conversationListStore, selectConversations } from './conversationListStore'
import { modalStore, selectHasOutstandingFor } from './modalStore'
import { conversationActivityStore, selectActivityFor } from './conversationActivityStore'
import { conversationTimelineStore, selectTimelineFor } from './conversationTimelineStore'
import { conversationLastReadStore, selectLastReadFor } from './conversationLastReadStore'

/**
 * How many of `conversations` resolve to a status that needs the operator. The list is the CALLER's to
 * filter — archived rows and muted ones (#1607) — so this stays one rule over whatever
 * rows it is handed.
 */
export function countAttentionConversations(
  conversations: readonly { id: string }[],
  statusOf: (conversationId: string) => ConversationStatus
): number {
  let count = 0
  for (const { id } of conversations) {
    const status = statusOf(id)
    if (status === 'input-required' || status === 'new-messages') count++
  }
  return count
}

/**
 * One conversation's status from the four stores the sidebar dot reads, read now. The same four
 * selectors and the same composition as `ConversationStatusDotControl`, over `getState()` rather than
 * hooks. Back-to-back synchronous reads, so not a torn read (conversationUnread.ts states why).
 */
export function conversationStatusNow(conversationId: string): ConversationStatus {
  return resolveConversationStatus(
    selectHasOutstandingFor(conversationId)(modalStore.getState()),
    selectActivityFor(conversationId)(conversationActivityStore.getState()),
    isConversationUnread(
      selectTimelineFor(conversationId)(conversationTimelineStore.getState()),
      selectLastReadFor(conversationId)(conversationLastReadStore.getState())
    )
  )
}

/** The badge count now: every paired server's rows, archived ones left out as the sidebar does, and
 *  muted ones left out as the host asks (#1607). */
export function attentionCountNow(): number {
  const rows = selectConversations(conversationListStore.getState()) ?? []
  return countAttentionConversations(
    rows.filter((row) => !row.is_archived && row.is_muted !== true),
    conversationStatusNow
  )
}

/** Wake `listener` on a write to any store the count reads; the returned handle removes all five. */
export function subscribeToAttentionStores(listener: () => void): () => void {
  const offs = [
    conversationListStore.subscribe(listener),
    modalStore.subscribe(listener),
    conversationActivityStore.subscribe(listener),
    conversationTimelineStore.subscribe(listener),
    conversationLastReadStore.subscribe(listener)
  ]
  return () => offs.forEach((off) => off())
}

export interface AppBadgeDeps {
  subscribe: (listener: () => void) => () => void
  count: () => number
  sendCommand: (command: RendererCommand) => void
}

/**
 * Send the count once now and again whenever it changes; a recompute that lands on the same number
 * sends nothing. The last-sent value starts empty, so the first count always goes out, zero included:
 * a reloaded or reopened window re-asserts main's badge rather than trusting what it held.
 *
 * The teardown clears the badge. Unpairing the last host unmounts PairedShell, and this is the one place
 * that act reaches — so the badge cannot outlive the pairings it counted.
 */
export function subscribeAppBadge(deps: AppBadgeDeps): () => void {
  let lastSent: number | null = null
  const send = (count: number): void => {
    if (count === lastSent) return
    lastSent = count
    deps.sendCommand({ type: 'setBadgeCount', payload: { count } })
  }
  const off = deps.subscribe(() => send(deps.count()))
  send(deps.count())
  return () => {
    off()
    send(0)
  }
}

/** Keep the app icon's badge in step for the paired shell's lifetime. `window.pyry` is read only inside
 *  the effect, so PairedShell stays server-renderable. */
export function useAppBadge(): void {
  useEffect(
    () =>
      subscribeAppBadge({
        subscribe: subscribeToAttentionStores,
        count: attentionCountNow,
        sendCommand: window.pyry.sendCommand
      }),
    []
  )
}
