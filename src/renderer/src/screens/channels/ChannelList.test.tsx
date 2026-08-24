import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ConversationSummary } from '@shared/wire/types'
import { ChannelListView, CollapsibleWorkspaceGroup, HostConnectionDots } from './ChannelList'
import { UNKNOWN_WORKSPACE_LABEL } from './channelListViewModel'
import type { ConnectionLeg } from '../conversation/ConversationScreen'

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

// The workspace row heading each group under a host row (#703) — structural class names, counted as the
// same EXACT attribute-value substrings, so `class="channel-list__workspace"` cannot also match
// `__workspace-icon` / `__workspace-label`.
const WORKSPACE_ROW_MARKER = 'class="channel-list__workspace"'
const WORKSPACE_LABEL_OPEN = 'class="channel-list__workspace-label">'

// The disclosure state the workspace row carries once it becomes a collapse control (#704). React
// serialises `aria-expanded={boolean}` to the literal strings "true" / "false", so these are exact
// attribute-value substrings like every marker above.
const EXPANDED_MARKER = 'aria-expanded="true"'
const COLLAPSED_MARKER = 'aria-expanded="false"'

// The two connection dots ending each host row (#718). These are the FULL attribute value, not the usual
// one-class prefix: the dot wears the geometry class AND #330's shipped colour modifier, so
// `class="channel-list__host-dot"` with its closing quote would silently match NOTHING — the quote follows
// the LAST class. Pinning the whole value is the stronger assertion anyway, since one marker then fixes the
// geometry class and the category → colour binding together.
const DOT_UP_MARKER = 'class="channel-list__host-dot conn-dot--up"'
const DOT_IN_PROGRESS_MARKER = 'class="channel-list__host-dot conn-dot--in-progress"'
const DOT_DOWN_MARKER = 'class="channel-list__host-dot conn-dot--down"'

// The pair's layout wrapper carries a sole class, so the file's usual exact-substring form applies to it.
const DOT_WRAPPER_MARKER = 'class="channel-list__host-status"'

const countOf = (markup: string, needle: string): number => markup.split(needle).length - 1

// Reads the SHIPPED host labels back out of the render rather than restating the constant, so changing
// the copy to something containing a section label's text fails the AC4 guard instead of passing it.
const hostLabelsIn = (markup: string): string[] =>
  markup
    .split(HOST_LABEL_OPEN)
    .slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf('<')))

// The same read-it-back-out-of-the-render treatment for the workspace labels (#703). It matters more
// here than for the host row: this label is DAEMON-derived, so the fixture — not a constant — decides
// what renders, and the assertions must see the shipped text rather than restate an expectation.
const workspaceLabelsIn = (markup: string): string[] =>
  markup
    .split(WORKSPACE_LABEL_OPEN)
    .slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf('<')))

// Slices out each workspace row's OPENING TAG (#704) so its attribute set can be asserted WHOLE. The
// assertion has to be tag-scoped rather than document-scoped: `aria-label` and `title` legitimately
// appear elsewhere in the very same render (the FAB, the gear, Archive, Rename, Save-as), so a
// document-wide `not.toContain('aria-label')` would be plain wrong rather than strict — and weakening it
// back into vacuity is the failure mode this helper exists to prevent. Scanning to the next `>` is exact
// rather than approximate: React escapes `<` and `>` inside attribute VALUES too, so no value — however
// hostile the `cwd` behind it — can carry either delimiter into the slice.
const workspaceRowTagsIn = (markup: string): string[] => {
  const tags: string[] = []
  for (let at = markup.indexOf(WORKSPACE_ROW_MARKER); at !== -1; ) {
    const end = markup.indexOf('>', at)
    tags.push(markup.slice(markup.lastIndexOf('<', at), end + 1))
    at = markup.indexOf(WORKSPACE_ROW_MARKER, end)
  }
  return tags
}

// The same tag-slicing treatment for the connection dots (#718), so each dot's role and accessible name
// are read back OUT of the render rather than restated. The prefix keeps its trailing SPACE on purpose:
// the geometry class never appears alone, so this can match neither the pair's wrapper nor a label.
const DOT_TAG_PREFIX = 'class="channel-list__host-dot '
const hostDotTagsIn = (markup: string): string[] => {
  const tags: string[] = []
  for (let at = markup.indexOf(DOT_TAG_PREFIX); at !== -1; ) {
    const end = markup.indexOf('>', at)
    tags.push(markup.slice(markup.lastIndexOf('<', at), end + 1))
    at = markup.indexOf(DOT_TAG_PREFIX, end)
  }
  return tags
}

// One dot tag's accessible name. Scanning to the next `"` is exact rather than approximate: React escapes
// a quote inside an attribute VALUE as `&quot;`, so no label can carry the delimiter into the slice.
const ariaLabelOf = (tag: string): string => {
  const at = tag.indexOf('aria-label="') + 'aria-label="'.length
  return tag.slice(at, tag.indexOf('"', at))
}

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

  describe('the workspace grouping under each host row (#703)', () => {
    // One row per tree, both in the SAME workspace — so the counts the #710 guards pinned are the counts
    // this describe expects too, and one group per tree is the shape the default e2e tier actually has.
    const bothTrees = (): string =>
      render([
        row({ id: 'c1', name: 'kitchenclaw refactor', is_promoted: true, cwd: '/home/me/alpha' }),
        row({ id: 'd1', name: 'Help me debug auth flow', is_promoted: false, cwd: '/home/me/alpha' })
      ])

    it('renders one workspace row per distinct cwd, in each tree independently (AC1)', () => {
      // Both trees sharing one workspace: one workspace row each. The trees are not deduplicated — a
      // workspace with rows in both trees appears in both (operator, 2026-08-21).
      const shared = render([
        row({ id: 'c1', is_promoted: true, cwd: '/home/me/alpha' }),
        row({ id: 'c2', is_promoted: true, cwd: '/home/me/alpha' }),
        row({ id: 'd1', is_promoted: false, cwd: '/home/me/alpha' })
      ])
      expect(countOf(shared, WORKSPACE_ROW_MARKER)).toBe(2)
      // Splitting the promoted pair across two workspaces adds a third group, in the Channels tree only.
      const split = render([
        row({ id: 'c1', is_promoted: true, cwd: '/home/me/alpha' }),
        row({ id: 'c2', is_promoted: true, cwd: '/home/me/beta' }),
        row({ id: 'd1', is_promoted: false, cwd: '/home/me/alpha' })
      ])
      expect(countOf(split, WORKSPACE_ROW_MARKER)).toBe(3)
      expect(workspaceLabelsIn(split)).toEqual(['alpha', 'beta', 'alpha'])
    })

    it('sits below its tree host row and above that group conversation rows (AC1)', () => {
      const markup = bothTrees()
      expect(markup.indexOf('>Channels<')).toBeLessThan(markup.indexOf(HOST_ROW_MARKER))
      expect(markup.indexOf(HOST_ROW_MARKER)).toBeLessThan(markup.indexOf(WORKSPACE_ROW_MARKER))
      expect(markup.indexOf(WORKSPACE_ROW_MARKER)).toBeLessThan(markup.indexOf(ROW_MARKER))
    })

    it('renders no workspace row when the list is empty or not yet loaded', () => {
      // The workspace rows live INSIDE each section's existing `length > 0` gate, alongside the host
      // row, so a zero-row tree renders no section label, no host row and no workspace row either.
      expect(countOf(render(null), WORKSPACE_ROW_MARKER)).toBe(0)
      expect(countOf(render([]), WORKSPACE_ROW_MARKER)).toBe(0)
    })

    it('joins no existing conversation-row, section-header or host-row match set', () => {
      // The unit-level mirror of the 28-spec fixture hazard: `launchPairedApp.ts:224` clicks an
      // UNFILTERED `.channel-list__row-open`, so a workspace row selectable as a conversation row would
      // strict-violate at launch in every spec riding that fixture. Every count below is the count it
      // had before this ticket.
      const markup = bothTrees()
      expect(countOf(markup, ROW_MARKER)).toBe(2)
      expect(countOf(markup, ROW_OPEN_MARKER)).toBe(2)
      expect(countOf(markup, SECTION_HEADER_MARKER)).toBe(2)
      expect(countOf(markup, HOST_ROW_MARKER)).toBe(2)
    })

    it('renders an untrusted cwd as escaped text, never live markup and never an attribute', () => {
      // The twin of the untrusted-`name` test above. The label is the one place `cwd` becomes visible:
      // an auto-escaped React child and nothing else — CLAUDE.md's 2026-08-20 ruling forbids it reaching
      // an attribute, and #696's security review rejected `title={daemonText}` as a MUST FIX.
      const markup = render([
        row({ id: 'd1', name: 'x', cwd: '/home/me/<img src=x onerror=boom>' })
      ])
      expect(markup).toContain('&lt;img src=x onerror=boom&gt;')
      expect(markup).not.toContain('<img src=x onerror=boom>')
      expect(markup).not.toContain('title=')
    })

    it('renders one clearly-labelled fallback group for a cwd with no usable segment (AC3)', () => {
      // Read back out of the render rather than restated, so the row is proven present AND labelled —
      // never silently dropped, never blank.
      const markup = render([row({ id: 'd1', name: 'x', cwd: '/' })])
      expect(workspaceLabelsIn(markup)).toEqual([UNKNOWN_WORKSPACE_LABEL])
      expect(markup).toContain('x')
    })
  })

  describe('the workspace row as a collapse control (#704)', () => {
    // The #703 shape verbatim — one row per tree, both in the SAME workspace — so every count that
    // describe pins is the count this one sees, plus the disclosure state this ticket adds.
    const bothTrees = (): string =>
      render([
        row({ id: 'c1', name: 'kitchenclaw refactor', is_promoted: true, cwd: '/home/me/alpha' }),
        row({ id: 'd1', name: 'Help me debug auth flow', is_promoted: false, cwd: '/home/me/alpha' })
      ])

    it('renders every workspace row as a real button, expanded, on a fresh render (AC4/AC5)', () => {
      const markup = bothTrees()
      const tags = workspaceRowTagsIn(markup)
      expect(tags).toHaveLength(2)
      for (const tag of tags) {
        // A <div onClick> would fail here and nowhere else in this tier — the unit tier cannot click,
        // so "focusable and operable by keyboard" is proven as the ELEMENT plus its state attribute
        // here, and as an actual keypress in e2e/workspace-collapse.spec.ts.
        expect(tag.startsWith('<button ')).toBe(true)
        expect(tag).toContain('type="button"')
        expect(tag).toContain(EXPANDED_MARKER)
      }
      // No group can start folded: the only collapse path is a click, and no store, no persisted value
      // and no prop from `renderBody` can pre-seed one (AC4).
      expect(markup).not.toContain(COLLAPSED_MARKER)
    })

    it('carries no attribute able to take the daemon-derived label (AC5)', () => {
      for (const tag of workspaceRowTagsIn(bothTrees())) {
        expect(tag).not.toContain('aria-label')
        expect(tag).not.toContain('title=')
        expect(tag).not.toContain('aria-controls')
        expect(tag).not.toContain('id=')
        expect(tag).not.toContain('data-')
      }
    })

    it('keeps an untrusted cwd out of the control attributes, not merely escaped inside one', () => {
      // The twin of #703's escaping test one describe up, and NOT a duplicate of it: that one proves the
      // label is escaped TEXT; this one proves the element the row became never took the label into an
      // attribute at all — the `aria-label={`Collapse ${label}`}` a disclosure control invites.
      const markup = render([row({ id: 'd1', name: 'x', cwd: '/home/me/<img src=x onerror=boom>' })])
      const tags = workspaceRowTagsIn(markup)
      expect(tags).toHaveLength(1)
      expect(tags[0]).not.toContain('img')
      expect(tags[0]).not.toContain('onerror')
      expect(tags[0]).not.toContain('boom')
      // …while the label itself still renders, escaped, as the button's text child.
      expect(markup).toContain('&lt;img src=x onerror=boom&gt;')
    })
  })

  describe('the connection dots ending each host row (#718)', () => {
    // The #710 shape verbatim — one row per tree — so the dot counts below are exactly twice the host-row
    // counts that describe pins.
    const bothTrees = (): string =>
      render([
        row({ id: 'c1', name: 'kitchenclaw refactor', is_promoted: true }),
        row({ id: 'd1', name: 'Help me debug auth flow', is_promoted: false })
      ])

    it('ends every host row with one wrapper holding two dots (AC1)', () => {
      const markup = bothTrees()
      expect(countOf(markup, DOT_WRAPPER_MARKER)).toBe(2)
      expect(hostDotTagsIn(markup)).toHaveLength(4)
      const single = render([row({ id: 'c1', is_promoted: true })])
      expect(countOf(single, DOT_WRAPPER_MARKER)).toBe(1)
      expect(hostDotTagsIn(single)).toHaveLength(2)
    })

    it('names both legs from the two stores it reads, with no false green (AC2/AC3)', () => {
      // The store-bound leaf hydrates to the two singletons' INITIAL values under `renderToStaticMarkup`
      // — relay `null` and session `{ type: 'disconnected' }` — so this reads #330's shipped labels back
      // out of the render rather than restating them (the `hostLabelsIn` treatment). It doubles as the
      // regression guard on the leaf being server-renderable at all.
      const labels = hostDotTagsIn(bothTrees()).map(ariaLabelOf)
      expect(labels).toEqual([
        'Pyrycode Offline',
        'Relay Offline',
        'Pyrycode Offline',
        'Relay Offline'
      ])
    })

    it('renders the dots INSIDE the host row, ahead of that tree conversation rows (AC1)', () => {
      const markup = bothTrees()
      expect(markup.indexOf(HOST_ROW_MARKER)).toBeLessThan(markup.indexOf(DOT_WRAPPER_MARKER))
      expect(markup.indexOf(DOT_WRAPPER_MARKER)).toBeLessThan(markup.indexOf(ROW_MARKER))
    })

    it('renders no dots where there is no host row (AC1)', () => {
      expect(countOf(render(null), DOT_WRAPPER_MARKER)).toBe(0)
      expect(countOf(render([]), DOT_WRAPPER_MARKER)).toBe(0)
    })
  })
})

describe('CollapsibleWorkspaceGroup (#704)', () => {
  // The ToolRow seam: the component is exported PURELY so both disclosure states are reachable from
  // `renderToStaticMarkup`, which never re-renders and therefore can never click. This tier pins the two
  // rendered SHAPES; the click that moves between them is e2e/workspace-collapse.spec.ts's job.
  const GROUP_LABEL = 'second-brain'
  const PROBE = 'a-grouped-row'

  // `defaultExpanded={undefined}` takes the same default-parameter path `renderBody` takes by omitting
  // the prop, so the no-argument call really does render the production shape.
  const renderGroup = (label: string, defaultExpanded?: boolean): string =>
    renderToStaticMarkup(
      <CollapsibleWorkspaceGroup label={label} defaultExpanded={defaultExpanded}>
        <span>{PROBE}</span>
      </CollapsibleWorkspaceGroup>
    )

  it('renders the row expanded with its rows when no default is given (AC4)', () => {
    const markup = renderGroup(GROUP_LABEL)
    expect(countOf(markup, WORKSPACE_ROW_MARKER)).toBe(1)
    expect(workspaceRowTagsIn(markup)[0]).toContain(EXPANDED_MARKER)
    expect(workspaceLabelsIn(markup)).toEqual([GROUP_LABEL])
    expect(markup).toContain(PROBE)
  })

  it('withdraws the group rows but KEEPS its workspace row when collapsed (AC1)', () => {
    const markup = renderGroup(GROUP_LABEL, false)
    // The half a naive implementation gets wrong: the row IS the control, so folding it away with its
    // rows would leave nothing to click back — AC1 pins that the row stays visible in both states.
    expect(countOf(markup, WORKSPACE_ROW_MARKER)).toBe(1)
    expect(workspaceLabelsIn(markup)).toEqual([GROUP_LABEL])
    expect(workspaceRowTagsIn(markup)[0]).toContain(COLLAPSED_MARKER)
    // Genuinely gone from the markup, not hidden by a class — the tool-row body precedent.
    expect(markup).not.toContain(PROBE)
  })

  it('changes nothing but the state attribute between the two shapes', () => {
    // `WORKSPACE_ROW_MARKER` is an EXACT attribute-value substring, so a collapsed modifier class
    // (`channel-list__workspace channel-list__workspace--collapsed`) would stop matching it and SILENTLY
    // zero every count in the #703 describe rather than failing one. This equality is what keeps the
    // class token sole; a collapsed appearance, if ever designed, styles off `[aria-expanded='false']`.
    const expanded = workspaceRowTagsIn(renderGroup(GROUP_LABEL))[0]
    const collapsed = workspaceRowTagsIn(renderGroup(GROUP_LABEL, false))[0]
    expect(collapsed).toBe(expanded.replace(EXPANDED_MARKER, COLLAPSED_MARKER))
  })

  it('renders an untrusted label as escaped text in the collapsed state too', () => {
    // Collapsing withdraws the ROWS, never the label — so the label's escaping is load-bearing in both
    // states, not only the one #703 tested.
    const markup = renderGroup('<b>x</b>', false)
    expect(markup).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(markup).not.toContain('<b>x</b>')
    expect(workspaceRowTagsIn(markup)[0]).not.toContain('title=')
  })
})

describe('HostConnectionDots (#718)', () => {
  // The `ConnectionStatusIndicator` seam: the component is exported PURELY so the full category × label
  // matrix is reachable with injected legs — the container above can only ever render the two singletons'
  // initial state, which is one cell of it.
  const leg = (category: ConnectionLeg['category'], label: string): ConnectionLeg => ({ category, label })

  const dots = (host: ConnectionLeg, relay: ConnectionLeg): string =>
    renderToStaticMarkup(<HostConnectionDots host={host} relay={relay} />)

  it('binds each category to #330 shipped colour modifier (AC2)', () => {
    // One case per LegCategory, so the binding is pinned rather than sampled. A re-declared
    // `.channel-list__host-dot--up` family — the second copy of the contract AC2 forbids, one level below
    // the mapping — fails all three here.
    expect(dots(leg('up', 'Pyrycode Connected'), leg('up', 'Relay Connected'))).toContain(DOT_UP_MARKER)
    expect(dots(leg('in-progress', 'Pyrycode Connecting'), leg('up', 'Relay Reachable'))).toContain(
      DOT_IN_PROGRESS_MARKER
    )
    expect(dots(leg('down', 'Pyrycode Offline'), leg('down', 'Relay Offline'))).toContain(DOT_DOWN_MARKER)
  })

  it('puts the HOST leg first and the relay leg second, the design order', () => {
    // The assertion that catches a developer copying `ConnectionStatusIndicator(relay, daemon)`'s
    // argument order, which is the REVERSE of this one: both props are a `ConnectionLeg`, so swapping
    // them type-checks and renders silently.
    const markup = dots(leg('up', 'Pyrycode Connected'), leg('down', 'Relay Offline'))
    expect(markup.indexOf('Pyrycode Connected')).toBeLessThan(markup.indexOf('Relay Offline'))
  })

  it('renders the two legs independently, one category each (AC2)', () => {
    // "Relay up, host down" renders as exactly that — neither leg is derived from the other.
    const tags = hostDotTagsIn(dots(leg('down', 'Pyrycode Offline'), leg('up', 'Relay Connected')))
    expect(tags).toHaveLength(2)
    expect(tags[0]).toContain(DOT_DOWN_MARKER)
    expect(tags[1]).toContain(DOT_UP_MARKER)
  })

  it('gives every dot an accessible name carrying its leg and its state (AC3)', () => {
    const tags = hostDotTagsIn(
      dots(leg('in-progress', 'Pyrycode Connecting'), leg('up', 'Relay Reachable'))
    )
    expect(tags.map(ariaLabelOf)).toEqual(['Pyrycode Connecting', 'Relay Reachable'])
    for (const tag of tags) {
      // `aria-label` on a bare <span> is DROPPED by the accessible-name computation — a name needs a role
      // to land on, and `role="img"` is the ARIA-in-HTML-legal one for a non-interactive graphic. Without
      // it AC3 would pass review and fail in a screen reader.
      expect(tag).toContain('role="img"')
    }
  })

  it('shows no visible text (AC4)', () => {
    // Scoped to the pair's own render: the host row legitimately shows the glyph and the machine name, so
    // a document-wide "no text" assertion would be plain wrong rather than strict.
    const markup = dots(leg('up', 'Pyrycode Connected'), leg('up', 'Relay Connected'))
    expect(markup.replace(/<[^>]*>/g, '')).toBe('')
  })
})
