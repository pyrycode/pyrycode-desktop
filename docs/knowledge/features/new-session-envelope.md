# New session envelope (outbound)

The kill-claude-and-respawn path: the wire type, the pure fail-closed transport builder, and the full
renderer→main command pathway the desktop uses to ask the daemon to discard the running claude in one
named conversation and start a fresh one. Six additive layers; nothing in the window calls it yet — the
render affordance is a sibling ticket.

Introduced in [#1217](https://github.com/pyrycode/pyrycode-desktop/issues/1217), split from
[#1087](https://github.com/pyrycode/pyrycode-desktop/issues/1087). The `new_session` twin of
[interrupt](interrupt-envelope.md), split the same way (wire+builder+command in one slice, render as a
separate ticket) but for a destructive verb rather than a benign one.

## What it does

Defines the byte-exact shape of the frame the desktop sends to the daemon to restart claude in one
conversation, and a pure function that serializes it:

- `new_session{conversation_id?}` — asks the daemon to **kill** the supervised `claude` process and
  spawn a fresh one under a newly minted session id, so every stored setting (model, effort, permission
  mode, and the per-conversation system prompt pyrycode#2094 introduces) re-applies at the spawn.

**Not a context clear.** `/clear` clears claude's context in place; the process keeps everything it holds —
loaded workspace instructions, tool servers, every setting it was spawned with. Typing `/clear` by hand is
unaffected by anything below: claude intercepts a message whose text begins with a slash and runs it
directly. The Actions menu no longer offers `/clear` as a row — as of
[#1496](https://github.com/pyrycode/pyrycode-desktop/issues/1496) the menu's **Reset session** row
dispatches this `new_session` frame directly, folded from a separate `/clear`-sending row the menu carried
until then. On the Mac the daemon's idle timeout is 0, so nothing evicts on its own — `new_session` is the
only route by which a stored per-conversation setting takes effect at all, and what lets desktop
[#1078](https://github.com/pyrycode/pyrycode-desktop/issues/1078) honestly say when a saved prompt takes
effect.

Fire-and-forget, more completely than most siblings: no nonce, no idempotency key, no correlation key,
and **no reply of any kind** — not even an error. A named id the daemon cannot act on is silently inert.
The observable effect, when there is one, arrives on the pre-existing inbound path as the
`session_transition` marker `daemonConnection.ts` already decodes and emits.

## How it works

### Wire types (`src/shared/wire/types.ts`)

```ts
export type EnvelopeType =
  | ...
  | 'interrupt'
  | 'new_session'   // sited beside 'interrupt': same daemon-side character (v2 session-manager
  |                 // intercepted before dispatch.Route, `interactive`-gated, fire-and-forget)
  | ...

export interface NewSessionPayload {
  conversation_id?: string
}
```

`conversation_id` is **optional because the daemon publishes it so** (pyrycode#2099,
`docs/protocol-mobile.md` § New session (v2)), not because this client omits it. No payload, `{}`, an
absent id and an explicitly empty one are **one wire meaning**: restart whichever conversation the
daemon's process-wide follow-active cursor points at — a cursor only a routed `send_message` stamps and
every connection shares. This app never sends that form (see § Edge cases), and the wire type stays
optional regardless — narrowing it to match this client's usage would be a wire drift (CLAUDE.md
no-drift). `types.test.ts` pins the optionality.

### The builder (`src/main/transport/newSessionEnvelope.ts`, new, MAIN-PROCESS ONLY)

```ts
export interface NewSessionInput { id: number; ts: string; conversationId: string }
export function buildNewSession(input: NewSessionInput): Uint8Array
// → Envelope{ id, type: 'new_session', ts, payload: { conversation_id: input.conversationId } }
// → encodeEnvelope(); MAY throw WireEncodeError
```

The `buildRequestModelList` shape verbatim — pure, synchronous, `id`/`ts` caller-injected, a fresh
literal naming exactly `conversation_id` (never a spread of a caller's object, so a field smuggled past
the boundary guard can't reach the wire). **`conversationId` is required on the input even though the
wire field is optional** — the safety property of this file, not an inconsistency to reconcile. The
protocol's own rule is that a client which *can* name a conversation must always name one, since the
cursor is process-wide and shared: leaving the choice to it means another device's send can move it
between the operator's click and the restart. A required input type makes the bare form unreachable at
compile time. No barrel — never re-exported through the renderer; raw bytes stay in main.

**Do not copy `buildRequestModelList`'s "an empty id is the daemon's call, not a policy this builder
pre-empts" reasoning here — it is false for this verb.** There, an unresolvable id draws one harmless
`conversation.not_found`. Here, `''` on the wire *is* the bare-form restart — the cross-conversation
misfire pyrycode#2099 exists to close, where opening chat B and restarting before sending anything to B
kills chat A mid-work. Emptiness is enforced one layer up instead (§ How it works, the command guard
below) — the builder itself stays pure and unconditional, and is simply never handed one.

### The command path (`src/shared/ipc/commands.ts`, `src/main/daemonConnection.ts`,
`src/main/connectionRegistry.ts`, `src/main/index.ts`)

```ts
// src/shared/ipc/commands.ts
export type NewSessionCommandPayload = Required<NewSessionPayload>   // { conversation_id: string }
export type RendererCommand = ... | { type: 'newSession'; payload: NewSessionCommandPayload }
export function newSessionCommand(fields: NewSessionCommandPayload): RendererCommand

function isNewSessionPayload(value: unknown): value is NewSessionCommandPayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'conversation_id' in value &&
    typeof value.conversation_id === 'string' &&
    value.conversation_id.length > 0   // the one clause every sibling guard deliberately omits
  )
}
```

`NewSessionCommandPayload` is a `Required`-derivative, the mirror image of `AnswerModalCommandPayload`'s
`Omit` in the same file: the same "derive the command payload from the wire type so it cannot drift"
idiom, tightening a field instead of excluding one. It makes `{ type: 'newSession', payload: {} }` a
compile error rather than something the runtime guard alone has to catch.

**The guard's emptiness check is the security-relevant line of this slice.** Every sibling guard in this
file (`isRequestModelListPayload`, `isDequeueMessagePayload`, …) checks type only, because for them an
empty id is merely an id the daemon cannot resolve. Here it is the bare form (see § How it works above),
so a `typeof === 'string'` check alone would let a renderer that read an id from a not-yet-loaded store
slice restart whichever conversation the daemon's cursor last pointed at — mid-work, silently. This is
belt-and-suspenders with `conversationRouter`'s `learn`, which already never indexes an empty id (so
`route('')` refuses on the ordinary unknown-conversation path today) — but that net lives in a module
whose contract is routing, not payload validity, and protects only the renderer path. The guard states
the property where it belongs: at the untrusted boundary.

```ts
// src/main/daemonConnection.ts
newSession(conversationId: string): void
// driver === null → no-op; fresh literal (never a spread); shares the one monotonic
// nextEnvelopeId with send/interrupt/requestModelList; try/catch drops the caught object
// (its message could echo the id); never throws out of the module (parity #490)

// src/main/index.ts, onCommand switch
case 'newSession': {
  const conversationId = command.payload.conversation_id
  router.route(conversationId)?.newSession(conversationId)
  return
}
```

Routed **by conversation**, not by server — `interrupt`'s optional `serverId` is not the analogue here;
`requestModelList` (#1165) is. One local read twice, so the id routed by and the id sent can never be
two different expressions. `connectionRegistry.ts`'s `viewOf` gains a one-line `newSession` delegate
(the object literal fails to typecheck without it — `ActiveConnection` is an `Omit` of the whole
interface); the member-count comment there moves from 23 to 24.

## Configuration and usage

Ships end-to-end **except the render affordance**: nothing in `src/renderer/` calls `newSessionCommand`
yet. The sibling sender ticket adds the trigger and whatever confirmation it needs before discarding a
running turn's context.

- **Producer:** none yet (sibling ticket).
- **Consumer, wired:** `main/index.ts`'s `onCommand` switch → `router.route(conversationId)?.newSession`.
  Fire-and-forget — no reply is expected; the daemon's `session_transition` marker (already decoded and
  rendered by existing machinery) is the only observable effect.

## Edge cases and limitations

- **No decode path.** The frame is outbound-only — nothing for `inboundMessage.ts` to parse.
- **A named id no connection holds, or nothing connected, sends nothing on any wire and surfaces no
  error** — the same inert posture as `dequeueMessage`/`interrupt` (AC4). `router.route(...)` returning
  `null` is the refusal; the `?.` short-circuits.
- **No retry, ever.** A restart is destructive and unacknowledged; a resend would be a second kill, not
  a second attempt at the first.
- **Zero `EnvelopeType` consumer cascade.** No production code does an exhaustive `switch` over
  `EnvelopeType`, so the new member needed no companion fix-up anywhere.
- **The wire type is optional where the guard is mandatory, and that is the design, not a mismatch.**
  Relaxing the guard to accept an absent id "to match the type" would put the bare form back on the wire
  and hand the restart to the daemon's process-wide follow-active cursor. Nothing else in this repo
  reddens on that relaxation — the guard is the only thing enforcing it.
- **Daemon-side gating is out of this client's reach by design.** The `interactive` capability gate and
  the registry validation of `conversation_id` are both daemon-side (pyrycode#2099) and not
  re-implemented here.

## Related

- [Interrupt envelope](interrupt-envelope.md) — the closest whole-slice analogue for the split shape
  (wire+builder+command in one ticket, render as a separate one), though `interrupt` is bare and
  server-routed where this frame is payload-carrying and conversation-routed.
- [Model-list wire types § Outbound ask](model-list-wire-types.md#outbound-ask-1165) /
  [Daemon connection — methods](daemon-connection-methods.md) — `requestModelList` (#1165), the actual
  routing and required-id analogue: conversation-scoped, required id, `viewOf` delegate, ships with no
  renderer sender in the ticket that declares it.
- [Command channel](command-channel.md) — the `RendererCommand`/`isRendererCommand` seam this ticket
  extends with the `newSession` member, and the one guard in that file that checks emptiness.
- [Wire codec](wire-codec.md) — `encodeEnvelope`/`WireEncodeError`, unchanged by this slice.
- Daemon twin (QMD `pyrycode-docs`): `docs/protocol-mobile.md` § New session (v2); pyrycode#2099
  (conversation-scoped `new_session`, merged 2026-09-06) and pyrycode#2094 (per-conversation system
  prompt, the setting this frame's spawn applies).
