import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SIGNATURE_PREFIX_BYTES, matchImageSignature } from './imageSignature'

// The type gate: bytes in, a suffix from a closed set or null out. Pure and synchronous, so this file
// needs no temp directory and no fake — attachmentPath.test.ts's register.

/** Build a prefix from leading bytes plus filler, so every fixture is a realistic 32-byte head. */
function head(...leading: number[]): Uint8Array {
  const bytes = new Uint8Array(32)
  bytes.set(leading)
  return bytes
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff, 0xe0]
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]
// RIFF, a four-byte little-endian length, then the WEBP form tag at byte 8.
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]

/** Every suffix the module is allowed to answer. Written out here, not imported, so a member added
 *  to the union without a deliberate edit here fails the closed-set test below. */
const DECLARED_SUFFIXES = ['.png', '.jpg', '.gif', '.webp']

describe('matchImageSignature — the closed raster set', () => {
  it.each([
    ['PNG', PNG, '.png'],
    ['JPEG', JPEG, '.jpg'],
    ['GIF87a', GIF87, '.gif'],
    ['GIF89a', GIF89, '.gif'],
    ['WebP', WEBP, '.webp']
  ])('matches %s', (_label, leading, suffix) => {
    expect(matchImageSignature(head(...leading))).toBe(suffix)
  })

  it('matches on the leading bytes alone — the remainder is not inspected', () => {
    // AC 3: signature matching, not image validation. A PNG header over garbage is a corrupt image,
    // which is the OS viewer's problem rather than a security one.
    const garbage = new Uint8Array(SIGNATURE_PREFIX_BYTES).fill(0xab)
    garbage.set(PNG)
    expect(matchImageSignature(garbage)).toBe('.png')
  })

  it('needs exactly SIGNATURE_PREFIX_BYTES to decide every member', () => {
    // The widest member is WebP, whose form tag ends at byte 11. This is why the driver reads a
    // prefix rather than a file: a dozen bytes decide the whole set.
    expect(SIGNATURE_PREFIX_BYTES).toBe(12)
    expect(matchImageSignature(new Uint8Array(WEBP))).toBe('.webp')
  })
})

describe('matchImageSignature — what it refuses', () => {
  it('refuses an empty prefix', () => {
    expect(matchImageSignature(new Uint8Array(0))).toBeNull()
  })

  it.each([
    ['PNG', PNG],
    ['JPEG', JPEG.slice(0, 3)],
    ['GIF89a', GIF89],
    ['WebP', WEBP]
  ])('refuses %s truncated one byte short of its signature', (_label, leading) => {
    expect(matchImageSignature(new Uint8Array(leading.slice(0, -1)))).toBeNull()
  })

  it('refuses a RIFF container whose form tag at byte 8 is not WEBP', () => {
    // A .wav is RIFF too. Matching the first four bytes alone would suffix an audio file `.webp`.
    const wav = [0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]
    expect(matchImageSignature(head(...wav))).toBeNull()
  })

  it.each([
    ['an SVG document', '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'],
    ['an XML-declared SVG', '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'],
    ['a shell script', '#!/bin/sh\nrm -rf /\n'],
    ['an AppleScript', '#!/usr/bin/osascript\ndisplay dialog "x"\n'],
    ['a PDF', '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'],
    ['a .desktop entry', '[Desktop Entry]\nExec=/bin/sh -c evil\n']
  ])('refuses %s', (_label, text) => {
    expect(matchImageSignature(new TextEncoder().encode(text))).toBeNull()
  })

  it('refuses a Mach-O executable header', () => {
    // The 64-bit little-endian magic. A `.command` or a bare executable must never earn a suffix.
    expect(matchImageSignature(head(0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00, 0x00, 0x01))).toBeNull()
  })

  it('refuses all-zero and all-0xff prefixes', () => {
    expect(matchImageSignature(new Uint8Array(SIGNATURE_PREFIX_BYTES))).toBeNull()
    expect(matchImageSignature(new Uint8Array(SIGNATURE_PREFIX_BYTES).fill(0xff))).toBeNull()
  })
})

describe('matchImageSignature — the set is closed by construction', () => {
  it('answers only a declared suffix, whatever the bytes are', () => {
    // AC 3's core property: the bytes CHOOSE a member and never SUPPLY one. Even a sniffer that got
    // its answer completely wrong could only mis-pick between raster suffixes — `.command` is not in
    // the set, so no input can produce it. Exhaustive over every one-byte prefix plus a broad sweep
    // of three-byte heads, which covers every branch point in the table.
    for (let first = 0; first <= 0xff; first += 1) {
      for (let second = 0; second <= 0xff; second += 7) {
        for (let third = 0; third <= 0xff; third += 61) {
          const answer = matchImageSignature(head(first, second, third))
          if (answer !== null) expect(DECLARED_SUFFIXES).toContain(answer)
        }
      }
    }
  })

  it('declares no suffix outside the written-down set, and never SVG', () => {
    // Source text, not runtime: `ImageSuffix` is the closed set, and a type erases at runtime, so
    // its members can only be read off the declaration. SVG has no byte signature and its default
    // handler is routinely a browser, which executes script inside it — a raster-only set is what
    // makes "open in the default handler" safe, and widening it silently is the hazard.
    const source = readFileSync(resolve('src/main/imageSignature.ts'), 'utf-8')
    const declaration = /export type ImageSuffix =([^\n]*(?:\n(?!\n)[^\n]*)*)/.exec(source)?.[1]
    expect(declaration).toBeDefined()
    const members = [...(declaration ?? '').matchAll(/'([^']*)'/g)].map((match) => match[1])
    expect(members.sort()).toEqual([...DECLARED_SUFFIXES].sort())
  })

  it('imports nothing and makes no log call — it is pure, total and Electron-free', () => {
    const source = readFileSync(resolve('src/main/imageSignature.ts'), 'utf-8')
    const specifiers = [...source.matchAll(/(?:\bfrom|\brequire\()\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1]
    )
    expect(specifiers).toEqual([])
    expect(source).not.toContain('console.')
  })
})
