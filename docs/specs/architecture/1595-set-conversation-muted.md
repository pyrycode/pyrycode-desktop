# #1595 — send `set_conversation_muted`

## Files read

- `src/main/transport/setSystemPromptEnvelope.ts` → `buildSetSystemPrompt` — the builder template the new `buildSetConversationMuted` mirrors (pure `(id, ts, payload)` → bytes).
- `src/main/daemonConnection.ts` → `DaemonConnection.renameWorkspace`, `renameWorkspace`, `workspaceRenameResult`, `pendingWorkspaceRenames` — the attempt-id outcome shape copied here; `setSystemPrompt` / `pendingSystemPromptWrites` — the conversation-scoped write and its correlated `conversation_updated` reading; the `daemon-error` correlation tier and the `conversation-updated` arm in `onDriverEvent`; the per-dial clears in `dial`.
- `src/main/index.ts` → the `case 'renameWorkspace'` arm (local rejection when nothing routes) and `case 'setSystemPrompt'` (`router.route(conversation_id)`).
- `src/main/conversationRouter.ts` → `ConversationRouter.route` — resolves an id to the one connection that claimed it, or `null` with no frame on any wire. It is what makes "no other host receives a frame" hold.
- `src/main/connectionRegistry.ts` → the delegating facade (`renameWorkspace: (payload, attemptId) => resolve()…`); compile-forced to grow one line.
- `src/shared/ipc/commands.ts` → `isDaemonCommand` arms for `renameWorkspace` (attemptId bound 1..128) and `setSystemPrompt`; `isSetSystemPromptPayload`.
- `src/shared/ipc/events.ts` → `workspaceRenameResult` member of `DaemonEvent`.
- `src/shared/wire/types.ts` → `EnvelopeType`, `SetSystemPromptPayload`, `ConversationSummary.is_muted` (#1594's read side).
- `src/renderer/src/store/{daemonEventBridge,timelineBridge,modalBridge,questionBridge}.ts` → exhaustive `switch` over `DaemonEvent`; each takes one `case` beside `workspaceRenameResult`.
- `e2e/rename-workspace-command.spec.ts`, `e2e/composer-permission-mode-menu.spec.ts` → sending a command through `window.pyry.sendCommand` and probing `onDaemonEvent` from the page.

## Design source

N/A — not a UI change (ticket: "This is not a UI change, so the ticket has no Figma section"). The consuming dialog is #1596.

## Context

The daemon verb `set_conversation_muted` (pyrycode#2572) takes `{conversation_id, muted}`, answers the requester with a `conversation_updated` correlated by `in_reply_to` (carrying the new `is_muted`), pushes the same record uncorrelated to everyone else, and refuses a malformed payload or unknown conversation with a correlated non-retryable `error`. The read side (#1594) already decodes `is_muted` on list rows, and `conversationListBridge` re-lists on every `conversationUpdated`, so the new value reaches the sidebar with no new decode. This ticket adds the write and a content-free outcome event for #1596. No renderer store.

**Sizing overage, stated.** Production files: `wire/types.ts`, `commands.ts`, `events.ts`, `daemonConnection.ts`, `index.ts`, `connectionRegistry.ts` (one delegate line, compile-forced) and the new envelope builder — 7, plus a one-line `case` in each of four bridges. Over the 5-file line. Kept as one ticket under the floor rule, as the refiner's estimate already argued: the wire type and the builder have this send as their only consumer. Total written work is estimated ~550 lines, inside 800.

In-flight overlap: `feature/1544` also edits `daemonConnection.ts` (run-config area). Not a dependency; my edits there are additive.

## Design

**Wire (`src/shared/wire/types.ts`).**
- `EnvelopeType` gains `'set_conversation_muted'`.
- `SetConversationMutedPayload { conversation_id: string; muted: boolean }` — distinct type, mirrors the daemon's struct field-for-field, both keys required (the daemon requires `muted`).

**Builder (`src/main/transport/setConversationMutedEnvelope.ts`, new).**
`buildSetConversationMuted({ id, ts, payload }): Uint8Array` — same shape as `buildSetSystemPrompt`; wraps the payload in a `set_conversation_muted` Envelope and `encodeEnvelope`s it. No normalisation.

**Command (`src/shared/ipc/commands.ts`).**
`{ type: 'setConversationMuted'; payload: SetConversationMutedPayload; attemptId: string }`.
- `attemptId` is REQUIRED (the only consumer needs an outcome) and bounded like `renameWorkspace`'s: string, length 1..128. Client-only; never reaches the wire.
- `isSetConversationMutedPayload` is STRICT, unlike its structural-minimum siblings, because the AC says so: a plain object whose keys are exactly `conversation_id` and `muted`; `conversation_id` a non-empty string; `muted` `=== true || === false`. Rejects a missing `muted`, `1`/`'true'`/`null`/`undefined`, and any extra key.

**Event (`src/shared/ipc/events.ts`).**
`{ type: 'conversationMuteResult'; attemptId: string; outcome: 'confirmed' | 'rejected' }` — content-free: no conversation id, no daemon code, no message, no `is_muted`.

**Connection (`src/main/daemonConnection.ts`).**
- Interface: `setConversationMuted(payload: SetConversationMutedPayload, attemptId: string): void`. Never throws.
- `pendingMuteWrites = new Map<number, string>()` — envelope id → attemptId. Set only after a successful send; cleared in `dial` beside `pendingWorkspaceRenames`.
- Method body mirrors `renameWorkspace`: `driver === null` → `rejected`; build a FRESH literal `{ conversation_id, muted }` (never a spread), send, record; any throw → `rejected`. One envelope-id local read three times; the id advances only on a successful build.
- `conversation-updated` arm: after the unconditional `conversationUpdated` emit (untouched), a correlated frame whose `in_reply_to` matches `pendingMuteWrites` deletes the entry and emits `confirmed`. The existing system-prompt lookup follows unchanged. Uncorrelated or unmatched → no result.
- `daemon-error` tier: a match in `pendingMuteWrites` deletes and emits `rejected`, then returns (sibling posture). Every error code settles as `rejected`; the code is not read.
- Helper `conversationMuteResult(attemptId, outcome)` logs `{ event: 'conversation-mute-result', code: outcome }` and emits. Also `conversation-mute-sent` on send and `conversation-mute-failed` (`code: 'local-send'`) on a local throw. No id, no attempt id, no value logged.

**IPC arm (`src/main/index.ts`).**
`case 'setConversationMuted'`: `router.route(payload.conversation_id)`; a connection → `connection.setConversationMuted(payload, attemptId)`; `null` → no frame anywhere, log `conversation-mute-failed` / `unavailable-host`, and emit `rejected` through `bindServerOrigin(live.sink, null)` so the dialog settles (the `renameWorkspace` arm's posture).

**Registry.** One delegate line. **Bridges.** One `case 'conversationMuteResult':` beside `workspaceRenameResult` in each of the four.

## State + concurrency model

No renderer state. Main holds `pendingMuteWrites`, single-writer: every mutation runs inside a synchronous `setConversationMuted` / `onDriverEvent` body. Exactly one outcome per write is structural — both settling arms delete the entry, so a second frame for the same write matches nothing. `dial` clears the map, so a recycled envelope id cannot settle a new connection's write against a dead attempt. A write that was sent and never answered produces no outcome (same as every sibling); it is cleared on the next dial. No timers.

## Error handling

| Failure | Outcome |
|---|---|
| Guard rejects the command | dropped at the boundary, no frame, no result (every guard's posture) |
| No host claims the id | no frame; `rejected` |
| Owning connection not connected | no frame; `rejected` |
| Build/send throws | caught, no entry recorded; `rejected` |
| Correlated daemon `error` (any code) | `rejected` |
| Correlated `conversation_updated` | `confirmed` |

## Testing strategy

Vitest (node):
- `setConversationMutedEnvelope.test.ts` — round-trip type/id/ts; payload exactly `{conversation_id, muted}` for both `true` and `false` (the `false` arm must be a present key); key set exactly the two.
- `commands.test.ts` — accepts `true`/`false` with a valid attemptId; rejects empty id, non-string id, missing `muted`, `1`, `'true'`, `null`, extra payload key, missing/empty/over-128 attemptId, non-object payload.
- `daemonConnection.test.ts` — one `set_conversation_muted` frame whose decoded payload is exactly the two keys (extra field smuggled on the input dropped); correlated `conversation_updated` → one `confirmed` AND the `conversationUpdated` still emitted; correlated `error` → one `rejected`; uncorrelated push → `conversationUpdated` only; a second correlated frame for the same write → nothing; disconnected → `rejected`, no frame; dial clears the map.
- `connectionRegistry.test.ts` — fake gains the method (compile-forced).

Playwright (fake transport), `e2e/conversation-mute-command.spec.ts` — the only gate over the `index.ts` arm (it has no unit test): `sendCommand` with the seed's id → exactly one `set_conversation_muted` frame with payload exactly `{conversation_id, muted: true}` and a `conversationMuteResult` `confirmed` probe plus a re-list; an unknown id → no frame and `rejected`; a write the fake refuses → `rejected`. Multi-host exclusivity is `ConversationRouter.route`'s own tested property; the arm uses it.

## Documentation handoff

The ticket has no Documentation handoff section and no documentation-only AC. Pending for the documentation stage: fold the new command/event into the owning feature overview (channel list / edit channel area) as it sees fit.

## Open questions

- Should `confirmed` require the record's `is_muted` to equal the requested value? Resolved: no. The daemon's reply is the verdict; the list re-request is the authority on the stored value, and the ticket asks only for correlation.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — two boundaries, each explicit. Renderer → main: `isDaemonCommand`'s `setConversationMuted` arm with `isSetConversationMutedPayload` (strict key set, non-empty string id, strict boolean) and the attemptId 1..128 bound; the connection method still rebuilds a fresh two-field literal so nothing smuggled reaches the wire even if the guard were loosened. Daemon → main: the reply is decoded by the existing `conversation_updated` / `error` parsers; this ticket reads only `in_reply_to` from them, and only as a key into a client-minted numeric map.
- [Trust boundaries] SHOULD FIX (addressed in design) — `attemptId` is renderer text that crosses back to the renderer. It is stored as a Map VALUE keyed by a client-minted number, never used as a key, path or log field, so no prototype or injection surface. Verifier: confirm it never reaches `diagnosticLog`.
- [Tokens] No findings — no secret is created, stored or read; the payload is an id and a boolean.
- [File / storage] Not applicable — no filesystem path is touched; `conversation_id` reaches only `ConversationRouter.route` (read-only Map lookup) and the envelope literal.
- [Electron attack surface] No findings — no new IPC channel or bridge method; the command rides the existing validated command channel. Worst case for a compromised renderer: mute/unmute a conversation it can already name, which it could equally do through the UI.
- [Crypto] Not applicable — the frame goes through the existing Noise session; no primitive is touched.
- [Network & I/O] No findings — frame size is bounded by `encodeEnvelope`'s MAX_PLAINTEXT_BYTES (the id is bounded by routing to a known conversation). A hostile daemon can forge a correlated ack or error; the worst outcome is a wrong `confirmed`/`rejected` for a write this client actually sent, and the list re-request remains the authority on the stored flag.
- [Logs] No findings — logs carry static event names and the `confirmed`/`rejected`/`local-send`/`unavailable-host` codes only; no conversation id, attempt id, muted value or daemon text. The result event carries no daemon text (AC3).
- [Concurrency] No findings — single-writer map, delete-on-settle makes one outcome per write structural, cleared on every dial so a dead connection's entry cannot settle a new one.
- [Threat model] OUT OF SCOPE — a write the daemon never answers stays pending until the next dial with no timeout outcome; #1596 owns any dialog-side timeout if it needs one.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-24
