# Spec #264 — Decode `session_settings_updated` into a minimal typed `sessionSettingsUpdated` daemon event

**Size:** S · **security-sensitive** · The inbound **decode arm** of the interactive
Run-configuration write path (grandparent #183 → #255). Split from #255; the sibling outbound **send
path** is **#263 (merged, PR #265)**; the request↔reply correlation is **#261 (blocked by this)**; the
store machine is **#256**, the controls **#257**. **No correlation, no store, no controls, no render
here.** Ships **dormant** — a no-op in every bridge until its consumer (#261) exists.

This is a **near-exact structural clone of #254** (`session_transition` → `sessionTransition`), itself the
#214 / #180 template: one new inbound decode case plus one new sealed `DaemonEvent` arm, wired through the
three exhaustive renderer bridges as **no-ops**. It is **simpler** than #254 in every dimension:

1. The payload is **one field** (`session_id`), not five — **no closed enum, no nullable**. The decoder
   scales `parseSessionTransitionPayload` down to a single `requireString(payload, 'session_id')`.
2. The emit carries **only `sessionId`** — but unlike #254 (which decoded 5 and dropped 4) there is
   **nothing to drop**: the reply *is* one field. Still emit a **fresh literal**, never a spread.
3. **Do NOT carry `in_reply_to`.** The reply↔request correlation key is added by **#261** when its
   consumer (the confirmed/rejected match-key events) exists. Adding it now is speculative dead state
   (Evidence-Based Fix Selection).

## Design source

N/A — transport decode + IPC types + three renderer bridge no-op cases; no UI surface, no DOM sink, no
component. (Same posture as #254 / #214 / #241. The interactive controls that consume the correlated
reply, with Figma 20:111 / 20:130 / 20:143, are the render slice **#257** — not this ticket.)

## Files to read first

Read these before writing a line. The whole design is "clone the `session_transition` chain (#254) for a
**one-field** reply — a single `requireString` decode, a fresh-literal emit carrying only `sessionId`,
and a no-op in all three `assertNever` bridges."

- `docs/specs/architecture/254-decode-session-transition-marker.md` — **read end-to-end first.** The exact
  precedent chain (wire type → decode → `InboundDaemonMessage` kind → emit → `DaemonEvent` arm → renderer
  bridges → security review). This spec is that one, scaled from five fields to one. Where #254 says
  "closed `reason` enum" / "nullable `workspace_cwd`" / "drop four fields at the emit," this spec has none
  of that — a single `requireString` and a single carried field.
- `docs/specs/architecture/263-set-session-settings-send.md` — the **sibling send path** (merged). Shows
  the `set_session_settings` **request** this reply confirms, and its `SetSessionSettingsPayload`. Read the
  presence-contract note there to understand what the client already sent — the reason this reply echoes
  **no settings** (the client knows what it sent; the reply carries only the addressing id).
- `src/shared/wire/types.ts:40-58` — `EnvelopeType` union (`set_session_settings` :51, `session_transition`
  :56). Add `'session_settings_updated'` (group it with the session_* members).
- `src/shared/wire/types.ts:148-155` — `SetSessionSettingsPayload` (#263). Its doc-comment establishes the
  **`session_id` = addressing key, never a secret, always required** convention this reply mirrors. The new
  reply is `SetSessionSettingsPayload` reduced to its `session_id` — **do not** echo `model`/`effort`/`yolo`.
- `src/shared/wire/types.ts:229-265` — `TurnStatePayload` (:229) and `SessionTransitionPayload` (:259):
  the inbound-payload interface + doc-comment template to mirror (name the daemon source `#844`, note "no
  `omitempty` — the one field is always present"). Scale down to a **one-field** interface.
- `src/main/transport/inboundMessage.ts:141-149` — `isRecord` (:141) and **`requireString` (:146)**: the
  two primitives the one-field decoder needs. `requireString` throws
  `WireDecodeError('missing required field: session_id')` on absent / non-string — the fail-closed boundary.
- `src/main/transport/inboundMessage.ts:348-361` — **`parseSessionTransitionPayload` — THE template.** Scale
  it to: `isRecord` guard → `const session_id = requireString(payload, 'session_id')` → `return
  { session_id }`. No enum check, no `requireStringOrNull`, no cross-field validation.
- `src/main/transport/inboundMessage.ts:120-140` — `InboundDaemonMessage` union (`session-transition` kind
  :130). Add one kebab kind `'session-settings-updated'`.
- `src/main/transport/inboundMessage.ts:656-669` — the `case 'session_transition'` switch arm: narrow
  **before** the content-free `inbound-decoded` log. The exact template for `case 'session_settings_updated'`.
- `src/main/daemonConnection.ts:318` — the inner `switch (inbound.kind)`; `case 'session-transition'`
  (:387-398, the fresh-literal-emit model). Add one `case 'session-settings-updated'`.
- `src/shared/ipc/events.ts:60-95` — `DaemonEvent` union; the `snapshotReceived` (:71, dedicated minimal
  shape) and `sessionTransition` (:94) arms. Add one arm (Design § 4). No new import (a bare `string`).
- `src/renderer/src/store/daemonEventBridge.ts:79-89` — the `sessionTransition` no-op case (:79, `return
  null`) + `assertNever` default (:88). Add a dedicated `case 'sessionSettingsUpdated': return null`.
- `src/renderer/src/store/timelineBridge.ts:82-91` — the **stacked** no-op fall-through block
  (`sessionTransition` :82) + `assertNever` (:90). Add a `case 'sessionSettingsUpdated':` label to the stack.
- `src/renderer/src/store/modalBridge.ts:79-85` — the **stacked** no-op fall-through block
  (`sessionTransition` :79) + `assertNever` (:84). Add a `case 'sessionSettingsUpdated':` label to the stack.
- `src/renderer/src/store/sessionIdBridge.ts:26-28` — `case 'sessionTransition'` (:26, its **owned** arm) +
  `default: null` (:28). It consumes **only** `sessionTransition`; the new arm falls to `default: null` →
  **no case, do not touch.** Confirms the "three bridges" census (this is the #259 fifth subscriber).
- `src/renderer/src/store/conversationListBridge.ts:30` — `default: null`, no `assertNever` → **no case, do
  not touch.**
- Test siblings to mirror: `src/main/transport/inboundMessage.test.ts` (session_transition recognition +
  fail-closed cases), `src/main/daemonConnection.test.ts` (emit mapping), `src/renderer/src/store/{daemonEventBridge,timelineBridge,modalBridge}.test.ts` (arm → null).
- SSOT (already validated — **do not re-fetch**; inlined in Wire contract below): pyrycode/pyrycode#844
  (wire vocab) + #845 (handler) — daemon `SessionSettingsUpdatedPayload{SessionID}`.

## Context

When the daemon applies a `set_session_settings` request (pyrycode/pyrycode#844 wire vocab + #845 handler,
both on `main`; the desktop send path is #263, merged), it confirms with a `session_settings_updated`
reply. Desktop advertises the `interactive` capability (#179) and now **sends** the request (#263), but a
`session_settings_updated` envelope currently falls through `parseInboundMessage`'s `default →
inbound-unmodeled → null` — the confirmation is dropped.

This slice adds the missing wire → decode → emit → event chain, surfacing the reply to the renderer as a
new typed `sessionSettingsUpdated` `DaemonEvent`. It **correlates nothing and retains nothing** — the
request↔reply match (via `Envelope.in_reply_to`) and the confirmed/rejected events are **#261 (blocked by
this)**; the store machine that drives the controls is **#256**. Here every consumer bridge no-ops the
arm, exactly as `sessionTransition` was a no-op in all three bridges until its holder (#259) shipped.

Build the decode path Strangler-Fig alongside the existing arms — nothing existing changes behaviour.

## Wire contract (SSOT: pyrycode/pyrycode#844 + #845 — validated, inlined)

`session_settings_updated` — direction daemon → client, v2-only, interactive-gated. Payload is **exactly
one field** (daemon `SessionSettingsUpdatedPayload`). It confirms a `set_session_settings` request landed;
it **does not echo the applied settings** (the client already knows what it sent). Correlation to the
specific pending request is by `Envelope.in_reply_to` — **not carried here** (that is #261).

| Field | Type | Notes |
|---|---|---|
| `session_id` | `string` | The session the settings were applied to; the addressing key. Always present (no `omitempty`). Matches the request's `session_id` and the daemon's `Pool.UpdateSettings` id. A routing id, **not a secret** (the `SetSessionSettingsPayload.session_id` / `conversation_id` convention). |

**No other field exists on this reply** — there is nothing to drop and nothing to widen. `in_reply_to`
lives on the **`Envelope`**, not the payload, and is decoded/carried by #261 when its consumer exists.

## Design

Seven thin, additive touchpoints, each cloning the `session_transition` sibling arm, scaled to one field.
Nothing existing changes behaviour.

### 1. Wire type — `src/shared/wire/types.ts`

Add a **one-field** payload interface, field-for-field with the daemon (mirror the `TurnStatePayload` /
`SessionTransitionPayload` doc-comment style):

```ts
export interface SessionSettingsUpdatedPayload {
  session_id: string
}
```

Add `'session_settings_updated'` to the `EnvelopeType` union (group with the session_* members).
Doc-comment: name the daemon source (#844 / #845), note "no `omitempty` — the one field is always present
on the wire", note it confirms a `set_session_settings` (#263) request **without echoing the settings**
(the client knows what it sent), and note `session_id` is the addressing key, **a routing id not a secret**
(the `SetSessionSettingsPayload.session_id` convention). **No `WireSessionSettingsUpdatedReason` or any
enum** — there is no such field.

### 2. Inbound decode — `src/main/transport/inboundMessage.ts`

- Add the union arm `| { kind: 'session-settings-updated'; sessionSettingsUpdated:
  SessionSettingsUpdatedPayload }` to `InboundDaemonMessage` (kebab kind, consistent with
  `session-transition` / `turn-state`). Add `SessionSettingsUpdatedPayload` to the type import block.
- Add `parseSessionSettingsUpdatedPayload(payload: unknown): SessionSettingsUpdatedPayload` — the
  minimal fail-closed decoder: `isRecord` guard (throw `WireDecodeError` on non-object), then
  `const session_id = requireString(payload, 'session_id')`, then `return { session_id }`. Returns exactly
  the one known field; tolerates extra keys, does not copy them. **No enum check, no `requireStringOrNull`,
  no cross-field validation** — there is only one required string. Every error message names the failure
  **category only** (`requireString` already emits `missing required field: session_id` — never interpolate
  the value; a `session_id` is conversation-correlating). Behaviour asserted by the fail-closed +
  happy-path tests (§ Testing).
- Add `case 'session_settings_updated'` to `parseInboundMessage`'s `switch (envelope.type)` (mirror
  `case 'session_transition'`, :656-669): narrow **before** logging so a malformed frame throws first and
  leaves no record; emit the existing content-free record `{ event: 'inbound-decoded', code:
  'session_settings_updated', bytes: plaintext.length, hash: hashPlaintext(plaintext) }` — **no decoded
  field** is logged; then `return { kind: 'session-settings-updated', sessionSettingsUpdated }`.

The existing `MAX_PLAINTEXT_BYTES` guard at the top of `parseInboundMessage` already fails oversized frames
closed for this type too — do not add a second guard.

### 3. Consumer emit — `src/main/daemonConnection.ts`

Add one `case 'session-settings-updated'` to the inner `switch (inbound.kind)` (mirror
`case 'session-transition'`, :387-398). Emit a **fresh literal carrying only `sessionId`**:

```ts
case 'session-settings-updated':
  emitDaemonEvent(sink, { type: 'sessionSettingsUpdated', sessionId: inbound.sessionSettingsUpdated.session_id })
  return
```

A fresh literal with the one named field, **never a spread** of the decoded payload, so only the narrowed
id crosses IPC. There is nothing else on the reply to drop; the fresh-literal-not-spread discipline is
still the rule (it also blocks any future extra decoded key from silently riding the arm). **Do not add
`inReplyTo` / `in_reply_to`** — #261 widens this arm when its consumer exists.

### 4. `DaemonEvent` arm — `src/shared/ipc/events.ts`

Add one arm carrying a single string (no new import — a bare `string`):

```ts
| { type: 'sessionSettingsUpdated'; sessionId: string }
```

Mirror the `sessionTransition` doc-comment (dedicated minimal shape): note it carries **only** the
addressing id; it confirms a `set_session_settings` (#263) landed and echoes no settings; no token, key, or
raw frame (AC3-by-construction); its consumer is **#261 / #256 (not yet built)**, so **all three bridges
no-op it** for now — the `sessionTransition`-was-a-no-op-until-#259 precedent. **Explicitly note: no
`inReplyTo` — #261 widens this.**

### 5–7. Renderer bridges (three no-ops) — the atomic-union tax

The `DaemonEvent` union is guarded by **three** independent `assertNever` exhaustiveness checks, so a new
arm is a **compile error** in each until it has a case. All three no-op `sessionSettingsUpdated` (its only
consumer is #261 / #256):

- **`daemonEventBridge.ts`** — add a dedicated `case 'sessionSettingsUpdated': return null` to the no-op
  fall-through block (mirror `sessionTransition` :79-83). Comment: *no session-store action — #261 / #256
  consume this; present only because the `assertNever` guard makes a new arm a compile error.*
- **`timelineBridge.ts`** — add a `case 'sessionSettingsUpdated':` label to the **stacked** no-op block at
  :78-89 (**not** a timeline item — no timeline row). The shared `return null` covers it.
- **`modalBridge.ts`** — add a `case 'sessionSettingsUpdated':` label to the **stacked** no-op block at
  :76-83 (no modal action). The shared `return null` covers it.

`conversationListBridge.ts` (`default: null`) and `sessionIdBridge.ts` (#259 — `case 'sessionTransition'`
then `default: null`, consumes only `sessionTransition`) use `default: null` with **no `assertNever`** →
**no case, do not touch either.** This is the census the ticket names: three `assertNever` bridges get a
case, two `default: null` filters do not.

### Data flow

```
relay socket (untrusted)
  → Noise decrypt → plaintext bytes
  → parseInboundMessage()        [transport boundary: fail-closed decode of the one field + content-free log]
      envelope.type 'session_settings_updated'
        → parseSessionSettingsUpdatedPayload (requireString session_id)
        → { kind:'session-settings-updated', sessionSettingsUpdated }
  → daemonConnection switch(inbound.kind)   [consumer: fresh-literal emit, only sessionId]
      → emitDaemonEvent { type:'sessionSettingsUpdated', sessionId }
  → IPC (DAEMON_EVENT_CHANNEL) → renderer
      → daemonEventBridge → null   (session store: nothing)
      → timelineBridge    → null   (timeline: nothing)
      → modalBridge       → null   (modal: nothing)
      → [#261 correlation / #256 store — NOT built here — will consume this arm]
```

## State + concurrency model

No new state, no new store, no new async task, no new IPC channel, no correlation map. Decode is a pure
synchronous function; the event rides the existing one-way `DAEMON_EVENT_CHANNEL` via `emitDaemonEvent` on
the existing driver read loop. The three renderer bridges are pre-existing independent subscribers on that
channel; each no-ops the new arm. Nothing is retained or correlated **here** — that is #261 / #256.
Cancellation, socket lifecycle, and reconnect are unchanged and owned upstream (`relaySupervisor` /
`noiseRelayDriver`).

## Error handling

- **Any structural / semantic mismatch** — payload not an object; a missing / non-string `session_id` →
  `parseSessionSettingsUpdatedPayload` throws `WireDecodeError` (never a partial or coerced value).
  `daemonConnection`'s existing `try/catch` around `parseInboundMessage` drops the frame — no event, no
  throw upward, no log (the caught error is dropped so it can't echo plaintext). No new catch needed.
- **Oversized frame** → the existing `MAX_PLAINTEXT_BYTES` guard throws before decode.
- **Well-formed but unmodeled** (a future reply before its own slice) → still falls to `default →
  inbound-unmodeled → null`. Only `session_settings_updated` graduates here.
- **Category-only error messages** — `requireString`'s `missing required field: session_id` names the field
  only, never interpolating the value (a `session_id` is conversation-correlating), matching the decoder's
  uniform no-echo discipline.
- **Content-free diagnostics** — the new log call carries only `code` + `bytes` + one-way `hash`, never a
  decoded field. The throw path stays unlogged (narrow before log).

## Testing strategy

Bullet scenarios; the developer writes the vitest code in the project idiom, mirroring the
`session_transition` cases. `npm test` + `npm run build` + `npm run typecheck` must stay green.

**`inboundMessage.test.ts`** (mirror the `session_transition` cases):
- Well-formed `session_settings_updated` decodes to `{ kind: 'session-settings-updated',
  sessionSettingsUpdated: { session_id: '<value>' } }`.
- Fail-closed — **throws `WireDecodeError`, no partial value** — for: `session_id` absent / non-string
  (number, object, `null`); the payload not an object (`'nope'`, `['a']`, `null`).
- Extra server-added key (e.g. a spurious `model` echo, or an unexpected `reason`) is tolerated (decodes
  fine) but **not copied** onto the result — assert the result has only `session_id`.
- Content-free logging: with an injected `DiagnosticLog`, a decoded `session_settings_updated` logs
  `code:'session_settings_updated'`, `bytes`, `hash`, and the record contains **no** decoded field. A
  malformed frame throws and logs **nothing**.

**`daemonConnection.test.ts`** (the safety net for the un-`assertNever`'d inner switch — a missing consumer
case silently drops):
- A `session_settings_updated` frame delivered through the driver emits exactly one
  `{ type:'sessionSettingsUpdated', sessionId }` with the wire's `session_id`.
- **Fresh-literal assertion:** the emitted event has **only** `type` + `sessionId` — no `in_reply_to` /
  `inReplyTo` and no extra decoded key (even if the frame carried a spurious echoed `model`) rides the arm.
- No regression: coarse `message` / `message_chunk` still emit `messageReceived` / `messagesReceived`.

**`daemonEventBridge.test.ts` / `timelineBridge.test.ts` / `modalBridge.test.ts`**: each `translate…`
returns `null` for the `sessionSettingsUpdated` arm (mirror the `sessionTransition` no-op case). This plus
the three `assertNever` guards is the compile-time + runtime proof all three bridges handle the arm and
none dispatches on it.

**`types.test.ts`** (if the suite asserts wire-type shape): the new `SessionSettingsUpdatedPayload` /
`EnvelopeType` member compile (type-level, mirror existing). Optional — the type-level proof is
`npm run typecheck`.

Type coverage: `npm run typecheck` — the three `assertNever` guards are the exhaustiveness proof that every
subscriber handles the new arm.

## Scope self-check (7 production files — read this before flagging oversize)

This spec prescribes changes to **exactly 7 production `.ts` files, 0 new files** (verified by reading every
touchpoint on `main`; no hidden cascade):

1. `src/shared/wire/types.ts` — `SessionSettingsUpdatedPayload` + 1 `EnvelopeType` member
2. `src/main/transport/inboundMessage.ts` — 1 parse fn + 1 kind + 1 switch case
3. `src/main/daemonConnection.ts` — 1 consumer emit case
4. `src/shared/ipc/events.ts` — 1 `DaemonEvent` arm
5. `src/renderer/src/store/daemonEventBridge.ts` — 1 `assertNever` no-op case
6. `src/renderer/src/store/timelineBridge.ts` — 1 `assertNever` no-op case label
7. `src/renderer/src/store/modalBridge.ts` — 1 `assertNever` no-op case label

This crosses the commit-gate file-count boundary (≥5), so the keep-as-S is **documented, not assumed** — a
deliberate keep on direct, merged precedent, not an undercount rationalization:

- **The union change is atomic — it cannot be split.** Adding an inbound `DaemonEvent` arm needs: wire type
  → decode → connection emit → event union → **all three** `assertNever`-guarded renderer bridges. Each
  bridge is a **compile error** (`npm run build` — the salvage gate — fails) until it has a case, so the
  seven files are one indivisible change. Any proposed slice either doesn't compile (an arm with a missing
  bridge case) or decodes into an `InboundDaemonMessage` kind the un-`assertNever`'d inner switch **silently
  drops** — a decode with no consumer, dead code a reviewer would flag. There is no valid seam.
- **7 is the architectural floor.** Drop any bridge and `typecheck` fails; drop the emit and the decode is
  dead. This is the identical footprint #254 shipped (7 prod files) — this ticket is strictly simpler
  (one field vs five; no enum; no nullable; nothing dropped at the emit).
- **Every file is a load-bearing, tiny, cloned edit** — 1–8 lines each, cloning `session_transition` in the
  same file. This is the opposite of the gate's target failure (a *claimed*-small / *actual*-huge cascade).
  Nothing is hidden.
- **Direct clean precedents shipped this exact atomic shape as one `size:s` and merged:** #254
  (`session_transition` arm, 7 prod files, PR #260), #241 (`conversation_created` arm — the memory's
  "≥5-file gate UNSATISFIABLE for a DaemonEvent-arm → ONE size:s"), #214 (6 prod files), #180 (8 prod
  files). All PASS, no salvage.
- **Every line-based red line (the accurate turn-budget proxy) passes comfortably:** 0 new files,
  ~40 production + ~90 test ≈ **~130 total LOC** (well under 600), **1 new exported type**
  (`SessionSettingsUpdatedPayload`; the arm/kind are union members, not exports), **0 consumer call-site
  cascade** (the three bridge cases are compile-forced single lines/labels), **0 reject branches beyond the
  one shared `requireString` throw**, **3 ACs** all facets of one atomic change. Projected turn cost tracks
  #254 minus its enum/nullable/content-drop work (~10–18 turns), well inside budget.

Conclusion: genuine, verified, merged-precedented S — an atomic union arm, structurally un-splittable,
strictly simpler than #254. Not an undercount. Proceed.

## Open questions

- **Emit shape — settled at minimal.** The arm carries **only `sessionId`** — the reply's only field. There
  is nothing else to carry or drop.
- **`in_reply_to` — deliberately deferred to #261.** The reply↔request correlation key lives on the
  `Envelope`, not the payload. #261 (blocked by this) decodes it and widens this arm to carry the match key
  when its consumer (the confirmed/rejected events) exists. Carrying it here is speculative dead state
  (Evidence-Based Fix Selection); widening the arm later is a one-line additive change — the posture #191
  used to add usage ints to `snapshotReceived` after #180 shipped.
- **Inner-switch exhaustiveness (deferred, not adopted).** `daemonConnection.ts`'s `switch (inbound.kind)`
  still has no `default: assertNever(inbound)`, so a missing consumer case would silently drop rather than
  fail to compile. The `daemonConnection.test.ts` emit test is the deterministic safety net (same as #254 /
  #214 / #241). **Do not** expand scope to guard the switch here.
- **`EnvelopeType` placement.** Grouping `'session_settings_updated'` with the session_* members is
  cosmetic; the union is unordered. No behaviour depends on position.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST-FIX. The untrusted→trusted boundary (relay socket → decrypted plaintext →
  `parseInboundMessage`) gains one explicit, single-function fail-closed decoder
  (`parseSessionSettingsUpdatedPayload`), throwing `WireDecodeError` on any structural/semantic mismatch,
  never a partial value — the same named boundary that already owns `message` / `session_transition`. The
  gate is the `requireString('session_id')` presence/type check: a hostile daemon cannot smuggle an object,
  `null`, a number, or a `'__proto__'`-style value onto `session_id` — anything not a string throws and the
  frame drops. Positive control against IPC-side unknown-key / prototype leakage: the consumer emits a
  **fresh object literal** with one named field (`{ type:'sessionSettingsUpdated', sessionId }`), never a
  spread of the decoded payload — so even a spurious echoed `model`/`reason`/`in_reply_to` on the frame
  cannot ride the arm to the renderer.
- **[Trust boundaries — code-review must verify]** SHOULD FIX (design-directed, already specified). The
  security property is (a) the `requireString` fail-closed decode and (b) the fresh-literal one-field emit.
  If the developer emits a spread / the whole payload instead of the one-field literal (Design § 3), any
  extra decoded key leaks to the renderer; if they speculatively add `inReplyTo`, they ship dead untyped
  state. Both are called out in the design and pinned by the `daemonConnection.test.ts` "only `type` +
  `sessionId`" assertion. A green suite proves the boundary shipped.
- **[Tokens / secrets]** N/A by design. No token/key/credential is added, decoded, or carried. A
  `session_id` is a **routing id, not a secret** (the existing `SetSessionSettingsPayload.session_id` /
  `conversation_id` convention, AC3). The reply echoes no settings; the arm can hold no key/token/raw frame.
- **[File / storage]** N/A — no filesystem or storage operation. This slice retains nothing (the store is
  #256); it decodes and forwards one string.
- **[Electron attack surface]** No finding. No new `BrowserWindow`, `webPreferences`, IPC channel,
  `ipcMain` handler, custom protocol, or preload method — the arm rides the existing one-way
  `DAEMON_EVENT_CHANNEL` (`emitDaemonEvent`) the preload already forwards generically (no per-type preload
  change). Process placement preserved: decode lives in `src/main/transport/inboundMessage.ts` (main-only,
  imports `Buffer`, never re-exported to a renderer barrel); no key, socket, or raw frame moves toward the
  renderer. The single `sessionId` string flowing main→renderer grants the renderer no new reach toward
  transport / keys.
- **[Cryptographic primitives]** N/A — no RNG, key, nonce, or handshake code. `hashPlaintext` (BLAKE2s via
  `@noble/hashes`, note #101) is reused verbatim for the content-free log; no new or hand-rolled crypto.
- **[Network & I/O]** No finding. The existing `MAX_PLAINTEXT_BYTES` (65519) guard fails an oversized
  `session_settings_updated` frame closed before decode — no new size cap needed. The payload is one flat
  scalar (no array, no nesting) so there is no decode amplification and no regex (no ReDoS); a hostile
  oversized `session_id` string is bounded by `MAX_PLAINTEXT_BYTES` and never widened. No new socket /
  timeout / reconnect surface.
- **[Error messages, logs, telemetry]** No finding — the category this ticket is security-sensitive *for*,
  addressed head-on. The one new diagnostic call is **content-free** (`code:'session_settings_updated'` +
  `bytes` + one-way `hash` only), emitted **after** the frame fully narrows so the throw path leaves no
  record; the parser error message names the field **category only** (`missing required field: session_id`
  — never interpolating the id); the `WireDecodeError` caught in `daemonConnection` is dropped, never logged
  or forwarded.
- **[Concurrency]** No finding — no new async task, timer, listener, or socket; decode is synchronous; the
  event rides the existing driver read loop. No shared-state check-then-act, nothing to cancel or leak, no
  retained state (the store is #256). The three renderer bridges are pre-existing independent subscribers.
- **[Threat model alignment]** Addressed for the boundary this slice owns. *Malicious/compromised relay*
  (on-path, content-blind): a flood of malformed `session_settings_updated` frames all throw and drop — no
  plaintext leak, no log record, no hang (synchronous, frame-bounded). *Hostile daemon response*
  (malformed/oversized/extra-key inside the session): the one field is parsed defensively, fail-closed, and
  a fresh-literal emit blocks any smuggled extra key from crossing IPC. *Renderer compromise reaching
  transport*: unchanged — no new renderer capability; the renderer gains only one opaque routing id.
  *Correlation-confusion* (a reply with a forged `in_reply_to`): **out of scope by design** — this slice
  carries no correlation key; #261 owns that boundary and its own review.
- **[Untrusted content at render — none forwarded]** This arm forwards **no untrusted display text** to any
  render slice — only `sessionId`, an opaque routing id consumed by #261 / #256 (not a DOM sink). The reply
  echoes no `model` / `effort` / workspace text. There is no untrusted-text-at-DOM concern to forward.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-11
