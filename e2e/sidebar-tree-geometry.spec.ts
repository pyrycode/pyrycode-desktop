import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { mintChatInWorkspace } from './fixtures/mintChatRow'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, ConversationsPayload } from '../src/shared/wire/types'
import type { Locator } from '@playwright/test'
const CARD_INSET_PX = 20
const LIST_INSET_PX = 12
const HOST_ICON_X = CARD_INSET_PX
const HOST_LABEL_X = CARD_INSET_PX + 24
const WORKSPACE_ROW_X = CARD_INSET_PX + 4
const WORKSPACE_ICON_X = CARD_INSET_PX + 12
const WORKSPACE_LABEL_X = CARD_INSET_PX + 34
const ROW_X = CARD_INSET_PX + LIST_INSET_PX
const DOT_X = ROW_X + 8
const TITLE_X = ROW_X + 22
const DIVIDER_MARGIN_PX = 28
const CARD_TOP_INSET_PX = 24
const CARD_BOTTOM_INSET_PX = 20
const BAR_ROW_PX = 28
const BAR_BOX_PX = 24
const ARCHIVE_BOX_X = 44
const BAR_TO_RULE_PX = 16
const PRIMARY_INK = 'rgb(157, 203, 252)' /* --color-primary #9dcbfc */
const RULE_OPACITY = '0.6'
const FIRST_CONTENT_TOP_PX = 93
const TALL_ROW_COUNT = 40

const TIMEOUT_MS = 15_000
const GEOMETRY_TOLERANCE_PX = 1

const WORKSPACE_CWD = '/fake/workspace'

const seed = (over: Partial<ConversationSummary>): ConversationSummary => ({
  id: 'seed-conversation',
  name: 'Seeded row',
  is_promoted: false,
  is_archived: false,
  cwd: WORKSPACE_CWD,
  last_message_ts: '2026-07-07T12:00:00.000Z',
  last_used_at: '2026-07-07T12:00:00.000Z',
  workspace_label: null,
  ...over
})

type Box = { x: number; y: number; width: number; height: number }

const boxOf = async (locator: Locator, role: string): Promise<Box> => {
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`expected a laid-out box for the ${role}`)
  return box
}

const expectAbout = (actual: number, expected: number): void => {
  expect(actual).toBeGreaterThanOrEqual(expected - GEOMETRY_TOLERANCE_PX)
  expect(actual).toBeLessThanOrEqual(expected + GEOMETRY_TOLERANCE_PX)
}

const gapBetween = (above: Box, below: Box): number => below.y - (above.y + above.height)
const paintOf = (locator: Locator): Promise<{ colour: string; opacity: string }> =>
  locator.evaluate((el) => {
    const style = getComputedStyle(el)
    return { colour: style.backgroundColor, opacity: style.opacity }
  })
const tallListFrame = (): Uint8Array =>
  encodeEnvelope({
    id: 1,
    type: 'conversations',
    ts: '2026-07-07T12:00:00.000Z',
    payload: {
      conversations: Array.from({ length: TALL_ROW_COUNT }, (_, index) =>
        seed({ id: `tall-row-${index}`, name: `Channel ${index}`, is_promoted: true })
      )
    } satisfies ConversationsPayload
  })

test('the revised toolbar stays fixed above the scrolling trees at the Figma offsets', async ({
  launchPairedApp
}) => {
  const buildReplyFrames = conversationStateFake({
    conversations: [seed({ is_promoted: true })]
  })
  const { page, daemon, app } = await launchPairedApp({ buildReplyFrames })

  const card = page.locator('.paired-shell__sidebar')
  const list = page.locator('.channel-list')
  const tree = page.locator('.channel-list__tree')
  const bar = page.locator('.channel-list__actions')
  const rule = page.locator('.channel-list__actions-rule')
  const gear = page.locator('.channel-list__settings')
  const archive = page.locator('.channel-list__archive')
  const pair = page.getByRole('button', { name: 'Pair new host' })
  const hosts = page.locator('.channel-list__host')
  const hostIcons = page.locator('.channel-list__host-icon')
  const hostLabels = page.locator('.channel-list__host-label')
  const workspaces = page.locator('.channel-list__workspace')
  const workspaceIcons = page.locator('.channel-list__workspace-icon')
  const workspaceLabels = page.locator('.channel-list__workspace-label')
  const rows = page.locator('.channel-list__row')
  const dots = page.locator('.channel-list__row .conversation-status-dot')
  const titles = page.locator('.channel-list__title')
  const divider = page.locator('.channel-list__divider')
  await expect(rows).toHaveCount(1)
  await expect(divider).toHaveCount(1)
  await expect(page.locator('.channel-list__section-header')).toHaveCount(0)
  await expect(hosts).toHaveCount(2)
  await mintChatInWorkspace(page, WORKSPACE_CWD)
  await expect(rows).toHaveCount(2)
  await expect(page.locator('.channel-list__section-header')).toHaveCount(0)
  await expect(hosts).toHaveCount(2)
  await expect(workspaces).toHaveCount(2)
  await expect(divider).toHaveCount(1)

  const cardBox = await boxOf(card, 'sidebar card')
  const left = cardBox.x
  const scrollbarPx = await tree.evaluate((el) => el.offsetWidth - el.clientWidth)
  const right = left + cardBox.width - scrollbarPx
  const treeSpan = await boxOf(tree, 'sidebar tree')
  expectAbout(treeSpan.x - left, CARD_INSET_PX)
  expectAbout(left + cardBox.width - (treeSpan.x + treeSpan.width), 0)
  for (const host of await hosts.all()) expectAbout((await boxOf(host, 'host row')).x - left, CARD_INSET_PX)
  for (const ws of await workspaces.all()) expectAbout((await boxOf(ws, 'workspace row')).x - left, WORKSPACE_ROW_X)
  for (const row of await rows.all()) expectAbout((await boxOf(row, 'sidebar row')).x - left, ROW_X)
  for (const row of await rows.all()) {
    const box = await boxOf(row, 'sidebar row')
    expectAbout(right - (box.x + box.width), CARD_INSET_PX)
  }
  for (const ws of await workspaces.all()) {
    const box = await boxOf(ws, 'workspace row')
    expectAbout(right - (box.x + box.width), CARD_INSET_PX)
  }
  for (const icon of await hostIcons.all()) expectAbout((await boxOf(icon, 'host glyph')).x - left, HOST_ICON_X)
  for (const label of await hostLabels.all()) expectAbout((await boxOf(label, 'host label')).x - left, HOST_LABEL_X)
  for (const icon of await workspaceIcons.all()) expectAbout((await boxOf(icon, 'workspace glyph')).x - left, WORKSPACE_ICON_X)
  for (const label of await workspaceLabels.all()) expectAbout((await boxOf(label, 'workspace label')).x - left, WORKSPACE_LABEL_X)
  for (const dot of await dots.all()) expectAbout((await boxOf(dot, 'status dot')).x - left, DOT_X)
  for (const title of await titles.all()) expectAbout((await boxOf(title, 'row title')).x - left, TITLE_X)
  expect(WORKSPACE_LABEL_X).toBe(TITLE_X)
  const dividerBox = await boxOf(divider, 'divider')
  expectAbout(dividerBox.x - left, CARD_INSET_PX)
  expectAbout(right - (dividerBox.x + dividerBox.width), CARD_INSET_PX)
  expectAbout(gapBetween(await boxOf(rows.nth(0), 'Channels row'), dividerBox), DIVIDER_MARGIN_PX)
  expectAbout(gapBetween(dividerBox, await boxOf(hosts.nth(1), 'Chats host')), DIVIDER_MARGIN_PX)
  const barBox = await boxOf(bar, 'top bar')
  expectAbout(barBox.y - cardBox.y, CARD_TOP_INSET_PX)
  expectAbout(barBox.height, BAR_ROW_PX)

  const gearBox = await boxOf(gear, 'settings button')
  const archiveBox = await boxOf(archive, 'archive button')
  const pairBox = await boxOf(pair, 'pairing button')
  expectAbout(cardBox.width, 400)
  expectAbout(left + cardBox.width - pairBox.x - pairBox.width, CARD_INSET_PX)
  expectAbout(gearBox.x - left, CARD_INSET_PX)
  expectAbout(archiveBox.x - left, CARD_INSET_PX + ARCHIVE_BOX_X)
  for (const [role, box] of [
    ['settings', gearBox],
    ['archive', archiveBox],
    ['pairing', pairBox]
  ] as const) {
    expect(Math.abs(box.width - BAR_BOX_PX), `${role} box width`).toBeLessThanOrEqual(
      GEOMETRY_TOLERANCE_PX
    )
    expect(Math.abs(box.height - BAR_BOX_PX), `${role} box height`).toBeLessThanOrEqual(
      GEOMETRY_TOLERANCE_PX
    )
    expect(Math.abs(box.y - barBox.y - 4), `${role} box top`).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX)
  }
  for (const [role, control] of [
    ['settings', gear],
    ['archive', archive],
    ['pairing', pair]
  ] as const) {
    const drawn = await control.evaluate((el) => {
      const style = getComputedStyle(el)
      return { colour: style.color, ground: style.backgroundColor }
    })
    expect(drawn, `${role} button`).toEqual({ colour: PRIMARY_INK, ground: 'rgba(0, 0, 0, 0)' })
  }
  // A 24px box alone passes when CSP blocks an inlined SVG. Require the mask asset to load.
  const glyph = pair.locator('.channel-list__pair-icon')
  expectAbout((await boxOf(glyph, 'pairing glyph')).width, 24)
  expectAbout((await boxOf(glyph, 'pairing glyph')).height, 24)
  expect(await glyph.evaluate(async el => {
    const source = getComputedStyle(el).maskImage.match(/^url\("?(.*?)"?\)$/)?.[1]
    if (!source) return false
    const image = new Image()
    image.src = source
    try {
      await image.decode()
      return image.naturalWidth === 24 && image.naturalHeight === 24
    } catch {
      return false
    }
  })).toBe(true)
  const ruleBox = await boxOf(rule, 'top bar rule')
  expectAbout(ruleBox.height, 1)
  expectAbout(gapBetween(barBox, ruleBox), BAR_TO_RULE_PX)
  expectAbout(ruleBox.x - left, CARD_INSET_PX)
  expectAbout(left + cardBox.width - (ruleBox.x + ruleBox.width), CARD_INSET_PX)
  const rulePaint = await paintOf(rule)
  expect(rulePaint).toEqual({ colour: PRIMARY_INK, opacity: RULE_OPACITY })
  expect(await paintOf(divider)).toEqual(rulePaint)
  expectAbout((await boxOf(hosts.first(), 'first host')).y - cardBox.y, FIRST_CONTENT_TOP_PX)
  expectAbout(gapBetween(ruleBox, await boxOf(hosts.first(), 'first host')), 24)
  const treeBox = await boxOf(tree, 'tree wrapper')
  expectAbout(cardBox.y + cardBox.height - (treeBox.y + treeBox.height), CARD_BOTTOM_INSET_PX)
  for (const width of [1280, 800]) {
    await app.evaluate(({ BrowserWindow }, width) => {
      BrowserWindow.getAllWindows()[0].setContentSize(width, 800)
    }, width)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `/tmp/builder-1678/toolbar-${width}.png`, animations: 'disabled' })
    expectAbout((await boxOf(card, 'resized sidebar')).width, 400)
    expectAbout((await boxOf(bar, 'resized toolbar')).height, 28)
  }
  daemon.pushFrame(tallListFrame())
  await expect(rows).toHaveCount(TALL_ROW_COUNT, { timeout: TIMEOUT_MS })
  expect(await tree.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true)
  expect(await list.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1)

  const restingRow = await boxOf(rows.first(), 'first row at rest')
  const scrolled = await tree.evaluate((el) => {
    el.scrollTop = el.scrollHeight
    return el.scrollTop
  })
  expect(scrolled).toBeGreaterThan(0)
  expect((await boxOf(rows.first(), 'first row after the scroll')).y).toBeLessThan(restingRow.y)
  expectAbout((await boxOf(bar, 'top bar after the scroll')).y, barBox.y)
  expectAbout((await boxOf(rule, 'rule after the scroll')).y, ruleBox.y)
  await expect(pair).toBeVisible()
  expectAbout((await boxOf(pair, 'pairing after scroll')).y, pairBox.y)
})
