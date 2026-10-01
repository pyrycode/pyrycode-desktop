import { test, expect } from './fixtures/launchPairedApp'

// Probe shared color bindings independently of any host presentation or live connection state.
const CATEGORIES = ['up', 'in-progress', 'down', 'unknown'] as const

// The CSSOM's serialisation of "no background" — what an unpainted probe reads back as, and therefore
// exactly what a lost binding would produce.
const TRANSPARENT = 'rgba(0, 0, 0, 0)'

test('the four connection-dot colour bindings paint four distinct colours (AC3)', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp()

  await expect(page.locator('.channel-list__host')).toHaveCount(1)

  // One probe per category, appended to the live document so it inherits the same cascade the real dots
  // do, read, then removed. Nothing is asserted inside the page — the colours come back out and the
  // expectations live here, so a failure prints the four values.
  const { colours, tokens } = await page.evaluate((categories) => {
    const probe = document.createElement('span')
    document.body.append(probe)
    const read = categories.map((category) => {
      probe.className = `conn-dot--${category}`
      return getComputedStyle(probe).backgroundColor
    })
    const tokens = ['--color-success', '--color-warning', '--color-error', '--color-outline'].map(token => {
      probe.className = ''
      probe.style.backgroundColor = `var(${token})`
      return getComputedStyle(probe).backgroundColor
    })
    probe.remove()
    return { colours: read, tokens }
  }, CATEGORIES)

  expect(colours).toEqual(tokens)

  // Every binding paints something. This is the assertion that would have caught the deletion.
  for (const [index, colour] of colours.entries()) {
    expect(colour, `conn-dot--${CATEGORIES[index]} is unpainted`).not.toBe(TRANSPARENT)
    expect(colour, `conn-dot--${CATEGORIES[index]} has no background`).not.toBe('')
  }

  // And all four are DISTINCT, so the four states stay tellable apart — a single surviving rule, or two
  // categories collapsed onto one token, fails here even though every class is painted.
  expect(new Set(colours).size).toBe(CATEGORIES.length)
})
