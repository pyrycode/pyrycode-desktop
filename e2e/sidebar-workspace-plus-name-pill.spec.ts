import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, ConversationsPayload } from '../src/shared/wire/types'
import type { Locator } from '@playwright/test'

// #1181 — the name pill the WORKSPACE row's plus shows on hover and on keyboard focus, in the one tier
// that can hover or focus anything. `vitest.config.ts` sets `environment: 'node'` and every renderer spec
// is a `renderToStaticMarkup` string assertion, so `ChannelList.test.tsx` owns the markup (one pill per
// plus, appended after the glyph, `aria-hidden`, its text off the same `create.label` as the
// `aria-label`, #1178/#1179's markers byte-identical) and everything below is what only a running window
// can answer: that the control's own hover and focus show and hide it, that each tree's plus draws its
// own name, and — since #1427 — that it lands off the pointer rather than on the glyph it names.
//
// A DEDICATED FILE rather than an addition to `e2e/sidebar-control-name-pill.spec.ts`, on #1179's
// precedent: that spec owns the ROW controls' pills, must pass with its assertions untouched, and its
// seed cannot serve here — this drive needs a group in BOTH trees so the two names can be told apart,
// and that spec's tall list is deliberately one Chats group over one Channels group of Renames. The one
// thing #1181 changed there is its `pills` locator, now scoped to `.channel-list__row`; the comment on
// that line says why.
//
// ⭐ #1427 RETIRED THE BAND AND THE SCROLLER-CONTAINMENT READS THIS FILE SHIPPED WITH. The pill follows
// the POINTER now — `position: fixed`, its top-left corner --space-3 right of and --space-6 below the
// pointer's current position — so it is deliberately OUTSIDE `.channel-list__tree` whenever the pointer
// sits near that scroller's bottom edge, and containment inside it is no longer a true thing to assert.
// The three reads that replaced it are `expectAtPointer`, `expectClearOfControl` and `expectInsideWindow`.
//
// ⭐ AND THE OFFSET READ IS ITSELF THE CLIP DETECTOR, which is why dropping the scroller containment costs
// nothing. A bounding box still comes back from a clipped element — #1172's finding for this treatment,
// and the reason the old reads existed — but `.paired-shell__sidebar`'s padding box starts 20px in from
// the window on both axes, so any ancestor that became a containing block for this fixed box would shift
// it off the pointer by at least that inset and redden `expectAtPointer` by a wide margin.
//
// ⭐ THE POINTER IS PARKED BY AN EXPLICIT `page.mouse.move`, never by `hover()`'s own centring, so every
// offset read's expected value is a point THIS FILE chose. `hover()` still leads, because it is what
// scrolls an off-screen control into view. `scrollTreeTo` and the overflow precondition still name
// `.channel-list__tree` through ONE `tree` locator — writing `scrollTop` to an element that does not
// scroll is a SILENT no-op, so a read left on the padded column would fail open rather than red.
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
type Point = { x: number; y: number }
type Size = { width: number; height: number }

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

// THE CRITERION, in three reads — see this file's header for why it is no longer containment inside the
// scroller. Each answers a different way for the placement to be wrong.

// One: the pill's top-left corner is the offset point off the pointer's own position.
const expectAtPointer = (pill: Box, pointer: Point, role: string): void => {
  expect(pill.x, `${role}: left edge off the pointer`).toBeCloseTo(pointer.x + OFFSET_X_PX, 0)
  expect(pill.y, `${role}: top edge off the pointer`).toBeCloseTo(pointer.y + OFFSET_Y_PX, 0)
}

// Two: the pill does not cover the glyph it names — THE WHOLE OF THIS TICKET. Written as an intersection
// of no positive area on at least one axis, which reads the same whichever side of the control the pill
// ended up on; a four-way edge comparison would have to know the placement to be written at all.
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
  expect(pill.x + pill.width, `${role}: right edge`).toBeLessThanOrEqual(
    viewport.width + EPSILON_PX
  )
  expect(pill.y + pill.height, `${role}: bottom edge`).toBeLessThanOrEqual(
    viewport.height + EPSILON_PX
  )
}

const scrollTreeTo = (tree: Locator, offset: 'top' | 'bottom'): Promise<void> =>
  tree.evaluate((el, where) => {
    el.scrollTop = where === 'top' ? 0 : el.scrollHeight
  }, offset)

test('the workspace plus names itself in a pill that follows the pointer, clear of the plus', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp()

  // The window's own box, read once. `expectInsideWindow`'s bound, and the thing the bottom-edge mirror
  // in `e2e/sidebar-control-name-pill.spec.ts` is measured against.
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
  expect(await tree.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true)

  // --- AC1 at rest: both pills MOUNTED and both hidden — a count AND a hidden-ness, since an absent pill
  // satisfies a hidden-ness vacuously, and `display: none` is what the two triggers below have to change.
  // Read with the pointer parked on the top bar, not on a row: the fixture's launch click left it
  // over the seeded row, and reading "at rest" with the pointer still there would assert a reveal. ---
  await actions.hover()
  await allHidden(pills)

  // --- AC1, the hover, on the CHANNELS tree's plus with the list scrolled to the top. The positive read
  // comes first; the set read beside it is what makes this "that control's pill" rather than "a pill
  // somewhere", and the exact text is what says each tree draws ITS OWN name. The arrival is the PARK, so
  // the geometry below is read at the pill's FIRST appearance on this control rather than after a move
  // that followed one — AC1's "from the moment the pill first appears". ---
  await scrollTreeTo(tree, 'top')
  const first = await parkOn(createChannel, 'channels workspace plus', 4, 4)
  await expect(channelsPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(channelsPill).toHaveText(CREATE_CHANNEL_NAME)
  expect((await displays(pills)).filter((display) => display !== 'none')).toEqual(['block'])

  // --- AC1's geometry. The pill's top-left corner answers at the offset off that parked point, its box is
  // CLEAR of the 20px plus it names — the whole of this ticket — and it is on screen. The box is still the
  // drawn 24 tall, the treatment #1427 left alone. ---
  const plusBox = await boxOf(createChannel, 'channels workspace plus')
  const firstPill = await boxOf(channelsPill, 'channels workspace pill')
  expect(firstPill.height).toBeCloseTo(PILL_HEIGHT_PX, 0)
  expectAtPointer(firstPill, first, 'channels workspace pill')
  expectClearOfControl(firstPill, plusBox, 'channels workspace pill')
  expectInsideWindow(firstPill, viewport, 'channels workspace pill')

  // --- AC1's other half: it FOLLOWS. A second park 8px along the same control and a re-read of the box,
  // which is what a placement computed once on enter would fail while passing every read above. ---
  const second = await parkOn(createChannel, 'channels workspace plus', 12, 12)
  expect(second.y, 'the second park is a different point').not.toBe(first.y)
  const secondPill = await boxOf(channelsPill, 'channels workspace pill')
  expectAtPointer(secondPill, second, 'channels workspace pill, followed')
  expectClearOfControl(secondPill, plusBox, 'channels workspace pill, followed')
  expectInsideWindow(secondPill, viewport, 'channels workspace pill, followed')

  // --- AC2's other half, read WHILE that pill is up: the sidebar has not widened and the scroller has
  // gained no horizontal scroll. An out-of-flow box adds scrollable overflow only where it overflows
  // right or bottom, and this one grows leftward — measured rather than argued. ---
  expect((await boxOf(sidebar, 'sidebar')).width).toBeCloseTo(SIDEBAR_WIDTH_PX, 0)
  expect(await tree.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)

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
  await scrollTreeTo(tree, 'top')
  await channelsHead.locator('.channel-list__workspace').focus()
  await page.keyboard.press('Tab')
  await expect(createChannel).toBeFocused()
  await expect(channelsPill).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(channelsPill).toHaveText(CREATE_CHANNEL_NAME)
  expect((await displays(pills)).filter((display) => display !== 'none')).toEqual(['block'])

  // --- AC3's placement: with the pointer parked off the list there is no pointer position, so the same
  // offset is taken from the CONTROL'S OWN bottom-right corner — one placement rule for both modalities,
  // and the glyph still uncovered. The disjointness read is the same one the hover case makes. ---
  const focusedPlus = await boxOf(createChannel, 'channels workspace plus')
  const focusedPill = await boxOf(channelsPill, 'channels workspace pill')
  expectAtPointer(
    focusedPill,
    { x: focusedPlus.x + focusedPlus.width, y: focusedPlus.y + focusedPlus.height },
    'channels workspace pill, focused'
  )
  expectClearOfControl(focusedPill, focusedPlus, 'channels workspace pill, focused')
  expectInsideWindow(focusedPill, viewport, 'channels workspace pill, focused')

  await createChannel.evaluate((element: HTMLElement) => element.blur())
  await expect(channelsPill).toBeHidden({ timeout: TIMEOUT_MS })
  await allHidden(pills)

  // --- The plus still OPENS its dialog, reached with a plain click and no hover first — the path the two
  // shipped drives that address this control take, and the one a pill that swallowed the hit test would
  // break. The pill covers the whole 20px plus while showing, so `pointer-events: none` on it is the only
  // reason this click lands at all. ---
  await createChannel.click()
  await expect(page.locator('.create-channel-overlay .modal')).toBeVisible({ timeout: TIMEOUT_MS })
})
