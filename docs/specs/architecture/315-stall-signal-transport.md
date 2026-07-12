# Spec: Stall signal transport — decode the daemon `stall` frame into a `stallDetected` event (#315)

**Size:** S · **Security-sensitive:** yes · Split from #147 · Peer of `turn_state` transport (#214)

## Context

The pyry daemon detects a stalled turn (claude gone quiet mid-turn, or the screen-parser
degrading) and emits a `stall` frame on the v2 interactive stream (pyrycode #638 wire vocab,
#639 fan-out — both merged to daemon `main`). It is an internal-only liveness signal with no
ACP equivalent, fanned out **only to `interactive`-capable clients**. Desktop already advertises
`interactive` (#179, done), so the frame reaches us today — but the transport currently drops it
as an unmodeled envelope type.

This slice is the **decode half only**: recognise the frame, fail-closed decode it, and emit a
typed `stallDetected` `DaemonEvent` that ships **dormant**. The render half (the on-thread
indicator, plus the client-side self-clear on next turn activity) is the companion slice **#317**
and is the first real consumer.

Wire facts — mirror the daemon field-for-field, do not drift (CLAUDE.md / ADR 0002):

- **Type string:** `stall`.
- **`StallPayload` carries `conversation_id` only** — no `turn_id` (not turn-scoped), no
  clearing/recovery field.
- **Onset-only.** The daemon emits one `stall` on the rising edge and does NOT repeat it while
  the stall persists; there is NO "stall cleared" frame. Self-clearing is client-side and belongs
  to the render slice #317, not here.

This is the exact peer of the `turn_state` transport (#214) and follows that slice end-to-end:
a new wire type, a new inbound arm, a fail-closed decoder, a new `DaemonEvent` arm, and the
exhaustive-bridge updates.

## Files to read first

Codegraph is not initialized in this repo (`mcp__codegraph__*` errors here) — this list was built
from direct Read/grep. The developer should Read these before editing; every edit mirrors an
existing `turn_state` (#214) / `session_transition` (#254) counterpart.

| Path (with lines) | What to extract |
|---|---|
| `src/shared/wire/types.ts:40-77` | `EnvelopeType` string union — add `'stall'` beside `'turn_state'` (line 56). |
| `src/shared/wire/types.ts:243-256` | `WireTurnState` + `TurnStatePayload` — the doc-comment + shape template for `StallPayload` (minus the enum field). |
| `src/main/transport/inboundMessage.ts:176-187` | `isRecord` + `requireString` helpers the decoder reuses (no new helper needed). |
| `src/main/transport/inboundMessage.ts:347-366` | `parseTurnStatePayload` — the exact template for `parseStallPayload`; drop the `state` enum check (stall has only `conversation_id`). |
| `src/main/transport/inboundMessage.ts:150-158` | `InboundDaemonMessage` union — add `{ kind: 'stall'; stall: StallPayload }` beside `turn-state`. |
| `src/main/transport/inboundMessage.ts:659-770` | `parseInboundMessage`: the frame-level `MAX_PLAINTEXT_BYTES` oversize guard (664-667) and the `case 'turn_state'` narrow-before-log block (759-770) to clone as `case 'stall'`. |
| `src/main/diagnosticLog.ts:39-63` | `DiagnosticEvent` — `code?: string` is a free field (no type change); confirms the content-free field set (`event`, `code`, `bytes`, `hash`). |
| `src/shared/ipc/events.ts:63-154` | `DaemonEvent` union — add `{ type: 'stallDetected' }` near `turnState` (line 90); mirror the "conversation_id dropped at emit / no token, key, raw frame" comment discipline. |
| `src/main/daemonConnection.ts:366-608` | `switch(inbound.kind)` dispatch; `case 'turn-state'` (449-454) is the emit template. **No `assertNever` default** (switch ends line 607 → silent `return`), so the `case 'stall'` emit is guarded by the round-trip *test*, not the compiler. |
| `src/renderer/src/store/daemonEventBridge.ts:58-105` | no-op case cluster + `assertNever` (line 104) — add `case 'stallDetected'`. |
| `src/renderer/src/store/timelineBridge.ts:36-...` (`translateTimelineEvent`) | no-op fall-through + `assertNever` — add `case 'stallDetected'`. |
| `src/renderer/src/store/modalBridge.ts:41-...` (`translateModalEvent`) | no-op fall-through + `assertNever` — add `case 'stallDetected'`. |
| `src/main/daemonConnection.test.ts:230-260, 1221-1260` | `turnStatePlaintext` helper + the `turn_state stream` round-trip describe — clone as `stallPlaintext` + a `stall stream` describe. |
| `src/renderer/src/store/timelineBridge.test.ts:133-190` / `modalBridge.test.ts:83-145` | the "inverse filter — every other arm returns null" test; add `{ type: 'stallDetected' }` to each `others` array. |
| `src/renderer/src/store/daemonEventBridge.test.ts:~129` | per-arm `.toBeNull()` assertions — add one for `stallDetected`. |

## Scope note (why this ships as one `s` despite touching 7 production files)

The commit-time ≥5-production-file self-check trips here (7 `.ts` files modified), but this is the
documented **DaemonEvent-arm, bridges-atomic** shape where that gate is *structurally
unsatisfiable*, not a hidden-blowup false negative:

- A new `DaemonEvent` arm (`events.ts`) **compile-forces** a no-op case in all three exhaustive
  bridges (`daemonEventBridge`, `timelineBridge`, `modalBridge`) via their `assertNever` guard.
  Those cases CANNOT land in a separate commit — omitting any one fails `npm run build` (the QA
  gate). The three bridges are atomic with the arm.
- The transport decode (`types.ts`, `inboundMessage.ts`, `daemonConnection.ts`) exists *only* to
  feed that arm; a decode-without-arm child is dead code (a decoder whose `kind` is silently
  dropped, with no emit to test).
- Every attempted split either produces a dead-code sub-leaf **or** leaves the arm-bearing child
  still at ≥5 files. No genuine seam exists — today's PO re-refinement (8 AC → 5) reached the same
  conclusion ("NO seam to split; peer of #214").

**Precedent:** #241 (create_conversation transport) adjudicated this exact conflict → shipped as
one `s`. Peer #214 (turn_state) shipped the identical shape as one `s`.

Every §1 red line is clear: **0 new files**, **~200 total LOC** (well under 600), **1 new exported
type** (`StallPayload`), **~4 consumer sites** (1 emit + 3 forced no-op bridges), **5 ACs**, **~2
reject branches** in the decoder. This is a mechanical mirror of #214 with an exact template — the
developer's turn budget is comfortable.

## Design

Six touch-points, mirroring `turn_state` (#214) end-to-end. No new files; all edits are additive
to existing modules.

### 1. Wire type — `src/shared/wire/types.ts`

- Add `'stall'` to the `EnvelopeType` union (beside `'turn_state'`).
- Add the payload interface (contract, not implementation):

  ```ts
  export interface StallPayload {
    conversation_id: string
  }
  ```

  Doc-comment it like `TurnStatePayload`: mirrors the daemon's `StallPayload` field-for-field
  (pyrycode #638); onset-only liveness signal; carries `conversation_id` only — no `turn_id`
  (not turn-scoped) and no clear/recovery field (the client self-clears in the render slice #317).

### 2. Inbound decode — `src/main/transport/inboundMessage.ts`

- Import `StallPayload`.
- Add the inbound arm to `InboundDaemonMessage`: `| { kind: 'stall'; stall: StallPayload }`.
- Add the **fail-closed** decoder (mirror `parseTurnStatePayload`, minus the enum):

  ```ts
  function parseStallPayload(payload: unknown): StallPayload
  ```

  Behavior: `isRecord` guard (throws `WireDecodeError('malformed stall payload')` on non-object)
  then `requireString(payload, 'conversation_id')` (throws `WireDecodeError('missing required
  field: conversation_id')` on missing / non-string). Returns only the one known field; unknown
  server-added keys tolerated (forward-compat) but not copied through. The error message names the
  failure **category only** — never interpolate `conversation_id` (uniform no-echo discipline).
- Add `case 'stall':` to the `parseInboundMessage` type-switch, cloning the `turn_state` block:
  **narrow before logging** (`parseStallPayload` first — a malformed frame throws before any
  record is written), then `diagnosticLog?.event({ event: 'inbound-decoded', code: 'stall', bytes:
  plaintext.length, hash: hashPlaintext(plaintext) })`, then `return { kind: 'stall', stall }`.

**Oversize (AC2):** no per-field length check is added — the frame-level `plaintext.length >
MAX_PLAINTEXT_BYTES` guard at the top of `parseInboundMessage` (line 664-667) already fails an
oversized frame closed, exactly as `turn_state` relies on it. Mirror, do not add.

### 3. Typed event — `src/shared/ipc/events.ts`

- Add the arm to `DaemonEvent`:

  ```ts
  | { type: 'stallDetected' }
  ```

  A **nullary** arm — `conversation_id` is dropped at the emit (single active conversation,
  matching `turnState`), and `StallPayload` has no other field, so the event carries no payload at
  all. Doc-comment it like `turnState`: consumed by the render slice #317 (not yet built), so all
  three exhaustive bridges no-op it for now; carries no token, key, raw frame, or conversation
  content (AC3-by-construction — the wire frame carries none).

### 4. Emit — `src/main/daemonConnection.ts`

- Add `case 'stall':` to the `switch(inbound.kind)` dispatch (beside `turn-state`):
  `emitDaemonEvent(sink, { type: 'stallDetected' })` then `return`. `conversation_id` is
  **dropped** (never referenced).
- **Not compile-forced.** This inner switch has no `assertNever` default; a missing case would
  silently drop the decoded `stall` kind with no build error. The round-trip test (§Testing) is
  the guard — mirror how #214's `daemonConnection.test.ts` round-trip guards the `turnState` emit.

### 5-7. Exhaustive bridge no-ops (compile-forced)

Each of `daemonEventBridge.ts`, `timelineBridge.ts`, `modalBridge.ts` switches exhaustively over
`DaemonEvent` with an `assertNever` default. The new arm is a compile error in all three until each
gets a case. Add `case 'stallDetected': return null`, grouping into the existing no-op fall-through
cluster in each. No behavior — the first consumer is #317. This is the
`sessionTransition`-was-a-no-op-until-#259 precedent.

## State + concurrency model

None introduced. This slice is a pure decode + emit leg: no store slice, no async task, no
subscription, no timer. The `stallDetected` event flows through the existing
`parseInboundMessage → daemonConnection dispatch → emitDaemonEvent → IPC → bridges` path already
built for `turn_state`. Onset-only means no de-dup or timer state here; the self-clear lives in
#317.

## Error handling

| Layer | Failure | Result |
|---|---|---|
| `parseStallPayload` | missing / non-string / oversized-frame `conversation_id` | throws `WireDecodeError` (fail-closed, no partial value) — the oversized case caught by the frame-level `MAX_PLAINTEXT_BYTES` guard upstream. |
| `parseInboundMessage` `case 'stall'` | malformed payload | decoder throws **before** the diagnostic log call → no record written for a malformed frame. |
| `daemonConnection` dispatch | `WireDecodeError` from decode | swallowed by the connection's existing catch → the malformed frame is dropped without emitting or throwing (mirror the #214 malformed-drop test). |
| UI surface | — | none this slice; the event ships dormant. Render/error surfacing is #317. |

## Testing strategy

Test-first (house convention), `npm test` (vitest), plus `npm run typecheck` for the compile-guard
arms. Scenarios (developer writes them in the project idiom — do not pre-write test bodies):

**`src/main/transport/inboundMessage.test.ts`** (new `describe` mirroring the `turn_state` block):
- A valid `stall` envelope (`{ conversation_id: 'conv-1' }`) decodes to `{ kind: 'stall', stall: {
  conversation_id: 'conv-1' } }`.
- A malformed `stall` throws `WireDecodeError`: (a) `conversation_id` absent, (b) `conversation_id`
  a non-string (e.g. number), (c) payload not an object.
- A well-formed envelope of a *different* unmodeled type still returns `null` (regression — the new
  case must not widen what decodes).

**`src/main/daemonConnection.test.ts`** (new `describe` + a `stallPlaintext(payload)` helper cloned
from `turnStatePlaintext`):
- **Round-trip:** feeding a valid `stall` frame through the connected fake driver emits **exactly
  one** `{ type: 'stallDetected' }`, and `JSON.stringify(events)` does **not** contain the
  `conversation_id` (proves it is dropped at the choke point — the #214 `not.toContain('conv-1')`
  assertion).
- **Fail-closed drop:** a malformed `stall` frame emits nothing and does not throw (the connection
  swallows `WireDecodeError`).

**Bridge no-op coverage** (one-line additions to existing "inverse filter" tests, not new files):
- `timelineBridge.test.ts` / `modalBridge.test.ts`: add `{ type: 'stallDetected' }` to each
  `others` array asserting `.toBeNull()`.
- `daemonEventBridge.test.ts`: add a `.toBeNull()` assertion for `stallDetected`.

**`src/shared/wire/types.test.ts`** (optional, only if it already asserts payload shapes for
`TurnStatePayload`): a type-level assertion that `StallPayload` has exactly `conversation_id`.

**Diagnostics (AC5):** covered by the decode-path unit test asserting the emitted diagnostic record
carries only `event` / `code: 'stall'` / `bytes` / `hash` — no `conversation_id`, no new field.
Reuse the existing content-free field-set assertion idiom.

## Open questions

- None blocking. The `stall` wire shape is fully specified by pyrycode #638 (`conversation_id` only,
  onset-only, no clear frame) and mirrors #214 exactly. If a future daemon change adds a field to
  `StallPayload`, the decoder fails closed (drops the extra key) until this slice is widened — the
  correct no-drift posture for a wire type.

## Security review

**Verdict:** PASS

This slice receives an untrusted daemon `stall` frame (hostile-daemon threat), fail-closed decodes
it, and emits a **nullary** `stallDetected` event — the strongest posture: the one daemon datum
(`conversation_id`) is dropped main-side, so no untrusted daemon bytes reach the renderer at all.

**Findings:**

- [Trust boundaries] No finding — one explicit boundary: `parseInboundMessage`'s `case 'stall'` →
  `parseStallPayload` (a single named fail-closed decoder). The emit is a fresh nullary literal
  (`{ type: 'stallDetected' }`), so **zero** untrusted daemon data crosses the main→renderer IPC
  boundary — stronger than #214, which carries a validated `state`. `parseStallPayload` returns a
  fresh `{ conversation_id }` literal (never a spread of the incoming `payload`), so a hostile
  `__proto__` / `constructor` key can't pollute — prototype-pollution-safe by construction,
  mirroring the vetted `parseTurnStatePayload`.
- [Tokens, secrets] N/A — no token/secret/credential handling. `conversation_id` is a routing id
  (not a secret) and is dropped at the emit; the decoder's thrown messages name the failure
  category only, never interpolating the value.
- [File / storage] N/A — no filesystem, disk, or cache operation; the decoded value touches no path.
- [Electron attack surface] No finding — no new `BrowserWindow`, `webPreferences`, `contextBridge`
  API, or `ipcMain` channel. The event rides the existing `emitDaemonEvent` → IPC path as a nullary
  literal (no argument to validate, no capability exposed). Transport/decode stay in the main
  process per CLAUDE.md; the renderer receives only the typed nullary event.
- [Cryptographic primitives] N/A — no RNG, keys, nonces, or Noise work; reuses only the vetted
  content-free `hashPlaintext` diagnostic primitive (#130).
- [Network & I/O] No finding — a hostile-daemon oversized `stall` frame fails closed at the
  frame-level `MAX_PLAINTEXT_BYTES` guard (`inboundMessage.ts:664-667`) **before** `parseStallPayload`
  runs; the inbound socket keeps its existing relay `maxPayload` cap. No new socket or config.
- [Error messages, logs, telemetry] No finding — the `case 'stall'` diagnostic is content-free
  (`event`/`code: 'stall'`/`bytes`/`hash`, no `conversation_id`, reusing the existing field set),
  and narrows **before** logging so a malformed frame leaves no record. Thrown `WireDecodeError`
  messages carry the failure category only — a crash/telemetry reporter capturing the error leaks no
  daemon content.
- [Concurrency] N/A — no async task, timer, subscription, or shared mutable state introduced; the
  decode + emit is synchronous within the existing inbound dispatch. Onset-only means no de-dup or
  timer state here.
- [Threat model alignment] Hostile-daemon response is the applicable threat and is addressed:
  malformed/mistyped → `WireDecodeError` (swallowed by the connection → frame dropped, no emit, no
  crash); oversized → capped upstream. A content-blind relay can flood `stall` frames, but each
  decodes to a nullary emit with no accumulated state, and rate/framing posture is inherited from
  the relay connection (not this slice). A compromised renderer gains nothing from a constant
  nullary event. OUT OF SCOPE — the client-side self-clear on next turn activity is deferred to the
  render slice **#317** (named), which owns any resulting state.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-12
