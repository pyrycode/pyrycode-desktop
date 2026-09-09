// The renderer data path feeding the usage-limit store: it observes the typed `rateLimited` daemon event
// (#1318 decodes the daemon's `rate_limited` frame, #1319 carries it across) and lands each reading in
// the app-singleton `usageLimitStore` the composer status row (#1321) will read. Reactive-only — like
// announcedModelBridge (#588) / slashCommandListBridge (#954) and unlike conversationListBridge (#208),
// the daemon PUSHES the reading unsolicited, so there is NO request half: no command sent, no
// connected-edge trigger, and specifically NO RETRY — a client-side retry against a relay that withholds
// the frame would be a self-inflicted spin.
//
// AN INDEPENDENT SUBSCRIBER, not a new arm on an existing bridge. All four exhaustive bridges keep their
// `rateLimited` no-op PERMANENTLY — each is present only so the `assertNever` guard makes a NEW arm a
// compile error — so this is the announcedModelBridge / modelListBridge shape, NOT the #493 shape where
// `apiRetry` folded into timelineBridge's owned arm. `timelineBridge`'s arm was the one still marked
// DORMANT, recording the routing choice as this ticket's to make; taking this route settles it and that
// comment now says PERMANENT. Nothing in those four changes behaviour.
//
// The two helpers are React-free and injected, so the whole path is unit-testable with plain spies (the
// announcedModelBridge idiom); `UsageLimitData` is the thin React glue over them. Nothing here touches
// keys, sockets, ipcRenderer, or raw frames — it only subscribes through the preload bridge and
// dispatches an already-typed event. `status` and `limitType` are UNTRUSTED, model-influenced
// claude-authored text held verbatim, and this slice has no DOM sink (the inert-text rendering discipline
// is inherited by #1321). NOTHING ON THIS PATH IS EVER LOGGED: the pair discloses the account's quota
// posture, a fact about the operator rather than about this frame.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { usageLimitStore, type UsageLimitSnapshot } from './usageLimitStore'

/**
 * The benign status — the one value that means "claude's usage window is in the state that needs no
 * report", and the only status this path ever compares against.
 *
 * CLIENT-OWNED AND MODULE-PRIVATE. It is not exported, because it has no reader outside this module: a
 * benign reading is never held, so #1321 selects its copy from statuses this constant excludes and never
 * needs to name it. Shipping it as an export would ship an unread read path.
 *
 * The daemon is SILENT on this status today — its producer emits only on a non-benign window — so this
 * arm has no live producer yet. It is kept because it is one string comparison, drivable by a fake frame,
 * and the daemon has committed to sending it: it is the only clean clear the wire will ever offer, and
 * an entry whose `resetsAt` is `0` has no other exit short of the pairing ending.
 */
const BENIGN_STATUS = 'allowed'

/**
 * The filter: map the one owned arm to its reading, every other DaemonEvent to `null`. A FRESH
 * named-field literal (the announcedModelBridge idiom — never `return event`, never a spread) so `type`
 * never reaches the store and the store shape stays immune to the `rateLimited` arm gaining an unrelated
 * field later; `daemonConnection`'s emit already made the identical call one layer up.
 *
 * All four carried fields go across VERBATIM. Neither string is normalised, trimmed, lowercased,
 * allow-listed or shape-checked — the value set beyond the benign status is UNMEASURED, so a client that
 * narrows either drops the first real limit that fires. `resetsAt` is carried unread: `0`, a negative and
 * a year-40000 value all cross unchanged, and the store's selector is the only place the number means
 * anything. The `conversationId` is carried verbatim too — not normalised, allow-listed, or checked
 * against the open conversation, because an id matching no selectable conversation must be an explicit
 * no-match downstream, never a `?? activeConversation` fallback.
 *
 * `truncated_fields` is absent because #1319 declined to carry it: #1321 renders no daemon-authored
 * string, so a value the producer cut misses the copy lookup exactly as an unrecognised one does, and
 * there is nothing on screen for a truncation marker to qualify.
 *
 * `default: null` — not an `assertNever` — because ignoring the rest is this path's intended, permanent
 * behaviour: it is an independent subscriber, not one of the four typecheck-gating exhaustive bridges.
 * `null` here means "not our arm", NEVER "bad data": a malformed payload is already rejected upstream,
 * where #1318's narrower throws WireDecodeError inside daemonConnection's decode guard and no event is
 * emitted at all. React-free → unit-testable without a DOM.
 */
export function translateRateLimited(event: DaemonEvent): UsageLimitSnapshot | null {
  switch (event.type) {
    case 'rateLimited':
      return {
        conversationId: event.conversationId,
        status: event.status,
        limitType: event.limitType,
        resetsAt: event.resetsAt
      }
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each `rateLimited` reaches ONE of the two store mutations
 * and every unrelated event no-ops. Returns the unsubscribe handle (the daemonEventBridge off-handle
 * idiom) so the React binding can use it as its effect cleanup.
 *
 * THE ROUTING LIVES HERE AND NOT IN THE STORE, and both halves of that placement are load-bearing. The
 * store keeps its "no mutation branches on arriving or held content" property, which is what stops a
 * hostile value from crafting an entry that survives a clear; and the decision stays a pure function of
 * the event, testable with two spies and no store at all.
 *
 * THE COMPARISON IS EXACT EQUALITY, never a prefix, substring, case-folded or trimmed test, and this is
 * the sharpest edge in the slice. `allowed_warning` — the ONLY non-benign status ever measured
 * (2026-08-22, claude 2.1.239, `limit_type: seven_day`, every turn still running normally) — STARTS WITH
 * the benign string, so a `startsWith` or `includes` comparison would silently discard the single reading
 * this whole vertical exists to surface. Pinned by a test naming that value.
 *
 * The comparison is also the one place `status` is consumed in this slice, and it is the shape the arm's
 * contract permits: a key selecting among strings THIS CLIENT wrote, with a defined behaviour on a miss.
 * It steers no security-relevant behaviour — the worst a wrong or hostile value can do is drop a reading
 * that should have been held, or hold one that should have been dropped, each costing at most one wrong
 * or missing row on #1321's surface. Nothing is authorized, unlocked, retried, throttled, suspended or
 * reconnected on it.
 *
 * The clear is handed the CONVERSATION ID AND NOTHING ELSE, so no daemon-authored string crosses into the
 * store on that path at all. The `reading !== null` guard is on the SNAPSHOT's presence, never on
 * content: a `{ status: '', limitType: '', resetsAt: 0 }` reading is a real, degenerate reading and is
 * recorded like any other, because the empty string is not the benign status. There is deliberately no
 * guard on the `conversationId` either — an unrecognised id is written under its own key and read by
 * nothing, which is a stronger no-match than a filter here could be, and the only list this bridge could
 * check against is one it has no business subscribing to. The listener only translates + dispatches; it
 * never throws into React and nothing here is logged.
 */
export function subscribeUsageLimit(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setUsageLimit: (snapshot: UsageLimitSnapshot) => void,
  clearUsageLimitFor: (conversationId: string) => void
): () => void {
  return onDaemonEvent((event) => {
    const reading = translateRateLimited(event)
    if (reading === null) return
    if (reading.status === BENIGN_STATUS) clearUsageLimitFor(reading.conversationId)
    else setUsageLimit(reading)
  })
}

/**
 * The usage-limit data-path binding — a headless component mounted app-level in App.tsx alongside
 * AnnouncedModelData: one stable, app-lifetime listener with no subscribe/unsubscribe churn as the route
 * flips. The App-level rationale is the sharpened one its keyed neighbours carry — the daemon scopes the
 * frame to whichever conversation OBSERVED the window, which may be one the operator has never opened,
 * and a reading can arrive long before #1321's status row is ever mounted, so a screen-scoped listener
 * would miss exactly the case this store exists for.
 *
 * No `connected` branch, for AnnouncedModelData's reason: after a reconnect to the same daemon the
 * account's quota window is exactly what it was, and there is no request half that could re-fetch a
 * reading blanked at that edge. Its pairing-scoped clear is `clearPairingScopedState`'s, not this leaf's.
 *
 * A component (not a hook) isolates the subscription in its own leaf so it never cascades a re-render
 * into App; it renders nothing. `window.pyry` is dereferenced only inside the effect, never during
 * render, so it server-renders to `''` without a bridge mock (the QueueData invariant). Reactive-only:
 * one subscribe effect, no request effect, no useState/useRef/useSessionStore. Ships dormant — it
 * populates the store, but nothing renders it yet (#1321).
 */
export function UsageLimitData(): null {
  useEffect(() => {
    // Subscribe on mount; the returned off handle is the effect cleanup, so a StrictMode double-mount
    // nets exactly one live listener (the announcedModelBridge idiom). Each reading reaches the
    // app-singleton store through one of its two event-driven mutations, chosen above.
    return subscribeUsageLimit(
      window.pyry.onDaemonEvent,
      (reading) => usageLimitStore.getState().setUsageLimit(reading),
      (conversationId) => usageLimitStore.getState().clearUsageLimitFor(conversationId)
    )
  }, [])

  return null
}
