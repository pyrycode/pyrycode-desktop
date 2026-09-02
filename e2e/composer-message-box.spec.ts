import type { Page } from '@playwright/test'
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
