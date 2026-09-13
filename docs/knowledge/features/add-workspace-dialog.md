# Add workspace dialog

The [host row's hover plus](channel-list-host-row.md#the-rows-pen-and-plus-on-hover-1185)
opens `AddWorkspaceDialog` in `src/renderer/src/screens/channels/AddWorkspaceDialog.tsx`.
It starts a chat in an operator-typed folder on that host; the conversation list supplies
the new workspace group. The shared modal previews the remote destination and optionally
saves a shared workspace name after creation confirms the folder.

## Connection and folder admission

`HostRowControl` supplies Add workspace only when
`selectStatusFor(serverId).type === 'connected'` and rechecks that host when invoked.
Missing, connecting, disconnected and failed states withhold the plus. Another connected
host or an open relay socket cannot enable it: eligibility requires the selected host's
authenticated session.

Before creation, OK requires the same connection, a nonempty resolved destination,
a valid optional name and no pending attempt.
The folder resolver trims outer input whitespace. Blank input leaves the preview empty
and disables OK. A leading `/` preserves the trimmed absolute input; otherwise the
resolver joins it to this host's `ack.workspace_root`, removing the base's trailing
slash run and inserting one slash. `/` plus `child` becomes `/child`; `/base///` plus
`child` becomes `/base/child`. The base itself is not whitespace-trimmed.

The optional greeting string comes through the existing connected event and
`selectStatusFor(serverId)`. [Hello decoding](hello-exchange.md#parsehelloack--the-fail-closed-ladder)
preserves omission for older hosts and rejects present non-string values. Missing,
empty or non-absolute bases leave relative input unresolved, with “Host workspace
location is unavailable” feedback and OK disabled. Absolute input still works.
Neither another host's base nor the desktop's home is a fallback.

Preview and submission share the resolver. Immediately before dispatch, submission
rechecks the selected host in `sessionStore.getState()` and declines a changed greeting's
resolution until the displayed destination catches up. Main also
[refuses an unavailable connection](conversation-create.md#error-handling), covering a
connection lost between the renderer check and the send.

`requestNewWorkspaceChat` in `conversationCreatedBridge.ts` sends the previewed folder
as `{is_promoted: false, name: null, cwd}` with the clicked host's top-level `serverId`.
Resolution constructs a remote string: no local filesystem lookup, tilde expansion,
dot-segment collapse or symlink canonicalisation. Existing folders are reused; the
existing daemon create operation makes missing folders and parents, subject to its
validation and normalisation. No separate folder-creation request is sent.

## Optional shared name

Both inputs start empty on every opening. The name is trimmed at submission; its
trimmed JavaScript `.length` must be at most 128 UTF-16 code units. Above the limit,
OK is disabled and the name input has an accessible invalid state and length feedback.
Blank or whitespace-only input sends no rename, preserving any existing shared label
and the folder-name fallback for an unnamed workspace. Every explicit nonblank name
is saved, even when equal to the folder fallback. This differs from [Edit
workspace](edit-workspace-dialog.md), whose helper clears the label for blank or
fallback-equivalent input; Add workspace uses the underlying rename command directly.
Neither operation renames the chat or changes its folder.

## Local wait and retry

The mounted dialog owns both drafts, the submitted trimmed name, confirmed folder,
status, naming attempt and deadline. `ChannelList` holds only
`addWorkspaceServerId: string | null`; the host-keyed dialog remounts on reopen.
Statuses are `idle`, `creating`, `naming`, `rejected`, `disconnected` and `timed-out`.

Submission snapshots the trimmed name and starts an unnamed, unpromoted chat first.
The first accepted create confirmation pins `conversation.cwd` as the authoritative
remote folder without desktop resolution. The preview now shows that folder and the
folder input stays disabled for the rest of this opening. Blank names dismiss;
nonblank names start a host-addressed rename against that exact confirmed folder.
Further create notifications cannot restart this transition.

Each creating or naming phase independently arms a fresh 30-second deadline using
`WORKSPACE_CREATE_DEADLINE_MS`. Both inputs and OK are disabled while either phase
is pending. Synchronous status refs also block repeated clicks before React renders.
A local bridge/build/send failure, matching rejection or selected-host connection
loss ends the busy state immediately. Before creation confirms, both drafts remain
editable and explicit OK retries creation when connected. Create timeout says the
chat may still appear; it does not cancel the daemon's operation.

After creation, every naming failure retains the usable chat and fixed folder,
unlocks only the name, and shows client-owned failure or uncertainty copy. A naming
timeout says the name may still be saved. Explicit OK with a valid nonblank name
retries only naming when the selected host is connected, with a fresh UUID and
deadline; it never creates another chat. Blank input finishes without another rename,
even while disconnected. Finishing blank does not undo a rename already sent.
Disconnect, timeout and reconnect never resend automatically.

Cancel and header close remain available in both phases. They dismiss and discard
the drafts, retaining any created chat; they do not cancel an already-sent remote
operation. Every settlement clears the deadline. Dismissal and unmount remove the
result/session-state subscriptions and clear the timer; closed guards prevent a late
create confirmation from initiating naming or a late result from reopening the form.

## Host-scoped results

The dialog reads `window.pyry.onDaemonEvent` directly. The older
`subscribeConversationCreated` and `subscribeConversationCreateRejected` helpers drop
the main-stamped origin and cannot provide this boundary. Only a nonempty string
`event.serverId` exactly matching the selected host is accepted; missing, null, invalid
and foreign-host origins cannot settle this dialog.

A create rejection affects only `creating`. The first create confirmation after any
submission, including late success after timeout or failure, pins the folder and
continues with the submitted name as above. The independent
navigation subscription and [host-addressed list refresh](conversation-list-store.md)
show the created chat through the existing request-driven list reply. Results after
success or Cancel cannot reopen the dialog or its error.

Naming uses the [workspace rename result contract](daemon-connection-correlation.md#workspace-renaming).
Only `workspaceRenameResult` matching the selected host, current UUID and active
`naming` phase can settle the wait. Unsolicited `workspaceUpdated` broadcasts,
foreign-host results and results from earlier saves cannot confirm naming. A late
rename reply may still refresh the authoritative list without dismissing this dialog.
The shared label belongs only to the selected host, even if another host has the same path.

Create per-request correlation remains unchanged: main matches daemon rejection envelope ids,
but the renderer receives no create-request id. Concurrent creates or retries on the
same host remain indistinguishable; either result may belong to another same-host
attempt. This does not establish exactly-once creation. Matching `cwd` would not solve
correlation because the daemon may normalise the folder string. See
[create rejection correlation](daemon-connection-correlation.md#create-conversation-rejected-correlation-1307).

## Rendering and testing

The [shared Modal](modal-presentation.md) supplies a 640px panel, divided header,
close icon and centred Cancel/OK actions. The selected host's stored nonblank label
(or `Server`) is read-only. Reopening starts with an empty focused folder input and
empty labelled `output` preview, followed by one “Workspace name (optional):” input.
There is no duplicate read-only name row. The input fill is 41%; preview text has full opacity.
Long preview text wraps and the panel scrolls in short windows. Escape and backdrop
clicks do not dismiss; Cancel and close remain available during creation and naming.

The controlled inputs use escaped `value` attributes; host label and preview render as escaped
text. These values never supply a `title`, `aria-label`, id, key, lookup path or log
entry. Rejection feedback carries no daemon or caught-error text.

`AddWorkspaceDialog.test.tsx` covers static markup, slash joining, blank/unusable bases,
older-host absolute fallback, timeout copy and safe sinks. Decoder tests distinguish an
omitted root from a present non-string root. Two-host browser drives use different
bases and compare each preview with its captured create payload. Built-app captures at
1280×800 and 800×240 cover the presentation, decoded close asset and keyboard action
reachability with long paths. Mounted effects belong in `e2e/sidebar-add-workspace.spec.ts`:
unavailable hosts, connection loss, local failure, rejection, deadline, cancellation,
late success and explicit retry use the existing fake transport. Playwright's clock
proves the 29,999/30,000ms boundary and retry past the old deadline. Request counts prove
blocked/repeated clicks and reconnect never produce extra creates.

Naming coverage checks blank preservation, the trimmed UTF-16 boundary, explicit
fallback names, daemon-confirmed folder targeting, same-path host isolation and
naming-only retries. Keep request-driven list replies: dialog dismissal alone cannot
prove the shared label refreshed. Main tests separately require every update broadcast
and exactly one matching result, including duplicate replies and redial cleanup.

A valid-length name can still exceed the full wire-envelope cap beside a long
confirmed folder because JSON escaping expands the name. The mounted local-build-failure
test exercises this real encode failure and then retries with a shorter name, asserting
that the chat count and create request count do not increase.

Keep a second host connected and deliver its confirmation and rejection while the
selected host is pending. Two `conversationStateFake` instances both mint `created-1`;
use a distinct synthetic foreign-host confirmation id, or the active-row assertion can
match two rows. Prove navigation by a change to
`.channel-list__row-open[aria-current="true"]`. When the seed and created chats all read
`Untitled`, compare active-row element identity and require the chat count to increase;
a title assertion alone cannot distinguish them. A composer-count assertion can pass with navigation broken because
`launchPairedApp` already opens a seeded chat. Retain request-driven list replies so the
new workspace row proves refresh as well as dialog dismissal.

`e2e/real-daemon-add-workspace.spec.ts` uses `spawnClaude: false` and a nested path
under fixture-owned `daemon.workdir`. It first requires `ENOENT` for both parent and
destination, creates through the dialog, observes the new active chat and authoritative
workspace row, then checks both paths are directories. A second create must open another
chat while preserving the destination's device/inode identity. Filesystem assertions use
fixture-owned paths, never daemon-reported paths. An echoed `cwd` alone cannot prove
creation. Execution evidence is in the [live gate state](live-e2e-runbook.md#current-real-claude-gate-state).

## Related

- [Reusable modal presentation](modal-presentation.md) — shared panel and action contract.
- [Channel List — the host row and its connection dots](channel-list-host-row.md) — the parent page:
  the row and plus this dialog opens from.
- [Edit host dialog](edit-host-dialog.md) — the host row's other trailing control's dialog,
  sharing the frozen field, client-owned failure line and always-available Cancel.
- [Conversation create](conversation-create.md) / [Daemon connection correlation § Create-conversation
  rejected correlation](daemon-connection-correlation.md#create-conversation-rejected-correlation-1307) —
  the transport `requestNewWorkspaceChat` sends over and the round trip described above consumes.
