import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { resolveAttachmentPath, type ResolveAttachmentPathResult } from './attachmentPath'

// Pure function — no temp dir, no fixture, no cleanup: the module touches no filesystem, so there is
// nothing to build a fixture around (and the macOS /var/folders → /private/var/folders symlink trap is
// designed out rather than avoided). Its sibling half still binds: NEVER build an expectation from the
// function's own return value — an expectation derived from the return passes even under a build that
// returns the base directory unchanged. Every accepted row asserts the triple below instead, composed
// independently of the result. The identifier is untrusted renderer input, so the refusal tables drive
// each hostile shape straight in as a string.

/** The base every row uses — a plain absolute string; the module never looks at the disk. */
const BASE = '/var/pyrycode/attachments'

/** The shape the daemon mints today: a canonical lowercase UUIDv4. */
const CANONICAL = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

/** Assert a success by three independent properties — never by comparing against `result.path`. */
function expectResolvedInto(result: ResolveAttachmentPathResult, baseDir: string, id: string): void {
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(isAbsolute(result.path)).toBe(true)
  expect(dirname(result.path)).toBe(resolve(baseDir))
  expect(basename(result.path)).toBe(id)
}

/** Assert a refusal by deep equality, so a leaked `path` key fails the row instead of passing. */
function expectRefused(id: string): void {
  expect(resolveAttachmentPath(BASE, id), JSON.stringify(id)).toEqual({
    ok: false,
    reason: 'not-canonical-id'
  })
}

describe('resolveAttachmentPath', () => {
  it('resolves a canonical identifier to an absolute path directly inside the base dir (AC1)', () => {
    expectResolvedInto(resolveAttachmentPath(BASE, CANONICAL), BASE, CANONICAL)
  })

  it('accepts a 64-character hex token — the ceiling is inclusive (AC1)', () => {
    const id = 'a'.repeat(32) + '0123456789abcdef'.repeat(2)
    expect(id).toHaveLength(64)
    expectResolvedInto(resolveAttachmentPath(BASE, id), BASE, id)
  })

  it('accepts a single character — the lower bound is 1, not a canonical length (AC1)', () => {
    expectResolvedInto(resolveAttachmentPath(BASE, 'a'), BASE, 'a')
  })

  it('returns an absolute path even for a relative base dir (resolve, not join) (AC1)', () => {
    const relativeBase = 'attachments'
    expectResolvedInto(resolveAttachmentPath(relativeBase, CANONICAL), relativeBase, CANONICAL)
  })

  it('refuses an identifier containing `..` — the caller gets a failure, never a path (AC2)', () => {
    const traversals = [
      '..',
      '../secrets',
      '../../etc/passwd',
      'a/../b',
      '.',
      '..a',
      '%2e%2e',
      '..%2f..'
    ]
    for (const id of traversals) expectRefused(id)
  })

  it('refuses an identifier that is an absolute path (AC3)', () => {
    const absolutes = [
      '/etc/passwd',
      '/',
      '//server/share',
      'C:\\Windows\\System32\\config\\SAM',
      'C:/Windows',
      'c:',
      '\\\\?\\C:\\x',
      '~',
      '~/Documents',
      'file:///etc/passwd'
    ]
    for (const id of absolutes) expectRefused(id)
  })

  it("refuses the empty identifier — resolve(base, '') would hand back the directory itself", () => {
    expectRefused('')
  })

  it('refuses a separator anywhere in the identifier', () => {
    for (const id of ['a/b', 'a\\b']) expectRefused(id)
  })

  it("refuses an identifier over the daemon's 64-byte ceiling", () => {
    expectRefused('a'.repeat(65))
  })

  it('refuses uppercase — the id→path mapping stays injective on APFS and NTFS', () => {
    for (const id of ['ABCDEF01', 'aBcD']) expectRefused(id)
  })

  it('refuses characters outside the hex alphabet', () => {
    for (const id of ['zzzz', 'g']) expectRefused(id)
  })

  it('refuses whitespace, control characters and NUL', () => {
    for (const id of ['ab cd', 'abc ', 'ab\tcd', 'ab\u0000cd', 'ab\ncd', '\u0007']) expectRefused(id)
  })

  it('refuses Windows reserved device names', () => {
    for (const id of ['con', 'nul', 'com1']) expectRefused(id)
  })

  it('refuses homoglyphs of the one punctuation character the alphabet admits', () => {
    // 'ü' (non-ASCII), U+00AD soft hyphen, U+FF0D fullwidth hyphen-minus — the last two *look* like
    // the ASCII hyphen the alphabet does admit.
    for (const id of ['ü', '\u00ad', '\uff0d']) expectRefused(id)
  })

  it('still accepts a canonical identifier against the base the refusal tables use', () => {
    // Non-vacuity control: a build that refuses everything fails here rather than scoring full green.
    expect(resolveAttachmentPath(BASE, CANONICAL).ok).toBe(true)
  })

  it('imports node:path and nothing else — the module graph is Electron-free (AC4)', () => {
    // Source text, not runtime: the property is about the module graph, and once vitest has resolved
    // the graph there is nothing left at runtime to observe. Asserting the EXACT set is what earns
    // the five lines — it fires on an `electron` import, on any renderer import, and on a `node:fs`
    // import, so the no-filesystem decision is pinned by a test rather than by a paragraph. A later
    // edit that legitimately needs another import updates this allowlist as a conscious decision.
    const source = readFileSync(resolve('src/main/attachmentPath.ts'), 'utf-8')
    const specifiers = [...source.matchAll(/(?:\bfrom|\brequire\()\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1]
    )

    expect([...new Set(specifiers)].sort()).toEqual(['node:path'])
  })
})
