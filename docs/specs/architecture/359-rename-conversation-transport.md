# #359 — Outbound `rename_conversation` wire command (transport)

**Size:** S. Ships **dormant**: fully tested, no consumer. The Rename dialog (#360) is its first caller.

**Shape:** field-for-field clone of the `unarchive_conversation` / `promote_conversation` outbound verbs (#346 / #273) across five mirror sites, with a **two-field** payload `{ conversation_id: string, name: string }` (both required strings — promote's shape **minus `cwd`**, deliberately not a reuse of `PromoteConversationPayload`). No inbound decode change. No UI. No new dependency.

---

## Files to read first

Read the two live precedents end-to-end first — this ticket clones them verbatim. `unarchive_conversation` (#346) is the closest structural twin (single-required-string builder + method + fresh literal); `promote_conversation` (#273) is the closest **guard** twin (a multi-required-string boundary guard). Rename = unarchive's plumbing with promote's two-field guard, minus `cwd`. Every "new" artifact has a direct twin below; match its shape, comments, and security posture.

- `src/main/transport/unarchiveConversationEnvelope.ts:1-46` — **the builder to clone.** `buildUnarchiveConversation({ id, ts, payload }) → encodeEnvelope`. Copy wholesale; rename to `rename`, swap the payload type to `RenameConversationPayload`, keep the "required value-strings, no explicit-`null` concern" prose (now two fields). Note the main-process-only banner (it imports the codec / Node `Buffer`).
- `src/main/transport/unarchiveConversationEnvelope.test.ts:1-32` — **the test to clone.** Two cases: round-trip (`type`/`id`/`ts`/`payload`) against the REAL codec, and over-cap → `WireEncodeError`. Reuse `MAX_PLAINTEXT_BYTES` for the over-cap fixture (put the padding on either field).
- `src/shared/wire/types.ts:40-79` — the `EnvelopeType` union; add `'rename_conversation'` beside `'unarchive_conversation'` (line 76).
- `src/shared/wire/types.ts:569-604` — `PromoteConversationPayload` (582-586) + `UnarchiveConversationPayload` (602-604) interfaces and their doc blocks. `RenameConversationPayload` mirrors promote's **required-string** shape but with only two fields (`conversation_id`, `name` — no `cwd`). `MAX_PLAINTEXT_BYTES = 65519` is at line 30.
- `src/main/daemonConnection.ts:200-211` — the `promoteConversation` (200) / `unarchiveConversation` (211) **interface declarations** on `DaemonConnection`; clone the JSDoc, trimming to two fields. Line 36-37 (builder imports), 60-61 (payload type imports), 919-947 (`promoteConversation` method — the two-plus-field literal to clone), 949-974 (`unarchiveConversation` method — the simplest twin), 1140-1141 (the return-object export list).
- `src/main/daemonConnection.ts:919-947` — **the connection method to clone** (`promoteConversation`). `driver === null` early return; fresh literal naming exactly the modeled fields (NEVER a spread of `payload`); shared `nextEnvelopeId`; `try/catch` that swallows all throws. This is the anti-smuggling net — preserve it exactly, with two fields (`conversation_id`, `name`) instead of three.
- `src/shared/ipc/commands.ts:80-92` — the `RendererCommand` union; add the `renameConversation` member (after `unarchiveConversation`, line ~89). Lines 173-176 (`isRendererCommand` cases for promote/unarchive), 257-284 (`isPromoteConversationPayload` 264-274 / `isUnarchiveConversationPayload` 281-284 guards — **clone the promote guard, drop the `cwd` check**), 18-28 (the wire-type import block).
- `src/main/index.ts:287-300` — the `promoteConversation` (287) / `unarchiveConversation` (294) dispatch arms; clone one for the new `renameConversation` arm. The `onCommand` switch is **not** compile-exhaustive (the callback returns `void`, no `assertNever`), so a missing arm is a **silent drop**, not a type error — do not forget this site.
- `src/shared/ipc/commands.test.ts:326-379` — the `isRendererCommand` guard-test blocks for promote (326-357) and unarchive (359-379); mirror the **promote** block for rename (two-field accept + per-field reject table).
- `src/main/daemonConnection.test.ts:2206-2372` — the `promoteConversation` (2206) / `unarchiveConversation` (2308) describe blocks; mirror the **unarchive** block for rename (no-op-before-start, forwards-one-envelope, shared-id-counter, no-throw-on-driver-throw, strips-smuggled-extra).
- `src/main/transport/codec.ts:42,112,127` — `WireEncodeError` (42), `encodeEnvelope` (112), `decodeEnvelope` (127). The builder calls `encodeEnvelope`; the test calls `decodeEnvelope` + asserts `WireEncodeError`.
- `docs/knowledge/decisions/0002*` (if present) — the wire-drift rule: `RenameConversationPayload` mirrors the daemon's `RenameConversationPayload{ConversationID, Name string}` (pyrycode#820) field-for-field (JSON keys `conversation_id`, `name`, both required, no `omitempty`); do not drift.

**Daemon SSOT (cross-repo, read-only reference — do not cite as desktop paths):** `pyrycode-docs/knowledge/codebase/820.md`, `pyrycode-docs/specs/architecture/820-rename-conversation-wire-message.md`. Confirmed: two-field `{conversation_id, name}`, both required value-strings, wire order `conversation_id, name`, **no `cwd`**; the empty-title guard is **daemon-side** (`strings.TrimSpace(Name) == ""` leaves the stored name untouched); no title-length cap daemon-side.

---

## Context

The daemon shipped `rename_conversation` (client→daemon) in pyrycode/pyrycode#820 (merged): a verb carrying a conversation id + a new name that updates the conversation's stored name via a single locked `Registry.Update`, persists eagerly, and confirms by **replying to the requesting client** with a `conversation_updated` record (correlated by `in_reply_to`). Desktop has no outbound path yet.

This is the **transport half** of the "Rename dialog + transport wiring" split from #154 (the dialog + affordance is #360, which consumes this verb and owns the list-reflection AC) — sliced off because it is main-process, security-sensitive wire code (different fabric from the renderer chrome, per the pipeline's belt-and-suspenders rule). It ships **dormant**, exactly like `unarchive_conversation` (#346) shipped ahead of its restore-row caller (#348).

**Non-reuse guard (from the daemon, load-bearing):** rename is **not** a `promote_conversation` with a blank `cwd`. Daemon #820 makes `RenameConversationPayload` an explicit non-reuse of `PromoteConversationPayload` — promote carries a third required `cwd`, which a rename neither has nor means. The desktop payload must mirror this: two fields, no `cwd`. Do **not** "helpfully" fold rename into the promote payload.

**No inbound change.** The reply is `conversation_updated`, which desktop **already** decodes (#273) and reacts to by re-requesting the conversation list (#275). So the list reflection comes free downstream — but it is **#360's AC, not this ticket's.** This slice is outbound-only: no decode edit, no store edit, no UI. (Note the daemon replies *correlated* here, vs promote's *unsolicited broadcast* — irrelevant to desktop, which decodes `conversation_updated` the same way regardless of correlation and does not correlate it here.)

**Thread has no title surface.** Renaming a conversation does not need to "reflect in the thread" — the thread chrome draws no conversation title. That reflection concern is out of scope for the whole #154 line, not deferred.

---

## Design

Five mirror sites. Only site 2 (the builder) carries real logic; the rest are one-line registrations. Each has a named twin — clone it, don't invent. The **plumbing** (builder, method, dispatch) clones `unarchive_conversation` (#346); the **two-field guard** clones `promote_conversation` (#273) minus `cwd`.

### Site 1 — `src/shared/wire/types.ts` (wire contract)

- Add `'rename_conversation'` to the `EnvelopeType` union (beside `'unarchive_conversation'`, line 76).
- Add the payload interface mirroring `PromoteConversationPayload` but with two fields:

  ```ts
  export interface RenameConversationPayload {
    conversation_id: string
    name: string
  }
  ```

- Doc block (mirror the `PromoteConversationPayload` block, trimmed to two fields): outbound `rename_conversation` request body (client → daemon); mirrors the daemon's `RenameConversationPayload{ConversationID, Name string}` (pyrycode#820) field-for-field, wire order `conversation_id, name`. **Both required value-strings** — the same posture as promote (no pointer, no `omitempty`), but with **no `cwd`** (the deliberate non-reuse of `PromoteConversationPayload`; #820). `conversation_id` is a routing id (an existing row's id), not a secret, never resolved into a filesystem path; `name` is renderer-supplied display text that becomes the conversation's stored name **server-side** — the desktop never resolves it anywhere. An empty/whitespace `name` is a valid string on the wire (the daemon's own trim-guard leaves a blank rename's stored name untouched); do **not** add a client-side emptiness check. CLAUDE.md no-drift: change only alongside a daemon/mobile change.

### Site 2 — `src/main/transport/renameConversationEnvelope.ts` (new) + `.test.ts` (new)

Clone `unarchiveConversationEnvelope.ts`. Contract:

```ts
export interface RenameConversationInput { id: number; ts: string; payload: RenameConversationPayload }
export function buildRenameConversation(input: RenameConversationInput): Uint8Array
```

- Body: construct the `Envelope` literal (`type: 'rename_conversation'`, the four envelope fields — `id`, `type`, `ts`, `payload`), return `encodeEnvelope(envelope)`. One statement — do not add validation, clock reads, or a counter (all injected; the builder stays pure, exactly like `buildUnarchiveConversation` / `buildPromoteConversation`).
- **Main-process only.** It imports `./codec` (Node `Buffer`). Keep the file banner asserting it must never be re-exported through a renderer barrel. Two required strings, so — like promote/unarchive — there is no explicit-`null` preservation concern; the payload serializes verbatim.
- MAY throw `WireEncodeError` when the serialized envelope exceeds `MAX_PLAINTEXT_BYTES`; the sole caller (`connection.renameConversation`) catches it.

### Site 3 — `src/main/daemonConnection.ts` (connection method)

- Import `buildRenameConversation` (beside the other transport-builder imports, line ~37).
- Add `RenameConversationPayload` to the wire-type import block (line ~61).
- Add the interface declaration on `DaemonConnection` (clone the `unarchiveConversation` JSDoc at 202-211, adjusted to two fields): a payload-carrying `rename_conversation` control envelope; the `send` twin — inert no-op when `driver === null`; fire-and-forget — no reply correlated or awaited here (the daemon's confirming `conversation_updated` reply flows through the existing decode + re-list, picked up by #360, not correlated here); NEVER throws out of the module (parity #490); caller is #360.
- Add the method body (clone `promoteConversation` at 919-947 — the two-plus-field-literal shape): `driver === null` early return; build a **fresh literal** naming exactly `conversation_id` and `name` (never a spread of `payload` — the deterministic anti-smuggling net that bounds the wire to exactly the two modeled fields, ignoring any renderer-smuggled extra the structural-minimum guard let through); share the one monotonic `nextEnvelopeId` (advance only on a successful build); `driver.sendMessage(bytes)`; `try/catch` that DROPS the caught object (classify-don't-forward — its message could echo the payload, including `name`; no log, no event).
- Add `renameConversation` to the returned connection object's export list (line ~1141).

### Site 4 — `src/shared/ipc/commands.ts` (renderer→main command boundary)

- Add `RenameConversationPayload` to the wire-type import block (line ~18-28).
- Add the union member (after `unarchiveConversation`, line ~89): `| { type: 'renameConversation'; payload: RenameConversationPayload }`.
- Add the `isRendererCommand` case **in lockstep** with the union member (a missing case silently drops the command at the boundary):

  ```ts
  case 'renameConversation':
    return 'payload' in value && isRenameConversationPayload(value.payload)
  ```

- Add the guard, **cloning `isPromoteConversationPayload` (264-274) and dropping the `cwd` check**: both `conversation_id` and `name` must be present-and-string; accepts extra/unknown fields (structural minimum); rejects a missing / non-string / `null` field; pure, never throws. The guard checks **type, not emptiness** — an empty-string `name` passes (a valid wire value; the daemon's trim-guard and #360's Save-disable handle blank).

  ```ts
  function isRenameConversationPayload(value: unknown): value is RenameConversationPayload {
    if (typeof value !== 'object' || value === null) return false
    return (
      'conversation_id' in value &&
      typeof value.conversation_id === 'string' &&
      'name' in value &&
      typeof value.name === 'string'
    )
  }
  ```

  Note: no constructor helper (like `sendMessageCommand`) is required by the ACs — #360 builds the command literal directly, and the union return type is the compile-time guarantee. Omit it here; add one in #360 only if that spec asks.

### Site 5 — `src/main/index.ts` (command dispatch)

- Add a `case 'renameConversation'` to the `onCommand` switch → `connection.renameConversation(command.payload)`. Clone the `unarchiveConversation` arm (294-300): direct to the connection method, no orchestrator — a fire-and-forget request has no consumer/reassembler. Comment: sends `rename_conversation`; the daemon confirms by replying with a `conversation_updated` record, decoded by the existing path and reflected in the list by #275 (consumed by #360), not correlated here; inert no-op when not connected.
- **This switch is not compile-exhaustive** (the callback returns `void`). Adding the union member in site 4 will **not** produce a type error if this arm is forgotten — the command would silently drop at dispatch. Landing this arm is a discipline requirement, not a compiler-enforced one.

---

## State + concurrency model

- **No new store, no new state.** Transport-only. The single `nextEnvelopeId` counter in `daemonConnection.ts` is shared (as `promoteConversation` / `unarchiveConversation` / `send` / `requestSnapshot` share it) — one monotonic id space so the daemon's id-based correlation stays unique across interleaved calls. The counter is single-writer (no `await` between read and increment inside the synchronous method body), so no check-then-act race.
- **Fire-and-forget, no correlation memory.** Unlike `setSessionSettings` (`pendingSettings` map) or `answerModal` (`outstandingAnswers` FIFO), this verb leaves nothing dangling: it registers no pending entry, so a reconnect's `dial()` reset (`nextEnvelopeId = 2`) is automatically safe — there is nothing to clear. Mirrors `unarchiveConversation` / `promoteConversation`. (The daemon *does* reply correlated, but the desktop does not await or match that reply — it flows through the unsolicited-event decode path like every `conversation_updated`.)
- **Teardown:** inherited. A command arriving while disconnected (`driver === null`) is an inert no-op; a socket drop mid-send is swallowed by the `try/catch`. No new listener, timer, or `AbortController`.

## Error handling

| Layer | Failure mode | Result |
|---|---|---|
| Renderer→main boundary | missing payload, missing / non-string / `null` `conversation_id` or `name` | `isRendererCommand` returns false → command dropped at `onCommand` before dispatch (no throw) |
| Builder | serialized envelope > `MAX_PLAINTEXT_BYTES` | throws `WireEncodeError` |
| Connection method | over-cap (`WireEncodeError`) or any `driver`/wasm throw | caught, object DROPPED (classify-don't-forward), no log, no event, `nextEnvelopeId` not consumed |
| Connection method | not connected (`driver === null`) | inert early return (no-op) |

An empty/whitespace `name` is **not** an error at any client layer — it is a valid wire string; the daemon's trim-guard leaves the stored name untouched, and #360 disables Save on blank. No new UI surface: a dropped/failed send produces no reply and no banner; the daemon's `conversation_updated` confirmation, when it arrives, flows through the existing decode path and #275's re-list (out of scope here).

## Testing strategy

Unit tests only (`npm test`, vitest), against the REAL codec.

**Builder — `renameConversationEnvelope.test.ts` (new), mirror `unarchiveConversationEnvelope.test.ts`:**
- **Round-trip:** `decodeEnvelope(buildRenameConversation({ id, ts, payload }))` asserts `type === 'rename_conversation'`, `id`, `ts`, and `payload` deep-equals `{ conversation_id, name }`. Pins the actual wire bytes.
- **Over-cap:** a `name` (or `conversation_id`) of `'x'.repeat(MAX_PLAINTEXT_BYTES + 1)` → `buildRenameConversation(...)` throws `WireEncodeError`.

**Connection method — extend `daemonConnection.test.ts`, mirror the `unarchiveConversation` describe block (2308-2372):**
- No-op before `start()` (no driver, nothing forwarded, no throw — the send twin).
- After handshake-complete, forwards one `rename_conversation` envelope carrying `id` 2, `ts`, and `payload === { conversation_id, name }`.
- Shares the one envelope-id counter with `send` (no second counter).
- Does not throw out of the module when the driver's `sendMessage` throws (parity #490).
- Strips a smuggled extra field — the sent payload is exactly the two modeled fields (fresh-literal net); assert `JSON.stringify(payload)` does not contain the smuggled key.

**Boundary guard — extend `commands.test.ts`, mirror the `promoteConversation` guard block (326-357):**
- Accepts a well-formed `{ conversation_id: string, name: string }` (and one carrying an extra field — structural minimum).
- Rejects a missing / `null` payload.
- Rejects per-field: `name` non-string, `conversation_id` `null`, either key missing.
- Accepts `name: ''` (empty string is a valid wire value — the guard checks type, not emptiness; this pins that the guard does not over-reject).

Type coverage: `npm run typecheck` — the exhaustive `isRendererCommand` switch is compile-forced against the grown union (a missing case is a coverage signal there). The `onCommand` dispatch switch is **not** compile-exhaustive, so its arm is covered by the connection-method tests exercising the path, not by the type system. `npm run build` is the salvage/QA gate.

## Scope & sizing note

Exactly **5 production `.ts` files** (types, builder, connection, commands, index) — the irreducible atomic minimum for one outbound wire verb, the same footprint every simple verb has shipped at S on this pipeline: `unarchive_conversation` (#346, PR#357), `promote_conversation` (#273), `create_conversation` (#241), `dequeue_message` (#300). The slice is **compile-time atomic**: the interface declaration + method + returned-object export in `daemonConnection.ts` must land together (or it does not typecheck), the union member + guard in `commands.ts` must land together (or the boundary silently drops), and the builder is consumed by the method — splitting smaller was proven unsatisfiable for this verb family (#241/#273/#346), and only the two-frame `modal_answer` was ever split (#235/#236) because it was genuinely bigger (token minting + ADR 0009 correlation).

The 5-file count is dictated by the codebase's own **one-concern-per-file** convention (every builder is its own file: `sendMessageEnvelope`, `createConversationEnvelope`, `promoteConversationEnvelope`, `unarchiveConversationEnvelope`), which this pipeline requires architects to respect; folding the builder inline to shave a file would violate it and defeat AC2's "unit-tested pure builder." Total written work is **~155 LOC** (≈46 builder + ≈32 builder test + ≈27 types + ≈15 commands + ≈40 connection + ≈7 dispatch, plus ≈20 guard-test + ≈65 method-test additions), well under the 600-LOC total red line; 3 new exported symbols (`RenameConversationPayload`, `RenameConversationInput`, `buildRenameConversation`), well under 5; zero consumer cascade (the union member is additive — no existing call site changes); two guard branches, no state machine. This is **strictly simpler than #273** (two required fields vs three) and one field richer than #346 (which shipped S). Not split.

## Open questions

- None blocking. If #360's spec later needs a pure `renameConversationCommand(fields)` constructor (parity with `sendMessageCommand` / `dequeueMessageCommand`), add it in #360 or as a trivial follow-up — omitted here because no AC requires it and the renderer can build the literal directly under the union's compile-time guarantee.

---

## Security review

**Verdict:** PASS

**Findings:**

- **[1. Trust boundaries]** No new MUST-FIX. This spec adds exactly one untrusted→trusted crossing: the renderer→main IPC `renameConversation` command, riding the **existing** `COMMAND_CHANNEL` (`pyry:command`) / `onCommand` receiver. It is guarded by `isRenameConversationPayload` at the `isRendererCommand` boundary (co-located with the union so the two evolve in lockstep — a missing case would silently drop, not mis-accept), and re-bounded a second time by the connection method's **fresh-literal** construction (names only `conversation_id` and `name`, never a spread of `payload`), so a renderer-smuggled extra field that passes the structural-minimum guard still cannot reach the wire. Two-layer defense, identical to #273/#346. Downstream holds the typed `RenameConversationPayload` only.
- **[2. Tokens, secrets, credentials]** N/A — the payload is a `conversation_id` routing id (an existing row's id) + a `name` display string, neither a token/key/credential. No token generated, stored, logged, or compared. The `RendererCommand` union by construction exposes no field that could hold a secret (AC5); this member reuses only the wire payload type, adding no secret-bearing surface.
- **[3. File / storage operations]** N/A — no filesystem path is constructed. `conversation_id` is a routing key inside the Noise session; `name` becomes the conversation's stored name **server-side** and is never concatenated into a desktop path, never resolved, never written to disk by this slice (the same posture as #273's `cwd` note). No disk write, no TOCTOU, no atomic-write concern client-side. (The daemon's own persistence — a single locked `Registry.Update` + eager `Save`, no find-then-read TOCTOU — is server-side and out of scope.)
- **[4. Inter-process / Electron attack surface]** No findings — no `webPreferences` change, no new `contextBridge` API, no new custom protocol / deep link. The command adds one validated member to the allowlisted, already-minimised `onCommand`/`ipcMain` surface; every argument is validated (the guard) before use. Process placement is preserved: the builder + codec + `driver.sendMessage` live in main; no key, socket, or raw frame is introduced in the renderer (AC6-equivalent MUST-FIX category — clean). Note the one behavioural nuance vs the exhaustive `isRendererCommand` switch: the `index.ts` `onCommand` dispatch switch is **not** compile-exhaustive, so a forgotten dispatch arm fails **safe** (the command is dropped, never mis-routed) — a correctness gap the tests cover, not a security hole.
- **[5. Cryptographic primitives]** N/A — no RNG, no key/nonce handling, no comparison against a secret. The envelope is encrypted onto the live Noise session by the unchanged `driver.sendMessage`; this slice hands it plaintext bytes and touches no crypto. The shared `nextEnvelopeId` is an application-level correlation counter, not a Noise nonce (Noise nonces are the driver's per-direction counters, untouched here) — no `(key, nonce)` reuse introduced.
- **[6. Network & I/O]** No findings — no new socket, URL, or frame-size surface. The builder enforces the `MAX_PLAINTEXT_BYTES` cap (throws `WireEncodeError`, caught and dropped by the caller), inheriting the existing outbound size discipline; an unbounded renderer-supplied `name` cannot produce an unbounded frame (it is capped at the plaintext ceiling, over-cap → dropped, no partial send). The relay `maxPayload` / timeouts are unchanged and out of scope. No title-length cap is added client-side — the daemon does not cap either (#820, evidence-based deferral), and the plaintext cap is the operative bound.
- **[7. Error messages, logs, telemetry]** No findings — the connection method's `try/catch` DROPS the caught object (classify-don't-forward, inherited #62): no log call, no event, so a codec error message cannot echo the payload — in particular the user-content `name` — to a sink. No `console.*`. Consistent with the module's content-free-by-construction posture (#128). `name` is user content and MUST-NOT-log; it is never logged here (there is no log call on this path at all), and `conversation_id` is a non-secret routing id.
- **[8. Concurrency]** No findings — the method is synchronous (no `await` between the `nextEnvelopeId` read and increment → single-writer, no check-then-act race), launches no long-lived task, registers no timer/listener/`AbortController`, and leaves no correlation memory to leak (fire-and-forget, unlike `setSessionSettings`/`answerModal`). Reconnect's `dial()` reset is automatically safe. Duplicate-connection / single-live-transport invariants are inherited unchanged.
- **[9. Threat model alignment]** Addressed. **Hostile daemon response:** out of scope by design — this is outbound-only; the confirming `conversation_updated` reply flows through the existing defensively-parsed decode path (#273), unchanged, and is not correlated here (#360/#275 pick up the new name from the re-list). **Renderer compromise reaching transport:** stopped at the two-layer boundary above — a compromised renderer can at most request a rename of an arbitrary `conversation_id` to an arbitrary `name` string it can already see; it gains no key, socket, or raw-frame access, and the daemon authorizes the operation server-side within the paired session. **Malicious/compromised relay:** content-blind and unaffected — this changes only the plaintext inside the existing Noise session; the relay sees an opaque frame. No new plaintext-leak or hang vector.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-14
