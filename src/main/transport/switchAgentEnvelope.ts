import { encodeEnvelope } from './codec'
import type { Envelope, SwitchAgentPayload } from '../../shared/wire/types'

export interface SwitchAgentInput {
  id: number
  ts: string
  payload: SwitchAgentPayload
}

/** Main-only builder. Rebuild the allowlisted payload without normalizing settings. */
export function buildSwitchAgent(input: SwitchAgentInput): Uint8Array {
  const payload: SwitchAgentPayload = {
    conversation_id: input.payload.conversation_id,
    agent: input.payload.agent,
    model: input.payload.model
  }
  if (input.payload.effort !== undefined) payload.effort = input.payload.effort
  const envelope: Envelope = { id: input.id, type: 'switch_agent', ts: input.ts, payload }
  return encodeEnvelope(envelope)
}
