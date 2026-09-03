# #965 — Narrow the attachment upload's reject codes onto client-owned outcomes

## Files read

- `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage` (the union member to widen), `parseInboundMessage`'s `case 'error'` (the arm to rewrite), `parseTurnStatePayload` (the house idiom for fail-closed closed-enum narrowing — an inline literal comparison, never a cast), `isRecord` (rejects `null` and arrays), `hashPlaintext`, `MAX_LOGGED_TYPE_CHARS` (the precedent for bounding a *logged* wire string, and why this slice needs no analogue).
- `src/main/transport/inboundMessage.test.ts` → the three `daemon-error` `it`s under `describe('parseInboundMessage — debug-bundle recognition (#116, additive)')` (the exact-`toEqual` repairs), and `it('logs a modeled error as inbound-decoded(error), never the ErrorPayload text (#116)')` (the log's no-leak pin, which stays green and gains one assertion).
- `src/main/transport/fakeDaemon.ts` → `attachmentStoredReplyFrames` (the `buildReplyFrames` builder shape the reject answer mirrors, including its `[]`-for-anything-else discipline and its stateless-closure argument), `ATTACHMENT_STORED_ID` / `ATTACHMENT_STORED_TS` (the fixed-framing convention), the file header's LOG-FREE / TEST-ONLY constraints.
- `src/shared/wire/types.ts` → `ErrorPayload` (four fields, bare docblock), `AttachmentStoredPayload` (the neighbouring docblock whose security prose must **not** be transcribed here — its evidence is its own), the `attachment_stored` member comment (the "six other `attachment.*` codes" count contrast the ticket rules out of scope).
- `src/main/daemonConnection.ts` → the `case 'daemon-error':` block — read to confirm it is the union's **only** consumer, reads `inbound.inReplyTo` alone, and is not compile-forced by an additive field. Its four correlation comments are on the § What NOT to touch list; this slice does not edit the file.
- `docs/knowledge/features/inbound-message-decode-contract.md` → the published `InboundDaemonMessage` shape and the diagnostic-logging table; the documentation phase updates it, not this slice.
- `docs/knowledge/features/fake-daemon.md` § *Attachment upload scaffolding* → what #964 landed and the `buildReplyFrames` hook contract.
- Upstream SSOT, re-verified 2026-09-03 in `~/Workspace/Projects/pyrycode`: `internal/protocol/codes.go` (`CodeAttachmentInvalidChunk` … `CodeAttachmentStorageFailed`, `CodeMessageTooLong`, `TypeError = "error"`) and `internal/relay/v2session_attachment.go` (`attachmentReplyError` marshals a closed `{Code, Message, Retryable}` literal; the `rejectInvalidChunk` … `rejectStorageFailed` table's retryable flags are `false, false, false, true, true`; the `msgAttachment*` constants are static strings).

## Design source

**Figma:** N/A — this slice is entirely inside the background process and ships no renderer change. The visual-fidelity check is intentionally skipped.

## Context

`parseInboundMessage`'s `error` arm returns `{ kind: 'daemon-error', inReplyTo }` and reads no field of the frame's `ErrorPayload`. That has been a deliberate, absolute invariant since #116, asserted in four places in prose.

The attachment upload leg is the first caller that genuinely needs the code: its six reject codes mean six different things to a client — re-chunk, re-derive the metadata, give up on the file, or wait and retry — and "something failed" is not a reason anyone can act on. So the invariant becomes **scoped**: narrowed for the codes this slice names, still closed for everything else. Because the change is on an internet-exposed decode boundary, the narrowing is a value mapping onto client-owned constants, never a pass-through.

No ADR is warranted. This does not overturn ADR 0007 (whose allowlist is over diagnostic *field names*, and which this slice leaves untouched) nor ADR 0002 (the wire types are unchanged — `ErrorPayload` is already modelled, merely never read). It scopes one module-level invariant, and the module's own docblock is the right home for that.

## Design

### The client-owned outcome

A string-literal union exported from `inboundMessage.ts` beside `InboundDaemonMessage`, one member per reject code plus one catch-all:

```ts
export type DaemonErrorOutcome =
  | 'attachment-invalid-chunk'
  | 'attachment-integrity-failed'
  | 'attachment-too-large'
  | 'attachment-too-many-uploads'
  | 'attachment-storage-failed'
  | 'message-too-long'
  | 'unclassified'
```

Every inhabitant is a literal written in this repo's source, so the type itself is the trust signal: a value of this type cannot hold daemon text. Per-member docblocks carry the client-facing meaning and the retryability from the daemon's own reject table (`false, false, false, true, true` — read off the emit table, not inferred from the names).

**Retryability is documented, not computed here.** No `isRetryable` helper ships in this slice. The ticket establishes that `retry_after_s` is never sent on this leg and that "after a backoff" is therefore a *client-owned policy* rather than a daemon-supplied delay — and policy belongs to the consumer that acts on it (#861), not to the decode boundary. The boundary's whole job is to say *which* failure this was.

### The union member, widened additively

```ts
| { kind: 'daemon-error'; inReplyTo?: number; outcome: DaemonErrorOutcome }
```

`outcome` is **required, not optional**, and that is load-bearing. Every `error` envelope produces one — an unparseable payload lands on `'unclassified'` rather than on absence — so a consumer has no "field missing" state to mishandle, and no `if (outcome)` branch that behaves differently for a malformed frame than for a recognised one. Making it optional would reintroduce, one layer down, exactly the ambiguity this slice exists to remove.

`inReplyTo` keeps its existing optionality and meaning; nothing about the #269 correlation changes.

### The narrowing function

`narrowDaemonErrorOutcome(payload: unknown): DaemonErrorOutcome` — module-private, pure, and **total: it never throws and has no failure return**. Contract:

- non-record payload (absent, `null`, string, number, array) → `'unclassified'`
- record with a missing or non-string `code` → `'unclassified'`
- record with a string `code` → an explicit `switch` over the six literals, `default: return 'unclassified'`

The `switch` is the boundary. It **compares** the untrusted string against client-owned constants and **returns** a client-owned constant; the daemon's string is never used as a lookup path. A `Record`-keyed table is the shape to avoid for exactly that reason, and the inline-literal comparison mirrors `parseTurnStatePayload`'s `state` check — the module's established idiom for narrowing a closed enum without a cast.

Nothing is retained from the payload, so the `code` string needs no length bound: `MAX_LOGGED_TYPE_CHARS` exists because the unmodeled branch *logs* a wire-supplied string, and this one logs nothing wire-supplied. The frame-level `MAX_PLAINTEXT_BYTES` guard at the top of `parseInboundMessage` already bounds a hostile oversized frame before the switch is reached.

### The `error` arm

Unchanged in structure: log first (the record keeps its client-owned `code: 'error'` literal, byte length and hash — the existing content-free field set), then return. The only change is that the returned literal gains `outcome: narrowDaemonErrorOutcome(envelope.payload)`.

### `ErrorPayload`'s docblock

`src/shared/wire/types.ts`'s `ErrorPayload` gains a short docblock stating, on contract ground, which of its four fields this client reads and why the other three do not cross: `code` is read as a comparand only; `message` is not surfaced (the daemon's promise that `storage_failed`'s message is static is a statement about the daemon's behaviour, not a property this client can rely on for any code); `retryable` is a per-code constant in the daemon's own reject table and a value an untrusted daemon picks, so it carries nothing the outcome does not already encode; `retry_after_s` is absent from every attachment reject because `attachmentReplyError` marshals a closed three-field literal and the field is `*int,omitempty`.

It states the **rule**, not a borrowed measurement. The neighbouring long security sections in this file argue from measurements taken on their own frames; none of those transfer, and transcribing one would ship a claim nothing here has established.

### The fake daemon's reject answer

`attachmentRejectReplyFrames(rejectedIndex: number, code: AttachmentRejectCode)` — a `buildReplyFrames` builder mirroring `attachmentStoredReplyFrames` member for member:

```ts
export type AttachmentRejectCode = /* the six wire code literals */
export function attachmentRejectReplyFrames(
  rejectedIndex: number,
  code: AttachmentRejectCode
): (inboundPlaintext: Uint8Array) => Uint8Array[]
```

Behaviour: answers the `attachment_chunk` at `rejectedIndex` with one `error` envelope whose `in_reply_to` is that chunk's envelope id and whose payload is a faithful `{ code, message, retryable }` — the daemon's own static `msgAttachment*` message and the reject table's retryability, so the fixture is a real reject rather than a code in an empty shell. Everything else — a different index, a non-`attachment_chunk` type, an undecodable frame — yields `[]`, the sibling's discipline: the fake answers only what it understands, and a decode failure inside it must not masquerade as a daemon-side crash.

Stateless by construction: the closure holds one number and one string, no arrival set, so interleaved transfers cannot race and there is nothing to reset between tests. Fixed `id`/`ts` constants in the file's wall-clock-free convention.

The parameter is `rejectedIndex`, not `completingIndex`: a reject names the chunk that *triggered* the condition, which for `too_many_uploads` or `storage_failed` can be any chunk in the stream, not the one that closed it.

## State + concurrency model

No store slice, no async task, no stream, no subscription, no timer. `narrowDaemonErrorOutcome` is a pure synchronous function over one argument; the fake's builder is a stateless closure invoked per inbound frame by the existing `buildReplyFrames` hook. Nothing to cancel and nothing to tear down; teardown of the fake daemon itself is unchanged.

## Error handling

The module's usual answer for a malformed payload of a claimed type — `throw new WireDecodeError` — is **wrong here**, and the design turns on that.

`daemonConnection.ts` wraps `parseInboundMessage` in a bare `catch { return }` that drops the frame with no event and no log. A thrown `error` frame would therefore silently kill all four behaviours the `daemon-error` case drives today: the `set_session_settings` rejection correlation (#269), the `create_workspace_folder` rejection correlation (#396), `reassembler.fail('daemon-error')` for an in-flight debug bundle (#116), and the modal-answer FIFO rejection (#248). None of them reads error content — each correlates on `in_reply_to` and emits a client-minted id — so all four must keep firing for **every** `error` envelope, however mangled its payload.

**An `error` frame is terminal because it arrived, not because its payload parsed.** So this arm has exactly one failure mode and it is a value: `'unclassified'`. Never a throw, never `null`. The `daemon-error` arm becomes the module's one deliberate exception to its own fail-closed-by-throwing idiom, and the exception is recorded in the arm's comment so a later reader does not "fix" it into conformity.

## Testing strategy

All vitest (node environment). No renderer change, so no static-render spec and no Playwright spec.

`src/main/transport/inboundMessage.test.ts` — a new `describe` for the outcome narrowing:

- Each of the six codes decodes to its own outcome. Fixtures carry `message` and `retryable` on the wire — plus a spurious `retry_after_s`, which no real reject sends — and every assertion is an exact `toEqual`, so a leaked field reddens rather than being tolerated.
- Distinctness: the six outcomes are pairwise distinct (asserted as a set size, not as a list of literals — a list would only restate the mapping the code already states).
- Catch-all: an unrecognised code (`server.binary_offline`) lands on `'unclassified'`.
- Catch-all, malformed: payload absent, `null`, a string, an array, a record with no `code`, and a record with a non-string `code` each land on `'unclassified'` — asserted as neither a throw nor a `null`, and with `in_reply_to` still crossing, which is the property the four correlations depend on.
- Prototype safety: a payload whose own key is `__proto__` narrows to `'unclassified'` and alters no prototype (asserted by reading back an unrelated object's property, not by inspecting the payload).
- The three existing exact-`toEqual` `daemon-error` assertions are repaired by **adding `outcome: 'unclassified'`** and keeping `toEqual`. Their fixtures already carry codes outside the six, so they become catch-all coverage. Not loosened to `toMatchObject` — the exactness is what makes a leaked `code` or `message` fail the suite.
- Log no-leak: the existing #116 log test stays green unchanged, and gains one assertion that the record does not contain the wire **code** string (it already pins the `message`). The code is the field this slice newly reads, so it is the field newly worth pinning.
- The test name `it('narrows a daemon error into a content-free { kind: daemon-error }')` is rewritten to describe the scoped rule.

`src/main/transport/fakeDaemon.test.ts` — the reject builder:

- Answers the named chunk with the named code, `in_reply_to` set to that chunk's envelope id.
- Returns `[]` for a different index, for a non-`attachment_chunk` type, and for an undecodable frame.
- Round-trip: a frame the builder produced, fed through `parseInboundMessage`, yields the matching outcome and — by exact `toEqual` — nothing else.

## Open questions

1. **Does `message.too_long` reach this leg as an `error` envelope correlated by `in_reply_to`, like the five `attachment.*` codes?** The ticket asserts it does and that it is raised by the transport rather than the attachment path. It does not change the mapping either way — the switch keys on the code string wherever it originates — but the fake's fixture should carry a message consistent with whatever the transport actually sends. Resolve by reading the transport's emit site in `pyrycode` during Phase B; if the transport's static message is not readily located, the fake carries a fake-owned static string and says so in its comment.
2. **Naming of the catch-all: `'unclassified'` vs `'unknown'`.** `'unclassified'` is chosen because it names what this *client* did (declined to classify) rather than implying a property of the frame, and because it reads correctly for both of its causes — an unrecognised code and an unparseable payload. Settled unless implementation surfaces a conflicting house convention.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The untrusted→trusted crossing is one named function, `narrowDaemonErrorOutcome`, and the trust signal is carried in the type system rather than by convention: `DaemonErrorOutcome`'s every inhabitant is a source literal, so a value of that type provably holds no daemon text. The concrete way an implementer could breach it is a `default: return code as DaemonErrorOutcome` or a `Record`-keyed table; both are forbidden in § Design and the unrecognised-code test reddens on either.
- **[Tokens, secrets, credentials]** Not applicable, by design rather than by luck: this slice reads one field of one inbound frame, retains nothing, writes nothing, and touches no credential path.
- **[File / storage operations]** No findings. Nothing is written. The `CLAUDE.md` hazard — daemon text as a filename, cache key or lookup path — is closed structurally: the raw `code` is a *comparand* in a `switch` and is never the operand of an index, a join, or a resolve. The value that continues downstream is client-owned, so even a future consumer that did use it path-like could not be steered by the daemon.
- **[Inter-process / Electron attack surface]** No findings. No IPC channel, `contextBridge` API, `BrowserWindow` option, protocol handler or navigation guard is added or changed; `daemonConnection.ts` is not edited. The transport stays in the main process. The one forward-looking note: when #861 carries an outcome across IPC, it will be carrying a client-owned literal, which is the safe shape by construction.
- **[Cryptographic primitives]** Not applicable. No RNG, no key, no nonce, no comparison against a secret. The Noise session and its `(key, nonce)` discipline are upstream of this function and untouched.
- **[Network & I/O]** No findings. The frame is already bounded by `MAX_PLAINTEXT_BYTES` at the top of `parseInboundMessage`, before this arm runs, so a hostile daemon cannot amplify memory through an enormous `code`: the string is compared and dropped, never copied, retained, or concatenated. No new socket, timeout, TLS setting or reconnect path. Deliberately **no** new length cap on `code` — a cap would imply the value is retained somewhere, which is the impression to avoid.
- **[Error messages, logs, telemetry]** **SHOULD FIX.** The diagnostic record must keep its client-owned `code: 'error'` literal. ADR 0007's allowlist is enforced over field *names*, not values, so `code: payload.code` typechecks cleanly and would ship a daemon-controlled string into a JSON-lines log an operator can ship off-box in a debug bundle. The design says keep the literal — but a prose rule is a stochastic guard, so Phase B adds a **deterministic** one: the existing #116 log test gains an assertion that the emitted line does not contain the wire code string. Separately, `narrowDaemonErrorOutcome` never throws, so there is no error message in which a value could be interpolated — the module's usual "category-only message" discipline has nothing to police here.
- **[Concurrency]** No findings. The narrower is pure and synchronous with no shared state, so there is no check-then-act gap and no cancellation to thread. The fake's builder is stateless by construction — one number and one string in the closure, no arrival set — so two transfers interleaving on one session cannot race in it, matching `attachmentStoredReplyFrames`' own argument.
- **[Threat model alignment]** Three hostile-daemon scenarios, all named and dispositioned. (a) *A forged reject on a healthy upload* — the daemon can claim `attachment-storage-failed` for a transfer that was fine. Accepted and inherent: the daemon is the authority on whether an upload succeeded, so this is confusion, not escalation, and no client-side check can distinguish it. (b) *A malformed payload used to suppress the four existing correlations* — this is the sharpest attack the slice could have created, and it is precisely why the narrower returns a value instead of throwing: a mangled payload still yields a terminal `daemon-error` carrying `in_reply_to`, so #269 / #396 / #116 / #248 all still fire. Had this arm followed the module's usual throw idiom, `daemonConnection.ts`'s bare `catch { return }` would have handed a hostile daemon a one-frame kill switch for four correlations. (c) *An oversized or adversarial `code` string* — bounded upstream and never retained, per [Network & I/O]. The malicious-relay threat is unchanged by this slice (the relay is content-blind and on-path; it can drop or reorder an `error` frame exactly as before). Renderer compromise reaching the transport is out of scope here and unchanged — no renderer code ships.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-03

## Revisions

### 2026-09-03 — implementation

**Open Question 1 resolved: `message.too_long` has no upstream message to mirror.** `CodeMessageTooLong` is declared in pyrycode's `internal/protocol/codes.go` but has **no emit site anywhere in the Go tree** — the constant exists, nothing sends it. So there is no static transport message for the fake to be faithful to. `ATTACHMENT_REJECTS` in `fakeDaemon.ts` therefore carries a **fake-owned** static string for that one entry, labelled as such in its docblock, static and path-free like the five it does mirror. Nothing about the mapping changes: `narrowDaemonErrorOutcome` keys on the code wherever it originates.

**Open Question 2 resolved: `'unclassified'` kept.** No conflicting house convention surfaced; the name reads correctly for both of its causes.

**Design correction: "payload absent" is unreachable through the codec, and the plan's testing strategy overstated it.** The plan listed an absent payload among the catch-all inputs. In fact `decodeEnvelope` requires the `payload` **key** to be present and throws `WireDecodeError` when it is missing — before the `error` arm is ever reached, and identically for all ~28 frame types. So the shipped behaviour splits what the plan (and AC2's "payload is absent") treated as one case:

- **`payload: null`** — the reachable "absent value" shape, and what a peer omitting the field actually produces once it survives envelope decoding — lands on `'unclassified'` as a terminal `daemon-error`, exactly as the AC requires. Covered.
- **An envelope carrying no `payload` key at all** is a malformed **envelope**, not a malformed payload, and is rejected upstream by `decodeEnvelope`. This is pre-existing behaviour that predates this slice by many tickets. Admitting a key-less frame would mean weakening the envelope contract for every arm in the module — far outside this slice, and a change that should be argued on its own ticket if anyone ever wants it.

A test now records that split explicitly (`rejects an envelope with NO payload key in decodeEnvelope, upstream of this arm (pre-existing)`), so the boundary is documented rather than looking like a hole in the narrower. `narrowDaemonErrorOutcome` still handles `undefined` correctly for a direct caller; it is simply not reachable over the wire.

### 2026-09-03 — rework leg 1 (verifier findings on PR #990)

No design change: the contract, the narrower, the outcome union and the fake's builder are all as designed and as first shipped. Three defects in how that design was *placed on the page*, all found by the verifier.

**MUST FIX — the new declaration orphaned `InboundDaemonMessage`'s docblock.** `DaemonErrorOutcome`'s docblock and declaration had been inserted *between* the union's ~223-line contract docblock and `export type InboundDaemonMessage`, leaving two `/** … */` blocks stacked with no declaration between them. TypeScript binds a docblock to the declaration that follows it, so the union — the module's central published type, read at ~40 sites — was left with none, and the scoped-rule prose that AC4 statements 1 and 2 require was attached to no symbol. `DaemonErrorOutcome` now sits **above** the union's docblock, which also reads in the right order: the union's prose names the outcome type, so its referent is defined first. Verified with the TypeScript compiler API rather than by eye (each type reports exactly one jsdoc block), and the edit is a pure move — 49 lines removed, the same 49 added, identical multisets.

**The general lesson, worth more than the fix:** in this file a docblock is load-bearing contract documentation, so *where* a declaration is inserted is part of the change, not a formatting detail. Inserting between a docblock and its declaration silently detaches documentation from the symbol it describes, and — this being the failure mode the ticket was written around — prose fails no typecheck, no test and no lint. The check is cheap and mechanical: after adding a top-level declaration near an existing one, confirm every neighbouring docblock still touches its own declaration.

**SHOULD FIX — the `__proto__` fixture asserted nothing it claimed to.** `{ __proto__: { code: … } }` in an object **literal** is the prototype-setter form: it creates no own property, so `encodeEnvelope`'s `JSON.stringify` emitted `"payload":{}` and the test was an exact duplicate of the `{}` case one test above — coverage in name only, on a `security-sensitive` ticket whose plan lists prototype safety as a required case. The production code was always correct (a real `{"__proto__":{…}}` on the wire round-trips as an own key, `payload.code` is `undefined`, nothing is assigned); only the fixture was inert. It is now built with `JSON.parse`, the idiom the reserved-key tests further down the same file already use for exactly this reason. The fixture also **proves itself**: it asserts the encoded bytes contain `"__proto__"`, so a future rewrite into literal form reddens instead of silently passing against an empty payload — a deterministic guard rather than a comment asking the next reader to be careful.

**NIT — `Still surfaces NO error content.`** was kept verbatim while the sentences around it were rewritten to the scoped rule, so it read as absolute two lines below the narrowing statement. Now `Still surfaces NO daemon-supplied error content.`, which is what it always meant and is true under the scoped rule.

Gates after the fixes: `inboundMessage.test.ts` + `fakeDaemon.test.ts` 513 passed, `npm run build` green.
