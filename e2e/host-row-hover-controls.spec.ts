import { test, expect } from './fixtures/launchPairedApp'
import type { Locator } from '@playwright/test'

// #1185's swap, READ BACK now that a control is finally drawn (#1299).
//
// ⭐ THIS SPEC'S PREMISE INVERTED IN #1299, and the inversion is the ticket rather than a rewrite of
// convenience. Written against #1185, it pinned that a production host row draws NO control —
// `.channel-list__host-edit` at count 0, no "Edit host" button in the accessibility tree, and the dots
// staying up on hover BECAUSE nothing was drawn for them to give way to. Its own header named #1187 (now
// #1299) and #1189 as where those assertions would land. Wiring the pen reddens all three, so they are
// replaced here rather than deleted: the guard is still the subject, only its answer has moved from "no
// control, so the dots stay" to "a control, so the dots give way".
//
// ⭐ AND ITS SECOND HALF INVERTED IN #1308, for the same reason and by the same rule. The version this
// replaces asserted "no Add workspace button" at count 0 and named #1189 (now #1308) as where those two
// reads would land; wiring the plus reddens both, so they are replaced rather than deleted — the guard is
// still the subject, its answer has simply moved from "the slot is empty" to "the plus is drawn there".
// The hovered row now shows BOTH controls, which is the state the drawing has always described.
//
// Only this tier can answer any of it: `vitest.config.ts` sets `environment: 'node'` and every renderer
// spec is a `renderToStaticMarkup` string assertion, so no CSS is evaluated anywhere but here.
// `ChannelList.test.tsx` owns the markup contract (which rows draw the pen, its name, its DOM position)
// and this spec owns the computed opacities and the laid-out box. The pen's CLICK and the dialog it opens
// are `sidebar-host-edit.spec.ts`'s.
//
// THE WORKSPACE-ROW INSTRUMENT IS GONE, deliberately. The old drive hovered a workspace row first and
// watched its plus come up, because its criterion was an ABSENCE ("the dots did NOT disappear") and a
// hover that never fired reads identically to a guard that worked. The criterion is now a POSITIVE — the
// pen coming up on the same gesture — which calibrates itself: if `:hover` never reached the row, the pen
// read fails first and the dot read below it is never mistaken for a passing guard.
//
// SECRET HYGIENE: every assertion reads a count, a computed string or a box coordinate. No label, path or
// daemon text is asserted on or printed by a failing locator.

const HIDDEN_OPACITY = '0'
const SHOWN_OPACITY = '1'

// Two host rows from the one paired machine since #1070 — both sections draw its row whether or not they
// hold any of its conversations. Pinned so a change in that shape fails here rather than silently halving
// what the loop below checks.
const HOST_ROW_COUNT = 2

// Two connection dots per host row, four across the two.
const DOTS_PER_ROW = 2

// The drawing's numbers (Host Hover 399:1366; the pen "Icon Edgeless" I405:7920;399:1413 at right 28,
// 14 × 14, vertically centred in the 28px row). Each is a DERIVED consequence of the tokens
// `.channel-list__host-edit` uses — a 20px box at `right: calc(--space-7 - 3px)` centring a 14px glyph —
// so a swapped token reddens here.
const PEN_PX = 14
const PEN_RIGHT_INSET_PX = 28

// `--color-primary` #9dcbfc, the drawn fill. Nothing in the static tier can see a colour at all.
const GLYPH_RGB = 'rgb(157, 203, 252)'

// Sub-pixel tolerance for a device-pixel-ratio-scaled layout, the sibling specs' constant.
const GEOMETRY_TOLERANCE_PX = 1

type Box = { x: number; y: number; width: number; height: number }

const boxOf = async (locator: Locator, role: string): Promise<Box> => {
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`expected a laid-out box for the ${role}`)
  return box
}

const computed = (locator: Locator, property: string): Promise<string> =>
  locator.evaluate((el, prop) => window.getComputedStyle(el).getPropertyValue(prop), property)

const expectAbout = (actual: number, expected: number): void => {
  expect(actual).toBeGreaterThanOrEqual(expected - GEOMETRY_TOLERANCE_PX)
  expect(actual).toBeLessThanOrEqual(expected + GEOMETRY_TOLERANCE_PX)
}

test('the host row swaps its connection dots for the pen on hover', async ({ launchPairedApp }) => {
  // ONE launch, ONE continuous drive (the sibling specs' shape). The fixture's default seed is all this
  // needs — the subject is the host row, which is drawn from the paired-server list and not from any row.
  const { page } = await launchPairedApp()

  const actions = page.locator('.channel-list__actions')
  const hostRows = page.locator('.channel-list__host')
  const hostRow = hostRows.first()
  const hostLabel = hostRow.locator('.channel-list__host-label')
  const hostStatus = hostRow.locator('.channel-list__host-status')
  const pen = hostRow.locator('.channel-list__host-edit')
  const penGlyph = hostRow.locator('.channel-list__host-edit-icon')

  // --- 1. THE PEN IS DRAWN, which is the precondition every assertion below is about and the exact claim
  // this spec used to make in reverse. Read by accessible name as well as by class: a control present in
  // the DOM but missing from the accessibility tree would pass the class count and fail this. ---
  await expect(hostRows).toHaveCount(HOST_ROW_COUNT)
  await expect(page.locator('.channel-list__host-edit')).toHaveCount(HOST_ROW_COUNT)
  await expect(page.getByRole('button', { name: 'Edit host' })).toHaveCount(HOST_ROW_COUNT)

  // --- 2. The plus is drawn too, on every host row — #1308's half of the swap, inverted from the version
  // of this spec that #1299 left standing. Both reads kept in the same two shapes: a class count and an
  // accessibility-tree count. ---
  await expect(page.locator('.channel-list__host-add')).toHaveCount(HOST_ROW_COUNT)
  await expect(page.getByRole('button', { name: 'Add workspace' })).toHaveCount(HOST_ROW_COUNT)

  // --- 3. AT REST, with the pointer parked off every row: the dots up, the pen invisible, in every row.
  // The fixture's launch click left the pointer over the seeded conversation row, so reading an "at rest"
  // opacity without moving it first would be reading some row's hover state. ---
  await actions.hover()
  await expect(page.locator('.channel-list__host-dot')).toHaveCount(HOST_ROW_COUNT * DOTS_PER_ROW)
  for (let i = 0; i < HOST_ROW_COUNT; i++) {
    expect(await computed(hostRows.nth(i).locator('.channel-list__host-status'), 'opacity')).toBe(
      SHOWN_OPACITY
    )
    expect(await computed(hostRows.nth(i).locator('.channel-list__host-edit'), 'opacity')).toBe(
      HIDDEN_OPACITY
    )
    // #1308 — the plus rides the same swap and now that it is drawn it is readable here. Its own rule is
    // a separate block from the pen's (the two hang off one row but wear different classes), so a
    // regression in either is independent and both are read.
    expect(await computed(hostRows.nth(i).locator('.channel-list__host-add'), 'opacity')).toBe(
      HIDDEN_OPACITY
    )
  }

  // --- 4. THE CRITERION. Hover the row's LABEL — the row, not the control, which is a SCOPE claim as much
  // as a visibility one: hung off the control's own `:hover` the reveal would fire only once the pointer
  // had already arrived at a 20px box it could not see.
  //
  // The PEN read comes FIRST and is the positive half: it is the same gesture and the same mechanism
  // reporting that `:hover` genuinely reached this row, so the dot read after it is a statement about
  // `channels.css`'s `:has()` guard rather than about a pointer that never moved. Ordered the other way
  // round, "the dots went to 0" would pass just as happily against a rule that blanked them unconditionally
  // — which is precisely the mistake this guard exists to prevent, and which was unobservable while no
  // control was drawn. ---
  await hostLabel.hover()
  expect(await computed(pen, 'opacity')).toBe(SHOWN_OPACITY)
  expect(await computed(hostRow.locator('.channel-list__host-add'), 'opacity')).toBe(SHOWN_OPACITY)
  expect(await computed(hostStatus, 'opacity')).toBe(HIDDEN_OPACITY)

  // --- 5. The pen's drawn rectangle, readable for the first time in a running window (#1185 shipped the
  // geometry with no caller, so this is where its numbers finally land). 14 × 14, its right edge 28px in
  // from the row's right edge, vertically centred, in `--color-primary` — read while revealed, since the
  // opacity mechanism is what keeps it laid out at all. The ROW is the reference box, never the window. ---
  const rowBox = await boxOf(hostRow, 'host row')
  const penBox = await boxOf(penGlyph, 'pen glyph')
  expectAbout(penBox.width, PEN_PX)
  expectAbout(penBox.height, PEN_PX)
  expectAbout(rowBox.x + rowBox.width - (penBox.x + penBox.width), PEN_RIGHT_INSET_PX)
  expectAbout(penBox.y + penBox.height / 2, rowBox.y + rowBox.height / 2)
  expect(await computed(pen, 'color')).toBe(GLYPH_RGB)

  // --- 6. The dots are still THERE, laid out and merely transparent — `opacity` and never `display: none`
  // (#1171's ruling), which `connection-dot-colours.spec.ts` and `host-label-sidebar.spec.ts` both depend
  // on: they count and measure the pair without ever hovering. And the row itself is unchanged in the other
  // way the hover could have touched it: still no fill (the drawing gives the Hover variant none). ---
  await expect(hostRow.locator('.channel-list__host-dot')).toHaveCount(DOTS_PER_ROW)
  expect(await computed(hostRow, 'background-color')).toBe('rgba(0, 0, 0, 0)')
})
