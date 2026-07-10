# Spec #254 — Decode the `session_transition` marker into a typed `sessionTransition` daemon event

**Size:** S · **security-sensitive** · Transport decode arm of the interactive Run-configuration
write path (parent #183). Split from #183; the renderer-side holder that retains the current
`session_id` for the per-session settings gate is the peeled sibling **#259 (blocked by this)** —
**not built here**. **No holder, no store, no write, no render.**

This is a **near-exact structural clone of #214** (`turn_state` → `turnState`) and **#180**
(`screen_snapshot` → `snapshotReceived`): one new inbound decode case plus one new sealed `DaemonEvent`
arm, wired through the three exhaustive renderer bridges as **no-ops**. Two things differ from #214, both
already-shipped idioms in the same files:

1. The payload is **five fields** (not two), with a **closed `reason` enum** (the `parseTurnStatePayload`
   `state`-check idiom) and a **nullable `workspace_cwd`** (the `requireStringOrNull` idiom from
   `ConversationSummary.name` / `ConversationCreatedPayload.name`).
2. The emit is a **content-minimisation seam like #180's snapshot**: the decoder validates all five fields
   fail-closed, but the `DaemonEvent` arm carries **only `newSessionId`** — the sole field the #259 holder
   retains. The other four are decoded-then-dropped at the emit, exactly as `snapshot` drops `text` / `ts` /
   `conversation_id`. Unlike #214 (whose `timelineBridge` **owned** its arm), **all three bridges no-op**
   this arm — its consumer is #259, not yet built (the `snapshotReceived`-was-a-no-op-until-#187 precedent).

## Design source

N/A — transport decode + IPC types + three renderer bridge no-op cases; no UI surface, no DOM sink, no
component. (Same posture as #214 / #180 / #241. The interactive controls that consume the retained
`session_id`, with Figma 20:111 / 20:130 / 20:143, are the render slice **#257** — not this ticket.)

## Files to read first

Read these before writing a line. The whole design is "clone the `turn_state` chain (#214) for a
five-field marker, use the `screen_snapshot` (#180) emit-side content-drop for the four fields the renderer
doesn't need, and no-op the arm in all three bridges."

- `docs/specs/architecture/214-decode-turn-state-phase.md` — **read end-to-end first.** The exact precedent
  chain (wire type → decode → `InboundDaemonMessage` kind → emit → `DaemonEvent` arm → renderer bridges)
  and its security-review structure map onto this spec almost verbatim. #254 differs only in the two ways
  named above.
- `docs/specs/architecture/180-fetch-screen-snapshot-settings.md` — the **content-minimisation-at-emit**
  precedent: `screen_snapshot` decodes 8 fields, the emit carries 5, `text`/`ts`/`conversation_id` are
  dropped. This spec's emit is the same seam (decode 5, carry 1).
- `src/shared/wire/types.ts:40-67` — `EnvelopeType` union (add `'session_transition'`; `turn_state` is at
  :54).
- `src/shared/wire/types.ts:187-206` — `WireTurnState` + `TurnStatePayload`: the **closed-wire-enum +
  payload-interface** template to mirror for `WireSessionTransitionReason` + `SessionTransitionPayload`
  (doc-comment style: name the daemon source, note "no `omitempty`", note `reason` is a plain wire string
  like `MessagePayload.role`).
- `src/shared/wire/types.ts:354-374` — `ConversationSummary` (`name: string | null` at :366): the
  **nullable-string wire field** precedent `workspace_cwd` mirrors.
- `src/shared/wire/types.ts:403-420` — `ConversationCreatedPayload`: a **five-field, mixed-type, own-shape**
  payload (`requireStringOrNull` for `name`) — the closest multi-field template.
- `src/main/transport/inboundMessage.ts:137-180` — `requireString` (:138) and **`requireStringOrNull`
  (:174)**: the two field narrowers this decoder reuses. `requireStringOrNull` accepts a literal `null` as a
  valid value, rejects absent/`undefined`/non-string.
- `src/main/transport/inboundMessage.ts:304-323` — **`parseTurnStatePayload` — THE key reference.** Its
  `state` closed-enum check (`if (state !== 'thinking' && … ) throw`) is the exact idiom the `reason` check
  clones: covers non-string and unknown-string alike, narrows without a cast, category-only error message,
  never interpolates the value.
- `src/main/transport/inboundMessage.ts:417-427` — `parseConversationCreatedPayload`: the five-field
  parse-function shape (`isRecord` guard → per-field narrowers incl. `requireStringOrNull` → return only
  known fields, extra keys tolerated).
- `src/main/transport/inboundMessage.ts:113-128` — `InboundDaemonMessage` union (add one kind;
  `turn-state` is at :122).
- `src/main/transport/inboundMessage.ts:605-617` — the `case 'turn_state'` switch arm: narrow **before**
  the content-free `inbound-decoded` log. The exact template for `case 'session_transition'`.
- `src/main/daemonConnection.ts:296-352` — the inner `switch (inbound.kind)`; the `case 'snapshot'`
  (:312, **the content-drop model**) and `case 'turn-state'` (:347, the fresh-literal-emit model). Add one
  `case 'session-transition'`.
- `src/shared/ipc/events.ts:60-128` — `DaemonEvent` union; the `snapshotReceived` (:70-77, dedicated
  minimal shape) and `turnState` (:87) arms. Add one arm (Design § 4). The import block at :14-24 already
  pulls `WireTurnState` etc. from `../wire/types` — the new arm needs **no new import** (it carries a bare
  `string`).
- `src/renderer/src/store/daemonEventBridge.ts:27-81` — `translateDaemonEvent`; the no-op fall-through
  block (`turnState` at :60, `snapshotReceived` at :53). Add `case 'sessionTransition': return null`.
- `src/renderer/src/store/timelineBridge.ts:35-87` — `translateTimelineEvent`; the no-op fall-through
  block at :68-85. Add `sessionTransition` there (it is **not** an owned/timeline arm — unlike `turnState`).
- `src/renderer/src/store/modalBridge.ts:41-79` — `translateModalEvent`; the no-op fall-through block at
  :55-75 (`turnState` at :67). Add `sessionTransition` there.
- `src/renderer/src/store/conversationListBridge.ts:24-33` — `translateConversationsEvent` uses
  `default: null`, **no `assertNever`** → it needs **no case**. Confirms the "three bridges" scope; do not
  touch this file.
- Test siblings to mirror: `src/main/transport/inboundMessage.test.ts` (turn_state / conversation_created
  recognition + fail-closed cases), `src/main/daemonConnection.test.ts` (emit mapping + content-drop
  assertions), `src/renderer/src/store/{daemonEventBridge,timelineBridge,modalBridge}.test.ts` (arm → null).
- SSOT (already validated — do **not** re-fetch; inlined in Wire contract below): QMD
  `pyrycode-docs/specs/architecture/656-session-transition-wire-type.md` +
  `pyrycode-docs/knowledge/codebase/656.md` (`SessionTransitionPayload`, the five fields, the closed
  `reason` set, the `workspace_cwd` non-null-iff-`workspace_change` invariant).

## Context

The daemon emits `session_transition` (pyrycode/pyrycode#656, on `main`) when a conversation's daemon
session rotates — a `/clear`, an idle eviction, or a workspace change. It is an **outbound binary→phone,
v2-only, interactive-capability-gated** marker carrying `new_session_id`, the addressing key a client needs
to change per-session settings (model / effort / YOLO). Desktop advertises the `interactive` capability
(#179) but **decodes none of the markers it unlocks** — a `session_transition` envelope currently falls
through `parseInboundMessage`'s `default → inbound-unmodeled → null`.

This slice adds the missing wire → decode → emit → event chain, surfacing the marker to the renderer as a
new typed `sessionTransition` `DaemonEvent`. It **retains nothing** — the holder that keeps the current
`session_id` for #257's gate is **#259 (blocked by this)**, mirroring how #187's `runConfigStore` retains
#180's `snapshotReceived`. Here every consumer bridge no-ops the arm, exactly as `snapshotReceived` was a
no-op in `daemonEventBridge` until #187 wired its holder.

The marker only arrives on an interactive connection (capability-gated, #179); **this ticket does not touch
capability negotiation.** Build the decode path Strangler-Fig alongside the existing arms — nothing existing
changes behaviour.

## Wire contract (SSOT: pyrycode/pyrycode#656 — validated, inlined)

`session_transition` — direction binary → phone, v2-only, interactive-gated. Payload is **exactly five
fields** (daemon `SessionTransitionPayload`, `internal/protocol/messaging.go`; wire order
`previous_session_id → new_session_id → reason → occurred_at → workspace_cwd`). **There is no
`conversation_id`** — a session boundary is attributed by the connection it arrives on, and desktop targets
a single active conversation (`MILESTONE_CONVERSATION_ID`).

| Field | Type | Notes |
|---|---|---|
| `previous_session_id` | `string` | The session that ended. Always present. |
| `new_session_id` | `string` | The session that began; the addressing key #259 retains. Always present. |
| `reason` | `string`, closed `clear \| idle_evict \| workspace_change` | A plain wire string (like `MessagePayload.role`), not a named enum. |
| `occurred_at` | `string` | RFC3339Nano timestamp. A plain string on the wire; the decoder requires a string, it does **not** parse/validate the timestamp format. |
| `workspace_cwd` | `string \| null` | The new workspace dir. Non-null **iff** `reason == workspace_change`; literal `null` (always present, no `omitempty`) for `clear` / `idle_evict`. |

**Producer state (pyrycode/pyrycode#657):** emits only `clear` / `idle_evict` today; `workspace_change`
(and thus a non-null `workspace_cwd`) is not yet emitted. The decoder stays **exhaustive over the full
closed set including `workspace_change`** anyway, so the wire contract stays fully expressible (the
"consumer enum may admit a value the producer cannot yet emit" pattern, SSOT #656). The decoder does
**not** cross-validate the `workspace_cwd`-non-null-⟺-`workspace_change` invariant — the daemon guarantees
it on the wire, and enforcing it here would defend an unobserved failure (Evidence-Based Fix Selection).

## Design

Seven thin, additive touchpoints, each cloning a sibling arm. Nothing existing changes behaviour.

### 1. Wire type — `src/shared/wire/types.ts`

Add a closed wire enum and a five-field payload interface, field-for-field with the daemon (mirror the
`WireTurnState` / `TurnStatePayload` doc-comment style at :187-206):

```ts
export type WireSessionTransitionReason = 'clear' | 'idle_evict' | 'workspace_change'

export interface SessionTransitionPayload {
  previous_session_id: string
  new_session_id: string
  reason: WireSessionTransitionReason
  occurred_at: string
  workspace_cwd: string | null
}
```

Add `'session_transition'` to the `EnvelopeType` union. Doc-comment: name the mobile/daemon source
(#656), note "no `omitempty` — every field always present on the wire", note `reason` is a plain wire
string like `MessagePayload.role` (closed set incl. `workspace_change` even though the producer #657 does
not emit it yet), and note `workspace_cwd` is `string | null` (non-null iff `workspace_change`, literal
`null` otherwise) exactly like `ConversationSummary.name` is a valid-`null` field.

### 2. Inbound decode — `src/main/transport/inboundMessage.ts`

- Add the union arm `| { kind: 'session-transition'; sessionTransition: SessionTransitionPayload }` to
  `InboundDaemonMessage` (kebab kind, consistent with `turn-state` / `conversation-created`).
- Add `parseSessionTransitionPayload(payload: unknown): SessionTransitionPayload` — `isRecord` guard, then:
  `previous_session_id` / `new_session_id` / `occurred_at` via `requireString`; `workspace_cwd` via
  **`requireStringOrNull`**; `reason` via the **closed-enum check cloned from `parseTurnStatePayload`'s
  `state` check** (a single `if (reason !== 'clear' && reason !== 'idle_evict' && reason !==
  'workspace_change') throw new WireDecodeError('missing required field: reason')`, which narrows to
  `WireSessionTransitionReason` without a cast and covers non-string / unknown-string alike). Returns
  exactly the five known fields; tolerates extra keys, does not copy them. **Do not** reach for
  `requireString` on `reason` — that would accept any string and defeat the closed-enum boundary this slice
  exists to defend. Every error message names the failure **category only** (never interpolate the value —
  `workspace_cwd` is a workspace path, `*_session_id` is conversation-correlating). Behaviour asserted by
  the fail-closed + happy-path tests (§ Testing).
- Add `case 'session_transition'` to `parseInboundMessage`'s `switch (envelope.type)` (mirror
  `case 'turn_state'`, :605-616): narrow **before** logging so a malformed frame throws first and leaves no
  record; emit the existing content-free record `{ event: 'inbound-decoded', code: 'session_transition',
  bytes: plaintext.length, hash: hashPlaintext(plaintext) }` — **no decoded field** is logged; then
  `return { kind: 'session-transition', sessionTransition }`.

The existing `MAX_PLAINTEXT_BYTES` guard at the top of `parseInboundMessage` already fails oversized frames
closed for this type too — do not add a second guard.

### 3. Consumer emit — `src/main/daemonConnection.ts`  ·  the content-minimisation seam

Add one `case 'session-transition'` to the inner `switch (inbound.kind)`. Emit a **fresh literal carrying
only `newSessionId`** — the `snapshot` content-drop model (:312), not the verbatim-passthrough model:

```ts
case 'session-transition':
  emitDaemonEvent(sink, { type: 'sessionTransition', newSessionId: inbound.sessionTransition.new_session_id })
  return
```

**Drop `previous_session_id`, `reason`, `occurred_at`, `workspace_cwd`.** They are decoded and validated
(so a malformed marker still fails closed) but not carried: #259's holder retains only the current
`session_id` (= `new_session_id`, last-write-wins), so those four have **no built consumer**. This is the
dedicated-minimal-shape discipline #180 established (decode-all, carry-only-what-a-consumer-needs), and the
Simplicity-First / Evidence-Based posture — a field for an unbuilt consumer is speculative. A fresh literal
with the one named field, never a spread of the decoded payload, so only the narrowed id crosses IPC.

### 4. `DaemonEvent` arm — `src/shared/ipc/events.ts`

Add one arm carrying a single string (no new import — a bare `string`, not a wire type):

```ts
| { type: 'sessionTransition'; newSessionId: string }
```

Mirror the `snapshotReceived` doc-comment (dedicated minimal shape): note it carries **only** the addressing
id the holder (#259) retains — the other four marker fields are dropped at the emit; no token, key, or raw
frame (AC4-by-construction); consumed by the renderer holder (#259, not yet built), so **all three bridges
no-op it** for now.

### 5–7. Renderer bridges (three no-ops) — the atomic-union tax

The `DaemonEvent` union is guarded by three independent `assertNever` exhaustiveness checks, so a new arm
is a **compile error** in each until it has a case. All three no-op `sessionTransition` (its only consumer
is the #259 holder):

- **`daemonEventBridge.ts`** — add `case 'sessionTransition': return null` to the no-op fall-through block
  (mirror `turnState` at :60). Comment: *no session-store action — the #259 holder consumes this.*
- **`timelineBridge.ts`** — add `sessionTransition` to the no-op fall-through block at :68-85 (**not** an
  owned arm — unlike `turnState`, this drives no timeline item). Comment: *not a timeline item — the #259
  holder consumes this.*
- **`modalBridge.ts`** — add `sessionTransition` to the no-op fall-through block at :55-75 (mirror
  `turnState` at :67). Comment: *no modal action — the #259 holder consumes this.*

`conversationListBridge.ts` uses `default: null` (no `assertNever`) → **no case, do not touch.**

### Data flow

```
relay socket (untrusted)
  → Noise decrypt → plaintext bytes
  → parseInboundMessage()        [transport boundary: fail-closed decode of ALL 5 fields + content-free log]
      envelope.type 'session_transition'
        → parseSessionTransitionPayload (reason closed-enum check, workspace_cwd requireStringOrNull)
        → { kind:'session-transition', sessionTransition }
  → daemonConnection switch(inbound.kind)   [consumer: content-drop — keep new_session_id, drop the other 4]
      → emitDaemonEvent { type:'sessionTransition', newSessionId }
  → IPC (DAEMON_EVENT_CHANNEL) → renderer
      → daemonEventBridge → null   (session store: nothing)
      → timelineBridge    → null   (timeline: nothing)
      → modalBridge       → null   (modal: nothing)
      → [#259 holder — NOT built here — will retain newSessionId, last-write-wins]
```

## State + concurrency model

No new state, no new store, no new async task, no new IPC channel, no correlation map. Decode is a pure
synchronous function; the event rides the existing one-way `DAEMON_EVENT_CHANNEL` via `emitDaemonEvent` on
the existing driver read loop. The three renderer bridges are pre-existing independent subscribers on that
channel; each no-ops the new arm. Nothing is retained, so there is no last-write-wins ordering to reason
about **here** — that is #259's concern. Cancellation, socket lifecycle, and reconnect are unchanged and
owned upstream (`relaySupervisor` / `noiseRelayDriver`).

## Error handling

- **Any structural / semantic mismatch** — payload not an object; a missing / non-string
  `previous_session_id` / `new_session_id` / `occurred_at`; a `workspace_cwd` that is absent /
  `undefined` / a non-string-non-null; a `reason` that is missing / non-string / a string outside the
  closed set — → `parseSessionTransitionPayload` throws `WireDecodeError` (never a partial or coerced
  value). `daemonConnection`'s existing `try/catch` around `parseInboundMessage` drops the frame — no
  event, no throw, no log (the caught error is dropped so it can't echo plaintext). No new catch needed.
- **Oversized frame** → the existing `MAX_PLAINTEXT_BYTES` guard throws before decode.
- **Well-formed but unmodeled** (a future marker before its own slice) → still falls to `default →
  inbound-unmodeled → null`. Only `session_transition` graduates here.
- **Category-only error messages** — every check names the field only, never interpolating the value
  (`workspace_cwd` is a path, the `*_session_id`s are correlating ids), matching the decoder's uniform
  no-echo discipline.
- **Content-free diagnostics** — the new log call carries only `code` + `bytes` + one-way `hash`, never a
  decoded field. The throw path stays unlogged (narrow before log).

## Testing strategy

Bullet scenarios; the developer writes the vitest code in the project idiom, mirroring the `turn_state` /
`conversation_created` cases. `npm test` + `npm run build` + `npm run typecheck` must stay green.

**`inboundMessage.test.ts`** (mirror the `turn_state` / `conversation_created` cases):
- Well-formed `session_transition` for each `reason` — `clear` (with `workspace_cwd: null`), `idle_evict`
  (`workspace_cwd: null`), and `workspace_change` (with a non-null `workspace_cwd` string) — decodes to
  `{ kind: 'session-transition', sessionTransition: { …five fields verbatim… } }`.
- Fail-closed — **throws `WireDecodeError`, no partial value** — for: `reason` absent / non-string / a
  string outside the closed set (e.g. `'evicted'`, `''`); `previous_session_id` / `new_session_id` /
  `occurred_at` absent or non-string; `workspace_cwd` **absent/`undefined`** (must be present, even as
  `null`) or a non-string-non-null (number, object); the payload not an object (`'nope'`, `['a']`).
- `workspace_cwd: null` is a **valid** decode (a `clear` / `idle_evict` frame), not a failure.
- Extra server-added key is tolerated (decodes fine) but not copied onto the result.
- Content-free logging: with an injected `DiagnosticLog`, a decoded `session_transition` logs
  `code:'session_transition'`, `bytes`, `hash`, and the record contains **no** decoded field. A malformed
  frame throws and logs **nothing**.

**`daemonConnection.test.ts`** (the safety net for the un-`assertNever`'d inner switch — a missing consumer
case silently drops):
- A `session_transition` frame delivered through the driver emits exactly one
  `{ type:'sessionTransition', newSessionId }` with the wire's `new_session_id`.
- **Content-drop assertion (the security property):** the emitted event has **only** `type` +
  `newSessionId` — `previous_session_id` / `reason` / `occurred_at` / `workspace_cwd` (and any
  snake/camel variant) are **absent**. Cover a `workspace_change` frame too (proves even a non-null
  `workspace_cwd` never crosses IPC).
- No regression: coarse `message` / `message_chunk` still emit `messageReceived` / `messagesReceived`.

**`daemonEventBridge.test.ts` / `timelineBridge.test.ts` / `modalBridge.test.ts`**: each `translate…`
returns `null` for the `sessionTransition` arm (mirror the `turnState` no-op case). This plus the three
`assertNever` guards is the compile-time + runtime proof all three bridges handle the arm and none
dispatches on it.

**`types.test.ts`**: the new `SessionTransitionPayload` / `WireSessionTransitionReason` / `EnvelopeType`
member compile (type-level, mirror existing).

Type coverage: `npm run typecheck` — the three `assertNever` guards are the exhaustiveness proof that every
subscriber handles the new arm.

## Scope self-check (7 production files — read this before flagging oversize)

This spec prescribes changes to **exactly 7 production `.ts` files, 0 new files** (verified by reading every
touchpoint; no hidden cascade):

1. `src/shared/wire/types.ts` — `WireSessionTransitionReason` + `SessionTransitionPayload` + 1 `EnvelopeType` member
2. `src/main/transport/inboundMessage.ts` — 1 parse fn + 1 kind + 1 switch case
3. `src/main/daemonConnection.ts` — 1 consumer emit case
4. `src/shared/ipc/events.ts` — 1 `DaemonEvent` arm
5. `src/renderer/src/store/daemonEventBridge.ts` — 1 `assertNever` no-op case
6. `src/renderer/src/store/timelineBridge.ts` — 1 `assertNever` no-op case
7. `src/renderer/src/store/modalBridge.ts` — 1 `assertNever` no-op case

This crosses the commit-gate file-count boundary (≥5), so the keep-as-S is **documented, not assumed** — a
deliberate keep on direct precedent, not an undercount rationalization:

- **The union change is atomic — it cannot be split.** Adding an inbound `DaemonEvent` arm needs: wire type
  → decode → connection emit → event union → **all three** `assertNever`-guarded renderer bridges. Each
  bridge is a **compile error** until it has a case, so the seven files are one indivisible change. Any
  proposed slice either doesn't compile (an arm with a missing bridge case) or decodes into an
  `InboundDaemonMessage` kind the un-`assertNever`'d inner switch **silently drops** — a decode with no
  consumer, dead code a reviewer would flag. The ticket body pre-authorizes this: *"a missing bridge case
  is a compile error, so the arm cannot be split across tickets; the >3-file / ≥5-file red lines do not
  apply."*
- **7 is the architectural floor, one above #214's 6.** #214 hit 6 because only two bridges existed then
  (`daemonEventBridge`, `timelineBridge`). `modalBridge` shipped since (#201), so every new arm now costs a
  third compile-forced no-op. There is no 6-file version of #254 — drop any bridge and `typecheck` fails.
- **Every file is a load-bearing, tiny, cloned edit** — 2–15 lines each, cloning a pattern already in the
  same file (`turn_state` is the template for the decode/emit/bridge edits; `screen_snapshot` for the
  content-drop; `ConversationSummary.name` for the nullable field). This is the opposite of the gate's
  target failure (pyrycode #311: *claimed* 4 files, *actual* 13 / 300+ LOC). Nothing is hidden.
- **Direct clean precedents shipped this exact atomic shape as one `size:s`:** #241 (`conversation_created`
  transport arm, atomic union — the memory's "≥5-file gate UNSATISFIABLE for a DaemonEvent-arm → ONE
  size:s"), #214 (6 prod files, PASS, no salvage), #180 (8 prod files). #254 is structurally identical to
  #214 plus one bridge no-op and one nullable field.
- **Every line-based red line (the accurate turn-budget proxy) passes comfortably:** 0 new files,
  ~70 production + ~145 test ≈ **~215 total LOC** (well under 600), **2 new exported types**
  (`WireSessionTransitionReason`, `SessionTransitionPayload`; the arm/kind are union members, not exports),
  **0 consumer call-site cascade** (the three bridge cases are compile-forced single lines), **1 reject
  branch** (the `reason` enum check; the `requireString*` throws are existing shared narrowers), **4 ACs**
  all facets of one atomic change. Projected turn cost tracks #214 (~15–25 turns), well inside budget.

Conclusion: genuine, verified, precedented S — an atomic union arm that is structurally un-splittable.
Not an undercount. Proceed.

## Open questions

- **Emit shape — settled at minimal.** The arm carries **only `newSessionId`**, the sole field #259's
  holder retains. `reason` / `occurred_at` would only feed a *future* desktop session-boundary timeline
  marker (the mobile `ThreadItem.SessionBoundary` analog, #656) that is **not ticketed**; `workspace_cwd`
  is doubly speculative (only ever non-null for `workspace_change`, which the producer #657 does not emit).
  Carrying any of the four now is a field for an unbuilt consumer (Simplicity-First / Evidence-Based).
  Widening the arm later is a one-line additive change — the same posture #191 used to add two usage ints
  to `snapshotReceived` after #180 shipped. If #259's architect finds the holder needs more than the id,
  that widening lands with #259, not speculatively here.
- **Inner-switch exhaustiveness (deferred, not adopted).** `daemonConnection.ts`'s `switch (inbound.kind)`
  still has no `default: assertNever(inbound)`, so a missing consumer case would silently drop rather than
  fail to compile. The `daemonConnection.test.ts` emit + content-drop test is the deterministic safety net
  (same as #180 / #214 / #241). **Do not** expand scope to guard the switch here.
- **`reason` value evolution.** The daemon set is closed to three today (producer emits two). A future
  fourth `reason` would fail closed here (dropped frame) until this decoder is widened — the correct
  fail-closed, no-drift posture for a wire enum (CLAUDE.md).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST-FIX. The untrusted→trusted boundary (relay socket → decrypted plaintext →
  `parseInboundMessage`) gains one explicit, single-function fail-closed decoder
  (`parseSessionTransitionPayload`), throwing `WireDecodeError` on any structural/semantic mismatch, never a
  partial value — the same named boundary that already owns `message` / `turn_state`. The **tightest** gate
  is the `reason` **closed-enum** check: a hostile daemon cannot smuggle an arbitrary string, an object,
  `null`, or a `'__proto__'`-style value onto `reason` — anything not exactly
  `clear | idle_evict | workspace_change` throws and the frame drops. Positive control against IPC-side
  unknown-key / prototype leakage: the consumer emits a **fresh object literal** with one named field
  (`{ type:'sessionTransition', newSessionId }`), never a spread of the decoded payload.
- **[Trust boundaries — code-review must verify]** SHOULD FIX (design-directed, already specified). The
  security property of this slice is (a) the `reason` enum check and (b) the emit-side content-drop. If the
  developer reaches for `requireString('reason')` (Design § 2) the enum boundary silently weakens to "any
  string"; if they emit a spread / the whole payload instead of the one-field literal (Design § 3), the
  four dropped fields leak to the renderer. Both are called out explicitly in the design and pinned by
  deterministic tests: `inboundMessage.test.ts` asserts an out-of-set `reason` throws, and
  `daemonConnection.test.ts` asserts the emitted event has **only** `newSessionId`. A green suite proves
  both boundaries shipped.
- **[Tokens / secrets]** N/A by design. No token/key/credential is added, decoded, or carried. A
  `session_id` is a **routing id, not a secret** (the existing `conversation_id` / `snapshotReceived`
  convention, AC4) — and only `new_session_id` crosses IPC; `previous_session_id`, `reason`, `occurred_at`,
  and `workspace_cwd` are dropped at the emit. No field on the arm can hold a key/token/raw frame.
- **[File / storage]** N/A — no filesystem or storage operation. This slice retains nothing to disk (the
  holder is #259); it decodes and forwards one string.
- **[Electron attack surface]** No finding. No new `BrowserWindow`, `webPreferences`, IPC channel,
  `ipcMain` handler, custom protocol, or preload method — the arm rides the existing one-way
  `DAEMON_EVENT_CHANNEL` (`emitDaemonEvent`) the preload already forwards generically (no per-type preload
  change). Process placement preserved: decode lives in `src/main/transport/inboundMessage.ts` (main-only,
  imports `Buffer`, never re-exported to a renderer barrel); no key, socket, or raw frame moves toward the
  renderer. The single `newSessionId` string flowing main→renderer grants the renderer no new reach toward
  transport / keys.
- **[Cryptographic primitives]** N/A — no RNG, key, nonce, or handshake code. `hashPlaintext` (BLAKE2s via
  `@noble/hashes`, note #101) is reused verbatim for the content-free log; no new or hand-rolled crypto.
- **[Network & I/O]** No finding. The existing `MAX_PLAINTEXT_BYTES` (65519) guard fails an oversized
  `session_transition` frame closed before decode — no new size cap needed. The payload is five flat scalars
  (no array, no nesting) so there is no decode amplification; a hostile `reason` (a huge string or nested
  object) is rejected by the O(1) enum comparison with no regex (no ReDoS); a hostile `workspace_cwd` (a
  huge string) is bounded by `MAX_PLAINTEXT_BYTES` and never crosses IPC (dropped at emit). No new socket /
  timeout / reconnect surface.
- **[Error messages, logs, telemetry]** No finding — the category the ticket is security-sensitive *for*,
  addressed head-on. The one new diagnostic call is **content-free** (`code:'session_transition'` + `bytes`
  + one-way `hash` only), emitted **after** the frame fully narrows so the throw path leaves no record; the
  parser error messages name the failure **category only** (`missing required field: reason` etc. — never
  interpolating a `workspace_cwd` path or a session-correlating id); the `WireDecodeError` caught in
  `daemonConnection` is dropped, never logged or forwarded.
- **[Concurrency]** No finding — no new async task, timer, listener, or socket; decode is synchronous; the
  event rides the existing driver read loop. No shared-state check-then-act, nothing to cancel or leak, no
  retained state (the holder is #259). The three renderer bridges are pre-existing independent subscribers.
- **[Threat model alignment]** Addressed for the boundary this slice owns. *Malicious/compromised relay*
  (on-path, content-blind): a flood of malformed `session_transition` frames all throw and drop — no
  plaintext leak, no log record, no hang (synchronous, frame-bounded). *Hostile daemon response*
  (malformed/oversized inside the session): every field parsed defensively, fail-closed, with the `reason`
  enum check as the tightest gate. *Renderer compromise reaching transport*: unchanged — no new renderer
  capability; the renderer gains only one opaque routing id. *Cross-field-invariant abuse* (a `clear` frame
  carrying a non-null `workspace_cwd`, or vice versa): the field decodes fine but is dropped at the emit, so
  a violated daemon invariant reaches no consumer — the invariant is deliberately **not** enforced here
  (daemon-guaranteed, unobserved failure).
- **[Untrusted content at render — none forwarded]** Unlike `assistant_delta.text` (#199) or a modal's
  `title` / `prompt`, this arm forwards **no untrusted display text** to any render slice — only
  `newSessionId`, an opaque routing id consumed by the #259 holder (not a DOM sink). The one field that
  *would* be display text (`workspace_cwd`, like `ConversationSummary.cwd`) is dropped at the emit and never
  reaches the renderer. There is no untrusted-text-at-DOM concern to forward.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-10
