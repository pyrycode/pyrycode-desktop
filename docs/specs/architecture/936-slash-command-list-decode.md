# 936 — fail-closed `slash_command_list` decode

**Ticket:** [#936](https://github.com/pyrycode/pyrycode-desktop/issues/936) · size:s · security-sensitive
**Branch:** `feature/936`

The transport half of the slash-command family: one new arm in `parseInboundMessage`, two new
narrowers, one new `InboundDaemonMessage` member. Decode only — nothing consumes the arm yet.

## Files read

- `src/main/transport/inboundMessage.ts` → `parseBackgroundTaskRosterPayload` + `parseBackgroundTask`
  — the structural twin named by the ticket: `conversation_id` + a never-null row array + a dropped
  count, with a per-row nullable `truncated_fields`. Their doc comments settle every decision here.
- `src/main/transport/inboundMessage.ts` → `requireString` / `requireNumber` /
  `requireStringArrayOrNull` / `isRecord` — the helper vocabulary the new narrowers compose from.
  There is **no** non-nullable string-array helper yet; `aliases` is the first field that needs one.
- `src/main/transport/inboundMessage.ts` → `parseQuestionShownPayload` — the #884 precedent for the
  two-level narrow (payload → ordered row array), and for what an arm's doc comment must say about
  "shape trusted ≠ content trusted".
- `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage` and the `parseInboundMessage`
  switch — where the member and the arm go, and the house shape of an arm (narrow, then log
  content-free, then return).
- `src/shared/wire/types.ts` → `WireSlashCommand`, `SlashCommandListPayload` — #935's dormant types,
  the decode target. Their doc comments carry the cut-aliases reading rule and the
  "reach this type through #936's narrower, never a bare cast" instruction this slice satisfies.
- `src/shared/wire/types.ts` → `MAX_PLAINTEXT_BYTES` — the only bound that applies to this frame.
- `src/shared/wire/types.test.ts` → the `slash-command-list wire vocabulary (#935)` block — the
  fixture values (including the abridged `claude-api` description) this slice reuses verbatim so the
  two files cannot drift into two hand-written guesses of the same upstream fixture.
- `src/main/transport/inboundMessage.test.ts` → the `background_task_roster recognition (#566)` /
  `fail-closed (#566)` blocks, the `content-free diagnostic log (#130)` block and the
  `secret-safety / log-free` block — the four places a new arm's proof lands.
- `src/main/daemonConnection.ts` → its inbound `switch (inbound.kind)` — arms are handled
  individually with **no `assertNever`** (its own comments say so repeatedly), so an additive union
  member compiles green and the frame stops at this arm's `return` until #937 claims it.
- `docs/knowledge/features/slash-command-list-wire-types.md` → § "Bounds — deliberately not
  modelled" and the cut-aliases rule — the lessons #935 left for this ticket: no entry cap, no
  charset check, no cached count, and `truncated_fields: ['aliases']` must survive intact or the
  Actions menu (#681) reads "cut to nothing" as "none".
- `docs/knowledge/features/inbound-message-decode.md` and its `-contract` sibling → the file's
  fail-closed posture and its no-client-invented-bound rule.
- Upstream `~/Workspace/Projects/pyrycode/internal/protocol/testdata/slash_command_list{,_empty,_zero}.json`
  → the three committed producer fixtures; read directly rather than trusted from prose.

## Design source

**Figma:** N/A — main-process transport decode. Nothing renders, so the visual-fidelity check is
intentionally skipped.

## Context

#935 shipped `SlashCommandListPayload` / `WireSlashCommand` dormant. A `slash_command_list` frame
arriving today falls to `parseInboundMessage`'s `default:` arm, is logged content-free as unmodeled,
and returns `null` — so the desktop silently ignores a frame the daemon already emits (upstream
#2001–#2007 landed the producer ahead of both desktop consumers).

This slice adds the boundary that turns those bytes into the typed payload, failing closed on
anything that does not match the declared shape. It is the same job #884 did for `question_shown`
and #587 for `model_announced`. The IPC carry is #937; the Actions-menu consumer is #681.

The frame is **internet-exposed and workspace-authored**: its four string fields were written by
whoever wrote the repository, a lower trust tier than the claude-authored strings `model_list` and
`question_shown` carry, and the daemon bounds them without sanitizing them. `0x0a` is the only
sub-`0x20` byte measured across the capture's 51 entries, so an embedded newline is the control
character that actually occurs — which is why the never-into-a-log half of CLAUDE.md's daemon-text
ruling binds hardest here: a workspace author who can put a newline in a `description` can forge a
log record if any decoded value ever reaches the log.

No ADR is warranted: this slice makes no architectural choice of its own, it applies the settled
posture of `inbound-message-decode` to one more frame.

## Design

### 1. `requireStringArray` — the strict sibling of `requireStringArrayOrNull`

`aliases` is **always present and never `null`**; `truncated_fields`, one field away in the same row,
**is** nullable. The file's existing `requireStringArrayOrNull` is right for the second and wrong for
the first — reaching for it on `aliases` would quietly admit a `null` the wire never sends, and the
`WireSlashCommand` type would then be lying about its own field.

Contract: `requireStringArray(payload, field): string[]` — a `string[]` or a fail-closed throw.
`null`, an omitted key, a non-array, and any non-string element all throw `WireDecodeError` with the
existing category-only `missing required field: ${field}` message. The result is a **fresh** array
(the `requireStringArrayOrNull` posture), so array-borne extra properties cannot ride along, and an
empty `[]` is valid — for `aliases` it is the *collapse* of claude's absent and empty lists into one
wire value, never an error.

`requireStringArrayOrNull` is rewritten as a one-line delegation (`null` → `null`, otherwise
`requireStringArray`). Behaviour-identical, same messages, covered by the existing #564/#565/#566
tests; the alternative is duplicating the element loop eight lines below itself. Its doc comment
gains one sentence naming the split and the `aliases`-vs-`truncated_fields` asymmetry that forced it.

### 2. `parseSlashCommand` — one row → `WireSlashCommand`

Modelled on `parseBackgroundTask`: an `isRecord` guard, then `requireString` for `name`,
`argument_hint` and `description`, `requireStringArray` for `aliases`, `requireStringArrayOrNull` for
`truncated_fields`, returning a fresh five-field literal (unknown server keys tolerated, not copied
— which is also what keeps it prototype-pollution-safe).

Deliberately absent, each for a reason the doc comment states:

- **No charset or identifier validation on `name`** — one measured name is `__remote-workflow`.
- **No length check on any string** — the daemon owns those bounds and `MAX_PLAINTEXT_BYTES` gates
  the frame; a client-side bound would fail-close a valid future frame.
- **No trimming, normalising, stripping or re-encoding** — the strings are carried verbatim,
  newlines included. The render boundary owes the escaping; rewriting a `name` here would make the
  two ends disagree about what the command is called.
- **No closed set on `truncated_fields` elements** — `parseBackgroundTask`'s rule verbatim.
- **An empty `argument_hint` is ordinary data** (33 of 51 measured entries), so nothing may read `''`
  as absence.

### 3. `parseSlashCommandListPayload` — the payload → `SlashCommandListPayload`

Modelled on `parseBackgroundTaskRosterPayload`: an `isRecord` guard, `requireString` for
`conversation_id`, an `Array.isArray` check on `commands` followed by `raw.map(parseSlashCommand)`,
`requireNumber` for `dropped_commands`, returning a fresh three-field literal.

The frame's trap, identical to the roster's and worth restating in the doc comment: within one
payload `commands: null` fails closed while a row's own `truncated_fields: null` is a valid value.
`Array.isArray(null)` is `false`, which is exactly what fails the first closed; an omitted key fails
the same way. `commands: []` decodes to `[]` — the positive statement that claude offered nothing,
distinguishable downstream from the `null` an unmodeled type returns.

`dropped_commands` goes through plain `requireNumber`: the Go field has no `omitempty`, so `0` is a
genuine value carried as `0` and never truthiness-tested, while an absent key is a real defect.
**Nothing cross-checks it against `commands.length` and nothing caps the entry count** — two producer
cuts feed the count (an entry cap and a frame-level byte bound, both cutting from the tail, the
second able to fire before the first is reached), so a non-zero count arrives beside any number of
entries and list length is no evidence of completeness.

### 4. The union member and the arm

`InboundDaemonMessage` gains `| { kind: 'slash-command-list'; slashCommandList: SlashCommandListPayload }`
after the `question-dismissed` member, plus a paragraph in the type's doc comment covering what the
kind carries, its trust tier, and that nothing consumes it yet.

`parseInboundMessage` gains `case 'slash_command_list':` between the `question_dismissed` arm and
`case 'error':` — narrow first, then log, then return, so a malformed frame throws before any record
is written. The log reuses the existing content-free field set
(`event: 'inbound-decoded'`, `code: 'slash_command_list'`, `bytes`, `hash`) and adds no
`DiagnosticEvent` field, so #131's renderer pin is untouched. **Deliberately no `count` of commands**
even though the field exists: a workspace's command inventory is a fact about the user's session and
about the repository they have open (the roster / modal_shown posture, not `message_chunk`'s).

## State + concurrency model

None. `parseInboundMessage` is a pure synchronous function over one plaintext frame; this slice adds
no state, no async work, no subscription and no teardown path. The decoded payload is returned to
`createDaemonConnection`'s inbound switch, whose arms are individually handled with no `assertNever`
— the new kind falls through unhandled and no event is emitted, which is the intended dormant state
until #937.

## Error handling

One failure type, `WireDecodeError`, thrown from the two new narrowers and from the shared helpers,
so `daemonConnection`'s existing single catch covers it — no event is emitted at all, nothing is
repaired, defaulted, or partially delivered.

Messages name the failure **category only**, never a value: `malformed slash_command_list payload`,
`malformed commands list`, `malformed slash command`, and the helpers' existing
`missing required field: ${field}`. The message reaches a caller's `catch` and can ride into a log
this decoder is otherwise careful never to write, and every one of this frame's strings is
workspace-authored text — a `description` alone can carry a newline and forge a log line.
`conversation_id` is a routing key and is likewise never echoed.

Nothing is logged on the throw path (the arm narrows before it logs).

## Testing strategy

All proof is vitest in `src/main/transport/inboundMessage.test.ts`, driving `parseInboundMessage`
through the real `encodeEnvelope` — no renderer, no Playwright, no DOM. Three fixtures lifted from
the upstream committed files, reusing #935's `types.test.ts` values verbatim (including its abridged
`claude-api` description, which keeps the two measured byte-level properties: an embedded newline and
a non-ASCII rune) plus a new `encodeSlashCommandList` frame helper.

Two new describe blocks mirroring the `background_task_roster` pair, plus additions to the two
existing cross-cutting blocks:

**Recognition** (`slash_command_list recognition (#936, additive)`)
- the populated frame round-trips to `{ kind: 'slash-command-list', slashCommandList: … }` (AC1)
- per-field extraction across rows in wire order; `dropped_commands` is the number `2`; the
  `name`/`argument_hint`/`description`/`aliases` arrays each assert distinctly so a row swap or a
  dropped field reddens (AC1)
- strings survive byte-for-byte: the embedded newline, the non-ASCII rune, the raw `<model>` hint,
  and a `__remote-workflow` name outside any identifier charset (AC2)
- a frame with `commands: []` and a **non-zero** `dropped_commands` decodes — nothing cross-checks
  the count, and no entry cap exists (AC1)
- `commands: []` decodes to `[]`, asserted `not.toBeNull()` beside the `null` an unmodeled type
  returns, which is what makes the two distinguishable downstream (AC3)
- `dropped_commands: 0` decodes as the value `0` (AC1)
- a row's `truncated_fields: null` decodes as `null`; a row's `truncated_fields: ['aliases']`
  survives intact beside a **present** `aliases`, asserted through the reading-rule predicate rather
  than only round-tripped (AC4)
- an empty `argument_hint` and an empty `aliases` are ordinary values, not absences
- no closed set on `truncated_fields` element names (a future name decodes)
- unknown server keys dropped at the frame level (a spurious hoisted `truncated_fields`, the field
  this payload deliberately does not have) and at the row level
- still returns `null` for a well-formed envelope of another unmodeled type

**Fail-closed** (`slash_command_list fail-closed (#936)`) — one test per rejection shape (AC5)
- `commands` null / omitted / any non-array — the trap, paired with the row-level `null` above
- `conversation_id` absent or a non-string
- `dropped_commands` omitted / a JSON string / null / boolean (never coerced)
- a row that is not a record fails the **whole** frame, valid siblings included
- each of `name` / `argument_hint` / `description` absent, then each a non-string
- `aliases: null` **on the same row whose `truncated_fields` is `['aliases']`** — the one-field-apart
  asymmetry in a single frame (AC4) — plus omitted, non-array, and a non-string element
- `truncated_fields` omitted, neither-array-nor-null, and a non-string element
- a non-object payload; an oversized-but-valid-JSON plaintext

**Content-free diagnostic log (#130 block)** — a decoded frame logs exactly
`{event, code: 'slash_command_list', bytes, hash, seq, ts}` with every string field, the
`conversation_id` and an alias planted as distinct sentinels and asserted absent from the line; and a
malformed frame logs nothing.

**Secret-safety block** — a thrown message never echoes any of the four strings, an alias, a
`truncated_fields` element or the `conversation_id`, with the frame broken one field at a time at the
row level (the deepest one).

Gate: `npm test -- src/main/transport/inboundMessage.test.ts` and `npm run build`. On a red
`npm run typecheck`, `npx tsc --noEmit -p tsconfig.web.json` is run separately before any error count
is read as the blast radius — the node-side `&&` short-circuit hides every renderer error.

## Open questions

1. **Does `requireStringArrayOrNull` delegate to the new helper, or does the new helper stand
   alone?** Resolved in favour of delegation before implementation: it is behaviour-identical, keeps
   one element-check loop rather than two eight lines apart, and is covered by the existing
   background-task tests. Should the delegation turn out to shift any existing message or behaviour,
   the fallback is a standalone helper with a duplicated loop, recorded here as a `## Revisions`
   entry.
2. **Does the arm log a `count` of commands?** Resolved: no. `DiagnosticEvent` already carries the
   field, so the omission is a decision rather than an absence — the size of a workspace's command
   menu is a fact about the user's repository.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — this slice *is* a trust boundary, and it is explicit and
  single: `parseSlashCommandListPayload` / `parseSlashCommand` are the only sanctioned route from
  `Envelope.payload` (`unknown`) to `SlashCommandListPayload`, exactly as `WireSlashCommand`'s doc
  comment demands. The signal downstream is the fail-closed throw, not a branded type: shape becomes
  trusted, content does **not**, and the arm's doc comment states that in those words so a consumer
  cannot read "decoded" as "sanitized". Nothing crosses IPC in this slice.
- **[Trust boundaries — the semantic trap]** SHOULD FIX, and it is addressed in the design rather
  than deferred: a bare `as SlashCommandListPayload` cast on a frame whose `truncated_fields` key is
  absent yields `undefined`, and `row.truncated_fields?.includes('aliases')` is then falsy for
  exactly the reason `null` is — silently inverting the cut-aliases rule and greying out a working
  command in #681. The narrower's required-key check is what forecloses it; the
  `truncated_fields`-omitted rejection test is the pin.
- **[Tokens, secrets, credentials]** No findings — this frame carries none. `conversation_id` is an
  outbound routing/scoping key, not a nonce and not unguessable (unlike `question_shown`'s
  `question_batch_id`), and it is still kept out of every message and every log record on the
  category-only rule. Nothing is stored, so lifecycle/rotation/revocation do not arise.
- **[File / storage operations]** No findings — no path is built, no file is read or written, nothing
  is persisted. Load-bearing for the consumers, and stated at the type by #935: `name` is **not an
  identifier** (`__remote-workflow` is a measured name), so nothing may key a cache, a memo, a lookup
  path or a filename by it. This slice creates no such key; #937/#681 inherit the constraint.
- **[Inter-process / Electron attack surface]** No findings in scope — no window, no
  `webPreferences`, no `contextBridge` API, no `ipcMain` channel, no protocol handler is added or
  touched. The module stays main-process-only (it imports `codec.ts` / Node `Buffer`) and is never
  re-exported through a renderer barrel. **OUT OF SCOPE:** the IPC carry of this payload to the
  renderer — #937 owns it, and the structured-clone serialisation question lands there, not here.
- **[Cryptographic primitives]** N/A by construction — the frame arrives already decrypted from the
  Noise session; this slice performs no crypto, generates no randomness, derives no key and compares
  nothing to a secret. `hashPlaintext` (BLAKE2s over the whole frame, `@noble/hashes`) is reused
  unchanged for the log's one-way digest; no new hashing path is introduced.
- **[Network & I/O]** No findings — no socket, no URL, no TLS setting, no timeout is touched.
  Resource exhaustion is the live question and it is answered by *not* adding a bound: the frame is
  capped upstream by `MAX_PLAINTEXT_BYTES` (re-checked at the top of `parseInboundMessage`), and
  `raw.map(parseSlashCommand)` allocates from the array that actually arrived rather than from any
  claimed count — `dropped_commands` is never used to size anything. A hostile daemon therefore
  cannot amplify: the worst case is bounded by the frame it already paid to send. A client-side entry
  cap was considered and rejected — it would fail-close a valid frame the day the daemon raises its
  own (51 entries measured in one workspace, 74 in another), which is a stricter-than-wire
  availability bug rather than a defence.
- **[Error messages, logs, telemetry]** No findings, and this is the category with real teeth here.
  Every string on this frame is **workspace-authored** — a lower trust tier than the claude-authored
  strings the neighbouring arms carry — and `0x0a` is the only sub-`0x20` byte measured across the
  capture, so an attacker-controlled newline in a `description` is a **log-forgery primitive** if any
  decoded value ever reaches the JSON-lines diagnostic log (which the operator can ship off-box in a
  debug bundle). The design admits nothing decoded into the log: the arm emits only
  `event`/`code`/`bytes`/`hash`, `code` is a static literal (strictly safer than the `default:` arm
  it replaces, which logged a wire-supplied `envelope.type`), no `count` is emitted, the narrowing
  runs before the log so the throw path leaves no record, and the thrown messages are category-only.
  Both halves are pinned by tests with planted sentinels, including a newline-bearing one.
- **[Concurrency]** N/A — a pure synchronous function over one frame. No task is launched, no timer,
  no listener, no shared mutable state, no `await`, so there is no ownership, cancellation, race or
  shutdown path to define. The returned object is freshly allocated per call.
- **[Threat model alignment]** — *Hostile daemon response*: the whole point of the slice; every field
  is checked before use, nothing is repaired or defaulted, one bad row fails the whole frame.
  *Malicious/compromised relay*: it is content-blind and on-path only — it can drop, delay, reorder
  or flood this frame, and since the payload is an idempotent **snapshot** that replaces a reader's
  view rather than a delta that amends it, a reorder or a replay costs a stale menu, not corrupt
  state; a flood is bounded by the transport's existing framing, unchanged here. *Renderer compromise
  reaching the transport*: nothing in this slice is reachable from the renderer. *Token theft from
  disk*: no token, nothing at rest. **OUT OF SCOPE:** rendering these strings safely — escaped,
  inert, length-bounded, never a raw-markup sink — belongs to #681, which is where a `name` or a
  `description` first meets a DOM sink.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
