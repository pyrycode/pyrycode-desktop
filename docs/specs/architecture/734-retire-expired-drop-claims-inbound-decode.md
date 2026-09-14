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
