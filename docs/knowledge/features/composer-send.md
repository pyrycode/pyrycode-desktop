# Composer send

Typing updates a retained draft. Submission obtains the authenticated public device
identity from main, then mints a `message_id`, emits a host-addressed `sendMessage`
command and draws a local pending row. Production
retains that row until a matching authoritative user item takes over. This is the counterpart to the
[outbound send path](outbound-send-path.md), which encrypts the command for the relay.

Introduced in [#66](../codebase/66.md). Entirely `src/renderer/` — no keys, sockets, Noise handshake, or preload internals; the composer only calls the typed `window.pyry.sendCommand` bridge and dispatches into the store.

## What it does

The [conversation shell](conversation-shell.md) uses the same submit helper for button,
Enter and Actions-menu sends:

- The input is **controlled** — typing updates a session draft keyed by host and conversation; a successful typed submit clears only that draft; whitespace-only input is retained.
- **Submit** (the send button or Enter) mints a `message_id` via `crypto.randomUUID()`, assembles a `SendMessagePayload` for the active conversation, and emits `window.pyry.sendCommand(sendMessageCommand(payload))`.
- Production passes `threadSend` and retains the row in the host/conversation-scoped
  pending-send store. Both legacy echo writers are bypassed. The old helper branch
  remains only for retained callers and tests.
- A bridge exception marks a still-local row `Not sent`, rolls attachments back and
  returns false so the container retains its draft. An already accepted daemon item
  remains authoritative.

Connection explanations and Reconnect/Re-pair live in the conversation's
[Top overlay](conversation-shell-chrome.md#connection-banner-279), with
[unchanged recovery predicates and click-time host checks](conversation-shell-composer-repair-button.md).
The composer status row has no connection chip or Reconnect button; its remaining
occupants keep their connected-only priority. Send gating and automatic retries
retain their existing policy.

The local row represents submission, not confirmed delivery. Accepted daemon items
render through [the supplied thread view](conversation-shell.md#what-it-does).

## How it works

[`createThreadSendStore`](../../../src/renderer/src/store/threadSendStore.ts) and
`submitMessage`'s optional `threadSend: { store, deviceId }` input form an explicitly
injectable adapter. Its owner supplies the trusted opaque device identity, snapshots,
transport feedback and subscriptions. `ThreadItemsTimeline` receives matching scoped
pending/feedback, connection and action inputs through `sendInputs`. The production
[thread runtime](thread-runtime.md#sending-and-authenticated-identity) owns these
subscriptions and composes settlement alongside independent session/read adapters.
The no-argument `window.pyry.deviceIdentity()` call returns only the lowercase
hexadecimal public key used by Noise authentication, or `identity-unavailable`.
Private key material never crosses IPC. Each submission captures identity and
selection ownership before sending. A failed identity lookup, lost owner or false
submit result retains recoverable text without overwriting a newer draft.
The pending store owns only local sends and newest-send feedback. See the [settlement design](../../specs/architecture/1906-thread-send-settlement.md).

- [Internals](composer-send-internals.md) — submit helper, optimistic echo, connection and keyboard
  gates, attachment handling, and [the controlled composer](composer-send-internals.md#3-the-controlled-composer--conversationscreentsx).
  The composer section covers retained host/conversation drafts, literal message quotes and one-time
  reply focus after permission coverage clears.
- [Edge cases and limitations](composer-send-limits.md) — unavailable sends, bridge failure,
  attachment rollback, interaction coverage and the equal-ID history boundary.
- [Related documents](composer-send-related.md) — transport, store, attachment and design references.

## Data flow

```text
selected/creating host + conversation -> retained draft coordinates
  typing / slash completion -> setDraft(host, conversation, exact text)
  Reply -> appendMessageQuote(latest draft, role, source) -> setDraft + one-time pane focus request
  pane remount / return from another screen -> selectDraft -> controlled textarea + sizing

Send / Enter -> handleSubmit -> sendText(text)
  unavailable host / pending model recall -> false; retain draft and attachments
  production thread path -> capture draft and attachment ownership
    await deviceIdentity; leave draft editable
    failure / changed connection or selection -> roll back attachment claim; keep draft
    valid identity -> submitMessage with captured deviceId and host
    false result -> helper owns attachment rollback; keep draft
    true result -> clear only the unchanged submitted draft; preserve later edits
    return false while invoke is pending; continuation owns completion
  retained helper path -> submitMessage(text, activeConversationId, deps)
    whitespace-only / no conversation -> false; retain draft
    explicit threadSend without serverId -> false; retain draft and attachments
    mint message_id; take pending attachments
    explicit threadSend + serverId -> retain scoped pending row and captured deviceId
    otherwise -> append userText echo to flat and host-owned held timelines
    send trimmed text through guarded bridge
    return true -> onMessageSent -> clear only selected draft
      -> content-free composer-draft-cleared diagnostic
    bridge exception -> attachment rollback + still-local Not sent; return false

Actions command -> sendText(command) -> same submission path; no draft clear
```

Production clearing happens after identity access and successful local submission,
only if the captured draft is unchanged. A caught bridge exception returns false
and retains the draft. It does not wait for delivery acknowledgement. Other drafts remain untouched. Draft storage
preserves whitespace exactly; trimming belongs only to submission.

For the injected route, `retain(host, conversation, deviceId, event)` captures the
supplied sender identity per send before the bridge can synchronously report acceptance.
`select(host, conversation).pending` is the inventory of local rows; it survives view
switches and disconnects. `localSendPending` tracks only the newest send's feedback,
so it cannot serve as that inventory. Missing identity remains missing for that send;
later selection or identity availability cannot turn it into message-ID-only matching.

Both live and catch-up owners call `settle(snapshot)` on the retained
[`ThreadSnapshot`](thread-item-store.md). Within its exact host/conversation, only a
`user_message` with usable, nonempty `content.device_id` and `content.message_id`
matching the captured pair removes a pending row. Enclosing-record and field
truncation/drop markers invalidate identity, including malformed marker lists. Peer
devices with equal message IDs, other scopes and equal display text cannot settle it.
Hidden facts participate too: the first observed item can already be delivered,
dropped or lost. Repeated unchanged snapshots publish nothing.

Once the newest send is accepted, feedback follows its scoped `(epoch, item id)`
even if later revisions lack usable content identities. A new epoch must establish
ownership again with both captured identities; item-ID reuse alone grants nothing.
The no-change comparison includes accepted epoch and item ID: strict re-establishment
must publish even when pending count and queued feedback are unchanged, or a later
identity-unavailable revision would incorrectly clear `Waiting for Claude`.

`feedback(host, conversation, event)` updates only still-pending rows. Before
acceptance, they retain `Sending`, `Waiting for connection` and `Not sent` feedback.
Shown, active queued acceptance changes the newest feedback to `Waiting for Claude`;
terminal delivery, authoritative hiding/drop and explicit loss clear it. Settling an
older send leaves the newest feedback intact. Late transport feedback cannot recreate
an accepted row or overwrite daemon content, including after a synchronous acceptance
followed by a bridge exception.

The owner calls `deleteConversation(host, conversation)` when a conversation is
retired, `removeHost(host)` for host removal and `dispose()` at owner teardown.
These clear pending rows, feedback and accepted ownership in their scope; disposal
also rejects later writes. Cleanup must follow ownership rather than pane navigation,
so several pending sends remain available when the operator returns to a chat.
