# Switch-agent outbound request

The desktop can send a v2 `switch_agent` request for one conversation through the
existing [command channel](command-channel.md). The outbound path shipped in
[#1659](../../specs/architecture/1659-switch-agent-request.md). It adds no UI trigger.
The daemon requires `interactive` and `multi_agent`, both advertised by this client.
The contract reference is the daemon's
[switch_agent protocol](https://github.com/pyrycode/pyrycode/blob/77818fd23e1c18657663e066318eb1c03870ae77/docs/protocol-mobile.md#switch_agent).

## Command and wire payload

`RendererCommand` includes `{ type: 'switchAgent'; payload: SwitchAgentPayload }`.
`SwitchAgentPayload` in `src/shared/wire/types.ts` carries:

| Field | Admission and wire behavior |
|---|---|
| `conversation_id` | Required nonempty string; used verbatim for owner lookup and the payload. |
| `agent` | Required `claude` or `codex`. |
| `model` | Required string, including `""` for the target agent's template default. |
| `effort` | Optional string; absent or `undefined` omits the wire key; explicit `""` clears effort and remains present. |

`isRendererCommand` requires a non-null, non-array object payload. Missing or
mistyped required fields, an unsupported agent, an empty conversation ID, and
non-string effort (including null) reject the whole command. Extra keys pass
structural admission but are discarded during encoding. UUID validity, model/effort
vocabulary and same-agent refusal remain daemon validation. The daemon decoder's
tolerance of null effort does not widen the renderer contract.

The main-only `buildSwitchAgent({ id, ts, payload })` in
`src/main/transport/switchAgentEnvelope.ts` returns encoded `Uint8Array` bytes.
It constructs a fresh `{ conversation_id, agent, model }` literal and adds effort
only when `effort !== undefined`. The envelope contains exactly `id`, `type`, `ts`
and `payload`, with `type: 'switch_agent'`. Strings retain whitespace and empty values;
neither trimming nor truthiness checks preserve this contract. Spreading the
renderer payload would let extra fields reach the daemon.

## Owning connection and failures

The main command receiver calls
`router.route(payload.conversation_id)?.switchAgent(payload)`. The router resolves
the owner from its main-owned conversation Map. A renderer host hint has no routing
authority. Unknown conversations or owners missing from the registry send nothing
to any server; there is no first-host or most-recent-host fallback.

The [registry](daemon-connection-registry.md#the-stable-stand-in)'s `viewOf` delegates
`switchAgent` unchanged to the selected connection. Extending the raw connection
alone would leave the routed command unavailable on its restricted view.
`DaemonConnection.switchAgent` requires both a driver and `authenticated`: driver
presence alone includes a pre-handshake or relay-down connection. Before start,
before authentication, after relay loss, terminal/error failure or stop, the
request is dropped.

An available connection builds synchronously using its shared `nextEnvelopeId`
and `now()`, advances the counter after successful encoding, then calls
`driver.sendMessage` once. Oversize encoding and throwing sends are contained by
`catch`; the caught object is discarded. An encoding failure consumes no ID;
a send failure occurs after the ID has advanced. There is no retry, queued replay
on reconnect, pending request map or timer: resending could initiate another switch.

Diagnostics contain only static fields:

| Condition | Event and code |
|---|---|
| Unknown conversation | `conversation-route-refused` / `unknown-conversation` |
| Owner absent from registry | `conversation-route-refused` / `server-not-connected` |
| Driver absent or unauthenticated | `switch-agent-refused` / `unavailable` |
| Send returns | `switch-agent-sent` |
| Encoding or send throws | `switch-agent-failed` / `build-or-send-failed` |

Payloads, IDs, settings and exception text never enter these records.
`switch-agent-sent` records local dispatch, not daemon acceptance. Success uses the
existing inbound `resetting`, `session_transition` with reason `clear`, and
`conversation_updated` handling. Refusal correlation through `in_reply_to` belongs
to [#1660](https://github.com/pyrycode/pyrycode-desktop/issues/1660); the menu sender
and confirmation belong to [#1661](https://github.com/pyrycode/pyrycode-desktop/issues/1661).

## Testing

- `switchAgentEnvelope.test.ts` compares actual encoded JSON bytes and decoded
  envelopes, covering both agents, verbatim settings, empty model, omitted,
  undefined and empty effort, and extra-key stripping.
- `commands.test.ts` covers structural acceptance and rejection, including null
  effort and absent payloads. `daemonConnection.test.ts` covers unavailable owners,
  lifecycle drops, shared ID/time, oversize encoding, throwing sends, no retries
  and exact content-free diagnostic records.
- `connectionRegistry.test.ts` proves the named connection view forwards the same
  payload object while the other host remains untouched.
- [The fake-daemon spec](../../../e2e/switch-agent-command.spec.ts) sends through
  `window.pyry.sendCommand` using `launchPairedApp` with two hosts. It checks decoded
  frames only on each conversation's owner for both agents and all settings variants,
  with extra fields and a misleading host hint. Unknown-ID and null-effort commands
  precede a valid command used as a processing barrier: an immediate empty-log
  assertion could pass before IPC was handled. Five valid commands yield five frames.

Recorded evidence at `4ca8d044b8a799c0634e576051ac8ccbc2c0efc2` on 2026-10-06:
the configured `npx playwright test --reporter=json` gate executed 310 tests,
310 passed, 0 failed and 4 skipped. The
[verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1827#issuecomment-6026790611)
explicitly confirms `switch-agent-command.spec.ts` executed once and passed without
retry or skip. The dispatcher's named `switch_agent` lookup reports "not run";
that spelling differs from the spec's `switchAgent reaches only the conversation
owner with exact settings` title. The named execution evidence comes from the
verdict, not the suite total. The same verdict records 9,019 unit tests executed
and passed, 0 failed and 3 skipped; it does not enumerate individual unit results.
Live daemon/Claude switching was not exercised in this outbound slice.
