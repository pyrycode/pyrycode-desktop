# #269 — Correlate `set_session_settings` errors to a rejected event by `in_reply_to`

**Ticket:** pyrycode-desktop#269 · **Size:** S · **Labels:** `security-sensitive`
**Blocked by:** #261 (confirmed round-trip + `pendingSettings` map + renderer-minted `changeId`, merged PR #270) · **Consumed by:** #256 (pending→confirm/reject store, blocked by this) · **Sibling:** #261 (the confirmed half; this is the rejected half on the same map + key)

## Context

#261 (merged) landed the **confirmed** round-trip: a `session_settings_updated` reply is correlated to its originating request by `Envelope.in_reply_to`, via a per-connection `pendingSettings: Map<envelopeId, changeId>` (`daemonConnection.ts:282`) — set after each successful `setSessionSettings` send (`:743`), matched-and-deleted in the reply handler (`:418-428`), cleared on each `dial()` (`:847`). The match key is a **renderer-minted `changeId`** threaded through the `setSessionSettings` command, IPC-only, never on the wire.

This slice adds the **rejected** half on that same map + key. The daemon replies to a failed `set_session_settings` with an `error` frame, `in_reply_to = request.id` (pyrycode#844/#845), carrying one of `session.not_found` / `protocol.malformed` / `server.binary_offline`. This slice treats **any** request-correlated error as "rejected" — it does **not** surface the individual code (the store's rollback in #256 is identical for all three; see Open questions for the deferred retryable-code extension).

Two facts make this non-trivial and are why it was peeled from the confirmed path:

1. **The `daemon-error` decode is deliberately content-free.** `parseInboundMessage` narrows a daemon `error` into `{ kind: 'daemon-error' }` with no code and no `in_reply_to` (`inboundMessage.ts:136` kind def, `:806-818` the decode case). To correlate a rejection we must carry the numeric `in_reply_to` onto that kind — exactly as #261 carried it onto the `session-settings-updated` kind (`inboundMessage.ts:718`) — and **nothing else** (no code, no message text, no payload bytes). This is the `security-sensitive` core.

2. **The same `daemon-error` frame already drives two other correlators** in the connection's error handler (`daemonConnection.ts:340-354`): the **bundle reassembler** (`reassembler?.fail('daemon-error')`, `:341`) and the **modal_answer FIFO** (#248 — a blind, unconditional oldest-first `outstandingAnswers.shift()`, `:349`). So a settings rejection must be correlated **first**, and on a match must be delivered **without** shifting the modal FIFO (today the shift is unconditional).

The confirmed reply handler (`daemonConnection.ts:418-428`) is the working precedent to clone: `inReplyTo` → `pendingSettings.get` → `delete` → emit a fresh literal carrying `changeId`. The rejected path is the same shape, keyed off the `daemon-error` kind instead of `session-settings-updated`, plus the precedence gate on the two co-consumers.

## Files to read first

- `src/main/daemonConnection.ts:340-354` — the current `daemon-error` case: `reassembler?.fail('daemon-error')` then the **unconditional** `outstandingAnswers.shift()`. **This is the case you rewrite** — add the settings-correlation gate in front of both.
- `src/main/daemonConnection.ts:408-429` — the `session-settings-updated` **confirmed** handler as #261 left it. The exact narrowing shape to clone: `const inReplyTo = inbound.inReplyTo; if (inReplyTo === undefined) …; const changeId = pendingSettings.get(inReplyTo); if (changeId === undefined) …; delete; emit fresh literal`.
- `src/main/daemonConnection.ts:277-282` — the `pendingSettings` map local + its single-writer comment. **Read-only** — you reuse this map unchanged (no widening; the map stays `Map<number, string>`).
- `src/main/daemonConnection.ts:723-749` — `setSessionSettings`: the send-then-`pendingSettings.set` shape (context only; not edited here). `:828-847` — `dial()`'s `pendingSettings.clear()` (context only; the rejected path adds no new reset — `delete`-on-match + the existing `dial()` clear cover AC5).
- `src/main/transport/inboundMessage.ts:131-149` — the `InboundDaemonMessage` union; `{ kind: 'daemon-error' }` (`:136`) is the kind to widen with `inReplyTo?: number`. Note the sibling `session-settings-updated` kind (`:142-146`) already carries `inReplyTo?` — mirror it.
- `src/main/transport/inboundMessage.ts:806-818` — the `error` decode case. Carry `envelope.in_reply_to` onto the returned kind. Read the `:704-718` `session_settings_updated` case for the exact "propagate the already-decoded value, do not re-decode" pattern + the content-free-log comment.
- `src/main/transport/inboundMessage.ts:380-388` — the "unknown server-added keys (e.g. an `in_reply_to` echoed onto the payload)" comment; confirms `in_reply_to` is an Envelope-level routing id, not a payload field.
- `src/main/transport/codec.ts:135` — `decodeEnvelope` surfaces `in_reply_to` as `number | undefined`. **Read-only, do not touch** — the value already exists; this slice only propagates it.
- `src/shared/ipc/events.ts:95-104` — the `sessionSettingsUpdated` confirmed arm + its doc comment. **The new `sessionSettingsRejected` arm goes here**, modelled on it. `:146-156` — the `modalAnswerRejected` arm (the "rejection arm, consumed by a render slice, no-op'd by all three bridges" precedent to mirror).
- `src/renderer/src/store/daemonEventBridge.ts:84-93`, `timelineBridge.ts:82-93`, `modalBridge.ts:78-86` — the three `assertNever`-guarded switches. Each gets a no-op case for the new arm, exactly like `sessionSettingsUpdated`. `conversationListBridge.ts:27-30` + `sessionIdBridge.ts:25-28` use `default:` fall-through and are **not** touched.
- `src/main/daemonConnection.test.ts:2435-2525` — the **#248 modal-rejection correlation tests** (helper `rejections(sink)`, fixture `errorPlaintext()` at `:276-283`). This is the harness you extend. `:1351-1490` — the **#261 confirmed-correlation tests** (helper `sessionSettingsUpdatedPlaintext(payload, inReplyTo?)` at `:265-273`) — the template for building a correlated reply from the minted request id.
- `src/main/daemonConnection.test.ts:276-283` — `errorPlaintext()`: the wire-`error` fixture. **Extend its signature** to `errorPlaintext(inReplyTo?: number)` mirroring `sessionSettingsUpdatedPlaintext`. Its `message: 'secret error detail'` payload is the no-echo regression fixture — keep it.
- `src/renderer/src/store/{daemonEventBridge,modalBridge,timelineBridge}.test.ts` (`:216`/`:129-131`/`:143-145`) — the bridge-test tables/cases that enumerate no-op'd arms. Add the new arm to each (see Testing).
- `docs/specs/architecture/261-correlate-session-settings-confirmed.md` — the confirmed-half spec; this rejected half mirrors its Design/Security/Scope sections.

## Design

One coherent flow across the internet-exposed decode boundary, the main-side correlation gate, and the main→renderer event arm. **6 production files, zero new files, zero new exported types** — one new `DaemonEvent` union member (compile-forcing the three `assertNever` bridges to add a no-op case).

### 1. Carry `in_reply_to` on the content-free error — `src/main/transport/inboundMessage.ts`

Widen the `daemon-error` kind (`:136`) with the optional numeric routing id, mirroring the `session-settings-updated` kind:

```ts
| { kind: 'daemon-error'; inReplyTo?: number }
```

In the `error` decode case (`:806-818`), propagate the already-decoded value — **do not** parse `ErrorPayload`, **do not** carry the code or message:

```ts
return { kind: 'daemon-error', inReplyTo: envelope.in_reply_to }
```

`envelope.in_reply_to` is `number | undefined` (codec.ts:135); `undefined` when the frame omits it → correlation fails closed downstream. The content-free diagnostic log (`:812-817`) stays **unchanged** — `in_reply_to` is a routing id, not logged; no new `DiagnosticEvent` field, so #131's renderer pin is untouched (same posture as #261's `session_settings_updated` case). Update the kind's doc comment (`inboundMessage.ts:~85-129` block) to note `daemon-error` now carries the optional `inReplyTo` for the #269 rejection correlation, still surfacing **no** error content.

### 2. New rejected `DaemonEvent` arm — `src/shared/ipc/events.ts`

Add next to `sessionSettingsUpdated` (`:104`):

```ts
| { type: 'sessionSettingsRejected'; changeId: string }
```

Carries **only** `changeId` — the renderer-minted key #261 introduced. Deliberately **no** `sessionId` (the wire `error` frame is content-free — it carries no `session_id`; and `changeId` alone is the disambiguator per AC4, so echoing `sessionId` would add nothing and would force widening the #261 map). Deliberately **no** `in_reply_to` (that numeric wire routing id stays main-internal — the renderer receives its own `changeId`) and **no** error code/message (attacker-influenceable bytes; no consumer needs them). Doc comment: mirror the `sessionSettingsUpdated` and `modalAnswerRejected` arms — client-minted non-secret key, IPC-internal, consumed by #256 (not yet built), so all three exhaustive bridges no-op it for now.

### 3. The precedence gate at the error handler — `src/main/daemonConnection.ts`

Rewrite the `daemon-error` case (`:340-354`). **Settings correlation takes precedence over both co-consumers.** Contract:

```ts
case 'daemon-error': {
  const inReplyTo = inbound.inReplyTo
  if (inReplyTo !== undefined) {
    const changeId = pendingSettings.get(inReplyTo)
    if (changeId !== undefined) {
      pendingSettings.delete(inReplyTo)                                  // AC5
      emitDaemonEvent(sink, { type: 'sessionSettingsRejected', changeId }) // AC1/AC4
      return                                                             // AC2: skip the modal FIFO shift (and the reassembler)
    }
  }
  reassembler?.fail('daemon-error')                                      // AC3: unchanged fall-through
  const rejectedModalId = outstandingAnswers.shift()
  if (rejectedModalId !== undefined) {
    emitDaemonEvent(sink, { type: 'modalAnswerRejected', modalId: rejectedModalId })
  }
  return
}
```

**Precedence rationale (the architect's call the ticket flags).** On a settings match, consume the frame **entirely** — skip **both** `reassembler?.fail` **and** the modal shift. An error correlated by `in_reply_to` to a pending `set_session_settings` request is unambiguously the reply to **that** request (envelope ids are unique per request, single monotonic `nextEnvelopeId`), so it is neither a bundle error nor a modal-answer rejection. Failing a healthy in-flight bundle on an unrelated settings rejection would be a bug; skipping `reassembler?.fail` is therefore correct, not merely tolerable (and it is a no-op anyway when no bundle streams — optional-chain / settled-reassembler guard). The emitted event never reads a field from the untrusted error payload — `changeId` comes from the client's own `pendingSettings` map (AC1/AC4 no-echo). The `pendingSettings.delete` satisfies AC5: a subsequent unrelated error finds no entry and re-fires nothing. See the collision matrix in Error handling for the full 6-scenario walk.

### 4. Three no-op bridge cases — the compile-forced arm plumbing

Each `assertNever`-guarded bridge gains one no-op case for `sessionSettingsRejected`, identical in shape to its existing `sessionSettingsUpdated` case:

- `daemonEventBridge.ts` — add `case 'sessionSettingsRejected': return null` beside `:84` (comment: consumed by #256, not the session store).
- `timelineBridge.ts` — add `sessionSettingsRejected` to the fall-through group at `:82-84`.
- `modalBridge.ts` — add `sessionSettingsRejected` to the fall-through group at `:78-79`.

`conversationListBridge` and `sessionIdBridge` use `default:` and need **no** edit (verified against `main`: exactly these two fall through; the other three force a case).

### 5. Test helper widen — `src/main/daemonConnection.test.ts`

Extend `errorPlaintext()` (`:276-283`) to `errorPlaintext(inReplyTo?: number)`, spreading `...(inReplyTo !== undefined ? { in_reply_to: inReplyTo } : {})` onto the envelope — the exact pattern `sessionSettingsUpdatedPlaintext` (`:265-273`) uses. Existing no-arg callers stay green (no `in_reply_to` → `daemon-error.inReplyTo` undefined → falls through to the #248 behaviour, AC3).

## State + concurrency model

- **No new state.** This slice reuses #261's `pendingSettings: Map<number, string>` verbatim — it only adds a second reader/deleter (the `daemon-error` case) alongside the confirmed reader (the `session-settings-updated` case). The map stays module-local to `createDaemonConnection`.
- **Single-writer, no races.** The new `.get`/`.delete` run inside the synchronous `onDriverEvent` body with no `await` between read and write — the same rationale as the confirmed handler and `outstandingAnswers` (daemonConnection.ts:277-282). A confirmed reply and an error reply for the same request cannot both match: whichever arrives first deletes the entry; the second finds nothing and falls through (harmless — a rejected change gets one `error`, a confirmed change gets one `session_settings_updated`, never both for the same envelope id).
- **Lifecycle / orphan cleanup.** #261 noted that under the confirmed-only slice a rejected change's pending entry was **not** removed until `dial()` (the accepted, bounded orphan). This slice **closes that orphan**: the `error` path now `delete`s the entry on correlation. `dial()`'s existing `pendingSettings.clear()` (`:847`) remains the backstop for truly abandoned entries (a change whose reply never arrives before reconnect). No new reset, no cap (parity with `outstandingAnswers`, evidence-based — no observed unbounded growth).

## Error handling

The 6-scenario collision matrix at the `daemon-error` handler (settings-match × modal-outstanding × bundle-streaming, plus the fall-through cases):

| # | `in_reply_to` matches pending settings? | modal outstanding? | bundle streaming? | Behavior |
|---|---|---|---|---|
| 1 | Yes | No | No | Emit `sessionSettingsRejected`, `delete` entry. Reassembler inert, no modal. |
| 2 | Yes | **Yes** | No | Emit rejected, `delete`. **Modal FIFO NOT shifted** (AC2). |
| 3 | Yes | No | **Yes** | Emit rejected, `delete`. **Bundle NOT failed** — a settings error is not a bundle error (precedence rationale §3). |
| 4 | No / absent | Yes | No | Fall-through: shift oldest modal → `modalAnswerRejected` (AC3, unchanged). |
| 5 | No / absent | No | Yes | Fall-through: `reassembler.fail('daemon-error')` (AC3, unchanged). |
| 6 | No / absent | No | No | Fall-through: both inert → nothing (AC3, the pre-#248 drop). |

Other failure modes:

| Failure mode | Layer | Behavior |
|---|---|---|
| `error` frame with absent `in_reply_to` | daemonConnection routing | `inReplyTo === undefined` short-circuits before the map lookup → fall-through (rows 4-6). |
| `error` whose `in_reply_to` matches a **stale** id (already deleted, or a hostile forgery for a change never sent) | daemonConnection routing | No pending entry → fall-through. A hostile daemon cannot fabricate a rejection for a change the client never dispatched (the renderer-minted key + fail-closed lookup is the defense). |
| Malformed decrypted frame | `parseInboundMessage` | Throws `WireDecodeError`; the `onDriverEvent` catch drops it — no event, no throw. Unchanged. The `error` case parses **no** payload, so it cannot itself throw on a malformed `ErrorPayload`. |
| A rejection followed by a second unrelated `error` for the same (now-deleted) id | daemonConnection routing | Second error finds no entry → fall-through, no re-fire (AC5). |

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. New behavior is driven through `parseInboundMessage` directly and through `createDaemonConnection`'s fake-driver harness (`drivers[0].emit({ type: 'message', plaintext })`, `emitted(sink)` / the `rejections(sink)`-style filters).

**`inboundMessage.test.ts` (transport carrier):**
- New: an `error` frame **with** `in_reply_to: N` narrows to `{ kind: 'daemon-error', inReplyTo: N }`.
- New (or assert on the existing case): an `error` frame **without** `in_reply_to` narrows to a `daemon-error` kind whose `inReplyTo` is `undefined`. The existing content-free-log assertion (byte length + hash, no code/message) stays green and is load-bearing (no error content logged).

**`daemonConnection.test.ts` (the correlation core)** — extend the #248 describe block (`:2435`), reusing `errorPlaintext(inReplyTo?)` and the #261 minted-id pattern (`decodeEnvelope(drivers[0].sent[0]).id`):
- **AC1/AC4 match:** `setSessionSettings(payload, 'change-1')`, read the minted id, emit `errorPlaintext(id)` → exactly one `{ type: 'sessionSettingsRejected', changeId: 'change-1' }`; the emitted event's key set is exactly `['changeId', 'type']`.
- **AC2 precedence (settings-match vs modal-outstanding):** with an outstanding `answerModal` AND a pending `setSessionSettings`, emit `errorPlaintext(settingsId)` → one `sessionSettingsRejected`, and **zero** `modalAnswerRejected` (the modal FIFO is untouched — assert `outstandingAnswers` effect via a follow-up uncorrelated error still shifting that modal).
- **AC3 fall-through unchanged:** an `errorPlaintext()` (no `in_reply_to`) with an outstanding modal → the existing `modalAnswerRejected` fires exactly as today; with a bundle in flight → `reassembler.fail('daemon-error')` fires. (The existing `:2513-2525` double-fire test stays green — its error carries no matching settings id.)
- **AC3 no-match with a settings pending:** an `errorPlaintext(unmatchedId)` while a change is outstanding → no `sessionSettingsRejected`, falls through (modal/bundle behave as today).
- **AC4 two same-session changes:** `setSessionSettings(p, 'change-1')` then `(p, 'change-2')` (ids 2 and 3), reject id 3 first → `sessionSettingsRejected` carries `'change-2'`; then reject id 2 → carries `'change-1'`.
- **AC5 drop:** after rejecting `change-1`, a second `errorPlaintext(sameId)` emits **no** further `sessionSettingsRejected`.
- **No-echo (security pin):** `errorPlaintext(id)`'s `message: 'secret error detail'` appears in **no** emitted event (`JSON.stringify(emitted(sink))` assertion, cloning `:2497`); the rejected event carries no `in_reply_to`/`inReplyTo`/code.
- **Reconnect (AC5 backstop):** after `setSessionSettings(p, 'change-1')`, `reconnect()`/`dial()`, then `errorPlaintext(2)` on the new driver → nothing (the pending entry was cleared).

**Three bridge tests** — assert the new arm maps to `null`, no side effect:
- `daemonEventBridge.test.ts` (`:216` style): new `it('sessionSettingsRejected → null …')` asserting `translateDaemonEvent({ type: 'sessionSettingsRejected', changeId: 'change-x' })` is `null`.
- `modalBridge.test.ts` (`:129-131`) + `timelineBridge.test.ts` (`:143-145`): add `{ type: 'sessionSettingsRejected', changeId: 'change-x' }` to each no-op table.

**Type-level:** `npm run typecheck` is the safety net for the new arm — any bridge missing the case fails `assertNever`; any malformed construction fails to compile.

## Security review (`security-sensitive`)

Adversarial pass over the design; verdict at the end. (The pipeline's `security-review.md` is agent-relative and not present in the worktree; this pass follows the codebase's established posture, matching #261 — fail-closed decode, no-echo of attacker bytes, content-free logging, IPC-internal client keys, no wire drift.)

**Trust boundary crossed — internet-exposed daemon → main** (`inboundMessage.ts` decode → `daemonConnection` routing). The new value carried is `in_reply_to`, which is attacker-influenceable (a hostile authenticated daemon can set any numeric value). Defenses:

1. **Only the numeric routing id crosses.** The decode carries `envelope.in_reply_to` (a `number | undefined`) and **nothing else** — no `ErrorPayload.code`, no `message`, no payload bytes. `ErrorPayload` is **not parsed** in the `error` case, so no attacker string can enter via a decode field. This is the deliberate minimisation the ticket calls the sec core.
2. **`in_reply_to` is used only as a `Map<number, …>` lookup key** — never echoed to the renderer, never interpolated into a log or error, never widening the decode surface (`decodeEnvelope` already parsed it; this slice only propagates the existing value). It is **not** placed on the emitted `sessionSettingsRejected` event (the renderer receives its own `changeId`).
3. **Fail-closed correlation / no forgery.** An `in_reply_to` matching no pending entry (a stale id, or a forged one for a change the client never dispatched) finds nothing → no event (rows 4-6). A hostile daemon cannot fabricate a rejection for a user action that never happened. The renderer-minted `changeId` + fail-closed lookup is precisely the defense — `main-minted-then-echoed` would be forgeable; the renderer never learns the wire id.
4. **No content leak on the emitted arm.** `sessionSettingsRejected` has exactly `{ type, changeId }` — the `errorPlaintext()` no-echo test (the `'secret error detail'` fixture must appear in no emitted event) is the regression pin. Diagnostic logging is unchanged and content-free (`in_reply_to` is a routing id, not logged).
5. **Precedence does not weaken the co-consumers.** On a settings match the frame is consumed entirely; on **no** match the #248 modal FIFO and the #116 reassembler behave **exactly** as today (AC3 — a distinct `error` frame with no matching settings id still rejects the oldest modal / fails the bundle). No modal rejection is lost: a modal_answer's own rejection is a separate content-free frame with no `in_reply_to`, so it never matches a settings entry and always reaches the FIFO.

**Verdict: PASS.** No attacker-controlled bytes reach the renderer or a log; the daemon→main boundary is fail-closed; the correlation key stays client-minted and off the wire; the precedence gate strictly narrows (never widens) what the two existing co-consumers see.

## Scope check (6 production files — the atomic `DaemonEvent`-arm case)

This spec prescribes changes to **6** production `.ts` files, **all modifications, zero new files**: `inboundMessage.ts`, `events.ts`, `daemonConnection.ts`, `daemonEventBridge.ts`, `timelineBridge.ts`, `modalBridge.ts` — exactly the footprint the ticket body predicts.

The primary quantitative § 1 red lines **all pass**:

| Gate | Limit | This slice |
|---|---|---|
| New files | > 3 | **0** |
| Total written LOC (prod + test + helpers) | ~600 | ~40 prod + ~150 test ≈ **~190** |
| New exported types / components | > 5 | **0** (one new member on the existing `DaemonEvent` union) |
| Consumer call sites updated simultaneously | > 10 | **~4**, all exhaustiveness-forced no-ops (3 bridges + 1 emit site), no per-site reasoning |
| Acceptance criteria | > 5 | **5**, one coherent correlation path |
| Distinct error/reject branches | > 10 | **1 new** (settings-match) atop 2 existing = 3 total |

The 6-file count trips only the secondary file-count heuristic (§4). This is the recognized **unsatisfiable-for-`DaemonEvent`-arm** case, verified by the objective build-partition test: **there is no two-ticket split where both halves pass `npm run build`.** Adding the arm to `events.ts` without the three bridge cases → `assertNever` fails to compile. Adding the bridge cases without the arm → `case` on a nonexistent type fails to compile. Emitting the event without the `in_reply_to` carrier → dead decode (the arm is never constructed). The carrier without the emit → a 2-line inert micro-ticket. Every partition leaves a broken build or dead code — the salvage gate itself forbids the split.

This is the same shape as the immediate blocker **#261** (5 files, shipped as PR #270) and eight prior merged slices (#180/#201/#214/#217/#229/#241/#254/#264). The distinguishing evidence this is the genuine exception and not a rationalization: the file count **overstates** the work (3 of 6 files are one-line compiler-forced no-op clones of the `sessionSettingsUpdated` arm), whereas the §4 gate exists to catch specs that **understate** it. Ships as one `size:s`.

## Open questions

- **Retryable-code extension (deferred to #256/#257).** `server.binary_offline` is retryable where `session.not_found` / `protocol.malformed` are terminal. This slice surfaces **no** code — rollback is uniform (AC). If #257 (interactive controls) later wants "retry vs. roll back," the fixed dotted-string `code` can be threaded through as a **closed-enum** field on `daemon-error` + `sessionSettingsRejected` (validated against the three known values, unknown → dropped, never the message text). Flagged for #257's architect run; out of scope here.
- **#256 consumption.** #256 (pending→confirm/reject store) consumes both `sessionSettingsUpdated` (`{ sessionId, changeId }`) and this slice's `sessionSettingsRejected` (`{ changeId }`) via one renderer bridge, matching each back to its optimistic entry by `changeId`. The `changeId`-only rejected shape is fixed by this slice; #256 keys its rollback off the same renderer-minted key it dispatched.
