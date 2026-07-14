# 435 — Milestone e2e: drive the `list → thread` step so the two pairing specs reach the connected thread

**Ticket:** #435 · **Size:** S · **Security-sensitive:** no · **Design source:** N/A (test-infra repair; drives existing product screens, adds no new UI)

## Files to read first

- `e2e/pair-to-conversation.spec.ts` (whole, ~152 lines) — #93. The drive to repair: paste → Pair → fingerprint → Confirm, then the two failing assertions (`await expect(conversation).toBeVisible()` at :144, `Send` enabled at :150) that now time out because Confirm lands on `list`, not `thread`. The daemon fixture at :62–69 currently passes **no** `buildReply` (default echo).
- `e2e/send-and-stream.spec.ts` (whole, ~175 lines) — #94. Same drive prefix; additionally has a `buildReply` (:58–72) returning a fixed assistant `message`, and the send/stream assertions (:160–173) that must be preserved. Its daemon fixture passes `{ url, buildReply }` at :97.
- `src/main/transport/fakeDaemon.ts:100–128, :369–388` — `FakeDaemonOptions.buildReply` contract (`(inboundPlaintext: Uint8Array) => Uint8Array`, default = verbatim echo) and `handleTransport`: it decrypts each inbound transport frame, calls `buildReply(plaintext)`, and seals+streams the result. **One reply per inbound; every inbound gets a reply.** This is the seam we drive — no production change.
- `src/renderer/src/store/conversationListBridge.ts:96–150` (`ConversationListData`) — the **only** app-level bridge that auto-fires a request on the connected rising edge: `requestConversations` → a bare `list_conversations` frame. Its `conversationsReceived → setConversations` seam is a whole-list replace (idempotent).
- `src/renderer/src/screens/channels/ChannelList.tsx:280–338` (`renderBody`, `Row`) — a non-empty list renders `.channel-list__row-open` buttons whose `onClick={onOpen}`; the empty list renders only `.channel-list__empty` ("No conversations yet"), no clickable row. This is why the default echo daemon has **no** in-drive `list → thread` path.
- `src/renderer/src/PairedShell.tsx:82–118` + `src/renderer/src/pairedRoute.ts:46–56` — `dispatch({ type: 'open' })` → `route='thread'`. The row's `onOpen` and the FAB's `useConversationCreatedNav` both land here; the row path sets **no** active conversation.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:114, :170–186` — `.conversation` root always renders; `activeConversation` is read as a narrow slice and the workspace chip **self-gates to null**, so a list-opened thread (null active conversation) renders `.conversation` + the Send composer. Confirms the row path (null active conversation) satisfies both specs' assertions.
- `src/shared/wire/types.ts:523–537` — `ConversationSummary` (7 required fields) and `ConversationsPayload { conversations: ConversationSummary[] }`, the seeded reply's payload shape.
- `src/main/transport/inboundMessage.ts:964–976` — the inbound `conversations` arm: parses and returns unconditionally, **no `in_reply_to` correlation** required. A fixed-id seeded reply renders.
- `src/main/transport/listConversationsEnvelope.ts:40–44` + `sendMessageEnvelope.ts:39` — the outbound wire `type` strings the daemon's `buildReply` branches on: `'list_conversations'` (bare, `payload: {}`) and `'send_message'`.

## Context

`e2e/pair-to-conversation.spec.ts` (#93) and `e2e/send-and-stream.spec.ts` (#94) are **red on `main`** (`npm run e2e` is not CI-gated, so the drift went unnoticed). Both drive the real pairing UI and, immediately after Confirm, assert `.conversation` visible + `Send` enabled. Since **#140** (PairedShell nav-shell), the paired route enters at `route='list'` (the ChannelList), not `ConversationScreen`. So `.conversation` and `Send` never mount at that point and both specs time out.

The default fake daemon (echo) seeds no conversation list, so ChannelList shows "No conversations yet" with no clickable row — there is **no in-drive `list → thread` path**. The fix is inserting a real-UI `list → thread` step before the Send-enabled assertion, **in the two spec files only** (the shared-fixture extraction is #433's job, which resumes on this foundation).

This is test-infrastructure repair: **no production code changes.** The only edits are to the two `e2e/*.spec.ts` files.

## Design decision: seed a one-row conversation list, then click the row (Path 1)

The ticket offers two candidate `list → thread` paths; the choice is load-bearing because it becomes the default fake-daemon reply contract that #433's `launchPairedApp` — and transitively the #422–#429 / #434 / #420 batch — inherit. **Choose Path 1 (seed a one-row `conversations` reply; drive a ChannelList row click).**

Rationale — the deciding factor is a race that only Path 1 avoids:

- **Path 1 gives a free, deterministic connected gate.** `ConversationListData` fires `requestConversations` **only on the connected rising edge**. So the seeded one-row `conversations` reply — and therefore the clickable row — appears **only after the handshake completes**. Playwright's auto-wait on the row selector is thus a connected gate: when the row is clickable, the daemon is connected, so opening the thread finds `Send` already enabled. No extra gating logic.
- **Path 2 (New-discussion FAB) races.** The FAB is present on the empty list immediately after Confirm — before any connected signal exists on the list screen (the two-dot status aside, there is no load-bearing "connected" affordance to await there). Clicking it fires `create_conversation`; if the session is not yet connected the outbound is dropped (the `send_message` `canSend` posture), no `conversationCreated` returns, and the drive hangs. Making Path 2 safe would require inventing a connected gate on the list screen — strictly more work than Path 1, for a shared fixture that the whole batch runs (a flaky gate flakes the batch).
- Path 1 does **not** constrain #434 — the stateful `conversationStateFake` (create-flow, `buildReplyFrames`) layers on top later; #435 stays on the current single-`buildReply` fake per the ticket's AC4.

### The `list → thread` drive step (both specs, identical)

Replace the post-Confirm "assert `.conversation`" with: **wait for the seeded row, click it, then assert.** The row selector `.channel-list__row-open` (exactly one seeded row) is unambiguous and its auto-wait is the connected gate. Contract of the inserted step (a ~2-line insertion before the existing `.conversation`/Send assertions):

```
await page.getByRole('button', { name: 'Confirm', exact: true }).click()
// #140: pairing lands on the ChannelList (route='list'). The seeded one-row list appears only
// after connect (requestConversations fires on the connected edge), so the row is the connected
// gate; clicking it drives the real list→thread `open` nav.
await page.locator('.channel-list__row-open').click()
await expect(conversation).toBeVisible()
await expect(sendButton).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })
```

- AC3 (real product UI): `.channel-list__row-open` is the actual row button (`onClick={onOpen}`), not a test hook, forced route dispatch, or store mutation.
- The pre-Confirm assertions (`.conversation` absent while on the pairing screen) are unchanged. The narrative comment blocks that describe the old "Confirm → conversation" end-state (#93 :142–150, #94 :133–157) should be updated to describe the list→thread step; that is editorial and left to the developer.

### The fake-daemon reply contract (`buildReply`)

Both specs pass a `buildReply` into their `startFakeDaemon({ url, buildReply })` fixture. Share one seed builder between both files (or duplicate the small literal — the fixture extraction that dedupes it is #433's job; **do not** extract a shared helper here).

**Seed builder** — a `conversations` reply carrying one clickable row:

- Envelope: `encodeEnvelope({ id: <fixed>, type: 'conversations', ts: <fixed>, payload: { conversations: [ROW] } satisfies ConversationsPayload })`.
- `ROW: ConversationSummary` — all 7 fields present, fixed literals: `is_promoted: false` (an ad-hoc discussion → renders in "Recent discussions"), `is_archived: false` (shows in the main list regardless of any archived filter), a non-null `name` (opaque display text), `cwd` an opaque path string, `last_message_ts`/`last_used_at` fixed RFC3339 literals. `id` a fixed literal (never inspected by the drive). No `Date.now()` / randomness — fixed literals keep the fake deterministic (the fakeDaemon convention).
- `id`/`ts` are structurally required by `decodeEnvelope`/`parseInboundMessage` but their values are not inspected; no `in_reply_to` is needed (inboundMessage.ts:964).

**#93 (`pair-to-conversation.spec.ts`) — unconditional seed.** #93 never sends `send_message`, and the seed's whole-list-replace is idempotent, so `buildReply` can ignore the inbound and always return the one-row `conversations` reply. Every non-list bridge filters `conversationsReceived` out (only `conversationListBridge` consumes it), and a `conversations` reply triggers no re-request (`shouldRefreshList` is false for it), so any other inbound frame (e.g. a thread-mount request after the row click) is answered harmlessly. New imports: `encodeEnvelope` from `../src/main/transport/codec`, `ConversationsPayload`/`ConversationSummary` from `../src/shared/wire/types`. Wire it into the daemon fixture (`startFakeDaemon({ url: forwarder.url, buildReply })`, replacing the bare `{ url }`).

**#94 (`send-and-stream.spec.ts`) — dispatcher.** #94 must still return the assistant `message` on `send_message` (its existing REPLY_TEXT reply, preserved verbatim) **and** seed the row for the auto-fired `list_conversations`. Branch on the decoded inbound `type`:

```
const buildReply = (inbound: Uint8Array): Uint8Array => {
  switch (decodeEnvelope(inbound).type) {
    case 'send_message': return <the existing assistant `message` reply (unchanged)>
    default:             return <the one-row `conversations` seed>
  }
}
```

- The `default` arm (not an explicit `list_conversations` case) is deliberate: it answers the auto-fired `list_conversations` **and** any other non-send inbound (thread-mount requests, future auto-fires) with the idempotent seed — mirroring #94's existing constant-reply-with-dedup robustness. `send_message` is the only branch that must be explicit, so a regression to echoing it (the default-echo trap the current #94 comment warns about) still fails the daemon-bubble assertion.
- New import: add `decodeEnvelope` to #94's existing `../src/main/transport/codec` import; add `ConversationsPayload` to its `../src/shared/wire/types` import.
- The send/stream assertions (:160–173: optimistic user bubble by `[data-message-role="user"]`, streamed daemon bubble by `[data-message-role="daemon"]` = REPLY_TEXT) are **unchanged** — the row click is inserted before them, the send logic after.

## State + concurrency / timing model

- **No store or transport code is touched.** The specs drive real product state flow: Confirm → App route flips to `conversation` → `PairedShell` mounts at `list` → handshake completes → `connected` event enables `Send` **and** `ConversationListData` fires `requestConversations` → daemon seeds the row → row renders → click → `dispatch({ type:'open' })` → `route='thread'` → `ConversationScreen` mounts (null active conversation, self-gated).
- **The connected gate is the row's appearance**, not a timer. Playwright auto-waits on `.channel-list__row-open`; because the seed only arrives post-`connected`, the click cannot fire before the handshake. Downstream, `Send` is already enabled, so `toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })` resolves immediately (the generous timeout is retained as headroom for a cold runner).
- **Teardown is unchanged.** The LIFO forwarder → daemon → page fixture chain (app closes first) is preserved verbatim; adding a `buildReply` does not change lifecycle.
- **No request loop:** `conversationsReceived` never triggers another `list_conversations` (`shouldRefreshList` returns false for it), and the seed is a whole-list replace, so repeated seed replies converge on the same single row.

## Error handling / faithfulness

- The fake daemon stays test-only and is never imported into the production graph (its `*.spec.ts` importers are unchanged in kind). No key/token/plaintext is serialized in any diagnostic; the assertions read DOM visibility/enabled-state/text only. The seeded row's `name`/`cwd` are non-secret literals.
- Faithfulness caveat (acceptable for a drive-enabling fake, documented in the spec comment): #94's `default` arm answers a non-`send_message` request (e.g. `list_conversations`) with a `conversations` reply — correct for `list_conversations`, and harmless for any other (each bridge filters to its own arm). The fake is enabling a UI drive, not modeling the daemon's full reply table; #434 is where a stateful, type-faithful reply table lands.

## Testing strategy

- **The gate is `npm run e2e`** (= `npm run build` + Playwright, `workers:1`). `e2e/` is in neither tsconfig, so `npm run typecheck` does not validate these specs — the developer must run `npm run e2e` locally and confirm both specs pass.
- **AC1:** `pair-to-conversation.spec.ts` passes — after Confirm, the drive clicks the seeded row into the thread and asserts `.conversation` visible + `Send` enabled (Send gated on the `connected` daemon event; not weakened to a bare `.conversation` check).
- **AC2:** `send-and-stream.spec.ts` passes — reaches the same connected thread via the row click, then types + sends and observes both the optimistic user bubble and the streamed daemon reply (existing role-selector + text assertions preserved).
- **AC3:** the `list → thread` step is a real `.channel-list__row-open` click — no test hook, forced dispatch, or store mutation.
- **AC4:** the drive uses the current fake daemon with a per-run `buildReply` (a minimal, test-only reply builder in the specs) — no dependency on #434's `conversationStateFake`. `FakeDaemonOptions.buildReply` already exists; **no production-code change.**
- **AC5:** `npm run build` and `npm test` stay green — they scan `src/`, which is untouched, so they are unaffected by the `e2e/` edits.

## In-flight overlap: #433 (downstream, no block)

The file-overlap check flags **#433** touching both spec files. This is **not** a sibling collision: **#435 is `blocking` #433** (verified: #435's `blockedBy` set is empty; #433 is DEV-BLOCKED, `rework-count:1`, routed back to PO). #433 is gated behind this ticket — when #435 merges, #433 unblocks and its developer re-creates the feature branch from the new `main`, so its stale drive is discarded and no merge conflict is possible. Setting a reverse block (`#435 blockedBy #433`) would create a dependency cycle and deadlock the whole #422–#434 batch. **No block is set; proceed.**

## Open questions

- None blocking. The seeded `ConversationSummary` field values (`name`, `cwd`, `id`, timestamps) are free literals; the developer may pick readable values. The narrative comment rewrites in both specs (old "Confirm → conversation" story → the list→thread step) are editorial.
