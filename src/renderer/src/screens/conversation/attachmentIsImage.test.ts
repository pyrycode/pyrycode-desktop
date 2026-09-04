import { describe, it, expect } from 'vitest'
import { isImageAttachmentName } from './attachmentIsImage'
import { attachmentExtensionLabel } from './attachmentExtensionLabel'

describe('isImageAttachmentName', () => {
  it('admits every extension the set names, in any case', () => {
    for (const extension of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp']) {
      expect(isImageAttachmentName(`holiday.${extension}`)).toBe(true)
      expect(isImageAttachmentName(`holiday.${extension.toUpperCase()}`)).toBe(true)
    }
  })

  it('takes the LAST dot, so a compound name is read by its real extension', () => {
    expect(isImageAttachmentName('archive.png.gz')).toBe(false)
    expect(isImageAttachmentName('archive.gz.png')).toBe(true)
    // A name that is nothing BUT an extension still has one.
    expect(isImageAttachmentName('.png')).toBe(true)
  })

  // ⭐ THE TWO CASES THAT JUSTIFY THIS MODULE EXISTING, asserted against the helper it must not reuse.
  // `attachmentExtensionLabel` is decorative — it uppercases, strips every non-alphanumeric and caps at
  // four — so it DRAWS `PNG` and `JPEG` for these two names, which is correct as a label and wrong as an
  // imageness test. Comparing both here is what keeps a later "just reuse the label" edit from passing.
  it('refuses a name the decorative label would call an image', () => {
    expect(attachmentExtensionLabel('photo.p-n-g')).toBe('PNG')
    expect(isImageAttachmentName('photo.p-n-g')).toBe(false)

    expect(attachmentExtensionLabel('x.jpegg')).toBe('JPEG')
    expect(isImageAttachmentName('x.jpegg')).toBe(false)
  })

  it('refuses a format this app deliberately does not draw', () => {
    // A document rather than bytes — excluded so the CSP widening stays one sentence.
    expect(isImageAttachmentName('diagram.svg')).toBe(false)
    // Chromium cannot decode these, and an excluded name draws the working download row instead.
    for (const extension of ['heic', 'heif', 'tiff', 'pdf', 'txt', 'zip']) {
      expect(isImageAttachmentName(`thing.${extension}`)).toBe(false)
    }
  })

  it('refuses a name with no extension to read', () => {
    expect(isImageAttachmentName('README')).toBe(false)
    expect(isImageAttachmentName('trailing.')).toBe(false)
    expect(isImageAttachmentName('')).toBe(false)
  })

  it('does not sanitise or normalise the name', () => {
    // Surrounding whitespace is part of the extension, not trimmed away — the same posture
    // `attachmentExtensionLabel` records, so what is DRAWN and what is DECIDED read one value.
    expect(isImageAttachmentName('holiday.png ')).toBe(false)
    // A separator inside the name changes nothing: this reads an extension, it does not parse a path.
    expect(isImageAttachmentName('../../etc/passwd.png')).toBe(true)
  })
})
