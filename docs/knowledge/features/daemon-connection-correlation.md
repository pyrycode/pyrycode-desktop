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
