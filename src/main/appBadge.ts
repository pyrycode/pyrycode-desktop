// The app icon's attention badge (#1592): how many conversations need the operator, shown on the
// macOS Dock icon or, on Windows, as a taskbar overlay. The renderer derives the count and sends it
// as `setBadgeCount`; this module decides what each platform does with it. It imports no `electron`,
// in the `selectDockIcon` shape: the composition root passes the platform, the two Electron calls and
// the image factory in, so every branch unit-tests with plain values and a fake window.
//
// Windows has no `app.setBadgeCount`, and `nativeImage` renders neither SVG nor text, so the overlay
// is drawn here as a raw bitmap: a red disc with a white count from a small pixel font. The label set
// is closed ('1'…'9', '9+'), so no input reaches the drawing but a count this module turned into text.

/** A raw 32-bit bitmap in BGRA byte order, the layout `nativeImage.createFromBitmap` reads. */
export interface BadgeBitmap {
  buffer: Buffer
  width: number
  height: number
}

/** The one window face the Windows overlay needs. A BrowserWindow satisfies it structurally. */
export interface BadgeOverlayWindow<I> {
  isDestroyed(): boolean
  setOverlayIcon(overlay: I | null, description: string): void
}

export interface AppBadgeDeps<I> {
  platform: NodeJS.Platform
  setBadgeCount: (count: number) => unknown
  overlayWindow: () => BadgeOverlayWindow<I> | null
  toImage: (bitmap: BadgeBitmap) => I
}

/** The overlay's text for a count: none at zero, the digit up to nine, `9+` above. */
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null
  return count > 9 ? '9+' : String(count)
}

const SIZE = 32
/** Each font pixel is drawn as a SCALE×SCALE block. */
const SCALE = 2
/** The gap between two glyphs, in font pixels. */
const GLYPH_GAP = 1
// Windows' own critical-badge red, #C42B1C, as blue, green, red, alpha.
const RED = [0x1c, 0x2b, 0xc4, 0xff]
const WHITE = [0xff, 0xff, 0xff, 0xff]

/** A 5×7 pixel font for the characters a label can hold. `#` is lit. */
const GLYPHS = new Map<string, readonly string[]>(Object.entries({
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....']
}))
const GLYPH_WIDTH = 5
const GLYPH_HEIGHT = 7

/**
 * Draw the overlay for `label`: a hard-edged red disc filling the square, the label centred on it in
 * white. Every pixel is either fully transparent or fully opaque, so the premultiplied-alpha question
 * never arises. A character with no glyph is skipped rather than drawn, so the buffer is always
 * exactly SIZE×SIZE×4 whatever the label holds.
 */
export function drawBadgeBitmap(label: string): BadgeBitmap {
  const buffer = Buffer.alloc(SIZE * SIZE * 4)
  const paint = (x: number, y: number, colour: readonly number[]): void => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
    buffer.set(colour, (y * SIZE + x) * 4)
  }

  const radius = SIZE / 2
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x + 0.5 - radius
      const dy = y + 0.5 - radius
      if (dx * dx + dy * dy <= radius * radius) paint(x, y, RED)
    }
  }

  const glyphs = [...label].flatMap((char) => {
    const glyph = GLYPHS.get(char)
    return glyph === undefined ? [] : [glyph]
  })
  const textWidth = (glyphs.length * (GLYPH_WIDTH + GLYPH_GAP) - GLYPH_GAP) * SCALE
  const left = Math.floor((SIZE - textWidth) / 2)
  const top = Math.floor((SIZE - GLYPH_HEIGHT * SCALE) / 2)
  glyphs.forEach((rows, index) => {
    const glyphLeft = left + index * (GLYPH_WIDTH + GLYPH_GAP) * SCALE
    rows.forEach((row, gy) => {
      ;[...row].forEach((cell, gx) => {
        if (cell !== '#') return
        for (let sy = 0; sy < SCALE; sy++) {
          for (let sx = 0; sx < SCALE; sx++) {
            paint(glyphLeft + gx * SCALE + sx, top + gy * SCALE + sy, WHITE)
          }
        }
      })
    })
  })
  return { buffer, width: SIZE, height: SIZE }
}

/**
 * Show `count` on the app icon. Windows: an overlay on the current window, cleared with `null` at
 * zero, and a no-op when no live window exists (a reopened window's renderer re-sends its count).
 * The overlay's accessible description is built from the label alone. Every other platform:
 * `app.setBadgeCount`, which macOS draws itself and which clears at zero.
 */
export function applyBadgeCount<I>(count: number, deps: AppBadgeDeps<I>): void {
  if (deps.platform !== 'win32') {
    deps.setBadgeCount(count)
    return
  }
  const window = deps.overlayWindow()
  if (window === null || window.isDestroyed()) return
  const label = badgeLabel(count)
  if (label === null) {
    window.setOverlayIcon(null, '')
    return
  }
  const description =
    label === '1' ? '1 conversation needs attention' : `${label} conversations need attention`
  window.setOverlayIcon(deps.toImage(drawBadgeBitmap(label)), description)
}
