# Channel List — the workspace row's own nest and its create-chat plus (#1178)

Split out of [Channel List — the row's desktop geometry](channel-list-desktop-row-geometry.md), the map
page for this row's geometry history, once that page grew past the doc-guard's 50000-byte cap
(`npm run check:docs`). Read the map page first for the surrounding context.

The redrawn `Workspace` component (Figma 399:1059, placed as 405:7456 inside a `pl-[20px]` wrapper
405:7469) puts the workspace row's own geometry through the same two moves the channel row
([#1171](channel-list-row-hover-control.md)) already had: a deeper card-edge nest, and a hover-revealed
trailing control. Where #1171 landed those on
`.channel-list__row`, #1178 lands them on `.channel-list__workspace` — and the two rows' labels now share
one left edge (50px from the card's content edge) for the first time, closing the 2px gap the tie-break
in [the tree's inset](channel-list-tree-inset.md) had left standing since before #1171.

**A wrapper element is now necessary, not just a convenience.** `WorkspaceRow` returns
`<div class="channel-list__workspace-head">` holding the disclosure `<button class="channel-list__workspace">`
and a new plus `<button class="channel-list__workspace-create">` as **siblings**, never nested — an
interactive control cannot sit inside a `<button>` (#274), which is also the entire mechanism behind
"clicking the plus never toggles the fold": the click simply never reaches the disclosure's handler. The
wrapper is also the plus's positioned ancestor: `.channel-list` is `position: relative` for a stacking
reason (see [the section header's pair control § `channels.css`'s head
paragraph](channel-list-section-header-pair-control.md#the-hoverfocus-name-pill-channelscsschannellisttsx-added-by-1304)
for the `::before` painting-order argument that rule rests on), so an absolutely positioned plus with no
nearer containing block would pin itself to the scroll column instead of to this row. The wrapper wraps the head
row only — a group's channel rows stay flat siblings of `.channel-list`, preserving the ancestry the
existing e2e specs click through. Its class, `channel-list__workspace-head`, was chosen to share no token
with any strict-mode locator (`.channel-list__workspace`, `.channel-list__row`, `.channel-list__row-open`,
`.channel-list__section-header`, `.channel-list__host`) and to not appear as a substring of
`class="channel-list__workspace"` in the unit tier's markup assertions — both hold by construction (class
selectors match whole tokens; the marker string carries its closing quote).

**Geometry**, all measured from the card's content edge: the wrapper takes `margin-left: var(--space-5)`
(20px), the same "margin on the row because there is no group wrapper" idiom `.channel-list__row` already
uses. `.channel-list__workspace`'s padding moved from `--space-1 --space-4 --space-1 --space-6` to
`--space-1 --space-8 --space-1 --space-2` and its gap from `--space-3` (a tie-break, no token being
exactly 10) to `calc(var(--space-2) + 2px)`, written as a sum for the same reason
`.channel-list__row-open`'s 22px left padding is: the arithmetic is the point, not the pixel count. That
lands the 12px folder glyph at 28 and the label at 50 — exactly `.channel-list__row-open`'s title
position, so **the workspace label and the channel titles now share one left edge**. `flex: 1 1 auto` on
the button spans it to the wrapper's far edge (the content edge), and `min-width: 0` beside it is
load-bearing rather than copied: this button is now a flex item of a **row**-direction wrapper, where the
automatic minimum size resolves against the main (horizontal) axis and is opaque to the label's own
`min-width: 0` / `overflow: hidden` ellipsis chain — unlike `.channel-list__row`, still a column child,
which needs no such declaration on itself. Without it an unbounded daemon `cwd` label would widen the row
past the 400px sidebar. The `:hover` fill (`--color-surface-container`, the file's own stand-in from when
the design pinned no hover state at all) is deleted outright: the redrawn Hover variant differs from Idle
by its controls alone, drawing no fill; `:focus-visible` stays, per the file's convention of treating it
as an outline rather than a statement about the drawn hover state.

**#1487 re-derived that geometry without moving either landing point, and gave the row its own
fold-state read — the row no longer draws identically in both disclosure states, and this page's account
above is now history rather than the current rule.** The redrawn component takes the folder glyph out of
the flex flow (`Row icon` 399:1034, absolutely positioned inside `.channel-list__workspace`, which is why
that rule now carries `position: relative` — against the button, not `.channel-list__workspace-head`,
whose own `position: relative` for the plus and the pen would otherwise land the glyph 30px too far left)
and gives the label the row's whole 30px left padding instead of the 8 + 12 + 10 the old flow summed to.
Both land the label at the same 50px from the card's content edge, so this is a change to how the row is
*built*, not to where its parts sit. `gap` falls from 10 to 6 (`calc(var(--space-1) + 2px)`), now spent
between the label and a new trailing chevron rather than between the glyph and the label. The glyph
itself swaps with `expanded` — Font Awesome `folder-open-solid` (510:2214) open, the shipped Material
`folder` path shut, a render branch rather than a transform because the two states are two different arts
— and a down/right chevron (Figma `Chevron` 510:2328) follows the label at that 6px gap, turned a quarter
by one `channels.css` rule keyed to `.channel-list__workspace[aria-expanded='false']` rather than by a
second render branch, so `aria-expanded` stays the sole state signal. Both marks are `aria-hidden`, carry
no text, and add no attribute to the button, so `class="channel-list__workspace"` stays the sole token
`WORKSPACE_ROW_MARKER` pins. One ticket revision touches this section's own claims:
`.channel-list__workspace-label` drops its `flex-grow` (`1 1 auto` → `0 1 auto`) — a stretched label had
drawn identically to an unstretched one since #1178 because nothing followed it, and the chevron is what
made that latent mismatch visible (it rendered ~230px right of the label on the first capture). The
shrink and `min-width: 0` that "a long `cwd` truncates first" rests on are untouched; the button's own
`flex: 1 1 auto` still spans the click target to the wrapper's far edge.

**A workspace group with no rows in the tree being drawn renders no chevron, in either state** — the
visible half of [#1485's union](channel-list-workspace-grouping.md), which is what first made such a
group reachable in production (a `cwd` with rows in the *other* tree and none in this one). The row stays the disclosure button and still swaps
its folder glyph, because it still folds; only the fold mark is withheld, since there is nothing under it
to fold. `CollapsibleWorkspaceGroup` derives the flag itself — `Children.count(children) > 0` — rather
than taking it as a prop, which is the whole reason the heavily-commented `CollapsibleWorkspaceGroup` call
site in `renderServerTrees` gained nothing for this change.

**The plus** (`.channel-list__workspace-create`, Figma "Icon Edgeless" 399:1065) is a 20×20
(`--space-5`) absolutely positioned box at `right: 0; top: var(--space-1)`, centring a 16px glyph so it
reproduces the drawing's rectangle (right 2, top 6 in the 28px row) with no pixel literal — the same
box-minus-glyph-halved arithmetic `.channel-list__save`/`.channel-list__rename` already use one level up.
Filled `--color-primary`, no background, no hover circle. Reveal is `opacity` and never `display: none` /
`visibility: hidden` — #1171's ruling, restated here because the mechanism is what keeps the control
keyboard-reachable and present in the accessibility tree at rest, which is the acceptance criterion this
ticket names explicitly. The rule positions itself against the wrapper's own trailing edge rather than
against "being the only control", so #1180's 14×14 pen can land at `right: 28px` beside it without this
rule moving.

**Wiring rides one shared helper, not a per-tree map.** Since #1070's server loop, both the Channels and
Chats trees render through one `renderServerTrees`, so the per-tree difference has to travel as a
parameter rather than a code-path split: `renderServerTrees` takes an optional trailing `create` control,
its inner `workspaceGroups` closes over each group's own key and hands `CollapsibleWorkspaceGroup` a
nullary `create?: WorkspaceCreateControl`, which reaches `WorkspaceRow` unchanged — the same
optional-value shape `Row` already uses for `onSaveAsChannel`. `renderBody` builds one control object
per tree at its two `renderServerTrees` calls — the only place the two trees are told apart — and since
[#1179](create-channel-dialog.md) supplies one to **both**: the `channels` call's opens [the
Create-channel dialog](create-channel-dialog.md) instead of sending a command directly, the `discussions`
call's still fires `(cwd) => requestNewConversation(window.pyry.sendCommand, cwd)` — the FAB's own
constructor ([conversation-create.md](conversation-create.md)), and `requestNewConversation`'s **second
caller**, the first with a `cwd` that is not the client's own saved default.

**#1179 turned the threaded value from a bare callback into one object carrying a name too.**
`WorkspaceRow` used to hard-code `CREATE_CHAT_CONTROL_LABEL` on the plus's `aria-label`; once the
Channels tree needed its own label ("Create channel"), a second optional prop beside `onCreate?` would
have admitted a handler with no name and a name with no handler. Instead `CollapsibleWorkspaceGroup` and
`WorkspaceRow` both take one `create?: WorkspaceCreateControl` (`{ readonly label: string; readonly
onCreate: () => void }`, module-private to `ChannelList.tsx`), so the invariant is structural rather than
disciplined: a tree either offers a named create or offers none. See [Create-channel
dialog](create-channel-dialog.md) for the dialog itself, the `requestNewChannel` command constructor, and
the container state that opens it.

**The unknown-workspace group is withheld by its key, never by its label — in both trees since #1179.**
`groupByWorkspace`'s fallback bucket keys on `UNKNOWN_WORKSPACE_KEY` (`''`, exported by this ticket for
its first outside consumer), which names no directory and is **not** the same signal as the `cwd: null`
"take the daemon default" the create payload keeps distinct on the wire; sending `''` as a `cwd` would
ask the daemon to create in its own process directory. `renderServerTrees` compares the group's *key*
against the sentinel and withholds the `create` control there — never against `UNKNOWN_WORKSPACE_LABEL`
— so a real directory a user happens to name "Unknown workspace" is an ordinary group and keeps its
plus. #1179 reuses this same withhold for the Channels-tree plus with no new condition, since one
`create === undefined || group.key === UNKNOWN_WORKSPACE_KEY` check now gates both trees' controls.

**Security review note, carried forward because it is the first time this value crosses this
boundary:** `group.key` is `row.cwd`, daemon-asserted text that until now the sidebar only ever used as
an escaped React child, a `Map` key or a React key. This ticket hands it to `requestNewConversation` as
an *outgoing* command field for the first time. It travels verbatim — no normalisation, no trim, no
`path` module — because `isCreateConversationPayload` re-validates at the renderer→main boundary and
`daemonConnection.createConversation` rebuilds a fresh three-field literal before the send, and because
the reachable set of values is a strict subset of paths the daemon itself asserted (the client mints no
key but the withheld `''` sentinel). An oversized `cwd` fails closed the same way an oversized name
already does — `buildCreateConversation` throws on the plaintext cap and the send is dropped, never
partially written.

**The control's name**, `CREATE_CHAT_CONTROL_LABEL = 'Create chat'`, is a client-owned module constant
read by the plus's `aria-label`, in the `RENAME_CONTROL_LABEL` / `SAVE_AS_CHANNEL_CONTROL_LABEL` idiom
two rows up; #1181's tooltip pill becomes its second reader. #1179 added its sibling,
`CREATE_CHANNEL_CONTROL_LABEL = 'Create channel'`, for the Channels-tree plus — the two words differ
because the two trees create different things (an unnamed ad-hoc chat vs. a named, promoted channel),
and both constants are read exclusively at `renderBody`'s two `renderServerTrees` calls now, bundled
into their tree's `WorkspaceCreateControl` (see above). The daemon-supplied workspace label never
reaches an attribute of the control, on the same four-sink rule (`title`, `id`, a URL, a CSS custom
property) `WorkspaceRow`'s own comment already declines for the disclosure above it.

**Testing.** `ChannelList.test.tsx` counts `aria-label="Create chat"` once per Chats group and zero times
in the Channels slice, `aria-label="Create channel"` the reverse (since #1179), checks the plus's `<svg>`
for `width="16" height="16"`, and reconfirms `WORKSPACE_ROW_MARKER`/`WORKSPACE_LABEL_OPEN` still match
byte for byte at one per group now that the wrapper sits above the disclosure button. `createTagsIn`
widened from asserting one control to asserting both by their distinct labels — the one assertion #1179's
plan named as the cost of sharing `.channel-list__workspace-create` across both trees.
`e2e/sidebar-tree-geometry.spec.ts` retargets `WORKSPACE_ICON_X` to `CARD_INSET_PX + 28` and adds
`WORKSPACE_LABEL_X`, asserted equal to `TITLE_X`. `e2e/sidebar-workspace-create.spec.ts` (the Chats-tree
plus's own drive) seeds its clicked group's `cwd` at a path **other than** the fake harness's
`DEFAULT_CREATED_CWD` (`conversationStateFake` mints a created row at `payload.cwd ?? DEFAULT_CREATED_CWD`,
which happens to equal the default seed's own workspace) — otherwise a plus that silently sent `null`
would still land its row in the same group and the drive would pass with the bug present. It reads the
plus's box and opacity at rest/hover/focus (the last via a real Tab traversal, not `locator.focus()` —
the same `:focus-visible` modality trap #1171 already documents), then clicks it and reads the row
count and the group's own row count going up before reading `aria-expanded` unchanged. Its seed is a
single **unpromoted** row, so #1179's Channels-tree plus renders no group at all and this spec's strict
`.channel-list__workspace-create` locator still resolves to exactly one element even though both trees
now draw that class — which is why #1179 needed no edit here. The Channels-tree plus's own drive,
covering the dialog it opens, is [`e2e/sidebar-create-channel.spec.ts`](create-channel-dialog.md#testing).

## Related

- [Channel List — the row's desktop geometry](channel-list-desktop-row-geometry.md) — the map page.
- [#1178 spec](../../specs/architecture/1178-workspace-row-nest-and-create-chat-plus.md) — the workspace
  row's own 20px nest and its create-chat plus.
- [#1487 spec](../../specs/architecture/1487-workspace-row-fold-state-glyph-and-chevron.md) — the
  fold-state glyph swap and chevron, and the re-derivation of this row's geometry once the glyph left
  the flex flow.
- [Channel List — workspace grouping](channel-list-workspace-grouping.md) (#1485) — the both-trees union
  that first makes an empty workspace group reachable in production, the shape this row's withheld
  chevron responds to.
- [Create-channel dialog](create-channel-dialog.md) (#1179) — the Channels-tree plus's own dialog, the
  `requestNewChannel` command constructor and the `WorkspaceCreateControl` reshape this page documents.
- [Channel List — the workspace row's plus names itself in a pill](channel-list-workspace-plus-pill.md)
  (#1181) — the plus's own name pill.
- [Conversation create](conversation-create.md) — `requestNewConversation`'s constructor and the
  `conversationCreated` event-driven nav the plus's click resolves through; the FAB's own consumer doc.
- [Channel List — the tree's inset](channel-list-tree-inset.md) — the tie-break gap this ticket closed.
