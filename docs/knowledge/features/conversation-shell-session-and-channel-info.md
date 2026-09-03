# Conversation shell — session boundaries and channel info

The session-boundary delimiter row and the Channel Info sheet — two conversation-wide surfaces split out of [Conversation shell — conversation surfaces and modals](conversation-shell-conversation-and-modals.md) on 2026-09-02 to keep that document under the size cap.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

## Session-boundary delimiter (#286, redrawn #690)

The fifth `ThreadItem` kind's render row (transport half was #285): marks where a `/clear`, an idle
eviction, or a workspace change started a fresh session. `TimelineRow`'s `sessionBoundary` case renders
a `<div className="session-delimiter">` — deliberately **no `data-thread-role`** (AC4, keeping it out of
the assistant/user/tool bubble count).

**#286 shipped it in mobile's shape** (Figma node 16-35): a monospace title stacked above a single
full-width rule, the title joined to a **long-form** relative time (`formatSessionBoundaryTime`, `2
hours ago` — a deliberate sibling of `channelListViewModel.ts`'s short-form `formatLastActivity`) via a
`now` prop threaded from `ConversationScreen`'s `Date.now()` through `Timeline` → `TimelineRow`. Copy for
`clear`/`idle_evict` was provisional (`New session` / `New session after idle`) since the Figma drew only
the `workspace_change` variant.

**#690 redrew it as the desktop chat screen's own shape** (Figma node 119-3843): one 16px-tall row —
hairline rule, centred label, hairline rule — replacing the stacked layout. Two copy decisions the
operator took 2026-08-22 drove the change: the reason still has to read differently in the words
themselves, so the label is no longer provisional — `Session reset` for `clear`, `Session reset after
idle` for `idle_evict`, narrower than the Figma's single "Session reset" node — and the relative time is
gone entirely, since every message above and below the row already carries its own timestamp.
`sessionBoundaryTitle(item)` in `sessionBoundaryViewModel.ts` collapsed from the two-function long-form
module into a single exhaustive label switch (`workspace_change` unchanged: `Workspace changed to
${workspaceCwd}`, degrading to the pathless `Workspace changed` on a `null` path); `formatSessionBoundaryTime`
and the `now` prop threaded through `Timeline`/`TimelineRow` for its sake are both deleted —
`ConversationScreen`'s own `now` stays, since the [Channel Info](#channel-info-sheet-365) and [Workspace
Picker](conversation-shell-workspace-and-run-config.md#workspace-picker-sheet-383) sheets still read it for their own relative-time lines.

The row is now two identically-classed `.session-delimiter__rule` siblings bracketing the centred label,
each `flex: 1 0 0` inside a `nowrap` flex row — equal halves at every container width by construction,
nothing kept in sync via a width or percentage. The label takes `--color-primary` and `--font-sans`
body-small (no `font-family` declaration — `.conversation` already sets `--font-sans` and a `<p>` has no
UA font-family to fight); the two hairlines take a new token, `--color-inverse-primary` (`#32628d`, M3
Schemes/Inverse Primary, `tokens.css`), at the Figma's own 60% opacity. `workspaceCwd` (an untrusted
daemon filesystem path) still reaches the DOM only inside the label string as auto-escaped React
children — the `toolCall`/`userText` posture, unchanged since #286. Both rules stay decorative
`aria-hidden` styled `div`s, not semantic `<hr>`s.

Row clearance (16px above/below) is the *sum* of `.conversation__thread`'s `gap: var(--space-3)` (12px)
and the row's own `--space-1` padding (4px) — not `--space-4`, which would double the container's
existing gap into 28px. AC5 (equal halves under resize; a long unbroken workspace path wrapping inside
the row rather than stranding a rule) was settled as review-by-inspection in the spec, since nothing
under `renderToStaticMarkup` can measure layout — but the PR discovered that the Playwright Electron tier
actually *can* resize the window (`app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]
.setSize(w, h))`; `page.setViewportSize` still does not apply to an Electron page), so AC5 was verified
by measuring real rects at 800px and 1600px rather than only inspected. The explanatory sentence and
`Install` affordance (Figma 16-38, #286's mobile file) remain out of scope, deferred with the
memory-plugin subsystem neither ticket depends on. See [#286 codebase notes](../codebase/286.md) for
\#286's original design and patterns established.

## Channel Info sheet (#365)

Makes the thread overflow menu's **Channel info** item (#276, previously a live no-op) open a new
bottom sheet (Figma node 20-48), reusing the Run-configuration `StatusSheet`'s `.status-sheet__*`
chrome verbatim — the second sheet to do so. Renders the active conversation's **About** detail
(Workspace `cwd` + Last activity), an empty **Actions** section slot, and a monospace **Channel ID**
footer. Renderer-contained: no transport, IPC, or wire code.

```
.conversation
├── … (StatusSheet, when sheetOpen)
└── ChannelInfoSheet                    (mounted last, when channelInfoOpen)
    └── ChannelInfoSheetView
        ├── .status-sheet-overlay__scrim         (onClick → onClose)
        └── .status-sheet  role="dialog"
            ├── .status-sheet__handle
            ├── .status-sheet__header             title (name / "Unnamed conversation" / "Channel info") + close
            └── .status-sheet__body
                ├── "About" section-header
                ├── .channel-info__row × 2          Workspace (mono, cwd) / Last activity  — or —
                ├── .channel-info__empty            "No conversation details yet" (conversation === null)
                ├── "Actions" section-header
                ├── .channel-info__actions          mount point for #366/#367/#368 (Rename+Archive built, Delete #367 open)
                └── .channel-info__footer           "Channel ID: {id}" (omitted when conversation === null)
```

**Open-state ownership stays local, not threaded through `PairedShell`.** `channelInfoOpen` is a new
`useState(false)` in `ConversationScreen` — the `sheetOpen` precedent (ADR 0006) — flipped by the
overflow menu's `onChannelInfo={() => setChannelInfoOpen(true)}`. This is a deliberate divergence from
\#276's original design: #276 shipped a speculative `ConversationScreenProps.onChannelInfo?` seam
assuming the sheet would live *above* `ConversationScreen` (opened by `PairedShell`). #365 retired that
prop instead (removed from the interface and the destructure) because the sheet's trigger, data
(`activeConversationStore`), and chrome are all `ConversationScreen`-local, exactly like `StatusSheet` —
splitting one sheet's control across two files for zero behavioral gain would have contradicted the very
precedent the seam was named after. No caller ever passed `onChannelInfo` (`PairedShell`, `App.tsx`, and
every test constructed props without it), so the removal is a pure simplification, not a breaking change.

**The menu that hosts this item grew from one item to three in
[#962](https://github.com/pyrycode/pyrycode-desktop/issues/962).** `Channel info` was `ThreadOverflowMenu`'s
only item until #962 retired the run-configuration row (#177) and the background-task trigger (#581),
both of which had no drawn home in the desktop design, and gave each a menuitem here instead —
`Run configuration` and `Background tasks`, added after `Channel info` in that order. `onChannelInfo`
went from #276's optional prop to one of three **required** action props on `ThreadOverflowMenu`, and
`ThreadOverflowMenuView`'s single literal `<button role="menuitem">Channel info</button>` became a map
over three `{ label, onSelect }` entries kept as literals inside the view — this item's copy and position
are unchanged, but it is no longer the only thing the view renders. See [Run-configuration row and
background-task trigger
retired](conversation-shell-chrome.md#run-configuration-row-and-background-task-trigger-retired-overflow-menu-grows-to-three-items-962)
for the other two items' own design.

**`conversation === null` renders gracefully, not a crash.** [`activeConversationStore`](conversation-shell-workspace-and-run-config.md#workspace-chip-278)
is written on exactly one path — the FAB create-nav callback — so a thread opened from the channel list
never populates it (the app's single-active-conversation interim). The sheet still opens: chrome + a
`CHANNEL_INFO_EMPTY_COPY` placeholder line in place of the About rows, and the Channel ID footer omitted
entirely (there is no id to show). `conversation.name === null` (an unnamed scratch conversation) is a
separate, narrower case — the title falls back to `UNNAMED_CONVERSATION_LABEL` — distinct from no
conversation at all.

**Deferred, not invented:** Figma 20-48 also shows Created / Total sessions / Total messages rows and a
Memory section — none has a field on the desktop `ConversationCreatedPayload`, so none is built. The
Channel ID footer ships at the app's `body-small` (12px) mono token rather than Figma's 11px — a
type-scale simplification (the app's fixed vocabulary is the fidelity ceiling, not a literal Figma
pixel match), not drift.

Escape-to-dismiss is wired via the same `document`-`keydown`-listener-scoped-to-mount-lifetime idiom
\#276 established (`DocumentEventMap['keydown']`, not a bare `KeyboardEvent` — this file's top-level
`import { type KeyboardEvent } from 'react'` shadows the DOM type). Untested here, same as #276's
Escape/outside-click and `StatusSheet`'s open-on-click wiring — the suite is `renderToStaticMarkup`-only,
no jsdom, so interactive effects are reviewed glue, not asserted. Not security-sensitive: the only daemon
strings rendered (`name`/`cwd`/`id`) are already rendered elsewhere in this file as auto-escaped React
children, same posture as `WorkspaceChip`. See [#365 codebase notes](../codebase/365.md) for the full
design and patterns established.

**Rename action ([#368](../codebase/368.md)).** The Actions slot's first filler: a Material 3 tonal
pill (Figma 20:89, `.channel-info__action`) rendered only when the container supplies an `onRename?`
callback — supplied exactly in the `conversation !== null` branch, so the null-conversation
graceful-empty case (above) offers no Rename control either. Activating it seeds and opens the
existing [Rename dialog](rename-conversation-dialog.md) (`RenameConversationDialogView`, #360) via a
second screen-local `useState` pair (`renameOpen`/`renameName`) the `ChannelInfoSheet` container
grows, mirroring `ChannelList.tsx`'s row-level rename state shape; Save dispatches the already-shipped
`renameConversation` command (#359) via `requestRenameConversation`, imported verbatim rather than
cloned. That helper's `row` param narrowed from `ConversationSummary` to `Pick<ConversationSummary,
'id'>` (it only ever read `.id`) so the sheet's `ConversationCreatedPayload` — a narrower 5-field
shape lacking `is_archived`/`last_message_ts` — passes directly, no adapter, no cast; the existing
`ChannelList` call site is unaffected (a wider shape still satisfies the narrower `Pick`). No new
transport, IPC, or wire code. See [#368 codebase notes](../codebase/368.md) for the full design and
patterns established.

**Archive action ([#366](../codebase/366.md)).** The Actions slot's second filler, landing one
merge after Rename and reusing its `.channel-info__action` tonal pill (Figma 20:94) verbatim — no
new CSS. Same callback-gate shape as Rename (`onArchive?`, supplied by the container only when
`conversation !== null`), but the handler itself is simpler: no dialog, just dispatch-then-close.
Activating it fires the already-shipped, previously-dormant [`archiveConversation`
command](conversation-archive.md) (#363) via a new exported helper, `requestArchiveConversation` —
a structural clone of `requestUnarchiveConversation` (`ArchiveScreen.tsx`) — with
`{ conversation_id: conversation.id }`, fire-and-forget, then calls the container's existing
`onClose`. Button order is Rename → Archive → the future Delete (#367), a destructive-last
convention. The archived conversation leaving the active list needs no new code here: the daemon's
`conversation_updated` broadcast reply rides the existing #275 list-re-request path, the same
mechanism the restore flow already proved in reverse (#346/#348). No transport, IPC, or wire code.
See [#366 codebase notes](../codebase/366.md) for the full design and patterns established.
