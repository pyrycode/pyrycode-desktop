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
on reconnect or timer: resending could initiate another switch.

Each connection holds `pendingSwitchAgents: Map<number, string>`, mapping a sent
envelope ID to the client-supplied conversation ID. Registration happens after
the synchronous send returns, before the sent diagnostic, and only while
authentication remains live, the captured driver is still current and the
connection generation is unchanged. A send can report failure or trigger
teardown synchronously without throwing; checking only its return would restore
an abandoned request after cleanup.

A correlated daemon `error` consumes the entry before emitting one
[`switchAgentRejected`](daemon-event-channel.md#what-it-does) event with the mapped
conversation and `retryable ?? false`. Duplicate, missing or unknown correlations
emit no switch rejection. Daemon message text and any daemon-supplied conversation
ID are excluded. Any decoded `conversation_updated` clears all pending switches
for its conversation while preserving the normal update event and other
conversations' entries. Relay loss, connection failure, dial/reconnect and stop
clear the whole map, so a recovered session inherits no pending switch. See
[Switch-agent rejection correlation](daemon-connection-correlation-requests.md#switch-agent-rejection-correlation).

Diagnostics contain only static fields:

| Condition | Event and code |
|---|---|
| Unknown conversation | `conversation-route-refused` / `unknown-conversation` |
| Owner absent from registry | `conversation-route-refused` / `server-not-connected` |
| Driver absent or unauthenticated | `switch-agent-refused` / `unavailable` |
| Send returns with authentication, driver and generation intact | `switch-agent-sent` |
| Send returns after failure or session change | `switch-agent-failed` / `connection-lost` |
| Encoding or send throws | `switch-agent-failed` / `build-or-send-failed` |
| Correlated daemon refusal | `switch-agent-failed` / `server-rejected` |

Payloads, IDs, settings and exception text never enter these records.
`switch-agent-sent` records local dispatch, not daemon acceptance. Success uses the
existing inbound `resetting`, `session_transition` with reason `clear`, and
`conversation_updated` handling. Refusal correlation through `in_reply_to` shipped
in [#1660](../../specs/architecture/1660-switch-agent-rejection.md).
The four exhaustive renderer translators, `translateDaemonEvent`,
`translateModalEvent`, `translateQuestionEvent` and `translateTimelineEvent`,
explicitly return `null` for `switchAgentRejected`. Adding a union member requires
these no-op arms even before it has a consumer. Menu sending, confirmation,
rollback and notification belong to
[#1661](https://github.com/pyrycode/pyrycode-desktop/issues/1661).

## Testing

- `switchAgentEnvelope.test.ts` compares actual encoded JSON bytes and decoded
  envelopes, covering both agents, verbatim settings, empty model, omitted,
  undefined and empty effort, and extra-key stripping.
- `commands.test.ts` covers structural acceptance and rejection, including null
  effort and absent payloads. `daemonConnection.test.ts` covers unavailable owners,
  lifecycle drops, shared ID/time, oversize encoding, throwing sends, no retries
  and exact content-free diagnostic records.
- Rejection tests send real encoded error frames through the fake driver and IPC
  sink: both retryability booleans, false defaults, exact client-attributed events,
  duplicates and unrelated errors, per-conversation update cleanup and session
  teardown. A send that reports teardown and returns normally is covered
  separately from a throwing send, including rejection after recovery. Each of
  the four renderer translator specs asserts the event maps to `null`.
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
