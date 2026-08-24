# #642 — Decode the tool input map off `tool_use`

**Size:** S (PO's label, not overridden). Four production files, 0 forced call-site changes, 0 new exported types. See § Scope count.
**Labels:** `enhancement`, `size:s`, `security-sensitive` — the security-review pass at the end of this spec is mandatory and was run.

One optional field threaded down one existing chain: wire type → narrower → IPC event type → emit. Ships dormant; no consumer reads it in this slice (#643 carries it into the timeline bridge, #645 draws it).

---

## Files to read first

This is the turn-1 data load. Every design decision below points into this table.

| Path | What to extract |
|---|---|
| `src/shared/wire/types.ts:681-698` | `ToolUsePayload` + its doc comment. The comment's structure (wire order, "no `omitempty`", untrusted-string paragraph, render-slice pointer) is the template the new `input` paragraph extends. |
| `src/shared/wire/types.ts:700-718` | `ToolResultPayload` — the heaviest doc comment in the file and the convention this ticket's comment must match. |
| `src/shared/wire/types.ts:731-751` | `QueuedItem` / `QueueStatePayload` — the precedent that **wire payload types are mutable** (`queued: QueuedItem[]`, not `readonly`). Settles the `Record` vs `Readonly<Record>` choice on the wire side. |
| `src/main/transport/inboundMessage.ts:296-343` | `isRecord` (`typeof === 'object' && !== null && !Array.isArray`) and `requireString`. `isRecord` is the container gate the new helper reuses verbatim — it already excludes `null` and arrays. |
| `src/main/transport/inboundMessage.ts:345-379` | `requireStringArrayOrNull` (#564). **The posture to rotate from list to map.** Take: one bad element throws the whole payload closed; an empty container is valid; the result is a FRESH container so container-borne extras cannot ride along; the message names the field only. Its doc's last sentence draws the exact line this ticket crosses. |
| `src/main/transport/inboundMessage.ts:501-521` | `parseTurnStatePayload` — the fail-closed posture the ticket's AC2 cites (`state`: one bad value throws rather than degrading). |
| `src/main/transport/inboundMessage.ts:887-905` | `parseToolUsePayload` — the narrower this ticket extends by one line. |
| `src/main/transport/inboundMessage.ts:1461-1474` | The `tool_use` case in `parseInboundMessage`: narrow-then-log ordering, and the comment enumerating every field that is **not** logged. Comment-only edit here (AC4). |
| `src/main/transport/codec.ts:127-138` | `decodeEnvelope`'s `in_reply_to` / `event_id`. **The posture NOT to copy** — a present-but-wrong-typed value is silently dropped. AC2 is the opposite. Read it so you recognise the shape and reject it. |
| `src/main/daemonConnection.ts:820-832` | The `tool-use` emit arm. One field added to an existing fresh literal; note "a fresh literal, never a spread of the decoded payload". |
| `src/shared/ipc/events.ts:369-379` | The `toolUse` / `toolResult` `DaemonEvent` arms. Note `queueState` at `:389` uses `readonly QueuedItem[]` — **IPC arms are readonly** even where the wire type is mutable. |
| `src/main/transport/inboundMessage.test.ts:335-342` | The `TOOL_USE` fixture. Extend, don't replace — the existing tests spread it. |
| `src/main/transport/inboundMessage.test.ts:2569-2615` | The existing `tool_use` recognition + fail-closed describes. The `:2602` mistyped-field **table** is the shape the new type-rejection table follows. |
| `src/main/transport/inboundMessage.test.ts:3625-3660` | `logs a tool_use content-free` — the `SECRET_*` constant idiom plus the exact-key-set assertion (`['bytes','code','event','hash','seq','ts']`) and the per-secret substring sweep. AC4's test extends this one. |
| `src/main/daemonConnection.test.ts:319-322, 2776-2803` | `toolUsePlaintext` helper and the emit test. Note the assertion is `toEqual`, which treats an `undefined`-valued property as equal to an absent one — this is why the emit change causes no cascade. |
| `src/shared/wire/types.test.ts:520-543` | `tool-use wire vocabulary (#217)` — the compile-time shape block the new type-level cases join. |
| `docs/knowledge/codebase/217.md`, `229.md` | The two predecessor slices of this exact shape (wire type → narrower → IPC emit → no consumer). |
| `docs/knowledge/codebase/564.md` | `requireStringArrayOrNull`'s own slice — why fresh-container and one-bad-element-throws were chosen. |
| `docs/knowledge/decisions/0002-remote-head-over-relay-shared-wire.md` | The no-cross-validate / don't-invent-a-client-bound posture this ticket inherits. |

No codegraph query is recorded here: the desktop worktrees have no initialised index, and the two highest-value questions (who consumes `ToolUsePayload`, who consumes the `toolUse` arm) are answered by the emit site and the `DaemonEvent` union above.

---

## Design source

N/A — a wire type, a narrower, and an IPC event type. Not UI-visible; the pixels are #645's. The ticket body's `## Technical Notes` records the same, so code-review's visual-fidelity check is intentionally skipped.

---

## Context

`tool_use` carries five always-present strings today. pyrycode#1678 (merged as pyrycode PR #1682, on `pyrycode` `main` since 2026-08-21) added a sixth field, `input` — the tool's own input fields as an object of name → string value, so a client can eventually list what a tool is acting on instead of showing only the daemon's `input_summary` précis.

This slice decodes it and carries it to the renderer. Nothing reads it yet.

### The wire facts this design is built on

Read off the shipped daemon (`internal/protocol/interactive.go:81-88`, `docs/protocol-mobile.md:544`), not off the ticket that requested the field:

- The Go field is a **`map[string]string`** with **no `omitempty`**, and a custom `MarshalJSON` normalises a nil map to `{}`. So from a post-#1678 daemon the key is **always present and never `null`**; an absent input, an empty input, and a non-object input all arrive identically as `"input":{}`.
- **The absent-key case is exclusively a pre-#1678 daemon** — which is the case that must survive, because the operator runs daemon and client from builds days apart. This is optional *to the client*, not optional *on the wire*.
- **Every value is already a string daemon-side.** A JSON-string input value arrives decoded; every other JSON type arrives as its compact JSON form, so `null`, `true`, `[1,2]` arrive as those literal *strings*. This fact is load-bearing for the design decision in § 2.3.
- The daemon owns every bound (4000 runes per value; 8500 runes of keys plus values across at most 16 fields; a shortened value ends in `…`). A field may be **missing because the total bound dropped it**, and dropped fields are named nowhere — so the map is not guaranteed complete, and `input_summary` stays the whole-input fallback.
- **Key order on the wire is alphabetical**, a Go map-marshalling artefact, not the tool's argument order. No order guarantee is made here or inherited downstream.

---

## Design

Four production edits. Two carry real work; two are a single field on an existing literal.

### 1. `src/shared/wire/types.ts` — the wire field

Add one optional field to `ToolUsePayload`:

```ts
input?: Record<string, string>
```

Mutable `Record`, not `Readonly<Record>` — wire payload types in this file are mutable (`QueueStatePayload.queued: QueuedItem[]` at `:750`); the readonly form belongs on the IPC arm (§ 4), matching `queueState`'s `readonly QueuedItem[]`.

**The doc comment is part of the deliverable**, and is what carries the contract to #643 and #645 since nothing consumes the field here. Extend the existing comment (do not rewrite it) with a paragraph recording:

- `input` is the tool's own input fields, name → value; **display strings, not capabilities** — model-authored text that crossed the subprocess trust boundary, which the daemon neither resolved nor validated. A `file_path` may be relative or traversing; a `Bash` `command` is a literal shell command line. Never resolve, open, fetch, or execute anything derived from a value.
- The field *names* are daemon-chosen too — an MCP tool can name a field anything.
- **Optional to the client, not optional on the wire**: absent ⇒ a pre-#1678 daemon; a post-#1678 daemon always writes the key, never `null`, and emits `{}` for an absent, empty, or non-object input alike.
- **Key order is alphabetical and meaningless** (a Go map artefact); display order is the client's choice.
- **The map may be incomplete** — the daemon's 8500-rune total bound drops fields and names none of them; `input_summary` remains the whole-input fallback.
- A value the daemon shortened ends in `…`, indistinguishable from a value that legitimately ends in `…`.
- **The three reserved keys `__proto__`, `constructor`, `prototype` are dropped by the decoder** and never appear in this map (§ 2.3).
- The render slice (#645) must render every key and value as plain text, never HTML — the `input_summary` / `result_summary` constraint, inherited.

### 2. `src/main/transport/inboundMessage.ts` — the narrower

#### 2.1 A new module-private helper

Placed immediately after `requireStringArrayOrNull` (`:379`), whose posture it rotates from list to map:

```ts
function optionalStringMap(
  payload: Record<string, unknown>,
  field: string
): Record<string, string> | undefined
```

**Name it `optionalStringMap`, not `require*`.** The `require*` family's contract is "an omitted key fails closed" — `requireStringArrayOrNull`'s own doc comment says that is "what separates this from an optional-field parse". This helper is that optional-field parse, and the name must say so at every call site.

Truth table — the whole contract:

| `payload[field]` | Result |
|---|---|
| `undefined` (key absent) | `undefined` — a pre-#1678 daemon |
| `null` | **throws** |
| an array, string, number, boolean | **throws** |
| `{}` | a fresh `{}` — an empty map, **not** `undefined` |
| an object, every own enumerable value a string | a fresh object with those entries, minus the reserved keys |
| an object with any own enumerable non-string value | **throws** (the whole frame, not a partial map) |

Behaviour notes that are contract, not implementation:

- The container gate is `isRecord` (`:296`), reused verbatim — it already rejects `null` and arrays.
- Iterate **own enumerable keys only** (`Object.keys`). Nothing inherited is copied.
- The result is a **fresh** object, never the parsed container — the `requireStringArrayOrNull` freshness rule, so nothing carried on the parsed object rides along.
- **The value-type check runs for every key, including a reserved one, before the reserved-key skip.** AC2 admits no name-based exemption: `{"__proto__": {"a": 1}}` throws (non-string value); `{"__proto__": "x"}` decodes with that entry dropped. Both are pinned by tests.
- **Failure message: a new category, `malformed optional field: ${field}`.** Do not reuse `missing required field: ${field}` — for an optional field that message is actively misleading, since an absent key is the one case that does *not* throw. `field` is a client-owned constant (`'input'`); no daemon-supplied key and no value is interpolated, and one message covers both the bad-container and bad-value branches (the `requireStringArrayOrNull` precedent).

#### 2.2 `parseToolUsePayload`

One added line — `const input = optionalStringMap(payload, 'input')` — and `input` added to the returned literal. Extend the function's doc comment with the optional-field posture and a pointer to § 2.3's decision.

`input: undefined` on the returned object is intentional and harmless: the existing tests assert with `toEqual`, which treats an `undefined`-valued property as equal to an absent one, so the `:2577` "drops unknown server keys, keeping only the five known fields" test still passes unchanged. (Its *name* is now slightly stale; renaming it to "the five always-present fields" is welcome but is not an AC.)

#### 2.3 The reserved-key decision — **drop, do not carry, do not throw**

AC3 leaves carry-vs-drop to the architect. The decision is **drop `__proto__`, `constructor` and `prototype`; carry every other key**, pinned by a test. Three reasons, in order of weight:

1. **Only key names are model-influenceable; value types are not.** The daemon's field is `map[string]string`, so every value is a string *by construction* — a non-string value cannot originate from tool input, only from a non-conforming daemon or on-path corruption, which is exactly what fail-closed exists for. Key names, by contrast, come straight from the model's tool call. Throwing the frame on a reserved key would therefore hand the model a way to **suppress its own tool row** from the user's timeline by naming a parameter `__proto__` — an evasion vector. Dropping keeps the row, the tool name and `input_summary` visible.
2. **Dropping holds the invariant at every downstream hop, not just in main.** #643's store and #645's render are unwritten and unreviewable here, and both will copy this map. A carried `__proto__` own-property is a live hazard the moment someone downstream writes `Object.assign(target, map)` or `target[k] = map[k]` — those use `Set`, which invokes `Object.prototype`'s `__proto__` setter. With string values that setter is a silent no-op rather than actual pollution, so carrying the key buys **inconsistency, not fidelity**: the entry would survive in main and silently vanish downstream.
3. **A dropped field is an already-accepted failure mode.** The daemon's own total bound drops fields and names none of them, with `input_summary` as the whole-input fallback (§ Context). One more dropped field is inside a contract #645 must already handle.

Consequences to write down:

- The container is an **ordinary object**, not `Object.create(null)`. A null prototype would not survive the structured clone across IPC (the renderer receives a plain object either way), so it would buy a false sense of protection at the boundary that matters. With the three reserved keys removed, an ordinary container is safe: every remaining `Object.prototype` member is a data property, so an assignment merely shadows it on the target.
- **Consumers must iterate, never probe by key.** `map['toString']` on an ordinary-prototype object returns an inherited function, not data. #643 and #645 must read this map with `Object.entries` and must never treat a lookup miss's inherited value as content. Record this in the wire-type doc comment.

#### 2.4 The `tool_use` log block (`:1461-1474`) — comment only

No code change: the block already narrows before logging and emits only `{event, code, bytes, hash}`. Extend the comment's not-logged enumeration to name `input`, stating that **neither its keys nor its values** enter the diagnostic log — the keys are as sensitive as the values, since a daemon-chosen field name is itself model-authored text.

### 3. `src/main/daemonConnection.ts:825-831` — the emit

Add `input: inbound.toolUse.input` to the existing fresh literal. Unconditional: `undefined` when the wire omitted it. Extend the arm's comment from "the four named fields" to five, and note that `input` crosses **by reference to the already-narrowed fresh map** (the `queued` precedent at `:847-854`) — the narrower already stripped it to string values and removed the reserved keys, so there is nothing left to drop here and no second copy is warranted.

### 4. `src/shared/ipc/events.ts:369-373` — the IPC arm

Add `input?: Readonly<Record<string, string>>` to the `toolUse` arm, and extend its comment with: absent ⇒ the wire omitted it (a pre-#1678 daemon); the map is untrusted daemon display text with the same plain-text-never-HTML constraint as `name` / `inputSummary`; key order is meaningless; the map may be incomplete; the three reserved keys can never appear. `Readonly<…>` matches `queueState`'s `readonly QueuedItem[]` at `:389`.

**"Absent" across the bridge.** The emit assigns unconditionally, so the property exists with value `undefined` rather than being literally missing. That is the intended reading of AC5, and the consumer contract is: **test `event.input === undefined`, never `'input' in event`.** `JSON.stringify` omits an `undefined`-valued property, which gives the test in § Testing a deterministic assertion for "absent".

---

## State + concurrency model

Nothing added. This slice is inside the existing synchronous decode path (`parseInboundMessage` → `daemonConnection`'s event switch → `emitDaemonEvent`); no store, no async task, no subscription, no teardown. The renderer's timeline bridge and stores are untouched — #643 owns that.

---

## Error handling

| Failure | Layer | Result |
|---|---|---|
| `input` present but not an object (incl. `null`, an array, a scalar) | `optionalStringMap` | `WireDecodeError` → `parseToolUsePayload` → `parseInboundMessage` throws; the existing frame-level handling drops the frame |
| `input` an object with any non-string own value | `optionalStringMap` | same — the **whole** frame, never a partial map |
| `input` carries a reserved key | `optionalStringMap` | not a failure: entry dropped, frame decodes |
| `input` absent | `optionalStringMap` | not a failure: `undefined` |

**Accepted cost, named explicitly:** a fail-closed `input` kills the whole `tool_use` frame, so the tool row never reaches the timeline at all. AC2 mandates this, and § 2.3(1) is why it is safe: a conforming daemon cannot produce a non-string value, so no model-authored text can reach this branch.

**No new UI surface.** Nothing renders in this slice, so there is no banner, dialog, or silent-degrade decision to make. A dropped frame is already invisible to the user by the existing design.

**The client re-polices no cap.** A map exceeding the daemon's own 16 / 4000 / 8500-rune bounds decodes as-is. `MAX_PLAINTEXT_BYTES` in `parseInboundMessage` stays the only client-side size bound — a client-invented bound fail-closes a valid future frame, which ADR 0002 and the `parseQueuedItem` / `parseApiRetryPayload` no-cross-validate posture rank above cosmetic robustness.

---

## Testing strategy

All unit (`npm test`, vitest). No e2e change: nothing renders, and the default fake-transport tier builds no `tool_use` frame that this field affects. Type-level coverage rides `npm run typecheck` (both `tsconfig.node.json` and `tsconfig.web.json` — the `&&` in the script short-circuits, so a renderer-side break hides behind a node-side failure).

**`src/shared/wire/types.test.ts`** — extend the `tool-use wire vocabulary (#217)` block:

- A `ToolUsePayload` literal carrying a populated `input` compiles and round-trips.
- A `ToolUsePayload` literal **omitting** `input` entirely compiles — this is the assertion that pins `input` as optional, and the one that would fail if a later ticket made it required.

**`src/main/transport/inboundMessage.test.ts`** — a new `parseInboundMessage — tool_use input (#642)` describe, plus edits to the two existing log tests:

- A populated `input` narrows through with entries unchanged. Use a fixture that exercises the wire facts: a multi-key map, one value ending in `…`, and values that are the *strings* `"null"` / `"true"` / `"[1,2]"` (proving the decoder does not re-interpret a stringified JSON literal).
- `"input": {}` decodes to an empty map that is **not** `undefined` — assert both `toEqual({})` and that it is defined. This is AC1's distinguishability, and it is the case a careless `if (!value) return undefined` would break.
- An **omitted** `input` key decodes with `input` `undefined` while the other five fields decode normally — the pre-#1678 daemon.
- `"input": null` throws. Call this out as its own case, not a table row: it is the exact value `requireStringOrNull` would have accepted, and the likeliest wrong turn.
- A table (following `:2602`) of present-but-wrong-typed containers — an array, a string, a number, a boolean — each throwing `WireDecodeError`.
- A table of objects with a bad value — `{a: 1}`, `{a: null}`, `{a: {}}`, `{a: ['x']}`, `{a: true}` — each throwing, with a companion assertion that the good sibling key in the same object did **not** decode through (no partial map).
- **Prototype invariant, carry path:** `{"__proto__": "x", "constructor": "y", "prototype": "z", "path": "/etc/hosts"}` decodes; `input` equals exactly `{path: '/etc/hosts'}`; the container's prototype is still `Object.prototype`; and a freshly-created `{}` has picked up no `x` / `y` / `z`.
- **Prototype invariant, throw path:** `{"__proto__": {"polluted": true}}` throws (non-string value), and a freshly-created `{}` has no `polluted` property.
- **Message hygiene (AC4):** for each throwing case built from a `SECRET_KEY` / `SECRET_VALUE` pair, the caught `WireDecodeError.message` contains neither — assert the exact category string and sweep both secrets as substrings, the `:3652` idiom.
- **Extend `logs a tool_use content-free` (`:3625`)** with an `input` carrying `SECRET_KEY` → `SECRET_VALUE`; the record's key set must still be exactly `['bytes','code','event','hash','seq','ts']` and neither secret may appear anywhere in the emitted line.
- **Extend `does NOT log on a malformed tool_use throw path` (`:3655`)** with a frame whose *only* defect is a malformed `input` — the new throw path must also leave no record.

**`src/main/daemonConnection.test.ts`** — two cases beside the existing emit test:

- A `tool_use` carrying `input` emits a `toolUse` event whose `input` holds the same entries.
- A `tool_use` **omitting** `input` emits a `toolUse` event whose `input` is `undefined`, and `JSON.stringify(event)` contains no `"input"` key — the deterministic reading of AC5's "absent".

The existing emit test at `:2776` needs no edit (`toEqual` tolerates the `undefined`-valued property); leaving it untouched is also the control proving the change is additive.

---

## Scope count

Production source files (`*.ts`/`*.tsx`, excluding tests, docs, and this spec): **4** — `src/shared/wire/types.ts`, `src/main/transport/inboundMessage.ts`, `src/main/daemonConnection.ts`, `src/shared/ipc/events.ts`. Under the 5-file gate.

Against the red lines: 0 new files; ~300 total lines written (≈70 production incl. doc comments, ≈200 tests, ≈30 comment edits) against the ~600 line; **0 new exported types** (the helper is module-private, both changed types are existing); **0 forced consumer call sites** (PO measured `tsc --noEmit` on both tsconfigs: `input?` ⇒ 0 errors tree-wide; the only `toEqual`-based runtime test that could have cascaded is verified above as passing unchanged); 5 ACs; **4 throw branches** in the new helper against the ≥10 line.

Not split, and the reason is not the arithmetic: a narrower with no emit and a typed IPC arm with nothing filling it are dormant-on-dormant halves, and #643 is already the slice that consumes them.

---

## Open questions

1. **Should `parseToolUsePayload` omit the `input` key entirely when the wire omitted it, rather than setting it to `undefined`?** Specified as unconditional because `toEqual` makes it invisible to every existing test and the consumer contract (`=== undefined`) is unaffected. If the developer finds a runtime consumer that does `'input' in payload`, there is none today — flag it in the PR rather than changing shape silently.
2. **Naming: `optionalStringMap` vs `optionalStringRecord`.** `Map` here means the wire concept, not the JS `Map` type (the return is a plain object, deliberately — a `Map` would not survive structured clone as a plain record and would import an ordering guarantee the wire does not have). If `Map` reads as the JS type at the call site, `optionalStringRecord` is an acceptable rename; the contract is unchanged either way.
3. **The `…` marker is carried verbatim and never stripped.** Recorded in the wire-type doc comment for #645, which is where the decision of whether to signal shortening in the UI actually lands. No client-side detection is attempted here — a value that legitimately ends in `…` is indistinguishable, an accepted cost the daemon already took.

---

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — the boundary is explicit and single: `optionalStringMap` in `src/main/transport/inboundMessage.ts` is the only place `input` crosses from untrusted wire bytes to a typed value, and it is reached only through `parseToolUsePayload` ← the `case 'tool_use'` arm at `:1461`. Downstream holds `Record<string, string>` with no unvalidated shape. The second boundary (main → renderer over `contextBridge`) carries the map *outward*, which is the safe direction; the renderer gains no capability from it. **The design's own trust statement is written into the wire-type doc comment** (§ 1): the values are display strings, not capabilities, and nothing derived from them may be resolved, opened, fetched, or executed — that sentence is the signal to #643 and #645 that they are holding untrusted data, since the type system cannot say so.
- **[Prototype pollution — the category this ticket exists for]** No findings, by an explicit decision rather than by luck. This is the **first narrower in the file where the daemon chooses the object keys**; every other one copies a fixed set of known names, which is why `parseApiRetryPayload` gets pollution-safety for free. Three mechanisms, all pinned by tests: the three reserved keys are dropped before any copy (§ 2.3); the result is a fresh container built from own enumerable keys only, so nothing inherited or container-borne rides along; and the value-type check runs before the skip, so a `{"__proto__": {...}}` object-valued entry throws the frame closed rather than being copied anywhere. The test asserts the *negative* directly — a freshly-created `{}` has gained no property after decoding a hostile frame.
- **[Denial-of-render / evasion]** Considered and designed against — this is the finding that decided § 2.3. Failing the frame closed on a reserved key would let the model **suppress its own tool row** from the user's timeline by naming a tool parameter `__proto__`, since the daemon copies model-authored key names verbatim. Dropping the entry keeps the tool row, the tool name and `input_summary` visible. The mirror-image question — could a model trigger the fail-closed branch through a *value*? — is answered no by the wire type: the daemon's field is `map[string]string`, so a non-string value cannot originate from tool input at all.
- **[Error messages, logs, telemetry]** No findings. Two mechanisms: the failure message is a category naming only the client-owned constant `'input'` (no daemon key, no value, and deliberately a *new* category rather than the misleading `missing required field:`), and the `tool_use` log block already narrows **before** logging and emits only `{event, code, bytes, hash}` — so a malformed `input` throws first and leaves no record. Both are pinned: the message sweep over a `SECRET_KEY`/`SECRET_VALUE` pair, and the extension of the existing content-free log test with a secret-bearing `input`. The comment edit at `:1461-1474` names `input`'s **keys as well as its values** as not-logged, because a daemon-chosen field name is itself model-authored text.
- **[Network & I/O — resource exhaustion]** No findings. The client adds no bound and re-polices none of the daemon's (16 fields / 4000 runes per value / 8500 total); `MAX_PLAINTEXT_BYTES` in `parseInboundMessage` remains the only client-side size bound, and it gates the whole frame *before* this narrower runs, so an oversized map is rejected upstream. This is a deliberate ADR 0002 call: a client-invented bound fail-closes a valid future frame. The decode is a single linear pass over own keys with no recursion, so a hostile map costs time proportional to a frame already capped.
- **[Electron attack surface]** No findings. No new IPC channel, no new `contextBridge` API, no `webPreferences` change, no protocol handler, no navigation surface — one optional field on an existing `DaemonEvent` arm travelling the existing `DAEMON_EVENT_CHANNEL`. The transport stays in the main process; nothing about this slice moves keys, sockets, or raw bytes toward the renderer, and the map crossing the bridge is a plain string-to-string record after structured clone.
- **[Hostile daemon response]** Addressed. Every branch of the truth table in § 2.1 is enumerated against a non-conforming producer: wrong container type, wrong value type, `null`, and hostile key names each have a defined, tested outcome, and none of them yields a partial value. The one behaviour a hostile daemon *can* still force is dropping the whole `tool_use` frame by sending a non-string value — named as an accepted cost in § Error handling, and not reachable through model-authored text.
- **[Tokens, secrets, credentials]** Not applicable — no token, key, or credential is read, written, compared, or transported by this slice, and no storage is touched. Named rather than skipped because the `toolUse` arm's existing comment ends "No token, key, or raw frame" and that claim must survive the added field: it does, since `input` is a string-to-string record built solely from the decoded payload.
- **[File / storage operations]** Not applicable by construction, and worth stating because the *content* invites the mistake: `input` values include `file_path`-shaped strings that are **not canonicalised, may be relative, and may traverse**. This slice performs no filesystem operation, and the wire-type doc comment carries that warning forward to #643 and #645 — a value must never become a path, a filename, a cache key, or a lookup path (the CLAUDE.md operator ruling of 2026-08-20).
- **[Cryptographic primitives]** Not applicable — no randomness, no comparison against a secret, no hashing beyond the existing content-free `hashPlaintext` on the already-logged frame bytes, and no change to the Noise session.
- **[Concurrency]** Not applicable — the whole change lives in the existing synchronous decode path. No task is launched, no listener registered, no timer set, no shared state mutated across an `await`.
- **[Threat model alignment]** Aligned. The relevant upstream threat is *hostile daemon response*, covered above. Renderer-compromise-reaching-the-transport is unchanged (the data flows outward only). Malicious-relay is unchanged (the map is inside the Noise session; a content-blind relay can drop or reorder frames but cannot author one). **Out of scope, named:** the DOM-sink decision for these strings is #645's — this slice has no renderer consumer, so the plain-text-never-HTML constraint is *recorded* in both doc comments and *enforced* there.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-24
