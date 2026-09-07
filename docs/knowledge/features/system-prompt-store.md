# System-prompt store

The renderer's held copy of the open conversation's stored system prompt, and whether the running
session was started with a different one — a dedicated, single-slot Zustand store closing the read
half of [System prompt send](system-prompt-send.md)'s transport leg. Nothing renders it yet: the
editor surface is [#1078](https://github.com/pyrycode/pyrycode-desktop/issues/1078); this store and
its bridge ship dormant.

Introduced in [#1231](https://github.com/pyrycode/pyrycode-desktop/issues/1231), split from #1078.
[#1230](https://github.com/pyrycode/pyrycode-desktop/issues/1230) built the transport (the
`request_system_prompt` ask, the decoded `system_prompt` reply, the correlated `systemPromptReceived`
event) but called nothing and held nothing — with no ask, `system_prompt` is **reply-only** and never
fires at all. This ticket fires the ask on conversation activation, holds the reply, and drops it
everywhere [Run configuration store](run-config-store.md)'s snapshot is dropped today.

## What it does

`runConfigStore`'s shape, copied verbatim on purpose: DI factory → app singleton → narrow-slice hook
→ one selector, with **named setters** rather than a reducer, because the two mutations ("record the
reading", "drop it") are independent whole-value writes that read no prior state.

**Four states, and the fourth is the point of the nullable wrapper.** The daemon can state three
readings; the store adds a fourth for "nothing has arrived yet":

| Store value | Reading |
|---|---|
| `reading === null` | not-yet-loaded — distinct from every daemon answer |
| `{ systemPrompt: undefined, … }` | no prompt is stored |
| `{ systemPrompt: '', … }` | an explicitly empty prompt **is** stored |
| `{ systemPrompt: 'text', … }` | the stored text |

Without the `null` wrapper a reader could not tell "nothing has arrived yet" from "this conversation
holds no prompt" — both would be the same falsy-ish value. `sessionPromptStatus` is independent and
never derived from `systemPrompt` or vice versa: text beside `no_session` is the ordinary "configured,
applies at next session start" reading, and an absent prompt beside `matches` is a conversation
holding nothing whose session spawned with nothing (the daemon compares the *collapsed* stored value).

## How it works

### The store (`src/renderer/src/store/systemPromptStore.ts`)

```ts
export interface SystemPromptReading {
  systemPrompt: string | undefined      // required key, never optional — no producer can omit it
  sessionPromptStatus: SessionPromptStatus
}
export interface SystemPromptState { reading: SystemPromptReading | null }
export type SystemPromptStore = SystemPromptState & {
  setReading: (reading: SystemPromptReading) => void
  clearReading: () => void
}

createSystemPromptStore(init?)     // vanilla createStore — one isolated instance per test (DI seam)
systemPromptStore                  // app-wide singleton
useSystemPromptStore(selector)     // React binding: useStore(systemPromptStore, selector)
selectSystemPromptReading(s)       // the only read surface
```

`systemPrompt` is declared a **required key of type `string | undefined`**, never an optional
property — so no consumer can forget it and no producer can omit it. Nothing on this path may write
`?? ''`, `|| undefined`, or any truthiness read: each collapses two of the tri-state's three values
into one, and each would make an explicitly-empty prompt unwritable back through `set_system_prompt`
with no type error and no failing test unless one exists for it.

`setReading` replaces the whole `reading` object unconditionally — most-recent-wins, no merge, no
coercion — and the write goes in **by reference**, not a per-field mapping, which is what keeps the
tri-state intact by construction rather than by a guard. `clearReading` returns to
`initialSystemPromptState` **by reference** (so a field added later resets for free), unconditionally
(a redundant clear is a no-op by construction, and `selectSystemPromptReading` being the whole read
surface means `null → null` wakes no subscriber). It reverts to the *distinct* not-loaded state, never
to a zero-valued reading — `undefined` / `''` / `no_session` are real daemon answers that must stay
distinguishable from "hasn't arrived."

**Three separate exports** (`createSystemPromptStore`, `systemPromptStore`,
`useSystemPromptStore`/`selectSystemPromptReading`), not one bundled hook — `modelListStore`'s reason:
a renderer spec below this slice can only reach the store by `vi.mock`ing the hook while keeping
`importActual` for the selector.

**No lookup structure, no storage port, no middleware, ever.** Single-slot, so `modelListStore`'s
`Map`-keyed `__proto__` hazard cannot arise — there is no index to guard. `createSystemPromptStore`
takes no storage port: nothing here ever reaches `localStorage`, `sessionStorage` or IndexedDB, since
a persisted copy of operator prompt text would outlive the pairing that scoped it and survive every
clear below with all in-memory assertions green. `persist` and `devtools` middleware are both refused
for the same reason — `devtools` would expose the prompt to any Redux DevTools session (#126's threat
model). Neither is present; this is the header's standing instruction against adding one later.

**Nothing here is ever logged**, on any branch — not even a content-free diagnostic. The only values
a diagnostic could carry are the prompt itself and the conversation id.

### The bridge (`src/renderer/src/store/systemPromptBridge.ts`)

`modelListBridge`'s four-piece shape — a pure translator, a subscriber, a sender, a headless leaf — as
**a fifth independent subscriber, not a sixth exhaustive switch**:

```ts
translateSystemPrompt(event: DaemonEvent): SystemPromptReading | null
// systemPromptReceived → a FRESH two-field literal (never `return event`, never a spread — a spread
// would carry the arm's `type` tag and `conversationId` into a write unit that never agreed to hold
// either); every other event → null. NOT an assertNever — see § Security below.

subscribeSystemPrompt(onDaemonEvent, setReading, getOpenConversationId): () => void
// subscribeRunConfig's gate shape verbatim: an early return comparing event.conversationId against
// getOpenConversationId() on the RAW event, before the translator runs, then setReading if non-null.
// getOpenConversationId is called PER EVENT, inside the listener — never resolved once at
// subscription, since this listener is app-lifetime and a closure capture would freeze the open
// conversation at mount. Returns the off handle as the effect cleanup.

requestSystemPrompt(sendCommand, conversationId: string | null): void
// requestModelList's twin down to the falsy guard: a falsy id sends NOTHING. A fresh one-field
// payload literal, fire-and-forget, no retry — ever.

SystemPromptData(): null
// the twelfth headless leaf in App.tsx, beside RunConfigLiveData. One subscribe effect; window.pyry
// is dereferenced only inside it, never during render.
```

**Why the gate reads the raw event rather than living inside the translator.** Widening
`translateSystemPrompt` to take the open id would give one decision two implementations and make the
mapper impure — `subscribeRunConfig` states this and keeps its own mappers untouched by its gate.

**`default: null`, not `assertNever` — this is the security decision, not a style choice.** The four
exhaustive bridges (`daemonEventBridge`, `timelineBridge`, `modalBridge`, `questionBridge`) each took a
dormant `systemPromptReceived` no-op arm in #1230 and keep them permanently, solely so their
`assertNever` guard makes a *new* arm a compile error. That guard `JSON.stringify`s the whole event
into an `Error` message — for this arm, that string is the operator's system prompt. An
`assertNever`-guarded sixth switch here would be the one route by which untrusted, operator-authored
text reaches a console or a crash reporter. Removing one of the four bridges' existing no-op arms
would be a security regression, not a tidy-up — see [System prompt send § The `DaemonEvent`
arm](system-prompt-send.md#the-daemonevent-arm-srcsharedipceventsts).

**The sender's falsy guard matters more here than on either twin it copies.** `system_prompt` has no
error frame at all: an unroutable id draws an ordinary-looking `no_session` reply with an absent
prompt, indistinguishable downstream from a true reading. The enforcing refusal is main's
`router.route(id)` lookup (landed #1230); this guard is what keeps a bare send from reaching it.

### The mount (`src/renderer/src/App.tsx`)

`<SystemPromptData />` — the twelfth headless leaf, beside `RunConfigLiveData`. App-level for a reason
sharper than its pushed-frame neighbours': this arm is reply-only, so it can never arrive for a
conversation the operator has never opened, but a reply *can* land after the operator has navigated
on, and a screen-scoped listener would unmount before the gate above ever adjudicates it.

Per the ticket's own instruction: after editing `App.tsx`, grep the mount run and confirm every bridge
import still has a matching call. A hunk adding a bridge mount here has previously *deleted* its
neighbour's call while leaving the import standing — invisible to build, typecheck and every unit
test, since this repo's renderer specs are static server renders that mount no effects (only three
e2e specs would have caught it). See [[a-deleted-bridge-mount-in-app-tsx-is-invisible-to-every-gate-but-e2e]].

### The ask (`src/renderer/src/PairedShell.tsx`, `activateDeps.requestConversationConfig`)

Joins the existing member as a **third call**, not a fourth deps member — `requestRunConfigSnapshot`,
`requestModelList`, then `requestSystemPrompt`, in that order, all fire-and-forget with no gate between
them. Placement is unchanged and is what makes AC1 true: it runs **outside** `activateConversation`'s
id-change gate and last, so every activation asks, including a re-open of the chat already open.

This is the one ask of the three whose absence is not merely staleness: the other two frames are also
pushed unsolicited, so a missing ask there costs freshness only; `system_prompt` has no pushed half at
all, so with no ask the event never fires and the store stays permanently not-loaded. See [Paired
shell — conversation exits and stamps § The run-configuration and model-list
ask](paired-shell-conversation-exits.md#the-run-configuration-and-model-list-ask-activateconversationts-modellistbridgets-1166)
for the full seam, now three requests.

### The drop — `clearRunConfig`'s third arrow, three production sites

`clearRunConfig` (the shared dep member on `ActivateConversationDeps` and `ExitActiveConversationDeps`)
gained `systemPromptStore.getState().clearReading()` as a third arrow at all three bodies:
`PairedShell.tsx`'s `activateDeps` (inside the id gate — a switch to a different chat) and
`exitConversationDeps` (unconditional — a delete or archive), and `clearServerScopedState.ts`'s
`serverScopedClearDeps` (reached through `exitActiveConversation`'s gated per-conversation call, for
the departed server's open chat only). **The member is not renamed** — it names the act ("this chat's
configuration is no longer the one to show"), not the store list, and its signature stays `() => void`
at both declaration sites. See [Run configuration store § Scoped to the open chat since
\#1167](run-config-store.md#scoped-to-the-open-chat-since-1167) and [Paired shell — conversation exits
and stamps § The run-configuration
clear](paired-shell-conversation-exits.md#the-run-configuration-clear-activateconversationts-exitactiveconversationts-both-stores-1167)
for the shared member's placement rules, now covering three stores.

Of the three stores this member clears, this one is the worst to leave standing and the slowest to
self-heal: `runConfigStore`'s snapshot self-heals in one round trip (the ask fires again, #1176
refuses a reply naming another chat); `runSettingsWriteStore`'s pending/confirmed state never heals on
its own at all (a `set_session_settings` ack carries no snapshot). This store sits in between —
nothing pushes a correction unsolicited, so it re-asserts only on the next activation — but its
staleness is the sharpest of the three once #1078 lands: a stale prompt shown against another chat's
thread would be offered for *edit*, not merely displayed.

**Deliberately not joined to `clearPairingScopedState`.** That helper's own discriminator is whether a
store re-asserts itself; this one does, on the next activation — the only path that can reach a
conversation again — so a member there would guard state nothing can read.

## Data flow

```
activateConversation (id changed) → clearRunConfig()  [inside the gate — runConfigStore, runSettingsWriteStore, systemPromptStore]
                                  → requestConversationConfig(id)  [outside the gate, last]
                                     → requestSystemPrompt(sendCommand, id)  [falsy id ⇒ nothing sent]

daemon → system_prompt reply → systemPromptReceived{conversationId, systemPrompt, sessionPromptStatus}
      → SystemPromptData's subscribeSystemPrompt
         → event.conversationId !== getOpenConversationId() ? drop : translateSystemPrompt → setReading
      → systemPromptStore                              [most-recent-wins]
      → (no consumer yet — #1078 is the editor surface)
```

## Configuration and usage

- **Import surface** (no consumer yet): `import { useSystemPromptStore, selectSystemPromptReading }
  from '@renderer/store/systemPromptStore'`.
- **Mount point:** `src/renderer/src/App.tsx`, the twelfth headless leaf.
- Consumed by nothing today. [#1078](https://github.com/pyrycode/pyrycode-desktop/issues/1078) is the
  first and only planned reader, and inherits the render discipline named below.

## Security

`systemPrompt` is untrusted operator-authored text relayed over the network — the most sensitive
string this store holds. It is a value to be rendered as inert plain text and edited by #1078, and
nothing else: never markup (no `innerHTML`, no `dangerouslySetInnerHTML`), never into an attribute or
a URL, never a filename, a cache key, a lookup path or a React `key`. This deny-list is **restated
here** rather than inherited by reference from the `systemPromptReceived` event arm's own docblock —
that clause is a claim about the arm's *previous* consumer (a dormant no-op); this store's consumer is
a rendering-and-editing surface, exactly where a skimmed inherited contract goes quietly false.

`sessionPromptStatus` and `conversationId` are both client-owned — the status narrowed at decode
against three constants, the id resolved in main from this app's own outbound request — so no daemon
string crosses on either field.

## Edge cases and limitations

- **`reading === null` after an activation is ambiguous, and that is permanent, not a gap to close.**
  `system_prompt` is reply-only, so a still-`null` reading means either "still in flight" or "never
  coming" — a consumer cannot tell which. #1078 must not block its editor on this value or design a
  loading spinner keyed on it.
- **No `connected`-edge refresh, no turn-end refresh — deliberately.** Unlike [Run configuration
  store](run-config-store.md)'s two extra refresh edges, this store's only ingress is the activation
  ask. A reconnect to the same daemon does not invalidate a stored prompt, and a daemon-wide edge has
  no one conversation to name against a reply-only verb.
- **Not a retry.** `system_prompt` rides an on-path relay that may withhold the frame; a client-side
  retry against that would be a self-inflicted spin. One ask per activation, never repeated.
- **Structurally uncoverable by unit tests**: the three `clearRunConfig` bodies, `requestConversationConfig`'s
  body and the `App.tsx` mount are wiring objects, not pure functions, and `vitest.config.ts` is
  `environment: 'node'` globally — no spec in this repo runs a React effect. `tsc` plus review is the
  whole safety net for those four sites; the store and the bridge's pure functions
  (`translateSystemPrompt`, `subscribeSystemPrompt`, `requestSystemPrompt`) are unit-tested directly.

## Related

- [System prompt send](system-prompt-send.md) — the transport leg this store and bridge consume:
  the wire types, the `request_system_prompt` builder, the correlation map, and the
  `systemPromptReceived` event's own field-level trust-tier notes.
- [Run configuration store](run-config-store.md) — the store shape copied verbatim (DI factory →
  singleton → hook → selector, named setters), and the sibling whose `clearSnapshot` /
  `clearRunConfig` seam this store's clear joins.
- [Model-list store](model-list-store.md) — the bridge shape copied (`default: null`, no
  `assertNever`; the falsy-id sender guard; the three-separate-exports reason for `vi.mock`
  testability).
- [Paired shell — conversation exits and stamps § The run-configuration and model-list
  ask](paired-shell-conversation-exits.md#the-run-configuration-and-model-list-ask-activateconversationts-modellistbridgets-1166)
  and [§ The run-configuration
  clear](paired-shell-conversation-exits.md#the-run-configuration-clear-activateconversationts-exitactiveconversationts-both-stores-1167)
  — the shared ask/clear seam this ticket joined as a third member on each.
- **[#1230](https://github.com/pyrycode/pyrycode-desktop/issues/1230)** — built the transport this
  store and bridge are the first consumer of; shipped with all four exhaustive bridges' no-op arms
  already in place.
- **[#1078](https://github.com/pyrycode/pyrycode-desktop/issues/1078)** — the editor surface; the
  first and only planned reader of `selectSystemPromptReading`, and the owner of the render/escape/
  length-bound discipline this store's header states but does not itself enforce.
