# Interrupt envelope (outbound)

The stop-a-running-turn path, end to end: the wire type, the pure fail-closed transport builder, the
full command pathway, and the on-thread render affordance the desktop user actually clicks — the
desktop equivalent of pressing Esc at the local terminal.

Introduced in [#305](../codebase/305.md), the wire+builder base slice split from
[#146](https://github.com/pyrycode/pyrycode-desktop/issues/146) (interrupt-running-turn), slice 1 of
3 — that slice shipped **only** the wire contract and the builder, no command wiring, no
`daemonConnection` method, no renderer UI. [#306](../codebase/306.md), slice 2 of 3, wired the
**command pathway** on top of it: a bare `interrupt` `RendererCommand` member, `daemonConnection.interrupt()`,
and the main-side dispatcher arm. [#307](../codebase/307.md), slice 3 of 3, added the **render
affordance**: a standalone icon-only stop button on the conversation thread, shown only while a turn
is running, that called `interruptCommand()`. The #146 split completed there.

**[#678](https://github.com/pyrycode/pyrycode-desktop/issues/678) then moved that affordance.** #307's
standalone control is gone; the stop button is now a variant of the composer's own send button. The wire
type, the builder, and the command pathway (#305/#306) are untouched — only where the click originates
changed. See § The render affordance below for the current shape.

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

### The render affordance (#307, merged into the send button by #678)

**Originally (#307)** a standalone `InterruptControl` mounted immediately before `<Composer />`, reading
`phase` off `useTimelineStore(selectPhase)` and later (through
[#758](https://github.com/pyrycode/pyrycode-desktop/issues/758)) off a required prop from the container
instead — see [Conversation shell § The open-conversation reader
cutover](conversation-shell.md#the-open-conversation-reader-cutover-758) for that history.

**As of [#678](https://github.com/pyrycode/pyrycode-desktop/issues/678):** `InterruptControl` and
`InterruptButton`, their mount, and all five `.conversation__interrupt` / `.interrupt-button*` CSS rules
are deleted. The stop affordance is now a variant of the composer's own send button —
`ComposerSendButton`, exported from `ConversationScreen.tsx` — one component rendering send at idle and
stop while a turn is running, sharing the `.composer__send` chrome with **no** modifier class. `Composer`
takes `phase: TurnPhase` as a required prop (unchanged plumbing since #758) and derives the boolean at
render time from the same exported gate predicate #307 shipped:

```ts
export function isTurnRunning(phase: TurnPhase): boolean {
  return phase === 'thinking' || phase === 'responding'
}
```

Still deliberately **broader** than `ThinkingIndicator`'s gate (`phase === 'thinking'` only) — a turn is
"running" in either phase, so the stop affordance must be available in both. This predicate now has three
production consumers besides `ComposerSendButton`'s gate: `shouldShowThinking`, a cross-module import in
`store/conversationActivityBridge.ts`, and the tie documented at `store/conversationActivityStore.ts`.

`ComposerSendButton` takes `isRunning: boolean`, never `phase` — the same type-level guarantee
`InterruptButton` had: the view structurally cannot render a daemon-supplied string because it never
receives one. Unlike `InterruptButton`, it **never returns `null`** — the composer row holds exactly one
button in every state, which is what makes "exactly one stop affordance renders" structural rather than a
convention; a second one cannot be stacked above it. `isRunning` and `canSend` are separate booleans and
only `canSend` gates: the stop variant is never disabled, #307's behaviour preserved verbatim, because a
turn can be running while the session is disconnected, and disabling stop there would hide the only
interrupt affordance exactly when an operator most wants to try it.

Activation still calls `sendInterrupt({ sendCommand: window.pyry.sendCommand })`
(`src/renderer/src/screens/conversation/sendInterrupt.ts`, untouched by #678) — bound as an inline arrow
at the `ComposerSendButton` call site so `window.pyry` is dereferenced only inside the click closure,
never during render; hoisting it would break every container smoke test under `renderToStaticMarkup`.

No new client-side state represents "stopping": the button reverts to send when the daemon's next
`turn_state{idle}` returns `phase` to idle and the live subscription re-renders — the same retraction
path #307 had, now read one level up in `Composer` rather than in a standalone control.

**The glyph is now Figma-sourced.** The mobile Figma file used to draw only the steady-send composer
state (16-61) with no stop/interrupt component in the design system, so #307 derived a generic M3 `stop`
glyph (a bare filled square) kept neutral-coloured for lack of a design. That gap closed when Figma node
`114:3549` shipped a "Stop" variant of the send button; #678 took its glyph — `114:3552`'s
`circle-stop-solid-full`, exported verbatim at 28×28, `fill="currentColor"` — replacing the improvised
square. The exported path is two subpaths (a disc, a rounded square wound the *opposite* way) relying on
the nonzero fill rule to knock the square out into a hole; nothing in the markup declares this, and
reversing either subpath's winding silently yields a solid disc that still renders and still passes every
markup assertion, failing only visually. **Do not "tidy" either subpath's direction.**

**Colour and container are still a deliberate deviation, not yet closed.** Figma paints both variants'
glyphs `--color-primary` on an M3 standard icon button whose container is invisible at rest; both
variants here keep `currentColor` (`--color-on-surface`) on the permanent `--color-surface-container-high`
pill, because re-theming only the stop half would fork the two variants of the control #678 exists to
merge, and the ticket froze the send variant's theming. The full re-theme — both glyphs to
`--color-primary`, the send glyph to `circle-chevron-up-solid-full`, the pill dropped to a hover/focus-only
container — is one coherent follow-up, open as of #678 and needing a design ruling on whether the
always-visible container is a deliberate desktop divergence before it is filed.

**One accepted behavioural consequence, not a defect** (code review, PR #804): because the stop variant is
never disabled, a stray second activation now interrupts the turn the first one started, where under
#307's separate standalone control it would have landed on a still-Send button and done nothing. The
window is narrow — the daemon-owned phase gate means the stop variant doesn't arm until
`turn_state{thinking}` lands, so [#650](conversation-shell.md)'s local send window is still a Send
affordance — and `sendInterrupt` against an already-ended turn is a harmless no-op. No guard was added
without an observed failure.

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
- **Auditing e2e `Send`-click sites for a running-turn hazard: check `phase` at that line, not send
  cadence.** `#678`'s move made every `getByRole('button', { name: 'Send' })` click a potential hang if it
  fires while `phase` is running (the button is the stop affordance then, and no `Send` locator exists on
  screen). "Does this spec wait for the turn to quiesce between two sends" is the right question for a
  spec that starts and finishes a turn via a click, but it misses a spec that pushes
  `turn_state{thinking}` as pure fixture scaffolding (e.g. to mount a working indicator for an unrelated
  assertion) without ever starting or ending that turn through the UI —
  `e2e/thread-scroll-pin.spec.ts` did exactly this and was missed by #678's own architecture-spec audit,
  caught only in code review (PR #804). The correct predicate is "what is `phase` at this line."

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
- [#307 codebase notes](../codebase/307.md) — the original render-affordance implementation summary:
  `isTurnRunning`, `InterruptButton`, `InterruptControl`, and `sendInterrupt.ts`. `InterruptButton` /
  `InterruptControl` were deleted by #678 (see § The render affordance above); `isTurnRunning` and
  `sendInterrupt.ts` survive unchanged.
- [Thread timeline](thread-timeline.md) — owns `TurnPhase`/`selectPhase` and the `turn_state{idle}`
  reducer arm the render affordance's retraction depends on.
- [Composer send](composer-send.md) — since [#678](https://github.com/pyrycode/pyrycode-desktop/issues/678),
  no longer a sibling: `ComposerSendButton` lives inside `Composer` itself, one component rendering that
  page's send affordance and this page's stop affordance as two variants of the same control.
- Daemon twin (QMD `pyrycode-docs`): `docs/protocol-mobile.md` § interrupt; pyrycode #707 (bare
  `interrupt` → single claude Esc, `interactive`-gated, fire-and-forget,
  `TestV2Session_Interrupt_RoutesEscByCapability`).
- [Conversation shell § The open-conversation reader
  cutover](conversation-shell.md#the-open-conversation-reader-cutover-758) —
  [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758) moved `phase` from
  `InterruptControl`'s own `useTimelineStore(selectPhase)` read to a required prop from the container,
  which derives `phase` from the open conversation's own retained timeline slice; that same prop now
  reaches `Composer` (`InterruptControl` itself is gone as of #678).
- [#678](https://github.com/pyrycode/pyrycode-desktop/issues/678) — moved the render affordance from
  #307's standalone `InterruptControl` into a stop variant of `ComposerSendButton`, the composer's own
  send button. Net-negative diff: deletes `InterruptButton`/`InterruptControl`, their mount, and five CSS
  rules; adds one two-variant component. `sendInterrupt.ts`, the wire type, and the command pathway
  (#305/#306) are untouched. See § The render affordance above.
- [Real-claude liveness e2e](real-claude-liveness-e2e.md) / [#445 codebase notes](../codebase/445.md) —
  the tier-3 real-stack liveness net over this chain: `e2e/real-claude-interrupt.spec.ts` interrupts a
  genuinely running turn (real daemon + real claude), proving the retract-on-`turn_state{idle}` /
  clear-on-`turn_end` contract against a real turn lifecycle, not the fake-stack twins' (#307, #427)
  scripted `daemon.pushFrame`.
