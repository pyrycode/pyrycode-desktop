import { describe, it, expect } from 'vitest'
import { contextUsagePercent, contextUsageStep } from './contextUsage'

// #811: the ONE context-window percentage, extracted from RunConfigSections' inline expression so the
// sheet's gauge and the composer footer's reading cannot drift. The `146000 / 200000 → 73` case below is
// deliberately the same pair RunConfigSections.test.tsx:216 already pins through the rendered gauge —
// that overlap is what makes "for the same figures the two readings agree" (AC1) checkable in one place.
describe('contextUsagePercent (#811)', () => {
  it('reports used over window as a whole-number percentage', () => {
    expect(contextUsagePercent(146000, 200000)).toBe(73)
  })

  it('reports the design’s own reading', () => {
    // Figma 110:3497 reads "Context: 84%".
    expect(contextUsagePercent(168000, 200000)).toBe(84)
  })

  it('matches the sheet’s shipped rounding cases', () => {
    expect(contextUsagePercent(20000, 200000)).toBe(10)
    // 45000 / 200000 = 22.5% → rounds to 23%.
    expect(contextUsagePercent(45000, 200000)).toBe(23)
  })

  // The case that gives AC2 its teeth: an early session really is at 0%, and that is a NUMBER — a
  // different answer from "no reading at all". A guard that collapsed the two would render nothing on a
  // freshly-started session, and a caller that treated 0 as absent would be equally wrong.
  it('reports a real early-session zero as 0, not as an absent reading', () => {
    expect(contextUsagePercent(500, 200000)).toBe(0)
  })

  it('clamps an over-full session to 100, never past it', () => {
    expect(contextUsagePercent(250000, 200000)).toBe(100)
  })

  it('clamps a negative used count to 0', () => {
    expect(contextUsagePercent(-5, 200000)).toBe(0)
  })

  // The guard is on the WINDOW, which is why usedTokens is non-zero in both of these: a reading is
  // withheld because the denominator is not a real window size, never because the numerator is small.
  it('withholds a reading when the window is 0 — the daemon’s "usage unavailable" signal', () => {
    expect(contextUsagePercent(146000, 0)).toBeNull()
  })

  it('withholds a reading on a negative window', () => {
    expect(contextUsagePercent(146000, -1)).toBeNull()
  })

  // The finiteness term, and the whole reason it exists: `used_tokens` / `window_tokens` cross the wire
  // through a bare `requireNumber` (inboundMessage.ts:533-534) — a `typeof === 'number'` test that
  // deliberately range-checks nothing (:611-622 rules that the render slice formats defensively instead).
  // JSON.parse maps an overflowing literal to Infinity, and `typeof Infinity === 'number'`, so a frame
  // carrying `1e999` for both figures reaches this function intact; Infinity / Infinity is NaN and every
  // one of Math.round / Math.max / Math.min propagates it. Without this case the added term is untested
  // and a later "simplification" deletes it, re-opening `Context: NaN%` and the sheet's `width: NaN%`.
  it('withholds a reading when the window is not finite', () => {
    expect(contextUsagePercent(Infinity, Infinity)).toBeNull()
    expect(contextUsagePercent(146000, Infinity)).toBeNull()
    expect(contextUsagePercent(146000, NaN)).toBeNull()
  })

  // The numerator is deliberately NOT guarded: with a finite, positive window, an infinite used count
  // clamps to an honest 100 and -Infinity to an honest 0, so a second guard would be an unreachable
  // branch. Pinned so the asymmetry reads as a decision rather than an oversight.
  it('clamps an infinite used count against a real window instead of withholding', () => {
    expect(contextUsagePercent(Infinity, 200000)).toBe(100)
    expect(contextUsagePercent(-Infinity, 200000)).toBe(0)
  })

  // One sweep over the whole table above: no case may quietly start returning a float — the reading is
  // interpolated straight into "Context: N%".
  it('returns a whole number on every available case', () => {
    const pairs: Array<[number, number]> = [
      [146000, 200000],
      [168000, 200000],
      [45000, 200000],
      [500, 200000],
      [250000, 200000],
      [-5, 200000],
      [Infinity, 200000]
    ]
    for (const [used, window] of pairs) {
      const pct = contextUsagePercent(used, window)
      expect(pct).not.toBeNull()
      expect(Number.isInteger(pct)).toBe(true)
    }
  })
})

// #1062: the severity ladder. Every number below is HARD-CODED rather than read from an exported
// constant, and that is the whole design of this describe: a test that named the same symbol the ladder is
// written from would pass against any boundary at all. These pin the boundaries as VALUES, which is the
// one thing a stylesheet could never express and the reason the ladder is a function here rather than an
// inline conditional at the reading.
describe('contextUsageStep (#1062)', () => {
  // The pair that decides the lower boundary's INCLUSIVITY. 49 and 50 differ by one, so a `> 50` slip
  // reddens here and nowhere else.
  it('turns warning AT 50, not past it', () => {
    expect(contextUsageStep(49)).toBe('primary')
    expect(contextUsageStep(50)).toBe('warning')
  })

  // The upper boundary's own pair, read the same way: 69 is still the nudge, 70 is already the alarm.
  it('turns error AT 70, not past it', () => {
    expect(contextUsageStep(69)).toBe('warning')
    expect(contextUsageStep(70)).toBe('error')
  })

  // The ends of contextUsagePercent's own range — an empty session and a full one. Together with the two
  // pairs above this is the whole of [0, 100] at every arm, so no step can be unreachable.
  it('reads an empty session as primary and a full one as error', () => {
    expect(contextUsageStep(0)).toBe('primary')
    expect(contextUsageStep(100)).toBe('error')
  })

  // Total over `number`, not merely over [0, 100]. The caller only ever passes an integer in range —
  // contextUsagePercent clamps and returns `null` for everything else — but a ladder with a hole would be
  // a defect waiting for a second caller, and the descending form is what makes the absence of one
  // structural rather than asserted.
  it('is total: every number lands on a step', () => {
    for (const value of [-1, -Infinity, 49.9, 50.1, 69.9, 101, Infinity, NaN]) {
      expect(['primary', 'warning', 'error']).toContain(contextUsageStep(value))
    }
  })
})
