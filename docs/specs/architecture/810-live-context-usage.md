# #810 — Keep the context-usage figures live outside the run-config sheet

**Size:** S (3 production files, 1 of them new; ~200 LOC total including tests)
**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/810 (split from #684)
**Labels:** `security-sensitive` → the security-review pass at the end of this spec is mandatory and PASSed.

## Design source

N/A — no `## Figma` section in the ticket body, and none is needed: this slice adds no visible
surface. It renders nothing new; the Context window gauge (`RunConfigSections`, #192) is untouched
and simply reads fresher numbers out of the store it already reads. Code review's visual-fidelity
check is intentionally not applicable here.

## Files to read first

Codegraph is wired for this repo but **not indexed** — `.codegraph/` holds a config and no DB, and
every `codegraph_*` call returns `CodeGraph not initialized`. This list was built by grep + Read
instead; do not spend a turn re-probing codegraph.

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/runConfigSnapshot.ts` (whole file, 105 lines) | The three helpers you will reuse **verbatim**: `toRunConfigSnapshot`, `toSnapshotSessionId`, `requestRunConfigSnapshot`, and `subscribeRunConfig` (lines 93-104). This file is **not modified by this ticket** — read it to know what already exists so you don't rebuild it. |
| `src/renderer/src/screens/conversation/RunConfigData.tsx:1-43` | The container you shrink. Its subscribe effect (18-29) moves out; its one-shot-ref request effect (31-40) stays exactly as written. |
| `src/renderer/src/store/conversationListBridge.ts` (whole file, 149 lines) | **The shape to clone.** One `.ts` module holding React-free injected helpers *plus* the headless `ConversationListData(): null` leaf. `shouldRefreshList` (53-59) is the refresh-trigger-predicate idiom; `subscribeConversations` (88-98) is the "one listener, refresh callback injected" idiom. |
| `src/renderer/src/store/conversationActivityBridge.ts:106-148, 219-251` | The `turnState` → `isTurnRunning(event.state)` idiom (`WireTurnState` and `TurnPhase` are the same literal union, so it assigns with no cast), and the `event.type === 'connected'` early branch — including the emit-site citation that makes `connected` a per-handshake edge. Also read `:32-39` for the untrusted-`conversationId` security posture you must uphold. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1481-1494` | `isTurnRunning(phase: TurnPhase): boolean` — the predicate you import, never re-derive (`:1488-1491` names its three existing consumers and why re-deriving it is the #648 defect). |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:58, 302-312` | Where `<RunConfigData />` is mounted inside `{sheetOpen && <StatusSheet>…}`. **Unchanged by this ticket** — read it to confirm the sheet mount stays put. |
| `src/renderer/src/App.tsx:1-15, 146-201` | The eight existing headless leaves, their import block, and the comment convention each one gets. You add the ninth. |
| `src/main/index.ts:254-274` | Why the connected edge is reliably observed: the connect is deferred to `did-finish-load` **specifically** so the renderer's daemon-event subscription is live before `connected` arrives, and `live.replayStatus()` re-forwards the held `connected` into a reopened window. This is the evidence AC1 rests on. |
| `src/main/liveWindow.ts:48-66, 152-155` | `isStatusEvent` / `replayStatus` — confirms `connected` is one of the four replayed status members. |
| `src/shared/ipc/events.ts:74, 156` | The two arms you consume: `{ type: 'connected'; ack }` and `{ type: 'turnState'; state: WireTurnState; conversationId: string }`. |
| `src/renderer/src/screens/conversation/runConfigSnapshot.test.ts:152-178` | The `subscribeRunConfig` test setup (the fake `bridge.onDaemonEvent` + emit helper). Your new tests reuse this exact spy shape. |
| `e2e/run-config-settings.spec.ts:204-213` | The one assertion this change breaks: `request_session_settings` count `.toBe(1)`. See § E2E impact. |
| `docs/knowledge/features/run-config-store.md` | The whole existing data path in prose, including the "second ingress into the session-id store" contract you must not disturb. |
| `CLAUDE.md` § Build and test | Renderer specs are static server renders — `environment: 'node'`, no DOM, no effects. This constrains the whole testing strategy below. |

## Context

`runConfigStore` holds `usedTokens` / `windowTokens`; `RunConfigSections` renders them. The only
thing that ever fills that store is `RunConfigData`, mounted **inside the open-only sheet body**
(`ConversationScreen.tsx:302-312`). It mounts on open, unmounts on close. So the figures do not
exist before the first open, and freeze at the moment of that open.

`session_settings` is **reply-only**: `requestRunConfigSnapshot` is its sole sender anywhere in the
tree, and nothing pushes the reply unsolicited. A subscription alone therefore cannot keep the
figures fresh — this path needs its own refresh trigger as well as an app-lifetime listener.

No new wire type, no new IPC command, no main-process change. Everything here is renderer-side.

## Design

### Decision 1 — one always-on subscriber; the sheet keeps its request, loses its subscription

The current `RunConfigData` does two things: subscribe, and request-once-per-open. Split them by
lifetime:

- The **subscription** moves to a new app-level headless leaf, `RunConfigLiveData`, mounted in
  `App.tsx` beside the existing eight. It is the *only* listener that lands `runConfigReceived` into
  `runConfigStore` + `sessionIdStore`.
- The **request** stays in `RunConfigData`, inside the sheet, byte-for-byte as written today
  (one-shot `useRef` guard, one bare `requestSessionSettings` per open).

This satisfies AC3 exactly: opening the sheet still fires its request, the reply still lands the
same two values from the same event through the same `subscribeRunConfig` helper, and the session-id
write keeps its `!== null` gate and its arrival-order-wins contract with `sessionIdBridge`.

**Rejected: leave `RunConfigData` subscribing and add a second subscriber.** While the sheet was
open there would be two listeners writing identical values into both stores on every reply — two
`set()` calls, two notifications, and a duplicated write into the session-id store whose two-ingress
contract is documented precisely because arrival order matters. One listener app-wide is the honest
shape and costs one deleted effect.

### Decision 2 — both edges are predicates over the daemon-event stream, not React state

The connected edge reads `event.type === 'connected'` inside the listener, **not**
`useSessionStore(s => s.status.type === 'connected')` + `useRef` the way `conversationListBridge`
does.

The ticket names `conversationListBridge`'s ref guard as "the shape for the first edge", and this
spec deviates deliberately. Three reasons, in order of weight:

1. **Testability.** `vitest.config.ts` runs `environment: 'node'` globally and no renderer spec in
   this repo can run an effect. A `useRef` + `useSessionStore` edge is therefore *structurally
   uncoverable* — the exact hazard `conversationActivityBridge.ts:150-159` documents. A predicate
   over the event stream is a plain function a test calls directly. The ticket's own technical notes
   ask for exactly this: "**both edge predicates** and the subscribe seam are assertable without
   React."
2. **It is genuinely a rising edge.** `daemonConnection.ts:478` is the one emit site and it fires on
   handshake-complete, so the renderer sees one `connected` per completed handshake — it is never
   re-asserted. `conversationActivityBridge.ts:224-227` already relies on this.
3. **No reliability loss.** `main/index.ts:271-274` defers `connection.start()` to `did-finish-load`
   *specifically* so the renderer's subscription is live before `connected` arrives, and
   `liveWindow.ts:152-155` replays the held `connected` into a reopened window. An app-lifetime
   listener sees the edge in both cases. (The session-store read would have had the same exposure
   anyway — that store is fed from the same event.)

A replayed `connected` into a fresh window fires a request. That is correct, not a duplicate: the new
window's store is empty and needs the reading.

### Decision 3 — the turn-end edge is a `Set` of currently-running conversations

`turnState` is a coarse lifecycle scalar the daemon may re-assert, and it carries a
`conversationId`. AC2 forbids firing on "a turn state that merely re-asserts a phase already held",
so a single daemon-wide boolean is wrong: with two conversations interleaving it both steals edges
(B's `idle` consumes A's) and fires on re-asserted phases. Phase must be held per conversation.

The state is a `Set<string>` holding **only conversations whose turn is currently running**:

- `isTurnRunning(event.state)` → `add(id)`, return `false`
- otherwise → `return set.delete(id)` — `Set.prototype.delete` returns whether the entry was
  present, so the running → not-running transition *is* the return value, in one expression.

Two properties fall out for free. The set self-prunes (an idle conversation leaves no entry, so it
is bounded by concurrently-running turns rather than by lifetime conversation count), and a `Set`
never does `obj[key] = value`, so daemon-supplied ids cannot reach a prototype setter (see § Security
review, category 1).

The request stays **daemon-wide**: `requestSessionSettings` is bare and its reply is daemon-wide
(#491), so there is no id to filter on. A turn ending in *any* conversation is a turn-end edge here.

`connected` also **clears the set** before returning `true` — same discriminator
`conversationActivityBridge.ts:189-198` applies to `clearAllActivity`: a turn that was running when
the socket dropped may have finished while it was down, so its liveness must not survive the
handshake. One line; it removes the stale-entry class entirely.

### Decision 4 — the new module is a `conversationListBridge`-shaped `.ts`, and why it is a separate file

Everything new lands in **one new module**,
`src/renderer/src/screens/conversation/runConfigLive.ts`, holding the React-free helpers *and* the
headless leaf — exactly `conversationListBridge.ts`'s shape (a `.ts`, not `.tsx`: the leaf returns
`null` and needs no JSX).

It **cannot** live in `runConfigSnapshot.ts` or `RunConfigData.tsx`, and this is load-bearing rather
than taste: the refresh trigger imports `isTurnRunning` from `ConversationScreen.tsx`, and
`ConversationScreen.tsx:58` imports `RunConfigData.tsx`, which imports `runConfigSnapshot.ts`.
Putting the trigger in either of those two files closes a genuine import cycle
(`ConversationScreen → RunConfigData → runConfigSnapshot → ConversationScreen`). Nothing in
`ConversationScreen`'s graph imports the new module, so it introduces none.

Re-deriving the phase test locally instead of importing `isTurnRunning` is **not** an option —
`ConversationScreen.tsx:1488-1491` and `conversationActivityBridge.ts:20-30` both record why (a gate
written against one phase literal makes the signal vanish for the tool-heavy bulk of a turn, the
#648 defect verbatim). Relocating `isTurnRunning` out of `ConversationScreen` is also rejected:
`conversationActivityBridge.ts:22-30` weighed exactly that and declined, and it would refactor two of
the renderer's largest files for no behavioural gain.

### Decision 5 — two listeners in the leaf, with disjoint jobs

`RunConfigLiveData` registers **two** `onDaemonEvent` listeners:

1. `subscribeRunConfig(...)` — **unchanged, imported as-is** from `runConfigSnapshot.ts`. Lands the
   snapshot and the session id. Zero edits to that file, zero edits to its eight existing test call
   sites.
2. `subscribeRunConfigRefresh(...)` — new. Owns the trigger and re-requests on a true edge.

They touch disjoint state and can never cross-fire (an event is never both a `runConfigReceived` and
an edge), which is the arrangement `conversationDeletedBridge.ts:37-42` documents for exactly this
case. Registration order is irrelevant: an edge sends a request whose reply arrives later, and a
reply is not an edge.

`conversationListBridge` folds both jobs into one listener, and this spec deliberately does not —
doing so would mean widening `subscribeRunConfig`'s signature (which, with three same-shaped function
parameters, would need the named-deps-object treatment of `ConversationActivityDeps` to stay
cross-wire-safe) and editing nine call sites, to save one `ipcRenderer.on` registration. Not worth
it.

### New surface

```ts
// src/renderer/src/screens/conversation/runConfigLive.ts  (NEW)

export function createRunConfigRefreshTrigger(): (event: DaemonEvent) => boolean
// Stateful factory — one closed-over Set<string> of running conversation ids per instance.
// `connected` → clear the set, return true. `turnState` → running ? (add, false) : set.delete(id).
// Every other DaemonEvent → false (plain `default`, not assertNever: ignoring the rest is permanent).

export function subscribeRunConfigRefresh(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  refresh: () => void
): () => void
// Creates ONE trigger per subscription (state is per-subscription, never module-level), calls
// `refresh` on each true edge, returns the off handle as cleanup. The listener only dispatches.

export function RunConfigLiveData(): null
// The ninth headless leaf. Two mount effects, each returning its off handle as cleanup:
//   1. subscribeRunConfig(window.pyry.onDaemonEvent, setSnapshot, setSessionId)   [moved verbatim
//      from RunConfigData]
//   2. subscribeRunConfigRefresh(window.pyry.onDaemonEvent,
//        () => requestRunConfigSnapshot(window.pyry.sendCommand))
// `window.pyry` is dereferenced only inside the effects, never during render, so it server-renders
// to '' without a bridge mock (the QueueData / ConversationActivityData invariant).
```

### Files changed

| File | Change | Prod? |
|---|---|---|
| `src/renderer/src/screens/conversation/runConfigLive.ts` | **NEW** — the three exports above | yes |
| `src/renderer/src/screens/conversation/RunConfigData.tsx` | delete the subscribe effect (18-29) and its two now-unused imports; keep the request effect verbatim; update the file header to say the subscription now lives app-level | yes |
| `src/renderer/src/App.tsx` | import + mount `<RunConfigLiveData />` as the ninth leaf, with the comment each leaf gets | yes |
| `src/renderer/src/screens/conversation/runConfigLive.test.ts` | **NEW** — see § Testing strategy | no |
| `e2e/run-config-settings.spec.ts` | one assertion + its comment — see § E2E impact | no |

**3 production files, 1 of them new.** `runConfigSnapshot.ts`, `runConfigStore.ts`,
`sessionIdStore.ts`, `RunConfigSections.tsx`, `ConversationScreen.tsx`, `RunConfigData.test.tsx` and
everything under `src/main/` and `src/shared/` are **untouched**.

### Data flow

```
App mounts → <RunConfigLiveData/>
  → subscribeRunConfig(onDaemonEvent, setSnapshot, setSessionId)      [app-lifetime, the only lander]
  → subscribeRunConfigRefresh(onDaemonEvent, () => requestRunConfigSnapshot(sendCommand))

connected (handshake complete, or replayStatus into a reopened window)
  → trigger: clear the running set, true → requestSessionSettings
turnState{id, thinking|responding} → trigger: add(id), false
turnState{id, idle}                → trigger: delete(id) — true only if it was running → request

sheet opens → <RunConfigData/> mounts → requestRunConfigSnapshot(sendCommand)   [one per open]

daemon → session_settings → runConfigReceived{sessionId,model,effort,yolo,used_tokens,window_tokens}
  → the ONE app-level listener → setSnapshot + setSessionId (both verbatim, uncoerced)
  → RunConfigSections reads whichever values are current
```

## State + concurrency model

- **Store contracts are unchanged.** `runConfigStore.setSnapshot` still replaces the whole snapshot
  (most recent wins, no merge, no dedupe); `sessionIdStore.setSessionId` still takes whatever the
  event carried, `''` included. `toRunConfigSnapshot` / `toSnapshotSessionId` are not edited, so AC4
  (`window_tokens: 0` and `session_id: ''` cross verbatim) holds by construction rather than by a new
  test.
- **The trigger's `Set` is the only new mutable state**, closed over per subscription. Never
  module-level: two subscriptions (StrictMode's double-mount, or a test creating two) must not share
  edge state.
- **Teardown.** Both effects return their `onDaemonEvent` off handle as cleanup, so a StrictMode
  double-mount nets exactly one live listener of each kind (the `daemonEventBridge` idiom). No
  timers, no `AbortController`, no promises — nothing outlives the leaf.
- **Ordering.** The listener body is synchronous with no `await`, so there is no read-then-write gap
  a concurrent handler could interleave into (the `conversationActivityBridge.ts:266-278` argument).
- **Interaction with the write store (#256/#257).** A refresh replaces `runConfigStore.snapshot`
  wholesale, and `selectEffectiveSettings` composes the optimistic overlay on top of it. So a
  daemon-driven refresh landing after a confirmed write shows the daemon's own truth. That is the
  correct reading and is not changed by this ticket — it is only reached more often now. Do not add
  merge logic.
- **Rate.** Two request sources, both edge-driven, both cheap: one per handshake and one per turn
  end. A duplicate (sheet-open landing alongside an edge-driven one) is idempotent — the reply is a
  whole-snapshot replace.

## Error handling

| Failure | Layer | Behaviour |
|---|---|---|
| Not connected when the refresh fires | `daemonConnection.requestSessionSettings` | inert no-op upstream; no throw, no event. Unchanged. |
| `sendCommand` bridge failure | preload | swallowed upstream; `sendCommand` is `void`, fire-and-forget (unchanged posture). |
| Reply never arrives | — | the store keeps its previous value; the next edge re-requests. No timeout, no retry, no error surface — matching the existing path. |
| Reply arrives with `window_tokens: 0` | `toRunConfigSnapshot` (unchanged) | held verbatim as the daemon's "usage unavailable" signal; `RunConfigSections`'s existing single guard collapses it. |
| Reply arrives with `session_id: ''` | `toSnapshotSessionId` (unchanged) | held verbatim; `isAddressableSessionId` is what makes the sheet inert. |
| A `turnState` for a conversation never seen running | trigger | `Set.delete` returns `false` → no request. |
| Malformed / unknown `DaemonEvent` | trigger `default` | `false`. Total over the sealed union; no failure mode. |

There are **no new reject branches and no new log calls**. The path is log-free by construction, for
the same reason `conversationActivityBridge.ts:35-39` gives: the only value a diagnostic here could
carry is the untrusted `conversationId`, and the renderer console is readable by anything that can
open DevTools (#126).

## Testing strategy

Test-first. All new unit tests go in `src/renderer/src/screens/conversation/runConfigLive.test.ts`,
reusing the fake-bridge spy shape at `runConfigSnapshot.test.ts:152-178`. No DOM, no effects, no
store — plain spies (CLAUDE.md).

**`createRunConfigRefreshTrigger`** — scenarios, not code:

- `connected` returns `true`; two `connected` in a row both return `true` (each is a completed
  handshake or a replay into a fresh window, never a re-assertion).
- A first `turnState{thinking}` returns `false`; so does a first `turnState{responding}`.
- `thinking` then `idle` for one conversation → `false`, then `true`.
- `thinking` → `responding` → `idle` → `false`, `false`, `true` (both running phases count, via
  `isTurnRunning`).
- `idle` then `idle` for a conversation that never ran → `false`, `false`.
- `thinking` → `idle` → `idle` → `false`, `true`, `false` (**AC2's re-assertion clause**).
- Two conversations interleaved — A `thinking`, B `thinking`, A `idle`, B `idle` → `false`, `false`,
  `true`, `true`. Neither steals the other's edge.
- B `idle` while A is running → `false` (B never ran).
- A `thinking`, then `connected`, then A `idle` → `false`, `true`, `false` (the clear removes the
  stale entry).
- A sample of unrelated arms (`runConfigReceived`, `disconnected`, `conversationsReceived`, …) →
  `false`.
- Two trigger instances do not share state.

**`subscribeRunConfigRefresh`** — scenarios:

- Subscribes exactly once; returns `onDaemonEvent`'s off handle as the cleanup.
- Calls `refresh` exactly once per true edge and never on a false one (drive a sequence, assert the
  call count).
- Two independent subscriptions each get their own trigger state.

**`RunConfigLiveData`** — one server-render sanity case (the `RunConfigData.test.tsx` idiom): renders
to `''` and never touches `window.pyry`. The effect wiring itself is structurally uncoverable in this
repo; that is why every decision above lives in an injected helper instead.

**Unchanged and must still pass:** `runConfigSnapshot.test.ts` (all 8 `subscribeRunConfig` call sites
untouched), `RunConfigData.test.tsx`, `RunConfigSections.test.tsx`.

**Gates:** `npm test`, `npm run typecheck`, `npm run build`.

## E2E impact

`e2e/run-config-settings.spec.ts:204-213` asserts the captured `request_session_settings` count is
exactly `1`. After this change the app also sends one on the connected edge, so the count becomes
`2` and the spec fails deterministically.

Change that single assertion to `.toBeGreaterThanOrEqual(1)` and update the comment above it to say
why: #810 made the read fire on the connected edge and at each turn end, so the count is no longer
fixed. **The proof that assertion carries is unchanged** — it exists to pin that the session id came
from a daemon reply and not from the spec, and that still rests on the unbound `daemon` handle
(`:34-38`) plus the capturing fake being the only source of a `session_settings` frame.

Do **not** add a new pre-open "at least one request fired before the sheet opened" assertion. It
would race the handshake against the Playwright click and buy nothing the unit tests do not already
prove deterministically.

`e2e/real-daemon-session-settings.spec.ts` needs no change — it counts nothing, and its "closing
unmounts the run-config container, so reopening fires a new `request_session_settings`" comment stays
true (`RunConfigData` keeps its request effect).

## Out of scope

- **Any change to `runConfigSnapshot.ts`, the two stores, or `RunConfigSections`.** The verbatim-hold
  contracts (AC4) hold because those files are not edited.
- **Reopening #491's sheet-path decision.** The sheet keeps its own per-open request.
- **A per-conversation session-settings read.** The request is bare and its reply daemon-wide; there
  is no id to filter on and nothing to correlate a reply to.
- **Polling, or a request on every arriving `turn_state`.** Explicitly rejected by the ticket:
  usage cannot move between turns.
- **The stale mechanism name in `clearPairingScopedState.ts:31`** ("re-requested by `RunConfigData`'s
  id-keyed effect" — the id-keying went at #491, and after this ticket the re-request is the connected
  edge). The claim it supports — `runConfigStore` self-heals, so it does not belong in the clear set —
  becomes *more* true here, so nothing is broken. Left for the documentation phase rather than
  spending a production-file edit on a comment.
- **The knowledge-base fold** into `docs/knowledge/features/run-config-store.md` — the documentation
  phase owns it. Not a developer deliverable.

## Open questions

None blocking. Two things the developer should simply follow the spec on rather than re-litigate:

1. **Why `Set.delete`'s return value rather than a `Map<string, boolean>`** — see Decision 3. The
   `Set` is smaller, self-pruning, and the edge is its return value. Do not "clarify" it into a Map.
2. **Whether `runConfigLive.ts` should live under `store/`** with the other eight leaves. It cannot
   without adding a second `store/ → screens/` value import; more importantly it would gain nothing,
   since its helpers are the conversation screen's. `App.tsx` already imports from `./screens/`.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary. Every value this path reads has already crossed the one
  explicit boundary — `parseInboundMessage` in the main process — and arrives as a sealed, typed
  `DaemonEvent`. The one new use of untrusted daemon data is `turnState.conversationId`, and it is
  used **only** as a `Set` membership key inside the renderer: never rendered, never concatenated,
  never a filename, URL, attribute, cache key or log field, and never compared against a secret.
  MUST HOLD in implementation: the running set is a `Set<string>`, **never a plain object**. A
  `Set`/`Map` stores the key in its own slot table; `obj[id] = true` would hand a daemon-supplied
  `__proto__` to `Object.prototype`'s setter. (Related trap, already recorded in this project's
  memory: with a *numeric* value that setter silently no-ops and the entry vanishes rather than
  polluting — a failure that looks like a missed edge, not a crash.) Code review should grep the new
  module for `[` indexing on an id.
- **[Trust boundaries — renderer→main]** The only outbound is `requestRunConfigSnapshot`, which sends
  the existing bare `{ type: 'requestSessionSettings' }` literal. No new `RendererCommand` member, no
  change to `isRendererCommand`, and nothing daemon-supplied is echoed back across the bridge — the
  renderer→main surface this ticket adds is a fixed constant.
- **[Tokens, secrets, credentials]** Not applicable, and the design keeps it that way: nothing on
  this path reads, stores, transports or logs a token, a key, or the Noise transcript. The
  `session_id` it forwards is a non-secret routing id (already established at #491/#500) and is
  passed to the existing setter unchanged.
- **[File / storage operations]** No findings — no filesystem access, no `localStorage` /
  `sessionStorage` / IndexedDB, no persistence of any kind. All new state is one in-memory `Set`
  closed over a subscription and discarded with it.
- **[Inter-process / Electron attack surface]** No findings. No `BrowserWindow` / `webPreferences`
  change, no new `contextBridge` API, no new `ipcMain` channel, no protocol handler, no navigation.
  The leaf rides the existing generic `onDaemonEvent` / `sendCommand` bridge. Process placement is
  upheld: nothing here touches keys, sockets, `ipcRenderer` or raw frames.
- **[Cryptographic primitives]** Not applicable — no randomness, no hashing, no comparison against a
  secret, no handshake code. Nothing in `src/main/transport/` is edited.
- **[Network & I/O]** One new *outbound* request class, edge-triggered. The worst case a hostile or
  buggy daemon can drive is a request-amplification loop: it emits `turn_state` transitions and the
  client answers each one with a `request_session_settings`. Bounded and acceptable — the trigger
  fires only on a genuine running → not-running transition per conversation, so an attacker must
  spend two frames to earn one request, and the reply is a small fixed-shape payload already covered
  by the existing `MAX_PLAINTEXT_BYTES` cap. Materially cheaper than the polling design the ticket
  rejected. No new inbound parsing, so no new size, timeout or TLS surface. SHOULD FIX **only if
  observed**: if a real daemon is ever seen flapping `turn_state`, a debounce belongs here — do not
  pre-build one (evidence-based fix selection).
- **[Resource exhaustion]** The running `Set` grows one entry per conversation with a turn in flight
  and removes it on the turn's end, so it is bounded by concurrent turns, not by lifetime
  conversation count; `connected` clears it outright. A daemon that emits `thinking` for unbounded
  unique ids and never ends them could grow it — strictly less exposure than
  `conversationActivityStore`, which already retains one entry per observed conversation with no cap
  and is the accepted posture. Not a finding.
- **[Error messages, logs, telemetry]** No findings — the path is log-free by construction. No
  `console.*` on any branch, no thrown error carrying an event, no telemetry. This is deliberate: the
  only value a diagnostic here could carry is the untrusted `conversationId`, and the renderer
  console is readable by anything that can open DevTools (#126). The trigger's `default` arm returns
  `false` rather than throwing `assertNever`, so no daemon-controlled string can reach an exception
  message.
- **[Concurrency]** No findings. Both subscriptions are owned by one leaf and torn down by its effect
  cleanups; a StrictMode double-mount nets one live listener of each kind. No timers, no
  `AbortController`, no promise outliving the component. The listener bodies are synchronous with no
  `await`, so there is no check-then-act window across a suspension point. Duplicate requests are
  idempotent by the store's whole-snapshot-replace contract.
- **[Threat model alignment]** *Malicious relay* — content-blind and on-path; dropping or delaying a
  `session_settings` reply leaves the previous figures held and the next edge re-requests, so a
  hostile relay degrades freshness and cannot corrupt or hang the path. *Hostile daemon response* —
  parsed defensively upstream by the unedited `parseInboundMessage`; this ticket adds no parsing.
  *Renderer compromise reaching the transport* — unchanged, and this path adds no capability: it can
  send one fixed bare command it could already send. *Token theft from disk* — out of scope, nothing
  here persists.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-27
