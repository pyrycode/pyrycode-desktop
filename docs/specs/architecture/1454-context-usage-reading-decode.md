# #1454 — decode the `context_usage` frame's reading

## Files read

- `src/shared/wire/types.ts` → `EnvelopeType` — the inbound-type union the new member joins; `Envelope.type`
  is `EnvelopeType | string`, so admission is NOT compile-forced and has to be deliberate.
- `src/shared/wire/types.ts` → `RateLimitedPayload` — the #1318 precedent this slice mirrors: a flat
  five-field payload whose docblock carries the provenance and the never-log rule the type system cannot.
- `src/main/transport/inboundMessage.ts` → `parseRateLimitedPayload` — the fail-closed narrowing shape to
  clone: `isRecord` gate, bare `requireString` / `requireNumber` per field, fresh literal return.
- `src/main/transport/inboundMessage.ts` → `requireString`, `requireNumber`, `isRecord` — the three helpers
  this slice uses unchanged. Both `require*` police TYPE and not truthiness, which is what makes `''` and
  `0` survive as values.
- `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage` — the inbound union the new arm joins,
  and the docblock where each kind's provenance/log paragraph lives.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage` — the switch whose `default:` arm logs
  `inbound-unmodeled`; the new case is what stops `context_usage` reaching it.
- `src/main/transport/inboundMessage.ts` → `parseSessionSettingsPayload` — the bare-`requireNumber` posture
  for `used_tokens` / `window_tokens`, i.e. the route this frame is destined to displace as the display
  source, and the proof that no client-side range check is the house rule for a wire integer.
- `src/main/transport/inboundMessage.ts` → `decodeHistoryEvent` — gains NO arm; a stored `context_usage`
  keeps skipping, as `rate_limited` and `thinking_progress` do.
- `src/renderer/src/screens/conversation/contextUsage.ts` → `contextUsagePercent` — already documents what
  an unguarded `Infinity` does to a gauge. Named here to place that guard: it belongs to the render slice
  (#1421), not to this decoder.
- `pyrycode/internal/protocol/interactive.go` → `ContextUsagePayload` — the SSOT contract, including the
  mixed-provenance and informational-reading rulings this plan carries over.
- `pyrycode/internal/protocol/testdata/context_usage.json`, `context_usage_empty.json` — the two committed
  fixtures AC4 binds the tests to.
- `pyrycode/internal/protocol/codes.go` → `TypeContextUsage` — the wire literal (`context_usage`), and its
  binary → phone, v2-only, never-inbound-to-daemon posture.

## Context

The desktop's only context figure today is the `used_tokens` / `window_tokens` pair on `session_settings`
and `screen_snapshot`, which the daemon reconstructs by scanning the transcript on disk. That route reads
0% for a conversation opened in a workspace (pyrycode#2423) and its window half is a guess until a turn
ends. pyrycode#2370 declares the outbound `context_usage` v2 frame and #2371 publishes one after every turn
on the interactive path; both are merged. Decided 2026-09-14: the claude-reported figure becomes the
display source, the transcript route becomes the fallback.

This is the first of four slices replacing #1254's first criterion, on the `rate_limited` precedent: decode
here, IPC carry in #1419, store in #1420, surfaces in #1421. It decodes the frame's **reading** only —
`conversation_id`, `model`, `total_tokens`, `max_tokens`, `percentage`. The three inventories (`categories`,
`mcp_tools`, `memory_files`) and their three dropped counts arrive on the same wire and are deliberately not
read; the fresh-literal return tolerates them without copying them through, which is this file's standing
forward-compatibility posture. Two follow-on slices decode them.

No ADR is warranted: this slice adds no decision the `rate_limited` precedent has not already settled.

## Design source

N/A — a transport decoder with no rendered surface. The frame's first pixels land in #1421.

## Design

### 1. The wire type — `src/shared/wire/types.ts`

**Admit `'context_usage'` on `EnvelopeType`**, placed after `'rate_limited'`, with a docblock stating: v2
outbound (binary → phone), interactive-gated, conversation-scoped, no `turn_id`, and never accepted FROM a
client (`request_context_usage` is a different type and out of scope here). Admission is not compile-forced
— `Envelope.type` is `EnvelopeType | string`, so an arm on an unadmitted literal typechecks fine — so it is
pinned by a compile-time membership assignment in the wire-types test, exactly as #1318 pinned
`rate_limited`.

**Add `export interface ContextUsagePayload`** after `RateLimitedPayload`, declaring **only this slice's
five fields**:

```
conversation_id: string
model: string
total_tokens: number
max_tokens: number
percentage: number
```

The six inventory/dropped keys are **not declared**. Declaring a field this slice does not decode would put
a type on the wire surface with no narrowing behind it; the follow-on slices add them with their parsing.
The Go integers are `int`; a plain `number` like every other integer on this wire.

The docblock carries the two contract facts the type system cannot:

- **Mixed provenance.** `conversation_id` is DAEMON-authored — the mapper fills it from the daemon's own
  registry record, never from claude's bytes. `model` is CLAUDE-authored descriptive text that crossed the
  subprocess trust boundary and is neither validated nor sanitized upstream. Assuming one provenance for
  the whole struct errs harmfully half the time. `model` stays inert text: never a lookup key, a path, a
  Map key, an icon name, an attribute, a URL or a log field. It is NOT an identifier to match against a
  model menu — `model_announced` remains the identity authority.
- **The reading is informational.** The daemon neither recomputes nor normalizes claude's integers, so
  nothing may assume `percentage` is derivable from `total_tokens` and `max_tokens`, nor that either is in
  any particular range.

### 2. The parser — `src/main/transport/inboundMessage.ts`

`parseContextUsagePayload(payload: unknown): ContextUsagePayload`, placed beside `parseRateLimitedPayload`
and the same shape as it: an `isRecord` gate throwing `WireDecodeError`, then two `requireString`s and
three `requireNumber`s, returning a fresh five-field literal.

Deliberate non-behaviours, each written into the docblock because each is a thing a later reader will want
to "harden":

- **No range check on any of the three integers**, and no cross-field check. The house rule is
  `parseSessionSettingsPayload`'s bare `requireNumber`; the sharper reason is the daemon's, that the
  integers are claude's own and unnormalized, so a `percentage` over 100, a `total_tokens` exceeding
  `max_tokens`, or a negative would all be ordinary traffic. Rejecting one would be a validation rule with
  no captured negative case behind it. The `Infinity`-into-a-gauge guard belongs to #1421's render, where
  `contextUsagePercent` already documents it.
- **No truthiness test.** `requireNumber` checks the type, so `0` survives as `0` — and `0` is exactly what
  the empty fixture carries for all three. A `!value` guard would read the empty reading as an absence.
- **No emptiness check on either string.** `requireString` checks `typeof value !== 'string'`, so `''`
  passes free. The empty fixture's `conversation_id` and `model` are both `''`, and both are values.
- **No membership check on `model`.** Narrowing claude-authored text to a client-side set fail-closes a
  valid future frame — CLAUDE.md / ADR 0002 rank drift risk above cosmetic robustness.
- **Unknown keys tolerated, not copied.** The fresh literal is what makes this forward-compatible AND
  prototype-pollution-safe against a planted `__proto__`. Here the realistic "unknown" keys are not
  hypothetical: the six inventory/dropped keys are on every real frame and this slice must drop them
  silently rather than fail on them.
- **Messages name the failure CATEGORY only**, via the shared helpers' existing `missing required field:
  <name>` form. No decoded value is interpolated.

### 3. The union arm and the switch case

`InboundDaemonMessage` gains `| { kind: 'context-usage'; contextUsage: ContextUsagePayload }`, with its
paragraph in the union's docblock covering the mixed provenance, the informational reading, the absence of
a `FrameTimestamp` (that mix-in marks exactly the arms `decodeHistoryEvent` draws; this type gains none, so
stamping it would advertise a join nothing can perform), and the never-log rule.

`parseInboundMessage` gains `case 'context_usage':` beside the `rate_limited` case. **Narrowing runs before
logging**, so a malformed frame throws and leaves no record. The success branch emits the existing
content-free field set only — `event: 'inbound-decoded'`, a client-owned `code: 'context_usage'` literal,
`bytes: plaintext.length`, `hash: hashPlaintext(plaintext)`. No new `DiagnosticEvent` field, so #131's
renderer pin is untouched. The arm ships **dormant**: `daemonConnection`'s inbound switch has no catch-all,
so nothing consumes it until #1419.

### 4. `decodeHistoryEvent` gains no arm

A stored `context_usage` keeps skipping, as `rate_limited` and `thinking_progress` do. The existing
skips-by-stored-type `it.each` list gains the row, and a well-formed-payload discriminating skip test joins
its two siblings — that pair is what separates "skipped because dispatch has no arm" from "skipped because
the payload failed".

## State + concurrency model

None. `parseInboundMessage` is a pure synchronous function over one frame's plaintext; this slice adds no
store slice, no subscription, no timer and no async work, so there is nothing to cancel or tear down.

## Error handling

One failure mode, one result: any missing or mistyped field — and a non-record payload — throws
`WireDecodeError`, dropping the frame **as a whole**, never a partial value. That is the six reject
branches (`isRecord` plus one per field). The throw propagates to `daemonConnection`'s existing decode
boundary, which already handles a `WireDecodeError` by dropping the frame; this slice adds no new handling
there and surfaces nothing to the UI, because nothing consumes the arm yet.

## Testing strategy

Vitest only (node environment); no renderer, no Playwright — this slice renders nothing.

`src/shared/wire/types.test.ts` — a `context-usage wire vocabulary (#1454)` describe:

- The compile-time `EnvelopeType` membership assignment (AC1's admission half).
- `ContextUsagePayload` shapes as exactly the five fields — asserting `not.toHaveProperty` for `turn_id`
  (conversation-scoped) and for `categories` (this slice declares no inventory).

`src/main/transport/inboundMessage.test.ts` — an `encodeContextUsage` helper beside `encodeRateLimited`, and
two fixtures transcribed from the daemon's committed JSON: `CONTEXT_USAGE` (populated, carrying the
inventories verbatim so the drop is proven against a real frame) and `CONTEXT_USAGE_EMPTY`.

- **AC4, both fixtures.** The populated one narrows to `{ kind: 'context-usage', contextUsage: <the five> }`
  — which is simultaneously the forward-compat assertion, since the six inventory keys are on it and must
  not come back; the decoded key set is asserted exactly. The empty one narrows with `''`/`''` and `0`/`0`/`0`
  preserved, pinning that neither the type-not-truthiness posture nor an emptiness guard was introduced.
- **AC1's no-range-check half.** A table decoding a `percentage` of `0`, `100` and `127`, a `total_tokens`
  exceeding `max_tokens`, and a negative — the tests that redden if someone later "hardens" the parser.
- **AC2.** One malformed frame per required field: absent, mistyped, and `null` — five fields × three
  spellings — each expecting `WireDecodeError`; plus a non-object payload (`'nope'`, `['a']`, `null`).
- **AC3, three log tests** mirroring `rate_limited`'s: a content-free success record whose key set is
  exactly `bytes, code, event, hash, seq, ts` and whose line contains neither a planted secret
  conversation id, nor a planted secret `model` string, nor any of the three integers; no
  `inbound-unmodeled` record for the type any more; and **no line at all** on the malformed throw path.
- The `decodeHistoryEvent` skip row and its well-formed discriminating sibling.

## Open questions

1. **Where does `'context_usage'` sit in `EnvelopeType`?** Resolved during planning: after `'rate_limited'`.
   The daemon groups it alone in `codes.go`, but on this union the claude-derived-reading cluster
   (`thinking_progress`, `rate_limited`) is the nearest neighbourhood and keeps the docblocks readable
   together.
2. **Should the six inventory keys be declared on `ContextUsagePayload` now and parsed later?** Resolved
   during planning: no. A declared-but-unparsed field is a type with no narrowing behind it, and the
   follow-on slices own both halves together.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The design adds one narrowing at the existing untrusted→trusted
  boundary (`parseInboundMessage`), not a second boundary elsewhere: the frame arrives as opaque decrypted
  plaintext, `decodeEnvelope` does the structural narrowing, and `parseContextUsagePayload` does the
  semantic one in a single function that either returns a fully-typed value or throws. **Decoding makes the
  SHAPE trusted, never the CONTENT** — the standing rule on this file, and the reason the obligation is
  written into `ContextUsagePayload`'s docblock, where the carry and render slices will read it.
- **[Trust boundaries]** A finding the daemon's own contract raises and this plan must not flatten:
  **provenance is MIXED within one struct.** `conversation_id` is daemon-authored; `model` is
  claude-authored and unsanitized. A reader assuming either provenance for the whole payload is wrong half
  the time, and the harmful direction is the one that promotes `model` to a checked value. Addressed by
  naming the split field-by-field in the docblock rather than giving the type one blanket sentence.
- **[Trust boundaries]** `model` is exactly the shape of short token that invites a lookup — an icon name,
  a Map key into a model menu, a CSS class. `limit_type` drew the identical finding at #1318. It reaches no
  sink on this leg (nothing consumes the arm), so the mitigation is the docblock prohibition, carried
  forward for the verifier of #1419/#1421 to check against.
- **[Trust boundaries]** A finding considered and rejected: should the parser reject a `percentage` outside
  0–100, or one inconsistent with `total_tokens / max_tokens`? **No.** That is the range check AC1 forbids,
  the daemon states it neither recomputes nor normalizes claude's integers, and a client-invented bound
  would fail-close a valid frame for the worth of one odd-looking figure. The real hazard is downstream
  arithmetic (`Infinity` from a zero `max_tokens`), which is a RENDER concern and already has a home in
  `contextUsagePercent`.
- **[Tokens, secrets, credentials]** Not applicable, structurally: the frame carries no token, no nonce and
  no correlation secret. Stated rather than skipped so the log rule below is understood to rest on
  content-leak and correlation grounds, not on secrecy.
- **[File / storage operations]** Not applicable — nothing touches the filesystem. Worth stating because the
  daemon's own populated fixture carries `../../../etc/passwd` as a `memory_files` path, which is the
  clearest possible warning that **the inventories are a path-traversal surface**. This slice reads none of
  them, and the fresh-literal return means none crosses even as an opaque value. OUT OF SCOPE here and a
  MUST-review item for whichever slice decodes `memory_files`.
- **[Inter-process / Electron attack surface]** Not applicable. No IPC channel, no `contextBridge` surface,
  no window and no protocol handler is added; the arm ships dormant in the main process. The renderer
  cannot observe this frame at all until #1419, which is where the IPC validation question actually lands.
- **[Cryptographic primitives]** Not applicable — no key, no nonce, no comparison against a secret, and no
  change to the Noise session. The frame is plaintext only after the existing session has decrypted it.
- **[Network & I/O]** No findings. The slice adds no socket, no request and no timeout; the frame's size is
  already bounded by `parseInboundMessage`'s `MAX_PLAINTEXT_BYTES` guard upstream of the switch, and this
  decoder allocates nothing proportional to any decoded value — no list is iterated, and the three integers
  are read and stored, never used as a length, a capacity or a loop bound. That last point is the standing
  never-allocate-from-a-claim rule, and it transfers to #1421: a gauge must not size anything from
  `max_tokens`.
- **[Error messages, logs, telemetry]** No findings, and this is the category with real content here.
  Narrowing runs BEFORE the log call, so a malformed frame leaves no record at all; the success branch logs
  a client-owned `code` literal, the byte length and a one-way hash, and nothing decoded. That is strictly
  safer than the `default:` arm it replaces for the type, which logged the WIRE-SUPPLIED `envelope.type`.
  The exclusions are deliberate: `model` is unsanitized model-influenced text that would otherwise land in
  a file whose readers assume it is machine-written; the three integers disclose how much private work is
  in the window, a side-channel as unwelcome as the correlating `conversation_id` beside them. Pinned by an
  exact-key-set assertion plus planted-secret absence checks.
- **[Concurrency]** Not applicable. The parser is pure and synchronous; no task is launched, so none needs
  an owner, a signal or a teardown.
- **[Threat model alignment]** **Hostile daemon response** is the live threat and is addressed: every one of
  the five fields is parsed defensively, one bad field drops the whole frame, and a hostile addition of
  extra keys is tolerated without being copied through. **Malicious relay** is unchanged — it is on-path
  and content-blind, and dropping or reordering this frame costs at most a stale reading, never a hang,
  because nothing awaits one. **Renderer compromise** cannot reach this code: the decoder runs in the main
  process and exposes nothing. **Token theft from disk** is unrelated to this frame.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15
