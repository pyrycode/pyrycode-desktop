# Daemon connection — request correlation and diagnostics

How a reply is matched back to the request that asked for it, one section per correlated round trip, plus the diagnostic logging around them.

Part of [Daemon connection](daemon-connection.md); see that document for what the package does, its edge cases and its links.

This map holds the correlation stores small enough to stay in place. The larger ones split out by
size: [request/history/attachment correlations](daemon-connection-correlation-requests.md) (diagnostic
logging, create-conversation, attachment upload/retrieval, run-configuration read attribution,
conversation history) and [system-prompt and MCP-status
correlations](daemon-connection-correlation-system-prompt-and-mcp.md) (system-prompt read/write,
workspace renaming, MCP-status request).

# Modal-answer rejection correlation ([#248](../codebase/248.md))

Permission lifecycle diagnostics use static event names only: `modal-shown`, `modal-dismissed`,
`modal-answer-rejected`, `modal-answer-sent` and `modal-cancel-sent`. Answer/cancel failures emit
`modal-answer-failed` / `modal-cancel-failed` with `code: 'unavailable'` for a null driver or
`code: 'send-failed'` for a build/send exception. These records carry no IDs, answer tokens, labels,
prompt text or caught error objects. The `daemonConnection.test.ts` capture checks the exact records
for successful and throwing sends and asserts that private fixture content never appears in the log.
A sent record reports the transport call returning; it is not evidence that the daemon accepted the
answer. See the [permission panel](conversation-shell-permission-modal.md) for optimistic removal and
subsequent rejection feedback.

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
