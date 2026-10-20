import { expect } from '@playwright/test'
import type { ChatHistoryRequest, ChatHistoryResult } from '../../src/shared/chatHistory'

// Publication and dispatch do not establish durability. Only repeat read-only
// pending observations, with one deadline and the successful numeric value retained.
export async function readHistoryCoverage(
  read: (request: ChatHistoryRequest) => Promise<ChatHistoryResult>, host: string, conversation: string, before?: number
): Promise<number> {
  let start: number | undefined
  let status = 'unexpected-result'
  await expect.poll(async () => {
    let result: ChatHistoryResult
    // A full protected transcript read grows with every page and blocks main's
    // receipt/write queue. The selected page authenticates coverage without it.
    try { result = await read({ operation: 'newestThreadPage', serverId: host, conversationId: conversation, limit: 1 }) }
    catch { status = 'read-failed'; return status }
    if (result.status === 'missing') return 'missing'
    if (result.status === 'error') { status = result.code; return status }
    const snapshot = result.status === 'stored' && result.snapshot.kind === 'daemon-items' ? result.snapshot : undefined
    const thread = result.status === 'page' ? result.page.metadata : snapshot?.thread
    if (thread === undefined) {
      status = 'unexpected-result'; return status
    }
    if (thread.hostId !== host || thread.conversationId !== conversation ||
      snapshot !== undefined && (snapshot.serverId !== host || snapshot.conversationId !== conversation)) {
      status = 'wrong-owner'; return status
    }
    // The newest anchor certifies progress of this window, even if the selected
    // item's evidence also contains an older, disconnected protected range.
    const candidate = result.status === 'page' ? result.page.ranges.at(-1)?.start : snapshot?.thread.ranges[0]?.start
    if (candidate === undefined) return 'empty-ranges'
    if (before !== undefined && candidate >= before) return 'no-progress'
    start = candidate
    return 'covered'
  }, { timeout: 5_000 }).not.toMatch(/^(unreadable|missing|empty-ranges|no-progress)$/)
  if (start === undefined) throw new Error(`History coverage: ${status}`)
  return start
}
