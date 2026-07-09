# Spec #199 — Decode `assistant_delta` + `turn_end` on the transport (structured-stream L1)

**Size:** S · **security-sensitive** · Transport slice (L1) of the Phase-2 structured-streaming
vertical. Blocks #202 (timeline store + bridge) → #203 (render, gates #179). No UI surface (main-process
transport + IPC types only), so there is no Figma / Design source section.

## Files to read first

Read these before writing a line — this slice is a **structural clone of #180** (the snapshot
transport), scaled down (no outbound builder, no renderer command). The whole design is "mirror the
`screen_snapshot` chain for two inbound-only events."

- `docs/knowledge/codebase/180.md` — **read end-to-end first.** The exact precedent chain: wire type →
  `inboundMessage.ts` decode → `InboundDaemonMessage` kind → `daemonConnection.ts` consumer case →
  `DaemonEvent` arm → `daemonEventBridge.ts` `assertNever` case. Also the "8th file" lesson
  (`daemonEventBridge.ts` is a compile-error-forced touchpoint).
- `src/main/transport/inboundMessage.ts:52-107` — `InboundDaemonMessage` union + the `requireString` /
  `requireNumber` fail-closed field-narrowers. Reuse these helpers verbatim; do **not** add new ones
  (no `requireBoolean` needed — neither new payload has a boolean).
- `src/main/transport/inboundMessage.ts:171-195` — `parseScreenSnapshotPayload`: the exact fail-closed,
  category-only-error, forward-compatible (extra keys tolerated, not copied) parse-function shape the
  two new parsers mirror.
- `src/main/transport/inboundMessage.ts:205-304` — `parseInboundMessage`'s `switch (envelope.type)`.
  Add two cases modelled on `case 'screen_snapshot'` (lines 265-278): narrow **before** logging so a
  malformed frame throws first and leaves no record.
- `src/shared/wire/types.ts:40-53` — `EnvelopeType` union (add two members).
- `src/shared/wire/types.ts:109-143` — `RequestSnapshotPayload` / `ScreenSnapshotPayload` doc-comment +
  interface style. Mirror it for the two new payloads (field-for-field with mobile, no `omitempty`).
- `src/shared/ipc/events.ts:29-67` — `DaemonEvent` union + its AC4 "never carries a token/key/raw frame"
  doc-comment. Add two arms; **note the content-carrying difference** (see Design § DaemonEvent arms).
- `src/main/daemonConnection.ts:224-274` — the `case 'message'` handler and its inner
  `switch (inbound.kind)` consumer (the `case 'snapshot'` emit at 257-271 is the template). **This inner
  switch is NOT `assertNever`-guarded** — a new `InboundDaemonMessage` kind with no case silently
  drops. The emit test is the deterministic safety net (see Testing).
- `src/renderer/src/store/daemonEventBridge.ts:27-61` — `translateDaemonEvent`; the `assertNever`
  default makes a new `DaemonEvent` arm a compile error until it gets a `case … return null`.
- `src/main/diagnosticLog.ts:39-43` — `DiagnosticEvent.code?: string` is an **open optional string**.
  New codes `'assistant_delta'` / `'turn_end'` need **no** change here — do **not** touch this file
  (leaving it untouched keeps #131's renderer type-pin intact).
- Test siblings to mirror: `src/main/transport/inboundMessage.test.ts` (fail-closed + content-free
  cases for `screen_snapshot`), `src/main/daemonConnection.test.ts` (the `snapshotReceived` emit-mapping
  test), `src/renderer/src/store/daemonEventBridge.test.ts` (arm → null), `src/shared/wire/types.test.ts`.

## Context

On the v2 interactive path the daemon **replaces** the coarse `message` fan-out (pyrycode #699) with a
structured stream; assistant text arrives only as `assistant_delta`, and a turn closes with `turn_end`.
Desktop withholds the `interactive` capability today (`codec.ts:147`, `helloExchange.ts:34`), so the
daemon sends none of this yet — flipping it on is **#179**. **Do not flip `interactive` here.** Build the
decode path Strangler-Fig alongside the coarse `message` path so that when #179 flips, assistant text is
already decoded rather than dropped at `parseInboundMessage`'s `default → inbound-unmodeled → null`.

This is L1 (transport decode + typed `DaemonEvent` arms). It produces the typed events that #202's
`DaemonEvent → ThreadEvent` bridge feeds into #121's already-shipped `reduceTimeline`
(`src/renderer/src/store/threadTimeline.ts`). #202/#203 are separate, non-security-sensitive slices.

## Design

Five thin, additive touchpoints, each mirroring the `screen_snapshot` sibling. Nothing existing changes
behaviour — the coarse `message` / `message_chunk` path is untouched (Strangler-Fig).

### 1. Wire types — `src/shared/wire/types.ts`

Add two `EnvelopeType` members and two payload interfaces, field-for-field with the daemon
(pyrycode #607, `protocol-mobile.md`), all fields required-present (no `omitempty`):

```ts
export interface AssistantDeltaPayload {
  conversation_id: string
  turn_id: string
  seq: number      // per-turn, non-negative, resets each turn (daemon Seq int, #607)
  text: string     // one incremental slice of assistant reply text
}

export interface TurnEndPayload {
  conversation_id: string
  turn_id: string
  stop_reason: string  // e.g. "end_turn"; opaque enum string, decoded but not interpreted here
}
```

Add `'assistant_delta'` and `'turn_end'` to the `EnvelopeType` union. Mirror the existing doc-comment
style (name the mobile source, note "no `omitempty`").

### 2. Inbound decode — `src/main/transport/inboundMessage.ts`

Two new `InboundDaemonMessage` kinds and two new parse functions, plus two `switch (envelope.type)` cases:

- Union arms: `| { kind: 'assistant-delta'; delta: AssistantDeltaPayload }` and
  `| { kind: 'turn-end'; turnEnd: TurnEndPayload }` (kebab kinds, consistent with `bundle-chunk` /
  `bundle-done` / `daemon-error`).
- `parseAssistantDeltaPayload(payload: unknown): AssistantDeltaPayload` — signature + behaviour:
  `isRecord` guard, then `requireString('conversation_id')` / `requireString('turn_id')` /
  `requireNumber('seq')` / `requireString('text')`; returns exactly the four fields, tolerates extra
  keys, **fails closed** (throws `WireDecodeError`, category-only message, never interpolating a field
  value). Behaviour asserted by the fail-closed + happy-path tests.
- `parseTurnEndPayload(payload: unknown): TurnEndPayload` — same shape over
  `conversation_id` / `turn_id` / `stop_reason` (three required strings).
- `switch` cases `case 'assistant_delta'` / `case 'turn_end'`: narrow **before** logging (mirror
  `case 'screen_snapshot'`), emit a content-free diagnostic `{ event: 'inbound-decoded', code:
  'assistant_delta' | 'turn_end', bytes: plaintext.length, hash: hashPlaintext(plaintext) }` — **never**
  the delta `text`, `turn_id`, or `seq` — then return the narrowed kind. `code` is a free string, so no
  `DiagnosticEvent` type change.

The existing `MAX_PLAINTEXT_BYTES` guard at the top of `parseInboundMessage` already fails oversized
frames closed for these types too — do not add a second guard.

### 3. Consumer + `DaemonEvent` arms — `src/main/daemonConnection.ts` + `src/shared/ipc/events.ts`

Two new `DaemonEvent` arms (`events.ts`), **camelCase field names per AC3**:

```ts
| { type: 'assistantDelta'; turnId: string; seq: number; text: string }
| { type: 'turnEnd'; turnId: string; stopReason: string }
```

Two new `case`s in `daemonConnection.ts`'s `switch (inbound.kind)`:

- `case 'assistant-delta'`: emit `{ type: 'assistantDelta', turnId: inbound.delta.turn_id, seq:
  inbound.delta.seq, text: inbound.delta.text }`.
- `case 'turn-end'`: emit `{ type: 'turnEnd', turnId: inbound.turnEnd.turn_id, stopReason:
  inbound.turnEnd.stop_reason }`.

Both **drop `conversation_id`** (single active conversation; #202's bridge scopes identity). The
snake→camel rename happens here (wire is snake, IPC is camel).

**Deliberate divergence from #180 — carry the content.** #180's `snapshotReceived` dropped `text` (the
sensitive rendered screen) via a dedicated minimal shape. Here the assistant `text` **is** the render
payload and crosses IPC on purpose. Do **not** cargo-cult #180's text-dropping; the boundary this slice
defends is the fail-closed **decode** (§2), not the text crossing the internal channel. No key, token,
or raw frame rides these arms — only `turnId` / `seq` / `text` / `stopReason`.

Also do **not** cargo-cult #180's snake_case `used_tokens` / `window_tokens` on the arm — the AC
specifies camelCase (`turnId`, `stopReason`), and these arms are clean of the #191 carry-over.

### 4. Renderer bridge — `src/renderer/src/store/daemonEventBridge.ts`

Add `case 'assistantDelta':` and `case 'turnEnd':` to `translateDaemonEvent`, both `return null` with a
comment: *the renderer timeline bridge (#202), not the session store, consumes these.* This is required
purely because the `assertNever` default makes a new arm a compile error — mirror the `snapshotReceived`
case (lines 53-57). The other two `DaemonEvent` consumers (`toDownloadAction`, `toRunConfigSnapshot`)
use `default: null` and need **no** change.

### Data flow

```
relay socket (untrusted)
  → Noise decrypt → plaintext bytes
  → parseInboundMessage()            [transport boundary: fail-closed decode + content-free log]
      envelope.type 'assistant_delta' → parseAssistantDeltaPayload → { kind:'assistant-delta', delta }
      envelope.type 'turn_end'        → parseTurnEndPayload        → { kind:'turn-end', turnEnd }
  → daemonConnection switch(inbound.kind)  [consumer: snake→camel, drop conversation_id]
      → emitDaemonEvent { type:'assistantDelta', turnId, seq, text }
      → emitDaemonEvent { type:'turnEnd', turnId, stopReason }
  → IPC (DAEMON_EVENT_CHANNEL) → renderer
  → translateDaemonEvent → null  (session store dispatches nothing; #202 consumes them)
```

## State + concurrency model

No new state, no new store, no new async task, no new IPC channel. Decode is a pure synchronous function
(`parseInboundMessage`); events ride the existing one-way `DAEMON_EVENT_CHANNEL` via `emitDaemonEvent`.
The events are fire-and-forget on the existing driver read loop — there is no correlation map, no pending
request, no teardown to add. `seq` ordering / turn coalescing is #202/#121's concern (`reduceTimeline`
tail-checks on `turnId`; `seq` is carried, not consulted here). Cancellation, socket lifecycle, and
reconnect are unchanged and owned upstream (`relaySupervisor` / `noiseRelayDriver`).

## Error handling

- **Malformed / mistyped / missing field** → `parse*Payload` throws `WireDecodeError` (never a partial
  value). `daemonConnection`'s existing `try/catch` around `parseInboundMessage` (lines 228-235) drops
  the frame — no event, no throw, no log (the caught error is dropped so it can't echo plaintext). No new
  catch needed.
- **Oversized frame** → the existing `MAX_PLAINTEXT_BYTES` guard throws before decode.
- **Well-formed but unmodeled** (e.g. `turn_state` / `tool_use` before #204-#206) → still falls to
  `default → inbound-unmodeled → null`, harmless drop. Only `assistant_delta` / `turn_end` graduate here.
- **Category-only error messages** — no parser interpolates a field value (`text` / `turn_id` /
  `stop_reason` could echo conversation content). Mirror `parseScreenSnapshotPayload`'s messages.
- **Content-free diagnostics** — the two new log calls carry only `code` + `bytes` + `hash`, never the
  delta text. The throw path stays unlogged (narrow before log).

## Testing strategy

Bullet scenarios (developer writes the code in the project's vitest idiom, mirroring the `screen_snapshot`
cases). `npm test` + `npm run build` must stay green.

**`inboundMessage.test.ts`** (the bulk — mirror the snapshot cases):
- Well-formed `assistant_delta` frame → `{ kind: 'assistant-delta', delta: { conversation_id, turn_id,
  seq, text } }`; all four fields present verbatim.
- Well-formed `turn_end` frame → `{ kind: 'turn-end', turnEnd: { conversation_id, turn_id, stop_reason } }`.
- Fail-closed: each required field missing / wrong type (e.g. `seq` a string, `text` absent,
  `stop_reason` a number) → **throws `WireDecodeError`**, no partial value (one case per field is enough).
- `seq: 0` decodes as the value `0` (not treated as absent) — the `requireNumber` type-not-truthiness check.
- Extra server-added key is tolerated (decodes fine) but not copied onto the result.
- Content-free logging: with an injected `DiagnosticLog`, a decoded `assistant_delta` logs
  `code:'assistant_delta'`, `bytes`, `hash` and the log record contains **none** of the delta `text` /
  `turn_id` / `seq`. A malformed frame throws and logs **nothing**.

**`daemonConnection.test.ts`** (the safety net for the un-guarded inner switch):
- An `assistant_delta` frame delivered through the driver emits exactly one `{ type:'assistantDelta',
  turnId, seq, text }`; `conversation_id` is **absent** from the emitted event.
- A `turn_end` frame emits `{ type:'turnEnd', turnId, stopReason }`; `conversation_id` absent.
- Coarse `message` / `message_chunk` still emit `messageReceived` / `messagesReceived` (no regression).

**`daemonEventBridge.test.ts`**: `translateDaemonEvent` returns `null` for both new arms (mirror the
`snapshotReceived` case). This plus the `assertNever` guard is the compile-time + runtime proof the arms
are handled.

**`types.test.ts`**: the two new payload interfaces / `EnvelopeType` members compile (type-level, mirror
existing).

Type coverage: `npm run typecheck` — the `assertNever` in `daemonEventBridge` is the exhaustiveness proof.

## Scope self-check (5 production files — read this before flagging oversize)

This spec prescribes changes to **exactly 5 production `.ts` files, 0 new files** (verified by reading
every touchpoint, no hidden cascade):

1. `src/shared/wire/types.ts` — 2 `EnvelopeType` members + 2 payload interfaces
2. `src/main/transport/inboundMessage.ts` — 2 parse fns + 2 kinds + 2 switch cases
3. `src/main/daemonConnection.ts` — 2 consumer cases
4. `src/shared/ipc/events.ts` — 2 `DaemonEvent` arms
5. `src/renderer/src/store/daemonEventBridge.ts` — 2 `assertNever` cases (return null)

This sits on the §4 file-count boundary (≥5), so the decision is documented rather than assumed:

- **5 is the architectural floor** for adding *any* inbound `DaemonEvent` in this codebase: wire type →
  decode → connection consumer → event union → renderer bridge. There is no 4-file version — each
  touchpoint is load-bearing (drop `events.ts` or `daemonEventBridge.ts` and it doesn't compile; drop
  `inboundMessage.ts` and it never decodes).
- **Direct clean precedent: #180** ran this identical chain at **8** production files (it also added an
  outbound builder + a renderer command guard + IPC wiring) and shipped as one **S** ticket with a
  code-review **PASS, no findings** (`docs/knowledge/codebase/180.md`). #199 is strictly smaller —
  inbound-only, no builder, no command, no `index.ts` wiring.
- **Splitting is strictly worse and doesn't even reduce the count.** The only split axis is per-event
  (`assistant_delta` vs `turn_end`). Each half would still touch all 5 files (still trips ≥5) *and*
  double-touch `types.ts` / `inboundMessage.ts` / `daemonConnection.ts` / `events.ts` /
  `daemonEventBridge.ts` → a guaranteed merge conflict (the exact anti-pattern #180's notes warn
  against). Net: 2 tickets, more files each, plus a conflict. No.
- **Every line-based red line passes comfortably** (the accurate turn-budget proxy): 0 new files,
  ~100 production + ~200 test ≈ **~300 total LOC** (well under 600), **2 new exported types**
  (`AssistantDeltaPayload`, `TurnEndPayload`; the arms/kinds are union members, not exports),
  **1 exhaustive consumer** call site (`daemonEventBridge`), **7** decode throw-sites (under 10), **5**
  ACs. Projected turn cost tracks #180 (~15-25 turns), well inside budget.

Conclusion: genuine, verified, precedented S. Not an undercount — proceed.

## Open questions

- **Inner-switch exhaustiveness (deferred, not adopted).** `daemonConnection.ts`'s `switch
  (inbound.kind)` has no `default: assertNever(inbound)`, so a missing consumer case silently drops
  rather than failing to compile. Adding one would be a nice deterministic guard, but it's an adjacent
  refactor this ticket doesn't need (`#180` added `case 'snapshot'` to the same un-guarded switch and
  relied on the emit test). The `daemonConnection.test.ts` emit test is the deterministic safety net;
  **do not** expand scope to guard the switch here. Flagged for a future cleanup if the drop-risk is ever
  observed.
- **`stop_reason` value set.** Decoded as an opaque string and carried through unchanged; #202/#203 decide
  whether any specific value (`end_turn`, etc.) drives render behaviour. No enum narrowing here.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST-FIX. The untrusted→trusted boundary (relay socket → decrypted plaintext →
  `parseInboundMessage`) gains two explicit, single-function fail-closed decoders
  (`parseAssistantDeltaPayload` / `parseTurnEndPayload`), each throwing `WireDecodeError` on any
  structural/semantic mismatch, never a partial value — same named boundary that already owns
  `message` / `screen_snapshot`. Positive control against IPC-side unknown-key / prototype leakage: the
  consumer emits a **fresh object literal** with explicitly named fields (`{ type, turnId, seq, text }`),
  never a spread of the raw decoded payload, so only the four/three known fields cross IPC.
- **[Tokens / secrets]** N/A by design. No token/key/credential is added, decoded, or carried. The two
  `DaemonEvent` arms carry only `turnId` / `seq` / `text` / `stopReason` — `assistant_delta.text` is
  assistant reply content (the render payload), not a secret. No field on either arm can hold a
  key/token/raw frame (AC5), matching `events.ts`'s existing AC4-by-construction invariant.
- **[File / storage]** N/A — no filesystem or storage operation in this slice.
- **[Electron attack surface]** No finding. No new `BrowserWindow`, `webPreferences`, IPC channel,
  `ipcMain` handler, custom protocol, or preload method — the arms ride the existing one-way
  `DAEMON_EVENT_CHANNEL` (`emitDaemonEvent`) the preload already forwards. Process placement preserved:
  decode lives in `src/main/transport/inboundMessage.ts` (main-only, imports `Buffer`, never re-exported
  to a renderer barrel); no key, socket, or raw frame moves toward the renderer. The `text` flowing
  main→renderer grants the renderer no new reach toward transport/keys.
- **[Cryptographic primitives]** N/A — no RNG, key, nonce, or handshake code. `hashPlaintext` (BLAKE2s via
  `@noble/hashes`, note #101) is reused verbatim for content-free logging; no new or hand-rolled crypto.
- **[Network & I/O]** No finding. The existing `MAX_PLAINTEXT_BYTES` (65519) guard at the top of
  `parseInboundMessage` fails oversized `assistant_delta` / `turn_end` frames closed before decode — no
  new size cap needed. Payloads are flat (no `message_chunk`-style array-of-arrays), so no decode
  amplification. A hostile `seq` (huge JSON number) is inert here (carried-not-consulted; #121's
  `reduceTimeline` tail-checks on `turnId`). No new socket / timeout / reconnect surface.
- **[Error messages, logs, telemetry]** No finding — this is the category the ticket is
  security-sensitive *for*, addressed head-on. The two new diagnostic calls are **content-free**
  (`code` + `bytes` + one-way `hash` only), emitted **after** the frame fully narrows so the throw path
  leaves no record; parser error messages name the failure **category only** (no `text` / `turn_id` /
  `stop_reason` interpolation, which could echo conversation content); the `WireDecodeError` caught in
  `daemonConnection` is dropped, never logged or forwarded.
- **[Concurrency]** No finding — no new async task, timer, listener, or socket; decode is synchronous;
  events ride the existing driver read loop. No shared-state check-then-act, nothing to cancel or leak.
- **[Threat model alignment]** Addressed for the boundary this slice owns. *Malicious/compromised relay*
  (on-path, content-blind): a flood of malformed frames all throw and drop — no plaintext leak, no log
  record, no hang (synchronous, frame-bounded). *Hostile daemon response* (malformed/oversized inside the
  session): every field parsed defensively, fail-closed — this slice's raison d'être. *Renderer
  compromise reaching transport*: unchanged — no new renderer capability.
- **[Untrusted `text` at render — OUT OF SCOPE → #203]** `assistant_delta.text` is untrusted daemon
  content that #199 correctly carries verbatim (it does not render). The render-time safety — display as
  **text**, never HTML (React escapes by default; no `dangerouslySetInnerHTML`) — belongs to **#203**,
  the render slice. Named here so #203's architect / code-review treats the streamed `text` as untrusted
  at the DOM boundary.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-10
