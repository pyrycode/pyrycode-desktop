// The renderer data path feeding the model-list store: it observes the typed `modelList` daemon event
// (#973 carries across IPC what #972 decoded fail-closed from the `model_list` frame — one conversation
// id, the published rows, and the frame's drop count) and lands each frame in the app-singleton
// `modelListStore` that the run-configuration sheet's model rows (#975) and effort segments (#976), the
// input footer's model and effort menus (#683), and the permission-mode menu (#682) will read.
// The daemon PUSHES the list unsolicited from a conversation's `initialize` reply and in the
// connect-time reconcile, the way announcedModelBridge (#588), backgroundTaskRosterBridge (#573) and
// slashCommandListBridge (#954) receive theirs. Until #1166 that was the WHOLE path, and this header said
// so in a sentence THIS SLICE RETRACTS: "no command sent, no connected-edge fetch, and none may be
// added". Half of it survives; read the next two paragraphs before quoting any of it.
//
// THERE IS NOW A REQUEST HALF, AND IT IS `requestModelList` BELOW (#1166). pyrycode#2125 gave the daemon
// a `request_model_list` verb, #1165 built the command and its main-process lane, and this slice fires it
// on conversation activation — because a chat created after this app connected crosses neither delivery
// edge and would otherwise hold no list at all. It is ONE SHOT PER ACTIVATION, fired from the activation
// path and from nowhere else.
//
// WHAT DID NOT CHANGE, and it is most of it. A one-shot ask on open is not a retry, and the no-retry rule
// stands unaltered: nothing here re-asks because a frame failed to arrive, because a client-side retry
// against a relay that withholds it is a self-inflicted spin driven by an on-path relay. Delivery is
// still best-effort, so a conversation that never receives a list is still a normal, permanent state that
// the store reports as `null` — never a spinner — and no consumer may BLOCK a model menu on this frame.
// There is still NO connected-edge fetch: the ask is per-conversation, so a daemon-wide edge has no one
// conversation to name.
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
// The three helpers are React-free and injected, so the whole path is unit-testable with plain spies (the
// announcedModelBridge idiom); `ModelListData` is the thin React glue over the two receiving ones, and
// deliberately does NOT mount the sender — this leaf stays reactive-only, and the ask belongs where the
// conversation being opened is known. Nothing here touches keys, sockets, ipcRenderer, or raw frames — it
// subscribes through the preload bridge, dispatches an already-typed event, and hands one validated
// string to `sendCommand`.
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
import type { RendererCommand } from '@shared/ipc/commands'
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
 * this store's lifetime is the opposite case on both counts, so #977 put its clear in that helper's
 * dep set instead (the #588 → #593 and #954 → #955 precedent) and none of it reaches this file. A
 * reconnect to the same daemon does not invalidate a published list, so clearing on `connected` would
 * blank a correct value — and #1166's request half does not soften that, it sharpens it: the ask is
 * per-conversation on activation, so a daemon-wide edge has nothing with which to re-assert every
 * BACKGROUND conversation's list. Keeping the clear out of here is also what keeps it daemon-UNREACHABLE: no event arriving on this subscription
 * can invoke it, so nothing the daemon says can steer which lists survive a pairing change.
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
 * Fire exactly one `requestModelList` naming `conversationId` — or, when there is no addressable
 * conversation, fire NOTHING (#1166). The `requestRunConfigSnapshot` twin, deliberately faithful to it
 * down to the falsy guard, because the two go out together on every activation and a reader meeting one
 * should find the other identical.
 *
 * `RequestModelListPayload.conversation_id` is REQUIRED end to end (#1165), so unlike the run-config
 * request there is not even an unnamed variant to fall back on: a request with no conversation to name
 * has nothing to ask about, and NOT SENDING is the whole of that branch. `''` takes the same branch as
 * `null` under one falsy check — it serialises to a frame `conversationRouter.route` can only refuse, so
 * it is the same failure spelled differently rather than a second case. The IPC-boundary guard
 * (`isRequestModelListPayload`) deliberately still ACCEPTS `''`: it is a structural type check, while
 * refusing to send an unaddressable id is a behavioural decision that belongs here, where a spy can reach
 * it. No renderer spec in this repo can run an effect, so a helper like this is the only place the
 * activation seam's decision is provable.
 *
 * A FRESH one-field literal, never a spread of a caller's object — the same bound
 * `buildRequestModelList` keeps on the wire side, held here too so nothing can widen the payload from
 * the renderer. The id is a client-held conversation id used as a payload VALUE only: never a key, a
 * path, a filename, a cache lookup or a log field, and nothing on this branch logs at all.
 *
 * Fire-and-forget, like the composer's send: `sendCommand` is `void`, so there is no result to await, no
 * promise, no timer and nothing to cancel. NOT A RETRY — see this file's header for what the no-retry
 * rule still forbids.
 */
export function requestModelList(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string | null
): void {
  if (!conversationId) return
  sendCommand({ type: 'requestModelList', payload: { conversation_id: conversationId } })
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
 * useState/useRef/useSessionStore, no connected gate — #1166's `requestModelList` fires from the
 * conversation-activation path, the only place the conversation to name is known, so this leaf stays a
 * pure receiver. Ships dormant — it populates the store, but
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
