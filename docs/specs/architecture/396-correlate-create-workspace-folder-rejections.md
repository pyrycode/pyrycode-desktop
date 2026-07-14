# #396 — Correlate `create_workspace_folder` rejections (transport)

Split-child A of #384 (Create-folder dialog). `security-sensitive`. No Figma (transport only).
Blocks #397 (round-trip store), which blocks #398 (dialog UI).

## Files to read first

- `src/main/daemonConnection.ts:413-425` — the three per-connection correlation locals (`outstandingAnswers` FIFO #248, `pendingSettings` map #261). **Add a fourth here** next to them, same single-writer discipline.
- `src/main/daemonConnection.ts:483-517` — the `case 'daemon-error':` block. This is the correlation precedence ladder: settings-rejection (unique-id match) → `return` FIRST, then `reassembler?.fail` (bundle), then `outstandingAnswers.shift()` (modal FIFO). **Insert the create-folder match alongside settings-rejection, inside the `inReplyTo !== undefined` guard, returning before the bundle/modal tier.**
- `src/main/daemonConnection.ts:1256-1282` — `setSessionSettings`: the exact write-site pattern to clone — capture `const envelopeId = nextEnvelopeId` BEFORE the build, record the pending entry AFTER a successful `driver.sendMessage` (a throw skips the record). Mirror this in `createWorkspaceFolder`.
- `src/main/daemonConnection.ts:1009-1035` — `createWorkspaceFolder` today: fire-and-forget send, **no** pending record. This is what you extend.
- `src/main/daemonConnection.ts:1361-1391` — `dial()`: `outstandingAnswers.length = 0` + `pendingSettings.clear()`. **Add the new set's clear here** (AC1's per-`dial()` reset).
- `src/shared/ipc/events.ts:153-164` — `sessionSettingsRejected` arm + its rationale comment (the no-echo posture). Your new arm's comment mirrors it, minus the `changeId`.
- `src/shared/ipc/events.ts:230-244` — `workspaceFolderCreated` arm (#381), the success twin. Your rejection arm sits near it.
- `src/main/transport/inboundMessage.ts:168` — `{ kind: 'daemon-error'; inReplyTo?: number }`. The `daemon-error` kind is already **content-free** at parse (ErrorPayload text dropped upstream, :81-83); this slice reads only the numeric `inReplyTo`. No new parse surface.
- `src/renderer/src/store/daemonEventBridge.ts:78-92`, `modalBridge.ts:79-97`, `timelineBridge.ts:104-130` — the three exhaustive switches with `assertNever`. Each needs a no-op arm for the new event (the `workspaceFolderCreated` precedent, already visible in each file).
- `src/main/daemonConnection.test.ts:314-320` — `errorPlaintext(inReplyTo?)` helper. `:2322-2408` — the existing `createWorkspaceFolder` describe block. `:3370-3484` — the `sessionSettingsRejected` correlation tests (the shape to clone for AC1-AC4). `:3254-3343` — modal-FIFO rejection tests (the precedent for asserting an unrelated tier stays untouched).

## Context

`create_workspace_folder` shipped its outbound request + `workspace_folder_created` success reply (#381). It did **not** ship the rejection path. When the daemon rejects a create-folder request (bad name — path separator, `..`, absolute, or empty), it returns a **content-free** `error` frame correlated only by `Envelope.in_reply_to`. Today that frame reaches `daemonConnection.ts` as a `daemon-error` kind carrying only `inReplyTo`; nothing correlates it to the outstanding create-folder request, so the renderer never learns the request failed and the (future #398) dialog would spin forever on a common typo.

This slice adds the missing correlation in the background process, cloning the `set_session_settings` rejection machinery (#269) already living in the same file. It is the transport prerequisite for #397's round-trip store.

**Why the success path needs no correlation but the rejection path does.** `workspaceFolderCreated` is emitted unconditionally on decode because the `path` is self-sufficient — the reply frame *names its own verb*. A `daemon-error` frame carries **no verb discriminator** (it's the same content-free shape for a bundle failure, a settings rejection, a modal rejection, or a create-folder rejection). The only thing distinguishing them is which outstanding request the `in_reply_to` matches. Hence the pending-set: it is the sole mechanism that attributes a bare error frame to a create-folder request.

## Design

### 1. New `DaemonEvent` arm — `workspaceFolderRejected` (bare)

`src/shared/ipc/events.ts` — add one union member near `workspaceFolderCreated`:

```ts
| { type: 'workspaceFolderRejected' }
```

**Decision — bare event, no correlation key (resolves the ticket's open question).** Carry nothing. Rationale:
- Only one create-folder dialog is open at a time → no concurrency to disambiguate. Contrast `sessionSettingsRejected`'s `changeId` (two same-`session_id` changes in flight) and `modalAnswerRejected`'s `modalId` (multiple concurrent modals).
- The success twin `workspaceFolderCreated` carries only `path` and **no** correlation key — the rejection twin should be symmetric.
- A bare event is maximally content-free: literally no field can hold a daemon-supplied byte (AC3 by construction). This is *stronger* than the siblings, which each carry one client-owned value (`changeId` is renderer-minted, `modalId` is a client-visible nonce). Here nothing at all crosses.

The doc comment mirrors the `sessionSettingsRejected` comment: emitted by the main-side correlation gate when a content-free daemon `error` matches a pending `create_workspace_folder` request; carries NO field read from the untrusted payload; consumed by #397 (not yet built), so all three exhaustive bridges no-op it for now (the `workspaceFolderCreated`-was-a-no-op precedent).

### 2. Correlation memory — `pendingCreateFolders: Set<number>`

In `createDaemonConnection`, next to `pendingSettings` (~line 425):

```ts
// Envelope ids of outstanding create_workspace_folder requests, for the #396 rejection round-trip.
const pendingCreateFolders = new Set<number>()
```

**Decision — `Set<number>`, not a `Map`.** The event is bare, so there is no value to carry per entry — only membership ("is this envelope id an outstanding create-folder request?") matters. Contrast `pendingSettings: Map<number, string>` (must carry the `changeId` back) and `outstandingAnswers: string[]` (FIFO because the error carries no discriminating id — but a create-folder request *does* have a unique envelope id, so a keyed set beats a FIFO here). Same single-writer discipline as the existing locals: every mutation runs to completion inside a synchronous `createWorkspaceFolder` / `onDriverEvent` body, no `await` between read and write.

### 3. Write site — record after a successful send

Restructure `createWorkspaceFolder` (~1009) to match `setSessionSettings` (1256-1282): capture the envelope id before the build, add to the set after `driver.sendMessage` succeeds.

- Capture `const envelopeId = nextEnvelopeId` before the `try` (so the pending key = the id the daemon echoes as `in_reply_to`).
- Use `envelopeId` in the `buildCreateWorkspaceFolder({ id: envelopeId, ... })` call; keep the `nextEnvelopeId += 1` increment.
- After `driver.sendMessage(bytes)` succeeds, `pendingCreateFolders.add(envelopeId)`.
- The existing `catch` is unchanged: a build/send throw skips the `.add`, so no phantom entry is left for a reply that never comes (the `setSessionSettings` invariant).

Everything else in the function (the driver-null guard, the fresh-literal `{ parent, name }` anti-smuggling bound, the content-free catch) stays as-is.

### 4. Clear site — `dial()`

In `dial()` (~1380), alongside `pendingSettings.clear()`:

```ts
pendingCreateFolders.clear()
```

Same rationale as the siblings: a reconnect abandons outstanding requests, so a stale envelope id from a dead session can never correlate an `error` on the reconnected one (which recycles ids from 2).

### 5. Match site — `case 'daemon-error':` precedence

Insert the create-folder match **inside the existing `if (inReplyTo !== undefined)` block, after the `pendingSettings` check**, with its own `return` on match:

```ts
if (pendingCreateFolders.has(inReplyTo)) {
  pendingCreateFolders.delete(inReplyTo)
  emitDaemonEvent(sink, { type: 'workspaceFolderRejected' })
  return
}
```

**Precedence (AC4).** This sits in the same "unique-per-request-id" tier as settings-rejection, both of which `return` *before* `reassembler?.fail('daemon-error')` and the `outstandingAnswers.shift()` modal FIFO. A matched create-folder rejection must NOT fail a healthy in-flight bundle nor consume the oldest outstanding modal answer — an error correlated by a unique per-request envelope id is unambiguously the reply to *that* request. Order relative to the settings check is immaterial: an envelope id is minted once, so at most one of `pendingSettings` / `pendingCreateFolders` can hold it. Placing the create-folder check second keeps the diff localized. An absent `in_reply_to` short-circuits before either lookup (the guard already there); a no-match (stale id, or a hostile daemon forging a rejection for a request the client never sent) falls through to the bundle/modal tier unchanged (AC3/AC4).

The emitted event reads **nothing** from `inbound` beyond having matched on the numeric `inReplyTo` (which is never placed on the event — it stays main-internal, like the settings/modal branches).

### 6. Three exhaustive bridge no-ops

`assertNever` in each of the three renderer bridges makes the new union arm a compile error until each has a case (verified: all three switches present, all three already no-op `workspaceFolderCreated`).

- `daemonEventBridge.ts` — dedicated `case 'workspaceFolderRejected': return null` with a one-line comment (the #397 round-trip store consumes it, not the session store).
- `modalBridge.ts` — add `case 'workspaceFolderRejected':` to the existing fall-through `null` group.
- `timelineBridge.ts` — add `case 'workspaceFolderRejected':` to the existing fall-through `null` group.

No renderer state changes (AC5) — the arm is dormant until #397 converts the `daemonEventBridge` no-op into a store dispatch.

## State + concurrency model

No store, no async task, no new lifecycle. The correlation is three synchronous mutations of one module-local `Set<number>` (add on send, delete on match, clear on dial), each running to completion inside a synchronous body with no intervening `await` — identical to the `pendingSettings` / `outstandingAnswers` single-writer model already proven in this file. Cancellation/teardown is `dial()`'s `.clear()`; the module already never throws out (parity #490).

## Error handling

- **Content-free by construction.** The `daemon-error` kind is already stripped of the daemon's `ErrorPayload` text upstream at parse (`inboundMessage.ts:81-83`); this slice reads only the numeric `inReplyTo`. The emitted `workspaceFolderRejected` is bare — no code, message, path, or wire id crosses IPC (AC3).
- **No new failure modes.** No parse, no I/O, no socket added. A build/send throw in `createWorkspaceFolder` is caught as today and skips the `.add` (no phantom entry).
- **UI surfacing** is #398's concern (a content-free "couldn't create that folder" banner). This slice emits the signal only; no banner/dialog here.

## Testing strategy

`npm test` (vitest), extending `src/main/daemonConnection.test.ts`. Clone the `sessionSettingsRejected` describe block (:3370-3484) using the existing `errorPlaintext(inReplyTo?)` helper (:314). Scenarios (bullet-pointed, not full bodies — write in the file's idiom):

- **AC1/AC2 — correlated match.** `createWorkspaceFolder` (records envelope id 2), then `errorPlaintext(2)` inbound → emits exactly one `{ type: 'workspaceFolderRejected' }`, and the pending entry is dropped (a second `errorPlaintext(2)` emits no further rejection — proves the delete).
- **AC3 — no-echo / bare shape.** Assert the emitted event has exactly one key (`type`) — no `inReplyTo`, no daemon field. A regression pin like the settings test's key-set assertion (:3391).
- **AC3/AC4 — absent `in_reply_to`.** `createWorkspaceFolder` outstanding, then `errorPlaintext()` (no id) → no `workspaceFolderRejected`; short-circuits before the set lookup.
- **AC4 — non-matching id falls through.** With a create-folder request outstanding at id 2, an `errorPlaintext(999)` → no `workspaceFolderRejected`, and the modal FIFO / bundle tier still fires (clone the settings test at :3406 that asserts the modal rejection still lands).
- **AC4 — precedence: healthy bundle not failed.** With a create-folder request outstanding AND an armed bundle reassembler, a matched `errorPlaintext(2)` emits the rejection and `return`s — assert the bundle consumer is NOT failed (mirror the settings-vs-bundle precedence test at :3465).
- **AC4 — precedence: modal FIFO untouched.** With a create-folder request outstanding AND an outstanding modal answer, a matched `errorPlaintext(2)` emits the rejection and does NOT shift the modal FIFO (mirror :3379-3436).
- **AC1 — `dial()` clears.** Record a create-folder request, call `reconnect()`/re-dial, then `errorPlaintext(2)` on the fresh session → no `workspaceFolderRejected` (stale id abandoned).
- **AC1 — no phantom on send-throw.** A `createWorkspaceFolder` whose build/send throws does not record a pending entry (a later `errorPlaintext(<that id>)` emits nothing) — clone the `setSessionSettings` send-throw test (:1648).
- **AC5 — bridge exhaustiveness.** In each of the three bridge test files, assert `translate*Event({ type: 'workspaceFolderRejected' })` returns `null` (the `workspaceFolderCreated` no-op precedent already tested in each).

Type coverage: `npm run typecheck` — the `assertNever` guard in all three bridges is the compile-time proof the arm is handled everywhere.

## Scope check — atomicity exception (5 production files is the known ≥5 false-positive)

Production files: `events.ts`, `daemonConnection.ts`, `daemonEventBridge.ts`, `modalBridge.ts`, `timelineBridge.ts` = **5**, which trips the §4 ≥5 self-check numerically. This is the **documented atomicity-exception false-positive** for a new dormant `DaemonEvent` arm: the three bridge edits are single-line, compile-*forced* no-ops — adding the union member breaks `npm run build` in all three (`assertNever`) until each has a case, so they cannot be split into a separate ticket. Same shape shipped as S in #375 (`conversationDeleted`), #380, #381 (`workspaceFolderCreated`), #316 (`screenSnapshotReceived`), #328 (`relayLinkChanged`).

Against the §1 quantitative red lines: **0** new files, **~250** total LOC (≈46 production + ≈200 test), **1** new union arm / **0** new exported types, **3** consumer call sites (all identified, all forced no-ops, well under 10), **1** new reject branch (well under 10). None trip. Size **S** confirmed.

## Open questions

- None blocking. The bare-vs-keyed-event question the ticket flagged is resolved above (bare). The daemon-side rejection contract (content-free `error` correlated by `in_reply_to`) is established by #381/#269 and unchanged here.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — the single untrusted→trusted crossing is the inbound `daemon-error` frame from the daemon (an untrusted, internet-exposed on-path party). The boundary is explicit and already defended upstream: `parseInboundMessage` fails closed on malformed/oversized frames, and the `daemon-error` kind is stripped to `{ kind: 'daemon-error'; inReplyTo?: number }` at parse (`inboundMessage.ts:81-83, :168`) — the `ErrorPayload` code/message never reaches this module. This slice consumes only the numeric `inReplyTo` for a `Set.has` lookup and emits a bare event. Downstream (#397/#398) receives `{ type: 'workspaceFolderRejected' }` with no daemon-derived field.
- **[Tokens, secrets, credentials]** N/A — no token/secret/credential is generated, stored, read, or logged. The pending set holds only client-minted envelope ids (a main-internal monotonic `nextEnvelopeId` counter, non-secret, never crossing IPC).
- **[File / storage operations]** N/A — no filesystem or storage operation. The daemon's remote folder `path` is not touched by this slice at all (the rejection is content-free; the success `path` is #381's, and even there it is remote display text never resolved locally). No path concatenation, no `fs` call.
- **[Inter-process / Electron attack surface]** No findings — no new IPC channel, `ipcMain` handler, or `contextBridge` API. The one new `DaemonEvent` arm rides the existing `DAEMON_EVENT_CHANNEL` (main→renderer), and it is bare — the renderer receives a type tag and nothing else, so there is no argument to validate and no capability widened. Transport/keys/socket stay in the main process untouched.
- **[Cryptographic primitives]** N/A — no crypto. No key, nonce, RNG, or comparison added. The correlation is a numeric `Set` membership test, not a secret comparison (no `timingSafeEqual` concern: the envelope id is not a secret and the match reveals nothing an on-path daemon doesn't already control).
- **[Network & I/O]** N/A — no socket, frame-size cap, URL, TLS, or timeout added or changed. This slice is downstream of the already-capped/validated relay read path; it adds no inbound-size or reconnect surface.
- **[Error messages, logs, telemetry]** No findings — the new correlation branch emits **no** log call and reads **no** error-payload field, preserving the #116 content-free-error posture. The bare event cannot leak a token, key, transcript, path, or wire id (nothing to leak by construction). No renderer-console or telemetry sink is touched.
- **[Concurrency]** No findings — no new async task, timer, listener, or `AbortController`. The three mutations of `pendingCreateFolders` (add/delete/clear) are synchronous single-writer operations inside existing bodies with no `await` between read and write, matching the proven `pendingSettings` / `outstandingAnswers` model. `dial()`'s `.clear()` is the teardown; the module still never throws out (parity #490). No check-then-act race, no duplicate-connection surface.
- **[Threat model alignment]** Addressed — **malicious/compromised relay:** content-blind and cannot forge inside the Noise session; a dropped/delayed/reordered error frame at worst leaves a pending entry that `dial()` clears — no leak, no hang. **Hostile daemon response:** a daemon forging an `error` with an `in_reply_to` matching a *real* outstanding create-folder request can trigger a spurious content-free rejection — but the daemon can reject any request it likes anyway (this is within its authority), and the worst case is a "couldn't create that folder" signal with zero data disclosure and no state escalation. A forged `in_reply_to` matching an id the client never used for a create-folder request misses the `Set` and falls through unchanged. **Renderer compromise reaching transport:** unchanged — the arm is emitted main→renderer only; the renderer gains no new capability toward keys/socket/token.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-14
