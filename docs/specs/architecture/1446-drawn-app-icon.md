# #1446 — the drawn app icon on the installer and the dev Dock

## Files read

- `src/renderer/src/theme/PyryMark.tsx` → `PyryMark` — the shipped snowflake. Its `d` and its
  `viewBox` (91.002 × 103.812) are the icon's glyph; the render script reads the `d` back out of this
  file rather than holding a second copy, so the icon cannot drift from the mark the app renders.
- `src/renderer/src/theme/tokens.css` → `--color-surface` (`#101418`), `--color-primary-container`
  (`#134a74`) — the two palette colours the Figma node's background is built from.
- `src/main/windowPresentation.ts` → `selectWindowPresentation` — the house idiom this ticket's dock
  gate copies: a pure, Electron-free selector at the composition root, false-first on `isPackaged`.
- `src/main/windowPresentation.test.ts` — the matching test shape (plain values, no `electron` import).
- `src/main/index.ts` → `app.whenReady` — the composition root; the only place an effectful
  `app.dock.setIcon` call belongs. Also `createWindow`, which takes the presentation value the same
  way.
- `electron-builder.yml` → `win.icon` — points at `build/icon.ico`; unchanged by this ticket, and the
  reason the ICO's 256² entry is load-bearing.
- `docs/specs/architecture/1416-windows-installer-electron-builder.md` — where the two binaries came
  from, and its own deferred contingency ("add one small vitest spec asserting the ICO directory's
  entry sizes and the PNG header dimensions"), which this ticket takes up.
- `node_modules/electron/electron.d.ts` → `App.dock` — typed `readonly dock: Dock`, non-optional, even
  though Electron only defines it on darwin. The platform gate is therefore the real guard, not the
  type.
- `vitest.config.ts` → `include` — `src/**/*.{test,spec}.{ts,tsx}` and `e2e/**/*.test.ts`, which is why
  the asset spec lives under `src/main/` beside the code that names the icon path.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=504-2189

A 256² tile with 4px corners. The ground is `--color-surface`; over it sits a radial gradient whose
centre is above the middle at (128, 91) — `--color-primary-container` solid out to 11% of its radius,
fading to fully transparent `#003355` by 62%, on an ellipse wide enough to reach past the frame's
edges, so the tile reads as a dark blue glow at the mark and near-black at the corners. The snowflake
sits in its raw `#7AB8E8` at 192 tall inside a 32px inset, centred.

## Context

#1416 rendered `build/icon.png` and `build/icon.ico` before this node existed, as the mark in
`--color-on-primary-container` on a flat `--color-primary-container` tile. Both are re-rendered here
from the node. Separately, nothing sets a dock icon, so `npm run dev` on macOS shows Electron's own
default — the one place the operator looks at this app all day.

No ADR. The one decision with any tail — that the icon is rendered by a committed script rather than
hand-exported — is argued in the script's own header.

## Design

**`scripts/render-app-icon.mjs`** (new, committed). #1416 rendered its two binaries with a script it
did not commit, which is why re-rendering them is a ticket rather than a command. This one is
committed, run as `npx electron scripts/render-app-icon.mjs`, and writes both files.

- It reads the `d` attribute out of `PyryMark.tsx`. Single-sourcing the glyph is the point: a second
  copy of a 12 KB path is a silently wrong brand mark the first time one of them is touched.
- It composes ONE SVG in the node's own 256 coordinate space — rounded-rect clip, surface rect,
  gradient rect, mark — and rasterizes it at each target size through Electron's Chromium, via an
  `<img>` of a `data:image/svg+xml` URL drawn into a `<canvas>`. The gradient is transcribed verbatim
  from the node (`gradientUnits="userSpaceOnUse"`, `cx=0 cy=0 r=10`, `gradientTransform="matrix(28.2
  -5.9 5.9701 32.854 128 91)"`, stops `#134a74` @ 0.11058 opacity 1 → `#003355` @ 0.62303 opacity 0),
  so no gradient maths is reimplemented here and nothing is approximated.
- The mark is drawn at `scale(1.849305, -1.849305)` — 192/103.812, **vertically mirrored**. The node
  places the vector under a 180° rotation composed with an x-flip, which is a y-flip; MEASURED, not
  read off the transform list: the glyph is organic rather than exactly symmetric, and rasterizing
  both candidates at 256 against the node's own render gives a mean absolute channel difference of
  1.58 mirrored versus 5.73 plain. The top-level page loads from a file, not a `data:` URL — Chromium
  blocks top-level `data:` navigation, and that failure presents as a hang, not an error.
- Canvas gives raw RGBA per size and a PNG per size, so nothing needs a PNG encoder or decoder.

**`build/icon.png`** (re-rendered): the 512² master. **`build/icon.ico`** (re-rendered): 16/24/32/48/
64/128/256 entries, each an uncompressed 32-bit BMP (BITMAPINFOHEADER, bottom-up BGRA, zeroed AND
mask) — byte-for-byte the container shape #1416 already shipped, so `dist:win` sees no format change,
only new pixels.

**`src/main/dockIcon.ts`** (new): `selectDockIcon({ isPackaged, platform, appPath }): string | undefined`
— the pure, Electron-free, false-first gate, `selectWindowPresentation`'s shape exactly. Returns
`undefined` when packaged (checked first, so a shipped build can never reach the branch regardless of
platform), `undefined` off darwin, and otherwise the path of the committed master. The path is built
from `app.getAppPath()` rather than `__dirname`, so it does not encode the `out/main` build layout.

**`src/main/index.ts`** (edited): at the top of `whenReady`, call the selector and, on a path, hand it
to `app.dock.setIcon`. Under ten lines, no new state, no teardown — the dock icon is set once and
outlives every window.

## State + concurrency model

No change. No store slice, no async task, no subscription, nothing to cancel.

## Error handling

No new runtime failure surface. `setIcon` is reached only on a dev macOS run with a committed file at
a path this repo controls; the asset spec below is what keeps that file present and well-formed.
Build-time failure is the script's own non-zero exit.

## Testing strategy

- `src/main/dockIcon.test.ts` — the selector through its real entry point with plain values:
  darwin-unpackaged returns the master's path, non-darwin returns `undefined`, and packaged returns
  `undefined` **even on darwin**, which is the ordering property AC2's "a packaged build is untouched"
  actually names and the one a later edit could reverse invisibly.
- `src/main/appIcon.test.ts` — the two committed binaries, read as bytes. The PNG's IHDR is 512² RGBA;
  the ICO directory carries exactly the seven entries with 256 present (AC1's `dist:win` clause). Then,
  from the 256 entry's BMP pixels: a corner pixel is fully transparent (the 4px radius), the mark's
  centre is `#7AB8E8`, and the gradient's centre is measurably bluer than the frame's corner-adjacent
  edge — which is the assertion that would have caught the flat tile this ticket replaces. This takes
  up #1416's deferred contingency; there is no decoder, because ICO BMP entries are raw BGRA.
- No e2e spec. The dock is OS chrome outside the Electron window, so Playwright cannot see it; AC2's
  proof is the recorded dev run in the PR.
- Visual review per `docs/visual-review.md`: the rendered 256 compared against the node's own render.

## Documentation handoff

The ticket body names no documentation requirement. Pending for the documentation stage, if judged
worth keeping: the icon's provenance — that both binaries are generated by `scripts/render-app-icon.mjs`
from `PyryMark`'s path plus the node's gradient, and that the node mirrors the mark vertically — belongs
in a package overview. Not written here.

## Open questions

- Does `dock.setIcon` reject a path whose file is missing, or no-op? Resolve in Phase B by reading
  Electron's behaviour; if it throws, the call needs a guard, and that guard is a `## Revisions` entry.
- Is the residual difference against the node's render purely antialiasing? Confirm at the visual
  review; a structural residual means the gradient transcription is wrong, not the rasterizer.

## Revisions

**2026-09-14 — both open questions resolved; the first one changed the design.**

1. **`dock.setIcon` throws on an unreadable path**, rather than no-opping as the Design section
   assumed — measured against Electron 33 on darwin: `setIcon('/definitely/not/here.png')` raises
   *"Failed to load image from path"*. Because the call is the first statement in `whenReady`, a
   missing `build/icon.png` would reject that promise and take the entire launch down — no window, no
   IPC, no connection — for a cosmetic dev affordance. The guard the question anticipated therefore
   ships: the root loads the file through `nativeImage.createFromPath`, which returns an EMPTY image
   instead of throwing (measured the same run), and calls `setIcon` only when it is non-empty. The
   empty branch warns rather than staying silent, because `setIcon` accepts an empty image without
   complaint and leaves Electron's default in place — a silent miss would present as "the ticket never
   worked". `selectDockIcon` stays pure: it still answers only *which file*, and the guard is three
   lines at the composition root, where the I/O belongs.
2. **The residual against the node's render is antialiasing, not structure.** The shipped 256 ICO
   entry differs from the node's own render by a mean absolute channel difference of 1.576 — the same
   figure the pre-implementation candidate measurement gave, so the gradient transcription introduced
   nothing. The only large per-channel differences are the RGB of fully transparent corner pixels,
   where the value is not observable. The two renders are visually indistinguishable.

**Evidence gap, recorded rather than worked around.** AC2's dock is OS chrome outside the app's
window, so the only direct capture is `screencapture`, and this host has not granted the terminal
Screen Recording — it fails with *"could not create image from display"*. Per the shared visual-review
recipe that is a prerequisite failure to report, not to evade. What is proven instead: a real
`npm run dev` ran to a live relay connection with the icon call as the first statement of `whenReady`,
so it cannot have thrown; and a probe run shows `createFromPath` on the committed master yields a
non-empty 512² image and `app.dock.setIcon` accepts it without throwing. The pixels on the dock tile
are the one link a human still has to eyeball.
