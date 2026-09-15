import { describe, it, expect } from 'vitest'
import { contextTokenSource } from './contextTokenSource'

// A settings pair that yields a percentage NO test below shares with its reading, so a fallback firing
// where it must not is visible as a wrong number rather than as a missing one.
const SETTINGS = { usedTokens: 50_000, windowTokens: 200_000 }

describe('contextTokenSource (#1421)', () => {
  it('prefers a present reading over the settings pair', () => {
    expect(contextTokenSource({ totalTokens: 146_000, maxTokens: 300_000 }, SETTINGS)).toEqual({
      usedTokens: 146_000,
      windowTokens: 300_000
    })
  })

  it('falls back to the settings pair when no reading has arrived', () => {
    expect(contextTokenSource(null, SETTINGS)).toEqual(SETTINGS)
  })

  // The sharp edge of AC3, and the reason the only branch is `=== null`. A present reading whose maximum
  // is zero is a real (if degenerate) reading claude reported, so it WINS — the settings pair beside it is
  // seeded non-zero, so a fallback firing here would read 25% instead of nothing at all. The unavailable
  // state is then produced downstream by contextUsagePercent's window guard, not by a second branch here.
  it('keeps a present reading whose maximum is zero, rather than falling back', () => {
    expect(contextTokenSource({ totalTokens: 146_000, maxTokens: 0 }, SETTINGS)).toEqual({
      usedTokens: 146_000,
      windowTokens: 0
    })
  })

  // Both halves of the absent arm at once: a not-yet-loaded snapshot coalesces to the zero pair, which is
  // the same unavailable path the daemon's window_tokens === 0 signal takes. RunConfigSections' shipped
  // `?? 0`, now written once instead of at each surface.
  it('coalesces an absent settings snapshot to the zero pair', () => {
    expect(contextTokenSource(null, null)).toEqual({ usedTokens: 0, windowTokens: 0 })
  })

  // The pair is REBUILT on the winning arm, never handed back by reference — the settings argument is a
  // RunConfigSnapshot, which also carries a daemon-supplied `model` string, and rebuilding is what keeps
  // anything but two integers from leaving a value typed as a token pair.
  it('returns a fresh two-field pair, carrying nothing but the two integers', () => {
    const settings = { usedTokens: 1, windowTokens: 2, model: 'daemon-supplied' }
    const resolved = contextTokenSource(null, settings)
    expect(resolved).not.toBe(settings)
    expect(Object.keys(resolved).sort()).toEqual(['usedTokens', 'windowTokens'])
  })
})
