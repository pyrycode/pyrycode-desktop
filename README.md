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

## License

MIT. See [LICENSE](LICENSE).
