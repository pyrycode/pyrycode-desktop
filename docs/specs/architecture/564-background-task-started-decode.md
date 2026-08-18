# Spec: Background-task open — decode the daemon `background_task_started` frame into a typed `backgroundTaskStarted` event (#564)

**Size:** S (held — PO's `size:s` verified, see § Scope note) · **Security-sensitive:** yes · Split from
#554 · Siblings: #565 (`background_task_updated`), #566 (`background_task_roster`) · Store consumer: #567

## Context

The daemon can report a turn finished — `turn_end` with `stop_reason: end_turn`, `turn_state` → `idle` —
while a command claude started is provably still running (pyrycode#1240). `background_task_started` is the
frame that separates that case from a genuine finish. Nothing reaching this client makes the distinction
today: the transport drops the frame as an unmodeled type.

**The lane is the mobile v2 stream over Noise + relay — not ACP.** The daemon fans all three
background-task frames to `interactive`-capable clients on the v2 lane (pyrycode#1394, shipped
2026-08-08); this app advertises `interactive` (#179), so the frame reaches us today. An earlier framing
of this work assumed delivery over `pyry acp`; that surface was retired (pyrycode#1348) and
`internal/acpbridge` no longer exists in the daemon tree. Nothing here rides it.

This slice is the **decode half only**: recognise the frame, fail-closed decode it, and emit a typed
`backgroundTaskStarted` `DaemonEvent` that ships **dormant**. The store that assembles the three frames
into "what is running right now" is **#567**; the panel that reads it is **#568**.

### Wire facts — mirror the daemon field-for-field, do not drift (CLAUDE.md / ADR 0002)

SSOT: pyrycode `docs/protocol-mobile.md` §`background_task_started`, `internal/protocol/interactive.go:177`
(`BackgroundTaskStartedPayload`), `internal/protocol/codes.go:257`
(`TypeBackgroundTaskStarted = "background_task_started"`), fixture
`internal/protocol/testdata/background_task_started.json`. Verified against the daemon tree 2026-08-18.

- **Type string:** `background_task_started`.
- **Payload — six fields, Go declaration order:**

  | Wire field | Go type / tag | Notes |
  |---|---|---|
  | `conversation_id` | `string` | Conversation whose turn spawned the task. |
  | `task_id` | `string` | claude's opaque handle; the join key every later `background_task_updated` and roster row carries. |
  | `tool_call_id` | `string` | **The wire name is `tool_call_id`, not `tool_use_id`** — see the trap below. |
  | `description` | `string` | The task's label. For `task_type: local_bash` this is the **literal command line**. |
  | `task_type` | `string` | claude's kind for the task. **Open string**, not a closed set. |
  | `truncated_fields` | `[]string`, tag `json:"truncated_fields"` — **no `omitempty`** | Names of the fields the daemon cut to fit their caps. A literal `null` means nothing was cut. |

- **Canonical fixture** (use it verbatim as the happy-path seed — it is deliberately adversarial):

  ```json
  {"conversation_id":"c1","task_id":"task_01ABC","tool_call_id":"toolu_01XYZ",
   "description":"grep -rn 'a<b&c' . > /tmp/out.txt &","task_type":"local_bash",
   "truncated_fields":["description"]}
  ```

- **No `turn_id`; opens and closes no turn.** A background task's lifecycle is orthogonal to its turn's,
  which is the whole #1240 point. The daemon doc is explicit: *"A client should render it as its own thread
  of activity, not as part of the turn it appeared in."*
- **Every string is bounded by the daemon at construction**, so an oversized value never reaches this wire;
  `truncated_fields` is how a client knows which of them lost characters. It is **load-bearing, not
  decoration** — a client that ignores it presents claude's cut text as complete.
- Binary → client only, `interactive`-gated, carries an envelope-level `event_id`.

### Three traps that are not in the `e08f33d` template

1. **`conversation_id` is KEPT, not dropped.** This is the one place the `api_retry` clone must diverge,
   and getting it wrong costs a rework of a closed slice. See § Design 4.
2. **The wire field is `tool_call_id`.** The daemon's own prose reads *"claude's `tool_use_id`, under the
   name `tool_use` and `tool_result` already use for it"*, which invites the misreading that the field is
   named `tool_use_id` — this repo's `ToolUsePayload:463` / `ToolResultPayload` both use `tool_use_id`, so
   the wrong name will look locally consistent. **The Go tag is `json:"tool_call_id"`**
   (`interactive.go:180`) and `truncated_fields` reports it under that name. Mirror the wire: the interface
   field is `tool_call_id`, the emitted field is `toolCallId`. The *value* is the same identifier
   `tool_use` / `tool_result` carry — that is what the prose means, and it is why #567 can join all three
   with no vocabulary lookup.
3. **`truncated_fields` has no single precedent** — it is required-present with a nullable array value,
   and neither existing helper fits. See § Design 2.

## Design source

N/A — pure transport / decode slice; the event ships **dormant** with zero rendered surface (AC5 pins that
no timeline item is created). The Figma file is the *mobile* design (`g2HIq2UyPhslEoHRokQmHG`) and contains
**no background-task panel** — the surface is desktop-only, so it has no counterpart there by construction;
that gap belongs to #568, not here. The visual-fidelity check is intentionally skipped for this ticket.

## Files to read first

Codegraph is **not initialized** in this repo (`mcp__codegraph__codegraph_context` returns *"CodeGraph not
initialized for this project"*, confirmed 2026-08-18) — this list was built from direct Read/grep against
`main` at `b8a1366`. Line numbers are from that commit; re-grep if they drift.

**Read `docs/specs/architecture/492-api-retry-signal-transport.md` end-to-end first.** Every edit below has
an `api_retry` (#492, commit `e08f33d`) counterpart; read the counterpart site before writing its twin.

| Path (with lines) | What to extract |
|---|---|
| `docs/specs/architecture/492-api-retry-signal-transport.md` | The end-to-end template for this slice, including the scope-note reasoning and the security-review shape. |
| `src/shared/wire/types.ts:40-90` | `EnvelopeType` string union — `'api_retry'` (:63) / `'compacting'` (:64) / `'queue_state'` (:72) are the neighbours; add `'background_task_started'`. |
| `src/shared/wire/types.ts:330-353` | `ApiRetryPayload` + doc-comment — the interface + comment template (this one has six fields, five of them strings). |
| `src/shared/wire/types.ts:455-467` | `ToolUsePayload` — confirms the codebase's existing `tool_use_id` spelling. **Do not copy the name**; see trap 2. |
| `src/shared/wire/types.ts:490-522` | `QueuedItem` / `QueueStatePayload` — the array-bearing payload precedent and its doc-comment posture. |
| `src/main/transport/inboundMessage.ts:237-284` | `isRecord` (:237), `requireString` (:242), `requireNumber` (:253), `requireBoolean` (:264), **`requireStringOrNull` (:278)**. The five strings map 1:1 onto `requireString`. `requireStringOrNull`'s docstring is the semantic template for the new nullable-array helper — read its "a literal `null` is a VALID value, NOT an absence" paragraph. |
| `src/main/transport/inboundMessage.ts:463-476` | `parseStallPayload` — the minimal fail-closed `parse*` shape. |
| `src/main/transport/inboundMessage.ts:477-503` | `parseApiRetryPayload` — the direct template to scale from four fields to six. |
| `src/main/transport/inboundMessage.ts:654-692` | `parseQueuedItem` (:664) + `parseQueueStatePayload` (:682) — the **only** array narrowing in the file. Take its *posture* (`Array.isArray` guard, one bad element throws the whole payload closed, an empty `[]` is valid, fresh array via `.map`), **not** its shape: it maps through a record narrower because its elements are records. This frame's elements are bare strings. |
| `src/main/transport/inboundMessage.ts:100-125` | The `stall` / `api-retry` doc-comment paragraphs on the `InboundDaemonMessage` union — the comment-discipline template. |
| `src/main/transport/inboundMessage.ts:197-232` | `InboundDaemonMessage` union — `{ kind: 'api-retry'; apiRetry: ApiRetryPayload }` (:207) is the new arm's neighbour; `{ kind: 'queue-state'; queueState: QueueStatePayload }` (:222). |
| `src/main/transport/inboundMessage.ts:925-935` | Frame-level `MAX_PLAINTEXT_BYTES` oversize guard (:930) — already covers the oversized case; mirror, do **not** add a per-field length check. |
| `src/main/transport/inboundMessage.ts:1049-1090` | `case 'stall'` (:1049), `case 'api_retry'` (:1063), `case 'compacting'` (:1077) — the narrow-before-log block to clone. |
| `src/main/diagnosticLog.ts:39-48` | `DiagnosticEvent` — `code?: string` (:43) is an open field, so `code: 'background_task_started'` needs **no** type widening. Confirms the content-free field set (`event`, `code`, `bytes`, `hash`). |
| `src/shared/ipc/events.ts:150-172` | The `apiRetry` (:162) and `compacting` (:172) arms + their doc-comment discipline. Contrast: those two carry **no string field**; this arm carries five. |
| `src/shared/ipc/events.ts:258-267` | The `queueState` arm — **the load-bearing precedent for KEEPING `conversationId`**, and the "untrusted, render as plain text NEVER HTML" inherited-constraint comment shape. |
| `src/shared/ipc/events.ts:274-281` | The `conversationCreated` arm — the second inherited-DOM-constraint comment template. |
| `src/main/daemonConnection.ts:647-700` | `case 'stall'` (:647), `case 'api-retry'` (:655), `case 'compacting'` (:671) emits. **This inner switch has NO `assertNever`** (:652 says so explicitly) — a missing or wrong emit compiles silently; the round-trip test is the only guard. |
| `src/main/daemonConnection.ts:769-782` | `case 'queue-state'` — the **KEEP-`conversation_id`** emit, whose comment states the rule verbatim. Clone this emit's posture, not `api-retry`'s. |
| `src/renderer/src/store/daemonEventBridge.ts:118-166` | Per-arm explicit `case X: /* why */ return null` cluster ending in `assertNever` (:166) — add one arm in that style (`apiRetry` :138, `compacting` :144 are the nearest). |
| `src/renderer/src/store/modalBridge.ts:85-118` | No-op fall-through cluster (`apiRetry` :95, `compacting` :96) + `assertNever` (:118) — join the cluster and name the arm in the trailing comment. |
| `src/renderer/src/store/timelineBridge.ts:86-188` | **`apiRetry` (:92) and `compacting` (:104) are now OWNED arms** (#493 / #496 wired them) — do **not** copy either. The new arm joins the **no-op fall-through cluster at :133-181**, whose comment explicitly records `queueState` as "daemon STATE, not a turn-stream item (#720)" — that is this arm's rationale too. `assertNever` at :187. |
| `src/main/transport/inboundMessage.test.ts:164-166, 217-224` | `encodeApiRetry` helper + the `API_RETRY` fixture — clone as `encodeBackgroundTaskStarted` + `BACKGROUND_TASK_STARTED`. |
| `src/main/transport/inboundMessage.test.ts:1527-1615` | `api_retry` recognition (:1527) + fail-closed (:1563) describes — the clone targets, including the non-object cases at :1610. |
| `src/main/transport/inboundMessage.test.ts:2557-2595` | Content-free diagnostic test (:2557) **and** the "does NOT log on a malformed throw path" test (:2581) — both must be cloned. |
| `src/main/daemonConnection.test.ts:286-289` | `apiRetryPlaintext(payload)` helper — clone as `backgroundTaskStartedPlaintext(payload)`. |
| `src/main/daemonConnection.test.ts:1574-1700` | The `api_retry stream` round-trip describe: `drivers[0].emit({ type: 'message', plaintext })` against a `connected()` fixture, asserting the exact emitted-event array plus the malformed-drop case. **This is the harness — there is no `fakeDaemon` here.** |
| `src/renderer/src/store/daemonEventBridge.test.ts:270-278` | Per-arm `.toBeNull()` blocks (`apiRetry`, `compacting`) — clone one. |
| `src/renderer/src/store/modalBridge.test.ts:150-178` | The inverse-filter `others` array (each entry commented with "ships dormant; its consumer is #N") — append the new arm. |
| `src/renderer/src/store/timelineBridge.test.ts:230-300` | The inverse-filter `others` array; the `queueState` entry (:280-285) with its "daemon state, not a turn-stream item (#720)" comment is the exact model. |
| `src/renderer/src/store/timelineBridge.test.ts:474-485` | The referential-no-op pattern (`expect(store.getState()).toBe(before)` + `expect(selectItems(...)).toHaveLength(0)`) — **this is AC5's store-level pin.** |
| `src/renderer/src/store/timelineBridge.test.ts:500-524` | `fakeBridge()` + `createTimelineStore()` + `subscribeTimeline` harness used by those store-level tests. |
| `src/shared/wire/types.test.ts:130-175` | The compile-only `EnvelopeType` admission blocks (`api_retry` :135, `compacting` :167). Note: vitest strips types, so these blocks are **compile-only RED** — `npm run typecheck` is what fails, not `npm test`. |
| `CLAUDE.md` (§ Wire protocol, § Don't) | The no-drift rule that forbids narrowing `task_type` or the `truncated_fields` elements. |

## Scope note — why this ships as one `s` despite touching 7 production files

The commit-time **≥5-production-file** self-check trips here (7 `.ts` files modified, 0 created). This is
the documented **DaemonEvent-arm / bridges-atomic** shape where that gate is *structurally unsatisfiable*,
not a hidden-blowup false negative. The argument is a compile-atomicity proof, not a judgement call:

- A new `DaemonEvent` arm in `events.ts` **compile-forces** a case in all three exhaustive bridges via
  their `assertNever` guard (`daemonEventBridge.ts:166`, `modalBridge.ts:118`, `timelineBridge.ts:187`).
  Omitting any one fails `npm run build` — the QA gate. The three bridges are atomic with the arm.
- The transport decode (`types.ts`, `inboundMessage.ts`, `daemonConnection.ts`) exists *only* to feed that
  arm; a decode-without-arm child is dead code — a decoder whose `kind` is silently dropped, with no emit
  to test.
- Every attempted split therefore produces either a dead-code sub-leaf **or** an arm-bearing child still at
  ≥5 files. No genuine seam exists. Per-frame cost does not amortize either, which is exactly why the three
  background-task frames are three tickets (#564 → #565 → #566) rather than one.

**Measured precedent, not assertion:** `git show --stat e08f33d` (#492, the identical shape) is **121
production lines across 7 production files**; it shipped as one `s`, developer-complete with zero
deviations, and code-review passed with **zero findings**. #315 (`stall`), #495 (`compacting`), #214
(`turn_state`) and #241 (`create_conversation`) adjudicated the same conflict the same way.

Every § 1 red line is clear:

| Red line | This ticket | Verdict |
|---|---|---|
| > 3 **new** files | **0 new files** — every edit is additive to an existing module | clear |
| > ~600 total LOC (prod + tests + helpers + log calls + spec edits) | ~160 production (`e08f33d`'s 121 scaled for two extra wire fields, one nullable-array narrower, and one new helper) + ~400 test ≈ **~560** | clear, with modest headroom |
| > 5 new exported types | **1** — `BackgroundTaskStartedPayload` | clear |
| > 10 consumer call sites | **4** — 1 emit + 3 compile-forced bridges. Zero external fan-out: the event ships dormant | clear |
| > 5 acceptance criteria | **exactly 5** | at the line, not over |
| > 10 reject branches | **8** — non-object payload, 5 × `requireString`, non-array-non-null `truncated_fields`, non-string element | clear |

**File-overlap check (§ 1.5):** run 2026-08-18 after `git fetch origin --prune` against all 11
`origin/feature/*` branches for the 13 files this slice touches. **No overlap.** Siblings #565 / #566 /
#567 have no branches yet — whichever lands second will rebase onto the first, which is the normal path for
this repo's sequential frame slices.

## Design

Seven touch-points, mirroring `api_retry` (#492) end-to-end. **No new files.**

### 1. Wire type — `src/shared/wire/types.ts`

- Add `'background_task_started'` to the `EnvelopeType` union. Place it after `'queue_state'` (:72), with a
  short comment marking it as the first of the three `interactive`-gated background-task frames (#565 /
  #566 add the other two beside it).
- Add the payload interface — a contract sketch, doc-comment it in the `ApiRetryPayload` (:330) style:

  ```ts
  export interface BackgroundTaskStartedPayload {
    conversation_id: string
    task_id: string
    tool_call_id: string
    description: string
    task_type: string
    truncated_fields: string[] | null
  }
  ```

  Field order mirrors `interactive.go:177`. The doc-comment must record, at minimum: that it announces work
  **outliving the turn that spawned it** (pyrycode#1240); that it carries **no `turn_id`** and opens/closes
  no turn, so it is not a turn-stream item; that `tool_call_id` is the wire name (trap 2 above) and carries
  the same identifier `tool_use` / `tool_result` do, so #567 joins all three with no lookup; that
  `task_type` is an **open string** and `truncated_fields` an **open list of wire field names** — neither
  may be narrowed to a client-side union (see § 2); that `truncated_fields: null` means "nothing was cut"
  and is a distinct value from `[]`; and the **SECURITY** note that `description` is, for
  `task_type: local_bash`, the literal command line claude ran — untrusted, model-influenced text that is
  safe to render as inert text and must never be executed, re-shelled, or fed to an HTML sink, an
  attribute, or a URL.

### 2. Inbound decode — `src/main/transport/inboundMessage.ts`

**2a. New field narrower — `requireStringArrayOrNull`.** Add it to the existing `require*` cluster,
directly after `requireStringOrNull` (:278):

```ts
function requireStringArrayOrNull(payload: Record<string, unknown>, field: string): string[] | null
```

Behaviour: a literal `null` returns `null`; an array returns a **fresh copy** whose every element passed a
bare `typeof === 'string'` check; **anything else throws** `WireDecodeError` naming the field only.

The three properties that make this the right shape, each traceable to the wire contract:

- **Required-present, nullable value.** `TruncatedFields []string` has **no `omitempty`**, so the daemon
  always writes the key and emits a literal `null` when nothing was cut. `payload[field]` is `undefined`
  for an omitted key, which is neither `null` nor an array → it throws. That is AC2's "a frame *omitting*
  the key entirely fails closed rather than being read as `null`", and it comes out of the shape rather
  than needing a separate check. This is exactly `requireStringOrNull`'s semantic (:272-284) widened from a
  scalar to an array — read that docstring before writing this one.
- **Bare element check, not a record narrower.** Every array narrowing in this file today
  (`parseQueueStatePayload` :682, `parseMessageChunkPayload`, the modal-options list) maps elements through
  a **record** narrower, because their elements are records. There is no array-of-scalars narrowing
  anywhere. Take `parseQueuedItem`'s *posture* — one bad element throws the whole payload closed, an empty
  array is valid, the result is a fresh array — but **not** its shape. Do not invent a `parseTruncatedField`.
- **No closed-set validation.** `truncated_fields` names this frame's own wire fields today (`task_id`,
  `tool_call_id`, `description`, `task_type`), and a client-side closed set would fail-close a valid future
  frame. Same no-cross-validate posture `parseQueuedItem` documents for its deliberate lack of a range
  check, and the drift risk CLAUDE.md / ADR 0002 rank above cosmetic robustness. **Do not add one.**

*Why a shared helper rather than inlining it in the parse function.* The `require*` cluster is the house
home for **field** narrowers; the `parse*` cluster is for whole payloads. Keeping it there leaves
`parseBackgroundTaskStartedPayload` a flat six-line list of field narrowings, identical in shape to every
sibling. The reuse is observed, not speculative: **#565** (`background_task_updated`) and **#566**
(`background_task_roster`, on its row type) both carry `truncated_fields` with the identical contract, and
both are filed.

**2b. Payload narrower.** Add next to `parseApiRetryPayload` (:489):

```ts
function parseBackgroundTaskStartedPayload(payload: unknown): BackgroundTaskStartedPayload
```

Behaviour: `isRecord` guard (throws `WireDecodeError('malformed background_task_started payload')` on a
non-object), then `requireString` for `conversation_id` / `task_id` / `tool_call_id` / `description` /
`task_type`, then `requireStringArrayOrNull` for `truncated_fields`. Returns a **fresh six-field literal**
— unknown server-added keys tolerated (forward-compat) but never copied through, which also makes it
prototype-pollution-safe. Messages name the failure **category only**; never interpolate a value
(`description` is a command line, `task_id` / `conversation_id` are correlating identifiers).

**No per-field length check.** Every string here is bounded by the daemon at construction, and the
frame-level `MAX_PLAINTEXT_BYTES` guard (:930) already fails an oversized frame closed before this arm
runs — the same reliance `api_retry` / `tool_use` / `queue_state` have. Mirror, do not add.

**2c. Inbound arm.** Import `BackgroundTaskStartedPayload`; add to `InboundDaemonMessage`:

```ts
| { kind: 'background-task-started'; backgroundTaskStarted: BackgroundTaskStartedPayload }
```

Hyphenated `kind`, matching `api-retry` / `queue-state`. Extend the union's doc-comment block in the
`api-retry` paragraph's style (:110-118): what the frame is, what the consumer carries onward (**all six
fields, dropping nothing** — see § 4), and that the fail-closed defence is five required strings plus one
required-present nullable array.

**2d. Type-switch arm.** Add `case 'background_task_started':` to `parseInboundMessage`, cloning the
`api_retry` block at :1063: **narrow before logging** (so a malformed frame throws before any record is
written), then
`diagnosticLog?.event({ event: 'inbound-decoded', code: 'background_task_started', bytes: plaintext.length, hash: hashPlaintext(plaintext) })`,
then `return { kind: 'background-task-started', backgroundTaskStarted }`.

**Log nothing but the existing content-free field set.** No decoded field may be added to the record — not
`task_type` (which looks harmless), and least of all `description`, which is a shell command line. Adding
one would also require widening `DiagnosticEvent` and would disturb #131's renderer pin. `code?: string`
(`diagnosticLog.ts:43`) is already open, so `code: 'background_task_started'` needs no type change.

### 3. Typed event — `src/shared/ipc/events.ts`

Add the arm to `DaemonEvent`, after `compacting` (:172):

```ts
| {
    type: 'backgroundTaskStarted'
    conversationId: string
    taskId: string
    toolCallId: string
    description: string
    taskType: string
    truncatedFields: readonly string[] | null
  }
```

snake→camel on every field (the `toolUse` / `toolResult` / `queueState` named-scalar convention);
`readonly` on the array mirrors `queueState`'s `readonly QueuedItem[]` (:267).

Doc-comment it in the `queueState` (:258) style, recording: that it carries **`conversationId`** and why
(§ 4); that `description` and `task_type` are **UNTRUSTED, model-influenced daemon-relayed text** the
eventual render slice (#568) must render as **plain text, NEVER HTML** (no `innerHTML` /
`dangerouslySetInnerHTML`, no attribute or URL sink, never executed or re-shelled) — this slice has no DOM
sink, but the constraint is inherited here, exactly as `queueState` and `conversationCreated` inherit
theirs; that `truncatedFields: null` means "nothing was cut" and must not be collapsed into `[]`; that no
token, key, or raw frame can ride it (five bounded opaque strings and a list of field names is the whole
payload); and that it ships **dormant** — all three exhaustive bridges no-op it until #567 — the
`apiRetry`-was-a-no-op-until-#493 precedent.

### 4. Emit — `src/main/daemonConnection.ts`

Add `case 'background-task-started':` to the `switch (inbound.kind)` dispatch, near `api-retry` (:655):

```ts
emitDaemonEvent(sink, {
  type: 'backgroundTaskStarted',
  conversationId: inbound.backgroundTaskStarted.conversation_id,
  taskId: inbound.backgroundTaskStarted.task_id,
  toolCallId: inbound.backgroundTaskStarted.tool_call_id,
  description: inbound.backgroundTaskStarted.description,
  taskType: inbound.backgroundTaskStarted.task_type,
  truncatedFields: inbound.backgroundTaskStarted.truncated_fields
})
```

**A fresh named-field literal, never a spread** of `inbound.backgroundTaskStarted` (the `api-retry` /
`session-transition` idiom). This is the anti-smuggling net: a decoder that later grows a field cannot ride
across IPC without an explicit edit here. `truncatedFields` passes the already-narrowed array **by
reference** — `requireStringArrayOrNull` returned a fresh, fully-validated `string[]`, so there is nothing
left to strip (the `queued` precedent at :780).

#### `conversation_id` is KEPT — do NOT clone `api_retry`'s drop

This is the single most expensive thing to get wrong in this slice. The codebase has **no blanket
"drop `conversation_id`" rule**; it has a decided split, and both sides are documented in `events.ts`:

- **Dropped** for **turn-stream items** scoped to the single active conversation — `turnState`, `toolUse`,
  `toolResult`, `apiRetry`, `stall`, `compacting`.
- **Kept** for **daemon state** that is replacement-truth and whose store keys by it — `queueState`
  (#292/#293), whose emit at `daemonConnection.ts:769-782` says verbatim: *"unlike turnState / toolUse this
  KEEPS conversation_id, because the snapshot is REPLACEMENT-truth."*

The test is **"turn-stream item, or daemon state?"** — not "does the frame have the field". The
background-task family is the second bucket on every axis: it carries **no `turn_id`**, opens and closes no
turn, and the daemon doc says a client should render it *"as its own thread of activity, not as part of the
turn it appeared in"* — the same characterization `queue_state` got in #720.

Decisive downstream fact: **#567's Technical Notes state** *"Frames carry `conversation_id` and the daemon
fans them out to every interactive connection, so attribution is by id — the same model `queue_state`
already uses in this app."* An event that dropped `conversationId` here would make #567 unbuildable without
reopening this closed slice.

**Not compile-forced.** This inner switch has no `assertNever` default (:652 states it), so a missing or
wrong emit compiles silently and drops the decoded kind. The round-trip tests (§ Testing strategy) are the
**only** guard on this leg and are not optional.

### 5-7. Exhaustive bridge no-ops (compile-forced)

Each of `daemonEventBridge.ts`, `modalBridge.ts`, `timelineBridge.ts` switches exhaustively over
`DaemonEvent` with an `assertNever` default; the new arm is a compile error in all three until each gets a
case. Add `case 'backgroundTaskStarted': return null` in each file's existing house style:

- **`daemonEventBridge.ts`** — a per-arm explicit block with a one-line "why" comment (clone the `apiRetry`
  block at :138, retargeted: the background-task store **#567**, not yet built, holds the task set; the
  session store holds no background-task state at all).
- **`modalBridge.ts`** — join the fall-through cluster (:85-118) beside `apiRetry` / `compacting`, and name
  the arm in the trailing comment: it ships dormant, its consumer is #567, and a background task is
  emphatically not a modal — nothing is waiting on an answer.
- **`timelineBridge.ts`** — join the **no-op fall-through cluster at :133-181** and name the arm in the
  trailing comment. **Do not copy `case 'apiRetry'` (:92) or `case 'compacting'` (:104)** — both are
  *owned* arms since #493 / #496 and return a `ThreadEvent`. The correct model in that file is
  **`queueState` (:154)**, whose comment records the exact rationale that applies here: daemon STATE, not a
  turn-stream item, deliberately not folded into `reduceTimeline`. Here the wire says so outright — no
  `turn_id`, opens and closes no turn, *"its own thread of activity, not part of the turn"*. Whether the
  background-task panel ever becomes a timeline surface is **#568's** call, not this decode slice's.

No behaviour anywhere; the first consumer is #567.

### Non-goals, named so they are not re-litigated

- **`event_id` needs no work.** `codec.ts:136` already decodes the envelope-level `event_id` generically
  into the optional `Envelope.event_id`, and this app advertises no `last_event_id` in `hello`, so there is
  no replay path to plumb. Do not touch it.
- **No generic "background-task frame" abstraction.** #565 and #566 need the same seam for the other two
  frames. Building a shared abstraction now, with one instance in hand, is speculative generality. The seam
  is already clone-friendly (a per-frame narrower + a per-frame `DaemonEvent` arm — exactly how `stall`,
  `api_retry`, `compacting` and `queue_state` coexist). The only thing this slice deliberately factors out
  is `requireStringArrayOrNull`, and only because it is a *field* narrower with two filed consumers.
- **No client-side state.** No dedup, no task map, no correlation memory. Assembling the three frames into
  a task set is **#567**.

## State + concurrency model

None introduced. This is a pure decode + emit leg: no store slice, no async task, no subscription, no
timer, no accumulated state. The event flows through the existing
`parseInboundMessage → daemonConnection dispatch → emitDaemonEvent → IPC → bridges` path already built for
`api_retry` / `queue_state`.

Statelessness is load-bearing here, not incidental: the daemon doc records that a **roster can arrive
before the `background_task_started` for a task it lists** (claude's ordering, not the daemon's). Any
ordering assumption, buffering, or correlation memory added at this layer would be wrong — #567 joins on
`task_id` precisely because order is not guaranteed. N frames produce N events, in arrival order, with no
work.

## Error handling

| Layer | Failure | Result |
|---|---|---|
| `parseBackgroundTaskStartedPayload` | payload not an object (string, array, `null`) | throws `WireDecodeError('malformed background_task_started payload')` — fail-closed, no partial value |
| `parseBackgroundTaskStartedPayload` | any of the five strings absent / non-string | throws via `requireString` — `missing required field: <name>`, no value interpolated |
| `requireStringArrayOrNull` | `truncated_fields` **key omitted** (`undefined`) | throws — the AC2 fail-closed case, falls out of the shape |
| `requireStringArrayOrNull` | `truncated_fields` a string / number / object | throws |
| `requireStringArrayOrNull` | array containing a non-string element | throws — one bad element fails the **whole payload** closed (`parseQueueStatePayload` posture) |
| `requireStringArrayOrNull` | literal `null` | returns `null` — a **value**, preserved as "nothing was cut" |
| `requireStringArrayOrNull` | `[]` | returns `[]` — valid, and distinct from `null` |
| `parseInboundMessage` `case 'background_task_started'` | any of the above | the narrower throws **before** the diagnostic-log call → no record is written for a malformed frame |
| `parseInboundMessage` | oversized frame | caught upstream by the frame-level `MAX_PLAINTEXT_BYTES` guard (:930) before this arm runs |
| `daemonConnection` dispatch | `WireDecodeError` from decode | swallowed by the connection's existing catch → the malformed frame is dropped without emitting or throwing |
| UI surface | — | none this slice; the event ships dormant. Rendering and any error surfacing belong to #567 / #568 |

## Testing strategy

Test-first (CLAUDE.md): a failing test per criterion, implementation after. `npm test` (vitest) plus
`npm run typecheck` for the compile-guard arms — note the `types.test.ts` block is **compile-only RED**
(vitest strips types, so `npm test` will not fail on it; `npm run typecheck` / `npm run build` will).

Scenarios below; the developer writes the bodies in the project's idiom. **Do not pre-write test code from
this spec.**

### `src/shared/wire/types.test.ts`

- A compile-only block admitting `'background_task_started'` as an `EnvelopeType` (clone :167).

### `src/main/transport/inboundMessage.test.ts`

New `describe` blocks mirroring the `api_retry` pair at :1527 / :1563, with an
`encodeBackgroundTaskStarted(payload)` helper cloned from `encodeApiRetry` (:165) and a
`BACKGROUND_TASK_STARTED` fixture seeded with **the daemon's canonical fixture verbatim** (§ Context) —
including the `description` value `grep -rn 'a<b&c' . > /tmp/out.txt &`, which is adversarial by design
(HTML metacharacters, quotes, a shell redirect, a trailing `&`).

- **Recognition (AC1):** a valid envelope decodes to
  `{ kind: 'background-task-started', backgroundTaskStarted: BACKGROUND_TASK_STARTED }`. Every one of the
  six fields must carry a **distinct non-empty value** in the fixture, so a field swap or a dropped field
  fails the assertion — that is AC1's explicit requirement, and the canonical fixture already satisfies it.
- **`truncated_fields: null` (AC2):** decodes to `truncated_fields === null` — asserted with
  `toBeNull()`, **not** `toEqual([])` and not a truthiness check. Pin that `null !== []`.
- **`truncated_fields: []` (AC2):** decodes to an empty array, distinct from `null`.
- **`truncated_fields` multi-element:** e.g. `['description', 'task_type']` round-trips in order.
- **`truncated_fields` key omitted (AC2, the fail-closed half):** a payload with the other five fields and
  **no `truncated_fields` key at all** throws `WireDecodeError`. This is the test that distinguishes a
  required-nullable parse from an optional one — without it, an optional-field implementation passes
  everything else.
- **Fail-closed, one case per field (AC3):** each of `conversation_id` / `task_id` / `tool_call_id` /
  `description` / `task_type` absent, and non-string (a number) — each throws `WireDecodeError`.
- **Fail-closed on `truncated_fields` (AC3):** a string, a number, an object, and an **array containing a
  non-string element** (`['description', 7]`) — each throws. The last one pins "one bad element fails the
  whole payload closed".
- **Fail-closed on a non-object payload (AC3):** a string and an array (clone :1610).
- **Unknown keys tolerated but not copied (AC4):** a payload carrying a spurious extra key (e.g. `turn_id`,
  which this frame must never have) decodes to exactly the six known fields.
- **Empty-string values are valid:** e.g. `task_type: ''` decodes — the checks are on the TYPE, never
  truthiness (the `requireBoolean` / `requireNumber` house posture).
- **Regression:** a well-formed envelope of a *different* unmodeled type still returns `null` — the new
  case must not widen what decodes (clone :1544-ish in the `api_retry` block).

**Content-free diagnostics** (clone the pair at :2557 / :2581):

- Success path logs exactly one record with `event: 'inbound-decoded'`, `code: 'background_task_started'`,
  a `bytes` length and a `hash` — and **none of the six decoded fields**. Seed `description` with a
  recognisable sentinel (a fake command line) and `conversation_id` with the file's `SECRET_CONV` sentinel,
  then assert both are absent from the serialized record. No new `DiagnosticEvent` field.
- Malformed path (e.g. `truncated_fields: 'nope'`) **logs nothing** — assert the log sink was not called,
  then assert the throw. This is the narrow-before-log guarantee.

### `src/main/daemonConnection.test.ts`

A new `describe` plus a `backgroundTaskStartedPlaintext(payload)` helper cloned from `apiRetryPlaintext`
(:287), driven through the round-trip harness at :1584
(`drivers[0].emit({ type: 'message', plaintext })` against a `connected()` fixture). **This leg is not
compile-forced — these tests are the only guard on the emit:**

- **Round-trip (AC1):** a valid frame emits **exactly one**
  `{ type: 'backgroundTaskStarted', conversationId, taskId, toolCallId, description, taskType, truncatedFields }`
  with all six values distinct and non-empty, asserted as a whole-object `toEqual`. A whole-object
  assertion is what makes a swapped or dropped field fail.
- **`conversationId` is KEPT:** assert `events[0].conversationId` equals the frame's `conversation_id`.
  This is the inverse of `api_retry`'s `not.toContain('conv-1')` assertion — **do not clone that
  assertion**; cloning it is the exact failure mode this spec's § 4 exists to prevent, and it would pass
  against a wrong implementation.
- **`tool_call_id` → `toolCallId`:** seed `tool_call_id` and `task_id` with **visibly different** values
  and assert each lands on its own emitted field — this catches the trap-2 misnaming, which would otherwise
  only surface at #567.
- **`truncatedFields: null` round-trips as `null`**, and a populated list round-trips element-for-element
  in order.
- **Fail-closed drop:** a malformed frame (omitted `truncated_fields`) emits nothing and does not throw —
  the connection swallows `WireDecodeError`.
- **Anti-smuggling (AC4):** feed a frame whose payload carries an extra key (via `as unknown as`) and
  assert the emitted event has exactly the six modeled properties — proving the fresh-literal emit, not a
  spread.
- **No dedup / no state:** two `background_task_started` frames with different `task_id`s emit two events
  in arrival order; a verbatim repeat also emits. Pins that the transport holds no correlation memory.

### Bridge no-op coverage (AC5)

- `daemonEventBridge.test.ts`: a `.toBeNull()` block for the new arm, cloned from :270.
- `modalBridge.test.ts` (:150-178) and `timelineBridge.test.ts` (:230-300): append the new arm to each
  `others` array, with the house one-line "ships dormant; its consumer is #567" comment.
- **The store-level pin (AC5's "no chat timeline item is created"):** using the
  `fakeBridge()` + `createTimelineStore()` + `subscribeTimeline` harness (:500-524), emit a
  `backgroundTaskStarted` event and assert **both** halves of the referential-no-op pattern at :474-485 —
  `expect(store.getState()).toBe(before)` (the reducer returned the same state object) **and**
  `expect(selectItems(store.getState())).toHaveLength(0)`. The second assertion alone is vacuous against a
  store that was already empty; the pair is what actually pins it.

## Open questions

- **None blocking.** The wire shape is fully specified by pyrycode#1394 / `protocol-mobile.md`
  §`background_task_started` / `interactive.go:177`, all three verified against the daemon tree
  2026-08-18, and the slice structure mirrors #492 exactly.
- **Forward-compat posture (not a question, a recorded decision):** if the daemon later adds a field to
  `BackgroundTaskStartedPayload`, this decoder tolerates-but-drops it until the slice is widened. That is
  the correct no-drift posture for a wire type (CLAUDE.md § Wire protocol).
- **Carry-forward for #567 / #568, not this slice's work:** (a) `description` and `task_type` are untrusted,
  model-influenced text and, for `local_bash`, a literal command line — inert text rendering only, never an
  HTML/attribute/URL sink, never executed or re-shelled; (b) `truncatedFields` must survive into the held
  set, since a reader that ignores it presents claude's cut text as complete; (c) ordering is claude's, not
  the daemon's — a roster may arrive before the `started` for a task it lists, so #567 must join on
  `task_id` rather than assume an order; (d) there is **no terminal event** in this family by design, so
  "finished" is a client conclusion drawn from absence in a later roster, never something the wire reports.

## Security review

**Verdict:** PASS

This slice receives an untrusted daemon `background_task_started` frame (hostile-daemon threat), fail-closed
decodes it, and emits an event carrying **five strings and a list of strings** across the main→renderer IPC
boundary. That is a material widening versus its template #492, whose `apiRetry` carried one boolean and
two numbers and therefore let **no attacker-influenced text** cross at all. One of the strings is, by the
daemon's own documentation, **the literal shell command line claude ran**. The categories below are walked
against that widening specifically, not against #492's stronger posture.

**Findings:**

1. **[Trust boundaries]** No finding. One explicit boundary: `parseInboundMessage`'s
   `case 'background_task_started'` → `parseBackgroundTaskStartedPayload`, a single named fail-closed
   narrower — not scattered parsing. It returns a fresh six-field literal, never a spread of the incoming
   `payload`, so a hostile `__proto__` / `constructor` key cannot pollute (prototype-pollution-safe by
   construction, mirroring the vetted `parseApiRetryPayload`). `requireStringArrayOrNull` likewise returns a
   fresh array rather than the wire array, so array-borne extra properties cannot ride along. The emit is a
   fresh named-field literal, so exactly six validated values cross IPC and a later-added decoder field
   cannot smuggle itself across. Downstream holds a discriminated-union arm, so the type system signals what
   is held. The event flows main→renderer only; no new renderer→main channel is added.

2. **[Tokens, secrets, credentials]** N/A — no token, secret, credential, or key is generated, stored, read,
   rotated, or compared. `conversation_id`, `task_id` and `tool_call_id` are routing / correlation
   identifiers, not secrets. Thrown `WireDecodeError` messages name the failure **category and field name**
   only, never interpolating a value — which matters more here than in #492, because a value interpolation
   would put a command line into an error string.

3. **[File / storage operations]** N/A — no filesystem, disk, cache, or web-storage operation. Nothing is
   persisted, so path-traversal, TOCTOU, atomic-write and encryption-at-rest questions do not arise.
   Explicitly noted because `description` for `local_bash` frequently *contains* paths (the canonical
   fixture ends `> /tmp/out.txt &`): no decoded value is concatenated into a path, opened, or written
   anywhere in this slice, and #567 holds it in memory only.

4. **[Inter-process / Electron attack surface]** No finding. No new `BrowserWindow`, `webPreferences`,
   `contextBridge` API, `ipcMain.handle`, or `ipcMain.on` channel — the event rides the existing
   `emitDaemonEvent` → IPC path. All six values are validated **before** they cross (typed at the narrower,
   re-copied by name at the emit): main validates, then hands the renderer an already-narrowed value.
   `string` and `string[]` are structured-clone-safe, so there is no deserialization surface on the renderer
   side. Process placement is preserved per CLAUDE.md — decode, socket, and Noise stay in main; the renderer
   receives only the typed event.

5. **[Cryptographic primitives]** N/A — no RNG, key, nonce, Noise, or compare-against-a-secret work. The
   slice reuses exactly one vetted primitive, the content-free `hashPlaintext` diagnostic helper (#130),
   unchanged.

6. **[Injection / untrusted text — the real finding, and how it is discharged]** `description` is, for
   `task_type: local_bash`, the **literal command line claude ran**; `task_type` is an open,
   model-influenced string. The daemon bounds both but does not sanitize them. The canonical daemon fixture
   is itself adversarial: `grep -rn 'a<b&c' . > /tmp/out.txt &` carries `<`, `&`, quotes, a redirect and a
   trailing backgrounding `&`.

   **Classification: no exploitable sink exists in this slice, and the constraint is carried forward
   explicitly rather than assumed.** This slice has **zero** DOM sinks, zero shell invocations, zero URL
   construction, and zero attribute assignment — it decodes to a typed value and emits it. React escapes
   text children, so the eventual `#568` render is inert *by default*; the dangerous shapes are
   `dangerouslySetInnerHTML`, an attribute/`href`/`src` sink, and — uniquely here — any temptation to make
   the command line actionable ("re-run this command"). None of those exists yet, and none may be
   introduced without a security-sensitive ticket of its own.

   The discharge is threefold, all mandated above rather than left to reviewer memory: (a) the
   `BackgroundTaskStartedPayload` doc-comment (§ Design 1) carries the daemon's SECURITY paragraph verbatim
   in substance — inert text only, never executed, re-shelled, or fed to an HTML sink, an attribute, or a
   URL; (b) the `DaemonEvent` arm doc-comment (§ Design 3) repeats the inherited constraint in the
   `queueState` / `conversationCreated` idiom, so it is visible at the type the renderer actually imports;
   (c) the constraint is restated as a named carry-forward to #567 and #568 under § Open questions. This
   mirrors the pattern already used for `text` (#292), `name` / `cwd` (#139/#241) and `input_summary` /
   `result_summary` (#217/#229) — the difference is only in degree of hazard, and the doc-comments say so.

   **Rejected mitigation — sanitizing or narrowing at the decoder.** Stripping metacharacters from
   `description` would corrupt the value's only purpose (it is a command line; `&` and `>` are semantically
   load-bearing) and would present claude's altered text as claude's text. Narrowing `task_type` to a
   closed union, or `truncated_fields` to the four known field names, would fail-close valid future frames
   — the drift risk CLAUDE.md and ADR 0002 rank above cosmetic robustness, and the daemon doc states
   outright that *"one observation does not earn"* an enum. Both are the wrong layer: the defence belongs
   at the sink, and the sink does not exist yet.

7. **[Error messages, logs, telemetry]** No finding, and this is the category the widening most affects.
   The diagnostic reuses the existing content-free field set (`event` / `code: 'background_task_started'` /
   `bytes` / `hash`) with **no new `DiagnosticEvent` field**, so #131's renderer pin is untouched, and **no
   decoded field is logged** — not `task_type`, which looks harmless, and least of all `description`, which
   would write a shell command line into the diagnostic log. § Design 2d forbids adding one explicitly, and
   a dedicated test asserts the sentinel `description` and `conversation_id` are absent from the record.
   The arm narrows **before** logging, so a malformed frame throws first and leaves no record (its own
   test). Thrown `WireDecodeError` messages carry the failure category and field *name* only — never a
   value — so a crash reporter or telemetry sink capturing the error object leaks no command text. Nothing
   is piped to the renderer console.

8. **[Concurrency]** No finding, and the design is deliberately stateless. No async task, timer,
   subscription, listener, or shared mutable state is introduced; decode + emit is synchronous within the
   existing inbound dispatch, so there is no check-then-act race across an `await`, nothing to cancel on
   teardown, and no shutdown-safety question. Security-relevant inversion worth naming: the wire's
   ordering contract (a roster may precede the `started` for a task it lists) means the risk here is a
   developer *adding* buffering or correlation state to "fix" ordering — which would both violate the
   contract and introduce the only mutable, attacker-influenceable-keyed state in the leg. The spec forbids
   it (§ Non-goals, § State model) and a round-trip test pins the stateless behaviour.

9. **[Threat model alignment]** Addressed. **Hostile daemon response** is the applicable threat: malformed,
   mistyped, or truncated fields → `WireDecodeError` → swallowed by the connection → frame dropped, no
   emit, no crash; an omitted `truncated_fields` key fails closed rather than being read as `null`;
   oversized frames are capped upstream by `MAX_PLAINTEXT_BYTES` (:930) before the narrower runs; hostile
   *content* in `description` is handled per finding 6. **Malicious / compromised relay:** content-blind
   and unable to forge frames inside the Noise session; it can flood, but each frame decodes to a
   fixed-shape emit with **no accumulated state** (no growing list, no timer, no map keyed by
   attacker-controlled `task_id` — that map is #567's, and #567 owns its own bounding), so a flood costs
   CPU proportional to frames delivered and nothing more. Rate/framing posture is inherited from the relay
   connection, not introduced here. **Renderer compromise reaching the transport:** unchanged — this slice
   adds no renderer→main capability. **Token theft from disk:** N/A, nothing persisted. **OUT OF SCOPE and
   named:** all rendering, formatting, and any client-side state derived from this event belong to #567
   (store) and #568 (panel); the sibling `background_task_updated` / `background_task_roster` frames belong
   to #565 / #566.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-18
