import type { Page } from '@playwright/test'

const TOGGLE_TARGET = 'pyry_files'
const STATUS_WORD_BOUND = 64

type McpSeen = { reports: string[]; refusals: string[]; toggleRefusals: string[]; targetStatus: (string | null)[] }
type McpProof = McpSeen & { created: string | null; off: () => void }
type DriveWindow = typeof window & { mcpProof: McpProof }

/** Observe before the UI create flow; reports never choose the created-chat identity. */
export async function watchMcp(page: Page): Promise<() => Promise<void>> {
  await page.evaluate(({ target, bound }) => {
    const proof: McpProof = { created: null, reports: [], refusals: [], toggleRefusals: [], targetStatus: [], off: () => {} }
    proof.off = window.pyry.onDaemonEvent((event) => {
      if (event.type === 'conversationCreated') proof.created ??= event.conversation.id
      if (event.type === 'mcpStatus') {
        proof.reports.push(event.conversationId)
        const status = event.servers.find((server) => server.name === target)?.status
        proof.targetStatus.push(status === undefined ? null : Array.from(status).slice(0, bound).join(''))
      }
      if (event.type === 'mcpReconnectRejected') proof.refusals.push(event.conversationId)
      if (event.type === 'mcpToggleRejected') proof.toggleRefusals.push(event.conversationId)
    })
    ;(window as DriveWindow).mcpProof = proof
  }, { target: TOGGLE_TARGET, bound: STATUS_WORD_BOUND })
  return () => page.evaluate(() => { (window as DriveWindow).mcpProof.off() })
}

export function readCreatedChat(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as DriveWindow).mcpProof.created)
}

/** Preserve report/status pairing while excluding all evidence for other chats. */
export function readMcp(page: Page, conversationId: string): Promise<McpSeen> {
  return page.evaluate(id => {
    const { reports, refusals, toggleRefusals, targetStatus } = (window as DriveWindow).mcpProof
    return {
      reports: reports.filter(reportId => reportId === id),
      refusals: refusals.filter(refusedId => refusedId === id),
      toggleRefusals: toggleRefusals.filter(refusedId => refusedId === id),
      targetStatus: targetStatus.filter((_, index) => reports[index] === id)
    }
  }, conversationId)
}

/** Fresh conversation evidence only: reports have no decoded request identity. */
export function mcpOutcome(now: McpSeen, before: McpSeen, action: 'reconnect' | 'toggle'): 'waiting' | 'report' | 'refused' | 'both' {
  const refused = action === 'reconnect'
    ? now.refusals.length > before.refusals.length
    : now.toggleRefusals.length > before.toggleRefusals.length
  const answered = now.reports.length > before.reports.length
  return refused && answered ? 'both' : refused ? 'refused' : answered ? 'report' : 'waiting'
}
