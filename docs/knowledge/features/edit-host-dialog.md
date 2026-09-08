# Edit host dialog

Split out of [Channel List — the host row and its connection
dots](channel-list-host-row.md) to keep that page under the doc-guard's 50000-byte cap
(`npm run check:docs`). The dialog opened by the [host row's hover
pen](channel-list-host-row.md#the-rows-pen-and-plus-on-hover-1185).

Introduced in #1299 (split from #1187), the pen's first caller: clicking it opens `EditHostDialogView` (new,
`src/renderer/src/screens/channels/EditHostDialog.tsx`), a near-clone of
[`EditWorkspaceDialogView`](edit-workspace-dialog.md) (#1180) that renames the machine through
`window.pyry.setHostLabelFor` (#1186) — the write reaches no daemon: no wire type, no command, no
bridge change.

**Two departures from the sibling dialog, both deliberate.** Save is enabled on a blank name — a host
has no folder name to fall back to the way a workspace does, so blank is the valid way back to the
generic fallback word, and main clears that server's stored entry rather than storing an empty string.
And the dialog carries a round-trip status (`idle` / `saving` / `failed`) the sibling has no use for,
because this write is a promise rather than a fire-and-forget outbound command: Save disables and
freezes the field while `saving`, and an `error` (or an unrecognised) answer renders one client-owned
line (`.edit-host__error`, "Could not save that name") and re-enables Save. **Cancel is never disabled,
in any status** — `ipcRenderer.invoke` carries no timeout, so a main side that never answers would
otherwise leave the dialog frozen with no exit.

**The write helper, `requestSetHostLabel`, tests the recognised arms positively.** `stored`/`not-stored`
map through `mapHostLabel` (the same mapper the reads use) to the value the container writes into
[the window store](host-label-window-store.md); anything else — `error`, a rogue arm, or a rejected
invoke — resolves `null`, meaning "keep the dialog open, write nothing." Written as a negative
`if (status === 'error')` instead, a future or malformed arm would fall through to the mapper, collapse
to `error`, and silently reset the row to the generic word; the positive form makes an unrecognised
answer degrade to the conservative outcome by shape rather than by a branch someone has to keep correct.
Unlike [`loadHostLabelFor`](host-label-window-store.md), this path does **not** write `error` into the
store on failure: a failed read genuinely means "unreadable, show the fallback," but a failed write
means the label is whatever it was before, and recording `error` would invent a state change out of a
refusal. The promise always resolves and the caught rejection is dropped unread, so nothing here can
surface as an unhandled rejection in React or log the label.

**The seed is a different collapse from the one the row displays.**
[`hostRowLabel`](channel-list-host-row.md#the-host-row-channellisttsx-added-by-710-the-operators-label-by-834)
turns every non-name outcome into the fallback word `'Server'`; seeding the field with it would invite the
user to Save that word as the machine's actual name. `hostRowEditSeed(value)` — exported for the same
unit-testability reason `hostRowLabel` is — answers "what is stored" instead: verbatim on `stored`
(including a blank or whitespace-only label, unslimmed — Save is what trims), empty on the other three
arms.

**Container state is three `useState` cells in `ChannelList`** (`editHostServerId`, `editHostName`,
`editHostStatus`), gated on `editHostServerId !== null` rather than truthiness — `isHostLabelServerRequest`
deliberately accepts the empty string as a server id, so a truthy gate would collapse a real machine's
dialog into "none open." The store write on a successful Save is keyed by the id captured in the render
closure before the `await`, never by anything the response carried — `HostLabelResult` names no server
at all, so keying off the response would let one machine's answer land on another machine's row.

**The renderer host-label store gained its second writer.** [Host-label window store](host-label-window-store.md)'s
`setHostLabelFor` used to have exactly one caller, the loader that fills every slot on mount; this
dialog's successful Save is the second, recording main's answer for one slot. The row still only reads,
and nothing feeds a rendered value back into the store — see that page's own note.

**A known gap, left open at merge (code review, non-blocking):** the container's three cells are not
scoped to the interaction that opened them. If a write is slow, the user Cancels and reopens the dialog
on a different machine before it resolves, the late resolution still lands on the *new* interaction's
state — closing a dialog the user just opened, or showing the failure line in a dialog that made no
write at all. The store write itself is unaffected (it is keyed correctly, per above); only the dialog's
own open/closed/failed state can drift. Flagged for the next touch of this surface rather than fixed
here.

**CSS.** `.edit-host*` is its own class family in `channels.css` — a reuse of `.edit-workspace*` or
`.rename-conversation*` would join those classes' Playwright strict-mode match sets and violate rather
than fail an assertion (`e2e/sidebar-workspace-edit.spec.ts`, `e2e/conversation-create-rename.spec.ts`).
Mirrors `.edit-workspace*` declaration for declaration minus the path line, plus a `.edit-host__error`
line on `.save-as-channel__error`'s recipe. **Since [#1300](https://github.com/pyrycode/pyrycode-desktop/issues/1300)
the panel also carries the `max-height: 90%` / `overflow-y: auto` pair `.edit-workspace` has always
had** — this ticket's own comment declined the pair on the premise that everything the panel renders is
client-owned copy or a label bounded at `MAX_HOST_LABEL_LENGTH` inside a single-line input, and #1300
falsified that premise by adding an unbounded relay URL (§ below). The comment was corrected in place
rather than left standing next to code that contradicted it.

**The identity block ([#1300](https://github.com/pyrycode/pyrycode-desktop/issues/1300)).** No Figma
node draws this dialog at all, so the block follows [`EditWorkspaceDialogView`](edit-workspace-dialog.md)'s
own `cwd` line instead: which machine this row actually is, under the field that renames it — the same
`{ serverId, relayUrl }` pair [Settings' Connection → Server row](server-info-channel.md) already shows.
Unlike that one-line precedent, two values need to be tellable apart, so each gets its own caption
(`Server ID`, `Relay`) — a `display: block` `<span>` caption immediately followed by the value as a
direct text child of the same `<p>` (`.edit-host__detail`), `overflow-wrap: anywhere` so a URL with no
space still wraps rather than growing the panel past its `max-width`.

`EditHostDialogView` takes one new prop, `server: ServerInfoValue | null`, rather than the two separate
strings the ticket's own Technical Notes suggested. [`serverInfoStore`](server-info-channel.md)'s state
docblock already rejects an unobservable pair of nullable fields as ceremony without benefit, and the
lookup miss (id present, relay absent) is not a state the container's lookup can ever produce — the
entry is found whole or not at all. One nullable object makes that impossible state unrepresentable
rather than merely untested; the substance (both values arrive as props, the view looks nothing up) is
unchanged. `ChannelList` does the lookup in the one place both halves are already in scope —
`servers.find((entry) => entry.serverId === editHostServerId) ?? null` — so nothing below the container
changes:
[`renderServerTrees`](channel-list-host-row.md#the-host-row-channellisttsx-added-by-710-the-operators-label-by-834)
only ever has the bare id to pass down.

On a miss (a reseed or an unpair while the dialog is open) both captions stay and the value slot renders
a client-owned `Unavailable` rather than an empty string or a closed dialog — a blank slot would be
indistinguishable from a value that failed to arrive, and closing would discard an in-progress rename
for a reason that has nothing to do with it. Both values are the same semi-trusted QR/paste-payload text
`pairedServerStore`'s own header calls the id untrusted, reaching this view only as an auto-escaped
React child — `HostRow`'s label already declines four sinks (no `title`, no `aria-label`, no derived
id/key/lookup path, no log line) and this block holds over all four unchanged, plus a fifth the relay
URL specifically needs: **displayed, never dialled** — no `new URL`, no `<a href>`, no `window.open` —
the one value here that invites the opposite instinct.

**Tests.** Unit: `EditHostDialog.test.tsx` (new) covers the chrome, the blank-enabled/round-trip
departures, the length bound measured on the trimmed name, and `requestSetHostLabel`'s three outcomes
against a spy. `ChannelList.test.tsx` extends to cover `hostRowEditSeed`'s four arms and that
`ChannelListView` threads `onEditHost` to every host row. [#1300](https://github.com/pyrycode/pyrycode-desktop/issues/1300)
extends both further: `EditHostDialog.test.tsx` gains the identity block's rendered-text coverage
(populated and per-caption, a long relay URL held whole — the `hostRowLabel` 128-character idiom, the
wrap is CSS and never a slice — and the `server: null` miss rendering `Unavailable` under both
captions), plus the sink guard riding `ChannelList.test.tsx`'s existing SENTINEL idiom rather than a new
one: a sentinel id and a sentinel relay each occurring exactly once, immediately after their own
caption's close. `ChannelList.test.tsx`'s sidebar-side sentinel test gained a line of its own: with the
dialog closed, which every static render is, neither value reaches the sidebar markup either. E2E, fake
tier: `e2e/sidebar-host-edit.spec.ts`
(new) drives Cancel, a blank Save (the clear), a reopen reading the field back empty, a rename visible
on both of one machine's rows while a second paired machine's rows stay untouched, and a Settings
round-trip remount proving the value reached main's at-rest store rather than only the renderer
singleton the Save wrote — a `reuseUserDataDir` relaunch cannot observe this criterion at all, since it
never reconnects, so `renderBody`'s first gate returns `null` and the sidebar draws nothing; recorded
under that spec's own `## Revisions` in
[the architecture spec](../../specs/architecture/1299-edit-host-dialog.md). `host-row-hover-controls.spec.ts`
is inverted rather than replaced — see [the host row's pen and plus on
hover](channel-list-host-row.md#the-rows-pen-and-plus-on-hover-1185). #1300 extends the same spec with the
two-machine identity check: machine A's dialog carries `FIRST_SERVER_ID` and its own relay URL read off
the fixture handle (`${servers[0].forwarder.url}/v1/client`, never a literal — the port is an ephemeral
loopback one), and machine B's pen opens a dialog carrying B's own pair, asserted by exact per-element
text rather than substring (`fake-daemon` is a prefix of `fake-daemon-2`, so a `toContainText` would
pass on the wrong row).

## Related

- [Channel List — the host row and its connection dots](channel-list-host-row.md) — the parent page:
  the row and pen this dialog opens from, `hostRowLabel`, and `renderServerTrees`.
- [Add workspace dialog](add-workspace-dialog.md) (#1308) — the host row's other trailing control's
  dialog, the closer relative to this one than its own Create-channel-dialog template, one level below
  the field: the three-arm status, the frozen field mid-flight, the client-owned failure line, and the
  never-disabled Cancel are all this dialog's shape, reused rather than rediscovered.
- [Edit workspace dialog](edit-workspace-dialog.md) (#1180) — the dialog described above clones, one
  level down: the same overlay/scrim/panel chrome and Name field.
- [Host-label store](host-label-store.md) (#1186) — the main-process keyed SET channel,
  `window.pyry.setHostLabelFor`, this dialog's Save writes through; reaches no daemon.
- [#1299 spec](../../specs/architecture/1299-edit-host-dialog.md) — this dialog's full design: the two
  departures from `EditWorkspaceDialogView`, the positive-arm write contract, and the reopen-while-saving
  gap recorded above.
- [#1300 spec](../../specs/architecture/1300-edit-host-dialog-server-id-and-relay.md) — the identity
  block's full design and security review: the one-nullable-object prop shape, the lookup-miss
  placeholder, the `max-height`/`overflow-y` correction, and why the relay URL is displayed but never
  dialled. Recorded above.
- [Server-info store](server-info-channel.md) — `ServerInfoValue`'s `{ serverId, relayUrl }` shape, the
  `serverInfo` handler's field allowlist, and Settings' Connection → Server row, the one other surface
  showing this same pair.
