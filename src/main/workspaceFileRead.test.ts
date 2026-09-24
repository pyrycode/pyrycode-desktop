import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createWorkspaceFileRead } from './workspaceFileRead'
import { ATTACHMENT_MAX_CONCURRENT_RETRIEVALS } from './attachmentRetrieval'
import type { AttachmentRetrievalConsumer } from './daemonConnection'
import type { AttachmentRetrievalFailure } from '../shared/ipc/attachmentRetrieval'
import type {
  WorkspaceFileReadEvent,
  WorkspaceFileReadRequest
} from '../shared/ipc/workspaceFileRead'
import type { DiagnosticEvent } from './diagnosticLog'
import type { ReadWorkspaceFilePayload } from '../shared/wire/types'

const CONVERSATION = 'b19c6a4e-2f70-4d51-9a3c-8e2d5f01c7ab'
const PATH = 'docs/private/salary-review.md'
const TEXT = '# Heading\n\nSome *markdown* — with ünïcödé.\n'

function harness(): {
  request: (ask: WorkspaceFileReadRequest, emit?: (event: WorkspaceFileReadEvent) => void) => void
  asks: { payload: ReadWorkspaceFilePayload; consumer: AttachmentRetrievalConsumer }[]
  events: WorkspaceFileReadEvent[]
  records: DiagnosticEvent[]
} {
  const asks: { payload: ReadWorkspaceFilePayload; consumer: AttachmentRetrievalConsumer }[] = []
  const events: WorkspaceFileReadEvent[] = []
  const records: DiagnosticEvent[] = []
  const driver = createWorkspaceFileRead({
    readWorkspaceFile: (payload, consumer) => asks.push({ payload, consumer }),
    diagnosticLog: { event: (fields: DiagnosticEvent): void => void records.push(fields) }
  })
  return {
    request: (ask, emit) => driver(ask, emit ?? ((event) => events.push(event))),
    asks,
    events,
    records
  }
}

const ask = (requestKey: string): WorkspaceFileReadRequest => ({
  requestKey,
  conversationId: CONVERSATION,
  path: PATH
})

describe('createWorkspaceFileRead', () => {
  it('asks the transport for exactly the conversation id and the path, as a fresh literal', () => {
    const ctx = harness()
    // A smuggled key on the renderer's ask must not survive into the wire payload.
    ctx.request({ ...ask('k1'), attachment_id: 'x' } as WorkspaceFileReadRequest)

    expect(ctx.asks).toHaveLength(1)
    expect(ctx.asks[0].payload).toEqual({ conversation_id: CONVERSATION, path: PATH })
    expect(Object.keys(ctx.asks[0].payload)).toEqual(['conversation_id', 'path'])
    expect(ctx.events).toEqual([])
  })

  it('sends a new ask every time, even for the same path — nothing is cached or coalesced', () => {
    const ctx = harness()
    ctx.request(ask('k1'))
    ctx.request(ask('k2'))
    ctx.asks[0].consumer.complete(new TextEncoder().encode(TEXT))
    ctx.request(ask('k3'))

    expect(ctx.asks).toHaveLength(3)
  })

  it('hands the window the decoded text, carrying that ask’s request key', () => {
    const ctx = harness()
    ctx.request(ask('k1'))
    ctx.asks[0].consumer.complete(new TextEncoder().encode(TEXT))

    expect(ctx.events).toEqual([{ type: 'loaded', requestKey: 'k1', text: TEXT }])
  })

  it('answers each of two concurrent asks on its own key and its own emit', () => {
    const ctx = harness()
    const first: WorkspaceFileReadEvent[] = []
    const second: WorkspaceFileReadEvent[] = []
    ctx.request(ask('k1'), (event) => first.push(event))
    ctx.request(ask('k2'), (event) => second.push(event))
    ctx.asks[1].consumer.complete(new TextEncoder().encode('two'))
    ctx.asks[0].consumer.fail('not-found')

    expect(first).toEqual([{ type: 'failed', requestKey: 'k1', reason: 'not-found' }])
    expect(second).toEqual([{ type: 'loaded', requestKey: 'k2', text: 'two' }])
  })

  it('fails not-text for bytes that are not valid UTF-8', () => {
    const ctx = harness()
    ctx.request(ask('k1'))
    ctx.asks[0].consumer.complete(new Uint8Array([0x23, 0x20, 0xff, 0xfe, 0xc3]))

    expect(ctx.events).toEqual([{ type: 'failed', requestKey: 'k1', reason: 'not-text' }])
  })

  it.each([
    'not-connected',
    'send-failed',
    'not-found',
    'daemon-error',
    'timed-out',
    'stream-contradiction',
    'too-large',
    'verification-failed',
    'stream-aborted',
    'connection-lost'
  ] as const)('forwards the transport’s %s as one failure on the ask’s key', (reason) => {
    const ctx = harness()
    ctx.request(ask('k1'))
    ctx.asks[0].consumer.fail(reason)

    expect(ctx.events).toEqual([{ type: 'failed', requestKey: 'k1', reason }])
  })

  it('never reports store-failed: nothing is stored on this leg', () => {
    const ctx = harness()
    ctx.request(ask('k1'))
    ctx.asks[0].consumer.fail('store-failed' as AttachmentRetrievalFailure)

    expect(ctx.events).toEqual([{ type: 'failed', requestKey: 'k1', reason: 'daemon-error' }])
  })

  it('refuses busy past the concurrency cap without reaching the transport', () => {
    const ctx = harness()
    for (let i = 0; i < ATTACHMENT_MAX_CONCURRENT_RETRIEVALS; i += 1) ctx.request(ask(`k${i}`))
    ctx.request(ask('over'))

    expect(ctx.asks).toHaveLength(ATTACHMENT_MAX_CONCURRENT_RETRIEVALS)
    expect(ctx.events).toEqual([{ type: 'failed', requestKey: 'over', reason: 'busy' }])
  })

  it('frees a slot at each terminal, so a new ask is admitted', () => {
    const ctx = harness()
    for (let i = 0; i < ATTACHMENT_MAX_CONCURRENT_RETRIEVALS; i += 1) ctx.request(ask(`k${i}`))
    ctx.asks[0].consumer.complete(new Uint8Array([0xff]))
    ctx.asks[1].consumer.fail('timed-out')
    ctx.request(ask('again'))
    ctx.request(ask('again-2'))

    expect(ctx.asks).toHaveLength(ATTACHMENT_MAX_CONCURRENT_RETRIEVALS + 2)
    expect(ctx.events.filter((event) => event.type === 'failed' && event.reason === 'busy')).toEqual(
      []
    )
  })

  it('reports exactly one terminal per ask even if the transport settles twice', () => {
    const ctx = harness()
    ctx.request(ask('k1'))
    ctx.asks[0].consumer.complete(new TextEncoder().encode(TEXT))
    ctx.asks[0].consumer.fail('connection-lost')
    for (let i = 2; i < 2 + ATTACHMENT_MAX_CONCURRENT_RETRIEVALS + 1; i += 1) ctx.request(ask(`k${i}`))

    // The late fail released no second slot: had it, one ask past the cap would have been admitted.
    expect(ctx.events).toEqual([
      { type: 'loaded', requestKey: 'k1', text: TEXT },
      { type: 'failed', requestKey: `k${2 + ATTACHMENT_MAX_CONCURRENT_RETRIEVALS}`, reason: 'busy' }
    ])
    expect(ctx.asks).toHaveLength(1 + ATTACHMENT_MAX_CONCURRENT_RETRIEVALS)
  })

  it('logs a static event name and a client-owned code, and never the path, key or text', () => {
    const ctx = harness()
    ctx.request(ask('secret-key'))
    ctx.asks[0].consumer.complete(new TextEncoder().encode(TEXT))
    ctx.request(ask('secret-key-2'))
    ctx.asks[1].consumer.complete(new Uint8Array([0xff]))

    expect(ctx.records.map((record) => record.code)).toEqual([
      'started',
      'loaded',
      'started',
      'not-text'
    ])
    for (const record of ctx.records) {
      expect(record.event).toBe('workspace-file-read')
      expect(Object.keys(record).sort()).toEqual(['code', 'event'])
      const line = JSON.stringify(record)
      expect(line).not.toContain(PATH)
      expect(line).not.toContain('secret-key')
      expect(line).not.toContain('Heading')
      expect(line).not.toContain(CONVERSATION)
    }
  })

  it('is correct with no logger injected', () => {
    const events: WorkspaceFileReadEvent[] = []
    const consumers: AttachmentRetrievalConsumer[] = []
    const request = createWorkspaceFileRead({
      readWorkspaceFile: (_payload, consumer) => consumers.push(consumer)
    })
    request(ask('k1'), (event) => events.push(event))
    consumers[0].fail('timed-out')

    expect(events).toEqual([{ type: 'failed', requestKey: 'k1', reason: 'timed-out' }])
  })

  it('imports no filesystem or path module: the path is never used on this machine', () => {
    const source = readFileSync(resolve(__dirname, 'workspaceFileRead.ts'), 'utf8')
    expect(source).not.toMatch(/from ['"](node:)?(fs|path|fs\/promises)['"]/)
    expect(source).not.toMatch(/from ['"]electron['"]/)
  })
})
