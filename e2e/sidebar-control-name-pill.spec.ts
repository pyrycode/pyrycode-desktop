import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, ConversationsPayload } from '../src/shared/wire/types'
import type { Locator, Page } from '@playwright/test'

// #1172 — the name pill a sidebar row's trailing control shows on hover and on keyboard focus, in the one
// tier that can hover or focus anything. `vitest.config.ts` sets `environment: 'node'` and every renderer
// spec is a `renderToStaticMarkup` string assertion, so `ChannelList.test.tsx` owns the markup (one pill
// per control, appended after the glyph, `aria-hidden`, its text off the same constant as the
// `aria-label`) and everything below is what only a running window can answer: that the two triggers show
// and hide it, that it is drawn in the Pill's own treatment, and that it lands inside the scroller that
// clips on every row.
//
// ⭐ A BOUNDING BOX IS NOT A DETECTOR FOR A CLIP, which is why the geometry here is written as containment
// inside `.channel-list` and not as `toBeVisible()` or as "inside the window".
// `e2e/composer-attachment-name.spec.ts` states the same trap for the same treatment one screen over: a
// layout box comes back whether or not an ancestor clipped the pixels away. `.channel-list` is
// `overflow-y: auto`, which forces `overflow-x` off `visible` too, so it clips on BOTH axes, and
// `.paired-shell__sidebar` is a second `overflow: hidden` outside it — a window-relative assertion would
// pass with the pill fully cut off. The tighter ancestor is the one asserted against.
//
// ⭐ WHICH ASSERTION IS THE PLACEMENT DETECTOR — MEASURED, NOT ASSUMED. Re-pointing
// `.channel-list__control-name` at the composer pill's own placement (`bottom: calc(100% + --space-2)`,
// one row up) and rebuilding reddens the FIRST-ROW BAND assertion by exactly 32px. It does NOT redden any
// containment assertion in this file, and that is worth stating rather than glossing: `.channel-list__actions`
// is sticky at the scroller's top-right, so no hoverable control ever sits nearer the top edge than that
// cluster's own height, and 32px of headroom survives even on the highest row a pointer can reach. So the
// containment reads below are the CRITERION this ticket owes, and the band assertion is what makes them
// true on rows no test visits. Both are kept; neither stands in for the other.
//
// ONE test() block, ONE launch, ONE continuous drive (the sibling pill spec's shape): each launch pays a
// full handshake, and the ordering is load-bearing throughout — every absence assertion is placed after a
// positive, auto-waiting read of the same gesture's own effect.

const TIMEOUT_MS = 15_000

// The Pill's own drawing (Figma 347:6617), as computed values. ⭐ THE TWO COLOURS ARE THE TRANSPOSITION
// DETECTOR: the Figma export bakes #cfe4ff under the name `primary-container` and #134a74 under
// `on-primary-container`, which is the pair swapped against tokens.css. A rule that named the transposed
// pair computes to exactly these two REVERSED, so this is the assertion that catches it — #1262, #969 and
// #1265 each hit that trap, and nothing in the static tier can see a colour at all.
const PILL_GROUND = 'rgb(19, 74, 116)' /* --color-primary-container #134a74 */
const PILL_INK = 'rgb(207, 228, 255)' /* --color-on-primary-container #cfe4ff */
// body-small REGULAR, the node's type.
const PILL_WEIGHT = '400'
// 4 + the 16px body-small line + 4 — the same 24 the row itself derives, which is what puts the pill
// inside the row's own band rather than over a neighbour.
const PILL_HEIGHT_PX = 24

// The two control names, restated here as the literals the operator reads rather than imported from the
// screen. A constant imported from the code under test would agree with itself if both moved together;
// these are the words the criterion names.
const RENAME_NAME = 'Rename'
const SAVE_NAME = 'Save as channel'

// `pairedShell.css` gives the sidebar `flex: 0 0 400px`. Showing a pill must not move it.
const SIDEBAR_WIDTH_PX = 400

// Sub-pixel tolerance, the sibling specs' EPSILON.
const EPSILON_PX = 1.5

// Enough promoted rows that the Channels tree alone (a 28px pitch under a header, a host row and a
// workspace row) overruns the 800px window the app opens at, so `.channel-list` really scrolls and the
// first and last rows are at genuinely different scroll positions. Deliberately not tuned to the exact
// overflow: a taller window must still scroll here.
const PROMOTED_ROW_COUNT = 40

// One workspace for every row — the fixture's own, so the pushed rows land in the SAME group as the
// seeded one and the tree is one host row over one workspace row rather than a forest.
const WORKSPACE_CWD = SEEDED_ROW.cwd

// Names carrying no substring of either control name, so a `hasText`-shaped mistake in this file could not
// pass on a row title. Indexed so a failure diff names which row, and no name is daemon-derived.
const promotedRows = (): ConversationSummary[] =>
  Array.from({ length: PROMOTED_ROW_COUNT }, (_, index) => ({
    id: `pill-row-${index}`,
    name: `Channel ${index}`,
    is_promoted: true,
    is_archived: false,
    cwd: WORKSPACE_CWD,
    last_message_ts: '2026-07-07T12:00:00.000Z',
    last_used_at: '2026-07-07T12:00:00.000Z'
  }))

// The tall list, pushed as an UNSOLICITED `conversations` envelope after launch. It cannot be the launch
// seed: `launchPairedApp` reaches the thread by clicking a single STRICT `.channel-list__row-open`, so a
// multi-row list strict-violates before this spec's first line runs. The fixture's own idiom for the same
// problem is `daemon.pushFrame(seedConversationsFrame(…))` — `daemonConnection`'s inbound `conversations`
// arm dispatches on the inner frame's `type` with no correlation-id match, so an unsolicited one is
// consumed exactly like a reply. The seeded row rides along FIRST so the open conversation is not
// orphaned; being unpromoted it lands in Chats, which is what puts the one Save-as-channel control on the
// list's LAST row and the 40 Rename controls above it.
const tallListFrame = (): Uint8Array =>
  encodeEnvelope({
    id: 1,
    type: 'conversations',
    ts: '2026-07-07T12:00:00.000Z',
    payload: { conversations: [SEEDED_ROW, ...promotedRows()] } satisfies ConversationsPayload
  })

type Box = { x: number; y: number; width: number; height: number }

// `boundingBox()` returns null for a detached or hidden node. Throwing beats `!` and beats a sentinel,
// because every consumer below does arithmetic on the result. The message names the LOCATOR's role, never
// a value (the sibling specs' secret hygiene: every assertion here reads a number, a computed colour
// string or one of the two client-owned control names — never a row title).
const boxOf = async (locator: Locator, role: string): Promise<Box> => {
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`expected a laid-out box for the ${role}`)
  return box
}

// Every pill's computed `display`, as a set — the absence claims below are whole-set reads rather than
// per-element ones, so a pill left showing on some other row fails them instead of going unlooked-at.
const displays = (pills: Locator): Promise<string[]> =>
  pills.evaluateAll((elements) => elements.map((el) => window.getComputedStyle(el).display))

const allHidden = async (pills: Locator, count: number): Promise<void> => {
  expect(await displays(pills)).toEqual(Array.from({ length: count }, () => 'none'))
}

// THE CRITERION. Not `toBeVisible()`, not "inside the window" — see this file's header.
const expectInsideList = (pill: Box, list: Box, role: string): void => {
  expect(pill.x, `${role}: left edge`).toBeGreaterThanOrEqual(list.x - EPSILON_PX)
  expect(pill.y, `${role}: top edge`).toBeGreaterThanOrEqual(list.y - EPSILON_PX)
  expect(pill.x + pill.width, `${role}: right edge`).toBeLessThanOrEqual(
    list.x + list.width + EPSILON_PX
  )
  expect(pill.y + pill.height, `${role}: bottom edge`).toBeLessThanOrEqual(
    list.y + list.height + EPSILON_PX
  )
}

const scrollListTo = (page: Page, offset: 'top' | 'bottom'): Promise<void> =>
  page.locator('.channel-list').evaluate((el, where) => {
    el.scrollTop = where === 'top' ? 0 : el.scrollHeight
  }, offset)

test('a row control names itself in a pill on hover and on focus, inside the scroller on every row', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp()

  const list = page.locator('.channel-list')
  const rows = page.locator('.channel-list__row')
  // ⭐ SCOPED TO `.channel-list__row` SINCE #1181, which gave the WORKSPACE row's plus the same pill
  // class. That control lives in `.channel-list__workspace-head`, not in a row, so this scope restores
  // every count and every `first()` / `last()` below to exactly the element it was written for — and
  // without it the breakage is worse than arithmetic: the workspace head precedes its group's rows in
  // document order, so `pills.first()` would silently stop being the first row's Rename pill. Nothing
  // else in this file moved; the workspace pills are `e2e/sidebar-workspace-plus-name-pill.spec.ts`'s.
  const pills = page.locator('.channel-list__row .channel-list__control-name')
  const renames = page.locator('.channel-list__rename')
  const save = page.locator('.channel-list__save')
  const sidebar = page.locator('.paired-shell__sidebar')

  // The launch seed: one row, one control, one pill — already enough to prove the pill is MOUNTED and
  // hidden before anything is hovered.
  await expect(rows).toHaveCount(1)
  await expect(pills).toHaveCount(1)

  daemon.pushFrame(tallListFrame())
  const rowCount = PROMOTED_ROW_COUNT + 1
  await expect(rows).toHaveCount(rowCount, { timeout: TIMEOUT_MS })
  await expect(renames).toHaveCount(PROMOTED_ROW_COUNT)
  await expect(save).toHaveCount(1)

  // The list really does overrun its own viewport, so "the first row" and "the last row" below are at
  // different scroll positions rather than both on screen at once. Asserted rather than assumed: a window
  // that grew, or a pitch that shrank, would otherwise quietly turn the two scrolled blocks into one.
  const overflows = await list.evaluate((el) => el.scrollHeight > el.clientHeight + 1)
  expect(overflows).toBe(true)

  // --- Resting: every pill is MOUNTED and every pill is hidden. A count AND a hidden-ness, not one or
  // the other: the count proves the elements exist to be shown (an absent pill satisfies a hidden-ness
  // vacuously), and `display: none` is what the two triggers below have to change. ---
  await expect(pills).toHaveCount(rowCount)
  await allHidden(pills, rowCount)

  // --- AC1, the hover, on the FIRST row with the list scrolled to the top. The positive read comes
  // first; the set read beside it is what makes this "that control's pill" rather than "a pill somewhere".
  // ---
  await scrollListTo(page, 'top')
  await renames.first().hover()
  const firstPill = pills.first()
  await expect(firstPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(firstPill).toHaveText(RENAME_NAME)
  expect((await displays(pills)).filter((display) => display !== 'none')).toEqual(['block'])

  // --- AC2, the drawing, as computed values. The two colours are the transposition detector above; the
  // weight, size, line and tracking are the node's body-small regular; `nowrap` is what makes it one line;
  // `pointer-events` is what lets a click aimed at the row read straight through a pill sitting over it.
  // ---
  const drawn = await firstPill.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      background: style.backgroundColor,
      color: style.color,
      fontWeight: style.fontWeight,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      radius: style.borderTopLeftRadius,
      paddingBlock: style.paddingTop,
      paddingInline: style.paddingLeft,
      whiteSpace: style.whiteSpace,
      position: style.position,
      pointerEvents: style.pointerEvents
    }
  })
  expect(drawn).toEqual({
    background: PILL_GROUND,
    color: PILL_INK,
    fontWeight: PILL_WEIGHT,
    fontSize: '12px',
    lineHeight: '16px',
    letterSpacing: '0.4px',
    radius: '6px',
    paddingBlock: '4px',
    paddingInline: '8px',
    whiteSpace: 'nowrap',
    position: 'absolute',
    pointerEvents: 'none'
  })

  // --- AC3 on the FIRST row: the box is the drawn 24, it sits in the row's own band, and it is inside the
  // scroller. The band claim is what makes the containment hold at every scroll position rather than at
  // this one — a pill drawn above or below its row would satisfy the containment here and fail it under
  // the top-edge block further down. ---
  const firstBox = await boxOf(firstPill, 'first row pill')
  const firstRowBox = await boxOf(rows.first(), 'first row')
  expect(firstBox.height).toBeCloseTo(PILL_HEIGHT_PX, 0)
  expect(firstBox.y).toBeCloseTo(firstRowBox.y, 0)
  expect(firstBox.y + firstBox.height).toBeCloseTo(firstRowBox.y + firstRowBox.height, 0)
  // Right-aligned to the control, so it grows LEFTWARD off the row's right edge and can reach neither
  // horizontal edge of the scroller.
  expect(firstBox.x + firstBox.width).toBeCloseTo(firstRowBox.x + firstRowBox.width, 0)
  expectInsideList(firstBox, await boxOf(list, 'channel list'), 'first row pill')

  // --- AC3's other half, read WHILE that pill is up: the sidebar has not widened and the scroller has
  // gained no horizontal scroll. An out-of-flow box adds scrollable overflow only where it overflows right
  // or bottom, and this one grows leftward — measured rather than argued. ---
  expect((await boxOf(sidebar, 'sidebar')).width).toBeCloseTo(SIDEBAR_WIDTH_PX, 0)
  const horizontal = await list.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(horizontal).toBeLessThanOrEqual(1)

  // --- AC1's scoping clause: hovering the row's TITLE alone shows nothing. Ordered after the positive
  // read above, so it measures the trigger's scope rather than a pill that never showed. A reveal hung off
  // `.channel-list__row:hover` — the scope the GLYPH's own reveal uses, and the natural thing to copy —
  // would light this row's pill and fail here. ---
  await rows.first().locator('.channel-list__title').hover()
  await allHidden(pills, rowCount)

  // --- AC3 on the LAST row, with the list scrolled to the bottom: the row nearest the scroller's bottom
  // edge, which is the case a below-the-row placement clips. That row is the seeded unpromoted one, so
  // this block also carries AC1's other name. ---
  await scrollListTo(page, 'bottom')
  await save.hover()
  const lastPill = pills.last()
  await expect(lastPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(lastPill).toHaveText(SAVE_NAME)
  const lastBox = await boxOf(lastPill, 'last row pill')
  const lastRowBox = await boxOf(rows.last(), 'last row')
  expect(lastBox.y).toBeCloseTo(lastRowBox.y, 0)
  expectInsideList(lastBox, await boxOf(list, 'channel list'), 'last row pill')

  // --- ...and on THE HIGHEST ROW A POINTER CAN REACH, mid-scroll — the case an above-the-row placement
  // clips, and the one no unscrolled read gets near: at `scrollTop: 0` the first row sits a header, a host
  // row and a workspace row below the top edge, with room above it for a pill that does not belong there.
  //
  // ⭐ "HIGHEST REACHABLE" AND NOT "FLUSH WITH THE TOP EDGE", because the row flush with the top edge has
  // no hoverable control at all: `.channel-list__actions` is STICKY at the scroller's top-right with
  // `z-index: 1`, which is exactly where a row's trailing control sits, so the cluster covers it. MEASURED,
  // not predicted — two earlier drafts scrolled a row onto the top edge and hovered its control, and both
  // came back with the row 700px down the viewport: `hover()` scrolls its target into view, so an
  // unhittable control makes Playwright RELOCATE the row rather than fail on it, silently dismantling the
  // arrangement the assertion was set up on. Hence the row is parked immediately under the cluster's own
  // bottom edge, read at runtime rather than assumed, and the post-hover re-read below is what proves it
  // stayed there.
  //
  // THE ROW IS SCROLLED INTO POSITION RATHER THAN SEARCHED FOR. A third draft picked the topmost visible
  // row out of the laid-out rects; it selected the LAST row, because a divider, a second section header, a
  // host row and a workspace row sit between the two trees, so DOM order and visible order do not agree
  // the way that search assumed. Scrolling a KNOWN row to a known y is exact whatever the window height or
  // the tree's shape, and states the arrangement it wants instead of hunting for it. ---
  const HIGH_ROW_INDEX = 20
  // Two readings of where that row sits: its gap below the sticky cluster (the arrangement this block
  // sets up, so ~0) and its distance from the scroller's own top edge (what makes it the HIGH case rather
  // than a mid-list one). Read together in one evaluate so they cannot describe two different scroll
  // positions.
  const rowPosition = (): Promise<{ belowActions: number; belowListTop: number }> =>
    list.evaluate((el, index) => {
      const row = el.querySelectorAll('.channel-list__row')[index]
      const actions = el.querySelector('.channel-list__actions')
      if (actions === null) throw new Error('expected the sticky actions cluster')
      const top = row.getBoundingClientRect().top
      return {
        belowActions: top - actions.getBoundingClientRect().bottom,
        belowListTop: top - el.getBoundingClientRect().top
      }
    }, HIGH_ROW_INDEX)
  await list.evaluate((el, index) => {
    const row = el.querySelectorAll('.channel-list__row')[index]
    const actions = el.querySelector('.channel-list__actions')
    if (actions === null) throw new Error('expected the sticky actions cluster')
    el.scrollTop += row.getBoundingClientRect().top - actions.getBoundingClientRect().bottom
  }, HIGH_ROW_INDEX)
  // Positioned before anything is hovered, so the arrangement the block needs is established rather than
  // hoped for. `belowActions` is asserted against the cluster's own bottom rather than against its height:
  // the scroller's top padding and the cluster's sticky offset both sit between the two, and neither is
  // pinned anywhere, so the relation is read where the arrangement actually lives.
  const placed = await rowPosition()
  expect(placed.belowActions).toBeCloseTo(0, 0)
  expect(placed.belowListTop).toBeLessThan(4 * PILL_HEIGHT_PX)

  const highRow = rows.nth(HIGH_ROW_INDEX)
  await highRow.locator('.channel-list__rename, .channel-list__save').hover()
  const highPill = highRow.locator('.channel-list__control-name')
  await expect(highPill).toBeVisible({ timeout: TIMEOUT_MS })
  // Re-read AFTER the hover: this is what says the row is still where it was put, so the containment below
  // is still measuring the case it was set up for rather than one Playwright scrolled it into.
  const hovered = await rowPosition()
  expect(hovered.belowActions).toBeCloseTo(0, 0)
  expect(hovered.belowListTop).toBeLessThan(4 * PILL_HEIGHT_PX)
  const highBox = await boxOf(highPill, 'high row pill')
  const listBox = await boxOf(list, 'channel list')
  expectInsideList(highBox, listBox, 'high row pill')

  // --- AC1's other half of the hover: leaving hides it. Ordered after the positive read above, so the
  // hidden-ness measures the pointer leaving rather than a pill that was never up. ---
  await page.mouse.move(0, 0)
  await expect(highPill).toBeHidden({ timeout: TIMEOUT_MS })
  await allHidden(pills, rowCount)

  // --- AC1, the keyboard: focus shows it and blur hides it, with the pointer parked off the list — so
  // this can only be `:focus-visible` firing, never a stray hover. Reached by focusing the row's open
  // button and pressing Tab, NOT by `locator.focus()`: `:focus-visible` is Chromium's keyboard-modality
  // heuristic and a programmatic focus after a pointer interaction does not match it, so the assertion
  // would be testing the heuristic rather than the rule. `sidebar-row-geometry.spec.ts` records the same
  // reasoning for the same control's opacity reveal. ---
  await scrollListTo(page, 'top')
  await rows.first().locator('.channel-list__row-open').focus()
  await page.keyboard.press('Tab')
  await expect(renames.first()).toBeFocused()
  await expect(firstPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(firstPill).toHaveText(RENAME_NAME)
  expect((await displays(pills)).filter((display) => display !== 'none')).toEqual(['block'])

  await renames.first().evaluate((element: HTMLElement) => element.blur())
  await expect(firstPill).toBeHidden({ timeout: TIMEOUT_MS })
  await allHidden(pills, rowCount)

  // --- The control still OPENS its dialog, reached with a plain click and no hover first — the path the
  // nine shipped specs that address these controls take, and the one a pill that swallowed the hit test
  // would break (`pointer-events: none` is what keeps it from doing so). ---
  await renames.first().click()
  await expect(page.locator('.rename-conversation-overlay')).toBeVisible({ timeout: TIMEOUT_MS })
})
