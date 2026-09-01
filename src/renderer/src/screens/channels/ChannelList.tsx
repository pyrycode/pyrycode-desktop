import './channels.css'
import { useState, type ReactNode } from 'react'
import type { ConversationSummary } from '@shared/wire/types'
import {
  useConversationListStore,
  selectConversations
} from '../../store/conversationListStore'
import {
  useDefaultWorkspaceStore,
  selectDefaultWorkspace
} from '../../store/defaultWorkspaceStore'
import { requestNewConversation } from '../../store/conversationCreatedBridge'
import { useSessionStore, selectStatus } from '../../store/sessionStore'
import { useRelayLinkStore, selectRelayLinkStatus } from '../../store/relayLinkStore'
// #834's read path, shipped dormant by #833 and mounted here. `HostLabelData` is the headless one-shot
// invoke; the store binding + selector feed the row. Nothing else in this file touches either.
import {
  useHostLabelStore,
  selectHostLabel,
  type HostLabelValue
} from '../../store/hostLabelStore'
import { HostLabelData } from '../../store/hostLabelLoader'
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
import { ConversationStatusDot } from './ConversationStatusDot'
import {
  titleFor,
  partitionActive,
  groupByWorkspace,
  formatLastActivity
} from './channelListViewModel'

// The Channel List home screen (#141) — the paired shell's `list` view, replacing the throwaway
// PlaceholderList (#140). A pure render slice over the already-shipped #208 conversationListStore: the
// container reads the slice, the pure ChannelListView renders it. No transport, IPC, store, or wire
// code is added (AC1). Mirrors the #203/#218 container-reads / pure-view split.
//
// The wire ConversationSummary carries no message text, so both Figma row shapes (avatar-bearing
// channel rows, preview-bearing discussion rows) collapse to a single title + last-activity-time row;
// the avatars, body previews, top app bar, and "See all" link are deferred to other tickets. The
// new-discussion FAB (#242) is added here — its click dispatches the createConversation command.

/**
 * Store-bound container. The store read and `Date.now()` are its only impurities — both safe under
 * `renderToStaticMarkup` in Node, where the store yields its initial `null` (the #218 container
 * posture), so the pure view is what the tests server-render with injected props. `onNewConversation`
 * dereferences `window.pyry` only inside the click arrow (never during render), so the server-render
 * smoke is untouched — the Composer.handleSubmit / UnpairControl discipline.
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
  const now = Date.now()
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
      <ChannelListView
        conversations={conversations}
        now={now}
        onOpen={onOpen}
        onOpenSettings={onOpenSettings}
        onOpenArchive={onOpenArchive}
        onNewConversation={() => requestNewConversation(window.pyry.sendCommand, defaultWorkspace)}
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
    </>
  )
}

/**
 * The pure view. Always returns a stable `aria-label="Conversations"` root (the test hook, present in
 * every state); content varies by the store's three states:
 *  - `null` (not-yet-loaded) → the wrapper only, no rows and no empty state (AC4 — the neutral
 *    first-paint posture, like #203's Timeline returning null on empty).
 *  - `[]` (loaded-zero) → the empty state (AC4).
 *  - non-empty → the two `is_promoted` sections; a section with zero rows renders no header, and the
 *    divider appears only between two present sections (AC2).
 */
export function ChannelListView({
  conversations,
  now,
  onOpen,
  onOpenSettings,
  onOpenArchive,
  onNewConversation,
  onSaveAsChannel,
  onRename
}: {
  conversations: readonly ConversationSummary[] | null
  now: number
  onOpen: (row: ConversationSummary) => void
  onOpenSettings: () => void
  onOpenArchive: () => void
  onNewConversation: () => void
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
      {renderBody(conversations, now, onOpen, onSaveAsChannel, onRename)}
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

// The host row heading each tree (Figma 106:3094) — which machine the tree's conversations live on. It is
// rendered INSIDE each section's existing `length > 0` gate, so "a tree with zero rows renders neither a
// section label nor a host row" holds by construction with no new condition — and the promote specs' use
// of a zero-row section as their "the row moved sections" proxy survives. Do not hoist it out of the gate.
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
export function HostRow({ label }: { label: string }): JSX.Element {
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
      <HostConnectionDotsControl />
    </div>
  )
}

// The store-bound container (#834) — `HostConnectionDotsControl`'s posture one component up: read the
// single shipped slice, pass it through the pure collapse, render the pure view. Nothing else. The row
// READS and never writes; `setHostLabel` keeps exactly one caller, the loader mounted in `ChannelList`.
// Module-private like its neighbour: production renders it from `renderBody` alone, and the unit tier
// reaches everything it can prove through `hostRowLabel` and `HostRow` instead.
function HostRowControl(): JSX.Element {
  const hostLabel = useHostLabelStore(selectHostLabel)
  return <HostRow label={hostRowLabel(hostLabel)} />
}

/**
 * The host row's two trailing connection dots (#718, Figma 110:3499 + 106:3114) — the HOST leg first, the
 * relay leg second. The pure view: props in, markup out, no store, no `window.pyry`, no effects.
 *
 * EXPORTED for the same reason `ConnectionStatusIndicator` and `CollapsibleWorkspaceGroup` are — it is the
 * only seam through which the unit tier reaches the full category × label matrix; the container below can
 * only ever render the two singletons' initial cell of it.
 *
 * LEG ORDER is the design's and is the REVERSE of `ConnectionStatusIndicator(relay, daemon)`'s. Both props
 * are a `ConnectionLeg`, so a swap type-checks and renders silently — hence the ordering test.
 *
 * COLOUR comes from `.conn-dot--up` / `--in-progress` / `--down` / `--unknown` in `conversation.css`, worn
 * WITHOUT their `.conn-dot` base (which bakes the status row's 8px box). #330 already split colour from
 * geometry into separate classes, and that split is the seam this slice reuses: re-declaring the four
 * bindings in `channels.css` would be a second copy of the contract one level below the mapping, which is
 * the thing AC2 forbids. `.channel-list__host-dot` therefore carries the 6px geometry and no `background`.
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
// state, and would also thread two more arguments through `renderBody`'s already-five-positional signature
// for a value no intermediate uses.
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
function HostConnectionDotsControl(): JSX.Element {
  const daemonStatus = useSessionStore(selectStatus)
  const relayStatus = useRelayLinkStore(selectRelayLinkStatus)
  return <HostConnectionDots host={daemonLeg(daemonStatus)} relay={relayLeg(relayStatus)} />
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
function WorkspaceRow({
  label,
  expanded,
  onToggle
}: {
  label: string
  expanded: boolean
  onToggle: () => void
}): JSX.Element {
  return (
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
  children
}: {
  label: string
  defaultExpanded?: boolean
  children: ReactNode
}): JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded)
  return (
    <>
      <WorkspaceRow
        label={label}
        expanded={expanded}
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

function renderBody(
  conversations: readonly ConversationSummary[] | null,
  now: number,
  onOpen: (row: ConversationSummary) => void,
  onSaveAsChannel: (row: ConversationSummary) => void,
  onRename: (row: ConversationSummary) => void
): JSX.Element | null {
  // Not-yet-loaded: neither rows nor the empty state (distinct from loaded-zero, per #208). Stays the
  // first check to preserve the null-vs-loaded-zero tri-state.
  if (conversations === null) return null
  // Filter archived rows out of the active list (#469) — they live only in the Archive screen.
  const { channels, discussions } = partitionActive(conversations)
  // The empty state decided from the ACTIVE partition, not the raw store count: a store holding only
  // archived rows has rows but zero active rows to show. This one check covers both loaded-zero ([])
  // and all-archived. Mobile #312's "Tap + to start a conversation" is adapted — the + FAB is #142,
  // so this copy references no affordance that isn't here yet.
  if (channels.length === 0 && discussions.length === 0) {
    return <p className="channel-list__empty">No conversations yet</p>
  }
  return (
    <>
      {channels.length > 0 && (
        <>
          <header className="channel-list__section-header">Channels</header>
          <HostRowControl />
          {/* Saved Channels are already promoted — they pass no onSaveAsChannel (that affordance is Recent-
              only), but they DO pass onRename, so each saved Channel row carries a Rename affordance (#360,
              AC1) — the symmetric counterpart to Save-as-channel on Recent rows.

              #703 wraps the map one level: each workspace group's rows sit under their own workspace row.
              #704 turned that wrapper from a keyed <Fragment> into CollapsibleWorkspaceGroup, which emits
              no element either — so the rendered list stays a FLAT sequence of siblings (header, host,
              workspace, rows, workspace, rows) and every `.channel-list__row` keeps the exact ancestry it
              had. A per-group <div> would instead become a flex item of the `.channel-list` column and
              move every existing locator's tree position. The two key namespaces cannot collide: React
              scopes keys per sibling list, so the group keys (cwd strings) and the row keys (c.id) never
              share one.

              `key={group.key}` carries the exact meaning it did on the Fragment, and now also pins the
              fold's IDENTITY: a group whose rows change (renamed, added, archived) or whose position
              moves keeps its instance and its fold, because React reconciles by key and not by index. A
              group that leaves the list is unmounted and its fold is discarded — correct for ephemeral
              disclosure state, and not worth defending against. */}
          {groupByWorkspace(channels).map((group) => (
            <CollapsibleWorkspaceGroup key={group.key} label={group.label}>
              {group.rows.map((c) => (
                <Row
                  key={c.id}
                  row={c}
                  now={now}
                  onOpen={() => onOpen(c)}
                  onRename={() => onRename(c)}
                />
              ))}
            </CollapsibleWorkspaceGroup>
          ))}
        </>
      )}
      {channels.length > 0 && discussions.length > 0 && (
        <div className="channel-list__divider" />
      )}
      {discussions.length > 0 && (
        <>
          <header className="channel-list__section-header">Chats</header>
          <HostRowControl />
          {/* Chats rows pass the affordance so each row can be saved as a channel (#274, AC1). The
              header reads "Chats" (#709, Figma 106:3258); the code-level partition is still
              `discussions` — renaming that vocabulary was explicitly out of scope.

              The two trees group independently (operator, 2026-08-21): the workspace level repeats here
              rather than being shared, so a workspace with rows in both trees appears in both — and since
              #704 their DISCLOSURE is independent too, for free: this map is a different sibling list from
              the Channels one above, so the same `cwd` in both yields two CollapsibleWorkspaceGroup
              instances holding two separate booleans. */}
          {groupByWorkspace(discussions).map((group) => (
            <CollapsibleWorkspaceGroup key={group.key} label={group.label}>
              {group.rows.map((d) => (
                <Row
                  key={d.id}
                  row={d}
                  now={now}
                  onOpen={() => onOpen(d)}
                  onSaveAsChannel={() => onSaveAsChannel(d)}
                />
              ))}
            </CollapsibleWorkspaceGroup>
          ))}
        </>
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
 * It is `HostConnectionDotsControl`'s shape one level down — a store-bound `*Control` beside a store-free
 * leaf — and it lives HERE rather than in `ConversationStatusDot.tsx` because that file declares itself
 * store-free in its own header.
 *
 * WHY PER-ROW AND NOT LIFTED. Hooks cannot be called from `renderBody`'s `.map()` callbacks (:558, :589),
 * so a per-row component is the only place these subscriptions can go — and it is also where they belong:
 * `conversationActivityStore`'s write path keeps every other conversation's held entry referentially
 * identical (conversationActivityStore.ts:124-127) and all three selectors hand back the HELD reference or
 * `null`, so a write for conversation A wakes A's dot and nothing else. Sitting here rather than in `Row`,
 * a status flip re-renders one <span> and not the row's title, time or icon buttons. The blink is
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
// real key is available here, unlike the timeline's array-index keying). `name` and the time are
// untrusted daemon-derived strings rendered as auto-escaped React children (never
// dangerouslySetInnerHTML) — displayed as opaque text.
//
// The open action is its own button; the optional trailing affordances (Save-as-channel #274, Rename
// #360) are SIBLINGS, not nested controls — an interactive control cannot nest inside a <button>.
// `.channel-list__row` is a flex wrapper; the old row button-reset/hover/focus rules now live on
// `.channel-list__row-open`. The two affordances are disjoint by section: Recent rows pass
// `onSaveAsChannel` (→ Save-as renders, Rename absent); saved Channel rows pass `onRename` (→ Rename
// renders, Save-as absent), so no row carries two trailing buttons (AC1).
//
// #448 resolved the old "conversation-agnostic onOpen" interim: each row now passes ITSELF up through
// onOpen, and PairedShell records it as the active conversation before navigating — so the thread's
// wire actions (send, snapshot, dequeue) target the clicked conversation's real id. The Row keeps a
// nullary onOpen prop; the map site closes over the row (the onSaveAsChannel/onRename pattern).
function Row({
  row,
  now,
  onOpen,
  onSaveAsChannel,
  onRename
}: {
  row: ConversationSummary
  now: number
  onOpen: () => void
  onSaveAsChannel?: () => void
  onRename?: () => void
}): JSX.Element {
  const time = formatLastActivity(row.last_message_ts, now)
  return (
    <div className="channel-list__row">
      {/* #801 — the status dot, LEADING the row and a SIBLING of the open button, not a child of it. The
          dot ships a named `role="img"` for all three statuses, so nesting it would fold "Idle" — and,
          as the daemon works, "Assistant working" — into the button's accessible name, mutating what
          should say what activating it does. RunConfigSections.tsx:270-280 already declined exactly this
          for the unselected radios. As a sibling the dot stays fully announced in reading order while the
          button's name stays title + time. `channels.css` positions it absolutely at the design's 16px
          inset so the button still spans the row and its hover/focus rectangles are unchanged; nothing
          about `.channel-list__row` / `__row-open`'s class tokens or ancestry moves (AC4). */}
      <ConversationStatusDotControl conversationId={row.id} />
      <button type="button" className="channel-list__row-open" onClick={onOpen}>
        <span className="channel-list__title">{titleFor(row.name)}</span>
        <span className="channel-list__time">{time}</span>
      </button>
      {onRename && (
        // Icon-only button — `aria-label` supplies the accessible name (the .channel-list__save pattern),
        // since the glyph alone carries no text. The 24px Material `edit` (pencil) glyph is a reasonable
        // stand-in: no Figma node pins this row-level control (19:14 is the dialog); a specific glyph is a
        // small architect swap, the save affordance's bookmark-glyph precedent.
        <button
          type="button"
          className="channel-list__rename"
          aria-label="Rename"
          onClick={onRename}
        >
          <svg
            className="channel-list__rename-icon"
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
          </svg>
        </button>
      )}
      {onSaveAsChannel && (
        // Icon-only button — `aria-label` supplies the accessible name (the .channel-list__fab pattern),
        // since the glyph alone carries no text. The Material bookmark glyph is a reasonable stand-in: no
        // Figma node pins this row-level control (19:24 is the dialog); a specific glyph is a small swap.
        <button
          type="button"
          className="channel-list__save"
          aria-label="Save as channel"
          onClick={onSaveAsChannel}
        >
          <svg
            className="channel-list__save-icon"
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z" />
          </svg>
        </button>
      )}
    </div>
  )
}
