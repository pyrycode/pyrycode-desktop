# #346 — Outbound `unarchive_conversation` wire command (transport)

**Size:** S (arguably XS — strictly simpler than the S-sized #273 it clones). Ships **dormant**: fully tested, no consumer. The Archive screen's restore row (#348) is its first caller.

**Shape:** field-for-field clone of the `promote_conversation` outbound verb (#273) across five mirror sites, with the payload reduced to a single `conversation_id: string`. No inbound decode change. No UI. No new dependency.

---

## Files to read first

Read the `promote_conversation` precedent end-to-end first — this ticket clones it verbatim, one field instead of three. Every "new" artifact has a direct twin below; match its shape, comments, and security posture.

- `src/main/transport/promoteConversationEnvelope.ts:1-45` — **the builder to clone.** `buildPromoteConversation({ id, ts, payload }) → encodeEnvelope`. Copy the file wholesale; rename to `unarchive`, swap the payload type, drop the "three required strings" prose for "one required string". Note the main-process-only banner (it imports the codec / Node `Buffer`).
- `src/main/transport/promoteConversationEnvelope.test.ts:1-38` — **the test to clone.** Two cases: round-trip (`type`/`id`/`ts`/`payload`) against the REAL codec, and over-cap → `WireEncodeError`. Reuse `MAX_PLAINTEXT_BYTES` for the over-cap fixture.
- `src/shared/wire/types.ts:52-78` — the Envelope `type` union; add `'unarchive_conversation'` beside `'promote_conversation'` (line 75).
- `src/shared/wire/types.ts:568-585` — `PromoteConversationPayload` interface + its doc block; the `UnarchiveConversationPayload` interface mirrors it but carries only `conversation_id`. Line 30 has `MAX_PLAINTEXT_BYTES = 65519`.
- `src/main/daemonConnection.ts:187-198` — the `promoteConversation` method's **interface declaration** on `DaemonConnection`; clone the JSDoc verbatim, trimming "three fields required" → "one id". Line 36 (builder import), line 59 (`PromoteConversationPayload` type import), line 906-934 (the method body to clone), line 1099 (the return-object export list).
- `src/main/daemonConnection.ts:906-934` — **the connection method to clone.** `driver === null` early return; fresh literal naming only `conversation_id` (NEVER a spread of `payload`); shared `nextEnvelopeId`; `try/catch` that swallows all throws. This is the anti-smuggling net — preserve it exactly.
- `src/shared/ipc/commands.ts:77-88` — the `RendererCommand` union; add the `unarchiveConversation` member (line ~86). Lines 169-170 (the `isRendererCommand` case for promote), 251-268 (`isPromoteConversationPayload` guard), 18-27 (the wire-type import block).
- `src/main/index.ts:287-293` — the `promoteConversation` dispatch arm to clone (line ~294 for the new arm). The `onCommand` switch is exhaustive on the union.
- `src/main/transport/codec.ts:42,112,127` — `WireEncodeError` (line 42), `encodeEnvelope` (112), `decodeEnvelope` (127). The builder calls `encodeEnvelope`; the test calls `decodeEnvelope` + asserts `WireEncodeError`.
- `docs/knowledge/decisions/0002*` (if present) — the wire-drift rule: `UnarchiveConversationPayload` mirrors the daemon's `ArchiveConversationPayload` field-for-field (JSON key `conversation_id`, no `omitempty`); do not drift.

---

## Context

The daemon shipped `archive_conversation` / `unarchive_conversation` in pyrycode/pyrycode#881: a verb carrying a conversation id that clears the durable archived flag, persists eagerly, and confirms by replying to the requesting client with a `conversation_updated` record reflecting the restored (active) state. Desktop has no outbound path yet. This is the **transport half** of the "new screen AND transport wiring" split from #153 (the screen is #347; the restore control that consumes this verb is #348) — sliced off because it is main-process, security-sensitive wire code (different fabric from the renderer chrome, per the pipeline's belt-and-suspenders rule).

**Scope guard (from the ticket, load-bearing):** wire **only** `unarchive_conversation`. The daemon models both verbs on one shared payload + one parameterized handler, but desktop has no `archive_conversation` caller (the only surface is #348's restore/unarchive row). Do **not** add the symmetric `archive_conversation` verb.

**No inbound change.** #881 also extended `conversation_updated` with an `is_archived` field, but this slice is outbound-only. The existing `conversation_updated` decoder already tolerates unknown server keys (forward-compat; the decode path at `daemonConnection.ts:585-597` and `ConversationUpdatedPayload` already exist from #273), and #348 reads restored state from the full re-list (`ConversationSummary.is_archived`, already present). No decode edit is in scope.

---

## Design

Five mirror sites. Only site 2 (the builder) carries real logic; the rest are one-line registrations. Each has a named twin from #273 — clone it, don't invent.

### Site 1 — `src/shared/wire/types.ts` (wire contract)

- Add `'unarchive_conversation'` to the `EnvelopeType` union (beside `'promote_conversation'`, line 75).
- Add the payload interface mirroring `PromoteConversationPayload` but one field:

  ```ts
  export interface UnarchiveConversationPayload {
    conversation_id: string
  }
  ```

- Doc block (mirror the `PromoteConversationPayload` block, trimmed): outbound `unarchive_conversation` request body (client → daemon); mirrors the daemon's shared `ArchiveConversationPayload{ConversationID string}` (pyrycode#881) field-for-field — JSON key `conversation_id`, a **required value-string**, no pointer, no `omitempty`. `conversation_id` is a routing id (an existing row's id), not a secret; the desktop never resolves it into a filesystem path. CLAUDE.md no-drift: change only alongside a daemon/mobile change.

### Site 2 — `src/main/transport/unarchiveConversationEnvelope.ts` (new) + `.test.ts` (new)

Clone `promoteConversationEnvelope.ts`. Contract:

```ts
export interface UnarchiveConversationInput { id: number; ts: string; payload: UnarchiveConversationPayload }
export function buildUnarchiveConversation(input: UnarchiveConversationInput): Uint8Array
```

- Body: construct the `Envelope` literal (`type: 'unarchive_conversation'`, the four fields), return `encodeEnvelope(envelope)`. One statement — do not add validation, clock reads, or a counter (all injected; the builder stays pure, exactly like `buildPromoteConversation`).
- **Main-process only.** It imports `./codec` (Node `Buffer`). Keep the file banner asserting it must never be re-exported through a renderer barrel. Simpler than the promote builder: one required string, so there is no explicit-`null` preservation concern.
- MAY throw `WireEncodeError` when the serialized envelope exceeds `MAX_PLAINTEXT_BYTES`; the sole caller (`connection.unarchiveConversation`) catches it.

### Site 3 — `src/main/daemonConnection.ts` (connection method)

- Import `buildUnarchiveConversation` (beside the other transport-builder imports, line ~36).
- Add `UnarchiveConversationPayload` to the wire-type import block (line ~59).
- Add the interface declaration on `DaemonConnection` (clone the `promoteConversation` JSDoc at 187-198, trimmed): a payload-carrying control envelope; the `send` twin — inert no-op when `driver === null`; fire-and-forget — no reply correlated or awaited (the daemon's confirming `conversation_updated` reply is not correlated here; #348 reads restored state from the re-list); NEVER throws out of the module (parity #490); caller is #348.
- Add the method body (clone `promoteConversation` at 906-934): `driver === null` early return; build a **fresh literal** naming only `conversation_id` (never a spread of `payload` — the deterministic anti-smuggling net that bounds the wire to exactly the one modeled field, ignoring any renderer-smuggled extra the structural-minimum guard let through); share the one monotonic `nextEnvelopeId` (advance only on a successful build); `driver.sendMessage(bytes)`; `try/catch` that DROPS the caught object (classify-don't-forward — its message could echo the payload; no log, no event).
- Add `unarchiveConversation` to the returned connection object's export list (line ~1099).

### Site 4 — `src/shared/ipc/commands.ts` (renderer→main command boundary)

- Add `UnarchiveConversationPayload` to the wire-type import block.
- Add the union member: `| { type: 'unarchiveConversation'; payload: UnarchiveConversationPayload }`.
- Add the `isRendererCommand` case **in lockstep** with the union member (a missing case silently drops the command at the boundary):

  ```ts
  case 'unarchiveConversation':
    return 'payload' in value && isUnarchiveConversationPayload(value.payload)
  ```

- Add the guard, mirroring `isRequestSnapshotPayload` (the single-`conversation_id`-string precedent): one present-and-string check; accepts extra/unknown fields (structural minimum); rejects a missing / non-string / `null` id; pure, never throws.

  ```ts
  function isUnarchiveConversationPayload(value: unknown): value is UnarchiveConversationPayload {
    if (typeof value !== 'object' || value === null) return false
    return 'conversation_id' in value && typeof value.conversation_id === 'string'
  }
  ```

  Note: no constructor helper (like `sendMessageCommand`) is required by the ACs — the renderer in #348 builds the command literal directly, and the union return type is the compile-time guarantee. Add one only if #348's spec later asks; leave it out here to keep the surface minimal.

### Site 5 — `src/main/index.ts` (command dispatch)

- Add a `case 'unarchiveConversation'` to the `onCommand` switch → `connection.unarchiveConversation(command.payload)`. Clone the `promoteConversation` arm (287-293): direct to the connection method, no orchestrator — a fire-and-forget request has no consumer/reassembler. Comment: sends `unarchive_conversation`; the daemon confirms by replying with a `conversation_updated` record, not correlated here (#348 reads restored state from the re-list); inert no-op when not connected.

---

## State + concurrency model

- **No new store, no new state.** This is transport-only. The single `nextEnvelopeId` counter in `daemonConnection.ts` is shared (as `promoteConversation` / `send` / `requestSnapshot` share it) — one monotonic id space so the daemon's id-based correlation stays unique across interleaved calls. The counter is single-writer (no `await` between read and increment inside the synchronous method body), so no check-then-act race.
- **Fire-and-forget, no correlation memory.** Unlike `setSessionSettings` (`pendingSettings` map) or `answerModal` (`outstandingAnswers` FIFO), this verb leaves nothing dangling: it registers no pending entry, so a reconnect's `dial()` reset (`nextEnvelopeId = 2`) is automatically safe — there is nothing to clear. Mirrors `promoteConversation`.
- **Teardown:** inherited. A command arriving while disconnected (`driver === null`) is an inert no-op; a socket drop mid-send is swallowed by the `try/catch`. No new listener, timer, or `AbortController`.

## Error handling

| Layer | Failure mode | Result |
|---|---|---|
| Renderer→main boundary | malformed/non-string id, missing payload | `isRendererCommand` returns false → command dropped at `onCommand` before dispatch (no throw) |
| Builder | serialized envelope > `MAX_PLAINTEXT_BYTES` | throws `WireEncodeError` |
| Connection method | over-cap (`WireEncodeError`) or any `driver`/wasm throw | caught, object DROPPED (classify-don't-forward), no log, no event, `nextEnvelopeId` not consumed |
| Connection method | not connected (`driver === null`) | inert early return (no-op) |

No new UI surface: a dropped/failed send produces no reply and no banner (the daemon's `conversation_updated` confirmation, when it does arrive, flows through the existing decode path and #348's re-list — out of scope here).

## Testing strategy

Unit tests only (`npm test`, vitest), against the REAL codec — mirror `promoteConversationEnvelope.test.ts`:

- **Round-trip:** `decodeEnvelope(buildUnarchiveConversation({ id, ts, payload }))` asserts `type === 'unarchive_conversation'`, `id`, `ts`, and `payload` deep-equals `{ conversation_id }`. Pins the actual wire bytes.
- **Over-cap:** a `conversation_id` of `'x'.repeat(MAX_PLAINTEXT_BYTES + 1)` → `buildUnarchiveConversation(...)` throws `WireEncodeError`.

Boundary-guard coverage is optional and light — if the developer chooses to test `isUnarchiveConversationPayload` (or the existing `commands.test.ts` has a table for the sibling guards, extend it): well-formed `{ conversation_id: 's' }` accepts; `{}`, `{ conversation_id: 3 }`, `{ conversation_id: null }` reject. The AC's assertion target is the pure builder; the guard mirrors an already-tested precedent (`isRequestSnapshotPayload`), so exhaustive guard tests are not required for the size.

Type coverage: `npm run typecheck` — the exhaustive `isRendererCommand` switch and the `onCommand` dispatch switch are both compile-forced against the grown union (a missing case is a type/coverage signal, not a silent gap). `npm run build` is the salvage/QA gate.

## Scope & sizing note

Exactly 5 production `.ts` files (types, builder, connection, commands, index) — the irreducible atomic minimum for one outbound wire verb, the same footprint every simple verb has shipped at S on this pipeline (#273 promote / #241 create / #300 dequeue). Only the two-frame `modal_answer` was ever split (#235 wire+builders / #236 command), because it was genuinely bigger (token minting + ADR 0009 correlation). This verb is **strictly simpler than #273** (one required field vs three); its total is ~140 LOC, bounded by #273's proven-S ~166-LOC merged diff. Not split.

## Open questions

- None blocking. If #348's spec later needs a pure `unarchiveConversationCommand(fields)` constructor (parity with `sendMessageCommand` / `dequeueMessageCommand`), add it in #348 or as a trivial follow-up — omitted here because no AC requires it and the renderer can build the literal directly under the union's compile-time guarantee.

---

## Security review

**Verdict:** PASS

**Findings:**

- **[1. Trust boundaries]** No new MUST-FIX. This spec adds exactly one untrusted→trusted crossing: the renderer→main IPC `unarchiveConversation` command. It is guarded by `isUnarchiveConversationPayload` at the `isRendererCommand` boundary (co-located with the union so the two evolve in lockstep — a missing case would silently drop, not mis-accept), and re-bounded a second time by the connection method's **fresh-literal** construction (names only `conversation_id`, never a spread of `payload`), so a renderer-smuggled extra field that passes the structural-minimum guard still cannot reach the wire. Two-layer defense, identical to #273. Downstream holds the typed `UnarchiveConversationPayload` only.
- **[2. Tokens, secrets, credentials]** N/A — the payload is a single `conversation_id` routing id (an existing conversation row's id), never a token/key/credential. No token generated, stored, logged, or compared. The `RendererCommand` union by construction exposes no field that could hold a secret (AC6); this member reuses only the wire payload type, adding no secret-bearing surface.
- **[3. File / storage operations]** N/A — no filesystem path is constructed. `conversation_id` becomes a routing key inside the Noise session, never concatenated into a path; the desktop never resolves it (the same posture as #273's `cwd` note). No disk write, no TOCTOU, no atomic-write concern.
- **[4. Inter-process / Electron attack surface]** No findings — no `webPreferences` change, no new `contextBridge` API, no new custom protocol / deep link. The command rides the **existing** `COMMAND_CHANNEL` (`pyry:command`) and its established `onCommand`/`ipcMain` receiver; this ticket adds one validated member to an allowlisted, already-minimised surface. Every argument is validated (the guard) before use. Process placement is preserved: the builder + codec + `driver.sendMessage` live in main; no key, socket, or raw frame is introduced in the renderer (AC6, a MUST-FIX category — clean).
- **[5. Cryptographic primitives]** N/A — no RNG, no key/nonce handling, no comparison against a secret. The envelope is encrypted onto the live Noise session by the unchanged `driver.sendMessage`; this slice hands it plaintext bytes and touches no crypto. The shared `nextEnvelopeId` is a correlation counter, not a nonce (Noise nonces are the driver's per-direction counters, untouched here) — no (key, nonce) reuse introduced.
- **[6. Network & I/O]** No findings — no new socket, URL, or frame-size surface. The builder enforces the `MAX_PLAINTEXT_BYTES` cap (throws `WireEncodeError`, caught and dropped by the caller), inheriting the existing outbound size discipline; the relay `maxPayload` / timeouts are unchanged and out of scope.
- **[7. Error messages, logs, telemetry]** No findings — the connection method's `try/catch` DROPS the caught object (classify-don't-forward, inherited #62): no log call, no event, so a codec error message cannot echo the payload to a sink. No `console.*`. Consistent with the module's content-free-by-construction posture (#128). `conversation_id` is a routing id, not a MUST-NOT-log field, but it is never logged here regardless.
- **[8. Concurrency]** No findings — the method is synchronous (no `await` between the `nextEnvelopeId` read and increment → single-writer, no check-then-act race), launches no long-lived task, registers no timer/listener/`AbortController`, and leaves no correlation memory to leak (fire-and-forget, unlike `setSessionSettings`/`answerModal`). Reconnect's `dial()` reset is automatically safe. Duplicate-connection / single-live-transport invariants are inherited unchanged.
- **[9. Threat model alignment]** Addressed. **Hostile daemon response:** out of scope by design — this is outbound-only; the confirming `conversation_updated` reply flows through the existing defensively-parsed decode path (#273), unchanged, and is not correlated here (#348 picks up the restored state from the re-list). **Renderer compromise reaching transport:** stopped at the two-layer boundary above — a compromised renderer can at most request an unarchive of an arbitrary `conversation_id` string it can already see; it gains no key, socket, or raw-frame access, and the daemon authorizes the operation server-side within the paired session. **Malicious/compromised relay:** content-blind and unaffected — this changes only the plaintext inside the existing Noise session; the relay sees an opaque frame. No new plaintext-leak or hang vector.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-14
