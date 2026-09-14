# 734 — retire the expired drop claims in the inbound decode doc block

Comment-only. Four paragraphs of the leading TSDoc block on `InboundDaemonMessage` still
describe a consumer that drops a field `daemonConnection` carries today. Nothing executable
moves.

## Files read

- `src/main/transport/inboundMessage.ts` → the leading doc block on `InboundDaemonMessage` —
  the only file this ticket edits. Its `stall` (#732), `api-retry` (#737) and
  `model-announced` (#714) paragraphs are the replacement idiom the four stale ones must
  follow: carried onward by name as `conversationId`, the widening ticket cited, and a
  sentence on why the id crosses.
- `src/main/daemonConnection.ts` → the `assistant-delta`, `turn-end`, `turn-state`,
  `session-transition`, `modal-shown` and `modal-dismissed` arms of the inbound switch — the
  `emitDaemonEvent` literals are the ground truth each paragraph is being corrected against.
  Each arm's own comment already names its widening ticket.
- `src/shared/ipc/events.ts` → the `turnState` arm's comment, which supplies the clause AC2
  asks for (a daemon-asserted routing key, not rendered text); also the `assistantDelta`,
  `turnEnd`, `sessionTransition` and `modalShown` arms, whose comments give the same clause in
  each kind's own terms, and line-adjacent precedent for "Only `previous_session_id` is dropped
  at the emit (#285) — it has no consumer".
- `src/shared/wire/types.ts` → `SessionTransitionPayload` — six fields, not five. The stale
  paragraph's "the other four decoded fields" was written against the pre-#1192 shape.

Codegraph is not initialized in this worktree (`.codegraph/` is present but empty;
`codegraph_context` returns "CodeGraph not initialized for this project"), so the reading list
above came from Grep and Read.

## Design source

N/A — no UI surface. The diff is prose inside a TSDoc block in the main process.

## Change

Four paragraphs are rewritten in place, each keeping its fail-closed sentence verbatim and
each gaining what the `stall` / `api-retry` / `model-announced` paragraphs already carry:

1. **`assistant-delta` / `turn-end`.** "carries it onward (dropping only `conversation_id`)"
   becomes: carried onward by name as `conversationId`, #751 for the delta and #752 for the
   turn end. Unlike the status kinds, the "turn-stream item, or daemon state?" test answers
   *turn-stream item* here and the id crosses anyway — a slice of assistant text and the
   boundary that closes it have to be filed in the right thread (#675). Verified against the
   two `emitDaemonEvent` literals, which both name `conversationId`.
2. **`turn-state`.** "carries only `state` onward (dropping `conversation_id`)" becomes:
   `state` plus `conversationId` (#724), because per-conversation phase is daemon state
   (#674). AC2's clause is added here — the id is a daemon-asserted routing key rather than
   rendered text, never markup, an attribute, a URL, a filename, a cache key or a lookup path
   — matching the `turnState` arm's comment in `events.ts`.
3. **the two modal kinds.** "decoded here, then dropped at the emit until #871 carries it
   across IPC" becomes: carried onward as `conversationId` (#871), an outbound scoping key and
   not a correlation key (answering still goes by `modalId`). The contrast the old sentence
   implied is kept as a statement of fact: `modal_dismissed` carries no `conversation_id` and
   none is invented for it.
4. **`session-transition`.** "carries ONLY `new_session_id` onward (dropping the other four
   decoded fields — the #180 content-drop model)" becomes: five of the *six* decoded fields
   cross — `newSessionId` / `reason` / `occurredAt` / `workspaceCwd` (#285) plus
   `conversationId` (#1192) — and only `previous_session_id` is dropped, for want of a
   consumer. `workspace_cwd`'s "decoded but dropped at the emit" becomes carried as
   `string | null` with the null preserved rather than coerced. The `#180 content-drop model`
   citation goes with the claim it justified.

Nothing else in the block moves. The `DecodedHistoryEvent` block further down is correct and
is left alone, and so are the block's several "Ships dormant — #NNN is the first consumer"
claims, which the ticket scopes out as their own work.

## Testing strategy

No new proof. The diff touches no executable line, no test assertion and no test name — the
four paragraphs are TSDoc prose, and nothing in `src/` asserts their wording (checked: the
stale phrases appear only in this one block). The existing round-trip and emit tests over
`daemonConnection`'s arms are what pin the behaviour the prose now describes; they are the
reason these claims were falsifiable in the first place. `npm run build` and the
`inboundMessage` / `daemonConnection` / `events` unit tests are the gate, proving the block
still parses as a comment and the surrounding types are untouched.

## Documentation handoff

Pending for the documentation stage — the builder does not edit these files. The same expired
claims exist in two package overviews, to be corrected in each file's own idiom
(`daemon-connection.md` records a widening as a correcting clause appended to the original
change-log entry, per the #315→#732 and #587→#714 entries, rather than rewriting history):

- `docs/knowledge/features/inbound-message-decode.md`, the `#254` change-log entry: "The
  consumer arm … drops four of the five decoded fields at the emit" — false since #285.
- `docs/knowledge/features/daemon-connection.md`, the `#214` entry ("`conversation_id`
  dropped, `state` carried"), the `#492` entry ("the only field this arm does drop") and the
  `#495` entry ("`conversation_id` dropped, the only field this arm drops") — false since
  #724, #737 and #730 respectively, and each missing the correcting clause its neighbours
  carry.

## Open questions

- Whether the modal paragraph's "BOTH renderer bridges no-op these arms" is still accurate.
  It is not a drop claim, so it is out of this ticket's scope and is left verbatim; the
  `events.ts` `modalShown` comment suggests the modal bridge (#223) is a third, separate
  subscriber and the sentence still reads true. Resolved: no change.

## Security review

**Verdict:** PASS

**Findings:**

1. **[Trust boundaries] No findings — verified, not assumed. This is the ticket's whole hazard
   class.** The diff rewrites, across six arms, the claims about whether a daemon-asserted
   routing key crosses the IPC boundary — precisely the failure #764's finding 3 records: a
   sweep of this doc-block family that asserts a routing key crosses where it does not, in the
   file a reader consults to learn exactly that, failing silently with `tsc` green and the
   suite green. Neither gate this work passes can catch a false trust-boundary claim in a
   comment. So every claim was checked against the `emitDaemonEvent` literal by name, never
   inferred from the neighbouring arm comment: `assistant-delta` →
   `conversationId: inbound.delta.conversation_id`; `turn-end` → `inbound.turnEnd.conversation_id`;
   `turn-state` → `inbound.turnState.conversation_id`; `modal-shown` →
   `inbound.modalShown.conversation_id`; `session-transition` → the five named fields, with
   `previous_session_id` absent from the literal. The direction that matters is the
   false-positive one, and the two NEGATIVE claims were checked against the wire type rather
   than the emit alone: `SessionTransitionPayload` has six fields (so "five of the six cross,
   only `previous_session_id` is dropped" is exact), and `ModalDismissedPayload` declares no
   `conversation_id` at all, so "a `modal_dismissed` carries none and none is invented for it"
   is true at the type as well as at the emit.

2. **[Trust boundaries, second aspect] No findings — the new fail-closed assertions are true
   AND test-pinned.** This is the one way a comment-only diff can manufacture a security claim
   from nothing, and it did: three assertions here are not drop-claim retirement but NEW claims
   about validation strength — the delta/turn-end "both parsers require `conversation_id`, so
   each emit reads it BARE"; `turn-state`'s "the required `conversation_id` string beside it
   fails the whole line rather than emitting a phase attributed to nothing"; and
   `session-transition`'s `workspace_cwd` "carried onward as `string | null` with the null
   PRESERVED rather than coerced". Each verified at the source: `parseAssistantDeltaPayload`,
   `parseTurnEndPayload` and `parseTurnStatePayload` all take `conversation_id` through
   `requireString`, which throws `WireDecodeError`; the `session-transition` emit copies
   `workspace_cwd` by name with no coercion. They are also pinned executably —
   `inboundMessage.test.ts` carries per-kind `throws when conversation_id is absent or a
   non-string` specs — so a future relaxation of `requireString` reddens the suite instead of
   silently falsifying the prose.

3. **[Trust boundaries, third aspect] No finding — a deliberate partial import, recorded so the
   next sweep does not "repair" it.** AC2 requires the `turn-state` paragraph to classify the
   id as a daemon-asserted routing key rather than rendered text, matching the `turnState` arm
   in `events.ts`. There, and on `daemonConnection`'s `thinking-progress` / `rate-limited` arms,
   that classification always travels with a second clause: *and it reaches no log sink
   (`emitDaemonEvent` is log-free by construction)*. This rewrite imports the display half and
   not the log half. That is correct here on two grounds: the in-block idiom AC1 names as the
   template (`stall` #732, `api-retry` #737) carries neither clause, and `inboundMessage.ts`
   already asserts the no-log property where it is enforceable — at the `diagnosticLog?.event`
   call sites, which narrow before logging and state "No decoded field (state /
   conversation_id) is logged — only the frame's byte length". Restating it in prose far above
   the sink would create a second copy to go stale, which is the exact failure this ticket
   exists to retire.

4. **[Tokens, secrets, credentials] N/A by design decision.** The only field whose treatment
   changes is `conversationId`, classified upstream as a routing key, not a secret. No token,
   key, Noise transcript or raw frame appears in any rewritten paragraph, and none is created,
   stored or moved. `new_session_id` rides the same convention the `session-transition` arm
   already records — a session id is a routing id, not a secret.

5. **[File / storage operations] N/A by design decision.** No path is constructed, read or
   written. Verified mechanically rather than asserted: every changed line in the diff matches
   `^[+-] \* `, so the change adds zero executable lines.

6. **[Inter-process / Electron attack surface] No findings.** No `contextBridge` API, no
   `ipcMain` channel, no `webPreferences` value and no `DaemonEvent` union member is added or
   altered — the IPC shape is frozen by the comment-only constraint. The prose now describes
   the arms `events.ts` already declares, and the two files were cross-read for agreement
   rather than edited toward each other.

7. **[Cryptographic primitives] N/A by design decision.** No RNG, no comparison, no key or
   nonce handling and no Noise-adjacent code is within the diff's reach.

8. **[Network & I/O] N/A by design decision.** No socket, frame-size cap, timeout or URL is
   touched. The fail-closed decode the prose describes is upstream and byte-identical before
   and after.

9. **[Error messages, logs, telemetry] No findings — verified, not assumed.** Checked directly:
   no log call in `inboundMessage.ts` references `conversation_id`. The decode log sites narrow
   BEFORE logging, so a malformed frame throws and leaves no record, and they record only the
   frame's byte length. The diff adds no sink, no log call and no error string.

10. **[Concurrency] N/A by design decision.** No async task, listener, timer or
    `AbortController` is added or removed; there is no executable line in the diff.

11. **[Threat model alignment] Addressed, with one item OUT OF SCOPE and named.** *Hostile
    daemon response* is the applicable threat: something inside the Noise session controls
    every `conversation_id` these paragraphs describe. The rewrite's net effect is to document
    rather than weaken the constraint on it — each affected kind rejects a missing or
    non-string id at the parse, and finding 2 pins that. *Renderer compromise reaching the
    transport* is unaffected: process placement is unchanged and no field crosses that did not
    cross before this diff was written. OUT OF SCOPE, named: the block's several "Ships dormant
    — #NNN is the first consumer" claims, which the ticket assigns to their own ticket, and the
    two package overviews carrying the same expired claims, which belong to the documentation
    stage (see § Documentation handoff).

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-14

## Revisions

**2026-09-14 — `## Security review` added (verifier finding on PR #1434, rework leg 1).**

#734 carries the `security-sensitive` label, and the plan as first committed (`3c4d554`) had
no `## Security review` section, so the design shipped unaudited. The verifier stopped at that
gate and raised it as the single MUST FIX, making no claim about the diff itself. The pass
above closes it; nothing in the Change section moved, and no code was patched in response —
the gap was in the plan's review pass, not in the implementation.

One honest note on ordering. The checklist's normal flow is review → commit plan → implement,
and here the review ran after the implementation commit (`2bcfde0`), because the label's gate
was missed on the first leg. That inverts the pass's usual evidence base in one direction
only: the review above could verify each claim against the `emitDaemonEvent` literals, the
wire types and the existing decode-reject tests as they actually stand, rather than against a
design sketch. Findings 1, 2 and 9 are verifications of the shipped diff, not predictions
about it. The verdict would not have differed — no finding required a design change — but the
audit is of code that already exists, and it should be read as such.
