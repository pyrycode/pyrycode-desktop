import { describe, it, expect, vi } from 'vitest'
import { exitActiveConversation, type ExitActiveConversationDeps } from './exitActiveConversation'
import { createSessionIdStore } from './store/sessionIdStore'
import { createActiveConversationStore } from './store/activeConversationStore'
import { createRunConfigStore } from './store/runConfigStore'
import { createRunSettingsWriteStore } from './store/runSettingsWriteStore'
import type { ConversationCreatedPayload } from '@shared/wire/types'

const conversation = (id: string): ConversationCreatedPayload => ({
  id,
  is_promoted: false,
  cwd: '/home/pyry/work',
  name: null,
  last_used_at: '2026-08-20T09:00:00Z',
  workspace_label: null
})

function spyDeps(active: ConversationCreatedPayload | null): {
  deps: ExitActiveConversationDeps
  clearActiveConversation: ReturnType<typeof vi.fn>
  clearSessionId: ReturnType<typeof vi.fn>
  clearRunConfig: ReturnType<typeof vi.fn>
  navigateToList: ReturnType<typeof vi.fn>
} {
  const clearActiveConversation = vi.fn()
  const clearSessionId = vi.fn()
  const clearRunConfig = vi.fn()
  const navigateToList = vi.fn()
  return {
    deps: {
      getActiveConversation: () => active,
      clearActiveConversation,
      clearSessionId,
      clearRunConfig,
      navigateToList
    },
    clearActiveConversation,
    clearSessionId,
    clearRunConfig,
    navigateToList
  }
}

describe('exitActiveConversation', () => {
  it('the open conversation clears the thread state and returns to the list (AC1, AC2, AC3)', () => {
    const {
      deps,
      clearActiveConversation,
      clearSessionId,
      navigateToList
    } = spyDeps(conversation('a'))

    exitActiveConversation(deps, 'a')

    expect(clearActiveConversation).toHaveBeenCalledTimes(1)
    expect(clearSessionId).toHaveBeenCalledTimes(1)
    expect(navigateToList).toHaveBeenCalledTimes(1)
  })

  it('clears before navigating — no observer sees the list against the deleted thread state', () => {
    const order: string[] = []
    const deps: ExitActiveConversationDeps = {
      getActiveConversation: () => conversation('a'),
      clearActiveConversation: () => void order.push('clearActiveConversation'),
      clearSessionId: () => void order.push('clearSessionId'),
      clearRunConfig: () => void order.push('clearRunConfig'),
      navigateToList: () => void order.push('navigateToList')
    }

    exitActiveConversation(deps, 'a')

    expect(order).toEqual([
      'clearActiveConversation',
      'clearSessionId',
      'clearRunConfig',
      'navigateToList'
    ])
  })

  it('the open conversation being deleted or archived drops its run configuration (#1167 AC1)', () => {
    const { deps, clearRunConfig } = spyDeps(conversation('a'))

    exitActiveConversation(deps, 'a')

    expect(clearRunConfig).toHaveBeenCalledTimes(1)
  })

  it('real stores: the exit drops the snapshot AND the confirmed overrides (#1167 AC1)', () => {
    const runConfig = createRunConfigStore({
      snapshot: {
        model: 'opus',
        effort: 'deep',
        yolo: true,
        permissionMode: 'plan',
        usedTokens: 140000,
        windowTokens: 200000
      }
    })
    const write = createRunSettingsWriteStore({
      pending: new Map([['c1', { field: 'model', value: 'haiku' }]]),
      confirmed: { effort: 'brisk' },
      error: 'yolo'
    })

    exitActiveConversation(
      realDeps(
        createSessionIdStore({ sessionId: 's1' }),
        createActiveConversationStore({ activeConversation: conversation('a') }),
        () => {},
        runConfig,
        write
      ),
      'a'
    )

    expect(runConfig.getState().snapshot).toBeNull()
    expect(write.getState().pending.size).toBe(0)
    expect(write.getState().confirmed).toEqual({})
    expect(write.getState().error).toBeNull()
  })

  it('real stores: a confirmation naming a DIFFERENT conversation leaves the run configuration alone (#1167 AC1 gate)', () => {
    const snapshot = {
      model: 'opus',
      effort: 'deep',
      yolo: true,
      permissionMode: 'plan',
      usedTokens: 140000,
      windowTokens: 200000
    }
    const runConfig = createRunConfigStore({ snapshot })
    const write = createRunSettingsWriteStore({
      pending: new Map(),
      confirmed: { effort: 'brisk' },
      error: null
    })
    const before = write.getState()

    exitActiveConversation(
      realDeps(
        createSessionIdStore({ sessionId: 's1' }),
        createActiveConversationStore({ activeConversation: conversation('a') }),
        () => {},
        runConfig,
        write
      ),
      'b'
    )

    expect(runConfig.getState().snapshot).toBe(snapshot)
    expect(write.getState()).toBe(before)
  })

  it('a confirmation naming a DIFFERENT conversation changes nothing (AC4)', () => {
    const {
      deps,
      clearActiveConversation,
      clearSessionId,
      clearRunConfig,
      navigateToList
    } = spyDeps(conversation('a'))

    exitActiveConversation(deps, 'b')

    expect(clearRunConfig).not.toHaveBeenCalled()
    expect(clearActiveConversation).not.toHaveBeenCalled()
    expect(clearSessionId).not.toHaveBeenCalled()
    expect(navigateToList).not.toHaveBeenCalled()
  })

  it('no active conversation changes nothing — the degenerate mismatch arm (AC4)', () => {
    const {
      deps,
      clearActiveConversation,
      clearSessionId,
      navigateToList
    } = spyDeps(null)

    exitActiveConversation(deps, 'a')

    expect(clearActiveConversation).not.toHaveBeenCalled()
    expect(clearSessionId).not.toHaveBeenCalled()
    expect(navigateToList).not.toHaveBeenCalled()
  })

  it('real stores: the exit drops the session and active conversation', () => {
    const sessionId = createSessionIdStore({ sessionId: 's1' })
    const active = createActiveConversationStore({ activeConversation: conversation('a') })
    const navigateToList = vi.fn()

    exitActiveConversation(realDeps(sessionId, active, navigateToList), 'a')
    expect(sessionId.getState().sessionId).toBeNull()
    expect(active.getState().activeConversation).toBeNull()
    expect(navigateToList).toHaveBeenCalledTimes(1)
  })

  it('real stores: a mismatched id leaves the live thread and its session id intact (AC4)', () => {
    const sessionId = createSessionIdStore({ sessionId: 's1' })
    const active = createActiveConversationStore({ activeConversation: conversation('a') })
    const navigateToList = vi.fn()

    exitActiveConversation(realDeps(sessionId, active, navigateToList), 'b')
    expect(sessionId.getState().sessionId).toBe('s1')
    expect(active.getState().activeConversation).toEqual(conversation('a'))
    expect(navigateToList).not.toHaveBeenCalled()
  })

  it('real stores: a duplicate delivery of the same id navigates nothing — idempotent by the gate', () => {
    const sessionId = createSessionIdStore({ sessionId: 's1' })
    const active = createActiveConversationStore({ activeConversation: conversation('a') })
    const navigateToList = vi.fn()
    const deps = realDeps(sessionId, active, navigateToList)

    exitActiveConversation(deps, 'a')
    exitActiveConversation(deps, 'a')
    expect(navigateToList).toHaveBeenCalledTimes(1)
  })
})

function realDeps(
  sessionId: ReturnType<typeof createSessionIdStore>,
  active: ReturnType<typeof createActiveConversationStore>,
  navigateToList: () => void,
  runConfig: ReturnType<typeof createRunConfigStore> = createRunConfigStore(),
  runSettingsWrite: ReturnType<typeof createRunSettingsWriteStore> = createRunSettingsWriteStore()
): ExitActiveConversationDeps {
  return {
    getActiveConversation: () => active.getState().activeConversation,
    clearActiveConversation: () => active.getState().clearActiveConversation(),
    clearSessionId: () => sessionId.getState().clearSessionId(),
    clearRunConfig: () => {
      runConfig.getState().clearSnapshot()
      runSettingsWrite.getState().dispatch({ type: 'conversationSwitched' })
    },
    navigateToList
  }
}
