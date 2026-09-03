import { test, expect } from './fixtures/launchPairedApp'

// Fake-stack UI e2e for THE FOUR CONNECTION-DOT COLOUR BINDINGS (#962 AC3). Only this tier can prove it.
// `vitest.config.ts` sets `environment: 'node'`, so every renderer spec is a `renderToStaticMarkup` string
// assertion with no stylesheet, no cascade and no `getComputedStyle` — the unit tier can see that
// `HostConnectionDots` EMITS `conn-dot--up` (ChannelList.test.tsx's four `DOT_*_MARKER` constants pin
// exactly that) and can never see whether the class paints anything.
//
// That gap is the whole reason this spec exists. #962 deleted the status row that declared
// `.conn-dot--up` / `--in-progress` / `--down` / `--unknown`, and the sidebar host row wears those four
// modifiers WITHOUT a base class carrying a background. Had the deletion taken them along, the sidebar's
// two dots would have gone invisible with every existing test still green — a silent regression the
// retired block's own comment predicted in writing. So the assertion has to read a COMPUTED COLOUR back
// out of the shipped stylesheet.
//
// NO CONNECTION STATE IS DRIVEN. Reaching all four categories live would need the relay and the daemon
// walked through four states, and `in-progress` (the daemon's `connecting`) has no stable assertable
// moment — the drive would be racy for a fact that has nothing to do with connection state. What is under
// test is the stylesheet, so the classes are painted onto throwaway probe elements instead, the
// `composer-message-box.spec.ts` `tokenColor` idiom. The mapping from a live status to a category is a
// pure predicate and is proven exhaustively in ConversationScreen.test.tsx's relayLeg/daemonLeg describes.
const CATEGORIES = ['up', 'in-progress', 'down', 'unknown'] as const

// The CSSOM's serialisation of "no background" — what an unpainted probe reads back as, and therefore
// exactly what a lost binding would produce.
const TRANSPARENT = 'rgba(0, 0, 0, 0)'

test('the four connection-dot colour bindings paint four distinct colours (AC3)', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp()

  // The sidebar half of AC3: the host row still renders its two dots. `host-label-sidebar.spec.ts` makes
  // the same count assertion about the row's geometry; here it is the precondition that gives the colour
  // reading someone to matter to, and it also waits out the sidebar's arrival before the probe runs.
  await expect(page.locator('.channel-list__host-dot')).toHaveCount(2)

  // One probe per category, appended to the live document so it inherits the same cascade the real dots
  // do, read, then removed. Nothing is asserted inside the page — the colours come back out and the
  // expectations live here, so a failure prints the four values.
  const colours = await page.evaluate((categories) => {
    const probe = document.createElement('span')
    document.body.append(probe)
    const read = categories.map((category) => {
      probe.className = `conn-dot--${category}`
      return getComputedStyle(probe).backgroundColor
    })
    probe.remove()
    return read
  }, CATEGORIES)

  // Every binding paints something. This is the assertion that would have caught the deletion.
  for (const [index, colour] of colours.entries()) {
    expect(colour, `conn-dot--${CATEGORIES[index]} is unpainted`).not.toBe(TRANSPARENT)
    expect(colour, `conn-dot--${CATEGORIES[index]} has no background`).not.toBe('')
  }

  // And all four are DISTINCT, so the four states stay tellable apart — a single surviving rule, or two
  // categories collapsed onto one token, fails here even though every class is painted.
  expect(new Set(colours).size).toBe(CATEGORIES.length)
})
