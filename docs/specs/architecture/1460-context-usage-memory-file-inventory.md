# #1460 — decode the `context_usage` memory-file inventory

## Files read

- `src/shared/wire/types.ts` → `ContextUsagePayload` — the type this slice extends by its last two keys,
  and the docblock whose `TWO MORE KEYS` paragraph goes rather than being decremented.
- `src/shared/wire/types.ts` → `ContextUsageMCPTool` — the row this slice's row mirrors field-for-field
  with different key names, and the source of the docblock shape, the no-`Wire`-prefix naming rule and
  the inert-text prohibition reused here.
- `src/shared/wire/types.ts` → `ContextUsageCategory` — the two-field row beneath it; the ordering and
  dropped-count doctrine that already generalises to "each inventory".
- `src/main/transport/inboundMessage.ts` → `parseContextUsageMCPTool` — this row parser field-for-field:
  an `isRecord` gate, two `requireString`s, one `requireNumber`, a fresh three-field literal.
- `src/main/transport/inboundMessage.ts` → `parseContextUsagePayload` — the function this slice extends
  a third time, and the docblock that states two memory-file keys are dropped rather than read.
- `src/main/transport/inboundMessage.ts` → `requireString`, `requireNumber`, `isRecord` — used
  unchanged. Both `require*` police TYPE and not truthiness, which is what makes `''` and `0` values;
  their message is `missing required field: <key>`, a category and never a value.
- `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage` — the `context-usage` arm paragraph
  that names `memory_files` as still-on-the-wire-and-undecoded.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage` — the `context_usage` switch arm.
  Unchanged: it already calls the parser, and its `MAX_PLAINTEXT_BYTES` check is already the first
  statement, ahead of the `JSON.parse` that materialises all three inventories.
- `src/main/transport/inboundMessage.test.ts` → `CONTEXT_USAGE_FRAME`, `CONTEXT_USAGE`,
  `CONTEXT_USAGE_EMPTY_FRAME`, `CONTEXT_USAGE_EMPTY` — both daemon fixtures are already transcribed
  whole, memory-file rows and traversal path included. The expected-reading constants are extended
  beside them; no fixture is transcribed fresh.
- `src/main/transport/inboundMessage.test.ts` → the `mcp_tools` describes (#1459) — the four-block test
  battery this slice mirrors, and the two shipped pins it inverts.
- `src/shared/wire/types.test.ts` → the `ContextUsagePayload` shape test — the third pin to invert.
- `pyrycode/internal/protocol/interactive.go` → `ContextUsageMemoryFile`, `ContextUsagePayload`,
  `MarshalJSON` — SSOT for the wire names, the wire order, the always-present rule and the
  nil-slice-to-`[]` normalisation. Its own comment states the path-is-not-a-handle constraint.
- `pyrycode/internal/protocol/testdata/context_usage.json`, `context_usage_empty.json` — the two
  committed fixtures, confirmed byte-for-byte against the transcriptions above.
- `docs/knowledge/features/inbound-message-decode-contract.md` — the passage the documentation stage
  folds; read to confirm this slice makes it false rather than merely stale.

## Context

The `context_usage` v2 frame carries a reading, three inventories and three dropped counts. #1454
decoded the reading, #1455 the `categories` pair, #1459 the `mcp_tools` pair. This slice decodes the
last pair, `memory_files` / `dropped_memory_files`, after which every key on the frame is read.

The doctrine is settled: `parseContextUsagePayload`'s shipped docblock already generalises the list
rule (never null, `[]` is a positive statement, rows are a tail-cut prefix in descending-token order)
and the dropped-count rule (independent, not inferable, never reconciled) to "each inventory". What is
new is the row's first string. `path` is **path-shaped descriptive text, not a file handle** — the
daemon's own comment states it in those words, and the daemon's committed fixture carries
`../../../etc/passwd` so the pass-through is pinned by a test rather than by prose. `type` carries the
same constraint and is descriptive text rather than a closed set.

No ADR is warranted: this slice adds no decision the `mcp_tools` slice did not already make. The
documentation stage owns the four overview folds listed under Documentation handoff.

## Design

### `ContextUsageMemoryFile` (new export, `src/shared/wire/types.ts`)

```ts
export interface ContextUsageMemoryFile {
  path: string
  type: string
  tokens: number
}
```

Wire order `path, type, tokens`, mirroring the daemon's `ContextUsageMemoryFile` field-for-field. Named
without the `Wire` prefix for `ContextUsageCategory`'s stated reason: a nested row already qualified by
its frame is named plainly after the daemon's own type. All three keys are always present (no
`omitempty`), so `path: ''`, `type: ''` and `tokens: 0` are values.

Its docblock carries three prohibitions the type alone cannot express:

1. **`path` is not a handle.** Nothing joins, cleans, resolves, normalises or opens it — not the daemon,
   not this decoder, not a consumer. Normalising would imply it names a real file this frame acts on.
   Render as inert text; never a link, a lookup path, a filename, a cache key, a React `key` or a key
   on a plain object (a `Map` if a consumer indexes by it). The `../../../etc/passwd` fixture value is
   the clearest possible statement of the shape, and it must cross verbatim.
2. **`type` is not a discriminant.** A field named `type` on a TypeScript interface, in a repo whose
   inbound union discriminates on `kind` and whose envelopes discriminate on `type`, is a standing
   invitation to `switch (row.type)` or to narrow it to a string-literal union. It is claude's own
   descriptive label, open by definition, and closing the set fail-closes a valid future frame. It is
   never an authority: nothing may branch security-relevant behaviour on it.
3. **`tokens` is one contribution and the contributions do not reconcile** — `ContextUsageCategory`'s
   rule one inventory over, no range check in either direction.

### `ContextUsagePayload` (extended)

Gains `memory_files: ContextUsageMemoryFile[]` and `dropped_memory_files: number` at the end, wire
order. Its docblock's `THE FRAME CARRIES TWO MORE KEYS THAT THIS TYPE DELIBERATELY DOES NOT DECLARE`
paragraph is **removed, not decremented** — after this slice nothing on the frame is undeclared, so the
statement has no true successor. Seven → eleven fields; the wire-order list, the "each inventory" and
"each dropped count" paragraphs and the SECURITY paragraph gain the third list and `path` / `type`.

### `parseContextUsageMemoryFile` (new, `src/main/transport/inboundMessage.ts`)

`parseContextUsageMCPTool`'s shape with different key names: an `isRecord` gate throwing
`malformed context usage memory file`, `requireString(payload, 'path')`,
`requireString(payload, 'type')`, `requireNumber(payload, 'tokens')`, returning a fresh three-field
literal. `requireString` rather than `requireNonEmptyString`, for the reason that sibling exists: `''`
is a distinct failure mode only where a string is a LOOKUP KEY, and nothing looks these up. No helper
is invented, nothing is validated beyond type, and the message names the failure category only — never
a path, a type, a token count or the row index.

### `parseContextUsagePayload` (extended)

A third inline `Array.isArray`-then-`raw.map` guard plus a plain `requireNumber`, appended after the
`mcp_tools` pair, returning a fresh eleven-field literal. The three lists are guarded, mapped and
counted independently; nothing crosses them.

## State + concurrency model

None. Both functions are synchronous, pure narrowings over an already-materialised object. No store
slice, no async task, no subscription, no teardown. The inbound switch in `src/main/daemonConnection.ts`
has no catch-all, so the decoded arm ships dormant until #1419 claims it.

## Error handling

Every failure is a `WireDecodeError` thrown out of the parser, caught where every other arm's is: the
frame is dropped whole, never partially. Failure modes and their layer:

| Failure | Where it fails | Result |
| --- | --- | --- |
| `memory_files` is `null`, absent or any non-array | the inline `Array.isArray` guard | whole frame |
| one row is not a record | `parseContextUsageMemoryFile`'s `isRecord` gate | whole frame |
| a row's `path` / `type` missing or mistyped | `requireString` | whole frame |
| a row's `tokens` missing or mistyped | `requireNumber` | whole frame |
| `dropped_memory_files` missing or mistyped | `requireNumber` | whole frame |

`Array.isArray(null)` is `false` and an omitted key is `undefined`, so both fail on the same guard. One
bad row throws the whole frame because `.map` propagates the first throw — a half-populated inventory
presented as complete is worse than none, since nothing downstream could tell the two apart once
`dropped_memory_files` no longer accounts for the loss. No message interpolates a value: `path` is
workspace-authored text naming the operator's filesystem, `type` is claude-authored, and
`daemonConnection` catches `WireDecodeError` into a caller that may log it.

## Testing strategy

Vitest only, in the node environment; no renderer, no IPC, no Playwright. Two files, mirroring #1459's
four-block battery.

`src/main/transport/inboundMessage.test.ts` — extend `CONTEXT_USAGE` and `CONTEXT_USAGE_EMPTY` with the
decoded pair (the two `*_FRAME` fixtures already carry it), then:

- **rows (AC1/AC5):** both fixture rows in wire order, all three values untouched; the traversal path
  reaching the decoded value verbatim, asserted against the literal `'../../../etc/passwd'` and pinned
  as un-joined, un-cleaned, un-resolved, un-normalised (no leading-slash gain, no segment collapse); a
  row whose both strings are `''` and whose `tokens` are `0`; `tokens` negative / absurd / exceeding
  the window; an adversarial `path` and `type` crossing unescaped; `type` narrowed against no closed
  set; a row's unknown keys and a `JSON.parse`-planted `__proto__` dropped.
- **list shape (AC2):** empty `[]` decodes and stays distinguishable from `undefined`; `null`, a
  string, a number, an object keyed by path, a boolean and an absent key each fail the whole frame.
- **malformed row (AC3):** a table of one malformed row per required field — non-record, null, array,
  each of the three missing, each mistyped, each null — every one throwing rather than yielding a
  partial inventory; one message test asserting the category is named and no secret path, type,
  conversation id, token count or row index is; one test that the three inventories never cross.
- **dropped count (AC4):** `7` beside exactly two retained rows; the three counts `3, 5, 7` side by
  side; `0` beside a populated list, a huge count, a negative; `0` on the empty fixture; mistyped, null
  and absent each failing closed; 200 rows beside a claimed `9_000_000` allocating from the array that
  actually arrived.
- **inverted pins (AC5):** the key-set test becomes eleven keys with its "drops the TWO memory-file
  keys" framing gone, and its `expect(json).not.toContain('etc/passwd')` becomes `toContain` — the
  inversion being the point, since the traversal value now crosses as a decoded value. The
  payload-level forward-compat proof moves to the shipped planted-`turn_id` test, which is untouched.

`src/shared/wire/types.test.ts` — the three payload literals gain the pair; the
`not.toHaveProperty('memory_files')` pin is **inverted** into a positive assertion of the decoded rows
and count; a new `ContextUsageMemoryFile` shape test covers `''`/`''`/`0` as values and the traversal
path plus a hostile `type` as ordinary assignable values.

RED first: the row tests fail on `parseContextUsageMemoryFile` not existing and the payload tests on
the missing keys, before either production file is edited.

## Open questions

1. Does `type` need a distinct name in the decoded literal to keep it away from the envelope's own
   `type`? Resolve during implementation; the wire types mirror the daemon field-for-field, so the
   expected answer is no and the collision is addressed by the docblock rather than by a rename.
2. Should the traversal pin assert non-normalisation structurally (no `path.resolve` equivalence) or
   only by literal equality? Resolve while writing the row tests.

## Documentation handoff

Pending for the documentation stage; **not** done here. Four package overviews state that `memory_files`
and its dropped count are undeclared and name this ticket as the slice that will read them. All four go
false when this lands:

- `docs/knowledge/features/inbound-message-decode-contract.md` — the `ContextUsagePayload` block's "two
  more keys that are still deliberately not declared" passage, and the slice-ordering sentence.
- `docs/knowledge/features/inbound-message-decode-internals.md` — the `'context_usage'` arm entry.
- `docs/knowledge/features/inbound-message-decode.md` — the `context_usage` summary paragraph.
- `docs/knowledge/features/inbound-message-decode-history-recent.md` — the #1454/#1455/#1459 entries
  naming this ticket as the remaining slice.

Observable requirement: after the fold, no overview describes any `context_usage` key as undeclared or
unread, and the `path`/`type` inert-text decode and its traversal-fixture pin are recorded the way
`server_name`'s inert decode was at #1459. `npm run check:docs` must stay green.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] SHOULD FIX — the prohibition must land on all three docblocks, not two.** The
  boundary is explicit and single: `parseInboundMessage` → `parseContextUsagePayload` →
  `parseContextUsageMemoryFile`, one function per level, nothing parsed elsewhere. What the design does
  NOT give downstream is a type-system signal: after narrowing, `path: string` reads as trusted, and no
  branded type says otherwise. Inventing one here would be a client-invented pattern fanning out to
  #1419/#1420/#1421, so the discharge is #1459's: the prohibition is stated on the row type, on
  `ContextUsagePayload` AND on `InboundDaemonMessage`'s `context-usage` arm — that third one is the
  docblock the IPC-carry slice actually reads, and the plan's Design section names only the first two.
  Phase B must edit the union arm too.
- **[Trust boundaries] `path: string` is a worse invitation than any field before it on this frame.**
  `ContextUsageCategory.name` invites a Map key; `ContextUsageMCPTool.server_name` invites an MCP verb;
  `path` invites `fs.readFile`. The field NAME asserts a capability the value does not have. Stated as
  the row docblock's first paragraph, in the daemon's own words.
- **[Tokens, secrets, credentials] No token, key or credential is handled — but `path` adds a NEW
  disclosure ground to the existing no-log rule, and it is the strongest one on the frame.** The
  integers disclose how full the window is; `server_name` discloses what the operator wired up; a
  memory-file path discloses WHO THE USER IS AND WHERE THEY WORK — the daemon's own fixture value,
  `/Users/dev/project/CLAUDE.md`, leaks a home-directory username and a project name. SHOULD FIX: state
  this ground explicitly in the payload docblock's log paragraph, and make the AC3 message test's
  secret value home-directory-shaped so the pin is against the real hazard rather than a generic token.
- **[File / storage operations] No path is joined, resolved, opened or stat-ed anywhere in this slice —
  and pass-through verbatim is the CORRECT choice, not the lazy one.** Normalising or rejecting a
  traversal-shaped path would (a) fail-close valid traffic, since `../CLAUDE.md` is an ordinary
  memory-file reference in a monorepo and claude genuinely loads memory from parent directories, and
  (b) imply the string names a real file this frame acts on, which is the exact false implication the
  daemon's comment forbids. The defence is the prohibition plus the render sink, pinned by the
  `../../../etc/passwd` fixture test. TOCTOU, storage scope, atomic writes and encryption-at-rest are
  all N/A: nothing is read, written or persisted. Unbounded-length is covered — `parseInboundMessage`
  checks `MAX_PLAINTEXT_BYTES` as its first statement, ahead of `decodeEnvelope` and therefore ahead of
  the `JSON.parse` that materialises the rows (verified, not assumed).
- **[File / storage operations] SHOULD FIX — a path-shaped string can be a URL-shaped string.** The
  daemon constrains neither, so a `javascript:` or `file://` value arrives as an ordinary `path`. The
  prohibition "never as a link" must be concrete — never an `href`, never a `shell.openExternal`
  target — and the adversarial-crossing test must carry a `javascript:` and a `file://` value plus an
  embedded newline (POSIX paths may contain one, so #1459's forge-a-record integrity ground extends to
  this field), rather than mirroring #1459's `<img>` value and calling it covered.
- **[Inter-process / Electron attack surface] No IPC, no window, no `contextBridge` API, no protocol
  handler, no navigation is added, and the decoded value is NOT renderer-reachable today** — verified
  rather than assumed: `src/main/daemonConnection.ts`'s inbound switch has no `context-usage` case and
  no catch-all, so the arm ships dormant. OUT OF SCOPE, named: #1419 makes `path` cross
  `contextBridge`, and #1421 owns the render sink where an `href`, a `dangerouslySetInnerHTML` or an
  `openExternal` would be the live vulnerability. Both must carry the prohibition forward; this plan's
  three docblocks are what they will read.
- **[Cryptographic primitives] N/A by design, and the design decision is why: nothing here compares,
  derives or randomises.** No membership check on `type` and no known-path set means no comparison
  against any value exists, so `timingSafeEqual` has no site. No RNG, no key, no nonce, no hashing.
- **[Network & I/O] N/A — no socket, no URL dialled, no timeout, no TLS decision.** The frame arrives
  already decrypted through the existing Noise session; this slice adds no network surface. The
  URL-shaped-value hazard is filed under File / storage operations above, where the sink is.
- **[Error messages, logs, telemetry] No finding beyond the two SHOULD FIXes above.** `requireString` /
  `requireNumber` throw `missing required field: <key>` — a key name, never a value — and the row
  parser's `isRecord` gate throws a fixed category string. AC3 pins that no path, type, conversation
  id, token count or row INDEX reaches the message; the index is excluded as a weak oracle over the
  inventory, `parseModelOption`'s shipped rule.
- **[Concurrency] N/A — both functions are synchronous and pure.** No async, no listener, no timer, no
  shared mutable state, no check-then-act gap, nothing to cancel or tear down. The `.map` allocates
  from the array that actually arrived rather than from `dropped_memory_files`
  (AttachmentChunkPayload's never-allocate-from-a-claim rule), and iterating a THIRD daemon-supplied
  list does not multiply exposure: all three are materialised by one `JSON.parse` and compete for one
  byte budget.
- **[Threat model alignment] Hostile daemon response is the threat this slice IS, and it is addressed
  field by field:** fail-closed narrowing, whole-frame rejection over partial inventories, a fresh
  literal that copies nothing through. A malicious relay is content-blind and on-path only — dropping
  or reordering a `context_usage` frame costs a stale reading and nothing more. Token theft and
  renderer compromise are N/A here (no secret, nothing renderer-reachable).
- **[Threat model alignment] OUT OF SCOPE — `require*` reads inherited properties, repo-wide.**
  `requireString` uses `payload[field]`, so a globally polluted `Object.prototype.path` would satisfy
  it. No vector exists in this decoder: `JSON.parse` materialises `__proto__` as an own data property
  rather than setting the prototype, both parsers return fresh literals that copy nothing through, and
  the planted-`__proto__` row test pins it. Hardening the helpers to
  `Object.prototype.hasOwnProperty.call` would be an out-of-scope production change across every arm in
  the file (§ Scope Discipline), and it has no observed failure behind it. Named here rather than
  fixed; it belongs to a helper-level ticket if one is ever warranted.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15
