import { describe, it, expect, vi } from 'vitest'
import {
  ATTACHMENT_MAX_CONCURRENT_RETRIEVALS,
  createAttachmentRetrieval,
  type AttachmentRetrievalDeps
} from './attachmentRetrieval'
import type { AttachmentRetrievalConsumer } from './daemonConnection'
import type {
  AttachmentRetrievalEvent,
  AttachmentRetrievalFailure
} from '../shared/ipc/attachmentRetrieval'
import type { StoreAttachmentResult } from './attachmentStore'
import type { DiagnosticEvent, DiagnosticLog } from './diagnosticLog'
import type { RequestAttachmentPayload } from '../shared/wire/types'

const CONVERSATION = 'b19c6a4e-2f70-4d51-9a3c-8e2d5f01c7ab'
const ATTACHMENT = 'd41d8cd9-8f00-4204-a980-0998ecf8427e'
const OTHER_ATTACHMENT = '11112222-3333-4444-8555-666677778888'
const LOCAL_PATH = '/Users/someone/Library/Application Support/pyry/attachments/d41d8cd9'

/** Fully drain the microtask queue the store's promise chain settles on. A single tick is NOT
 *  enough for a settle-once driver whose terminal crosses two `.then` hops. */
const drain = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function harness(
  overrides: {
    store?: (attachmentId: string, bytes: Uint8Array) => Promise<StoreAttachmentResult>
    diagnosticLog?: DiagnosticLog
  } = {}
): {
  request: (
    request: { conversationId: string; attachmentId: string },
    emit?: (event: AttachmentRetrievalEvent) => void
  ) => void
  /** Every ask that reached the transport, with the consumer it was armed with. */
  asks: { payload: RequestAttachmentPayload; consumer: AttachmentRetrievalConsumer }[]
  events: AttachmentRetrievalEvent[]
  records: DiagnosticEvent[]
} {
  const asks: { payload: RequestAttachmentPayload; consumer: AttachmentRetrievalConsumer }[] = []
  const events: AttachmentRetrievalEvent[] = []
  const records: DiagnosticEvent[] = []
  const deps: AttachmentRetrievalDeps = {
    resolve: () => ({ serverId: 'host', connection: { requestAttachment: (payload, consumer) => { asks.push({ payload, consumer }) } } }),
    store: overrides.store ?? ((): Promise<StoreAttachmentResult> =>
      Promise.resolve({ ok: true, path: LOCAL_PATH })),
    diagnosticLog: overrides.diagnosticLog ?? {
      event: (fields: DiagnosticEvent): void => {
        records.push(fields)
      }
    }
  }
  const driver = createAttachmentRetrieval(deps)
  const collect = (event: AttachmentRetrievalEvent): void => { events.push(event) }
  return {
    // The emit is per-ask, so the harness defaults it to the shared collector and lets a test pass
    // its own to prove a terminal reaches the window that ASKED rather than whichever asked last.
    request: (ask, emit) => driver(ask, emit ?? collect),
    asks,
    events,
    records
  }
}

describe('createAttachmentRetrieval', () => {
  it('asks the transport for exactly the two identifiers, in wire field names', () => {
    const ctx = harness()

    ctx.request({ conversationId: CONVERSATION, attachmentId: ATTACHMENT })

    expect(ctx.asks).toHaveLength(1)
    expect(ctx.asks[0].payload).toEqual({
      conversation_id: CONVERSATION,
      attachment_id: ATTACHMENT
    })
    // Nothing is reported until the retrieval reaches a terminal.
    expect(ctx.events).toEqual([])
  })

  it('tells the window the file is on this machine, and says nothing about where', async () => {
    const ctx = harness()
    ctx.request({ conversationId: CONVERSATION, attachmentId: ATTACHMENT })

    ctx.asks[0].consumer.complete(new Uint8Array([1, 2, 3]))
    await drain()

    expect(ctx.events).toEqual([{ type: 'completed', conversationId: CONVERSATION, attachmentId: ATTACHMENT }])
    // The store's path is a RETURN VALUE for #814/#866/#867, never something to forward. Checked as a
    // property of the serialized event, so a later added field cannot smuggle it.
    expect(JSON.stringify(ctx.events)).not.toContain(LOCAL_PATH)
  })

  it('stores the bytes under the identifier THIS CLIENT asked for', async () => {
    const stored: { id: string; bytes: Uint8Array }[] = []
    const ctx = harness({
      store: (attachmentId, bytes) => {
        stored.push({ id: attachmentId, bytes })
        return Promise.resolve({ ok: true, path: LOCAL_PATH })
      }
    })
    ctx.request({ conversationId: CONVERSATION, attachmentId: ATTACHMENT })

    ctx.asks[0].consumer.complete(new Uint8Array([4, 5]))
    await drain()

    expect(stored).toHaveLength(1)
    expect(stored[0].id).toBe(ATTACHMENT)
    expect(Array.from(stored[0].bytes)).toEqual([4, 5])
  })

  it('fails store-failed when the write is refused', async () => {
    const ctx = harness({
      store: () => Promise.resolve({ ok: false, reason: 'store-failed' })
    })
    ctx.request({ conversationId: CONVERSATION, attachmentId: ATTACHMENT })

    ctx.asks[0].consumer.complete(new Uint8Array([1]))
    await drain()

    expect(ctx.events).toEqual([
      { type: 'failed', conversationId: CONVERSATION, attachmentId: ATTACHMENT, reason: 'store-failed' }
    ])
  })

  it('fails store-failed when the write REJECTS, dropping the errno', async () => {
    const ctx = harness({
      // storeAttachment is documented never to throw, so this is a backstop — but an unhandled
      // main-process rejection is exactly what AC4 forbids, and a contract is not a guarantee. The
      // errno carries the offending path in its own message.
      store: () => Promise.reject(new Error("EACCES: permission denied, open '/private/secret'"))
    })
    ctx.request({ conversationId: CONVERSATION, attachmentId: ATTACHMENT })

    ctx.asks[0].consumer.complete(new Uint8Array([1]))
    await drain()

    expect(ctx.events).toEqual([
      { type: 'failed', conversationId: CONVERSATION, attachmentId: ATTACHMENT, reason: 'store-failed' }
    ])
    expect(JSON.stringify(ctx.events)).not.toContain('/private/secret')
    expect(JSON.stringify(ctx.records)).not.toContain('/private/secret')
  })

  it.each([
    'not-connected',
    'send-failed',
    'not-found',
    'daemon-error',
    'timed-out',
    'stream-aborted',
    'connection-lost',
    'stream-contradiction',
    'too-large',
    'verification-failed'
  ] as const)('reports %s to the window as its own static reason', (reason) => {
    const ctx = harness()
    ctx.request({ conversationId: CONVERSATION, attachmentId: ATTACHMENT })

    ctx.asks[0].consumer.fail(reason)

    // No second mapping layer: the transport's terminal IS the window's reason. AC3's two published
    // codes therefore stay distinguishable end to end.
    expect(ctx.events).toEqual([{ type: 'failed', conversationId: CONVERSATION, attachmentId: ATTACHMENT, reason }])
  })

  it('runs two retrievals of different attachments at once without cross-feeding', async () => {
    const ctx = harness()

    ctx.request({ conversationId: CONVERSATION, attachmentId: ATTACHMENT })
    ctx.request({ conversationId: CONVERSATION, attachmentId: OTHER_ATTACHMENT })
    expect(ctx.asks).toHaveLength(2)

    ctx.asks[1].consumer.complete(new Uint8Array([9]))
    await drain()
    ctx.asks[0].consumer.fail('not-found')

    expect(ctx.events).toEqual([
      { type: 'completed', conversationId: CONVERSATION, attachmentId: OTHER_ATTACHMENT },
      { type: 'failed', conversationId: CONVERSATION, attachmentId: ATTACHMENT, reason: 'not-found' }
    ])
  })

  it('coalesces a duplicate ask for an attachment already in flight', () => {
    const ctx = harness()

    ctx.request({ conversationId: CONVERSATION, attachmentId: ATTACHMENT })
    ctx.request({ conversationId: CONVERSATION, attachmentId: ATTACHMENT })

    // Starts nothing and reports nothing: the live retrieval's terminal names this attachmentId and
    // therefore answers both asks. A `busy` here would report a failure for a fetch that is running.
    expect(ctx.asks).toHaveLength(1)
    expect(ctx.events).toEqual([])
  })

  it('answers the window that ASKED, not whichever asked last', () => {
    const ctx = harness()
    const first: AttachmentRetrievalEvent[] = []
    const second: AttachmentRetrievalEvent[] = []

    ctx.request({ conversationId: CONVERSATION, attachmentId: ATTACHMENT }, (e) => first.push(e))
    ctx.request({ conversationId: CONVERSATION, attachmentId: OTHER_ATTACHMENT }, (e) =>
      second.push(e)
    )
    ctx.asks[0].consumer.fail('not-found')

    // The emit is captured per ask and held with the in-flight entry, so the terminal goes back to
    // the asker rather than to a process-lifetime target that #519 would have to keep current.
    expect(first).toEqual([{ type: 'failed', conversationId: CONVERSATION, attachmentId: ATTACHMENT, reason: 'not-found' }])
    expect(second).toEqual([])
  })

  it('answers every coalesced originating window without redirecting the original', () => {
    const ctx = harness()
    const first: AttachmentRetrievalEvent[] = []
    const second: AttachmentRetrievalEvent[] = []

    ctx.request({ conversationId: CONVERSATION, attachmentId: ATTACHMENT }, (e) => first.push(e))
    ctx.request({ conversationId: CONVERSATION, attachmentId: ATTACHMENT }, (e) => second.push(e))
    ctx.asks[0].consumer.fail('timed-out')

    // Both originating windows receive the shared terminal; neither replaces the other's emitter.
    expect(first).toEqual([{ type: 'failed', conversationId: CONVERSATION, attachmentId: ATTACHMENT, reason: 'timed-out' }])
    expect(second).toEqual(first)
  })

  it('holds the in-flight identifier across the store, then releases it', async () => {
    let settleStore: (result: StoreAttachmentResult) => void = () => undefined
    const ctx = harness({
      store: () =>
        new Promise<StoreAttachmentResult>((resolve) => {
          settleStore = resolve
        })
    })
    ctx.request({ conversationId: CONVERSATION, attachmentId: ATTACHMENT })
    ctx.asks[0].consumer.complete(new Uint8Array([1]))
    await drain()

    // Mid-store the retrieval has NOT reported a terminal, so a second ask must still coalesce —
    // otherwise a duplicate write of the same content-addressed file races the first.
    ctx.request({ conversationId: CONVERSATION, attachmentId: ATTACHMENT })
    expect(ctx.asks).toHaveLength(1)

    settleStore({ ok: true, path: LOCAL_PATH })
    await drain()
    expect(ctx.events).toEqual([{ type: 'completed', conversationId: CONVERSATION, attachmentId: ATTACHMENT }])

    // Released on the terminal: a fresh ask starts a fresh retrieval.
    ctx.request({ conversationId: CONVERSATION, attachmentId: ATTACHMENT })
    expect(ctx.asks).toHaveLength(2)
  })

  it('refuses busy past the concurrency cap, without reaching the transport', () => {
    const ctx = harness()
    for (let index = 0; index < ATTACHMENT_MAX_CONCURRENT_RETRIEVALS; index += 1) {
      ctx.request({ conversationId: CONVERSATION, attachmentId: `id-${index}` })
    }
    expect(ctx.asks).toHaveLength(ATTACHMENT_MAX_CONCURRENT_RETRIEVALS)

    ctx.request({ conversationId: CONVERSATION, attachmentId: 'one-too-many' })

    // Refused BEFORE the transport is called, so no reassembler is armed and nothing accumulates —
    // which is what keeps #995's per-transfer memory bound meaningful against an untrusted window.
    expect(ctx.asks).toHaveLength(ATTACHMENT_MAX_CONCURRENT_RETRIEVALS)
    expect(ctx.events).toEqual([
      { type: 'failed', conversationId: CONVERSATION, attachmentId: 'one-too-many', reason: 'busy' }
    ])
  })

  it('admits a new retrieval once a slot frees', () => {
    const ctx = harness()
    for (let index = 0; index < ATTACHMENT_MAX_CONCURRENT_RETRIEVALS; index += 1) {
      ctx.request({ conversationId: CONVERSATION, attachmentId: `id-${index}` })
    }

    ctx.asks[0].consumer.fail('not-found')
    ctx.request({ conversationId: CONVERSATION, attachmentId: 'late-arrival' })

    expect(ctx.asks).toHaveLength(ATTACHMENT_MAX_CONCURRENT_RETRIEVALS + 1)
    expect(ctx.events.filter((event) => event.type === 'failed' && event.reason === 'busy')).toEqual(
      []
    )
  })

  it('reports exactly one terminal per retrieval', async () => {
    const ctx = harness()
    ctx.request({ conversationId: CONVERSATION, attachmentId: ATTACHMENT })

    ctx.asks[0].consumer.complete(new Uint8Array([1]))
    await drain()

    // One ask in, one event out. The "exactly one" guarantee for the CONSUMER handle itself belongs
    // one layer down — daemonConnection settles each retrieval through a single exit and deletes its
    // entry — so this module relies on that contract rather than re-guarding it, exactly as
    // debugBundleDownload relies on BundleConsumer's.
    expect(ctx.events).toHaveLength(1)
  })

  it('never rejects, so the composition root’s bare void is licensed', async () => {
    const rejection = vi.fn()
    process.once('unhandledRejection', rejection)
    const ctx = harness({ store: () => Promise.reject(new Error('boom')) })

    expect(() =>
      ctx.request({ conversationId: CONVERSATION, attachmentId: ATTACHMENT })
    ).not.toThrow()
    ctx.asks[0].consumer.complete(new Uint8Array([1]))
    await drain()

    expect(rejection).not.toHaveBeenCalled()
    process.off('unhandledRejection', rejection)
  })

  it('logs a static event name and a client-owned code, and nothing else', async () => {
    const ctx = harness()
    ctx.request({ conversationId: CONVERSATION, attachmentId: ATTACHMENT })
    ctx.asks[0].consumer.complete(new Uint8Array([1, 2, 3]))
    await drain()
    ctx.request({ conversationId: CONVERSATION, attachmentId: OTHER_ATTACHMENT })
    ctx.asks[1].consumer.fail('stream-aborted')

    expect(ctx.records.length).toBeGreaterThan(0)
    for (const record of ctx.records) {
      expect(record.event).toBe('attachment-fetch')
      // No identifier, no path, no byte count, no chunk count — the ids are renderer-supplied (a
      // log-injection vector) and a length is wire-derived information about a host file.
      expect(Object.keys(record).sort()).toEqual(['code', 'event'])
      const line = JSON.stringify(record)
      expect(line).not.toContain(ATTACHMENT)
      expect(line).not.toContain(CONVERSATION)
      expect(line).not.toContain(LOCAL_PATH)
    }
  })

  it('is correct with no logger injected', () => {
    const events: AttachmentRetrievalEvent[] = []
    const asks: AttachmentRetrievalConsumer[] = []
    const request = createAttachmentRetrieval({
      resolve: () => ({ serverId: 'host', connection: { requestAttachment: (_payload, consumer) => { asks.push(consumer) } } }),
      store: () => Promise.resolve({ ok: true, path: LOCAL_PATH })
    })

    request({ conversationId: CONVERSATION, attachmentId: ATTACHMENT }, (event) =>
      events.push(event)
    )
    asks[0].fail('timed-out')

    const expected: AttachmentRetrievalFailure = 'timed-out'
    expect(events).toEqual([{ type: 'failed', conversationId: CONVERSATION, attachmentId: ATTACHMENT, reason: expected }])
  })
})
