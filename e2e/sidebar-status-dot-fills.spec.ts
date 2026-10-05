import { test, expect } from './fixtures/launchPairedApp'

// Browser paint checks: static renderer tests cannot observe CSS or its media queries.
const STATUSES = ['input-required', 'working', 'new-messages', 'idle'] as const
const RING = 'rgb(157, 203, 252) 0px 0px 0px 1px inset'
const TRANSPARENT = 'rgba(0, 0, 0, 0)'
const FILLS: Record<(typeof STATUSES)[number], string> = {
  'input-required': 'rgb(216, 184, 90)',
  working: 'rgb(157, 203, 252)',
  'new-messages': 'rgb(47, 192, 56)',
  idle: TRANSPARENT
}

test('redrawn dots have the state-specific paint and only working blinks', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp()
  await expect(page.locator('.channel-list__row .conversation-status-dot')).toHaveCount(1)
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  // Probes inherit the real stylesheet without needing unrelated store transitions.
  const painted = await page.evaluate((statuses) => {
    const probe = document.createElement('span')
    document.body.append(probe)
    const read = statuses.map((status) => {
      probe.className = `conversation-status-dot conversation-status-dot--${status}`
      const style = getComputedStyle(probe)
      return {
        ring: style.boxShadow, fill: style.backgroundColor, opacity: style.opacity,
        width: style.width, height: style.height, animation: style.animationName,
        duration: style.animationDuration, iterations: style.animationIterationCount
      }
    })
    probe.remove()
    return read
  }, STATUSES)

  for (const [index, paint] of painted.entries()) {
    const status = STATUSES[index]
    expect(paint.ring, `${status} ring`).toBe(status === 'idle' ? RING : 'none')
    expect(paint.fill, `${status} fill`).toBe(FILLS[status])
    expect(paint.width).toBe('6px')
    expect(paint.height).toBe('6px')
    expect(paint.animation).toBe(status === 'working' ? 'conversation-status-dot-blink' : 'none')
    if (status === 'working') {
      expect(paint.duration).toBe('2s')
      expect(paint.iterations).toBe('infinite')
    } else {
      expect(paint.opacity).toBe(status === 'idle' ? '0.5' : '1')
    }
  }

  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reduced = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.className = 'conversation-status-dot conversation-status-dot--working'
    document.body.append(probe)
    const style = getComputedStyle(probe)
    const read = { animation: style.animationName, fill: style.backgroundColor, ring: style.boxShadow }
    probe.remove()
    return read
  })
  expect(reduced).toEqual({ animation: 'none', fill: FILLS.working, ring: 'none' })

  // The new gold is dot-only; the connection warning role retains its existing amber.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement)
    .getPropertyValue('--color-warning').trim())).toBe('#ffca45')
})
