import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'

const label = 'Collapse assistant tool uses'
const settings = 'section[aria-label="Settings screen"]'
const tools = (conversationId: string) => ['first', 'second'].map((id) => encodeEnvelope({
  id: 1, type: 'tool_use', ts: '2026-10-05T12:00:00Z',
  payload: { conversation_id: conversationId, turn_id: 'tools', tool_use_id: id,
    name: 'Read', input_summary: id }
}))

for (const width of [800, 1280]) test(`collapse choice applies immediately to retained chats and another host at ${width}px`, async ({ launchPairedApp }) => {
  const { page, app, servers } = await launchPairedApp({}, { secondServer: {} })
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 800), width)
  const open = async (name: string) => {
    await page.locator('.channel-list__row-open').filter({ hasText: name }).click()
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  }
  const openSettings = async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.locator(settings)).toBeVisible()
  }
  const leaveSettings = () => page.locator(settings).getByRole('button', { name: 'Back', exact: true }).click()
  const toggle = page.getByRole('switch', { name: label })
  const headers = page.locator('.tool-run button')
  const ordinary = page.locator('.tool-row:not(.tool-run__row)')
  const capture = async (state: string) => {
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `/tmp/builder-1765/${width}-settings-${state}.png`, animations: 'disabled' })
  }

  await open('Seeded discussion')
  for (const frame of tools(SEEDED_ROW.id)) servers[0].daemon.pushFrame(frame)
  await expect(headers).toHaveText('Using tools: 2')
  await expect(ordinary.first()).toBeHidden()

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
  for (const frame of tools(SECOND_SEEDED_ROW.id)) servers[1].daemon.pushFrame(frame)
  await expect(headers).toHaveCount(0)
  await expect(ordinary).toHaveCount(2)
  await expect(ordinary.first()).toBeVisible()
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
  const { page, app, daemon, userDataDir } = await launchPairedApp()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const toggle = page.getByRole('switch', { name: label })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked({ checked: false })
  await app.close()
  await daemon.close()
  const { page: relaunched } = await launchPairedApp({}, { reuseUserDataDir: userDataDir })
  await relaunched.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(relaunched.getByRole('switch', { name: label })).toBeChecked({ checked: false })
  await expect(relaunched.getByRole('switch', { name: 'Push notifications when an agent responds' }))
    .toBeChecked()
})
