import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures/launchPairedApp'

// #951 — the message box redrawn as the design's `Input large` (Figma 347:6635). EVERY assertion here is
// geometry or computed style, which is exactly why the file exists: vitest runs the `node` environment
// (vitest.config.ts), so there is no layout, no CSSOM and no getComputedStyle, and the whole ticket is a
// restyle. The markup half — which glyph each variant renders, at what size, with no colour of its own —
// is pinned in ConversationScreen.test.tsx and deliberately not repeated here.
//
// NOT PROVED HERE, on purpose: the slash type-ahead's placement over the redrawn box. This redraw moves
// the anchor rect in HEIGHT only (48 → 52), and composer-options-clamp.spec.ts and
// slash-command-type-ahead.spec.ts already measure that anchor's x and width against the shipped
// placement. They are AC3's detectors and a third copy here would only be a slower duplicate.
//
// ONE test() block, ONE launch — the composer-options-clamp.spec.ts shape. Nothing here mutates state, so
// every checkpoint reads the same first paint.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads geometry, computed
// style and accessible names only. Nothing serialises a token, a key or plaintext.

// The drawing's own numbers, re-read off the node on 2026-09-03. Held as named constants so a failure
// message says which of them moved rather than reporting a bare pixel delta.
const BOX_HEIGHT_PX = 52
const BOX_RADIUS_PX = 6
const CONTROL_SIZE_PX = 48
const CONTROL_INSET_PX = 4
// The control's 48px plus its 4px inset plus 4px of clearance — what keeps the text from running under it.
const TEXT_RIGHT_INSET_PX = CONTROL_SIZE_PX + CONTROL_INSET_PX + 4
const TEXT_LEFT_INSET_PX = 16
const GROUND_OPACITY = '0.41'

// The two colour tokens the redraw names. Compared by TOKEN rather than by hex throughout: a scheme
// change should move the design, not redden this spec, and a hardcoded #003355 here would be the same
// mistake the stylesheet's own comments warn about on every colour rule in the file.
const GROUND_TOKEN = '--color-on-primary'
const GLYPH_TOKEN = '--color-primary'

// composer-options-clamp.spec.ts's helper verbatim: `Math.round` of a tiny negative delta is `-0`, and
// `toBe` is Object.is, so `Object.is(-0, 0)` is false and a perfectly correct render fails. The exactly
// right checkpoint is the one that would never settle.
const wholePixels = (delta: number): number => {
  const rounded = Math.round(delta)
  return rounded === 0 ? 0 : rounded
}

// #1056 — the grown states, joining the resting ones above. The resting numbers are REUSED, never
// restated: 132 is derived from BOX_HEIGHT_PX exactly the way the box's own 52 is derived from its
// padding, so a failure here says which of the two moved rather than reporting a bare 132.
const LINE_HEIGHT_PX = 20
const MAX_LINES = 5
const GROWN_HEIGHT_PX = BOX_HEIGHT_PX + (MAX_LINES - 1) * LINE_HEIGHT_PX

// EXPLICIT NEWLINES, never a long line left to wrap. N of these is N lines on any window width and any
// font metric; a single string that happens to wrap N times at 800px is a detector that moves the day the
// sidebar does. (The one long-line draft below is a WIDTH probe, where the wrap count is irrelevant.)
const draftOfLines = (count: number): string =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n')

// The resting block above throws on a missing box once, for ten assertions. These blocks read boxes at
// eight different draft lengths, so the same throw lives in a helper rather than eight times over.
const rectOf = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const rect = await locator.boundingBox()
  if (!rect) throw new Error('the located node has no layout box')
  return rect
}

// Height is polled, never read once: `fill()` returns when the value is set, and the box's new height is
// a LAYOUT consequence of that value one frame later. A bare boundingBox() here would be a flake with a
// plausible failure message.
const expectBoxHeight = async (box: Locator, expected: number, at: string): Promise<void> => {
  await expect
    .poll(async () => wholePixels((await rectOf(box)).height), { message: `the box ${at}` })
    .toBe(expected)
}

// A token's value as the CSSOM serialises a COLOUR — `#003355` becomes `rgb(0, 51, 85)`, which is the
// form every getComputedStyle() reading below is in. Painted onto a throwaway probe rather than parsed by
// hand, so the conversion is the engine's own and cannot drift from it.
const tokenColor = async (page: Page, token: string): Promise<string> =>
  page.evaluate((name) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (value === '') return ''
    const probe = document.createElement('span')
    probe.style.color = value
    document.body.append(probe)
    const resolved = getComputedStyle(probe).color
    probe.remove()
    return resolved
  }, token)

test('the message box is the design Input large, with the control inside its right end (AC1, AC2)', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp()

  // Two of the three classes AC4 pins byte-stable, located exactly as the sibling specs locate class-only
  // nodes. The control is located by its accessible name instead — `Send` is the load-bearing e2e locator
  // ~15 specs already use, so asserting the redrawn control still answers to it is free coverage of AC4.
  const box = page.locator('.composer__row')
  const input = page.locator('.composer__input')
  const control = page.getByRole('button', { name: 'Send', exact: true })

  await expect(box).toBeVisible()
  await expect(control).toBeVisible()

  const boxBox = await box.boundingBox()
  const controlBox = await control.boundingBox()
  // A missing box is a node that never laid out. Thrown rather than asserted null-safe per checkpoint, so
  // the ten assertions below read as geometry instead of as null handling.
  if (!boxBox || !controlBox) throw new Error('the message box or its control has no layout box')

  // --- 1. The box: 52px tall on a 6px corner (AC1). The height is DERIVED, not declared — 12px of row
  // padding, 4px of field padding, one 14/20 line, and the same again below — so this checkpoint is the
  // only proof the arithmetic lands where the drawing does. ---
  expect(wholePixels(boxBox.height)).toBe(BOX_HEIGHT_PX)
  expect(await box.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe(
    `${BOX_RADIUS_PX}px`
  )

  // --- 2. The ground: --color-on-primary at 41%, on the row's ::before rather than as a colour value (the
  // house rule "opacity is not a color literal"). The row's OWN background must stay transparent — if the
  // ground ever moved onto it as an rgba()/color-mix() literal, that is the assertion that reddens. ---
  const [groundColor, groundOpacity, rowBackground] = await box.evaluate((el) => {
    const before = getComputedStyle(el, '::before')
    return [before.backgroundColor, before.opacity, getComputedStyle(el).backgroundColor]
  })
  expect(groundOpacity).toBe(GROUND_OPACITY)
  expect(rowBackground).toBe('rgba(0, 0, 0, 0)')
  expect(groundColor).toBe(await tokenColor(page, GROUND_TOKEN))

  // --- 3. The control sits INSIDE the box: 4px clear of its right edge and vertically centred, which is
  // the drawing's 2px above and 2px below a 48px control in a 52px box (AC1). Before this ticket it was a
  // flex SIBLING beside the box, so every one of these four deltas was a different number. ---
  expect(wholePixels(controlBox.width)).toBe(CONTROL_SIZE_PX)
  expect(wholePixels(controlBox.height)).toBe(CONTROL_SIZE_PX)
  expect(wholePixels(boxBox.x + boxBox.width - (controlBox.x + controlBox.width))).toBe(
    CONTROL_INSET_PX
  )
  const gapAbove = wholePixels(controlBox.y - boxBox.y)
  const gapBelow = wholePixels(boxBox.y + boxBox.height - (controlBox.y + controlBox.height))
  expect(gapAbove).toBe(gapBelow)

  // --- 4. No visible container at rest (AC2). The M3 icon button's own Figma description: until the
  // button is interacted with, its container isn't visible. The glyph carries the affordance alone, in
  // --color-primary. ---
  const [controlBackground, controlColor] = await control.evaluate((el) => {
    const style = getComputedStyle(el)
    return [style.backgroundColor, style.color]
  })
  expect(controlBackground).toBe('rgba(0, 0, 0, 0)')
  expect(controlColor).toBe(await tokenColor(page, GLYPH_TOKEN))

  // --- 5. The text's insets (AC1): 16px from the box's left edge, and enough on the right that a long
  // draft can never run under the control. The right inset is asserted as a FLOOR rather than as the exact
  // 56, so widening the clearance stays a design choice while narrowing it past the control reddens. ---
  const [paddingLeft, paddingRight] = await input.evaluate((el) => {
    const style = getComputedStyle(el)
    return [style.paddingLeft, style.paddingRight]
  })
  expect(paddingLeft).toBe(`${TEXT_LEFT_INSET_PX}px`)
  expect(Number.parseFloat(paddingRight)).toBeGreaterThanOrEqual(TEXT_RIGHT_INSET_PX)

  // --- 6. AC3's focus clause: the ring paints on the BOX, not on the textarea, and on the shipped
  // --color-outline treatment. A focused text field always matches :focus-visible, pointer or keyboard, so
  // focus() alone is enough to arm the :has() selector. ---
  await input.focus()
  const [boxOutlineStyle, boxOutlineWidth, boxOutlineColor, inputOutlineStyle] = await Promise.all([
    box.evaluate((el) => getComputedStyle(el).outlineStyle),
    box.evaluate((el) => getComputedStyle(el).outlineWidth),
    box.evaluate((el) => getComputedStyle(el).outlineColor),
    input.evaluate((el) => getComputedStyle(el).outlineStyle)
  ])
  expect(boxOutlineStyle).toBe('solid')
  expect(boxOutlineWidth).toBe('1px')
  expect(boxOutlineColor).toBe(await tokenColor(page, '--color-outline'))
  // And nowhere else: the textarea's own ring stays suppressed, so the box wears the only one.
  expect(inputOutlineStyle).toBe('none')
})

// #1056 — the grown box. The block above is AC1's detector and stays UNEDITED: its whole contract is that
// the resting render is byte-stable, and an edit to it would be the thing it exists to catch. These two
// blocks join it rather than replacing anything.
//
// The split between them is a FIXTURE FACT, not taste. launchPairedApp lands on an EMPTY conversation,
// where `.conversation__empty` renders and `.conversation__thread` does not exist at all — so AC5 has to
// send a message before it has a thread to measure. That send is also AC3's second half, so the two share
// one launch and this one keeps the draft it never sends.
test('the box grows a line at a time to a five-line ceiling, then scrolls (AC2, AC3, AC4)', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp()

  const box = page.locator('.composer__row')
  const input = page.locator('.composer__input')
  const control = page.getByRole('button', { name: 'Send', exact: true })

  await expect(box).toBeVisible()
  const restingRow = await rectOf(box)
  const restingControl = await rectOf(control)
  const restingGapBelow = wholePixels(
    restingRow.y + restingRow.height - (restingControl.y + restingControl.height)
  )

  // --- AC2, the growth. Asserted line BY LINE rather than only at the ceiling: a rule that jumped
  // straight to its max-height would satisfy an endpoint-only check, and the defect being fixed is
  // precisely that the box does not track the draft. ---
  for (let lines = 1; lines <= MAX_LINES; lines += 1) {
    await input.fill(draftOfLines(lines))
    await expectBoxHeight(box, BOX_HEIGHT_PX + (lines - 1) * LINE_HEIGHT_PX, `at ${lines} line(s)`)
  }

  // --- AC4, the pin, read at the ceiling where a centring and a pin are 40px apart. The gap BELOW is
  // the invariant; the gap ABOVE is asserted at its exact derived value, which a centred control could
  // not produce (it would be 42). Both are needed: the first alone holds for a box that never grew. ---
  const grownRow = await rectOf(box)
  const grownControl = await rectOf(control)
  expect(wholePixels(grownControl.width)).toBe(CONTROL_SIZE_PX)
  expect(wholePixels(grownControl.height)).toBe(CONTROL_SIZE_PX)
  expect(
    wholePixels(grownRow.y + grownRow.height - (grownControl.y + grownControl.height))
  ).toBe(restingGapBelow)
  expect(wholePixels(grownControl.y - grownRow.y)).toBe(
    GROWN_HEIGHT_PX - CONTROL_SIZE_PX - restingGapBelow
  )

  // --- AC2, the ceiling and the scroll. Past five lines the box holds and the draft moves inside it. ---
  for (const lines of [6, 8]) {
    await input.fill(draftOfLines(lines))
    await expectBoxHeight(box, GROWN_HEIGHT_PX, `at ${lines} line(s), past the ceiling`)
    const overflow = await input.evaluate<{ scroll: number; client: number }, HTMLTextAreaElement>(
      (el) => ({ scroll: el.scrollHeight, client: el.clientHeight })
    )
    expect(overflow.scroll).toBeGreaterThan(overflow.client)
  }

  // AC2's last clause: the caret's line stays in view. Typed at the tail rather than filled, so the caret
  // genuinely arrives there. Asserted as "less than one line remains below the fold" and NOT as "scrolled
  // fully to the bottom", which would fail against a correct render: Chromium scrolls the CARET flush to
  // the visible edge, and the caret is the ~16px text box inside the 20px line box, so ~6px of the last
  // line's leading stays under the fold by design (measured). The loose form still reddens loudly for the
  // failure that matters — a box that stopped scrolling leaves 60px below the fold, three whole lines.
  await input.pressSequentially('!')
  const belowTheFold = await input.evaluate<number, HTMLTextAreaElement>(
    (el) => el.scrollHeight - (el.scrollTop + el.clientHeight)
  )
  expect(belowTheFold).toBeLessThan(LINE_HEIGHT_PX)

  // --- AC3, by deletion. Back down a line at a time, and exactly 52 again when the draft empties. ---
  await input.fill(draftOfLines(3))
  await expectBoxHeight(box, BOX_HEIGHT_PX + 2 * LINE_HEIGHT_PX, 'shrunk back to 3 lines')
  await input.fill('')
  await expectBoxHeight(box, BOX_HEIGHT_PX, 'with the draft emptied')

  // --- The width half of AC1, which NO shipped assertion covers: the resting block reads the text's
  // padding and the control's right delta, never the textarea's own box. `field-sizing: content` makes a
  // textarea's intrinsic WIDTH content-based too, so `flex: 1 1 auto; min-width: 0` filling the row is a
  // prediction until it is measured — at rest, at the ceiling, and under a draft far wider than the row
  // (where the wrap count is irrelevant and only the border box is being read). ---
  const restingInput = await rectOf(input)
  expect(wholePixels(restingInput.width)).toBe(wholePixels(restingRow.width))
  for (const draft of [draftOfLines(MAX_LINES), 'x'.repeat(1000)]) {
    await input.fill(draft)
    await expectBoxHeight(box, GROWN_HEIGHT_PX, 'holding at the ceiling for the width reading')
    const [row, field] = [await rectOf(box), await rectOf(input)]
    expect(wholePixels(field.width)).toBe(wholePixels(row.width))
  }
})

test('only the thread gives up the space, and a sent draft returns the box to one line (AC3, AC5)', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp()

  const box = page.locator('.composer__row')
  const input = page.locator('.composer__input')
  const thread = page.locator('.conversation__thread')
  const status = page.locator('.composer-status')
  const footer = page.locator('.composer__footer')

  // AC3's second half, and the step that brings the thread into existence: a grown draft, sent for real
  // through the fill → click Send drive send-and-stream.spec.ts uses. The box must return to one line on
  // the send alone — no deletion, no blur.
  await input.fill(draftOfLines(4))
  await expectBoxHeight(box, BOX_HEIGHT_PX + 3 * LINE_HEIGHT_PX, 'holding a 4-line draft')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.bubble').first()).toBeVisible()
  await expectBoxHeight(box, BOX_HEIGHT_PX, 'after the draft is sent')

  // The window's own overflow, read as the app shell's: the conversation column is a fixed-height flex
  // stack, so any height the composer takes without a neighbour giving it up shows up here.
  const documentOverflow = async (): Promise<number> =>
    page.evaluate(
      () => document.documentElement.scrollHeight - document.documentElement.clientHeight
    )

  const restingThread = await rectOf(thread)
  const restingStatus = await rectOf(status)
  const restingFooter = await rectOf(footer)
  expect(await documentOverflow()).toBeLessThanOrEqual(0)

  await input.fill(draftOfLines(MAX_LINES))
  await expectBoxHeight(box, GROWN_HEIGHT_PX, 'at the five-line ceiling')

  // --- AC5. The thread's loss is asserted as a DELTA against the box's gain, never as a fixed 428: a
  // literal there would encode this runner's window size rather than the behaviour. This is the half that
  // bites — `.composer__footer` declares `height: 20px` hard, so its reading below can essentially never
  // redden, and `.composer-status`'s min-height grows only for its own error slot. They are the cheap
  // sanity check that the growth did not come out of a neighbour, not the detector. ---
  const grownThread = await rectOf(thread)
  expect(wholePixels(restingThread.height - grownThread.height)).toBe(
    GROWN_HEIGHT_PX - BOX_HEIGHT_PX
  )
  expect(wholePixels((await rectOf(status)).height)).toBe(wholePixels(restingStatus.height))
  expect(wholePixels((await rectOf(footer)).height)).toBe(wholePixels(restingFooter.height))
  expect(await documentOverflow()).toBeLessThanOrEqual(0)
})
