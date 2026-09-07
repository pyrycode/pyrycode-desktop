# Daemon connection — request correlation and diagnostics

How a reply is matched back to the request that asked for it, one section per correlated round trip, plus the diagnostic logging around them.

Part of [Daemon connection](daemon-connection.md); see that document for what the package does, its edge cases and its links.

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

# Modal-answer rejection correlation ([#248](../codebase/248.md))

A small correlation state machine now lives here too, module-local alongside `nextEnvelopeId`/`reassembler`: `outstandingAnswers: string[]`, a FIFO of `modal_id`s whose `modal_answer` ([#236](../codebase/236.md)) is awaiting the daemon's reply. It exists because the daemon `error` reporting a rejection (an ungranted device; [#237](../codebase/237.md)'s optimistic clear) carries **no** `modal_id` (ADR 0009) — the only way to attribute it is the client's own memory of what it recently sent.

- **Push** — `answerModal` appends the answered id *after* `driver.sendMessage` succeeds; a failed send records nothing.
- **Shift** — `case 'daemon-error':` dequeues the oldest id and emits `modalAnswerRejected{modalId}` iff the queue is non-empty; `reassembler?.fail('daemon-error')` stays first, unchanged. The two `daemon-error` consumers are independent and can both fire on the rare bundle+answer overlap — documented, not defended, since the content-free `error` has no way to disambiguate.
- **Drain** — `case 'modal-dismissed':` removes the matching id, so an accepted answer can't later mis-attribute an unrelated `error`.
- **Reset** — `dial()` clears the queue next to `nextEnvelopeId = 2`; a fresh connection starts with no correlation window. The supervisor's own *automatic* transient-drop reconnect (§ Reload-per-dial) does **not** call `dial()`, so it does not clear it — a stale entry ages out via the next real reply/dial, a bounded single false-attribution, deliberately left open (see [#248 codebase notes](../codebase/248.md) § Open questions).

# Set-session-settings confirmed-round-trip correlation ([#261](../codebase/261.md))

A second, parallel correlation store lives here, module-local alongside `outstandingAnswers`:
`pendingSettings: Map<number, string>`, mapping a sent request's `envelopeId` to the renderer-minted
`changeId` it carried. It exists because a `session_settings_updated` reply carries only `session_id`,
not which pending change it confirms — the daemon's `Envelope.in_reply_to = request.id` is the only
routing hook, and correlation must be looked up, not scanned FIFO (unlike modal answers, two outstanding
changes can target the **same** `session_id`, so shift-oldest would misattribute).

- **Set** — `setSessionSettings` captures `envelopeId = nextEnvelopeId` before building, and only *after*
  a successful `driver.sendMessage` calls `pendingSettings.set(envelopeId, changeId)` — the
  `outstandingAnswers.push`-after-send order, so a build/send throw leaves no phantom entry.
- **Match + delete** — `case 'session-settings-updated':` reads `inbound.inReplyTo`; `undefined` or a
  `pendingSettings.get` miss short-circuits with **no event** (fail-closed, AC3); a hit `delete`s the
  entry and emits `{ type: 'sessionSettingsUpdated', sessionId, changeId }`.
- **Reset** — `dial()` clears the map next to `outstandingAnswers.length = 0` (AC5): a reconnect abandons
  every outstanding change, so a stale reply from a dead session can never correlate on the reconnected
  one — this is what makes `nextEnvelopeId`'s restart-at-2 recycling safe.
- **Orphans (closed by [#269](../codebase/269.md))** — a **rejected** change produces a `daemon-error`,
  not a `session_settings_updated`; under #261 alone its `pendingSettings` entry was not removed until
  `dial()`. #269 (below) removes it via the error path's own `in_reply_to`, so the map now has no orphan
  window at all. No cap, mirroring `outstandingAnswers` (#248) — evidence-based, no observed
  unbounded-growth failure.

# Set-session-settings rejected correlation ([#269](../codebase/269.md))

The rejected half on the **same** `pendingSettings` map + `changeId` key, keyed off `case 'daemon-error':`
instead of `case 'session-settings-updated':`. Before this ticket that case had two unconditional
consumers — the bundle [reassembler](debug-bundle-reassembly.md)'s `fail('daemon-error')` and the #248
modal-answer FIFO's `outstandingAnswers.shift()`. This ticket inserts a **precedence gate in front of
both**:

- **Correlate first.** `inbound.inReplyTo` (widened onto the `daemon-error` kind by this ticket, see
  [inbound message decode](inbound-message-decode.md)) is looked up in `pendingSettings` before either
  existing consumer runs.
- **Match — consume the frame entirely.** `pendingSettings.delete(inReplyTo)` (closing the orphan #261
  left open, see above), emit `{ type: 'sessionSettingsRejected', changeId }`, then `return` — **both**
  `reassembler?.fail` and the modal FIFO `shift` are skipped. An error correlated by a unique per-request
  envelope id is unambiguously the reply to *that* request, so it can be neither a bundle error nor a
  modal-answer rejection; skipping both is correctness, not a tradeoff (unlike the #248 bundle+answer
  double-fire, which *is* an accepted tradeoff because the content-free error there truly cannot
  disambiguate).
- **No match — unchanged fall-through.** An absent `inReplyTo`, a stale id, or a hostile daemon forging a
  rejection for a change never dispatched falls through to the two existing consumers exactly as before
  this ticket — a bundle in flight still fails, an outstanding modal answer is still rejected.

The emitted event carries **only** the client's own `changeId` — never a field read from the untrusted
`error` payload (no code, no message, no `in_reply_to`). `security-sensitive`, code review **PASS**, no
findings.

# Create-workspace-folder rejected correlation ([#396](../codebase/396.md))

A fourth correlation store lives here, module-local alongside `outstandingAnswers`/`pendingSettings`:
`pendingCreateFolders: Set<number>` — envelope ids of outstanding `create_workspace_folder`
([#381](../codebase/381.md)) requests. Unlike `pendingSettings` (a `Map`, since `sessionSettingsRejected`
carries a `changeId`), the emitted event is **bare**, so only membership matters — a `Set` suffices.
Unlike `outstandingAnswers` (a FIFO, used only when the reply carries no discriminating id at all), a
`create_workspace_folder` request has a unique per-request envelope id, so a keyed set beats a FIFO here.

- **Set** — `createWorkspaceFolder` captures `envelopeId = nextEnvelopeId` before building (the
  `setSessionSettings`/#269 order) and, only after a successful `driver.sendMessage`, calls
  `pendingCreateFolders.add(envelopeId)` — a build/send throw leaves no phantom entry.
- **Match + delete — same tier as `pendingSettings`.** `case 'daemon-error':` checks
  `pendingCreateFolders.has(inReplyTo)` alongside the `pendingSettings` check, inside the existing
  `inReplyTo !== undefined` guard. A match `delete`s the entry, emits `{ type: 'workspaceFolderRejected' }`
  (bare — no field read from the untrusted payload), and `return`s **before** both
  `reassembler?.fail('daemon-error')` and the `outstandingAnswers.shift()` modal FIFO — the same
  precedence #269 established, since an envelope id is minted once and can be held by at most one of the
  two sets.
- **Reset** — `dial()` clears the set next to `pendingSettings.clear()`: a reconnect abandons every
  outstanding create-folder request, so a stale envelope id from a dead session can never correlate on
  the reconnected one.
- **No match — unchanged fall-through.** An absent `inReplyTo`, a stale id, or a hostile daemon forging a
  rejection for a request never dispatched falls through to the existing bundle/modal tier exactly as
  before this ticket.

Bare by design (stronger than `sessionSettingsRejected`'s `changeId` or `modalAnswerRejected`'s
`modalId`): only one create-folder dialog is ever open, so there is no concurrency to disambiguate and no
field can hold a daemon-supplied byte. `security-sensitive`, code review **PASS**, no findings. Ships
dormant — all three exhaustive renderer bridges no-op the new arm; the real consumer is the not-yet-built
[#397](https://github.com/pyrycode/pyrycode-desktop/issues/397) round-trip store.

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
