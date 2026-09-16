import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { mintChatInWorkspace } from './fixtures/mintChatRow'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, ConversationsPayload } from '../src/shared/wire/types'
import type { Locator } from '@playwright/test'

// Fake-stack UI e2e for THE SIDEBAR CARD'S PLACEMENT (Figma Sidebar 132:3902 / "Channels and chats"
// 103:2959): its inset, the top bar and rule that head it since #1443, and where each level of the tree
// sits inside the 400px column. Only this tier can prove it: `vitest.config.ts` sets
// `environment: 'node'`, every renderer spec is a `renderToStaticMarkup` string assertion, and there is
// no layout engine there to measure an x coordinate with.
//
// A DEDICATED FILE beside sidebar-row-geometry.spec.ts, which owns the ROW's own box (its height, padding,
// corner, type and pitch) and scopes itself to that. This spec owns the row's position relative to the
// card and to the levels above it, and the vertical rhythm between the section header, the host row and
// the divider — everything that moved when the card's inset landed, and nothing that spec already pins.
//
// ONE launch, TWO sections. `launchPairedApp` reaches the thread by clicking a single STRICT
// `.channel-list__row-open`, so the seed is one PROMOTED row (it renders under "Channels"), and the second
// section is minted afterwards through a real product control: the host row's `Add workspace` creates an
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
// The channel list's own indent: the rows sit one step in from the host and workspace rows. 12 since
// #1506 read `Host container` 106:3104, where `Channel list` 103:2985 sits at x 4 inside the `Workspace`
// wrapper and insets its own rows a further 8. #1171 read that same wrapper relation but took the outer
// nest as 20, which put the rows at 28; the first read of 103:2985 gave 20 flat.
const LIST_INSET_PX = 12

// Host 405:7862 at x 0 in `Host container` 106:3104, drawn as Host 399:1366 / Idle 399:1365: `Row icon`
// 399:1356 is ABSOLUTELY placed at left 0 — a 12 × 20 box centring the 12px glyph — so the row's
// `pl-[24px]` carries the label on its own and the glyph lands on the card's content edge. The
// superseded reading was a 16px row padding with the label summed through the flow as 16 + 12 + 12 = 40.
const HOST_ICON_X = CARD_INSET_PX
const HOST_LABEL_X = CARD_INSET_PX + 24
// Workspace 399:1059, placed as 405:7456 at x 4 inside the wrapper 405:7469: the row nests 4 in, then
// `pl-[8px]` puts the 12px folder at 12, and the button's own `pl-[30px]` puts the label at 34. #1178
// read that wrapper's nest as 20, which put the folder at 28 and the label at 50; #1506 reads the
// redrawn `Host container` and moves all three 16 left. (Older still: a 24px inset and a --space-3 gap
// chosen by a tie-break, which left the label at 48 — a 2px deviation #1178 already closed.)
const WORKSPACE_ROW_X = CARD_INSET_PX + 4
const WORKSPACE_ICON_X = CARD_INSET_PX + 12
const WORKSPACE_LABEL_X = CARD_INSET_PX + 34
// The redrawn Channel row (Hover 398:7266): an 8px left inset, then the 6px dot, then an 8px gap — dot
// at 8 and title at 22 inside the row, where #801's leading geometry had them at 16 and 32. Offset by
// the two insets, the title lands 54 from the card's edge and 34 from its content edge: the same left
// edge #1178's nest gives the workspace label above it, at the x #1506 moves both to. The superseded
// pair was 70 and 50.
const ROW_X = CARD_INSET_PX + LIST_INSET_PX
const DOT_X = ROW_X + 8
const TITLE_X = ROW_X + 22

// Section 103:2966: the header is a bare 20px line and the hosts frame starts 12 below it (gap-[12px]).
const HEADER_TO_HOST_PX = 32
// 103:2959 gap-[28px], on both sides of the 1px divider 103:3009.
const DIVIDER_MARGIN_PX = 28

// --- #1443, the drawn top bar and the card's vertical inset. ---

// 103:2959 pt-[24px] / pb-[20px]. Not the pair this card wore until #1443: the top 4 was the sticky
// actions cluster's rest position and the bottom 24 the deleted FAB's sticky offset, neither of them a
// number the design ever drew.
const CARD_TOP_INSET_PX = 24
const CARD_BOTTOM_INSET_PX = 20
// Top bar 115:3693 — a 24px row of two 24px boxes (Settings 115:3834, Archive 117:3835) inside the 76px
// `Buttons` frame 497:1874, whose `justify-between` lands the second box's left edge 52 in; then
// `gap-[20px]` down to the 1px rule 497:1852. The 52 is DERIVED in the stylesheet from a --space-7 gap
// between two --space-6 boxes, so what is restated here is the drawing's number, not the rule's.
const BAR_ROW_PX = 24
const BAR_BOX_PX = 24
const ARCHIVE_BOX_X = 52
const BAR_TO_RULE_PX = 20
// ⭐ THE COLOUR'S FIGMA NAME IS NOT ITS TOKEN NAME. Both rectangles are STYLED `inverse-primary` in the
// file and both resolve to #9dcbfc, which is this repo's --color-primary; `tokens.css` has its own
// --color-inverse-primary at #32628d, a different colour one name-lookup away. The glyphs carry the same
// fill, so this constant is read back on four elements below.
const PRIMARY_INK = 'rgb(157, 203, 252)' /* --color-primary #9dcbfc */
const RULE_OPACITY = '0.6'
// The number the whole bar exists to produce: 24 (card top) + 24 (bar row) + 20 (bar gap) + 1 (rule) +
// 28 (the card's column gap, carried as the tree's top padding). #1444's first message row takes the same
// 97 from ITS card's top edge, which is what makes the two panes read as one design — each is measured
// from its own card and neither ticket reads the other's number.
const HEADER_TOP_PX = 97

// Enough rows that the tree really overruns the 800px window the app opens at, for the scroll block that
// closes the drive. The sibling pill specs' count, and deliberately not tuned to the exact overflow: a
// taller window must still scroll here.
const TALL_ROW_COUNT = 40

const TIMEOUT_MS = 15_000

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

// The two rectangles' paint, read as one object so a single failure diff shows colour and opacity at once.
const paintOf = (locator: Locator): Promise<{ colour: string; opacity: string }> =>
  locator.evaluate((el) => {
    const style = getComputedStyle(el)
    return { colour: style.backgroundColor, opacity: style.opacity }
  })

// The tall list for the closing scroll block, pushed as an UNSOLICITED `conversations` envelope. It
// cannot be the launch seed: `launchPairedApp` reaches the thread by clicking a single STRICT
// `.channel-list__row-open`, so a multi-row list strict-violates before the drive's first line runs. The
// sibling pill specs' idiom — `daemonConnection`'s inbound `conversations` arm dispatches on the inner
// frame's `type` with no correlation-id match, so an unsolicited one is consumed exactly like a reply.
// Pushed LAST, after every box above has been read, so the stateful fake's own list is never consulted
// again and cannot disagree with what the store now holds.
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

test('the sidebar card sits at its drawn inset under its top bar: 24/20/20, a 24px bar, a rule, and the header at 97', async ({
  launchPairedApp
}) => {
  const buildReplyFrames = conversationStateFake({
    conversations: [seed({ is_promoted: true })]
  })
  const { page, daemon } = await launchPairedApp({ buildReplyFrames })

  const card = page.locator('.paired-shell__sidebar')
  // ⭐ TWO ELEMENTS WHERE THERE USED TO BE ONE, and the split is the whole of #1443's fallout. Until then
  // `.channel-list` was both the padded card column and the scrollport; now it is the padded column only
  // and `.channel-list__tree` inside it scrolls and clips. Every read below that depends on WHICH box
  // scrolls — the trailing-edge derivation, the bottom inset, the closing scroll block — names the tree.
  const list = page.locator('.channel-list')
  const tree = page.locator('.channel-list__tree')
  const bar = page.locator('.channel-list__actions')
  const rule = page.locator('.channel-list__actions-rule')
  const gear = page.locator('.channel-list__settings')
  const archive = page.locator('.channel-list__archive')
  const headers = page.locator('.channel-list__section-header')
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

  // Since #1070 the seed alone already renders BOTH sections, both host rows and the divider — every
  // paired machine gets a row in each section whether or not it has conversations there. Add workspace is
  // what mints the second ROW, which is what the geometry below needs (an open row and a resting one, and
  // a workspace group in each section). Counted before any box is read.
  await expect(rows).toHaveCount(1)
  await expect(divider).toHaveCount(1)
  await expect(headers).toHaveCount(2)
  await expect(hosts).toHaveCount(2)
  await mintChatInWorkspace(page, WORKSPACE_CWD)
  await expect(rows).toHaveCount(2)
  await expect(headers).toHaveCount(2)
  await expect(hosts).toHaveCount(2)
  await expect(workspaces).toHaveCount(2)
  await expect(divider).toHaveCount(1)

  const cardBox = await boxOf(card, 'sidebar card')
  const left = cardBox.x
  // The trailing edge is the card's own right edge less whatever a classic (non-overlay) scrollbar took
  // from THE ELEMENT THAT SCROLLS, so a scrollbar on the host machine cannot move it. Since #1443 that
  // element is the tree wrapper, not `.channel-list`: the scrollbar moved inward with the scrollport, so
  // a derivation left on the column would drift these reads by a scrollbar width on a classic-scrollbar
  // machine. Same shape as the `clientWidth` read it replaces, one level down — on an overlay-scrollbar
  // machine the difference is 0 and this is the card's edge exactly.
  const scrollbarPx = await tree.evaluate((el) => el.offsetWidth - el.clientWidth)
  const right = left + cardBox.width - scrollbarPx

  // ⭐ ...AND THE STRIP THAT SCROLLBAR TAKES IS THE CARD'S RIGHT INSET, which is a regression read rather
  // than a restatement of block 1. The tree's own box bleeds back through that inset — leading edge at the
  // content edge, trailing edge flush with the CARD's — so whatever width a bar takes lands in the 20 the
  // card already reserves instead of over the column of trailing controls that every row, section header
  // and workspace head ends at. It shipped once without the bleed and the derivation above could not see
  // it: an OVERLAY bar takes no width, so `scrollbarPx` read 0, every assertion in this file stayed green,
  // and the three name-pill specs timed out instead with `.channel-list__tree` intercepting the pointer at
  // each trailing control. One read covers both bar kinds — a classic one is taken out of this box's
  // content and `right` already carries it.
  const treeSpan = await boxOf(tree, 'sidebar tree')
  expectAbout(treeSpan.x - left, CARD_INSET_PX)
  expectAbout(left + cardBox.width - (treeSpan.x + treeSpan.width), 0)

  // --- 1. Every level shares the card's 20px inset: the header, the host row and the workspace row all
  // start at the content edge, and the rows one list-indent further in. `x` is the box's left edge, so
  // these read the container's padding, not each element's own. ---
  for (const header of await headers.all()) expectAbout((await boxOf(header, 'header')).x - left, CARD_INSET_PX)
  for (const host of await hosts.all()) expectAbout((await boxOf(host, 'host row')).x - left, CARD_INSET_PX)
  for (const ws of await workspaces.all()) expectAbout((await boxOf(ws, 'workspace row')).x - left, WORKSPACE_ROW_X)
  for (const row of await rows.all()) expectAbout((await boxOf(row, 'sidebar row')).x - left, ROW_X)

  // --- 2. The row spans to the content edge — the open row's fill (#1098) ends where the card's inset
  // begins, 348 wide in the 360 content box since #1506 moved the indent to 12 (`Channel list` 103:2985
  // draws its rows 348 wide at x 8 inside a wrapper at x 4). This is the assertion that keeps each of
  // those moves a MOVE rather than a shrink — #1171's widening to 28 and 332, and #1506's step back to
  // 12: block 1 pins the leading edge and this one pins the trailing edge, so a row that got narrower on
  // both sides would redden here. Read on both rows: one is the open one, one is resting. ---
  for (const row of await rows.all()) {
    const box = await boxOf(row, 'sidebar row')
    expectAbout(right - (box.x + box.width), CARD_INSET_PX)
  }

  // ...and so does the workspace row, which is the OTHER half of #1178's nest. Block 1 pins its leading
  // edge 4 in and this one pins its trailing edge flush with the content edge, so a row that took the
  // nest as a symmetric inset — or as a shrink — reddens here rather than passing on one edge. 356 wide
  // in the 360 content box, which is the instance 405:7456's own width; #1178's 20px nest drew it at 340.
  for (const ws of await workspaces.all()) {
    const box = await boxOf(ws, 'workspace row')
    expectAbout(right - (box.x + box.width), CARD_INSET_PX)
  }

  // --- 3. The glyphs and labels land on the design's x: this is the alignment an operator actually sees,
  // each level's marker one step further in than the one above it. ---
  for (const icon of await hostIcons.all()) expectAbout((await boxOf(icon, 'host glyph')).x - left, HOST_ICON_X)
  for (const label of await hostLabels.all()) expectAbout((await boxOf(label, 'host label')).x - left, HOST_LABEL_X)
  for (const icon of await workspaceIcons.all()) expectAbout((await boxOf(icon, 'workspace glyph')).x - left, WORKSPACE_ICON_X)
  for (const label of await workspaceLabels.all()) expectAbout((await boxOf(label, 'workspace label')).x - left, WORKSPACE_LABEL_X)
  for (const dot of await dots.all()) expectAbout((await boxOf(dot, 'status dot')).x - left, DOT_X)
  for (const title of await titles.all()) expectAbout((await boxOf(title, 'row title')).x - left, TITLE_X)

  // The alignment #1178 exists for, asserted as an EQUALITY between the two constants rather than as two
  // independent numbers that happen to agree. The workspace label and the channel titles beneath it share
  // one left edge, so moving either padding without the other fails here even if both still land on a
  // round number.
  expect(WORKSPACE_LABEL_X).toBe(TITLE_X)

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

  // --- 6. THE TOP BAR (#1443, Figma 115:3693) — the card's first child, a 24px row at the card's 24px top
  // inset with the gear at the content edge and the archive box 52 in, both 24 × 24. The ALIGNMENT and the
  // ORDER both flip here: until #1443 this was an archive-then-gear cluster pinned top-RIGHT, and the
  // drawing puts the gear first at the left edge. ---
  const barBox = await boxOf(bar, 'top bar')
  expectAbout(barBox.y - cardBox.y, CARD_TOP_INSET_PX)
  expectAbout(barBox.height, BAR_ROW_PX)

  const gearBox = await boxOf(gear, 'settings button')
  const archiveBox = await boxOf(archive, 'archive button')
  expectAbout(gearBox.x - left, CARD_INSET_PX)
  expectAbout(archiveBox.x - left, CARD_INSET_PX + ARCHIVE_BOX_X)
  for (const [role, box] of [
    ['settings', gearBox],
    ['archive', archiveBox]
  ] as const) {
    expect(Math.abs(box.width - BAR_BOX_PX), `${role} box width`).toBeLessThanOrEqual(
      GEOMETRY_TOLERANCE_PX
    )
    expect(Math.abs(box.height - BAR_BOX_PX), `${role} box height`).toBeLessThanOrEqual(
      GEOMETRY_TOLERANCE_PX
    )
    expect(Math.abs(box.y - barBox.y), `${role} box top`).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX)
  }

  // The ink is the token and the ground is NOTHING. The 48px pair these replace carried the
  // `.settings__back` treatment — transparent until hover, then surface-container-high — and the drawing
  // fills both glyphs --color-primary and draws no circle in any state it draws. A hover fill left behind
  // reads back here at rest as a transparent ground, so this pins the resting half; the rule that used to
  // paint it is deleted rather than overridden.
  for (const [role, control] of [
    ['settings', gear],
    ['archive', archive]
  ] as const) {
    const drawn = await control.evaluate((el) => {
      const style = getComputedStyle(el)
      return { colour: style.color, ground: style.backgroundColor }
    })
    expect(drawn, `${role} button`).toEqual({ colour: PRIMARY_INK, ground: 'rgba(0, 0, 0, 0)' })
  }

  // --- 7. THE RULE under it (497:1852): 1px, 20 below the bar, spanning the card's content box. Its span
  // is read against the CARD's own box and NOT against `right` — the rule sits outside the scroller, so a
  // classic scrollbar moves the rows inward and leaves this line exactly where the card's inset put it. ---
  const ruleBox = await boxOf(rule, 'top bar rule')
  expectAbout(ruleBox.height, 1)
  expectAbout(gapBetween(barBox, ruleBox), BAR_TO_RULE_PX)
  expectAbout(ruleBox.x - left, CARD_INSET_PX)
  expectAbout(left + cardBox.width - (ruleBox.x + ruleBox.width), CARD_INSET_PX)

  // --- 8. AC2's colour claim, written as an EQUALITY between two live reads rather than as two literals
  // that happen to agree: the node draws the section divider (103:3009) and the bar's rule (497:1852) as
  // the SAME rectangle, and the 2026-09-05 inset fix left the divider on --color-outline-variant while
  // deliberately leaving the colour question open. A change that moved only one of them still satisfies
  // its own literal and fails here. The rule's own absolute values are pinned first, so "equal" cannot be
  // satisfied by both being wrong together. ---
  const rulePaint = await paintOf(rule)
  expect(rulePaint).toEqual({ colour: PRIMARY_INK, opacity: RULE_OPACITY })
  expect(await paintOf(divider)).toEqual(rulePaint)

  // --- 9. THE NUMBER THE WHOLE BAR EXISTS TO PRODUCE, and the card's other inset. The Channels header's
  // top sits 97 below the card's top edge; the tree's bottom edge is the only element that can report the
  // card's 20px bottom inset, the column itself being stretched to the card's full height. ---
  expectAbout((await boxOf(headers.nth(0), 'Channels header')).y - cardBox.y, HEADER_TOP_PX)
  const treeBox = await boxOf(tree, 'tree wrapper')
  expectAbout(cardBox.y + cardBox.height - (treeBox.y + treeBox.height), CARD_BOTTOM_INSET_PX)

  // --- 10. AC2's first clause, and the one block that can tell the tree wrapper from the column it was
  // split out of: with a list tall enough to overflow, scrolling moves the ROWS and leaves the bar and its
  // rule exactly where they are. A bar left inside the scroller satisfies every block above and fails
  // here. `.channel-list` is read back as NOT overflowing in the same breath — that is what says the
  // scrollport really moved rather than there being two of them. ---
  daemon.pushFrame(tallListFrame())
  await expect(rows).toHaveCount(TALL_ROW_COUNT, { timeout: TIMEOUT_MS })
  expect(await tree.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true)
  expect(await list.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1)

  const restingRow = await boxOf(rows.first(), 'first row at rest')
  const scrolled = await tree.evaluate((el) => {
    el.scrollTop = el.scrollHeight
    return el.scrollTop
  })
  // Read back rather than assumed: writing `scrollTop` to an element that does not scroll is a SILENT
  // no-op, which is exactly how this whole family of reads fails open rather than red.
  expect(scrolled).toBeGreaterThan(0)
  expect((await boxOf(rows.first(), 'first row after the scroll')).y).toBeLessThan(restingRow.y)
  expectAbout((await boxOf(bar, 'top bar after the scroll')).y, barBox.y)
  expectAbout((await boxOf(rule, 'rule after the scroll')).y, ruleBox.y)
})
