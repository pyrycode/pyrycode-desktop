# Spec: `delete_conversation` outbound transport (#364)

## Files to read first

Read these before writing anything. This verb is a **field-for-field clone** of the just-merged
`unarchive_conversation` (#346) / `archive_conversation` (#363) siblings — read those exact sites,
then reproduce them with the verb string swapped and the one doc-comment divergence noted below.

- `src/main/transport/unarchiveConversationEnvelope.ts:1-47` — **the primary clone target for the new builder.** A whole file: doc-comment, `UnarchiveConversationInput` interface, `buildUnarchiveConversation`. Copy its shape verbatim; swap `unarchive`→`delete` and rewrite the reply doc-comment (see Design §5).
- `src/main/transport/unarchiveConversationEnvelope.test.ts:1-32` — **the clone target for the new test.** Two `it` cases: round-trip through the real codec, and over-cap `WireEncodeError`. Reproduce with `delete_conversation` and `conv-9` swapped for a delete-flavoured id.
- `src/main/transport/archiveConversationEnvelope.ts:1-47` — the mirror sibling (#363), identical structure; confirms the pattern is stable across two verbs.
- `src/shared/wire/types.ts:40-82` — `EnvelopeType` union; add `'delete_conversation'` here (siblings at lines 76–77).
- `src/shared/wire/types.ts:590-625` — `ArchiveConversationPayload` / `UnarchiveConversationPayload` interfaces + their no-drift doc-comments; add `DeleteConversationPayload` next to them, same single-required-string shape.
- `src/shared/ipc/commands.ts:18-99` — imports block, the `RendererCommand` union + its long doc-comment; add the `deleteConversation` member.
- `src/shared/ipc/commands.ts:161-205` — `isRendererCommand` switch; add the `case 'deleteConversation'` arm.
- `src/shared/ipc/commands.ts:287-306` — `isArchiveConversationPayload` / `isUnarchiveConversationPayload` guards; add `isDeleteConversationPayload` next to them (exact clone — single present-and-string check).
- `src/main/daemonConnection.ts:34-65` — the builder imports (lines 37–38) + the wire-type imports (lines 63–64); add the `buildDeleteConversation` import and `type DeleteConversationPayload` import.
- `src/main/daemonConnection.ts:205-227` — the `archiveConversation` / `unarchiveConversation` **interface declarations** (doc-comment + signature); add `deleteConversation`.
- `src/main/daemonConnection.ts:976-1030` — the `archiveConversation` / `unarchiveConversation` **method bodies**; clone one for `deleteConversation`.
- `src/main/daemonConnection.ts:1218-1232` — the returned-object literal; add `deleteConversation` to it (siblings at lines 1225–1226).
- `src/main/index.ts:288-325` — the command-dispatch `switch`; add `case 'deleteConversation'` (siblings at 294–307).
- `CLAUDE.md` (repo root) — wire-type no-drift rule; the `src/shared/**` ↔ `src/main/**` codec-import boundary (the builder is main-only, imports `codec.ts`/`Buffer`; never re-export through a renderer barrel).
- Memory: this is the "outbound wire-verb slice = 5 files, irreducible S" shape; #346 shipped PR#357, #363 shipped — both merged at S.

## Context

The daemon added the **permanent hard-delete** verb `delete_conversation` (client→daemon) in
pyrycode #822 (PR #884). Desktop has no outbound delete verb. This ticket ships the transport half
**dormant** — no renderer caller — exactly as `unarchive_conversation` (#346) shipped ahead of its
caller. The caller is the Channel Info sheet's Delete action (#367).

Delete is the **permanent** path. The reversible path is archive/unarchive (#363/#346), which flips a
durable soft-state flag. This verb is independent of them: it removes the row.

**Outbound-only.** The daemon replies with a **distinct new record** `conversation_deleted { id }`
(the row no longer exists post-delete, so the ack carries only the id), correlated to the requester by
`in_reply_to`, with **no broadcast**. Desktop does not yet decode that record — decoding it and
reflecting the removal via an explicit re-list are owned by #367. Because the verb ships dormant (no
caller), the daemon never sends a `conversation_deleted` frame during this ticket's lifetime; **there
is nothing inbound to handle here.**

Consequence to record for #367 (not implemented here): unlike promote/rename/archive, delete does
**not** get a free list-reflection from a `conversation_updated` re-list — there is no broadcast, so
the requester's row leaves the list only on an explicit re-list #367 will trigger.

## Design

Five production edits + one new builder + one new test. The clone is the `unarchive_conversation`
slice with the verb string swapped everywhere. There is **zero consumer fan-out** — a brand-new
additive verb with no call-site cascade.

### 1. `src/shared/wire/types.ts` — vocabulary + payload type

- Add `| 'delete_conversation'` to the `EnvelopeType` union (next to `'archive_conversation'` /
  `'unarchive_conversation'`, lines 76–77).
- Add a `DeleteConversationPayload` interface next to `UnarchiveConversationPayload` (after line 625):

  ```ts
  export interface DeleteConversationPayload {
    conversation_id: string
  }
  ```

  Doc-comment mirrors `UnarchiveConversationPayload`'s no-drift comment, but **describes the permanent
  removal**: a single REQUIRED value-string `conversation_id` (JSON key, plain `string`, no pointer /
  `omitempty`) — the routing id of an existing row the daemon **permanently deletes**. It is a routing
  id, not a secret; the desktop never resolves it to a filesystem path. Keep it a DISTINCT type (not an
  alias of `UnarchiveConversationPayload`) so the verb owns its own wire surface — same rationale the
  archive/unarchive doc-comments already state. **Do NOT add a `conversation_deleted` inbound type — that
  is #367's.**

### 2. `src/shared/ipc/commands.ts` — command member + boundary guard

- Import `DeleteConversationPayload` in the `../wire/types` import block (lines 18–30).
- Add `| { type: 'deleteConversation'; payload: DeleteConversationPayload }` to `RendererCommand` (after
  the `unarchiveConversation` member, ~line 95). Extend the union's doc-comment with a one-clause note
  mirroring the archive/unarchive clauses (single REQUIRED `conversation_id` string — a routing id, not a
  secret — asking the daemon to **permanently delete** a conversation).
- Add `case 'deleteConversation': return 'payload' in value && isDeleteConversationPayload(value.payload)`
  to `isRendererCommand` (next to the archive/unarchive cases, ~line 185). **The lockstep rule the
  module already documents: a union member without a matching guard case is silently dropped at the
  boundary.**
- Add `isDeleteConversationPayload` — an **exact clone** of `isUnarchiveConversationPayload`
  (lines 303–306): one present-and-string check on `conversation_id`. Checks the **TYPE**, not emptiness:
  a literal `null`, a missing key, and a non-string are all rejected; an empty string passes (a valid
  wire value the daemon polices). Structural-minimum — a smuggled extra field is not rejected here; the
  main-side fresh-literal construction bounds the wire. Pure; never throws.

### 3. `src/main/daemonConnection.ts` — interface decl + method + export

- Add `import { buildDeleteConversation } from './transport/deleteConversationEnvelope'` (next to lines
  37–38) and `type DeleteConversationPayload` to the wire-type import (lines 63–64).
- Add the `deleteConversation(payload: DeleteConversationPayload): void` **interface declaration**
  (clone the unarchive decl at lines 217–227), but **rewrite the reply doc-comment** (see §5): note the
  daemon confirms with a distinct `conversation_deleted { id }` record correlated to the requester, no
  broadcast, handled by #367 — **not** a `conversation_updated` re-list reflection. Keep the rest of the
  decl comment verbatim: `send` twin, inert no-op when `driver === null`, fire-and-forget, ships DORMANT,
  never throws (parity #490).
- Add the `deleteConversation` **method body** — a verbatim clone of `unarchiveConversation`
  (lines 1004–1030): `if (driver === null) return`; inside `try`, `buildDeleteConversation({ id:
  nextEnvelopeId, ts: now(), payload: { conversation_id: payload.conversation_id } })`; `nextEnvelopeId
  += 1`; `driver.sendMessage(bytes)`; bare `catch {}` that drops the caught object (classify-don't-forward,
  the message could echo the payload). **Fresh literal `{ conversation_id: payload.conversation_id }` —
  never a spread of `payload`.** Shares the one monotonic `nextEnvelopeId` (no second counter).
- Add `deleteConversation` to the returned-object literal (next to lines 1225–1226).

### 4. `src/main/index.ts` — dispatch arm

- Add `case 'deleteConversation':` to the command switch (next to lines 294–307): comment mirrors the
  archive/unarchive arms but notes the daemon replies with `conversation_deleted` (handled by #367, not
  correlated here); `connection.deleteConversation(command.payload); return`. Inert no-op when not
  connected (the connection method's `driver === null` guard).

### 5. `src/main/transport/deleteConversationEnvelope.ts` — NEW builder

Clone `unarchiveConversationEnvelope.ts:1-47` structure exactly:

- `DeleteConversationInput { id: number; ts: string; payload: DeleteConversationPayload }` interface.
- `buildDeleteConversation(input): Uint8Array` — constructs `{ id, type: 'delete_conversation', ts,
  payload }` and returns `encodeEnvelope(envelope)`. MAY throw `WireEncodeError` over `MAX_PLAINTEXT_BYTES`;
  the sole caller catches it.
- MAIN-PROCESS ONLY header comment (imports `codec.ts` / Node `Buffer`; never re-export through a
  renderer barrel).

**The one divergence from the clone — do NOT copy the reply doc-comment verbatim.** The unarchive
builder's header says the daemon "confirms with a `conversation_updated` record" that a re-list
reflects. Delete does **not**. Write delete's header to describe the **permanent** removal and state the
reply is a distinct `conversation_deleted { id }` record, correlated to the requester (`in_reply_to`),
no broadcast, no re-list reflection — **handled by #367, not here.** Everything else (the "outbound ask",
the fresh-literal-lives-in-the-connection-method note, the `WireEncodeError` note) stays.

## State + concurrency model

No new state. No store slice, no async task, no subscription. The verb is a synchronous
fire-and-forget: build bytes → `driver.sendMessage` → return. It shares the connection's single
monotonic `nextEnvelopeId` counter (advanced only on a successful build, so a dropped over-cap send
does not burn an id) — no new counter, no interleaving hazard beyond what the existing send/archive/
unarchive methods already tolerate. No reply is correlated or awaited (no pending-request map entry),
so there is no dangling-correlation risk when sent while disconnected.

## Error handling

- **Boundary reject (untrusted renderer→main):** `isDeleteConversationPayload` rejects any payload whose
  `conversation_id` is not a present string. A rejected command is dropped at `isRendererCommand` — it
  never reaches the connection method.
- **Over-cap plaintext:** `buildDeleteConversation` throws `WireEncodeError`; the connection method's
  `try/catch` drops it (no send, no log, no event — the message could echo the payload). `nextEnvelopeId`
  is not advanced (the `+= 1` sits after the build).
- **Disconnected:** `driver === null` → inert no-op return before the try.
- **Any driver/wasm throw:** same bare `catch` drops it. **Never throws out of the module** (parity #490).
- No inbound decode path is added, so there is no new parse-failure surface here.

## Testing strategy

One new test file `src/main/transport/deleteConversationEnvelope.test.ts`, cloned from
`unarchiveConversationEnvelope.test.ts`. Scenarios (bullet-pointed, not pre-written bodies — write in
the project's vitest idiom against the **real** codec):

- **Round-trip:** `buildDeleteConversation({ id, ts: FIXED_TS, payload: { conversation_id: <id> } })`
  decoded via `decodeEnvelope` yields `type === 'delete_conversation'`, the exact `id`, `ts`, and
  `payload` (assert `envelope.payload` toEqual the input payload — pins that the single field serializes
  verbatim, no drift, no smuggled key).
- **Over-cap:** a `conversation_id` of `'x'.repeat(MAX_PLAINTEXT_BYTES + 1)` makes the builder throw
  `WireEncodeError`.

The four additive edits (union member, guard case, interface decl + method + export, dispatch arm) are
covered by `npm run typecheck` (they do not typecheck apart from each other — see Scope self-check) and
by the existing command-boundary tests, which exercise `isRendererCommand` structurally. No new render
test — the verb is dormant, no UI. Gate: `npm run build` (typecheck + build) is the salvage/QA gate.

## Scope self-check (5-file count is a documented false positive — do NOT split)

The §4 "≥5 production `.ts` files" gate counts **5** here: `types.ts`, `commands.ts`,
`daemonConnection.ts`, `index.ts`, `deleteConversationEnvelope.ts`. This is a **verified false
positive**, not a rationalization, on three independent grounds:

1. **Compile-atomic — no valid split exists.** The union member, boundary guard, dispatch arm,
   connection method, and builder export **do not typecheck apart**. Any split yields a non-compiling
   child that fails `npm run build` (the QA gate). There is no Strangler-Fig seam — the §4 remediation
   ("name 2–3 child slices at seams") is unsatisfiable by construction. A gate whose only remediation is
   infeasible, applied to this shape, is a false positive.
2. **Empirical: shipped twice at S.** The direct siblings `unarchive_conversation` (#346, PR#357) and
   `archive_conversation` (#363) ship this **identical** 5-file shape and both merged at S. The §4
   gate's own cited failure (#311) was the *opposite* error — a claim of 4 files that was actually 13.
   Here the count is honest (exactly 5, verified against the two merged siblings) and nothing is hidden.
3. **Tiny turn budget.** ~55 lines of production code, **zero consumer fan-out** (0 call-site cascade),
   ≤5 new exported symbols, 5 ACs that are facets of one verb. Three of the five files are single-package
   vocabulary one-liners (the `EnvelopeType` member, the command-union member, the returned-object key).

Proceed at S with this note recorded so code-review and the operator see the reasoning. Do not bounce to
PO — a split would force non-compiling children.

## Open questions

None. The wire contract is CONFIRMED against pyrycode #822 (per the ticket, do not re-derive): request
`{ conversation_id }`, reply `conversation_deleted { id }` correlated by `in_reply_to`, no broadcast.
Inbound decode + list-reflect are #367's, explicitly out of scope here.

## Security review

**Verdict:** PASS

This verb differs from its archive/unarchive siblings in one security-relevant way: **it is permanent
and unrecoverable.** The pass focused there. The gate for a destructive action is the user-facing
confirmation (owned by #367, the #226 second-confirm pattern) plus the daemon's own authority — NOT a
second factor at the transport layer, which has no deterministic gate to add and no caller here.

**Findings:**

- **[Trust boundaries] No findings.** Single explicit renderer→main boundary: `isRendererCommand` →
  `isDeleteConversationPayload` (present-and-string check on `conversation_id`), then the main-side
  connection method rebuilds a **fresh literal `{ conversation_id }`** (never a spread of the incoming
  payload). A renderer cannot smuggle an extra field onto the wire. The guard checks type, not
  authorization — a buggy/compromised renderer could request deletion of any id it knows, but the daemon
  is the authority on permanence and this ticket ships **dormant** (no caller), so there is no live
  exposure.
- **[Tokens/secrets] No findings — N/A by design.** No token is minted, stored, or logged. Unlike
  `answerModal` (which mints an `answer_token` main-side), delete carries only `conversation_id`, a
  routing id, not a secret. The command union's AC5 (no member exposes a token/key/raw-frame field) holds
  by construction — `DeleteConversationPayload` has exactly one string field.
- **[File / storage] No findings — N/A.** No filesystem path is constructed; the spec states the desktop
  never resolves `conversation_id` into a path. It is an opaque routing string. Path handling of the id
  (and the actual row removal) is the daemon's concern (pyrycode #822), off-device.
- **[Electron attack surface] No findings.** No new `BrowserWindow` / `webPreferences` / `contextBridge`
  API / custom protocol. One member added to the **existing** sealed `pyry:command` union (not a new
  channel), validated by `isDeleteConversationPayload` before use — a minimal "delete by id" capability,
  not a raw one. The builder is MAIN-ONLY (imports `codec.ts` / `Buffer`), never re-exported through a
  renderer barrel, so raw bytes and the socket stay out of the web layer.
- **[Cryptographic primitives] No findings — N/A.** No crypto touched. The envelope is encrypted by the
  existing Noise session downstream of `driver.sendMessage`; this ticket only builds plaintext bytes.
  `nextEnvelopeId` is a monotonic counter, not security-relevant randomness. No key/nonce/comparison.
- **[Network & I/O] No findings — N/A.** No new socket, frame-size config, relay-URL handling, or
  timeout/reconnect logic. The outbound frame is bounded by the inherited `MAX_PLAINTEXT_BYTES` →
  `WireEncodeError` check. No inbound decode is added, so no new parse surface.
- **[Error messages / logs] No findings.** The connection method's bare `catch {}` DROPS the caught
  object with no log — deliberately, so an error string cannot echo the payload
  (classify-don't-forward, #62). No `console.log` of `conversation_id`. No telemetry.
- **[Concurrency] No findings — N/A.** Synchronous fire-and-forget: build → `driver.sendMessage` →
  return. No `await` in the method, no new async task/timer/listener. Shares the one monotonic
  `nextEnvelopeId` (advanced only on a successful build). No check-then-act race — there is no await
  point between the `driver === null` guard and the send. No new socket, so no duplicate-connection
  concern.
- **[Threat model — hostile relay] Addressed.** Content-blind and on-path: it can drop/delay/reorder the
  `delete_conversation` frame. A dropped frame → the delete silently does not happen (fire-and-forget, no
  ack awaited here; #367 owns any "did it work?" feedback via the `conversation_deleted` decode). The
  relay cannot read `conversation_id` (inside Noise) or forge a delete (it cannot produce valid Noise
  ciphertext). No plaintext leak, no hang (no per-request timeout to strand).
- **[Threat model — hostile daemon response] Addressed.** No inbound decode is added; the
  `conversation_deleted` reply is not parsed here. Any defensive parsing of it is #367's.
- **[Threat model — renderer compromise reaching a destructive verb] OUT OF SCOPE → carried to #367.**
  Process isolation keeps the Noise keys and socket unreachable from the renderer; a compromised renderer
  can only send a validated `deleteConversation` command, not forge frames. The residual risk — a
  compromised renderer requesting deletion of a known id — is (a) daemon-authorized and auditable, and
  (b) fronted by the #367 confirmation gate (#226 pattern). **Carry-forward note for #367: the user-facing
  delete confirmation MUST land before a live caller is wired to this verb.** No fix is possible or needed
  on #364 — the verb is inert (dormant, no caller), so there is no live exposure to remediate here.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-14
