# Conversation unread predicate

[`isConversationUnread(row)`](../../../src/renderer/src/store/conversationUnread.ts)
uses only the received owning-host summary's `last_shown_version` and `read_up_to`.
The renderer reconstruction and local-count branches were deleted in #2030.

## What it does

Unread means `last_shown_version > read_up_to`. Equality, including zero/zero,
is read. A missing row, host stamp or either watermark returns false (unavailable).
Missing authority never falls through to `latest_entry_id`, a timeline count,
a local mark or inferred activity. The row need not have been opened or have a
loaded snapshot for its received watermarks to establish unread state.

## How it works

The predicate has one optional row argument, a type-only `ConversationSummary`
import and no runtime store dependency. Parsers own validation of the received
numbers. It neither looks up conversation identity nor writes a mark.

The sidebar's `ConversationStatusDotControl` and the badge's
`conversationStatusNow(row)` combine this result with host/conversation-scoped
`threadLiveInputs`. Missing admitted live state supplies idle activity and no
outstanding prompt; the received unread result remains independent. Pending input
and working keep their existing precedence in the [status resolver](conversation-status.md).

Sending a read command changes neither the predicate nor the received row. Only
owning-daemon acknowledgement advances `read_up_to`; a below-target clamp keeps
the publisher pending. See [committed visible observation](conversation-shell.md#authoritative-thread-read-publication).

## Configuration and usage

Call `isConversationUnread(row)` with the actual host-stamped list row. There are
no timeline, local-mark or thread-mode arguments, and no `hasDaemonReadState`
export. Embedded browser fixture strings need the same signature update as typed
callers; TypeScript cannot check them. See [verification boundaries](development-verification-what-each-test-tier-proves.md#what-each-test-tier-proves).

## Edge cases and limitations

Omission stays unknown rather than zero. Opening, sending, local receipt counts
and cached content do not fabricate read evidence. Equal conversation IDs on two
hosts retain separate received state and publication ownership. The local-count
store and its persistence/cleanup APIs no longer exist; old web-storage marks
have no reader in this path.

## Related decisions

- [Thread runtime](thread-runtime.md#live-controls-and-read-publication) — live admission and read ownership.
- [Read publisher](conversation-last-read-store.md) — retained publication mount and acknowledgement lifecycle.
- [Conversation list store](conversation-list-store.md#received-read-state) — received host-qualified marks.
- [Renderer retirement validation](thread-runtime.md#renderer-producer-retirement-validation) — counted Linux evidence.
