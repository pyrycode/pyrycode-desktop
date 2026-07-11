# #261 — Correlate `set_session_settings` replies to a confirmed event by `in_reply_to`

**Ticket:** pyrycode-desktop#261 · **Size:** S · **Labels:** `security-sensitive`
**Blocked by:** #263 (send path, merged) / #264 (reply decode, merged) · **Consumed by:** #256 (pending→confirm/reject store) · **Sibling follow-up:** #269 (rejected path, blocked by this)

## Context

`set_session_settings` landed as two merged slices: **#263** (outbound send — the builder that mints the request envelope `id`, the renderer→main command, and `daemonConnection.setSessionSettings`) and **#264** (the `session_settings_updated` reply decode). But #264's reply carries **only** `session_id`; it does not say *which* pending change it confirms, and today the arm emits **unconditionally** (dormant — no consumer). The daemon correlates a reply to its originating request by `Envelope.in_reply_to = request.id` (pyrycode#845).

This slice adds the **confirmed round-trip** correlation:

1. The renderer mints a **client-internal correlation key** (a `changeId`) and threads it through the `setSessionSettings` command as an **IPC-only field — never a wire field**.
2. Main remembers `envelopeId → changeId` when it sends, matches the reply by `in_reply_to`, emits the confirmed event carrying `changeId`, and drops the pending entry.
3. Emission becomes **correlation-gated and fail-closed**: a reply matching no pending entry is ignored.

It does **not** correlate errors/rejections (peeled to **#269**), nor build the pending→confirm/reject store (#256) or the interactive controls (#257).

`Envelope.in_reply_to` **already exists and is decoded** (`decodeEnvelope`, codec.ts:135) — this slice *surfaces that existing numeric routing id* through `parseInboundMessage`; it does **not** add a wire field.

## Files to read first

- `src/main/daemonConnection.ts:233-273` — the `createDaemonConnection` local-state block: `nextEnvelopeId` (starts at 2, single-writer), the `mintToken` DI seam, and **`outstandingAnswers`** (#248) — the exact precedent for the new pending map (a per-connection correlation store, pushed-after-send, reset on `dial()`).
- `src/main/daemonConnection.ts:399-410` — the `session-settings-updated` routing case as #264 left it (unconditional emit of `{ type: 'sessionSettingsUpdated', sessionId }`, with the `// Do NOT add inReplyTo — #261 widens this arm` seam comment). This is the case you rewrite.
- `src/main/daemonConnection.ts:704-723` — `setSessionSettings`: mints `nextEnvelopeId`, builds via `buildSetSessionSettings`, sends, **discards the id** (`// correlation itself is #261`). Add the pending-map record here, after a successful send.
- `src/main/daemonConnection.ts:725-754` — `answerModal`: the `outstandingAnswers.push(...)`-**after-send** pattern to mirror (record only once the build/send succeeded, so a throw leaves no phantom entry).
- `src/main/daemonConnection.ts:802-828` — `dial()`: the fresh-connect reset (resets `nextEnvelopeId`, clears `outstandingAnswers`). Add the pending-map clear here.
- `src/main/daemonConnection.ts:151-163` — the `DaemonConnection.setSessionSettings` interface signature + its doc comment (mentions "correlated by #261"). Widen the signature.
- `src/main/transport/inboundMessage.ts:127-144` — the `InboundDaemonMessage` union; the `session-settings-updated` kind (line 138) is the one to widen with `inReplyTo?: number`.
- `src/main/transport/inboundMessage.ts:696-708` — the `session_settings_updated` decode case; carry `envelope.in_reply_to` onto the returned kind.
- `src/main/transport/codec.ts:127-138` — `decodeEnvelope`: confirms `in_reply_to` is decoded as optional `number` (line 135). Read-only — do **not** touch.
- `src/shared/ipc/events.ts:95-102` — the `sessionSettingsUpdated` DaemonEvent arm + its "#261 widens this arm to carry it" seam comment. Widen the arm.
- `src/shared/ipc/commands.ts:64-72` (the `setSessionSettings` command arm), `:129-130` (its guard case), `:197-213` (`isSetSessionSettingsPayload`) — add the IPC-only `changeId` field + its boundary check, mirroring the `isSendMessagePayload` string-check precedent.
- `src/main/index.ts:264-269` — the `setSessionSettings` command dispatch; pass `command.changeId` through.
- `src/main/daemonConnection.test.ts:1344-1390` — the **#264 inbound tests you must rework** (they assert dormant unconditional emit — see Testing) and `:1885-1950` — the **#263 outbound tests** whose `setSessionSettings(...)` calls need the new second arg (their wire-frame assertions double as the "key never rides the wire" check).
- `src/main/transport/inboundMessage.test.ts:874-889` — the #264 recognition tests; note `withExtras` injects `model`/`reason`, **not** `in_reply_to`, so those `toEqual` stay green (see Testing).

## Design

The confirmed round-trip is one coherent flow across the untrusted renderer→main command boundary, the main-side pending store, the internet-exposed decode boundary, and the main→renderer event arm. Five production files, **zero new files, zero new exported types, no bridge edits** (a field-widen of an existing arm is transparent to the three `assertNever` bridges — they switch on `type` and no-op this arm without reading its fields).

### 1. The IPC-only correlation key — `src/shared/ipc/commands.ts`

The renderer mints a `changeId` and rides it alongside the verbatim wire `payload` as a **top-level sibling** (not inside `payload` — `payload` feeds `buildSetSessionSettings` and must stay the exact wire shape). Contract:

```ts
| { type: 'setSessionSettings'; payload: SetSessionSettingsPayload; changeId: string }
```

`isRendererCommand`'s `setSessionSettings` case gains a `changeId` string check (the untrusted-boundary guard — the `isSendMessagePayload` `message_id`-string precedent):

```ts
case 'setSessionSettings':
  return 'payload' in value && isSetSessionSettingsPayload(value.payload)
    && 'changeId' in value && typeof value.changeId === 'string'
```

Keep the arm-header doc comment's AC5 posture accurate: `changeId` is a **client-minted opaque correlation string, never a token/key/raw frame, and never serialized onto the wire** (the builder consumes only `payload`).

### 2. Pass-through — `src/main/index.ts`

```ts
connection.setSessionSettings(command.payload, command.changeId)
```

### 3. The pending map + reply correlation + reset — `src/main/daemonConnection.ts`

**Local state** (next to `outstandingAnswers`, same rationale — a per-connection correlation store, single-writer, reset on `dial()`):

```ts
// envelopeId → renderer-minted changeId, for the set_session_settings confirmed round-trip (#261).
const pendingSettings = new Map<number, string>()
```

**Widen the interface + impl signature** (daemonConnection.ts:163 and :704):

```ts
setSessionSettings(payload: SetSessionSettingsPayload, changeId: string): void
```

**In the `setSessionSettings` method**, capture the minted id and record **after** a successful `driver.sendMessage` — the `answerModal` order, so a build/send throw (caught below) leaves no phantom pending entry:

- capture `const envelopeId = nextEnvelopeId` before building,
- build/increment/send unchanged,
- then `pendingSettings.set(envelopeId, changeId)`.

The `changeId` is **never** passed to `buildSetSessionSettings` — it stays off the wire.

**Rewrite the `session-settings-updated` routing case** (daemonConnection.ts:399-410) from unconditional-emit to correlation-gated-emit. Behavior:

- Read `inbound.inReplyTo`; if absent → **ignore** (return, no event).
- Look up `pendingSettings.get(inReplyTo)`; if absent → **ignore** (AC3, fail-closed — no coercion).
- Otherwise `delete` the entry and emit a **fresh literal** carrying `sessionId` (from the reply) + `changeId` (the client-minted key from the map). Never spread the decoded payload; the `in_reply_to` numeric routing id is **never** placed on the emitted event — the renderer receives its own `changeId`, not the wire id.

Structure the narrowing so `inReplyTo` is a `number` at the `delete`/emit site (early-return on `undefined`), e.g. `const inReplyTo = inbound.inReplyTo; if (inReplyTo === undefined) return; const key = pendingSettings.get(inReplyTo); if (key === undefined) return; …`.

**In `dial()`** (daemonConnection.ts:802-828), clear the map alongside `outstandingAnswers.length = 0`:

```ts
pendingSettings.clear() // AC5: a reconnect abandons outstanding changes — no stale correlation
```

### 4. Carry `in_reply_to` through the transport — `src/main/transport/inboundMessage.ts`

Widen the `session-settings-updated` kind (inboundMessage.ts:138) with the optional numeric routing id:

```ts
| { kind: 'session-settings-updated'; sessionSettingsUpdated: SessionSettingsUpdatedPayload; inReplyTo?: number }
```

In the `session_settings_updated` decode case (inboundMessage.ts:696-708), propagate the **already-decoded** value — do not re-decode:

```ts
return { kind: 'session-settings-updated', sessionSettingsUpdated, inReplyTo: envelope.in_reply_to }
```

`envelope.in_reply_to` is `number | undefined` (codec.ts:135). Undefined when the frame omits it → the kind's `inReplyTo` is `undefined` → daemonConnection's correlation fails closed. The content-free diagnostic log stays unchanged (still `bytes`/`hash` only; `in_reply_to` is a routing id, not logged — no new `DiagnosticEvent` field, so #131's renderer pin is untouched).

### 5. Widen the confirmed event arm — `src/shared/ipc/events.ts`

```ts
| { type: 'sessionSettingsUpdated'; sessionId: string; changeId: string }
```

Update the arm's doc comment: it no longer says "Explicitly NO `inReplyTo`" as a permanent stance — instead, it now carries the **renderer-minted `changeId`** (the match key), and deliberately does **not** carry the wire `in_reply_to` (that numeric routing id stays main-internal). `changeId` is client-minted, non-secret; no token/key/raw frame can ride the arm.

## State + concurrency model

- **Single correlation store per connection**: `pendingSettings: Map<number, string>`, module-local to `createDaemonConnection`, alongside `outstandingAnswers`. The renderer's stores remain the single source of *UI* state; this map is transport-internal correlation memory, not surfaced.
- **Single-writer, no races**: every mutation (`.set` in `setSessionSettings`, `.get`/`.delete` in the synchronous `onDriverEvent` body, `.clear` in `dial()`) runs to completion inside a synchronous body with no `await` between read and write — the `nextEnvelopeId` / `outstandingAnswers` rationale (daemonConnection.ts:256-273) carries over verbatim.
- **Lifecycle**: entries are added on a successful send and removed on a correlated reply. `dial()` clears the map (AC5) — a reconnect abandons outstanding changes, so a stale reply from a dead session can never correlate on the reconnected one (the `nextEnvelopeId` restart-at-2 means ids also recycle across dials; the clear is what makes recycled ids safe).
- **Orphaned entries** (accepted, bounded): a **rejected** settings change produces a `daemon-error`, not a `session_settings_updated` (that path is #269). Under this slice alone, a rejected change's pending entry is **not** removed until `dial()`. This is expected — #269 removes it via `in_reply_to` on the error path; until then the map is bounded by the human-paced rate of settings changes and the `dial()` reset. This mirrors `outstandingAnswers`, which has the same "grows on user action, drained on reply or reset on dial" shape and shipped (#248) without a cap. No cap here either (evidence-based: no observed unbounded-growth failure; parity with the established precedent).

## Error handling

| Failure mode | Layer | Behavior |
|---|---|---|
| Reply with `in_reply_to` matching no pending entry | daemonConnection routing | **Ignored** — no event (AC3, fail-closed). |
| Reply with **absent** `in_reply_to` | daemonConnection routing | Ignored — `inReplyTo === undefined` short-circuits before the map lookup. |
| Malformed `session_settings_updated` (absent/non-string `session_id`) | `parseInboundMessage` | Throws `WireDecodeError`; the `onDriverEvent` catch drops the frame — no event, no throw (unchanged from #264). |
| Renderer sends a `setSessionSettings` command missing/non-string `changeId` | `isRendererCommand` boundary | Rejected at the untrusted boundary — the command never reaches `connection.setSessionSettings`. |
| Build/send throw in `setSessionSettings` (over-cap plaintext, driver throw) | `setSessionSettings` catch | Dropped (parity #490); the pending-map `.set` is skipped (it follows the send), so no phantom entry. |
| A hostile daemon forges a reply with `in_reply_to` for an id the client never sent | daemonConnection routing | No pending entry → ignored. The renderer-minted key + fail-closed lookup is the defense: the daemon cannot fabricate a confirmation for a change the client never dispatched. |

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. New behavior is verifiable by driving `parseInboundMessage` directly and by driving `createDaemonConnection` through its fake driver (the `drivers[0].sent` / `emitted(sink)` harness).

**`inboundMessage.test.ts` (transport carrier):**
- New: a `session_settings_updated` frame **with** `in_reply_to: N` narrows to `{ kind: 'session-settings-updated', sessionSettingsUpdated, inReplyTo: N }`.
- The existing #264 recognition tests (`:876`, `:884`) stay **green unchanged** — they omit `in_reply_to`, so `inReplyTo` is `undefined` and `toEqual` ignores it. Do not edit them. (Add an explicit assertion if desired that a frame omitting `in_reply_to` yields a kind whose `inReplyTo` is `undefined`.)

**`daemonConnection.test.ts` (correlation core) — rework the two #264 inbound tests + add correlation coverage:**
- **Rework** `:1344` ("decodes an inbound session_settings_updated into … sessionId"): a reply with **no prior** `setSessionSettings` send now emits **nothing** (AC3). Split into: (a) *unmatched reply → no event*, and (b) a *matched* round-trip: send `setSessionSettings(payload, 'change-1')`, read the minted id via `decodeEnvelope(drivers[0].sent[0]).id`, emit a reply with `in_reply_to` = that id, assert the emitted event equals `{ type: 'sessionSettingsUpdated', sessionId, changeId: 'change-1' }`.
- **Rework** `:1358` ("emits a fresh literal — only type + sessionId cross IPC, no in_reply_to"): preserve the **security core** — the emitted event must **not** contain `in_reply_to`/`inReplyTo` or any echoed wire key — but update the expected key set to `['changeId', 'sessionId', 'type']` and gate it behind a matched send. The `JSON.stringify(events)` "must not contain `in_reply_to`/`inReplyTo`/echoed model" assertion stays and is load-bearing.
- Keep `:1382` ("drops a malformed … fail-closed") — still valid (malformed → no event, no throw).
- New AC4: two outstanding changes to the **same** `session_id` (`setSessionSettings(p, 'change-1')` then `setSessionSettings(p, 'change-2')`, ids 2 and 3), replies arriving in either order, each confirmed event carries the exact matching `changeId`.
- New AC5: after `setSessionSettings(p, 'change-1')`, a `reconnect()`/`dial()` clears the map; a subsequent reply with `in_reply_to = 2` emits **nothing** (the pending entry was abandoned).
- **#263 outbound tests** (`:1904`-`:1949`): each `connection.setSessionSettings(PARTIAL)` call needs the new second arg (e.g. `setSessionSettings(PARTIAL, 'change-x')`). Their existing frame assertions (`envelope.payload` `toEqual { session_id, yolo }`, no extra key) are unchanged and now **double as the "changeId never rides the wire" security check** — call it out in a comment.

**`commands.test.ts` (boundary guard):**
- The #263 accept cases (`:278`, `:299`) need `changeId` added to the command literal (the typed `RendererCommand` literal at `:282` fails typecheck without it).
- New reject cases: a `setSessionSettings` command with a **missing** `changeId`, and with a **non-string** `changeId`, both return `false`.

**Three bridge tests** (`daemonEventBridge.test.ts:217`, `modalBridge.test.ts:130`, `timelineBridge.test.ts:144`): each constructs `{ type: 'sessionSettingsUpdated', sessionId: 'sess-2' }` — add `changeId: 'change-x'` so the literal satisfies the widened (now-required) arm. The bridges themselves are **not** edited (they no-op this arm regardless of its fields).

**Type-level:** `npm run typecheck` is the safety net for the arm-widen — any un-updated `sessionSettingsUpdated` literal (production or test) fails to compile, which is how you find every construction site.

## Security review (`security-sensitive`)

Adversarial pass over the design; verdict at the end. (The pipeline's `security-review.md` is agent-relative and not present in the worktree; this pass follows the codebase's established posture — fail-closed decode, no-echo of attacker bytes, content-free logging, IPC-only client secrets, no wire drift.)

**Trust boundaries crossed by this slice:**
1. **Untrusted renderer → main** (`commands.ts` / `main/index.ts`): the new `changeId` is renderer-supplied. It is validated at the boundary (`typeof === 'string'` in `isRendererCommand`) exactly as `message_id` is. It is **client-internal correlation data**, not a credential — uniqueness/stability suffice; it is never used for authz. It is **never serialized onto the wire** (the builder consumes only `payload`), enforced structurally by keeping it a top-level sibling of `payload` rather than a field inside the wire type. Verified against `buildSetSessionSettings` (setSessionSettingsEnvelope.ts) — it reads only `payload`.
2. **Internet-exposed daemon → main** (`inboundMessage.ts` decode → `daemonConnection` routing): the new `in_reply_to` is attacker-influenceable (a hostile authenticated daemon). It is a **numeric routing id** used **only** as a `Map<number, …>` lookup key. It is **never echoed** to the renderer (the emitted event carries the client-minted `changeId`, not `in_reply_to`), **never interpolated** into a log or error message, and **never** widens the decode surface (`decodeEnvelope` already parsed it; this slice only propagates the existing value). The `session_id` on the emitted event is unchanged from #264 (already a decoded routing id, not a secret).
3. **Forgery / fail-closed**: a hostile daemon forging `in_reply_to` for an id the client never dispatched finds no pending entry → the confirmed event is not emitted (AC3). The renderer-minted key + fail-closed lookup is precisely what prevents a fabricated confirmation for a user action that never happened. `main-minted-then-echoed` would fail here (the renderer never learns the wire id under fire-and-forget, so it couldn't distinguish two same-`session_id` changes — this is why the key is renderer-minted, per the ticket's Match-Key decision).

**No-echo / no-leak invariants preserved:** the emitted event has exactly `{ type, sessionId, changeId }` — no `in_reply_to`/`inReplyTo`, no spread of the decoded payload (the existing `daemonConnection.test.ts:1374-1379` assertion, reworked to expect 3 keys, is the regression pin). Diagnostic logging is unchanged and content-free.

**Resource bounds:** `pendingSettings` grows on human-paced settings changes and is reset on `dial()`; orphaned (rejected) entries are cleaned by #269. Parity with `outstandingAnswers` (#248), which shipped without a cap. No observed unbounded-growth failure → no cap added (evidence-based).

**Verdict: PASS.** No attacker-controlled bytes reach the renderer or a log; the renderer→main and daemon→main boundaries are both guarded/fail-closed; the correlation key stays off the wire and client-internal.

## Scope check (exactly 5 production files — the atomic DaemonEvent-arm case)

This spec prescribes changes to **5** production `.ts` files, **all modifications, zero new files**: `commands.ts`, `main/index.ts`, `daemonConnection.ts`, `inboundMessage.ts`, `events.ts` — exactly the footprint the ticket body predicts.

The primary quantitative split gate (the § 1 red lines) **all pass**: 0 new files (limit >3), ~25 production LOC + ~120 test LOC ≈ **~145 total** (limit ~600), **0** new exported types/components (limit >5), **1** consumer call site of the widened `setSessionSettings` (`main/index.ts`; limit >10), **5** ACs (limit >5), **2** correlation branches (limit >10 reject branches).

The 5-file count trips only the secondary file-count heuristic. This is the recognized **unsatisfiable-for-DaemonEvent-arm** case: a discriminated-union round-trip (mint at the renderer → command boundary → main pending store → transport carrier → widened arm) cannot be cut without leaving a broken or inert intermediate. Attempted splits are degenerate: peeling the `inReplyTo` carrier off yields a 2-line inert micro-ticket + a 4-file remainder (over-fragmentation); peeling the command plumbing off forces `daemonConnection.ts` into **both** slices → a same-file overlap and a merge-conflict hazard (the § 1.5 failure mode). Eight prior slices of this exact shape (#180/#201/#214/#217/#229/#241/#254/#264) shipped atomic at `size:s` without exhausting the developer turn budget, and this ticket was already architect-peeled + PO-executed to this irreducible confirmed-round-trip core (rejected path → #269). Shipping as one `size:s` is the correct, precedent-backed call.

## Open questions

- **#269 handoff:** this slice introduces the `pendingSettings` map and the renderer-minted `changeId`; #269 (rejected path) reuses both — correlating a `daemon-error` back to a pending entry by `in_reply_to` and removing the orphan. #269's design should confirm the error path can read `in_reply_to` (the `daemon-error` kind currently carries none — it may need the same `inReplyTo?` carrier widen this slice adds for the success kind). Flagged for #269's architect run, out of scope here.
- **#256 consumption:** #256 (pending→confirm/reject store) consumes the widened `{ sessionId, changeId }` confirmed event via one of the renderer bridges. The `changeId` contract (renderer-minted, echoed back on confirm) is fixed by this slice; #256 must mint the same key into the command it dispatches.
