# Modal resolution envelope (outbound)

The **outbound** half of the modal vertical: the two wire types and two pure, fail-closed transport
builders the desktop will use to answer or cancel an outstanding permission/trust prompt the daemon
raised via `modal_shown` ([modal-prompt model](modal-prompt-model.md), rendered by the interactive
`PermissionModal` — [#224](../codebase/224.md)). This slice ships **only** the wire contract and the
builders — no command wiring, no token minting, no renderer consumer.

Introduced in [#235](../codebase/235.md), the base slice of the answer/cancel path split from
[#225](https://github.com/pyrycode/pyrycode-desktop/issues/225) (3-way, by transport/render layer):
**#235 (this, wire + builders)** → [#236](https://github.com/pyrycode/pyrycode-desktop/issues/236)
(main-command wiring, mints `answer_token`, security-sensitive) →
[#237](https://github.com/pyrycode/pyrycode-desktop/issues/237) (the answerable-modal renderer
buttons). See [ADR 0009](../decisions/0009-modal-prompt-model.md) for the modal vertical's normative
model; this is the wire counterpart to that ADR's renderer-side `ModalPrompt`/`ModalEvent`.

## What it does

Defines the byte-exact shape of the two frames the desktop sends **back** to the daemon to resolve a
prompt, and two pure functions that wrap an already-formed payload into a serialized `Envelope`:

- `modal_answer{ modal_id, option_id, answer_token }` — the user's choice. `option_id` references a
  `WireModalOption.id` from the inbound `modal_shown.options[]`. `answer_token` is a client-minted
  idempotency key tying the answer to the one-time `modal_id`, so a replayed/reordered answer is inert
  (the daemon resolves `modal_id` against its own outstanding-modal state, first-answer-wins).
- `modal_cancel{ modal_id }` — dismiss the prompt from the desktop.

`modal_id` is the **sole** correlation key on both frames — no `conversation_id` rides a modal (the
daemon hosts one active conversation and resolves `modal_id` against its own state, ADR 0009).

## How it works

### Wire types (`src/shared/wire/types.ts`)

```ts
export type EnvelopeType =
  | ...
  | 'modal_shown'      // inbound
  | 'modal_dismissed'  // inbound
  | 'modal_answer'     // outbound — new
  | 'modal_cancel'     // outbound — new
  | ...

export interface ModalAnswerPayload {
  modal_id: string
  option_id: string      // single string — NOT option_ids[]
  answer_token: string   // minted main-side by #236, not here
}

export interface ModalCancelPayload {
  modal_id: string
}
```

Both payloads carry every field always present (no `omitempty`), placed immediately after the
existing inbound `ModalDismissedPayload`.

### The builders (`src/main/transport/modalResolutionEnvelope.ts`, new, MAIN-PROCESS ONLY)

One file houses both — the two halves of a single concern, *resolving an outstanding modal*, both
keyed solely by `modal_id`. No barrel; the module has never had one, and the renderer must never
reach these (raw bytes stay in main).

```ts
export interface ModalAnswerInput { id: number; ts: string; payload: ModalAnswerPayload }
export function buildModalAnswer(input: ModalAnswerInput): Uint8Array
// → Envelope{ id, type: 'modal_answer', ts, payload } → encodeEnvelope(); MAY throw WireEncodeError

export interface ModalCancelInput { id: number; ts: string; payload: ModalCancelPayload }
export function buildModalCancel(input: ModalCancelInput): Uint8Array
// → Envelope{ id, type: 'modal_cancel', ts, payload } → encodeEnvelope(); MAY throw WireEncodeError
```

Each is a verbatim structural clone of `buildRequestSnapshot`
([screen-snapshot fetch](screen-snapshot-fetch.md)) — pure, synchronous, no clock/counter read
(`id`/`ts`/`payload` are all caller-injected), no side effects, no token minting. `encodeEnvelope`
(see [wire codec](wire-codec.md)) throws `WireEncodeError` above `MAX_PLAINTEXT_BYTES`; the builders
propagate it unchanged — the eventual caller (#236's `daemonConnection.answerModal`/`cancelModal`)
catches it and drops the send, the same posture as `buildSendMessage`/`buildRequestSnapshot`.

## Configuration and usage

**No consumer yet.** Nothing calls either builder; nothing imports this file outside its own test.
The command path that mints `answer_token` (`crypto.randomUUID`, main-side — contrast
`composerSend`'s renderer-side `message_id`) and calls these builders is #236; the renderer buttons
that trigger it are #237.

## Edge cases and limitations

- **No decode path.** Both frames are outbound-only — there is nothing for `inboundMessage.ts` to
  parse here, unlike every prior wire-type ticket in this codebase.
- **No validation of `option_id` against the shown modal's options.** That belongs to the (future)
  caller, which holds the live `ModalPrompt`; the builder serializes whatever payload it is given.
- **`answer_token` is not a secret.** Its uniqueness and stability matter for anti-replay; secrecy
  does not. It carries no entropy requirement beyond uniqueness and grants no authority.
- **Zero `EnvelopeType` consumer cascade.** No production code does an exhaustive `switch` over
  `EnvelopeType` (unlike the `DaemonEvent` union, which has three independent exhaustive switches) —
  adding the two members needed no companion `assertNever` fix-up anywhere.

## Related

- [ADR 0009 — Modal-prompt model](../decisions/0009-modal-prompt-model.md) — the modal vertical's
  normative renderer-side model; this slice is that ADR's outbound wire counterpart.
- [Modal-prompt model](modal-prompt-model.md) / [Modal store + bridge](modal-store-bridge.md) — the
  inbound half of the vertical (`modal_shown`/`modal_dismissed`, #201/#122/#223) this outbound slice
  answers.
- [Screen snapshot fetch](screen-snapshot-fetch.md) — the `buildRequestSnapshot` precedent both
  builders here are a structural clone of.
- [Wire codec](wire-codec.md) — `encodeEnvelope`/`WireEncodeError`/`MAX_PLAINTEXT_BYTES`, unchanged by
  this slice.
- [#235 codebase notes](../codebase/235.md) — implementation summary.
