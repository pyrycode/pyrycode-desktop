// The renderer data path feeding the per-conversation last-read store (#777, split from #677): it keeps
// ONE invariant true — THE OPEN CONVERSATION'S MARK EQUALS ITS OWN HELD ITEM COUNT — from two restore
// points. `activateConversation` restores it when a conversation is opened; the store subscription below
// restores it again whenever content lands while that conversation stays open. Both are the same write of
// the same quantity, which is why this is one write function called from two places rather than two
// paths. Nothing renders from these writes yet: #778 derives the unread predicate and #676 draws the dot.
//
// The second restore point is not decoration. Without it, content arriving in the conversation the
// operator is actively reading pushes that conversation's count past its mark and lights its own unread
// dot — the feature accusing him of not having read what is on screen in front of him.
//
// THE WRITE IS AN ASSIGNMENT OF THE SAMPLED COUNT, NEVER AN INCREMENT, and that is a fact about the
// reducer rather than a preference: a CONTINUING `assistantDelta` coalesces into the tail bubble
// (`appendDelta`, threadTimeline.ts:239-250) and leaves `items.length` unchanged, `toolResult` fills a
// held row in place (`fillResult`, :259-275) and never changes the length at all, and `turnState`,
// `stallDetected`, `apiRetry`, `compacting` and `reconnected` never touch `items`. A design that bumped a
// counter on arrival would be wrong on most arms.
//
// THIS OBSERVES THE STORE, NOT THE DAEMON FEED — the repo's first production store→store subscription,
// and a deliberate departure from every existing bridge under `store/`, which subscribe to
// `window.pyry.onDaemonEvent`. Two facts force it, and both are about coverage rather than taste:
//
//   - A NON-DAEMON WRITER MOVES THE COUNT. The composer's optimistic echo writes the keyed slice directly
//     (composerSend.ts:88), so the operator's own sent message grows the open conversation's count with
//     no IPC arm behind it. A path observing only `onDaemonEvent` misses it, and his own message makes
//     his own open chat unread.
//   - SAMPLING ORDER IS A LIVE HAZARD. The keyed slice is written inside `useTimelineBridge`'s fan-out
//     (timelineBridge.ts:432). A SECOND `onDaemonEvent` listener that sampled the count would depend on
//     listener registration order and read a stale count whenever it ran first. Observing the store
//     carries no such dependency: zustand's vanilla `setState` reassigns the state and THEN calls its
//     listeners, so a read inside one sees the value that was just written.
//
// It re-stamps on EVERY timeline-store change, including a fold into a background conversation's slice
// and including an eviction. Filtering to "did the open conversation's slice change?" would be a second,
// redundant comparison in front of the store's own same-value guard, and it would need the previous
// state — which is exactly the captured-emission shape the nullary listener seam below rules out. The
// common case costs nothing: an unchanged count re-records an identical mark, `recordLastRead`'s `===`
// guard hands back the state object, and zustand's `Object.is` short-circuit fires, so no subscriber
// wakes and no map is cloned (conversationLastReadStore.ts:154-157 names this the common case, and this
// ticket is why). No re-entrancy either — the write targets a DIFFERENT store than the one subscribed,
// so it cannot re-trigger its own listener.
//
// WHY THIS MODULE IMPORTS `activeConversationStore`, which timelineBridge.ts:236-240 and
// conversationActivityBridge.ts:183-184 both ban for themselves: that ban stops an ARRIVING EVENT THAT
// CARRIES ITS OWN `conversationId` from being attributed to the conversation on screen — the
// `?? activeConversation` misattribution the whole #675 family was built to remove. Here NOTHING ARRIVES.
// There is no event, no `conversationId` on the wire, and therefore no attribution to get wrong. The open
// conversation is not a fallback for a missing id; it IS the subject of the quantity being written, named
// by the acceptance criteria themselves. `conversationLastReadStore`'s own hard import constraint is
// untouched — it binds what THAT module imports, not who may import it (the timelineBridge.ts:411-413
// argument for the timeline holder, reused).
//
// SECURITY: `conversationId` is daemon-asserted untrusted text used here ONLY as a lookup key on its way
// to two `Map`s — `selectTimelineFor`'s `get` on the read side and `recordLastRead`'s `set` on the write
// side, both hostile-key-safe by construction (`Map.prototype.get('__proto__')` performs no
// prototype-chain lookup), so `'__proto__'`, `'constructor'` and `''` are three unremarkable keys. It is a
// VALUE on every call, never a key: there are no computed object keys anywhere on this path. It is never
// rendered, concatenated, logged, normalised, trimmed, length-checked, or used as a filename, attribute or
// URL, and never compared against a secret. The mark is a bare `number`, so there is structurally nowhere
// inside a value for the id to be stored. Because this bridge names ONLY the open conversation's id, a
// hostile relay fanning frames for ids the operator has never opened mints ZERO last-read entries.
// Log-free by construction — no `console.*` on any branch, matching the store it writes
// (conversationLastReadStore.ts:102-105) and the bridge it is modelled on
// (conversationActivityBridge.ts:36-39): the only value a diagnostic here could carry is that id, and the
// renderer console is readable by anything that can open DevTools (ADR 0007, #126). The `null`-open early
// return and the absent-slice `0` are silent BY DESIGN, not swallowed errors.
import { useEffect } from 'react'
import { activeConversationStore, selectActiveConversation } from './activeConversationStore'
import { conversationLastReadStore, type LastReadMark } from './conversationLastReadStore'
import { conversationTimelineStore, selectTimelineFor } from './conversationTimelineStore'
import type { TimelineState } from './threadTimeline'

/**
 * This path's whole effect surface, as ONE NAMED OBJECT rather than a positional list — the
 * `ConversationActivityDeps` (#749) shape, adopted for the reason it was introduced: a positional
 * cross-wire would compile AND pass every test, and the wiring itself is structurally uncoverable because
 * `vitest.config.ts` is `environment: 'node'` globally, so no test in this repo ever runs a React effect.
 * Named members make each effect state its own name beside its own call.
 *
 * `getOpenConversationId` and `getTimelineFor` are GETTERS rather than values threaded in by the caller,
 * for `activateConversation.ts:16-23`'s reason: one app-lifetime listener outlives any number of chat
 * switches, so a value read once at subscribe time would stamp a conversation the operator has already
 * left, with a count it no longer holds.
 */
export interface ConversationLastReadDeps {
  getOpenConversationId: () => string | null
  getTimelineFor: (conversationId: string) => TimelineState | null
  recordLastRead: (conversationId: string, itemsSeen: LastReadMark) => void
}

/**
 * The one write: sample THAT conversation's own held item count and record it as its mark. Total — no
 * return value, no throw path, no failure mode.
 *
 * It deliberately never reads `getOpenConversationId`, and that is what makes it correct at the activate
 * seam, where the conversation being stamped is not yet the open one. Taking the id explicitly also makes
 * it independent of where in `activateConversation` it sits and of whether `setActiveConversation` has
 * run — the seam-sharing hazard #786 would otherwise introduce.
 *
 * THE ABSENT-SLICE BRANCH IS WRITTEN OUT, never `selectTimelineFor(id) ?? initialTimelineState`, which
 * `conversationTimelineStore.ts:44-49` bans at every read site because it collapses "nothing is held for
 * this conversation" into "observed, nothing in the thread". Nothing is collapsed here: the two readings
 * stay distinct STATES in the timeline store and are mapped onto the same honest COUNT, because a
 * conversation with no slice held holds zero items and so does an empty slice. `0` is a real, producible
 * mark distinct from an absent one (conversationLastReadStore.ts:118-124), and AC1 requires exactly this
 * — "including a mark of `0` when nothing is held for it yet". No `??`, no `||`, no optional chain, no
 * default parameter and no non-null assertion anywhere on this path.
 *
 * The branch lives here rather than in `conversationLastReadDeps` precisely so it is covered: with a
 * `getTimelineFor` spy both readings drive through the same function.
 */
export function stampLastReadFor(deps: ConversationLastReadDeps, conversationId: string): void {
  const slice = deps.getTimelineFor(conversationId)
  deps.recordLastRead(conversationId, slice === null ? 0 : slice.items.length)
}

/**
 * Restore point 2 — subscribe to the timeline store and re-stamp the open conversation on every emission.
 *
 * Returns the EXACT handle `subscribeTimelines` gave back (the `subscribeConversationActivity` /
 * `subscribeTimeline` idiom), so the React binding can use it as its effect cleanup and a StrictMode
 * double-mount nets exactly one live listener.
 *
 * AC4 IS AVAILABLE BY CONSTRUCTION rather than by a guard: the listener names exactly one id —
 * `getOpenConversationId()`'s — on every path, so a conversation that is not open is never an argument to
 * `recordLastRead`, its mark cannot be touched, and an unmarked conversation cannot acquire a `0`. There
 * is no guard to forget; the wrong write is unavailable, the same posture `conversationLastReadStore`'s
 * hard import constraint takes. The `null` early return is the second half of that property — nothing
 * open means nothing is minted for anybody.
 *
 * THE LISTENER SEAM IS NULLARY on purpose. Zustand hands `(state, prevState)` to a subscriber, and typing
 * this seam `() => void` makes it impossible to sample the count off a captured emission argument instead
 * of reading it back out of the store — while `conversationTimelineStore.subscribe` stays assignable to
 * it, since a nullary listener fits zustand's two-argument slot.
 *
 * The read-then-write is one synchronous pair on the renderer's single thread with no `await` between
 * them, so there is no suspension point for a concurrent handler to interleave into.
 */
export function subscribeConversationLastRead(
  subscribeTimelines: (listener: () => void) => () => void,
  deps: ConversationLastReadDeps
): () => void {
  return subscribeTimelines(() => {
    const openConversationId = deps.getOpenConversationId()
    if (openConversationId === null) return
    stampLastReadFor(deps, openConversationId)
  })
}

/**
 * The production wiring. Each member reaches its singleton through `getState()` inside the arrow body —
 * the `activateDeps` / bridge idiom — so nothing is dereferenced at module load and nothing is read
 * during render. Module-level, so `useConversationLastRead`'s effect has a stable dependency and cannot
 * stack a second listener across re-renders.
 *
 * The open-conversation read is the identical two-line getter `App.tsx:47-50` already holds for #785's
 * injection into `useTimelineBridge`. It is DUPLICATED rather than relocated: relocating means editing
 * `App.tsx` and `activeConversationStore.ts` for zero behavioural gain (CLAUDE.md — don't refactor
 * adjacent code while you are there). Written the same way in both places, as an explicit `null` test
 * rather than `open?.id ?? null`, so "no `??` anywhere on this path" stays literally true and an
 * empty-string id stays an ordinary key instead of collapsing into "nothing open". Recorded rather than
 * hidden: two consumers is the signal that a `selectOpenConversationId` selector on
 * `activeConversationStore` would have a home (conversationActivityBridge.ts:29-30's "one consumer is an
 * import, two is a home") — a separate three-line ticket for whoever needs a third.
 */
export const conversationLastReadDeps: ConversationLastReadDeps = {
  getOpenConversationId: () => {
    const open = selectActiveConversation(activeConversationStore.getState())
    return open === null ? null : open.id
  },
  getTimelineFor: (conversationId) =>
    selectTimelineFor(conversationId)(conversationTimelineStore.getState()),
  recordLastRead: (conversationId, itemsSeen) =>
    conversationLastReadStore.getState().recordLastRead(conversationId, itemsSeen)
}

/**
 * The React binding for restore point 2 — a hook, mounted from `PairedShell` beside its five existing
 * subscriber hooks.
 *
 * PAIRED SHELL, NOT APP, and that is the deliberate opposite of every other headless bridge in this
 * directory. `ConversationActivityData` states the App-level rule in as many words: "the whole point is a
 * chat the operator has NEVER OPENED, so a screen-scoped listener would miss exactly the case the store
 * exists for." This bridge is the exact inverse — it only ever writes the OPEN conversation, and "open"
 * is a concept that exists only inside the paired shell. There is no gap: every path that unmounts
 * `PairedShell` clears the active conversation first (`onUnpaired` runs `clearPairingScopedState`, which
 * clears both the active conversation and every timeline, before flipping App's route; the only other
 * route into `pairing` is the welcome CTA, reached with nothing paired), and deletion and archive clear
 * the active conversation without unmounting the shell. So no state exists in which a conversation is
 * open and this listener is not mounted.
 *
 * A hook rather than a headless component, because it subscribes to no store for RENDER — it only runs an
 * effect, so it cascades no re-render into its host and `PairedShell` stays server-renderable
 * (PairedShell.tsx:36-42's invariant). It dereferences no `window.pyry` at all: the seam is a
 * renderer-local zustand store, which is precisely what removes the daemon-event listener a naive design
 * would have added, and with it the registration-order dependency.
 *
 * The subscribe seam is passed as an ARROW rather than the bare `conversationTimelineStore.subscribe`, so
 * nothing relies on zustand's `subscribe` being `this`-free. Dependency array `[]`: the deps object is a
 * module-level constant and the store is a singleton, so there is nothing to re-subscribe on, and a
 * StrictMode double-mount runs mount → cleanup → mount and nets exactly one listener.
 */
export function useConversationLastRead(): void {
  useEffect(
    () =>
      subscribeConversationLastRead(
        (listener) => conversationTimelineStore.subscribe(listener),
        conversationLastReadDeps
      ),
    []
  )
}
