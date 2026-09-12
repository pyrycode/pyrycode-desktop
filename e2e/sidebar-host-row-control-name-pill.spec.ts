import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, ConversationsPayload } from '../src/shared/wire/types'
import type { Locator, Page } from '@playwright/test'

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
// `.channel-list` and never `toBeVisible()` or "inside the window" — #1172's finding for the same
// treatment: a layout box comes back whether or not an ancestor clipped the pixels away. `.channel-list`
// is `overflow-y: auto`, which forces `overflow-x` off `visible` too, so it clips on BOTH axes, and
// `.paired-shell__sidebar` is a second `overflow: hidden` outside it. The tighter ancestor is asserted.
//
// ⭐ THE ACTIONS-EDGE ASSERTION IS THE QUESTION THE TICKET ASKED, AND THE ANSWER IS SLACK. It asked
// whether the Channels host row clips under its section header at scroll top, because that is exactly
// where #1304's header pill DID collide: `.channel-list__actions` is sticky at `top: var(--space-1)`
// resolved against the scrollport's CONTENT box, so at scroll top its bottom edge lands 4px INSIDE the
// Channels header. The first host row of a section is one whole header box lower — MEASURED here at
// scroll top with the list overflowing: the row's band is 104…132, the pill's top edge 106, the cluster's
// bottom edge 76. So the band placement the three shipped pills use is reused rather than deviated from,
// and this read is a standing statement of the relation — it would catch a cluster that grew or a sticky
// offset that changed, but with 30px of slack it is NOT the detector for a wrong placement here.
//
// ⭐ THE BAND IS THAT DETECTOR, and it is also what makes containment true on the rows no test visits.
// Each pill sits inside its host row's own 28px band (a 24px box centred on a control whose centre is the
// row's), so containment follows from the row being in view at ANY scroll position rather than from the
// one this drive parks at. MEASURED rather than assumed, #1172's and #1181's discipline on their own
// controls: re-pointing the pen's pill at #1304's `top: 100%; transform: none` and rebuilding reddens the
// band assertion by exactly 22px (`pen pill: centre`, expected 118, received 140) and leaves the
// actions-edge read and every containment read GREEN. All three are kept; none stands in for another.
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

// 4 + the 16px body-small line + 4 — the same 24 the three shipped pills derive, which is what puts this
// one inside the 28px host row's band rather than over a neighbour.
const PILL_HEIGHT_PX = 24

// `.channel-list__host-edit` sits at `right: calc(var(--space-7) - 3px)`, and its pill is `right: 0`
// inside it. So the pen's pill ends 25px in from the card's content edge while the plus's ends flush
// with it — the one number that differs between the two controls.
const PEN_RIGHT_INSET_PX = 25

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

// The band: the drawn 24, its vertical CENTRE on the row's, so the pill occupies the row's own vertical
// span and nothing above or below it. This is what generalises containment to the rows this drive never
// parks on — re-pointing the shared block at a placement one row up or down satisfies containment here
// and fails this.
const expectInTheRowsBand = (pill: Box, row: Box, role: string): void => {
  expect(pill.height, `${role}: height`).toBeCloseTo(PILL_HEIGHT_PX, 0)
  expect(pill.y + pill.height / 2, `${role}: centre`).toBeCloseTo(row.y + row.height / 2, 0)
  expect(pill.y, `${role}: top inside the row`).toBeGreaterThanOrEqual(row.y - EPSILON_PX)
  expect(pill.y + pill.height, `${role}: bottom inside the row`).toBeLessThanOrEqual(
    row.y + row.height + EPSILON_PX
  )
}

const scrollListTo = (page: Page, offset: 'top' | 'bottom'): Promise<void> =>
  page.locator('.channel-list').evaluate((el, where) => {
    el.scrollTop = where === 'top' ? 0 : el.scrollHeight
  }, offset)

test('the host row’s pen and plus name themselves in a pill, inside the scroller', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp()

  const list = page.locator('.channel-list')
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
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true)

  // --- 2. `hostRow` IS the Channels one: the topmost host row in the list, and so the one under the
  // header the cluster overlaps. Read as a relation between the two rows rather than by index, so a tree
  // order that changed fails here rather than quietly re-aiming every assertion below at the other
  // section. ---
  await scrollListTo(page, 'top')
  expect((await boxOf(hostRow, 'channels host row')).y).toBeLessThan(
    (await boxOf(hostRows.nth(1), 'chats host row')).y
  )

  // --- 3. AC1 at rest: all four pills mounted and all four hidden — a count AND a hidden-ness, since an
  // absent pill satisfies a hidden-ness vacuously, and `display: none` is what the four triggers have to
  // change. Read with the pointer parked on the actions cluster, not on a row: the fixture's launch click
  // left it over the seeded row, and reading "at rest" with the pointer still there would assert a
  // reveal. ---
  await actions.hover()
  await allHidden(pills)

  // --- 4. AC1, the hover, on the PEN. The positive read comes first; the whole-set read beside it is
  // what makes this "that control's pill" rather than "a pill somewhere", and the exact text is what says
  // each control draws its OWN name off its own constant. ---
  await pen.hover()
  await expect(penPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(penPill).toHaveText(EDIT_HOST_NAME)
  await onlyOneShowing(pills)

  // --- 5. AC2, the band and the criterion, on the Channels host row at scroll top. The band first (the
  // pen is a 20px box at --space-1 down a 28px row, so its centre IS the row's, and this is the assertion
  // a wrong placement reddens); then the pen's own right-edge inset, which is what says the pill is
  // anchored to ITS control and not to the row; then the ACTIONS-EDGE relation; then containment. ---
  const rowBox = await boxOf(hostRow, 'channels host row')
  const penPillBox = await boxOf(penPill, 'pen pill')
  const actionsBox = await boxOf(actions, 'actions cluster')
  expectInTheRowsBand(penPillBox, rowBox, 'pen pill')
  expect(rowBox.x + rowBox.width - (penPillBox.x + penPillBox.width)).toBeCloseTo(
    PEN_RIGHT_INSET_PX,
    0
  )
  expect(penPillBox.y, 'pen pill: clear of the sticky actions').toBeGreaterThanOrEqual(
    actionsBox.y + actionsBox.height - EPSILON_PX
  )
  expectInsideList(penPillBox, await boxOf(list, 'channel list'), 'pen pill')

  // --- 6. AC2's other half, read WHILE that pill is up: the sidebar has not widened and the scroller has
  // gained no horizontal scroll. An out-of-flow box adds scrollable overflow only where it overflows
  // right or bottom, and this one grows leftward — measured rather than argued. ---
  expect((await boxOf(sidebar, 'sidebar')).width).toBeCloseTo(SIDEBAR_WIDTH_PX, 0)
  expect(await list.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)

  // --- 7. AC1 and AC2 on the PLUS, the control 10px to the pen's right and the reason this ticket
  // exists: two bare glyphs that appear together need to say which is which. Its own name, its own band,
  // and its right edge flush with the row's rather than the pen's 25px inset — the one number that
  // differs between the two, and the detector for a pill that anchored to the row instead of to its
  // control. ---
  await plus.hover()
  await expect(plusPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(plusPill).toHaveText(ADD_WORKSPACE_NAME)
  await onlyOneShowing(pills)

  const plusPillBox = await boxOf(plusPill, 'plus pill')
  expectInTheRowsBand(plusPillBox, rowBox, 'plus pill')
  expect(plusPillBox.x + plusPillBox.width).toBeCloseTo(rowBox.x + rowBox.width, 0)
  expect(plusPillBox.y, 'plus pill: clear of the sticky actions').toBeGreaterThanOrEqual(
    actionsBox.y + actionsBox.height - EPSILON_PX
  )
  expectInsideList(plusPillBox, await boxOf(list, 'channel list'), 'plus pill')

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
  // header's own plus and pressing Tab (this row's pen is its next focusable, the pen being drawn before
  // the plus for exactly that reason), NOT by `locator.focus()`: `:focus-visible` is Chromium's
  // keyboard-modality heuristic and a programmatic focus after a pointer interaction does not match it,
  // so the assertion would be testing the heuristic rather than the rule. #1181's and #1304's specs
  // record the same reasoning on their own controls. ---
  await scrollListTo(page, 'top')
  await page.locator('.channel-list__pair').first().focus()
  await page.keyboard.press('Tab')
  await expect(pen).toBeFocused()
  await expect(penPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(penPill).toHaveText(EDIT_HOST_NAME)
  await onlyOneShowing(pills)

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
  // The pill is anchored to the control's own right edge and is wider than its 20px box, so it covers the
  // whole control while showing (a click hovers first): `pointer-events: none` on the shared block is the
  // only reason this click lands at all. ---
  await pen.click()
  await expect(page.getByRole('dialog', { name: 'Edit host' })).toBeVisible({ timeout: TIMEOUT_MS })
})
