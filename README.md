# Pyrycode Desktop

Desktop client for [Pyrycode](https://github.com/pyrycode/pyrycode). Drive a pyry daemon running on another machine from a desktop window, over an encrypted, content-blind relay.

## Status

Early. Skeleton only. A sibling to the Android client `pyrycode-mobile`, sharing the same encrypted wire protocol. This is a personal project under active development.

## Stack

Electron, React, and TypeScript, scaffolded with electron-vite. The network and crypto run in the Electron background process. The window renders typed events.

## Build

```bash
npm install
npm run dev
npm run build
npm test
```

## Pre-ship gate

There is no CI (by policy), so before shipping run the gate locally:

```bash
npm run build            # typecheck + build main/preload/renderer
npm test                 # unit tests
npm run e2e:real-claude  # real-daemon + real-claude UI liveness (see below)
```

`npm run e2e:real-claude` launches the built app and drives a real round-trip: it pairs against a
freshly-spawned real `pyry` daemon running real `claude` on `--model haiku`, bridged through an
in-process, content-blind routing relay, and asserts a reply streams into the thread for two
consecutive sends. Every other e2e (`npm run e2e`) runs against fakes that always answer; this is the
one net that catches "the real daemon never replied". It is gated out of `npm run e2e` so the agent
pipeline never trips on it.

Prerequisites (the test **skips cleanly** — never fails — when any is missing):

- `claude` on `PATH`.
- `pyry` on `PATH`, or `PYRY_BIN=/path/to/pyry`. Build it from a tree that includes the
  interactive-bootstrap fix (`pyrycode#854`); an older daemon deadlocks on a fresh session and turn 1
  times out (that is the RED this test exists to catch).
- An Anthropic credential in the environment: `ANTHROPIC_API_KEY`, or (Max-only) a
  `CLAUDE_CODE_OAUTH_TOKEN` plus a readable `~/.claude.json` from a completed `claude` onboarding.

## License

MIT. See [LICENSE](LICENSE).
