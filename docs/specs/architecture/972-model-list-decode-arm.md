# #972 — decode `model_list` fail-closed into an inbound arm

## Files read

- `src/main/transport/inboundMessage.ts` → `parseSlashCommandListPayload`, `parseSlashCommand`, the
  `case 'slash_command_list':` arm — the exact precedent (#936), the sibling frame from the same
  `initialize` control reply. Shape, docblock structure and arm comment are copied from here; the
  *evidence* in its security prose deliberately is not (see § Security review).
- `src/main/transport/inboundMessage.ts` → `isRecord`, `requireString`, `requireNumber`,
  `requireBoolean`, `requireStringArray`, `requireStringArrayOrNull` — every narrowing helper this
  slice needs already exists. `requireStringArray` rejects `null`; `requireStringArrayOrNull` admits
  it. That asymmetric pair *is* the AC4 contract; neither is tightened and no new helper is added.
- `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage` — the union the new `kind` arm joins.
  It lives in this file, not in `src/shared/`, so the whole production change is one file.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage` — the `MAX_PLAINTEXT_BYTES` guard is
  the function's first statement, ahead of `decodeEnvelope` and ahead of every per-type narrower. This
  slice adds no second cap.
- `src/main/transport/inboundMessage.ts` → `requireNonEmptyString` — read to establish that it is
  **not** used here. Its docblock records why `requireString` is right everywhere else.
- `src/shared/wire/types.ts` → `WireModelOption`, `ModelListPayload` — the types this decodes into,
  landed by #971. Their docblocks are the contract SSOT for the three different positions this one
  frame states on *empty*, and for the trust tier of its strings.
- `src/shared/wire/types.test.ts` § `model-list wire vocabulary (#971)` — the three upstream fixtures
  transcribed verbatim. This slice's test fixtures come from here, not from re-deriving the raw bytes.
- `src/main/transport/inboundMessage.test.ts` → `encodeSlashCommandList`, `SLASH_COMMAND_LIST`,
  `ONE_COMMAND`, the `slash_command_list recognition` / `fail-closed` blocks, the content-free-log test
  and the never-echoes-a-field test — the test layout this slice mirrors across all four places.
- `src/main/daemonConnection.ts` → the `switch (inbound.kind)` at the inbound consumer. It has **no**
  `default:` and no `assertNever`, so a new union member compiles green and ships dormant. That is
  what makes "no emit, no IPC arm, no store" a real state rather than a compile error waiting to fire.
- `docs/knowledge/features/inbound-message-decode-internals.md` § *Diagnostic logging (#130)* — the
  per-arm log row set, and the load-bearing rule that the `event()` call fires **after** the narrower
  returns so a malformed frame leaves no record.
- `docs/knowledge/features/model-list-wire-types.md` § *Bounds — deliberately not modelled*,
  § *Edge cases* — the producer's ten-entry cap is daemon-side and must never be mirrored client-side;
  and #971's own lesson that a type-only slice reds at `tsc` rather than at vitest. **This slice is not
  type-only** — its RED is vitest, because the narrowers are runtime code.
- `docs/knowledge/features/slash-command-list-wire-types.md` § *Related* — confirms the sibling
  relationship and the one place the two frames' security arguments diverge.

## Design source

**Figma:** N/A — this slice adds no UI. It is a main-process decoder; nothing renders, and the visual
fidelity check is intentionally skipped.

## Context

The daemon publishes the models claude will accept for a conversation. #971 modelled the wire
vocabulary (`WireModelOption`, `ModelListPayload`, the `model_list` member of `EnvelopeType`); nothing
yet turns bytes into one. This slice is that decoder, and only that: it adds a `case 'model_list':`
arm to `parseInboundMessage` plus the two narrowers behind it.

The frame is real and arriving — upstream's producer landed, and it is delivered to a client that
connects without sending a message first, which is the path this app actually takes when it attaches
to a long-running daemon. Until this arm exists, such a frame falls through to `parseInboundMessage`'s
`default:` and is discarded as unmodeled.

**No ADR is warranted.** Every decision here is an application of decisions already recorded: ADR 0002
(wire types match mobile; no client-invented bounds) and ADR 0007 (content-free diagnostics by
construction). The one novel judgement — that this frame's never-into-a-log clause rests on the
contract rather than on a measurement — is already written into `WireModelOption`'s own docblock by
#971 and belongs there, not in a new decision record.

## Design

One production file: `src/main/transport/inboundMessage.ts`. Two new private functions, one new union
member, one new `switch` arm, two added type imports. Nothing is exported that was not exported before.

**Union member**, added to `InboundDaemonMessage` after the `slash-command-list` member:

```ts
| { kind: 'model-list'; modelList: ModelListPayload }
```

**Row narrower** — the structural twin of `parseSlashCommand`, five fields scaled to six:

```ts
function parseModelOption(payload: unknown): WireModelOption
```

An `isRecord` guard (throws `WireDecodeError` on a non-record row), then `resolved_model`, `value` and
`display_name` through `requireString`, `effort_levels` through `requireStringArray`,
`supports_auto_mode` through `requireBoolean`, `truncated_fields` through `requireStringArrayOrNull`.
Returns a **fresh six-field literal**, so unknown server-added keys are tolerated but not copied
through — which is also what makes it prototype-pollution-safe without a reject list.

**Every string on this frame goes through `requireString`, never `requireNonEmptyString`.** The
all-zero fixture is legal traffic: no key on either struct carries `omitempty`, so `''` is a value.
`requireNonEmptyString` exists for `attachment_stored`, where an empty id is what a truncated frame
looks like; that argument does not transfer to a display label or to a conversation id here.

**The two array fields sit two fields apart with opposite contracts**, which is the same trap
`parseSlashCommand` carries one field apart: `effort_levels` may never be `null` (upstream collapses
absent / `null` / `[]` into one `[]` deliberately, so there is no absent form to model), while
`truncated_fields` may be `null` and that `null` is preserved rather than normalised to `[]`. Reaching
for the nullable helper on `effort_levels` would admit a value the wire never sends; normalising
`truncated_fields` would invent a distinction the wire does not carry (AC4).

**Payload narrower** — the structural twin of `parseSlashCommandListPayload`:

```ts
function parseModelListPayload(payload: unknown): ModelListPayload
```

An `isRecord` guard, `conversation_id` through `requireString`, an inline `Array.isArray` check on
`models` followed by `raw.map(parseModelOption)`, and `dropped_models` through plain `requireNumber`.
Returns a fresh three-field literal. Order is preserved from the wire (claude's own). One bad row
throws the **whole frame** closed rather than yielding a partial menu (AC3).

Note the asymmetry inside this one frame, invisible in the code: `models: null` fails closed
(`Array.isArray(null)` is `false`) while a row's `truncated_fields: null` decodes to `null`. Upstream
settles it — `MarshalJSON` normalises a nil `models` to `[]` and deliberately does not do the same for
a row's cut list.

**The arm**, placed after `case 'slash_command_list':` and before `case 'attachment_stored':`:
narrow first, then log, then return `{ kind: 'model-list', modelList }`. The ordering is the security
control, not a style choice — see § Error handling.

**Explicitly not in this slice** (AC5): no `DaemonEvent`, no emit, no IPC arm, no store, no renderer
change, and no consumer case in `daemonConnection.ts`'s inbound switch. A `model_list` frame that never
arrives changes nothing; one that does arrive decodes and stops here.

### Bounds deliberately not added

No entry cap, no per-string length check, no charset check, no closed set over the `truncated_fields`
element names, no cross-check of `dropped_models` against `models.length`. Each would be a
client-invented bound that fail-closes valid traffic the day the daemon changes its own, and the frame
is already bounded: `MAX_PLAINTEXT_BYTES` (65519) gates the plaintext before any parse. The producer's
ten-entry cap is daemon-side and may change without a contract change, so a list of exactly ten is not
a signal and the length is no evidence of completeness — `models.length + dropped_models` is the menu's
true size.

**`value` is the field where the temptation is strongest and the check would be most wrong.** It is the
one field a client sends back, and a `value` cut mid-token (`claude-fable-5[1m]` → `claude-fable-5`)
stays inside the daemon's charset-and-length rule and would be accepted on the way back. That makes a
cut row load-bearing data to carry through with its `truncated_fields` intact, not something to
validate away here.

## State + concurrency model

None. `parseInboundMessage` is a pure synchronous function over a byte array; this slice adds no
async work, no timer, no listener, no subscription and no shared mutable state, so there is nothing to
cancel and no teardown path to define. No store slice, no Zustand state, no IPC channel.

## Error handling

`WireDecodeError` (the module's existing type) on every rejection. The two failure signals of
`parseInboundMessage` are distinguishable **only at this boundary** and are not interchangeable:

- `return null` — the envelope's `type` is not one this function claims. Ordinary, not an error.
- `throw WireDecodeError` — the type *is* claimed and the payload is malformed.

Downstream cannot tell them apart (`daemonConnection` catches the throw and drops the frame,
unlogged), so every AC saying "rejects" means **throws**, and the tests assert `toThrow`, never
`toBeNull`. The one `toBeNull` assertion in this slice is the opposite pin: a well-formed envelope of
another unmodeled type still returns null, proving the arm widened nothing.

**Thirteen reject branches**, each its own test (AC3): a non-record payload; a non-string
`conversation_id`; a non-array `models`; a non-number `dropped_models`; a non-record row; a
wrong-typed value in each of the six row fields; a non-string element inside `effort_levels`; a
non-string element inside `truncated_fields`.

**Messages name the failure category only** — never a field value. The existing helpers already do
this; the two new `isRecord` guards use static literals in the same style. A value interpolated into a
message would ride into whatever log a future caller writes on the catch, which is exactly the sink
this arm's log discipline keeps it out of.

**Logging: narrow before you log.** The `diagnosticLog?.event(...)` call fires *after*
`parseModelListPayload` returns, so a malformed frame throws first and leaves no record. The field set
is the neighbouring arms' content-free one and nothing more — `event: 'inbound-decoded'`, a static
`code: 'model_list'` literal, `bytes: plaintext.length`, `hash: hashPlaintext(plaintext)`. No new
`DiagnosticEvent` field, so #131's renderer pin is untouched.

**Deliberately no `count`**, even though `DiagnosticEvent` already carries the field and emitting it
would cost nothing structurally: how many models claude offers for a session is itself a fact about
that session (the `background_task_roster` / `model_announced` posture, not `message_chunk`'s).

**`dropped_models` is not range-checked**, and that is a decision rather than an omission. JSON cannot
carry `NaN` or `Infinity`, so `typeof === 'number'` is complete against the wire; a negative or
fractional value is possible in principle from a hostile daemon and is carried through as-is, because
the sibling arm does the same, no such traffic has been observed, and a client-side range rule would
be a second place the count's validity is decided. The obligation lands on the eventual consumer:
render `models.length + dropped_models` defensively rather than trusting it as a positive count.

## Testing strategy

All vitest, in `src/main/transport/inboundMessage.test.ts`, driven through `parseInboundMessage` —
the narrowers stay private and are never imported directly, matching every sibling block. No Playwright
spec: nothing renders and nothing is interactive. No renderer test: nothing reaches the renderer.

Four fixture constants near the existing `SLASH_COMMAND_LIST` family, transcribed from
`types.test.ts`'s `model-list wire vocabulary (#971)` block rather than re-derived from the upstream
bytes: `MODEL_LIST` (the populated five-row fixture, one row with `truncated_fields: ['value']`, one
with `effort_levels: []` and `supports_auto_mode: false`, `dropped_models: 2`), `MODEL_LIST_EMPTY`,
`MODEL_LIST_ZERO`, and `ONE_MODEL` for building single-row reject cases. Plus an
`encodeModelList(payload: unknown)` helper alongside `encodeSlashCommandList`, wrapping the payload in
a whole envelope — the fixtures upstream are whole envelopes, and a bare payload would not reach the
arm at all.

Recognition block (`model_list recognition (#972, additive)`), as bullet-pointed scenarios:

- a full frame narrows to `{ kind: 'model-list', modelList: MODEL_LIST }` (AC1)
- every field on every row extracted distinctly and in the wire's own order — a row swap fails the
  ordered arrays, a dropped field fails its own, a flattened `effort_levels` or `truncated_fields`
  fails the last two (AC1)
- `resolved_model` decodes to the literal `<unmeasured>`, angle brackets and all — Go's encoder escapes
  `<` on the wire, so the escaping is a transport artefact and the decoded form is what is pinned
- `value` carried verbatim including the bracketed `opus[1m]` / `claude-fable-5[1m]`, nothing trimmed,
  normalised or re-encoded
- an empty `models` array decodes to `[]`, a value distinguishable from the `null` an unobserved frame
  yields; `dropped_models: 0` is a value, never truthiness-tested (AC2)
- an empty `effort_levels` decodes to `[]`, never to absent and never to a rejection (AC2)
- the all-zero fixture decodes: empty `conversation_id`, `resolved_model`, `value` and `display_name`
  are ordinary values, not absences (AC2)
- a row whose `truncated_fields` names `effort_levels` beside a row whose `truncated_fields` is `null`,
  both with `effort_levels: []` — asserted through the reading predicate, since the cut list is
  unknowable from `effort_levels` alone (AC4)
- `truncated_fields: null` stays `null`; `?.includes(...)` on it is `undefined`, not `false` (AC4)
- `dropped_models` carried verbatim beside any list length, including a non-zero count on an empty
  list; and no client-side entry cap (a 60-row frame decodes)
- no closed set over `truncated_fields` element names — an unknown future name decodes
- unknown server keys dropped at the frame level (a hoisted `truncated_fields`, a `turn_id`) and at the
  row level, keeping exactly the three and six known fields (AC5)
- a well-formed envelope of another unmodeled type still returns null — no widening

Fail-closed block (`model_list fail-closed (#972)`), one test per branch, each asserting
`toThrow(WireDecodeError)`; the omitted-key case is asserted alongside the wrong-type case in each
test, since nullable is not optional and both must fail:

non-record payload · non-string / omitted `conversation_id` · `models: null` (the asymmetry against a
row's valid `truncated_fields: null`) · omitted / non-array `models` · omitted / non-number
`dropped_models` · non-record row (frame fails whole, row 1 does not survive) · each of
`resolved_model` / `value` / `display_name` non-string or omitted · `effort_levels: null` on the very
row whose `truncated_fields` names it · omitted / non-array `effort_levels` · non-string element in
`effort_levels` · non-boolean `supports_auto_mode` (including the string `'true'` and `0` — never
coerced) · omitted `truncated_fields` · `truncated_fields` neither array nor null · non-string element
in `truncated_fields` · an oversized-but-valid-JSON plaintext.

Two additions to the existing cross-cutting blocks, mirroring #936's:

- content-free diagnostic log: one record, `code: 'model_list'`, exactly
  `['bytes','code','event','hash','seq','ts']`, and no sentinel from any of the seven string-bearing
  positions appears in the line; plus the paired test that a malformed frame logs nothing at all
- secret-safety: the thrown message never echoes a `conversation_id`, `resolved_model`, `value`,
  `display_name`, `effort_levels` element or `truncated_fields` element, with each case breaking one
  field while every sibling carries a distinctive sentinel

Gate: `npm test -- src/main/transport/inboundMessage.test.ts` and `npm run build`. If the build reds,
`npx tsc --noEmit -p tsconfig.web.json` runs separately before any error count is read as the blast
radius — `npm run typecheck` short-circuits on a node-side failure and hides every renderer error.

## Sizing

The ticket states, and this plan confirms after writing it, that two lines of the size-S table are
exceeded on purpose: ~1050 lines of total written work against 800, and 13 reject branches against 10.
Files (1 production source file), new exported types (0 — they landed in #971), consumer call sites (0
— nothing consumes the new union member) and acceptance criteria (5) are all inside.

Both overages are the same fact counted twice: one rejection test per branch is what the line count is
made of. Splitting is off the table on three independent grounds. **The floor** — the only seam is
`parseModelOption`, whose sole consumer is `parseModelListPayload` in the same file; one consumer means
one ticket, and the floor beats the ceiling. **The deliverable** — "a well-formed frame decodes and a
malformed one is rejected" is one thing, and holding back half the reject branches ships a decoder that
accepts malformed input on the rest, which is broken rather than smaller. **The depth cap** — #972 is a
grandchild (#556 → #561 → #972), verified against the parent chain, so a third level is forbidden
regardless. `needs-human:sizing` is already on the ticket for one operator glance.

## Open questions

1. **Does the union member need a corresponding no-op in the renderer bridges?** `daemonConnection.ts`'s
   inbound switch has no `default:` and no `assertNever`, so a new `InboundDaemonMessage` member
   compiles green with no consumer. The renderer-side `assertNever` guards switch on `DaemonEvent`, a
   different union this slice does not touch. Expected answer: no. Resolve by running `npm run build`
   and reading the result rather than by reasoning about it.
2. **Does `encodeModelList` need its own envelope `id`?** The sibling helpers each use a distinct
   literal (`903` for `slash_command_list`, `902` for `question_dismissed`). Pick the next unused one
   and confirm nothing asserts on it.

## Revisions

**2026-09-02 — open questions resolved during Phase B. No design change; the implementation matches the
plan above as committed.**

1. **No renderer-bridge no-op is needed.** Resolved empirically rather than by reasoning, as the plan
   said: `npm run build` typechecks both projects clean with the new `model-list` member on
   `InboundDaemonMessage`. `daemonConnection.ts`'s inbound switch has no `default:` and no
   `assertNever`, and the renderer-side `assertNever` guards switch on `DaemonEvent`, a union this
   slice does not touch. The arm ships dormant with no consumer edit anywhere.
2. **`encodeModelList` uses envelope `id: 907`.** 901–906 are taken by the existing helpers; nothing in
   the suite asserts on an envelope id for this frame.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — this slice *is* the boundary, and it is explicit and single:
  `parseModelListPayload`, reachable only through `parseInboundMessage`'s `case 'model_list':`, never
  through a bare `as ModelListPayload` on `Envelope.payload`. Data crosses from relay bytes (a
  content-blind but on-path relay, a daemon beneath it, claude beneath that) into a typed value.
  **The narrowing makes the SHAPE trusted and does not make the CONTENT trusted**, and the type system
  carries no signal for the difference — a `string` is a `string`. The arm comment and both docblocks
  must say so in as many words, because the consumers that follow (IPC carry, store, run-config sheet)
  are the ones that could read "decoded" as "sanitized". `resolved_model`, `value`, `display_name` and
  every `effort_levels` element are claude-authored text that crossed the subprocess trust boundary;
  the daemon bounds them and states plainly that it does not sanitize them, so the render boundary that
  owes the escaping is this client's.
- **[Tokens, secrets, credentials]** No findings — nothing on this frame is a secret. `conversation_id`
  is an outbound routing/scoping key granting no inbound capability, deliberately unlike
  `question_shown`'s `question_batch_id`, which is an unguessable one-time nonce. It is still kept out
  of the log, on the same content-free rule that covers the rest of the frame. No token is generated,
  stored, compared or rotated here, and no `safeStorage` interaction exists in this path.
- **[File / storage operations]** No findings — no field reaches a filesystem path, a cache key, a
  lookup path or a filename in this slice; the two narrowers build fresh object literals and touch no
  disk. The hazard is real but downstream and named as OUT OF SCOPE below.
- **[Inter-process / Electron attack surface]** No findings — this slice adds no `contextBridge` API,
  no `ipcMain` channel, no `BrowserWindow` and no navigation. The new `InboundDaemonMessage` member is
  main-process-internal and, per AC5, nothing forwards it to the renderer. Process placement is
  unchanged and correct: the decode stays in the background process, and no key, socket or raw byte
  moves toward the web layer.
- **[Cryptographic primitives]** No findings — no primitive is added or chosen. The arm reuses
  `hashPlaintext` (BLAKE2s-256 from `@noble/hashes`, since Electron's BoringSSL has no BLAKE2) for the
  log record's one-way digest, unchanged. No comparison in this slice touches a secret, so
  `timingSafeEqual` has no call site here.
- **[Network & I/O]** No findings, and the memory-exhaustion question has a concrete answer rather than
  a deferral. No socket, timeout, TLS setting or reconnect path is touched. The frame arrives already
  bounded — `MAX_PLAINTEXT_BYTES` (65519) is `parseInboundMessage`'s first statement, ahead of
  `decodeEnvelope` and ahead of this narrower — and adding a second cap here would be a second place
  the limit is decided, able to disagree with the first silently. **A hostile daemon cannot flood the
  row count**: `raw.map` allocates from the array that actually arrived, and the byte cap bounds a
  minimal row at roughly a hundred bytes, so a few hundred rows is the ceiling the transport already
  imposes. A client-side entry cap would buy nothing and would fail-close valid traffic the day the
  daemon raises its own.
- **[Error messages, logs, telemetry]** No findings, and this is the category where the plan needed the
  most care. Every message names the failure category only and interpolates no value, which matters
  because `daemonConnection` catches `WireDecodeError` into a caller that may log it. The `event()`
  call fires only after the narrower returns, so a malformed frame leaves no record — ordering, not a
  flag, is what keeps the throw path unlogged. The record is `code` (a static literal, never the
  wire-supplied `envelope.type` the `default:` arm would have logged), `bytes` and `hash`, with no
  `count`. **The never-into-a-log clause here rests on the CONTRACT, not on a measurement**, and
  transcribing the sibling's evidence would be a false factual claim about this frame: #936 argues from
  a measured `0x0a` across 51 workspace-authored entries; these strings are claude-authored, a higher
  trust tier, and no control byte is measured in these short labels. The honest statement is that the
  daemon bounds and does not sanitize, so a control byte is *permitted* by the contract rather than
  excluded by it — which is a sufficient reason to keep every decoded value out of a JSON-lines log the
  operator can ship off-box in a debug bundle.
- **[Concurrency]** No findings — `parseInboundMessage` is pure and synchronous. This slice launches no
  async task, sets no timer, registers no listener and mutates no shared state, so there is no
  cancellation path to thread, no check-then-act gap across an `await`, and no shutdown ordering to
  define.
- **[Threat model alignment]** Addressed for the threat this slice owns; two deferrals named. **Hostile
  daemon response** — this is precisely the threat the slice defends, and fail-closed narrowing over
  all thirteen branches is the defense; one bad row throws the whole frame rather than yielding a
  partial menu, so no half-populated model list can reach a consumer. **Malicious / compromised relay**
  — content-blind but on-path: it can drop, delay, reorder or replay this frame. Dropping it means the
  menu never arrives, which is why a consumer must never block a model menu on it; nothing here hangs
  or retries, because a decoder has no state to wait in. **Renderer compromise reaching the transport**
  — unchanged and unreachable: this slice moves nothing toward the renderer.
- **[Threat model]** OUT OF SCOPE — **`display_name` as an index key.** `WireModelOption`'s docblock
  names `display_name` as the intended join against a per-turn `model_announced` identifier, and warns
  that a consumer indexing rows by it must use a `Map`, never `index[row.display_name] = row`, where a
  `__proto__` label writes through to `Object.prototype`. This slice builds no container keyed by a
  wire string — it returns fresh fixed-key literals, which are prototype-safe — so the obligation lands
  on the store slice below this one in the family (#561's remaining children), not here.
- **[Threat model]** OUT OF SCOPE — **a replayed stale snapshot.** The frame is a snapshot that
  replaces a reader's view of the menu, so a replayed old one would show an out-of-date list. There is
  no reader yet and nothing to make stale; the freshness rule belongs to the store slice that first
  retains one.
- **[File / storage]** OUT OF SCOPE — **the render and re-send sinks.** `value` travels back to the
  daemon on `set_session_settings` and is re-validated there at `validModel` against an
  argv-injection rule; `display_name` and `resolved_model` reach a render boundary that owes escaping
  and length-bounding. Both sinks are later slices' to build; this one carries the values verbatim and
  says so.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
