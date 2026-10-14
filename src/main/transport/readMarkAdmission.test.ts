import { expect, it } from 'vitest'
import { decodeEnvelope, encodeEnvelope } from './codec'
import { parseInboundMessage } from './inboundMessage'
import { isRendererCommand } from '../../shared/ipc/commands'

it('admits only non-negative safe durable IDs independently of connection/replay IDs', () => {
  for (const id of [0, 12, Number.MAX_SAFE_INTEGER]) {
    const bytes = encodeEnvelope({ id: 90, event_id: 700, type: 'assistant_delta', ts: 'now',
      history_entry_id: id, payload: { conversation_id: 'c', turn_id: 't', seq: 0, text: 'safe' } })
    expect(decodeEnvelope(bytes).history_entry_id).toBe(id)
    expect(parseInboundMessage(bytes)).toMatchObject({ historyEntryId: id })
  }
  for (const id of [null, -1, 0.5, '1', true, Number.MAX_SAFE_INTEGER + 1]) {
    const bytes = new TextEncoder().encode(JSON.stringify({ id: 90, type: 'message', ts: 'now', payload: {}, history_entry_id: id }))
    expect(() => decodeEnvelope(bytes)).toThrow()
  }
})

it('requires a host-bound exact read command payload, including zero', () => {
  const command = (up_to: unknown) => ({ type: 'markConversationRead', serverId: 'a', payload: { conversation_id: 'c', up_to } })
  expect(isRendererCommand(command(0))).toBe(true)
  expect(isRendererCommand(command(12))).toBe(true)
  for (const id of [undefined, null, -1, 0.5, '1', true, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(isRendererCommand(command(id))).toBe(false)
  }
  expect(isRendererCommand({ ...command(1), serverId: undefined })).toBe(false)
  expect(isRendererCommand({ ...command(1), serverId: '' })).toBe(false)
  expect(isRendererCommand({ ...command(1), payload: { conversation_id: 'c', up_to: 1, extra: 1 } })).toBe(false)
})
