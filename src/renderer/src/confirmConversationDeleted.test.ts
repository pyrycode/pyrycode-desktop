import { describe, expect, it, vi } from 'vitest'
import type { DaemonEvent, StampedDaemonEvent } from '@shared/ipc/events'
import { confirmConversationDeleted, type ConfirmConversationDeletedDeps } from './confirmConversationDeleted'
import { subscribeConversationDeleted } from './store/conversationDeletedBridge'
import { createConversationTimelineStore, selectTimelineFor } from './store/conversationTimelineStore'
import { createActiveConversationStore } from './store/activeConversationStore'
import { createTimelineStore } from './store/timelineStore'
import { createSessionIdStore } from './store/sessionIdStore'
import { createRunConfigStore } from './store/runConfigStore'
import { createRunSettingsWriteStore } from './store/runSettingsWriteStore'
import { createSystemPromptStore } from './store/systemPromptStore'
import { createSystemPromptWriteStore } from './store/systemPromptWriteStore'

function harness(open: string | null = 'b') {
  const keyed = createConversationTimelineStore(undefined, () => 'h')
  for (const id of ['a', 'b', 'c']) keyed.getState().dispatchFor(id, { type: 'userText', text: id })
  const active = createActiveConversationStore()
  if (open !== null) active.getState().setActiveConversation({ id: open, name: null,
    is_promoted: false, cwd: '/fixture', last_used_at: '', workspace_label: null })
  const flat = createTimelineStore()
  flat.getState().dispatch({ type: 'userText', text: 'open thread' })
  const session = createSessionIdStore({ sessionId: 'session-b' })
  const config = createRunConfigStore({ snapshot: { model: 'model-b', effort: 'high',
    yolo: false, permissionMode: 'default', usedTokens: 1, windowTokens: 100 } })
  const settings = createRunSettingsWriteStore({ pending: new Map([['change', { field: 'effort', value: 'low' }]]),
    confirmed: { model: 'confirmed-b' }, error: 'yolo' })
  const prompt = createSystemPromptStore({ reading: { systemPrompt: 'prompt-b', sessionPromptStatus: 'matches' } })
  const promptWrite = createSystemPromptWriteStore({ writes: new Map([['b', { status: 'in-flight' }]]) })
  const nav = vi.fn()
  const log = vi.fn()
  const deps: ConfirmConversationDeletedDeps = {
    getTimelineServerId: id => { keyed.flushTimeline(); return keyed.getState().timelines.get(id)?.serverId },
    log,
    getActiveConversation: () => active.getState().activeConversation,
    clearActiveConversation: () => active.getState().clearActiveConversation(),
    clearSessionId: () => session.getState().clearSessionId(),
    clearRunConfig: () => {
      config.getState().clearSnapshot()
      settings.getState().dispatch({ type: 'conversationSwitched' })
      prompt.getState().clearReading()
      promptWrite.getState().dispatch({ type: 'conversationSwitched' })
    },
    navigateToList: nav
  }
  let listener: ((event: DaemonEvent) => void) | undefined
  const stop = subscribeConversationDeleted(cb => { listener = cb; return () => { listener = undefined } },
    (id, serverId) => confirmConversationDeleted(deps, id, serverId))
  const others = [active, flat, session, config, settings, prompt, promptWrite]
  const before = others.map(store => store.getState())
  const unchanged = () => others.forEach((store, i) => expect(store.getState()).toBe(before[i]))
  return { keyed, active, flat, session, config, settings, prompt, promptWrite, nav, log, deps, stop,
    emit: (event: DaemonEvent | StampedDaemonEvent) => listener?.(event), unchanged }
}

describe('confirmed conversation deletion', () => {
  it('owned inactive deletion preserves legacy slices and active state', () => {
    const h = harness()
    const before = h.keyed.getState().timelines
    h.emit({ type: 'conversationDeleted', id: 'a', serverId: 'h' })
    expect(h.keyed.getState().timelines).toBe(before)
    for (const id of ['b', 'c']) expect(h.keyed.getState().timelines.get(id)).toBe(before.get(id))
    h.unchanged()
    expect(h.nav).not.toHaveBeenCalled()
    expect(h.log).not.toHaveBeenCalled()
  })

  it('preserves legacy slices with no active conversation', () => {
    const h = harness(null)
    h.emit({ type: 'conversationDeleted', id: 'a', serverId: 'h' })
    expect(selectTimelineFor('a')(h.keyed.getState())).not.toBeNull()
    h.unchanged()
    expect(h.nav).not.toHaveBeenCalled()
  })

  it.each(['a', 'b'])('refuses unowned confirmations with %s active', open => {
    const h = harness(open)
    for (const serverId of [undefined, null, 'other']) {
      const before = h.keyed.getState()
      h.emit({ type: 'conversationDeleted', id: 'a', serverId })
      expect(h.keyed.getState()).toBe(before)
      h.unchanged()
    }
    const slice = h.keyed.getState().timelines.get('a')!
    h.keyed.setState({ timelines: new Map(h.keyed.getState().timelines).set('a', { ...slice, serverId: undefined }) })
    const before = h.keyed.getState()
    h.emit({ type: 'conversationDeleted', id: 'a', serverId: 'h' })
    expect(h.keyed.getState()).toBe(before)
    h.unchanged()
    expect(h.nav).not.toHaveBeenCalled()
    expect(h.log.mock.calls.every(([record]) => Object.keys(record).sort().join() === 'code,event')).toBe(true)
  })

  it('clears active state before navigating', () => {
    const h = harness('a')
    h.nav.mockImplementation(() => {
      expect(selectTimelineFor('a')(h.keyed.getState())).not.toBeNull()
      expect(h.active.getState().activeConversation).toBeNull()
      expect(h.flat.getState().items).toEqual([{ kind: 'userText', text: 'open thread' }])
      expect(h.session.getState().sessionId).toBeNull()
      expect(h.config.getState().snapshot).toBeNull()
      expect(h.settings.getState().pending.size).toBe(0)
      expect(h.settings.getState().confirmed).toEqual({})
      expect(h.settings.getState().error).toBeNull()
      expect(h.prompt.getState().reading).toBeNull()
      expect(h.promptWrite.getState().writes.size).toBe(0)
    })
    h.emit({ type: 'conversationDeleted', id: 'a', serverId: 'h' })
    expect(h.nav).toHaveBeenCalledTimes(1)
    h.emit({ type: 'conversationDeleted', id: 'a', serverId: 'h' })
    expect(h.nav).toHaveBeenCalledTimes(1)
  })

  it.each(['', '__proto__', 'constructor', 'absent'])('repeated confirmations use exact Map keys: %s', id => {
    const h = harness()
    if (id !== 'absent') h.keyed.getState().dispatchFor(id, { type: 'userText', text: 'owned' })
    const before = h.keyed.getState().timelines
    h.emit({ type: 'conversationDeleted', id, serverId: 'h' })
    expect(h.keyed.getState().timelines).toBe(before)
    for (const [key, slice] of before) {
      if (key !== id) expect(h.keyed.getState().timelines.get(key)).toBe(slice)
    }
    const cleared = h.keyed.getState()
    h.emit({ type: 'conversationDeleted', id, serverId: 'h' })
    expect(h.keyed.getState()).toBe(cleared)
    h.unchanged()
  })

  it('ignores events without confirmed deletion', () => {
    const h = harness()
    const before = h.keyed.getState()
    h.emit({ type: 'conversationsReceived', conversations: [] })
    h.emit({ type: 'conversationsReceived', conversations: [{ id: 'a', name: null,
      is_promoted: false, is_archived: true, cwd: '/fixture', last_used_at: '', last_message_ts: '',
      workspace_label: null }] })
    h.emit({ type: 'sessionSettingsRejected', changeId: 'rejected' })
    expect(h.keyed.getState()).toBe(before)
    expect(h.log).not.toHaveBeenCalled()
    h.unchanged()
  })

  it('unsubscribe stops invalidation', () => {
    const h = harness()
    h.stop()
    h.emit({ type: 'conversationDeleted', id: 'a', serverId: 'h' })
    expect(selectTimelineFor('a')(h.keyed.getState())).not.toBeNull()
    expect(h.log).not.toHaveBeenCalled()
  })

})
