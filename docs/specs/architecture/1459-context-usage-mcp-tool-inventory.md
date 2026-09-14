# #1459 — decode the `context_usage` MCP-tool inventory

## Files read

- `src/shared/wire/types.ts` → `ContextUsagePayload` — the type this slice extends by two keys, and the
  docblock whose `FOUR MORE KEYS` paragraph becomes false the moment it does.
- `src/shared/wire/types.ts` → `ContextUsageCategory` — the row this slice's row is one field wider than,
  and the source of the no-`Wire`-prefix rule and the inert-text docblock shape both reused here.
- `src/shared/wire/types.ts` → `QrPayload` — the repo's only acronym-bearing exported type name, weighed
  and set aside in Open Question 1.
- `src/main/transport/inboundMessage.ts` → `parseContextUsageCategory` — this row parser one field short;
  its docblock's four not-checked bullets are the ones this slice restates for a three-field row.
- `src/main/transport/inboundMessage.ts` → `parseContextUsagePayload` — the function this slice extends,
  and the second docblock that contradicts the code after it lands.
- `src/main/transport/inboundMessage.ts` → `parseModelOption` — the Technical Notes' older precedent for a
  three-field row: `isRecord` gate, the `requireString`s, a fresh literal, and the message-names-the-
  category-never-the-index rule this slice inherits verbatim.
- `src/main/transport/inboundMessage.ts` → `requireString`, `requireNumber`, `isRecord` — the three
  helpers used unchanged. Both `require*` police TYPE, not truthiness, which is what makes `''` and `0`
  survive as values.
- `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage` — the `context-usage` paragraph states
  the two-inventories-dropped rule and names #1456; both need correcting.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage` — the `context_usage` switch arm and its
  `MAX_PLAINTEXT_BYTES` first statement. Unchanged: it already calls the parser, and the log call already
  runs after narrowing.
- `src/main/transport/inboundMessage.test.ts` → `CONTEXT_USAGE_FRAME`, `CONTEXT_USAGE_EMPTY_FRAME`,
  `CONTEXT_USAGE`, `CONTEXT_USAGE_EMPTY`, `encodeContextUsage`, `categoriesOf` — both wire fixtures are
  already transcribed whole with their `mcp_tools` rows; this slice extends the two EXPECTED constants and
  mirrors the reader helper.
- `src/shared/wire/types.test.ts` → `context-usage wire vocabulary (#1454, #1455)` — the describe holding
  the vocabulary pin whose `mcp_tools` line inverts and whose `memory_files` line must survive.
- `pyrycode/internal/protocol/interactive.go` → `ContextUsagePayload`, `ContextUsageMCPTool`,
  `ContextUsagePayload.MarshalJSON` — the SSOT for the two keys, the wire order `name, server_name,
  tokens`, the nil-to-`[]` normalisation, and the two-cut dropped-count arithmetic. `ContextUsageMCPTool`'s
  comment is where the inert-`ServerName` trap is stated; `MCPReconnectPayload.ServerName` at the same
  file's `ServerName is checked by NOTHING anywhere` comment is the colliding field it warns against.
- `pyrycode/internal/protocol/testdata/context_usage.json`, `context_usage_empty.json` — read directly and
  confirmed to match the ticket's table byte-for-byte, the embedded newline in `query\ndocs` included.
- `docs/knowledge/features/inbound-message-decode-contract.md`, `-internals.md`, `-history-recent.md`,
  `inbound-message-decode.md` — the four overviews carrying the passages this slice falsifies; read for
  the standing fail-closed and never-log postures, NOT edited (documentation stage owns them).

Codegraph returned `CodeGraph not initialized for this project` — the worktree's `.codegraph/` exists but
is empty, so every symbol lookup above came from grep. Noted as an environment gap, not a shortcut.

## Context

#1454 decoded this frame's reading and #1455 its first inventory, `categories`, beside
`dropped_categories`. Two inventories are still on the wire, unread and uncopied. This slice decodes
`mcp_tools` — rows of `{ name, server_name, tokens }` — beside `dropped_mcp_tools`, third of four decode
slices replacing the first criterion of #1254; `memory_files` is #1460's, then the IPC carry in #1419, the
store in #1420 and the surfaces in #1421.

Nothing consumes the result yet. The arm stays as dormant as #1454's and #1455's: `daemonConnection`'s
inbound switch has no catch-all, so the report stops at the decoder until #1419 claims it.

The three list rules — never-null, prefix-order, independent dropped count — were derived and written for
`categories` at #1455. This slice EXTENDS those paragraphs to a second inventory rather than restating
them, which is the whole reason it is smaller than its predecessor. No ADR is warranted.

What is genuinely new is the row's second string, `server_name`, and the doctrine it needs is the daemon's
own: the field is **inert**, and its name collides with an actuation-crossing field one payload over.

## Design source

N/A — a transport decoder with no rendered surface. The inventory's first pixels land in #1421.

## Design

### 1. The row type — `src/shared/wire/types.ts`

**Add `export interface ContextUsageMCPTool`** immediately after `ContextUsageCategory` and before
`ContextUsagePayload`, mirroring the daemon's `ContextUsageMCPTool` field-for-field in wire order:

```
name: string
server_name: string
tokens: number
```

Named without the `Wire` prefix for `ContextUsageCategory`'s stated reason — already qualified by its
frame, claims nothing a consumer wants back. Acronym casing settled in Open Question 1. Its docblock
carries, each drawn from the daemon's own comment:

- **All three keys are always present**, no `omitempty`, so `name: ''` and `server_name: ''` are VALUES
  and `tokens: 0` is claude's reading of zero. A truthiness test on any of the three would read a
  legitimate row as malformed and drop the whole frame with it.
- **`server_name` IS INERT, and the collision is the trap the comment exists to defuse.** The daemon's
  `MCPReconnectPayload.ServerName` crosses an actuation seam verbatim and is validated by nothing; this
  one names a contributor to a READING. It is never an actuation target, never an authorization input, and
  must not be fed to an MCP verb, a reconnect, a tool invocation or a server lookup on the strength of
  having appeared here. Having the same spelling as a field that actuates is not having its meaning.
- **`name` carries the same constraint** — a tool DEFINITION's label, never a selector, never a handle to
  call. Both strings crossed the subprocess trust boundary, are bounded by the producer at construction
  and are neither validated nor sanitized upstream: inert text, never an HTML sink, an attribute, a URL,
  a Map key on a plain object, a lookup path, a filename, a CSS class or a log field. The committed
  fixture's embedded newline (`query\ndocs`) and `remote<mcp>` metacharacters cross byte-for-byte; the
  escaping is owed at the render sink (CLAUDE.md's 2026-08-20 operator ruling), never here.
- **The embedded newline is why the never-a-log-field clause is an INTEGRITY rule here, not only a privacy
  one** — the sharper half of the finding, and specific to this inventory: no `categories` fixture value
  carries a newline, this one does, and the diagnostic stream is line-delimited JSON. A consumer that
  logged a tool name would let a daemon-supplied string FORGE A LOG RECORD. The docblock states the
  mechanism rather than only the prohibition, so a later reader cannot weigh it as mere tidiness.
- **`tokens` is one contribution and the contributions do not reconcile** — `ContextUsageCategory`'s rule
  verbatim, one inventory over, and it is not range-checked in either direction.

### 2. The payload type — `src/shared/wire/types.ts`

`ContextUsagePayload` gains two keys after `dropped_categories`, in wire order:

```
mcp_tools: ContextUsageMCPTool[]
dropped_mcp_tools: number
```

`ContextUsageMCPTool[]` and never `| null`: `MarshalJSON` normalises a nil slice to `[]`.

Docblock edits, all corrections of statements this slice falsifies:

- `THE FRAME CARRIES FOUR MORE KEYS` becomes **two** — `memory_files` and `dropped_memory_files` — with
  the declaration-and-parsing-land-together reasoning preserved for them and the pointer re-aimed from
  the parked **#1456** to **#1460**. "fresh seven-field literal" becomes nine.
- The never-null / positive-empty / prefix-order paragraph and the independent-count paragraph are
  EXTENDED to name both inventories rather than duplicated. The fixture evidence is stated per list: `3`
  beside two categories, `5` beside two MCP tools — two independent counts, never cross-read, and the
  daemon states this frame divides one envelope across three lists and can cut all three at once, so a
  sibling's count is no evidence about this one either.
- The SECURITY paragraph gains `server_name` beside `model` and the rows' `name`, carrying the inert /
  never-actuate obligation up to the payload level, and the never-log clause extends to this inventory on
  **three** grounds rather than the breakdown's one: a per-tool figure is the same composition
  side-channel `categories` already is; a tool name is model-influenced text; and — new here — a server
  name is **WORKSPACE CONFIGURATION**, so this inventory is the first `context_usage` field that
  discloses what the operator has WIRED UP rather than only what claude read. A server named after
  internal infrastructure is exactly the string that must not ride into a log an operator may send
  off-box. The newline / log-forging mechanism from the row type is named once here too.

### 3. The row parser — `src/main/transport/inboundMessage.ts`

`parseContextUsageMCPTool(payload: unknown): ContextUsageMCPTool`, placed immediately after
`parseContextUsageCategory`, shaped as `parseModelOption` scaled to three fields: an `isRecord` gate
throwing `WireDecodeError('malformed context usage mcp tool')`, two `requireString`s for `name` and
`server_name`, one `requireNumber` for `tokens`, returning a fresh three-field literal.

Its docblock restates `parseContextUsageCategory`'s four deliberate non-behaviours for three fields — no
emptiness check on either string, no range check or running total on `tokens`, no trim / normalise /
strip / escape / re-encode / length cap on either string, no closed set on either — and adds two this row
needs alone:

- **No server lookup, no membership check against a known-servers list, and no join with `mcp_status`.** A
  client-side set of server names would fail-close a valid frame the moment a workspace adds a server, and
  pairing this reading against an actuation surface is exactly the crossing the daemon's comment forbids.
- **`requireString` and deliberately NOT `requireNonEmptyString`, and the reason is this row's inertness
  rather than convention** (AC1 mandates the former; Open Question 3 records the reasoning). The
  non-empty helper exists for a field whose `''` is a DISTINCT FAILURE MODE — Go's zero value arrives
  present, typed and empty, so a lookup key like `attachment_id` would decode to "a success naming
  nothing". That hazard needs a lookup to arise, and nothing looks this field up: `''` is a display value
  here, not a failed resolution. The docblock ties the two facts together, because **if a later slice ever
  makes `server_name` a lookup key, the helper choice must be revisited together with the prohibition** —
  they are one decision, and a future reader must not relax half of it.

Message names the failure CATEGORY only — never a value, never the row INDEX. Verified rather than
assumed: `requireString` / `requireNumber` interpolate the client-owned FIELD NAME into
`missing required field: ${field}` and never the value.

### 4. The payload parser — `src/main/transport/inboundMessage.ts`

`parseContextUsagePayload` gains, after `dropped_categories` and before the return, the same three lines
`categories` already has one inventory over: the `payload.mcp_tools` read, an `Array.isArray` guard
throwing `WireDecodeError('malformed context usage mcp tools list')`, `raw.map(parseContextUsageMCPTool)`,
and `requireNumber(payload, 'dropped_mcp_tools')`. Returns the fresh literal widened to nine fields.
`Array.isArray(null)` is `false`, which fails `null` and an absent key closed; `raw.map` preserves wire
order, allocates from the array that ACTUALLY arrived rather than from the claimed count, and propagates
the first row's throw so one bad row drops the whole frame. The two lists' local names must not collide —
`categories`' local is `raw`, so this one takes a distinct name.

Its docblock's `THE FOUR REMAINING INVENTORY KEYS` paragraph is corrected to two and re-pointed to #1460,
keeping the `../../../etc/passwd` path-traversal warning as #1460's must-review item; the
`categories`-shaped paragraphs are extended to name both inventories, with the two-independent-counts
fact stated once.

### 5. The union docblock — `src/main/transport/inboundMessage.ts`

`InboundDaemonMessage`'s `context-usage` paragraph is corrected: `mcp_tools` / `dropped_mcp_tools` are
decoded here, `memory_files` and its count remain #1460's, and the never-null / prefix-order / independent-
count sentences and the mixed-provenance sentence extend to the new row's two strings — with
`server_name`'s inert-never-actuate constraint named, because that is the one obligation a consumer
reading only this union docblock would otherwise miss.

### 6. What does NOT change

`parseInboundMessage`'s `context_usage` case, its log call, `MAX_PLAINTEXT_BYTES`, `decodeHistoryEvent`,
every IPC channel, every store and every renderer file. No `FrameTimestamp`. Both `memory_file`
assertions stay asserted until #1460.

## State + concurrency model

None. `parseContextUsagePayload` stays a pure synchronous function over one frame's plaintext. No store
slice, no subscription, no timer, no async work, so nothing to cancel or tear down. The second `raw.map`
is synchronous and bounded by the array that arrived.

## Error handling

One failure mode, one result: any missing or mistyped field — `mcp_tools` not an array, a row not a
record, a row's `name`, `server_name` or `tokens` mistyped, `dropped_mcp_tools` mistyped — throws
`WireDecodeError` and drops the frame **as a whole**, never a partial inventory. Six new reject branches
beside #1454's six and #1455's five. The throw propagates to `daemonConnection`'s existing decode
boundary, which already drops the frame on a `WireDecodeError`; this slice adds no handling there and
surfaces nothing to the UI, because nothing consumes the arm yet.

## Testing strategy

Vitest only (node environment); no renderer, no Playwright — this slice renders nothing.

`src/shared/wire/types.test.ts`, the existing `context-usage wire vocabulary` describe **updated, not
deleted**:

- The payload literal grows the pair; `not.toHaveProperty('mcp_tools')` INVERTS to wire-order and
  independent-count assertions, while `not.toHaveProperty('turn_id')` and
  `not.toHaveProperty('memory_files')` both STAY — deleting the latter would retire #1460's pin early.
- A new `ContextUsageMCPTool` literal test: `name: ''`, `server_name: ''`, `tokens: 0` all values, plus a
  hostile-string case pinning that the type promises nothing about either string's content.
- The empty-reading and the not-derivable-percentage literals grow `mcp_tools: []` / `dropped_mcp_tools: 0`.

`src/main/transport/inboundMessage.test.ts` — `CONTEXT_USAGE` and `CONTEXT_USAGE_EMPTY` extended with the
decoded pair; both wire fixtures already committed and unchanged. A `mcpToolsOf` reader mirroring
`categoriesOf`. Four describes mirroring #1455's, plus two corrections:

- **AC1 / AC5, both committed fixtures.** The populated one narrows to both rows in wire order with
  `dropped_mcp_tools: 5`; the empty one to `[]` with `0`. The existing exact-key-set assertion grows from
  seven keys to nine — simultaneously the forward-compat assertion for the two keys still dropped — and
  its `not.toContain('read_file')` INVERTS to an assertion that `read_file` now crosses, while
  `not.toContain('etc/passwd')` stays.
- **AC5, the row's verbatim crossing.** The fixture's embedded newline and `remote<mcp>` metacharacters
  reach the decoded value byte-for-byte, asserted against the literal fixture strings rather than a
  paraphrase; plus an adversarial untrimmed / unescaped case. `''` strings and `0` tokens decode;
  negative and huge `tokens` decode.
- **AC2, the list-shape guard.** `mcp_tools` as `null`, absent, a string, a number, an object keyed by
  name and a boolean each throw `WireDecodeError`; `[]` decodes to `[]` and is asserted distinguishable
  from the `undefined` an unobserved frame yields.
- **AC3, one malformed row fails the WHOLE frame.** A two-row list whose second row is bad throws rather
  than yielding the first; a non-record, null and array row throw; one case per required field missing,
  mistyped and null — the row's three included. The thrown message is asserted to contain no tool name,
  no server name, no conversation id, no token figure and no row index.
- **AC3's row-independence half.** A well-formed `mcp_tools` beside a malformed `categories` row and the
  reverse both throw, pinning that the two inventories are never crossed even in failure.
- **AC4, `dropped_mcp_tools` through plain `requireNumber`.** `0` survives; absent / `null` / a string
  throw; `5` beside two rows, `0` beside two rows and a huge count beside a 200-row list all decode
  untouched, which pins that nothing cross-checks either count against either length and that no
  client-side entry cap exists. Plus `dropped_categories: 0` beside `dropped_mcp_tools: 5` on one frame,
  pinning the two counts as independent.
- **Log corrections.** The existing content-free success-record test gains planted-secret absence checks
  for a tool name, a server name and a per-tool figure, with the exact key set still
  `bytes, code, event, hash, seq, ts`; and a no-line-at-all test on the new malformed-MCP-row throw path.

## Open questions

1. **`ContextUsageMCPTool` or `ContextUsageMcpTool`?** Resolved during planning: **`ContextUsageMCPTool`**.
   #1455 wrote the rule for this exact position into `ContextUsageCategory`'s docblock — a row whose bare
   name is already frame-qualified is "named plainly after the daemon's own type", as `BackgroundTask`,
   `QueuedItem` and `HistoryEntry` are — and the daemon's type is `ContextUsageMCPTool`. `QrPayload` is
   the repo's only counter-example and does not govern: it is a house-named client-side type with no
   daemon counterpart to mirror, so it is evidence about naming a new type, not about mirroring one. `MCP`
   is also the protocol's own capitalization, which is what a reader grepping across the two repos types.
2. **Should `dropped_mcp_tools` or the list be read against `categories`' pair in any way?** Resolved
   during planning: **no**, and the docblock says so. The daemon states each count is its own list's two
   cuts and that the frame can cut all three lists at once, so a cross-read between inventories is a
   second place the loss is decided, free to disagree with the producer silently. Pinned by a test rather
   than by the comment alone.
3. **`requireString` or `requireNonEmptyString` for `server_name`?** Raised by the security pass, resolved
   during planning: **`requireString`**, which is also what AC1 mandates. The question is real rather than
   rhetorical — `requireNonEmptyString`'s own docblock describes precisely this shape, a string that Go's
   zero value delivers present-typed-and-empty so the decode "reports success naming nothing" — but its
   hazard is a FAILED LOOKUP, and it therefore needs the field to be a lookup key. This one is inert by
   contract and resolved against nothing, so `''` is a display value rather than a resolution that
   silently found nothing, and the daemon states all three keys stay present when the strings are empty:
   fail-closing on `''` would drop a legitimate frame. Recorded because the two halves are ONE decision —
   a future slice that makes this field a lookup key inherits the obligation to revisit the helper.

## Documentation handoff

Pending for the documentation stage — the builder does not edit these files. Four passages describe
`mcp_tools` as undeclared and point at the parked #1456; each needs the count corrected to one remaining
inventory and the pointer re-aimed at #1460:

- `docs/knowledge/features/inbound-message-decode-contract.md` § the `ContextUsagePayload` contract block
  — `THE FRAME CARRIES FOUR MORE KEYS THAT ARE STILL DELIBERATELY NOT DECLARED HERE` and the "#1456"
  link beneath it.
- `docs/knowledge/features/inbound-message-decode-internals.md` § the `'context_usage'` arm entry — its
  `mcp_tools`/`memory_files` deliberately-not-read sentence, plus the new row narrower to record.
- `docs/knowledge/features/inbound-message-decode.md` § the `context_usage` summary — the three-inventory
  sentence and the "remain undeclared, for #1456" clause.
- `docs/knowledge/features/inbound-message-decode-history-recent.md` § the #1454 and #1455 entries — the
  three-inventory sentence and the "still #1456's" clause.

`docs/specs/architecture/1455-context-usage-category-breakdown.md` is a shipped plan and stays as written.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** **The finding this slice exists to raise, and #1455's review does not cover it:
  `server_name` is the first decoded field on this wire whose NAME COLLIDES WITH AN ACTUATION-CROSSING
  FIELD.** The daemon's `MCPReconnectPayload.ServerName` crosses an actuation seam verbatim and is
  validated by nothing in its package or in `internal/relay`; this one names a contributor to a reading.
  Two identically-spelled fields, one that actuates and one that does not, in a codebase where a
  consumer will eventually hold both. The realistic exploit is entirely downstream and entirely
  plausible: a context panel that offers "reconnect this server" from an inventory row would actuate an
  MCP verb on a string a hostile or confused daemon chose, with no validation anywhere on the path. The
  decoder itself actuates nothing, so the only lever available at this boundary is the prohibition —
  which is why the plan states it at THREE levels (the row type, the payload type, and the union
  docblock a consumer reading nothing else would see) rather than once, and why §3 forbids the
  `mcp_status` join at the parser. **Decoding makes the SHAPE trusted, never the CONTENT.** A
  carry-forward obligation for #1419/#1421, not a hole in this design.
- **[Trust boundaries]** `server_name` is a *stronger* invitation to index than `categories.name` was,
  because an inventory keyed by server is the obvious view model: `byServer[row.server_name].push(row)`
  on a plain object with a `__proto__` server name writes through to `Object.prototype`. This decoder is
  safe by construction — `raw.map` produces an ARRAY and no container is ever built FROM a decoded value
  — so the hazard is downstream, mitigated as a `Map`-never-a-plain-object docblock prohibition carried
  on both strings, and pinned by the planted-`__proto__` row test built through `JSON.parse` (the only
  construction that makes it an own property).
- **[Trust boundaries]** Considered and **rejected**: should the decoder escape, trim or normalise either
  string, or reject the embedded newline? **No.** Escaping at a decoder corrupts the value for every
  non-HTML sink and buys false safety at the real one; CLAUDE.md's 2026-08-20 operator ruling puts it at
  the sink. The newline is the daemon's own committed fixture value, so a decoder that mangles it reddens
  upstream's intent — the correct response is to name the log-forging mechanism it enables, not to
  sanitize the value here.
- **[Tokens, secrets, credentials]** Not applicable structurally — no token, nonce or correlation secret
  on these rows. Stated rather than skipped so the log rule below is understood to rest on
  configuration-disclosure, content-leak and integrity grounds rather than on secrecy.
- **[File / storage operations]** Nothing touches the filesystem and no decoded value reaches a path.
  Worth stating rather than skipping for two reasons. An MCP tool name is frequently path- or
  command-shaped in practice (`read_file` is the fixture's own), which is exactly the shape that invites
  a later `path.join`, so the never-a-filename and never-a-lookup-path clauses are carried on both
  strings. And the populated fixture's `../../../etc/passwd` remains undecoded: that field is
  `memory_files`' and stays **OUT OF SCOPE**, a MUST-review item for **#1460**, whose pin this slice
  deliberately leaves asserted.
- **[Inter-process / Electron attack surface]** Not applicable. No IPC channel, no `contextBridge`
  surface, no window, no protocol handler; the arm ships dormant in the main process and the renderer
  cannot observe this frame until **#1419**, where the IPC validation question actually lands. Noted for
  that slice: this payload now carries TWO variable-size lists, so its structured-clone cost across the
  hop is daemon-influenced on two dimensions rather than one.
- **[Cryptographic primitives]** Not applicable — no key, no nonce, no comparison against a secret, no
  change to the Noise session. The frame is plaintext only after the existing session decrypted it.
- **[Network & I/O]** `raw.map(parseContextUsageMCPTool)` is the SECOND daemon-supplied array iterated in
  one frame's decode, and the question a reviewer should ask is whether that doubles the exposure. It does
  not, and the reason is worth recording rather than assuming: both lists are materialised by the single
  `JSON.parse` behind `parseInboundMessage`'s FIRST statement, the `MAX_PLAINTEXT_BYTES` (65519) check —
  verified to sit ahead of `decodeEnvelope` and therefore ahead of that parse — so the two lists COMPETE
  FOR ONE BYTE BUDGET instead of each getting their own. The tightest MCP row spells about 38 bytes,
  capping this list near 1700 entries and both lists jointly at the same frame. Allocation is from the
  array that ACTUALLY arrived, never from `dropped_mcp_tools`, so the never-allocate-from-a-claim rule
  (`AttachmentChunkPayload`'s `new Array(total_chunks)` hazard) holds by construction and nothing sizes,
  loops or indexes on either count. A client-side entry cap is **rejected** per AC4 and the daemon's
  no-second-place-for-a-limit rule.
- **[Error messages, logs, telemetry]** No findings, and this is the category where the slice adds real
  substance. Narrowing still runs BEFORE the log call, so a malformed row leaves no record at all. The new
  throw sites name the failure category only: a client-owned `'malformed context usage mcp tool'` literal
  and `'malformed context usage mcp tools list'`, plus the shared helpers' `missing required field:
  ${field}` — verified by reading `requireString` / `requireNumber` rather than assumed, and `field` is a
  client-owned name, never a value. The row INDEX is deliberately excluded (`parseModelOption`'s rule).
  The success record gains no field, now on three grounds: composition side-channel, model-influenced
  text, and **workspace-configuration disclosure** — a server name names infrastructure the operator
  wired up, which is a category of leak `categories` did not have. **And the newline makes it an
  integrity rule, not only a privacy one:** the fixture's `query\ndocs` would forge a record in a
  line-delimited JSON stream if any consumer logged it. Pinned by the exact-key-set assertion plus
  planted-secret absence checks extended to a tool name, a server name and a per-tool figure.
- **[Concurrency]** Not applicable. The parser stays pure and synchronous; the second `raw.map` is
  synchronous, no task is launched, so none needs an owner, a signal or a teardown.
- **[Threat model alignment]** **Hostile daemon response** is the live threat and is addressed at the row
  level: every field parsed defensively, one bad row drops the WHOLE frame rather than yielding a partial
  inventory, and a row's hostile extra key — a planted `__proto__` included — is tolerated without being
  copied, because each row returns its own fresh three-field literal. Its sharpest form is the
  actuation-collision finding above: a daemon that plants a `server_name` matching a real configured
  server is the concrete attack, and the mitigation available here is the three-level prohibition plus the
  forbidden `mcp_status` join. **Malicious relay** is unchanged — on-path and content-blind; dropping or
  reordering this frame costs at most a stale inventory, never a hang, because nothing awaits one.
  **Renderer compromise** cannot reach this code — it runs in the main process and exposes nothing.
  **Token theft from disk** is unrelated to this frame.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15
