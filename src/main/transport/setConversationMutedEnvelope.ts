// The `set_conversation_muted` builder (#1595): it serializes the outbound write that mutes or unmutes
// one conversation's notifications on its host. A sibling to setSystemPromptEnvelope.ts, following the
// module's one-concern-per-file split.
//
// No emptiness check and no normalisation: keeping an unroutable id off the wire is the routing lookup
// at the IPC arm, and the fresh literal that bounds the field set lives in the connection method
// (createDaemonConnection.setConversationMuted).
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through a renderer barrel.
import { encodeEnvelope } from './codec'
import type { Envelope, SetConversationMutedPayload } from '../../shared/wire/types'

/** Inputs the consumer supplies — kept explicit so the builder is pure, exactly like buildSetSystemPrompt. */
export interface SetConversationMutedInput {
  /** The Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock). */
  ts: string
  /** The payload, serialized verbatim. */
  payload: SetConversationMutedPayload
}

/**
 * Build the `set_conversation_muted` early-data bytes. MAY throw WireEncodeError when the serialized
 * envelope exceeds MAX_PLAINTEXT_BYTES; the sole caller catches it and reports a rejection.
 */
export function buildSetConversationMuted(input: SetConversationMutedInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'set_conversation_muted',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
