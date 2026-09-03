# 993 — Declare and build the attachment retrieval request

The **outbound half of the retrieval leg's wire contract**: the `request_attachment` envelope type,
its two-field payload, and a pure builder that turns one request into the bytes the Noise session
carries. Nothing sends it here; the driver that does is a later slice, exactly as
`buildAttachmentChunk` landed in #860 before #861 sent anything.

## Files read

| Path | Symbol | Why it matters |
|---|---|---|
| `src/shared/wire/types.ts` | `EnvelopeType` | The union the new member joins. `attachment_stored` is its last attachment member; `'ack'` follows it with **no docblock**, so inserting between them orphans nothing. |
| `src/shared/wire/types.ts` | `AttachmentChunkPayload` | The frame this one is answered with. Its doc block already argues the upload half of the no-`conversation_id` asymmetry; this slice records the other half beside it. Do **not** edit it. |
| `src/shared/wire/types.ts` | `AttachmentStoredPayload` | The nearest structural sibling: one-field payload, long security block, "every absence is a decision" framing. The new interface lands after its closing brace; `BackfillSincePayload` follows with no docblock, so that insertion is orphan-safe too. |
| `src/shared/wire/types.ts` | `Envelope` | `in_reply_to?: number` already exists — correlation needs nothing new here. |
| `src/shared/wire/types.ts` | `ATTACHMENT_ID_MAX_BYTES` | Exists for `attachment_chunk`'s envelope arithmetic. This slice adds **no** ceiling constant of its own; see Design. |
| `src/main/transport/codec.ts` | `encodeEnvelope` | `JSON.stringify(envelope)` over a `{id, type, ts, payload}` literal, then a `MAX_PLAINTEXT_BYTES` check. Insertion order *is* wire order, which is what makes a byte-exact fixture assertion possible. |
| `src/main/transport/codec.ts` | `decodeEnvelope` | The round-trip half of the builder test. |
| `src/main/transport/requestDebugBundleEnvelope.ts` | `buildRequestDebugBundle` | The *ask the daemon for X* idiom: id and ts as explicit inputs, never a clock read. |
| `src/main/transport/requestSessionSettingsEnvelope.ts` | `buildRequestSessionSettings` | The other payload-carrying "ask". Its `?? ''` normalisation is the thing this slice deliberately does **not** copy — see Design. |
| `src/main/transport/attachmentChunkEnvelope.ts` | `buildAttachmentChunk` | The doc-comment conventions of this family, and the take-a-typed-payload input shape. |
| `src/main/transport/attachmentChunkPlan.test.ts` | the import-specifier + never-log assertion | The source-purity idiom AC5's "reaches no log line" half is proven with. |
| `src/shared/wire/types.test.ts` | `describe('attachment-stored wire vocabulary (#964)')` | Where this family's payload-shape pins live and the form they take (union-membership assignment, exact `Object.keys`, `@ts-expect-error` on an omitted required key). |
| `docs/knowledge/features/attachment-chunk-envelope.md` | § Bounds — documented, not validated; § Edge cases | Two lessons carried into this slice: the declined-validator posture, and that a source-purity test **matches its own disclaimer** — a header must not spell the literal it greps for. |
| `docs/knowledge/features/attachment-stored-wire-types.md` | — | The sibling wire-vocabulary-only slice's shape. |
| `pyrycode` `internal/protocol/attachments.go` | `RequestAttachmentPayload` | The SSOT doc block and struct tags, read at `f1e0a583` — the exact commit the ticket cites, and the sibling checkout's HEAD. |
| `pyrycode` `internal/protocol/testdata/request_attachment.json` | — | The committed fixture AC3 pins against, confirmed identical to the ticket's transcription. |
| `pyrycode` `internal/protocol/codes.go` | `TypeRequestAttachment` | Confirms the type string and that the frame is switch-intercepted by #2054. |

## Design source

**Figma:** N/A — wire vocabulary and a pure builder. Nothing renders; the visual-fidelity check is
intentionally skipped.

## Context

The daemon published `request_attachment` on 2026-09-03 (`pyrycode/pyrycode#2052` declares it,
`#2054` answers it). Until then no client had a verb for asking the host for a stored attachment,
which is why the retrieval leg was parked. The desktop already holds every other piece of the
attachment family: the chunk frame both legs ride, the upload driver, the file picker, and the
`attachment_stored` terminal. What is missing is the *ask*.

This slice is deliberately unreferenced when it lands, matching how #860 shipped `buildAttachmentChunk`
one slice ahead of its sender. The inbound decode of the answering chunks is #994's.

No ADR is warranted: `docs/knowledge/decisions/0002` already governs wire-type fidelity and this
slice is an instance of it, not a new decision.

### Size — the overage is stated, not hidden

Against the size-S table: **2** production source files (≤ 5), **3** new exported declarations
(≤ 5), **0** consumer call sites (≤ 10), **5** acceptance criteria (≤ 5), **0** reject branches
(≤ 10). Only the 800-line total-written-work line is at risk; the refiner estimated ~900.

Not split. The floor rule decides it: a slice carrying only the type declaration would have exactly
one consumer — the builder, its own sibling — and nothing observable in it. Splitting a wire
declaration off from its own builder produces a child that cannot be verified alone. The floor wins
over the ceiling, and the family measurement agrees: #860 (1214), #861 (1859), #862 (1529), #964
(1095) and #965 (1062) all landed over the line as single tickets and all shipped clean.

## Design

Two production files, no behaviour change anywhere else.

### `src/shared/wire/types.ts`

**One `EnvelopeType` member**, inserted after `'attachment_stored'` and before `'ack'`, carrying the
comment block this family uses. What that comment must establish, on *this* frame's contract ground:

- **One direction only**, phone → binary. That is the whole difference from `attachment_chunk`,
  which rides both legs and therefore forces a consumer to decide trust from arrival direction.
  Here there is nothing to decide — every field is an unverified claim, always.
- **Correlation rides the envelope**, so there is no request-id key. The daemon's answering chunks
  and its `attachment.stream_aborted` reject both correlate on `Envelope.in_reply_to`, and its
  committed retrieval-chunk fixture rides `in_reply_to: 91` against the request fixture's `id: 91`.
  A request-id key invented here would leave a landed upstream fixture describing a different scheme.
- **Why there is a `conversation_id` here** when `attachment_chunk` deliberately has none: an upload
  lands in the conversation the authenticated session is already on, so naming one *there* would only
  let a client steer bytes elsewhere; a retrieval has to say which conversation's file it wants.

**One payload interface**, `RequestAttachmentPayload`, inserted after `AttachmentStoredPayload`'s
closing brace:

```ts
export interface RequestAttachmentPayload {
  conversation_id: string
  attachment_id: string
}
```

Both fields required — the daemon's struct carries no `omitempty` and no `MarshalJSON`, so both keys
are always present in the one direction this frame travels.

Its doc block restates, from this frame's own contract:

- **Two fields and no third**, with the no-request-id argument above.
- **Naming a conversation is not authorization.** The id is a lookup key validated against the
  daemon's own registry *before it reaches a path join*, and confinement — not the id's shape and not
  its randomness — is what bounds a paired but hostile client. A reader who takes this field for a
  free-form selector has been handed exactly the capability the rest of the attachment contract
  spends pages denying. **UUIDv4 is not a claim of unguessability.**
- **The canonical shape, on both ids**: 36 bytes; `-` at offsets 8, 13, 18, 23; `4` at offset 14; one
  of `8` `9` `a` `b` at offset 19; lowercase hex elsewhere. **Lowercase is load-bearing**: the id
  becomes a directory name on the host, and the lowercase-only alphabet is what keeps the
  id-to-directory mapping injective on a case-insensitive filesystem (APFS by default), so uppercase
  ids would give two attachments one directory on macOS.
- **Documented, not validated.** No validator, matching the posture both sibling payload types ship
  with — this repo's wire layer declares shapes and checks none; enforcement is #2054's.
- **No new `Max*` constant.** `ATTACHMENT_ID_MAX_BYTES` exists for `attachment_chunk`'s envelope
  arithmetic. Containment follows from the *shape*, never from a length ceiling, and a second ceiling
  here would enforce nothing while inviting the reading that a ceiling *is* the shape.

Explicitly **not touched**: `AttachmentChunkPayload` and `AttachmentStoredPayload`. Their doc blocks
anchor contrasts by name — the no-`conversation_id` argument in particular — and correcting the
retrieval leg's field provenance belongs to #994.

### `src/main/transport/requestAttachmentEnvelope.ts`

```ts
export interface RequestAttachmentInput {
  id: number      // the consumer's envelope-id counter
  ts: string      // RFC3339, the consumer's clock — never read from the wall clock here
  payload: RequestAttachmentPayload
}

export function buildRequestAttachment(input: RequestAttachmentInput): Uint8Array
```

Behaviour: wrap the payload in `Envelope{id, type: 'request_attachment', ts, payload}` and return
`encodeEnvelope(...)`. Pure — no clock, no counter, no state, no logging.

**It takes a typed payload rather than two discrete id arguments**, which is where it parts from
`buildRequestSessionSettings` and follows `buildAttachmentChunk` instead. That builder's `?? ''`
normalisation exists because its whole main-side chain types the id optional; nothing here is
optional, and copying the normalisation would *mint* a zero value. The daemon's own doc block names
the hazard precisely — `filepath.Join(dir, "", "")` is `dir`, so a zero-valued request addresses a
conversation directory root rather than erroring. A required-both-fields input means this builder
never originates that value: an empty string can only arrive because a caller passed one. It also
makes AC2's "neither key elided when its value is empty" a compile-time property of the type rather
than a runtime normalisation, since `JSON.stringify` emits `""` for a present empty string.

## State + concurrency model

None. Both modules are pure; the builder holds no state, launches no async work, and subscribes to
nothing, so there is no cancellation path to define. No store slice is touched.

## Error handling

The builder's only failure mode is inherited: `encodeEnvelope` throws `WireEncodeError` above
`MAX_PLAINTEXT_BYTES`. It fails closed — an over-cap envelope never reaches the wire and is never
truncated — and it is the *only* validator on this path, matching `buildAttachmentChunk`. A
two-UUID payload cannot approach 65519 bytes in practice; the throw is reachable only from a caller
passing an out-of-contract id, and this slice adds no catch because it has no caller yet.

No new error code, no reject branch, no result type. The reject this verb draws
(`attachment.not_found`) arrives on the *inbound* leg and is #994's.

## Testing strategy

Vitest only — nothing renders, so no Playwright spec. Two files, both node-environment.

**`src/shared/wire/types.test.ts`** — a new `request-attachment wire vocabulary (#993)` describe
block beside the #964 one, with values transcribed verbatim from the daemon's committed fixture:

- Union membership via `const t: EnvelopeType = 'request_attachment'` — the only thing in the tree
  that catches a dropped member, since `Envelope.type` is `EnvelopeType | string` and a round-trip
  passes silently on an unknown string.
- Payload shape: exactly `['conversation_id', 'attachment_id']` by `Object.keys`, both values from
  the fixture.
- The absent third key is the contract: assert no `request_id` / `requestId` property, with the
  correlation-rides-the-envelope reason in a comment.
- Both keys required: `@ts-expect-error` on a literal omitting each — no `omitempty` daemon-side, so
  an absent key is a defect rather than a valid zero.
- A plain `string`, deliberately not branded or validated: assigning a non-canonical value compiles,
  which is what "documented, not validated" means in this layer.

**`src/main/transport/requestAttachmentEnvelope.test.ts`** — against the real codec, never a stub:

- **Byte-exact fixture match (AC3).** `encodeEnvelope` is `JSON.stringify` over a
  `{id, type, ts, payload}` literal, so insertion order is wire order and it matches the daemon's
  fixture key-for-key. Build with the fixture's own `id: 91`, `ts`, and two ids, then compare the
  decoded UTF-8 to the fixture string verbatim. This is strictly stronger than a field-by-field
  round-trip and turns any upstream contract change into a one-line diff.
- Round-trip through `decodeEnvelope`: type, id, ts, payload.
- Exact key set on the decoded payload — no extra key.
- Both keys present when both values are empty strings, proving nothing is elided and nothing is
  normalised away.
- No `in_reply_to` and no `event_id` on an outbound request — it is the frame others reply *to*.
- Source purity: the module's import specifiers are exactly `['../../shared/wire/types', './codec']`
  (no `node:fs`, no `electron`, no renderer path), and the source contains no log call — AC5's
  never-logs half. **The module header must not spell the literal the grep searches for**, per the
  lesson recorded in `attachment-chunk-envelope.md` § Edge cases: a test that greps a source for
  `'console.'` also matches a header comment explaining that the module doesn't call it.

## Open questions

1. **Discrete id arguments or a typed payload input?** Resolved in Design before implementation: a
   typed payload, so both-keys-present is structural and no zero value is ever minted here.
2. **Does the builder belong in `src/main/transport/` when nothing sends yet?** Yes — it imports
   `codec.ts` (Node `Buffer`), so main-process-only is forced regardless of who calls it, and every
   sibling builder lives there.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and the direction is worth stating because it inverts the
  usual one. This slice sits entirely on the **outbound** side: it consumes values a future caller
  supplies and produces bytes for the Noise session. Nothing here parses network input, so there is
  no untrusted→trusted transition to guard. The frame's *own* trust boundary is the daemon's — every
  field is an unverified claim there, always, and #2054 owns the shape check and the registry
  validation. The design says so explicitly rather than leaving a reader to assume this side checks.
  The one real risk is a **false sense of enforcement**: a reader who sees a documented UUIDv4 shape
  may conclude something validates it. Mitigated by the doc block stating "documented, not
  validated" and naming who does enforce it.
- **[Path traversal / file storage]** No findings *in this repo*, and the finding is that the
  hazard is real one hop away. `conversation_id` and `attachment_id` become directory components on
  the **host**. Nothing in `buildRequestAttachment` or `RequestAttachmentPayload` touches a
  filesystem — the module's import set is pinned to `./codec` and the wire types by a test, which
  makes "never joins a path" a checked property rather than a reviewed one. The daemon-side
  confinement argument is transcribed into the payload doc block precisely so the next reader on
  this side does not treat the id as a path component either. The `attachment_stored` doc block
  already records that this mistake is natural here.
- **[Zero-value payload]** SHOULD FIX, and addressed in the design rather than deferred. A
  zero-valued request is the specific silent failure upstream warns about: `filepath.Join(dir, "", "")`
  is `dir`, so a request with two empty strings addresses a conversation directory root instead of
  erroring. This side cannot enforce the daemon's check, but it can decline to *originate* the
  value — hence a required-both-fields input and no `?? ''` normalisation, unlike the sibling
  `buildRequestSessionSettings`. A test asserts both keys survive encoding when empty, so the
  behaviour is pinned rather than incidental.
- **[Logs, telemetry]** No findings. The builder makes no log call, asserted by a source grep, and
  AC5 requires it. The rule is restated on this frame's ground rather than transcribed: upstream
  permits logging both ids *after* their shape is validated, and since nothing here validates,
  nothing here may log them. Raw, either id is the log-injection shape the daemon's § Attachments
  already forbids for `filename`. Note the copy-the-rule-not-the-evidence trap the ticket names —
  `AttachmentChunkPayload`'s never-log argument rests on `filename` being private in itself and
  `data` being the file; neither transfers to a frame carrying two ids and no content-bearing bytes,
  so the argument here is the injection shape plus the absent validation, not privacy of content.
- **[Tokens, secrets, credentials]** Not applicable, by shape: this frame carries no credential, no
  key and no token. `attachment_id` is explicitly **not a capability** — not secret, not
  unguessable, never the only thing between a caller and a file — and the payload doc block says so
  in those words. Authorization on this wire is pairing, enforced structurally at the Noise IK
  handshake; there is no per-verb gate on this frame and none is invented here.
- **[Cryptographic primitives]** Not applicable. No randomness is generated (this slice mints no
  id), no comparison is made, no primitive is selected. The `Noise_IK_25519_ChaChaPoly_BLAKE2s`
  session is untouched — the builder hands it opaque bytes exactly as every sibling builder does.
- **[Electron attack surface / process placement]** No findings. `requestAttachmentEnvelope.ts` is
  main-process-only because it imports `codec.ts` (Node `Buffer`), and the import-specifier test
  fails on a renderer import or an `electron` import. It is added to no renderer barrel, no
  `contextBridge` API and no `ipcMain` channel — this slice adds no IPC surface at all. The payload
  type lives in `src/shared/`, which is correct and unchanged practice: it is a type declaration
  with no runtime import.
- **[Network & I/O]** Not applicable — this module opens no socket, sets no timeout, and validates
  no URL. The one inherited limit that does apply is `MAX_PLAINTEXT_BYTES` via `encodeEnvelope`,
  which fails closed on an over-cap envelope; a two-UUID payload cannot approach it, so the throw is
  reachable only from an out-of-contract caller.
- **[Concurrency]** Not applicable by construction: a pure function launching no async work, owning
  no timer, and registering no listener. There is nothing to cancel on teardown and no shared state
  to race on. Stated as a property of the shape rather than left as an omission.
- **[Denial of service / allocation]** Not applicable by shape, and worth naming because the sibling
  frame warns about it. `AttachmentChunkPayload`'s "never allocate from a claim" rule bites on
  `total_chunks` and `size`; this payload has no count and no length field, so there is nothing for
  the rule to bite on.
- **[Threat model — hostile daemon]** OUT OF SCOPE, named rather than assumed. A compromised daemon
  inside the session answers this request with chunks whose fields are claims; validating them,
  bounding the reassembly, and refusing an unrecognised `attachment_id` are the **inbound** leg's
  obligations and belong to #994. This slice produces bytes and reads nothing back, so no inbound
  defence can be written here.
- **[Threat model — hostile relay]** Not applicable at this layer. The relay is content-blind and
  on-path; it can drop, delay or reorder this frame, but the request carries no secret to leak and
  the envelope it produces is opaque to the relay. Retry and timeout behaviour belongs to whichever
  slice sends, not to a pure builder.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-03
