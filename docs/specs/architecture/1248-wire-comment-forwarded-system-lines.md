# 1248 — the wire comment says which claude system lines the daemon forwards today

## Files read

- `src/shared/wire/types.ts` → the doc comment above `UnrecognizedMessagePayload` — the only thing this
  ticket edits. Its "WHAT IT IS" paragraph carries the stale claim.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage`'s `default` arm — proves what this
  client does with a frame it has no case for (logs `inbound-unmodeled`, returns null); and
  `decodeHistoryEvent`'s doc, which already names `thinking_progress` / `rate_limited` as unparsed.
- pyrycode `internal/streamsup/parser.go` → `consumeLine`, `emitSystemSubtype`, `emitRateLimit` — the
  SSOT for what the daemon forwards. Read at `c43abb03` (2026-09-07).
- pyrycode `internal/protocol/codes.go` → `TypeThinkingProgress`, `TypeRateLimited` — the wire names the
  two unmapped subtypes arrive under.

## Design source

N/A — no UI surface; this is a doc comment in a shared wire type.

## Change

The comment's "WHAT IT IS" paragraph says the frame is *"deliberately NOT emitted for the types the
daemon knowingly ignores (`system/*`, `rate_limit_event`)"*. The unreachability half is still true, but
the two types hold it by different routes: `system` is the single member of `ignoredLineTypes`, so
`consumeLine`'s `default` returns before `emitUnrecognized` **by list membership** for any subtype,
while `rate_limit_event` is off that list with an arm of its own and so holds it **by matching**, which
the daemon documents as the stronger guarantee. What is false is the implication of "knowingly ignores",
which now reads as *ignores wholesale*. Measured 2026-09-07 against the daemon above:

- `emitSystemSubtype` maps five `system` subtypes to wire frames — `task_started`, `task_updated`,
  `background_tasks_changed`, `thinking_tokens`, and `init` (the model only; a model-less `init` is
  consumed silently). Every other subtype, `status` included, is still dropped silently.
- `consumeLine`'s `rate_limit_event` arm maps to `rate_limited` for any reading whose status is not
  `allowed`; `emitRateLimit` drops an `allowed`, statusless, or undecodable one.
- `conversation_reset`, `tool_progress` and `control_response` have their own arms. The first two are
  matchers that still emit this frame on a frame they cannot consume; `tool_progress` is suppression,
  not mapping.

Replace that sentence with a dated statement of the above, plus one line saying which of the six
resulting frames this client decodes: `background_task_started` / `_updated` / `_roster` and
`model_announced` have arms; `thinking_progress` and `rate_limited` do not and hit
`parseInboundMessage`'s `default`. The paragraph's opening count of top-level types ("three") goes with
it — `consumeLine` has seven arms now — and is replaced by an uncounted phrasing so it cannot go stale
the same way again.

Nothing else moves: no type, no behaviour, no test. The frozen per-ticket spec
`unrecognized-message-transport-and-render.md` records the state at its own date and stays as it is.

## Testing strategy

No new proof. `src/shared/wire/types.test.ts` already pins `UnrecognizedMessagePayload`'s shape and is
untouched by a comment edit; a comment carries no logic to assert. Gate is
`npm test -- src/shared/wire/types.test.ts`, `npm run build`, and `npm run check:docs` (named by the AC;
it scans `docs/knowledge/features/`, which this ticket does not touch).

## Revisions

**2026-09-07, rework 1.** Two factual corrections from the verifier's findings; no design change.

- The client's inbound switch is `parseInboundMessage`, not `parseInboundEnvelope` — a symbol that
  exists nowhere in the repo. Corrected in the Files read bullet, the Change paragraph, and the shipped
  comment.
- The daemon's "unreachable BY MATCHING rather than by list membership" phrase belongs to
  `rate_limit_event` (and to `control_response` / `tool_progress`), never to `system`, which is the sole
  `ignoredLineTypes` member and is exactly the list-membership case the phrase was coined to contrast
  with. The Change paragraph above and the shipped comment now state the two routes separately.
- Also took the verifier's NIT: `thinking_tokens` maps to `thinking_progress` only when its delta is
  positive and reaches the coalescing floor, so the bullet now names that condition the way the `init`
  and `rate_limit_event` bullets name theirs.
