import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type { EnvelopeType } from '../src/shared/wire/types'
import type { Page } from '@playwright/test'

const OTHER = { ...SEEDED_ROW, id: 'resolution-other', name: 'Other resolution discussion' }
const frame = (type: EnvelopeType, payload: unknown) => encodeEnvelope({
  id: 1, type, ts: '2026-07-07T12:00:00.000Z', payload
})
const shown = (id: string, conversation = SEEDED_ROW.id) => frame('modal_shown', {
  conversation_id: conversation, modal_id: id, class: 'permission', title: 'Synthetic request',
  prompt: 'Allow reading a file?', options: [{ id: 'deny', label: 'Deny' }, { id: 'allow', label: 'Allow' }],
  default_option_id: 'deny'
})
const dismissed = (id: string, source: 'remote' | 'timeout') => frame('modal_dismissed', {
  modal_id: id, source, outcome: 'DAEMON_OUTCOME_SENTINEL'
})
const notice = (page: Page) => page.getByRole('button', { name: 'Dismiss permission resolution notice', exact: true })
const pill = (page: Page) => page.locator('.top-overlay-pill').filter({ has: notice(page) })
const open = async (page: Page, name: string) => {
  const row = page.locator('.channel-list__row-open').filter({ hasText: name })
  await row.click()
  await expect(row).toHaveAttribute('aria-current', 'true')
}
const freezeTime = async (page: Page) => {
  const instant = new Date('2026-10-01T12:00:00Z')
  await page.clock.install({ time: instant })
  await page.clock.pauseAt(instant)
}

// Only synthetic frames and DOM are inspected; no pairing material or answer tokens are serialized.
test('remote and timeout resolutions use the Default pill, X and four seconds from display', async ({ launchPairedApp }) => {
  const { page, daemon, app } = await launchPairedApp({})
  await freezeTime(page)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
  for (const [source, copy] of [['remote', 'Resolved on another device'], ['timeout', 'Request timed out']] as const) {
    daemon.pushFrame(shown(source))
    await expect(page.locator('.permission-panel')).toBeVisible()
    daemon.pushFrame(dismissed(source, source))
    await expect(pill(page)).toHaveText(copy)
    await expect(pill(page)).toHaveClass('top-overlay-pill top-overlay-pill--default')
    await expect(pill(page)).not.toContainText('SENTINEL')
    if (source === 'timeout') {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600))
    }
    await page.screenshot({ path: `/tmp/builder-1696/${source}.png`, animations: 'disabled' })
    await page.clock.runFor(3999)
    await expect(notice(page)).toBeVisible()
    await page.clock.runFor(1)
    await expect(notice(page)).toHaveCount(0)
  }
  daemon.pushFrame(shown('dismiss-by-x'))
  await expect(page.locator('.permission-panel')).toBeVisible()
  daemon.pushFrame(dismissed('dismiss-by-x', 'remote'))
  await expect(pill(page)).toHaveText('Resolved on another device')
  await notice(page).click()
  await expect(notice(page)).toHaveCount(0)
  // A duplicate cannot redisplay the consumed resolution.
  daemon.pushFrame(dismissed('dismiss-by-x', 'timeout'))
  daemon.pushFrame(shown('local-cancel'))
  await expect(page.locator('.permission-panel')).toBeVisible()
  await expect(notice(page)).toHaveCount(0)
  await page.locator('.permission-panel').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('.permission-panel')).toHaveCount(0)
  daemon.pushFrame(dismissed('local-cancel', 'remote'))
  daemon.pushFrame(shown('local-answer'))
  await expect(page.locator('.permission-panel')).toBeVisible()
  await expect(notice(page)).toHaveCount(0)
  await page.locator('.permission-panel').getByRole('button', { name: 'Deny', exact: true }).press('Space')
  await expect(page.locator('.permission-panel')).toHaveCount(0)
  daemon.pushFrame(dismissed('local-answer', 'timeout'))
  // Positive frame delivery after the local dismissal prevents a premature absence pass.
  daemon.pushFrame(frame('assistant_delta', { conversation_id: SEEDED_ROW.id, turn_id: 'barrier', seq: 1, text: 'Local answer acknowledged' }))
  await expect(page.locator('[data-thread-role="assistant"]').last()).toContainText('Local answer acknowledged')
  await expect(notice(page)).toHaveCount(0)
})

test('closed chats retain only the latest unseen notice; leaving consumes only displayed feedback', async ({ launchPairedApp }) => {
  const conversations = [SEEDED_ROW]
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
    const env = decodeEnvelope(bytes)
    return env.type === 'list_conversations' ? [frame('conversations', { conversations })] : []
  } })
  await freezeTime(page)
  conversations.push(OTHER)
  daemon.pushFrame(frame('conversations', { conversations }))
  await expect(page.locator('.channel-list__row-open').filter({ hasText: OTHER.name })).toBeVisible()
  daemon.pushFrame(shown('closed-old', OTHER.id))
  daemon.pushFrame(dismissed('closed-old', 'remote'))
  daemon.pushFrame(shown('closed-new', OTHER.id))
  daemon.pushFrame(dismissed('closed-new', 'timeout'))
  daemon.pushFrame(shown('open-feedback'))
  await expect(page.locator('.permission-panel')).toBeVisible()
  await expect(notice(page)).toHaveCount(0)
  daemon.pushFrame(dismissed('open-feedback', 'remote'))
  await expect(pill(page)).toHaveText('Resolved on another device')
  await page.clock.runFor(5000)
  await expect(notice(page)).toHaveCount(0)
  await open(page, OTHER.name)
  await expect(pill(page)).toHaveText('Request timed out')
  await page.clock.runFor(3999)
  await expect(notice(page)).toBeVisible()
  await page.clock.runFor(1)
  await expect(notice(page)).toHaveCount(0)

  daemon.pushFrame(shown('leave-feedback', OTHER.id))
  await expect(page.locator('.permission-panel')).toBeVisible()
  daemon.pushFrame(dismissed('leave-feedback', 'remote'))
  await expect(pill(page)).toHaveText('Resolved on another device')
  daemon.pushFrame(shown('pending-on-first'))
  daemon.pushFrame(dismissed('pending-on-first', 'timeout'))
  await open(page, SEEDED_ROW.name ?? '')
  await expect(pill(page)).toHaveText('Request timed out')
  await open(page, OTHER.name)
  await expect(notice(page)).toHaveCount(0)
  await open(page, SEEDED_ROW.name ?? '')
  await expect(notice(page)).toHaveCount(0)
})

test('replacement starts a fresh display deadline and the replaced timer cannot expire it', async ({ launchPairedApp }) => {
  const { page, daemon } = await launchPairedApp({})
  await freezeTime(page)
  for (const [index, sources] of ([['remote', 'timeout'], ['timeout', 'timeout']] as const).entries()) {
    const [initialSource, replacementSource] = sources
    daemon.pushFrame(shown(`first-${index}`))
    await expect(page.locator('.permission-panel')).toBeVisible()
    daemon.pushFrame(dismissed(`first-${index}`, initialSource))
    await expect(pill(page)).toHaveText(initialSource === 'remote' ? 'Resolved on another device' : 'Request timed out')
    await page.clock.runFor(2000)
    daemon.pushFrame(shown(`second-${index}`))
    await expect(page.locator('.permission-panel')).toBeVisible()
    daemon.pushFrame(dismissed(`second-${index}`, replacementSource))
    // Also prove same-copy replacement: wait for its dismissal before testing the deadline.
    await expect(page.locator('.permission-panel')).toHaveCount(0)
    await expect(pill(page)).toHaveText('Request timed out')
    await page.clock.runFor(2001)
    await expect(pill(page)).toHaveText('Request timed out')
    await page.clock.runFor(1998)
    await expect(notice(page)).toBeVisible()
    await page.clock.runFor(1)
    await expect(notice(page)).toHaveCount(0)
  }
})
