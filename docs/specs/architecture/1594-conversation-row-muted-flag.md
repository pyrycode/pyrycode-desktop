# #1594 — conversation list rows carry the muted flag

## Files read

- `src/shared/wire/types.ts` → `ConversationSummary` — gains `is_muted`.
- `src/main/transport/inboundMessage.ts` → `parseConversationSummary`, `requireBoolean` — the row decode that reads it.
- `src/shared/chatHistory.ts` → `parseChatHistorySnapshot` (the `kind: 'list'` row reconstruction), `optional`, `bool` — the saved-list cache is a second closed reconstruction of the same row; without a line here a restored list silently drops the flag.
- `src/renderer/src/store/conversationListStore.ts` → `stampRows` — spreads each row, so the field reaches the store with no edit.
- `src/main/transport/inboundMessage.test.ts` → `CONV_NAMED` / `CONV_UNNAMED` and the `conversations recognition` block — the decode-output assertions the new field changes.

## Design source

N/A — wire and decode only, nothing renders the flag yet.

## Change

`ConversationSummary` gains `is_muted?: boolean`. `parseConversationSummary` reads it after the existing fields: an absent key decodes as `false` (a daemon predating the field must keep notifying — the `conversation_updated.is_archived` lesson), a boolean is carried verbatim, anything else throws `WireDecodeError` and fails the whole reply closed like the other fields. The decoder therefore always emits a boolean. `parseChatHistorySnapshot` copies the field through the saved-list cache with `optional(c.is_muted, bool)`: a cache written before this ticket restores as `undefined`, which reads as not muted, and a present non-boolean invalidates the snapshot as every other field does. `stampRows` already spreads rows into the store, so nothing downstream moves.

**Why optional in the type while the decoder always writes it.** Measured on this tree: making it required breaks typecheck in 28 renderer and main test files (about 50 hand-built row literals) plus the chat-history reconstruction — past the 10-site fan-out boundary for a field the ticket sizes at ~20 lines. Optional in the type gives every hand-built row that omits it (fixtures, the cache of an older build) the same meaning as a wire absence: not muted. The consumer contract is `row.is_muted === true`, never truthiness of the key's presence. A later ticket can tighten the type to required together with the fixture sweep if that becomes worth it.

## Testing strategy

- `inboundMessage.test.ts`: the `CONV_NAMED` / `CONV_UNNAMED` fixtures carry `is_muted` true and false, so the existing ordered-list, null-name and unknown-key tests assert the value round-trips; new cases for an absent key → `false` and for non-boolean values (`'true'`, `1`, `null`) → `WireDecodeError`.
- The `daemonConnection` and roundtrip `conversationsReceived` fixtures gain the field so the emitted event is asserted to carry it.
- `chatHistory.test.ts`: a list snapshot row with `is_muted: true` restores it; one without restores as `undefined`; a non-boolean is invalid.
- `conversationListStore.test.ts`: rows with `is_muted` true and false keep those values after `setConversations` (AC1's "reaches the store").

## Documentation handoff

Pending for the documentation stage: the ticket names none. The `inbound-message-decode-internals` and `channel-list` overviews may want the absent-reads-false contract and the `=== true` read rule.
