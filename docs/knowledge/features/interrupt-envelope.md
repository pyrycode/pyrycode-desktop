# Interrupt envelope (outbound)

The **outbound** half of the stop-a-running-turn path: the wire type, the pure fail-closed transport
builder, and (as of #306) the full command pathway the desktop uses to send the daemon a single "stop
the current turn" signal — the desktop equivalent of pressing Esc at the local terminal. Only the
renderer-visible affordance is still missing.

Introduced in [#305](../codebase/305.md), the wire+builder base slice split from
[#146](https://github.com/pyrycode/pyrycode-desktop/issues/146) (interrupt-running-turn), slice 1 of
3 — that slice shipped **only** the wire contract and the builder, no command wiring, no
`daemonConnection` method, no renderer UI. [#306](../codebase/306.md), slice 2 of 3, wired the
**command pathway** on top of it: a bare `interrupt` `RendererCommand` member, `daemonConnection.interrupt()`,
and the main-side dispatcher arm. Blocks [#307](https://github.com/pyrycode/pyrycode-desktop/issues/307)
— the composer stop-state render, the only remaining slice.

## What it does

Defines the byte-exact shape of a **bare** control frame the desktop sends to the daemon to stop the
current turn, and the pure function that serializes it:

- `interrupt` — no payload, no `conversation_id`, no nonce, no answer token, no idempotency key. The
  daemon intercepts it before `dispatch.Route` (like `request_debug_bundle` / `dequeue_message`) and
  maps it to a single Esc keystroke into the supervised `claude`, stopping the current turn (daemon
  SSOT pyrycode #707).

Unlike the [modal resolution envelope](modal-resolution-envelope.md)'s `modal_answer`, this frame
carries no correlation state at all — not even the ungated-but-payload-bearing shape of
[`dequeue_message`](dequeue-message-envelope.md). It is **bare by construction**: a replayed
`interrupt` is a benign extra Esc, and an Esc with no running turn is a no-op in `claude`, so no
nonce or dedup key is needed (#707). The daemon does not `ack` an `interrupt` — it is
**fire-and-forget**; the turn-stopped signal reaches the desktop through the existing interactive
stream (`turn_state{idle}` / `turn_end`), never as a reply correlated to this frame. The daemon
routes it to an Esc only for a connection that negotiated the `interactive` capability — the desktop
already advertises it (#179) — and that gate is entirely daemon-side; the builder does nothing about
it.

## How it works

### Wire types (`src/shared/wire/types.ts`)

```ts
export type EnvelopeType =
  | ...
  | 'dequeue_message'
  // v2-only bare phone→binary control frame — maps to a single claude Esc (stops the current
  // turn). Carries NO conversation_id / nonce / answer_token / payload; daemon-gated on the
  // `interactive` capability; fire-and-forget (no reply). SSOT pyrycode #707.
  | 'interrupt'
  | ...
```

No payload interface exists for `interrupt` — deliberately (AC5). The documentary role a payload
type would otherwise carry (e.g. `ListConversationsPayload = Record<string, never>` for
`list_conversations`) lives instead as the inline comment above; `interrupt` goes one step further
than `list_conversations` by not even naming a `Record<string, never>` type.

### The builder (`src/main/transport/interruptEnvelope.ts`, new, MAIN-PROCESS ONLY)

```ts
export interface InterruptInput { id: number; ts: string }
export function buildInterrupt(input: InterruptInput): Uint8Array
// → Envelope{ id, type: 'interrupt', ts, payload: {} } → encodeEnvelope(); MAY throw WireEncodeError
```

A structural clone of `buildRequestDebugBundle` / `buildListConversations` — the module's two
existing **bare**-frame builders — not `buildDequeueMessage` (which the ticket body named as the
mirror but which carries a real payload; see [#305 codebase notes](../codebase/305.md) for the
correction). Pure, synchronous, caller-injects `id`/`ts` (no clock/counter read, no side effects). The
serialized `payload` is **present-and-empty (`{}`), never omitted or `null`**: the daemon tolerates
an absent payload for a bare control type (intercepted before dispatch), but the desktop's own
`decodeEnvelope` throws on one (see [wire codec](wire-codec.md), `codec.ts:133`), and
`Envelope.payload` is a required field — relaxing it to optional would be a wire-type drift touching
every consumer. `{}` (not `null`) also upholds the module's never-emit-null posture. `encodeEnvelope`
throws `WireEncodeError` above `MAX_PLAINTEXT_BYTES`; unreachable in practice for a fixed-shape
~60-byte empty-payload envelope, but the builder propagates it unchanged for symmetry with every
sibling builder. No barrel — never re-exported through the renderer; raw bytes stay in main.

## Configuration and usage

**Command path complete, no renderer trigger yet.** [#306](../codebase/306.md) added
`daemonConnection.interrupt(): void` (no payload arg, since the frame is nullary — the `driver === null`
inert-when-disconnected twin of `requestConversations`) plus a bare `{ type: 'interrupt' }`
`RendererCommand` member and its `interruptCommand()` factory, routed through `main/index.ts`'s
`onCommand` switch (`case 'interrupt': connection.interrupt(); return`). The dispatcher does no
liveness check of its own — `interrupt()` itself is the inert-when-disconnected guard, so the frame is
silently dropped rather than the connection ever asked to confirm liveness. No preload change: the
generic `sendCommand(command: RendererCommand)` pipe already carries the new member.

The renderer affordance — a composer stop-state control that calls `interruptCommand()` — lands
further downstream in [#307](https://github.com/pyrycode/pyrycode-desktop/issues/307); the mobile
Figma file draws only the steady-send composer state (16-61), so the stop-state visual is undrawn and
#307 ships without a design reference (N/A + justification, per memory
`ticket-146-interrupt-turn-split`).

## Edge cases and limitations

- **No decode path.** The frame is outbound-only — nothing for `inboundMessage.ts` to parse,
  mirroring every other bare/payload-carrying outbound-only slice in this module.
- **No reply, no correlation.** Unlike `dequeue_message` or `modal_answer`, there is no daemon
  response to this frame at all. `daemonConnection.interrupt()` (#306) accumulates no pending-request
  state for it — the turn-stopped signal is read off the pre-existing `turn_state`/`turn_end` decode
  path.
- **Ungated by design, and lower-severity than `dequeue_message`.** No token, no nonce, and — unlike
  `dequeue_message` — no payload for the `isRendererCommand` boundary guard to even validate beyond the
  `type` discriminant; the daemon-side `interactive` gate (already satisfied via #179) is the only gate.
  A compromised renderer's worst case is self-inflicted: stopping the user's own running turn,
  equivalent to a button the user can already click (architect security review, #305 and #306, both
  PASS).
- **Zero `EnvelopeType` consumer cascade.** Same as every other outbound-only member — no exhaustive
  `switch` over `EnvelopeType` exists, so the new member needed no companion `assertNever` fix-up.

## Related

- [Dequeue message envelope](dequeue-message-envelope.md) / [#299 codebase notes](../codebase/299.md)
  — the payload-carrying wire+builder base slice the ticket body initially pointed at as the mirror;
  the contrasting (non-bare) shape. [#300 codebase notes](../codebase/300.md) is the fire-and-forget
  command-pathway template `daemonConnection.interrupt()` (#306) clones the no-correlation-memory
  posture from.
- [Screen snapshot fetch](screen-snapshot-fetch.md) — hosts `requestSnapshotEnvelope.ts`, the
  original `Input{id,ts,payload}` shape both bare and payload-carrying builders derive from.
- [Wire codec](wire-codec.md) — `encodeEnvelope`/`decodeEnvelope`/`WireEncodeError`, unchanged by
  this slice; `codec.ts:133`'s absent-payload throw is why `payload: {}` is emitted present-and-empty.
- [Command channel](command-channel.md) — the `RendererCommand`/`isRendererCommand` seam the bare
  `interrupt` member (#306) extends.
- [#305 codebase notes](../codebase/305.md) — the wire+builder implementation summary.
- [#306 codebase notes](../codebase/306.md) — the command-pathway implementation summary: the bare
  `interrupt` `RendererCommand` member, `daemonConnection.interrupt()`, and the `main/index.ts`
  dispatcher arm.
- Blocks [#307](https://github.com/pyrycode/pyrycode-desktop/issues/307) — the composer stop-state
  render, the only remaining slice; calls `interruptCommand()`.
- Daemon twin (QMD `pyrycode-docs`): `docs/protocol-mobile.md` § interrupt; pyrycode #707 (bare
  `interrupt` → single claude Esc, `interactive`-gated, fire-and-forget,
  `TestV2Session_Interrupt_RoutesEscByCapability`).
