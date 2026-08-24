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
      onOpenArchive={noop}
      onNewConversation={noop}
      onSaveAsChannel={noop}
      onRename={noop}
    />
  )

// The new-discussion FAB's accessible name (#242) — present in every list state (AC1/AC4).
const FAB_MARKER = 'aria-label="New discussion"'

// The Settings entry affordance's accessible name (#333) — present in every list state, like the FAB.
const SETTINGS_ENTRY_MARKER = 'aria-label="Settings"'

// The Archive entry affordance's accessible name (#347) — present in every list state, like the FAB and
// the Settings entry, and DISTINCT from the gear's aria-label="Settings".
const ARCHIVE_ENTRY_MARKER = 'aria-label="Archive"'

// The per-row Save-as-channel affordance's accessible name (#274) — present on Recent (unpromoted)
// discussion rows, absent on saved Channel rows (AC1).
const SAVE_MARKER = 'aria-label="Save as channel"'

// The per-row Rename affordance's accessible name (#360) — the symmetric counterpart to Save-as-channel:
// present on saved (promoted) Channel rows, absent on Recent (unpromoted) discussion rows (AC1).
const RENAME_MARKER = 'aria-label="Rename"'

// The host row heading each tree (#710) — structural class names, not copy. These are counted as EXACT
// attribute-value substrings: `renderToStaticMarkup` emits no comment markers, and the closing quote is
// what keeps `class="channel-list__host"` from also matching `__host-icon` / `__host-label` (and
// `class="channel-list__row"` from matching `__row-open`). That makes plain substring counting a precise
// structural assertion — which is the whole point for AC4/AC5, where the hazard is an added element
// joining an EXISTING Playwright locator's match set and raising a strict-mode violation.
const HOST_ROW_MARKER = 'class="channel-list__host"'
const HOST_ICON_MARKER = 'class="channel-list__host-icon"'
const HOST_LABEL_OPEN = 'class="channel-list__host-label">'
const SECTION_HEADER_MARKER = 'class="channel-list__section-header"'
const ROW_MARKER = 'class="channel-list__row"'
const ROW_OPEN_MARKER = 'class="channel-list__row-open"'

const countOf = (markup: string, needle: string): number => markup.split(needle).length - 1

// Reads the SHIPPED host labels back out of the render rather than restating the constant, so changing
// the copy to something containing a section label's text fails the AC4 guard instead of passing it.
const hostLabelsIn = (markup: string): string[] =>
  markup
    .split(HOST_LABEL_OPEN)
    .slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf('<')))

describe('ChannelListView', () => {
  it('not-yet-loaded (null): renders the wrapper but no header and no empty message (AC4)', () => {
    const markup = render(null)
    expect(markup).toContain('aria-label="Conversations"')
    expect(markup).not.toContain('Channels')
    expect(markup).not.toContain('Chats')
    expect(markup).not.toContain('No conversations yet')
  })

  it('loaded-but-empty ([]): renders the empty state, no section headers (AC4)', () => {
    const markup = render([])
    expect(markup).toContain('No conversations yet')
    expect(markup).not.toContain('Chats')
  })

  it('both sections present: both headers, a divider, rows in array order (AC2)', () => {
    const markup = render([
      row({ id: 'c1', name: 'kitchenclaw refactor', is_promoted: true }),
      row({ id: 'c2', name: 'leaky-faucet', is_promoted: true }),
      row({ id: 'd1', name: 'Help me debug auth flow', is_promoted: false })
    ])
    expect(markup).toContain('Channels')
    expect(markup).toContain('Chats')
    expect(markup).toContain('channel-list__divider')
    // Array order preserved within the channels section.
    expect(markup.indexOf('kitchenclaw refactor')).toBeLessThan(markup.indexOf('leaky-faucet'))
  })

  it('channels only: the Channels header, no discussions header, no divider (AC2)', () => {
    const markup = render([row({ id: 'c1', name: 'only channel', is_promoted: true })])
    expect(markup).toContain('Channels')
    expect(markup).not.toContain('Chats')
    expect(markup).not.toContain('channel-list__divider')
  })

  it('discussions only: the discussions header, no Channels header, no divider (AC2)', () => {
    const markup = render([row({ id: 'd1', name: 'only discussion', is_promoted: false })])
    // Anchored, not bare: `toContain('Chats')` would also pass against a header reading "Recent Chats",
    // so it cannot fail in the direction AC1 cares about. `renderToStaticMarkup` emits no comment markers
    // around a single static text child, so `>Chats<` pins the header's exact rendered text.
    expect(markup).toContain('>Chats<')
    // The Channels header text must be absent. Both are substring matches, and "Chats" and "Channels"
    // share only the prefix "Cha" — neither contains the other — so each assertion sees only its header.
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

  it('renders the Rename affordance on a saved (promoted) Channel row (AC1)', () => {
    const markup = render([row({ id: 'c1', name: 'a channel', is_promoted: true })])
    expect(markup).toContain(RENAME_MARKER)
  })

  it('omits the Rename affordance on a Recent (unpromoted) discussion row (AC1)', () => {
    const markup = render([row({ id: 'd1', name: 'a discussion', is_promoted: false })])
    expect(markup).not.toContain(RENAME_MARKER)
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

  it('does not render an archived row in the active list — regression for #366 AC (#469)', () => {
    // #366's AC "the archived conversation leaves the active channel list" was assumed free via the
    // #275 re-list, but the re-list returns the row still tagged is_archived. The active list must now
    // drop it: the live row's name renders, the archived row's name does not.
    const markup = render([
      row({ id: 'live', name: 'live-one', is_archived: false }),
      row({ id: 'gone', name: 'archived-one', is_archived: true })
    ])
    expect(markup).toContain('live-one')
    expect(markup).not.toContain('archived-one')
  })

  it('renders the empty state when every row is archived, not a blank body (#469)', () => {
    // A non-empty store where every row is archived: the raw-length guard would pass but the active
    // partition is empty. The empty state must show rather than a blank body (spec § 2).
    const markup = render([
      row({ id: 'a', name: 'archived-a', is_archived: true, is_promoted: true }),
      row({ id: 'b', name: 'archived-b', is_archived: true, is_promoted: false })
    ])
    expect(markup).toContain('No conversations yet')
    expect(markup).not.toContain('archived-a')
    expect(markup).not.toContain('archived-b')
  })

  it('renders the Archive entry with its accessible name in all three list states (#347 AC1)', () => {
    // Like the FAB and the Settings entry, the Archive entry lives in the top-right actions cluster — a
    // sibling of the list body — so it is reachable whether the list is not-loaded, empty, or populated.
    expect(render(null)).toContain(ARCHIVE_ENTRY_MARKER)
    expect(render([])).toContain(ARCHIVE_ENTRY_MARKER)
    expect(render([row({ id: 'd1', name: 'a discussion' })])).toContain(ARCHIVE_ENTRY_MARKER)
  })

  describe('the host row heading each tree (#710)', () => {
    // One row per tree, so the row counts under AC5 are the counts they had before this ticket.
    const bothTrees = (): string =>
      render([
        row({ id: 'c1', name: 'kitchenclaw refactor', is_promoted: true }),
        row({ id: 'd1', name: 'Help me debug auth flow', is_promoted: false })
      ])

    it('heads BOTH trees — one host row each, repeated on purpose (AC1)', () => {
      // The repetition is deliberate (operator, 2026-08-21): a "deduplicated" single host level shared
      // by the two trees fails here at 1.
      const markup = bothTrees()
      expect(countOf(markup, HOST_ROW_MARKER)).toBe(2)
      expect(countOf(markup, HOST_ICON_MARKER)).toBe(2)
    })

    it('heads a single present tree with exactly one host row (AC1)', () => {
      expect(countOf(render([row({ id: 'c1', is_promoted: true })]), HOST_ROW_MARKER)).toBe(1)
      expect(countOf(render([row({ id: 'd1', is_promoted: false })]), HOST_ROW_MARKER)).toBe(1)
    })

    it('sits below its section label and above that tree conversation rows (AC1)', () => {
      const markup = bothTrees()
      expect(markup.indexOf('>Channels<')).toBeLessThan(markup.indexOf(HOST_ROW_MARKER))
      expect(markup.indexOf(HOST_ROW_MARKER)).toBeLessThan(markup.indexOf(ROW_MARKER))
    })

    it('renders no host row when the list is empty or not yet loaded (AC3)', () => {
      // A tree with zero rows renders neither a section label nor a host row — both promote specs use
      // "a zero-row section renders no header" as their proxy for "the row moved sections", so an
      // always-present host row would dissolve that proof.
      expect(countOf(render(null), HOST_ROW_MARKER)).toBe(0)
      expect(countOf(render([]), HOST_ROW_MARKER)).toBe(0)
    })

    it('leaves each section label singly selectable (AC4)', () => {
      const markup = bothTrees()
      // The invariant #709's spec parked for this ticket: still exactly two section-header elements, so
      // the promote specs' `.channel-list__section-header` + hasText locators stay single-match.
      expect(countOf(markup, SECTION_HEADER_MARKER)).toBe(2)
      // The independent second guard: Playwright's `hasText` with a string matches substrings
      // case-INsensitively, so the shipped label must contain neither section label's text either way.
      const labels = hostLabelsIn(markup)
      expect(labels).toHaveLength(2)
      for (const label of labels) {
        expect(label.toLowerCase()).not.toContain('channels')
        expect(label.toLowerCase()).not.toContain('chats')
      }
    })

    it('does not join the conversation-row match set (AC5)', () => {
      // The unit-level mirror of the 28-spec fixture hazard: `launchPairedApp.ts:224` clicks an
      // UNFILTERED `.channel-list__row-open`, so a host row selectable as a conversation row would
      // strict-violate at launch in every spec riding that fixture, not fail an assertion in two.
      const markup = bothTrees()
      expect(countOf(markup, ROW_MARKER)).toBe(2)
      expect(countOf(markup, ROW_OPEN_MARKER)).toBe(2)
    })
  })
})
