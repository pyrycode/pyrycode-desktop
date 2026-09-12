# Add workspace dialog

The [host row's hover plus](channel-list-host-row.md#the-rows-pen-and-plus-on-hover-1185)
opens `AddWorkspaceDialog` in `src/renderer/src/screens/channels/AddWorkspaceDialog.tsx`.
It starts a chat in an operator-typed folder on that host; the conversation list supplies
the new workspace group. The single-field form introduced in #1308 keeps its existing
disabled-action and error styling; #1367 bounds its creation lifecycle.

## Connection and folder admission

`HostRowControl` supplies Add workspace only when
`selectStatusFor(serverId).type === 'connected'` and rechecks that host when invoked.
Missing, connecting, disconnected and failed states withhold the plus. Another connected
host or an open relay socket cannot enable it: eligibility requires the selected host's
authenticated session.

Start chat requires the same connection, an absolute folder path and no pending attempt.
Submission rechecks `sessionStore.getState()` immediately before dispatch. Main also
[refuses an unavailable connection](conversation-create.md#error-handling), covering a
connection lost between the renderer check and the send.

The folder rule is `path.trim().startsWith('/')`. `requestNewWorkspaceChat` in
`conversationCreatedBridge.ts` trims edge whitespace and sends
`{is_promoted: false, name: null, cwd}` with a required top-level `serverId` from the
clicked host row. It performs no local resolution, `..` collapse or trailing-slash
normalisation. The daemon retains ownership of folder creation and validation.

## Local wait and retry

The mounted dialog owns the folder, status, submitted marker and deadline.
`ChannelList` holds only `addWorkspaceServerId: string | null`; the dialog is keyed by
host and remounts with an empty field on reopen. Its status is `idle`, `creating`,
`rejected`, `disconnected` or `timed-out`.

Submission marks the attempt pending synchronously and arms the single named
`WORKSPACE_CREATE_DEADLINE_MS = 30_000` before dispatch. The field and Start chat are
disabled while pending; Cancel stays enabled throughout. A local bridge/build/send
failure, matching server rejection or selected-host connection loss ends the busy state
immediately, preserves the entered folder and makes it editable again. Feedback uses
fixed client copy: generic creation failure or guidance to connect this host.

With no result after 30 seconds, the error reads: “Could not confirm completion within
30 seconds. The chat may still appear.” Timeout and Cancel end only the local wait;
neither cancels a server-side create, which may still complete. Cancel closes the form
and discards its draft. After failure, retry requires an explicit Start chat click and
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

The typed path's form sink is the controlled input's escaped `value`; it never supplies
a `title`, `aria-label`, id, key, lookup path or log entry. Rejection feedback carries no
daemon or caught-error text. The `.add-workspace*` class family in `channels.css` keeps
the dialog's disabled field and error line distinct from the host/workspace edit dialogs.

`AddWorkspaceDialog.test.tsx` covers static markup, connection/path admission, timeout
copy and safe sinks. Mounted effects belong in `e2e/sidebar-add-workspace.spec.ts`:
unavailable hosts, connection loss, local failure, rejection, deadline, cancellation,
late success and explicit retry use the existing fake transport. Playwright's clock
proves the 29,999/30,000ms boundary and retry past the old deadline. Request counts prove
blocked/repeated clicks and reconnect never produce extra creates.

Keep a second host connected and deliver its confirmation and rejection while the
selected host is pending. Two `conversationStateFake` instances both mint `created-1`;
use a distinct synthetic foreign-host confirmation id, or the active-row assertion can
match two rows. Prove navigation by a change to
`.channel-list__row-open[aria-current="true"]`, with the starting title captured before
creation. A composer-count assertion can pass with navigation broken because
`launchPairedApp` already opens a seeded chat. Retain request-driven list replies so the
new workspace row proves refresh as well as dialog dismissal.

## Related

- [Reusable modal presentation](modal-presentation.md) — shared panel and action contract;
  adoption is pending in [#1346](https://github.com/pyrycode/pyrycode-desktop/issues/1346).
- [Channel List — the host row and its connection dots](channel-list-host-row.md) — the parent page:
  the row and plus this dialog opens from.
- [Edit host dialog](edit-host-dialog.md) — the host row's other trailing control's dialog,
  sharing the frozen field, client-owned failure line and always-available Cancel.
- [Conversation create](conversation-create.md) / [Daemon connection correlation § Create-conversation
  rejected correlation](daemon-connection-correlation.md#create-conversation-rejected-correlation-1307) —
  the transport `requestNewWorkspaceChat` sends over and the round trip described above consumes.
