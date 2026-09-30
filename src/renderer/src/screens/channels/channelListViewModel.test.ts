import { describe, it, expect } from 'vitest'
import type { ConversationSummary } from '@shared/wire/types'
import { partitionArchived } from '../archive/archiveViewModel'
import {
  UNNAMED_LABEL,
  UNKNOWN_WORKSPACE_LABEL,
  UNKNOWN_WORKSPACE_KEY,
  titleFor,
  partitionByPromotion,
  partitionActive,
  workspaceLabelFor,
  groupByWorkspace,
  groupByServer,
  formatLastActivity
} from './channelListViewModel'

// A minimal row factory — only the fields the view-model reads matter; the rest are opaque filler.
function row(over: Partial<ConversationSummary>): ConversationSummary {
  return {
    id: 'id',
    name: null,
    is_promoted: false,
    is_archived: false,
    cwd: '/tmp',
    last_message_ts: '2026-01-15T12:00:00.000Z',
    last_used_at: '2026-01-15T12:00:00.000Z',
    workspace_label: null,
    ...over
  }
}

// A row plus its server stamp (#1070). Structurally what `groupByServer` constrains on, and assignable
// FROM the store's `ServerConversationSummary` — declared here rather than imported so this file stays
// free of the store module, which is the property `groupByServer`'s own signature is shaped around.
function stamped(serverId: string | null | undefined, over: Partial<ConversationSummary>) {
  return { ...row(over), serverId }
}

describe('titleFor', () => {
  it('returns a present, non-blank name verbatim', () => {
    expect(titleFor('kitchenclaw refactor')).toBe('kitchenclaw refactor')
  })

  it('falls back to the unnamed label for null (AC3: never a blank row)', () => {
    expect(titleFor(null)).toBe(UNNAMED_LABEL)
  })

  it('falls back to the unnamed label for empty and whitespace-only names', () => {
    expect(titleFor('')).toBe(UNNAMED_LABEL)
    expect(titleFor('   ')).toBe(UNNAMED_LABEL)
  })
})

describe('partitionByPromotion', () => {
  it('splits promoted into channels and unpromoted into discussions', () => {
    const rows = [
      row({ id: 'c1', is_promoted: true }),
      row({ id: 'd1', is_promoted: false }),
      row({ id: 'c2', is_promoted: true }),
      row({ id: 'd2', is_promoted: false })
    ]
    const { channels, discussions } = partitionByPromotion(rows)
    expect(channels.map((r) => r.id)).toEqual(['c1', 'c2'])
    expect(discussions.map((r) => r.id)).toEqual(['d1', 'd2'])
  })

  it('preserves the store array order within each section (no re-sort)', () => {
    const rows = [
      row({ id: 'c-late', is_promoted: true }),
      row({ id: 'c-early', is_promoted: true })
    ]
    const { channels } = partitionByPromotion(rows)
    // Order is the daemon's; the view must not re-sort.
    expect(channels.map((r) => r.id)).toEqual(['c-late', 'c-early'])
  })

  it('yields an empty discussions list when every row is promoted', () => {
    const { channels, discussions } = partitionByPromotion([row({ is_promoted: true })])
    expect(channels).toHaveLength(1)
    expect(discussions).toHaveLength(0)
  })

  it('yields an empty channels list when every row is unpromoted', () => {
    const { channels, discussions } = partitionByPromotion([row({ is_promoted: false })])
    expect(channels).toHaveLength(0)
    expect(discussions).toHaveLength(1)
  })
})

// The exact dual of archiveViewModel.partitionArchived: the active list keeps only non-archived rows.
describe('partitionActive', () => {
  it('drops archived rows — only non-archived rows survive across both sections (#469)', () => {
    const rows = [
      row({ id: 'live', is_archived: false }),
      row({ id: 'gone', is_archived: true }),
      row({ id: 'live2', is_archived: false })
    ]
    const { channels, discussions } = partitionActive(rows)
    expect([...channels, ...discussions].map((r) => r.id).sort()).toEqual(['live', 'live2'])
  })

  it('splits the non-archived subset into channels (promoted) / discussions (unpromoted)', () => {
    const rows = [
      row({ id: 'c1', is_archived: false, is_promoted: true }),
      row({ id: 'd1', is_archived: false, is_promoted: false }),
      // An archived promoted row must NOT leak into channels.
      row({ id: 'archived-channel', is_archived: true, is_promoted: true }),
      row({ id: 'c2', is_archived: false, is_promoted: true })
    ]
    const { channels, discussions } = partitionActive(rows)
    expect(channels.map((r) => r.id)).toEqual(['c1', 'c2'])
    expect(discussions.map((r) => r.id)).toEqual(['d1'])
  })

  it.each([true, false])('sorts the worked example (promoted=%s)', (is_promoted) => {
    const rows = ['beta', 'Alpha', 'alpha', 'Émile', 'zeta', null]
      .map((name, index) => row({ id: String(index), name, is_promoted }))
    const result = partitionActive(rows)
    expect((is_promoted ? result.channels : result.discussions).map(r => titleFor(r.name)))
      .toEqual(['Alpha', 'alpha', 'beta', 'Émile', 'Untitled', 'zeta'])
  })

  it.each([
    { names: [null, 'zeta', ' ', '', 'Alpha'], ids: ['4', '0', '2', '3', '1'] },
    { names: [' beta ', '\tAlpha\n', 'alpha'], ids: ['1', '2', '0'] },
    { names: ['ﬃ', 'Ｆoo', 'Émile', 'e\u0301clair', 'delta'], ids: ['4', '3', '2', '0', '1'] },
    { names: ['Chat 2', 'Chat 10', 'Chat 1'], ids: ['2', '1', '0'] },
    { names: ['\uE000', '𐀀', '😀', 'z'], ids: ['3', '1', '2', '0'] },
    { names: ['alpha', 'Álpha', 'Alpha'], ids: ['2', '0', '1'] }
  ])('uses the specified keys and UTF-16 label ties for $names', ({ names, ids }) => {
    const result = partitionActive(names.map((name, index) => row({ id: String(index), name })))
    expect(result.discussions.map(r => r.id)).toEqual(ids)
  })

  it('breaks identical trimmed-label ties by UTF-16 id without mutating rows or input', () => {
    const rows = Object.freeze([
      Object.freeze(stamped('host-b', { id: '\uE000', name: ' Alpha ' })),
      Object.freeze(stamped('host-a', { id: '𐀀', name: 'Alpha' })),
      Object.freeze(stamped('host-a', { id: 'a', name: '\tAlpha' }))
    ])
    const before = rows.map(r => ({ ...r }))
    const { discussions } = partitionActive(rows)
    expect(discussions.map(r => r.id)).toEqual(['a', '𐀀', '\uE000'])
    expect(rows).toEqual(before)
    expect(discussions).toEqual([rows[2], rows[1], rows[0]])
    expect(discussions[0]).toBe(rows[2])
    expect(discussions[1]).toBe(rows[1])
    expect(discussions[2]).toBe(rows[0])
    expect(discussions.map(r => r.serverId)).toEqual(['host-a', 'host-a', 'host-b'])
  })

  it('keeps the shared partition and Archive in input order despite unsorted names', () => {
    const rows = [
      row({ id: 'cz', name: 'Zulu', is_promoted: true, is_archived: true }),
      row({ id: 'dz', name: 'Zulu', is_archived: true }),
      row({ id: 'ca', name: 'Alpha', is_promoted: true, is_archived: true }),
      row({ id: 'da', name: 'Alpha', is_archived: true }),
      row({ id: 'active', name: 'Active' })
    ]
    const shared = partitionByPromotion(rows)
    expect(shared.channels.map(r => r.id)).toEqual(['cz', 'ca'])
    expect(shared.discussions.map(r => r.id)).toEqual(['dz', 'da', 'active'])
    const archived = partitionArchived(rows)
    expect(archived.channels.map(r => r.id)).toEqual(['cz', 'ca'])
    expect(archived.discussions.map(r => r.id)).toEqual(['dz', 'da'])
    expect(partitionActive(rows).discussions.map(r => r.id)).toEqual(['active'])
    expect(partitionActive(rows).channels).toEqual([])
  })

  it('yields both sections empty when every row is archived', () => {
    const { channels, discussions } = partitionActive([
      row({ id: 'a', is_archived: true, is_promoted: true }),
      row({ id: 'b', is_archived: true, is_promoted: false })
    ])
    expect(channels).toHaveLength(0)
    expect(discussions).toHaveLength(0)
  })
})

// #703: `cwd` is untrusted daemon text used as an opaque grouping key and a display label — never a
// filesystem argument. The function must be TOTAL over `string` (no throw path, since a thrown error
// would carry the offending cwd into an error boundary) and must never blank a label.
describe('workspaceLabelFor', () => {
  it('returns the last path segment, not the full path (AC2)', () => {
    expect(workspaceLabelFor('/home/me/pyrycode')).toBe('pyrycode')
  })

  it('skips a trailing separator, repeated separators and a whitespace-only tail segment', () => {
    expect(workspaceLabelFor('/home/me/pyrycode/')).toBe('pyrycode')
    expect(workspaceLabelFor('/home/me/pyrycode//')).toBe('pyrycode')
    expect(workspaceLabelFor('/home/me/  ')).toBe('me')
  })

  it('returns a relative single-segment cwd verbatim', () => {
    expect(workspaceLabelFor('pyrycode')).toBe('pyrycode')
  })

  it('survives an unfamiliar separator convention without throwing or blanking', () => {
    // `\` is deliberately NOT a separator: treating it as one would be an assumption about the daemon's
    // host OS, and it would corrupt a legal Unix directory whose name contains a backslash. With no `/`
    // present the whole value is its own single segment — survived, not silently reinterpreted. This
    // row pins today's behaviour so a future Windows-daemon change is visible rather than silent.
    expect(workspaceLabelFor('C:\\Users\\me\\proj')).toBe('C:\\Users\\me\\proj')
  })

  it('returns null when there is no usable segment at all (AC3)', () => {
    expect(workspaceLabelFor('')).toBeNull()
    expect(workspaceLabelFor('   ')).toBeNull()
    expect(workspaceLabelFor('/')).toBeNull()
    expect(workspaceLabelFor('//')).toBeNull()
  })

  it('does no parsing of its own — a markup-shaped segment comes back as an ordinary string', () => {
    expect(workspaceLabelFor('/home/<script>alert(1)')).toBe('<script>alert(1)')
  })
})

describe('groupByWorkspace', () => {
  it('groups rows with an identical cwd into one group, in array order (AC1, AC4)', () => {
    const groups = groupByWorkspace([
      row({ id: 'a', cwd: '/home/me/alpha' }),
      row({ id: 'b', cwd: '/home/me/alpha' })
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('alpha')
    expect(groups[0].rows.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('normalises nothing — two spellings of one directory stay two groups (AC1)', () => {
    const groups = groupByWorkspace([
      row({ id: 'a', cwd: '/home/me/alpha' }),
      row({ id: 'b', cwd: '/home/me/alpha/' })
    ])
    expect(groups.map((g) => g.key)).toEqual(['/home/me/alpha', '/home/me/alpha/'])
    // Same label on both: the honest surface the ticket asks for, not a silent merge.
    expect(groups.map((g) => g.label)).toEqual(['alpha', 'alpha'])
  })

  it('orders groups by first appearance and keeps interleaved rows in array order (AC4)', () => {
    const groups = groupByWorkspace([
      row({ id: 'a1', cwd: '/w/alpha' }),
      row({ id: 'b1', cwd: '/w/beta' }),
      row({ id: 'a2', cwd: '/w/alpha' })
    ])
    expect(groups.map((g) => g.label)).toEqual(['alpha', 'beta'])
    expect(groups[0].rows.map((r) => r.id)).toEqual(['a1', 'a2'])
    expect(groups[1].rows.map((r) => r.id)).toEqual(['b1'])
  })

  it('keeps first-appearance order for an integer-like cwd (AC4 — a Map, not a plain object)', () => {
    // A plain-object accumulator enumerates integer-like string keys FIRST, in numeric order, whatever
    // the insertion order — so `'2'` would jump ahead of `'/x'`. `cwd` is arbitrary untrusted text, so a
    // relative cwd of `'2'` is a legal key. This is the test that makes "no sort anywhere" real.
    const groups = groupByWorkspace([row({ id: 'a', cwd: '/x' }), row({ id: 'b', cwd: '2' })])
    expect(groups.map((g) => g.label)).toEqual(['x', '2'])
  })

  it('collapses every unusable cwd into ONE clearly-labelled fallback group (AC3)', () => {
    const groups = groupByWorkspace([
      row({ id: 'a', cwd: '' }),
      row({ id: 'b', cwd: '   ' }),
      row({ id: 'c', cwd: '/' })
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe(UNKNOWN_WORKSPACE_LABEL)
    expect(groups[0].rows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('orders the fallback group by first appearance too, never pinned last (AC4)', () => {
    const groups = groupByWorkspace([row({ id: 'a', cwd: '/' }), row({ id: 'b', cwd: '/w/beta' })])
    expect(groups.map((g) => g.label)).toEqual([UNKNOWN_WORKSPACE_LABEL, 'beta'])
  })

  it('never folds a real workspace named like the fallback into the fallback group (AC3)', () => {
    // The grouping key is the cwd itself, never a comparison against the fallback COPY — deriving it by
    // comparing labels would swallow a real directory literally named "Unknown workspace".
    const groups = groupByWorkspace([
      row({ id: 'real', cwd: UNKNOWN_WORKSPACE_LABEL }),
      row({ id: 'unusable', cwd: '/' })
    ])
    expect(groups.map((g) => g.rows.map((r) => r.id))).toEqual([['real'], ['unusable']])
    // Both render the same label — the #716 display ambiguity — but they stay distinct groups.
    expect(groups.map((g) => g.label)).toEqual([UNKNOWN_WORKSPACE_LABEL, UNKNOWN_WORKSPACE_LABEL])
  })

  it('returns an empty array for empty input', () => {
    expect(groupByWorkspace([])).toEqual([])
  })

  // --- #1287: the daemon-held workspace label is preferred over the folder name ---

  it("labels a group with its FIRST row's non-null workspace_label (AC2)", () => {
    const groups = groupByWorkspace([
      row({ id: 'a', cwd: '/home/juhana/sb', workspace_label: 'Second Brain' }),
      row({ id: 'b', cwd: '/home/juhana/sb', workspace_label: 'Second Brain' })
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Second Brain')
    expect(groups[0].rows.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('reads the FIRST row only — a later row disagreeing does not change the label (AC2)', () => {
    // The daemon holds ONE label per cwd, so within a group the values agree and reading the first is how
    // this says so. Pinned rather than left implicit: a "last wins" or "first non-null wins" refactor would
    // pass every other test in this block and quietly change which of two disagreeing values is authoritative.
    const groups = groupByWorkspace([
      row({ id: 'a', cwd: '/w/sb', workspace_label: 'Second Brain' }),
      row({ id: 'b', cwd: '/w/sb', workspace_label: 'Something Else' }),
      row({ id: 'c', cwd: '/w/sb', workspace_label: null })
    ])
    expect(groups.map((g) => g.label)).toEqual(['Second Brain'])
  })

  it('falls back to the folder segment when the first row carries null (AC2)', () => {
    const groups = groupByWorkspace([
      row({ id: 'a', cwd: '/home/juhana/sb', workspace_label: null }),
      row({ id: 'b', cwd: '/home/juhana/sb', workspace_label: 'ignored — not the first row' })
    ])
    expect(groups.map((g) => g.label)).toEqual(['sb'])
  })

  it('keeps the group KEY the raw cwd even when a label is present (AC3)', () => {
    // THE SECURITY-RELEVANT HALF, asserted on the key rather than on the label. The workspace row's plus
    // sends this key back OUT as a create's `cwd` (ChannelList's CollapsibleWorkspaceGroup call site), so a
    // key sourced from the label would send a daemon-asserted NAME to the daemon as a DIRECTORY PATH.
    const groups = groupByWorkspace([
      row({ id: 'a', cwd: '/home/juhana/sb', workspace_label: 'Second Brain' })
    ])
    expect(groups.map((g) => g.key)).toEqual(['/home/juhana/sb'])
  })

  it('groups by cwd alone — differing labels never split a group, matching labels never merge one (AC3)', () => {
    const groups = groupByWorkspace([
      row({ id: 'a', cwd: '/w/one', workspace_label: 'Shared Name' }),
      row({ id: 'b', cwd: '/w/two', workspace_label: 'Shared Name' }),
      row({ id: 'c', cwd: '/w/one', workspace_label: 'A Different Name' })
    ])
    expect(groups.map((g) => g.key)).toEqual(['/w/one', '/w/two'])
    expect(groups.map((g) => g.rows.map((r) => r.id))).toEqual([['a', 'c'], ['b']])
  })

  it('labels the unknown-workspace group with the constant WHATEVER its rows carry (AC2)', () => {
    // That group is a BUCKET, not a workspace: every row with an unusable cwd collapses into it whatever
    // its origin, so naming it after one member would assert something false about the others.
    const groups = groupByWorkspace([
      row({ id: 'a', cwd: '', workspace_label: 'Second Brain' }),
      row({ id: 'b', cwd: '/', workspace_label: 'Another Label' })
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe(UNKNOWN_WORKSPACE_KEY)
    expect(groups[0].label).toBe(UNKNOWN_WORKSPACE_LABEL)
  })

  it('uses a blank workspace_label VERBATIM — the client normalises nothing', () => {
    // Deliberate, and the opposite of `titleFor`'s blank guard. A label is state a user set from some
    // client; rewriting a blank one locally would make this desktop disagree with mobile about what the
    // workspace is called, silently and only on this machine. Rejecting a blank belongs to the verbs that
    // SET one (#1288 / #1289) and to the dialog that sends it (#1180), where it can be refused to the user.
    const groups = groupByWorkspace([row({ id: 'a', cwd: '/w/sb', workspace_label: '   ' })])
    expect(groups.map((g) => g.label)).toEqual(['   '])
  })

  // --- #1485: the second list contributes KEYS AND LABELS, never rows. It is what makes one host's
  // workspace set the union of both trees' rows, so a workspace created in the Chats tree draws a row —
  // with its plus and its pen — in the Channels tree too, and the mirror case likewise. ---

  it('mints a group from a key only the second list carries, holding NO rows (#1485)', () => {
    const groups = groupByWorkspace([row({ id: 'a', cwd: '/w/alpha' })], [row({ id: 'b', cwd: '/w/beta' })])
    expect(groups.map((g) => g.key)).toEqual(['/w/alpha', '/w/beta'])
    expect(groups.map((g) => g.label)).toEqual(['alpha', 'beta'])
    // The whole of the contract's second half: the mirrored group is a HEAD ROW and nothing beneath it.
    expect(groups.map((g) => g.rows.map((r) => r.id))).toEqual([['a'], []])
  })

  it('omitting the second list is byte-identical to the one-list call (#1485)', () => {
    // The back-compat every existing caller rests on — the parameter is additive, and a call that passes
    // nothing must not acquire a behaviour. Asserted against the widened call with an EMPTY second list
    // too, so "no argument" and "an empty argument" cannot drift apart.
    const rows = [row({ id: 'a', cwd: '/w/alpha' }), row({ id: 'b', cwd: '/' })]
    expect(groupByWorkspace(rows, [])).toEqual(groupByWorkspace(rows))
  })

  it('lets the PRIMARY list own the rows, the label and the position of a shared key (#1485)', () => {
    // A key in both lists is ONE group. The secondary's row does not join it — it is drawn in its own
    // tree — and the secondary's label does not overwrite the primary's, so each tree reads the name off
    // a row it actually holds and the two agree only because the daemon holds one label per cwd.
    const groups = groupByWorkspace(
      [row({ id: 'a', cwd: '/w/sb', workspace_label: 'Second Brain' })],
      [row({ id: 'b', cwd: '/w/sb', workspace_label: 'Disagreeing Label' })]
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Second Brain')
    expect(groups[0].rows.map((r) => r.id)).toEqual(['a'])
  })

  it('orders primary keys first, then secondary-only keys by their own first appearance (#1485)', () => {
    // The order the ticket accepts for this slice: each tree leads with the keys its OWN rows put there.
    // `beta` is seen first in the secondary list but follows both primary keys; `alpha` is already a
    // primary key, so its second sighting moves nothing.
    const groups = groupByWorkspace(
      [row({ id: 'p1', cwd: '/w/alpha' }), row({ id: 'p2', cwd: '/w/gamma' })],
      [
        row({ id: 's1', cwd: '/w/beta' }),
        row({ id: 's2', cwd: '/w/alpha' }),
        row({ id: 's3', cwd: '/w/delta' }),
        row({ id: 's4', cwd: '/w/beta' })
      ]
    )
    expect(groups.map((g) => g.label)).toEqual(['alpha', 'gamma', 'beta', 'delta'])
  })

  it("labels a secondary-only group by ITS first row's workspace_label, falling back to the segment (#1485)", () => {
    // #1287's preference, applied to the mirror by the same rule and read off the list that actually
    // carries a row for the key — there is no other row to read it from.
    const groups = groupByWorkspace(
      [],
      [
        row({ id: 's1', cwd: '/w/sb', workspace_label: 'Second Brain' }),
        row({ id: 's2', cwd: '/w/sb', workspace_label: 'Ignored' }),
        row({ id: 's3', cwd: '/w/plain' })
      ]
    )
    expect(groups.map((g) => g.key)).toEqual(['/w/sb', '/w/plain'])
    expect(groups.map((g) => g.label)).toEqual(['Second Brain', 'plain'])
  })

  it('never propagates the unknown bucket from the second list (#1485, AC4)', () => {
    // An unusable `cwd` on one side must not conjure a group on the other. The bucket is a collapse of
    // rows this client cannot place, so mirroring it would draw a workspace row in a tree with nothing to
    // collapse INTO it — and its key is the empty string, which names no directory.
    const groups = groupByWorkspace(
      [row({ id: 'a', cwd: '/w/alpha' })],
      [row({ id: 'b', cwd: '/' }), row({ id: 'c', cwd: '   ' })]
    )
    expect(groups.map((g) => g.key)).toEqual(['/w/alpha'])
  })

  it("keeps the primary list's OWN unknown bucket (#1485, AC4's other direction)", () => {
    // The skip above is on the SECONDARY list alone. A tree whose own rows put something in the bucket
    // still draws it, exactly as before — and a secondary unusable row still adds nothing to it.
    const groups = groupByWorkspace([row({ id: 'a', cwd: '//' })], [row({ id: 'b', cwd: '/' })])
    expect(groups.map((g) => g.key)).toEqual([UNKNOWN_WORKSPACE_KEY])
    expect(groups.map((g) => g.label)).toEqual([UNKNOWN_WORKSPACE_LABEL])
    expect(groups[0].rows.map((r) => r.id)).toEqual(['a'])
  })
})

describe('groupByServer (#1070)', () => {
  // The ids the paired-server list supplies. Opaque, client-held, and deliberately NOT ordered
  // alphabetically here: every ordering assertion below would pass vacuously if they were.
  const PYRYBOX = 'server-pyrybox'
  const MACBOOK = 'server-macbook'

  const ids = (rows: readonly { id: string }[]): string[] => rows.map((r) => r.id)

  it('files each row under its own server, in the LIST order and not the row order (AC1)', () => {
    const { servers, unattributed } = groupByServer(
      [PYRYBOX, MACBOOK],
      [
        stamped(MACBOOK, { id: 'm1' }),
        stamped(PYRYBOX, { id: 'p1' }),
        stamped(MACBOOK, { id: 'm2' })
      ]
    )
    // Pairing order — oldest-paired first — even though the first row seen belongs to the second server.
    expect(servers.map((s) => s.serverId)).toEqual([PYRYBOX, MACBOOK])
    expect(servers.map((s) => ids(s.rows))).toEqual([['p1'], ['m1', 'm2']])
    // Within a server, wire order is preserved: nothing sorts.
    expect(unattributed).toEqual([])
  })

  it('keeps two servers sharing an IDENTICAL cwd apart (AC1, the silent-merge case)', () => {
    // The collision this whole level exists to prevent: `groupByWorkspace`'s key is the raw path, and a
    // path is unique only WITHIN one machine. Split by server first and each machine groups its own.
    const shared = '/home/user/project'
    const { servers } = groupByServer(
      [PYRYBOX, MACBOOK],
      [stamped(PYRYBOX, { id: 'p1', cwd: shared }), stamped(MACBOOK, { id: 'm1', cwd: shared })]
    )
    const grouped = servers.map((s) => groupByWorkspace(s.rows))
    expect(grouped.map((groups) => groups.length)).toEqual([1, 1])
    expect(grouped.map((groups) => groups.map((g) => ids(g.rows)))).toEqual([[['p1']], [['m1']]])
    // Both groups carry the same key and the same label — that is the point. They are two groups anyway,
    // because they were never handed to one grouper.
    expect(grouped.map((groups) => groups[0].key)).toEqual([shared, shared])
  })

  it('takes #1485’s union PER HOST — one machine’s path never mints a group on another', () => {
    // The composition the sidebar performs, and the reason the complement is split by server BEFORE it
    // reaches `groupByWorkspace` rather than being handed over whole. `index.ts` routes a create as
    // `servers.route(command.serverId)`, so the workspace row's plus sends its group's key to the host
    // the row is drawn under. A cross-host union would draw Pyrybox's directory under Macbook and send
    // that path to Macbook — a create in a directory the operator never chose, on a machine that was
    // never told it. Structural, invisible at the call site, and therefore pinned here.
    const secret = '/home/user/pyrybox-only'
    const channels = [stamped(PYRYBOX, { id: 'p1', cwd: secret, is_promoted: true })]
    const discussions = [stamped(MACBOOK, { id: 'm1', cwd: '/home/user/macbook-only' })]
    const byHost = (
      primary: readonly ReturnType<typeof stamped>[],
      complement: readonly ReturnType<typeof stamped>[]
    ): string[][] => {
      const complementRows = new Map(
        groupByServer([PYRYBOX, MACBOOK], complement).servers.map((s) => [s.serverId, s.rows])
      )
      return groupByServer([PYRYBOX, MACBOOK], primary).servers.map((s) =>
        groupByWorkspace(s.rows, complementRows.get(s.serverId) ?? []).map((g) => g.key)
      )
    }
    // Channels tree: Pyrybox draws its own promoted row's group; Macbook draws the group its OWN
    // unpromoted row mirrors, and emphatically not Pyrybox's path.
    expect(byHost(channels, discussions)).toEqual([[secret], ['/home/user/macbook-only']])
    // Chats tree, the same claim with the lists swapped.
    expect(byHost(discussions, channels)).toEqual([[secret], ['/home/user/macbook-only']])
  })

  it('gives a server with no rows in this section an empty group, never no group (AC2)', () => {
    // The freshly-paired machine. Its group is what the caller draws a bare host row from.
    const { servers } = groupByServer([PYRYBOX, MACBOOK], [stamped(PYRYBOX, { id: 'p1' })])
    expect(servers.map((s) => s.serverId)).toEqual([PYRYBOX, MACBOOK])
    expect(servers.map((s) => ids(s.rows))).toEqual([['p1'], []])
  })

  it('never drops a row: an unstamped or unknown-server row goes to unattributed', () => {
    // `ConversationListOrigin` admits null and undefined, and a stamp naming an unpaired machine is the
    // third shape. #1068 stamps every event main-side so none is reachable in production — but the type
    // allows all three and a server-keyed tree has to answer for them. Silently dropping is the one
    // outcome ruled out; filing them under the first paired server would name a machine on no evidence.
    const rows = [
      stamped(PYRYBOX, { id: 'p1' }),
      stamped(null, { id: 'bound-but-unpaired' }),
      stamped(undefined, { id: 'never-bound' }),
      stamped('server-departed', { id: 'unknown-machine' })
    ]
    const { servers, unattributed } = groupByServer([PYRYBOX], rows)
    expect(servers.map((s) => ids(s.rows))).toEqual([['p1']])
    expect(ids(unattributed)).toEqual(['bound-but-unpaired', 'never-bound', 'unknown-machine'])
    // Stated as the invariant rather than as three cases: the partition is TOTAL.
    const filed = servers.reduce((n, s) => n + s.rows.length, 0) + unattributed.length
    expect(filed).toBe(rows.length)
  })

  it('puts every row in unattributed when no server is paired yet', () => {
    // The frames before the paired-server one-shot settles. The rows still render; no host row does.
    const { servers, unattributed } = groupByServer([], [stamped(PYRYBOX, { id: 'p1' })])
    expect(servers).toEqual([])
    expect(ids(unattributed)).toEqual(['p1'])
  })

  it('collapses a repeated id to ONE group, so no two groups can share a React key', () => {
    // Unreachable through `decodeCollection` (a repeated `server` reads as a malformed collection), but
    // two groups sharing a key is a React-level defect rather than a rendering one, so the grouper
    // refuses to emit it rather than trusting its caller.
    const { servers } = groupByServer(
      [PYRYBOX, PYRYBOX],
      [stamped(PYRYBOX, { id: 'p1' }), stamped(PYRYBOX, { id: 'p2' })]
    )
    expect(servers.map((s) => s.serverId)).toEqual([PYRYBOX])
    expect(servers.map((s) => ids(s.rows))).toEqual([['p1', 'p2']])
  })

  it('treats a `__proto__` stamp as an ordinary missing key, never a prototype read', () => {
    // The `Map`-not-object rule, as a behaviour rather than a style note: on a `Record<string, T[]>` the
    // lookup below resolves `Object.prototype` — a truthy non-array — and the row is pushed onto it or
    // throws. Client-set stamps make this unreachable; the assertion is what keeps the Map deliberate.
    const { servers, unattributed } = groupByServer(
      [PYRYBOX],
      [stamped('__proto__', { id: 'hostile' })]
    )
    expect(servers.map((s) => ids(s.rows))).toEqual([[]])
    expect(ids(unattributed)).toEqual(['hostile'])
  })

  it('returns empty for empty input', () => {
    expect(groupByServer([], [])).toEqual({ servers: [], unattributed: [] })
  })
})

describe('formatLastActivity', () => {
  // A fixed injected `now` keeps the buckets deterministic (no Date.now() inside the function).
  const now = Date.parse('2026-01-15T12:00:00.000Z')
  const isoAgo = (msAgo: number): string => new Date(now - msAgo).toISOString()

  it("clamps sub-minute deltas to 'just now'", () => {
    expect(formatLastActivity(isoAgo(0), now)).toBe('just now')
    expect(formatLastActivity(isoAgo(30_000), now)).toBe('just now')
  })

  it('formats minutes and hours', () => {
    expect(formatLastActivity(isoAgo(5 * 60_000), now)).toBe('5m ago')
    expect(formatLastActivity(isoAgo(3 * 3_600_000), now)).toBe('3h ago')
  })

  it("formats the 24-48h window as 'Yesterday'", () => {
    expect(formatLastActivity(isoAgo(30 * 3_600_000), now)).toBe('Yesterday')
  })

  it("formats the 2-6 day window as 'N days ago'", () => {
    expect(formatLastActivity(isoAgo(50 * 3_600_000), now)).toBe('2 days ago')
    expect(formatLastActivity(isoAgo(6 * 86_400_000), now)).toBe('6 days ago')
  })

  it('formats older-than-a-week as a stable, timezone-independent date', () => {
    // now - 10 days = 2026-01-05 (UTC). The exact rendering is the developer's choice; the test
    // asserts only a stable, non-empty substring that does not depend on the runner's timezone.
    const out = formatLastActivity(isoAgo(10 * 86_400_000), now)
    expect(out).not.toBe('')
    expect(out).toContain('Jan')
  })

  it("returns '' for a malformed / non-parseable timestamp (row renders title only)", () => {
    expect(formatLastActivity('not-a-date', now)).toBe('')
    expect(formatLastActivity('', now)).toBe('')
  })

  it("clamps a future timestamp (clock skew) to 'just now', never a negative delta", () => {
    expect(formatLastActivity(isoAgo(-60_000), now)).toBe('just now')
  })
})
