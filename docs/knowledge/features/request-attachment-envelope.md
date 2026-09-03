# Request-attachment envelope

The **outbound half of the retrieval leg**: one `EnvelopeType` member, `request_attachment`, its
two-field `RequestAttachmentPayload`, and a pure builder, `buildRequestAttachment`, that turns one
request into envelope bytes — exactly as [attachment_chunk's builder](attachment-chunk-envelope.md)
landed in #860 one slice ahead of #861's sender. [Attachment retrieval](attachment-retrieval.md) (#996)
is now the driver: `daemonConnection.requestAttachment` calls this builder, retaining the envelope id
it sent under (the `id` docblock's stated contract) as the correlation key for both the chunk stream
and the reject.

Introduced in [#993](https://github.com/pyrycode/pyrycode-desktop/issues/993), split from #687. SSOT
is `pyrycode/pyrycode` `internal/protocol/attachments.go` (`RequestAttachmentPayload`) and
`codes.go` (`TypeRequestAttachment`), plus `docs/protocol-mobile.md` § The `attachment_id` shape —
declared by pyrycode#2052, answered by #2054, both landed 2026-09-03. The inbound decode of the
answering `attachment_chunk` frames is
[#998](https://github.com/pyrycode/pyrycode-desktop/issues/998), split from #994 in turn — see
[Attachment-chunk retrieval decode](attachment-chunk-retrieval-decode.md). The `attachment.not_found`
and `attachment.stream_aborted` rejects are classified by
[#999](https://github.com/pyrycode/pyrycode-desktop/issues/999) — see
[Daemon error outcome](daemon-error-outcome.md) — and [#995](attachment-reassembly-and-store.md) built
the reassembler that acts on them, driven since #996 landed — see
[Attachment retrieval](attachment-retrieval.md).

## What it does

```ts
// src/shared/wire/types.ts
export type EnvelopeType =
  | …
  | 'attachment_stored'
  | 'request_attachment'   // client → daemon only; the whole difference from attachment_chunk
  | …

export interface RequestAttachmentPayload {
  conversation_id: string   // lookup key, validated daemon-side before a path join — not authorization
  attachment_id: string     // the client's own id, repeated from the upload — not a capability
}
```

```ts
// src/main/transport/requestAttachmentEnvelope.ts
export function buildRequestAttachment(input: {
  id: number; ts: string; payload: RequestAttachmentPayload
}): Uint8Array                 // MAY throw WireEncodeError above MAX_PLAINTEXT_BYTES
```

## How it works

**One direction only, client → daemon**, and that is the whole difference from the frame it is
answered with. `attachment_chunk` rides both legs and so forces a consumer to decide trust from
which direction the frame arrived; here there is nothing to decide — every field is an unverified
claim on the receiving side, always.

**Two fields, and no third — deliberately no request-id key.** Correlation rides the *envelope*:
the answering `attachment_chunk` frames and the `attachment.not_found` reject both name this
request through `Envelope.in_reply_to` (`src/shared/wire/types.ts:233`, already surfaced by
`decodeEnvelope`). The daemon's committed retrieval-chunk fixture rides `in_reply_to: 91` against
`request_attachment.json`'s `id: 91` — inventing a request-id key here would put this client at
odds with a scheme upstream already has golden fixtures for. Nothing new was needed for
correlation; it already existed.

**Why `conversation_id` is here when `attachment_chunk` deliberately has none.** An upload lands in
the conversation the authenticated session is already on, so naming one *there* would only let a
client steer bytes into another conversation's directory. A retrieval has to say *which*
conversation's file it wants — the asymmetry is deliberate on the daemon's side, argued in both
payload doc blocks, and it is not "harmonised" in either direction.

**Naming a conversation is not authorization**, and this is the security property the whole frame
rests on. Authorization on this wire is pairing, enforced structurally at the Noise IK handshake —
there is no per-verb gate on this frame and none is invented here. What bounds a paired but hostile
client is that the daemon validates the id against its own registry *before it becomes a path
component* and confines resolution to that conversation's directory — confinement, never the
secrecy or the shape of an id. A reader who takes either field for a free-form selector has been
handed exactly the capability the rest of the attachment contract spends pages denying.

**Both ids obey the canonical lowercase-UUIDv4 shape** (36 bytes; `-` at offsets 8, 13, 18, 23; `4`
at offset 14; one of `8`/`9`/`a`/`b` at offset 19; lowercase hex elsewhere) — **documented, not
validated**, the posture both sibling payload types already ship with. Lowercase is load-bearing
rather than cosmetic: the id becomes a directory name on the host, and only a lowercase-only
alphabet keeps the id-to-directory mapping injective on a case-insensitive filesystem (APFS by
default) — uppercase would give two attachments one directory on macOS. Containment follows from
the shape and never from a length ceiling, which is also why this slice adds no `Max*` constant of
its own: `ATTACHMENT_ID_MAX_BYTES` exists for `attachment_chunk`'s envelope arithmetic, and a
ceiling has already been misread as *the* shape once — a second one here would enforce nothing
while inviting the same misreading.

**`buildRequestAttachment` takes a whole typed payload, not two discrete id arguments** — where it
parts from `buildRequestSessionSettings` and follows [`buildAttachmentChunk`](attachment-chunk-envelope.md)
instead. `buildRequestSessionSettings` normalises an absent id to `''` because its whole main-side
chain types the id optional; nothing here is optional (the daemon's struct has no `omitempty`, so
both keys are always present in the one direction this frame travels), and copying that
normalisation would *mint* a zero value this module never originates otherwise. That matters
because a zero-valued request is the specific silent failure the daemon's own doc block warns
about: `filepath.Join(dir, "", "")` is `dir`, so two empty strings would address the conversation
directory root rather than erroring. A required-both-fields input makes AC2's "neither key elided
when empty" a compile-time property of the type rather than a runtime normalisation — `JSON.stringify`
emits `""` for a present empty string regardless.

## Bounds — documented, not validated

Same declined-bound posture as [attachment-stored wire types](attachment-stored-wire-types.md) and
[attachment-chunk envelope](attachment-chunk-envelope.md): this wire layer declares shapes and
checks none of them. No validator on either id's UUIDv4 shape, and no new length constant — see
above. `MAX_PLAINTEXT_BYTES` (via `encodeEnvelope`) is the one inherited backstop, and a two-UUID
payload cannot approach it in practice; the throw is reachable only from a caller passing an
out-of-contract id.

## Configuration and usage

`src/main/transport/requestAttachmentEnvelope.ts` — main-process only. It imports `codec.ts` (Node
`Buffer`), so it must never be re-exported through any renderer barrel. It makes no log call: the
daemon permits logging either id only after its shape has been validated, and nothing on this side
validates, so raw the ids stay out of a log entirely — asserted by an exact-import-specifier
source-purity test (`['../../shared/wire/types', './codec']`) plus a `not.toContain('console.')`
check, worded around its own literal per the lesson below.

Nothing calls `buildRequestAttachment` yet. It adds no IPC surface, no renderer path, and no
consumer call site — the send driver that reads `Envelope.in_reply_to` against a live retrieval
table is a later slice.

## Edge cases and limitations

- **No inbound decode of anything in this slice.** The `attachment_chunk` frames this request
  provokes are [#998](attachment-chunk-retrieval-decode.md)'s; the `attachment.not_found` reject still
  has no decode as of that ticket. This slice only produces bytes and reads nothing back.
- **A source-purity test can match its own disclaimer.** Carried forward from
  [attachment-chunk-envelope.md](attachment-chunk-envelope.md#edge-cases-and-limitations): a test
  that greps a module's source for the literal `'console.'` to prove it never logs will also match
  a header comment that names that string while explaining the module doesn't call it. This
  module's header is worded around the rule rather than quoting it.
- **The zero-value payload is a real, named hazard, not a hypothetical one.** Both fields are
  required on the TypeScript side specifically so this builder can never mint the empty-string pair
  that addresses a conversation's directory root on the far side; see § How it works.

## Testing strategy

All vitest, node environment. No Playwright spec — this slice is entirely inside the background
process and sends nothing.

**`src/shared/wire/types.test.ts`** — a `request-attachment wire vocabulary (#993)` block beside the
\#964 one, values transcribed verbatim from the daemon's committed
`internal/protocol/testdata/request_attachment.json`: compile-time `EnvelopeType` membership; exact
`{conversation_id, attachment_id}` shape via `Object.keys`; `not.toHaveProperty` on `request_id` and
`requestId`; `@ts-expect-error` on each field omitted individually (no `omitempty` daemon-side, so
absence is a defect); a non-canonical string value compiling, proving the shape is documented and
not enforced at this layer.

**`src/main/transport/requestAttachmentEnvelope.test.ts`** — against the real codec, never a stub:

- Byte-exact match against the daemon's fixture string (`id: 91`, its `ts`, its two ids) — strictly
  stronger than a field-by-field round-trip, since `encodeEnvelope` is `JSON.stringify` over an
  object literal and insertion order is wire order.
- Round-trip through `decodeEnvelope`: type, id, ts, payload.
- Exact key set on the decoded payload, no extra key.
- Both keys present and empty-string-valued when both inputs are empty — nothing elided, nothing
  defaulted.
- No `in_reply_to` and no `event_id` on the outbound frame — it is the frame others reply *to*.
- Source purity: exact import-specifier set, no `console.` literal.

## Security review

Verdict: PASS (builder self-review). One SHOULD FIX addressed in the design rather than a runtime
check — the zero-value payload risk, closed by making both payload fields required so the builder
never originates the empty-string pair (see § How it works). Everything else is either inherited
(`MAX_PLAINTEXT_BYTES` fail-closed) or out of scope by direction: a hostile *daemon*'s answering
chunks are #994's threat model, not this pure builder's.

## Related

- [Attachment chunk envelope](attachment-chunk-envelope.md) — the frame this request provokes in
  reply, and the builder-shape template `buildRequestAttachment` follows (`{id, ts, payload}` in,
  `encodeEnvelope` out).
- [Attachment-chunk retrieval decode](attachment-chunk-retrieval-decode.md) — the inbound decode of
  those replies (#998): the required `inReplyTo` correlation this frame's `id` surfaces against, pinned
  by the same `id: 91` / `in_reply_to: 91` fixture pair this doc's own tests already assert.
- [Attachment-stored wire types](attachment-stored-wire-types.md) — the terminal on the *upload*
  leg; shares the "documented, not validated" UUIDv4 posture and the correlate-via-`attachment_id`
  discipline this slice's payload doc block also states.
- [Attachment transfer](attachment-transfer.md) — the existing send driver for the upload leg; the
  retrieval leg's own driver, once it lands, is the first consumer of this builder.
- [Wire codec](wire-codec.md) — `encodeEnvelope`/`decodeEnvelope`/`MAX_PLAINTEXT_BYTES`, reused
  unchanged.
- `docs/specs/architecture/993-request-attachment-envelope.md` — the full architecture spec,
  including the security review this doc summarizes.
- [ADR 0002 — Remote head over relay, shared wire](../decisions/0002-remote-head-over-relay-shared-wire.md)
  — this slice mirrors a settled upstream contract and makes no desktop-side architectural choice of
  its own, so no new ADR was warranted.
- Daemon twin (QMD `pyrycode-docs`): `docs/protocol-mobile.md` § The `attachment_id` shape — SSOT
  for the canonical id shape and the case-insensitive-filesystem rationale for lowercase.
