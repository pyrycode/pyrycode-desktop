# Conversation timeline store — Claude banners

Detail from the [conversation timeline overview](conversation-timeline-store.md).

## Claude banner routing and lifetime

The [banner protocol](https://github.com/pyrycode/pyrycode/blob/main/docs/protocol-mobile.md#banner)
requires five fields: string `conversation_id`, `level` and `text`, and boolean
`stops_turn` and `truncated`. The decoder rejects missing/mistyped fields and copies
only named fields; unknown/empty levels and empty text remain valid. Main delivers
the values through typed IPC as `conversationId`, `level`, `text`, `stopsTurn` and
`truncated`, with content-free diagnostics. The session, modal and question bridges
ignore this report.

`timelineTargetFor` and `translateTimelineEvent` drop an empty conversation id;
neither infers a target from the open conversation. A nonempty id routes to its own
[retained slice](conversation-timeline-holder.md), including before that conversation
has been opened, while another is open, or with no turn running. The frame has no
`turn_id`. Each arrival appends one `banner` item in arrival order, including identical
reports; there is no content deduplication, history mapping or timestamp join key.

Exact `info` stays in state but `TimelineRow` draws nothing for it. Every other level draws
full-width, left-aligned multiline text using the session-boundary label's small
typography and shadow. Exact `warning` uses the warning token; `notice`, `suggestion`
and unknown/empty levels use the muted on-surface-variant token. Classes come from
fixed client choices, never a raw level.

Both the row and [composer report](conversation-shell-composer-status.md#claude-stopping-reports)
start with `Claude:` and render React text children. The shared `bannerDisplayText`
formatter removes terminal escapes and non-layout controls while preserving line
breaks and tabs; Markdown, HTML and URLs stay inert. Prose reaches no attributes or
logs. Both surfaces wrap long text at the 800px window minimum. The formatter appends
one `…` iff `truncated` is true, leaving the retained payload unchanged. Do not reuse
`denialDisplayText` unchanged: its additional text-length cap would contradict
banner's producer-owned truncation contract.

`TimelineState.stoppingBanner` holds the latest `stopsTurn: true` report regardless
of level, including hidden `info`. Its lifetime differs from stopped-turn recovery:

| Event | Stopping report | Retained banner items |
| --- | --- | --- |
| Stopping banner | Replaces the held report. | Appends one item. |
| Non-stopping banner | Preserves it. | Appends one item. |
| Accepted local typed/slash send (`userText`) | Clears it. | Preserves them. |
| Fresh received user row (`userText`, `received: true`) | Clears it through the shared user-event wrapper. | Preserves them. |
| Duplicate user receipt | Preserves it and the exact held state. | Preserves them. |
| Empty or blocked send attempt | Preserves it. | Preserves them. |
| Other daemon activity, trailing idle, session boundary, reconnect, navigation or history prepend | Preserves it. | Preserves them. |
| Timeline reset, holder clear or eviction | Drops it. | Drops them. |

Local acceptance means inserting the optimistic user row through
[composer send](composer-send.md). The shared wrapper also clears the report on a
fresh receipt; a matching receipt returns before that lifecycle runs. The
reducer wrapper preserves the report across other content reducers, even when they
reconstruct state. `stopsTurn` only controls display: it never interrupts, retries,
changes permission or mutates turn lifecycle. The `stoppingBanner` reading shares
the in-memory timeline lifetime. Received banner rows are saved by
[local chat history](chat-history.md#snapshot-contract), including `stopsTurn`,
without restoring the separate live reading. History replay of banners is absent;
offline snapshot restoration displays saved rows without reviving that reading.

The shipped daemon producer maps Claude's `informational` subtype, including a
captured hook-block reason. That subtype is distinct from the payload's open `level`.
There is no shipped `local_command_output` or `notification` mapping.
[`e2e/banner-reports.spec.ts`](../../../e2e/banner-reports.spec.ts) uses synthetic
multiline `/cost` output to prove client rendering and truncation, not live command
delivery. Its hook scenario crosses decoding, IPC and the mounted bridge, then waits
for the optimistic echo and captured send before asserting that only the status
cleared. Focused `banner.test.ts`/`banner.test.tsx` files cover wire narrowing,
routing, lifetime and inert rendering. See the [architecture spec](../../specs/architecture/1341-claude-banner-reports.md).

