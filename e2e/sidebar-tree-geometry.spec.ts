import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import type { ConversationSummary } from '../src/shared/wire/types'
import type { Locator } from '@playwright/test'

// Fake-stack UI e2e for THE SIDEBAR TREE'S PLACEMENT (Figma Sidebar 132:3902 / "Channels and chats"
// 103:2959): where each level of the tree sits inside the 400px card, and what separates the two
// sections. Only this tier can prove it: `vitest.config.ts` sets `environment: 'node'`, every renderer
// spec is a `renderToStaticMarkup` string assertion, and there is no layout engine there to measure an
// x coordinate with.
//
// A DEDICATED FILE beside sidebar-row-geometry.spec.ts, which owns the ROW's own box (its height, padding,
// corner, type and pitch) and scopes itself to that. This spec owns the row's position relative to the
// card and to the levels above it, and the vertical rhythm between the section header, the host row and
// the divider — everything that moved when the card's inset landed, and nothing that spec already pins.
//
// ONE launch, TWO sections. `launchPairedApp` reaches the thread by clicking a single STRICT
// `.channel-list__row-open`, so the seed is one PROMOTED row (it renders under "Channels"), and the second
// section is minted afterwards through the real product control: the new-discussion FAB creates an
// UNPROMOTED conversation, which the stateful fake re-lists under "Chats". Only with rows in both sections
// does the divider render at all, and the divider's margins are half of what this file is for.
//
// SECRET HYGIENE (the sibling specs' posture). Every assertion below reads a NUMBER — a box coordinate, a
// width, an element count. Never a seed name, never a label, never row text; no failure diff can print
// daemon-derived content. The seed cwd is a fixed fake remote path, never resolved locally.

// --- The node's measurements, each the DERIVED result of a token or a sum of them, so the browser does
// the arithmetic and a swapped token reddens here. All x offsets are measured from the CARD's left edge
// (`.paired-shell__sidebar`, which the card spec proves carries no padding of its own). ---

// "Channels and chats" 103:2959 p-[20px]: the inset every level shares.
const CARD_INSET_PX = 20
// "Channel list" 103:2985 pl-[20px]: the rows sit one step in from the host and workspace rows.
const LIST_INSET_PX = 20

// Host 106:3094 px-[16px]: the glyph at 16 inside the row, the label 12 (icon) + 12 (gap) further.
const HOST_ICON_X = CARD_INSET_PX + 16
const HOST_LABEL_X = HOST_ICON_X + 12 + 12
// Workspace 106:3098 pl-[24px]. (Its label is NOT pinned: the design's 10px icon→label gap has no slot on
// the 4px scale and the row keeps --space-3, a 2px deviation channels.css records at the rule.)
const WORKSPACE_ICON_X = CARD_INSET_PX + 24
// Channel 103:2968 px-[16px] with the 6px dot then a 10px gap: dot at 16, title at 32 inside the row —
// #801's leading geometry, unchanged, now offset by the two insets.
const ROW_X = CARD_INSET_PX + LIST_INSET_PX
const DOT_X = ROW_X + 16
const TITLE_X = ROW_X + 32

// Section 103:2966: the header is a bare 20px line and the hosts frame starts 12 below it (gap-[12px]).
const HEADER_TO_HOST_PX = 32
// 103:2959 gap-[28px], on both sides of the 1px divider 103:3009.
const DIVIDER_MARGIN_PX = 28

// Sub-pixel tolerance for a device-pixel-ratio-scaled layout, copied from the sibling specs.
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

test('the sidebar tree sits at the desktop card inset: 20px card, 20px list indent, 28px around the divider', async ({
  launchPairedApp
}) => {
  const buildReplyFrames = conversationStateFake({
    conversations: [seed({ is_promoted: true })]
  })
  const { page } = await launchPairedApp({ buildReplyFrames })

  const card = page.locator('.paired-shell__sidebar')
  const list = page.locator('.channel-list')
  const headers = page.locator('.channel-list__section-header')
  const hosts = page.locator('.channel-list__host')
  const hostIcons = page.locator('.channel-list__host-icon')
  const hostLabels = page.locator('.channel-list__host-label')
  const workspaces = page.locator('.channel-list__workspace')
  const workspaceIcons = page.locator('.channel-list__workspace-icon')
  const rows = page.locator('.channel-list__row')
  const dots = page.locator('.channel-list__row .conversation-status-dot')
  const titles = page.locator('.channel-list__title')
  const divider = page.locator('.channel-list__divider')

  // The seed alone renders one section and no divider; minting the second row through the FAB brings
  // the other section and the divider with it. Counted before any box is read.
  await expect(rows).toHaveCount(1)
  await expect(divider).toHaveCount(0)
  await page.getByRole('button', { name: 'New discussion' }).click()
  await expect(rows).toHaveCount(2)
  await expect(headers).toHaveCount(2)
  await expect(hosts).toHaveCount(2)
  await expect(workspaces).toHaveCount(2)
  await expect(divider).toHaveCount(1)

  const cardBox = await boxOf(card, 'sidebar card')
  const left = cardBox.x
  // The trailing edge is read off the scroll column's CLIENT width rather than the card's box, so a
  // classic (non-overlay) scrollbar on the host machine cannot move it.
  const right = left + (await list.evaluate((el) => el.clientWidth))

  // --- 1. Every level shares the card's 20px inset: the header, the host row and the workspace row all
  // start at the content edge, and the rows one list-indent further in. `x` is the box's left edge, so
  // these read the container's padding, not each element's own. ---
  for (const header of await headers.all()) expectAbout((await boxOf(header, 'header')).x - left, CARD_INSET_PX)
  for (const host of await hosts.all()) expectAbout((await boxOf(host, 'host row')).x - left, CARD_INSET_PX)
  for (const ws of await workspaces.all()) expectAbout((await boxOf(ws, 'workspace row')).x - left, CARD_INSET_PX)
  for (const row of await rows.all()) expectAbout((await boxOf(row, 'sidebar row')).x - left, ROW_X)

  // --- 2. The row spans to the content edge — the open row's fill (#1098) ends where the card's inset
  // begins, 340 wide in the 360 content box. Read on both rows: one is the open one, one is resting. ---
  for (const row of await rows.all()) {
    const box = await boxOf(row, 'sidebar row')
    expectAbout(right - (box.x + box.width), CARD_INSET_PX)
  }

  // --- 3. The glyphs and labels land on the design's x: this is the alignment an operator actually sees,
  // each level's marker one step further in than the one above it. ---
  for (const icon of await hostIcons.all()) expectAbout((await boxOf(icon, 'host glyph')).x - left, HOST_ICON_X)
  for (const label of await hostLabels.all()) expectAbout((await boxOf(label, 'host label')).x - left, HOST_LABEL_X)
  for (const icon of await workspaceIcons.all()) expectAbout((await boxOf(icon, 'workspace glyph')).x - left, WORKSPACE_ICON_X)
  for (const dot of await dots.all()) expectAbout((await boxOf(dot, 'status dot')).x - left, DOT_X)
  for (const title of await titles.all()) expectAbout((await boxOf(title, 'row title')).x - left, TITLE_X)

  // --- 4. The section's vertical rhythm: the first host row's top sits 32 under its header's top (a bare
  // 20px line plus the 12px header→hosts gap), in both sections. ---
  for (let i = 0; i < 2; i++) {
    const header = await boxOf(headers.nth(i), 'header')
    const host = await boxOf(hosts.nth(i), 'host row')
    expectAbout(host.y - header.y, HEADER_TO_HOST_PX)
  }

  // --- 5. The divider spans the full content box and carries 28px on both sides: from the Channels
  // section's last row to the line, and from the line to the Chats header. Rows are in section order, so
  // `nth(0)` is the Channels row without reading any text. ---
  const dividerBox = await boxOf(divider, 'divider')
  expectAbout(dividerBox.x - left, CARD_INSET_PX)
  expectAbout(right - (dividerBox.x + dividerBox.width), CARD_INSET_PX)
  expectAbout(gapBetween(await boxOf(rows.nth(0), 'Channels row'), dividerBox), DIVIDER_MARGIN_PX)
  expectAbout(gapBetween(dividerBox, await boxOf(headers.nth(1), 'Chats header')), DIVIDER_MARGIN_PX)
})
