# Daemon connection — system-prompt and MCP-status correlation

Split out of [Daemon connection correlation](daemon-connection-correlation.md) for size. System-prompt
read, system-prompt write (plus the workspace-renaming correlation that shipped alongside it), and
MCP-status request correlation — in the order they shipped.

# System-prompt read correlation (#1230)

An eighth correlation store, the `pendingConfigRequests` shape exactly:
`pendingSystemPromptRequests: Map<number, string>`, mapping a sent `request_system_prompt`'s
`envelopeId` to the conversation id that request named. It exists for the same reason
`pendingConfigRequests` does — `SystemPromptPayload` carries no `conversation_id` at all — but here
the omission is a **security property** upstream rather than a shape decision: it is what makes an
unhosted conversation's answer byte-identical to a hosted-but-quiet one, so the verb cannot be used as
a conversation-membership probe. This map is therefore the **only** place the reply's conversation
exists, and no future wire change is expected to add one.

- **Set — after the send, `pendingConfigRequests`' order.** `envelopeId` is captured into one local,
  read by the build, the counter advance, and the `set` alike, and the map is written only *after*
  `driver.sendMessage` returns — a build/send throw leaves no entry under an unspent id, which matters
  more here than on any sibling: a phantom entry would answer whichever request next re-mints that id,
  handing one conversation's stored system prompt to another.
- **Match + delete — inside `case 'system-prompt':`, gating a success reply, not a rejection.**
  `inbound.inReplyTo === undefined` short-circuits before the map lookup (no event); a
  `pendingSystemPromptRequests.get` miss short-circuits the same way (a stale reply from a cleared
  connection, a duplicate of an already-matched reply, or a hostile daemon forging a prompt for a
  request this client never sent); a hit `delete`s the entry and emits `systemPromptReceived` carrying
  the recorded conversation id and the decoded tri-state prompt beside its independent status — never
  the numeric `in_reply_to` itself. Both silent branches: the only values a diagnostic could carry are
  the conversation id and the wire routing id, and neither may reach a sink.
- **No `daemon-error` tier member.** Unlike every other map in this file, this one is checked in
  exactly one inbound arm — this verb mints no error code and has no failure branch, so there is no
  rejection to correlate against.
- **Reset — `dial()` clears the map next to its siblings.** A reconnect recycles envelope ids from 2,
  so a surviving entry would attribute the new connection's first reply to a dead one's conversation —
  handing one conversation's system prompt to another, the worst misattribution this file's maps guard
  against.
- **No cap**, the same evidence-based, no-observed-failure posture as every sibling store in this file.
  An entry costs one number and one short string, deleted on every match; the only way to accumulate
  them is this client sending asks a daemon never answers, a rate this client controls.

`security-sensitive`, builder self-review **PASS**, one SHOULD FIX (the emitted `conversationId` must
come from this map and not the decoded payload — closed by a dedicated test attributing a reply to the
requested conversation against a second, open one). See [System prompt send](system-prompt-send.md)
for the full design, including the outbound builder, the fail-closed decode, and the one
`DaemonEvent` arm this correlation feeds.

# System-prompt write correlation (#1249)

A ninth correlation store, the `pendingConfigRequests`/`pendingHistoryRequests` shape exactly:
`pendingSystemPromptWrites: Map<number, string>`, mapping a sent `set_system_prompt`'s `envelopeId` to
the conversation id that write named. Unlike its eight siblings, this store's reply is a record this
file had **never correlated before**: `conversation_updated`, which every earlier conversation-keyed
write verb (`change_workspace`, `archive`, `unarchive`, `rename`, `promote`) declines to correlate, and
which `conversationListBridge` treats as an **unconditional** list-refresh trigger regardless. That
live second consumer is why this correlation cannot use the `daemon-error` tier's consume-the-frame
shape for the ack half — see below.

- **Set — after the send, `pendingConfigRequests`' order**, but with a length gate in front of it that
  none of the other eight stores carry. `setSystemPrompt(payload)` checks
  `Buffer.byteLength(payload.system_prompt, 'utf8') > MAX_SYSTEM_PROMPT_BYTES` **before** the
  `driver === null` guard and before any build — an over-length string emits
  `systemPromptWriteRejected{reason:'prompt-too-long'}` immediately, with nothing built, nothing sent,
  and no map entry made. Past that gate, `envelopeId` is captured into one local read by the build, the
  counter advance, and the `set` alike, and the map is written only *after* `driver.sendMessage`
  returns — a build/send throw leaves no entry under an unspent id, the same reason it matters on every
  sibling: a phantom entry would answer whichever write next re-mints that id, handing one
  conversation's prompt write to another.
- **Confirm match — additive, not consuming, and it must run *after* the existing unconditional
  emit.** `case 'conversation-updated':` keeps emitting `conversationUpdated` first, unconditionally,
  exactly as it did before this ticket (`conversationListBridge`'s trigger). Only then does this store's
  lookup run: `inbound.inReplyTo` against `pendingSystemPromptWrites`; a miss or absent `inReplyTo`
  leaves the broadcast as the only emit; a hit `delete`s the entry and emits a **second**,
  additional event, `systemPromptWriteConfirmed{conversationId}` — `conversationId` read from the
  map's value, **never** from `inbound.conversationUpdated.id`, which a hostile or confused daemon
  controls and which a mutation check confirmed a test catches if swapped in. This is the one
  correlation in this file whose "match" branch must **not** collapse onto the `daemon-error` tier's
  consume-and-return shape — doing so would stop the requester's own write from refreshing their own
  conversation row, the trap the ticket names explicitly, and a mutation check that made the ack arm
  consume the frame on a match reddened five tests.
- **Reject match — the fifth member of the `daemon-error` precedence tier**, checked alongside
  `pendingSettings`/`pendingCreateFolders`/`transferForEnvelope`/`pendingHistoryRequests`. A hit
  `delete`s the entry and emits `systemPromptWriteRejected{conversationId, reason}`, where `reason` is
  `inbound.systemPromptReject ?? 'unclassified'` off the sibling narrower documented in [Daemon error
  outcome](daemon-error-outcome.md), then consumes the frame and `return`s — the tier's standing
  "an envelope id is minted once, so at most one store can hold it" reasoning, unchanged from its four
  predecessors. Unlike the confirm arm above, this one *does* consume the frame entirely, on the
  established `daemon-error` precedent — a rejection has no other consumer whose row it must refresh.
- **Reset — `dial()` clears the map next to its siblings.** A reconnect recycles envelope ids from 2, so
  a surviving entry would settle a new connection's write against a dead one's conversation.
- **No cap**, the same evidence-based, no-observed-failure posture as every sibling store in this file.

Both the confirm and reject arms are proven non-vacuous by mutation checks (`## Revisions` in
`docs/specs/architecture/1249-set-system-prompt-transport.md`): consuming the frame on a match reddened
5 tests; `system_prompt: payload.system_prompt ?? ''` in the fresh literal reddened 1; measuring the
byte bound with `.length` instead of `Buffer.byteLength` reddened 1; reading the ack's `id` field
instead of the map's value reddened 3; the byte bound as `>=` instead of `>` reddened 1.

`security-sensitive`, builder self-review **PASS**, no MUST FIX findings. See [System prompt
write](system-prompt-write.md) for the full design, including the outbound builder, the additive-ack
pattern stated once for reuse, the fail-closed decode, and the two `DaemonEvent` arms this correlation
feeds.

## Workspace renaming

`renameWorkspace(payload, attemptId?)` supports an optional acknowledgement for
[Add workspace](add-workspace-dialog.md#optional-shared-name). Existing callers that
omit the identifier, including Edit workspace, retain fire-and-forget behaviour.
The IPC command carries optional top-level `serverId` and `attemptId`; the guard
requires a present attempt identifier to be a nonempty string of at most 128 UTF-16
code units. It is a client correlation token, not authority and not a wire field.
Main routes by host and builds only `{ path, label }`, preserving explicit `null`
for callers that clear labels. The daemon wire contract is unchanged.

`pendingWorkspaceRenames: Map<number, string>` maps the sent wire envelope id to the
renderer attempt identifier. Registration happens only after build and send succeed,
so failed sends leave no phantom correlation. `dial()` clears the map with its siblings.

- Every decoded `workspace-updated` emits `workspaceUpdated` first, unconditionally.
  The decoder now retains optional `inReplyTo`; a matching map entry is then consumed
  and emits `workspaceRenameResult { attemptId, outcome: 'confirmed' }`. Missing,
  unrelated or duplicate correlation leaves only the broadcast. This additive order
  preserves the host-addressed authoritative list refresh for the requester and for
  unsolicited updates; consuming the success frame would lose that refresh.
- A matching `daemon-error` consumes the entry and emits the same result shape with
  `outcome: 'rejected'`, then returns before bundle/modal error fallbacks. No daemon
  error text, code, name or path is carried in this result.
- A null driver or local build/send throw rejects an identified attempt immediately.
  Missing host routing also rejects, stamped with the requested host in main. Calls
  without an identifier get no result. Normal connection results inherit the
  main-bound host origin; neither reply payload nor attempt identifier selects it.

The dialog alone consumes these results; the session, modal, question and timeline
bridges ignore them. It requires the selected host, current UUID and active naming
phase to match. Its 30-second deadline and dismissal are local: they do not remove a
main map entry or cancel a remote rename. A late reply can therefore still refresh
labels, but cannot settle a newer naming attempt. Map entries end on a correlated
reply/error or dial; there is no main-side timeout.

Lifecycle diagnostics use static event names and classifications: `workspace-rename-sent`,
`workspace-rename-result` with `confirmed`/`rejected`, and `workspace-rename-failed`
with `local-send` or `unavailable-host`. They omit identifiers, paths, names and
caught/daemon error text. The connection tests pin additive broadcasts, single-use
results, redial cleanup, local rejection and omission of attempt IDs from the wire;
mounted dialog tests prove host/attempt isolation and naming-only retry.

# MCP-status request correlation (#1578)

A correlation store on the `pendingConfigRequests` shape, `pendingMcpStatusRequests: Map<number,
string>`, mapping a sent `mcp_status_request`'s `envelopeId` to the conversation id that ask named.
`requestMcpStatus(conversationId)` builds a fresh one-field payload (`{ conversation_id }`) through
`buildRequestMcpStatus`, so extra renderer fields never reach the wire; the payload guard at
`isRendererCommand`'s `requestMcpStatus` arm accepts any string including `''` and lets routing decide.
Not connected/authenticated is a refused log and nothing sent; a build/send throw is caught, logged
content-free, and leaves no entry under an unspent id, the same reasoning as every sibling store in
this file.

This store breaks with every sibling above it in one way: **a successful reply can never consume it.**
The daemon answers `mcp_status_request` with the same `mcp_status` kind it uses for unsolicited live
publication ([Inbound message decode](inbound-message-decode.md) § Related, #1489), and that kind carries
no `in_reply_to` once decoded — by design, per the ticket, so as not to special-case the live path for a
correlated one. `case 'mcp-status':` therefore has no map to check and emits `mcpStatus` exactly as it
always has; the request and the reply are connected only by the requester eventually seeing a report.
Where every prior store in this file could say "no cap, the same evidence-based, no-observed-failure
posture" because a matched success always deletes the entry, that reasoning does not transfer here: an
unbounded `pendingMcpStatusRequests` is not a hypothetical failure mode to wait and observe, it is the
guaranteed outcome of any answered request, every time. So the cap is not deferred pending evidence —
`pendingMcpStatusRequests` is bounded at `MAX_PENDING_MCP_STATUS_REQUESTS` (32) entries, and recording a
33rd evicts the oldest by `Map` insertion order. The daemon answers promptly, so a rejection for an
evicted ask can only arrive after 32 newer asks have already been sent, and dropping it is harmless: no
stored report is touched and nothing retries.

- **Reject match — the sixth member of the `daemon-error` precedence tier**, checked alongside
  `pendingSettings`/`pendingCreateFolders`/`transferForEnvelope`/`pendingHistoryRequests`/
  `pendingSystemPromptWrites`. A hit `delete`s the entry, logs `mcp-status-request-rejected` with
  `code: reason`, and emits `mcpStatusRequestRejected { conversationId, reason }` — `conversationId`
  read from the map's value (the conversation *this app* asked about), never from the error payload, so
  a hostile daemon cannot make a refusal name a conversation this app never queried. `reason` is
  `inbound.mcpStatusReject ?? 'unclassified'` off the fourth sibling narrower documented in [Daemon
  error outcome § The fourth verb landed](daemon-error-outcome.md#the-fourth-verb-landed--the-fifth-verb-warning).
  The frame is consumed and the handler returns, on the established `daemon-error` precedent.
- **Reset — `dial()` clears the map next to its siblings.**
- **The `mcpStatusStore` is never touched by a rejection.** No refusal clears or fabricates a report;
  a stale-but-present report from an earlier successful answer is left standing.

**A test-fixture trap specific to this verb's success path:** the `mcp_status` payload's row shape
(`parseMCPServerStatus`, [Inbound message decode](inbound-message-decode.md) § Related, #1489) requires
`error` to be a plain string on every row, never `null`. A fixture built for "does a correlated
`mcp_status` reach the store" with `error: null` on a server row fails `parseMCPServerStatus` and drops
the *entire* frame — the test then reads as "the correlated reply was never delivered," which points at
routing and correlation code that is actually fine. Use `error: ''` for a clean row.

`security-sensitive`, builder self-review **PASS**, one SHOULD FIX addressed in the design itself (the
uncapped map growth from a success that can never clear its entry) — see the cap above. No other
findings; the design and its security review are recorded in full in
`docs/specs/architecture/1578-request-mcp-status.md`. [#1579](https://github.com/pyrycode/pyrycode-desktop/issues/1579)
put this verb to use: the channel info sheet's on-open trigger and the `mcpStatusRequestRejected` consumer
landed in a fifth, dedicated bridge, `mcpStatusBridge.ts` — not in the four exhaustive renderer bridges
this section names. Those four (`questionBridge`, `daemonEventBridge`, `timelineBridge`, `modalBridge`)
keep the one-line ignored arm beside their existing informational `case 'mcpStatus':`, now commented
`// The channel info sheet's notice owns this (#1579).`. See [Conversation shell — session and channel
info § MCP servers section](conversation-shell-session-and-channel-info.md#mcp-servers-section-1490) for
the mark, the notice and the fake-tier proof.

# MCP reconnect correlation (#1582)

A tenth correlation store, `pendingMcpReconnects: Map<number, string>`, the exact shape and lifecycle
of `pendingMcpStatusRequests` above: envelope id → the conversation this app acted on, never the server
name. `reconnectMcpServer(conversationId, serverName)` builds a fresh two-field payload
(`{ conversation_id, server_name }`) through `buildMcpReconnect`, so extra renderer fields never reach
the wire; the payload guard at `isRendererCommand`'s `reconnectMcpServer` arm accepts any string
including `''` for either field — routing decides the conversation, the daemon decides the server. Not
connected/authenticated is a refused log and nothing sent; a build/send throw is caught, logged
content-free, and leaves no entry under an unspent id.

This store shares its sibling's asymmetry: **a successful reply can never consume it.** An accepted
reconnect answers with an ordinary `mcp_status`, delivered by the existing `case 'mcp-status':` path with
no correlation at all — the request and the reply are connected only by the requester eventually seeing
a report. So the cap is not deferred pending evidence, for the same reason as `pendingMcpStatusRequests`:
`pendingMcpReconnects` is bounded at `MAX_PENDING_MCP_RECONNECTS` (32), oldest evicted first.

- **Reject match — the seventh member of the `daemon-error` precedence tier**, checked alongside
  `pendingMcpStatusRequests` and its five other siblings. A hit `delete`s the entry, logs
  `mcp-reconnect-rejected` with no code, and emits `mcpReconnectRejected { conversationId }` —
  `conversationId` read from the map's value, never from the error payload. Unlike every sibling in this
  tier, this match reads **no narrowed field at all**: the ticket forbids re-splitting what the daemon
  merges on purpose (`mcp_actuation.refused`, `protocol.malformed`, `conversation.not_found`, and an
  unknown code all land on the same event), so there is no `reason` field and no addition to the
  `daemon-error` arm's narrowed-field set — the comment there warns that a fifth such field should
  prompt a restructure, and this slice deliberately stays at four by adding none.
- **Reset — `dial()` clears the map next to its siblings.**
- **The server name never crosses into a log, a map key, or the event.** The map's value is always the
  conversation id; `buildMcpReconnect` is the only place `serverName` is read, and it goes straight into
  the wire payload and nowhere else.

**Sourcing the server name is deferred, on purpose.** The upstream protocol doc warns against filling
`mcp_reconnect.server_name` from a `context_usage` response's `mcp_tools[].server_name` — that field
reports a contributor to the context reading, not an actuation input. The Reconnect control (a later
slice of #1492) must take the name from an `mcp_status` row instead.

`security-sensitive`, builder self-review **PASS**, one SHOULD FIX addressed in the design itself (the
same uncapped-map-growth shape as #1578's finding) — see the cap above. No other findings; the design and
its security review are recorded in full in `docs/specs/architecture/1582-mcp-reconnect.md`. The four
exhaustive renderer bridges (`questionBridge`, `daemonEventBridge`, `timelineBridge`, `modalBridge`) each
gained a one-line ignored `case 'mcpReconnectRejected':` arm; nothing in the window consumes the event
yet, the same UI-comes-later shape as the MCP-status ask before #1579. The live device-gate drive is
\#1583.
