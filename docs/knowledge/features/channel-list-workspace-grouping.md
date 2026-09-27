# Channel List — workspace grouping

Split out of [Channel List home screen](channel-list.md) to keep that document under the doc-guard's
50000-byte cap (`npm run check:docs`) — this page holds the workspace-grouping section that grew past
it, added by #703 and extended since. Everything else about the screen (the view-model, server grouping,
the row's affordances, the host row, the status dot, CSS) stays on the parent page.

## Workspace grouping (`channelListViewModel.ts` / `ChannelList.tsx`, added by #703; the daemon-label preference added by [#1287](https://github.com/pyrycode/pyrycode-desktop/issues/1287))

Two pure exports, unit-tested without React: `workspaceLabelFor(cwd: string): string | null` —
the last usable `/`-separated segment of `cwd`, found by walking segments from the end and
returning the first non-blank one after trimming (survives a trailing separator, repeated
separators, and a whitespace-only tail with one rule, not a case per shape); returns `null` only
when every segment is blank. `\` is deliberately not treated as a separator — that would assume
the daemon's host OS, an interpretation this client never makes. And `groupByWorkspace(rows):
readonly WorkspaceGroup[]` — accumulates into a `Map` (never a plain object, since integer-like
string keys on an object enumerate first in numeric order regardless of insertion order, the same
trap `threadTimeline.ts` hit with `Object.entries`, #706), keyed by the *raw* `cwd` string for a
usable label (normalised in no way — `/a/b` and `/a/b/` honestly surface as two groups, both
labelled `b`) or by the module-local sentinel `''` for an unusable one. `''` is collision-proof by
construction: a `cwd` of `''` has no usable segment, so any row that could collide with the
sentinel is already in the fallback bucket by the same rule that assigned it. The fallback group is
labelled `UNKNOWN_WORKSPACE_LABEL = 'Unknown workspace'` and ordered by first appearance like any
other group — not pinned last.

**The group's *label* prefers the daemon's own name for the workspace; the *key* stays the raw
`cwd`, and that split is load-bearing.** `ConversationSummary`/`ConversationCreatedPayload`/
`ConversationUpdatedPayload` carry `workspace_label: string | null` (daemon pyrycode#2208) — the
name a workspace has been given on the daemon, stored against the exact `cwd` string, so every row
of one group agrees. `groupByWorkspace` reads it off the group's *first* row only, when non-null:
the `Map` sets a group's label just once, at creation, so "the first row's label" falls out of the
existing structure for free, and reading it is correct rather than merely cheap, since the daemon
holds one label per `cwd`. `null` on the first row falls back to `workspaceLabelFor(cwd)` exactly
as it did before #1287. The `key` a group is created and looked up under never changes — still
`workspaceLabelFor(row.cwd) === null ? UNKNOWN_WORKSPACE_KEY : row.cwd`, computed from `cwd` alone.
Keying on the label instead would change which workspace rows group together and which exact path
the Edit workspace control targets. A unit test pins `key === row.cwd` on a labelled row so a
future "the label is the nicer identity" refactor reddens instead of shipping. The create pluses
no longer send this key as a destination; they retain only the clicked host.

Two rules narrow the label further. The **fallback group** (`UNKNOWN_WORKSPACE_KEY`) is always
labelled `UNKNOWN_WORKSPACE_LABEL`, whatever its rows carry — it's a bucket, not a workspace, and
every row with an unusable `cwd` collapses into it regardless of origin, so naming it after one
member would assert something false about the others. And a **non-null label is used verbatim,
blank included** — no trim, no blank-to-fallback guard, the deliberate opposite of `titleFor`. The
label is state a user set from some other client; silently rewriting a blank one here would make
this desktop disagree with every other client about the workspace's name. The
[Edit workspace dialog](edit-workspace-dialog.md) accepts blank input as a reset:
it trims the draft and sends explicit `label: null` for blank or the folder-name
fallback, while disabling OK only above 128 UTF-16 code units. The
[`renameWorkspace`](https://github.com/pyrycode/pyrycode-desktop/issues/1289) transport
retains its existing validation boundary; rendering never silently rewrites a
received label.

The label reaches the sidebar over the existing `list_conversations` read path and the existing
`conversation_created`/`conversation_updated` bridges — no new store, no new IPC arm, no
`localStorage`. A label changed from another client is *not* read off the `conversation_updated`
broadcast's own payload, despite that payload carrying the field: [`shouldRefreshList`](conversation-list-store.md)
is and stays id/content-blind, so the broadcast only triggers a fresh `list_conversations` request,
and the changed label rides in on that reply's rows like any other field. **A *bare* workspace
rename — no conversation touched — fans out no `conversation_updated` at all**, so it stayed invisible
here until [#1288](https://github.com/pyrycode/pyrycode-desktop/issues/1288) added the daemon's dedicated
`workspace_updated` broadcast as a fourth `shouldRefreshList` trigger: correlated to whoever asked for the
rename and unsolicited to every other client, content-blind in the same way (`path`/`label` are never read
off the frame — the label that lands is always the re-listed row's own), so a rename performed from
another client, or from this one since
[#1289](https://github.com/pyrycode/pyrycode-desktop/issues/1289) shipped the sending half (no UI
affordance yet — #1180's dialog is the still-unbuilt sender), now reaches this sidebar without a
reconnect. See
[conversation list store](conversation-list-store.md) for the trigger's own edge-case writeup and
`docs/specs/architecture/1288-inbound-workspace-updated-relist.md` for the full design.

`renderBody` wraps each tree's existing `.map` one level, inside a keyed `Fragment` (the shorthand
`<>` cannot carry a key), still inside the same `length > 0` gate that already decides the host
row and section header — so the zero-row-renders-nothing invariant holds with no new condition.
`Fragment` emits no DOM, so the rendered list stays a flat sibling sequence and every
`.channel-list__row`'s ancestry is unchanged. `WorkspaceRow` is `HostRow`'s structural twin one
indent deeper (28px, same type), differing only in the 8px deeper left inset that shows the
nesting, and it's the file's first component whose visible label is untrusted daemon text rather
than a client-owned constant — since #1287 one of *two* possible daemon strings (the workspace's
own daemon-held name, or failing that the `cwd` segment), chosen by `groupByWorkspace` before this
component ever sees it, so the render side needs no branch for which one arrived — it ellipsizes
(the `.channel-list__title` treatment) where the host label, a six-character constant, does not
need to. The label reaches the DOM only as an auto-escaped React child, never an attribute (CLAUDE.md
2026-08-20, #696's MUST FIX). See [#703 codebase notes](../codebase/703.md) for the full
fallback-key trap and selector-hazard writeup.

Since [#1178](channel-list-workspace-row-nest.md)
and [#1179](create-channel-dialog.md), each `WorkspaceRow` optionally draws a trailing create
control — "Create chat" in Chats and "Create channel" in Channels — withheld from the
`UNKNOWN_WORKSPACE_KEY` fallback group and groups without a connected owning host. Each plus
opens a confirmation dialog and sends nothing until OK. The dialogs retain the clicked host,
including when another host has the same path, but neither offers a folder choice: chat sends an
unnamed, unpromoted create and channel sends a named, promoted create, both with `cwd: null` so
the daemon chooses that host's default folder. Cancel or close sends no create. Navigation waits
for the daemon's `conversationCreated` event. Channel rejection permits a retry and its optional
system prompt is written only after a same-host promoted/name-matched confirmation; see
[Create-channel dialog](create-channel-dialog.md). Ticket #1683 will relocate these controls to
the host's Channels and Chats sections without changing this create contract.

The Create chat overlay must sit above an already open Channel info sheet. At the sheet's old
stacking level the dialog was visible but its OK button could not be clicked. A static markup test
could not expose that; the fake-transport interaction opens the dialog over the sheet. The chat
modal also moves keyboard focus to Cancel, contains Tab in its controls and restores the invoking
plus on dismissal, which the keyboard interaction covers.

The two workspace-row pluses are currently *located* in an existing group, but their new rows
land in the daemon default group. [#1308](channel-list-host-row.md#the-add-workspace-dialog-1308)
added a **third**, one level up on the host row, that creates a group that has never existed: since this
whole tree is derived from the conversation list alone, a workspace is drawn under a host only while a live
conversation sits in it somewhere under that host, so a folder gets a row here for the first time the
moment its first chat is created — never before. See that dialog's write-up for the caller.

**Both trees repeat the same workspace set, per host ([#1485](https://github.com/pyrycode/pyrycode-desktop/issues/1485)).**
Before #1485, "somewhere under that host" meant *in the tree being drawn* — `renderServerTrees` derived
each host's groups from that tree's own rows alone, so the dialog above (which starts a chat) left a new
folder invisible under Channels, and a workspace holding only channels drew no group, and so no Create-chat
plus, under Chats. `groupByWorkspace` now takes a second, optional list — the *other* tree's rows for the
same host, never the whole other tree, since the key is a bare `cwd` and a path repeats across machines —
and folds in every key and label that list holds but the primary list does not, with `rows: []`. A group
with no rows in the tree being drawn still renders its head row, its plus and its pen, and expands to
nothing; the two trees can order one host's workspaces differently, each leading with its own rows' keys,
and the fallback (`UNKNOWN_WORKSPACE_KEY`) bucket is never propagated. See the `groupByWorkspace` and
`renderServerTrees` docblocks in `channelListViewModel.ts` / `ChannelList.tsx` for the mechanism; this page
tracks what it means for the two claims below.

**A group leaves the sidebar the same way it arrives: by having no row left, not by any code that removes
it — and since #1485 that "no row left" is judged per host across *both* trees, not per tree.**
[#1439](https://github.com/pyrycode/pyrycode-desktop/issues/1439)'s [Edit workspace dialog Archive
workspace button](edit-workspace-dialog.md#the-archive-slot-editworkspacedialogtsx-added-by-1439) sends
one `archiveConversation` per active row this grouping would otherwise draw for that exact `cwd` on that
host; once the daemon's list reflects them archived, `partitionActive` drops every one of them before
`groupByWorkspace` (primary list and `alsoFrom` alike) ever runs, so the group is not hidden or filtered
here — it simply has nothing left to accumulate into either tree's `Map` entry on the next re-list, the
same absence that keeps a folder's group off both trees before its first chat exists (§ above). Archiving
every row of a group that only ever held rows in *one* tree still empties both: the mirror in the other
tree was drawing its head row from that tree's `alsoFrom` contribution, which stops being offered the
moment the source tree has nothing left to contribute.

**Fixture note.** `conversationStateFake` (`e2e/fixtures/conversationStateFake.ts`) has to hold one
label per `cwd`, the same invariant the daemon holds, or the suite's two-trees idiom lies:
`workspace-collapse.spec.ts`'s pattern of seeding one promoted row and minting a second, unpromoted
one via the host row's Add-workspace plus (#1426) puts both rows under the *same* `cwd`
(`DEFAULT_CREATED_CWD` equals the default
seed's `/fake/workspace`), and the two trees group independently — so a fake minting a `null` label
for the created row would show the daemon name in one tree and the folder segment in the other,
reddening a spec against correct production code. The fake derives a `Map<string, string | null>`
from its seeded rows at factory time rather than taking a label as a fixture option (an option would
let a spec seed a state — two rows of one `cwd` disagreeing — the daemon cannot produce); its
`promote_conversation` and `change_workspace` arms, which both reassign a row's `cwd`, re-resolve the
label from that map too, so a row moved between workspaces takes its new workspace's name rather
than carrying the old one. [`e2e/workspace-label.spec.ts`](https://github.com/pyrycode/pyrycode-desktop/issues/1287)
is the spec this fixes for, and rides the same both-trees idiom to prove it. `e2e/fixtures/mintChatRow.ts`'s
`mintChatInWorkspace` uses the host row's Add-workspace plus: workspace-row creates now send
`cwd: null`, so that control is the path for minting into a named folder. Before #1485 a tree
drew a group — and therefore a plus — only for a workspace already holding a row in *that*
tree; the union closed that visibility gap but did not turn either plus into a folder picker.

**Touching this derivation moves counts across most of the sidebar's e2e tier, and the two failure
shapes are different (#1485).** Every spec asserting an exact count or an exhaustive list of
`.channel-list__workspace*` elements reads one more per host whose seed lands rows in only one tree —
that showed up as a normal, loud assertion mismatch. A second, quieter shape did not: several specs
called `.locator('.channel-list__workspace-create').click()` or the equivalent on a class both trees'
pluses now share, which was unambiguous while only one tree drew a group and became a Playwright
strict-mode violation once the mirror existed — a different failure than a count going stale, and one
label-count arithmetic alone does not predict. Those reads were scoped to the tree that owns the
gesture (by accessible name, or by tree index — the Channels tree renders first in `renderBody`, so
`.nth(0)` is Channels and `.nth(1)` is Chats) rather than loosened to `.first()`, which would let the
assertion silently follow whichever tree happens to draw first instead of the one the spec means to
exercise.

[#1288](https://github.com/pyrycode/pyrycode-desktop/issues/1288) added the one seam this fixture still
lacked: nothing let a spec change a held label *mid-test*, which a live rename from another client needs.
`conversationStateFake` now returns a **callable carrying an extra property**,
`renameWorkspace(cwd, label)`, rather than an object of two members — a function with a property is still
assignable to the bare `(inbound) => Uint8Array[]` every one of the 29 consuming spec files passes as
`buildReplyFrames`, so the seam cost zero call-site edits. One call moves both the `labels` map and every
held row sharing that `cwd`, then returns the unsolicited `workspace_updated` broadcast frame for the spec
to push via `daemon.pushFrame` — a spec cannot mutate the fake's held state and push a frame that
disagrees with it, since one call does both.

[#1289](https://github.com/pyrycode/pyrycode-desktop/issues/1289) hoisted that mutation into a
closure-scoped `renameWorkspace(cwd, label, inReplyTo?)` reached two ways rather than restated twice:
the exposed mid-test seam still calls it with two arguments (the unsolicited push above, unchanged
bytes), and a new `case 'rename_workspace'` in `buildReplyFrames` calls it with the request's own
envelope id as the third — the CORRELATED answer a client that actually asked for the rename receives,
`conversationDeletedFrame`'s `in_reply_to` idiom. One implementation of what moves means the two paths
cannot drift in what they mutate. The `labels` `Map`'s keys stopped being purely fixture-authored the
moment this arm landed — the app-under-test now supplies one via the sent command — but the safety
property that comment states was always the `Map` having no prototype chain to walk, not who authored
the key, so the comment was corrected to say that rather than widened.
[`e2e/workspace-updated-relist.spec.ts`](https://github.com/pyrycode/pyrycode-desktop/issues/1288) is the
consumer: it reads the OLD label first (load-bearing — without it the closing read would pass against a
fake seeded with the new label all along), calls `renameWorkspace`, then reads the NEW label with no
relaunch and no reconnect.

## Related

- [Channel List home screen](channel-list.md) — the parent page: the view-model, server grouping, the
  row's affordances, the host row, the status dot, and CSS.
- [Edit workspace dialog](edit-workspace-dialog.md) — the pen that renames a group's label, and since
  #1439 the Archive workspace button that empties a group by archiving every row this section groups.
- [Conversation workspace change § Workspace rename](conversation-workspace-change.md#workspace-rename-label-change-1289)
  — the `renameWorkspace` wire contract this section's label preference reads the result of.
- [Conversation list store](conversation-list-store.md) — `shouldRefreshList`'s trigger set, including
  the `workspace_updated` re-list arm this section's label freshness depends on.
