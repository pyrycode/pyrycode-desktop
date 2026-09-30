import { test, expect, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { SessionSettingsPayload } from '../src/shared/wire/types'

// Fake-stack UI e2e for #1655 — a session whose `session_settings` reply says it has no slash commands, no
// MCP status and no context-usage breakdown (a Codex session) is offered none of the three surfaces. The
// flag-true and flag-absent arms are today's behaviour, pinned by composer-actions.spec.ts,
// channel-mcp-servers.spec.ts and composer-context-breakdown.spec.ts; the per-flag cases are unit-tested.
//
// Every frame is one production produces; nothing secret is sent or echoed.

const ROUNDTRIP_TIMEOUT_MS = 15_000
const REPLY_ENVELOPE_ID = 1

function sessionSettingsFrame(inReplyTo: number): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'session_settings',
    ts: '2026-09-25T12:00:00.000Z',
    in_reply_to: inReplyTo,
    payload: {
      session_id: 'session-1655',
      model: 'seeded-model',
      effort: 'low',
      yolo: false,
      permission_mode: 'default',
      used_tokens: 50_000,
      window_tokens: 200_000,
      capabilities: { slash_commands: false, mcp_servers: false, context_usage_detail: false }
    } satisfies SessionSettingsPayload
  })
}

test('a session without slash commands, MCP status or a context breakdown shows none of them', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp({
    buildReplyFrames: (inbound) => {
      const env = decodeEnvelope(inbound)
      if (env.type === 'list_conversations') return [seedConversationsFrame()]
      if (env.type === 'request_session_settings') return [sessionSettingsFrame(env.id)]
      return []
    }
  })

  // The reading comes from the same reply as the flags, so once it shows, the flags are held too. It still
  // shows, but as a plain reading rather than a breakdown button.
  await expect(page.locator('.composer__context')).toHaveText('Context: 25%', { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(page.locator('.composer__context-trigger')).toHaveCount(0)

  // The Actions menu offers the control row live and both command rows greyed (#1697). `exact` because
  // `More actions` also matches `Actions`. composer-actions-unavailable.spec.ts drives the greyed pick.
  await page.getByRole('button', { name: 'Actions', exact: true }).click()
  const panel = page.getByRole('menu', { name: 'Actions', exact: true })
  await expect(panel.getByRole('menuitem')).toHaveText([
    'Reset session',
    /^Compact session/,
    /^Knowledge capture/
  ])
  await expect(panel.locator('[aria-disabled="true"]')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)

  // Channel info opens without an MCP servers section.
  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: 'Channel info' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('button', { name: 'Close', exact: true })).toBeVisible()
  await expect(sheet.getByText('MCP servers', { exact: true })).toHaveCount(0)
})
