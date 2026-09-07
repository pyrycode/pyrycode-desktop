# 1231 — Opening a chat asks for its system prompt and holds the answer

Closes the renderer half of the system-prompt read: fire the ask on conversation activation, hold the
reply in a dedicated store, and drop the held value when the chat it describes stops being the open
one. Nothing renders it — #1078 is the editor surface.

## Files read

| Path | Symbols | Why it matters |
|---|---|---|
| `src/renderer/src/store/runConfigStore.ts` | `RunConfigSnapshot`, `RunConfigState`, `createRunConfigStore`, `clearSnapshot`, `selectSnapshot` | **The shape this ticket copies verbatim** — DI-factory → singleton → hook → selector, named setters rather than a reducer, and the `null`-is-the-distinct-not-loaded-state argument |
| `src/renderer/src/store/modelListBridge.ts` | `translateModelList`, `subscribeModelList`, `requestModelList`, `ModelListData` | The `default: null` (no `assertNever`) translator posture, the `!== null` guard, the falsy-id sender, and the headless-leaf shape |
| `src/renderer/src/store/modelListStore.ts` | header § SECURITY, `clearAllModelLists` | The "held verbatim / nothing is a lookup path / nothing is ever logged" three-obligation form, and the no-storage-port clause |
| `src/renderer/src/screens/conversation/runConfigSnapshot.ts` | `subscribeRunConfig`, `requestRunConfigSnapshot` | **AC4's gate lives here** — the per-event `getOpenConversationId()` read inside the listener, the `null`-matches-no-reply rule, and the argument-swap typecheck analysis |
| `src/renderer/src/screens/conversation/runConfigLive.ts` | `RunConfigLiveData` | The one production caller of that gate: `activeConversationStore.getState().activeConversation?.id ?? null`, read non-reactively at call time |
| `src/renderer/src/activateConversation.ts` | `ActivateConversationDeps.requestConversationConfig`, `.clearRunConfig`, `activateConversation` | The one-member-for-more-than-one-request argument, and the inside-the-gate / outside-the-gate placement that **is** AC1 and AC3 |
| `src/renderer/src/exitActiveConversation.ts` | `ExitActiveConversationDeps.clearRunConfig`, `exitActiveConversation` | The delete/archive drop seam, and its enumeration of stores deliberately left out |
| `src/renderer/src/PairedShell.tsx` | `activateDeps`, `exitConversationDeps`, `clearPairingDeps` | Two of AC3's three drop sites and AC1's only ask site; the `getState()`-inside-the-arrow-body idiom |
| `src/renderer/src/clearServerScopedState.ts` | `serverScopedClearDeps.clearRunConfig` | AC3's third drop site — the per-server unpair path |
| `src/renderer/src/App.tsx` | the eleven headless leaves + their mount run | Where the new leaf mounts; **the deleted-neighbour hazard the ticket's first technical note names** |
| `src/shared/ipc/events.ts` | `systemPromptReceived` arm | The contract this store must not break: the tri-state, the client-owned `conversationId`, and the `assertNever` log-sink warning |
| `src/shared/wire/types.ts` | `SessionPromptStatus`, `SystemPromptPayload` | The three status literals, and why the two fields are independent |
| `src/shared/ipc/commands.ts` | `requestSystemPrompt` member, `isRequestSystemPromptPayload` | The boundary guard checks type not emptiness — the refusal that matters is main's routing lookup |
| `docs/knowledge/features/system-prompt-send.md` | § The two facts that shape every piece, § Security properties | **The two facts that bind this slice**: the reply names no conversation, and the verb has no error frame at all |
| `docs/knowledge/features/run-config-store.md` | § Conversation-attributed since #1176, § Scoped to the open chat since #1167 | The prior tickets' lessons on this exact seam — why the gate is per-event, and why `clearPairingScopedState` stays out |
| `docs/knowledge/features/model-list-store.md` | § Edge cases and limitations | The no-retry / no-spinner / never-block rule this verb inherits |

## Design source

**Figma:** N/A — this slice renders nothing. The store ships dormant; the editor surface is #1078,
which owns the visual-fidelity check.

## Context

#1230 taught the background process to ask for a conversation's stored system prompt and to route the
correlated reply across IPC as `systemPromptReceived`. Nothing calls the ask and nothing holds the
answer, so the arm is dormant — and because `system_prompt` is **reply-only** (unlike the pushed
`modelList` / `slashCommandList` frames), with no ask the event never fires at all.

Two facts from the transport leg bind every decision below:

- **The reply carries no conversation id of its own.** The `conversationId` on the event is
  client-owned, resolved in the background process from the request this app itself sent. That is
  what makes the renderer-side attribution gate meaningful rather than a check against daemon input.
- **The verb has no error frame.** An unroutable id draws an ordinary-looking `no_session` reply with
  an absent prompt — a reading nothing downstream can tell from a true one. The enforcing refusal is
  main's `router.route(id)` lookup, already landed; the renderer sender's falsy guard keeps a bare
  send from reaching it.

No ADR is warranted: this slice introduces no new decision, it applies three settled ones
(`runConfigStore`'s store shape, #1166's ask-on-activation seam, #1167's drop-on-leave seam) to a
fourth value.

### Sizing — over the table on two lines, taken whole

Counted against my own sketch, not the body's length: **7 production files** against a ceiling of 5,
and **~865 lines** of total written work against 800. The refiner declared the same overage with the
same measurement (~930 / 7).

Split depth checked: parent #1078, grandparent `none` — a split would be legal. It is declined on the
floor rule. The only available seam is fill (store + bridge + mount + ask) against drop (three dep
bodies + two docstrings). The first child measures ~810 lines across 5 files — at both ceilings
anyway — so the split buys nothing on the ceiling and costs a full pipeline pass. And the drop half
is not separable in substance: #1167 exists precisely because a held, conversation-scoped value
shipped without its drop, so shipping the fill alone would deliberately re-introduce the defect that
ticket was written to close, for one ticket's duration, in a store holding operator-authored text.
The measured precedent is the blocking sibling in this same family: #1230 declared an identical
overage and shipped 1609 lines across 18 files in one builder leg on 2026-09-07.

## Design

### The store — `src/renderer/src/store/systemPromptStore.ts` (new)

`runConfigStore`'s structure verbatim: DI factory → app singleton → narrow-slice hook → one selector,
with **named setters rather than a reducer** because the two mutations are independent whole-value
writes that read no prior state.

```ts
export interface SystemPromptReading {
  systemPrompt: string | undefined      // REQUIRED key, not an optional property
  sessionPromptStatus: SessionPromptStatus
}
export interface SystemPromptState { reading: SystemPromptReading | null }
export type SystemPromptStore = SystemPromptState & {
  setReading: (reading: SystemPromptReading) => void
  clearReading: () => void
}
```

Plus `initialSystemPromptState`, `createSystemPromptStore(init?)`, the `systemPromptStore` singleton,
`useSystemPromptStore(selector)`, and `selectSystemPromptReading(s): SystemPromptReading | null`.
Three separate exports, not one bundled hook, for `modelListStore`'s stated reason: a renderer spec
below this slice can only reach the store by `vi.mock`ing the hook while keeping `importActual` for
the selector.

**AC2 is four states, and the fourth is the whole point of the nullable wrapper.** The three the
daemon can state live inside a present `reading`; the fourth is the absence of one:

| Store value | Reading |
|---|---|
| `reading === null` | **nothing has arrived yet** — not-yet-loaded, distinct from every daemon answer |
| `{ systemPrompt: undefined, … }` | no prompt is stored |
| `{ systemPrompt: '', … }` | an explicitly empty prompt **is** stored |
| `{ systemPrompt: 'text', … }` | the stored text |

`systemPrompt` is declared as a **required key of type `string | undefined`**, never an optional
property — the event arm's own choice, held here so no producer can omit it and no consumer can
forget it. Nothing on this path may write `?? ''`, `|| undefined`, or any truthiness read: each is
the collapse that would make an explicitly-empty prompt unwritable back through `set_system_prompt`.

`sessionPromptStatus` is **independent** and neither field is derived from the other. Text beside
`no_session` is the ordinary "configured, applies at the next session start" reading; an absent
prompt beside `matches` is a conversation holding nothing whose session spawned with nothing.

`clearReading` returns `initialSystemPromptState` **by reference**, sourced from the exported
constant rather than a fresh `{ reading: null }` literal — `clearSnapshot`'s stated reason, so a
second field added later resets for free. Unconditional, so clearing an already-clear store is a
no-op by construction; `selectSystemPromptReading` is the whole read surface and `null → null` is not
a slice change, so no subscriber wakes on a redundant clear.

**No map, no key, no index.** Single-slot, so the `__proto__`-through-`obj[key]` hazard
`modelListStore` guards against cannot arise here — there is no lookup structure to guard. **No
storage port** (`createSystemPromptStore` takes none, unlike `createConversationLastReadStore`), and
**no middleware ever** — see § Security review.

### The bridge — `src/renderer/src/store/systemPromptBridge.ts` (new)

`modelListBridge`'s four-piece shape: a pure translator, a subscriber, a sender, and a headless leaf.
**A fifth independent subscriber, not a sixth exhaustive switch.**

- `translateSystemPrompt(event: DaemonEvent): SystemPromptReading | null` — one `case
  'systemPromptReceived'` mapping to a **fresh two-field literal** (never `return event`, never a
  spread: a spread would carry the arm's `type` tag and `conversationId` into a write unit that never
  agreed to hold them), and `default: null`. **Not an `assertNever`** — that guard interpolates the
  whole event into an `Error` message, which for this arm is the operator's prompt text.
- `subscribeSystemPrompt(onDaemonEvent, setReading, getOpenConversationId): () => void` —
  `subscribeRunConfig`'s gate shape verbatim: an early return comparing `event.conversationId`
  against `getOpenConversationId()` on the raw event **before** the translator runs, then
  `if (reading !== null) setReading(reading)`. Returns the off handle as the effect cleanup.
- `requestSystemPrompt(sendCommand, conversationId: string | null): void` — `requestModelList`'s twin
  down to the falsy guard; a fresh one-field payload literal, fire-and-forget.
- `SystemPromptData(): null` — one subscribe effect, `window.pyry` dereferenced only inside it.

**Why the gate reads on the raw event rather than inside the translator.** Widening
`translateSystemPrompt` to take the open id would give one decision two implementations and make the
mapper impure; `subscribeRunConfig` states this and keeps its two mappers untouched by its gate.

**Argument-swap analysis, re-run rather than inherited.** Three parameters, two of them functions, and
no named-deps object is owed: exchanging `setReading` and `getOpenConversationId` **as a pair** is a
compile error, because `(reading: SystemPromptReading) => void` is not assignable to
`() => string | null` (`void` is not `string | null`). The reverse direction alone does compile
(fewer parameters, and any return type satisfies `void`), which is why the pair-swap is the property
that holds and not a claim about either slot on its own. Re-run this before adding a fourth parameter.

### The mount — `src/renderer/src/App.tsx`

`<SystemPromptData />` as the **twelfth** headless leaf, beside `RunConfigLiveData`. App-level for the
reason its neighbours are, with one sharpening specific to this arm: a reply answers an ask fired from
the activation seam, and it can land after the operator has navigated on, so a screen-scoped listener
would drop exactly the reply the gate exists to adjudicate.

**Per the ticket's first technical note, after editing this file I grep the mount run and check that
every bridge import still has a matching call** — a hunk here has previously deleted its neighbour's
call while leaving the import standing, invisible to build, typecheck and every unit test.

### The ask — `src/renderer/src/PairedShell.tsx`

`activateDeps.requestConversationConfig` gains a **third call**, not a fourth deps member. That
member's docstring already argues the case: the requests are one act ("re-ask for what the switch just
invalidated"), they always fire together, and a fourth `(conversationId: string) => void` member would
take this interface to four identical signatures whose only cross-wire defence is that they land in
different places.

Placement is unchanged and **is** AC1: `requestConversationConfig` runs **outside** the id gate and
last, so a re-open of the already-open chat re-asks, and the ask still follows the clear branch it
depends on.

### The drop — three dep bodies, one act

`clearRunConfig`'s body gains `systemPromptStore.getState().clearReading()` at all three production
sites, which are AC3's map exactly:

| Site | Seam |
|---|---|
| `PairedShell.tsx` `activateDeps` | switching to a different chat (inside `activateConversation`'s id gate) |
| `PairedShell.tsx` `exitConversationDeps` | leaving to the list on a delete or an archive |
| `clearServerScopedState.ts` `serverScopedClearDeps` | unpairing the server the chat belonged to |

**The member is not renamed.** `clearRunConfig` names the act — "this chat's configuration is no
longer the one to show" — not the store list; renaming would cascade across two interfaces, three deps
objects and their tests for no behavioural gain, which is the adjacent refactoring CLAUDE.md forbids.
The two interfaces' docstrings currently say *both stores*; they become *three stores* and name this
one. **No interface changes** — `clearRunConfig` stays `() => void` at both declaration sites.

**Inside the gate in `activateConversation`, unconditional in `exitActiveConversation`** — inherited
placement, and it is what makes AC3's final clause ("NOT dropped on a re-open of the chat already
open") true by construction rather than by a new guard.

**`clearPairingScopedState` is deliberately not joined**, per the ticket and `runConfigStore`'s own
posture. Its discriminator is whether a store re-asserts itself; this one does, on the next
activation — and after a whole-app unpair `clearActiveConversation()` has run, so the next
activation's `previous?.id !== conversation.id` is necessarily true and the clear branch fires. A
member there would guard state nothing can read.

## State + concurrency model

One app-singleton slice; one app-lifetime subscription owned by `SystemPromptData`, whose off handle
is the effect's cleanup, so a StrictMode double-mount nets exactly one live listener and window
teardown removes it. **No timer, no interval, no promise, no `AbortController`** — `sendCommand` is
`void` fire-and-forget and nothing here awaits anything, so there is no long-lived async job and
nothing to cancel beyond the one unsubscribe.

**No check-then-act race.** The gate reads `getOpenConversationId()` and calls `setReading` with no
`await` between them, on the renderer's single thread. The ordering that matters is
`activateConversation`'s existing one — clear (inside the gate) precedes ask (last, outside it) — so a
reply landing in the same tick as a switch cannot be blanked by the clear that was sent to repair it.

**The getter is called per event, inside the listener, never resolved once at subscription.** This
listener is app-lifetime, so a closure capture would freeze the open conversation at mount and
reinstate #1176's defect in a new shape — while compiling and passing every single-event test. The
defence is a test that emits twice across a moving getter.

`null` from the getter — nothing open — matches no reply, since the resolved `conversationId` is
always a string. A reply arriving with no conversation open therefore lands **nowhere** rather than
latching until one opens (AC4).

## Error handling

| Layer | Result | Behaviour |
|---|---|---|
| `requestSystemPrompt` (renderer sender) | `void` | Falsy `conversationId` → **nothing sent**. No throw path, no result to await |
| `router.route(id)` (main, landed #1230) | — | The enforcing refusal: an id no server claims puts no frame on any wire |
| `translateSystemPrompt` | `SystemPromptReading \| null` | `null` means **not our arm**, never "bad data" — a malformed payload was already rejected fail-closed at `parseSystemPromptPayload` and no event was emitted at all |
| the attribution gate | — | A reply naming any conversation but the open one returns before the setter; no partial write, no coerced id, no `?? activeConversation` fallback |
| `setReading` / `clearReading` | `void` | Unconditional whole-value writes; nothing validates, coerces or throws |
| the daemon | — | **No error frame exists for this verb.** Every unresolvable case comes back as an ordinary `no_session` reading — not a failure this client can distinguish, and nothing here tries to |

**Nothing retries, nothing spins, nothing blocks.** A conversation whose reply never arrives sits at
`reading === null` permanently, and that is a normal state rather than an error. It carries one
limitation worth stating because it diverges from the pushed frames: `system_prompt` is reply-only, so
`null` after an activation means either *still in flight* or *never coming*, and a consumer cannot
tell which. #1078 must therefore not block its editor on this value.

## Testing strategy

All vitest, node environment. No Playwright spec: nothing in the window renders this value in this
slice, so there is no interaction to drive.

**`systemPromptStore.test.ts` (new)** — per-test `createSystemPromptStore()` instances:
- initial state is `reading: null`, and `initialSystemPromptState` is what a cleared store returns
  **by reference**
- the tri-state survives a write as three distinct held values: absent → `undefined`, `''` → `''`,
  text → text; specifically, an explicitly empty prompt is not held as absent
- each of the three `sessionPromptStatus` values is held verbatim, independent of the prompt —
  including text beside `no_session` and an absent prompt beside `matches`
- `setReading` replaces the whole value (most-recent-wins, no merge)
- `clearReading` returns to the **distinct** not-loaded state, never to a zero-valued reading; it is
  idempotent, and a redundant clear is `Object.is`-stable

**`systemPromptBridge.test.ts` (new)** — plain spies, no React:
- `translateSystemPrompt` maps the owned arm to a fresh literal carrying neither `type` nor
  `conversationId`, and every other arm to `null`
- the tri-state and the status cross the translator unchanged and independently
- **the gate**: a reply naming the open conversation is held; one naming another is dropped; one
  arriving while the getter returns `null` is dropped
- **the per-event read**: two replies emitted across a getter whose answer changes between them — the
  first held, the second dropped — which is the test a closure capture would fail and a
  single-event test would not
- `requestSystemPrompt` sends exactly one command with a fresh one-field payload; `null` and `''`
  each send **nothing**
- `subscribeSystemPrompt` returns the injected off handle

**Non-vacuity, mutation-checked and reverted**, recorded in `## Revisions`: deleting the gate's early
return, and replacing `systemPrompt` with `event.systemPrompt ?? ''` at the translator, must each
redden at least one test.

Not tested, and stated so the verifier need not hunt for it: the three `clearRunConfig` dep bodies,
the `requestConversationConfig` body and the `App.tsx` mount are **structurally uncoverable** —
`vitest.config.ts` is `environment: 'node'` globally, so no spec in this repo runs a React effect, and
these are wiring objects rather than pure functions. `tsc` plus review is the whole safety net, which
is exactly why the ticket's first technical note demands the post-edit grep of the mount run.

## Open questions

1. **Does `clearRunConfig` deserve a rename now that it clears three stores?** Resolved in the design
   above: no — the member names the act, and renaming is a cascade CLAUDE.md forbids. Recorded here
   so the verifier reads the decision rather than inferring an oversight.
2. **Should the store be keyed by `conversationId` (`modelListStore`) or single-slot
   (`runConfigStore`)?** Resolved: single-slot, per the ticket's explicit instruction, and it is the
   right shape independently — the value is reply-only and scoped to the chat being read, and a keyed
   store would need its own eviction policy for a value that has exactly one live reader.
3. **Does anything need to survive a `connected` edge?** Resolved: no, and it is out of scope by the
   ticket. Confirm during implementation that nothing in the design implies one.

## Security review

**Verdict:** PASS

**Findings:**

**1. Trust boundaries.** Two fields on one arm at **two different trust tiers**, and the store must
say so rather than let a reader assume one. `systemPrompt` is **untrusted operator-authored text
relayed over the network** — the most sensitive string on the `DaemonEvent` union after the timeline's
replayed content. `sessionPromptStatus` is a **client-owned literal** narrowed at the decode boundary
against constants, so no daemon string crosses on that field. `conversationId` is likewise
client-owned, resolved in main from this app's own outbound request — never parsed off the network.
The renderer-side boundary is a single named function, `translateSystemPrompt`, and past it the
payload is consumed once as a fresh literal.

*SHOULD FIX* — the store header must **restate** the denied-sink list for its own reader rather than
inheriting it by reference from `events.ts`. That inherited contract is a claim about the *previous*
consumer, and this ticket's consumer (#1078) is a **rendering and editing** surface, which is exactly
where a skimmed inherited clause goes quietly false. The list, restated: never markup (no `innerHTML`,
no `dangerouslySetInnerHTML`), never an attribute or a URL, never a filename, a cache key or a lookup
path, and never a React `key`.

**2. Tokens, secrets, credentials.** None minted, stored, read, rotated or transported. `conversation_id`
is a routing id, not a secret — naming a conversation is not authorization, which is pairing at the
Noise handshake. The system prompt is not a credential, but it is operator-authored configuration that
may carry project context, so it takes the **at-rest** treatment even though it is not a token:
`createSystemPromptStore` takes **no storage port**, and nothing on this path reaches
`localStorage`, `sessionStorage`, IndexedDB or disk. Web storage would outlive the pairing that scoped
the value, so a persisted copy would survive every clear in AC3 with all in-memory assertions still
green.

*SHOULD FIX* — state in the store header that this store takes **no zustand middleware, ever**.
`persist` would write operator prompt text to web storage (defeating AC3 silently); `devtools` would
expose it to any Redux DevTools session, which is #126's threat model — the renderer console and
DevTools are readable by anything that can open them. Neither is present today and the header is what
keeps a later ticket from adding one as a convenience.

**3. File / storage operations.** Not applicable, and by construction rather than by omission: this
slice performs no filesystem operation at all, and neither the prompt nor the conversation id is ever
joined into a path, a filename or a cache key. No path traversal surface, no TOCTOU, no atomic-write
question, because there is no write.

**4. Inter-process / Electron attack surface.** **Zero new attack-surface lines.** No new IPC channel,
no new `contextBridge` member, no new `ipcMain` handler: the command rides the existing
`COMMAND_CHANNEL` through the generic `sendCommand`, guarded by `isRequestSystemPromptPayload` (landed
#1230), and the event rides the existing daemon-event channel. No `BrowserWindow` option, custom
protocol, deep link or navigation guard is touched.

The one **design decision that closes a real leak** in this category: the new bridge uses `default:
null` and **must not** use `assertNever`. That guard `JSON.stringify`s the whole event into an `Error`
message, which for this arm is the operator's prompt text — an untrusted string into an exception
whose message can reach a console or a crash path. This is why the new subscriber is a fifth
*independent* observer rather than a sixth exhaustive switch. The four exhaustive bridges already took
explicit no-op arms in #1230 and are untouched here; removing one would be a security regression, not
a tidy-up.

**5. Cryptographic primitives.** None used, and none owed. The attribution gate compares
`event.conversationId !== getOpenConversationId()` with `!==` rather than `crypto.timingSafeEqual`,
which is correct rather than a shortcut: both sides are client-owned routing ids, nothing is
unguessable and nothing is a secret, so there is no timing oracle over a secret to close. This is
`modelListStore`'s stated argument for plain `Map.get` applied to a comparison.

**6. Network & I/O.** No socket, no URL, no TLS decision, no timeout to set — this slice never touches
the wire. Two inherited properties are load-bearing and are preserved: the frame is capped upstream by
`MAX_PLAINTEXT_BYTES` before any parse, and **nothing here retries, spins or blocks**. A client-side
retry against an on-path relay that withholds the frame would be a self-inflicted spin. A hostile
relay can drop, delay or reorder this reply — costing a stale or absent reading, never a forged one,
since it cannot read inside the Noise session.

Growth is bounded by construction: a single slot holding one frame's two fields, replaced wholesale,
so a flooding relay costs no accumulation at all.

**7. Error messages, logs, telemetry.** **Nothing on this path logs, on any branch** — no `console.*`
in the store, the bridge, the leaf, or the three dep bodies, and deliberately no "dropped an
unrelated reply" or "no reading yet" diagnostic. The property has to be total to be worth anything: a
content-free count would be the first crack. The renderer console is readable by anything that can
open DevTools (#126), and the only values a diagnostic here could carry are the prompt itself and the
conversation id. `emitDaemonEvent` upstream is log-free by construction; the decode arm logs a byte
length and a one-way hash only. The one remaining sink in the category is the `assertNever` addressed
under §4.

**8. Concurrency.** One subscription, one off handle, no timer, no promise, no `AbortController` —
there is no long-lived async work to own or cancel. StrictMode double-mount nets one live listener;
window teardown removes it. No check-then-act race: gate and write are adjacent and synchronous on the
renderer's single thread, with no `await` between them. The one ordering constraint that matters is
inherited and verified above — clear precedes ask in `activateConversation`, so a reply landing in the
same tick as a switch cannot be blanked by the clear sent to repair it. Duplicate replies (a re-open
re-asking) are idempotent, since the write is a whole-value replace.

**9. Threat model alignment.**
- **Hostile daemon inside the session** — the primary threat here, addressed in depth. A forged reply
  for a request this client never sent matches no outstanding entry in main's correlation map and is
  dropped before any event is emitted; one that gets past that and names a conversation other than the
  open one is dropped by this slice's gate; a malformed one failed the decode closed.
- **Membership probe** — addressed by the daemon's design, and this slice must not undo it.
  `no_session` deliberately merges five daemon states including "not hosted here". This slice branches
  on the status **nowhere** — it holds it and stops — so it cannot be used to separate the merge apart.
- **Unroutable id producing a false reading** — the sharpest threat specific to this verb, and it has
  two independent halves. Because there is no error frame, an empty or unroutable id on the wire would
  draw an ordinary-looking `no_session` reply that the correlation map would file against a real
  conversation, indistinguishable from a true reading. Main's `router.route(id)` lookup is the
  enforcing half (landed #1230); the renderer sender's falsy-id guard is the half this slice adds, and
  it is a security guard rather than tidiness. Traced end to end: an id of `''` cannot reach the wire,
  so no reply can name `''`, so the getter's `?? null` spelling — which does not collapse `''` — is
  safe here.
- **Renderer compromise reaching the transport** — addressed by process placement, unchanged. Keys,
  sockets and the Noise handshake stay in the background process; this slice adds nothing to the
  renderer but a store, a subscription and one payload value. A compromised renderer gains one
  capability — asking for any conversation's system prompt by id and reading the answer — which is not
  new *in kind*, since it can already send `requestSessionSettings` / `requestHistory` / `sendMessage`
  for the same ids, and the daemon serves only what the authenticated session is entitled to.
- **Token theft from disk** — not applicable: nothing here reaches disk (see §2, §3).

**OUT OF SCOPE, named with its owner:**
- **Rendering, escaping and length-bounding the prompt** — #1078, the editor surface. The store ships
  dormant with no DOM sink, so the inert-plain-text render discipline is inherited and discharged
  there.
- **Writing the prompt back** (`set_system_prompt`) — not this slice; the read half only. The tri-state
  is preserved here precisely so that write remains possible without changing the value.
- **A `connected`-edge or turn-end refresh** — deliberately out of scope per the ticket. The ask fires
  on activation and nowhere else.
