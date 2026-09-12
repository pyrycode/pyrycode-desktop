# Add workspace dialog

Split out of [Channel List — the host row and its connection
dots](channel-list-host-row.md) to keep that page under the doc-guard's 50000-byte cap
(`npm run check:docs`). The dialog opened by the [host row's hover
plus](channel-list-host-row.md#the-rows-pen-and-plus-on-hover-1185).

Introduced in #1308, the plus's first caller: clicking it opens `AddWorkspaceDialogView` (new,
`src/renderer/src/screens/channels/AddWorkspaceDialog.tsx`), a near-clone of
[`CreateChannelDialogView`](create-channel-dialog.md) (#1179) with a round trip added, which
makes [`EditHostDialogView`](edit-host-dialog.md) the closer relative below the field: a three-arm status (`idle` /
`creating` / `rejected`), a frozen field while the answer is outstanding, a client-owned failure line, and a
Cancel that is never disabled — load-bearing here specifically, since nothing times out the
`createConversation` round trip and a silent daemon would otherwise leave the dialog frozen with no exit.

**What it sends.** One absolute folder path, typed by the operator — `''.startsWith('/')` both refuses a
blank field and is the whole of the client-side rule, since the daemon owns confinement and existence
checks server-side and a client-side normalisation would silently split one sidebar group into two (`~/foo`
vs `/home/x/foo`). `requestNewWorkspaceChat` (new, `conversationCreatedBridge.ts`) is a **third sibling**
beside `requestNewConversation`/`requestNewChannel` rather than a widened parameter: same
`{is_promoted: false, name: null, cwd}` literal, with a top-level `serverId` main refuses to leave unnamed
once more than one server is paired — required, not optional, since this caller always knows which row's
plus was clicked. See [Conversation create](conversation-create.md) for the dispatch and [Daemon connection
correlation § Create-conversation rejected correlation](daemon-connection-correlation.md#create-conversation-rejected-correlation-1307)
for the round trip's daemon-side half.

**The in-flight gate is the whole of the round trip**, and it discharges #1307's obligation rather than
rediscovering it: both listeners (`conversationCreated`, `conversationCreateRejected`) act only while
`status === 'creating'`, read through a ref rather than a closure (the `useConversationCreatedNav` idiom).
A rejection at `idle` or `rejected` changes nothing. While the dialog's own create genuinely is
outstanding, a rejection belonging to the FAB's or the Channels-tree workspace plus's concurrent create is
**indistinguishable from its own** — the arm is nullary, so there is no per-request field to correlate on
even in principle. Accepted rather than designed away: it fails toward a false failure report on a create
that will still land, never a false success. Closing on confirmation does not match `cwd` for the matching
reason — a daemon that normalises the string would otherwise strand the dialog open over a chat it already
created.

**Container state lives inside `AddWorkspaceDialog` itself**, not in `ChannelList` — unlike
[the Edit host dialog](edit-host-dialog.md)'s three cells. `ChannelList` holds only the open cell,
`addWorkspaceServerId: string | null`, gated on `!== null` for `editHostServerId`'s reason and keyed by
server id so a reopen against a different machine remounts rather than reuses.

**Sinks.** The typed path reaches only the controlled input's `value`; `HostRow`'s four declined sinks (no
`title`, no `aria-label`, no id/key/lookup path, no log line) hold in full, and the rejection arm carries no
daemon byte at all to interpolate even by a future edit. **CSS:** `.add-workspace*` is its own class family
in `channels.css`, cloned from `.edit-host*` (the disabled-field/error-line pair) for the Playwright
strict-mode reason `.edit-host*` itself was kept separate from `.edit-workspace*`.

**Tests.** Unit: `AddWorkspaceDialog.test.tsx` — the disabled matrix, the three statuses' chrome, the sink
guard. E2E, fake tier: `e2e/sidebar-add-workspace.spec.ts` (new) — a happy-path launch and a refusal launch
against `conversationStateFake`'s new `createOutcome: 'rejected'` option (the first daemon refusal that
fake models at all), both reading the open row's title through `.channel-list__row-open[aria-current="true"]`
captured *before* the create so each read is a mutation check rather than a locator that could pass before
the click's async work resolves — a correction recorded in
`docs/specs/architecture/1308-host-row-add-workspace-dialog.md` § Revisions after the first run proved a
naive `.composer`-count assertion vacuous (`launchPairedApp` already leaves a composer on screen at
launch). `e2e/host-row-hover-controls.spec.ts` inverts rather than replaces its two "no Add workspace
button" reads — see [the host row's pen and plus on
hover](channel-list-host-row.md#the-rows-pen-and-plus-on-hover-1185).

## Related

- [Reusable modal presentation](modal-presentation.md) — shared panel and action contract;
  adoption is pending in [#1346](https://github.com/pyrycode/pyrycode-desktop/issues/1346).
- [Channel List — the host row and its connection dots](channel-list-host-row.md) — the parent page:
  the row and plus this dialog opens from.
- [Edit host dialog](edit-host-dialog.md) (#1299) — the host row's other trailing control's dialog, the
  closer relative to this one than [Create-channel dialog](create-channel-dialog.md): the three-arm
  status, the frozen field mid-flight, the client-owned failure line and the never-disabled Cancel are
  all shared with it.
- [Conversation create](conversation-create.md) / [Daemon connection correlation § Create-conversation
  rejected correlation](daemon-connection-correlation.md#create-conversation-rejected-correlation-1307) —
  the transport `requestNewWorkspaceChat` sends over and the round trip described above consumes.
