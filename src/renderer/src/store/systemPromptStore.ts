// The system prompt a conversation holds, and whether the running session was started with a different
// one — held as one unidirectional source of truth for the chat that is currently open. Pure renderer
// state: no IPC, no preload bridge, no transport. The data path (`systemPromptBridge.ts`) fires the ask
// when a conversation is activated and lands the correlated reply here; the editor surface (#1078) will
// read it through the selector. NOTHING RENDERS IT YET — this store ships dormant.
//
// `runConfigStore`'s structure verbatim, and deliberately so: a dedicated single-slot store scoped to
// the open chat, with the DI-factory → singleton → hook → selector shape and NAMED SETTERS rather than
// a reducer, because its two mutations ("record the reading" and "drop it") are independent whole-value
// writes that read no prior state. A reducer earns its keep where the transitions are CORRELATED; these
// are not.
//
// REPLY-ONLY, AND THAT IS THE ONE PLACE IT DIVERGES FROM ITS SIBLINGS. Unlike the pushed `modelList` /
// `slashCommandList` frames, nothing publishes `system_prompt` unsolicited: with no ask the event never
// fires at all. Two consequences. The ask on activation (#1231, in the bridge) is the whole ingress, so
// this store's value exists only for a chat the operator has actually opened. And `reading === null`
// after an activation means EITHER "still in flight" OR "never coming" — a consumer cannot tell which,
// so #1078 must not block its editor on this value. NOTHING HERE RETRIES OR SPINS: the frame rides an
// on-path relay that may withhold it, and a client-side retry against that is a self-inflicted spin.
//
// SECURITY — TWO FIELDS AT TWO DIFFERENT TRUST TIERS, and a reader must not assume one for both.
// `systemPrompt` is UNTRUSTED OPERATOR-AUTHORED TEXT relayed over the network, the most sensitive
// string on the `DaemonEvent` union after the timeline's replayed content. `sessionPromptStatus` is a
// CLIENT-OWNED literal, narrowed at the decode boundary against constants, so no daemon string crosses
// on that field at all.
//
// The deny-list for `systemPrompt` is RESTATED HERE rather than inherited by reference from the event
// arm's docblock, and that is deliberate: the arm's clause is a claim about the PREVIOUS consumer (a
// dormant no-op), while this store's consumer is a RENDERING AND EDITING surface — exactly where a
// skimmed inherited contract goes quietly false. It is a value to be rendered as inert plain text and
// edited, and nothing else: NEVER markup (no `innerHTML`, no `dangerouslySetInnerHTML`), never into an
// attribute or a URL, never a filename, a cache key, a lookup path or a React `key`. The escape,
// length-bounding and render discipline are #1078's to discharge; holding the value unchanged is this
// store's part.
//
// NOTHING ON THIS PATH IS EVER LOGGED, and there is deliberately no diagnostic anywhere in this store —
// not even a content-free one. The property has to be total to be worth anything: a count would be the
// first crack. The renderer console is readable by anything that can open DevTools (#126), and the only
// values a diagnostic here could carry are the prompt itself and the conversation id.
//
// NO LOOKUP STRUCTURE EXISTS. Single-slot, so the `obj[daemonSuppliedKey]` hazard `modelListStore`
// guards against with a `Map` cannot arise here — there is no index, no map and no key to guard.
//
// NOTHING IS PERSISTED, AND NOTHING MAY BE. `createSystemPromptStore` takes NO storage port (unlike
// `createConversationLastReadStore`), so there is nothing to reach: web storage would outlive the
// pairing that scoped the value, and a persisted copy would survive every clear below with all
// in-memory assertions still green. For the same reason THIS STORE TAKES NO ZUSTAND MIDDLEWARE, EVER —
// `persist` would write operator prompt text to web storage and defeat the clears silently, and
// `devtools` would expose it to any Redux DevTools session. Neither is present; this sentence is what
// keeps a later ticket from adding one as a convenience.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { SessionPromptStatus } from '@shared/wire/types'

/** One conversation's system-prompt reading = the `systemPromptReceived` arm minus its `type` tag and
 *  its routing key. The two fields are INDEPENDENT and NEITHER IS DERIVED FROM THE OTHER: text beside
 *  `no_session` is the ordinary "configured, applies at the next session start" reading, and an ABSENT
 *  prompt beside `matches` is a conversation holding nothing whose session spawned with nothing (the
 *  daemon compares the COLLAPSED stored value). Inferring "has bytes" from the prompt's presence would
 *  report a conversation storing an explicitly empty prompt, whose session spawned with none, as
 *  DIFFERING — telling an operator a session is stale that is running exactly what they stored.
 *
 *  `systemPrompt` IS A TRI-STATE AND ALL THREE STATES ARE HELD APART (AC2):
 *
 *    `undefined`  no prompt is stored
 *    `''`         an explicitly empty prompt IS stored
 *    any string   the stored text
 *
 *  Declared as a REQUIRED KEY of type `string | undefined` rather than an optional property — the event
 *  arm's own choice, held here so no producer can omit it and no consumer can forget it. NOTHING ON
 *  THIS PATH MAY WRITE `?? ''`, `|| undefined`, OR ANY TRUTHINESS READ: each is the collapse that makes
 *  an explicitly-empty prompt unwritable back through `set_system_prompt`, and each would typecheck.
 *
 *  Held VERBATIM — never trimmed, normalised, lowercased, length-bounded or shape-checked. The value
 *  round-trips back to the daemon as a write, so any normalisation here would silently change what the
 *  operator stored. */
export interface SystemPromptReading {
  systemPrompt: string | undefined
  sessionPromptStatus: SessionPromptStatus
}

/** The whole system-prompt state. `reading: null` is the DISTINCT "nothing has arrived yet" state and
 *  is the fourth reading, not a fourth spelling of the first three: a received
 *  `{ systemPrompt: undefined, sessionPromptStatus: 'no_session' }` is a real answer from the daemon
 *  ("this conversation holds no prompt, and no session is running"), NOT null. Keeping the two apart is
 *  the whole reason for the nullable wrapper — without it a surface cannot tell "nothing has arrived
 *  yet" from "this conversation holds no prompt", which is AC2. */
export interface SystemPromptState {
  reading: SystemPromptReading | null
}

/** Store shape = state + the two mutation entry points. They live here and NOT on `SystemPromptState`,
 *  so the selector — typed against the state-only interface — cannot see them and
 *  `initialSystemPromptState` stays assignable (the `runConfigStore` / `sessionIdStore` arrangement). */
export type SystemPromptStore = SystemPromptState & {
  setReading: (reading: SystemPromptReading) => void
  clearReading: () => void
}

export const initialSystemPromptState: SystemPromptState = { reading: null }

/**
 * DI-friendly, React-free store — one isolated instance per test. `setReading` replaces the whole
 * `reading` object unconditionally (most recent wins — no merge, no dedupe, no coalescing) and never
 * coerces, validates or shape-checks the fields. The stored value is the daemon's, as-is: a malformed
 * payload was already rejected fail-closed upstream at `parseSystemPromptPayload`, where no event is
 * emitted at all, so a second, weaker check here would only invent a disagreement.
 *
 * The reading goes in BY REFERENCE — no per-field mapping — which is what keeps the tri-state intact by
 * construction rather than by a guard. Such a by-construction claim stops holding the moment a mapping
 * appears, so the defence against that regression is a test asserting the held reading is the SAME
 * object it was handed.
 *
 * `clearReading` returns the state to `initialSystemPromptState` for when the conversation the reading
 * describes stops being the open one — a switch, a delete, an archive, or the unpair of the server that
 * chat belonged to (#1231, AC3). It is sourced from that exported constant rather than a fresh
 * `{ reading: null }` literal, for the reason `clearSnapshot` states: a second field added to
 * `SystemPromptState` later is reset for free rather than needing a second edit here. It is
 * UNCONDITIONAL, which is what makes clearing an already-clear store a no-op by construction rather
 * than by a guard — and cheap even so, because `selectSystemPromptReading` is the whole read surface
 * and `null → null` is not a slice change, so no subscriber wakes on a redundant clear.
 *
 * It reverts to the DISTINCT not-loaded state, never to a zero-valued reading: `undefined` / `''` /
 * `no_session` are real answers the daemon sends, and a cleared store producing them could not be told
 * from a chat that genuinely holds an empty prompt with no live session.
 *
 * A cleared store is NOT LATCHED: this store re-asserts itself on the next activation, which is the
 * only path that can reach a conversation again — and that is precisely the discriminator
 * `clearPairingScopedState`'s docblock names for staying OUT of its dep set. A member there would guard
 * state nothing can read.
 *
 * There is no reject branch, nothing throws, and NOTHING IS LOGGED (see the header).
 */
export function createSystemPromptStore(init: SystemPromptState = initialSystemPromptState) {
  return createStore<SystemPromptStore>((set) => ({
    ...init,
    setReading: (reading) => set({ reading }),
    clearReading: () => set(initialSystemPromptState)
  }))
}

/** App-wide singleton — the one source of truth the data path writes and #1078 will read. */
export const systemPromptStore = createSystemPromptStore()

/** Narrow-slice React binding for #1078. Selecting a single slice avoids cross-facet re-renders.
 *
 *  Exported SEPARATELY from `createSystemPromptStore` and `selectSystemPromptReading` on purpose, for
 *  the reason `useModelListStore` states: seeding a zustand singleton is INVISIBLE to
 *  `renderToStaticMarkup`, so a renderer spec below this slice has to `vi.mock` this module and
 *  override ONLY this binding onto a per-file `createSystemPromptStore()` instance, keeping
 *  `...importActual` for the selector — which is possible only because the three are separate exports
 *  rather than one bundled hook. */
export function useSystemPromptStore<T>(selector: (s: SystemPromptStore) => T): T {
  return useStore(systemPromptStore, selector)
}

/** The only read surface. The two mutation paths are `setReading` (invoked only by the subscription
 *  wiring) and `clearReading` (invoked only by the conversation-lifetime helpers), and there is no
 *  third; neither is ever two-way-bound from a component.
 *
 *  It returns the HELD READING ITSELF, never a freshly built object — `null` is a stable reference by
 *  construction, so this slice needs no hoisted `EMPTY_*` constant. The nullable return type also
 *  FORCES A CONSUMER TO BRANCH, so the not-yet-loaded state cannot be ignored accidentally. */
export const selectSystemPromptReading = (s: SystemPromptState): SystemPromptReading | null =>
  s.reading
