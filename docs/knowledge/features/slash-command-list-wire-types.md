# Slash-command-list wire types

The wire vocabulary for the workspace's slash-command menu: one `EnvelopeType` member and two
interfaces mirroring the daemon's published `slash_command_list` contract field for field.

Introduced in [#935](https://github.com/pyrycode/pyrycode-desktop/issues/935), declaration only at
that point — nothing decodes, narrows, stores or renders it yet. Split from #694. Two consumers are
blocked on the type rather than on the producer: [#936](https://github.com/pyrycode/pyrycode-desktop/issues/936),
the decode slice directly below it in this family, and [#681](https://github.com/pyrycode/pyrycode-desktop/issues/681),
which matches the Actions menu's entries against names **and aliases** — the desktop Actions menu's
own `reset` entry is an alias of `clear`, not a command name, so a name-only match greys out a command
that works. SSOT is `pyrycode/pyrycode` `docs/protocol-mobile.md` § `slash_command_list` (type declared
by pyrycode#1726, shape by #1727, fixtures and section by #1718) / `internal/protocol/interactive.go`.
The producer exists now too: #2001 maps the frame, #2002 bounds it, #2003 emits it on the live
interactive lane, #2004–#2007 retain it and reconcile it on connect, and #2008/#2009 prove both
delivery paths e2e (live push, connect-time snapshot).

## What it does

The daemon publishes the slash commands claude will accept for a conversation, drawn from the
`commands` array of the same `initialize` control reply `model_list` comes from. `model_list`
inventories the **identities** claude will run as; this frame inventories the **verbs** the working
directory will accept. Nothing modelled `model_list` on this side either, so there was no local
precedent to copy from it — the nearest structural precedent is
[`BackgroundTaskRosterPayload`](background-task-roster-store.md): a snapshot payload carrying
`conversation_id` + a never-null array + a dropped count, whose rows each carry their own
`truncated_fields: string[] | null`.

```ts
export type EnvelopeType =
  | …
  | 'question_answer'
  | 'question_refused'
  | 'slash_command_list'   // v2, control-reply snapshot, interactive-gated, not in the daemon's v1TypeSet
  | 'list_conversations'
  | …

export interface WireSlashCommand {
  name: string
  argument_hint: string
  description: string
  aliases: string[]
  truncated_fields: string[] | null
}

export interface SlashCommandListPayload {
  conversation_id: string
  commands: WireSlashCommand[]
  dropped_commands: number
}
```

Wire order, snake_case keys, every field required — no `omitempty` on any of the eight keys across
the two structs, so an empty `argument_hint` or a `dropped_commands: 0` is a real value rather than a
vanished one.

## How it works

**A conversation-scoped snapshot, not a turn-stream item.** It rides a `control_response` from the
`initialize` reply, so receiving one neither opens nor closes a turn, and it **replaces** a reader's
view of the menu rather than amending it with a delta. `conversation_id` is an outbound
routing/scoping key only, exactly as `modal_shown`'s and `question_shown`'s are — it grants no inbound
capability and is not a nonce.

**Named `WireSlashCommand`, not `SlashCommand`, deliberately.** Two reasons, both in the type's doc
comment so the prefix does not read as an accident. First, `Wire` is this cluster's prefix for a
nested row whose bare name is generic enough to be wanted again downstream (`WireQuestion`,
`WireQuestionOption`, `WireModalOption`) — both #936 and #681 will want their own domain notion of a
slash command. Second, [question-shown wire types](question-shown-wire-types.md)'s
`QuestionShownPayload` doc comment, and the identical line in that doc, both name `SlashCommand` as
the **daemon's** Go type ("this family ships no `truncated_fields`, unlike `SlashCommand` and
`ModelOption`"); leaving that bare name unclaimed on this side keeps both references pointing where
they always did. Neither was edited by this ticket — the claim stays true either way, since
`WireSlashCommand` does carry `truncated_fields`.

**`commands` and `aliases` are both plain non-optional arrays, but for different reasons — the
asymmetry is upstream's, and flattening it draws the wrong conclusion from an empty `aliases`.** For
`commands`, `[]` is a **positive statement** that claude offered nothing: the daemon's `MarshalJSON`
normalises a nil slice to `[]`, `omitempty` is deliberately absent (eliding the key would erase the
frame's point), and a client decoding into a non-optional array never branches on null. For `aliases`,
`[]` is a **collapse**: claude never emits an empty alias array — against the capture
`initialize_control_v2.1.239.json` (51 entries), 42 omit the key entirely and 9 carry a non-empty one,
zero carry `[]` — so an absent-aliases row and an empty-aliases row arrive as the identical wire value.

**A cut `aliases` is unknowable from `aliases` alone — the one place that collapse costs a reader.**
Because absent and empty are the same `[]`, a `truncated_fields` naming `aliases` is the *only* signal
separating "cut to nothing" from "none", and it must be read as **unknown**, never as *no aliases*.
Reading it as "none" greys out a working command: the Actions menu's own `reset` entry is an alias of
`clear`, not a command name (#681). **That rule is only sound on a validated frame** — reached through
a bare `as SlashCommandListPayload` cast, a frame whose `truncated_fields` key is absent decodes to
`undefined`, and `row.truncated_fields?.includes('aliases')` is then falsy for exactly the reason
`null` is, silently inverting the rule. Nullable is not optional; #936's narrower is the only
sanctioned way to reach this type.

**`truncated_fields` is `BackgroundTask.truncated_fields` exactly**, including the trap that within
one payload `commands: null` is out of contract while a row's own `truncated_fields: null` is a valid
value — the daemon's marshaller normalises the first and deliberately not the second. Each row reports
its own cuts; there is no hoisted or flattened list on the payload. The element type is a plain
`string[]`, not narrowed to the four wire names (`name`, `argument_hint`, `description`, `aliases`) —
for the reason `BackgroundTask` already records: each frame's cut-field vocabulary is its own distinct
set, and a closed one here would fail-close a valid future frame.

**`dropped_commands` is counted and carried, so `commands.length + dropped_commands` is the menu's
true size — and the published upstream section says the opposite, twice, and is stale.** The section
states "nothing counts it" and explicitly forbids reading that sum; that prose is stale as of
`0fe3c642` (2026-09-02) — the decode's entry cap and its count landed upstream in #1826, and #2002
adds its own frame-level cut to the same field rather than recomputing it, so the number the wire
carries is already summed over both cuts. The correction is pyrycode#2010, still open. The field
tables in the published section remain SSOT throughout; only its status prose went stale. `0` is a
value, never consulted for truthiness — the key is always written.

**Trust tier.** `name`, `argument_hint`, `description` and every string in `aliases` are
**workspace-authored** — whoever wrote the repository wrote them — a *lower* tier than the
claude-authored strings `model_list` and `question_shown` carry, not a restatement of it. The daemon
**bounds them and does not sanitize them**. `0x0a` is the only sub-`0x20` byte measured anywhere across
the capture's 51 entries' four string fields, so a newline is the control character that actually
occurs — a description is not necessarily one line, and logging one would let a workspace author forge
a log record. Safe to render as inert, escaped, length-bounded text; never a raw-markup sink
(`innerHTML` / `dangerouslySetInnerHTML`), an attribute, a URL, a filename, a cache key or a lookup
path — CLAUDE.md's daemon-text ruling in full. `name` is **not an identifier**: one measured name is
`__remote-workflow`, so nothing may key a cache, a memo or a lookup path by it.

**The frame is a report, never a control input — with one amendment.** A client *is* meant to send a
`name` back, as the text of an ordinary message, since sending the slash command is the point.
Publishing a name does not make it trusted: it arrives inbound as ordinary message text, on a path
that does not consult this list as a command vocabulary, and no field here reaches a child process as
an argv element.

## Bounds — deliberately not modelled

No entry cap, no per-field byte cap, no charset assumption on `name`, and no cached count. The daemon
enforces the entry cap (#1826, #2002) and reports its own cut through `dropped_commands`; a second
bound here would be a second one to keep in agreement, and stricter-than-wire would fail-close a valid
frame. The count is workspace- and version-dependent by design — 51 entries against claude 2.1.239 in
one repository, 74 hand-counted against 2.1.220 in another — so no client may cache one or treat a
small list as an error. The frame cannot arrive unbounded regardless: `MAX_PLAINTEXT_BYTES` caps the
decrypted envelope before any parse, against 14,277 bytes of compact UTF-8 for the whole measured 51.

## Configuration and usage

`src/shared/wire/**` — no React, no DOM, no IPC. Types are erased at compile time; the emitted
JavaScript for `types.ts` is byte-unchanged by this slice. Every field being required is load-bearing:
it left #936's fail-closed narrower no optional key to wave through, so a missing field is a reject
by construction. A required field is still only a promise the wire has not kept until it is checked —
reach this type through #936's narrower ([inbound message decode](inbound-message-decode.md)), never a
bare `as SlashCommandListPayload` on `Envelope.payload`, which would hand a `.map` a non-array from a
malformed frame and would silently invert the cut-aliases reading rule above.

Decodes and narrows now, but is still unclaimed by any consumer:

- **#936** (landed) added the `slash-command-list` inbound arm — `parseSlashCommandListPayload` +
  `parseSlashCommand`, plus a new helper, `requireStringArray`, the never-`null` sibling of
  `requireStringArrayOrNull` (which now delegates to it for the `null` case) — needed because `aliases`
  must reject the `null` that `truncated_fields`, one field over on the same row, accepts. Ships dormant:
  `daemonConnection.ts`'s inbound switch has no catch-all, so the decoded menu stops at the arm's return.
  See [inbound message decode](inbound-message-decode.md).
- **#681** owns the Actions-menu match against both `name` and `aliases`, the first consumer that must
  not resolve a menu entry by rendering an unescaped `name`, and the first to actually read the frame
  #936 now decodes.

## Edge cases and limitations

- Unlike `question_shown`'s producer, this frame's arrives to traffic that already exists: #2001–#2007
  landed upstream ahead of both desktop consumers, so #936 and #681 were blocked on the type only, not
  on a daemon dependency. #936 has since landed the decode; #681 (the Actions-menu alias match) is the
  one still blocked, now on the decoded arm rather than the type.
- `Envelope.type` is `EnvelopeType | string` (open) and no exhaustive switch exists over it today, so
  this widening is non-breaking. The `EnvelopeType` membership test in `types.test.ts` is what would
  otherwise miss a dropped member — without it, a decode/re-encode round-trip passes silently on an
  unknown string.
- The `truncated_fields: ['aliases']` test case is hand-authored — no committed upstream fixture
  carries it, since the populated fixture's only cut is `description`. Do not go hunting for one; it
  does not exist.

## Testing strategy

Type-level shapes in the existing `src/shared/wire/types.test.ts`, a
`slash-command-list wire vocabulary (#935)` block appended after the `#919` block. Values are lifted
verbatim from the three committed upstream fixtures
(`internal/protocol/testdata/slash_command_list{,_empty,_zero}.json`), so a contract change shows up
as a fixture diff rather than a disagreement between two hand-written guesses — with two departures the
block's opening comment names: the `claude-api` row's 1,145-byte description is abridged to a stand-in
that keeps both measured byte-level properties (an embedded newline, a non-ASCII rune) and its reported
cut, and the `truncated_fields: ['aliases']` case is hand-authored for want of a fixture.

Covered: `EnvelopeType` membership (a compile-time assignment — the only thing that would catch a
dropped member, since `Envelope.type` is `EnvelopeType | string` and any string compiles against a
`case` arm); `WireSlashCommand`'s exact shape including the `model` row's raw, unescaped `<model>`
hint (Go's encoder escapes `<`/`>`/`&` on the wire; the decoded value holds the literal characters);
the populated five-row payload with `commands.length + dropped_commands === 7` asserted as a value, not
just documented, plus the one row reporting a cut `description` beside four reporting `null`; the empty
frame (`commands: []`, `dropped_commands: 0`, summing to `0`); the all-zero entry (the only route that
reaches all five `WireSlashCommand` keys at once, since a frame with no entries reaches none of them),
paired with two real-capture rows proving an empty `argument_hint` and an empty `aliases` each occur
independently rather than as zero-value artefacts; the hand-authored `truncated_fields: ['aliases']`
case, asserted against a reading-rule predicate rather than left in prose; and a `@ts-expect-error`
block, one directive per omitted key across both types — relaxing any field to optional turns a
directive unused and reddens the file at compile time.

Not tested: any entry-count or per-field byte bound, since nothing enforces one and a test asserting
one would pin a fiction.

Gate: `npm test -- src/shared/wire/types.test.ts` and `npm run build`. `npm run typecheck`
short-circuits on a node-side failure (it hides every renderer error), so on a red run
`npx tsc --noEmit -p tsconfig.web.json` runs separately before any error count is read as the blast
radius.

## Related

- [Inbound message decode](inbound-message-decode.md) — [#936](https://github.com/pyrycode/pyrycode-desktop/issues/936)'s
  fail-closed decode of this vocabulary into the `slash-command-list` inbound arm; ships dormant awaiting
  [#937](https://github.com/pyrycode/pyrycode-desktop/issues/937)'s IPC carry.
- `docs/specs/architecture/936-slash-command-list-decode.md` — the decode slice's architecture spec,
  including its security review (verdict: PASS, builder self-review).
- [Question-shown wire types](question-shown-wire-types.md) — the shape this ticket follows: nested
  row declared before its payload, doc comment carrying provenance and traps, shipped dormant ahead of
  its decoder. Its `SlashCommand`/`ModelOption` contrast names the daemon's Go type this ticket
  declares a TypeScript mirror of; neither doc was edited, and the claim stays true.
- [Background-task roster store](background-task-roster-store.md) — the closer **structural**
  precedent: `BackgroundTaskRosterPayload`'s snapshot shape (`conversation_id` + never-null array +
  dropped count, per-row `truncated_fields: string[] | null`) is the one this type's normalisation and
  nullability both restate.
- [Wire codec](wire-codec.md) — `Envelope.payload` stays an opaque carrier (`unknown`) through the
  codec; this slice adds no decoder, consistent with that boundary.
- [ADR 0002 — Remote head over relay, shared wire](../decisions/0002-remote-head-over-relay-shared-wire.md)
  — "do not drift the wire types from the mobile contract without a matching daemon change"; this
  slice mirrors a settled upstream contract and makes no desktop-side architectural choice of its own,
  so no new ADR was warranted.
- `docs/specs/architecture/935-slash-command-list-wire-types.md` — the full architecture spec,
  including the security review this doc summarizes (verdict: PASS, builder self-review).
- Daemon twin (QMD `pyrycode-docs`): `docs/protocol-mobile.md` § `slash_command_list` — the
  source-of-truth contract this slice mirrors. Its field tables are SSOT; as of this ticket its status
  prose (naming #1720 as the producer, and forbidding the `dropped_commands` sum) is stale, corrected
  by the still-open pyrycode#2010.
