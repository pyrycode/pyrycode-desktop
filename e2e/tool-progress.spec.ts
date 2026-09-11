import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { EnvelopeType, ToolProgressPayload } from '../src/shared/wire/types'

const frame = (type: EnvelopeType, payload: unknown) => encodeEnvelope({
  id: 1, type, ts: '2026-09-11T12:00:00Z', payload
})
const identity = { conversation_id: SEEDED_ROW.id, turn_id: 'elapsed-turn', tool_use_id: 'elapsed-call' }

test('tool header and working label track only reported elapsed seconds', async ({ launchPairedApp }) => {
  const { page, daemon } = await launchPairedApp()
  await page.clock.install()
  daemon.pushFrame(frame('turn_state', { conversation_id: SEEDED_ROW.id, state: 'responding' }))
  daemon.pushFrame(frame('tool_use', { ...identity, name: 'Bash', input_summary: 'Build the app' }))
  const label = page.locator('.composer-status__label')
  const row = page.locator('.tool-row').filter({ hasText: 'Build the app' })
  const count = row.locator('.tool-row__count')
  await expect(label).toHaveText('Running Bash…')
  await expect(row).toBeVisible()
  await expect(count).toHaveCount(0)

  for (const [seconds, reading] of [[30, '30s'], [60, '1m 00s'], [90, '1m 30s']] as const) {
    daemon.pushFrame(frame('tool_progress', { ...identity, elapsed_seconds: seconds } satisfies ToolProgressPayload))
    await expect(count).toHaveText(reading)
    await expect(label).toHaveText(`Running Bash… ${reading}`)
    await expect(row.getByRole('button')).toHaveCount(0)
    await expect(row.locator('.tool-row__chevron')).toHaveCount(0)
  }
  // Advance the renderer clock beyond a heartbeat interval without delivering a frame.
  await page.clock.fastForward(35_000)
  await expect(count).toHaveText('1m 30s')
  await expect(label).toHaveText('Running Bash… 1m 30s')
  await expect(count).toHaveCSS('font-size', '14px')
  await expect(count).toHaveCSS('line-height', '20px')
  await expect(label).toHaveCSS('text-overflow', 'ellipsis')
  await page.screenshot({ path: '/tmp/1244-tool-progress.png' })

  daemon.pushFrame(frame('tool_result', { ...identity, is_error: false, result_summary: 'Build completed' }))
  await expect(row).toHaveClass(/tool-row--resolved/)
  await expect(label).toHaveText('Working…')
  await expect(count).toHaveCount(0)
  await row.getByRole('button').click()
  await expect(row.locator('.tool-row__result')).toHaveText('Build completed')
  await expect(row).not.toContainText('1m 30s')
})
