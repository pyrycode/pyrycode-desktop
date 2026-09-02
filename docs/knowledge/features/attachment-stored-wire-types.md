# Attachment-stored wire types

The **consumer half** of the daemon's attachment wire contract: one `EnvelopeType` member,
`AttachmentStoredPayload`, and the fail-closed decode that turns the upload's success reply into a
typed [inbound message](inbound-message-decode.md) arm.

Introduced in [#964](https://github.com/pyrycode/pyrycode-desktop/issues/964), split from #961. SSOT is
`pyrycode/pyrycode` `docs/protocol-mobile.md` § Attachments plus `internal/protocol/attachments.go`
(`AttachmentStoredPayload`) and `codes.go` (`TypeAttachmentStored`) — declared by pyrycode#1895, emitted
by #1897, observed end-to-end by #1898, all three landed 2026-09-02. **Read that section's shape prose,
not its status prose**: § Attachments still says "nothing emits it yet" in places, a sentence #1895's own
commit wrote and that went stale hours later when #1897 landed; the field and correlation rules are
current, the status sentences are not.

## What it does

An attachment upload is a multi-frame transfer. [Attachment chunk envelope](attachment-chunk-envelope.md)
(#860) is the producer half — `attachment_chunk`, riding both legs. This slice is the answer: the single
positive terminal for the *whole* transfer, not a report that the storage step alone succeeded. Before it,
`parseInboundMessage` fell through to its content-free catch-all on this frame and every upload resolved
into silence indistinguishable from an unmodelled type.

```ts
// src/shared/wire/types.ts
export type EnvelopeType =
  | …
  | 'attachment_chunk'
  | 'attachment_stored'   // binary → client only; the whole difference from attachment_chunk
  | …

export interface AttachmentStoredPayload {
  attachment_id: string
}
```

```ts
// src/main/transport/inboundMessage.ts
export type InboundDaemonMessage =
  | …
  | { kind: 'attachment-stored'; attachmentStored: AttachmentStoredPayload }
```

One key, wire order, no `omitempty` daemon-side — mirrors the Go struct field for field. The daemon pins
the key set with a two-sided wire-key test (`TestAttachmentStoredPayload_WireKeys`), so the absences below
are checked upstream rather than reviewed here.

## How it works

**Exactly one field, and every other candidate is a deliberate absence.** No `size`, `sha256`,
`total_chunks`, `filename` or `conversation_id` — the client sent all of those on the upload leg and they
were checked against the assembled bytes before this frame could be emitted, so echoing them back confirms
nothing a client could act on. No host path or on-disk filename either: a success frame carrying one would
undo, from the other side, the disclosure mitigation `attachment.storage_failed` already carries by
withholding the host path on failure. Do not add any of them "for clarity."

**Correlation is the subtle part, and it is the whole reason this arm exists as designed.** The frame is a
reply carried by the envelope's `in_reply_to` — but that field names **the chunk whose arrival completed
the transfer**, not the chunk with the highest index. Chunks are index-addressed and may be reassembled in
any order, so which envelope id closes the set is not something a client can predict; every other chunk of
a healthy upload gets **no reply at all**. That is precisely why the payload also carries `attachment_id`:
the envelope field says which frame this answers, the payload says which transfer it concludes, and only
the second is a value the client chose and can look up.

**`InboundDaemonMessage`'s `attachment-stored` arm deliberately carries no `inReplyTo`.** Three existing
kinds do — `daemon-error`, `session-settings`, `session-settings-updated` — because for those the envelope
id *is* the correlation. Here it is not, for the reason above, so surfacing it would hand a consumer a
plausible-looking match key that silently never fires. Omitting it makes "match on `attachment_id`"
structural rather than advisory — the only correlation handle a consumer can reach is the one that works.
A future consumer that wants the envelope id anyway must argue for it on its own ticket.

**The decode — `parseAttachmentStoredPayload`.** The shape of `parseQuestionDismissedPayload` minus two
fields: an `isRecord` guard, one required field, a fresh one-field literal returned so unknown
server-added keys are tolerated (forward-compat) but never copied through — which also keeps the narrower
prototype-pollution-safe, since it builds no container from the decoded value.

**The one field goes through a new helper, `requireNonEmptyString`, not `requireString` — the single
interesting line in the decode.** `requireString` polices type and accepts `''`, correct at every existing
call site and load-bearing on at least one (an empty `argument_hint` is ordinary data on 33 of the 51
measured `slash_command_list` rows). It is wrong here because every key is optional to Go's
`encoding/json`: a truncated or hostile `attachment_stored` decodes daemon-side to the zero value and
arrives as `{"attachment_id": ""}`. Through `requireString` that is a **success naming no transfer** — the
exact failure mode this decode exists to reject. `requireNonEmptyString` is a sibling of `requireString`,
never a replacement, and its own doc block names the two arms (`slash_command_list`'s `argument_hint`,
`question_dismissed`'s all-empty payload) where the empty string is a value, so it is not later swapped in
"for consistency" and silently fail-closes valid traffic there.

**Narrow before log.** The switch arm calls the parser first, so a malformed frame throws and leaves no
diagnostic record — the file's standing rule since [#130](../codebase/130.md). The success path emits the
existing four-field content-free record (`event: 'inbound-decoded'`, `code: 'attachment_stored'`,
`bytes`, `hash`) and adds **no new field**, even though upstream states this payload is safe to log
whole: that is a statement about the frame, not a licence to widen `DiagnosticEvent`, which would disturb
the renderer pin at [#131](../codebase/131.md). The id is the client's own, so logging it would buy a
correlation handle the client already holds, at the cost of a per-upload identifier riding into a
JSON-lines log the operator can ship off-box in a debug bundle. Claiming the type is still strictly safer
than the status quo it replaces: the frame moves off the `default:` arm, which logs the wire-supplied
`envelope.type` capped at `MAX_LOGGED_TYPE_CHARS`, onto a static literal.

## Trust boundary — decoding makes the shape trusted, never the content

The narrower verifies only `typeof === 'string'` plus non-emptiness. A compromised daemon inside the Noise
session can put any string it likes here, up to the frame cap. The concrete hazard is
`attachment_id: "__proto__"`: a *read* of `pending['__proto__']` on a plain object returns
`Object.prototype`, which is truthy, so a consumer written the obvious way resolves a transfer that does
not exist. This module already treats `__proto__`/`constructor`/`prototype` as hazardous elsewhere
(`RESERVED_MAP_KEYS`), but that guard exists because `optionalStringMap` *builds a container* from wire
keys; this narrower builds no container from the value, so nothing in this slice is exploitable. The
obligation is stated on the payload's doc block and the switch arm as the consumer's (#861): look the id
up in a `Map` keyed by ids this client minted, never as an index into a plain object.

## Bounds — deliberately not modelled

**No shape validation on the id.** Upstream publishes a canonical lowercase-UUIDv4 shape, where lowercase
is load-bearing because the id becomes a directory name and only a lowercase alphabet keeps the
id-to-directory mapping injective on a case-insensitive filesystem (APFS is one by default). That rule
binds the side that *mints* ids — the outbound leg, [attachment-chunk-envelope](attachment-chunk-envelope.md)
— not this one. Here the contract is recognise-or-ignore against ids this client itself chose, so
re-validating the shape of a value it originated buys nothing and fail-closes a valid frame the moment two
copies of the same rule disagree. **No length check either** — `MAX_PLAINTEXT_BYTES` backstops the whole
frame ahead of this call, the same declined-bound posture `parseSlashCommand` already took.

## Configuration and usage

`src/main/transport/inboundMessage.ts` — main-process only, IPC-free (see
[inbound message decode](inbound-message-decode.md) for the module's placement rule). Reach the type
through `parseInboundMessage`, never a bare `as AttachmentStoredPayload` cast on `Envelope.payload`.

Claims **nothing downstream**: `daemonConnection.ts`'s inbound switch has no catch-all and no
`assertNever`, so the new `attachment-stored` kind decodes and is then simply unmatched — confirmed by
`npm run build` passing with the arm unconsumed, not assumed from the switch's shape. The send driver,
[#861](https://github.com/pyrycode/pyrycode-desktop/issues/861), is the first intended consumer and is not
started.

## Edge cases and limitations

- Reordering: a content-blind but on-path relay can deliver `attachment_stored` before the client has
  finished sending later chunks. The decode is stateless and does not care; the send driver (#861) must
  not treat the reply's arrival as proof every chunk was sent.
- A dropped reply (relay drops it) leaves a transfer unresolved forever from this layer's point of view —
  a liveness problem owned by #861's eventual timeout, not a safety problem here.
- `Envelope.type` is `EnvelopeType | string` (open) with no exhaustive switch anywhere in the tree, so
  this widening is non-breaking, and nothing else would catch a dropped member — the `EnvelopeType`
  membership test in `types.test.ts` is what would.
- `attachment_id` matching wants plain `===`/`Map.has`, never `crypto.timingSafeEqual` — the id is
  explicitly not a secret, so a constant-time compare would imply a confidentiality property it does not
  have (noted for #861 so it is not cargo-culted from a different arm).

## Testing strategy

All vitest, node environment. No Playwright spec — this slice is entirely inside the background process.

**`src/shared/wire/types.test.ts`** — a sibling block in ticket order, values lifted verbatim from the
daemon's committed `internal/protocol/testdata/attachment_stored.json`: compile-time `EnvelopeType`
membership; exact shape via `toEqual` + `Object.keys` on a typed literal; `not.toHaveProperty` on each of
the five deliberate absences (`size`, `sha256`, `total_chunks`, `filename`, `conversation_id`); a
`@ts-expect-error` on an empty literal, since the field has no `omitempty` and an absent key is a defect,
not a valid zero.

**`src/main/transport/inboundMessage.test.ts`** — alongside the `question_dismissed` /
`slash_command_list` arms: a well-formed frame decodes to `{ kind: 'attachment-stored', attachmentStored:
{ attachment_id } }`, asserted with an exact `toEqual` so a smuggled extra field fails; the result carries
**no** `inReplyTo` even when the envelope has one, `toEqual` on the whole object being what catches it; an
unknown extra payload key is tolerated and not copied through; four rejection cases each asserted
`toThrow(WireDecodeError)` — **not** `toBeNull()`, the module's other signal for an unclaimed type — for a
non-record payload, a missing `attachment_id`, a non-string one, and an empty string (the case a bare
`requireString` implementation would pass, so it is the test that actually guards the empty-payload
failure mode); the diagnostic record asserted by exact `toEqual` on all four fields, so an added field
(an `attachment_id`, a `count`) reddens; and a rejected frame emits no diagnostic record at all.

**`src/main/transport/fakeDaemon.test.ts`** — one end-to-end AC4 test, reusing `standUp` + `driveClient`
(real `createNoiseSession`, real forwarder, real codec): stands the fake up with
[`attachmentStoredReplyFrames(0)`](fake-daemon.md#attachment-upload-scaffolding-964), drives a two-chunk
upload through `buildAttachmentChunk`, and lets chunk index `0` — the *earlier* envelope id — be the
completing one, so a consumer keying on a predicted final envelope id would find nothing. Asserts exactly
one inbound reply arrives (chunk 1 is answered by silence) and that the decoded `attachment_id` is the one
both chunks carried. The silence assertion waits on a counting delegate around the reply builder rather
than inferring synchronisation from `whenSettled()` — see the fake-daemon doc's own note on why that
inference was wrong in an earlier revision.

## Security review

Verdict: PASS (builder self-review). One SHOULD FIX accepted and addressed in prose rather than a fourth
reject branch — see § Trust boundary above; a fourth branch validating the id's shape would be a
client-invented rule duplicating upstream's minting-side contract, and two copies of a shape rule
fail-close valid traffic the moment they disagree.

## Related

- [Attachment chunk envelope](attachment-chunk-envelope.md) — the producer half this decodes the answer
  to; its "no inbound decode" edge case was scoped to `attachment_chunk` itself and still holds — this
  slice decodes `attachment_stored`, a different frame.
- [Inbound message decode](inbound-message-decode.md) / [internals](inbound-message-decode-internals.md) —
  the boundary this arm extends: the twenty-third additive kind, the file's newest `requireNonEmptyString`
  helper, and the content-free diagnostic row.
- [Fake daemon](fake-daemon.md#attachment-upload-scaffolding-964) — `attachmentStoredReplyFrames`, the
  test scaffolding built to prove this decode against a completing chunk that is not the last one sent.
- [Question-shown wire types](question-shown-wire-types.md) — the `parseQuestionDismissedPayload` shape
  this decode's narrower is built from, minus two fields.
- [Slash-command-list wire types](slash-command-list-wire-types.md) — the `argument_hint` precedent for
  "empty string is a value, not an absence," the case `requireNonEmptyString`'s doc block warns not to
  confuse this one with.
- [Wire codec](wire-codec.md) — `Envelope.payload` stays an opaque carrier (`unknown`) through the codec;
  `MAX_PLAINTEXT_BYTES` is the frame-level backstop this decode leans on for the declined length check.
- [ADR 0002 — Remote head over relay, shared wire](../decisions/0002-remote-head-over-relay-shared-wire.md)
  — this slice mirrors a settled upstream contract and makes no desktop-side architectural choice of its
  own, so no new ADR was warranted.
- `docs/specs/architecture/964-attachment-stored-decode.md` — the full architecture spec, including the
  security review this doc summarizes.
- #861 (send driver, not started) — the intended consumer: recognise-or-ignore against ids it minted,
  resolve the spinner, and own the reply-never-arrives timeout.
- Daemon twin (QMD `pyrycode-docs`): `docs/protocol-mobile.md` § Attachments — SSOT for the shape; its
  status prose is stale as of this ticket, its field/correlation prose is not.
