# Spec: fake e2e — queued backlog + dequeue + interrupt (#427)

**Size:** S · **Security-sensitive:** no (test-only coverage of already-sec-reviewed verbs: `queue_state` #292, `dequeue_message` #296/#300, `turn_state` #214, `interrupt` #306/#307) · **UI-visible:** no new UI (Figma N/A — coverage of shipped screens)

Test-only. **Zero production change.** One new Playwright spec on the shared fake-stack fixtures (`launchPairedApp` #433, the seeded thread it lands on), covering three already-shipped client flows end-to-end (renderer → IPC → main → Noise wire → decode, and the reverse push path): the queued backlog render, dropping a queued message, and interrupting a running turn. Every production path is already shipped; this pins the client wiring cheaply before the Tier-3 real-daemon/real-claude twin (a separate ticket).

## Files to read first

- `e2e/run-config-settings.spec.ts` (whole file, ~260 lines) — **the template.** Clone its shape verbatim: spec-local frame builders sealed via the production codec (`encodeEnvelope`, fixed `id`/`ts`, no `Date.now()`/randomness), a spec-held `captured: Envelope[]` array filled by a capturing `buildReplyFrames` closure, `daemon.pushFrame(...)` to surface unsolicited daemon state after launch, and outbound-frame assertions via `expect.poll(() => captured.filter(...).length).toBe(1)`. Your spec is the same skeleton with `queue_state`/`turn_state` pushes and `dequeue_message`/`interrupt` captures instead of `set_session_settings`. Note its **single `test()` block, single launch** decision (line 17-19) — adopt it (see § Design).
- `e2e/send-and-stream.spec.ts:100-123` — the composer send + optimistic user echo pattern: `page.getByPlaceholder('Message…').fill(text)` + `page.getByRole('button', { name: 'Send' }).click()` → the echo renders synchronously as `.bubble[data-thread-role="user"]` **with no daemon reply required**. Reuse this to plant the one *delivered* user row the queue-render step contrasts against. Also the `#448` conversation-id discipline (reply only for `SEEDED_ROW.id`).
- `e2e/fixtures/launchPairedApp.ts:60-83,118-200` — `SEEDED_ROW` (`id: 'seed-conversation'`), `seedConversationsFrame()` (reuse on your `list_conversations` arm — a scripted `buildReplyFrames` owns seeding the launch row), the `buildReplyFrames` seam, `daemon.pushFrame`, and the `PairedApp` handle (`{ page, app, daemon }`). Launch lands on `.conversation` with **Send enabled** and the seeded row **recorded as the active conversation** — no extra un-inert step (unlike run-config's `session_transition`).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:505-590` (interrupt) and `:674-775` (queued backlog) — **the locator source.** `QueuedBacklog` renders `.conversation__queued > .message-row--user` rows, each a `.queued-row__drop` button (aria-label `Drop queued message`) beside a `.bubble.bubble--user[data-thread-role="queued"]`, React-keyed by `queued_msg_id`. `InterruptButton` renders `.conversation__interrupt > button.interrupt-button` (aria-label `Stop the running turn`) iff `isTurnRunning(phase)`. `ThinkingIndicator` (`:472-479`) renders `.conversation__thinking > .bubble--thinking` (text `Thinking…`) iff `phase === 'thinking'`.
- `src/renderer/src/store/queueStore.ts:70-105` — `selectBacklogFor(conversationId)` keys the backlog by `conversation_id`; a snapshot is **REPLACEMENT truth** (the whole current backlog, not a delta); an absent key reads `EMPTY_BACKLOG`. This is why your pushed `queue_state` **must** carry `conversation_id: SEEDED_ROW.id` (§ State + concurrency).
- `src/renderer/src/store/queueBridge.ts:50-63` — `subscribeQueue`: a `connected` event **resets ALL backlogs** (#197); every `queueState` writes via `setBacklog`. The reset is the one ordering trap (§ State + concurrency).
- `src/renderer/src/store/timelineBridge.ts:43-46` — `turnState` → the timeline `phase` slice; `conversation_id` is dropped (ADR 0004, the timeline is conversation-id-free), so `turn_state` applies to the single active thread.
- `src/renderer/src/PairedShell.tsx:107-115` — `onOpen` (list-open) records the clicked row as active via `setActiveConversation(conversation)` → `activeConversation.id === SEEDED_ROW.id`. The load-bearing queue-render precondition.
- `src/shared/wire/types.ts:263-266,366-404` — exact snake_case payload fields: `TurnStatePayload { conversation_id, state }` with `WireTurnState = 'thinking' | 'responding' | 'idle'`; `QueuedItem { queued_msg_id: number, text, ts }`; `QueueStatePayload { conversation_id, queued }`; `DequeueMessagePayload { conversation_id, queued_msg_id }`.
- `src/main/transport/dequeueMessageEnvelope.ts` + `interruptEnvelope.ts` — confirm the OUTBOUND envelope `type`s and shapes you capture: `'dequeue_message'` (`payload: { conversation_id, queued_msg_id }`) and `'interrupt'` (**bare**, `payload: {}`, no ids).
- Prior gotchas (memory / lessons): `e2e/` is in **neither** tsconfig ([[e2e-not-typechecked-by-project-config]]) — run a standalone `tsc` pass (§ Testing). A bare control frame needs a **present-empty** payload `{}` — `decodeEnvelope` throws on an absent payload ([[bare-control-frame-needs-present-empty-payload]]).

## Context

Three shipped flows have unit tests but no e2e coverage: the queued-backlog render (#294) reading the replacement-truth queue store (#293), dropping a queued message (`dequeueMessage` #296/#300), the turn-state running indicator (#215), and the interrupt control (#307). All are driven by **server pushes** (`queue_state`, `turn_state`) that arrive unsolicited and re-render the live store subscription — nothing the app requests. Neither drop nor interrupt is optimistic: `dropQueuedMessage.ts` / `sendInterrupt.ts` only emit a frame; the UI reflects only when the daemon's next snapshot/state arrives. This ticket pins that wiring on the shared fixtures, in line with the sibling fake-stack e2e specs (#451/#452/#423/#425/#426/#456), before the Tier-3 real-stack twin.

## Design

New file: **`e2e/queued-backlog-interrupt.spec.ts`**. Imports mirror `run-config-settings.spec.ts`:

```ts
import { isDeepStrictEqual } from 'node:util'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, QueuedItem, DequeueMessagePayload, WireTurnState } from '../src/shared/wire/types'
```

### One `test()` block, one launch (the run-config precedent)

Adopt run-config's single-block decision, **not** #423/#426's two-block split. Those siblings split only because of one-way-per-launch state (a promotion that can't un-happen; the FIFO `outstandingAnswers` reject residue). **This ticket has no such trap** — the queue store and timeline `phase` are independent, each is fully re-settable within one launch by pushing a fresh snapshot/state, and nothing accumulates cross-flow residue (see § State + concurrency). Three separate blocks would triple the ~60 s real-handshake launch cost for zero isolation benefit. Run the three flows as sequential, comment-delimited sections in one continuous drive. (Splitting into independent `test()` blocks is *correct* if the developer prefers it — each flow stands alone — but one block is the cheaper default and matches the cited template.)

### Spec-local frame builders (contract sketches — seal one envelope each via the production codec, fixed `id`/`ts`)

- `queueStateFrame(items: readonly QueuedItem[]): Uint8Array` — `encodeEnvelope({ id: REPLY_ENVELOPE_ID, type: 'queue_state', ts: FIXED_TS, payload: { conversation_id: SEEDED_ROW.id, queued: items } })`. `conversation_id` MUST be `SEEDED_ROW.id` (§ State + concurrency).
- `turnStateFrame(state: WireTurnState): Uint8Array` — same shape, `type: 'turn_state'`, `payload: { conversation_id: SEEDED_ROW.id, state }`.

### Capturing fake (contract sketch — the run-config `capturingRunConfigFake` shape)

```ts
function capturingQueueInterruptFake(captured: Envelope[]): (inbound: Uint8Array) => Uint8Array[]
```

Per inbound: `decodeEnvelope`, `captured.push(env)`, then switch:
- `'list_conversations'` → `[seedConversationsFrame()]` (renders the launch row).
- default → `[]` — `send_message` (the delivered-echo plant needs no reply), `dequeue_message`, and `interrupt` are all captured for the send-half proof but need **no reply**; their reflecting state (`queue_state` / `turn_state{idle}`) is pushed explicitly by the test (the two-part assertion, § State + concurrency).

The closure is stateless (no counter) — discrimination is by envelope `type` only. The double-decode (capture, then dispatch) is pure and harmless, exactly as run-config's factory does.

### Capture matchers (contract sketches)

- `dequeueFramesMatching(captured, expected: DequeueMessagePayload)` = count of `e.type === 'dequeue_message' && isDeepStrictEqual(e.payload, expected)`. `.toBe(1)` proves BOTH send-once and the exact `{ conversation_id, queued_msg_id }` at once (the payload is fully deterministic — no opaque token, unlike `modal_answer` #426 — so a whole-payload deep-equal is correct here, the run-config posture).
- `interruptFrames(captured)` = count of `e.type === 'interrupt'`. The interrupt payload is bare `{}` (no ids to match); `.toBe(1)` proves send-once.

### Locators (scope by container so the shared `.message-row--user`/`.bubble--user` markup never collides)

```ts
const queuedRow = (text: string) => page.locator('.conversation__queued .message-row--user', { hasText: text })
const dropButton = (text: string) => queuedRow(text).getByRole('button', { name: 'Drop queued message' })
const queuedBubbles = page.locator('[data-thread-role="queued"]')   // all queued rows
const deliveredUser = page.locator('[data-thread-role="user"]')      // the delivered echo
const interruptButton = page.getByRole('button', { name: 'Stop the running turn' })
const runningIndicator = page.locator('.conversation__thinking')     // ThinkingIndicator container
```

The delivered echo and the queued rows both use `.message-row--user`/`.bubble--user`; they differ ONLY by `data-thread-role` (`user` vs `queued`) and container (`.conversation__thread` vs `.conversation__queued`). That difference IS the AC2 "distinct from delivered" seam — assert on the role attribute, never the shared class.

## State + concurrency model

Three load-bearing facts (the traps a naïve clone of the template would miss):

1. **The queue-render precondition: `conversation_id` must be `SEEDED_ROW.id`.** `QueuedBacklogControl` reads `selectBacklogFor(activeConversation.id)` (`ConversationScreen.tsx:757-763`), and list-open records the clicked `SEEDED_ROW` as active (`PairedShell.tsx:112-115`), so `activeConversation.id === 'seed-conversation'`. A `queue_state` pushed under any other `conversation_id` lands in the store but is selected by nothing → zero rows render, silently. This is the exact analogue of run-config's session-id gate. (`turn_state` has no such gate — `timelineBridge` drops its `conversation_id` (ADR 0004); set it to `SEEDED_ROW.id` anyway for realism.)

2. **The `connected` reset — push AFTER launch resolves.** `subscribeQueue` calls `resetBacklogs()` on every `connected` event (the reconnect reconcile, #197). The fixture's completion signal is Send-enabled, which is gated on that same `connected` — so by the time `launchPairedApp` returns, `connected` has already fired. Pushing `queue_state` after that point is safe: no rekey/reconnect occurs in this spec, so no further `connected` fires to wipe the backlog. **Do not push `queue_state` before the launch promise resolves.**

3. **Interrupt phase-gating — `thinking` lights both, `idle` retracts both.** `isTurnRunning(phase)` is `thinking || responding` (gates the interrupt control), and `ThinkingIndicator` gates on `phase === 'thinking'`. So a pushed `turn_state{thinking}` mounts BOTH the interrupt button and the running indicator; a pushed `turn_state{idle}` returns `phase` to idle and retracts BOTH — the crisp "both gone" assertion. `turn_end` is **not** the quiescing signal — it appends a turn boundary but does not reset `phase` (`threadTimeline.ts:200` — "the daemon emits `turn_state: 'idle'` separately"); only `turn_state{idle}` retracts the phase-gated controls. (`TurnPhase` has no literal `running` — do not push that value.)

**Two-part assertion per mutation (both drop and interrupt are non-optimistic).** Each mutation: (a) act on the DOM, (b) `expect.poll` the captured OUTBOUND frame — the send-half proof (#425/#456 precedent), because neither helper dispatches locally, so the DOM alone cannot prove the send landed — then (c) `daemon.pushFrame(...)` the reflecting state and assert the DOM change. The dropped row leaves only when the fresh `queue_state` (omitting it) arrives; the interrupt controls retract only when `turn_state{idle}` arrives.

**Reactivity is free from the live subscriptions** — `QueueData` (app-level) and the timeline bridge feed the app-singleton stores that the mounted `ConversationScreen` reads via narrow selectors; each push re-renders the affected slice only.

## Error handling / failure modes

- **Silent-empty-backlog** (most likely regression): a wrong `conversation_id` on `queue_state` (fact 1) or pushing before launch resolves (fact 2) yields zero rows with no error. The render assertion auto-waits on `queuedBubbles` count and times out — so the failure is loud, but the *cause* is one of these two. Call them out in comments so a future maintainer isn't hunting.
- **No `turn_end` confusion** (fact 3): the "both gone" assertion after `turn_state{idle}` is the guard — a regression that quiesced on `turn_end` instead would leave the controls mounted and fail here.
- **Bare interrupt payload**: the outbound `interrupt` is `payload: {}` — match by `type` only, never a payload deep-equal.

## Testing strategy

`npm run e2e` (Playwright). Each AC maps to assertions in one continuous drive (reuse `const REPLY_ENVELOPE_ID = 1`, `const FIXED_TS = '2026-07-07T12:00:00.000Z'`, `const ROUNDTRIP_TIMEOUT_MS = 15_000` from the sibling). Two queued items with distinct texts and ids: `A = { queued_msg_id: 1, text: 'First queued task', ts: FIXED_TS }`, `B = { queued_msg_id: 2, text: 'Second queued task', ts: FIXED_TS }`.

- **AC: queue render (distinct from delivered).** Plant one delivered row: `fill('Message…')` + click **Send** (the fake no-ops `send_message`; the optimistic echo renders). Assert `deliveredUser` has count 1. Then `daemon.pushFrame(queueStateFrame([A, B]))`. Assert (with `ROUNDTRIP_TIMEOUT_MS` headroom) `queuedBubbles` count 2, both `queuedRow('First queued task')` and `queuedRow('Second queued task')` visible, and `deliveredUser` still count 1 (the two roles partition — the AC2 seam). "Keyed by `queued_msg_id`" is proven behaviorally by the dequeue step below (a DOM key is not an inspectable attribute; correct keying = removing exactly the omitted row).
- **AC: dequeue.** Click `dropButton('First queued task')`. `expect.poll(() => dequeueFramesMatching(captured, { conversation_id: SEEDED_ROW.id, queued_msg_id: 1 })).toBe(1)` — the send-half proof (row A is NOT yet gone: non-optimistic). Then `daemon.pushFrame(queueStateFrame([B]))` (the fresh snapshot omitting A). Assert `queuedRow('First queued task')` count 0, `queuedRow('Second queued task')` still visible, `queuedBubbles` count 1.
- **AC: interrupt.** `daemon.pushFrame(turnStateFrame('thinking'))`. Assert `interruptButton` visible AND `runningIndicator` visible (both, with `ROUNDTRIP_TIMEOUT_MS` headroom). Click `interruptButton`. `expect.poll(() => interruptFrames(captured)).toBe(1)`. Then `daemon.pushFrame(turnStateFrame('idle'))`. Assert `interruptButton` count 0 AND `runningIndicator` count 0 (both gone).
- **AC: `npm run e2e` green.**

**Secret hygiene** (carry verbatim from the siblings): every assertion reads DOM text/roles/counts and captured wire frames only; `queued_msg_id`/`conversation_id`/the item texts are non-secret routing & display literals; the pairing plumbing (synthetic token, fake static key) lives in `launchPairedApp` and is never echoed. No failure diagnostic serializes a token, key, or plaintext.

**Typecheck** — `e2e/` is in neither tsconfig ([[e2e-not-typechecked-by-project-config]]), so `npm run typecheck` will NOT catch this spec. Run the standalone pass the #426 sibling landed with: a temporary `tsconfig.e2e-check.json` at repo ROOT that `extends "./tsconfig.node.json"` with `composite: false` and `include: ["e2e", "src/main", "src/shared"]`, then `./node_modules/.bin/tsc -p tsconfig.e2e-check.json --noEmit` (delete the temp config after; expect only benign `{ ...process.env }` noise from the fixture). ⚠ On a fresh worktree run `npm install` first, and use `./node_modules/.bin/tsc` — a bare `npx tsc` hits a global stub.

## Open questions

- **None blocking.** All four verbs decode (`inboundMessage.ts:862,949` for `turn_state`/`queue_state`; the outbound envelopes at `dequeueMessageEnvelope.ts`/`interruptEnvelope.ts`) and the render surfaces are shipped and unit-tested. The three load-bearing facts above are read directly from the code, not inferred. If a cold runner ever races the delivered-echo plant against the `queue_state` push, assert `deliveredUser` before pushing `queue_state` (already the recommended order) — the echo is synchronous and lands first.
