# #300 — Send `dequeue_message`: `dequeueMessage` command + IPC + connection method

Add the outbound command path that lets the app tell the daemon to drop one queued-but-not-yet-run
message from a conversation's backlog. Command path only — no renderer surface. The drop affordance
that *calls* this command is a separate later slice (#296).

This is the command half of the round-trip whose wire+builder half (#299, merged 2026-07-12) already
landed: `DequeueMessagePayload` and `buildDequeueMessage` exist; this slice wires them to the
renderer→main command path. It mirrors the outbound-command slice #236 (modal-answer) **minus the
token mint**, and is structurally identical to #241 (`createConversation`), which likewise reuses a
wire payload verbatim and fresh-literal-constructs the frame.

## Files to read first

- `src/shared/ipc/commands.ts:71-101` — the `RendererCommand` union + `sendMessageCommand`/`cancelModalCommand` pure constructors. `dequeueMessage` is added as a new union member; `dequeueMessageCommand` clones `sendMessageCommand` verbatim (wire payload reused directly, **not** an `Omit`-derivative — contrast `answerModalCommand`/`AnswerModalCommandPayload` at :36/:99, which the token-exclusion forces).
- `src/shared/ipc/commands.ts:118-193` — `isRendererCommand` switch + the per-payload guards (`isSendMessagePayload`, `isRequestSnapshotPayload`, `isCancelModalPayload`). The new `case 'dequeueMessage'` and `isDequeueMessagePayload` follow `isSendMessagePayload`'s present-and-string idiom, adding one present-and-number `typeof` check.
- `src/shared/wire/types.ts:359-375` — `DequeueMessagePayload { conversation_id: string; queued_msg_id: number }` (from #299). Reuse verbatim on the command; the doc comment already states it is ungated (no nonce, no answer token) and that the id is a plain integer no layer polices.
- `src/main/transport/dequeueMessageEnvelope.ts` (whole, 44 lines) — `buildDequeueMessage({ id, ts, payload })` from #299. `MAY throw WireEncodeError` on over-cap plaintext; the connection method's try/catch swallows it. Model for the call is `buildRequestSnapshot`.
- `src/main/daemonConnection.ts:761-788` — `createConversation`: the exact template for `dequeueMessage` (fresh-literal payload, shared `nextEnvelopeId`, `driver === null` no-op, `try/catch` classify-don't-forward). Also read the interface doc at :144-152 (the method's contract sits alongside it) and the returned-object list at :957-986.
- `src/main/daemonConnection.ts:33-38, 50-61` — the `build*` imports and the wire-type imports; add `buildDequeueMessage` and `DequeueMessagePayload` to these.
- `src/main/index.ts:234-282` — the `onCommand` switch. Add `case 'dequeueMessage'` forwarding to `connection.dequeueMessage`, mirroring the `requestSnapshot` case at :239-243.
- `src/main/daemonConnection.test.ts:1987-2075` — the `createConversation` describe block: the exact test template for the connection method (no-op before start; forwards one envelope with id 2, ts, payload verbatim; shares the id counter with `send`; strips a smuggled extra field; no-throw on driver throw).
- `src/shared/ipc/commands.test.ts:81-211` — the `isRendererCommand` + constructor test idiom (accept well-formed, accept extra fields, reject missing/mistyped payload fields).
- `src/preload/index.ts` — **read-only confirmation, no change.** `sendCommand(command: RendererCommand)` forwards the whole union generically; a new member needs no preload edit (verified in the ticket body).

## Design source

N/A — command-path-only slice per ticket body (§ "Scope boundary — command path only, no UI"). This slice adds no renderer surface; the visual-fidelity check is intentionally skipped. The drop affordance that calls this command lands in #296.

## Context

The daemon accepts a `dequeue_message` control frame (client → daemon) that removes one
queued-but-not-yet-run message from a conversation's backlog, driving `msgqueue.Remove`. Dropping a
queued message is **ungated** for any paired client (project security model, pyrycode #720: watching,
sending, interrupting, and dropping a queued message are all ungated). So — unlike the modal-answer
path (#236) — there is no answer-token, no second-confirm, and no token minting. The payload carries
only routing data: `conversation_id` + `queued_msg_id`.

This is the missing outbound leg. #299 gave us the wire type and the frame builder. #300 exposes a
`dequeueMessage` renderer→main command, guards it at the untrusted boundary, and adds a
`daemonConnection.dequeueMessage(payload)` method that builds and sends the frame over the established
encrypted connection. A later render slice (#296) supplies the button that dispatches it.

## Design

Three production files change, all additively; no rename, no consumer cascade.

### 1. `src/shared/ipc/commands.ts` — command member, constructor, boundary guard

- **Import**: add `DequeueMessagePayload` to the existing `import type { … } from '../wire/types'`.
- **Union member** (append to `RendererCommand`, :71-80):
  `| { type: 'dequeueMessage'; payload: DequeueMessagePayload }`
  Reuse the wire payload **verbatim** (the `sendMessage`/`requestSnapshot` "reuse wire types, no
  remapping" convention). Because dequeue is ungated, the payload carries no token — **no
  `Omit`-derivative** (unlike `AnswerModalCommandPayload`). Update the union's header doc comment
  ("Nine members today" → ten) and add `dequeueMessage` to its enumeration so the doc stays honest.
- **Pure constructor** — clone `sendMessageCommand` exactly:
  `export function dequeueMessageCommand(fields: DequeueMessagePayload): RendererCommand`
  returns `{ type: 'dequeueMessage', payload: fields }`. Pure; the caller (#296) assembles the
  payload. The `RendererCommand` return type is the compile-time AC guarantee.
- **Guard case** — add to `isRendererCommand`'s switch (before `default`):
  `case 'dequeueMessage': return 'payload' in value && isDequeueMessagePayload(value.payload)`
- **Payload guard** — new `isDequeueMessagePayload(value: unknown): value is DequeueMessagePayload`.
  Validates the untrusted renderer→main boundary: `conversation_id` **present-and-string** plus
  `queued_msg_id` **present-and-number** — a `typeof` check only, **no** integer/positive/range
  check, matching the `requireNumber`-alone posture of the #292 decode guard (a plain per-conversation
  integer no layer polices; an out-of-range id is a daemon-side no-op). Structural minimum: a smuggled
  extra field is not rejected here — the connection method's fresh-literal construction bounds the
  wire. Pure; never throws. Signature/idiom mirror `isSendMessagePayload` (present-and-string checks)
  with `queued_msg_id`'s check being `typeof value.queued_msg_id === 'number'`.

### 2. `src/main/daemonConnection.ts` — the connection method

- **Imports**: add `buildDequeueMessage` from `./transport/dequeueMessageEnvelope`, and
  `DequeueMessagePayload` to the `../shared/wire/types` type import.
- **Interface method** — add to `DaemonConnection` (alongside `createConversation`'s doc at :144-152):
  `dequeueMessage(payload: DequeueMessagePayload): void`. Doc contract: encrypts a payload-carrying
  `dequeue_message` control envelope onto the live session — asks the daemon to drop one queued
  message. The `send` TWIN, not `requestDebugBundle`: an inert no-op when not connected
  (`driver === null` → return), never a `consumer.fail`. Ungated — no reply is expected (no
  correlation memory to leave dangling). NEVER throws out of the module (parity #490).
- **Implementation** — clone `createConversation` (:761-788):
  1. `if (driver === null) return` — inert no-op when not connected (before `start()`,
     mid-bootstrap, or bootstrap-failed).
  2. `try` — build a **fresh literal** naming exactly the two modeled fields, never a spread of
     `payload`: `buildDequeueMessage({ id: nextEnvelopeId, ts: now(), payload: { conversation_id: payload.conversation_id, queued_msg_id: payload.queued_msg_id } })`.
     This is the deterministic anti-smuggling net that bounds the wire to exactly
     `conversation_id`/`queued_msg_id`, ignoring any renderer-smuggled extra field the
     structural-minimum guard let through.
  3. `nextEnvelopeId += 1` — advance only on a successful build (a dropped over-cap send keeps the
     id). Shares the one monotonic `nextEnvelopeId` with `send`/`requestSnapshot`/`createConversation`
     — **no second counter** — so ids stay unique across interleaved calls.
  4. `driver.sendMessage(bytes)`.
  5. `catch {}` — never throw out of the module: an over-cap plaintext (`WireEncodeError`) or any
     driver/wasm throw. The caught object is DROPPED (classify-don't-forward, inherited #62) — its
     message could echo the payload; no log, no event.
- **Returned object** — add `dequeueMessage` to the returned method list (:977-985).

### 3. `src/main/index.ts` — command switch case

Add to the `onCommand` switch (:234-282), mirroring the `requestSnapshot` case:
`case 'dequeueMessage': connection.dequeueMessage(command.payload); return` — direct to the
connection method (no orchestrator/consumer, no facade — a dequeue is fire-and-forget). Comment: sends
`dequeue_message`; ungated, so no reply is expected; inert no-op when not connected (#300). The
command is already validated by `isRendererCommand` at the boundary before it reaches the switch.

### Data flow

```
#296 button (later) → dequeueMessageCommand(fields) → preload sendCommand(cmd)  [renderer, untrusted]
   → ipcMain onCommand → isRendererCommand gate (isDequeueMessagePayload)       [main boundary]
   → connection.dequeueMessage(payload) → buildDequeueMessage → driver.sendMessage → Noise session → daemon
```

No inbound leg: `dequeue_message` is fire-and-forget. The daemon removes the entry and re-broadcasts
its `queue_state` snapshot (decoded by #292, rendered by #294) as the observable effect — but that is
existing machinery, not part of this slice. No new `DaemonEvent` arm, no `daemonEventBridge`/`assertNever`
touch, no correlation map.

## State + concurrency model

No new state. The method is single-writer over the existing module-local `nextEnvelopeId` counter,
exactly like `send`/`createConversation`: it runs to completion synchronously (no `await` between the
counter read and its increment), so there is no check-then-act race — the `nextEnvelopeId` single-writer
rationale at `daemonConnection.ts:272-277` covers it verbatim. No new `Map`/array (dequeue keeps no
correlation memory — nothing awaits a reply, unlike `answerModal`'s `outstandingAnswers` or
`setSessionSettings`'s `pendingSettings`). No listener, no timer, no `AbortController`: the frame rides
the existing driver, whose lifecycle (`dial`/`stop`, generation fence) is untouched. On `dial()` the
counter resets to 2 along with the rest — no dequeue-specific reset needed.

## Error handling

| Failure mode | Layer | Behavior |
|---|---|---|
| Renderer sends a malformed command (missing/mistyped `conversation_id`/`queued_msg_id`) | `isRendererCommand` at the main boundary | Rejected; never reaches the switch. Positive + negative unit tests cover it. |
| Command arrives while not connected (before `start()`, mid-bootstrap, bootstrap-failed) | `dequeueMessage` `driver === null` guard | Inert no-op — the `send` twin, not a `consumer.fail`. No reply was expected anyway. |
| Over-cap plaintext (`WireEncodeError` from `buildDequeueMessage`) | method `try/catch` | Send dropped; id **not** consumed (increment is after the build); caught object dropped (classify-don't-forward). Never throws out of the module. |
| `driver.sendMessage` throws (wasm/driver) | method `try/catch` | Same — swallowed, no throw (parity #490). |
| Smuggled extra field passes the structural-minimum guard | method fresh-literal construction | Field dropped — the wire carries exactly `{ conversation_id, queued_msg_id }`. |

No UI surfacing: this slice has no renderer. A dropped/failed dequeue is silent by design (ungated
fire-and-forget); the user observes the effect via the re-broadcast `queue_state` (#294), or its
absence.

## Testing strategy

Two files, plain `vitest` (`npm test`) + `npm run typecheck`. No rendering assertions (no UI).

### `src/shared/ipc/commands.test.ts` — constructor + boundary guard

- `dequeueMessageCommand` wraps fields into `{ type: 'dequeueMessage', payload: fields }` unchanged
  (mirror the `sendMessageCommand` test) — the payload is passed through verbatim, no field remapped.
- `isRendererCommand` **accepts** a well-formed `dequeueMessage` (string `conversation_id` + number
  `queued_msg_id`), and still accepts one carrying an extra field (structural minimum) — mirror the
  `requestSnapshot` accept tests.
- `isRendererCommand` **rejects** (the negative test): missing payload; `payload: null`; `payload: {}`;
  a non-string `conversation_id`; a **non-number** `queued_msg_id` (e.g. `queued_msg_id: '3'`) — the
  `typeof`-number check is the point. One reject case per row.

### `src/main/daemonConnection.test.ts` — the connection method (new describe block, template = `createConversation` at :1987-2075)

- **No-op before `start()`**: `expect(() => connection.dequeueMessage(PAYLOAD)).not.toThrow()`; no
  driver constructed (`drivers` empty). The send twin, not a fail.
- **AC5 — sends exactly one frame, payload verbatim**: after `handshake-complete`, call
  `dequeueMessage({ conversation_id: 'c1', queued_msg_id: 7 })`; assert `drivers[0].sent` has length 1;
  `decodeEnvelope(sent[0])` has `type: 'dequeue_message'`, `id: 2`, `ts: FIXED_TS`, and
  `payload` **`toEqual({ conversation_id: 'c1', queued_msg_id: 7 })`** — an exact `toEqual`, which
  proves *no answer-token and no nonce* were added (any extra key fails the exact match). This is the
  AC5 assertion.
- **Shares the one envelope-id counter with `send`**: `send(...)` then `dequeueMessage(...)`; assert
  `sent[0].id === 2` and `sent[1].id === 3` (no second counter).
- **Strips a smuggled extra field (fresh literal)**: call `dequeueMessage` with an object carrying an
  extra key beyond the two modeled fields; assert the decoded `payload` is exactly
  `{ conversation_id, queued_msg_id }`. (Cast through `as DequeueMessagePayload` in the test to smuggle
  the extra key past the compiler, as the `createConversation` smuggle test does.)
- **Parity #490 — no throw when the driver throws**: build with `throwOnSend: true`, reach connected,
  `expect(() => connection.dequeueMessage(PAYLOAD)).not.toThrow()`.

The `index.ts` switch case is a trivial one-line forward (typed `command.payload` → method), correct
by construction under the exhaustive switch — no dedicated `index.ts` test, consistent with how the
sibling `requestSnapshot`/`createConversation`/`answerModal` cases are covered.

## Open questions

None. Every contract is fixed by #299 (payload + builder) and the established sibling methods
(#236/#241). The slice is purely additive.

## Split proposal

N/A — 3 production files (`commands.ts`, `daemonConnection.ts`, `index.ts`), under the §4 gate of 5;
additive union member with no consumer cascade; ~60-90 production LOC + ~80 test LOC. Sized S,
confirmed S.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — one new untrusted→trusted boundary: the renderer→main `dequeueMessage` IPC command. It is explicit and single-function: `isRendererCommand`'s new `case 'dequeueMessage'` → `isDequeueMessagePayload` (`conversation_id` string + `queued_msg_id` number). Verified load-bearing: `src/main/receiveCommand.ts:34` gates every command on `isRendererCommand(raw)` before forwarding — a malformed `dequeueMessage` is dropped with a fixed string, never reaching the switch. Downstream holds a narrowed `RendererCommand` (type-system signal). A second deterministic net (belt-and-suspenders, different fabric) is the connection method's fresh-literal construction, which bounds the wire to exactly the two modeled fields regardless of what the structural-minimum guard let through.
- **[Tokens, secrets, credentials]** No findings — **by design there is no token.** Dequeue is ungated (pyrycode #720): no answer-token minted, stored, compared, or logged (contrast `answerModal`'s `randomUUID` mint). The payload carries no secret — `conversation_id` is a routing id, `queued_msg_id` a plain integer. The absence of a token is the security model, not an omission.
- **[File / storage operations]** N/A — the slice constructs no filesystem path and performs no file I/O. `conversation_id` never touches a path.
- **[Inter-process / Electron attack surface]** No findings — **no new IPC channel and no new `contextBridge` API**: the slice extends the existing `COMMAND_CHANNEL` union that `onCommand` already listens on, and preload already forwards the whole `RendererCommand` union generically (verified read-only). No `webPreferences` change. The exposed capability is narrow (drop one queued message by id), not a broad primitive. Process placement holds: the frame build (`buildDequeueMessage`, which imports `codec`/`Buffer`) and the Noise send stay in main and are never re-exported to the renderer; the renderer supplies only two scalars and never touches keys or the socket.
- **[Cryptographic primitives]** No findings — none introduced. No RNG (no token). No key/nonce handling here — the existing Noise driver owns per-direction nonces; this method hands opaque early-data bytes to `driver.sendMessage`. Sharing the one monotonic `nextEnvelopeId` is a correlation-id counter, not a nonce, and no `(key, nonce)` pair is reused.
- **[Network & I/O]** No findings — no new socket, relay URL, or frame-size handling. The frame rides the existing driver/relay connection under its existing `MAX_FRAME_BYTES` cap; `buildDequeueMessage` enforces `MAX_PLAINTEXT_BYTES` (throws `WireEncodeError` on over-cap, caught and dropped). No new timeout/reconnect logic.
- **[Error messages, logs, telemetry]** No findings — the method logs nothing (consistent with `send`/`createConversation`), and its `catch` drops the caught object (classify-don't-forward): no payload echo into a log or event. `conversation_id`/`queued_msg_id` never reach a log. The boundary drop at `receiveCommand.ts:37` logs a fixed string, never renderer data.
- **[Concurrency]** No findings — fully synchronous, no `await`; single-writer over `nextEnvelopeId` (increment completes before any yield → no check-then-act race). No new task, timer, listener, or `AbortController`; no owned resource to tear down. Rides the single live driver (no duplicate connection).
- **[Threat model alignment]** No findings — *Malicious/compromised relay:* it sees an opaque ciphertext frame; a dropped/delayed/reordered dequeue fails safe (the message simply stays queued — no plaintext leak, and fire-and-forget means no awaited reply to hang a handler); a replayed dequeue is a daemon-side idempotent no-op. *Hostile daemon response:* N/A inbound — dequeue expects no reply; the observable `queue_state` re-broadcast is parsed defensively by #292's existing decoder (out of scope). *Token theft from disk:* N/A (no token). *Renderer compromise reaching the transport:* a compromised renderer could dispatch `dequeueMessage` with an arbitrary `conversation_id`/unranged `queued_msg_id`, but this **does not widen the trust envelope** — dequeue is ungated by design, and a renderer reaching `COMMAND_CHANNEL` can already send `send_message`/`create_conversation`; process isolation (keys/socket in main only) is the boundary and is unchanged, and a bad id is a daemon-side no-op (the accepted `requireNumber`-alone posture). Addressed by existing isolation.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-12
