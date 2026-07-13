import { useConversationListStore, selectArchivedCount } from '../../store/conversationListStore'

// Client-owned copy — module-level constants (the SERVER_ROW_LABEL idiom), never daemon strings. The
// placeholder is the U+2014 em dash: a purposeful "not yet loaded" line (the conversation list arrives a
// tick after Settings mounts), apostrophe-free so renderToStaticMarkup leaves it untouched. "archived"
// is a past-participle state, not a countable noun, so the count line is uniformly `${n} archived` for
// every n including 0 and 1 (Figma 17:96 reads "11 archived") — no singular/plural branch.
const ARCHIVED_ROW_LABEL = 'Archived conversations'
const ARCHIVED_ROW_PLACEHOLDER = '—'
const archivedCountLine = (count: number): string => `${count} archived`

/**
 * The Storage section's archived-count row (Figma 17:93) — the pure, exported, props-in/markup-out view.
 * The ServerRow precedent (#334): a dumb view whose null/count matrix is proven by directly
 * server-rendering it with injected props, kept separate from the store-bound container so SettingsScreen
 * stays server-renderable.
 *
 * Always renders the "Archived conversations" label. When `archivedCount` is a number, renders the count
 * line beneath it; when `null` (list not yet loaded), renders the neutral placeholder in its place — never
 * "0 archived", since 0 is a real loaded value and null is "not yet loaded". The mobile row's trailing nav
 * chevron (17:97) is omitted — desktop has no archive screen for it to navigate to yet (that lands in #347).
 */
export function ArchivedCountRow({
  archivedCount
}: {
  archivedCount: number | null
}): JSX.Element {
  return (
    <div className="settings__storage-row">
      <div className="settings__storage-row-text">
        <p className="settings__storage-row-label">{ARCHIVED_ROW_LABEL}</p>
        <p className="settings__storage-row-count">
          {archivedCount === null ? ARCHIVED_ROW_PLACEHOLDER : archivedCountLine(archivedCount)}
        </p>
      </div>
    </div>
  )
}

/**
 * The store-bound container (the ServerRowControl posture) — reads the derived count via the store's own
 * `selectArchivedCount` selector and hands it to the pure view. No effects, no window.pyry, no IPC: a pure
 * read. The conversation list is kept live app-level by ConversationListData (requested on connect,
 * re-listed on every conversationUpdated broadcast incl. archive/restore), so the count reflects the
 * latest store state on every render (AC2) with no data path added here.
 */
export function ArchivedCountRowControl(): JSX.Element {
  const archivedCount = useConversationListStore(selectArchivedCount)
  return <ArchivedCountRow archivedCount={archivedCount} />
}
