# Daemon connection — request/history/attachment correlation

Split out of [Daemon connection correlation](daemon-connection-correlation.md) for size. Diagnostic
logging, then the request-response correlation stores for conversation creation, attachment upload and
retrieval, run-configuration reads, and conversation history — in the order they shipped.

# Diagnostic logging ([#128](../codebase/128.md))

The classification the module *already computes* now also lands in the [#126 content-free log](diagnostic-log.md). The logger is injected as `deps.diagnosticLog?` (added accepted-unused by [#126](../codebase/126.md), constructed once at the composition root); this module consumes it at **three pre-existing seams** with three one-line calls — no new choke point, no new type, no root wiring. Each record is a static event name plus, for the failure record, the static classification `code`:

| Record | Site | Carries | Signal |
|---|---|---|---|
| `daemon-dial` | `dial()`'s `connecting` emit | event name only (coordinate-free) | the daemon-side dial window opening |
| `daemon-connected` | `onDriverEvent` `handshake-complete` success | event name only | the Noise handshake **finished** (never the ack bytes) |
| `daemon-failed { code }` | `emitFailed` (the single failure choke point) | static classification `code` only | which of the five classifications a failure carried |

- **The leg division vs [#127](../codebase/127.md) (relay leg).** The same socket close flows through both layers. #127 logs the **socket facts** — the connection coordinates (`host`/`path`) and the numeric WS close code (`relay-closed { status: terminal.code }`); this module logs the **classification** (`daemon-failed { code }`) and nothing else. `emitFailed` logs only its `code` argument, never its `message` argument (which interpolates the numeric close code `…(code ${event.code}).`) — so the socket code stays out of the daemon record by construction. The daemon leg carries **no** `host`/`path`/`status`.
- **`daemon-dial` is coordinate-free and fires before `bootstrap`.** At the dial seam the paired record isn't loaded yet (host/path aren't even available, and they're #127's regardless). Logging unconditionally at the `connecting` transition means the **not-paired** case still anchors — `daemon-dial → daemon-failed { code: 'not-paired' }` — a complete daemon-side window even when the relay socket never opens and #127 is silent.
- **`daemon-failed` covers all five classifications** through the one call at `emitFailed`: `not-paired`, `malformed-hello-ack`, `connect-failed`, `connection-closed`, and the driver's own `error` reason (`emitFailed(event.reason)`, typed `RelaySessionErrorReason` — a closed enum documented "never carries key/token/frame/plaintext bytes", so it's safe as the `code`). The peer-supplied `terminal.reason` string is dropped by the existing `terminal` case and never reaches the log.
- **A faithful shadow of the gen-fenced event stream.** All three sites log *after* their `emitDaemonEvent`, inside the existing generation fence — so no stray record leaks from a superseded dial, and a clean `stop()` suppresses both the `failed` event and the `daemon-failed` record for free (the `terminal` case returns on `if (stopped)` before reaching `emitFailed`). Behaviour is otherwise unchanged: the module still never throws, still drops every caught object, and emits the same `DaemonEvent`s in the same order (the sink swallows its own errors, so a full-disk log can't crash the connection it observes).

# Create-conversation rejected correlation ([#1307](https://github.com/pyrycode/pyrycode-desktop/issues/1307))

A further correlation store lives here, `pendingCreateFolders`' nearest sibling in shape and placed
immediately after it in the `daemon-error` chain: `pendingCreateConversations: Set<number>`, envelope ids
of outstanding [`create_conversation`](conversation-create.md) requests. Before this ticket
`createConversation` was fire-and-forget end to end — no record of the envelope id was kept, so a daemon
`error` correlated by `Envelope.in_reply_to` fell through the whole chain and was consumed (or dropped) by
the modal FIFO. Both of its callers, the new-discussion FAB and the Channels-tree workspace plus, had no
failure path at all. The header deliberately states **which tier the store joins, not an ordinal** — two
existing headers in this file already call themselves "the fourth member" or "the third member" of a count
no gate checks, and this one does not add a third claim to keep straight.

- **Set / match+delete / reset — the `pendingCreateFolders` template verbatim.** `createConversation`
  captures `envelopeId = nextEnvelopeId` before the build and adds it to the set only after a successful
  `driver.sendMessage`. Since #1367, unavailable connections and build/send throws emit a
  local host-stamped rejection without registering an entry, so a later error cannot
  falsely correlate to an unsent request. `case 'daemon-error':` checks the set inside the existing
  `inReplyTo !== undefined` guard, and a match deletes the entry, emits the bare
  `{ type: 'conversationCreateRejected' }`, and `return`s before both `reassembler?.fail` and the modal-FIFO
  shift; `dial()` clears the set next to its siblings. Nothing is read off the untrusted error payload — the
  event has no request/error payload; `bindServerOrigin` supplies the host stamp. Diagnostics
  contain only static lifecycle names and classifications, never daemon or caught-error text.
- **The success reply does not consume the entry — same as `pendingCreateFolders`, not a variant of it.**
  Main emits `conversation_created` without matching a request, so a late error for an
  already-created conversation can still emit a rejection. The [Add workspace
  dialog](add-workspace-dialog.md#host-scoped-results) accepts only its selected host's
  stamped results and gates rejection on `status === 'creating'`. After any submission,
  the first matching confirmation pins the remote folder, including after timeout/failure.
  A blank submitted name closes the dialog; otherwise it enters the independently
  correlated naming phase described under [Workspace
  renaming](daemon-connection-correlation-system-prompt-and-mcp.md#workspace-renaming).
  Success, Cancel and unmount detach its result/session-state listeners and clear its
  local deadline; a later rejection cannot reopen it. Pending entries remain unbounded, on
  `pendingHistoryRequests`' accepted argument: an entry costs one number, only this client's own sends add
  one, every match or dial removes one.
- **Bareness does not mean single-caller, and the shipped code comment overstated that it did.** The
  #396 code review caught this during #1307's own review: `create_conversation` has **three** live callers
  now that #1308 shipped (the FAB, the Channels-tree workspace plus, and the host row's Add-workspace
  dialog), so more than one request can be outstanding at once. The bare arm therefore cannot say *whose*
  rejection it is reporting — not because only one caller exists, but because the ticket scoped a per-entry
  payload out regardless (the daemon's own refusal message never echoes the path, so there is nothing to
  carry even if a field were added). The dialog now checks the host stamp as well as its
  pending state. Another host cannot settle its wait, but concurrent creates and retries
  on the same host remain indistinguishable. No renderer request token or per-request
  success matching was added; timeout and Cancel end only the local wait and do not cancel
  the server operation. Do not repeat the "only one dialog is ever open"
  reasoning `pendingCreateFolders` earned honestly (that store really does have exactly one caller) when
  writing this store's next consumer.

`security-sensitive`, builder self-review **PASS**, one accepted SHOULD FIX (the unbounded set, the
`pendingCreateFolders`/`pendingHistoryRequests` posture) and one SHOULD FIX #1308 discharged by
construction rather than by a fix (the stale-rejection-after-confirmation case, above); the residual
concurrent-caller ambiguity while a create is genuinely in flight is accepted as structural, not tracked as
an open item. See [Conversation create](conversation-create.md) for the full transport slice this
correlation attaches to.

# Attachment-upload correlation ([#861](https://github.com/pyrycode/pyrycode-desktop/issues/861))

The **two-key** correlation the rest of this document's single-key precedent doesn't fit — see
[Attachment transfer](attachment-transfer.md) for the full design argument. A fifth correlation store
lives here, module-local alongside the four above: `activeTransfers: Set<AttachmentTransfer>`, one entry
per in-flight upload. A `Set`, not a `Map` keyed by envelope id like `pendingSettings`: two files can be
attached in one session, and each transfer owns *many* envelope ids (one per chunk) rather than one, so
the natural key is the transfer object itself, queried by a linear scan over a handful of entries.

- **Add — before the drive, not after.** `uploadAttachment` calls `activeTransfers.add(transfer)` *before*
  `transfer.start()` — the `requestDebugBundle` arm-before-send discipline, restated for a `Set` instead of
  a single slot: the reverse order would let a fast reply race an unarmed entry.
- **Success match — `attachmentId`, not `in_reply_to`.** `case 'attachment-stored':` scans
  `activeTransfers` for `transfer.attachmentId === inbound.attachmentStored.attachment_id`, calls
  `.stored()` on the first hit, and returns. This is the **only** inbound arm in this file that correlates
  on a payload field instead of the envelope id — the reply's `in_reply_to` names the chunk whose arrival
  completed the transfer, not a value the sender can predict, which is why `attachment-stored` carries no
  `inReplyTo` at all (see [Attachment-stored wire types](attachment-stored-wire-types.md)).
- **Reject match — `sentEnvelope`, the fifth member of the `daemon-error` precedence tier.** A new
  `transferForEnvelope(envelopeId)` helper scans `activeTransfers` for `transfer.sentEnvelope(envelopeId)`,
  checked inside the existing `if (inReplyTo !== undefined)` block **after** `pendingCreateFolders` — the
  same tier as #269's `pendingSettings` check and #396's `pendingCreateFolders` check. A match calls
  `.fail(inbound.outcome)` and `return`s, skipping both `reassembler?.fail` and the modal FIFO `shift`,
  on the tier's standing argument: an envelope id is minted once, so at most one of the three stores can
  hold it. `inbound.outcome` is the client-owned `DaemonErrorOutcome` [#965](daemon-error-outcome.md)
  already mapped off the daemon's `code` string — nothing here re-parses it.
- **Remove — on settle, via `finally`.** `uploadAttachment` deletes the transfer from the set once its
  `result` promise settles (which never rejects), regardless of which path settled it. This bounds the
  scan to genuinely live work and is what keeps a later reply naming a finished transfer's id from
  resolving anything.
- **Reset — `failAttachmentTransfers()`, `failBundleStream`'s twin.** Snapshots and clears the set
  **before** failing each entry `'connection-lost'` (release-then-fail, the existing `failBundleStream`
  posture), called at all four `failBundleStream` sites (`relay-link-down`, `terminal`, connection-level
  `error`, `dial()`) — a teardown re-dials into a fresh Noise session the daemon-side transfer does not
  survive. This is also what makes `dial()`'s `nextEnvelopeId = 2` reset safe for this store: every live
  transfer is failed before ids recycle, so a stale id can never mis-correlate on the reconnected session
  — the same argument `pendingSettings.clear()` already carries, extended to a store that is cleared by
  failing its contents rather than by a bare `.clear()`.

`security-sensitive`, architect self-review **PASS**. Emits **no** `DaemonEvent` on either arm — the
outcome goes back to `uploadAttachment`'s caller, and surfacing it to the window is
[#862](https://github.com/pyrycode/pyrycode-desktop/issues/862)'s slice.

# Attachment-retrieval correlation ([#996](https://github.com/pyrycode/pyrycode-desktop/issues/996))

The mirror image of the upload correlation above, and it matches the OPPOSITE way round for a
structural reason: every answer to one `request_attachment` ask — every chunk **and** the reject —
names the same envelope id, so a single `Map<number, PendingRetrieval>` keyed by that id, the
`pendingSettings`/`pendingCreateFolders` shape, is enough on its own. (The upload leg needs its
`Set` + two-key scan because its *success* reply names whichever chunk closed the transfer, which the
sender cannot predict.) See [Attachment retrieval](attachment-retrieval.md) for the full design.

- **Set — after the send, not before it.** `requestAttachment` builds and sends the frame first, and
  registers `pendingRetrievals` only once it is on the wire — the opposite order from every arm-before-
  send precedent in this file, including this leg's own upload sibling. The reason is specific to this
  map: the envelope-id counter here advances only on a successful build, so an entry armed before a
  throw is left keyed to an id the *next* outbound envelope re-mints, which would swallow that
  envelope's reject. Fixed after a security-review MUST FIX during implementation (see
  [Attachment retrieval](attachment-retrieval.md) § Revisions); a build/send throw now settles the
  waiting consumer immediately as `'send-failed'` and registers nothing.
- **Chunk match — `in_reply_to`, plus a non-redundant payload check one layer down.** `case
  'attachment-chunk':` looks the frame up by `inbound.inReplyTo`; a miss is dropped (no event, no log,
  no throw). The reassembler independently refuses a chunk whose payload `attachment_id` names a
  different transfer — the failure only the payload id catches is the host answering the right ask
  with the wrong bytes. Each accepted chunk re-arms the idle deadline (see below).
- **Reject match — the sixth member of the `daemon-error` precedence tier**, checked in the existing
  `if (inReplyTo !== undefined)` block alongside `pendingSettings`/`pendingCreateFolders`/
  `transferForEnvelope`. `attachment.stream_aborted` routes **through the reassembler's two-member
  pass-through door** (`AttachmentFailReason`'s `'stream-aborted'`) rather than settling directly,
  because that door is where #995's discard-the-partial obligation lives. `attachment.not_found`
  settles `'not-found'` directly; any other code settles `'daemon-error'` directly — neither goes
  through the reassembler, since a reject yields no bytes and there is nothing to discard.
  `AttachmentFailReason` is **not widened** for either.
- **A per-retrieval idle deadline, armed at send and reset on every accepted chunk** — genuinely new
  machinery in this module: no other correlation store here has ever needed a timer, because every
  other one either has no completion frame it must detect the absence of, or is backstopped by
  `failAttachmentTransfers`'s connection-level net alone. 30 s, restating `relayConnection`'s
  `WIRE_PONG_TIMEOUT_MS` figure. Injected via `DaemonConnectionDeps.timing`, `createRelaySupervisor`'s
  seam verbatim.
- **Remove — the single `settleRetrieval` choke point.** Clears the timer, deletes the map entry, calls
  the consumer — every settle path (chunk completion, either reject route, the idle deadline, the
  teardown net) funnels through it, which is what makes "exactly one terminal" a property of there
  being one exit rather than a guard at each site.
- **Reset — `failAttachmentRetrievals()`**, the set-shaped teardown net (`failAttachmentTransfers`'s
  twin, not `failBundleStream`'s single-slot one): snapshot and clear the map, clear every timer, fail
  each consumer `'connection-lost'`. Called at the same four sites as its siblings — `relay-link-down`,
  `terminal`, connection-level `error`, `dial()` — so a stale envelope id can never correlate on a
  reconnected session.

`security-sensitive`, architect self-review **PASS** (one MUST FIX resolved before the initial commit —
a concurrency cap one layer up, in the orchestrator, not this correlation tier — and one resolved in a
post-review follow-up fix, the set-after-send ordering above). Emits **no** `DaemonEvent` — the outcome
goes back to `requestAttachment`'s consumer, and surfacing it to the window is
[#996](https://github.com/pyrycode/pyrycode-desktop/issues/996)'s own orchestrator, one layer up.

# Run-configuration read attribution correlation ([#1176](https://github.com/pyrycode/pyrycode-desktop/issues/1176))

A sixth correlation store, the `pendingSettings`/`pendingCreateFolders` shape rather than the
attachment legs' two-key or timer-backed ones: `pendingConfigRequests: Map<number, string>`, mapping a
sent `request_session_settings`' `envelopeId` to the conversation id that request named. It exists
because `SessionSettingsPayload` carries no conversation id at all — the reply is not "missing a field
that could disambiguate it," there is no candidate field on the wire, present or absent, and adding one
is a wire change out of scope under [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md).
The only place the fact "which conversation does this reply describe" exists is this client's own
memory of what it asked, which is exactly the `outstandingAnswers` rationale restated for a keyed
lookup instead of a FIFO — two outstanding requests can name different conversations, so shift-oldest
would misattribute the same way it would for `pendingSettings`.

- **Set — after the send, `pendingSettings`' order, not the attachment-retrieval leg's.** `envelopeId`
  is captured into ONE local, read by the builder and the `set` alike (so the id sent and the id
  recorded can never be two different expressions), and the map is written only *after*
  `driver.sendMessage` returns — a build/send throw leaves no entry under an unspent id, which matters
  here for the same reason it matters for `pendingSettings`: a phantom entry would answer whichever
  request next re-mints that id with the wrong conversation. An absent `conversationId` argument
  records `''`, which can never equal an open conversation, so it is fail-closed by construction rather
  than by a guard — unreachable in production today, since both renderer callers already refuse to send
  an unaddressable id before reaching this method.
- **Match + delete — inside `case 'session-settings':`, not the `daemon-error` tier.** This is the one
  correlation store in this file gating a **success** reply rather than a rejection: `inbound.inReplyTo
  === undefined` short-circuits before the map lookup (no event), a `pendingConfigRequests.get` miss
  short-circuits the same way (a stale reply from a cleared connection, a duplicate of an
  already-matched reply, or a daemon forging a snapshot for a request never sent), and a hit `delete`s
  the entry and emits `runConfigReceived` carrying the recorded conversation id — never the numeric
  `in_reply_to` itself, which stops here. Both silent branches: the only values a diagnostic could carry
  are the conversation id and the wire routing id, and neither may reach a sink (`emitDaemonEvent` is
  log-free by construction, matching the decode-side `session_settings` log's own content-free pin).
- **Reset — `dial()` clears the map next to `pendingSettings.clear()`.** A reconnect abandons every
  outstanding read request, which is what makes `nextEnvelopeId`'s restart-at-2 recycling safe for this
  store the same way it is for the other four.
- **No cap**, mirroring every sibling in this file — evidence-based, no observed unbounded-growth
  failure. Named explicitly as an accepted decision rather than an oversight: request volume here is
  partly daemon-driven (`createRunConfigRefreshTrigger` fires on each running→not-running `turn_state`),
  so a flapping daemon can inflate this map, but each entry is a number and a short string, created only
  *after* the encrypted frame build and socket write that necessarily precede it — this store is
  strictly cheaper than the request that populates it, so it adds no new vector. If a flapping daemon is
  ever observed, the debounce belongs in `subscribeRunConfigRefresh` ([Run configuration
  store](run-config-store.md)), not a cap here.
- **The renderer-side half of this fix is not in this module.** `subscribeRunConfig`
  (`runConfigSnapshot.ts`) drops a `runConfigReceived` naming anything but the open conversation before
  either of its two store writes — see [Run config store § Conversation-attributed since
  #1176](run-config-store.md#conversation-attributed-since-1176) for that half and for what this
  correlation does not reach (`sessionIdBridge`'s unsolicited `session_transition`, filed
  [#1192](https://github.com/pyrycode/pyrycode-desktop/issues/1192)).

`security-sensitive`, builder self-review **PASS**. `correlationRouter`'s `learn` also reads
`runConfigReceived.sessionId` to index session → server; an uncorrelatable reply now teaches it nothing
either, which is accepted as correct rather than a regression — a session id this client cannot tie to
a request it sent is exactly the input that index must not accept.

# Conversation-history correlation ([#1222](https://github.com/pyrycode/pyrycode-desktop/issues/1222))

A seventh correlation store, the `pendingConfigRequests` shape exactly: `pendingHistoryRequests: Map<number,
string>`, mapping a sent `request_history`'s `envelopeId` to the conversation id that request named. It
exists for the same reason `pendingConfigRequests` does — `HistoryPagePayload` carries no
`conversation_id` at all, not a field that could disambiguate it, so the only place "which conversation
does this page describe" exists is this client's own memory of what it asked. The one difference from
that sibling worth naming: a run-config read is one ask at a time in practice, where a scroll-back walk
is a *sequence* — [#1224](https://github.com/pyrycode/pyrycode-desktop/issues/1224) may have an ask
outstanding while the operator keeps scrolling — so more than one entry can legitimately be live at
once.

- **Set — after the send, `pendingConfigRequests`' order.** `envelopeId` is captured into one local,
  read by the build, the counter advance, and the `set` alike, and the map is written only *after*
  `driver.sendMessage` returns — a build/send throw leaves no entry under an unspent id, which matters
  here for the reason it matters everywhere in this file: a phantom entry would answer whichever
  request next re-mints that id, handing one conversation's transcript to another.
- **Match + delete — inside `case 'history-page':`, gating a success reply, not a rejection.**
  `inbound.inReplyTo === undefined` short-circuits before the map lookup (no event); a
  `pendingHistoryRequests.get` miss short-circuits the same way (a stale reply from a cleared
  connection, a duplicate of an already-matched page, or a daemon forging a page for a request never
  sent); a hit `delete`s the entry and emits `historyPageReceived` carrying the recorded conversation id
  — never the numeric `in_reply_to` itself. Both silent branches: the only values a diagnostic could
  carry are the conversation id and the wire routing id, and neither may reach a sink.
- **Match + delete — `case 'daemon-error':` gains a fourth precedence-tier member**, checked alongside
  `pendingSettings`/`pendingCreateFolders`/`pendingRetrievals`. A hit deletes the entry and emits
  `historyRequestFailed{conversationId, reason, retryable}`, where `reason` is
  `inbound.historyReject ?? 'unclassified'` — the daemon can refuse this verb with a code outside its
  own published five (an entry too large for any page draws a correlated `message.too_long` instead;
  see [Request history send § The reject path](request-history-send.md) for the sibling narrower this
  reads) — and `retryable` is computed **here, at this single emit**, `true` only for
  `'history-unavailable'`,
  so the walk driver ([#1224](https://github.com/pyrycode/pyrycode-desktop/issues/1224)) cannot
  re-derive it wrong into a retry loop against a relay that is merely withholding the frame. A match
  consumes the frame entirely, ahead of the reassembler/modal-FIFO fallbacks below it, on the same
  "an envelope id is minted once, so at most one store can hold it" reasoning every member of this tier
  shares.
- **Reset — `dial()` clears the map next to its siblings.** A reconnect recycles envelope ids from 2,
  so a surviving entry would attribute the new connection's first page to a dead one's conversation —
  a live misdelivery, not a theoretical one, given the recycling.
- **No cap**, the same evidence-based, no-observed-failure posture as every sibling store in this file.
  An entry costs one number and one short string, deleted on every match; the only way to accumulate
  them is this client sending asks a daemon never answers, a rate this client controls rather than a
  remote one.

`security-sensitive`, builder self-review **PASS**, no MUST FIX findings. See [Request history
send](request-history-send.md) for the full design, including the outbound builder, the fail-closed
decode, the sibling `HistoryRejectReason` narrower, and the two `DaemonEvent` arms this correlation
feeds.
