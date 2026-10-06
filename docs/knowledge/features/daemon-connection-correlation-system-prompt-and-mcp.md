# Daemon connection — system-prompt and MCP-status correlation

Split out of [Daemon connection correlation](daemon-connection-correlation.md) for size. System-prompt
read/write, workspace renaming, MCP-status requests and actuation, background-task stops, and
conversation-mute writes.

## Host system prompt read/write correlation

The [Edit host dialog](edit-host-dialog.md) uses host-wide commands independently
of the conversation system-prompt maps below. `pendingHostPromptReads` and
`pendingHostPromptWrites` each map an envelope id to `{ requestId, timer }`.
Both draw ids from the connection's monotonic sequence. The daemon supplies no
host, conversation or session identifier in the reply; correlation and the
main-owned server stamp are the only attribution sources. See the
[protocol contract](inbound-message-decode-payloads.md#daemon-wide-host-system-prompt).

`sendHostPrompt` checks authentication/driver availability and refuses an
over-limit UTF-8 write before sending. It builds a fresh read `{}` or write
`{ system_prompt }` payload, excluding renderer routing/correlation metadata and
extra fields. It registers the pending entry and 15-second timer before calling
`driver.sendMessage`, so a synchronous response can match. A build/send throw
removes the entry, clears its timer and emits fixed failure; the spent envelope
id is not reused.

The validated `host-system-prompt` inbound kind requires `inReplyTo` to match
one pending map. `takeHostPrompt` clears the timer and consumes the entry once,
then emits `hostSystemPromptReceived { requestId, operation, systemPrompt,
defaultSystemPrompt }`. Writes succeed only through this durable reply; there
is no separate ack. Missing/unrelated/duplicate correlation emits nothing.
Replies contain only the two required, inclusively byte-bounded strings;
null/missing/mistyped/oversized values fail decoding rather than entering IPC.
A malformed reply leaves the wait to its deadline unless connection loss ends it.

Correlated daemon errors consume the corresponding read/write entry before
other error consumers, regardless of error code. Route refusal, unavailable
driver, local byte refusal, send failure, timeout, daemon rejection and connection
loss produce `hostSystemPromptFailed { requestId, operation }`, with no daemon
message or exception text. There is no automatic retry. Logs carry fixed names
and classification/operation only, never prompt/default text or request ids.

`abandonHostPrompts` fails all pending operations and clears timers/maps on link
loss, terminal/failure, stop and fresh dial (including connection replacement).
The driver generation rejects old socket callbacks. Clearing both maps matters:
otherwise a late reply could settle a request after reconnect under a recycled
envelope id. The registry's lifecycle-free facade delegates both host methods;
it does not own another correlation store. The dialog separately guards its
interaction and operation lifetime before treating an outcome as current.

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
`// The channel info sheet's notice owns this (#1579).`. See [Channel info § MCP servers
section](conversation-shell-channel-info-mcp.md#mcp-servers-section-1490) for
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

# MCP toggle correlation (#1586)

An eleventh correlation store, `pendingMcpToggles: Map<number, string>`, the reconnect map's shape and
lifecycle with a third wire field. `toggleMcpServer(conversationId, serverName, enabled)` builds a fresh
three-field payload (`{ conversation_id, server_name, enabled }`) through `buildMcpToggle`; the guard
`isMCPTogglePayload` is the reconnect guard plus a present, genuinely-boolean `enabled` check, so a truthy
stand-in such as `'false'` or `1` can never become a requested state. **`enabled` is always written, for
`false` as well as `true`** — the daemon decodes an omitted key as `false`, the non-escalating direction,
and this client never relies on that default. The requested state is the operator's, passed straight from
the command to the builder; nothing on this side reads `mcpStatusStore` or checks the request against a
prior report.

This store shares its two siblings' asymmetry: **a successful reply can never consume it.** An accepted
toggle answers with an ordinary `mcp_status`, delivered by the existing informational path with no
correlation at all. So `pendingMcpToggles` is bounded at `MAX_PENDING_MCP_TOGGLES` (32), oldest evicted
first, for the same reason as `pendingMcpReconnects` and `pendingMcpStatusRequests`.

- **Reject match — an eighth precedence-tier member, checked directly after the reconnect match above.**
  A hit `delete`s the entry, logs `mcp-toggle-rejected` with no code, and emits
  `mcpToggleRejected { conversationId }` — a distinct event from `mcpReconnectRejected`, so the channel
  info sheet can say which action was refused. Like the reconnect match, it reads no narrowed field at
  all: `mcp_actuation.refused`, `protocol.malformed`, `conversation.not_found` and an unknown code all
  land on the same event.
- **Reset — `dial()` clears the map next to its siblings.**
- **The server name and the requested state never cross into a log, a map key, or the event.** The map's
  value is always the conversation id; `buildMcpToggle` is the only place `serverName` and `enabled` are
  read, and both go straight into the wire payload and nowhere else.

**Why a fourth per-verb map rather than one shared map with a kind tag:** envelope ids come from one
sequence, so an id is in at most one of the four pending maps and the matches cannot collide regardless.
Separate maps also keep each verb's correlation code an exact copy of its precedent — the code review
flagged `toggleMcpServer`'s body as a near-duplicate of `reconnectMcpServer`'s and let it stand on that
basis, deferring a shared "send and record" helper until a third verb needs one.

`security-sensitive`, builder self-review **PASS**, no findings beyond what the design already addressed
(the same bounded-map shape as its two precedents); the design and its security review are recorded in
full in `docs/specs/architecture/1586-mcp-toggle.md`. The four exhaustive renderer bridges
(`questionBridge`, `daemonEventBridge`, `timelineBridge`, `modalBridge`) each gained a one-line ignored
`case 'mcpToggleRejected':` arm; nothing in the window consumes the event yet — presenting the refusal and
the on/off switch itself are [#1587](https://github.com/pyrycode/pyrycode-desktop/issues/1587), which this
ticket blocks.

# Background-task stop correlation (#1770)

`loadDialConfig` advertises `CAPABILITY_STOP_BACKGROUND_TASK` (`'stop_background_task'`) beside
`interactive` and `multi_agent`. This is detection only: a supporting daemon echoes it in
`hello_ack.capabilities`, already delivered to the window on `connected.ack`. The send path does not
gate on that echo; a Stop task control can use it to detect support.

The `stopBackgroundTask` renderer command carries `StopBackgroundTaskPayload` with required
`conversation_id` and `task_id` strings. `isStopBackgroundTaskPayload` rejects missing, non-string or
empty ids at the IPC boundary; it preserves nonempty strings verbatim and accepts extra fields.
Main routes by conversation to its owning host, and the registry delegates both arguments to that
connection's `stopBackgroundTask(conversationId, taskId)`. An unclaimed conversation sends nothing.
`buildStopBackgroundTask` constructs a fresh payload containing exactly `{ conversation_id, task_id }`
in one `stop_background_task` envelope, so extra renderer fields cannot reach the wire. An unavailable
or unauthenticated driver sends nothing; a build/send throw is caught. Nothing retries or waits on a
timer, and local failure emits no rejection event.

`pendingBackgroundTaskStops: Map<number, { conversationId: string; taskId: string }>` records both
ids only after the send succeeds. **An accepted stop gets no reply at all**, unlike `mcp_toggle`'s
ordinary `mcp_status` report. The daemon is also silent when it cannot act on the conversation, so
silence cannot confirm success. Entries therefore survive normal successful use until eviction or
the next `dial()`: the cap, not a success correlation path, bounds this map. It holds at most
`MAX_PENDING_BACKGROUND_TASK_STOPS` (32) entries, evicting the oldest by insertion order before
recording a 33rd. `dial()` clears it beside `pendingMcpToggles`, preventing recycled envelope ids
from settling a dead connection's request.

The protocol refusal is an `error` with code `stop_background_task.refused` and `in_reply_to` naming
the request; it carries no task id. The `daemon-error` handler checks this map immediately after
the MCP toggle map, using only `inReplyTo`. A hit deletes the entry, emits one
`backgroundTaskStopRejected { conversationId, taskId }` from the **send-time values**, consumes the
frame and returns. It reads neither the reflected conversation nor the error code/message: unknown
or non-string codes settle identically. Missing, unrelated, duplicate, evicted or cleared correlation
emits no stop-rejection event and falls through to existing error handling. Each verb has its own map
and draws envelope ids from one sequence, so an MCP toggle refusal cannot settle a pending stop.

Both ids remain opaque strings, never diagnostic fields, paths or URLs. Diagnostics use fixed names:
`background-task-stop-sent`, `background-task-stop-rejected`, `background-task-stop-refused` with
`code: 'unavailable'`, and `background-task-stop-failed` with `code: 'build-or-send-failed'`. Neither
id, reflected daemon content nor caught exception text enters a log. The four exhaustive renderer
bridges (`daemonEventBridge`, `modalBridge`, `questionBridge`, `timelineBridge`) ignore the event;
the Stop task button, refusal presentation and live round-trip belong to the separate UI slice.

The envelope tests compare bytes against a hand-built expected frame, including awkward opaque ids
and dropped extras. Command, connection and registry tests cover boundary rejection, host routing,
single-send behaviour, local failure, send-time attribution against forged reflected ids, separate
MCP/stop refusals, duplicate suppression, oldest-first eviction, redial cleanup and content-free
logs. See the [transport plan](../../specs/architecture/1770-stop-background-task.md) for the contract
and security review.

# Conversation-mute write correlation ([#1595](https://github.com/pyrycode/pyrycode-desktop/issues/1595))

A twelfth correlation store, `pendingMuteWrites: Map<number, string>`, mapping a sent
`set_conversation_muted`'s `envelopeId` to a renderer-minted `attemptId` — the workspace-renaming shape
above (§ Workspace renaming), not the eight verb-id-keyed stores that map to a conversation id. It
exists for the same reason `pendingWorkspaceRenames` does: this verb has more than one consumer of its
name and needs an outcome addressed back to the specific caller who asked, not a broadcast.

`setConversationMuted(payload, attemptId)` mirrors `renameWorkspace`: a null driver rejects
immediately; past that, `envelopeId` is captured into one local read by the build, the counter advance
and the `set` alike, and a **fresh** `{ conversation_id, muted }` literal — never a spread of the
renderer's payload — is what gets sent, so no extra field smuggled past the IPC guard can reach the
wire. The map is written only after `driver.sendMessage` returns; a build/send throw leaves no entry
and rejects that attempt directly.

- **Confirm match — additive, after the existing unconditional `conversationUpdated` emit**, the
  `set_system_prompt` shape (§ above), not the `daemon-error`-tier consume-and-return shape: the
  requester's own mute toggle must still refresh their own row through the ordinary list re-request,
  so the ack cannot consume the frame. `case 'conversation-updated':` keeps emitting `conversationUpdated`
  first, unconditionally, exactly as before this ticket; only then does `inbound.inReplyTo` get checked
  against `pendingMuteWrites`. A miss or absent `inReplyTo` leaves the broadcast as the only emit; a hit
  `delete`s the entry and emits `conversationMuteResult { attemptId, outcome: 'confirmed' }` — content-free,
  carrying neither the conversation id nor the daemon's `is_muted` value. A consumer that wants the
  stored value reads it off the list refresh the broadcast already triggered, not off this event.
- **Reject match — a ninth member of the `daemon-error` precedence tier**, checked alongside
  `pendingSettings`/`pendingCreateFolders`/`transferForEnvelope`/`pendingHistoryRequests`/
  `pendingSystemPromptWrites`/`pendingMcpStatusRequests`/`pendingMcpReconnects`/`pendingMcpToggles`. A
  hit `delete`s the entry and emits `conversationMuteResult { attemptId, outcome: 'rejected' }`, then
  consumes the frame and `return`s, on the tier's standing precedent. The daemon's error code is not
  read; every code settles the same way. **Checked before `pendingSystemPromptWrites` in source order,**
  which is safe only because both maps draw their keys from the one shared `nextEnvelopeId` sequence —
  an id is minted once and can therefore be held by at most one of the tier's maps, so which map is
  checked first never changes which one matches.
- **Reset — `dial()` clears the map next to its siblings.** A reconnect recycles envelope ids from 2, so
  a surviving entry would settle a new connection's write against a dead attempt.
- **No cap**, the same evidence-based, no-observed-failure posture as every matched-success store in this
  file — the confirm arm above always deletes the entry on a match, unlike the three MCP stores' guaranteed-
  growth shape.

**The IPC guard is strict, not structural-minimum like its siblings.** `isSetConversationMutedPayload`
requires the payload's key set to be *exactly* `{conversation_id, muted}` and `muted` to be `=== true ||
=== false` — rejecting `muted: 1`, `muted: 'true'`, a missing `muted`, and any extra key. Copying a
sibling guard such as `isSetSystemPromptPayload` (which accepts any object with the right shape and
ignores extra keys) would have let a truthy non-boolean through undetected by any existing test pattern;
the acceptance criteria asked for strictness explicitly, so this is the one guard in the file that
differs from the rest on that axis.

**No routing failure has its own event.** An id no paired host claims, or an owning connection that is
not connected, both settle through `bindServerOrigin`'s null-origin path in `src/main/index.ts` as an
ordinary `rejected` — the same posture `renameWorkspace`'s arm established — rather than a distinct
"unrouted" outcome. `#1596`, the Edit channel dialog, is this event's only intended consumer and adds no
renderer store of its own; it decides what a pending/confirmed/rejected outcome means for its own UI.

`security-sensitive`, builder self-review **PASS**, no findings; the design and its security review are
recorded in full in `docs/specs/architecture/1595-set-conversation-muted.md`. The four exhaustive
renderer bridges (`questionBridge`, `daemonEventBridge`, `timelineBridge`, `modalBridge`) each gained a
one-line ignored `case 'conversationMuteResult':` arm, the `workspaceRenameResult` shape — #1596 is the
first real consumer.
