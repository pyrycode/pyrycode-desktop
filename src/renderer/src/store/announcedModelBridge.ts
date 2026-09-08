// The renderer data path feeding the announced-model store: it observes the typed `modelAnnounced`
// daemon event (#587's transport half decodes claude's `system` / `init` line into `model` +
// `truncated` and emits it) and lands each announcement in the app-singleton `announcedModelStore` the
// run-configuration sheet (#560) reads. Reactive-only — like sessionIdBridge (#259) / queueBridge
// (#293) and unlike conversationListBridge (#208) / runConfigSnapshot
// (#187), the daemon PUSHES the announcement unsolicited, so there is NO request half: no command
// sent, no connected-edge trigger (the trigger is the turn's init line).
//
// A FOURTH OBSERVER, not a new arm on an existing bridge. All three exhaustive bridges keep their
// `modelAnnounced` no-op PERMANENTLY (daemonEventBridge.ts:150, modalBridge.ts:101,
// timelineBridge.ts:161) — each is present only so the `assertNever` guard makes a NEW arm a compile
// error — so this is the sessionIdBridge / backgroundTaskRosterBridge shape (an independent
// subscriber), NOT the #493 shape where `apiRetry` folded into timelineBridge's owned arm. Nothing in
// those three changes behaviour.
//
// The two helpers are React-free and injected, so the whole path is unit-testable with plain spies (the
// sessionIdBridge idiom); `AnnouncedModelData` is the thin React glue over them. Nothing here touches
// keys, sockets, ipcRenderer, or raw frames — it only subscribes through the preload bridge and
// dispatches an already-typed event; `model` is UNTRUSTED, model-influenced daemon-relayed text held
// verbatim, and this slice has no DOM sink (the plain-text-never-HTML discipline is inherited by #560).
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { announcedModelStore, type AnnouncedModelSnapshot } from './announcedModelStore'

/**
 * The filter: map the one owned arm to its announcement, every other DaemonEvent to `null`. A FRESH
 * named-field literal (the queueBridge idiom — never `return event`, never a spread) so `type` never
 * reaches the store and the store shape stays immune to the `modelAnnounced` arm gaining an unrelated
 * field later; `daemonConnection`'s emit already made the identical call one layer up.
 *
 * #1146 WIDENED that literal to carry `conversationId`, which this function used to drop on purpose.
 * The event has carried it since #714, REQUIRED and never optional, and dropping it here is exactly what
 * made the store one app-wide slot that showed the wrong server's model. Widening the literal — rather
 * than switching to a spread now that the shapes happen to match — is what keeps `type` out and keeps a
 * later field on the arm from smuggling itself across. The id is carried VERBATIM: it is not normalised,
 * allow-listed, or checked against the open conversation, because an id matching no selectable
 * conversation must be an explicit no-match downstream, never a `?? activeConversation` fallback.
 *
 * `default: null` — not an `assertNever` — because ignoring the rest is this path's intended, permanent
 * behavior: it is an independent subscriber (the sessionIdBridge / queueBridge posture), not one of the
 * three typecheck-gating exhaustive bridges. `null` here means "not our arm", NEVER "bad data": a
 * malformed payload is already rejected upstream, where #587's decoder throws WireDecodeError inside
 * daemonConnection's decode guard and no event is emitted at all. React-free → unit-testable without a
 * DOM. The other `model`-carrying arm it must NOT pick up is `runConfigReceived`, whose `model` is
 * the per-session OVERRIDE — the opposite value (see the `modelAnnounced` arm's doc in events.ts).
 */
export function translateModelAnnounced(event: DaemonEvent): AnnouncedModelSnapshot | null {
  switch (event.type) {
    case 'modelAnnounced':
      return {
        model: event.model,
        truncated: event.truncated,
        conversationId: event.conversationId
      }
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each `modelAnnounced` writes its announcement into the
 * store via `setAnnouncedModel`, under the conversation the event named; every unrelated event no-ops.
 * Returns the unsubscribe handle (the daemonEventBridge off-handle idiom) so the React binding can use
 * it as its effect cleanup. The `announced !== null` guard (not `if (announced)` and emphatically not
 * `if (announced?.model)`) is deliberate: it mirrors sessionIdBridge's `id !== null` — the guard is on
 * the SNAPSHOT's presence, never on the `model` content, so a `{ model: '', truncated }` announcement
 * still writes, carrying its truncation report with it. A content guard would drop all three fields.
 * There is deliberately no guard on the `conversationId` either: an unrecognised id is written under its
 * own key and read by nothing, which is a stronger no-match than a filter here could be, and the only
 * list this bridge could check against is one it has no business subscribing to.
 * The listener only translates + dispatches — it never throws into React.
 */
export function subscribeAnnouncedModel(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setAnnouncedModel: (snapshot: AnnouncedModelSnapshot) => void
): () => void {
  return onDaemonEvent((event) => {
    const announced = translateModelAnnounced(event)
    if (announced !== null) setAnnouncedModel(announced)
  })
}

/**
 * The announced-model data-path binding — a headless component mounted app-level in App.tsx, alongside
 * QueueData: one stable, app-lifetime listener with no subscribe/unsubscribe churn as the
 * route flips, because a `modelAnnounced` announcement rides the turn's init line and can arrive at any
 * time — including before the run-configuration sheet (#560) is ever opened — so the latest
 * announcement must be retained regardless of which screen is shown. A component (not a hook) isolates
 * the subscription in its own leaf so it never cascades a re-render into App; it renders nothing.
 * `window.pyry` is dereferenced only inside the effect, never during render, so it server-renders to
 * `''` without a bridge mock (the QueueData invariant). Reactive-only: one subscribe effect, no request
 * effect, no useState/useRef/useSessionStore. Ships dormant — it populates the store, but nothing
 * renders it yet (#560).
 */
export function AnnouncedModelData(): null {
  useEffect(() => {
    // Subscribe on mount; the returned off handle is the effect cleanup, so a StrictMode double-mount
    // nets exactly one live listener (the sessionIdBridge idiom). Each modelAnnounced writes its
    // announcement into the app-singleton store via its setter.
    return subscribeAnnouncedModel(window.pyry.onDaemonEvent, (announced) =>
      announcedModelStore.getState().setAnnouncedModel(announced)
    )
  }, [])

  return null
}
