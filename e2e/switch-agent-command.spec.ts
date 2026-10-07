import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, SwitchAgentPayload } from '../src/shared/wire/types'

test('switchAgent reaches only the conversation owner with exact settings', async ({ launchPairedApp }) => {
  const first: Envelope[] = []
  const second: Envelope[] = []
  const { page } = await launchPairedApp({
    buildReplyFrames: bytes => {
      const request = decodeEnvelope(bytes)
      first.push(request)
      return request.type === 'list_conversations' ? [seedConversationsFrame()] : []
    }
  }, {
    secondServer: {
      buildReplyFrames: bytes => {
        const request = decodeEnvelope(bytes)
        second.push(request)
        return request.type === 'list_conversations' ? [seedConversationsFrame(SECOND_SEEDED_ROW)] : []
      }
    }
  })
  const writes = (log: Envelope[]) => log.filter(e => e.type === 'switch_agent')
  const send = (payload: unknown) => page.evaluate(payload => {
    window.pyry.sendCommand({ type: 'switchAgent', payload })
  }, payload)
  const firstPayloads: SwitchAgentPayload[] = []
  const secondPayloads: SwitchAgentPayload[] = []
  const variants: SwitchAgentPayload[] = [
    { conversation_id: SEEDED_ROW.id, agent: 'codex', model: '' },
    { conversation_id: SECOND_SEEDED_ROW.id, agent: 'claude', model: '  opus  ', effort: ' high ' },
    { conversation_id: SEEDED_ROW.id, agent: 'codex', model: '', effort: '' },
    { conversation_id: SECOND_SEEDED_ROW.id, agent: 'claude', model: '', effort: undefined }
  ]
  for (const payload of variants) {
    await send({ ...payload, extra: 'discard', serverId: 'wrong-host' })
    const expected = { ...payload }
    if (expected.effort === undefined) delete expected.effort
    if (payload.conversation_id === SEEDED_ROW.id) firstPayloads.push(expected)
    else secondPayloads.push(expected)
    await expect.poll(() => writes(first).map(e => e.payload)).toEqual(firstPayloads)
    await expect.poll(() => writes(second).map(e => e.payload)).toEqual(secondPayloads)
  }

  // A later valid send is a processing barrier for preceding unknown/malformed commands.
  await send({ conversation_id: 'unclaimed', agent: 'codex', model: '' })
  const rejection = await page.evaluate(payload => {
    try {
      window.pyry.sendCommand({ type: 'switchAgent', payload })
      return null
    } catch (error) {
      return error instanceof Error ? error.message : null
    }
  }, { conversation_id: SEEDED_ROW.id, agent: 'codex', model: '', effort: null })
  expect(rejection).toBe('Invalid command')
  const barrier: SwitchAgentPayload = { conversation_id: SECOND_SEEDED_ROW.id, agent: 'codex', model: 'gpt-model' }
  await send(barrier)
  secondPayloads.push(barrier)
  await expect.poll(() => writes(second).map(e => e.payload)).toEqual(secondPayloads)
  expect(writes(first).map(e => e.payload)).toEqual(firstPayloads)
  const frames = [...writes(first), ...writes(second)]
  expect(frames).toHaveLength(5)
  for (const envelope of frames) {
    expect(Object.keys(envelope).sort()).toEqual(['id', 'payload', 'ts', 'type'])
    expect(envelope.id).toEqual(expect.any(Number))
    expect(envelope.ts).toEqual(expect.any(String))
  }
})
