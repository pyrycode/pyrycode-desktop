# #1619 — decode the daemon's `attachment_offered` frame into an inbound arm

## Files read

- `src/shared/wire/types.ts` → `EnvelopeType`, the attachment run (`attachment_chunk`,
  `attachment_stored`, `request_attachment`) — the new member joins that group, after
  `request_attachment`.
- `src/shared/wire/types.ts` → `ResettingPayload` — the docblock shape (SSOT, always-present fields,
  security posture) the new interface follows.
- `src/shared/wire/types.ts` → `ATTACHMENT_FILENAME_MAX_BYTES` — the existing 255-byte ceiling the
  decoder reuses rather than restating the number.
- `src/main/transport/inboundMessage.ts` → `parseResettingPayload` and the `resetting` case of
  `parseInboundMessage` — the template: `isRecord` gate, category-only `WireDecodeError`, fresh literal,
  narrow before logging, content-free `inbound-decoded` record.
- `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage` — the union gaining the arm. Arms
  without `FrameTimestamp` are the ones `decodeHistoryEvent` does not draw; this one joins them.
- `src/main/transport/inboundMessage.ts` → `requireString`, `parseAttachmentStoredPayload` — the
  field helpers; `requireString` admits `''`, so the emptiness checks are explicit.
- `src/main/transport/inboundMessage.ts` → the `Buffer.byteLength(value, 'utf8')` idiom already used
  for a byte-bounded string — the filename bound is measured the same way.
- `src/main/daemonConnection.ts` → the `case 'message'` handler in `createDaemonConnection` — catches
  every `parseInboundMessage` throw and returns, so a dropped frame never stops the next one. Its inner
  switch has no `assertNever`, so a new, unconsumed kind compiles and stops there.
- `src/main/attachmentUpload.test.ts` → `UUID_V4` — the same pattern as a test constant only.
- `src/shared/ipc/commands.ts` → `isAttachmentIdList`; `src/main/attachmentPath.ts` →
  `CANONICAL_ATTACHMENT_ID` — both looser than the UUIDv4 rule; neither is reused (see Design).
- `docs/specs/architecture/1514-resetting-decode.md` — the analogue's plan.

In-flight overlap: `feature/1544` also edits `src/main/daemonConnection.test.ts`. Not a dependency —
this ticket appends one independent test there.

## Design source

N/A — wire decode only; nothing is drawn.

## Context

The daemon emits `attachment_offered` when claude calls `send_file` (pyrycode#2165, #2166). The desktop
drops it today in `parseInboundMessage`'s `default:` arm. This slice adds the wire type and the
live-lane decode arm only; the IPC carry and the render are later tickets.

## Design

**Wire (`src/shared/wire/types.ts`)**

- `EnvelopeType` gains `'attachment_offered'`, placed after `'request_attachment'`, with a comment
  naming the SSOT (pyrycode `docs/protocol-mobile.md` § Attachments) and the direction (daemon → client,
  broadcast to every attached client).
- New `AttachmentOfferedPayload { conversation_id: string; attachment_id: string; filename: string }`,
  wire order as listed, all three always present. Docblock states: `conversation_id` is a
  daemon-asserted routing key consumers filter on; `attachment_id` is daemon-minted and must be the
  lowercase UUIDv4 shape; `filename` is claude-authored display text, ≤ 255 UTF-8 bytes, never a path
  and never logged.

**Decode (`src/main/transport/inboundMessage.ts`)**

- Module-private `ATTACHMENT_ID_UUID_V4` regex:
  `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` (no `i` flag, so uppercase
  fails). Kept private to the decoder: it is the first production check of this shape, and the two
  looser guards serve different purposes (non-empty list check, path-safety alphabet). Tightening them
  is not this ticket.
- `parseAttachmentOfferedPayload(payload: unknown): AttachmentOfferedPayload` — throws
  `WireDecodeError` with a category-only message (never interpolating a value) when: the payload is not
  a record; any field is absent or not a string (`requireString`); `conversation_id === ''`;
  `attachment_id` fails the regex; `filename === ''` or `Buffer.byteLength(filename, 'utf8') >
  ATTACHMENT_FILENAME_MAX_BYTES`. Returns a fresh three-field literal (extras tolerated, never copied).
- `InboundDaemonMessage` gains `{ kind: 'attachment-offered'; attachmentOffered:
  AttachmentOfferedPayload }` — no `FrameTimestamp`, as the frame is live-only.
- `parseInboundMessage` gains `case 'attachment_offered'`: parse first, then log
  `{ event: 'inbound-decoded', code: 'attachment_offered', bytes, hash }`, then return the arm. No
  decoded field is logged. The ticket allows a validated attachment id in the log; it is left out
  because nothing needs it yet and it would add a `DiagnosticEvent` field.
- `decodeHistoryEvent` gets no arm; a stored `attachment_offered` falls to its existing skip.

## State + concurrency model

None. The decoder is a pure function over one plaintext; no store, no async work.

## Error handling

Every rejection throws `WireDecodeError` inside `parseInboundMessage`. `createDaemonConnection`'s
`message` handler already catches it and returns, so the frame is dropped with no event and no log
record, and the next frame is processed normally. No new handling is needed at the consumer.

## Testing strategy

Vitest, node environment, in `src/main/transport/inboundMessage.test.ts` beside the `resetting` blocks:

- Recognition: a well-formed frame decodes to `{ kind: 'attachment-offered', attachmentOffered }`
  with exactly the three fields; no `ts`; extra keys tolerated and not copied; a 255-byte multibyte
  filename is accepted at the boundary.
- Fail-closed (AC2), each throws `WireDecodeError`: payload not an object (string, array, null); each
  field absent, `null`, or a non-string; `conversation_id: ''`; `attachment_id` uppercase, v1 version
  nibble, bad variant nibble, no hyphens, `''`; `filename: ''`; `filename` at 256 bytes, including a
  multibyte string whose character count is under 255.
- Error messages carry neither the filename nor the conversation id.
- Logging (AC3): accept path writes one `inbound-decoded` record with exactly the content-free key set,
  containing neither the filename nor the conversation id; drop path writes no record at all.
- History: `attachment_offered` is added to the stored-type skip list, plus a well-formed-payload skip.

In `src/main/daemonConnection.test.ts`, one test for AC2's "keeps processing": a malformed
`attachment_offered` followed by a well-formed `message` frame emits exactly the message event and
does not throw.

No Playwright spec: there is no user-driven transition.

## Documentation handoff

The ticket has no Documentation handoff section. Pending for the documentation stage: the
`docs/knowledge/features/` overview owning the inbound decoder may note the new arm and the first
production UUIDv4 check.

## Open questions

- None blocking. If the build shows an exhaustive switch over `InboundDaemonMessage` elsewhere, the
  new kind gets a no-op branch there and a `## Revisions` entry.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. The frame crosses from the decrypted Noise payload into typed main-process
  data at exactly one function, `parseAttachmentOfferedPayload`, reached only through
  `parseInboundMessage`. Narrowed is not trusted. All three fields remain peer claims: a hostile daemon
  can name any conversation and any well-shaped id. The payload docblock says so, so a later consumer
  does not read `conversation_id` as authorization or `attachment_id` as proof the bytes exist.
- [Trust boundaries] SHOULD FIX (Phase B). The UUIDv4 regex must be anchored and case-sensitive. JS `$`
  without the `m` flag matches only at end of input, so a trailing `\n` is rejected. A test pins
  uppercase, a trailing newline and a leading space, so nobody can loosen the check with an `i` or `m`
  flag unnoticed. The pattern has fixed-width quantifiers and no nesting, so it cannot backtrack
  catastrophically.
- [Tokens] No findings. The frame carries no credential, and this slice creates or stores no token.
- [File / storage] No findings for this slice. `filename` is not used as a path, joined, or written
  anywhere. The decoder only measures it. `attachment_id` passes a stricter shape than
  `CANONICAL_ATTACHMENT_ID`, but any later retrieval that builds a path from it must still go through
  that existing path guard. Passing this decoder does not replace it.
- [Electron attack surface] No findings. No IPC channel, bridge API, window or protocol handler is
  added. The arm stops in main (`createDaemonConnection` has no branch for it).
- [Crypto] No findings. No primitive is touched. The log record's hash is the existing one-way
  `hashPlaintext`.
- [Network & I/O] No findings. Frame size is already capped upstream of the decoder by the existing
  plaintext ceiling. The filename bound (255 UTF-8 bytes, `Buffer.byteLength`) is checked after the
  JSON parse. That is linear in a string the envelope cap already bounds. A lone surrogate counts as
  3 bytes, so the measure cannot under-count.
- [Logs] No findings as designed. The accept path logs only the static `code` literal plus bytes and
  hash, not the wire-supplied `envelope.type` or any decoded field. The drop path throws before
  logging. `WireDecodeError` messages name the category only, and `createDaemonConnection` discards
  them. Tests assert that the filename and conversation id are absent on both paths and in the error
  message.
- [Concurrency] No findings. The decoder is a pure, synchronous function with no owned work.
- [Threat model — hostile daemon / claude-authored text] OUT OF SCOPE, deferred to the render slice of
  the \#1617 family. `filename` may contain control characters, bidi overrides (an RLO spoofing an
  extension), path separators or NUL. The decoder deliberately does not sanitize display text, and
  the ticket defines no such rule. The render ticket must bound and neutralize it for display and must
  never put it in an attribute, a URL, a filename or a log, as the repo's CLAUDE.md requires.
- [Threat model — broadcast] OUT OF SCOPE, deferred to the IPC-carry slice of the \#1617 family. The
  frame reaches every attached client, and filtering on `conversation_id` is the consumer's job.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-24
