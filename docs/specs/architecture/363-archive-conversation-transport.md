# #363 — Outbound `archive_conversation` wire command (transport)

**Size:** S (arguably XS — the mirror-image twin of the S-sized #346 it clones, one required field). Ships **dormant**: fully tested, no consumer. The Channel Info sheet's Archive action (#366) is its first caller.

**Shape:** field-for-field clone of the `unarchive_conversation` outbound verb (#346) across five mirror sites, changing only the envelope `type` string (`archive_conversation`) and the payload type name (`ArchiveConversationPayload`). Identical single-`conversation_id` payload. No inbound decode change. No UI. No new dependency.

---

## Files to read first

Read the `unarchive_conversation` precedent (#346) end-to-end first — this ticket is its exact structural mirror (archive sets the flag; unarchive clears it), same one-field payload. Every "new" artifact has a direct twin below; match its shape, comments, and security posture. `unarchive` is the twin to clone, not `promote` (#273, three fields) — reach for `promote` only if you want the three-field contrast.

- `src/main/transport/unarchiveConversationEnvelope.ts:1-46` — **the builder to clone.** `buildUnarchiveConversation({ id, ts, payload }) → encodeEnvelope`. Copy the file wholesale; rename `unarchive`→`archive`, swap the payload type, change `type: 'archive_conversation'`. Note the main-process-only banner (it imports the codec / Node `Buffer` — never re-export through a renderer barrel).
- `src/main/transport/unarchiveConversationEnvelope.test.ts:1-40` — **the test to clone.** Two cases: round-trip (`type`/`id`/`ts`/`payload`) against the REAL codec, and over-cap → `WireEncodeError`. Reuse `MAX_PLAINTEXT_BYTES` for the over-cap fixture. Assert `type === 'archive_conversation'`.
- `src/shared/wire/types.ts:40-80` — the `EnvelopeType` union; add `'archive_conversation'` **beside** `'unarchive_conversation'` (line 76). `MAX_PLAINTEXT_BYTES = 65519` is at line 30.
- `src/shared/wire/types.ts:589-605` — the `UnarchiveConversationPayload` interface + its doc block; the new `ArchiveConversationPayload` interface mirrors it field-for-field (one `conversation_id: string`). **Do not reuse `UnarchiveConversationPayload`** — see Site 1 below.
- `src/main/daemonConnection.ts:203-213` — the `unarchiveConversation` method's **interface declaration** on `DaemonConnection`; clone the JSDoc verbatim, `unarchive`→`archive`, "restore an archived conversation to active" → "archive an active conversation" and swap `#348`→`#366` as the caller. Also: line 37 (builder import), line 62 (`UnarchiveConversationPayload` type import), line 1183 (the return-object export list).
- `src/main/daemonConnection.ts:962-988` — **the connection method to clone.** `driver === null` early return; fresh literal naming only `conversation_id` (NEVER a spread of `payload`); shared `nextEnvelopeId`; `try/catch` that swallows all throws. This is the anti-smuggling net — preserve it exactly.
- `src/shared/ipc/commands.ts:81-94` — the `RendererCommand` union; add the `archiveConversation` member (beside `unarchiveConversation`, line ~90). Line 178 (the `isRendererCommand` case for unarchive), lines 280-288 (`isUnarchiveConversationPayload` guard), lines 18-29 (the wire-type import block — add `ArchiveConversationPayload`).
- `src/main/index.ts:294-300` — the `unarchiveConversation` dispatch arm to clone (add the new arm beside it). The `onCommand` switch is exhaustive on the union.
- `src/main/transport/codec.ts:42,112,127` — `WireEncodeError` (line 42), `encodeEnvelope` (112), `decodeEnvelope` (127). The builder calls `encodeEnvelope`; the test calls `decodeEnvelope` + asserts `WireEncodeError`.
- `docs/knowledge/decisions/0002*` (if present) — the wire-drift rule: `ArchiveConversationPayload` mirrors the daemon's shared `ArchiveConversationPayload` struct field-for-field (JSON key `conversation_id`, no `omitempty`); do not drift.

---

## Context

The daemon shipped `archive_conversation` (client→daemon) in pyrycode/pyrycode#881 (merged): a verb carrying a conversation id that **sets** the durable archived flag, persists eagerly, and confirms by replying with a `conversation_updated` record reflecting the now-archived state. It is the symmetric counterpart of `unarchive_conversation`, which desktop already speaks (#346). Desktop shipped the restore (unarchive) path first, without its archive counterpart — so there is **no** outbound archive verb today. This slice fills that gap.

This is the **transport half** of the Channel Info sheet split (#155): the sheet shell is #365, and the Archive action that consumes this verb is #366. It is sliced off because it is main-process, security-sensitive wire code (different fabric from the renderer chrome, per the pipeline's belt-and-suspenders rule), and it ships **dormant** exactly as `unarchive_conversation` (#346) shipped ahead of its restore-row caller.

**Scope guard (from the ticket, load-bearing):** wire **only** the outbound `archive_conversation` verb. **No inbound decode change.** The daemon confirms with `conversation_updated`, which desktop already decodes (#273) and re-requests the list on (#275); the archived row leaving the active list comes free downstream, owned by #366's AC, not this ticket. The `conversation_updated` decode path (`daemonConnection.ts` `conversation-updated` arm) and `ConversationUpdatedPayload` already exist and tolerate unknown server keys — no decode edit is in scope.

---

## Design

Five mirror sites. Only site 2 (the builder) carries real logic; the rest are one-line registrations. Each has a named twin from #346 — clone it, don't invent.

### Site 1 — `src/shared/wire/types.ts` (wire contract)

- Add `'archive_conversation'` to the `EnvelopeType` union (beside `'unarchive_conversation'`, line 76).
- Add a **new, distinct** payload interface — do NOT reuse `UnarchiveConversationPayload`:

  ```ts
  export interface ArchiveConversationPayload {
    conversation_id: string
  }
  ```

  **Why a distinct type, not a reuse (load-bearing — a developer will be tempted to collapse them).** `ArchiveConversationPayload` and `UnarchiveConversationPayload` are structurally identical, but the AC requires a distinct `ArchiveConversationPayload` and the pipeline names its wire surface per-verb (each verb owns its command member / builder / method / guard). `ArchiveConversationPayload` is the direct name-mirror of the daemon's shared `ArchiveConversationPayload` struct (the one struct that serves BOTH verbs, per the existing `UnarchiveConversationPayload` doc block at :590-593). Keeping the two types separate keeps each verb's five sites self-consistent and lets the two evolve independently if the daemon ever forks them. Do not "helpfully" alias `ArchiveConversationPayload = UnarchiveConversationPayload`.
- Doc block (mirror the `UnarchiveConversationPayload` block at :589-605, retargeted to archive): outbound `archive_conversation` request body (client → daemon); mirrors the daemon's shared `ArchiveConversationPayload{ConversationID string}` (pyrycode#881) field-for-field — JSON key `conversation_id`, a **required value-string**, no pointer, no `omitempty`. The id of an existing conversation row whose durable archived flag the daemon **sets** (the opposite of unarchive's clear), persisting eagerly and confirming with a `conversation_updated` record reflecting the archived state. `conversation_id` is a routing id (an existing row's id), not a secret; the desktop never resolves it into a filesystem path. One required string, so no explicit-`null` concern. CLAUDE.md no-drift: change only alongside a daemon/mobile change. See #363.

### Site 2 — `src/main/transport/archiveConversationEnvelope.ts` (new) + `.test.ts` (new)

Clone `unarchiveConversationEnvelope.ts`. Contract:

```ts
export interface ArchiveConversationInput { id: number; ts: string; payload: ArchiveConversationPayload }
export function buildArchiveConversation(input: ArchiveConversationInput): Uint8Array
```

- Body: construct the `Envelope` literal (`type: 'archive_conversation'`, the four fields `id`/`type`/`ts`/`payload`), return `encodeEnvelope(envelope)`. One statement — do not add validation, clock reads, or a counter (all injected; the builder stays pure, exactly like `buildUnarchiveConversation`).
- **Main-process only.** It imports `./codec` (Node `Buffer`). Keep the file banner asserting it must never be re-exported through a renderer barrel. One required string, so there is no explicit-`null` preservation concern.
- MAY throw `WireEncodeError` when the serialized envelope exceeds `MAX_PLAINTEXT_BYTES`; the sole caller (`connection.archiveConversation`) catches it.

### Site 3 — `src/main/daemonConnection.ts` (connection method)

- Import `buildArchiveConversation` (beside the other transport-builder imports, line ~37).
- Add `ArchiveConversationPayload` to the wire-type import block (line ~62).
- Add the interface declaration on `DaemonConnection` (clone the `unarchiveConversation` JSDoc at 203-213, retargeted): a payload-carrying `archive_conversation` control envelope; the `send` twin — inert no-op when `driver === null`; fire-and-forget — no reply correlated or awaited (the daemon's confirming `conversation_updated` reply is not correlated here; #366 reads the archived row leaving via the existing re-list); NEVER throws out of the module (parity #490); caller is #366.
- Add the method body (clone `unarchiveConversation` at 962-988): `driver === null` early return; build a **fresh literal** naming only `conversation_id` (never a spread of `payload` — the deterministic anti-smuggling net that bounds the wire to exactly the one modeled field, ignoring any renderer-smuggled extra the structural-minimum guard let through); share the one monotonic `nextEnvelopeId` (advance only on a successful build); `driver.sendMessage(bytes)`; `try/catch` that DROPS the caught object (classify-don't-forward — its message could echo the payload; no log, no event).
- Add `archiveConversation` to the returned connection object's export list (line ~1183, beside `unarchiveConversation`).

### Site 4 — `src/shared/ipc/commands.ts` (renderer→main command boundary)

- Add `ArchiveConversationPayload` to the wire-type import block (lines 18-29).
- Add the union member: `| { type: 'archiveConversation'; payload: ArchiveConversationPayload }` (beside `unarchiveConversation`, line ~90). Extend the union's doc comment additively (one sentence mirroring the `unarchiveConversation` sentence at :60-62).
- Add the `isRendererCommand` case **in lockstep** with the union member (a missing case silently drops the command at the boundary):

  ```ts
  case 'archiveConversation':
    return 'payload' in value && isArchiveConversationPayload(value.payload)
  ```

- Add the guard, cloning `isUnarchiveConversationPayload` (:285-288) — the single-`conversation_id`-string precedent: one present-and-string check; accepts extra/unknown fields (structural minimum); rejects a missing / non-string / `null` id; pure, never throws.

  ```ts
  function isArchiveConversationPayload(value: unknown): value is ArchiveConversationPayload {
    if (typeof value !== 'object' || value === null) return false
    return 'conversation_id' in value && typeof value.conversation_id === 'string'
  }
  ```

  The guard checks the **type** of the field (present string), NOT emptiness — mirror the unarchive guard exactly. No constructor helper (like `sendMessageCommand`) is required by the ACs — the renderer in #366 builds the command literal directly, and the union return type is the compile-time guarantee. Leave it out here to keep the surface minimal.

### Site 5 — `src/main/index.ts` (command dispatch)

- Add a `case 'archiveConversation'` to the `onCommand` switch → `connection.archiveConversation(command.payload)`. Clone the `unarchiveConversation` arm (294-300): direct to the connection method, no orchestrator — a fire-and-forget request has no consumer/reassembler. Comment: sends `archive_conversation`; the daemon confirms by replying with a `conversation_updated` record, decoded by the existing path and reflected in the list by #275 (consumed by #366), not correlated here; inert no-op when not connected.

---

## State + concurrency model

- **No new store, no new state.** This is transport-only. The single `nextEnvelopeId` counter in `daemonConnection.ts` is shared (as `unarchiveConversation` / `promoteConversation` / `send` share it) — one monotonic id space so the daemon's id-based correlation stays unique across interleaved calls. The counter is single-writer (no `await` between read and increment inside the synchronous method body), so no check-then-act race.
- **Fire-and-forget, no correlation memory.** Unlike `setSessionSettings` (`pendingSettings` map) or `answerModal` (`outstandingAnswers` FIFO), this verb leaves nothing dangling: it registers no pending entry, so a reconnect's `dial()` reset (`nextEnvelopeId = 2`) is automatically safe — there is nothing to clear. Mirrors `unarchiveConversation`.
- **Teardown:** inherited. A command arriving while disconnected (`driver === null`) is an inert no-op; a socket drop mid-send is swallowed by the `try/catch`. No new listener, timer, or `AbortController`.

## Error handling

| Layer | Failure mode | Result |
|---|---|---|
| Renderer→main boundary | malformed/non-string id, missing payload | `isRendererCommand` returns false → command dropped at `onCommand` before dispatch (no throw) |
| Builder | serialized envelope > `MAX_PLAINTEXT_BYTES` | throws `WireEncodeError` |
| Connection method | over-cap (`WireEncodeError`) or any `driver`/wasm throw | caught, object DROPPED (classify-don't-forward), no log, no event, `nextEnvelopeId` not consumed |
| Connection method | not connected (`driver === null`) | inert early return (no-op) |

No new UI surface: a dropped/failed send produces no reply and no banner (the daemon's `conversation_updated` confirmation, when it does arrive, flows through the existing decode path and #366's re-list — out of scope here).

## Testing strategy

Unit tests only (`npm test`, vitest), against the REAL codec — mirror `unarchiveConversationEnvelope.test.ts`:

- **Round-trip:** `decodeEnvelope(buildArchiveConversation({ id, ts, payload }))` asserts `type === 'archive_conversation'`, `id`, `ts`, and `payload` deep-equals `{ conversation_id }`. Pins the actual wire bytes.
- **Over-cap:** a `conversation_id` of `'x'.repeat(MAX_PLAINTEXT_BYTES + 1)` → `buildArchiveConversation(...)` throws `WireEncodeError`.
- **Boundary-guard coverage** is optional and light — if the developer chooses to test `isArchiveConversationPayload` (or the existing `commands.test.ts` has a table for the sibling guards, extend it): well-formed `{ conversation_id: 's' }` accepts; `{}`, `{ conversation_id: 3 }`, `{ conversation_id: null }` reject. The AC's assertion target is the pure builder; the guard mirrors an already-tested precedent (`isUnarchiveConversationPayload`), so exhaustive guard tests are not required for the size.
- **Boundary trap (do not violate):** the builder test lives under `src/main/**` and may import the codec; NEVER import a `src/main/**` codec into a `src/shared/**` test (the #241 boundary trap). The guard test, if added, lives with `commands.ts` under `src/shared/**` and imports only shared types.

Type coverage: `npm run typecheck` — the exhaustive `isRendererCommand` switch and the `onCommand` dispatch switch are both compile-forced against the grown union (a missing case is a type/coverage signal, not a silent gap). `npm run build` is the salvage/QA gate.

## Scope & sizing note

Exactly 5 production `.ts` files (types, builder, connection, commands, index) + 1 new test file — the **irreducible compile-atomic minimum** for one outbound wire verb: the guard, dispatch arm, interface method, and returned-object export must land together or it does not typecheck. This is the same footprint every simple outbound verb has shipped at S on this pipeline — #346 unarchive (PR#357), #273 promote (PR#287), #241 create (PR#244), #359 rename (PR#362) — none splittable smaller (the #241/#273/#346 precedent proved it). This slice is the **mirror-image twin of #346** (one required field, only the type string and payload type name differ); its total is ~140 production LOC + ~40 test LOC, bounded by #346's proven-S merged diff. Zero consumer fan-out (a brand-new verb — additive, no call-site cascade). **Not split** — a split would produce non-compiling children, per the ticket's explicit "Do not split further."

## Open questions

- None blocking. If #366's spec later needs a pure `archiveConversationCommand(fields)` constructor (parity with `sendMessageCommand` / `dequeueMessageCommand`), add it in #366 or as a trivial follow-up — omitted here because no AC requires it and the renderer can build the literal directly under the union's compile-time guarantee.

---

## Security review

**Verdict:** PASS

**Findings:**

- **[1. Trust boundaries]** No new MUST-FIX. This spec adds exactly one untrusted→trusted crossing: the renderer→main IPC `archiveConversation` command. It is guarded by `isArchiveConversationPayload` at the `isRendererCommand` boundary (co-located with the union so the two evolve in lockstep — a missing case would silently drop, not mis-accept), and re-bounded a second time by the connection method's **fresh-literal** construction (names only `conversation_id`, never a spread of `payload`), so a renderer-smuggled extra field that passes the structural-minimum guard still cannot reach the wire. Two-layer defense, identical to #346. Downstream holds the typed `ArchiveConversationPayload` only.
- **[2. Tokens, secrets, credentials]** N/A — the payload is a single `conversation_id` routing id (an existing conversation row's id), never a token/key/credential. No token generated, stored, logged, or compared. The `RendererCommand` union by construction exposes no field that could hold a secret (AC5); this member reuses only the wire payload type, adding no secret-bearing surface.
- **[3. File / storage operations]** N/A — no filesystem path is constructed. `conversation_id` becomes a routing key inside the Noise session, never concatenated into a path; the desktop never resolves it (the same posture as #346). No disk write, no TOCTOU, no atomic-write concern.
- **[4. Inter-process / Electron attack surface]** No findings — no `webPreferences` change, no new `contextBridge` API, no new custom protocol / deep link. The command rides the **existing** `COMMAND_CHANNEL` (`pyry:command`) and its established `onCommand`/`ipcMain` receiver; this ticket adds one validated member to an allowlisted, already-minimised surface. Every argument is validated (the guard) before use. Process placement is preserved: the builder + codec + `driver.sendMessage` live in main; no key, socket, or raw frame is introduced in the renderer (a MUST-FIX category — clean).
- **[5. Cryptographic primitives]** N/A — no RNG, no key/nonce handling, no comparison against a secret. The envelope is encrypted onto the live Noise session by the unchanged `driver.sendMessage`; this slice hands it plaintext bytes and touches no crypto. The shared `nextEnvelopeId` is a correlation counter, not a nonce (Noise nonces are the driver's per-direction counters, untouched here) — no (key, nonce) reuse introduced.
- **[6. Network & I/O]** No findings — no new socket, URL, or frame-size surface. The builder enforces the `MAX_PLAINTEXT_BYTES` cap (throws `WireEncodeError`, caught and dropped by the caller), inheriting the existing outbound size discipline; the relay `maxPayload` / timeouts are unchanged and out of scope.
- **[7. Error messages, logs, telemetry]** No findings — the connection method's `try/catch` DROPS the caught object (classify-don't-forward, inherited #62): no log call, no event, so a codec error message cannot echo the payload to a sink. No `console.*`. Consistent with the module's content-free-by-construction posture (#128). `conversation_id` is a routing id, not a MUST-NOT-log field, but it is never logged here regardless.
- **[8. Concurrency]** No findings — the method is synchronous (no `await` between the `nextEnvelopeId` read and increment → single-writer, no check-then-act race), launches no long-lived task, registers no timer/listener/`AbortController`, and leaves no correlation memory to leak (fire-and-forget, unlike `setSessionSettings`/`answerModal`). Reconnect's `dial()` reset is automatically safe. Duplicate-connection / single-live-transport invariants are inherited unchanged.
- **[9. Threat model alignment]** Addressed. **Hostile daemon response:** out of scope by design — this is outbound-only; the confirming `conversation_updated` reply flows through the existing defensively-parsed decode path (#273), unchanged, and is not correlated here (#366 picks up the archived row leaving from the re-list). **Renderer compromise reaching transport:** stopped at the two-layer boundary above — a compromised renderer can at most request an archive of an arbitrary `conversation_id` string it can already see (a reversible, server-authorized state flip; the symmetric `unarchive` already exists as #346), and it gains no key, socket, or raw-frame access; the daemon authorizes the operation server-side within the paired session. **Malicious/compromised relay:** content-blind and unaffected — this changes only the plaintext inside the existing Noise session; the relay sees an opaque frame. No new plaintext-leak or hang vector.

**Reviewer:** architect (self-review, `security-sensitive` label)
**Date:** 2026-07-14
