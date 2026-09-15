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
Keying on the label instead would be a security regression, not just a display one: `WorkspaceRow`'s
trailing create-plus control (below) sends `group.key` back *out* to the daemon as a
`create_conversation` `cwd`, so a daemon-asserted workspace *name* would make the round trip out
again as a *directory path*. A unit test pins `key === row.cwd` on a labelled row specifically, so a
future "the label is the nicer identity" refactor reddens instead of shipping.

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
control keyed on this same `group.key` — a "Create chat" plus on a Chats-tree row, a "Create
channel" plus opening a dialog on a Channels-tree row — withheld on both trees from the
`UNKNOWN_WORKSPACE_KEY` fallback group and groups without a connected owning host.
A channel is no longer only reachable by [promoting an existing chat](save-as-channel-dialog.md); see [Create-channel dialog](create-channel-dialog.md)
for the direct path.

Both of those are creators *within* an existing group. [#1308](channel-list-host-row.md#the-add-workspace-dialog-1308)
added a **third**, one level up on the host row, that creates a group that has never existed: since this
whole tree is derived from the conversation list alone, a workspace is drawn only while a live conversation
sits in it, so a folder gets a row here for the first time the moment its first chat is created — never
before. See that dialog's write-up for the caller.

**A group leaves both trees the same way it arrives: by having no row left, not by any code that removes
it.** [#1439](https://github.com/pyrycode/pyrycode-desktop/issues/1439)'s [Edit workspace dialog Archive
workspace button](edit-workspace-dialog.md#the-archive-slot-editworkspacedialogtsx-added-by-1439) sends
one `archiveConversation` per active row this grouping would otherwise draw for that exact `cwd` on that
host; once the daemon's list reflects them archived, `partitionActive` drops every one of them before
`groupByWorkspace` ever runs, so the group is not hidden or filtered here — it simply has nothing left to
accumulate into its `Map` entry on the next re-list, the same absence that keeps a folder's group off the
trees before its first chat exists (§ above).

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
is the spec this fixes for, and rides the same both-trees idiom to prove it.

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
