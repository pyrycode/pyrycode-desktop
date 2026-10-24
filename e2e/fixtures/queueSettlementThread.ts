import { expect, SEEDED_ROW } from './launchPairedApp'
import { createCanonicalThread } from './canonicalThread'
import { decodeEnvelope, encodeEnvelope } from '../../src/main/transport/codec'
import type { Envelope, SendMessagePayload } from '../../src/shared/wire/types'
import type { ThreadItem, ThreadUpdate } from '../../src/shared/wire/thread'
import type { FakeDaemon } from '../../src/main/transport/fakeDaemon'
import type { Page } from '@playwright/test'

/** Authored canonical facts shared only by the mounted queue settlement/evidence scenarios. */
export function createQueueSettlementThread(native = false) {
  const summary = { ...SEEDED_ROW, current_session_id: 'queue-session' }
  const route = { conversation_id: summary.id, epoch: 'queue-epoch' }
  const ts = '2026-10-24T12:00:00Z'
  let version = 1
  let daemon: FakeDaemon
  const facts = new Map<number, ThreadItem>()
  const requests: Envelope[] = [], sends: SendMessagePayload[] = []
  const thread = createCanonicalThread({ conversations: [{ summary, epoch: route.epoch, version, items: [] }] })
  const envelope = (type: string, payload: unknown) => encodeEnvelope({ id: 77, ts,
    session_id: summary.current_session_id, type, payload })
  const publish = (update: ThreadUpdate) => {
    const bytes = envelope(update.type, update.payload)
    if (native) thread.publish(bytes).forEach(frame => daemon.pushFrame(frame))
    else daemon.pushFrame(bytes)
  }
  const held = (id: number) => {
    const fact = facts.get(id)
    if (!fact) throw Error('missing authored queue fact')
    return fact
  }
  const add = (item: ThreadItem) => {
    facts.set(item.id, item)
    publish({ type: 'thread_item_added', payload: { ...route, version: ++version, item } })
  }
  const change = (id: number, changes: Partial<ThreadItem>) => {
    const before = held(id), rev = before.rev + 1
    facts.set(id, { ...before, ...changes, rev })
    publish({ type: 'thread_item_changed', payload: { ...route, version: ++version,
      item_id: id, base_rev: before.rev, rev, changes } })
  }
  const append = (id: number, text: string) => {
    const before = held(id), rev = before.rev + 1
    facts.set(id, { ...before, rev, content: { ...before.content as Record<string, unknown>,
      text: String((before.content as Record<string, unknown>).text) + text } })
    publish({ type: 'thread_text_append', payload: { ...route, version: ++version,
      item_id: id, base_rev: before.rev, rev, text } })
  }
  const item = (id: number, order: number, kind: string, content: Record<string, unknown>,
    fields: Partial<ThreadItem> = {}): ThreadItem => ({ id, order, rev: 1, kind, status: 'done',
    active: false, shown: true, summary: '', session: summary.current_session_id, content, ...fields })
  return {
    options: { ...(native ? { threadMode: 'native' as const } : { threadMode: 'canonical' as const, thread }),
      buildReplyFrames: (bytes: Uint8Array) => {
        const request = decodeEnvelope(bytes)
        requests.push(request)
        if (request.type === 'send_message') sends.push(request.payload as SendMessagePayload)
        return native ? thread.reply(bytes, []) : []
      } },
    attach: (target: FakeDaemon) => { daemon = target }, requests, sends, item, add, change, append,
    async ready(page: Page) {
      await expect.poll(() => requests.filter(r => r.type === 'thread_catch_up').length).toBeGreaterThan(0)
      expect(requests.find(r => r.type === 'thread_catch_up')?.payload).toMatchObject({ conversation_id: summary.id, version: 0 })
      const identity = await page.evaluate(() => window.pyry.deviceIdentity())
      if (!identity.ok) throw Error(identity.error)
      return identity.deviceId
    },
    live: (state: 'responding' | 'idle') => daemon.pushFrame(envelope('turn_state', { conversation_id: summary.id, state })),
    repeat(id: number, text: string, older = false) {
      if (!native) throw Error('duplicate controls require native mode')
      const fact = held(id)
      daemon.pushFrame(envelope('thread_item_added', { ...route, version: ++version,
        item: { ...fact, rev: fact.rev - (older ? 1 : 0), content: { ...fact.content as Record<string, unknown>, text } } }))
      thread.setConversation({ summary, epoch: route.epoch, version, items: [...facts.values()] })
    },
    assertRequests() {
      expect(requests.map(r => r.type)).not.toContain('request_history')
      expect(requests.map(r => r.type)).not.toContain('history_page')
    }
  }
}
