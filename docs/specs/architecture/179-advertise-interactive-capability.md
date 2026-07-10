# Spec #179 — Advertise the `interactive` capability + cut the thread over to the timeline

**Ticket:** pyrycode-desktop#179 · **Size:** S · **Security-sensitive:** yes (client hello is Noise early-data carrying the device token; advertising `interactive` widens the daemon's accepted inbound control-verb surface on the internet-exposed path)

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8

Conversation Thread Screen: one continuous scrollable thread above a pinned composer. The right-aligned user bubble (node 16-22 → 16-23) is the primary-container treatment (`#cfe4ff` bg / `#134a74` text, radius TL/TR/BL 20 · BR 6, body-medium) — **identical to the existing `.message-row--user` / `.bubble--user` CSS the coarse `MessageThread` already renders**, so the new `userText` timeline row reuses that treatment verbatim (no new tokens). Left-aligned assistant bubbles with the streaming cursor (16-56) and the compact tool row (16-28) are already rendered by `Timeline` (#203/#218/#230). This ticket's only new visual is routing the user bubble through the timeline.

## Files to read first

- `src/main/daemonConnection.ts:460-502` — `loadDialConfig`; the `buildClientHello({...})` call at :465 that omits `capabilities`. **The one-line flip goes here.**
- `src/shared/wire/types.ts:14` — `export const CAPABILITY_INTERACTIVE = 'interactive' as const`. **Use this constant in the flip, never a bare `'interactive'` literal.**
- `src/main/transport/helloExchange.ts:23-61` — `ClientHelloInput.capabilities` is already an optional arg (defaults to codec `[]`); `buildClientHello` threads it through. No change here — the flip is at the call site.
- `src/main/transport/helloExchange.ts:79-113` — `parseHelloAck` already narrows `hello_ack.capabilities` onto the typed `HelloAckPayload`. **AC2 is already wired**: the accepted set flows through `connected{ack}` untouched.
- `src/main/daemonConnection.ts:263-275` — the `handshake-complete` → `parseHelloAck` → `emitDaemonEvent(connected{ack})` path. Confirms the ack (incl. `capabilities`) is already surfaced on `connected`.
- `src/renderer/src/screens/conversation/composerSend.ts:18-68` — `ComposerSendDeps` + `submitMessage`. **The echo retarget lives here**: `dispatch` changes from `SessionAction`→`ThreadEvent`; the echo becomes a `userText` event.
- `src/renderer/src/store/threadTimeline.ts:39,54-56,159-165` — the `userText` `ThreadItem`, `ThreadEvent`, and reducer arm shipped dormant by #245. **The producer this ticket wires; the reducer/model needs no change.**
- `src/renderer/src/store/timelineStore.ts:24-47` — `timelineStore.dispatch` / `useTimelineStore`; the echo's new write path (mirrors the composer's current `useSessionStore((s) => s.dispatch)`).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:40-90` — the container; remove the `MessageThread` mount (:66) + `selectMessages` read (:44), retarget the `Composer`'s dispatch (:332,:346).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:104-112` — `MessageBubble` markup: the user-bubble shape the new `userText` row mirrors.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:149-214` — `TimelineRow`; **replace the `case 'userText': return null` placeholder (:207-213)** with the user bubble.
- `src/renderer/src/screens/conversation/conversation.css:136-170` — `.message-row` / `.message-row--user` / `.bubble--user`; the treatment to reuse. **No CSS change needed.**
- `src/renderer/src/store/timelineBridge.ts` (whole) — the `DaemonEvent`→`ThreadEvent`→`timelineStore` path, mounted app-level via `useTimelineBridge` (`App.tsx:53`). AC5 drives events through `subscribeTimeline`. No change.
- `src/renderer/src/store/modalBridge.ts:88-95` (`subscribeModal`) + `src/renderer/src/screens/conversation/PermissionModal.tsx` — the `modal_shown`→`modalStore`→answerable-dialog path. AC5's modal leg. No change.
- **Test seams:** `src/main/daemonConnection.test.ts:339-350` (hello decode) and `:328-337` (connected ack); `src/renderer/src/screens/conversation/composerSend.test.ts:48-115` (echo tests to rewrite); `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:70-283` (Timeline render tests to extend).
- `docs/knowledge/decisions/0008` (ADR — timeline model / Strangler Fig) — the render-state architecture this cutover completes.

## Context

`interactive` is the only capability string in the vocabulary (`CAPABILITY_INTERACTIVE`), so advertising it turns on the daemon's entire paired-interactive surface: the structured event stream (turn state, text deltas, tool-use/result, thinking), the `modal_shown` permission prompts, and the inbound control verbs. The daemon gates all of it on a per-connection flag set from the hello negotiation (verified daemon-side; the daemon echoes the **intersection** of advertised ∩ supported in `hello_ack.capabilities`, never a blind mirror). The desktop withheld it by sending `capabilities: []` because the renderer for the structured stream didn't exist — advertising it would blank the thread.

That renderer now exists and is **mounted app-level**: `useTimelineBridge` / `useModalBridge` (`App.tsx:48-58`) fold decoded `DaemonEvent`s into `timelineStore` / `modalStore`, and `Timeline` / `ThinkingIndicator` / `PermissionModal` render them. The pipeline is dormant only because `interactive` isn't advertised — the daemon sends the coarse `message` fan-out instead. Advertising it stops that fan-out (daemon-side, pyrycode #699) and streams structured events the mounted pipeline already draws.

**The weight: the coarse→structured cutover.** Today the user's optimistic echo renders via the coarse `MessageThread` (from `sessionStore`), while daemon replies stream to the `Timeline` (from `timelineStore`). The instant `interactive` is advertised the coarse fan-out dies, so `MessageThread` goes empty and the thread splits — user messages in one region, assistant content in another. The flip and the cutover **must land in one commit**. So this ticket: (1) flips the flag, (2) routes the composer echo into the timeline as the `userText` item (#245), (3) draws the `userText` row, (4) retires the `MessageThread` mount — leaving the timeline the single thread surface. No blank thread, no lost messages, no split-brain.

Live real-daemon verification (pair → send → structured reply, twice) is the separate e2e #178. This ticket verifies the transition at the fake-daemon / test level.

## Design

Three production edits. Zero new files, zero new exported types (the `userText` `ThreadItem`/`ThreadEvent` already exist from #245).

### 1. The flip — `daemonConnection.ts` (AC1, AC2)

In `loadDialConfig`, add one field to the existing `buildClientHello` call:

```ts
const hello = buildClientHello({
  id: 1, ts: now(), deviceName, clientVersion, token: record.token,
  capabilities: [CAPABILITY_INTERACTIVE]        // ← the flip; import from ../shared/wire/types
})
```

- Import `CAPABILITY_INTERACTIVE` from `../shared/wire/types` (main/preload have no `@shared` alias — use the relative path, matching this module's existing `../../shared/wire/types` imports).
- **No cascade risk:** `makeHelloClientPayload` (`codec.ts`) and `buildClientHello` keep their `[]` default — only this production call site changes. The default-focused tests (`codec.test.ts:229-251`, `helloExchange.test.ts:41-49`) stay green because they test the *default*, which is unchanged.
- **AC2 needs no production change.** `parseHelloAck` already surfaces `capabilities` onto `HelloAckPayload`, and `connected{ack}` already carries it (`daemonConnection.ts:263-275`, `sessionStore` `ConnectionStatus.connected` holds `ack`). AC2 is a *verification* AC — assert it in tests.

### 2. Retarget the echo — `composerSend.ts` (AC3)

`submitMessage` keeps its wire-send half unchanged (still mints a `message_id` for the `SendMessagePayload`, still guards the `sendCommand`), but the optimistic echo changes target:

- `ComposerSendDeps.dispatch` becomes `(event: ThreadEvent) => void` (was `(action: SessionAction) => void`). Import `ThreadEvent` from `../../store/threadTimeline`; drop the `SessionAction` import.
- The echo dispatch becomes `deps.dispatch({ type: 'userText', text: trimmed })` — the whole-message tail-append the #245 reducer arm folds. No `message_id`, `conversation_id`, or `role` on the timeline echo (the `userText` model carries only `text`).
- The `message_id` is still minted for the **wire** command only. The old "reuse the id for wire + echo so the daemon's re-echo dedupes" rationale is **retired** (see "Dedup" below) — update the doc comment accordingly.
- `MILESTONE_CONVERSATION_ID`, the whitespace guard, the AC4 send-failure swallow, and the `boolean` return are all unchanged.

**Dedup — retired, verified.** In coarse mode the daemon re-echoed the user turn as a `message` envelope, deduped by `message_id` in `sessionStore.appendUnique`. In interactive mode there is **no** structured event carrying the user's own message: the `DaemonEvent` union has no user-message arm (`events.ts:60-128`), and the coarse `message` fan-out is off (#699). So the optimistic `userText` echo is the sole source of the user message — it renders exactly once with **no dedup key needed**. The `userText` reducer arm is an unconditional tail-append, which is correct precisely because nothing else emits it.

### 3. The render cutover — `ConversationScreen.tsx` (AC3, AC4)

**Retire `MessageThread` (minimal, Strangler-Fig residue):**
- Delete the mount `<MessageThread messages={messages} />` (:66) and the `const messages = useSessionStore(selectMessages).map(toMessageViewModel)` read (:44).
- Drop the now-unused imports `selectMessages` and `toMessageViewModel`. **Keep** the `type Message` import and the exported `MessageThread` / `MessageBubble` pure components — they and their tests stay as dead-but-tested residue (do **not** delete them or their `describe`; that cleanup is a later ticket). Keep `sessionStore.messages` / `messageSent` / `selectMessages` untouched in the store. **Do not widen scope.**

**Draw the `userText` row** — replace the `case 'userText': return null` placeholder (:207-213) with the right-aligned user bubble, mirroring `MessageBubble` but using the timeline's role attribute:

```tsx
case 'userText':
  return (
    <div className="message-row message-row--user">
      <div className="bubble bubble--user" data-thread-role="user">
        {item.text}
      </div>
    </div>
  )
```

- Text as auto-escaped React children — **never** `dangerouslySetInnerHTML`.
- `data-thread-role="user"` mirrors the timeline scheme (`assistant`/`tool` → now `user`); distinct from `MessageBubble`'s `data-message-role` so the two test-count seams don't collide.
- Reuses `.message-row--user` (right-align) + `.bubble--user` (primary-container) — no CSS change.
- The switch stays exhaustive over all four `kind`s; keep the no-`default` tripwire (a future 5th kind stays a compile error).

**Retarget the `Composer`'s dispatch:**
- Change `const dispatch = useSessionStore((s) => s.dispatch)` (:332) to `const dispatch = useTimelineStore((s) => s.dispatch)` (`useTimelineStore` is already imported at :10).
- The `submitMessage(text, { sendCommand, dispatch, newMessageId })` call (:346) is otherwise unchanged; `dispatch` now writes the `userText` event into `timelineStore`.
- The `Composer` keeps `useSessionStore(selectStatus)` for `composerAvailability` — the send gate still reads the session's connection status. Two stores in one component is fine (status vs. content are orthogonal facets).

### Ordering & cursor correctness (AC3)

Both the echo and the daemon stream write the single ordered `timelineStore.items` array, so arrival order is preserved: `[userText, assistantText(coalesced), toolCall(resolved), turnBoundary, …]`. `appendDelta`'s tail-check won't coalesce an `assistantDelta` into a preceding `userText` tail (different kind) → a fresh assistant bubble follows the user bubble. `Timeline`'s cursor rule (`index === lastIndex && kind === 'assistantText'`) already excludes `userText`, so no cursor draws on the user bubble; the streaming cursor still trails only the open assistant tail. The existing `Timeline` logic needs no change.

## State + concurrency model

- **Stores:** unchanged shapes. The composer echo moves from `sessionStore` (`messageSent`) to `timelineStore` (`userText`) — content now lives in one store. `sessionStore` keeps connection status (read by the composer gate) and its dormant `messages` slice.
- **Single source of thread state:** after this ticket the timeline (`timelineStore.items`) is the sole thread surface; `sessionStore.messages` is unread residue.
- **Concurrency:** no new async, tasks, subscriptions, or teardown. `useTimelineBridge` / `useModalBridge` already own the daemon-event subscription lifecycle (mount/cleanup) — untouched. The echo dispatch is synchronous.
- **Re-render seams:** the composer already selects `status` narrowly; the retired `selectMessages` read is removed, so `ConversationScreen` no longer re-renders on `sessionStore.messages` churn (there is none). `Timeline` selects `items` narrowly.

## Error handling

- **AC4 send failure** (`sendCommand` throws): unchanged — swallowed with a `console.error`, optimistic echo still posts, `submitMessage` returns `true`.
- **Malformed `hello_ack`:** unchanged — `parseHelloAck` fails closed to a `failed(malformed-hello-ack)` event, never `connected` (`daemonConnection.test.ts:424-437` pins this). The flip doesn't alter this path.
- **Hostile/oversized daemon stream events:** already defended upstream at the fail-closed transport decode (#199); each `DaemonEvent` string is rendered as inert auto-escaped text. The new `userText` row is renderer-sourced (the local composer), not daemon-sourced — the least-trusted-path of the three, and still escaped.
- **Empty timeline:** `Timeline` returns `null` on `items.length === 0` — the pre-first-message thread is absent (as today's empty `MessageThread` was effectively zero-height). No crash, no placeholder.

## Testing strategy

`npm test` (vitest), server-render via `renderToStaticMarkup` (no jsdom — match the existing pattern; **do not add a DOM/click harness**). `npm run typecheck` covers the `ComposerSendDeps.dispatch` type change and the exhaustive `TimelineRow` switch.

**AC1 — hello advertises `["interactive"]`** (`daemonConnection.test.ts`, extend the `:339` decode test or add a sibling):
- Drive a real dial (the existing `build()` + `start()` + `tick()` harness), decode `drivers[0].config.session.hello`, assert `payload.capabilities` equals `['interactive']`. This exercises the real `loadDialConfig` flip, not `buildClientHello` in isolation.

**AC2 — accepted set surfaced on `connected`** (`daemonConnection.test.ts`, extend/adapt `:328-337`):
- Have the fake driver emit a `hello_ack` whose `capabilities` is `['interactive']`; assert the emitted `connected` event's `ack.capabilities` equals `['interactive']` (proves the negotiated set is observable, not just the empty case already covered at `:334`).

**AC3 — echo is a `userText` timeline event** (`composerSend.test.ts`, rewrite the four echo tests at `:48-115`):
- `submitMessage('  hey  ', deps)` dispatches exactly `{ type: 'userText', text: 'hey' }` (trimmed), and dispatches it exactly once.
- The **wire** command is unchanged: one `sendMessageCommand({ conversation_id: MILESTONE_CONVERSATION_ID, message_id, text })` with the minted id and trimmed text.
- Whitespace-only input still returns `false` with no send and no dispatch.
- AC4 send-failure: `sendCommand` throwing is swallowed; the `userText` echo still dispatches; returns `true`.
- (The `messageId`-reuse-for-dedup test is removed — the echo no longer carries an id.)

**AC3 — `userText` renders as a right-aligned user bubble** (`ConversationScreen.test.tsx`, add to the `Timeline` describe):
- A `[{ kind: 'userText', text: 'hi there' }]` item renders one `.message-row--user` / `.bubble--user` with `data-thread-role="user">hi there`, and **no** streaming cursor, **no** `data-thread-role="assistant"`.
- Untrusted-text escaping: `text: '<b>x</b>'` renders `&lt;b&gt;x&lt;/b&gt;`, never live `<b>` (the assistantText-escaping precedent at `:83-89`).
- Interleaving: `[userText, assistantText(tail)]` renders the user bubble before the assistant bubble, cursor on the assistant tail only, in array order.

**AC4 — no split-brain** (`ConversationScreen.test.tsx`, container smoke):
- `<ConversationScreen />` against the empty stores renders no `data-message-role` bubbles (the `MessageThread` mount is gone) and no `data-thread-role` rows (empty timeline). Assert the markup contains no second empty thread region — exactly one thread surface.
- The existing `MessageThread` `describe` (`:26-56`) stays green (component retained as residue).

**AC5 — fake-daemon structured round-trip renders + modal answerable** (new integration test, e.g. `src/renderer/src/screens/conversation/interactiveRoundtrip.test.tsx`):
Drive events through the **real** bridges + stores + views (no transport, no jsdom) — the `timelineBridge.test.ts` / `modalBridge.test.ts` precedent of a spy `onDaemonEvent` + a real store:
- Build an isolated `timelineStore` (`createTimelineStore()`); wire `subscribeTimeline(spyOnDaemonEvent, store.dispatch)`. Emit, in order: a `userText` echo (via `store.dispatch`), then `turnState{thinking}`, `assistantDelta` ×2 (same turn), `toolUse`, `toolResult` (same `toolUseId`), `turnEnd`. Server-render `<Timeline items={selectItems(store.getState())} />` and assert the ordered thread: user bubble → one coalesced assistant bubble → one **resolved** tool row → cursor placement correct → all in arrival order.
- Build an isolated `modalStore` (`createModalStore()`); wire `subscribeModal(spyOnDaemonEvent, store.dispatch)`. Emit a `modalShown{ modalId, class, title, prompt, options, defaultOptionId }`. Server-render `<PermissionModalView prompt={selectOutstanding(store.getState())[0]} onAnswer onCancel />` and assert the dialog is **answerable**: the prompt text renders, one `permission-modal__option` button per option (the default carrying `--default`), plus the leading `Cancel`. (The click→command wiring is already unit-proven in `modalResolution.test.ts` / `PermissionModal.test.tsx` #237; AC5 proves the `modal_shown`→answerable-dialog path end-to-end, not a re-test of the click.)

## Open questions

- **AC5 altitude — confirmed renderer-level, not transport-level.** "Renders on the timeline" is inherently renderer-side; the transport `daemonConnection.roundtrip.test.ts` can't reach the timeline. Drive the real renderer bridges with a spy channel and server-render — do **not** build a jsdom click harness or a heavyweight transport e2e (that's #178). This is a deliberate scope boundary; keep it.
- **`MessageThread` deletion** is deferred (residue). If a future cleanup ticket removes it, it also removes `MessageBubble`, `messageViewModel`, `selectMessages`, and the coarse `messageSent`/`messageReceived` session path. Out of scope here.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX. The one real boundary change: advertising `interactive` widens the *daemon's* accepted inbound control-verb surface (interrupt / new_session / set_session_settings) and activates the daemon→renderer structured stream. The inbound-verb gating is enforced daemon-side by a per-connection flag set from the hello negotiation (verified in the daemon's `v2session.go`); the client cannot and should not enforce it. The reciprocal daemon→renderer stream this flip lights up crosses untrusted→trusted at the transport decode, which is **fail-closed** (#199 `parseInboundMessage`, per-arm validated before `emitDaemonEvent`) and rendered as **inert auto-escaped React children** across every arm (#203/#218/#224/#230). The new `userText` row is renderer-sourced (the local composer), not a daemon sink, and is likewise escaped. No new *undefended* boundary is introduced; the echo retarget (`sessionStore`→`timelineStore`) never crosses IPC.
- **[Tokens, secrets, credentials]** No finding. The device token already rode the hello as Noise early-data via `record.token` — unchanged by this ticket. The flip adds a non-secret constant (`CAPABILITY_INTERACTIVE`) beside it. `buildClientHello` / `makeHelloClientPayload` are log-free by contract (`helloExchange.ts:12-14`); the flip adds no log call. The `userText` echo carries user-typed text into renderer memory (as `messageSent` did before) — no new persistence, no disk write, no `localStorage`.
- **[File / storage operations]** N/A — the change performs no filesystem or storage operation; the echo is in-memory renderer state.
- **[Electron attack surface]** No finding — no new `contextBridge` API, `ipcMain` handler, or IPC channel; the composer reuses the existing `window.pyry.sendCommand`. No `webPreferences`, custom-protocol, or navigation change. The flip lives in the main process (`loadDialConfig`); the renderer edits (`composerSend`, `ConversationScreen`) touch no keys, sockets, or tokens — the "secrets stay in main" invariant holds. The renderer gains **no new capability**; the daemon-side inbound-verb widening is gated daemon-side, and the modal answer path (#236/#237) already mints its `answer_token` main-side.
- **[Cryptographic primitives]** N/A — Noise `Noise_IK_25519_ChaChaPoly_BLAKE2s` handshake, AEAD framing, key schedule, and nonce counters are untouched; the hello early-data is opaque bytes to the session. `message_id` remains a `crypto.randomUUID()` correlation id (non-security), unchanged.
- **[Network & I/O]** No finding — no socket/WebSocket/TLS/timeout change; the dial config's `maxFrameBytes` (`MAX_FRAME_BYTES`) cap is unchanged. The structured stream is more granular than the coarse message but each frame stays under the same per-frame cap.
- **[Error messages, logs, telemetry]** No finding — no new log/telemetry. The AC4 `console.error` on send-failure (generic string + the caught bridge error, no secret) is pre-existing. After the retarget, user sends no longer hit the `sessionStore` diagnostics observer (`timelineStore` has none by design) — a neutral-to-positive reduction in observed data; the diagnostic allowlist never logged message text regardless.
- **[Concurrency]** N/A — the change adds no async task, timer, subscription, or listener; it retargets one synchronous `dispatch` and removes one store read. The bridge subscription lifecycles (`useTimelineBridge` / `useModalBridge`) are untouched.
- **[Threat model — hostile daemon]** No MUST FIX; this is the one threat the flip newly *activates*. A daemon (or an in-session impersonator) streaming malformed/oversized structured or `modal_shown` content is defended by the fail-closed decode (#199) and inert-escaped rendering (#203–#230, #224 modal); this ticket adds no new daemon-string sink. Social-engineering via daemon-supplied modal prompt text is bounded by (a) escaped rendering (no markup injection), (b) the fail-safe-deny default option (#226), and (c) the daemon being Noise-static-key-authenticated (the user's own paired daemon) — it lives in the daemon's threat model, OUT OF SCOPE for the client flip and already addressed by the shipped answer path. A content-blind relay cannot read or forge inside the Noise session, so the advertised capability (inside the encrypted hello) does not leak to the relay.
- **[Threat model — unbounded stream accumulation]** OUT OF SCOPE (inherited, not introduced). `appendDelta` grows the tail via array-copy + string-concat per delta; a flood of deltas from a compromised-but-authenticated daemon is O(n²)-ish. This is a property of the **already-mounted** streaming pipeline (#199–#203), not of this flip's three edits, and the coarse `appendUnique` path had the same shape. No per-turn delta cap exists; adding one is a separate hardening ticket, not gated here (no observed failure; the daemon is authenticated; each frame is capped).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-10
</content>
</invoke>
