import { describe, expect, it } from 'vitest'
import { createDiagnosticLog } from './diagnosticLog'
import { createMessageLifecycle } from './messageLifecycle'
import { onDiagnostic } from './receiveDiagnostic'

const id = '12345678-1234-4123-8123-123456789abc'
const other = '22345678-1234-4123-8123-123456789abc'
function fixture() {
  const lines: string[] = []
  const logger = createDiagnosticLog({ sink: { write: line => lines.push(line) }, now: () => 'now' })
  const tracker = createMessageLifecycle(logger)
  return { lines, tracker }
}

describe('message lifecycle serialization', () => {
  it('records one queued/sent/acknowledged trail using held ids only', () => {
    const { tracker, lines } = fixture()
    tracker.queued(id, 'chat')
    tracker.queued(id, 'chat')
    const observe = tracker.sending(id, 'chat', 'host')
    observe?.({ type: 'sent', connectionId: other })
    tracker.acknowledge('other-host', 'chat', [id])
    tracker.acknowledge('host', 'other-chat', [id])
    tracker.acknowledge('host', 'chat', ['', undefined, 'HOSTILE', other])
    expect(lines).toHaveLength(2)
    tracker.acknowledge('host', 'chat', [id])
    tracker.acknowledge('host', 'chat', [id])
    expect(lines.map(line => JSON.parse(line).event)).toEqual(['message-queued', 'message-sent', 'message-acknowledged'])
    expect(lines.every(line => JSON.parse(line).messageId === id)).toBe(true)
    expect(JSON.parse(lines[1]).connectionId).toBe(other)
  })
  it('keeps sent without acknowledgement, ignores disappearance and deduplicates local cancellation', () => {
    const { tracker, lines } = fixture()
    tracker.queued(id, 'chat')
    tracker.sending(id, 'chat', 'host')?.({ type: 'sent', connectionId: other })
    tracker.acknowledge('host', 'chat', [])
    expect(lines).toHaveLength(2)
    tracker.cancel(other, 'chat')
    tracker.cancel(id, 'wrong')
    tracker.cancel(id, 'chat')
    tracker.cancel(id, 'chat')
    expect(JSON.parse(lines[2]).code).toBe('user-cancel-request')
  })
  it('classifies refusal/failure and silently retires bounded state', () => {
    const { tracker, lines } = fixture()
    tracker.queued(id, 'chat')
    tracker.sending(id, 'chat', 'host')?.({ type: 'dropped', reason: 'write-failed' })
    tracker.drop(id, 'chat', 'send-failed')
    tracker.acknowledge('host', 'chat', [id])
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]).code).toBe('write-failed')
    for (let i = 0; i < 1025; i++) tracker.queued(`${i.toString(16).padStart(8, '0')}-1234-4123-8123-123456789abc`, 'chat')
    const count = lines.length
    tracker.cancel(id, 'chat')
    expect(lines).toHaveLength(count)
  })
  it('projects hostile IPC fields without exposing main-only ids or arbitrary strings', () => {
    const { tracker, lines } = fixture()
    let listener: (event: unknown, raw: unknown) => void = () => {}
    onDiagnostic({ on: (_channel, cb) => { listener = cb }, removeListener: () => {} },
      createDiagnosticLog({ sink: { write: line => lines.push(line) } }), tracker)
    listener({}, { event: 'message-queued', messageId: 'TEXT_SECRET', conversationId: 'chat' })
    expect(lines).toHaveLength(0)
    listener({}, { event: 'message-queued', messageId: id, conversationId: 'chat', text: 'TEXT_SECRET', token: 'TOKEN_SECRET', connectionId: 'FAKE_SECRET' })
    listener({}, { event: 'message-dropped', messageId: id, conversationId: 'chat', code: 'ERROR_SECRET' })
    listener({}, { event: 'message-sent', messageId: id, connectionId: 'FAKE_SECRET' })
    expect(lines).toHaveLength(1)
    expect(lines.join()).not.toContain('SECRET')
    expect(lines.join()).not.toContain('chat')
    listener({}, { event: 'store-transition', messageId: 'MESSAGE_SECRET', connectionId: 'CONNECTION_SECRET', safeBytes: 'BYTE_SECRET' })
    expect(lines).toHaveLength(2)
    expect(lines.join()).not.toContain('SECRET')
  })
  it('cannot throw into sending even when the logger throws', () => {
    const tracker = createMessageLifecycle({ event: () => { throw new Error('secret') } })
    expect(() => { tracker.queued(id, 'chat'); tracker.sending(id, 'chat', 'host')?.({ type: 'sent', connectionId: other }); tracker.cancel(id, 'chat') }).not.toThrow()
  })
})

it('a local cancellation request does not suppress a subsequent write or held acknowledgement', () => {
  const { tracker, lines } = fixture()
  tracker.queued(id, 'chat')
  const observe = tracker.sending(id, 'chat', 'host')
  tracker.cancel(id, 'chat')
  observe?.({ type: 'sent', connectionId: other })
  tracker.acknowledge('host', 'chat', [id])
  expect(lines.map(line => JSON.parse(line).event)).toEqual(['message-queued', 'message-dropped', 'message-sent', 'message-acknowledged'])
})
