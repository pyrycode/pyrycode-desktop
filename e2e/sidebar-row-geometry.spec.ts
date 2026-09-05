import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import type { ConversationSummary } from '../src/shared/wire/types'
import type { Locator } from '@playwright/test'

// Fake-stack UI e2e for THE DESKTOP SIDEBAR ROW'S GEOMETRY (#1097, Figma node 103:2968, list frame
// 103:2985). Only this tier can prove it: `vitest.config.ts` sets `environment: 'node'`, every renderer
// spec is a `renderToStaticMarkup` string assertion, and there is no DOM and no layout engine there to
// measure a box height, a computed font size, a corner radius or a dot's centre with. The renderer tier
// owns the markup contract — that no last-activity time is EMITTED (ChannelList.test.tsx); this spec owns
// everything that only a laid-out page can answer.
//
// A DEDICATED FILE rather than an extension of host-label-sidebar.spec.ts, which is the nearest existing
// reader of sidebar box coordinates. That spec's header scopes it to the host row and forbids asserting
// its label by value, and it seeds a deliberately single unpromoted row for a stated reason; folding a
// row-geometry drive into it would mean rewriting that framing rather than adding to it.
//
// TWO test() blocks, each its own launchPairedApp launch, because AC4's two halves need two different
// seeds and one launch cannot carry both. The Save-as-channel affordance renders only on an UNPROMOTED
// row (under "Chats") and Rename only on a PROMOTED one (under "Channels"), and launchPairedApp reaches
// the thread by clicking a single STRICT `.channel-list__row-open`, so a two-seed single launch
// strict-violates at launch. Both seeds are clickable at launch either way: `.channel-list__row-open`
// renders on every row, promoted or not (save-as-channel-promote.spec.ts:19-20 states and relies on this).
//
// SECRET HYGIENE (the sibling specs' posture). Every assertion below reads a NUMBER (a box coordinate, a
// computed length, an element count) or a computed colour STRING — never a seed name, never a label, never
// row text. No failure diff can print daemon-derived content. The pairing plumbing (synthetic token, fake
// static key) lives in launchPairedApp and is never echoed. The seed cwd is a fixed fake remote path,
// never resolved locally (the #380/#139 opaque-remote-path posture).

// --- The node's measurements. Each is the DERIVED result of a token, never the token's own name: the
// point of asserting here rather than in a stylesheet-reading test is that the browser did the
// arithmetic. 24 = 4px padding + a 16px line box + 4px padding, with no `height` declared anywhere. ---
const ROW_HEIGHT_PX = 24
const ROW_GAP_PX = 4
const ROW_CORNER_PX = 6

// `Schemes/On Surface` #e0e2e8, the node's label colour, as Chromium reports a computed colour.
const ON_SURFACE_RGB = 'rgb(224, 226, 232)'

// The node's `M3/body/small`: 12/16, tracking 0.4, weight 400.
const LABEL_SIZE_PX = '12px'
const LABEL_LINE_PX = '16px'
const LABEL_TRACKING_PX = '0.4px'
const LABEL_WEIGHT = '400'

// Sub-pixel tolerance for a device-pixel-ratio-scaled layout, copied from host-label-sidebar.spec.ts.
// One physical pixel of slack: enough that a fractional box coordinate cannot flake, far too little to
// hide the design's 3px dot drop (the offset AC5 rules out) or a trailing control stuck at its old 40px.
const GEOMETRY_TOLERANCE_PX = 1

// The cwd `conversationStateFake` resolves a null-cwd `create_conversation` to. Both seeds use it so a
// FAB-minted row lands in the SAME workspace group as the seed and the two rows are adjacent siblings —
// which is the only arrangement in which `.channel-list__row + .channel-list__row` fires at all.
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

// `boundingBox()` returns null for a detached or hidden node. Throwing beats `!` and beats a `?? -1`
// sentinel, because every consumer below does arithmetic on the result and a sentinel would turn a missing
// box into a wrong number. The message names the LOCATOR's role, never a value.
const boxOf = async (locator: Locator, role: string): Promise<Box> => {
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`expected a laid-out box for the ${role}`)
  return box
}

const computed = (locator: Locator, property: string): Promise<string> =>
  locator.evaluate(
    (el, prop) => window.getComputedStyle(el).getPropertyValue(prop),
    property
  )

// The vertical distance from one box's bottom edge to the next box's top edge.
const gapBetween = (above: Box, below: Box): number => below.y - (above.y + above.height)

const expectAbout = (actual: number, expected: number): void => {
  expect(actual).toBeGreaterThanOrEqual(expected - GEOMETRY_TOLERANCE_PX)
  expect(actual).toBeLessThanOrEqual(expected + GEOMETRY_TOLERANCE_PX)
}

test('a Chats row is the desktop 24px row: no time, body-small label, 6px corner, 4px pitch', async ({
  launchPairedApp
}) => {
  // The stateful fake owns the list and answers the auto-fired `list_conversations` from it, so the seed
  // below fully replaces the fixture's default one-row seed. It also mints a row on `create_conversation`
  // and re-lists — which is how the second adjacent row further down is reached without a second
  // clickable seed at launch.
  const buildReplyFrames = conversationStateFake({
    conversations: [seed({ is_promoted: false })]
  })
  const { page } = await launchPairedApp({ buildReplyFrames })

  const row = page.locator('.channel-list__row')
  const open = page.locator('.channel-list__row-open')
  const title = page.locator('.channel-list__title')
  const dot = page.locator('.channel-list__row .conversation-status-dot')
  const save = page.locator('.channel-list__save')

  await expect(row).toHaveCount(1)
  await expect(save).toHaveCount(1)

  // --- 1. AC1's height. Polled, because it is the first box read after the list renders. This assertion
  // is a real detector ONLY because no rule declares a height: it is the sum of the label's line box and
  // the row's padding, so a trailing control left at its old 40px box would push it past 24 and redden
  // here. A `height: 24px` in the stylesheet would have made it undetecting — the `.composer__footer`
  // shape, whose hard 20px height no boundingBox().height assertion can ever fail against. ---
  const rowHeight = async (): Promise<number> => (await boxOf(row, 'sidebar row')).height
  await expect.poll(rowHeight).toBeLessThanOrEqual(ROW_HEIGHT_PX + GEOMETRY_TOLERANCE_PX)
  expectAbout(await rowHeight(), ROW_HEIGHT_PX)

  // --- 2. AC1's padding and corner, read off `.channel-list__row-open` — the only element in the row that
  // paints, and therefore the surface the hover fill's corner is observable on. The four padding
  // longhands are read individually rather than through the shorthand so a failure names the side. ---
  expect(await computed(open, 'padding-top')).toBe('4px')
  expect(await computed(open, 'padding-bottom')).toBe('4px')
  expect(await computed(open, 'padding-right')).toBe('16px')
  // 32px, unchanged since #801: the node's title inset (16px dot inset + 6px dot + the node's 10px gap),
  // which is also why the row itself declares no gap. Pinned so a future retune of the row's leading
  // geometry has to come here first.
  expect(await computed(open, 'padding-left')).toBe('32px')
  expect(await computed(open, 'border-top-left-radius')).toBe(`${ROW_CORNER_PX}px`)
  expect(await computed(open, 'border-bottom-right-radius')).toBe(`${ROW_CORNER_PX}px`)

  // --- 3. AC2: the label is body-small in on-surface, not the title-medium it used to be. Asserted as the
  // COMPUTED values the browser resolved, so this fails if the tokens are swapped for the wrong quad, if
  // a token's own value drifts, or if a literal is substituted. ---
  expect(await computed(title, 'font-size')).toBe(LABEL_SIZE_PX)
  expect(await computed(title, 'line-height')).toBe(LABEL_LINE_PX)
  expect(await computed(title, 'letter-spacing')).toBe(LABEL_TRACKING_PX)
  expect(await computed(title, 'font-weight')).toBe(LABEL_WEIGHT)
  expect(await computed(title, 'color')).toBe(ON_SURFACE_RGB)

  // --- 4. AC3's negative, in the tier where the row is actually laid out: no last-activity time renders
  // anywhere in the sidebar. A count, so the failure diff prints a number rather than daemon text. The
  // three surviving `formatLastActivity` callers are unreachable from this screen and are covered by
  // their own unit tests. ---
  await expect(page.locator('.channel-list__time')).toHaveCount(0)

  // --- 5. AC4, first half: the Save-as-channel control sits INSIDE the 24px row without growing it.
  // `.channel-list__row` is a centred flex line, so its tallest child sets its height — this is the pair
  // of assertions that would redden together if the control's 16px glyph or its --space-1 padding were
  // reverted to the 24px/--space-2 pair that made a 40px box. ---
  const saveBox = await boxOf(save, 'Save-as-channel control')
  expect(saveBox.height).toBeLessThanOrEqual(ROW_HEIGHT_PX + GEOMETRY_TOLERANCE_PX)
  expectAbout((await boxOf(row, 'sidebar row')).height, ROW_HEIGHT_PX)

  // --- 6. AC5: the dot's centre sits on the ROW's centre. The design's own frame drops its dot 3px (its
  // circle sits at cy=11 inside a 14px wrapper the app does not draw), and #1097 ruled that offset out as
  // an artifact of that wrapper. This assertion is what would redden if it were ported: 3px is three times
  // the tolerance. ---
  const rowBox = await boxOf(row, 'sidebar row')
  const dotBox = await boxOf(dot, 'status dot')
  expectAbout(dotBox.y + dotBox.height / 2, rowBox.y + rowBox.height / 2)

  // --- 7. AC1's pitch. Mint a second row through the real product control — the new-discussion FAB sends
  // `create_conversation` with a null cwd, which the fake resolves to the seed's own workspace, so the two
  // rows land in ONE group as adjacent siblings. Both assertions matter and they fail in opposite
  // directions: a `gap` on the `.channel-list` column would produce the 4px between rows AND move the
  // workspace row's spacing, which AC1's second half forbids. The adjacent-sibling rule produces the
  // first and leaves the second at the zero it has today. ---
  await page.getByRole('button', { name: 'New discussion' }).click()
  await expect(row).toHaveCount(2)
  await expect(page.locator('.channel-list__workspace')).toHaveCount(1)

  const firstRow = await boxOf(row.nth(0), 'first sidebar row')
  const secondRow = await boxOf(row.nth(1), 'second sidebar row')
  const workspaceRow = await boxOf(page.locator('.channel-list__workspace'), 'workspace row')

  expectAbout(gapBetween(firstRow, secondRow), ROW_GAP_PX)
  expectAbout(gapBetween(workspaceRow, firstRow), 0)
  // Both rows kept the height, so the pitch really is 24-on-28 and not one row that grew.
  expectAbout(firstRow.height, ROW_HEIGHT_PX)
  expectAbout(secondRow.height, ROW_HEIGHT_PX)

  // --- 8. AC4, first half's other clause: the shrunken control still OPENS its dialog. Geometry that
  // silently broke the click would satisfy every assertion above. `.first()` because there are two rows
  // by now; either row's control proves the same thing. ---
  await save.first().click()
  await expect(page.locator('.save-as-channel-overlay')).toBeVisible()
})

test('a Channels row holds the Rename control inside the same 24px row', async ({
  launchPairedApp
}) => {
  // The second seed, PROMOTED — it renders under "Channels" with the Rename affordance and no
  // Save-as-channel one. That is the only difference from the block above, and it is why this needs its
  // own launch rather than a second drive: promotion is one-way and the two affordances are disjoint by
  // section, so no single row can carry both.
  const buildReplyFrames = conversationStateFake({
    conversations: [seed({ is_promoted: true })]
  })
  const { page } = await launchPairedApp({ buildReplyFrames })

  const row = page.locator('.channel-list__row')
  const rename = page.locator('.channel-list__rename')

  await expect(row).toHaveCount(1)
  await expect(rename).toHaveCount(1)
  // The disjointness the affordance's own contract rests on, restated as this block's precondition.
  await expect(page.locator('.channel-list__save')).toHaveCount(0)

  // AC4, second half: the Rename control sits inside the 24px row without growing it. Same pair of
  // assertions as the Save control's, against the rule that carries its own copy of the 16px/--space-1
  // treatment — so reverting either rule alone reddens exactly one of the two blocks.
  const rowHeight = async (): Promise<number> => (await boxOf(row, 'sidebar row')).height
  await expect.poll(rowHeight).toBeLessThanOrEqual(ROW_HEIGHT_PX + GEOMETRY_TOLERANCE_PX)
  expectAbout(await rowHeight(), ROW_HEIGHT_PX)

  const renameBox = await boxOf(rename, 'Rename control')
  expect(renameBox.height).toBeLessThanOrEqual(ROW_HEIGHT_PX + GEOMETRY_TOLERANCE_PX)

  // AC3 holds on this tree too — the Channels rows read the same `Row` component, and a time reintroduced
  // for promoted rows only would pass the other block.
  await expect(page.locator('.channel-list__time')).toHaveCount(0)

  // And it still opens its dialog.
  await rename.click()
  await expect(page.locator('.rename-conversation-overlay')).toBeVisible()
})
