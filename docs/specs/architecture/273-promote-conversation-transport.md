# Spec — #273: Wire `promote_conversation` through the transport → `conversationUpdated` daemon event

Transport half of the "save a discussion as a channel" vertical (split from #143). The renderer-facing
Save-as-channel dialog is **#274**; the live-list reflection that flips a row from discussion to channel
is **#275** — both consume what this slice introduces and are blocked by it. This slice adds the full
main-side round-trip for a single verb: an outbound `promoteConversation` command → `promote_conversation`
frame, and the daemon's `conversation_updated` **broadcast** decoded into a typed `conversationUpdated`
daemon event.

This is the direct **twin of #241** (`create_conversation` → `conversationCreated`), field-for-field in
structure — clone that slice, but mind the two deliberate divergences called out throughout: the request
is **three required plain strings** (create's are three nullable-and-present), and the reply is an
**unsolicited broadcast** (create's rides `in_reply_to`), with a payload field order of
`{ id, is_promoted, name, cwd, last_used_at }` — `name` **before** `cwd` (created has them the other way).

This is **not** UI-visible work (no window/DOM surface), so there is no `## Design source` / Figma
section — that is intentional, not a PO gap.

## Files to read first

- `src/shared/wire/types.ts:40-69` — `EnvelopeType` union (add `'promote_conversation'` +
  `'conversation_updated'`). `:72-82` — `Envelope` + the `in_reply_to?` "never emitted as null" comment;
  that comment governs Envelope **optional** fields — it does **not** apply to the reply's nullable `name`
  (see Design § wire types).
- `src/shared/wire/types.ts:455-491` — `CreateConversationPayload` (455-471) + `ConversationCreatedPayload`
  (473-491). Extract: the doc-comment style and the `name: string | null` rationale. **Do not clone
  create's nullability** for the request (promote's three fields are required, not nullable), and mind that
  `ConversationUpdatedPayload` orders `name` before `cwd`, unlike created.
- `src/shared/wire/types.ts:428-447` — `ConversationSummary`; the `name: string | null` idiom the reply's
  `name` mirrors (a literal `null`, never absent).
- `src/shared/ipc/commands.ts` (whole file, ~225 lines) — the command union + `isRendererCommand` + the
  per-payload guards. Extract: `isSendMessagePayload:147-157` (three **required** strings — the guard to
  clone for promote) and `isCreateConversationPayload:190-206` (the nullable guard — the shape to **avoid**).
  The new command member, its `isRendererCommand` case, and a new required-string guard slot in here. No
  constructor is added (see Design).
- `src/main/transport/createConversationEnvelope.ts` (whole file, 47 lines) — the payload-carrying builder
  to clone. **Drop its null-preservation prose** — promote's fields are all required, so there is no
  explicit-`null` subtlety. `src/main/transport/sendMessageEnvelope.ts` (whole file) — the closer analog
  (a required-string payload builder).
- `src/main/daemonConnection.ts:150` — the `createConversation` interface decl to mirror. `:714-741` — the
  `createConversation` method body (the fresh-literal net) to clone. `:488-498` — the `conversation-created`
  emit case (verbatim passthrough). `:902-905` — the returned object literal (add `promoteConversation`).
- `src/main/transport/inboundMessage.ts:167-206` — `requireString` / `requireBoolean` /
  `requireStringOrNull` (reuse for the reply fields). `:136-158` — `InboundDaemonMessage` union. `:483-504`
  — `parseConversationCreatedPayload` (clone target — but reorder to `id, is_promoted, name, cwd,
  last_used_at`). `:769-782` — the `conversation_created` switch case (narrow-before-log clone target).
- `src/shared/ipc/events.ts:60-168` — the `DaemonEvent` union. `:134-141` — the `conversationCreated` arm
  (the reuse-wire-type-verbatim precedent **and** the untrusted-display-text warning to carry forward).
- `src/main/index.ts:234-270` — the single `onCommand` routing switch; `:258-262` the `createConversation`
  case to mirror.
- `src/renderer/src/store/daemonEventBridge.ts:27-95` (conversationCreated case `:70-72`),
  `timelineBridge.ts:35-94` (fall-through group `:78-79`), `modalBridge.ts:41-87` (fall-through group
  `:76-77`) — the **three exhaustive** (`assertNever`) `DaemonEvent` consumers; each needs a one-line no-op
  case. `conversationCreatedBridge.ts`, `conversationListBridge.ts`, `sessionIdBridge.ts`,
  `runSettingsWriteBridge.ts` all use `default: null` → **not** touched.
- Test clone targets: `createConversationEnvelope.test.ts` / `sendMessageEnvelope.test.ts` (builder),
  `commands.test.ts` (guard accept/drop), `inboundMessage.test.ts` (decode valid/malformed),
  `daemonConnection.test.ts` (method sends + not-connected no-op + emit), `types.test.ts` (round-trip both
  shapes incl. `name: null`).

## Context

Desktop has the read side of promotion — `ConversationSummary.is_promoted` (#139) and the Channel List's
`partitionByPromotion` (#141) already split rows into channels vs discussions. What's missing is the
outbound request that flips the bit and the inbound broadcast that confirms it. This slice makes the
round-trip typed and testable end-to-end in the background process; #274 wires the dialog and #275 reflects
the flipped row into the live list on top.

Wire shapes are dictated verbatim by the daemon contract — confirmed against QMD `pyrycode-docs` (daemon
spec #274, `internal/protocol/conversations_write.go`, the golden-file source for all four
`conversations_write` verbs). The Go structs, field-for-field:

```go
type PromoteConversationPayload struct {          // request (client → daemon)
    ConversationID string `json:"conversation_id"` // all three REQUIRED value-strings —
    Name           string `json:"name"`            // no pointers, no omitempty. A promoted
    Cwd            string `json:"cwd"`              // conversation MUST carry a name + cwd.
}
type ConversationUpdatedPayload struct {           // reply (daemon → client, BROADCAST)
    ID         string    `json:"id"`
    IsPromoted bool      `json:"is_promoted"`
    Name       *string   `json:"name"`             // *T no omitempty → null on the wire = string | null
    Cwd        string    `json:"cwd"`
    LastUsedAt time.Time `json:"last_used_at"`      // RFC3339 string on the wire
}
```

`CLAUDE.md` no-drift: mirror both structs field-for-field, in declared field order. Note the daemon
deliberately orders `Name` **before** `Cwd` in `ConversationUpdatedPayload` (and `Cwd` before `Name` in
`ConversationCreatedPayload`) — spec #274 flags this reordering as intentional. Mirror it.

## Design

Ten production files, one new. Below, grouped by the two data directions.

### Wire types — `src/shared/wire/types.ts`

- Add `'promote_conversation'` and `'conversation_updated'` to the `EnvelopeType` union.
- Add two interfaces (clone the `CreateConversationPayload` / `ConversationCreatedPayload` doc-comment
  style):

  ```ts
  export interface PromoteConversationPayload {
    conversation_id: string
    name: string
    cwd: string
  }
  export interface ConversationUpdatedPayload {
    id: string
    is_promoted: boolean
    name: string | null
    cwd: string
    last_used_at: string
  }
  ```

- **The request is REQUIRED-string, the deliberate opposite of create.** `CreateConversationPayload`'s
  three fields are `T | null` (nullable-and-present — "take the server default"). Promote's three are plain
  `string` — a promoted conversation must carry a real name and an effective cwd, and the id must resolve
  to an existing row. Document this contrast in the interface comment so a future maintainer does not
  "helpfully" relax them to nullable.
- **The reply's `name` is nullable-and-present, NOT optional.** The daemon uses `*string` *without*
  `omitempty`, so the key is always on the wire with an explicit `null`. Type it `string | null` (present,
  nullable) — exactly like `ConversationSummary.name` / `ConversationCreatedPayload.name` — **not**
  `string | undefined`. The `Envelope.in_reply_to?` "never emit null" convention does not apply here.
- **Field order matters for no-drift.** `ConversationUpdatedPayload` is `{ id, is_promoted, name, cwd,
  last_used_at }` — `name` before `cwd`. Do not copy `ConversationCreatedPayload`'s `{ id, is_promoted,
  cwd, name, last_used_at }` order. (Functionally the inbound decoder reads by key name so order is
  documentation-only there; the discipline is the CLAUDE.md no-drift rule, and the outbound builder
  serializes object-literal insertion order.)

### Command (outbound) — `src/shared/ipc/commands.ts`

- Import `PromoteConversationPayload`; add `| { type: 'promoteConversation'; payload:
  PromoteConversationPayload }` to `RendererCommand`.
- Add `case 'promoteConversation': return 'payload' in value && isPromoteConversationPayload(value.payload)`
  to `isRendererCommand`.
- Add the guard — clone `isSendMessagePayload` (three required-string checks), **not**
  `isCreateConversationPayload` (which accepts `null`):

  ```ts
  function isPromoteConversationPayload(value: unknown): value is PromoteConversationPayload
  // requires: conversation_id, name, cwd each present AND typeof === 'string';
  // rejects a missing key, a non-string, and a literal null (unlike the create guard).
  ```

- **No `promoteConversationCommand` constructor.** Following the `requestSnapshot` / `createConversation`
  precedent (a payload-bearing command with no constructor — the render side #274 builds `{ type:
  'promoteConversation', payload }` inline). A constructor exists only where main mints a field
  (`sendMessage`'s `message_id`, `answerModal`'s `answer_token`); there is no mint here.

### Builder (outbound) — `src/main/transport/promoteConversationEnvelope.ts` (NEW)

- Clone `createConversationEnvelope.ts` / `sendMessageEnvelope.ts`: a `PromoteConversationInput { id, ts,
  payload: PromoteConversationPayload }` and `buildPromoteConversation(input): Uint8Array` wrapping
  `input.payload` in a `promote_conversation` Envelope and `encodeEnvelope`-ing it. MAIN-PROCESS ONLY
  (imports `codec.ts`, Node `Buffer`); never re-export through a renderer barrel. Header comment mirrors
  the sibling builders' "MAIN-PROCESS ONLY … raw bytes stay out of the web layer."
- **Simpler than create's builder** — all three fields are required strings, so there is no explicit-`null`
  preservation concern. Drop the "JSON.stringify preserves null" prose from the clone; keep the over-cap
  `WireEncodeError` note (the sole caller catches it).

### Connection method (outbound) — `src/main/daemonConnection.ts`

- Import `buildPromoteConversation` and `PromoteConversationPayload`.
- Add `promoteConversation(payload: PromoteConversationPayload): void` to the `DaemonConnection` interface
  (doc-comment cloned from `createConversation` at `:150`: the `send` twin — inert no-op when not connected,
  never throws out of the module; the reply arrives asynchronously as one `conversationUpdated` **broadcast**
  event, consumed by #275, not the session store).
- Implement it as a `createConversation` clone (`:714-741`): `if (driver === null) return`, then inside
  `try` **build a fresh literal** naming exactly the three modeled fields — `{ conversation_id:
  payload.conversation_id, name: payload.name, cwd: payload.cwd }` — pass it to `buildPromoteConversation`,
  advance `nextEnvelopeId` only on a successful build, `driver.sendMessage(bytes)`, and swallow any throw
  in the `catch` (classify-don't-forward). The fresh literal is the deterministic net (see Error handling /
  security): exactly the three fields cross the Noise boundary regardless of what the structural-minimum
  guard let through — no spread of the untrusted `payload`.
- Add `promoteConversation` to the returned object literal (`:902-905`, alongside `createConversation`).
- Add the emit case in `onDriverEvent`'s inner `switch (inbound.kind)` — `case 'conversation-updated':` →
  `emitDaemonEvent(sink, { type: 'conversationUpdated', conversation: inbound.conversationUpdated })`.
  Verbatim passthrough (the `conversation-created` precedent `:488-498`): `parseConversationUpdatedPayload`
  already returns a fresh 5-field object with nothing to drop, so no re-construction at emit.

### Inbound decode (inbound) — `src/main/transport/inboundMessage.ts`

- Import `ConversationUpdatedPayload`; add `| { kind: 'conversation-updated'; conversationUpdated:
  ConversationUpdatedPayload }` to `InboundDaemonMessage`.
- Add `parseConversationUpdatedPayload(payload): ConversationUpdatedPayload` — clone
  `parseConversationCreatedPayload` but in the reply's field order: `requireString('id')`,
  `requireBoolean('is_promoted')`, `requireStringOrNull('name')`, `requireString('cwd')`,
  `requireString('last_used_at')`; return `{ id, is_promoted, name, cwd, last_used_at }`. Fail-closed;
  unknown server keys tolerated but not copied; category-only error messages (a `name`/`cwd` could echo a
  title or workspace path). `name: null` is a valid value (AC); a missing/mistyped field throws
  `WireDecodeError`.
- Add `case 'conversation_updated':` to the main `switch (envelope.type)` (clone the `conversation_created`
  case `:769-782`): narrow BEFORE logging (so a malformed frame throws first and leaves no record), emit the
  content-free diagnostic record `{ event: 'inbound-decoded', code: 'conversation_updated', bytes, hash }`
  (reuse the existing field set — no new `DiagnosticEvent` field, so #131's renderer pin is untouched;
  deliberately no `count`), return `{ kind: 'conversation-updated', conversationUpdated }`.

### Event arm (inbound) — `src/shared/ipc/events.ts`

- Import `ConversationUpdatedPayload`; add `| { type: 'conversationUpdated'; conversation:
  ConversationUpdatedPayload }` to `DaemonEvent`. Reuse the wire type verbatim (the `conversationCreated` /
  `conversationsReceived` precedent) — nothing to drop, no secret field (`ConversationUpdatedPayload`
  carries an id, a flag, a nullable title, a workspace path, and a timestamp). Consumer is the list-reflect
  ticket #275, not the session store — so every exhaustive consumer no-ops it here.
- **Carry the untrusted-display-text warning forward in the arm's doc-comment** (the
  `conversationCreated` / modal / tool-arm convention): `name` and `cwd` are daemon-supplied strings the
  render/store slice #275 must treat as plain text, **never HTML** (no `innerHTML` /
  `dangerouslySetInnerHTML`). This ticket has no DOM sink, but the comment is where #275's developer
  inherits the constraint — do not drop it.

### Routing + exhaustive consumers

- `src/main/index.ts` — add `case 'promoteConversation': connection.promoteConversation(command.payload);
  return` to the `onCommand` switch (mirrors the `createConversation` case `:258-262`).
- `src/renderer/src/store/daemonEventBridge.ts` — add `case 'conversationUpdated': return null` (no
  session-store action; #275 consumes it) before `default: assertNever`.
- `src/renderer/src/store/timelineBridge.ts` and `modalBridge.ts` — add `case 'conversationUpdated':` to
  each existing null fall-through group (the same block that already lists `conversationsReceived` /
  `conversationCreated`), before `assertNever`. One line each.

## State + concurrency model

No new store, no new async task. The outbound path is synchronous (`promoteConversation` runs to completion
with no `await`, sharing the single-writer `nextEnvelopeId` counter — no check-then-act race, matching every
sibling method). The inbound path is the existing driver `message` event → `parseInboundMessage` →
`emitDaemonEvent` choke point; the new arm adds one `kind` and one emit case.

`conversation_updated` is an **unsolicited broadcast** — the daemon fans it out to every client on the
server-id and does **not** correlate it to the sender's `promote_conversation` via `in_reply_to`. This is
the `assistant_delta` pattern (an event, not a request/response pair), and it means this slice adds **no**
outstanding-request memory (unlike the correlated `set_session_settings` #261 / `modal_answer` #248 paths
that maintain a pending-map keyed by `in_reply_to`). The event is emitted unconditionally on decode. The
promoting client also receives its own broadcast; deduping that against the local store, and reconciling a
broadcast for an id the client did not promote, are **#275's** concerns — this slice only decodes and emits.

Teardown is unchanged: a `promoteConversation` arriving while disconnected is an inert no-op (`driver ===
null`); a socket drop mid-request produces no reply and no hang (there is no consumer to resolve — no
correlation memory to leave dangling).

## Error handling

- **Outbound, malformed command:** dropped at the `isRendererCommand` boundary in `receiveCommand`
  (`console.warn` fixed string, never renderer data) — never forwarded (AC: guard rejects a missing /
  non-string field).
- **Outbound, over-cap / driver throw:** `buildPromoteConversation` may throw `WireEncodeError` and
  `driver.sendMessage` may throw; the method's `catch` drops the caught object (classify-don't-forward) and
  the send is dropped — never throws out of the module (parity #490).
- **Outbound, field smuggling (security net):** the guard is a structural minimum and tolerates extra keys;
  the connection method's **fresh literal** (not a spread of `payload`) is the deterministic
  belt-and-suspenders net that bounds the wire to exactly `conversation_id` / `name` / `cwd`. Different
  fabric from the guard, per the pipeline principle — and the established #236/#241 posture for a
  security-sensitive outbound frame from the untrusted renderer.
- **Inbound, malformed broadcast:** `parseConversationUpdatedPayload` fails closed — throws
  `WireDecodeError`, caught by `onDriverEvent`'s `message` catch, the frame dropped (no event, no throw). A
  partial or coerced row is never emitted (AC). Category-only messages; no field value is interpolated.
- **Inbound, unknown type:** unchanged `default` branch — logged content-free, returns `null`, not surfaced.

## Testing strategy

`npm test` (vitest), plain function tests with fakes — no Electron harness. Scenarios (bullet form; the
developer writes them in the project idiom, cloning the cited test files):

- **`types.test.ts` — round-trip both shapes.** Add a `describe('promote/update wire vocabulary (#273)')`:
  a `promote_conversation` Envelope with three populated string fields round-trips through
  `encodeEnvelope` / `decodeEnvelope`; a `conversation_updated` Envelope round-trips including `name: null`
  and a populated `name`, preserving the `id, is_promoted, name, cwd, last_used_at` key order.
- **`commands.test.ts` — boundary guard.** `isRendererCommand` accepts `{ type: 'promoteConversation',
  payload: { conversation_id: 'c1', name: 'weekly', cwd: '/w' } }`; rejects missing `payload`,
  `payload: null`, a wrong-typed field (`name: 3`), a **literal `null`** field (`cwd: null` — the promote
  guard rejects null, unlike the create guard), and a missing key.
- **`promoteConversationEnvelope.test.ts` (NEW) — builder.** `buildPromoteConversation` round-trips to a
  `promote_conversation` envelope carrying the exact id, ts, and three fields; throws `WireEncodeError` past
  the plaintext cap (clone `createConversationEnvelope.test.ts` / `sendMessageEnvelope.test.ts`).
- **`inboundMessage.test.ts` — decode.** A valid `conversation_updated` frame → `{ kind:
  'conversation-updated', conversationUpdated }` with the five fields (incl. `name: null` and
  `is_promoted: true`); each missing/mistyped field throws `WireDecodeError`; a non-object payload throws;
  assert the diagnostic record is content-free (`code: 'conversation_updated'`, no decoded field) when a
  fake logger is injected.
- **`daemonConnection.test.ts` — method + emit.** `promoteConversation(payload)` while connected calls
  `driver.sendMessage` with a `promote_conversation` envelope carrying exactly the three fields (assert a
  smuggled extra field on the input does **not** cross — the fresh-literal net); while not connected
  (`driver === null`) it is a no-op and never throws; a decoded `conversation_updated` inbound frame emits
  exactly one `conversationUpdated` DaemonEvent carrying the payload; a malformed inbound frame emits
  nothing.
- **Type-level:** `npm run typecheck` — the three `assertNever` bridges fail to compile until each has a
  `conversationUpdated` case; that compile error IS the coverage. `npm run build` is the salvage gate (the
  modalBridge "3rd bridge → build-only error" lesson from #229 — run build before the PR).

## Scope self-check — why 10 production files is still `size:s`

This trips the "≥5 production files" commit-gate on raw count, so here is the explicit, non-rationalized
justification (a structural codebase fact, not a "mechanical edits" escape). It is the **identical**
justification #241 accepted; the ticket body pre-empts this exact objection.

- **The ≥5 floor is unsatisfiable for *any* new `DaemonEvent` arm — the split produces a child that also
  trips it.** Adding one arm forces the three exhaustive `assertNever` bridges (`daemonEventBridge`,
  `timelineBridge`, `modalBridge`) + the emit site + `events.ts` + `inboundMessage.ts` + `types.ts` to
  change **in the same commit** — the `assertNever` guards make a missing case a compile error and the
  salvage gate `npm run build` fails. Concretely: an **inbound-only** split (drop the outbound command +
  builder + method) still touches `types.ts`, `inboundMessage.ts`, `daemonConnection.ts`, `events.ts`, and
  the three bridges = **7 files**; an **outbound-only** split still touches `types.ts`, `commands.ts`, the
  new builder, `daemonConnection.ts`, `index.ts` = **5 files**. Neither child gets under 5 — the split does
  not help, it only produces children that also "fail" the gate while shipping an incomplete verb. The floor
  is a proxy for edit fan-out; here four of the ten edits are additive one-line no-op cases with zero
  per-site reasoning.
- **Empirical precedent in this exact codebase.** The identical single-verb transport footprint shipped at
  `size:s` within budget: **#241** (create_conversation — the direct twin, PR #244), #139
  (conversations-read, PR #209), #180 (snapshot, PR #185), #201 (modal decode, PR #228), #229 (tool_result,
  PR #232). None hit `max_turns`.
- **Step-1 red lines all clear:** new files **1** (≤3); total projected LOC ~180 production + ~200 tests ≈
  **380** (≤600); new exported types **2** (≤5); simultaneous consumer call sites **4** additive one-liners
  (3 bridges + the routing case; ≤10); reject branches ~5 (≤10); acceptance criteria 5 (the PO-folded
  count). The only nominal trip is the file count, which is the codebase's exhaustiveness-guard tax, not
  separable work.

Decision: **one `size:s` ticket**, as PO refined it. The verb is single; the file count is the codebase's
exhaustiveness-guard tax, not separable work.

## Open questions

- **Self-broadcast dedup / spurious-id reconciliation.** The promoting client receives its own
  `conversation_updated`, and a broadcast could name an id the local store has never seen. Both are #275's
  (list-reflect) concern — this slice emits the event faithfully and does not reconcile it.
- **`in_reply_to` correlation** is intentionally absent (the reply is a broadcast, not a response). If a
  future world needs to tie a specific promote to its confirmation, that is an additive Envelope-field read
  layered on top, not a reshape of this slice.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No MUST FIX — two explicit, named, fail-closed boundaries:
  `isPromoteConversationPayload` (`src/shared/ipc/commands.ts`, renderer→main IPC — three required-string
  checks, rejects null/missing/non-string) and `parseConversationUpdatedPayload`
  (`src/main/transport/inboundMessage.ts`, daemon→main). Downstream holds parsed types only; the connection
  method's fresh literal (not a spread) bounds the outbound wire to exactly `conversation_id` / `name` /
  `cwd` even if the structural-minimum guard tolerates extras.
- [File / storage] No findings — the outbound `cwd` is a renderer-supplied, path-shaped string that becomes
  a working directory **server-side**, but the desktop never resolves it into an `fs.*` call in either
  direction; it is carried as opaque display text (the #139 / #241 posture). Server-side `cwd` validation
  and id resolution are the daemon's concern — its `promote_conversation` dispatch handler /
  `conversations.Registry.Promote` (the `ErrPromotion*` sentinels), out of scope per daemon spec #274.
- [Trust boundaries / Logs] SHOULD FIX (addressed inline) — inbound `name` / `cwd` / `id` are untrusted
  daemon-supplied strings. The `events.ts` arm doc-comment carries the plain-text-never-HTML warning forward
  so the list-reflect ticket #275 inherits the DOM-sink constraint (this ticket has no DOM sink). The parse
  errors and the diagnostic record are content-free (category-only messages; `code` / `bytes` / `hash` only,
  no decoded field, no `count`).
- [Tokens / secrets] No findings — this verb mints and carries no token/credential (unlike the #236
  modal-answer `answer_token`). No RNG, storage, rotation, or revocation surface introduced.
- [Electron attack surface] No findings — one command member added on the existing `pyry:command` channel,
  validated at the boundary, minimal three-field shape (no capability). No new window / preload /
  contextBridge surface. `promoteConversationEnvelope.ts` is MAIN-PROCESS ONLY, never re-exported to a
  renderer barrel; keys / sockets / raw frames stay out of the window (CLAUDE.md).
- [Cryptographic primitives] No findings — no new crypto / RNG; the `promote_conversation` frame rides the
  existing vetted Noise session's AEAD framing via `driver.sendMessage`.
- [Network & I/O] No findings — inbound size-capped by the `MAX_PLAINTEXT_BYTES` guard before decode;
  outbound bounded by `WireEncodeError`. No new socket, dial, timeout, or reconnect logic. A malformed /
  oversized `conversation_updated` from a hostile daemon fails closed; a broadcast flood is bounded like
  every other inbound-event arm.
- [Concurrency] No findings — synchronous method sharing the single-writer `nextEnvelopeId`, no `await`
  between guard and send (no check-then-act race). The broadcast reply adds **no** outstanding-request
  memory (simpler than the correlated #248 / #269 paths), so there is nothing to leak or leave dangling on
  a mid-request socket drop; inert when disconnected.
- [Threat model alignment] OUT OF SCOPE (named) — a content-blind on-path relay cannot forge inside the
  Noise session; a frame flood is bounded like every inbound arm. A hostile daemon can broadcast a
  `conversation_updated` for an arbitrary id, but the desktop already trusts the daemon for all conversation
  state inside the session (#139 / #241), so this is within the existing daemon-trust envelope, not a new
  vector — reconciliation is #275's concern. A compromised renderer's blast radius is a daemon-validated
  promote with no key/token/socket reach (identical to `send_message` / `create_conversation`); the
  paired-client trust model is upstream (`pyrycode` ADR 025), not this ticket.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-12
