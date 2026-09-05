import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ConversationSummary } from '@shared/wire/types'
import {
  ChannelListView,
  CollapsibleWorkspaceGroup,
  HostConnectionDots,
  HostRow,
  hostRowLabel
} from './ChannelList'
import { UNKNOWN_WORKSPACE_LABEL } from './channelListViewModel'
import type { HostLabelValue } from '../../store/hostLabelStore'
import type { ConnectionLeg } from '../conversation/ConversationScreen'
import {
  createConversationActivityStore,
  type ConversationActivityStore
} from '../../store/conversationActivityStore'
import {
  createConversationTimelineStore,
  type ConversationTimelineStore
} from '../../store/conversationTimelineStore'
import {
  createConversationLastReadStore,
  type ConversationLastReadStore,
  type ConversationLastReadStorage
} from '../../store/conversationLastReadStore'
import { createModalStore, type ModalStore } from '../../store/modalStore'

// #801's per-row dot reads four app-wide SINGLETONS (#874 added the fourth), and A WRITE TO ANY OF THEM IS
// INVISIBLE TO `renderToStaticMarkup`. React's server renderer resolves `useSyncExternalStore` through its
// THIRD argument (react-dom-server.node.development.js:5283 returns `getServerSnapshot()` and never
// subscribes), and zustand v5 wires that argument to `api.getInitialState()` (zustand/esm/react.mjs) — the
// state captured at store CREATION, which no setter ever moves. Seeding the singletons therefore renders
// three idle dots and proves nothing; this is a property of the whole node-environment renderer tier, not
// of this file.
//
// So the four React BINDINGS are redirected onto per-file isolated store instances, built by the same
// shipped factories and driven through the same shipped setters. Only the binding is replaced: `...actual`
// keeps the real `selectActivityFor` / `selectTimelineFor` / `selectLastReadFor` /
// `selectHasOutstandingFor`, so the row's id → entry lookup runs for real, and `isConversationUnread` and
// `resolveConversationStatus` are untouched imports in `ChannelList.tsx`. What the #801 and #874 cases
// below assert is exactly the wiring those tickets add.
//
// Each factory's body is evaluated at import time and touches none of the four consts below; only the
// returned hook reads them, and it is not called until a render inside a test.
const activityStore = createConversationActivityStore()
const timelineStore = createConversationTimelineStore()
// An in-memory port, never `localStorage`: the real singleton's port short-circuits on
// `typeof window === 'undefined'`, but an isolated instance has to be handed something, and a fake keeps
// this file's stores off any shared surface (conversationLastReadStore.ts:246-257).
const lastReadMemory: ConversationLastReadStorage = { read: () => new Map(), write: () => {} }
const lastReadStore = createConversationLastReadStore(lastReadMemory)
// #874's fourth read. Named `promptStore` and not `modalStore`: the module's own app-wide singleton export
// carries that name and the mock factory below spreads it, so a same-named local const — legal — would
// invite a misread about which of the two a seed writes to.
const promptStore = createModalStore()

vi.mock('../../store/conversationActivityStore', async (importActual) => ({
  ...(await importActual<typeof import('../../store/conversationActivityStore')>()),
  useConversationActivityStore: <T,>(selector: (s: ConversationActivityStore) => T): T =>
    selector(activityStore.getState())
}))
vi.mock('../../store/conversationTimelineStore', async (importActual) => ({
  ...(await importActual<typeof import('../../store/conversationTimelineStore')>()),
  useConversationTimelineStore: <T,>(selector: (s: ConversationTimelineStore) => T): T =>
    selector(timelineStore.getState())
}))
vi.mock('../../store/conversationLastReadStore', async (importActual) => ({
  ...(await importActual<typeof import('../../store/conversationLastReadStore')>()),
  useConversationLastReadStore: <T,>(selector: (s: ConversationLastReadStore) => T): T =>
    selector(lastReadStore.getState())
}))
vi.mock('../../store/modalStore', async (importActual) => ({
  ...(await importActual<typeof import('../../store/modalStore')>()),
  useModalStore: <T,>(selector: (s: ModalStore) => T): T => selector(promptStore.getState())
}))

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

// `openConversationId` DEFAULTS TO NULL (#1098) so every call site written before this ticket keeps
// rendering exactly what it rendered — the store's own hydrated value, and the "nothing opened yet"
// state AC1's last clause names. It is a required prop on the view (the container must decide) and an
// optional argument here, which is the whole reason the read was lifted out of `Row`: zustand v5 serves
// `getInitialState()` under `renderToStaticMarkup`, so a store-reading row could only ever render the
// unfilled case and this tier could prove nothing about the open one.
const render = (
  conversations: readonly ConversationSummary[] | null,
  openConversationId: string | null = null
): string =>
  renderToStaticMarkup(
    <ChannelListView
      conversations={conversations}
      openConversationId={openConversationId}
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
// geometry class and the category → colour binding together. Four markers since #719 added the neutral
// not-yet-known category.
const DOT_UP_MARKER = 'class="channel-list__host-dot conn-dot--up"'
const DOT_IN_PROGRESS_MARKER = 'class="channel-list__host-dot conn-dot--in-progress"'
const DOT_DOWN_MARKER = 'class="channel-list__host-dot conn-dot--down"'
const DOT_UNKNOWN_MARKER = 'class="channel-list__host-dot conn-dot--unknown"'

// The pair's layout wrapper carries a sole class, so the file's usual exact-substring form applies to it.
const DOT_WRAPPER_MARKER = 'class="channel-list__host-status"'

// The row title, so "the dot LEADS the row" can be asserted as an ordering rather than as a presence.
const TITLE_MARKER = 'class="channel-list__title"'

// The per-row status dot (#801). FULL attribute values, for the host dots' reason one block up: #800's
// component always wears its base class AND a status modifier — idle included, deliberately — so
// `class="conversation-status-dot"` with its closing quote would silently match NOTHING. Pinning the whole
// value is the stronger assertion anyway: one marker fixes the base class and the status → modifier
// binding together, so a dot that resolves to the wrong status fails as a MISSING marker rather than
// passing a laxer prefix check.
const STATUS_DOT_WORKING = 'class="conversation-status-dot conversation-status-dot--working"'
const STATUS_DOT_NEW_MESSAGES =
  'class="conversation-status-dot conversation-status-dot--new-messages"'
const STATUS_DOT_IDLE = 'class="conversation-status-dot conversation-status-dot--idle"'
// #874's status, reachable from a row for the first time. Same full-value form and same reason; the string
// is restated here rather than imported from `ConversationStatusDot.test.tsx:17`, matching its three
// siblings above.
const STATUS_DOT_INPUT_REQUIRED =
  'class="conversation-status-dot conversation-status-dot--input-required"'

// Counting dots regardless of status. The trailing SPACE is on purpose and is the `DOT_TAG_PREFIX`
// treatment: the base class never appears alone, so this matches every dot and no other element.
const STATUS_DOT_PREFIX = 'class="conversation-status-dot '

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

// Slices the render into one chunk per conversation row (#801) — each chunk running from a row's own
// class attribute to the next row's. Every #801 assertion is CHUNK-SCOPED rather than document-scoped,
// and that is the whole point of the helper: with three rows in one render, a document-wide
// `toContain(STATUS_DOT_WORKING)` passes no matter WHICH row carries the working dot, which is precisely
// the misattribution AC2 exists to rule out. No chunk can borrow its neighbour's dot: the split boundary
// is the NEXT row's class attribute, and that row's dot — its first child — comes after it.
const rowChunksIn = (markup: string): string[] => markup.split(ROW_MARKER).slice(1)

// The open-state attribute the open row's button carries (#1098). React serialises the string prop
// verbatim, and the other rows carry NO `aria-current` at all — `undefined` omits the attribute rather
// than emitting `aria-current="false"`, the shape all four shipped consumers use
// (ComposerOptionsPanel, ComposerModelMenu, ComposerSlashCommandTypeAhead, QuestionPanel).
const OPEN_ROW_MARKER = 'aria-current="true"'

// `workspaceRowTagsIn`'s treatment applied to the row's open button (#1098), so the open row's whole
// opening tag can be compared against a resting row's as an EQUALITY. That equality is AC5: the state is
// an attribute AFTER the class, so `class="channel-list__row-open"` — an exact attribute-value substring
// whose closing quote is what keeps it from also matching `__row-open-something` — still matches on an
// open row. A modifier class instead would stop matching it and silently zero every chunk-scoped count in
// the #801 describe (`rowChunksIn` SPLITS on `ROW_MARKER`, so a dead marker yields zero chunks and passes
// those `for` loops vacuously) rather than failing one. Scanning to the next `>` is exact: React escapes
// `<` and `>` inside attribute values too.
const rowOpenTagsIn = (markup: string): string[] => {
  const tags: string[] = []
  for (let at = markup.indexOf(ROW_OPEN_MARKER); at !== -1; ) {
    const end = markup.indexOf('>', at)
    tags.push(markup.slice(markup.lastIndexOf('<', at), end + 1))
    at = markup.indexOf(ROW_OPEN_MARKER, end)
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

  // #1097 (AC3) — the inverse of the assertion this replaces. A row is no longer laid out as
  // title · time: the desktop node draws a label and nothing else, so the row renders NO relative
  // bucket and no `.channel-list__time` span at all. Two independent negatives, because either one
  // alone can pass while the row is wrong: the class could survive holding empty text, and the bucket
  // text could survive under a renamed class. The timestamp is seeded at a bucket boundary a working
  // formatter would definitely render ("3h ago"), not at one it collapses to '' — a malformed seed
  // would make this pass against the OLD markup too. `formatLastActivity` itself is untouched and
  // still covered by channelListViewModel.test.ts for its three surviving callers.
  it('renders no last-activity time for a row, whatever its timestamp (AC3)', () => {
    const markup = render([row({ id: 'd1', name: 'x', last_message_ts: isoAgo(3 * 3_600_000) })])
    expect(markup).not.toContain('3h ago')
    expect(markup).not.toContain('channel-list__time')
  })

  // The malformed-timestamp seed keeps its own case rather than folding into the one above: with no
  // time rendered, "never NaN" would be vacuous on its own, but a row whose OTHER fields derive from
  // an unparseable timestamp must still render its label and no arithmetic artefact.
  it('renders a malformed timestamp as a plain row, never NaN and never a time', () => {
    const markup = render([row({ id: 'd1', name: 'x', last_message_ts: 'not-a-date' })])
    expect(markup).not.toContain('NaN')
    expect(markup).not.toContain('channel-list__time')
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

    describe('the operator-typed label on the row (#834)', () => {
      // The four-arm matrix is proven on the PURE COLLAPSE and the markup contract on the PURE VIEW —
      // never on the store-bound container. Seeding `hostLabelStore` before a `renderToStaticMarkup`
      // call is invisible to it (the file header's #801 paragraph, and HostConnectionDots' own doc
      // comment): React's server renderer resolves `useSyncExternalStore` through `getServerSnapshot()`
      // and zustand wires that to the state captured at store CREATION, so a seeded container can only
      // ever render the initial `loading` cell.
      const renderHostRow = (label: string): string => renderToStaticMarkup(<HostRow label={label} />)

      // Read the SHIPPED fallback back out of the collapse rather than restating 'Server', the same
      // discipline `hostLabelsIn` applies to the render — a copy change that collides with a section
      // label must fail the AC4 guard above, not be re-blessed by a literal restated here.
      const FALLBACK = hostRowLabel({ status: 'not-stored' })

      // A label with no regex-, HTML- or attribute-significant character, so "occurs exactly once" is a
      // statement about the RENDER and not about escaping. Distinct from every marker in this file.
      const SENTINEL = 'Pyrybox-Sentinel'

      it('shows a stored label verbatim (AC1)', () => {
        expect(hostRowLabel({ status: 'stored', label: 'Pyrybox' })).toBe('Pyrybox')
      })

      it('holds a 128-character label whole — the truncation is CSS, not a slice (AC4)', () => {
        const long = 'x'.repeat(128)
        expect(hostRowLabel({ status: 'stored', label: long })).toBe(long)
      })

      it.each<[string, HostLabelValue]>([
        ['a stored empty label', { status: 'stored', label: '' }],
        ['a stored whitespace-only label', { status: 'stored', label: '   ' }],
        ['never stored', { status: 'not-stored' }],
        ['unreadable', { status: 'error' }],
        ['not yet settled', { status: 'loading' }]
      ])('falls back to the word already on the row for %s (AC2)', (_name, value) => {
        expect(hostRowLabel(value)).toBe(FALLBACK)
        expect(FALLBACK).not.toBe('')
      })

      it('gives the pre-settle arm the SAME word as the three settled ones (AC2)', () => {
        // The distinct guard, not a restatement of the table above: the pre-settle arm is the one that
        // invites a 'Loading…' placeholder (ServerRow.tsx:12 ships exactly that, deliberately — a
        // details surface, not a name slot). A placeholder HERE would read as the machine's name, so a
        // future one must fail at this line rather than ship.
        expect(hostRowLabel({ status: 'loading' })).toBe(hostRowLabel({ status: 'not-stored' }))
        expect(hostRowLabel({ status: 'loading' })).toBe(hostRowLabel({ status: 'error' }))
        expect(hostRowLabel({ status: 'loading' })).toBe(
          hostRowLabel({ status: 'stored', label: '' })
        )
      })

      it('renders a hostile label as escaped text only (AC3)', () => {
        const markup = renderHostRow('<img src=x onerror=alert(1)>')
        // The label's own `<` and `>` are what must not survive as raw delimiters — `onerror=alert`
        // itself remains, inert, as ordinary text, and asserting its absence would be asserting the
        // wrong thing. Read the label back out of the render (the `hostLabelsIn` discipline) so the
        // whole rendered text node is pinned, not a substring of it.
        expect(markup).not.toContain('<img')
        expect(hostLabelsIn(markup)).toEqual(['&lt;img src=x onerror=alert(1)&gt;'])
      })

      it('puts the label in NO attribute value — the `title=` reflex, ruled out (AC3)', () => {
        // The stronger half of AC3, and the one that actually pins it: the ellipsized text this ticket
        // introduces invites `title={label}` ("hover for the rest"), which is the exact sink CLAUDE.md
        // forbids and #696's review made a MUST FIX. Asserting the label occurs ONCE, immediately after
        // the label span's opening tag, catches `title=` AND any other attribute nobody thought to ban.
        const markup = renderHostRow(SENTINEL)
        expect(countOf(markup, SENTINEL)).toBe(1)
        expect(markup.indexOf(SENTINEL)).toBe(
          markup.indexOf(HOST_LABEL_OPEN) + HOST_LABEL_OPEN.length
        )
        expect(markup).not.toContain('title=')
      })

      it('keeps the row structure the #710/#718 locator guards pin (AC1)', () => {
        const markup = renderHostRow(SENTINEL)
        expect(countOf(markup, HOST_ROW_MARKER)).toBe(1)
        expect(countOf(markup, HOST_ICON_MARKER)).toBe(1)
        expect(countOf(markup, HOST_LABEL_OPEN)).toBe(1)
        expect(countOf(markup, DOT_WRAPPER_MARKER)).toBe(1)
        expect(hostDotTagsIn(markup)).toHaveLength(2)
        // Neither section label, either way — Playwright's `hasText` matches substrings
        // case-insensitively, so an operator naming their machine "Chats" is the hazard, not the copy.
        expect(SENTINEL.toLowerCase()).not.toContain('channels')
        expect(SENTINEL.toLowerCase()).not.toContain('chats')
        expect(markup).not.toContain(ROW_MARKER)
        expect(markup).not.toContain(ROW_OPEN_MARKER)
      })

      it('renders the fallback in BOTH trees on the store default (AC2)', () => {
        // The regression guard on every existing assertion in this file and on the ~28 e2e specs riding
        // `launchPairedApp`: the singleton's created-in `loading` cell is what every server render sees,
        // so the default markup is exactly what it was before this ticket.
        const labels = hostLabelsIn(bothTrees())
        expect(labels).toEqual([FALLBACK, FALLBACK])
      })
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
      // — relay `null` and session `{ type: 'disconnected' }` — so this reads the shipped labels back
      // out of the render rather than restating them (the `hostLabelsIn` treatment). It doubles as the
      // regression guard on the leaf being server-renderable at all. Since #719 the relay's initial cell
      // is "Relay Unknown": on the sidebar this IS the first frame of every launch, which is why that
      // state stopped claiming an outage. The host leg keeps #330's "Pyrycode Offline" (#719 AC3).
      const labels = hostDotTagsIn(bothTrees()).map(ariaLabelOf)
      expect(labels).toEqual([
        'Pyrycode Offline',
        'Relay Unknown',
        'Pyrycode Offline',
        'Relay Unknown'
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

  describe('the status dot leading every conversation row (#801)', () => {
    // THE ONE REAL TRAP IN THIS SUITE. The four stores are file-level instances shared by every case in
    // this describe, so a seed left standing silently colours a LATER case's render — an `--idle` row
    // quietly turning `--working`, which is a passing-looking wrong answer rather than a failure. Four
    // clears, one per store, because no single boundary helper owns all four.
    //
    // The modal clear is `reconnected` and MUST NOT be a `dismissed` per seeded prompt. `dismissed` moves
    // the id onto the `resolved` slice, where the `shown` arm reads a seen-then-resolved id as a no-op
    // rather than an append (modalPrompts.ts:154) — so a `dismissed`-based teardown leaves a later case's
    // seed silently doing nothing, and that case renders an `--idle` row while asserting
    // `--input-required`, a failure that reads as a product bug in the wiring #874 adds. `reconnected`
    // clears `outstanding` and `resolved` together (modalPrompts.ts:202-220) and is the only teardown
    // that returns the store to its initial state.
    afterEach(() => {
      activityStore.getState().clearAllActivity()
      timelineStore.getState().clearAllTimelines()
      lastReadStore.getState().clearAllLastRead()
      promptStore.getState().dispatch({ type: 'reconnected' })
    })

    // The seeds, named for the STATUS they produce rather than for the store they write, so each case
    // below reads as the status it asserts.
    const seedWorking = (id: string): void => activityStore.getState().setTurnRunning(id, true)

    // `reconnected` is the cheapest honest unread seed: a zero-payload arm that MINTS A SLICE without
    // appending an item (conversationTimelineStore.ts:279-282), landing on `isConversationUnread` branch 2
    // — a slice held with no mark recorded reads as unread (conversationUnread.ts:59-60). No item append,
    // no fabricated message, and no dependency on the timeline's content shape.
    const seedUnread = (id: string): void =>
      timelineStore.getState().dispatchFor(id, { type: 'reconnected' })

    // The same slice, plus a mark that COVERS it: `0 > 0` is false, so branch 3 reads it as read.
    const seedRead = (id: string): void => {
      seedUnread(id)
      lastReadStore.getState().recordLastRead(id, 0)
    }

    // #874: one outstanding prompt for that conversation. The event literal is built inline rather than
    // imported out of `modalPrompts.test.ts`, but it borrows that builder's one load-bearing discipline
    // (modalPrompts.test.ts:20-24): the `modalId` is DERIVED from the conversation id without being equal
    // to it. Both fields are `string`, so a scan reading the wrong one is invisible to `tsc` and only
    // distinct values can catch it.
    const seedInputRequired = (id: string): void =>
      promptStore.getState().dispatch({
        type: 'shown',
        conversationId: id,
        modalId: `m-${id}`,
        class: 'permission',
        title: 'Allow tool use?',
        prompt: 'Run `git status`?',
        options: [
          { id: 'allow', label: 'Allow' },
          { id: 'deny', label: 'Deny' }
        ],
        defaultOptionId: 'allow'
      })

    // Three rows spread across both trees and two workspaces, so every claim below is a claim about more
    // than one row — a single-row fixture cannot tell "resolved per row" from "resolved once for all".
    const threeRows = (): readonly ConversationSummary[] => [
      row({ id: 'c1', name: 'kitchenclaw refactor', is_promoted: true, cwd: '/home/me/alpha' }),
      row({ id: 'd1', name: 'Help me debug auth flow', is_promoted: false, cwd: '/home/me/alpha' }),
      row({ id: 'd2', name: 'Third conversation', is_promoted: false, cwd: '/home/me/beta' })
    ]

    // The one chunk whose row shows `title`. Asserting the match count rather than taking `[0]` blind
    // keeps a broken slicer failing HERE, as "the fixture no longer has one row called that", instead of
    // silently handing every later assertion the wrong row's markup.
    const chunkFor = (markup: string, title: string): string => {
      const found = rowChunksIn(markup).filter((chunk) => chunk.includes(title))
      expect(found).toHaveLength(1)
      return found[0]
    }

    it('draws exactly one dot on every row of both trees, in every workspace group (AC1)', () => {
      const markup = render(threeRows())
      expect(countOf(markup, ROW_MARKER)).toBe(3)
      expect(countOf(markup, STATUS_DOT_PREFIX)).toBe(3)
      for (const chunk of rowChunksIn(markup)) {
        expect(countOf(chunk, STATUS_DOT_PREFIX)).toBe(1)
      }
      // The dot is unconditional — an all-idle sidebar still draws one per row, and the `--idle` modifier
      // ships explicitly so a DROPPED modifier fails here rather than rendering as a correct-looking dot.
      expect(countOf(markup, STATUS_DOT_IDLE)).toBe(3)
    })

    it('leads the row: the dot precedes the title in document order (AC1)', () => {
      for (const chunk of rowChunksIn(render(threeRows()))) {
        // The presence check is NOT redundant with the ordering below it. `indexOf` yields -1 for an
        // ABSENT needle, and -1 is less than every real index, so an ordering assertion alone passes
        // vacuously on a row that draws no dot at all — the vacuity `workspaceRowTagsIn` was written to
        // avoid one describe up. Both ordering cases in this describe pin presence first for that reason.
        expect(chunk).toContain(STATUS_DOT_PREFIX)
        expect(chunk.indexOf(STATUS_DOT_PREFIX)).toBeLessThan(chunk.indexOf(TITLE_MARKER))
      }
    })

    it('sits OUTSIDE the open button, as a sibling under the row wrapper', () => {
      // The ticket's named placement choice, pinned rather than left to the reader. #800's dot is a named
      // `role="img"`, so nesting it inside `.channel-list__row-open` would fold "Assistant working" into
      // that button's accessible name and make the name MUTATE as the daemon works — the noise
      // RunConfigSections.tsx:270-280 already declines for the unselected radios. A later edit that nests
      // it fails here instead of silently renaming every row button.
      for (const chunk of rowChunksIn(render(threeRows()))) {
        expect(chunk).toContain(STATUS_DOT_PREFIX)
        expect(chunk.indexOf(STATUS_DOT_PREFIX)).toBeLessThan(chunk.indexOf(ROW_OPEN_MARKER))
      }
    })

    it('resolves each row from its OWN conversation id, never a neighbour (AC2)', () => {
      // The assertion this whole ticket exists for. One of three ids is seeded, and the other two rows
      // must be untouched — a composition keyed by anything but the row's own id (the open conversation,
      // the first row, a shared derivation) fails on the two `--idle` expectations, not the `--working`.
      seedWorking('d1')
      const markup = render(threeRows())
      expect(chunkFor(markup, 'Help me debug auth flow')).toContain(STATUS_DOT_WORKING)
      expect(chunkFor(markup, 'kitchenclaw refactor')).toContain(STATUS_DOT_IDLE)
      expect(chunkFor(markup, 'Third conversation')).toContain(STATUS_DOT_IDLE)
      expect(countOf(markup, STATUS_DOT_WORKING)).toBe(1)
    })

    it('shows working on a conversation the operator has never opened (AC2)', () => {
      // The seeded id is absent from BOTH the timeline and the last-read stores — never opened, no slice
      // held, no mark recorded — and the activity store is fed independently of which conversation is
      // open, so the dot is correct with no "open conversation" concept involved anywhere.
      seedWorking('d2')
      expect(timelineStore.getState().timelines.has('d2')).toBe(false)
      expect(lastReadStore.getState().marks.has('d2')).toBe(false)
      expect(chunkFor(render(threeRows()), 'Third conversation')).toContain(STATUS_DOT_WORKING)
    })

    it('takes its unread input from the shipped predicate, over both stores (AC3)', () => {
      // A slice held with no mark is unread; a mark covering that slice flips the SAME row to idle. Both
      // readings come out of `isConversationUnread`, so a second, locally re-derived unread rule (a
      // `last_message_ts` comparison being the tempting one) cannot produce this pair.
      seedUnread('c1')
      expect(chunkFor(render(threeRows()), 'kitchenclaw refactor')).toContain(
        STATUS_DOT_NEW_MESSAGES
      )
      seedRead('c1')
      expect(chunkFor(render(threeRows()), 'kitchenclaw refactor')).toContain(STATUS_DOT_IDLE)
    })

    it('keeps the resolver precedence at the call site: working beats new messages (AC3)', () => {
      // A literal argument swap is a type error, so what this catches is the composition going wrong in a
      // way `tsc` cannot see — a hand-rolled unread boolean, a locally re-derived status, or the two
      // statuses traded by an over-clever branch. It is the resolver's own most-missed assertion
      // (conversationStatus.ts:72-73), restated once where the two stores actually meet.
      seedWorking('d1')
      seedUnread('d1')
      const chunk = chunkFor(render(threeRows()), 'Help me debug auth flow')
      expect(chunk).toContain(STATUS_DOT_WORKING)
      expect(chunk).not.toContain(STATUS_DOT_NEW_MESSAGES)
    })

    it('draws the input-required dot on a row with a prompt waiting (#874 AC1)', () => {
      seedInputRequired('d1')
      const markup = render(threeRows())
      expect(chunkFor(markup, 'Help me debug auth flow')).toContain(STATUS_DOT_INPUT_REQUIRED)
      expect(chunkFor(markup, 'kitchenclaw refactor')).toContain(STATUS_DOT_IDLE)
      expect(chunkFor(markup, 'Third conversation')).toContain(STATUS_DOT_IDLE)
      // The count PAIR is what says "one row, one dot, no extra element": the new status appears once in
      // the whole render, and the render still carries exactly three dots.
      expect(countOf(markup, STATUS_DOT_INPUT_REQUIRED)).toBe(1)
      expect(countOf(markup, STATUS_DOT_PREFIX)).toBe(3)
    })

    it('outranks working AND new messages on the same row (#874 AC2)', () => {
      // The assertion #874 exists to make true. The resolver's own suite pins the precedence one layer
      // down; restating it here is deliberate — this is where the four stores actually meet.
      //
      // Each rival gets its OWN row, and that separation is load-bearing rather than tidiness. It is what
      // makes this case catch the one wrong answer a green typecheck hides: `resolveConversationStatus`
      // takes a `boolean` in BOTH first and third position, so a call passing the unread flag first and
      // `inputRequired` third builds clean and passes the salvage gate. Seeding all three facts on ONE row
      // cannot catch it — a transposed call reads that row's `unread` in first position, which is also
      // true, and resolves `input-required` for the wrong reason. `c1` holds input-required against
      // working with NOTHING unread, which is exactly the row that transposition mis-resolves.
      seedInputRequired('c1')
      seedWorking('c1')
      seedInputRequired('d1')
      seedUnread('d1')
      seedInputRequired('d2')
      seedWorking('d2')
      seedUnread('d2')
      const markup = render(threeRows())
      const titles = ['kitchenclaw refactor', 'Help me debug auth flow', 'Third conversation']
      for (const title of titles) {
        const chunk = chunkFor(markup, title)
        expect(chunk).toContain(STATUS_DOT_INPUT_REQUIRED)
        expect(chunk).not.toContain(STATUS_DOT_WORKING)
        expect(chunk).not.toContain(STATUS_DOT_NEW_MESSAGES)
      }
      expect(countOf(markup, STATUS_DOT_INPUT_REQUIRED)).toBe(3)
    })

    it('resolves three rows to three different statuses in one render (#874 AC3)', () => {
      // Two claims a single-row fixture cannot make: a row with no outstanding prompt draws exactly what
      // it drew before the fourth fact existed, and the fourth fact does not leak across rows. One render
      // proves both.
      seedInputRequired('d1')
      seedWorking('c1')
      seedUnread('d2')
      const markup = render(threeRows())
      expect(chunkFor(markup, 'Help me debug auth flow')).toContain(STATUS_DOT_INPUT_REQUIRED)
      expect(chunkFor(markup, 'kitchenclaw refactor')).toContain(STATUS_DOT_WORKING)
      expect(chunkFor(markup, 'Third conversation')).toContain(STATUS_DOT_NEW_MESSAGES)
    })

    it('lights the dot on a conversation the operator has never opened (#874 AC4)', () => {
      // The same never-opened proof the working case above makes: the seeded id is absent from BOTH the
      // timeline and the last-read stores, and the modal store is fed independently of which conversation
      // is open. Since #1098 `ChannelListView` DOES take an open-conversation prop, but this describe
      // renders with none (the helper's default), so no row is the open one here and the dot's four
      // facts stay independent of that state — which is the claim, and it did not move.
      seedInputRequired('d2')
      expect(timelineStore.getState().timelines.has('d2')).toBe(false)
      expect(lastReadStore.getState().marks.has('d2')).toBe(false)
      expect(chunkFor(render(threeRows()), 'Third conversation')).toContain(
        STATUS_DOT_INPUT_REQUIRED
      )
    })

    it('joins no existing row, host-row or affordance match set (AC4)', () => {
      // The 28-spec fixture hazard again: `launchPairedApp.ts:224` clicks an UNFILTERED
      // `.channel-list__row-open`, so a dot selectable as a row or a row button would strict-violate at
      // launch rather than fail an assertion. Every count below is the count it had before this ticket,
      // and the dot carries NO TEXT NODE, so `hasText`-filtered row locators are unaffected too.
      seedWorking('c1')
      const markup = render(threeRows())
      expect(countOf(markup, ROW_MARKER)).toBe(3)
      expect(countOf(markup, ROW_OPEN_MARKER)).toBe(3)
      expect(countOf(markup, SAVE_MARKER)).toBe(2)
      expect(countOf(markup, RENAME_MARKER)).toBe(1)
      expect(countOf(markup, HOST_ROW_MARKER)).toBe(2)
      expect(countOf(markup, SECTION_HEADER_MARKER)).toBe(2)
      expect(hostDotTagsIn(markup)).toHaveLength(4)
    })

    it('renders no dot where there is no row', () => {
      expect(countOf(render(null), STATUS_DOT_PREFIX)).toBe(0)
      expect(countOf(render([]), STATUS_DOT_PREFIX)).toBe(0)
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

describe('the open chat’s row (#1098)', () => {
  // The sidebar marks the row whose chat the pane is showing. This tier owns the MARKUP contract only —
  // which button carries the state, and that nothing else about any row's markup moves. The fill's
  // computed colour, the corner, the weight the browser resolved, the hover outcome and the fill MOVING
  // on a switch all need a layout engine and live in e2e/sidebar-row-geometry.spec.ts and
  // e2e/conversation-switch-keeps-both-threads.spec.ts.
  //
  // Reachable here at all only because the read was lifted to the container: `ChannelListView` takes the
  // open id as a prop, so this tier can inject one. A store read inside `Row` would render
  // `getInitialState()` forever and leave every assertion below unwritable.
  const threeRows = (): readonly ConversationSummary[] => [
    row({ id: 'c1', name: 'kitchenclaw refactor', is_promoted: true, cwd: '/home/me/alpha' }),
    row({ id: 'd1', name: 'Help me debug auth flow', is_promoted: false, cwd: '/home/me/alpha' }),
    row({ id: 'd2', name: 'Third conversation', is_promoted: false, cwd: '/home/me/beta' })
  ]

  it('marks no row before a chat has been opened (AC1)', () => {
    // The store hydrates to `activeConversation: null`, so this is also the production first-paint state
    // and the state every OTHER test in this file renders — which is what keeps them all unaffected.
    expect(countOf(render(threeRows()), OPEN_ROW_MARKER)).toBe(0)
  })

  it('marks exactly one row, and it is the open chat’s own row (AC2)', () => {
    const markup = render(threeRows(), 'd1')
    expect(countOf(markup, OPEN_ROW_MARKER)).toBe(1)
    // CHUNK-SCOPED, not document-scoped: with three rows in one render a document-wide `toContain` would
    // pass no matter WHICH row carried the state, which is precisely the misattribution AC2 rules out.
    const chunks = rowChunksIn(markup)
    expect(chunks).toHaveLength(3)
    expect(chunks.filter((chunk) => chunk.includes(OPEN_ROW_MARKER))).toHaveLength(1)
    expect(chunks.find((chunk) => chunk.includes('Help me debug auth flow'))).toContain(
      OPEN_ROW_MARKER
    )
  })

  it('marks the open row in EITHER tree, not just the Chats one (AC2)', () => {
    // `c1` is promoted, so it renders under "Channels" with the Rename affordance rather than
    // Save-as-channel. One `Row` component serves both trees, so a per-tree special case would be a
    // regression rather than a feature — this pins that there is none.
    const chunks = rowChunksIn(render(threeRows(), 'c1'))
    expect(chunks.find((chunk) => chunk.includes('kitchenclaw refactor'))).toContain(OPEN_ROW_MARKER)
    expect(chunks.filter((chunk) => chunk.includes(OPEN_ROW_MARKER))).toHaveLength(1)
  })

  it('marks nothing when the open id matches no row', () => {
    // The reachable case, not a hypothetical: `activeConversation` survives the conversation being
    // archived or deleted out of the list, and `clearActiveConversation` runs only on unpair / exit. The
    // comparison is `===` against a possibly-null id and never a truthiness test, so an empty-string id
    // stays an ordinary key rather than collapsing into "nothing open".
    expect(countOf(render(threeRows(), 'not-a-row'), OPEN_ROW_MARKER)).toBe(0)
    expect(countOf(render(threeRows(), ''), OPEN_ROW_MARKER)).toBe(0)
  })

  it('changes nothing but the state attribute between an open row and a resting one (AC5)', () => {
    // AC5 stated as an EQUALITY, the `CollapsibleWorkspaceGroup` template: the open row's button tag is
    // byte-identical to the same row's resting tag with the attribute inserted. That is what makes the
    // three whole-attribute-run markers this file matches on survive an open row — and what a modifier
    // class would break silently rather than loudly.
    // Render order is Channels then Chats, so the tags line up index-for-index with
    // [c1, d1, d2] in both renders — which is what lets this compare position by position rather than
    // by identity (all three resting tags are the same string, so a find-based comparison would keep
    // passing if the state landed on the wrong row).
    const resting = rowOpenTagsIn(render(threeRows()))
    const open = rowOpenTagsIn(render(threeRows(), 'd1'))
    expect(resting).toHaveLength(3)
    expect(open).toHaveLength(3)
    expect(open[0]).toBe(resting[0])
    expect(open[2]).toBe(resting[2])
    expect(open[1]).not.toBe(resting[1])
    expect(open[1].replace(` ${OPEN_ROW_MARKER}`, '')).toBe(resting[1])
  })

  it('leaves every row-family class attribute run byte-stable (AC5)', () => {
    // The three markers whose EXACT runs the rest of this file counts and slices on, asserted equal
    // across the two renders. `ROW_MARKER` is the one that matters most: `rowChunksIn` splits on it, so
    // if it stopped matching, the #801 describe's `for` loops would iterate zero chunks and pass.
    const resting = render(threeRows())
    const open = render(threeRows(), 'd1')
    for (const marker of [ROW_MARKER, ROW_OPEN_MARKER, TITLE_MARKER]) {
      expect(countOf(open, marker)).toBe(countOf(resting, marker))
      expect(countOf(open, marker)).toBe(3)
    }
    // And the two trailing affordances are untouched — the fill spans them, it does not replace them.
    expect(countOf(open, SAVE_MARKER)).toBe(2)
    expect(countOf(open, RENAME_MARKER)).toBe(1)
  })

  it('never interpolates the conversation id into the markup', () => {
    // The id is daemon-asserted, so it stays a comparison operand: never a class-name interpolation,
    // never an attribute VALUE, never a title, never a lookup key — the condition
    // `ConversationStatusDotControl`'s header sets on the same value. `aria-current`'s value is the
    // client-owned literal 'true'. The seeded ids are absent from every fixture NAME, so a leak shows up
    // here as a substring hit and nowhere else.
    //
    // The inline glyphs are stripped first, and that is a correctness fix rather than a loosening: this
    // file's seven Material `<path d>` runs are client-owned compile-time constants full of coordinate
    // pairs like `14c1.1`, which contain a short id as a substring and made the first draft of this test
    // fail against geometry no id can ever reach. Nothing daemon-derived renders inside an <svg> here.
    const withoutGlyphs = (markup: string): string => markup.replace(/<svg[\s\S]*?<\/svg>/g, '')
    const markup = withoutGlyphs(render(threeRows(), 'd1'))
    for (const id of ['c1', 'd1', 'd2']) expect(markup).not.toContain(id)
  })
})

describe('HostConnectionDots (#718)', () => {
  // The `ConnectionStatusIndicator` seam: the component is exported PURELY so the full category × label
  // matrix is reachable with injected legs — the container above can only ever render the two singletons'
  // initial state, which is one cell of it.
  const leg = (category: ConnectionLeg['category'], label: string): ConnectionLeg => ({ category, label })

  const dots = (host: ConnectionLeg, relay: ConnectionLeg): string =>
    renderToStaticMarkup(<HostConnectionDots host={host} relay={relay} />)

  it('binds each category to its shipped colour modifier (AC2)', () => {
    // One case per LegCategory, so the binding is pinned rather than sampled. A re-declared
    // `.channel-list__host-dot--up` family — the second copy of the contract AC2 forbids, one level below
    // the mapping — fails all four here.
    expect(dots(leg('up', 'Pyrycode Connected'), leg('up', 'Relay Connected'))).toContain(DOT_UP_MARKER)
    expect(dots(leg('in-progress', 'Pyrycode Connecting'), leg('up', 'Relay Reachable'))).toContain(
      DOT_IN_PROGRESS_MARKER
    )
    expect(dots(leg('down', 'Pyrycode Offline'), leg('down', 'Relay Offline'))).toContain(DOT_DOWN_MARKER)
    // #719's fourth category on the 6px sidebar dot — the one that reaches `.conn-dot--unknown` WITHOUT
    // the `.conn-dot` base, so a fourth binding nested under that base (or re-declared in channels.css)
    // would leave this dot with no background and go invisible silently.
    expect(dots(leg('down', 'Pyrycode Offline'), leg('unknown', 'Relay Unknown'))).toContain(
      DOT_UNKNOWN_MARKER
    )
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
