# #1217 — the desktop can send a `new_session` frame naming a conversation

Six additive layers that give the background process a route to ask the daemon to kill claude in one
named conversation and spawn a fresh one. Nothing in the window calls it yet; the sender is the
sibling ticket.

## Files read

| Path → symbol | Why it matters |
|---|---|
| `src/shared/wire/types.ts` → `EnvelopeType`, `DequeueMessagePayload`, `RequestModelListPayload` | The union the new outbound member joins, and the two payload-interface precedents — one two-field, one single-`conversation_id`. |
| `src/shared/wire/types.test.ts` → the `dequeue-message wire vocabulary` describe | The compile-time membership assertion idiom (`const x: EnvelopeType = '…'`) and the `Object.keys` wire-order pin. |
| `src/main/transport/requestModelListEnvelope.ts` → `buildRequestModelList`, `RequestModelListInput` | The closest builder precedent: a fresh single-`conversation_id` literal, id/ts injected, no clock read. |
| `src/main/transport/requestModelListEnvelope.test.ts` | The builder-test shape this slice mirrors — real codec round-trip, verbatim-id assertion, `Object.keys` fresh-literal detector. |
| `src/main/transport/dequeueMessageEnvelope.ts` → `buildDequeueMessage` | The payload-bearing builder the ticket names; confirms the payload type is imported from the wire module rather than redeclared. |
| `src/main/transport/interruptEnvelope.ts` → `buildInterrupt` | Its docblock records why an empty payload is emitted as `{}` and never omitted or `null`. Read before deciding what an absent id would look like — this slice never emits one. |
| `src/shared/ipc/commands.ts` → `RendererCommand`, `isRendererCommand`, `isRequestModelListPayload`, `AnswerModalCommandPayload` | The union member, the boundary-guard arm, the single-`conversation_id` guard to copy, and the `Omit`-derivative idiom the required-id command payload follows. |
| `src/shared/ipc/commands.test.ts` → the `requestModelList` guard cases | The four-case guard-test shape: accepts a string (emptiness not checked), rejects absent/`undefined`/`null`/non-string payloads, and a `@ts-expect-error` compile pin. |
| `src/main/daemonConnection.ts` → `DaemonConnection`, `requestModelList`, `dequeueMessage`, `interrupt` | The interface member to add and the three method bodies that fix the shape: `driver === null` early return, shared `nextEnvelopeId`, advance-on-success, silent catch. |
| `src/main/connectionRegistry.ts` → `ActiveConnection`, `viewOf` | `ActiveConnection` is an `Omit` of the whole interface, so the object literal in `viewOf` stops typechecking until the new member has its delegate. |
| `src/main/index.ts` → the `onCommand` switch, its `requestModelList` and `dequeueMessage` arms | The conversation-routed dispatch idiom: one local read twice, `router.route(id)?.method(id)`, `?.` as the refusal. |
| `docs/knowledge/features/interrupt-envelope.md` § Edge cases | Records that `EnvelopeType` has no exhaustive-switch cascade, and that an outbound-only frame gets no decode path. |
| `docs/knowledge/features/command-channel.md` § Security posture | The guard-then-rebuild pattern and its hidden dependency on structured clone materialising every accessor before `isRendererCommand` runs. |
| `pyrycode` `docs/protocol-mobile.md` § New session (v2) | The wire SSOT: one optional `conversation_id`, registry-validated lookup key, no nonce, no reply, silent inertness for a named id the daemon cannot act on. |

## Design source

**Figma:** N/A — this slice adds no rendered surface. It ends at the background process's dispatch
switch; the ticket states explicitly that nothing in the window calls it yet. The visual-fidelity
check is intentionally skipped.

## Context

*Reset session*, already in the Actions menu, sends the literal text `/clear` as an ordinary message:
claude clears its context in place and the process keeps everything it holds. *New session* is a
different action — it asks the daemon to kill claude and spawn a new one, so every stored setting
applies at the spawn. On the Mac the daemon's idle timeout is 0, so nothing evicts and `/clear`
respawns nothing; a stored per-conversation prompt would sit unapplied indefinitely. This frame is
the route to that spawn.

The desktop has only ever built the receiving half: `new_session` appears under `src/` and `e2e/`
only as `new_session_id`, a field of the `session_transition` payload the connection decodes. There
is no envelope type, no payload type, no builder, no command and no routing arm — this slice adds
all six.

The wire shape is settled and shipped upstream (pyrycode#2099, merged 2026-09-06). No ADR is
warranted: this is the sixth instance of an already-recorded six-layer outbound-verb pattern, and
adds no new decision.

### Size: six production files, deliberately

The size-S ceiling is five production source files and this plan prescribes six. The sixth is the
one-line delegate in `viewOf`. Every cut available here puts a child below the sizing floor — the
wire type and builder have exactly one consumer (the connection method), which has exactly one
consumer (the dispatch case), and none of them changes anything observable alone. The floor wins
over the ceiling. Every other boundary holds: ~670 lines of total written work against 800, three
new exported types, zero consumer call sites needing simultaneous update, four acceptance criteria,
one reject branch. The measured precedent is #1165 — the same six-layer shape, 666 total written
lines, inside budget.

## Design

Six additive layers, no existing behaviour changed. Each names its predecessor so the diff reads as
the sixth instance of a pattern rather than a new one.

### 1. Wire vocabulary — `src/shared/wire/types.ts`

- `'new_session'` joins `EnvelopeType`, sited beside `'interrupt'` (the other v2 phone→binary control
  frame the session manager intercepts before `dispatch.Route`), with a comment naming
  § New session (v2) of the daemon's `docs/protocol-mobile.md` per AC1.
- A new `NewSessionPayload` interface, mirroring the daemon field-for-field:

  ```ts
  export interface NewSessionPayload {
    conversation_id?: string
  }
  ```

  **Optional, and that mirrors the daemon rather than describing this client.** Upstream publishes
  the field as optional because a bare frame is a compatibility promise: no payload, `{}`, an absent
  id and an explicitly empty one are one wire meaning — the daemon's process-wide follow-active
  cursor. CLAUDE.md's no-drift rule binds the wire type to the daemon's shape, not to this client's
  narrower usage.

Additive only: nothing in `src/` switches exhaustively over `EnvelopeType`, and membership is
asserted one type at a time in `types.test.ts`. There is no fan-out.

### 2. The builder — `src/main/transport/newSessionEnvelope.ts` (new, main-process only)

```ts
export interface NewSessionInput { id: number; ts: string; conversationId: string }
export function buildNewSession(input: NewSessionInput): Uint8Array
```

The `buildRequestModelList` shape verbatim: a fresh `NewSessionPayload` literal naming exactly
`conversation_id`, wrapped in a `new_session` `Envelope`, serialized by `encodeEnvelope`. Pure — id
and ts are injected, never read from a counter or the wall clock here.

**`conversationId` is required on the input even though the wire field is optional**, and that is
the whole design decision of this layer. This client always holds an id, and the protocol's own rule
is that a client which *can* name a conversation must always name one: the cursor is process-wide and
shared by every connection, so leaving the choice to it means another device's send can move it
between the operator's button press and the restart. A required input type makes the bare form
unreachable at compile time rather than by discipline. The `buildInterrupt` docblock's `{}`-not-`null`
reasoning is read and does not apply — this builder never emits an empty payload.

No `?? ''` normalisation. **And do not copy the sibling builders' "`''` is the daemon's call"
rationale here — for this verb it is false.** `buildRequestModelList`'s docblock reasons that an empty
id reaches the wire as written and draws `conversation.not_found`, a harmless answer the builder has
no business pre-empting. On `new_session` an empty id is not an unresolvable id: the protocol states
that no payload, `{}`, an absent id and an explicitly empty one are **one wire meaning** — the bare
form — so `''` on the wire *is* the follow-active-cursor restart, which is the cross-conversation
misfire itself. Emptiness is therefore a real safety property on this verb where it is a non-question
on its siblings, and it is enforced twice, one layer above this builder (see § 4 and § Security
review). The builder stays pure and unconditional; it is simply never handed one.

### 3. The command member — `src/shared/ipc/commands.ts`

```ts
export type NewSessionCommandPayload = Required<NewSessionPayload>   // { conversation_id: string }
// union member
| { type: 'newSession'; payload: NewSessionCommandPayload }
// constructor
export function newSessionCommand(fields: NewSessionCommandPayload): RendererCommand
```

**A `Required`-derivative, not the wire type reused verbatim, and not a hand-written twin.** This is
the mirror image of `AnswerModalCommandPayload`'s `Omit`: the same "derive the command payload from
the wire type so it cannot drift" idiom, tightening instead of excluding. It makes the compile-time
type and the runtime guard agree — the sibling `requestModelList` gets that agreement for free
because its wire field is already required, and reusing `NewSessionPayload` here would let
`{ type: 'newSession', payload: {} }` typecheck and then be refused at runtime.

Not `serverId`-scoped: the conversation id already selects the connection, and the ticket is explicit
that adding one would be a second addressing scheme for a frame that has one.

### 4. The boundary guard — `src/shared/ipc/commands.ts`

A `newSession` arm in `isRendererCommand` delegating to a new `isNewSessionPayload`: one
present-and-string `conversation_id` check, so a missing key, a literal `null`, an explicit
`undefined` and a non-string are all rejected (AC3).

**It diverges from every sibling guard in one clause — it also rejects `''` — and that divergence is
the security-relevant line of this slice.** The siblings check type and not emptiness deliberately,
because for them an empty id is merely an id the daemon cannot resolve. Here it is the bare form (see
§ 2), so a `typeof === 'string'` check alone would let a buggy or hostile renderer put the
follow-active-cursor restart on the wire by sending an id it had not yet loaded. The clause is
`typeof value.conversation_id === 'string' && value.conversation_id.length > 0`.

This is deliberately the *second* net rather than the only one: `conversationRouter`'s `learn` never
indexes an empty id, so `route('')` already refuses on the ordinary unknown-conversation path and no
frame reaches any wire today. That net is real, deterministic and tested — but it lives in a module
whose contract is routing, not payload validity, and it protects the renderer path only. The guard
states the property where the property belongs, at the untrusted boundary.

**The guard is mandatory where the wire type is optional, and that is the design.** Relaxing it to
accept an absent id "to match the type" would put the bare form back on the wire and hand the restart
to the follow-active cursor — the cross-conversation misfire pyrycode#2099 exists to close, where
opening chat B and restarting before sending anything to B kills chat A mid-work. Nothing in this
repo reddens on that: the relaxed guard compiles, typechecks, and the frame is silently accepted. The
guard test carries that reasoning so a later reader does not "fix" the apparent mismatch.

### 5. The connection method — `src/main/daemonConnection.ts`

`newSession(conversationId: string): void` on the `DaemonConnection` interface, implemented as the
`requestModelList` twin (scalar argument, not a payload object — the builder rebuilds the literal, so
no renderer-supplied key reaches the wire):

- `driver === null` → inert return. Fire-and-forget with no consumer to fail.
- Shares the one monotonic `nextEnvelopeId` — no second counter.
- `nextEnvelopeId += 1` only after a successful build, so a dropped over-cap send keeps the id.
- `try` / silent `catch`: never throws out of the module, the caught object is dropped, no log line.
- No pending-request memory: there is no reply to correlate.

### 6. Registry delegate and dispatch — `src/main/connectionRegistry.ts`, `src/main/index.ts`

`viewOf` gains `newSession: (conversationId) => resolve().newSession(conversationId)`. This is forced,
not optional: `ActiveConnection` is `Omit<DaemonConnection, 'start' | 'stop' | 'reconnect'>`, so the
object literal fails to typecheck until the member is added. The member-count comment above it moves
from 23 to 24.

The dispatch arm mirrors `requestModelList` exactly — one local, read twice, so the id routed by and
the id sent can never be two different expressions:

```ts
case 'newSession': {
  const conversationId = command.payload.conversation_id
  router.route(conversationId)?.newSession(conversationId)
  return
}
```

`conversationRouter.ts` is generic over the connection type and needs no change.

## State + concurrency model

No state is added anywhere. No store slice, no pending-request map, no timer, no subscription, no
async task — every layer is synchronous and returns `void`. There is nothing to cancel, so the
"every long-lived async job has a cancellation path" rule has no subject here.

The one piece of mutable state touched is `nextEnvelopeId`, the connection's existing monotonic
counter, incremented exactly as its five siblings do. The frame is fire-and-forget: no nonce, no
idempotency key, no correlation key, no reply, no correlation memory to leave dangling. A replayed
`new_session` simply starts another fresh session, which the daemon documents as harmless.

The observable effect, when there is one, arrives on the pre-existing inbound path as a
`session_transition` marker — decoded and rendered by machinery this slice does not touch.

## Error handling

Four failure modes, all already shaped by the precedent:

| Failure | Where it is absorbed | Result |
|---|---|---|
| Malformed command from the renderer | `isNewSessionPayload` at the IPC boundary | Dropped before `onCommand`'s switch; no frame, no error surfaced. |
| Conversation id no connection holds, or nothing connected | `router.route(...)` returns `null` having already refused and logged | `?.` short-circuits; no frame on any wire, no error (AC4 — the `dequeueMessage` / `interrupt` posture). |
| `encodeEnvelope` over-cap (`WireEncodeError`) | `catch` in `newSession` | Send dropped, envelope id not advanced, caught object discarded — it could echo the payload. |
| `driver.sendMessage` throws | the same `catch` | Same: never throws out of the module (parity #490). |

Daemon-side failures are outside this client's reach by design: a named id the daemon cannot act on
is silently inert, with no reply and never a fall-through to another conversation. There is nothing
to surface and nothing to retry. No typed result crosses a layer boundary here because no layer has
an answer to give.

## Testing strategy

All vitest, node environment. No renderer surface exists in this slice, so there is no static render
to assert on and no Playwright spec — the interaction that would drive this frame belongs to the
sibling that adds the affordance.

**`src/shared/wire/types.test.ts`** — a `new-session wire vocabulary (#1217)` describe:
- `'new_session'` is admissible as an `EnvelopeType` (compile-time membership).
- `NewSessionPayload` shapes as `{ conversation_id }` and nothing else.
- The field is optional: `const bare: NewSessionPayload = {}` compiles — the no-drift pin against a
  later "tighten it to match the guard" edit, which would be a wire drift.

**`src/main/transport/newSessionEnvelope.test.ts`** (new) — the builder proven on encoded bytes (AC2),
decoded through the real codec:
- Round-trips to a `new_session` envelope carrying the exact id and ts.
- Carries the named conversation id verbatim, asserted distinct from every other string field so a
  transposition against `ts` cannot pass.
- `Object.keys(payload)` is exactly `['conversation_id']` — the fresh-literal detector; a later
  `...spread` of a caller's object reddens here.
- The envelope's own keys are exactly `id`/`type`/`ts`/`payload` — no token, no nonce, no answer
  token, no correlation key (AC2's negative half).

**`src/shared/ipc/commands.test.ts`** — the guard, mirroring the `requestModelList` cases (AC3):
- Accepts a payload whose `conversation_id` is a non-empty string.
- **Rejects `''`** — the one case that diverges from every sibling guard's test, carrying the reason
  in the assertion's comment so a later reader does not "align" it with the siblings. This is the
  detector for the whole § 4 argument: deleting the `.length > 0` clause reddens exactly this line.
- Rejects no payload, `payload: undefined`, `payload: null`, `payload: {}`, and a non-string id.
- A `@ts-expect-error` compile pin that a bare `{ type: 'newSession' }` does not typecheck.
- `newSessionCommand` returns a well-formed member.

**`src/main/daemonConnection.test.ts`** — the connection method against the existing fake driver:
- Sends exactly one frame, decoding to `new_session` with the caller's id in the payload.
- Inert when `driver === null` (before `start()`): no bytes on the wire, no throw.
- Advances the shared envelope-id counter, and does not advance it when the build throws.

**`src/main/connectionRegistry.test.ts`** — the `viewOf` delegate forwards to the resolved connection,
extending the existing member-fake (`newSession: noop`) and its delegation assertions.

Fakes, not mocks, at the transport boundary — the existing driver fake in `daemonConnection.test.ts`.

## Open questions

1. **Does the command payload type belong in `commands.ts` or `wire/types.ts`?** Resolved in favour of
   `commands.ts`, beside `AnswerModalCommandPayload`: it is an IPC-boundary shape derived from the
   wire type, not a wire shape itself, and `wire/types.ts` must hold only what the daemon publishes.
2. **Does `'new_session'` sit beside `'interrupt'` or beside `'dequeue_message'` in `EnvelopeType`?**
   To be settled while writing the union; the union is grouped by daemon-side character, and
   `interrupt` is the neighbour that shares this frame's interception point and fire-and-forget
   posture. Record the choice here if it changes.
3. **Does any existing `daemonConnection.test.ts` helper enumerate the interface's members** (the way
   `connectionRegistry.test.ts` does) and so need the new member added? To be confirmed in Phase B by
   compiling; if a second enumeration exists, note it in a `## Revisions` entry.
4. **Does `Required<NewSessionPayload>` yield `{ conversation_id: string }` rather than
   `{ conversation_id: string | undefined }`** under this repo's tsconfig? `Required` applies `-?`,
   which strips `undefined` as well as the modifier, so it should — but the `@ts-expect-error` compile
   pin in the guard test is what proves it. If it does not, fall back to an explicit
   `{ conversation_id: string }` interface and record the reason in a `## Revisions` entry.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] **SHOULD FIX, addressed in the plan above (§ 4).** The single boundary is
  `isNewSessionPayload`, reached through `isRendererCommand`; downstream code holds a validated
  `NewSessionCommandPayload`. The first draft of this plan copied `buildRequestModelList`'s "`''` is
  the daemon's call, not a policy the builder pre-empts" rationale, **and that rationale is false for
  this verb**: the protocol states that an absent id and an explicitly empty one are one wire meaning
  — the bare form — so `''` on the wire *is* the follow-active-cursor restart that pyrycode#2099
  exists to close, not a harmless unresolvable id. A `typeof === 'string'` guard would therefore let a
  renderer that reads an id from a not-yet-loaded store slice restart whichever conversation the
  daemon's process-wide cursor points at, mid-work. Not exploitable *as designed* — verified, not
  assumed: `conversationRouter`'s `learn` returns early on a zero-length id, so `''` is never in the
  index and `route('')` refuses on the unknown-conversation path before any frame is built. That is
  why this is SHOULD FIX and not MUST FIX. The plan now rejects `''` at the guard as well, so the
  property is stated at the boundary that owns it rather than inherited from a routing module, and
  § Testing names the assertion that reddens if the clause is deleted.
- [Trust boundaries] No further findings — the id's two sinks were checked in the code rather than
  inherited from the sibling's docblock: `conversationRouter.route`'s `index.get(...)` on a **`Map`**
  (that module's header rules a `Record` out by name as prototype-pollution reachable), and
  `buildNewSession`'s fresh literal, which becomes a JSON string field. It reaches no path component,
  no attribute, no cache key, no `React` key and no log field. The guard's `'conversation_id' in value`
  walks the prototype chain, which is safe here for the reason `command-channel.md` § Security posture
  records: structured clone has already materialised the payload into a plain data object before the
  guard runs, so no chain property and no accessor survives the crossing.
- [Tokens, secrets, credentials] No findings, structurally — the frame carries no token, no nonce, no
  answer token, no idempotency key and no correlation key, which is AC2's negative half and is pinned
  by the builder test's whole-key-set assertion. `NewSessionCommandPayload` has exactly one string
  field, so the union's standing "no member has a field that could hold a secret" invariant holds by
  construction.
- [File / storage operations] Not applicable, with the reason: no filesystem access, no path
  construction, no persisted state anywhere in the six layers. The category is worth naming rather
  than skipping only because the daemon publishes `conversation_id` as "a lookup key, never a path
  component" — checked above and true on both sinks.
- [Inter-process / Electron attack surface] No findings, one capability named. No new IPC channel, no
  new `contextBridge` API, no `webPreferences` change — one member on the existing `COMMAND_CHANNEL`,
  validated before use. The capability it hands a compromised renderer is real and destructive in a
  way its siblings are not: it discards claude's in-memory context in any conversation the renderer
  can name. It is nonetheless inside the existing trust domain and not a widening — that renderer can
  already `sendMessage` to any conversation, which the daemon documents as sufficient to move the
  cursor and then send the bare frame. Bounded by pairing and by the daemon's `interactive` gate, both
  of which are daemon-side and which nothing here substitutes for.
- [Cryptographic primitives] Not applicable, with the reason: no randomness, no comparison, no key and
  no nonce is minted or read. The bytes ride the existing Noise session unchanged. `nextEnvelopeId` is
  a shared monotonic counter, not a nonce and not security-relevant — the protocol states a replayed
  `new_session` simply starts another fresh session, which is why the frame carries no dedup key.
- [Network & I/O] No findings — no socket, no URL, no TLS setting and no timeout is added; one frame
  goes out on the established session. The one hostile-input path is an over-long `conversation_id`
  from a compromised renderer, which fails closed at `encodeEnvelope`'s `MAX_PLAINTEXT_BYTES` cap: the
  send is dropped, the envelope id is not advanced, and no bytes are retained. A renderer spamming the
  command spams restarts, bounded by the same channel that already lets it spam messages.
- [Error messages, logs, telemetry] No findings, verified in code rather than inherited. The two
  diagnostics on this path (`conversation-route-refused`, and the cap/reindex pair) are a static event
  name plus a static code; `DiagnosticEvent` carries no identifier-shaped field and no index signature,
  so the conversation id **cannot** be logged from the router without widening a renderer-facing
  security contract. `newSession`'s `catch` drops its caught object rather than reporting it, because
  an error message could echo the payload, and adds no line. No `console.*` is added anywhere.
- [Concurrency] Not applicable, with the reason: every layer is synchronous and returns `void`. No
  timer, listener, subscription, promise or async task is created, so there is nothing to abort on
  teardown and no `await` for a check-then-act race to open across. The one mutable cell touched is
  the connection's existing `nextEnvelopeId`, incremented in straight-line code.
- [Threat model alignment] No findings. **Malicious relay:** content-blind and on-path; it can drop or
  delay this frame, and the failure mode is a restart that does not happen — nothing hangs, because the
  frame is fire-and-forget with no reply to await and no correlation memory to leave dangling.
  **Hostile daemon response:** no new parsing surface — the frame is outbound-only with no decode path,
  and the `session_transition` the restart produces rides machinery this slice does not touch.
  **Renderer compromise:** bounded above; keys, socket and Noise state stay in the background process,
  and the renderer never sees bytes. **Token theft from disk:** no stored secret is read or written.
  **Out of scope, named:** the daemon-side `interactive` capability gate and the registry validation of
  `conversation_id` are both upstream (pyrycode#2099) and are not re-implemented here; the renderer
  affordance that will actually call this command, and whatever confirmation it needs before
  discarding a running turn's context, belong to the sibling sender ticket.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-07
