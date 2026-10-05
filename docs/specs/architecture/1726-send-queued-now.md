# #1726 — Send now on a queued message

## Files read

- `src/shared/wire/types.ts` → `EnvelopeType`, `DequeueMessagePayload`, `SessionSettingsPayload.capabilities`, `SessionCapabilitiesPayload`: the outbound type union, the payload to mirror, and the capability subset whose doc comment lists `mid_turn_input` as not modelled.
- `src/main/transport/inboundMessage.ts` → `parseSessionCapabilities`: the decode that gains a fourth optional flag.
- `src/shared/ipc/events.ts` → the `runConfigReceived` arm: carries the flags by name across IPC.
- `src/main/daemonConnection.ts` → the `runConfigReceived` emit, `DaemonConnection.dequeueMessage` and its implementation: the emit gains one field; `sendQueuedNow` is a twin of `dequeueMessage`.
- `src/main/transport/dequeueMessageEnvelope.ts` → `buildDequeueMessage`: the builder to mirror in a sibling file.
- `src/main/connectionRegistry.ts` → the registry's forwarding object: gains `sendQueuedNow`.
- `src/main/index.ts` → the `dequeueMessage` arm of the command switch: the route to mirror.
- `src/shared/ipc/commands.ts` → `RendererCommand`, `dequeueMessageCommand`, `isRendererCommand`'s `dequeueMessage` arm, `isDequeueMessagePayload`: the command and its boundary guard.
- `src/renderer/src/store/runConfigStore.ts` → `RunConfigSnapshot`, `sessionSupports`: `sessionSupports` reads absence as supported, which is the wrong default here (the AC hides the control when the flag is absent), so the new flag gets its own opt-in selector rather than joining `SessionCapability`.
- `src/renderer/src/screens/conversation/runConfigSnapshot.ts` → `toRunConfigSnapshot`: copies a reported flag only.
- `src/renderer/src/screens/conversation/dropQueuedMessage.ts` → `dropQueuedMessage`: the injected-effects helper shape; Send now must NOT dispatch `dropUserText`.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Timeline`, `TimelineRow`, `QueuedRowDrop`, the `onDropQueued` closure at the `Timeline` mount: where the control renders and is wired.
- `src/renderer/src/screens/conversation/conversation.css` → `.queued-row__drop`: the icon-button idiom the new control shares.
- `e2e/queued-backlog-interrupt.spec.ts`, `e2e/queue-delivery-evidence.spec.ts`, `e2e/composer-actions-unavailable.spec.ts` (`sessionSettingsFrame`), `e2e/real-claude-queue-drop.spec.ts`: the fake-transport capture idiom, the session-settings reply with capabilities, and the gate-file hold for the live spec.

Overlaps: `feature/1544` touches `daemonConnection.ts` and `feature/1725` touches `ConversationScreen.tsx`; neither adds anything this design uses or rewrites the same block, so edits there stay additive.

## Design source

N/A — the ticket's `## Figma` section: the design file draws no queued state, and the control follows the drop control's icon-button idiom by decision. Message area anchor: node 132-4171. No visual check against a frame.

## Context

The daemon (pyrycode#2729/#2730) can deliver a queued message into the running Claude turn via the inbound control `send_queued_now`, and says whether a session supports it in `session_settings.capabilities.mid_turn_input`. This ticket decodes that flag and adds a Send now button on the queued row that sends the frame. No ADR needed; the "no Figma frame, drop-control idiom" decision is the documentation handoff below.

## Design

**Capability decode (opt-in, unlike #1655's flags).**
- `SessionCapabilitiesPayload.mid_turn_input?: boolean`; `parseSessionCapabilities` decodes it with the same `optionalBoolean`. Doc comment updated.
- `runConfigReceived.midTurnInput?: boolean`, emitted by name in `createDaemonConnection`.
- `RunConfigSnapshot.midTurnInput?: boolean`, copied by `toRunConfigSnapshot` only when reported.
- `selectMidTurnInputSupported(s): boolean` = `s.snapshot?.midTurnInput === true`. Not a `SessionCapability` member: `sessionSupports` reads absent as supported, the AC needs absent as unsupported.

**Outbound path (mirrors `dequeue_message`).**
- Wire: `'send_queued_now'` in `EnvelopeType`; `SendQueuedNowPayload { conversation_id: string; queued_msg_id: number }`.
- `buildSendQueuedNow(input: SendQueuedNowInput): Uint8Array` in `src/main/transport/sendQueuedNowEnvelope.ts`.
- `RendererCommand` arm `{ type: 'sendQueuedNow'; payload: SendQueuedNowPayload }`, `sendQueuedNowCommand(fields)`, and the guard arm reusing the same structural check as `isDequeueMessagePayload` via its own `isSendQueuedNowPayload`.
- `DaemonConnection.sendQueuedNow(payload): void` — inert when not connected, fresh two-field literal, never throws. Registry forwards it; `index.ts` routes by `conversation_id`.

**Renderer.**
- `sendQueuedNow(conversation_id, queued_msg_id, deps: { sendCommand })` in `sendQueuedNow.ts`: one guarded send, a bridge throw is caught and logged content-free, and NO timeline dispatch (the echo stays true; the row leaves queued treatment only on the daemon's next `queue_state`).
- `Timeline` and `TimelineRow` gain two optional props: `midTurnInput?: boolean` (show the control) and `onSendQueuedNow?: (queuedMsgId: number) => void` (enable it). `QueuedRowSendNow` renders a native `<button type="button">` with `aria-label="Send queued message now"`, `disabled={!onSendQueuedNow}`, sharing the drop control's CSS idiom. It renders only when `queued && midTurnInput`, leading the drop control.
- `ConversationScreen` reads `useRunConfigStore(selectMidTurnInputSupported)` and passes `onSendQueuedNow` under the same `actionsAvailable` gate and in-closure connected-host guard as `onDropQueued` — so "disabled under the same conditions as the drop control" holds by construction.

## State + concurrency model

No new state or async job. The flag lives in the existing run-config snapshot, cleared on conversation switch by the existing helpers. The click is fire-and-forget; the daemon's `queue_state` and user `message` push flow through existing reducers (`foldQueuedRows` and the `message_id` dedupe), unchanged.

## Error handling

- Malformed `mid_turn_input` (present, non-boolean) rejects the whole `session_settings` frame, as the other flags do.
- Over-cap or driver throw in `sendQueuedNow` on main is swallowed (parity with `dequeueMessage`).
- A renderer bridge throw is caught in the helper; the row stays queued, the window does not crash.
- A daemon no-op (idle turn, unknown id, Codex) leaves the row queued; it drains normally.

## Testing strategy

- `inboundMessage.test.ts`: `mid_turn_input` true/false decodes; absent stays undefined; non-boolean rejects.
- `daemonConnection.test.ts`: the emit carries `midTurnInput`; `sendQueuedNow` sends exactly one `send_queued_now` with the two fields only, and is inert when not connected.
- `sendQueuedNowEnvelope.test.ts`: round-trip and over-cap throw.
- `commands.test.ts`: command wraps fields; guard accepts a good payload and refuses a bad one.
- `runConfigSnapshot.test.ts` / `runConfigStore.test.ts`: copy-when-reported; selector true only for explicit `true`.
- `sendQueuedNow.test.ts`: one command sent; a throwing bridge does not propagate; no dispatch exists in deps.
- `ConversationScreen.test.tsx` (static markup): a queued row with `midTurnInput` shows the button beside the drop control; without it, the markup equals today's; disabled without `onSendQueuedNow`; a delivered row never carries it.
- `e2e/queued-send-now.spec.ts` (fake transport): the session-settings reply reports `mid_turn_input: true`; click sends exactly one `send_queued_now` with the row's ids and nothing else (no `dequeue_message`); row stays queued with both controls; a `queue_state` without it plus the user `message` push leaves exactly one row; Tab reaches the button.
- `e2e/real-claude-queue-send-now.spec.ts`: the gate-file hold, a queued marker message, Send now, release; the held turn's final text contains the marker, no second turn runs, the row loses queued treatment. Needs a `PYRY_BIN` with pyrycode#2729/#2730, so it stays pending for the dispatcher's live gate (`needs-real-claude`).

## Open Questions

- Does the daemon's user `message` push for a sent-now message carry the same `message_id` the echo holds, so the existing dedupe keeps one row? The fake spec asserts it with the same id; the live spec checks the row count.

## Documentation handoff

- Pending for the documentation stage: in `docs/knowledge/features/conversation-shell-conversation-and-modals.md`, beside the "No Figma coverage for the queued row or its drop control" paragraph, record that Send now has no separate Figma frame, that it follows the drop control's idiom by decision (#1726), and that Juhana may overrule it.

## Revisions

- 2026-10-05, Open Question resolved: the existing `message_id` dedupe keeps a sent-now message to one row when the daemon's user `message` push carries the echo's id. `e2e/queued-send-now.spec.ts` asserts it with no reducer change; the real-daemon confirmation is `e2e/real-claude-queue-send-now.spec.ts`, pending the dispatcher's live gate. No design change.
