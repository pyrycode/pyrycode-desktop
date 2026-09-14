# Windows packaging (`electron-builder`)

`npm run dist:win` runs `npm run build` and then `electron-builder --win`, producing an unsigned NSIS
installer from `electron-builder.yml`. No `mac` or `linux` target: an artifact for a platform nobody has
launched the app on is not something this repo ships. No signing, no `publish` (auto-update) feed —
updating means installing a newer exe over the old one. (#1416)

## The build-host-arch trap

`electron-builder --win` with no `arch` key defaults to the **build host's** architecture, not a fixed
target. On the Apple Silicon Mac that built this config the first time, the default silently produced a
Windows-on-ARM-only payload — nothing in the log said so, and an x64 Surface would have refused to run
it. `electron-builder.yml`'s `win.target[0].arch` now spells out `[x64, arm64]` so the one NSIS installer
is native on either Surface generation regardless of which machine builds it. Worth re-checking on any
future `--mac` or `--linux` target: the same default-to-host-arch behavior applies there too.

## `extraMetadata.productName` — not redundant with `productName`

`app.getPath('userData')` follows Electron's `app.getName()`, which reads `productName` then `name` out
of the **app's own** `package.json` — the `productName` key at the top of `electron-builder.yml` is
invisible to it; that key only names the product in installer chrome. Without
`extraMetadata: { productName: Pyrycode Desktop }`, the packed `package.json` carries no `productName`
at all and the installed app falls back to `name`, storing under `%APPDATA%\pyrycode-desktop` rather than
the `%APPDATA%\Pyrycode Desktop` the operator acceptance and the README name. Verified by packing twice,
once with the line and once without, and diffing the packed `app.asar`'s `package.json`.

Putting `productName` in the **repo's** `package.json` instead would reach the same packaged result but
also rename the user-data directory `npm run dev` uses on macOS, moving the author's live pairing out
from under his daily driver. `extraMetadata` is the only form of this that is safe, because it exists
only in the artifact electron-builder packs, not in the source tree's own `package.json`.

## The `files` allowlist keeps test scaffolding out of the shipped app

`files: [out/**, package.json]` is an allowlist, not electron-builder's default `**/*`. Verified against
the packed artifact: each `app.asar`'s top level is exactly `node_modules`, `out`, `package.json` — no
`src/`, no `e2e/`, no `build/`. That is what keeps `fakeDaemon.ts`, the fake relay, and every Playwright
fixture out of a build someone installs, while the 1261 production `node_modules` entries
`externalizeDepsPlugin` (`electron.vite.config.ts`) requires still ship — electron-builder resolves those
from the `dependencies` block via its own `node_modules` inclusion, unconditionally spliced in ahead of
this glob (`app-builder-lib`'s `computeFileSets`), not from `files` itself. The same function
auto-excludes `buildResources`, so `build/` (the icon source, see below) staying out of `files` costs
nothing.

## `build/` holds icon inputs, not app payload

`build/icon.ico` and `build/icon.png` are committed under `build/`, electron-builder's default
`buildResources` directory, picked up by convention rather than named in `files`. `win.icon:
build/icon.ico` supplies the installed app's and the taskbar's icon; `nsis.installerIcon` falls back to
the application icon when `build/installerIcon.ico` is absent, which it deliberately is, so the
installer chrome uses the same icon rather than a second asset. The ICO carries all seven conventional
entry sizes (16/24/32/48/64/128/256); the 256² entry is the one electron-builder requires and is
confirmed present, byte-for-byte, inside both built exes.

Both binaries are rendered from Figma node 504:2189 by the committed `scripts/render-app-icon.mjs`
(`npx electron scripts/render-app-icon.mjs`), re-rendered in [#1446](https://github.com/pyrycode/pyrycode-desktop/issues/1446)
to replace the flat tile #1416 shipped before that node existed. The 256² frame has 4px rounded corners
over a `--color-surface` base; a radial gradient centred above the middle at (128, 91) — solid
`--color-primary-container` out to 11% of its radius, fading to fully transparent `#003355` by 62% — is
transcribed verbatim from the node's own gradient stops rather than reimplemented, so nothing here is an
approximation of it. The snowflake sits in its raw `#7AB8E8`, 192 tall inside a 32px inset. The script
reads the mark's `d` attribute directly out of `PyryMark.tsx` rather than holding a second copy, so the
icon cannot drift from the mark the app renders elsewhere.

Two things worth knowing before touching that script again:

- **The node draws the mark vertically mirrored** — a 180° rotation composed with an x-flip is a y-flip.
  The snowflake is organic rather than exactly symmetric, so this is visible and was settled by
  measurement, not by reading the transform list: rasterising both candidates against the node's own
  render gave a mean absolute channel difference of 1.58 mirrored versus 5.73 plain. The shipped 256 ICO
  entry differs from the node's own render by 1.576 — no worse than that pre-implementation measurement,
  so the gradient transcription introduced no additional error; the only large per-channel differences
  are the RGB channels of fully transparent corner pixels, which are not observable.
- **Chromium blocks top-level `data:` navigation, and in Electron that failure presents as a hang, not an
  error.** The script rasterises its composed SVG through an `<img>` of a `data:image/svg+xml` URL drawn
  into a `<canvas>`, but the *page* that hosts that canvas has to load from a `file://` path — a
  top-level page loaded from a `data:` URL never resolves.

`appIcon.test.ts` reads both committed binaries back as bytes with no image decoder: the PNG's IHDR
gives its dimensions directly, and the ICO's entries are uncompressed 32-bit BMP (bottom-up BGRA after a
40-byte header), so a corner pixel's transparency, the mark's centre color and the gradient's non-
flatness are all assertable straight off the bytes.

## Cross-building on macOS: reaches `makensis`, then fails there — Apple Silicon without Rosetta 2

`electron-builder --win` on an Apple Silicon Mac with no Rosetta 2 packs the entire app — both archs,
the Electron download, the `productName` rename, icon embedding, and the compressed `.nsis.7z`
payload — and fails only at the final step, spawning `mac/makensis`:

```
⨯ Cannot spawn .../nsis-3.0.4.1/mac/makensis: Error: spawn Unknown system error -86
```

`-86` is `EBADARCH`: electron-builder's bundled `mac/makensis` is an x86_64-only Mach-O binary, and
without Rosetta 2 (`/Library/Apple/usr/libexec/oah` absent) the kernel refuses to spawn it at all. The
stack trace points at NSIS internals, not at the cause, so "the build failed" understates how far it
actually got — everything up to the installer-wrapping step is proven on an Apple Silicon Mac without
Rosetta. Two routes to an actual `.exe`, neither a code or config change: `softwareupdate
--install-rosetta` on the build Mac, or run `npm run dist:win` on Windows itself, where `makensis` is
native.

## What running the packaging stage proved without installing anything

A macOS `dist:win` run that reaches the NSIS step (the common case, once Rosetta 2 or a Windows host is
available) is itself evidence, checked against the two `dist/win*-unpacked/Pyrycode Desktop.exe`
artifacts rather than read off the config: the icon bytes are embedded, the asar contents are exactly
what `files` allows, and the packed `package.json` carries the right `productName`. What it cannot prove
is anything that only happens at runtime on Windows — the three `app.isPackaged` composition-root
branches in `src/main/index.ts` (`selectRelayPolicy`, `selectSecretEncryption`, `fileRotatingSink` vs.
`stdoutSink`), and whether `noise-c.wasm` loads from inside the asar (Electron's asar-aware `fs.readFileSync`
patch is expected to make this transparent, since `loadNoiseLib` — `src/main/transport/noiseLib.ts` — is
main-process only, but nothing exercises it before an installed launch). Those stay open until the
Windows operator acceptance actually installs and runs the exe; see #1416's operator-acceptance comment
for that outcome once recorded.

## No packaging-config test in the suite, by design

There is deliberately no vitest spec that parses `electron-builder.yml` and asserts its keys — that
would be a second copy of the config, not a proof of it. The real proof is running `dist:win` and
checking the artifact, which is what the two sections above do. A contingency spec asserting the ICO's
directory-entry sizes and the PNG header dimensions was planned in case the macOS run failed before
reaching the icon stage; it did not, so that spec was never added.

## Dev-dependency-only audit noise

Adding `electron-builder` brings in npm-audit advisories in its own dependency tree; `npm audit
--omit=dev` reports zero, since none of it ships in the installer (the `files` allowlist plus
electron-builder's own `devDependencies` stripping both agree on that). Do not chase those advisories as
if they affected the shipped app.

## Windows user-data directory

The installed build stores under `%APPDATA%\Pyrycode Desktop` — the diagnostic log
([content-free diagnostic log](diagnostic-log.md)) under `logs\`, the [secure store](secure-store.md)'s
encrypted blobs under `secrets\`, and the [paired-server store](paired-server-store.md)'s saved hosts —
all following `app.getPath('userData')`, which is what makes the `extraMetadata.productName` line above
load-bearing. See `README.md` § Build for the operator-facing version of this.
