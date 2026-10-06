# Composer send (optimistic echo)

The **renderer half of the send flow**: the user types a message in the conversation composer, submits it, and sees it appear in the thread **immediately** — before the daemon confirms it. Typing drives controlled input state; a submit mints a `message_id`, emits a `sendMessage` command over the existing bridge, and appends the just-sent message to the [session store](session-store.md) optimistically. This is the counterpart to the [outbound send path](outbound-send-path.md), which turns that command into an encrypted `send_message` envelope on the relay ([#65](../codebase/65.md)).

Introduced in [#66](../codebase/66.md). Entirely `src/renderer/` — no keys, sockets, Noise handshake, or preload internals; the composer only calls the typed `window.pyry.sendCommand` bridge and dispatches into the store.

## What it does

Wires the previously-inert composer (an uncontrolled `<textarea>`, a click-less send button in the [conversation shell](conversation-shell.md)) into a working send:

- The input is **controlled** — typing updates a session draft keyed by host and conversation; a successful typed submit clears only that draft; whitespace-only input is retained.
- **Submit** (the send button or Enter) mints a `message_id` via `crypto.randomUUID()`, assembles a `SendMessagePayload` for the active conversation, and emits `window.pyry.sendCommand(sendMessageCommand(payload))`.
- The just-sent message is appended to the store **optimistically** as a wire `MessagePayload { role: 'user' }`, carrying the **same `message_id`** sent on the wire — so the store's existing `message_id` dedupe drops the daemon's later echo instead of double-posting.
- A failure of the send bridge does not crash the window; the echo still posts.

The optimistic echo only becomes *visible* because [#69](../codebase/69.md) bound the thread to the store. #66 owns the store append (verifiable at the store level); #69 owns the render (`role: 'user'` → a `user` bubble). The two share the store as their seam.

## How it works

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
  submitMessage(text, activeConversationId, deps)
    whitespace-only / no conversation -> false; retain draft
    mint message_id; send trimmed text through guarded bridge
    append userText echo to flat timeline and host-owned held timeline
    return true -> onMessageSent -> clear only selected draft
      -> content-free composer-draft-cleared diagnostic

Actions command -> sendText(command) -> same send and echo; no draft clear
```

Clearing happens at local success, even if the bridge throws and `submitMessage` catches it;
it does not wait for delivery acknowledgement. Other drafts remain untouched. Draft storage
preserves whitespace exactly; trimming belongs only to submission.

