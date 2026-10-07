# Conversation shell — timeline render and stopped-turn records

Part of [Turn status surfaces](conversation-shell-turn-status.md).

## Structured-stream timeline render (#203)

`Timeline` is the conversation's single thread surface, fed by the open conversation's
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

**React key = array index**, deliberately: the reducer's `appendDelta`/`fillResult` invariants
guarantee the list is append-only with in-place mutation (the open bubble, which since #1872 can sit
behind trailing subagent tool calls), never reordering or inserting mid-list, so index
identity is stable per logical item (`turnId` alone would collide once #205 lets a tool split one turn
into two `assistantText` items; a text-bearing key would remount the growing bubble every delta).

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
