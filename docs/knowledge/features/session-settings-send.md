# Session settings send (model / effort / YOLO write, outbound half)

The **outbound send half** of a per-session model / reasoning-effort / YOLO change: a validated
`setSessionSettings` command reaching `onCommand` becomes an encrypted `set_session_settings`
envelope on the live Noise session, asking the daemon to mutate one session's run configuration
(pyrycode/pyrycode#844 wire vocab, #845 handler). Introduced in [#263](../codebase/263.md), the write-side
counterpart to the read-only [screen snapshot fetch](screen-snapshot-fetch.md) (#180) — same `send`-twin
shape, opposite direction.

Ships **dormant**: no renderer surface dispatches this command yet. Its caller is the interactive
Run-configuration controls ([#257](https://github.com/pyrycode/pyrycode-desktop/issues/257)), exactly as
[#236](modal-resolution-envelope.md)'s `answerModal` shipped ahead of its render consumer. This ticket
does **not** decode the `session_settings_updated` reply (the sibling decode-arm slice,
[#264](https://github.com/pyrycode/pyrycode-desktop/issues/264), blocked by this ticket via file overlap
on `daemonConnection.ts` and the wire `EnvelopeType` union), correlate reply↔request
([#261](https://github.com/pyrycode/pyrycode-desktop/issues/261)), or build the store/controls
([#256](https://github.com/pyrycode/pyrycode-desktop/issues/256)/#257).

## The omitempty presence contract — the crux of this slice

The daemon's `SetSessionSettingsPayload{SessionID string; Model, Effort *string; YOLO *bool}` uses Go's
`,omitempty` on three pointer fields: a **nil pointer omits the key**; a **non-nil pointer to a zero
value marshals the key at its zero value**. So on the wire:

- an **absent** key means "leave this field unchanged"
- a key **present at its zero value** (`''` / `false`) means "set this field to its zero value" (an
  empty-string clear, or permissions-enforced)
- this distinction is an absent key vs. a present key — **never** a literal `null`

TS has no `omitempty`. The wire type (`src/shared/wire/types.ts`) merely *permits* absence via `?:`; the
**builder** (`src/main/transport/setSessionSettingsEnvelope.ts`) *enforces* the contract by assigning
each optional key to a fresh literal **iff `!== undefined`** — never a truthiness test, which would
wrongly drop `''`/`false`:

```ts
const wire: SetSessionSettingsPayload = { session_id: payload.session_id }
if (payload.model !== undefined) wire.model = payload.model
if (payload.effort !== undefined) wire.effort = payload.effort
if (payload.yolo !== undefined) wire.yolo = payload.yolo
```

This conditional-key literal — naming exactly the four modeled keys, never a spread of `payload` —
**doubles as the anti-smuggling net**: any extra field a compromised renderer smuggled past the
structural-minimum command guard is dropped here, never reaching the wire.

## The four pieces

| Piece | File | Role |
|---|---|---|
| `SetSessionSettingsPayload` + `'set_session_settings'` `EnvelopeType` member | `src/shared/wire/types.ts` | ported wire type, field-for-field with the daemon |
| `buildSetSessionSettings` | `src/main/transport/setSessionSettingsEnvelope.ts` (new) | pure builder — **owns the presence contract** |
| `setSessionSettings(payload)` | `src/main/daemonConnection.ts` | connection method — a faithful `requestSnapshot` twin |
| `setSessionSettings` command / `isSetSessionSettingsPayload` guard | `src/shared/ipc/commands.ts` | the sealed union member + untrusted-boundary guard |

### 1. Wire type (`src/shared/wire/types.ts`)

```ts
export interface SetSessionSettingsPayload {
  session_id: string
  model?: string   // *string omitempty — absent = leave unchanged; '' = clear to daemon default
  effort?: string  // *string omitempty — absent = leave unchanged; '' = clear
  yolo?: boolean    // *bool  omitempty — absent = leave unchanged; false = permissions enforced
}
```

`'set_session_settings'` joins `EnvelopeType` in the outbound group beside `'request_snapshot'`. Adding
an outbound member is safe: `Envelope.type` is `EnvelopeType | string` (permissive), no `assertNever`
exhausts `EnvelopeType`, and the inbound decode switch (`inboundMessage.ts`) defaults an unmodeled type to
`null` — no exhaustiveness cascade.

### 2. The builder (`setSessionSettingsEnvelope.ts`, new, main-only)

```ts
export interface SetSessionSettingsInput { id: number; ts: string; payload: SetSessionSettingsPayload }
export function buildSetSessionSettings(input: SetSessionSettingsInput): Uint8Array
// Envelope { id, type: 'set_session_settings', ts, payload: <conditionally-keyed literal> }
//   → encodeEnvelope() UTF-8 bytes.
```

A sibling to `requestSnapshotEnvelope.ts` / `createConversationEnvelope.ts` — same one-concern-per-file
split — but **more than a mechanical clone**: it is the one place in this slice beyond a `requestSnapshot`
copy, because the presence contract (§ above) lives here rather than in the connection method. This is a
deliberate divergence from `createConversation`/`answerModal` (which build their fresh anti-smuggling
literal in the *connection method* and keep a dumb wrapper builder) — here the conditional-key
construction *is* the presence contract, and the golden test targets the builder (AC2), so both concerns
co-locate to stay DRY. **MAIN-PROCESS ONLY** — imports `codec.ts` (Node `Buffer`); never re-exported
through a renderer barrel. MAY throw `WireEncodeError` over `MAX_PLAINTEXT_BYTES`; the sole caller
(`daemonConnection.setSessionSettings`) catches it.

### 3. The connection method (`daemonConnection.ts`)

```ts
function setSessionSettings(payload: SetSessionSettingsPayload): void {
  if (driver === null) return              // inert no-op — a settings change has no consumer to fail
  try {
    const bytes = buildSetSessionSettings({ id: nextEnvelopeId, ts: now(), payload })
    nextEnvelopeId += 1                     // shares the one counter with send/requestSnapshot/...
    driver.sendMessage(bytes)
  } catch {
    // Never throw out of the module (parity #490). Dropped, no log, no event.
  }
}
```

A **faithful `requestSnapshot` twin** — unlike the builder, this method holds no novel logic. It passes
`payload` straight through (the builder owns the fresh literal + presence contract), shares the single
module-local `nextEnvelopeId` counter (no second counter — ids stay unique across interleaved
`send`/`requestSnapshot`/`setSessionSettings` calls; the daemon correlates replies by id, not sequence),
and never throws (parity mobile #490).

**No empty-`session_id` guard** (Evidence-Based Fix Selection): an empty/unknown id is the daemon's
`session.not_found` to reject, mirroring how `requestSnapshot` leaves an empty `conversation_id` to
`conversation.not_found`. The ticket's parent AC posited a `requestSnapshot` empty-id guard that does not
exist in the code — this slice does not add a speculative one either.

### 4. The command + guard (`commands.ts`)

```ts
// RendererCommand
| { type: 'setSessionSettings'; payload: SetSessionSettingsPayload }

function isSetSessionSettingsPayload(value: unknown): value is SetSessionSettingsPayload {
  if (typeof value !== 'object' || value === null) return false
  if (!('session_id' in value) || typeof value.session_id !== 'string') return false
  if ('model' in value && typeof value.model !== 'string') return false
  if ('effort' in value && typeof value.effort !== 'string') return false
  if ('yolo' in value && typeof value.yolo !== 'boolean') return false
  return true
}
```

Reuses the wire `SetSessionSettingsPayload` verbatim as the command payload — no member can carry a
token/key/raw frame. `isSetSessionSettingsPayload` validates **shape**, not the presence contract: an
**absent** optional is accepted (`session_id`-only is valid), a **present** optional must be correctly
typed, structural minimum (an extra field is accepted here — the builder's fresh literal bounds the wire
regardless). This is the guard the [command channel](command-channel.md)'s lockstep discipline requires —
the union member, the `isRendererCommand` switch case, and this guard land together, or the member is
silently dropped at the boundary.

**No renderer-side constructor this slice** — mirrors `requestSnapshot`/`createConversation` (neither has
one); #257 constructs the command inline.

### Main dispatch (`src/main/index.ts`)

```ts
case 'setSessionSettings':
  connection.setSessionSettings(command.payload)
  return
```

Direct to the connection method, mirroring `case 'requestSnapshot'` — no orchestrator, since a settings
change has no download-progress state to coordinate.

## Data flow

```
window → sendCommand({type:'setSessionSettings', payload:{session_id, model?, effort?, yolo?}})
      → COMMAND_CHANNEL → onCommand (isRendererCommand → isSetSessionSettingsPayload guard)
      → connection.setSessionSettings(payload)
      → buildSetSessionSettings (presence contract + fresh literal) → driver.sendMessage
        [inert no-op if not connected]

(reply — NOT this ticket)
daemon → session_settings_updated frame → decoded by #264 → correlated by #261
```

## Error handling

| Failure | Layer | Behaviour |
|---|---|---|
| Renderer sends malformed `setSessionSettings` | `isRendererCommand`/`isSetSessionSettingsPayload` | dropped at the boundary |
| Not connected when `setSessionSettings` called | `daemonConnection` | inert no-op; no throw, no event |
| Over-cap / driver throw on send | try/catch in the connection method | caught, dropped — no log, no event (the caught object could echo the payload) |
| Empty/unknown `session_id` | daemon | `session.not_found` — no client-side guard, by design (Evidence-Based Fix Selection) |

No UI surfaces this slice (dormant, no renderer dispatch site). The daemon's `session.not_found` /
`session_settings_updated` reply handling is [#264](https://github.com/pyrycode/pyrycode-desktop/issues/264)/[#261](https://github.com/pyrycode/pyrycode-desktop/issues/261).

## Security properties

Ticket carries `security-sensitive`; architect self-review verdict **PASS** (no findings), code review
**PASS** (no findings). Summary:

- **No token/key/raw-frame member possible.** The command payload reuses the wire type verbatim (AC3);
  `session_id` is a routing/correlation id (same class as `conversation_id`), not a credential.
- **Main-only builder.** `setSessionSettingsEnvelope.ts` imports `codec.ts`/`Buffer` and is never
  re-exported through a renderer barrel — raw bytes stay out of the web layer.
- **Bounded wire shape.** The builder's fresh, conditionally-keyed literal — not the command guard —
  is the deterministic net that bounds the outbound wire to exactly `{session_id, model?, effort?,
  yolo?}`, regardless of what the structural-minimum guard admitted.
- **Log-free; classify-don't-forward.** The method's `catch {}` drops the caught object with no log,
  no event — it could echo `model`/`effort`/`session_id`.
- **No new IPC surface, no new crypto, no new RNG** (unlike `answerModal`, this command mints no token).
  `nextEnvelopeId` is a monotonic application id, not a Noise nonce.
- **Threat model.** A compromised renderer can request a settings change only for a `session_id` it
  already knows — the command's legitimate capability, gated daemon-side on the negotiated `interactive`
  capability and rejected `session.not_found` for an unknown id. Defensively parsing the daemon's reply
  (hostile-daemon-response defense) is out of scope here — see #264.

## Related

- [#263 codebase notes](../codebase/263.md) — implementation summary, patterns, lessons.
- [Screen snapshot fetch](screen-snapshot-fetch.md) / [#180](../codebase/180.md) — the read-only
  counterpart this slice mirrors structurally (`send`-twin connection method, payload-carrying builder);
  together they bracket the [Run configuration store](run-config-store.md)'s eventual read/write pair.
- [Daemon connection](daemon-connection.md) / [#62](../codebase/62.md) — hosts `setSessionSettings`
  alongside `send`/`requestSnapshot`/`createConversation`, sharing the one monotonic `nextEnvelopeId`.
- [Command channel](command-channel.md) / [#17](../codebase/17.md) — the `setSessionSettings`
  `RendererCommand` member + `isSetSessionSettingsPayload` guard this channel's union gained (its eighth
  member).
- [Modal resolution envelope](modal-resolution-envelope.md) / [#235](../codebase/235.md)–[#236](../codebase/236.md) —
  the structural precedent for shipping a command-surface + connection-method pair dormant, ahead of its
  render consumer.
- [Session-id store](session-id-store.md) / [#259](../codebase/259.md) — the renderer-side holder of the
  `session_id` this command's payload will address, once #257 wires the two together.
- [Run configuration store](run-config-store.md) / [#187](../codebase/187.md) — the read half this
  write path is the eventual write-side twin of; #256/#257 join them.
