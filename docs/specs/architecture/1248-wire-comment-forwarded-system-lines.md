# 1248 — the wire comment says which claude system lines the daemon forwards today

## Files read

- `src/shared/wire/types.ts` → the doc comment above `UnrecognizedMessagePayload` — the only thing this
  ticket edits. Its "WHAT IT IS" paragraph carries the stale claim.
- `src/main/transport/inboundMessage.ts` → `parseInboundEnvelope`'s `default` arm — proves what this
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
daemon knowingly ignores (`system/*`, `rate_limit_event`)"*. The unreachability half is still true, and
still true **by matching** rather than by list membership — but "knowingly ignores" now reads as
*ignores wholesale*, and that is false. Measured 2026-09-07 against the daemon above:

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
`parseInboundEnvelope`'s `default`. The paragraph's opening count of top-level types ("three") goes with
it — `consumeLine` has seven arms now — and is replaced by an uncounted phrasing so it cannot go stale
the same way again.

Nothing else moves: no type, no behaviour, no test. The frozen per-ticket spec
`unrecognized-message-transport-and-render.md` records the state at its own date and stays as it is.

## Testing strategy

No new proof. `src/shared/wire/types.test.ts` already pins `UnrecognizedMessagePayload`'s shape and is
untouched by a comment edit; a comment carries no logic to assert. Gate is
`npm test -- src/shared/wire/types.test.ts`, `npm run build`, and `npm run check:docs` (named by the AC;
it scans `docs/knowledge/features/`, which this ticket does not touch).
