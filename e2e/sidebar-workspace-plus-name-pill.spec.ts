import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, ConversationsPayload } from '../src/shared/wire/types'
import type { Locator, Page } from '@playwright/test'

// #1181 — the name pill the WORKSPACE row's plus shows on hover and on keyboard focus, in the one tier
// that can hover or focus anything. `vitest.config.ts` sets `environment: 'node'` and every renderer spec
// is a `renderToStaticMarkup` string assertion, so `ChannelList.test.tsx` owns the markup (one pill per
// plus, appended after the glyph, `aria-hidden`, its text off the same `create.label` as the
// `aria-label`, #1178/#1179's markers byte-identical) and everything below is what only a running window
// can answer: that the control's own hover and focus show and hide it, that each tree's plus draws its
// own name, and that it lands inside the scroller that clips it.
//
// A DEDICATED FILE rather than an addition to `e2e/sidebar-control-name-pill.spec.ts`, on #1179's
// precedent: that spec owns the ROW controls' pills, must pass with its assertions untouched, and its
// seed cannot serve here — this drive needs a group in BOTH trees so the two names can be told apart,
// and that spec's tall list is deliberately one Chats group over one Channels group of Renames. The one
// thing #1181 changed there is its `pills` locator, now scoped to `.channel-list__row`; the comment on
// that line says why.
//
// ⭐ A BOUNDING BOX IS NOT A DETECTOR FOR A CLIP, which is why the geometry here is containment inside
// `.channel-list` and never `toBeVisible()` or "inside the window" — #1172's and
// `e2e/composer-attachment-name.spec.ts`'s finding for the same treatment: a layout box comes back
// whether or not an ancestor clipped the pixels away. `.channel-list` is `overflow-y: auto`, which forces
// `overflow-x` off `visible` too, so it clips on BOTH axes, and `.paired-shell__sidebar` is a second
// `overflow: hidden` outside it. The tighter ancestor is the one asserted against.
//
// ⭐ AND THE BAND IS WHAT MAKES CONTAINMENT TRUE ON THE ROWS NO TEST VISITS. The pill sits inside the
// head row's own 28px band (a 24px box centred on the plus, whose centre is the row's), so containment
// follows from the row being in view at ANY scroll position rather than from the one this drive parks at.
// Both are asserted and neither stands in for the other — #1172's measured ruling, carried up a level.
//
// ONE test() block, ONE launch, ONE continuous drive: each launch pays a full handshake, and the ordering
// is load-bearing throughout — every absence assertion sits AFTER a positive, auto-waiting read of the
// same gesture's own effect.
//
// SECRET HYGIENE (the sibling specs' posture): every assertion reads a number, a computed `display`, or
// one of the two client-owned control names. No row title and no `cwd` is asserted on.

const TIMEOUT_MS = 15_000

// The two plus names, restated as the literals the operator reads rather than imported from the screen.
// A constant imported from the code under test would agree with itself if both moved together; these are
// the words the criterion names.
const CREATE_CHANNEL_NAME = 'Create channel'
const CREATE_CHAT_NAME = 'Create chat'

// 4 + the 16px body-small line + 4 — the same 24 the row's own pills derive, which is what puts this one
// inside the 28px head row's band rather than over a neighbour.
const PILL_HEIGHT_PX = 24

// `pairedShell.css` gives the sidebar `flex: 0 0 400px`. Showing a pill must not move it.
const SIDEBAR_WIDTH_PX = 400

// Sub-pixel tolerance, the sibling specs' EPSILON.
const EPSILON_PX = 1.5

// Enough promoted rows that the list really overruns the 800px window the app opens at, so "at scroll
// top" below is a genuine position rather than a list that never scrolls at all. Deliberately not tuned
// to the exact overflow: a taller window must still scroll here.
const PROMOTED_ROW_COUNT = 40

// One workspace for every row — the fixture's own, so the pushed rows land in the SAME group as the
// seeded one and each tree is one host row over one workspace row rather than a forest.
const WORKSPACE_CWD = SEEDED_ROW.cwd

// Names carrying no substring of either control name, so a `hasText`-shaped mistake in this file could
// not pass on a row title. Indexed so a failure diff names which row, and no name is daemon-derived.
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

// The two-tree list, pushed as an UNSOLICITED `conversations` envelope after launch. It cannot be the
// launch seed: `launchPairedApp` reaches the thread by clicking a single STRICT
// `.channel-list__row-open`, so a multi-row list strict-violates before this spec's first line runs. The
// fixture's own idiom for the same problem is `daemon.pushFrame(seedConversationsFrame(…))` —
// `daemonConnection`'s inbound `conversations` arm dispatches on the inner frame's `type` with no
// correlation-id match, so an unsolicited one is consumed exactly like a reply. The seeded row rides
// along FIRST so the open conversation is not orphaned; being unpromoted it keeps the Chats tree's group
// (and its "Create chat" plus) while the 40 promoted ones mint the Channels group and its own.
const twoTreeFrame = (): Uint8Array =>
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

// Every workspace pill's computed `display`, as a set — the absence claims below are whole-set reads
// rather than per-element ones, so a pill left showing on the other tree's plus fails them instead of
// going unlooked-at. Scoped to the PLUSSES: the row controls' pills are #1172's spec's, and since #1180
// the workspace head row carries a second control of its own — the edit pen — whose pill is that
// ticket's spec's. See the locator below.
const displays = (pills: Locator): Promise<string[]> =>
  pills.evaluateAll((elements) => elements.map((el) => window.getComputedStyle(el).display))

const allHidden = async (pills: Locator): Promise<void> => {
  expect(await displays(pills)).toEqual(['none', 'none'])
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

test('the workspace plus names itself in a pill on hover and on focus, inside the scroller', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp()

  const list = page.locator('.channel-list')
  const sidebar = page.locator('.paired-shell__sidebar')
  const actions = page.locator('.channel-list__actions')
  const heads = page.locator('.channel-list__workspace-head')
  // Every PLUS's pill, and only those. Narrowed from `.channel-list__workspace-head …` to the plus
  // itself by #1180, which gave the same head row a second control wearing the same pill class — so the
  // old selector would count two pills per head and strict-violate on the single-element reads below.
  // This is #1181's own edit to #1172's spec repeated one level down (this file's header records it):
  // each pill spec names the CONTROL whose pill it is about, so a third named control changes no count
  // here. The row controls' pills remain out of reach either way, being one level down again.
  const pills = page.locator('.channel-list__workspace-create .channel-list__control-name')

  // The two heads addressed BY THE NAME OF THE PLUS THEY CONTAIN rather than by index — the thing the
  // criterion is about, and index-free, so a tree order that changed would fail on the name rather than
  // quietly re-aim these locators at the other tree.
  const createChannel = page.getByRole('button', { name: CREATE_CHANNEL_NAME })
  const createChat = page.getByRole('button', { name: CREATE_CHAT_NAME })
  const channelsHead = heads.filter({ has: createChannel })
  const chatsHead = heads.filter({ has: createChat })
  // Narrowed to the plus for the reason the `pills` locator above states — each of these must resolve
  // to exactly ONE element, and the head row has carried two pill-wearing controls since #1180.
  const channelsPill = channelsHead.locator(
    '.channel-list__workspace-create .channel-list__control-name'
  )
  const chatsPill = chatsHead.locator(
    '.channel-list__workspace-create .channel-list__control-name'
  )

  // --- The launch seed: one unpromoted row, so the Chats tree has the only group — already enough to
  // prove the pill is MOUNTED before anything is hovered, and that the Channels tree draws neither. ---
  await expect(createChat).toHaveCount(1)
  await expect(createChannel).toHaveCount(0)
  await expect(pills).toHaveCount(1)

  daemon.pushFrame(twoTreeFrame())
  await expect(page.locator('.channel-list__row')).toHaveCount(PROMOTED_ROW_COUNT + 1, {
    timeout: TIMEOUT_MS
  })
  await expect(heads).toHaveCount(2)
  await expect(createChannel).toHaveCount(1)
  await expect(createChat).toHaveCount(1)
  await expect(pills).toHaveCount(2)

  // The list really does overrun its own viewport, so "at scroll top" below is a position rather than a
  // list that never scrolled. Asserted rather than assumed: a window that grew, or a pitch that shrank,
  // would otherwise quietly make the claim vacuous.
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true)

  // --- AC1 at rest: both pills MOUNTED and both hidden — a count AND a hidden-ness, since an absent pill
  // satisfies a hidden-ness vacuously, and `display: none` is what the two triggers below have to change.
  // Read with the pointer parked on the actions cluster, not on a row: the fixture's launch click left it
  // over the seeded row, and reading "at rest" with the pointer still there would assert a reveal. ---
  await actions.hover()
  await allHidden(pills)

  // --- AC1, the hover, on the CHANNELS tree's plus with the list scrolled to the top. The positive read
  // comes first; the set read beside it is what makes this "that control's pill" rather than "a pill
  // somewhere", and the exact text is what says each tree draws ITS OWN name. ---
  await scrollListTo(page, 'top')
  await createChannel.hover()
  await expect(channelsPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(channelsPill).toHaveText(CREATE_CHANNEL_NAME)
  expect((await displays(pills)).filter((display) => display !== 'none')).toEqual(['block'])

  // --- AC2, the band and the criterion, on the first Channels-tree workspace row at scroll top. The box
  // is the drawn 24; its vertical CENTRE coincides with the head row's, which is the band claim (the plus
  // is a 20px box at --space-1 down a 28px row, so its centre IS the row's); its right edge coincides
  // with the head row's, so it grows leftward and reaches neither horizontal edge. Then containment.
  // The band is what generalises this to rows this drive never parks on — re-pointing the rule at a
  // placement one row up satisfies the containment here and fails the centre. ---
  const pillBox = await boxOf(channelsPill, 'channels workspace pill')
  const headBox = await boxOf(channelsHead, 'channels workspace head row')
  expect(pillBox.height).toBeCloseTo(PILL_HEIGHT_PX, 0)
  expect(pillBox.y + pillBox.height / 2).toBeCloseTo(headBox.y + headBox.height / 2, 0)
  expect(pillBox.x + pillBox.width).toBeCloseTo(headBox.x + headBox.width, 0)
  expectInsideList(pillBox, await boxOf(list, 'channel list'), 'channels workspace pill')

  // --- AC2's other half, read WHILE that pill is up: the sidebar has not widened and the scroller has
  // gained no horizontal scroll. An out-of-flow box adds scrollable overflow only where it overflows
  // right or bottom, and this one grows leftward — measured rather than argued. ---
  expect((await boxOf(sidebar, 'sidebar')).width).toBeCloseTo(SIDEBAR_WIDTH_PX, 0)
  expect(await list.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)

  // --- AC1's scoping clause: hovering the workspace row's LABEL shows nothing. Ordered after the
  // positive read above, so it measures the trigger's SCOPE rather than a pill that never showed. A
  // reveal hung off `.channel-list__workspace-head:hover` — the scope the GLYPH's own reveal uses, and
  // the natural thing to copy — would light this row's pill and fail here. ---
  await channelsHead.locator('.channel-list__workspace-label').hover()
  await allHidden(pills)

  // --- AC1 on the CHATS tree's plus: the other name, off the same one-constant-per-tree wiring. Its head
  // is below the fold, so `hover()` scrolls it into view — which is why no geometry is read here; the
  // band and the containment are the block above's, at a stated scroll position. ---
  await createChat.hover()
  await expect(chatsPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(chatsPill).toHaveText(CREATE_CHAT_NAME)
  expect((await displays(pills)).filter((display) => display !== 'none')).toEqual(['block'])

  // --- AC1's other half of the hover: leaving hides it. Ordered after the positive read above, so the
  // hidden-ness measures the pointer leaving rather than a pill that was never up. ---
  await page.mouse.move(0, 0)
  await expect(chatsPill).toBeHidden({ timeout: TIMEOUT_MS })
  await allHidden(pills)

  // --- AC1, the keyboard: focus shows it and blur hides it, with the pointer parked off the list — so
  // this can only be `:focus-visible` firing, never a stray hover. Reached by focusing the workspace
  // row's own disclosure button and pressing Tab (the plus is its next sibling), NOT by
  // `locator.focus()`: `:focus-visible` is Chromium's keyboard-modality heuristic and a programmatic
  // focus after a pointer interaction does not match it, so the assertion would be testing the heuristic
  // rather than the rule. `sidebar-row-geometry.spec.ts` records the same reasoning for this control's
  // own opacity reveal. ---
  await scrollListTo(page, 'top')
  await channelsHead.locator('.channel-list__workspace').focus()
  await page.keyboard.press('Tab')
  await expect(createChannel).toBeFocused()
  await expect(channelsPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(channelsPill).toHaveText(CREATE_CHANNEL_NAME)
  expect((await displays(pills)).filter((display) => display !== 'none')).toEqual(['block'])

  await createChannel.evaluate((element: HTMLElement) => element.blur())
  await expect(channelsPill).toBeHidden({ timeout: TIMEOUT_MS })
  await allHidden(pills)

  // --- The plus still OPENS its dialog, reached with a plain click and no hover first — the path the two
  // shipped drives that address this control take, and the one a pill that swallowed the hit test would
  // break. The pill covers the whole 20px plus while showing, so `pointer-events: none` on it is the only
  // reason this click lands at all. ---
  await createChannel.click()
  await expect(page.locator('.create-channel')).toBeVisible({ timeout: TIMEOUT_MS })
})
