# System-prompt write store

The window's half of the `set_system_prompt` write: a submit path the renderer can call, and a
dedicated Zustand store that says whether a named conversation's write is in flight, confirmed, or
refused. Closes the window-side gap [System prompt write](system-prompt-write.md)'s transport leg
(#1249) left open. Nothing renders it yet: the editor surface is
[#1078](https://github.com/pyrycode/pyrycode-desktop/issues/1078); this store and its bridge ship
dormant, exactly as [System-prompt store](system-prompt-store.md) (#1231) did on the read side.

Introduced in [#1250](https://github.com/pyrycode/pyrycode-desktop/issues/1250), split from #1232.
Three of the four client legs were merged first: #1230 built the transport read, #1231 fired the ask
and held the answer, #1249 added the write verb and crossed its two outcomes to the window as typed
daemon events, consumed by nothing until this ticket.

## What it does

Lets a caller submit a system-prompt write for a conversation (`submitSystemPrompt`) with the daemon's
tri-state intact — a value, an explicitly empty string, or `null` to clear — and reports, per
conversation, whether that write is `in-flight`, `confirmed`, or `rejected` with one of four reasons.
The absence of an entry is a distinct fourth reading: "no write is known for this conversation,"
never conflated with a settled one.

## How it works

### The store (`src/renderer/src/store/systemPromptWriteStore.ts`)

```ts
export type SystemPromptWrite =
  | { status: 'in-flight' }
  | { status: 'confirmed' }
  | { status: 'rejected'; reason: SystemPromptWriteFailure }

export interface SystemPromptWriteState { writes: ReadonlyMap<string, SystemPromptWrite> }

export type SystemPromptWriteEvent =
  | { type: 'writeSubmitted'; conversationId: string }
  | { type: 'writeConfirmed'; conversationId: string }
  | { type: 'writeRejected'; conversationId: string; reason: SystemPromptWriteFailure }
  | { type: 'reconnected' }
  | { type: 'conversationSwitched' }
```

A **reducer over a sealed event union**, not named setters — `run-settings-write-store.md`'s shape,
not `system-prompt-store.md`'s — because every transition reads prior state: three arms are correlated
by conversation id (an outcome is a no-op unless that conversation is currently `in-flight`), and the
two lifecycle arms, though uncorrelated, still only clear what is actually held.

**The one place this departs from `runSettingsWriteStore`, its closest analogue.** That store mints a
`changeId` in the renderer and keys its `Map` by it. This verb has no per-write id at all: the
background process correlates on the conversation the write named (`pendingSystemPromptWrites`,
envelope id → conversation id) and hands that back on the outcome. **Two writes outstanding against
the same conversation are therefore indistinguishable to this store** — the most recent submission
owns the marker, the first outcome to arrive settles it, and the second matches nothing. A
client-minted change id was **rejected** upstream in #1249 rather than deferred (see [System prompt
write § Known limitation](system-prompt-write.md)), so nothing here may invent one; #1078 gates its
submit on the in-flight state instead.

**Why `confirmed` is a held status, not the absence of a marker.** The store must distinguish "saved,"
"never saved," "in flight" and "refused" — four readings — so the absence of an entry stays the
`systemPromptStore`-style fourth state and `{ status: 'confirmed' }` has to be an entry like any other.
This does not reopen the no-optimistic-value rule below: the confirmed arm carries no prompt, no
length, and no text, only the fact that the daemon acknowledged the write.

**Why a `Map` keyed by conversation id, not a single slot.** It makes "settle the write they name and
no other" structural — a lookup miss, not an equality check restated in three arms — and a single slot
would let a submit for conversation B silently evict a standing refusal for A. In practice the map
holds one entry, since the conversation-lifetime seams below empty it on every switch; it is keyed so
the property holds without depending on that. A `Map`, never a plain object: the two `DaemonEvent`
outcome arms carry a security contract that any index on `conversationId` must be a `Map`, and here it
is client-owned on both the submit side and the outcome side, so no attacker-chosen string reaches the
key position regardless.

**Reducer arms:**

- `writeSubmitted` sets `{ status: 'in-flight' }` **unconditionally** — the most recent submission owns
  the marker, and a standing refusal survives until the next write for that conversation.
- `writeConfirmed` / `writeRejected` settle the named conversation **only if it is currently
  `in-flight`**, else return the same state object. One gate covers three cases: an outcome for a
  conversation with nothing in flight, one arriving after a conversation seam already cleared the
  store, and a replayed second outcome for a write already settled — an ungated arm would let a
  duplicated refusal flip a confirmed write to rejected, a lie about a value the daemon stored.
- `reconnected` drops only `in-flight` entries and preserves confirmed and rejected ones — both are
  still true statements after a re-dial.
- `conversationSwitched` empties the store outright: past this seam the whole of the state describes a
  chat that is no longer the one being shown.

A no-change arm returns the identical state object, so zustand skips the notify.

**Nothing here is persisted, and nothing may be.** `createSystemPromptWriteStore` takes no storage
port. No zustand middleware, ever — `persist` would write this state to web storage where it would
survive every clear below with all in-memory assertions green, and `devtools` would expose it to any
Redux DevTools session (#126's threat model).

### The bridge (`src/renderer/src/store/systemPromptWriteBridge.ts`)

`runSettingsWriteBridge`'s bidirectional shape, where the read twin `systemPromptBridge.ts` is
inbound-only:

```ts
translateSystemPromptWriteEvent(event: DaemonEvent): SystemPromptWriteEvent | null
subscribeSystemPromptWrite(onDaemonEvent, dispatch): () => void
submitSystemPrompt(deps, conversationId: string, systemPrompt: string | null): void
SystemPromptWriteData(): null
```

- **`translateSystemPromptWriteEvent`** maps the two outcome arms plus `connected` (the reconnect edge
  available to the window — `disconnected` is emitted nowhere in `src/main`), `null` for everything
  else. `default: null`, never `assertNever` — that guard stringifies the whole event into an `Error`
  message, and the events this filter declines include `systemPromptReceived`, whose `systemPrompt`
  field is untrusted operator text.
- **`subscribeSystemPromptWrite`** takes **no attribution gate**, unlike its read-side twin
  `subscribeSystemPrompt`. That one compares the reply's conversation against the open chat because its
  store is a single slot; this store is keyed by conversation id, so an outcome naming a conversation
  with nothing in flight settles nothing by construction — a gate would be a second implementation of
  the same decision, and actively wrong for an outcome arriving before a conversation seam fires.
- **`submitSystemPrompt`** refuses a falsy conversation id outright — sends nothing *and* records
  nothing, since an unroutable id draws no outcome ever and a marker recorded for one would stand until
  a reconnect swept it. Otherwise it dispatches `writeSubmitted` **before** `sendCommand`: `'set_system_prompt'`'s client-side `prompt-too-long` refusal (an 8192-**byte** UTF-8 bound, checked in
  `daemonConnection.ts` before the connected guard and before any frame is built) can arrive sooner than
  the send call returns, and a send-first ordering could draw that refusal with nothing to settle it.
  `systemPrompt` is typed `string | null` and copied verbatim into a fresh two-field payload literal —
  no `?? ''`, no `|| null`, no truthiness read anywhere on the path.
- **`SystemPromptWriteData`** is the thirteenth headless leaf in `App.tsx`, mounted beside
  `SystemPromptData` for the always-listening reason `RunSettingsWriteData` states: an outcome can
  arrive after the editor surface (#1078) closes, and the reconnect edge fires whether or not it is
  open. `window.pyry` is dereferenced only inside the effect, so it server-renders to `null` without a
  bridge stub.

### The clear seam — `clearRunConfig`'s fourth arrow

`clearRunConfig` (the shared dep member on `ActivateConversationDeps` and `ExitActiveConversationDeps`,
one member for four stores rather than four members) gained
`systemPromptWriteStore.getState().dispatch({ type: 'conversationSwitched' })` as a **fourth** arrow at
all three production bodies — `PairedShell.tsx`'s `activateDeps` and `exitConversationDeps`, and
`clearServerScopedState.ts`'s `serverScopedClearDeps` — joining `runConfigStore`'s snapshot clear,
`runSettingsWriteStore`'s (#1167), and `systemPromptStore`'s (#1231). The member is not renamed: it
names the act, not the store list, and its signature stays `() => void`.

**This is the one arrow of the four that never self-heals at all.** `runConfigStore`'s snapshot
self-heals in one round trip (the ask fires again); `systemPromptStore`'s reading re-asserts on the
next activation (nothing pushes a correction unsolicited, but the ask does fire). This store's write
outcome describes an act the operator performed, not a value the daemon holds — no ask refills it and
no frame corrects it, so it is the sharpest of the four to leave standing. Left uncleared past a
switch, delete, archive, or server departure, it would report a save made in one chat as still in
flight, confirmed, or refused against a different one.

**Deliberately not joined to `clearPairingScopedState`** — the read twin's own discriminator applied
again: this state re-asserts (or in this store's case, is simply retired) only through the next write,
so a member there would guard state nothing can read.

See [Paired shell — conversation exits and stamps § The run-configuration
clear](paired-shell-conversation-exits.md#the-run-configuration-clear-activateconversationts-exitactiveconversationts-both-stores-1167)
for the full four-store walk-through and the placement rules in each helper.

## Data flow

```
editor (#1078) → submitSystemPrompt(deps, conversationId, systemPrompt)
      → dispatch({ type: 'writeSubmitted', conversationId })        [recorded FIRST]
      → sendCommand({ type: 'setSystemPrompt', payload: { conversation_id, system_prompt } })

daemon → systemPromptWriteConfirmed{conversationId}  → translateSystemPromptWriteEvent
       → writeConfirmed  → reducer (gated: only if in-flight)  → { status: 'confirmed' }
daemon → systemPromptWriteRejected{conversationId, reason}  → translateSystemPromptWriteEvent
       → writeRejected  → reducer (gated: only if in-flight)  → { status: 'rejected', reason }

connected (reconnect edge) → reconnected  → reducer drops in-flight entries, keeps settled ones
clearRunConfig (switch/exit/server-unpair) → conversationSwitched  → reducer empties the store
```

## Error handling

| Layer | Result | Failure behaviour |
|---|---|---|
| `submitSystemPrompt` falsy id | `void` | Nothing dispatched, nothing sent. No marker to strand. |
| `submitSystemPrompt` normal path | `void` | Record-before-send: a refusal cannot outrun the marker it settles. |
| `translateSystemPromptWriteEvent` | `… \| null` | Total; `null` means "not our arm," never "bad data." |
| `writeConfirmed` / `writeRejected` with nothing in flight | same state | Fail-closed no-op — covers a stray outcome, a replayed one, and one arriving after a clear. |
| `reconnected` | filtered state | Drops the two producers of a stranded in-flight marker (a re-dial's abandoned correlation, and a write submitted while the link was down); preserves confirmed/rejected. |
| `conversationSwitched` | empty state | Everything past this seam describes a chat no longer being shown. |

Nothing in either new file logs anything, on any branch — not even a content-free diagnostic. Pinned
by a console spy in `systemPromptWriteBridge.test.ts`.

## Security properties

Builder self-review, verdict **PASS**. The store is markedly *less* sensitive than its read twin:
neither outcome carries a prompt byte or its length, so the only strings held here are a conversation
id (a routing key) and a client-owned reason literal. The operator's text passes through
`submitSystemPrompt` as a parameter into the command and is not retained — `writeSubmitted` carries no
field for it, which makes AC3's no-retention property structural rather than a rule an implementer must
remember.

One SHOULD FIX was discharged by explicit check rather than waved through: `conversationId` arrives
with an inherited "never a lookup path, a cache key, a filename, an attribute, a URL, or a React key"
contract, and this slice is exactly the kind of new consumer where such a contract can go quietly
false — it puts the value into an index. Judged safe because the index is a `Map` (no prototype chain,
so `__proto__`/`constructor` are ordinary keys reaching nothing) and the id is client-owned on both the
write side and the read side, so no attacker-chosen string reaches the key position at all. A plain
object literal here would have been a MUST FIX.

No async work is started anywhere in this slice — no promise, no timer, no retry — so the whole
cancellation path is the subscription's off-handle, returned as `SystemPromptWriteData`'s effect
cleanup.

**Known limitation, inherited from the transport leg and unresolved here.** Two writes to the same
conversation in flight at once produce two outcomes, each naming that conversation, and nothing
distinguishes which write each settles. #1078 closes the gap behaviourally by gating its submit on the
in-flight state rather than by minting an identity this slice was told not to invent.

## Testing strategy

All vitest, `node` environment, no Playwright spec — nothing in this slice is reachable from a click.
Two new co-located spec files (`systemPromptWriteStore.test.ts`, `systemPromptWriteBridge.test.ts`)
cover: the tri-state crossing verbatim as three separate cases; the record-before-send ordering; the
gated confirm/reject arms (including a replayed refusal after a confirmation, which must not flip it);
`reconnected` dropping only in-flight entries; `conversationSwitched` emptying the store unconditionally;
a falsy conversation id refusing to send or record; and a console spy proving nothing on any path logs.
The three `clearRunConfig` bodies and `App.tsx`'s mount are structurally uncoverable —
`vitest.config.ts` is `environment: 'node'` globally, so no spec in this repo runs a React effect.
`tsc` plus review is the whole safety net there.

## Related

- [System prompt write](system-prompt-write.md) — the transport leg (#1249) this store consumes: the
  two `DaemonEvent` outcome arms, the correlation-on-conversation-id fact, and the two-writes-ambiguity
  this slice inherits rather than resolves.
- [System-prompt store](system-prompt-store.md) — the renderer read half (#1231): what a conversation's
  prompt reads as today. This store reports whether a write landed, not what the conversation now
  holds.
- [Run configuration write store](run-settings-write-store.md) — the closest analogue: the reducer
  shape, the `reconnected`/`conversationSwitched` split, and the one place this store's correlation
  handle departs from it (conversation id, not a renderer-minted `changeId`).
- [Run configuration store](run-config-store.md) § Scoped to the open chat since #1167 and [Paired
  shell — conversation exits and stamps § The run-configuration
  clear](paired-shell-conversation-exits.md#the-run-configuration-clear-activateconversationts-exitactiveconversationts-both-stores-1167)
  — the shared `clearRunConfig` seam this ticket joined as a fourth member.
- **[#1078](https://github.com/pyrycode/pyrycode-desktop/issues/1078)** — the editor surface; the first
  and only planned reader of `submitSystemPrompt` and `selectSystemPromptWriteFor`, and the owner of
  gating a submit on the in-flight state to work around the two-writes ambiguity.
