import './archive.css'
import { useState } from 'react'
import type { ConversationSummary } from '@shared/wire/types'
import type { RendererCommand } from '@shared/ipc/commands'
import {
  useConversationListStore,
  selectConversations
} from '../../store/conversationListStore'
import { titleFor } from '../channels/channelListViewModel'
import { partitionArchived, archivedSubtitle, tabCountLabel } from './archiveViewModel'

// Client-owned copy — module-level constants (the SETTINGS_COPY idiom), never daemon strings. The row
// titles/subtitles render untrusted daemon-derived strings as auto-escaped React children (opaque
// text, never dangerouslySetInnerHTML), so there is still no injection sink: this is why the slice is
// not security-sensitive. `restore` names the icon-only restore control (its accessible name); the two
// `empty*` strings are the per-tab loaded-zero empty states.
const ARCHIVE_COPY = {
  title: 'Archived',
  back: 'Back',
  restore: 'Restore',
  emptyChannels: 'No archived channels',
  emptyDiscussions: 'No archived discussions'
} as const

/**
 * The two archive tabs, in Figma order (Channels then Discussions). The `tab.key` is the single source
 * that drives each tab's label, its `aria-selected`, its click payload, AND — via `partition[tab.key]`
 * (#348) — its live count and its restore-row body, so the active marker, the count, and the shown
 * body cannot drift apart. The union members are exactly the keys `partitionArchived` returns.
 */
export type ArchiveTab = 'channels' | 'discussions'

const ARCHIVE_TABS: readonly { key: ArchiveTab; label: string }[] = [
  { key: 'channels', label: 'Channels' },
  { key: 'discussions', label: 'Discussions' }
]

/**
 * The Archive screen — the paired shell's `archive` view (Figma 18-2). The #347 scaffold gave it the
 * chrome + two-tab segmented header; #348 fills the tab body with live per-tab counts and restore rows,
 * derived purely from the already-live conversationListStore (no new read, store, or bridge — the
 * archived rows arrive via `is_archived` in the `list_conversations` reply).
 *
 * Container: it holds the screen-local tab selection AND reads the store. The store read and
 * `Date.now()` are its only impurities — both safe under `renderToStaticMarkup` in Node, where the
 * store yields its initial `null` (the ChannelList container posture), so the pure view is what the
 * tests server-render with injected props. `onRestore` dereferences `window.pyry` only inside the click
 * arrow (never during render), so the server-render smoke is untouched.
 *
 * `onBack` is REQUIRED chrome — the screen always renders its back affordance (like SettingsScreen).
 * PairedShellView binds it to the shared `back` dispatch, which returns to the channel-home `list` view
 * (the absolute `back` arm, AC2). `selectedTab` is screen-local ephemeral UI selection (ADR 0006),
 * never the session store, so it resets to `channels` when the screen remounts.
 */
export function ArchiveScreen({ onBack }: { onBack: () => void }): JSX.Element {
  const [selectedTab, setSelectedTab] = useState<ArchiveTab>('channels')
  const conversations = useConversationListStore(selectConversations)
  const now = Date.now()
  return (
    <ArchiveScreenView
      selectedTab={selectedTab}
      onSelectTab={setSelectedTab}
      onBack={onBack}
      conversations={conversations}
      now={now}
      onRestore={(id) => requestUnarchiveConversation(window.pyry.sendCommand, id)}
    />
  )
}

/**
 * The pure view — props in, markup out, a pure function of `selectedTab` and the injected
 * `conversations`, so the tests server-render it at both tab values without a DOM harness. It partitions
 * the archived rows once: `null` (not yet loaded) stays `null` so the counts and the body both render
 * their neutral first-paint posture. Each tab's label carries its live count and the panel renders the
 * selected tab's restore rows — both indexed by the same `tab.key`, structurally welding count and body.
 */
export function ArchiveScreenView({
  selectedTab,
  onSelectTab,
  onBack,
  conversations,
  now,
  onRestore
}: {
  selectedTab: ArchiveTab
  onSelectTab: (tab: ArchiveTab) => void
  onBack: () => void
  conversations: readonly ConversationSummary[] | null
  now: number
  onRestore: (id: string) => void
}): JSX.Element {
  const partition = conversations === null ? null : partitionArchived(conversations)
  return (
    <section className="archive" aria-label="Archive screen">
      <div className="archive__topbar">
        <BackControl onBack={onBack} />
        <h1 className="archive__title">{ARCHIVE_COPY.title}</h1>
      </div>
      <div className="archive__tabs" role="tablist">
        {ARCHIVE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`archive-tab-${tab.key}`}
            aria-selected={tab.key === selectedTab}
            aria-controls="archive-tabpanel"
            className="archive__tab"
            onClick={() => onSelectTab(tab.key)}
          >
            {tabCountLabel(tab.label, partition === null ? null : partition[tab.key].length)}
          </button>
        ))}
      </div>
      <section
        className="archive__tab-panel"
        role="tabpanel"
        id="archive-tabpanel"
        aria-labelledby={`archive-tab-${selectedTab}`}
      >
        {renderArchivePanel(
          selectedTab,
          partition === null ? null : partition[selectedTab],
          now,
          onRestore
        )}
      </section>
    </section>
  )
}

// The selected tab's body — the ChannelList `renderBody` tri-state, per tab:
//  - `null` (not-yet-loaded) → no rows and no empty state (the neutral first paint, AC5). Theoretical:
//    reaching Archive means the list is already loaded, so `null` is not a hot path.
//  - `[]` (loaded, zero of this kind) → the per-tab empty state (AC5), never a blank body.
//  - non-empty → one ArchiveRow per archived conversation of this kind (AC3).
function renderArchivePanel(
  selectedTab: ArchiveTab,
  rows: readonly ConversationSummary[] | null,
  now: number,
  onRestore: (id: string) => void
): JSX.Element | null {
  if (rows === null) return null
  if (rows.length === 0) {
    return <p className="archive__empty">{emptyCopyFor(selectedTab)}</p>
  }
  return (
    <>
      {rows.map((row) => (
        <ArchiveRow key={row.id} row={row} now={now} onRestore={onRestore} />
      ))}
    </>
  )
}

// The per-tab empty-state copy — client-owned, selected by the same `tab.key` that drives the body.
function emptyCopyFor(tab: ArchiveTab): string {
  return tab === 'channels' ? ARCHIVE_COPY.emptyChannels : ARCHIVE_COPY.emptyDiscussions
}

// One archived row (Figma 18-19) — a flex row: a text column (title over the "Archived …" subtitle) and
// a trailing restore control. `name` and `last_message_ts` are untrusted daemon-derived strings rendered
// as auto-escaped React children (never dangerouslySetInnerHTML) — opaque text. `titleFor` guards a
// null/blank name (never a blank row, AC3); `archivedSubtitle` composes the last-activity relative time
// without doubling "ago". The restore control is a SIBLING of the text column, not nested, and its click
// dispatches unarchive fire-and-forget — the row's departure and the recomputed counts arrive later via
// the daemon's `conversation_updated` → re-list path (AC4), not synchronously here.
function ArchiveRow({
  row,
  now,
  onRestore
}: {
  row: ConversationSummary
  now: number
  onRestore: (id: string) => void
}): JSX.Element {
  return (
    <div className="archive__row">
      <div className="archive__row-text">
        <span className="archive__row-title">{titleFor(row.name)}</span>
        <span className="archive__subtitle">{archivedSubtitle(row.last_message_ts, now)}</span>
      </div>
      <RestoreControl onClick={() => onRestore(row.id)} />
    </div>
  )
}

// The restore affordance (Figma 18-23/18-24) — an icon-only button, cloned from the ChannelList save
// affordance / #347 BackControl idiom: `aria-label` supplies the accessible name (AC4) since the glyph
// carries no text, and the SVG is aria-hidden. The 24px Material `replay` glyph is a counter-clockwise
// restore circular arrow — a reasonable stand-in for the ~22px Figma undo/restore arrow (not load-
// bearing: the accessible name comes from the aria-label, not the glyph).
function RestoreControl({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="archive__restore"
      aria-label={ARCHIVE_COPY.restore}
      onClick={onClick}
    >
      <svg
        className="archive__restore-icon"
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
      </svg>
    </button>
  )
}

/**
 * Fire the `unarchiveConversation` command (#346 wired the main side through to the daemon). An inline
 * literal typed as RendererCommand — no constructor added, keeping the change renderer-contained, exactly
 * as `requestPromoteConversation` inlines its command. A single REQUIRED string payload
 * (`conversation_id ← row.id`). Fire-and-forget, like the composer's send and promote: `sendCommand`
 * returns `void`. The restored row leaves the archived subset and both counts recompute later, event-
 * driven, via the daemon's `conversation_updated` broadcast → the existing list bridge re-request.
 */
export function requestUnarchiveConversation(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string
): void {
  sendCommand({ type: 'unarchiveConversation', payload: { conversation_id: conversationId } })
}

// The leading back affordance of the Archive top bar (Figma 18:4 → arrow_back 18:5). Cloned verbatim
// from SettingsScreen's BackControl (same arrow_back glyph, same aria); unconditional — the screen
// always renders it, so onBack is required, not optional-gated. Icon-only, so aria-label supplies the
// accessible name (the .composer__send pattern); the SVG is aria-hidden.
function BackControl({ onBack }: { onBack: () => void }): JSX.Element {
  return (
    <button type="button" className="archive__back" aria-label={ARCHIVE_COPY.back} onClick={onBack}>
      <svg
        className="archive__back-icon"
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
      </svg>
    </button>
  )
}
