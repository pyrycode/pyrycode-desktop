# Spec #263 — send `set_session_settings` with the omitempty presence contract

**Ticket:** [#263](https://github.com/pyrycode/pyrycode-desktop/issues/263) · size **S** · `security-sensitive`
**Shape:** faithful outbound-send-path twin of #180 (`requestSnapshot`) + #236 (`answerModal` command lockstep). Ships **dormant** — caller is the interactive Run-config controls (#257).

## Files to read first

- `src/main/transport/requestSnapshotEnvelope.ts` (44 lines) — the builder template this mirrors: `Input` interface + pure `build*` that wraps a payload in an `Envelope` and `encodeEnvelope`s it. **Main-only** (imports `codec.ts`/`Buffer`), never re-exported through a renderer barrel.
- `src/main/transport/requestSnapshotEnvelope.test.ts` — the golden round-trip test shape (decode-and-assert id/ts/type/payload + over-cap `WireEncodeError`). Your builder test extends this with the present-zero-vs-omitted matrix.
- `src/main/transport/createConversationEnvelope.ts` — the closest presence-adjacent sibling; its header comment explains how `JSON.stringify` treats `null` (preserved) vs `undefined` (dropped). **Contrast:** create_conversation carries always-present nullable fields; this slice carries omitempty-optional fields. The presence logic differs (see § Builder).
- `src/shared/ipc/commands.ts:61-189` — the `RendererCommand` union, `isRendererCommand` switch, and the per-payload guards (`isRequestSnapshotPayload`, `isCreateConversationPayload`). Add one union member, one switch case, one guard in lockstep. `isCreateConversationPayload` (lines 179-189) is the per-field-type-check pattern to mirror — but for **optional-absent** rather than **nullable-present** fields.
- `src/shared/wire/types.ts:40-67` (`EnvelopeType` union) and `:117-157` (`SendMessagePayload`, `RequestSnapshotPayload`, `ScreenSnapshotPayload`) — where the new type + union member land, and the field-naming/doc-comment convention.
- `src/main/daemonConnection.ts:121-129` (interface doc for `requestSnapshot`), `:588-603` (the `requestSnapshot` method body — the send-twin template), `:768-772` (the returned-object wiring). Add the interface decl, the method, and the return entry.
- `src/main/index.ts:234-268` — the `onCommand` switch (no `default`); add one `case 'setSessionSettings'` mirroring `case 'requestSnapshot'` at :239.
- `src/main/transport/inboundMessage.ts:558,769` — confirms the inbound decode switch has a permissive `default: return null`, so adding an outbound `EnvelopeType` member breaks no exhaustiveness. (Decoding the reply is the sibling slice #264 — **not** this ticket.)

## Design source

N/A — pure transport send path, ships dormant (no renderer surface until #257). No `## Figma` in the ticket body; the visual-fidelity check is intentionally not applicable to this slice.

## Context

The daemon accepts a `set_session_settings` request (pyrycode #844 wire vocab + #845 handler, both on `main`) that mutates one session's model / reasoning effort / YOLO. This slice ships the **outbound send half**: wire type, presence-contract builder, renderer→main command + boundary guard, and the main-side connection method that mints + emits the frame. It does **not** decode the `session_settings_updated` reply (#264, blocked by this ticket via file overlap), correlate reply→request (#261), or build the store/controls (#256/#257).

The presence contract is the crux and the only place this slice is more than a mechanical `requestSnapshot` clone.

## Design

Five files: two new (builder + its test), three additive edits (wire types, command surface, connection wiring). See § Scope determination for why this trips the ≥5-file commit gate yet is genuinely S.

### 1. Wire type — `src/shared/wire/types.ts`

- Add `'set_session_settings'` to the `EnvelopeType` union (in the outbound group, next to `'request_snapshot'` at :50). Adding an outbound member is safe: `Envelope.type` is `EnvelopeType | string` (permissive) and no `assertNever` exhausts `EnvelopeType`; the inbound decode switch defaults unknown types to `null`.
- Add the payload interface mirroring the daemon's `SetSessionSettingsPayload{SessionID; Model, Effort *string; YOLO *bool}` field-for-field:

```ts
export interface SetSessionSettingsPayload {
  session_id: string
  model?: string   // *string omitempty — absent = leave unchanged; '' = clear to daemon default
  effort?: string  // *string omitempty — absent = leave unchanged; '' = clear
  yolo?: boolean    // *bool  omitempty — absent = leave unchanged; false = permissions enforced
}
```

- The optional `?` fields mirror the daemon's nil-pointer omission. **The presence contract is enforced by the builder, not by this type** — the type merely permits absence. Doc-comment must state: an absent key means "leave unchanged"; a key present at its zero value (`''` / `false`) means "set to this value"; on the wire this is an absent key (omitempty), never a literal `null`. Confirm field names against pyrycode #844/#845 before drifting (already CONFIRMED in prior split analysis).

### 2. Builder — `src/main/transport/setSessionSettingsEnvelope.ts` (NEW, main-only)

The one place beyond a mechanical clone. Contract:

- `export interface SetSessionSettingsInput { id: number; ts: string; payload: SetSessionSettingsPayload }` — explicit inputs (id counter, clock, validated payload), same as `RequestSnapshotInput`.
- `export function buildSetSessionSettings(input: SetSessionSettingsInput): Uint8Array` — constructs a **fresh wire payload literal**: `session_id` always assigned; each of `model` / `effort` / `yolo` assigned **iff `!== undefined`**. Wrap the result in a `set_session_settings` `Envelope` and `encodeEnvelope` it. MAY throw `WireEncodeError` when over `MAX_PLAINTEXT_BYTES` (sole caller catches).
- **The `!== undefined` test is the presence contract** and the single trap: it must be an explicit `!== undefined` check (or equivalent), **never a truthiness test** — `if (payload.model)` would wrongly drop `''`, and `if (payload.yolo)` would wrongly drop `false`, collapsing the present-zero case the daemon distinguishes.
- Do **not** spread `payload` into the literal. Name exactly the four modeled keys. This fresh, conditionally-keyed literal doubles as the deterministic anti-smuggling net (any renderer-smuggled extra field the structural-minimum guard admitted is dropped here).
- **Divergence from `createConversation`/`answerModal`, called out for code-review:** those build their fresh anti-smuggling literal in the *connection method* and keep a dumb wrapper builder. Here the presence contract (conditional key assignment) lives in the *builder* per AC2 (the golden test targets the builder), and conditional-assignment *is* the fresh-literal operation — so both co-locate in the builder to stay DRY. The connection method therefore stays a faithful `requestSnapshot` twin (passes `payload` straight through). This is deliberate, not an oversight.

### 3. Command surface — `src/shared/ipc/commands.ts`

In lockstep (or the member is silently dropped at the boundary — the module's stated rule):

- Import `SetSessionSettingsPayload` from `../wire/types`.
- Add union member `| { type: 'setSessionSettings'; payload: SetSessionSettingsPayload }` (reuse the wire type verbatim — no key/token/raw-frame field can travel on it; AC3).
- Add the `isRendererCommand` case: `case 'setSessionSettings': return 'payload' in value && isSetSessionSettingsPayload(value.payload)`.
- Add the module-internal `isSetSessionSettingsPayload` guard (mirror `isCreateConversationPayload`'s per-field checks, adapted to optional-absent): reject unless `session_id` is present-and-string; each of `model` / `effort` / `yolo`, **when present** (`in` check), must be correctly typed (`string` / `string` / `boolean`); an **absent** optional is accepted. Pure, never throws. Structural minimum — extra fields accepted here, bounded by the builder's fresh literal.
- **No renderer-side constructor** this slice — mirror `requestSnapshot`/`createConversation` (which have none); #257 constructs the command inline. Adding one is out of scope.

### 4. Connection method — `src/main/daemonConnection.ts`

A faithful `requestSnapshot` twin:

- Import `buildSetSessionSettings` from `./transport/setSessionSettingsEnvelope` and the `SetSessionSettingsPayload` type.
- Add the interface decl `setSessionSettings(payload: SetSessionSettingsPayload): void` with a send-twin doc comment (inert no-op when `driver === null`; reply arrives later as a `session_settings_updated` DaemonEvent decoded by #264 — not this ticket; NEVER throws out of the module, parity #490).
- Method body — structurally identical to `requestSnapshot` (:588-603): `if (driver === null) return`; in a `try`, `const bytes = buildSetSessionSettings({ id: nextEnvelopeId, ts: now(), payload })`, then `nextEnvelopeId += 1` (advance only on successful build), then `driver.sendMessage(bytes)`; `catch {}` drops any throw (classify-don't-forward, no log/event — the caught object could echo the payload). Shares the single monotonic `nextEnvelopeId` — no second counter.
- Pass `payload` straight to the builder (the builder owns the fresh literal + presence contract; see § 2 divergence note).
- **No empty-`session_id` guard** (AC4, Evidence-Based Fix Selection): an empty/unknown id is the daemon's `session.not_found` to reject, mirroring how `requestSnapshot` leaves an empty `conversation_id` to `conversation.not_found`. The parent AC posited a `requestSnapshot` empty-id guard that does not exist in the code — do not add a speculative one here.
- Add `setSessionSettings` to the returned object (:768-772).

### 5. Main dispatch — `src/main/index.ts`

Add one case to the `onCommand` switch (:234-268), mirroring `case 'requestSnapshot'` at :239:

```ts
case 'setSessionSettings':
  connection.setSessionSettings(command.payload)
  return
```

## State + concurrency model

- No store slices, no subscriptions, no async iterables touched. Transport-only, dormant.
- Reuses the module-local single-writer `nextEnvelopeId` counter (`send` has no `await`, so it runs to completion uninterleaved). Ids stay unique across interleaved `send` / `requestSnapshot` / `setSessionSettings` calls — the daemon correlates replies by id (correlation itself is #261).
- No teardown/cancellation surface added: the method is inert post-teardown (`driver === null` → return), same as every send twin.

## Error handling

| Layer | Failure | Behavior |
|---|---|---|
| Builder | serialized envelope > `MAX_PLAINTEXT_BYTES` | throws `WireEncodeError` (caught by the method) |
| Method | not connected (`driver === null`) | inert no-op — no frame, no throw |
| Method | any throw (over-cap `WireEncodeError`, driver/wasm) | `catch {}` drops it — no log, no event (the object could echo the payload); parity #490, never throws out of the module |
| Guard | malformed/mistyped input | returns `false`, never throws — the command is dropped at the boundary |

No UI surfacing this slice (dormant). The daemon's `session.not_found` / `session_settings_updated` reply handling is #264/#261.

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. Bullet scenarios (developer writes them in the project idiom):

**Builder — `setSessionSettingsEnvelope.test.ts`** (the golden present-zero-vs-omitted matrix — the heart of this slice):
- round-trips to a `set_session_settings` envelope carrying the exact `id`, `ts`, and payload (decode-and-assert, real codec).
- `{ session_id, yolo: false }` (model/effort omitted) → decoded payload **has** `yolo === false`; asserts **absence** of `model` and `effort` via `not.toHaveProperty` (same idiom as #235's modal-resolution builder test).
- `{ session_id, model: '' }` (effort/yolo omitted) → decoded **has** `model === ''`; asserts absence of `effort` and `yolo`.
- `{ session_id, model: 'opus', effort: 'high', yolo: true }` → all four keys present with exact values.
- `{ session_id }` (all three omitted) → decoded has only `session_id`; asserts absence of all three optionals.
- anti-smuggling: a payload carrying an extra field (cast through the type) → decoded payload has **no** extra key (proves the fresh literal names only the four modeled keys).
- over-cap `session_id` → throws `WireEncodeError`.

**Command guard — `commands.test.ts`** (extend the existing suite):
- `isSetSessionSettingsPayload` / `isRendererCommand({ type: 'setSessionSettings', payload })` **accepts**: `{ session_id }`, `{ session_id, model: '' }`, `{ session_id, yolo: false }`, all-four-fields, and a payload with an extra field (structural minimum).
- **rejects**: missing `session_id`; `session_id` non-string; `model`/`effort` present-but-non-string; `yolo` present-but-non-boolean; non-object; `null`.

**Connection method — `daemonConnection.test.ts`** (extend, mirror the `requestSnapshot` cases):
- not connected (no driver) → `setSessionSettings(...)` emits no frame (`driver.sendMessage` not called), does not throw.
- connected → emits exactly one frame that decodes to `set_session_settings` with the payload; the envelope `id` comes from the monotonic counter and increments on success; shares the counter with `send`/`requestSnapshot` (interleaved ids unique).
- a payload that forces an over-cap build → no throw, no frame (drop).

## Security review

The `security-sensitive` label gates a self-review pass, run below (§ appended) before commit. Summary of the surface: the renderer→main trust boundary is `isSetSessionSettingsPayload`; the command payload reuses the wire type so no token/key/raw-frame member exists (AC3); the builder's fresh conditionally-keyed literal is the deterministic net that bounds the wire to exactly four keys; the builder is main-only and never re-exported through a renderer barrel (raw bytes stay out of the web layer).

## Scope determination (why 5 production files is still S)

Production files touched (new + modified, excluding tests): `types.ts`, `setSessionSettingsEnvelope.ts` (new), `commands.ts`, `daemonConnection.ts`, `index.ts` = **5**, which trips the commit-time ≥5-file self-check. Recorded determination that this is a false trigger for this specific shape, not a rationalized bypass:

- **Section-1 red lines all pass cleanly:** 2 new files (< 3), ~340 total LOC (< 600), ~3 new exports (< 5), 2 additive within-file switch sites (< 10 call sites, no consumer cascade — ships dormant), 4 ACs (≤ 5), < 10 reject branches. The primary quantitative gate is not tripped.
- **Direct precedent:** #180 (`requestSnapshot`) is the identical 5-file outbound-send-path shape (wire type + builder + command + guard + connection method + `index.ts` wiring) and shipped as one `size:s` (PR #185) without hitting the turn budget. #236 (command + guard + method, PR #240) and #241 (transport slice, PR #244) are the same family, both clean.
- The 5th file (`index.ts`) is a 3-line `onCommand` case. The `types.ts` edit is a 1-line union member + one interface. Neither is a substantive-modification cascade of the kind the gate guards against (#311's read-many-call-sites case).
- The natural split seam (A: wire type + builder; B: command + method + wiring) exists and each child would compile standalone, but fragmenting a thrice-proven ~340-LOC atomic-in-practice send path into two full pipeline passes + a blocked-by chain is disproportionate to a turn-budget risk that this exact shape has never realized (Evidence-Based Fix Selection). Shipping as one S.

## Open questions

- Daemon field names (`session_id`, `model`, `effort`, `yolo`) confirmed against pyrycode #844/#845 in prior split analysis; the developer should re-confirm against `internal/protocol` before drifting the ported type (CLAUDE.md wire-contract rule).
- None blocking implementation.

## Security review

**Verdict:** PASS (no MUST FIX)

**Findings:**

- **[Trust boundaries]** No findings — single explicit boundary: `isRendererCommand` at `src/main/receiveCommand.ts:34` gates every renderer→main command before the handler runs; the new `isSetSessionSettingsPayload` case is this member's guard. Fail-safe: a missing case → silent drop at :34, never pass-through. Downstream (`daemonConnection.setSessionSettings`) only ever holds a validated `RendererCommand`.
- **[Tokens / secrets]** N/A by design — unlike `answerModal`, this command mints and carries no token. The payload reuses the wire `SetSessionSettingsPayload` (`session_id` + `model`/`effort`/`yolo` primitives); AC3's wire-type reuse structurally forbids any token/key/raw-frame member. `session_id` is a routing/correlation id (same class as `conversation_id`), not a credential.
- **[File / storage]** N/A — no filesystem operation; pure in-memory serialization handed to the existing socket.
- **[Electron attack surface]** No findings — adds one member to the **existing** `pyry:command` channel (no new `contextBridge` API, no Node primitive exposed). The argument is validated by `isSetSessionSettingsPayload` before use. The builder is main-only (imports `codec.ts`/`Buffer`), never re-exported through a renderer barrel — raw bytes stay in the main process; keys and the socket never reach the renderer.
- **[Cryptographic primitives]** N/A — no crypto added; the envelope bytes are handed to the existing Noise session for encryption. No RNG (no token minted, unlike `answerModal`). `nextEnvelopeId` is a monotonic single-writer application id, **not** a Noise nonce (per-direction nonces live in the session layer); no id / key / nonce reuse introduced.
- **[Network & I/O]** No findings — no new socket / relay-URL / TLS surface; the outbound frame reuses the existing driver/relay. Over-cap payloads are bounded: the builder throws `WireEncodeError` at `MAX_PLAINTEXT_BYTES` and the method drops it (no send, no unbounded buffer, no amplification).
- **[Error messages / logs]** No findings — the method's `catch {}` **drops** the error with no log and no event, precisely because the caught object could echo the payload (model / effort / session_id). The builder and guard never log. No renderer surfacing (dormant).
- **[Concurrency]** No findings — synchronous build+send with no `await` between the `driver === null` guard and the send, so no check-then-act race; no long-lived task, timer, `AbortController`, or listener added; inert post-teardown (`driver === null`). Reuses the single-writer envelope counter.
- **[Threat model alignment]** Hostile/compromised relay — sends one encrypted frame a content-blind on-path relay can drop/delay/reorder but not read; no hang (dormant, no waiting consumer). Renderer compromise reaching the transport — the boundary guard + main-only builder + fresh, conditionally-keyed literal bound the wire to exactly `{session_id, model?, effort?, yolo?}`: a compromised renderer cannot smuggle a key/token/raw-frame or any extra field onto the wire, and process isolation keeps it off the keys/socket. It can request settings changes for any `session_id` it already knows — the command's legitimate capability, gated daemon-side on the negotiated `interactive` capability and rejected with `session.not_found` for an unknown id. **OUT OF SCOPE:** defensively parsing the daemon's `session_settings_updated` reply (hostile-daemon-response defense) → #264; reply↔request correlation → #261.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-11
