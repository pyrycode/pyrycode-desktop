# #748 — Feed the per-conversation activity store from the four daemon arms

Child B of #674. Sibling of #747 (the holder) and #749 (the clears).

## Files to read first

| Path | What to extract |
|---|---|
| `src/renderer/src/store/conversationActivityStore.ts:24-32` | The HARD IMPORT CONSTRAINT and the sentence that assigns this ticket the `isTurnRunning` derivation. Read it before the design call below — it scopes the constraint to the *store module*, not to this bridge. |
| `src/renderer/src/store/conversationActivityStore.ts:93-99` | The four setter signatures this path calls. Every one is `(conversationId: string, value: boolean) => void`. |
| `src/renderer/src/store/conversationActivityStore.ts:140-151` | The two guard properties this spec leans on: a first write of `false` still creates the entry, and a verbatim repeat churns no listener. Both are why the write rules below can be unconditional. |
| `src/renderer/src/store/backgroundTaskRosterBridge.ts:1-17`, `:27-46`, `:118-202` | The precedent, top to bottom: header shape, the fresh-named-field-literal rule, the injected-`onDaemonEvent` subscriber, and the headless `…Data` leaf. Copy the posture; the one departure is argued in § Design. |
| `src/renderer/src/store/backgroundTaskRosterBridge.test.ts:1-60` | The test idiom — plain `vi.fn()` spies, no React except `renderToStaticMarkup` for the leaf, the real store wired only for the seam test. Note `:15-18`, which records that the precedent *rejected* a tagged union; § Design answers it. |
| `src/shared/ipc/events.ts:111-125` (`turnState`), `:126-145` (`stallDetected`), `:146-172` (`apiRetry`), `:173-199` (`compacting`) | The four owned arms and their required `conversationId`. `:116-117` states the `?? activeConversation` ban this path must honour; `:165-167` and `:195-197` state that neither `apiRetry` nor `compacting` is deduped upstream. |
| `src/shared/wire/types.ts:278` | `WireTurnState = 'thinking' \| 'responding' \| 'idle'` — the type on `turnState.state`. |
| `src/renderer/src/store/threadTimeline.ts:11`, `:190-225` | `TurnPhase` (structurally identical to `WireTurnState`) and the four existing chrome scalars, whose clear semantics § Design mirrors per key. |
| `src/renderer/src/store/threadTimeline.ts:356-381` | The `turnState` reducer arm. Its comment — "Turn activity — clears a live stall (AC2, 'any state, including idle')" — is the shipped rule this path reuses rather than re-invents. |
| `src/renderer/src/store/timelineBridge.ts:43-46`, `:96-120` | How the open-conversation subscriber consumes the same four arms and drops the id. Untouched by this ticket; read it to confirm the two paths do not overlap. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1337-1345` | `isTurnRunning` and its doc — the predicate to reuse. `:1185` and `:1413` are its two existing consumers. |
| `src/renderer/src/App.tsx:8-14`, `:66-92` | The seven headless leaves, their comment idiom, and the JSX fragment this ticket adds an eighth to. |
| `src/renderer/src/PairedShell.tsx:4` | Proof that `ConversationScreen` is *already* in the app's static boot graph — the fact that prices the design call at zero bundle cost. |
| `vitest.config.ts:26-27` | `environment: 'node'` globally. There is no jsdom tier; the bridge test must not need a DOM. |

## Design source

N/A — this ticket ships no rendered surface. It is a data path from four already-typed daemon
events into an existing store; the sidebar that draws from it is #676, which carries the Figma
anchor. The visual-fidelity check is intentionally not applicable here.

## Context

`conversationActivityStore` (#747) holds four booleans per `conversationId` and has no writer.
`timelineBridge` already consumes the same four arms for the open conversation and drops the
`conversationId` at each — it keeps doing exactly that, untouched. This ticket adds a **second,
independent subscriber** on the one daemon-event channel, in the `queueBridge` / `sessionIdBridge` /
`backgroundTaskRosterBridge` posture: reactive-only, no command sent, no connected-edge fetch, no
request half.

Three of the four facts arrive as the boolean the store holds. The fourth is derived.

## Design

### The one design call: reuse `isTurnRunning`, importing it from `screens/`

**Decision: import `isTurnRunning` from `screens/conversation/ConversationScreen` into the new
bridge module.** Not re-derived, and not relocated.

The ticket frames this as reuse-vs-re-derivation and asks for a weighing. Here it is.

Re-deriving is rejected outright: a gate written against one phase literal is exactly the #648
defect, where the signal vanishes for the tool-heavy bulk of a turn. A second copy of a predicate
that has already drifted once is not a trade-off, it is the known failure.

That leaves reuse, and reuse has two shapes — import it where it lives, or move it somewhere
neutral. The move is the structurally prettier one: `isTurnRunning` is a pure function of
`TurnPhase`, and `TurnPhase` is defined in `threadTimeline.ts:11`, so the predicate arguably belongs
beside its own parameter type. **It is still the wrong call here**, for three reasons that are
countable rather than aesthetic:

1. It is a refactor of code this ticket does not otherwise need to touch — `ConversationScreen.tsx`
   and `threadTimeline.ts`, two of the largest and most heavily cited files in the renderer — which
   CLAUDE.md forbids ("touch only what the task needs").
2. It would falsify `conversationActivityStore.ts:26-27`, which names the predicate's current home
   by file and line. That correction is a third and fourth production file for a move that buys
   nothing behavioural.
3. The objection the move exists to answer does not apply. `conversationActivityStore.ts:24-32`
   scopes its import ban to **that module** — "a store whose tests run with no React and no DOM" —
   and in the same breath names this ticket as the owner of the derivation *with* `isTurnRunning`.
   A bridge is not that module: `backgroundTaskRosterBridge.ts:18` already imports `react`.

So the import's real costs are the two below, and both are already paid:

- **Bundle.** None. `App.tsx:2` statically imports `PairedShell`, which statically imports
  `ConversationScreen` at `PairedShell.tsx:4`. The screen's module graph is evaluated at app boot
  today, on every route.
- **Test weight.** None that is new. `vitest.config.ts:27` sets `environment: 'node'` globally, and
  `ConversationScreen.test.tsx` already loads that whole graph — `./conversation.css` included, which
  Vite stubs — under that exact environment.

What the import *does* cost is a first `store/ → screens/` edge, where every existing arrow runs the
other way. That is a genuine precedent cost and the bridge's header comment must name it, say it is
deliberate, and say what keeps it bounded: it is a **type-and-predicate-only import of one pure
function**, it introduces no cycle (nothing under `screens/` imports this bridge), and the store
module's own hard constraint is untouched and still grep-checkable.

If a later ticket needs the same predicate from a second store-side module, that is the signal to
relocate it — one consumer is an import, two is a home.

### Module shape

One new file, `src/renderer/src/store/conversationActivityBridge.ts`, with four exported symbols
following `backgroundTaskRosterBridge.ts`: a write-intent union, a pure translator, a subscriber
taking injected effects, and a headless `…Data` leaf.

**The write-intent union.** A `readonly` array of these is what the translator returns.

```ts
export type ConversationActivityWrite =
  | { fact: 'turnRunning'; conversationId: string; turnRunning: boolean }
  | { fact: 'stalled'; conversationId: string; stalled: boolean }
  | { fact: 'apiRetrying'; conversationId: string; apiRetrying: boolean }
  | { fact: 'compacting'; conversationId: string; compacting: boolean }
```

Three properties are load-bearing and each must be stated in the file's comments:

- The payload field is **named after the fact**, not a shared `value`. With a shared `value` a
  cross-wire is a tag swap that compiles; with named fields, `{ fact: 'stalled', turnRunning: false }`
  is a type error. This is the same class of bug #747's review found (a cross-wired setter passed all
  22 of its tests), made unrepresentable rather than tested for.
- The member names are the store's own `ConversationActivityEntry` field names, so a write reads
  against the setter it will reach. They deliberately do **not** mirror the wire arm names — the
  mapping is not one-to-one (`turnState` writes two facts; `apiRetry` → `apiRetrying`).
- The discriminant is `fact`, not `type`. CLAUDE.md's `type`-discriminant convention is scoped to
  incoming daemon events and outgoing user actions; this is neither. `fact: 'stalled'` sitting beside
  `event.type === 'stallDetected'` inside the same switch is the disambiguation, not a drift from it.

**The translator.** One function, one switch, React-free and listener-free:

```ts
export function translateConversationActivity(
  event: DaemonEvent
): readonly ConversationActivityWrite[]
```

Each case builds **fresh named-field literals** — never `return event`, never a spread — so a field a
later arm gains cannot enter a write unit that never agreed to hold it (the
`backgroundTaskRosterBridge.ts:28-31` idiom). `default: []`, never `assertNever`: unowned arms
falling through is this path's permanent intended behaviour, not an exhaustiveness gap.

This is the spec's one departure from the precedent, which recorded at
`backgroundTaskRosterBridge.test.ts:15-18` that it chose three sibling single-arm filters *over* a
tagged union. The difference is that there the arm→setter mapping was one-to-one, so each filter was
a whole rule. Here `turnState` writes **two** facts. Under sibling filters that rule has no single
home: either a fifth filter switches on `turnState` a second time — leaving the coupling invisible
from both — or the stall clear moves into the subscriber, where the precedent deliberately keeps only
the `connected` reset. The union keeps the entire derivation, the clear coupling included, inside one
pure function a test can call directly. It is also the smaller surface: one exported type against
four, and one switch against five.

This does **not** contradict `conversationActivityStore.ts:15-18`, which rejects "a discriminated-union
action set" — that argument is about the *store's* API, and the store keeps its four named setters
untouched. The union here is a translator return type on the way to those setters, and it exists for
the reason the store's does not: `turnState` fans one arm out to two of them.

**The subscriber.** Injected `onDaemonEvent` plus the four setters as injected effects, so the whole
path is unit-testable with plain spies and no store:

```ts
export function subscribeConversationActivity(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setTurnRunning: (conversationId: string, turnRunning: boolean) => void,
  setStalled: (conversationId: string, stalled: boolean) => void,
  setApiRetrying: (conversationId: string, apiRetrying: boolean) => void,
  setCompacting: (conversationId: string, compacting: boolean) => void
): () => void
```

The listener translates, then applies every write in the returned array in order. There is **no
early return after the first match** — that is the precedent's shape, and it would drop the second of
`turnState`'s two writes. The apply step switches on `write.fact` and **is** exhaustive
(`assertNever`), because that union is ours: a fifth fact must not compile until it has a dispatch
case. The switch is unreachable at runtime by construction, matching the reducer's own guard at
`threadTimeline.ts:227-229`.

Every write passes `write.conversationId` — the event's own id. The open conversation is never read
here; `activeConversationStore` is not imported, so the `?? activeConversation` fallback that
`events.ts:116-117` bans is unavailable rather than merely avoided.

**The mount.** `ConversationActivityData(): null` — a headless component (not a hook), mounted in
`App.tsx` as the eighth leaf, after `<AnnouncedModelData />`. It dereferences `window.pyry` only
inside the effect, never during render, so `<App/>` still server-renders to `''` without a bridge
stub (the QueueData invariant). The returned off-handle is the effect cleanup, so a StrictMode
double-mount nets exactly one live listener. `App.test.tsx` asserts no leaf count, so this is additive
with no test cascade.

### Per-fact write and clear rules

| Arm | Writes | Rule |
|---|---|---|
| `turnState` | `turnRunning = isTurnRunning(event.state)` **and** `stalled = false` | Replacement truth for the phase; any state — `idle` included — clears a live stall. |
| `stallDetected` | `stalled = true` | Onset-only; the arm carries no payload beyond the id. |
| `apiRetry` | `apiRetrying = event.active` | The wire's own edge, copied. `current` / `total` are **not** carried — this store holds liveness, not the counter. |
| `compacting` | `compacting = event.active` | The wire's own edge, copied. |

Two of these need their reasoning pinned in the file.

**`turnRunning` needs no cast.** `event.state` is `WireTurnState`; `isTurnRunning` takes `TurnPhase`.
They are the same literal union declared on both sides of the boundary, and `timelineBridge.ts:44-46`
already assigns one to the other with no cast and no import — a rename, not a re-validation. Do the
same; do not import `TurnPhase` here and do not widen `isTurnRunning`'s parameter.

**The stall clear is unconditional on `turnState`, and that is a reuse.**
`threadTimeline.ts:356-359` clears `stalled` on any `turnState` including `idle`, and this path adopts
that verbatim rather than inventing a per-key variant. Writing `setStalled(id, false)` on every
`turnState` — rather than only when the phase is running — is both simpler and free: the store's
per-field guard (`conversationActivityStore.ts:140-151`) makes a redundant clear churn no listener,
and a first write of `false` still creates the entry, which is the correct reading (this conversation
has been observed and is not stalled).

`apiRetrying` and `compacting` are deliberately **not** in that clear set, mirroring
`threadTimeline.ts:196-204`: both have an explicit wire falling edge, so a turn-state change arriving
mid-retry or mid-compaction must leave the fact showing. Only an `active: false` clears them.

### Known divergence: a background stall clears later than an open one — named, not fixed

In the open conversation, `stalled` also clears on `assistantDelta`, `toolUse`, `toolResult` and
`userText` (`threadTimeline.ts:284`). **This path cannot do that**, and the reason is structural: those
arms carry no `conversationId` at all — `events.ts:109-110` for the two stream arms, `:459-466` and
`:467-472` for the two tool arms, where the comment says `conversation_id` is "dropped at the emit".
There is no id to key a write on, and redirecting them onto the open conversation is the exact
fallback `events.ts:116-117` bans.

The consequence, stated so #676 inherits it knowingly: a stall in a conversation the operator is not
looking at persists from onset until that conversation's next `turn_state`, which in the ordinary case
is the turn's terminal `idle`. It is **bounded, not latched** — every turn ends with a `turn_state`,
so the fact always clears — but it is coarser than the open conversation's chrome. Closing the gap
needs the four turn-stream arms widened to carry `conversationId`, which is #675's transport work and
is **out of scope here**. Do not approximate it with a timer, a heuristic, or an active-conversation
read.

## State + concurrency model

One store (`conversationActivityStore`, the app singleton), one subscriber, one listener, no timers,
no async task, no `AbortController`, no `await` anywhere on the path.

Every write is a synchronous `set` under zustand's own store lock, dispatched from a single listener
in daemon arrival order. `turnState`'s two writes are two separate synchronous `set` calls, so a
subscriber can observe the intermediate state where `turnRunning` has flipped and `stalled` has not.
That is harmless for the only reader in flight (#676 draws one dot per row from a single entry, and
both writes land in the same task) and is called out here so it is a decision rather than an
oversight. Do not batch them into a compound setter — that would add a fifth setter to a store whose
four-named-setter shape is argued at `conversationActivityStore.ts:15-18`.

Lifetime is the app's, not a screen's: mounted at `App.tsx` level, unconditional, never
subscribed/unsubscribed as the route flips. That is what makes AC4 true — an arm for a conversation
that is not open, and an arm arriving before any reader exists, both land.

Teardown is the single off-handle returned from `onDaemonEvent`, returned as the effect cleanup.
Nothing else is retained: no `useState`, no `useRef`, no module-level mutable variable.

## Error handling

There is no failure mode on this path to surface. It touches no socket, no key, no `ipcRenderer` and
no raw frame; it subscribes through the preload bridge and consumes already-typed events whose
fail-closed decode happened upstream in the main process. Nothing is parsed here, nothing is fetched,
nothing can reject.

- **Unowned arms** are not errors — `default: []`, silently.
- **A malformed or hostile `conversationId`** is not an error either: it is a `Map` key. See § Security
  review.
- **The listener never throws into React.** The only `throw` in the module is the apply-switch's
  `assertNever`, unreachable while the union and its dispatch agree, which the compiler enforces.
- **No `console.*` on any path**, matching the store (`conversationActivityStore.ts:47-49`). The only
  value a diagnostic here could carry is the untrusted id, and the content-free diagnostics rule
  (#126) keeps it out of a file.

## Testing strategy

`src/renderer/src/store/conversationActivityBridge.test.ts` — framework-free, injected spies, node
environment, following `backgroundTaskRosterBridge.test.ts`. Scenarios, not test bodies:

**`translateConversationActivity` (pure, called directly)**

- `turnState` with `state: 'thinking'` → exactly two writes: `turnRunning: true` for the event's id,
  and `stalled: false` for the same id.
- `turnState` with `state: 'responding'` → `turnRunning: true`. **This is AC2's real assertion** — a
  gate written against `'thinking'` alone passes the previous scenario and fails this one.
- `turnState` with `state: 'idle'` → `turnRunning: false`, and still `stalled: false`. Asserts the
  clear is unconditional, not gated on running.
- `stallDetected` → one write, `stalled: true`.
- `apiRetry` with `active: true` → one write, `apiRetrying: true`. With `active: false` →
  `apiRetrying: false`. Assert the returned write has **no** `current` / `total` property, so the
  counter cannot leak into this store by a later spread.
- `compacting` with `active: true` / `active: false` → `compacting: true` / `false`.
- Every write's `conversationId` is the event's own, asserted against a fixture whose id differs from
  every other id in the file.
- An unowned arm — pick a shipped one such as `modelAnnounced` or `toolResult` — returns `[]`, not a
  throw.

**`subscribeConversationActivity` (spies)**

- Each of the four arms calls exactly its own setter(s) with `(event.conversationId, expectedValue)`,
  and calls none of the others. Assert the negative for all three unwritten setters on each arm —
  cross-wiring is the failure this catches.
- A `turnState` arm calls **both** `setTurnRunning` and `setStalled`. A test that stops at the first
  is the one that would let the early-return regression through.
- The returned handle is the one `onDaemonEvent` returned, and calling it is the only teardown.
- An unowned arm calls no setter at all.

**Seam test with the real store** (`createConversationActivityStore()`, not the singleton)

- Two conversations interleaving: an arm for `c1` leaves `selectActivityFor('c2')` `Object.is`-identical
  to what it was before. This is AC1's "leaves every other conversation's entry untouched" and AC3's
  "one conversation's clear touches only its own entry" in one assertion.
- A conversation the client has never opened receives an arm and its entry exists afterwards — the
  store is not consulted about which conversation is open, because nothing here can be.
- A `stallDetected` for `c1` followed by a `turnState` for `c2` leaves `c1` stalled. The stall clears
  only on `c1`'s own `turnState`. Together these are the anti-latch and the anti-bleed assertion.
- Hostile keys: drive the four arms with `conversationId` of `'__proto__'`, `'constructor'` and `''`,
  and **read before writing** — assert `selectActivityFor('__proto__')` is `null` first, then write,
  then assert the entry is exactly the four booleans. Reading only after the write cannot distinguish a
  `Map` from a `Record` (memory: `entries['__proto__']` yields `Object.prototype`, which is not
  nullish, so `?? null` never fires). Assertion **order** is the whole test.

**`ConversationActivityData`**

- `renderToStaticMarkup(createElement(ConversationActivityData))` is `''` with **no** `window.pyry`
  stub — effects do not run under static render, so the dereference-inside-the-effect invariant is what
  is being asserted.

Type-level coverage rides `npm run typecheck`: the write union's named payload fields make a
cross-wired literal a compile error, and the apply switch's `assertNever` makes a fifth union member
without a dispatch case a compile error. Neither needs a runtime test.

## Acceptance criteria mapping

| AC | Where it is satisfied | Where it is asserted |
|---|---|---|
| 1 — each arm writes to its own event's id, other entries untouched | Every write carries `write.conversationId`; `activeConversationStore` is not imported | Translator id assertions + the two-conversation seam test |
| 2 — running in **both** live phases, not one | `isTurnRunning(event.state)`, reused not re-derived | The `'responding'` scenario, which a one-literal gate fails |
| 3 — per-fact clears, per key | `turnState` clears `stalled`; `active: false` clears the other two; neither is cleared by turn activity | The idle-clears-stall, the anti-latch, and the anti-bleed scenarios |
| 4 — live for the app's lifetime | `ConversationActivityData` mounted unconditionally in `App.tsx`, not inside a screen | The static-render test + the never-opened-conversation seam test |

## Out of scope

- **Both clears are #749's** — the `connected` edge and the pairing boundary. The precedent puts its
  reset *inside the very subscribe function this ticket writes* (`backgroundTaskRosterBridge.ts:151-155`),
  which makes folding one in here the easy mistake. Do not. This subscriber has no `connected` branch
  and this ticket registers nothing in `clearPairingScopedState`.
- **Migrating the open conversation's chrome scalars off `threadTimeline`.** `timelineBridge.ts` keeps
  writing them and is not touched.
- **Reading the store is #676's.** Nothing renders from these writes yet, and no selector is added.
- **Relocating `isTurnRunning`**, and any change to `ConversationScreen.tsx` or `threadTimeline.ts`.
  Argued above; revisit when a second store-side consumer appears.
- **Widening the four turn-stream arms with `conversationId`** — #675's transport work, and the cause
  of the stall divergence named above.

## Open questions

None blocking. One judgement recorded rather than deferred: `turnState`'s two writes land as two
`set` calls, so an intermediate state is observable. Argued harmless in § State + concurrency model
above; if #676's dot ever flickers on that seam, the fix is a batched write in the store, not a
change here.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No findings.** The untrusted-to-trusted boundary for these four arms is
  upstream and unchanged: the fail-closed decode in the main process, which fails the whole line on a
  missing or non-string `conversation_id` (`events.ts:112-114`, `:127-128`, `:149-151`, `:176-178`).
  This path sits entirely on the renderer side of the preload bridge and consumes already-typed
  events. It adds no boundary, revalidates nothing, and parses nothing. The one value that crosses
  into new state is `conversationId`, whose classification is fixed by the arms' own comments — a
  daemon-asserted **routing key**, explicitly not rendered text, and explicitly not carrying the
  untrusted-text warnings attached to `model` / `description` / `raw`.
- **[Tokens, secrets, credentials] Not applicable, by construction.** No token, key, or credential is
  read, held, derived, compared, or transported. The module's entire import set is `react`,
  `@shared/ipc/events` (types only), the activity store, and one pure predicate. Nothing on the path
  can reach a secret to leak one.
- **[File / storage operations] Not applicable, and the absence is enforced.** No filesystem access,
  no path construction, no `localStorage` / `sessionStorage` / IndexedDB. The store it writes into is
  in-memory only and `conversationActivityStore.ts:49-51` pins that deliberately — web storage would
  survive the pairing boundary #749 exists to enforce. This ticket must not add persistence, and
  reviewers should treat any `localStorage` here as a MUST FIX on sight.
- **[Inter-process / Electron attack surface] No findings.** No `BrowserWindow`, no `webPreferences`,
  no `contextBridge` API, no `ipcMain` channel, no custom protocol, no navigation handler. The path
  subscribes through the existing preload bridge (`window.pyry.onDaemonEvent`) and never touches
  `ipcRenderer` directly. The IPC surface is unchanged in both directions — this adds a *listener*,
  not a channel.
- **[Cryptographic primitives] Not applicable.** No randomness, no hashing, no comparison against a
  secret, no Noise involvement. `isTurnRunning`'s two `===` comparisons are against client-owned
  string literals, not secrets, so `timingSafeEqual` does not apply.
- **[Network & I/O] Not applicable.** No socket, no URL, no frame, no timeout, no reconnect. Frame
  size caps and relay-URL validation live in the main-process transport and are untouched.
- **[Error messages, logs, telemetry] No findings, and this is the category with a live hazard.** The
  path is **log-free by construction** — no `console.*` on any branch, matching the store
  (`conversationActivityStore.ts:47-49`) and the decode-side content-free pins on all four arms. The
  hazard being avoided is specific: the only value a diagnostic here could carry is the untrusted
  `conversationId`, and the renderer console is readable by anything that can open DevTools. A
  debug log of a write — the obvious thing to add while developing this — would put daemon-asserted
  text into that console and violate #126. The `assertNever` in the apply switch is the one place a
  string could reach an error message; it must stringify **the write's `fact` discriminant only**,
  never the whole write object and never the `conversationId`. Called out because the repo's own
  `assertNever` idiom (`threadTimeline.ts:227-229`, `App.tsx:18-20`) uses `JSON.stringify(event)`,
  which here would embed the untrusted id in a thrown message. **Diverge from that idiom on purpose.**
- **[Concurrency] No findings.** One listener, no async task, no timer, no `AbortController`, no
  `await` — so there is no check-then-act gap across a suspension point and nothing to cancel beyond
  the single off-handle returned as the effect cleanup. StrictMode double-mount nets one live
  listener. No duplicate-subscription path exists because the leaf is mounted once, unconditionally,
  at app level. Unbounded growth is worth naming: the store gains one entry per distinct
  `conversationId` the daemon names since app start, and **this ticket is the first thing that makes
  that count non-zero.** A hostile or buggy daemon streaming arms under ever-changing ids grows the
  map without bound. That is accepted here rather than solved: the eviction and reset paths are
  #749's, the bound is already stated at `conversationActivityStore.ts:157-159`, and each entry is
  four booleans plus one id string. **OUT OF SCOPE — #749.**
- **[Threat model alignment] Addressed by inheritance, with one item deferred.** *Malicious relay* —
  content-blind and on-path; it can drop, delay, reorder or flood these frames. Dropping or delaying
  degrades to a stale dot, never a leak. Reordering is survivable because every fact is replacement
  truth per key with no accumulator and no counter, so the last frame wins and no ordering invariant
  can be violated. Flooding is the growth item deferred to #749 above. *Hostile daemon response* —
  the id is used as a `Map` key and nothing else; see the next paragraph. *Renderer compromise
  reaching the transport* — unchanged, because this path holds nothing a compromised renderer does
  not already have. *Token theft from disk* — not applicable; nothing is persisted.
- **[Hostile-key handling — the one thing a developer can silently break here] No findings, guarded
  by test.** `conversationId` is daemon-asserted untrusted text used **only** as a `Map` key: never
  stored inside an entry, never rendered, never concatenated, never a filename, a cache key, a URL,
  or an attribute, and never compared against a secret. The store's `ReadonlyMap` is what makes
  `'__proto__'`, `'constructor'` and `''` three unremarkable keys by construction rather than by
  validation, and the write path must therefore use **no computed object keys** — every fact is a
  property shorthand in a fresh named-field literal at a named call site, so there is no `{ [x]: v }`
  whose key provenance a reviewer must trace. The write union's shape enforces this: `conversationId`
  is a *value* on the write, never a key. This is fragile in a specific way worth restating — swapping
  the store's `Map` for a `Record` produces no type error and breaks no other assertion, so the
  read-before-write hostile-key scenario in § Testing strategy is the only thing standing between the
  codebase and a prototype-pollution lookup. It is not optional.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-25
