# #1416 — Windows installer via electron-builder

## Files read

- `package.json` → `scripts`, `main`, `dependencies` — where `dist:win` lands, and the entry point
  electron-builder packs (`./out/main/index.js`).
- `electron.vite.config.ts` → `externalizeDepsPlugin` on `main` and `preload` — runtime dependencies are
  left unbundled, so production `node_modules` must ship inside the installer.
- `src/main/index.ts` → the three `app.isPackaged` composition-root branches: the `selectRelayPolicy`
  call, the `selectSecretEncryption` call, and the `fileRotatingSink(join(app.getPath('userData'),
  'logs'))` / `stdoutSink()` choice. The installed build is the first real run of all three.
- `src/main/relayPolicy.ts` → `selectRelayPolicy` — false-first on `isPackaged`, so packaging can only
  tighten the relay posture, never relax it.
- `src/main/windowPresentation.ts` → `selectWindowPresentation` — the same false-first shape; a packaged
  build always shows its window, so the installed app cannot boot invisibly.
- `src/main/transport/noiseLib.ts` → `loadNoiseLib` — the single process-lived `noise-c.wasm` load, and
  the only place an asar-packed wasm could fail to resolve.
- `src/renderer/src/theme/PyryMark.tsx` → `PyryMark` — the shipped pyrycode snowflake, ported from
  mobile's `ic_pyry_logo.xml`. Its `viewBox` and `d` are the application icon's geometry; the icon is
  not a new mark.
- `src/renderer/src/theme/tokens.css` → `--color-primary-container`, `--color-on-primary-container` —
  the icon's two colours, taken from the shipped palette rather than invented.
- `e2e/fixtures/launchPairedApp.ts` → the `args: ['.']` launch — every Playwright fixture resolves the
  built entry through `package.json` `main`, so the packaging config must not move or rewrite it.
- `vitest.config.ts` → `include` — vitest sees `src/**/*.{test,spec}.{ts,tsx}` and `e2e/**/*.test.ts`
  only; there is no directory a packaging assertion would naturally live in.
- `README.md` § Build — the documentation stage's target, listed under Documentation handoff below.
- `docs/knowledge/features/development-verification.md` (index entry) — meaningful evidence over passing
  gates, which is why the proof below is a recorded real `dist:win` run rather than a spec that re-reads
  the config file it is asserting against.

## Design source

**Figma:** N/A — packaging configuration, per the ticket body. The file holds no application mark
(checked by the refiner 2026-09-14), so the visual-fidelity check is intentionally skipped for the
config. The one visual artifact, the application icon, is derived from the mark the app already ships
(`PyryMark`) and is compared against that rendered mark, not against a Figma node.

## Context

The app has only ever run as `npm run dev` from a clone. This ticket adds `electron-builder` and a
`dist:win` script that produces an unsigned NSIS installer, so the Surface can run an installed build.
No signing, no update feed, no macOS or Linux target.

Nothing under `src/` changes. The repo is already shaped for packaging: `package.json` `main` points at
the electron-vite output, every runtime dependency is plain JavaScript or wasm, and the three
`app.isPackaged` seams named above already branch correctly — packaging is what makes them run for real
for the first time.

This ticket warrants no ADR. The one decision with a long tail — Windows-only, unsigned, no update feed
— is already argued in the ticket body and restated in the config's own comments.

## Design

One new file, two committed binaries, one edited file.

**`electron-builder.yml`** (new). YAML rather than a `build` block in `package.json`, because the
non-default choices below each need a comment and JSON has none.

- `appId: dev.pyrycode.desktop`, `productName: Pyrycode Desktop`.
- `win: { target: nsis, icon: build/icon.ico }`. No `mac` key and no `linux` key: an artifact built for
  a platform nobody has ever launched the app on is not something this ticket ships.
- `files: [out/**, package.json]` — an allowlist, not the default `**/*`. It keeps `src/` and `e2e/` out
  of the asar, and with them the fake daemon, the fake relay and the test fixtures. Production
  `node_modules` still ship: electron-builder resolves them from the `dependencies` block, not from this
  glob, which is exactly what `externalizeDepsPlugin` requires.
- `extraMetadata: { productName: Pyrycode Desktop }`. Load-bearing, and the one line here that is not
  obvious. `app.getPath('userData')` follows Electron's `app.getName()`, which reads `productName` then
  `name` from the *app's* `package.json`; the config key above is invisible to it. Injecting
  `productName` into the packaged `package.json` only is what puts the secure-store blobs, the saved
  hosts and the rotating diagnostic log under `%APPDATA%\Pyrycode Desktop`, which the operator
  acceptance names. Putting `productName` in the repo's `package.json` instead would do the same to
  `npm run dev` and rename the author's live macOS data directory out from under his daily driver.
  **Verify in Phase B** by reading the packed `app.asar`'s `package.json`: if electron-builder already
  injects `productName` there, this line is redundant and comes out.
- `publish: null` — states the no-update-feed decision rather than leaving it to a default.
- `asar` stays at its default `true`. No `asarUnpack` until a load failure is observed.

**`build/icon.ico` and `build/icon.png`** (new, committed). `build/` is electron-builder's default
`buildResources` directory, so both are picked up by convention; they are build inputs and are
deliberately absent from the `files` allowlist. The Windows target consumes the `.ico`; the `.png` is the
512² raster master both were rendered from and the source electron-builder falls back to if the `.ico`
is ever removed.

Both are rendered from the shipped `PyryMark` snowflake — the same geometry mobile ships as
`ic_pyry_logo.xml` — on a rounded tile, in `--color-on-primary-container` (`#cfe4ff`) on
`--color-primary-container` (`#134a74`). No new mark is designed and no new colour is invented. The ICO
carries 16/24/32/48/64/128/256 entries; the 256² entry is the one electron-builder requires.

**`package.json`** (edited). Adds `"dist:win": "npm run build && electron-builder --win"` and
`electron-builder` to `devDependencies`. `npm run build` itself is untouched, so the e2e harness and the
pre-ship gate keep their meaning.

## State + concurrency model

No change. This ticket adds no runtime code, no store slice, no async task and no subscription.

## Error handling

No change to runtime error handling. The one new failure surface is build-time: `electron-builder --win`
either produces an installer or exits non-zero. AC4 makes that outcome — the artifact path, or the exact
failure text showing macOS cannot cross-build it — a recorded comment on the ticket either way.

## Testing strategy

- `npm run build` and `npm test` scoped to touched files (§ B2). Nothing under `src/` changes, so the
  scoped run is a no-op by construction and `npm run build` is the real gate on this side; the full
  suites plus `npm run e2e` are the dispatcher's gate, and AC3 is what they answer.
- **No new vitest spec.** A spec that parses `electron-builder.yml` and asserts the keys it declares is
  a second copy of the config, not a proof of it — the coverage theatre the security-review checklist
  warns about, in test form. The config's real proof is running it, which AC4 requires and records.
- **Contingency, decided in advance.** The one opaque artifact is the ICO: a container missing its 256²
  entry fails the Windows build on a machine nobody runs. electron-builder validates it during
  `dist:win`, which is a stronger check than any mirror of it here — *provided the run reaches the icon
  stage*. If the macOS run fails before that point, add one small vitest spec asserting the ICO
  directory's entry sizes and the PNG header dimensions, so the assets are not shipped to the Surface
  wholly unverified.
- Visual check of the rendered icon against the shipped `PyryMark` per the shared visual-review recipe:
  the icon must be that snowflake, at the tokens named above, legible down to 32².

## Open questions

1. Does `npm run dist:win` cross-build on this MacBook at all (no `wine` present), and if it fails, at
   which stage? AC4 is the answer either way.
2. Is `extraMetadata.productName` needed, or does electron-builder already inject `productName` into the
   packed `package.json`? Resolve by reading `dist/win-unpacked/resources/app.asar`; drop the line if
   redundant.
3. Does `noise-c.wasm` load from inside the asar? Only an installed launch answers it; the operator
   acceptance's pairing step is the test. `asarUnpack` is the fix if it does not.

## Documentation handoff

Pending, owned by the documentation stage. From the ticket body, verbatim in requirement:

- `README.md`, `## Build` section: document `dist:win`, the SmartScreen warning an unsigned installer
  shows on first launch, and that updating means installing a newer exe over the old one.
- Name `%APPDATA%\Pyrycode Desktop` as the Windows user-data directory, and say that the diagnostic log,
  the secure-store blobs and the saved hosts all live under it, so a future incident can find the log.

Not edited by this ticket.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary. Packaging flips `app.isPackaged` true for the first real run,
  and all three gates that read it — `selectRelayPolicy`, `selectWindowPresentation`, and the
  `selectSecretEncryption` call in `src/main/index.ts` — are false-first on it, so packaging can only
  tighten. The installed build therefore cannot be talked into the loopback relay, the keychain-free
  secret backend or a hidden window by any environment variable; the env flags are read only on the
  `!isPackaged` branch. The `files` allowlist reinforces this from the other side: `src/` never enters
  the asar, so the fake daemon and fake relay are not even present in the installed build.
- **[Tokens, secrets, credentials]** No token handling changes. Two concrete checks. First, the
  installer must ship no secret: `files` admits only `out/**` and `package.json`, the repo has no `.env`
  or key material, and `out/` is generated from `src/`. Second, **the asar is not a security boundary** —
  it is an uncompressed archive any local user can unpack, so it must never be treated as one; nothing
  in it is secret, and the device token stays where it already is, in `safeStorage` under `userData`.
  On Windows `safeStorage` is DPAPI-backed and user-scoped, and `createSecureStore` already fails closed
  when encryption is unavailable, so the Windows-first run cannot silently downgrade to plaintext.
- **[File / storage operations]** The real finding of this review, and the reason `extraMetadata` is in
  the design: `app.getPath('userData')` derives from `app.getName()`, which reads the *packaged*
  `package.json`. Without the injection the installed app would store under `%APPDATA%\pyrycode-desktop`
  rather than the `%APPDATA%\Pyrycode Desktop` the operator acceptance names — a directory mismatch that
  would send a later incident looking for the diagnostic log in the wrong place. `%APPDATA%` is
  per-user and ACL'd to that user, the same posture as macOS Application Support. No untrusted input
  reaches a path here: the packaging config contributes no runtime path concatenation, and the existing
  traversal-safe, atomic `fileSecretPersistence` is unchanged.
- **[Inter-process / Electron attack surface]** No `webPreferences`, no IPC channel and no protocol
  handler changes. NSIS defaults are the right posture and are deliberately left alone: `perMachine` is
  false, so the installer writes to `%LOCALAPPDATA%\Programs` and never requests elevation — a
  compromised or tampered unsigned installer therefore cannot escalate beyond the invoking user.
- **[Cryptographic primitives]** No change. `noise-c.wasm` remains the vetted rweather/noise-c build
  loaded once by `loadNoiseLib`; nothing here re-implements the handshake. The packaging-specific risk
  is availability, not correctness: if the wasm cannot be read from inside the asar the app fails closed
  at load (`NoiseLoadError`, category-only) rather than proceeding without Noise. Open question 3 tracks
  it; `asarUnpack` is the fix and changes no integrity property, since the asar was never one.
- **[Network & I/O]** No change to the socket, its `maxPayload`, or its timeouts. The packaged build is
  the first run of `productionRelayPolicy` — `wss:` plus the host allowlist — which is a tightening, and
  the operator acceptance exercises exactly that by confirming a loopback relay is refused.
- **[Error messages, logs, telemetry]** The packaged build is the first real run of `fileRotatingSink`,
  which means the app starts writing a diagnostic log to disk where it previously wrote to a stdout
  nobody captured. The content-free discipline is what makes that safe and it is unchanged by this
  ticket — but it is now load-bearing rather than theoretical, and the log lands in a user-scoped,
  size-rotated directory. No telemetry, no crash reporter and no network reporting is added here; an
  unsigned build also means no symbol upload path exists to leak into.
- **[Concurrency]** No findings — no async work, timer, listener or long-lived task is added.
- **[Threat model alignment]** Two named, deferred items. (1) **Supply chain.** `electron-builder` is a
  large new devDependency that, at build time, downloads Electron's Windows dist and NSIS binaries over
  the network. It is a devDependency, never shipped in the installer, and pinned through
  `package-lock.json`; electron-builder checksum-verifies its binary downloads. Accepted for a personal,
  locally built artifact; a hermetic build is out of scope and has no ticket. (2) **Unsigned installer.**
  There is no authenticity or tamper check on the artifact, and SmartScreen will warn on first launch —
  which trains the user to click through exactly such a warning. The ticket defers signing explicitly
  and names it as a follow-up ticket; the mitigation today is that the installer is built and carried by
  its only user.
- **[Out of scope, named]** Windows notifications. Electron needs an AppUserModelID for toast
  notifications on Windows, and `src/main/fireNotification.ts` never sets one. The NSIS shortcut
  electron-builder writes may supply it; if it does not, notifications will be silently wrong on the
  Surface. Not a security finding and not fixed here — no `src/` change belongs in this ticket, and the
  ticket body already directs a Windows-only failure unrelated to packaging to its own ticket. Recorded
  so the operator acceptance knows to look.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-14
