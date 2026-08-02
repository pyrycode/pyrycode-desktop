# Composer send (optimistic echo)

The **renderer half of the send flow**: the user types a message in the conversation composer, submits it, and sees it appear in the thread **immediately** — before the daemon confirms it. Typing drives controlled input state; a submit mints a `message_id`, emits a `sendMessage` command over the existing bridge, and appends the just-sent message to the [session store](session-store.md) optimistically. This is the counterpart to the [outbound send path](outbound-send-path.md), which turns that command into an encrypted `send_message` envelope on the relay ([#65](../codebase/65.md)).

Introduced in [#66](../codebase/66.md). Entirely `src/renderer/` — no keys, sockets, Noise handshake, or preload internals; the composer only calls the typed `window.pyry.sendCommand` bridge and dispatches into the store.

## What it does

Wires the previously-inert composer (an uncontrolled `<textarea>`, a click-less send button in the [conversation shell](conversation-shell.md)) into a working send:

- The input is **controlled** — typing updates the composer's own ephemeral state; the input clears after a successful submit; whitespace-only input does nothing.
- **Submit** (the send button or Enter) mints a `message_id` via `crypto.randomUUID()`, assembles a `SendMessagePayload` for the active conversation, and emits `window.pyry.sendCommand(sendMessageCommand(payload))`.
- The just-sent message is appended to the store **optimistically** as a wire `MessagePayload { role: 'user' }`, carrying the **same `message_id`** sent on the wire — so the store's existing `message_id` dedupe drops the daemon's later echo instead of double-posting.
- A failure of the send bridge does not crash the window; the echo still posts.

The optimistic echo only becomes *visible* because [#69](../codebase/69.md) bound the thread to the store. #66 owns the store append (verifiable at the store level); #69 owns the render (`role: 'user'` → a `user` bubble). The two share the store as their seam.

## How it works

Two production changes plus a controlled container.

### 1. The pure submit helper — `composerSend.ts`

Framework-free and React-free, co-located with the screen and mirroring `pairingState.ts` / `messageViewModel.ts`: the effects are **injected**, so the helper is a pure, deterministic function tested with plain spies (no React, no store, no Electron).

```ts
// src/renderer/src/screens/conversation/composerSend.ts — RENDERER ONLY
export const MILESTONE_CONVERSATION_ID = 'default'

export interface ComposerSendDeps {
  sendCommand: (command: RendererCommand) => void
  dispatch: (action: SessionAction) => void
  newMessageId: () => string
}

export function submitMessage(text: string, deps: ComposerSendDeps): boolean
```

`submitMessage` contract:

1. Trim `text`. If empty (whitespace-only) → return `false`, **no effects**.
2. Mint `message_id` via `deps.newMessageId()` **once**; reuse it for both the wire payload and the store echo.
3. Build `SendMessagePayload { conversation_id: MILESTONE_CONVERSATION_ID, message_id, text: trimmed }` (**no `role`** — that field is `MessagePayload`-only).
4. **Guarded send (AC4):** `try { deps.sendCommand(sendMessageCommand(payload)) } catch { console.error(...) }` — a bridge failure is swallowed, never propagated.
5. Dispatch `{ type: 'messageSent', message: { conversation_id, message_id, role: 'user', text: trimmed } }` — the optimistic echo, a wire `MessagePayload` carrying the **same `message_id`** as step 3.
6. Return `true` (the container clears the input on `true`).

The echo (step 5) and the clear happen **regardless** of the send outcome in step 4 — "optimistic" means show-immediately, and this milestone has no send-failure UI surface.

`MILESTONE_CONVERSATION_ID = 'default'` is the single active conversation for this milestone — the one place a future conversation-selection ticket replaces. There is no pre-existing conversation id in the renderer (`HelloAckPayload` carries `server_id`/`conn_id`, not a conversation), so a stable constant is the correct source; the daemon treats `conversation_id` as opaque and echoes back whatever it is sent.

### 2. The store action — `messageSent`

A small additive arm on the sealed `SessionAction` union in the [session store](session-store.md):

```ts
| { type: 'messageSent'; message: MessagePayload }   // a local optimistic echo
```

```ts
case 'messageSent':
  return { status: state.status, messages: appendUnique(state.messages, [action.message]) }
```

A **distinct name** from `messageReceived` documents intent (a local echo, not a daemon delivery) even though the reducer body is identical — the append routes through the same `appendUnique` (dedupe by `message_id`, added in #27), so the daemon's later echo of the same id drops. `messageSent` is dispatched **only** by the composer; the [daemon-event bridge](daemon-event-bridge.md) produces a subset of `SessionAction` from wire events and needs no change.

### 3. The controlled composer — `ConversationScreen.tsx`

`Composer` becomes a thin controlled container (stays in-file; the logic lives in `composerSend.ts`):

- `const [text, setText] = useState('')` — ephemeral single-value screen-local state (ADR 0006), never the store.
- `const dispatch = useSessionStore((s) => s.dispatch)` — `dispatch` identity is stable, so selecting it adds no re-render churn.
- The `<textarea>` gains `value={text}`, `onChange`, and `onKeyDown`; the send `<button>` gains `onClick={handleSubmit}`. Existing `className`/`placeholder`/`aria-label="Send"`/SVG untouched.
- `handleSubmit` builds `deps` **inside the handler body** (so `window.pyry` is dereferenced only at interaction time, never during render — this keeps the server-rendered container smoke test crash-free), calls `submitMessage(text, { sendCommand: window.pyry.sendCommand, dispatch, newMessageId: () => crypto.randomUUID() })`, and `setText('')` when it returns `true`.
- `onKeyDown`: reads `key`, `shiftKey`, and `nativeEvent.isComposing` off the event and asks `shouldSubmitOnKeyDown` (§7) whether to act; on `false` it returns without touching the event, otherwise `preventDefault()` + `handleSubmit()`.

### 4. Connection-status gate — `composerAvailability` ([#31](../codebase/31.md))

The send control is gated on the live connection status: while the session is not `connected`, sending is disabled and a lightweight inline caption says *why*, instead of silently swallowing a keystroke that goes nowhere. This is a **UX affordance, not a safety net** — the deterministic no-throw safety on a disconnected send already lives in [#65](../codebase/65.md)'s `daemonConnection.send()` and #66's guarded `sendCommand`; no second guard is added.

The decision lives in `composerSend.ts` as a pure, React-free predicate — a *total* mapping over the store's `ConnectionStatus` (from [session store](session-store.md)):

```ts
export interface ComposerAvailability {
  canSend: boolean      // true only when status.type === 'connected'
  hint: string | null   // short "why unavailable" caption; null iff canSend
}
export function composerAvailability(status: ConnectionStatus): ComposerAvailability
```

| `status.type` | `canSend` | `hint` |
|---|---|---|
| `connected` | `true` | `null` |
| `connecting` | `false` | `'Connecting…'` |
| `disconnected` | `false` | `'Not connected'` |
| `error` | `false` | `'Connection error'` |

Both facts derive from the single `selectStatus` read, so there is one source of truth. A `default: assertNever(status)` arm makes a new `ConnectionStatus` arm a compile error. The `error` hint is a short generic label and deliberately does **not** surface `status.error.message` — that `ConnectionError.message` is [the connection banner's surface](conversation-shell.md#connection-banner-279) (#279), built beside this gate.

In the container, `Composer` selects `status`, derives `{ canSend, hint }`, and:

### 5. Re-pair gate — `shouldOfferRepair` ([#167](../codebase/167.md))

A second pure predicate beside `composerAvailability`, over the same `ConnectionStatus`: whether the
conversation screen should proactively surface a `Re-pair` escape hatch (see
[Conversation shell → Re-pair control](conversation-shell.md#re-pair-control-167)).

```ts
export function shouldOfferRepair(status: ConnectionStatus): boolean {
  return status.type === 'error' && !status.error.retryable && status.error.code !== 'unpair'
}
```

Unlike `composerAvailability`, this is a boolean over the single `error` arm, not a total mapping over
all four — no `assertNever` exhaustiveness switch is needed for a one-arm gate. `!retryable` is the
primary gate (a terminal transport/handshake failure is always non-retryable; a retryable daemon
wire-error like `server.binary_offline` is excluded); `code !== 'unpair'` is a self-loop guard excluding
the synthetic error `runUnpair` ([unpair channel](unpair-channel.md), #166) itself dispatches on a
failed clear — without it, a failed re-pair would immediately re-satisfy the predicate and re-offer
itself. A transient transport drop never reaches `error` at all (the relay supervisor absorbs and
re-dials it), so it is out of scope for this predicate by construction.

- **Guards `handleSubmit`** with `if (!canSend) return` at the top — the authoritative gate, blocking the **Enter** path (`handleKeyDown → handleSubmit`) as well as the button. `submitMessage` is never reached while not connected, so no `sendCommand` and no optimistic `dispatch` fire; the input is **not** cleared.
- **Natively disables** the send `<button>` with `disabled={!canSend}` (a disabled button fires no `onClick` — the visible affordance, platform-blocked in addition to the handler guard).
- **Renders the hint** above the input/button row as `<p className="composer__hint" role="status">` — a polite live region, so a screen reader announces the status change without stealing focus. On connect, `hint` is `null`, the `<p>` unmounts, and the button re-enables with no reload.

The `<textarea>` stays **enabled** while not connected — the user may draft while `connecting`; only the send control is gated. Selecting `status` re-renders `Composer` when it changes, so the re-enable is reactive; the thread (which selects only `selectMessages`) doesn't re-render on status change.

### 6. Connection banner gate — `shouldShowBanner` / `CONNECTION_BANNER_COPY` ([#279](../codebase/279.md))

A third pure predicate beside `composerAvailability`/`shouldOfferRepair`, over the same
`ConnectionStatus` — whether the conversation screen should render the prominent, disconnected-only
banner across the top of the thread (see
[Conversation shell → Connection banner](conversation-shell.md#connection-banner-279)).

```ts
export function shouldShowBanner(status: ConnectionStatus): boolean {
  return status.type !== 'connected'
}
```

Unlike `composerAvailability`, this is not an exhaustive per-arm switch: every non-connected arm
(`disconnected`/`connecting`/`error`) maps to the identical behavior (show the banner), so `!==
'connected'` is the honest shape — and its fail-mode is correct, since a hypothetical future 5th
`ConnectionStatus` arm defaults to *showing* the not-connected banner rather than silently hiding it.

`CONNECTION_BANNER_COPY` ships alongside it — a single client-owned string constant, lexically distinct
from all three `composerAvailability` hints, so the banner and the composer's terse gate never read as
the same string stacked twice even though both remain visible while disconnected. One constant, not a
per-arm map: the composer already carries the per-arm nuance, so a second three-way split would
duplicate it.

### 7. Keystroke-intent gate — `shouldSubmitOnKeyDown` ([#512](../codebase/512.md))

A fourth pure predicate in `composerSend.ts`, but on a different axis from `composerAvailability`/`shouldOfferRepair`/`shouldShowBanner` (all of which read `ConnectionStatus` — *may* the composer send): this one reads the keydown itself — *did this keystroke ask* to send. Placed directly after `submitMessage`, not beside the `ConnectionStatus` cluster.

```ts
export interface ComposerKeyEvent {
  key: string
  shiftKey: boolean
  isComposing: boolean   // event.nativeEvent.isComposing — not on React's synthetic event
}
export function shouldSubmitOnKeyDown(event: ComposerKeyEvent): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing
}
```

Plain Enter (no shift, no composition) → `true`; Shift+Enter, a non-Enter key, or — the fix — **the Enter that commits an in-progress IME composition** → `false`. That commit keydown fires with `key === 'Enter'` and `shiftKey === false`, indistinguishable from an ordinary Enter except for `isComposing`; before #512 it both sent the half-composed text and suppressed the commit itself.

`handleKeyDown` is now exactly three statements, and the `return` on `false` **precedes** `preventDefault()` — calling `preventDefault()` first and declining to submit second would still break the IME commit, since the candidate never lands. This ordering, not the predicate, is the actual fix; it's why AC1's "no `preventDefault`" is a separate clause from "no wire command."

The predicate deliberately does **not** absorb the `canSend` gate (§4) — that stays authoritative in `handleSubmit`, preserving #31's contract that a disconnected Enter is *swallowed*, not turned into a newline. It also doesn't read the legacy `keyCode === 229`; `isComposing` is the one signal used, since Electron `^33.2.1` is Chromium-only and doesn't need a WebKit fallback.

## Data flow

```
type in textarea ─▶ setText (local useState)
click Send / Enter ─▶ handleSubmit
                        ├─ !canSend (status ≠ connected)? ─▶ return, no effects (#31 gate)
                        └─▶ submitMessage(text, deps)
                              ├─ trim; empty? ─▶ return false (no effects)
                              ├─ id = newMessageId()          (crypto.randomUUID)
                              ├─ sendCommand(sendMessageCommand(SendMessagePayload))  [guarded]  ──▶ main/#65 ──▶ relay ──▶ daemon
                              ├─ dispatch(messageSent: MessagePayload{ role:'user', same id })     ──▶ sessionStore ──▶ thread (#69)
                              └─ return true ─▶ setText('')
                                                        │
daemon later echoes same message_id ──▶ messageReceived ──▶ appendUnique drops the duplicate
```

## Edge cases and limitations

- **Not connected** ([#31](../codebase/31.md)) — while `selectStatus` is not `connected`, the send button is `disabled`, the `handleSubmit` early-return inerts the Enter path, and a `role="status"` caption names why (`Connecting…` / `Not connected` / `Connection error`). No `sendCommand`, no echo, input not cleared. The textarea stays enabled (drafting allowed); the control re-enables reactively on connect. The `error` hint never surfaces `ConnectionError.message` — that string stays server-side-only; the same non-connected state also shows the prominent [connection banner](conversation-shell.md#connection-banner-279) (#279), which renders its own client-owned copy, not the composer's hint text.
- **Whitespace-only / empty input** — early `return false`; no send, no dispatch, no clear (AC1).
- **Send-bridge failure** — `try/catch` swallows it (`console.error`); the process does not crash and the optimistic echo still appends (AC4). There is deliberately **no** send-failure UI (no banner, retry, or echo rollback) — the store has no per-message delivery state this milestone.
- **Daemon re-echoes the sent message** — the same-`message_id` copy is dropped by `appendUnique`; the thread shows one bubble (AC3).
- **DOM interaction is untested.** Only the pure `submitMessage` and `shouldSubmitOnKeyDown` are unit-tested (spies/plain values + a stub id). `onChange`, clear-on-success, and `handleKeyDown`'s own three-statement wiring have no test, because the render harness is `renderToStaticMarkup` (node env), not jsdom — the same deferral [#69](../codebase/69.md) carries, and the one carved out by [#512](../codebase/512.md) is that the IME-vs-plain-Enter *decision* no longer has to live in that untested surface.
- **Single active conversation.** All sends use `MILESTONE_CONVERSATION_ID`; there is no conversation-selection surface. `auto-grow` on the textarea is unbuilt (cosmetic, no AC).

## Related

- [Outbound send path](outbound-send-path.md) / [#65](../codebase/65.md) — the **main/transport half** this drives: the `sendMessage` command becomes an encrypted `send_message` envelope on the live Noise relay session. Together #65 + #66 are the two halves of sending a message.
- [Session store](session-store.md) / [#2](../codebase/2.md) — hosts the `messageSent` action and the `appendUnique` dedupe (added #27) this relies on; #66 closes its "No optimistic send" limitation.
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md) — the screen whose inert `Composer` this wires.
- [Command channel](command-channel.md) / [#17](../codebase/17.md) — the `sendCommand` bridge + pure `sendMessageCommand` constructor (which deliberately does **not** mint the id — the composer does).
- [Pairing input screen](pairing-input-screen.md) / [#55](../codebase/55.md) — the pure-logic / thin-container split (`pairingState.ts`) `composerSend.ts` mirrors.
- [ADR 0006 — ephemeral screen-local state](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) · [ADR 0004 — renderer session store / wire types](../decisions/0004-renderer-session-store-reducer-wire-types.md)
- [#66 codebase notes](../codebase/66.md) — implementation summary, patterns, lessons.
- [#31 codebase notes](../codebase/31.md) — the connection-status gate on this composer: `composerAvailability` + the disabled control and inline "why" hint.
- [#167 codebase notes](../codebase/167.md) — the `shouldOfferRepair` predicate beside `composerAvailability`, and the `Re-pair` affordance it gates.
- [#279 codebase notes](../codebase/279.md) — the `shouldShowBanner`/`CONNECTION_BANNER_COPY` pair beside `composerAvailability`/`shouldOfferRepair`, and the [connection banner](conversation-shell.md#connection-banner-279) it gates.
- [#512 codebase notes](../codebase/512.md) — the `shouldSubmitOnKeyDown` keystroke-intent predicate: the Enter that commits an IME composition no longer submits or suppresses the commit.
