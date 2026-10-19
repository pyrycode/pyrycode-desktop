# Composer send — edge cases and limitations

Part of [Composer send](composer-send.md).

## Edge cases and limitations

Reply drafting remains available in saved/offline chats. Equal-ID drafts on separate hosts are isolated;
[the controlled composer](composer-send-internals.md#3-the-controlled-composer--conversationscreentsx)
distinguishes that behavior from the history-persistence limitation tracked in #1811.

- **Not connected** ([#31](../codebase/31.md); the caption retired by [#968](../codebase/968.md)) — while the open host’s status is not `connected`, the send button is `disabled` and the `handleSubmit` early-return inerts the Enter path. No `sendCommand`, no echo, input not cleared. The textarea stays enabled (drafting allowed); the control re-enables reactively on connect. `composerAvailability` never touches `status.error`, so no daemon-supplied string reaches this gate at all; the same non-connected state shows [the Top overlay’s connection explanation](conversation-shell-chrome.md#connection-banner-279), which owns one atomic polite connection/restoration announcement. Reconnect and Re-pair use overlay Error action pills; the composer status row has no connection chip or button.
- **Whitespace-only / empty input** — early `return false`; no send, no dispatch, no clear (AC1).
- **Send-bridge failure** — a synchronous exception returns `false`, emits only the
  fixed failure diagnostic and rolls back the attachment take. The draft remains
  recoverable. A still-local ordinary row keeps its text and attachments with Not
  sent feedback; accepted daemon content remains authoritative. Ack-only resets
  have no local row to mark, but retain the same draft/attachment recovery.
- **Ack-only resets** — after trimming, case-sensitive `/clear` or `/reset` followed
  by Unicode whitespace or end-of-input skips pending retention, including commands
  with arguments. The bridge still receives trimmed text, the minted ID and any
  attachment IDs. Existing unrelated pending rows and their feedback survive.
  `/clear-cache`, `/resetfoo`, uppercase variants, zero-width-space suffixes and
  other slash commands retain ordinary settlement.
- **Ordinary acceptance** — transport ack, matching display text and session dividers
  cannot settle a pending row. A matching authoritative user item's captured
  device/message identity replaces it; no reset-specific ack settlement is added.
- **Interaction coverage uses fake-transport Playwright.** `e2e/conversation-switch-remount.spec.ts`
  drives exact restoration, edits/emptying, Settings round trips, Send/Enter clearing without an
  acknowledgement, rejected submission, completion and Actions preservation. Store unit tests cover
  host/conversation isolation (including equal IDs), collision-safe keys and fresh-session emptiness.
  Static renderer tests still cannot execute effects or input handlers.
  `copyMessageText.test.ts` pins both quote labels, literal multiline/embedded-quote text, draft
  separators, long sources and repeated append. `e2e/message-reply.spec.ts` covers activation,
  focus/caret, editing/send, host isolation and offline drafting; counted passes and the history skip
  are recorded in [message-bubble testing](conversation-shell-message-bubble-testing.md#testing).
- **`auto-grow` on the textarea shipped in #1056** — `field-sizing: content` plus a `max-height` on `.composer__input`, no TSX change; the box grows a line at a time to a five-line ceiling, then scrolls. See [Composer message box § the auto-grow](conversation-shell-composer-message-box.md#the-box-grows-with-the-draft-to-a-five-line-ceiling-1056).
- **Refused submissions have no take, ID or clock effects.** Whitespace-only input,
  a null conversation or missing host returns before `newMessageId`,
  `takeAttachments` and `now`. A reset is submitted but skips the clock/row branch.
  Omitting `now` leaves ordinary row timestamps undefined; an absent/empty take
  omits attachment IDs from the payload.

## Ack-only reset regression

[`composerSend.test.ts`](../../../src/renderer/src/screens/conversation/composerSend.test.ts)
uses the actual pending store to cover both reset tokens, trimming, Unicode
whitespace/arguments, near misses, attachment forwarding and bridge rollback.
No retained reset row or new `localSendPending` may appear, including after late
transport feedback.

[`composer-reset-send.spec.ts`](../../../e2e/composer-reset-send.spec.ts),
`typed resets receive only ack and leave no Sending or tail row after later delivery`,
mounts the production app with `threadMode: 'native'`. The default scripted publisher
could manufacture a user echo and accidentally settle the bug. Native mode instead
returns only correlated acks for both typed resets, repeated in one conversation.
It first waits for the initial native thread row, then observes each trimmed send
at the fake daemon, an increment of the content-free
`inbound-unmodeled`/`ack` diagnostic, and a later assistant marker rendered from
the same encrypted stream. Only then does it check the cleared draft and absence
of Sending or a reset row.

Each reset is followed by a native session divider and an ordinary send. Ack alone
must leave that ordinary send visibly pending. A supplied delivered `user_message`
with the authenticated device ID and sent message ID then settles it. Exact user
row contents and read-row order prove the divider precedes the later delivery
without a reset tail. See [positive processing barriers](development-verification-evidence-that-cannot-pass-too-early.md#evidence-that-cannot-pass-too-early).

The [accepted verifier review](https://github.com/pyrycode/pyrycode-desktop/pull/2145#issuecomment-6271312374)
records the named regression present and passed on Linux at
`efa511e8160d5138995b3afac4c88dfb361fd000`: the focused builder report
`/tmp/builder-2134/native.json` has 1 executed, 1 passed, 0 failed, 0 skipped and
0 retries. The review also confirms it passed in the dispatcher report; the initial
full Playwright run had 515 executed, 514 passed, 1 failed and 5 skipped, with the
unrelated scroll failure accepted after rerun under #2140. These are recorded
fake-daemon results, not a fresh documentation-stage or live-provider run. macOS is
outside this Linux ticket's verification scope.
