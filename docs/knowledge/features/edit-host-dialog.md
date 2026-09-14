# Edit host dialog

Split out of [Channel List — the host row and its connection
dots](channel-list-host-row.md) to keep that page under the doc-guard's 50000-byte cap
(`npm run check:docs`). The dialog opened by the [host row's hover
pen](channel-list-host-row.md#the-rows-pen-and-plus-on-hover-1185).

[`EditHostDialogView`](../../../src/renderer/src/screens/channels/EditHostDialog.tsx)
opens from the host row's pen in either sidebar tree. It uses the shared
[Modal](modal-presentation.md) at 646px, following the
[Edit host design](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=487-2047)
and [shared Modal design](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=489-1942).
Server identity and Relay address appear above the filled Host name field.
The divided header includes Close dialog; the centred footer contains outlined
Cancel and filled OK actions.

The data and save contract remains the one introduced in #1299. OK writes the
trimmed name through `window.pyry.setHostLabelFor` to the background process's local
store. It sends no daemon command and changes only the selected host. A blank name
clears its custom label, restoring the generic Server label. The trimmed name must
not exceed `MAX_HOST_LABEL_LENGTH`.

The input and OK are disabled during an outstanding save. A failed or unrecognised
answer keeps the dialog open, displays “Could not save that name” and enables retry.
Cancel and Close dialog both invoke the same dismissal callback and stay enabled
even while saving, since the pending request has no timeout. Dismissal initiates no
new save; it does not cancel a save already sent. Opening does not autofocus the
field, and Escape and backdrop clicks retain their existing inert behaviour.
`Modal` supplies the accessible title association and native keyboard controls.

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
user to save that word as the machine's actual name. `hostRowEditSeed(value)` — exported for the same
unit-testability reason `hostRowLabel` is — answers "what is stored" instead: verbatim on `stored`
(including a blank or whitespace-only label, unslimmed — OK is what trims), empty on the other three
arms.

**Container state is three `useState` cells in `ChannelList`** (`editHostServerId`, `editHostName`,
`editHostStatus`), gated on `editHostServerId !== null` rather than truthiness — `isHostLabelServerRequest`
deliberately accepts the empty string as a server id, so a truthy gate would collapse a real machine's
dialog into "none open." The store write on a successful save is keyed by the id captured in the render
closure before the `await`, never by anything the response carried — `HostLabelResult` names no server
at all, so keying off the response would let one machine's answer land on another machine's row.

**The renderer host-label store gained its second writer.** [Host-label window store](host-label-window-store.md)'s
`setHostLabelFor` used to have exactly one caller, the loader that fills every slot on mount; this
dialog's successful save is the second, recording main's answer for one slot. The row still only reads,
and nothing feeds a rendered value back into the store — see that page's own note.

**A known gap, left open at merge (code review, non-blocking):** the container's three cells are not
scoped to the interaction that opened them. If a write is slow, the user Cancels and reopens the dialog
on a different machine before it resolves, the late resolution still lands on the *new* interaction's
state — closing a dialog the user just opened, or showing the failure line in a dialog that made no
write at all. The store write itself is unaffected (it is keyed correctly, per above); only the dialog's
own open/closed/failed state can drift. Flagged for the next touch of this surface rather than fixed
here.

**The Unpair host button ([#1422](https://github.com/pyrycode/pyrycode-desktop/issues/1422)) widens
`editHostStatus`'s type rather than adding a sibling cell.** `EditHostSaveStatus` was renamed
`EditHostStatus` and gained three arms — `confirming-unpair`, `unpairing`, `unpair-failed` — beside the
rename round trip's `idle`/`saving`/`failed`. One union rather than two cells makes "saving and unpairing
are never both true" unrepresentable rather than merely maintained by a reset; the traded-off
consequence is that arming the confirm after a failed rename drops the rename's own failure line, since
the cell holds only one arm at a time. `UnpairSlot`, a non-exported inline component in
`EditHostDialog.tsx` mirroring the Settings row's `UnpairAction` posture without importing its component
or its CSS, renders the idle **Unpair host** button below the Host name field and above the footer,
matching [Figma node 487-2078](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=487-2078). A
click arms `confirming-unpair`, replacing the button with a prompt and two answers in the same slot.
Confirming calls `runEditHostUnpair` (exported beside `requestSetHostLabel`), which maps
[`runUnpairServer`](unpair-channel.md#the-three-renderer-callers)'s `'ok' | 'error'` onto this dialog's
own two cells — close-on-success, `unpair-failed` on failure — without re-implementing the erase →
refresh → route-or-clear sequence that helper owns. See [Unpair channel § The three renderer
callers](unpair-channel.md#the-three-renderer-callers) for the container-side deps this dialog builds and
why its `navigateToList` cannot be the Settings row's no-op.

**A widened union making the *cell* exclusive did not, by itself, make the two *round trips* exclusive**,
and closing that gap took a rework leg (verifier MUST FIX on the first review pass, closed in `d683045`).
Arming the confirm while a rename save was outstanding re-enabled the Host name field and OK mid-invoke,
permitting a second write; from there the unpair's own resolution could land on a cell the save's own
unguarded resolution had since overwritten, silently dropping AC4's unpair failure line. The fix is
`disabled={status === 'saving'}` on the idle Unpair host button — a rename in flight now admits no arm at
all — plus making the save arrow's failure write a functional updater
(`prev === 'saving' ? 'failed' : prev`), so a save can only ever report against its own flight. This
guards the `'unpairing'` arm this ticket created; it is narrower than the pre-existing #1299 window (a
save resolution landing on a *reopened save*), which remains open and out of scope.

**Both outcome arms in `runEditHostUnpair`'s container-side callbacks are functional updaters, not plain
writes**, because the footer Cancel stays enabled through the whole erase (`ipcRenderer.invoke` has no
timeout) — an operator can dismiss the dialog mid-erase and reopen it against a *different* host before
the late answer lands. `close: () => setEditHostServerId(prev => prev === serverId ? null : prev)` and
the `'unpairing'`-guarded status write both no-op once `prev` no longer names the flight that launched
them; the erase itself is unaffected either way, since it is keyed by the id captured in the render
closure before the `await`. A narrower residual remains open, noted but not fixed: two hosts' dialogs
opened and confirmed in sequence, where the first's late answer lands while the second's erase is *also*
`'unpairing'`, can still write the second dialog's message. Severity stays "misleading message, never a
wrong erase" throughout.

**The destructive Confirm answer carries the error role.** `.edit-host__unpair--confirm` in
`channels.css` moves both border and text to `--color-error`, plus the focus ring — the second rework
MUST FIX. The class was applied in the first pass and pinned by a test with no CSS rule behind it, so
Confirm rendered byte-identical to the Cancel beside it; only a rendered capture, not a class-name
assertion, proved the stylesheet rule existed once it was added. The precedent is
`.settings__server-unpair--confirm`, adapted because this recipe is an outlined button where the Settings
row's is text-only — recolouring text alone would have left a primary-coloured frame around an
error-coloured word.

**Copy** lives in `UNPAIR_HOST_COPY`, `UNPAIR_COPY`'s idiom one surface over: client-owned,
apostrophe-free, naming neither the label nor the server id, with *host* rather than *server* as this
surface's own vocabulary. The failure line `Could not unpair this host` is a second constant beside
`EDIT_HOST_ERROR_COPY`, rendered in the same message slot on a mutually exclusive arm.

**Open, left for the next touch of this slot:** arming and disarming the confirm drops keyboard focus to
`<body>`, since the focused button leaves the DOM — inherited from the Settings row rather than a
regression, and left alone to keep the two slots' behaviour identical. The slot's Cancel and the footer's
Cancel share the same accessible name (both plain "Cancel", told apart only by class), and a host-free
`aria-label` would disambiguate for screen readers, at the cost of two tests that currently assert the
dialog's complete `aria-label` list contains no host content.

**Tests.** `EditHostDialog.test.tsx` covers all three unpair arms as static markup (the idle button, the
confirming prompt-plus-answers, the in-flight disabled answers, and `unpair-failed`'s idle-button-plus-
failure-line), the idle verb's disable during `'saving'`, and `runEditHostUnpair`'s three outcomes with
plain spies. `e2e/sidebar-host-edit.spec.ts` adds a non-destructive arm/disarm/reopen drive — the
click-does-not-unpair half of AC2 cannot be told apart from a working erase by any static render, so this
is genuinely the only tier that can prove it — and two existing Tab-sequence assertions were corrected
for the new control's position in the dialog's tab order.

**CSS.** The caller retains `.edit-host-overlay` and its scrim in `channels.css`.
`Modal` owns the panel, title, close control, actions and whole-panel scrolling.
The 646px preferred width fits the 800px minimum app window. A short window scrolls
all content, including the header and footer, without pinning either section.
The removed private panel and action classes must not be used as test selectors;
locate the accessible Edit host dialog and its named controls.

The `.edit-host*` body classes remain separate from the workspace and conversation
dialogs. Sharing those names would join existing Playwright locator matches.
The filled field uses the on-primary colour at 41% opacity, 16px vertical padding
and the existing input focus outline. Captions use the label-large emphasized
weight token, 600. Values use body-medium text. The two rows have a 12px gap.

**The identity block.** Each inline caption is followed by its value span:
`Server identity:` and `Relay address:`. A value can shrink and uses
`overflow-wrap: anywhere`, so long unbroken values remain whole without widening
the panel. Identity data is read-only text above the editable field, never a link.

`EditHostDialogView` receives `server: ServerInfoValue | null`, rather than the two separate
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

**Tests.** `EditHostDialog.test.tsx` checks the shared presentation and accessible
title, controlled name, blank clearing, trimmed length bound, saving/error states,
missing and hostile identity data, and `requestSetHostLabel` result mapping.
Only the fixed Close dialog name may appear in an `aria-label`; host data must not
reach metadata or navigation. The shared decorative image is permitted explicitly.
`ChannelList.test.tsx` retains the seed and per-row callback coverage.

`e2e/sidebar-host-edit.spec.ts` drives both sidebar trees, real local save and
clear operations, trimming, selected-host isolation and a Settings round-trip
remount. The remount reloads the value from the background process's store rather
than merely rereading the renderer singleton. A disconnected relaunch cannot
observe sidebar labels, so at-rest survival across process death remains the
responsibility of `hostLabelStore.test.ts`.

Held-save scenarios prove that both exits remain available while input and OK are
disabled. Failure can retry through the real persistence handler. Keyboard checks
cover opening, dismissal and scrolling to the field, footer and header in a short
window. Synthetic long identity and relay values prove wrapping and horizontal
containment at minimum width. `sidebar-host-row-control-name-pill.spec.ts` also
uses the accessible dialog locator after activating the pen.

The built-app close-image regression requires `naturalWidth` 28. The first
adoption exposed an SVG embedded as a data URL that the renderer policy blocked,
even though static markup and close clicks passed. The
[shared asset-delivery setting](modal-presentation.md#close-asset-delivery) keeps
the exact SVG as a local file. The regression remains enabled. Isolated visual
captures cannot substitute for this check against the built app's security policy.

## Related

- [Reusable modal presentation](modal-presentation.md) — shared panel and action contract;
  adopted in [#1348](https://github.com/pyrycode/pyrycode-desktop/issues/1348).
- [Channel List — the host row and its connection dots](channel-list-host-row.md) — the parent page:
  the row and pen this dialog opens from, `hostRowLabel`, and `renderServerTrees`.
- [Add workspace dialog](add-workspace-dialog.md) (#1308) — the host row's other trailing control's
  dialog, the closer relative to this one than its own Create-channel-dialog template, one level below
  the field: the three-arm status, the frozen field mid-flight, the client-owned failure line, and the
  never-disabled Cancel are all this dialog's shape, reused rather than rediscovered.
- [Edit workspace dialog](edit-workspace-dialog.md) — the sibling editor for workspace labels.
- [Host-label store](host-label-store.md) (#1186) — the main-process keyed SET channel,
  `window.pyry.setHostLabelFor`, which this dialog uses to save locally.
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
- [Unpair channel](unpair-channel.md) — `runUnpairServer`, the decision helper `runEditHostUnpair` calls
  rather than re-implementing, and [§ The three renderer callers](unpair-channel.md#the-three-renderer-callers)
  for how this dialog's deps compare to the Settings row's and the composer's.
