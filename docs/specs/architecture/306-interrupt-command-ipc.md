# #306 — Send the `interrupt` control frame from the background process (command + IPC)

**Size:** S · **Security-sensitive:** yes · **Split from:** #146 · **Depends on:** #305 (frame builder, merged) · **Followed by:** #307 (render affordance)

## Files to read first

- `src/shared/ipc/commands.ts:44-127` — the `RendererCommand` union, the pure factories (`sendMessageCommand` / `dequeueMessageCommand`), and the module header doc. The bare `requestConversations` member (line 79) and bare `requestDebugBundle` (line 77) are the exact shape to clone: a `type`-only union member with **no** `payload`. Extract: where to add the new union member and its factory.
- `src/shared/ipc/commands.ts:135-170` — `isRendererCommand`, the untrusted-boundary guard switch. The `case 'requestConversations': return true` arm (line 145-147) is the bare-member pattern to mirror. Extract: where to add `case 'interrupt': return true` **in lockstep** with the union (or the member is silently dropped at the boundary).
- `src/main/transport/interruptEnvelope.ts` (whole file, 53 lines) — the #305 builder. `buildInterrupt(input: InterruptInput): Uint8Array` takes `{ id: number; ts: string }` and **no payload arg** (bare control frame; emits `payload: {}`). Extract: the exact call shape the connection method feeds — `buildInterrupt({ id: nextEnvelopeId, ts: now() })`. Do not invent a payload.
- `src/main/daemonConnection.ts:136-145` — the `requestConversations(): void` interface-method doc. The bare structural twin. Extract: the JSDoc shape + `send`-twin inert-when-not-connected contract to echo for `interrupt()`.
- `src/main/daemonConnection.ts:756-771` — the `requestConversations()` **implementation**. The exact body to clone (bare, `driver === null` guard, `buildListConversations({ id, ts })`, `nextEnvelopeId += 1` on success, `catch {}` drop). Extract: line-for-line template for `interrupt()`.
- `src/main/daemonConnection.ts:30-38, 1017-1027` — the builder-import block and the returned-object property list. Extract: add one `import { buildInterrupt }` line and one `interrupt,` property.
- `src/main/index.ts:234-288` — the command dispatcher switch. The `case 'requestConversations'` arm (line 244-248) is the mirror: direct to the connection method, no orchestrator/facade. Extract: where to add `case 'interrupt': connection.interrupt(); return`.
- `src/main/daemonConnection.test.ts:1875-1942` — the `requestConversations` describe-block: no-op-before-start, forwards-one-bare-envelope, shares-id-counter, does-not-throw-on-send-throw. Extract: the four test scenarios to clone for `interrupt`.
- `src/shared/ipc/commands.test.ts:83-172` — `dequeueMessageCommand` factory round-trip + the bare `requestDebugBundle` guard tests (lines 151-162). Extract: the factory-round-trip and bare-guard test idioms.
- `docs/knowledge/decisions/` (if a #707/interrupt ADR exists) and the #305 spec `docs/specs/architecture/305-*.md` — the `interrupt`-is-bare / fire-and-forget rationale (daemon SSOT: pyrycode/pyrycode #707).

## Context

`interrupt` stops the current turn: the daemon maps a bare `interrupt` v2 control frame to a single Esc keystroke into the supervised claude (daemon SSOT: pyrycode/pyrycode #707). #305 landed the frame **builder** (`buildInterrupt`). This slice wires the **command pathway** on top of it:

1. the typed renderer→main command (`{ type: 'interrupt' }`),
2. the `daemonConnection.interrupt()` method that emits the frame,
3. the one main-side dispatcher arm that routes to it.

The frame is **fire-and-forget**: the daemon owes no reply and emits no broadcast. The turn stops via the normal end-of-turn events (`turn_end` / `turn_state{idle}`) the timeline already handles — this slice does **not** wait for or correlate any response. The UI affordance that dispatches the command lands in #307.

The design is a three-file clone of the bare-member pathway already proven by `requestConversations` (#139) and `requestDebugBundle` (#168): a payload-free union member, a payload-free connection method, one dispatcher arm.

**No UI in this slice** — no Figma / Design source section applies. The visible affordance ships in #307.

## Design

Three edits, each mirroring an existing bare-member sibling. No new files.

### 1. `src/shared/ipc/commands.ts` — union member, factory, guard arm

- **Union** — add a bare member (place after `dequeueMessage`, keeping the additive-tail convention):
  ```ts
  | { type: 'interrupt' }
  ```
  No `payload` — the frame is bare (mirrors `requestConversations` / `requestDebugBundle`). Update the union's header doc to name the new member as bare "carries NO payload — stops the running turn" and reaffirm AC5 (no member exposes a token/key/raw-frame field).
- **Factory** — a pure zero-arg constructor:
  ```ts
  export function interruptCommand(): RendererCommand // returns { type: 'interrupt' }
  ```
  Return type is `RendererCommand` (the compile-time AC4 guarantee). No randomness, no fields — the twin of a hypothetical bare `requestConversationsCommand`; model the doc on `dequeueMessageCommand` minus the payload.
- **Guard** — add to `isRendererCommand`'s switch, in lockstep with the union:
  ```ts
  case 'interrupt':
    // Bare member: no payload to validate, so a well-formed `type` is complete acceptance.
    return true
  ```
  Clone the `requestConversations` arm's comment verbatim. **This arm is load-bearing:** omit it and the new member falls through to `default: return false` and is silently rejected at the untrusted boundary (fail-closed, but the command never dispatches).

### 2. `src/main/daemonConnection.ts` — `interrupt(): void` method

- **Import** — one line in the builder-import block (lines 30-38):
  ```ts
  import { buildInterrupt } from './transport/interruptEnvelope'
  ```
- **Interface declaration** — add `interrupt(): void` to the `DaemonConnection` interface, with JSDoc cloned from `requestConversations` (lines 136-145): the `send` TWIN, not `requestDebugBundle`; inert no-op when not connected (`driver === null` → return), never a `consumer.fail`; **fire-and-forget** — no reply is expected, **no correlation memory** to leave dangling (echo the `dequeueMessage` fire-and-forget wording); NEVER throws out of the module (parity #490). Note it is bare (no payload argument) and its caller is #307.
- **Implementation** — a line-for-line clone of `requestConversations` (lines 756-771), signature `function interrupt(): void`:
  - `if (driver === null) return` — inert when not connected.
  - `try { const bytes = buildInterrupt({ id: nextEnvelopeId, ts: now() }); nextEnvelopeId += 1; driver.sendMessage(bytes) } catch { /* drop, parity #490 */ }`
  - Feed the shared monotonic `nextEnvelopeId` + `now()` exactly as `requestConversations` does — **one** counter, advanced only on a successful build. **No fresh-literal payload block** (that pattern belongs to the payload-bearing methods like `dequeueMessage`/`createConversation`); `buildInterrupt` takes no payload.
  - The `catch` drops silently (classify-don't-forward, #62) — no log, no event. Clone the `requestConversations` catch comment.
- **Return object** — add `interrupt,` to the returned object (lines 1017-1027).

### 3. `src/main/index.ts` — dispatcher arm

- Add one `case` to the `onCommand` switch (lines 235-287), mirroring `case 'requestConversations'`:
  ```ts
  case 'interrupt':
    // Direct to the connection method (mirrors requestConversations), no orchestrator — a bare
    // fire-and-forget stop-the-turn frame. No reply is expected. Inert no-op when not connected (#306).
    connection.interrupt()
    return
  ```
- The switch has **no** `default`/`assertNever` arm (it is not exhaustiveness-checked at compile time), so this arm must be added by hand — the "grow in lockstep" note. Omitting it means a validated `interrupt` command reaches the dispatcher and falls through to nothing (silent drop).

### Preload bridge — unchanged

The generic `sendCommand(command: RendererCommand)` pipe on `COMMAND_CHANNEL` already carries any union member. No preload change (confirm by reading `src/preload/index.ts`'s `sendCommand` if in doubt — do not add a channel or a bespoke method).

## State + concurrency model

- **No new store, no new state.** This is a pure command-emission pathway; there is no reducer, no store slice, no subscription.
- **Envelope id** — `interrupt()` reads and advances the single module-scoped `nextEnvelopeId` (single-writer; the connection's methods run on the main-process event loop with no `await` between the read and the `+= 1`, so no interleave). Advance only on a successful build, matching every sibling — a dropped over-cap send keeps the id (a bare ~60-byte frame can never over-cap, but the pattern stays uniform).
- **Fire-and-forget** — unlike `answerModal` / `setSessionSettings`, `interrupt()` records **no** outstanding-correlation entry. There is nothing to time out, nothing to leave dangling on teardown, nothing to clean up.
- **Inert when not connected** — `driver === null` → return, no throw, no consumer to fail. A command arriving pre-handshake or post-terminal is a safe no-op.

## Error handling

- **Build/send throw** — caught inside `interrupt()` and dropped (parity #490, classify-don't-forward #62). No log (the caught object could echo internal state; for a bare no-payload frame there is nothing sensitive, but the uniform posture is: drop, no log, no event). The renderer is not notified — the affordance (#307) is optimistic; the daemon's ordinary end-of-turn events remain the source of truth for "did the turn stop."
- **Not connected** — inert no-op (see above); the user's Esc has no effect, which is correct (no session to interrupt).
- **Guard rejection** — a malformed `interrupt`-shaped value at the untrusted boundary is rejected by `isRendererCommand` (fail-closed). Since the member is bare, the only way to be rejected is to not have `type === 'interrupt'`; a well-formed bare command always passes.
- **No inbound parsing** — the daemon sends no reply, so there is no response-parse failure mode on this leg.

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. Two files, both cloning existing sibling blocks.

**`src/shared/ipc/commands.test.ts`** — add a `describe('interruptCommand (#306)')` and extend the `isRendererCommand` block:
- `interruptCommand()` returns exactly `{ type: 'interrupt' }` (factory round-trip; discriminant read from the module, not a bare literal — mirror the `dequeueMessageCommand` test's `.toEqual` + narrow-on-discriminant assertion).
- `isRendererCommand({ type: 'interrupt' })` is `true` (bare member accepted).
- `isRendererCommand({ type: 'interrupt', extra: 'ignored' })` is `true` (structural minimum — extra field tolerated, clone the `requestDebugBundle` bare-guard test).
- Compile-time proof the bare member is in the union: assign `interruptCommand()` to a `RendererCommand` and guard it (clone the `requestDebugBundle` "types the bare member" test).

**`src/main/daemonConnection.test.ts`** — add `describe('createDaemonConnection — interrupt (bare interrupt control frame, fire-and-forget, #306)')`, cloning the `requestConversations` block (lines 1875-1942):
- **No-op before `start()`**: `connection.interrupt()` does not throw and forwards nothing (`drivers` empty) — the send twin, not a fail.
- **After handshake-complete**: forwards exactly one envelope; `decodeEnvelope(sent[0])` has `type === 'interrupt'`, `id === 2`, `ts === FIXED_TS`, and `payload` deep-equals `{}` (bare present-empty payload, per the #305 builder).
- **Shares the one id counter with `send`**: `send(...)` then `interrupt()` → ids `2` then `3` (no second counter).
- **Does not throw on driver send-throw** (parity #490): built with `throwOnSend: true`, `interrupt()` after handshake does not throw and emits no event.

Write the test bodies in the file's existing idiom (`build()` / `connected()` helpers, `decodeEnvelope`, `FIXED_TS`, `validHelloAck`) — do not import the main codec into the shared test.

**Not unit-tested:** the `src/main/index.ts` dispatcher arm. `index.ts` is the Electron composition root (no harness); every sibling arm (`requestConversations`, `dequeueMessage`) is likewise untested there. The arm is a one-line direct call whose correctness is carried by the typed switch + the connection-method tests. Do not stand up an Electron test just for this arm.

## Open questions

None. The pathway is a fully-specified clone of two merged siblings (`requestConversations` bare member + `dequeueMessage` fire-and-forget command); the #305 builder is merged and its call shape is fixed (`buildInterrupt({ id, ts })`, no payload).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — the only untrusted→trusted crossing is the renderer→main IPC message, gated by `isRendererCommand` at the `ipcMain` boundary (`src/shared/ipc/commands.ts:135`). The new member is **bare**: it has no `payload` field, so there is nothing to validate beyond the `type` discriminant, and `case 'interrupt': return true` is complete acceptance (identical posture to the already-shipped `requestConversations`). No field on the member could carry a token, key, or raw frame (AC5 holds by construction — the type has only `type`).
- **[Tokens, secrets, credentials]** No findings — fire-and-forget bare frame. Unlike `answerModal`, `interrupt()` mints **no** token and touches no secret. `buildInterrupt` takes no payload; nothing sensitive enters this path.
- **[File / storage operations]** N/A — no filesystem or storage operation in this slice.
- **[Inter-process / Electron attack surface]** No findings — **no new IPC channel and no new `contextBridge` API**: the member rides the existing validated `COMMAND_CHANNEL` via the generic `sendCommand`; the preload bridge is unchanged. The guard-in-lockstep requirement is fail-closed: if the developer omits `case 'interrupt'`, the member is *rejected*, not smuggled through (SHOULD-note only, not a vuln — the connection-method tests + typed switch guard against a silent-drop regression). `webPreferences` (`contextIsolation`/`nodeIntegration`/`sandbox`) are untouched by this slice.
- **[Cryptographic primitives]** No findings — no RNG, no key/nonce handling here. The envelope is encrypted downstream by the existing Noise session/driver (unchanged). The shared monotonic `nextEnvelopeId` is an application-level correlation id, **not** a Noise nonce; no `(key, nonce)` reuse concern is introduced.
- **[Network & I/O]** No findings — the frame is handed to the existing `driver.sendMessage`; no new socket, no timeout/backoff surface, no inbound parsing (there is no reply). The fixed-shape ~60-byte empty-payload envelope can never exceed `MAX_PLAINTEXT_BYTES`.
- **[Error messages, logs, telemetry]** No findings — the `catch` drops silently (no log, no event, no renderer notification), matching the sibling methods; no token/key/transcript/path can leak because none is present on this path.
- **[Concurrency]** No findings — `interrupt()` is synchronous with no `await`, single-writer on `nextEnvelopeId`. Being fire-and-forget, it records **no** outstanding-correlation entry, so there is nothing to leak or leave dangling on teardown; it adds no timer, listener, or long-lived task. Inert when `driver === null`.
- **[Threat model alignment]** No findings.
  - *Malicious/compromised relay* — content-blind and on-path: it can drop or delay the interrupt, which merely means the turn does not stop promptly. Fire-and-forget with no wait means no hang and no plaintext leak.
  - *Hostile daemon response* — N/A: no reply is parsed on this leg.
  - *Renderer compromise reaching the transport* — a compromised renderer could dispatch `interrupt` at will, causing at most extra Esc keystrokes to the daemon-supervised claude (a replayed interrupt with no running turn is a benign no-op, per #305 builder doc + daemon SSOT #707). This is *strictly less* capability than `sendMessage`, which the renderer can already dispatch; process isolation still keeps keys/token/socket out of renderer reach. Deliberate trust posture, not a finding.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-12
