// The renderer data path feeding the system-prompt store (#1231): it fires the ask when a conversation
// is activated, observes the typed `systemPromptReceived` daemon event (#1230 carries across IPC what
// its fail-closed decode made of the `system_prompt` frame — the stored prompt and whether the running
// session was started with a different one), and lands the reply in the app-singleton
// `systemPromptStore` that the editor surface (#1078) will read. Ships dormant: it populates the store,
// but nothing renders it yet.
//
// REPLY-ONLY, WHICH IS WHY THE REQUEST HALF IS NOT OPTIONAL HERE. `slashCommandListBridge` and
// `modelListBridge` receive pushed frames and gained an ask only later (#1166); this arm has no pushed
// half at all — with no ask the event never fires. `requestSystemPrompt` below is therefore the whole
// ingress, fired ONE SHOT PER ACTIVATION from `PairedShell`'s `requestConversationConfig`, and from
// nowhere else. It is NOT A RETRY and must never become one: a client-side retry against a relay that
// withholds the frame is a self-inflicted spin driven by an on-path relay. There is deliberately no
// `connected`-edge refresh and no turn-end refresh — the ask fires on activation and nowhere else, and
// a consumer must never BLOCK on this frame.
//
// A FIFTH INDEPENDENT SUBSCRIBER, NOT A SIXTH EXHAUSTIVE SWITCH. The four exhaustive bridges
// (`routeDaemonEvent`, `timelineWriteTarget`, `translateModalEvent`, `translateQuestionEvent`) took
// their `systemPromptReceived` no-op arms in #1230 and keep them permanently — each exists only so the
// `assertNever` guard makes a NEW arm a compile error. This is the `announcedModelBridge` /
// `modelListBridge` posture instead: an independent observer with a `default: null` filter.
//
// SECURITY — the `default: null` IS THE SECURITY DECISION, not a style choice. An `assertNever` guard
// `JSON.stringify`s the WHOLE event into an `Error` message, which for THIS arm is the operator's
// prompt text: untrusted, operator-authored, network-relayed text into an exception whose message can
// reach a console or a crash path. That is also why removing one of the four bridges' explicit arms
// would be a security regression rather than a tidy-up.
//
// `systemPrompt` is untrusted operator-authored text; `sessionPromptStatus` and `conversationId` are
// CLIENT-OWNED (the status narrowed at decode against constants, the id resolved in the background
// process from the request this app itself sent — never a string parsed off the network). This path
// copies named fields and INTERPRETS NONE OF THEM: no parse, no normalisation, no truthiness read, no
// `JSON.parse`. NOTHING HERE IS EVER LOGGED — there is deliberately no "dropped an unrelated reply" or
// "no conversation open" diagnostic, and the property has to be total to be worth anything. The
// inert-plain-text render obligation binds #1078. Nothing here touches keys, sockets, ipcRenderer or
// raw frames: it subscribes through the preload bridge, dispatches an already-typed value, and hands
// one validated string to `sendCommand`.
import { useEffect } from 'react'
import type { RendererCommand } from '@shared/ipc/commands'
import type { DaemonEvent } from '@shared/ipc/events'
import { activeConversationStore } from './activeConversationStore'
import { systemPromptStore, type SystemPromptReading } from './systemPromptStore'

/**
 * The filter: map the one owned arm to its reading, every other DaemonEvent to `null`. A FRESH
 * named-field literal (the `translateModelList` / `queueBridge` idiom — never `return event`, never a
 * spread), which is load-bearing rather than stylistic: a spread would carry the arm's `type` tag AND
 * its `conversationId` routing key into a write unit that never agreed to hold either, putting an id
 * into a store whose whole scope is "the chat that is currently open".
 *
 * UNCONDITIONAL, and the tri-state crosses INTACT. There is deliberately no `if (!event.systemPrompt)`
 * and no `?? ''`: an ABSENT prompt (`undefined`) is a positive statement that no prompt is stored, an
 * EMPTY one (`''`) is a positive statement that an explicitly empty prompt IS stored, and collapsing
 * either into the other makes the value unwritable back through `set_system_prompt` — with no type
 * error and no failing test unless one is written for it. `sessionPromptStatus` copies across
 * independently and is never derived from the prompt, nor the prompt from it.
 *
 * `default: null` — not an `assertNever` — because ignoring the rest is this path's intended, permanent
 * behaviour, AND because it is the safer default here (see the file header: an `assertNever` would
 * stringify the operator's prompt into an `Error`). `null` means "NOT OUR ARM", NEVER "bad data": a
 * malformed payload is already rejected upstream, where the fail-closed decode throws inside
 * `daemonConnection`'s decode guard and no event is emitted at all. React-free → unit-testable without
 * a DOM.
 */
export function translateSystemPrompt(event: DaemonEvent): SystemPromptReading | null {
  switch (event.type) {
    case 'systemPromptReceived':
      return {
        systemPrompt: event.systemPrompt,
        sessionPromptStatus: event.sessionPromptStatus
      }
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each `systemPromptReceived` DESCRIBING THE OPEN
 * CONVERSATION writes its reading into the store via `setReading`; every unrelated event, and every
 * reply describing any other conversation, no-ops. Returns the unsubscribe handle (the
 * daemonEventBridge off-handle idiom) so the React binding can use it as its effect cleanup — the whole
 * cancellation path for this slice, since nothing here starts a promise, a timer or an interval.
 *
 * ATTRIBUTION-GATED, which is AC4 and is `subscribeRunConfig`'s gate verbatim. The store is an
 * app-singleton scoped to the open chat, so without the gate a reply still in flight when the operator
 * switched chats would land under whichever conversation was open when it arrived — showing chat A's
 * system prompt against chat B's thread, and (once #1078 lands) offering it for edit. The reply's
 * `conversationId` is CLIENT-OWNED, resolved in the background process from the request this app itself
 * sent, so this comparison is against this client's own state on both sides.
 *
 * The gate runs on the RAW EVENT, before the translator, and returns before the setter — never a
 * partial write and never a `?? activeConversation` fallback. `translateSystemPrompt` stays a pure
 * `DaemonEvent → value | null` mapper: widening it to take the open id would give one decision two
 * implementations and make the mapper impure, which is the arrangement `subscribeRunConfig` documents.
 *
 * `getOpenConversationId` IS CALLED PER EVENT, INSIDE THE LISTENER, never resolved once at subscription.
 * That is the whole of the correctness argument: this listener is app-lifetime (it lives in
 * `SystemPromptData`, mounted in App.tsx), so an id captured in a closure would freeze at whatever was
 * open when the leaf mounted and reinstate the defect in a new shape. It would also compile and pass
 * every single-event test, which is why there is a test that emits twice across a moving getter.
 *
 * `null` — nothing open — matches no reply, since the resolved id is always a string. A reply arriving
 * with no conversation open therefore lands NOWHERE rather than latching until one opens.
 *
 * Three parameters, two of them functions, and NO named-deps object — and that argument is re-run here
 * rather than inherited, per `subscribeRunConfig`'s own instruction. Exchanging `setReading` and
 * `getOpenConversationId` AS A PAIR is a compile error, because `(reading: SystemPromptReading) => void`
 * is not assignable to `() => string | null` (`void` is not `string | null`). The reverse direction
 * alone does compile — TypeScript permits fewer parameters, and any return type satisfies `void` — so
 * the property that holds is about the PAIR, not about either slot on its own. Re-run this before
 * adding a fourth parameter.
 *
 * The listener only translates + dispatches — it never throws into React, and it logs nothing.
 */
export function subscribeSystemPrompt(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setReading: (reading: SystemPromptReading) => void,
  getOpenConversationId: () => string | null
): () => void {
  return onDaemonEvent((event) => {
    if (event.type === 'systemPromptReceived' && event.conversationId !== getOpenConversationId())
      return
    const reading = translateSystemPrompt(event)
    if (reading !== null) setReading(reading)
  })
}

/**
 * Fire exactly one `requestSystemPrompt` naming `conversationId` — or, when there is no addressable
 * conversation, fire NOTHING (AC1). The `requestModelList` / `requestRunConfigSnapshot` twin,
 * deliberately faithful to both down to the falsy guard, because all three go out together on every
 * activation and a reader meeting one should find the others identical.
 *
 * THE GUARD MATTERS MORE HERE THAN IT DOES FOR EITHER TWIN, and the reason is this verb's one
 * divergence: IT HAS NO ERROR FRAME AT ALL. Its neighbours answer an unresolvable id visibly — a
 * `conversation.not_found` on `request_model_list`, a zero-valued reply on `request_session_settings` —
 * whereas an unroutable id here draws an ORDINARY-LOOKING `no_session` reply with an absent prompt,
 * which the correlation map would file against a real conversation as a false "no prompt, no session"
 * reading that nothing downstream can tell from a true one. The ENFORCING half is the routing lookup at
 * the IPC arm (`router.route(id)?.…`, landed with #1230), which refuses far more than emptiness; this
 * guard is what keeps a bare send from reaching it. `''` takes the same branch as `null` under one
 * falsy check — it is the same failure spelled differently, not a second case. The IPC-boundary guard
 * (`isRequestSystemPromptPayload`) deliberately still ACCEPTS `''`: it is a structural type check,
 * while refusing to send an unaddressable id is a behavioural decision that belongs here, where a spy
 * can reach it. No renderer spec in this repo can run an effect, so a helper like this is the only
 * place the activation seam's decision is provable.
 *
 * A FRESH one-field literal, never a spread of a caller's object — the same bound
 * `buildRequestSystemPrompt` keeps on the wire side, held here too so nothing can widen the payload
 * from the renderer. The id is a client-held conversation id used as a payload VALUE only: never a key,
 * a path, a filename, a cache lookup or a log field, and nothing on this branch logs at all.
 *
 * Fire-and-forget, like the composer's send: `sendCommand` is `void`, so there is no result to await,
 * no promise, no timer and nothing to cancel. NOT A RETRY — see this file's header.
 */
export function requestSystemPrompt(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string | null
): void {
  if (!conversationId) return
  sendCommand({ type: 'requestSystemPrompt', payload: { conversation_id: conversationId } })
}

/**
 * The system-prompt data-path binding — a headless component mounted app-level in App.tsx as the
 * twelfth leaf, beside `RunConfigLiveData`: one stable, app-lifetime listener with no
 * subscribe/unsubscribe churn as the route flips.
 *
 * App-level is load-bearing rather than conventional, with a sharpening specific to this arm. Its
 * pushed-frame neighbours are mounted here because a frame can arrive for a conversation the operator
 * has NEVER OPENED; this one cannot — the reply answers an ask fired from the activation seam. What it
 * shares is the other half: a reply can land AFTER the operator has navigated on, so a screen-scoped
 * listener would unmount before the reply the gate above exists to adjudicate ever arrives, and the
 * drop would be silent. A component (not a hook) isolates the subscription in its own leaf so it never
 * cascades a re-render into App; it renders nothing.
 *
 * REACTIVE-ONLY. There is no request effect, no `connected` gate, no `useState`/`useRef`/
 * `useSessionStore` — #1231's ask fires from the conversation-activation path, the only place the
 * conversation to name is known, so this leaf stays a pure receiver. `window.pyry` is dereferenced only
 * inside the effect, never during render, so it server-renders to `''` without a bridge mock (the
 * QueueData / ModelListData invariant, which App.test's no-window-stub `<App/>` render depends on).
 */
export function SystemPromptData(): null {
  useEffect(() => {
    // Subscribe on mount; the returned off handle is the effect cleanup, so a StrictMode double-mount
    // nets exactly one live listener (the announcedModelBridge idiom) and window teardown removes it.
    //
    // The open conversation is read non-reactively, at call time, through the arrow below — the
    // `RunConfigLiveData` shape verbatim — so this leaf still subscribes to nothing and the store is
    // touched only when a reply arrives, never during render. `?? null` is the fail-closed spelling of
    // the two in the tree: an id of `''` then matches no reply, and no daemon-supplied conversation id
    // can be `''` anyway, since `requestSystemPrompt` above refuses to send one.
    return subscribeSystemPrompt(
      window.pyry.onDaemonEvent,
      (reading) => systemPromptStore.getState().setReading(reading),
      () => activeConversationStore.getState().activeConversation?.id ?? null
    )
  }, [])

  return null
}
