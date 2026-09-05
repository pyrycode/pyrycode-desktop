# #1119 — route the modal, question and run-config answers to the server that raised them

Split from #1084, immediately after #1118 (conversation routing). Where #1118 routed the ten commands
that already carry a `conversation_id`, this slice routes the five that carry a **correlation id from
a different id space** — a modal id, a question batch id, or the daemon's own session id — and which
therefore still reach the `registry.active` stand-in, i.e. whichever server was paired most recently.

## Files read

Codegraph was unavailable for this run (`mcp__codegraph__*` answers `CodeGraph not initialized` in this
repo — a hard error, not an empty result), so the reading list below was assembled with Grep + Read.

- `src/main/conversationRouter.ts` → `createConversationRouter`, `originOf`, `learn`, `route`,
  `MAX_INDEXED_CONVERSATIONS` — the module this slice is modelled on, and the source of every posture it
  inherits: `Map`-not-object, read-the-stamp-never-write-one, record-before-forward, refuse-never-fall-back,
  connection-lookup-is-the-boundary, no reconcile-driven sweep.
- `src/main/conversationRouter.test.ts` → `harness`, `createSinkFake`, `createLogFake` — the fake-driven
  test idiom the new module's tests mirror (no Electron, no registry, no socket, no window).
- `src/main/index.ts` → the `router` / `registry` declaration pair, the `sink: router.observe(live.sink)`
  line inside `createConnection`, and the five command-switch arms this slice re-points (`answerModal`,
  `cancelModal`, `answerQuestions`, `refuseQuestions`, `setSessionSettings`) — plus the `connection`
  stand-in comment that names those three id spaces as this ticket's.
- `src/main/connectionRegistry.ts` → `connectionFor`, `viewFor`, and the entry list — establishes that a
  server's identity is `record.server`, **not** a per-pairing random — the fact the rejected
  first-write-wins draft rested on (see Design).
- `src/shared/ipc/events.ts` → the `modalShown` / `modalDismissed` / `modalAnswerRejected` /
  `questionShown` / `questionDismissed` / `runConfigReceived` / `sessionSettingsUpdated` arms — the seven
  events this slice reads, and the never-log rulings on `questionBatchId` (a one-time unguessable nonce)
  and on the `''` `sessionId` sentinel meaning "no session was resolved".
- `src/shared/ipc/commands.ts` → `answerModalCommand`, `cancelModalCommand`, `answerQuestionsCommand`,
  `refuseQuestionsCommand`, and the `setSessionSettings` arm — confirms every one of the five payloads
  already carries the correlation id this slice routes by, so no renderer file and no wire type changes.
- `src/main/diagnosticLog.ts` → `DiagnosticEvent` — `{ event, code? }` with no identifier-shaped member
  and no index signature, which is why "which kind was refused" is a static `code`/`event` pair.
- `src/renderer/src/store/runSettingsWriteBridge.ts` → `buildPayload` — the write half addresses the
  session by the `sessionId` the run-config store learned from `session_settings`, so the id the command
  sends is exactly the id `runConfigReceived` carried.
- `docs/knowledge/features/daemon-connection-lifecycle.md` § "Conversation routing (#1118)" — the shipped
  lessons this slice inherits, including the verifier's correction on where AC5's no-fixture-edits claim
  actually rests, and the "what's still on `active`" list this slice shortens.
- `e2e/permission-modal-answer-paths.spec.ts`, `e2e/question-picks.spec.ts`,
  `e2e/question-cancel-refuses.spec.ts`, `e2e/run-config-settings.spec.ts`, `e2e/composer-model-menu.spec.ts`
  → checked for AC5: every one of them pushes the learning frame (`modal_shown` / `question_shown` /
  the `session_settings` reply) before the click that answers, and none re-answers a settled id.

## Design source

**Figma:** N/A — main-process command routing. No renderer file changes, no rendered surface, no visual
fidelity check owed. The refiner's body carries no `## Figma` section for the same reason #1118 carried
none.

## Context

#1117 made the number of connections follow the number of paired records; #1118 closed the routing hole
for the ten commands that name a conversation. Five commands remain on `registry.active`, whose members
resolve to the **last** paired entry at call time:

| Command | Correlation id | Wire payload |
| --- | --- | --- |
| `answerModal` | `modal_id` | `AnswerModalCommandPayload` |
| `cancelModal` | `modal_id` | `ModalCancelPayload` |
| `answerQuestions` | `question_batch_id` | `AnswerQuestionsCommandPayload` |
| `refuseQuestions` | `question_batch_id` | `RefuseQuestionsCommandPayload` |
| `setSessionSettings` | `session_id` | `SetSessionSettingsPayload` |

With two servers paired, an answer to host A's permission modal goes to whichever host was paired most
recently. That is the bug. The answer tokens for the first four are minted **main-side** by
`daemonConnection.answerModal` / `answerQuestions` / `refuseQuestions`, so "reaching the wrong server"
means minting a fresh token on the wrong connection and putting an approval on a host that asked nothing.

ADR 0009 is why these cannot borrow #1118's index: **no `conversation_id` rides an ANSWER** — the daemon
resolves the correlation id against its own outstanding state. The inbound `modalShown` / `questionShown`
events *do* carry a `conversationId`, but only as an outbound display-scoping key, and the shape a cold
read reaches for (resolve modal id → conversation → #1118's router) buys a second hop plus a dependency
on the conversation index happening to know that conversation, which #1118's own spec records it may not:
`requestConversations` still reaches `registry.active` only. Resolving the correlation id straight to the
server that minted it has no such dependency.

**No ADR is owed for this slice.** It applies #1118's decisions (ADR-recorded there) to two more id
spaces; the two genuinely new rules — evict-on-settle and its origin check — are consequences of these
ids being short-lived where a conversation id is not, rather than new architectural commitments.

## Design

### Where it lives: a sibling module, not an extension of `conversationRouter.ts`

New file `src/main/correlationRouter.ts`, exporting `createCorrelationRouter`. The `sink:` line in
`src/main/index.ts` then nests two wrappers:

```ts
sink: correlations.observe(router.observe(live.sink))
```

Both wrappers sit **under** `bindServerOrigin` (which `createDaemonConnection` applies internally over the
sink it is given), so each reads the stamp `bindServerOrigin` already wrote and neither adds a second
stamping path. Nesting costs one extra function call per daemon event; daemon events are per-frame, not
per-byte, so this is not a hot path.

Rejected alternative — growing `conversationRouter.ts` to hold all four indexes. The two modules have
**opposite lifetime rules** (grow-only-with-cap vs evict-on-settle, with an origin check #1118 has no
place for) and three keyed spaces against one, and
merging them would mean one module whose docblock has to say "except for these three maps." Keeping
#1118's reviewed module untouched also avoids churn in a file #1120 will read. The cost is one duplicated
5-line `originOf` helper, which the new copy names as the twin of `conversationRouter.ts`'s.

Rejected alternative — extracting a shared `observe`/`originOf` helper into a third module. That is a
refactor of adjacent code, which this repo's conventions forbid while passing through.

### The three indexes

Three module-local `Map<string, string>` cells (correlation id → server id). A `Map`, never a bare object:
both key and value are daemon-supplied strings, and a `Record` written through `__proto__` is prototype
pollution reachable from a hostile or confused daemon — `events.ts`' ServerOrigin rule, which #1118
applies for the identical reason.

| Index | Learns from | Forgets on |
| --- | --- | --- |
| `modals` | `modalShown.modalId` | `modalDismissed`, `modalAnswerRejected` |
| `batches` | `questionShown.questionBatchId` | `questionDismissed` |
| `sessions` | `runConfigReceived.sessionId`, `sessionSettingsUpdated.sessionId` | *(nothing)* |

Every other event arm passes through unread, exactly as in `conversationRouter.ts`.

**`''` is never learned, in any space.** For the session space this is AC3: a `session_id` of `''` is a
real daemon answer meaning "no session was resolved" and is not an address. The same empty-string guard
covers the other two for free, mirroring `learn`'s existing first line in `conversationRouter.ts`.

**A key longer than `MAX_CORRELATION_ID_LENGTH = 512` is never learned.** An id is a daemon-supplied
string bounded only by `MAX_FRAME_BYTES` (256 KiB), so the entry cap alone bounds each index at ~2.5 GB
rather than at the ≈1 MB of short strings its argument assumes. Real ids are UUID-shaped (36 characters),
so 512 is an order of magnitude above anything a conforming daemon mints. Fails closed and is logged
content-free, as every other guard here does. (`conversationRouter.ts` has the same exposure and is
deliberately not touched: widening its contract is not this slice's to do.)

**Eviction is what differs from #1118**, and it is why this slice exists as a separate module. #1118's
index deliberately only grows, because a conversation stays nameable for the process lifetime. A modal
ends at `modalDismissed` / `modalAnswerRejected` and a batch ends at `questionDismissed`; a long session
raises many of both, so a map that only grows is a leak in a process that runs for days. Refusing a
post-settle answer costs nothing — a retired batch resolves nothing daemon-side, exactly as a stale
`modalId` resolves nothing under first-answer-wins (`events.ts`' `questionDismissed` docblock says so in
those words). Session ids have no settle event, so that space inherits #1118's grow-and-cap posture
instead.

**Eviction is origin-checked.** `forget(index, id, serverId)` deletes only when the held owner equals the
stamped origin. Without that check, a second paired host could retire host A's outstanding modal by
echoing its id in a `modal_dismissed` frame — a cross-host denial of the operator's own prompt. With it,
a frame from the wrong host is a no-op. (It cannot mis-route either way; the check removes the denial.)

**Last write wins, in all three spaces**, and a re-point that actually changes the owner is logged
content-free (`<kind>-reindexed` / `reassigned`), as #1118 logs `conversation-reindexed`. An identical
re-write logs nothing.

*This is #1118's rule, and the reason is not the one #1118 gives.* #1118 argued from conversations that
genuinely move hosts. A live modal id does not move hosts — it is a per-connection outstanding-prompt
nonce with a bounded lifetime, and `serverId` is `record.server`, the paired host's own identifier, stable
across an unpair/re-pair of the same host. So the first draft of this design made the two settling spaces
**first-write-wins**, reasoning that a second server claiming a live id is anomalous by construction and
should be refused rather than obeyed. The security pass (below) rejected that as a MUST FIX, and the
reason generalises:

> **The index must agree with the store the operator is reading.** Both renderer stores are
> match-and-replace on a re-delivered id — `modalPrompts.ts`' `shown` arm ("re-delivery of a
> still-outstanding id: replace in place from the RE-DELIVERED fields") and `questionBatches.ts`' identical
> arm. Under first-write-wins the operator would read host B's re-delivered title, prompt and option
> labels while the answer routed to host A's modal: an approval attributed to a prompt they never saw —
> precisely the failure `events.ts`' `questionDismissed` docblock names ("showing them as having approved
> something they never saw"). Last-write-wins keeps the rendered prompt and the routed connection reading
> the same event, which is #1118's "the index can never disagree with the list the window renders"
> property applied to a surface where disagreeing is *worse* than obeying.

The safer-looking rule was the more dangerous one. What actually closes the cross-host case is the
origin-checked eviction above plus the unguessability of the ids themselves, not a write rule that can
only desynchronise the index from the screen.

**Caps.** `MAX_INDEXED_CORRELATIONS = 10_000`, applied to each index independently — #1118's constant and
its argument, unchanged: at the cap a **new** id is not learned, so it refuses rather than mis-routes
(fails closed), while an **existing** id may still re-point in the space whose rule allows it (an overwrite
does not grow the map). Eviction makes the cap unreachable in normal operation for the two settling
spaces; it is there for the daemon that sprays `modal_shown` and never dismisses. The cap log is latched
per index, so a spraying daemon produces three records at most, not one per row.

### Public contract

```ts
export const MAX_INDEXED_CORRELATIONS = 10_000
export const MAX_CORRELATION_ID_LENGTH = 512

export interface CorrelationRouterDeps<C> {
  connectionFor: (serverId: string) => C | null
  diagnosticLog?: DiagnosticLog
}

export interface CorrelationRouter<C> {
  observe(target: DaemonEventSink): DaemonEventSink
  routeModal(modalId: string): C | null
  routeQuestions(questionBatchId: string): C | null
  routeSession(sessionId: string): C | null
}

export function createCorrelationRouter<C>(deps: CorrelationRouterDeps<C>): CorrelationRouter<C>
```

Three public members rather than one `route(space, id)`, so each call site reads as what it does and each
carries its own static log event with no lookup table. One private `resolve(index, id, event)` holds the
body all three share, so the refusal logic is written once.

`observe` mirrors `conversationRouter.ts`'s wrapper exactly, including the two properties that are
load-bearing there: `target.webContents` is read **only** inside `send`'s body (on a real destroyed
`BrowserWindow` that property read *is* the throw, so wrapping a destroyed target stays safe), and the
record happens **before** the forward (anything the window can name, the index has already seen — no gap
for a renderer reacting synchronously to route against a stale index).

The stamp is read by an `in`-guarded, `typeof`-checked accessor, never a cast and never by re-declaring
`send`'s parameter as `StampedDaemonEvent`: at a `DaemonEventSink`-typed hole the static type is the bare
union, and the re-declared form compiles only because method parameters are bivariant.

### The five call sites

Each becomes a one-liner in the shape #1118 established, so the decision stays in a module the tests can
drive (`src/main/index.ts` has no unit test in this repo and never has):

```ts
correlations.routeModal(command.payload.modal_id)?.answerModal(command.payload)
correlations.routeModal(command.payload.modal_id)?.cancelModal(command.payload)
correlations.routeQuestions(command.payload.question_batch_id)?.answerQuestions(command.payload)
correlations.routeQuestions(command.payload.question_batch_id)?.refuseQuestions(command.payload)
correlations.routeSession(command.payload.session_id)?.setSessionSettings(command.payload, command.changeId)
```

`correlations` is declared beside `router`, before `registry`, on the same late-binding argument: the
arrow body `(serverId) => registry.connectionFor(serverId)` runs on a command, many ticks after `registry`
is initialised, and the `observe` the registry's constructor calls synchronously only *wraps* — its
recording path reaches the event and the maps, never `connectionFor`.

### State + concurrency model

No store, no timer, no listener, no async work, no `AbortController` owed. Construction is synchronous and
total: three `Map`s plus three latch booleans. Every mutation happens inside one synchronous
`webContents.send` wrapper, so there is no check-then-act gap between learning a mapping and using it, and
nothing for `will-quit` to tear down. The maps live for the process lifetime and are bounded by the caps
plus eviction.

The indexes hold **ids only** — no token, no key, no answer value — they live in the background process,
and they cross no IPC channel.

## Error handling

Refusal is the only failure mode, and it is the safety property: a refused command puts **no frame on any
server's wire**, because the mint of the answer token happens inside the connection method that is never
reached. There is no fallback to "the first connection" or "the one that answered most recently", ever.

Two refusal branches per space, mirroring `conversationRouter.ts`'s pair:

| Condition | Result | Diagnostic |
| --- | --- | --- |
| id absent from the index (never learned, settled, or over cap) | `null` | `{ event: '<kind>-route-refused', code: 'unknown-correlation' }` |
| id known, `connectionFor(serverId)` answers `null` | delete the mapping, then `null` | `{ event: '<kind>-route-refused', code: 'server-not-connected' }` |

`<kind>` is one of the three static literals `modal`, `question`, `session` — which is how AC4's "records
which of the three kinds of answer was refused" is met, on **both** branches rather than only the first.
The connection lookup is the boundary (an entry for an unpaired server is unroutable by that check whether
or not the map still holds it); the delete beside it is hygiene, applied at the one moment the stale
mapping could have mattered. There is deliberately **no** reconcile-driven sweep: `registry.reconcile()`
is asynchronous, so a prune called beside it runs before the registry has dropped anything and is a no-op
on exactly the unpair path it would be written for. #1118 ruled this; this slice inherits it rather than
re-litigating it.

Two further content-free diagnostics, both static pairs:
`{ event: 'correlation-index-full', code: 'modal' | 'question' | 'session' }` — latched per index, and
covering both the entry cap and the id-length guard, so a spraying daemon produces three records at most
rather than one per row — and `{ event: '<kind>-reindexed', code: 'reassigned' }` for an accepted
re-point that actually changed the owner.

**No `DiagnosticEvent` field is added.** `DiagnosticEvent` is `{ event: string; code?: string; ... }` with
no identifier-shaped member and no index signature, so no correlation id can be logged from here without
widening a renderer-facing security contract (`RendererDiagnosticEvent`'s allowlist and
`receiveDiagnostic.test.ts`'s `Omit` pin) — out of scope, and not needed. `questionBatchId` in particular
is the batch's one-time unguessable nonce and must never reach a log; the answer tokens are secrets on the
same leg and are equally out. Both are structurally unreachable from this module's log calls, which take
string literals only.

## Testing strategy

`src/main/correlationRouter.test.ts`, vitest, node environment, driven by fakes — a `connectionFor` fake
over a plain `Map` and a recording sink, mirroring `conversationRouter.test.ts`'s `harness`. No Electron,
no registry, no socket, no window. Scenarios:

- **Learn and route, per space.** A stamped `modalShown` / `questionShown` / `runConfigReceived` /
  `sessionSettingsUpdated` makes the matching id route to that server's connection, and not to another
  server's.
- **Isolation between spaces.** A modal id is not routable as a session id, and vice versa — three maps,
  not one.
- **Forward unchanged.** Every observed event reaches the wrapped sink on the same channel with the same
  object identity; unread arms pass through; `isDestroyed` delegates; record happens before forward.
- **Eviction on settle.** `modalDismissed` / `modalAnswerRejected` / `questionDismissed` make a later
  answer refuse rather than route; a session id survives its `sessionSettingsUpdated` echo.
- **Origin-checked eviction.** A settle frame stamped by a *different* server does not evict the entry.
- **`''` is never learned**, in all three spaces, and `routeSession('')` refuses.
- **Write rule.** A second `modalShown` for a live id from a different server re-points and logs
  `reassigned` — the same for a batch and for a session id; an identical re-write logs nothing.
- **Long keys.** An id over `MAX_CORRELATION_ID_LENGTH` is not learned and refuses, in all three spaces.
- **Both refusals, per space.** Unknown id → `null` with the kind-naming event; known id whose server has
  no connection → `null`, the kind-naming event with `server-not-connected`, and the mapping deleted
  (proved by a later route refusing with `unknown-correlation` after the server reconnects).
- **Unstamped and stand-in events are skipped** (`serverId` absent, `null`, or `''`) — never trusted.
- **Cap.** At `MAX_INDEXED_CORRELATIONS` a new id is not learned in each space; an existing id still
  re-points where the rule allows; the cap log is latched per index and names the space.
- **No id in any log.** Every recorded `DiagnosticEvent` from a run that used unguessable ids is asserted
  to contain none of them, in `event` or `code` — the deterministic guard behind AC4's never-log rule.

Interaction is not tested here and does not need to be: nothing in this slice renders. AC5's
"`npm run e2e` passes with no edits to the suite" is verified by running the four affected fake-tier specs
(`permission-modal-answer-paths`, `question-picks`, `question-cancel-refuses`, `run-config-settings`)
against the built app; the full tier is the dispatcher's gate.

## Open questions

1. **Does any fake-tier spec answer a correlation id its daemon never announced, or re-answer a settled
   one?** Read during planning: no. All four families push `modal_shown` / `question_shown` / the
   `session_settings` reply before the click, and the reject path ends at a renderer-local *Dismiss*
   rather than a re-answer. To be confirmed by actually running those specs in Phase B.
2. **Does `sessionSettingsUpdated` need to be a learning arm at all**, given `runConfigReceived` always
   precedes a write? Keeping it costs two lines and closes the case where a daemon confirms a session the
   client learned about before a reconnect wiped nothing. Resolve by keeping it unless it proves to
   re-point something it shouldn't.
3. **Should `sessionTransition.newSessionId` be a fourth learning arm?** It names a session the daemon just
   minted, stamped with its origin. Left out of the initial design because the run-config store addresses
   whatever `runConfigReceived` last reported and #501 is the standing bug about session-vs-conversation id
   confusion — widening the learning surface is the wrong place to touch that. Revisit only if a test shows
   a reachable gap.

## Size

Two production source files (`src/main/correlationRouter.ts` new, `src/main/index.ts` modified), 5 new
exported symbols, 5 consumer call sites, 5 acceptance criteria, 6 refusal branches — every size-S boundary
holds except total written work, estimated ~1400–1500 lines including tests and this plan.

**The line ceiling is exceeded, and stated rather than split**, per the refiner's own `Estimate:` line. The
nearest analogue is #1118, the immediately preceding slice of this family, which shipped `size:s` and
measured 1422 insertions at its merge commit in a single builder run. A split by id space would cut three
children that each edit the same new module and the same `sink:` line — sibling merge conflicts by
construction — and a split into "the module" plus "the five call sites" produces a child whose only
consumer is its sibling, which the floor rule says to merge back even at the cost of the ceiling. The call
site count, which is the constraint that actually binds a run's turn budget, is 5 against a limit of 10.

## Security review

**Verdict:** PASS *(second pass — the first returned FAIL on the write rule; see Design)*

**Findings:**

- **[Trust boundaries] MUST FIX — fixed before commit.** The first draft made the modal and question
  spaces first-write-wins, on the reasoning that a live nonce never legitimately moves hosts. Both
  renderer stores are match-and-replace on a re-delivered id (`modalPrompts.ts`' `shown` arm,
  `questionBatches.ts`' identical arm), so that rule would render host B's re-delivered title, prompt and
  option labels while routing the answer to host A's modal — an approval attributed to a prompt the
  operator never read, the exact failure `events.ts`' `questionDismissed` docblock names. Design revised
  to last-write-wins in all three spaces, so the index and the surface the operator reads are driven by
  the same event. The generalisation is recorded in the Design section: an index that disagrees with the
  screen is more dangerous than one that obeys an anomalous re-point.
- **[Trust boundaries] No further findings.** Two boundaries, both explicit. Daemon→main is the stamped
  event read inside one function (`record`), with the origin read by an `in`-guarded, `typeof`-checked
  accessor — never a cast, never a bivariance-laundered parameter re-declaration. Renderer→main is the
  five already-guarded command payloads (`isAnswerModalPayload` and siblings in `commands.ts`); the
  renderer supplies only a correlation id and **cannot name a server**, which is the whole reason this
  resolution lives in the background process. A non-string id that somehow reached `Map.get` misses and
  refuses, so the guard is defence in depth rather than the only check.
- **[Tokens, secrets, credentials] No findings.** The three indexes hold **ids only** — no token, no key,
  no answer value — and cross no IPC channel. The answer tokens stay minted where they are, inside
  `daemonConnection.answerModal` / `answerQuestions` / `refuseQuestions`; routing changes which connection
  mints and nothing else. A refused command reaches no connection method, so **no token is minted at all**
  on the refusal path — refusing is strictly safer than sending. `questionBatchId` is the batch's one-time
  unguessable nonce and reaches no sink (see Logs). No generation, storage, rotation or revocation is
  introduced.
- **[File / storage operations] Not applicable.** No filesystem path is constructed, read, or written; no
  `safeStorage` surface; no temp file; nothing reaches disk except through the pre-existing rotating
  diagnostic sink, which receives static string literals only.
- **[Inter-process / Electron attack surface] No findings.** No new `ipcMain` channel, no new
  `contextBridge` member, no new `BrowserWindow`, no protocol handler, no navigation surface. The five
  commands already exist and keep their existing validated payloads; this slice only changes which
  connection object they reach. Every secret and socket stays main-side — the module is Electron-free,
  socket-free and store-free, and never calls a connection member, it looks one up and hands it back.
- **[Cryptographic primitives] No findings, and the non-use is deliberate.** No RNG, no hashing, no key
  material. Correlation ids are matched by `Map` lookup (string equality), **not** `crypto.timingSafeEqual`,
  on the ruling `events.ts` already published for exactly this comparison: "a local routing decision
  between two values the client already holds, not a secret compared against an attacker's guess." An
  attacker who could time this lookup would learn only whether an id they already supplied is known.
- **[Network & I/O] Not applicable directly** — no socket, no URL, no TLS surface, no timeout of its own.
  One inherited exposure is closed here rather than assumed away: a correlation id is bounded only by
  `MAX_FRAME_BYTES` (256 KiB), so an entry cap alone bounds each index at ~2.5 GB rather than the ≈1 MB of
  short strings that argument assumes. `MAX_CORRELATION_ID_LENGTH = 512` closes it, fails closed, and is
  logged content-free. `conversationRouter.ts` carries the same exposure and is deliberately left alone —
  widening its contract is not this slice's to do; noted for whoever revisits it.
- **[Error messages, logs, telemetry] No findings.** Every diagnostic this module emits is a pair of
  **string literals** — no template, no interpolation, no variable in either position — so no correlation
  id, token, or daemon byte is *representable* in a log line from here, not merely absent from one.
  `DiagnosticEvent` is `{ event, code? }` with no identifier-shaped member and no index signature, so
  logging an id would require widening a renderer-facing contract (`RendererDiagnosticEvent`'s allowlist
  and `receiveDiagnostic.test.ts`'s `Omit` pin) — out of scope and not needed (AC4). The test plan asserts
  the absence deterministically rather than trusting the reading. Volume: the per-refusal line is
  renderer-driven at one per refused command (bounded by the rotating sink, #1118's accepted posture); the
  cap line is latched per index; the re-point line fires only on an actual owner change, which requires two
  servers alternately claiming one unguessable id.
- **[Concurrency] No findings.** Nothing async is introduced: construction is synchronous and total (three
  `Map`s, three latches), every mutation happens inside one synchronous `webContents.send` wrapper, and
  there is no `await` between learning a mapping and using it — so no check-then-act gap, no timer, no
  listener, no `AbortController` owed, and nothing for `will-quit` to tear down. `observe` is applied once
  per connection over shared state, which is safe on Node's single-threaded loop because each `send` runs
  to completion. Record-before-forward is preserved so a renderer reacting synchronously cannot route
  against a stale index.
- **[Threat model alignment] Addressed, per threat.** *Hostile daemon:* bounded by the entry cap, the
  id-length guard and origin-checked eviction; a `''` id is never learned; unstamped and stand-in events
  are skipped rather than trusted; the maps are `Map`s, so a `__proto__` key is data, not pollution.
  *Cross-host retire* (a second paired host echoing host A's id in a `modal_dismissed` frame to deny the
  operator their own prompt) is closed by requiring the stamped origin to equal the held owner before a
  delete — an addition to #1118's posture, not an inheritance. *Malicious relay:* content-blind and cannot
  forge inside the Noise session; dropping or delaying a settle frame leaves a stale entry, which the
  connection-lookup boundary refuses and then deletes. *Renderer compromise:* can replay only ids it
  already legitimately holds and can never name a server, so it cannot steer an answer across hosts.
  *Token theft from disk:* not applicable, nothing persists.
- **[Threat model alignment] OUT OF SCOPE, named.** Per-server list fan-out (#1070/#1091) — until it lands,
  `requestConversations` still reaches `registry.active` only, so the *conversation* index is fed narrowly;
  this slice's three spaces are fed by unsolicited daemon pushes and are unaffected. `interrupt`, which
  carries no payload at all and therefore cannot be routed by any id, is #1120's. The `session_id`
  vs `conversation_id` confusion is the standing bug #501; this slice keeps them in separate maps read from
  separate events and deliberately does not widen the session learning surface (Open question 3).

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-05
