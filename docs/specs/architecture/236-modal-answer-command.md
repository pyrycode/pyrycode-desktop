# #236 — Main-side modal-answer command: mint `answer_token`, route + send `modal_answer` / `modal_cancel`

Wire the **main-side command path** that resolves an outstanding permission/trust modal: a `RendererCommand`
carries the user's choice from the (untrusted) renderer to main, the main switch routes it, and
`daemonConnection` mints a fresh idempotency `answer_token` and sends the frame via the #235 builders.

- **Size:** S. Three production files, additive, zero fan-out (verified — see § Scope).
- **Security-sensitive:** yes. Mints the client-side idempotency token and constructs + sends answer frames
  on the encrypted channel; the command-payload guards are the untrusted renderer→main boundary check.
  Security-review pass at the end of this doc.
- **Not UI-visible.** No Figma / no Design source section — the renderer buttons that fire this command are
  the next slice (#237). Nothing renders here.
- **Blocker:** #235 (`buildModalAnswer` / `buildModalCancel`, merged PR #238). Both builders live in
  `src/main/transport/modalResolutionEnvelope.ts` (one file, no barrel, main-only).

## Files to read first

- `src/shared/ipc/commands.ts` (whole file, ~99 lines) — the `RendererCommand` union, `sendMessageCommand`
  constructor, `isRendererCommand` guard, and the two payload guards (`isSendMessagePayload`,
  `isRequestSnapshotPayload`). **This is the exact pattern to extend.** Note the module header's AC5 framing
  ("no member has a field that could hold a secret").
- `src/main/daemonConnection.ts:498-547` — `send`, `requestSnapshot`, `requestConversations`. The
  `if (driver === null) return` → `try { build; nextEnvelopeId += 1; driver.sendMessage(bytes) } catch {}`
  precedent to mirror exactly. Read `:178-201` for the `now` / `createDriver` DI-seam wiring and the shared
  `nextEnvelopeId` counter comment.
- `src/main/daemonConnection.ts:105-135` — the `DaemonConnection` interface doc-comments for `send` /
  `requestSnapshot` / `requestConversations`; the two new methods get sibling entries.
- `src/main/transport/modalResolutionEnvelope.ts` (whole file, ~79 lines) — `buildModalAnswer` /
  `buildModalCancel` signatures + `ModalAnswerInput` / `ModalCancelInput`. Confirms the consumer supplies
  `{ id, ts, payload }` and that the payload already carries the minted `answer_token`.
- `src/shared/wire/types.ts:311-340` — `ModalAnswerPayload { modal_id, option_id, answer_token }` and
  `ModalCancelPayload { modal_id }`. The field set + wire order; note `answer_token` is "minted main-side by
  #236 (not here)".
- `src/main/index.ts:234-254` — the `onCommand` switch; add two cases mirroring `requestSnapshot`.
- `src/main/fileSecretPersistence.ts:9` — `import { randomBytes } from 'node:crypto'`: proof `node:crypto`
  is already a main-side dependency; `randomUUID` comes from the same module, no new dep.
- `src/main/daemonConnection.test.ts:930-989` — the `requestSnapshot` describe block. The two new describe
  blocks copy its four cases (no-op before start, forwards one envelope with id 2 + payload, shares the id
  counter, does-not-throw-on-driver-throw), plus the token-mint assertions below. Read `:144-160` for the
  `build()` helper and `FIXED_TS`.
- `src/shared/ipc/commands.test.ts:37-68` — `isRendererCommand` positive/negative cases to extend.

## Context

Split from #225 (the outbound modal answer/cancel path — last slice of the #201 modal vertical), 3-way by
the transport/render layer seam: #235 wire+builders (done) → **#236 main-side command (this)** → #237 renderer
buttons. This slice is the exact analogue of the `requestSnapshot` command path (#180 → #187): the command is
defined and handled main-side even though nothing dispatches it yet. #237 mounts the fire site.

**Idempotency & no self-gate** (background — not new work here). The `answer_token` is a client-minted
idempotency key tying the answer to the one-time `modal_id`. A replayed / reordered answer is inert because
the daemon resolves `modal_id` against its own outstanding-modal state and first-answer-wins (ADR 0009). The
client mints a fresh token per call and never re-sends. The `--allow-remote-permissions` grant is daemon-side
per-device (`~/.pyry/<name>/devices.json`) — not on the wire, not in the pairing record — so the desktop
**cannot self-gate**: it answers regardless; an ungranted device's answer round-trips to an `error` envelope
(surfaced by #227, a separate slice). `modal_id` is the sole correlation key — no `conversation_id` rides a
modal.

## Design

Additive across three files. No new module, no fan-out.

### 1. `src/shared/ipc/commands.ts` — two new union members + constructors + guards, in lockstep

**Command-payload type.** The answer command carries `modal_id` + `option_id` but **must not carry the
`answer_token`** (minted main-side). Express this as a type derived from the wire payload so the exclusion is
enforced by construction and the field names stay tied to the wire contract:

```ts
export type AnswerModalCommandPayload = Omit<ModalAnswerPayload, 'answer_token'>  // { modal_id, option_id }
```

The cancel command carries `{ modal_id }` — exactly the wire `ModalCancelPayload`, reused verbatim (the
`sendMessage` / `requestSnapshot` "reuse wire types, no remapping" convention). Import both `ModalAnswerPayload`
and `ModalCancelPayload` (types) from `../wire/types`.

**Union members** (extend `RendererCommand` additively):

```ts
| { type: 'answerModal'; payload: AnswerModalCommandPayload }
| { type: 'cancelModal'; payload: ModalCancelPayload }
```

**Pure constructors** (mirror `sendMessageCommand` — pure, no token minted here):
- `answerModalCommand(fields: AnswerModalCommandPayload): RendererCommand` → `{ type: 'answerModal', payload: fields }`
- `cancelModalCommand(fields: ModalCancelPayload): RendererCommand` → `{ type: 'cancelModal', payload: fields }`

**Guard cases** in `isRendererCommand` (add in the switch, in lockstep — an unguarded member is silently
dropped at the untrusted boundary):
- `case 'answerModal': return 'payload' in value && isAnswerModalPayload(value.payload)`
- `case 'cancelModal': return 'payload' in value && isCancelModalPayload(value.payload)`

**Payload guards** (mirror `isRequestSnapshotPayload` — pure, never throw, structural minimum):
- `isAnswerModalPayload(value): value is AnswerModalCommandPayload` — object, non-null, `modal_id` string AND
  `option_id` string.
- `isCancelModalPayload(value): value is ModalCancelPayload` — object, non-null, `modal_id` string.

Both accept extra/unknown fields (the existing structural-minimum convention). The guards do **not** need to
reject a smuggled `answer_token` field — the main-side sender never reads it (see § Security: fresh-literal
construction is the deterministic net). Keep guards non-exported (module-private, like the existing two).

### 2. `src/main/index.ts` — two switch cases

In the `onCommand` switch (`:234-252`), add two cases mirroring `requestSnapshot` (direct to the connection
method, no facade/orchestrator):

```ts
case 'answerModal':  connection.answerModal(command.payload);  return
case 'cancelModal':  connection.cancelModal(command.payload);  return
```

### 3. `src/main/daemonConnection.ts` — two methods, one minting the token

**Token DI seam.** Add an optional dep mirroring the existing `now` / `createDriver` seams so the mint is
deterministic under test:

```ts
// in DaemonConnectionDeps:
/** Mints the client-side idempotency answer_token per modal_answer. Default: crypto.randomUUID.
 *  A DI seam (like now / createDriver). MAIN-side only — the renderer never mints. */
mintToken?: () => string
```

Resolve alongside `now` / `createDriver`: `const mintToken = deps.mintToken ?? ((): string => randomUUID())`.
Import `randomUUID` from `node:crypto` (already a main-side dep — `fileSecretPersistence.ts:9`). No new package.

**`DaemonConnection` interface** — two sibling entries after `requestConversations`, doc-commented like the
`requestSnapshot` twin (inert no-op when not connected; never throws out of the module — parity #490):
- `answerModal(payload: Omit<ModalAnswerPayload, 'answer_token'>): void`
- `cancelModal(payload: ModalCancelPayload): void`

**`answerModal` body** — the `send` / `requestSnapshot` shape, with the token minted into a **fresh payload
literal** (never a spread of the command payload):

- `if (driver === null) return` — the inert-when-not-connected guard.
- `try { … } catch {}` — never throw; caught object dropped (classify-don't-forward, inherited #62).
- Inside: build the wire `ModalAnswerPayload` as a fresh literal
  `{ modal_id: payload.modal_id, option_id: payload.option_id, answer_token: mintToken() }`, pass to
  `buildModalAnswer({ id: nextEnvelopeId, ts: now(), payload: <literal> })`, then `nextEnvelopeId += 1`
  (advance only on a successful build — a dropped over-cap send keeps the id), then `driver.sendMessage(bytes)`.

**`cancelModal` body** — same shape, no token:
- `if (driver === null) return`; `try { … } catch {}`.
- Build a fresh literal `{ modal_id: payload.modal_id }` (strip any smuggled extra field), pass to
  `buildModalCancel({ id: nextEnvelopeId, ts: now(), payload: <literal> })`, `nextEnvelopeId += 1`,
  `driver.sendMessage(bytes)`.

**Return object** — add `answerModal, cancelModal` to the returned `DaemonConnection` (`:600-624`, next to
`requestSnapshot` / `requestConversations`).

Import `ModalAnswerPayload` and `ModalCancelPayload` (types) from `../shared/wire/types` (extend the existing
type import at `:45-50`) and `buildModalAnswer` / `buildModalCancel` from `./transport/modalResolutionEnvelope`.

### Data flow

```
renderer (#237)  ── answerModalCommand({modal_id, option_id}) ──►  sendCommand(COMMAND_CHANNEL)
   │                                                                        │
   │  [untrusted → trusted boundary]                                        ▼
   └────────────────────────────────►  receiveCommand: isRendererCommand guard  ──►  index.ts switch
                                                                                        │
                                        connection.answerModal(payload)  ◄──────────────┘
                                                │
                    mint answer_token (main-side) → fresh ModalAnswerPayload literal
                                                │
                              buildModalAnswer({id, ts, payload}) → driver.sendMessage(bytes)
```

## State + concurrency model

- **No new state.** The two methods reuse the module-local, single-writer `nextEnvelopeId` counter shared with
  `send` / `requestSnapshot` / `requestConversations` / `requestDebugBundle`. No `await` in either method, so
  the read-increment runs to completion with no check-then-act race — identical to the existing methods.
- **No new store, no renderer state.** The renderer button + `dismissed`-reducer clear are #237.
- **Envelope id** advances only on a successful build (a dropped over-cap send keeps the id). Ids stay unique
  across interleaved calls; the daemon correlates replies by id, not sequence.

## Error handling

Both methods are inert no-ops when not connected (`driver === null` → return) and never throw out of the module
(parity #490):

| Failure mode | Handling |
|---|---|
| Not connected (before `start()`, mid-bootstrap, bootstrap-failed, post-terminal) | `driver === null` → return; no send, no throw. The `send` twin (a modal-resolution has no consumer to fail — unlike `requestDebugBundle`), so it is a silent no-op, not a `consumer.fail`. |
| Over-cap serialized envelope | `buildModalAnswer` / `buildModalCancel` throw `WireEncodeError`; the `catch {}` drops it. The caught object is dropped (its message could echo the payload). |
| `driver.sendMessage` throws (wasm/driver) | Same `catch {}`; dropped. |
| Ungranted device (answer rejected daemon-side) | Out of scope here — round-trips to an `error` envelope surfaced by #227. This slice always sends. |

No new `DaemonEvent`, no new failure classification, no `emitFailed` call — these are pure outbound sends with
no synchronous reply.

## Testing strategy

`npm test` (vitest). Extend the existing precedent test files; no new test file needed.

**`src/shared/ipc/commands.test.ts`** — extend the `isRendererCommand` block + add constructor cases:
- `answerModal` with a valid `{ modal_id, option_id }` payload → guard `true`.
- `cancelModal` with a valid `{ modal_id }` payload → guard `true`.
- `answerModal` missing `option_id` (or non-string) → `false`; `cancelModal` missing `modal_id` → `false`;
  member with no `payload` → `false`.
- `answerModalCommand({modal_id, option_id})` / `cancelModalCommand({modal_id})` return the well-formed member
  with the right `type` and the payload passed through.
- Boundary assertion for AC5: the answer constructor's `fields` type cannot hold `answer_token` (compile-time,
  via `Omit`); a runtime test that a payload carrying an *extra* `answer_token` still guards `true` (structural
  minimum) documents that the mint is main-side, not that the command rejects the field.

**`src/main/daemonConnection.test.ts`** — two describe blocks mirroring `requestSnapshot` (`:930-989`). Add
`mintToken` to the `build()` helper deps (a fixed `() => 'test-token'` default, or a counter for the
uniqueness case). For each of `answerModal` / `cancelModal`:
- No-op before `start()`: no driver constructed, `not.toThrow()`, nothing sent (the send twin, not a fail).
- After `handshake-complete`: forwards exactly one envelope; decode it and assert `type` is
  `modal_answer` / `modal_cancel`, `id` is 2, `ts` is `FIXED_TS`, and the payload.
- Shares the one envelope-id counter with `send` (a `send` then an `answerModal` → ids 2, 3).
- Does not throw when `driver.sendMessage` throws (`throwOnSend: true`).

`answerModal`-specific:
- The forwarded `modal_answer` payload equals `{ modal_id, option_id, answer_token: 'test-token' }` — asserts
  the minted token lands in the sent frame and the `modal_id` / `option_id` pass through.
- **Uniqueness:** with a counter `mintToken`, two `answerModal` calls produce two frames whose `answer_token`
  values differ — the anti-replay property (fresh token per call).
- **Fresh-literal / no-smuggle:** call `answerModal` with a payload that *also* carries an `answer_token`
  (cast through `unknown`); assert the sent frame's `answer_token` is the minted one, not the smuggled value —
  proves the sender ignores a renderer-supplied token.

`cancelModal`-specific:
- Fresh-literal: call with a payload carrying an extra field; assert the sent `modal_cancel` payload is exactly
  `{ modal_id }` (no extra field crosses the wire).

Coverage split: the guards + constructors are plain-function tests (no rendering); the send behaviour is
driver-fake tests decoding the emitted bytes via `decodeEnvelope`. Type-level coverage (`Omit` excludes the
token; new members type-check) is caught by `npm run typecheck` in the build gate.

**Gate:** `npm run build` + `npm test` green (AC5).

## Scope

Production source files (`*.ts`, excluding tests/md): **3** — `src/shared/ipc/commands.ts`,
`src/main/index.ts`, `src/main/daemonConnection.ts`. Under the 5-file red line. New exported types: **1**
(`AnswerModalCommandPayload`). Fan-out verified zero: `preload/index.ts` and `receiveCommand.ts` pass
`RendererCommand` opaquely (no `type` switch); renderer consumers (`runConfigSnapshot.ts`, `composerSend.ts`,
`conversationListBridge.ts`) construct specific members and don't switch exhaustively; the only `command.type`
switch is `index.ts` (edited here). Estimated total written: ~150 production + ~200 test ≈ 350 LOC. Size S
confirmed.

## Open questions

None blocking. One decision the developer inherits:
- **Token source.** `crypto.randomUUID()` via the `mintToken` DI seam (default). The ticket left the exact
  randomness source to the architect; `randomUUID` is the simplest main-side unique-and-stable source, no new
  dep, and the seam keeps tests deterministic. If a shorter token is ever wanted, only the default lambda
  changes — the wire type is `string`, unconstrained. The `answer_token`'s secrecy does **not** matter (it is
  an anti-replay key, not a credential — protocol-mobile.md § Modal); only uniqueness + stability per call.

## Security review

**Verdict:** PASS

Adversarial self-review per `architect/security-review.md`. Walked all nine categories; no MUST FIX.

**Findings:**

- **[Trust boundaries]** No MUST FIX — the renderer is untrusted (`commands.ts` header). The one boundary
  crossed is renderer→main over `COMMAND_CHANNEL`, re-validated at `receiveCommand.ts:34` by `isRendererCommand`,
  which now gates `answerModal` / `cancelModal` through `isAnswerModalPayload` / `isCancelModalPayload` (single
  explicit guard, not scattered). The lockstep requirement (AC1) is the enforcement: a union member without a
  matching guard case is silently dropped at this boundary, so the member and its guard case are specified
  together above. Downstream (`index.ts` switch, `daemonConnection`) holds a validated `RendererCommand` only.
- **[Tokens, secrets, credentials]** No finding — `answer_token` is minted main-side via `crypto.randomUUID()`
  (Node CSPRNG, ~122 bits; **not** `Math.random()`), never in the renderer, and is structurally excluded from
  the command type by `AnswerModalCommandPayload = Omit<ModalAnswerPayload, 'answer_token'>` (AC: "No member
  carries a token"). It is an anti-replay idempotency key, **not a credential** — its secrecy does not matter
  (protocol-mobile.md § Modal), only uniqueness + stability per call. Lifecycle: created per call, sent, never
  stored, never rotated/revoked (ephemeral by design), never logged. Storage/rotation/revocation questions are
  therefore N/A — there is nothing at rest.
- **[File / storage operations]** N/A — this slice performs zero filesystem I/O. No path construction, no read,
  no write, no temp file. Nothing to traverse, TOCTOU, or leave partial.
- **[Inter-process / Electron attack surface]** No MUST FIX — no new IPC channel, no new `contextBridge` API, no
  new `ipcMain.handle` / `ipcMain.on`, no window / `webPreferences` change, no custom protocol or navigation.
  The change is two members on the existing opaque `sendCommand` → `COMMAND_CHANNEL` path; both new arguments are
  type-and-shape validated by the new guards before use, and the exposed capability is minimised — the renderer
  can only request "answer/cancel modal `<id>` with option `<id>`," never mint the token, build the frame, or
  touch the socket. Process placement is correct: token mint + frame build + `driver.sendMessage` are entirely
  main-side; the renderer never sees the token or the bytes (CLAUDE.md "keep the transport out of the window").
- **[Cryptographic primitives]** No finding — no crypto is implemented here. The Noise handshake / AEAD stays in
  the driver one layer down; the builders only serialize an envelope. RNG is `randomUUID` (CSPRNG). **The shared
  `nextEnvelopeId` is an application-envelope id (daemon `in_reply_to` correlation), NOT a Noise nonce** — the
  Noise session owns its per-direction nonce counters below this module, so there is no `(key, nonce)` reuse
  surface here. No constant-time compare is needed: the client never compares the token to a secret (the daemon
  resolves `modal_id`, the client just sends).
- **[Network & I/O]** No finding — outbound only, on the already-established session; no new socket, timeout,
  TLS, or reconnect logic (all owned by the driver). Frame-size safety is inherited: `buildModalAnswer` /
  `buildModalCancel` throw `WireEncodeError` past `MAX_PLAINTEXT_BYTES`, caught and dropped (no unbounded frame,
  no throw out of the module).
- **[Error messages, logs, telemetry]** No finding — no new log call, no `console.*`, no renderer-facing error
  (outbound send, no synchronous reply). Both `catch {}` blocks drop the caught object (inherited #62
  classify-don't-forward) — a `WireEncodeError` message could echo the payload, so it never reaches the sink.
- **[Concurrency]** No finding — both methods are synchronous (no `await`), so the read-increment of the shared
  single-writer `nextEnvelopeId` runs to completion with no check-then-act race (identical to `send` /
  `requestSnapshot`). No new async task, timer, or listener to own or cancel. Post-`stop()` / not-connected is
  covered by the `driver === null` guard (inert no-op); no new socket, so the single-live-transport invariant is
  unchanged.
- **[Threat model alignment]** No MUST FIX. Malicious/compromised relay: content-blind and on-path — it can
  drop/delay/reorder the opaque encrypted frame but cannot read it (Noise); a dropped answer degrades to the
  daemon's deny-default timeout (fail-safe), a replayed/reordered answer is inert (daemon `modal_id`
  first-answer-wins + the anti-replay token). Hostile daemon response: N/A here — outbound only, nothing parsed;
  an ungranted device's answer round-trips to an `error` envelope. Renderer compromise reaching transport: a
  compromised renderer can issue arbitrary `answerModal` / `cancelModal` commands, but this does not widen its
  capability beyond what the existing `sendMessage` channel already grants (drive the daemon session), it cannot
  forge the token to a chosen value (minted main-side; the fresh literal ignores a smuggled token), and process
  isolation still bars it from keys / socket / bytes — a considered residual at the existing trust level, not a
  new escalation. Token-theft-from-disk: N/A (ephemeral, never stored).
- **[Anti-ADR-025 wire-contract guard]** OUT OF SCOPE (inherited, held) — ADR 025 (daemon-side, stale) sketches
  `modal_answer{conversation_id, option_ids[]}`; #235 pinned the correct shape in the wire type + a
  `not.toHaveProperty` regression test. This slice builds `ModalAnswerPayload` / `ModalCancelPayload` literals
  against those types (fresh literal naming exactly the three / one modeled fields), so the stale shape cannot
  leak. No new guard needed.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-10

## Acceptance criteria (from the ticket)

1. `RendererCommand` gains the answer (`modal_id` + `option_id`) and cancel (`modal_id`) members, with pure
   constructors, `isRendererCommand` guard cases, and payload guards added in lockstep. No member carries a
   token, key, or raw frame.
2. `src/main/index.ts` routes the new members to `connection.answerModal` / `cancelModal`.
3. `answerModal` mints a fresh `answer_token` per call (tying the answer to the one-time `modal_id`) and sends
   `modal_answer` via `buildModalAnswer`; `cancelModal` sends `modal_cancel` via `buildModalCancel`. Both are
   inert no-ops when not connected and never throw out of the module.
4. No renderer dispatch is wired here; no `interactive` flip.
5. `npm run build` + `npm test` green.
