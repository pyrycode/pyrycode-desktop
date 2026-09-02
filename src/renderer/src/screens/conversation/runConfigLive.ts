// The run-configuration read's APP-LIFETIME half (#810): the always-on subscriber that lands every
// `runConfigReceived` in the two stores, plus the refresh trigger that re-requests the reply on the two
// edges where the context-usage figures can have moved. It is the conversationListBridge shape — a `.ts`
// holding React-free injected helpers plus the headless leaf (`RunConfigLiveData(): null`, mounted in
// App.tsx as the ninth) — and it is what makes the figures true whether or not the sheet has ever opened.
//
// WHY IT EXISTS. `session_settings` is REPLY-ONLY: `requestRunConfigSnapshot` is its sole sender anywhere
// in the tree and nothing pushes the reply unsolicited, so a subscription alone cannot keep the figures
// fresh — this path needs its own refresh trigger as well as an app-lifetime listener. Until #810 the only
// thing that ever filled `runConfigStore` was `RunConfigData`, mounted inside the open-only sheet body
// (`{sheetOpen && <StatusSheet>…}`): the figures did not exist before the first open and froze at the
// moment of it.
//
// THE TWO EDGES, and only those two. Usage moves when a turn runs, so a rising edge to `connected` (a
// reading as soon as there is a session to read) and each running → not-running turn transition (keeping it
// true afterwards) are the whole of it. Polling would spend requests on a value that cannot have changed
// between turns. Both are TRANSITIONS, not states: `turn_state` is a coarse lifecycle scalar the daemon may
// re-assert, and re-requesting on every arriving `idle` would be polling wearing a different hat.
//
// WHY A SEPARATE MODULE rather than runConfigSnapshot.ts or RunConfigData.tsx. The trigger imports
// `isTurnRunning` from ConversationScreen.tsx, and ConversationScreen.tsx imports RunConfigData.tsx, which
// imports runConfigSnapshot.ts — putting the trigger in either would close a genuine import cycle. Nothing
// under ConversationScreen's graph imports this module, so it introduces none. Re-deriving the phase test
// locally instead of importing the predicate is NOT an option: a gate written against one phase literal
// makes the signal vanish for the tool-heavy bulk of a turn (the #648 defect verbatim; see
// ConversationScreen.tsx:1488-1491 and conversationActivityBridge.ts:20-30, which also weighed and declined
// relocating the predicate).
//
// SECURITY: `turnState.conversationId` is daemon-asserted untrusted text used here ONLY as a `Set`
// membership key — never rendered, never concatenated, never a filename, a URL, an attribute, a cache key
// or a log field, and never compared against a secret. It is a `Set`, NEVER a plain object: a `Set` stores
// the key in its own slot table, whereas `obj[id] = true` would hand a daemon-supplied `__proto__` to
// `Object.prototype`'s setter. Log-free by construction — no `console.*` on any branch, matching
// conversationActivityBridge.ts:35-39: the only value a diagnostic here could carry is that id, and the
// renderer console is readable by anything that can open DevTools (#126). The one outbound is a
// `requestSessionSettings` naming the ACTIVE conversation (#946) — a client-owned id read from this app's
// own conversation state, used as an object VALUE in a payload the main process rebuilds from scratch,
// never as a key, a path, or a log field. `event.conversationId` never reaches it: the refresh seam is
// nullary, so the edge cannot address the request. Nothing here touches keys, sockets, ipcRenderer or raw
// frames.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { activeConversationStore } from '../../store/activeConversationStore'
import { runConfigStore } from '../../store/runConfigStore'
import { sessionIdStore } from '../../store/sessionIdStore'
import { isTurnRunning } from './ConversationScreen'
import { requestRunConfigSnapshot, subscribeRunConfig } from './runConfigSnapshot'

/**
 * The refresh trigger, as a STATEFUL FACTORY: each call returns a fresh predicate over the daemon-event
 * stream closing over its own `Set` of the conversations whose turn is currently running. Never
 * module-level state — two subscriptions (a StrictMode double-mount, or a test creating two) must not share
 * edge state.
 *
 * `connected` clears the set and returns `true`. It is a genuine RISING edge, not a state read:
 * `daemonConnection.ts:478` is the one emit site and it fires on handshake-complete, so the renderer sees
 * one per completed handshake and it is never re-asserted (`conversationActivityBridge.ts:224-227` already
 * relies on this). A replayed `connected` into a reopened window (`liveWindow.ts:152-155`) fires a request
 * too, which is correct rather than duplicate: that window's store is empty and needs the reading. The
 * clear is `clearAllActivity`'s discriminator applied here — a turn that was running when the socket
 * dropped may have finished while it was down, so its liveness must not survive the handshake.
 *
 * Reading the edge off the EVENT STREAM rather than off `useSessionStore` + a `useRef` (the
 * conversationListBridge shape the ticket names) is deliberate. `vitest.config.ts` runs `environment:
 * 'node'` globally and no renderer spec in this repo can run an effect, so a ref-guarded edge would be
 * STRUCTURALLY UNCOVERABLE — the exact hazard `conversationActivityBridge.ts:150-159` documents. A
 * predicate is a plain function a test calls directly. There is no reliability loss either:
 * `main/index.ts:271-274` defers `connection.start()` to `did-finish-load` specifically so the renderer's
 * subscription is live before `connected` arrives.
 *
 * `turnState` holds phase PER CONVERSATION, because a single daemon-wide boolean would both steal edges
 * (B's `idle` consuming A's) and fire on re-asserted phases, which AC2 forbids. `Set.prototype.delete`
 * returns whether the entry was present, so the running → not-running transition IS the return value, in
 * one expression. Two properties fall out: the set self-prunes (an idle conversation leaves no entry, so it
 * is bounded by concurrently-running turns rather than by lifetime conversation count), and it never
 * touches a prototype setter. `event.state` is `WireTurnState` and `isTurnRunning` takes `TurnPhase` — the
 * same literal union declared on both sides of the boundary, so this assigns with no cast.
 *
 * The EDGE SET stays daemon-wide, and #946 deliberately did not narrow it: a turn ending in ANY
 * conversation is a turn-end edge here, because filtering to the active conversation would leave the
 * figures stale exactly when another conversation was the one spending the window. That is an argument
 * about WHEN to refresh. What the request then ASKS ABOUT is a separate question, and since 2026-08-20 it
 * has a different answer: a `session_settings` reply describes exactly one conversation's session, so the
 * request names the ACTIVE conversation — whichever conversation's turn edge triggered it. The result
 * here stays a bare boolean precisely so `event.conversationId` cannot leak into that id.
 *
 * `default: false` — not an `assertNever` — because ignoring the rest is the intended, permanent behaviour
 * here (`toRunConfigSnapshot`'s filter idiom). Total over the sealed union, so no daemon-controlled string
 * can reach an exception message.
 */
export function createRunConfigRefreshTrigger(): (event: DaemonEvent) => boolean {
  const running = new Set<string>()
  return (event) => {
    switch (event.type) {
      case 'connected':
        running.clear()
        return true
      case 'turnState':
        if (isTurnRunning(event.state)) {
          running.add(event.conversationId)
          return false
        }
        return running.delete(event.conversationId)
      default:
        return false
    }
  }
}

/**
 * Subscribe via the injected `onDaemonEvent` with ONE listener that owns ONE trigger — created here, per
 * subscription, so the edge state is discarded with the subscription — and call `refresh` on each true
 * edge. Returns the unsubscribe handle (the daemonEventBridge off-handle idiom) so the React binding can
 * use it as its effect cleanup. The listener only dispatches — it never throws into React.
 *
 * `refresh` takes no argument, and after #946 that is a GUARANTEE rather than an incidental fit: the
 * request now names a conversation, and the one it must name is the active one, never the one whose turn
 * just ended. A nullary seam makes passing the edge's `conversationId` a type error instead of a judgement
 * call at the binding. The id is resolved in `RunConfigLiveData`'s arrow, at call time.
 *
 * A SECOND listener beside `subscribeRunConfig`, deliberately not a widening of it. The two touch disjoint
 * state and can never cross-fire (an event is never both a `runConfigReceived` and an edge), which is the
 * arrangement `conversationDeletedBridge.ts:37-42` documents for exactly this case. Registration order is
 * irrelevant: an edge sends a request whose reply arrives later, and a reply is not an edge. Folding both
 * jobs into `subscribeRunConfig` the way `conversationListBridge` does would mean widening a signature that
 * already takes two same-shaped function parameters (so a cross-wire would need the named-deps-object
 * treatment to stay safe) and editing nine call sites, to save one `onDaemonEvent` registration.
 */
export function subscribeRunConfigRefresh(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  refresh: () => void
): () => void {
  const shouldRefresh = createRunConfigRefreshTrigger()
  return onDaemonEvent((event) => {
    if (shouldRefresh(event)) refresh()
  })
}

/**
 * The run-configuration live-read binding — a headless leaf mounted app-level in App.tsx alongside the
 * other eight: one stable, app-lifetime listener of each kind with no subscribe/unsubscribe churn as the
 * route flips. That lifetime is the point — it is what makes the figures exist before the sheet has ever
 * been mounted and keeps them true after it closes.
 *
 * It is now the ONLY listener that lands `runConfigReceived` into the two stores; `RunConfigData` keeps its
 * per-open request and has lost its subscription. Two subscribers would write identical values into both
 * stores on every reply while the sheet was open — two `set` calls, two notifications, and a duplicated
 * write into the session-id store whose two-ingress contract exists precisely because arrival order
 * matters.
 *
 * Two effects, each returning its `onDaemonEvent` off handle as cleanup, so a StrictMode double-mount nets
 * exactly one live listener of each kind (the daemonEventBridge idiom). No timers, no AbortController, no
 * promise: nothing outlives the leaf. `window.pyry` is dereferenced only inside the effects, never during
 * render, so it server-renders to `''` without a bridge mock (the QueueData / ConversationActivityData
 * invariant, which App.test's no-window-stub `<App/>` render depends on).
 */
export function RunConfigLiveData(): null {
  useEffect(() => {
    // Subscribe first (declared before the refresh effect, so it runs first on mount): the listener is
    // live before any request goes out. `subscribeRunConfig` is reused verbatim — each runConfigReceived
    // writes into BOTH app-singleton stores, since the values and the session id they describe arrive on
    // one frame and are only meaningful together (#491).
    return subscribeRunConfig(
      window.pyry.onDaemonEvent,
      (snapshot) => runConfigStore.getState().setSnapshot(snapshot),
      (sessionId) => sessionIdStore.getState().setSessionId(sessionId)
    )
  }, [])

  useEffect(() => {
    // Re-request on each true edge, naming the conversation the sheet describes (#946) — read
    // non-reactively at call time, the same `getState()` shape this module already uses for its sibling
    // stores, so this leaf still subscribes to nothing. `window.pyry.sendCommand` and the store are both
    // touched only when the arrow runs (an edge fired), never during render, so the
    // server-render-to-empty-markup invariant is unaffected. An edge arriving with no conversation active
    // — a `connected` edge before the first open, typically — sends nothing rather than a request whose
    // zero reply would wipe the held snapshot. A duplicate, a sheet-open request landing alongside an
    // edge-driven one, needs no designing around: the reply is a whole-snapshot replace, so it is
    // idempotent.
    return subscribeRunConfigRefresh(window.pyry.onDaemonEvent, () =>
      requestRunConfigSnapshot(
        window.pyry.sendCommand,
        activeConversationStore.getState().activeConversation?.id ?? null
      )
    )
  }, [])

  return null
}
