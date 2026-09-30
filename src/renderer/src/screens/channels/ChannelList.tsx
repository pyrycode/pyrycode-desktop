import './channels.css'
import {
  Children,
  Fragment,
  useEffect,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactNode
} from 'react'
import type { ConversationSummary } from '@shared/wire/types'
import {
  useConversationListStore,
  selectConversations
} from '../../store/conversationListStore'
import { useSessionStore, sessionStore, selectStatusFor, type SessionState, type ConnectionStatus } from '../../store/sessionStore'
// #834's read path, shipped dormant by #833 and mounted here, re-keyed by server id in #1199.
// `HostLabelData` is the headless one-shot invoke; the store binding + keyed selector feed the row.
// Nothing else in this file touches either.
// #1299 gave this file the store's SECOND writer: the Edit host dialog records main's answer through the
// singleton's own action, beside the loader that fills it on mount. The row still only reads.
import {
  useHostLabelStore,
  selectHostLabelFor,
  hostLabelStore,
  type HostLabelValue
} from '../../store/hostLabelStore'
import { HostLabelData } from '../../store/hostLabelLoader'
// #1199: the paired-server list is what tells the row WHICH machine it names, and it is the list #1070
// then iterates to draw one row per server. `ServerInfoData` is the shipped one-shot that fills it,
// mounted here beside `HostLabelData` — the Settings idiom applied to the screen that draws the row.
import { useServerInfoStore, selectServers, serverInfoStore } from '../../store/serverInfoStore'
import { ServerInfoData, loadServerInfo } from '../../store/serverInfoLoader'
// #801's three per-row reads, #874's fourth, and the two pure modules that reduce them. All six are
// consumed EXACTLY as shipped: none takes a `conversationId` except the four selector FACTORIES, which is
// what keeps the untrusted daemon-asserted id a `Map` key and nothing else (conversationStatus.ts:26-33,
// conversationUnread.ts:28-34, modalPrompts.ts:21-25).
import {
  useConversationActivityStore,
  selectActivityFor
} from '../../store/conversationActivityStore'
import {
  useConversationTimelineStore,
  selectTimelineFor
} from '../../store/conversationTimelineStore'
import {
  useConversationLastReadStore,
  selectLastReadFor
} from '../../store/conversationLastReadStore'
// From `modalStore`, not from `modalPrompts`: the selector is defined on the pure reducer module and
// RE-EXPORTED at modalStore.ts:45 precisely so consumers take the read surface from one site
// (PermissionModal.tsx:192-194 is the shipped precedent).
import { useModalStore, selectHasOutstandingFor } from '../../store/modalStore'
import { useQuestionBatchStore, selectBatchFor } from '../../store/questionBatchStore'
// #1098's whole read: which chat the pane is showing. The store has held it since #278 and the sidebar
// simply did not read it — no new store, no IPC, no wire type.
import { useActiveConversationStore } from '../../store/activeConversationStore'
import { resolveConversationStatus } from '../../store/conversationStatus'
import { isConversationUnread } from '../../store/conversationUnread'
import { requestArchiveConversation } from '../conversation/ConversationScreen'
import { SaveAsChannelDialog } from './SaveAsChannelDialog'
// #1440 renamed this module for its new title. `requestRenameConversation` KEEPS its name: it owns the
// `renameConversation` wire literal, and renaming the helper would drift it from the verb it sends.
import { EditChatDialogView, requestRenameConversation } from './EditChatDialog'
// #1476 — the Channels tree's own modal. `requestRenameConversation` stays imported from the module
// above and is reused verbatim by both: it owns the `renameConversation` literal, reads only `.id` and
// already trims, so the retitle costs no second command constructor and no second wire path.
import { EditChannelDialog } from './EditChannelDialog'
import { CreateChannelDialog } from './CreateChannelDialog'
import { CreateChatDialog } from './CreateChatDialog'
// #1180 — the view and its send helper travel together, unlike #1179's split: this verb has exactly
// one sender and no shipped twin to sit beside, which is `EditChatDialog`'s shape.
import {
  EditWorkspaceDialogView,
  requestArchiveWorkspace,
  requestRenameWorkspace,
  type EditWorkspaceArchiveStatus
} from './EditWorkspaceDialog'
// #1299 — the same shape one level up the tree, and the host row pen's FIRST caller. Its write helper
// takes an injected transport rather than `sendCommand`: nothing on that path reaches the daemon.
import {
  EditHostDialogView,
  requestSetHostLabel,
  runEditHostUnpair,
  type EditHostStatus
} from './EditHostDialog'
// #1422 — the dialog's Unpair host button. The decision helper is IMPORTED FROM THE SETTINGS SCREEN
// rather than copied: `runUnpairServer` already owns erase → refresh → route-or-clear with the chat
// history removal lifecycle around it, and a second implementation here would be a second enumeration of
// one contract. The clear set and its store wiring come from the one shared `serverScopedClearDeps`, for
// the reason that module's own header gives — a deps literal per call site is how the two halves drift.
import { runUnpairServer } from '../settings/unpairServerAction'
import { clearServerScopedState, serverScopedClearDeps } from '../../clearServerScopedState'
// #1308 — the host row PLUS's first caller, and the only dialog on this screen imported as a CONTAINER
// rather than as a view. Its round trip (an outstanding create, and #1307's rejection arm) is its whole
// substance, so its state and its two subscriptions live with its markup, the `SaveAsChannelDialog` shape.
import { AddWorkspaceDialog } from './AddWorkspaceDialog'
import { ConversationStatusDot } from './ConversationStatusDot'
// #1097 dropped `formatLastActivity` from this import list, not from the module: the sidebar row no
// longer draws a last-activity time, but the helper keeps its three other callers (the Archive
// screen's subtitle, WorkspacePickerSheet and ConversationScreen) and its own unit tests.
import {
  titleFor,
  partitionActive,
  groupByWorkspace,
  groupByServer,
  UNKNOWN_WORKSPACE_KEY
} from './channelListViewModel'

// The Channel List home screen (#141) — the paired shell's `list` view, replacing the throwaway
// PlaceholderList (#140). A pure render slice over the already-shipped #208 conversationListStore: the
// container reads the slice, the pure ChannelListView renders it. No transport, IPC, store, or wire
// code is added (AC1). Mirrors the #203/#218 container-reads / pure-view split.
//
// The wire ConversationSummary carries no message text, so both Figma row shapes (avatar-bearing
// channel rows, preview-bearing discussion rows) collapse to a single label row; the avatars, body
// previews, top app bar, and "See all" link are deferred to other tickets.
//
// #1426 deleted the new-discussion FAB (#242) that used to float over this list. The sidebar's one route
// to a new chat is now the workspace row's own plus (#1178/#1185/#1189), which opens confirmation
// for that row's host; the daemon then chooses its default folder.
//
// #1097 converged that row on the DESKTOP node (103:2968): a 24px row carrying a body-small label and
// nothing else. The trailing last-activity time the mobile node drew is gone — deleted, not hidden —
// so no clock is read anywhere in this file's render path any more.

/**
 * Store-bound container. The store read is its only impurity — safe under `renderToStaticMarkup` in
 * Node, where the store yields its initial `null` (the #218 container posture), so the pure view is
 * what the tests server-render with injected props. `onCreateChat` dereferences `window.pyry` only
 * inside the click arrow (never during render), so the server-render smoke is untouched — the
 * Composer.handleSubmit discipline (UnpairControl was the other example until #1061 deleted it).
 */
export function ChannelList({
  onOpen,
  onOpenSettings,
  onOpenArchive,
  onPairNewHost,
  onRepairHost,
  onHostUnpaired,
  onLeaveConversation
}: {
  onOpen: (row: ConversationSummary) => void
  onOpenSettings: () => void
  onOpenArchive: () => void
  // #1303 — open the pairing flow. A pure injected nav effect like the two above it, dereferencing no
  // `window.pyry` and touching no store, so this container stays server-renderable. `PairedShell` binds
  // it to the same `onOpenPairServer` that drives Settings' "Pair another server" row: one act, one
  // handler, and the container decides where cancel lands from the route rather than from the caller.
  onPairNewHost: () => void
  onRepairHost?: (serverId: string) => void
  /**
   * #1422 — the route flip when the Edit host dialog's unpair erased the LAST paired record. Bound in
   * `PairedShellView` to the very `onUnpaired` prop `SettingsScreen` already receives, so both unpair
   * paths flip the route through one function and neither reaches for a store shortcut. REQUIRED rather
   * than optional, `onPairNewHost`'s rule: forgetting to wire it is the exact regression it exists to
   * prevent, so it is a compile error rather than a silent `undefined` that would strand the operator in
   * a shell with nothing paired.
   */
  onHostUnpaired: () => void
  /**
   * #1422 — `clearServerScopedState`'s `navigateToList`, the ONE member `serverScopedClearDeps`
   * deliberately omits because the two existing callers legitimately differ.
   *
   * ⭐ IT IS NOT THE SETTINGS ROW'S NO-OP HERE, and copying that would be a silent defect no criterion
   * but its own would catch. `ServerRowControl` binds `() => {}` because the Settings route has no thread
   * to leave; this sidebar does. `PairedShellView` renders this container on the `list` AND `thread`
   * routes, so the departed host's chat can be the one on screen, and `exitActiveConversation` fires this
   * exactly when it is. Bound in the shell to its existing back nav, leaving the operator on the list
   * rather than on a thread route for a host that is gone.
   */
  onLeaveConversation: () => void
}): JSX.Element {
  const conversations = useConversationListStore(selectConversations)
  // #1426 — the client-owned default workspace (#403) is NO LONGER READ HERE. The FAB was its only reader
  // in this file and it closed over the current value so #404 would re-render the container; with the FAB
  // gone the plus targets the clicked row's host with `cwd: null`, so the setting reaches no create path and this
  // container has one fewer store slice to wake on. The store and its Settings row are untouched — whether
  // that row stays is a separate decision, tracked in the project's Open Questions.
  //
  // #1098 — the open chat's id, read HERE rather than per row. `activateConversation` calls
  // `setActiveConversation` unconditionally on both its branches before navigating (#448), so this is
  // correct for a sidebar row click and for a plus-minted conversation alike.
  //
  // The FIELD IS `id`. `ConversationCreatedPayload` is a 5-field shape (`id, is_promoted, cwd, name,
  // last_used_at`) and carries no `conversation_id` — the same read ships at ConversationScreen's
  // `activeConversationId`, inline arrow included. It returns a primitive `string | null`, so it is
  // value-stable under `useSyncExternalStore` and is none of the merged-object selectors
  // `ConversationStatusDotControl`'s header bans; the fresh closure per render costs one allocation and
  // one `Object.is`, never a re-subscription.
  //
  // WHY NOT A READ INSIDE `Row`. That is the smaller diff and the tighter re-render boundary (only the
  // two rows whose answer flips would re-render), and it is what `ConversationStatusDotControl` does one
  // component over. It is declined for one reason: zustand v5 serves `getInitialState()` under
  // `renderToStaticMarkup`, so a store-reading row can only ever render `activeConversation: null` — the
  // renderer tier could prove the UNFILLED case and nothing else, leaving the whole marked state to e2e.
  // Read here, the state reaches `ChannelListView` as an injectable prop, which is the seam the unit tier
  // already has a `render()` helper for — where this file's existing answer to the same problem
  // (HostRow/HostRowControl) costs a component and an
  // export. The honest cost, stated rather than hidden: a switch re-renders the whole sidebar where a
  // per-row read would re-render two rows. Accepted — a switch already rebuilds the chat pane, and this
  // is the prop path #1097 freed by deleting `now`.
  const openConversationId = useActiveConversationStore((s) => s.activeConversation?.id ?? null)
  // #1070 — WHICH machines the sidebar draws a subtree for, read HERE rather than inside the host row.
  // This is `openConversationId`'s ruling above, applied to a second piece of store state and for the
  // same reason: zustand v5 serves `getInitialState()` under `renderToStaticMarkup`, so a component
  // reading this list itself could only ever render the EMPTY launch list — the unit tier could prove the
  // no-server frame and nothing else, leaving the whole of "one host row per paired server" to e2e. Read
  // in the container it arrives as an injectable prop, which is the seam `ChannelList.test.tsx`'s
  // `render()` helper already has.
  //
  // `selectServers` hands back the HELD array by reference, so the subscription is value-stable under
  // `useSyncExternalStore` and this container re-renders once per loader write. The `.map` to ids happens
  // at the JSX boundary below and NEVER inside the selector, where a fresh array every call would drive a
  // re-render storm (`selectConversations`'s docblock states the same rule for the row union).
  //
  // The honest cost, stated rather than hidden: a pairing change now re-renders the whole sidebar where
  // it used to wake one row. Accepted — a pairing change IS a whole-sidebar change, and the per-server
  // label reads stay inside their leaves. Status changes also update mutation availability.
  const servers = useServerInfoStore(selectServers)
  const statuses = useSessionStore((state) => state.statuses)
  const connected = (serverId: string | null | undefined): boolean =>
    typeof serverId === 'string' && statuses.get(serverId)?.type === 'connected'
  // Transient, per-interaction dialog state — component-local useState, not the store (the lowest scope
  // that survives re-render, the PermissionModal `pendingOptionId` posture). `saveRow` is the row whose
  // Save-as-channel dialog is open (or none); the dialog's name + location + round-trip state now live in
  // the SaveAsChannelDialog container itself (#288), seeded from the row on mount. The dialog is not
  // rendered on first paint (`saveRow` starts null) and `window.pyry` is dereferenced only inside the
  // container's callbacks, so ChannelList stays server-renderable (the onCreateChat discipline).
  const [saveRow, setSaveRow] = useState<SidebarRow | null>(null)
  // The Rename dialog's independent per-interaction state (#360) — a separate local pair, not shared with
  // the save-as one. No mutual-exclusion logic is needed: an open dialog's fixed-inset overlay covers the
  // window, so the row affordance behind it is not clickable and the two dialogs cannot both be open.
  // `renameRow` is the row whose Rename dialog is open (or none); `renameName` is the controlled field,
  // seeded from the row's displayed title on open (a null-name row prefills with its "Untitled" placeholder).
  const [renameRow, setRenameRow] = useState<SidebarRow | null>(null)
  const [renameName, setRenameName] = useState('')
  // #1476 — the Edit channel dialog's own per-interaction pair, a SECOND pair beside the one above and
  // not a widening of it: since #1441 both trees draw a pen, and since this ticket they open two
  // different modals, so one cell could not say which is open. Independent of the pair above for the
  // reason its five siblings already carry — an open dialog's fixed-inset overlay covers the window, so
  // no two can be open at once and no mutual-exclusion logic is needed.
  //
  // TWO cells and not three: the seed AC2 compares against is `titleFor(editChannelRow.name)`, derived
  // from the row this cell already holds rather than copied into a cell of its own. The held row is a
  // snapshot taken at open time, so that expression yields at OK exactly what it yielded at open — a
  // third cell would be one more thing to clear on host loss and one more thing to forget.
  const [editChannelRow, setEditChannelRow] = useState<SidebarRow | null>(null)
  const [editChannelName, setEditChannelName] = useState('')
  // The selected host stays fixed through each dialog, independent of workspace path. Both creations
  // ask the daemon to choose its default folder; mounting a fresh dialog resets its local draft.
  const [createChatServerId, setCreateChatServerId] = useState<string | null>(null)
  const [createChannelTarget, setCreateChannelTarget] = useState<{ serverId: string } | null>(null)
  // The Edit-workspace dialog's own per-interaction pair (#1180), independent of the three above for
  // their stated reason: an open dialog's fixed-inset overlay covers the window, so no two can be open
  // at once. Hold the exact path and clicked host together until dismissal.
  const [editWorkspaceTarget, setEditWorkspaceTarget] = useState<{
    cwd: string
    serverId: string | undefined
  } | null>(null)
  const [editWorkspaceName, setEditWorkspaceName] = useState('')
  // #1439 — the archive slot's arm, a THIRD cell beside that pair rather than a widening of one of them:
  // the two above hold the dialog's target and its draft, and neither has an arm to widen (this dialog's
  // rename has no round trip, which is what the Edit host dialog's single `EditHostStatus` union exists to
  // keep exclusive). It is seeded `idle` on every open by the same `onEditWorkspace` handler that seeds
  // the other two — what makes AC2's "a reopen starts idle" true with no reset code of its own — and
  // cleared wherever the target is, so the cell never holds an arm for a dialog that is closed.
  const [editWorkspaceArchive, setEditWorkspaceArchive] =
    useState<EditWorkspaceArchiveStatus>('idle')
  // Both exits from the Edit workspace dialog clear both cells, so the two can never disagree about
  // whether it is open. Not folded into the `sessionStore` subscription below: that arm fires from an
  // event rather than from a click, and it is inside a callback with its own dependency list.
  const closeEditWorkspace = (): void => {
    setEditWorkspaceTarget(null)
    setEditWorkspaceArchive('idle')
  }
  // The Edit-host dialog's own per-interaction cells (#1299), independent of the four above for their
  // stated reason: an open dialog's fixed-inset overlay covers the window, so no two can be open at once
  // and no mutual-exclusion logic is needed. `editHostServerId` is the MACHINE being renamed — the id the
  // clicked pen closed over — and holding it HERE is what keeps it out of the dialog view entirely: the
  // view never sees an id at all, it sees a name and a status. `editHostName` is the controlled field,
  // seeded on every open with that server's STORED label (`hostRowEditSeed`, empty when none is stored),
  // so a reopen after a Cancel starts from what is actually held rather than from the abandoned draft.
  // `editHostStatus` is the round trip this dialog has and the four above do not.
  const [editHostServerId, setEditHostServerId] = useState<string | null>(null)
  const [editHostName, setEditHostName] = useState('')
  // #1422 widened this cell rather than adding a sibling: it now spans the unpair's confirm and round
  // trip too, so "saving" and "unpairing" cannot both be true — see `EditHostStatus`'s docblock. It is
  // re-seeded to `idle` on every open by the same `onEditHost` handler that seeds the other two, which is
  // what makes AC2's "the dialog reopens idle" true with no reset code of its own.
  const [editHostStatus, setEditHostStatus] = useState<EditHostStatus>('idle')
  // The Add-workspace dialog's open cell (#1308) — ONE cell, not the pairs above it, because the path and
  // the round-trip status live in the dialog container rather than here: it is mounted only while this
  // holds a server id, so its subscription's lifetime IS the dialog's open lifetime, which is what makes
  // AC4's closed-dialog case true by construction rather than by a guard. It is independent of the five
  // above for their stated reason: an open dialog's fixed-inset overlay covers the window, so no two can be
  // open at once and no mutual-exclusion logic is needed. `addWorkspaceServerId` is the MACHINE the chat
  // will be created on — the id the clicked plus closed over — and holding it HERE is what keeps it out of
  // the dialog view entirely: that view never sees an id at all, it sees a path and a status.
  const [addWorkspaceServerId, setAddWorkspaceServerId] = useState<string | null>(null)

  // Clear drafts on loss, including a disconnect/reconnect before React paints.
  useEffect(() => sessionStore.subscribe((state) => {
    const unavailable = (id: string | null | undefined): boolean =>
      typeof id !== 'string' || state.statuses.get(id)?.type !== 'connected'
    if (saveRow && unavailable(saveRow.serverId)) setSaveRow(null)
    if (renameRow && unavailable(renameRow.serverId)) setRenameRow(null)
    // #1476: AC3's host-loss close, HERE rather than in a second effect — one subscription clears every
    // dialog's target, so a disconnect can never leave one of them holding a stale row.
    if (editChannelRow && unavailable(editChannelRow.serverId)) setEditChannelRow(null)
    if (createChatServerId && unavailable(createChatServerId)) setCreateChatServerId(null)
    if (createChannelTarget && unavailable(createChannelTarget.serverId)) setCreateChannelTarget(null)
    // #1439: the arm goes with the target on the host-loss path (AC2), in the same statement — a reset
    // written anywhere else is one an edit to this branch can forget.
    if (editWorkspaceTarget && unavailable(editWorkspaceTarget.serverId)) {
      setEditWorkspaceTarget(null)
      setEditWorkspaceArchive('idle')
    }
  }), [saveRow, renameRow, editChannelRow, createChatServerId, createChannelTarget, editWorkspaceTarget])
  return (
    <>
      {/* #834: the headless one-shot that fills the host row's label, mounted HERE — the SettingsScreen
          idiom (<ServerInfoData /> beside <ServerRowControl />) applied to the screen that actually
          renders the row. It renders null, so DOM order is immaterial, and it dereferences `window.pyry`
          only inside its effect, so this container stays server-renderable (the onCreateChat
          discipline). The two alternatives both fail: an app-level mount fires once at launch, BEFORE
          pairing, and never re-runs — leaving the row stale after a same-session pair — and mounting it
          in SettingsScreen is exactly what AC5 forbids ("with no visit to the Settings screen first").
          One read per sidebar mount: PairedShell renders ChannelList at the same element position on the
          `list` and `thread` routes, so React preserves it across that flip and no read fires there; it
          DOES remount on return from settings / archive / pairServer, which re-reads — correct, since
          Settings → "Pair another server" is how the label changes mid-session. That remount is also
          what keeps `hostLabelStore` out of `clearPairingScopedState`: it re-asserts itself on remount,
          which is that file's stated exclusion (the `serverInfoStore` worked example). */}
      <HostLabelData />
      {/* #1199: the paired-server one-shot, mounted beside the label one-shot for the same reasons and
          with the same lifetime. It renders null, so DOM order is immaterial, and it dereferences
          `window.pyry` only inside its effect. `HostLabelData` reads the list this fills, so the launch
          sequence is: this resolves → `serverInfoStore` fills → one keyed label read per paired server.
          Hosts use the fallback label until their keyed label reads resolve. Settings and
          ConversationScreen each mount
          their own instance; a second one here is the established posture, not a duplicate — the store
          holds one list and each mount re-reads it. */}
      <ServerInfoData />
      <ChannelListView
        conversations={conversations}
        statuses={statuses}
        serverIds={servers.map((server) => server.serverId)}
        openConversationId={openConversationId}
        onOpen={onOpen}
        onOpenSettings={onOpenSettings}
        onOpenArchive={onOpenArchive}
        onPairNewHost={onPairNewHost}
        onRepairHost={onRepairHost}
        // The current workspace row supplies the host, while the daemon chooses the default folder.
        onCreateChat={(_cwd, serverId) => {
          if (!canMutateHost(serverId) || serverId === undefined) return
          setCreateChatServerId(serverId)
          window.pyry.sendDiagnostic({ event: 'chat-create-state', code: 'opened' })
        }}
        // The Channels-tree plus opens its existing named draft for the clicked host.
        onCreateChannel={(_cwd, serverId) => {
          if (!canMutateHost(serverId) || serverId === undefined) return
          setCreateChannelTarget({ serverId })
        }}
        // #1180 — the pen OPENS A DIALOG and sends nothing: the workspace is fixed by the row that was
        // clicked, and the new name still has to be typed. Both cells are seeded together, the field
        // from the group's CURRENT label — which is the daemon-held `workspace_label` when there is one
        // and the folder segment otherwise, resolved by `groupByWorkspace` and indistinguishable here
        // on purpose (AC4 asks for "the row's current label", which is exactly what the row renders).
        onEditWorkspace={(cwd, label, serverId) => {
          if (!canMutateHost(serverId)) return
          setEditWorkspaceTarget({ cwd, serverId })
          setEditWorkspaceName(label)
          // #1439 — the third cell, seeded with the other two so every open starts on the idle button.
          setEditWorkspaceArchive('idle')
        }}
        // #1299 — the host row's pen OPENS A DIALOG and writes nothing: the machine is fixed by the row
        // that was clicked, and the new name still has to be typed. All three cells are seeded together,
        // the field from that server's STORED label — which is `hostRowEditSeed`'s answer and emphatically
        // NOT `hostRowLabel`'s: the row displays the generic word for every non-name outcome, and seeding
        // an editable field with it would invite storing that word as the machine's actual name.
        onEditHost={(serverId, seedLabel) => {
          setEditHostServerId(serverId)
          setEditHostName(seedLabel)
          setEditHostStatus('idle')
        }}
        // #1308 — the host row's plus OPENS A DIALOG and sends nothing: the machine is fixed by the row
        // that was clicked, and the folder still has to be typed. ONE cell to seed, and nothing to clear
        // on close: `ChannelList` mounts a fresh dialog container per open, so the field and the status
        // always start empty and `idle` without a reset here.
        onAddWorkspace={(serverId) => setAddWorkspaceServerId(serverId)}
        onSaveAsChannel={(row) => { if (canMutateHost(row.serverId)) setSaveRow(row) }}
        onRename={(row) => {
          if (!canMutateHost(row.serverId)) return
          // Open the Rename dialog, seeding the field with the row's CURRENT displayed title (AC1) — the
          // same one-handler seed as save-as; a null-name row prefills with its "Untitled" placeholder.
          setRenameRow(row)
          setRenameName(titleFor(row.name))
        }}
        // #1476 — the CHANNELS tree's pen, into a handler of its own rather than the `onRename` above it.
        // The two seed identically; what differs is the modal each opens, which is the whole ticket. The
        // seed is `titleFor(row.name)` (AC2's "including the Untitled fallback"), and the OK guard below
        // re-derives that same expression from the same captured row rather than reading a copy.
        onEditChannel={(row) => {
          if (!canMutateHost(row.serverId)) return
          setEditChannelRow(row)
          setEditChannelName(titleFor(row.name))
        }}
      />
      {saveRow && connected(saveRow.serverId) && (
        <SaveAsChannelDialog
          row={saveRow}
          onDismiss={() => setSaveRow(null)}
          onPromoted={() => setSaveRow(null)}
        />
      )}
      {renameRow && connected(renameRow.serverId) && (
        <EditChatDialogView
          name={renameName}
          onNameChange={setRenameName}
          onCancel={() => setRenameRow(null)}
          onSave={() => {
            if (!canMutateHost(renameRow.serverId)) return
            requestRenameConversation(window.pyry.sendCommand, renameRow, renameName)
            setRenameRow(null)
          }}
          // #1440 — the archive arm. The SAME interaction-time re-check the save above carries, and
          // `window.pyry` dereferenced here rather than during render, for the same two reasons. It
          // sends ONE command and closes; no rename goes out whatever the field holds, nothing is
          // written to a store and nothing navigates — the row leaves the active list on the daemon's
          // `conversation_updated` re-list, and if this chat is the one on screen, `PairedShell`'s
          // existing archived-active bridge is what leaves the thread. `requestArchiveConversation` is
          // the symbol #1439 already imported for the workspace fan-out, so the dialog module still
          // imports nothing from the conversation screen and the two directories stay cycle-free.
          onArchive={() => {
            if (!canMutateHost(renameRow.serverId)) return
            requestArchiveConversation(window.pyry.sendCommand, renameRow.id)
            setRenameRow(null)
          }}
        />
      )}
      {/* #1476 — the Channels tree's own modal, a sibling of the chat dialog above and not a variant of
          it. The SAME render gate its five siblings carry, so AC3's "closes if the row's host stops
          being connected" holds on the very next paint even before the subscription above fires.

          #1477 mounted a CONTAINER in the view's place, so this modal now owns a daemon subscription and
          its subscription's lifetime is exactly this gate's — which is what makes that ticket's "a reopen
          starts from a fresh ask rather than the abandoned draft" true with no reset code here. The
          `typeof … === 'string'` is BEHAVIOUR-IDENTICAL to what shipped (`connected` already answers
          false for a non-string) and is present only so `serverId` narrows to `string` for the container
          without a `!` or an `as`. */}
      {editChannelRow && typeof editChannelRow.serverId === 'string' &&
        connected(editChannelRow.serverId) && (
        <EditChannelDialog
          conversationId={editChannelRow.id}
          serverId={editChannelRow.serverId}
          name={editChannelName}
          onNameChange={setEditChannelName}
          // Cancel and the header close are ONE callback and send nothing (AC2). The draft dies with the
          // cell, so a reopen re-seeds from the row's stored title rather than from the abandoned draft.
          onCancel={() => setEditChannelRow(null)}
          // #1477 handed this callback a parameter: the container's own prompt write, to be run INSIDE
          // the guard below. It is invoked here rather than by the container so both of this OK's sends
          // answer to ONE host re-check and one diagnostic — and so the prompt write is unreachable
          // except from inside that guard.
          onSave={(writePrompt) => {
            // FIRST, the interaction-time re-check — a LIVE store read, deliberately a different fabric
            // from the render gate above, which is React state and can be a paint behind a status flip.
            // This dialog's OK carries no `available` disabled arm of its own (see `EditChannelDialog`'s
            // header), so this line is the only thing standing between a disconnect and a send.
            if (!canMutateHost(editChannelRow.serverId)) return
            // THEN #1477's prompt write, which takes its OWN decision against the value the container
            // read from the daemon and sends nothing when the box has not moved off it — the rename
            // comparison below is untouched by it and still fires on its own, including while the read
            // is still outstanding. Two independent verbs on one conversation, in wire order: the
            // create path already sends `set_system_prompt` beside a conversation verb this way.
            writePrompt()
            // THEN AC2's "only when the trimmed name differs from the title the field was seeded with".
            // `titleFor(editChannelRow.name)` is the seed by construction — the same expression, over the
            // same captured row, that `onEditChannel` seeded the field from. So OK on an untouched
            // unnamed row sends nothing rather than naming that channel `Untitled`, and an edit that
            // only adds edge whitespace sends nothing either.
            //
            // The check lives HERE, beside the send, and NOT inside `requestRenameConversation`:
            // `ConversationScreen` and the Chats tree are that helper's other callers and keep sending
            // unconditionally. The helper is reused verbatim — it owns the `renameConversation` literal
            // and the trim, so this ticket adds no wire type, no envelope and no IPC arm.
            if (editChannelName.trim() !== titleFor(editChannelRow.name)) {
              requestRenameConversation(window.pyry.sendCommand, editChannelRow, editChannelName)
            }
            // Dismissal is unconditional: BOTH arms close. An unchanged name is a no-op, not a refusal.
            setEditChannelRow(null)
          }}
          // #1438 — the archive arm, the SAME interaction-time re-check the save above takes and the
          // same one the chat dialog's own archive takes, with `window.pyry` dereferenced here rather
          // than during render for the same two reasons.
          //
          // ⭐ IT ARCHIVES `editChannelRow` — THE ROW THIS MODAL WAS OPENED ON, never whichever
          // conversation the chat pane happens to hold. That is true BY CONSTRUCTION rather than by a
          // check: the id comes from the same captured cell the rename above reads, and there is no
          // active-conversation lookup anywhere on this path to get it wrong. It is worth stating
          // because the modal opens from ANY row, so "the row" and "the open conversation" are routinely
          // two different conversations here — the reason `edit-channel-system-prompt.spec.ts` drives
          // this click with a promoted row standing beside a separate open chat.
          //
          // It sends ONE command and closes. NEITHER the rename NOR the prompt write goes out, whatever
          // the two fields hold — `writePrompt` is the container's and is reachable only from inside the
          // save's guard, never from here — nothing is written to a store, nothing navigates, and
          // nothing logs. The row leaves the sidebar on the daemon's `conversation_updated` re-list, and
          // if this channel is also the chat on screen, the existing archived-active bridge is what
          // leaves the thread. `requestArchiveConversation` is already imported for the chat dialog's
          // own archive and #1439's workspace fan-out, so this adds no command literal and no wire type.
          onArchive={() => {
            if (!canMutateHost(editChannelRow.serverId)) return
            requestArchiveConversation(window.pyry.sendCommand, editChannelRow.id)
            setEditChannelRow(null)
          }}
        />
      )}
      {createChatServerId !== null && connected(createChatServerId) && (
        <CreateChatDialog serverId={createChatServerId}
          onDismiss={() => setCreateChatServerId(null)} />
      )}
      {createChannelTarget !== null && connected(createChannelTarget.serverId) && (
        <CreateChannelDialog
          serverId={createChannelTarget.serverId}
          onDismiss={() => setCreateChannelTarget(null)}
        />
      )}
      {editWorkspaceTarget !== null && connected(editWorkspaceTarget.serverId) && (
        <EditWorkspaceDialogView
          name={editWorkspaceName}
          status={editWorkspaceArchive}
          onNameChange={setEditWorkspaceName}
          onCancel={closeEditWorkspace}
          onSave={() => {
            if (!canMutateHost(editWorkspaceTarget.serverId)) return
            requestRenameWorkspace(
              window.pyry.sendCommand,
              editWorkspaceTarget.cwd,
              editWorkspaceName,
              editWorkspaceTarget.serverId
            )
            closeEditWorkspace()
          }}
          // #1439 — arming and disarming send NOTHING; only the confirm reaches the daemon (AC2).
          archive={{
            onArm: () => setEditWorkspaceArchive('confirming-archive'),
            onCancel: () => setEditWorkspaceArchive('idle'),
            onConfirm: () => {
              // The same guard the rename above carries, plus the narrowing `onCreateChannel` already
              // writes: `canMutateHost` refuses anything that is not a CONNECTED string id, so an
              // unattributed group never reaches the send — and the explicit `=== undefined` is what
              // tells the compiler so, since the guard returns a boolean rather than a predicate.
              const serverId = editWorkspaceTarget.serverId
              if (!canMutateHost(serverId) || serverId === undefined) return
              // `window.pyry` is dereferenced HERE, at interaction time, never during render — the
              // `onCreateChat` discipline. The rows are the union this container already reads; the
              // helper keeps the ones on this host, in this exact folder, that are not archived yet.
              requestArchiveWorkspace(
                (conversationId) =>
                  requestArchiveConversation(window.pyry.sendCommand, conversationId),
                conversations ?? [],
                editWorkspaceTarget.cwd,
                serverId
              )
              // No rename is sent on this path, whatever the field holds (AC3), and the dialog closes at
              // once: the send is fire-and-forget, so there is nothing to await and no arm to wait in.
              closeEditWorkspace()
            }
          }}
        />
      )}
      {/* #1299 — gated on an explicit `!== null` and NEVER on truthiness, and here that is not a
          theoretical trap the way it is for the two `cwd` dialogs above: `isHostLabelServerRequest`
          deliberately ACCEPTS the empty string as a server id, so an empty id is storable and a truthy
          gate would collapse a real machine's dialog into "none open". */}
      {editHostServerId !== null && (
        <EditHostDialogView
          name={editHostName}
          status={editHostStatus}
          // #1300 — the clicked row's OWN identity, looked up HERE because this is the only place both
          // halves are already in scope: `servers` off `serverInfoStore` and the id the pen closed over.
          // `renderServerTrees` could not supply it — it receives `readonly string[]`, ids alone — which
          // is why nothing below this container changes for this ticket.
          //
          // `find` cannot match the wrong machine, and that is checked rather than assumed:
          // `pairedServerStore` treats a repeated `server` id as MALFORMED on decode and its `save` adds
          // -or-replaces by key, so the id is unique at two layers — and that store's own retrieval uses
          // this identical shape. `?? null` normalises `find`'s `undefined` to the view's one absent
          // form, which is what a reseed or an unpair under an open dialog produces.
          //
          // The displayed pair and the write target can never disagree: both derive from this same
          // `editHostServerId` cell in the same render, and the save arrow below fixes the id before its
          // await. The values are handed down as DISPLAY STRINGS and nothing else — the dialog module's
          // header states the full sink list, and the relay URL is never dialled from either side.
          server={servers.find((entry) => entry.serverId === editHostServerId) ?? null}
          onNameChange={setEditHostName}
          // Cancel closes and writes nothing (AC1). It is never disabled, so it is the exit even while a
          // write is outstanding; the next open re-seeds all three cells, so there is nothing to clear.
          onCancel={() => setEditHostServerId(null)}
          onSave={() => {
            // `window.pyry` is dereferenced HERE, at interaction time, never during render — the
            // `onCreateChat` discipline. The helper trims the name and classifies the answer; this
            // arrow decides only what to do with it.
            //
            // ⭐ THE STORE WRITE IS KEYED BY THE ID CAPTURED IN THIS CLOSURE, never by anything the
            // response carried — `HostLabelResult` names no server at all, and this id came off the
            // client's own paired-server list. It is fixed BEFORE the await and never re-read from state
            // after it, which is `loadHostLabelFor`'s stated rule applied to the write: keying off
            // anything else would let one machine's answer land on another machine's row.
            //
            // `void`, never floating: `requestSetHostLabel` always resolves, so there is no rejection to
            // handle and nothing here can surface as an unhandled rejection in React. A Cancel or a
            // navigation away mid-write leaves this resolution writing a store slot that is still
            // CORRECT — main has already persisted it — and two setState calls that are inert on a
            // closed or unmounted dialog.
            const serverId = editHostServerId
            setEditHostStatus('saving')
            void requestSetHostLabel(window.pyry.setHostLabelFor, serverId, editHostName).then(
              (next) => {
                if (next === null) {
                  // #1422 — guarded for the same reason the unpair arm below is, now that one cell
                  // spans two round trips: this write may only report against its OWN flight. The
                  // dialog's disabled verb keeps a save and an erase from being launched together,
                  // but the footer Cancel is never disabled, so a dismissal mid-save and a reopen can
                  // still leave this resolution arriving over an erase that started afterwards.
                  // Unguarded it would clear `unpairing` mid-flight — unfreezing the field, OK and
                  // both answers, and swallowing the erase's own failure line, whose guard would then
                  // no longer recognise the arm it left behind.
                  setEditHostStatus((prev) => (prev === 'saving' ? 'failed' : prev))
                  return
                }
                hostLabelStore.getState().setHostLabelFor(serverId, next)
                setEditHostServerId(null)
              }
            )
          }}
          // #1422 — the unpair slot. Arm and cancel are pure cell moves; only confirm acts.
          unpair={{
            onArm: () => setEditHostStatus('confirming-unpair'),
            onCancel: () => setEditHostStatus('idle'),
            onConfirm: () => {
              // ⭐ THE ERASE IS KEYED BY THE ID CAPTURED IN THIS CLOSURE, fixed BEFORE the await and never
              // re-read from state after it — the save arrow's rule above, applied to the destructive
              // path where it matters more: keying off anything else would let one machine's answer
              // erase, or report against, another machine's record.
              const serverId = editHostServerId
              void runEditHostUnpair({
                // `window.pyry` is dereferenced HERE, at interaction time, never during render — the
                // `onCreateChat` discipline, so this container stays server-renderable.
                unpair: () =>
                  runUnpairServer(
                    {
                      unpairServer: window.pyry.unpairServer,
                      // The SAME loader the mount fetch uses, so the refreshed host rows and the "do any
                      // records remain?" decision come from one read and cannot disagree.
                      refreshServers: () =>
                        loadServerInfo(
                          window.pyry.serverInfo,
                          serverInfoStore.getState().setServers
                        ),
                      onLastServerUnpaired: onHostUnpaired,
                      // SPREAD, never restated. `getDepartedConversationIds` binds to the stricter
                      // `selectExclusiveConversationIdsFor` in that one shared object, and that is a
                      // security property rather than a detail: the departed ids are the departing
                      // daemon's OWN claim, so an over-broad answer turns "forget host A" into destroying
                      // host B's retained threads and closing the chat being read on B, with no backfill
                      // in either timeline store. `navigateToList` is the one member it omits — see
                      // `onLeaveConversation`'s docblock for why this caller must NOT copy the Settings
                      // row's no-op into it.
                      clearServerScopedState: (departedServerId) =>
                        clearServerScopedState(
                          { ...serverScopedClearDeps, navigateToList: onLeaveConversation },
                          departedServerId
                        )
                    },
                    serverId
                  ),
                // ⭐ BOTH ARMS ARE FUNCTIONAL UPDATERS, and that is load-bearing rather than stylistic.
                // AC4 keeps the footer Cancel enabled during the flight (the invoke has no timeout), so
                // the operator can dismiss this dialog mid-erase and reopen it against a DIFFERENT host
                // before the answer lands — at which point these arrows still hold the departed host's
                // cells. The erase itself is immune by construction, keyed by the id captured above; the
                // MESSAGE is not, and unguarded it would close host B's freshly opened dialog or report a
                // failure against it. Reading `prev` closes both: in that case it is B's id and `idle`
                // respectively, so each is a no-op, and on the ordinary path both behave exactly as the
                // unguarded calls would. The updaters are pure, so StrictMode's double invoke is inert.
                setStatus: (next) =>
                  setEditHostStatus((prev) =>
                    next === 'unpairing' || prev === 'unpairing' ? next : prev
                  ),
                close: () => setEditHostServerId((prev) => (prev === serverId ? null : prev))
              })
            }
          }}
        />
      )}
      {/* #1308 — gated on an explicit `!== null` and NEVER on truthiness, `editHostServerId`'s reason
          exactly: `isHostLabelServerRequest` deliberately ACCEPTS the empty string as a server id, so an
          empty id is a real machine's and a truthy gate would collapse its dialog into "none open".

          KEYED BY THE SERVER ID so a reopen — or an open against a DIFFERENT machine while one is somehow
          mounted — remounts the container rather than reusing it, which is what guarantees the empty field
          and the `idle` status this file's other four dialogs get from re-seeding their cells on open. */}
      {addWorkspaceServerId !== null && (
        <AddWorkspaceDialog
          key={addWorkspaceServerId}
          serverId={addWorkspaceServerId}
          // Cancel closes and sends nothing (AC1); a confirmed create closes it too (AC2). One handler
          // serves both — there is nothing to record on the way out, the new row arriving through the
          // daemon's confirmation and the thread being opened by `useConversationCreatedNav` in
          // PairedShell, exactly as the workspace row's own `Create chat` create is.
          onDismiss={() => setAddWorkspaceServerId(null)}
        />
      )}
    </>
  )
}

/**
 * The pure view. Always returns a stable `aria-label="Conversations"` root (the test hook, present in
 * every state); content varies with the conversation store's tri-state AND the paired-server list:
 *  - `conversations === null` (not-yet-loaded) → saved hosts, with no conversation rows.
 *  - loaded, but nothing to draw — no paired server AND no active row → the toolbar only.
 *  - anything to draw → two trees separated by the divider, each with
 *    one host row per paired server in pairing order (#1070).
 *
 * The loaded-zero empty state is GONE since #1070, deleted rather than hidden: a paired app always has a
 * host row to draw, and that row is where #1185/#1189 put the plus that starts a chat in a new workspace.
 */
export function ChannelListView({
  conversations,
  statuses,
  serverIds,
  openConversationId,
  onOpen,
  onOpenSettings,
  onOpenArchive,
  onPairNewHost,
  onRepairHost,
  onCreateChat,
  onCreateChannel,
  onEditWorkspace,
  onEditHost,
  onAddWorkspace,
  onSaveAsChannel,
  onRename,
  onEditChannel
}: {
  // Widened to `ServerConversationSummary` in all but name: the rows arrive carrying their server stamp
  // (#1086), and `groupByServer`'s structural constraint is what reads it — this prop stays typed as the
  // wire row so the three other screens reading the same selector are unaffected.
  conversations: readonly (ConversationSummary & { readonly serverId?: string | null })[] | null
  // #1070 — the paired servers to draw a subtree for, in pairing order (oldest-paired first). REQUIRED
  // rather than optional, `openConversationId`'s reasoning: the container must decide, and a defaulted
  // prop would let a future caller silently render a sidebar with no host row at all. An EMPTY array is
  // the real launch state — the paired-server one-shot has not settled — and is what makes the host trees
  // wait rather than flashing above nothing.
  //
  // Ids and not `ServerInfoValue`s: this view has no business with a relay URL, and the narrower prop is
  // also the one the unit tier can inject in one literal.
  serverIds: readonly string[]
  statuses: SessionState['statuses']
  // #1098 — the id of the chat the pane is showing, or `null` when none has been opened this session.
  // REQUIRED rather than optional: the container must decide, and a defaulted prop would let a future
  // caller silently render an unmarked sidebar. The unit tier's own helper defaults it to `null`, which
  // is exactly what the store hydrates to under `renderToStaticMarkup`.
  openConversationId: string | null
  onOpen: (row: ConversationSummary) => void
  onOpenSettings: () => void
  onOpenArchive: () => void
  // Required navigation callback for the always-visible toolbar entry.
  onPairNewHost: () => void
  onRepairHost?: (serverId: string) => void
  // The workspace-row plus opens confirmation for its host. The row's cwd is no longer a destination.
  onCreateChat: (cwd: string, serverId: string | undefined) => void
  // The Channels-tree workspace plus opens the named channel dialog for its host.
  onCreateChannel: (cwd: string, serverId: string | undefined) => void
  // #1180 — open the Edit-workspace dialog for the named workspace. REQUIRED for its two siblings'
  // reason: a defaulted prop would let a future caller silently render a sidebar whose pen opens
  // nothing. It takes the group's `cwd` AND the label the row is currently showing — the second
  // argument is what the dialog's field is seeded from, and it is passed rather than re-derived so the
  // dialog cannot disagree with the row about what the workspace is called. Neither is inspected here;
  // both travel verbatim. Like `onCreateChannel` it does NOT send a command — the dialog's Save does,
  // once a name has been typed.
  onEditWorkspace: (cwd: string, label: string, serverId: string | undefined) => void
  // #1299 — open the Edit host dialog for the named machine. REQUIRED for its three siblings' reason: a
  // defaulted prop would let a future caller silently render a sidebar whose host pen opens nothing, which
  // is precisely the state #1185 shipped and this ticket ends. It takes the server id AND that machine's
  // STORED label — the second argument is what the dialog's field is seeded from, and it is resolved by
  // `HostRowControl`, the level that holds the store slice, rather than re-derived here. Neither is
  // inspected on the way through; both travel verbatim. Like `onEditWorkspace` it sends no command — and
  // unlike it, the dialog's Save sends none either.
  onEditHost: (serverId: string, seedLabel: string) => void
  // #1308 — open the Add workspace dialog for the named machine. REQUIRED for its four siblings' reason: a
  // defaulted prop would let a future caller silently render a sidebar whose host plus opens nothing, which
  // is precisely the state #1185 shipped and this ticket ends. It takes the server id ALONE — unlike
  // `onEditHost` there is no seed to carry, the field opening empty on every open — and that id is resolved
  // by `HostRowControl`, the level already drawn for one machine. It is not inspected on the way through;
  // it travels verbatim. Like `onEditHost` it sends no command — the dialog's Start chat does.
  onAddWorkspace: (serverId: string) => void
  onSaveAsChannel: (row: SidebarRow) => void
  onRename: (row: SidebarRow) => void
  // #1476 — open the Edit channel dialog for a CHANNELS row. REQUIRED for its siblings' reason: a
  // defaulted prop would let a future caller silently render a Channels tree whose pen opens nothing.
  // It is the per-tree twin of `onRename`, which now serves the Chats tree alone; `renderBody` hands
  // this one to the Channels `renderServerTrees` call and that one to the Chats call, which is the
  // single level that tells the two trees apart. Neither sends a command — each dialog's OK does.
  onEditChannel: (row: SidebarRow) => void
}): JSX.Element {
  return (
    <section className="channel-list" aria-label="Conversations">
      {/* The toolbar and rule stay outside the list scrollport. */}
      <div className="channel-list__actions">
        <SettingsButton onClick={onOpenSettings} />
        <ArchiveButton onClick={onOpenArchive} />
        <PairNewHostButton onClick={onPairNewHost} />
      </div>
      <div className="channel-list__actions-rule" />
      <div className="channel-list__tree">
        {renderBody(
          conversations,
          statuses,
          serverIds,
          openConversationId,
          onOpen,
          onCreateChat,
          onCreateChannel,
          onEditWorkspace,
          onEditHost,
          onAddWorkspace,
          onRepairHost,
          onSaveAsChannel,
          onRename,
          onEditChannel
        )}
      </div>
    </section>
  )
}

// The Settings entry affordance (#333, redrawn by #1443 as the Top bar's `Settings button` 115:3834) —
// no longer a desktop-invented control. #333 and #347 both recorded that the list scope (mobile 15-8)
// pinned no settings entry and no archive entry, so both were invented and both wore the
// `.settings__back` 48px round treatment. The desktop card draws them: two 24px boxes at the card's top
// inset, the gear LEADING at the content edge, filled --color-primary with no ground in any state drawn.
// Rendered as a child of the bar, which is a sibling of the list body, so it is present in all three
// list states (AC1) and stays put while a long list scrolls under the rule. An icon-only native <button>
// (keyboard-focusable), `aria-label` supplies the accessible name since the gear glyph carries no text,
// and the SVG is aria-hidden — the shape `ArchiveButton` beside it shares. onClick is a pure injected
// nav effect — no window.pyry, no store.
//
// THE GLYPH IS THE DRAWING'S OWN EXPORT (`gear-solid-full 1` 115:3832), drawn at its own 22 × 24 and
// centred in the 24px box by the button's flex centring — the outer box and the leaf are separate
// numbers in the node and stay separate here. Its path is inlined rather than fetched: the Figma MCP
// asset URLs expire after seven days, so the operator recorded both path strings on the ticket. It
// replaces the 24px Material `settings` glyph #333 shipped. `fill="currentColor"` over the button's
// `color` is what keeps the node's #9dcbfc a TOKEN reference rather than a literal.
function SettingsButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="channel-list__settings"
      aria-label="Settings"
      onClick={onClick}
      {...controlNamePlacement}
    >
      <svg
        className="channel-list__settings-icon"
        viewBox="0 0 22 24"
        width="22"
        height="24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M8.3569 1.125C8.48641 0.472059 9.05191 0 9.70806 0H12.2895C12.9457 0 13.5112 0.472059 13.6407 1.125L14.2666 4.21324C14.8753 4.47794 15.4451 4.81765 15.9631 5.21912L18.8899 4.22647C19.5115 4.01471 20.1936 4.27941 20.5217 4.86176L21.8124 7.14706C22.1405 7.72941 22.0239 8.46176 21.5318 8.90735L19.2309 10.9985C19.2698 11.325 19.2871 11.6603 19.2871 12C19.2871 12.3397 19.2655 12.675 19.2309 13.0015L21.5361 15.0971C22.0282 15.5426 22.1405 16.2794 21.8167 16.8574L20.526 19.1426C20.1979 19.7206 19.5158 19.9897 18.8942 19.7779L15.9674 18.7853C15.4451 19.1868 14.8753 19.5221 14.2709 19.7912L13.6493 22.875C13.5155 23.5324 12.95 24 12.2981 24H9.7167C9.06054 24 8.49504 23.5279 8.36553 22.875L7.74391 19.7912C7.13524 19.5265 6.56974 19.1868 6.04741 18.7853L3.10766 19.7779C2.48604 19.9897 1.80399 19.725 1.47591 19.1426L0.185184 16.8574C-0.142893 16.275 -0.0263396 15.5426 0.465776 15.0971L2.77095 13.0015C2.7321 12.675 2.71483 12.3397 2.71483 12C2.71483 11.6603 2.73642 11.325 2.77095 10.9985L0.465776 8.90294C-0.0263396 8.45735 -0.138577 7.72059 0.185184 7.14265L1.47591 4.85735C1.80399 4.275 2.48604 4.01029 3.10766 4.22206L6.03446 5.21471C6.55679 4.81324 7.12661 4.47794 7.73096 4.20882L8.3569 1.125ZM10.9988 15.5294C12.9068 15.5206 14.4479 13.9368 14.4393 11.9868C14.4306 10.0368 12.8809 8.46176 10.9729 8.47059C9.06486 8.47941 7.52376 10.0632 7.53239 12.0132C7.54102 13.9632 9.09076 15.5382 10.9988 15.5294Z" />
      </svg>
      <span className="channel-list__control-name" aria-hidden="true">Settings</span>
    </button>
  )
}

// The Archive entry affordance (#347, redrawn by #1443 as the Top bar's `Archive button` 117:3835) —
// mirroring SettingsButton's shape, as it has since #347, and now TRAILING rather than leading: the
// drawing puts the gear first. Clones the gear's posture exactly: an icon-only native <button>
// (keyboard-focusable), whose distinct `aria-label="Archive"` supplies the accessible name and
// disambiguates it from the gear's "Settings" (the ticket's disambiguation), and whose SVG is
// aria-hidden. onClick is a pure injected nav effect — no window.pyry, no store.
//
// THE GLYPH IS THE DRAWING'S OWN EXPORT (`box-archive-solid-full 1` 117:3839), drawn at its own 24 × 21
// — a DIFFERENT leaf size from the gear's 22 × 24 inside the same 24px box, which is why neither is
// sized by a shared rule. Inlined for the gear's reason: the export URLs expire after seven days. It
// replaces the 24px Material `archive` glyph #347 shipped.
function ArchiveButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="channel-list__archive"
      aria-label="Archive"
      onClick={onClick}
      {...controlNamePlacement}
    >
      <svg
        className="channel-list__archive-icon"
        viewBox="0 0 24 21"
        width="24"
        height="21"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M0 1.5C0 0.670312 0.670312 0 1.5 0H22.5C23.3297 0 24 0.670312 24 1.5V3C24 3.82969 23.3297 4.5 22.5 4.5H1.5C0.670312 4.5 0 3.82969 0 3V1.5ZM1.5 6.75H22.5V18C22.5 19.6547 21.1547 21 19.5 21H4.5C2.84531 21 1.5 19.6547 1.5 18V6.75ZM8.625 9.75C8.00156 9.75 7.5 10.2516 7.5 10.875C7.5 11.4984 8.00156 12 8.625 12H15.375C15.9984 12 16.5 11.4984 16.5 10.875C16.5 10.2516 15.9984 9.75 15.375 9.75H8.625Z" />
      </svg>
      <span className="channel-list__control-name" aria-hidden="true">Archive</span>
    </button>
  )
}

// `NewConversationFab` (#242, Figma 15-106) stood HERE until #1426 deleted it — a floating 56px add
// affordance pinned bottom-right of the scroller, minting a chat in the Settings default workspace on the
// sole paired host and disabled whenever the paired count was not exactly one. Recorded rather than
// silently removed because the sidebar card (103:2959) never drew a floating button, and because the
// deletion is what the three comments above — SettingsButton's, ArchiveButton's and the actions
// cluster's — used to cite as the shape they cloned. Its replacement was already shipped: the workspace
// row's plus (#1178/#1185/#1189) confirms on the clicked row's host with the daemon's default folder, so every paired
// machine keeps a route to a first chat and no create depends on a client-side default any more.

// What the host row shows when there is NO usable operator label (#834) — a client-owned module-level
// constant in the SERVER_ROW_LABEL / SETTINGS_COPY idiom, never a daemon string. #710 shipped it as the
// row's only label; #834 demoted it to the fallback and put the operator-typed name in front of it.
//
// The word is "Server" rather than the design's "Host" because it is already the app's own user-facing
// word for this machine (SERVER_ROW_LABEL, "Pair another server"), so the sidebar and Settings →
// Connection read as one concept rather than two. NOT merged with `ServerRow.tsx`'s SERVER_ROW_LABEL:
// two screens, two copy constants, deliberately — a shared one would couple two surfaces' copy through
// a cross-screen import for a six-character string.
//
// What is still forbidden here is `serverId`. `serverInfoStore` exposes `{ serverId, relayUrl }` one
// import away and `ServerRow.tsx:37` already renders `serverId`; that is legitimate THERE — Settings is
// a details surface and the value sits beside a "Server" label — but not here, because this row is a
// NAME slot, so an opaque identifier in it would read as the machine's name.
const HOST_ROW_FALLBACK_LABEL = 'Server'

/**
 * The whole of AC2: four store arms and one stored VALUE collapse to the fallback word (#834).
 *
 * Returns the operator's label only when one was read AND it has non-whitespace content; `loading`,
 * `not-stored`, `error` and a `stored` label that renders blank all yield `HOST_ROW_FALLBACK_LABEL`.
 *
 * Three decisions this function owns, none of them a type error if reversed:
 *
 *  - `loading` FALLS BACK TO THE SAME WORD, never to a 'Loading…' placeholder. This is the one place
 *    `ServerRow`'s precedent must NOT be copied: Settings' server row shows a value in a details list,
 *    where a placeholder reads as "not fetched yet"; this is a NAME slot, and a placeholder in it reads
 *    as the machine's name. The pre-settle window is a tick, and showing the generic word for that tick
 *    is indistinguishable from the not-stored steady state — correct, because both mean "no name yet."
 *  - THE PREDICATE TRIMS; THE DISPLAYED LABEL IS VERBATIM. `''` is the case AC2 names, and a
 *    whitespace-only label is the same case by the same argument — AC2 says the row must not render
 *    blank, and `'   '` renders blank. The trim decides WHETHER to fall back and never touches WHAT is
 *    shown, so the row never displays a value that differs from what is stored.
 *  - NOTHING SLICES. A 128-character label is returned whole; the truncation AC4 asks for is CSS
 *    (`.channel-list__host-label`), so the accessible text stays complete.
 *
 * No `console.*`, here or anywhere on this path: the label is operator-typed content, and a fallback is
 * not an event — there is nothing to report that would not carry the value itself.
 */
export function hostRowLabel(value: HostLabelValue): string {
  if (value.status === 'stored' && value.label.trim() !== '') return value.label
  return HOST_ROW_FALLBACK_LABEL
}

/**
 * What the Edit host dialog's field OPENS WITH (#1299) — and deliberately a DIFFERENT collapse from
 * `hostRowLabel` above, not a reuse of it.
 *
 * That one answers "what does the row DISPLAY", turning every non-name outcome into the generic word;
 * this one answers "what is STORED". Seeding the field from the display collapse would put `Server` in an
 * editable box in front of a user who came to name their machine, and a Save on it would store that word
 * as the machine's actual name — the row would then read `Server` because it IS called Server, which is
 * indistinguishable on screen from the state it was in before and undoable only by clearing it again.
 *
 * So `loading`, `not-stored` and `error` all seed EMPTY (AC1's second half): nothing is stored, or nothing
 * could be read, and an empty field says exactly that while leaving Save enabled — a blank name is a valid
 * answer on this dialog, meaning "no label".
 *
 * A `stored` label seeds VERBATIM: no trim, no slice, no fallback on a blank one. The store holds it
 * verbatim and the dialog is where a `'   '` label is fixed, so showing anything else would be showing the
 * user a value that differs from what their machine is actually called. `''` and `'   '` therefore seed
 * exactly themselves, and Save trims — which turns both into the clear.
 *
 * EXPORTED for `hostRowLabel`'s reason: `HostRowControl` below is unreachable from the unit tier (a
 * zustand singleton seeded before `renderToStaticMarkup` is invisible to it), so this is the only seam the
 * four-arm matrix can be proven through.
 */
export function hostRowEditSeed(value: HostLabelValue): string {
  return value.status === 'stored' ? value.label : ''
}

// The host row heading each server's subtree (Figma 106:3094 in 103:2959) — which machine that subtree's
// conversations live on. Since #1070 each section draws ONE OF THESE PER PAIRED SERVER, in pairing order,
// and it is rendered from the paired-server list rather than from the section's rows: a server with no
// conversations in a section shows its row alone, with nothing under it.
//
// That inverts what this paragraph said until #1070, and the inversion is the ticket. The row used to sit
// inside each section's `length > 0` gate, so a zero-row tree rendered neither a header nor a host row —
// which is also what the two promote specs used as their "the row moved sections" proxy. Operator ruling,
// 2026-09-06: every paired machine gets a row in both sections regardless, because this row carries the
// plus that starts a chat in a new workspace (#1185, #1189), and a freshly paired machine has no
// conversations — under the old gate it had no row and so no route to its first chat from the desktop at
// all, the floating button refusing to create while more than one server is paired (#1120). The promote
// specs moved to the row's own affordance as their proxy; see `renderBody`.
//
// The row repeats in BOTH trees on purpose (operator, 2026-08-21); the trees are not deduplicated.
//
// The row wrapper is a plain <div>, with no onClick or aria-label. Healthy hosts put the glyph,
// label and chevron in a disclosure button; failed hosts show the glyph and label directly and
// retain Repair host. Edit host is a sibling control, so neither action nests inside the disclosure.
// The glyph is aria-hidden because the label already names the host.
//
// Host rows have no connection dots at rest, on hover or on focus. `channels.css` reveals Edit host
// on hover or keyboard focus without moving its reserved target or the label; failed rows keep
// Edit and Repair separately clickable. `e2e/host-row-hover-controls.spec.ts` proves the reveal and
// fixed geometry in the running window.
//
// Nullary handlers, `WorkspaceRow`'s `onEdit` shape: the caller closes over the machine it is drawing, so
// `serverId` never becomes an argument this view handles. `() => void` also refuses a function declaring
// a parameter, so React's synthetic event cannot reach a caller's handler and no caller can come to
// depend on it.
//
// THE TWO NAMES ARE COMPILE-TIME CONSTANTS AND DELIBERATELY NOT PROPS — the security decision this
// slice turns on, not a convenience. `WorkspaceRow` bundles `{ label, onCreate }` because its two trees
// say different words; these two say one word each, so a `label` field would buy nothing and would admit
// a caller passing `Edit ${hostLabel}` — untrusted operator text interpolated into an attribute, the
// exact shape #696's review made a MUST FIX. With handlers only, there is no field for a name to arrive
// in. The four declined sinks below therefore hold over the two controls as well: neither carries the
// label in any attribute, and `ChannelList.test.tsx` pins that the label occurs exactly ONCE in the
// two-control render, as the label span's text child.
//
// DOM ORDER IS PEN THEN PLUS, deliberately the reverse of `WorkspaceRow`'s. Both controls are absolutely
// positioned, so order drives neither the layout nor the drawn result (the pen still sits LEFT of the
// plus) — only the tab order. `WorkspaceRow`'s header records its own plus-first order as a stated COST
// forced by `e2e/sidebar-workspace-create.spec.ts`'s single-Tab assertion, not as a preference, and no
// shipped spec constrains the order here; propagating a documented cost for symmetry's sake would be the
// wrong trade. Pinned in `ChannelList.test.tsx` so a reorder fails a unit test rather than nothing.
//
// The class names deliberately share no token — and no substring — with `channel-list__row`, `__row-open`
// or `__section-header`, and the visible label contains neither "Channels" nor "Chats". Playwright locators
// run in strict mode, so an element that JOINS an existing locator's match set raises a strict-mode
// violation rather than an assertion failure; `launchPairedApp.ts:224` clicks an unfiltered
// `.channel-list__row-open` and 28 specs ride that fixture. The two guards are independent, and neither
// requires touching a single file under `e2e/`.
//
// Deliberate asymmetry: the STRUCTURAL naming stays "host" (the design's word, and what #672/#703 stack
// onto) — class names are selectors, not copy. The `label` prop's VALUE is the one thing the user sees.
//
// `HostRow` takes its data as props so the static renderer can exercise every host presentation.
// `HostRowControl` reads the label and status for the saved server identity.
//
// `label` is UNTRUSTED text off disk (`hostLabelHandler.ts:69-71` hands the "escaped text only"
// obligation here) and it goes in as an auto-escaped React CHILD and NOWHERE else. Four sinks are
// declined on purpose, each a MUST FIX if it ever appears — the same four `WorkspaceRow` below declines
// for the same reason, and the first is the live one here:
//   - NO title. The label now ELLIPSIZES (channels.css), which makes `title={label}` ("hover for the
//     rest") the natural next edit; it is the exact shape #696's security review made a MUST FIX. The
//     full name staying undiscoverable on hover is accepted — Settings → Connection is where a machine's
//     details belong.
//   - NO aria-label. The row is not interactive and the text child already names it; an attribute built
//     from the label would interpolate untrusted text into an attribute for no gain.
//   - NO id / key / lookup path derived from it, and no CSS custom property fed from it.
//   - NO log line. Any useful one carries the label — operator content in a log, which ADR 0007's
//     content-free rule and CLAUDE.md both forbid. This row emits none.
//
// The glyph is a sixth inline Material path in this file's existing idiom — the `dns` server-rack, sized
// 12px per the Figma node rather than the 24px the interactive buttons use, so it reads as a level marker
// rather than a control.
// Server identity stays in the container's keyed reads and callbacks; the existing `serverId`
// prop contract is retained without rendering the id into the DOM.
// #1427 — THE POINTER-RELATIVE PLACEMENT OF `.channel-list__control-name`, and the one part of it a
// stylesheet cannot do: the pointer's position is not available to CSS. Eight controls in this file wear
// that pill and all eight spread `controlNamePlacement`, so there is one handler set and no per-control
// wiring. `channels.css` owns the offsets, the mirror arithmetic and the reasons; this owns the numbers
// only CSS cannot see.
//
// SPREADING THIS SET IS NOT THE WHOLE OF GIVING A CONTROL A PILL, and #1441 shipped a cut that assumed it
// was: the eighth wearer arrived with this spread, the markup and the word all correct and its pill still
// invisible, because the `display: none` → `block` trigger in `channels.css` enumerates selectors and had
// never heard of the new token. A new control needs BOTH halves.
//
// ⭐ A DIRECT STYLE WRITE AND NEVER A REACT `style` PROP. `ChannelList.test.tsx` compares whole attribute
// runs on these buttons, and a `style` prop would add a `style` attribute to the static markup and move
// every one of them. Event handlers are not serialized by `renderToStaticMarkup`, so spreading this set
// changes no byte of the static tier — and there is no React state and no re-render per pointer move.
const CONTROL_NAME_POINTER_X = '--control-name-pointer-x'
const CONTROL_NAME_POINTER_Y = '--control-name-pointer-y'
const CONTROL_NAME_MIRROR = '--control-name-mirror'

// The three custom properties the pill inherits, written on the control's own inline style.
//
// THE MIRROR IS MEASURED, NOT DERIVED: the placement is written unmirrored, the pill's own bottom is read
// back — `getBoundingClientRect` forces the style and layout update, so the read is of what was just
// written — and the mirror is set when that bottom has left the window. Probing from unmirrored EVERY
// time is what makes the decision self-correcting per move rather than sticky. Reading the laid-out box
// instead of recomputing it is also what keeps every pixel value for the offsets and for the pill's own
// height out of this file: they are tokens in the stylesheet and literals in the specs, nowhere else.
function placeControlName(control: HTMLElement, x: number, y: number): void {
  control.style.setProperty(CONTROL_NAME_POINTER_X, `${x}px`)
  control.style.setProperty(CONTROL_NAME_POINTER_Y, `${y}px`)
  control.style.setProperty(CONTROL_NAME_MIRROR, '0')
  const pill = control.querySelector<HTMLElement>('.channel-list__control-name')
  if (pill === null) return
  if (pill.getBoundingClientRect().bottom > window.innerHeight) {
    control.style.setProperty(CONTROL_NAME_MIRROR, '1')
  }
}

const controlNamePlacement = {
  // ENTER AS WELL AS MOVE. A `pointermove` is not guaranteed before `:hover` paints the pill, and an
  // unwritten property would leave the stylesheet's fallback placing it off the window's corner rather
  // than off the pointer. Enter seeds before that first paint; the fallback is only the net under it.
  onPointerEnter: (event: PointerEvent<HTMLButtonElement>): void =>
    placeControlName(event.currentTarget, event.clientX, event.clientY),
  onPointerMove: (event: PointerEvent<HTMLButtonElement>): void =>
    placeControlName(event.currentTarget, event.clientX, event.clientY),
  // With no pointer there is no pointer position, so the control's own bottom-right corner takes the same
  // offset — one placement rule for both modalities, and the glyph still uncovered. It YIELDS TO A LIVE
  // POINTER: clicking a control focuses it, and without the guard that focus would jerk the pill off the
  // pointer and onto the corner while the pointer is still sitting on the control.
  onFocus: (event: FocusEvent<HTMLButtonElement>): void => {
    const control = event.currentTarget
    if (control.matches(':hover')) return
    const box = control.getBoundingClientRect()
    placeControlName(control, box.right, box.bottom)
  }
} as const

const ADD_WORKSPACE_CONTROL_LABEL = 'Add workspace'
const EDIT_HOST_CONTROL_LABEL = 'Edit host'

export function HostRow({
  label,
  // #1507 — the row's own fold, as three required props on the pure view. Required rather than optional,
  // `WorkspaceRow`'s stated reason for `hasRows` one level down: every caller knows all three answers, and
  // a default would be a second way to draw a disclosure over nothing. `onToggle` is nullary, this file's
  // standing handler shape, so React's synthetic event cannot reach a caller's handler.
  expanded,
  hasWorkspaces,
  onToggle,
  onAddWorkspace,
  onEditHost,
  failed = false,
  localReadFailed = false,
  onRepair
}: {
  failed?: boolean
  localReadFailed?: boolean
  onRepair?: () => void
  label: string
  serverId: string
  expanded: boolean
  hasWorkspaces: boolean
  onToggle: () => void
  onAddWorkspace?: () => void
  onEditHost?: () => void
}): JSX.Element {
  // The glyph and the label, lifted to two locals because #1507 draws them in two different parents —
  // inside the disclosure on a healthy row, as the row's own children on a failed one. Two inline copies
  // would duplicate a 300-character path and let the two shapes drift.
  const glyph = (
    <svg
      className="channel-list__host-icon"
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20 13H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1zM7 19c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM20 3H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1zM7 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" />
    </svg>
  )
  const name = <span className="channel-list__host-label">{label}</span>
  return (
    <>
      <div className={failed ? "channel-list__host channel-list__host--failed" : "channel-list__host"}>
        {failed ? (
          // ⭐ A FAILED ROW IS NOT A DISCLOSURE, and that is a ruling rather than an omission. The drawing's
          // Pairing Issue variant (486:838) draws no chevron, and this row's server-rack glyph does not
          // swap the way the workspace row's folder does — so a chevron-less host disclosure would be a
          // fold whose state no sighted operator can read, the very shape #1488's estimate declined the
          // chevron-less cut over. It also closes a dead end: a host folded BEFORE it errored would
          // otherwise have its subtree withheld with no mark and no control to re-open it, clearable only
          // by restarting the app. `CollapsibleHostGroup` renders the subtree unconditionally while a host
          // is failed for the same reason, which is why that level reads the status and this one is told.
          //
          // The markup is then byte-identical to what shipped: glyph and label as the row's own children,
          // nothing new in the tab order, and `.channel-list__host--failed`'s three rules still describing
          // exactly the elements they were written against.
          <>
            {glyph}
            {name}
          </>
        ) : (
          // Keep the disclosure separate from the sibling Edit and Repair controls.
          <button
            type="button"
            className="channel-list__host-disclosure"
            aria-expanded={expanded}
            onClick={onToggle}
          >
            {glyph}
            {name}
            {(
              // The fold mark (Chevron 510:2384), DOWN as `WorkspaceRow` draws it; `channels.css` rotates
              // it a quarter turn off this button's own `aria-expanded` for the collapsed state, which is
              // the whole of "one state signal". The art is the workspace row's, REUSED and not
              // re-exported — the same 8 × 4 box its block already derives, and not fetched from Figma,
              // where asset URLs expire. Decorative and silent: the disclosure already says everything, so
              // a name here would be a second voice for one control.
              //
              // The drawing puts a RIGHT-pointing chevron on Idle and Hover while the placement frame
              // (103:2966) shows those same hosts expanded. That orientation is the component's base art,
              // not a claim that a resting host is collapsed; down-when-expanded is the behaviour, matching
              // the row one level down, and a host starts expanded so the shipped sidebar is unchanged on
              // launch. Do not "fix" this to a right chevron on an expanded host.
              <svg
                className="channel-list__host-chevron"
                viewBox="0 0 8 4"
                width="8"
                height="4"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M4.38533 3.8393C4.16311 4.03385 3.80222 4.03385 3.58 3.8393L0.166667 0.850973C-0.0555557 0.656421 -0.0555557 0.340467 0.166667 0.145915C0.388889 -0.048638 0.749779 -0.048638 0.972001 0.145915L3.98356 2.78249L6.99511 0.147471C7.21733 -0.0470815 7.57822 -0.0470815 7.80044 0.147471C8.02267 0.342024 8.02267 0.657977 7.80044 0.85253L4.38711 3.84086L4.38533 3.8393Z" />
              </svg>
            )}
          </button>
        )}
        {failed && onRepair && (
          <button type="button" className="channel-list__host-repair" aria-label="Repair host" onClick={onRepair}>
            <span className="channel-list__host-repair-icon" aria-hidden="true" />
          </button>
        )}
        {onEditHost && (
          // Icon-only control with a client-owned accessible name and a pointer/focus name pill.
          <button
            type="button"
            className="channel-list__host-edit"
            aria-label={EDIT_HOST_CONTROL_LABEL}
            onClick={onEditHost}
            {...controlNamePlacement}
          >
            <svg
              className="channel-list__host-edit-icon"
              viewBox="0 0 12 12"
              width="14"
              height="14"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8.27109 0.495906L7.21875 1.5462L10.4508 4.77193L11.5031 3.72164C11.8219 3.40585 12 2.97544 12 2.52632C12 2.07719 11.8219 1.64678 11.5031 1.33099L10.6664 0.495906C10.35 0.177778 9.91875 0 9.46875 0C9.01875 0 8.5875 0.177778 8.27109 0.495906ZM6.42422 2.33918L1.38047 7.37076C1.12969 7.62105 0.946875 7.9345 0.850781 8.27602L0.0210937 11.2655C-0.0328125 11.4596 0.0210937 11.6702 0.166406 11.8129C0.311719 11.9556 0.520312 12.0117 0.714844 11.9579L3.71016 11.1275C4.05234 11.0316 4.36406 10.8515 4.61719 10.5988L9.65625 5.56491L6.42422 2.33918Z" />
            </svg>
            {/* #1190 — the control's NAME, in the pill the row's trailing controls (#1172), the workspace
                row's own pen and plus (#1180/#1181) and the section header's plus (#1304) already wear.
                APPENDED AFTER the glyph and never before it: `EDIT_ICON_MARKER` pins that <svg>'s whole
                opening run, and a child after the closing tag leaves it byte-identical. The pill's text is
                a bare text node, not an `aria-label="…"` run, so `EDIT_NAME_MARKER` and its counts are
                untouched too.

                THE SAME CONSTANT AS THE `aria-label` ABOVE, read TWICE, so the spoken name and the drawn
                one cannot drift. `aria-hidden` is belt-and-braces rather than the mechanism — the
                `aria-label` already overrides child text for the accessible name — which is why the static
                tier pins it: nothing else would redden if it were dropped. */}
            <span className="channel-list__control-name" aria-hidden="true">
              {EDIT_HOST_CONTROL_LABEL}
            </span>
          </button>
        )}

      </div>
      {localReadFailed && (
        <p className="channel-list__local-read-error" role="status">
          Could not read saved chats on this device.
        </p>
      )}
    </>
  )
}

// The store-bound container reads the keyed host label and renders the pure view.
//
// THE ROW STILL READS AND NEVER WRITES, but the store no longer has one writer (#1299). It has two: the
// loader mounted in `ChannelList` fills every slot on mount, and the Edit host dialog records main's answer
// into one slot on a successful Save. That write is the container's, not this component's, and it is still
// not a two-way binding — nothing here feeds a rendered value back into the store. What HAS changed is that
// a row can now move because a DIALOG asked it to, so a slice changing under this component is no longer
// evidence that a load resolved.
//
// #1299 also gave it the pen. `onEditHost` arrives as a handler taking the machine, and this level closes
// over BOTH the id it was drawn for and the label it is holding, handing `HostRow` the nullary handler that
// row's header requires. The seed is `hostRowEditSeed`'s answer and NOT the `hostRowLabel` one rendered
// beside it — see that function for why the two must differ. Both of a machine's two rows (one per section)
// pass the same id, so either pen opens the same dialog about the same machine.
// Module-private like its neighbour: production renders it from `renderBody` alone, and the unit tier
// reaches everything it can prove through `hostRowLabel` and `HostRow` instead.
// #1199 resolved WHICH server this row is about; #1070 turned that read into the loop's ARGUMENT. The id
// arrives as a prop — this component no longer reads `serverInfoStore` at all, because `renderBody` is
// already iterating the list and a second read here would let one row disagree with the tree drawing it.
//
// TAKEN FROM THE CLIENT'S OWN LIST, NEVER FROM THE WIRE. The id traces back to `serverInfoStore`, filled
// from `window.pyry.serverInfo()`, which main answers out of its paired records — the same rule
// `conversationListStore`'s `selectConversationsFor` header states for its own read. A daemon-supplied
// lookup key would let a confused or hostile server put one machine's name and connection onto another
// machine's row, which is precisely the failure that read exists to prevent. `groupByServer` keeps the
// direction intact one level up: it iterates the client's ids and only ever TESTS a row's stamp against
// them, so a stamp can select among existing keys and can never mint one.
//
// #1308 gave it the PLUS as well, so this level now closes over its machine for both controls and the row
// above is finally drawn as `HostRow` has been able to draw it since #1185. Unlike the pen the plus carries
// NO seed: the dialog's field opens empty, so the closure passes the id alone and this component reads
// nothing extra to build it. Both of a machine's two rows pass the same id, so either plus opens the same
// dialog about the same machine.
// #1507 MOVED THE STATUS READ ONE LEVEL UP, to `CollapsibleHostGroup`, and it arrives here as a prop. Not
// a style choice: that level has to know whether this machine is failed, because a failed host is not a
// disclosure and its subtree must render whatever fold boolean it is holding. Reading the same slice at
// both levels would be two answers where one is needed; threading it is one read, and it cannot disagree
// with the tree drawing the row. The two remaining reads stay here, because nothing above needs them.
function HostRowControl({
  serverId,
  status,
  expanded,
  hasWorkspaces,
  onToggle,
  onEditHost,
  onAddWorkspace,
  onRepairHost
}: {
  onRepairHost?: (serverId: string) => void
  serverId: string
  status: ConnectionStatus | undefined
  expanded: boolean
  hasWorkspaces: boolean
  onToggle: () => void
  onEditHost: (serverId: string, seedLabel: string) => void
  onAddWorkspace: (serverId: string) => void
}): JSX.Element {
  const hostLabel = useHostLabelStore(selectHostLabelFor(serverId))
  const localReadFailed = useConversationListStore(s => s.localListReads.get(serverId) === 'failed')
  return (
    <HostRow
      localReadFailed={localReadFailed}
      failed={status?.type === 'error'}
      expanded={expanded}
      hasWorkspaces={hasWorkspaces}
      onToggle={onToggle}
      onRepair={onRepairHost ? () => onRepairHost(serverId) : undefined}
      label={hostRowLabel(hostLabel)}
      serverId={serverId}
      onEditHost={() => onEditHost(serverId, hostRowEditSeed(hostLabel))}
      onAddWorkspace={status?.type === 'connected' ? () => {
        if (selectStatusFor(serverId)(sessionStore.getState())?.type === 'connected') {
          onAddWorkspace(serverId)
        }
      } : undefined}
    />
  )
}

/**
 * One machine's subtree: its host row, and — while expanded — that machine's workspace groups (#1507).
 *
 * `CollapsibleWorkspaceGroup`'s shape one level up, and its docblock is the authority on every choice
 * repeated here. EXPORTED for that neighbour's stated reason: `renderToStaticMarkup` never re-renders, so
 * rendering this at each `defaultExpanded` value is the only seam through which the unit tier reaches the
 * COLLAPSED shape at all. Production renders it from `renderServerTrees` alone and never passes the seed.
 *
 * `defaultExpanded` is a mount-time SEED and not a controlled prop — React's own `default*` convention, and
 * `ToolRow`'s contract for the same reason: a prop named `expanded` that a re-render could not change would
 * be a quiet lie. A host starts OPEN, so the shipped sidebar looks unchanged on launch.
 *
 * STATE. One boolean, in the component that renders the subtree — no store, no reducer, no context, no
 * lifted map. ADR 0006 picks the lowest scope that resets correctly, and both halves of "the fold is
 * renderer-only and unpersisted" fall out of this scope for free: `PairedShell` renders ChannelList at the
 * SAME element position on both routes on purpose, so React preserves this subtree across the list↔thread
 * flip and a fold survives opening a conversation and coming back — while the whole thing dies with the
 * renderer on app start. Nothing here touches disk, localStorage, IPC or the wire.
 *
 * PER-SERVER and PER-TREE INDEPENDENCE need no key engineering, and are the reason this component takes the
 * `key` the <Fragment> it replaces already carried. React scopes reconciliation per sibling list, so each
 * machine is a keyed sibling holding its own cell, and the two trees are two separate sibling lists in
 * `renderBody` — the same machine's two rows therefore hold two separate booleans. There is nothing to
 * implement for either; there is only something NOT to do, namely lift the state.
 *
 * ⭐ THE STATUS IS READ HERE AND NOT IN `HostRowControl`, because the fold and the row need the same answer.
 * A failed host is not a disclosure (see `HostRow`), so its subtree must render whatever boolean this
 * component happens to be holding — otherwise a host folded before it errored is stranded, its chevron gone
 * with the fold that hid it and no control left to re-open it short of restarting the app.
 *
 * The contents wrapper keeps its children mounted while the host is folded, so each section retains its
 * own local fold state. `display: contents` keeps the open host's row geometry unchanged.
 */
export function CollapsibleHostGroup({
  serverId,
  // #1507 — "has this host any workspace groups in the tree being drawn?", taken as a PROP and never
  // derived from `children`: a host's children are a <Fragment>, which `Children.count` reads as 1 whatever
  // is inside it. `renderServerTrees` already holds the group array before it renders it, so the answer is
  // free there. #1487 rules the other way one level down, where the children ARE the mapped rows; the two
  // are not in conflict.
  hasWorkspaces,
  defaultExpanded = true,
  onEditHost,
  onAddWorkspace,
  onRepairHost,
  children
}: {
  serverId: string
  hasWorkspaces: boolean
  defaultExpanded?: boolean
  onEditHost: (serverId: string, seedLabel: string) => void
  onAddWorkspace: (serverId: string) => void
  onRepairHost: ((serverId: string) => void) | undefined
  children: ReactNode
}): JSX.Element {
  const status = useSessionStore(selectStatusFor(serverId))
  const [expanded, setExpanded] = useState(defaultExpanded)
  const failed = status?.type === 'error'
  return (
    <>
      <HostRowControl
        serverId={serverId}
        status={status}
        expanded={expanded}
        hasWorkspaces={hasWorkspaces}
        // Functional updater, never `setExpanded(!expanded)`: the latter reads a value captured at render
        // and is a check-then-act race against React's batching (ToolRow / UnrecognizedRow / the workspace
        // group below).
        onToggle={() => setExpanded((open) => !open)}
        onEditHost={onEditHost}
        onAddWorkspace={onAddWorkspace}
        onRepairHost={onRepairHost}
      />
      {/* Keep section state mounted across host folds. A failed host still exposes its contents even if
          it was closed before failure; recovery returns to the saved host fold. */}
      <div className="channel-list__host-content" hidden={!expanded && !failed}>{children}</div>
    </>
  )
}

// The workspace row heading each group under a host row (#703, Figma 106:3098) — which workspace the
// group's conversations run in. Visually HostRow one indent deeper: the same 28px rhythm and the same
// type, differing by the 8px deeper left inset that shows the nesting (channels.css) — and, since #704,
// by being a control rather than a plain row.
//
// Unlike the host row's compile-time constant, `label` is DAEMON-derived. Since #1287 it has TWO possible
// sources, and both are untrusted daemon text: the workspace's daemon-held NAME (`workspace_label`,
// preferred when non-null) or, failing that, the last segment of an untrusted `cwd` derived by
// `workspaceLabelFor`. Which one arrived is invisible here on purpose — `groupByWorkspace` resolves it and
// this row renders a `string` — so the handling below covers both and needs no branch. It goes in as an
// auto-escaped React CHILD and nowhere else: never `title=`, never any other attribute, never a URL, never
// a filename or a lookup path (CLAUDE.md 2026-08-20; #696's security review rejected `title={daemonText}`
// as a MUST FIX). Being unbounded untrusted text it also ellipsizes, which the host row's six-character
// constant does not need.
//
// The class names share no token — and no substring — with `channel-list__row`, `__row-open`,
// `__section-header` or `__host`: Playwright locators run in strict mode, so an element JOINING an
// existing locator's match set strict-violates rather than failing an assertion, and
// `launchPairedApp`'s single unfiltered `.channel-list__row-open` click is ridden by 28 specs. The text
// guard is the other half and is fixture-decided here rather than constant-decided: every fake fixture
// seeds `cwd: '/fake/workspace'` AND a null `workspace_label`, so the default tier still renders the
// literal "workspace", which equals none of the suite's `exact: true` strings and carries none of the
// classes its `hasText` locators scope to. A fixture seeding a non-null label opts that spec out of the
// guard and owns picking a string with the same property — `workspace-label.spec.ts` is the one that does.
//
// #704 made the row the DISCLOSURE CONTROL for its group — a real <button> rather than a <div onClick>,
// so keyboard activation (Enter and Space) and screen-reader semantics come for free rather than being
// re-implemented and half-missed (the ToolRow / UnrecognizedRow precedent). Its attribute set is complete
// as written, and four sinks a disclosure control invites are declined ON PURPOSE, each a MUST FIX if it
// ever appears here — the same four ConversationScreen.tsx:657-668 declines for the tool row, recurring
// here sourced from the workspace label and from `group.key`:
//   - NO aria-label. `Collapse ${label}` would interpolate daemon text into an ATTRIBUTE — since #1287
//     that is a daemon-held workspace NAME as readily as a path segment; the decline is unchanged and now
//     covers a second string. The accessible
//     name already comes from the text child plus aria-expanded — a screen reader announces
//     "second-brain, button, expanded", with the glyph aria-hidden and adding nothing to it.
//   - NO aria-controls / id pair. The APG disclosure pattern invites it and the obvious id source is
//     `group.key` — which IS `row.cwd`, a daemon string, forbidden as an attribute value and as a lookup
//     key both. aria-controls is optional in that pattern and both shipped disclosures ship without it.
//     If a future ticket wants one, the id comes from React's useId(), never from the wire.
//   - NO title. `.channel-list__workspace-label` ellipsizes, which makes `title={label}` ("hover for the
//     rest") the natural next edit; it is the exact shape #696's review made a MUST FIX. The full `cwd`
//     staying undiscoverable is #716's problem, not this row's.
//   - NO log line for the toggle. Any useful one carries the label or the `cwd` — daemon content in a
//     log, which ADR 0007's content-free rule and CLAUDE.md both forbid. This row emits none.
//
// The class token stays SOLE — no `--collapsed` modifier, in either state. `ChannelList.test.tsx`'s
// `WORKSPACE_ROW_MARKER` pins `class="channel-list__workspace"` as an EXACT attribute-value substring, so
// a second token would stop matching it and silently zero #703's counts rather than failing them.
//
// #1487 GAVE THE ROW A COLLAPSED APPEARANCE, and it lands exactly where that rule said one would: off
// `[aria-expanded='false']`, never off a class. Two marks read the fold now — the folder glyph, swapped
// here, and a chevron after the label, turned by ONE declaration in `channels.css` keyed to that
// attribute. Which half is done where is the design and not an accident:
//   - THE FOLDER IS A RENDER BRANCH because the two states are two different arts (Font Awesome
//     `folder-open-solid` open, the shipped Material `folder` shut — Juhana's brief, 2026-09-15), and no
//     transform turns one into the other.
//   - THE CHEVRON IS ONE ART AND A ROTATION, so `aria-expanded` stays the SOLE state signal. A second
//     render branch would be a parallel signal free to drift from the attribute a screen reader is told;
//     a rotation reading that attribute cannot. The cost, stated rather than hidden: the drawn DIRECTION
//     is invisible to `renderToStaticMarkup`, so the unit tier pins the attribute and the mark's
//     presence and leaves the turn to one reviewed CSS declaration — the standard this file already
//     holds every other CSS-only visual to, the plus's hover reveal included.
//
// THE CHEVRON IS WITHHELD FROM A GROUP WITH NO ROWS (`hasRows`), a shape #1485's union made reachable in
// production: a workspace with rows in the OTHER tree and none in this one draws its head row here over
// an empty mapped array. That row has nothing to fold, so it shows no fold mark — while staying the
// disclosure button, and while still swapping its folder, because it still folds. The flag is derived
// from `children` one component up rather than threaded from `renderServerTrees`; see
// `CollapsibleWorkspaceGroup`'s docblock for why that is what keeps its call site untouched.
//
// THE GLYPH IS OUT OF FLOW SINCE #1487 and the label carries the row's left padding instead — the redrawn
// component's own construction (Row icon 399:1034, absolutely placed at left 8, top 4). It lands where it
// already landed, 8 in from the wrapper's nest with the label at 30, so this is a change to how the row
// is BUILT and not to where its parts sit; `channels.css` re-derives the sum. The open art is the
// design's own export at 13 × 11. The shut one is the seventh inline Material path in this file's idiom —
// the `folder` shape, its `d` copied from WorkspacePickerSheet's module-local FolderIcon but sized 12px
// to match the host row's level marker rather than that file's 24px control.
//
// #1178 GAVE THE ROW A WRAPPER, and the wrapper is what nests it. The drawing (Workspace 399:1059,
// placed as 405:7456 inside the `pl-[20px]` wrapper 405:7469) runs the row from 20px in from the card's
// content edge to that edge, with its label landing where the channel titles under it already sit. Two
// things force the element rather than a padding:
//   - THE PLUS NEEDS A POSITIONED ANCESTOR THAT IS THE ROW. `.channel-list` is `position: relative` for
//     a stacking reason (channels.css says which), so an absolutely positioned control with no nearer
//     containing block would pin itself to the scroll COLUMN rather than to this row.
//   - THE PLUS CANNOT NEST INSIDE THE DISCLOSURE. An interactive control inside a <button> is invalid
//     and unreachable (#274), so the two are SIBLINGS — which is also the whole of "clicking the plus
//     does not toggle the fold": the click never reaches the disclosure's handler.
// The wrapper holds the HEAD ROW ONLY, never the group's conversation rows: those stay flat siblings of
// `.channel-list`, the ancestry 28 e2e specs click through and the precondition of the adjacent-row rule.
//
// ITS CLASS ENDS IN A TOKEN OF ITS OWN, deliberately. `.channel-list__workspace` does not match
// `channel-list__workspace-head` (class selectors match whole tokens), and `ChannelList.test.tsx` pins
// `class="channel-list__workspace"` WITH its closing quote, so the wrapper cannot silently join either
// locator — the guard `WorkspaceRow`'s comment above states, applied to the element this ticket adds.
//
// The plus is drawn only when `onCreate` is given: the optional-callback shape `Row` already uses for
// `onSaveAsChannel`, and the whole of the per-tree difference. The Chats tree passes it, the Channels
// tree will pass its own (#1179), and the unknown-workspace group is passed none by `renderServerTrees`.
//
// The control's name is `CREATE_CHAT_CONTROL_LABEL`, a client-owned constant — the workspace label goes
// nowhere near it, on the same four-sink rule the disclosure declines above. Its glyph is the design's
// own export (Font Awesome plus, the 16×16 "Icon Edgeless" the Hover variant places at right 2, top 6),
// an eighth inline path in this file's idiom.
//
// #1179 GAVE THE CONTROL A NAME AS WELL AS A HANDLER, and the two arrive as ONE object rather than as
// two parallel optional props. The Channels tree draws the same plus reading "Create channel", so a
// `createLabel?` beside `onCreate?` would admit a handler with no name and a name with no handler, and
// would need a default that silently mislabels one of the two trees. Bundled, the invariant is
// structural: a tree either offers a create — named — or offers none.
//
// #1180 GAVE THE ROW A SECOND TRAILING CONTROL, the pen that opens the Edit-workspace dialog, and it
// arrives as its own optional object rather than as a second field on `create`'s: the two controls are
// independently withheld in principle (a tree could offer one and not the other) and they say different
// words, so bundling them would couple two affordances that differ in everything but position. Its
// `onEdit` is nullary for `create.onCreate`'s reason — `renderServerTrees` closes over the group, so no
// component here handles a `cwd` — and its name is a client-owned constant, so neither the workspace
// label nor the path reaches any of its attributes.
//
// ⭐ IT IS RENDERED AFTER THE PLUS, AND THAT IS FORCED RATHER THAN CHOSEN. Both controls are absolutely
// positioned, so DOM order drives neither the layout nor the drawn result (the pen still sits LEFT of
// the plus). What it drives is the tab order, and `e2e/sidebar-workspace-create.spec.ts` focuses this
// row's disclosure button, presses Tab ONCE and asserts the plus receives focus — a pen inserted before
// the plus takes that Tab and reddens a shipped spec this ticket must leave untouched. The cost, stated
// rather than hidden: a keyboard user reaches the two trailing controls right-to-left. Re-ordering the
// pair is that spec's change to make, not this ticket's, and `ChannelList.test.tsx` pins the order here
// so a future reorder fails a unit test rather than an e2e run.
function WorkspaceRow({
  label,
  expanded,
  // #1487 — does this group have rows in the tree being drawn? It names the FACT rather than the mark,
  // because what it gates is the chevron and what decides it is "is there anything to fold". Required
  // rather than optional: every caller knows the answer (there is one), and a default would be a second
  // way to draw a fold mark over nothing.
  hasRows,
  onToggle,
  create,
  edit
}: {
  label: string
  expanded: boolean
  hasRows: boolean
  onToggle: () => void
  create?: WorkspaceCreateControl
  edit?: WorkspaceEditControl
}): JSX.Element {
  return (
    <div className="channel-list__workspace-head">
      <button
        type="button"
        className="channel-list__workspace"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        {expanded ? (
          // Font Awesome `folder-open-solid` (510:2214), the design's own export at its drawn 13 × 11.
          <svg
            className="channel-list__workspace-icon"
            viewBox="0 0 13 11"
            width="13"
            height="11"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M0.567308 5.6392L0 7.33631V2.52381C0 1.67526 0.689904 0.985352 1.53846 0.985352H4.8726C5.20433 0.985352 5.52885 1.09352 5.79567 1.29304L6.71875 1.98535C6.85096 2.08631 7.01442 2.1392 7.18029 2.1392H10C10.8486 2.1392 11.5385 2.8291 11.5385 3.67766V4.06227H2.75481C1.76202 4.06227 0.879808 4.69689 0.564904 5.6392H0.567308ZM10.7067 10.9854H1.60096C0.8125 10.9854 0.257212 10.2137 0.507212 9.46612L1.66106 6.00458C1.81731 5.53343 2.25962 5.21612 2.75481 5.21612H11.8606C12.649 5.21612 13.2043 5.98776 12.9543 6.73535L11.8005 10.1969C11.6442 10.668 11.2019 10.9854 10.7067 10.9854Z" />
          </svg>
        ) : (
          // The shipped Material `folder`, kept byte for byte at its 12px box and 24-unit viewBox.
          <svg
            className="channel-list__workspace-icon"
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
          </svg>
        )}
        <span className="channel-list__workspace-label">{label}</span>
        {hasRows && (
          // #1487 — the fold mark (Chevron 510:2328), DOWN as drawn; `channels.css` rotates it a quarter
          // turn off the button's `[aria-expanded='false']` for the collapsed state, which is the whole
          // of "one state signal". Decorative and silent: the disclosure it belongs to already says
          // everything, so a name here would be a second voice for one control.
          //
          // The drawn art is 7.967 × 3.985 and the box is the integers it rounds to, so the glyph draws
          // within 0.04px of its export; the ~0.05px the rounded tips reach outside the viewBox clips
          // rather than carrying an `overflow` attribute for a sub-pixel. It is the row's LAST flex item
          // and never shrinks (`channels.css`), so a long `cwd` truncates before it does.
          <svg
            className="channel-list__workspace-chevron"
            viewBox="0 0 8 4"
            width="8"
            height="4"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M4.38533 3.8393C4.16311 4.03385 3.80222 4.03385 3.58 3.8393L0.166667 0.850973C-0.0555557 0.656421 -0.0555557 0.340467 0.166667 0.145915C0.388889 -0.048638 0.749779 -0.048638 0.972001 0.145915L3.98356 2.78249L6.99511 0.147471C7.21733 -0.0470815 7.57822 -0.0470815 7.80044 0.147471C8.02267 0.342024 8.02267 0.657977 7.80044 0.85253L4.38711 3.84086L4.38533 3.8393Z" />
          </svg>
        )}
      </button>
      {create && (
        // Icon-only button — `aria-label` supplies the accessible name (the `.channel-list__save`
        // pattern), since the glyph alone carries no text. Invisible at rest and revealed by the row's
        // hover or by its own keyboard focus; `channels.css` says why that reveal is `opacity` and never
        // `display: none`, and it is what keeps the control focusable and present in the accessibility
        // tree without a prior hover.
        //
        // ONE CLASS FOR BOTH TREES (#1179's builder call). The drawing gives the Workspace component a
        // single trailing plus, so the Channels one is the same 20px box, the same 16px glyph, the same
        // `--color-primary` fill and the same reveal — a second class would restate thirty declarations
        // verbatim. The two are told apart by their accessible NAME alone, which is exactly what the
        // unit tier counts per tree. `create.label` is a client-owned constant in every caller; the
        // workspace label reaches it in none, on the four-sink rule the disclosure declines above.
        <button
          type="button"
          className="channel-list__workspace-create"
          aria-label={create.label}
          onClick={create.onCreate}
          {...controlNamePlacement}
        >
          <svg
            className="channel-list__workspace-create-icon"
            viewBox="0 0 16 16"
            width="16"
            height="16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M6.28571 14.2857V9.71429H1.71429C0.764286 9.71429 0 8.95 0 8C0 7.05 0.764286 6.28571 1.71429 6.28571H6.28571V1.71429C6.28571 0.764286 7.05 0 8 0C8.95 0 9.71429 0.764286 9.71429 1.71429V6.28571H14.2857C15.2357 6.28571 16 7.05 16 8C16 8.95 15.2357 9.71429 14.2857 9.71429H9.71429V14.2857C9.71429 15.2357 8.95 16 8 16C7.05 16 6.28571 15.2357 6.28571 14.2857Z" />
          </svg>
          {/* #1181 — the control's NAME, in the pill `Row`'s two trailing controls already wear
              (#1172). APPENDED AFTER THE GLYPH and never before it: `ChannelList.test.tsx` pins the
              <svg>'s whole opening run, and a child after the closing tag leaves it byte-identical —
              as it leaves the `aria-label` markers #1178 and #1179 count, since the pill's text is a
              bare text node and not an attribute.

              `create.label` and nothing else, which is the whole of "one definition": the same field
              supplies the `aria-label` above, so the spoken name and the drawn one cannot drift. It is
              a client-owned constant in every caller and the workspace label reaches it in none.

              `aria-hidden` is belt-and-braces rather than the mechanism — the `aria-label` already
              overrides child text for the accessible name — which is why the unit tier pins it. */}
          <span className="channel-list__control-name" aria-hidden="true">
            {create.label}
          </span>
        </button>
      )}
      {edit && (
        // #1180 — the pen, the plus's block one control over. Icon-only button: `aria-label` supplies
        // the accessible name since the glyph carries no text, and the value is `edit.label`, read
        // TWICE (here and by the pill below) so the spoken name and the drawn one cannot drift.
        //
        // Its own CSS class rather than the plus's, which is the opposite call #1179 made for the two
        // plusses and for the opposite reason: those two ARE one drawn control differing only in name,
        // where this one is a different size (14 vs 16) at a different inset (28 vs 2), so sharing a
        // class would mean a modifier that overrode half of it. The class ends in a token of its own
        // and carries its closing quote in every marker, so it joins neither `.channel-list__workspace`
        // nor `.channel-list__workspace-create` in a CSS selector or in a unit-tier attribute scan.
        //
        // Invisible at rest and revealed by the ROW's hover or by its own keyboard focus, on the plus's
        // rules verbatim; `channels.css` says why that reveal is `opacity` and never `display: none`.
        <button
          type="button"
          className="channel-list__workspace-edit"
          aria-label={edit.label}
          onClick={edit.onEdit}
          {...controlNamePlacement}
        >
          {/* The drawing's own export (Font Awesome pen, the 14 × 14 "Icon Edgeless" the Hover variant
              places at right 28, top 7.01). The path is `.channel-list__rename-icon`'s — the same glyph
              the conversation row's Rename control already carries — so its 12-unit viewBox is reused
              verbatim and the art is scaled to 14 by the box rather than re-exported at a second size. */}
          <svg
            className="channel-list__workspace-edit-icon"
            viewBox="0 0 12 12"
            width="14"
            height="14"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8.27109 0.495906L7.21875 1.5462L10.4508 4.77193L11.5031 3.72164C11.8219 3.40585 12 2.97544 12 2.52632C12 2.07719 11.8219 1.64678 11.5031 1.33099L10.6664 0.495906C10.35 0.177778 9.91875 0 9.46875 0C9.01875 0 8.5875 0.177778 8.27109 0.495906ZM6.42422 2.33918L1.38047 7.37076C1.12969 7.62105 0.946875 7.9345 0.850781 8.27602L0.0210937 11.2655C-0.0328125 11.4596 0.0210937 11.6702 0.166406 11.8129C0.311719 11.9556 0.520312 12.0117 0.714844 11.9579L3.71016 11.1275C4.05234 11.0316 4.36406 10.8515 4.61719 10.5988L9.65625 5.56491L6.42422 2.33918Z" />
          </svg>
          {/* The plus's name pill (#1181) on the control beside it — same class, same append discipline
              (a child AFTER the closing tag leaves the glyph's opening run byte-identical), same
              reason. `aria-hidden` is belt-and-braces rather than the mechanism: the button's
              `aria-label` already overrides child text for the accessible name. */}
          <span className="channel-list__control-name" aria-hidden="true">
            {edit.label}
          </span>
        </button>
      )}
    </div>
  )
}

/**
 * One workspace group: its row, and — while expanded — that group's conversation rows (#704).
 *
 * EXPORTED for the same reason `ToolRow` is: `renderToStaticMarkup` never re-renders, so this is the only
 * seam through which the unit tier can reach the COLLAPSED shape at all. Production renders it from
 * `renderBody` alone, and never passes `defaultExpanded`.
 *
 * `defaultExpanded` is a mount-time SEED, not a controlled prop — React's own `default*` convention
 * (defaultValue, defaultChecked), and `ToolRow`'s contract for the same reason: a prop named `expanded`
 * that a re-render could not change would be a quiet lie.
 *
 * STATE. One boolean, in the component that renders the group — no store, no reducer, no context, no
 * lifted map. ADR 0006 picks the lowest scope that resets correctly, and both halves of "collapse is
 * renderer-only and unpersisted" fall out of this scope for free: `PairedShell.tsx:124` renders
 * ChannelList at the SAME element position on both routes on purpose, so React preserves this subtree
 * across the list↔thread flip and a fold survives opening a conversation and coming back — while the
 * whole thing dies with the renderer on app start. A store would need manual clearing to get the second
 * half and would break the first. Nothing here touches disk, localStorage, IPC or the wire.
 *
 * PER-TREE INDEPENDENCE needs no key engineering: the two trees are two separate sibling lists in
 * `renderBody`, and React scopes reconciliation per sibling list — so the same `cwd` appearing in both
 * yields two distinct instances holding two distinct cells. There is nothing to implement for it; there
 * is only something NOT to do, namely lift the state.
 *
 * PER-SERVER INDEPENDENCE falls out of the same property since #1070, and needed nothing added for it
 * either: each machine's groups are a sibling list inside that machine's own keyed <Fragment>, so one
 * `cwd` present on two machines yields two instances holding two separate booleans — folding a workspace
 * on Pyrybox leaves the identically-named workspace on Macbook expanded. This is the second reason the
 * group key stayed the raw `cwd` rather than becoming a composite with the server id.
 *
 * Returns a shorthand fragment, emitting NO element of its own — exactly like the keyed <Fragment> it
 * replaced. The rendered sequence under `.channel-list` stays flat (header, host, workspace, rows, …) and
 * every `.channel-list__row` keeps the ancestry 28 e2e specs depend on. No wrapper <div>, no role="group",
 * no <ul>/<li>: PR#717's review NIT proposing grouping semantics across this row, the host row AND the
 * section headers is a separate concern spanning rows this ticket does not touch. If it is ever filed,
 * this component is where the wrapper would go.
 */
export function CollapsibleWorkspaceGroup({
  label,
  defaultExpanded = true,
  create,
  edit,
  children
}: {
  label: string
  defaultExpanded?: boolean
  // #1178, reshaped by #1179 — the trailing create control this group offers, or `undefined` for a
  // group that offers none (the unknown-workspace group, in either tree). Nullary `onCreate`: the `cwd`
  // is closed over by `renderServerTrees`, which is the level that holds the group's key, so this
  // component never handles a daemon-derived path at all. The `label` rides along so the name and the
  // handler cannot drift — see `WorkspaceRow`'s header for why they are one object.
  create?: WorkspaceCreateControl
  // #1180 — the trailing edit control this group offers, or `undefined` for a group that offers none
  // (the unknown-workspace group, in either tree). Pure pass-through, exactly like `create`: nullary
  // `onEdit`, because `renderServerTrees` is the level that holds the group's key and the label, so
  // this component handles neither.
  edit?: WorkspaceEditControl
  children: ReactNode
}): JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded)
  return (
    <>
      <WorkspaceRow
        label={label}
        expanded={expanded}
        // #1487 — "has this group anything to fold?", read off the children this component ALREADY holds
        // rather than taken as a prop. That is the whole reason `renderServerTrees`' heavily-commented
        // call site gains nothing for this ticket: the value it would have passed is `group.rows.length`,
        // and `group.rows.map(renderRow)` is already here. #1488 rules the other way for the host row,
        // whose children are a <Fragment> and cannot be counted — the two are not in conflict.
        //
        // `Children.count` and not `children.length`: `children` is typed `ReactNode`, so the array is a
        // property of today's sole caller rather than of the contract, and the helper reads a single
        // element as 1 without the call site having to wrap it.
        hasRows={Children.count(children) > 0}
        create={create}
        edit={edit}
        // Functional updater, never `setExpanded(!expanded)`: the latter reads a value captured at render
        // and is a check-then-act race against React's batching (ToolRow:746 / UnrecognizedRow:858).
        onToggle={() => setExpanded((open) => !open)}
      />
      {/* The whole of AC1 and AC2: the group's ROWS are withdrawn from the DOM, the row above is not, and
          nothing else happens — no navigation, no command, no store dispatch, no active-conversation
          change. The handler's entire body is the state flip. */}
      {expanded && children}
    </>
  )
}

/** One row as the sidebar sees it: the wire fields plus the server stamp #1086 rides beside them. */
type SidebarRow = ConversationSummary & { readonly serverId?: string | null }

// #1172 — the two trailing controls' names, each a client-owned module-level constant in the
// HOST_ROW_FALLBACK_LABEL / SERVER_ROW_LABEL idiom and never a daemon string. Each is read TWICE, by the
// control's `aria-label` and by the pill that names it on hover, so the two cannot drift: a screen reader
// and a pointer are told the same word by construction rather than by two literals kept in step by hand.
//
// NOT merged with anything. `.conversation`'s own Edit chat entry in the thread overflow menu and
// `EditChannelDialog`'s own title both carry words this one shares, and folding any of them together
// would couple two surfaces' copy across an import for a coincidence of wording — the ruling
// `HOST_ROW_FALLBACK_LABEL` already records for `SERVER_ROW_LABEL`.
//
// #1476 RENAMED THIS CONSTANT WITH ITS VALUE, from `RENAME_CONTROL_LABEL`/'Rename': channels are not
// renamed, they are edited, under their own word and into their own modal (Juhana, 2026-09-14). A
// constant left named for the retired word is exactly the drift this file keeps one-constant-per-control
// to prevent. Its two readers are its declaration and `CHANNELS_ROW_PEN` below; the pen's CLASS TOKENS
// are untouched, twelve specs reading `.channel-list__rename` as "this row is promoted".
const EDIT_CHANNEL_CONTROL_LABEL = 'Edit channel'
const SAVE_AS_CHANNEL_CONTROL_LABEL = 'Save as channel'

// #1441 — the CHATS tree's pen, named in the same idiom and read twice for the same reason. TWO constants
// and not one shared word, unlike `EDIT_WORKSPACE_CONTROL_LABEL` below, because the two trees edit two
// different things: the pen above the divider opens a channel's dialog and the one below it opens a chat's.
// The split is also what #1430 is sequenced after this ticket FOR — it changes the channel word alone, and
// a shared constant would have made that a two-tree change with no way to say so.
const EDIT_CHAT_CONTROL_LABEL = 'Edit chat'

/**
 * A row's trailing pen (#1441): what it is CALLED, which class tokens it wears, and what activating it
 * does, as one value — `WorkspaceEditControl`'s shape one row family down, with the tokens added because
 * the two trees' pens must NOT share a selector.
 *
 * WHY THE TOKENS TRAVEL WITH THE LABEL. Twelve shipped specs locate through `.channel-list__rename`, six
 * of them `real-daemon-*`, and most read it as the proxy for "this row is a promoted Channels row" —
 * counting it, or awaiting it as a bare strict locator. One token on both trees would match a chat row
 * too and pull the real-claude gate into a renderer-only change. They are whole string literals in the
 * two constants below and never an interpolation, so a grep for either token still finds it.
 *
 * Module-private, and the two that exist are built at `renderBody`'s two `renderServerTrees` calls — the
 * single level that tells the two trees apart, which is what keeps both label constants module-local.
 */
type RowPenControl = {
  readonly label: string
  readonly className: string
  readonly iconClassName: string
  readonly onEdit: () => void
}

// The two trees' compile-time halves. The handler is spread on at each call site, where the row is in
// scope; nothing daemon-derived reaches either object.
const CHANNELS_ROW_PEN = {
  label: EDIT_CHANNEL_CONTROL_LABEL,
  className: 'channel-list__rename',
  iconClassName: 'channel-list__rename-icon'
} as const

const CHATS_ROW_PEN = {
  label: EDIT_CHAT_CONTROL_LABEL,
  className: 'channel-list__chat-edit',
  iconClassName: 'channel-list__chat-edit-icon'
} as const

// #1178 — the workspace row's plus, named in the same idiom and for the same reasons. Read once today,
// by the control's `aria-label`; #1181's pill becomes its second reader, which is why it is a constant
// and not a literal at the call site. The words are the client's own and never the workspace label:
// `Create ${label}` would put daemon text in an attribute, which is the MUST FIX #696's review named.
const CREATE_CHAT_CONTROL_LABEL = 'Create chat'

// #1179 — its Channels-tree counterpart, and the reason the plus now travels with a name. Same idiom,
// same client-owned rule, and #1181's pill reads BOTH. The two words differ because the two trees
// create different things: the Chats plus opens confirmation for an unnamed chat, while this one
// opens the named-channel dialog. Both send only after confirmation.
const CREATE_CHANNEL_CONTROL_LABEL = 'Create channel'

/**
 * A workspace row's trailing create control (#1179): what it is CALLED and what clicking it does, as
 * one value. Module-private — nothing outside this file constructs one, and the two that exist are
 * built at `renderBody`'s two `renderServerTrees` calls, which is the single place the two trees are
 * told apart. `onCreate` is nullary below `renderServerTrees`: that level closes over the group's key,
 * so no component underneath handles a daemon-derived path.
 */
type WorkspaceCreateControl = {
  readonly label: string
  readonly onCreate: () => void
}

// #1180 — the pen's name, in the same client-owned idiom and for the same reasons. ONE constant serves
// BOTH trees, unlike `create`'s two: the pen says the same word above the divider and below it, because
// a workspace is the same thing in each and editing it means the same thing. A second constant would be
// two literals kept in step by hand for no distinction. Read TWICE, by the control's `aria-label` and
// by the pill that names it on hover, so a screen reader and a pointer are told the same word by
// construction. The workspace label reaches it in neither tree: `Edit ${label}` would put daemon text
// in an attribute, which is the MUST FIX #696's review named.
const EDIT_WORKSPACE_CONTROL_LABEL = 'Edit workspace'

/**
 * A workspace row's trailing edit control (#1180): what it is CALLED and what clicking it does, as one
 * value — `WorkspaceCreateControl`'s shape one control over, and separate from it because the two
 * differ in name, in size and in inset, so a single object would couple two independent affordances.
 * Module-private; the one that exists is built at `renderBody`'s two `renderServerTrees` calls.
 * `onEdit` is nullary below `renderServerTrees`, which is the level that closes over the group's key
 * AND its label, so no component underneath handles a daemon-derived path or re-derives a name.
 */
type WorkspaceEditControl = {
  readonly label: string
  readonly onEdit: () => void
}

/**
 * One section's rows, grouped by server and then by workspace (#1070) — the level the design has always
 * drawn (103:2959) and the app has never rendered, because the host row came from a single global.
 *
 * Shared by BOTH sections rather than written twice, so the two trees cannot drift: they differ only in
 * which per-row affordance they hand down, which is what `renderRow` carries.
 *
 * WHY THE ROWS ARE SPLIT BY SERVER BEFORE GROUPING, rather than `groupByWorkspace` being re-keyed on
 * `serverId + cwd`. It is the smaller change and it is also the correct one. The grouper's key is the raw
 * `cwd` and a path is unique only WITHIN one machine, so two servers both holding `/home/user/project`
 * would silently merge into one group holding both machines' conversations — but the fix is to hand each
 * machine's rows to their own grouper call, not to fold a client-held id into the value a group is
 * identified by. React scopes keys per sibling list, so each server's subtree living inside its own keyed
 * <Fragment> already makes the raw-`cwd` group keys collision-free across servers, with nothing inside
 * `groupByWorkspace` changed and no composite key to keep in step.
 *
 * The <Fragment> emits no element, exactly like `CollapsibleWorkspaceGroup` below it, so the rendered
 * sequence under `.channel-list` stays the FLAT run of siblings (header, host, workspace, rows, host,
 * workspace, rows) that every `.channel-list__row`'s ancestry depends on across 28 e2e specs. A wrapper
 * <div> per server would instead become a flex item of the `.channel-list` column and move every existing
 * locator's tree position.
 *
 * THE UNATTRIBUTED ROWS RENDER LAST, WITH NO HOST ROW. `ConversationListOrigin` admits `null` and
 * `undefined`, and a stamp naming an unpaired machine is a third shape; #1068 stamps every daemon event
 * main-side so none is reachable in production, but the type allows them and a server-keyed tree has to
 * answer. Dropping such a row hides a real conversation, and filing it under the first paired server would
 * put it under a machine's name on no evidence — the same misattribution the client-held join direction
 * exists to prevent, arrived at by omission instead of by a hostile stamp. Naming no machine is exactly
 * what is known about it.
 */
function renderServerTrees(
  rows: readonly SidebarRow[],
  // #1485 — THE OTHER TREE'S ROWS, which this tree draws workspace HEAD ROWS from and never rows. Data, so
  // it sits beside `rows` and ahead of every callback, where `serverIds` already sits. REQUIRED rather than
  // an optional trailing complement: both call sites supply one, and an optional parameter would be a
  // further way to render a sidebar whose two trees disagree about which workspaces a machine has — the
  // reason `onEditHost` and `onAddWorkspace` were placed ahead of the optional control objects too.
  otherRows: readonly SidebarRow[],
  serverIds: readonly string[],
  statuses: SessionState['statuses'],
  renderRow: (row: SidebarRow) => JSX.Element,
  // #1299 — open the Edit host dialog for one machine. REQUIRED, and placed BEFORE the two optional
  // control objects below rather than beside them: both calls supply it, every host row draws the pen, and
  // an optional parameter ahead of them would be a fourth way to render a sidebar whose pen opens nothing.
  // A bare handler rather than a `{ label, onEdit }` object — the pen's accessible name is a compile-time
  // constant inside `HostRow` and is deliberately NOT a prop (#1185's security decision, which stands), so
  // there is no per-tree label to carry and no field for a name to arrive in.
  onEditHost: (serverId: string, seedLabel: string) => void,
  // #1308 — open the Add workspace dialog for one machine. REQUIRED and placed beside `onEditHost` rather
  // than among the optional control objects below, for that parameter's stated reason: both calls supply
  // it, every host row draws the plus, and an optional parameter would be a further way to render a
  // sidebar whose plus opens nothing. A bare handler rather than a `{ label, onCreate }` object — the
  // plus's accessible name is a compile-time constant inside `HostRow` and is deliberately NOT a prop
  // (#1185's security decision, which stands), so there is no per-tree label to carry.
  onAddWorkspace: (serverId: string) => void,
  onRepairHost: ((serverId: string) => void) | undefined,
  // #1178, reshaped by #1179 — the trailing create control this tree draws on each of its workspace
  // rows, or `undefined` for a tree that offers none. OPTIONAL and trailing, which is what carries the
  // per-tree difference now that ONE helper draws both trees: BOTH calls supply one since #1179, and
  // they differ in the two fields of this object alone. `onCreate` takes the `cwd` rather than the
  // group, so the caller states exactly what crosses this seam.
  create?: { readonly label: string; readonly onCreate: (cwd: string, serverId: string | undefined) => void },
  // #1180 — the trailing edit control this tree draws on each of its workspace rows. OPTIONAL and
  // trailing like `create`, but BOTH calls supply the SAME object: the pen is not a per-tree
  // difference, which is why its label is one constant rather than two. `onEdit` takes the group's
  // `cwd` AND its resolved label, so the caller states exactly what crosses this seam — the path the
  // rename will name, and the string the dialog's field is seeded from.
  edit?: { readonly label: string; readonly onEdit: (cwd: string, label: string, serverId: string | undefined) => void }
): JSX.Element {
  const { servers, unattributed } = groupByServer(serverIds, rows)
  // #1485 — THE COMPLEMENT, SPLIT BY THE SAME HOSTS BEFORE IT REACHES `groupByWorkspace`, and that split is
  // the security property rather than tidiness. A workspace row's plus and pen route by the host the row is
  // drawn under, while the group key is a bare path that repeats across machines. Handing the whole
  // other tree to the grouper would draw one machine's directory under another; its create control
  // could then target the wrong host. `groupByServer` is called with the SAME client-held `serverIds`, so
  // its docblock's join direction holds here unchanged: a row's stamp can select among existing keys and
  // can never mint one.
  //
  // A `Map` keyed by id rather than index parity between two arrays. Both calls are built from one
  // `serverIds` in one order, so `servers[i]` and the complement's `servers[i]` do agree today — which is
  // exactly the kind of agreement that is true until someone filters one of them. The complement's OWN
  // `unattributed` is discarded; see the `workspaceGroups(unattributed)` call at the bottom.
  const otherByServer = new Map(
    groupByServer(serverIds, otherRows).servers.map((s) => [s.serverId, s.rows])
  )
  const workspaceGroups = (
    serverRows: readonly SidebarRow[],
    serverId?: string,
    // #1485 — this host's complement. Defaulted to empty for the unattributed run alone, which passes
    // none; every host passes one.
    otherServerRows: readonly SidebarRow[] = []
  ): JSX.Element[] =>
    // `key={group.key}` pins the fold's IDENTITY as well as its position: a group whose rows change
    // (renamed, added, archived) or whose position moves keeps its instance and its fold, because React
    // reconciles by key and not by index. A group that leaves the list is unmounted and its fold is
    // discarded — correct for ephemeral disclosure state. The two key namespaces cannot collide: React
    // scopes keys per sibling list, so the group keys (cwd strings) and the row keys (c.id) never share
    // one, and neither shares one with the server fragments a level up.
    // #1485 — the group set is the UNION of this host's rows in both trees. A group with no rows here still
    // draws its head row, its plus and its pen, and `CollapsibleWorkspaceGroup` renders `{expanded &&
    // children}` over an empty mapped array, so it expands to nothing with no branch added there.
    groupByWorkspace(serverRows, otherServerRows).map((group) => (
      <CollapsibleWorkspaceGroup
        key={group.key}
        label={group.label}
        // The plus remains under a workspace row until #1683 relocates it, but the container uses only
        // the clicked host; both creates send `cwd: null`. Keep the unknown-workspace group and
        // disconnected hosts without a plus in the current hierarchy.
        create={
          create === undefined || group.key === UNKNOWN_WORKSPACE_KEY || serverId === undefined || statuses.get(serverId)?.type !== 'connected'
            ? undefined
            : { label: create.label, onCreate: () => create.onCreate(group.key, serverId) }
        }
        // #1180 — the pen, withheld on exactly the same terms and by the same test. Its key is
        // `UNKNOWN_WORKSPACE_KEY`, the empty string, which names no directory, so a rename sent with
        // it would address nothing; and the test is on the KEY, never on the label, so a real
        // directory named "Unknown workspace" is an ordinary group and keeps its pen.
        //
        // The closure passes the group's key AND its LABEL. The key travels VERBATIM — daemon-asserted
        // text making a round trip back out as a command field, so echoing exactly what was received
        // is the only safe handling, and main re-validates it at the untrusted IPC boundary. The label
        // is `groupByWorkspace`'s resolved display string (the daemon's `workspace_label` when there is
        // one, the folder segment otherwise) and it is passed rather than re-derived so the dialog's
        // field cannot disagree with the row about what the workspace is currently called.
        edit={
          edit === undefined || group.key === UNKNOWN_WORKSPACE_KEY || serverId === undefined || statuses.get(serverId)?.type !== 'connected'
            ? undefined
            : { label: edit.label, onEdit: () => edit.onEdit(group.key, group.label, serverId) }
        }
      >
        {group.rows.map(renderRow)}
      </CollapsibleWorkspaceGroup>
    ))
  return (
    <>
      {servers.map((server) => {
        // #1507 — the groups are built into a LOCAL before they are rendered, which is the whole of the
        // has-workspaces plumbing: this level already knows each host's group set, so the answer is
        // `groups.length` and never a count of the fragment those groups are handed to. The keyed
        // <Fragment> that stood here IS the group component now, carrying the same `key` for the same
        // reason — it pins each machine's fold to its identity rather than to its position.
        const groups = workspaceGroups(
          server.rows,
          server.serverId,
          otherByServer.get(server.serverId) ?? []
        )
        return (
          <CollapsibleHostGroup
            key={server.serverId}
            serverId={server.serverId}
            hasWorkspaces={groups.length > 0}
            onEditHost={onEditHost}
            onAddWorkspace={onAddWorkspace}
            onRepairHost={onRepairHost}
          >
            {groups}
          </CollapsibleHostGroup>
        )
      })}
      {/* THE UNATTRIBUTED RUN TAKES NO COMPLEMENT (#1485). These rows name no machine, so a union here
          would merge two UNKNOWN machines' paths — precisely the cross-host merge the per-host split above
          exists to prevent, arrived at by omission instead of by a hostile stamp. #1068 stamps every daemon
          event main-side, so the bucket is unreachable in production anyway. */}
      {workspaceGroups(unattributed)}
    </>
  )
}

// Client-owned copy supplies both the accessible name and the visible tooltip.
const PAIR_NEW_HOST_CONTROL_LABEL = 'Pair new host'

function PairNewHostButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="channel-list__pair"
      aria-label={PAIR_NEW_HOST_CONTROL_LABEL}
      onClick={onClick}
      {...controlNamePlacement}
    >
      <span className="channel-list__pair-icon" aria-hidden="true" />
      <span className="channel-list__control-name" aria-hidden="true">
        {PAIR_NEW_HOST_CONTROL_LABEL}
      </span>
    </button>
  )
}

function HostSection({
  label,
  rows,
  onCreate,
  defaultExpanded = true
}: {
  label: 'Channels' | 'Chats'
  rows: readonly JSX.Element[]
  onCreate?: () => void
  defaultExpanded?: boolean
}): JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded)
  return (
    <>
      <div className="channel-list__section">
        <button
          type="button"
          className="channel-list__section-disclosure"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? (
            <svg className="channel-list__section-icon" viewBox="0 0 13 11" width="13" height="11" fill="currentColor" aria-hidden="true">
              <path d="M0.567308 5.6392L0 7.33631V2.52381C0 1.67526 0.689904 0.985352 1.53846 0.985352H4.8726C5.20433 0.985352 5.52885 1.09352 5.79567 1.29304L6.71875 1.98535C6.85096 2.08631 7.01442 2.1392 7.18029 2.1392H10C10.8486 2.1392 11.5385 2.8291 11.5385 3.67766V4.06227H2.75481C1.76202 4.06227 0.879808 4.69689 0.564904 5.6392H0.567308ZM10.7067 10.9854H1.60096C0.8125 10.9854 0.257212 10.2137 0.507212 9.46612L1.66106 6.00458C1.81731 5.53343 2.25962 5.21612 2.75481 5.21612H11.8606C12.649 5.21612 13.2043 5.98776 12.9543 6.73535L11.8005 10.1969C11.6442 10.668 11.2019 10.9854 10.7067 10.9854Z" />
            </svg>
          ) : (
            <svg className="channel-list__section-icon" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
            </svg>
          )}
          <span className="channel-list__section-label">{label}</span>
          <svg className="channel-list__section-chevron" viewBox="0 0 8 4" width="8" height="4" fill="currentColor" aria-hidden="true">
            <path d="M4.38533 3.8393C4.16311 4.03385 3.80222 4.03385 3.58 3.8393L0.166667 0.850973C-0.0555557 0.656421 -0.0555557 0.340467 0.166667 0.145915C0.388889 -0.048638 0.749779 -0.048638 0.972001 0.145915L3.98356 2.78249L6.99511 0.147471C7.21733 -0.0470815 7.57822 -0.0470815 7.80044 0.147471C8.02267 0.342024 8.02267 0.657977 7.80044 0.85253L4.38711 3.84086L4.38533 3.8393Z" />
          </svg>
        </button>
        {onCreate && (
          <button
            type="button"
            className="channel-list__section-create"
            aria-label={label === 'Channels' ? CREATE_CHANNEL_CONTROL_LABEL : CREATE_CHAT_CONTROL_LABEL}
            onClick={onCreate}
            {...controlNamePlacement}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M6.28571 14.2857V9.71429H1.71429C0.764286 9.71429 0 8.95 0 8C0 7.05 0.764286 6.28571 1.71429 6.28571H6.28571V1.71429C6.28571 0.764286 7.05 0 8 0C8.95 0 9.71429 0.764286 9.71429 1.71429V6.28571H14.2857C15.2357 6.28571 16 7.05 16 8C16 8.95 15.2357 9.71429 14.2857 9.71429H9.71429V14.2857C9.71429 15.2357 8.95 16 8 16C7.05 16 6.28571 15.2357 6.28571 14.2857Z" />
            </svg>
            <span className="channel-list__control-name" aria-hidden="true">
              {label === 'Channels' ? CREATE_CHANNEL_CONTROL_LABEL : CREATE_CHAT_CONTROL_LABEL}
            </span>
          </button>
        )}
      </div>
      {expanded && rows}
    </>
  )
}

function renderBody(
  conversations: readonly SidebarRow[] | null,
  statuses: SessionState['statuses'],
  serverIds: readonly string[],
  openConversationId: string | null,
  onOpen: (row: ConversationSummary) => void,
  onCreateChat: (cwd: string, serverId: string | undefined) => void,
  onCreateChannel: (cwd: string, serverId: string | undefined) => void,
  _onEditWorkspace: (cwd: string, label: string, serverId: string | undefined) => void,
  onEditHost: (serverId: string, seedLabel: string) => void,
  onAddWorkspace: (serverId: string) => void,
  onRepairHost: ((serverId: string) => void) | undefined,
  onSaveAsChannel: (row: SidebarRow) => void,
  onRename: (row: SidebarRow) => void,
  onEditChannel: (row: SidebarRow) => void
): JSX.Element | null {
  const { channels, discussions } = partitionActive(conversations ?? [])
  if (serverIds.length === 0 && channels.length === 0 && discussions.length === 0) return null
  const hostedChannels = groupByServer(serverIds, channels)
  const hostedChats = groupByServer(serverIds, discussions)
  const chatsByHost = new Map(hostedChats.servers.map((host) => [host.serverId, host.rows]))
  const channelRow = (row: SidebarRow): JSX.Element => (
    <Row
      key={row.id}
      row={row}
      isOpen={row.id === openConversationId}
      onOpen={() => onOpen(row)}
      pen={typeof row.serverId === 'string' && statuses.get(row.serverId)?.type === 'connected'
        ? { ...CHANNELS_ROW_PEN, onEdit: () => onEditChannel(row) }
        : undefined}
    />
  )
  const chatRow = (row: SidebarRow): JSX.Element => (
    <Row
      key={row.id}
      row={row}
      isOpen={row.id === openConversationId}
      onOpen={() => onOpen(row)}
      onSaveAsChannel={typeof row.serverId === 'string' && statuses.get(row.serverId)?.type === 'connected'
        ? () => onSaveAsChannel(row)
        : undefined}
      pen={typeof row.serverId === 'string' && statuses.get(row.serverId)?.type === 'connected'
        ? { ...CHATS_ROW_PEN, onEdit: () => onRename(row) }
        : undefined}
    />
  )
  return (
    <>
      {hostedChannels.servers.map((host) => {
        const connected = statuses.get(host.serverId)?.type === 'connected'
        return (
          <CollapsibleHostGroup
            key={host.serverId}
            serverId={host.serverId}
            hasWorkspaces
            onEditHost={onEditHost}
            onAddWorkspace={onAddWorkspace}
            onRepairHost={onRepairHost}
          >
            <HostSection
              label="Channels"
              rows={host.rows.map(channelRow)}
              onCreate={connected ? () => onCreateChannel('', host.serverId) : undefined}
            />
            <HostSection
              label="Chats"
              rows={(chatsByHost.get(host.serverId) ?? []).map(chatRow)}
              onCreate={connected ? () => onCreateChat('', host.serverId) : undefined}
            />
          </CollapsibleHostGroup>
        )
      })}
      {hostedChannels.unattributed.length > 0 && (
        <HostSection label="Channels" rows={hostedChannels.unattributed.map(channelRow)} />
      )}
      {hostedChats.unattributed.length > 0 && (
        <HostSection label="Chats" rows={hostedChats.unattributed.map(chatRow)} />
      )}
    </>
  )
}

/**
 * One row's status dot (#801 / #874, Figma 103:2968) — the first consumer of both #800's leaf and #799's
 * resolver, and the answer to the question `conversationUnread.ts:81` left open: WHERE the two-store
 * unread composition lives. Here, per row, keyed by THE ROW'S OWN conversation id.
 *
 * Read the four narrow per-id slices, reduce them to one status, render the dot. That is the whole body.
 * A store-bound `*Control` sits beside a store-free
 * leaf — and it lives HERE rather than in `ConversationStatusDot.tsx` because that file declares itself
 * store-free in its own header.
 *
 * WHY PER-ROW AND NOT LIFTED. Hooks cannot be called from `renderBody`'s `.map()` callbacks (:558, :589),
 * so a per-row component is the only place these subscriptions can go — and it is also where they belong:
 * `conversationActivityStore`'s write path keeps every other conversation's held entry referentially
 * identical (conversationActivityStore.ts:124-127) and all three selectors hand back the HELD reference or
 * `null`, so a write for conversation A wakes A's dot and nothing else. Sitting here rather than in `Row`,
 * a status flip re-renders one <span> and not the row's title or icon buttons. The blink is
 * compositor-owned, so a working dot costs zero React renders.
 *
 * Five things this must not become, none of them a type error:
 *
 *   - THE FOUR SUBSCRIPTIONS MERGED INTO ONE SELECTOR returning
 *     `{ inputRequired, activity, timeline, lastRead }`. Three of the shipped selectors return a held
 *     reference or `null`, which is what keeps `useSyncExternalStore` stable; a selector building an
 *     object returns a fresh one every call and loops. The ban holds for `selectHasOutstandingFor` too but
 *     for a DIFFERENT reason, and the argument above must not be restated as though it covered it: that
 *     selector returns a plain `boolean`, which is perfectly value-stable on its own — it is the MERGED
 *     OBJECT that would be freshly allocated regardless of what its fields are, so the boolean's stability
 *     buys nothing there.
 *   - THE TWO PURE CALLS MOVED INSIDE A SELECTOR. Same reason, plus it would drag both runtime-free
 *     modules into the stores' read path — the graph property both their headers are built around.
 *   - A `useMemo`, A COMBINED SNAPSHOT OR A COMBINED STORE. `conversationUnread.ts:78-84` rules that
 *     reading two stores back to back in a single-threaded renderer is not a torn read, and rules out a
 *     merged snapshot by name. Two function calls per row per render is not a cost to design around. The
 *     `useMemo`-stable selector idiom at ConversationScreen.tsx:147 does not transfer either: there the id
 *     CHANGES over the component's life, whereas `Row` is keyed by `c.id` so a row instance's id is fixed
 *     for its whole life — and a fresh selector closure costs one allocation and one `Object.is`
 *     comparison, never a re-subscription (`api.subscribe` is what React watches) and never a re-render.
 *   - THE `conversationId` ANYWHERE BUT THE FOUR SELECTOR FACTORIES. It is daemon-asserted, so it stays a
 *     `Map` key: never a class-name interpolation, never an attribute value, never a `title`, never an
 *     object key, never a log line. Both upstream headers state this as a condition of their signatures.
 *   - A `console.*` ON ANY PATH. Both source stores and both pure modules are log-free by construction,
 *     and there is no read miss to report — `null` is a defined reading, not an error.
 *
 * The cost of these separate per-row reads:
 * `ChannelListView` drifts further from its "pure view" docstring, since its subtree now reads four more
 * singletons. Safe under `renderToStaticMarkup` in Node — the activity and timeline stores hydrate to
 * empty maps, the modal store hydrates to `initialModalState` with an empty `outstanding`
 * (modalPrompts.ts:226), and the last-read store's `localStorage` port short-circuits on
 * `typeof window === 'undefined'` (conversationLastReadStore.ts:246-257) — so every unseeded row
 * server-renders as `idle`.
 */
function ConversationStatusDotControl({
  conversationId
}: {
  conversationId: string
}): JSX.Element {
  const promptPending = useModalStore(selectHasOutstandingFor(conversationId))
  // #1700: a pending question batch waits on the operator exactly as a prompt does. The selector returns
  // a plain boolean, value-stable under `Object.is`, never the held batch or a fresh object.
  const questionPending = useQuestionBatchStore(
    (s) => selectBatchFor(conversationId)(s) !== undefined
  )
  const activity = useConversationActivityStore(selectActivityFor(conversationId))
  const timeline = useConversationTimelineStore(selectTimelineFor(conversationId))
  const lastRead = useConversationLastReadStore(selectLastReadFor(conversationId))
  return (
    <ConversationStatusDot
      status={resolveConversationStatus(
        promptPending || questionPending,
        activity,
        isConversationUnread(timeline, lastRead)
      )}
    />
  )
}

// One row, identical in both sections. React key is `row.id` (a stable per-conversation identity — a
// real key is available here, unlike the timeline's array-index keying). `name` is an untrusted
// daemon-derived string rendered as an auto-escaped React child (never dangerouslySetInnerHTML) —
// displayed as opaque text, and since #1097 the row's ONLY text child.
//
// #1097 — the desktop row (node 103:2968) is a label and nothing else: the trailing last-activity time
// this row used to draw is DELETED, not hidden, so the row reads no clock and takes no `now`. The 24px
// height is derived in `channels.css` from the label's line box plus the row's padding, never declared.
// Until #1171 that also set the two trailing affordances' glyph size, since a taller one would have held
// the centred flex line open; #1171 lifted them out of the flow altogether, so the derived 24 now answers
// to the button alone and `e2e/sidebar-row-geometry.spec.ts` pins each control's box directly instead.
//
// The open action is its own button; the optional trailing affordances (Save-as-channel #274, Rename
// #360) are SIBLINGS, not nested controls — an interactive control cannot nest inside a <button>. Since
// #1171 that sibling relation is also why the row's hover FILL sits on the wrapper: a fill on the button
// would drop the moment the pointer crossed onto a control that is not its child.
// `.channel-list__row` is a flex wrapper; the old row button-reset/hover/focus rules now live on
// `.channel-list__row-open`. The two affordances USED to be disjoint by section — Recent rows drew the
// chevron alone and saved Channel rows the pen alone, so no row carried two trailing buttons. #1441 ended
// that: a Chats row draws BOTH, the chevron moved 20px inside the pen to make room, and `Row` therefore
// has to place two controls in one row's trailing band rather than one. A Channels row still draws one.
//
// #448 resolved the old "conversation-agnostic onOpen" interim: each row now passes ITSELF up through
// onOpen, and PairedShell records it as the active conversation before navigating — so the thread's
// wire actions (send, snapshot, dequeue) target the clicked conversation's real id. The Row keeps a
// nullary onOpen prop; the map site closes over the row (the onSaveAsChannel/onRename pattern).
// #1098 — the row of the chat the pane is showing carries the design's fill (node 103:2969). The STATE
// is `aria-current` on the open button, never a modifier class, and it goes on the BUTTON rather than
// on the wrapper. Three reasons, in order of weight:
//
//   - IT IS AN AFFORDANCE, NOT DECORATION. `aria-current` announces the open chat to a screen reader
//     ("leaky-faucet, button, current"); a class announces nothing. That is also why it lands on the
//     element a keyboard user actually reaches — on the role-less wrapper <div> the same attribute
//     would only be met by browse-mode traversal of a generic container.
//   - AC5 THEN HOLDS BY CONSTRUCTION, on the open row too. `ChannelList.test.tsx` matches whole
//     attribute runs (`class="channel-list__row"`, `…__row-open"`, `…__title"`) and `rowChunksIn`
//     SPLITS the render on the first of them — so a marker that stopped matching would yield zero
//     chunks and pass every #801 `for` loop VACUOUSLY rather than failing one. An attribute after the
//     class leaves all three runs byte-identical; a `--open` token would arm that trap.
//   - IT IS THE RULING THIS FILE ALREADY MADE one row-family element over: `WorkspaceRow` keeps its
//     class token sole and styles its collapsed state off `[aria-expanded='false']`, for exactly that
//     silent-zeroing reason.
//
// `undefined` OMITS the attribute rather than emitting `aria-current="false"` on every other row — the
// shape all four shipped consumers use (ComposerOptionsPanel, ComposerModelMenu,
// ComposerSlashCommandTypeAhead, QuestionPanel). Its value is the client-owned literal 'true'; the
// conversation id never reaches it.
//
// The FILL itself is `channels.css`'s and sits on `.channel-list__row`, selected through `:has()`: the
// button is a `flex: 1 1 auto` SIBLING of the trailing affordances, not their parent, so a fill on it
// would stop short and leave an unfilled tail on any row carrying Save-as-channel or Rename.
function Row({
  row,
  isOpen,
  onOpen,
  onSaveAsChannel,
  pen
}: {
  row: ConversationSummary
  isOpen: boolean
  onOpen: () => void
  onSaveAsChannel?: () => void
  // #1441 — the bare `onRename` became a `RowPenControl`: BOTH trees draw a pen now, and they differ in
  // the word and in the class tokens, so the handler alone no longer says which pen this is.
  pen?: RowPenControl
}): JSX.Element {
  return (
    <div className="channel-list__row">
      {/* #801 — the status dot, LEADING the row and a SIBLING of the open button, not a child of it. The
          dot ships a named `role="img"` for all three statuses, so nesting it would fold "Idle" — and,
          as the daemon works, "Assistant working" — into the button's accessible name, mutating what
          should say what activating it does. RunConfigSections.tsx:270-280 already declined exactly this
          for the unselected radios. As a sibling the dot stays fully announced in reading order while the
          button's name stays the row's title — since #1097 that is the button's whole text, where it used
          to read title + time. `channels.css` positions it absolutely at the drawing's 8px inset (16 until
          #1171) so the
          button still spans the row and its hover/focus rectangles are unchanged; nothing about
          `.channel-list__row` / `__row-open`'s class tokens or ancestry moves (AC4). */}
      <ConversationStatusDotControl conversationId={row.id} />
      <button
        type="button"
        className="channel-list__row-open"
        // Nothing may be inserted between `className` and `aria-current`: the unit tier compares this
        // tag against a resting row's as an equality, and `channels.css` selects on the pair.
        aria-current={isOpen ? 'true' : undefined}
        onClick={onOpen}
      >
        <span className="channel-list__title">{titleFor(row.name)}</span>
      </button>
      {onSaveAsChannel && (
        // Icon-only button — `aria-label` supplies the accessible name (the .channel-list__save pattern),
        // since the glyph alone carries no text. Since #1171 the glyph is the drawing's own export for
        // the CHATS tree: a bold chevron-up, replacing the Material bookmark that stood in. The layer it
        // comes from is named `circle-chevron-up-solid`, but the drawing draws the chevron ALONE — there
        // is no circle, and none is added here.
        //
        // Its art is 12.12 × 7.2 where the pen's is a 12-unit square, so this is the one glyph whose
        // viewBox does not start at the origin. `-2.46` centres the art in the 12px box the drawing
        // gives it (12.12 - 7.2 = 4.92, half above and half below) using the viewBox's own y origin, so
        // the exported path stays byte-identical rather than being re-based by hand. The drawing's 22.5%
        // top and 17.5% bottom insets round to centred, which is the ruling this reproduces.
        <button
          type="button"
          className="channel-list__save"
          aria-label={SAVE_AS_CHANNEL_CONTROL_LABEL}
          onClick={onSaveAsChannel}
          {...controlNamePlacement}
        >
          <svg
            className="channel-list__save-icon"
            viewBox="0 -2.46 12.12 12.12"
            width="12"
            height="12"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M11.7859 5.26026C12.2311 5.70553 12.2311 6.42553 11.7859 6.86605C11.3406 7.30658 10.6206 7.31132 10.1801 6.86605L6.05902 2.745L1.93796 6.86605C1.4927 7.31132 0.7727 7.31132 0.332173 6.86605C-0.108353 6.42079 -0.11309 5.70079 0.332173 5.26026L5.24902 0.333947C5.69428 -0.111316 6.41428 -0.111316 6.85481 0.333947L11.7859 5.26026Z" />
          </svg>
          {/* The Rename control's pill above, on the other tree's affordance — same class, same append
              discipline, same reason. The two blocks are verbatim but for the word, which is this file's
              shipped idiom for these two controls (`.channel-list__rename` restates `.channel-list__save`
              declaration for declaration in `channels.css`, and its comment says why). */}
          <span className="channel-list__control-name" aria-hidden="true">
            {SAVE_AS_CHANNEL_CONTROL_LABEL}
          </span>
        </button>
      )}
      {pen && (
        // Icon-only button — `aria-label` supplies the accessible name (the .channel-list__save pattern),
        // since the glyph alone carries no text. Since #1171 the glyph is the DRAWING'S OWN export
        // (Font Awesome `pen-solid`, the "Icon Edgeless" instance the Hover variant places at 12×12),
        // replacing the Material `edit` pencil that stood in while no Figma node pinned this control.
        //
        // The control is invisible at rest and revealed by the ROW's hover or by its own keyboard focus
        // (`channels.css` says why the reveal is `opacity` and never `display: none`).
        //
        // #1441 — ONE BLOCK DRAWS BOTH TREES' PENS. Juhana's 2026-09-14 drawing instances the same Channel
        // row component in the Chats section, so the glyph, the box, the pill's append discipline and the
        // `controlNamePlacement` spread are identical in both; only the word and the two class tokens
        // differ, and those arrive in `pen`. The CSS is restated per tree because two selectors is the only
        // way to have two tokens; the markup is not, because one element with a parameterized token is —
        // and a second block would be the thing that lets the two pens drift apart.
        //
        // IT IS EMITTED AFTER THE CHEVRON. Both controls are absolutely positioned, so this changes no
        // layout — but on a chat row the chevron sits 20px to the LEFT of the pen, and emitting it first
        // is what makes the tab order and the reading order follow the visual one. A Channels row's markup
        // is byte-identical either way, only one of the two blocks rendering there.
        <button
          type="button"
          className={pen.className}
          aria-label={pen.label}
          onClick={pen.onEdit}
          {...controlNamePlacement}
        >
          <svg
            className={pen.iconClassName}
            viewBox="0 0 12 12"
            width="12"
            height="12"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8.27109 0.495906L7.21875 1.5462L10.4508 4.77193L11.5031 3.72164C11.8219 3.40585 12 2.97544 12 2.52632C12 2.07719 11.8219 1.64678 11.5031 1.33099L10.6664 0.495906C10.35 0.177778 9.91875 0 9.46875 0C9.01875 0 8.5875 0.177778 8.27109 0.495906ZM6.42422 2.33918L1.38047 7.37076C1.12969 7.62105 0.946875 7.9345 0.850781 8.27602L0.0210937 11.2655C-0.0328125 11.4596 0.0210937 11.6702 0.166406 11.8129C0.311719 11.9556 0.520312 12.0117 0.714844 11.9579L3.71016 11.1275C4.05234 11.0316 4.36406 10.8515 4.61719 10.5988L9.65625 5.56491L6.42422 2.33918Z" />
          </svg>
          {/* #1172 — the name pill, APPENDED after the glyph and never inserted before it: the unit tier
              asserts each `<svg …>` opening run whole, and a child after the closing tag leaves both
              byte-identical (the append discipline #1265 records for the composer's own pill). Hidden by
              `channels.css` until this control's own `:hover` or `:focus-visible` — the CONTROL's, not
              the row's, which is the whole of "hovering the title alone shows no pill".

              `aria-hidden` is belt-and-braces rather than the mechanism: the button's `aria-label`
              already overrides child text for the accessible name. It is what makes the claim true by
              construction instead of by a computation rule a reader has to know. */}
          <span className="channel-list__control-name" aria-hidden="true">
            {pen.label}
          </span>
        </button>
      )}
    </div>
  )
}

// Read at interaction time: a render snapshot cannot authorize a later keyboard submission.
function canMutateHost(serverId: string | null | undefined): boolean {
  if (typeof serverId === 'string' && selectStatusFor(serverId)(sessionStore.getState())?.type === 'connected') return true
  window.pyry.sendDiagnostic({ event: 'sidebar-mutation', code: 'host-unavailable' })
  return false
}
