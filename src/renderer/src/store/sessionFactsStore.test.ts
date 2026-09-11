import { translateDaemonEvent } from './daemonEventBridge'
import { translateTimelineEvent } from './timelineBridge'
import { translateModalEvent } from './modalBridge'
import { translateQuestionEvent } from './questionBridge'
import { describe, expect, it } from 'vitest'
import { createSessionFactsStore, selectSessionFactsFor } from './sessionFactsStore'
import { subscribeSessionFacts } from './sessionFactsBridge'
import type { DaemonEvent } from '@shared/ipc/events'

const facts = { claudeCodeVersion: 'preview', permissionMode: 'future', truncatedFields: ['permission_mode'] }

describe('session facts retention', () => {
  it('isolates conversations, preserves record identities, and replaces whole reports', () => {
    const store = createSessionFactsStore()
    const read = (id: string) => selectSessionFactsFor(id)(store.getState())
    expect(read('__proto__')).toBeNull()
    expect(read('constructor')).toBeNull()
    for (const conversationId of ['a', 'b', '__proto__', 'constructor', '']) {
      store.getState().setSessionFacts({ conversationId, ...facts })
    }
    const b = read('b')
    store.getState().setSessionFacts({ conversationId: 'a', claudeCodeVersion: '', permissionMode: '', truncatedFields: null })
    expect(read('a')).toEqual({ claudeCodeVersion: '', permissionMode: '', truncatedFields: null })
    expect(read('b')).toBe(b)
    expect(read('unknown')).toBeNull()
    expect(read('__proto__')).toEqual(facts)
    store.getState().clearSessionFacts()
    for (const id of ['a', 'b', '__proto__', 'constructor', '']) expect(read(id)).toBeNull()
    expect(createSessionFactsStore().getState().facts.size).toBe(0)
  })

  it('subscribes independently of the sheet and tears down', () => {
    const store = createSessionFactsStore()
    const listeners = new Set<(event: DaemonEvent) => void>()
    const off = subscribeSessionFacts((listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }, store.getState().setSessionFacts)
    const emit = (event: DaemonEvent) => listeners.forEach((listener) => listener(event))
    emit({ type: 'sessionFacts', conversationId: 'a', ...facts })
    expect(selectSessionFactsFor('a')(store.getState())).toEqual(facts)
    emit({ type: 'modelAnnounced', conversationId: 'a', model: 'other', truncated: false })
    expect(selectSessionFactsFor('a')(store.getState())).toEqual(facts)
    off()
    expect(listeners.size).toBe(0)
  })
})

it('a report has no timeline, turn, modal or question action', () => {
  const event: DaemonEvent = { type: 'sessionFacts', conversationId: 'a', ...facts }
  expect(translateDaemonEvent(event)).toBeNull()
  expect(translateTimelineEvent(event)).toBeNull()
  expect(translateModalEvent(event, () => new Set())).toBeNull()
  expect(translateQuestionEvent(event)).toBeNull()
})
