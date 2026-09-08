# Conversation shell — workspace chip and picker

The pre-first-message workspace chip on an empty new-discussion thread, and the Workspace Picker sheet that lets the operator switch or create the workspace a conversation runs in.

Part of [Conversation shell — workspace and run configuration](conversation-shell-workspace-and-run-config.md); see that document for the run-configuration sheet and its sections.

## Workspace chip (#278)

A pre-first-message pill at the top of the empty new-discussion thread, showing the workspace `cwd`
the discussion will run in before the user sends the first message, with a "change" affordance
reserved for the not-yet-built [#157](https://github.com/pyrycode/pyrycode-desktop/issues/157)
Workspace Picker sheet. Split from #148 alongside #276/#277/#279; no Figma frame exists (the mobile
file draws only the populated thread), so the design is sourced from the locked mobile design doc
(a Material 3 pill, "Workspace: … (change)", pre-first-message only; mobile #137) rather than a node.

A new discussion is an unpromoted conversation created via the [new-discussion
FAB](new-discussion-fab.md) (#242): the renderer fires `createConversation` and the daemon replies
with `conversationCreated` carrying the chosen `cwd`. That reply already reached [`PairedShell`'s nav
callback](paired-shell.md) — which dropped the payload after triggering the `open` transition. This
ticket is the first consumer of that payload beyond navigation.

**`activeConversationStore.ts` (new)** — a dedicated Zustand store, the `sessionIdStore` /
`conversationListStore` DI-factory → singleton → hook → selector shape, holding
`ConversationCreatedPayload | null` (`null` = "no conversation created/opened this session yet") **verbatim**
— snake_case, no camelCase remap, the `conversationListStore` doctrine — so the chip derives `cwd` and
`is_promoted` at the read boundary rather than the store drifting from the wire shape. `setActiveConversation`,
unconditional whole-value replace (most-recent-wins, no merge). [PairedShell's
`conversation_created` callback](paired-shell-routing.md#the-pure-view--container-pairedshelltsx) and a sidebar
row's `onOpen` (via `activateConversation`, handing the clicked `ConversationSummary` row straight to the
store — a structural superset of `ConversationCreatedPayload`) were this store's two writers at this
ticket's landing, and `WorkspaceChip` (below) was its sole reader. Since
[#1184](https://github.com/pyrycode/pyrycode-desktop/issues/1184) a third writer exists —
[`activeConversationReseedBridge`](paired-shell-conversation-exits.md#the-list-reseed-activeconversationreseedbridgets-1184)
re-seeds the snapshot whenever a later `conversations` reply describes the open chat differently — and the
reader list has grown well past `WorkspaceChip`, to the Workspace Picker sheet below and the [Channel Info
sheet](conversation-shell-session-and-channel-info.md#channel-info-sheet-365).

[#529](../codebase/529.md) added a second mutation, `clearActiveConversation`, returning the state to
the exported `initialActiveConversationState` constant — for when the conversation context that scoped
the payload ends. Named setters rather than a reducer: the two mutations are independent whole-value
writes, neither reading prior state nor constraining the other's ordering. Shipped with **no production
caller**. `PairedShell.tsx`'s `setActiveConversation` call site was the obvious-looking place to wire a
clear from, and [#530](../codebase/530.md) (navigation, shipped) did touch exactly that call site — but
deliberately did **not** call `clearActiveConversation` there: `setActiveConversation` stays
unconditional (a conversation switch still *records* the new conversation, it just also clears the
timeline and session id first via the new `activateConversation` helper — see [Paired
shell](paired-shell-routing.md#the-pure-view--container-pairedshelltsx)). [#531](../codebase/531.md) (unpair,
shipped) is `clearActiveConversation`'s sole caller, wired unconditionally into
[`clearPairingScopedState`](paired-shell-routing.md#the-pure-view--container-pairedshelltsx) — the pairing
context itself ending, rather than the active conversation merely changing, is exactly the case that
call site was reserved for. Until [#1141](https://github.com/pyrycode/pyrycode-desktop/issues/1141)
pairing another server reached this same clear; it no longer does, since adding a server ends no pairing
and the active conversation on an already-paired server has nothing to lose.

Rejected alternative: correlating `sessionIdStore`'s session id against a `conversationListStore` row.
There is no join key — `sessionIdStore` holds a daemon *session* routing id from `sessionTransition`,
`ConversationSummary` is keyed by conversation `id`, and the two are orthogonal ids; a lookup by the
synthetic `MILESTONE_CONVERSATION_ID` send-id would usually miss the daemon's real `conversations` list
too. The `conversationCreated` payload already in hand from the create round-trip is the narrow, correct
source — "the workspace this discussion will run in" is exactly what it carries.

**`WorkspaceChip` (`ConversationScreen.tsx`)** — the exact `ThinkingIndicator` idiom: the container
derives a value and passes it down, the pure exported view self-gates to `null`, no store read inside
the view. Mounted as a **sibling above `Timeline`**, below `ConnectionBannerControl`:

```tsx
<ConnectionBannerControl />
<WorkspaceChip conversation={activeConversation} isEmpty={items.length === 0} />
<Timeline items={items} />
```

```ts
export function WorkspaceChip({
  conversation,   // ConversationCreatedPayload | null — activeConversationStore's held value
  isEmpty,        // items.length === 0 — the pre-first-message window
  onChange        // optional () => void — the #157 seam; absent here
}: WorkspaceChipProps): JSX.Element | null {
  if (!isEmpty || conversation === null || conversation.is_promoted) return null
  // … renders a pill: WORKSPACE_CHIP_LABEL, conversation.cwd, and a Change button
}
```

**Gate:** `isEmpty && conversation != null && !conversation.is_promoted`. `is_promoted === false` is
the wire signal for a *discussion* (vs. a channel) — this is what makes the chip a new-discussion,
pre-first-message affordance only (AC1/AC3): once the first message lands, `items.length` flips
non-zero and the chip disappears; a promoted conversation never shows it at all.

**`cwd` is rendered whole and opaque** (AC2): plain React children (auto-escaped), never
`dangerouslySetInnerHTML`, and never split/basenamed/otherwise interpreted as a filesystem path (a
`cwd.split('/').pop()` would itself be "interpreting it as a path" — the toolCall/sessionBoundary
untrusted-string posture already in this file). An HTML-ish `cwd` (`<b>hi</b>`) renders as escaped text
(`&lt;b&gt;hi&lt;/b&gt;`), never markup. The client-owned `WORKSPACE_CHIP_LABEL = 'Workspace'` constant
is the `EMPTY_THREAD_COPY` idiom — apostrophe-free (`renderToStaticMarkup` escapes `'` → `&#x27;`) and
never a daemon string, so the label itself carries no untrusted content.

**"Change" affordance (AC4):** a `<button disabled={!onChange} onClick={onChange}>`. This ticket's
container passes no `onChange`, so the button ships visibly `disabled` — an honest placeholder, not a
silently-missing feature. #157 lands as a pure additive: pass an `onChange` that opens the Workspace
Picker sheet (Figma node 20-2) and the button un-disables, with no other change to this view — the same
optional-prop extension seam #276 originally reserved for #155's `onChannelInfo?` — [#365](../codebase/365.md)
later retired that speculative prop in favor of `ConversationScreen` owning the Channel Info sheet's
open-state itself (see [Channel Info sheet](conversation-shell-session-and-channel-info.md#channel-info-sheet-365) below), so `onChange?` here was, for
a time, the pattern's only live instance. **[#383](../codebase/383.md) bound it:** `ConversationScreen`
passes `onChange={() => setPickerOpen(true)}` (a `pickerOpen` `useState` twin of `channelInfoOpen`), which
un-disables the button — no other change to this view. See [Workspace Picker
sheet](#workspace-picker-sheet-383) below.

**Why a sibling, not nested inside `EmptyThread`.** #277's `.conversation__empty` surface pins the chip
"to the top of this surface" per its own CSS comment, but `WorkspaceChip` does **not** thread
`conversation`/`onChange` through `Timeline` → `EmptyThread` — that would widen `Timeline`'s
`{ items, now }` contract for an orthogonal concern and cascade its many bare-render test call sites. A
sibling `flex: 0 0 auto` chip above `Timeline` yields the identical visual result (pill on top, empty
surface filling below) with `Timeline`'s contract untouched and zero edits to its existing tests.

Styled `.conversation__workspace-chip*` (`conversation.css`) — token-only, no new token: `--radius-full`
for the Material 3 pill shape (`.tool-row__chip`'s corner at the time, `--radius-sm`, made fully round —
\#722 later moved the tool-row chip on to `--radius-xs` for the desktop redraw, so the precedent is
historical rather than a live cross-reference), `--color-surface-container-high` fill +
`--color-outline-variant` border (the `.conversation__banner` fill), `min-width: 0` +
`text-overflow: ellipsis` on the `cwd` run so an unbounded daemon path can't blow out the layout (the
`.tool-row__summary` treatment, still current).

Not security-sensitive: a pure renderer read of an already-decoded store value, rendered on React's
default-safe escaped path — no transport/crypto/socket surface touched. See [#278 codebase
notes](../codebase/278.md) for the full design and patterns established.

## Workspace Picker sheet (#383)

The UI slice of #157 (Figma node 20-2): a bottom sheet, opened from the `WorkspaceChip`'s "Change"
button, that lists the [recent-workspaces store](recent-workspaces-store.md) (#382), marks the row
matching the active conversation's current `cwd`, and dispatches the existing [`changeWorkspace`
command](conversation-workspace-change.md) (#379) on selection. Everything it consumes — the store +
its dormant data-path bridge (#382), the command (#379), `formatLastActivity` (#141), and the
`.status-sheet__*` chrome (#177/#365) — was already merged; this ticket adds one new file:
`WorkspacePickerSheet.tsx` (a pure view, a one-line dispatch helper, and an in-file container — the
`ChannelInfoSheetView`/`ChannelInfoSheet` split), plus an ~8-line wiring delta in `ConversationScreen`.
No new command, no new transport plumbing, no store change.

```
.conversation
└── WorkspacePickerSheet                (mounted beside ChannelInfoSheet, when pickerOpen)
    ├── RecentWorkspacesData             (#382's dormant bridge — mounted only while open, so
    │                                     each open fires a fresh one-shot requestRecentWorkspaces)
    └── WorkspacePickerSheetView
        ├── .status-sheet-overlay__scrim         (onClick → onClose)
        └── .status-sheet  role="dialog" aria-labelledby="workspace-picker-sheet-title"
            ├── .status-sheet__handle
            ├── .status-sheet__header             "Choose workspace" + close
            └── .status-sheet__body
                ├── "Recent" section-header
                ├── .workspace-picker__row × N     path (mono) + "Last used …" + "default" pill (if cwd match)
                ├── .workspace-picker__empty        "No recent workspaces" (workspaces === [])
                │                                   — no row, no empty copy at all when workspaces === null
                ├── "Other" section-header
                └── .workspace-picker__other        "Create new folder under <cwd>" (#398) — disabled only
                │                                     with no active conversation
                    └── CreateFolderDialog           (#398, mounted picker-scoped when open)
                        ├── NewFolderData             (#397's dormant bridge — mounted dialog-scoped)
                        └── CreateFolderDialogView    "Create workspace" dialog (Figma 19-44)
```

**Null-vs-empty store (AC1).** `workspaces` (from `useRecentWorkspacesStore(selectRecentWorkspaces)`)
is `null` while the one-shot request is in flight — the section header renders with no rows and no
empty copy — versus a delivered `[]`, which renders the header plus a client-owned
`.workspace-picker__empty` line. The two are structurally distinct output, the #141/#324 null-vs-empty
precedent, and neither branch crashes.

**"default" pill (AC2).** `activeCwd` — `conversation?.cwd ?? null`, sourced from
`activeConversationStore` (#278) — is compared by exact string equality against each row's `path`; a
match renders `.workspace-picker__default-pill` (secondary-container fill, Figma 20:36). `activeCwd
=== null` marks no row — the same graceful-empty posture the [Channel Info
sheet](conversation-shell-session-and-channel-info.md#channel-info-sheet-365) established for the same
store; see that store's own writer list above for when it is actually reachable.

**Choose → dispatch → close (AC3).** Each row is `disabled={!onChoose}`; the container supplies
`onChoose` only when `conversation !== null`, so a list-opened thread's rows render inert — the
`WorkspaceChip` disabled-until-wired idiom, reused for the same reason (no `conversation_id` to
dispatch with). When wired, choosing a row calls the new exported `requestChangeWorkspace(sendCommand,
conversationId, path)` — an inline `{ type: 'changeWorkspace', payload: { conversation_id: cwd }
}` literal (the `requestArchiveConversation` clone), mapping the row's `path` into the wire's `cwd`
field — then `onClose()`. Fire-and-forget, no optimistic update: the conversation **list** picks up the
new workspace only once the daemon's existing `conversation_updated` reply re-triggers the #275 re-list
(see [Conversation workspace change](conversation-workspace-change.md)). Before
[#1184](https://github.com/pyrycode/pyrycode-desktop/issues/1184), the active-conversation chip did not
live-update on that reply (`activeConversationStore` was written only on `conversation_created`/`onOpen`)
— reopening the picker right after a change still marked the *old* `cwd` until the next create or open.
Since #1184,
[`activeConversationReseedBridge`](paired-shell-conversation-exits.md#the-list-reseed-activeconversationreseedbridgets-1184)
reconciles the snapshot's `cwd` against that same re-list reply, so reopening the picker once that round
trip lands now marks the *new* `cwd` — the same round trip [Conversation workspace
change](conversation-workspace-change.md) already fires, with no extra request added.

**"Other" entry — create-folder dialog (#398).** The create-folder row is `disabled={!onCreateFolder}`;
the container now supplies `onCreateFolder` whenever `conversation !== null` (the same gating as
`onChoose` — the dialog needs the `conversation_id` its switch reflects onto), opening a new
`CreateFolderDialog` mounted picker-scoped. The label is now parent-specific — `` `Create new folder
under ${activeCwd}` `` — falling back to the generic `'Create new folder…'` only when there is no active
conversation to derive a parent from. The dialog is a near-clone of `RenameConversationDialog.tsx`
(Figma 19-44: "Create workspace" title, "What should this workspace be called?" field, Cancel/Create
actions), drives the [create-folder round-trip store](new-folder-store.md) (#397) — mounting its
previously-dormant `NewFolderData` bridge dialog-scoped so the daemon reply actually resolves — and on
the `created` outcome switches the conversation to the daemon's **returned** path verbatim via
`requestChangeWorkspace` (never a client-reconstructed path — the #288 EvalSymlinks lesson), then closes
both the dialog and the picker (`onCreated` is the picker's own `onClose`). A `rejected` outcome shows a
generic, apostrophe-free failure line and stays open for retry. See [#398 codebase
notes](../codebase/398.md) for the full implementation and lessons learned.

**Untrusted strings.** `path` renders as auto-escaped React children, never
`dangerouslySetInnerHTML`, never split/basenamed/otherwise resolved as a filesystem path — the
`WorkspaceChip`/`RecentWorkspace` posture carried forward. `last_used_at` is fed only to
`formatLastActivity`, which degrades an unparseable value to `''` (the `|| '—'` fallback) and never
throws.

**`conversation.cwd` is also a command argument, not only display text (found in #1184's code
review).** `CreateFolderDialog`'s Create action sends it verbatim as `requestCreateWorkspaceFolder`'s
`parent` argument — an outbound `create_workspace_folder` command — so whatever last wrote
`activeConversationStore`, including the [list
reseed](paired-shell-conversation-exits.md#the-list-reseed-activeconversationreseedbridgets-1184), can
move a value that leaves the client in a command payload, not only text on screen. It stays safe for
reasons already true of this path: the daemon polices `cwd` server-side (the `EvalSymlinks` #288 lesson
above governs what a *reply* can name, and the same daemon that would have to forge this row could send
a real `create_workspace_folder` itself), the value is shown to the operator in this dialog's "Create
new folder under …" line before they act, and the reseed can only ever rewrite the *already-open*
conversation's own row — it never redirects which `conversation_id` the dialog addresses.

Two glyphs (`FolderIcon`/`FolderPlusIcon`) are inline `currentColor` Material SVGs, not the Figma's
asset images or accent colors — the app's standing "no asset fetch, no hardcoded illustration hex"
posture, flagged as a non-gating NIT in code review for designer awareness. Styled entirely with
`.workspace-picker__*` classes in `conversation.css` — token-only, no new CSS token (the pill reuses
`--color-secondary-container`/`--color-on-secondary-container`, already introduced by earlier tickets).

Not security-sensitive: a pure renderer read of two already-decoded stores plus a dispatch of an
already-guarded command; no transport/crypto/socket surface touched. Code review PASS, two non-gating
NITs (glyph coloring, the deferred create-folder label). See [#383 codebase
notes](../codebase/383.md) for the full design and patterns established.

