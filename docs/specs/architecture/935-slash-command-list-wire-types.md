# 935 — `slash_command_list` wire types

Declare the `slash_command_list` envelope member, its payload type and its nested per-command type in
`src/shared/wire/types.ts`, mirroring the daemon shape field for field. Types and tests only: the
decode (#936), the Actions-menu alias match (#681), the IPC hop, the store and the UI are later
slices. This ships dormant, exactly as #883 did for the `question_shown` family.

## Files read

- `src/shared/wire/types.ts` → `EnvelopeType` — the union to extend; there is no inbound-only union in
  this repo, so both directions live here and every v2 interactive frame sits in it under a per-member
  comment.
- `src/shared/wire/types.ts` → `QuestionShownPayload`, `WireQuestion`, `WireQuestionOption` — the
  shape to follow (#883): nested-row type declared before its payload, doc comment carrying the
  provenance and the traps, shipped ahead of its decoder. Its standing claim *"This family ships NO
  `truncated_fields`, unlike `SlashCommand` and `ModelOption`"* is about the type this ticket declares.
- `src/shared/wire/types.ts` → `BackgroundTask`, `BackgroundTaskRosterPayload` — the closest
  **structural** precedent in this repo, and closer than #883: a snapshot payload carrying
  `conversation_id` + a never-null array + a dropped count, whose rows each carry their own
  `truncated_fields: string[] | null`. Both the `[]`-normalisation argument and the
  nullable-`truncated_fields` carve-out are already written there, in the daemon's own words.
- `src/shared/wire/types.test.ts` → `describe('question-shown wire vocabulary (#883)')` — the test
  posture: fixture-verbatim values, a compile-time `EnvelopeType` membership assignment, exact
  `toEqual` over pairwise-distinct values, `not.toHaveProperty` for contract absences, and a
  `@ts-expect-error` block pinning every field required.
- `src/shared/wire/types.test.ts` → `describe('question-dismissed wire vocabulary (#894)')` — the
  precedent for a block whose values deliberately depart from a committed fixture, and for saying so
  in the block's opening comment. This ticket's fourth case does the same for a different reason.
- `~/Workspace/Projects/pyrycode` `docs/protocol-mobile.md` § `slash_command_list` — SSOT. The two
  field tables are mirrored field for field; the section's *status* prose is stale (see Context).
- `~/Workspace/Projects/pyrycode` `internal/protocol/interactive.go` → `SlashCommandListPayload`,
  `SlashCommand` and their two `MarshalJSON` normalisers — the Go structs, their tags, and the reason
  the two normalisations are not the same reason.
- `~/Workspace/Projects/pyrycode` `internal/protocol/testdata/slash_command_list{,_empty,_zero}.json`
  — the three committed fixtures every test value is lifted from.
- `docs/knowledge/features/question-shown-wire-types.md` § "The two caveats a consumer gets wrong by
  default" — carries the same `SlashCommand` contrast as the type does, so the claim exists in two
  places and this ticket must keep both true.
- `CLAUDE.md` § Conventions — the 2026-08-20 daemon-text ruling, quoted in full in the new doc comment
  rather than paraphrased.

## Design source

**Figma:** N/A — no `## Figma` section on the ticket and none is owed. This slice adds two exported
TypeScript interfaces and one union member; it renders nothing. The visual-fidelity check is
intentionally skipped.

## Context

The daemon publishes the slash commands claude will accept for a conversation, drawn from the
`commands` array of the same `initialize` control reply `model_list` comes from. `model_list`
inventories the identities claude will run as; this frame inventories the verbs the working directory
will accept. Nothing on this side models it — the string `slash_command_list` appears nowhere in
`src/shared/wire/types.ts` today, and `model_list`, the sibling frame, is unmodelled here too, so
there is no local precedent to copy from it.

Two consumers are blocked on the type rather than on the producer: **#936**, the decode slice directly
below this one, and **#681**, which matches the Actions menu's entries against names *and aliases* —
the desktop Actions menu's own `reset` entry is an alias of `clear`, not a command name, so a
name-only match greys out a command that works.

Upstream is landed and not changing: the type was declared by pyrycode#1726, the shape by #1727, and
the fixtures and the published section by #1718. The producer exists now too (#2001 maps the frame,
#2002 bounds it, #2003 emits it on the live interactive lane, #2004–#2007 retain and reconcile it on
connect, #2008/#2009 prove both delivery paths e2e).

**The published section's field tables are SSOT; its status prose is stale.** Verified against
upstream `main` at `0fe3c642`, 2026-09-02, and restated here so a rework leg does not re-derive it:

- The section's bolded *"Nothing emits this frame yet"* names **#1720** as the producer. #1720 is
  CLOSED/NOT_PLANNED — abandoned, not landed (so is #1719). The frame is emitted, by the #2001–#2007
  family.
- The section says *"Nothing counts it"* of `dropped_commands`, twice, and tells a client **not** to
  read `len(commands) + dropped_commands` as the menu's true size. That is **inverted**: the decode's
  entry cap and its count landed in #1826, and #2002 adds its own frame-level cut to the same field
  rather than recomputing it. Confirmed in the tree — `internal/turnbridge/outbound.go` sets
  `DroppedCommands: e.DroppedCommands + (len(e.Commands) - len(commands))`, and
  `cmd/pyry/session_slash_command_list.go`'s own comment states that `len(Commands) +
  DroppedCommands` is the inventory's true size after both cuts.
- The doc correction that fixes both is pyrycode#2010, still OPEN. Neither point changes the declared
  type — `dropped_commands` is a `number` either way — but both belong in the doc comment, which is
  where this repo records exactly this class of fact.

**No ADR is warranted.** This slice introduces no decision the repo has not already made: it mirrors a
published upstream shape under `src/shared/wire/`, the posture ADR 0002 already governs.

## Design

One production file, `src/shared/wire/types.ts`. Three additions, no edits to existing declarations.

### 1. `EnvelopeType` gains `'slash_command_list'`

Appended after `'question_refused'`, at the end of the v2 interactive cluster and before
`'list_conversations'` — the position the file's own growth habit puts a new interactive family in,
and it keeps the union's order parallel to the declaration order below. It carries a per-member
comment in its neighbours' posture: what the frame is, that it is a conversation-scoped **snapshot**
rather than a delta or a turn-stream item, that it rides a `control_response` from the `initialize`
reply and neither opens nor closes a turn, its `interactive` gating and absence from `v1TypeSet`, its
sibling relationship to the unmodelled `model_list` (identities vs verbs), and the SSOT plus the
declaring, shape, fixture and producer tickets.

### 2. `WireSlashCommand` — the nested per-command row

Declared before its payload, as `BackgroundTask` and `WireQuestion` are.

```ts
export interface WireSlashCommand {
  name: string
  argument_hint: string
  description: string
  aliases: string[]
  truncated_fields: string[] | null
}
```

**Named `WireSlashCommand`, not `SlashCommand`, and the choice is deliberate.** Two reasons, both
recorded in the doc comment so a later reader does not read the prefix as an accident. First, `Wire`
is this cluster's prefix for a nested row whose bare name is generic enough to be wanted again
downstream — `WireQuestion`, `WireQuestionOption`, `WireModalOption` — and #681 and #936 will each
want a domain notion of a slash command. Second, `QuestionShownPayload`'s doc comment and
`docs/knowledge/features/question-shown-wire-types.md` both carry a standing claim naming
`SlashCommand` as the *daemon's* Go type; leaving that name unclaimed on this side keeps the referent
of both unambiguous. Neither is edited by this ticket, and both stay true — this type does carry
`truncated_fields`.

The payload keeps the bare `*Payload` name every other payload in the file uses.

### 3. `SlashCommandListPayload`

```ts
export interface SlashCommandListPayload {
  conversation_id: string
  commands: WireSlashCommand[]
  dropped_commands: number
}
```

Field-for-field with the daemon's struct, in wire order, all keys always present (no `omitempty` on
any of the eight across the two structs).

`commands` and `aliases` are plain non-optional arrays, never `| null`: the daemon's two
`MarshalJSON` normalisers guarantee it, so no consumer branches on absent-vs-empty. Their reasons
differ and the doc comment keeps them apart, because the asymmetry is upstream's and a reader who
flattens it draws the wrong conclusion from an empty `aliases`. For `commands`, `[]` is a **positive
statement** that claude offered nothing. For `aliases`, `[]` is a **collapse**: claude never emits an
empty alias array (42 of the capture's 51 entries omit the key, 9 carry a non-empty one), so the wire
states one position for both absent and empty.

`truncated_fields` is `string[] | null` and its nullability is real — `null` means nothing was cut for
this row, a distinct value from `[]`, never collapsed into it. Each row reports its own; there is no
hoisted list. This is `BackgroundTask.truncated_fields` exactly, including the trap that within one
payload `commands: null` is out of contract while a row's `truncated_fields: null` is a valid value.

### Doc-comment obligations (AC 4)

Three facts are recorded at the declaration, and each is the one a modeller gets wrong by default:

1. **Trust tier.** `name`, `argument_hint`, `description` and every string in `aliases` are
   **workspace-authored** — whoever wrote the repository wrote them — which is a *lower* tier than the
   claude-authored strings `model_list` and `question_shown` carry, not a restatement of it. The
   daemon **bounds them and does not sanitize them**; `0x0a` is the only sub-`0x20` byte measured
   anywhere across the 51 entries' four string fields, so a newline is the control character that
   actually occurs and a row assuming one line per description will not get one. The render boundary
   that owes the sanitization is this client's, and the render slice of this family discharges it.
   CLAUDE.md's daemon-text ruling is quoted in full rather than paraphrased: inert, escaped,
   length-bounded text only, never a raw-markup sink (`innerHTML` / `dangerouslySetInnerHTML`), an
   attribute, a URL, a filename, a cache key, a lookup path or a log.
2. **A cut `aliases` is unknowable from `aliases` alone.** Because `aliases` collapses absent and
   empty into the same `[]`, a `truncated_fields` naming `aliases` is the *only* signal separating
   "cut to nothing" from "none" — read it as **unknown**, never as *no aliases*. This is the one
   place where the collapse that spares every other row a branch costs a reader information.
3. **`dropped_commands` is counted and carried**, so `len(commands) + dropped_commands` **is** the
   menu's true size — with the stale published claim named as stale, and pyrycode#2010 named as the
   open correction, so a reader who checks the upstream section against this comment finds the
   disagreement already adjudicated rather than discovering it.

The comment also records what this type does **not** do: no bounds, no branded numbers, no max
constants, no charset assumption on `name` (one measured name is `__remote-workflow`), and no cached
count (51 against claude 2.1.239 here, 74 hand-counted against 2.1.220 in a different working
directory — the list is per session and per working directory by design).

## State + concurrency model

None, and that is the design rather than an omission. This slice adds two `interface` declarations and
one union member; nothing is constructed, decoded, stored, subscribed to or torn down. No store slice
changes, no async task is launched, no IPC channel is added. The frame's arrival, its retention and
its reconciliation on connect are the daemon's (#2003–#2007); its decode is #936's and its store is a
later slice's.

## Error handling

None at this layer, deliberately. Every field being required is load-bearing: it leaves the
fail-closed narrower in #936 no optional key to wave through, so a missing field is a reject by
construction. A required field is still only a promise the wire has not kept until it is checked —
the doc comment says so explicitly, and says to reach this type through a validating narrower rather
than a bare `as SlashCommandListPayload` on `Envelope.payload`, which would hand a `.map` a non-array
from a malformed frame. That is the same posture `QuestionShownPayload` records.

## Testing strategy

`src/shared/wire/types.test.ts`, one new `describe('slash-command-list wire vocabulary (#935)')`
block appended after the `#919` block. Vitest, node environment, no renderer surface. Values are
lifted verbatim from the three committed upstream fixtures, so a contract change shows up as a fixture
diff rather than as a disagreement between two hand-written guesses — with one stated exception (the
fourth case below), which the block's opening comment names, following the `#894` block's precedent
for departing from a fixture and saying why.

The four AC-3 cases, plus the two structural pins the sibling blocks carry:

- **Envelope membership.** `const t: EnvelopeType = 'slash_command_list'`. A compile-time assignment
  is the whole test: `Envelope.type` is `EnvelopeType | string`, so a decoder's
  `case 'slash_command_list':` compiles green whether or not the member was ever added, and nothing
  else catches a dropped one.
- **The populated frame** (`slash_command_list.json`): `conversation_id: 'c1'`, five rows in claude's
  own order, `dropped_commands: 2`. Exact `toEqual` over the whole payload — the four string fields
  are all plain `string`, so only distinct values catch a transposition tsc is structurally blind to.
  Asserts the non-zero drop is read as a **value**, and pins `commands.length + dropped_commands === 7`
  as the menu's true size (AC 4.3, the inverted claim, asserted rather than only commented). Also
  pins the one row reporting a cut `description` beside four reporting `null`, and `model`'s `<model>`
  hint arriving unescaped on this side.
- **The empty frame** (`slash_command_list_empty.json`): `commands: []`, `dropped_commands: 0`. `[]`
  is a positive statement that claude offered nothing, and `0` is a value never consulted for
  truthiness.
- **The zero-value entry** (`slash_command_list_zero.json`): the one all-zero row, which is the only
  route to `WireSlashCommand`'s five keys — a frame carrying no entries reaches them at all. It is
  also exactly AC 3's third case: an empty `argument_hint`, an empty `aliases` and a `null`
  `truncated_fields` on one entry, asserted with no consumer branch on absent-versus-empty. The
  populated fixture's `model` row is asserted alongside it to show an empty `aliases` and an empty
  `argument_hint` each occur independently in real capture data, so neither reads as a zero-value
  artefact.
- **A `truncated_fields` naming `aliases`** — hand-authored, and the block says so: no committed
  upstream fixture carries this case, and the populated fixture's only cut is `description`. The
  assertion is the reading rule, not just the shape: `aliases: []` beside
  `truncated_fields: ['aliases']` means **unknown**, and the test states that a consumer reading it as
  *no aliases* would grey out a working command (#681's failure mode, `reset` being an alias of
  `clear`).
- **Every field required** — a `@ts-expect-error` block, one directive per omitted key across both
  types. If any field were ever relaxed to optional the directives stop erroring and this file fails
  at compile time. This is the pin that protects #936's fail-closed narrower.

Gate: `npm test -- src/shared/wire/types.test.ts` and `npm run build`. On a typecheck failure,
`npm run typecheck` short-circuits — a node-side error hides every renderer error — so
`npx tsc --noEmit -p tsconfig.web.json` runs separately before any error count is read as the blast
radius.

## Open questions

- **Does the `QuestionShownPayload` doc comment's `SlashCommand` reference need amending now that a
  mirror exists here?** Resolved during planning: no. Naming this type `WireSlashCommand` keeps that
  comment's referent — the daemon's Go type — unambiguous, and the claim stays true either way since
  this type does carry `truncated_fields`. Editing it would be an adjacent-code change this ticket
  does not need. The same holds for the identical claim in
  `docs/knowledge/features/question-shown-wire-types.md`, which is the documentation phase's file
  regardless.
- **Should `truncated_fields`' element type be narrowed to the four wire names?** No, and the doc
  comment says why: `BackgroundTask.truncated_fields` already records that each frame's element
  vocabulary is its own distinct set, which is the argument against narrowing any of them. A closed
  set here would fail-close a valid future frame — the drift risk CLAUDE.md and ADR 0002 rank above
  cosmetic robustness.
- Nothing else outstanding. If implementation contradicts any of the above, a `## Revisions` entry
  lands in the same commit as the code that departs.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] SHOULD FIX — an unchecked cast inverts the `aliases` reading rule silently, and
  the plan as first written did not say so.** The boundary is `Envelope.payload` (`unknown`) →
  `SlashCommandListPayload`, and this slice deliberately adds no narrower (#936 owns it), so the only
  enforcement today is that every field is required. That is enough to catch a missing key *if the
  frame is validated* and worth nothing if it is not — and the failure is not the generic one. A bare
  `as SlashCommandListPayload` on a frame whose `truncated_fields` key is absent yields `undefined`,
  and `row.truncated_fields?.includes('aliases')` is then falsy for exactly the same reason `null` is:
  the reader concludes *nothing was cut*, then reads `aliases: []` as *no aliases* — the one wrong
  answer AC 4.2 exists to prevent. The declaration's own reading rule is therefore conditional on
  validation, and the doc comment must say that rather than stating the rule unconditionally. Phase B
  adds it to `WireSlashCommand`'s comment beside the existing bare-cast warning.
- **[Trust boundaries] No further findings.** The boundary is a single named type rather than three
  parse sites, and the four untrusted strings carry no type-system signal — no branded types — which
  is this file's convention for every wire string it already declares, recorded here as the standing
  decision rather than left to be re-argued per family.
- **[Tokens, secrets, credentials] SHOULD FIX — record the send-back amendment at the type.** The
  payload carries no token, no key and no nonce: `conversation_id` is a daemon-asserted routing key,
  and unlike `question_batch_id` and `modal_id` it is not unguessable and grants no inbound
  capability. The frame declares no inbound verb. The one amendment a client gets wrong is that a
  `name` *is* meant to travel back — sending the slash command is the feature — and publishing a name
  does not make it trusted: it goes inbound as ordinary message text, on a path that does not consult
  this list as a command vocabulary, and no field here reaches a child process as an argv element.
  Phase B states that at the payload, so a consumer does not read "report, never a control input" as
  forbidding the feature.
- **[File / storage operations] No findings — nothing here derives a path, and the ruling that keeps
  it that way is quoted rather than paraphrased.** No field is concatenated into a filesystem path, no
  file is opened, and no state is persisted by this slice. The live hazard is a shape one: `name`
  *looks* like an identifier and is not (`__remote-workflow` is measured), so keying a cache, a memo
  map or a lookup by it is the plausible mistake — which is why CLAUDE.md's ruling is carried in full,
  including its filename / cache-key / lookup-path clauses, rather than trimmed to the render-only
  subset a paraphrase leaves behind.
- **[Inter-process / Electron attack surface] No findings — this slice has no runtime footprint at
  all.** It adds two `interface` declarations and one union member. All three are type-level and erased
  at compile time, so the JS emitted for `src/shared/wire/types.ts` is byte-unchanged; no
  `contextBridge` API, no `ipcMain` channel, no `BrowserWindow` and no handler is added, and nothing
  new crosses the preload bridge. The renderer gains no capability it did not have.
- **[Cryptographic primitives] No findings — no primitive is reached.** No randomness is generated, no
  key or nonce is handled, and no field is compared against a secret, so no `timingSafeEqual`
  obligation arises. The Noise session this frame rides inside is untouched.
- **[Network & I/O] OUT OF SCOPE — the frame's size bound is already enforced upstream of any parse,
  and must not be re-modelled here.** A hostile or oversized `commands` array cannot reach a decode
  unbounded: `MAX_PLAINTEXT_BYTES` (65519) caps the decrypted envelope at the transport, and the
  capture's 51 entries serialise to 14,277 bytes of compact UTF-8, so the real traffic sits well under
  it — with the daemon's own entry cap (#1826, #2002) reporting its cut through `dropped_commands`.
  Modelling a bound in this type would be stricter-than-wire and would fail-close a valid frame. The
  decode's own defensive parse is #936's.
- **[Error messages, logs, telemetry] SHOULD FIX — name *why* the never-a-log clause bites harder on
  this path than on its neighbours.** `0x0a` is the only sub-`0x20` byte measured anywhere across the
  51 entries' four string fields, and a newline is precisely the byte that splits a log line: logging a
  workspace-authored `description` (up to 1,145 bytes, embedded newlines measured) lets whoever wrote
  the repository forge log records. The ruling already forbids it; the plan's doc comment gives the
  reason, so a later slice does not read the clause as boilerplate and log "just the name".
- **[Concurrency] No findings — no async work exists to own or cancel.** This slice launches no task,
  registers no listener, holds no timer and mutates no shared state, so there is no ownership,
  cancellation, teardown or check-then-act question to answer. Delivery, retention and connect-time
  reconciliation are the daemon's (#2003–#2007).
- **[Threat model alignment] OUT OF SCOPE for the render boundary, named with its owner.** Threat 1
  (prompt injection, `severity: high`, `mitigation: partial`) lands here at a *lower* tier than
  `model_list`'s — workspace-authored rather than claude-authored — and the daemon bounds but does not
  sanitize, so the sanitization is owed by this client. This slice inherits and records the constraint;
  the render slice of this family discharges it, and #681's Actions-menu match is the first consumer
  that must not resolve a menu entry by rendering an unescaped `name`. A hostile relay is content-blind
  and on-path: dropping, delaying or replaying this frame can only produce a stale or absent menu,
  which misinforms (a working command greyed out) and grants nothing. A hostile daemon response is
  #936's fail-closed narrower to reject, and this slice's all-required declaration is what leaves that
  narrower no optional key to wave through.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
