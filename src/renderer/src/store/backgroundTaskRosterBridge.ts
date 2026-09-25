// The renderer data path feeding the background-task store: it observes FOUR typed daemon events — the
// `backgroundTaskRoster` aggregate (#566's transport half decodes the `background_task_roster`
// snapshot: `conversationId` plus the live rows and the drop count), the `backgroundTaskStarted`
// scalar (#564: the six fields that open one task, `toolCallId` among them) and the
// `backgroundTaskUpdated` scalar (#565: four fields — the latest patch and its own cut report) — the `backgroundTaskProgress` scalar
// (#1640: a running task's latest report) — and
// lands each in the app-singleton `backgroundTaskRosterStore` the panel slice (#568) will read, where
// they are JOINED on `conversationId` + `taskId`. Reactive-only — like queueBridge and sessionIdBridge,
// the daemon PUSHES all three unsolicited, so there is NO request half: no command sent, no
// connected-edge fetch. The helpers are React-free and injected, so the whole path is unit-testable
// with plain spies; `BackgroundTaskRosterData` is the thin React glue over them. Nothing here touches
// keys, sockets, ipcRenderer, or raw frames — it only subscribes through the preload bridge and
// dispatches an already-typed event.
//
// SECURITY: two arms carry untrusted, model-influenced `description` text — for `local_bash` the
// literal command line claude ran — and the third carries a `patch` whose keys may carry the same class
// of text under a structured-looking shape. This path has no DOM sink and runs no JSON.parse; it copies
// named fields and never interprets them. The inert-plain-text obligation binds #568.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import {
  backgroundTaskRosterStore,
  type BackgroundTaskRosterSnapshot,
  type BackgroundTaskProgressSnapshot,
  type BackgroundTaskStartedSnapshot,
  type BackgroundTaskUpdatedSnapshot
} from './backgroundTaskRosterStore'
import {
  conversationListStore,
  selectConversationIdsFor,
  type ConversationListOrigin
} from './conversationListStore'

/**
 * Read the server this event came from (#1139), off #1068's stamp.
 *
 * An `in`-guarded, `typeof`-checked access rather than a cast, and rather than re-declaring the
 * listener's parameter as `StampedDaemonEvent`: the stamp rides BESIDE the union, so at a
 * bare-`DaemonEvent`-typed hole it arrives structurally while the static type stays silent about it.
 * `queueBridge.ts`'s `originOf` is the same idiom for the queue leg, `relayLinkBridge.ts`'s for the
 * relay leg, `conversationListBridge.ts`'s for the list leg and `daemonEventBridge.ts`'s for the daemon
 * leg — a copy rather than an import, for the reason each of those states: taking another's would
 * couple two deliberately independent single-arm subscribers and drag this path's key domain onto that
 * store's.
 *
 * The origin is read ONLY from the stamp, NEVER from the payload. The `connected` arm carries the
 * daemon's own `ack.server_id`, which is a DISTINCT value the daemon chose; the stamp is bound
 * main-side at construction from a paired record this client holds, so a hostile or confused daemon
 * cannot make its reconnect clear another server's background-task rosters.
 */
function originOf(event: DaemonEvent): ConversationListOrigin {
  if (!('serverId' in event)) return undefined
  const { serverId } = event
  if (serverId === null) return null
  // The `in` guard narrows the property to `unknown`, so the type is re-established here rather than
  // asserted. A value that is neither a string nor null selects the unstamped slot: no producer can
  // emit one (`bindServerOrigin` takes a `string | null` scalar), and answering with a slot rather
  // than throwing is what keeps this total inside a daemon-event listener.
  return typeof serverId === 'string' ? serverId : undefined
}

/**
 * The roster filter: map the one owned arm to its snapshot, every other DaemonEvent to `null`. A FRESH
 * named-field literal (the modalBridge / queueBridge idiom — never `return event`, never a spread),
 * which is load-bearing rather than stylistic: a spread would carry the arm's `type` tag, and any field
 * a later arm gains, into a write unit that never agreed to hold it. `tasks` passes through by
 * reference (roster order, identity and snake_case preserved) — the row → held-record mapping happens
 * inside `setRoster`, which is where the prior state the join needs lives, so this translator is
 * behaviourally unchanged by the join.
 *
 * UNCONDITIONAL — there is deliberately no `if (event.tasks.length === 0) return null`. An empty
 * roster is a positive statement that nothing is alive (AC5), never "no news", so it maps to a
 * snapshot like any other; see the `!== null` guard in `subscribeBackgroundTaskRoster`.
 *
 * `default: null` — not an `assertNever` — because ignoring the rest is this path's intended,
 * permanent behavior: it is an independent subscriber in the queueBridge / sessionIdBridge posture,
 * not one of the three typecheck-gating exhaustive bridges (which already no-op these arms from #566).
 * A SIBLING translator owns `backgroundTaskStarted` rather than this one widening its return type into
 * a tagged union: keeping each a pure single-arm filter is the property that kept the `connected` reset
 * out of a translator in #573, and two small filters cost the same executable lines.
 * React-free → unit-testable without a DOM.
 */
export function translateBackgroundTaskRoster(
  event: DaemonEvent
): BackgroundTaskRosterSnapshot | null {
  switch (event.type) {
    case 'backgroundTaskRoster':
      return {
        conversationId: event.conversationId,
        tasks: event.tasks,
        droppedTasks: event.droppedTasks
      }
    default:
      return null
  }
}

/**
 * The started filter — the sibling of the translator above, same posture in every respect: one owned
 * arm, a fresh named-field literal, `default: null`, React-free. It copies all six fields the arm
 * carries; `truncatedFields` passes through untouched, so `null` ("nothing was cut") reaches the store
 * as `null` and is never collapsed into `[]` (AC3).
 *
 * `backgroundTaskUpdated` belongs to the THIRD translator below rather than to this one: one owned arm
 * per translator is the posture this bridge keeps, so neither sibling's assertions move when another
 * arm lands.
 */
export function translateBackgroundTaskStarted(
  event: DaemonEvent
): BackgroundTaskStartedSnapshot | null {
  switch (event.type) {
    case 'backgroundTaskStarted':
      return {
        conversationId: event.conversationId,
        taskId: event.taskId,
        toolCallId: event.toolCallId,
        taskType: event.taskType,
        description: event.description,
        truncatedFields: event.truncatedFields
      }
    default:
      return null
  }
}

/**
 * The updated filter — the third sibling, same posture again: one owned arm, a fresh named-field
 * literal, `default: null`, React-free. SIX fields: the arm carries no `toolCallId`, no `description`
 * and no `taskType`, and it gains `patch`, `status` and `summary`. `status` is copied verbatim as the
 * open string #1560 carries (`''` included) and is interpreted only by the store (#1561). `summary` is
 * copied verbatim too (#1639): it is untrusted model-authored text, observed carrying a literal command
 * line, which the panel draws on a finished row as inert escaped text and nothing here inspects.
 *
 * `patch` is copied VERBATIM and never parsed, key-enumerated, or inspected here — it is opaque text
 * that is not guaranteed to be valid JSON (the daemon truncates it at construction). `patch: ''` is a
 * value meaning "claude sent no change" and always arrives, so there is deliberately no
 * `if (event.patch)` anywhere on this path. `truncatedFields` passes through untouched, so `null`
 * ("nothing was cut") reaches the store as `null` and is never collapsed into `[]` (AC3).
 */
export function translateBackgroundTaskUpdated(
  event: DaemonEvent
): BackgroundTaskUpdatedSnapshot | null {
  switch (event.type) {
    case 'backgroundTaskUpdated':
      return {
        conversationId: event.conversationId,
        taskId: event.taskId,
        patch: event.patch,
        status: event.status,
        summary: event.summary,
        truncatedFields: event.truncatedFields
      }
    default:
      return null
  }
}

/**
 * The progress filter (#1640) — the fourth sibling, same posture: one owned arm, a fresh named-field
 * literal of all nine fields, `default: null`, React-free. The counters are copied as received, never
 * summed or diffed, and `truncatedFields: null` passes through as `null`. `currentActivity`,
 * `subagentType` and `lastToolName` are untrusted text naming the operator's files; nothing here reads
 * them, and the panel draws them as inert escaped text on a running row.
 */
export function translateBackgroundTaskProgress(
  event: DaemonEvent
): BackgroundTaskProgressSnapshot | null {
  switch (event.type) {
    case 'backgroundTaskProgress':
      return {
        conversationId: event.conversationId,
        taskId: event.taskId,
        currentActivity: event.currentActivity,
        subagentType: event.subagentType,
        lastToolName: event.lastToolName,
        totalTokens: event.totalTokens,
        toolUses: event.toolUses,
        durationMs: event.durationMs,
        truncatedFields: event.truncatedFields
      }
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`. A `connected` event is the (re)handshake edge (#573's
 * AC5): it resets and returns, so tasks from the reconnecting server's previous connection never
 * appear.
 *
 * THE RE-SEND ORDERING IS THE WHOLE POINT OF THAT `return`, and this docblock used to say the opposite —
 * "nothing repopulates afterwards, so there is no re-send ordering to reason about here". #569 retires
 * that: since pyrycode#2077-#2080 the daemon reconciles this family on (re)connect, unicasting one
 * `background_task_roster` per conversation whose bound session has reported one. So the clear and the
 * burst now RACE in principle, and a roster applied ahead of the clear would be wiped by it — a silent
 * failure, since the panel would simply read "No background-task report yet" while work was alive.
 *
 * What rules that out is that both ride THIS ONE LISTENER in arrival order: `daemonConnection` emits
 * `connected` from its `handshake-complete` arm and every decoded frame as `message`, through the same
 * synchronous sink, and the daemon streams the burst only after the reconnect `hello_ack`. The branch
 * below therefore resets and returns before any reconciled roster is dispatched. That argument is
 * available by reading, but the daemon reconciles off its own handshake tail — a different clock — so it
 * is PROVED end-to-end in e2e/background-task-reconnect.spec.ts rather than trusted. Do not introduce an
 * await, a queue, or a second listener on this path; any of them breaks the ordering silently.
 *
 * The burst is correlated by `conversation_id` and never by position (the daemon's registry order is not
 * a contract), which `setRoster`'s unconditional replacement already satisfies. A conversation ABSENT
 * from the burst stays dropped and reads `null` — "nothing has been reported", never "nothing is alive"
 * — while one re-asserted with `tasks: []` reads observed-empty; keeping those two apart is why the
 * `!== null` guards below must stay `!== null`.
 *
 * SCOPED TO THE RECONNECTING SERVER (#1139). Since #1117 the background process holds one live
 * connection per paired server, so `connected` means "THIS server's connection came back" and the reset
 * carries the origin `originOf` read off the stamp. The branch reads the discriminant and the stamp,
 * never `event.ack` — the daemon's own `server_id` must not steer whose rosters survive. Turning the
 * origin into the conversations to drop is the CALLER's job (`BackgroundTaskRosterData` below), so this
 * bridge stays store-free and drivable with a plain spy.
 *
 * THIS BRANCH IS NO LONGER THE SOLE ENFORCEMENT OF #573's AC5, and the change is deliberate rather
 * than a weakening. It was, and this docblock used to say so, adding that gating it behind a condition
 * would kill the security property silently — which is exactly what scoping it does. The reconnect half
 * survives here; the previous-PAIRING half moved to `clearAllRosters` in
 * `clearPairingScopedState`'s dep set, because a new pairing's first `connected` resolves an empty
 * conversation list, matches no held key, and would otherwise drop nothing at all. Do not "restore"
 * the whole-map reset to get the pairing guarantee back: that reintroduces the cross-server erase this
 * ticket fixes. The two mechanisms now split the work, the `queueStore` posture since #1138.
 *
 * The reset is a separate branch rather than a translator mapping, unlike modalBridge's `reconnected`
 * action: that translator returns members of an ACTION union, where a payload-free member is natural,
 * while this one returns a VALUE (a snapshot). Folding the reset in would force the return type to
 * `Snapshot | 'reset' | null` and destroy the property that the translator is a pure
 * `backgroundTaskRoster`→snapshot filter.
 *
 * Both `!== null` guards (never `if (snapshot)`) are deliberate, and the hazard they institutionalise is
 * filtering rather than truthiness — a snapshot object is truthy even when its `tasks` are empty, so the
 * way an empty roster gets dropped is a `length === 0` check at the translator, not here. Keeping the
 * guards on `!== null` and the translators unconditional is what makes the observed-empty case survive
 * the whole path. The four arms are mutually exclusive, so branch ORDER is a readability choice rather
 * than a correctness one and each matched branch returns. Injected `onDaemonEvent` + the five writers
 * keep this React-free and unit-testable with plain spies. The listener only translates + dispatches —
 * it never throws into React.
 */
export function subscribeBackgroundTaskRoster(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setRoster: (snapshot: BackgroundTaskRosterSnapshot) => void,
  resetRostersForServer: (origin: ConversationListOrigin) => void,
  setStartedTask: (snapshot: BackgroundTaskStartedSnapshot) => void,
  setUpdatedTask: (snapshot: BackgroundTaskUpdatedSnapshot) => void,
  setTaskProgress: (snapshot: BackgroundTaskProgressSnapshot) => void
): () => void {
  return onDaemonEvent((event) => {
    if (event.type === 'connected') {
      resetRostersForServer(originOf(event))
      return
    }
    const snapshot = translateBackgroundTaskRoster(event)
    if (snapshot !== null) {
      setRoster(snapshot)
      return
    }
    const started = translateBackgroundTaskStarted(event)
    if (started !== null) {
      setStartedTask(started)
      return
    }
    const updated = translateBackgroundTaskUpdated(event)
    if (updated !== null) {
      setUpdatedTask(updated)
      return
    }
    const progress = translateBackgroundTaskProgress(event)
    if (progress !== null) setTaskProgress(progress)
  })
}

/**
 * The background-task data-path binding — a headless component mounted app-level in App.tsx, alongside
 * QueueData: one stable, app-lifetime listener with no subscribe/unsubscribe churn as the route flips,
 * because either frame can arrive at any time — including before the #568 panel is ever mounted, and
 * including for a conversation the user is not looking at — so the set must be retained regardless of
 * which screen is shown. A component (not a hook) isolates the subscription in its own leaf so it never
 * cascades a re-render into App; it renders nothing. `window.pyry` is dereferenced only inside the
 * effect, never during render, so it server-renders to `''` without a bridge mock (the QueueData
 * invariant, which App.test's no-window-stub <App/> render depends on). Reactive-only: one subscribe
 * effect, no request effect, no useState/useRef/useSessionStore. Its name and props are unchanged by
 * the join, which is why App.tsx is untouched by this slice.
 */
export function BackgroundTaskRosterData(): null {
  useEffect(() => {
    // Subscribe on mount; the returned off handle is the effect cleanup, so a StrictMode double-mount
    // nets exactly one live listener (the queueBridge idiom). Each roster replaces its conversation's
    // held membership; each started frame upserts one task into it; each update records one task's
    // latest patch, or is dropped when it matches none; a connected edge clears the reconnecting
    // server's (#573's AC5, scoped by #1139). All four write paths ride this one listener, dispatched
    // synchronously in arrival order, so there is no gap between reading and writing the store that a
    // concurrent handler could interleave into.
    //
    // THE COMPOSITION ROOT for #1139's scoping, and the only place the two singletons meet: the origin
    // the bridge read off the stamp resolves to that server's conversation ids through #1086's shared
    // resolution, and only those keys are dropped. The list is read HERE, at reset time, not at
    // subscribe time — on a first connect the server's slot holds no list yet (the list request rides
    // the same edge) so nothing is dropped; on a reconnect the slot still holds the previous episode's
    // rows, since only `clearAllConversations` at a pairing boundary empties it, so the reconnecting
    // server's conversations are known before its re-sends arrive. That clause used to end "even
    // though nothing re-sends these frames"; #569 retires the premise and INVERTS the emphasis — the
    // retained list matters more now, not less, because a reconcile burst follows this reset on the
    // same channel and the ids have to resolve before it lands. Nothing can interleave between the
    // read and the write: both stores are written from this one synchronous dispatch, with no await
    // between them.
    return subscribeBackgroundTaskRoster(
      window.pyry.onDaemonEvent,
      (snapshot) => backgroundTaskRosterStore.getState().setRoster(snapshot),
      (origin) =>
        backgroundTaskRosterStore
          .getState()
          .resetRostersFor(selectConversationIdsFor(origin)(conversationListStore.getState())),
      (snapshot) => backgroundTaskRosterStore.getState().setStartedTask(snapshot),
      (snapshot) => backgroundTaskRosterStore.getState().setUpdatedTask(snapshot),
      (snapshot) => backgroundTaskRosterStore.getState().setTaskProgress(snapshot)
    )
  }, [])

  return null
}
