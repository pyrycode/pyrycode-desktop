import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, ConversationsPayload } from '../src/shared/wire/types'
import type { Locator } from '@playwright/test'

// #1304 — the name pill the SECTION HEADERS' pair-new-host plus shows on hover and on keyboard focus, in
// the one tier that can hover or focus anything. `vitest.config.ts` sets `environment: 'node'` and every
// renderer spec is a `renderToStaticMarkup` string assertion, so `ChannelList.test.tsx` owns the markup
// (one pill per header, appended after the glyph, `aria-hidden`, its text the same client-owned constant
// as the `aria-label`, #1303's markers byte-identical) and everything below is what only a running window
// can answer: that the control's own hover and focus show and hide it, that it is drawn in the Pill's
// treatment, and that it lands where nothing clips or paints over it.
//
// A DEDICATED FILE rather than an addition to either sibling pill spec, on #1179's precedent that #1181
// followed: each pill spec owns the control whose pill it is about. Unlike #1181 this ticket needed NO
// edit to the siblings — `e2e/sidebar-control-name-pill.spec.ts` scopes its set to
// `.channel-list__row …` and `e2e/sidebar-workspace-plus-name-pill.spec.ts` to
// `.channel-list__workspace-create …`, and `.channel-list__pair` shares no token with either.
//
// ⭐ A BOUNDING BOX IS NOT A DETECTOR FOR A CLIP, which is why the geometry here is containment inside
// THE SCROLLER and never `toBeVisible()` or "inside the window" — #1172's and #1181's finding for the
// same treatment: a layout box comes back whether or not an ancestor clipped the pixels away. The scroller
// is `overflow-y: auto`, which forces `overflow-x` off `visible` too, so it clips on BOTH axes, and
// `.paired-shell__sidebar` is a second `overflow: hidden` outside it.
//
// ⭐ SINCE #1443 THE SCROLLER IS `.channel-list__tree`, NOT `.channel-list`. The drawn top bar split the
// column in two: `.channel-list` is the padded card column and no longer scrolls or clips at all, and the
// tree wrapper inside it is the scrollport. `scrollTreeTo`, the overflow precondition and the
// horizontal-scroll read all name it, through ONE `tree` locator so they cannot drift apart —
// writing `scrollTop` to an element that does not scroll is a SILENT no-op, so a read left on the column
// would fail open rather than red.
//
// ⭐ #1427 DELETED THIS CONTROL'S PLACEMENT DEVIATION AND THE SCROLLER-CONTAINMENT READS, and this file
// is where that lands hardest: the deviation was its subject. The pill hung below its plus (`top: 100%;
// transform: none`) because `.channel-list__actions` was then sticky INSIDE this scroller with its bottom
// edge 4px inside the Channels header, so a band-centred pill put 6px of itself underneath it. #1443 moved
// the bar out and retired the reason; #1427 retired the placement, for all seven controls at once. The
// pill now follows the POINTER — `position: fixed`, its top-left corner --space-3 right of and --space-6
// below the pointer's current position — so it is deliberately OUTSIDE `.channel-list__tree` whenever the
// pointer sits near that scroller's bottom edge, and `expectUnderThePlus` and `expectInsideTree` are gone
// with it. `expectAtPointer`, `expectClearOfControl` and `expectInsideWindow` replaced them.
//
// ⭐ THE ACTIONS-EDGE ASSERTION STAYS, for the reason it already had: it is a relation between two live
// boxes, it holds BY CONSTRUCTION now (the pill hangs BELOW a pointer that is itself inside the tree,
// which is entirely below the bar), and it would still catch a bar that grew back down into the tree —
// the one way the old collision can return. It was never the detector for this pill's placement; since
// #1427 that is `expectAtPointer`.
//
// ⭐ THE POINTER IS PARKED BY AN EXPLICIT `page.mouse.move`, never by `hover()`'s own centring, so every
// offset read's expected value is a point THIS FILE chose. `hover()` still leads, because it is what
// scrolls an off-screen control into view.
//
// ONE test() block, ONE launch, ONE continuous drive: each launch pays a full handshake, and the ordering
// is load-bearing throughout — every absence assertion sits AFTER a positive, auto-waiting read of the
// same gesture's own effect.
//
// SECRET HYGIENE (the sibling specs' posture): every assertion reads a number, a computed style, a count
// or the one client-owned control name. No row title and no `cwd` is asserted on.

const TIMEOUT_MS = 15_000

// The Pill's own drawing (Figma 347:6617), as computed values. ⭐ THE TWO COLOURS ARE THE TRANSPOSITION
// DETECTOR: the Figma export bakes #cfe4ff under the name `primary-container` and #134a74 under
// `on-primary-container`, which is the pair swapped against tokens.css — still true when re-read for this
// ticket. A rule that named the transposed pair computes to exactly these two REVERSED, and nothing in
// the static tier can see a colour at all.
const PILL_GROUND = 'rgb(19, 74, 116)' /* --color-primary-container #134a74 */
const PILL_INK = 'rgb(207, 228, 255)' /* --color-on-primary-container #cfe4ff */
// body-small REGULAR, the node's type.
const PILL_WEIGHT = '400'
// 4 + the 16px body-small line + 4 — the shared block's own derivation, and the number that made this pill
// 4px taller than the 20px control it named, which WAS the whole of the placement problem #1427 removed.
const PILL_HEIGHT_PX = 24

// --space-3 and --space-6 resolved. `channels.css` cites the offsets by token name and the pixels live
// only here, which is what makes these reads an independent check of the rule rather than a restatement.
const OFFSET_X_PX = 12
const OFFSET_Y_PX = 24

// The control's name, restated here as the literal the operator reads rather than imported from the
// screen. A constant imported from the code under test would agree with itself if both moved together;
// these are the words the criterion names. BOTH headers carry it, by design — the drawing places one
// `Sidebar header` component under each section — so this locator is two-match and is indexed rather than
// differentiated by name.
const PAIR_NEW_HOST_NAME = 'Pair new host'

// `pairedShell.css` gives the sidebar `flex: 0 0 400px`. Showing a pill must not move it.
const SIDEBAR_WIDTH_PX = 400

// Sub-pixel tolerance, the sibling specs' EPSILON.
const EPSILON_PX = 1.5

// Enough promoted rows that the list really overruns the 800px window the app opens at, so the tree
// really scrolls and "at scroll top" below is a genuine position rather than a list that never moved.
// Deliberately not tuned to the exact overflow: a taller window must still scroll here.
const PROMOTED_ROW_COUNT = 40

// One workspace for every row — the fixture's own, so the pushed rows land in the SAME group as the
// seeded one and each tree is one host row over one workspace row rather than a forest.
const WORKSPACE_CWD = SEEDED_ROW.cwd

// Names carrying no substring of the control name, so a `hasText`-shaped mistake in this file could not
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
// orphaned; being unpromoted it keeps the Chats tree while the 40 promoted ones fill Channels and push the
// Chats header below the fold.
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

// Both header pills' computed `display`, as a set — the absence claims below are whole-set reads rather
// than per-element ones, so a pill left showing on the other header fails them instead of going
// unlooked-at. Scoped to `.channel-list__pair`: the row controls' pills are #1172's spec's and the
// workspace plusses' are #1181's, and neither may be counted here.
const displays = (pills: Locator): Promise<string[]> =>
  pills.evaluateAll((elements) => elements.map((el) => window.getComputedStyle(el).display))

const allHidden = async (pills: Locator): Promise<void> => {
  expect(await displays(pills)).toEqual(['none', 'none'])
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

// Two: the pill does not cover the glyph it names — THE WHOLE OF #1427. Written as an intersection of no
// positive area on at least one axis, which reads the same whichever side of the control it ended up on.
const expectClearOfControl = (pill: Box, control: Box, role: string): void => {
  const overlapX =
    Math.min(pill.x + pill.width, control.x + control.width) - Math.max(pill.x, control.x)
  const overlapY =
    Math.min(pill.y + pill.height, control.y + control.height) - Math.max(pill.y, control.y)
  expect(Math.min(overlapX, overlapY), `${role}: overlap with the control`).toBeLessThanOrEqual(
    EPSILON_PX
  )
  // Still WIDER than the 20px control it names, which is the whole point of drawing a name at all — and
  // since #1427 the reason it could not stay on top of it.
  expect(pill.width, `${role}: width`).toBeGreaterThan(control.width)
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

test('the section headers’ plus names itself in a pill that follows the pointer', async ({
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
  const headers = page.locator('.channel-list__section-header')
  const plusses = page.getByRole('button', { name: PAIR_NEW_HOST_NAME })
  const pills = page.locator('.channel-list__pair .channel-list__control-name')
  // Indexed, not named: both headers carry the same control and the same name by design. Channels is
  // drawn first, Chats second — `renderBody`'s order, which `e2e/sidebar-pair-new-host.spec.ts` already
  // indexes the same way.
  const channelsPlus = plusses.nth(0)
  const chatsPlus = plusses.nth(1)
  const channelsPill = pills.nth(0)
  const chatsPill = pills.nth(1)

  // --- AC1 at rest: both pills MOUNTED and both hidden — a count AND a hidden-ness, since an absent pill
  // satisfies a hidden-ness vacuously, and `display: none` is what the two triggers below have to change.
  // Read with the pointer parked off every control: the fixture's launch click left it over the seeded
  // row, and reading "at rest" with the pointer still there asserts nothing about this control. ---
  await expect(headers).toHaveCount(2)
  await expect(plusses).toHaveCount(2)
  await expect(pills).toHaveCount(2)
  await page.mouse.move(0, 0)
  await allHidden(pills)

  daemon.pushFrame(tallListFrame())
  await expect(page.locator('.channel-list__row')).toHaveCount(PROMOTED_ROW_COUNT + 1, {
    timeout: TIMEOUT_MS
  })
  await expect(pills).toHaveCount(2)

  // The list really does overrun its own viewport, so "at scroll top" below is a position rather than a
  // list that never scrolled. Asserted rather than assumed: a window that grew, or a pitch that shrank,
  // would otherwise quietly make the claim vacuous.
  expect(await tree.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true)

  // --- AC1, the hover, on the CHANNELS header's plus at scroll top — the tightest case for the actions
  // cluster below, since that is where the header sits directly against it. The positive read comes first;
  // the set read beside it is what makes this "that control's pill" rather than "a pill somewhere". ---
  await scrollTreeTo(tree, 'top')
  const channelsPoint = await parkOn(channelsPlus, 'channels header plus', 4, 4)
  await expect(channelsPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(channelsPill).toHaveText(PAIR_NEW_HOST_NAME)
  await onlyOneShowing(pills)

  // --- AC1's treatment, read as ONE object so a single failure diff shows every value at once. The two
  // colours are the transposition detector this file's header names; the rest is the Pill node's own type,
  // padding and corner, plus the two structural declarations the placement and the click-through rest on.
  // Read WHILE the pill is up, which is the only state in which it has a used value at all. ---
  const drawn = await channelsPill.evaluate((element) => {
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

  // --- AC3's placement, on the Channels header at scroll top. The pill's top-left corner answers at the
  // offset off the parked point — read at its FIRST appearance on this control, with no move behind it,
  // which is AC1's "from the moment the pill first appears"; its box is CLEAR of the plus it names; it is
  // on screen; and it is still the drawn 24 tall, the treatment #1427 left alone. Then the ACTIONS-EDGE
  // relation, kept from #1304 as the detector for a bar that grew back down into the tree. ---
  const channelsBox = await boxOf(channelsPill, 'channels header pill')
  const channelsPlusBox = await boxOf(channelsPlus, 'channels header plus')
  const actionsBox = await boxOf(actions, 'top bar')
  expect(channelsBox.height, 'channels header pill: height').toBeCloseTo(PILL_HEIGHT_PX, 0)
  expectAtPointer(channelsBox, channelsPoint, 'channels header pill')
  expectClearOfControl(channelsBox, channelsPlusBox, 'channels header pill')
  expectInsideWindow(channelsBox, viewport, 'channels header pill')
  expect(channelsBox.y, 'channels header pill: clear of the top bar').toBeGreaterThanOrEqual(
    actionsBox.y + actionsBox.height - EPSILON_PX
  )

  // --- AC1's other half: it FOLLOWS. A second park 8px along the same control and a re-read, which is
  // what a placement computed once on enter would fail while passing every read above. ---
  const channelsMoved = await parkOn(channelsPlus, 'channels header plus', 12, 12)
  expect(channelsMoved.y, 'the second park is a different point').not.toBe(channelsPoint.y)
  const channelsBoxMoved = await boxOf(channelsPill, 'channels header pill')
  expectAtPointer(channelsBoxMoved, channelsMoved, 'channels header pill, followed')
  expectClearOfControl(channelsBoxMoved, channelsPlusBox, 'channels header pill, followed')

  // --- AC3's other half, read WHILE that pill is up: the sidebar has not widened and the scroller has
  // gained no horizontal scroll. An out-of-flow box adds scrollable overflow only where it overflows right
  // or bottom, and this one grows leftward inside its header — measured rather than argued. ---
  expect((await boxOf(sidebar, 'sidebar')).width).toBeCloseTo(SIDEBAR_WIDTH_PX, 0)
  expect(await tree.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)

  // --- AC2's other half: the added child minted no second name and took none away. Read while the pill is
  // showing, which is when its text is actually in the render — `aria-hidden` is what keeps this at two. ---
  await expect(plusses).toHaveCount(2)

  // --- AC1's scoping clause: hovering the HEADER itself — its label, away from the plus at the far right
  // — shows nothing. Ordered after the positive read above, so it measures the trigger's SCOPE rather than
  // a pill that never showed. A reveal hung off `.channel-list__section-header:hover` would light this
  // header's pill and fail here. ---
  await headers.nth(0).hover()
  await allHidden(pills)

  // --- AC1 on the CHATS header's plus, which is below the fold, so `hover()` scrolls it into view: the
  // same name off the same constant, at a DIFFERENT scroll position and with no sticky neighbour. Its
  // in-header placement is asserted again here — that is what generalises the containment claim to the
  // headers and scroll offsets this drive never parks on. ---
  const chatsPoint = await parkOn(chatsPlus, 'chats header plus', 4, 4)
  await expect(chatsPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(chatsPill).toHaveText(PAIR_NEW_HOST_NAME)
  await onlyOneShowing(pills)
  const chatsBox = await boxOf(chatsPill, 'chats header pill')
  expectAtPointer(chatsBox, chatsPoint, 'chats header pill')
  expectClearOfControl(chatsBox, await boxOf(chatsPlus, 'chats header plus'), 'chats header pill')
  expectInsideWindow(chatsBox, viewport, 'chats header pill')

  // --- AC1's other half of the hover: leaving hides it. Ordered after the positive read above, so the
  // hidden-ness measures the pointer leaving rather than a pill that was never up. ---
  await page.mouse.move(0, 0)
  await expect(chatsPill).toBeHidden({ timeout: TIMEOUT_MS })
  await allHidden(pills)

  // --- AC1, the keyboard: focus shows it and blur hides it, with the pointer parked off the list — so
  // this can only be `:focus-visible` firing, never a stray hover. Reached by focusing THE ARCHIVE ENTRY
  // and pressing Tab, NOT by `locator.focus()`: `:focus-visible` is Chromium's keyboard-modality
  // heuristic and a programmatic focus after a pointer interaction does not match it, so the assertion
  // would be testing the heuristic rather than the rule. #1181's spec records the same reasoning one
  // level down.
  //
  // THE ARCHIVE ENTRY AND NOT THE GEAR SINCE #1443, and the swap is the drawn order rather than a
  // workaround: the bar used to render archive-then-gear, so the gear was its LAST focusable and the
  // Channels plus its next; the drawing puts the gear FIRST, so tabbing off the gear now lands on the
  // archive box beside it. The step this block needs is the bar's last focusable, whichever control that
  // is, and naming it explicitly is what keeps the intent readable if the pair ever swaps again. ---
  await scrollTreeTo(tree, 'top')
  await page.locator('.channel-list__archive').focus()
  await page.keyboard.press('Tab')
  await expect(channelsPlus).toBeFocused()
  await expect(channelsPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(channelsPill).toHaveText(PAIR_NEW_HOST_NAME)
  await onlyOneShowing(pills)

  // --- AC3's placement: with the pointer parked off the list there is no pointer position, so the same
  // offset is taken from the CONTROL'S OWN bottom-right corner — one placement rule for both modalities,
  // and the glyph still uncovered. ---
  const focusedPlus = await boxOf(channelsPlus, 'channels header plus')
  const focusedPill = await boxOf(channelsPill, 'channels header pill')
  expectAtPointer(
    focusedPill,
    { x: focusedPlus.x + focusedPlus.width, y: focusedPlus.y + focusedPlus.height },
    'channels header pill, focused'
  )
  expectClearOfControl(focusedPill, focusedPlus, 'channels header pill, focused')
  expectInsideWindow(focusedPill, viewport, 'channels header pill, focused')

  await channelsPlus.evaluate((element: HTMLElement) => element.blur())
  await expect(channelsPill).toBeHidden({ timeout: TIMEOUT_MS })
  await allHidden(pills)

  // --- The plus still OPENS the pairing surface, reached with a plain click — the path
  // `e2e/sidebar-pair-new-host.spec.ts` takes three times, and the one a pill that swallowed the hit test
  // would break. Since #1427 the pill sits OFF the control rather than over it, so this is no longer the
  // read that proves `pointer-events: none` on the pill; it is kept because the pill now lands on whatever
  // the offset point reaches. The hook is the field's accessible name alone, that spec's ruling
  // verbatim. ---
  await channelsPlus.click()
  await expect(page.locator('[aria-label="Pairing code"]')).toBeVisible({ timeout: TIMEOUT_MS })
})
