import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { ContextUsagePayload, SessionSettingsPayload } from '../src/shared/wire/types'

// Fake-stack UI e2e for #1254 — clicking the footer's context reading opens a read-only breakdown of the
// held `context_usage` reading. What lives HERE is the whole path from a frame off the socket to the
// panel's rows, and the three close paths (outside click, Escape, a second click on the reading), which
// the renderer tier cannot drive. The markup rules (order, "+N more", escaping, path shortening) are
// pinned as values in ContextBreakdownPopover.test.tsx.
//
// Every frame here is one production produces: `session_settings` answers the app's on-open request and
// `context_usage` is the unsolicited turn-end reading. The inventory rows are invented display literals;
// nothing secret is sent or echoed.

const ROUNDTRIP_TIMEOUT_MS = 15_000
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

function sessionSettingsFrame(inReplyTo: number): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'session_settings',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: {
      session_id: 'session-1254',
      model: 'seeded-model',
      effort: 'low',
      yolo: false,
      permission_mode: 'default',
      used_tokens: 50_000,
      window_tokens: 200_000
    } satisfies SessionSettingsPayload
  })
}

type Inventories = Pick<
  ContextUsagePayload,
  | 'categories'
  | 'dropped_categories'
  | 'mcp_tools'
  | 'dropped_mcp_tools'
  | 'memory_files'
  | 'dropped_memory_files'
>

function contextUsageFrame(inventories: Inventories): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'context_usage',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      model: 'reported-model',
      total_tokens: 80_000,
      max_tokens: 200_000,
      percentage: 40,
      ...inventories
    } satisfies ContextUsagePayload
  })
}

const CATEGORIES = [
  { name: 'Messages', tokens: 50_000 },
  { name: 'System prompt', tokens: 12_400 }
]

const FULL: Inventories = {
  categories: CATEGORIES,
  dropped_categories: 2,
  mcp_tools: [
    { name: 'search', server_name: 'docs', tokens: 3_000 },
    { name: 'open', server_name: 'files', tokens: 2_000 },
    { name: 'fetch', server_name: 'docs', tokens: 1_000 }
  ],
  dropped_mcp_tools: 4,
  memory_files: [{ path: '/home/operator/work/project/sub/CLAUDE.md', type: 'Project', tokens: 1_500 }],
  dropped_memory_files: 0
}

const CATEGORIES_ONLY: Inventories = {
  categories: CATEGORIES,
  dropped_categories: 0,
  mcp_tools: [],
  dropped_mcp_tools: 0,
  memory_files: [],
  dropped_memory_files: 0
}

test('context reading: the breakdown popover shows each inventory and closes three ways', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp({
    buildReplyFrames: (inbound) => {
      const env = decodeEnvelope(inbound)
      if (env.type === 'list_conversations') return [seedConversationsFrame()]
      if (env.type === 'request_session_settings') return [sessionSettingsFrame(env.id)]
      return []
    }
  })

  const trigger = page.locator('.composer__context-trigger')
  const panel = page.getByRole('dialog', { name: 'Context breakdown' })
  const reading = page.locator('.composer__context')

  // --- 1. No reading held yet: the footer shows the settings figure and the panel says one is coming. ---
  await expect(reading).toHaveText('Context: 25%', { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.click()
  await expect(panel).toHaveText('A context reading arrives after the next turn.')
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  // Outside click closes. Focus follows the click, the shared options menu's contract.
  await page.mouse.click(5, 5)
  await expect(panel).toHaveCount(0)

  // --- 2. A frame carrying all three inventories. ---
  daemon.pushFrame(contextUsageFrame(FULL))
  await expect(reading).toHaveText('Context: 40%', { timeout: ROUNDTRIP_TIMEOUT_MS })
  await trigger.click()
  await expect(panel.locator('.context-breakdown__header')).toHaveText('reported-model80k of 200k tokens')
  const categoryRows = panel.locator('.context-breakdown__row--category')
  await expect(categoryRows).toHaveText(['Messages · 50k', 'System prompt · 12.4k'])
  await expect(categoryRows.first().locator('.context-breakdown__bar-fill')).toHaveAttribute(
    'style',
    'width: 25%;'
  )
  await expect(panel.locator('.context-breakdown__more')).toHaveText(['+2 more', '+4 more'])

  // Both groups start collapsed; expanding shows the MCP tools grouped by server in held order.
  const mcp = panel.locator('details', { hasText: 'MCP tools' })
  const memory = panel.locator('details', { hasText: 'Memory files' })
  await expect(mcp).not.toHaveAttribute('open', '')
  await mcp.locator('summary').click()
  await expect(mcp.locator('.context-breakdown__server-name')).toHaveText(['docs', 'files'])
  await expect(mcp.locator('.context-breakdown__server').first().locator('.context-breakdown__row')).toHaveText([
    'search · 3k',
    'fetch · 1k'
  ])
  await memory.locator('summary').click()
  await expect(memory.locator('.context-breakdown__row')).toHaveText(['.../work/project/sub/CLAUDE.md · 1.5k'])

  // Escape closes and returns focus to the reading.
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(trigger).toBeFocused()

  // --- 3. A frame carrying only categories: no MCP or memory-file group. ---
  daemon.pushFrame(contextUsageFrame(CATEGORIES_ONLY))
  await trigger.click()
  await expect(panel.locator('.context-breakdown__row--category')).toHaveText([
    'Messages · 50k',
    'System prompt · 12.4k'
  ])
  await expect(panel.locator('details')).toHaveCount(0)
  await expect(panel.locator('.context-breakdown__more')).toHaveCount(0)

  // A second click on the reading closes and keeps focus on it.
  await trigger.click()
  await expect(panel).toHaveCount(0)
  await expect(trigger).toBeFocused()
})
