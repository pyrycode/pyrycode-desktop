import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { confirmCreateChat } from './fixtures/confirmCreateChat'
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
// THREE test() blocks, each its own launchPairedApp launch. The third, added by #1441, drives the chat
// row's new pen through to a rename; it is the one block that reads TEXT back, and the hygiene rule below
// is unbent by it rather than relaxed — its seed is NULL-named, so the field it asserts holds the app's
// own `Untitled` placeholder, and the name it types is the spec's own literal. Nothing daemon-derived is
// read, which is what that rule is about.
//
// The first TWO need separate launches because AC4's two halves need two different
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
const LABEL_WEIGHT_RESTING = '400'
// #1098 — the open row's label is `M3/body/small-emphasized` (node 103:2969), which differs from
// body-small in WEIGHT ALONE. Both values live here because both are reachable in the same launch: the
// fixture reaches the thread by CLICKING the seeded row, so that row is the open one from the first
// paint, and the plus further down mints a second conversation and moves the open state to it.
const LABEL_WEIGHT_OPEN = '500'

// #1098's fill — `Schemes/On Primary` #003355, worn as a background, as Chromium reports it. Read as a
// computed colour rather than a class, so this fails if the token is swapped for the wrong one, if the
// token's own value drifts, or if a literal is substituted.
const OPEN_FILL_RGB = 'rgb(0, 51, 85)'
// What an unfilled row computes to: `background: none` resolves to a transparent colour, never to the
// window's ground, so "this row is not the open one" is an exact string and not an approximation.
const NO_FILL_RGBA = 'rgba(0, 0, 0, 0)'
// #1171's hover fill — `--color-primary-container` #134a74, the Hover variant's (398:7258) drawn fill,
// which every row EXCEPT the open one takes under the pointer. It replaced `--color-surface-container`
// #1d2024 AND moved off the button onto the row wrapper, so every read of it below is a wrapper read.
const HOVER_FILL_RGB = 'rgb(19, 74, 116)'

// #1171's trailing control: a 12px glyph whose right edge sits 8px in from the row's right edge, drawn
// in `--color-primary` #9dcbfc. Invisible at rest and revealed by the row's hover or the control's own
// keyboard focus — as an OPACITY, which is why the nine shipped specs that click or await these controls
// without hovering first need no edit (Playwright counts an opacity-0 element as visible, and moves the
// pointer onto it before clicking, which hovers the row on the way).
const GLYPH_PX = 12
const GLYPH_RIGHT_INSET_PX = 8

// #1441 — the chevron's inset on a chat row, now that the pen shares the trailing band with it and takes
// the edge. 20 further in than the pen's 8, which is the gap `channels.css` writes as `right:
// var(--space-5)` on a box whose padding already holds the first 8. Its own constant rather than
// `GLYPH_RIGHT_INSET_PX + 20`: the two are independent numbers off the same drawing, and summing them
// would say the chevron's place is derived from the pen's when it is only measured beside it.
const CHEVRON_RIGHT_INSET_PX = 28

// `channelListViewModel.ts`'s `UNNAMED_LABEL`, restated rather than imported: this file runs under
// Playwright's own transpiler, where the `@shared` alias that module's type import uses does not resolve.
// A client-owned compile-time constant either way, which is what makes reading it back hygienic.
const UNNAMED_LABEL = 'Untitled'

const GLYPH_RGB = 'rgb(157, 203, 252)'
const HIDDEN_OPACITY = '0'
const SHOWN_OPACITY = '1'

// The redrawn idle ring stays half-opacity and unfilled in every row state.
const DOT_RING = 'rgb(157, 203, 252) 0px 0px 0px 1px inset'

// Sub-pixel tolerance for a device-pixel-ratio-scaled layout, copied from host-label-sidebar.spec.ts.
// One physical pixel of slack: enough that a fractional box coordinate cannot flake, far too little to
// hide the 3px dot drop #1097 ruled out, or #1171's 8px glyph inset landing anywhere but where it is
// drawn. The control's own box is fractional by construction — the drawing centres a 12px glyph in a
// 24px line — so the slack is doing real work on those reads rather than only guarding the DPR scale.
const GEOMETRY_TOLERANCE_PX = 1

// The cwd `conversationStateFake` resolves a null-cwd `create_conversation` to. Both seeds use it so a
// minted row lands in the SAME workspace group as the seed and the two rows are adjacent siblings —
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
  workspace_label: null,
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

// The same read across EVERY element a locator matches, so a two-row claim can be made as a SET rather
// than by `nth()` position or by filtering on a seed name — the two things this file's secret-hygiene
// header rules out. Which row ends up first after the fake re-lists is not this spec's business; that
// exactly one of them is filled, and that the filled one is the one carrying the state, is.
const computedAll = (locator: Locator, property: string): Promise<string[]> =>
  locator.evaluateAll((els, prop) =>
    els.map((el) => window.getComputedStyle(el).getPropertyValue(prop)),
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
  const saveIcon = page.locator('.channel-list__save-icon')
  // #1441 — the chat row's own pen, under its own token. `.channel-list__rename` is asserted ABSENT here
  // and the Channels block asserts this one absent, which is the two halves of "each tree's pen carries
  // its own selector" — the property twelve shipped locators, six of them `real-daemon-*`, rest on.
  const chatEdit = page.locator('.channel-list__chat-edit')

  await expect(row).toHaveCount(1)
  await expect(save).toHaveCount(1)
  await expect(chatEdit).toHaveCount(1)
  await expect(page.locator('.channel-list__rename')).toHaveCount(0)

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
  // The horizontal pair is asymmetric and both halves are drawn (#1171; they were 16 and 32 before it).
  // 28 on the right is the trailing padding the drawing reserves for the Hover variant's control, which
  // is positioned OVER it rather than laid out in it. 22 on the left is the row's title inset — the
  // drawing's 8px inset, the 6px dot, the 8px gap — which is also why the row itself declares no gap.
  // Both pinned so a future retune of the row's leading geometry has to come here first.
  expect(await computed(open, 'padding-right')).toBe('28px')
  expect(await computed(open, 'padding-left')).toBe('22px')
  expect(await computed(open, 'border-top-left-radius')).toBe(`${ROW_CORNER_PX}px`)
  expect(await computed(open, 'border-bottom-right-radius')).toBe(`${ROW_CORNER_PX}px`)

  // --- 3. AC2: the label is body-small in on-surface, not the title-medium it used to be. Asserted as the
  // COMPUTED values the browser resolved, so this fails if the tokens are swapped for the wrong quad, if
  // a token's own value drifts, or if a literal is substituted. ---
  expect(await computed(title, 'font-size')).toBe(LABEL_SIZE_PX)
  expect(await computed(title, 'line-height')).toBe(LABEL_LINE_PX)
  expect(await computed(title, 'letter-spacing')).toBe(LABEL_TRACKING_PX)
  expect(await computed(title, 'color')).toBe(ON_SURFACE_RGB)
  // THE WEIGHT IS THE OPEN ONE HERE, and that is not a relaxation of #1097's 400 — it is where the
  // fixture actually leaves the app. `launchPairedApp` reaches the thread by clicking this row, so the
  // single seeded row is the OPEN row from the first paint (#1098) and its label is one weight heavier
  // by design. The resting 400 is asserted further down, where the plus has moved the open state to a
  // second row and both values are on screen at once.
  expect(await computed(title, 'font-weight')).toBe(LABEL_WEIGHT_OPEN)

  // --- 3b. #1098's fill (node 103:2969), on the ROW WRAPPER rather than the open button: the button is
  // a `flex: 1 1 auto` sibling of the trailing affordances, so a fill on it would stop short and leave
  // an unfilled tail on the very row this block seeds (it carries Save-as-channel). The corner rides
  // along, since at rest the wrapper paints nothing and #1097 kept `--radius-xs` on the button for its
  // hover fill and focus ring alone. ---
  expect(await computed(row, 'background-color')).toBe(OPEN_FILL_RGB)
  expect(await computed(row, 'border-top-left-radius')).toBe(`${ROW_CORNER_PX}px`)
  expect(await computed(row, 'border-bottom-right-radius')).toBe(`${ROW_CORNER_PX}px`)
  // The fill lives on the wrapper and the button paints NOTHING — still the assertion that would flip if
  // the fill were moved onto `.channel-list__row-open`.
  //
  // ITS COMPANION INVERTED AT #1171 AND IS KEPT, INVERTED, RATHER THAN DELETED. Until then the row was
  // WIDER than the button, because the trailing control was an in-flow flex sibling that ate the row's
  // tail; #1171 positioned the control absolutely so the button spans the whole row, which is the point
  // of that move — the open button's focus rectangle no longer shrinks on a row that carries a control.
  // So the claim becomes an EQUALITY, and it is a detector for exactly the regression that move could
  // cause: put either control back in the flex flow and the button gives up its tail again.
  expect(await computed(open, 'background-color')).toBe(NO_FILL_RGBA)
  expectAbout((await boxOf(row, 'sidebar row')).width, (await boxOf(open, 'open button')).width)

  // --- 3c. AC4: hovering the OPEN row leaves its fill exactly as it is, rather than taking #1171's
  // `--color-primary-container` hover.
  //
  // THE SECOND ASSERTION IS NOW THE DETECTOR, WHICH INVERTS WHAT THIS BLOCK USED TO SAY. While the hover
  // fill sat on the BUTTON, a wrapper read could not see it — a parent's computed `background-color` is
  // unaffected by whatever a child paints on top of it — so only the button's own background could tell
  // the two apart. #1171 moved the hover fill onto the wrapper, so both candidate fills now paint on the
  // SAME element and the wrapper read genuinely separates `--color-on-primary` from the hover colour.
  // The button read is kept as the standing guard that nothing has painted its way back onto the button.
  // ---
  await open.hover()
  expect(await computed(open, 'background-color')).toBe(NO_FILL_RGBA)
  expect(await computed(row, 'background-color')).toBe(OPEN_FILL_RGB)

  // --- 4. AC3's negative, in the tier where the row is actually laid out: no last-activity time renders
  // anywhere in the sidebar. A count, so the failure diff prints a number rather than daemon text. The
  // three surviving `formatLastActivity` callers are unreachable from this screen and are covered by
  // their own unit tests. ---
  await expect(page.locator('.channel-list__time')).toHaveCount(0)

  // --- 5. #1171's AC2, the control's own rectangle. THE HEIGHT ASSERTION ABOVE NO LONGER COVERS THIS
  // and that is why these exist. While the control was an in-flow child of the centred flex line its box
  // set the row's height, so "the row is still 24" was the detector for a control at the wrong size;
  // #1171 positioned it absolutely, so it cannot size the row at all any more and the row read would sit
  // there green whatever the control did. Pinned directly instead: the drawn 12×12 glyph, its right edge
  // 8px in from the row's right edge, its box centred on the row, in the drawn `--color-primary`. The
  // GLYPH is measured rather than the button, because the acceptance pins the glyph's rectangle and the
  // button is a deliberately larger pointer target around it. The control's box is still asserted not to
  // exceed the row, since an absolutely positioned box can overflow where an in-flow one could not. ---
  const saveBox = await boxOf(save, 'Save-as-channel control')
  expect(saveBox.height).toBeLessThanOrEqual(ROW_HEIGHT_PX + GEOMETRY_TOLERANCE_PX)
  expectAbout((await boxOf(row, 'sidebar row')).height, ROW_HEIGHT_PX)

  const glyphBox = await boxOf(saveIcon, 'Save-as-channel glyph')
  const glyphRowBox = await boxOf(row, 'sidebar row')
  expectAbout(glyphBox.width, GLYPH_PX)
  expectAbout(glyphBox.height, GLYPH_PX)
  // #1441 MOVED THIS NUMBER, and it is the one read in this file that changed rather than being added:
  // the chevron gave the row's edge to the pen and sits 20px inside it. A chevron left at `right: 0`
  // would sit UNDER the pen's box and draw its glyph over the pen's, and only this read would say so.
  expectAbout(
    glyphRowBox.x + glyphRowBox.width - (glyphBox.x + glyphBox.width),
    CHEVRON_RIGHT_INSET_PX
  )
  expectAbout(glyphBox.y + glyphBox.height / 2, glyphRowBox.y + glyphRowBox.height / 2)
  expect(await computed(save, 'color')).toBe(GLYPH_RGB)

  // --- 5b. #1441's AC1: the chat row's PEN, beside the chevron above and keeping #1171's geometry — the
  // drawn 12×12 glyph, its right edge 8px in from the row's right edge, its box centred on the row, in the
  // same `--color-primary`. Read as its own block against `GLYPH_RIGHT_INSET_PX` while the chevron above
  // reads `CHEVRON_RIGHT_INSET_PX`, so the two controls' places fail independently and a failure names
  // which one moved. ---
  const penBox = await boxOf(chatEdit, 'chat pen control')
  expect(penBox.height).toBeLessThanOrEqual(ROW_HEIGHT_PX + GEOMETRY_TOLERANCE_PX)
  const penGlyphBox = await boxOf(page.locator('.channel-list__chat-edit-icon'), 'chat pen glyph')
  expectAbout(penGlyphBox.width, GLYPH_PX)
  expectAbout(penGlyphBox.height, GLYPH_PX)
  expectAbout(
    glyphRowBox.x + glyphRowBox.width - (penGlyphBox.x + penGlyphBox.width),
    GLYPH_RIGHT_INSET_PX
  )
  expectAbout(penGlyphBox.y + penGlyphBox.height / 2, glyphRowBox.y + glyphRowBox.height / 2)
  expect(await computed(chatEdit, 'color')).toBe(GLYPH_RGB)
  // The two glyphs really are disjoint, not merely at two stated insets — the claim the 8px overlap of
  // their BOXES makes worth asserting. Arithmetic on the two rectangles rather than on the constants, so
  // a stylesheet that satisfied both insets by some other means would still have to keep them apart.
  expect(penGlyphBox.x).toBeGreaterThanOrEqual(glyphBox.x + glyphBox.width)

  // --- 6. AC5: the dot's centre sits on the ROW's centre. #1097 ruled that from a frame whose dot was
  // dropped 3px (a 14px-tall wrapper the app does not draw, with its circle at cy=11), rejecting the
  // offset as an artifact of that wrapper. The redrawn instance agrees with the ruling outright: a 6×11
  // frame top-aligned in the row's 16px content box with its circle at cy=8 puts the centre at y=12 in a
  // 24px row. So this assertion outlived the argument it was written to settle, and it still detects the
  // same regression — 3px is three times the tolerance. ---
  const rowBox = await boxOf(row, 'sidebar row')
  const dotBox = await boxOf(dot, 'status dot')
  expectAbout(dotBox.y + dotBox.height / 2, rowBox.y + rowBox.height / 2)

  // --- 7. AC1's pitch. Mint a second row through the real product control — the workspace row's `Create
  // chat` plus confirms a daemon-default create. The seed uses that default cwd, so the two
  // rows land in ONE group as adjacent siblings. Both assertions matter and they fail in opposite
  // directions: a `gap` on the `.channel-list` column would produce the 4px between rows AND move the
  // workspace row's spacing, which AC1's second half forbids. The adjacent-sibling rule produces the
  // first and leaves the second at the zero it has today. ---
  await confirmCreateChat(page)
  await expect(row).toHaveCount(2)
  // TWO workspace rows since #1485: both conversations are chats, so the Channels tree draws the same
  // workspace as an empty mirror above the divider. The count is still an exact number rather than a
  // `.first()` — one group per tree is the claim, and three would mean the two chats had split.
  await expect(page.locator('.channel-list__section')).toHaveCount(2)

  const firstRow = await boxOf(row.nth(0), 'first sidebar row')
  const secondRow = await boxOf(row.nth(1), 'second sidebar row')
  // `.nth(1)` is the CHATS tree's group — the one these rows sit under. The Channels mirror renders
  // first, above the divider, and boxing it would measure the gap to nothing.
  const sectionRow = await boxOf(page.locator('.channel-list__section').nth(1), 'Chats section')

  expectAbout(gapBetween(firstRow, secondRow), ROW_GAP_PX)
  expectAbout(gapBetween(sectionRow, firstRow), 0)
  // Both rows kept the height, so the pitch really is 24-on-28 and not one row that grew — and both did
  // so with the fill present on one of them, which is what makes this the live detector for a wrapper
  // that grew a padding or a border to carry that fill (#1098's most likely regression).
  expectAbout(firstRow.height, ROW_HEIGHT_PX)
  expectAbout(secondRow.height, ROW_HEIGHT_PX)

  // --- 8. #1098's AC2, through the CREATE activation path: minting a conversation opens it, so the fill
  // MOVED off the seed and onto the new row. Asserted as SETS rather than by `nth()` position: which row
  // the fake re-lists first is not this spec's business, and reading a seed name to disambiguate is what
  // this file's hygiene header rules out. The two assertions are independent — a fill that failed to
  // move would leave two filled rows, and one that moved without clearing would leave two 500s. ---
  await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveCount(1)
  const fills = await computedAll(row, 'background-color')
  expect(fills.filter((colour) => colour === OPEN_FILL_RGB)).toHaveLength(1)
  expect(fills.filter((colour) => colour === NO_FILL_RGBA)).toHaveLength(1)

  // AC3's two halves in one read: the open row's label is 500 and the resting one's is back at #1097's
  // 400. Sorted, so the pair is a set and not an ordering claim.
  const weights = await computedAll(title, 'font-weight')
  expect([...weights].sort()).toEqual([LABEL_WEIGHT_RESTING, LABEL_WEIGHT_OPEN])

  // --- 9. #1171's AC3: a row that is NOT the open one takes the drawn hover fill, and it takes it ON
  // THE WRAPPER — the fill moved off the button with that ticket, so the read moved with it. Addressed
  // by the state attribute's ABSENCE, which needs no seed text. Stated as a SET over both wrappers, so
  // it says both halves at once: the hovered row fills and the open one keeps its own colour. ---
  const resting = page.locator('.channel-list__row-open:not([aria-current])')
  const restingRow = page.locator('.channel-list__row').filter({ has: resting })
  await expect(resting).toHaveCount(1)
  await resting.hover()
  const fillsWhileHovering = await computedAll(row, 'background-color')
  expect([...fillsWhileHovering].sort()).toEqual([OPEN_FILL_RGB, HOVER_FILL_RGB].sort())

  // --- 10. #1171's AC2, the reveal. AT REST EVERY control is transparent, THE OPEN ROW'S INCLUDED —
  // read as a set over both rows, so the open row is covered by the same read rather than by a locator
  // that would have to name it. The pointer is parked at the window's top-left corner first, which is
  // the actions cluster and not a row: `hover()` above left it over the resting row, and this block's
  // whole claim is about the pointer being AWAY.
  //
  // OPACITY IS THE ASSERTED PROPERTY, not visibility, and that is the point rather than a convenience.
  // The control has to keep its box, its place in the accessibility tree and its focusability while
  // hidden — nine shipped specs click or await it without hovering first, five of them `real-daemon-*`
  // readiness gates under a handshake timeout. `display: none` or `visibility: hidden` would satisfy a
  // "not visible" assertion and hang those gates; this one fails against both. ---
  await page.mouse.move(0, 0)
  expect(await computedAll(save, 'opacity')).toEqual([HIDDEN_OPACITY, HIDDEN_OPACITY])
  await expect(save).toHaveCount(2)
  // #1441 — the pen inherits the mechanism wholesale, and asserting it here rather than trusting the
  // restated block is what would catch a new token left out of the shared reveal rule: it would be
  // permanently visible (no `opacity: 0` reached it) or permanently hidden (no reveal did).
  expect(await computedAll(chatEdit, 'opacity')).toEqual([HIDDEN_OPACITY, HIDDEN_OPACITY])
  await expect(chatEdit).toHaveCount(2)

  // Hovering a row reveals ITS control and leaves the other row's alone — sorted, so this is a set claim
  // and not an ordering one. A reveal hung off the wrong scope (the control's own `:hover`, or the whole
  // list's) would give two zeroes or two ones here.
  await resting.hover()
  const opacities = await computedAll(save, 'opacity')
  expect([...opacities].sort()).toEqual([HIDDEN_OPACITY, SHOWN_OPACITY])
  // BOTH of the hovered row's controls come up together, which is the arrangement the chevron's 20px
  // inset exists for. One reveal rule carries all three selectors, so this is also what says the pen was
  // added to that rule rather than given a second one that could drift out of step with it.
  expect([...(await computedAll(chatEdit, 'opacity'))].sort()).toEqual([HIDDEN_OPACITY, SHOWN_OPACITY])

  // --- 11. #1171's AC3, the clause the whole fill move exists for: the fill does not drop as the
  // pointer travels from the title onto the glyph. The control is a SIBLING of the button, not its
  // child, so a fill left on the button would lose `:hover` the instant the pointer crossed onto the
  // control that sits over its trailing padding, and the row would flicker. Same set as block 9, with
  // the pointer somewhere block 9 never put it. ---
  await restingRow.locator('.channel-list__save-icon').hover()
  const fillsOverGlyph = await computedAll(row, 'background-color')
  expect([...fillsOverGlyph].sort()).toEqual([OPEN_FILL_RGB, HOVER_FILL_RGB].sort())

  // --- 11b. Both idle dots retain their half-opacity rings on resting, open and hovered rows.
  await expect(page.locator('.conversation-status-dot--idle')).toHaveCount(2)
  await page.mouse.move(0, 0)
  expect(await computedAll(dot, 'background-color')).toEqual([NO_FILL_RGBA, NO_FILL_RGBA])
  expect(await computedAll(dot, 'box-shadow')).toEqual([DOT_RING, DOT_RING])
  expect(await computedAll(dot, 'opacity')).toEqual(['0.5', '0.5'])

  await resting.hover()
  expect(await computedAll(dot, 'background-color')).toEqual([NO_FILL_RGBA, NO_FILL_RGBA])
  expect(await computedAll(dot, 'box-shadow')).toEqual([DOT_RING, DOT_RING])
  expect(await computedAll(dot, 'opacity')).toEqual(['0.5', '0.5'])

  // --- 12. #1171's AC4, first clause: a click on the DOT still opens the conversation. The dot is a
  // sibling of the open button and sits over it, so this holds only because it is out of flow and
  // `pointer-events: none` — put it back in the flex flow, or give it back its events, and the click
  // lands on a <span> that does nothing while every other assertion in this file stays green.
  //
  // Driven through `page.mouse` at the dot's own centre rather than `locator.click()`, which would
  // retarget to the element that actually receives the event and prove nothing about the coordinate.
  // The row is identified by its box's `y` before and after, never by its text — the hygiene posture. ---
  const restingRowBox = await boxOf(restingRow, 'resting sidebar row')
  const restingDot = await boxOf(
    restingRow.locator('.conversation-status-dot'),
    'resting row status dot'
  )
  await page.mouse.click(
    restingDot.x + restingDot.width / 2,
    restingDot.y + restingDot.height / 2
  )
  const openedRow = page
    .locator('.channel-list__row')
    .filter({ has: page.locator('.channel-list__row-open[aria-current="true"]') })
  await expect(openedRow).toHaveCount(1)
  expectAbout((await boxOf(openedRow, 'the row the dot click opened')).y, restingRowBox.y)

  // --- 13. The control still OPENS its dialog. Geometry or a reveal that silently broke the click would
  // satisfy every assertion above. `.first()` because there are two rows by now; either row's control
  // proves the same thing — and neither is hovered first, which is the same unedited-spec path AC4
  // promises the nine shipped callers. ---
  await save.first().click()
  await expect(page.getByRole('dialog', { name: 'Save as channel', exact: true })).toBeVisible()
})

test('a Channels row holds the Edit channel pen inside the same 24px row', async ({
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
  // The disjointness the affordance's own contract rests on, restated as this block's precondition. Since
  // #1441 the CHEVRON is what is disjoint by section, the pen no longer being so — and the second line is
  // the other half of that: the Chats tree's token does not reach a Channels row, which is what keeps
  // `.channel-list__rename` meaning "promoted row" for the twelve shipped locators that read it that way.
  await expect(page.locator('.channel-list__save')).toHaveCount(0)
  await expect(page.locator('.channel-list__chat-edit')).toHaveCount(0)

  // AC4, second half: the Edit channel pen sits inside the 24px row without growing it. Same assertions as
  // the Save control's, against the rule that carries its own copy of the treatment — so reverting either
  // rule alone reddens exactly one of the two blocks.
  const rowHeight = async (): Promise<number> => (await boxOf(row, 'sidebar row')).height
  await expect.poll(rowHeight).toBeLessThanOrEqual(ROW_HEIGHT_PX + GEOMETRY_TOLERANCE_PX)
  expectAbout(await rowHeight(), ROW_HEIGHT_PX)

  const renameBox = await boxOf(rename, 'Edit channel pen')
  expect(renameBox.height).toBeLessThanOrEqual(ROW_HEIGHT_PX + GEOMETRY_TOLERANCE_PX)

  // #1171's AC2 on the Channels tree: the drawn 12×12 pen, its right edge 8px in from the row's right
  // edge, its box centred on the row, in `--color-primary`. One `Row` serves both trees, so this and the
  // chevron's block above differ only in which glyph the section places — a per-tree divergence in the
  // BOX would be the regression, and it would show as one of the two blocks reddening alone.
  const penBox = await boxOf(page.locator('.channel-list__rename-icon'), 'Edit channel glyph')
  const penRowBox = await boxOf(row, 'sidebar row')
  expectAbout(penBox.width, GLYPH_PX)
  expectAbout(penBox.height, GLYPH_PX)
  expectAbout(penRowBox.x + penRowBox.width - (penBox.x + penBox.width), GLYPH_RIGHT_INSET_PX)
  expectAbout(penBox.y + penBox.height / 2, penRowBox.y + penRowBox.height / 2)
  expect(await computed(rename, 'color')).toBe(GLYPH_RGB)

  // #1098 on the CHANNELS tree — one `Row` serves both trees, so a per-tree special case would be a
  // regression rather than a feature, and this seed is the only promoted row either block launches with.
  // It also pins the fill spanning the Edit channel pen rather than a Save-as-channel one: same clause of
  // AC1, the other affordance.
  expect(await computed(row, 'background-color')).toBe(OPEN_FILL_RGB)
  expect(await computed(page.locator('.channel-list__title'), 'font-weight')).toBe(LABEL_WEIGHT_OPEN)
  // The open button spans the whole row since #1171 took the control out of the flex flow, so its focus
  // rectangle does not shrink on a row that carries one. This read WAS `toBeGreaterThan`; see the other
  // block for why the claim inverted rather than went away.
  expectAbout(
    (await boxOf(row, 'sidebar row')).width,
    (await boxOf(page.locator('.channel-list__row-open'), 'open button')).width
  )

  // AC3 holds on this tree too — the Channels rows read the same `Row` component, and a time reintroduced
  // for promoted rows only would pass the other block.
  await expect(page.locator('.channel-list__time')).toHaveCount(0)

  // #1171's AC2 on THE OPEN ROW: it shows no control at rest either. Juhana's ruling, 2026-09-06 — the
  // Active variant as drawn carries a pen, and that pen is a leftover of building Active from Hover, so
  // the open row behaves like every other row here. This block's single row is the open one (the fixture
  // reached the thread by clicking it), which is what makes this the place to assert it.
  await page.mouse.move(0, 0)
  expect(await computed(rename, 'opacity')).toBe(HIDDEN_OPACITY)

  // ...and KEYBOARD FOCUS ALONE reveals it, so Tab still reaches a control the pointer never touched.
  // Reached by focusing the open button and pressing Tab, NOT by `locator.focus()`: `:focus-visible` is
  // Chromium's keyboard-modality heuristic, and a programmatic focus after a pointer interaction does not
  // match it — the assertion would then be testing the heuristic rather than the rule. The Tab keypress
  // itself sets that modality, and the control is the next focusable element in the row.
  await page.locator('.channel-list__row-open').focus()
  await page.keyboard.press('Tab')
  await expect(rename).toBeFocused()
  expect(await computed(rename, 'opacity')).toBe(SHOWN_OPACITY)

  // And it still opens its dialog — reached with a plain click and no hover first, the same path the nine
  // shipped specs that address these controls take. Since #1476 that dialog is EDIT CHANNEL, under its own
  // overlay token; the Chats block below still reaches Edit chat, which is what keeps the two pens' two
  // modals an assertion rather than a claim.
  await rename.click()
  await expect(page.locator('.edit-channel-overlay')).toBeVisible()
})

// #1441's AC1, its behaviour clause: the chat row's pen OPENS the Edit chat modal #1440 shipped, seeded
// with the row's displayed title, and a rename typed there reaches the daemon and comes back on the row.
// Geometry and a reveal that silently opened nothing would satisfy every assertion in the first block.
//
// A THIRD LAUNCH rather than a drive folded into that block, for the reason the second one needs its own:
// that block mints a second row partway through, and from there "the chat row" is two rows with no way to
// name one that this file's hygiene posture allows. One seeded row is unambiguous.
//
// THE SEED IS NULL-NAMED on purpose — it is what makes the `Untitled` fallback AC1 names an assertion
// rather than a claim about a code path, and it is also why this block reads text at all without reading
// anything daemon-derived. The rename round trip is real: `conversationStateFake` applies
// `rename_conversation` to its held list and answers the app's re-request from the updated state, so the
// title below comes back off the wire rather than out of a local optimistic write.
test("a Chats row's pen opens Edit chat on the row's title and renames through it", async ({
  launchPairedApp
}) => {
  const TYPED_NAME = 'Renamed from the row'
  const buildReplyFrames = conversationStateFake({
    conversations: [seed({ is_promoted: false, name: null })]
  })
  const { page } = await launchPairedApp({ buildReplyFrames })

  const row = page.locator('.channel-list__row')
  const title = page.locator('.channel-list__title')
  const chatEdit = page.locator('.channel-list__chat-edit')
  await expect(row).toHaveCount(1)
  await expect(chatEdit).toHaveCount(1)
  // The row's DISPLAYED title, which is the placeholder a null-named row draws — asserted before the
  // dialog so "seeded with the row's displayed title" below is a comparison against something read, not
  // against a constant that happens to match.
  await expect(title).toHaveText(UNNAMED_LABEL)

  // Clicked with no hover first — the path every shipped spec that addresses these controls takes, and
  // what the `opacity` reveal (rather than a `display: none` one) is what makes possible.
  await chatEdit.click()
  const dialog = page.getByRole('dialog', { name: 'Edit chat', exact: true })
  await expect(dialog).toBeVisible()
  const input = dialog.getByRole('textbox', { name: 'Channel name:', exact: true })
  await expect(input).toHaveValue(UNNAMED_LABEL)

  await input.fill(TYPED_NAME)
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  // The row still reads its title from the daemon's re-list, so this is the whole round trip: the pen's
  // handler seeded the field, the dialog's Save sent `rename_conversation`, the fake applied it, and the
  // re-list came back. A pen wired to a dialog that sends nothing would leave the placeholder here.
  await expect(title).toHaveText(TYPED_NAME)
  await expect(row).toHaveCount(1)
})
