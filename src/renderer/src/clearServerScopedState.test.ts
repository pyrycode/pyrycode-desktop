import { describe, it, expect, vi } from 'vitest'
import type { ConversationCreatedPayload } from '@shared/wire/types'
import {
  clearServerScopedState,
  type ClearServerScopedStateDeps
} from './clearServerScopedState'

const conversation = (id: string): ConversationCreatedPayload => ({
  id,
  is_promoted: true,
  cwd: '/home/pyry/project',
  name: 'Design review',
  last_used_at: '2026-09-07T09:00:00Z',
  workspace_label: null
})

/** All nine effects as spies, with the departed set and the open conversation as the two knobs. */
function deps(
  over: {
    departed?: readonly string[]
    open?: ConversationCreatedPayload | null
  } = {}
): ClearServerScopedStateDeps & { [K in keyof ClearServerScopedStateDeps]: ReturnType<typeof vi.fn> } {
  const departed = new Set(over.departed ?? [])
  return {
    getDepartedConversationIds: vi.fn(() => departed),
    clearConversationsFor: vi.fn(),
    getActiveConversation: vi.fn(() => over.open ?? null),
    clearActiveConversation: vi.fn(),
    clearSessionId: vi.fn(),
    clearRunConfig: vi.fn(),
    navigateToList: vi.fn()
  } as never
}

describe('clearServerScopedState', () => {
  it('reads the departed ids BEFORE dropping the list slot', () => {
    const d = deps({ departed: ['c1'] })
    clearServerScopedState(d, 'srv-a')
    expect(d.getDepartedConversationIds.mock.invocationCallOrder[0]).toBeLessThan(
      d.clearConversationsFor.mock.invocationCallOrder[0]
    )
  })

  it('drops the departed server’s list slot, and asks for exactly that server (AC1)', () => {
    const d = deps()
    clearServerScopedState(d, 'srv-a')
    expect(d.getDepartedConversationIds).toHaveBeenCalledWith('srv-a')
    expect(d.clearConversationsFor).toHaveBeenCalledTimes(1)
    expect(d.clearConversationsFor).toHaveBeenCalledWith('srv-a')
  })

  it('closes the open conversation and navigates when it belongs to the departed server (AC3)', () => {
    const d = deps({ departed: ['c1', 'c2'], open: conversation('c2') })
    clearServerScopedState(d, 'srv-a')
    expect(d.clearActiveConversation).toHaveBeenCalledTimes(1)
    expect(d.clearSessionId).toHaveBeenCalledTimes(1)
    expect(d.clearRunConfig).toHaveBeenCalledTimes(1)
    expect(d.navigateToList).toHaveBeenCalledTimes(1)
  })

  it('leaves an open conversation belonging to a STILL-PAIRED server open (AC3)', () => {
    const d = deps({ departed: ['c1'], open: conversation('survivor') })
    clearServerScopedState(d, 'srv-a')
    expect(d.clearActiveConversation).not.toHaveBeenCalled()
    expect(d.clearSessionId).not.toHaveBeenCalled()
    expect(d.clearRunConfig).not.toHaveBeenCalled()
    expect(d.navigateToList).not.toHaveBeenCalled()
  })

  it('exits at most once even when several conversations depart', () => {
    const d = deps({ departed: ['c1', 'c2', 'c3'], open: conversation('c1') })
    clearServerScopedState(d, 'srv-a')
    expect(d.clearActiveConversation).toHaveBeenCalledTimes(1)
    expect(d.navigateToList).toHaveBeenCalledTimes(1)
  })

  it('nothing open is a plain no-exit, not a special case', () => {
    const d = deps({ departed: ['c1'], open: null })
    clearServerScopedState(d, 'srv-a')
    expect(d.clearActiveConversation).not.toHaveBeenCalled()
    expect(d.navigateToList).not.toHaveBeenCalled()
  })

  it('a server holding no rows still drops its slot and touches nothing else', () => {
    const d = deps({ departed: [], open: conversation('survivor') })
    clearServerScopedState(d, 'srv-never-listed')
    expect(d.clearConversationsFor).toHaveBeenCalledTimes(1)
    expect(d.clearConversationsFor).toHaveBeenCalledWith('srv-never-listed')
    expect(d.clearActiveConversation).not.toHaveBeenCalled()
    expect(d.navigateToList).not.toHaveBeenCalled()
  })

  it('returns nothing and reports nothing — total, like both clear helpers beside it', () => {
    expect(clearServerScopedState(deps({ departed: ['c1'] }), 'srv-a')).toBeUndefined()
  })
})
