import './channels.css'
import { useState } from 'react'
import type { ConversationSummary } from '@shared/wire/types'
import {
  useConversationListStore,
  selectConversations
} from '../../store/conversationListStore'
import { requestNewConversation } from '../../store/conversationCreatedBridge'
import { SaveAsChannelDialogView, requestPromoteConversation } from './SaveAsChannelDialog'
import { titleFor, partitionByPromotion, formatLastActivity } from './channelListViewModel'

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
  onOpenSettings
}: {
  onOpen: () => void
  onOpenSettings: () => void
}): JSX.Element {
  const conversations = useConversationListStore(selectConversations)
  const now = Date.now()
  // Transient, per-interaction dialog state — component-local useState, not the store (the lowest scope
  // that survives re-render, the PermissionModal `pendingOptionId` posture). `saveRow` is the row whose
  // dialog is open (or none); `name` is the controlled field value. Both reset on each open. The dialog
  // is not rendered on first paint (`saveRow` starts null) and `window.pyry` is dereferenced only inside
  // the click closures, so the container stays server-renderable (the onNewConversation discipline).
  const [saveRow, setSaveRow] = useState<ConversationSummary | null>(null)
  const [name, setName] = useState('')
  return (
    <>
      <ChannelListView
        conversations={conversations}
        now={now}
        onOpen={onOpen}
        onOpenSettings={onOpenSettings}
        onNewConversation={() => requestNewConversation(window.pyry.sendCommand)}
        onSaveAsChannel={(row) => {
          // Open the dialog and seed the field from the row's displayed title in one handler — no effect,
          // no key-remount; re-seeding on each open replaces any prior value.
          setSaveRow(row)
          setName(titleFor(row.name))
        }}
      />
      {saveRow && (
        <SaveAsChannelDialogView
          name={name}
          onNameChange={setName}
          onCancel={() => setSaveRow(null)}
          onSave={() => {
            requestPromoteConversation(window.pyry.sendCommand, saveRow, name)
            setSaveRow(null)
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
  onNewConversation,
  onSaveAsChannel
}: {
  conversations: readonly ConversationSummary[] | null
  now: number
  onOpen: () => void
  onOpenSettings: () => void
  onNewConversation: () => void
  onSaveAsChannel: (row: ConversationSummary) => void
}): JSX.Element {
  return (
    <section className="channel-list" aria-label="Conversations">
      <SettingsButton onClick={onOpenSettings} />
      {renderBody(conversations, now, onOpen, onSaveAsChannel)}
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
  onOpen: () => void,
  onSaveAsChannel: (row: ConversationSummary) => void
): JSX.Element | null {
  // Not-yet-loaded: neither rows nor the empty state (distinct from loaded-zero, per #208).
  if (conversations === null) return null
  // Loaded-zero: the empty state. Mobile #312's "Tap + to start a conversation" is adapted — the +
  // FAB is #142, so this copy references no affordance that isn't here yet.
  if (conversations.length === 0) {
    return <p className="channel-list__empty">No conversations yet</p>
  }
  const { channels, discussions } = partitionByPromotion(conversations)
  return (
    <>
      {channels.length > 0 && (
        <>
          <header className="channel-list__section-header">Channels</header>
          {/* Saved Channels are already promoted — they pass no onSaveAsChannel, so the affordance is
              structurally absent on their rows (AC1). */}
          {channels.map((c) => (
            <Row key={c.id} row={c} now={now} onOpen={onOpen} />
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
              onOpen={onOpen}
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
// The open action is its own button; the optional Save-as-channel affordance (#274) is a SIBLING, not a
// nested control — an interactive control cannot nest inside a <button>. `.channel-list__row` is a flex
// wrapper; the old row button-reset/hover/focus rules now live on `.channel-list__row-open`. Recent rows
// pass `onSaveAsChannel` → the affordance renders; saved Channel rows pass none → it is absent (AC1).
//
// `onClick={onOpen}` is deliberate and interim: per the ticket's Out of Scope, opening a *specific*
// tapped conversation needs a select-and-load transport path that does not exist, so every row invokes
// the shell's existing conversation-agnostic onOpen (which opens the single active conversation),
// preserving #140's list→thread round-trip with no new transport. The future select-and-load ticket
// changes only *what* onClick passes (this row's id); the seam is already the row.
function Row({
  row,
  now,
  onOpen,
  onSaveAsChannel
}: {
  row: ConversationSummary
  now: number
  onOpen: () => void
  onSaveAsChannel?: () => void
}): JSX.Element {
  const time = formatLastActivity(row.last_message_ts, now)
  return (
    <div className="channel-list__row">
      <button type="button" className="channel-list__row-open" onClick={onOpen}>
        <span className="channel-list__title">{titleFor(row.name)}</span>
        <span className="channel-list__time">{time}</span>
      </button>
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
