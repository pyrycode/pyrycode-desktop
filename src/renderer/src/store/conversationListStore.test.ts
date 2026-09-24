import { describe, it, expect } from 'vitest'
import type { ConversationSummary } from '@shared/wire/types'
import {
  createConversationListStore,
  initialConversationListState,
  selectArchivedCount,
  selectConversations,
  selectConversationIdsFor,
  selectConversationsFor,
  selectExclusiveConversationIdsFor,
  EMPTY_CONVERSATION_IDS,
  type ConversationListOrigin,
  type ConversationListState,
  type ServerConversationSummary
} from './conversationListStore'

// Plain-function store tests over isolated createConversationListStore() instances — the
// runConfigStore.test idiom. No React, no bridge: the store is pure renderer state with a single
// set-on-event mutation plus #1086's pairing-boundary clear. Rows are held in wire snake_case (no
// camelCase remap, unlike runConfigStore) with ONE client-owned property added beside them — the
// whole point is drift-free reuse of ConversationSummary.

const row = (over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: 'c1',
  name: 'Design review',
  is_promoted: true,
  is_archived: false,
  cwd: '/home/pyry/project',
  last_message_ts: '2026-07-10T12:00:00Z',
  last_used_at: '2026-07-10T12:05:00Z',
  workspace_label: null,
  ...over
})

/** The same row as it should read back out of the store: verbatim wire fields plus the stamp. */
const stamped = (
  serverId: ConversationListOrigin,
  over: Partial<ConversationSummary> = {}
): ServerConversationSummary => ({ ...row(over), serverId })

/** A whole state literal, for the pure selectors that take one. */
const state = (
  entries: readonly (readonly [ConversationListOrigin, readonly ServerConversationSummary[]])[]
): ConversationListState => {
  const store = createConversationListStore()
  for (const [origin, rows] of entries) store.getState().setConversations(rows, origin)
  return store.getState()
}

describe('conversationListStore', () => {
  it('starts not-loaded — conversations is null and no server has reported (AC3)', () => {
    const store = createConversationListStore()
    expect(store.getState().conversations).toBeNull()
    expect(selectConversations(store.getState())).toBeNull()
    expect(store.getState().byServer.size).toBe(0)
  })

  it('with ONE server the flat read is the wire list, in wire order, plus the stamp (AC3)', () => {
    const store = createConversationListStore()
    // Deliberately NOT id-sorted: the daemon owns the order within a server and nothing re-sorts rows.
    store.getState().setConversations([row({ id: 'z' }), row({ id: 'a' })], 'srv-1')
    expect(selectConversations(store.getState())).toEqual([
      stamped('srv-1', { id: 'z' }),
      stamped('srv-1', { id: 'a' })
    ])
  })

  it('holds an empty list verbatim — [] is loaded-zero, NOT null (AC3)', () => {
    const store = createConversationListStore()
    store.getState().setConversations([], 'srv-1')
    const held = selectConversations(store.getState())
    expect(held).not.toBeNull()
    expect(held).toEqual([])
  })

  it('holds a row verbatim in snake_case, including name: null (AC2)', () => {
    const store = createConversationListStore()
    store
      .getState()
      .setConversations([row({ id: 'u', name: null, is_promoted: false, is_archived: true })], 'srv-1')
    expect(selectConversations(store.getState())).toEqual([
      {
        id: 'u',
        name: null,
        is_promoted: false,
        is_archived: true,
        cwd: '/home/pyry/project',
        last_message_ts: '2026-07-10T12:00:00Z',
        last_used_at: '2026-07-10T12:05:00Z',
        // #1287's daemon-held workspace name rides through untouched like every other wire field. Spelled
        // out rather than omitted: this literal IS the verbatim-hold proof, so a field left off it would
        // narrow the claim to "holds the fields we remembered to list".
        workspace_label: null,
        serverId: 'srv-1'
      }
    ])
  })

  it('holds the decoded is_muted value per row, true and false alike (#1594)', () => {
    const store = createConversationListStore()
    store
      .getState()
      .setConversations([row({ id: 'm', is_muted: true }), row({ id: 'n', is_muted: false })], 'srv-1')
    expect(selectConversations(store.getState())?.map((c) => [c.id, c.is_muted])).toEqual([
      ['m', true],
      ['n', false]
    ])
  })

  it('keeps BOTH servers — the second reply no longer overwrites the first (AC1)', () => {
    const store = createConversationListStore()
    store.getState().setConversations([row({ id: 'a1' })], 'srv-a')
    store.getState().setConversations([row({ id: 'b1' })], 'srv-b')
    expect(selectConversations(store.getState())).toEqual([
      stamped('srv-a', { id: 'a1' }),
      stamped('srv-b', { id: 'b1' })
    ])
  })

  it('a reply replaces ONLY the rows of the server it was stamped with (AC1)', () => {
    const store = createConversationListStore()
    store.getState().setConversations([row({ id: 'a1' }), row({ id: 'a2' })], 'srv-a')
    store.getState().setConversations([row({ id: 'b1' })], 'srv-b')
    store.getState().setConversations([row({ id: 'a9' })], 'srv-a')
    expect(selectConversations(store.getState())).toEqual([
      stamped('srv-a', { id: 'a9' }),
      stamped('srv-b', { id: 'b1' })
    ])
  })

  it('takes the stamp from the ARGUMENT, never off the daemon reply (AC2)', () => {
    const store = createConversationListStore()
    // A hostile row claiming another server's slot. Unreachable through the real decoder
    // (parseConversationSummary rebuilds a closed 7-field literal), so this asserts the store's own
    // second fabric: the spread runs first, the client-held stamp last.
    const hostile = { ...row({ id: 'h' }), serverId: 'srv-victim' } as ConversationSummary
    store.getState().setConversations([hostile], 'srv-attacker')
    expect(selectConversations(store.getState())).toEqual([stamped('srv-attacker', { id: 'h' })])
    expect(selectConversationsFor('srv-victim')(store.getState())).toBeNull()
  })

  it('orders servers by id ascending, and the order is unchanged by a later write (AC3)', () => {
    const store = createConversationListStore()
    store.getState().setConversations([row({ id: 'c' })], 'srv-c')
    store.getState().setConversations([row({ id: 'a' })], 'srv-a')
    store.getState().setConversations([row({ id: 'b' })], 'srv-b')
    const ids = (s = store.getState()): unknown =>
      (selectConversations(s) ?? []).map((r) => [r.serverId, r.id])
    expect(ids()).toEqual([
      ['srv-a', 'a'],
      ['srv-b', 'b'],
      ['srv-c', 'c']
    ])
    // A later write to the FIRST-inserted server must not move it back to the front.
    store.getState().setConversations([row({ id: 'c2' })], 'srv-c')
    expect(ids()).toEqual([
      ['srv-a', 'a'],
      ['srv-b', 'b'],
      ['srv-c', 'c2']
    ])
  })

  it('sorts the two non-string origins AFTER every string, null before undefined (AC3)', () => {
    const store = createConversationListStore()
    store.getState().setConversations([row({ id: 'unbound' })])
    store.getState().setConversations([row({ id: 'no-record' })], null)
    store.getState().setConversations([row({ id: 'zzz-server' })], 'zzz')
    expect((selectConversations(store.getState()) ?? []).map((r) => r.serverId)).toEqual([
      'zzz',
      null,
      undefined
    ])
  })

  it('is REFERENTIALLY STABLE — two reads with no write between them are Object.is-equal (AC4)', () => {
    const store = createConversationListStore()
    store.getState().setConversations([row({ id: 'a1' })], 'srv-a')
    expect(selectConversations(store.getState())).toBe(selectConversations(store.getState()))
  })

  it('a write for one server does not churn a reader watching another (AC4)', () => {
    const store = createConversationListStore()
    store.getState().setConversations([row({ id: 'a1' })], 'srv-a')
    store.getState().setConversations([row({ id: 'b1' })], 'srv-b')
    const watchingB = selectConversationsFor('srv-b')
    const before = watchingB(store.getState())
    store.getState().setConversations([row({ id: 'a2' })], 'srv-a')
    expect(watchingB(store.getState())).toBe(before)
  })

  it('never mutates the map it already handed out (copy-on-write, AC4)', () => {
    const store = createConversationListStore()
    store.getState().setConversations([row({ id: 'a1' })], 'srv-a')
    const heldMap = store.getState().byServer
    store.getState().setConversations([row({ id: 'b1' })], 'srv-b')
    expect(heldMap.size).toBe(1)
    expect(store.getState().byServer).not.toBe(heldMap)
  })

  it('keeps two stores independent (DI)', () => {
    const a = createConversationListStore()
    const b = createConversationListStore()
    a.getState().setConversations([row()], 'srv-a')
    expect(selectConversations(a.getState())).not.toBeNull()
    expect(selectConversations(b.getState())).toBeNull()
  })

  it('starts from an injected initial state (DI)', () => {
    const seed = [stamped('srv-a', { id: 'seed' })]
    const store = createConversationListStore({
      conversations: seed,
      byServer: new Map([['srv-a', seed]])
    })
    expect(selectConversations(store.getState())).toEqual(seed)
  })

  it('initialConversationListState is a null list with no servers', () => {
    expect(initialConversationListState.conversations).toBeNull()
    expect(initialConversationListState.byServer.size).toBe(0)
  })

  it('keeps the setter references stable across updates', () => {
    const store = createConversationListStore()
    const before = store.getState().setConversations
    const beforeClear = store.getState().clearAllConversations
    store.getState().setConversations([row()], 'srv-a')
    expect(store.getState().setConversations).toBe(before)
    expect(store.getState().clearAllConversations).toBe(beforeClear)
  })
})

// selectConversationsFor (#1086) — the per-server read #1070 consumes, and the observable form of
// AC4's second clause.
describe('selectConversationsFor', () => {
  it('returns one server’s rows, stamped', () => {
    const s = state([
      ['srv-a', [stamped('srv-a', { id: 'a1' })]],
      ['srv-b', [stamped('srv-b', { id: 'b1' })]]
    ])
    expect(selectConversationsFor('srv-a')(s)).toEqual([stamped('srv-a', { id: 'a1' })])
  })

  it('answers null for a server that has not reported — the store’s own not-loaded sentinel', () => {
    const s = state([['srv-a', [stamped('srv-a', { id: 'a1' })]]])
    expect(selectConversationsFor('srv-b')(s)).toBeNull()
  })

  it('tells loaded-empty apart from not-loaded', () => {
    const s = state([['srv-a', []]])
    expect(selectConversationsFor('srv-a')(s)).toEqual([])
    expect(selectConversationsFor('srv-b')(s)).toBeNull()
  })

  it('reads the two non-string slots', () => {
    const s = state([
      [null, [stamped(null, { id: 'no-record' })]],
      [undefined, [stamped(undefined, { id: 'unbound' })]]
    ])
    expect(selectConversationsFor(null)(s)).toEqual([stamped(null, { id: 'no-record' })])
    expect(selectConversationsFor(undefined)(s)).toEqual([stamped(undefined, { id: 'unbound' })])
  })
})

// selectConversationIdsFor (#1138) — the renderer's shared answer to "which conversations belong to
// this server", landed once here for the three bridges that scope a reconnect reset by it (#1138 queue
// backlogs, #1139 background-task rosters, #1140 outstanding prompts). A projection of
// selectConversationsFor, so the "call it with a client-held id" rule carries forward by construction.
describe('selectConversationIdsFor', () => {
  it('answers one server’s conversation ids, and only that server’s', () => {
    const s = state([
      ['srv-a', [stamped('srv-a', { id: 'a1' }), stamped('srv-a', { id: 'a2' })]],
      ['srv-b', [stamped('srv-b', { id: 'b1' })]]
    ])
    expect([...selectConversationIdsFor('srv-a')(s)].sort()).toEqual(['a1', 'a2'])
    expect(selectConversationIdsFor('srv-a')(s).has('b1')).toBe(false)
  })

  it('collapses not-loaded and loaded-empty to the SAME stable empty set', () => {
    const s = state([['srv-a', []]])
    // The two states selectConversationsFor tells apart (null vs []) are one thing to this consumer:
    // "drop nothing". Exposing the distinction would be a three-state API with no reader.
    expect(selectConversationIdsFor('srv-a')(s)).toBe(EMPTY_CONVERSATION_IDS)
    expect(selectConversationIdsFor('srv-unknown')(s)).toBe(EMPTY_CONVERSATION_IDS)
    expect(EMPTY_CONVERSATION_IDS.size).toBe(0)
  })

  it('gives each of the three origin kinds its own slot and nothing wider', () => {
    const s = state([
      ['srv-a', [stamped('srv-a', { id: 'a1' })]],
      [null, [stamped(null, { id: 'no-record' })]],
      [undefined, [stamped(undefined, { id: 'unbound' })]]
    ])
    expect([...selectConversationIdsFor('srv-a')(s)]).toEqual(['a1'])
    expect([...selectConversationIdsFor(null)(s)]).toEqual(['no-record'])
    expect([...selectConversationIdsFor(undefined)(s)]).toEqual(['unbound'])
  })

  it('takes the ids from the wire ConversationSummary.id, not the stamp', () => {
    const s = state([['srv-a', [stamped('srv-a', { id: 'conv-42' })]]])
    expect([...selectConversationIdsFor('srv-a')(s)]).toEqual(['conv-42'])
  })

  it('holds a __proto__ id as an ordinary member, writing nothing through Object.prototype', () => {
    // ServerOrigin's docblock rules that a consumer indexing by a daemon-adjacent id uses a Map/Set,
    // never a bare object. A daemon chooses these ids, so this is the case that rule exists for.
    const s = state([['srv-a', [stamped('srv-a', { id: '__proto__' })]]])
    const ids = selectConversationIdsFor('srv-a')(s)
    expect(ids.has('__proto__')).toBe(true)
    // The half that actually reddens on a bare-object accumulator: `acc['__proto__'] = true` sets the
    // prototype instead of adding an own key, so the id would vanish from an enumeration entirely
    // rather than merely being unreadable. Asserting the whole membership, not just the lookup.
    expect([...ids]).toEqual(['__proto__'])
  })
})

// selectExclusiveConversationIdsFor (#1196) — the departed set MINUS whatever another slot also claims.
// The ids are the departing daemon's own, so this is the one input on the per-server unpair path that a
// hostile or confused daemon controls; feeding it unfiltered to a thread clear would let it destroy
// another machine's retained threads. Honest daemons are unaffected — ids are UUIDv4.
describe('selectExclusiveConversationIdsFor', () => {
  it('answers the whole slot when no other server claims any of its ids', () => {
    const s = state([
      ['srv-a', [stamped('srv-a', { id: 'a1' }), stamped('srv-a', { id: 'a2' })]],
      ['srv-b', [stamped('srv-b', { id: 'b1' })]]
    ])
    expect([...selectExclusiveConversationIdsFor('srv-a')(s)].sort()).toEqual(['a1', 'a2'])
  })

  it('EXCLUDES an id another server also holds, and keeps that server’s other ids', () => {
    // The cross-machine erase: srv-a lists srv-b's conversation. Dropping it would clear a thread the
    // operator's OTHER machine owns, with no backfill to bring it back.
    const s = state([
      ['srv-a', [stamped('srv-a', { id: 'a1' }), stamped('srv-a', { id: 'shared' })]],
      ['srv-b', [stamped('srv-b', { id: 'shared' })]]
    ])
    expect([...selectExclusiveConversationIdsFor('srv-a')(s)]).toEqual(['a1'])
    // Symmetric: neither server can use the collision to reach into the other.
    expect([...selectExclusiveConversationIdsFor('srv-b')(s)]).toEqual([])
  })

  it('collapses not-loaded, loaded-empty and fully-claimed to the SAME stable empty set', () => {
    const empty = state([['srv-a', []]])
    expect(selectExclusiveConversationIdsFor('srv-a')(empty)).toBe(EMPTY_CONVERSATION_IDS)
    expect(selectExclusiveConversationIdsFor('srv-unknown')(empty)).toBe(EMPTY_CONVERSATION_IDS)
    const claimed = state([
      ['srv-a', [stamped('srv-a', { id: 'shared' })]],
      ['srv-b', [stamped('srv-b', { id: 'shared' })]]
    ])
    expect(selectExclusiveConversationIdsFor('srv-a')(claimed)).toBe(EMPTY_CONVERSATION_IDS)
  })

  it('holds a __proto__ id as an ordinary member on both sides of the comparison', () => {
    const s = state([
      ['srv-a', [stamped('srv-a', { id: '__proto__' })]],
      ['srv-b', [stamped('srv-b', { id: 'b1' })]]
    ])
    expect([...selectExclusiveConversationIdsFor('srv-a')(s)]).toEqual(['__proto__'])
  })
})

// clearConversationsFor (#1196) — the KEYED sibling of clearAllConversations: forgetting one of several
// servers must drop that server's rows and leave every other server's exactly where they were.
describe('clearConversationsFor', () => {
  it('drops the named server’s rows and leaves the survivor’s BY REFERENCE', () => {
    const store = createConversationListStore()
    store.getState().setConversations([row({ id: 'a1' })], 'srv-a')
    store.getState().setConversations([row({ id: 'b1' })], 'srv-b')
    const survivor = selectConversationsFor('srv-b')(store.getState())

    store.getState().clearConversationsFor('srv-a')

    expect(selectConversationsFor('srv-a')(store.getState())).toBeNull()
    // Object.is true for the untouched slot — a component watching srv-b does not re-render.
    expect(selectConversationsFor('srv-b')(store.getState())).toBe(survivor)
  })

  it('recomputes the union so the departed rows stop rendering app-wide (AC1)', () => {
    const store = createConversationListStore()
    store.getState().setConversations([row({ id: 'a1' })], 'srv-a')
    store.getState().setConversations([row({ id: 'b1' })], 'srv-b')

    store.getState().clearConversationsFor('srv-a')

    expect(selectConversations(store.getState())).toEqual([stamped('srv-b', { id: 'b1' })])
  })

  it('dropping the only held slot returns the not-loaded state, not a loaded-empty one', () => {
    // `null` is "no server has reported yet", which is what a lone survivor with no reply in hand is —
    // ChannelList shows its loading affordance rather than a false "zero conversations".
    const store = createConversationListStore()
    store.getState().setConversations([row()], 'srv-a')
    store.getState().clearConversationsFor('srv-a')
    expect(store.getState().conversations).toBeNull()
    expect(store.getState().byServer.size).toBe(0)
  })

  it('hands the state OBJECT back for a server it holds nothing for (the subscriber short-circuit)', () => {
    const store = createConversationListStore()
    store.getState().setConversations([row()], 'srv-a')
    const before = store.getState()
    store.getState().clearConversationsFor('srv-never-paired')
    expect(store.getState()).toBe(before)
  })

  it('leaves a later reply for the SAME server free to refill its slot', () => {
    const store = createConversationListStore()
    store.getState().setConversations([row({ id: 'old' })], 'srv-a')
    store.getState().clearConversationsFor('srv-a')
    store.getState().setConversations([row({ id: 'new' })], 'srv-a')
    expect(selectConversations(store.getState())).toEqual([stamped('srv-a', { id: 'new' })])
  })
})

// clearAllConversations (#1086, AC5) — the pairing-boundary drop that replaces #531's removed
// self-heal. Nullary by design: no daemon-supplied id may steer which server's rows survive.
describe('clearAllConversations', () => {
  it('drops EVERY server’s rows and returns the store to not-loaded (AC5)', () => {
    const store = createConversationListStore()
    store.getState().setConversations([row({ id: 'a1' })], 'srv-a')
    store.getState().setConversations([row({ id: 'b1' })], 'srv-b')
    store.getState().clearAllConversations()
    expect(selectConversations(store.getState())).toBeNull()
    expect(store.getState().byServer.size).toBe(0)
    expect(selectConversationsFor('srv-a')(store.getState())).toBeNull()
  })

  it('is idempotent and hands the state OBJECT back when already clear (AC5)', () => {
    const store = createConversationListStore()
    const before = store.getState()
    store.getState().clearAllConversations()
    // Object.is(next, state) is what makes a redundant clear wake NO listener at all — not merely
    // spare the selectors. Asserted on the state object, not on the fields.
    expect(store.getState()).toBe(before)
  })

  it('a clear then a fresh reply lands only the new pairing’s rows (AC5)', () => {
    const store = createConversationListStore()
    store.getState().setConversations([row({ id: 'departed' })], 'srv-old')
    store.getState().clearAllConversations()
    store.getState().setConversations([row({ id: 'fresh' })], 'srv-new')
    expect(selectConversations(store.getState())).toEqual([stamped('srv-new', { id: 'fresh' })])
  })
})

// selectArchivedCount (#351) — the derived read the Storage row draws its count from. `null` (not yet
// loaded) is passed through as `null` so the row can show a neutral placeholder rather than a spurious
// "0 archived"; a loaded list resolves to the count of `is_archived === true` rows. Since #1086 it
// counts across every server, which is what an operator running several daemons should be shown.
describe('selectArchivedCount', () => {
  it('passes null through — not-yet-loaded stays null, never 0', () => {
    expect(selectArchivedCount(state([]))).toBeNull()
  })

  it('a loaded empty list is 0 archived, distinct from null', () => {
    expect(selectArchivedCount(state([['srv-a', []]]))).toBe(0)
  })

  it('counts zero when the only row is not archived', () => {
    expect(
      selectArchivedCount(state([['srv-a', [stamped('srv-a', { is_archived: false })]]]))
    ).toBe(0)
  })

  it('counts only the archived rows in a mixed list', () => {
    const rows = [
      stamped('srv-a', { id: 'a', is_archived: true }),
      stamped('srv-a', { id: 'b', is_archived: false }),
      stamped('srv-a', { id: 'c', is_archived: true })
    ]
    expect(selectArchivedCount(state([['srv-a', rows]]))).toBe(2)
  })

  it('counts ACROSS servers (#1086)', () => {
    const s = state([
      ['srv-a', [stamped('srv-a', { id: 'a', is_archived: true })]],
      ['srv-b', [stamped('srv-b', { id: 'b', is_archived: true })]]
    ])
    expect(selectArchivedCount(s)).toBe(2)
  })
})
