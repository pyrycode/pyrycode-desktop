// The renderer translation half of the background↔window bridge: it turns each typed
// daemon event (#18) into the matching session-store action (#2) and feeds it into the
// app-singleton store the UI reads. `translateDaemonEvent` is the pure choke point;
// `useDaemonEventBridge` is its only production caller, wiring the channel into React's
// lifecycle. Nothing here touches keys, sockets, ipcRenderer, or raw frames — it only
// subscribes through the preload bridge and dispatches typed actions.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { sessionStore, type SessionAction } from './sessionStore'

/** Compile-time exhaustiveness guard: a new DaemonEvent arm without a case is a type error. */
function assertNever(event: never): never {
  throw new Error(`Unhandled daemon event: ${JSON.stringify(event)}`)
}

/**
 * Map one typed daemon event to the session-store action it produces, or `null` when the event
 * drives no session-store state. Total by construction: a new DaemonEvent variant with no case
 * fails to compile (assertNever). The session-lifecycle arms are pass-through except `failed`,
 * which copies the wire ErrorPayload's fields into a fresh store-owned ConnectionError — an
 * explicit copy, not a spread, so the store shape stays immune to ErrorPayload gaining an
 * unrelated field later. The three debug-bundle arms (#168) and `snapshotReceived` (#180) return
 * `null`: they are consumed by the download UI (#72) and the Run configuration render bridge (#181)
 * respectively, not the session store, so they dispatch nothing. The `assertNever` guard stays
 * load-bearing — a future variant is still a compile error.
 */
export function translateDaemonEvent(event: DaemonEvent): SessionAction | null {
  switch (event.type) {
    case 'connecting':
      return { type: 'connecting' }
    case 'connected':
      return { type: 'connected', ack: event.ack }
    case 'disconnected':
      return { type: 'disconnected' }
    case 'failed':
      return {
        type: 'failed',
        error: {
          code: event.error.code,
          message: event.error.message,
          retryable: event.error.retryable
        }
      }
    case 'messageReceived':
      return { type: 'messageReceived', message: event.message }
    case 'messagesReceived':
      return { type: 'messagesReceived', messages: event.messages }
    case 'debugBundleProgress':
    case 'debugBundleSaved':
    case 'debugBundleFailed':
      // No session-store action: the download UI (#72) consumes these, not the session store.
      return null
    case 'snapshotReceived':
      // No session-store action: the Run configuration render bridge (#181) consumes this, not the
      // session store. Added here (not "zero renderer change") because the assertNever guard below
      // makes every new DaemonEvent member a compile error until it has a case — #181 adds the facet.
      return null
    case 'assistantDelta':
    case 'turnEnd':
    case 'turnState':
    case 'toolUse':
    case 'toolResult':
      // No session-store action: the renderer timeline bridge (#202), not the session store, consumes
      // these. Present only because the assertNever guard below makes a new arm a compile error.
      return null
    case 'conversationsReceived':
      // No session-store action: the conversation-list store (#208), not the session store, consumes
      // this. Present only because the assertNever guard below makes a new arm a compile error.
      return null
    case 'conversationCreated':
      // No session-store action: the render slice (#242) opens the new thread, not the session store.
      // Present only because the assertNever guard below makes a new arm a compile error.
      return null
    case 'conversationUpdated':
      // No session-store action: the list-reflect slice (#275) flips the promoted row, not the session
      // store. Present only because the assertNever guard below makes a new arm a compile error.
      return null
    case 'conversationDeleted':
      // No session-store action: the list-reflect slice (#376, not yet built) removes the deleted row,
      // not the session store. Present only because the assertNever guard below makes a new arm a compile
      // error (the conversationUpdated-is-a-no-op precedent).
      return null
    case 'recentWorkspacesReceived':
      // No session-store action: the recent-workspaces store (#382, not yet built) holds the list, not
      // the session store. Present only because the assertNever guard below makes a new arm a compile
      // error (the conversationsReceived-is-a-no-op precedent).
      return null
    case 'workspaceFolderCreated':
      // No session-store action: the Create-folder dialog (#157, not yet built) consumes the created path,
      // not the session store. Present only because the assertNever guard below makes a new arm a compile
      // error (the conversationDeleted-is-a-no-op precedent).
      return null
    case 'workspaceFolderRejected':
      // No session-store action: the #397 round-trip store (not yet built) consumes the folder-creation
      // rejection, not the session store. Present only because the assertNever guard below makes a new arm
      // a compile error (the workspaceFolderCreated-is-a-no-op precedent).
      return null
    case 'notificationActivated':
      // No session-store action: the notificationActivatedBridge (#393) consumes the click and drives the
      // paired `open` nav, not the session store. Present only because the assertNever guard below makes a
      // new arm a compile error (the workspaceFolderRejected-is-a-no-op precedent).
      return null
    case 'modalShown':
    case 'modalDismissed':
      // No session-store action: the modal store + bridge (#223), not the session store, consumes
      // these. Present only because the assertNever guard below makes a new arm a compile error.
      return null
    case 'sessionTransition':
      // No session-store action: the #259 holder (not yet built) retains the current session id, not
      // the session store. Present only because the assertNever guard below makes a new arm a compile
      // error (the snapshotReceived-was-a-no-op-until-#187 precedent).
      return null
    case 'sessionSettingsUpdated':
    case 'sessionSettingsRejected':
      // No session-store action: #261 / #256 (correlation / store, not yet built) consume the confirmed
      // and rejected (#269) settings arms, not the session store. Present only because the assertNever
      // guard below makes a new arm a compile error.
      return null
    case 'modalAnswerRejected':
      // No session-store action: the modal bridge (#249, render) consumes this, not the session store.
      // Present only because the assertNever guard below makes a new arm a compile error.
      return null
    case 'queueState':
      // No session-store action: the #293 queue store (not yet built) holds the backlog, not the session
      // store — queue_state is daemon state, not a turn-stream item (#720). Present only because the
      // assertNever guard below makes a new arm a compile error.
      return null
    case 'stallDetected':
      // No session-store action: the render slice (#317, not yet built) surfaces the stall indicator, not
      // the session store. Present only because the assertNever guard below makes a new arm a compile
      // error (the snapshotReceived-was-a-no-op-until-#187 precedent).
      return null
    case 'screenSnapshotReceived':
      // No session-store action: the display slice (#318, not yet built) renders the screen text, not the
      // session store. Present only because the assertNever guard below makes a new arm a compile error
      // (the snapshotReceived-was-a-no-op-until-#187 precedent).
      return null
    case 'apiRetry':
      // No session-store action: the render slice (#493, not yet built) surfaces the retry indicator and
      // its attempt counter, not the session store — which holds no retry state at all. Present only
      // because the assertNever guard below makes a new arm a compile error (the
      // stallDetected-was-a-no-op-until-#317 precedent).
      return null
    case 'compacting':
      // No session-store action: the render slice (#496, not yet built) surfaces the compaction banner,
      // not the session store — which holds no compaction state at all. Present only because the
      // assertNever guard below makes a new arm a compile error (the
      // apiRetry-was-a-no-op-until-#493 precedent).
      return null
    case 'unrecognizedMessage':
      // No session-store action: the parser-gap diagnostic becomes a timeline row (the render slice),
      // not connection state — the session store holds nothing about the daemon's own mapping gaps.
      // Present only because the assertNever guard below makes a new arm a compile error.
      return null
    case 'relayLinkChanged':
      // No session-store action: the relay-link store + bridge (#329, not yet built) holds the relay-leg
      // status, not the session store. Present only because the assertNever guard below makes a new arm a
      // compile error (the stallDetected-was-a-no-op-until-#317 precedent).
      return null
    case 'runConfigReceived':
      // No session-store action: the run-config store + its sheet-scoped bridge hold the run
      // configuration and the session id (#491), not the session store. Present only because the
      // assertNever guard below makes a new arm a compile error.
      return null
    default:
      return assertNever(event)
  }
}

/**
 * Wire the daemon-event channel into the app-singleton session store for the lifetime of
 * the mounting component. Subscribes on mount, translates each event to a SessionAction and
 * dispatches it into `sessionStore`, and calls the unsubscribe handle on unmount. Returns
 * nothing — it is a side-effecting binding, not a state source (the store is the single
 * source of truth). The effect returns the exact unsubscribe handle from onDaemonEvent, so a
 * StrictMode double-mount nets exactly one live listener.
 */
export function useDaemonEventBridge(): void {
  useEffect(() => {
    const off = window.pyry.onDaemonEvent((event) => {
      const action = translateDaemonEvent(event)
      // Debug-bundle events translate to `null` (no session-store action) — skip the dispatch.
      if (action) sessionStore.getState().dispatch(action)
    })
    return off
  }, [])
}
