import { describe, expect, it, vi } from 'vitest'
import { applyBadgeCount, badgeLabel, drawBadgeBitmap, type BadgeBitmap } from './appBadge'

/** The BGRA quadruple at (x, y). */
function pixel(bitmap: BadgeBitmap, x: number, y: number): number[] {
  const at = (y * bitmap.width + x) * 4
  return Array.from(bitmap.buffer.subarray(at, at + 4))
}

const WHITE = [255, 255, 255, 255]
const TRANSPARENT = [0, 0, 0, 0]

/** A fake window with the overlay face, recording every call. */
function fakeWindow(destroyed = false) {
  return {
    isDestroyed: () => destroyed,
    setOverlayIcon: vi.fn<(overlay: string | null, description: string) => void>()
  }
}

function deps(platform: NodeJS.Platform, window: ReturnType<typeof fakeWindow> | null) {
  return {
    platform,
    setBadgeCount: vi.fn<(count: number) => boolean>(() => true),
    overlayWindow: () => window,
    toImage: (bitmap: BadgeBitmap) => `image:${bitmap.width}x${bitmap.height}`
  }
}

describe('badgeLabel', () => {
  it('is null at zero, the digit up to nine, and 9+ above nine', () => {
    expect(badgeLabel(0)).toBeNull()
    expect(badgeLabel(1)).toBe('1')
    expect(badgeLabel(9)).toBe('9')
    expect(badgeLabel(10)).toBe('9+')
    expect(badgeLabel(250)).toBe('9+')
  })
})

describe('drawBadgeBitmap', () => {
  it('draws a 32×32 BGRA disc: transparent corners, a red rim and white glyph pixels', () => {
    const bitmap = drawBadgeBitmap('8')
    expect(bitmap.width).toBe(32)
    expect(bitmap.height).toBe(32)
    expect(bitmap.buffer.length).toBe(32 * 32 * 4)
    expect(pixel(bitmap, 0, 0)).toEqual(TRANSPARENT)
    expect(pixel(bitmap, 31, 31)).toEqual(TRANSPARENT)
    // Just inside the disc's left edge on the middle row: red, stored blue-green-red-alpha.
    const [b, g, r, a] = pixel(bitmap, 2, 16)
    expect(a).toBe(255)
    expect(r).toBeGreaterThan(150)
    expect(g).toBeLessThan(80)
    expect(b).toBeLessThan(80)
    // An 8 fills its top-left glyph cell, so some pixel near the centre is white.
    const white = Array.from({ length: 32 * 32 }, (_, i) => pixel(bitmap, i % 32, Math.floor(i / 32)))
      .filter((p) => p.every((v, i) => v === WHITE[i])).length
    expect(white).toBeGreaterThan(20)
  })

  it('never writes a partial alpha, so premultiplication cannot matter', () => {
    const { buffer } = drawBadgeBitmap('9+')
    for (let i = 3; i < buffer.length; i += 4) expect([0, 255]).toContain(buffer[i])
  })

  it('draws 9+ wider than 9', () => {
    const whiteColumns = (bitmap: BadgeBitmap): number =>
      new Set(
        Array.from({ length: 32 * 32 }, (_, i) => i)
          .filter((i) => pixel(bitmap, i % 32, Math.floor(i / 32)).every((v, k) => v === WHITE[k]))
          .map((i) => i % 32)
      ).size
    expect(whiteColumns(drawBadgeBitmap('9+'))).toBeGreaterThan(whiteColumns(drawBadgeBitmap('9')))
  })
})

describe('applyBadgeCount', () => {
  it('on win32 sets the drawn overlay with a count-only description and never the app badge', () => {
    const window = fakeWindow()
    const d = deps('win32', window)
    applyBadgeCount(3, d)
    expect(window.setOverlayIcon.mock.calls).toEqual([['image:32x32', '3 conversations need attention']])
    expect(d.setBadgeCount).not.toHaveBeenCalled()
  })

  it('on win32 labels a count above nine as 9+, and one in the singular', () => {
    const window = fakeWindow()
    applyBadgeCount(12, deps('win32', window))
    applyBadgeCount(1, deps('win32', window))
    expect(window.setOverlayIcon.mock.calls).toEqual([
      ['image:32x32', '9+ conversations need attention'],
      ['image:32x32', '1 conversation needs attention']
    ])
  })

  it('on win32 clears the overlay with null at zero', () => {
    const window = fakeWindow()
    applyBadgeCount(0, deps('win32', window))
    expect(window.setOverlayIcon.mock.calls).toEqual([[null, '']])
  })

  it('on win32 no-ops without a window or on a destroyed one', () => {
    const d = deps('win32', null)
    expect(() => applyBadgeCount(2, d)).not.toThrow()
    const destroyed = fakeWindow(true)
    applyBadgeCount(2, deps('win32', destroyed))
    expect(destroyed.setOverlayIcon).not.toHaveBeenCalled()
  })

  it('on darwin sets the app badge count and touches no overlay', () => {
    const window = fakeWindow()
    const d = deps('darwin', window)
    applyBadgeCount(4, d)
    applyBadgeCount(0, d)
    expect(d.setBadgeCount.mock.calls).toEqual([[4], [0]])
    expect(window.setOverlayIcon).not.toHaveBeenCalled()
  })
})
