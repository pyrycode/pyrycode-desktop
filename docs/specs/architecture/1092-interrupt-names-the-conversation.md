# #1092 — Stop names the open conversation on the wire

## Files read

| Path | Symbol | Why it matters |
|---|---|---|
| `src/shared/wire/types.ts` | the `interrupt` member of `EnvelopeType`; `NewSessionPayload` | The comment on the `interrupt` member asserts "Carries NO conversation_id … / payload" and is now half wrong. `NewSessionPayload` is the field-for-field model, including why the daemon's optionality must not be tightened here. |
| `src/shared/wire/types.test.ts` | `describe('new-session wire vocabulary (#1217)')` | Three-test shape: envelope-type membership, the lone-field pin, and the no-drift pin that reddens if someone makes the wire field required. The interrupt twin mirrors it. |
| `src/shared/ipc/commands.ts` | `RendererCommand`, `interruptCommand`, `isRendererCommand`, `hasValidServerId`, `newSessionCommand`, `isNewSessionPayload`, `NewSessionCommandPayload` | The union member, the constructor, the guard arm and the `serverId` helper all change. The `newSession` trio is the shape to mirror; `hasValidServerId`'s docblock says "all six", which becomes five. |
| `src/shared/ipc/commands.test.ts` | `describe('interruptCommand (#306)')`, `describe('the server-scoped commands name their server (#1120)')` | The `arms` table and the "types the optional field on each of the six members" case both name `interrupt`; both shrink. |
| `src/main/transport/interruptEnvelope.ts` | module header, `InterruptInput`, `buildInterrupt` | The header's "no payload struct, no conversation_id" and the docblock's present-but-empty-`payload: {}` rationale are both superseded; they get rewritten, not patched. |
| `src/main/transport/newSessionEnvelope.ts` | module header, `NewSessionInput`, `buildNewSession` | The sibling to follow: a fresh literal naming exactly `conversation_id`, and a required input above an optional wire field. |
| `src/main/daemonConnection.ts` | `DaemonConnection.interrupt` (interface member), `interrupt` (impl), `newSession` (impl) | The method gains its scalar. `newSession` is the twin nineteen lines below, including its no-log catch. |
| `src/main/connectionRegistry.ts` | `viewOf`, `ActiveConnection` | The one place the delegating member list is written; the `interrupt` line grows a parameter. |
| `src/main/index.ts` | the `interrupt` and `newSession` arms of the command switch; the retired-stand-in comment listing #1118/#1119/#1120 | The arm re-routes; its own comment predicted this ticket. The stand-in comment's "the six about a WHOLE server" becomes five. |
| `src/main/conversationRouter.ts` | `MAX_INDEXED_CONVERSATIONS`, `ConversationRouterDeps`, the router's `route` | The index this command joins: learned off stamped daemon events, refuses what it has not seen, never falls through to another connection. |
| `src/main/serverRouter.ts` | module header | "interrupt its running turn" in the header's list of server-scoped verbs is stale prose. |
| `src/renderer/src/screens/conversation/sendInterrupt.ts` | `sendInterrupt`, `SendInterruptDeps` | The helper gains the id and the null/`''` refusal. |
| `src/renderer/src/screens/conversation/sendNewSession.ts` | `sendNewSession` | The refusal posture to copy verbatim, including why the boundary guard stays load-bearing anyway. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx` | `Composer`'s `activeConversationId`, `startNewSession`, the Escape branch of `handleKeyDown`, the `onInterrupt` prop on `ComposerSendButton` | Both Stop call sites live in `Composer`, which already holds `activeConversationId` and already threads it into `sendNewSession`. |
| `e2e/escape-interrupt.spec.ts` | `interruptFrames` | Counts by `type` and its comment says the payload is bare `{}`. The payload assertion lands here. |
| `e2e/queued-backlog-interrupt.spec.ts` | `interruptFrames` | Same shape, same comment, same fix. |
| `e2e/real-claude-interrupt.spec.ts` | the quiesce gate (`interruptButton` → `toHaveCount(0)`, `CURSOR_SELECTOR` → `toHaveCount(0)`) | After this change that gate is also the proof that the id this client sends is one the daemon's registry resolves. |
| `docs/knowledge/features/interrupt-envelope.md` | § What it does | Records the frame as "bare by construction" across #305/#306/#307/#678 — the package history this ticket revises. Documentation phase owns the update. |
| `pyrycode/docs/protocol-mobile.md` (daemon SSOT) | § **Interrupt (v2)** | The contract: one optional `conversation_id`, a registry-validated lookup key, never a path component; absent is the pre-#2103 compatibility promise; a client that can name a conversation should always name one. |

## Design source

**Figma:** N/A — no visible surface changes. The Stop button, its accessible name and its
`isTurnRunning(phase)` gate are all untouched; this ticket changes only what the click puts on the wire.

## Context

Stop sends a bare `interrupt` frame. The daemon stops whichever conversation its process-wide
follow-active cursor points at — a cursor only a routed `send_message` stamps, shared by every
connection. With the sidebar making "switch chats without sending" the ordinary path, Stop on chat B
kills chat A's turn, or does nothing at all. pyrycode#2103 landed the fix on the daemon: `interrupt`
now carries an optional `conversation_id`, validated against the daemon's registry, with the bare
frame kept working as the compatibility promise for pre-#2103 clients.

Two things follow, and they are one change rather than two. The frame names the open conversation, and
the command therefore routes by conversation instead of by server: #1120 gave `interrupt` an optional
`serverId` precisely because it carried no id of its own, and once the payload names a conversation
that server id is a second address that can disagree with the first. The `interrupt` arm in
`src/main/index.ts` already carries a comment predicting exactly this and recording that nothing was
built around the field that would be expensive to unwind.

No ADR is warranted. The design decision — a required command input above an optional wire field —
was made and recorded by #1217/#1218 for `new_session`; this ticket applies it to the twin verb rather
than establishing anything new.

### Size: over two lines of the table, deliberately

Nine production files and roughly 950 lines of total written work, against the 5-file and 800-line
boundaries. The refiner's `Estimate:` line states the same overage and its reason; I re-derived the
seams independently and reach the same place.

Every candidate seam produces a half whose only consumer is its sibling, which the floor rule says to
merge:

- **Wire + builder + connection method, then command + renderer.** The first half sends nothing — no
  caller can reach a named frame — so it is not independently verifiable, and its only consumer is the
  second half.
- **Name the conversation, then re-route off `serverId`.** The command must carry the conversation id
  for the router to have an address, so the second half's input is minted by the first and consumed
  nowhere else.
- **Main-side, then renderer-side.** `InterruptCommandPayload` cannot become required without both
  `Composer` call sites compiling against it in the same commit.

The #1217/#1218 split does not transfer: that pair separated a wire path from a new menu item with its
own design surface. Here the renderer half is two arguments and a guard. The floor beats the ceiling —
a ticket that cannot be verified on its own is a failure no resume leg fixes, whereas a budget miss
costs a continuation leg. Building it whole.

## Design

One field threaded end to end, mirroring the shipped `new_session` path at every layer.

**Wire type.** A new `InterruptPayload { conversation_id?: string }` in `src/shared/wire/types.ts`,
sited beside `NewSessionPayload` and optional for the same reason: it answers to the daemon, which
publishes the field optional because the absent form is the pre-#2103 compatibility promise. Tightening
it here would be a wire drift (CLAUDE.md no-drift). The comment on the `interrupt` member of
`EnvelopeType` is rewritten — it currently asserts the frame carries no `conversation_id` and no
payload.

**Command.** `InterruptCommandPayload = Required<InterruptPayload>`, the `NewSessionCommandPayload`
idiom: derive from the wire type so the two cannot drift, tightening the one field rather than
excluding one. The union member becomes `{ type: 'interrupt'; payload: InterruptCommandPayload }` —
`serverId` is gone. `interruptCommand(fields: InterruptCommandPayload): RendererCommand` replaces the
zero-arg constructor, so a frame that names nothing is unreachable by construction (AC4). The guard
arm becomes `'payload' in value && isInterruptPayload(value.payload)`, and `isInterruptPayload` is
`isNewSessionPayload`'s shape: present key, string, non-empty. The header's "SIX MEMBERS CARRY AN
OPTIONAL `serverId`" paragraph and `hasValidServerId`'s docblock both become five.

**Envelope.** `InterruptInput` gains a **required** `conversationId`; `buildInterrupt` builds a fresh
literal `{ conversation_id: input.conversationId }` typed as `InterruptPayload` — never a spread — so
a field smuggled past the structural-minimum boundary guard is dropped rather than sent. The module
header and the `buildInterrupt` docblock are rewritten rather than patched: the header's "no payload
struct, no conversation_id" is now false, and the docblock's present-but-empty-`payload: {}`
justification no longer describes what the builder emits. The new docblock names the daemon's
`docs/protocol-mobile.md` § **Interrupt (v2)** (AC4) and states why a required input sits above an
optional wire field.

**Connection.** `DaemonConnection.interrupt` takes `conversationId: string` as a scalar, matching
`newSession` and unlike the payload-bearing `dequeueMessage`. The impl keeps its `driver === null`
inert-no-op guard and its no-log catch; the catch's comment changes, because the caught object could
now echo a conversation id, so dropping it stops being "nothing sensitive here" and starts being the
`newSession` rationale. `connectionRegistry.ts`'s `viewOf` forwards the argument.

**Dispatch.** The arm in `src/main/index.ts` becomes the `newSession` arm's shape — one local read
twice, so the id routed by and the id sent cannot be two expressions:

```ts
const conversationId = command.payload.conversation_id
router.route(conversationId)?.interrupt(conversationId)
```

`router` is #1118's conversation-to-server index. The `?.` is the refusal when the id names a
conversation no connection holds, so no frame reaches any wire (AC3). The retired-stand-in comment
above the switch, which lists the #1120 set as "the six about a WHOLE server", becomes five, and
`serverRouter.ts`'s header drops "interrupt its running turn" from its own list.

**Renderer.** `sendInterrupt(conversationId: string | null, deps)` — `sendNewSession`'s signature and
its refusal, `if (conversationId === null || conversationId.length === 0) return`. `null` is reachable
(the composer footer renders with no conversation open, and `activeConversationId` is
`activeConversation?.id ?? null`); `''` is the one that would ship looking correct, because on this
verb an empty id is not an unresolvable id — the protocol gives no payload, `{}`, an absent id and an
explicitly empty one one wire meaning, so it is the cross-conversation misfire this ticket exists to
close. `isInterruptPayload` remains the load-bearing refusal at the untrusted boundary; this is
defence in depth and does not make that one redundant. Both `Composer` call sites — the Escape branch
of `handleKeyDown` and `ComposerSendButton`'s `onInterrupt` — pass `activeConversationId`, the same
expression the send and `startNewSession` read, which is what stops the three ever naming different
chats. `onInterrupt` stays an arrow function so `window.pyry` is dereferenced at interaction time.

## State + concurrency model

No store slice changes and no new async work. Stop stays non-optimistic: no local dispatch, no
"stopping" state; the control retracts when the daemon's next `turn_state{idle}` returns `phase` to
idle. The frame stays fire-and-forget with no correlation memory, so there is nothing to cancel and
nothing to leave dangling — the connection method's `driver === null` guard and the `?.` on the router
are the whole of its lifecycle handling. `conversationRouter`'s index only ever grows and is capped by
`MAX_INDEXED_CONVERSATIONS`; this command adds a reader, not a writer.

## Error handling

Three inert paths, all pre-existing and all preserved (AC3):

- **No conversation open** — `sendInterrupt` returns before constructing a command. No IPC message.
- **A malformed or empty id across the bridge** — `isInterruptPayload` refuses, and a refused command
  is dropped in silence at the boundary. No frame, no event, no error.
- **An id no connection holds, or nothing connected** — `router.route(...)` returns `null`, the `?.`
  refuses, and the router logs a static code with no id in it. If a connection resolves but its driver
  is `null`, the method's own guard returns.

`buildInterrupt` may throw `WireEncodeError` in principle; the connection method's `catch` drops the
caught object with no log and no event (classify-don't-forward), because its message could echo the
conversation id. No retry — a resend of an unacknowledged frame is a second interrupt, and while a
second interrupt is benign (the daemon documents a replay as stopping the turn again), the module's
posture is uniform with `newSession`.

## Testing strategy

Vitest, node environment, static renders only — no DOM, no click.

- **`src/shared/wire/types.test.ts`** — an `interrupt` wire-vocabulary block mirroring the
  `new_session` one: the lone-field shape, and the no-drift pin that reddens if someone tightens
  `conversation_id` to required to match the guard.
- **`src/shared/ipc/commands.test.ts`** — `interruptCommand` mints exactly
  `{ type: 'interrupt', payload: { conversation_id } }`; the guard accepts a valid payload and an
  extra field, and rejects a missing payload, an explicitly-undefined payload, `null`, a non-string id
  and `''`. The `#1120` server-scoped `arms` table and its "each of the six members" case lose their
  `interrupt` rows, and the "mints an interrupt for a named server" case goes with the field.
- **`src/main/transport/interruptEnvelope.test.ts`** — round-trips to an `interrupt` envelope carrying
  the exact id, ts and `conversation_id`; the payload has exactly one key (the fresh-literal net, so a
  smuggled extra field is dropped rather than sent).
- **`src/main/daemonConnection.test.ts`** — the existing block's cases keep their shape and gain the
  id: inert before handshake, one envelope with the expected id/ts/payload after it, never throws when
  the driver throws. Decoding the captured bytes and asserting `payload.conversation_id` is the
  assertion that would have caught a method that dropped its argument.
- **`src/main/connectionRegistry.test.ts`** — the fake's `interrupt` records the ids it was handed
  (the `newSessions` array shape already there), so the facade is proven to forward rather than to
  merely delegate.
- **`src/renderer/src/screens/conversation/sendInterrupt.test.ts`** — sends exactly one named command
  per activation; sends **nothing** for `null` and for `''`; a bridge throw is swallowed.

Playwright, fake transport:

- **`e2e/escape-interrupt.spec.ts`** and **`e2e/queued-backlog-interrupt.spec.ts`** — `interruptFrames`
  keeps counting by `type` (its running-total contract is untouched), and each spec gains an assertion
  on the **captured frame's payload**: the seeded conversation's id, and nothing else. Never the
  daemon's reaction (AC1). Both specs' comments claiming the payload is bare `{}` are corrected.

Playwright, real claude (`e2e/real-claude-interrupt.spec.ts`, operator-run tier):

The spec keeps its assertions and its structure; what changes is that it now traverses the **named**
path by construction. A wrong id is silently inert daemon-side, so the turn would never quiesce and
the existing `interruptButton` → `toHaveCount(0)` gate would time out — that gate is now the
registry-resolution proof as well as the liveness proof, and its comment says so. The header's "adds
NO production `src/` change" claim and its divergence list are corrected.

I considered and rejected a discriminating leg (a second conversation, messaged to move the daemon's
cursor, then Stop pressed on the first): it is the only DOM-observable way to separate the bare path
from the named one, but it needs two real claude turns inside a 300 s spec timeout on a tier my own
gate cannot run. Adding an unverifiable leg to the operator's pre-ship gate is a worse trade than the
by-construction coverage the AC asks for. Noted here so the omission is a decision rather than a gap.

## Open questions

1. **Does `e2e/escape-interrupt.spec.ts`'s fixture expose the seeded conversation's id to the spec?**
   If the fake's seed constant is not already imported there, the payload assertion asserts on the id
   the fixture seeds rather than a literal. Resolve by reading the fixture in Phase B; record in
   `## Revisions` only if it changes the design.
2. **Does anything else construct an `interrupt` command or call `connection.interrupt()`?** The reads
   above found the renderer helper, the registry facade, the dispatch arm and their tests. A
   whole-repo sweep at the start of Phase B confirms; a missed site is a compile error, not a silent
   break, since both signatures gain a required parameter.

## Revisions

**2026-09-07 — Phase B.** Both open questions resolved; no design change.

1. **The fixture exposes the seeded id.** `launchPairedApp` exports `SEEDED_ROW`, and both fake-tier
   specs already import it, so the payload assertions name `SEEDED_ROW.id` rather than a literal.
   `launchPairedApp` navigates by clicking that single seeded row, which is what makes it the *open*
   conversation the frame must name.
2. **No further call sites.** The whole-repo sweep found only the sites the plan listed. Both new
   required parameters made every miss a compile error; `npm run typecheck` is clean.

**One production file beyond the plan's nine**, all of it comment: `requestDebugBundleEnvelope.ts`'s
`buildRequestDebugBundle` docblock cited `interrupt` as its bare-control-frame sibling to justify the
present-but-empty `payload: {}`. That citation is stale — `request_debug_bundle` is now the only bare
one of the three — so the sweep the plan prescribed caught it and it is corrected in place. No code
change there.

**Also corrected by the same sweep**, none of it foreseen at plan time but all of it the same stale
claim: the `interrupt` entry in `commands.ts`'s union-header prose, and `escape-interrupt.spec.ts`'s
secret-hygiene note (frames are now asserted by payload as well as by `type` — the payload is the
app's own conversation id, a client-owned value it already renders, not a secret).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX, but the inherited phrasing must not be copied uncritically. The
  one boundary is `isInterruptPayload` at the renderer→main IPC hop — a single named function
  co-located with the union, not a check scattered across layers. Past it the id reaches exactly two
  sinks, and **one of them is a lookup key**: `conversationRouter`'s `route` does `index.get(id)`.
  `NewSessionPayload`'s docblock says the id is "never a path component", which is true and is *not*
  the same claim as "never a lookup key" — this design deliberately makes it one. That is safe here
  and verified rather than assumed: `createConversationRouter`'s `index` is a real `Map`, whose own
  comment records that a `Record<string, string>` would be prototype pollution reachable from a
  hostile daemon. A `Map` has no prototype chain to poison, and this path only *reads* it. The second
  sink is `buildInterrupt`, which rebuilds a fresh literal, so a field smuggled past the
  structural-minimum guard is dropped rather than sent.
- **[Electron / IPC attack surface]** No findings. No new IPC channel, no new `contextBridge` API, no
  window or `webPreferences` change — the command rides the existing `sendCommand` channel and the
  union member becomes *stricter* (a validated required payload replaces an optional unvalidated
  string). The removal of `serverId` from this arm is fail-closed in the right direction: the
  previously-accepted bare `{ type: 'interrupt' }` is now a boundary rejection, and since renderer and
  main ship in one binary there is no version skew to strand. The resulting failure mode is Stop doing
  nothing rather than Stop killing another chat's turn, which is the defect this ticket exists to fix.
- **[Input validation]** Considered, no finding. `isInterruptPayload` checks presence, type and
  non-emptiness but sets **no length cap** — deliberately matching `isNewSessionPayload` exactly,
  because two twin verbs with subtly different acceptance rules is a worse failure than the cap's
  absence. It fails closed downstream regardless: an over-long id makes `encodeEnvelope` throw
  `WireEncodeError`, the connection method's `catch` drops the send without advancing the envelope-id
  counter, and the router only reads its index on this path, so no renderer input can grow it. A cap
  would be a coordinated change to both guards, not this ticket.
- **[Renderer compromise reaching the transport]** No finding, and this is the one place the change
  genuinely widens what a caller can *address*. A compromised renderer can now name any conversation
  to interrupt, where before it could only hit whichever the daemon's cursor pointed at. It is not a
  privilege widening: that same renderer already holds `sendMessage` for any conversation, and a
  routed send is exactly what stamps the cursor — so the two-frame dance was always available, and
  only a *benign* client was unable to perform it. The daemon's own protocol section states this
  conclusion for both `interrupt` and `new_session`. Process placement is untouched: no key, socket or
  raw byte moves toward the renderer.
- **[Error messages, logs, telemetry]** **SHOULD FIX** — the sharpest category here, because three
  sites now hold a conversation id where none held one before, and each currently has the right
  posture *for the wrong reason*. In Phase B: `sendInterrupt`'s catch must keep logging the error
  alone (`console.error('interrupt send failed', error)`), never the id; `createDaemonConnection`'s
  `interrupt` catch must keep **dropping** its caught object and must not gain a log, and its comment
  must stop saying "nothing sensitive on this bare path" — that justification is now false and must be
  replaced by `newSession`'s (the caught object could echo the id). The router's refusal is already
  safe by construction rather than by discipline: it emits a static event name plus a static code, and
  `DiagnosticEvent` has no identifier-shaped field and no index signature, so logging an id from there
  would require widening a renderer-facing security contract that `receiveDiagnostic.test.ts` pins.
  The verifier should check all three landed.
- **[Concurrency]** No findings. No new async work, no timer, no listener, no `AbortSignal` to thread.
  The one check-then-act — `router.route(id)` then `?.interrupt(id)` — is synchronous with no `await`
  in the gap, and reads one local twice so the id routed by and the id sent cannot diverge. Nothing
  outlives the call.
- **[Index eviction]** Considered, no finding. This adds an eleventh caller to `route`'s
  `server-not-connected` arm, which `delete`s the mapping. No amplification: that arm fires only when
  the named server genuinely has no live connection, i.e. the mapping was already unroutable, and it
  is re-learned from the next `conversationsReceived`. The `learn` path — the only writer, and the
  only one bounded by `MAX_INDEXED_CONVERSATIONS` — is not reachable from this command at all.
- **[Cryptographic primitives]** Not applicable by design decision: the frame rides the **existing**
  Noise session as one extra field inside the AEAD. No key, no nonce, no handshake state and no
  primitive selection is touched; `buildInterrupt` hands bytes to the same driver it always did.
- **[Network & I/O]** Not applicable by design decision: no new socket, no new URL, no relay-URL
  parsing, no timeout or backoff change. A hostile on-path relay stays content-blind — it observes one
  frame of a slightly different length, which is not a new class of metadata leak, since frame types
  already differ in size.
- **[Tokens / secrets]** Not applicable by design decision: the command payload is
  `Required<InterruptPayload>`, a one-field derivative of the wire type, so it has no field that could
  hold a token, key or raw frame; the frame carries no nonce, answer token, idempotency key or
  correlation key.
- **[File / storage]** Not applicable by design decision: this path performs no disk read or write and
  constructs no path, filename or cache key.
- **[Hostile daemon response]** Not applicable by design decision: `interrupt` is fire-and-forget with
  no reply of any kind, so there is no daemon-controlled input on this path to parse defensively. The
  daemon does learn which conversation the operator is looking at — it already hosts that conversation
  and already receives its messages, so this discloses nothing it lacked.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-07
