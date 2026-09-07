// The renderer data path for the system-prompt WRITE machine (#1250) — framework-free helpers plus one
// headless App-level component, mirroring `runSettingsWriteBridge.ts`. It is BIDIRECTIONAL, where the
// read twin `systemPromptBridge.ts` is inbound-only: an OUTBOUND submit helper (record the in-flight
// marker → send the `setSystemPrompt` command) and an INBOUND path (observe the two correlated
// outcomes, plus the reconnect edge that strands them, and fold them into the store). The helpers are
// React-free and injected, so the whole path is unit-testable with plain spies; `SystemPromptWriteData`
// is the thin React glue over the inbound half.
//
// Nothing here touches keys, sockets, ipcRenderer or raw frames: it subscribes through the preload
// bridge and sends one already-typed command. NOTHING HERE IS EVER LOGGED, on any branch — see the
// store's header. The two places a diagnostic gets reached for are the falsy-id guard in
// `submitSystemPrompt` and the store's fail-closed no-op, and the only fields either could carry to be
// useful are the conversation id and the prompt, both forbidden.
//
// SECURITY — the operator's prompt passes THROUGH this file and is retained nowhere in it. It is a
// parameter to `submitSystemPrompt`, copied verbatim into one fresh command literal, and the
// `writeSubmitted` event it dispatches has no field to hold it. `conversationId` is a routing key and a
// payload value only: never a lookup path, a cache key, a filename, an attribute, a URL or a React key
// — the one index on it is the store's `Map`.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import type { RendererCommand } from '@shared/ipc/commands'
import { systemPromptWriteStore, type SystemPromptWriteEvent } from './systemPromptWriteStore'

export type { SystemPromptWriteEvent }

/**
 * The inbound filter: map each owned daemon event to its store event, every other `DaemonEvent` to
 * `null`. Each arm returns a FRESH named-field literal (the `translateSystemPrompt` idiom — never
 * `return event`, never a spread), which is load-bearing rather than stylistic: a spread would carry
 * the arm's `type` tag into a union whose `type` means something else entirely.
 *
 * `default: null` — NOT an `assertNever` — and here that is the SECURITY DECISION rather than a style
 * choice, for the read bridge's reason applied to a filter that declines the read arm. An `assertNever`
 * guard `JSON.stringify`s the WHOLE event into an `Error` message, and the events this filter declines
 * include `systemPromptReceived`, whose `systemPrompt` is untrusted, operator-authored, network-relayed
 * text. `null` means "NOT OUR ARM", never "bad data": a malformed payload is already rejected upstream
 * inside the decode guard, where no event is emitted at all. A rename of an owned arm is still caught —
 * a `case` label that no longer overlaps the union is a type error.
 *
 * `connected` and not `disconnected`, which is emitted nowhere in `src/main` (the `translateWriteEvent`
 * precedent). Its `ack` is ignored: the clear needs no field off it. React-free → unit-testable without
 * a DOM.
 */
export function translateSystemPromptWriteEvent(event: DaemonEvent): SystemPromptWriteEvent | null {
  switch (event.type) {
    case 'systemPromptWriteConfirmed':
      return { type: 'writeConfirmed', conversationId: event.conversationId }
    case 'systemPromptWriteRejected':
      return { type: 'writeRejected', conversationId: event.conversationId, reason: event.reason }
    case 'connected':
      // The reconnect edge. Main abandons its `set_system_prompt` write correlation on every re-dial
      // and emits nothing in its place, so an in-flight write's outcome can never arrive; left alone
      // the marker strands and reports a write as permanently saving.
      return { type: 'reconnected' }
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each owned event runs through the filter and a non-null
 * result is dispatched into the store; every unrelated event no-ops. Returns the unsubscribe handle
 * (the `daemonEventBridge` off-handle idiom) so the React binding can use it as its effect cleanup —
 * the whole cancellation path for this slice, since nothing here starts a promise, a timer or an
 * interval.
 *
 * DELIBERATELY UNGATED, which is where this diverges from its read twin `subscribeSystemPrompt`. That
 * one compares the reply's `conversationId` against the open conversation before writing, because its
 * store is a single slot scoped to the open chat and an unattributed reply would land under whichever
 * chat happened to be open. This store is KEYED by conversation id, so an outcome naming a conversation
 * with nothing in flight settles nothing by construction — the keyed store IS the attribution, and a
 * gate here would give one decision two implementations. It would also be actively wrong in one case:
 * an outcome for a write the operator is still waiting on would be dropped for the window between the
 * outcome arriving and the conversation seam clearing.
 *
 * The listener only translates + dispatches — it never throws into React, and it logs nothing.
 */
export function subscribeSystemPromptWrite(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  dispatch: (event: SystemPromptWriteEvent) => void
): () => void {
  return onDaemonEvent((event) => {
    const writeEvent = translateSystemPromptWriteEvent(event)
    if (writeEvent !== null) dispatch(writeEvent)
  })
}

/**
 * The effects `submitSystemPrompt` performs, injected so the helper stays pure and deterministic in
 * tests (the `SubmitSettingsChangeDeps` shape). There is no id to mint: this verb correlates on the
 * conversation id, so unlike `submitSettingsChange` there is no `mintChangeId` seam and nothing here
 * may add one.
 */
export interface SubmitSystemPromptDeps {
  sendCommand: (command: RendererCommand) => void
  dispatch: (event: SystemPromptWriteEvent) => void
}

/**
 * Submit one system-prompt write for `conversationId` (#1078 calls this). It (1) records the in-flight
 * marker, then (2) sends exactly one `setSystemPrompt` command. Fire-and-forget like the composer's
 * send: `sendCommand` is `void`, so there is nothing to await and nothing to cancel.
 *
 * RECORD BEFORE SEND, and it is pinned by a named test. `prompt-too-long` is THIS CLIENT'S OWN verdict,
 * raised inside main's `setSystemPrompt` before the connected guard and before any frame is built, and
 * it arrives on the same event path as a daemon refusal and much sooner. A send placed first could draw
 * a refusal with no marker to settle, which the store would fail-closed into a no-op — leaving the
 * operator's over-length save silently unreported. Nothing here re-implements that byte bound: a second
 * authority could only disagree with the first, and showing the limit before it is hit is #1078's.
 *
 * THE TRI-STATE CROSSES VERBATIM. `systemPrompt` is typed `string | null` and copied straight into the
 * payload: `null` CLEARS, `''` stores an explicitly empty prompt, any other string stores that text.
 * There is deliberately no `?? ''`, no `|| null` and no truthiness read — each collapses two of the
 * three states into one and makes the clear path unreachable, with no type error and no failing test
 * unless one is written for it. Three are.
 *
 * A FALSY CONVERSATION ID SENDS NOTHING AND RECORDS NOTHING — `requestSystemPrompt`'s guard, sharpened
 * by this verb's asymmetry. An unaddressable id is refused by the routing lookup at the IPC arm, so no
 * frame is built and NO OUTCOME EVER ARRIVES; a marker recorded for one would report a save as in
 * flight until a reconnect swept it. Refusing both halves together is what keeps the store from holding
 * a write that cannot exist. `''` takes the same branch as any other falsy id — one failure spelled
 * differently, not a second case.
 *
 * The payload is a FRESH two-field literal, never a spread of a caller's object, so nothing can widen
 * the wire surface from the renderer. The id is a payload VALUE here and a `Map` key in the store;
 * never a path, a filename, a cache lookup or a log field, and nothing on either branch logs at all.
 */
export function submitSystemPrompt(
  deps: SubmitSystemPromptDeps,
  conversationId: string,
  systemPrompt: string | null
): void {
  if (!conversationId) return
  deps.dispatch({ type: 'writeSubmitted', conversationId })
  deps.sendCommand({
    type: 'setSystemPrompt',
    payload: { conversation_id: conversationId, system_prompt: systemPrompt }
  })
}

/**
 * The write machine's inbound data-path binding — a headless component mounted app-level in App.tsx,
 * beside `SystemPromptData`: one stable, app-lifetime listener, for `RunSettingsWriteData`'s reason
 * restated for this verb. An outcome can arrive AFTER the editor surface (#1078) closes — a
 * surface-scoped listener would miss it and strand the marker — and that rationale covers the
 * `connected` clear for free, since the reconnect edge fires whether or not the editor is open.
 *
 * A component (not a hook) isolates the subscription in its own leaf so it never cascades a re-render
 * into App; it renders nothing. `window.pyry` is dereferenced only INSIDE the effect, never during
 * render, so it server-renders to `''` without a bridge stub (the invariant App.test's no-window-stub
 * `<App/>` render depends on).
 *
 * REACTIVE-ONLY. There is no request effect and no `connected`-edge send: the outbound half is
 * `submitSystemPrompt`, called from the editor surface — the only place the value to write is known —
 * never from this mount, and it is never a retry.
 */
export function SystemPromptWriteData(): null {
  useEffect(() => {
    // Subscribe on mount; the returned off handle is the effect cleanup, so a StrictMode double-mount
    // nets exactly one live listener and window teardown removes it. `getState()` is read PER EVENT
    // through the arrow rather than captured at subscription — this listener is app-lifetime, so a
    // captured `dispatch` would be fine today but the arrow keeps the leaf's shape identical to its
    // neighbours'.
    return subscribeSystemPromptWrite(window.pyry.onDaemonEvent, (event) =>
      systemPromptWriteStore.getState().dispatch(event)
    )
  }, [])

  return null
}
