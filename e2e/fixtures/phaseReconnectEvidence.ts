import type { Page } from '@playwright/test'
import type { WireTurnState } from '../../src/shared/wire/types'

type Snapshot = {
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
    let conversationId = ''
    const phases: Snapshot['phases'] = []
    const turnIds = new Set<string>()
    const endedTurnIds = new Set<string>()
    const stop = window.pyry.onDaemonEvent(event => {
      if (event.type === 'connected') connections += 1
      if (event.type === 'conversationCreated') conversationId = event.conversation.id
      if (event.type === 'turnState') {
        phases.push({ conversationId: event.conversationId, state: event.state, connection: connections })
      }
      if (event.type === 'toolUse' || event.type === 'assistantDelta') turnIds.add(event.turnId)
      if (event.type === 'turnEnd') endedTurnIds.add(event.turnId)
    })
    ;(window as EvidenceWindow).phaseReconnectEvidence = {
      snapshot: () => ({ connections, conversationId, phases: [...phases],
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
