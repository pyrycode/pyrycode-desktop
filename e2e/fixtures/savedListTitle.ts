import { expect } from '@playwright/test'
import type { ChatHistoryResult } from '../../src/shared/chatHistory'

// Only pending observations repeat: storage failures and unexpected replies stay failures.
export async function readSavedListTitle(
  read: () => Promise<ChatHistoryResult>, host: string, conversation: string
): Promise<string> {
  let title: string | undefined
  let failure = 'unexpected-result'
  await expect.poll(async () => {
    let result: ChatHistoryResult
    try { result = await read() } catch { failure = 'read-failed'; return failure }
    if (result.status === 'missing') return 'missing-list'
    if (result.status === 'error') { failure = result.code; return failure }
    if (result.status !== 'stored' || result.snapshot.kind !== 'list') return failure
    if (result.snapshot.serverId !== host) { failure = 'wrong-host'; return failure }
    const row = result.snapshot.conversations.find(row => row.id === conversation)
    if (row === undefined) return 'absent-row'
    if (row.name === null) return 'unnamed-row'
    title = row.name
    return 'named-row'
  }).not.toMatch(/^(missing-list|absent-row|unnamed-row)$/)
  if (title === undefined) throw new Error(`Saved list title: ${failure}`)
  return title
}
