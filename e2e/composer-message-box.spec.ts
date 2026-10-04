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

  // --- 6. #1063's ring clause: with the textarea focused, the box paints NO ring — and neither does the
  // textarea. #951 moved a ring from the textarea onto the box; #1063 retired it, because the drawing's
  // `Active indicator` (347:6441) is HIDDEN in the node and the box's focus indicator is the caret below.
  // This is #951's own checkpoint INVERTED rather than deleted: read the other way it is the same proof,
  // and without it the ring's absence is unpinned and free to drift back. A focused text field always
  // matches :focus-visible, pointer or keyboard, so focus() alone is enough to arm anything that still
  // would paint. ---
  await input.focus()
  const focusedBox = await box.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      outlineStyle: style.outlineStyle,
      borderStyle: style.borderTopStyle,
      boxShadow: style.boxShadow,
      radius: style.borderTopLeftRadius
    }
  })
  expect(focusedBox.outlineStyle).toBe('none')
  // Not the outline alone: the criterion is that NOTHING paints a ring, and an outline is only one of the
  // ways to draw one. A border or a shadow arriving in its place would sail past a bare outlineStyle check
  // while putting the pale edge straight back — and a border would also reflow, which section 8 catches.
  expect(focusedBox.borderStyle).toBe('none')
  expect(focusedBox.boxShadow).toBe('none')
  // The textarea's own ring stays suppressed (.composer__input keeps `outline: none`). That declaration is
  // deliberately KEPT by #1063 and this assertion is unchanged from #951 — it is now the more load-bearing
  // of the two, because dropping it hands the box back the UA's own ring, the opposite of the ask.
  expect(await input.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none')

  // --- 7. The caret, which is what the retired ring was traded FOR: "the blinking cursor is enough" is the
  // whole justification for removing it, and before #1063 no spec asserted a caret existed at all. NEGATIVE
  // assertions on purpose. caret-color is set nowhere in this stylesheet, so the caret is the UA's and
  // inherits the input's `color` — the computed value is the keyword `auto` and there is no rgb here to
  // compare against, which is why this is "not hidden" and not "equals --color-on-surface". No spec can see
  // a caret blink. What this pins is that a later ticket cannot silently hide it and leave the most
  // prominent focusable thing in the app with no focus indicator at all. ---
  const caret = await input.evaluate((el) => ({
    color: getComputedStyle(el).caretColor,
    isFocused: el === document.activeElement
  }))
  //
  // THE SECOND ARM IS THE DETECTOR, measured: `caret-color: transparent` on .composer__input reddens this
  // block on the rgba() line, because Chromium serialises the keyword to `rgba(0, 0, 0, 0)` and the
  // `'transparent'` arm above never fires. That arm is kept anyway — it costs nothing and the day a
  // computed value serialises as the keyword it is the one that catches it — but it is not what proves
  // this checkpoint works, and a future edit that keeps only one must keep the rgba one. ---
  expect(caret.isFocused).toBe(true)
  expect(caret.color).not.toBe('transparent')
  expect(caret.color).not.toBe('rgba(0, 0, 0, 0)')

  // --- 8. Nothing reflowed when focus arrived. This is not a regression check on the DELETED rule — an
  // outline never participated in layout — it is the check that nothing replaced it with something that
  // does, which a border in its place is exactly. Section 1's resting numbers, re-read under focus rather
  // than restated. ---
  const focusedGeometry = await box.boundingBox()
  if (!focusedGeometry) throw new Error('the message box lost its layout box on focus')
  expect(wholePixels(focusedGeometry.height)).toBe(BOX_HEIGHT_PX)
  expect(wholePixels(focusedGeometry.width - boxBox.width)).toBe(0)
  expect(focusedBox.radius).toBe(`${BOX_RADIUS_PX}px`)

  // --- 9. The deletion was SURGICAL: .composer__send:focus-visible still paints this file's shipped
  // `1px solid --color-outline`, four rules below the one that went. #1063 removed one of 22 focus rings in
  // conversation.css and is not licence to drop the other 21 — the trade it makes is a text field's, whose
  // caret is an indicator in its own right, and it would not hold on a button like this one.
  //
  // TAB rather than control.focus(): :focus-visible matches after a KEY PRESS in this tier and not reliably
  // after a programmatic focus() on a button — e2e/attachment-file-row.spec.ts states that rule and this
  // copies it. The control is in the tab order here because `canSend` derives from the connection status
  // rather than from the draft (composerAvailability), so a paired launch has it enabled with an empty box. ---
  await page.keyboard.press('Tab')
  expect(await control.evaluate((el) => el === document.activeElement)).toBe(true)
  const controlRing = await control.evaluate((el) => {
    const style = getComputedStyle(el)
    return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor }
  })
  expect(controlRing.style).toBe('solid')
  expect(controlRing.width).toBe('1px')
  expect(controlRing.color).toBe(await tokenColor(page, '--color-outline'))

  // Focus has now LEFT the box, and it is unchanged again — the second half of "nothing reflows when focus
  // arrives or leaves". The box wears no ring in either state, which is also what keeps the retired rule
  // from coming back as a :focus-within variant: that selector would still match right now, with the send
  // control holding focus, and would draw a second ring around the box on top of the button's own.
  const blurredGeometry = await box.boundingBox()
  if (!blurredGeometry) throw new Error('the message box lost its layout box on blur')
  expect(wholePixels(blurredGeometry.height)).toBe(BOX_HEIGHT_PX)
  expect(await box.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none')
})

// #1056 — the grown box. The block above is AC1's detector and its RESTING-GEOMETRY checkpoints stay
// UNEDITED: their whole contract is that the resting render is byte-stable, and an edit to one of them
// would be the thing they exist to catch. These two blocks join them rather than replacing anything.
//
// #1063 — THAT INSTRUCTION IS ABOUT THE RESTING-GEOMETRY CHECKPOINTS AND NOT ABOUT THE FOCUS ONE, which
// #1063 rewrote on purpose when it retired the box's focus ring. Read as a blanket ban it would have left
// section 6 asserting a rule that no longer exists — a red gate, not a preserved contract — and deleting it
// instead would have left the ring's absence pinned by nothing. The resting numbers themselves are
// untouched by that rewrite: sections 8 and 9 now re-read them under focus and after blur, so the
// byte-stability contract above came out of #1063 stricter rather than weaker.
//
// The split between them is a FIXTURE FACT, not taste. launchPairedApp lands on an EMPTY conversation,
// where `.conversation__empty` renders and `.conversation__thread` does not exist at all — so AC5 has to
// send a message before it has a thread to measure. That send is also AC3's second half, so the two share
// one launch and this one keeps the draft it never sends.
test('the box grows a line at a time to a five-line ceiling, then scrolls (AC2, AC3, AC4)', async ({
  launchPairedApp
}, testInfo) => {
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
    await expect(input).toHaveCSS('scrollbar-width', 'none')
    await expect(input).toHaveCSS('overflow-y', 'auto')
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

  // Computed paint is the detector even with overlay scrollbars or an always-visible OS preference.
  // Wheel input must still reach both ends; small pixel deltas cover the trackpad's wheel-event path,
  // though this does not synthesize physical trackpad momentum.
  const scrollTop = (): Promise<number> => input.evaluate((el) => el.scrollTop)
  await input.hover()
  await page.mouse.wheel(0, -1000)
  await expect.poll(scrollTop).toBe(0)
  await expect(input).toHaveCSS('scrollbar-width', 'none')
  await testInfo.attach('composer-overflow-top', {
    body: await page.screenshot({ path: testInfo.outputPath('composer-overflow-top.png') }),
    contentType: 'image/png'
  })

  await page.mouse.wheel(0, 8)
  await expect.poll(scrollTop).toBeGreaterThan(0)
  await expect(input).toHaveCSS('scrollbar-width', 'none')
  await page.mouse.wheel(0, 1000)
  await expect.poll(() => input.evaluate(
    (el) => el.scrollHeight - el.clientHeight - el.scrollTop
  )).toBe(0)
  await expectBoxHeight(box, GROWN_HEIGHT_PX, 'after wheel scrolling')
  await testInfo.attach('composer-overflow-bottom', {
    body: await page.screenshot({ path: testInfo.outputPath('composer-overflow-bottom.png') }),
    contentType: 'image/png'
  })

  await input.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home')
  await input.pressSequentially('start ')
  // The caret's line is in view, asserted with the same tolerance as the tail above and not as
  // "scrolled fully to the top". macOS's Meta+ArrowUp scrolls to 0. Linux's Control+Home scrolls the
  // CARET flush to the edge, which leaves the first line's leading above the fold: measured 6px under
  // Xvfb in the pyrybox dispatcher container, 2026-10-04, with Roboto bundled.
  await expect.poll(scrollTop).toBeLessThan(LINE_HEIGHT_PX)
  await input.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  await input.pressSequentially(' end')
  await expect(input).toHaveValue(`start ${draftOfLines(8)}! end`)
  await expect.poll(() => input.evaluate(
    (el) => el.scrollHeight - el.clientHeight - el.scrollTop
  )).toBeLessThan(LINE_HEIGHT_PX)
  await expect(input).toHaveCSS('scrollbar-width', 'none')
  await expectBoxHeight(box, GROWN_HEIGHT_PX, 'after editing both ends')

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
