# #1176 — A late `session_settings` reply is attributed to whatever conversation is active when it lands

## Files read

- `src/renderer/src/screens/conversation/runConfigSnapshot.ts` → `subscribeRunConfig`,
  `toRunConfigSnapshot`, `toSnapshotSessionId`, `requestRunConfigSnapshot` — the two unconditional
  writes this ticket gates, and the sender whose `conversationId` the correlation records.
- `src/renderer/src/screens/conversation/runConfigLive.ts` → `RunConfigLiveData`,
  `subscribeRunConfigRefresh`, `createRunConfigRefreshTrigger` — the ONE production caller of
  `subscribeRunConfig` since #810, and the module that already reads the active conversation
  non-reactively at call time in its sibling effect.
- `src/main/daemonConnection.ts` → `requestSessionSettings`, the `session-settings` and
  `session-settings-updated` arms of `onDriverEvent`, `pendingSettings`, `pendingCreateFolders`,
  `outstandingAnswers`, `dial` — the shipped envelope-id correlation idiom this follows verbatim, and
  its single-writer / clear-on-dial rationale.
- `src/main/transport/inboundMessage.ts` → the `session-settings` kind and its `session_settings`
  decode arm — `inReplyTo` is already surfaced and populated, so nothing new is decoded.
- `src/shared/ipc/events.ts` → the `runConfigReceived` arm — where the resolved id is declared, and
  the `assistantDelta` / `modelAnnounced` arms whose "REQUIRED, never optional; an optional routing
  key invites `?? activeConversation` fallbacks" rule this arm now adopts.
- `src/main/index.ts` → the `requestSessionSettings` IPC case — proves the id reaching the connection
  is the renderer's own validated payload field, and that an absent id refuses at `router.route`
  before any frame is built.
- `src/main/correlationRouter.ts` → the `runConfigReceived` arm of `learn` — a second main-side
  consumer of the event; it reads `sessionId` only, so the new field is inert there, but a
  fail-closed drop now also withholds that `learn`. Weighed under § Error handling.
- `src/renderer/src/store/conversationLastReadBridge.ts` → `conversationLastReadDeps` — the
  injected non-reactive open-conversation getter this copies, and the recorded
  "two consumers is the signal for a `selectOpenConversationId` selector" note this ticket makes
  a third consumer of.
- `src/renderer/src/store/activeConversationStore.ts` → `activeConversation` — the state the getter
  reads.
- `e2e/composer-context-severity.spec.ts` → `sessionSettingsFrame`, its `buildReplyFrames` switch —
  the fake-tier idiom for correlating a `session_settings` reply against a captured request, and the
  `.composer__context` reading the new drive uses as its detector.
- `e2e/real-daemon-session-settings.spec.ts` → the claude-less real-wire spec that AC5 names as the
  proof the real daemon's reply carries a matching `in_reply_to`.
- `docs/knowledge/features/run-config-store.md` § "the reply carries no correlation id" and its
  #1166 entry — the package overview's own statement of this gap, which this ticket closes; it also
  records that `setSnapshot` replaces the WHOLE snapshot, which is why a wrong-conversation reply is
  destructive rather than merely additive.
- `docs/knowledge/features/paired-shell-routing.md` § the `requestConversationConfig` cross-reference
  — the #1166 request occasion that made the gap reachable on every switch.

## Design source

**Figma:** N/A — no UI-visible change. This ticket removes a write that should never have happened;
nothing new renders and no existing markup, token or layout moves. The visual-fidelity check is
intentionally skipped.

## Context

A `session_settings` reply carries no conversation id, so `subscribeRunConfig` writes it into the
app-singleton `runConfigStore` and `sessionIdStore` for whatever conversation is active when it
lands. A reply still in flight across a conversation switch is therefore attributed to the wrong
chat: B's composer footer shows A's model, effort, permission mode and context reading, and — the
sharp end — `changeSetting` in `runSettingsControls` then addresses **A's** session id, so a pick
made in that window is written to the session the operator just navigated away from. That is the
exact hazard `activateConversation`'s docblock names as its reason for clearing the session id on a
switch.

The defect is pre-existing (the rising `connected` edge and each turn-end edge already produced
in-flight replies). #1166 did not create it and did not widen the per-occurrence exposure; it changed
the **frequency**, because every conversation switch is now itself a request occasion.

The approach is settled by the ticket and is not re-litigated here: correlate client-side, do not
touch the wire. `SessionSettingsPayload` gains nothing — that would be a `pyrycode/pyrycode` change
under ADR 0002 and CLAUDE.md's wire rule. The background process already knows which conversation
each `request_session_settings` named; it records that against the request's envelope id, matches the
reply by `Envelope.in_reply_to`, and puts the resolved id on the event. The renderer drops a reply
that does not describe the open conversation.

**No ADR is warranted.** This adopts an idiom the module already documents three times over
(`outstandingAnswers`, `pendingSettings`, `pendingCreateFolders`) rather than deciding anything new.

## Size

Measured against the six size-S numbers before the plan commit:

| Limit | Boundary | This ticket |
|---|---|---|
| Production source files created or modified | ≤ 5 | **4** ✓ |
| Total written work | ≤ 800 | **~700** ✓ |
| New exported types / interfaces / components / stores | ≤ 5 | **0** ✓ |
| Consumer call sites needing simultaneous update | ≤ 10 | **~28** ✗ |
| Acceptance criteria | ≤ 5 | **5** ✓ |
| Distinct error/reject branches in a state machine | ≤ 10 | **2** ✓ |

**The call-site line is exceeded, and this ticket is built anyway because the floor rule wins.**
The count is honest: 20 `type: 'runConfigReceived'` object literals across 9 files must gain the new
required field, and 8 `subscribeRunConfig(...)` test call sites must gain the fourth argument. That
is 28 raw sites, not 10, and no amount of "they are one-line additions" changes the number.

What makes splitting the wrong answer is that every available seam produces a one-consumer child.
The only natural cut is main-side (record the id, put it on the event) from renderer-side (drop the
mismatch); the field the main-side child would ship is consumed by exactly one sibling — the
renderer-side child — and by nothing else, ever. A "field first, guard second" cut is the same cut
spelled differently. Per the floor rule, a slice whose only deliverable is consumed by one sibling in
its own family is part of that sibling; the floor beats the ceiling, the overage is stated here, and
the work ships as one ticket. The concrete risk the ceiling protects against is a budget miss costing
one continuation leg; the risk the floor protects against is a child that cannot be verified on its
own, which no resume fixes — a dormant `conversationId` that changes no behaviour is exactly that.

## Design

Three seams, in wire order.

### 1. The correlation store — `src/main/daemonConnection.ts`

A fourth per-connection correlation store beside the three the module already holds:

```ts
const pendingConfigRequests = new Map<number, string>()   // envelopeId → the conversation the request named
```

It is a `Map`, never a bare object, and its key is a **client-minted number** (`nextEnvelopeId`),
not a daemon-supplied string — a stronger position than the ticket's "any index keyed on a
daemon-supplied string must be a `Map`" constraint requires, and it is stated that way in the
docblock so a later widening cannot quietly weaken it.

Lifetime, copied from `pendingSettings` rather than invented:

- **Set** in `requestSessionSettings`, AFTER `driver.sendMessage` returns — a build or send that
  throws registers nothing, because `nextEnvelopeId` advances only on a successful build and an entry
  left under an unspent id would swallow the reply of whichever envelope re-mints it. The envelope id
  is captured into one local, read by both the builder and the `set`, so the id sent and the id
  recorded can never be two different expressions (`main/index.ts`'s own "ONE local, read twice"
  rule).
- **Matched and deleted** in the `session-settings` arm of `onDriverEvent`.
- **Cleared** in `dial()`, beside `pendingSettings.clear()`, which is what makes the recycled envelope
  ids (`nextEnvelopeId` restarts at 2) safe (AC4's reconnect clause).
- **Single-writer**: every mutation runs to completion inside a synchronous
  `requestSessionSettings` / `onDriverEvent` body with no await between a read and a write.

`requestSessionSettings(conversationId?: string)` keeps its optional parameter — narrowing it is a
separate change to `DaemonConnection`, `connectionRegistry` and `conversationRouter`, and is not
owed here. An absent id records `''`, which the renderer can never match against an open
conversation, so it is fail-closed by construction. It is unreachable in production today:
`requestRunConfigSnapshot` returns early on a falsy id, and `main/index.ts` routes on the same
scalar, so an absent id refuses at `router.route` before a frame is built.

### 2. The gated emit — the `session-settings` arm of `onDriverEvent`

The arm becomes correlation-gated and fail-closed, structurally identical to the shipped
`session-settings-updated` arm directly below it:

```
inReplyTo undefined            → return, no event
no entry under inReplyTo       → return, no event
otherwise                      → delete the entry, emit runConfigReceived with the recorded id
```

The emit stays a fresh literal with named fields — never a spread of `inbound.sessionSettings` — and
the numeric `in_reply_to` is NEVER placed on the event; the renderer receives the conversation id it
itself supplied, not the wire routing id. Every existing field crosses exactly as today, `''`
included.

### 3. The event field — `src/shared/ipc/events.ts`

`runConfigReceived` gains `conversationId: string`. **Required, never optional**, per the rule the
`assistantDelta` and `modelAnnounced` arms state: an optional routing key invites
`?? activeConversation` fallbacks, which is the misattribution this ticket exists to remove.

Its provenance is worth stating in the arm, because it differs from every other `conversationId` on
this union: those are daemon-asserted, this one is **client-owned** — the id this app put in its own
`request_session_settings`, round-tripped through the main process's own map and never parsed from a
frame. The daemon's only contribution is the numeric `in_reply_to` used to look it up.

### 4. The renderer gate — `src/renderer/src/screens/conversation/runConfigSnapshot.ts`

`subscribeRunConfig` gains a fourth parameter:

```ts
subscribeRunConfig(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setSnapshot: (snapshot: RunConfigSnapshot) => void,
  setSessionId: (sessionId: string) => void,
  getOpenConversationId: () => string | null
): () => void
```

and its listener opens with one gate covering **both** writes:

> a `runConfigReceived` whose `conversationId` is not strictly equal to `getOpenConversationId()`
> returns immediately — no snapshot write, no session-id write.

One gate, not two, deliberately: the two values arrive on the same frame and are only meaningful
together, so a gate applied to one and not the other would produce exactly the mixed state
`subscribeRunConfig`'s existing docblock says the single listener exists to prevent.

`toRunConfigSnapshot` and `toSnapshotSessionId` are **not touched**. They stay pure
`DaemonEvent → value | null` mappers; widening either to take the open id would put the same decision
in two places and give the gate two implementations.

**No new export for the gate.** It is one strict-equality test inside a listener that every existing
test in this module already drives directly through `subscribeRunConfig` with plain spies, so it is
fully covered under `environment: 'node'` without a helper to name.

**Cross-wiring.** The new parameter sits beside two same-shaped function parameters, which is the
condition the module's own notes say calls for a named-deps object. It does not here, because the
only adjacent swap is a compile error: `setSessionId` (`(sessionId: string) => void`) is not
assignable to `() => string | null` — `void` is not `string | null` — so a swap of the last two
arguments fails to typecheck as a pair. This is recorded in the docblock so a later fifth parameter
re-runs the argument instead of inheriting the conclusion.

### 5. The one production call site — `src/renderer/src/screens/conversation/runConfigLive.ts`

`RunConfigLiveData`'s first effect passes a getter reading the active conversation **non-reactively,
at call time** — the shape `conversationLastReadBridge`'s `getOpenConversationId` establishes and the
one this module's own sibling effect already uses two lines below. The leaf still subscribes to
nothing and still server-renders to `''`, because the store is touched only when the arrow runs.

The expression is spelled the way this file already spells it
(`activeConversationStore.getState().activeConversation?.id ?? null`) rather than
`conversationLastReadBridge`'s explicit-`null` form, so the file's two effects read identically. The
two differ only for an id of `''`, which no daemon-supplied conversation id can be; `?? null` is the
strictly more fail-closed of the two there, since `''` then matches nothing.

**Third-consumer signal, recorded and not acted on.** `conversationLastReadBridge` records that two
consumers duplicate this getter and that a third is the signal for a `selectOpenConversationId`
selector on `activeConversationStore` — "a separate three-line ticket". This ticket is that third
consumer. Extracting the selector is adjacent refactoring and out of scope; the note goes in the
docblock and in the PR body's lessons, not in this diff.

## State + concurrency model

No store is added, keyed or re-shaped. `runConfigStore` and `sessionIdStore` keep their app-singleton
shape and their existing setters; the only change is that fewer writes reach them.

The one piece of new mutable state is `pendingConfigRequests`, and it is per-connection main-process
state under the module's existing single-writer discipline — no timer, no await between read and
write, no cross-connection survival. It self-prunes on every matched reply and is cleared wholesale
on each `dial()`. An entry for a request the daemon never answers survives until the next dial: the
same unbounded-until-reconnect shape `pendingSettings` and `pendingCreateFolders` already carry, with
entries of a number and a short string. No eviction, deadline or cap is designed for it, because no
such accumulation has been observed and the daemon's sole emit site always replies; if one is ever
observed, the bound belongs here.

No cancellation path is added because no long-lived async job is added. The renderer's subscription
lifetime is unchanged — `subscribeRunConfig` still returns the same off-handle used as the effect
cleanup, so a StrictMode double-mount still nets one live listener.

## Error handling

Two reject branches, both fail-closed, both in the main process, both silent:

1. **No `in_reply_to`** — a `session_settings` frame arriving unsolicited or from a
   non-conforming daemon. Short-circuits before the map lookup. No event.
2. **`in_reply_to` matching no outstanding request** — a stale reply from a previous connection whose
   ids were cleared, a duplicate reply to an already-matched request, or a daemon forging a snapshot
   for a request this client never sent. No event.

Neither logs. The only values a diagnostic could carry are the conversation id and the wire routing
id, and `emitDaemonEvent` is log-free by construction; the decode-side `session_settings` log is
already pinned content-free (byte length and one-way hash only) and is untouched.

**What a fail-closed drop also withholds, weighed and accepted.** `correlationRouter`'s `learn` reads
`runConfigReceived.sessionId` to index session → server. An uncorrelatable reply now teaches it
nothing. That is correct rather than a regression: a session id from a frame this client cannot tie
to a request it sent is exactly the input that index must not accept, and the router's own docblock
already reads the `sessionTransition` arm for the same space, so the ordinary path keeps its writer.
The renderer-side drop (a correlated reply naming a non-open conversation) is upstream of nothing —
`correlationRouter` runs main-side and still learns from it, which is right: that session genuinely
belongs to that server whichever chat is open.

No result type crosses a boundary here; nothing throws. The renderer gate returns from a listener,
which is the module's existing "the listener only dispatches — it never throws into React" contract.

## Testing strategy

### vitest — `src/main/daemonConnection.test.ts`

- A `session_settings` reply correlated to a request naming conversation A emits `runConfigReceived`
  with `conversationId` = A, and every other field verbatim including `session_id: ''` and
  `permission_mode: ''` (AC1, AC3).
- A `session_settings` frame with no `in_reply_to` emits nothing (AC4).
- A `session_settings` frame whose `in_reply_to` matches no outstanding request emits nothing (AC4).
- A second reply re-using an already-matched `in_reply_to` emits nothing — the entry was deleted.
- Two interleaved requests naming A and B each draw their own id back, so the map is keyed rather
  than FIFO.
- A reply correlated against an envelope id issued on a **previous** connection emits nothing after a
  reconnect (AC4's reset clause) — driven through the existing dial/reconnect harness.

### vitest — `src/renderer/src/screens/conversation/runConfigSnapshot.test.ts`

- A `runConfigReceived` naming the open conversation writes BOTH stores exactly as today, with the
  existing verbatim/`''`/`0` assertions preserved (AC3).
- A `runConfigReceived` naming another conversation writes NEITHER store — asserted as two
  `not.toHaveBeenCalled()`, since AC2 is a claim about both (AC2).
- A `runConfigReceived` arriving while `getOpenConversationId()` returns `null` writes neither store
  (AC3's no-conversation-open clause).
- The getter is read **per event**, not once at subscribe time: one subscription, an event naming A
  while A is open (lands), then an event naming A after the getter starts answering B (dropped).
  This is the test that would redden if the id were captured in a closure at subscription.
- The existing unrelated-event and unsubscribe tests keep passing with the fourth argument.

### vitest — the incidental fixture updates

`runConfigLive.test.ts`, `logDataDownload.test.ts`, `announcedModelBridge.test.ts`,
`questionBridge.test.ts` and `correlationRouter.test.ts` each construct a `runConfigReceived` literal
and gain the required field. No behavioural assertion in any of them changes.

### Playwright — `e2e/run-config-cross-conversation.spec.ts` (new, fake tier)

The fake tier cannot prove the real wire, but it is the only tier that can prove the *drop*, and it
needs a shape none of the seven existing `session_settings` specs have: **two conversations and a
reply held across the switch**. Those seven all correlate against a request the app sent while the
one seeded row was open, so a bug resolving the wrong conversation would pass every one of them.

Drive:

1. Seed **two** rows whose names share no substring — Playwright's `hasText` is a case-insensitive
   substring match, so a prefix relationship would select both.
2. `launchPairedApp` clicks the seeded row, so conversation A is open; capture A's on-open
   `request_session_settings` envelope id and answer it with **nothing** (`buildReplyFrames` returns
   `[]`), so no snapshot has ever landed.
3. Click B's row. Capture B's own on-open request; answer it with nothing too.
4. Push A's reply, correlated to A's captured envelope id, carrying a distinctive context reading.
5. Push a **non-run-config barrier frame** for B whose effect is independently visible, and wait for
   that effect with an auto-waiting positive assertion. Frames are ordered, so once the barrier's
   effect is on screen, A's reply has been consumed.
6. Assert the run-config-fed control has **not** mounted. Without the gate, A's snapshot would have
   landed before the barrier and this reddens.
7. Then push B's reply, correlated to B's captured id, and assert the control mounts with B's
   figures — the positive mutation check that proves step 6's locator can populate at all and that
   the drive did not merely assert against a dead pipeline.

Step 7 must come **after** step 6, never before or instead of it: with A's reply and B's reply both
landing, the last write wins and the final state is B's whether or not the gate exists, so a drive
that only asserts the end state is vacuous.

### The real gate — AC5

`npm run e2e:real:gate` is the operator's to run, not the builder's; the ticket carries
`needs-real-claude` and parks in Inbox for it. `e2e/real-daemon-session-settings.spec.ts` is
untouched by this diff and is the spec whose continued green proves the premise: it can only read the
run configuration if the real daemon's `session_settings` reply carries an `in_reply_to` the new
correlation matches. That is stated in the PR body so the operator knows what the run is proving.

### Not tested, deliberately

No renderer spec asserts the footer's rendered output for a dropped reply. `vitest.config.ts` is
`environment: 'node'`; the transition being asserted is driven by navigation, which belongs in the
Playwright tier above and is where it lives.

## Open questions

1. **Which barrier frame does the e2e drive use in step 5?** It must have a visible effect that no
   run-config field feeds, and it must be addressable to conversation B. A `turn_state` running for B
   and its composer affordance is the candidate; the alternative is a timeline write. Resolved by
   reading the fake tier's existing locators during implementation and recorded under `## Revisions`
   if it changes the drive's shape.
2. **Does any main-side test construct a `session_settings` inbound without an `in_reply_to`?** If an
   existing `daemonConnection.test.ts` case pushes an uncorrelated `session_settings` and asserts an
   event, it encodes the old contract and must be rewritten to the new one rather than patched to
   pass. Resolved by reading that file's existing session-settings coverage first.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. Three boundaries are touched and each stays where it already is.
  (a) *Relay → main*: `parseSessionSettingsPayload` in `inboundMessage.ts` remains the single
  fail-closed decode; this ticket adds no parsing. The one new untrusted input consumed is
  `envelope.in_reply_to`, used ONLY as a `Map.get` key — never concatenated, never a path, filename,
  URL, attribute, cache key or log field. A non-numeric, absent, or unmatched value misses the map and
  drops the frame; no branch coerces it. (b) *Main → renderer*: the new `conversationId` on
  `runConfigReceived` is the one field on that union whose provenance is **client-owned** — the id
  this app put in its own `request_session_settings`, held in main-process memory and echoed back,
  never read out of a frame. The plan states this in the arm's docblock precisely so a later editor
  cannot mistake it for the daemon-asserted ids on the neighbouring arms and relax their warnings.
  (c) *Renderer → main*: `isRequestSessionSettingsPayload` already guards the id at the IPC boundary
  and is untouched; a compromised renderer can only echo its own string back to itself, and that
  string already reaches the wire today via `buildRequestSessionSettings`, so this adds no exposure.

- **[The gate is a correctness control, not a security boundary — and the plan must not be read as
  claiming otherwise]** No findings, stated explicitly. The renderer-side drop in `subscribeRunConfig`
  is defence against a *late* reply, not against a *hostile* one: a compromised renderer already owns
  both stores outright and can write them directly. The security-relevant half is the **main-process**
  correlation, which refuses to emit at all for a frame this client cannot tie to a request it sent.
  That half is a genuine improvement over today: a hostile or impersonating daemon can currently forge
  an unsolicited `session_settings` whose `session_id` lands verbatim in `sessionIdStore` (which
  `changeSetting` then addresses) and in `correlationRouter`'s session→server index; after this ticket
  it must match an outstanding envelope id from the live connection, and the ids reset on each dial.

- **[Tokens, secrets, credentials]** No findings — none are read, written, compared or moved. The
  `session_id` crossing this path is a routing id, not a secret, per the standing
  `conversation_id` / `sessionTransition` convention on the event union, and it crosses exactly as it
  does today. No `safeStorage` surface, no disk, no keychain.

- **[File / storage operations]** Not applicable, by design decision: nothing on this path touches the
  filesystem. The two new pieces of state are an in-memory `Map` in the main process and one extra
  strict-equality read in a renderer listener. No path is constructed from any input, so path
  traversal and TOCTOU have no surface here.

- **[Inter-process / Electron attack surface]** No findings. No IPC channel, `contextBridge` member or
  `ipcMain` handler is added, removed or widened; `runConfigReceived` gains a field on an existing
  event channel. No `BrowserWindow` `webPreferences`, `will-navigate`, `setWindowOpenHandler` or
  protocol registration is touched. Process placement is unchanged and correct: the correlation state,
  the envelope ids and the frame decode stay in the background process, and the renderer receives an
  already-typed event carrying no wire routing id — the numeric `in_reply_to` is deliberately NOT
  placed on the event.

- **[Cryptographic primitives]** No findings, and the one thing that superficially looks like a
  finding is not. The gate is `event.conversationId !== getOpenConversationId()`, a plain `!==`.
  `crypto.timingSafeEqual` is **not** owed: a conversation id is a routing key both sides already
  know, not a secret, and no timing signal on it reveals anything an attacker cannot read off the
  frames it is already routing. No RNG, no key, no nonce, no handshake code is touched.

- **[Network & I/O — map growth under a hostile peer]** Stated decision, not a finding, and the
  reasoning is the sharpest thing this pass produced. `pendingConfigRequests` accumulates one entry
  per request the daemon never answers, bounded only by the next `dial()`. Request volume is partly
  **daemon-driven**: `createRunConfigRefreshTrigger` fires on each running → not-running `turn_state`
  transition per conversation, and the package overview already records that no debounce exists
  because no flapping daemon has been observed. So a hostile daemon can drive requests. The reason
  this is accepted rather than bounded: each entry is a number and a short string, and it is created
  only **after** `driver.sendMessage` returns, so it is strictly cheaper than the encrypted frame
  build and socket write that necessarily precede it — this ticket adds a smaller cost to an existing,
  larger, already-accepted one and creates no new vector. That argument is load-bearing on the
  registration ORDER, so the order is a design requirement in § Design rather than an incidental
  choice: an entry must never be registered for a request that was not actually sent. If a flapping
  daemon is ever observed, the debounce belongs in `subscribeRunConfigRefresh` where the overview
  already puts it, not in a cap here. No socket, timeout, TLS setting, `maxPayload`, backoff or
  reconnect policy is touched.

- **[Error messages, logs, telemetry]** No findings. Both reject branches are silent and add no
  `console.*` on any branch, matching the shipped `session-settings-updated` arm and
  `correlationRouter`'s log-free-by-construction posture. This is the correct trade here because the
  only values a diagnostic could carry are the conversation id — a daemon-adjacent routing key the
  ticket bars from every sink — and the wire routing id. The decode-side `session_settings` log is
  untouched and stays content-free (byte length plus a one-way hash). The renderer gate logs nothing,
  which matters because the renderer console is readable by anything that can open DevTools.
  *Accepted operability cost, named rather than hidden:* a non-conforming daemon that omitted
  `in_reply_to` would leave the run-config sheet silently inert with no diagnostic — the #941 shape.
  AC5's `npm run e2e:real:gate` run is the mitigation, and it is the reason that AC exists.

- **[Concurrency]** No findings. Every mutation is synchronous with no `await` between a read and a
  write: `requestSessionSettings` builds, sends and registers in one body; the `session-settings` arm
  gets, deletes and emits in one body. This is the module's documented single-writer discipline, and
  the new map inherits it verbatim rather than restating it. The renderer's `getOpenConversationId` is
  invoked **per event inside the listener**, never captured in a closure at subscribe time — a
  closure capture would freeze the open conversation at mount and reintroduce the defect in a new
  shape, so § Testing carries a dedicated test that reddens on exactly that mistake. No timer, no
  `AbortController`, no new listener and no new socket is introduced; the subscription's off-handle
  lifetime is unchanged, so a StrictMode double-mount still nets one live listener. Cross-connection
  safety rests on `pendingConfigRequests.clear()` in `dial()`, which is what makes the recycled
  envelope ids (`nextEnvelopeId` restarting at 2) safe — AC4's reconnect test pins it.

- **[Threat model alignment — malicious relay]** No findings; posture improves. The relay is
  content-blind but on-path and can drop and delay. Delay is this ticket's whole subject and is now
  fail-closed instead of silently misattributing. Drop leaves a stale map entry and no write, which is
  strictly better than today's wrong write. Reordering is not reachable within a connection: the Noise
  transport is an ordered per-direction counter, so the e2e drive's reliance on frame ordering is
  sound rather than lucky.

- **[Threat model alignment — conversation-id collision across servers]** OUT OF SCOPE, inherited, not
  introduced. The gate's equality is on a conversation id alone, and `conversationRouter` already
  treats that id as globally unique when it picks a server. Two paired servers issuing the same
  conversation id would already misroute the request itself, upstream of anything this ticket does;
  the correlation map is per connection, so it cannot make the collision worse. Belongs to whoever
  takes on per-server conversation-id namespacing.

- **[Threat model alignment — the second ingress into `sessionIdStore`]** OUT OF SCOPE, filed as
  [#1192](https://github.com/pyrycode/pyrycode-desktop/issues/1192). `sessionIdStore` has two writers,
  and this ticket gates only one. The other — `sessionIdBridge`'s `subscribeSessionId`, consuming the
  unsolicited `session_transition` marker — writes `newSessionId` for whatever conversation is open,
  with the same consequence: the footer's write controls address another chat's session. #1176's
  remedy cannot reach it, and that is a structural fact rather than an omission: `session_settings` is
  reply-only, so a request exists to correlate against, whereas `session_transition` is pushed
  unsolicited and carries no conversation id, so closing it needs either a wire change (a
  `pyrycode/pyrycode` ticket, barred here by CLAUDE.md and ADR 0002) or per-conversation keying of
  `sessionIdStore`. Not fixed here per § Scope Discipline; #1192 records both candidate shapes.

- **[Threat model alignment — hostile daemon response]** No findings. Every field still passes through
  the unchanged fail-closed `parseSessionSettingsPayload`, and the emit remains a fresh literal with
  named fields rather than a spread, so a decoder that later grows a field cannot smuggle it across
  IPC. The new correlation adds a second, independent refusal in front of that.

- **[Threat model alignment — renderer compromise reaching the transport]** No findings; unchanged.
  Nothing here moves a key, a socket, a raw frame or `ipcRenderer` toward the renderer, and the
  renderer's only new capability is reading its own store one extra time.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06
