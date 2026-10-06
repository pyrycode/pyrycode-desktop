# Windows packaging (`electron-builder`)

`npm run dist:win` runs `npm run build` and then `electron-builder --win --publish never`, producing one
unsigned NSIS installer for x64 and arm64 from `electron-builder.yml`, its `.blockmap`, and `latest.yml`.
`npm run release:win -- X.Y.Z` builds on pyrybox and publishes those three assets to the
[GitHub Releases feed](https://github.com/pyrycode/pyrycode-desktop/releases). Mac and Linux targets and
signing remain out of scope. Packaged Windows builds check that feed once per process launch,
download silently and offer a pinned sidebar restart prompt after verification. Ordinary quit
also installs a downloaded update. See [README Build](../../../README.md#build) for commands,
prerequisites and the first manual unsigned Surface install. The actual Surface update round-trip
remains [operator acceptance](#surface-self-update-acceptance).

## Release preparation and retry state

[`scripts/release-win.mjs`](../../../scripts/release-win.mjs) accepts stable `X.Y.Z` only, without a
`v`, leading zeroes or suffix. A new version, including a draft retry, must exceed all published
stable versions, or the source `package.json` version before the first release. The tag names the
unmodified source SHA from GitHub main; the version stamp changes only an isolated clone and lands
before `npm run build` so `__APP_VERSION__` carries the release version. Main keeps its dev version.

Preparation runs `npm ci`, **tests before stamping**, then stamps and builds. Stamping before tests
would break the Settings spec, which pins the development version supplied by `vitest.config.ts`.
Testing the unmodified source preserves that check while the packaged renderer gets the release
version. The transaction test pins this order and a failed-check retry leaves no draft or publish.

`~/.cache/pyrycode-desktop-releases/X.Y.Z/` on the Mac stores the source SHA and preparation/build
receipts; `~/pyrycode-desktop-release/X.Y.Z/` on pyrybox holds the build and verification downloads.
Keep these for retries: completed work is reused for the same SHA/version, incomplete uploads are
repaired, and every download is verified again before publishing. A draft or existing tag on another
SHA fails rather than combining commits. GitHub ignores `target_commitish` when a tag exists, so
checking that tag's resolved SHA is essential before reuse.

The exact published-version check precedes **all local state access**. An interrupted state write
can leave truncated or non-JSON metadata; parsing it first would turn a completed release's no-op
into a failure. Unpublished versions still need their saved source SHA to resume safely.

## Feed generation and verification before publication

The GitHub provider names `pyrycode/pyrycode-desktop`. `PublishManager` writes `latest.yml` and each
architecture's `resources/app-update.yml` even with `--publish never`.
Keep that flag on both local and release packaging: otherwise CI/tag detection can enable automatic
publication and bypass the draft verification transaction. The NSIS `artifactName` has neither
spaces, which GitHub rewrites on upload, nor `${arch}`, which would split the combined installer:
`Pyrycode-Desktop-Setup-X.Y.Z.exe` must match the feed exactly.

Before any GitHub write, the command checks the feed's version, installer name and base64 sha512,
plus both architectures' repo configuration. It creates or resumes one draft, retaining existing
assets only when their upload state, size and available digest match. It downloads the installer,
blockmap and feed by asset id, compares their sha256 hashes to the build, and checks the downloaded
feed's installer sha512. An upload or hash failure leaves the release unpublished; a mismatched
download is deleted so a retry uploads it again. Publishing is followed by a release/tag readback.
These hashes establish transfer integrity; the installer remains unsigned. Runtime sha512
verification likewise establishes download integrity, not publisher authenticity: anyone able to
publish this repository's releases can ship code to the Surface.

## Packaged Windows self-update

[`src/main/appUpdate.ts`](../../../src/main/appUpdate.ts) owns one controller per process.
`selectAppUpdateEligibility` checks `isPackaged` first and only then `platform === 'win32'`;
the lazy `electron-updater` factory is never invoked in development or on other platforms.
`electron-updater` 6.8.9 is a production dependency alongside the electron-builder 26 configuration.
`externalizeDepsPlugin` leaves it external and electron-builder includes production dependencies
through its own dependency packaging, independently of the `files` allowlist below.

The controller consumes the packaged `app-update.yml`; there is no feed override, credential or
renderer-controlled URL. Before its single `checkForUpdates()` call, it disables the library logger,
enables `autoDownload` and `autoInstallOnAppQuit`, and disables web installers. It never calls the
OS-notification API. Available metadata only starts the internal downloading phase; only the
library's verified `update-downloaded` event during that phase grants installation authority.
Checking, downloading, up-to-date results and check/offline failures show no row. Download or
integrity failures produce one dismissible failed row; classification uses lifecycle phase,
never error-message inspection. Both error events and rejected check/download promises are handled.
There is no retry loop within a launch. See [the sidebar row](channel-list.md#app-wide-self-update-row)
for copy, version fallback and Later/Dismiss behavior. Host minimum-version rejection remains a
separate [host-row affordance](channel-list-host-row.md).

Diagnostics use fresh static records through the existing [diagnostic log](diagnostic-log.md):
`app-update-checking`, `app-update-downloading`, `app-update-ready`, `app-update-installing` and
`app-update-dismissed`; `app-update-failed` carries only `startup-failed`, `check-failed`,
`download-failed` or `install-failed`. `app-update-refused` uses `untrusted-sender`,
`malformed-command` or `not-installable`. Never adapt the library logger by forwarding its arguments
to `DiagnosticLog.event`: those can contain feed metadata and raw exception text, including in
otherwise permitted string fields. Even the validated feed version is omitted from diagnostics.

### IPC state and lifetime

[`src/shared/ipc/appUpdate.ts`](../../../src/shared/ipc/appUpdate.ts) defines the separate
`pyry:app-update-state` snapshot/event channel and `pyry:app-update-action` command channel;
neither extends daemon wire events. State contains only `{ type: 'idle' }`,
`{ type: 'ready', version: string | null }` or `{ type: 'failed' }`. The sole feed-supplied
display text is a stable ASCII `X.Y.Z`, at most 64 characters, with no leading zeroes except zero
itself, prefix, whitespace, prerelease or build suffix. Invalid versions become `null` without
discarding the verified update. URLs, paths, release notes and raw errors never enter state or logs.

Preload exposes only `onAppUpdate` and `sendAppUpdateAction`. It installs the event listener before
requesting a snapshot, projects either delivery into a fresh declared state, and ignores the
snapshot after any event or cleanup. This gives late subscribers current completion or dismissed
state without allowing an older startup snapshot to overwrite a newer event. `App` subscribes for
its lifetime into `appUpdateStore`; subscribing from the sidebar would miss completion while
Settings or pairing owns the screen. Main retains state and dismissal across renderer remounts.

Main accepts only the exact one-field `{ type: 'restart' }` and `{ type: 'dismiss' }` objects
from a current BrowserWindow's main frame. Restart is inert without verified download authority
and is latched to one attempt. Dismiss hides state for the process lifetime without revoking a
ready update or disabling installation on ordinary quit. Duplicate completion/failure delivery
cannot revive the row. On `will-quit`, main unregisters IPC and disposes the controller: subscribers
and lifecycle listeners are removed and a pending download token is cancelled, including one
returned by a late check result. A content-free inert error listener remains until exit because
cancellation can still emit an EventEmitter error; late work cannot publish or log.

### History drain and installation failure

`createQuitDrain` shares one promise between Restart now and ordinary quit. It permanently stops
the connection registry, flushes every window's renderer history writer, then awaits queued main
history operations. Successful completion marks `quitDrained`, allowing the windows' close guards
to pass. Restart then calls `quitAndInstall(true, true)` once: silent installation and forced
relaunch. Waiting only in `before-quit` would be too late, because the library begins installing
before its explicit `app.quit()`. See [history shutdown](chat-history.md#window-close-and-app-quit).

Once that registry has stopped, an installation failure cannot leave a usable open application.
A thrown installer call or updater error revokes verified authority, disables
`autoInstallOnAppQuit` to prevent a retry during the same quit, and completes an orderly exit once
the drain succeeds. An error during draining waits for persistence and skips installer execution.
Repeated failures cannot install or exit again. This differs from a download failure, whose
dismissible row leaves the application running. No persistent previous-install outcome is inferred.

### Self-update test evidence

[`appUpdate.test.ts`](../../../src/main/appUpdate.test.ts) fakes updater events and promises;
[`preload/appUpdate.test.ts`](../../../src/preload/appUpdate.test.ts) covers projection, late snapshots
and cleanup. Shutdown regressions hold persistence using the real connection registry, history
store, secure store and shared drain. A no-op `beforeInstall` fake alone cannot detect an application
left open with permanently stopped connections after installation failure.

[`e2e/app-update.spec.ts`](../../../e2e/app-update.spec.ts) injects the production controller with a
fake updater at main's IPC seam and clicks the mounted row through production preload. It covers
Restart once, Later, Dismiss, completion while Settings is open, remounts, pinned geometry and
icon loading/recolouring. It adds no production updater switch and executes no download or installer.
Static renderer tests pin copy but cannot prove these interactions.

The [final verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1828#issuecomment-6027643097)
records the gate at `08ed7d85`: 9,048 unit tests executed and passed, 0 failed, 3 skipped;
The configured `npx playwright test --reporter=json` run had 317 executed and passed, 0 failed,
5 skipped. It ran the default fake-transport tier directly after the separate successful build,
rather than through the issue's `npm run e2e` wrapper. All three `app-update.spec.ts`
scenarios were present and passed: verified row/Restart, Later across repeat delivery/navigation/remount,
and failure/Dismiss across duplicate error/remount. Build and docs guard also passed. These fake
tests establish application behavior at the injected boundary; Windows installer/relaunch and
pairing continuity still require the Surface procedure below. No live-Claude run was required or recorded.

### Surface self-update acceptance

Acceptance for [#1775](https://github.com/pyrycode/pyrycode-desktop/issues/1775) remains pending
Juhana's Surface comment before ticket closure. Neither fake-transport nor real-Claude tests prove it.

1. Manually install release N containing the updater over the zip build. Verify that hosts remain
   paired using the same `%APPDATA%\Pyrycode Desktop` directory.
2. Publish N+1 with `npm run release:win -- X.Y.Z`, then launch N. Wait for Update ready, choose
   Restart now, and verify silent installation/relaunch, Settings showing N+1 and retained hosts.
3. Publish N+2, launch N+1, wait for Update ready, choose Later and quit normally. Verify the next
   launch runs N+2, with Settings version and paired hosts recorded again.

Record versions, restart/quit outcomes and pairing evidence in the issue comment.

## Build host and source transfer

The Mac command re-enters under `automation-access with-pyrybox-key` and explicitly passes the
temporary agent through SSH's `IdentityAgent`. GitHub REST calls use pyrybox's existing
`~/.local/bin/gh` login over SSH; no token reaches the Mac or Wine container. The prepared tree is
streamed without `.git`, `node_modules` or `dist`, and pyrybox runs a digest-pinned
`electronuserland/builder:wine` image through Podman with a fresh locked dependency install.

The `tar | ssh` transfer must run under **Bash `pipefail`**. Tar can emit a valid partial archive and
then fail while remote extraction succeeds; accepting only SSH's exit status would allow an
incomplete application to reach packaging and publication. Either failure stops before the Wine
build, build receipt or GitHub writes. Transaction fakes alone cannot prove shell pipeline behavior;
`scripts/release-win-upload.test.ts` exercises the real command boundary with local fake tar/SSH
executables, including successful extraction of a partial archive whose producer exits nonzero.

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
fixture out of a build someone installs, while the production `node_modules` dependencies
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
to replace the flat tile #1416 shipped before that node existed. The 256² frame has 64px rounded corners, widened from 4px on 2026-09-15 when the node gained them,
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
Rosetta. The release command therefore packages on Intel Linux pyrybox in the Podman Wine container.
Local alternatives are installing Rosetta 2 on the build Mac or running `npm run dist:win` on Windows,
where `makensis` is native; neither local path publishes.

## What running the packaging stage proved without installing anything

A macOS `dist:win` run that reaches the NSIS step (the common case, once Rosetta 2 or a Windows host is
available) is itself evidence, checked against the two `dist/win*-unpacked/Pyrycode Desktop.exe`
artifacts rather than read off the config: the icon bytes are embedded, the asar contents are exactly
what `files` allows, and the packed `package.json` carries the right `productName`. What it cannot prove
is anything that only happens at runtime on Windows — the `app.isPackaged` composition-root
branches in `src/main/index.ts` (`selectRelayPolicy`, `selectSecretEncryption`, `fileRotatingSink` vs.
`stdoutSink`, and the packaged-Windows updater construction gate), and whether `noise-c.wasm` loads
from inside the asar (Electron's asar-aware `fs.readFileSync`
patch is expected to make this transparent, since `loadNoiseLib` — `src/main/transport/noiseLib.ts` — is
main-process only, but nothing exercises it before an installed launch). Those stay open until the
Windows operator acceptance actually installs and runs the exe; see #1416's operator-acceptance comment
for that outcome once recorded.

## Packaging and release test boundaries

There is deliberately no vitest spec that parses `electron-builder.yml` and asserts its keys — that
would be a second copy of the config, not a proof of it. Packaging proof comes from running the build
and checking the artifact. A contingency spec asserting the ICO's
directory-entry sizes and the PNG header dimensions was planned in case the macOS run failed before
reaching the icon stage; it did not, so that spec was never added.

Release transaction tests inject command, filesystem, remote-host and GitHub boundaries to check
validation, isolated preparation, verification before publish, upload/hash failure repair and
source-pinned retries. Dry run uses a command recorder and in-memory filesystem, ending at the Wine
invocation without executing SSH/Podman/the key helper or contacting GitHub; it proves command shape,
not a real build or live release.

The [verifier's final verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1806#issuecomment-6026588812)
records the gate at `e36037e8`: 8,979 unit tests executed and passed, 0 failed, 3 skipped, with all 19
release tests present and passed, including malformed-state and transfer-failure regressions.
Post-merge Wine build from main, artifact inspection, first live GitHub publication and a second live
published-version no-op remain operator acceptance. The operator must comment with those results
before closing [#1774](https://github.com/pyrycode/pyrycode-desktop/issues/1774). A preliminary Wine build
from a feature commit used stubbed GitHub writes and does not satisfy that hand check.

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
