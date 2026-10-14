import type { DaemonEvent } from '../../src/shared/ipc/events'
import type { RendererCommand } from '../../src/shared/ipc/commands'
import { expect } from '@playwright/test'

export type EffortReading = Pick<Extract<DaemonEvent, { type: 'runConfigReceived' }>,
  'conversationId' | 'sessionId' | 'model' | 'effort' | 'effectiveEffort'>
export type EffortEvidence =
  | Extract<RendererCommand, { type: 'requestSessionSettings' | 'setSessionSettings' }>
  | Extract<DaemonEvent, { type: 'sessionSettingsUpdated' }>
  | ({ type: 'runConfigReceived' } & EffortReading)
  | { type: 'conversationCreated'; conversationId: string }
export type EffortIntent = { conversationId?: string; created?: boolean; effort?: string; effectiveEffort?: string | null; confirmed?: boolean }

export function selectEffortProof(events: EffortEvidence[], after: number, intent: EffortIntent, footer: string): EffortReading | null {
  const fresh = events.slice(after)
  const createdIndex = intent.created ? fresh.findLastIndex(event => event.type === 'conversationCreated') : -1
  const created = fresh[createdIndex]
  if (intent.created && created?.type !== 'conversationCreated') return null
  const intendedId = created?.type === 'conversationCreated' ? created.conversationId : intent.conversationId
  const requestIndex = fresh.findLastIndex(event => event.type === 'requestSessionSettings' &&
    (intendedId === undefined || event.payload.conversation_id === intendedId))
  const request = fresh[requestIndex]
  if (request?.type !== 'requestSessionSettings') return null
  const conversationId = request.payload.conversation_id
  if (intent.conversationId !== undefined && intent.conversationId !== conversationId) return null
  const readingIndex = fresh.findLastIndex(event => event.type === 'runConfigReceived' && event.conversationId === conversationId)
  const reading = fresh[readingIndex]
  if (reading?.type !== 'runConfigReceived' || readingIndex <= Math.max(requestIndex, createdIndex)) return null
  if (intent.effort !== undefined && reading.effort !== intent.effort) return null
  if ('effectiveEffort' in intent && reading.effectiveEffort !== intent.effectiveEffort) return null
  if (intent.confirmed) {
    const writeIndex = fresh.findLastIndex(event => event.type === 'setSessionSettings' &&
      event.payload.session_id === reading.sessionId && event.payload.effort !== undefined)
    const write = fresh[writeIndex]
    if (write?.type !== 'setSessionSettings' || write.payload.effort !== intent.effort) return null
    const ackIndex = fresh.findLastIndex(event => event.type === 'sessionSettingsUpdated' &&
      event.changeId === write.changeId && event.sessionId === reading.sessionId)
    if (ackIndex <= writeIndex || readingIndex <= ackIndex) return null
  }
  // The latest daemon reading remains the oracle, including saved/applied disagreement.
  const expected = reading.effectiveEffort === null ? 'Effort' : reading.effectiveEffort || reading.effort || 'Effort'
  return footer === expected ? reading : null
}

export async function waitForEffortProof(
  snapshot: () => Promise<{ events: EffortEvidence[]; footer: string }>,
  after: number, intent: EffortIntent, timeout: number
): Promise<EffortReading> {
  let reading: EffortReading | null = null
  await expect.poll(async () => {
    const { events, footer } = await snapshot()
    reading = selectEffortProof(events, after, intent, footer)
    return reading !== null
  }, { timeout }).toBe(true)
  if (reading === null) throw new Error('Effort proof completed without a reading')
  return reading
}
