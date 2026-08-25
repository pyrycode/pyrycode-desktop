// The renderer data path feeding the per-conversation activity store (#748, split from #674): it
// observes the FOUR typed daemon arms that report what a conversation is DOING — `turnState` (#214,
// widened by #724), `stallDetected` (#315/#732), `apiRetry` (#492/#737) and `compacting` (#495/#742) —
// and lands each fact in the app-singleton `conversationActivityStore` (#747) under THAT EVENT'S OWN
// `conversationId`. The sidebar dot (#676) reads it; nothing renders from these writes yet.
//
// A SECOND, INDEPENDENT SUBSCRIBER, not a change to an existing one. timelineBridge.ts:43-46, :96-120
// already consumes all four arms for the OPEN conversation and drops the id at each; it keeps doing
// exactly that, untouched, and the two paths do not overlap. Reactive-only — like queueBridge,
// sessionIdBridge and backgroundTaskRosterBridge, the daemon PUSHES all four unsolicited, so there is
// NO request half: no command sent, no connected-edge fetch. The helpers are React-free and injected,
// so the whole path is unit-testable with plain spies; `ConversationActivityData` is the thin React
// glue over them. Nothing here touches keys, sockets, ipcRenderer or raw frames — it only subscribes
// through the preload bridge and consumes an already-typed event.
//
// THE `store/` → `screens/` IMPORT BELOW IS DELIBERATE, and it is the first arrow in that direction —
// every existing one runs the other way. It is a TYPE-AND-PREDICATE-ONLY import of one pure function
// of `TurnPhase`, it introduces no cycle (nothing under `screens/` imports this bridge), and it costs
// nothing measurable: App.tsx:2 → PairedShell.tsx:4 already puts ConversationScreen's module graph in
// the boot graph on every route, and vitest.config.ts:26-27 runs `environment: 'node'` globally with
// ConversationScreen.test.tsx already loading that graph. Re-deriving the phase test instead is the
// #648 defect verbatim — a gate written against one phase literal makes the signal vanish for the
// tool-heavy bulk of a turn. Relocating the predicate was weighed and rejected: it refactors two of the
// renderer's largest files for no behavioural gain and falsifies
// conversationActivityStore.ts:28-29, which names the predicate's home by file AND line. The store's
// own HARD IMPORT CONSTRAINT is untouched and still grep-checkable — it is scoped to THAT module ("a
// store whose tests run with no React and no DOM") and in the same breath names this ticket as the
// owner of the derivation with `isTurnRunning`. A bridge is not that module; the precedent already
// imports `react` (backgroundTaskRosterBridge.ts:18). If a SECOND store-side module ever needs the
// predicate, that is the signal to relocate it: one consumer is an import, two is a home.
//
// SECURITY: `conversationId` is daemon-asserted untrusted text used here ONLY as a lookup key on its
// way to the store's `Map` — never rendered, never concatenated, never a filename, a cache key, a URL
// or an attribute, and never compared against a secret. It is a VALUE on every write, never a key: the
// write path uses NO computed object keys, so there is no `{ [x]: v }` whose provenance a reviewer
// must trace. Log-free by construction — no `console.*` on any branch, matching the store
// (conversationActivityStore.ts:49-51) and the four arms' decode-side content-free pins: the only
// value a diagnostic here could carry is that id, and the renderer console is readable by anything
// that can open DevTools (#126). Nothing is parsed, fetched or persisted.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { conversationActivityStore } from './conversationActivityStore'
import { isTurnRunning } from '../screens/conversation/ConversationScreen'

/**
 * One write on its way to one named setter: which fact, whose entry, what value.
 *
 * Three properties are load-bearing.
 *
 * The payload field is NAMED AFTER THE FACT rather than a shared `value`. With a shared `value` a
 * cross-wire is a tag swap that compiles; with named fields
 * `{ fact: 'stalled', turnRunning: false }` is a type error. That is the exact class of bug #747's
 * review found — a cross-wired setter that passed all 22 of its tests — made unrepresentable rather
 * than tested for.
 *
 * The member names are the store's own `ConversationActivityEntry` field names, so a write reads
 * against the setter it will reach. They deliberately do NOT mirror the wire arm names: the mapping is
 * not one-to-one (`turnState` writes TWO facts, and `apiRetry` → `apiRetrying`).
 *
 * The discriminant is `fact`, not `type`. CLAUDE.md's `type`-discriminant convention is scoped to
 * incoming daemon events and outgoing user actions; this is neither. `fact: 'stalled'` sitting beside
 * `event.type === 'stallDetected'` inside one switch is the disambiguation, not a drift from it.
 */
export type ConversationActivityWrite =
  | { fact: 'turnRunning'; conversationId: string; turnRunning: boolean }
  | { fact: 'stalled'; conversationId: string; stalled: boolean }
  | { fact: 'apiRetrying'; conversationId: string; apiRetrying: boolean }
  | { fact: 'compacting'; conversationId: string; compacting: boolean }

/** Compile-time exhaustiveness guard for OUR OWN write union: a fifth fact without a dispatch case is
 *  a type error. Unreachable at runtime while the union and the apply switch agree, matching the
 *  reducer's own guard (threadTimeline.ts:227-229) — but it stringifies THE DISCRIMINANT ONLY, never
 *  the whole write. That is a deliberate divergence from the repo's `JSON.stringify(event)` idiom
 *  (threadTimeline.ts:229, App.tsx:20), which here would embed the untrusted `conversationId` in a
 *  thrown message on a path that is otherwise log-free by construction. */
function assertNever(write: never): never {
  throw new Error(`Unhandled conversation-activity fact: ${(write as { fact: string }).fact}`)
}

/**
 * The translator: map each owned arm to the writes it implies, every other DaemonEvent to `[]`. Pure,
 * React-free and listener-free, so the whole derivation — the turn-running fan-out included — is a
 * function a test calls directly.
 *
 * Each case builds FRESH NAMED-FIELD LITERALS (the backgroundTaskRosterBridge.ts:28-31 idiom — never
 * `return event`, never a spread), which is load-bearing rather than stylistic: a spread would carry
 * the arm's `type` tag, and any field a later arm gains, into a write unit that never agreed to hold
 * it. `apiRetry`'s `current` / `total` are the live instance of that: this store holds LIVENESS, and
 * the counter stays in the open conversation's chrome (threadTimeline.ts:184-199) where its reader is.
 *
 * `default: []` — not an `assertNever` — because ignoring the rest is this path's intended, permanent
 * behaviour: it is an independent subscriber in the queueBridge / backgroundTaskRosterBridge posture,
 * not one of the three typecheck-gating exhaustive bridges.
 *
 * ONE translator returning a tagged union, rather than the precedent's four sibling single-arm filters
 * — the deliberate departure from backgroundTaskRosterBridge, whose own test header records that it
 * REJECTED a tagged union (backgroundTaskRosterBridge.test.ts:15-18). There the arm → setter mapping
 * was one-to-one, so each filter was a whole rule. Here `turnState` writes TWO facts, and under
 * sibling filters that rule has no single home: either a fifth filter switches on `turnState` a second
 * time, leaving the coupling invisible from both, or the stall clear moves into the subscriber, where
 * the precedent deliberately keeps only the `connected` reset. It is also the smaller surface — one
 * exported type against four, one switch against five. This does NOT contradict
 * conversationActivityStore.ts:17-20, which rejects a discriminated-union action set for the STORE's
 * API: the store keeps its four named setters untouched, and this union is a return type on the way to
 * them, existing for the reason the store's would not — one arm fanning out to two setters.
 */
export function translateConversationActivity(
  event: DaemonEvent
): readonly ConversationActivityWrite[] {
  switch (event.type) {
    case 'turnState':
      // TWO writes, and the pairing is the point. `event.state` is `WireTurnState`; `isTurnRunning`
      // takes `TurnPhase` — the same literal union declared on both sides of the boundary, so this
      // assigns with no cast and no import of `TurnPhase` (timelineBridge.ts:44-46's precedent: a
      // rename, not a re-validation). The predicate is REUSED, so a conversation counts as running in
      // BOTH `thinking` and `responding` (AC2).
      //
      // The stall clear is UNCONDITIONAL on any turn state, `idle` included — threadTimeline.ts:356-359
      // ("any state, including idle") adopted verbatim rather than re-invented as a running-only
      // variant. It is free as well as simpler: the store's per-field guard
      // (conversationActivityStore.ts:146-157) makes a redundant clear churn no listener, and a first
      // write of `false` still creates the entry, which is the correct reading — this conversation has
      // been observed and is not stalled.
      return [
        {
          fact: 'turnRunning',
          conversationId: event.conversationId,
          turnRunning: isTurnRunning(event.state)
        },
        { fact: 'stalled', conversationId: event.conversationId, stalled: false }
      ]
    case 'stallDetected':
      // Onset-only — the arm carries no payload beyond the id, and the wire has no falling edge for
      // it. The clear is the `turnState` arm above; there is deliberately no timer and no heuristic.
      return [{ fact: 'stalled', conversationId: event.conversationId, stalled: true }]
    case 'apiRetry':
      // The wire's own edge, copied. NOT in the `turnState` clear set, mirroring
      // threadTimeline.ts:196-199: a turn-state change arriving mid-retry is expected and must leave
      // the fact showing. Only an `active: false` clears it.
      return [{ fact: 'apiRetrying', conversationId: event.conversationId, apiRetrying: event.active }]
    case 'compacting':
      // The wire's own edge, copied — `apiRetry`'s clear semantics exactly (threadTimeline.ts:200-205),
      // and likewise never self-cleared by turn activity.
      return [{ fact: 'compacting', conversationId: event.conversationId, compacting: event.active }]
    default:
      return []
  }
}

/**
 * The store's whole effect surface, as ONE NAMED OBJECT rather than a positional list (#749). Every
 * member here collapses to a signature another member's slot accepts: the four setters are all
 * `(conversationId: string, value: boolean) => void`, and because a function of FEWER parameters is
 * assignable to one of more, `dropConversation` and `clearAllActivity` fit any of those four slots too.
 * A positional cross-wire would therefore compile AND pass every test in this file's suite — and it is
 * structurally uncoverable, because vitest.config.ts:26-27 is `environment: 'node'` globally, so no
 * test in this repo ever runs the effect in `ConversationActivityData` that does the wiring. It has to
 * be a type error instead, and a named member makes each effect state its own name beside its own
 * call. This closes #748's code-review SHOULD FIX, which assigned it forward to this ticket.
 *
 * Deliberately NOT pinned by an `Object.keys(deps).sort()` test like
 * clearPairingScopedState.test.ts:84-91. That pin guards DIVERGENCE BETWEEN TWO independent call sites,
 * which was the bug that motivated it; there is one call site here, and the failure this object closes
 * is cross-wiring, which named members close completely.
 */
export interface ConversationActivityDeps {
  setTurnRunning: (conversationId: string, turnRunning: boolean) => void
  setStalled: (conversationId: string, stalled: boolean) => void
  setApiRetrying: (conversationId: string, apiRetrying: boolean) => void
  setCompacting: (conversationId: string, compacting: boolean) => void
  dropConversation: (conversationId: string) => void
  clearAllActivity: () => void
}

/**
 * Subscribe via the injected `onDaemonEvent`, translate, then apply EVERY write in the returned array
 * in order. There is deliberately NO early return after the first match — that is the precedent's
 * shape (backgroundTaskRosterBridge.ts:151-168), and here it would silently drop the second of
 * `turnState`'s two writes.
 *
 * The apply switch IS exhaustive, unlike the translator's: that union is OURS, so a fifth fact must
 * not compile until it has a dispatch case. Every write passes `write.conversationId` — the event's
 * own id. The open conversation is never read here: `activeConversationStore` is not imported, so the
 * `?? activeConversation` fallback events.ts:116-117 bans is UNAVAILABLE rather than merely avoided.
 *
 * TWO EARLY-RETURN REMOVAL BRANCHES ahead of the translator (#749), the precedent's shape
 * (backgroundTaskRosterBridge.ts:151-155):
 *
 *   - `connected` → `clearAllActivity()`. THE SOLE ENFORCEMENT of the pairing boundary for this store,
 *     which is why it is registered nowhere in `clearPairingScopedState`: on that file's own
 *     discriminator (:30-33, "does a reconnect to the SAME daemon need to clear it?") the answer here
 *     is YES — all four facts are liveness, so a turn that was running when the socket dropped may
 *     have finished while it was down and must not leave a working dot on an idle row. It reads only
 *     the discriminant and ignores `event.ack`. Because it fires on EVERY completed handshake
 *     (daemonConnection.ts:466-481 is the one emit site) and every new pairing re-handshakes, both
 *     pairing-change paths are covered — the unpair route flip AND the pair-another-server transition
 *     that never unmounts the shell, which this bridge's app-level mount also survives. Gating it or
 *     folding it into the translator would kill that property silently.
 *   - `conversationDeleted` → `dropConversation(event.id)`. NO truthiness guard: a degenerate `''` is
 *     falsy but is a real value the daemon can emit and a real `Map` key, so the branch is
 *     discriminant-driven (conversationDeletedBridge.ts:32-34 makes the same point about the same
 *     arm). Deliberately NOT folded into `PairedShell`'s existing `useConversationDeletedExit`
 *     subscription: that callback runs the `exitActiveConversation` decision, which GATES on the id
 *     matching the OPEN conversation, and eviction must be UNGATED — the whole point is that a
 *     background conversation loses its dot. A third listener on this arm is correct rather than a
 *     duplicate; conversationDeletedBridge.ts:37-42 documents exactly this arrangement for listeners
 *     touching disjoint state.
 *
 * Neither removal is a member of `ConversationActivityWrite` and the translator is unchanged: every
 * member of that union names a store field and carries its value, and an eviction names neither.
 * Folding one in would force the return type to describe two unrelated things and destroy the property
 * that the translator is a pure arm→fact filter — the backgroundTaskRosterBridge.ts:128-133 argument,
 * adopted rather than re-derived, and pinned by a test. The three discriminants are mutually exclusive,
 * so branch ORDER is a readability choice rather than a correctness one.
 *
 * Injected `onDaemonEvent` + the deps object keep this React-free and unit-testable with plain spies.
 * The listener only translates + dispatches — it never throws into React.
 */
export function subscribeConversationActivity(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  deps: ConversationActivityDeps
): () => void {
  return onDaemonEvent((event) => {
    if (event.type === 'connected') {
      deps.clearAllActivity()
      return
    }
    if (event.type === 'conversationDeleted') {
      deps.dropConversation(event.id)
      return
    }
    for (const write of translateConversationActivity(event)) {
      switch (write.fact) {
        case 'turnRunning':
          deps.setTurnRunning(write.conversationId, write.turnRunning)
          break
        case 'stalled':
          deps.setStalled(write.conversationId, write.stalled)
          break
        case 'apiRetrying':
          deps.setApiRetrying(write.conversationId, write.apiRetrying)
          break
        case 'compacting':
          deps.setCompacting(write.conversationId, write.compacting)
          break
        default:
          assertNever(write)
      }
    }
  })
}

/**
 * The per-conversation activity binding — a headless component mounted app-level in App.tsx, alongside
 * BackgroundTaskRosterData: one stable, app-lifetime listener with no subscribe/unsubscribe churn as
 * the route flips. That lifetime is what makes AC4 true — any of the four arms can arrive at any time,
 * including for a conversation the user has never opened and including before the #676 sidebar (or
 * anything else that reads the store) is ever mounted, so the facts must be retained regardless of
 * which screen is shown. A component (not a hook) isolates the subscription in its own leaf so it
 * never cascades a re-render into App; it renders nothing. `window.pyry` is dereferenced only inside
 * the effect, never during render, so it server-renders to `''` without a bridge mock (the QueueData
 * invariant, which App.test's no-window-stub <App/> render depends on). Reactive-only: one subscribe
 * effect, no request effect, no useState/useRef/useSessionStore.
 */
export function ConversationActivityData(): null {
  useEffect(() => {
    // Subscribe on mount; the returned off handle is the effect cleanup, so a StrictMode double-mount
    // nets exactly one live listener (the queueBridge idiom). All six paths ride this one listener,
    // dispatched synchronously in daemon arrival order under zustand's own store lock, so there is no
    // gap between reading and writing the store that a concurrent handler could interleave into.
    // Ordering between the removals and the four feeds needs no reasoning for the same reason: a
    // `conversationDeleted` arriving after a `turnState` for the same id evicts what the earlier event
    // wrote, which is the correct reading — the conversation is gone. `turnState`'s two writes are two
    // separate `set` calls, so the intermediate state where `turnRunning` has flipped and `stalled`
    // has not is observable — harmless for #676, which draws one dot per row from a single entry and
    // sees both writes in the same task. Recorded as a decision, not an oversight: batching them would
    // add a fifth setter to a store whose four-named-setter shape is argued at
    // conversationActivityStore.ts:17-20.
    return subscribeConversationActivity(window.pyry.onDaemonEvent, {
      setTurnRunning: (id, v) => conversationActivityStore.getState().setTurnRunning(id, v),
      setStalled: (id, v) => conversationActivityStore.getState().setStalled(id, v),
      setApiRetrying: (id, v) => conversationActivityStore.getState().setApiRetrying(id, v),
      setCompacting: (id, v) => conversationActivityStore.getState().setCompacting(id, v),
      dropConversation: (id) => conversationActivityStore.getState().dropConversation(id),
      clearAllActivity: () => conversationActivityStore.getState().clearAllActivity()
    })
  }, [])

  return null
}
