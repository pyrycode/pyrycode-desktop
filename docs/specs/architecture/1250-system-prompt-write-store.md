# #1250 — Hold the outcome of a system-prompt write

The window's half of the `set_system_prompt` write: a submit path the renderer can call, and a
dedicated store that says whether a conversation's write is in flight, confirmed, or refused. Nothing
renders it — the editor surface is #1078. This slice ships dormant, exactly as #1231 did.

## Files read

| Path → symbol | Why it matters |
|---|---|
| `src/shared/wire/types.ts` → `SetSystemPromptPayload` | The tri-state (`string \| null`) the submit path must carry intact. A required key, never optional. |
| `src/shared/ipc/commands.ts` → `RendererCommand`'s `setSystemPrompt` member, `isSetSystemPromptPayload` | The command this slice sends and the untrusted→trusted guard it lands on. |
| `src/shared/ipc/events.ts` → `SystemPromptWriteFailure`, `DaemonEvent`'s `systemPromptWriteConfirmed` / `systemPromptWriteRejected` arms | The four failure members, and the two outcome arms whose only correlation handle is `conversationId`. Its docblock states "if a consumer indexes by it, THE INDEX IS A `Map`". |
| `src/renderer/src/store/runSettingsWriteStore.ts` → `reduceRunSettingsWrite`, `RunSettingsWriteEvent` | The closest analogue: a reducer over a sealed, correlated transition set, with the `reconnected`-vs-`conversationSwitched` split and the argument for why one arm preserves what the other drops. |
| `src/renderer/src/store/runSettingsWriteBridge.ts` → `translateWriteEvent`, `submitSettingsChange` | The bidirectional bridge shape: translator + subscriber + record-before-send submit + headless leaf. Its `connected`-not-`disconnected` reconnect-edge rationale transfers verbatim. |
| `src/renderer/src/store/systemPromptStore.ts` → `createSystemPromptStore`, `selectSystemPromptReading` | The read-side twin: the no-middleware / no-storage-port / never-logged posture this store inherits, and the nullable-return-forces-a-branch selector shape. |
| `src/renderer/src/store/systemPromptBridge.ts` → `translateSystemPrompt`, `requestSystemPrompt`, `SystemPromptData` | `default: null` (never `assertNever`) as a security decision, the falsy-id sender guard, and the app-level headless-leaf mount rationale. |
| `src/main/daemonConnection.ts` → `setSystemPrompt`, `pendingSystemPromptWrites` | Confirms three of the ticket's four facts in code: the byte bound runs *before* the connected guard; `driver === null` returns with no event and no correlation entry; the re-dial reset clears the write map and emits nothing. |
| `src/renderer/src/PairedShell.tsx` → `activateDeps`, `exitConversationDeps` | Two of the three `clearRunConfig` production bodies, each already three `getState()` arrows. |
| `src/renderer/src/clearServerScopedState.ts` → `serverScopedClearDeps` | The third body. #1231's docblock names adding to one body and not the others as how #1167's own defect arose. |
| `src/renderer/src/activateConversation.ts` / `exitActiveConversation.ts` → `ActivateConversationDeps.clearRunConfig`, `ExitActiveConversationDeps.clearRunConfig` | The member's two docblocks: the signature stays `() => void` and the member names the act, not the store list. |
| `src/renderer/src/App.tsx` → the headless-leaf run ending at `SystemPromptData` | The mount point; this slice adds the thirteenth leaf. |
| `docs/knowledge/features/system-prompt-store.md` § The drop | The three-bodies-in-one-edit discipline, and the "grep the mount run for an import with no call" instruction #1231 carried forward. |
| `docs/knowledge/features/system-prompt-write.md` § Known limitation | States the two-writes-on-one-conversation ambiguity and that a client-minted change id was **rejected** rather than deferred — so this slice must not mint one. |

## Design source

**Figma:** N/A — nothing in this slice renders. The store and its bridge ship dormant; the editor
surface that will display this state is #1078, which owns the visual fidelity check.

## Context

A conversation's system prompt is durable operator-authored text the daemon installs at each session
spawn. Three of the four client legs are merged: #1230 built the transport read, #1231 fired the ask
and held the answer, #1249 added the write verb and crossed its two outcomes to the window as typed
daemon events. Both outcome arms are consumed by nothing today.

This slice adds the two things #1078 needs before it can exist: a call that submits a write, and a
store that reports what happened to it. Every design decision below follows from four properties of
what #1249 published, all verified in the code rather than taken from the ticket body:

1. **The correlation handle is the conversation id.** `pendingSystemPromptWrites` maps envelope id →
   the conversation the write named, and the outcome carries that value back. There is no per-write
   id, and the ack record's own `id` is deliberately unused. Two writes outstanding on the *same*
   conversation are therefore indistinguishable here — the analogue's `Map` keyed by a
   renderer-minted `changeId` does **not** transfer, and minting one was explicitly rejected upstream
   rather than deferred, so this slice must not invent one.
2. **`prompt-too-long` is this client's own verdict**, emitted in `setSystemPrompt` before the
   connected guard and before any frame is built. It arrives on the same event path as a daemon
   refusal and much sooner, which imposes a record-before-send ordering on the submit helper.
3. **A write submitted while the link is down draws no outcome at all** — `driver === null` returns
   inert, with no event and no correlation entry. It is the second producer of a stranded in-flight
   marker, alongside the re-dial reset.
4. **Exactly one outcome per write is structural** — both arms consume the same correlation entry.

No ADR is warranted. This slice introduces no new decision: it is the fourth store to join a clear
seam #1167 cut and #1231 widened, and its shape is `runSettingsWriteStore`'s with one documented
departure (fact 1).

## Design

Two new modules under `src/renderer/src/store/`, plus one line in each of the three `clearRunConfig`
production bodies and one leaf in `App.tsx`.

### The store — `systemPromptWriteStore.ts`

An **adjacent dedicated store, not a `systemPromptStore` facet**, for the analogue's two reasons:
its inbound subscription is App-level always-listening (an outcome can land after the editor closes,
where the read store's ingress is one reply per activation), and write state is orthogonal to the
held reading — the read store answers "what does this conversation hold", this one answers "what
happened to my last save".

A **reducer over a sealed event union**, not named setters, because every transition reads prior
state: three are correlated by conversation id (a confirm or refusal is a no-op with nothing in
flight) and the two lifecycle arms are uncorrelated but still prior-state-reading.

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

Exports mirror the read twin's three-separate-exports arrangement (`createSystemPromptWriteStore`,
the `systemPromptWriteStore` singleton, `useSystemPromptWriteStore`) plus one curried selector
`selectSystemPromptWriteFor(conversationId)`, returning the held write or `null` so the
nothing-known state cannot be ignored by accident.

**Why `confirmed` is a held status and not the absence of a marker.** The ticket asks for a store
that says whether a write is "in flight, confirmed, or refused" — three readings, so the absence of
an entry has to stay the fourth ("no write is known for this conversation"), exactly as the read
store's `reading === null` stays distinct from every daemon answer. This does not conflict with the
prohibition on optimistic values: `{ status: 'confirmed' }` is a fact about the *write* and carries
no prompt, no length, and no text. There is nothing on the ack to fold in, and nothing here invents
one.

**Why a `Map` keyed by conversation id rather than a single slot.** It makes "settle the write they
name and no other" structural rather than an equality check scattered through three arms, and it is
the shape the event arm's own security docblock prescribes for any index on this field. A single
slot would additionally let a submit for conversation B silently evict a standing refusal for A.
In practice the map holds one entry, because the conversation-lifetime seams below empty it on every
switch — but it is keyed so that the property holds without depending on that.

**Reducer arms.** `writeSubmitted` sets `{ status: 'in-flight' }` **unconditionally**, so the most
recent submission owns the marker and supersedes any standing outcome (AC2's "a standing refusal
survives until the next write for that conversation"). `writeConfirmed` and `writeRejected` are
**gated on the named conversation currently being `in-flight`** and return the same state object
otherwise — which covers both the "nothing in flight" no-op and a replayed second outcome, where an
ungated arm would flip a confirmed write to rejected. `reconnected` drops only `in-flight` entries
and preserves the rest. `conversationSwitched` returns a fresh whole-state literal.

Both payload-free statuses are built as fresh literals per transition rather than hoisted shared
constants — the allocation is once per real transition, and it removes the aliasing footgun the
analogue's `reconnected` arm documents.

### The bridge — `systemPromptWriteBridge.ts`

`runSettingsWriteBridge`'s four-piece bidirectional shape, all helpers React-free and injected:

```ts
translateSystemPromptWriteEvent(event: DaemonEvent): SystemPromptWriteEvent | null
subscribeSystemPromptWrite(onDaemonEvent, dispatch): () => void
submitSystemPrompt(deps: SubmitSystemPromptDeps, conversationId: string,
                   systemPrompt: string | null): void
SystemPromptWriteData(): null
```

- **`translateSystemPromptWriteEvent`** maps the two outcome arms plus `connected` (the reconnect
  edge available to the window — `disconnected` is emitted nowhere in `src/main`) and returns `null`
  for everything else. `default: null`, never an `assertNever`: that guard stringifies the whole
  event into an `Error` message, and the events this filter declines include
  `systemPromptReceived`, whose `systemPrompt` field is untrusted operator text. Each arm returns a
  fresh named-field literal, never a spread.
- **`subscribeSystemPromptWrite`** takes no attribution gate, unlike its read-side twin, and the
  reason is the keyed store: an outcome naming a conversation with no in-flight entry settles
  nothing by construction. A gate would be a second implementation of the same decision.
- **`submitSystemPrompt`** refuses a falsy conversation id outright — sending nothing *and*
  recording nothing — which is `requestSystemPrompt`'s guard sharpened by fact 3: an unroutable id
  draws no outcome ever, so a marker recorded for one would stand until a reconnect swept it.
  Otherwise it dispatches `writeSubmitted` **before** `sendCommand` (fact 2) and sends one command
  carrying a fresh two-field payload literal. `systemPrompt` is typed `string | null` and copied
  verbatim — no `?? ''`, no `|| null`, no truthiness read anywhere on the path.
- **`SystemPromptWriteData`** is the thirteenth headless leaf in `App.tsx`, beside `SystemPromptData`
  and for the always-listening reason `RunSettingsWriteData` states: an outcome can arrive after the
  editor surface closes, and the reconnect edge fires whether or not it is open. `window.pyry` is
  dereferenced only inside the effect, so it server-renders without a bridge stub.

### The clear seams

`clearRunConfig`'s three production bodies (`PairedShell.tsx`'s `activateDeps` and
`exitConversationDeps`, `clearServerScopedState.ts`'s `serverScopedClearDeps`) each gain a fourth
arrow dispatching `{ type: 'conversationSwitched' }`. The member's signature does not change and it
is not renamed: it names the act, not the store list. The two interface docblocks in
`activateConversation.ts` and `exitActiveConversation.ts` gain the fourth store in their prose.

The store is deliberately **not** joined to `clearPairingScopedState`, on the read twin's
discriminator: this state re-asserts itself on the next write, so a member there would guard state
nothing can read.

## State + concurrency model

One app-wide Zustand singleton holding one `Map`, mutated only through `dispatch`. No async work is
started anywhere in this slice: no promise, no timer, no interval, no retry — so the whole
cancellation path is the subscription's off-handle, returned as the effect cleanup of the single
`useEffect` in `SystemPromptWriteData` (a StrictMode double-mount nets exactly one live listener).

`sendCommand` is `void` and fire-and-forget; there is nothing to await, and therefore no
check-then-act gap between reading the store and mutating it. Every reducer arm is a synchronous
pure function of `(state, event)` and returns the same state object when it changes nothing, so
zustand skips the notify.

## Error handling

| Layer | Result | Failure behaviour |
|---|---|---|
| `submitSystemPrompt` falsy id | `void` | Nothing dispatched, nothing sent. No marker to strand. |
| `submitSystemPrompt` normal path | `void` | Record-before-send. A refusal cannot outrun the marker it settles. |
| `translateSystemPromptWriteEvent` | `… \| null` | Total; `null` means "not our arm", never "bad data" — a malformed payload was already rejected fail-closed in main, where no event is emitted at all. |
| `writeConfirmed` / `writeRejected` with nothing in flight | same state | Fail-closed no-op, covering a stray outcome, a replayed one, and one arriving after a conversation seam cleared the store. |
| `reconnected` | filtered state | Drops the two producers of a stranded in-flight marker; preserves confirmed and rejected, both still true statements after a re-dial. |
| `conversationSwitched` | empty state | Everything past this seam describes a chat that is no longer the one being shown. |

Nothing in this slice throws, and nothing is logged on any path — see § Security review.

## Testing strategy

All vitest, node environment, no Playwright spec: nothing renders and nothing in this slice is
reachable from a click. Two new co-located spec files.

**`systemPromptWriteStore.test.ts`** — scenarios, each against a fresh `createSystemPromptWriteStore()`:

- a submitted write reports in flight for the conversation it names and for no other
- three submissions — a value, `''`, and `null` — are indistinguishable *to the store*, which holds
  no text (the tri-state's proof lives in the bridge spec, where the payload is observable)
- a confirmation moves that conversation's write to confirmed; a refusal moves it to rejected
  carrying the named reason, one case per `SystemPromptWriteFailure` member
- an outcome naming a conversation with nothing in flight returns the identical state object
- a replayed refusal after a confirmation does not flip the confirmed write
- a standing refusal survives an unrelated conversation's submit and its own conversation's next
  outcome-less interval, and is replaced only by the next submit for that conversation
- `reconnected` drops in-flight entries, preserves confirmed and rejected ones, and returns the
  identical state object when nothing is in flight
- `conversationSwitched` empties the store and returns the identical state object when already empty
- `selectSystemPromptWriteFor` returns `null` for an unknown conversation and the held object
  (by reference) for a known one

**`systemPromptWriteBridge.test.ts`** — plain spies, no React:

- the translator maps each of the two outcome arms and `connected`, and returns `null` for a
  sample of unrelated arms including `systemPromptReceived` and `disconnected`
- the subscriber dispatches only non-null translations and returns the off handle it was given
- `submitSystemPrompt` sends exactly one `setSystemPrompt` command whose payload is exactly
  `{ conversation_id, system_prompt }`, with the tri-state verbatim across all three inputs —
  a value, `''`, and `null` — pinned as three separate cases so a collapse reddens
- the dispatch is ordered **before** the send, pinned by recording both into one ordering array
- a falsy conversation id (`''`) neither sends nor dispatches
- nothing on any path reaches a console sink (a spy on `console.*` records nothing)

The three `clearRunConfig` bodies, `App.tsx`'s mount and the leaf's effect are structurally
uncoverable — `vitest.config.ts` is `environment: 'node'` globally, so no spec in this repo runs a
React effect. `tsc` plus review is the whole safety net there, which is why every deps member stays
required rather than optional. Per #1231's standing instruction, after editing `App.tsx` the mount
run is grepped to confirm every bridge import still has a matching call.

## Open questions

1. **Does `confirmed` need to expire?** Resolved in the design above: no. A standing confirmation is
   replaced by the next submit for that conversation and dropped by every conversation-lifetime seam,
   and no other expiry is specified. Adding a timer would be a retry mechanism by another name.
2. **Should the subscriber carry the read bridge's attribution gate?** Resolved: no, and § Design
   records why — the keyed store already refuses an outcome for a conversation with nothing in
   flight, so a gate would be a second implementation of one decision.

## Sizing — over the table, deliberately, per the ticket's `needs-human:sizing`

7 production source files (2 new, 5 modified) against a ceiling of 5, and ~900 lines of total
written work against a ceiling of 800. Within the table on every other line: 0 consumer call sites
needing simultaneous update, 4 acceptance criteria, 1 new store, 3 correlated reducer arms.

The refiner ran the split-depth gate and recorded `parent 1232 grandparent 1078` — a grandchild, so
splitting is barred — and independently found the one-consumer floor bars the only other available
cut (the store has exactly one consumer, its own bridge). `needs-human:sizing` is already applied and
the ticket instructs the builder not to route back with a split proposal. Building as it stands, per
that instruction and the brief's depth-capped rule.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. Two boundaries are crossed and both already exist. *Inbound*:
  the two outcome arms reach this store through the preload daemon-event channel, and every field on
  them is client-owned — `conversationId` is the id this app put in its own outbound frame (never the
  `id` the daemon's ack record echoes), and `reason` is a literal narrowed at the decode boundary
  against constants or minted in main for `prompt-too-long`. No daemon string crosses on either arm,
  and neither carries a prompt byte or its length. *Outbound*: `submitSystemPrompt` hands one fresh
  two-field literal to `sendCommand`, which lands on the existing `isSetSystemPromptPayload` guard in
  main. This slice adds no third boundary.
- **[Trust boundaries — the field-contract trap]** SHOULD FIX, discharged in Phase B by explicit
  check. `conversationId` arrives with an inherited "never a lookup path, a cache key, a filename, an
  attribute, a URL or a React key" contract, and this slice is exactly the kind of *new* consumer
  where such a contract goes quietly false: it puts the value into an index. Judged safe rather than
  waved through — the index is a `Map`, which has no prototype chain, so `__proto__` /
  `constructor` as a key are ordinary string keys and reach nothing; and the id is client-owned on
  both the write side and the read side, so no attacker-chosen string reaches the key position at
  all. A plain object literal here would be a MUST FIX; a `Map` is not. Phase B must grep the two new
  files for each denied sink before the PR.
- **[Tokens, secrets, credentials]** Not applicable, and stated as a design decision rather than an
  absence: this store holds no credential and no operator text. Its only two string values are a
  conversation id (a routing key) and a client-owned reason literal. The prompt itself passes through
  `submitSystemPrompt` as a parameter into the command and is **not retained** — the
  `writeSubmitted` event carries no text field for it to be recorded in, which makes AC3's
  no-retention property structural rather than a rule an implementer must remember.
- **[File / storage operations]** No findings, by construction. `createSystemPromptWriteStore` takes
  no storage port, so there is nothing to reach: no `localStorage`, no `sessionStorage`, no
  IndexedDB, no disk. **No zustand middleware, ever** — the read twin's standing rule inherited
  verbatim and restated in the new file's header: `persist` would write this state to web storage
  where it would survive every clear with all in-memory assertions green, and `devtools` would expose
  it to any Redux DevTools session (#126's threat model). Neither is present.
- **[Inter-process / Electron attack surface]** No findings, and unchanged in kind. No new IPC
  channel, no new `contextBridge` member, no new preload surface: the command rides the existing
  `sendCommand`, the outcomes ride the existing daemon-event channel. The durability caution #1249
  recorded still stands — a compromised renderer can write any conversation's prompt by id, more
  durable than a message send because the value shapes every future session — and its mitigation is
  an operator-facing confirmation surface, which is **#1078's** to own. This slice's own obligation
  is that no path here synthesises, defaults or rewrites a prompt value, and the `string | null`
  parameter copied verbatim into a fresh literal is what meets it.
- **[Cryptographic primitives]** Not applicable. No key, no nonce, no handshake, no comparison
  against a secret. The one equality this slice performs is a `Map` lookup on a client-owned
  conversation id, which is not a secret and needs no constant-time compare.
- **[Network & I/O]** Not applicable directly — this slice opens no socket and sets no timeout. The
  one property it must not break is inherited: the client-side byte bound lives in main's
  `setSystemPrompt` and is *not* re-implemented here. A renderer-side length check would be a second
  authority that could disagree with the first, and showing the limit before it is hit is #1078's.
- **[Error messages, logs, telemetry]** No findings, and this is the category the design is most
  exposed on, so it is stated as a rule rather than an observation: **nothing in either new file logs
  anything, on any branch, not even a content-free diagnostic.** The two places an implementer
  reaches for one are the fail-closed no-op arm ("dropped an uncorrelated outcome") and the falsy-id
  guard in `submitSystemPrompt` — and the only fields either could carry to be useful are the
  conversation id and the prompt, both forbidden. The property has to be total to be worth anything;
  a count would be the first crack. The `default: null` filter (never `assertNever`) is the same
  decision in its structural form, since that guard's `JSON.stringify` is the one remaining sink that
  could reach operator prompt text via the read arm. Pinned by a console spy in the bridge spec.
- **[Concurrency]** No findings. Nothing async is started: no promise, no timer, no interval, no
  retry, no `AbortController` to thread because there is nothing to abort. The single subscription's
  off handle is returned as the effect cleanup, so window teardown and a StrictMode double-mount both
  net exactly one live listener. Every reducer arm is synchronous with no `await` between a read and
  a write, so no check-then-act race exists.
- **[Threat model alignment]** Walked case by case. *Hostile/on-path relay*: it can drop, delay,
  reorder or duplicate. A dropped outcome leaves an in-flight marker, swept by the reconnect arm; a
  duplicated one hits the `in-flight`-gated no-op; a reordered pair settles once, because main's two
  arms consume the same correlation entry. *Hostile daemon*: an ack naming conversation B for write A
  cannot misattribute, because the emitted id is the correlation map's value, not the record's. A
  forged outcome for a write never sent matches no entry and is dropped. A refusal code outside the
  published set arrives as `unclassified` and still settles the write, so no refusal can strand a
  marker as permanently in flight. *Renderer compromise*: unchanged in kind, addressed above. **Out
  of scope, named**: the two-writes-on-one-conversation ambiguity — the second outcome cannot be
  paired with the second write. Upstream #1249 rejected a client-minted change id rather than
  deferring it, and #1078 closes the gap behaviourally by gating its submit on the in-flight state.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-07
