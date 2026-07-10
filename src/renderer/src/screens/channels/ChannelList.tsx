import './channels.css'
import type { ConversationSummary } from '@shared/wire/types'
import {
  useConversationListStore,
  selectConversations
} from '../../store/conversationListStore'
import { titleFor, partitionByPromotion, formatLastActivity } from './channelListViewModel'

// The Channel List home screen (#141) — the paired shell's `list` view, replacing the throwaway
// PlaceholderList (#140). A pure render slice over the already-shipped #208 conversationListStore: the
// container reads the slice, the pure ChannelListView renders it. No transport, IPC, store, or wire
// code is added (AC1). Mirrors the #203/#218 container-reads / pure-view split.
//
// The wire ConversationSummary carries no message text, so both Figma row shapes (avatar-bearing
// channel rows, preview-bearing discussion rows) collapse to a single title + last-activity-time row;
// the avatars, body previews, top app bar, "See all" link, and FAB are deferred to other tickets.

/**
 * Store-bound container. The store read and `Date.now()` are its only impurities — both safe under
 * `renderToStaticMarkup` in Node, where the store yields its initial `null` (the #218 container
 * posture), so the pure view is what the tests server-render with injected props.
 */
export function ChannelList({ onOpen }: { onOpen: () => void }): JSX.Element {
  const conversations = useConversationListStore(selectConversations)
  const now = Date.now()
  return <ChannelListView conversations={conversations} now={now} onOpen={onOpen} />
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
  onOpen
}: {
  conversations: readonly ConversationSummary[] | null
  now: number
  onOpen: () => void
}): JSX.Element {
  return (
    <section className="channel-list" aria-label="Conversations">
      {renderBody(conversations, now, onOpen)}
    </section>
  )
}

function renderBody(
  conversations: readonly ConversationSummary[] | null,
  now: number,
  onOpen: () => void
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
          {discussions.map((d) => (
            <Row key={d.id} row={d} now={now} onOpen={onOpen} />
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
// `onClick={onOpen}` is deliberate and interim: per the ticket's Out of Scope, opening a *specific*
// tapped conversation needs a select-and-load transport path that does not exist, so every row invokes
// the shell's existing conversation-agnostic onOpen (which opens the single active conversation),
// preserving #140's list→thread round-trip with no new transport. The future select-and-load ticket
// changes only *what* onClick passes (this row's id); the seam is already the row.
function Row({
  row,
  now,
  onOpen
}: {
  row: ConversationSummary
  now: number
  onOpen: () => void
}): JSX.Element {
  const time = formatLastActivity(row.last_message_ts, now)
  return (
    <button type="button" className="channel-list__row" onClick={onOpen}>
      <span className="channel-list__title">{titleFor(row.name)}</span>
      <span className="channel-list__time">{time}</span>
    </button>
  )
}
