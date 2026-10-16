import { describe, it, expect, vi } from 'vitest'
import { activateConversation, type ActivateConversationDeps } from './activateConversation'
import { createTimelineStore } from './store/timelineStore'
import { createSessionIdStore } from './store/sessionIdStore'
import { createActiveConversationStore } from './store/activeConversationStore'
import {
  createConversationTimelineStore,
  selectTimelineFor
} from './store/conversationTimelineStore'
import {
  createConversationLastReadStore
} from './store/conversationLastReadStore'
import { createRunConfigStore } from './store/runConfigStore'
import { createRunSettingsWriteStore } from './store/runSettingsWriteStore'
import { initialTimelineState, type ThreadItem } from './store/threadTimeline'
import type { ConversationCreatedPayload, ConversationSummary } from '@shared/wire/types'

const conversation = (id: string): ConversationCreatedPayload => ({
  id,
  is_promoted: false,
  cwd: '/home/pyry/work',
  name: null,
  last_used_at: '2026-07-30T09:00:00Z',
  workspace_label: null
})

const seededItems: readonly ThreadItem[] = [{ kind: 'userText', text: 'a message from A' }]

function spyDeps(previous: ConversationCreatedPayload | null): {
  deps: ActivateConversationDeps
  clearSessionId: ReturnType<typeof vi.fn>
  clearRunConfig: ReturnType<typeof vi.fn>
  setActiveConversation: ReturnType<typeof vi.fn>
  requestConversationConfig: ReturnType<typeof vi.fn>
} {
  const clearSessionId = vi.fn()
  const setActiveConversation = vi.fn()
  const requestConversationConfig = vi.fn()
  const clearRunConfig = vi.fn()
  return {
    deps: {
      getActiveConversation: () => previous,
      setActiveConversation,
      clearSessionId,
      clearRunConfig,
      requestConversationConfig
    },
    clearSessionId,
    clearRunConfig,
    setActiveConversation,
    requestConversationConfig
  }
}

describe('activateConversation', () => {
  it('a different id clears the session id, then records the new conversation (AC1)', () => {
    const next = conversation('b')
    const { deps, clearSessionId, setActiveConversation } = spyDeps(conversation('a'))

    activateConversation(deps, next)

    expect(clearSessionId).toHaveBeenCalledTimes(1)
    expect(setActiveConversation).toHaveBeenCalledTimes(1)
    expect(setActiveConversation).toHaveBeenCalledWith(next)
  })

  it('a different id clears the run configuration too (#1167 AC1)', () => {
    const { deps, clearRunConfig } = spyDeps(conversation('a'))

    activateConversation(deps, conversation('b'))

    expect(clearRunConfig).toHaveBeenCalledTimes(1)
  })

  it('re-opening the same conversation clears NONE of the run configuration (#1167 AC2)', () => {
    const { deps, clearRunConfig, requestConversationConfig } = spyDeps(conversation('a'))

    activateConversation(deps, conversation('a'))

    expect(clearRunConfig).not.toHaveBeenCalled()
    expect(requestConversationConfig).toHaveBeenCalledTimes(1)
  })

  it('no previous conversation takes the clear branch — a newly created discussion clears its session (AC2)', () => {
    const next = conversation('b')
    const { deps, clearSessionId, setActiveConversation } = spyDeps(null)

    activateConversation(deps, next)

    expect(clearSessionId).toHaveBeenCalledTimes(1)
    expect(setActiveConversation).toHaveBeenCalledWith(next)
  })

  it('the same id clears nothing but still records the fresher payload (AC3)', () => {
    const next = conversation('a')
    const { deps, clearSessionId, setActiveConversation } = spyDeps(conversation('a'))

    activateConversation(deps, next)

    expect(clearSessionId).not.toHaveBeenCalled()
    expect(setActiveConversation).toHaveBeenCalledTimes(1)
    expect(setActiveConversation).toHaveBeenCalledWith(next)
  })

  it('every activation asks the daemon for that conversation, switch or re-open (#1166 AC1)', () => {
    const switched = spyDeps(conversation('a'))
    activateConversation(switched.deps, conversation('b'))
    expect(switched.requestConversationConfig).toHaveBeenCalledTimes(1)
    expect(switched.requestConversationConfig).toHaveBeenCalledWith('b')

    const reopened = spyDeps(conversation('a'))
    activateConversation(reopened.deps, conversation('a'))
    expect(reopened.requestConversationConfig).toHaveBeenCalledTimes(1)
    expect(reopened.requestConversationConfig).toHaveBeenCalledWith('a')

    const first = spyDeps(null)
    activateConversation(first.deps, conversation('b'))
    expect(first.requestConversationConfig).toHaveBeenCalledTimes(1)
    expect(first.requestConversationConfig).toHaveBeenCalledWith('b')
  })

  it('compares against the PREVIOUS active conversation — both clears run before the set', () => {
    const active = createActiveConversationStore({ activeConversation: conversation('a') })
    const order: string[] = []
    const deps: ActivateConversationDeps = {
      getActiveConversation: () => active.getState().activeConversation,
      setActiveConversation: (c) => {
        order.push('set')
        active.getState().setActiveConversation(c)
      },
      clearSessionId: () => void order.push('clearSessionId'),
      clearRunConfig: () => void order.push('clearRunConfig'),
      requestConversationConfig: () => void order.push('requestConfig')
    }

    activateConversation(deps, conversation('b'))

    expect(order).toEqual([
      'clearSessionId',
      'clearRunConfig',
      'set',
      'requestConfig'
    ])
    expect(active.getState().activeConversation?.id).toBe('b')
  })

  it('real stores: a switch drops the previous chat’s snapshot AND its confirmed overrides (#1167 AC1)', () => {
    const timeline = createTimelineStore(initialTimelineState)
    const sessionId = createSessionIdStore({ sessionId: 's1' })
    const active = createActiveConversationStore({ activeConversation: conversation('a') })
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

    activateConversation(
      realDeps(
        sessionId,
        active,
        runConfig,
        write
      ),
      conversation('b')
    )

    expect(runConfig.getState().snapshot).toBeNull()
    expect(write.getState().pending.size).toBe(0)
    expect(write.getState().confirmed).toEqual({})
    expect(write.getState().error).toBeNull()
  })

  it('real stores: re-opening the ACTIVE conversation keeps its run configuration (#1167 AC2)', () => {
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

    activateConversation(
      realDeps(
        createSessionIdStore({ sessionId: 's1' }),
        createActiveConversationStore({ activeConversation: conversation('a') }),
        runConfig,
        write
      ),
      conversation('a')
    )
    expect(runConfig.getState().snapshot).toBe(snapshot)
    expect(write.getState()).toBe(before)
  })

  it('real stores: a switch preserves the legacy timeline and drops the daemon session id', () => {
    const timeline = createTimelineStore({ ...initialTimelineState, items: seededItems })
    const sessionId = createSessionIdStore({ sessionId: 's1' })
    const active = createActiveConversationStore({ activeConversation: conversation('a') })
    const next = conversation('b')

    activateConversation(realDeps(sessionId, active), next)

    expect(timeline.getState().items).toBe(seededItems)
    expect(sessionId.getState().sessionId).toBeNull()
    expect(active.getState().activeConversation).toEqual(next)
  })

  it('real stores: re-opening the active conversation keeps its rows and its session id (AC3, AC4)', () => {
    const timeline = createTimelineStore({ ...initialTimelineState, items: seededItems })
    const sessionId = createSessionIdStore({ sessionId: 's1' })
    const active = createActiveConversationStore({ activeConversation: conversation('a') })

    activateConversation(realDeps(sessionId, active), conversation('a'))
    expect(timeline.getState().items).toBe(seededItems)
    expect(sessionId.getState().sessionId).toBe('s1')
  })

  it('accepts a ConversationSummary and records it verbatim (the structural-superset seam)', () => {
    const summary: ConversationSummary = {
      id: 'b',
      name: 'Channel B',
      is_promoted: true,
      is_archived: false,
      cwd: '/home/pyry/work',
      last_message_ts: '2026-07-30T09:05:00Z',
      last_used_at: '2026-07-30T09:00:00Z',
      workspace_label: null
    }
    const active = createActiveConversationStore({ activeConversation: conversation('a') })
    const timeline = createTimelineStore()
    const sessionId = createSessionIdStore()

    activateConversation(realDeps(sessionId, active), summary)

    expect(active.getState().activeConversation).toEqual(summary)
  })

  it.each([null, 'a', 'b'])('activation from %s neither creates legacy slices nor stamps local read marks', previous => {
    const timelines = createConversationTimelineStore()
    timelines.getState().dispatchFor('a', { type: 'userText', text: 'retained' })
    const write = vi.fn()
    const lastRead = createConversationLastReadStore({ read: () => new Map([['a', 7]]), write })
    const before = timelines.getState()
    const marks = lastRead.getState()
    const deps = realDeps(createSessionIdStore(),
      createActiveConversationStore({ activeConversation: previous === null ? null : conversation(previous) }))

    activateConversation(deps, conversation('b'))
    activateConversation(deps, conversation('b'))

    expect(timelines.getState()).toBe(before)
    expect(selectTimelineFor('b')(timelines.getState())).toBeNull()
    expect(lastRead.getState()).toBe(marks)
    expect(write).not.toHaveBeenCalled()
  })
})

function realDeps(
  sessionId: ReturnType<typeof createSessionIdStore>,
  active: ReturnType<typeof createActiveConversationStore>,
  runConfig: ReturnType<typeof createRunConfigStore> = createRunConfigStore(),
  runSettingsWrite: ReturnType<typeof createRunSettingsWriteStore> = createRunSettingsWriteStore()
): ActivateConversationDeps {
  return {
    getActiveConversation: () => active.getState().activeConversation,
    setActiveConversation: (c) => active.getState().setActiveConversation(c),
    clearSessionId: () => sessionId.getState().clearSessionId(),
    clearRunConfig: () => {
      runConfig.getState().clearSnapshot()
      runSettingsWrite.getState().dispatch({ type: 'conversationSwitched' })
    },
    requestConversationConfig: () => {}
  }
}
