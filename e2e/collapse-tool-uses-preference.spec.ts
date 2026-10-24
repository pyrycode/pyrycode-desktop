import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW, type LaunchPairedAppOptions } from './fixtures/launchPairedApp'
import { createCanonicalThread } from './fixtures/canonicalThread'
import { decodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, Envelope } from '../src/shared/wire/types'
import type { ThreadItem } from '../src/shared/wire/thread'

const label = 'Collapse assistant tool uses'
const settings = 'section[aria-label="Settings screen"]'
const firstSummary = { ...SEEDED_ROW, current_session_id: 'collapse-first-session' }
const secondSummary = { ...SECOND_SEEDED_ROW, current_session_id: 'collapse-second-session' }
const tools = (session: string): ThreadItem[] => ['first', 'second'].map((summary, index) => ({
  id: 101 + index, order: (index + 1) * 10, rev: 1, kind: 'tool_call',
  status: 'running', active: true, shown: true, summary, session, agent: 'claude', turn: 'tools', parent: 0,
  content: { tool_use_id: summary, name: 'Read', input_summary: summary, result: null }
}))

function host(summary: ConversationSummary, items: ThreadItem[] = []) {
  const requests: Envelope[] = []
  const options: LaunchPairedAppOptions = { threadMode: 'canonical',
    thread: createCanonicalThread({ conversations: [{ summary,
      epoch: `${summary.id}-collapse-epoch`, version: 1, items }] }),
    helloAck: { capabilities: ['interactive', 'thread'] },
    buildReplyFrames: (bytes) => { requests.push(decodeEnvelope(bytes)); return [] } }
  return { requests, options }
}

for (const width of [800, 1280]) test(`collapse choice applies immediately to retained chats and another host at ${width}px`, async ({ launchPairedApp }) => {
  const first = host(firstSummary, tools(firstSummary.current_session_id))
  const second = host(secondSummary, tools(secondSummary.current_session_id))
  const { page, app } = await launchPairedApp(first.options, { secondServer: second.options })
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 800), width)
  const open = async (name: string) => {
    await page.locator('.channel-list__row-open').filter({ hasText: name }).click()
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  }
  const openSettings = async () => {
    await page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    await expect(page.locator(settings)).toBeVisible()
  }
  const leaveSettings = () => page.locator(settings).getByRole('button', { name: 'Back', exact: true }).click()
  const toggle = page.getByRole('switch', { name: label })
  const headers = page.locator('.tool-run button')
  const ordinary = page.locator('.tool-row:not(.tool-run__row)')
  const capture = async (state: string) => {
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `/tmp/builder-2284/${width}-settings-${state}.png`, animations: 'disabled' })
  }

  await open('Seeded discussion')
  await expect(headers).toHaveText('Using tools: 2')
  await expect(ordinary.first()).toBeHidden()
  expect(first.requests).toContainEqual(expect.objectContaining({ type: 'thread_catch_up',
    payload: expect.objectContaining({ conversation_id: SEEDED_ROW.id, version: 0 }) }))
  expect(first.requests.filter(request => request.type === 'request_history')).toHaveLength(0)

  await openSettings()
  await expect(toggle).toBeChecked()
  const headings = await page.locator(`${settings} .settings__section-header`).allTextContents()
  expect(headings.slice(headings.indexOf('Notifications'), headings.indexOf('Storage') + 1))
    .toEqual(['Notifications', 'Thread', 'Storage'])
  await toggle.scrollIntoViewIfNeeded()
  await capture('on')
  await toggle.click()
  await expect(toggle).toBeChecked({ checked: false })
  await capture('off')
  await leaveSettings()
  await open('Seeded discussion')
  await expect(headers).toHaveCount(0)
  await expect(ordinary).toHaveCount(2)
  await expect(ordinary.first()).toBeVisible()
  await expect(ordinary.last()).toBeVisible()
  await expect(page.locator('[data-read-row="101"] > .tool-row')).toBeVisible()
  await expect(page.locator('[data-read-row="102"] > .tool-row')).toBeVisible()
  // Ordinary joined stacks retain a one-pixel overlap and flattened internal corners.
  const boxes = await ordinary.evaluateAll((rows) => rows.map((row) => {
    const box = row.getBoundingClientRect(), css = getComputedStyle(row)
    return { top: box.top, bottom: box.bottom, topRadius: css.borderTopLeftRadius,
      bottomRadius: css.borderBottomLeftRadius, shadow: css.boxShadow }
  }))
  expect(Math.abs(boxes[1].top - boxes[0].bottom + 1)).toBeLessThanOrEqual(0.5)
  expect(boxes[0].bottomRadius).toBe('0px')
  expect(boxes[1].topRadius).toBe('0px')
  expect(boxes[0].shadow).toBe('none')

  // First opening on another paired host uses the same app-wide preference.
  await open('Server two chat')
  await expect(headers).toHaveCount(0)
  await expect(ordinary).toHaveCount(2)
  await expect(ordinary.first()).toBeVisible()
  await expect(page.locator('[data-read-row="101"] > .tool-row')).toBeVisible()
  await expect(page.locator('[data-read-row="102"] > .tool-row')).toBeVisible()
  expect(second.requests).toContainEqual(expect.objectContaining({ type: 'thread_catch_up',
    payload: expect.objectContaining({ conversation_id: SECOND_SEEDED_ROW.id, version: 0 }) }))
  expect(second.requests.filter(request => request.type === 'request_history')).toHaveLength(0)
  await openSettings()
  await expect(toggle).toBeChecked({ checked: false })
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(toggle).toBeChecked()
  await leaveSettings()
  await open('Server two chat')
  await expect(headers).toHaveText('Using tools: 2')
  await expect(ordinary.first()).toBeHidden()
  await open('Seeded discussion')
  await expect(headers).toHaveText('Using tools: 2')
  await expect(ordinary.first()).toBeHidden()

  await openSettings()
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).toBeChecked({ checked: false })
  await leaveSettings()
  await open('Server two chat')
  await expect(headers).toHaveCount(0)
  await expect(ordinary.last()).toBeVisible()
})

test('explicit collapse off survives a full app relaunch', async ({ launchPairedApp }) => {
  const initial = host(firstSummary)
  const { page, app, daemon, userDataDir } = await launchPairedApp(initial.options)
  await page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  const toggle = page.getByRole('switch', { name: label })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked({ checked: false })
  await app.close()
  await daemon.close()
  const reopened = host(firstSummary)
  const { page: relaunched } = await launchPairedApp(reopened.options, { reuseUserDataDir: userDataDir })
  await relaunched.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
  await relaunched.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  await expect(relaunched.getByRole('switch', { name: label })).toBeChecked({ checked: false })
  await expect(relaunched.getByRole('switch', { name: 'Push notifications when an agent responds' }))
    .toBeChecked()
})
