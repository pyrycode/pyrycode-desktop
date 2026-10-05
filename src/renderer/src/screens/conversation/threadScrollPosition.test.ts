import { describe, it, expect } from 'vitest'
import {
  AT_BOTTOM_TOLERANCE_PX,
  HISTORY_ASK_BAND_VIEWPORTS,
  isAtBottom,
  isNearTop
} from './threadScrollPosition'

// The arithmetic is isolated in threadScrollPosition.ts precisely so it can be tested here: vitest runs
// in the `node` environment (vitest.config.ts:27) with no DOM, no jsdom and no layout engine, so the DOM
// half of the follow-the-conversation feature — the ref, the scroll listener, the re-assert after the
// list changes (#601) — cannot be exercised at all. isAtBottom takes three plain numbers, so it is a
// total function this environment can cover completely.
//
// Fractional metrics are the motivating case (fractional device pixel ratios, momentum overshoot, zoom),
// so the scenarios feed non-integer numbers. The two boundary cases use halves and quarters, which are
// exact in binary floating point, so "exactly equal to the tolerance" tests the boundary rather than
// floating-point rounding.

describe('AT_BOTTOM_TOLERANCE_PX', () => {
  it('is 4, fenced above sub-pixel error and well below one line of message text (AC2, AC3)', () => {
    expect(AT_BOTTOM_TOLERANCE_PX).toBe(4)
    // Lower bound: sub-pixel error is under 1px per metric and three metrics feed the comparison.
    expect(AT_BOTTOM_TOLERANCE_PX).toBeGreaterThan(1)
    // Upper bound: --text-body-medium-line is 20px (tokens.css:68) — the band must never swallow a
    // deliberate one-line scroll-away.
    expect(AT_BOTTOM_TOLERANCE_PX).toBeLessThan(20)
  })
})

describe('isAtBottom', () => {
  it('reads a distance exactly equal to the tolerance as at-bottom (AC3)', () => {
    // 1000.5 - (270.5 + 726) === 4, exactly.
    expect(
      isAtBottom({ scrollOffset: 270.5, viewportHeight: 726, contentHeight: 1000.5 })
    ).toBe(true)
  })

  it('reads a distance just beyond the tolerance as not at-bottom (AC3)', () => {
    // The same offset and viewport, a quarter-pixel further from the bottom: 4.25.
    expect(
      isAtBottom({ scrollOffset: 270.5, viewportHeight: 726, contentHeight: 1000.75 })
    ).toBe(false)
  })

  it('reads sitting exactly at the bottom as at-bottom (AC4)', () => {
    // Distance zero on fractional metrics.
    expect(
      isAtBottom({ scrollOffset: 694.25, viewportHeight: 726, contentHeight: 1420.25 })
    ).toBe(true)
  })

  it('reads an elastic overshoot as at-bottom, never as scrolled away (AC4)', () => {
    // Momentum bounce: offset + viewport runs past the content, so the distance goes negative.
    expect(
      isAtBottom({ scrollOffset: 706.5, viewportHeight: 726, contentHeight: 1420.25 })
    ).toBe(true)
  })

  it('reads content shorter than the viewport as at-bottom (AC5)', () => {
    // The un-scrollable short thread — it pins from its very first message.
    expect(isAtBottom({ scrollOffset: 0, viewportHeight: 726, contentHeight: 412.5 })).toBe(true)
  })

  it('reads content exactly as tall as the viewport as at-bottom (AC5)', () => {
    // The equal case is the same expression as the strictly-shorter one; the pair documents that no
    // "can it scroll at all" branch is missing.
    expect(isAtBottom({ scrollOffset: 0, viewportHeight: 726, contentHeight: 726 })).toBe(true)
  })

  it('reads a thread scrolled well away from the bottom as not at-bottom', () => {
    // The sanity anchor: parked near the top of a long thread. Without it, a helper that returned
    // true unconditionally would pass every case above.
    expect(
      isAtBottom({ scrollOffset: 120.25, viewportHeight: 726, contentHeight: 1974.5 })
    ).toBe(false)
  })
})

// #1260 — the walk's detector. Its own arithmetic is one comparison; what these cases pin is the BAND,
// because the band is not a rounding allowance like `AT_BOTTOM_TOLERANCE_PX` above it. Chromium suppresses
// scroll anchoring at a scroll offset of exactly zero (measured in thread-scroll-pin.spec.ts's #1046
// section), so a walk that only fired at the wall would fire at the one position where the mechanism that
// holds the reader's place is off. The band is what keeps the ask above zero. #1752 sized it in viewports,
// so every boundary below is derived from the case's own `viewportHeight`.
describe('isNearTop', () => {
  const viewportHeight = 726
  const band = HISTORY_ASK_BAND_VIEWPORTS * viewportHeight

  it('sizes the band at two viewport heights', () => {
    expect(HISTORY_ASK_BAND_VIEWPORTS).toBe(2)
  })

  it('reads a thread parked at the very top as near the top', () => {
    expect(isNearTop({ scrollOffset: 0, viewportHeight, contentHeight: 5974.5 })).toBe(true)
  })

  it('reads an offset inside the band as near the top', () => {
    expect(isNearTop({ scrollOffset: 1120.25, viewportHeight, contentHeight: 5974.5 })).toBe(true)
  })

  it('reads an offset exactly at the band as near the top', () => {
    // `<=`, not `<` — the boundary belongs to the band, matching `isAtBottom`'s own tolerance comparison.
    expect(isNearTop({ scrollOffset: band, viewportHeight, contentHeight: 5974.5 })).toBe(true)
  })

  it('reads one pixel past the band as not near the top', () => {
    // The sanity anchor: without it a helper returning true unconditionally passes every case above.
    expect(isNearTop({ scrollOffset: band + 1, viewportHeight, contentHeight: 5974.5 })).toBe(false)
  })

  it('reads an elastic overshoot past the top as near the top', () => {
    // A negative offset is the momentum bounce at the other end of the thread. No clamp and no
    // `Math.max`: the single comparison already answers, which is `isAtBottom`'s argument verbatim.
    expect(isNearTop({ scrollOffset: -38.5, viewportHeight, contentHeight: 5974.5 })).toBe(true)
  })

  it('scales the band with the viewport and never reads the content height', () => {
    // The same offset answers differently under two viewports, so the band is not a fixed pixel rim; and
    // the content height swinging from a single viewport to a hundred changes nothing, so the comparison
    // is not transposed onto it — the mistake `ThreadScrollMetrics`' named fields exist to prevent.
    expect(isNearTop({ scrollOffset: 900, viewportHeight: 450, contentHeight: 450 })).toBe(true)
    expect(isNearTop({ scrollOffset: 900, viewportHeight: 449, contentHeight: 100000 })).toBe(false)
    expect(isNearTop({ scrollOffset: 900, viewportHeight: 450, contentHeight: 100000 })).toBe(true)
  })
})
