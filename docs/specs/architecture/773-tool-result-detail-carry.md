# 773 — carry `result_detail` from the wire onto the timeline item

The plumbing slice for the daemon's structured-outcome count. It decodes one new optional wire
string, carries it across IPC, and lands it on the correlated `toolCall` item's `result`. It draws
nothing — [#856](https://github.com/pyrycode/pyrycode-desktop/issues/856) owns the row.

## Files read

| Path | Symbol | Why it matters |
|---|---|---|
| `src/shared/wire/types.ts` | `ToolResultPayload` | The wire shape the new field joins, beside `result_summary`; its doc comment carries the whole-payload contract this ticket amends. |
| `src/shared/wire/types.ts` | `ToolUsePayload` | The `input?` precedent — the only optional field on a payload in this file today, and the shape of the doc note an optional field needs. |
| `src/main/transport/inboundMessage.ts` | `parseToolResultPayload` | The decode site. Five `require*` calls today; the new field is the first optional one on this payload. |
| `src/main/transport/inboundMessage.ts` | `optionalStringMap` | #642's helper and the stated precedent: absent → `undefined`, present-but-wrong-typed → `WireDecodeError`, message names the client-owned field constant only. The new scalar helper is this posture minus the map walk. |
| `src/main/transport/inboundMessage.ts` | `requireString`, `requireStringOrNull`, `requireStringArray` | The narrower family this helper sits inside; message category (`missing required field:`) and fail-closed posture come from here. |
| `src/main/transport/inboundMessage.ts` | `parseInboundMessage`'s `tool_result` case | The narrow-BEFORE-log discipline and the content-free diagnostic field set (`code`/`bytes`/`hash`) the new field must also stay out of. |
| `src/main/daemonConnection.ts` | the `tool-result` case of the inbound switch | The wire → IPC mapping; the fresh-named-field-literal idiom (never a spread of the decoded payload). |
| `src/main/daemonConnection.ts` | the `tool-use` case of the inbound switch | The #642 precedent for emitting an optional field unconditionally, `undefined` when the wire omitted it. |
| `src/shared/ipc/events.ts` | the `toolResult` arm of `DaemonEvent` | The IPC contract the field joins; the `toolUse` arm directly above is the optional-field precedent. |
| `src/renderer/src/store/timelineBridge.ts` | `toDaemonThreadEvent`'s `toolResult` / `toolUse` arms | The IPC → store copy: a filter + fresh copy, and #643's unconditional-assignment rule for an optional field. |
| `src/renderer/src/store/threadTimeline.ts` | `ToolResult`, `ThreadEvent`'s `toolResult` arm, `reduceTimeline`'s `toolResult` arm, `fillResult` | Where the value lands on the item, and the same-reference no-op guard that must stay untouched. |
| `docs/knowledge/features/thread-timeline.md` § the `toolCall.input` note | — | The store-owns-no-display-opinion rule from #643: carry verbatim, single out no field, shorten nothing. |
| `docs/knowledge/features/inbound-message-decode-contract.md` § #642 | — | Why an optional field gets a NEW message category rather than `missing required field:`. |
| `docs/knowledge/features/inbound-message-decode-internals.md` § the log table | — | The per-code MUST-NOT-log field list the `tool_result` row must grow. |
| `pyrycode` `internal/protocol/interactive.go` → `ToolResultPayload.ResultDetail` | — | The landed upstream declaration, read directly: the field name, the no-`omitempty` rule, and the "absence and `\"\"` mean the same thing" comment. |
| `pyrycode` `internal/protocol/testdata/tool_result.json` | — | Pins the full payload shape with `result_detail` present and empty. |

## Design source

**Figma:** N/A — this slice renders nothing. The row that draws the value is
[#856](https://github.com/pyrycode/pyrycode-desktop/issues/856), and no file under
`src/renderer/src/screens/` is touched here. The visual-fidelity check is intentionally not applicable.

## Context

The daemon composes a short précis of a tool call's structured outcome — `"265 lines"`,
`"110 of 1676 lines"` — from the `tool_use_result` sidecar and ships it on `ToolResultPayload` as
`result_detail` (upstream pyrycode#2024, landed and closed). Desktop drops it on the floor today:
`parseToolResultPayload` copies five named fields and tolerates-but-does-not-copy everything else, so
the value never leaves the transport.

This ticket is the whole path from frame to item and nothing else, mirroring what #642 + #643 did for
`tool_use.input`. It ships dormant.

The verified upstream contract, read from the declaration rather than from the ticket body:

- The field carries **no `omitempty`**, so a current daemon always writes the key, empty when there is
  no count. Absence is still reachable (a daemon predating pyrycode#2024), which is why the field must
  be optional on this side — but per the upstream comment absence and `""` **mean the same thing**.
- Its **alphabet is digits, spaces and ASCII letters** and its length is bounded at construction: the
  producer formats decoded integers, so unlike `result_summary` it carries no claude-supplied byte.
  That is a statement about an *honest producer*, not a wire guarantee — a hostile daemon, or a peer
  impersonating one inside the Noise session, controls these bytes entirely. So it may not be read
  either as licence to skip escaping at the eventual sink (#856's problem, but inherited from here) or
  as an invitation to validate the alphabet on this side and fail closed on a violation. The second is
  the more tempting mistake and it is the cross-validate anti-pattern ADR 0002 rejects: a
  client-invented rule fail-closes a valid future frame. This field is handled exactly as
  `result_summary` is — narrowed to a string, then carried.
- The **unit words are carried on purpose**, because a client cannot tell a read from a search without
  switching on a tool name. Nothing on this path may parse, trim, or extract a number from it.

No ADR is warranted: this adds no member to any union and no new decision, only a field to an existing
payload on an established idiom.

### Sizing overage, declared

This is **six production files against the size-S ceiling of five**. The refiner declared the overage
and I re-derived it: the only available seam is decode-into-IPC versus carry-onto-item, and the first
half's sole consumer is its own sibling, which the floor rule forbids splitting out. The floor wins over
the ceiling, so it builds as one ticket with the overage stated here. Every other line of the table is
clear — no new exported type (`ToolResult` gains a field; the new narrower is module-private), no
consumer call site needing a simultaneous update (the field is optional at every stage, so no fixture
cascade), four acceptance criteria, one new reject branch. Nothing lands observable halfway.

## Design

One optional string threaded through six stages, camelCased at the IPC boundary exactly as
`result_summary` → `resultSummary` already is on four of them.

**1. `src/shared/wire/types.ts` — `ToolResultPayload`.** Gains `result_detail?: string`, beside
`result_summary`. Optional to the *client*, not on the wire — the `ToolUsePayload.input` precedent. The
existing doc comment's "all always present (no `omitempty`)" clause is amended: it is still true of the
daemon's writer, and the optionality here is about an older daemon, not about the current contract.

**2. `src/main/transport/inboundMessage.ts` — a new module-private `optionalString`.** Placed directly
after `optionalStringMap`, whose posture it is minus the map walk:

```ts
function optionalString(payload: Record<string, unknown>, field: string): string | undefined
```

- key absent (`undefined`) → returns `undefined`; the one case that does not throw
- a `string`, `""` included → returned verbatim
- anything else — `null`, a number, an object, an array → `throw new WireDecodeError(...)`

The message reuses `optionalStringMap`'s category, `` `malformed optional field: ${field}` ``, not
`missing required field:` — for an optional field that second category is actively misleading, since an
absent key is exactly the case that does not throw. It names the client-owned `field` constant only; no
daemon-supplied value is interpolated.

`parseToolResultPayload` gains one call and one key on the returned literal, set **unconditionally** —
`undefined` when the wire omitted it. The consumer contract is `payload.result_detail === undefined`,
never `'result_detail' in payload`.

**3. `src/main/daemonConnection.ts` — the `tool-result` emit.** One more named field on the fresh
literal, `resultDetail: inbound.toolResult.result_detail`, assigned unconditionally. Never a spread of
the decoded payload, so a decoder that later grows a field cannot smuggle it across IPC.

**4. `src/shared/ipc/events.ts` — the `toolResult` arm.** Gains `resultDetail?: string`, documented on
the `toolUse` arm's terms: absent means the wire omitted it, `""` is a value, and both states draw
nothing — a decision that belongs to the row, not here.

**5. `src/renderer/src/store/timelineBridge.ts` — the `toolResult` arm.** One more field on the fresh
`ThreadEvent`, assigned unconditionally. The arm stays a filter + fresh copy; `conversationId` still
stops here.

**6. `src/renderer/src/store/threadTimeline.ts`.** `ToolResult` gains `resultDetail?: string`; the
`ThreadEvent` `toolResult` arm gains the same; `reduceTimeline`'s `toolResult` arm passes it into the
object handed to `fillResult`. `fillResult` itself is **unmodified** — it takes an opaque `ToolResult`
and its same-reference no-op guard is orthogonal to the payload's shape.

### The invariant that runs the length of the path

**Absent and empty are carried distinctly, and neither is given a meaning here.** Every stage assigns
the field unconditionally rather than conditionally spreading it: a `...(detail ? { detail } : {})`
shape would silently fold `""` into absence, which is the lossy transform this ticket exists not to
perform. Equally, no stage may collapse absence into `""` for convenience. The two states are carried
faithfully because collapsing buys nothing, **not** because they are semantically distinct — per the
upstream comment they are not, and the decision that both draw nothing belongs to #856's row, exactly
where `ConversationScreen`'s existing `resultSummary` handling makes that call.

Structured clone preserves an `undefined`-valued property across `webContents.send`, so the renderer
sees the key present with an `undefined` value. Consumers therefore test `=== undefined`, never
`'resultDetail' in event` — the trap two shipped comments in this repo get wrong about their own path.

Nothing anywhere parses, trims, number-extracts, or length-checks the value. Its only eventual sink is
auto-escaped React children in #856.

## State + concurrency model

Unchanged in every respect. This is a pure widening of a data shape already carried by an existing
event: no new store slice, no new subscription, no async work, no timer, no teardown path, and no
change to `reduceTimeline`'s reference identity contract (`fillResult` is untouched, so the orphan and
duplicate paths still return the same array reference and the widened stall guard still behaves).

## Error handling

One new reject branch, in `optionalString`: a present, non-string `result_detail` throws
`WireDecodeError`, which `parseInboundMessage`'s caller in `daemonConnection` already handles by
**dropping the whole frame** without emitting and without throwing. That is the fail-closed posture the
rest of the payload already has, and AC2's second half.

**No length cap on the field, deliberately.** The nearest inbound bound is `parseInboundMessage`'s own
frame-level `MAX_PLAINTEXT_BYTES` guard (65519), applied to the inbound plaintext **before**
`decodeEnvelope` and therefore before any per-type narrower runs — the same guard the other narrowers in
`inboundMessage.ts` cite, `optionalStringMap` included. `decodeEnvelope` itself size-checks nothing,
which is precisely why that guard sits in `parseInboundMessage`; `maxPayload` on the `ws` socket in
`relayConnection` is the outer socket-level bound behind it, not the nearer one. With the frame already
bounded before the narrower is reached, a client-invented per-field cap would only fail-close a valid
future frame (the no-cross-validate posture, ADR 0002).

The decode still runs **before** the diagnostic log, so a frame malformed only in this new field leaves
no log record at all. The `tool_result` log stays the content-free `code`/`bytes`/`hash` set: the new
field never enters it, and the case's comment is widened to say so by name.

## Testing strategy

All vitest; no Playwright spec — nothing here is user-driven and nothing renders.

`src/main/transport/inboundMessage.test.ts` — the decoder contract, modelled on the existing
`result_summary` empty-vs-absent test:

- a `tool_result` carrying `result_detail: '110 of 1676 lines'` decodes it **byte-identical**, interior
  spaces and unit words intact (AC4)
- the pre-feature `TOOL_RESULT` fixture — which has no `result_detail` key — decodes without error and
  leaves the field `undefined` (AC2, first half); asserted as `=== undefined`, not via `in`
- `result_detail: ''` decodes as `''`, never as absent (AC3)
- a present non-string (`null`, a number, an object, an array) throws `WireDecodeError`, and the whole
  payload is rejected rather than the field being dropped (AC2, second half)
- the thrown message is exactly `malformed optional field: result_detail` and contains neither the
  daemon-supplied value nor a secret probe string
- the diagnostic-log leak test grows a secret `result_detail`: the record's key set stays exactly
  `bytes`/`code`/`event`/`hash`/`seq`/`ts` and the line contains no part of the value
- the malformed-only-in-`result_detail` frame writes **no** log line

`src/main/daemonConnection.test.ts` — the wire → IPC hop: a frame with the field emits one `toolResult`
event carrying `resultDetail` verbatim; a frame without it emits an event whose `resultDetail` is
`undefined`; a frame whose field is a non-string emits nothing and does not throw.

`src/renderer/src/store/timelineBridge.test.ts` — the IPC → store copy carries the value onto the
`ThreadEvent` and still drops `conversationId`; an absent one stays absent.

`src/renderer/src/store/threadTimeline.test.ts` — end of the path: a `toolUse` followed by a correlated
`toolResult` lands `resultDetail` on the item's `result` beside `isError`/`resultSummary`; `''` survives
as `''`; an absent one leaves the field `undefined` on the item; the orphan and duplicate same-reference
no-ops are re-asserted unchanged.

Fakes over mocks throughout — the existing `toolResultPlaintext` envelope helper and the store specs'
own event constructors, no new test double.

## Open questions

1. **Does the shared `TOOL_RESULT` fixture gain the key?** Leaning no: leaving it without
   `result_detail` makes it the pre-feature fixture AC2 asks for, and every existing `toEqual` against
   it keeps passing untouched. Resolve at implementation.
2. **Does `optionalString` land beside `optionalStringMap` or get folded into it?** Leaning separate:
   the two narrow different types and #936 already split `requireStringArray` out of
   `requireStringArrayOrNull` for exactly this reason.

## Revisions

**2026-09-02, during implementation — both Open Questions resolved as leaned; no design change.**

1. **The shared `TOOL_RESULT` fixture does NOT gain the key.** Left exactly as it was, which makes it
   the pre-feature payload AC2 asks for — a daemon predating pyrycode#2024 — and lets the new
   absent-decodes-clean test assert against it directly. Every pre-existing `toEqual` against the
   fixture kept passing untouched, confirming the no-fixture-cascade prediction: 912 unrelated tests in
   the four touched specs stayed green through the RED run.
2. **`optionalString` landed as its own narrower beside `optionalStringMap`,** not folded into it. The
   two narrow different types, and #936 had already split `requireStringArray` out of
   `requireStringArrayOrNull` on the same reasoning. It shares the map helper's message *category*,
   which is the part worth reusing.

**2026-09-02, after verifier review — the no-length-cap justification named the wrong bound. No design
or behaviour change; the conclusion was right, the stated mechanism was not.**

3. **`parseInboundMessage` DOES apply `MAX_PLAINTEXT_BYTES` to the inbound plaintext**, before
   `decodeEnvelope` and so before any per-type narrower runs. The Security review's `[Network & I/O]`
   finding asserted the opposite — that the constant is encode-only and `maxPayload` on the relay socket
   is the real inbound bound — and `## Error handling` and the `optionalString` docblock inherited it.
   All three now name the guard that exists, with the socket bound described as the outer one behind it.

   The error was half-true, which is what made it survive a review pass built to catch exactly this. The
   true half: `decodeEnvelope` really does size-check nothing, and the `MAX_PLAINTEXT_BYTES` hits in
   `src/main/transport/*Envelope.ts` really are all outbound builders. The false half: the inbound guard
   is not in either place — it is in `parseInboundMessage` itself, the very function whose narrowers were
   being reasoned about, and a grep read as a file-name survey walked straight past it. The neighbouring
   `optionalStringMap` docblock stated the correct mechanism forty lines above the new one the whole time;
   ten docblocks in that file cite the guard correctly. **The check that would have caught it: when a
   docblock's claim contradicts its immediate neighbour, the neighbour is the evidence, not the prose —
   read the guard's own code before asserting a bound does not exist.** Asserting an absence ("that
   constant is *not* the bound") demands strictly more evidence than asserting a presence, and this pass
   spent less.

## Security review

**Verdict:** PASS

The pass changed the plan twice — the Context now says the upstream alphabet note is a statement about
an honest producer rather than a wire guarantee, and Error handling now names the bound that actually
exists on the inbound path. Both are recorded as findings below.

**Findings:**

- **[Trust boundaries]** No MUST FIX. The untrusted → trusted crossing is a single explicit point,
  `parseToolResultPayload`'s new `optionalString` call; every later stage copies the field **by name**
  onto a fresh literal, never by spreading a decoded payload, so no stage can widen what crosses. The
  renderer holds it as `string | undefined` on a sealed union arm whose doc comment carries the
  never-a-raw-markup-sink constraint forward to #856. SHOULD FIX, folded into the plan: the upstream
  "digits, spaces and ASCII letters" note describes the honest producer, not the wire — a hostile
  daemon or a peer impersonating one inside the Noise session controls these bytes. It is licence
  neither to skip escaping at the sink nor to alphabet-validate here and fail closed (the ADR 0002
  cross-validate anti-pattern). Context now says so explicitly, because I wrote the provenance
  paragraph that invites both readings.
- **[Tokens, secrets, credentials]** Not applicable, and for a reason stronger than "the value can't be
  a secret" — that would be a daemon-side claim. This ticket adds no storage site, no comparison
  against a secret, and no new sink; `ToolResultPayload` carries one routing key and display text, and
  the new field joins the display half.
- **[File / storage operations]** No findings, verified rather than assumed. The value's terminal store
  is `conversationTimelineStore`, which is non-persisted **by design**: its header comment forbids the
  `localStorage` pattern that `defaultWorkspaceStore` and `pushNotificationPrefStore` do use, precisely
  because it would write conversation content to renderer-side web storage that survives the pairing
  boundary #757 enforces. Nothing on this path builds a path, filename, or cache key, and the debug
  bundle carries daemon-produced archives, not timeline items.
- **[Inter-process / Electron attack surface]** No findings. The only IPC leg is main → renderer on the
  existing `emitDaemonEvent` channel; no `ipcMain.handle`, no `contextBridge` addition, no new channel,
  no `webPreferences` change. There is no renderer → main leg at all — `ThreadEvent` is renderer-local
  and never travels back — so this adds nothing to the untrusted-to-trusted direction.
- **[Cryptographic primitives]** Not applicable: no RNG, no key, no nonce, no handshake code, and the
  value is never compared against anything, so the `timingSafeEqual` question does not arise.
- **[Network & I/O]** No client-invented per-field length cap, and the bound that makes one redundant is
  `parseInboundMessage`'s frame-level `MAX_PLAINTEXT_BYTES` guard (65519), applied to the inbound
  plaintext before `decodeEnvelope` and so before any narrower runs. `maxPayload` on the `ws` socket in
  `relayConnection` is the outer socket-level bound behind it. *(Corrected 2026-09-02 after review — this
  finding originally asserted the opposite, that `MAX_PLAINTEXT_BYTES` was encode-only and the socket was
  the only inbound bound. See `## Revisions`; the conclusion never changed, only the named mechanism.)*
- **[Error messages, logs, telemetry]** No MUST FIX, three checks. (a) The new `WireDecodeError`
  interpolates only the client-owned `field` constant; a test asserts the exact message and that no
  probe value appears in it. (b) The `tool_result` diagnostic record stays the content-free
  `code`/`bytes`/`hash` set, the narrow still runs before the log so a frame malformed only in this
  field leaves no record, and the existing leak test grows a secret `result_detail`. (c) `assertNever`'s
  guards stringify the **whole event** into an `Error`, so a missing bridge arm would leak this field —
  checked and not applicable here: `toolResult` has been an arm of every exhaustive bridge since #229
  and this ticket adds no arm and no union member.
- **[Concurrency]** Not applicable: no async work, no listener, no timer, no state mutated across an
  `await`. `fillResult` is unmodified, so the orphan and duplicate same-reference no-ops and the widened
  stall guard are untouched — re-asserted in the store spec as a regression guard rather than assumed.
- **[Threat model alignment]** Hostile daemon: the defences that matter are fail-closed-on-non-string,
  zero interpretation, and one escaped sink — all three present. Malicious relay: content-blind but
  on-path, so it can drop, delay, reorder or duplicate a `tool_result`; this path already absorbs that
  as `fillResult`'s deterministic no-op, unchanged here. Renderer compromise reaching the transport:
  unchanged, nothing new crosses toward main. **OUT OF SCOPE** — the DOM-sink discipline for the
  rendered value belongs to [#856](https://github.com/pyrycode/pyrycode-desktop/issues/856), which must
  render it as auto-escaped React children and never into an attribute, a URL, a filename, a cache key,
  or a log line.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
