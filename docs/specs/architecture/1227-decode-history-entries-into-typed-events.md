# #1227 — Decode a history page's entries into the typed events the timeline draws

## Files read

- `src/main/transport/inboundMessage.ts` → `parseHistoryEntry`, `parseHistoryPagePayload` — the shipped
  envelope-level decode whose fail-whole-page posture this ticket must NOT relax; `InboundDaemonMessage`'s
  `history-page` arm — the shape that changes; `parseInboundMessage`'s `history_page` case — where the new
  stage is invoked, and the narrow-before-logging invariant it keeps.
- `src/main/transport/inboundMessage.ts` → `parseAssistantDeltaPayload`, `parseTurnEndPayload`,
  `parseTurnStatePayload`, `parseToolUsePayload`, `parseToolResultPayload`,
  `parseSessionTransitionPayload`, `parseStallPayload`, `parseApiRetryPayload`, `parseCompactingPayload`,
  `parseUnrecognizedMessagePayload`, `parseMessagePayload` — the eleven parsers the new switch calls.
  Every one requires `conversation_id`; five carry a closed enum (`state`, `reason`, `site`, `role`);
  two carry an optional field (`input`, `result_detail`) narrowed by `optionalStringMap` / `optionalString`.
- `src/main/daemonConnection.ts` → the `'history-page'` case of the inbound switch — the correlation gate
  and the fresh-literal emit whose `entries` source changes type.
- `src/shared/ipc/events.ts` → the `historyPageReceived` arm and its SECURITY paragraph — the contract
  that stops saying "opaque `type`/`payload`"; `toolUse` / `toolResult` / `unrecognizedMessage` /
  `sessionTransition` arms — the render-field sets the decoded events mirror.
- `src/shared/wire/types.ts` → `HistoryEntry` (unchanged as a wire type, docblock stale on two points),
  `HistoryPagePayload`, `MessagePayload` — the shape a stored operator `message` carries.
- `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent` — the list of non-null arms IS
  AC2's eleven, and its per-arm "the id STOPS here" filter-plus-fresh-literal is the precedent this
  decode applies one layer earlier.
- `src/main/diagnosticLog.ts` → `DiagnosticEvent` — its allowlisted field set already has `count?`, so a
  skip count needs no new field.
- `docs/knowledge/features/inbound-message-decode-history.md` § the #1222 entry — records that the page
  decode ships "no cursor, entry payload, entry `type`, entry `id` … ever reaches a log line", the
  constraint any new diagnostic here inherits.
- `src/main/transport/inboundMessage.test.ts` § `history_page recognition` / `fail-closed` /
  `diagnostics`, and `src/main/daemonConnection.test.ts` § the history-page describe — the fixture
  constants (`HISTORY_ENTRY`, `HISTORY_PAGE`, `ENTRY`, `PAGE`) and the assertion sites this change moves.

## Design source

**Figma:** N/A — the ticket body carries no `## Figma` section and the work is entirely main-process
decode. Nothing rendered changes; `timelineBridge`'s `historyPageReceived` arm stays a dormant null.

## Context

#1222 landed the ask, the correlation and the page decode: the background process sends `request_history`,
matches the reply by `Envelope.in_reply_to`, and emits `historyPageReceived` carrying
`entries: readonly HistoryEntry[]` — `{ id, type, payload, ts }` where `type` is a stored string nothing
re-validates and `payload` crosses verbatim as an opaque record.

That leaves the step between "a page arrived" and "the reducer can run" unowned. #1223 draws a page
through the timeline reducer, but the reducer consumes typed timeline events and nothing turns a stored
`{ type, payload }` pair into one. The parsers that could are private to `inboundMessage.ts`, reachable
only through `parseInboundMessage`, which is bound to raw plaintext. The window must not grow a
wire-payload decoder: CLAUDE.md puts frame decode and event parsing in the background process, and an
entry's `payload` is the most untrusted field on the whole event union.

This ticket is that step, on the side that already owns decode. It **narrows** the untrusted surface: today
arbitrary unparsed JSON crosses IPC; after this change nothing untyped does.

No ADR is warranted — this applies existing decisions (ADR 0002's no-client-invented-bounds posture and the
process-boundary rule) rather than making a new one.

### Sizing — measured overage, and why it ships as one ticket anyway

Two rows of the size-S table are exceeded, and I am stating both rather than re-counting them downward.

- **Consumer call sites needing simultaneous update: ~16, over the 10 boundary.** Three production
  (`InboundDaemonMessage`'s arm, `parseInboundMessage`'s `history_page` case, the `events.ts` arm; the
  `daemonConnection` emit and the four bridge null arms need no edit) plus ~13 test sites — 8 `toEqual`
  assertions and the `HISTORY_ENTRY` constant in `inboundMessage.test.ts`, 2 assertions and the `ENTRY`
  constant in `daemonConnection.test.ts`. Two of those are semantic rewrites, not swaps: the shipped
  "carries an entry whose type this client does not recognise" and "carries an entry payload verbatim"
  tests both invert into skip tests.
- **Total written work: ~750–850 lines**, straddling the 800 boundary depending on how far the per-type
  and skip-matrix tests go table-driven. The refiner estimated ~700.

The other four rows hold: 4 production files (≤5), 5 new exported types (≤5), 5 acceptance criteria (≤5),
and the decode has two reject branches, not ten (an undrawn/unknown `type`, and a payload that fails to
parse) — the eleven arms are a dispatch, not a state machine.

**No split survives the floor rule.** Split depth allows one (parent #1088, no grandparent), but every
candidate child is consumed by exactly one sibling in the same family and by nothing else: "the decode
function and its types" is consumed only by "wire it into the page event"; "decode six types now, five
later" ships a half-correct AC3 and its second half adds no independently checkable deliverable; the
`types.ts` docblock drift fix is a one-line child. The floor beats the ceiling — a ceiling miss costs one
continuation leg, an unverifiable slice costs a ticket nothing resumes — so this builds as one ticket with
the overage stated here.

## Design

### The shape that crosses

Two mirrored declarations, transport-side and IPC-side, because `src/main/transport/` is IPC-free by
construction (`events.ts` states this as the reason `HistoryRequestFailure` duplicates `HistoryRejectReason`
by hand rather than importing it). Same reason, larger type.

**Transport (`inboundMessage.ts`), newly exported:**

- `DecodedHistoryEvent` — a union of eleven arms discriminated on `type`, each carrying the camelCase render
  fields its live `DaemonEvent` twin carries and **no `conversationId`**: `assistantDelta`, `turnEnd`,
  `turnState`, `toolUse`, `toolResult`, `sessionTransition`, `stallDetected`, `apiRetry`, `compacting`,
  `unrecognizedMessage`, `messageReceived`. The `messageReceived` arm carries
  `message: Omit<MessagePayload, 'conversation_id'>`, mirroring the live arm's reuse-the-wire-type shape with
  the drop expressed in the type itself. `toolUse.input?` and `toolResult.resultDetail?` stay optional, so
  absence keeps meaning "the wire omitted it" rather than collapsing into a value.
- `DecodedHistoryEntry` — `{ id: number; ts: string; event: DecodedHistoryEvent }`. `id` and `ts` survive
  because #1225 joins a page to the live stream on `ts`.
- `DecodedHistoryPage` — `{ entries: readonly DecodedHistoryEntry[]; cursor: string; at_start: boolean }`.
  `at_start` keeps its wire name here; the snake→camel flip stays at the emit, this channel's convention.

**IPC (`events.ts`), newly exported:** `HistoryTimelineEvent` and `HistoryTimelineEntry`, structurally
identical mirrors. `historyPageReceived.entries` becomes `readonly HistoryTimelineEntry[]`, and the
now-unused `HistoryEntry` import is dropped.

**Why nested `{ id, ts, event }` rather than eleven arms each carrying `id`/`ts`.** The nested `event` is
directly the object a consumer hands to the live-lane mapping; a flattened union would force every consumer
to strip two fields back off before it could. AC2's "run the live-lane mapping over it unchanged" is a claim
about this object's shape.

**Why no `conversationId` on the event, not even the client-owned one.** `translateTimelineEvent` drops it
on every arm — "the id STOPS here" — so the mapping never reads it, and duplicating the page-level
client-owned id onto each entry would put a second routing key beside the one that is already authoritative.
The page's `historyPageReceived.conversationId` stays the only one. #1223 owns whatever injection its call
into `translateTimelineEvent` needs.

**Both mirrors carry the untrusted-text contract on their docblocks, and that is not optional.** Decoding
makes the SHAPE trusted and never the CONTENT: `assistantDelta.text`, `toolUse.name` / `inputSummary` and
its `input` map's keys AND values, `toolResult.resultSummary` / `resultDetail`, `unrecognizedMessage.raw` /
`messageType`, `sessionTransition.workspaceCwd` and `message.text` are all replayed daemon-, claude- or
operator-authored strings carrying exactly the trust class of the live frame they mirror. Each is PLAIN
TEXT ONLY at the render boundary — never `innerHTML` / `dangerouslySetInnerHTML`, never an attribute or a
URL, and never a filename, a cache key or a lookup path. `workspaceCwd` is the trap worth naming twice: it
is a daemon-supplied filesystem path and this client never resolves, joins or opens it. Writing the
contract onto the new types is what makes #1223 inherit it; a mirrored type that silently drops the
warning its live twin carries is how an inherited "never used as X" claim becomes false in a new consumer.

**Drift between the two mirrors** is caught at two points. The emit assigns the transport array into the
IPC-typed field, so a missing or differently-shaped arm is a compile error at that one site; and a
type-only mutual-assignability guard in `daemonConnection.test.ts` (typechecked — `tsconfig.node.json`
includes `src/main/**/*`) catches drift in the other direction too. Residual gap, stated rather than
papered over: an added *optional* field on one side alone passes both checks.

### The decode

Three new module-private functions in `inboundMessage.ts`, plus one exported page-level entry point:

- `decodeHistoryEvent(type: string, payload: Record<string, unknown>): DecodedHistoryEvent | null` — a switch
  over the eleven wire type strings (`assistant_delta`, `turn_end`, `turn_state`, `tool_use`, `tool_result`,
  `session_transition`, `stall`, `api_retry`, `compacting`, `unrecognized_message`, `message`), each arm
  calling its existing parser and building a **fresh named-field literal** from the result, dropping
  `conversation_id` (and, on `session_transition`, `previous_session_id`, the same field the live emit
  drops). `default: return null` — AC3. It **mirrors** `parseInboundMessage`'s type-to-parser pairing and
  shares none of its body; that switch stays untouched (it is bound to raw plaintext and interleaved with
  per-case diagnostics keyed on the frame's bytes).

  **It MUST be a `switch` statement and MUST NOT be an object-literal dispatch table.** The discriminant is
  a stored, daemon-authored string that nothing re-validates. A `switch` compares values and touches no
  prototype chain; `TABLE[entry.type]` is a LOOKUP PATH on an untrusted string, and `type: '__proto__'`
  resolves it to `Object.prototype` — truthy, and then called. A `constructor` entry is worse. The table
  form is the shape this reads most naturally as, which is exactly why the prohibition is written down
  rather than left to taste. Same rule for any later "which types do we draw?" set: a `Set`, never a bare
  object used as a map.
- `decodeHistoryEntry(entry: HistoryEntry): DecodedHistoryEntry | null` — wraps the call in
  `try { … } catch { return null }` with **no error binding**, so no daemon-authored string can reach a
  message or a log even by accident. Returns `null` for both skips; a non-null result is
  `{ id: entry.id, ts: entry.ts, event }`.
- `decodeHistoryPage(page: HistoryPagePayload): DecodedHistoryPage` — a push-if-non-null loop preserving
  served order among survivors, carrying `cursor` and `at_start` through untouched. Never throws. An empty
  page and an all-skipped page both produce `entries: []`.

`parseInboundMessage`'s `history_page` case becomes: `parseHistoryPagePayload` (unchanged, still fails the
**whole page** closed on a malformed entry envelope) → the existing content-free `inbound-decoded` log
(narrow-before-logging preserved; the decode below cannot throw) → `decodeHistoryPage` → the same
`{ kind: 'history-page', historyPage, inReplyTo }` return with the new element type.

**The two fail postures stay separate and both are load-bearing.** `parseHistoryEntry` /
`parseHistoryPagePayload` fail the whole page closed when an entry's *envelope* (`id`, `type`, `payload`,
`ts`) is malformed — #1222's shipped guarantee, not relaxed here. AC4's skip belongs to the new
payload-decode stage only.

`daemonConnection.ts`'s emit is unchanged in code — `inbound.historyPage.entries` already flows into
`entries` — and changes only in its docblock, which currently says the entry payloads "stay opaque here".

### What does not change

`HistoryEntry` stays the wire type, mirroring the daemon's published shape field-for-field.
`parseHistoryEntry` and `parseHistoryPagePayload` keep their signatures and behaviour. No renderer file
changes; the four exhaustive bridges keep their null arms.

## State + concurrency model

None. Every function added is a pure, synchronous, total map over an already-materialised array, called on
the existing inbound-frame path. No store, no async work, no subscription, no timer, nothing to cancel.

## Error handling

- **Entry envelope malformed** (`id`/`type`/`payload`/`ts`) → `WireDecodeError` from the shipped
  `parseHistoryEntry`, failing the whole page; the frame is dropped by `parseInboundMessage`'s existing
  caller contract. Unchanged.
- **Payload fails to parse** → the parser throws `WireDecodeError`; `decodeHistoryEntry` catches without
  binding and returns `null`. The entry is skipped, the rest of the page crosses.
- **Type not among the eleven** → `null` from the switch's `default`. Not an error, costs nothing.
- **Every entry skipped** → an empty page, never a failure. `cursor`/`at_start` still cross as served, so a
  walk can still step past it.

**Logging.** The page's existing `inbound-decoded(code: 'history_page', bytes, hash)` line is untouched.
One line is added, emitted **only when at least one entry was skipped**:
`{ event: 'inbound-decode-skipped', code: 'history_page_entry', count, hash }`. Every field is
content-free and already in `DiagnosticEvent`'s allowlist — `count` is the number skipped, `hash` is the
same one-way frame digest the page line carries, so the two correlate. Deliberately absent: the entry's
`type`, `id`, `ts`, any payload field, and the caught error's message. A page that silently loses every
entry is exactly the failure that is slow to find without this, and the house rule is a content-free
structured log for every classified error.

**AT MOST ONE LINE PER PAGE, NEVER ONE PER ENTRY**, and that is a security constraint rather than a
tidiness one. A page is daemon-sized: #1222's own test proves 1200 entries fit inside one frame, and a
hostile daemon can send them all malformed and repeat the frame. Logging per entry hands it a
three-orders-of-magnitude log-write amplifier against a disk-backed sink; aggregating to a count leaves it
one line per frame, the rate the transport already runs at. `count` is a client-side observation about
this client's own parsing, not daemon content, so aggregating loses nothing an operator needs.

## Testing strategy

vitest only — this is main-process decode with no DOM and no interaction, so no Playwright spec.

`src/main/transport/inboundMessage.test.ts`:

- **Per-type decode, table-driven** over all eleven: a well-formed stored payload (including
  `conversation_id`) in, the expected fresh event literal out, asserted with `toEqual` so an extra
  smuggled field reddens. Covers both enum-bearing arms (`turn_state`, `session_transition`,
  `unrecognized_message`, `message`) and both optional-field arms (`tool_use` with and without `input`,
  `tool_result` with and without `result_detail`, pinning `undefined` rather than `{}`/`''`).
- **No `conversation_id` crosses** — a payload carrying one decodes to an event whose keys do not include
  it, on every arm that has one.
- **`previous_session_id` is dropped** on `session_transition`, matching the live emit.
- **AC3 skip matrix, table-driven**: `background_task_started`, `background_task_updated`,
  `background_task_roster`, `model_announced`, `model_list`, `slash_command_list` (decoded on the live lane,
  never drawn), `thinking_progress`, `rate_limited` (no parser at all), and a type this client has never
  seen — each yields an empty page from a one-entry page, with `cursor`/`at_start` intact.
- **The prompt case, pinned outright**: a page carrying `modal_shown` and `question_shown` entries — with
  payloads that would parse on the live lane — crosses as an empty page. Nothing answerable reaches the
  window from history.
- **AC4**: an entry whose payload is missing `conversation_id`, one whose enum field is out of set, one
  whose payload is `{}` — each skipped while a well-formed sibling in the same page survives.
- **Order among survivors**: a page of five entries where the second and fourth skip preserves the first,
  third and fifth in served order.
- **Empty page and all-skipped page** both cross as `entries: []` with `cursor`/`at_start` as served.
- **A `__proto__` key in an entry payload** decodes inertly and pollutes no prototype (`{}.polluted`
  stays `undefined` after the decode) — the parsers already build fresh literals; this pins it at the new
  stage.
- **Diagnostics**: the skip line carries only `event`/`code`/`count`/`hash`, names no entry type, id, ts or
  payload field; and no skip line is emitted when nothing was skipped.
- **Updated shipped tests**: `HISTORY_ENTRY` gains a `conversation_id` so the page fixtures still carry a
  surviving entry; the eight `toEqual` sites move to the decoded expectation; the "carries an unrecognised
  type" and "carries a payload verbatim" tests invert into skip tests with their rationale rewritten. The
  fail-closed describe is untouched — that is the envelope-level posture, deliberately unchanged.

`src/main/daemonConnection.test.ts`:

- The correlated page reaches `historyPageReceived` with **typed** entries, attributed to the asked
  conversation, `cursor`/`atStart` as served (two updated expectation sites plus the `ENTRY` constant).
- A page whose entries all skip still emits `historyPageReceived` with `entries: []` — the correlation is
  settled, so #1224's walk can never stall on one.
- A type-only mutual-assignability guard pinning the two mirrored unions against each other.

Fakes over mocks throughout: the existing `historyPagePlaintext` / `encodeHistoryPage` fixture helpers and
the fake relay driver, unchanged.

## Open questions

1. **Should the `messageReceived` arm be nested (`message: {…}`) or flattened (`messageId`, `role`,
   `text`)?** Planned nested, mirroring the live arm. Resolve during implementation if the nesting makes
   the mutual-assignability guard awkward; record any change under `## Revisions`.
2. **Is `count` on the skip line enough, or does an operator need the skipped types?** Planned count-only —
   a stored `type` is daemon-authored and AC4 forbids naming it. If implementation shows the count alone is
   unactionable, the answer is still not to log the type; note it for #1223 instead.

## Security review

**Verdict:** PASS (first pass FAIL — three MUST FIX findings, all fixed in the plan above before this
section was written; they are recorded below with what changed.)

**Findings:**

- **MUST FIX (fixed) — `decodeHistoryEvent`'s dispatch, § Design.** The first draft said only "a switch
  over the eleven wire type strings", which leaves the natural refactor to an object-literal table open. The
  discriminant is a *stored, daemon-authored string nothing re-validates*, so `TABLE[entry.type]` is a lookup
  path on untrusted input: `type: '__proto__'` resolves to `Object.prototype` (truthy, then invoked) and
  `'constructor'` is worse. This is the ticket's own "no field of a payload may become a lookup path" rule
  applied to the field the plan was not treating as a payload field. Fixed: the plan now mandates a `switch`
  statement, forbids the table form by name, and extends the rule to any later type set (`Set`, never a bare
  object).

- **MUST FIX (fixed) — skip-diagnostic amplification, § Error handling.** A per-entry skip log is a
  log-write amplifier a hostile daemon drives directly: #1222's shipped test proves ~1200 entries fit in one
  frame, every one can be malformed, and the frame can repeat. That turns one inbound frame into ~1200 disk
  writes. Fixed: the plan now pins at most one aggregated line per page, with the amplification stated as
  the reason so a later "make it easier to debug" edit sees the cost.

- **MUST FIX (fixed) — the mirrored types shipped without the untrusted-text contract, § Design.** The new
  `DecodedHistoryEvent` / `HistoryTimelineEvent` arms carry nine daemon-, claude- or operator-authored
  strings whose live `DaemonEvent` twins each carry an explicit plain-text-NEVER-HTML / never-a-path
  warning. A mirror that drops the warning is how an inherited "never used as X" contract becomes false in a
  new consumer, and #1223 is precisely the new consumer with the DOM sink. Fixed: the contract is now stated
  on both mirrors, naming every field it binds, with `workspaceCwd` called out twice as the field that looks
  like a path.

- **SHOULD FIX — verify, do not assume, that `optionalStringMap` drops the reserved keys.**
  `toolUse.input` is the one daemon-KEYED map crossing on this path. `RESERVED_MAP_KEYS` exists in
  `inboundMessage.ts` and the `toolUse` docblock claims `__proto__` / `constructor` / `prototype` "can never
  appear (dropped by the decoder)", but this ticket is the first to route a *stored* map through it. Read
  `optionalStringMap` in Phase B and pin it with the `__proto__`-in-a-payload test the plan already lists.

- **SHOULD FIX — `unrecognizedMessage.raw` is a bounded snippet of a line the daemon could not parse**, so
  its content is the least predictable string on the union. It is not a NEW exposure — it crosses verbatim on
  the live lane today and the daemon bounds it at construction — but the decode must not re-derive, trim or
  re-bound it, and the plan's verbatim-carry posture is what keeps that true.

- **Trust boundaries — addressed, not N/A.** The untrusted→trusted crossing is exactly two edges: the stored
  `payload` record into the eleven parsers, and transport→IPC at `emitDaemonEvent`. Both are explicit and
  single-sited. The design *narrows* the second edge: today `payload: Record<string, unknown>` crosses as
  arbitrary nested JSON; after this change no reference to the `JSON.parse` result survives into the emitted
  event at all — every arm builds a fresh literal of scalars plus `optionalStringMap`'s fresh map — so the
  `__proto__`-as-an-own-data-property hazard `HistoryEntry`'s docblock warns consumers about stops existing
  downstream of the decode rather than being inherited by #1223.

- **Threat model — the prompt case is the sharpest threat and is closed by construction.** A future daemon
  that starts logging `modal_shown` / `question_shown`, or a hostile one that puts either in a page, must not
  produce something answerable in the window: a replayed prompt answered "now" would send a resolution for a
  modal that closed hours ago. Neither type is in the switch, so neither can produce an event under any
  payload, and the plan pins it with a dedicated test rather than resting on the absence of a case label.
  Page forgery generally stays closed one layer up, at #1222's correlation gate, unchanged here.

- **Tokens / crypto / filesystem / network / concurrency — not applicable, by construction rather than by
  inspection.** None of the eleven parsed payload types has a field that could hold a token or key material
  (the closest, `session_transition.new_session_id`, is a routing id under this repo's established
  convention); nothing here constructs a path, opens a socket, sets a timeout or starts async work. The one
  crypto-adjacent value on the path is the existing `hashPlaintext` digest, reused verbatim — repeating an
  identical hash on a second log line conveys no information the first line did not.

- **DoS — considered and rejected as a finding.** The decode is O(entries) over an already-materialised
  array, with no regex, no recursion, and nothing allocated from a daemon-supplied count. The frame-level
  `MAX_PLAINTEXT_BYTES` guard and the daemon's own construction-time clamp already bound the work before
  this code runs, so a client-invented entry bound here would defend an unreachable failure and would drop
  valid pages — the ADR 0002 posture `parseHistoryPagePayload` already documents.

- **OUT OF SCOPE — sanitisation at the DOM sink belongs to #1223**, which owns the render slice. This ticket
  ships no DOM sink; it discharges its half by carrying the contract on the type #1223 consumes.
