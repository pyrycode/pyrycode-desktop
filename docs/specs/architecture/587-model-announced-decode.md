# #587 — Transport: decode claude's announced model into a typed daemon event

**Size:** S · **Labels:** `enhancement`, `size:s`, `security-sensitive`
**Shape reference:** `e08f33d` (#492, `api_retry`) and `93f464e` (#495, `compacting`) — the same
wire-type → decode → IPC-arm → dormant-bridges slice, one variant over.

## Design source

N/A — transport only, no user-visible surface, per the ticket's `## Figma` section. The sheet that
eventually displays this value carries the Figma reference; the visual-fidelity check is
intentionally skipped on this ticket.

## Files to read first

Codegraph is not initialized for this repo (`codegraph_status` → *"CodeGraph not initialized"*), so
this list is hand-built from the sibling slices rather than lifted from `codegraph_context`.

**The single best preparation is `git show e08f33d`** — the whole #492 slice in one screen, 442
insertions across the same 13 files this ticket touches. Read it before anything below.

| Path | What to extract |
|---|---|
| `src/shared/wire/types.ts:40-107` | `EnvelopeType` union. The new member goes after `'background_task_roster'` (`:84`), before `'dequeue_message'` — keeps the inbound-status cluster together. |
| `src/shared/wire/types.ts:364-385` | `CompactingPayload` + its docstring. The **closest structural sibling**: `conversation_id` + one scalar. Clone the docstring's shape (what it is / what it is not / the consumer hazard / a `See #N` line). |
| `src/shared/wire/types.ts:594-624` | `UnrecognizedMessagePayload` + docstring. The **closest semantic sibling**: this is where `truncated: boolean` and the "most untrusted string on this wire" posture are already written down. |
| `src/main/transport/inboundMessage.ts:283-316` | `isRecord` / `requireString` / `requireNumber` / `requireBoolean`. All three needed helpers exist. **Add no new helper.** |
| `src/main/transport/inboundMessage.ts:771-811` | `parseUnrecognizedMessagePayload` — the model to clone, minus `site` and `message_type`. Note it takes `truncated` through `requireBoolean` and applies **no length check** to the bounded string. |
| `src/main/transport/inboundMessage.ts:169-181` | The `unrecognized-message` kind-doc paragraph in the file-header block. A matching paragraph is owed for the new kind. |
| `src/main/transport/inboundMessage.ts:245-260` | `InboundDaemonMessage` union — arm placement (the status cluster runs `stall` → `api-retry` → `compacting` → background-task ×3 → `unrecognized-message`). |
| `src/main/transport/inboundMessage.ts:1388-1400` | The `unrecognized_message` case in `parseInboundMessage` — narrow-before-log ordering, and the exact `diagnosticLog?.event({ event, code, bytes, hash })` field set. |
| `src/main/transport/inboundMessage.ts:1611-1621` | The `default:` arm. An **unknown** envelope type logs `inbound-unmodeled` and returns `null`; a **malformed known** payload throws `WireDecodeError`. Two different fail-closed paths — AC4 is about the second. |
| `src/main/daemonConnection.ts:647-682` | The `stall` / `api-retry` / `compacting` emit arms — the copy-by-name idiom, the `conversation_id`-is-DROPPED convention, and the "not compile-forced, the round-trip test guards this emit" note. |
| `src/main/daemonConnection.ts:774-792` | The `unrecognized-message` emit arm — the same idiom carrying a `truncated` bool across IPC. |
| `src/shared/ipc/events.ts:86-121` | `snapshotReceived` and `runConfigReceived`, both carrying `model: string` meaning the **per-session override**. This is the collision the new arm's comment must name. |
| `src/shared/ipc/events.ts:119-131` (`stallDetected` → `apiRetry`) | The dormant-arm comment style, including the explicit "Ships dormant … until #N" sentence. |
| `src/shared/ipc/events.ts:286-311` | The `unrecognizedMessage` arm — the house wording for an untrusted, model-influenced string crossing IPC, and for a load-bearing `truncated`. |
| `src/renderer/src/store/daemonEventBridge.ts:138-168` | Dormant no-op arms, one `case` + comment + `return null` each. |
| `src/renderer/src/store/modalBridge.ts:70-121` | The fall-through `case` cluster + the shared trailing comment. New `case` **joins** the cluster; the comment gains a sentence. |
| `src/renderer/src/store/timelineBridge.ts:133-195` | Same shape. **Do not touch** `stallDetected` (`:86`), `apiRetry` (`:92`) or `compacting` (`:104`) — those are owned arms since #317 / #493 / #496. |
| `src/shared/wire/types.test.ts:178-192` | The `CompactingPayload` type-shape test block. Compile-only RED (vitest strips types), so the runtime assertion is a `toEqual` on a literal. |
| `src/main/transport/inboundMessage.test.ts:169-171, 240, 1690-1760, 3253-3280` | Envelope-plaintext helper, canonical fixture, recognition + fail-closed describes, and the content-free-logging assertions. |
| `src/main/daemonConnection.test.ts:286-293, 1721-1810` | The `compactingPlaintext` helper and the full round-trip describe (`drivers[0].emit` harness — there is no `fakeDaemon` on this path). |
| `src/renderer/src/store/{daemonEventBridge,modalBridge,timelineBridge}.test.ts` | grep `compacting` in each; the new assertions are one-line clones. |
| `CLAUDE.md` §"Wire protocol", `docs/knowledge/decisions/0002` | The no-drift rule that forbids inventing a client-side bound or charset check. |

**Upstream SSOT (read-only, outside this worktree — the authority per the ticket's Technical Notes):**

- `/Users/juhanailmoniemi/Workspace/Projects/pyrycode/internal/protocol/interactive.go:399-466` —
  `ModelAnnouncedPayload` and its full doc comment. **This is the contract.**
- `.../internal/protocol/codes.go:325-372` — `TypeModelAnnounced = "model_announced"`, and why the
  frame is binary → phone only.
- `.../internal/protocol/testdata/model_announced.json` and `model_announced_zero.json` — the
  daemon's own golden fixtures. Note the zero fixture: `{"conversation_id":"","model":"","truncated":false}`
  round-trips on the daemon side, so all three fields are **always present, never `omitempty`**.

## Context

claude names the model it resolved for a turn on its `system` / `init` line. Until pyrycode#1616
(shape) and #1638 (producer) that value stopped at the daemon boundary. The desktop now receives it
and drops it on the floor: `parseInboundMessage` has no `model_announced` case, so the frame falls
into the `default:` arm, logs `inbound-unmodeled`, and returns `null`.

This ticket makes the frame typed and puts it on the IPC channel. Nothing renders it — #588 is the
first consumer.

The value answers a question the spawn argument cannot: the daemon knows what it *requested*, only
claude knows what it *got*. Measured against claude 2.1.220, requesting `haiku` yields
`claude-haiku-4-5-20251001`, requesting `claude-haiku-4-5` yields `claude-haiku-4-5` unchanged (an
identifier in no published list), and requesting nothing yields `claude-sonnet-5`.

### Two non-negotiables carried from the wire

1. **The identifier is held verbatim.** No normalising, no lowercasing, no allow-list, no
   regex-a-family-out-of-it, no length check. The published list mixes dated
   (`claude-haiku-4-5-20251001`) and undated (`claude-opus-5`) shapes, so any pattern that works
   today breaks on the first identifier without a family word. A lookup miss is **ordinary**, not an
   error. Resolution to a display name is #588's concern and is an exact lookup, never inference.
2. **`truncated` crosses with the value, as a required field.** It is the daemon's report that it
   cut the identifier at `maxModelField = 256`
   (`pyrycode/internal/streamsup/parser.go:338`). A consumer that ignores it presents a cut
   identifier as a complete one — and that failure is sharper here than elsewhere, because a cut
   identifier will *always* miss #588's exact lookup and so will *always* render verbatim, looking
   exactly like a legitimate unrecognised model.

## Design

Seven production files, thirteen total. Each edit is additive; no existing behaviour changes.

### 1. `src/shared/wire/types.ts` — the wire type

Add `'model_announced'` to `EnvelopeType` immediately after `'background_task_roster'` (`:84`),
with a short comment in the house style. The comment must state that this is an **identity report**
(what claude says it is, for the turn it says it about) rather than a turn sub-state, turn-independent
work, a periodic reading, or a window condition — that is the daemon's own grouping rationale
(`codes.go:334-338`) and it is what stops a future reader filing it with `stall` / `api_retry`.

Add the payload interface after `CompactingPayload` (`:385`):

```ts
export interface ModelAnnouncedPayload {
  conversation_id: string
  model: string
  truncated: boolean
}
```

Field names and order are the daemon's, snake_case, and must not drift (CLAUDE.md; ADR 0002).

The docstring must carry, at minimum:

- Field-for-field mirror of `pyrycode/internal/protocol/interactive.go:462`, all three fields
  always present (no `omitempty`) — cite the daemon's own zero-value fixture.
- Conversation-scoped, not turn-scoped: **no `turn_id`**, and receiving one neither opens nor closes
  a turn.
- `model` is claude's identifier **verbatim** and never empty; the not-reliably-dated /
  not-in-any-published-list fact, and that a lookup miss is therefore ordinary.
- `truncated` is a **bool**, not the background-task/rate-limit `truncated_fields: string[]`, because
  this payload bounds a *single* string — a name list would be permanently either `null` or
  `["model"]`.
- The bound is the **producer's** (`maxModelField`, 256). This struct re-decides no maximum; a second
  cap here would be a second place the limit is decided and the two could disagree silently.
- No charset check. `pyrycode/internal/relay`'s `validModel` bounds a *phone-supplied override* and
  is deliberately a different rule; applying it here would reject identifiers claude legitimately
  announces.
- **SECURITY:** claude-authored text that crossed the subprocess trust boundary. The daemon bounds it
  but does **not** sanitize it — no control-character or terminal-escape stripping happens anywhere
  on this path. Safe to render as inert text; never into an HTML sink, an attribute, or a URL. It is
  a **report, never a control input** — no security-relevant behaviour may branch on it.
- `See #587 (this decode) and #588 (the store).`

### 2. `src/main/transport/inboundMessage.ts` — the decode

Four edits:

**a.** Import `ModelAnnouncedPayload` from `../../shared/wire/types` (the `@shared` alias is not
available in `src/main` — relative path, matching every sibling import in this file).

**b.** Add a kind-doc paragraph to the file-header block, alongside the `unrecognized-message`
paragraph at `:169-181`. It should say: identity report rather than claude sub-state or daemon-mapping
gap; the fail-closed defence is two required strings plus one required boolean whose `false` is a
*value* not an absence; **no length check is duplicated** (the daemon caps at 256 and
`MAX_PLAINTEXT_BYTES` = 65519 backstops with ~250× headroom); the consumer carries `model` and
`truncated` onward and drops `conversation_id`; ships dormant, #588 is the first consumer.

**c.** Add the union arm, placed after `'compacting'` in the status cluster (`:250-251`):

```ts
| { kind: 'model-announced'; modelAnnounced: ModelAnnouncedPayload }
```

**d.** Add `parseModelAnnouncedPayload(payload: unknown): ModelAnnouncedPayload` next to
`parseUnrecognizedMessagePayload`. Behaviour: `isRecord` guard, then `requireString('conversation_id')`,
`requireString('model')`, `requireBoolean('truncated')`, returning a **fresh three-field literal**.
Its docstring must state:

- Fail-closed like its neighbours: any missing or mistyped field throws `WireDecodeError`, never a
  partial value.
- `model` gets **no length check, no charset check, no allow-list, no normalisation** — and *why*
  (the producer's cap plus the frame-level guard already cover it; a client-invented rule would drop
  valid future identifiers, the drift risk CLAUDE.md / ADR 0002 rank above cosmetic robustness).
- `requireString` admits `''`. The daemon **suppresses the event on an empty model at the producer**,
  so `''` will not arrive off a conforming daemon — and there is deliberately **no second suppression
  branch** here. Do not add a guard.
- `truncated` goes through `requireBoolean`, whose check is on the **type**: `false` passes, while an
  absent field, `0`, `'false'` or `null` all fail the payload closed. It is never optional and never
  defaults to "not cut".
- The fresh literal means unknown server-added keys are tolerated (forward-compat) but not copied
  through — which also makes it prototype-pollution-safe.
- Messages name the failure **category** only, never interpolating a value.

**e.** Add the `case 'model_announced':` to `parseInboundMessage`, placed to match the union order.
**Narrow before logging** (so a malformed frame throws first and leaves no record), then emit the
existing content-free diagnostic — `{ event: 'inbound-decoded', code: 'model_announced', bytes:
plaintext.length, hash: hashPlaintext(plaintext) }`. **No decoded field is logged**, so no new
`DiagnosticEvent` field is introduced and #131's renderer pin is untouched.

### 3. `src/shared/ipc/events.ts` — the IPC arm

Add after the `compacting` arm:

```ts
| { type: 'modelAnnounced'; model: string; truncated: boolean }
```

`conversation_id` is **dropped** — see §*The `conversation_id` decision* below.

The comment is the load-bearing part of this edit and must carry three things:

1. **The `model` name collision, named explicitly.** `snapshotReceived` (`:90`) and
   `runConfigReceived` (`:117`) both carry `model: string` meaning the per-session **override**,
   where `''` means "inherited default, no override". This one means what claude **announced** for
   the turn, and *in the ordinary case the two disagree* — the override is `''` while claude has
   named a concrete model. Both values are destined for the same run-configuration sheet, so the
   collision is live rather than theoretical. The wire field name is kept (no drift); the distinction
   is drawn here, the way the daemon's own payload doc draws it.
2. **`truncated` is load-bearing**, in the house wording already used on the `unrecognizedMessage`
   arm: *"a reader that ignores it presents claude's cut text as complete."* Sharpened for this arm:
   a cut identifier always misses #588's exact lookup, so it always renders verbatim and looks like a
   legitimate unrecognised model.
3. **SECURITY**, in the house wording used on `backgroundTaskStarted` / `unrecognizedMessage`:
   `model` is untrusted, model-influenced daemon-relayed text that the daemon bounds but does not
   sanitize. #588 and its render surface must treat it as **plain text only** — never `innerHTML` /
   `dangerouslySetInnerHTML`, never into an attribute or a URL — and must never branch
   security-relevant behaviour on it.

Close with the standard dormancy sentence: ships dormant, all three exhaustive bridges no-op it until
#588 — the `compacting`-was-a-no-op-until-#496 precedent.

### 4. `src/main/daemonConnection.ts` — the emit

Add `case 'model-announced':` to the inner switch, after `'compacting'` (`:681`). Emit a fresh
literal copied **by name**:

```ts
emitDaemonEvent(sink, {
  type: 'modelAnnounced',
  model: inbound.modelAnnounced.model,
  truncated: inbound.modelAnnounced.truncated
})
```

Never a spread of `inbound.modelAnnounced` (the `assistant-delta` idiom), so a decoder that later
grows a field cannot smuggle it across IPC.

**Deliberately stateless** — no dedup, no coalescing, no timer, no last-value memo. The announcement
fires once per turn and the same identifier repeats turn after turn; suppressing a repeat here would
be inventing wire semantics the daemon does not have, and would starve #588 of the re-announcement
that tells it the value is still current. N frames → N events, including a verbatim repeat.

Not compile-forced (this inner switch has no `assertNever`) — the round-trip test in
`daemonConnection.test.ts` is the sole guard on this emit. That makes the round-trip test mandatory,
not optional.

### 5–7. The three exhaustive bridges — dormant arms

`DaemonEvent` gains an arm, so all three `assertNever`-guarded translators become compile errors
until each accounts for it. This is the compile-forcing that makes AC5 free.

| File | Edit |
|---|---|
| `src/renderer/src/store/daemonEventBridge.ts` | New standalone `case 'modelAnnounced':` + comment + `return null`, alongside the block at `:138-168`. Comment: no session-store action — the announced-model store (#588, not yet built) holds it; the session store holds no model state at all. Cite the `compacting`-was-a-no-op-until-#496 precedent. |
| `src/renderer/src/store/modalBridge.ts` | New `case 'modelAnnounced':` **joins** the fall-through cluster (after `'backgroundTaskRoster'`, `:100`); add one sentence to the shared trailing comment — an identity report is not a modal; nothing is waiting on an answer. |
| `src/renderer/src/store/timelineBridge.ts` | New `case 'modelAnnounced':` **joins** the fall-through cluster (after `'backgroundTaskRoster'`, `:160`); add a sentence to the trailing comment. The reasoning to record: the frame carries no `turn_id` and opens/closes no turn, so it is daemon **state**, not a turn-stream item — the `queueState` rule (#720). Whether the announced model ever becomes a visible surface is #588's call, not this slice's. |

**Do not touch** the `stallDetected` (`timelineBridge.ts:86`), `apiRetry` (`:92`) or `compacting`
(`:104`) arms — those have been owned since #317 / #493 / #496. New dormant arms join the
`:133-160` fall-through cluster only.

Confirmed by grep: exactly three translators discriminate on `DaemonEvent` with an `assertNever`
default. `threadTimeline.ts:489` and `modalPrompts.ts:198` switch on `ThreadEvent` / `ModalEvent`, and
this ticket adds neither, so both stay untouched. Every other bridge
(`pushNotifyBridge`, `screenSnapshotBridge`, `sessionIdBridge`, `queueBridge`,
`backgroundTaskRosterBridge`, `relayLinkBridge`, `recentWorkspacesBridge`,
`conversationListBridge`, `conversationCreatedBridge`, `newFolderBridge`,
`runSettingsWriteBridge`) uses `default: null` by design and must **not** gain a case.

### The `conversation_id` decision

**Decode it, drop it at the emit.**

The ticket's own test — *"turn-stream item, or daemon state?"* — leaves this frame genuinely between
the two: it arrives once per turn but opens and closes no turn (the daemon pins it to `turnMarkNone`).
The consumer settles it. #588 holds a **single value replaced on each announcement**, so nothing
downstream keys by conversation. That is the exact ground `turnState` / `stallDetected` / `apiRetry` /
`compacting` / `unrecognizedMessage` all drop it on ("single active conversation"), and it fails the
condition under which `backgroundTaskStarted` keeps it (a store that attributes by id).

Dropping it also means **exactly one untrusted string crosses IPC on this arm**, not two.

Note the asymmetry the ticket draws, and honour it: dropping a field no consumer reads costs a later
ticket one line, whereas dropping `truncated` would make a downstream reader silently wrong. The
former is reversible, the latter is not.

`conversation_id` is still **decoded and required** — a frame missing it fails closed, matching every
sibling parser.

## State + concurrency model

None added. This slice is a pure function chain:

```
relay frame → decodeEnvelope → parseModelAnnouncedPayload → InboundDaemonMessage
           → daemonConnection inner switch → emitDaemonEvent → IPC → 3 bridges → null
```

No store, no timer, no subscription, no `AbortController`, no listener. Every stage is stateless and
synchronous; the existing supervisor owns the socket lifecycle and is untouched. There is no
teardown obligation because nothing is retained.

The one concurrency-adjacent decision is the **explicit refusal to hold state at the emit** (§4). A
last-value memo would be the only mutable state on this leg, fed by a hostile-daemon-controlled frame
stream, and it would buy nothing.

## Error handling

Two distinct fail-closed paths, and AC4 is about the second:

| Input | Path | Result |
|---|---|---|
| Unknown envelope type | `parseInboundMessage` `default:` (`:1611`) | logs `inbound-unmodeled`, returns `null` — unchanged |
| `model_announced` with a non-object payload | `isRecord` guard | throws `WireDecodeError('malformed model_announced payload')` |
| `model` absent / non-string (number, `null`, object, array) | `requireString` | throws `WireDecodeError('missing required field: model')` |
| `truncated` absent / non-boolean (`0`, `'true'`, `null`) | `requireBoolean` | throws `WireDecodeError('missing required field: truncated')` |
| `conversation_id` absent / non-string | `requireString` | throws `WireDecodeError('missing required field: conversation_id')` |
| `model: ''` | none — **admitted** | decodes and emits normally |
| Oversized frame | frame-level `MAX_PLAINTEXT_BYTES` (65519), pre-existing | rejected before this parser runs |

The throw is caught by `daemonConnection`'s existing decode guard — the frame is dropped, **no event
is emitted, and nothing throws into the event stream**. That guard already exists and is proven by
the `drops a malformed compacting without emitting or throwing` test at
`daemonConnection.test.ts:1795`; this slice inherits it rather than adding to it.

Error messages name the failure **category** only. They never interpolate `model` (untrusted,
model-influenced) or `conversation_id` (conversation-correlating).

**No user-facing surface.** Nothing reaches a banner, dialog, or screen — the event ships dormant.

## Testing strategy

Six test files, all `npm test` (vitest, node env). No renderer-DOM concerns: the three bridge tests
call the exported pure translators directly, so the server-render-only constraint does not apply.

Type-level coverage rides `npm run typecheck` — and the three `assertNever` guards mean a missing
bridge arm is a **compile** failure, not a test failure.

### `src/shared/wire/types.test.ts` — shape pin

- Add `ModelAnnouncedPayload` to the type import list (`:13-38`).
- One block asserting the three-field shape with a `toEqual` on a literal. **Compile-only RED**
  (vitest strips types), so the runtime assertion is deliberately shallow — its value is that the
  file stops compiling if the interface drifts.
- One block admitting `truncated: false` as a wire **value**, not an absence — mirroring the
  `CompactingPayload` falling-edge block at `:186`.

### `src/main/transport/inboundMessage.test.ts` — the AC3 round-trip

Add a `modelAnnouncedPlaintext(payload: unknown)` helper next to the `compacting` one (`:169`), and a
canonical fixture next to `COMPACTING` (`:240`).

**AC3's assertion discipline: assert on what the decoder *returned*, one conspicuous sentinel per
field — never on a test-built object.** A fixture reused as both input and expectation would pass a
decoder that re-cased or substituted the value. Concretely, `expect(result).toEqual({ kind:
'model-announced', modelAnnounced: FIXTURE })` is exactly the vacuous form to avoid; spell the
expected literal out.

Recognition scenarios:

- A well-formed frame narrows to `{ kind: 'model-announced', modelAnnounced: { … } }` with all three
  fields spelled out in the expectation.
- **The verbatim sentinel.** Feed a mixed-case, punctuation-bearing identifier that no normaliser
  would leave alone — e.g. `Claude-Opus-5_TEST.20260819` — and assert the returned `model` is that
  exact string. This is the test that fails a decoder which lowercases, trims, or family-matches.
- **The unrecognised identifier decodes like any other** (AC1): an identifier in no published list —
  e.g. `claude-haiku-4-5` undated, or an outright invented one — narrows identically. No allow-list
  branch exists to exercise, and the point of the test is that none appears later.
- `truncated: true` and `truncated: false` each round-trip to the returned value.
- `model: ''` decodes successfully (the producer suppresses it, but the decoder must not).
- A payload carrying an extra server-added key (e.g. `turn_id`) decodes to exactly the three known
  fields — the extra key is tolerated but not copied through.

Fail-closed scenarios (AC4) — each asserts a `WireDecodeError` throw:

- Payload is not an object (a string, an array, `null`).
- `model` absent; `model` a number; `model` `null`; `model` an object.
- `truncated` absent; `truncated` the string `'true'`; `truncated` the number `0`; `truncated` `null`.
  **The `0` and `'true'` cases are the ones that matter** — they are what a default-to-`false`
  implementation would silently swallow.
- `conversation_id` absent / non-string.

Logging scenarios, cloned from `:3253-3280`:

- A decoded frame logs `code: 'model_announced'` content-free — assert the record carries **no**
  `conversation_id`, no `model`, and no `truncated`.
- A malformed frame logs **nothing** (narrow-before-log ordering).

### `src/main/daemonConnection.test.ts` — the emit round-trip

This is the only guard on the emit (the inner switch has no `assertNever`), so it is mandatory. Add a
`modelAnnouncedPlaintext` helper next to `compactingPlaintext` (`:291`) and a describe cloned from
`:1721-1810`. Harness is `drivers[0].emit` — there is no `fakeDaemon` on this path.

- A well-formed frame produces **exactly one** `{ type: 'modelAnnounced', model, truncated }` event.
- The emitted object has **exactly two keys** — `conversation_id` did not ride along. Assert this
  positively (a strict `toEqual` on the whole event), not by absence of a substring.
- The identifier arrives at the sink byte-for-byte: use the same conspicuous sentinel as the decoder
  test, so a re-casing introduced at the emit is caught here too.
- `truncated: true` reaches the sink as `true`.
- Two identical frames produce **two** events — no dedup, no coalescing.
- A malformed frame (e.g. `truncated: 'true'`) emits nothing and does not throw.

### The three bridge tests

One-line clones of the existing `compacting` assertions:

- `daemonEventBridge.test.ts` (`:275`) — `translateDaemonEvent({ type: 'modelAnnounced', … })` is
  `null`, for both `truncated` values.
- `modalBridge.test.ts` (`:166`) — the new event joins the null-cluster array.
- `timelineBridge.test.ts` — `translateTimelineEvent(…)` is `null`. **Note the polarity flip**: the
  neighbouring `compacting` assertions at `:150` and `:195` assert a non-null translation because
  #496 owns that arm. Copy the *null* idiom from a genuinely dormant arm (e.g. `backgroundTaskRoster`),
  not from `compacting`.

Together these three are AC5: nothing reaches a store or a screen.

## Scope check

| Red line | Count | Verdict |
|---|---|---|
| New files | 0 | pass |
| Total written lines | ~450–550 projected | pass (< 600) |
| New exported types | 1 (`ModelAnnouncedPayload`) | pass (≤ 5) |
| Consumer call sites | 3 compile-forced bridge arms | pass (≤ 10) |
| Acceptance criteria | 5 | pass |
| Reject branches | 4 (`isRecord` + 3 required fields) | pass (< 10) |
| **Production source files** | **7** | **see below** |

The §4 self-check trips at ≥ 5 production files. This is the **documented irreducible-S false
positive** for this exact slice shape, held on measured evidence rather than on a re-count:

| Slice | Files (prod) | Insertions | Outcome |
|---|---|---|---|
| #492 `api_retry` (`e08f33d`) | 13 (7) | 442 | one developer run, CR-PASS zero findings |
| #495 `compacting` | 12 (7) | 540 | one developer run |
| #564 / #565 / #566 background-task family | 13–19 (7) | 400–1000 | one run each |

This ticket's payload is **strictly simpler** than #492's (two carried scalars vs three, no numbers,
no nested array) and simpler than #566's by an order of magnitude.

The atomicity is real, not asserted: the `DaemonEvent` arm is a compile error in three bridges the
moment it lands; the arm is meaningless without the emit; the emit needs the decode; the decode needs
the wire type. A split would either ship a non-compiling intermediate or leave a declared-but-dead
payload in `types.ts` — and the repo has never taken that second option for an inbound slice.
Splitting here would create the "too many tiny tickets" cost the red lines exist to trade *against*,
not the "burned turn budget" cost they exist to prevent.

## Open questions

1. **Does `model_announced` need adding to any capability gate on the desktop side?** The frame is
   `interactive`-gated on the daemon and binary → phone only. The desktop's `hello` already requests
   `interactive` (that is how `stall` / `api_retry` / `compacting` arrive), so the expectation is
   **no change**. The developer should confirm no allow-list of inbound types exists beyond
   `EnvelopeType` itself before assuming it — one grep of `hello` capability wiring.
2. **Docstring length.** `types.ts` docstrings on this repo run long by convention. The daemon's own
   comment is the source; summarise rather than transcribe, and cross-reference
   `pyrycode/internal/protocol/interactive.go` for the full rationale.

Neither blocks implementation.

## Security review

**Verdict:** PASS

**Findings:**

- **[1. Trust boundaries]** No findings. The boundary is explicit and single: `parseModelAnnouncedPayload`
  in `src/main/transport/inboundMessage.ts` is the only place the opaque payload becomes a typed
  value, matching every sibling parser. Downstream holds `ModelAnnouncedPayload`, a named type whose
  docstring states the data is untrusted. The second boundary — main → renderer over IPC — carries a
  fresh two-field literal built by name, so the renderer cannot receive a field the emit did not
  explicitly list. **The trust label is carried by comment and convention, not by the type system**
  (there is no branded `Untrusted<string>` on this repo); that is the existing house posture for
  `unrecognizedMessage.raw` and `backgroundTaskStarted.description`, both strictly more dangerous
  strings, and introducing a branding scheme on this ticket would be an unrequested cross-cutting
  change. Recorded as an accepted, pre-existing design property rather than a finding.
- **[2. Tokens, secrets, credentials]** N/A by construction. This slice introduces no token, key, or
  credential, reads none, and stores nothing. The one deliberate decision that touches this category
  is the **drop of `conversation_id` at the emit**, which reduces what crosses IPC to a single
  untrusted string plus a bool — strictly less than the sibling arms carry.
- **[3. File / storage operations]** N/A by construction. No filesystem path is constructed, read, or
  written anywhere in this slice, and nothing is persisted. The specific hazard worth naming because
  it is *plausible* rather than present: `model` is a claude-authored string and a future consumer
  might be tempted to use it as a cache-key filename or a config-lookup path. Nothing on this ticket
  does, and the IPC comment's "report, never a control input" line is the standing instruction against
  it. Flagged for #588's review, not a finding here.
- **[4. Inter-process / Electron attack surface]** No findings. No `webPreferences`, no new
  `contextBridge` API, no new `ipcMain` channel, no protocol handler, no navigation surface. The event
  rides the **existing** `onDaemonEvent` channel, whose shape is the `DaemonEvent` union. Process
  placement is correct and unchanged: decode, socket, and Noise stay in `src/main`; the renderer sees
  only an already-typed, already-validated two-field object and imports nothing from `src/main`.
- **[5. Cryptographic primitives]** N/A by construction. No randomness, no hashing decision, no key
  material, no comparison against a secret. The one hash on the path — `hashPlaintext` in the
  diagnostic log — is pre-existing, unchanged, and applied to the frame bytes for a content-free
  footprint, not for a security decision.
- **[6. Network & I/O]** No findings, and one point worth stating precisely rather than waving at:
  memory-exhaustion resistance is **inherited and sufficient**. The frame-level
  `MAX_PLAINTEXT_BYTES` (65519) guard in `parseInboundMessage` runs before this parser and bounds the
  whole payload; the daemon separately caps `model` at 256 at construction. The spec's instruction to
  add **no** length check is therefore not a gap: a third bound would be a defence against a failure
  that cannot reach the line, and — the load-bearing reason — a client-invented bound would silently
  drop *valid* future identifiers, which is the drift risk CLAUDE.md and ADR 0002 rank above cosmetic
  robustness. Socket, TLS, timeout, and reconnect discipline are untouched.
- **[7. Error messages, logs, telemetry]** No findings. Decode errors name the failure **category**
  only (`missing required field: model`) and never interpolate `model` or `conversation_id`. The
  diagnostic log reuses the existing content-free field set — `event` / `code` / `bytes` / `hash` — so
  no decoded value is logged and **no new `DiagnosticEvent` field is added**, leaving #131's renderer
  pin untouched. Narrow-before-log ordering means a malformed frame leaves no record at all, and the
  spec pins both properties with tests. Nothing is written to a log file on disk by this slice.
- **[8. Concurrency]** No findings, and the relevant decision is a refusal rather than an addition:
  the emit holds **no state** — no dedup, no coalescing, no timer, no last-value memo. A last-value
  memo would be the only mutable state on this leg, fed by a frame stream a hostile daemon controls;
  it would also silently swallow a legitimate re-announcement. Every stage is stateless and
  synchronous, so there is no async ownership, no cancellation obligation, no check-then-act race, and
  no listener to leak. Shutdown safety is unchanged because nothing is retained across a teardown.
- **[9. Threat model alignment]** Walked against the four desktop-specific threats:
  - *Hostile daemon response* — **the live threat for this slice, and the one the design answers.**
    A daemon that is malicious or compromised controls `model` entirely: contents, length within the
    frame cap, and encoding. The answers are (a) fail-closed narrowing with no optional fields and no
    defaulting, so a crafted payload cannot produce a partial or fabricated value; (b) a fresh literal
    so no extra key rides through; (c) the standing "report, never a control input" constraint, so no
    security-relevant behaviour may branch on it. **Explicitly accepted and carried forward:** the
    daemon does not strip control characters or terminal escape sequences, so the value may contain
    them, and this slice deliberately does not strip them either (stripping would corrupt a legitimate
    identifier and put a second normalising rule on the wire). The render boundary owes the
    sanitization; that obligation is written into the IPC arm's comment, which is what #588 reads.
  - *Malicious / compromised relay* — unchanged. The relay is content-blind and cannot forge a frame
    inside the Noise session; drop / delay / reorder / flood are survivable here because the slice is
    stateless, so a flood produces N events and retains nothing.
  - *Renderer compromise reaching the transport* — unchanged. Nothing in this slice widens the
    renderer's reach; the new arm is inbound-only and read-only.
  - *Token theft from disk* — N/A; nothing is persisted.
  - **Out of scope, named:** rendering `model` safely (plain text only, never an HTML sink, an
    attribute, or a URL) belongs to **#588** and its render surface. This slice owes carrying the value
    unchanged, and discharges that obligation by writing the constraint into the IPC arm's comment
    where #588's author will read it.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-20
