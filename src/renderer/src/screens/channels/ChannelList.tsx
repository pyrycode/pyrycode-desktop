import './channels.css'
import { Fragment, useState, type ReactNode } from 'react'
import type { ConversationSummary } from '@shared/wire/types'
import {
  useConversationListStore,
  selectConversations
} from '../../store/conversationListStore'
import {
  useDefaultWorkspaceStore,
  selectDefaultWorkspace
} from '../../store/defaultWorkspaceStore'
import { requestNewConversation, requestNewChannel } from '../../store/conversationCreatedBridge'
// #1199 reads BOTH legs per server. The app-wide `selectStatus` / `selectRelayLinkStatus` cells are
// untouched in name, signature and value; the host row is simply no longer a reader of either.
// `selectStatus` keeps four other consumers (the composer status row, the connection banner, the repair
// control, `composerSend`); `selectRelayLinkStatus` keeps NONE — this row was its last production
// reader, and retiring it is deliberately out of scope here (its own header records that). Each
// store's INITIAL cell is imported too —
// it is the collapse target for a server that has reported nothing, so the launch frame is pinned to the
// same constant it has always rendered rather than to a literal restated here.
import { useSessionStore, selectStatusFor, initialSessionState } from '../../store/sessionStore'
import {
  useRelayLinkStore,
  selectRelayLinkStatusFor,
  initialRelayLinkState
} from '../../store/relayLinkStore'
// #834's read path, shipped dormant by #833 and mounted here, re-keyed by server id in #1199.
// `HostLabelData` is the headless one-shot invoke; the store binding + keyed selector feed the row.
// Nothing else in this file touches either.
import {
  useHostLabelStore,
  selectHostLabelFor,
  type HostLabelValue
} from '../../store/hostLabelStore'
import { HostLabelData } from '../../store/hostLabelLoader'
// #1199: the paired-server list is what tells the row WHICH machine it names, and it is the list #1070
// then iterates to draw one row per server. `ServerInfoData` is the shipped one-shot that fills it,
// mounted here beside `HostLabelData` — the Settings idiom applied to the screen that draws the row.
import { useServerInfoStore, selectServers } from '../../store/serverInfoStore'
import { ServerInfoData } from '../../store/serverInfoLoader'
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
// #1098's whole read: which chat the pane is showing. The store has held it since #278 and the sidebar
// simply did not read it — no new store, no IPC, no wire type.
import { useActiveConversationStore } from '../../store/activeConversationStore'
import { resolveConversationStatus } from '../../store/conversationStatus'
import { isConversationUnread } from '../../store/conversationUnread'
// #718 reuses #330's shipped two-leg mapping ACROSS SCREENS rather than growing a second copy of it —
// two surfaces in the same window disagreeing about one leg is precisely the lie the dot pair exists to
// prevent. Cross-screen import is this codebase's established idiom (ArchiveScreen and
// WorkspacePickerSheet both import from `channels/channelListViewModel`; `settings/DefaultWorkspaceRow`
// imports a component out of `conversation/`), and lifting the three symbols into a shared module first
// would be adjacent refactoring for no behaviour change. No cycle: ConversationScreen reaches back into
// this directory only for `channelListViewModel` and `RenameConversationDialog`, neither of which imports
// this file.
import { relayLeg, daemonLeg, type ConnectionLeg } from '../conversation/ConversationScreen'
import { SaveAsChannelDialog } from './SaveAsChannelDialog'
import { RenameConversationDialogView, requestRenameConversation } from './RenameConversationDialog'
import { CreateChannelDialogView } from './CreateChannelDialog'
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
// previews, top app bar, and "See all" link are deferred to other tickets. The new-discussion FAB
// (#242) is added here — its click dispatches the createConversation command.
//
// #1097 converged that row on the DESKTOP node (103:2968): a 24px row carrying a body-small label and
// nothing else. The trailing last-activity time the mobile node drew is gone — deleted, not hidden —
// so no clock is read anywhere in this file's render path any more.

/**
 * Store-bound container. The store read is its only impurity — safe under `renderToStaticMarkup` in
 * Node, where the store yields its initial `null` (the #218 container posture), so the pure view is
 * what the tests server-render with injected props. `onNewConversation` dereferences `window.pyry`
 * only inside the click arrow (never during render), so the server-render smoke is untouched — the
 * Composer.handleSubmit discipline (UnpairControl was the other example until #1061 deleted it).
 */
export function ChannelList({
  onOpen,
  onOpenSettings,
  onOpenArchive
}: {
  onOpen: (row: ConversationSummary) => void
  onOpenSettings: () => void
  onOpenArchive: () => void
}): JSX.Element {
  const conversations = useConversationListStore(selectConversations)
  // The client-owned default workspace (#403), read reactively so the FAB always closes over the current
  // value — #404 changing the default re-renders the container. Mirrors the conversations store read above;
  // safe under renderToStaticMarkup where the singleton hydrates to null (the typeof-window guard).
  const defaultWorkspace = useDefaultWorkspaceStore(selectDefaultWorkspace)
  // #1098 — the open chat's id, read HERE rather than per row. `activateConversation` calls
  // `setActiveConversation` unconditionally on both its branches before navigating (#448), so this is
  // correct for a sidebar row click and for a FAB-minted conversation alike.
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
  // already has a `render()` helper for — where this file's twice-shipped answer to the same problem
  // (HostRow/HostRowControl, HostConnectionDots/HostConnectionDotsControl) costs a component and an
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
  // label and dot reads stay inside their own leaves, so one machine's flap still wakes only that
  // machine's two dots.
  const servers = useServerInfoStore(selectServers)
  // Transient, per-interaction dialog state — component-local useState, not the store (the lowest scope
  // that survives re-render, the PermissionModal `pendingOptionId` posture). `saveRow` is the row whose
  // Save-as-channel dialog is open (or none); the dialog's name + location + round-trip state now live in
  // the SaveAsChannelDialog container itself (#288), seeded from the row on mount. The dialog is not
  // rendered on first paint (`saveRow` starts null) and `window.pyry` is dereferenced only inside the
  // container's callbacks, so ChannelList stays server-renderable (the onNewConversation discipline).
  const [saveRow, setSaveRow] = useState<ConversationSummary | null>(null)
  // The Rename dialog's independent per-interaction state (#360) — a separate local pair, not shared with
  // the save-as one. No mutual-exclusion logic is needed: an open dialog's fixed-inset overlay covers the
  // window, so the row affordance behind it is not clickable and the two dialogs cannot both be open.
  // `renameRow` is the row whose Rename dialog is open (or none); `renameName` is the controlled field,
  // seeded from the row's displayed title on open (a null-name row prefills with its "Untitled" placeholder).
  const [renameRow, setRenameRow] = useState<ConversationSummary | null>(null)
  const [renameName, setRenameName] = useState('')
  // The Create-channel dialog's own per-interaction pair (#1179), independent of the two above for
  // their stated reason: an open dialog's fixed-inset overlay covers the window, so no two can be open
  // at once and no mutual-exclusion logic is needed. `createChannelCwd` is the WORKSPACE the dialog will
  // create in — the group key the clicked plus closed over — and holding it here is what keeps that
  // daemon-asserted path out of the dialog view entirely. `createChannelName` is the controlled field,
  // seeded EMPTY on every open (there is no current name to seed from, this being a create).
  const [createChannelCwd, setCreateChannelCwd] = useState<string | null>(null)
  const [createChannelName, setCreateChannelName] = useState('')
  return (
    <>
      {/* #834: the headless one-shot that fills the host row's label, mounted HERE — the SettingsScreen
          idiom (<ServerInfoData /> beside <ServerRowControl />) applied to the screen that actually
          renders the row. It renders null, so DOM order is immaterial, and it dereferences `window.pyry`
          only inside its effect, so this container stays server-renderable (the onNewConversation
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
          Every frame before that renders the fallback word and the two stores' initial dot pair, which
          is exactly what the row shows at launch today (AC5). Settings and ConversationScreen each mount
          their own instance; a second one here is the established posture, not a duplicate — the store
          holds one list and each mount re-reads it. */}
      <ServerInfoData />
      <ChannelListView
        conversations={conversations}
        serverIds={servers.map((server) => server.serverId)}
        openConversationId={openConversationId}
        onOpen={onOpen}
        onOpenSettings={onOpenSettings}
        onOpenArchive={onOpenArchive}
        onNewConversation={() => requestNewConversation(window.pyry.sendCommand, defaultWorkspace)}
        // #1178 — the SECOND caller of the shipped constructor, and the whole of the wiring: it already
        // took the cwd as a required parameter, so the FAB's client-owned default and the workspace
        // row's own path are its two arguments and no bridge changed. `window.pyry` is dereferenced
        // inside the arrow alone, never during render (the onNewConversation discipline).
        onCreateChat={(cwd) => requestNewConversation(window.pyry.sendCommand, cwd)}
        // #1179 — the Channels-tree plus OPENS A DIALOG and sends nothing: the workspace is fixed by
        // the row that was clicked, and the name still has to be typed. Both cells are seeded together
        // so a reopen always starts from an empty field (the CreateFolderDialog reset, achieved by the
        // seed rather than by a store, since there is no store here to reset).
        onCreateChannel={(cwd) => {
          setCreateChannelCwd(cwd)
          setCreateChannelName('')
        }}
        onSaveAsChannel={(row) => setSaveRow(row)}
        onRename={(row) => {
          // Open the Rename dialog, seeding the field with the row's CURRENT displayed title (AC1) — the
          // same one-handler seed as save-as; a null-name row prefills with its "Untitled" placeholder.
          setRenameRow(row)
          setRenameName(titleFor(row.name))
        }}
      />
      {saveRow && (
        <SaveAsChannelDialog
          row={saveRow}
          onDismiss={() => setSaveRow(null)}
          onPromoted={() => setSaveRow(null)}
        />
      )}
      {renameRow && (
        <RenameConversationDialogView
          name={renameName}
          onNameChange={setRenameName}
          onCancel={() => setRenameRow(null)}
          onSave={() => {
            requestRenameConversation(window.pyry.sendCommand, renameRow, renameName)
            setRenameRow(null)
          }}
        />
      )}
      {/* #1179 — gated on an explicit `!== null` and NEVER on truthiness: an empty-string `cwd` would
          collapse into "no dialog open" under a truthy test (the trap `App.tsx`'s `openConversationId`
          header names). It is unreachable today because `renderServerTrees` withholds the plus from the
          unknown-workspace group, whose key IS the empty string — and writing the check this way is
          what keeps that withhold load-bearing for one reason rather than two. */}
      {createChannelCwd !== null && (
        <CreateChannelDialogView
          name={createChannelName}
          onNameChange={setCreateChannelName}
          // Cancel closes and sends nothing (AC2). The next open re-seeds the field, so there is
          // nothing to clear here.
          onCancel={() => setCreateChannelCwd(null)}
          onCreate={() => {
            // Fire-and-forget, then close (AC3). `window.pyry` is dereferenced HERE, at interaction
            // time, never during render — the `onNewConversation` discipline. The `cwd` goes verbatim;
            // the helper trims the name.
            requestNewChannel(window.pyry.sendCommand, createChannelName, createChannelCwd)
            setCreateChannelCwd(null)
          }}
        />
      )}
    </>
  )
}

/**
 * The pure view. Always returns a stable `aria-label="Conversations"` root (the test hook, present in
 * every state); content varies with the conversation store's tri-state AND the paired-server list:
 *  - `conversations === null` (not-yet-loaded) → the wrapper only, no headers, no rows, no empty state
 *    (the neutral first-paint posture, like #203's Timeline returning null on empty).
 *  - loaded, but nothing to draw — no paired server AND no active row → the wrapper only.
 *  - anything to draw → BOTH section headers and the divider, unconditionally, each header followed by
 *    one host row per paired server in pairing order (#1070).
 *
 * The loaded-zero empty state is GONE since #1070, deleted rather than hidden: a paired app always has a
 * host row to draw, and that row is where #1185/#1189 put the plus that starts a chat in a new workspace.
 */
export function ChannelListView({
  conversations,
  serverIds,
  openConversationId,
  onOpen,
  onOpenSettings,
  onOpenArchive,
  onNewConversation,
  onCreateChat,
  onCreateChannel,
  onSaveAsChannel,
  onRename
}: {
  // Widened to `ServerConversationSummary` in all but name: the rows arrive carrying their server stamp
  // (#1086), and `groupByServer`'s structural constraint is what reads it — this prop stays typed as the
  // wire row so the three other screens reading the same selector are unaffected.
  conversations: readonly (ConversationSummary & { readonly serverId?: string | null })[] | null
  // #1070 — the paired servers to draw a subtree for, in pairing order (oldest-paired first). REQUIRED
  // rather than optional, `openConversationId`'s reasoning: the container must decide, and a defaulted
  // prop would let a future caller silently render a sidebar with no host row at all. An EMPTY array is
  // the real launch state — the paired-server one-shot has not settled — and is what makes the two
  // headers wait rather than flashing above nothing.
  //
  // Ids and not `ServerInfoValue`s: this view has no business with a relay URL, and the narrower prop is
  // also the one the unit tier can inject in one literal.
  serverIds: readonly string[]
  // #1098 — the id of the chat the pane is showing, or `null` when none has been opened this session.
  // REQUIRED rather than optional: the container must decide, and a defaulted prop would let a future
  // caller silently render an unmarked sidebar. The unit tier's own helper defaults it to `null`, which
  // is exactly what the store hydrates to under `renderToStaticMarkup`.
  openConversationId: string | null
  onOpen: (row: ConversationSummary) => void
  onOpenSettings: () => void
  onOpenArchive: () => void
  onNewConversation: () => void
  // #1178 — start a chat in the named workspace, the sidebar's first create that is not the client's
  // default. REQUIRED rather than optional, `openConversationId`'s reasoning: the container must decide,
  // and a defaulted prop would let a future caller silently render a sidebar with no per-workspace route
  // to a new chat. The `cwd` is the group's key and travels verbatim; this view never inspects it.
  onCreateChat: (cwd: string) => void
  // #1179 — open the Create-channel dialog for the named workspace. REQUIRED for `onCreateChat`'s
  // reason, and the symmetric one: a defaulted prop would let a future caller silently render a
  // Channels tree whose plus opens nothing. It receives the group's `cwd` and does NOT send a command —
  // the dialog's Create does, once a name has been typed.
  onCreateChannel: (cwd: string) => void
  onSaveAsChannel: (row: ConversationSummary) => void
  onRename: (row: ConversationSummary) => void
}): JSX.Element {
  return (
    <section className="channel-list" aria-label="Conversations">
      {/* #347: the top-right actions cluster — the Archive entry leads, the gear trails (conventional
          gear-rightmost). One sticky flex-row wrapper hosts both, so two independent sticky children do
          not stack awkwardly. Present in all three list states (AC1), like the FAB. */}
      <div className="channel-list__actions">
        <ArchiveButton onClick={onOpenArchive} />
        <SettingsButton onClick={onOpenSettings} />
      </div>
      {renderBody(
        conversations,
        serverIds,
        openConversationId,
        onOpen,
        onCreateChat,
        onCreateChannel,
        onSaveAsChannel,
        onRename
      )}
      <NewConversationFab onClick={onNewConversation} />
    </section>
  )
}

// The Settings entry affordance (#333) — a desktop-invented control: ChannelList has no top app bar yet
// (its own comment defers it), and no Figma node on the list scope (15-8) pins a settings entry, so —
// like NewConversationFab — this is invented rather than traced. Rendered as the FIRST child of the
// <section> and pinned top-right via CSS, so it is present in all three list states (AC1) and stays
// reachable while a long list scrolls under it. Clones NewConversationFab's shape: an icon-only native
// <button> (keyboard-focusable), `aria-label` supplies the accessible name since the gear glyph carries
// no text, and the SVG is aria-hidden. onClick is a pure injected nav effect — no window.pyry, no store.
// The 24px Material `settings` (gear) glyph.
function SettingsButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="channel-list__settings"
      aria-label="Settings"
      onClick={onClick}
    >
      <svg
        className="channel-list__settings-icon"
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
      </svg>
    </button>
  )
}

// The Archive entry affordance (#347) — a desktop-invented control mirroring SettingsButton's shape (no
// Figma node pins it on the list scope 15-8, like the gear). It leads the top-right actions cluster.
// Clones the gear's posture exactly: an icon-only native <button> (keyboard-focusable), whose distinct
// `aria-label="Archive"` supplies the accessible name and disambiguates it from the gear's "Settings"
// (the ticket's disambiguation), and whose SVG is aria-hidden. onClick is a pure injected nav effect —
// no window.pyry, no store. The 24px Material `archive` (box) glyph.
function ArchiveButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="channel-list__archive"
      aria-label="Archive"
      onClick={onClick}
    >
      <svg
        className="channel-list__archive-icon"
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z" />
      </svg>
    </button>
  )
}

// The new-discussion FAB (Figma 15-106) — a floating add affordance pinned bottom-right of the list
// scroller. Rendered as a sibling of `renderBody`, so it is present in all three list states (AC1). An
// icon-only `<button>`, mirroring #140's BackControl: a native button is keyboard-focusable (AC4) and
// `aria-label` supplies the accessible name (the .composer__send / StatusRow pattern) since the glyph
// alone carries no text. On click it dispatches the createConversation command (fire-and-forget) via the
// injected handler; navigation to the new thread is decoupled and event-driven (useConversationCreatedNav
// in PairedShell fires on the daemon's conversationCreated confirmation), never synchronous here. The
// Material `add` glyph path is the 24px add icon.
function NewConversationFab({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="channel-list__fab"
      aria-label="New discussion"
      onClick={onClick}
    >
      <svg
        className="channel-list__fab-icon"
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
      </svg>
    </button>
  )
}

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
// Not interactive: a plain <div>, no <button>, no onClick, no aria-label. The label carries the row's
// meaning, so the glyph is aria-hidden — a second accessible name would be noise. The two connection dots
// #672 reserved this row's trailing edge for landed in #718, as the store-bound leaf below; the row itself
// stays non-interactive, and the dots are named individually rather than through the row.
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
// #834 made this the PURE VIEW and put `HostRowControl` below it, mirroring `HostConnectionDots` /
// `HostConnectionDotsControl` twenty lines down. EXPORTED for that neighbour's stated reason: a zustand
// singleton seeded before a `renderToStaticMarkup` call is invisible to it (the server renderer reads
// `getServerSnapshot()`, wired to the state captured at store CREATION), so the container can only ever
// render the initial `loading` cell and this is the only seam the unit tier reaches the four-arm matrix
// through. "Pure" in the same qualified sense its neighbour already is: it takes its own data as props;
// its dot subtree reads two singletons.
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
// #1199 gave the row a `serverId`: WHICH machine it is about. The label arrives already resolved to text
// (the container ran `hostRowLabel`), so the id is here for the dot subtree alone — pure pass-through,
// rendered nowhere. It is a prop rather than a second store read inside the dots so the row's identity
// is single-sourced, and it is the shape #1070's loop hands down now that this is one row per server.
//
// #1070 NARROWED IT FROM `string | null` TO `string`. The `null` arm meant "the paired-server list has
// not resolved yet", which was reachable while the row rendered unconditionally; it is not any more,
// because a host row now exists BECAUSE an id was in that list. The branch and its collapse are deleted
// rather than left as a dead arm whose comment describes a frame that cannot occur.
//
// THE ID GETS THE LABEL'S FOUR-SINK TREATMENT, plus the one a keyed store invites: the KEY is the server
// id and the VALUE is the label, never the reverse. It becomes no attribute, no class name, no title, no
// URL, no lookup path and no log line, and its only use in this subtree is as an argument to the three
// per-server selector factories.
//
// ONE SINK LEFT THAT LIST IN #1070: the React key. `renderBody` keys each server's subtree fragment by
// this id, and the ban is amended rather than quietly broken. The distinction is not a concession — the
// six sinks above all either reach the DOM or reach persistence, where a React key is reconciliation
// identity alone: never serialised, never emitted by `renderToStaticMarkup`, unobservable to the page.
// The alternative is worse than the doc edit: an index key would cross-wire fold state and per-row
// instances between machines whenever the paired list reorders. `ChannelList.test.tsx` pins the claim by
// rendering a sentinel id and asserting it appears nowhere in the markup.
export function HostRow({
  label,
  serverId
}: {
  label: string
  serverId: string
}): JSX.Element {
  return (
    <div className="channel-list__host">
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
      <span className="channel-list__host-label">{label}</span>
      <HostConnectionDotsControl serverId={serverId} />
    </div>
  )
}

// The store-bound container (#834) — `HostConnectionDotsControl`'s posture one component up: read the
// single shipped slice, pass it through the pure collapse, render the pure view. Nothing else. The row
// READS and never writes; `setHostLabelFor` keeps exactly one caller, the loader mounted in `ChannelList`.
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
function HostRowControl({ serverId }: { serverId: string }): JSX.Element {
  const hostLabel = useHostLabelStore(selectHostLabelFor(serverId))
  return <HostRow label={hostRowLabel(hostLabel)} serverId={serverId} />
}

/**
 * The host row's two trailing connection dots (#718, Figma 110:3499 + 106:3114) — the HOST leg first, the
 * relay leg second. The pure view: props in, markup out, no store, no `window.pyry`, no effects.
 *
 * EXPORTED for the same reason `CollapsibleWorkspaceGroup` is — it is the only seam through which the unit
 * tier reaches the full category × label matrix; the container below can only ever render the two
 * singletons' initial cell of it. #330's `ConnectionStatusIndicator` was exported on the same reasoning
 * until #962 retired it with the status row, leaving this the only two-dot view in the app.
 *
 * LEG ORDER is the design's and is the REVERSE of the retired `ConnectionStatusIndicator(relay, daemon)`'s,
 * whose argument order the container below still carries. Both props are a `ConnectionLeg`, so a swap
 * type-checks and renders silently — hence the ordering test.
 *
 * COLOUR comes from `.conn-dot--up` / `--in-progress` / `--down` / `--unknown`, worn WITHOUT any base class
 * of their own. #330 split colour from geometry into separate classes and that split is the seam this slice
 * reused; #962 then deleted the status row that held both halves, and the colour half MOVED into
 * `channels.css` beside `.channel-list__host-dot` rather than dying with it — these dots are its only
 * consumer now, and one copy in the renderer is still what #330's AC2 asks for. `.channel-list__host-dot`
 * carries the 6px geometry and no `background`. Nothing here reads a computed colour, so a lost binding
 * would blank these dots silently; `e2e/connection-dot-colours.spec.ts` is the tier that would catch it.
 *
 * `role="img"` is what makes `aria-label` land: on a bare <span> the accessible-name computation drops it,
 * so the dot would have no name at all (AC3 passing review while failing in a screen reader). Not
 * `role="status"` — that is a live region, and #330 deliberately declined one because the ConnectionBanner
 * (#279) already politely announces disconnects. The wrapper carries no role and no name of its own: the
 * host row renders twice and #670's two-pane layout shows the conversation status row at the same time, so
 * #330's `role="group" aria-label="Connection status"` shape would put three identically-named groups in
 * one window. AC3 asks for a name per dot, not per group.
 *
 * The dots carry NO text node (AC4) — the row shows the glyph, the machine name and the two dots only.
 */
export function HostConnectionDots({
  host,
  relay
}: {
  host: ConnectionLeg
  relay: ConnectionLeg
}): JSX.Element {
  return (
    <span className="channel-list__host-status">
      <span
        className={`channel-list__host-dot conn-dot--${host.category}`}
        role="img"
        aria-label={host.label}
      />
      <span
        className={`channel-list__host-dot conn-dot--${relay.category}`}
        role="img"
        aria-label={relay.label}
      />
    </span>
  )
}

// The store-bound container — `ConnectionStatusIndicatorControl`'s body with the two legs REORDERED. Reads
// each leg through its own shipped narrow selector, so a relay flap re-renders these four dots and not a
// single conversation row; lifting the reads to `ChannelList` would couple the whole sidebar to both legs'
// state, and would also thread two more arguments through `renderBody`'s already-six-positional signature
// for a value no intermediate uses. (#1070 added `serverIds` and made it six; the argument against
// lifting only got stronger, since each added positional raises the cost of the next.)
//
// The honest cost: `ChannelListView` is no longer strictly pure — its subtree now reads two singletons,
// which deviates from this file's own container-reads / pure-view doc comment. It is safe under the unit
// harness for the same reason `ConnectionStatusIndicatorControl` is: a zustand `useStore` read
// server-renders fine, yielding each store's initial value (relay `null` → "Relay Unknown" since #719 —
// not yet known rather than known-offline, since this row is the first frame of every launch; session
// `{ type: 'disconnected' }` → "Pyrycode Offline" — no false green).
//
// The two legs are read INDEPENDENTLY and never cross-referenced (AC2): each mapping takes one status and
// returns one leg, so "relay up, host down" renders as exactly that. `daemonLeg`'s label says "Pyrycode"
// rather than the design's "Host" or the visible row's "Server" — deliberately, since any other word would
// re-derive the label half of #330's contract, and this dot reports the pyry DAEMON SESSION, not the
// machine: a machine can be up while the daemon is not, and this dot goes red in that case.
//
// #1199 BOUND BOTH READS TO ONE SERVER. `selectStatus` / `selectRelayLinkStatus` are "the most recently
// written status across every connection", so with two machines paired this row reported whichever
// connection last moved — the other machine's flap steering this machine's dots. Both per-server
// selectors (#1133, #1134) shipped for exactly this consumer and are read here with a CLIENT-HELD id,
// never a wire-supplied one, which is the rule `relayLinkStore`'s own header states.
//
// THE SILENT-SERVER COLLAPSE, and why it is written as two constants rather than two literals. Both
// per-server selectors answer `undefined` for a server that has reported nothing yet — deliberately
// undefaulted, so "not heard from" stays distinct from a reported state — while `daemonLeg` takes a
// non-optional `ConnectionStatus` and `relayLeg` takes `RelayLinkStatus | null`. So this row has to
// decide what a silent server's dots look like, and it lands them on each store's OWN INITIAL CELL:
// `initialSessionState.status` (→ down, "Pyrycode Offline") and `initialRelayLinkState.status` (→
// `null`, hence unknown, "Relay Unknown"). That is not a fifth category and not a guess — it is
// literally the pair this row has rendered on every launch frame since #718, back when both reads were
// app-wide and both stores were untouched. Reading the constants rather than restating `{ type:
// 'disconnected' }` and `null` is what keeps that true if either store ever changes its initial cell.
//
// #1070 DELETED THE `null` GUARD that used to wrap both reads. It existed because a `null` serverId — the
// frames before the paired-server one-shot resolved — must never reach a keyed selector: `StatusOrigin`
// and `RelayLinkOrigin` both admit `null` as a REAL slot key (unstamped writes land there), so passing it
// through would read someone else's cell rather than answering "not known". That frame no longer exists:
// a host row is drawn because its id was in the paired list, so the id is always a real one. The silent-
// server collapse below is untouched and is a DIFFERENT case — a paired server that has reported nothing
// yet — which is still very much reachable.
function HostConnectionDotsControl({ serverId }: { serverId: string }): JSX.Element {
  const daemonStatus = useSessionStore(selectStatusFor(serverId))
  const relayStatus = useRelayLinkStore(selectRelayLinkStatusFor(serverId))
  return (
    <HostConnectionDots
      host={daemonLeg(daemonStatus ?? initialSessionState.status)}
      relay={relayLeg(relayStatus ?? initialRelayLinkState.status)}
    />
  )
}

// The workspace row heading each group under a host row (#703, Figma 106:3098) — which workspace the
// group's conversations run in. Visually HostRow one indent deeper: the same 28px rhythm and the same
// type, differing by the 8px deeper left inset that shows the nesting (channels.css) — and, since #704,
// by being a control rather than a plain row.
//
// Unlike the host row's compile-time constant, `label` is DAEMON-derived — the last segment of an
// untrusted `cwd`, derived by `workspaceLabelFor`. It goes in as an auto-escaped React CHILD and nowhere
// else: never `title=`, never any other attribute, never a URL, never a filename or a lookup path
// (CLAUDE.md 2026-08-20; #696's security review rejected `title={daemonText}` as a MUST FIX). Being
// unbounded untrusted text it also ellipsizes, which the host row's six-character constant does not need.
//
// The class names share no token — and no substring — with `channel-list__row`, `__row-open`,
// `__section-header` or `__host`: Playwright locators run in strict mode, so an element JOINING an
// existing locator's match set strict-violates rather than failing an assertion, and
// `launchPairedApp.ts:224` clicks an unfiltered `.channel-list__row-open` that 28 specs ride. The text
// guard is the other half and is fixture-decided here rather than constant-decided: every fake fixture
// seeds `cwd: '/fake/workspace'`, so the default tier renders the literal "workspace", which equals none
// of the suite's `exact: true` strings and carries none of the classes its `hasText` locators scope to.
//
// #704 made the row the DISCLOSURE CONTROL for its group — a real <button> rather than a <div onClick>,
// so keyboard activation (Enter and Space) and screen-reader semantics come for free rather than being
// re-implemented and half-missed (the ToolRow / UnrecognizedRow precedent). Its attribute set is complete
// as written, and four sinks a disclosure control invites are declined ON PURPOSE, each a MUST FIX if it
// ever appears here — the same four ConversationScreen.tsx:657-668 declines for the tool row, recurring
// here sourced from the workspace label and from `group.key`:
//   - NO aria-label. `Collapse ${label}` would interpolate daemon text into an ATTRIBUTE. The accessible
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
// The class token stays SOLE — no `--collapsed` modifier, in either state. `ChannelList.test.tsx:76` pins
// `class="channel-list__workspace"` as an EXACT attribute-value substring, so a second token would stop
// matching it and silently zero #703's counts rather than failing them. There is nothing to style
// differently anyway: the Figma draws one state and no chevron. A collapsed appearance, if one is ever
// designed, styles off `[aria-expanded='false']`.
//
// The glyph is a seventh inline Material path in this file's idiom — the `folder` shape, its `d` copied
// from WorkspacePickerSheet's module-local FolderIcon but sized 12px to match the host row's level marker
// rather than that file's 24px control.
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
function WorkspaceRow({
  label,
  expanded,
  onToggle,
  create
}: {
  label: string
  expanded: boolean
  onToggle: () => void
  create?: WorkspaceCreateControl
}): JSX.Element {
  return (
    <div className="channel-list__workspace-head">
      <button
        type="button"
        className="channel-list__workspace"
        aria-expanded={expanded}
        onClick={onToggle}
      >
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
        <span className="channel-list__workspace-label">{label}</span>
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
  children: ReactNode
}): JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded)
  return (
    <>
      <WorkspaceRow
        label={label}
        expanded={expanded}
        create={create}
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
// NOT merged with anything. `.conversation`'s own Rename entry in the thread overflow menu carries the
// same six characters, and folding the two together would couple two surfaces' copy across a cross-screen
// import for one word — the ruling `HOST_ROW_FALLBACK_LABEL` already records for `SERVER_ROW_LABEL`.
const RENAME_CONTROL_LABEL = 'Rename'
const SAVE_AS_CHANNEL_CONTROL_LABEL = 'Save as channel'

// #1178 — the workspace row's plus, named in the same idiom and for the same reasons. Read once today,
// by the control's `aria-label`; #1181's pill becomes its second reader, which is why it is a constant
// and not a literal at the call site. The words are the client's own and never the workspace label:
// `Create ${label}` would put daemon text in an attribute, which is the MUST FIX #696's review named.
const CREATE_CHAT_CONTROL_LABEL = 'Create chat'

// #1179 — its Channels-tree counterpart, and the reason the plus now travels with a name. Same idiom,
// same client-owned rule, and #1181's pill reads BOTH. The two words differ because the two trees
// create different things: the Chats plus sends `is_promoted: false, name: null`, this one opens the
// dialog that sends `is_promoted: true` and a typed name.
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
  serverIds: readonly string[],
  renderRow: (row: SidebarRow) => JSX.Element,
  // #1178, reshaped by #1179 — the trailing create control this tree draws on each of its workspace
  // rows, or `undefined` for a tree that offers none. OPTIONAL and trailing, which is what carries the
  // per-tree difference now that ONE helper draws both trees: BOTH calls supply one since #1179, and
  // they differ in the two fields of this object alone. `onCreate` takes the `cwd` rather than the
  // group, so the caller states exactly what crosses this seam.
  create?: { readonly label: string; readonly onCreate: (cwd: string) => void }
): JSX.Element {
  const { servers, unattributed } = groupByServer(serverIds, rows)
  const workspaceGroups = (serverRows: readonly SidebarRow[]): JSX.Element[] =>
    // `key={group.key}` pins the fold's IDENTITY as well as its position: a group whose rows change
    // (renamed, added, archived) or whose position moves keeps its instance and its fold, because React
    // reconciles by key and not by index. A group that leaves the list is unmounted and its fold is
    // discarded — correct for ephemeral disclosure state. The two key namespaces cannot collide: React
    // scopes keys per sibling list, so the group keys (cwd strings) and the row keys (c.id) never share
    // one, and neither shares one with the server fragments a level up.
    groupByWorkspace(serverRows).map((group) => (
      <CollapsibleWorkspaceGroup
        key={group.key}
        label={group.label}
        // THE GROUP'S KEY IS ITS `cwd` (`groupByWorkspace`), passed VERBATIM: not normalised, not
        // trimmed, no `path` module, no local resolution. It is daemon-asserted text making its first
        // trip back OUT as a command field, so the only safe handling is to echo exactly what was
        // received — main re-validates it at the untrusted IPC boundary and rebuilds a fresh three-field
        // literal before it reaches the wire.
        //
        // The unknown group is skipped: its key is `UNKNOWN_WORKSPACE_KEY`, the empty string, which
        // names no directory and is NOT the `null` "take the daemon default" signal the payload keeps
        // distinct. Decided on the KEY, never on the label — a real directory named "Unknown workspace"
        // is an ordinary group and keeps its plus. Since #1179 that withhold covers BOTH trees, and it
        // is what keeps the empty string from ever reaching either create.
        create={
          create === undefined || group.key === UNKNOWN_WORKSPACE_KEY
            ? undefined
            : { label: create.label, onCreate: () => create.onCreate(group.key) }
        }
      >
        {group.rows.map(renderRow)}
      </CollapsibleWorkspaceGroup>
    ))
  return (
    <>
      {servers.map((server) => (
        <Fragment key={server.serverId}>
          <HostRowControl serverId={server.serverId} />
          {workspaceGroups(server.rows)}
        </Fragment>
      ))}
      {workspaceGroups(unattributed)}
    </>
  )
}

function renderBody(
  conversations: readonly SidebarRow[] | null,
  // #1070 — the paired servers to draw, in pairing order. Data, so it leads the callbacks like the id
  // below. Its EMPTINESS is meaningful: it is the launch frame before the one-shot settles.
  serverIds: readonly string[],
  // #1098 — data, so it leads the callbacks. It is compared, never rendered: the id is daemon-asserted
  // and stays a comparison operand, never a class-name interpolation, an attribute value, a title, an
  // object key or a log line (`ConversationStatusDotControl`'s condition on the same value).
  openConversationId: string | null,
  onOpen: (row: ConversationSummary) => void,
  // #1178 — start a chat in a named workspace. Handed to the `discussions` tree ALONE, which — with
  // its #1179 sibling below — is the one place the two trees are told apart now that
  // `renderServerTrees` draws both.
  onCreateChat: (cwd: string) => void,
  // #1179 — open the Create-channel dialog for a named workspace. Handed to the `channels` tree alone.
  // The container turns it into dialog state; nothing is sent until the dialog's Create.
  onCreateChannel: (cwd: string) => void,
  onSaveAsChannel: (row: ConversationSummary) => void,
  onRename: (row: ConversationSummary) => void
): JSX.Element | null {
  // Not-yet-loaded: neither rows nor chrome (distinct from loaded-zero, per #208). Stays the first check
  // to preserve the null-vs-loaded-zero tri-state, which #1070 did not touch.
  if (conversations === null) return null
  // Filter archived rows out of the active list (#469) — they live only in the Archive screen.
  const { channels, discussions } = partitionActive(conversations)
  // NOTHING TO DRAW — no paired machine and no active row. This one gate replaces both `length > 0`
  // section gates AND the `No conversations yet` paragraph #1070 deleted, and it is decided from the
  // ACTIVE partition rather than the raw store count, so a store holding only archived rows still counts
  // as zero (the check the empty state already made).
  //
  // The server half is what the paired app answers on: a machine paired with no conversations at all
  // renders both headers and its two host rows, because that row carries the plus that starts its first
  // chat (#1185, #1189). The ROW half is not redundant with it — it covers the frames after the daemon's
  // list arrives but before the paired-server one-shot settles, where the rows would otherwise be
  // withheld from a sidebar that has them in hand. They render unattributed there, and the host rows
  // appear a tick later.
  if (serverIds.length === 0 && channels.length === 0 && discussions.length === 0) return null
  return (
    <>
      {/* Both headers and the divider render UNCONDITIONALLY inside the gate above (operator ruling,
          2026-09-06). Until #1070 each was conditioned on its section holding a row, and the divider on
          both holding one; a section is now a permanent home for one host row per paired machine, empty
          or not, so there is nothing left for those conditions to express. `.channel-list__section-header`
          therefore matches exactly two elements in every drawn state, which is what keeps the suite's
          header locators single-match. */}
      <header className="channel-list__section-header">Channels</header>
      {/* Saved Channels are already promoted — they pass no onSaveAsChannel (that affordance is Recent-
          only), but they DO pass onRename, so each saved Channel row carries a Rename affordance (#360,
          AC1) — the symmetric counterpart to Save-as-channel on Recent rows. Those two affordances are
          also what the promote specs proxy "the row moved sections" on since #1070, the mutually
          exclusive section headers having stopped being mutually exclusive. */}
      {/* #1179 — the Channels tree's own create, and the second half of the per-tree difference. The
          two control objects are built HERE, at the only level that knows which tree it is drawing, so
          the two client-owned label constants stay module-local to this file and neither reaches a
          component that also handles a `cwd`. */}
      {renderServerTrees(channels, serverIds, (c) => (
        <Row
          key={c.id}
          row={c}
          // #1098 — the comparison happens HERE, so `Row` takes a boolean about itself rather than a
          // global id to reason about. `===` against a possibly-null id and never a truthiness test: an
          // empty-string id stays an ordinary key instead of collapsing into "nothing open" (App.tsx's
          // `openConversationId` header names the same trap).
          isOpen={c.id === openConversationId}
          onOpen={() => onOpen(c)}
          onRename={() => onRename(c)}
        />
      ), { label: CREATE_CHANNEL_CONTROL_LABEL, onCreate: onCreateChannel })}
      <div className="channel-list__divider" />
      {/* The header reads "Chats" (#709, Figma 106:3258); the code-level partition is still `discussions`
          — renaming that vocabulary was explicitly out of scope.

          The two trees group independently (operator, 2026-08-21): the server and workspace levels repeat
          here rather than being shared, so a machine — and a workspace — with rows in both trees appears
          in both. Since #704 their DISCLOSURE is independent too, for free: this is a different sibling
          list from the Channels one above, so the same `cwd` in both yields two CollapsibleWorkspaceGroup
          instances holding two separate booleans. #1070 extends that property across servers by the same
          mechanism and with nothing to implement for it. */}
      <header className="channel-list__section-header">Chats</header>
      {renderServerTrees(discussions, serverIds, (d) => (
        <Row
          key={d.id}
          row={d}
          // Same comparison as the Channels tree above — one `Row` serves both, so the open chat is
          // marked in whichever tree it lives in and neither is a special case.
          isOpen={d.id === openConversationId}
          onOpen={() => onOpen(d)}
          onSaveAsChannel={() => onSaveAsChannel(d)}
        />
      ), { label: CREATE_CHAT_CONTROL_LABEL, onCreate: onCreateChat })}
    </>
  )
}

/**
 * One row's status dot (#801 / #874, Figma 103:2968) — the first consumer of both #800's leaf and #799's
 * resolver, and the answer to the question `conversationUnread.ts:81` left open: WHERE the two-store
 * unread composition lives. Here, per row, keyed by THE ROW'S OWN conversation id.
 *
 * Read the four narrow per-id slices, reduce them to one status, render the dot. That is the whole body.
 * It is `HostConnectionDotsControl`'s shape one level down — a store-bound `*Control` beside a store-free
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
 * The honest cost, the same one HostConnectionDotsControl (:353-364) already took and recorded:
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
  const inputRequired = useModalStore(selectHasOutstandingFor(conversationId))
  const activity = useConversationActivityStore(selectActivityFor(conversationId))
  const timeline = useConversationTimelineStore(selectTimelineFor(conversationId))
  const lastRead = useConversationLastReadStore(selectLastReadFor(conversationId))
  return (
    <ConversationStatusDot
      status={resolveConversationStatus(
        inputRequired,
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
// `.channel-list__row-open`. The two affordances are disjoint by section: Recent rows pass
// `onSaveAsChannel` (→ Save-as renders, Rename absent); saved Channel rows pass `onRename` (→ Rename
// renders, Save-as absent), so no row carries two trailing buttons (AC1).
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
  onRename
}: {
  row: ConversationSummary
  isOpen: boolean
  onOpen: () => void
  onSaveAsChannel?: () => void
  onRename?: () => void
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
      {onRename && (
        // Icon-only button — `aria-label` supplies the accessible name (the .channel-list__save pattern),
        // since the glyph alone carries no text. Since #1171 the glyph is the DRAWING'S OWN export
        // (Font Awesome `pen-solid`, the "Icon Edgeless" instance the Hover variant places at 12×12),
        // replacing the Material `edit` pencil that stood in while no Figma node pinned this control.
        // It is the CHANNELS tree's glyph: promoted rows are the ones that take a Rename.
        //
        // The control is invisible at rest and revealed by the ROW's hover or by its own keyboard focus
        // (`channels.css` says why the reveal is `opacity` and never `display: none`). Nothing here
        // changes for it: the reveal hangs off the wrapper's existing class, so no markup moves and the
        // unit tier's attribute runs stay byte-identical.
        <button
          type="button"
          className="channel-list__rename"
          aria-label={RENAME_CONTROL_LABEL}
          onClick={onRename}
        >
          <svg
            className="channel-list__rename-icon"
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
            {RENAME_CONTROL_LABEL}
          </span>
        </button>
      )}
      {onSaveAsChannel && (
        // Icon-only button — `aria-label` supplies the accessible name (the .channel-list__fab pattern),
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
    </div>
  )
}
