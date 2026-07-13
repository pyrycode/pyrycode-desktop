import './archive.css'
import { useState } from 'react'

// Client-owned copy — module-level constants (the SETTINGS_COPY idiom), never daemon strings. The
// scaffold renders no untrusted text, so there is no injection sink: this is why the slice is not
// security-sensitive.
const ARCHIVE_COPY = {
  title: 'Archived',
  back: 'Back'
} as const

/**
 * The two archive tabs, in Figma order (Channels then Discussions). The `tab.key` is the single source
 * that drives each tab's label, its `aria-selected`, and its click payload, so the active marker and the
 * click target cannot drift apart. Bare labels — the parenthesised counts (Figma "Channels (3)" /
 * "Discussions (8)", node 18-2) are #348, which mounts live counts + restore rows into the empty tab
 * body this slice leaves.
 */
export type ArchiveTab = 'channels' | 'discussions'

const ARCHIVE_TABS: readonly { key: ArchiveTab; label: string }[] = [
  { key: 'channels', label: 'Channels' },
  { key: 'discussions', label: 'Discussions' }
]

/**
 * The Archive screen (#347 scaffold) — the paired shell's `archive` view (Figma 18-2, chrome + the empty
 * two-tab segmented header). A pure component: it takes only an `onBack` callback and holds one
 * screen-local selection atom, so it is server-renderable with no store, transport, or IPC (AC5).
 *
 * `onBack` is REQUIRED chrome — the screen always renders its back affordance (like SettingsScreen,
 * unlike ConversationScreen's optional-gated one). PairedShellView binds it to the shared `back`
 * dispatch, which returns to the channel-home `list` view (the absolute `back` arm, AC2).
 */
export function ArchiveScreen({ onBack }: { onBack: () => void }): JSX.Element {
  // The only state: which tab is selected — screen-local ephemeral UI selection (ADR 0006), never the
  // session store, so it resets to `channels` when the screen remounts (re-opening Archive starts on
  // Channels). No effect, no window.pyry → server-renderable, defaulting to `channels` at first paint.
  const [selectedTab, setSelectedTab] = useState<ArchiveTab>('channels')
  return <ArchiveScreenView selectedTab={selectedTab} onSelectTab={setSelectedTab} onBack={onBack} />
}

/**
 * The pure view — props in, markup out, a pure function of `selectedTab`, so the tests server-render it
 * at both tab values without a DOM harness. The tablist derives each tab's label, `aria-selected`, and
 * click payload from the same `tab.key`, so the active marker and click target are structurally welded.
 * The tab panel is deliberately EMPTY — its `aria-labelledby` switches with the selection, which is what
 * proves "selecting a tab switches which body is shown"; #348 fills it (a pure function of `selectedTab`:
 * the channels-partition vs discussions-partition restore rows).
 */
export function ArchiveScreenView({
  selectedTab,
  onSelectTab,
  onBack
}: {
  selectedTab: ArchiveTab
  onSelectTab: (tab: ArchiveTab) => void
  onBack: () => void
}): JSX.Element {
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
            {tab.label}
          </button>
        ))}
      </div>
      <section
        className="archive__tab-panel"
        role="tabpanel"
        id="archive-tabpanel"
        aria-labelledby={`archive-tab-${selectedTab}`}
      />
    </section>
  )
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
