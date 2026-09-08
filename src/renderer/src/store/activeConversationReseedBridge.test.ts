import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import type { ConversationCreatedPayload, ConversationSummary } from '@shared/wire/types'
import {
  reseededActiveConversation,
  subscribeActiveConversationReseed
} from './activeConversationReseedBridge'

// Framework-free data-path tests with injected spies (the conversationArchivedBridge idiom): no React,
// no Electron, no store. Every case drives the pure decision or the subscription directly.

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

// The snapshot that MATCHES `row()` on all six payload fields — so the default pair is AC4's
// unchanged-refresh case and every "it re-seeds" test has to state which field moved.
const active = (over: Partial<ConversationCreatedPayload> = {}): ConversationCreatedPayload => ({
  id: 'c1',
  is_promoted: true,
  cwd: '/home/pyry/project',
  name: 'Design review',
  last_used_at: '2026-07-10T12:05:00Z',
  workspace_label: null,
  ...over
})

describe('reseededActiveConversation', () => {
  it('re-seeds from the matching row when the daemon renamed the open chat (AC1)', () => {
    const renamed = row({ name: 'Renamed by the daemon' })
    expect(reseededActiveConversation([renamed], active())).toEqual({
      id: 'c1',
      is_promoted: true,
      cwd: '/home/pyry/project',
      name: 'Renamed by the daemon',
      last_used_at: '2026-07-10T12:05:00Z',
      workspace_label: null
    })
  })

  it('re-seeds an auto-named chat whose snapshot name was null (the pyrycode#2159 case, AC1)', () => {
    const named = row({ name: 'Fix the relay dial path' })
    expect(reseededActiveConversation([named], active({ name: null }))?.name).toBe(
      'Fix the relay dial path'
    )
  })

  it('carries every field the payload holds, and DROPS the two the summary has spare (AC2)', () => {
    const moved = row({
      id: 'c1',
      name: 'Saved as a channel',
      is_promoted: false,
      cwd: '/home/pyry/second-brain',
      last_used_at: '2026-07-11T08:00:00Z',
      workspace_label: 'Second Brain',
      // Neither of these has a slot in ConversationCreatedPayload. A closed six-field reconstruction —
      // never a structural pass-through of the row — is what keeps them (and any unknown key) out.
      is_archived: true,
      last_message_ts: '2026-07-11T07:59:00Z'
    })
    const reseeded = reseededActiveConversation([moved], active())
    expect(reseeded).toEqual({
      id: 'c1',
      is_promoted: false,
      cwd: '/home/pyry/second-brain',
      name: 'Saved as a channel',
      last_used_at: '2026-07-11T08:00:00Z',
      workspace_label: 'Second Brain'
    })
    // toEqual would pass with extra keys absent from the expectation only if they were undefined, so
    // the key set is asserted outright.
    expect(Object.keys(reseeded ?? {}).sort()).toEqual([
      'cwd',
      'id',
      'is_promoted',
      'last_used_at',
      'name',
      'workspace_label'
    ])
  })

  // One case per field, so no field can quietly fall out of the comparison OR out of the mapper.
  const CHANGED: ReadonlyArray<[string, Partial<ConversationSummary>]> = [
    ['name', { name: 'Renamed' }],
    ['name cleared to null', { name: null }],
    ['is_promoted', { is_promoted: false }],
    ['cwd', { cwd: '/home/pyry/elsewhere' }],
    ['last_used_at', { last_used_at: '2026-07-11T08:00:00Z' }],
    ['workspace_label', { workspace_label: 'Second Brain' }]
  ]

  for (const [label, change] of CHANGED) {
    it(`re-seeds when ONLY ${label} moved (AC2)`, () => {
      expect(reseededActiveConversation([row(change)], active())).toEqual({ ...active(), ...change })
    })
  }

  it('keeps the id of the conversation already open — a re-seed can never re-target it', () => {
    // The invariant that makes this path non-destructive: the Channel info sheet sends `id` back with
    // Archive and Delete, and the only row this function can map is one already carrying that id.
    const snapshot = active({ id: 'open-chat' })
    const reseeded = reseededActiveConversation(
      [row({ id: 'other' }), row({ id: 'open-chat', name: 'Renamed' })],
      snapshot
    )
    expect(reseeded?.id).toBe(snapshot.id)
  })

  it('writes nothing when every one of the six fields is equal (AC4)', () => {
    expect(reseededActiveConversation([row()], active())).toBeNull()
  })

  it('writes nothing when only a field OUTSIDE the payload moved (AC4)', () => {
    // `is_archived` and `last_message_ts` have no slot in the snapshot, so a reply that moves only
    // those is a routine refresh: re-seeding would re-render every subscriber for no visible change.
    expect(
      reseededActiveConversation(
        [row({ is_archived: true, last_message_ts: '2026-07-11T09:00:00Z' })],
        active()
      )
    ).toBeNull()
  })

  it('writes nothing when no row in the reply carries the open chat id (AC3)', () => {
    // A chat deleted elsewhere, and a reply from another paired server that simply does not list it.
    // Either way the snapshot is left exactly as it stands — this path never clears and never navigates.
    expect(reseededActiveConversation([row({ id: 'a' }), row({ id: 'b' })], active())).toBeNull()
  })

  it('writes nothing for an empty (loaded-zero) reply (AC3)', () => {
    expect(reseededActiveConversation([], active())).toBeNull()
  })

  it('leaves a null active conversation null (AC3)', () => {
    expect(reseededActiveConversation([row()], null)).toBeNull()
  })

  it('writes nothing when the event carried no rows at all', () => {
    expect(reseededActiveConversation(null, active())).toBeNull()
  })

  it('re-seeds from a matching row that is ARCHIVED — that transition has its own owner', () => {
    // conversationArchivedBridge owns the archived exit; an archived row re-seeds like any other, and
    // `selectArchivedCount` proves archived rows ride the same list.
    expect(
      reseededActiveConversation([row({ is_archived: true, name: 'Renamed' })], active())?.name
    ).toBe('Renamed')
  })

  it('REFUSES an ambiguous match — two rows sharing the open chat id write nothing', () => {
    // `serverIdForOpenConversation`'s shipped discipline: `filter` and a length check, never `find`.
    // The ids are the daemon's, so resolving to whichever row came first would let a confused or
    // hostile daemon pick which name the sheet shows. Refusing costs an honest daemon nothing.
    expect(
      reseededActiveConversation([row({ name: 'One' }), row({ name: 'Two' })], active())
    ).toBeNull()
  })
})

describe('subscribeActiveConversationReseed', () => {
  // A fake onDaemonEvent that captures the listener and hands back an off spy (the
  // conversationListBridge.test.ts idiom).
  function fakeBridge(): {
    onDaemonEvent: (l: (e: DaemonEvent) => void) => () => void
    emit: (e: DaemonEvent) => void
    off: ReturnType<typeof vi.fn>
    subscribeCalls: () => number
  } {
    let listener: ((e: DaemonEvent) => void) | undefined
    const off = vi.fn()
    const onDaemonEvent = vi.fn((l: (e: DaemonEvent) => void) => {
      listener = l
      return off
    })
    return {
      onDaemonEvent,
      emit: (e) => listener?.(e),
      off,
      subscribeCalls: () => onDaemonEvent.mock.calls.length
    }
  }

  it('subscribes exactly once', () => {
    const bridge = fakeBridge()
    subscribeActiveConversationReseed(bridge.onDaemonEvent, () => active(), vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeActiveConversationReseed(bridge.onDaemonEvent, () => null, vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('re-seeds the snapshot from a list reply carrying the renamed row (AC1)', () => {
    const bridge = fakeBridge()
    const setActiveConversation = vi.fn()
    subscribeActiveConversationReseed(bridge.onDaemonEvent, () => active(), setActiveConversation)

    bridge.emit({
      type: 'conversationsReceived',
      conversations: [row({ id: 'other' }), row({ name: 'Renamed by the daemon' })]
    })

    expect(setActiveConversation).toHaveBeenCalledTimes(1)
    // Called WITH the mapped payload, never bare: the getter is assignable to the setter's slot (a
    // zero-arg function fits a one-arg type), so this argument assertion is what catches a swap.
    expect(setActiveConversation).toHaveBeenCalledWith({
      ...active(),
      name: 'Renamed by the daemon'
    })
  })

  it('does NOT write on an unchanged refresh (AC4 at the seam)', () => {
    const bridge = fakeBridge()
    const setActiveConversation = vi.fn()
    subscribeActiveConversationReseed(bridge.onDaemonEvent, () => active(), setActiveConversation)

    bridge.emit({ type: 'conversationsReceived', conversations: [row()] })
    expect(setActiveConversation).not.toHaveBeenCalled()
  })

  it('does NOT write when the reply omits the open chat (AC3)', () => {
    const bridge = fakeBridge()
    const setActiveConversation = vi.fn()
    subscribeActiveConversationReseed(bridge.onDaemonEvent, () => active(), setActiveConversation)

    bridge.emit({ type: 'conversationsReceived', conversations: [row({ id: 'somewhere-else' })] })
    expect(setActiveConversation).not.toHaveBeenCalled()
  })

  it('ignores every event that is not a list reply', () => {
    const bridge = fakeBridge()
    const getActiveConversation = vi.fn(() => active({ name: null }))
    const setActiveConversation = vi.fn()
    subscribeActiveConversationReseed(
      bridge.onDaemonEvent,
      getActiveConversation,
      setActiveConversation
    )

    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'disconnected' },
      {
        type: 'conversationUpdated',
        conversation: {
          id: 'c1',
          is_promoted: true,
          name: 'Renamed by the daemon',
          cwd: '/home/pyry/project',
          last_used_at: '2026-07-10T12:05:00Z',
          workspace_label: null
        }
      }
    ]
    for (const event of others) bridge.emit(event)

    expect(setActiveConversation).not.toHaveBeenCalled()
    // The conversationUpdated arm is the sharp one: its payload has every field the snapshot holds, so
    // patching from it is one line away — and it would put daemon text on screen BYPASSING the list
    // decode path this bridge is built on. The snapshot moves only on the authoritative reply.
    expect(getActiveConversation).not.toHaveBeenCalled()
  })

  it('reads the snapshot through the getter on EVERY delivery, never captured once', () => {
    const bridge = fakeBridge()
    const setActiveConversation = vi.fn()
    // The open chat changes between the two replies (the operator clicked another row). A getter read
    // once at subscribe time would reconcile the second reply against the chat that is no longer open.
    let open: ConversationCreatedPayload | null = active({ id: 'first' })
    subscribeActiveConversationReseed(
      bridge.onDaemonEvent,
      () => open,
      setActiveConversation
    )

    bridge.emit({
      type: 'conversationsReceived',
      conversations: [row({ id: 'first', name: 'First renamed' })]
    })
    open = active({ id: 'second' })
    bridge.emit({
      type: 'conversationsReceived',
      conversations: [row({ id: 'second', name: 'Second renamed' })]
    })

    expect(setActiveConversation).toHaveBeenCalledTimes(2)
    expect(setActiveConversation.mock.calls.map((call) => call[0].id)).toEqual(['first', 'second'])
  })
})
