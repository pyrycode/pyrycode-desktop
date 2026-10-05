import { capturePairedApp } from './fixtures/capturePairedApp'
import type { Locator, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type {
  BackgroundTask,
  ConversationSummary,
  Envelope,
  EnvelopeType,
  WireTurnState
} from '../src/shared/wire/types'

// #1634: the background-task panel is a NON-modal drawer beside the thread. Renderer unit tests are static
// renders and cannot click or press keys, so this spec is the only proof of the toggle, of the composer
// staying usable while the drawer is open, of the Escape arbitration, and of the open state outliving a
// conversation switch (it lives in PairedShell, above the pane's per-conversation remount).
//
// ONE launch, ONE continuous drive, the sibling convention; each leg's premise is left by the one before.
//
// SECRET HYGIENE (the sibling specs' rule): every task field and message below is a CLIENT-OWNED SYNTHETIC
// LITERAL, and assertions read DOM text, classes, counts and captured frame types only.

const ROUNDTRIP_TIMEOUT_MS = 15_000

const frame = (type: EnvelopeType, payload: unknown, in_reply_to?: number): Uint8Array =>
  encodeEnvelope({ id: 1634, type, ts: '2026-09-25T09:00:00Z', payload, in_reply_to })

const task = (task_id: string, description: string): BackgroundTask => ({
  task_id,
  task_type: 'local_bash',
  description,
  truncated_fields: null
})

const roster = (conversation_id: string, tasks: BackgroundTask[]): Uint8Array =>
  frame('background_task_roster', { conversation_id, tasks, dropped_tasks: 0 })

const turnState = (state: WireTurnState): Uint8Array =>
  frame('turn_state', { conversation_id: SEEDED_ROW.id, state })

// The second conversation on the same host. Its name shares no substring with the seeded row's, so the
// sidebar filter below cannot match both.
const SECOND: ConversationSummary = { ...SEEDED_ROW, id: 'drawer-second', name: 'Other drawer chat' }

// Mutually non-substring, so a `toContainText` on one cannot pass on the other.
const SEEDED_TASK = 'seeded synthetic background task'
const SECOND_TASK = 'another synthetic background job'
const TYPED = 'typed while the drawer is open'

/** Answers list and history requests (an unanswered history request puts a failure in the status slot,
 *  which outranks the task pill) and captures every decoded outbound frame for the send and stop proofs. */
function capturingFake(captured: Envelope[]) {
  return (bytes: Uint8Array): Uint8Array[] => {
    const env = decodeEnvelope(bytes)
    captured.push(env)
    if (env.type === 'list_conversations') return [frame('conversations', { conversations: [SEEDED_ROW] })]
    if (env.type === 'request_history') {
      return [frame('history_page', { entries: [], cursor: '', at_start: true }, env.id)]
    }
    return []
  }
}

const count = (captured: Envelope[], type: string): number => captured.filter((e) => e.type === type).length

const drawerOf = (page: Page): Locator => page.getByRole('dialog', { name: 'Background tasks', exact: true })

test('the drawer toggles from the pill, leaves the composer usable, takes one Escape and survives a switch', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page, app, daemon } = await launchPairedApp({ buildReplyFrames: capturingFake(captured) })
  await page.setViewportSize({ width: 1280, height: 800 })

  daemon.pushFrame(roster(SEEDED_ROW.id, [task('task-seeded', SEEDED_TASK)]))
  daemon.pushFrame(roster(SECOND.id, [task('task-second', SECOND_TASK)]))
  const pill = page.locator('.composer-status__tasks')
  const drawer = drawerOf(page)
  const box = page.getByPlaceholder('Message…')
  await expect(pill).toHaveText('1 task running')

  // --- 1. The pill opens the drawer and wears its open outline; the chrome is the drawer, not the sheet. ---
  await expect(pill).not.toHaveClass(/composer-status__tasks--open/)
  await pill.click()
  await expect(drawer).toBeVisible()
  await expect(drawer).toHaveClass('background-task-drawer')
  await expect(drawer).not.toHaveAttribute('aria-modal', /.*/)
  await expect(drawer).toContainText(SEEDED_TASK)
  await expect(page.locator('.status-sheet-overlay, .status-sheet')).toHaveCount(0)
  await expect(pill).toHaveClass(/composer-status__tasks--open/)
  await capturePairedApp(app, page, '/tmp/builder-1634-drawer-open.png')

  // --- 2. No scrim: the composer takes typing and sending while the drawer is open. ---
  await box.click()
  await box.fill(TYPED)
  await expect(box).toHaveValue(TYPED)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect.poll(() => count(captured, 'send_message'), { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  await expect(drawer).toBeVisible()

  // --- 3. The pill closes it; More actions opens it; the close button closes it. ---
  await pill.click()
  await expect(drawer).toHaveCount(0)
  await expect(pill).not.toHaveClass(/composer-status__tasks--open/)
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Background tasks', exact: true }).click()
  await expect(drawer).toBeVisible()
  await expect(pill).toHaveClass(/composer-status__tasks--open/)
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(drawer).toHaveCount(0)

  // --- 4. One Escape does one thing: with the options overlay open too, Escape closes the drawer ONLY. ---
  await pill.click()
  await expect(drawer).toBeVisible()
  await page.getByRole('button', { name: 'Actions', exact: true }).click()
  const actionsMenu = page.getByRole('menu', { name: 'Actions', exact: true })
  await expect(actionsMenu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect(actionsMenu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(actionsMenu).toHaveCount(0)

  // --- 5. With the composer focused and a turn running, Escape stops the turn and leaves the drawer open.
  // The interrupt count is measured against the captured frames, not inferred from the screen. ---
  await pill.click()
  await expect(drawer).toBeVisible()
  daemon.pushFrame(turnState('thinking'))
  await expect(page.getByRole('button', { name: 'Stop the running turn' })).toBeVisible({
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  await box.focus()
  await expect(box).toBeFocused()
  await page.keyboard.press('Escape')
  await expect.poll(() => count(captured, 'interrupt'), { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  await expect(drawer).toBeVisible()
  // Back at idle, the same key press from the same focus is the drawer's, and sends nothing more.
  daemon.pushFrame(turnState('idle'))
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  expect(count(captured, 'interrupt')).toBe(1)

  // --- 6. A conversation switch keeps the drawer open and shows the new conversation's tasks. ---
  await pill.click()
  await expect(drawer).toContainText(SEEDED_TASK)
  daemon.pushFrame(frame('conversations', { conversations: [SEEDED_ROW, SECOND] }))
  const secondRow = page.locator('.channel-list__row-open').filter({ hasText: SECOND.name ?? '' })
  await secondRow.click()
  await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toContainText(SECOND.name ?? '')
  await expect(drawer).toBeVisible()
  await expect(drawer).toContainText(SECOND_TASK)
  await expect(drawer).not.toContainText(SEEDED_TASK)
  await expect(pill).toHaveClass(/composer-status__tasks--open/)
})
