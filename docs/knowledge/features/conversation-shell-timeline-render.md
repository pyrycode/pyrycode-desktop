# Conversation shell — timeline render and stopped-turn records

Part of [Turn status surfaces](conversation-shell-turn-status.md).

## Structured-stream timeline render (#203)

`ThreadItemsTimeline` is the production thread surface, fed by the
[thread runtime](thread-runtime.md). Its inner `ThreadItemsView` adapts supplied daemon
items into the surviving shared row views. Exported `TimelineRow` switches on the
shared `ThreadItem.kind`; that type's home in `threadTimeline.ts` does not make the
legacy reducer the source of displayed content. Tests can render this row directly
without reconstructing a timeline from events.

The legacy `Timeline`, client numeric presentation-key/arrival bookkeeping,
provisional Agent placement and queue-row folding were removed in
[#2023](https://github.com/pyrycode/pyrycode-desktop/issues/2023). Reducer, roster,
bridge and history producers remain until the separate #2024 cleanup. Their retained
APIs and tests do not provide a fallback when a host lacks `thread`.

- `assistantText` → one bubble, carrying `data-thread-role="assistant"` as the test hook
  (`MessageThread`'s `data-message-role` counterpart). Both branches use
  `<div className="bubble__markdown">`; `inProgress` selects their rendering policy:
  - **In progress** (supplied `active === true`): `StreamingAssistantMarkdown` feeds parser-verified
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
  - **Settled** (supplied activity is no longer true): the streaming component unmounts and
    `AssistantMarkdown` renders the original `item.text` in one pass. Stored source is never modified.
    Without pending inline/header syntax, streaming and settled content match apart from whitespace
    between top-level blocks. Unfinished syntax may correct: streaming `**bold` shows `bold`, but the
    settled renderer shows literal `**bold`.

  Markdown owns whitespace on both branches: the container's flex column and
  `gap: var(--space-4)` provide the 16 px top-level block rhythm, with direct-child
  margins reset and flush container edges. Nested list/quote rhythm stays 8 px;
  metadata/attachment margins remain separate at 12 px.
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
aria-hidden="true">` inside an active assistant bubble. Supplied activity controls it
independently of array position, later tool rows or main-turn state. CSS blink is
guarded by `@media (prefers-reduced-motion: reduce)`.
The cursor follows the `.bubble__markdown` container as a sibling, before `BubbleMeta`,
and disappears on settlement. Its placement follows rendered block layout rather than
raw trailing newlines. Historically, #607's plain `pre-wrap` tail placed it in the
source's text run; that newline-driven placement ended with progressive markdown.

**React keys retain logical row identity.** Daemon item ids key wrappers inside the
host/conversation/epoch scope; marker and run keys derive from those ids. Local pending
sends have a separate pending-key namespace. Revisions, prepends and reparenting retain
mounted row state within that scope. See [scoped identity](#scoped-identity-expansion-and-attachments).
A turn-only key collides when tools split a reply, and a text-bearing key remounts the
streaming bubble on every delta.

**Strangler-Fig coexistence at ship time, not a cutover** — as originally shipped, `Timeline` sat
directly beside `MessageThread`; the coarse path was completely untouched and stayed the *live* one,
`Timeline` returning `null` on an empty `items` array (not an empty `<div>`) for zero layout footprint
so the thread was pixel-identical to before this ticket. The store stayed empty in production until
`interactive` flipped (a non-interactive v2 connection receives no structured stream), so this entire
render path was inert at ship time.

**Reconciled in [#179](../codebase/179.md):** the client hello now advertises `interactive`, the coarse
`message` fan-out stopped daemon-side, and `MessageThread` was retired rather than left as an empty
dead region. `ThreadItemsTimeline` later replaced that surface, and #2023 deleted
the retained `Timeline`. See
[The interactive flip + thread cutover](conversation-shell-conversation-and-modals.md#the-interactive-flip--thread-cutover-179) below and
[#203 codebase notes](../codebase/203.md) for the original design and code review record.

## Supplied daemon item presentation

[`ThreadItemsTimeline`](../../../src/renderer/src/screens/conversation/ConversationScreen.tsx)
accepts an injected `ThreadSnapshot`, optional `foldTools` (default false), `onReply`
and `onOpenMarkdownPath`. The owner creates/subscribes to the
[retained item store](thread-item-store.md) and supplies snapshots; this view adds no
production subscription. Ordinary `ConversationScreen` supplies the runtime snapshot
to this same authoritative route; there is no legacy presentation caller.
The [presentation adapter](../../../src/renderer/src/screens/conversation/threadItemPresentation.ts)
narrows held JSON into existing row props without calling `reduceTimeline`, searching
for an open bubble or using legacy roster/evidence inference. Supplied `parent`,
`active`, `status`, `order` and `ended_order` govern nesting, lifecycle and placement.
Visual rendering first uses metadata-only `threadItemIndex`, sharing `nest` with
the complete adapter. It checks ancestor/run visibility and bounded admission before
calling `threadItemPresentation` for a visible header or full row. Closed descendants
and folded members are absent from the DOM and do not construct complete bodies;
closed tool bodies also defer command/denial formatting. Updates while closed stay
deferred until reopening. Complete `threadItemPresentations` remains independent
for composer reports and notifications. See
[admission and counted evidence](conversation-shell-scroll-pin.md#deferred-expansion-verification).

Only `shown === true` items create rows. Hidden items remain held without rows.
Unknown kinds/statuses, unsupported notice subtypes (including saved answers), and
missing or malformed required content use the supplied summary as escaped React text,
bounded to 4096 characters; absent summaries use `Unsupported item`. Fallback rows
have no markdown, links or content actions; a fallback agent owning children retains
collapse/reveal disclosure without fabricated activity or completion.

Shown messages, tools and nested agents belong to a shown `agent` whose item id matches
their supplied `parent` in the same snapshot. Missing, hidden or non-agent parents leave
children flat at their supplied position. A catch-up parent or revised parent relocates
each child once. Self/cycle edges are disconnected without losing rows or other valid
descendants. The projection retains full ancestry for collapse and counts, while visual
indentation stops at two levels. Counts include distinct shown descendant `tool_call`
item ids, excluding messages, nested agent cards and the owner; equal `tool_use_id`
values do not merge distinct items. Text-only descendants still permit disclosure.

Within each sibling lane, user items without positive `order` follow the other rows
in snapshot first-arrival order. Delivery gives that same item its supplied position.
This rule belongs in the nesting comparator because a separate pre-sort is overwritten
by lane placement. Other ordinary rows use creation `order`. Task-linked active agent
cards follow ordinary rows in creation order, with their descendants. Inactive linked
cards settle at positive `ended_order`, with ties broken by creation `order`; absent or
zero ending order retains creation placement. Nesting takes precedence, so a nested
card stays in its owner's lane. Linked cards also have launch markers at creation order
in that lane. Markers show supplied activity/outcome and retain `Go to agent` navigation
to the same card: reveal ancestors and scroll to the card, preserving its expansion.
Agent traffic never splits or settles the main assistant reply.

### Saved content and activity

The adapter consumes presentation fields from saved `content`, omitting invalid
optional details. It does not reconstruct facts from source events.

| Supplied kind | Existing presentation and narrowed fields |
| --- | --- |
| `user_message` | User bubble with required `text`; valid attachment records require `attachment_id` and `filename`. |
| `assistant_message` | Assistant markdown bubble with required `text`; copy/reply read the current text and path links use the supplied reader callback. |
| `tool_call` | Tool row with required `name`, optional `tool_use_id`, `input_summary`, string-valued `input` entries and finite `elapsed_seconds`; nested `result` supplies `is_error`, `result_summary` and optional `result_detail`. Nested `denial` supplies tool name, reason type/reason, message and optional truncation/dropped-field lists. Malformed supplied result/denial uses summary fallback. |
| `agent` | Existing Agent/Task card requiring saved `name` of `Agent` or `Task` and a supported lifecycle status; launch fields narrow as for tools. Saved result/denial remains detail, while supplied activity/outcome controls the card. |
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

Agent activity reads only `active === true`; launch results, descendant activity,
main-turn endings, roster absence and session dividers cannot change it. Inactive
prior-session work remains settled when reopened. Status independently supplies
`Outcome pending` for `running`, and distinct `Finished`, `Failed`, `Denied`, `Stopped`
and `Stopping` labels. `ended_with_session` requires saved `content.ending.cause` and
shows `Session ended: <cause>` as escaped text, with the cause bounded to 4096 characters; `gone`
shows `Outcome unknown`. Unsupported agent status or malformed required content uses
summary fallback. No terminal status synthesizes a successful result. Optional
`ToolRow.suppliedOutcome` treatment leaves legacy result/denial-driven callers unchanged.

Supplied `kind === 'agent' && active === true` also keeps the whole row at opacity 1
on compact omitted-detail headers and complete items, whether ungrouped or inside
an expanded tool run. `CompactRow` and `TimelineToolRow` carry this fact to
`ToolRow.activeAgent`; `.tool-row--active-agent` shares the resolved opacity rule
without changing the outcome. Ordinary pending `tool_call` rows remain at 0.5,
including a tool whose display name is `Agent`. Inferring identity from adapted
`toolCall` presentation or its name would lose this distinction. Running/count
copy, grouping, placement and disclosure retain their independent contracts.

Background membership requires usable saved `content.tool_use_id` and `task_id`, plus
either a direct `task_link` with matching `tool_call_id`/`task_id`, or one matching entry
in `task_link.tasks`. The daemon can save an entire `background_task_roster` payload as
the link; direct-link-only fixtures would miss its placement and navigation behavior.
Both identities must match in the same entry, never across separate entries. Content
and candidate identity fields must be nonempty strings and unmarked by their
`truncated_fields`/`dropped_fields`; malformed marker lists also invalidate identity.
Names, `run_in_background` and result text establish no membership. Task-linked shells
retain ordinary tool rows and creation placement, with supported supplied lifecycle
outcomes; only agent cards gain background placement and launch markers. These common
display fields add no daemon Codex-agent support or current-session/Claude defaults.

Turn metrics use finite input/output/cache token counts and duration from recorded
`turn_end` content, including hidden endings. Association requires nonempty recorded
session and turn, and joins on `(session, agent, turn, parent)` within the snapshot,
normalizing absent parent to null. Only the last shown, successfully adapted assistant
in that identity gets formatted stats. Child text can share the main reply's recorded
session/agent/turn: omitting parent would move the main usage footer onto that child.
Equal turn strings in different sessions or parents do not join; adjacency and
current-session attribution never supply missing identity.
The visual index retains ending sources without formatting usage until visible
demand. It searches backwards for the latest nonempty formatted reading; selecting
only the last ending would lose usage when a later ending has empty metrics.

### Scoped identity, expansion and attachments

The inner view remounts on `(hostId, conversationId, epoch)`. Numeric daemon item ids
key row wrappers within that scope, so appends, revisions and older-item prepends
retain source identity; equal ids after a scope change reset view-local state. Tool
and card expansion sets live above the row components and are keyed by item id.
Sibling ordering survives catch-up parents and late reparenting without recursive
card ownership. New groups start collapsed; ancestor collapse unmounts descendants
without clearing their own expansion. Reopening remounts the current held sources;
DOM-object identity is not retained across absence. Two hosts reusing conversation/item
ids have separate cards, and host/conversation/epoch switches reset tools, cards,
runs and refs.

`foldToolRuns` receives the flat projection with supplied ancestry/activity and card/
marker barriers. Opening a run remembers every member id; any retained member keeps
the regrouped run open through revisions, older prepends and appends. Remembering only
the first member would collapse the residual run when that member moved into a card.
Collapsing a run clears its current member ids. Collapsed members unmount while
their separate result/card expansion state survives. A text-bearing or positional
expansion key would lose that state during updates. Snapshot item identity and local
visibility/admission changes drive following and held-reader restoration; see
[supplied snapshot anchor restoration](conversation-shell-scroll-pin.md#supplied-snapshot-anchor-restoration).

`ThreadAttachmentScopeContext` carries snapshot host/conversation ownership and a
scope-owned image-source driver through reused file/image slots and attachment offers.
Availability checks use that host. File actions capture that target for local-original
opening and fallback retrieval; image retrieval/opening uses the same target. Changing
scope releases image shares/listeners through effect cleanup and cannot reuse another
scope's thumbnail URL merely because attachment ids match. Remounting rows alone would
not fix action ownership if their dependencies still read the global active chat.

[Scoped attachment retrieval](attachment-retrieval.md#5-the-composition-root--srcmainindexts)
now resolves explicit paired hosts independently of the conversation index, including unlisted
snapshots and equal conversation IDs across hosts. Coalescing owns resolved host/conversation/attachment;
terminals echo requested scope and only matching renderer listeners settle. The two-host production
variant uses real preload/main, while the renderer-only variant retains its local IPC fake.
The [thread runtime](thread-runtime.md) selects this production path. The supplied
tests establish client behavior with fake transport and do not claim live acceptance.

Local pending settlement and queue actions are supplied through `sendInputs`; see
[Composer send](composer-send.md#data-flow) and the
[queue authority contract](conversation-shell-behavior.md#what-it-does).
Production connects task controls, server paging/recovery and session-scoped live
admission through the [thread runtime](thread-runtime.md). A host without `thread`
shows daemon update-required and draws no content. Legacy roster events cannot
add rows or tasks. Supplied older batches remain presentation inputs in isolated
tests; production older demand invokes the thread query coordinator. See
[watermark-independent scroll restoration](conversation-shell-scroll-pin.md#supplied-snapshot-anchor-restoration)
and the designs for [item presentation](../../specs/architecture/1904-daemon-item-presentation.md)
and [supplied agent cards](../../specs/architecture/1937-supplied-agent-cards.md).

### Supplied-item verification

[`threadItems.test.tsx`](../../../src/renderer/src/screens/conversation/threadItems.test.tsx)
statically exercises kinds/order, hidden rows, inert fallback, activity independent
of status/position, terminal tools, recorded usage and supported notices. Agent
projection/static cases cover ancestry repair/cycles, capped depth, visibility,
descendant counts, direct and roster-shaped links, sibling placement, lifecycle and
bounded escaped fallback. Static rendering does not prove effects or interaction.
[`thread-items.spec.ts`](../../../e2e/thread-items.spec.ts) mounts an injected owner
using `createThreadItemStore`, typed appends/changes and completed-batch snapshots.
It checks retained row/tool/run state, current-text copy/reply, reader callbacks,
attachments, scope resets, following growth and held-reader prepends/revisions.
The supplied-agent scenarios additionally prove child-before-parent and late reparenting,
card/child/run expansion and marker navigation retention, immediate launch results with
work after the main reply, settled prior-session reopen and reused-scope isolation.
All its cases belong to the serialized clipboard project because copy assertions
share Electron's system clipboard.

[`active-agent-opacity.spec.ts`](../../../e2e/active-agent-opacity.spec.ts) uses native
fake-daemon replies with separate data/final frames. Its four
`active agent stays emphasized: compact=<boolean>, grouped=<boolean>` cases cover
compact omitted-detail headers and complete items, each grouped and ungrouped.
They require opacity 1 from the visible agent name through every ancestor to the
document root and an ordinary pending tool named `Agent` at 0.5. Grouped cases
verify `Using tools: 2`, collapse/reopen and repeat the measurements; all cases
retain the existing status/count assertions and attach mounted captures.

The [accepted Linux verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2172#issuecomment-6289239923)
at `86484e0c680078e229dd85c6b63b60c4c7f0ca9b` inspected all four pre-fix error
contexts showing ancestor opacity 0.5. The corrected focused run recorded
4 executed, 4 passed, 0 failed, 0 skipped, with all four named cases present and
passed; the verdict independently confirms their dispatcher JSON results.
The application run recorded 523 executed, 522 passed, 1 failed and 5 skipped;
the unrelated message-reply failure passed its same-tree rerun (4 executed,
4 passed, 0 failed, 0 skipped) and is tracked by
[#2173](https://github.com/pyrycode/pyrycode-desktop/issues/2173).
Review compared all four revision-matched 1280×773 captures (1280×800 windows)
with Figma `789:10437` and live row `789:10539`. This is mounted client presentation
evidence, with no live-provider requirement; macOS was outside this Linux ticket's
verification scope. These are retained results, not documentation-stage test runs.

The [supplied-agent verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/1939#issuecomment-6107300201)
at `916a2219ddd57f5914204a181a2e63022e409872` confirms the named mounted cases
`supplied agents repair nesting and retain lifecycle, expansion and scroll at 1280`
and `supplied agents repair nesting and retain lifecycle, expansion and scroll at 800`
were present and passed in dispatcher gate 6 on 2026-10-11: 384 executed, 384 passed,
0 failed, 3 skipped. Both use roster-shaped links and check active/settled ordering
before navigation and retention. Rework captures at 1280×773 and 800×773 fit the existing
card/marker styling against Figma 102:4; the injected fixture omits production shell
chrome. No real-Claude or production-thread capability acceptance was performed.

The [scoped retrieval verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/1933#issuecomment-6102697014)
at `ce88dd0029db01f4d13a3d5db6569be002376e9d` records all five thread-items cases
executed/passed, failed 0, skipped 0. Dispatcher gate 6 on 2026-10-10 executed 382,
passed 382, failed 0, skipped 3. Its named-test evidence confirms these cases present and passed:

- `snapshot attachment actions retain their host and conversation across reused IDs` — retained renderer proof.
- `snapshot attachment scope through daemon retrieval` — obsolete skip/name removed; off-selection,
  unlisted snapshots reach each supplied owner through real preload/main and both image rows decode.
- `a late retrieval disconnect cannot settle a switched thread with reused image IDs` — old host's
  disconnect crosses preload while the new host remains pending, then the new image completes.

The delayed-disconnect fixture must close `forwarder.closeClientLeg`, since closing the fake daemon
alone leaves the client relay leg open. Wait for the actual old-host terminal before asserting that
the switched image remains pending; otherwise the isolation assertion can pass before the event arrives.
Its malformed-host checks likewise use a valid unknown-host terminal as a receipt barrier.
See [retrieval testing](attachment-retrieval.md#testing) for unit coverage and storage/byte-read limits.

The [presentation verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/1925#issuecomment-6102450645)
confirms reused row styling at 1280 and 800 widths against Figma
102:4; the synthetic fixture omits the production shell. No live Claude or production
thread capability verification was required or performed.

## Shared row reuse and stopped-turn records

### Settled row reuse

`TimelineRow` uses ordinary shallow `React.memo`. The presentation adapter retains
unchanged immutable source presentations, so shared rows can skip execution when
their other inputs stay equal. Metadata, delivery, queue state,
action availability and callback changes remain observable. The separately memoized
[`AssistantMarkdown`](assistant-markdown-renderer.md#how-it-works) also skips parsing
when a row changes only its metadata or actions and its markdown inputs stay equal.
Frozen sources have separate header and complete-body caches. Rebuilding a closed
header on every unrelated delta or admission chunk would defeat tool memoization;
mutable sources remain uncached and revised frozen objects get fresh presentations.

Queue actions come from the shown supplied user item's usable queue handle and the
owning host's current eligibility. Unavailable actions receive `undefined`.
`ThreadItemsView` constructs callbacks/handles while rendering, so shallow memoization
does not promise that every unchanged queued row skips. Ignoring changed callbacks in
an equality shortcut could retain actions for an old pane. Scope remounting resets row
state even when another host reuses the same conversation and item ids.

Memoizing exported `ToolRow` directly would still rerender on fresh group/expansion
objects and toggle closures. Instead, private `TimelineToolRow` compares the original
item, item id, primitive supplied outcome/activity/count/expanded values, and one
stable keyed toggle. Only an executed wrapper constructs the shared `group` and
`expansion` objects. The toggle updates the keyed expansion set functionally;
`ToolRow` retains its standalone `defaultExpanded` state contract.

Visible wrappers update joins independently of the memoized contents. Hidden
descendants and folded members unmount; source-ID expansion sets restore their
result state on reopening. Metadata indexing and join scans still run, while full
visual presentation is demanded only for admitted visible rows. This reuse does
not establish constant layout cost or smoother scrolling through profiling. Design:
[settled row reuse](../../specs/architecture/1886-settled-row-reuse.md).

### Row reuse verification

[`e2e/settled-row-reuse.spec.ts`](../../../e2e/settled-row-reuse.spec.ts)'s
“settled rows skip deltas and unrelated group toggles while the active reply renders”
uses mounted V8 function counters with multiple settled messages, resolved grouped
and unrelated tools, and an active reply. Positive counts precede measurement, and
each of three chunks has its own display barrier before the next delivery. Each delta
executes one `TimelineRow`, one `AssistantMarkdown` and zero `ToolRow`s. Opening or
reopening the parent executes two tools (parent plus mounted child); child expansion
and parent collapse each execute one. All four toggles execute zero message,
markdown, parser or message-action functions, and child expansion survives absence.
`StreamingAssistantMarkdown` can execute again for its own partition-state update:
count its positive execution separately from the parent row, rather than requiring
one streaming-component call per delta. DOM identity alone cannot prove these skips.
The revised remount counts and frozen-header reuse passed in the
[deferred-expansion verification](conversation-shell-scroll-pin.md#deferred-expansion-verification).

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

`stoppedTurnText` suppresses `stopReason: 'cancelled'` first. Otherwise it formats
`isError: true` or a nonempty outcome other than `success`; success-with-error still
formats. A supplied shown `turn_end` remains visible even when that formatter returns
null: `TimelineRow.authoritativeSummary` supplies its fallback. Without recorded agent
attribution it uses that summary rather than assigning the current conversation's
agent. A nonempty terminal reason other than `completed` wins over the outcome:

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
recorded agent (`(Codex reported: …)` for a Codex item), read through an optional
second `agent: WireAgent = 'claude'` parameter on `stoppedTurnText`.

The formatter rechecks each report's 256-byte UTF-8 bound, discards overlong strings,
and strips Unicode controls, format characters and line/paragraph separators before
classification. React children escape the remaining text; it never enters markup,
attributes, URLs, commands or logs. `.stopped-turn` reuses the session-separator label
typography and shadow, with single-line ellipsis inside the thread width at 800px.
The row survives [recovery clearing and history replay](thread-timeline-internals.md#stopped-turn-state).

Shown stopped records participate in the [tool-stack join scan](conversation-shell-tool-row-header-groups.md#visible-tool-row-joins)
and end adjacent tool runs. `stoppedTurn.test.tsx` renders the shared row directly;
`toolRuns.test.tsx` checks supplied shown/hidden boundaries rather than legacy inference.
[Fake-transport coverage](e2e-harness.md#stopped-turn-evidence) proves
layout and command dispatch; it does not prove live compaction.
