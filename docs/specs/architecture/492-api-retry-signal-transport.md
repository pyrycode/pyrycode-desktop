# Spec: Api-retry signal transport — decode the daemon `api_retry` frame into a typed `apiRetry` event (#492)

**Size:** S · **Security-sensitive:** yes · Split from #488 · Peer of `stall` transport (#315) · Render half: #493

## Context

When claude hits an API error it retries, rendering a live status line (`API error · Retrying in Ns ·
attempt N/M`). The daemon detects this and emits an `api_retry` frame on the v2 interactive stream
(pyrycode #1074, merged 2026-07-21; detector upstream tui-driver #303, closed). The daemon fans it out
**only to `interactive`-capable clients**; desktop already advertises `interactive`
(`daemonConnection.ts:855`), so the frame reaches us today — but the transport drops it as an unmodeled
type, which is why the window still shows a generic "thinking" state.

This slice is the **decode half only**: recognise the frame, fail-closed decode it, and emit a typed
`apiRetry` `DaemonEvent` that ships **dormant**. The render half (the on-thread retry indicator carrying
the attempt count) is the companion slice **#493** and is the first real consumer.

Wire facts — mirror the daemon field-for-field, do not drift (CLAUDE.md / ADR 0002). SSOT: pyrycode
`docs/protocol-mobile.md:571-592` §`api_retry`, `internal/protocol/interactive.go` (`ApiRetryPayload`),
`internal/protocol/testdata/api_retry.json`:

- **Type string:** `api_retry`.
- **Payload:** `conversation_id` (string), `active` (bool), `current` (int), `total` (int) — all always
  present, no `omitempty`. Canonical fixture:
  `{"conversation_id":"c1","active":true,"current":3,"total":10}`.
- **NOT onset-only** — the deliberate contrast with `stall` (#315). `active: true` is the rising edge,
  `active: false` the falling edge (claude recovered). The counter rides **both** edges; the falling edge
  repeats the last-known value verbatim so the final render stays coherent.
- **The rising edge re-fires as the count climbs** (`3/10` → `4/10`). No dedup on the wire and no per-tick
  flood (the daemon re-fires only on an actual count change) ⇒ **this slice must not dedup or coalesce
  either**.
- **`current: 0` alongside `total: 0` is legitimate** — "retrying, count unknown" (claude's on-screen
  counter did not parse). Not an error; must decode.
- A PTY-derived status peer of `stall`: conversation-level, **not** turn-scoped (no `turn_id`); receiving
  it never opens, closes, or alters a turn.

This follows the #315 `stall` slice end-to-end: a new wire type, a new inbound arm, a fail-closed decoder,
a new `DaemonEvent` arm, and the exhaustive-bridge updates. The one shape difference is that this event is
**not nullary** — it carries the edge and the counter.

## Design source

N/A — pure transport / decode slice; the event ships dormant with zero rendered surface. The visual design
for the retry indicator belongs to the render slice **#493**, whose parent (#488) recorded the thread-chrome
Figma position as N/A-justified (transient thread chrome — thinking #215, empty #277, banner #279,
stop-state #305, stall #317 — is undrawn in the mobile file; node `16-8` is the Conversation Thread frame).
The visual-fidelity check is intentionally skipped here.

## Files to read first

Codegraph is not initialized in this repo (`mcp__codegraph__*` returns "CodeGraph not initialized") — this
list was built from direct Read/grep against `main`. Every edit mirrors an existing `stall` (#315)
counterpart; read the `stall` site before writing its `api_retry` twin.

| Path (with lines) | What to extract |
|---|---|
| `src/shared/wire/types.ts:40-87` | `EnvelopeType` string union — add `'api_retry'` beside `'stall'` (line 57). |
| `src/shared/wire/types.ts:268-281` | `StallPayload` + its doc-comment — the shape and comment template for `ApiRetryPayload` (which has four fields, not one, and is NOT onset-only). |
| `src/main/transport/inboundMessage.ts:199-228` | `requireString` (:200) / `requireNumber` (:211) / `requireBoolean` (:222). **All four new fields map 1:1 onto these — do NOT write a new helper.** `requireNumber`'s `typeof === 'number'` admits `0` for free; `requireBoolean`'s docstring already codifies "the check is on the TYPE, never truthiness — `false` is a valid value, not an absence." |
| `src/main/transport/inboundMessage.ts:192-197` | `isRecord` — the non-object payload guard. |
| `src/main/transport/inboundMessage.ts:388-403` | `parseStallPayload` — the exact template for `parseApiRetryPayload` (scale from one field to four). |
| `src/main/transport/inboundMessage.ts:99-104` | The `stall` kind's doc-comment block on the `InboundDaemonMessage` union — the comment-discipline template. |
| `src/main/transport/inboundMessage.ts:165-180` | `InboundDaemonMessage` union — `{ kind: 'stall'; stall: StallPayload }` at :173 is the new arm's neighbour. |
| `src/main/transport/inboundMessage.ts:768-772` | The frame-level `MAX_PLAINTEXT_BYTES` oversize guard (:770) — already covers the oversized case; mirror, do not add a per-field length check. |
| `src/main/transport/inboundMessage.ts:875-888` | `case 'stall':` — the narrow-before-log block to clone as `case 'api_retry':`. |
| `src/main/diagnosticLog.ts:39-48` | `DiagnosticEvent` — `code?: string` is an open field (:43), so `code: 'api_retry'` needs **no** type widening; confirms the content-free field set (`event`, `code`, `bytes`, `hash`). |
| `src/shared/ipc/events.ts:112-121` | The `stallDetected` arm + its comment discipline ("conversation_id dropped at the emit / no token, key, raw frame"). Contrast: this arm is **not** nullary. |
| `src/shared/ipc/events.ts:105-113` | `turnState` — the nearest **non**-nullary status arm (carries a validated scalar); the field-comment template for carrying data. |
| `src/main/daemonConnection.ts:588-601` | `case 'turn-state'` (:588, carries a field) and `case 'stall'` (:594, nullary) emits. **This inner switch has NO `assertNever`** (:598 says so explicitly) — a missing/wrong emit compiles silently; the round-trip test is the only guard. |
| `src/renderer/src/store/daemonEventBridge.ts:118-145` | Per-arm explicit `case X: /* why */ return null` cluster ending in `assertNever` (:144) — add one arm in that style. |
| `src/renderer/src/store/timelineBridge.ts:86-137` | `case 'stallDetected'` is now an **owned** arm (:86-91, since #317) — do NOT copy it. The new arm joins the **no-op fall-through cluster** at :92-136, before `assertNever` (:137). |
| `src/renderer/src/store/modalBridge.ts:85-106` | No-op fall-through cluster + `assertNever` (:106) — add the arm to the cluster and name it in the trailing comment. |
| `src/main/transport/inboundMessage.test.ts:138-141, 176-178` | `encodeStall` helper + the `STALL` fixture — clone as `encodeApiRetry` + an `API_RETRY` fixture. |
| `src/main/transport/inboundMessage.test.ts:1424-1466` | `stall` recognition (:1424) + fail-closed (:1450) describes — the clone targets. |
| `src/main/transport/inboundMessage.test.ts:1444-1448` | The "still returns null for a well-formed envelope of another unmodeled type (no widening)" regression test. |
| `src/main/transport/inboundMessage.test.ts:2211-2240` | Content-free diagnostic test (:2211) **and** the "does NOT log on a malformed throw path" test (:2230) — both must be cloned. |
| `src/main/daemonConnection.test.ts:245-248` | `stallPlaintext(payload)` helper — clone as `apiRetryPlaintext(payload)`. |
| `src/main/daemonConnection.test.ts:1348-1385` | The `stall stream` round-trip describe: `drivers[0].emit({ type: 'message', plaintext })` against a `connected()` fixture, asserting the exact emitted-event array plus the malformed-drop case. **This is the harness — there is no `fakeDaemon`.** |
| `src/renderer/src/store/timelineBridge.test.ts:~202` / `modalBridge.test.ts:~159` | The inverse-filter `others` arrays (each ends with `relayLinkChanged` / `notificationActivated`) — append the new arm. |
| `src/renderer/src/store/daemonEventBridge.test.ts:264-267` | Per-arm `.toBeNull()` block (`relayLinkChanged`) — clone one for the new arm. |
| `docs/specs/architecture/315-stall-signal-transport.md` | The peer spec, end-to-end. Read it before starting. |

## Scope note (why this ships as one `s` despite touching 7 production files)

The commit-time ≥5-production-file self-check trips here (7 `.ts` files modified), but this is the
documented **DaemonEvent-arm, bridges-atomic** shape where that gate is *structurally unsatisfiable*, not a
hidden-blowup false negative:

- A new `DaemonEvent` arm (`events.ts`) **compile-forces** a case in all three exhaustive bridges via their
  `assertNever` guard (`daemonEventBridge.ts:144`, `timelineBridge.ts:137`, `modalBridge.ts:106`). Those
  cases cannot land in a separate commit — omitting any one fails `npm run build`, the QA gate. The three
  bridges are atomic with the arm.
- The transport decode (`types.ts`, `inboundMessage.ts`, `daemonConnection.ts`) exists *only* to feed that
  arm; a decode-without-arm child is dead code (a decoder whose `kind` is silently dropped, with no emit to
  test).
- Every attempted split either produces a dead-code sub-leaf **or** leaves the arm-bearing child still at
  ≥5 files. No genuine seam exists.

**Precedent:** #315 (`stall` transport) shipped this identical shape as one `s`; #214 (`turn_state`) and
#241 (`create_conversation`) adjudicated the same conflict the same way.

Every §1 red line is clear: **0 new files**; **~250 total LOC** (production + tests + fixtures, well under
600); **1 new exported type** (`ApiRetryPayload`); **4 consumer sites** (1 emit + 3 compile-forced bridges);
**5 ACs**; **5 reject branches** in the decoder (non-object payload + four fields). This is a mechanical
mirror of #315 against an exact template, scaled from one field to four — the developer's turn budget is
comfortable.

## Design

Seven touch-points, mirroring `stall` (#315) end-to-end. No new files; every edit is additive to an
existing module.

### 1. Wire type — `src/shared/wire/types.ts`

- Add `'api_retry'` to the `EnvelopeType` union, beside `'stall'` (:57).
- Add the payload interface (contract, not implementation):

  ```ts
  export interface ApiRetryPayload {
    conversation_id: string
    active: boolean
    current: number
    total: number
  }
  ```

  Field order mirrors the daemon's `ApiRetryPayload` (pyrycode #1074). Doc-comment it like `StallPayload`,
  recording the three contract traps that differ from `stall`: (a) **not onset-only** — an explicit falling
  edge `active: false`, so the client never derives "cleared" from turn activity; (b) the rising edge
  **re-fires as the count climbs**, with no wire dedup; (c) **`0/0` is a legitimate "count unknown"**, not
  an error and not a sentinel to coerce away. Also record what it is *not*: conversation-level, no
  `turn_id`, never opens/closes/alters a turn.

### 2. Inbound decode — `src/main/transport/inboundMessage.ts`

- Import `ApiRetryPayload`.
- Add the inbound arm to `InboundDaemonMessage`: `| { kind: 'api-retry'; apiRetry: ApiRetryPayload }`
  (hyphenated `kind`, matching `turn-state` / `session-transition`). Extend the union's doc-comment block
  in the `stall` paragraph's style: what the frame is, what the consumer carries onward (`active` /
  `current` / `total`, dropping `conversation_id`), and which check is the boundary this slice defends.
- Add the **fail-closed** decoder next to `parseStallPayload`:

  ```ts
  function parseApiRetryPayload(payload: unknown): ApiRetryPayload
  ```

  Behavior: `isRecord` guard (throws `WireDecodeError('malformed api_retry payload')` on a non-object),
  then `requireString(payload, 'conversation_id')`, `requireBoolean(payload, 'active')`,
  `requireNumber(payload, 'current')`, `requireNumber(payload, 'total')`. Returns a **fresh four-field
  literal** — unknown server-added keys tolerated (forward-compat) but never copied through. Error messages
  name the failure **category only** (the shared helpers already emit `missing required field: <field>`);
  never interpolate a value.

  **Do not invent a new number check.** `requireNumber` is a plain `typeof === 'number'` test, in house use
  since #116 for `seq` / `total` / `used_tokens` / `window_tokens` / `queued_msg_id`. It therefore admits
  `0` for free — the `0/0` criterion needs **no** special-casing, only the absence of a truthiness check. It
  deliberately does not validate integer-ness or range, and there is **no house precedent for
  range-validating a wire integer**; do not add one here (see Security review, finding 6). Likewise
  `requireBoolean` already handles the falling edge: `false` is a value, not an absence.
- Add `case 'api_retry':` to the `parseInboundMessage` type-switch, cloning the `stall` block at :875:
  **narrow before logging** (`parseApiRetryPayload` first, so a malformed frame throws before any record is
  written), then
  `diagnosticLog?.event({ event: 'inbound-decoded', code: 'api_retry', bytes: plaintext.length, hash: hashPlaintext(plaintext) })`,
  then `return { kind: 'api-retry', apiRetry }`.

**Oversize:** no per-field length check — the frame-level `plaintext.length > MAX_PLAINTEXT_BYTES` guard
(:770) already fails an oversized frame closed before this arm runs, exactly as `stall` relies on it.
Mirror, do not add.

### 3. Typed event — `src/shared/ipc/events.ts`

- Add the arm to `DaemonEvent`, near `stallDetected`:

  ```ts
  | { type: 'apiRetry'; active: boolean; current: number; total: number }
  ```

  Name follows the wire-name-camelCase convention (`turnState` ← `turn_state`, `queueState` ←
  `queue_state`). **Not nullary** — unlike `stallDetected`, this arm must carry the edge and the counter.
  `conversation_id` is dropped at the emit (single active conversation, matching `turnState` /
  `stallDetected`). Doc-comment it in the `turnState` style: the three carried fields and why; that
  `conversation_id` is dropped; that no token, key, raw frame, or conversation content can ride it (one
  bool + two bounded integers is the whole payload); that it is **not** onset-only and **not** deduped, so
  a consumer sees one event per daemon frame; and that it ships dormant with all three exhaustive bridges
  no-oping it until #493 — the `stallDetected`-was-a-no-op-until-#317 precedent.

### 4. Emit — `src/main/daemonConnection.ts`

- Add `case 'api-retry':` to the `switch(inbound.kind)` dispatch, beside `stall` (:594):

  ```ts
  emitDaemonEvent(sink, {
    type: 'apiRetry',
    active: inbound.apiRetry.active,
    current: inbound.apiRetry.current,
    total: inbound.apiRetry.total
  })
  ```

  A **fresh named-field literal**, copied by name from the already-decoded, already-validated payload —
  **never a spread** of `inbound.apiRetry` (the `assistant-delta` / `session-transition` idiom). This is the
  anti-smuggling net: if the decoder later grows a field, it cannot ride across IPC without an explicit
  edit here. `conversation_id` is **dropped** (never referenced).

  **No dedup, no coalescing, no timer, no last-value memo.** The dispatch is stateless per frame, which
  gives the "each frame emits its own event" requirement for free — the correctness risk is *adding* state,
  not omitting it. Two climbing rising edges emit twice; a falling edge emits with `active: false`.

- **Not compile-forced.** This inner switch has no `assertNever` default (the `stall` arm states it at
  :598), so a missing or wrong emit compiles silently and drops the decoded kind. The round-trip test
  (§Testing strategy) is the only guard on this leg and is **not optional**.

### 5-7. Exhaustive bridge no-ops (compile-forced)

Each of `daemonEventBridge.ts`, `timelineBridge.ts`, `modalBridge.ts` switches exhaustively over
`DaemonEvent` with an `assertNever` default; the new arm is a compile error in all three until each gets a
case. Add `case 'apiRetry': return null` in each file's existing house style:

- `daemonEventBridge.ts` — a per-arm explicit block with a one-line "why" comment (clone the
  `stallDetected` block at :128, retargeted: the render slice **#493**, not yet built, surfaces the retry
  indicator; the session store holds no retry state).
- `timelineBridge.ts` — join the **no-op fall-through cluster** (:92-136) and name the arm in the trailing
  comment. **Do not copy `case 'stallDetected'` at :86** — that arm is *owned* since #317 and returns a
  `ThreadEvent`; whether `apiRetry` eventually becomes an owned timeline arm is #493's call, not this
  slice's.
- `modalBridge.ts` — join the fall-through cluster (:85-95) and name the arm in the trailing comment.

No behavior anywhere; the first consumer is #493.

### Note on the sibling `compacting` slice (#489)

#489 needs this same seam for the daemon's `compacting` frame (same pyrycode #1074 shipment;
`conversation_id` + `active`, no counter). **Do not implement it here** — this ticket is `api_retry` only.
Nor should this slice build a generic "status frame" abstraction to anticipate it: with one instance in
hand that is speculative generality, and the seam is already clone-friendly (a per-frame parser + a
per-frame `DaemonEvent` arm, which is exactly how `stall`, `turn_state` and `session_transition` coexist).
The shape prescribed above does not obstruct a second status arm; that is the whole requirement.

## State + concurrency model

None introduced. This is a pure decode + emit leg: no store slice, no async task, no subscription, no
timer, no accumulated state. The `apiRetry` event flows through the existing
`parseInboundMessage → daemonConnection dispatch → emitDaemonEvent → IPC → bridges` path already built for
`stall` / `turn_state`.

The "not onset-only, re-fires as the count climbs, no dedup" contract is satisfied **by having no state at
all**: the dispatch is per-frame and stateless, so N frames produce N events with no work. Any edge
tracking, coalescing, or debouncing belongs to the render slice #493 if it wants it — adding it here would
violate the wire contract by swallowing a legitimate count change.

## Error handling

| Layer | Failure | Result |
|---|---|---|
| `parseApiRetryPayload` | payload not an object | throws `WireDecodeError('malformed api_retry payload')` — fail-closed, no partial value. |
| `parseApiRetryPayload` | `conversation_id` absent / non-string | throws `WireDecodeError('missing required field: conversation_id')` via `requireString`. |
| `parseApiRetryPayload` | `active` absent / non-boolean (incl. `0`, `'true'`, `null`) | throws via `requireBoolean` — TYPE check, so `false` passes and truthiness is never consulted. |
| `parseApiRetryPayload` | `current` / `total` absent / non-number (incl. `'3'`, `null`) | throws via `requireNumber`. `0` is a valid value and passes. |
| `parseInboundMessage` `case 'api_retry'` | any of the above | the decoder throws **before** the diagnostic log call → no record is written for a malformed frame. |
| `parseInboundMessage` | oversized frame | caught upstream by the frame-level `MAX_PLAINTEXT_BYTES` guard (:770), before this arm runs. |
| `daemonConnection` dispatch | `WireDecodeError` from decode | swallowed by the connection's existing catch → the malformed frame is dropped without emitting or throwing (mirror the #315 malformed-drop test). |
| UI surface | — | none this slice; the event ships dormant. Rendering and any error surfacing are #493's. |

## Testing strategy

Test-first (house convention): a failing test per criterion, implementation after. `npm test` (vitest) plus
`npm run typecheck` for the compile-guard arms. Scenarios below — the developer writes the bodies in the
project's idiom; do not pre-write test code from this spec.

**`src/main/transport/inboundMessage.test.ts`** — new `describe` blocks mirroring the `stall` pair at
:1424 / :1450, with an `encodeApiRetry(payload)` helper cloned from `encodeStall` (:139) and an
`API_RETRY` fixture cloned from `STALL` (:176), seeded with the canonical
`{ conversation_id: 'c1', active: true, current: 3, total: 10 }`:

- Recognition: a valid rising-edge envelope decodes to `{ kind: 'api-retry', apiRetry: API_RETRY }`.
- `{ current: 0, total: 0 }` (with `active: true`) decodes successfully to a value carrying both zeroes —
  zero is neither a decode failure nor coerced away.
- `active: false` (falling edge, counter repeated verbatim) decodes successfully with `active === false`.
- Unknown server-added keys (e.g. a spurious `turn_id`) are dropped, keeping exactly the four known fields
  (forward-compat, the `stall` idiom).
- Fail-closed, one case per field: `conversation_id` absent and non-string; `active` absent and
  non-boolean; `current` absent and non-number; `total` absent and non-number — each throws
  `WireDecodeError`.
- Fail-closed on a non-object payload (a string and an array, per the `stall` test at :1462).
- Regression: a well-formed envelope of a *different* unmodeled type still returns `null` (clone :1444 —
  the new case must not widen what decodes).

**Content-free diagnostics** (clone the pair at :2211 and :2230):

- The success path logs exactly one record with `event: 'inbound-decoded'`, `code: 'api_retry'`, a `bytes`
  length and a `hash` — and no `conversation_id` (seed the fixture with the file's `SECRET_CONV` sentinel
  and assert its absence). No new `DiagnosticEvent` field.
- The malformed path (e.g. `current` a string) **logs nothing** — assert the log sink was not called, then
  assert the throw. This is the narrow-before-log guarantee.

**`src/main/daemonConnection.test.ts`** — a new `describe` plus an `apiRetryPlaintext(payload)` helper
cloned from `stallPlaintext` (:246), driven through the round-trip harness at :1358
(`drivers[0].emit({ type: 'message', plaintext })` against a `connected()` fixture). **This leg is not
compile-forced — these tests are the only guard on the emit:**

- Round-trip: a valid rising-edge frame emits **exactly one**
  `{ type: 'apiRetry', active: true, current: 3, total: 10 }`, and `JSON.stringify(events)` does **not**
  contain the `conversation_id` (proves it is dropped at the choke point — the #315 `not.toContain('conv-1')`
  assertion).
- `0/0` round-trips: both zeroes reach the event, neither coerced nor dropped.
- Falling edge round-trips with `active: false`.
- **No dedup:** two consecutive rising-edge frames with a climbing counter (`3/10` then `4/10`) emit **two**
  events in order, both with `active: true`. A third frame identical to the second also emits (no
  suppression of a repeat) — this pins the "no dedup, no coalescing" contract against a future optimiser.
- Fail-closed drop: a malformed frame emits nothing and does not throw (the connection swallows
  `WireDecodeError`).
- Anti-smuggling: feed a frame whose payload carries an extra key (via `as unknown as`) and assert the
  emitted event has exactly the four modeled properties — proving the fresh-literal emit, not a spread.

**Bridge no-op coverage** — one-line additions to the existing inverse-filter tests, no new files:

- `timelineBridge.test.ts` (~:202) and `modalBridge.test.ts` (~:159): append
  `{ type: 'apiRetry', active: true, current: 3, total: 10 }` to each `others` array asserting `.toBeNull()`.
- `daemonEventBridge.test.ts`: a `.toBeNull()` block for the new arm, cloned from the `relayLinkChanged`
  block at :264.

## Open questions

- None blocking. The `api_retry` wire shape is fully specified by pyrycode #1074 / `protocol-mobile.md`
  §`api_retry` and mirrors #315's structure exactly. If a future daemon change adds a field to
  `ApiRetryPayload`, the decoder tolerates-but-drops it (forward-compat) until this slice is widened — the
  correct no-drift posture for a wire type.
- **Carry-forward for #493 (not a question for this slice):** the counter is type-checked but not
  range-checked (house posture, see Security review finding 6), so the render slice must format
  `current`/`total` defensively — in particular it must not compute `current / total` as a progress
  fraction without handling the legitimate `0/0` (→ `NaN`) and must never render a literal `"0/0"` to the
  user, per the wire contract's "count unknown" meaning.

## Security review

**Verdict:** PASS

This slice receives an untrusted daemon `api_retry` frame (hostile-daemon threat), fail-closed decodes it,
and emits an event carrying **one boolean and two numbers** across the main→renderer IPC boundary. That is
a genuine widening versus its template #315, whose `stallDetected` was nullary and let **zero** untrusted
daemon data cross. The categories below are walked against that widening specifically, not against the
`stall` precedent's stronger posture.

**Findings:**

1. **[Trust boundaries]** No finding. One explicit boundary: `parseInboundMessage`'s `case 'api_retry'` →
   `parseApiRetryPayload`, a single named fail-closed decoder — not scattered parsing. It returns a fresh
   four-field literal, never a spread of the incoming `payload`, so a hostile `__proto__` / `constructor`
   key cannot pollute (prototype-pollution-safe by construction, mirroring the vetted `parseStallPayload`).
   The emit is likewise a fresh named-field literal, so exactly three validated primitives cross IPC and a
   later-added decoder field cannot smuggle itself across. Downstream holds a discriminated-union arm
   (`{ type: 'apiRetry'; active: boolean; current: number; total: number }`), so the type system signals
   what is held. The renderer is untrusted relative to main, but this event only flows main→renderer; no
   new renderer→main channel is added.
2. **[Tokens, secrets, credentials]** N/A — no token, secret, credential, or key is generated, stored,
   read, rotated, or compared anywhere in this slice. `conversation_id` is a routing id (not a secret) and
   is dropped at the emit; the thrown `WireDecodeError` messages name the failure category only, never
   interpolating a value.
3. **[File / storage operations]** N/A — no filesystem, disk, cache, or web-storage operation. No decoded
   value is concatenated into a path, and nothing is persisted, so path traversal, TOCTOU, atomic-write,
   and encryption-at-rest questions do not arise.
4. **[Inter-process / Electron attack surface]** No finding. No new `BrowserWindow`, `webPreferences`,
   `contextBridge` API, `ipcMain.handle`, or `ipcMain.on` channel — the event rides the existing
   `emitDaemonEvent` → IPC path. The three values are validated **before** they cross (typed at the
   decoder, re-copied by name at the emit), which is the direction that matters: main validates, then
   hands the renderer an already-narrowed value. `boolean` and `number` are structured-clone primitives, so
   there is no deserialization surface on the renderer side. Process placement is preserved per CLAUDE.md —
   decode, socket, and Noise stay in main; the renderer receives only the typed event.
5. **[Cryptographic primitives]** N/A — no RNG, key, nonce, Noise, or comparison-against-a-secret work.
   The slice reuses exactly one vetted primitive, the content-free `hashPlaintext` diagnostic helper (#130),
   unchanged.
6. **[Network & I/O — the one real finding, and why it is not a MUST FIX]** A hostile daemon can send
   out-of-band integers that `requireNumber` accepts by design: negatives, non-integers (`3.7`), and —
   contrary to `requireNumber`'s docstring rationale at :208-210 (*"JSON.parse never yields NaN/Infinity"*)
   — **`Infinity`**, because `JSON.parse('{"a":1e999}').a === Infinity` (verified empirically 2026-07-26;
   only the bare `NaN` literal is rejected, as invalid JSON). So the docstring is half-right: `NaN` is
   impossible, `Infinity` is reachable.

   **Classification: not exploitable at this layer; no spec change.** A JSON number is a fixed-width
   double — there is no length-driven allocation, no unbounded buffer, and no injection vector, so the
   memory-exhaustion and injection shapes this category exists to catch do not apply. The oversized-*frame*
   vector is already capped upstream by `MAX_PLAINTEXT_BYTES` (:770) before the decoder runs, and the relay
   socket keeps its existing `maxPayload` cap; no new socket, URL, TLS setting, timeout, or reconnect path
   is introduced. The worst reachable outcome is a garbled status string in a UI that does not exist yet.

   Adding a range check here would be the wrong fix on three counts: there is **no house precedent** for
   range-validating a wire integer (`seq` / `total` / `used_tokens` / `window_tokens` / `queued_msg_id` are
   all bare `requireNumber` since #116); the daemon contract declares no bound to enforce, so any bound
   would be invented client-side and would silently drop *valid* future frames — a drift risk that CLAUDE.md
   and ADR 0002 rank above cosmetic robustness; and it is precisely the unobserved-failure-mode defense the
   pipeline's evidence-based-fix rule tells us to defer. Routed instead as a **named carry-forward to #493**
   (recorded under Open questions): the render slice must format the counter defensively and must not divide
   by `total` without handling the legitimate `0/0`. Code-review should read this finding rather than
   re-litigating the missing range check.
7. **[Error messages, logs, telemetry]** No finding. The diagnostic reuses the existing content-free field
   set (`event` / `code: 'api_retry'` / `bytes` / `hash`) with no new `DiagnosticEvent` field, so #131's
   renderer pin is untouched; no decoded field — least of all `conversation_id` — is logged. The arm narrows
   **before** logging, so a malformed frame throws first and leaves no record (asserted by a dedicated test,
   cloned from :2230). Thrown `WireDecodeError` messages carry the failure category only, so a crash or
   telemetry reporter capturing the error object leaks no daemon content. Nothing is piped to the renderer
   console.
8. **[Concurrency]** No finding, and the design is deliberately stateless here. No async task, timer,
   subscription, listener, or shared mutable state is introduced; decode + emit is synchronous within the
   existing inbound dispatch, so there is no check-then-act race across an `await`, nothing to cancel on
   teardown, and no shutdown-safety question. Note the security-relevant inversion versus a typical
   "add debouncing" instinct: the wire contract's no-dedup requirement is met by holding **no** state, so
   the risk to guard against is a developer *adding* an edge-tracking memo — which would both violate the
   contract (swallowing a legitimate count change) and introduce the only mutable state in the leg. The
   spec forbids it explicitly and a round-trip test pins it.
9. **[Threat model alignment]** Addressed. **Hostile daemon response** is the applicable threat: malformed
   or mistyped fields → `WireDecodeError` → swallowed by the connection → frame dropped, no emit, no crash;
   oversized frames capped upstream; out-of-range integers handled per finding 6. **Malicious / compromised
   relay:** it is content-blind and cannot forge frames inside the Noise session; it can flood, but each
   `api_retry` frame decodes to a fixed-size emit with **no accumulated state** (no growing list, no timer,
   no map keyed by anything attacker-controlled), so a flood costs CPU proportional to frames delivered and
   nothing more — rate/framing posture is inherited from the relay connection, not this slice. **Renderer
   compromise reaching the transport:** unchanged — this slice adds no renderer→main capability, and a
   compromised renderer gains one bool and two numbers it could already infer from the retry indicator.
   **Token theft from disk:** N/A, nothing persisted. OUT OF SCOPE and named: all rendering, formatting, and
   any client-side state derived from this event belong to the render slice **#493**; the sibling
   `compacting` frame belongs to **#489**.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-26
