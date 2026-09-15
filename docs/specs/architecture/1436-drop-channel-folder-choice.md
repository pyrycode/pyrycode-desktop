# 1436 — Create channel and Save as channel drop the folder choice

## Files read

- `src/renderer/src/screens/channels/ChannelForm.tsx` → `ChannelForm`, `channelsParent` — the shared
  fields; the radios and the parent helper both live here and both go.
- `src/renderer/src/screens/channels/CreateChannelDialog.tsx` → `CreateChannelDialogView`, `Pending`,
  `CreateChannelDialog` — the two-stage continuation whose `folder` stage is deleted.
- `src/renderer/src/screens/channels/SaveAsChannelDialog.tsx` → `SaveAsChannelDialogView`,
  `ChannelLocation`, `slugForChannel`, `requestPromoteConversation`, `requestCreateChannelFolder`,
  `SaveAsChannelDialog` — the deletions and the one sender that survives.
- `src/renderer/src/screens/channels/ChannelList.tsx` → the two mount sites — confirms no other
  consumer passes location props and that both dialogs are gated on a connected host at render time.
- `src/renderer/src/screens/conversation/CreateFolderDialog.tsx` → `requestCreateFolder` — the
  workspace picker's own `createWorkspaceFolder` sender; it never used `slugForChannel`, so the
  surviving sender loses nothing when the slug helper goes (see Security review).
- `src/renderer/src/store/conversationCreatedBridge.ts` → `requestNewChannel` — the create sender
  that stays, unchanged, now reached only from the direct branch.
- `src/renderer/src/store/newFolderStore.ts`, `src/renderer/src/store/newFolderBridge.ts` →
  `newFolderStore`, `subscribeNewFolder` — both stay for `CreateFolderDialog`; only Save as channel
  stops reading them.
- `src/renderer/src/screens/channels/channels.css` → `.create-channel__*` — the trap the ticket
  flags: `:focus-visible` and `:disabled` are shared selector lists, not a clean block delete.
- `docs/knowledge/features/create-channel-dialog.md`, `docs/knowledge/features/save-as-channel-dialog.md`
  — the choice tables and the two lessons that shape the test edits: a promoted row alone does not
  prove a payload (assert the request), and two `conversationStateFake` instances both mint
  `created-1`, so cross-host *navigation* assertions must not share a launch.

Codegraph is not initialised in this worktree (`codegraph_context` returned "CodeGraph not initialized
for this project"), so the reading list above came from grep plus the two package overviews.

## Design source

**Figma:** Create channel https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=487-2435 ·
Save as channel https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=487-2355

Both frames are the same dark modal on the shared `Modal` chrome: title left, round close control
right, a hairline divider, then a single column — the emphasised **Channel name:** label above a
filled, borderless, radius-xs input — and centered **Cancel** / **OK** at the foot. No radio rows
remain in either frame. Both also draw a **Channel system prompt:** label and text area between the
name field and the actions; that belongs to #1428 / #1429 and is deliberately **not** built here, so
the rendered modal is the name field followed by the actions.

## Context

`ChannelForm`'s dedicated branch creates `<workspace>/channels/<slug>/` and starts the channel there.
Neither this client nor the daemon has a workspace entity — a workspace *is* a conversation's `cwd`
as an exact string, which is what `groupByWorkspace` keys on — so a channel in that subfolder renders
as a brand-new workspace group named after the slug, under a host rather than under the workspace the
operator clicked. Juhana ruled on 2026-09-14 that the choice goes and both dialogs always use the
workspace folder itself, which is today's default branch. Channels already sitting in a dedicated
folder are left where they are.

This is a withdrawal of the #1351 / #1353 design, not a new one, so it warrants no ADR. The
documentation stage should record the withdrawal in the two package overviews (see Documentation
handoff).

## Design

Deletions, plus one state-machine simplification. No new exported symbol.

**`ChannelForm`** loses `location` / `onLocationChange` and both `<label className="create-channel__option">`
rows, and with them the `ChannelLocation` import. It keeps `name`, `busy`, `error`, `onNameChange`,
the name field and the error paragraph — so #1428 can add the system prompt text area below the name.
`channelsParent` is deleted from this module.

**`SaveAsChannelDialog.tsx`** deletes `ChannelLocation`, `slugForChannel` and
`requestCreateChannelFolder`. `requestPromoteConversation` is untouched, including its verbatim `cwd`
contract; only its doc comment loses the sentence about the dedicated branch's daemon-returned path.
`SaveAsChannelDialogView` drops `location`, `onLocationChange` and `roundTrip`, so its props become
`{ name, onNameChange, onCancel, onSave }`; it derives no busy flag and passes `busy={false}`
`error={null}` into `ChannelForm`. The container drops the `useNewFolderStore` read, the
`subscribeNewFolder` subscription, both `newFolderStore` effects (the created/rejected effect and the
reset-on-unmount effect) and the now-dead `pending` ref — nothing sets it once the folder arm is
gone, and the surviving arm has no in-flight window to guard. `onSave` becomes the scratch arm alone:
the connectivity + non-blank guard, `requestPromoteConversation(…, row.id, name, row.cwd)`, the
`sidebar-promotion` `sent` diagnostic, `onPromoted()`.

**`CreateChannelDialog.tsx`** narrows `Pending` to `{ type: 'idle' } | { type: 'channel' }`. `fail`
loses its `stage` parameter and always reports "Could not create that channel" under the
`channel-rejected` code; the `folder-requested` and `folder-rejected` codes go. The listener keeps
only the `channel` arm, so `workspaceFolderCreated` / `workspaceFolderRejected` become inert for this
draft. `createChannel` is folded into `onCreate` — one call site remains and `cwd` is in scope — which
also drops it from the effect's dependency list. The synchronous pending ref, the host-stamp check and
the disconnect abandonment stand exactly as they are.

**`channels.css`** deletes `.create-channel__option`, `.create-channel__option span`,
`.create-channel__option input` and `.create-channel__option input:checked` outright, and **trims**
rather than deletes the two shared selector lists, leaving `.create-channel__input:focus-visible`
and `.create-channel__input:disabled` standing. Losing either would silently strip the name field's
focus ring or its disabled dimming, which AC1 and AC4 both pin.

## State and concurrency model

Create channel keeps one local state machine (`idle` → `channel` → dismissed or errored) held in a
ref written synchronously before dispatch, so a second click before React paints the disabled OK
cannot re-enter. Its daemon-event subscription and its `sessionStore` subscription are still torn
down by the single `cleanup` callback, returned from the effect and also called by `dismiss`.

Save as channel keeps its `sessionStore` subscription and `abandoned` ref: a non-connected transition
marks the draft abandoned and emits the `abandoned` diagnostic, and `onSave` re-checks connectivity
through `isHostConnected` before dispatching. It now owns no async continuation at all — the promote
is fire-and-forget and the dialog closes on dispatch, as the scratch branch does today. No shared
singleton store is touched, so no reset-on-unmount is needed.

`newFolderStore` and `newFolderBridge` keep their single remaining owner, `CreateFolderDialog`.

## Error handling

Create channel: a `conversationCreateRejected` for the retained host, or a throw from `sendCommand`,
shows the client-owned "Could not create that channel" with `role="alert"`, clears busy and permits
an explicit retry. There is no folder error path left to surface.

Save as channel: unchanged from today's scratch branch — promotion closes on dispatch with no
correlated rejection, so the dialog renders no error line. `ChannelForm` keeps its error paragraph for
Create channel's use.

Diagnostics stay content-free static codes: `channel-create-state` gains nothing and loses
`folder-requested` / `folder-rejected`; `sidebar-promotion` keeps `sent` and `abandoned` and loses
`folder-requested` / `folder-rejected`.

## Testing strategy

Static (vitest, `renderToStaticMarkup`):

- `CreateChannelDialog.test.tsx` — drop the `slugForChannel` import and its conversion case, drop the
  location props and both radio assertions, and reduce the frozen-controls count from three disabled
  inputs to one. Keep the modal-chrome, blank-name, escaping and error-alert cases.
- `SaveAsChannelDialog.test.tsx` — drop the `slugForChannel` and `requestCreateChannelFolder`
  describes, the `NewFolderRoundTrip` import, and every radio / round-trip case (both-checked,
  scratch-default, in-flight freeze, rejected error line, no-error-for-idle). Keep the modal chrome,
  the prefilled and escaped name, the blank/whitespace validation and the `requestPromoteConversation`
  payload proof. Add one assertion that the rendered form carries no `type="radio"`, so the removal
  itself has a guard.

Interaction (Playwright, fake transport):

- `e2e/sidebar-create-channel.spec.ts` — the shared `open()` helper drops its checked-radio wait. The
  direct test keeps its rejection/retry/navigation arc minus the radio-disabled assertions, and
  inherits from the deleted dedicated test the guards worth keeping: an injected
  `workspaceFolderCreated` is inert, and foreign- or absent-stamped `conversationCreated` /
  `conversationCreateRejected` do not advance the draft. The dedicated test is deleted; the host-1
  routing claim it carried moves into the two-host test as a request-only assertion (no reply
  released), which keeps it clear of the `created-1` collision trap the overview warns about. The
  dismissal/disconnect test keeps both close controls and the disconnect leg with the radio checks and
  folder replies removed.
- `e2e/save-as-channel-promote.spec.ts` — the direct test stands minus the radio wait, and gains a
  short tail promoting the second host's row so cross-host promote routing survives the deletion of
  the dedicated test. The dedicated test is deleted. The dismissal test loses its pending halves
  (there is no pending state left) and keeps idle dismissal plus the `Untitled` reopening default.
- `e2e/sidebar-offline-mutations.spec.ts` — the keyboard-after-disconnect test is untouched. The
  folder-completion test keeps only its first leg (a pre-opened save dialog cannot promote by keyboard
  after disconnection) and is renamed for it. The batched disconnect/reconnect test is deleted: its
  subject was a pending promotion that no longer exists. The sidebar-ownership test keeps its scratch
  promotion and drops the dedicated leg.
- `e2e/real-daemon-promote.spec.ts` — delete the `Use shared scratch folder` radio check, rewrite the
  SCOPE comment for the single branch that remains, and replace the stale `SaveAsChannelDialog.tsx`
  line range with the `onSave` symbol. Real tier only; it does not run in this gate.

Gate: `npm test` on the touched files, `npm run build`, and `npx playwright test` on the four fake
specs above.

## Open questions

- Does `SaveAsChannelDialog` still need its `abandoned` ref once no async continuation survives?
  Resolved during implementation, recorded in Revisions if the answer changes the design. The ticket
  says keep it, and it still guards the synchronous disconnect-then-Enter window that
  `sidebar-offline-mutations` pins.

## Documentation handoff

Pending — owned by the documentation stage, not by this PR.

- Rewrite the choice tables out of `docs/knowledge/features/create-channel-dialog.md` and
  `docs/knowledge/features/save-as-channel-dialog.md`.
- Note in both that the workspace-relative folder choice from #1351 and #1353 was withdrawn on
  2026-09-14 because neither client nor daemon has a workspace concept beyond a conversation's `cwd`.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and the boundary narrows. Both surviving senders push a
  daemon-reported `cwd` verbatim across `contextBridge` into an outbound command — `requestNewChannel`
  the clicked workspace row's, `requestPromoteConversation` the chat row's. Neither value is
  client-templated, neither is resolved or rendered by the renderer, and the daemon is authoritative
  over paths it reported itself. What goes away is a *consumer* of daemon input: after this ticket
  neither dialog reads `workspaceFolderCreated.path` and feeds it into a second outbound command, so
  one daemon-steered path no longer crosses back out. The client-templated `channelsParent(cwd)`
  string disappears with it, which is the #288 lesson (a client-reconstructed path is EvalSymlinks-
  rejected daemon-side) landing as a deletion.
- **[Trust boundaries / path sanitisation]** No findings — the ticket's named risk does not
  materialise. `slugForChannel` was the only client-side path-element sanitiser, but it sanitised
  exactly one thing: the `name` element of a `createWorkspaceFolder` payload. Both of its call sites
  (`CreateChannelDialog`'s dedicated arm and `requestCreateChannelFolder`) are deleted by this ticket,
  so no surviving sender is left un-sanitised — the sanitiser and its only consumers go together. The
  one `createWorkspaceFolder` sender that remains in the renderer is `CreateFolderDialog`'s
  `requestCreateFolder`, which never called `slugForChannel`: it sends an operator-typed `parent` and
  `name.trim()`, unchanged by this ticket, with the daemon authoritative on confinement. Verified by
  reading that module, not inferred.
- **[Tokens, secrets, credentials]** No findings — neither dialog reads, writes or transports a
  credential; nothing here touches `safeStorage`, disk or web storage.
- **[File / storage operations]** No findings — the renderer performs no filesystem operation in
  either flow. The only path construction in the diff is `channelsParent`, and it is being deleted.
- **[Electron / IPC attack surface]** No findings — no `contextBridge` API, `ipcMain` channel or
  `webPreferences` value changes. `createWorkspaceFolder` stays in `src/shared/ipc/commands.ts`
  because `CreateFolderDialog` still sends it; this ticket removes senders, not the command type, so
  no main-process handler is orphaned and no validation is bypassed.
- **[Cryptographic primitives]** Not applicable — no key, nonce, RNG or handshake code is in the
  blast radius; the Noise session is main-process and untouched.
- **[Network & I/O]** No findings — no transport, socket, timeout or frame-size behaviour changes.
  Channel creation now costs one outbound command instead of two.
- **[Error messages, logs, telemetry]** No findings, with one thing to hold in Phase B: the reshaped
  `fail` in `CreateChannelDialog` must keep emitting a static code only. Both surviving user-facing
  strings ("Could not create that channel", and no error line at all in Save as channel) are
  client-owned literals carrying no daemon text; `channel-create-state` and `sidebar-promotion`
  diagnostics keep only static lifecycle codes and lose two of them. No name, path or payload enters
  a diagnostic.
- **[Concurrency]** No findings — no regression, and one subscription fewer. Deleting
  `SaveAsChannelDialog`'s `pending` ref removes a guard that the surviving arm never armed: the
  scratch arm dispatches and unmounts without ever setting it, so a synchronous double-activation
  could already send two `promoteConversation` commands today. That is pre-existing behaviour on the
  branch that survives, not something this ticket introduces, and the daemon's promote is idempotent
  (#949 Option B flips `is_promoted` + `name`), so it is deliberately left alone rather than fixed
  in-scope. Dropping the `subscribeNewFolder` subscription and the `newFolderStore` reset effect
  cannot strand the singleton for its remaining owner: verified that `CreateFolderDialog` mounts its
  own `NewFolderData` bridge and owns its own reset-on-unmount, and that Save as channel will no
  longer dispatch to that store at all. The `sessionStore` subscription and its effect cleanup stand
  unchanged.
- **[Threat model alignment]** Hostile or compromised daemon — strictly improved: a crafted
  `workspace_folder_created` reply could previously steer the `cwd` of a subsequent create or promote
  issued by these dialogs, and after this ticket those replies are inert for both drafts. Renderer
  compromise reaching the transport — unchanged; nothing moves toward the renderer. Token theft from
  disk and malicious-relay handling are out of scope for a renderer-only deletion and owned by the
  transport package.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15

## Revisions

_None yet._
