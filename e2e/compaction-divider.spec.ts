import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type { EnvelopeType } from '../src/shared/wire/types'

const other = { ...SEEDED_ROW, id: 'compaction-other', name: 'Other compaction discussion' }
let frameId = 100
const frame = (type: EnvelopeType, payload: unknown, in_reply_to?: number) => encodeEnvelope({
  id: ++frameId, type, ts: `2026-09-11T12:00:00.${frameId}Z`, payload, in_reply_to
})
const edge = (active: boolean, conversation_id = SEEDED_ROW.id, report = {}) =>
  frame('compacting', { conversation_id, active, ...report })
const boundary = (trigger: string, pre_tokens: number | null, post_tokens: number | null, conversation_id = SEEDED_ROW.id) =>
  frame('compaction_boundary', { conversation_id, trigger, pre_tokens, post_tokens })

function fake() {
  let includeOther = false
  return {
    includeOther: () => { includeOther = true },
    buildReplyFrames: (bytes: Uint8Array): Uint8Array[] => {
      const env = decodeEnvelope(bytes)
      if (env.type === 'list_conversations') {
        return [frame('conversations', { conversations: includeOther ? [SEEDED_ROW, other] : [SEEDED_ROW] })]
      }
      if (env.type === 'request_history') {
        return [frame('history_page', { entries: [], cursor: '', at_start: true }, env.id)]
      }
      return []
    }
  }
}

test('automatic, manual and failed compactions arrive as permanent styled rows', async ({ launchPairedApp }) => {
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: fake().buildReplyFrames })
  const rows = page.locator('.compaction-delimiter')
  await expect(rows).toHaveCount(0)
  daemon.pushFrame(edge(true))
  await expect(page.locator('.composer-status__label')).toContainText('Compacting')
  daemon.pushFrame(edge(false))
  await expect(rows).toHaveText(['Conversation compacted'])
  daemon.pushFrame(frame('assistant_delta', { conversation_id: SEEDED_ROW.id, turn_id: 'after', seq: 1, text: 'Message after compaction' }))
  await expect(page.locator('[data-thread-role="assistant"]').filter({ hasText: 'Message after compaction' })).toBeVisible()
  daemon.pushFrame(boundary('auto', 180000, 40000))
  await expect(rows).toHaveText(['Conversation compacted, 180k → 40k tokens'])
  expect(await rows.first().evaluate(row => Boolean(row.compareDocumentPosition(
    document.querySelector('[data-thread-role="assistant"]')!
  ) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)

  daemon.pushFrame(edge(true))
  daemon.pushFrame(edge(false, SEEDED_ROW.id, { compact_result: 'success', compact_error: '' }))
  await expect(rows).toHaveText(['Conversation compacted, 180k → 40k tokens', 'Conversation compacted'])
  daemon.pushFrame(boundary('manual', 1001, 0))
  await expect(rows.nth(1)).toHaveText('Conversation compacted, 1k → 0 tokens by you')

  daemon.pushFrame(edge(true))
  daemon.pushFrame(edge(false, SEEDED_ROW.id, { compact_result: 'failed', compact_error: '<script>private-error</script>' }))
  await expect(rows.nth(2)).toHaveText('Compaction failed')
  await expect(rows.nth(2)).toHaveClass(/compaction-delimiter--failed/)
  const errorColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-error').trim())
  expect(await rows.nth(2).locator('p').evaluate((el, color) => {
    const probe = document.createElement('span')
    probe.style.color = color
    document.body.append(probe)
    const expected = getComputedStyle(probe).color
    probe.remove()
    return getComputedStyle(el).color === expected
  }, errorColor)).toBe(true)

  // No pending successful completion remains: this boundary must draw its own row.
  daemon.pushFrame(boundary('unknown-trigger', null, 40000))
  await expect(rows).toHaveCount(4)
  await expect(rows.nth(3)).toHaveText('Conversation compacted')
  await expect(page.locator('.conversation__thread')).not.toContainText('private-error')
  await expect(page.locator('.conversation__thread')).not.toContainText('unknown-trigger')
  const rules = await rows.first().locator('.session-delimiter__rule').evaluateAll(elements =>
    elements.map(el => ({ width: el.getBoundingClientRect().width, shadow: getComputedStyle(el).boxShadow })))
  expect(rules[0].width).toBeCloseTo(rules[1].width, 1)
  expect(rules[0].shadow).not.toBe('none')
  await expect(rows.first().locator('p')).toHaveCSS('font-size', '12px')
  await page.screenshot({ path: '/tmp/1240-compaction-dividers.png' })
})

test('conversation isolation, scrolling, navigation and real reconnect retain received dividers', async ({ launchPairedApp }) => {
  const server = fake()
  const { page, daemon, forwarder } = await launchPairedApp({
    buildReplyFrames: server.buildReplyFrames,
    reconnectResendFrames: [frame('assistant_delta', {
      conversation_id: SEEDED_ROW.id, turn_id: 'reconnected', seq: 1, text: 'Fresh handshake completed'
    })]
  })
  server.includeOther()
  daemon.pushFrame(frame('conversations', { conversations: [SEEDED_ROW, other] }))
  const rows = page.locator('.compaction-delimiter')
  const open = async (name: string) => page.locator('.channel-list__row-open').filter({ hasText: name }).click()
  daemon.pushFrame(edge(true))
  daemon.pushFrame(edge(false))
  await expect(rows).toHaveText(['Conversation compacted'])
  // B has never received status edges: the boundary alone must create its divider.
  daemon.pushFrame(boundary('manual', 24000, 12000, other.id))
  await open(other.name)
  await expect(rows).toHaveText(['Conversation compacted, 24k → 12k tokens by you'])
  // Delayed metadata for A must enrich A while B is on screen.
  daemon.pushFrame(boundary('auto', 180000, 40000))
  daemon.pushFrame(boundary('auto', 3000, 2000, other.id))
  await expect(rows).toHaveCount(2)
  await open(SEEDED_ROW.name)
  await expect(rows).toHaveText(['Conversation compacted, 180k → 40k tokens'])

  for (let i = 0; i < 25; i++) daemon.pushFrame(frame('assistant_delta', {
    conversation_id: SEEDED_ROW.id, turn_id: `scroll-${i}`, seq: 1, text: `Retained thread message ${i}`
  }))
  await expect(page.locator('[data-thread-role="assistant"]').last()).toContainText('Retained thread message 24')
  const thread = page.locator('.conversation__thread')
  await thread.evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect.poll(() => thread.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  await thread.evaluate(el => { el.scrollTop = 0 })
  await expect(rows.first()).toBeInViewport()
  await open(other.name)
  await expect(rows).toHaveCount(2)
  await open(SEEDED_ROW.name)
  await expect(rows).toHaveText(['Conversation compacted, 180k → 40k tokens'])

  // Leave a rising edge live, then force a new Noise handshake through the real supervisor.
  daemon.pushFrame(edge(true))
  await expect(page.locator('.composer-status__label')).toContainText('Compacting')
  forwarder.dropClientLeg()
  await expect(page.locator('[data-thread-role="assistant"]').last()).toContainText('Fresh handshake completed', { timeout: 15000 })
  await expect(page.locator('.composer-status__label').filter({ hasText: 'Compacting' })).toHaveCount(0)
  daemon.pushFrame(edge(false))
  // The new boundary is a positive delivery barrier after the repeated false frame.
  daemon.pushFrame(boundary('manual', 0, 0))
  await expect(rows).toHaveText(['Conversation compacted, 180k → 40k tokens', 'Conversation compacted, 0 → 0 tokens by you'])
  await open(other.name)
  await expect(rows).toHaveText(['Conversation compacted, 24k → 12k tokens by you', 'Conversation compacted, 3k → 2k tokens'])
})
