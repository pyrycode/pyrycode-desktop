# Spec #235 — Outbound wire: `modal_answer` / `modal_cancel` envelope types + fail-closed builders

**Size:** S · **security-sensitive** · Base slice of the outbound modal answer/cancel path (#225 3-way).

Adds the two **outbound** (client → daemon) modal-resolution frames to the wire: two `EnvelopeType`
members, two payload types (`ModalAnswerPayload` / `ModalCancelPayload`), and two pure fail-closed
builders (`buildModalAnswer` / `buildModalCancel`). **No consumer** — the command path that mints the
`answer_token` and calls these builders is #236 (main-side), and the renderer buttons that trigger it are
#237. This slice ships the builders in isolation, exactly the `sendMessageEnvelope.ts` /
`requestSnapshotEnvelope.ts` precedent (a pure `{id, ts, payload} → encodeEnvelope` builder that MAY throw
`WireEncodeError` on over-cap).

This is a near-exact **structural clone of `requestSnapshotEnvelope.ts`** (the payload-carrying outbound
builder — a modal, like a snapshot request, carries a real payload with a correlation field), doubled for
the answer/cancel pair. The only wire novelty is two new payload shapes; there is **no decode path** (these
are outbound-only) and **no new consumer wiring** in this slice.

## Design source

N/A — main-process transport + shared wire types; no UI surface (the buttons that trigger these builders
are the render slice **#237**, which carries its own Figma anchor). Visual-fidelity check intentionally
skipped for this slice.

## Files to read first

Read these before writing a line. The whole design is "mirror `requestSnapshotEnvelope.ts` twice — once
for `modal_answer{modal_id, option_id, answer_token}`, once for `modal_cancel{modal_id}` — and add the two
outbound payload types beside the existing inbound modal types."

- `src/main/transport/requestSnapshotEnvelope.ts` (whole, ~44 lines) — **the direct template.** The
  payload-carrying outbound builder: an `Input` interface (`id`/`ts`/`payload`), a `build…` function that
  wraps the payload in a typed `Envelope` and returns `encodeEnvelope(envelope)`, MAY throw
  `WireEncodeError`. Copy this shape verbatim for both builders. The main-process-only header comment
  (never re-export through a renderer barrel) applies to the new file too.
- `src/main/transport/requestSnapshotEnvelope.test.ts` (whole, ~31 lines) — **the direct test template.**
  Two tests per builder: a round-trip through the **real** codec (`decodeEnvelope` → assert
  `type`/`id`/`ts`/`payload`) and an over-cap `WireEncodeError` throw. Mirror it for `buildModalAnswer` and
  `buildModalCancel`.
- `src/main/transport/sendMessageEnvelope.ts` (whole) — the sibling precedent; confirms the pattern is
  established (pure, no clock/counter read) and the doc-comment conventions to reuse.
- `src/shared/wire/types.ts:40-62` — the `EnvelopeType` union. Add `'modal_answer'` and `'modal_cancel'`
  beside the existing inbound `'modal_shown'` / `'modal_dismissed'` (lines 57-58).
- `src/shared/wire/types.ts:263-307` — the existing inbound modal types (`WireModalOption`,
  `ModalShownPayload`, `ModalDismissedPayload`) and their doc-comment style (name the SSOT, note "all
  always present, no `omitempty`", note `modal_id` is the sole correlation key / no `conversation_id`).
  Mirror this style for the two new outbound payloads; place them adjacent (after `ModalDismissedPayload`).
- `src/shared/wire/types.test.ts:156-215` — the `#201` "modal wire vocabulary" test block. Add a **parallel
  outbound block** (see Testing strategy): admit the two new `EnvelopeType` members and shape the two new
  payloads, asserting **no `conversation_id`** on either (the exact assertion #201 makes at
  `types.test.ts:203`).
- `src/main/transport/codec.ts:39-47, 108-118` — `WireEncodeError` and `encodeEnvelope`'s over-cap check
  (`> MAX_PLAINTEXT_BYTES` → throw). The builders rely on this; the tests import `WireEncodeError` from
  here (not from `types.ts`). No change to this file.
- `docs/knowledge/decisions/0009-*.md` (if present) — the `modal_id`-sole-key / no-`conversation_id` ADR;
  the rationale the wire doc-comments cite.

**SSOT field set — inlined (re-confirmed against `pyrycode-docs/protocol-mobile.md` § Modal (v2), the
authority behind SSOT #701, on 2026-07-10):**

| Frame | Direction | Fields (wire order) |
|---|---|---|
| `modal_answer` | client → daemon | `modal_id: string`, `option_id: string` (**single**, not `option_ids[]`), `answer_token: string` |
| `modal_cancel` | client → daemon | `modal_id: string` |

**Do NOT add `conversation_id` or `option_ids[]`.** A QMD search surfaces daemon-repo **ADR 025**, which
sketches a stale `modal_answer{conversation_id, modal_id, option_id|option_ids[], answer_token}`. That
shape is **superseded** — the daemon hosts one active conversation and resolves `modal_id` against its own
outstanding-modal state, so `modal_id` is the sole correlation key and a second `conversation_id` key would
conflict. The SSOT is protocol-mobile.md / #701, not ADR 025.

## Context

The desktop drives an interactive `claude` session over the relay. When `claude` raises a permission/trust
prompt, the daemon sends `modal_shown` (decoded by #201) and the desktop renders it (#224). To resolve the
prompt the desktop sends one of two outbound frames back to the daemon:

- `modal_answer{ modal_id, option_id, answer_token }` — the user's choice. `option_id` references a
  `WireModalOption.id` from the inbound `modal_shown` (`ModalShownPayload.options[].id`, already in
  `types.ts`). `answer_token` is a **client-minted idempotency key** tying the answer to the prompt's
  one-time `modal_id`, so a replayed / reordered answer is inert (the daemon resolves `modal_id` against
  its own outstanding-modal state and ignores a second answer — first-answer-wins, #703/#706).
- `modal_cancel{ modal_id }` — dismiss the prompt from the desktop.

This slice adds **only the wire types and the two pure builders**. It mints no token, wires no command, and
renders no button. The `answer_token` is minted **main-side by #236** (`crypto.randomUUID`), not here and
not in the renderer — the builder receives the fully-formed `ModalAnswerPayload` and serializes it,
exactly as `buildSendMessage` receives an already-validated `SendMessagePayload`.

## Design

### 1. Wire types (`src/shared/wire/types.ts`)

**1a. `EnvelopeType` union (lines 40-62).** Add two members beside the inbound modal entries:

```ts
  | 'modal_shown'
  | 'modal_dismissed'
  | 'modal_answer'    // ← new (outbound)
  | 'modal_cancel'    // ← new (outbound)
```

This is a purely additive union extension. **Fan-out check (done): zero consumer cascade.** No production
code does an exhaustive `switch`/`assertNever` over `EnvelopeType` (`noiseSession.ts`'s only reference is a
comment; all `assertNever` sites in the tree discriminate renderer-side `DaemonEvent`/route/status unions,
not `EnvelopeType`). The four existing outbound members (`send_message`, `request_snapshot`,
`request_debug_bundle`, `list_conversations`) were added the same way with no cascade.

**1b. Two outbound payload interfaces**, placed after `ModalDismissedPayload` (line 307), mirroring the
inbound-modal doc-comment style. Contract only (fields in **wire order**):

```ts
export interface ModalAnswerPayload {
  modal_id: string
  option_id: string      // references a WireModalOption.id from the inbound modal_shown; single, not option_ids[]
  answer_token: string   // client-minted idempotency key (minted main-side by #236, NOT here)
}

export interface ModalCancelPayload {
  modal_id: string       // the sole correlation key; NO conversation_id (ADR 0009)
}
```

Doc-comments must: name the SSOT (protocol-mobile.md § Modal (v2) / #701, ADR 0009); note "all always
present, no `omitempty`"; note the direction is **outbound** (client → daemon), contrasting the adjacent
inbound `modal_shown`/`modal_dismissed`; note `modal_id` is the sole correlation key (no `conversation_id`);
and note `answer_token`'s uniqueness/stability matter but **secrecy does not** (it is an anti-replay
idempotency key, not a credential — see Security review).

### 2. Builders — one file, `src/main/transport/modalResolutionEnvelope.ts` (new)

**File decision (the architect's call per the ticket):** house **both** builders in one new file. Rationale:
answer and cancel are the two halves of a single concern — *resolving an outstanding modal* — sharing the
`modal_id`-sole-key contract, and #236 imports both together (`daemonConnection.answerModal` /
`cancelModal`). This honours the module's one-concern-per-file rule with `concern = modal resolution`, and
keeps the production-file count at two. Do **not** add a barrel/`index.ts`; #236 imports the two functions
by relative path (the module has no barrel today, and the renderer must never reach these — raw bytes stay
in main).

Each builder is a verbatim clone of `buildRequestSnapshot` — an `Input` interface (`id: number`,
`ts: string`, `payload: <the payload type>`) and a `build…` function that assembles a typed `Envelope`
(`{ id, type: 'modal_answer' | 'modal_cancel', ts, payload }`) and returns `encodeEnvelope(envelope)`.
Contract sketch (both < 10 lines, no bodies beyond the wrap):

```ts
export interface ModalAnswerInput { id: number; ts: string; payload: ModalAnswerPayload }
export function buildModalAnswer(input: ModalAnswerInput): Uint8Array   // → Envelope{type:'modal_answer'} → encodeEnvelope; MAY throw WireEncodeError

export interface ModalCancelInput { id: number; ts: string; payload: ModalCancelPayload }
export function buildModalCancel(input: ModalCancelInput): Uint8Array   // → Envelope{type:'modal_cancel'} → encodeEnvelope; MAY throw WireEncodeError
```

The file header comment mirrors `requestSnapshotEnvelope.ts`: **MAIN-PROCESS ONLY** (imports `codec.ts`,
which pulls Node `Buffer`); never re-export through any renderer barrel. Pure — `id`/`ts`/`payload` are
injected, no clock or counter read, no side effects, no token minting.

**Field-order note for #236 (documentary, not enforced here):** the daemon parses JSON by field name
(Go `encoding/json` is order-independent on decode), so field order is not load-bounded for correctness;
but #236 should construct the `ModalAnswerPayload` literal in the declared wire order
(`modal_id, option_id, answer_token`) to stay byte-aligned with the mobile client, matching how
`composerSend`/#180 construct their payloads.

## State + concurrency model

None. Both builders are pure synchronous functions with no state, no store slice, no async task, no timer,
no listener, no socket. They are unit-testable in isolation with a fixed `id`/`ts`. No store contract, no
re-render seam, no teardown. (This is the base wire slice; the store/command state lives in #236.)

## Error handling

Single failure mode, delegated to the existing codec: `encodeEnvelope` throws `WireEncodeError` when the
serialized envelope exceeds `MAX_PLAINTEXT_BYTES` (65519). The builders propagate it unchanged — they add
no try/catch. The eventual caller (#236 `daemonConnection`) catches and drops the send, per the
`buildSendMessage` / `buildRequestSnapshot` precedent (their header comments: "the sole caller catches it
and drops the send"). No new error type, no partial-frame emission. There is **no decode path** in this
slice, so no `WireDecodeError` surface.

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. Two files touched.

**`src/main/transport/modalResolutionEnvelope.test.ts` (new)** — mirror `requestSnapshotEnvelope.test.ts`,
using the **real** codec so the assertions pin actual wire bytes. Four scenarios:

- `buildModalAnswer` happy path: given `{ id, ts, payload: { modal_id, option_id, answer_token } }`, the
  bytes round-trip through `decodeEnvelope` to an envelope with `type === 'modal_answer'` and the exact
  `id` / `ts` / `payload` (`toEqual` the payload — confirms all three fields present, nothing dropped or
  added).
- `buildModalAnswer` over-cap: an oversized field (e.g. `answer_token: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1)`)
  → `toThrow(WireEncodeError)`.
- `buildModalCancel` happy path: `{ modal_id }` payload round-trips to `type === 'modal_cancel'` with the
  exact `modal_id` and **no other fields** (`toEqual({ modal_id })`).
- `buildModalCancel` over-cap: `modal_id: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1)` → `toThrow(WireEncodeError)`.

**`src/shared/wire/types.test.ts`** — add a parallel **outbound** modal-vocabulary block beside the #201
inbound block (`:156-215`), as bullet-level type-only assertions:

- admits the two outbound modal `EnvelopeType` members (`const a: EnvelopeType = 'modal_answer'` /
  `'modal_cancel'`).
- shapes `ModalAnswerPayload` as `{ modal_id, option_id, answer_token }` — assert `toEqual` a literal with
  exactly those three keys (a single `option_id`, **not** `option_ids`).
- shapes `ModalCancelPayload` as `{ modal_id }` — exactly one key.
- **no `conversation_id` on either** payload (the explicit assertion #201 makes at `types.test.ts:203`,
  re-stated here for the outbound pair — the anti-ADR-025 guard).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries — the outbound encode boundary]** No MUST-FIX. This slice sits on the trusted→wire
  boundary (already-validated payload → serialized bytes → the encrypted channel), the **opposite**
  direction from the inbound decode boundary (#201). There is **no untrusted input** in this slice: the
  builders receive a fully-formed `ModalAnswerPayload` / `ModalCancelPayload` from their (future) caller and
  serialize it; validation of the user's `option_id` against the shown modal's options, and minting of the
  `modal_id`/`answer_token`, are #236's job. The one defence this slice carries is **fail-closed on
  over-cap** — `encodeEnvelope` throws `WireEncodeError` above `MAX_PLAINTEXT_BYTES`, never emitting a
  truncated frame — inherited unchanged from the codec. The builders assemble a **fresh typed `Envelope`
  literal** (`{ id, type, ts, payload }`), never a spread of caller data beyond the typed `payload`, so no
  extra keys ride the frame.
- **[Wire-contract integrity — the load-bearing finding]** No MUST-FIX, actively enforced. The security-
  relevant correctness property here is **not** adding a second correlation key. The stale ADR 025 shape
  (`conversation_id` + `option_ids[]`) would introduce a conflicting `conversation_id` alongside `modal_id`
  and a multi-select `option_ids[]` where the daemon expects a single `option_id` — either could cause the
  daemon to mis-resolve or reject the frame, and a divergent client wire shape is a silent contract break
  (CLAUDE.md: "a byte mismatch breaks the contract silently"). The design pins the SSOT field set inline
  (single `option_id`, no `conversation_id`), and a **regression test asserts no `conversation_id` on either
  payload** — a deterministic guard against the stale shape leaking back in. This is the belt-and-suspenders
  posture: the field set is fixed by the type (compile-time) **and** pinned by an explicit test (deterministic
  code, not a stochastic rule).
- **[Tokens / secrets]** N/A — and a deliberate non-secret. `answer_token` is a **client-minted idempotency
  key**, not a credential: per protocol-mobile.md § Modal, "its uniqueness and stability matter; secrecy does
  not." It carries no entropy requirement beyond uniqueness (a UUID), grants no authority, and is safe to log
  content-free / carry in plaintext-inside-Noise like any other field. No device token, static key, or QR
  secret is added, decoded, or carried by either payload. Minting is **not** in this slice (deferred to #236,
  main-side) — so no RNG runs here.
- **[Process placement / Electron attack surface]** No finding — and this is the category the ticket is
  security-sensitive *for*. The new file is **MAIN-PROCESS ONLY** (`modalResolutionEnvelope.ts` imports
  `codec.ts` → Node `Buffer`), lives under `src/main/transport/`, and is **never re-exported through a
  renderer barrel** — enforced by the header comment and by the module having no barrel (import-by-relative-
  path only). The shared type additions in `src/shared/wire/types.ts` are `Buffer`-free (the renderer may
  import them, exactly as it imports `ModalShownPayload`), but no raw bytes, key, socket, or builder cross
  toward the web layer. No new `BrowserWindow`, `webPreferences`, IPC channel, `ipcMain` handler, custom
  protocol, or preload method. The renderer gains **no new reach** toward transport or keys from this slice.
- **[Network & I/O]** No finding. The existing `MAX_PLAINTEXT_BYTES` (65519) guard inside `encodeEnvelope`
  bounds every frame this slice produces — an oversized `answer_token`/`modal_id`/`option_id` fails closed
  before any bytes leave the builder. Each payload is 1–3 flat string scalars (no array, no nesting), so
  encode is O(fields) with no amplification and **no regex** (no ReDoS). No new socket, timeout, or reconnect
  surface. The builders are pure serializers; nothing is dialed or opened.
- **[File / storage]** N/A — no filesystem or storage operation. `modal_id` / `option_id` / `answer_token`
  are correlation-key / opaque idempotency strings, never resolved into a path or opened.
- **[Cryptographic primitives]** N/A — no RNG, key, nonce, or handshake code (the `answer_token` UUID is
  minted in #236, not here); the Noise session that seals these bytes is #7's, unchanged.
- **[Error messages, logs, telemetry]** No finding. This slice adds **no logging call** at all (the builders,
  like `buildRequestSnapshot`, perform no logging). `WireEncodeError`'s message names the failure **category
  only** — never interpolating `answer_token` / `option_id` / `modal_id` (codec.ts:39-47) — so even the
  over-cap throw path leaks no field value.
- **[Concurrency]** No finding — the builders are pure and synchronous; no async task, timer, listener, or
  shared state; nothing to cancel or leak.
- **[Threat model alignment]** *Malicious / compromised relay* (on-path, content-blind): sees only Noise
  ciphertext; this slice changes no framing the relay reads. *Stale/guessed `modal_id`* (replay / reorder):
  outside this slice's authority — the daemon rejects a non-current `modal_id` (first-answer-wins, #706) and
  the `answer_token` makes a re-applied answer a no-op; this slice merely carries both fields faithfully,
  and the anti-ADR-025 guard ensures it carries **exactly** the SSOT set so those daemon-side invariants
  are not undermined by a divergent frame. *Renderer compromise reaching transport*: unchanged — the builder
  is main-only and unexported to the web layer, and the renderer cannot construct or send a frame through it.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-10

## Open questions

None blocking. Two forward-looking notes for the downstream slices (not deliverables of this slice):

- **#236 mints `answer_token` main-side** (`crypto.randomUUID`), not in the renderer — contrast
  `composerSend`, which mints `message_id` renderer-side. The distinction is deliberate: the token is an
  anti-replay key on the security-sensitive answer path, so it is minted in the trusted main process.
- **#236 should construct the `ModalAnswerPayload` literal in wire order** (`modal_id, option_id,
  answer_token`) to stay byte-aligned with mobile, per the field-order note in Design § 2.
