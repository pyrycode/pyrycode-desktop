# Add workspace dialog

The [host row's hover plus](channel-list-host-row.md#the-rows-pen-and-plus-on-hover-1185)
opens `AddWorkspaceDialog` in `src/renderer/src/screens/channels/AddWorkspaceDialog.tsx`.
It starts a chat in an operator-typed folder on that host; the conversation list supplies
the new workspace group. The shared modal previews the remote destination; #1367 bounds its creation lifecycle.

## Connection and folder admission

`HostRowControl` supplies Add workspace only when
`selectStatusFor(serverId).type === 'connected'` and rechecks that host when invoked.
Missing, connecting, disconnected and failed states withhold the plus. Another connected
host or an open relay socket cannot enable it: eligibility requires the selected host's
authenticated session.

OK requires the same connection, a nonempty resolved destination and no pending attempt.
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

## Local wait and retry

The mounted dialog owns the folder, status, submitted marker and deadline.
`ChannelList` holds only `addWorkspaceServerId: string | null`; the dialog is keyed by
host and remounts with an empty field on reopen. Its status is `idle`, `creating`,
`rejected`, `disconnected` or `timed-out`.

Submission marks the attempt pending synchronously and arms the single named
`WORKSPACE_CREATE_DEADLINE_MS = 30_000` before dispatch. The field and OK are
disabled while pending; Cancel and close stay enabled throughout. A local bridge/build/send
failure, matching server rejection or selected-host connection loss ends the busy state
immediately, preserves the entered folder and makes it editable again. Feedback uses
fixed client copy: generic creation failure or guidance to connect this host.

With no result after 30 seconds, the error reads: “Could not confirm completion within
30 seconds. The chat may still appear.” Timeout and Cancel end only the local wait;
neither cancels a server-side create, which may still complete. Cancel or close closes the form
and discards its draft. After failure, retry requires an explicit OK click and
a connected selected host. Disconnect, timeout and reconnect never resend automatically.

Every settlement clears the deadline; retry arms a fresh one, so the old timer cannot
fail the new attempt. Success, Cancel and unmount clear the timer and remove both the
result and session-state subscriptions. Synchronous pending/closed refs prevent repeated
clicks before React renders and callbacks acting on a dismissed dialog.

## Host-scoped results

The dialog reads `window.pyry.onDaemonEvent` directly. The older
`subscribeConversationCreated` and `subscribeConversationCreateRejected` helpers drop
the main-stamped origin and cannot provide this boundary. Only a nonempty string
`event.serverId` exactly matching the selected host is accepted; missing, null, invalid
and foreign-host origins cannot settle this dialog.

A rejection affects only `creating`. A confirmation closes a still-open dialog after
any submission, including late success after timeout or failure. The independent
navigation subscription and [host-addressed list refresh](conversation-list-store.md)
show the created chat through the existing request-driven list reply. Results after
success or Cancel cannot reopen the dialog or its error.

Per-request correlation remains unchanged: main matches daemon rejection envelope ids,
but the renderer receives no create-request id. Concurrent creates or retries on the
same host remain indistinguishable; either result may belong to another same-host
attempt. This does not establish exactly-once creation. Matching `cwd` would not solve
correlation because the daemon may normalise the folder string. See
[create rejection correlation](daemon-connection-correlation.md#create-conversation-rejected-correlation-1307).

## Rendering and testing

The [shared Modal](modal-presentation.md) supplies a 640px panel, divided header,
close icon and centred Cancel/OK actions. The selected host's stored nonblank label
(or `Server`) is read-only. Reopening starts with an empty focused folder input and
empty labelled `output` preview. The input fill is 41%; preview text has full opacity.
Long preview text wraps and the panel scrolls in short windows. Escape and backdrop
clicks do not dismiss; Cancel and close remain available during creation.

The controlled input uses an escaped `value`; host label and preview render as escaped
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
