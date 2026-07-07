# Spec #94 — e2e: send a message from the composer and assert the streamed reply renders

**Ticket:** [#94](https://github.com/pyrycode/pyrycode-desktop/issues/94) · **Size:** S · **Security-sensitive:** no
**Split from #41** (full UI round-trip); the pair-to-connected half is #93, already landed.

## Files to read first

Turn-1 reading list. Paths are repo-relative; line ranges point at the exact contract to lift.

- `e2e/pair-to-conversation.spec.ts` (whole file, ~150 lines) — **the harness to copy.** Its local fixture block (`forwarder → daemon → page`, lines 56–90), the `encodePairingPayload` helper (92–96), the `DUMMY_TOKEN` discipline (34–37), the env-flag + isolated `--user-data-dir` launch (76–89), and the wait-for-Send-enabled precondition (150) are exactly what #94 extends. #94 changes **only** the `daemon` fixture (pass a reply-driving `buildReply`) and appends the send/assert steps.
- `src/main/daemonConnection.roundtrip.test.ts:207–245` — **the `buildReply` pattern to mirror.** The `message`-envelope reply construction (`encodeEnvelope({ id, type: 'message', ts, payload: { conversation_id, message_id, role: 'assistant', text } })`, lines 214–221) is the exact shape #94's fake daemon must return. Copy it; do not re-derive.
- `src/main/transport/fakeDaemon.ts:54–67, 124, 193–206` — `FakeDaemonOptions.buildReply` signature (`(inboundPlaintext) => Uint8Array`, default = verbatim echo), and `handleTransport` which invokes it once per inbound transport frame. Confirms the reply builder ignores its input and returns a fixed envelope.
- `src/main/transport/inboundMessage.ts:92–110` — **why the reply must be a `message`, not `send_message`.** `parseInboundMessage` routes `message`/`message_chunk` and returns `null` (ignored) for every other type, including `send_message`. A `send_message` reply (the default echo) renders no daemon bubble.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:41–49` — the product markup to assert on: `<div class="bubble bubble--{type}" data-message-role="{type}">{text}</div>`. `type` is `user` or `daemon`.
- `src/renderer/src/screens/conversation/messageViewModel.ts:27–36` — the adapter: wire `role: 'user' → type 'user'`, `role: 'assistant' → type 'daemon'`. This is why an `assistant`-role reply becomes `data-message-role="daemon"`.
- `src/renderer/src/screens/conversation/composerSend.ts:38–68, 95–108` — `submitMessage` mints one `message_id` and dispatches the optimistic `messageSent` (role `user`) regardless of send outcome; `composerAvailability` gates `canSend` on `status.type === 'connected'`. This is why Send is enabled only post-handshake, and why the optimistic user bubble appears synchronously.
- `src/renderer/src/store/sessionStore.ts:96–120, 138–140` — `reduceSession` appends via `appendUnique` (dedup by `message_id`); `selectMessages` returns all messages. Confirms the optimistic user echo (random UUID id) and the daemon reply (fixed id) render as two distinct bubbles, and the reply's `conversation_id` is not filtered on.
- `src/main/transport/codec.ts:112` — `encodeEnvelope(envelope: Envelope): Uint8Array`; `src/shared/wire/types.ts:40–61` — `Envelope` shape (`{ id: number, type, ts: string, payload }`) and `EnvelopeType`.
- `playwright.config.ts` — `testDir: './e2e'`, `workers: 1`, `fullyParallel: false`. New spec auto-discovered; runs serialized after #93 under `npm run e2e`.

## Context

#89 (`daemonConnection.roundtrip.test.ts`) proved the send→reply round-trip at the **transport layer** — that a sealed `send_message` reaches the fake daemon and a `message` reply comes back as a `messageReceived` daemon event at the renderer bridge. #93 (`pair-to-conversation.spec.ts`) proved the **UI pairing** half — driving the *built* app through the real pairing screen to a connected conversation with Send enabled.

#94 closes the gap between them: the automated **UI-level** send→stream proof. Starting from #93's connected end-state, it types into the composer, sends, and asserts both the optimistic user bubble and the streamed daemon reply render in the thread — exercising the full path composer → command channel → main-process outbound send → fake daemon → inbound decode → daemon-event channel → `daemonEventBridge` → `sessionStore` → `ConversationScreen` render. This is the automated side of the Phase-1 milestone; the manual live-stack version is runbook #13.

The renderer side is fully wired already (thread store-binding #69, `daemonEventBridge` App-level subscription, composer send #66/#31). **This ticket adds zero production code** — one new e2e spec asserting on existing product markup.

## Design

### One new file

`e2e/send-and-stream.spec.ts` — a **new** spec, not an edit to `pair-to-conversation.spec.ts`. Each Playwright spec launches its own app instance (workers:1, serialized), so #94 re-runs the real pairing flow to reach the connected screen, then sends. The reuse is the harness *pattern and fixtures*, not a shared running process. A new file also means **zero merge overlap** with #93's landed file.

Copy #93's local fixture block verbatim with **one change**: the `daemon` fixture passes a reply-driving `buildReply` instead of relying on the default echo. Everything else — `forwarder`/`page` fixtures, LIFO teardown ordering (`page → daemon → forwarder`), `encodePairingPayload`, `DUMMY_TOKEN`, the two `isPackaged`-gated env flags, the isolated `--user-data-dir`, the timeouts — is identical.

> **Duplication is the established pattern here.** #93's fixtures are explicitly file-local ("Local fixtures (this file only)", per the #40 decision that `electronApp.ts` stays scenario-agnostic). Do **not** refactor the shared fixture to add reply-driving; that would touch #93's surface and widen scope. Copy the block.

### The reply-driving `buildReply` (the one substantive addition)

The fake daemon's reply must be a **`message` envelope carrying `role: 'assistant'`** so `parseInboundMessage` routes it to `messageReceived` and the adapter maps it to `data-message-role="daemon"`. Contract (mirror `daemonConnection.roundtrip.test.ts:214–221`):

```
const REPLY_TEXT = 'streamed reply from the fake daemon'   // fixed literal, ≠ typed text
const buildReply = (): Uint8Array =>
  encodeEnvelope({
    id: <fixed number>, type: 'message', ts: <fixed ISO string>,
    payload: { conversation_id: 'default', message_id: 'reply-1', role: 'assistant', text: REPLY_TEXT }
  })
```

- `buildReply` **ignores its `inboundPlaintext` argument** — a fixed literal reply keeps the assertion deterministic (same rationale as #89).
- `message_id: 'reply-1'` is a fixed literal that cannot collide with the optimistic user message's `crypto.randomUUID()`, so both survive `appendUnique` as distinct bubbles.
- `conversation_id` is not filtered on by `selectMessages`; `'default'` (matching `MILESTONE_CONVERSATION_ID`) is faithful but any literal renders.
- `REPLY_TEXT` **must differ from the typed text** so the two bubble assertions (`data-message-role="user"` vs `"daemon"`) are unambiguous by both role selector and text.
- Import `encodeEnvelope` from `../src/main/transport/codec` and any wire types from `../src/shared/wire/types` (mirror #93's relative-path imports from `e2e/`). These are `.test`/e2e-only importers of the permissive doubles — same discipline as #89; nothing enters the production graph.

### Test flow (single `test(...)` body)

1. **Reach connected** (reuse #93's steps verbatim as the precondition): paste the synthetic payload, `Pair`, `Confirm`, wait for `.conversation` visible, then `await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })`. **This wait is load-bearing** — Send is gated on the `connected` daemon event, not on the route; sending before it fires means the `canSend` guard drops the send and no optimistic echo posts (`composerSend.ts:63–67`).
2. **Type + send:** fill `textarea.composer__input` (or `page.getByPlaceholder('Message…')`) with a fixed typed literal (e.g. `'hello from the composer'`), then trigger send via Send-button click (or `Enter`).
3. **Assert optimistic user bubble:** `expect(page.locator('.bubble[data-message-role="user"]')).toHaveText(<typed text>)`. This is the optimistic-echo proof (dispatched synchronously inside `submitMessage`, before any reply).
4. **Assert streamed daemon bubble:** `expect(page.locator('.bubble[data-message-role="daemon"]')).toHaveText(REPLY_TEXT)` (auto-waited through the real handshake+round-trip; bounded by a generous timeout like `MESSAGE_TIMEOUT_MS`).

### Data flow (why each assertion holds)

```
composer input → submitMessage → sendCommand ─(command channel)→ main outbound send ─(Noise)→ fake daemon
                     │                                                                              │
          dispatch messageSent (role:user, random id)                                    buildReply → message envelope
                     │                                                                              │
              sessionStore.appendUnique                                          main decode → messageReceived event
                     │                                                                              │
        .bubble[data-message-role="user"]  ◄── ConversationScreen ──►  daemonEventBridge → sessionStore.appendUnique
             (AC3, optimistic, synchronous)                                                         │
                                                                          .bubble[data-message-role="daemon"] (AC4)
```

## State + concurrency model

No new state. The renderer stores are the existing `sessionStore` singleton; the e2e drives the *built* app out-of-process via Playwright and asserts on rendered DOM only — it never imports the store. Fixture lifecycle is Playwright's `test.extend` with the `forwarder → daemon → page` dependency chain forcing **LIFO teardown** (`page → daemon → forwarder`): the app closes first so its supervisor cannot churn-reconnect or emit a spurious `failed` when the fake target's socket drops. The fake daemon is a single-round-trip responder — it settles `ok:true` after the one reply and the session stays open; `buildReply` is invoked exactly once (the client sends exactly one `send_message`).

## Error handling

No production error paths added. Failure modes are test-observability concerns:

- **Handshake never completes** → Send stays disabled → step 1's `toBeEnabled` times out with a descriptive Playwright failure (same guard #93 relies on). Do not proceed to send if Send never enables.
- **Reply routed but wrong envelope type** → if a developer regresses `buildReply` to a `send_message` (the default-echo trap), `parseInboundMessage` ignores it, no `messageReceived` fires, and step 4 times out. The fixed-literal `message`/`assistant` reply is the guard against this.
- **No failure diagnostic serializes the payload, token, or message plaintext** — assertions read DOM visibility/text and enabled-state only, matching #93's discipline. The typed text and reply text are non-secret test literals, so asserting on them is fine.

## Testing strategy

This ticket **is** the test. Coverage:

- **AC1** — reaches Send-enabled through the real pairing UI + fake target (reuses #93's precondition).
- **AC2** — types and sends (button click or Enter; either exercises `submitMessage`).
- **AC3** — `.bubble[data-message-role="user"]` carries the exact typed text, asserted as the step **before** the reply assertion. The optimism is structural (synchronous dispatch in `submitMessage`), not timing-dependent.
- **AC4** — `.bubble[data-message-role="daemon"]` carries `REPLY_TEXT`, auto-waited through the genuine handshake + Noise round-trip.
- **AC5** — runs and passes under `npm run e2e` (build + `playwright test`; auto-discovered in `e2e/`).

**Anti-flake note (honor AC3 without a race):** assert the user bubble as a distinct step *before* the daemon-bubble step, but do **not** assert the daemon bubble is *absent* at the time of the user-bubble check. The reply is a real network round-trip and could land fast; a "user present AND daemon absent" assertion would be racy. Sequential `expect`s (user, then daemon) satisfy the AC's "before the reply" intent — the daemon reply is a separate role-selected bubble, so the user-bubble assertion is unambiguous regardless of reply timing.

No unit tests, no production code, so `npm run typecheck` covers the spec's types and `npm run e2e` is the behavioral gate. The transport-layer equivalents already have vitest coverage (#89); this is the UI-level complement.

## Open questions

- **Send trigger — click vs Enter.** Either works (`handleSubmit` is shared). Recommend the **Send-button click** (`page.getByRole('button', { name: 'Send' }).click()`) — it's the same locator step 1 already waited on, so no second selector. Developer's discretion; both satisfy AC2.
- **Typed-text input locator.** `page.getByPlaceholder('Message…')` (the composer placeholder) or `textarea.composer__input`. Prefer the placeholder role-ish locator for resilience to class renames; either is fine.
- Neither blocks implementation.
