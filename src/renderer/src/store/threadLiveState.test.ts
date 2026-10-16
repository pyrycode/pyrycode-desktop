import { describe, expect, it, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import type { SessionStateFamily } from '@shared/wire/types'
import { createThreadLiveState, selectThreadReadings } from './threadLiveState'
import { threadLiveInputs } from '../screens/conversation/threadLiveInputs'

type Supplied = DaemonEvent & { serverId?: string | null }

const model = (session = 'A', host = 'one', conversationId = 'chat'): DaemonEvent & { serverId: string } => ({
  type: 'modelAnnounced', model: `model-${session}`, truncated: false, conversationId,
  serverId: host, envelopeSessionId: session
})
const permission = (session = 'A', host = 'one'): DaemonEvent & { serverId: string } => ({
  type: 'modalShown', conversationId: 'chat', modalId: 'permission', class: 'permission',
  title: 'Permission', prompt: 'Run tool?', options: [{ id: 'deny', label: 'Deny' }],
  defaultOptionId: 'deny', serverId: host, envelopeSessionId: session
})
const question = (session = 'A', host = 'one'): DaemonEvent & { serverId: string } => ({
  type: 'questionShown', conversationId: 'chat', questionBatchId: 'question',
  questions: [{ question: 'Choose?', header: 'Choice', options: [{ label: 'First', description: '' }], multi_select: false }],
  serverId: host, envelopeSessionId: session
})
function fixture(host = 'one') {
  const sendResponse = vi.fn(), log = { event: vi.fn() }
  const isConnected = vi.fn(() => true)
  const store = createThreadLiveState({ sendResponse, isConnected, log })
  const bind = (session: string | undefined, id = 'chat') => store.getState().dispatch({ type: 'summary',
    serverId: host, summary: { id, ...(session === undefined ? {} : { current_session_id: session }) } })
  const emit = (event: Supplied) => store.getState().dispatch({ type: 'daemon', event })
  const inputs = () => threadLiveInputs(store.getState())
  bind('A')
  return { store, sendResponse, isConnected, bind, emit, inputs }
}

describe('supplied thread live state', () => {
  it('replacement rejects delayed readings through existing view inputs', () => {
    const f = fixture()
    f.emit(model()); f.emit(permission()); f.emit(question())
    f.emit({ type: 'turnState', state: 'thinking', conversationId: 'chat', serverId: 'one', envelopeSessionId: 'A' })
    expect(f.inputs().status.phase).toBe('thinking')
    f.bind('B')
    expect(f.inputs().permissions).toEqual([])
    expect(f.inputs().questions).toEqual([])
    expect(f.inputs().announcedModel).toBeNull()
    expect(f.inputs().status.phase).toBe('idle')
    f.emit(model('B')); f.emit(permission('B')); f.emit(question('B'))
    f.emit({ type: 'turnState', state: 'responding', conversationId: 'chat', serverId: 'one', envelopeSessionId: 'B' })
    const before = f.store.getState()
    f.emit(model()); f.emit(permission()); f.emit(question())
    f.emit({ type: 'turnState', state: 'thinking', conversationId: 'chat', serverId: 'one', envelopeSessionId: 'A' })
    f.emit({ type: 'modalDismissed', modalId: 'permission', outcome: 'deny', source: 'remote', serverId: 'one', envelopeSessionId: 'A' })
    f.emit({ type: 'questionDismissed', questionBatchId: 'question', outcome: 'unanswered', source: 'no_answer', serverId: 'one', envelopeSessionId: 'A' })
    f.emit({ type: 'runConfigReceived', conversationId: 'chat', sessionId: 'A', model: 'old', effort: 'high', yolo: false,
      permissionMode: 'default', used_tokens: 90, window_tokens: 100, serverId: 'one', envelopeSessionId: 'A', inReplyTo: 7 })
    f.emit({ type: 'sessionTransition', newSessionId: 'A', conversationId: 'chat', reason: 'clear', workspaceCwd: null, occurredAt: '' })
    expect(f.store.getState()).toBe(before)
    expect(f.inputs().sessionId).toBe('B')
    expect(f.inputs().announcedModel?.model).toBe('model-B')
    expect(f.inputs().status.phase).toBe('responding')
    expect(f.inputs().permissions[0].modalId).toBe('permission')
    expect(f.inputs().questions[0].questionBatchId).toBe('question')
    expect(f.sendResponse).not.toHaveBeenCalled()
  })

  it.each(['', undefined])('invalidates unavailable bindings and scope loss: %s', session => {
    const f = fixture()
    f.emit(model()); f.emit(permission())
    f.bind(session)
    f.emit(model())
    expect(f.inputs().announcedModel).toBeNull()
    expect(f.inputs().permissions).toEqual([])
    expect(f.inputs().sessionId).toBe(session ?? null)
    f.bind('A'); expect(f.inputs().announcedModel).toBeNull()
    f.emit(model()); f.bind('A')
    expect(f.inputs().announcedModel?.model).toBe('model-A')
    f.store.getState().dispatch({ type: 'summary', serverId: 'one', summary: null })
    f.emit(model()); f.bind('A')
    expect(f.inputs().announcedModel).toBeNull()
    expect(f.sendResponse).not.toHaveBeenCalled()
  })

  it('requires positive ownership and envelope provenance', () => {
    const f = fixture()
    const valid = model()
    for (const envelopeSessionId of [undefined, null, '', 'B']) {
      f.emit({ ...valid, envelopeSessionId })
      expect(f.inputs().announcedModel).toBeNull()
    }
    f.emit(model('A', 'two')); f.emit(model('A', 'one', 'other'))
    const { serverId: _host, ...unstamped } = valid
    f.emit(unstamped)
    f.emit({ type: 'sessionSettingsUpdated', sessionId: 'A', changeId: 'change', serverId: 'one', envelopeSessionId: 'A' })
    expect(f.store.getState().readings.size).toBe(0)
    f.emit(valid)
    expect(f.inputs().announcedModel?.model).toBe('model-A')
  })

  it('clears only the attributable canonical family', () => {
    const f = fixture()
    f.emit(model()); f.emit(permission()); f.emit(question())
    const clear = (family: SessionStateFamily, inReplyTo?: number): Supplied => ({
      type: 'sessionStateCleared', family, serverId: 'one', envelopeSessionId: 'A',
      ...(inReplyTo === undefined ? {} : { inReplyTo }), correlation: { id: 99, ts: '' }
    })
    f.emit(clear('modal_shown'))
    expect(f.inputs().permissions).toHaveLength(1)
    f.store.getState().dispatch({ type: 'request', serverId: 'one', conversationId: 'chat', requestId: 7 })
    f.emit({ ...clear('modal_shown', 7), envelopeSessionId: null })
    expect(f.inputs().permissions).toHaveLength(1)
    f.emit(clear('modal_shown', 7))
    expect(f.inputs().permissions).toEqual([])
    expect(f.inputs().questions).toHaveLength(1)
    expect(f.inputs().announcedModel?.model).toBe('model-A')
    f.emit(clear('question_shown', 7)); expect(f.inputs().questions).toEqual([])
    expect(f.sendResponse).not.toHaveBeenCalled()
  })

  it('reconciles retry compaction and prompts independently of items', () => {
    const f = fixture()
    const retry: Supplied = { type: 'apiRetry', conversationId: 'chat', active: true, current: 2, total: 5,
      serverId: 'one', envelopeSessionId: 'A' }
    const compact: Supplied = { type: 'compacting', conversationId: 'chat', active: true, serverId: 'one', envelopeSessionId: 'A' }
    f.emit(retry); f.emit(compact)
    expect(f.inputs().status.apiRetry).toEqual({ current: 2, total: 5 })
    f.emit({ ...retry, active: false }); f.emit({ ...compact, active: false })
    expect(f.inputs().status.apiRetry).toBeNull(); expect(f.inputs().status.compacting).toBe(false)
    f.emit(permission()); f.emit(question())
    f.emit({ type: 'connected', serverId: 'one', ack: {} as Extract<DaemonEvent, { type: 'connected' }>['ack'] })
    expect(f.inputs().permissions).toEqual([]); expect(f.inputs().questions).toEqual([])
    f.emit(permission()); f.emit(question())
    f.bind('B'); f.emit(permission('B')); f.emit(question('B'))
    expect(f.inputs().permissions).toHaveLength(1); expect(f.inputs().questions).toHaveLength(1)
    f.emit({ type: 'threadUpdate', conversationId: 'chat', update: { type: 'thread_item', payload: {} }, correlation: { id: 1, ts: '' } } as unknown as DaemonEvent)
    expect(f.inputs().permissions).toHaveLength(1)
  })

  it('routes responses to the retained owning host and rejects stale handles', () => {
    const a = fixture(), b = fixture('two')
    const p = permission(), q = question(), otherP = permission('A', 'two'), otherQ = question('A', 'two')
    a.emit(p); a.emit(q); b.emit(otherP); b.emit(otherQ)
    const answer = { type: 'answerModal' as const, payload: { modal_id: 'permission', option_id: 'deny' } }
    expect(a.store.getState().respond(otherP, answer)).toBe(false)
    expect(a.store.getState().respond(p, answer)).toBe(true)
    expect(a.sendResponse).toHaveBeenCalledWith('one', answer)
    const answers = { type: 'answerQuestions' as const, payload: { question_batch_id: 'question', answers: [{ question_index: 0, values: ['First'] }] } }
    expect(b.store.getState().respond(otherQ, answers)).toBe(true)
    expect(b.sendResponse).toHaveBeenCalledWith('two', answers)
    expect(a.store.getState().respond(p, answer)).toBe(false)
    a.bind('B'); a.emit(permission('B'))
    expect(a.store.getState().respond(p, answer)).toBe(false)
    expect(b.inputs().permissions).toHaveLength(1)
    b.emit({ type: 'modalDismissed', modalId: 'permission', outcome: 'deny', source: 'remote', serverId: 'one', envelopeSessionId: 'A' })
    expect(b.inputs().permissions).toHaveLength(1)
  })

  it('retains independent identities and releases ownership', () => {
    const f = fixture()
    for (const toolUseId of ['first', 'second']) f.emit({ type: 'toolProgress', conversationId: 'chat', turnId: 'turn', toolUseId,
      elapsedSeconds: 9, serverId: 'one', envelopeSessionId: 'A' })
    expect(selectThreadReadings(f.store.getState(), 'toolProgress')).toHaveLength(2)
    f.store.getState().dispatch({ type: 'request', serverId: 'one', conversationId: 'chat', requestId: 7 })
    f.emit({ type: 'sessionSettingsUpdated', sessionId: 'untrusted', changeId: 'change', inReplyTo: 7, serverId: 'one', envelopeSessionId: 'A' })
    expect(selectThreadReadings(f.store.getState(), 'sessionSettingsUpdated')).toHaveLength(1)
    f.store.getState().dispatch({ type: 'requestEnded', requestId: 7 })
    const before = f.store.getState()
    f.emit({ type: 'sessionStateCleared', family: 'tool_progress', inReplyTo: 7, serverId: 'one', envelopeSessionId: 'A', correlation: { id: 8, ts: '' } })
    expect(f.store.getState()).toBe(before)
    f.store.getState().dispatch({ type: 'dispose' }); f.emit(model()); f.bind('A')
    expect(f.store.getState().readings.size).toBe(0)
  })

  it('retains B settings and protects responses across host switching and send failures', () => {
    const f = fixture()
    f.bind('B')
    f.emit({ type: 'runConfigReceived', conversationId: 'chat', sessionId: 'reported-A', model: 'B-settings', effort: 'high', yolo: false,
      permissionMode: 'default', used_tokens: 40, window_tokens: 100, serverId: 'one', envelopeSessionId: 'B', inReplyTo: 7 })
    expect(f.inputs().runConfig?.model).toBe('B-settings'); expect(f.inputs().sessionId).toBe('B')
    f.emit({ type: 'runConfigReceived', conversationId: 'chat', sessionId: 'A', model: 'old-settings', effort: 'low', yolo: true,
      permissionMode: 'default', used_tokens: 80, window_tokens: 100, serverId: 'one', envelopeSessionId: 'A', inReplyTo: 7 })
    expect(f.inputs().runConfig?.model).toBe('B-settings')
    const p = permission('B'); f.emit(p)
    const cancel = { type: 'cancelModal' as const, payload: { modal_id: 'permission' } }
    f.isConnected.mockReturnValue(false)
    expect(f.store.getState().respond(p, cancel)).toBe(false)
    f.isConnected.mockReturnValue(true)
    f.sendResponse.mockImplementation(() => { throw new Error('peer text must never be logged') })
    expect(f.store.getState().respond(p, cancel)).toBe(false)
    expect(f.inputs().permissions).toHaveLength(1)
    f.store.getState().dispatch({ type: 'summary', serverId: 'two', summary: { id: 'chat', current_session_id: 'B' } })
    f.emit(permission('B', 'two'))
    expect(f.store.getState().respond(p, cancel)).toBe(false)
    f.emit({ type: 'connected', serverId: 'one', ack: {} as Extract<DaemonEvent, { type: 'connected' }>['ack'] })
    expect(f.inputs().permissions).toHaveLength(1)
  })
  it('retains prompt choices across pane lifetime and consumes only the displayed reading', () => {
    const f = fixture(), q = question(), p = permission()
    f.emit(q); f.emit(p)
    const state = f.store.getState()
    state.questions.getState().dispatch({ type: 'optionPicked', questionBatchId: 'question', questionIndex: 0, optionIndex: 0 })
    expect(state.modals.getState().outstanding).toHaveLength(1)
    f.emit({ type: 'modalDismissed', modalId: 'permission', outcome: 'allow', source: 'remote', serverId: 'one', envelopeSessionId: 'A' })
    expect(state.modals.getState().resolutions[0]?.kind).toBe('remote')
    const old = { type: 'sessionError' as const, code: 'session.blocked', conversationId: 'chat', serverId: 'one', envelopeSessionId: 'A' }
    const replacement = { ...old, code: 'session.child_crashing' }
    f.emit(old); f.emit(replacement)
    f.store.getState().dispatch({ type: 'consume', displayed: old })
    expect(f.inputs().sessionError).toBe(replacement)
    f.store.getState().dispatch({ type: 'consume', displayed: replacement })
    expect(f.inputs().sessionError).toBeNull()
    f.emit({ type: 'compacting', conversationId: 'chat', active: true, serverId: 'one', envelopeSessionId: 'A' })
    f.emit({ type: 'connected', serverId: 'one', ack: {} as Extract<DaemonEvent, { type: 'connected' }>['ack'] })
    expect(f.inputs().status.compacting).toBe(false)
    expect(state.modals.getState().outstanding).toEqual([])
    expect(state.modals.getState().resolutions).toEqual([])
  })

  it('preserves owned rejection feedback while reconnect retires old prompt handles', () => {
    const f = fixture()
    f.emit(permission())
    f.emit({ type: 'modalAnswerRejected', modalId: 'permission', serverId: 'one' })
    expect(f.store.getState().modals.getState().rejections).toEqual(['permission'])
    f.emit({ type: 'connected', serverId: 'one', ack: {} as Extract<DaemonEvent, { type: 'connected' }>['ack'] })
    expect(f.store.getState().modals.getState().rejections).toEqual(['permission'])
    expect(f.store.getState().modals.getState().outstanding).toEqual([])
  })

})

it('applies an unsolicited family clear only to a held reading in the same authenticated session', () => {
  const f = fixture()
  f.emit({ type: 'resetting', active: true, phase: 'restarting', handoff: 'written',
    conversationId: 'chat', serverId: 'one', envelopeSessionId: 'A' })
  expect(f.inputs().status.resetting).not.toBeNull()
  f.emit({ type: 'sessionStateCleared', family: 'resetting', correlation: { id: 9, ts: '' }, serverId: 'two', envelopeSessionId: 'A' })
  f.emit({ type: 'sessionStateCleared', family: 'resetting', correlation: { id: 9, ts: '' }, serverId: 'one', envelopeSessionId: 'B' })
  expect(f.inputs().status.resetting).not.toBeNull()
  f.emit({ type: 'sessionStateCleared', family: 'resetting', correlation: { id: 9, ts: '' }, serverId: 'one', envelopeSessionId: 'A' })
  expect(f.inputs().status.resetting).toBeNull()
  f.emit({ type: 'runConfigReceived', conversationId: 'chat', sessionId: 'A', model: 'model-A', effort: 'high',
    yolo: false, permissionMode: 'default', used_tokens: 0, window_tokens: 100, serverId: 'one', envelopeSessionId: 'A' })
  expect(f.inputs().runConfig?.model).toBe('model-A')
})
