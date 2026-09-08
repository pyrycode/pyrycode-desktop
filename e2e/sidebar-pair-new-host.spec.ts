import type { Locator } from '@playwright/test'
import { test, expect } from './fixtures/launchPairedApp'

// Fake-stack UI e2e for the section headers' pair-new-host plus (#1303). Two things are proven here and
// neither is reachable from the unit tier: the control's DRAWN geometry against its header's box (the
// renderer tier is `environment: 'node'`, so it has markup and no layout), and the CANCEL DESTINATION,
// which is a route decision made across a click, a screen swap and a second click.
//
// ONE test() block, ONE launch, ONE continuous drive — `paired-shell-navigation.spec.ts`'s posture and
// for its reason: none of these transitions mutates persistent or session state (cancel reaches no
// server, so nothing is paired, cleared or disconnected), and each launch pays a full handshake.
//
// ⭐ ALL THREE ORIGINS IN ONE DRIVE, WHICH IS THE POINT. `pairedRoute.test.ts` pins the reducer's three
// arms in isolation; what it cannot pin is that the CONTAINER records the right origin for the surface
// the operator was actually on. That is what steps 2-4 read back from the running window, and the
// Settings leg (step 4) is in here deliberately even though `paired-shell-navigation.spec.ts` already
// drives it: the shipped origin passing THROUGH THE NEW MACHINERY is the regression this ticket could
// most plausibly cause.
//
// The two buttons carry the same accessible name by design (the drawing places one `Sidebar header`
// component under each section), so that locator is two-match and is INDEXED rather than differentiated
// by name — an added name would be copy the design does not have, invented to make a test easier.
//
// SECRET HYGIENE (carried from the siblings): every assertion reads DOM geometry, visibility or counts
// only. The pairing plumbing (synthetic token, fake static key) lives in launchPairedApp and is never
// echoed; no failure diagnostic serialises a token, key or plaintext.

// The drawing's numbers (Figma "Icon Edgeless" I405:7885;399:1461 in `Sidebar header` 405:7885): a 16px
// glyph whose right edge sits 2px in from the header's right edge, centred on the header's 20px line.
// The header's own box is that 20px line plus the 12px below it — the value AC5 pins as unchanged.
const GLYPH_PX = 16
const GLYPH_INSET_PX = 2
const HEADER_LINE_PX = 20
const HEADER_BOX_PX = 32
// Sub-pixel slack for a fractional device pixel ratio, the geometry suite's own tolerance.
const EPSILON = 0.6

type Box = { x: number; y: number; width: number; height: number }

// `boundingBox()` answers `null` for a detached or hidden node; throwing with the element's name beats
// letting a `null` propagate into an arithmetic comparison that reports NaN.
const boxOf = async (locator: Locator, what: string): Promise<Box> => {
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`no box for ${what}`)
  return box
}

const expectAbout = (actual: number, expected: number): void =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(EPSILON)

test('the section headers’ plus opens pairing and cancel returns to the surface it was launched from', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp()

  const thread = page.locator('.conversation')
  const list = page.locator('section[aria-label="Conversations"]')
  const settings = page.locator('section[aria-label="Settings screen"]')
  // The pairing surface's hook is the field's accessible name alone — `paired-shell-navigation.spec.ts`'s
  // ruling verbatim (#664): not the card heading, which #665's restyle removes, and not the element type,
  // which it changes.
  const pairingField = page.locator('[aria-label="Pairing code"]')
  const headers = page.locator('.channel-list__section-header')
  const plusses = page.getByRole('button', { name: 'Pair new host' })
  const glyphs = page.locator('.channel-list__pair-icon')

  // The fixture ends on the thread — it drove list→thread by clicking the seeded row — so the sidebar and
  // a filled pane are both up. Both halves are read before anything is clicked, which is what makes the
  // pane assertions in steps 2 and 3 mean something.
  await expect(thread).toBeVisible()
  await expect(list).toBeVisible()

  // --- 1. AC1 — one plus per header, drawn AT REST, sized and placed as the node draws it. ---
  //
  // No hover is performed anywhere in this block, deliberately: unlike the row and host-row controls this
  // one has no reveal rule, and a `hover()` here would hide a regression that put one back.
  await expect(headers).toHaveCount(2)
  await expect(plusses).toHaveCount(2)
  await expect(glyphs).toHaveCount(2)

  for (let index = 0; index < 2; index += 1) {
    const header = await boxOf(headers.nth(index), `header ${index}`)
    const glyph = await boxOf(glyphs.nth(index), `glyph ${index}`)

    // The 16px box the node draws.
    expectAbout(glyph.width, GLYPH_PX)
    expectAbout(glyph.height, GLYPH_PX)
    // Its right edge 2px in from the header's — which is the card's content edge, the column every other
    // trailing mark in this tree ends at.
    expectAbout(glyph.x + glyph.width, header.x + header.width - GLYPH_INSET_PX)
    // Centred on the header's 20px LINE, not on its 32px box: the 12px below the line is the section's
    // header→hosts gap and the glyph must not drift down into it.
    expectAbout(glyph.y + glyph.height / 2, header.y + HEADER_LINE_PX / 2)

    // AC5's other half, read here rather than assumed from the CSS: the control is absolutely positioned
    // and out of the flow, so the header's own box is exactly what it was. `sidebar-tree-geometry.spec.ts`
    // pins the 32px this puts between the header's top and the first host row; this pins the box itself.
    expectAbout(header.height, HEADER_BOX_PX)
  }

  // --- 2. AC2/AC3 — the plus, clicked from an OPEN THREAD, opens pairing; Cancel puts the thread back. ---
  //
  // The sharpest of the three origins and the one the ticket exists for: a cancel that landed on `list`
  // would drop the operator out of the chat they were reading.
  await plusses.nth(0).click()
  await expect(pairingField).toBeVisible()
  // The whole shell is replaced by the pairing screen, so the sidebar is genuinely gone — which is what
  // makes the re-appearances below positive, auto-waiting reads of the cancel's own effect rather than
  // observations of something that never moved.
  await expect(list).toHaveCount(0)

  await page.getByRole('button', { name: 'Cancel' }).click()
  // POSITIVE FIRST. `.conversation` re-attaching IS the assertion — the pane was destroyed with the shell
  // and comes back only if cancel routed to `thread`. A bare "did not go to the list" check ordered here
  // instead would pass against a frame the click had not yet produced.
  await expect(thread).toBeVisible()
  await expect(list).toBeVisible()
  await expect(pairingField).toHaveCount(0)

  // --- 3. AC3 — the same plus clicked from the LIST returns to the list, not to the thread. ---
  //
  // Reached via Settings' own back, which is the only control that lands on `list` since #1064 deleted the
  // thread's back arrow. The pane empties on the way, so the two origins are genuinely different states
  // rather than the same one asserted twice.
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(settings).toBeVisible()
  await page.locator('.settings__back').click()
  await expect(list).toBeVisible()
  await expect(thread).toHaveCount(0)

  // The Chats header's plus this time, not the Channels one: both are wired from the same handler, and
  // driving each of them once is what proves neither header is a special case.
  await plusses.nth(1).click()
  await expect(pairingField).toBeVisible()

  await page.getByRole('button', { name: 'Cancel' }).click()
  // POSITIVE FIRST again: the sidebar re-attaching is the cancel's own effect. Only THEN is the pane
  // checked — a `thread` destination would have filled it, so this count discriminates the two routes.
  await expect(list).toBeVisible()
  await expect(pairingField).toHaveCount(0)
  await expect(thread).toHaveCount(0)

  // --- 4. AC3 — the SHIPPED origin still works, through the new machinery. ---
  //
  // Settings → "Pair another server" → Cancel must still land on Settings. `paired-shell-navigation.spec.ts`
  // asserts this too and passes unedited; it is repeated here because THIS spec is where a regression in
  // the origin recording would be diagnosed, and a reader should not have to know the other file exists to
  // see that the second entry did not cost the first one.
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(settings).toBeVisible()
  await page.getByRole('button', { name: 'Pair another server' }).click()
  await expect(pairingField).toBeVisible()

  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(settings).toBeVisible()
  await expect(pairingField).toHaveCount(0)
})
