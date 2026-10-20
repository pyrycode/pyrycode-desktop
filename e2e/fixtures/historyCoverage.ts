import { expect } from '@playwright/test'
import type { ChatHistoryResult } from '../../src/shared/chatHistory'

// Publication and dispatch do not establish durability. Only repeat read-only
// pending observations, with one deadline and the successful numeric value retained.
export async function readHistoryCoverage(
  read: () => Promise<ChatHistoryResult>, host: string, conversation: string, before?: number
): Promise<number> {
  let start: number | undefined
  let status = 'unexpected-result'
  await expect.poll(async () => {
    let result: ChatHistoryResult
    try { result = await read() } catch { status = 'read-failed'; return status }
    if (result.status === 'missing') return 'missing'
    if (result.status === 'error') { status = result.code; return status }
    if (result.status !== 'stored' || result.snapshot.kind !== 'daemon-items') {
      status = 'unexpected-result'; return status
    }
    const snapshot = result.snapshot, thread = snapshot.thread
    if (snapshot.serverId !== host || snapshot.conversationId !== conversation ||
      thread.hostId !== host || thread.conversationId !== conversation) {
      status = 'wrong-owner'; return status
    }
    const candidate = thread.ranges[0]?.start
    if (candidate === undefined) return 'empty-ranges'
    if (before !== undefined && candidate >= before) return 'no-progress'
    start = candidate
    return 'covered'
  }, { timeout: 5_000 }).not.toMatch(/^(unreadable|missing|empty-ranges|no-progress)$/)
  if (start === undefined) throw new Error(`History coverage: ${status}`)
  return start
}
