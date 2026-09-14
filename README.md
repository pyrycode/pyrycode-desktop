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

Runs `npm run build` and then `electron-builder --win`, producing an unsigned NSIS installer (x64 and
arm64) under `dist/`. It is unsigned, so Windows SmartScreen warns on first launch — click **More info**,
then **Run anyway**. There is no update feed: updating means installing a newer exe over the old one,
which replaces the program files in place and leaves user data untouched.

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
