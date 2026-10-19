import { encodeEnvelope } from './codec'
import type { SetConversationPinnedPayload } from '../../shared/wire/types'

export interface SetConversationPinnedInput {
  id: number
  ts: string
  payload: SetConversationPinnedPayload
}

/** Main-only pure builder; the connection owns admission and encode/send failure handling. */
export function buildSetConversationPinned(input: SetConversationPinnedInput): Uint8Array {
  return encodeEnvelope({ id: input.id, type: 'set_conversation_pinned', ts: input.ts, payload: input.payload })
}
