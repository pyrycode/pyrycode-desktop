import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ConversationSummary } from '@shared/wire/types'
import { ChannelListView } from './ChannelList'

// The #218 idiom: server-render the pure view with injected props — no DOM harness, no store. The
// container's store read + Date.now() are the only impurities and are exercised by the shell tests.
const noop = (): void => {}

// A fixed `now` so injected timestamps land in deterministic buckets.
const NOW = Date.parse('2026-01-15T12:00:00.000Z')
const isoAgo = (msAgo: number): string => new Date(NOW - msAgo).toISOString()

function row(over: Partial<ConversationSummary>): ConversationSummary {
  return {
    id: 'id',
    name: 'A conversation',
    is_promoted: false,
    is_archived: false,
    cwd: '/tmp',
    last_message_ts: isoAgo(5 * 60_000),
    last_used_at: isoAgo(5 * 60_000),
    ...over
  }
}

const render = (conversations: readonly ConversationSummary[] | null): string =>
  renderToStaticMarkup(
    <ChannelListView
      conversations={conversations}
      now={NOW}
      onOpen={noop}
      onOpenSettings={noop}
      onNewConversation={noop}
      onSaveAsChannel={noop}
    />
  )

// The new-discussion FAB's accessible name (#242) — present in every list state (AC1/AC4).
const FAB_MARKER = 'aria-label="New discussion"'

// The Settings entry affordance's accessible name (#333) — present in every list state, like the FAB.
const SETTINGS_ENTRY_MARKER = 'aria-label="Settings"'

// The per-row Save-as-channel affordance's accessible name (#274) — present on Recent (unpromoted)
// discussion rows, absent on saved Channel rows (AC1).
const SAVE_MARKER = 'aria-label="Save as channel"'

describe('ChannelListView', () => {
  it('not-yet-loaded (null): renders the wrapper but no header and no empty message (AC4)', () => {
    const markup = render(null)
    expect(markup).toContain('aria-label="Conversations"')
    expect(markup).not.toContain('Channels')
    expect(markup).not.toContain('Recent discussions')
    expect(markup).not.toContain('No conversations yet')
  })

  it('loaded-but-empty ([]): renders the empty state, no section headers (AC4)', () => {
    const markup = render([])
    expect(markup).toContain('No conversations yet')
    expect(markup).not.toContain('Recent discussions')
  })

  it('both sections present: both headers, a divider, rows in array order (AC2)', () => {
    const markup = render([
      row({ id: 'c1', name: 'kitchenclaw refactor', is_promoted: true }),
      row({ id: 'c2', name: 'leaky-faucet', is_promoted: true }),
      row({ id: 'd1', name: 'Help me debug auth flow', is_promoted: false })
    ])
    expect(markup).toContain('Channels')
    expect(markup).toContain('Recent discussions')
    expect(markup).toContain('channel-list__divider')
    // Array order preserved within the channels section.
    expect(markup.indexOf('kitchenclaw refactor')).toBeLessThan(markup.indexOf('leaky-faucet'))
  })

  it('channels only: the Channels header, no discussions header, no divider (AC2)', () => {
    const markup = render([row({ id: 'c1', name: 'only channel', is_promoted: true })])
    expect(markup).toContain('Channels')
    expect(markup).not.toContain('Recent discussions')
    expect(markup).not.toContain('channel-list__divider')
  })

  it('discussions only: the discussions header, no Channels header, no divider (AC2)', () => {
    const markup = render([row({ id: 'd1', name: 'only discussion', is_promoted: false })])
    expect(markup).toContain('Recent discussions')
    // The Channels header text must be absent — "Recent discussions" does not contain it.
    expect(markup).not.toContain('>Channels<')
    expect(markup).not.toContain('channel-list__divider')
  })

  it('renders the unnamed fallback for a null name, never a blank row (AC3)', () => {
    const markup = render([row({ id: 'd1', name: null })])
    expect(markup).toContain('Untitled')
  })

  it('renders the last-activity bucket for a row timestamp (AC3)', () => {
    const markup = render([row({ id: 'd1', name: 'x', last_message_ts: isoAgo(3 * 3_600_000) })])
    expect(markup).toContain('3h ago')
  })

  it('renders a malformed timestamp as no time text, never NaN', () => {
    const markup = render([row({ id: 'd1', name: 'x', last_message_ts: 'not-a-date' })])
    expect(markup).not.toContain('NaN')
  })

  it('escapes markup in an untrusted name — opaque text, never live markup', () => {
    // A prior desktop lesson: renderToStaticMarkup escapes `'` → `&#x27;`, so keep the fixture
    // apostrophe-free and assert the angle brackets are escaped.
    const markup = render([row({ id: 'd1', name: '<b>x</b>' })])
    expect(markup).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(markup).not.toContain('<b>x</b>')
  })

  it('renders the Save-as-channel affordance on a Recent (unpromoted) discussion row (AC1)', () => {
    const markup = render([row({ id: 'd1', name: 'a discussion', is_promoted: false })])
    expect(markup).toContain(SAVE_MARKER)
  })

  it('omits the Save-as-channel affordance on a saved (promoted) Channel row (AC1)', () => {
    const markup = render([row({ id: 'c1', name: 'a channel', is_promoted: true })])
    expect(markup).not.toContain(SAVE_MARKER)
  })

  it('renders the new-discussion FAB with its accessible name in all three list states (AC1/AC4)', () => {
    // The FAB is a sibling of the list body, so it is present whether the list is not-loaded, empty,
    // or populated — the affordance to start a conversation must always be reachable.
    expect(render(null)).toContain(FAB_MARKER)
    expect(render([])).toContain(FAB_MARKER)
    expect(render([row({ id: 'd1', name: 'a discussion' })])).toContain(FAB_MARKER)
  })

  it('renders the Settings entry with its accessible name in all three list states (#333 AC1)', () => {
    // Like the FAB, the Settings entry is a sibling of the list body, so it is reachable whether the
    // list is not-loaded, empty, or populated.
    expect(render(null)).toContain(SETTINGS_ENTRY_MARKER)
    expect(render([])).toContain(SETTINGS_ENTRY_MARKER)
    expect(render([row({ id: 'd1', name: 'a discussion' })])).toContain(SETTINGS_ENTRY_MARKER)
  })
})
