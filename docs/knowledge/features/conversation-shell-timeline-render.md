# Conversation shell — timeline render and stopped-turn records

Part of [Turn status surfaces](conversation-shell-turn-status.md).

## Structured-stream timeline render (#203)

`Timeline` is the conversation's single thread surface, fed by the open conversation's
[held timeline](conversation-timeline-holder.md). Its exported view accepts `ThreadItem[]`
and can be server-rendered from injected items. `TimelineRow` switches exhaustively
on each item's `kind`; wire-to-render translation belongs to the bridge.

- `assistantText` → one bubble, carrying `data-thread-role="assistant"` as the test hook
  (`MessageThread`'s `data-message-role` counterpart). Since [#609](../codebase/609.md), the bubble
  forks on the same `inProgress` prop the streaming cursor below reads — no new state:
  - **In progress** (the tail, still growing): unchanged from #199/#607 — text as React children
    (never `dangerouslySetInnerHTML`, so HTML inside a delta renders as visible characters), plus the
    dedicated `.bubble--assistant-text` modifier (`white-space: pre-wrap`) so a multi-paragraph reply
    keeps its blank lines and space runs instead of collapsing to one run-on line. Hung on its own
    class rather than `.bubble--daemon` so the four chrome affordances below
    (thinking/stall/api-retry/compacting) and the coarse path's `.bubble--user` stay structurally
    unreachable by the rule.
  - **Settled** (every other item, and the tail once its turn's `turn_end` arrives): renders through
    [`AssistantMarkdown`](assistant-markdown-renderer.md) (#608, wired in by #609) inside a
    `<div className="bubble__markdown">` — a flex column with `gap: var(--space-2)` for Figma `16:43`'s
    8px block rhythm, `margin-block: 0` on direct children (`index.css` resets only `body`, so UA block
    margins would otherwise stack on top of the flex gap), and `pre { white-space: pre-wrap }` so
    fenced code wraps within the bubble's measure instead of spilling out of it. `bubble--assistant-text`
    is **not** carried here — the settled branch never gets the class at all, making "markdown owns the
    whitespace" true by construction rather than by an override one level down. `React.memo` was
    considered and declined (unmeasured cost, no test tier in this repo can observe a skipped
    re-render); the seam is named in a code comment at the render site.

  The fork exists because the daemon emits one event per *complete* content block and the store
  coalesces a turn's deltas in place, so a settled item's text is always a whole document — a fenced
  block never arrives half-open — while the in-progress tail must never be shown half-parsed, which is
  why it stays plain text permanently rather than gaining markdown once "enough" of it has streamed in.
- `toolCall` → the tool-row chip ([#218](conversation-shell-tool-rows.md#pending-tool-call-row-218), below) — no longer a no-op as
  of that ticket; the resolved success/error treatment ([#230](conversation-shell-tool-rows.md#resolved-tool-call-row-230), below)
  lifted the pending dimming and added the error accent.
- `turnBoundary` → a stopped-turn label when eligible (below), otherwise `null`.

**Streaming cursor** (Figma `16:56`, glyph `▎` U+258E): a trailing `<span class="bubble__cursor"
aria-hidden="true">` inside the in-progress bubble, rendered only on the tail item when
`item.kind === 'assistantText'` — derived from array position, never from `selectPhase` (which had no
source at the time; [#214](../codebase/214.md) later wired one up, but this render still doesn't read
it — the thinking indicator is a separate, still-open slice). CSS blink guarded by
`@media (prefers-reduced-motion: reduce)`. Since #607's `pre-wrap` rule, a reply whose text ends in a
newline now carries the cursor onto the following line — the whitespace rule working as intended, not
a regression; the cursor `<span>` sits flush against `{item.text}` in the JSX with no intervening
whitespace so no extra blank line is introduced by the markup itself.

**React key = array index**, deliberately: the reducer's `appendDelta`/`fillResult` invariants
guarantee the list is append-only with tail-mutation, never reordering or inserting mid-list, so index
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
category appends `(Claude reported: <value>)` to the chosen label.

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
