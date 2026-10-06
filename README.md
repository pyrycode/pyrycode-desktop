# Pyrycode Desktop

Desktop client for [Pyrycode](https://github.com/pyrycode/pyrycode). Drive a pyry daemon running on another machine from a desktop window, over an encrypted, content-blind relay.

## Status

In daily use by its author, and under active development. Pairing, messaging and streaming replies all work over the relay, and a desktop-specific layout is being built to replace the phone layout the window currently wears. A sibling to the Android client `pyrycode-mobile`, sharing the same encrypted wire protocol. This is a personal project.

## Stack

Electron, React, and TypeScript, scaffolded with electron-vite. The network and crypto run in the Electron background process. The window renders typed events.

## Build

```bash
npm install
npm run dev
npm run build
npm test
```

### Windows installer

```bash
npm run dist:win
```

Runs `npm run build` and then `electron-builder --win --publish never`, producing one unsigned NSIS
installer for x64 and arm64 under `dist/`, its `.blockmap`, and `latest.yml`. This local command never
publishes. On Apple Silicon without Rosetta 2, it packs both architectures but fails at the Intel-only
`makensis` step; the release command below builds the installer on pyrybox instead.

To publish from the Mac:

```bash
npm run release:win -- 0.2.0
npm run release:win -- 0.2.0 --dry-run
```

Use a stable `X.Y.Z` version: no `v` prefix, leading zeroes, prerelease or build suffix. Except for an
exact already published version, it must exceed every published stable release, or the source
`package.json` version before the first release. Dry run prints the clone, checks and Wine build
commands without executing them, writing files or contacting GitHub; it does not validate live
release state.

The Mac needs Node/npm, Git, Bash, tar and SSH, access to the GitHub source, and
`~/.local/bin/automation-access` with `with-pyrybox-key` access (override the helper path with
`PYRY_AUTOMATION_ACCESS` if needed). The command automatically re-enters under
`automation-access with-pyrybox-key` and passes its temporary agent to SSH using `IdentityAgent`.
The SSH host `pyrybox` must reach the build account, which needs Podman with permission to pull and run
the Wine image, tar, coreutils and OpenSSL, plus an existing GitHub login at `~/.local/bin/gh` with
write access to `pyrycode/pyrycode-desktop`. Publishing uses that build-host login through `gh api`;
no GitHub token is sent to the Mac or Wine container or written to a new file.

The command pins a source SHA from GitHub main and prepares an isolated clone with `npm ci` and
`npm test`, stamps the release version there, then runs `npm run build`. The checkout and main's dev
version stay unchanged. It transfers the prepared tree to pyrybox and runs a digest-pinned
`electronuserland/builder:wine` image through Podman, installing locked dependencies and packaging
with `electron-builder --win --publish never`. Artifacts remain under
`~/pyrycode-desktop-release/X.Y.Z/project/dist/` on pyrybox. A draft `vX.Y.Z` targets the original
source SHA and receives `Pyrycode-Desktop-Setup-X.Y.Z.exe`, its `.blockmap`, and `latest.yml`.
Publication follows downloading all three back, checking that they match the build, and checking
the installer's base64 sha512 against the feed.

Rerun the same command after a failure. Keep `~/.cache/pyrycode-desktop-releases/X.Y.Z/` on the Mac and
the version's build directory on pyrybox: retries reuse the original SHA even if main advances, reuse
completed preparation/build steps, repair incomplete draft uploads, and verify again before
publishing. Conflicting draft or tag commits fail. An exact already published version returns
successfully without rebuilding or changing release state, even if local retry metadata is damaged.

The public update feed is hosted in [GitHub Releases](https://github.com/pyrycode/pyrycode-desktop/releases).
Both packaged architectures include `app-update.yml` pointing to that repo; runtime updater wiring
and the Surface updater round-trip belong to [#1775](https://github.com/pyrycode/pyrycode-desktop/issues/1775).
For the first Surface install, download the unsigned NSIS `.exe` from the release and run it manually.
Windows SmartScreen warns — click **More info**, then **Run anyway**. Until the runtime updater is
wired, install a newer exe over the old one to replace program files while keeping user data.

Before closing [#1774](https://github.com/pyrycode/pyrycode-desktop/issues/1774), the operator must record
a post-merge Wine build from main, inspect the installer/blockmap/feed, complete the first live
GitHub draft/upload/download verification/publish, and rerun that version to confirm a live no-op.
These checks remain pending; the preliminary feature-branch Wine build used stubbed GitHub writes.

The installed app stores under `%APPDATA%\Pyrycode Desktop` — the diagnostic log, the secure-store
blobs, and the saved hosts all live there, so a future incident on the Surface starts by looking under
that directory.

## Pre-ship gate

There is no CI (by policy), so before shipping run the gate locally:

```bash
npm run build            # typecheck + build main/preload/renderer
npm test                 # unit tests
npm run e2e              # fake-transport Playwright suite (the default tier)
npm run e2e:real-claude  # real-daemon + real-claude UI liveness
npm run e2e:real:gate    # the same specs, exit-code-safe (non-zero if nothing ran)
```

The real-claude gate drives a real `pyry` daemon running real `claude --model haiku` through an
in-process, content-blind **local** fake relay; it is gated out of `npm run e2e` and **skips
cleanly** when `claude`, `pyry`, or the credential is missing — `ANTHROPIC_API_KEY`, or
`CLAUDE_CODE_OAUTH_TOKEN` plus a readable `~/.claude.json`.

See the [live e2e runbook](docs/knowledge/features/live-e2e-runbook.md)
§ Current real-claude gate state for the current pass/fail state, the full prerequisite list, the
exit-code-safe `npm run e2e:real:gate`, and the live-relay `scripts/live-drive.mjs` gate.

## License

MIT. See [LICENSE](LICENSE).
