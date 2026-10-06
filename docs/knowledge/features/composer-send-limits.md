# Composer send — edge cases and limitations

Part of [Composer send](composer-send.md).

## Edge cases and limitations

Reply drafting remains available in saved/offline chats. Equal-ID drafts on separate hosts are isolated;
[the controlled composer](composer-send-internals.md#3-the-controlled-composer--conversationscreentsx)
distinguishes that behavior from the history-persistence limitation tracked in #1811.

- **Not connected** ([#31](../codebase/31.md); the caption retired by [#968](../codebase/968.md)) — while `selectStatus` is not `connected`, the send button is `disabled` and the `handleSubmit` early-return inerts the Enter path. No `sendCommand`, no echo, input not cleared. The textarea stays enabled (drafting allowed); the control re-enables reactively on connect. `composerAvailability` never touches `status.error`, so no daemon-supplied string reaches this gate at all; the same non-connected state shows the prominent [connection banner](conversation-shell-chrome.md#connection-banner-279) (#279), which is now the sole announcement of the transition, and in the `error` arm the status row directly above the message box carries [the chip or a recovery button](conversation-shell-composer-error-chip.md#composer-error-chip-797) (#797/#963).
- **Whitespace-only / empty input** — early `return false`; no send, no dispatch, no clear (AC1).
- **Send-bridge failure** — `try/catch` swallows it (`console.error`); the process does not crash and the optimistic echo still appends (AC4). There is deliberately **no** send-failure UI (no banner, retry, or echo rollback) — the store has no per-message delivery state this milestone. Since #1055, one thing **is** rolled back on this path: a `takeAttachments` take is undone via its own `rollback()`, and the echo's `attachments` field — unlike its `text` — is withheld, because a frame that never reached the bridge named no ids ([attachment handling](composer-send-internals.md#10-attachments-named-on-the-outbound-frame--takeattachments-1039-reworked-by-1055)).
- **Daemon re-echoes the sent message** — the same-`message_id` copy is dropped by `appendUnique`; the thread shows one bubble (AC3).
- **Interaction coverage uses fake-transport Playwright.** `e2e/conversation-switch-remount.spec.ts`
  drives exact restoration, edits/emptying, Settings round trips, Send/Enter clearing without an
  acknowledgement, rejected submission, completion and Actions preservation. Store unit tests cover
  host/conversation isolation (including equal IDs), collision-safe keys and fresh-session emptiness.
  Static renderer tests still cannot execute effects or input handlers.
  `copyMessageText.test.ts` pins both quote labels, literal multiline/embedded-quote text, draft
  separators, long sources and repeated append. `e2e/message-reply.spec.ts` covers activation,
  focus/caret, editing/send, host isolation and offline drafting; counted passes and the history skip
  are recorded in [message-bubble testing](conversation-shell-message-bubble.md#testing).
- **`auto-grow` on the textarea shipped in #1056** — `field-sizing: content` plus a `max-height` on `.composer__input`, no TSX change; the box grows a line at a time to a five-line ceiling, then scrolls. See [Composer message box § the auto-grow](conversation-shell-composer-message-box.md#the-box-grows-with-the-draft-to-a-five-line-ceiling-1056). *(The "single active conversation, `MILESTONE_CONVERSATION_ID`" limitation this bullet used to name was closed by #448, which added the `conversationId` parameter documented in [internals](composer-send-internals.md); the older narrative sections in [internals](composer-send-internals.md) still describe the pre-#448/#179 shape and are due a fuller pass — flagged here rather than silently left contradicting the current signature.)*
- **A submit refused by `submitMessage`'s two early `false` returns reads no clock at all**
  ([#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013)) — `deps.now?.()` sits below both the
  whitespace-only and null-conversation guards, alongside the echo it stamps, so a refused submit performs
  neither the wire send nor the clock read. `now` omitted entirely (as every pre-#1013 test literal is)
  produces an echo whose `createdAt` is `undefined` — a legal item, not a defect; [#1014](https://github.com/pyrycode/pyrycode-desktop/issues/1014)
  draws it as the [thread timeline](thread-timeline-limits.md#edge-cases-and-limitations) meta row's empty slot.
- **A submit refused by `submitMessage`'s two early `false` returns takes no attachments either**
  ([#1039](https://github.com/pyrycode/pyrycode-desktop/issues/1039)) — `deps.takeAttachments?.()` sits at
  the same guarded position as `now`, so a refused submit neither sends nor drains the pending set; the
  files the operator attached survive for the next send attempt. An unwired `takeAttachments`, or one that
  answers an empty array, both produce `echo.attachments === undefined` — the store never sees `[]`. See [attachment handling](composer-send-internals.md#10-attachments-named-on-the-outbound-frame--takeattachments-1039-reworked-by-1055).
- **A refused submit mints no `message_id` at all** ([#1213](https://github.com/pyrycode/pyrycode-desktop/issues/1213))
  — unlike `now`/`takeAttachments`, `deps.newMessageId()` was already called only past both early guards
  before this ticket, so there is nothing new to guard: a whitespace-only or null-conversation submit never
  reaches step 2, never sends, and never produces an echo for a later drop to find.

