import type { Page } from '@playwright/test'
import { decodeEnvelope, encodeEnvelope } from '../../src/main/transport/codec'
import type { Envelope, ReadWorkspaceFilePayload, SendMessagePayload } from '../../src/shared/wire/types'
import type { ThreadItem, ThreadUpdate } from '../../src/shared/wire/thread'
import { createCanonicalThread } from './canonicalThread'
import { expect, SEEDED_ROW, SECOND_SEEDED_ROW } from './launchPairedApp'

/** Authored reader facts; file bytes still travel through the real attachment verifier. */
export function createReaderThread(reply: string,
  read: (id: number, ask: ReadWorkspaceFilePayload) => Uint8Array[], history: string[] = []) {
  const session = 'reader-session', epoch = 'reader-epoch', ts = '2026-07-07T12:00:00.000Z'
  const requests: Envelope[] = []
  let deviceId: string | undefined
  let version = 1, nextId = 0
  const thread = createCanonicalThread({ conversations: [SEEDED_ROW, SECOND_SEEDED_ROW].map(summary => ({
    summary: { ...summary, current_session_id: session }, epoch, version: 1, items: []
  })) })
  const add = (kind: string, status: string, content: unknown): Uint8Array => {
    const id = ++nextId
    const item: ThreadItem = { id, order: id * 10, rev: 1, kind, status, active: false,
      shown: true, summary: '', session, turn: `reader-turn-${id}`, content }
    const update: ThreadUpdate = { type: 'thread_item_added',
      payload: { conversation_id: SEEDED_ROW.id, epoch, version: ++version, item } }
    return encodeEnvelope({ id, ts, ...update })
  }
  return {
    session,
    options: { threadMode: 'canonical' as const, thread,
      helloAck: { capabilities: ['interactive', 'thread'] },
      buildReplyFrames: (inbound: Uint8Array): Uint8Array[] => {
        const request = decodeEnvelope(inbound)
        requests.push(request)
        if (request.type === 'read_workspace_file') {
          const ask = request.payload as ReadWorkspaceFilePayload
          expect(ask.conversation_id).toBe(SEEDED_ROW.id)
          return read(request.id, ask)
        }
        if (request.type !== 'send_message') return []
        const sent = request.payload as SendMessagePayload
        expect(sent.conversation_id).toBe(SEEDED_ROW.id)
        if (!deviceId) throw Error('reader own-device identity not bound')
        // Explicit daemon acceptance, separate from command receipt or assistant activity.
        return [add('user_message', 'delivered', { text: sent.text, ts,
          message_id: sent.message_id, device_id: deviceId }),
        ...history.map(text => add('assistant_message', 'finished', { text })),
        add('assistant_message', 'finished', { text: reply })]
      }
    },
    async ready(page: Page): Promise<void> {
      await expect.poll(() => requests.filter(r => r.type === 'thread_catch_up').length).toBe(1)
      expect(requests.find(r => r.type === 'thread_catch_up')?.payload)
        .toMatchObject({ conversation_id: SEEDED_ROW.id, version: 0 })
      const identity = await page.evaluate(() => window.pyry.deviceIdentity())
      if (!identity.ok) throw Error('reader own-device identity unavailable')
      deviceId = identity.deviceId
    }
  }
}
