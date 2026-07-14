# #381 — `create_workspace_folder` transport: send create, decode the created folder

**Size:** S (documented atomicity exception — see § Scope).
**Security-sensitive:** yes (encodes an outbound frame + parses an inbound reply on the internet-exposed relay socket, main process). See § Security review at the end.
**UI:** none. The command + event ship **dormant** — no renderer consumer until the Create-folder dialog (#157's remaining UI slice). No Figma (not UI-visible).

## Files to read first

The whole ticket is a 1:1 clone of the `create_conversation` vertical (#241, PR #244), refined at the single-field reply layer to the `conversation_deleted` idiom (#375). Read the sibling before writing each layer; every new line has an existing twin two doors down in the same file.

- `src/main/transport/createConversationEnvelope.ts` (whole file, 47 lines) — **the outbound builder to clone.** Pure `(id, ts, payload) → Uint8Array` via `encodeEnvelope`. Your `createWorkspaceFolderEnvelope.ts` is this with `create_conversation` → `create_workspace_folder` and `CreateConversationPayload` → `CreateWorkspaceFolderPayload`.
- `src/main/transport/createConversationEnvelope.test.ts` (whole file, 51 lines) — **the builder test to clone.** Round-trip populated + over-cap `WireEncodeError`. Adapt the fixtures to `{ parent, name }`.
- `src/main/transport/inboundMessage.ts:660-666` (`parseConversationDeletedPayload`) — **the decoder to clone** (single required string, fresh single-field object). Also read `:583-587` (`parseRecentWorkspace`, the `path`-is-opaque posture) and `:1004-1017` (the `conversation_deleted` switch case: narrow-before-log, content-free log). Your decoder is `parseConversationDeletedPayload` with field `id` → `path`.
- `src/main/transport/inboundMessage.ts:162-188` — the `InboundDaemonMessage` union; add one `kind`. `:190-204` — `isRecord` + `requireString` (reuse verbatim, no new helper).
- `src/shared/wire/types.ts:56-86` — the `WireType` union (add two members) + `Envelope`. `:544-592` — `RecentWorkspace` / `CreateConversationPayload` / `ConversationCreatedPayload` (the doc-comment style + no-drift discipline to mirror). `:667-669` — `DeleteConversationPayload` (a single-field payload's shape).
- `src/shared/ipc/commands.ts:97-114` (union), `:196-227` (`isRendererCommand` switch), `:362-378` (`isChangeWorkspacePayload` — **the two-required-string guard to clone**, rekeyed `conversation_id`/`cwd` → `parent`/`name`). Note: `create*`/`change*` members have **no** constructor function — do not add one.
- `src/shared/ipc/commands.test.ts` — grep `isChangeWorkspacePayload` / `changeWorkspace`; clone the accept/reject block.
- `src/shared/ipc/events.ts:76-104` (the `DaemonEvent` union head) + `:209-220` (`conversationDeleted` — **the flattened single-field arm to clone**). This is the load-bearing design call; see § Design.
- `src/main/daemonConnection.ts:176-185` (interface method doc + signature), `:953-980` (`createConversation` impl — **the method to clone**), `:669-679` (`conversation-created` inbound emit — **the emit to clone**), `~:1362` (the returned-object literal — add one entry). Also `:35-36` imports.
- `src/main/daemonConnection.test.ts:269-271` (`conversationCreatedPlaintext` helper) + `:2204-2314` (**the full connection-method + decode test block to clone** — no-op-before-start, forwards envelope, shares id counter, parity-#490 no-throw, strips-smuggled-extra-field, decodes-inbound, drops-malformed).
- `src/main/index.ts:276-281` — the `createConversation` dispatch arm to clone.
- `src/renderer/src/store/daemonEventBridge.ts:78-83`, `src/renderer/src/store/modalBridge.ts:79-94`, `src/renderer/src/store/timelineBridge.ts:105-119` — **the three exhaustive `assertNever` bridges.** Each explicitly lists `conversationDeleted` / `recentWorkspacesReceived` as no-op cases; add `workspaceFolderCreated` alongside them. (The other ~7 bridges have a `default` clause and absorb the new arm automatically — do **not** touch them.)
- Daemon SSOT (context only, do not import): QMD `pyrycode-docs/knowledge/codebase/887.md` + `pyrycode-docs/specs/architecture/887-create-workspace-folder-wire-message.md`. Go structs `CreateWorkspaceFolderPayload{Parent, Name string}` / `WorkspaceFolderCreatedPayload{Path string}`.

## Context

The daemon now serves a `create_workspace_folder` request/reply verb (pyrycode #887, PR #889, merged): given a `parent` path and a folder `name`, it creates the folder **confined to the operator's `$HOME`** (two deterministic server-side gates: `$HOME` confinement + single-clean-element name check) and replies with the created folder's canonical `path`. This ticket ports the desktop client's **transport half** — the outbound builder plus the decode of the new inbound reply. The Create-folder dialog UI is #157's remaining slice.

This is the `create_conversation` **full-vertical** shape (#241): a new outbound builder **and** a distinct inbound reply decode with its own payload type. It differs from its two family siblings — #379 `change_workspace` reflected through the existing `conversation_updated` broadcast (no new decode), and #380 `recent_workspaces` is inbound-only. Here **both halves are new**.

## Design

Two new wire payload types, one new outbound command + guard + dispatch, one new inbound decode + `InboundDaemonMessage` kind + `DaemonEvent` arm, and three exhaustive-bridge no-ops. Every piece is a mechanical clone of a named sibling. The layers, top (renderer boundary) to bottom (wire), then back up (inbound):

### 1. Wire types — `src/shared/wire/types.ts`

Add two members to the `WireType` union (`:73-82`, in the workspace/conversation-write group, after `'change_workspace'`):

```
| 'create_workspace_folder'   // outbound request
| 'workspace_folder_created'  // inbound reply
```

Add two fresh interfaces (near `ChangeWorkspacePayload`, `:710`). **Do NOT reuse `RecentWorkspace` (carries `last_used_at`) or `ConversationSummary`/`ConversationCreatedPayload` — the reply is `path`-only.** This mirrors #241, where `ConversationCreatedPayload` is its own shape.

```
// Outbound create_workspace_folder request body (client → daemon). Mirrors the daemon's
// CreateWorkspaceFolderPayload{Parent, Name string} field-for-field (pyrycode #887), wire order
// `parent, name`. TWO REQUIRED value-strings (plain string, no pointer, no omitempty) — the
// ChangeWorkspacePayload posture, rekeyed. `parent`/`name` are renderer-supplied strings the
// daemon polices SERVER-side ($HOME confinement + single-clean-element name guard, #887's two
// deterministic gates); the desktop NEVER resolves them into a local filesystem path (serialized
// to wire bytes only). An empty parent / bad name is a valid string on the wire — the daemon
// rejects it as `malformed`; do NOT add a client-side check. No-drift (CLAUDE.md).
export interface CreateWorkspaceFolderPayload {
  parent: string
  name: string
}

// Inbound workspace_folder_created reply body (daemon → client). Mirrors the daemon's
// WorkspaceFolderCreatedPayload{Path string} field-for-field (pyrycode #887). ITS OWN single-field
// shape — deliberately NOT RecentWorkspace (which adds last_used_at) nor a conversation type. `path`
// is the created folder's canonical daemon-side path, an untrusted REMOTE path carried as OPAQUE
// DISPLAY TEXT: this client never fs-/path.resolve-s it and never logs its value (the RecentWorkspace
// #380 / ConversationSummary.cwd #139 posture). Direct reply to the requester (in_reply_to), no
// broadcast. No-drift (CLAUDE.md).
export interface WorkspaceFolderCreatedPayload {
  path: string
}
```

### 2. Outbound command + guard — `src/shared/ipc/commands.ts`

- Import `CreateWorkspaceFolderPayload`.
- Add union member: `| { type: 'createWorkspaceFolder'; payload: CreateWorkspaceFolderPayload }`.
- Add `isRendererCommand` case: `case 'createWorkspaceFolder': return 'payload' in value && isCreateWorkspaceFolderPayload(value.payload)`.
- Add guard `isCreateWorkspaceFolderPayload` — an exact clone of `isChangeWorkspacePayload` (`:370`) with keys `conversation_id`/`cwd` → `parent`/`name`: both present-and-string (TYPE check, not emptiness — an empty string passes; the daemon polices it). Structural minimum; the fresh-literal in the connection method bounds the wire.
- **No constructor function** (`createConversation`/`changeWorkspace` have none — the future dialog builds the object inline).

### 3. Inbound event arm — `src/shared/ipc/events.ts`

Add ONE arm to `DaemonEvent`. **This is the one genuine design call: flatten, don't carry by reference.**

```
| { type: 'workspaceFolderCreated'; path: string }
```

Clone the `conversationDeleted` arm (`:209-220`), **not** `conversationCreated` (`:199`). Rationale, explicit so code-review does not flag a "deviation from clone #241":
- `conversationCreated` carries `ConversationCreatedPayload` **by reference** because it has 5 fields with nothing to drop.
- `conversationDeleted` **flattens** to `id: string` because it is a single-field reply — the codebase's documented single-field-emit idiom (`turnState` naming `state`, `sessionSettingsUpdated` naming `sessionId`): a fresh literal naming the one field, keeping `events.ts` free of the payload-type import (a primitive crosses IPC).
- `WorkspaceFolderCreatedPayload` has **exactly one field** (`path`) — structurally identical to `conversationDeleted`. So flatten to `path: string`. The dialog (#157) needs the created path as a plain string; a bare string is exactly what it consumes.

Doc-comment must carry the standard untrusted-text warning (mirror `conversationDeleted` / `recentWorkspacesReceived`): `path` is untrusted daemon-supplied REMOTE path text; the #157 render slice must render it as **plain text, never HTML** (no `innerHTML` / `dangerouslySetInnerHTML`) and **never resolve it into a local filesystem operation**. This ticket has no DOM sink; the constraint is inherited for #157. Ships **dormant** — all three exhaustive bridges no-op it (the `conversationDeleted`-was-a-no-op-until-#376 precedent).

### 4. Inbound decode — `src/main/transport/inboundMessage.ts`

- Import `WorkspaceFolderCreatedPayload`.
- Add `InboundDaemonMessage` kind: `| { kind: 'workspace-folder-created'; workspaceFolderCreated: WorkspaceFolderCreatedPayload }` (transport-internal, carries the payload by reference — the flatten happens only at the `events.ts` emit).
- Add `parseWorkspaceFolderCreatedPayload` — clone `parseConversationDeletedPayload` (`:660-666`): `isRecord` guard, then a single `requireString(payload, 'path')`, return `{ path }`. Reuse the existing `requireString`; **no new helper.** Category-only error message (`requireString` already emits `missing required field: path` — never interpolate the value, a `path` could echo `$HOME`/username).
- Add switch case `case 'workspace_folder_created':` — clone the `conversation_deleted` case (`:1004-1017`): narrow **before** logging (a malformed reply throws first and leaves no record), content-free `inbound-decoded` log (`code: 'workspace_folder_created'`, `bytes`, `hash` — **no `path`, no `count`**, reusing the existing DiagnosticEvent field set so #131's renderer pin is untouched), return `{ kind: 'workspace-folder-created', workspaceFolderCreated }`.

### 5. Connection method + inbound emit — `src/main/daemonConnection.ts`

- Import `buildCreateWorkspaceFolder` from `./transport/createWorkspaceFolderEnvelope` and the `CreateWorkspaceFolderPayload` type.
- Interface: add `createWorkspaceFolder(payload: CreateWorkspaceFolderPayload): void` with a doc comment cloned from `createConversation` (`:177-185`) — the `send` twin, inert no-op when `driver === null`, reply arrives async as one `workspaceFolderCreated` event consumed by #157, never throws (parity #490).
- Impl: clone `createConversation` (`:953-980`) — `if (driver === null) return`; `try { const bytes = buildCreateWorkspaceFolder({ id: nextEnvelopeId, ts: now(), payload: { parent: payload.parent, name: payload.name } }); nextEnvelopeId += 1; driver.sendMessage(bytes) } catch { /* drop, parity #490 */ }`. **Fresh literal naming exactly `parent`/`name`** — never a spread of `payload` — this is the deterministic net that strips any renderer-smuggled extra key past the structural guard. Shares the one `nextEnvelopeId` counter.
- Inbound emit: add `case 'workspace-folder-created':` beside `conversation-created` (`:669-679`) — flatten at the emit: `emitDaemonEvent(sink, { type: 'workspaceFolderCreated', path: inbound.workspaceFolderCreated.path }); return`.
- Returned object literal (`~:1362`): add `createWorkspaceFolder,`.

### 6. Outbound builder — `src/main/transport/createWorkspaceFolderEnvelope.ts` (NEW)

Clone `createConversationEnvelope.ts` whole. Signature: `buildCreateWorkspaceFolder(input: { id: number; ts: string; payload: CreateWorkspaceFolderPayload }): Uint8Array`. Body wraps `{ id, type: 'create_workspace_folder', ts, payload }` in `encodeEnvelope`. MAIN-PROCESS ONLY (imports `codec.ts`); the header comment must forbid re-export through any renderer barrel. MAY throw `WireEncodeError` on over-cap; the sole caller catches.

### 7. Main-process dispatch — `src/main/index.ts`

Add `case 'createWorkspaceFolder':` beside `createConversation` (`:276-281`): `connection.createWorkspaceFolder(command.payload); return`. Comment mirrors the sibling (direct to the connection method, no orchestrator; sends `create_workspace_folder`, daemon replies with one `workspace_folder_created` → `workspaceFolderCreated` event; inert no-op when not connected).

### 8. Three exhaustive bridge no-ops

Add `case 'workspaceFolderCreated':` (falling through to the shared no-op `return null` / `return undefined`, exactly as the sibling arms do) to:
- `src/renderer/src/store/daemonEventBridge.ts` (beside `:78 conversationDeleted` / `:83 recentWorkspacesReceived`)
- `src/renderer/src/store/modalBridge.ts` (beside `:79-80`)
- `src/renderer/src/store/timelineBridge.ts` (beside `:105-106`)

Update the shared no-op comment in each to mention #157 as the eventual consumer (matching how each already names #376 / #382). **Do not touch the other bridges** — they have a `default` clause and absorb the new arm.

## State + concurrency model

No store, no async iterable, no subscription lifecycle. The command is a fire-and-forget send twin (`send` posture): inert no-op when not connected, one monotonic `nextEnvelopeId` shared across all send paths (id advances only on successful build). The reply is a one-shot correlated frame decoded synchronously in the existing inbound `message` path and emitted verbatim (flattened) as a single `DaemonEvent` — no outstanding-request memory is threaded (the `conversationCreated` posture; a single create-folder at a time, the dialog owns UX). Teardown is unchanged — this adds no new resource.

## Error handling

- **Outbound over-cap / driver throw:** caught and dropped inside `createWorkspaceFolder` (parity #490 — never throws out of the module; the caught object could echo the payload, so no log, no event).
- **Inbound malformed reply** (missing/non-string `path`, non-object payload): `parseWorkspaceFolderCreatedPayload` throws `WireDecodeError`; the existing inbound catch drops it (no emit, no throw) — fail-closed, category-only message, no `path` interpolated, no record left.
- **Daemon rejection** (bad `name`, empty `parent` → `malformed` daemon error, correlated by `in_reply_to`): **out of scope for this ticket.** It rides the existing generic correlated `daemon-error` path; **no new inbound arm** is added here. Surfacing it via the #248 rejection-surface mechanism is the Create-folder dialog's job (#157) — this transport ticket does not register rejection-correlation state (symmetric with `create_conversation`, which registers none).

## Testing strategy (`npm test`, vitest; `npm run typecheck`)

Clone the sibling test blocks; adapt fixtures to `{ parent, name }` / `{ path }`. All in the project's existing idiom (fakes, not mocks; real codec for byte-pinning).

**Builder** — `src/main/transport/createWorkspaceFolderEnvelope.test.ts` (NEW, clone `createConversationEnvelope.test.ts`):
- Round-trips a `create_workspace_folder` envelope carrying exactly `{ parent, name }` (decode + assert `type`, `id`, `ts`, `payload`).
- Throws `WireEncodeError` when the serialized envelope exceeds `MAX_PLAINTEXT_BYTES` (over-long `name`).

**Decode** — `src/main/transport/inboundMessage.test.ts` (add a block):
- Decodes a `workspace_folder_created` frame into `{ kind: 'workspace-folder-created', workspaceFolderCreated: { path } }`.
- Fail-closed: missing `path`, non-string `path` (number/null/object), and a non-object payload each **throw** `WireDecodeError` (never a partial value).
- Anti-smuggle at decode: an extra server-added key is tolerated but **not** copied through — the returned object is exactly `{ path }`.
- (If the file asserts the diagnostic log, mirror the `conversation_deleted` content-free assertion: type/bytes/hash only, `path` never logged.)

**Command guard** — `src/shared/ipc/commands.test.ts` (add a block, clone `changeWorkspace`):
- `isRendererCommand` **accepts** `{ type: 'createWorkspaceFolder', payload: { parent, name } }`.
- **Rejects** a missing key, a `null` field, and a non-string field for each of `parent`/`name`.

**Connection method + decode round-trip** — `src/main/daemonConnection.test.ts` (add a block, clone `:2204-2314`):
- No-op before `start()` (no driver, nothing forwarded, no throw — the send twin, not a fail).
- After handshake-complete, forwards one `create_workspace_folder` envelope with the expected id, `ts`, and exactly `{ parent, name }`.
- Shares the one envelope-id counter with `send` (no second counter).
- Does not throw out of the module when `driver.sendMessage` throws (parity #490).
- **Anti-smuggling (AC4):** a smuggled extra key on the payload never reaches the wire — assert `payload` deep-equals `{ parent, name }` AND `JSON.stringify(payload)` does not contain the smuggled marker (fresh-literal bound).
- Decodes an inbound `workspace_folder_created` into exactly one `{ type: 'workspaceFolderCreated', path }` event (add a `workspaceFolderCreatedPlaintext` helper beside `conversationCreatedPlaintext`, `:269`).
- Drops a malformed `workspace_folder_created` reply without emitting or throwing (fail-closed).

**Type-level (`npm run typecheck`):** the exhaustive `assertNever` in the three bridges makes the new `DaemonEvent` arm compile-forced — a missing bridge case fails the build. The `isRendererCommand` / inbound-switch exhaustiveness is likewise compile-checked.

**Bridge tests:** extend `daemonEventBridge.test.ts` / `modalBridge.test.ts` / `timelineBridge.test.ts` **only if** they assert per-arm no-ops in the style used for `conversationDeleted` (grep each `.test.ts` for `conversationDeleted`); follow whatever posture the sibling arm took. If they only assert representative arms, no test change is needed — the `assertNever` compile-check is the guard.

## Scope — atomicity exception (do NOT split, do NOT bounce the §4 gate)

This touches ~10 production `.ts` files, tripping the ≥5-file red line and the §4 commit-time self-check. **This is the documented false positive**, not a real oversize:

- **Compile-atomic and irreducible.** The new `DaemonEvent` arm and its three `assertNever` consumers must build together; a decode/builder split makes both halves touch `types.ts` + `daemonConnection.ts`. There is no sub-5-file version that compiles.
- **Zero consumer cascade.** The command and event ship **dormant** — no renderer reads them yet (the three bridges only *no-op* the arm). The edit fan-out is 0 call sites needing coordinated updates. Every edit is a 1:1 clone of a sibling already present in the same file — near-zero per-edit design/exploration cost.
- **Precedent, cross-repo-validated.** #241 (PR #244), #139, #380 (PR #388) all shipped this exact ~8-10-file shape at S with no `max_turns`. The daemon side of *this very feature* (#887) hit the identical ≥5-file false-positive and shipped clean at ~480 prod LOC.
- **Total written LOC** (prod + tests) projects to ~400-450 — well inside the ~600 total-LOC band. Single-field decode + two-field outbound + no client-side policing keeps it the *leanest* member of the family.

Projected production files (10): `types.ts`, `createWorkspaceFolderEnvelope.ts` (new), `inboundMessage.ts`, `commands.ts`, `events.ts`, `daemonConnection.ts`, `index.ts`, `daemonEventBridge.ts`, `modalBridge.ts`, `timelineBridge.ts`.

## Open questions

None blocking. Two resolved calls recorded for code-review:
1. **Events arm flattened (`path: string`), not by-reference** — the `conversationDeleted` #375 single-field idiom, not the `conversationCreated` #241 by-reference idiom. Deliberate; see § Design 3.
2. **Rejection path out of scope** — rides the generic correlated `daemon-error`; #157 wires the #248 surface. No rejection-correlation state registered here (symmetric with `create_conversation`).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. Two explicit single-function boundaries. Renderer→main: `isCreateWorkspaceFolderPayload` (structural-minimum guard at the `pyry:command` `ipcMain` boundary) **plus** the fresh-literal `{ parent: payload.parent, name: payload.name }` in `createWorkspaceFolder`, which deterministically strips any smuggled extra key the structural guard let through (AC4-tested, belt-and-suspenders is code, not a rule). Daemon-socket→main: `parseWorkspaceFolderCreatedPayload`, fail-closed (`isRecord` + `requireString`, throws `WireDecodeError` on any mismatch). Main→renderer: `path` crosses as a bare untrusted string, flagged plain-text-only. No scattered parsing.
- **[Tokens/secrets]** N/A by design. This vertical mints no token, stores no secret, compares nothing to a secret, and uses no RNG — the shared `nextEnvelopeId` is a plain monotonic counter (not security-relevant), `now()` is a timestamp. `parent`/`name`/`path` are not secrets.
- **[File / storage] (crux)** No findings. **No desktop code path constructs a local filesystem path from any of the three strings.** Outbound `parent`/`name` are serialized to wire bytes only (`encodeEnvelope` → JSON → `Uint8Array`); inbound `path` is decoded as an opaque string, emitted as a bare string, and never `fs`- / `path.resolve`-d. No `path.join`, no `fs.*`, no writes → no path traversal, no TOCTOU, no atomic-write concern, all structurally impossible because the filesystem is never touched. The daemon is the sole FS-policy authority ($HOME confinement + single-clean-element name guard, #887's two deterministic gates); the desktop correctly does **not** duplicate or pretend to enforce it.
- **[Electron attack surface]** No findings. Adds no new `ipcMain.handle` channel and no new `contextBridge` API — it extends the existing sealed `RendererCommand` union that already has a validated boundary; the argument (`parent`/`name`, present-and-string) is validated before use and the exposed capability is minimal ("create a folder with two strings", not a raw fd/socket/exec). Decode, raw bytes, and the builder stay MAIN-process only (the builder header forbids renderer-barrel re-export, per CLAUDE.md); the renderer receives only the parsed `path` string. No window/`webPreferences`/protocol/navigation change.
- **[Cryptographic primitives]** N/A by design. Touches no crypto; the Noise session, AEAD framing, and codec are pre-existing and unmodified. No key/nonce handling.
- **[Network & I/O]** No findings. Size-bounded both directions: the inbound `MAX_PLAINTEXT_BYTES` guard in `parseInboundMessage` covers the new `workspace_folder_created` case (same function, checked before `decodeEnvelope`); the outbound builder throws `WireEncodeError` on over-cap. Relay URL / TLS / reconnect / timeout discipline is inherited from the existing transport and untouched. A hostile relay flooding `workspace_folder_created` frames hits fail-closed decode with no accumulation (the arm is dormant — no store retains it).
- **[Error messages, logs, telemetry] (co-crux)** No findings. The outbound catch drops the caught object with **no log** (its message could echo `parent`/`name`). The inbound diagnostic log is content-free — `code`/`bytes`/`hash` only, **never `path`, never a `count`**, reusing the existing `DiagnosticEvent` field set (so #131's renderer pin stays untouched). The `WireDecodeError` message is category-only (`missing required field: path`) — no value interpolated. No `parent`/`name`/`path` reaches any log, error, or telemetry sink on the desktop.
- **[Concurrency]** No findings. Adds no long-lived async task, timer, listener, or `AbortController`. `nextEnvelopeId` is read-then-incremented synchronously with no `await` in the gap (no check-then-act race); a post-teardown call is an inert no-op (`driver === null`). No new shared-state mutation, no new resource to tear down.
- **[Threat model alignment]** Addressed. *Malicious/compromised relay* (on-path, content-blind): cannot inject a valid Noise-encrypted reply; a dropped/delayed request is benign (dormant, no hang — size-bounded). *Hostile daemon response*: every field parsed defensively; a malicious `path` (traversal, oversized, control chars, HTML) is decoded as an opaque string and never resolved / logged / HTML-sunk here. *Renderer compromise reaching transport*: the worst achievable outcome is a daemon-bounded folder **inside the operator's `$HOME`** with a clean name (exactly the intended capability); the renderer cannot escape `$HOME`, cannot reach keys/socket (main-process isolation).

**Carry-forward to #157 (Create-folder dialog — SHOULD FIX at that ticket, OUT OF SCOPE here):**

- Render the returned `path` as **plain text** (never `innerHTML` / `dangerouslySetInnerHTML`) and **never resolve it into a local filesystem operation** — it is a remote daemon-side path. Do not `console.log` it in the renderer.
- Source `parent` from the recent-workspaces list / a chooser and `name` from a text field.
- Surface the daemon's `malformed` rejection via the existing #248 correlated-daemon-error rejection-surface path — **not** a bespoke channel. This transport ticket adds no rejection-correlation state (symmetric with `create_conversation`); wiring the surface is #157's job.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-14
</content>
</invoke>
