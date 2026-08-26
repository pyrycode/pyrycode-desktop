# Interrupt envelope (outbound)

The stop-a-running-turn path, end to end: the wire type, the pure fail-closed transport builder, the
full command pathway, and (as of #307) the on-thread render affordance the desktop user actually
clicks — the desktop equivalent of pressing Esc at the local terminal.

Introduced in [#305](../codebase/305.md), the wire+builder base slice split from
[#146](https://github.com/pyrycode/pyrycode-desktop/issues/146) (interrupt-running-turn), slice 1 of
3 — that slice shipped **only** the wire contract and the builder, no command wiring, no
`daemonConnection` method, no renderer UI. [#306](../codebase/306.md), slice 2 of 3, wired the
**command pathway** on top of it: a bare `interrupt` `RendererCommand` member, `daemonConnection.interrupt()`,
and the main-side dispatcher arm. [#307](../codebase/307.md), slice 3 of 3 and the chain's last piece,
added the **render affordance**: a standalone icon-only stop button on the conversation thread, shown
only while a turn is running, that calls `interruptCommand()`. The #146 split is now complete.

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

[#306](../codebase/306.md) added
`daemonConnection.interrupt(): void` (no payload arg, since the frame is nullary — the `driver === null`
inert-when-disconnected twin of `requestConversations`) plus a bare `{ type: 'interrupt' }`
`RendererCommand` member and its `interruptCommand()` factory, routed through `main/index.ts`'s
`onCommand` switch (`case 'interrupt': connection.interrupt(); return`). The dispatcher does no
liveness check of its own — `interrupt()` itself is the inert-when-disconnected guard, so the frame is
silently dropped rather than the connection ever asked to confirm liveness. No preload change: the
generic `sendCommand(command: RendererCommand)` pipe already carries the new member.

### The render affordance (#307)

`InterruptControl`, in `src/renderer/src/screens/conversation/ConversationScreen.tsx`, mounted
immediately before `<Composer />`. It read the existing `useTimelineStore(selectPhase)` slice — no
new subscription — through
[#758](https://github.com/pyrycode/pyrycode-desktop/issues/758), which took `phase: TurnPhase` as a
required prop from the container instead (`<InterruptControl phase={phase} />`) as one of the seven reads
that ticket moved off the flat store — see [Conversation shell § The open-conversation reader
cutover](conversation-shell.md#the-open-conversation-reader-cutover-758). Either way it derives the same
exported gate predicate:

```ts
export function isTurnRunning(phase: TurnPhase): boolean {
  return phase === 'thinking' || phase === 'responding'
}
```

Deliberately **broader** than `ThinkingIndicator`'s gate (`phase === 'thinking'` only) — a turn is
"running" in either phase, so the stop affordance must be available in both. `InterruptButton`
(exported, pure) takes `isRunning: boolean`, never `phase`, and renders `null` at idle (zero layout
footprint) or an icon-only `<button aria-label="Stop the running turn">` with an inline M3 `stop`
glyph. Activation calls `sendInterrupt({ sendCommand: window.pyry.sendCommand })`
(`src/renderer/src/screens/conversation/sendInterrupt.ts`, new) — a strict simplification of
`dropQueuedMessage.ts`: guarded `sendCommand(interruptCommand())` in a `try/catch`, `console.error`
and swallow on failure, **no local dispatch**. `window.pyry` is dereferenced only inside the click
closure, never at render.

No new client-side state represents "stopping": the control retracts when the daemon's next
`turn_state{idle}` returns `phase` to idle — through the container's own subscription since
[#758](https://github.com/pyrycode/pyrycode-desktop/issues/758), previously this component's own. The mobile Figma
file draws only the steady-send composer state (16-61) and has no stop/interrupt component in the
design system, so the button is derived from `.composer__send` plus a generic M3 `stop` glyph, kept
neutral-coloured on purpose (N/A + justification, per memory `ticket-146-interrupt-turn-split`; a
bespoke stop/error visual is a deferred follow-up flagged to Juhana).

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
- [#307 codebase notes](../codebase/307.md) — the render-affordance implementation summary:
  `isTurnRunning`, `InterruptButton`, `InterruptControl`, and `sendInterrupt.ts`. The chain's last
  slice; the #146 split is now complete.
- [Thread timeline](thread-timeline.md) — owns `TurnPhase`/`selectPhase` and the `turn_state{idle}`
  reducer arm the render affordance's retraction depends on.
- [Composer send](composer-send.md) — the sibling guarded-send/container idiom (`dropQueuedMessage`,
  `Composer.handleSubmit`) `sendInterrupt`/`InterruptControl` (#307) clone.
- Daemon twin (QMD `pyrycode-docs`): `docs/protocol-mobile.md` § interrupt; pyrycode #707 (bare
  `interrupt` → single claude Esc, `interactive`-gated, fire-and-forget,
  `TestV2Session_Interrupt_RoutesEscByCapability`).
- [Conversation shell § The open-conversation reader
  cutover](conversation-shell.md#the-open-conversation-reader-cutover-758) —
  [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758) moved `phase` from
  `InterruptControl`'s own `useTimelineStore(selectPhase)` read to a required prop from the container,
  which now derives `phase` from the open conversation's own retained timeline slice.
- [Real-claude liveness e2e](real-claude-liveness-e2e.md) / [#445 codebase notes](../codebase/445.md) —
  the tier-3 real-stack liveness net over this chain: `e2e/real-claude-interrupt.spec.ts` interrupts a
  genuinely running turn (real daemon + real claude), proving the retract-on-`turn_state{idle}` /
  clear-on-`turn_end` contract against a real turn lifecycle, not the fake-stack twins' (#307, #427)
  scripted `daemon.pushFrame`.
