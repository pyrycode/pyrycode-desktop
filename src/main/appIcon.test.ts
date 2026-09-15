import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

// The two committed application icons, read as bytes. They are opaque binaries that no other test
// touches: `build/icon.ico` is consumed by electron-builder's `win.icon` and `build/icon.png` by the
// dev dock, so a re-render that silently dropped the 256 entry or produced a blank tile would reach
// the Surface unchallenged. This takes up the contingency #1416's plan deferred.
//
// Nothing here decodes anything. The PNG is read from its IHDR, which is fixed-offset; the ICO's
// entries are an uncompressed 32-bit BMP each, so its pixels are plain bottom-up BGRA rows.

const root = fileURLToPath(new URL('../../', import.meta.url))
const png = readFileSync(`${root}build/icon.png`)
const ico = readFileSync(`${root}build/icon.ico`)

/** The seven entries `dist:win` ships. 256 is the one electron-builder requires. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/** ICO stores 256 as 0 in its one-byte width/height fields, which cannot hold 256. */
function entrySize(byte: number): number {
  return byte === 0 ? 256 : byte
}

/** Directory entries, in file order: 16 bytes each after the 6-byte ICONDIR. */
function icoEntries(): { width: number; height: number; bitCount: number; offset: number }[] {
  const count = ico.readUInt16LE(4)
  return Array.from({ length: count }, (_unused, i) => {
    const at = 6 + i * 16
    return {
      width: entrySize(ico.readUInt8(at)),
      height: entrySize(ico.readUInt8(at + 1)),
      bitCount: ico.readUInt16LE(at + 6),
      offset: ico.readUInt32LE(at + 12)
    }
  })
}

/**
 * One pixel of an entry, as `[r, g, b, a]`. The payload is a 40-byte BITMAPINFOHEADER followed by
 * bottom-up BGRA rows, so row `y` counted from the top lives at `height - 1 - y` from the start.
 */
function pixel(entryWidth: number, x: number, y: number): [number, number, number, number] {
  const entry = icoEntries().find((candidate) => candidate.width === entryWidth)
  if (!entry) throw new Error(`no ${entryWidth}px entry`)
  const at = entry.offset + 40 + ((entry.height - 1 - y) * entry.width + x) * 4
  return [ico.readUInt8(at + 2), ico.readUInt8(at + 1), ico.readUInt8(at), ico.readUInt8(at + 3)]
}

describe('the committed application icons', () => {
  it('ships the 512 square RGBA master', () => {
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG')
    expect(png.subarray(12, 16).toString('latin1')).toBe('IHDR')
    expect(png.readUInt32BE(16)).toBe(512)
    expect(png.readUInt32BE(20)).toBe(512)
    expect(png.readUInt8(25)).toBe(6)
  })

  it('ships seven 32-bit ICO entries including the 256 one dist:win embeds', () => {
    const entries = icoEntries()
    expect(entries.map((entry) => entry.width)).toEqual(ICO_SIZES)
    expect(entries.map((entry) => entry.height)).toEqual(ICO_SIZES)
    expect(entries.map((entry) => entry.bitCount)).toEqual(ICO_SIZES.map(() => 32))
  })

  it('rounds the tile with the node\'s 64px corners', () => {
    expect(pixel(256, 0, 0)[3]).toBe(0)
    expect(pixel(256, 255, 255)[3]).toBe(0)
    // Along the bottom-left diagonal the 64px arc crosses at (18.7, 236.3): three pixels outside it
    // is clear, two inside is solid. The 4px corners the icon had before were opaque at both.
    expect(pixel(256, 16, 239)[3]).toBe(0)
    expect(pixel(256, 20, 235)[3]).toBe(0xff)
  })

  it('draws the mark in its raw #7AB8E8', () => {
    expect(pixel(256, 128, 128)).toEqual([0x7a, 0xb8, 0xe8, 0xff])
  })

  it('grounds the tile in --color-surface out at the corners', () => {
    // The 64px rounding clips the tile before the gradient's transparent stop, so no opaque pixel
    // shows the ground unblended any more. The nearest opaque pixel to the corner is within a few
    // units of it on every channel; a wrong ground colour lands tens away.
    const [r, g, b, a] = pixel(256, 20, 236)
    expect(a).toBe(0xff)
    expect(Math.abs(r - 0x10)).toBeLessThanOrEqual(4)
    expect(Math.abs(g - 0x14)).toBeLessThanOrEqual(4)
    expect(Math.abs(b - 0x18)).toBeLessThanOrEqual(8)
  })

  it('lights the tile with the gradient rather than a flat fill', () => {
    // Both are background: above the mark's 32px inset, and down in the far corner. A flat tile —
    // which is what this icon was before #1446 — makes these two equal.
    const lit = pixel(256, 128, 16)
    const unlit = pixel(256, 20, 236)
    expect(lit[2] - unlit[2]).toBeGreaterThan(40)
    expect(lit[3]).toBe(0xff)
  })
})
