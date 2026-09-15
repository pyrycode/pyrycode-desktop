/**
 * Renders the application icon — `build/icon.png` and `build/icon.ico` — from Figma node 504:2189.
 *
 *     npx electron scripts/render-app-icon.mjs
 *
 * #1416 produced the first pair of these binaries with a script it did not commit, which is why
 * re-rendering them from the drawn node was a whole ticket (#1446) rather than a command. This one is
 * committed. Two opaque binaries with no provenance are exactly the thing that quietly drifts from the
 * design, and `src/main/appIcon.test.ts` is the other half of that guard: it reads both files back.
 *
 * The glyph is NOT copied here. It is read out of `PyryMark.tsx` — the mark the app itself renders,
 * ported from mobile's ic_pyry_logo.xml — so the icon and the in-app mark cannot drift apart. A second
 * copy of a 12 KB path is a silently wrong brand mark the first time either is touched.
 *
 * Everything else is transcribed verbatim from the node, in its own 256 coordinate space, and handed
 * to Chromium as one SVG. No gradient maths is reimplemented and no colour is re-derived: the tile is
 * a rounded rect of --color-surface under the node's radial gradient, and the mark is its raw #7AB8E8.
 * Chromium is reached through Electron, which this repo already depends on, so the render needs no new
 * dependency, no network, and no image library — <canvas> hands back both a PNG and raw RGBA.
 */
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** The master raster. electron-builder falls back to it if the ICO is ever removed. */
const MASTER = 512

/** The ICO's entries. 256 is the one electron-builder requires for the NSIS target. */
const SIZES = [16, 24, 32, 48, 64, 128, 256]

/** The node's frame: 256 square, 64px corners, a 32px inset around the mark. */
const FRAME = 256
const RADIUS = 64
const INSET = 32

/** The mark's own viewport, from PyryMark.tsx. Its height sets the scale; its width follows. */
const MARK_VIEWPORT = { width: 91.002, height: 103.812 }

function markPath() {
  const source = readFileSync(join(ROOT, 'src/renderer/src/theme/PyryMark.tsx'), 'utf8')
  const match = source.match(/<path d="([^"]+)"/)
  if (!match) throw new Error('PyryMark.tsx no longer exposes a single <path d="…"> to read the mark from')
  return match[1]
}

function iconSvg(size) {
  const scale = (FRAME - INSET * 2) / MARK_VIEWPORT.height
  const width = MARK_VIEWPORT.width * scale
  const x = (FRAME - width) / 2
  // Mirrored vertically: the node places the vector under a 180° rotation composed with an x-flip,
  // which is a y-flip. The glyph is organic rather than exactly symmetric, so this is visible —
  // rasterising both candidates against the node's own render gave a mean absolute channel
  // difference of 1.58 mirrored against 5.73 plain. Hence the negative y scale and the y origin at
  // the bottom of the inset box rather than its top.
  const place = `translate(${x} ${FRAME - INSET}) scale(${scale} ${-scale})`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FRAME} ${FRAME}" width="${size}" height="${size}">
<defs>
<clipPath id="corners"><rect width="${FRAME}" height="${FRAME}" rx="${RADIUS}" ry="${RADIUS}"/></clipPath>
<radialGradient id="glow" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="10" gradientTransform="matrix(28.2 -5.9 5.9701 32.854 128 91)">
<stop offset="0.11058" stop-color="#134a74" stop-opacity="1"/>
<stop offset="0.62303" stop-color="#003355" stop-opacity="0"/>
</radialGradient>
</defs>
<g clip-path="url(#corners)">
<rect width="${FRAME}" height="${FRAME}" fill="#101418"/>
<rect width="${FRAME}" height="${FRAME}" fill="url(#glow)"/>
<g transform="${place}"><path d="${markPath()}" fill="#7AB8E8"/></g>
</g>
</svg>`
}

/**
 * One ICO image: a 40-byte BITMAPINFOHEADER, then bottom-up BGRA rows, then an all-zero AND mask. A
 * 32-bit entry carries its own alpha, so the mask stays zero; its rows are padded to 4 bytes. The
 * doubled height in the header is the format's own quirk — it counts the mask's rows too.
 */
function bmpImage(size, rgba) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4
      const to = ((size - 1 - y) * size + x) * 4
      pixels[to] = rgba[from + 2]
      pixels[to + 1] = rgba[from + 1]
      pixels[to + 2] = rgba[from]
      pixels[to + 3] = rgba[from + 3]
    }
  }
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size)
  return Buffer.concat([header, pixels, mask])
}

/** The ICONDIR plus its entries. A one-byte size field cannot hold 256, which the format spells 0. */
function icoFile(images) {
  const directory = Buffer.alloc(6 + images.length * 16)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(images.length, 4)
  let offset = directory.length
  images.forEach(({ size, payload }, index) => {
    const at = 6 + index * 16
    directory.writeUInt8(size === 256 ? 0 : size, at)
    directory.writeUInt8(size === 256 ? 0 : size, at + 1)
    directory.writeUInt16LE(1, at + 4)
    directory.writeUInt16LE(32, at + 6)
    directory.writeUInt32LE(payload.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += payload.length
  })
  return Buffer.concat([directory, ...images.map((image) => image.payload)])
}

// Each size is rasterised from the vector at its own pixel size rather than downscaled from the
// master, so Chromium antialiases the hairline arms against the grid they will actually be shown on.
const RASTERISE = `(async (sources) => {
  const out = {}
  for (const [size, svg] of sources) {
    const image = new Image()
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0, size, size)
    const bytes = new Uint8Array(context.getImageData(0, 0, size, size).data.buffer)
    let base64 = ''
    for (let at = 0; at < bytes.length; at += 8192) {
      base64 += String.fromCharCode.apply(null, bytes.subarray(at, at + 8192))
    }
    out[size] = { rgba: btoa(base64), png: canvas.toDataURL('image/png') }
  }
  return out
})`

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 64, height: 64 })
  await window.loadURL('about:blank')
  const sources = [...new Set([...SIZES, MASTER])].map((size) => [size, iconSvg(size)])
  const rendered = await window.webContents.executeJavaScript(
    `${RASTERISE}(${JSON.stringify(sources)})`
  )

  const pngPath = join(ROOT, 'build', 'icon.png')
  const icoPath = join(ROOT, 'build', 'icon.ico')
  writeFileSync(pngPath, Buffer.from(rendered[MASTER].png.split(',')[1], 'base64'))
  writeFileSync(
    icoPath,
    icoFile(
      SIZES.map((size) => ({
        size,
        payload: bmpImage(size, Buffer.from(rendered[size].rgba, 'base64'))
      }))
    )
  )
  console.log(`wrote ${pngPath} (${MASTER}²) and ${icoPath} (${SIZES.join(', ')})`)
  app.exit(0)
})
