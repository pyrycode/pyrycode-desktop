// Whether a conversation's system-prompt write is still saving, saved, or refused — the window's half
// of the `set_system_prompt` verb (#1249 built the transport half). Pure renderer state: no IPC, no
// preload bridge, no transport. The data path (`systemPromptWriteBridge.ts`) submits the write, folds
// the two correlated outcomes back in, and clears the markers a reconnect stranded. NOTHING RENDERS
// IT YET — the editor surface is #1078, which reads this store and calls that submit path. Ships
// dormant, exactly as its read twin `systemPromptStore` (#1231) did.
//
// An ADJACENT dedicated store, NOT a `systemPromptStore` facet — `runSettingsWriteStore`'s two
// reasons, both of which transfer: (a) its inbound subscription is App-level always-listening, since
// an outcome can arrive after the editor surface closes, whereas the read store's whole ingress is one
// reply per activation; (b) write state ("what happened to my last save") is orthogonal to the held
// reading ("what does this conversation hold"). A REDUCER (a sealed event union + one `dispatch`)
// rather than the read twin's named setters, because every transition reads prior state: three are
// CORRELATED (an outcome is a no-op with nothing in flight) and the two lifecycle arms, though
// uncorrelated, still clear only when something is held.
//
// THE CORRELATION HANDLE IS THE CONVERSATION ID, AND THAT IS THE ONE PLACE THIS DEPARTS FROM
// `runSettingsWriteStore`. That store mints a `changeId` in the renderer and keys its `Map` by it;
// there is no per-write id here at all. The background process records each write's envelope id
// against the conversation the write named and hands that id back on the outcome, so what crosses is
// client-owned; the ack record carries an `id` of its own and is deliberately not used. The
// consequence, and it is the honest reading of the handle that exists rather than a defect to
// engineer around: TWO WRITES OUTSTANDING AGAINST THE SAME CONVERSATION ARE INDISTINGUISHABLE HERE.
// The most recent submission owns the marker, the first outcome to arrive settles it, and the second
// matches nothing. A client-minted change id was REJECTED upstream rather than deferred (see
// `docs/knowledge/features/system-prompt-write.md` § Known limitation), so nothing here may invent
// one; #1078 gates its submit on the in-flight state instead.
//
// A CONFIRMATION IS A FACT ABOUT THE WRITE, NOT A NEW VALUE. The daemon's ack is the reused
// `conversation_updated` record, which deliberately carries no prompt — it is broadcast to every
// client on the server id, so carrying the value would widen the audience for something only the
// requester asked about. There is therefore nothing to fold into a held prompt on an ack, and NOTHING
// HERE MAY WRITE AN OPTIMISTIC STORED VALUE to stand in for one. What a conversation holds is the read
// path's answer; that a saved prompt leaves the RUNNING session untouched, taking effect at its next
// spawn, is #1078's to tell the operator (`systemPromptStore`'s `sessionPromptStatus` is what it will
// say it with).
//
// SECURITY — THIS STORE IS MARKEDLY LESS SENSITIVE THAN ITS READ TWIN, AND THAT PROPERTY IS WORTH
// KEEPING RATHER THAN ERODING. Neither outcome arm carries a prompt byte or its length, so the only
// strings held here are a conversation id (a routing key) and a client-owned reason literal. The
// operator's text passes through the submit path into the command and is NOT RETAINED — the
// `writeSubmitted` event has no field to carry it, which makes that structural rather than a rule an
// implementer must remember. NOTHING ON THIS PATH IS EVER LOGGED, not even a content-free diagnostic:
// the fail-closed no-op arm below is exactly where one gets reached for, and the only two fields it
// could carry to be useful are the conversation id and the prompt. The property has to be total to be
// worth anything; a count would be the first crack.
//
// NOTHING IS PERSISTED, AND NOTHING MAY BE. `createSystemPromptWriteStore` takes no storage port, so
// there is nothing to reach. THIS STORE TAKES NO ZUSTAND MIDDLEWARE, EVER — `persist` would write this
// state to web storage where it would survive every clear below with all in-memory assertions still
// green, and `devtools` would expose it to any Redux DevTools session (#126). Neither is present; this
// sentence is what keeps a later ticket from adding one as a convenience.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { SystemPromptWriteFailure } from '@shared/ipc/events'

/** What is known about ONE conversation's most recent system-prompt write. Discriminated on `status`
 *  so `reason` exists on exactly the arm that has one — never a widened optional field that a
 *  confirmation could be read as carrying.
 *
 *  `confirmed` IS A HELD STATUS AND NOT THE ABSENCE OF A MARKER, and the reason is that the absence
 *  has to stay the fourth reading: NO WRITE IS KNOWN for this conversation. That is `systemPromptStore`'s
 *  `reading === null` argument on the write side — a surface cannot tell "saved" from "never saved"
 *  once the two collapse. It does NOT conflict with the no-optimistic-value rule above: this arm
 *  carries no prompt, no length and no text, only the fact that the daemon acknowledged the write.
 *
 *  `reason` is a CLIENT-OWNED literal on every member — narrowed at the decode boundary against
 *  constants for the two daemon conditions, and minted in the background process for
 *  `prompt-too-long`, which no daemon ever sends. No daemon string crosses on this field. All four
 *  members are NON-RETRYABLE, which is why there is no `retryable` flag and nothing here retries. */
export type SystemPromptWrite =
  | { status: 'in-flight' }
  | { status: 'confirmed' }
  | { status: 'rejected'; reason: SystemPromptWriteFailure }

/**
 * The whole write state: what is known per conversation, and nothing else.
 *
 * A `Map` KEYED BY CONVERSATION ID rather than a single slot, for two reasons. It makes AC2's "settle
 * the write they name and no other" STRUCTURAL — a lookup miss, not an equality check restated in
 * three arms — and a single slot would additionally let a submit for conversation B silently evict a
 * standing refusal for A. In practice the map holds one entry, because the conversation-lifetime seams
 * empty it on every switch; it is keyed so the property holds without depending on that.
 *
 * A `Map` AND NEVER A PLAIN OBJECT, which is the `modelListStore` guard and this field's own contract:
 * `src/shared/ipc/events.ts`'s docblock for the two outcome arms says that if a consumer indexes by
 * `conversationId`, THE INDEX IS A `Map`. A Map has no prototype chain, so `__proto__` / `constructor`
 * are ordinary keys reaching nothing. The id is client-owned on both sides here — the renderer's own
 * on submit, and on the outcome the id this app put in its own outbound frame — so no attacker-chosen
 * string reaches the key position anyway; the Map is what keeps that true if a later producer is less
 * careful.
 *
 * Exposed as `ReadonlyMap` — every arm below replaces it, none mutates in place.
 */
export interface SystemPromptWriteState {
  writes: ReadonlyMap<string, SystemPromptWrite>
}

/** The store's sealed event set on `type`. Three are conversation-scoped and correlated by
 *  `conversationId`: the outgoing user action (`writeSubmitted`) plus the two incoming daemon outcomes
 *  — `writeConfirmed` ← `systemPromptWriteConfirmed`, `writeRejected` ← `systemPromptWriteRejected`.
 *  `writeSubmitted` deliberately carries NO PROMPT FIELD (see the header's security note).
 *
 *  `reconnected` is the one CONNECTION-LIFECYCLE arm — bridge-produced from the `connected` wire edge,
 *  carrying no daemon content and correlated to nothing precisely because its job is to abandon every
 *  correlation. `conversationSwitched` is the one CONVERSATION-LIFETIME arm, dispatched by
 *  `activateConversation`, `exitActiveConversation` and the server-scoped clear rather than by any
 *  bridge; it carries nothing, because which chat is open is not a fact this store holds. */
export type SystemPromptWriteEvent =
  | { type: 'writeSubmitted'; conversationId: string }
  | { type: 'writeConfirmed'; conversationId: string }
  | { type: 'writeRejected'; conversationId: string; reason: SystemPromptWriteFailure }
  | { type: 'reconnected' }
  | { type: 'conversationSwitched' }

/** Store shape = state + the single reducer entry point (the `runSettingsWriteStore` dispatch idiom).
 *  The mutation lives here and NOT on `SystemPromptWriteState`, so the selector — typed against the
 *  state-only interface — cannot see it and `initialSystemPromptWriteState` stays assignable. */
export type SystemPromptWriteStore = SystemPromptWriteState & {
  dispatch: (event: SystemPromptWriteEvent) => void
}

export const initialSystemPromptWriteState: SystemPromptWriteState = { writes: new Map() }

/** Compile-time exhaustiveness guard. Safe to stringify HERE, unlike in the bridge's inbound filter:
 *  every member of `SystemPromptWriteEvent` is a client-owned literal or a conversation id, and no arm
 *  carries prompt text. It is unreachable in practice — a new arm without a `case` is a type error
 *  first. */
function assertNever(x: never): never {
  throw new Error(`Unhandled system-prompt-write case: ${JSON.stringify(x)}`)
}

/**
 * Replace one conversation's marker. A fresh `Map` per transition (copy-on-write, never a mutation of
 * the held one), so a subscriber that captured the previous state sees an unchanged value.
 */
function withWrite(
  state: SystemPromptWriteState,
  conversationId: string,
  write: SystemPromptWrite
): SystemPromptWriteState {
  const writes = new Map(state.writes)
  writes.set(conversationId, write)
  return { ...state, writes }
}

/**
 * The pure reducer — five arms, each pinned by a named test:
 *  - `writeSubmitted`: record `in-flight` for the named conversation, UNCONDITIONALLY. That single
 *    property gives three of AC2's clauses at once: the most recent submission owns the marker, a
 *    standing refusal survives until the next write for that conversation, and a fresh attempt
 *    supersedes the last outcome (the analogue's `error: null` on dispatch, in keyed form).
 *  - `writeConfirmed` / `writeRejected`: settle the named conversation's write ONLY IF it is currently
 *    `in-flight`; otherwise return the SAME state object. The gate covers three cases with one
 *    predicate — an outcome for a conversation with nothing in flight (AC2, fail-closed), one arriving
 *    after a conversation seam cleared the store, and a REPLAYED second outcome for a write already
 *    settled. That last one is why the gate reads `status === 'in-flight'` and not mere presence: an
 *    ungated arm would let a duplicated refusal flip a confirmed write to rejected, which is a lie
 *    about a value the daemon stored.
 *  - `reconnected`: drop every `in-flight` marker and PRESERVE the settled ones. It covers both
 *    producers of a stranded marker — the background process abandons its write correlation on every
 *    re-dial and emits nothing in its place, and a write submitted while the link was down draws no
 *    outcome ever (its `setSystemPrompt` is an inert no-op with no driver, deliberately not reported
 *    as a rejection, since nothing refused the value). A confirmed or rejected marker is still a TRUE
 *    STATEMENT after a re-dial, so this arm leaves it alone — the analogue's `reconnected` split
 *    exactly, in keyed form.
 *  - `conversationSwitched`: drop everything, settled markers included. This is the whole of what
 *    distinguishes it from `reconnected` above, and the reason is the analogue's: a reconnect abandons
 *    correlations for a chat that is STILL the one being described, while a switch changes WHICH chat
 *    is being described at all — so a standing refusal, true across a reconnect, is false across a
 *    switch.
 *
 * A no-change arm returns the SAME state object, so zustand skips the notify.
 */
function reduceSystemPromptWrite(
  state: SystemPromptWriteState,
  event: SystemPromptWriteEvent
): SystemPromptWriteState {
  switch (event.type) {
    case 'writeSubmitted':
      return withWrite(state, event.conversationId, { status: 'in-flight' })
    case 'writeConfirmed': {
      if (state.writes.get(event.conversationId)?.status !== 'in-flight') return state
      return withWrite(state, event.conversationId, { status: 'confirmed' })
    }
    case 'writeRejected': {
      if (state.writes.get(event.conversationId)?.status !== 'in-flight') return state
      return withWrite(state, event.conversationId, { status: 'rejected', reason: event.reason })
    }
    case 'reconnected': {
      // One pass: build the survivors and note whether anything was stranded. The map allocated on a
      // no-strand pass is discarded, which costs one empty-ish copy per first connect and keeps the
      // reference-identity early-out below — the property #1078's narrow-slice reads depend on.
      const writes = new Map<string, SystemPromptWrite>()
      let stranded = false
      for (const [conversationId, write] of state.writes) {
        if (write.status === 'in-flight') stranded = true
        else writes.set(conversationId, write)
      }
      if (!stranded) return state
      // Spread `state` — the conservative direction for THIS arm: an unknown future field is
      // PRESERVED by default, matching its posture of clearing only what strands. The mirror-image
      // residual: a future field that is itself in-flight-scoped must be added here by hand, since
      // TypeScript will not force it. The argument INVERTS one arm down.
      return { ...state, writes }
    }
    case 'conversationSwitched': {
      // Nothing held → the SAME reference, so a switch between two chats that never wrote anything
      // wakes no subscriber.
      if (state.writes.size === 0) return state
      // A FRESH WHOLE-STATE LITERAL, not `{ ...state, … }`, and the argument INVERTS from `reconnected`
      // directly above: every field of this store is conversation-scoped, so a literal makes a future
      // required field a COMPILE ERROR here rather than a silently-preserved value that outlives the
      // chat it described. Forcing that decision is the point. A fresh `Map` and not
      // `initialSystemPromptWriteState.writes`: aliasing the shared constant is safe today (every arm
      // copies on write) but a latent footgun for zero gain.
      return { writes: new Map() }
    }
    default:
      return assertNever(event)
  }
}

/**
 * DI-friendly, React-free store — one isolated instance per test. All mutation flows through the
 * reducer's sealed event union via `dispatch`; there is no direct setter, so no component can
 * two-way-bind into it. Nothing here coerces, validates or shape-checks: a malformed payload was
 * already rejected fail-closed upstream at the decode boundary, where no event is emitted at all.
 *
 * There is no reject branch, nothing throws on any reachable path, and NOTHING IS LOGGED (see the
 * header).
 */
export function createSystemPromptWriteStore(
  init: SystemPromptWriteState = initialSystemPromptWriteState
) {
  return createStore<SystemPromptWriteStore>((set) => ({
    ...init,
    dispatch: (event) => set((s) => reduceSystemPromptWrite(s, event))
  }))
}

/** App-wide singleton — the one source of truth the data path dispatches onto and #1078 will read. */
export const systemPromptWriteStore = createSystemPromptWriteStore()

/** Narrow-slice React binding for #1078. Exported SEPARATELY from the factory and the selector for
 *  `useSystemPromptStore`'s reason: seeding a zustand singleton is invisible to
 *  `renderToStaticMarkup`, so a renderer spec below this slice has to `vi.mock` this module and
 *  override ONLY this binding onto a per-file `createSystemPromptWriteStore()` instance, keeping
 *  `...importActual` for the selector. */
export function useSystemPromptWriteStore<T>(selector: (s: SystemPromptWriteStore) => T): T {
  return useStore(systemPromptWriteStore, selector)
}

/** The only read surface: what is known about ONE conversation's most recent write, or `null` when
 *  nothing is known about it. Curried (the `selectExclusiveConversationIdsFor` idiom) so the caller
 *  names the conversation and the inner function stays a plain state selector.
 *
 *  It returns the HELD MARKER ITSELF, never a freshly built object, so a narrow-slice subscriber is
 *  woken only when that conversation's own write actually transitions. `?? null` maps the map's miss
 *  onto a nullable return that FORCES A CONSUMER TO BRANCH — "no write is known" is a distinct fourth
 *  reading beside in flight / confirmed / rejected, and it must not be reachable by accident. */
export const selectSystemPromptWriteFor =
  (conversationId: string) =>
  (s: SystemPromptWriteState): SystemPromptWrite | null =>
    s.writes.get(conversationId) ?? null
