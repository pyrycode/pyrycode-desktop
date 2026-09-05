import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures/launchPairedApp'

// #1058 — the two panes draw a card and the backdrop draws the glow (Figma 102:4). EVERY assertion here
// is computed style, geometry or hit-testing, which is why the file exists at all: vitest runs the `node`
// environment (vitest.config.ts), so there is no layout, no CSSOM, no getComputedStyle and no
// elementFromPoint, and the whole ticket is three stylesheets. There is no markup half to pin — not one
// .ts/.tsx file changes — so nothing here is duplicated in a renderer spec.
//
// A SIBLING of paired-shell-navigation.spec.ts rather than an extension of it. That spec's single test()
// block is one continuous navigation drive whose own header explains why it is one block; threading a
// paint audit and an overlay round-trip through it would fight that structure. This file pays its own
// launch and keeps the same one-block discipline for the same reason (each launch pays a full handshake).
//
// ONE test() block, ONE launch, ONE continuous drive. The drive is thread → list → the Save-as-channel
// dialog, and none of it mutates persistent state: the dialog is opened and never confirmed, so no row is
// promoted and the default seed is all this needs.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads computed style,
// geometry, class names and hit-test results only. No failure diagnostic serialises a token, a key or
// plaintext.

// The drawing's own numbers, re-read off the nodes on 2026-09-05. `Channels and chats` (103:2959) and
// `Content` (106:3321) are each bg-[rgba(0,0,0,0.3)] rounded-[6px]; `Container` (103:2963) is p-[20px]
// gap-[20px]. Held as named constants so a failure says which of them moved rather than reporting a bare
// pixel delta.
const WASH_OPACITY = '0.3'
const CARD_RADIUS_PX = 6
const SHELL_INSET_PX = 20
const SHELL_GAP_PX = 20

// Compared by TOKEN rather than by hex throughout: a scheme change should move the design, not redden
// this spec, and a hardcoded #000000 / #101418 / #134a74 here would be the same mistake every colour rule
// in these stylesheets is commented against.
const WASH_TOKEN = '--color-scrim'
const BACKDROP_TOKEN = '--color-surface'
// The gradient's inner stop. Its outer stop is `transparent`, which is NOT asserted by token: gradient
// interpolation is premultiplied, so a zero-alpha stop's channels are unobservable — see the measurement
// recorded in pairedShell.css. Asserting it would be asserting an invisible value.
const GLOW_TOKEN = '--color-primary-container'

// composer-options-clamp.spec.ts's helper verbatim: `Math.round` of a tiny negative delta is `-0`, and
// `toBe` is Object.is, so `Object.is(-0, 0)` is false and a perfectly correct render fails. The exactly
// right checkpoint is the one that would never settle.
const wholePixels = (value: number): number => Math.round(value) + 0

// composer-message-box.spec.ts's helper verbatim. A missing box is a node that never laid out; thrown
// rather than asserted null-safe so the checkpoints below read as geometry instead of as null handling.
const rectOf = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const rect = await locator.boundingBox()
  if (!rect) throw new Error('the located node has no layout box')
  return rect
}

// composer-message-box.spec.ts's token probe verbatim. A token's value as the CSSOM serialises a COLOUR —
// `#000000` becomes `rgb(0, 0, 0)`, which is the form every getComputedStyle() reading below is in.
// Painted onto a throwaway probe rather than parsed by hand, so the conversion is the engine's own and
// cannot drift from it.
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

// Everything one card claims, read in one round trip. The wrapper's OWN background is part of it: if the
// wash ever migrated off the pseudo-element and onto the element as a pre-mixed rgba() literal, that is
// the reading that reddens — the same guard .composer__row carries in composer-message-box.spec.ts, and
// the reason it matters more here is that this wash sits over a GRADIENT, so a flat equivalent does not
// exist to be mixed.
type Card = {
  washColor: string
  washOpacity: string
  ownBackground: string
  radii: string[]
  overflow: string
  padding: string
  borderWidth: string
}
const cardOf = (wrapper: Locator): Promise<Card> =>
  wrapper.evaluate((el) => {
    const wash = getComputedStyle(el, '::before')
    const own = getComputedStyle(el)
    return {
      washColor: wash.backgroundColor,
      washOpacity: wash.opacity,
      ownBackground: own.backgroundColor,
      radii: [
        own.borderTopLeftRadius,
        own.borderTopRightRadius,
        own.borderBottomRightRadius,
        own.borderBottomLeftRadius
      ],
      overflow: own.overflow,
      // AC4's structural half. The ONLY ways this change could move content inside a pane are a padding,
      // a border or a margin on the wrapper — a pseudo-element cannot. Reading them here is cheaper and
      // stricter than re-measuring every row's position.
      padding: [own.paddingTop, own.paddingRight, own.paddingBottom, own.paddingLeft].join(' '),
      borderWidth: [
        own.borderTopWidth,
        own.borderRightWidth,
        own.borderBottomWidth,
        own.borderLeftWidth
      ].join(' ')
    }
  })

// The dimming detector, and it is a REAL one rather than a restatement of the CSS. A pseudo-element
// hit-tests as its originating element, so an unfixed wash over the sidebar swallows the hit and this
// returns `blocked by .paired-shell__sidebar` for every unpositioned descendant — which is exactly the
// defect AC3 names, and exactly what the sidebar's headers and host rows would suffer if the wash landed
// without the stacking fix on .channel-list.
//
// Named `expected` and returned as a STRING rather than a boolean so the failure message says what was
// on top instead of `expected true, received false`.
const hitAt = (page: Page, x: number, y: number, expected: string): Promise<string> =>
  page.evaluate(
    ({ x, y, expected }) => {
      const hit = document.elementFromPoint(x, y)
      if (!hit) return 'nothing is at that point'
      if (hit.closest(expected)) return expected
      const classes = [...hit.classList].map((c) => `.${c}`).join('')
      return `blocked by ${classes === '' ? hit.tagName.toLowerCase() : classes}`
    },
    { x, y, expected }
  )

const hitAtCentreOf = async (page: Page, target: Locator, expected: string): Promise<string> => {
  const box = await rectOf(target)
  return hitAt(page, box.x + box.width / 2, box.y + box.height / 2, expected)
}

test('paired shell: both panes draw the card, the backdrop draws the glow, and nothing is dimmed', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp()

  const shell = page.locator('.paired-shell')
  const sidebar = page.locator('.paired-shell__sidebar')
  const pane = page.locator('.paired-shell__pane')
  const list = page.locator('.channel-list')
  const thread = page.locator('.conversation')

  await expect(thread).toBeVisible()

  const [scrim, surface, glow] = await Promise.all([
    tokenColor(page, WASH_TOKEN),
    tokenColor(page, BACKDROP_TOKEN),
    tokenColor(page, GLOW_TOKEN)
  ])

  // --- 1. Both panes draw the card (AC1). The wash is --color-scrim at 0.3 on a pseudo-element, not a
  // colour value, which is this file family's rule ("opacity is a de-emphasis device, not a colour
  // literal") and the only form that can sit over a gradient without pre-mixing it away. ---
  for (const [name, wrapper] of [
    ['sidebar', sidebar],
    ['pane', pane]
  ] as const) {
    const card = await cardOf(wrapper)
    expect(card.washColor, `${name} wash colour`).toBe(scrim)
    expect(card.washOpacity, `${name} wash opacity`).toBe(WASH_OPACITY)
    expect(card.ownBackground, `${name} own background`).toBe('rgba(0, 0, 0, 0)')
    expect(card.radii, `${name} corners`).toEqual(Array(4).fill(`${CARD_RADIUS_PX}px`))
    // AC5's clip. Read here rather than in checkpoint 5 because it belongs to the card's definition: it
    // is what stops a row's hover rectangle painting over the 6px arc at either end of the column.
    expect(card.overflow, `${name} clip`).toBe('hidden')
    // AC4, structurally: the card adds no box of its own, so it cannot have moved anything inside.
    expect(card.padding, `${name} padding`).toBe('0px 0px 0px 0px')
    expect(card.borderWidth, `${name} border`).toBe('0px 0px 0px 0px')
  }

  // --- 2. The two screens went transparent, which is what lets the card show at all. Before this ticket
  // both painted --color-surface on themselves, the same colour as the backdrop behind them, and that is
  // the whole defect: two panes and a shell, one flat sheet. ---
  expect(await list.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  expect(await thread.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')

  // --- 3. The backdrop carries the glow over the token (AC2). background-color and background-image are
  // separate longhands on purpose: the token survives as a NAME instead of being folded into an opaque
  // first stop, and background-image is the one way to paint this that does not make .paired-shell a
  // containing block for the fixed overlays checkpoint 5 drives. If the surface were ever folded into the
  // gradient, backgroundColor here reads transparent and this reddens. ---
  const backdrop = await shell.evaluate((el) => {
    const style = getComputedStyle(el)
    return { color: style.backgroundColor, image: style.backgroundImage }
  })
  expect(backdrop.color).toBe(surface)
  expect(backdrop.image).toContain('radial-gradient')
  expect(backdrop.image).toContain(glow)

  // --- 4. Nothing in the sidebar is dimmed (AC3), and nothing moved (AC4). The three unpositioned
  // descendants are the ones at risk — .channel-list__row is already position: relative and the sticky
  // FAB and actions cluster are at z-index: 1, so an unfixed wash would dim the headers and host rows and
  // leave the chat rows bright, which is worse than the defect being fixed. The chat row is asserted
  // alongside them precisely because AC3 is a statement about them reading at the SAME strength. ---
  const sectionHeader = page.locator('.channel-list__section-header').first()
  const host = page.locator('.channel-list__host').first()
  const row = page.locator('.channel-list__row-open').first()
  await expect(sectionHeader).toBeVisible()
  await expect(host).toBeVisible()
  await expect(row).toBeVisible()

  expect(await hitAtCentreOf(page, sectionHeader, '.channel-list__section-header')).toBe(
    '.channel-list__section-header'
  )
  expect(await hitAtCentreOf(page, host, '.channel-list__host')).toBe('.channel-list__host')
  expect(await hitAtCentreOf(page, row, '.channel-list__row-open')).toBe('.channel-list__row-open')

  // The geometry half of AC4. The cards sit at the shell's EXISTING 20px inset and 20px gap — the layout
  // #670 already shipped — and each screen still fills its card edge to edge, so no row shifted by so much
  // as a pixel. Both wrappers being padding- and border-free (checkpoint 1) is what makes these four
  // equalities the complete statement rather than a sample.
  const sidebarBox = await rectOf(sidebar)
  const paneBox = await rectOf(pane)
  const listBox = await rectOf(list)
  const threadBox = await rectOf(thread)
  expect(wholePixels(sidebarBox.x)).toBe(SHELL_INSET_PX)
  expect(wholePixels(sidebarBox.y)).toBe(SHELL_INSET_PX)
  expect(wholePixels(paneBox.x - (sidebarBox.x + sidebarBox.width))).toBe(SHELL_GAP_PX)
  expect([listBox.x, listBox.y, listBox.width, listBox.height].map(wholePixels)).toEqual(
    [sidebarBox.x, sidebarBox.y, sidebarBox.width, sidebarBox.height].map(wholePixels)
  )
  expect([threadBox.x, threadBox.y, threadBox.width, threadBox.height].map(wholePixels)).toEqual(
    [paneBox.x, paneBox.y, paneBox.width, paneBox.height].map(wholePixels)
  )

  // --- 5. The EMPTY pane draws the card too (AC1). Back returns the route to `list`, where PairedShell
  // renders .paired-shell__pane with null inside — #670's ruling that the right pane stays genuinely empty
  // still stands, so what the design shows is an empty CARD, not an empty rectangle and not a placeholder.
  // The card is on the wrapper, so this costs no markup and the assertion is that it costs none. ---
  await page.locator('.conversation__back').click()
  await expect(thread).toHaveCount(0)
  await expect(pane).toBeVisible()
  const emptyCard = await cardOf(pane)
  expect(emptyCard.washColor).toBe(scrim)
  expect(emptyCard.washOpacity).toBe(WASH_OPACITY)
  expect(emptyCard.radii).toEqual(Array(4).fill(`${CARD_RADIUS_PX}px`))
  expect(await pane.evaluate((el) => el.children.length)).toBe(0)

  // --- 6. The channel-list overlays still escape the sidebar (AC5). .save-as-channel-overlay is
  // `position: fixed` ON PURPOSE — .channel-list is the overflow-y: auto scroll column, so an absolute
  // overlay would scroll with the rows — and the card's `overflow: hidden` must not take that away. A
  // fixed box is not clipped by an overflow ancestor, but that is the claim, not the evidence.
  //
  // boundingBox() CANNOT be the evidence: a clipped element still reports its full layout box, so it
  // would pass whether or not the clip fired. Hit-testing can, because overflow: hidden removes the
  // clipped-away region from it. The point is over the CHAT PANE, far outside the sidebar's 400px column,
  // so a clipped overlay would leave the pane itself on top and this reads `blocked by`. ---
  await page.locator('.channel-list__save').first().click()
  const overlay = page.locator('.save-as-channel-overlay')
  await expect(overlay).toBeVisible()
  expect(
    await hitAt(
      page,
      paneBox.x + paneBox.width / 2,
      paneBox.y + paneBox.height / 2,
      '.save-as-channel-overlay'
    )
  ).toBe('.save-as-channel-overlay')
})
