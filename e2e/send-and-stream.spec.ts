import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { createCanonicalThread } from './fixtures/canonicalThread'
import { bubbleTextExactly } from './fixtures/bubbleText'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, SendMessagePayload } from '../src/shared/wire/types'
import type { ThreadItem, ThreadUpdate } from '../src/shared/wire/thread'

const MESSAGE_TIMEOUT_MS = 15_000
const REPLY_TEXT = 'streamed reply from the fake daemon'
const TYPED_TEXT = 'hello from the composer'
const OPENING_TEXT = 'Canonical opening fact'
const FIXED_TS = '2026-07-07T12:00:00.000Z'
const SESSION_ID = 'send-stream-session'
const route = { conversation_id: SEEDED_ROW.id, epoch: 'send-stream-epoch' }

const fact = (id: number, kind: string, text: string, active = false): ThreadItem => ({
  id, order: id * 10, rev: 1, kind, status: active ? 'running' : 'finished', active,
  shown: true, summary: '', session: SESSION_ID, content: { text, ts: FIXED_TS }
})
const frame = (update: ThreadUpdate): Uint8Array =>
  encodeEnvelope({ id: 100 + update.payload.version, ts: FIXED_TS, ...update })

test('send a message and see the streamed daemon reply render in the thread', async ({
  launchPairedApp
}) => {
  const requests: Envelope[] = []
  const sends: SendMessagePayload[] = []
  const heldReplyFrames: Uint8Array[] = []
  const thread = createCanonicalThread({ conversations: [{
    summary: { ...SEEDED_ROW, current_session_id: SESSION_ID },
    epoch: route.epoch, version: 1, items: [fact(1, 'assistant_message', OPENING_TEXT)]
  }] })

  // The real daemon rejects a send to any conversation other than the opened row (#448).
  // Only this arm can author the successful reply; default/echoed commands cannot satisfy it.
  const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
    const envelope = decodeEnvelope(inbound)
    requests.push(envelope)
    switch (envelope.type) {
      case 'send_message': {
        const payload = envelope.payload as SendMessagePayload
        sends.push(payload)
        if (payload.conversation_id !== SEEDED_ROW.id) return []
        heldReplyFrames.push(frame({ type: 'thread_item_added', payload: {
          ...route, version: 2, item: fact(3, 'assistant_message', REPLY_TEXT, true)
        } }))
        return []
      }
      default:
        return []
    }
  }
  const { page, daemon } = await launchPairedApp({ threadMode: 'canonical', thread,
    helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames })

  // Rendered authored content establishes that the actual opening query has been processed.
  await expect(page.getByText(OPENING_TEXT, { exact: true })).toBeVisible()
  expect(requests.find(request => request.type === 'thread_catch_up')).toMatchObject({
    payload: { conversation_id: SEEDED_ROW.id, version: 0 }
  })
  const identity = await page.evaluate(() => window.pyry.deviceIdentity())
  if (!identity.ok) throw new Error('Public device identity unavailable')

  // Keep the trusted composer interactions and their order. All authored responses remain held.
  const sendButton = page.getByRole('button', { name: 'Send' })
  await page.getByPlaceholder('Message…').fill(TYPED_TEXT)
  await sendButton.click()
  const user = page.locator('[data-thread-role="user"]')
  const acceptedUser = page.locator('[data-read-row] [data-thread-role="user"]')
  await expect(user).toHaveCount(1)
  await expect(user).toHaveText(bubbleTextExactly(TYPED_TEXT))
  await expect(acceptedUser).toHaveCount(0)

  // Daemon command receipt alone leaves the optimistic row local and pending.
  await expect.poll(() => sends.length).toBe(1)
  const sent = sends[0]
  expect(sent).toMatchObject({ conversation_id: SEEDED_ROW.id, text: TYPED_TEXT })
  expect(sent.message_id).toMatch(/\S+/)
  await expect(user).toHaveCount(1)
  await expect(acceptedUser).toHaveCount(0)

  for (const reply of heldReplyFrames) daemon.pushFrame(reply)
  const assistant = page.locator('[data-read-row="3"] [data-thread-role="assistant"]')
  await expect(assistant.locator('.bubble__markdown')).toHaveText(REPLY_TEXT, {
    timeout: MESSAGE_TIMEOUT_MS
  })
  await expect(assistant.locator('.bubble__cursor')).toHaveCount(1)
  // The rendered active reply is a positive processing barrier, never evidence of user acceptance.
  await expect(user).toHaveCount(1)
  await expect(user).toHaveText(bubbleTextExactly(TYPED_TEXT))
  await expect(acceptedUser).toHaveCount(0)

  daemon.pushFrame(frame({ type: 'thread_item_added', payload: { ...route, version: 3,
    item: { ...fact(2, 'user_message', sent.text), status: 'delivered', content: {
      text: sent.text, ts: FIXED_TS, device_id: identity.deviceId, message_id: sent.message_id
    } }
  } }))
  await expect(page.locator('[data-read-row="2"] [data-thread-role="user"]')).toHaveText(
    bubbleTextExactly(TYPED_TEXT)
  )
  await expect(acceptedUser).toHaveCount(1)
  await expect(user).toHaveCount(1)

  daemon.pushFrame(frame({ type: 'thread_item_changed', payload: { ...route, version: 4,
    item_id: 3, base_rev: 1, rev: 2, changes: { active: false, status: 'finished' }
  } }))
  // Exact whole-bubble matching retains the default-echo oracle and excludes the streaming cursor.
  await expect(assistant).toHaveText(bubbleTextExactly(REPLY_TEXT), { timeout: MESSAGE_TIMEOUT_MS })
  await expect(assistant.locator('.bubble__cursor')).toHaveCount(0)
  await expect(user).toHaveCount(1)
})
