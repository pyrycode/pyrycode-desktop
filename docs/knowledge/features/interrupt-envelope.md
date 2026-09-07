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

**[#1092](https://github.com/pyrycode/pyrycode-desktop/issues/1092) then named the conversation.** The
frame was bare from #305 through #1120: the daemon stopped whichever conversation its process-wide
follow-active cursor pointed at — the last one any client routed a message to — so Stop on one chat could
silently kill another's turn. pyrycode#2103 published an optional `conversation_id` on `interrupt`,
validated against the daemon's registry, with the absent form kept as the pre-#2103 compatibility promise.
\#1092 threads it end to end, mirroring the `new_session` twin (#1217/#1218) at every layer, and re-routes
the command from #1120's server-scoped path onto #1118's conversation-to-server index — see § Naming the
conversation (#1092) below for the current shape. The historical "bare, no payload" description below is
what #305/#306/#307/#678 shipped; it no longer describes what this client sends.

## What it does

Defines the shape of the control frame the desktop sends to the daemon to stop the current turn, and the
pure function that serializes it:

- `interrupt` — as of #1092, carries the open conversation's `conversation_id` and nothing else: no
  nonce, no answer token, no idempotency key. The daemon validates the id against its registry and maps
  the frame to a single Esc keystroke into that conversation's supervised `claude`, stopping its current
  turn (daemon SSOT pyrycode #707, widened by pyrycode#2103). The wire field itself stays **optional** —
  the absent form is the pre-#2103 compatibility promise for a client that cannot name a conversation —
  but this app always can, so it always sends one; see § Naming the conversation (#1092).

Unlike the [modal resolution envelope](modal-resolution-envelope.md)'s `modal_answer`, this frame
carries no correlation state at all — not even the ungated-but-payload-bearing shape of
[`dequeue_message`](dequeue-message-envelope.md). It is **fire-and-forget by construction**: a replayed
`interrupt` is a benign extra Esc, and an Esc with no running turn is a no-op in `claude`, so no
nonce or dedup key is needed (#707) — naming the conversation didn't change this, since the id is a
routing address, not a correlation token. The daemon does not `ack` an `interrupt`; the turn-stopped
signal reaches the desktop through the existing interactive stream (`turn_state{idle}` / `turn_end`),
never as a reply correlated to this frame. The daemon routes it to an Esc only for a connection that
negotiated the `interactive` capability — the desktop already advertises it (#179) — and that gate is
entirely daemon-side; the builder does nothing about it.

## How it works

### Wire types (`src/shared/wire/types.ts`)

```ts
export type EnvelopeType =
  | ...
  | 'dequeue_message'
  // v2-only phone→binary control frame — maps to a single claude Esc (stops the current turn) in
  // the conversation `conversation_id` names. daemon-gated on the `interactive` capability;
  // fire-and-forget (no reply). The field is OPTIONAL because absent is the pre-#2103 compatibility
  // promise (the daemon's process-wide follow-active cursor); a client that can name a conversation
  // should always name one (#1092). SSOT pyrycode #707, widened pyrycode#2103.
  | 'interrupt'
  | ...

export interface InterruptPayload {
  conversation_id?: string
}
```

**Until [#1092](https://github.com/pyrycode/pyrycode-desktop/issues/1092), no payload interface existed
for `interrupt`** — deliberately (#305's AC5), because the frame was bare. `InterruptPayload` is now
sited beside `NewSessionPayload` for the same reason that one is optional: it answers to the daemon,
which publishes the field optional so pre-#2103 clients keep working. Tightening it here would be a wire
drift (CLAUDE.md no-drift) — the tightening happens one layer up, in the command payload.

### The command (`src/shared/ipc/commands.ts`)

`InterruptCommandPayload = Required<InterruptPayload>` — the `NewSessionCommandPayload` idiom: derive
from the wire type so the two cannot drift, tightening the one field rather than excluding one. A frame
naming nothing is unreachable by construction: `interruptCommand(fields: InterruptCommandPayload)`
replaced #306's zero-arg constructor, and `isInterruptPayload` — co-located with
`isNewSessionPayload`, whose `''`-refusal rationale it repeats word for word — refuses a missing key,
`null`, an explicitly-`undefined` payload, a non-string id, and `''`. `''` is the one that matters here:
the protocol gives no payload, `{}`, an absent id and an explicitly empty one one wire meaning, so
`isInterruptPayload` is what turns a wrong-chat Stop into a Stop that does nothing rather than a
cross-conversation misfire. See [Command channel](command-channel.md) for the union member's full
growth-log entry.

### The builder (`src/main/transport/interruptEnvelope.ts`, MAIN-PROCESS ONLY)

```ts
export interface InterruptInput { id: number; ts: string; conversationId: string }
export function buildInterrupt(input: InterruptInput): Uint8Array
// → Envelope{ id, type: 'interrupt', ts, payload: { conversation_id: input.conversationId } }
//   → encodeEnvelope(); MAY throw WireEncodeError
```

Until #1092 this was a structural clone of `buildRequestDebugBundle` / `buildListConversations` — the
module's **bare**-frame builders. #1092 gave `InterruptInput` a **required** `conversationId` and made
`buildInterrupt` rebuild a **fresh literal** — never a spread of caller input — so a field smuggled past
`isInterruptPayload`'s structural-minimum guard is dropped rather than sent; the module header and this
docblock were rewritten rather than patched, since the old "no payload struct, no conversation_id"
framing is now false. Pure, synchronous, caller-injects `id`/`ts`/`conversationId` (no clock/counter
read, no side effects). `encodeEnvelope` throws `WireEncodeError` above `MAX_PLAINTEXT_BYTES`;
unreachable in practice for a fixed-shape ~60-byte envelope, but the builder propagates it unchanged for
symmetry with every sibling builder. No barrel — never re-exported through the renderer; raw bytes stay
in main. `buildRequestDebugBundle` is now the module's sole present-but-empty-`payload: {}` builder — its
own docblock carries the "why `{}` and not an omitted/`null` payload" rationale this file used to cite
`buildInterrupt` for (corrected during #1092's stale-prose sweep, since `interrupt` stopped being bare).

## Configuration and usage

[#306](../codebase/306.md) added `daemonConnection.interrupt(): void` (no payload arg, since the frame
was nullary — the `driver === null` inert-when-disconnected twin of `requestConversations`) plus a bare
`{ type: 'interrupt' }` `RendererCommand` member and its `interruptCommand()` factory, routed through
`main/index.ts`'s `onCommand` switch. [#1120](https://github.com/pyrycode/pyrycode-desktop/issues/1120)
later gave the command an optional `serverId`, since a bare frame carried no id of its own to route by,
and dispatched it through `serverRouter.ts` — the same path as the other server-scoped commands. See
[Daemon connection — routing § Server-scoped command routing (#1120)](daemon-connection-server-scoped-routing.md).

### Naming the conversation (#1092)

[#1092](https://github.com/pyrycode/pyrycode-desktop/issues/1092) widened the connection method to
`daemonConnection.interrupt(conversationId: string): void` — a required scalar, like `newSession` and
`requestModelList` and unlike the payload-bearing `dequeueMessage` — and re-routed the command off
`serverId` entirely: `serverRouter.ts`'s header now records `interrupt` as a member that **left** its
server-scoped set, the only one #1120 shipped with. Once the payload names a conversation, a server id
beside it is a second address free to disagree with the first, so the dispatch arm in `main/index.ts`
became the `newSession` arm's shape — one local read twice, so the id routed by and the id sent cannot
diverge:

```ts
const conversationId = command.payload.conversation_id
router.route(conversationId)?.interrupt(conversationId)
```

`router` is [#1118's conversation-to-server index](daemon-connection-conversation-routing.md) (`conversationRouter.ts`)
— learned off stamped daemon events, refused if never seen, never falling through to another connection.
The `?.` is the whole of the inert-no-op path for an id no connection holds: no frame, no error, no
crash. `connectionRegistry.ts`'s `viewOf` forwards the argument through unchanged.

The renderer helper, `sendInterrupt(conversationId: string | null, deps)`
(`src/renderer/src/screens/conversation/sendInterrupt.ts`), refuses both `null` (the composer footer with
no conversation open) and `''` (`sendNewSession`'s posture, copied verbatim) before ever constructing a
command — the boundary guard (`isInterruptPayload`) stays load-bearing regardless, as defence in depth at
the untrusted IPC hop. Both call sites inside `Composer` — the Escape branch of `handleKeyDown` (#1072)
and `ComposerSendButton`'s `onInterrupt` — pass the same `activeConversationId` expression the send path
and `startNewSession` already read, which is what stops the three ever naming different chats. No
preload change: the generic `sendCommand(command: RendererCommand)` pipe already carries the widened
member.

### The render affordance (#307, merged into the send button by #678)

**Originally (#307)** a standalone `InterruptControl` mounted immediately before `<Composer />`, reading
`phase` off `useTimelineStore(selectPhase)` and later (through
[#758](https://github.com/pyrycode/pyrycode-desktop/issues/758)) off a required prop from the container
instead — see [Conversation shell § The open-conversation reader
cutover](conversation-shell-actions-menu-and-reader-cutover.md#the-open-conversation-reader-cutover-758) for that history.

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

**Since [#1072](https://github.com/pyrycode/pyrycode-desktop/issues/1072), a click is not the only route
to `sendInterrupt`.** Escape reaches it too, from two points inside the composer: `Composer`'s own
`handleKeyDown` (see [Composer send § 7](composer-send.md#7-keystroke-intent-gates--shouldsubmitonkeydown-512-and-shouldinterruptonkeydown-1072))
when the caret is in the message box, and a new `onKeyDown` on `ComposerSendButton`'s running variant
itself, for the state a mouse send actually leaves the operator in.

The second binding exists because of a fact worth stating plainly: Chromium focuses a `<button>` on
click, and nothing in `handleSubmit` moves focus back — it only clears the text. After a mouse send,
focus sits on the send control, and that control is what *becomes* the stop control: both variants
render a `<button>` at the same position in the same parent, so React patches the node in place rather
than remounting, and focus survives the flip. Without a handler on that node, Escape would do nothing in
exactly the state an operator reaches most often — right after clicking Send. The two variants sharing
one DOM node was already true before #1072 (it's what makes the send↔stop swap visually seamless); #1072
is what makes it load-bearing for the keyboard too. A future change giving the two variants different
wrappers or a React `key` would silently break the keyboard path, with no markup assertion moving to
catch it.

The running variant's `onKeyDown` asks the same `shouldInterruptOnKeyDown` predicate with `turnRunning`
passed as a literal `true`, not read from a prop — this element exists only inside the `isRunning`
branch, so the value is true by construction; it is still asked, so a future change to the key or the
composing rule lands on both bindings at once. It calls the existing `onInterrupt` prop, not
`sendInterrupt` directly: this view still never touches `window.pyry`, the same "a view that cannot
answer is a bug" property the click handler above already had.

**No ordering coordination was needed against the screen's seven other Escape claimants** (the channel
info sheet, the thread overflow menu, the background task panel, the workspace picker, the
default-workspace sheet, the four footer menus behind `ComposerOptionsMenu`, and the slash type-ahead) —
**and the reason is not a focus trap, precisely stated.** No surface calls `.focus()` when it opens; what
actually holds is that the click that opens each one leaves focus on that surface's own trigger
`<button>`, so while one is open, neither composer binding is on the keydown's path at all. Operationally
identical to a focus trap for the two states this ticket covers, but worth the distinction: a surface
opened by some future route other than a click (a keyboard shortcut, say) would not inherit this property
for free, and would need its own check.

A `document`-level interrupt listener was considered and rejected for a reason worth recording precisely,
because the ticket's own stated reasoning for rejecting it was subtly wrong: "`document` listeners fire
in attach order" is true only **among listeners on the same node**. React 18 delegates its handlers from
the root container, which itself lives inside `document`, so the real bubble path is target → root
container → document — a `document`-level listener necessarily runs *after* every React handler on the
way up, never before it. The five `document`-listener dismissals above are mount-gated regardless (each
attaches on mount, detaches on cleanup, and mounts only while its surface is open), so this was never
load-bearing for #1072 — but it matters for a future change widening Escape's reach to the whole window:
the real constraint is listener order on one node, not attach order across the React/DOM boundary.

**The glyph is now Figma-sourced.** The mobile Figma file used to draw only the steady-send composer
state (16-61) with no stop/interrupt component in the design system, so #307 derived a generic M3 `stop`
glyph (a bare filled square) kept neutral-coloured for lack of a design. That gap closed when Figma node
`114:3549` shipped a "Stop" variant of the send button; #678 took its glyph — `114:3552`'s
`circle-stop-solid-full`, exported verbatim at 28×28, `fill="currentColor"` — replacing the improvised
square. The exported path is two subpaths (a disc, a rounded square wound the *opposite* way) relying on
the nonzero fill rule to knock the square out into a hole; nothing in the markup declares this, and
reversing either subpath's winding silently yields a solid disc that still renders and still passes every
markup assertion, failing only visually. **Do not "tidy" either subpath's direction.**

**Colour and container closed, together with the box redraw.** The re-theme #678 deferred — both glyphs
to `--color-primary`, the send glyph to `circle-chevron-up-solid-full`, the pill dropped to a
hover/focus-only container — shipped in the redraw of the message box itself
([Conversation shell — composer § Message box](conversation-shell-composer-message-box.md#message-box-951)), because
in the drawing the control lives *inside* the box. Both variants now render `fill="currentColor"` at
28×28 on a `background: none` control whose colour is `--color-primary`, with a
`--color-surface-container` step on hover — the M3 icon button's own always-invisible-at-rest posture,
not a desktop divergence.

**One accepted behavioural consequence, not a defect** (code review, PR #804): because the stop variant is
never disabled, a stray second activation now interrupts the turn the first one started, where under
\#307's separate standalone control it would have landed on a still-Send button and done nothing. The
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
- **Ungated on token or nonce, and lower-severity than `dequeue_message`, but no longer payload-free at
  the boundary.** Until #1092, the frame had no payload for `isRendererCommand` to validate beyond the
  `type` discriminant; `isInterruptPayload` now checks the `conversation_id`'s presence, type and
  non-emptiness, with no length cap (deliberately matching `isNewSessionPayload` exactly). The id is
  client-owned (this app's own conversation state, not network input) and reaches exactly two sinks:
  `conversationRouter.route`, a read-only `Map` lookup (no prototype chain for an untrusted key to
  reach), and `buildInterrupt`'s fresh-literal rebuild. The daemon-side `interactive` gate (already
  satisfied via #179) is unchanged. A compromised renderer's worst case is still self-inflicted — it can
  now *address* any conversation to interrupt rather than only whichever the daemon's cursor pointed at,
  but not a privilege widening: that same renderer already holds `sendMessage` for any conversation, and
  a routed send is exactly what stamps the cursor, so the two-frame dance was always available to a
  compromised renderer (architect security review, #305/#306 and #1092, all PASS).
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
- **A real-claude gate can gain a second job with no line of its drive changing (#1092).** A wrong
  `conversation_id` is silently inert daemon-side — no stop, no reply, no error — so it passes every
  fake-tier assertion, which reads the captured frame and cannot ask the daemon whether it resolved.
  `e2e/real-claude-interrupt.spec.ts`'s pre-existing quiesce gate (`interruptButton` /
  `CURSOR_SELECTOR` → `toHaveCount(0)`) is now the only place in the repo where a wrong id is
  observable, so a timeout there must be read as "the daemon did not resolve the id" before it is read
  as flake. The spec cannot discriminate the named path from the bare one within its own timeout — that
  needs a second conversation messaged to move the daemon's cursor, i.e. two real claude turns inside
  one spec timeout — so this was declined deliberately rather than by omission; the by-construction
  coverage (the client only ever sends the named form) is what the AC asked for instead.
- **A drive proving two independent keyboard bindings needs two independent mutations, not one**
  ([#1072](https://github.com/pyrycode/pyrycode-desktop/issues/1072)). `e2e/escape-interrupt.spec.ts`'s
  four legs pass green whether one binding exists or both do; disabling either one alone — the message
  box's branch in `handleKeyDown`, or the stop control's own `onKeyDown` — reddens exactly one leg while
  the rest of the drive stays green. A single "does Escape stop the turn at all" mutation would have
  proven only that *something* carried the keystroke, not which of the two claimed routes actually did.

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
  cutover](conversation-shell-actions-menu-and-reader-cutover.md#the-open-conversation-reader-cutover-758) —
  [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758) moved `phase` from
  `InterruptControl`'s own `useTimelineStore(selectPhase)` read to a required prop from the container,
  which derives `phase` from the open conversation's own retained timeline slice; that same prop now
  reaches `Composer` (`InterruptControl` itself is gone as of #678).
- [#678](https://github.com/pyrycode/pyrycode-desktop/issues/678) — moved the render affordance from
  #307's standalone `InterruptControl` into a stop variant of `ComposerSendButton`, the composer's own
  send button. Net-negative diff: deletes `InterruptButton`/`InterruptControl`, their mount, and five CSS
  rules; adds one two-variant component. `sendInterrupt.ts`, the wire type, and the command pathway
  (#305/#306) are untouched. See § The render affordance above.
- [#1072](https://github.com/pyrycode/pyrycode-desktop/issues/1072) — Escape stops the running turn from
  the keyboard: `shouldInterruptOnKeyDown` in [Composer send § 7](composer-send.md#7-keystroke-intent-gates--shouldsubmitonkeydown-512-and-shouldinterruptonkeydown-1072),
  bound in `Composer`'s `handleKeyDown` and, for the mouse-send-then-Escape path, on
  `ComposerSendButton`'s running variant itself — see § The render affordance above. `sendInterrupt`,
  the wire type, and the command pathway are all unchanged; this ticket gives `sendInterrupt` two more
  callers only.
- [Real-claude liveness e2e](real-claude-liveness-e2e.md) / [#445 codebase notes](../codebase/445.md) —
  the tier-3 real-stack liveness net over this chain: `e2e/real-claude-interrupt.spec.ts` interrupts a
  genuinely running turn (real daemon + real claude), proving the retract-on-`turn_state{idle}` /
  clear-on-`turn_end` contract against a real turn lifecycle, not the fake-stack twins' (#307, #427)
  scripted `daemon.pushFrame`.
- [#1092](https://github.com/pyrycode/pyrycode-desktop/issues/1092) — named the conversation on the
  wire and re-routed the command from #1120's server-scoped path onto #1118's conversation-to-server
  index; see § Naming the conversation (#1092) above. [New session envelope](new-session-envelope.md) /
  [#1217](https://github.com/pyrycode/pyrycode-desktop/issues/1217) is the twin this ticket mirrors at
  every layer. [Daemon connection — routing](daemon-connection-routing.md) § Server-scoped command
  routing (#1120) records `interrupt` as the one member that later left that set.
