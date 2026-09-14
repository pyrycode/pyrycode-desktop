# #1455 — decode the `context_usage` category breakdown

## Files read

- `src/shared/wire/types.ts` → `ContextUsagePayload` — the type this slice extends by two keys, and the
  docblock whose `THE FRAME CARRIES SIX MORE KEYS` paragraph becomes false the moment it does.
- `src/shared/wire/types.ts` → `ModelListPayload`, `WireModelOption` — the list-frame contract this slice
  mirrors: a never-null array, a `dropped_*` count carried verbatim, and the wire-order rule.
- `src/shared/wire/types.ts` → `SlashCommandListPayload`, `WireSlashCommand` — the same shape a second
  time, and the source of the `Wire`-prefix naming rule this plan applies in Open Question 1.
- `src/shared/wire/types.ts` → `BackgroundTask`, `QueuedItem`, `HistoryEntry` — the nested rows that take
  NO `Wire` prefix, which is what settles the row type's name.
- `src/main/transport/inboundMessage.ts` → `parseContextUsagePayload` — the function this slice extends,
  and the second docblock that contradicts the code after it lands.
- `src/main/transport/inboundMessage.ts` → `parseModelListPayload`, `parseModelOption` — the precedent the
  Technical Notes name for both halves: the inline `Array.isArray`-then-`raw.map`, the plain
  `requireNumber` for the dropped count, and the per-row `isRecord`-plus-`require*` parser.
- `src/main/transport/inboundMessage.ts` → `parseSlashCommandListPayload`, `parseSlashCommand` — the same
  pair once more; its docblock is where the never-null and do-not-infer-loss rules are already written.
- `src/main/transport/inboundMessage.ts` → `requireString`, `requireNumber`, `isRecord` — the three
  helpers used unchanged. Both `require*` police TYPE, not truthiness, which is what makes `''` and `0`
  survive as values.
- `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage` — the `context-usage` paragraph in its
  docblock also states the three-inventories-dropped rule and needs the same correction.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage` — the `context_usage` switch arm.
  Unchanged by this slice: it already calls the parser, and the log call already runs after narrowing.
- `src/main/transport/inboundMessage.test.ts` → `CONTEXT_USAGE_FRAME`, `CONTEXT_USAGE_EMPTY_FRAME`,
  `CONTEXT_USAGE`, `CONTEXT_USAGE_EMPTY`, `encodeContextUsage` — #1454 committed both wire fixtures whole,
  categories rows included; this slice extends the two EXPECTED constants rather than transcribing afresh.
- `src/shared/wire/types.test.ts` → `context-usage wire vocabulary (#1454)` — the describe AC5 requires
  updated, not deleted; its `not.toHaveProperty('categories')` assertion is the line that inverts.
- `docs/specs/architecture/1454-context-usage-reading-decode.md` — the sibling plan, including the
  security review that flagged the inventories as a must-review item for this slice.
- `docs/knowledge/features/inbound-message-decode-contract.md` — the public-contract overview for this
  decoder; read for the standing fail-closed and never-log postures, not edited (documentation stage owns it).
- `pyrycode/internal/protocol/interactive.go` → `ContextUsagePayload`, `ContextUsageCategory`,
  `ContextUsagePayload.MarshalJSON` — the SSOT for the two keys, the nil-to-`[]` normalisation, and the
  two-cut dropped-count arithmetic.
- `pyrycode/internal/protocol/testdata/context_usage.json`, `context_usage_empty.json` — the two committed
  fixtures AC5 binds the tests to.

## Context

#1454 decoded this frame's reading — `conversation_id`, `model`, `total_tokens`, `max_tokens`,
`percentage` — and deliberately left the frame's three inventories and their three dropped counts on the
wire, unread and uncopied. This slice decodes the first inventory: `categories`, a list of `{ name,
tokens }` rows, beside its own `dropped_categories` count. It is the third of four slices replacing the
first criterion of #1254 — the reading in #1454, this breakdown, the remaining two inventories in #1456 —
ahead of the IPC carry in #1419, the store in #1420 and the surfaces in #1421.

Nothing consumes the result yet. The arm ships as dormant as #1454's: `daemonConnection`'s inbound switch
has no catch-all, so the report stops at the decoder until #1419 claims it.

No ADR is warranted. Every decision here is a rule `parseModelListPayload` and `parseSlashCommandListPayload`
already settled for their own frames; this slice inherits rather than decides.

## Design source

N/A — a transport decoder with no rendered surface. The breakdown's first pixels land in #1421.

## Design

### 1. The row type — `src/shared/wire/types.ts`

**Add `export interface ContextUsageCategory`** immediately before `ContextUsagePayload`, mirroring the
daemon's `ContextUsageCategory` field-for-field in wire order:

```
name: string
tokens: number
```

Named without the `Wire` prefix — see Open Question 1. Its docblock carries the three facts the type
system cannot state, each drawn from the daemon's own comment:

- **Both keys are always present**, with no `omitempty`, so an empty `name` is a value and an absent key
  is a real defect. `tokens: 0` is the same statement one field over.
- **`name` is claude-authored descriptive text that crossed the SUBPROCESS TRUST BOUNDARY**, bounded by
  the producer and neither validated nor sanitized upstream. It is a LABEL, never a selector a client may
  branch on for authority: inert text only, never an HTML sink, an attribute, a URL, a Map key, an icon
  lookup, a CSS class, a lookup path, a filename or a log field. The committed fixture's
  `Messages <&>` carries markup metacharacters on purpose, and the escaping is owed at the render sink
  (#1421), not here.
- **`tokens` is one contribution and the contributions do not reconcile.** The daemon states the
  categories need not sum to `total_tokens`, and a shortened list makes the sum smaller still.

### 2. The payload type — `src/shared/wire/types.ts`

`ContextUsagePayload` gains two keys after `percentage`, in wire order:

```
categories: ContextUsageCategory[]
dropped_categories: number
```

`ContextUsageCategory[]` and never `| null`: `MarshalJSON` normalises a nil slice to `[]`, so a client
decoding into a non-optional array type never has to branch on null.

Three docblock edits, all corrections of statements this slice falsifies:

- The `THE FRAME CARRIES SIX MORE KEYS` paragraph becomes **four** — `mcp_tools`, `memory_files` and their
  two dropped counts — with the same declaration-and-parsing-land-together reasoning preserved for them.
- A new paragraph for the pair, stating: the list is **always present and never null**, so an empty array
  is the POSITIVE STATEMENT that claude reported no categories and a `null` or absent key is a real
  defect; the rows arrive as a **PREFIX in the producer's descending-token order**, any cut taking entries
  off the tail, so a shortened list is never a list with holes; and `dropped_categories` is
  **INDEPENDENT AND NOT INFERABLE** — it accumulates TWO cuts (the producer's entry and string caps plus
  the mapper's own frame-byte budget), so a retained list's length is no evidence of completeness and
  `categories.length + dropped_categories` is the true size, not something to reconcile. The committed
  fixture's `3` beside two retained rows is the case that proves it.
- The existing SECURITY paragraph gains `name` beside `model` in its inert-text prohibition, and the
  never-log clause extends to the rows: a category name is model-influenced text and a token figure is
  the same private-work side-channel the three integers already are.

### 3. The row parser — `src/main/transport/inboundMessage.ts`

`parseContextUsageCategory(payload: unknown): ContextUsageCategory`, placed immediately before
`parseContextUsagePayload`, shaped exactly like `parseModelOption` scaled down to two fields: an
`isRecord` gate throwing `WireDecodeError('malformed context usage category')`, one `requireString` for
`name`, one `requireNumber` for `tokens`, returning a fresh two-field literal.

Deliberate non-behaviours, each written into the docblock because each is a thing a later reader will
want to harden:

- **No emptiness check on `name`.** `requireString` checks the type, so `''` passes free — the daemon
  states both keys remain present even when `Name` is empty.
- **No range check on `tokens`, and no truthiness test.** `requireNumber` checks the type, so `0` is
  `0`. This is `parseModelListPayload`'s posture and the frame's own no-range-check rule one level down.
- **No trim, normalise, strip, escape or re-encode on `name`**, and no length cap. The producer bounds
  it at construction and `MAX_PLAINTEXT_BYTES` backstops the frame; a third bound here would be a
  client-invented one to keep in agreement (`parseSlashCommand`'s stated reason).
- **Message names the failure CATEGORY only, never the row INDEX and never a value** —
  `parseModelOption`'s rule verbatim: every string on a row is untrusted text, and an index would be a
  weak oracle over the breakdown that buys nothing.

### 4. The payload parser — `src/main/transport/inboundMessage.ts`

`parseContextUsagePayload` gains, after `percentage` and before the return:

```
const raw = payload.categories            // Array.isArray guard → WireDecodeError
const categories = raw.map(parseContextUsageCategory)
const dropped_categories = requireNumber(payload, 'dropped_categories')
```

and returns the fresh literal widened to seven fields. `Array.isArray(null)` is `false`, which is exactly
what fails `null` and an absent key closed; `raw.map` preserves wire order and allocates from the array
that ACTUALLY arrived rather than from the claimed count. One bad row throws the whole frame rather than
yielding a partial breakdown — `raw.map` propagates the first throw, so this is the precedent's behaviour
and not a new mechanism.

Its docblock's `THE SIX INVENTORY KEYS ARE DROPPED, NOT READ` paragraph is corrected to four, keeping the
forward-compat and prototype-pollution reasoning for the remaining pair and keeping the
`../../../etc/passwd` warning pointed at #1456. Two paragraphs are added: the never-null / positive-empty
rule, and the do-not-infer-loss rule with the two-cut arithmetic spelled out.

### 5. The union docblock — `src/main/transport/inboundMessage.ts`

`InboundDaemonMessage`'s `context-usage` paragraph states "the frame's three inventories and their three
dropped counts are on the wire and are decoded by the follow-on slices, not here". Corrected to name
`categories` as decoded here and the remaining two inventories as #1456's, with a sentence on the
never-null list and the independent count. No arm and no `FrameTimestamp` changes.

### 6. What does NOT change

`parseInboundMessage`'s `context_usage` case, its log call, `decodeHistoryEvent`, every IPC channel, every
store and every renderer file. The switch arm already calls the parser; narrowing still runs before
logging, so a malformed row still leaves no record at all.

## State + concurrency model

None. `parseContextUsagePayload` stays a pure synchronous function over one frame's plaintext. This slice
adds no store slice, no subscription, no timer and no async work, so there is nothing to cancel or tear
down. `raw.map` is synchronous and bounded by the array that arrived.

## Error handling

One failure mode, one result: any missing or mistyped field — the payload not a record, `categories` not
an array, a row not a record, a row's `name` or `tokens` mistyped, `dropped_categories` mistyped — throws
`WireDecodeError` and drops the frame **as a whole**, never a partial breakdown. That is five new reject
branches beside #1454's six. The throw propagates to `daemonConnection`'s existing decode boundary, which
already drops the frame on a `WireDecodeError`; this slice adds no handling there and surfaces nothing to
the UI, because nothing consumes the arm yet.

## Testing strategy

Vitest only (node environment); no renderer, no Playwright — this slice renders nothing.

`src/shared/wire/types.test.ts`, the existing `context-usage wire vocabulary` describe **updated to the
new shape rather than deleted** (AC5):

- The five-field literal grows the two keys; `not.toHaveProperty('categories')` inverts to an assertion
  that the rows are carried in wire order, while `not.toHaveProperty('turn_id')` and the two remaining
  inventories' absence stay.
- A `ContextUsageCategory` literal with `name: ''` and `tokens: 0`, pinning that both are values.
- The empty-reading case grows `categories: []` and `dropped_categories: 0`, pinning the empty array as
  distinct from an absence.

`src/main/transport/inboundMessage.test.ts` — `CONTEXT_USAGE` and `CONTEXT_USAGE_EMPTY` extended with the
decoded pair; the two wire fixtures are already committed and unchanged.

- **AC1 / AC5, both committed fixtures.** The populated one narrows to both rows in wire order with
  `dropped_categories: 3`; the empty one to `[]` with `0`. The decoded key set is asserted exactly, which
  is simultaneously the forward-compat assertion for the four keys still dropped.
- **AC1, the row's no-validation posture.** `name: ''` and `tokens: 0` decode; the adversarial
  `Messages <&>` crosses byte-for-byte, unescaped and untrimmed; `tokens` negative and huge decode.
- **AC2, the list-shape guard.** `categories: null`, absent, `'nope'`, `{}` and `42` each throw
  `WireDecodeError`; `[]` decodes to `[]` and is asserted distinguishable from the `undefined` an
  unobserved frame yields.
- **AC3, one malformed row fails the WHOLE frame.** A two-row list whose second row is bad throws rather
  than yielding the first; a row that is not a record throws; and the thrown message is asserted to
  contain no category name, no conversation id and no token figure.
- **AC4, `dropped_categories` through plain `requireNumber`.** `0` survives; absent / `null` / a string
  throw; a count of `3` beside two rows and a count of `0` beside two rows both decode untouched, which
  is what pins that nothing cross-checks the count against the length.
- **AC3's log half.** The existing content-free success-record test extended: the planted-secret absence
  checks gain a category name and a token figure, and the key set stays exactly `bytes, code, event,
  hash, seq, ts`. Plus no line at all on the new malformed-row throw path.

## Open questions

1. **`ContextUsageCategory` or `WireContextUsageCategory`?** Resolved during planning: **no prefix**. The
   rule is stated in `WireModelOption`'s own docblock — `Wire` is the prefix for a nested row *whose bare
   name is generic enough to be wanted again downstream* — and `ContextUsageCategory` fails that test,
   being already fully qualified by its frame. The nested rows whose bare names are equally specific take
   no prefix (`BackgroundTask`, `QueuedItem`, `HistoryEntry`), and each of those also collides with a
   daemon Go type name, so collision alone is not the criterion. `BackgroundTask` is the nearest
   structural twin: one row of a snapshot list frame carrying its own dropped count.
2. **Does `dropped_categories` deserve any relationship to `categories.length`?** Resolved during
   planning: no, and the docblock says so in capitals. The daemon's contract states the count is two
   cuts' worth of loss and that a client must not infer loss from a retained list's length in either
   direction. A cross-check would be a second place the count's validity is decided, free to disagree
   with the producer silently.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** **The finding this slice exists to raise: the exposure genuinely widens, and
  #1454's review must not simply be inherited.** That review could say the adversarial fixture values
  "never cross even as opaque data" because the fresh five-field literal dropped them. After this slice
  one of them — `Messages <&>`, markup metacharacters included — crosses as a decoded, typed,
  fully-trusted-SHAPE value. Nothing downstream exists to misuse it yet, which is exactly why the
  obligation has to be written into `ContextUsageCategory`'s docblock now, where #1419/#1421 will read it:
  **decoding makes the SHAPE trusted, never the CONTENT**. The boundary itself stays correct and
  single-sited — `parseContextUsageCategory` either returns a fully-typed row or throws — so this is a
  carry-forward obligation, not a hole.
- **[Trust boundaries]** `name` is precisely the shape of short label that invites a lookup: a React
  `key`, a legend index, a colour-by-category `Map`, a chart series id. `model` drew this finding at
  #1454 and `limit_type` at #1318, and a breakdown is a *stronger* invitation than either because a
  renderer naturally indexes rows by their label. This decoder is safe by construction — `raw.map`
  produces an ARRAY, and no container is ever built FROM a decoded value — so the hazard is entirely
  downstream: `byName[c.name] = c` on a plain object with a `__proto__` label writes through to
  `Object.prototype`, which is `WireModelOption.display_name`'s rule one frame over. Mitigated as a
  docblock prohibition naming `Map`-not-plain-object, for the verifier of #1420/#1421 to check against.
- **[Trust boundaries]** A finding considered and **rejected**: should the decoder escape, trim or
  normalise `name`? **No.** Escaping at a decoder is escaping at the wrong layer — it corrupts the value
  for every non-HTML sink and buys a false sense of safety at the real one. CLAUDE.md's 2026-08-20
  operator ruling is that daemon text may be rendered, escaped and length-bounded *at the sink*, and the
  fixture's metacharacters are committed upstream precisely so a decoder that mangles them reddens.
- **[Tokens, secrets, credentials]** Not applicable, structurally: the rows carry no token, no nonce and
  no correlation secret. Stated rather than skipped so the log rule below is understood to rest on
  content-leak and side-channel grounds, not on secrecy.
- **[File / storage operations]** Nothing touches the filesystem, and no decoded value reaches a path.
  Worth stating rather than skipping, because the daemon's populated fixture carries `../../../etc/passwd`
  as a `memory_files` path — the clearest possible statement that these inventories are a path-traversal
  surface. That specific field stays undecoded and OUT OF SCOPE here; it is a MUST-review item for
  **#1456**. `name` is the same class of untrusted text one list over, so the docblock's never-a-filename
  clause is carried on it too rather than being treated as `memory_files`' problem alone.
- **[Inter-process / Electron attack surface]** Not applicable. No IPC channel, no `contextBridge`
  surface, no window, no protocol handler; the arm ships dormant in the main process and the renderer
  cannot observe this frame at all until **#1419**, which is where the IPC validation question actually
  lands. Noted for that slice: this payload is now variable-size, so it is the first `context_usage` field
  whose structured-clone cost across the hop is daemon-influenced.
- **[Cryptographic primitives]** Not applicable — no key, no nonce, no comparison against a secret, no
  change to the Noise session. The frame is plaintext only after the existing session decrypted it.
- **[Network & I/O]** **The one category where this slice adds a mechanism #1454 did not have, and its
  review's sentence "no list is iterated" is now false.** `raw.map(parseContextUsageCategory)` is the
  first iteration in this frame's decode over a daemon-supplied array. Verified rather than assumed:
  `parseInboundMessage` checks `plaintext.length > MAX_PLAINTEXT_BYTES` (65519) as its FIRST statement,
  ahead of `decodeEnvelope` and therefore ahead of the `JSON.parse` that materialises the array at all,
  so the array is already bounded — the tightest row spells about 22 bytes, capping it near 3000 entries —
  and `raw.map` allocates one more array of a length that is already in memory. Decisive and load-bearing:
  the allocation is from the array that **actually arrived**, never from the claimed
  `dropped_categories`, so the never-allocate-from-a-claim rule (`AttachmentChunkPayload`'s
  `new Array(total_chunks)` hazard) is satisfied by construction and nothing sizes, loops or indexes on
  the count. Also considered and not a finding: `map` skips holes, which would silently yield a shorter
  list — unreachable, because `JSON.parse` cannot produce a sparse array. A client-side entry cap is
  **rejected**, per AC4 and the daemon's stated no-second-place-for-a-limit rule.
- **[Error messages, logs, telemetry]** No findings, and this is the category with real content. Narrowing
  still runs BEFORE the log call, so a malformed row leaves no record at all. The new throw sites name the
  failure category only: a client-owned `'malformed context usage category'` literal, and the shared
  helpers' `missing required field: ${field}` where `field` is a client-owned name, never a value — so no
  category name, conversation id or token figure is interpolated, which matters because
  `daemonConnection` catches `WireDecodeError` into a caller that may log it. **The row INDEX is
  deliberately not in the message either** (`parseModelOption`'s rule): it would be a weak oracle over the
  breakdown for no diagnostic gain. The success record is unchanged and gains no field — a category name
  is model-influenced text landing in a file whose readers assume machine-written content, and a token
  figure per category is a *finer* side-channel on private work than the three frame-level integers
  already are, since it discloses composition and not just volume. Pinned by the exact-key-set assertion
  plus planted-secret absence checks extended to a name and a figure.
- **[Concurrency]** Not applicable. The parser stays pure and synchronous; `raw.map` is synchronous, no
  task is launched, so none needs an owner, a signal or a teardown.
- **[Threat model alignment]** **Hostile daemon response** is the live threat and is addressed at the row
  level, which is the new surface: every row field is parsed defensively, one bad row drops the WHOLE
  frame rather than yielding a partial breakdown, and a row's unknown or hostile extra key — a planted
  `__proto__` included — is tolerated without being copied, because each row returns its own fresh
  two-field literal. **Malicious relay** is unchanged: on-path and content-blind, and dropping or
  reordering this frame costs at most a stale breakdown, never a hang, because nothing awaits one.
  **Renderer compromise** cannot reach this code — it runs in the main process and exposes nothing.
  **Token theft from disk** is unrelated to this frame.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15
