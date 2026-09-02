// The renderer data path feeding the model-list store: it observes the typed `modelList` daemon event
// (#973 carries across IPC what #972 decoded fail-closed from the `model_list` frame — one conversation
// id, the published rows, and the frame's drop count) and lands each frame in the app-singleton
// `modelListStore` that the run-configuration sheet's model rows (#975) and effort segments (#976), the
// input footer's model and effort menus (#683), and the permission-mode menu (#682) will read.
// Reactive-only — like announcedModelBridge (#588), backgroundTaskRosterBridge (#573) and
// slashCommandListBridge (#954), and unlike conversationListBridge, the daemon PUSHES the list
// unsolicited from a conversation's `initialize` reply, so there is NO request half: no command sent,
// no connected-edge fetch, and none may be added. That is a security decision as much as an
// architectural one — a client-side retry against a relay that withholds the frame is a self-inflicted
// spin driven by an on-path relay. Delivery is best-effort, so a conversation that never receives a
// list is a normal, permanent state that the store reports as `null` — never a retry and never a
// spinner, and no consumer may BLOCK a model menu on this frame.
//
// A FIFTH OBSERVER, not a new arm on an existing bridge, which #973's arm docblock already decided.
// All four exhaustive bridges KEEP their `modelList` no-op cases permanently (`routeDaemonEvent`,
// `timelineWriteTarget`, `translateModalEvent`, `translateQuestionEvent`) — each is present only so the
// `assertNever` guard makes a NEW arm a compile error — so this is the announcedModelBridge /
// backgroundTaskRosterBridge / slashCommandListBridge shape, an independent subscriber, NOT the #493
// shape where `apiRetry` folded into timelineBridge's owned arm. Nothing in those four changes
// behaviour, and removing one would be a security regression rather than a tidy-up: those guards
// `JSON.stringify` the WHOLE event into an `Error`, so a dropped case would leak claude-authored row
// text into an error message.
//
// The two helpers are React-free and injected, so the whole path is unit-testable with plain spies (the
// announcedModelBridge idiom); `ModelListData` is the thin React glue over them. Nothing here touches
// keys, sockets, ipcRenderer, or raw frames — it only subscribes through the preload bridge and
// dispatches an already-typed event.
//
// SECURITY: the arm carries three string-typed fields per row plus every string in `effort_levels`, all
// CLAUDE-AUTHORED text that crossed the subprocess trust boundary — a HIGHER trust tier than the
// workspace-authored strings `slashCommandList` carries, not a restatement of it, and DECODED IS NOT
// SANITIZED (#972 made the shape trusted and nothing more). This path copies named fields and
// interprets none of them: no parse, no normalisation, no split of `value` to derive a family, no
// `JSON.parse`, and NOTHING IS EVER LOGGED — there is deliberately no "dropped an unrelated event" or
// "no list for this conversation" diagnostic here. That clause rests on the CONTRACT rather than on a
// measurement, unlike the sibling's measured `0x0a`: no control byte is measured in these short labels,
// but the daemon bounds and does not sanitize, so one is PERMITTED rather than excluded. The
// translator's `default: null` rather than an `assertNever` is part of the same obligation: an
// `assertNever` would stringify the event into an `Error`. The inert-plain-text render obligation binds
// #975 and #976.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { modelListStore, type ModelListSnapshot } from './modelListStore'

/**
 * The filter: map the one owned arm to its snapshot, every other DaemonEvent to `null`. A FRESH
 * named-field literal (the queueBridge / slashCommandListBridge idiom — never `return event`, never a
 * spread), which is load-bearing rather than stylistic: a spread would carry the arm's `type` tag, and
 * any field a later arm gains, into a write unit that never agreed to hold it. `models` passes through
 * BY REFERENCE — row order, row identity and snake_case preserved — because there is no per-row mapping
 * anywhere on this path, which is what keeps each row's own `truncated_fields: null` distinct from `[]`
 * and keeps `effort_levels` unnormalised by construction.
 *
 * UNCONDITIONAL — there is deliberately no `if (event.models.length === 0) return null`. An empty list
 * is a POSITIVE STATEMENT that claude offered nothing, never "no news", so it maps to a snapshot like
 * any other; see the `!== null` guard in `subscribeModelList`. `droppedModels` is copied including `0`,
 * which is a value and is never consulted for truthiness.
 *
 * `default: null` — not an `assertNever` — because ignoring the rest is this path's intended, permanent
 * behaviour: it is an independent subscriber in the announcedModelBridge posture, not one of the four
 * typecheck-gating exhaustive bridges (which already no-op this arm from #973). It is also the safer
 * default here, since an `assertNever` guard stringifies the whole event into an `Error`. `null` means
 * "NOT OUR ARM", NEVER "bad data": a malformed payload is already rejected upstream, where #972's
 * narrower throws inside `daemonConnection`'s decode guard and no event is emitted at all. The arms it
 * must NOT pick up are its structural twins `slashCommandList` and `backgroundTaskRoster`, which carry
 * the identical shape — one conversation id, a row list and a frame-level drop count — so the filter
 * switches on the DISCRIMINANT and never on field names. React-free → unit-testable without a DOM.
 */
export function translateModelList(event: DaemonEvent): ModelListSnapshot | null {
  switch (event.type) {
    case 'modelList':
      return {
        conversationId: event.conversationId,
        models: event.models,
        droppedModels: event.droppedModels
      }
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each `modelList` writes its snapshot into the store via
 * `setModelList`; every unrelated event no-ops. Returns the unsubscribe handle (the daemonEventBridge
 * off-handle idiom) so the React binding can use it as its effect cleanup — the whole cancellation path
 * for this slice, since nothing here starts a promise, a timer or an interval.
 *
 * ONE ARM IN, ONE SETTER OUT — there is deliberately no `connected` branch and no branch of any other
 * kind, which is the half of `backgroundTaskRosterBridge` this path must NOT copy. That bridge's reset
 * is the sole enforcement of ITS AC5 and is why its store is absent from `clearPairingScopedState`;
 * this store's lifetime is the opposite case on both counts, so #977 puts its clear in that helper's
 * dep set instead (the #588 → #593 and #954 → #955 precedent) and none of it reaches this file. A
 * reconnect to the same daemon does not invalidate a published list, so clearing on `connected` would
 * blank a correct value that nothing on this path can re-fetch — there is no request half. Keeping the
 * clear out of here is also what will keep it daemon-UNREACHABLE: no event arriving on this
 * subscription can invoke it, so nothing the daemon says can steer which lists survive a pairing
 * change.
 *
 * The `snapshot !== null` guard (not `if (snapshot)` and emphatically not `if (snapshot.models.length)`)
 * is deliberate: it mirrors announcedModelBridge's `announced !== null`. A snapshot object is truthy
 * even when its `models` are empty, so the way an empty list would get dropped is a `length` check at
 * the translator — which is why the translator stays unconditional and this guard stays on the RECORD's
 * presence, never on the list's contents. A content guard would drop the drop count with it. The
 * listener only translates + dispatches — it never throws into React, and it logs nothing.
 */
export function subscribeModelList(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setModelList: (snapshot: ModelListSnapshot) => void
): () => void {
  return onDaemonEvent((event) => {
    const snapshot = translateModelList(event)
    if (snapshot !== null) setModelList(snapshot)
  })
}

/**
 * The model-list data-path binding — a headless component mounted app-level in App.tsx, alongside
 * SlashCommandListData: one stable, app-lifetime listener with no subscribe/unsubscribe churn as the
 * route flips. App-level is load-bearing rather than conventional here: the daemon publishes the list
 * from a conversation's `initialize` reply, so a frame can arrive for a conversation THE OPERATOR HAS
 * NEVER OPENED and long before #975, #976, #683 or #682 is ever mounted — a screen-scoped listener
 * would miss exactly the case the store exists for, and without this mount every other criterion still
 * passes against an injected subscribe function while nothing ever writes the singleton. A component
 * (not a hook) isolates the subscription in its own leaf so it never cascades a re-render into App; it
 * renders nothing. `window.pyry` is dereferenced only inside the effect, never during render, so it
 * server-renders to `''` without a bridge mock (the QueueData invariant, which App.test's no-window-stub
 * <App/> render depends on). Reactive-only: one subscribe effect, no request effect, no
 * useState/useRef/useSessionStore, no connected gate. Ships dormant — it populates the store, but
 * nothing renders it yet (#975, #976, #683, #682).
 */
export function ModelListData(): null {
  useEffect(() => {
    // Subscribe on mount; the returned off handle is the effect cleanup, so a StrictMode double-mount
    // nets exactly one live listener (the announcedModelBridge idiom) and window teardown removes it.
    // Each frame replaces its own conversation's list and leaves every other conversation untouched.
    return subscribeModelList(window.pyry.onDaemonEvent, (snapshot) =>
      modelListStore.getState().setModelList(snapshot)
    )
  }, [])

  return null
}
