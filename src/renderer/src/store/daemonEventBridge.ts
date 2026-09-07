// The renderer translation half of the background↔window bridge: it turns each typed
// daemon event (#18) into the matching session-store action (#2) and feeds it into the
// app-singleton store the UI reads. `translateDaemonEvent` is the pure choke point;
// `useDaemonEventBridge` is its only production caller, wiring the channel into React's
// lifecycle. Nothing here touches keys, sockets, ipcRenderer, or raw frames — it only
// subscribes through the preload bridge and dispatches typed actions.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { sessionStore, type SessionAction, type StatusOrigin } from './sessionStore'

/** Compile-time exhaustiveness guard: a new DaemonEvent arm without a case is a type error. */
function assertNever(event: never): never {
  throw new Error(`Unhandled daemon event: ${JSON.stringify(event)}`)
}

/**
 * Read the server this event came from (#1133), off #1068's stamp.
 *
 * An `in`-guarded, `typeof`-checked access rather than a cast, and rather than re-declaring
 * `translateDaemonEvent`'s parameter as `StampedDaemonEvent`: the stamp rides BESIDE the union, so
 * at a bare-`DaemonEvent`-typed parameter it arrives structurally while the static type stays silent
 * about it. Re-declaring the parameter would also fail the 51 bridge tests that call this module
 * with bare event literals. `liveWindow.ts`'s `originOf` is the same idiom applied main-side.
 *
 * The origin is read ONLY from the stamp, NEVER from the payload — in particular never from
 * `connected`'s `ack.server_id`, which is a DISTINCT, daemon-supplied value. The stamp is bound
 * main-side at construction from a paired record this client holds, so a hostile or confused daemon
 * cannot make its events claim another server's slot and overwrite that server's status; a
 * wire-sourced id would hand it exactly that. `ServerOrigin`'s header and `serverInfo.ts` both
 * already rule this.
 */
function originOf(event: DaemonEvent): StatusOrigin {
  if (!('serverId' in event)) return undefined
  const { serverId } = event
  if (serverId === null) return null
  // The `in` guard narrows the property to `unknown`, so the type is re-established here rather than
  // asserted. A value that is neither a string nor null files under the unstamped slot: no producer
  // can emit one (`bindServerOrigin` takes a `string | null` scalar), and answering with a slot
  // rather than throwing is what keeps this total.
  return typeof serverId === 'string' ? serverId : undefined
}

/**
 * Map one typed daemon event to the session-store action it produces, or `null` when the event
 * drives no session-store state. Total by construction: a new DaemonEvent variant with no case
 * fails to compile (assertNever). The session-lifecycle arms are pass-through except `failed`,
 * which copies the wire ErrorPayload's fields into a fresh store-owned ConnectionError — an
 * explicit copy, not a spread, so the store shape stays immune to ErrorPayload gaining an
 * unrelated field later. The three debug-bundle arms (#168) return `null`: the download UI (#72)
 * consumes them, not the session store, so they dispatch nothing. The `assertNever` guard stays
 * load-bearing — a future variant is still a compile error.
 *
 * The four session-lifecycle arms also carry the event's origin (#1133) onto the action, so the
 * store can file each server's status in its own slot. `originOf` is the only place that origin is
 * derived, and it derives it from the stamp alone — see its docblock for why the `connected` arm
 * reads `event.ack` for the ack and pointedly not for the server.
 */
export function translateDaemonEvent(event: DaemonEvent): SessionAction | null {
  switch (event.type) {
    case 'connecting':
      return { type: 'connecting', serverId: originOf(event) }
    case 'connected':
      return { type: 'connected', ack: event.ack, serverId: originOf(event) }
    case 'disconnected':
      return { type: 'disconnected', serverId: originOf(event) }
    case 'failed':
      return {
        type: 'failed',
        error: {
          code: event.error.code,
          message: event.error.message,
          retryable: event.error.retryable
        },
        serverId: originOf(event)
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
      // error.
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
      // error.
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
    case 'modelAnnounced':
      // No session-store action: the announced-model store (#588, not yet built) holds the identifier
      // claude named for the turn, not the session store — which holds no model state at all (its
      // `model` neighbour on runConfigReceived is the per-session OVERRIDE, a different value that
      // goes elsewhere). Present only because the assertNever guard below makes a new arm a compile
      // error (the compacting-was-a-no-op-until-#496 precedent).
      return null
    case 'backgroundTaskStarted':
      // No session-store action: the background-task store (#567, not yet built) holds the set of tasks
      // claude left running, not the session store — which holds no background-task state at all.
      // Present only because the assertNever guard below makes a new arm a compile error (the
      // apiRetry-was-a-no-op-until-#493 precedent).
      return null
    case 'backgroundTaskUpdated':
      // No session-store action: like its sibling above, the background-task store (#567, not yet built)
      // holds what changed about a task claude left running, not the session store — which holds no
      // background-task state at all. Present only because the assertNever guard below makes a new arm a
      // compile error (the apiRetry-was-a-no-op-until-#493 precedent).
      return null
    case 'backgroundTaskRoster':
      // No session-store action: like both siblings above, the background-task store (#567, not yet
      // built) holds the live set of tasks claude left running — including the empty set, which is a
      // positive signal rather than nothing to record — not the session store, which holds no
      // background-task state at all. Present only because the assertNever guard below makes a new arm a
      // compile error (the apiRetry-was-a-no-op-until-#493 precedent).
      return null
    case 'questionShown':
      // No session-store action: the #850 question store holds the batch of clarifying questions
      // claude raised, not the session store — which holds no question state at all. PERMANENTLY a
      // no-op, NOT dormant, and that is the one thing to read carefully here: every "not yet built"
      // case above is expected to flip when its consumer lands (compacting did, at #496), but #850's
      // consumer is a FOURTH INDEPENDENT SUBSCRIBER on this channel with its own bridge (the
      // announcedModelBridge shape), so no case here will ever claim this arm. It stays for the
      // assertNever guard alone — and that guard is not a formality: it stringifies the WHOLE event
      // into an Error message, so a missing case would put the unguessable batch nonce and claude's
      // untrusted text there. This case is what keeps them out of it.
      return null
    case 'questionDismissed':
      // No session-store action either: retiring a batch is the #850 question store's business, and the
      // session store holds no question state to retire. PERMANENTLY a no-op on the same terms as the
      // arm above — #850's consumer is a FOURTH INDEPENDENT SUBSCRIBER with its own bridge, not a future
      // case here, so this will not flip the way `compacting` did at #496. What an unrecognised `source`
      // MEANS is likewise not decided here: the fail-closed reading rule (resolved, cause unknown, never
      // an answer) belongs to that consumer. Present for the assertNever guard, which — as the RED run
      // for this slice demonstrated — stringifies the WHOLE event into an Error message, so a missing
      // case would put the unguessable batch nonce there.
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
    case 'historyPageReceived':
    case 'historyRequestFailed':
      // No session-store action (#1222). A page's entries are timeline items, so its consumer is the
      // timeline reduction (#1223) and the walk that drives the asks (#1224) — not this store, which
      // holds the live session's messages and status and has no scroll-back state at all. The reading
      // to resist is that a page of stored `message` frames belongs in the message list: it does not,
      // because this store dedupes and orders the LIVE lane and #1225 owns joining the two.
      //
      // Present for the assertNever guard below, and that guard is NOT a formality here — it stringifies
      // the WHOLE event into an Error message, so a missing case would put a whole page of replayed
      // operator- and claude-authored payloads on the frame there. These cases are what keep them out.
      return null
    case 'slashCommandList':
      // No session-store action: the #938 store holds the menu of verbs claude will accept, not the
      // session store — which holds no slash-command state at all. Ships DORMANT rather than
      // permanently no-op, unlike the two question arms above: whether #938 subscribes here or stands
      // up its own bridge is its call, so this case may yet flip the way `compacting` did at #496.
      // Present for the assertNever guard below, and that guard is NOT a formality here — it
      // stringifies the WHOLE event into an Error message, so a missing case would put every
      // workspace-authored name, argument hint, description and alias on the frame there, embedded
      // newlines included. This case is what keeps them out of it.
      return null
    case 'systemPromptReceived':
      // No session-store action (#1230). The transport owns the ask, the correlation and the decode; the store that
      // holds a conversation's system prompt is #1231's, in the announcedModelBridge /
      // historyPageBridge posture, and the editor surface is #1078. So this arm is DORMANT rather
      // than permanently no-op — but nothing in THIS file is waiting to claim it.
      //
      // Present for the assertNever guard, and that guard is NOT a formality here: it stringifies the
      // WHOLE event into an Error message, and `systemPrompt` is untrusted operator-authored text that
      // reaches no other sink on any path — not the decode's content-free log line, not the
      // decode-failure catch (which drops its caught error), not emitDaemonEvent. A missing case would
      // be the ONE route by which it lands in an Error message, a stack trace and a crash reporter.
      // This case is what keeps it out.
      return null
    case 'modelList':
      // No session-store action: the #974 store holds the menu of identities claude will accept, not the
      // session store — which holds no model-menu state at all. PERMANENTLY a no-op, NOT dormant like
      // its `slashCommandList` sibling directly above, and the difference is that the consumer has
      // already answered: #974 commits to a DEDICATED subscriber in the announcedModelBridge /
      // backgroundTaskRosterBridge / slashCommandListBridge posture, so this case will never flip the way
      // `compacting` did at #496. Present for the assertNever guard below, and that guard is NOT a
      // formality here — it stringifies the WHOLE event into an Error message, so a missing case would
      // put every claude-authored resolved model, value, display name and effort level on the frame
      // there. That is a HIGHER trust tier than the sibling's workspace-authored strings. This case is
      // what keeps them out of it.
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
