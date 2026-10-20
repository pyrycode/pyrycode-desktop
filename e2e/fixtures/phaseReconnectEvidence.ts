import type { Page } from '@playwright/test'
import type { WireTurnState } from '../../src/shared/wire/types'

type Snapshot = {
  thread: boolean
  interactive: boolean
  connections: number
  conversationId: string
  phases: { conversationId: string; state: WireTurnState; connection: number }[]
  turnIds: string[]
  endedTurnIds: string[]
}
type EvidenceWindow = typeof window & {
  phaseReconnectEvidence: { snapshot: () => Snapshot; stop: () => void }
}

/** Observe delivery through the preload bridge without retaining text, frames or credentials. */
export async function watchPhaseReconnect(page: Page): Promise<void> {
  await page.evaluate(() => {
    let connections = 0
    let thread = false
    let interactive = false
    let conversationId = ''
    const phases: Snapshot['phases'] = []
    const turnIds = new Set<string>()
    const endedTurnIds = new Set<string>()
    const stop = window.pyry.onDaemonEvent(event => {
      if (event.type === 'connected') { connections += 1; thread = event.ack.capabilities.includes('thread'); interactive = event.ack.capabilities.includes('interactive') }
      if (event.type === 'conversationCreated') conversationId = event.conversation.id
      if (event.type === 'turnState') {
        phases.push({ conversationId: event.conversationId, state: event.state, connection: connections })
      }
      if (event.type === 'toolUse' || event.type === 'assistantDelta') turnIds.add(event.turnId)
      if (event.type === 'turnEnd') endedTurnIds.add(event.turnId)
      const supplied = event.type === 'threadReply' && event.reply.type === 'thread_items' ? event.reply.payload.items
        : event.type === 'threadUpdate' && event.update.type === 'thread_item_added' ? [event.update.payload.item] : []
      for (const item of supplied) if (typeof item.turn === 'string' && item.parent === undefined) {
        if (item.kind === 'tool_call' || item.kind === 'assistant_message') turnIds.add(item.turn)
        if (item.kind === 'turn_end') endedTurnIds.add(item.turn)
      }
    }, true)
    ;(window as EvidenceWindow).phaseReconnectEvidence = {
      snapshot: () => ({ thread, interactive, connections, conversationId, phases: [...phases],
        turnIds: [...turnIds], endedTurnIds: [...endedTurnIds] }),
      stop
    }
  })
}

export function readPhaseReconnect(page: Page): Promise<Snapshot> {
  return page.evaluate(() => (window as EvidenceWindow).phaseReconnectEvidence.snapshot())
}

export async function stopPhaseReconnect(page: Page): Promise<void> {
  await page.evaluate(() => (window as EvidenceWindow).phaseReconnectEvidence.stop())
}

/** Self-contained for evaluateAll; return only a boolean, never the observed label. */
export function hasRunningPhaseLabel(elements: { textContent: string | null }[]): boolean {
  return elements.some(element => /^(Thinking…|Working…|Running Bash…)/.test(element.textContent ?? ''))
}
