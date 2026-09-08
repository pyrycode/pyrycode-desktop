import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, ConversationsPayload } from '../src/shared/wire/types'
import type { Locator, Page } from '@playwright/test'

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
// `.channel-list` and never `toBeVisible()` or "inside the window" — #1172's and #1181's finding for the
// same treatment: a layout box comes back whether or not an ancestor clipped the pixels away.
// `.channel-list` is `overflow-y: auto`, which forces `overflow-x` off `visible` too, so it clips on BOTH
// axes, and `.paired-shell__sidebar` is a second `overflow: hidden` outside it.
//
// ⭐ AND THIS CONTROL HAS A SECOND CRITERION THE OTHER THREE DID NOT: `.channel-list__actions` is the
// Channels header's immediately preceding sibling, sticky at `z-index: 1`, and it paints over anything
// that reaches it — and its bottom edge measures 4px INSIDE this header at scroll top, because its sticky
// `top` resolves against the scrollport's CONTENT box rather than its padding box. So the pill hangs BELOW
// its plus rather than centred on the plus's band: the ticket's own named fallback, and a stated deviation
// from the three shipped pills. `channels.css` carries the measured numbers. The ACTIONS-EDGE assertion in
// the geometry block below is the criterion itself — a relation between two elements, so it also catches a
// cluster that grew or a sticky offset that changed — and it is the line a pill aligned to the header's
// top reddens (72 against a cluster bottom of 76, measured); band-centring is caught one line earlier, by
// the assertion pinning the pill's top edge to the plus's bottom.
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
// 4 + the 16px body-small line + 4 — the shared block's own derivation, and here the number that makes the
// pill 4px taller than the 20px control it names, which is the whole of the placement problem.
const PILL_HEIGHT_PX = 24

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

// Enough promoted rows that the list really overruns the 800px window the app opens at, so `.channel-list`
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

// The placement claim, and the one that generalises to every scroll position: the pill hangs directly
// under its own plus — its top edge on the plus's bottom edge, which is the header's 20px line's bottom —
// and is right-aligned to the header. Read against the two boxes themselves rather than against a 20 and a
// 400 literal, so it states the relationship the rule expresses and not a number restated from the CSS.
// Containment in the scroller then follows from the header and the row under it being in view, which is
// why this is asserted on BOTH headers while the containment read itself is not.
const expectUnderThePlus = (pill: Box, plus: Box, header: Box, role: string): void => {
  expect(pill.height, `${role}: height`).toBeCloseTo(PILL_HEIGHT_PX, 0)
  expect(pill.y, `${role}: top edge on the plus's bottom`).toBeCloseTo(plus.y + plus.height, 0)
  // Right-aligned to the control, so it grows LEFTWARD off the header's right edge — which is the card's
  // content right edge — and can reach neither horizontal edge of the scroller.
  expect(pill.x + pill.width, `${role}: right edge on the header's`).toBeCloseTo(
    header.x + header.width,
    0
  )
  // Wider than the 20px control it hangs from, which is the whole point of it: the name is what a pointer
  // user reads, and a pill that fitted inside the plus would be drawing something else.
  expect(pill.width, `${role}: width`).toBeGreaterThan(plus.width)
}

const scrollListTo = (page: Page, offset: 'top' | 'bottom'): Promise<void> =>
  page.locator('.channel-list').evaluate((el, where) => {
    el.scrollTop = where === 'top' ? 0 : el.scrollHeight
  }, offset)

test('the section headers’ plus names itself in a pill on hover and on focus, clear of the sticky actions', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp()

  const list = page.locator('.channel-list')
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
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true)

  // --- AC1, the hover, on the CHANNELS header's plus at scroll top — the tightest case for the actions
  // cluster below, since that is where the header sits directly against it. The positive read comes first;
  // the set read beside it is what makes this "that control's pill" rather than "a pill somewhere". ---
  await scrollListTo(page, 'top')
  await channelsPlus.hover()
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
    position: 'absolute',
    pointerEvents: 'none'
  })

  // --- AC3, the placement, on the Channels header at scroll top: the drawn 24, hung under the plus,
  // right-aligned to the header, and CLEAR OF THE STICKY ACTIONS CLUSTER — the assertion the whole
  // deviation from the three shipped pills exists for, and the tightest case for it, since this is the
  // header the cluster overlaps. MEASURED: `.channel-list__actions` is sticky at `top: var(--space-1)`
  // resolved against the scrollport's CONTENT box, so at scroll top it sits --space-1 past its flow
  // position and its bottom edge lands 4px INSIDE this header — a pill centred on the control's 20px band
  // would put 6px of itself under it, and one aligned to the header's top 4px. Then containment. ---
  const channelsBox = await boxOf(channelsPill, 'channels header pill')
  const channelsHeaderBox = await boxOf(headers.nth(0), 'channels header')
  const actionsBox = await boxOf(actions, 'actions cluster')
  expectUnderThePlus(
    channelsBox,
    await boxOf(channelsPlus, 'channels header plus'),
    channelsHeaderBox,
    'channels header pill'
  )
  expect(channelsBox.y, 'channels header pill: clear of the sticky actions').toBeGreaterThanOrEqual(
    actionsBox.y + actionsBox.height - EPSILON_PX
  )
  expectInsideList(channelsBox, await boxOf(list, 'channel list'), 'channels header pill')

  // --- AC3's other half, read WHILE that pill is up: the sidebar has not widened and the scroller has
  // gained no horizontal scroll. An out-of-flow box adds scrollable overflow only where it overflows right
  // or bottom, and this one grows leftward inside its header — measured rather than argued. ---
  expect((await boxOf(sidebar, 'sidebar')).width).toBeCloseTo(SIDEBAR_WIDTH_PX, 0)
  expect(await list.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)

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
  await chatsPlus.hover()
  await expect(chatsPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(chatsPill).toHaveText(PAIR_NEW_HOST_NAME)
  await onlyOneShowing(pills)
  const chatsBox = await boxOf(chatsPill, 'chats header pill')
  expectUnderThePlus(
    chatsBox,
    await boxOf(chatsPlus, 'chats header plus'),
    await boxOf(headers.nth(1), 'chats header'),
    'chats header pill'
  )
  expectInsideList(chatsBox, await boxOf(list, 'channel list'), 'chats header pill')

  // --- AC1's other half of the hover: leaving hides it. Ordered after the positive read above, so the
  // hidden-ness measures the pointer leaving rather than a pill that was never up. ---
  await page.mouse.move(0, 0)
  await expect(chatsPill).toBeHidden({ timeout: TIMEOUT_MS })
  await allHidden(pills)

  // --- AC1, the keyboard: focus shows it and blur hides it, with the pointer parked off the list — so
  // this can only be `:focus-visible` firing, never a stray hover. Reached by focusing the Settings entry
  // and pressing Tab (the Channels plus is the actions cluster's next focusable), NOT by `locator.focus()`:
  // `:focus-visible` is Chromium's keyboard-modality heuristic and a programmatic focus after a pointer
  // interaction does not match it, so the assertion would be testing the heuristic rather than the rule.
  // #1181's spec records the same reasoning one level down. ---
  await scrollListTo(page, 'top')
  await page.locator('.channel-list__settings').focus()
  await page.keyboard.press('Tab')
  await expect(channelsPlus).toBeFocused()
  await expect(channelsPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(channelsPill).toHaveText(PAIR_NEW_HOST_NAME)
  await onlyOneShowing(pills)

  await channelsPlus.evaluate((element: HTMLElement) => element.blur())
  await expect(channelsPill).toBeHidden({ timeout: TIMEOUT_MS })
  await allHidden(pills)

  // --- The plus still OPENS the pairing surface, reached with a plain click — the path
  // `e2e/sidebar-pair-new-host.spec.ts` takes three times, and the one a pill that swallowed the hit test
  // would break. The pill covers the whole 20px control while showing (a click hovers first), so
  // `pointer-events: none` on it is the only reason this click lands at all. The hook is the field's
  // accessible name alone, that spec's ruling verbatim. ---
  await channelsPlus.click()
  await expect(page.locator('[aria-label="Pairing code"]')).toBeVisible({ timeout: TIMEOUT_MS })
})
