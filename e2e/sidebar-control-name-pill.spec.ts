import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, ConversationsPayload } from '../src/shared/wire/types'
import type { Locator } from '@playwright/test'

// #1172 — the name pill a sidebar row's trailing control shows on hover and on keyboard focus, in the one
// tier that can hover or focus anything. `vitest.config.ts` sets `environment: 'node'` and every renderer
// spec is a `renderToStaticMarkup` string assertion, so `ChannelList.test.tsx` owns the markup (one pill
// per control, appended after the glyph, `aria-hidden`, its text off the same constant as the
// `aria-label`) and everything below is what only a running window can answer: that the two triggers show
// and hide it, that it is drawn in the Pill's own treatment, and that it lands inside the scroller that
// clips on every row.
//
// ⭐ A BOUNDING BOX IS NOT A DETECTOR FOR A CLIP, which is why the geometry here is written as containment
// inside THE SCROLLER and not as `toBeVisible()` or as "inside the window".
// `e2e/composer-attachment-name.spec.ts` states the same trap for the same treatment one screen over: a
// layout box comes back whether or not an ancestor clipped the pixels away. The scroller is
// `overflow-y: auto`, which forces `overflow-x` off `visible` too, so it clips on BOTH axes, and
// `.paired-shell__sidebar` is a second `overflow: hidden` outside it — a window-relative assertion would
// pass with the pill fully cut off. The tighter ancestor is the one asserted against.
//
// ⭐ AND SINCE #1443 THAT ANCESTOR IS `.channel-list__tree`, NOT `.channel-list`. The drawn top bar split
// the column in two: `.channel-list` is the padded card column and no longer scrolls or clips at all, and
// the tree wrapper inside it is the scrollport. Every read here that depends on WHICH box scrolls moves
// with it — `scrollTreeTo`, the overflow precondition, the horizontal-scroll read and the high-row
// parking below. They share ONE `tree` locator so they cannot drift apart, and the reason is
// that drifting apart would not redden: writing `scrollTop` to an element that does not scroll is a
// SILENT no-op, so "scrolled to bottom" would quietly become "at top" and this drive would pass proving
// nothing.
//
// ⭐ #1427 RETIRED THE BAND AND THE SCROLLER-CONTAINMENT READS THIS FILE SHIPPED WITH. The pill follows
// the POINTER now — `position: fixed`, its top-left corner --space-3 right of and --space-6 below the
// pointer's current position — so it is deliberately OUTSIDE `.channel-list__tree` whenever the pointer
// sits near that scroller's bottom edge, and containment inside it is no longer a true thing to assert.
// `expectAtPointer`, `expectClearOfControl` and `expectInsideWindow` replaced them, and the offset read is
// itself the clip detector the containment reads were: `.paired-shell__sidebar`'s padding box starts 20px
// in from the window on both axes, so any ancestor that became a containing block for this fixed box
// would shift it off the pointer by at least that inset and redden `expectAtPointer` by a wide margin.
// MEASURED, not assumed: with the band rule still in place the sibling workspace drive read the pill 99px
// left of the offset point.
//
// ⭐ AND THIS FILE OWNS THE BOTTOM-EDGE MIRROR, because it is the one drive that already scrolls the tree
// to its end and hovers the last row's control. The mirror needs the pointer near the WINDOW's bottom, and
// only the last row at full scroll gets there; the block parks on that control's bottom edge rather than
// its centre and asserts the precondition first, so a window that grew reddens the spec instead of making
// the case vacuous.
//
// ⭐ THE POINTER IS PARKED BY AN EXPLICIT `page.mouse.move`, never by `hover()`'s own centring, so every
// offset read's expected value is a point THIS FILE chose. `hover()` still leads, because it is what
// scrolls an off-screen control into view.
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
// 4 + the 16px body-small line + 4 — the drawn 24, still read here because the TREATMENT is what #1427
// left alone, and read again by the mirror block as the height the offset placement would overflow with.
const PILL_HEIGHT_PX = 24

// --space-3 and --space-6 resolved. `channels.css` cites the offsets by token name and the pixels live
// only here, which is what makes these reads an independent check of the rule rather than a restatement.
const OFFSET_X_PX = 12
const OFFSET_Y_PX = 24

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
// workspace row) overruns the 800px window the app opens at, so the tree really scrolls and the
// first and last rows are at genuinely different scroll positions. Deliberately not tuned to the exact
// overflow: a taller window must still scroll here.
const PROMOTED_ROW_COUNT = 40

// #1441 — the trailing controls one CHAT row carries: the Save-as-channel chevron and, since that ticket,
// the Edit chat pen beside it. Each wears its own `.channel-list__control-name`, so this is what the tall
// list's pill total counts on top of one-per-promoted-row.
const CHAT_ROW_CONTROLS = 2

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
    last_used_at: '2026-07-07T12:00:00.000Z',
    workspace_label: null
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
type Point = { x: number; y: number }
type Size = { width: number; height: number }

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

// THE CRITERION, in three reads plus the mirror's variant — see this file's header for why it is no
// longer containment inside the scroller. Each answers a different way for the placement to be wrong.

// One: the pill's top-left corner is the offset point off the pointer's own position.
const expectAtPointer = (pill: Box, pointer: Point, role: string): void => {
  expect(pill.x, `${role}: left edge off the pointer`).toBeCloseTo(pointer.x + OFFSET_X_PX, 0)
  expect(pill.y, `${role}: top edge off the pointer`).toBeCloseTo(pointer.y + OFFSET_Y_PX, 0)
}

// ...and the mirror, which is the same arithmetic read UPWARD: the pill's BOTTOM-left corner at the point.
const expectAtMirroredPointer = (pill: Box, pointer: Point, role: string): void => {
  expect(pill.x, `${role}: left edge off the pointer`).toBeCloseTo(pointer.x + OFFSET_X_PX, 0)
  expect(pill.y + pill.height, `${role}: bottom edge off the pointer`).toBeCloseTo(
    pointer.y - OFFSET_Y_PX,
    0
  )
}

// Two: the pill does not cover the glyph it names — THE WHOLE OF #1427. Written as an intersection of no
// positive area on at least one axis, which reads the same whichever side of the control it ended up on
// and so covers the mirrored case with no second form.
const expectClearOfControl = (pill: Box, control: Box, role: string): void => {
  const overlapX =
    Math.min(pill.x + pill.width, control.x + control.width) - Math.max(pill.x, control.x)
  const overlapY =
    Math.min(pill.y + pill.height, control.y + control.height) - Math.max(pill.y, control.y)
  expect(Math.min(overlapX, overlapY), `${role}: overlap with the control`).toBeLessThanOrEqual(
    EPSILON_PX
  )
}

// Three: it is on screen. The window, not the scroller: a fixed box resolves against the viewport and
// escapes every `overflow` ancestor on purpose, which is what lets it sit off the pointer at all.
const expectInsideWindow = (pill: Box, viewport: Size, role: string): void => {
  expect(pill.x, `${role}: left edge`).toBeGreaterThanOrEqual(-EPSILON_PX)
  expect(pill.y, `${role}: top edge`).toBeGreaterThanOrEqual(-EPSILON_PX)
  expect(pill.x + pill.width, `${role}: right edge`).toBeLessThanOrEqual(viewport.width + EPSILON_PX)
  expect(pill.y + pill.height, `${role}: bottom edge`).toBeLessThanOrEqual(
    viewport.height + EPSILON_PX
  )
}

const scrollTreeTo = (tree: Locator, offset: 'top' | 'bottom'): Promise<void> =>
  tree.evaluate((el, where) => {
    el.scrollTop = where === 'top' ? 0 : el.scrollHeight
  }, offset)

test('a row control names itself in a pill that follows the pointer, clear of the control', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp()

  // The window's own box, read once — `expectInsideWindow`'s bound, and what the mirror block measures
  // the offset placement's overflow against.
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))

  // Park the pointer at a point THIS FILE names inside a control, and answer where it is. `hover()` leads
  // so an off-screen control is scrolled in and the hover chain is established; the explicit move after it
  // is what makes every offset read's expected value a chosen number rather than Playwright's centring.
  const parkOn = async (control: Locator, role: string, dx: number, dy: number): Promise<Point> => {
    await control.hover()
    const box = await boxOf(control, role)
    const point = { x: Math.round(box.x + dx), y: Math.round(box.y + dy) }
    await page.mouse.move(point.x, point.y)
    return point
  }

  const tree = page.locator('.channel-list__tree')
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

  // The launch seed: one row, TWO controls, two pills — already enough to prove the pills are MOUNTED and
  // hidden before anything is hovered. Two since #1441: `SEEDED_ROW` is `is_promoted: false`, so it is a
  // CHAT row, and a chat row now carries the pen beside the chevron.
  await expect(rows).toHaveCount(1)
  await expect(pills).toHaveCount(CHAT_ROW_CONTROLS)

  daemon.pushFrame(tallListFrame())
  const rowCount = PROMOTED_ROW_COUNT + 1
  // #1441 — the list holds forty promoted rows carrying one control each and ONE chat row carrying two, so
  // the per-row pill total parts company with the row count. One named constant rather than four edited
  // literals, so the arithmetic is stated once and a future third control on either row edits one line.
  const pillCount = PROMOTED_ROW_COUNT + CHAT_ROW_CONTROLS
  await expect(rows).toHaveCount(rowCount, { timeout: TIMEOUT_MS })
  await expect(renames).toHaveCount(PROMOTED_ROW_COUNT)
  await expect(save).toHaveCount(1)
  // The chat pen's own token, asserted here because every count below depends on it: `.channel-list__rename`
  // staying at forty against forty-one rows is the whole reason #1441 gave the Chats tree a second token,
  // and the line above is what would redden if that token were ever shared.
  await expect(page.locator('.channel-list__chat-edit')).toHaveCount(1)

  // The list really does overrun its own viewport, so "the first row" and "the last row" below are at
  // different scroll positions rather than both on screen at once. Asserted rather than assumed: a window
  // that grew, or a pitch that shrank, would otherwise quietly turn the two scrolled blocks into one.
  const overflows = await tree.evaluate((el) => el.scrollHeight > el.clientHeight + 1)
  expect(overflows).toBe(true)

  // --- Resting: every pill is MOUNTED and every pill is hidden. A count AND a hidden-ness, not one or
  // the other: the count proves the elements exist to be shown (an absent pill satisfies a hidden-ness
  // vacuously), and `display: none` is what the two triggers below have to change. ---
  await expect(pills).toHaveCount(pillCount)
  await allHidden(pills, pillCount)

  // --- AC1, the hover, on the FIRST row with the list scrolled to the top. The positive read comes
  // first; the set read beside it is what makes this "that control's pill" rather than "a pill somewhere".
  // ---
  await scrollTreeTo(tree, 'top')
  const firstPoint = await parkOn(renames.first(), 'first row rename', 4, 4)
  const firstPill = pills.first()
  await expect(firstPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(firstPill).toHaveText(RENAME_NAME)
  expect((await displays(pills)).filter((display) => display !== 'none')).toEqual(['block'])

  // --- AC2, the drawing, as computed values. The two colours are the transposition detector above; the
  // weight, size, line and tracking are the node's body-small regular; `nowrap` is what makes it one line;
  // `pointer-events` is what lets a click read straight through it; `position` is `fixed` since #1427, the
  // declaration that lets the pill leave the scroller and sit off the pointer.
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
    position: 'fixed',
    pointerEvents: 'none'
  })

  // --- AC1's geometry on the FIRST row at scroll top. The pill's top-left corner answers at the offset
  // off the parked point — read at its FIRST appearance on this control, with no move behind it, which is
  // AC1's "from the moment the pill first appears"; its box is CLEAR of the control it names; it is on
  // screen; and it is still the drawn 24 tall, the treatment #1427 left alone. ---
  const firstBox = await boxOf(firstPill, 'first row pill')
  const firstControlBox = await boxOf(renames.first(), 'first row rename')
  expect(firstBox.height).toBeCloseTo(PILL_HEIGHT_PX, 0)
  expectAtPointer(firstBox, firstPoint, 'first row pill')
  expectClearOfControl(firstBox, firstControlBox, 'first row pill')
  expectInsideWindow(firstBox, viewport, 'first row pill')

  // --- AC1's other half: it FOLLOWS. A second park 8px along the same control and a re-read, which is
  // what a placement computed once on enter would fail while passing every read above. ---
  const firstMoved = await parkOn(renames.first(), 'first row rename', 12, 12)
  expect(firstMoved.y, 'the second park is a different point').not.toBe(firstPoint.y)
  const firstBoxMoved = await boxOf(firstPill, 'first row pill')
  expectAtPointer(firstBoxMoved, firstMoved, 'first row pill, followed')
  expectClearOfControl(firstBoxMoved, firstControlBox, 'first row pill, followed')

  // --- AC3's other half, read WHILE that pill is up: the sidebar has not widened and the scroller has
  // gained no horizontal scroll. An out-of-flow box adds scrollable overflow only where it overflows right
  // or bottom, and this one grows leftward — measured rather than argued. ---
  expect((await boxOf(sidebar, 'sidebar')).width).toBeCloseTo(SIDEBAR_WIDTH_PX, 0)
  const horizontal = await tree.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(horizontal).toBeLessThanOrEqual(1)

  // --- AC1's scoping clause: hovering the row's TITLE alone shows nothing. Ordered after the positive
  // read above, so it measures the trigger's scope rather than a pill that never showed. A reveal hung off
  // `.channel-list__row:hover` — the scope the GLYPH's own reveal uses, and the natural thing to copy —
  // would light this row's pill and fail here. ---
  await rows.first().locator('.channel-list__title').hover()
  await allHidden(pills, pillCount)

  // --- ⭐ AC2, THE BOTTOM-EDGE MIRROR, on the LAST row with the list scrolled to the end — the only place
  // in any of the four drives where a control sits near enough to the window's bottom edge for the offset
  // placement to overflow it. `.channel-list__tree` has no bottom padding and `.channel-list`'s is
  // --space-5 inside the card's own 20px inset, so the last row's control ends ~40px above the window; the
  // pointer parks on that control's BOTTOM edge rather than its centre, which is what buys the case. That
  // row is the seeded unpromoted one, so this block also carries AC1's other name. ---
  await scrollTreeTo(tree, 'bottom')
  // Read back rather than assumed, and the only place in this drive that needs to be: `scrollTop` written
  // to an element that does not scroll is a SILENT no-op, so a `tree` locator left pointing at the padded
  // column would turn this block's "scrolled to bottom" into "at top" and keep every assertion below
  // green. `scrollTreeTo(tree, 'top')` cannot carry the same guard, 0 being its own no-op.
  expect(await tree.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  const saveBox = await boxOf(save, 'last row save')
  const lastPoint = await parkOn(save, 'last row save', 4, saveBox.height - 1)
  // ⭐ SCOPED TO THE CONTROL BEING PARKED ON, not to `pills.last()`, since #1441. That row carries two
  // controls now and the pen is emitted after the chevron, so the last pill in document order is the PEN's
  // — `pills.last()` would silently start asserting the wrong control's name. Reading the pill through its
  // own control says which control it belongs to, which is what this block meant by "last" all along.
  const lastPill = save.locator('.channel-list__control-name')
  await expect(lastPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(lastPill).toHaveText(SAVE_NAME)

  // THE PRECONDITION, asserted before the mirror itself: the UNmirrored placement really would leave the
  // window. Without this the block would go quietly vacuous on a taller window — the pill would fit below
  // the pointer, the mirror would not fire, and `expectAtMirroredPointer` would be the only thing to
  // notice. Stated as a claim so the failure names the cause instead.
  expect(
    lastPoint.y + OFFSET_Y_PX + PILL_HEIGHT_PX,
    'the offset placement would overflow the window here'
  ).toBeGreaterThan(viewport.height)

  const lastBox = await boxOf(lastPill, 'last row pill')
  expectAtMirroredPointer(lastBox, lastPoint, 'last row pill')
  expectClearOfControl(lastBox, saveBox, 'last row pill')
  expectInsideWindow(lastBox, viewport, 'last row pill')

  // --- ...and on THE HIGHEST ROW A POINTER CAN REACH, mid-scroll — the case an above-the-row placement
  // clips, and the one no unscrolled read gets near: at `scrollTop: 0` the first row sits a header, a host
  // row and a workspace row below the top edge, with room above it for a pill that does not belong there.
  //
  // ⭐ "HIGHEST REACHABLE" IS FLUSH WITH THE SCROLLER'S TOP EDGE SINCE #1443, and it was not before. Until
  // then the row flush with the top edge had no hoverable control at all: `.channel-list__actions` was
  // STICKY at the scroller's top-right with `z-index: 1`, which is exactly where a row's trailing control
  // sits, so the cluster covered it — and the cost of that was MEASURED rather than predicted, two earlier
  // drafts having scrolled a row onto the top edge and hovered its control, both coming back with the row
  // 700px down the viewport, because `hover()` scrolls an unhittable target into view and so RELOCATES the
  // row rather than failing on it, silently dismantling the arrangement the assertion was set up on. The
  // drawn top bar sits OUTSIDE this scroller, so nothing overlaps its top edge any more and the row parks
  // flush with it. The post-hover re-read below still proves it stayed there: that guard is about
  // `hover()`'s relocation, which is unchanged, and it is what would catch a future overlay arriving here.
  //
  // THE ROW IS SCROLLED INTO POSITION RATHER THAN SEARCHED FOR. A third draft picked the topmost visible
  // row out of the laid-out rects; it selected the LAST row, because a divider, a second section header, a
  // host row and a workspace row sit between the two trees, so DOM order and visible order do not agree
  // the way that search assumed. Scrolling a KNOWN row to a known y is exact whatever the window height or
  // the tree's shape, and states the arrangement it wants instead of hunting for it. ---
  const HIGH_ROW_INDEX = 20
  // ONE reading where there used to be two. The second was the row's gap below the sticky cluster, and
  // there is no cluster inside this scroller to read against any more — the bar is the padded column's
  // child, a level up. What is left is the reading that actually defines the case: the row's distance from
  // the scroller's own top edge, which this block drives to 0.
  const rowTopInTree = (): Promise<number> =>
    tree.evaluate((el, index) => {
      const row = el.querySelectorAll('.channel-list__row')[index]
      return row.getBoundingClientRect().top - el.getBoundingClientRect().top
    }, HIGH_ROW_INDEX)
  await tree.evaluate((el, index) => {
    const row = el.querySelectorAll('.channel-list__row')[index]
    el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top
  }, HIGH_ROW_INDEX)
  // Read before anything is hovered, so the arrangement the block needs is established rather than hoped
  // for. The tree's 28px top padding is what the header used to sit in; at this scroll offset it has
  // scrolled away, so 0 really is the clip edge and not the padding box's inside.
  expect(await rowTopInTree()).toBeCloseTo(0, 0)

  const highRow = rows.nth(HIGH_ROW_INDEX)
  const highControl = highRow.locator('.channel-list__rename, .channel-list__save')
  const highPoint = await parkOn(highControl, 'high row control', 4, 4)
  const highPill = highRow.locator('.channel-list__control-name')
  await expect(highPill).toBeVisible({ timeout: TIMEOUT_MS })
  // Re-read AFTER the hover: this is what says the row is still where it was put, so the reads below are
  // still measuring the case it was set up for rather than one Playwright scrolled it into.
  expect(await rowTopInTree()).toBeCloseTo(0, 0)
  const highBox = await boxOf(highPill, 'high row pill')
  // The pill hangs BELOW the pointer here, so a row flush with the scroller's top edge is no longer the
  // clipping case it was — but it is still the case that proves the pill is not clipped by an ancestor
  // that acquired a containing block, since the offset would move by the sidebar's 20px inset if one had.
  expectAtPointer(highBox, highPoint, 'high row pill')
  expectClearOfControl(highBox, await boxOf(highControl, 'high row control'), 'high row pill')
  expectInsideWindow(highBox, viewport, 'high row pill')

  // --- AC1's other half of the hover: leaving hides it. Ordered after the positive read above, so the
  // hidden-ness measures the pointer leaving rather than a pill that was never up. ---
  await page.mouse.move(0, 0)
  await expect(highPill).toBeHidden({ timeout: TIMEOUT_MS })
  await allHidden(pills, pillCount)

  // --- AC1, the keyboard: focus shows it and blur hides it, with the pointer parked off the list — so
  // this can only be `:focus-visible` firing, never a stray hover. Reached by focusing the row's open
  // button and pressing Tab, NOT by `locator.focus()`: `:focus-visible` is Chromium's keyboard-modality
  // heuristic and a programmatic focus after a pointer interaction does not match it, so the assertion
  // would be testing the heuristic rather than the rule. `sidebar-row-geometry.spec.ts` records the same
  // reasoning for the same control's opacity reveal. ---
  await scrollTreeTo(tree, 'top')
  await rows.first().locator('.channel-list__row-open').focus()
  await page.keyboard.press('Tab')
  await expect(renames.first()).toBeFocused()
  await expect(firstPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(firstPill).toHaveText(RENAME_NAME)
  expect((await displays(pills)).filter((display) => display !== 'none')).toEqual(['block'])

  // --- AC3's placement: with the pointer parked off the list there is no pointer position, so the same
  // offset is taken from the CONTROL'S OWN bottom-right corner — one placement rule for both modalities,
  // and the glyph still uncovered. ---
  const focusedControl = await boxOf(renames.first(), 'first row rename')
  const focusedPill = await boxOf(firstPill, 'first row pill')
  expectAtPointer(
    focusedPill,
    { x: focusedControl.x + focusedControl.width, y: focusedControl.y + focusedControl.height },
    'first row pill, focused'
  )
  expectClearOfControl(focusedPill, focusedControl, 'first row pill, focused')
  expectInsideWindow(focusedPill, viewport, 'first row pill, focused')

  await renames.first().evaluate((element: HTMLElement) => element.blur())
  await expect(firstPill).toBeHidden({ timeout: TIMEOUT_MS })
  await allHidden(pills, pillCount)

  // --- The control still OPENS its dialog, reached with a plain click and no hover first — the path the
  // nine shipped specs that address these controls take. Since #1427 the pill sits OFF the control rather
  // than over it, so this is no longer the read that proves `pointer-events: none`; it is kept because the
  // pill now lands on whatever the offset point reaches. ---
  await renames.first().click()
  await expect(page.locator('.rename-conversation-overlay')).toBeVisible({ timeout: TIMEOUT_MS })
})
