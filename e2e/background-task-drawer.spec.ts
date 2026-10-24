import { capturePairedApp } from './fixtures/capturePairedApp'
import type { Locator, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { createCanonicalThread } from './fixtures/canonicalThread'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type {
  ConversationSummary,
  Envelope,
  EnvelopeType,
  WireTurnState
} from '../src/shared/wire/types'
import type { ThreadItem } from '../src/shared/wire/thread'

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

const SESSION = 'drawer-seeded-session'
const FIRST: ConversationSummary = { ...SEEDED_ROW, current_session_id: SESSION }

const task = (id: number, session: string, task_id: string, description: string): ThreadItem => ({
  id, order: id * 10, rev: 1, kind: 'tool_call', status: 'running', active: true, shown: true,
  summary: description, session, agent: 'claude',
  content: { name: 'Bash', task_id, tool_use_id: `call-${task_id}`,
    task_link: { task_id, tool_call_id: `call-${task_id}`, description } }
})

const turnState = (state: WireTurnState): Uint8Array =>
  encodeEnvelope({ id: 1634, type: 'turn_state', ts: '2026-09-25T09:00:00Z',
    session_id: SESSION, payload: { conversation_id: SEEDED_ROW.id, state } })

// The second conversation on the same host. Its name shares no substring with the seeded row's, so the
// sidebar filter below cannot match both.
const SECOND_SESSION = 'drawer-second-session'
const SECOND: ConversationSummary = { ...SEEDED_ROW, id: 'drawer-second', name: 'Other drawer chat',
  current_session_id: SECOND_SESSION }

// Mutually non-substring, so a `toContainText` on one cannot pass on the other.
const SEEDED_TASK = 'seeded synthetic background task'
const SECOND_TASK = 'another synthetic background job'
const TYPED = 'typed while the drawer is open'

/** Keep the initial list to one row; the canonical publisher owns content and correlated replies.
 * Capture actual outbound requests for the opening, send and stop proofs. */
function capturingFake(captured: Envelope[]) {
  return (bytes: Uint8Array): Uint8Array[] => {
    const env = decodeEnvelope(bytes)
    captured.push(env)
    if (env.type === 'list_conversations') return [frame('conversations', { conversations: [FIRST] }, env.id)]
    return []
  }
}

const count = (captured: Envelope[], type: string): number => captured.filter((e) => e.type === type).length

const drawerOf = (page: Page): Locator => page.getByRole('dialog', { name: 'Background tasks', exact: true })

test('the drawer toggles from the pill, leaves the composer usable, takes one Escape and survives a switch', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const thread = createCanonicalThread({ conversations: [
    { summary: FIRST, epoch: 'drawer-seeded-epoch', version: 1,
      items: [task(1, SESSION, 'task-seeded', SEEDED_TASK)] },
    { summary: SECOND, epoch: 'drawer-second-epoch', version: 1,
      items: [task(2, SECOND_SESSION, 'task-second', SECOND_TASK)] }
  ] })
  const { page, app, daemon } = await launchPairedApp({ threadMode: 'canonical', thread,
    helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames: capturingFake(captured) })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1280, 800)
  })

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
  expect(captured).toContainEqual(expect.objectContaining({ type: 'thread_catch_up',
    payload: expect.objectContaining({ conversation_id: SEEDED_ROW.id, version: 0 }) }))
  expect(count(captured, 'request_history')).toBe(0)
  await expect(page.locator('.status-sheet-overlay, .status-sheet')).toHaveCount(0)
  await expect(pill).toHaveClass(/composer-status__tasks--open/)
  await capturePairedApp(app, page, '/tmp/builder-2269/drawer-open.png')

  // Both drawn sizes keep the complete drawer between occupied chrome and inside the pane.
  for (const size of [{ width: 1280, height: 800 }, { width: 800, height: 600 }]) {
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0].setSize(size.width, size.height)
    }, size)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(size.width)
    await expect.poll(() => page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
      const pane = rect('.conversation__message-area')
      const drawer = rect('.background-task-drawer')
      const header = rect('.conversation__top-chrome')
      const input = rect('.conversation__input-chrome')
      return {
        contained: drawer.left >= pane.left && drawer.right <= pane.right,
        rightInset: Math.round(pane.right - drawer.right),
        top: Math.round(drawer.top - header.bottom),
        bottom: Math.round(drawer.bottom - input.top)
      }
    })).toEqual({ contained: true, rightInset: 20, top: 0, bottom: 0 })
    await capturePairedApp(app, page, `/tmp/builder-2269/drawer-${size.width}.png`)
  }

  // --- 2. No scrim: the composer takes typing and sending while the drawer is open. ---
  await box.click()
  await box.fill(TYPED)
  await expect(box).toHaveValue(TYPED)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect.poll(() => count(captured, 'send_message'), { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  expect(captured).toContainEqual(expect.objectContaining({ type: 'send_message',
    payload: expect.objectContaining({ conversation_id: SEEDED_ROW.id, text: TYPED }) }))
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
  expect(captured).toContainEqual(expect.objectContaining({ type: 'interrupt',
    payload: expect.objectContaining({ conversation_id: SEEDED_ROW.id }) }))
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
  daemon.pushFrame(frame('conversations', { conversations: [FIRST, SECOND] }))
  const secondRow = page.locator('.channel-list__row-open').filter({ hasText: SECOND.name ?? '' })
  await secondRow.click()
  await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toContainText(SECOND.name ?? '')
  await expect(drawer).toBeVisible()
  await expect(drawer).toContainText(SECOND_TASK)
  expect(captured).toContainEqual(expect.objectContaining({ type: 'thread_catch_up',
    payload: expect.objectContaining({ conversation_id: SECOND.id, version: 0 }) }))
  expect(count(captured, 'request_history')).toBe(0)
  await expect(drawer).not.toContainText(SEEDED_TASK)
  await expect(pill).toHaveClass(/composer-status__tasks--open/)
})
