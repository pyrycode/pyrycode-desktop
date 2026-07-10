# Spec #214 — Decode the daemon `turn_state` stream into the timeline coarse `phase`

**Size:** S · **security-sensitive** · Transport slice of the Phase-2 structured-streaming vertical
(ADR 0008). Split from #204. Wires the missing wire → transport → bridge chain that feeds the coarse
`phase` scalar which `reduceTimeline` (#121) / `selectPhase` / `timelineStore` (#202) already reduce and
expose. **No render** — the "thinking…" indicator that reads `phase` is the sibling slice, blocked on
this one. **No `interactive` flip.** No UI surface (main-process transport + IPC types + one renderer
bridge case), so there is no Figma / Design source section.

This is a near-exact **structural clone of #199** (the `assistant_delta` / `turn_end` transport slice),
scaled to one event, plus **one new twist**: the `state` field is a closed wire enum, so its fail-closed
decode uses the `role` single-enum-check idiom, not a `requireString`.

## Files to read first

Read these before writing a line. The whole design is "mirror the `assistant_delta` chain for one more
inbound event, and clone the `role` enum check for its one enum field."

- `docs/knowledge/codebase/199.md` — **read end-to-end first.** The exact precedent chain: wire type →
  `inboundMessage.ts` decode → `InboundDaemonMessage` kind → `daemonConnection.ts` consumer case →
  `DaemonEvent` arm → renderer bridge case(s). #214 adds one more link vs #199: a second bridge
  (`timelineBridge`) now exists and is also `assertNever`-forced (see Design § 6).
- `docs/specs/architecture/199-structured-stream-transport-decode.md` — the sibling spec; the "Scope
  self-check" and "Security review" sections there map onto this one almost verbatim.
- `src/shared/wire/types.ts:72` — `WireRole` (`'user' | 'assistant'`): the **enum-on-the-wire precedent**.
  `WireTurnState` is declared the same way (see Design § 1).
- `src/shared/wire/types.ts:96-101` — `MessagePayload` (`role: WireRole`): the payload-field-references-a-
  wire-enum shape `TurnStatePayload.state` mirrors.
- `src/shared/wire/types.ts:149-176` — `AssistantDeltaPayload` / `TurnEndPayload`: the doc-comment +
  interface style (name the mobile source, "no `omitempty`") to mirror for `TurnStatePayload`.
- `src/shared/wire/types.ts:40-58` — `EnvelopeType` union (add `'turn_state'`).
- `src/main/transport/inboundMessage.ts:141-162` — **`parseMessagePayload` — THE key reference.** Its
  single `role` enum check (`if (role !== 'user' && role !== 'assistant') throw`) is the exact idiom the
  `state` check clones: covers non-string and unknown-string alike, narrows without a cast, category-only
  error message, never interpolates the value.
- `src/main/transport/inboundMessage.ts:229-261` — `parseAssistantDeltaPayload` / `parseTurnEndPayload`:
  the parse-function shape (`isRecord` guard → field narrowers → return only known fields, extra keys
  tolerated) to mirror for `parseTurnStatePayload`.
- `src/main/transport/inboundMessage.ts:78-88` — `InboundDaemonMessage` union (add one kind).
- `src/main/transport/inboundMessage.ts:387-412` — the `case 'assistant_delta'` / `case 'turn_end'`
  switch arms: narrow **before** logging, content-free `inbound-decoded` log. The template for `case
  'turn_state'`.
- `src/main/daemonConnection.ts:283-302` — the `case 'assistant-delta'` / `case 'turn-end'` emit arms:
  fresh literal, snake→camel, **drop `conversation_id`**. The template for `case 'turn-state'`.
- `src/shared/ipc/events.ts:55-84` — `DaemonEvent` union; the `assistantDelta` / `turnEnd` arms at 77-78.
  Add one arm (see Design § 4).
- `src/renderer/src/store/daemonEventBridge.ts:27-69` — `translateDaemonEvent`; its `assertNever` default
  forces a `case 'turnState': return null` (mirror the `assistantDelta` / `turnEnd` case at 58-62 — the
  **session store does not consume** `turnState`).
- `src/renderer/src/store/timelineBridge.ts:35-58` — `translateTimelineEvent`; its `assertNever` default
  forces the **real mapping** `case 'turnState'` (mirror the owned arms at 37-40). This is the arm that
  actually drives `phase`.
- `src/renderer/src/store/threadTimeline.ts:11,42-49,140-142` — the **already-shipped downstream**:
  `TurnPhase` (line 11), the `ThreadEvent` `turnState` arm (line 48, `state: TurnPhase`), and
  `reduceTimeline`'s no-churn `turnState` arm (140-142). This slice **wires up to** these; it does not
  build them. Confirms the timeline-bridge mapping is a rename (`WireTurnState` ≡ `TurnPhase`
  structurally), not a re-validation.
- `src/renderer/src/store/timelineStore.ts:33-42` — `createTimelineStore` / `timelineStore` singleton +
  `dispatch`: the end-to-end test target (drive event → assert `phase`).
- `src/main/diagnosticLog.ts:39-43` — `DiagnosticEvent.code?: string` is an **open optional string**.
  `code: 'turn_state'` needs **no** change here — do **not** touch this file (keeps #131's renderer
  type-pin intact).
- Test siblings to mirror: `src/main/transport/inboundMessage.test.ts:324-406`
  (assistant_delta / turn_end recognition + fail-closed), `src/main/daemonConnection.test.ts` (emit
  mapping), `src/renderer/src/store/daemonEventBridge.test.ts` (arm → null),
  `src/renderer/src/store/timelineBridge.test.ts:29-155` (owned-arm mapping + `subscribeTimeline` drives
  a real store).

## Context

`turn_state` is the coarse lifecycle scalar of desktop's Phase-2 structured stream (ADR 0008) — a scalar
`phase` (`thinking | responding | idle`), **not** a timeline item. The daemon emits `turn_state{thinking}`
on the rising edge of a turn, before any `assistant_delta` (pyrycode #632). Today a `turn_state` envelope
is unmodeled and falls through `parseInboundMessage`'s `default → inbound-unmodeled → null`.

The downstream is already built: `reduceTimeline`'s `turnState` arm updates `phase` with no-churn on an
unchanged value; `selectPhase` and the `timelineStore` singleton exist (#121 / #202). What is missing is
the chain that feeds it. End state: a `turn_state{thinking}` frame drives `timelineStore.phase →
'thinking'`. Desktop withholds the `interactive` capability today (`codec.ts`, `helloExchange.ts`), so the
daemon sends none of this yet — flipping it on is **#179**. **Do not flip `interactive` here.** Build the
decode path Strangler-Fig alongside the coarse `message` path.

## Design

Six thin, additive touchpoints, each mirroring the `assistant_delta` sibling. Nothing existing changes
behaviour — the coarse `message` / `message_chunk` path is untouched.

### 1. Wire type — `src/shared/wire/types.ts`

Add a wire-level enum and a payload interface, field-for-field with the daemon (pyrycode #607 / #794,
`protocol-mobile.md`), both fields required-present (no `omitempty`):

```ts
// Mirrors WireRole: a plain string on the wire, no named enum on the daemon side.
export type WireTurnState = 'thinking' | 'responding' | 'idle'

export interface TurnStatePayload {
  conversation_id: string
  state: WireTurnState
}
```

Add `'turn_state'` to the `EnvelopeType` union. Mirror the existing doc-comment style (name the mobile
source, note "no `omitempty`", note `state` is a plain wire string exactly like `MessagePayload.role`).

**Why a new `WireTurnState` and not the renderer's `TurnPhase`:** shared code cannot import a renderer
type. `WireTurnState` is the wire-side declaration (mirroring `WireRole`); the renderer's `TurnPhase`
(`threadTimeline.ts:11`) is the identical union declared renderer-side. They are structurally equal, so
the timeline-bridge mapping (§ 6) assigns one to the other with no cast.

### 2. Inbound decode — `src/main/transport/inboundMessage.ts`

- Add the union arm `| { kind: 'turn-state'; turnState: TurnStatePayload }` to `InboundDaemonMessage`
  (kebab kind, consistent with `assistant-delta` / `turn-end`).
- Add `parseTurnStatePayload(payload: unknown): TurnStatePayload` — `isRecord` guard, then
  `requireString('conversation_id')`, then the **`state` closed-enum check cloned from `parseMessagePayload`'s
  `role` check** (`inboundMessage.ts:157-160`): a single `if (state !== 'thinking' && state !==
  'responding' && state !== 'idle') throw new WireDecodeError('missing required field: state')`, which
  narrows to `WireTurnState` without a cast, covers non-string and unknown-string alike, and names the
  failure **category only** (never interpolate the offending value — `state` is a closed enum but the same
  no-echo discipline applies uniformly). Returns exactly the two known fields; tolerates extra keys, does
  not copy them. **Do not** reach for `requireString` on `state` — that would accept any string and defeat
  the enum boundary this slice exists to defend. Behaviour asserted by the fail-closed + happy-path tests.
- Add `case 'turn_state'` to `parseInboundMessage`'s `switch (envelope.type)` (mirror `case
  'assistant_delta'`, `inboundMessage.ts:387-400`): narrow **before** logging so a malformed frame throws
  first and leaves no record; emit `{ event: 'inbound-decoded', code: 'turn_state', bytes:
  plaintext.length, hash: hashPlaintext(plaintext) }` — **no decoded field** (`state`, `conversation_id`)
  is logged; then `return { kind: 'turn-state', turnState }`.

The existing `MAX_PLAINTEXT_BYTES` guard at the top of `parseInboundMessage` already fails oversized
frames closed for this type too — do not add a second guard.

### 3. Consumer emit — `src/main/daemonConnection.ts`

Add one `case 'turn-state'` to the inner `switch (inbound.kind)` (mirror `case 'assistant-delta'`,
`daemonConnection.ts:283-295`): emit a fresh literal `{ type: 'turnState', state: inbound.turnState.state }`.
**Drop `conversation_id`** (single active conversation, ADR 0004; #202's bridge scopes identity). Fresh
literal with the one named field, never a spread of the decoded payload.

### 4. `DaemonEvent` arm — `src/shared/ipc/events.ts`

Add one arm, `state` typed as the shared wire enum (import `WireTurnState` alongside the existing
`../wire/types` imports):

```ts
| { type: 'turnState'; state: WireTurnState }
```

Carries only `state` (`conversation_id` dropped at the emit) — no token, key, or raw frame, preserving
`events.ts`'s AC4-by-construction invariant. Mirror the doc-comment on the `assistantDelta` / `turnEnd`
arms (77-78) — note it is consumed by the **timeline** bridge (#202), not the session store.

### 5. Session bridge (no-op) — `src/renderer/src/store/daemonEventBridge.ts`

Add `case 'turnState': return null` to `translateDaemonEvent` (mirror the `assistantDelta` / `turnEnd`
case at 58-62), with a comment: *no session-store action — the timeline bridge consumes this.* Required
purely because the `assertNever` default makes a new `DaemonEvent` arm a compile error until every
subscriber decides its mapping.

### 6. Timeline bridge (the real mapping) — `src/renderer/src/store/timelineBridge.ts`

Add `case 'turnState': return { type: 'turnState', state: event.state }` to `translateTimelineEvent`'s
**owned** block (mirror `assistantDelta` / `turnEnd` at 37-40 — a fresh literal with named fields, not a
spread). This is the arm that produces the `ThreadEvent` `turnState` (`threadTimeline.ts:48`) which
`reduceTimeline` folds into `phase`. `event.state` is `WireTurnState`; the `ThreadEvent` arm expects
`TurnPhase`; the two are the same literal union, so the assignment type-checks with no cast and no import
of `TurnPhase` — a rename, not a re-validation. Do **not** add `turnState` to the null fall-through list;
it is an **owned** arm.

### Data flow

```
relay socket (untrusted)
  → Noise decrypt → plaintext bytes
  → parseInboundMessage()             [transport boundary: fail-closed decode + content-free log]
      envelope.type 'turn_state' → parseTurnStatePayload (state enum check) → { kind:'turn-state', turnState }
  → daemonConnection switch(inbound.kind)   [consumer: drop conversation_id]
      → emitDaemonEvent { type:'turnState', state }
  → IPC (DAEMON_EVENT_CHANNEL) → renderer
      → daemonEventBridge.translateDaemonEvent  → null   (session store: nothing)
      → timelineBridge.translateTimelineEvent   → { type:'turnState', state }  → timelineStore.dispatch
          → reduceTimeline turnState arm → phase = state (no-churn if unchanged)
```

## State + concurrency model

No new state, no new store, no new async task, no new IPC channel. Decode is a pure synchronous function;
the event rides the existing one-way `DAEMON_EVENT_CHANNEL` via `emitDaemonEvent` on the existing driver
read loop — no correlation map, no pending request, no teardown to add. The two renderer bridges are two
independent subscribers on the same channel (already the case for `assistantDelta` / `turnEnd`): the
session bridge no-ops `turnState`, the timeline bridge owns it. No-churn on an unchanged `phase` is
`reduceTimeline`'s existing property (`threadTimeline.ts:142`), not new work here. Cancellation, socket
lifecycle, and reconnect are unchanged and owned upstream (`relaySupervisor` / `noiseRelayDriver`).

## Error handling

- **Missing `conversation_id`, or a `state` that is missing / not a string / a string outside the closed
  enum** → `parseTurnStatePayload` throws `WireDecodeError` (never a partial value). `daemonConnection`'s
  existing `try/catch` around `parseInboundMessage` (`daemonConnection.ts:239-246`) drops the frame — no
  event, no throw, no log (the caught error is dropped so it can't echo plaintext). No new catch needed.
- **Oversized frame** → the existing `MAX_PLAINTEXT_BYTES` guard throws before decode.
- **Well-formed but unmodeled** (e.g. `tool_use` before its own slice) → still falls to `default →
  inbound-unmodeled → null`, harmless drop. Only `turn_state` graduates here.
- **Category-only error messages** — the `state` check names the field only, never interpolating the
  value, matching the `role` idiom (uniform no-echo discipline across the decoder).
- **Content-free diagnostics** — the new log call carries only `code` + `bytes` + `hash`, never `state`
  or `conversation_id`. The throw path stays unlogged (narrow before log).

## Testing strategy

Bullet scenarios; the developer writes the vitest code in the project idiom, mirroring the
`assistant_delta` / `turn_end` cases. `npm test` + `npm run build` must stay green.

**`inboundMessage.test.ts`** (mirror `inboundMessage.test.ts:324-406`):
- Well-formed `turn_state{conversation_id, state}` for each of `thinking` / `responding` / `idle` →
  `{ kind: 'turn-state', turnState: { conversation_id, state } }`; both fields verbatim.
- Fail-closed — **throws `WireDecodeError`, no partial value** — for: `state` absent; `state` a non-string
  (number, object, `null`); `state` a string outside the enum (e.g. `'done'`, `''`); `conversation_id`
  absent / non-string; the payload not an object (`'nope'`, `['a']`).
- Extra server-added key is tolerated (decodes fine) but not copied onto the result.
- Content-free logging: with an injected `DiagnosticLog`, a decoded `turn_state` logs `code:'turn_state'`,
  `bytes`, `hash`, and the record contains **neither** `state` **nor** `conversation_id`. A malformed
  frame throws and logs **nothing**.

**`daemonConnection.test.ts`** (the safety net for the un-`assertNever`'d inner switch — a missing consumer
case silently drops):
- A `turn_state` frame delivered through the driver emits exactly one `{ type:'turnState', state }`;
  `conversation_id` is **absent** from the emitted event. Cover all three states.
- No regression: coarse `message` / `message_chunk` still emit `messageReceived` / `messagesReceived`.

**`daemonEventBridge.test.ts`**: `translateDaemonEvent` returns `null` for the `turnState` arm (mirror the
`assistantDelta` case). This plus the `assertNever` guard is the compile-time + runtime proof the arm is
handled by the session bridge.

**`timelineBridge.test.ts`** (the end-to-end AC5 proof on the renderer side; mirror `timelineBridge.test.ts:29-155`):
- `translateTimelineEvent({ type:'turnState', state })` → `{ type:'turnState', state }`, a fresh object,
  for each of the three states; and it is **removed** from the "returns null for every other arm" list.
- Through `subscribeTimeline` into an **isolated** `createTimelineStore()`: emitting a `turnState`
  DaemonEvent drives `store.getState().phase` to that state; `thinking` / `responding` / `idle` all
  round-trip. Re-emitting the **same** state is a no-churn no-op — assert the store's state object is the
  **same reference** after the duplicate (the reducer's `event.state === state.phase ? state : …`).

**`types.test.ts`**: the new `TurnStatePayload` interface / `WireTurnState` / `EnvelopeType` member
compile (type-level, mirror existing).

Type coverage: `npm run typecheck` — the two `assertNever` guards (`daemonEventBridge`, `timelineBridge`)
are the exhaustiveness proof that both subscribers handle the new arm.

## Scope self-check (6 production files — read this before flagging oversize)

This spec prescribes changes to **exactly 6 production `.ts` files, 0 new files** (verified by reading
every touchpoint; no hidden cascade):

1. `src/shared/wire/types.ts` — `WireTurnState` + `TurnStatePayload` + 1 `EnvelopeType` member
2. `src/main/transport/inboundMessage.ts` — 1 parse fn + 1 kind + 1 switch case
3. `src/main/daemonConnection.ts` — 1 consumer case
4. `src/shared/ipc/events.ts` — 1 `DaemonEvent` arm
5. `src/renderer/src/store/daemonEventBridge.ts` — 1 `assertNever` case (return null)
6. `src/renderer/src/store/timelineBridge.ts` — 1 `assertNever` case (the real mapping)

This crosses the §4 file-count self-check boundary (≥5), so the decision is **documented, not assumed** —
and it is a deliberate keep-as-S, on direct precedent, not an undercount rationalization:

- **6 is the architectural floor for this slice.** Adding an inbound `DaemonEvent` that drives the
  timeline needs: wire type → decode → connection emit → event union → **both** renderer bridges (the
  session bridge and the timeline bridge are each `assertNever`-guarded, so each is a compile error until
  it has a case). #199 hit exactly this floor at **5** because the timeline bridge did not exist yet
  (it was #202); now it does, so the floor is 6. There is no 5-file version — drop any one and it either
  doesn't compile or never decodes.
- **The honest count is 6 and every file is a load-bearing, tiny, cloned edit** — 2–20 lines each,
  cloning a pattern that already lives in the same file (`assistant_delta` is the template for five of
  the six; `role` is the template for the enum check). This is the opposite of the §4 gate's target
  failure (pyrycode #311: *claimed* 4 files, *actual* 13 / 300+ LOC). Nothing is hidden; the estimate is
  bounded by three direct precedents.
- **Direct clean precedents shipped this shape as S:** #199 (5 prod files), #180 (8 prod files), #139
  (8 prod files) — the exact wire → decode → emit → event → bridge chain — each shipped as one **S**
  ticket, code-review PASS, no salvage. #214 is strictly smaller than #180 / #139 and one file larger than
  #199 for the structural reason above.
- **Splitting is strictly worse and would ship dead code.** The only seam is wire+decode (files 1–2) vs.
  emit+event+bridges (files 3–6). Slice A would decode `turn_state` into an `InboundDaemonMessage` kind
  that `daemonConnection`'s un-`assertNever`'d inner switch **silently drops** — a decode with no consumer,
  observably nothing, a code smell a reviewer would flag. It does not "stand alone." Net: two tickets,
  double the fixed pipeline overhead, a dead-code intermediate, for ~160 LOC total. No.
- **Every line-based red line (the accurate turn-budget proxy) passes comfortably:** 0 new files,
  ~45 production + ~110 test ≈ **~155 total LOC** (well under 600), **2 new exported types**
  (`WireTurnState`, `TurnStatePayload`; the arm/kind are union members, not exports), **0 consumer
  call-site cascade** (the two bridge cases are compile-forced single lines), **1 reject branch**
  (the `state` enum check), **6 ACs** all facets of one change. Projected turn cost tracks #199
  (~15–25 turns), well inside budget.

Conclusion: genuine, verified, precedented S. Not an undercount — proceed.

## Open questions

- **Inner-switch exhaustiveness (deferred, not adopted).** `daemonConnection.ts`'s `switch (inbound.kind)`
  still has no `default: assertNever(inbound)`, so a missing consumer case silently drops rather than
  failing to compile. The `daemonConnection.test.ts` emit test is the deterministic safety net (same as
  #180 / #199). **Do not** expand scope to guard the switch here.
- **`state` value evolution.** The daemon enum is closed to three today. A future fourth state would fail
  closed here (dropped frame) until this decoder and `TurnPhase` / `reduceTimeline` are widened together —
  the correct fail-closed posture for a wire enum, and a deliberate no-drift stance (CLAUDE.md).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST-FIX. The untrusted→trusted boundary (relay socket → decrypted plaintext →
  `parseInboundMessage`) gains one explicit, single-function fail-closed decoder (`parseTurnStatePayload`),
  throwing `WireDecodeError` on any structural/semantic mismatch, never a partial value — the same named
  boundary that already owns `message` / `assistant_delta`. The **tightest** boundary in this slice is the
  `state` **closed-enum** check: a hostile daemon cannot smuggle an arbitrary string, an object, `null`, or
  a `'__proto__'`-style value onto `phase` — anything not exactly `'thinking' | 'responding' | 'idle'`
  throws and the frame drops. Positive control against IPC-side unknown-key / prototype leakage: the
  consumer emits a **fresh object literal** with the one named field (`{ type:'turnState', state }`), never
  a spread of the decoded payload, so only the narrowed enum value crosses IPC.
- **[Trust boundaries — code-review must verify]** SHOULD FIX (design-directed, already specified). The
  security property of this slice **is** the enum check. If the developer reaches for `requireString('state')`
  instead of the `role`-style enum comparison (Design § 2), the boundary silently weakens to "any string
  reaches `phase`". This is called out explicitly in § 2 ("Do not reach for `requireString` on `state`");
  code-review must confirm the shipped decoder uses the three-way literal comparison, not a bare string
  narrower. Deterministic net: the `inboundMessage.test.ts` fail-closed cases assert an out-of-enum string
  (`'done'`, `''`) throws — a green suite proves the enum boundary shipped.
- **[Tokens / secrets]** N/A by design. No token/key/credential is added, decoded, or carried. The one arm
  carries only `state` (a 3-value enum); `conversation_id` is decoded at the boundary and **dropped** at
  the emit (single active conversation). No field on the arm can hold a key/token/raw frame (AC4/AC5),
  matching `events.ts`'s existing invariant.
- **[File / storage]** N/A — no filesystem or storage operation in this slice.
- **[Electron attack surface]** No finding. No new `BrowserWindow`, `webPreferences`, IPC channel,
  `ipcMain` handler, custom protocol, or preload method — the arm rides the existing one-way
  `DAEMON_EVENT_CHANNEL` (`emitDaemonEvent`) the preload already forwards generically (no per-type preload
  change). Process placement preserved: decode lives in `src/main/transport/inboundMessage.ts` (main-only,
  imports `Buffer`, never re-exported to a renderer barrel); no key, socket, or raw frame moves toward the
  renderer. The 3-value `state` flowing main→renderer grants the renderer no new reach toward transport/keys.
- **[Cryptographic primitives]** N/A — no RNG, key, nonce, or handshake code. `hashPlaintext` (BLAKE2s via
  `@noble/hashes`, note #101) is reused verbatim for content-free logging; no new or hand-rolled crypto.
- **[Network & I/O]** No finding. The existing `MAX_PLAINTEXT_BYTES` (65519) guard at the top of
  `parseInboundMessage` fails an oversized `turn_state` frame closed before decode — no new size cap
  needed. The payload is two flat scalars (no array, no nesting), so there is no decode amplification; a
  hostile `state` (a huge string or deeply nested object) is rejected by the enum comparison in O(1) with
  no regex (no ReDoS). No new socket / timeout / reconnect surface.
- **[Error messages, logs, telemetry]** No finding — the category the ticket is security-sensitive *for*,
  addressed head-on. The one new diagnostic call is **content-free** (`code:'turn_state'` + `bytes` +
  one-way `hash` only), emitted **after** the frame fully narrows so the throw path leaves no record; the
  parser error message names the failure **category only** (`missing required field: state` — never
  interpolating `state` or the conversation-correlating `conversation_id`); the `WireDecodeError` caught in
  `daemonConnection` is dropped, never logged or forwarded.
- **[Concurrency]** No finding — no new async task, timer, listener, or socket; decode is synchronous; the
  event rides the existing driver read loop. No shared-state check-then-act, nothing to cancel or leak. The
  two renderer bridges are pre-existing independent subscribers.
- **[Threat model alignment]** Addressed for the boundary this slice owns. *Malicious/compromised relay*
  (on-path, content-blind): a flood of malformed `turn_state` frames all throw and drop — no plaintext
  leak, no log record, no hang (synchronous, frame-bounded). *Hostile daemon response* (malformed/oversized
  inside the session): every field parsed defensively, fail-closed, with the `state` enum check as the
  tightest gate — this slice's raison d'être. *Renderer compromise reaching transport*: unchanged — no new
  renderer capability.
- **[Untrusted content at render — no forward, unlike #199]** Unlike `assistant_delta.text` (#199, which
  #203 must render as text not HTML), `turn_state.state` reaches the render slice as one of exactly three
  known enum values — it drives a boolean-ish "thinking…" indicator, not free text. There is **no**
  untrusted-text-at-DOM concern to forward to the sibling render slice.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-10
</content>
