import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { EnvelopeType, ToolDeniedPayload } from '../src/shared/wire/types'

const turnId = 'denial-turn'
const frame = (type: EnvelopeType, payload: unknown) => encodeEnvelope({
  id: 1, type, ts: '2026-09-11T12:00:00Z', payload
})
const denial = (toolUseId: string, source: string): ToolDeniedPayload => ({
  conversation_id: SEEDED_ROW.id,
  turn_id: turnId,
  tool_use_id: toolUseId,
  tool_name: 'Bash',
  decision_reason_type: source,
  decision_reason: source === 'classifier' ? 'Command requires review' : 'Matched session deny rule',
  message: 'Permission has not been granted',
  truncated_fields: null,
  dropped_fields: null
})

test('denials arrive through IPC, expand before results, and stop naming pending work', async ({ launchPairedApp }) => {
  const { page, daemon } = await launchPairedApp()
  daemon.pushFrame(frame('turn_state', { conversation_id: SEEDED_ROW.id, state: 'responding' }))
  for (const [id, name] of [['rule-call', 'Read'], ['classifier-call', 'Bash']]) {
    daemon.pushFrame(frame('tool_use', {
      conversation_id: SEEDED_ROW.id, turn_id: turnId, tool_use_id: id,
      name, input_summary: id
    }))
  }
  await page.locator('.tool-run button').click()
  const label = page.locator('.composer-status__label')
  await expect(label).toHaveText('Running Bash…')
  const classifier = page.locator('.tool-row:not(.tool-run__row)').filter({ hasText: 'classifier-call' })
  const rule = page.locator('.tool-row:not(.tool-run__row)').filter({ hasText: 'rule-call' })

  // The foreign marker must not mark this conversation's identically named call.
  daemon.pushFrame(frame('tool_denied', { ...denial('classifier-call', 'rule'), conversation_id: 'other-conversation' }))
  daemon.pushFrame(frame('tool_denied', denial('classifier-call', 'classifier')))
  await expect(classifier.locator('.tool-row__denied-tag')).toHaveText('Denied')
  const tag = classifier.locator('.tool-row__denied-tag')
  await expect(tag).toHaveCSS('font-size', '14px')
  await expect(tag).toHaveCSS('line-height', '20px')
  await expect(tag).toHaveCSS('letter-spacing', '0.25px')
  await expect(tag).toHaveCSS('font-weight', '400')
  await expect(label).toHaveText('Running Read…')
  await classifier.getByRole('button').click()
  await expect(classifier.locator('.tool-row__denial')).toHaveText('Denied by the auto classifier: Command requires review')
  await expect(classifier.locator('.tool-row__result')).toHaveText('Permission has not been granted')
  await expect(classifier).not.toHaveClass(/tool-row--error/)

  daemon.pushFrame(frame('tool_result', {
    conversation_id: SEEDED_ROW.id, turn_id: turnId, tool_use_id: 'classifier-call',
    is_error: true, result_summary: 'Actual classifier result'
  }))
  await expect(classifier.locator('.tool-row__result')).toHaveText('Actual classifier result')
  await expect(classifier.locator('.tool-row__denial')).toBeVisible()

  daemon.pushFrame(frame('tool_denied', denial('rule-call', 'rule')))
  await expect(rule.locator('.tool-row__denied-tag')).toHaveText('Denied')
  await expect(label).toHaveText('Working…')
  await rule.getByRole('button').click()
  await expect(rule.locator('.tool-row__denial')).toHaveText('Denied by a permission rule: Matched session deny rule')
  await expect(rule.locator('.tool-row__result')).toHaveText('Permission has not been granted')
  await expect(rule).not.toHaveClass(/tool-row--error/)
  await page.screenshot({ path: '/tmp/1238-tool-denied.png' })
})
