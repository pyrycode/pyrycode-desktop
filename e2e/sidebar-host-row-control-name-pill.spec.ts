import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, ConversationsPayload } from '../src/shared/wire/types'
import type { Locator } from '@playwright/test'

// #1190 — the name pill the HOST row's pen and plus show on their own hover and keyboard focus, in the
// one tier that can hover or focus anything. `vitest.config.ts` sets `environment: 'node'` and every
// renderer spec is a `renderToStaticMarkup` string assertion, so `ChannelList.test.tsx` owns the markup
// (one pill per control, appended after the glyph, `aria-hidden`, its text off the same constant as the
// `aria-label`, #1185's markers byte-identical) and everything below is what only a running window can
// answer: that each control's own hover and focus show and hide its own pill, and that both land inside
// the scroller that clips them.
//
// A DEDICATED FILE rather than an addition to any of the three shipped pill specs, on #1181's and
// #1304's precedent: each of those owns one control's pill, must pass with its assertions untouched, and
// none of their seeds addresses a host row at all.
//
// ⭐ A BOUNDING BOX IS NOT A DETECTOR FOR A CLIP, which is why the geometry here is containment inside
// THE SCROLLER and never `toBeVisible()` or "inside the window" — #1172's finding for the same
// treatment: a layout box comes back whether or not an ancestor clipped the pixels away. The scroller
// is `overflow-y: auto`, which forces `overflow-x` off `visible` too, so it clips on BOTH axes, and
// `.paired-shell__sidebar` is a second `overflow: hidden` outside it. The tighter ancestor is asserted.
//
// ⭐ SINCE #1443 THE SCROLLER IS `.channel-list__tree`, NOT `.channel-list`. The drawn top bar split the
// column in two: `.channel-list` is the padded card column and no longer scrolls or clips at all, and the
// tree wrapper inside it is the scrollport. `scrollTreeTo`, the overflow precondition and the
// horizontal-scroll read all name it, through ONE `tree` locator so they cannot drift apart —
// writing `scrollTop` to an element that does not scroll is a SILENT no-op, so a read left on the column
// would fail open rather than red.
//
// ⭐ THE TOP-BAR-EDGE ASSERTION IS THE QUESTION THE TICKET ASKED, AND THE ANSWER WAS ALREADY SLACK. It
// asked whether the Channels host row clips under its section header at scroll top, because that is
// exactly where #1304's header pill DID collide: `.channel-list__actions` was then sticky at
// `top: var(--space-1)` resolved against the scrollport's CONTENT box, so at scroll top its bottom edge
// landed 4px INSIDE the Channels header. The first host row of a section is one whole header box lower —
// MEASURED at the time, at scroll top with the list overflowing: the row's band 104…132, the pill's top
// edge 106, the cluster's bottom edge 76. So the band placement the three shipped pills use was reused
// rather than deviated from. #1443 then moved the bar out of this scroller entirely, which turns that
// 30px of slack into the whole tree: the relation now holds BY CONSTRUCTION. It is kept, not deleted,
// because it is still read between two live boxes and would catch a bar that grew down into the tree —
// but it is not, and never was, the detector for a wrong placement here.
//
// ⭐ #1427 RETIRED THE BAND AND THE SCROLLER-CONTAINMENT READS THIS FILE SHIPPED WITH. Each pill follows
// the POINTER now — `position: fixed`, its top-left corner --space-3 right of and --space-6 below the
// pointer's current position — so it is deliberately OUTSIDE `.channel-list__tree` whenever the pointer
// sits near that scroller's bottom edge. `expectAtPointer`, `expectClearOfControl` and
// `expectInsideWindow` replaced them, and the offset read is itself the clip detector the containment
// reads were: `.paired-shell__sidebar`'s padding box starts 20px in from the window on both axes, so any
// ancestor that became a containing block for this fixed box would shift it off the pointer by at least
// that inset and redden `expectAtPointer` by a wide margin.
//
// ⭐ AND THIS ROW IS THE SHARPEST CASE #1427 FIXED. The plus is the pen's later sibling, so the plus's
// pill painted over the pen's glyph: two bare 20px controls 10px apart, and naming one hid the other.
// `expectClearOfControl` is what pins that, read against the HOVERED control's box.
//
// ⭐ THE POINTER IS PARKED BY AN EXPLICIT `page.mouse.move`, never by `hover()`'s own centring, so every
// offset read's expected value is a point THIS FILE chose. `hover()` still leads, because it is what
// scrolls an off-screen control into view.
//
// ONE test() block, ONE launch, ONE continuous drive: each launch pays a full handshake, and the
// ordering is load-bearing throughout — every absence assertion sits AFTER a positive, auto-waiting read
// of the same gesture's own effect.
//
// SECRET HYGIENE (the sibling specs' posture): every assertion reads a number, a computed `display`, or
// one of the two client-owned control names. No machine label, row title and no `cwd` is asserted on.

const TIMEOUT_MS = 15_000

// The two control names, restated as the literals the operator reads rather than imported from the
// screen. A constant imported from the code under test would agree with itself if both moved together;
// these are the words the criterion names.
const EDIT_HOST_NAME = 'Edit host'
const ADD_WORKSPACE_NAME = 'Add workspace'

// Two host rows from the one paired machine since #1070 — both sections draw its row whether or not they
// hold any of its conversations (`host-row-hover-controls.spec.ts` pins the same number).
const HOST_ROW_COUNT = 2

// One pill per control, two controls per host row.
const PILL_COUNT = HOST_ROW_COUNT * 2

// 4 + the 16px body-small line + 4 — the drawn 24, still read here because the TREATMENT is what #1427
// left alone. It no longer carries a placement claim.
const PILL_HEIGHT_PX = 24

// --space-3 and --space-6 resolved. `channels.css` cites the offsets by token name and the pixels live
// only here, which is what makes these reads an independent check of the rule rather than a restatement.
const OFFSET_X_PX = 12
const OFFSET_Y_PX = 24

// `pairedShell.css` gives the sidebar `flex: 0 0 400px`. Showing a pill must not move it.
const SIDEBAR_WIDTH_PX = 400

// Sub-pixel tolerance, the sibling specs' EPSILON.
const EPSILON_PX = 1.5

// Enough promoted rows that the list really overruns the 800px window the app opens at, so "at scroll
// top" below is a genuine position in a scrollable container — which is the state the sticky cluster is
// actually pinned in, and so the honest setting for the clearance read. Deliberately not tuned to the
// exact overflow: a taller window must still scroll here.
const PROMOTED_ROW_COUNT = 40

// One workspace for every row — the fixture's own, so the pushed rows land in ONE group under the
// Channels host row rather than a forest, leaving that host row the topmost row in the list.
const WORKSPACE_CWD = SEEDED_ROW.cwd

// Names carrying no substring of either control name, so a `hasText`-shaped mistake in this file could
// not pass on a row title. Indexed so a failure diff names which row, and no name is daemon-derived.
const promotedRows = (): ConversationSummary[] =>
  Array.from({ length: PROMOTED_ROW_COUNT }, (_, index) => ({
    id: `host-pill-row-${index}`,
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
// multi-row list strict-violates before this spec's first line runs. The fixture's own idiom for that is
// `daemon.pushFrame(…)` — `daemonConnection`'s inbound `conversations` arm dispatches on the inner
// frame's `type` with no correlation-id match, so an unsolicited one is consumed exactly like a reply.
// The seeded row rides along FIRST so the open conversation is not orphaned; being unpromoted it keeps
// the Chats tree while the 40 promoted ones fill the Channels tree under its host row.
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
// because every consumer below does arithmetic on the result. The message names the LOCATOR's role.
const boxOf = async (locator: Locator, role: string): Promise<Box> => {
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`expected a laid-out box for the ${role}`)
  return box
}

// Every host-row pill's computed `display`, as a set — the absence claims below are whole-set reads
// rather than per-element ones, so a pill left showing on the other tree's row, or on the control beside
// the one being pointed at, fails them instead of going unlooked-at. Scoped to `.channel-list__host`:
// the row controls', the workspace pair's and the section header's pills are their own specs'.
const displays = (pills: Locator): Promise<string[]> =>
  pills.evaluateAll((elements) => elements.map((el) => window.getComputedStyle(el).display))

const allHidden = async (pills: Locator): Promise<void> => {
  expect(await displays(pills)).toEqual(Array.from({ length: PILL_COUNT }, () => 'none'))
}

const onlyOneShowing = async (pills: Locator): Promise<void> => {
  expect((await displays(pills)).filter((display) => display !== 'none')).toEqual(['block'])
}

// THE CRITERION, in three reads — see this file's header for why it is no longer containment inside the
// scroller. Each answers a different way for the placement to be wrong.

// One: the pill's top-left corner is the offset point off the pointer's own position.
const expectAtPointer = (pill: Box, pointer: Point, role: string): void => {
  expect(pill.x, `${role}: left edge off the pointer`).toBeCloseTo(pointer.x + OFFSET_X_PX, 0)
  expect(pill.y, `${role}: top edge off the pointer`).toBeCloseTo(pointer.y + OFFSET_Y_PX, 0)
}

// Two: the pill does not cover the glyph it names — THE WHOLE OF #1427, and on this row the case it was
// worst. Written as an intersection of no positive area on at least one axis, which reads the same
// whichever side of the control the pill ended up on.
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

test('the host row’s pen and plus name themselves in a pill that follows the pointer', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp()

  // The window's own box, read once — `expectInsideWindow`'s bound.
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
  const sidebar = page.locator('.paired-shell__sidebar')
  const actions = page.locator('.channel-list__actions')
  const hostRows = page.locator('.channel-list__host')
  const pills = page.locator('.channel-list__host .channel-list__control-name')

  // The CHANNELS host row — the topmost one, which is the row the ticket asks about because it is the
  // one sitting under a section header the sticky cluster overlaps. Taken as `.first()` and then PROVEN
  // topmost below, rather than trusted from the locator.
  const hostRow = hostRows.first()
  const pen = hostRow.locator('.channel-list__host-edit')
  const plus = hostRow.locator('.channel-list__host-add')
  const penPill = pen.locator('.channel-list__control-name')
  const plusPill = plus.locator('.channel-list__control-name')

  // --- 1. Both pills MOUNTED on both host rows, before anything is hovered — the launch seed already
  // draws every host row, so this is a complete count and not a partial one. ---
  await expect(hostRows).toHaveCount(HOST_ROW_COUNT)
  await expect(pills).toHaveCount(PILL_COUNT)

  daemon.pushFrame(tallListFrame())
  await expect(page.locator('.channel-list__row')).toHaveCount(PROMOTED_ROW_COUNT + 1, {
    timeout: TIMEOUT_MS
  })
  await expect(hostRows).toHaveCount(HOST_ROW_COUNT)
  await expect(pills).toHaveCount(PILL_COUNT)

  // The list really does overrun its own viewport, so "at scroll top" below is a position rather than a
  // list that never scrolled — which is what puts the sticky cluster in its pinned state for the
  // clearance read. Asserted rather than assumed: a window that grew, or a pitch that shrank, would
  // otherwise quietly make that claim vacuous.
  expect(await tree.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true)

  // --- 2. `hostRow` IS the Channels one: the topmost host row in the list, and so the one under the
  // header the cluster overlaps. Read as a relation between the two rows rather than by index, so a tree
  // order that changed fails here rather than quietly re-aiming every assertion below at the other
  // section. ---
  await scrollTreeTo(tree, 'top')
  expect((await boxOf(hostRow, 'channels host row')).y).toBeLessThan(
    (await boxOf(hostRows.nth(1), 'chats host row')).y
  )

  // --- 3. AC1 at rest: all four pills mounted and all four hidden — a count AND a hidden-ness, since an
  // absent pill satisfies a hidden-ness vacuously, and `display: none` is what the four triggers have to
  // change. Read with the pointer parked on the top bar, not on a row: the fixture's launch click
  // left it over the seeded row, and reading "at rest" with the pointer still there would assert a
  // reveal. ---
  await actions.hover()
  await allHidden(pills)

  // --- 4. AC1, the hover, on the PEN. The positive read comes first; the whole-set read beside it is
  // what makes this "that control's pill" rather than "a pill somewhere", and the exact text is what says
  // each control draws its OWN name off its own constant. ---
  const penPoint = await parkOn(pen, 'pen', 4, 4)
  await expect(penPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(penPill).toHaveText(EDIT_HOST_NAME)
  await onlyOneShowing(pills)

  // --- 5. AC1's geometry on the PEN at scroll top. The pill's top-left corner answers at the offset off
  // the parked point — read at the pill's FIRST appearance on this control, with no move behind it, which
  // is AC1's "from the moment the pill first appears"; its box is CLEAR of the pen it names; it is on
  // screen; and it is still the drawn 24 tall, the treatment #1427 left alone. Then the ACTIONS-EDGE
  // relation, kept from #1190 as the detector for a bar that grew back down into the tree. ---
  const penBox = await boxOf(pen, 'pen')
  const penPillBox = await boxOf(penPill, 'pen pill')
  const actionsBox = await boxOf(actions, 'top bar')
  expect(penPillBox.height, 'pen pill: height').toBeCloseTo(PILL_HEIGHT_PX, 0)
  expectAtPointer(penPillBox, penPoint, 'pen pill')
  expectClearOfControl(penPillBox, penBox, 'pen pill')
  expectInsideWindow(penPillBox, viewport, 'pen pill')
  expect(penPillBox.y, 'pen pill: clear of the top bar').toBeGreaterThanOrEqual(
    actionsBox.y + actionsBox.height - EPSILON_PX
  )

  // --- AC1's other half: it FOLLOWS. A second park 8px along the same control and a re-read, which is
  // what a placement computed once on enter would fail while passing every read above. ---
  const penMoved = await parkOn(pen, 'pen', 12, 12)
  expect(penMoved.y, 'the second park is a different point').not.toBe(penPoint.y)
  const penPillMoved = await boxOf(penPill, 'pen pill')
  expectAtPointer(penPillMoved, penMoved, 'pen pill, followed')
  expectClearOfControl(penPillMoved, penBox, 'pen pill, followed')

  // --- 6. AC2's other half, read WHILE that pill is up: the sidebar has not widened and the scroller has
  // gained no horizontal scroll. An out-of-flow box adds scrollable overflow only where it overflows
  // right or bottom, and this one grows leftward — measured rather than argued. ---
  expect((await boxOf(sidebar, 'sidebar')).width).toBeCloseTo(SIDEBAR_WIDTH_PX, 0)
  expect(await tree.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)

  // --- 7. AC1 and AC2 on the PLUS, the control 10px to the pen's right and the reason this ticket
  // exists: two bare glyphs that appear together need to say which is which. Its own name, its own band,
  // and its right edge flush with the row's rather than the pen's 25px inset — the one number that
  // differs between the two, and the detector for a pill that anchored to the row instead of to its
  // control. ---
  const plusPoint = await parkOn(plus, 'plus', 4, 4)
  await expect(plusPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(plusPill).toHaveText(ADD_WORKSPACE_NAME)
  await onlyOneShowing(pills)

  const plusBox = await boxOf(plus, 'plus')
  const plusPillBox = await boxOf(plusPill, 'plus pill')
  expectAtPointer(plusPillBox, plusPoint, 'plus pill')
  expectClearOfControl(plusPillBox, plusBox, 'plus pill')
  // ⭐ AND CLEAR OF THE PEN BESIDE IT, which is the read this ticket exists for on this row: the plus is
  // the later sibling, so its pill used to paint over the pen's glyph 10px away.
  expectClearOfControl(plusPillBox, penBox, 'plus pill, against the pen')
  expectInsideWindow(plusPillBox, viewport, 'plus pill')
  expect(plusPillBox.y, 'plus pill: clear of the top bar').toBeGreaterThanOrEqual(
    actionsBox.y + actionsBox.height - EPSILON_PX
  )

  // --- 8. AC1's scoping clause: hovering the host row's LABEL shows nothing. Ordered after the two
  // positive reads above, so it measures the trigger's SCOPE rather than a pill that never showed. A
  // reveal hung off `.channel-list__host:hover` — the scope the two GLYPHS' own reveal uses, and the
  // natural thing to copy — would light both of this row's pills and fail here. ---
  await hostRow.locator('.channel-list__host-label').hover()
  await allHidden(pills)

  // --- 9. AC1's other half of the hover: leaving hides it. The positive is re-established first, so the
  // hidden-ness measures the pointer leaving rather than a pill that was never up. ---
  await pen.hover()
  await expect(penPill).toBeVisible({ timeout: TIMEOUT_MS })
  await page.mouse.move(0, 0)
  await expect(penPill).toBeHidden({ timeout: TIMEOUT_MS })
  await allHidden(pills)

  // --- 10. AC1, the keyboard: focus shows it and blur hides it, with the pointer parked off the list —
  // so this can only be `:focus-visible` firing, never a stray hover. Reached by focusing the Channels
  // header's own plus and tabbing into the row, NOT by `locator.focus()`: `:focus-visible` is Chromium's
  // keyboard-modality heuristic and a programmatic focus after a pointer interaction does not match it,
  // so the assertion would be testing the heuristic rather than the rule. #1181's and #1304's specs
  // record the same reasoning on their own controls.
  //
  // TWO tabs, not one: #1507 turned the host row into a disclosure, and its button is the row's FIRST
  // child — ahead of the dots, the pen and the plus — so entering the row from outside lands on the
  // disclosure, and the pen is its next focusable rather than the section header's. The intermediate
  // assertion is deliberate: it names the leading tab stop, so the next change to the row's leading edge
  // fails here pointing at what actually moved instead of at a pen that merely never got focus. The pen
  // still precedes the plus, for the reason it always did. ---
  await scrollTreeTo(tree, 'top')
  await page.locator('.channel-list__pair').first().focus()
  await page.keyboard.press('Tab')
  await expect(hostRow.locator('.channel-list__host-disclosure')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(pen).toBeFocused()
  await expect(penPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(penPill).toHaveText(EDIT_HOST_NAME)
  await onlyOneShowing(pills)

  // --- AC3's placement: with the pointer parked off the list there is no pointer position, so the same
  // offset is taken from the CONTROL'S OWN bottom-right corner — one placement rule for both modalities,
  // and the glyph still uncovered. ---
  const focusedPen = await boxOf(pen, 'pen')
  const focusedPenPill = await boxOf(penPill, 'pen pill')
  expectAtPointer(
    focusedPenPill,
    { x: focusedPen.x + focusedPen.width, y: focusedPen.y + focusedPen.height },
    'pen pill, focused'
  )
  expectClearOfControl(focusedPenPill, focusedPen, 'pen pill, focused')
  expectInsideWindow(focusedPenPill, viewport, 'pen pill, focused')

  // The plus is the pen's next focusable, so one more Tab is the whole of the keyboard case for the
  // second control — and it also says the two pills swap rather than accumulate.
  await page.keyboard.press('Tab')
  await expect(plus).toBeFocused()
  await expect(plusPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(plusPill).toHaveText(ADD_WORKSPACE_NAME)
  await onlyOneShowing(pills)

  await plus.evaluate((element: HTMLElement) => element.blur())
  await expect(plusPill).toBeHidden({ timeout: TIMEOUT_MS })
  await allHidden(pills)

  // --- 11. The pen still OPENS its dialog, reached with a plain click and no hover first — the path
  // `e2e/sidebar-host-edit.spec.ts` takes, and the one a pill that swallowed the hit test would break.
  // Since #1427 the pill sits OFF the control rather than over it, so this is no longer the read that
  // proves `pointer-events: none` on the pill; it is kept because the pill now lands on whatever the
  // offset point reaches, and because a click that stopped landing here would be the first sign. ---
  await pen.click()
  await expect(page.getByRole('dialog', { name: 'Edit host' })).toBeVisible({ timeout: TIMEOUT_MS })
})
