// The renderer data path feeding the reported-context store: it observes the typed `contextUsage`
// daemon event (#1454 / #1455 / #1459 / #1460 decode the daemon's `context_usage` frame, #1419 carries
// it across) and lands each reading in the app-singleton `reportedContextStore` that #1421's footer and
// gauge — and #1254's breakdown popover — will read. Reactive-only — like announcedModelBridge (#588),
// slashCommandListBridge (#954) and usageLimitBridge (#1320), and unlike conversationListBridge (#208),
// the daemon PUSHES the reading unsolicited after every turn end, so there is NO request half: no
// command sent, no connected-edge trigger, and specifically NO RETRY — a client-side retry against a
// relay that withholds the frame would be a self-inflicted spin.
//
// AN INDEPENDENT SUBSCRIBER, not a new arm on an existing bridge. All four exhaustive bridges keep
// their `contextUsage` no-op PERMANENTLY — each is present only so the `assertNever` guard makes a NEW
// arm a compile error — so this is the announcedModelBridge / usageLimitBridge shape, NOT the #493
// shape where `apiRetry` folded into timelineBridge's owned arm. `timelineBridge`'s arm was the one
// still marked DORMANT, recording the routing choice as this ticket's to make; taking this route
// settles it and that comment now says PERMANENT. Nothing in those four changes behaviour, and the
// `case` label itself must STAY: that guard stringifies the WHOLE event into an `Error` message, and
// this is the largest arm on the union and the one carrying the most disclosive fields, so deleting the
// case would put every memory-file path and every MCP server name into a stack trace and a crash
// reporter.
//
// ONE ROUTE, NO COMPARISON, and that is the difference from the bridge this one otherwise copies.
// `subscribeUsageLimit` chooses between two store mutations on an exact-equality test against a
// client-owned benign status; this arm HAS NO BENIGN VALUE — every frame is a reading, and a window
// that shrinks at a `/clear` or a compaction arrives as the next frame rather than as an absence — so
// the whole module is comparison-free and there is nothing for a hostile string to steer.
//
// The two helpers are React-free and injected, so the whole path is unit-testable with plain spies (the
// announcedModelBridge idiom); `ReportedContextData` is the thin React glue over them. Nothing here
// touches keys, sockets, ipcRenderer, or raw frames — it only subscribes through the preload bridge and
// dispatches an already-typed event.
//
// SECURITY: `model` and, INSIDE the three inventories, each row's `name`, `server_name`, `path` and
// `type` are UNTRUSTED, model- or workspace-authored text held verbatim. This slice has no DOM sink, so
// the inert-text rendering discipline is inherited by #1421 / #1254; `reportedContextStore`'s
// `ReportedContextReading` docblock states the per-row prohibitions in full, and this module adds no
// new sink of any kind. NOTHING ON THIS PATH IS EVER LOGGED, on any branch: a `server_name` discloses
// what the operator wired up and a `path` discloses who the user is and where they work — and a POSIX
// path may legitimately contain the newline that would forge a record in the line-delimited diagnostic
// stream.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { reportedContextStore, type ReportedContextSnapshot } from './reportedContextStore'

/**
 * The filter: map the one owned arm to its reading, every other DaemonEvent to `null`. A FRESH
 * named-field literal (the announcedModelBridge idiom — never `return event`, never a spread) so `type`
 * never reaches the store and the store shape stays immune to the `contextUsage` arm gaining an
 * unrelated field later; `daemonConnection`'s emit already made the identical call one layer up.
 *
 * ALL ELEVEN CARRIED FIELDS GO ACROSS VERBATIM. No string is normalised, trimmed, lowercased,
 * allow-listed or shape-checked; no figure is read, clamped or reconciled against another; and the
 * three inventories cross BY REFERENCE, neither sliced, sorted, filtered nor de-duplicated — the rows
 * arrive as a prefix in the producer's descending-token order, which is the only ordering signal a
 * consumer gets. The `conversationId` is carried verbatim too — not normalised, allow-listed, or
 * checked against the open conversation, because an id matching no selectable conversation must be an
 * explicit no-match downstream, never a `?? activeConversation` fallback.
 *
 * The arm carries no truncation marker to drop: every one of the eleven fields has a consumer in #1420
 * / #1421 / #1254, so unlike `rateLimited` nothing is left behind here.
 *
 * `default: null` — not an `assertNever` — because ignoring the rest is this path's intended, permanent
 * behaviour: it is an independent subscriber, not one of the four typecheck-gating exhaustive bridges.
 * `null` here means "not our arm", NEVER "bad data": a malformed payload is already rejected upstream,
 * where the #1454 / #1455 / #1459 / #1460 narrowers throw WireDecodeError inside daemonConnection's
 * decode guard and no event is emitted at all. React-free → unit-testable without a DOM.
 */
export function translateContextUsage(event: DaemonEvent): ReportedContextSnapshot | null {
  switch (event.type) {
    case 'contextUsage':
      return {
        conversationId: event.conversationId,
        model: event.model,
        totalTokens: event.totalTokens,
        maxTokens: event.maxTokens,
        percentage: event.percentage,
        categories: event.categories,
        droppedCategories: event.droppedCategories,
        mcpTools: event.mcpTools,
        droppedMcpTools: event.droppedMcpTools,
        memoryFiles: event.memoryFiles,
        droppedMemoryFiles: event.droppedMemoryFiles
      }
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each `contextUsage` reaches the store's one write and
 * every unrelated event no-ops. Returns the unsubscribe handle (the daemonEventBridge off-handle
 * idiom) so the React binding can use it as its effect cleanup.
 *
 * THE `reading !== null` GUARD IS ON THE SNAPSHOT'S PRESENCE, NEVER ON CONTENT. Nothing here inspects a
 * figure, a string or a row count, so a reading whose `model` is empty, whose inventories are empty and
 * whose `percentage` is `0` is recorded exactly like any other — a present-but-empty reading is a real
 * one the daemon emitted, and the store keeps it distinct from an absent key. A VERBATIM REPEAT and a
 * FALL are both written rather than coalesced: the daemon fans this out after every turn end, so a
 * repeat is the report that the reading is current and a fall is what a `/clear` or a compaction looks
 * like.
 *
 * There is deliberately no guard on the `conversationId` either — an unrecognised id is written under
 * its own key and read by nothing, which is a stronger no-match than a filter here could be, and the
 * only list this bridge could check against is one it has no business subscribing to. The listener only
 * translates + dispatches; it never throws into React and nothing here is logged.
 */
export function subscribeReportedContext(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setReportedContext: (snapshot: ReportedContextSnapshot) => void
): () => void {
  return onDaemonEvent((event) => {
    const reading = translateContextUsage(event)
    if (reading === null) return
    setReportedContext(reading)
  })
}

/**
 * The reported-context data-path binding — a headless component mounted app-level in App.tsx alongside
 * UsageLimitData: one stable, app-lifetime listener with no subscribe/unsubscribe churn as the route
 * flips. The App-level rationale is the one its keyed neighbours carry, sharpened by WHEN the daemon
 * sends: the frame is fanned out after EVERY turn end for whichever conversation ran, which may be one
 * the operator has never opened, and a reading can arrive long before #1421's footer is ever mounted,
 * so a screen-scoped listener would miss exactly the case this store exists for.
 *
 * No `connected` branch, for AnnouncedModelData's reason and a load-bearing one of its own: after a
 * reconnect to the same daemon the window is whatever claude last reported, that conversation's next
 * turn end re-reports it, and there is no request half that could re-fetch a reading blanked at that
 * edge. Its pairing-scoped clear is `clearPairingScopedState`'s, not this leaf's.
 *
 * A component (not a hook) isolates the subscription in its own leaf so it never cascades a re-render
 * into App; it renders nothing. `window.pyry` is dereferenced only inside the effect, never during
 * render, so it server-renders to `''` without a bridge mock (the QueueData invariant). Reactive-only:
 * one subscribe effect, no request effect, no useState/useRef/useSessionStore. Ships dormant — it
 * populates the store, but nothing renders it yet (#1421, #1254).
 */
export function ReportedContextData(): null {
  useEffect(() => {
    // Subscribe on mount; the returned off handle is the effect cleanup, so a StrictMode double-mount
    // nets exactly one live listener (the announcedModelBridge idiom). Each reading reaches the
    // app-singleton store through its one event-driven mutation.
    return subscribeReportedContext(window.pyry.onDaemonEvent, (reading) =>
      reportedContextStore.getState().setReportedContext(reading)
    )
  }, [])

  return null
}
