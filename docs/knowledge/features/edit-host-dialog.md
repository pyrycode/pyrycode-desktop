# Edit host dialog

The host row's pen in either sidebar tree opens
[`EditHostDialog`](../../../src/renderer/src/screens/channels/EditHostDialog.tsx),
a dialog-local controller around the pure `EditHostDialogView`. The shared
[Modal](modal-presentation.md) supplies the panel, title, close control and footer.

## What it does

The dark 640px modal shows read-only Server identity and Relay address, followed
by Host name and a labelled Host system prompt textarea. The design covers
[empty](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=778-10211),
[filled](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=778-10265)
and [default](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=780-10336)
states. The exact helper is:

> Added to every conversation on this host, before the channel system prompt. A change takes effect from each conversation's next session.

Each opening subscribes before sending one `requestHostSystemPrompt` command for
the selected host. A matching successful read seeds original, draft and default
verbatim, including an explicitly empty current string. Until then the textarea
is disabled and Reset is absent. A failed read displays fixed copy, “Could not
read the host system prompt”, while name editing and dismissal remain available.
There is no automatic retry; reopening reads afresh.

After a read, Reset to default appears exactly when `draft !== defaultText`.
It sits to the right of the helper, uses the outlined Unpair host treatment and
occupies a separate slot from unpair. Reset changes only the draft and hides itself
at exact equality. No trimming or normalization applies to either prompt string.
Cancel and Close discard unsent changes, including resets.

OK first awaits the existing local name persistence. A successfully read prompt
writes only if its draft differs from the original. Whitespace is preserved and
`system_prompt: ""` clears the host setting; null is invalid. An unchanged or
unread prompt sends no write. A changed prompt closes only on its matching durable
`hostSystemPromptReceived` write reply. Rejection retains the draft, displays
“Could not save the host system prompt” and enables an explicit OK retry.
A name already saved locally remains saved when a subsequent prompt write fails.
The daemon owns composition order and next-session application.

The inclusive prompt bound is `MAX_SYSTEM_PROMPT_BYTES` (8192 UTF-8 bytes).
Exactly that many bytes are allowed; more displays the fixed byte-limit notice
and disables OK before either save. Main independently refuses oversized writes.
Character count is insufficient: 4096 `é` characters fit, 4097 do not.

A synchronous controller lock spans local name persistence and the durable prompt
wait, disabling name/prompt edits, OK, Reset and unpair. Cancel and Close remain
available. Dismissal cannot retract a write already sent, but its outcome cannot
alter a reopened interaction. Selected-host connection loss/replacement ends a
pending wait without claiming success, retains any ready draft with save failure,
and prevents a late name completion from launching the old prompt write.

Opening does not autofocus the name. Escape and backdrop clicks remain inert.
`Modal` supplies accessible title association and native keyboard controls.

## Local name persistence

`ChannelList` keeps `editHostServerId`, `editHostName` and `editHostStatus`, mounting
a newly keyed dialog for every interaction. `hostRowEditSeed` returns a stored
label verbatim and empty for every other store arm. Seeding from `hostRowLabel`
instead would invite saving the displayed fallback word `Server` as a real name.

`requestSetHostLabel` trims the name and invokes `window.pyry.setHostLabelFor` for
the captured host. A blank name clears the custom label, restoring `Server`;
the trimmed name must not exceed `MAX_HOST_LABEL_LENGTH`. Only `stored` and
`not-stored` results map to a value for the [window store](host-label-window-store.md).
Error, unknown arms and rejected invokes resolve null, keep the previous value
and leave the dialog open with “Could not save that name”. A negative check for
only the error arm would let an unknown result collapse to a fallback store write.
The caught object is dropped unread and no label is logged.

The local store update stays keyed by the captured server id even after dismissal.
Modal status and close callbacks additionally require both the current interaction
and operation identities. Arming/cancelling/confirming unpair or starting another
name save supersedes the operation. An interaction check alone would allow a
name completion after disconnect to overwrite `unpairing` and release the controls
while erase was still outstanding. Valid local name results can still update the
store; they cannot change a newer operation or reopened dialog.

## Prompt controller lifetime

[`createHostPromptController`](../../../src/renderer/src/store/hostPromptController.ts)
owns an ephemeral Zustand store: reading, read-failed, ready, saving-name or
saving-prompt. It has no global cache, persistence or devtools middleware. Replies
must match host, operation and request id. Once the read settles, duplicate replies
cannot overwrite a draft. Disposal removes both event/session subscriptions and
invalidates late outcomes and save continuations.

The effect schedules opening in a cancellable microtask after subscribing.
Development StrictMode setup/cleanup/setup cancels the first setup before it sends
anything, preserving one read per actual opening. A keyed reopening constructs a
fresh controller. Opening directly in each effect setup would send twice even if
production browser coverage passed.

The session subscription compares this host's current and previous status records
before cancelling on a changed non-connected record. The session reducer preserves
untouched host records by reference. Checking only whether this host is disconnected
would treat another host's message/status update as a new loss, unlock an already
disconnected name save and suppress its successful close. A read arriving during
local name persistence updates the saved previous prompt state, so a failed name
write restores that valid read instead of losing it.

## Unpair and identity

The separate Unpair host button arms a confirmation in its own slot. Confirm
calls `runEditHostUnpair`, which wraps the shared
[`runUnpairServer`](unpair-channel.md#the-three-renderer-callers) erase → refresh →
route-or-clear flow. The `EditHostStatus` union makes rename/unpair statuses
exclusive; the controller lock and guarded callbacks make their outstanding
operations exclusive too. Success closes, failure restores the idle button with
“Could not unpair this host”. Confirm border, text and focus ring use
`--color-error`. A CSS class assertion alone once missed an absent stylesheet rule;
rendered evidence is needed for that treatment.

Unpair confirmation still drops focus to body when the focused button leaves the
DOM. Its Cancel and the footer Cancel have the same accessible name; browser tests
distinguish the footer by its action class. These focus/name limitations remain.

The view receives one nullable `ServerInfoValue`, looked up by the selected id in
`ChannelList`. An atomic miss displays fixed `Unavailable` for both identity
values without discarding a rename. Two nullable strings would introduce a
partial state the lookup cannot produce. Identity values render only as escaped
React text and wrap anywhere; the relay address is displayed, never dialled or
turned into a link. Prompt/default text likewise stays inert controlled text,
never logs, raw markup, URLs, filenames or lookup paths.

## CSS

`channels.css` owns `.edit-host-overlay` and its scrim; `Modal` owns whole-panel
scrolling. The 640px preferred width fits the app's 800px minimum width. Short
windows scroll header, body and footer together, keeping every control reachable.
Use the accessible dialog and named controls in tests; removed private panel/action
selectors are obsolete. Body classes remain separate from workspace/conversation
dialogs to avoid joining existing locator matches.

Filled name and prompt fields use on-primary at 41% opacity, 16px padding, 6px
corners and the primary focus outline. Captions use emphasized label-large and
values body-medium. The textarea uses `field-sizing: content`, grows from four
lines to a fourteen-line cap for long defaults and retains native scrolling and
vertical resizing. The helper uses `--color-on-surface-variant` and
`--text-body-small-size` with the corresponding line, tracking and weight tokens.
Its flex row permits helper wrapping while Reset remains right-aligned with
`margin-left: auto`. Identity value spans can shrink and wrap unbroken text without
widening the panel.

## Tests

- `EditHostDialog.test.tsx` checks static markup: title/identity escaping,
  controlled name, helper/textarea, read gates, reset equality, byte-limit notice,
  busy/error/unpair states and local name-result mapping. Static renders cannot
  prove effects, keyboard input or CSS layout.
- `hostPromptController.test.ts` checks host/request/operation isolation, duplicate
  read suppression, empty clearing, verbatim reset, save lock, durable retry,
  disconnect/disposal and reads during a failing name save.
- `hostSystemPrompt.test.ts` and `daemonConnection.test.ts` check IPC/reply
  validation, stripped extras, separate read/write ownership, deadlines, local
  refusal and inclusive multibyte bounds. `hostPromptEventConsumers.test.ts`
  checks safe ignores in exhaustive renderer translators.
- `e2e/host-system-prompt.spec.ts` drives the encrypted mounted app: selected-host
  read/save, whitespace and empty clearing, reset/cancel, failed read/write,
  reopen, stale/duplicate/wrong-host replies, byte bounds and disconnect.
  Its development-React case proves one read per StrictMode opening and prompt/
  reset keyboard reachability at 800×240. Held-name success/failure cases preserve
  an outstanding unpair; a terminally disconnected host's held name save stays
  locked through another host's message and status update, then closes successfully
  with no prompt write.
- `e2e/sidebar-host-edit.spec.ts` retains both-tree rename/clear, selected-host
  isolation, retry, dismissal during save and Settings remount persistence. It
  checks 640px width, prompt/reset tab order, long identity wrapping and short-window
  scrolling. At-rest survival across process death belongs to `hostLabelStore.test.ts`.
  The built-app close-image test requires `naturalWidth` 28; isolated captures
  cannot prove the [asset delivery policy](modal-presentation.md#close-asset-delivery).

The [final verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1787#issuecomment-6024523660)
confirms all five host prompt and six sidebar tests were present and passed in the
2026-10-06 gate at `1082bcffb6524c1f507da08ef9e8e250c40125ef`: 301 executed,
301 passed, 0 failed, 4 skipped overall; each of these groups had 0 failed and
0 skipped. See [verification evidence and capture guidance](development-verification-test-tiers.md#host-prompt-verification)
for the named cases and visual comparison. No live Claude turn is required.

## Related

- [Host row and controls](channel-list-host-row.md) — selected-host pen and label.
- [Host-label store](host-label-store.md) — local keyed persistence channel.
- [Server-info channel](server-info-channel.md) — identity display contract.
- [Edit channel dialog](edit-channel-dialog.md) — channel prompt presentation.
- [Host prompt correlation](daemon-connection-correlation-system-prompt-and-mcp.md#host-system-prompt-readwrite-correlation)
  and [protocol contract](inbound-message-decode-payloads.md#daemon-wide-host-system-prompt).
- [Unpair channel](unpair-channel.md) — shared erase effects.
- [Host prompt plan](../../specs/architecture/1738-host-system-prompt.md) — design and security review.
