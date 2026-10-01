import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ConversationSummary } from '@shared/wire/types'
import {
  ArchiveScreen,
  ArchiveScreenView,
  requestUnarchiveConversation,
  type ArchiveTab
} from './ArchiveScreen'
import { UNNAMED_LABEL } from '../channels/channelListViewModel'

// The #218 idiom: server-render the pure view with injected callbacks — no DOM harness, no store, no
// live connection. ArchiveScreenView is a pure function of `selectedTab` + the injected conversations
// (props in, markup out), so a server-rendered string at each tab value proves the chrome, the two-tab
// header (now with live counts), the archived restore rows, and the tab-switch. The click glue (a
// tab's onClick invoking onSelectTab; a restore button invoking onRestore) is closed by composition —
// the click payload and the active marker both derive from the same tab.key, and the restore dispatch
// is pinned directly via requestUnarchiveConversation below — exactly as ChannelList.test.tsx never
// fires SaveAsChannel's click.
const noop = (): void => {}

// Row factory cloned from channelListViewModel.test.ts — only the fields the view reads matter.
function row(over: Partial<ConversationSummary>): ConversationSummary {
  return {
    id: 'id',
    name: null,
    is_promoted: false,
    is_archived: false,
    cwd: '/tmp',
    last_message_ts: '2026-02-13T12:00:00.000Z',
    last_used_at: '2026-02-13T12:00:00.000Z',
    workspace_label: null,
    ...over
  }
}

// A fixed `now` two days after the fixtures' last activity, so an archived row's subtitle reads a
// deterministic "Archived 2 days ago".
const NOW = Date.parse('2026-02-15T12:00:00.000Z')

// A loaded list: two archived channels (one with a null name), one archived discussion, and one live
// (non-archived) channel that must be filtered out of both tabs.
const loadedList: readonly ConversationSummary[] = [
  row({ id: 'ac1', name: 'alpha-channel', is_archived: true, is_promoted: true }),
  row({ id: 'ac2', name: null, is_archived: true, is_promoted: true }),
  row({ id: 'ad1', name: 'beta-discussion', is_archived: true, is_promoted: false }),
  row({ id: 'live', name: 'live-channel', is_archived: false, is_promoted: true })
]

const renderView = (
  selectedTab: ArchiveTab,
  conversations: readonly ConversationSummary[] | null = null,
  now = 0
): string =>
  renderToStaticMarkup(
    <ArchiveScreenView
      selectedTab={selectedTab}
      onSelectTab={noop}
      onBack={noop}
      conversations={conversations}
      now={now}
      onRestore={noop}
    />
  )

const countOccurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1

describe('ArchiveScreenView', () => {
  it('renders the "Archived" title (AC2)', () => {
    expect(renderView('channels')).toContain('>Archived</h1>')
  })

  it('renders the back affordance with its accessible name (AC2)', () => {
    expect(renderView('channels')).toContain('aria-label="Back"')
  })

  it('renders the root region marker for the screen (AC5)', () => {
    expect(renderView('channels')).toContain('aria-label="Archive screen"')
  })

  it('renders both tab labels in Figma order (Channels then Discussions) (AC2)', () => {
    const markup = renderView('channels')
    expect(markup).toContain('>Channels</button>')
    expect(markup).toContain('>Discussions</button>')
    // Figma order: Channels precedes Discussions.
    expect(markup.indexOf('>Channels</button>')).toBeLessThan(
      markup.indexOf('>Discussions</button>')
    )
  })

  it('marks exactly one tab selected — Channels at selectedTab=channels (AC4)', () => {
    const markup = renderView('channels')
    expect(countOccurrences(markup, 'aria-selected="true"')).toBe(1)
    expect(countOccurrences(markup, 'aria-selected="false"')).toBe(1)
    // The selected tab is Channels: its button carries aria-selected="true".
    expect(markup).toContain('id="archive-tab-channels" aria-selected="true"')
  })

  it('shows the channels body when Channels is selected — the panel labelled by the channels tab (AC4)', () => {
    expect(renderView('channels')).toContain('aria-labelledby="archive-tab-channels"')
  })

  it('switches the selected tab and the shown body when Discussions is selected (AC4)', () => {
    const markup = renderView('discussions')
    // Still exactly one selected, now flipped to Discussions.
    expect(countOccurrences(markup, 'aria-selected="true"')).toBe(1)
    expect(markup).toContain('id="archive-tab-discussions" aria-selected="true"')
    // The tab body is now labelled by the discussions tab — proving the shown body is a pure function
    // of the selection.
    expect(markup).toContain('aria-labelledby="archive-tab-discussions"')
  })

  it('shows each tab its own live archived count in its label (AC2)', () => {
    // Two archived channels, one archived discussion; the live row is excluded from both.
    const markup = renderView('channels', loadedList, NOW)
    expect(markup).toContain('>Channels (2)</button>')
    expect(markup).toContain('>Discussions (1)</button>')
  })

  it('lists one restore row per archived conversation of the selected kind (AC3, AC4)', () => {
    const markup = renderView('channels', loadedList, NOW)
    // Each archived channel's title, including the untitled fallback for the null-name row (AC3).
    expect(markup).toContain('alpha-channel')
    expect(markup).toContain(UNNAMED_LABEL)
    // The subtitle labels the row as archived and shows the legacy last-use relative time (AC3).
    expect(markup).toContain('Archived 2 days ago')
    // One accessible restore control per archived channel (AC4); the archived discussion is not here.
    expect(countOccurrences(markup, 'aria-label="Restore"')).toBe(2)
    expect(markup).not.toContain('beta-discussion')
  })

  it('lists the archived discussions (not the channels) when Discussions is selected (AC4)', () => {
    const markup = renderView('discussions', loadedList, NOW)
    expect(markup).toContain('beta-discussion')
    expect(countOccurrences(markup, 'aria-label="Restore"')).toBe(1)
    expect(markup).not.toContain('alpha-channel')
  })

  it('renders a per-tab empty state when the selected kind has zero archived rows (AC5)', () => {
    // Only an archived discussion — the Channels tab has zero of its kind.
    const onlyDiscussion = [row({ id: 'ad', is_archived: true, is_promoted: false })]
    const channels = renderView('channels', onlyDiscussion, NOW)
    expect(channels).toContain('No archived channels')
    expect(countOccurrences(channels, 'aria-label="Restore"')).toBe(0)
    // And the mirror: only an archived channel → the Discussions tab is empty.
    const onlyChannel = [row({ id: 'ac', is_archived: true, is_promoted: true })]
    expect(renderView('discussions', onlyChannel, NOW)).toContain('No archived discussions')
  })

  it('renders a neutral first paint when the list is not yet loaded (AC5)', () => {
    // conversations === null: bare labels (no counts), no restore rows, no empty-state copy.
    const markup = renderView('channels', null, NOW)
    expect(markup).toContain('>Channels</button>')
    expect(markup).not.toContain('(0)')
    expect(countOccurrences(markup, 'aria-label="Restore"')).toBe(0)
    expect(markup).not.toContain('No archived')
  })
})

describe('ArchiveScreen', () => {
  it('enters with the Channels tab selected — the panel labelled by the channels tab (AC4)', () => {
    // Mirrors PairedShell's "enters at the list" container test: the container holds the only state
    // (selectedTab) and defaults to `channels`, so a server render shows the channels body first.
    const markup = renderToStaticMarkup(<ArchiveScreen onBack={noop} />)
    expect(markup).toContain('aria-labelledby="archive-tab-channels"')
    expect(markup).toContain('id="archive-tab-channels" aria-selected="true"')
  })
})

describe('requestUnarchiveConversation', () => {
  it('dispatches the unarchiveConversation command for the row id, fire-and-forget (AC4)', () => {
    const fakeSend = vi.fn()
    requestUnarchiveConversation(fakeSend, 'conv-42')
    expect(fakeSend).toHaveBeenCalledTimes(1)
    expect(fakeSend).toHaveBeenCalledWith({
      type: 'unarchiveConversation',
      payload: { conversation_id: 'conv-42' }
    })
  })
})


describe('archive subtitle source', () => {
  it.each([true, false])('uses archive time rather than weeks-old message/use time, promoted=%s', (is_promoted) => {
    const markup = renderView(is_promoted ? 'channels' : 'discussions', [row({
      is_promoted, is_archived: true, archived_at: '2026-02-15T11:55:00Z',
      last_used_at: '2026-01-01T00:00:00Z', last_message_ts: '2025-12-01T00:00:00Z'
    })], NOW)
    expect(markup).toContain('>Archived 5m ago</span>')
    expect(markup).not.toContain('Archived Jan 1')
    expect(markup).not.toContain('Archived Dec 1')
  })
  it.each([undefined, null, 'bad', '2026-02-15'])('falls back to last use for %s', (archived_at) => {
    const markup = renderView('channels', [row({
      is_promoted: true, is_archived: true, archived_at,
      last_used_at: '2026-02-13T12:00:00Z', last_message_ts: '2026-01-01T00:00:00Z'
    })], NOW)
    expect(markup).toContain('>Archived 2 days ago</span>')
  })
  it('renders bare Archived when both candidate timestamps fail', () => {
    expect(renderView('discussions', [row({ is_archived: true, archived_at: 'bad', last_used_at: 'bad' })], NOW)).toContain('>Archived</span>')
  })
})
