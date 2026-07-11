# Session settings send (model / effort / YOLO write, outbound half)

The **outbound send half** of a per-session model / reasoning-effort / YOLO change: a validated
`setSessionSettings` command reaching `onCommand` becomes an encrypted `set_session_settings`
envelope on the live Noise session, asking the daemon to mutate one session's run configuration
(pyrycode/pyrycode#844 wire vocab, #845 handler). Introduced in [#263](../codebase/263.md), the write-side
counterpart to the read-only [screen snapshot fetch](screen-snapshot-fetch.md) (#180) — same `send`-twin
shape, opposite direction.

Shipped **dormant** and has since gained its live dispatch site. Its caller is the interactive
Run-configuration controls ([#257](../codebase/257.md), shipped PR #283), exactly as
[#236](modal-resolution-envelope.md)'s `answerModal` shipped ahead of its render consumer. The sibling
decode-arm slice, [#264](../codebase/264.md), decodes the reply into a `sessionSettingsUpdated`
`DaemonEvent`; the confirmed-round-trip correlation is [#261](../codebase/261.md) (below), and the
**rejected**-round-trip correlation is [#269](../codebase/269.md) (below). The pending-write **store**,
[#256](../codebase/256.md) (below), and the interactive **controls**, [#257](../codebase/257.md), have
both since shipped — #183's whole interactive Run-configuration write path is now complete end to end.

## Consumption (#256) — the pending-write store

[#256](../codebase/256.md) is the store consumer both correlation events were shipped dormant for: the
[Run configuration write store](run-settings-write-store.md), an adjacent Zustand store holding pending
changes keyed by the renderer-minted `changeId`, sparse client-confirmed overrides, and the last-rejected
field. Its `runSettingsWriteBridge.ts` mints the `changeId` and sends the `setSessionSettings` command
(`submitSettingsChange`), and its App-level `RunSettingsWriteData` leaf folds
`sessionSettingsUpdated`/`sessionSettingsRejected` back into the store — the fourth independent
subscriber on the daemon-event channel, alongside the three bridges this section describes. See that
doc for the reducer/derivation detail; still dormant until #257 dispatches into it.

## Correlation (#261) — the confirmed round-trip

`session_settings_updated` carries only `session_id`, so it cannot say *which* pending change it
confirms. [#261](../codebase/261.md) closes that gap with a **client-internal correlation key** that
never touches the wire:

1. The renderer mints a `changeId` (opaque, client-internal) and passes it as a **top-level sibling of
   `payload`** on the `setSessionSettings` command — never nested inside `payload`, so the builder (which
   consumes only `payload`) structurally cannot put it on the wire.
2. `daemonConnection`'s `setSessionSettings` captures the request's `nextEnvelopeId`-minted envelope id
   **before** building, sends, and — only on a successful send — records `pendingSettings.set(envelopeId,
   changeId)` in a module-local `Map<number, string>` (sited beside `outstandingAnswers`, same
   single-writer, push-after-send discipline).
3. `parseInboundMessage` propagates the **already-decoded** `Envelope.in_reply_to` (codec.ts's
   `decodeEnvelope` always decoded it; this is the first consumer) onto the `session-settings-updated`
   kind as `inReplyTo?: number`.
4. `daemonConnection`'s inbound switch is now **correlation-gated and fail-closed**: an absent
   `inReplyTo`, or one matching no entry in `pendingSettings` (a stale reply, or a hostile daemon forging
   a confirmation for an id the client never sent), is silently ignored — no event. A match deletes the
   entry and emits a fresh literal `{ type: 'sessionSettingsUpdated', sessionId, changeId }` — the
   numeric `in_reply_to` never crosses to the renderer, only the renderer's own `changeId` does.
5. `dial()` clears `pendingSettings` — a reconnect abandons every outstanding change, so a stale reply
   can never correlate on the reconnected session (this is what makes `nextEnvelopeId`'s restart-at-2
   recycling safe).

This is the **match-key mechanism**: mint client-side, remember main-process-side, correlate by
`in_reply_to`, never echo the wire routing id back. It's necessary because the command is fire-and-forget
— the renderer never learns the minted envelope id, so a main-minted-then-echoed id couldn't tell two
same-`session_id` changes apart.

## Rejection ([#269](../codebase/269.md)) — the failed round-trip

A rejected `set_session_settings` doesn't reply with `session_settings_updated` — the daemon rejects it
with a content-free `error` frame (#116), carrying `Envelope.in_reply_to = request.id` and one of
`session.not_found` / `protocol.malformed` / `server.binary_offline` (never surfaced past the decode
boundary). [#269](../codebase/269.md) reuses the **exact same** `pendingSettings` map + `changeId` key
#261 built, keyed off the `daemon-error` kind instead of `session-settings-updated`:

1. `parseInboundMessage`'s `daemon-error` kind widens with the optional numeric `inReplyTo` — the same
   already-decoded `Envelope.in_reply_to` propagation #261 used for `session-settings-updated`. No
   `ErrorPayload` field is ever parsed; the widen carries **only** the routing id.
2. `daemonConnection`'s `case 'daemon-error':` gates on this **first**, ahead of its two pre-existing
   consumers: `pendingSettings.get(inReplyTo)` — a hit `delete`s the entry and emits `{ type:
   'sessionSettingsRejected', changeId }`, then **returns**, consuming the frame entirely.
3. On a match, **both** existing `daemon-error` consumers are skipped — the [#116](../codebase/116.md)
   bundle reassembler's `fail('daemon-error')` and the [#248](../codebase/248.md) modal-answer FIFO's
   `outstandingAnswers.shift()`. An error correlated by a unique per-request envelope id is unambiguously
   the reply to *that* request, so it is provably neither a bundle error nor a modal-answer rejection —
   failing a healthy in-flight bundle, or misattributing an unrelated modal rejection, on a settings error
   would be a bug, not a documented tradeoff.
4. On **no** match (absent `inReplyTo`, a stale id, or a hostile daemon forging a rejection for a change
   the client never dispatched), the frame falls through to the two existing consumers **exactly**
   unchanged — a bundle in flight still fails, an outstanding modal answer is still rejected.

This is also the ticket that **closes the orphan** #261 left open: under the confirmed-only slice, a
rejected change's `pendingSettings` entry survived until the next `dial()`. Now the `error` path's own
`delete` removes it the moment the rejection is observed — `dial()`'s `pendingSettings.clear()` remains
only the backstop for a reply that never arrives before a reconnect.

The emitted `sessionSettingsRejected{changeId}` event carries **no** `sessionId` (the wire `error` frame
has none — `changeId` alone disambiguates two outstanding changes to the same session), **no**
`in_reply_to` (stays main-internal), and **no** error code or message (attacker-influenceable bytes that
no consumer needs). `security-sensitive`, code review **PASS**, no findings.

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
function setSessionSettings(payload: SetSessionSettingsPayload, changeId: string): void {
  if (driver === null) return              // inert no-op — a settings change has no consumer to fail
  const envelopeId = nextEnvelopeId         // captured before build — the id the reply's in_reply_to echoes
  try {
    const bytes = buildSetSessionSettings({ id: nextEnvelopeId, ts: now(), payload })
    nextEnvelopeId += 1                     // shares the one counter with send/requestSnapshot/...
    driver.sendMessage(bytes)
    pendingSettings.set(envelopeId, changeId) // #261 — recorded only after a successful send
  } catch {
    // Never throw out of the module (parity #490). Dropped, no log, no event.
  }
}
```

A **faithful `requestSnapshot` twin** for the send mechanics — unlike the builder, this method holds no
novel encode logic. It passes `payload` straight through (the builder owns the fresh literal + presence
contract), shares the single module-local `nextEnvelopeId` counter (no second counter — ids stay unique
across interleaved `send`/`requestSnapshot`/`setSessionSettings` calls; the daemon correlates replies by
id, not sequence), and never throws (parity mobile #490). [#261](../codebase/261.md) added the
`changeId` param and the `pendingSettings` bookkeeping (see § Correlation above); `changeId` is **never**
passed to the builder, so it stays off the wire.

**No empty-`session_id` guard** (Evidence-Based Fix Selection): an empty/unknown id is the daemon's
`session.not_found` to reject, mirroring how `requestSnapshot` leaves an empty `conversation_id` to
`conversation.not_found`. The ticket's parent AC posited a `requestSnapshot` empty-id guard that does not
exist in the code — this slice does not add a speculative one either.

### 4. The command + guard (`commands.ts`)

```ts
// RendererCommand
| { type: 'setSessionSettings'; payload: SetSessionSettingsPayload; changeId: string }

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
  connection.setSessionSettings(command.payload, command.changeId)
  return
```

Direct to the connection method, mirroring `case 'requestSnapshot'` — no orchestrator, since a settings
change has no download-progress state to coordinate.

## Data flow

```
window → sendCommand({type:'setSessionSettings', payload:{session_id, model?, effort?, yolo?}, changeId})
      → COMMAND_CHANNEL → onCommand (isRendererCommand → isSetSessionSettingsPayload + changeId guard)
      → connection.setSessionSettings(payload, changeId)
      → buildSetSessionSettings (presence contract + fresh literal) → driver.sendMessage
        → pendingSettings.set(envelopeId, changeId)   [inert no-op if not connected, no map entry]

daemon → session_settings_updated frame → decoded by #264 (carries in_reply_to)
      → daemonConnection matches in_reply_to against pendingSettings (#261)
      → match: DaemonEvent{ type: 'sessionSettingsUpdated', sessionId, changeId }
      → RunSettingsWriteData (#256) → translateWriteEvent → dispatch({settingsConfirmed, changeId})
      → no match (unmatched / absent in_reply_to): ignored, no event (AC3, fail-closed)

window → #257 (RunConfigSections) → changeSetting (AC5 session-id gate) → the sendCommand call above
```

## Error handling

| Failure | Layer | Behaviour |
|---|---|---|
| Renderer sends malformed `setSessionSettings` (incl. missing/non-string `changeId`) | `isRendererCommand`/`isSetSessionSettingsPayload` | dropped at the boundary |
| Not connected when `setSessionSettings` called | `daemonConnection` | inert no-op; no throw, no event, no pending-map entry |
| Over-cap / driver throw on send | try/catch in the connection method | caught, dropped — no log, no event, no pending-map entry (recorded only after a successful send, #261) |
| Empty/unknown `session_id` | daemon | `session.not_found` — no client-side guard, by design (Evidence-Based Fix Selection) |
| Reply's `in_reply_to` absent or matches no pending entry | `daemonConnection` (#261) | ignored — no event, fail-closed (AC3); covers a hostile daemon forging a confirmation for an id the client never sent |
| Reply confirms a change whose entry was abandoned by a `dial()` reset | `daemonConnection` (#261) | ignored — no event (AC5) |
| Daemon rejects the change (`error` frame, `in_reply_to` matches a pending entry) | `daemonConnection` (#269) | correlated, entry deleted, `{ type: 'sessionSettingsRejected', changeId }` emitted; the #116 reassembler and #248 modal FIFO are both skipped on this match |
| `error` frame whose `in_reply_to` is absent or matches no pending entry | `daemonConnection` (#269) | falls through unchanged to the pre-existing `daemon-error` consumers (bundle reassembler / modal FIFO) |

This slice's UI surface is [#257](../codebase/257.md)'s interactive Model/Effort/YOLO controls. Both the
confirmed ([#261](../codebase/261.md)) and rejected ([#269](../codebase/269.md)) correlation halves
shipped, then the pending→confirm/reject [store](run-settings-write-store.md) consuming both events
([#256](../codebase/256.md)), then the controls dispatching into it ([#257](../codebase/257.md)) — the
whole chain from #183 is now merged end to end.

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
  capability and rejected `session.not_found` for an unknown id.
- **(#261) The renderer-minted `changeId` and the fail-closed correlation lookup are what defend against
  a hostile daemon forging a confirmation.** A forged `in_reply_to` for an id the client never dispatched
  finds no `pendingSettings` entry and is silently dropped — the daemon cannot fabricate a confirmed
  change the client didn't request. The numeric `in_reply_to` itself never crosses to the renderer (only
  `changeId` does), and `changeId` is client-minted, non-secret, never used for authz. Ticket #261 carries
  `security-sensitive`; architect self-review + code review both **PASS** (no findings).
- **(#269) The `daemon-error` widen carries only the numeric routing id, never `ErrorPayload` content.**
  No `code`/`message`/payload byte is ever parsed in the `error` decode case — the same minimisation
  discipline #261 applied to `session-settings-updated`. The emitted `sessionSettingsRejected` event
  carries only the client's own `changeId`, never a field read from the untrusted error payload; a forged
  or stale `in_reply_to` finds no `pendingSettings` entry and is silently dropped, identical to #261's
  defense. Ticket #269 carries `security-sensitive`; code review **PASS** (no findings).

## Related

- [#261 codebase notes](../codebase/261.md) — the confirmed-round-trip correlation slice: implementation
  summary, the match-key pattern, lessons.
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
  `session_id` this command's payload addresses, wired together by [#257](../codebase/257.md).
- [Run configuration store](run-config-store.md) / [#187](../codebase/187.md) — the read half this
  write path is the write-side twin of; [#256](../codebase/256.md)/[#257](../codebase/257.md) join them.
- [#257 codebase notes](../codebase/257.md) — the interactive controls: the render-side dispatch site
  this command shipped ahead of.
- [#264 codebase notes](../codebase/264.md) — the decode arm for this ticket's `session_settings_updated`
  reply: wire type, fail-closed parse, and the `sessionSettingsUpdated` `DaemonEvent` arm #261 widened;
  consumed by [#256](../codebase/256.md)'s [write store](run-settings-write-store.md), still a no-op in
  the three session/timeline/modal bridges.
- [#269 codebase notes](../codebase/269.md) — the rejected-path sibling: widens `daemon-error` with
  `inReplyTo?: number`, correlates it against the same `pendingSettings` map + `changeId` key, and
  introduces `sessionSettingsRejected` (see § Rejection above). Also the ticket that closes the
  `pendingSettings` orphan #261 left open for a rejected change.
- [Run configuration write store](run-settings-write-store.md) / [#256 codebase notes](../codebase/256.md)
  — the pending-write store consuming both `sessionSettingsUpdated` and `sessionSettingsRejected`; see
  § Consumption above.
