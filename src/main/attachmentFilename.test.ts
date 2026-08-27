import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sanitizeAttachmentFilename, FALLBACK_FILENAME } from './attachmentFilename'

// Pure function — no temp dir, no fixture, no cleanup: the module touches no filesystem, no socket and
// no wire, so there is nothing to build a fixture around. Its sibling half's rule binds here just as
// hard: NEVER build an expectation from the function's own return value. Every row states its expected
// string as a literal, and the universal postconditions below are composed independently of the result
// (the allowlist and the device-name pattern are RESTATED here rather than imported, so the assertion is
// the criterion and not the implementation).
//
// All five criteria are stated on the RETURNED VALUE, so they hold for every input rather than only for
// the row aimed at them. `expectSafeComponent` runs on every row of every table below, which makes each
// row a fixture for all five criteria at once.

/** The allowlist, restated independently of the module. */
const ALLOWED = /^[A-Za-z0-9._-]+$/u

/** A Windows reserved device name, restated independently, matched on an already-lowercased stem. */
const RESERVED_STEM = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/

/** Everything before the first `.`, or the whole string when it has none. */
function stemOf(component: string): string {
  return component.split('.')[0]
}

/** The universal postconditions — all five criteria, asserted on every row. */
function expectSafeComponent(got: string, input: string): void {
  const label = JSON.stringify(input)
  expect(got.length, label).toBeGreaterThan(0)
  expect(got.includes('/'), label).toBe(false)
  expect(got.includes('\\'), label).toBe(false)
  expect(got === '.' || got === '..', label).toBe(false)
  expect(got.startsWith('.'), label).toBe(false)
  expect(/[\u0000-\u001f\u007f]/u.test(got), label).toBe(false)
  // The positive form: free, and strictly stronger than the negative clauses above — it also rules out
  // every non-ASCII character and every control character the C0/DEL clause would have to enumerate.
  expect(ALLOWED.test(got), label).toBe(true)
  expect(RESERVED_STEM.test(stemOf(got).toLowerCase()), label).toBe(false)
}

/** Run one row: the literal expected string, plus the universal postconditions. */
function expectSanitized(input: string, expected: string): void {
  const got = sanitizeAttachmentFilename(input)
  expect(got, JSON.stringify(input)).toBe(expected)
  expectSafeComponent(got, input)
}

/** Run one row that must come back byte-identical. */
function expectUnchanged(input: string): void {
  expectSanitized(input, input)
}

describe('sanitizeAttachmentFilename', () => {
  it('reduces separators and parent references to one component (AC1)', () => {
    const rows: ReadonlyArray<readonly [string, string]> = [
      // Both separators replaced, and the result began with `.`, so the leading-dot rule prefixed.
      ['../etc/passwd', '_.._etc_passwd'],
      // No prefix — this result does not begin with `.`.
      ['a/../b', 'a_.._b'],
      // AC1 names both separators; this is the `\` half.
      ['a\\b', 'a_b'],
      ['a.b.c', 'a.b.c']
    ]
    for (const [input, expected] of rows) expectSanitized(input, expected)
  })

  it('prefixes rather than appends, so the result is never `.`, `..` or hidden (AC1)', () => {
    // A build that APPENDS the underscore answers '.._' and '._' — satisfying "never `.` or `..`" while
    // leaving the file hidden, which AC1 forbids in the same sentence. These four rows are its reds.
    expectSanitized('..', '_..')
    expectSanitized('.', '_.')
    expectSanitized('.bashrc', '_.bashrc')
    expectSanitized('.ssh', '_.ssh')
  })

  it('answers the same fixed component whenever nothing survives the allowlist (AC2)', () => {
    // '///' is the row that makes AC2's second arm live: a build whose emptiness check reads the RESULT
    // answers '___' here. '報告書' is a legitimate non-ASCII name where nothing survives — the visible
    // cost of an ASCII allowlist, and what shows the stronger reading is the useful one.
    for (const input of ['', '///', '報告書', '\x00\n']) {
      expectSanitized(input, FALLBACK_FILENAME)
    }
  })

  it('the fallback is a fixpoint — it is itself already one safe component (AC2)', () => {
    // Turns red on any future edit that gives the constant a leading dot, a separator or a reserved
    // stem, which is what licenses returning it directly rather than routing it through the later steps.
    expectSanitized(FALLBACK_FILENAME, FALLBACK_FILENAME)
  })

  it('replaces NUL — `report.txt\\x00.exe` is the classic filename attack (AC3)', () => {
    expectSanitized('report.txt\x00.exe', 'report.txt_.exe')
  })

  it('replaces every other control character, one per character (AC3)', () => {
    const rows: ReadonlyArray<readonly [string, string]> = [
      ['a\nb', 'a_b'],
      ['a\rb', 'a_b'],
      // Two characters in, two underscores out: the map is per-character and does not collapse runs.
      ['a\r\nb', 'a__b'],
      // DEL sits above the C0 range a naive `< 0x20` denylist would check, and dies on the allowlist.
      ['a\x7fb', 'a_b']
    ]
    for (const [input, expected] of rows) expectSanitized(input, expected)
  })

  it('maps by code point, so one astral character yields one underscore (AC3)', () => {
    // A build that walks by code UNIT answers 'a__b' / 'a__b' here. The result is ASCII by construction
    // either way, but a lone surrogate must not survive as half a character.
    expectSanitized('a\u{1f600}b', 'a_b')
    expectSanitized('a\ud800b', 'a_b')
  })

  it('prefixes a Windows reserved device name, case-insensitively (AC4)', () => {
    const rows: ReadonlyArray<readonly [string, string]> = [
      ['CON', '_CON'],
      ['con', '_con'],
      // The extension is ignored…
      ['CON.txt', '_CON.txt'],
      // …and the stem is taken at the FIRST dot, not the last: a build that splits on the last dot
      // answers 'NUL.tar.gz' unchanged, and this row is its sole red.
      ['NUL.tar.gz', '_NUL.tar.gz'],
      ['PRN', '_PRN'],
      ['AUX', '_AUX'],
      ['NUL', '_NUL'],
      ['COM1', '_COM1'],
      ['COM9', '_COM9'],
      ['LPT1', '_LPT1'],
      ['LPT9', '_LPT9']
    ]
    for (const [input, expected] of rows) expectSanitized(input, expected)
  })

  it('leaves a near-miss of a device name alone — the rule is not a prefix match (AC4)', () => {
    // The sole reds for a prefix-match or substring-match implementation…
    for (const input of ['CONSOLE.txt', 'COM.txt', 'COM10', 'contract.pdf']) {
      expectUnchanged(input)
    }
    // …and for an object-literal lookup table, which inherits Object.prototype and reads these back
    // truthy with no attacker involved.
    for (const input of ['constructor.txt', 'toString', 'valueOf']) {
      expectUnchanged(input)
    }
  })

  it('prefixes once, not twice, when the device-name rule is asked about a dot-leading name (AC4)', () => {
    // After the leading-dot rule the stem is '_', not 'con', so the device-name rule does not fire. A
    // build that runs it on the INPUT answers '__.CON'.
    expectSanitized('.CON', '_.CON')
  })

  it('returns an already-safe name byte-identical (AC5)', () => {
    for (const input of ['report-2026.pdf', 'a_b-c.tar.gz', 'README', '2026', '-report.pdf']) {
      expectUnchanged(input)
    }
  })

  it('returns `___` and `_` unchanged — the fallback is decided by the input, not the result (AC5)', () => {
    // The rows that pin the "did anything survive?" flag against every result-derived emptiness check.
    // '___' is both a legitimate name and what a fully-replaced input looks like, so the two cases are
    // indistinguishable in the result; a check on the result collapses them and breaks AC2 or AC5.
    expectUnchanged('___')
    expectUnchanged('_')
  })

  it('leaves a plain name untouched', () => {
    // Non-vacuity control: a build that returns FALLBACK_FILENAME for every input satisfies every
    // negative postcondition above and would otherwise score full green.
    expect(sanitizeAttachmentFilename('notes.txt')).toBe('notes.txt')
  })

  it('imports nothing and makes no log call — the module graph is Electron-free', () => {
    // Source text, not runtime: the property is about the module graph, and once vitest has resolved the
    // graph there is nothing left at runtime to observe. Asserting the EXACT (empty) set fires on an
    // `electron` import, a `node:fs` import, a renderer import and even a `node:path` import — this
    // module needs none. The second grep pins the never-log rule, which sanitising does NOT lift: the
    // output carries no newline, so it cannot forge a log line, but a file name is often private in
    // itself. A later edit that legitimately needs an import updates this as a conscious decision.
    const source = readFileSync(resolve('src/main/attachmentFilename.ts'), 'utf-8')
    const specifiers = [...source.matchAll(/(?:\bfrom|\brequire\()\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1]
    )

    expect([...new Set(specifiers)].sort()).toEqual([])
    expect(source).not.toContain('console.')
  })
})
