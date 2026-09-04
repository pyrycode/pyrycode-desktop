import { describe, it, expect } from 'vitest'
import { attachmentExtensionLabel } from './attachmentExtensionLabel'

// #815 — the extension overlay drawn across the lower half of the file glyph. A pure string transform, so
// every criterion in AC4 is provable here with nothing rendered; the ROW that draws the result is pinned in
// ConversationScreen.test.tsx and its wrapping behaviour in e2e/attachment-file-row.spec.ts.
//
// THE EMPTY CASES ARE THE POINT, not the leftovers. AC4 asks for an EMPTY label rather than a fallback word
// like `FILE` when there is no usable extension, so the three routes to empty each get their own case: no
// dot at all, a trailing dot with nothing after it, and an extension in a script the 44px slot cannot hold.
// A regression that reintroduced a fallback would pass a happy-path-only spec.
describe('attachmentExtensionLabel', () => {
  it('draws the drawing’s own extension, uppercased', () => {
    expect(attachmentExtensionLabel('report.pdf')).toBe('PDF')
  })

  it('takes the text after the LAST dot, not the first', () => {
    // The double-extension case is what separates a `lastIndexOf` from a `split('.')[1]`: a spec that only
    // ever sees one dot cannot tell the two implementations apart.
    expect(attachmentExtensionLabel('archive.tar.gz')).toBe('GZ')
    expect(attachmentExtensionLabel('my.notes.v2.txt')).toBe('TXT')
  })

  it('caps at four characters so the label fits the 44px slot', () => {
    expect(attachmentExtensionLabel('notes.torrent')).toBe('TORR')
    // Exactly four is NOT clipped — the boundary case that tells `slice(0, 4)` from `slice(0, 3)`.
    expect(attachmentExtensionLabel('photo.jpeg')).toBe('JPEG')
  })

  it('keeps letters and digits only, and strips before it caps', () => {
    // Stripping first is what lets a punctuated run still fill the slot: `p-d-f-x` yields four drawn
    // characters, where capping first would yield `PDF` and lose one.
    expect(attachmentExtensionLabel('a.p-d-f-x')).toBe('PDFX')
    expect(attachmentExtensionLabel('backup.7z')).toBe('7Z')
  })

  it('is empty, never a fallback word, when there is no dot', () => {
    expect(attachmentExtensionLabel('README')).toBe('')
  })

  it('is empty when the name ends in a dot', () => {
    expect(attachmentExtensionLabel('trailing.')).toBe('')
  })

  it('is empty when the extension is outside the ASCII class the slot can hold', () => {
    // Deliberate, not an oversight: a 44px slot cannot hold an arbitrary script, and admitting one would
    // make the row's width depend on the name's alphabet. See the module header.
    expect(attachmentExtensionLabel('файл.документ')).toBe('')
    expect(attachmentExtensionLabel('写真.画像')).toBe('')
  })

  it('reads a leading-dot name as all extension — the mechanical rule, pinned deliberately', () => {
    // `.hidden` has its last dot at index 0, so the text after it is the whole name. AC4's rule carries no
    // dotfile carve-out and this follows it literally; the case is pinned so a later change to it is a
    // deliberate decision rather than a silent drift. Plan § Open questions, item 1.
    expect(attachmentExtensionLabel('.hidden')).toBe('HIDD')
  })

  it('is empty on the empty name', () => {
    // Unreachable from today's producer (`basename` answers `''` only for a path the main-side read guard
    // already refuses) but representable, and the row draws the empty slot either way.
    expect(attachmentExtensionLabel('')).toBe('')
  })

  it('drops bidi and control characters rather than drawing them', () => {
    // The spoofing case the plan's security review defers to #816: the NAME run renders reversed, but the
    // overlay is derived by the last-dot rule and its character class drops U+202E, so the label still
    // draws the true extension. That mitigation is asserted here so a later "let more characters through"
    // change has to break a test to remove it.
    expect(attachmentExtensionLabel('report‮gpj.exe')).toBe('EXE')
  })
})
