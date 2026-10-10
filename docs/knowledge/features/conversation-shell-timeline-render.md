# Conversation shell — timeline render and stopped-turn records

Part of [Turn status surfaces](conversation-shell-turn-status.md).

## Structured-stream timeline render (#203)

`Timeline` is the conversation's production thread surface, fed by the open conversation's
[held timeline](conversation-timeline-holder.md). Its exported view accepts `ThreadItem[]`
and can be server-rendered from injected items. `TimelineRow` switches exhaustively
on each item's `kind`; wire-to-render translation belongs to the bridge.

- `assistantText` → one bubble, carrying `data-thread-role="assistant"` as the test hook
  (`MessageThread`'s `data-message-role` counterpart). Both branches use
  `<div className="bubble__markdown">`; `inProgress` selects their rendering policy:
  - **In progress** (the tail, still growing): `StreamingAssistantMarkdown` feeds parser-verified
    frozen source units and a stabilized tail through
    [`AssistantMarkdown`](assistant-markdown-renderer.md#configuration-and-usage). Each delta parses
    from the first unfrozen block's line. Units freeze in order only after the following top-level
    block has two ended lines and independently parsed halves reproduce the tree at shifted offsets.
    A unit cannot end in a list, quote or indented code block; failed verification grows the candidate.
    Frozen objects retain identity and memoized renderers skip unchanged props. A reference definition
    anywhere, including nested definitions and next-line titles, discards frozen units and switches
    to whole-reply parsing/rendering for the remaining append-only stream. Replacement source resets
    the local cache.
  - **Pending presentation**: only the trailing paragraph/heading leaf receives inline completion,
    including inside quotes. Pending `**bold`, backtick code and `[text](https://exa` show their text
    without the pending style or link behavior. Insertion-only virtual closers are hidden by element
    unwrapping; escaped markers and ordinary punctuation stay literal. A pending pipe header, alone
    or with a partial delimiter, shows parser-derived cells separated by spaces until its complete
    separator establishes a table. Partial separator syntax stays hidden; this layout change is
    accepted. Unclosed fences render as code once the opening line ends, using the parser's raw-source
    behavior, including a closing candidate that grows into backticks followed by `x`.
  - **Settled** (after `turn_end` or a following tool row): the streaming component unmounts and
    `AssistantMarkdown` renders the original `item.text` in one pass. Stored source is never modified.
    Without pending inline/header syntax, streaming and settled content match apart from whitespace
    between top-level blocks. Unfinished syntax may correct: streaming `**bold` shows `bold`, but the
    settled renderer shows literal `**bold`.

  Markdown owns whitespace on both branches: the container's flex column and
  `gap: var(--space-2)` provide the 8px block rhythm, with direct-child margins reset.
  `.code-block__body` preserves and wraps code whitespace. The assistant-tail
  `bubble--assistant-text` modifier and its `pre-wrap` rule have been removed.
  The renderer's security boundary is unchanged: no `rehypePlugins` or `skipHtml`,
  only the table/task-list/strikethrough `remarkGfmSubset`, the existing
  `allowedLinkHref`/`markdownLinkPath` checks, escaped HTML and alt-only images.
  Stabilization only inserts source syntax and removes presentation elements; it adds no raw markup sink.

  Historically, [#607](../codebase/607.md) preserved plain-text tail whitespace and
  [#609](../codebase/609.md) introduced settled-only markdown while declining memoization.
  [#1751](../../specs/architecture/1751-progressive-assistant-markdown.md) reverses the permanent
  plain-tail policy and verifies parser/render reuse in the mounted fake-transport tier.
- `toolCall` → the tool-row chip ([#218](conversation-shell-tool-rows.md#pending-tool-call-row-218), below) — no longer a no-op as
  of that ticket; the resolved success/error treatment ([#230](conversation-shell-tool-rows.md#resolved-tool-call-row-230), below)
  lifts the pending dimming. Failed, non-denied calls now use the accessible
  [Failed icon](conversation-shell-tool-rows.md#failed-icon); borders and visible joins stay plain.
- `turnBoundary` → a stopped-turn label when eligible (below), otherwise `null`.

**Streaming cursor** (Figma `16:56`, glyph `▎` U+258E): a trailing `<span class="bubble__cursor"
aria-hidden="true">` inside the in-progress bubble, rendered only on the tail item when
`item.kind === 'assistantText'` — derived from array position, never from `selectPhase` (which had no
source at the time; [#214](../codebase/214.md) later wired one up, but this render still doesn't read
it). CSS blink is guarded by `@media (prefers-reduced-motion: reduce)`.
Since [#1872](https://github.com/pyrycode/pyrycode-desktop/issues/1872) the open main thread bubble,
`openBubbleIndex(items)`, also keeps the cursor when a background subagent's tool calls trail it,
because the reducer keeps growing that bubble behind them.
The cursor follows the `.bubble__markdown` container as a sibling, before `BubbleMeta`,
and disappears on settlement. Its placement follows rendered block layout rather than
raw trailing newlines. Historically, #607's plain `pre-wrap` tail placed it in the
source's text run; that newline-driven placement ended with progressive markdown.

**React keys retain logical row identity.** Production uses the timeline's client-owned
numeric `rowKeys`; without them, the fallback is `firstRowKey + itemIndex`, relative
to the thread's origin rather than its current display position. History prepends lower
`firstRowKey` while raising retained source indices, leaving existing fallback keys unchanged.
Unmatched queued rows use `q<queuedMsgId>`. Confirmed Agent identities retain their
first key, including `agent-<identity>` when first drawn provisionally; marker and run
wrappers derive keys from that row identity. These keys survive history prepends,
queue projection and background-agent regrouping. See
[timeline identity](thread-timeline-limits.md#edge-cases-and-limitations).
The original #203 array-index description applied to the initial append-only surface;
it is no longer the production key policy. A turn-only key still collides when tools
split a reply, and a text-bearing key remounts the streaming bubble on every delta.

**Strangler-Fig coexistence at ship time, not a cutover** — as originally shipped, `Timeline` sat
directly beside `MessageThread`; the coarse path was completely untouched and stayed the *live* one,
`Timeline` returning `null` on an empty `items` array (not an empty `<div>`) for zero layout footprint
so the thread was pixel-identical to before this ticket. The store stayed empty in production until
`interactive` flipped (a non-interactive v2 connection receives no structured stream), so this entire
render path was inert at ship time.

**Reconciled in [#179](../codebase/179.md):** the client hello now advertises `interactive`, the coarse
`message` fan-out stopped daemon-side, and `MessageThread` was retired rather than left as an empty
dead region — `Timeline` is now the conversation's single thread surface. See
[The interactive flip + thread cutover](conversation-shell-conversation-and-modals.md#the-interactive-flip--thread-cutover-179) below and
[#203 codebase notes](../codebase/203.md) for the original design and code review record.

## Supplied daemon item presentation

[`ThreadItemsTimeline`](../../../src/renderer/src/screens/conversation/ConversationScreen.tsx)
accepts an injected `ThreadSnapshot`, optional `foldTools` (default false), `onReply`
and `onOpenMarkdownPath`. The owner creates/subscribes to the
[retained item store](thread-item-store.md) and supplies snapshots; this view adds no
production subscription. Ordinary `ConversationScreen` still selects legacy `Timeline`.
The [presentation adapter](../../../src/renderer/src/screens/conversation/threadItemPresentation.ts)
narrows held JSON into existing row props without calling `reduceTimeline`, searching
for an open bubble, inferring parents or relocating agents.

Only `shown === true` items create rows, in snapshot order. Hidden items remain held.
Unknown kinds/statuses, unsupported notice subtypes (including saved answers), and
missing or malformed required content use the supplied summary as escaped React text,
bounded to 4096 characters; absent summaries use `Unsupported item`. Fallback rows
have no markdown, links or actions. Agent/parent items currently use this fallback at
their supplied position, without roster inference or agent cards.

### Saved content and activity

The adapter consumes presentation fields from saved `content`, omitting invalid
optional details. It does not reconstruct facts from source events.

| Supplied kind | Existing presentation and narrowed fields |
| --- | --- |
| `user_message` | User bubble with required `text`; valid attachment records require `attachment_id` and `filename`. |
| `assistant_message` | Assistant markdown bubble with required `text`; copy/reply read the current text and path links use the supplied reader callback. |
| `tool_call` | Tool row with required `name`, optional `tool_use_id`, `input_summary`, string-valued `input` entries and finite `elapsed_seconds`; nested `result` supplies `is_error`, `result_summary` and optional `result_detail`. Nested `denial` supplies tool name, reason type/reason, message and optional truncation/dropped-field lists. Malformed supplied result/denial uses summary fallback. |
| `session_divider` | Existing divider for `clear`, `idle_evict` or `workspace_change`, with supplied `workspace_cwd` and `occurred_at`. |
| `compaction` | Existing divider from string `trigger`: `failed` selects failure, `manual` selects manual, other triggers use ordinary compaction; finite `pre_tokens`/`post_tokens` provide counts. |
| `turn_end` | Existing stopping copy from supplied stop reason, outcome, error flag, terminal reason and error category; summary supplies visible copy when that formatter would suppress the ending. |
| `notice` | Existing banner/reroute, model refusal, unrecognized-output or attachment-offer row when its subtype and required fields are supported. |

Message timestamps parse the first supplied string among `ts`, `client_sent_at`,
`accepted_at` and `occurred_at`; an invalid/missing timestamp draws no time.
Supported notice subtypes are `banner`, `model_refusal_fallback`,
`model_refusal_no_fallback`, `unrecognized_message` and `attachment_offered`.
Authoritative row mode bypasses legacy informational-banner and normal-ending
suppression: a shown item must stay visible. Recorded `claude`/`codex` attribution
selects existing agent wording; absent/unsupported attribution uses supplied banner
text or ending summary rather than assigning the current conversation's agent.

Assistant progressive markdown and cursor follow supplied `active === true`, even
with later rows or a settled status. Tools and collapsed-run activity also read
`active` directly. An inactive terminal tool without `result` is resolved without a
running indicator or invented `No output`; saved interruption/ending payloads do not
become fabricated result text.

Turn metrics use finite input/output/cache token counts and duration from recorded
`turn_end` content, including hidden endings. Association requires nonempty recorded
session and turn, and joins on `(session, agent, turn)` within the snapshot. Only the
last shown, successfully adapted assistant in that identity gets formatted stats.
Equal turn strings in different sessions do not join; adjacency and current-session
attribution never supply missing identity.

### Scoped identity, expansion and attachments

The inner view remounts on `(hostId, conversationId, epoch)`. Numeric daemon item ids
key row wrappers within that scope, so appends, revisions and older-item prepends
retain row identity; equal ids after a scope change reset row-local state. Tool
expansion is keyed by item id. `foldToolRuns` receives a flat projection with supplied
activity, and run expansion is remembered by member ids: inserting an older member
or appending to an expanded run retains its expansion. Collapsed members remain
mounted, preserving their result expansion while hidden. A text-bearing or positional
key would remount rows during exactly these updates.

`ThreadAttachmentScopeContext` carries snapshot host/conversation ownership and a
scope-owned image-source driver through reused file/image slots and attachment offers.
Availability checks use that host. File actions capture that target for local-original
opening and fallback retrieval; image retrieval/opening uses the same target. Changing
scope releases image shares/listeners through effect cleanup and cannot reuse another
scope's thumbnail URL merely because attachment ids match. Remounting rows alone would
not fix action ownership if their dependencies still read the global active chat.

Renderer-scoped requests do not establish production transport ownership.
[#1926](https://github.com/pyrycode/pyrycode-desktop/issues/1926) tracks main-process
retrieval routing/coalescing/outcome ownership; its production reproduction remains
skipped. The two-host mounted proof uses real preload with a ticket-local IPC fake,
so scoped completion isolation and production cross-host retrieval remain unverified.
That repair must precede combined production acceptance in
[#1908](https://github.com/pyrycode/pyrycode-desktop/issues/1908).

The slice leaves agent placement to #1905, local settlement/queue actions to #1906,
server paging to #1902, and production path selection, subscriptions, capability
advertisement and combined live verification to #1908. Supplied older batches are
presentation inputs here, not a server paging implementation. See
[watermark-independent scroll restoration](conversation-shell-scroll-pin.md#supplied-snapshot-anchor-restoration)
and the [design](../../specs/architecture/1904-daemon-item-presentation.md).

### Supplied-item verification

[`threadItems.test.tsx`](../../../src/renderer/src/screens/conversation/threadItems.test.tsx)
statically exercises kinds/order, hidden rows, inert fallback, activity independent
of status/position, terminal tools, recorded usage and supported notices. Static
rendering does not prove effects or interaction.
[`thread-items.spec.ts`](../../../e2e/thread-items.spec.ts) mounts an injected owner
using `createThreadItemStore`, typed appends/changes and completed-batch snapshots.
It checks retained row/tool/run state, current-text copy/reply, reader callbacks,
attachments, scope resets, following growth and held-reader prepends/revisions.
All its cases belong to the serialized clipboard project because copy assertions
share Electron's system clipboard.

The [verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/1925#issuecomment-6102450645)
at `c4420495` records `authoritative items retain identity, actions and scroll at 1280`,
`authoritative items retain identity, actions and scroll at 800`, and
`snapshot attachment actions retain their host and conversation across reused IDs`
as present and passed: ticket coverage executed 3, passed 3, failed 0, skipped 1
(the separate #1926 production reproduction). The full fake-transport run executed
380, passed 379, failed 1, skipped 4; its unrelated `history-gaps` failure passed an
isolated rerun (1 executed/passed, 0 failed/skipped). No skipped case is a pass.
The same verdict confirms reused row styling at 1280 and 800 widths against Figma
102:4; the synthetic fixture omits the production shell. No live Claude or production
thread capability verification was required or performed.

## Legacy row reuse and stopped-turn records

### Settled row reuse

`TimelineRow` uses ordinary shallow `React.memo`. `appendDelta` replaces the growing
assistant item while retaining unchanged item references, so settled user and assistant
rows skip execution when their other inputs stay equal. Metadata, delivery, queue state,
action availability and callback changes remain observable. The separately memoized
[`AssistantMarkdown`](assistant-markdown-renderer.md#how-it-works) also skips parsing
when a row changes only its metadata or actions and its markdown inputs stay equal.

`ConversationScreen` stabilizes reply, drop and Send now callbacks with `useCallback`
and host/conversation dependencies (plus store dispatchers for drop). Queue actions
still receive `undefined` when unavailable and recheck the connected conversation at
activation. `reader.open` is already stable. Ignoring callback changes in an equality
shortcut would retain actions for an old pane; fresh `foldQueuedRows` handles and
unmatched queue items intentionally remain eligible to rerender.
`Timeline` remounts by conversation key; host dependencies also refresh actions when
switching between hosts with equal conversation IDs.

Memoizing exported `ToolRow` directly would still rerender on fresh group/expansion
objects and toggle closures. Instead, private `TimelineToolRow` compares the original
item, retained row key, primitive count/background/running/expanded values, and one
stable keyed toggle. Only an executed wrapper constructs the legacy `group` and
`expansion` objects. The toggle updates the keyed expansion set functionally;
`ToolRow` retains its standalone `defaultExpanded` state contract.

Group wrappers update visibility and joins independently of the memoized contents.
Hidden descendants remain mounted, so collapsing and reopening a parent preserves
child result expansion. Keys and wrappers are unchanged by memoization. Whole-thread
projections and join scans still run; this reuse does not establish constant layout
cost or smoother scrolling through profiling. Design:
[settled row reuse](../../specs/architecture/1886-settled-row-reuse.md).

### Row reuse verification

[`e2e/settled-row-reuse.spec.ts`](../../../e2e/settled-row-reuse.spec.ts)'s
“settled rows skip deltas and unrelated group toggles while the active reply renders”
uses mounted V8 function counters with multiple settled messages, resolved grouped
and unrelated tools, and an active reply. Positive counts precede measurement, and
each of three chunks has its own display barrier before the next delivery. Each delta
executes one `TimelineRow`, one `AssistantMarkdown` and zero `ToolRow`s. Four
parent/child toggles each execute one tool and zero message, markdown, parser or
message-action functions; hidden child expansion survives collapse/reopen.
`StreamingAssistantMarkdown` can execute again for its own partition-state update:
count its positive execution separately from the parent row, rather than requiring
one streaming-component call per delta. DOM retention alone cannot prove these skips.

Recorded on 2026-10-08 in the
[verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1889#issuecomment-6053401984):
the named regression on unchanged main `5f75ddc3` executed 1 test, failed 1 and
skipped 0, recording 13 `TimelineRow` calls on the first delta against the expected 1.
Fixed production executed 1, passed 1, failed 0 and skipped 0. The focused behavior
run executed 23, passed 23, failed 0 and skipped 0, including that regression and
copy/reply, host/conversation switching, queue actions, reader links, stats, tool
progress and history/regrouping coverage. The full fake-transport gate at `c0268369`
executed 358, passed 358, failed 0 and skipped 4; the named settled-row regression
was present and passed on its first attempt. Units executed/passed 9,587, failed 0
and skipped 3; build passed. No live-Claude or visual acceptance is required.

### Stopped-turn records

`stoppedTurnText` suppresses `stopReason: 'cancelled'` first. Otherwise a line draws
only for `isError: true` or a nonempty outcome other than `success`; success-with-error
still draws. Legacy and clean-success boundaries remain invisible. A nonempty terminal
reason other than `completed` wins over the outcome:

| Terminal reason | Label |
| --- | --- |
| `max_turns` | Stopped: turn limit reached |
| `budget_exhausted` | Stopped: budget exhausted |
| `prompt_too_long` | Stopped: context too long, compact or reset |
| `api_error` | Stopped: API error |
| `hook_stopped`, `stop_hook_prevented` | Stopped by a hook |
| `model_error` | Stopped: model error |

Without a meaningful terminal reason, `error_max_turns` and `error_max_budget_usd`
use the corresponding limit/budget labels; then a nonempty category selects API-error
wording, then an unknown outcome uses `Stopped: <value>`. An unknown terminal reason
also uses that form; an error with no detail uses `Stopped: error`. Every nonempty
category appends `(Claude reported: <value>)` to the chosen label — since
[#1656](conversation-shell-composer-status.md#claude-stopping-reports), the credited name is the
conversation's own agent (`(Codex reported: …)` on a Codex conversation), read through an optional
second `agent: WireAgent = 'claude'` parameter on `stoppedTurnText`.

The formatter rechecks each report's 256-byte UTF-8 bound, discards overlong strings,
and strips Unicode controls, format characters and line/paragraph separators before
classification. React children escape the remaining text; it never enters markup,
attributes, URLs, commands or logs. `.stopped-turn` reuses the session-separator label
typography and shadow, with single-line ellipsis inside the thread width at 800px.
The row survives [recovery clearing and history replay](thread-timeline-internals.md#stopped-turn-state).

Visible stopped records must participate in the [tool-stack join scan](conversation-shell-tool-row-header-groups.md#visible-tool-row-joins).
Skipping every boundary joined tool cards across the new label; `stoppedTurn.test.tsx`
pins this with two tools separated by a stopped record. Only undrawn boundaries
remain skipped. [Fake-transport coverage](e2e-harness.md#stopped-turn-evidence) proves
layout and command dispatch; it does not prove live compaction.
