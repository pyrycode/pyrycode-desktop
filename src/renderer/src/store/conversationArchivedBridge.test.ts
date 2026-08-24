import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import type {
  ConversationCreatedPayload,
  ConversationSummary,
  ConversationUpdatedPayload
} from '@shared/wire/types'
import {
  archivedActiveConversationId,
  subscribeArchivedActiveConversation
} from './conversationArchivedBridge'

// Framework-free data-path tests with injected spies (the conversationDeletedBridge idiom): no React, no
// Electron. The React glue (useArchivedActiveConversationExit) is proven by composition in PairedShell — its
// server-render safety by PairedShell.test.tsx, its back→list link by pairedRoute.test.ts, and the decision
// it drives by exitActiveConversation.test.ts. That is the posture PairedShell.test.tsx:7-11 states: "the
// click-driven open→thread→back transition is guaranteed by composing the separately-tested nextPairedRoute
// with PairedShellView — exactly as App.test.tsx leaves the onPaired→setRoute glue to composition."
//
// exitActiveConversation is NOT re-tested here: #653 ships it unchanged and exitActiveConversation.test.ts
// already covers the clears, their ordering and the id gate.

const ACTIVE_ID = 'conv-open'

function row(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: ACTIVE_ID,
    name: 'Open discussion',
    is_promoted: false,
    is_archived: false,
    cwd: '/home/pyry/project',
    last_message_ts: '2026-08-21T12:00:00Z',
    last_used_at: '2026-08-21T12:00:00Z',
    ...overrides
  }
}

const created: ConversationCreatedPayload = {
  id: 'conv-new',
  is_promoted: false,
  cwd: '/home/pyry/project',
  name: null,
  last_used_at: '2026-08-21T12:00:00Z'
}

const updated: ConversationUpdatedPayload = {
  id: ACTIVE_ID,
  is_promoted: false,
  name: 'Renamed discussion',
  cwd: '/home/pyry/project',
  last_used_at: '2026-08-21T12:00:00Z'
}

// A fake onDaemonEvent that captures the listener and hands back an off spy — the bridge-test idiom. The
// off spy also DROPS the listener (a detail the sibling fakes leave out), so "the off handle stops further
// delivery" is a real assertion rather than a check that a spy was called.
function fakeBridge(): {
  onDaemonEvent: (l: (e: DaemonEvent) => void) => () => void
  emit: (e: DaemonEvent) => void
  off: ReturnType<typeof vi.fn>
} {
  let listener: ((e: DaemonEvent) => void) | undefined
  const off = vi.fn(() => {
    listener = undefined
  })
  const onDaemonEvent = vi.fn((l: (e: DaemonEvent) => void) => {
    listener = l
    return off
  })
  return { onDaemonEvent, emit: (e) => listener?.(e), off }
}

describe('archivedActiveConversationId', () => {
  it('returns the active id when its row in the daemon list is archived', () => {
    const list = [row({ id: 'other' }), row({ is_archived: true })]
    expect(archivedActiveConversationId(list, ACTIVE_ID)).toBe(ACTIVE_ID)
  })

  it('returns null when the active row is NOT archived — the rename / change-workspace arm (AC3, AC4)', () => {
    const list = [row({ is_archived: false })]
    expect(archivedActiveConversationId(list, ACTIVE_ID)).toBeNull()
  })

  it('returns null when no row carries the active id — absent is a DELETE, owned by #652', () => {
    const list = [row({ id: 'other', is_archived: true })]
    expect(archivedActiveConversationId(list, ACTIVE_ID)).toBeNull()
  })

  it('returns null when the list is not yet loaded — not loaded is not archived', () => {
    expect(archivedActiveConversationId(null, ACTIVE_ID)).toBeNull()
  })

  it('returns null when no conversation is open, even with archived rows in the list', () => {
    const list = [row({ is_archived: true })]
    expect(archivedActiveConversationId(list, null)).toBeNull()
  })

  it('returns null when a DIFFERENT conversation is archived — the lookup is by id, not "any archived row"', () => {
    const list = [row({ id: 'other', is_archived: true }), row({ is_archived: false })]
    expect(archivedActiveConversationId(list, ACTIVE_ID)).toBeNull()
  })
})

describe('subscribeArchivedActiveConversation', () => {
  it('subscribes exactly once', () => {
    const bridge = fakeBridge()
    subscribeArchivedActiveConversation(bridge.onDaemonEvent, () => ACTIVE_ID, vi.fn())
    expect(bridge.onDaemonEvent).toHaveBeenCalledTimes(1)
  })

  it('invokes onArchived once, with the active id, when the refreshed list shows it archived (AC1)', () => {
    const bridge = fakeBridge()
    const onArchived = vi.fn()
    subscribeArchivedActiveConversation(bridge.onDaemonEvent, () => ACTIVE_ID, onArchived)

    bridge.emit({ type: 'conversationsReceived', conversations: [row({ is_archived: true })] })
    expect(onArchived).toHaveBeenCalledTimes(1)
    expect(onArchived).toHaveBeenCalledWith(ACTIVE_ID)
  })

  it('ignores a list whose active row is not archived — no exit (AC3, AC4)', () => {
    const bridge = fakeBridge()
    const onArchived = vi.fn()
    subscribeArchivedActiveConversation(bridge.onDaemonEvent, () => ACTIVE_ID, onArchived)

    bridge.emit({ type: 'conversationsReceived', conversations: [row({ is_archived: false })] })
    expect(onArchived).not.toHaveBeenCalled()
  })

  it('ignores a conversationUpdated — the OCCURRENCE of an update is not the signal (AC3, AC4)', () => {
    const bridge = fakeBridge()
    const onArchived = vi.fn()
    subscribeArchivedActiveConversation(bridge.onDaemonEvent, () => ACTIVE_ID, onArchived)

    bridge.emit({ type: 'conversationUpdated', conversation: updated })
    expect(onArchived).not.toHaveBeenCalled()
  })

  it('ignores unrelated daemon events — no exit, no navigation (AC5)', () => {
    const bridge = fakeBridge()
    const onArchived = vi.fn()
    subscribeArchivedActiveConversation(bridge.onDaemonEvent, () => ACTIVE_ID, onArchived)

    bridge.emit({ type: 'conversationCreated', conversation: created })
    bridge.emit({ type: 'conversationDeleted', id: ACTIVE_ID })
    bridge.emit({ type: 'turnState', state: 'thinking', conversationId: 'conv-1' })
    expect(onArchived).not.toHaveBeenCalled()
  })

  it('fires at most once across repeated archived arrivals — the exit clears the active id', () => {
    const bridge = fakeBridge()
    const onArchived = vi.fn()
    // The getter mirrors what the exit does: after the first delivery clearActiveConversation() has run,
    // so every later evaluation reads null and the predicate short-circuits.
    const ids = [ACTIVE_ID, null]
    subscribeArchivedActiveConversation(bridge.onDaemonEvent, () => ids.shift() ?? null, onArchived)

    const archived: DaemonEvent = {
      type: 'conversationsReceived',
      conversations: [row({ is_archived: true })]
    }
    bridge.emit(archived)
    bridge.emit(archived)
    expect(onArchived).toHaveBeenCalledTimes(1)
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const onArchived = vi.fn()
    const cleanup = subscribeArchivedActiveConversation(
      bridge.onDaemonEvent,
      () => ACTIVE_ID,
      onArchived
    )
    expect(bridge.off).not.toHaveBeenCalled()
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)

    bridge.emit({ type: 'conversationsReceived', conversations: [row({ is_archived: true })] })
    expect(onArchived).not.toHaveBeenCalled()
  })
})
