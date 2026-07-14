# Spec: `change_workspace` outbound transport (#379)

## Files to read first

Read these before writing anything. This verb is a **field-for-field clone** of the just-merged
`rename_conversation` (#359) sibling — the nearest match because **both carry two required strings**
(`conversation_id` + a second value-string). Read those exact sites, then reproduce them with the verb
string, payload-type name, and the second field (`name` → `cwd`) swapped. Do **not** clone the
single-field archive/unarchive/delete siblings — their guard and fresh-literal have one field, not two.

- `src/main/transport/renameConversationEnvelope.ts:1-47` — **the primary clone target for the new
  builder.** A whole file: MAIN-ONLY header, `RenameConversationInput` interface, `buildRenameConversation`.
  Copy its shape verbatim; swap `rename`→`changeWorkspace`, `rename_conversation`→`change_workspace`,
  `RenameConversationPayload`→`ChangeWorkspacePayload`, and rewrite the reply doc-comment sentence to name
  the target workspace path (the reply itself is identical — see Design §5).
- `src/main/transport/renameConversationEnvelope.test.ts:1-33` — **the clone target for the new test.**
  Two `it` cases: round-trip through the **real** codec, and over-cap `WireEncodeError`. Reproduce with
  `change_workspace` and a `{ conversation_id, cwd }` payload literal.
- `src/shared/wire/types.ts:40-83` — `EnvelopeType` union; add `'change_workspace'` here (siblings
  `'delete_conversation'` / `'rename_conversation'` at lines 78–79).
- `src/shared/wire/types.ts:649-668` — `RenameConversationPayload` interface + its two-required-strings
  no-drift doc-comment (the shape to mirror). Also read `PromoteConversationPayload:572-589` — its `cwd`
  doc-comment ("a renderer-supplied string that becomes a working directory SERVER-side; the desktop never
  resolves it into a filesystem path") is the exact security posture to reuse for this verb's `cwd`.
- `src/shared/ipc/commands.ts:18-104` — imports block + the `RendererCommand` union and its long
  doc-comment (rename member at line 101). Add the `changeWorkspace` member + import.
- `src/shared/ipc/commands.ts:166-212` — `isRendererCommand` switch (rename case at 193–194). Add the
  `case 'changeWorkspace'` arm.
- `src/shared/ipc/commands.ts:329-345` — `isRenameConversationPayload` guard: **the two present-and-string
  checks to clone.** Add `isChangeWorkspacePayload` next to it — same shape, second field renamed `cwd`.
- `src/shared/ipc/commands.test.ts:437-467` — the rename guard test block (accept both-string; accept
  empty-string second field; reject missing/null payload; reject wrong-typed/null/missing fields). Clone it
  for `changeWorkspace`.
- `src/main/daemonConnection.ts:24-72` — the wire-type import block (`type RenameConversationPayload` at
  line 67). Add `type ChangeWorkspacePayload`.
- `src/main/daemonConnection.ts:39-40` — the builder imports (`buildDeleteConversation` /
  `buildRenameConversation`). Add `buildChangeWorkspace`.
- `src/main/daemonConnection.ts:243-253` — the `renameConversation` **interface declaration**
  (doc-comment + signature); clone it for `changeWorkspace`.
- `src/main/daemonConnection.ts:1086-1113` — the `renameConversation` **method body**; clone it for
  `changeWorkspace` (fresh literal `{ conversation_id, cwd }`).
- `src/main/daemonConnection.ts:1281-1282` — the returned-object literal (`deleteConversation,
  renameConversation,`); add `changeWorkspace` to it.
- `src/main/daemonConnection.test.ts:2485-2551` — the `renameConversation` connection describe block (five
  `it` cases incl. the fresh-literal anti-smuggling assertion). Clone it for `changeWorkspace`.
- `src/main/index.ts:316-322` — the `case 'renameConversation'` dispatch arm; clone it for
  `changeWorkspace`.
- `CLAUDE.md` (repo root) — wire-type no-drift rule; the `src/shared/**` ↔ `src/main/**` codec-import
  boundary (the builder is main-only, imports `codec.ts` / `Buffer`; never re-export it through a renderer
  barrel).
- Memory: this is the documented "outbound wire-verb slice = 5 files, irreducible S" shape; the two-field
  sibling `rename_conversation` (#359, PR#362) shipped at S — see Scope self-check.

## Context

The daemon added the `change_workspace` verb (client→daemon) in pyrycode #823 (merged): it updates a
conversation's recorded workspace (`cwd`) and replies with the **existing** `conversation_updated` record.
Desktop has no outbound change-workspace verb. This ticket ships the transport half **dormant** — no
renderer caller — exactly as `rename_conversation` (#359) shipped ahead of its dialog (#360). The caller is
the Workspace Picker UI, the remaining split-child of #157, which lands separately.

**Two required strings, wire order `conversation_id, cwd`.** The second field's JSON key is **`cwd`, not
`workspace`** — the daemon flagged this as the single `cwd`-vs-`workspace` reconcile point and the merged
daemon uses `cwd`, matching `PromoteConversationPayload` / `ConversationCreatedPayload`. Do not drift it
(CLAUDE.md no-drift).

**Reply is free.** The daemon confirms with a `conversation_updated` record — a type the desktop **already
decodes** (types.ts:684, the same inbound path rename/promote/archive/unarchive already use). The
conversation list reflects the new workspace **for free** via that existing decode; there is **no new
inbound decode, no correlation, and no store change here.** (Whether the daemon technically sets
`in_reply_to` on that reply is immaterial to this slice — the desktop reflects `conversation_updated` via
the existing unsolicited-event path regardless, exactly as the rename/promote siblings do.)

## Design

Five production edits + one new builder + one new test. The clone is the `rename_conversation` slice with
the verb string, payload-type name, and second field swapped. There is **zero consumer fan-out** — a
brand-new additive verb with no call-site cascade. Naming across the slice (all derived from the
`change_workspace` wire verb): command member `changeWorkspace`, connection method `changeWorkspace`,
builder `buildChangeWorkspace`, file `changeWorkspaceEnvelope.ts`, payload `ChangeWorkspacePayload`, guard
`isChangeWorkspacePayload`.

### 1. `src/shared/wire/types.ts` — vocabulary + payload type

- Add `| 'change_workspace'` to the `EnvelopeType` union (next to `'rename_conversation'`, line 79).
- Add a `ChangeWorkspacePayload` interface next to `RenameConversationPayload` (after line 668):

  ```ts
  export interface ChangeWorkspacePayload {
    conversation_id: string
    cwd: string
  }
  ```

  Doc-comment mirrors `RenameConversationPayload`'s two-required-value-strings no-drift comment, adapted:
  wire order `conversation_id, cwd` (mirrors daemon SSOT pyrycode #823 field-for-field); both plain
  `string` (no pointer, no `omitempty`, so no explicit-`null` concern). `conversation_id` is a routing id
  (an existing row's id), not a secret. **`cwd` is a renderer-supplied string that becomes a working
  directory SERVER-side — the desktop never resolves it into a filesystem path** (reuse the
  `PromoteConversationPayload.cwd` wording). Note the field tag is `cwd`, **not** `workspace` (the daemon
  reconcile point; #823). Keep it a DISTINCT type (not an alias of any sibling) so the verb owns its own
  wire surface. Reply is the existing `conversation_updated` (no new inbound type here).

### 2. `src/shared/ipc/commands.ts` — command member + boundary guard

- Import `ChangeWorkspacePayload` in the `../wire/types` import block (lines 18–31).
- Add `| { type: 'changeWorkspace'; payload: ChangeWorkspacePayload }` to `RendererCommand` (after the
  `renameConversation` member, ~line 101). Extend the union's doc-comment with a one-clause note mirroring
  the rename/promote clauses: two REQUIRED strings (`conversation_id` + `cwd`, no secret) asking the daemon
  to move a conversation's workspace.
- Add `case 'changeWorkspace': return 'payload' in value && isChangeWorkspacePayload(value.payload)` to
  `isRendererCommand` (next to the rename case, ~line 194). **The lockstep rule the module already
  documents: a union member without a matching guard case is silently dropped at the boundary.**
- Add `isChangeWorkspacePayload` — a clone of `isRenameConversationPayload` (lines 337–345) with the second
  field's key `name` → `cwd`: both `conversation_id` and `cwd` must be present-and-string. Checks the
  **TYPE**, not emptiness: a literal `null`, a missing key, and a non-string are all rejected; an
  empty-string `cwd` passes (a valid wire value the daemon polices). Structural-minimum — a smuggled extra
  field is not rejected here; the main-side fresh-literal construction bounds the wire. Pure; never throws.

### 3. `src/main/daemonConnection.ts` — import + interface decl + method + export

- Add `import { buildChangeWorkspace } from './transport/changeWorkspaceEnvelope'` (next to lines 39–40)
  and `type ChangeWorkspacePayload` to the wire-type import (line 67 region).
- Add the `changeWorkspace(payload: ChangeWorkspacePayload): void` **interface declaration** (clone the
  rename decl at lines 243–253): `send` twin, inert no-op when `driver === null`, fire-and-forget, ships
  DORMANT, never throws (parity #490). Reply doc-comment: the daemon confirms by replying with a
  `conversation_updated` record, **decoded by the existing inbound path** and reflected in the list for free;
  not correlated here (its caller, the Workspace Picker, reads the new workspace from the re-list). Its
  caller is the Workspace Picker UI (#157's remaining slice), which lands separately.
- Add the `changeWorkspace` **method body** — a clone of `renameConversation` (lines 1086–1113): `if
  (driver === null) return`; inside `try`, `buildChangeWorkspace({ id: nextEnvelopeId, ts: now(), payload:
  { conversation_id: payload.conversation_id, cwd: payload.cwd } })`; `nextEnvelopeId += 1`;
  `driver.sendMessage(bytes)`; bare `catch {}` that drops the caught object (classify-don't-forward — the
  message could echo the payload, **including the `cwd` path**). **Fresh literal `{ conversation_id, cwd }` —
  never a spread of `payload`.** Shares the one monotonic `nextEnvelopeId` (no second counter).
- Add `changeWorkspace` to the returned-object literal (next to lines 1281–1282).

### 4. `src/main/index.ts` — dispatch arm

- Add `case 'changeWorkspace':` to the command switch (next to the rename arm at 316–322): comment mirrors
  the rename arm — direct to the connection method, no orchestrator; sends `change_workspace`; the daemon
  confirms by replying with a `conversation_updated` record, decoded by the existing path and reflected in
  the list for free, not correlated here; inert no-op when not connected. Then `connection.changeWorkspace(
  command.payload); return`.

### 5. `src/main/transport/changeWorkspaceEnvelope.ts` — NEW builder

Clone `renameConversationEnvelope.ts:1-47` structure exactly:

- MAIN-PROCESS ONLY header comment (imports `codec.ts` / Node `Buffer`; never re-export through a renderer
  barrel — raw bytes stay out of the web layer).
- `ChangeWorkspaceInput { id: number; ts: string; payload: ChangeWorkspacePayload }` interface.
- `buildChangeWorkspace(input): Uint8Array` — constructs `{ id, type: 'change_workspace', ts, payload }`
  and returns `encodeEnvelope(envelope)`. Two required strings, so the payload serializes verbatim (no
  explicit-`null` preservation concern). MAY throw `WireEncodeError` over `MAX_PLAINTEXT_BYTES`; the sole
  caller (`connection.changeWorkspace`) catches it and drops the send.

## State + concurrency model

No new state. No store slice, no async task, no subscription. The verb is a synchronous fire-and-forget:
build bytes → `driver.sendMessage` → return. It shares the connection's single monotonic `nextEnvelopeId`
counter (advanced only on a successful build, so a dropped over-cap send does not burn an id) — no new
counter, no interleaving hazard beyond what the existing send/rename/archive methods already tolerate. No
reply is correlated or awaited (no pending-request map entry), so there is no dangling-correlation risk when
sent while disconnected. The reply's list-reflection rides the **existing** `conversation_updated` decode —
this ticket adds no inbound wiring.

## Error handling

- **Boundary reject (untrusted renderer→main):** `isChangeWorkspacePayload` rejects any payload whose
  `conversation_id` or `cwd` is not a present string. A rejected command is dropped at `isRendererCommand`
  — it never reaches the connection method.
- **Over-cap plaintext:** `buildChangeWorkspace` throws `WireEncodeError`; the connection method's
  `try/catch` drops it (no send, no log, no event — the message could echo the payload). `nextEnvelopeId` is
  not advanced (the `+= 1` sits after the build).
- **Disconnected:** `driver === null` → inert no-op return before the try.
- **Any driver/wasm throw:** same bare `catch` drops it. **Never throws out of the module** (parity #490).
- No inbound decode path is added, so there is no new parse-failure surface here.

## Testing strategy

Two test blocks to clone from the rename sibling (the builder test alone is **not** sufficient — the
boundary guard and the connection method need their own coverage; the command-boundary tests are per-verb
explicit blocks, not a structural loop, so a new verb gets zero coverage from them). Write in the project's
vitest idiom against the **real** codec (bullet-pointed scenarios, not pre-written bodies):

**New file `src/main/transport/changeWorkspaceEnvelope.test.ts`** (clone `renameConversationEnvelope.test.ts`):
- **Round-trip:** `buildChangeWorkspace({ id: 2, ts: FIXED_TS, payload: { conversation_id: <id>, cwd: <path> } })`
  decoded via `decodeEnvelope` yields `type === 'change_workspace'`, the exact `id`, `ts`, and `payload`
  (assert `envelope.payload` toEqual the input — pins that both fields serialize verbatim, no drift, no
  smuggled key).
- **Over-cap:** a `cwd` of `'x'.repeat(MAX_PLAINTEXT_BYTES + 1)` makes the builder throw `WireEncodeError`.

**In `src/shared/ipc/commands.test.ts`** (clone the rename guard block at 437–467), for `changeWorkspace`:
- accepts a well-formed command with both string fields (and with a smuggled `extra` key — structural
  minimum);
- accepts an empty-string `cwd` (guard checks type, not emptiness);
- rejects a missing/null payload;
- rejects when either field is wrong-typed, a literal `null`, or missing.

**In `src/main/daemonConnection.test.ts`** (clone the `renameConversation` describe block at 2485–2551), for
`changeWorkspace`:
- no-op before `start()`: no driver, nothing forwarded, no throw (the send twin, not a fail);
- after `handshake-complete`, forwards **one** `change_workspace` envelope with `id` 2, the fixed `ts`, and
  the exact payload;
- shares the one envelope-id counter with `send` (no second counter);
- does not throw out of the module when the driver `sendMessage` throws (parity #490);
- **fresh-literal anti-smuggling:** call `changeWorkspace` with an extra key smuggled via `as unknown as
  ChangeWorkspacePayload`; assert the sent payload is exactly `{ conversation_id, cwd }` and that the
  serialized bytes do not contain the smuggled key.

The four additive edits (union member, guard case, interface decl + method + export, dispatch arm) also
compile-check under `npm run typecheck` (they do not typecheck apart — see Scope self-check). No new render
test — the verb is dormant, no UI. Gate: `npm run build` (typecheck + build) is the salvage/QA gate.

## Scope self-check (5-file count is a documented false positive — do NOT split)

The §4 "≥5 production `.ts` files" gate counts **5** here: `types.ts`, `commands.ts`, `daemonConnection.ts`,
`index.ts`, `changeWorkspaceEnvelope.ts`. This is a **verified false positive**, not a rationalization, on
three independent grounds:

1. **Compile-atomic — no valid split exists.** The union member, boundary guard, dispatch arm, connection
   method, and builder export **do not typecheck apart**. Any split yields a non-compiling child that fails
   `npm run build` (the QA gate). There is no Strangler-Fig seam — the §4 remediation ("name 2–3 child
   slices at seams") is unsatisfiable by construction.
2. **Empirical: this exact 5-file shape shipped repeatedly at S.** The two-field sibling
   `rename_conversation` (#359, PR#362) and the single-field siblings `unarchive_conversation` (#346, PR#357)
   / `delete_conversation` (#364, PR#371) all ship this identical shape and merged at S. The §4 gate's own
   cited failure (#311) was the *opposite* error — a claim of 4 files that was actually 13. Here the count is
   honest (exactly 5, verified against the merged siblings) and nothing is hidden.
3. **Tiny turn budget.** ~55 lines of production code, **zero consumer fan-out** (0 call-site cascade),
   ≤5 new exported symbols, ACs that are facets of one verb, ≤2 reject branches. Three of the five files are
   single-line vocabulary additions (the `EnvelopeType` member, the command-union member, the
   returned-object key).

Proceed at S with this note recorded so code-review and the operator see the reasoning. Do not bounce to PO
— a split would force non-compiling children.

## Open questions

None. The wire contract is CONFIRMED against pyrycode #823 (per the ticket, do not re-derive): request
`{ conversation_id, cwd }` (wire order `conversation_id, cwd`, field tag `cwd`), reply the existing
`conversation_updated` (already decoded, free list-reflect). The Workspace Picker UI that dispatches this
verb is out of scope here (#157's remaining slice).

## Security review

**Verdict:** PASS

This verb differs from its rename/archive/unarchive siblings in one security-relevant way: **the second
field, `cwd`, is a filesystem-path-shaped string.** The pass focused there — specifically on whether any
on-device code path resolves that untrusted string into a real path. It does not: the transport only
serializes `cwd` into wire bytes; the desktop never touches a local `fs`/`path` API with it. Path policing
is the daemon's concern, server-side (#823).

**Findings:**

- **[Trust boundaries] No findings.** Single explicit renderer→main boundary: `isRendererCommand` →
  `isChangeWorkspacePayload` (present-and-string on **both** `conversation_id` and `cwd`), then the main-side
  connection method rebuilds a **fresh literal `{ conversation_id, cwd }`** (never a spread of the incoming
  payload). A renderer cannot smuggle an extra field onto the wire. The guard checks type/shape, not
  authorization — a buggy/compromised renderer could request a move for any id it knows, but the daemon is
  the authority on which path is valid and applies it server-side, and this ticket ships **dormant** (no
  caller), so there is no live exposure.
- **[Tokens/secrets] No findings — N/A by design.** No token is minted, stored, or logged. Both fields are
  routing/opaque strings, not secrets. The command union's AC5 (no member exposes a token/key/raw-frame
  field) holds by construction — `ChangeWorkspacePayload` has exactly two string fields.
- **[File / storage] No findings — the focus of this pass, and it is clean.** `cwd` is filesystem-shaped but
  is **never resolved into a local path.** Traced end to end: `isChangeWorkspacePayload` (type check) →
  fresh literal → `encodeEnvelope` (JSON → bytes) → `driver.sendMessage` (Noise). No `path.join` /
  `path.resolve` / `fs.*` call touches `cwd`; it is carried as opaque wire bytes exactly like
  `PromoteConversationPayload.cwd`. Therefore no path-traversal (`../` escape), no TOCTOU, no local file
  write — those surfaces do not exist on-device. A hostile `cwd` (e.g. `../../etc`) is inert to the desktop;
  the daemon polices it server-side (#823). An over-long `cwd` is bounded by `MAX_PLAINTEXT_BYTES` →
  `WireEncodeError` → dropped, no unbounded allocation.
- **[Electron attack surface] No findings.** No new `BrowserWindow` / `webPreferences` / `contextBridge`
  API / custom protocol. One member added to the **existing** sealed `pyry:command` union (not a new
  channel), validated by `isChangeWorkspacePayload` before use — a minimal "change workspace by id"
  capability, not a raw one. The builder is MAIN-ONLY (imports `codec.ts` / `Buffer`), never re-exported
  through a renderer barrel, so raw bytes and the socket stay out of the web layer.
- **[Cryptographic primitives] No findings — N/A.** No crypto touched. The envelope is encrypted by the
  existing Noise session downstream of `driver.sendMessage`; this ticket only builds plaintext bytes.
  `nextEnvelopeId` is a monotonic counter, not security-relevant randomness. No key/nonce/comparison.
- **[Network & I/O] No findings — N/A.** No new socket, frame-size config, relay-URL handling, or
  timeout/reconnect logic. The outbound frame is bounded by the inherited `MAX_PLAINTEXT_BYTES` →
  `WireEncodeError` check. No inbound decode is added, so no new parse surface.
- **[Error messages / logs] No findings.** The connection method's bare `catch {}` DROPS the caught object
  with no log — deliberately, so an error string cannot echo the payload, **including the `cwd` path**
  (classify-don't-forward, #62). No `console.log` of `conversation_id` or `cwd`. No telemetry.
- **[Concurrency] No findings — N/A.** Synchronous fire-and-forget: build → `driver.sendMessage` → return.
  No `await` in the method, no new async task/timer/listener. Shares the one monotonic `nextEnvelopeId`
  (advanced only on a successful build). No check-then-act race — there is no await point between the
  `driver === null` guard and the send.
- **[Threat model — hostile relay] Addressed.** Content-blind and on-path: it can drop/delay/reorder the
  `change_workspace` frame. A dropped frame → the workspace change silently does not happen
  (fire-and-forget, no ack awaited here; the Workspace Picker owns any "did it work?" feedback via the
  existing `conversation_updated` re-list). The relay cannot read `cwd` (inside Noise) or forge a change (it
  cannot produce valid Noise ciphertext). No plaintext leak, no hang (no per-request timeout to strand).
- **[Threat model — hostile daemon response] Addressed.** No inbound decode is added; the
  `conversation_updated` reply is decoded by the **existing, unchanged** path — this ticket introduces no
  new parse surface for a malformed/oversized reply.
- **[Threat model — renderer compromise reaching the transport] OUT OF SCOPE → carried to the Workspace
  Picker.** Process isolation keeps the Noise keys and socket unreachable from the renderer; a compromised
  renderer can only send a validated `changeWorkspace` command (a known `conversation_id` + an
  attacker-chosen `cwd`), not forge frames. The residual risk — a compromised renderer requesting a
  workspace move to an attacker-chosen path — is (a) daemon-authorized and applied server-side (the daemon
  is the authority on a valid path), and (b) **reversible** (unlike delete #364; a workspace can be changed
  again). It ships **dormant** (no caller), so there is no live exposure to remediate here. **Carry-forward
  note for the Workspace Picker (#157's UI slice): the picker should source `cwd` from a validated folder
  chooser rather than free text**, but that is the picker's UX concern — the transport guard is type-only,
  matching every sibling verb.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-14
