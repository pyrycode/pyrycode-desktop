import { describe, it, expect } from 'vitest'
import { KEPT_SEGMENTS, shortenPath } from './shortenPath'

// The display rule is isolated in shortenPath.ts precisely so it can be tested here: vitest runs in the
// `node` environment (vitest.config.ts:27) with no DOM, so renderer tests are renderToStaticMarkup string
// assertions and the row that will draw this (#645) cannot be exercised as a live component at all.
// shortenPath takes one plain string and returns one, so it is a total function this environment covers
// completely — every case below is a string literal in, a string literal out, with no mock, spy or
// fixture.
//
// AC5's totality gets no test of its own: it is the sum of every case here returning rather than
// throwing, and the separator-only inputs at the end are the pathological end of that. AC4's "no Node
// `path` import" has no runtime detector on a POSIX host either — `path.posix` and a hand-rolled split
// behave identically there — so it is checked by inspection (the module has no import statements at all),
// and only a `path.win32` implementation would be caught, by the two backslash cases below.

describe('KEPT_SEGMENTS', () => {
  it('is 4 — three folders plus the file name (AC1)', () => {
    // The pin for the ambiguity #606 left open: it stated "the last three folders plus the file name"
    // but illustrated it with a two-folder example. If the operator meant three segments in total, this
    // number and this assertion are the only things that change.
    expect(KEPT_SEGMENTS).toBe(4)
  })
})

describe('shortenPath', () => {
  it('keeps the last three folders plus the file name, prefixed with ... (AC1)', () => {
    // Five segments, four kept. Also the sanity anchor: without a full expected string here, a helper
    // that returned its argument unchanged would pass every verbatim case below.
    expect(shortenPath('a/b/c/d/e.txt')).toBe('.../b/c/d/e.txt')
  })

  it('shortens a six-segment renderer path to its four trailing segments (AC1)', () => {
    // #606's own example, corrected to the rule as written.
    expect(shortenPath('src/renderer/src/screens/conversation/ConversationScreen.tsx')).toBe(
      '.../src/screens/conversation/ConversationScreen.tsx'
    )
  })

  it('prefixes three ASCII periods, never a single ellipsis character (AC1)', () => {
    const shortened = shortenPath('a/b/c/d/e.txt')
    expect(shortened.slice(0, 4)).toBe('.../')
    // Separately, because the prefix assertion alone passes on a result carrying U+2026 later on.
    expect(shortened).not.toContain('\u2026')
  })

  it('returns a path with exactly three folders above the file name verbatim (AC2)', () => {
    // The boundary between AC1 and AC2 — four segments, so no `...`.
    expect(shortenPath('src/screens/conversation/X.tsx')).toBe('src/screens/conversation/X.tsx')
  })

  it('returns a string with no separator at all verbatim (AC2)', () => {
    expect(shortenPath('README.md')).toBe('README.md')
  })

  it('returns the empty string unchanged (AC2)', () => {
    // A real case: pyrycode#1678 sends an empty subject for kinds with no meaningful one.
    expect(shortenPath('')).toBe('')
  })

  it('returns a path with a repeated separator verbatim when it was not shortened (AC3)', () => {
    // The passthrough hands back the input, it does not rejoin the split segments — and this is the
    // input that tells the two apart, since a rejoin would collapse the `//` to `a/b/c.txt`.
    const doubled = 'a//b/c.txt'
    expect(shortenPath(doubled)).toBe(doubled)
  })

  it('returns a path with a trailing separator verbatim when it was not shortened (AC3)', () => {
    const trailing = 'a/b/c/'
    expect(shortenPath(trailing)).toBe(trailing)
  })

  it('drops a leading separator like any other lost segment (AC3)', () => {
    // The root is not special; the `...` is honest that something was dropped.
    expect(shortenPath('/a/b/c/d/e.txt')).toBe('.../b/c/d/e.txt')
  })

  it('rejoins the kept segments with a single / (AC3)', () => {
    expect(shortenPath('a/b//c/d/e.txt')).toBe('.../b/c/d/e.txt')
  })

  it('does not preserve a trailing separator once the path is shortened (AC3)', () => {
    // The one asymmetry with the verbatim passthrough, and a consequence of dropping empty segments
    // rather than a case of its own.
    expect(shortenPath('a/b/c/d/e/')).toBe('.../b/c/d/e')
  })

  it('treats a backslash as an ordinary character, never a boundary (AC4)', () => {
    // One segment, so it passes through whole. A node:path implementation would split it on Windows.
    expect(shortenPath('C:\\proj\\src\\app\\main.ts')).toBe('C:\\proj\\src\\app\\main.ts')
  })

  it('carries a backslash inside a kept segment when the path is shortened (AC4)', () => {
    expect(shortenPath('one/two/three/four/five\\six.txt')).toBe(
      '.../two/three/four/five\\six.txt'
    )
  })

  it('treats .. as an ordinary segment and normalises nothing (AC2, AC5)', () => {
    // Four segments including the `..`, so verbatim. This is display formatting, not path resolution.
    expect(shortenPath('../a/b/c.txt')).toBe('../a/b/c.txt')
  })

  it('returns separator-only input verbatim (AC3, AC5)', () => {
    // Zero non-empty segments. Falls out of the same comparison as every other short path, no guard.
    expect(shortenPath('/')).toBe('/')
    expect(shortenPath('//')).toBe('//')
    expect(shortenPath('////')).toBe('////')
  })
})
