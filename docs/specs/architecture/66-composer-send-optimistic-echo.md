# 66 — Composer send: submit a message with an optimistic local echo

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-61

The Composer (node 16-61) is a bottom-pinned row: a rounded (28px) `surface-container-high` input pill on the left holding the placeholder body-large text, and a circular 48px send button on the right with an up-arrow icon. **This chrome is already realized** by the #1 conversation shell (`.composer` / `.composer__input` / `.composer__send` in `conversation.css`) — #66 changes no markup or styling, it only makes the existing `<textarea>` controlled and wires an `onClick`/`onKeyDown` submit. The mic glyph shown inside the Figma pill is not part of this app's shell and is out of scope.

## Context

The conversation composer is inert: an uncontrolled `<textarea>` (no `onChange`) and a send `<button>` (no `onClick`) in `ConversationScreen.tsx`. Everything downstream of a submit already exists:

- The typed command channel: `window.pyry.sendCommand(command)` (preload bridge) and the pure `sendMessageCommand(payload)` constructor (#17), whose **main-side receiver landed in #65** — so an emitted command already turns into an encrypted relay envelope.
- The session store holds the message list and dedupes appends by `message_id` (#2), and the thread now renders that list (#69, merged).

What's missing is the renderer send half: a controlled composer input, a submit that mints a `message_id` and emits a `sendMessage` command, and a new store action that appends the just-sent message optimistically. Because the store dedupes by `message_id`, the daemon's later echo of the same message drops instead of double-posting — **provided the optimistic copy carries the same `message_id` sent on the wire.**

This ticket stops at the store append. It does not touch `placeholderMessages` (already deleted by #69) or the thread render.

## Files to read first

- `src/renderer/src/screens/conversation/ConversationScreen.tsx:49-69` — the inert `Composer` function to be wired; note the existing `.composer__input` textarea and `.composer__send` button + `aria-label="Send"` that must survive.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:14-25` — the container already reads the store via `useSessionStore(selectMessages)`; how the composer reaches `dispatch` follows the same hook.
- `src/renderer/src/store/sessionStore.ts:39-45` — the `SessionAction` union; add one arm here.
- `src/renderer/src/store/sessionStore.ts:59-83` — `assertNever` exhaustiveness guard + `appendUnique` (the dedupe-by-`message_id` the optimistic append reuses verbatim).
- `src/renderer/src/store/sessionStore.ts:91-108` — `reduceSession`; add one case in lockstep with the new arm.
- `src/shared/ipc/commands.ts:34-44` — `RendererCommand` type + the pure `sendMessageCommand(fields)` constructor (does **not** mint the id — the composer does).
- `src/preload/index.ts:14-23` — `sendCommand` is fire-and-forget (`ipcRenderer.send`, no reply); a throw here is what AC4's guard must catch.
- `src/shared/wire/types.ts:87-102` — `MessagePayload` (`conversation_id`, `message_id`, `role`, `text`) vs `SendMessagePayload` (`conversation_id`, `message_id`, `text` — no `role`). The store append uses `MessagePayload{ role:'user' }`; the wire command uses `SendMessagePayload`.
- `src/renderer/src/screens/conversation/messageViewModel.ts:27-36` — confirms `role:'user'` → a `user` bubble on render (why the append must set `role:'user'`).
- `src/renderer/src/screens/pairing/pairingState.ts` (whole file) — **the precedent to mirror**: a pure, React-free `.ts` module holding an injected bridge seam + effect-runner (`runSubmit`) that the tests exercise with a fake, while the React container stays thin. Model `composerSend.ts` on this.
- `src/renderer/src/screens/pairing/PairingScreen.tsx:161-209` — the thin-container pattern: optional injected seam defaulting to `window.pyry`, handler-driven side effects, no `useEffect`. The composer container mirrors this.
- `src/renderer/src/store/sessionStore.test.ts:1-35` — the store test idiom (plain wire fixtures, `msg(id, role)` helper) the new `messageSent` test extends.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:66-77` — the existing container smoke test (server-rendered; expects `<textarea` + `aria-label="Send"`). Must stay green; the composer keeps both.
- `docs/knowledge/decisions/0006-ephemeral-screen-state-usereducer-not-store.md` — ephemeral screen-local state stays in the component; `useState` is explicitly sanctioned for trivial single-value state (the composer input text).

## Design

Three production files. No conversation-selection surface is built — a single milestone conversation id is sourced from a constant.

### 1. New store action — `sessionStore.ts` (modify)

Add one arm to `SessionAction` and one case to `reduceSession`:

- Union arm: `| { type: 'messageSent'; message: MessagePayload }` — a distinct name from `messageReceived` documents intent (a local optimistic echo, not a daemon delivery), even though the reducer body is identical.
- Reducer case: `case 'messageSent': return { status: state.status, messages: appendUnique(state.messages, [action.message]) }` — status untouched, append routed through the existing `appendUnique` so the daemon's later same-`message_id` echo dedupes.

The `assertNever(action)` default forces the new case to compile — that is the only consumer that must change. **No edit fan-out:** `translateDaemonEvent` (`daemonEventBridge.ts`) returns a *subset* of `SessionAction` from `DaemonEvent`; it produces no `messageSent` and needs no change. `messageSent` is dispatched only by the composer.

### 2. Pure submit helper + milestone id — `composerSend.ts` (new)

A framework-free, React-free `.ts` module co-located with the composer, mirroring `pairingState.ts` / `messageViewModel.ts` (unit-tested with no React, no store, no Electron).

- `export const MILESTONE_CONVERSATION_ID = 'default'` — the single active conversation for this milestone. **The one place a future conversation-selection ticket replaces.** (There is no pre-existing conversation id anywhere in the renderer — `HelloAckPayload` carries `server_id`/`conn_id` but no conversation; the message list is empty until the first message arrives — so a constant is the correct source per the ticket.)
- `export function submitMessage(text, deps): boolean` — the tested seam. `deps` injects the three effects so the helper is pure and deterministic in tests:
  - `sendCommand: (command: RendererCommand) => void`
  - `dispatch: (action: SessionAction) => void`
  - `newMessageId: () => string`

  Contract (behavior summary — not the body):
  1. Trim `text`. If empty (whitespace-only), return `false` and perform no effects.
  2. Mint `message_id` via `deps.newMessageId()` **once**; reuse it for both the wire payload and the store echo.
  3. Build `SendMessagePayload { conversation_id: MILESTONE_CONVERSATION_ID, message_id, text: trimmed }`.
  4. **Guarded send (AC4):** `try { deps.sendCommand(sendMessageCommand(payload)) } catch (error) { console.error(...) }` — a bridge failure is swallowed, never propagated.
  5. Dispatch `{ type: 'messageSent', message: { conversation_id: MILESTONE_CONVERSATION_ID, message_id, role: 'user', text: trimmed } }` — the optimistic echo, carrying the **same `message_id`** as step 3.
  6. Return `true` (the container clears the input on `true`).

  The echo (step 5) and clear happen regardless of the send outcome in step 4 — "optimistic" means show-immediately, and this milestone has no send-failure UI surface (see Open questions).

### 3. Controlled composer — `ConversationScreen.tsx` (modify `Composer`)

`Composer` becomes a thin controlled container (stays in-file; extraction not required — the logic already lives in `composerSend.ts`):

- Ephemeral input state: `const [text, setText] = useState('')` — ADR 0006 sanctions `useState` for trivial single-value screen-local state.
- Store dispatch: `const dispatch = useSessionStore((s) => s.dispatch)` — `dispatch` identity is stable, so selecting it adds no re-render churn.
- `<textarea>` gains `value={text}` and `onChange={(e) => setText(e.target.value)}`. Keep `className="composer__input"`, `placeholder`, `rows`.
- `handleSubmit()` (called by the button `onClick` and by Enter): constructs the `deps` object **inside the handler body** (so `window.pyry` is dereferenced only at interaction time, never during render — this keeps the server-rendered container test crash-free), calls `submitMessage(text, { sendCommand: window.pyry.sendCommand, dispatch, newMessageId: () => crypto.randomUUID() })`, and calls `setText('')` when it returns `true`.
- `onKeyDown` on the textarea: **Enter** (without Shift) → `preventDefault()` + `handleSubmit()`; **Shift+Enter** → default (newline). The send `<button>` keeps `type="button"`, `aria-label="Send"`, and its SVG.

`crypto.randomUUID()` is available in the Electron renderer (Chromium Web Crypto). Tests never hit it — they inject a stub `newMessageId`.

### Data flow

```
type in textarea ─▶ setText (local useState)
click Send / Enter ─▶ handleSubmit
                        └─▶ submitMessage(text, deps)
                              ├─ trim; empty? ─▶ return false (no effects)
                              ├─ id = newMessageId()
                              ├─ sendCommand(sendMessageCommand(SendMessagePayload))  [guarded]  ──▶ main/#65 ──▶ relay
                              ├─ dispatch(messageSent: MessagePayload{role:'user', same id})       ──▶ sessionStore
                              └─ return true ─▶ setText('')
                                                        │
daemon later echoes same message_id ──▶ messageReceived ──▶ appendUnique drops the duplicate
```

## State + concurrency model

- **Store slice:** `sessionStore.messages`, mutated only by dispatching `messageSent` (append) — single source of truth, unidirectional. No parallel state.
- **Ephemeral input:** component-local `useState`, ADR 0006. Never in the store.
- **Concurrency:** submit is synchronous and handler-driven (no `useEffect`, no `await`, no subscription). No cancellation/teardown surface — nothing outlives the click. `sendCommand` is fire-and-forget; the daemon's reply arrives later as its own event through the existing #18/#19 path.
- **Re-render:** `useState('')` re-renders only `Composer` on keystroke; the thread selects `selectMessages` separately and re-renders on store append. Selecting `dispatch` (stable) adds no extra renders.

## Error handling

| Failure mode | Handling | Surfaced how |
|---|---|---|
| `sendCommand`/`window.pyry` throws | `try/catch` in `submitMessage` step 4; `console.error` | Silent to the user (AC4: no crash). Optimistic echo still appended. |
| Whitespace-only / empty input | Early `return false`; no send, no dispatch, no clear | Nothing happens (AC1) |
| Daemon later re-echoes the sent message | `appendUnique` dedupe by `message_id` | Duplicate dropped; thread shows one bubble (AC3) |

There is deliberately **no** send-failure UI in this milestone (no banner, no retry, no echo rollback) — the store has no per-message delivery state and the ticket scopes none.

## Testing strategy

`npm test` (vitest). No DOM harness — the interaction logic is a plain function, tested directly (the pairing precedent). Type coverage under `npm run typecheck`; `npm run build` is the QA/salvage gate.

**`composerSend.test.ts` (new)** — call `submitMessage` with fake `sendCommand`/`dispatch` spies and a stub `newMessageId`. Scenarios:
- Whitespace-only (`'   '`, `''`) → returns `false`; neither spy called.
- Non-empty → returns `true`; `sendCommand` called exactly once with `sendMessageCommand(payload)` where `payload` is a `SendMessagePayload` (no `role`) carrying `MILESTONE_CONVERSATION_ID`, the stub id, and the **trimmed** text.
- Same id on both sides: the `message_id` on the `sendCommand` payload equals the `message_id` on the dispatched `messageSent.message`.
- Dispatched action is `{ type: 'messageSent', message: MessagePayload{ role: 'user', ... } }` with trimmed text.
- Guard: when `sendCommand` throws, `submitMessage` does not throw, still dispatches the echo, and returns `true`.
- Leading/trailing whitespace is trimmed before both the send payload and the echo.

**`sessionStore.test.ts` (extend)** — add `messageSent` cases beside the existing message tests:
- `messageSent` appends the message to `messages` and leaves `status` untouched.
- A `messageSent` followed by a `messageReceived` (or `messagesReceived`) with the **same `message_id`** yields a single message (dedupe holds across the optimistic → daemon-echo sequence — the core AC3 invariant).

**`ConversationScreen.test.tsx` (unchanged)** — the existing server-rendered smoke tests (`<textarea` present, `aria-label="Send"` present, empty store → 0 bubbles) stay green: the controlled textarea keeps `value`+`onChange` (valid under `renderToStaticMarkup`), and the container reads `dispatch` via `useSessionStore` (zustand v5 `getInitialState` under server render). The container's `handleSubmit` never runs during static render, so its `window.pyry` reference is never dereferenced in the test env.

## Open questions

- **Echo on persistent send failure.** This milestone appends the optimistic echo even when `sendCommand` throws (no delivery-state model yet). A future ticket that adds per-message delivery status may want to mark or roll back an echo whose send failed. Out of scope here — flagged so it isn't mistaken for an oversight.
- **Milestone conversation id value.** `'default'` is arbitrary-but-stable; the daemon echoes back whatever id it's sent. If #65's main-side path or the daemon expects a specific conversation id for the single milestone conversation, adjust the constant — it is the single change point. (No such expectation is visible in the wire contract, which treats `conversation_id` as opaque.)
