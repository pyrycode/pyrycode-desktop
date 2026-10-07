# Switch-agent outbound request

The desktop can send a v2 `switch_agent` request for one conversation through the
existing [command channel](command-channel.md). The outbound path shipped in
[#1659](../../specs/architecture/1659-switch-agent-request.md). It adds no UI trigger.
The [confirmation API](#renderer-confirmation-and-read-surface) and retained progress
shipped in [#1661](../../specs/architecture/1661-agent-switch-confirmation.md).
Both model-menu entry points, optimistic model display/rollback and live hand-over
acceptance remain [#1662](https://github.com/pyrycode/pyrycode-desktop/issues/1662)'s scope.
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
these no-op arms; `AgentSwitchData` separately consumes the typed outcome for the
renderer confirmation/status path below. Model-menu opening and optimistic model
display/rollback remain #1662's scope.

## Renderer confirmation and read surface

`src/renderer/src/store/agentSwitchStore.ts` exports
`openAgentSwitch(conversationId: string, row: WireModelOption): void`. Opening requires
a uniquely resolved, connected owning host, an actual conversation row, the active
conversation and its mounted pane, and a picked agent different from the outgoing
binding. An absent picked-row agent means Claude. Opening for an already-pending
conversation does nothing; a valid new opening clears that conversation's old refusal.

`agentSwitchStore` is the singleton read surface. Its `statuses: ReadonlyMap<string,
AgentSwitchStatus>` is keyed by conversation ID. A `pending` entry retains
`conversationId`, client-resolved `serverId`, `outgoing`, `target` and the copied picked
`row`; a `refused` entry retains only `serverId` and `retryable`. Read through Zustand
`useStore(agentSwitchStore, selector)` in a mounted consumer, or
`agentSwitchStore.getState().statuses.get(conversationId)` for a current snapshot.
Always match the entry's `serverId` to the consumer's owning host before using it,
as `ConversationScreen` does. No entry means no held local attempt or refusal; it
does not by itself prove success, since abandonment also removes entries.

`AgentSwitchDialog`, mounted in `App`, composes the shared 640px `Modal`. Its title
is “Switch to Codex?” or “Switch to Claude?”. The body adapts both directions:
“This channel moves from Claude to GPT-6 Luna on Codex. Claude writes a hand-over
note first, and Codex continues from it. The first reply after the switch costs
more, and full-bypass mode turns off.” The model uses `composerModelRowLabel`:
Codex's display name, or Claude's recognized family label with display-name fallback.
Model text stays escaped in text content, outside attributes and diagnostics.
Cancel, Escape and X close without sending. Focus starts on Cancel, Tab remains
within the dialog, and dismissal restores the previous focus if still mounted.

Switch rechecks the owning row, connection, open pane and unchanged outgoing
binding at dispatch time. It records pending synchronously and closes the dialog
before sending exactly one existing `switchAgent` command. Repeated confirmation
cannot resend. Pane changes cancel an unconfirmed dialog. Active metadata alone
is insufficient: `PairedShell` retains it during Settings/list navigation, so
`ConversationScreen` registers pane coordinates on mount and clears them on cleanup.

The payload sends the picked row's `value` verbatim as `model`, including `""` for
the target-agent default. Effort is read again at confirmation through
`selectDisplayedEffort(snapshot, writes)`, the composer's existing selection rule:
pending effort writes override the reading; otherwise applied effort wins, with
confirmed/saved fallback for undefined or empty applied readings. Explicit null
preserves the absence of a model effort parameter rather than reviving a saved
choice. Include effort only when it is a string present in the picked row's
`effort_levels`; null, undefined and unsupported values omit the key. Reading the
saved choice alone can dispatch stale effort. The switch state lives outside
`runSettingsWriteStore`, whose writes model individual settings.

## Renderer outcomes and lifetime

`AgentSwitchData` mounts app-lifetime subscriptions through `subscribeAgentSwitchData`:
typed daemon events plus active conversation, conversation list, session and server
stores. Pending and refused readings survive pane navigation and process updates,
including outcomes while the pane is unmounted. Subscriptions return cleanup handles;
there is no persistence, timer or automatic resend.

Retained entries reconcile against their recorded host's actual rows and connection.
Opening and confirmation still require unique ownership across hosts. Reusing that
unique-owner lookup for retained entries would erase pending/refused status when a
foreign host lists the same conversation ID, then lose a later owning-host refusal.
Unrelated hosts/conversations cannot settle an attempt. Owning-host disconnect or
removal, or removal of its conversation row, abandons local status/dialog state
without claiming success or refusal. Reconnect does not replay the request; the
next authoritative list supplies the binding.

Only a fresh `conversationsReceived` event with an actual target-agent row for the
pending attempt's owning host and conversation clears pending as success. A present
row with absent agent counts as Claude; the selector's missing-row Claude fallback
is never success evidence. A missing row abandons instead. An unchanged-agent list,
reset completion, session transition or metadata reconciliation cannot succeed.
`ConversationListData` keeps the existing `conversationUpdated` refresh path; no
correlated success acknowledgement is added. A published new binding also counts
as success after a daemon post-commit cleanup error.

`createAgentSwitchStore`'s optional `onActiveSucceeded(conversationId)` callback runs only for that
authoritative success while the mounted pane's conversation and host and the current open binding
still match the pending attempt. The singleton dispatches the write store's `agentSwitched` edge,
then requests fresh settings through `requestRunConfigSnapshot`. Synchronous generation notification
clears all outgoing write overlays/errors and cancels private permission/YOLO correlations and
polling, clears the outgoing snapshot and resets its replacement-session guard before the request.
See [settings lifetime](run-settings-write-store.md#settings-lifetime-on-agent-switch) and
[permission confirmation](run-config-store.md#permission-mode-1020).

Success while navigated away still settles the retained attempt, but never clears the newly active
pane's settings, including another host with the same conversation ID. Opening, cancellation,
refusal, abandonment, progress, standalone session transitions and unchanged/foreign/unstamped
lists do not invoke this callback. Raw model equality is irrelevant. Ordinary same-agent refreshes
and reconnect keep their existing confirmed-choice semantics.

Integration with [#1662 / PR #1846](https://github.com/pyrycode/pyrycode-desktop/pull/1846)
must preserve its outgoing model-announcement cleanup beside this settings-success callback.
That ticket's builder must enable and pass both skipped prior-own-pick cases in
`e2e/merged-model-pickers.spec.ts`; its separate live hand-over acceptance remains with that ticket
and the dispatcher/operator. This settings repair supplies neither announcement invalidation nor
live switching evidence.

A matching, main-stamped `switchAgentRejected` consumes only pending for that
host/conversation and stores retryability with fixed
[status copy](conversation-shell-composer-status.md#agent-switch-progress).
Unmatched, unstamped and no-pending refusals are ignored. Refusal establishes that
the agent did not change, but wrap-up may already have written handover or dropped
backlog. A new attempt requires another opening and confirmation; there is no
automatic retry or claim that wrap-up had no effects.

## Testing

- `agentSettingsLifecycle.test.ts` composes real stores and event subscriptions to pin active
  owning-pane success, all four settings fields, equal raw models, late replies, navigation/host
  isolation and private confirmation cleanup. The existing ticket-local opening fixture in
  `agent-switch-confirmation.spec.ts` exercises a confirmed own-agent model write followed by
  incoming footer/sheet readings; see [baseline, counted gate and capture evidence](development-verification.md#agent-switch-settings-verification).
- `agentSwitchStore.test.ts` covers both directions, empty/verbatim model values,
  supported/unsupported effort, synchronous pending, duplicate confirmation,
  stale pane/connection/binding guards, list-only success, both refusal kinds and
  lifecycle abandonment. Singleton effort cases distinguish applied readings and
  explicit null from an older saved choice. Composed regressions join the production
  singleton, `subscribeConversations` and `subscribeAgentSwitchData`: an injected
  outcome-only test cannot expose reconciliation erasing status on foreign same-ID
  lists. They retain pending/refused entries across those lists, accept the later
  owning refusal and abandon only on owning disconnect/host removal/conversation removal.
- `AgentSwitchDialog.test.tsx` pins escaped model content, both directions and exact
  phase/refusal copy. Mounted interaction evidence is recorded with the
  [composer status row](conversation-shell-composer-status.md#agent-switch-progress).
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
