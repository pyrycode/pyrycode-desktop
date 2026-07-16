import './channels.css'
import { useState } from 'react'
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
import { SaveAsChannelDialog } from './SaveAsChannelDialog'
import { RenameConversationDialogView, requestRenameConversation } from './RenameConversationDialog'
import { titleFor, partitionActive, formatLastActivity } from './channelListViewModel'

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
          {/* Saved Channels are already promoted — they pass no onSaveAsChannel (that affordance is Recent-
              only), but they DO pass onRename, so each saved Channel row carries a Rename affordance (#360,
              AC1) — the symmetric counterpart to Save-as-channel on Recent rows. */}
          {channels.map((c) => (
            <Row key={c.id} row={c} now={now} onOpen={() => onOpen(c)} onRename={() => onRename(c)} />
          ))}
        </>
      )}
      {channels.length > 0 && discussions.length > 0 && (
        <div className="channel-list__divider" />
      )}
      {discussions.length > 0 && (
        <>
          <header className="channel-list__section-header">Recent discussions</header>
          {/* Recent discussions pass the affordance so each row can be saved as a channel (AC1). */}
          {discussions.map((d) => (
            <Row
              key={d.id}
              row={d}
              now={now}
              onOpen={() => onOpen(d)}
              onSaveAsChannel={() => onSaveAsChannel(d)}
            />
          ))}
        </>
      )}
    </>
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
