# Spec — #241: Wire `create_conversation` through the transport → `conversationCreated` daemon event

Transport half of the "create a new conversation" vertical (split from #142). The renderer FAB
that fires the command and opens the new thread is the sibling render ticket **#242**, blocked by
this one. This slice adds the full main-side round-trip for a single verb: an outbound
`createConversation` command → `create_conversation` frame, and the daemon's `conversation_created`
reply decoded into a typed `conversationCreated` daemon event.

This is **not** UI-visible work (no window/DOM surface), so there is no `## Design source` / Figma
section — that is intentional, not a PO gap.

## Files to read first

- `src/shared/wire/types.ts:40-64` — `EnvelopeType` union (add two members) + `Envelope`. Note the
  `in_reply_to?` optional-field comment (72-77): "never emitted as null" applies to Envelope
  *optional* fields — it does **not** apply to the new payloads' nullable fields (see Design).
- `src/shared/wire/types.ts:351-376` — `ConversationSummary` (7 fields) + `ConversationsPayload`.
  The new `ConversationCreatedPayload` is its OWN 5-field shape; do **not** reuse this. Mirror the
  `name: string | null` rationale comment.
- `src/shared/ipc/commands.ts` (whole file, ~166 lines) — the command union + `isRendererCommand` +
  the per-payload guards (`isRequestSnapshotPayload`, `isSendMessagePayload`). The new command member,
  its guard case, and a new nullable-field guard slot in here. No constructor is added (see Design).
- `src/main/transport/sendMessageEnvelope.ts` (whole file) — the payload-carrying builder pattern to
  clone for `createConversationEnvelope.ts` (`buildRequestSnapshot` is the same shape).
- `src/main/transport/listConversationsEnvelope.ts:26-48` — the "present-but-empty payload" note.
  The analogous concern here is present-but-**null** fields (Design § wire types).
- `src/main/daemonConnection.ts:118-152` — the `DaemonConnection` method contracts
  (`requestSnapshot` / `answerModal`). `:547-624` — the `requestSnapshot` / `answerModal` / `cancelModal`
  method bodies to clone (fresh-literal construction net). `:368-378` — the `conversations` emit case
  (the verbatim-passthrough emit precedent).
- `src/main/transport/inboundMessage.ts:106-121` — `InboundDaemonMessage` union. `:160-172` —
  `requireStringOrNull` (reuse for `name`). `:358-396` — `parseConversationSummary` /
  `parseConversationsPayload` (clone target). `:617-630` — the `conversations` switch case (content-free
  log clone target).
- `src/shared/ipc/events.ts:59-119` — the `DaemonEvent` union. `:98-103` — the `conversationsReceived`
  arm (the reuse-wire-type-verbatim precedent for the new arm).
- `src/main/index.ts:234-262` — the single `onCommand` routing switch (add one case).
- `src/renderer/src/store/daemonEventBridge.ts:27-78`, `timelineBridge.ts:36-86`,
  `modalBridge.ts:42-75` — the **three exhaustive** (`assertNever`) DaemonEvent consumers. Each needs a
  one-line no-op case. `conversationListBridge.ts` uses `default: null` → **not** touched.
- Test clone targets: `src/main/transport/requestSnapshotEnvelope.test.ts` (builder), `commands.test.ts`
  (guard accept/drop), `inboundMessage.test.ts` (decode valid/malformed), `daemonConnection.test.ts`
  (method sends + not-connected no-op + emit), `types.test.ts` (round-trip both shapes incl. null).

## Context

Desktop has no create path. The daemon speaks a `create_conversation` request (all three fields
server-defaultable, `null` = "let the daemon choose") and replies with a `conversation_created` frame
carrying the new conversation's summary. This slice makes the round-trip typed and testable end-to-end
in the background process; #242 then wires the FAB and thread-open on top.

Wire shapes are dictated verbatim by the daemon contract — confirmed against QMD `pyrycode-docs`
(`internal/protocol/conversations_write.go`, spec #274). The Go structs, field-for-field:

```go
type CreateConversationPayload struct {         // request (client → daemon)
    IsPromoted *bool   `json:"is_promoted"`      // pointer, NO omitempty → key always on wire
    Name       *string `json:"name"`             // null = server default
    Cwd        *string `json:"cwd"`
}
type ConversationCreatedPayload struct {         // reply (daemon → client)
    ID         string    `json:"id"`
    IsPromoted bool      `json:"is_promoted"`
    Cwd        string    `json:"cwd"`
    Name       *string   `json:"name"`            // null = unnamed scratch conversation
    LastUsedAt time.Time `json:"last_used_at"`    // RFC3339 string on the wire
}
```

`CLAUDE.md` no-drift: mirror both structs field-for-field, in declared field order.

## Design

Ten production files, one new. Below, grouped by the two data directions.

### Wire types — `src/shared/wire/types.ts`

- Add `'create_conversation'` and `'conversation_created'` to the `EnvelopeType` union.
- Add two interfaces (clone the `ConversationSummary` doc-comment style):

  ```ts
  export interface CreateConversationPayload {
    is_promoted: boolean | null
    name: string | null
    cwd: string | null
  }
  export interface ConversationCreatedPayload {
    id: string
    is_promoted: boolean
    cwd: string
    name: string | null
    last_used_at: string
  }
  ```

- **The load-bearing subtlety — nullable-and-present, NOT optional.** The daemon's request struct uses
  `*T` *without* `omitempty`, so the key is always on the wire with an explicit `null` (its "take the
  server default" signal). These fields are therefore `T | null` (present, nullable) — **not** `T |
  undefined` (optional/omitted). This is the deliberate opposite of the `Envelope.in_reply_to?`
  convention ("never emit null"): here the daemon contract *requires* `null` on the wire, and no-drift
  wins. Document this in the interface comment so a future maintainer does not "fix" it to `?:`. The
  `conversation_created` `name` is `string | null` exactly like `ConversationSummary.name` (a literal
  `null` = an unnamed scratch conversation, never absent).
- Do **not** reuse `ConversationSummary` for the reply — it carries `is_archived` + `last_message_ts`
  the daemon deliberately does not send on a create reply (spec #274 excludes the reuse).

### Command (outbound) — `src/shared/ipc/commands.ts`

- Import `CreateConversationPayload`; add `| { type: 'createConversation'; payload:
  CreateConversationPayload }` to `RendererCommand`.
- Add `case 'createConversation': return 'payload' in value && isCreateConversationPayload(value.payload)`
  to `isRendererCommand`.
- Add the guard (structural minimum, three present nullable fields — the check is on TYPE, so `null` is
  accepted as a value and `undefined`/missing is rejected):

  ```ts
  function isCreateConversationPayload(value: unknown): value is CreateConversationPayload
  // requires: is_promoted ∈ {boolean, null}; name ∈ {string, null}; cwd ∈ {string, null}; each key present
  ```

- **No `createConversationCommand` constructor.** Following the `requestSnapshot` precedent (a
  payload-bearing command with no constructor — the render side builds the literal inline, #181/#188),
  #242 constructs `{ type: 'createConversation', payload }` inline. A constructor exists only where the
  main side mints a field (`sendMessage`'s `message_id`, `answerModal`'s `answer_token`); there is no
  mint here.

### Builder (outbound) — `src/main/transport/createConversationEnvelope.ts` (NEW)

- Clone `sendMessageEnvelope.ts` / `requestSnapshotEnvelope.ts` verbatim: a
  `CreateConversationInput { id, ts, payload: CreateConversationPayload }` and
  `buildCreateConversation(input): Uint8Array` that wraps `input.payload` in a `create_conversation`
  Envelope and `encodeEnvelope`s it. MAIN-PROCESS ONLY (imports `codec.ts`, `Buffer`); never re-export
  through a renderer barrel. The header comment mirrors the sibling builders' "MAIN-PROCESS ONLY … raw
  bytes stay out of the web layer."
- `JSON.stringify` preserves the explicit `null` values and keeps the keys, so a payload with all-null
  fields serializes to `{"is_promoted":null,"name":null,"cwd":null}` — exactly the daemon's own
  encoding. No special null handling in the builder; the fresh-literal that bounds the field set lives
  in the connection method (below).

### Connection method (outbound) — `src/main/daemonConnection.ts`

- Import `buildCreateConversation` and `CreateConversationPayload`.
- Add `createConversation(payload: CreateConversationPayload): void` to the `DaemonConnection`
  interface (doc-comment cloned from `requestSnapshot`: the `send` twin — inert no-op when not
  connected, never throws out of the module; the reply arrives asynchronously as one
  `conversationCreated` event).
- Implement it as an `answerModal` clone (the security-relevant difference from a plain `send`):
  `if (driver === null) return`, then inside `try`, **build a fresh literal** naming exactly the three
  modeled fields — `{ is_promoted: payload.is_promoted, name: payload.name, cwd: payload.cwd }` — pass
  it to `buildCreateConversation`, advance `nextEnvelopeId` only on a successful build,
  `driver.sendMessage(bytes)`, and swallow any throw in the `catch` (classify-don't-forward). The
  fresh literal is the deterministic net (see Error handling / security): it guarantees exactly the
  three fields cross the Noise boundary regardless of what the structural-minimum guard let through —
  no spread of the untrusted `payload`.
- Add `createConversation` to the returned object literal (alongside `requestConversations`,
  `answerModal`).
- Add the emit case in `onDriverEvent`'s inner `switch (inbound.kind)` — `case 'conversation-created':`
  → `emitDaemonEvent(sink, { type: 'conversationCreated', conversation: inbound.conversationCreated })`.
  Verbatim passthrough (the `conversations` precedent): `parseConversationCreatedPayload` already
  returns a fresh 5-field object with nothing to drop, so no re-construction is needed at emit.

### Inbound decode (inbound) — `src/main/transport/inboundMessage.ts`

- Import `ConversationCreatedPayload`; add `| { kind: 'conversation-created'; conversationCreated:
  ConversationCreatedPayload }` to `InboundDaemonMessage`.
- Add `parseConversationCreatedPayload(payload): ConversationCreatedPayload` — clone
  `parseConversationSummary` for the five fields: `requireString('id')`, `requireBoolean('is_promoted')`,
  `requireString('cwd')`, `requireStringOrNull('name')`, `requireString('last_used_at')`. Fail-closed;
  unknown server keys tolerated but not copied; category-only error messages (a `name`/`cwd` could echo
  a title or workspace path). `name: null` is a valid value (AC); a missing/mistyped field throws.
- Add `case 'conversation_created':` to the main `switch (envelope.type)`: narrow BEFORE logging (so a
  malformed frame throws first and leaves no record), emit the content-free diagnostic record
  `{ event: 'inbound-decoded', code: 'conversation_created', bytes, hash }` (reuse the existing field
  set — no new `DiagnosticEvent` field, so #131's renderer pin is untouched; deliberately no `count`),
  return `{ kind: 'conversation-created', conversationCreated }`.

### Event arm (inbound) — `src/shared/ipc/events.ts`

- Import `ConversationCreatedPayload`; add `| { type: 'conversationCreated'; conversation:
  ConversationCreatedPayload }` to `DaemonEvent`. Reuse the wire type verbatim (the
  `conversationsReceived` / `messageReceived` precedent) — nothing to drop, no secret field
  (`ConversationCreatedPayload` carries an id, two flags/strings, a nullable title, a workspace path,
  and a timestamp; `cwd` is opaque display text, same class as `ConversationSummary.cwd`). Consumer is
  the render ticket #242, not the session store — so every exhaustive consumer no-ops it here.
- **Carry the untrusted-display-text warning forward in the arm's doc-comment** (the modal/tool-arm
  convention): `name` and `cwd` are daemon-supplied strings the render slice #242 must render as plain
  text, **never HTML** (no `innerHTML` / `dangerouslySetInnerHTML`). This ticket has no DOM sink, but
  the comment is where #242's developer inherits the constraint — do not drop it.

### Routing + exhaustive consumers (AC6)

- `src/main/index.ts` — add `case 'createConversation': connection.createConversation(command.payload);
  return` to the `onCommand` switch (mirrors `requestSnapshot`).
- `src/renderer/src/store/daemonEventBridge.ts` — add `case 'conversationCreated': return null` (no
  session-store action; #242 consumes it) before `default: assertNever`.
- `src/renderer/src/store/timelineBridge.ts` and `modalBridge.ts` — add `case 'conversationCreated':`
  to each existing null fall-through list (before `assertNever`). One line each.
- `conversationListBridge.ts` is **not** touched (`default: null`).

## State + concurrency model

No new store, no new async task. The outbound path is synchronous (`createConversation` runs to
completion with no `await`, sharing the single-writer `nextEnvelopeId` counter — no check-then-act
race, matching every sibling method). The inbound path is the existing driver `message` event →
`parseInboundMessage` → `emitDaemonEvent` choke point; the new arm adds one `kind` and one emit case.
Reply correlation (`in_reply_to`) exists on the wire but is out of scope — the app hosts one active
conversation, so the event is emitted unconditionally on decode (the `conversations` / `screen_snapshot`
precedent). Teardown is unchanged: a `createConversation` arriving while disconnected is an inert no-op
(`driver === null`); a socket drop mid-request produces no reply and no hang (there is no consumer to
resolve, unlike the debug-bundle path).

## Error handling

- **Outbound, malformed command:** dropped at the `isRendererCommand` boundary in `receiveCommand`
  (`console.warn` fixed string, never renderer data) — never forwarded (AC2).
- **Outbound, over-cap / driver throw:** `buildCreateConversation` may throw `WireEncodeError` and
  `driver.sendMessage` may throw; the method's `catch` drops the caught object (classify-don't-forward)
  and the send is dropped — never throws out of the module (parity #490).
- **Outbound, field smuggling (security net):** the guard is a structural minimum and tolerates extra
  keys; the connection method's **fresh literal** (not a spread of `payload`) is the deterministic
  belt-and-suspenders net that bounds the wire to exactly `is_promoted` / `name` / `cwd`. Different
  fabric from the stochastic-ish guard, per the pipeline principle — and the established #236 posture
  for a security-sensitive outbound frame from the untrusted renderer.
- **Inbound, malformed reply:** `parseConversationCreatedPayload` fails closed — throws
  `WireDecodeError`, caught by `onDriverEvent`'s `message` catch, the frame dropped (no event, no
  throw). A partial event is never emitted (AC5). Category-only messages; no field value is
  interpolated.
- **Inbound, unknown type:** unchanged `default` branch — logged content-free, returns `null`, not
  surfaced.

## Testing strategy

`npm test` (vitest), plain function tests with fakes — no Electron harness. Scenarios (bullet form; the
developer writes them in the project idiom, cloning the cited test files):

- **`types.test.ts` — round-trip both shapes (AC7).** Add a `describe('conversations-write wire
  vocabulary (#241)')`: a `create_conversation` Envelope with all-null fields round-trips through
  `encodeEnvelope`/`decodeEnvelope` preserving the three explicit `null`s (and a populated variant); a
  `conversation_created` Envelope round-trips including `name: null` and a populated `name`.
- **`commands.test.ts` — boundary guard (AC2).** `isRendererCommand` accepts `{ type:
  'createConversation', payload: { is_promoted: null, name: null, cwd: null } }` and a fully-populated
  variant; rejects missing `payload`, `payload: null`, a wrong-typed field (`is_promoted: 'yes'`,
  `name: 3`), and a missing key.
- **`createConversationEnvelope.test.ts` (NEW) — builder (AC3/AC7).** `buildCreateConversation`
  round-trips to a `create_conversation` envelope carrying the exact id, ts, and payload (null fields
  preserved); throws `WireEncodeError` past the plaintext cap (clone `requestSnapshotEnvelope.test.ts`).
- **`inboundMessage.test.ts` — decode (AC5/AC7).** A valid `conversation_created` frame → `{ kind:
  'conversation-created', conversationCreated }` with the five fields (incl. `name: null`); each
  missing/mistyped field throws `WireDecodeError`; a non-object payload throws; assert the diagnostic
  record is content-free (`code: 'conversation_created'`, no decoded field) when a fake logger is
  injected.
- **`daemonConnection.test.ts` — method + emit (AC4/AC5).** `createConversation(payload)` while
  connected calls `driver.sendMessage` with a `create_conversation` envelope carrying exactly the three
  fields (assert a smuggled extra field on the input does **not** cross — the fresh-literal net); while
  not connected (`driver === null`) it is a no-op and never throws; a decoded `conversation_created`
  inbound frame emits exactly one `conversationCreated` DaemonEvent carrying the summary; a malformed
  inbound frame emits nothing.
- **Type-level (AC6):** `npm run typecheck` — the three `assertNever` bridges fail to compile until each
  has a `conversationCreated` case; that compile error IS the coverage. `npm run build` is the salvage
  gate (the modalBridge "3rd bridge → build-only error" lesson from #229 — run build before the PR).

## Scope self-check — why 10 production files is still `size:s`

This trips the "≥5 production files" commit-gate on raw count, so here is the explicit,
non-rationalized justification (a structural codebase fact, not a "mechanical edits" escape):

- **The ≥5 floor is unavoidable for *any* new `DaemonEvent` arm.** Adding one arm forces the three
  exhaustive `assertNever` bridges (`daemonEventBridge`, `timelineBridge`, `modalBridge`) + the emit
  site + `events.ts` + `inboundMessage.ts` + `types.ts` to change **in the same commit** — the
  `assertNever` guards make a missing case a compile error (the salvage gate `npm run build` fails).
  These are compile-time **atomic**: they cannot be split into a separate ticket without shipping a
  child that does not build. A hypothetical inbound-only split still touches 7 files and still trips
  the floor — the split does not help, it only produces a child that also "fails" the gate. The floor
  is a proxy for edit fan-out; here four of the ten edits are additive one-line no-op cases with zero
  per-site reasoning.
- **Empirical precedent in this exact codebase.** The identical single-verb transport footprint shipped
  at `size:s` within budget four times: #139 (conversations-read round-trip, PR #209 — the direct
  read-side twin of this write-side slice), #180 (snapshot, PR #185), #201 (modal decode, PR #228),
  #229 (tool_result, PR #232). None hit `max_turns`.
- **Step-1 red lines all clear:** new files 1 (≤3); total projected LOC ~185 production + ~210 tests ≈
  **395** (≤600); new exported types 2 (≤5); simultaneous consumer call sites 4 additive one-liners
  (≤10); reject branches ~6 (≤10). The only nominal trip is the 7-AC count, which is layered-transport
  documentation granularity (one verb, seven layer checkboxes) — the read-side twin #139 validated the
  same at 8 AC / `size:s`.

Decision: **one `size:s` ticket**, as PO refined it. The verb is single; the file count is the
codebase's exhaustiveness-guard tax, not separable work.

## Open questions

- **`name`/`cwd` populated-value fixtures.** Tests use a placeholder id/cwd; no coordination needed —
  the daemon is the source of truth for values, and the desktop carries them opaquely.
- **`in_reply_to` correlation** is deferred (out of scope per the ticket) — if a future multi-request
  world needs it, it is an additive Envelope-field read, not a reshape of this slice.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No MUST FIX — two explicit, named, fail-closed boundaries: `isCreateConversationPayload`
  (`src/shared/ipc/commands.ts`, renderer→main IPC) and `parseConversationCreatedPayload`
  (`src/main/transport/inboundMessage.ts`, daemon→main). Downstream holds parsed types only; the
  connection method's fresh literal (not a spread) bounds the outbound wire to exactly three fields even
  if the structural-minimum guard tolerates extras.
- [Trust boundaries / Logs] SHOULD FIX (addressed inline) — inbound `name` / `cwd` / `id` are untrusted
  daemon-supplied strings. The `events.ts` arm doc-comment now carries the plain-text-never-HTML warning
  forward so the render ticket #242 inherits the DOM-sink constraint (this ticket has no DOM sink). The
  parse errors and diagnostic record are content-free (category-only messages; `code`/`bytes`/`hash`
  only, no decoded field, no `count`).
- [Tokens/secrets] No findings — this verb mints and carries no token/credential (unlike the #236
  modal-answer `answer_token`). No RNG, storage, rotation, or revocation surface introduced.
- [File/storage] No findings — the desktop never resolves `cwd` (a path-shaped string) into an `fs.*`
  call; it is carried as opaque display text in both directions (the #139 posture). Server-side `cwd`
  resolution/validation is the daemon's concern (#666).
- [Electron attack surface] No findings — one command member added on the existing `pyry:command`
  channel, validated at the boundary, minimal three-field shape (no capability). No new
  window / preload / contextBridge surface. `createConversationEnvelope.ts` is MAIN-PROCESS ONLY, never
  re-exported to a renderer barrel; keys/sockets/raw frames stay out of the window (CLAUDE.md).
- [Cryptographic primitives] No findings — no new crypto/RNG; the `create_conversation` frame rides the
  existing vetted Noise session's AEAD framing via `driver.sendMessage`.
- [Network & I/O] No findings — inbound size-capped by the `MAX_PLAINTEXT_BYTES` guard before decode;
  outbound bounded by `WireEncodeError`. No new socket, dial, timeout, or reconnect logic. Malformed /
  oversized `conversation_created` from a hostile daemon fails closed.
- [Concurrency] No findings — synchronous method sharing the single-writer `nextEnvelopeId`, no `await`
  between guard and send (no check-then-act race), no new listener / timer / long-lived task. Inert when
  disconnected; a mid-request socket drop yields no reply and no hang (no consumer to resolve).
- [Threat model alignment] OUT OF SCOPE (named) — a content-blind on-path relay cannot forge inside the
  Noise session; a frame flood is bounded like every other inbound-event arm. A compromised renderer's
  blast radius is daemon-validated conversation creation with no key/token/socket reach (identical to
  `send_message`); the paired-client trust model is upstream (`pyrycode` ADR 025), not this ticket.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-10
