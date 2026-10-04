import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { readMainProcess } from './fixtures/mainProcessRead'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, EnvelopeType } from '../src/shared/wire/types'
import type { ElectronApplication, Page } from '@playwright/test'

// Fake-stack e2e for THE APP ICON'S ATTENTION BADGE (#1592). Only this tier sees the badge: the count
// lands through `app.setBadgeCount` in the main process, and `app.getBadgeCount()` reads it back. The
// badge is macOS's (and Linux Unity's); on Windows the overlay path is unit-tested in appBadge.test.ts.
//
// Every read below is a number or a count of dots, never row text or daemon content.
//
// macOS only. On Linux `app.getBadgeCount()` reads back 0 outside a Unity launcher, which includes the
// Xvfb display of the pyrybox dispatcher container, and Windows has no count badge at all.
test.skip(process.platform !== 'darwin', 'the app icon count badge exists only on macOS')

const OPEN = SEEDED_ROW.id
const OTHER: ConversationSummary = { ...SEEDED_ROW, id: 'badge-other', name: 'Badge side chat' }
const OPTIONS = [{ id: 'deny', label: 'Deny' }, { id: 'allow', label: 'Allow' }]

const frame = (type: EnvelopeType, payload: unknown): Uint8Array =>
  encodeEnvelope({ id: 1, type, ts: '2026-07-07T12:00:00.000Z', payload })
const shown = (conversationId: string, modalId: string): Uint8Array =>
  frame('modal_shown', {
    conversation_id: conversationId, modal_id: modalId, class: 'permission', title: modalId,
    prompt: 'Allow reading the file?', options: OPTIONS, default_option_id: 'deny'
  })
const dismissed = (modalId: string): Uint8Array =>
  frame('modal_dismissed', { modal_id: modalId, outcome: 'remote', source: 'remote' })
const turnEnd = (conversationId: string): Uint8Array =>
  frame('turn_end', { conversation_id: conversationId, turn_id: 'badge-turn', stop_reason: 'end_turn' })

/** The Dock badge, polled until the main process answers. */
function badge(app: ElectronApplication): () => Promise<unknown> {
  return () => readMainProcess(app, ({ app: electronApp }) => electronApp.getBadgeCount())
}

/** The sidebar's attention dots — the badge must equal this count, computed the same way. */
function attentionDots(page: Page): Promise<number> {
  return page
    .locator('.conversation-status-dot--input-required, .conversation-status-dot--new-messages')
    .count()
}

test('the badge counts attention dots as prompts arrive and resolve and chats are read', async ({
  launchPairedApp
}) => {
  const rows = [SEEDED_ROW]
  const { page, app, daemon } = await launchPairedApp({
    buildReplyFrames: (bytes) =>
      decodeEnvelope(bytes).type === 'list_conversations' ? [frame('conversations', { conversations: rows })] : []
  })
  await expect.poll(badge(app)).toBe(0)

  rows.push(OTHER)
  daemon.pushFrame(frame('conversations', { conversations: rows }))
  await expect(page.locator('.channel-list__row')).toHaveCount(2)
  await expect.poll(badge(app)).toBe(0)

  // A prompt on the chat that is not open, then one on the open chat: both dots ask for the operator.
  daemon.pushFrame(shown(OTHER.id, 'badge-other-prompt'))
  await expect.poll(badge(app)).toBe(1)
  daemon.pushFrame(shown(OPEN, 'badge-open-prompt'))
  await expect.poll(badge(app)).toBe(2)
  expect(await attentionDots(page)).toBe(2)

  // Resolving both clears the badge.
  daemon.pushFrame(dismissed('badge-other-prompt'))
  daemon.pushFrame(dismissed('badge-open-prompt'))
  await expect.poll(badge(app)).toBe(0)

  // A turn ending in the unopened chat leaves it unread: a new-messages dot.
  daemon.pushFrame(turnEnd(OTHER.id))
  await expect.poll(badge(app)).toBe(1)
  expect(await attentionDots(page)).toBe(1)

  // Reading it clears it.
  await page.locator('.channel-list__row', { hasText: OTHER.name ?? '' }).locator('.channel-list__row-open').click()
  await expect.poll(badge(app)).toBe(0)
  expect(await attentionDots(page)).toBe(0)
})

test('unpairing the last host clears the badge', async ({ launchPairedApp }) => {
  const { page, app, daemon } = await launchPairedApp()
  daemon.pushFrame(shown(OPEN, 'badge-unpair-prompt'))
  await expect.poll(badge(app)).toBe(1)

  await page.getByRole('button', { name: 'Settings' }).click()
  const row = page.locator('.settings__server-row').nth(0)
  await row.getByRole('button', { name: 'Unpair', exact: true }).click()
  await row.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.locator('[aria-label="Pairing code"]')).toBeVisible()
  await expect.poll(badge(app)).toBe(0)
})
